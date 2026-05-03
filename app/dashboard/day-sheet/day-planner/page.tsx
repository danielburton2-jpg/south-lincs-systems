'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh'

const supabase = createClient()

// ── Date helpers ─────────────────────────────────────────────────────
const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const addDays = (d: Date, n: number) => {
  const out = new Date(d); out.setDate(out.getDate() + n); return out
}

const formatDateLong = (d: Date) =>
  d.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

const formatTime = (t: string | null) => (t ? (t.length >= 5 ? t.slice(0, 5) : t) : '')

const parseIso = (iso: string) => new Date(iso + 'T00:00:00')

// ── Types ────────────────────────────────────────────────────────────
type Profile = {
  id: string
  full_name: string | null
  is_frozen: boolean | null
  display_order: number | null
}

type Vehicle = {
  id: string
  registration: string
  vehicle_type: string
  seats: number | null
  active: boolean
}

type Sheet = {
  id: string
  customer_name: string
  job_description: string | null
  start_time: string | null
  end_time: string | null
  passenger_count: number | null
  job_notes: string | null
}

type Asg = {
  day_sheet_id: string
  user_id: string
  status: 'draft' | 'published'
  is_changed: boolean
}

// One row per driver who has any assignment on the selected date
type DriverRow = {
  user: Profile
  jobs: Array<{
    sheet: Sheet
    status: 'draft' | 'published'
    is_changed: boolean
  }>
  maxPax: number | null   // max passenger_count across this driver's jobs today
}

type PendingState = Record<string, {  // key = user_id
  vehicle_id: string | null
  day_notes: string
}>

