'use client'

/**
 * IdleTimeoutGuard
 *
 * Drop this inside a layout that should auto-log-out idle users.
 *
 * Pass `role` from the layout — the layout already does the
 * server-side auth fetch, so we don't need a second client-side
 * `auth.getUser()` here. Avoiding that call also avoids the Supabase
 * auth-token lock contention that fires when multiple components
 * call `auth.getUser()` in parallel:
 *
 *     Lock "lock:sb-...-auth-token" was released because another request stole it
 *
 * That error wasn't dangerous (auth eventually settled) but Next.js
 * surfaces it as a runtime error overlay in dev. The fix is simply not
 * to do the client-side fetch in the first place — the role is already
 * known from the server-rendered layout.
 *
 * Renders nothing visible.
 *
 * Usage in a layout:
 *
 *   <IdleTimeoutGuard role={profile.role} />
 */

import { useIdleLogout } from '@/lib/useIdleLogout'

// Roles that should be auto-logged-out after inactivity.
const ROLES_TO_TIME_OUT = ['superuser', 'admin', 'manager']

// Inactivity threshold in minutes
const TIMEOUT_MINUTES = 60

type Props = {
  /** The current user's role, as known from the server-rendered layout. */
  role?: string | null
}

export default function IdleTimeoutGuard({ role = null }: Props) {
  // The hook only attaches listeners if `role` is one of the configured
  // roles. Drivers (role='user') get no idle timeout — they're often
  // out on the road and shouldn't be silently logged out.
  useIdleLogout(ROLES_TO_TIME_OUT, role, TIMEOUT_MINUTES)
  return null
}
