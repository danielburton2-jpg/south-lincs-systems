/**
 * POST /api/messages/threads/[threadId]/hide
 *
 * "Remove this thread from my view" — only meaningful for user_list
 * threads (1-on-1s). The other person isn't affected, and a new
 * message in this thread automatically un-hides it for me (the
 * threads-list query treats `last_message_at > hidden_at` as
 * "back in my list").
 *
 * Body: none.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function POST(
  _req: NextRequest,
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

  // Confirm the thread is a user_list type. We only allow hide for
  // 1-on-1s; group threads ignore this endpoint to avoid users
  // hiding admin broadcasts.
  const { data: thread } = await supabase
    .from('message_threads')
    .select('id, target_kind')
    .eq('id', threadId)
    .single()

  if (!thread) return NextResponse.json({ error: 'Thread not found' }, { status: 404 })
  if (thread.target_kind !== 'user_list') {
    return NextResponse.json({ error: 'Only 1-on-1 threads can be hidden' }, { status: 400 })
  }

  // Upsert: if already hidden, refresh the timestamp.
  const { error } = await supabase
    .from('thread_hidden_by')
    .upsert(
      { thread_id: threadId, user_id: user.id, hidden_at: new Date().toISOString() },
      { onConflict: 'thread_id,user_id' }
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
