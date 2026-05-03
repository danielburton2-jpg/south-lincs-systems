/**
 * POST /api/notify-event
 *
 * Routes a push notification based on a typed event kind. Pages call
 * this after they've completed an action — we look up the details
 * server-side and push the right user.
 *
 * Body shape:
 *   { kind: 'defect_assigned',  defect_id }
 *   { kind: 'service_assigned', schedule_id }
 *   { kind: 'holiday_decided',  request_id }   // approved or rejected
 *   { kind: 'schedule_assigned', assignment_id }
 *
 * Each event:
 *   1. Verifies the caller is authenticated and same-company as the row
 *   2. Looks up the target user (assignee, requester, etc.)
 *   3. Skips if target = caller (don't ping yourself)
 *   4. Skips if target is admin/manager (web push is employee-only)
 *   5. Sends the push
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { sendPushToUser, type PushPayload } from '@/lib/push'

type Event =
  | { kind: 'defect_assigned';   defect_id: string }
  | { kind: 'service_assigned';  schedule_id: string }
  | { kind: 'holiday_decided';   request_id: string }
  | { kind: 'schedule_assigned'; assignment_id: string }
  | { kind: 'message_sent';      message_id: string }

export async function POST(req: NextRequest) {
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

  const { data: caller } = await supabase
    .from('profiles')
    .select('id, role, company_id')
    .eq('id', user.id)
    .single()
  if (!caller?.company_id) {
    return NextResponse.json({ error: 'No company' }, { status: 400 })
  }

  const event = await req.json().catch(() => null) as Event | null
  if (!event?.kind) {
    return NextResponse.json({ error: 'Missing kind' }, { status: 400 })
  }

  // Service role for the target lookup — we want to read assignments
  // even if the target is a different RLS subject than the caller.
  const svc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  let targetUserId: string | null = null
  let payload: PushPayload | null = null

  // ─── message_sent — multi-recipient broadcast, skips role gate ───
  // Different shape from the single-target events: we resolve all
  // current thread members (live for job_title / all_company), filter
  // out the sender, and push each one. Role gate doesn't apply here
  // because messaging is everyone-to-everyone.
  if (event.kind === 'message_sent') {
    const { data: msg } = await svc
      .from('messages')
      .select(`
        id, thread_id, sender_id, body, created_at,
        thread:message_threads(id, company_id, target_kind, target_job_title, title),
        sender:profiles!messages_sender_id_fkey(id, full_name)
      `)
      .eq('id', event.message_id)
      .single()
    if (!msg) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }
    const thread = msg.thread as any
    if (!thread || thread.company_id !== caller.company_id) {
      return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
    }
    if (msg.sender_id !== caller.id) {
      return NextResponse.json({ error: 'Only the sender can trigger this' }, { status: 403 })
    }

    // Resolve recipients live based on thread kind
    let recipientIds: string[] = []
    if (thread.target_kind === 'user_list') {
      const { data: members } = await svc
        .from('message_thread_members')
        .select('user_id')
        .eq('thread_id', thread.id)
      recipientIds = (members || []).map((m: any) => m.user_id)
    } else if (thread.target_kind === 'job_title') {
      const { data: people } = await svc
        .from('profiles')
        .select('id, job_title')
        .eq('company_id', thread.company_id)
      recipientIds = (people || [])
        .filter((p: any) =>
          (p.job_title || '').toLowerCase().trim() === (thread.target_job_title || '').toLowerCase().trim()
          && (p.job_title || '').trim() !== ''
        )
        .map((p: any) => p.id)
    } else {
      // all_company
      const { data: people } = await svc
        .from('profiles')
        .select('id')
        .eq('company_id', thread.company_id)
      recipientIds = (people || []).map((p: any) => p.id)
    }

    // Filter out sender
    recipientIds = recipientIds.filter(id => id !== msg.sender_id)
    if (recipientIds.length === 0) {
      return NextResponse.json({ ok: true, skipped: 'no recipients' })
    }

    // Build the push payload. Title format: "Sender · ThreadName" for
    // group threads, just "Sender" for 1-on-1. Recipient role drives
    // the URL prefix (driver → /employee, others → /dashboard).
    const senderName = (msg.sender as any)?.full_name || 'Someone'
    const isGroup = thread.target_kind !== 'user_list'
    const groupLabel = thread.title || (
      thread.target_kind === 'all_company' ? 'Everyone' : (thread.target_job_title || 'Group')
    )
    const titleForGroup = `${senderName} · ${groupLabel}`
    const titleForDirect = senderName

    // Body: message body or [attachment] indicator
    let bodyText = msg.body || '[attachment]'
    if (bodyText.length > 80) bodyText = bodyText.slice(0, 79) + '…'

    // For each recipient: lookup their role to pick URL prefix, then push
    const pushResults = await Promise.all(recipientIds.map(async (uid) => {
      const { data: rp } = await svc
        .from('profiles')
        .select('role')
        .eq('id', uid)
        .single()
      const isDriver = rp?.role === 'user'
      const url = isDriver
        ? `/employee/messages/${thread.id}`
        : `/dashboard/messages/${thread.id}`

      const recipientPayload: PushPayload = {
        title: isGroup ? titleForGroup : titleForDirect,
        body: bodyText,
        url,
        tone: 'info',
        tag: `message-${thread.id}`,
      }
      const sent = await sendPushToUser(uid, recipientPayload)
      return sent
    }))

    const totalSent = pushResults.reduce((a, b) => a + b, 0)
    return NextResponse.json({
      ok: true,
      kind: 'message_sent',
      recipients: recipientIds.length,
      sentCount: totalSent,
    })
  }

  // ─── Single-target events (defect_assigned, etc.) ───
  if (event.kind === 'defect_assigned') {
    const { data: d } = await svc
      .from('vehicle_defects')
      .select(`
        id, company_id, assigned_to, severity,
        defect_note, description, item_text,
        vehicle:vehicles(registration, fleet_number)
      `)
      .eq('id', event.defect_id)
      .single()
    if (!d || d.company_id !== caller.company_id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (!d.assigned_to) {
      return NextResponse.json({ ok: true, skipped: 'no assignee' })
    }
    targetUserId = d.assigned_to
    const sev = d.severity || 'minor'
    const tone: 'urgent' | 'info' = (sev === 'critical' || sev === 'major') ? 'urgent' : 'info'
    const reg = (d.vehicle as any)?.registration || 'a vehicle'
    const detail = d.defect_note || d.description || d.item_text || 'Defect needs attention'
    payload = {
      title: sev === 'critical' ? '🚨 Critical defect assigned' : 'Defect assigned to you',
      body: `${reg} — ${truncate(detail, 80)}`,
      url: '/employee/services',
      tone,
      tag: `defect-${d.id}`,
    }
  }

  else if (event.kind === 'service_assigned') {
    const { data: s } = await svc
      .from('service_schedules')
      .select(`
        id, company_id, assigned_to, service_type, priority,
        date_mode, scheduled_date, week_commencing,
        vehicle:vehicles(registration, fleet_number)
      `)
      .eq('id', event.schedule_id)
      .single()
    if (!s || s.company_id !== caller.company_id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (!s.assigned_to) {
      return NextResponse.json({ ok: true, skipped: 'no assignee' })
    }
    targetUserId = s.assigned_to
    const reg = (s.vehicle as any)?.registration || 'a vehicle'
    const typeLabel = formatServiceType(s.service_type)
    const dateLabel = s.date_mode === 'week' && s.week_commencing
      ? `WC ${formatDate(s.week_commencing)}`
      : s.scheduled_date ? formatDate(s.scheduled_date) : 'TBC'
    payload = {
      title: `New ${typeLabel} assigned`,
      body: `${reg} — ${dateLabel}`,
      url: '/employee/services',
      tone: 'info',
      tag: `service-${s.id}`,
    }
  }

  else if (event.kind === 'holiday_decided') {
    const { data: h } = await svc
      .from('holiday_requests')
      .select('id, company_id, user_id, status, start_date, end_date')
      .eq('id', event.request_id)
      .single()
    if (!h || h.company_id !== caller.company_id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (h.status !== 'approved' && h.status !== 'rejected') {
      return NextResponse.json({ ok: true, skipped: 'status not decided' })
    }
    targetUserId = h.user_id
    const dateRange = `${formatDate(h.start_date)}${h.end_date && h.end_date !== h.start_date ? ` – ${formatDate(h.end_date)}` : ''}`
    payload = {
      title: h.status === 'approved' ? '✅ Holiday approved' : '❌ Holiday rejected',
      body: dateRange,
      url: '/employee/holidays',
      tone: 'info',
      tag: `holiday-${h.id}`,
    }
  }

  else if (event.kind === 'schedule_assigned') {
    const { data: a } = await svc
      .from('schedule_assignments')
      .select(`
        id, schedule_id, user_id,
        schedule:schedules(id, company_id, title, start_date, end_date, start_time, end_time)
      `)
      .eq('id', event.assignment_id)
      .single()
    if (!a || (a.schedule as any)?.company_id !== caller.company_id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    targetUserId = a.user_id
    const sch = a.schedule as any
    const dateRange = sch.start_date === sch.end_date
      ? formatDate(sch.start_date)
      : `${formatDate(sch.start_date)} – ${formatDate(sch.end_date)}`
    const timeRange = sch.start_time && sch.end_time
      ? ` ${sch.start_time.slice(0,5)}–${sch.end_time.slice(0,5)}`
      : ''
    payload = {
      title: `Scheduled: ${sch.title || 'shift'}`,
      body: `${dateRange}${timeRange}`,
      url: '/employee/schedules',
      tone: 'info',
      tag: `schedule-${a.id}`,
    }
  }

  else {
    return NextResponse.json({ error: 'Unknown event kind' }, { status: 400 })
  }

  if (!targetUserId || !payload) {
    return NextResponse.json({ ok: true, skipped: 'no target' })
  }

  // Don't push the caller about their own action
  if (targetUserId === caller.id) {
    return NextResponse.json({ ok: true, skipped: 'self-action' })
  }

  // Web push is employee-only — verify the target is a driver
  const { data: targetProfile } = await svc
    .from('profiles')
    .select('role')
    .eq('id', targetUserId)
    .single()
  if (!targetProfile || targetProfile.role !== 'user') {
    return NextResponse.json({ ok: true, skipped: 'target is not a driver' })
  }

  const sentCount = await sendPushToUser(targetUserId, payload)

  return NextResponse.json({ ok: true, sentCount })
}

// ───────────────────────────── helpers ─────────────────────────────
function truncate(s: string, n: number) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

function formatDate(iso: string) {
  if (!iso) return '?'
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

function formatServiceType(t: string | null) {
  switch (t) {
    case 'service':           return 'service'
    case 'mot':               return 'MOT'
    case 'mot_prep':          return 'MOT prep'
    case 'inspection':        return 'inspection'
    case 'safety_inspection': return 'safety inspection'
    case 'tacho_calibration': return 'tacho calibration'
    case 'lift_inspection':   return 'lift inspection'
    case 'loler_inspection':  return 'LOLER inspection'
    case 'custom':            return 'service'
    default:                  return t || 'service'
  }
}
