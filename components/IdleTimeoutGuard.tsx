'use client'

/**
 * IdleTimeoutGuard
 *
 * Drop-in component. When mounted inside a logged-in layout, it:
 *   1. Fetches the current user's role
 *   2. If the role is in ROLES_TO_TIME_OUT, starts an idle timer
 *   3. After TIMEOUT_MINUTES of inactivity, signs the user out
 *
 * Render-wise it returns null. No visible UI.
 *
 * Settings — change these constants to adjust:
 *   ROLES_TO_TIME_OUT — which roles get auto-logged-out
 *   TIMEOUT_MINUTES   — minutes of inactivity before logout
 */

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useIdleLogout } from '@/lib/useIdleLogout'

const ROLES_TO_TIME_OUT = ['superuser', 'admin', 'manager']
const TIMEOUT_MINUTES = 30

const supabase = createClient()

export default function IdleTimeoutGuard() {
  const [role, setRole] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || cancelled) return
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()
      if (!cancelled && profile?.role) {
        setRole(profile.role)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Hook is safe to call even when role is null — it no-ops in that case.
  useIdleLogout(ROLES_TO_TIME_OUT, role, TIMEOUT_MINUTES)

  return null
}
