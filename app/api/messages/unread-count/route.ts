/**
 * GET /api/messages/unread-count
 *
 * Returns the total unread message count across all the current user's
 * threads. Used by the sidebar badge.
 *
 * Cheap implementation: piggy-back on /api/messages/threads logic but
 * just sum + return a number. Bounded same as the threads endpoint.
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

export async function GET(_req: NextRequest) {
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
  if (!user) return NextResponse.json({ count: 0 })

  // Fetch thread ids the user is a member of (RLS filters)
  const { data: threadsRaw } = await supabase
    .from('message_threads')
    .select('id, last_message_at')

  if (!threadsRaw || threadsRaw.length === 0) {
    return NextResponse.json({ count: 0 })
  }

  const svc = adminClient()

  // Apply hide filter — same logic as the threads list endpoint.
  // A hidden thread auto-resurfaces when last_message_at > hidden_at
  // so this filter also drops "stale hidden" threads correctly.
  const { data: hiddenRows } = await svc
    .from('thread_hidden_by')
    .select('thread_id, hidden_at')
    .eq('user_id', user.id)
    .in('thread_id', threadsRaw.map(t => t.id))

  let threads = threadsRaw
  if (hiddenRows && hiddenRows.length > 0) {
    const hideAtById = new Map<string, string>(hiddenRows.map(r => [r.thread_id, r.hidden_at]))
    threads = threadsRaw.filter(t => {
      const h = hideAtById.get(t.id)
      if (!h) return true
      if (t.last_message_at && new Date(t.last_message_at) > new Date(h)) return true
      return false
    })
  }

  if (threads.length === 0) {
    return NextResponse.json({ count: 0 })
  }

  const threadIds = threads.map(t => t.id)

  const { data: reads } = await svc
    .from('message_reads')
    .select('thread_id, last_read_at')
    .eq('user_id', user.id)
    .in('thread_id', threadIds)

  const readMap = new Map<string, string>()
  for (const r of (reads || [])) {
    readMap.set(r.thread_id, r.last_read_at)
  }

  // Bounded scan — same approach as the threads endpoint.
  const { data: recentMessages } = await svc
    .from('messages')
    .select('thread_id, sender_id, created_at')
    .in('thread_id', threadIds)
    .neq('sender_id', user.id)
    .order('created_at', { ascending: false })
    .limit(500)

  let count = 0
  for (const m of (recentMessages || [])) {
    const lastRead = readMap.get(m.thread_id)
    if (!lastRead || new Date(m.created_at) > new Date(lastRead)) {
      count += 1
    }
  }

  return NextResponse.json({ count })
}
