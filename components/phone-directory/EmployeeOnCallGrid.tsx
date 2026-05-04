'use client'

/**
 * EmployeeOnCallGrid — driver-side read-only on-call rota.
 *
 * Same shape as the admin's SlotsGrid (rows = unique time-ranges,
 * columns = 7 days, cells = name pills) but:
 *
 *   - Names are tap-to-call (wrapped in <a href="tel:…">). Phone
 *     numbers themselves are never displayed — same rule as
 *     everywhere else on the on-call surfaces.
 *   - No edit affordance. No delete. No add form.
 *   - Slots that are active RIGHT NOW get a subtle green ring so
 *     drivers can spot the current rota at a glance.
 *
 * Week navigator at the top with arrows + Today button. Both
 * directions unlimited (drivers might genuinely want to look back
 * at "who was on call last Friday").
 *
 * --------------------------------------------------------------
 * NOTE on duplication: most of the helper logic (datesCoveredBy,
 * groupSlotsByTimeRange, mondayOf, etc.) is duplicated from
 * components/phone-directory/OnCallManager.tsx. The two components
 * are cousins — admin grid is editable, this one is read-only with
 * tap-to-call. A future refactor could extract a shared
 * <OnCallGrid> primitive that both consume. For now: copy-and-trim,
 * with this comment so the duplication is visible.
 * --------------------------------------------------------------
 */

import { useEffect, useState } from 'react'

type Entry = {
  id: string
  name: string
  phone_number: string  // present in the data; ONLY used in tel: hrefs
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
  slots?: Slot[]
  current?: Slot[]
  today?: string
  now_hhmm?: string
}

// ── Helpers (copy-and-trim from OnCallManager) ─────────────────────
const isoDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const mondayOf = (d: Date): Date => {
  const wd = d.getDay()
  const offset = wd === 0 ? 6 : wd - 1
  const m = new Date(d)
  m.setDate(m.getDate() - offset)
  m.setHours(0, 0, 0, 0)
  return m
}

const formatDayLabel = (d: Date): string =>
  d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

const formatWeekRange = (start: Date, end: Date): string => {
  const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return `${fmt(start)} – ${fmt(end)}`
}

const trimSeconds = (t: string | null) => (t ? t.slice(0, 5) : '')

const formatTimeRange = (s: Slot): string => {
  if (s.is_all_day) return 'All day'
  const start = trimSeconds(s.start_time)
  const end = trimSeconds(s.end_time)
  if (!start || !end) return ''
  const overnight = start > end
  return `${start}–${end}${overnight ? ' (overnight)' : ''}`
}

const thisWeekMondayIso = (): string => isoDate(mondayOf(new Date()))

function cleanPhoneForTel(raw: string): string {
  if (!raw) return ''
  const trimmed = raw.trim()
  const plus = trimmed.startsWith('+') ? '+' : ''
  return plus + trimmed.replace(/[^\d]/g, '')
}

// Returns the set of ISO dates a slot "covers". Cross-midnight slots
// also include the next morning's date.
function datesCoveredBy(s: Slot): string[] {
  const out: string[] = []
  const start = new Date(s.start_date + 'T00:00:00')
  const end = new Date(s.end_date + 'T00:00:00')
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    out.push(isoDate(d))
  }
  if (!s.is_all_day && s.start_time && s.end_time) {
    const startMin = Number(s.start_time.slice(0, 2)) * 60 + Number(s.start_time.slice(3, 5))
    const endMin = Number(s.end_time.slice(0, 2)) * 60 + Number(s.end_time.slice(3, 5))
    if (startMin > endMin) {
      const extra = new Date(end)
      extra.setDate(extra.getDate() + 1)
      out.push(isoDate(extra))
    }
  }
  return out
}

function groupSlotsByTimeRange(slots: Slot[]): Map<string, Slot[]> {
  const out = new Map<string, Slot[]>()
  for (const s of slots) {
    const key = formatTimeRange(s) || '(unset)'
    const arr = out.get(key) || []
    arr.push(s)
    out.set(key, arr)
  }
  return out
}

// ── Week navigator ─────────────────────────────────────────────────
type NavProps = {
  mondayIso: string
  rangeLabel: string
  onStep: (delta: number) => void
  onJumpToToday: () => void
}

