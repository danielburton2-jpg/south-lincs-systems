'use client'

/**
 * useIdleLogout
 *
 * Signs the user out after a period of inactivity.
 *
 * "Activity" = mousedown, mousemove, keydown, scroll, touchstart, click.
 * Any of those resets the timer. If the timer hits zero — sign out
 * silently and full-page navigate to /login.
 *
 * The hook is a no-op unless `currentRole` is in `activeForRoles`.
 * This means employees (whose role isn't in the list) never get
 * auto-logged-out — useful for a fleet driver's phone where the
 * screen sleeps frequently.
 *
 * Implementation notes:
 *   • The redirect uses window.location.href (full reload), not
 *     router.push — last time we used a soft router push and ended
 *     up with stale cookies in a redirect loop. Full reload guarantees
 *     the new request goes through middleware with cleared cookies.
 *   • We don't use a warning popup. Spec says silent logout.
 */

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase'

const ACTIVITY_EVENTS: (keyof DocumentEventMap)[] = [
  'mousedown',
  'mousemove',
  'keydown',
  'scroll',
  'touchstart',
  'click',
]

const supabase = createClient()

export function useIdleLogout(
  activeForRoles: string[],
  currentRole: string | null | undefined,
  timeoutMinutes: number = 30,
) {
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    // Only activate for the configured roles. If the current role
    // isn't in the list (or hasn't loaded yet), do nothing.
    if (!currentRole || !activeForRoles.includes(currentRole)) {
      return
    }

    const timeoutMs = timeoutMinutes * 60 * 1000

    const handleLogout = async () => {
      try {
        await supabase.auth.signOut()
      } catch {
        // Sign-out can fail if the session is already gone; that's fine.
      }
      // Full-page navigation, not router.push. This guarantees the
      // browser sends a fresh request with the cleared cookies, so
      // middleware sees you as logged out.
      if (typeof window !== 'undefined') {
        window.location.href = '/login'
      }
    }

    const resetTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
      }
      timerRef.current = window.setTimeout(handleLogout, timeoutMs)
    }

    // Start the timer on mount.
    resetTimer()

    // Attach activity listeners. `passive: true` keeps scrolling smooth.
    ACTIVITY_EVENTS.forEach(evt => {
      document.addEventListener(evt, resetTimer, { passive: true })
    })

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      ACTIVITY_EVENTS.forEach(evt => {
        document.removeEventListener(evt, resetTimer)
      })
    }
  }, [activeForRoles, currentRole, timeoutMinutes])
}
