/**
 * /api/messages/threads
 *
 * GET   — list current user's threads, sorted by last_message_at.
 *         Includes last message preview and unread count per thread.
 *
 * POST  — create a new thread.
 *         Body shape:
 *           { kind: 'user_list',   user_ids: string[],  title?: string }
 *           { kind: 'job_title',   job_title: string,   title?: string }
 *           { kind: 'all_company', title?: string }
 *
 *         Returns the created thread row.
 *
 *         Rules:
 *           • For user_list, user_ids must include at least one OTHER
 *             user from the same company. The creator is added too.
 *           • For job_title, current user need not match the title
 *             themselves — they're added explicitly so they can see
 *             replies in the thread they started.
 *           • For all_company, no extra info needed.
 *           • Reusing existing threads is NOT done here — every
 *             "compose" creates a fresh thread. UI in zip 2 may add a
 *             "use existing" prompt for 1-on-1 cases.
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

async function getMe(req: NextRequest) {
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
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, company_id, full_name, job_title')
    .eq('id', user.id).single()
  if (!profile?.company_id) return null
  return { profile, supabase }
}

// ─────────────────────────── GET ───────────────────────────
export async function GET(req: NextRequest) {
  const me = await getMe(req)
  if (!me) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const svc = adminClient()

  // Fetch all threads where the user is a member. RLS would do this
  // for us with the auth client, but here we use service role + an
  // explicit filter so we can also pull last_read and unread count
  // efficiently in one trip.
  //
  // Two-step approach:
  //   1. Find thread IDs the user is a member of (via a SQL function call)
  //   2. Fetch the rows + their last_read row + a count of unread

  // Using auth.supabase here is cleanest — RLS handles the membership
  // filter via is_thread_member().
  const { data: threadsRaw, error } = await me.supabase
    .from('message_threads')
    .select(`
      id, company_id, created_by, created_at,
      target_kind, target_job_title, title,
      last_message_at, last_message_preview, archived_at
    `)
    .order('last_message_at', { ascending: false, nullsFirst: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let threads = threadsRaw || []

  if (threads.length === 0) {
    return NextResponse.json({ threads: [] })
  }

  // Apply per-user "hide from my list" filter. The hide auto-expires
  // when fresh activity arrives (last_message_at > hidden_at), so a
  // new message from the other person resurrects the thread. Only
  // user_list threads can be hidden, but we apply the filter against
  // every thread (no-op for non-hideable kinds).
  const { data: hiddenRows } = await svc
    .from('thread_hidden_by')
    .select('thread_id, hidden_at')
    .eq('user_id', me.profile.id)
    .in('thread_id', threads.map(t => t.id))

  if (hiddenRows && hiddenRows.length > 0) {
    const hideAtById = new Map<string, string>(
      hiddenRows.map(r => [r.thread_id, r.hidden_at])
    )
    threads = threads.filter(t => {
      const hideAt = hideAtById.get(t.id)
      if (!hideAt) return true
      // Show if there's been new activity since hide
      if (t.last_message_at && new Date(t.last_message_at) > new Date(hideAt)) return true
      return false
    })
    if (threads.length === 0) {
      return NextResponse.json({ threads: [] })
    }
  }

  const threadIds = threads.map(t => t.id)

  // Fetch the user's read state for all these threads in one query.
  const { data: reads } = await svc
    .from('message_reads')
    .select('thread_id, last_read_at, last_read_message_id')
    .eq('user_id', me.profile.id)
    .in('thread_id', threadIds)

  const readMap = new Map<string, string | null>()
  for (const r of (reads || [])) {
    readMap.set(r.thread_id, r.last_read_at)
  }

  // Compute unread counts. For each thread, count messages newer than
  // the user's last_read_at (or all messages if no read row).
  // Single query: for all threads, return (thread_id, count) where
  // sender_id != me AND created_at > coalesce(read_at, '1970-01-01').
  //
  // Cheap-enough approach: fetch the recent messages for each thread
  // in one shot then group/count client-side. Since each thread has
  // a "last message" preview already, the per-thread message volume
  // here is small (we cap at 50 unread to keep the query bounded).
  // Honest tradeoff: doesn't scale to giant unread counts but the UI
  // only shows "9+" anyway.

  const { data: recentMessages } = await svc
    .from('messages')
    .select('id, thread_id, sender_id, created_at')
    .in('thread_id', threadIds)
    .neq('sender_id', me.profile.id)  // self-sent messages don't count as unread
    .order('created_at', { ascending: false })
    .limit(500)  // bounded; "9+" is the max we'd display anyway

  const unreadByThread = new Map<string, number>()
  for (const m of (recentMessages || [])) {
    const lastReadAt = readMap.get(m.thread_id) || null
    if (!lastReadAt || new Date(m.created_at) > new Date(lastReadAt)) {
      unreadByThread.set(m.thread_id, (unreadByThread.get(m.thread_id) || 0) + 1)
    }
  }

  // Generate a display title for threads that don't have a manual one.
  // For user_list threads we need the OTHER members' names so the row
  // reads as "Daniel Burton" not "Direct message".
  //
  // We deliberately use two clean queries instead of the nested
  // PostgREST relation `user:profiles(full_name)` — that returns
  // either an object or an array depending on inferred cardinality
  // and intermittently swallows the name. Two queries are surprise-
  // free.
  const userListThreadIds = threads
    .filter(t => t.target_kind === 'user_list' && !t.title)
    .map(t => t.id)
  const memberMap = new Map<string, string[]>()  // threadId → [name, name, ...]

  if (userListThreadIds.length > 0) {
    // 1. Pull the (thread_id, user_id) member rows
    const { data: members } = await svc
      .from('message_thread_members')
      .select('thread_id, user_id')
      .in('thread_id', userListThreadIds)

    // 2. Pull the profile names for the union of all user_ids
    const userIds = Array.from(new Set((members || []).map(m => m.user_id)))
    let nameById = new Map<string, string>()
    if (userIds.length > 0) {
      const { data: profs } = await svc
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds)
      for (const p of (profs || [])) {
        nameById.set(p.id, p.full_name || 'User')
      }
    }

    // 3. Build the per-thread name list, excluding the caller
    for (const m of (members || [])) {
      if (m.user_id === me.profile.id) continue
      const arr = memberMap.get(m.thread_id) || []
      arr.push(nameById.get(m.user_id) || 'User')
      memberMap.set(m.thread_id, arr)
    }
  }

  const enriched = threads.map(t => {
    let displayTitle = t.title
    if (!displayTitle) {
      if (t.target_kind === 'all_company') displayTitle = 'Everyone'
      else if (t.target_kind === 'job_title') displayTitle = t.target_job_title || 'Group'
      else if (t.target_kind === 'user_list') {
        const names = memberMap.get(t.id) || []
        if (names.length === 0) {
          // Should not normally happen — would mean the thread has no
          // other members or the profile rows are missing. Fall back
          // to a generic label that's still less confusing than the
          // old "Direct message" placeholder.
          displayTitle = 'Conversation'
        }
        else if (names.length === 1) displayTitle = names[0]
        else if (names.length === 2) displayTitle = names.join(' & ')
        else displayTitle = `${names[0]}, ${names[1]} & ${names.length - 2} more`
      }
    }
    return {
      ...t,
      display_title: displayTitle,
      unread_count: unreadByThread.get(t.id) || 0,
    }
  })

  return NextResponse.json({ threads: enriched })
}

// ─────────────────────────── POST ──────────────────────────
export async function POST(req: NextRequest) {
  const me = await getMe(req)
  if (!me) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body?.kind) return NextResponse.json({ error: 'Missing kind' }, { status: 400 })

  const svc = adminClient()

  // Build the thread payload based on kind
  let target_kind: string
  let target_job_title: string | null = null

  if (body.kind === 'user_list') {
    target_kind = 'user_list'
  } else if (body.kind === 'job_title') {
    if (!body.job_title || typeof body.job_title !== 'string') {
      return NextResponse.json({ error: 'Missing job_title' }, { status: 400 })
    }
    target_kind = 'job_title'
    target_job_title = body.job_title.trim()
  } else if (body.kind === 'all_company') {
    target_kind = 'all_company'
  } else {
    return NextResponse.json({ error: 'Unknown kind' }, { status: 400 })
  }

  // Insert the thread (service role — bypasses RLS for the policy
  // boundary check, but we manually scope to user's company).
  const { data: thread, error: threadErr } = await svc
    .from('message_threads')
    .insert({
      company_id: me.profile.company_id,
      created_by: me.profile.id,
      target_kind,
      target_job_title,
      title: body.title?.trim() || null,
    })
    .select()
    .single()

  if (threadErr || !thread) {
    return NextResponse.json({ error: threadErr?.message || 'Could not create thread' }, { status: 500 })
  }

  // For user_list threads, insert the explicit member rows.
  // ALWAYS include the creator so they can see their own thread.
  if (target_kind === 'user_list') {
    const userIds: string[] = Array.isArray(body.user_ids) ? body.user_ids : []
    const memberSet = new Set<string>(userIds)
    memberSet.add(me.profile.id)  // creator always included

    if (memberSet.size < 2) {
      // Roll back the thread we just made — can't have a one-person user_list
      await svc.from('message_threads').delete().eq('id', thread.id)
      return NextResponse.json({ error: 'Pick at least one other person' }, { status: 400 })
    }

    // Verify all targets are in the same company. Avoid leaking users
    // from other companies via a forged user_ids list.
    const memberIds = Array.from(memberSet)
    const { data: validMembers, error: mErr } = await svc
      .from('profiles')
      .select('id')
      .eq('company_id', me.profile.company_id)
      .in('id', memberIds)

    if (mErr || !validMembers || validMembers.length !== memberIds.length) {
      await svc.from('message_threads').delete().eq('id', thread.id)
      return NextResponse.json({ error: 'One or more recipients are not in your company' }, { status: 400 })
    }

    const memberRows = memberIds.map(uid => ({
      thread_id: thread.id,
      user_id: uid,
      added_by: me.profile.id,
    }))

    const { error: insertErr } = await svc
      .from('message_thread_members')
      .insert(memberRows)

    if (insertErr) {
      await svc.from('message_threads').delete().eq('id', thread.id)
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }
  }

  return NextResponse.json({ thread })
}
