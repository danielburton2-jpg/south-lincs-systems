/**
 * POST /api/messages/threads/[threadId]/read
 *
 * Marks the thread as read up to the given message_id (or "now" if no
 * id provided). Stores a row in message_reads.
 *
 * Body: { last_read_message_id?: string }
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
  const lastMsgId: string | null = body?.last_read_message_id || null

  // Upsert into message_reads. RLS allows users to manage their own row.
  const { error } = await supabase
    .from('message_reads')
    .upsert(
      {
        thread_id: threadId,
        user_id: user.id,
        last_read_message_id: lastMsgId,
        last_read_at: new Date().toISOString(),
      },
      { onConflict: 'thread_id,user_id' },
    )

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 403 })
  }

  return NextResponse.json({ ok: true })
}
