'use client'
/**
 * NotificationProvider
 *
 * App-wide in-app notification system:
 *  • Renders a stack of toasts (top-right on desktop, top on mobile)
 *  • Plays a short chime (Web Audio API, no asset bundling)
 *  • Survives page navigation because it lives in the layout
 *
 * Toasts can be pushed from anywhere via the useNotify() hook:
 *   const notify = useNotify()
 *   notify({
 *     title: 'New defect assigned',
 *     body: 'TE12 ST — Brake lights',
 *     href: '/employee/services',
 *     tone: 'urgent',
 *   })
 *
 * Sound preference is stored in localStorage. A toggle on the profile
 * page (separate component) writes the same key.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react'
import { useRouter } from 'next/navigation'

type Tone = 'info' | 'urgent'

export type NotifyPayload = {
  /** Headline text */
  title: string
  /** Optional body / second line */
  body?: string
  /** Optional href — clicking the toast navigates here */
  href?: string
  /** Affects colour + sound shape. Default 'info'. */
  tone?: Tone
  /** ms before auto-dismiss. Default 6000. */
  duration?: number
  /** Suppress the chime for this one toast (still shows the visible toast) */
  silent?: boolean
}

type ActiveToast = NotifyPayload & {
  id: string
  createdAt: number
}

const SOUND_PREF_KEY = 'sls.notifications.sound'

const NotifyContext = createContext<((p: NotifyPayload) => void) | null>(null)

export function useNotify() {
  const fn = useContext(NotifyContext)
  if (!fn) {
    // No provider mounted (e.g. running on /login). Make this a no-op
    // rather than throw so callers don't have to defensively check.
    return () => {}
  }
  return fn
}

/** Read/write the user's sound-on-or-off preference from localStorage. */
export function useSoundPreference() {
  const [enabled, setEnabledState] = useState<boolean>(true)

  useEffect(() => {
    try {
      const v = localStorage.getItem(SOUND_PREF_KEY)
      if (v === '0') setEnabledState(false)
    } catch { /* SSR / no localStorage */ }
  }, [])

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next)
    try {
      localStorage.setItem(SOUND_PREF_KEY, next ? '1' : '0')
    } catch { /* ignore */ }
  }, [])

  return { enabled, setEnabled }
}

export default function NotificationProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [toasts, setToasts] = useState<ActiveToast[]>([])
  const audioCtxRef = useRef<AudioContext | null>(null)
  const audioUnlockedRef = useRef(false)

  // Try to unlock audio on the first user interaction. Browsers refuse
  // to play sound until the user has interacted with the page.
  useEffect(() => {
    const unlock = () => {
      if (audioUnlockedRef.current) return
      try {
        const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
        if (!Ctx) return
        if (!audioCtxRef.current) audioCtxRef.current = new Ctx()
        // Resume suspends-on-creation contexts in some browsers
        if (audioCtxRef.current.state === 'suspended') {
          audioCtxRef.current.resume()
        }
        audioUnlockedRef.current = true
      } catch { /* ignore */ }
    }
    const events: Array<keyof WindowEventMap> = ['click', 'keydown', 'touchstart']
    events.forEach(e => window.addEventListener(e, unlock, { once: true, passive: true }))
    return () => {
      events.forEach(e => window.removeEventListener(e, unlock))
    }
  }, [])

  const playChime = useCallback((tone: Tone) => {
    // Read sound preference fresh — user might have toggled since mount
    let soundOn = true
    try {
      soundOn = localStorage.getItem(SOUND_PREF_KEY) !== '0'
    } catch { /* ignore */ }
    if (!soundOn) return
    if (!audioUnlockedRef.current) return  // Audio still locked
    const ctx = audioCtxRef.current
    if (!ctx) return

    // Two-note chime. Urgent uses a falling minor third, info a rising third.
    const now = ctx.currentTime
    const notes = tone === 'urgent'
      ? [{ f: 880, t: 0 }, { f: 660, t: 0.13 }]
      : [{ f: 660, t: 0 }, { f: 880, t: 0.13 }]

    notes.forEach(({ f, t }) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = f
      // Quick fade in/out so it doesn't click
      gain.gain.setValueAtTime(0, now + t)
      gain.gain.linearRampToValueAtTime(0.18, now + t + 0.01)
      gain.gain.linearRampToValueAtTime(0, now + t + 0.18)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now + t)
      osc.stop(now + t + 0.2)
    })
  }, [])

  const notify = useCallback((payload: NotifyPayload) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const toast: ActiveToast = {
      ...payload,
      tone: payload.tone || 'info',
      duration: payload.duration ?? 6000,
      id,
      createdAt: Date.now(),
    }
    setToasts(prev => {
      const next = [toast, ...prev]
      // Cap at 3 visible
      return next.slice(0, 3)
    })
    if (!payload.silent) {
      playChime(payload.tone || 'info')
    }
    // Auto-dismiss
    if ((toast.duration || 0) > 0) {
      window.setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id))
      }, toast.duration)
    }
  }, [playChime])

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const handleClick = useCallback((t: ActiveToast) => {
    if (t.href) {
      router.push(t.href)
    }
    dismiss(t.id)
  }, [router, dismiss])

  const ctxValue = useMemo(() => notify, [notify])

  return (
    <NotifyContext.Provider value={ctxValue}>
      {children}
      {toasts.length > 0 && (
        <div
          className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-[calc(100vw-2rem)] sm:w-96 pointer-events-none"
          aria-live="polite"
          aria-atomic="false"
        >
          {toasts.map(t => (
            <button
              key={t.id}
              onClick={() => handleClick(t)}
              className={`pointer-events-auto text-left rounded-xl shadow-lg border p-3 transition transform animate-in slide-in-from-top-2 ${
                t.tone === 'urgent'
                  ? 'bg-red-600 text-white border-red-700 hover:bg-red-700'
                  : 'bg-white text-slate-900 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-start gap-2">
                <span className="text-lg flex-shrink-0">{t.tone === 'urgent' ? '🚨' : '🔔'}</span>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${t.tone === 'urgent' ? 'text-white' : 'text-slate-900'}`}>
                    {t.title}
                  </p>
                  {t.body && (
                    <p className={`text-xs mt-0.5 ${t.tone === 'urgent' ? 'text-red-50' : 'text-slate-600'}`}>
                      {t.body}
                    </p>
                  )}
                  {t.href && (
                    <p className={`text-[10px] mt-1 ${t.tone === 'urgent' ? 'text-red-100' : 'text-slate-400'}`}>
                      Tap to open
                    </p>
                  )}
                </div>
                <span
                  onClick={(e) => { e.stopPropagation(); dismiss(t.id) }}
                  className={`text-xs flex-shrink-0 px-1 hover:opacity-100 opacity-60 ${t.tone === 'urgent' ? 'text-white' : 'text-slate-400'}`}
                  role="button"
                  aria-label="Dismiss"
                >
                  ✕
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </NotifyContext.Provider>
  )
}
