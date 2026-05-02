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
