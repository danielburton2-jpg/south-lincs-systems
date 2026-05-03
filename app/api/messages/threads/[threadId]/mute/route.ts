/**
 * POST /api/messages/threads/[threadId]/mute
 *
 * Mute notifications for this thread (admin only by spec).
 * Affects:
 *   • in-app toast (listener checks the mute row)
 *   • lock-screen push (notify-event excludes muted recipients)
 *
 * Visibility, unread badges, and being able to read/post are
 * unaffected.
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

  // Admin-only gate
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Admins only' }, { status: 403 })
  }

  // Upsert the mute row
  const { error } = await supabase
    .from('message_thread_mutes')
    .upsert(
      { thread_id: threadId, user_id: user.id, muted_at: new Date().toISOString() },
      { onConflict: 'thread_id,user_id' }
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
