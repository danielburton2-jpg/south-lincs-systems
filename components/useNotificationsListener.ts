'use client'
/**
 * useNotificationsListener
 *
 * Subscribes to realtime INSERT events on relevant tables and dispatches
 * in-app toast notifications via the NotificationProvider context.
 *
 * Behaviour by role:
 *
 *   role=admin / manager (mounted in /dashboard layout):
 *     • holiday_requests INSERT (status='pending')   → "New holiday request"
 *     • vehicle_defects INSERT (status='open')       → "New defect logged"
 *
 *   role=user (mounted in /employee layout):
 *     • vehicle_defects (assigned_to=me, INSERT or UPDATE)
 *         → "Defect assigned to you"
 *
 *   role=admin/manager IN /employee (using View Switcher):
 *     • Same as above for assignment notifications, since they may have
 *       defects assigned for testing purposes.
 *
 * "Don't notify me about my own actions" rule — for any event where the
 * current user is the actor (reporter, assigner), we skip.
 */
import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { useNotify } from './NotificationProvider'

const supabase = createClient()

type Role = 'admin' | 'manager' | 'user' | string | null

type Args = {
  /** Current user id, or null if not loaded yet (effect waits) */
  userId: string | null
  /** Current user's company id, or null */
  companyId: string | null
  /** Current user's role */
  role: Role
  /** Where this listener is mounted: 'dashboard' or 'employee'.
   *  Affects which event types we subscribe to. */
  scope: 'dashboard' | 'employee'
}

