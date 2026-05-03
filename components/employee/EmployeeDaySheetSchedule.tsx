'use client'

/**
 * Driver-side day-sheet view. Mirrors the shape of the shift-patterns
 * /employee/schedules page so drivers get a familiar interface, with
 * day-sheet data underneath instead of schedule_assignments.
 *
 * Key differences from the shift-patterns view (driven by data shape,
 * not by UI choice):
 *   - Multiple day sheets per day (a driver might have several jobs
 *     in one day). The day card lists each as a tappable button.
 *   - Per-day vehicle + day-notes (from driver_day_assignments).
 *     Surfaced as a banner ABOVE the list of jobs in the day card.
 *
 * Scope of v1 (deliberately):
 *   - Personal view only — "My Day Sheets". No "Everyone" mode.
 *   - No realtime subscription. Drivers refresh manually.
 *   - Holidays and bank holidays are NOT overlaid yet. Day-sheet
 *     mode is initially being deployed without that overlay; if
 *     you want it, lift from the shift-patterns page.
 *
 * Visible window: today + next 7 days. Compatible with the existing
 * blue-gradient header / nav / Today button conventions.
 *
 * Route: /employee/schedules (the shared route — branches by company
 * schedules_mode at the page level).
 */

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

const supabase = createClient()

// ── Helpers (mirror the schedules page) ────────────────────────────
const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const addDays = (d: Date, n: number): Date => {
  const x = new Date(d); x.setDate(x.getDate() + n); return x
}

const formatDateShort = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

const formatDateLong = (d: Date) =>
  d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

const formatTime = (t: string | null | undefined) =>
  t ? t.slice(0, 5) : ''

