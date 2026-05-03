/**
 * POST /api/messages/threads/[threadId]/messages
 *
 * Body: { body: string }
 *
 * Posts a new message. RLS via the auth client — the caller must be
 * a member of the thread.
 *
 * Attachments handled in zip 4 (separate upload route).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

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
  const text = (body?.body || '').toString().trim()

  if (!text) {
    return NextResponse.json({ error: 'Message body required' }, { status: 400 })
  }

  if (text.length > 8000) {
    return NextResponse.json({ error: 'Message too long (8000 char max)' }, { status: 400 })
  }

  // RLS gates this — the user must be a member of the thread for the
  // INSERT to succeed (messages_member_insert policy uses
  // is_thread_member()).
  const { data: msg, error } = await supabase
    .from('messages')
    .insert({
      thread_id: threadId,
      sender_id: user.id,
      body: text,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 403 })
  }

  return NextResponse.json({ message: msg })
}
