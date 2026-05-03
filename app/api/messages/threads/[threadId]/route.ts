/**
 * GET /api/messages/threads/[threadId]
 *
 * List messages in a thread, oldest first (chronological).
 *
 * Pagination via query string:
 *   ?before=<message_id>  — fetch messages older than this one
 *   ?limit=<n>            — default 100, max 200
 *
 * RLS handles the membership check via is_thread_member().
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const { threadId } = await params

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() { /* no-op */ },
      },
    },
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  // Pagination
  const url = new URL(req.url)
  const before = url.searchParams.get('before')
  const limitRaw = parseInt(url.searchParams.get('limit') || '100', 10)
  const limit = isNaN(limitRaw) ? 100 : Math.min(Math.max(limitRaw, 1), 200)

  // RLS gates this — the user must be a member of the thread.
  let q = supabase
    .from('messages')
    .select(`
      id, thread_id, sender_id, body, created_at, edited_at,
      sender:profiles!messages_sender_id_fkey(id, full_name, job_title)
    `)
    .eq('thread_id', threadId)
    .order('created_at', { ascending: false })  // newest-first for the cursor
    .limit(limit)

  if (before) {
    // Find the cursor message's created_at
    const { data: cursor } = await supabase
      .from('messages')
      .select('created_at')
      .eq('id', before)
      .single()
    if (cursor?.created_at) {
      q = q.lt('created_at', cursor.created_at)
    }
  }

  const { data: messages, error } = await q

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 403 })
  }

  // Also fetch attachments for these messages — fast, single query.
  let attachmentsByMessage: Record<string, any[]> = {}
  if (messages && messages.length > 0) {
    const ids = messages.map(m => m.id)
    const { data: atts } = await supabase
      .from('message_attachments')
      .select('id, message_id, storage_path, filename, mime_type, size_bytes, is_image')
      .in('message_id', ids)

    // Mint short-lived signed download URLs so the client can render
    // images and provide download links without a per-attachment
    // round-trip. 10 minute expiry — plenty for a page session.
    if (atts && atts.length > 0) {
      const svcUrls = adminClient()
      // Sign in parallel — small file lists, tiny round-trip each.
      const signed = await Promise.all(
        atts.map(async (a) => {
          const { data } = await svcUrls
            .storage
            .from('message-attachments')
            .createSignedUrl(a.storage_path, 60 * 10)
          return { id: a.id, url: data?.signedUrl || null }
        })
      )
      const urlById = new Map(signed.map(s => [s.id, s.url]))
      for (const a of atts) {
        const arr = attachmentsByMessage[a.message_id] || []
        arr.push({ ...a, signed_url: urlById.get(a.id) || null })
        attachmentsByMessage[a.message_id] = arr
      }
    }
  }

  // Return oldest-first to make the UI's job easier (just append).
  const ordered = (messages || []).reverse().map(m => ({
    ...m,
    attachments: attachmentsByMessage[m.id] || [],
  }))

  // Also fetch thread metadata + member list for the page header
  const { data: thread } = await supabase
    .from('message_threads')
    .select('id, target_kind, target_job_title, title, company_id, created_by, created_at')
    .eq('id', threadId)
    .single()

  if (!thread) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 })
  }

  // Resolve members for display (live for non-user_list)
  const svc = adminClient()
  let members: any[] = []
  if (thread.target_kind === 'user_list') {
    const { data: m } = await svc
      .from('message_thread_members')
      .select(`user_id, user:profiles(id, full_name, job_title, role)`)
      .eq('thread_id', threadId)
    members = (m || []).map(r => r.user).filter(Boolean)
  } else if (thread.target_kind === 'job_title') {
    const { data: m } = await svc
      .from('profiles')
      .select('id, full_name, job_title, role')
      .eq('company_id', thread.company_id)
      .ilike('job_title', thread.target_job_title || '')
    members = m || []
  } else if (thread.target_kind === 'all_company') {
    const { data: m } = await svc
      .from('profiles')
      .select('id, full_name, job_title, role')
      .eq('company_id', thread.company_id)
    members = m || []
  }

  // Is the caller currently muting this thread?
  const { data: muteRow } = await svc
    .from('message_thread_mutes')
    .select('thread_id')
    .eq('thread_id', threadId)
    .eq('user_id', user.id)
    .maybeSingle()

  // Caller role drives admin-only UI features (edit/delete, manage
  // members, mute toggle, edit title).
  const { data: callerProfile } = await svc
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  return NextResponse.json({
    thread,
    members,
    messages: ordered,
    has_more: (messages || []).length === limit,
    is_muted: !!muteRow,
    caller_role: callerProfile?.role || 'user',
  })
}

// ───────────────────────── PATCH ─────────────────────────────
//
// PATCH /api/messages/threads/[threadId]
//
// Admin-only. Currently supports renaming the thread title.
//
// Body: { title: string | null }
//   • title === null  → clear the manual title (revert to derived
//                        display: members' names / job title / etc.)
//   • title === ''    → same as null (treat empty as cleared)
//   • title === '...' → set the manual title

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const { threadId } = await params

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() { /* no-op */ },
      },
    },
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const svc = adminClient()
  const { data: caller } = await svc
    .from('profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .single()
  if (!caller || caller.role !== 'admin') {
    return NextResponse.json({ error: 'Admins only' }, { status: 403 })
  }

  const { data: thread } = await svc
    .from('message_threads')
    .select('id, company_id')
    .eq('id', threadId)
    .single()
  if (!thread) return NextResponse.json({ error: 'Thread not found' }, { status: 404 })
  if (thread.company_id !== caller.company_id) {
    return NextResponse.json({ error: 'Cross-company forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

  // Build the patch — currently just title. New fields can layer in.
  const update: Record<string, any> = {}
  if ('title' in body) {
    let t = body.title
    if (typeof t === 'string') t = t.trim()
    update.title = t === '' || t === null || t === undefined ? null : t
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No supported fields in body' }, { status: 400 })
  }

  const { error } = await svc
    .from('message_threads')
    .update(update)
    .eq('id', threadId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