const formatBytes = (b: number | null | undefined) => {
  if (b == null) return ''
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

const getFileIcon = (mime: string | null) => {
  if (!mime) return '📄'
  if (mime.startsWith('image/')) return '🖼️'
  if (mime === 'application/pdf') return '📕'
  if (mime.includes('word')) return '📘'
  if (mime.includes('excel') || mime.includes('spreadsheet') || mime === 'text/csv') return '📊'
  return '📄'
}

const DAY_FROM_INDEX: Record<number, string> = {
  0: 'sun', 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat',
}

// Does this sheet run on the given date? Mirrors the planner-side
// rule (shared with `sheetRunsOn` and server-side `isValidOccurrence`).
const sheetRunsOnDate = (s: any, dateIso: string): boolean => {
  if (!s) return false
  if (dateIso < s.start_date) return false
  if (s.sheet_type === 'one_off') {
    return s.end_date ? dateIso <= s.end_date : dateIso === s.start_date
  }
  // recurring
  if (s.end_date && dateIso > s.end_date) return false
  const d = new Date(dateIso + 'T00:00:00')
  const slug = DAY_FROM_INDEX[d.getDay()]
  return (s.recurring_days || []).includes(slug)
}

type DaySheet = {
  id: string
  customer_name: string
  job_description: string | null
  sheet_type: 'one_off' | 'recurring'
  start_date: string
  end_date: string | null
  recurring_days: string[] | null
  start_time: string | null
  end_time: string | null
  passenger_count: number | null
  job_notes: string | null
  active: boolean
}

type Assignment = {
  id: string
  day_sheet_id: string
  user_id: string | null
  assignment_date: string
  status: 'draft' | 'published'
}

type DriverDay = {
  user_id: string
  assignment_date: string
  vehicle_id: string | null
  day_notes: string | null
}

type Vehicle = {
  id: string
  registration: string
  vehicle_type: string | null
}

type DocRow = {
  id: string
  filename: string
  mime_type: string | null
  size_bytes: number | null
  signed_url: string | null
}

type Props = {
  currentUser: any
  company: any
}

export default function EmployeeDaySheetSchedule({ currentUser, company }: Props) {
  const router = useRouter()

  // The visible window. We default to today + 7 days. The "Today"
  // button resets to that. The ← / → buttons shift by one week.
  const [windowStart, setWindowStart] = useState<Date>(() => {
    const t = new Date(); t.setHours(0, 0, 0, 0); return t
  })
  const windowDays: Date[] = useMemo(() => {
    const out: Date[] = []
    for (let i = 0; i < 8; i++) out.push(addDays(windowStart, i))  // today + next 7
    return out
  }, [windowStart])

  const fromIso = useMemo(() => isoDate(windowDays[0]), [windowDays])
  const toIso = useMemo(() => isoDate(windowDays[windowDays.length - 1]), [windowDays])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sheets, setSheets] = useState<DaySheet[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [driverDays, setDriverDays] = useState<DriverDay[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])

  // Modal state for the tapped day-sheet. Uses /api/list-day-sheet-documents
  // for attachments (re-uses the admin/edit flow's list endpoint, which
  // is open to anyone in the company).
  const [openSheet, setOpenSheet] = useState<DaySheet | null>(null)
  const [openSheetDate, setOpenSheetDate] = useState<string | null>(null)
  const [openDocs, setOpenDocs] = useState<DocRow[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [docMessage, setDocMessage] = useState('')

  const loadAll = useCallback(async () => {
    if (!currentUser?.id || !currentUser?.company_id) return
    setLoading(true)
    setError('')
    try {
      // 1. Pull all the user's published assignments in [fromIso, toIso].
      //    These are the rows that actually anchor what the driver sees.
      const { data: rawAssignments, error: aErr } = await supabase
        .from('day_sheet_assignments')
        .select('id, day_sheet_id, user_id, assignment_date, status')
        .eq('company_id', currentUser.company_id)
        .eq('user_id', currentUser.id)
        .eq('status', 'published')
        .gte('assignment_date', fromIso)
        .lte('assignment_date', toIso)
      if (aErr) throw aErr
      const asgs = (rawAssignments || []) as Assignment[]
      setAssignments(asgs)

      // 2. Pull the day_sheet rows referenced by those assignments.
      const sheetIds = Array.from(new Set(asgs.map(a => a.day_sheet_id)))
      if (sheetIds.length > 0) {
        const { data: sheetRows, error: sErr } = await supabase
          .from('day_sheets')
          .select('id, customer_name, job_description, sheet_type, start_date, end_date, recurring_days, start_time, end_time, passenger_count, job_notes, active')
          .in('id', sheetIds)
        if (sErr) throw sErr
        setSheets(((sheetRows || []) as DaySheet[]).filter(s => s.active !== false))
      } else {
        setSheets([])
      }

      // 3. Pull the driver_day_assignments rows for this user in
      //    the visible window — gives per-day vehicle + day-notes.
      const { data: ddaRows, error: dErr } = await supabase
        .from('driver_day_assignments')
        .select('user_id, assignment_date, vehicle_id, day_notes')
        .eq('company_id', currentUser.company_id)
        .eq('user_id', currentUser.id)
        .gte('assignment_date', fromIso)
        .lte('assignment_date', toIso)
      if (dErr) throw dErr
      setDriverDays((ddaRows || []) as DriverDay[])

      // 4. Pull vehicles — only the ones referenced. Fine to grab
      //    them all from the company; small list.
      const { data: vehicleRows, error: vErr } = await supabase
        .from('vehicles')
        .select('id, registration, vehicle_type')
        .eq('company_id', currentUser.company_id)
      if (vErr) throw vErr
      setVehicles((vehicleRows || []) as Vehicle[])
    } catch (e: any) {
      setError(e?.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [currentUser?.id, currentUser?.company_id, fromIso, toIso])

  useEffect(() => { loadAll() }, [loadAll])

  // ── Realtime: re-load when planner publishes/edits ───────────────
  // Subscribe to postgres_changes on the three day-sheet tables that
  // affect what this driver sees. Each event triggers a full reload
  // (cheap — the queries are well-indexed and bounded by the visible
  // window).
  //
  // Filters are scoped tightly:
  //   - day_sheet_assignments: only my user_id
  //   - driver_day_assignments: only my user_id
  //   - day_sheets: company-scoped (we can't filter by an FK from
  //     here, but we still want to know when a sheet I'm on gets
  //     edited — customer name, times, etc.)
  //
  // Requires the tables to be in the supabase_realtime publication
  // (migration 035 ensures that).
  useEffect(() => {
    if (!currentUser?.id || !currentUser?.company_id) return

    const channel = supabase.channel('employee-day-sheet-realtime')

    channel
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'day_sheet_assignments', filter: `user_id=eq.${currentUser.id}` },
        () => { loadAll() },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'driver_day_assignments', filter: `user_id=eq.${currentUser.id}` },
        () => { loadAll() },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'day_sheets', filter: `company_id=eq.${currentUser.company_id}` },
        () => { loadAll() },
      )

    channel.subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [currentUser?.id, currentUser?.company_id, loadAll])

  // ── Lookups & per-day derivations ─────────────────────────────────
  const sheetById = useMemo(() => {
    const m = new Map<string, DaySheet>()
    for (const s of sheets) m.set(s.id, s)
    return m
  }, [sheets])

  const vehicleById = useMemo(() => {
    const m = new Map<string, Vehicle>()
    for (const v of vehicles) m.set(v.id, v)
    return m
  }, [vehicles])

  // Assignments for a given date (could be more than one — the
  // driver might be on multiple sheets the same day).
  const assignmentsForDate = useCallback((iso: string): { assignment: Assignment; sheet: DaySheet }[] => {
    return assignments
      .filter(a => a.assignment_date === iso)
      .map(a => {
        const s = sheetById.get(a.day_sheet_id)
        if (!s) return null
        // Defensive: only include if the sheet "runs" on that date
        // (mirrors the planner's recurrence/range rules). Stale
        // assignment rows from a deleted sheet would otherwise leak.
        if (!sheetRunsOnDate(s, iso)) return null
        return { assignment: a, sheet: s }
      })
      .filter((x): x is { assignment: Assignment; sheet: DaySheet } => !!x)
      .sort((a, b) => {
        // Sort by start_time within the day
        const at = a.sheet.start_time || ''
        const bt = b.sheet.start_time || ''
        return at.localeCompare(bt)
      })
  }, [assignments, sheetById])

  const driverDayFor = useCallback((iso: string): DriverDay | null => {
    return driverDays.find(d => d.assignment_date === iso) || null
  }, [driverDays])

  // ── Window navigation ────────────────────────────────────────────
  const goToday = () => {
    const t = new Date(); t.setHours(0, 0, 0, 0)
    setWindowStart(t)
  }
  const goPrev = () => setWindowStart(d => addDays(d, -7))
  const goNext = () => setWindowStart(d => addDays(d, 7))

  const todayIso = useMemo(() => {
    const t = new Date(); t.setHours(0, 0, 0, 0); return isoDate(t)
  }, [])

  const windowLabel = useMemo(() => {
    const f = windowDays[0]
    const t = windowDays[windowDays.length - 1]
    return `${formatDateShort(f)} – ${formatDateShort(t)} ${t.getFullYear()}`
  }, [windowDays])

  // ── Modal ────────────────────────────────────────────────────────
  const openSheetModal = async (sheet: DaySheet, dateIso: string) => {
    setOpenSheet(sheet)
    setOpenSheetDate(dateIso)
    setOpenDocs([])
    setDocMessage('')
    setDocsLoading(true)
    try {
      const res = await fetch('/api/list-day-sheet-documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day_sheet_id: sheet.id }),
      })
      const data = await res.json()
      if (!res.ok) {
        setDocMessage(data.error || 'Failed to load documents')
      } else {
        setOpenDocs(data.documents || [])
      }
    } catch (e: any) {
      setDocMessage(e?.message || 'Failed to load documents')
    } finally {
      setDocsLoading(false)
    }
  }

  const closeModal = () => {
    setOpenSheet(null)
    setOpenSheetDate(null)
    setOpenDocs([])
    setDocMessage('')
  }

  const handleDownload = (doc: DocRow) => {
    if (!doc.signed_url) {
      setDocMessage('This file is currently unavailable. Try again shortly.')
      return
    }
    window.open(doc.signed_url, '_blank', 'noopener,noreferrer')
  }

  // ── Render ───────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-gray-50 pb-24">
      {/* Header — mirror shift-patterns blue gradient */}
      <div className="bg-gradient-to-br from-blue-600 to-blue-800 text-white px-6 pt-10 pb-6 rounded-b-3xl shadow-lg">
        <div className="flex items-center justify-between">
          <button onClick={() => router.push('/employee')} className="text-blue-100 text-sm hover:text-white">← Home</button>
          <p className="text-blue-100 text-sm">{company?.name}</p>
        </div>
        <h1 className="text-2xl font-bold mt-2">📅 My Day Sheets</h1>
        <p className="text-blue-100 text-sm mt-1">{windowLabel}</p>
      </div>

      <div className="px-4 pt-4 space-y-3">
        {/* Window navigation */}
        <div className="flex items-center gap-2 bg-white rounded-xl shadow-sm p-2">
          <button
            onClick={goPrev}
            className="bg-gray-100 hover:bg-gray-200 text-gray-700 w-10 h-10 rounded-lg text-base font-medium flex-shrink-0"
            aria-label="Previous week"
          >←</button>
          <button
            onClick={goToday}
            className="flex-1 bg-blue-50 hover:bg-blue-100 text-blue-700 px-3 py-2 rounded-lg text-sm font-medium"
          >Today</button>
          <button
            onClick={goNext}
            className="bg-gray-100 hover:bg-gray-200 text-gray-700 w-10 h-10 rounded-lg text-base font-medium flex-shrink-0"
            aria-label="Next week"
          >→</button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* Day cards */}
        {loading ? (
          <p className="text-sm text-gray-400 italic px-2 py-4">Loading…</p>
        ) : (
          <div className="space-y-2">
            {windowDays.map((d, idx) => {
              const dIso = isoDate(d)
              const isToday = dIso === todayIso
              const dayAsgs = assignmentsForDate(dIso)
              const dda = driverDayFor(dIso)
              const isEmpty = dayAsgs.length === 0
              const vehicle = dda?.vehicle_id ? vehicleById.get(dda.vehicle_id) : null

              return (
                <div
                  key={idx}
                  className={`bg-white rounded-2xl shadow-sm border overflow-hidden ${
                    isToday ? 'border-blue-400 ring-2 ring-blue-100' : 'border-gray-100'
                  }`}
                >
                  <div className={`px-4 py-2 flex items-center justify-between ${isToday ? 'bg-blue-50' : 'bg-gray-50'}`}>
                    <div className="flex items-center gap-2">
                      <p className={`font-semibold text-sm ${isToday ? 'text-blue-800' : 'text-gray-800'}`}>
                        {d.toLocaleDateString('en-GB', { weekday: 'long' })}
                      </p>
                      <span className={`text-xs ${isToday ? 'text-blue-700' : 'text-gray-500'}`}>
                        {formatDateShort(d)}
                      </span>
                      {isToday && (
                        <span className="text-[10px] bg-blue-600 text-white px-2 py-0.5 rounded-full font-medium">
                          TODAY
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="p-3 space-y-2">
                    {/* Vehicle + day-notes banner — only when there's
                        something to show, and only when there are
                        actually assignments for the day. */}
                    {!isEmpty && (vehicle || dda?.day_notes) && (
                      <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs text-emerald-900">
                        {vehicle && (
                          <p>
                            <span className="font-semibold">Vehicle:</span>{' '}
                            {vehicle.registration}
                            {vehicle.vehicle_type ? ` · ${vehicle.vehicle_type}` : ''}
                          </p>
                        )}
                        {dda?.day_notes && (
                          <p className={vehicle ? 'mt-1' : ''}>
                            <span className="font-semibold">Notes:</span>{' '}
                            <span className="whitespace-pre-wrap">{dda.day_notes}</span>
                          </p>
                        )}
                      </div>
                    )}

                    {dayAsgs.map(({ assignment, sheet }) => (
                      <button
                        key={assignment.id}
                        onClick={() => openSheetModal(sheet, dIso)}
                        className="w-full text-left bg-blue-50 hover:bg-blue-100 active:bg-blue-200 border border-blue-200 rounded-lg p-3 transition"
                      >
                        <div className="flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-blue-900 text-sm truncate">
                              {sheet.customer_name}
                            </p>
                            {sheet.job_description && (
                              <p className="text-xs text-blue-700 mt-0.5 line-clamp-2">
                                {sheet.job_description}
                              </p>
                            )}
                            <p className="text-xs text-blue-700 mt-0.5">
                              {sheet.start_time
                                ? `${formatTime(sheet.start_time)}${sheet.end_time ? ' – ' + formatTime(sheet.end_time) : ''}`
                                : 'No time set'}
                              {sheet.passenger_count != null && (
                                <span className="ml-2">· 👥 {sheet.passenger_count}</span>
                              )}
                            </p>
                          </div>
                          <span className="text-blue-400 text-sm flex-shrink-0">›</span>
                        </div>
                      </button>
                    ))}

                    {isEmpty && (
                      <div className="px-3 py-2 text-center text-gray-400 text-sm italic">
                        No jobs
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Modal */}
      {openSheet && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center sm:p-4"
          onClick={closeModal}
        >
          <div
            className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex justify-between items-start gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-bold text-gray-800 break-words">{openSheet.customer_name}</h2>
                {openSheet.job_description && (
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{openSheet.job_description}</p>
                )}
              </div>
              <button
                onClick={closeModal}
                className="text-gray-400 hover:text-gray-700 text-2xl leading-none flex-shrink-0"
                aria-label="Close"
              >×</button>
            </div>

            <div className="p-5 space-y-4">
              {openSheetDate && (
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 mb-1">Date</p>
                  <p className="font-medium text-gray-800">
                    {formatDateLong(new Date(openSheetDate + 'T00:00:00'))}
                  </p>
                </div>
              )}

              {(openSheet.start_time || openSheet.end_time) && (
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 mb-1">Time</p>
                  <p className="font-medium text-gray-800">
                    {openSheet.start_time ? formatTime(openSheet.start_time) : '—'}
                    {openSheet.end_time ? ` – ${formatTime(openSheet.end_time)}` : ''}
                  </p>
                </div>
              )}

              {openSheet.passenger_count != null && (
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 mb-1">Passengers</p>
                  <p className="font-medium text-gray-800">{openSheet.passenger_count}</p>
                </div>
              )}

              {openSheet.job_notes && (
                <div>
                  <p className="text-xs text-gray-500 mb-1 font-medium">Job notes</p>
                  <p className="text-sm text-gray-800 whitespace-pre-wrap">{openSheet.job_notes}</p>
                </div>
              )}

              {/* Per-day vehicle + day-notes — repeated here so it's
                  visible inside the modal too, since the user might
                  open it without scrolling back to the day card. */}
              {openSheetDate && (() => {
                const dda = driverDayFor(openSheetDate)
                const vehicle = dda?.vehicle_id ? vehicleById.get(dda.vehicle_id) : null
                if (!vehicle && !dda?.day_notes) return null
                return (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-900 space-y-1">
                    {vehicle && (
                      <p>
                        <span className="font-semibold">Vehicle:</span>{' '}
                        {vehicle.registration}
                        {vehicle.vehicle_type ? ` · ${vehicle.vehicle_type}` : ''}
                      </p>
                    )}
                    {dda?.day_notes && (
                      <p>
                        <span className="font-semibold">Day notes:</span>{' '}
                        <span className="whitespace-pre-wrap">{dda.day_notes}</span>
                      </p>
                    )}
                  </div>
                )
              })()}

              <div className="pt-3 border-t border-gray-100">
                <p className="text-sm font-semibold text-gray-800 mb-2">Attachments</p>
                {docMessage && <p className="text-xs text-red-600 mb-2">{docMessage}</p>}
                {docsLoading ? (
                  <p className="text-sm text-gray-400 italic">Loading attachments…</p>
                ) : openDocs.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">No attachments</p>
                ) : (
                  <ul className="space-y-2">
                    {openDocs.map(doc => (
                      <li key={doc.id}>
                        <button
                          onClick={() => handleDownload(doc)}
                          className="w-full flex items-center gap-3 bg-gray-50 hover:bg-gray-100 active:bg-gray-200 rounded-lg px-3 py-2 text-left transition"
                        >
                          <span className="text-2xl flex-shrink-0">{getFileIcon(doc.mime_type)}</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-800 truncate">{doc.filename}</p>
                            <p className="text-xs text-gray-500">{formatBytes(doc.size_bytes)}</p>
                          </div>
                          <span className="text-blue-600 text-sm font-medium flex-shrink-0">Open</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <button
                onClick={closeModal}
                className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 py-3 rounded-lg font-medium transition"
              >Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom nav — same as the rest of the employee app */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg">
        <div className="flex justify-around items-center h-16 max-w-md mx-auto">
          <button
            onClick={() => router.push('/employee')}
            className="flex flex-col items-center gap-0.5 text-gray-400 hover:text-gray-600"
          >
            <span className="text-xl">🏠</span>
            <span className="text-xs font-medium">Home</span>
          </button>
          <button
            onClick={() => router.push('/employee/profile')}
            className="flex flex-col items-center gap-0.5 text-gray-400 hover:text-gray-600"
          >
            <span className="text-xl">👤</span>
            <span className="text-xs font-medium">Profile</span>
          </button>
        </div>
      </nav>
    </main>
  )
}
