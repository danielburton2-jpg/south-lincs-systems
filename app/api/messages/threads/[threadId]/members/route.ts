/**
 * POST   /api/messages/threads/[threadId]/members  — add member
 * DELETE /api/messages/threads/[threadId]/members  — remove member
 *
 * Admin-only. Operates on user_list threads only — for job_title
 * and all_company threads, membership is computed live from
 * profiles, so explicit add/remove doesn't apply.
 *
 * Body (both): { user_id: string }
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

async function getCallerAdmin(threadId: string) {
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

  const { data: thread } = await svc
    .from('message_threads')
    .select('id, company_id, target_kind')
    .eq('id', threadId)
    .single()
  if (!thread) {
    return { error: NextResponse.json({ error: 'Thread not found' }, { status: 404 }) }
  }
  if (thread.company_id !== caller.company_id) {
    return { error: NextResponse.json({ error: 'Cross-company forbidden' }, { status: 403 }) }
  }
  if (thread.target_kind !== 'user_list') {
    return { error: NextResponse.json({
      error: 'Group threads (job_title / all_company) use live membership — add/remove not applicable'
    }, { status: 400 }) }
  }

  return { caller, thread, svc }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const { threadId } = await params
  const result = await getCallerAdmin(threadId)
  if ('error' in result) return result.error
  const { caller, thread, svc } = result

  const body = await req.json().catch(() => null)
  const userId = body?.user_id
  if (!userId) return NextResponse.json({ error: 'user_id required' }, { status: 400 })

  // Confirm the target user is in the same company.
  const { data: target } = await svc
    .from('profiles')
    .select('id, company_id')
    .eq('id', userId)
    .single()
  if (!target || target.company_id !== thread.company_id) {
    return NextResponse.json({ error: 'User not in this company' }, { status: 400 })
  }

  // Insert (idempotent — if already a member, we silently no-op via
  // ON CONFLICT)
  const { error } = await svc
    .from('message_thread_members')
    .upsert(
      { thread_id: threadId, user_id: userId, added_by: caller.id, added_at: new Date().toISOString() },
      { onConflict: 'thread_id,user_id', ignoreDuplicates: true },
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const { threadId } = await params
  const result = await getCallerAdmin(threadId)
  if ('error' in result) return result.error
  const { svc } = result

  const body = await req.json().catch(() => null)
  const userId = body?.user_id
  if (!userId) return NextResponse.json({ error: 'user_id required' }, { status: 400 })

  // Don't let the admin remove the LAST member — would leave an
  // orphan thread no one can see. Count current members; refuse if
  // removing this user would drop the count to 0.
  const { data: members } = await svc
    .from('message_thread_members')
    .select('user_id')
    .eq('thread_id', threadId)
  const currentCount = (members || []).length
  const isMember = (members || []).some(m => m.user_id === userId)
  if (isMember && currentCount <= 1) {
    return NextResponse.json({
      error: 'Cannot remove the last member of a thread. Delete the thread instead.'
    }, { status: 400 })
  }

  const { error } = await svc
    .from('message_thread_members')
    .delete()
    .eq('thread_id', threadId)
    .eq('user_id', userId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
