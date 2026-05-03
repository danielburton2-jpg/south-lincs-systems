/**
 * PATCH  /api/messages/messages/[messageId] — edit body
 * DELETE /api/messages/messages/[messageId] — delete + clean up storage
 *
 * Both are admin-only by spec. Server-side checks:
 *   • caller must be admin role
 *   • caller must be the original sender (RLS enforces this too)
 *   • message must be in the same company as the caller
 *
 * On DELETE, attachment storage objects are also removed. The
 * message_attachments rows cascade via FK.
 *
 * On PATCH, edited_at is set to now() so the UI can render an
 * "(edited)" indicator.
 *
 * Body for PATCH: { body: string }  (required, non-empty if no
 *                                     attachments — but we don't
 *                                     enforce that on edit since
 *                                     attachments aren't editable)
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

async function authoriseAdminSender(messageId: string) {
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
  if (!user) return { error: NextResponse.json({ error: 'Not signed in' }, { status: 401 }) }

  const svc = adminClient()
  const { data: caller } = await svc
    .from('profiles')
    .select('id, role, company_id')
    .eq('id', user.id)
    .single()
  if (!caller || caller.role !== 'admin') {
    return { error: NextResponse.json({ error: 'Admins only' }, { status: 403 }) }
  }

  const { data: msg } = await svc
    .from('messages')
    .select('id, sender_id, thread_id')
    .eq('id', messageId)
    .single()
  if (!msg) {
    return { error: NextResponse.json({ error: 'Message not found' }, { status: 404 }) }
  }
  if (msg.sender_id !== caller.id) {
    return { error: NextResponse.json({
      error: 'You can only edit/delete your own messages'
    }, { status: 403 }) }
  }

  // Cross-company gate: confirm the thread is in the caller's company
  const { data: thread } = await svc
    .from('message_threads')
    .select('company_id')
    .eq('id', msg.thread_id)
    .single()
  if (!thread || thread.company_id !== caller.company_id) {
    return { error: NextResponse.json({ error: 'Cross-company forbidden' }, { status: 403 }) }
  }

  return { caller, msg, svc }
}

// ── PATCH (edit) ─────────────────────────────────────────────
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const { messageId } = await params
  const result = await authoriseAdminSender(messageId)
  if ('error' in result) return result.error
  const { svc } = result

  const body = await req.json().catch(() => null)
  if (!body || typeof body.body !== 'string') {
    return NextResponse.json({ error: 'body required' }, { status: 400 })
  }
  const newBody = body.body.trim()
  if (newBody.length === 0) {
    return NextResponse.json({
      error: 'Empty edit. Use DELETE to remove a message.'
    }, { status: 400 })
  }
  if (newBody.length > 8000) {
    return NextResponse.json({ error: 'Message too long' }, { status: 400 })
  }

  const { error } = await svc
    .from('messages')
    .update({
      body: newBody,
      edited_at: new Date().toISOString(),
    })
    .eq('id', messageId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// ── DELETE ────────────────────────────────────────────────────
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const { messageId } = await params
  const result = await authoriseAdminSender(messageId)
  if ('error' in result) return result.error
  const { svc } = result

  // Pull the storage paths for the attachments before the cascade
  // delete obliterates them.
  const { data: atts } = await svc
    .from('message_attachments')
    .select('storage_path')
    .eq('message_id', messageId)
  const paths = (atts || []).map(a => a.storage_path).filter(Boolean) as string[]

  // Delete the message row — message_attachments rows cascade.
  const { error: delErr } = await svc
    .from('messages')
    .delete()
    .eq('id', messageId)
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 })
  }

  // Best-effort storage cleanup. If this fails the storage objects
  // become orphans but the user-visible message is gone.
  if (paths.length > 0) {
    try {
      await svc.storage.from('message-attachments').remove(paths)
    } catch (err) {
      console.warn('[delete-message] storage cleanup failed:', err)
    }
  }

  return NextResponse.json({ ok: true })
}
