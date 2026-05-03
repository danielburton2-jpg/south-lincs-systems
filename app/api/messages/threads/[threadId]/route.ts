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
    for (const a of (atts || [])) {
      const arr = attachmentsByMessage[a.message_id] || []
      arr.push(a)
      attachmentsByMessage[a.message_id] = arr
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

  return NextResponse.json({
    thread,
    members,
    messages: ordered,
    has_more: (messages || []).length === limit,
  })
}
