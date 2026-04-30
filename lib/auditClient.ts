'use client'

/**
 * Client-side helper for posting audit log events.
 * Wraps the existing /api/audit endpoint so pages don't all repeat the same fetch.
 *
 * Use this from client components (pages with 'use client' at the top).
 * For server-side / API route audit, keep using `logAudit` from '@/lib/audit'.
 *
 * Usage:
 *   await logAuditClient({
 *     user: currentUser,                      // { id, email, role }
 *     action: 'SCHEDULE_CREATED',             // any string
 *     entity: 'schedule',                     // optional, e.g. 'schedule', 'user'
 *     entity_id: schedule.id,                 // optional, the row's id
 *     details: { name: schedule.name },       // optional, free-form JSON
 *   })
 *
 * Audit failures are swallowed — they should never block the user's action.
 */
export async function logAuditClient({
  user,
  action,
  entity,
  entity_id,
  details,
}: {
  user: { id?: string; email?: string; role?: string } | null
  action: string
  entity?: string
  entity_id?: string
  details?: Record<string, any>
}) {
  if (!user) return

  try {
    await fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: user.id,
        user_email: user.email,
        user_role: user.role,
        action,
        entity,
        entity_id,
        details,
      }),
    })
  } catch (err) {
    // Don't fail the user's action if audit fails
    console.error('Audit log failed:', err)
  }
}