function WeekNav({ mondayIso, rangeLabel, onStep, onJumpToToday }: NavProps) {
  const showToday = mondayIso !== thisWeekMondayIso()
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onStep(-1)}
        aria-label="Previous week"
        className="w-8 h-8 flex items-center justify-center rounded border border-gray-300 bg-white text-gray-700 active:bg-gray-100"
      >
        ‹
      </button>
      <span className="text-xs text-gray-700 min-w-[8.5rem] text-center">
        Week of {rangeLabel}
      </span>
      <button
        type="button"
        onClick={() => onStep(1)}
        aria-label="Next week"
        className="w-8 h-8 flex items-center justify-center rounded border border-gray-300 bg-white text-gray-700 active:bg-gray-100"
      >
        ›
      </button>
      {showToday && (
        <button
          type="button"
          onClick={onJumpToToday}
          className="h-8 px-2 rounded border border-gray-300 bg-white text-gray-700 text-xs font-medium active:bg-gray-100"
        >
          Today
        </button>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────
export default function EmployeeOnCallGrid() {
  const [slots, setSlots] = useState<Slot[]>([])
  const [currentIds, setCurrentIds] = useState<Set<string>>(new Set())
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')

  const [gridMonday, setGridMonday] = useState<string>(thisWeekMondayIso())

  const stepGridWeek = (delta: number) => {
    const cur = new Date(gridMonday + 'T00:00:00')
    cur.setDate(cur.getDate() + delta * 7)
    setGridMonday(isoDate(cur))
  }
  const jumpGridWeekToToday = () => setGridMonday(thisWeekMondayIso())

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/phone-directory/on-call')
        const data: ApiShape = await res.json()
        if (cancelled) return
        if (!res.ok) {
          // The PIN gate on the parent directory page should have
          // unlocked the cookie before mounting us. If we still get
          // 403, something's off — show a quiet fallback rather
          // than a scary error.
          setError('Could not load on-call rota')
          setLoaded(true)
          return
        }
        setSlots(data.slots || [])
        setCurrentIds(new Set((data.current || []).map(s => s.id)))
        setLoaded(true)
      } catch {
        if (!cancelled) {
          setError('Could not load on-call rota')
          setLoaded(true)
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Compute the visible week
  const days = Array.from({ length: 7 }).map((_, i) => {
    const baseMonday = new Date(gridMonday + 'T00:00:00')
    const d = new Date(baseMonday)
    d.setDate(d.getDate() + i)
    const todayMidnight = new Date()
    todayMidnight.setHours(0, 0, 0, 0)
    return {
      iso: isoDate(d),
      label: formatDayLabel(d),
      isPast: d < todayMidnight,
      isToday: isoDate(d) === isoDate(new Date()),
    }
  })
  const dayIsoSet = new Set(days.map(d => d.iso))

  const visibleSlots = slots.filter(s =>
    datesCoveredBy(s).some(iso => dayIsoSet.has(iso))
  )

  const grouped = groupSlotsByTimeRange(visibleSlots)
  const rows = Array.from(grouped.entries())
    .map(([label, ss]) => {
      const sample = ss[0]
      const sortKey = sample.is_all_day ? '99:99' : (sample.start_time || '99:99')
      return { label, slots: ss, sortKey }
    })
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))

  const slotsAt = (iso: string, label: string): Slot[] => {
    const group = grouped.get(label) || []
    return group.filter(s => datesCoveredBy(s).includes(iso))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
  }

  if (!loaded) {
    return (
      <section className="bg-white rounded-2xl border border-gray-200 p-4 mb-3">
        <p className="text-sm text-gray-400 italic">Loading on-call rota…</p>
      </section>
    )
  }

  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-4 mb-3">
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <h2 className="text-sm font-semibold text-gray-800">On-call rota</h2>
        <WeekNav
          mondayIso={gridMonday}
          rangeLabel={formatWeekRange(
            new Date(days[0].iso + 'T00:00:00'),
            new Date(days[6].iso + 'T00:00:00'),
          )}
          onStep={stepGridWeek}
          onJumpToToday={jumpGridWeekToToday}
        />
      </div>

      {error && (
        <p className="text-xs text-red-600 mb-2">{error}</p>
      )}

      {visibleSlots.length === 0 ? (
        <p className="text-sm text-gray-400 italic py-4 text-center">
          No-one scheduled for this week.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border-b border-gray-200 p-2 text-left text-xs font-medium text-gray-600 bg-gray-50 w-24">
                  Time
                </th>
                {days.map(d => {
                  const [weekday, datePart1, datePart2] = d.label.split(' ')
                  return (
                    <th
                      key={d.iso}
                      className={`border-b border-gray-200 p-2 text-center text-xs font-medium ${
                        d.isPast
                          ? 'text-gray-400 bg-gray-50'
                          : d.isToday
                            ? 'text-emerald-800 bg-emerald-50'
                            : 'text-gray-700 bg-gray-50'
                      }`}
                    >
                      <div>{weekday}</div>
                      <div className="text-[10px] font-normal mt-0.5">{datePart1} {datePart2}</div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.label}>
                  <td className="border-b border-gray-100 p-2 text-xs text-gray-700 bg-gray-50 align-top">
                    {row.label}
                  </td>
                  {days.map(d => {
                    const cellSlots = slotsAt(d.iso, row.label)
                    return (
                      <td
                        key={d.iso}
                        className={`border-b border-l border-gray-100 p-1 align-top ${
                          d.isPast ? 'bg-gray-50' : d.isToday ? 'bg-emerald-50/30' : ''
                        }`}
                      >
                        {cellSlots.length === 0 ? (
                          <div className="h-6" />
                        ) : (
                          <div className="space-y-1">
                            {cellSlots.map(s => {
                              const entry = s.phone_directory_entries
                              const isActiveNow = currentIds.has(s.id)
                              if (!entry) {
                                return (
                                  <div
                                    key={s.id}
                                    className="block w-full text-left text-xs px-2 py-1 rounded bg-gray-100 text-gray-400 truncate"
                                  >
                                    (deleted)
                                  </div>
                                )
                              }
                              const phone = cleanPhoneForTel(entry.phone_number)
                              return (
                                <a
                                  key={s.id}
                                  href={phone ? `tel:${phone}` : undefined}
                                  className={`block w-full text-left text-xs px-2 py-1 rounded truncate active:bg-blue-200 ${
                                    isActiveNow
                                      ? 'bg-emerald-100 text-emerald-900 font-semibold ring-1 ring-emerald-400'
                                      : 'bg-blue-50 text-blue-800'
                                  }`}
                                  title={`Call ${entry.name}`}
                                >
                                  {entry.name}
                                </a>
                              )
                            })}
                          </div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[10px] text-gray-500 mt-2">
        Tap any name to call. Names with a green outline are on call right now.
      </p>
    </section>
  )
}
