'use client'

/**
 * Banner shown to admins when there are unresolved
 * phone_directory_alerts (15+ wrong PIN attempts on a user account).
 *
 * Used on /dashboard (home) AND /dashboard/phone-directory.
 *
 * Self-contained: fetches its own data, fail-silent if the user is
 * not admin or the API errors. Returns null when there's nothing to
 * show, so it can be dropped in anywhere without conditional render
 * gymnastics.
 *
 * Each alert: text + Dismiss button + Reset PIN button (links to
 * the admin Phone Directory page where reset lives).
 */

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

type Alert = {
  id: string
  user_id: string
  user_name: string | null
  failed_count: number
  raised_at: string
}

type Props = {
  /** When true, includes a "Reset PIN for this user" button next to
   *  Dismiss. False on the home banner (just dismisses; admin clicks
   *  through to the Phone Directory page if they want to reset). */
  showResetButton?: boolean
}

export default function PhoneDirectoryAlertBanner({ showResetButton = false }: Props) {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/phone-directory/list-alerts')
      if (!res.ok) return
      const data = await res.json()
      setAlerts(data.alerts || [])
    } catch {
      // fail-silent — banner just doesn't show
    }
  }, [])

  useEffect(() => { load() }, [load])

  const dismiss = async (alertId: string) => {
    setBusyId(alertId)
    try {
      const res = await fetch('/api/phone-directory/dismiss-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alert_id: alertId }),
      })
      if (res.ok) {
        setAlerts(prev => prev.filter(a => a.id !== alertId))
      }
    } finally {
      setBusyId(null)
    }
  }

  const resetCode = async (userId: string, alertId: string) => {
    if (!confirm('Reset this user\'s PIN? They will be asked to set a new one on next access.')) return
    setBusyId(alertId)
    try {
      const res = await fetch('/api/phone-directory/admin-reset-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      })
      if (res.ok) {
        // The reset API also dismisses any active alerts for that user
        setAlerts(prev => prev.filter(a => a.user_id !== userId))
      } else {
        const data = await res.json().catch(() => ({}))
        alert(data?.error || 'Reset failed')
      }
    } finally {
      setBusyId(null)
    }
  }

  if (alerts.length === 0) return null

  return (
    <div className="mt-4 bg-amber-50 border border-amber-300 rounded-xl p-4">
      <p className="text-amber-900 font-semibold mb-2">
        ⚠️ Phone Directory: too many wrong PIN attempts
      </p>
      <ul className="space-y-2">
        {alerts.map(a => {
          const when = new Date(a.raised_at).toLocaleString('en-GB', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
          })
          const name = a.user_name || '(user removed)'
          return (
            <li key={a.id} className="flex items-center justify-between gap-2 flex-wrap text-sm">
              <span className="text-amber-900">
                <strong>{name}</strong> — {a.failed_count} failed attempts (raised {when})
              </span>
              <span className="flex gap-2 flex-shrink-0">
                {showResetButton && (
                  <button
                    type="button"
                    onClick={() => resetCode(a.user_id, a.id)}
                    disabled={busyId === a.id}
                    className="px-3 py-1 text-xs font-medium rounded bg-white border border-amber-400 text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                  >
                    Reset PIN
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => dismiss(a.id)}
                  disabled={busyId === a.id}
                  className="px-3 py-1 text-xs font-medium rounded bg-white border border-amber-400 text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                >
                  Dismiss
                </button>
              </span>
            </li>
          )
        })}
      </ul>
      {!showResetButton && (
        <p className="text-xs text-amber-800 mt-2">
          To reset a user&apos;s PIN, go to{' '}
          <Link href="/dashboard/phone-directory" className="underline font-medium">
            Phone Directory
          </Link>
          .
        </p>
      )}
    </div>
  )
}