export function useNotificationsListener({ userId, companyId, role, scope }: Args) {
  const notify = useNotify()
  // The first realtime event after subscribing sometimes echoes existing
  // recent inserts (depends on Supabase behaviour). To avoid notifying
  // about events that happened before we mounted, ignore inserts whose
  // `created_at`/`reported_at` is older than this timestamp.
  const mountedAtRef = useRef<number>(Date.now())

  useEffect(() => {
    if (!userId || !companyId) return
    mountedAtRef.current = Date.now()

    const channel = supabase.channel(`notifications-${scope}-${userId}`)

    // ── Dashboard scope: holiday + new-defect alerts for admins/managers ──
    if (scope === 'dashboard' && (role === 'admin' || role === 'manager')) {
      channel.on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'holiday_requests',
          filter: `company_id=eq.${companyId}`,
        },
        (payload: any) => {
          const row = payload?.new
          if (!row) return
          if (row.status !== 'pending') return
          if (row.user_id === userId) return  // self-action — skip
          // Stale-event guard
          const eventTime = row.created_at ? new Date(row.created_at).getTime() : Date.now()
          if (eventTime < mountedAtRef.current - 5000) return

          notify({
            title: 'New holiday request',
            body: 'A team member has requested time off.',
            href: '/dashboard/holidays',
            tone: 'info',
          })
        }
      )

      channel.on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'vehicle_defects',
          filter: `company_id=eq.${companyId}`,
        },
        (payload: any) => {
          const row = payload?.new
          if (!row) return
          if (row.status !== 'open') return
          if (row.reported_by === userId) return  // self-action — skip
          const eventTime = row.reported_at ? new Date(row.reported_at).getTime() : Date.now()
          if (eventTime < mountedAtRef.current - 5000) return

          // Severity dictates tone — critical/major are urgent
          const sev = row.severity || 'minor'
          const tone = sev === 'critical' || sev === 'major' ? 'urgent' : 'info'
          const body = row.defect_note || row.description || row.item_text || 'A new defect has been logged.'

          notify({
            title: sev === 'critical' ? 'Critical defect logged' : 'New defect logged',
            body: body.length > 80 ? body.slice(0, 77) + '…' : body,
            href: '/dashboard/vehicle-checks/defects',
            tone,
          })
        }
      )
    }

    // ── Employee scope: defect-assigned alert for the assignee ──
    if (scope === 'employee') {
      // Both INSERT (new defect with assigned_to set) and UPDATE
      // (existing defect newly assigned). The filter is server-side so
      // we only get rows where assigned_to is now me.
      channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'vehicle_defects',
          filter: `assigned_to=eq.${userId}`,
        },
        (payload: any) => {
          const row = payload?.new
          if (!row) return
          if (payload.eventType === 'DELETE') return
          // For UPDATE: only notify if assigned_to JUST became me (i.e.
          // it was previously someone else or null). Otherwise an
          // unrelated edit on the same defect would also ding.
          if (payload.eventType === 'UPDATE') {
            const old = payload.old
            if (old?.assigned_to === userId) return  // already assigned to me
          }
          // Don't ding the person who did the assigning if they're also me
          if (row.assigned_by === userId) return
          // Stale-event guard
          const eventTime = row.assigned_at
            ? new Date(row.assigned_at).getTime()
            : (row.reported_at ? new Date(row.reported_at).getTime() : Date.now())
          if (eventTime < mountedAtRef.current - 5000) return

          const sev = row.severity || 'minor'
          const tone = sev === 'critical' || sev === 'major' ? 'urgent' : 'info'
          const body = row.defect_note || row.description || row.item_text || 'A new defect needs attention.'

          notify({
            title: sev === 'critical' ? 'Critical defect assigned' : 'Defect assigned to you',
            body: body.length > 80 ? body.slice(0, 77) + '…' : body,
            href: '/employee/services',
            tone,
          })
        }
      )

      // ── Holiday decided (approved or rejected) ─────────────────
      // Filtered by user_id so only the requester gets the toast.
      // Listens to UPDATE only — the INSERT was already covered by
      // the "submitted" pending state.
      channel.on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'holiday_requests',
          filter: `user_id=eq.${userId}`,
        },
        (payload: any) => {
          const row = payload?.new
          const old = payload?.old
          if (!row || !old) return
          // Only notify when the status JUST flipped to approved/rejected.
          if (old.status === row.status) return
          if (row.status !== 'approved' && row.status !== 'rejected') return
          // Stale-event guard (use updated_at if present, else just now)
          const eventTime = row.updated_at
            ? new Date(row.updated_at).getTime()
            : Date.now()
          if (eventTime < mountedAtRef.current - 5000) return

          const dateRange = row.start_date === row.end_date
            ? formatShortDate(row.start_date)
            : `${formatShortDate(row.start_date)} – ${formatShortDate(row.end_date)}`

          notify({
            title: row.status === 'approved' ? '✅ Holiday approved' : '❌ Holiday rejected',
            body: dateRange,
            href: '/employee/holidays',
            tone: 'info',
          })
        }
      )

      // ── Service assigned to me (mechanic) ──────────────────────
      channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'service_schedules',
          filter: `assigned_to=eq.${userId}`,
        },
        (payload: any) => {
          const row = payload?.new
          if (!row || payload.eventType === 'DELETE') return
          if (payload.eventType === 'UPDATE') {
            const old = payload.old
            if (old?.assigned_to === userId) return  // not a new assignment
          }
          if (row.assigned_by === userId) return  // self-action
          const eventTime = row.assigned_at
            ? new Date(row.assigned_at).getTime()
            : Date.now()
          if (eventTime < mountedAtRef.current - 5000) return

          notify({
            title: 'New service assigned',
            body: 'Open the app to see the details.',
            href: '/employee/services',
            tone: 'info',
          })
        }
      )

      // ── Schedule assigned/changed for me ───────────────────────
      // schedule_assignments rows linking a user to a shift. INSERT or
      // UPDATE both worth notifying — admins might shift the time later.
      channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'schedule_assignments',
          filter: `user_id=eq.${userId}`,
        },
        (payload: any) => {
          if (payload.eventType === 'DELETE') return
          const row = payload?.new
          if (!row) return
          // Stale-event guard — schedule_assignments may not have a
          // timestamp on it directly. Fall back to "now" + a small grace.
          const eventTime = row.created_at
            ? new Date(row.created_at).getTime()
            : Date.now()
          if (eventTime < mountedAtRef.current - 5000) return

          notify({
            title: payload.eventType === 'INSERT' ? 'Shift scheduled' : 'Shift updated',
            body: 'Check your schedule for the details.',
            href: '/employee/schedules',
            tone: 'info',
          })
        }
      )
    }

    // ── Messages — fires for ALL roles in BOTH scopes ──────────
    // RLS gates which message rows realtime will deliver to this user
    // (only threads they're a member of, including live job_title /
    // all_company membership). So we don't need to filter again here.
    //
    // We DO need to:
    //  • skip messages I sent myself
    //  • look up sender name (not in realtime payload)
    //  • use the right URL prefix based on my role
    channel.on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
      },
      async (payload: any) => {
        const m = payload?.new
        if (!m) return
        if (m.sender_id === userId) return  // self-action

        // Stale-event guard
        const eventTime = m.created_at ? new Date(m.created_at).getTime() : Date.now()
        if (eventTime < mountedAtRef.current - 5000) return

        // Don't double-toast if the user is currently looking at this thread.
        // ThreadView marks-as-read on a debounce; the new message will appear
        // inline. Detect by checking the URL.
        if (typeof window !== 'undefined') {
          const path = window.location.pathname
          if (path.includes(`/messages/${m.thread_id}`)) return
        }

        // Look up sender name + thread context + my mute state.
        // Three cheap parallel queries.
        const [senderRes, threadRes, muteRes] = await Promise.all([
          supabase.from('profiles').select('full_name').eq('id', m.sender_id).single(),
          supabase.from('message_threads').select('id, target_kind, target_job_title, title').eq('id', m.thread_id).single(),
          supabase.from('message_thread_mutes').select('thread_id').eq('thread_id', m.thread_id).eq('user_id', userId).maybeSingle(),
        ])

        // Muted threads — skip the toast. Lock-screen pushes are
        // also suppressed server-side in /api/notify-event.
        if (muteRes.data) return

        const senderName = (senderRes.data as any)?.full_name || 'Someone'
        const thread = threadRes.data as any
        const isGroup = thread?.target_kind && thread.target_kind !== 'user_list'
        const groupLabel = thread?.title || (
          thread?.target_kind === 'all_company' ? 'Everyone' : (thread?.target_job_title || 'Group')
        )

        const title = isGroup ? `${senderName} · ${groupLabel}` : senderName
        const body = (m.body || '[attachment]').toString()
        const trimmed = body.length > 80 ? body.slice(0, 79) + '…' : body

        const href = scope === 'employee'
          ? `/employee/messages/${m.thread_id}`
          : `/dashboard/messages/${m.thread_id}`

        notify({
          title,
          body: trimmed,
          href,
          tone: 'info',
        })
      }
    )

    channel.subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userId, companyId, role, scope, notify])
}

/** Shorthand date formatter — "02 May" — used in toast bodies. */
function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}
