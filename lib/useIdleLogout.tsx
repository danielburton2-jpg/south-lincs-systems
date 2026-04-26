'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

const supabase = createClient()

const INACTIVE_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
const WARNING_BEFORE_MS = 60 * 1000 // 1 minute warning

export function useIdleLogout(enabled: boolean = true) {
  const [showWarning, setShowWarning] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(60)
  const router = useRouter()

  const warningTimerRef = useRef<NodeJS.Timeout | null>(null)
  const logoutTimerRef = useRef<NodeJS.Timeout | null>(null)
  const countdownRef = useRef<NodeJS.Timeout | null>(null)
  const showWarningRef = useRef(false)
  const isLoggingOutRef = useRef(false)

  const performLogout = useCallback(async () => {
    if (isLoggingOutRef.current) return
    isLoggingOutRef.current = true

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('email, role')
          .eq('id', user.id)
          .single()

        await fetch('/api/audit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: user.id,
            user_email: profile?.email,
            user_role: profile?.role,
            action: 'LOGOUT_IDLE',
            entity: 'auth',
            details: { reason: 'inactive_5_minutes' },
          }),
        })
      }
    } catch (e) {
      console.error('Idle logout audit failed:', e)
    }

    await supabase.auth.signOut()
    router.push('/login')
  }, [router])

  const clearAllTimers = useCallback(() => {
    if (warningTimerRef.current) {
      clearTimeout(warningTimerRef.current)
      warningTimerRef.current = null
    }
    if (logoutTimerRef.current) {
      clearTimeout(logoutTimerRef.current)
      logoutTimerRef.current = null
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current)
      countdownRef.current = null
    }
  }, [])

  const startWarningCountdown = useCallback(() => {
    setShowWarning(true)
    showWarningRef.current = true
    setSecondsLeft(60)

    countdownRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          if (countdownRef.current) {
            clearInterval(countdownRef.current)
            countdownRef.current = null
          }
          return 0
        }
        return prev - 1
      })
    }, 1000)

    logoutTimerRef.current = setTimeout(() => {
      performLogout()
    }, WARNING_BEFORE_MS)
  }, [performLogout])

  const resetTimers = useCallback(() => {
    clearAllTimers()
    setShowWarning(false)
    showWarningRef.current = false
    setSecondsLeft(60)

    warningTimerRef.current = setTimeout(() => {
      startWarningCountdown()
    }, INACTIVE_TIMEOUT_MS - WARNING_BEFORE_MS)
  }, [clearAllTimers, startWarningCountdown])

  const stayLoggedIn = useCallback(() => {
    resetTimers()
  }, [resetTimers])

  useEffect(() => {
    if (!enabled) return

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click', 'mousemove']

    const handleActivity = () => {
      // Don't reset if warning is showing — user must click Stay Signed In
      if (showWarningRef.current) return
      resetTimers()
    }

    // Tab close / browser close → sign out
    const handleBeforeUnload = () => {
      // Use sendBeacon-style approach: fire-and-forget signOut
      // signOut() removes the session from localStorage
      try {
        supabase.auth.signOut()
      } catch (e) {
        // ignore
      }
    }

    // Tab hidden for an extended period → eligible for logout
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // Don't actively log out, but don't suppress idle either
      } else if (document.visibilityState === 'visible') {
        // When user comes back, treat it as activity
        if (!showWarningRef.current) resetTimers()
      }
    }

    events.forEach(event => {
      window.addEventListener(event, handleActivity, { passive: true })
    })
    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    resetTimers()

    return () => {
      events.forEach(event => {
        window.removeEventListener(event, handleActivity)
      })
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      clearAllTimers()
    }
    // IMPORTANT: do NOT include showWarning here — it caused the bug.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  return { showWarning, secondsLeft, stayLoggedIn }
}

export function IdleWarningModal({
  show,
  secondsLeft,
  onStay,
}: {
  show: boolean
  secondsLeft: number
  onStay: () => void
}) {
  if (!show) return null

  return (
    <div className="fixed inset-0 bg-black/60 z-[9999] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full">
        <div className="text-center">
          <div className="text-5xl mb-4">⏰</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">
            Are you still there?
          </h2>
          <p className="text-gray-600 mb-2">
            For your security, you&apos;ll be signed out in
          </p>
          <p className="text-4xl font-bold text-orange-600 mb-6">
            {secondsLeft}s
          </p>
          <button
            onClick={onStay}
            className="w-full bg-blue-600 text-white py-3 rounded-xl font-medium hover:bg-blue-700 transition"
          >
            Stay Signed In
          </button>
        </div>
      </div>
    </div>
  )
}