export default function DayPlannerPage() {
  const router = useRouter()
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [companyName, setCompanyName] = useState<string>('')
  const [date, setDate] = useState<Date>(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d
  })
  const dateIso = isoDate(date)

  const [drivers, setDrivers] = useState<DriverRow[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [serverState, setServerState] = useState<PendingState>({})
  const [pending, setPending] = useState<PendingState>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  const showMessage = (msg: string, type: 'success' | 'error' = 'success') => {
    setMessage(msg); setMessageType(type)
    if (type === 'success') setTimeout(() => setMessage(''), 4000)
  }

  // Resolve current user → company_id (and fetch company name for the
  // print header)
  useEffect(() => {
    let cancelled = false
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const { data: profile } = await supabase
        .from('profiles')
        .select('company_id')
        .eq('id', user.id)
        .single()
      if (cancelled) return
      if (!profile?.company_id) { router.push('/dashboard'); return }
      setCompanyId(profile.company_id)

      // Pull company name for the print header. Fail-silent — if this
      // fails the printed sheet just has no company line.
      const { data: company } = await supabase
        .from('companies')
        .select('name')
        .eq('id', profile.company_id)
        .single()
      if (!cancelled && company?.name) setCompanyName(company.name)
    }
    init()
    return () => { cancelled = true }
  }, [router])

  // Load data for the selected date
  const fetchData = useCallback(async () => {
    if (!companyId) return
    setLoading(true)

    // Step 1: pull assignments for the date — gives us driver IDs and sheet IDs
    const { data: asgRows, error: asgErr } = await supabase
      .from('day_sheet_assignments')
      .select('day_sheet_id, user_id, status, is_changed')
      .eq('company_id', companyId)
      .eq('assignment_date', dateIso)
      .not('user_id', 'is', null)

    if (asgErr) console.error('[day-planner] asg error:', asgErr)
    const asgs = (asgRows || []) as Asg[]

    const userIds = Array.from(new Set(asgs.map(a => a.user_id)))
    const sheetIds = Array.from(new Set(asgs.map(a => a.day_sheet_id)))

    // Step 2: in parallel — profiles, sheets, vehicles, driver_day_assignments
    const [profilesRes, sheetsRes, vehiclesRes, ddaRes] = await Promise.all([
      userIds.length > 0
        ? supabase.from('profiles')
            .select('id, full_name, is_frozen, display_order')
            .in('id', userIds)
            .eq('is_deleted', false)
        : Promise.resolve({ data: [], error: null }),
      sheetIds.length > 0
        ? supabase.from('day_sheets')
            .select('id, customer_name, job_description, start_time, end_time, passenger_count, job_notes')
            .in('id', sheetIds)
        : Promise.resolve({ data: [], error: null }),
      supabase.from('vehicles')
        .select('id, registration, vehicle_type, seats, active')
        .eq('company_id', companyId)
        .eq('active', true)
        .order('registration', { ascending: true }),
      userIds.length > 0
        ? supabase.from('driver_day_assignments')
            .select('user_id, vehicle_id, day_notes')
            .eq('company_id', companyId)
            .eq('assignment_date', dateIso)
            .in('user_id', userIds)
        : Promise.resolve({ data: [], error: null }),
    ])

    if (profilesRes.error) console.error('[day-planner] profiles error:', profilesRes.error)
    if (sheetsRes.error)   console.error('[day-planner] sheets error:', sheetsRes.error)
    if (vehiclesRes.error) console.error('[day-planner] vehicles error:', vehiclesRes.error)
    if (ddaRes.error)      console.error('[day-planner] dda error:', ddaRes.error)

    const profileMap = new Map<string, Profile>()
    ;((profilesRes.data || []) as Profile[]).forEach(p => profileMap.set(p.id, p))

    const sheetMap = new Map<string, Sheet>()
    ;((sheetsRes.data || []) as Sheet[]).forEach(s => sheetMap.set(s.id, s))

    // Pivot assignments → one DriverRow per driver
    const byUser = new Map<string, DriverRow>()
    for (const a of asgs) {
      const user = profileMap.get(a.user_id)
      const sheet = sheetMap.get(a.day_sheet_id)
      if (!user || !sheet) continue
      let row = byUser.get(a.user_id)
      if (!row) {
        row = { user, jobs: [], maxPax: null }
        byUser.set(a.user_id, row)
      }
      row.jobs.push({ sheet, status: a.status, is_changed: a.is_changed })
      if (sheet.passenger_count != null) {
        row.maxPax = Math.max(row.maxPax || 0, sheet.passenger_count)
      }
    }

    // Sort drivers by display_order then name (matches the assign page)
    const driverList = Array.from(byUser.values()).sort((a, b) => {
      const ao = a.user.display_order ?? 9999
      const bo = b.user.display_order ?? 9999
      if (ao !== bo) return ao - bo
      const an = (a.user.full_name || '').toLowerCase()
      const bn = (b.user.full_name || '').toLowerCase()
      return an < bn ? -1 : an > bn ? 1 : 0
    })

    // Sort each driver's jobs by start_time (nulls last)
    for (const row of driverList) {
      row.jobs.sort((a, b) => {
        const at = a.sheet.start_time || 'zz'
        const bt = b.sheet.start_time || 'zz'
        return at < bt ? -1 : at > bt ? 1 : 0
      })
    }

    // Load existing vehicle/notes per user
    const initialState: PendingState = {}
    for (const row of driverList) {
      initialState[row.user.id] = { vehicle_id: null, day_notes: '' }
    }
    ;((ddaRes.data || []) as any[]).forEach(r => {
      if (initialState[r.user_id]) {
        initialState[r.user_id] = {
          vehicle_id: r.vehicle_id || null,
          day_notes: r.day_notes || '',
        }
      }
    })

    setDrivers(driverList)
    setVehicles((vehiclesRes.data || []) as Vehicle[])
    setServerState(initialState)
    setPending(initialState)
    setLoading(false)
  }, [companyId, dateIso])

  useEffect(() => { fetchData() }, [fetchData])

  useRealtimeRefresh(
    'day-planner',
    [
      { table: 'day_sheet_assignments', companyId },
      { table: 'driver_day_assignments', companyId },
      { table: 'vehicles', companyId },
    ],
    fetchData,
    !!companyId,
  )

  // Unsaved detection
  const hasUnsaved = useMemo(() => {
    const allKeys = new Set([
      ...Object.keys(pending),
      ...Object.keys(serverState),
    ])
    for (const k of allKeys) {
      const p = pending[k]
      const s = serverState[k]
      if (!p && !s) continue
      if (!p || !s) return true
      if ((p.vehicle_id || null) !== (s.vehicle_id || null)) return true
      if ((p.day_notes || '') !== (s.day_notes || '')) return true
    }
    return false
  }, [pending, serverState])

  useEffect(() => {
    if (!hasUnsaved) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [hasUnsaved])

  const setVehicleFor = (userId: string, vehicleId: string | null) => {
    setPending(prev => ({
      ...prev,
      [userId]: {
        vehicle_id: vehicleId,
        day_notes: prev[userId]?.day_notes ?? '',
      },
    }))
  }

  const setNotesFor = (userId: string, notes: string) => {
    setPending(prev => ({
      ...prev,
      [userId]: {
        vehicle_id: prev[userId]?.vehicle_id ?? null,
        day_notes: notes,
      },
    }))
  }

  const handleSave = async () => {
    if (!companyId || saving) return
    setSaving(true)
    setMessage('')

    const items: Array<{ user_id: string; assignment_date: string; vehicle_id: string | null; day_notes: string | null }> = []
    const allKeys = new Set([
      ...Object.keys(pending),
      ...Object.keys(serverState),
    ])
    for (const userId of allKeys) {
      const p = pending[userId]
      const s = serverState[userId]
      const pVeh = p?.vehicle_id || null
      const pNotes = (p?.day_notes || '').trim() || null
      const sVeh = s?.vehicle_id || null
      const sNotes = (s?.day_notes || '').trim() || null
      if (pVeh === sVeh && pNotes === sNotes) continue
      items.push({
        user_id: userId,
        assignment_date: dateIso,
        vehicle_id: pVeh,
        day_notes: pNotes,
      })
    }

    if (items.length === 0) {
      showMessage('Nothing to save.', 'success')
      setSaving(false)
      return
    }

    try {
      const res = await fetch('/api/bulk-save-driver-day-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, items }),
      })
      const data = await res.json()
      if (!res.ok) {
        showMessage(data.error || 'Failed to save', 'error')
        setSaving(false)
        return
      }
      const total = (data.inserted || 0) + (data.updated || 0) + (data.deleted || 0)
      showMessage(`Saved ${total} change${total === 1 ? '' : 's'}.`, 'success')
      await fetchData()
    } catch (err: any) {
      showMessage(err?.message || 'Server error', 'error')
    } finally {
      setSaving(false)
    }
  }

  // Sort vehicles for a driver: those with seats >= maxPax come first,
  // then everything else alphabetically. Vehicle list is the SAME
  // shape for every driver but the sort depends on their pax.
  const sortVehiclesForDriver = (maxPax: number | null): Vehicle[] => {
    if (maxPax == null) return vehicles
    const fits: Vehicle[] = []
    const others: Vehicle[] = []
    for (const v of vehicles) {
      if (v.seats != null && v.seats >= maxPax) fits.push(v)
      else others.push(v)
    }
    return [...fits, ...others]
  }

  const isToday = dateIso === isoDate(new Date())

  // How many "Job N" columns to render. We use the max across all
  // visible drivers, so the table widens to fit the busiest driver of
  // the day. Capped at 6 — if anyone genuinely has 7+ jobs in a day
  // we have other problems and the day view stops being a sensible
  // print artefact.
  const MAX_JOB_COLUMNS = 6
  const jobColumnCount = Math.min(
    MAX_JOB_COLUMNS,
    Math.max(1, ...drivers.map(d => d.jobs.length))
  )
  const jobColumnIndices = Array.from({ length: jobColumnCount }, (_, i) => i)

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-[1800px] day-planner-root">
      {/*
        Print stylesheet. Drives layout when the user prints (Ctrl+P)
        or chooses "Save as PDF" in the browser's print dialog. Three
        rules:
          - .print-hide      hidden on paper (page header, controls)
          - .print-only      only visible on paper (printable header)
          - .print-table     gets professional borders + page-break
                             behaviour so a driver row never splits
                             across two pages
      */}
      <style jsx global>{`
        @media print {
          @page { size: A4 landscape; margin: 10mm; }
          html, body { background: #fff !important; }
          /* Hide platform chrome — sidebar, top bar, etc. The sidebar
             nav uses common ids/classes; we hide the most likely ones
             and also rely on .print-hide tags inside our page. */
          aside, nav, .sidebar, [data-sidebar], [data-top-bar],
          .dashboard-top-bar, .top-bar {
            display: none !important;
          }
          .print-hide { display: none !important; }
          .print-only { display: block !important; }
          .day-planner-root {
            padding: 0 !important;
            max-width: none !important;
          }
          /* Kill the horizontal-scroll wrapper around the table.
             On screen this allows the wide table to scroll within
             a narrow viewport. On paper there's no viewport — we
             want the table to stretch to the page edges and the
             cells to wrap their content instead. Without this rule
             the print preview shows the wrapper's scrollbar baked
             into the page (the screenshot bug we just fixed). */
          .print-table-scroll {
            overflow: visible !important;
          }
          /* Table tweaks — flatten the card and tighten borders for
             paper. */
          .print-table {
            border-radius: 0 !important;
            box-shadow: none !important;
            border: 1px solid #000 !important;
            width: 100% !important;
          }
          /* Force a fixed layout so column widths come from CSS, not
             from cell content. Combined with width:100% above, the
             table fills the page width exactly. Long text inside
             cells wraps onto multiple lines. */
          .print-table table {
            table-layout: fixed !important;
            width: 100% !important;
          }
          .print-table th,
          .print-table td {
            border: 1px solid #999 !important;
            padding: 4px 6px !important;
            font-size: 10pt !important;
            color: #000 !important;
            background: #fff !important;
            /* Override the screen min-width Tailwind classes that
               were sized for the on-screen layout. Without this,
               the min-widths added together exceed the printable
               page width. */
            min-width: 0 !important;
            /* Allow long words (URLs, customer names) to break so
               they don't push the column wider than its share. */
            overflow-wrap: break-word !important;
            word-wrap: break-word !important;
            vertical-align: top !important;
          }
          .print-table thead th {
            background: #eee !important;
            font-size: 8pt !important;
          }
          .print-table tr {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          /* Hide form controls; show their plain-text counterparts. */
          .print-control { display: none !important; }
          .print-value { display: block !important; }
        }
        /* On screen, the print-only blocks are hidden; print-value
           (the plain-text mirror) is hidden too — only the form
           control shows. */
        @media screen {
          .print-only { display: none; }
          .print-value { display: none; }
        }
      `}</style>
      <div className="flex items-baseline justify-between mb-4 gap-4 flex-wrap print-hide">
        <div>
          <Link href="/dashboard/day-sheet" className="text-sm text-blue-600 hover:underline">
            ← Back to Day Sheet list
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 mt-2">Day View</h1>
          <p className="text-sm text-slate-500 mt-1">
            Pick the vehicle and any notes for each driver working today, then print or save as PDF.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDate(addDays(date, -1))}
            className="px-3 py-1.5 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg"
            disabled={saving}
          >← Prev day</button>
          <button
            type="button"
            onClick={() => {
              const d = new Date(); d.setHours(0, 0, 0, 0); setDate(d)
            }}
            className={`px-3 py-1.5 text-sm rounded-lg ${
              isToday
                ? 'bg-blue-100 text-blue-700 font-medium'
                : 'bg-slate-100 hover:bg-slate-200'
            }`}
            disabled={saving}
          >Today</button>
          <button
            type="button"
            onClick={() => setDate(addDays(date, 1))}
            className="px-3 py-1.5 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg"
            disabled={saving}
          >Next day →</button>
          <input
            type="date"
            value={dateIso}
            onChange={e => {
              if (e.target.value) setDate(parseIso(e.target.value))
            }}
            className="ml-2 px-2 py-1.5 text-sm border border-slate-300 rounded-lg"
            disabled={saving}
          />
        </div>
      </div>

      {/*
        Print-only header. Renders nothing on screen. When the page
        is printed (or saved as PDF), this becomes the title block at
        the top of the paper. Company name + the day in plain English.
      */}
      <div className="print-only" style={{ marginBottom: '12px', borderBottom: '1px solid #000', paddingBottom: '8px' }}>
        {companyName && (
          <p style={{ margin: 0, fontSize: '10pt', color: '#444' }}>
            {companyName}
          </p>
        )}
        <h2 style={{ margin: '4px 0 0', fontSize: '16pt', fontWeight: 500 }}>
          Day Sheet — {formatDateLong(date)}
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: '8pt', color: '#666' }}>
          {drivers.length} driver{drivers.length === 1 ? '' : 's'} ·{' '}
          {drivers.reduce((sum, d) => sum + d.jobs.length, 0)} job{drivers.reduce((sum, d) => sum + d.jobs.length, 0) === 1 ? '' : 's'}
        </p>
      </div>

      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap print-hide">
        <div className="text-sm text-slate-600">
          <span className="font-medium text-slate-800">{formatDateLong(date)}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            disabled={saving || drivers.length === 0}
            title={drivers.length === 0 ? 'Nothing to print' : 'Print or save as PDF'}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition ${
              drivers.length === 0
                ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                : 'bg-white border border-slate-300 hover:bg-slate-50 text-slate-700'
            }`}
          >
            🖨 Print / Save as PDF
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !hasUnsaved}
            className={`px-5 py-2 text-sm font-medium rounded-lg transition ${
              saving || !hasUnsaved
                ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
            }`}
          >
            {saving ? 'Saving…' : hasUnsaved ? 'Save day' : 'No changes'}
          </button>
        </div>
      </div>

      {hasUnsaved && (
        <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg print-hide">
          You have unsaved changes. Click <strong>Save day</strong> to commit them.
        </div>
      )}

      {message && (
        <div className={`mb-3 p-3 rounded-lg text-sm font-medium print-hide ${
          messageType === 'success'
            ? 'bg-green-50 border border-green-200 text-green-700'
            : 'bg-red-50 border border-red-200 text-red-700'
        }`}>{message}</div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden print-table">
        <div className="overflow-x-auto print-table-scroll">
          <table className="w-full border-collapse">
            {/*
              Column widths. Only relevant in print where
              `table-layout: fixed` (set in the print stylesheet)
              uses these. On screen the table auto-sizes.
              Math: Driver 12% + Vehicle 10% + Notes 18% = 40%.
              Remaining 60% is split equally among N job columns.
              Vehicle column is narrow because we now show just the
              registration (e.g. "BU12 S"), not the type/seats too.
            */}
            <colgroup>
              <col style={{ width: '12%' }} />
              <col style={{ width: '10%' }} />
              {jobColumnIndices.map(i => (
                <col key={`col-job-${i}`} style={{ width: `${60 / jobColumnCount}%` }} />
              ))}
              <col style={{ width: '18%' }} />
            </colgroup>
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-slate-600 uppercase border-b border-slate-200 min-w-[160px]">
                  Driver
                </th>
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-slate-600 uppercase border-b border-slate-200 min-w-[120px]">
                  Vehicle
                </th>
                {jobColumnIndices.map(i => (
                  <th
                    key={`job-h-${i}`}
                    className="text-left px-3 py-2 text-[10px] font-semibold text-slate-600 uppercase border-b border-slate-200 min-w-[180px]"
                  >
                    {/* No label — drivers don't need to be told a job is a job */}
                  </th>
                ))}
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-slate-600 uppercase border-b border-slate-200 min-w-[200px]">
                  Day notes
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={3 + jobColumnCount} className="text-center text-slate-400 py-10 text-sm italic">
                    Loading…
                  </td>
                </tr>
              ) : drivers.length === 0 ? (
                <tr>
                  <td colSpan={3 + jobColumnCount} className="text-center text-slate-400 py-10 text-sm">
                    No drivers have assignments on this day yet.{' '}
                    <Link href="/dashboard/day-sheet/assign" className="text-blue-600 hover:underline">
                      Go to Assign →
                    </Link>
                  </td>
                </tr>
              ) : (
                drivers.map(row => {
                  const userId = row.user.id
                  const cur = pending[userId] || { vehicle_id: null, day_notes: '' }
                  const sortedVehicles = sortVehiclesForDriver(row.maxPax)

                  return (
                    <tr key={userId} className="border-b border-slate-100 last:border-b-0 align-top">
                      <td className="px-3 py-3">
                        <p className="text-sm font-semibold text-slate-800">
                          {row.user.full_name || '(no name)'}
                        </p>
                        {row.user.is_frozen && (
                          <p className="text-[10px] text-amber-700 mt-0.5">⚠ frozen</p>
                        )}
                      </td>

                      <td className="px-3 py-3">
                        <select
                          value={cur.vehicle_id || ''}
                          onChange={e => setVehicleFor(userId, e.target.value || null)}
                          className="w-full text-sm border border-slate-300 rounded-lg px-2 py-1.5 bg-white print-control"
                        >
                          <option value="">— no vehicle —</option>
                          {sortedVehicles.map(v => {
                            const fits = row.maxPax != null && v.seats != null && v.seats >= row.maxPax
                            return (
                              <option key={v.id} value={v.id}>
                                {fits ? '✓ ' : ''}
                                {v.registration}
                              </option>
                            )
                          })}
                        </select>
                        {/* Print-only mirror of the selected vehicle.
                            Hidden on screen, shown when printing
                            instead of the dropdown. Just the
                            registration — vehicle type and seat count
                            are kept off the printed sheet. */}
                        <p className="print-value" style={{ margin: 0, fontSize: '11pt' }}>
                          {(() => {
                            const v = vehicles.find(x => x.id === cur.vehicle_id)
                            if (!v) return <span style={{ color: '#999' }}>(no vehicle)</span>
                            return v.registration
                          })()}
                        </p>
                      </td>

                      {jobColumnIndices.map(i => {
                        const item = row.jobs[i]
                        if (!item) {
                          return (
                            <td key={`job-${i}`} className="px-3 py-3 text-xs text-slate-300">
                              —
                            </td>
                          )
                        }
                        const { sheet, status } = item
                        return (
                          <td key={`job-${i}`} className="px-3 py-3 text-xs text-slate-700 align-top">
                            <div className="font-medium">
                              {sheet.start_time ? formatTime(sheet.start_time) : '?'}
                              {sheet.end_time ? `–${formatTime(sheet.end_time)}` : ''}
                            </div>
                            <Link
                              href={`/dashboard/day-sheet/${sheet.id}`}
                              className="text-blue-700 hover:underline block"
                            >
                              {sheet.job_description || sheet.customer_name}
                            </Link>
                            {status === 'draft' && (
                              <span className="ml-1 text-[9px] text-slate-500 print-hide">draft</span>
                            )}
                          </td>
                        )
                      })}

                      <td className="px-3 py-3">
                        <textarea
                          value={cur.day_notes}
                          onChange={e => setNotesFor(userId, e.target.value)}
                          rows={3}
                          placeholder="e.g. Clock on 5:30am, depart depot 5:45am"
                          className="w-full text-sm border border-slate-300 rounded-lg px-2 py-1.5 print-control"
                        />
                        {/* Print-only mirror of the typed notes. */}
                        <p
                          className="print-value"
                          style={{
                            margin: 0,
                            fontSize: '11pt',
                            whiteSpace: 'pre-wrap',
                            color: cur.day_notes ? '#000' : '#999',
                          }}
                        >
                          {cur.day_notes || '(no notes)'}
                        </p>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 text-xs text-slate-500 flex items-center gap-4 flex-wrap print-hide">
        <span>✓ vehicle has enough seats</span>
        <span>· Drivers shown: only those with assignments on this day</span>
        <span>· Vehicle and notes save as draft (the assign page handles publishing)</span>
      </div>
    </div>
  )
}
