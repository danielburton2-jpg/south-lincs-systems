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
    }

    channel.subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userId, companyId, role, scope, notify])
}
