'use client'

/**
 * OnCallCard — sits at the top of the driver's Phone Directory page,
 * after PIN unlock. Shows who is on-call right now.
 *
 * Self-contained: fetches its own data once on mount. Renders nothing
 * if the API errors (the directory still works without it). Renders
 * an empty-state card when there are no current slots.
 *
 * Multiple matches: shows them all, primary first (oldest by
 * created_at — handled server-side).
 */

import { useEffect, useState } from 'react'

type Entry = {
  id: string
  name: string
  phone_number: string
  notes: string | null
}

type Slot = {
  id: string
  start_date: string
  end_date: string
  is_all_day: boolean
  start_time: string | null
  end_time: string | null
  notes: string | null
  created_at: string
  phone_directory_entries: Entry | null
}

type ApiShape = {
  current?: Slot[]
  today?: string
  now_hhmm?: string
}

function cleanPhoneForTel(raw: string): string {
  if (!raw) return ''
  const trimmed = raw.trim()
  const plus = trimmed.startsWith('+') ? '+' : ''
  return plus + trimmed.replace(/[^\d]/g, '')
}

export default function OnCallCard() {
  const [data, setData] = useState<ApiShape | null>(null)
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/phone-directory/on-call')
        if (!res.ok) { setErrored(true); return }
        const json = await res.json()
        if (cancelled) return
        setData(json)
      } catch {
        setErrored(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-3">
        <p className="text-sm text-gray-400">Checking on-call rota…</p>
      </div>
    )
  }
  if (errored) return null  // Fail silent — directory still works

  const current = data?.current || []
  // "this morning" / "this afternoon" / "all day" → time-range
  // formatted for the driver. Useful info: "until 21:30" tells them
  // how long this person is still on for.
  const formatActiveLabel = (s: Slot): string => {
    if (s.is_all_day) return 'on call all day'
    if (!s.start_time || !s.end_time) return 'on call'
    const end = s.end_time.slice(0, 5)
    return `on call until ${end}`
  }

  if (current.length === 0) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-3">
        <p className="text-sm font-semibold text-amber-900 mb-1">📋 On Call</p>
        <p className="text-sm text-amber-800">No one is set as on-call right now.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2 mb-3">
      <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold px-1">
        On call right now
      </p>
      {current.map((slot, idx) => {
        const entry = slot.phone_directory_entries
        if (!entry) return null
        const isPrimary = idx === 0
        return (
          <a
            key={slot.id}
            href={`tel:${cleanPhoneForTel(entry.phone_number)}`}
            className={`block rounded-2xl p-4 active:bg-emerald-100 transition border-2 ${
              isPrimary
                ? 'bg-emerald-50 border-emerald-400'
                : 'bg-white border-emerald-200'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-emerald-700 text-xs font-bold uppercase tracking-wide">
                    {isPrimary && current.length > 1 ? 'Primary · ' : ''}
                    {formatActiveLabel(slot)}
                  </span>
                </div>
                <p className="font-bold text-gray-900 text-lg truncate">{entry.name}</p>
                {(slot.notes || entry.notes) && (
                  <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                    {slot.notes || entry.notes}
                  </p>
                )}
              </div>
              <span className="bg-emerald-600 text-white rounded-full px-4 py-2.5 text-sm font-bold flex-shrink-0 shadow-sm">
                📞 Call
              </span>
            </div>
          </a>
        )
      })}
      {current.length > 1 && (
        <p className="text-xs text-gray-500 px-1">
          More than one person is on-call. Try the primary first.
        </p>
      )}
    </div>
  )
}
