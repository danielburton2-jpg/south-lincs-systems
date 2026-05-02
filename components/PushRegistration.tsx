'use client'
/**
 * PushRegistration
 *
 * UI for enabling/disabling phone push notifications on the employee
 * profile page. Drivers/mechanics only.
 *
 * Behaviour:
 *   • Detects whether the browser supports the Push API at all
 *   • Detects iOS Safari NOT in standalone mode → shows "Add to Home
 *     Screen" instructions instead of an Enable button (Apple require
 *     PWA install before push works)
 *   • Detects current permission state on mount + after enable
 *   • Registers the service worker, asks permission, subscribes,
 *     and posts the subscription to /api/push-subscribe
 *   • Disable: unsubscribes locally + tells the API to deactivate
 */
import { useEffect, useState } from 'react'

type Props = {
  /** Public VAPID key (URL-safe base64). Pass from server-side env. */
  vapidPublicKey: string | null
}

type State =
  | 'loading'
  | 'unsupported'        // browser has no Push API
  | 'ios-needs-install'  // Safari, not standalone
  | 'denied'             // user has actively blocked
  | 'inactive'           // permission default — show Enable button
  | 'active'             // subscribed and pushing

export default function PushRegistration({ vapidPublicKey }: Props) {
  const [state, setState] = useState<State>('loading')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    detectInitialState().then(setState)
  }, [])

  const handleEnable = async () => {
    if (!vapidPublicKey) {
      setMessage('Push not configured on the server. Contact support.')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      // Register the SW
      const reg = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready

      // Ask permission
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') {
        setState(perm === 'denied' ? 'denied' : 'inactive')
        return
      }

      // Subscribe
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      })

      const json = sub.toJSON() as any
      const res = await fetch('/api/push-subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: json.keys,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setMessage(err.error || 'Could not save subscription')
        return
      }

      setState('active')
      setMessage('Phone notifications enabled.')
    } catch (err: any) {
      console.error(err)
      setMessage('Could not enable: ' + (err?.message || 'unknown error'))
    } finally {
      setBusy(false)
    }
  }

  const handleDisable = async () => {
    setBusy(true)
    setMessage('')
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        const endpoint = sub.endpoint
        await sub.unsubscribe()
        await fetch('/api/push-unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint }),
        })
      }
      setState('inactive')
      setMessage('Phone notifications disabled.')
    } catch (err: any) {
      setMessage('Could not disable: ' + (err?.message || 'unknown'))
    } finally {
      setBusy(false)
    }
  }

  // ──────────────────────── render ────────────────────────
  if (state === 'loading') {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
        <p className="text-sm text-slate-400 italic">Checking notifications…</p>
      </div>
    )
  }

  if (state === 'unsupported') {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
        <p className="font-semibold text-slate-800 text-sm flex items-center gap-2">
          📵 Phone notifications
        </p>
        <p className="text-xs text-slate-500 mt-1">
          Your browser doesn&apos;t support push notifications. Try Chrome on Android
          or install this site to your home screen on iPhone.
        </p>
      </div>
    )
  }

  if (state === 'ios-needs-install') {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
        <p className="font-semibold text-slate-800 text-sm flex items-center gap-2">
          📲 Phone notifications — install first
        </p>
        <p className="text-xs text-slate-600 mt-2 leading-relaxed">
          On iPhone, you need to add this site to your home screen first:
        </p>
        <ol className="text-xs text-slate-600 mt-2 space-y-1 list-decimal list-inside leading-relaxed">
          <li>Tap the Share button <span className="text-base align-middle">⬆️</span> at the bottom of Safari</li>
          <li>Scroll down and tap <strong>Add to Home Screen</strong></li>
          <li>Tap <strong>Add</strong> in the top right</li>
          <li>Open the app from your home screen, come back to this page, and tap Enable</li>
        </ol>
      </div>
    )
  }

  if (state === 'denied') {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
        <p className="font-semibold text-slate-800 text-sm flex items-center gap-2">
          📵 Phone notifications blocked
        </p>
        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
          You&apos;ve blocked notifications for this site. To re-enable,
          go into your browser&apos;s site settings (the padlock icon in
          the address bar) and allow notifications.
        </p>
      </div>
    )
  }

  if (state === 'active') {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-slate-800 text-sm flex items-center gap-2">
              📲 Phone notifications: ON
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              You&apos;ll get pinged on your phone for assignments, holiday decisions, and shift updates.
            </p>
          </div>
          <button
            type="button"
            onClick={handleDisable}
            disabled={busy}
            className="text-xs font-medium text-slate-600 hover:text-slate-800 px-3 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 disabled:opacity-50 flex-shrink-0"
          >
            Turn off
          </button>
        </div>
        {message && <p className="text-xs text-slate-500 mt-2">{message}</p>}
      </div>
    )
  }

  // inactive
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
      <p className="font-semibold text-slate-800 text-sm flex items-center gap-2">
        📲 Phone notifications
      </p>
      <p className="text-xs text-slate-500 mt-1 mb-3 leading-relaxed">
        Get pinged on your phone (with sound + lock-screen notification) when
        you&apos;re assigned a job, when a holiday request is decided, or when
        your schedule changes.
      </p>
      <button
        type="button"
        onClick={handleEnable}
        disabled={busy}
        className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm px-4 py-2.5 rounded-lg disabled:opacity-50"
      >
        {busy ? 'Enabling…' : 'Enable phone notifications'}
      </button>
      {message && <p className="text-xs text-slate-500 mt-2">{message}</p>}
    </div>
  )
}

// ────────────────────── helpers ──────────────────────

async function detectInitialState(): Promise<State> {
  // Server-side / no DOM
  if (typeof window === 'undefined') return 'loading'

  // No Push API at all
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    // Could be iOS Safari, where the API IS there but only in standalone mode
    if (isIosSafari() && !isStandalone()) return 'ios-needs-install'
    return 'unsupported'
  }

  // iOS Safari outside PWA still doesn't actually deliver pushes
  if (isIosSafari() && !isStandalone()) return 'ios-needs-install'

  if (Notification.permission === 'denied') return 'denied'

  // Check whether we have an active subscription
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    if (sub) return 'active'
  } catch { /* ignore */ }

  return 'inactive'
}

function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // iPad on iPadOS 13+ identifies as Mac in some cases — also check touch points
  const iOS = /iPad|iPhone|iPod/.test(ua) ||
              (navigator.platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1)
  if (!iOS) return false
  const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua)
  return isSafari
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  // iOS Safari uses navigator.standalone; Android Chrome uses display-mode media query
  // The user might have installed the PWA via either mechanism
  // (or not, in which case standalone is false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((navigator as any).standalone === true) return true
  if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true
  return false
}

/** Convert URL-safe base64 VAPID key to Uint8Array as the API expects. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}
