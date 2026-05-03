/**
 * POST /api/messages/threads/[threadId]/messages-with-attachments
 *
 * Atomic-ish creation of a message + its attachment rows. Called
 * AFTER the client has uploaded files to storage.
 *
 * Body:
 *   {
 *     message_id: string,    // pre-generated UUID (matches storage paths)
 *     body: string,          // optional if attachments.length > 0
 *     attachments: [
 *       { storage_path, filename, mime_type, size_bytes, is_image }
 *     ]
 *   }
 *
 * Reason for the pre-generated id: the storage paths already include
 * this UUID (the upload happened before this call). Using the same
 * value as messages.id keeps the wiring simple.
 *
 * If any insert fails, we attempt to clean up partial state (delete
 * any inserted rows) but the storage objects are left behind — they
 * become orphans. A nightly cleanup job could harvest those, but it's
 * not in scope for this drop. Real-world impact is minimal: storage
 * paths include UUIDs so collisions never happen.
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

const MAX_ATTACHMENTS = 5
const MAX_BYTES = 25 * 1024 * 1024

export async function POST(
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

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Bad request body' }, { status: 400 })

  const messageId: string = body.message_id || ''
  const text: string = (body.body || '').toString().trim()
  const attachments: Array<{
    storage_path: string;
    filename: string;
    mime_type: string;
    size_bytes: number;
    is_image: boolean;
  }> = Array.isArray(body.attachments) ? body.attachments : []

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(messageId)) {
    return NextResponse.json({ error: 'Invalid message_id' }, { status: 400 })
  }

  if (!text && attachments.length === 0) {
    return NextResponse.json({ error: 'Message must have body or attachments' }, { status: 400 })
  }

  if (text.length > 8000) {
    return NextResponse.json({ error: 'Message too long' }, { status: 400 })
  }

  if (attachments.length > MAX_ATTACHMENTS) {
    return NextResponse.json({
      error: `Too many attachments (max ${MAX_ATTACHMENTS}).`
    }, { status: 400 })
  }

  // Validate each attachment payload shape and that the storage_path
  // begins with the expected prefix (preventing one user from claiming
  // another user's already-uploaded files).
  for (const a of attachments) {
    if (!a.storage_path || !a.filename || !a.mime_type) {
      return NextResponse.json({ error: 'Invalid attachment fields' }, { status: 400 })
    }
    if (typeof a.size_bytes !== 'number' || a.size_bytes < 0 || a.size_bytes > MAX_BYTES) {
      return NextResponse.json({ error: 'Attachment too large' }, { status: 400 })
    }
    // path: {company_id}/{thread_id}/{message_id}/{uuid}-{name}
    const segs = a.storage_path.split('/')
    if (segs.length < 4) {
      return NextResponse.json({ error: 'Bad storage path' }, { status: 400 })
    }
    if (segs[1] !== threadId) {
      return NextResponse.json({ error: 'Storage path does not match thread' }, { status: 400 })
    }
    if (segs[2] !== messageId) {
      return NextResponse.json({ error: 'Storage path does not match message_id' }, { status: 400 })
    }
  }

  // Insert the message row using the pre-generated id.
  // Use service role for the message insert so we control the id.
  // RLS on messages still forbids non-members from reading, so the
  // service role write here is bounded by us validating membership next.
  const svc = adminClient()

  // Validate membership via the SQL helper (covers live job_title threads).
  const { data: isMember } = await svc.rpc('is_thread_member', {
    p_thread_id: threadId,
    p_user_id: user.id,
  })
  if (!isMember) {
    return NextResponse.json({ error: 'Not a member of this thread' }, { status: 403 })
  }

  const { data: msg, error: msgErr } = await svc
    .from('messages')
    .insert({
      id: messageId,
      thread_id: threadId,
      sender_id: user.id,
      body: text || null,
    })
    .select()
    .single()

  if (msgErr || !msg) {
    return NextResponse.json({
      error: msgErr?.message || 'Could not create message'
    }, { status: 500 })
  }

  // Insert attachment rows, if any.
  if (attachments.length > 0) {
    const rows = attachments.map(a => ({
      message_id: messageId,
      storage_path: a.storage_path,
      filename: a.filename,
      mime_type: a.mime_type,
      size_bytes: a.size_bytes,
      is_image: !!a.is_image,
    }))
    const { error: attErr } = await svc
      .from('message_attachments')
      .insert(rows)
    if (attErr) {
      // Roll back the message — orphan storage objects are unavoidable
      // since we're not transactional across DB + storage, but at least
      // the user doesn't see a half-broken message.
      await svc.from('messages').delete().eq('id', messageId)
      return NextResponse.json({
        error: attErr.message
      }, { status: 500 })
    }
  }

  return NextResponse.json({ message: msg })
}
