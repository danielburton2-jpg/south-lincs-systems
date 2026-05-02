'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh'

const supabase = createClient()

const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const startOfWeekMon = (d: Date): Date => {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  const day = out.getDay()
  const diff = day === 0 ? -6 : 1 - day
  out.setDate(out.getDate() + diff)
  return out
}

const addDays = (d: Date, n: number): Date => {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

const formatDateShort = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })

const formatDateLong = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

const formatDateFull = (d: Date) =>
  d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })

const formatTime = (t: string) => t?.slice(0, 5) || ''

const DAY_LABELS: Record<string, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun'
}

export default function SchedulesCalendarPage() {
  const router = useRouter()

  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [users, setUsers] = useState<any[]>([])
  const [schedules, setSchedules] = useState<any[]>([])
  const [assignments, setAssignments] = useState<any[]>([])
  const [holidays, setHolidays] = useState<any[]>([])
  const [conflicts, setConflicts] = useState<any[]>([])
  const [bankHolidays, setBankHolidays] = useState<Set<string>>(new Set())
  const [bankHolidayNames, setBankHolidayNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  const [view, setView] = useState<'week' | 'day'>('week')
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeekMon(new Date()))
  const [dayDate, setDayDate] = useState<Date>(() => new Date())
  const [justMe, setJustMe] = useState(false)

  const [modalUserId, setModalUserId] = useState<string | null>(null)
  const [modalDate, setModalDate] = useState<Date | null>(null)

  const fetchBankHolidays = async () => {
    try {
      const res = await fetch('https://www.gov.uk/bank-holidays.json')
      if (!res.ok) return
      const data = await res.json()
      const events = data['england-and-wales']?.events || []
      const names: Record<string, string> = {}
      const dates = new Set<string>()
      events.forEach((event: any) => {
        names[event.date] = event.title
        dates.add(event.date)
      })
      setBankHolidays(dates)
      setBankHolidayNames(names)
    } catch (err) {
      console.error('Failed to fetch bank holidays:', err)
    }
  }

  const loadAll = useCallback(async (companyId: string, weekFromISO: string, weekToISO: string) => {
    const [profilesRes, schedsRes, asgsRes, holsRes, docsRes] = await Promise.all([
      supabase
        .from('profiles')
        .select(`id, full_name, role, job_title, employee_number, is_frozen, display_order`)
        .eq('company_id', companyId)
        .eq('is_deleted', false)
        .order('display_order', { ascending: true, nullsFirst: false })
        .order('full_name', { ascending: true }),
      supabase
        .from('schedules')
        .select('*')
        .eq('company_id', companyId),
      supabase
        .from('schedule_assignments')
        .select('*')
        .eq('company_id', companyId)
        .gte('assignment_date', weekFromISO)
        .lte('assignment_date', weekToISO),
      supabase
        .from('holiday_requests')
        .select('id, user_id, request_type, status, start_date, end_date, half_day_type, early_finish_time')
        .eq('company_id', companyId)
        .eq('status', 'approved')
        .lte('start_date', weekToISO)
        .gte('end_date', weekFromISO),
      supabase
        .from('schedule_documents')
        .select('id, schedule_id')
        .eq('company_id', companyId),
    ])

    // Surface load errors instead of silently showing empty data
    if (profilesRes.error) console.error('[calendar] profiles load error:', profilesRes.error)
    if (schedsRes.error)   console.error('[calendar] schedules load error:', schedsRes.error)
    if (asgsRes.error)     console.error('[calendar] assignments load error:', asgsRes.error)
    if (holsRes.error)     console.error('[calendar] holidays load error:', holsRes.error)
    if (docsRes.error)     console.error('[calendar] documents load error:', docsRes.error)

    // schedule_conflict_acknowledgements table isn't in the current schema.
    // Treat all conflicts as unacknowledged for now — the page falls back gracefully.
    const conflictsRes: { data: any[] } = { data: [] }

    const filteredUsers = (profilesRes.data || []).filter((p: any) => p.role !== 'superuser')

    const docsBySchedule: Record<string, number> = {}
    ;(docsRes.data || []).forEach((d: any) => {
      docsBySchedule[d.schedule_id] = (docsBySchedule[d.schedule_id] || 0) + 1
    })
    const schedsWithDocs = (schedsRes.data || []).map((s: any) => ({
      ...s,
      doc_count: docsBySchedule[s.id] || 0,
    }))

    setUsers(filteredUsers)
    setSchedules(schedsWithDocs)
    setAssignments(asgsRes.data || [])
    setHolidays(holsRes.data || [])
    setConflicts(conflictsRes.data || [])
  }, [])

  const init = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }
    const { data: profile } = await supabase
      .from('profiles').select('*').eq('id', user.id).single()
    if (!profile) {
      router.push('/login')
      return
    }
    setCurrentUser(profile)

    if (!profile.company_id) {
      router.push('/dashboard')
      return
    }

    const { data: companyData } = await supabase
      .from('companies')
      .select(`*, company_features (is_enabled, features (name))`)
      .eq('id', profile.company_id)
      .single()
    setCompany(companyData)

    const companyHasSchedules = companyData?.company_features?.some(
      (cf: any) => cf.is_enabled && cf.features?.name === 'Schedules'
    )
    if (!companyHasSchedules) {
      router.push('/dashboard')
      return
    }

    if (profile.role !== 'admin') {
      const { data: userFeats } = await supabase
        .from('user_features')
        .select('is_enabled, features (name)')
        .eq('user_id', user.id)
        .eq('is_enabled', true)
      const userHasSchedules = (userFeats as any[])?.some(
        (uf: any) => uf.features?.name === 'Schedules'
      )
      if (!userHasSchedules) {
        router.push('/dashboard')
        return
      }
    }

    const from = isoDate(weekStart)
    const to = isoDate(addDays(weekStart, 6))
    await loadAll(profile.company_id, from, to)
    setLoading(false)
  }, [router, weekStart, loadAll])

  useEffect(() => {
    init()
    fetchBankHolidays()
  }, [init])

  useEffect(() => {
    if (!currentUser?.company_id) return
    const from = isoDate(weekStart)
    const to = isoDate(addDays(weekStart, 6))
    loadAll(currentUser.company_id, from, to)
  }, [weekStart, currentUser?.company_id, loadAll])

  // Realtime — refetch when any relevant table changes for this company.
  // Wraps the parameterised loadAll into a no-arg refetch.
  const reloadCurrentWeek = useCallback(() => {
    if (!currentUser?.company_id) return
    const from = isoDate(weekStart)
    const to = isoDate(addDays(weekStart, 6))
    loadAll(currentUser.company_id, from, to)
  }, [currentUser?.company_id, weekStart, loadAll])

  useRealtimeRefresh(
    'schedules-calendar-realtime',
    [
      { table: 'schedule_assignments', companyId: currentUser?.company_id || null },
      { table: 'schedules',            companyId: currentUser?.company_id || null },
      { table: 'schedule_documents',   companyId: currentUser?.company_id || null },
      { table: 'holiday_requests',     companyId: currentUser?.company_id || null },
      { table: 'profiles',             companyId: currentUser?.company_id || null },
    ],
    reloadCurrentWeek,
    !!currentUser?.company_id,
  )

  const isAdmin = currentUser?.role === 'admin'
  const isManager = currentUser?.role === 'manager'
  const canEdit = isAdmin || isManager

  const visibleUsers = useMemo(() => {
    if (justMe && currentUser) return users.filter(u => u.id === currentUser.id)
    return users
  }, [users, justMe, currentUser])

  const weekDates: Date[] = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  }, [weekStart])

  const getSchedule = (scheduleId: string) => schedules.find(s => s.id === scheduleId)

  const unresolvedConflictsInWeek = useMemo(() => {
    const weekFrom = isoDate(weekDates[0])
    const weekTo = isoDate(weekDates[6])

    const publishedKeys = new Set(
      assignments
        .filter(a => a.status === 'published')
        .map(a => `${a.schedule_id}|${a.assignment_date}`)
    )

    return conflicts
      .filter(c => {
        const d = c.details?.assignment_date
        const sId = c.details?.schedule_id
        if (!d || !sId) return false
        if (d < weekFrom || d > weekTo) return false
        return !publishedKeys.has(`${sId}|${d}`)
      })
      .map(c => ({
        ...c,
        assignment_date: c.details.assignment_date,
        schedule_id: c.details.schedule_id,
        schedule_name: c.details.schedule_name,
        start_time: c.details.start_time,
        end_time: c.details.end_time,
        original_user_id: c.details.user_id,
      }))
  }, [conflicts, assignments, weekDates])

  const unresolvedConflictsByCell = useMemo(() => {
    const map = new Map<string, any[]>()
    unresolvedConflictsInWeek.forEach(c => {
      const key = `${c.original_user_id}|${c.assignment_date}`
      const arr = map.get(key) || []
      arr.push(c)
      map.set(key, arr)
    })
    return map
  }, [unresolvedConflictsInWeek])

  const holidayFor = (userId: string, d: Date): any | null => {
    const iso = isoDate(d)
    return holidays.find(h =>
      h.user_id === userId &&
      iso >= h.start_date &&
      iso <= h.end_date
    ) || null
  }

  const cellAssignments = (userId: string, d: Date): any[] => {
    const iso = isoDate(d)
    return assignments
      .filter(a => a.user_id === userId && a.assignment_date === iso)
      .filter(a => canEdit ? true : a.status === 'published')
      .sort((a, b) => {
        const sa = getSchedule(a.schedule_id)
        const sb = getSchedule(b.schedule_id)
        const ta = sa?.start_time || ''
        const tb = sb?.start_time || ''
        return ta.localeCompare(tb)
      })
  }

  const isCellReassigned = (asgs: any[]): boolean => {
    return asgs.some(a => a.first_user_id && a.user_id && a.first_user_id !== a.user_id)
  }

  const isBankHol = (d: Date): boolean => bankHolidays.has(isoDate(d))
  const bankHolName = (d: Date): string | null => bankHolidayNames[isoDate(d)] || null

  const goPrevWeek = () => setWeekStart(prev => addDays(prev, -7))
  const goNextWeek = () => setWeekStart(prev => addDays(prev, 7))
  const goToday = () => {
    setWeekStart(startOfWeekMon(new Date()))
    setDayDate(new Date())
  }
  const goPrevDay = () => setDayDate(prev => addDays(prev, -1))
  const goNextDay = () => setDayDate(prev => addDays(prev, 1))

  const weekLabel = `${formatDateLong(weekDates[0])} – ${formatDateLong(weekDates[6])}`

  const renderHolidayLabel = (h: any) => {
    if (h.request_type === 'holiday') {
      if (h.half_day_type) return `Holiday (${h.half_day_type})`
      return 'Holiday'
    }
    if (h.request_type === 'keep_day_off') return 'Day Off'
    if (h.request_type === 'early_finish') return `Early Finish ${formatTime(h.early_finish_time || '')}`
    return 'Off'
  }

  const openCellModal = (userId: string, d: Date) => {
    setModalUserId(userId)
    setModalDate(new Date(d))
  }

  const closeCellModal = () => {
    setModalUserId(null)
    setModalDate(null)
  }

  const modalUser = modalUserId ? users.find(u => u.id === modalUserId) : null
  const modalAsgs = modalUserId && modalDate ? cellAssignments(modalUserId, modalDate) : []
  const modalHol = modalUserId && modalDate ? holidayFor(modalUserId, modalDate) : null
  const modalBankHolName = modalDate ? bankHolName(modalDate) : null
  const modalConflicts = modalUserId && modalDate
    ? unresolvedConflictsByCell.get(`${modalUserId}|${isoDate(modalDate)}`) || []
    : []

  const cellText = (userId: string, d: Date): string => {
    const lines: string[] = []
    const hol = holidayFor(userId, d)
    if (hol) lines.push(renderHolidayLabel(hol))
    const cellAsgs = cellAssignments(userId, d)
    cellAsgs.forEach(a => {
      const s = getSchedule(a.schedule_id)
      if (s) {
        lines.push(`${s.name}: ${formatTime(s.start_time)}-${formatTime(s.end_time)}`)
      }
    })
    if (lines.length === 0) return 'Day Off'
    return lines.join('\n')
  }

  const exportPDF = () => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const generatedOn = new Date().toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })

    // Compact top header: matches example PDF style (small print at top, no big blue block)
    doc.setFontSize(8)
    doc.setTextColor(80)
    doc.setFont('helvetica', 'normal')
    doc.text(`Printed at ${generatedOn}`, 8, 8)

    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(0)
    doc.text(`${company?.name || 'Schedule'} — ${weekLabel}`, pageWidth / 2, 8, { align: 'center' })

    // Single header row with "Name" + 7 weekdays. Column widths fixed and equal.
    const head = [['Name', ...weekDates.map(d => {
      const bh = bankHolName(d)
      const base = `${d.toLocaleDateString('en-GB', { weekday: 'long' })}\n${formatDateShort(d)}`
      return bh ? `${base}\n(${bh})` : base
    })]]
    const body = visibleUsers.map(u => [
      u.full_name + (u.employee_number ? `\n${u.employee_number}` : ''),
      ...weekDates.map(d => cellText(u.id, d)),
    ])

    autoTable(doc, {
      startY: 13,
      head,
      body,
      theme: 'grid',
      // Repeat header row on every page for uniformity
      showHead: 'everyPage',
      // Don't split a single user's row across two pages
      rowPageBreak: 'avoid',
      tableLineColor: [120, 120, 120],
      tableLineWidth: 0.2,
      tableWidth: 281,
      headStyles: {
        fillColor: [240, 240, 240],
        textColor: 0,
        fontStyle: 'bold',
        fontSize: 8,
        halign: 'center',
        valign: 'middle',
        lineColor: [120, 120, 120],
        lineWidth: 0.2,
        cellPadding: 1.5,
      },
      bodyStyles: {
        fontSize: 7,
        cellPadding: 1.5,
        valign: 'top',
        halign: 'left',
        lineColor: [180, 180, 180],
        lineWidth: 0.1,
        textColor: 0,
      },
      columnStyles: {
        0: {
          cellWidth: 38,
          fontStyle: 'bold',
          halign: 'left',
          valign: 'top',
          fillColor: [255, 255, 255],
          textColor: 0,
        },
        1: { cellWidth: 34.7 },
        2: { cellWidth: 34.7 },
        3: { cellWidth: 34.7 },
        4: { cellWidth: 34.7 },
        5: { cellWidth: 34.7 },
        6: { cellWidth: 34.7 },
        7: { cellWidth: 34.7 },
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index > 0) {
          const text = Array.isArray(data.cell.text) ? data.cell.text.join('') : data.cell.text
          if (text === 'Day Off') {
            data.cell.styles.textColor = [120, 120, 120]
            data.cell.styles.fontStyle = 'italic'
            data.cell.styles.halign = 'center'
          }
        }
      },
      didDrawPage: () => {
        const pageNum = doc.getCurrentPageInfo().pageNumber
        const totalPages = doc.getNumberOfPages()
        doc.setFontSize(7)
        doc.setTextColor(120)
        doc.setFont('helvetica', 'normal')
        doc.text(
          `Page ${pageNum} of ${totalPages}`,
          pageWidth - 8,
          pageHeight - 4,
          { align: 'right' }
        )
        doc.setTextColor(0)
      },
      margin: { left: 8, right: 8, top: 13, bottom: 8 },
    })

    doc.save(`schedule-${isoDate(weekDates[0])}-to-${isoDate(weekDates[6])}.pdf`)
  }

  const handlePrint = () => {
    window.print()
  }

  if (loading) {
    return (
      <div className="p-8 text-slate-400 italic">Loading…</div>
    )
  }

  const printDate = new Date().toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  const bankHolsInWeek = weekDates
    .filter(d => isBankHol(d))
    .map(d => ({ date: d, name: bankHolName(d)! }))

  const userName = (id: string) => users.find(u => u.id === id)?.full_name || '(unknown)'

  return (
    <div className="p-6 max-w-[1600px]">

      <div className="mb-4 no-print">
        <button
          onClick={() => router.push('/dashboard/schedules')}
          className="text-xs text-slate-500 hover:text-slate-700 mb-2 inline-flex items-center gap-1"
        >
          ← Back to schedules
        </button>
        <h1 className="text-xl font-bold text-slate-900 mb-0.5">Schedules Calendar</h1>
        <p className="text-xs text-slate-500">{company?.name}</p>
      </div>


      <style jsx global>{`
        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          main { background: white !important; }
          @page { size: A4 landscape; margin: 0.5cm; }

          .print-table-wrap { overflow: visible !important; }
          .print-table-wrap table {
            width: 100% !important;
            table-layout: fixed !important;
            font-size: 8pt !important;
            border-collapse: collapse !important;
          }
          .print-table-wrap th, .print-table-wrap td {
            min-width: 0 !important;
            padding: 3px 4px !important;
            word-break: break-word;
            border: 1px solid #999 !important;
            vertical-align: top !important;
          }
          .print-table-wrap th:first-child, .print-table-wrap td:first-child {
            width: 14% !important;
          }
          .print-table-wrap th:not(:first-child), .print-table-wrap td:not(:first-child) {
            width: 12.28% !important;
          }
          .print-shrink * { font-size: 8pt !important; }
          .print-shrink .text-xs, .print-shrink .text-\\[11px\\], .print-shrink .text-\\[10px\\] {
            font-size: 7pt !important;
          }
          .print-table-wrap .sticky { position: static !important; }

          /* Force single uniform column header style for print — kill the today/bh background */
          .print-table-wrap thead th {
            background: #f0f0f0 !important;
            color: black !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          /* Strip cell highlights so all rows look uniform */
          .print-table-wrap tbody td {
            background: white !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .print-table-wrap tbody td * {
            background: transparent !important;
            color: black !important;
            border: none !important;
            box-shadow: none !important;
          }
          /* Don't break a row across pages */
          .print-table-wrap tr {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          /* Repeat header row on every printed page */
          .print-table-wrap thead { display: table-header-group !important; }
          .print-table-wrap tbody { display: table-row-group !important; }
        }
        .print-only { display: none; }
      `}</style>

      

      {/* Print-only compact header */}
      <div className="print-only px-2 py-1">
        <div className="flex justify-between items-center text-xs">
          <span>Printed at {printDate}</span>
          <span className="font-bold">{company?.name} — {weekLabel}</span>
          <span>&nbsp;</span>
        </div>
      </div>

      <div className="space-y-3">

        {canEdit && unresolvedConflictsInWeek.length > 0 && (
          <div className="bg-red-50 border-2 border-red-300 rounded-xl p-4 no-print">
            <div className="flex items-start gap-3">
              <span className="text-2xl flex-shrink-0">⚠️</span>
              <div className="flex-1">
                <p className="font-bold text-red-800">
                  Reassign needed — {unresolvedConflictsInWeek.length} schedule slot{unresolvedConflictsInWeek.length > 1 ? 's' : ''} unassigned this week
                </p>
                <p className="text-xs text-red-700 mt-1">
                  These shifts were removed when a holiday was approved. Open the Assign page to reassign someone.
                </p>
                <div className="mt-2 space-y-1">
                  {unresolvedConflictsInWeek.map((c) => (
                    <div key={c.id} className="text-xs text-red-800 flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{c.schedule_name || '(unknown)'}</span>
                      <span className="text-red-600">·</span>
                      <span>
                        {new Date(c.assignment_date + 'T00:00:00').toLocaleDateString('en-GB', {
                          weekday: 'short', day: '2-digit', month: 'short',
                        })}
                      </span>
                      <span className="text-red-600">·</span>
                      <span>{formatTime(c.start_time || '')}–{formatTime(c.end_time || '')}</span>
                      <span className="text-red-600">·</span>
                      <span className="italic">was: {userName(c.original_user_id)}</span>
                    </div>
                  ))}
                </div>
                {canEdit && (
                  <button
                    onClick={() => router.push('/dashboard/schedules/assign')}
                    className="mt-3 bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium"
                  >
                    ✏️ Go to Assign Page
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {bankHolsInWeek.length > 0 && (
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 flex items-center gap-3 no-print">
            <span className="text-xl">🎉</span>
            <div className="flex-1 text-sm text-orange-800">
              <span className="font-medium">Bank Holiday this week:</span>{' '}
              {bankHolsInWeek.map((b, i) => (
                <span key={i}>
                  {i > 0 && ', '}
                  {b.name} ({b.date.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })})
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-2 flex flex-wrap items-center gap-2 no-print">
          <div className="flex gap-0.5 bg-slate-100 rounded-md p-0.5">
            <button
              onClick={() => setView('week')}
              className={`px-2 py-1 rounded text-xs font-medium transition ${
                view === 'week' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Week
            </button>
            <button
              onClick={() => setView('day')}
              className={`px-2 py-1 rounded text-xs font-medium transition ${
                view === 'day' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Day
            </button>
          </div>

          {view === 'week' ? (
            <div className="flex items-center gap-0.5">
              <button onClick={goPrevWeek} className="bg-slate-100 hover:bg-slate-200 text-slate-700 w-7 h-7 rounded-md text-xs font-medium">←</button>
              <div className="px-2 py-1 font-medium text-slate-800 text-xs whitespace-nowrap">{weekLabel}</div>
              <button onClick={goNextWeek} className="bg-slate-100 hover:bg-slate-200 text-slate-700 w-7 h-7 rounded-md text-xs font-medium">→</button>
            </div>
          ) : (
            <div className="flex items-center gap-0.5">
              <button onClick={goPrevDay} className="bg-slate-100 hover:bg-slate-200 text-slate-700 w-7 h-7 rounded-md text-xs font-medium">←</button>
              <div className="px-2 py-1 font-medium text-slate-800 text-xs whitespace-nowrap">
                {dayDate.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' })}
              </div>
              <button onClick={goNextDay} className="bg-slate-100 hover:bg-slate-200 text-slate-700 w-7 h-7 rounded-md text-xs font-medium">→</button>
            </div>
          )}

          <button onClick={goToday} className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 px-2 py-1 rounded-md text-xs font-medium">
            Today
          </button>

          <div className="flex-1" />

          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
            <input type="checkbox" checked={justMe} onChange={(e) => setJustMe(e.target.checked)} className="w-3.5 h-3.5" />
            Just me
          </label>

          {view === 'week' && (
            <>
              <button onClick={exportPDF} disabled={visibleUsers.length === 0} className="bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white px-2.5 py-1 rounded-md text-xs font-medium">⬇ PDF</button>
              <button onClick={handlePrint} disabled={visibleUsers.length === 0} className="bg-slate-700 hover:bg-slate-800 disabled:bg-slate-300 text-white px-2.5 py-1 rounded-md text-xs font-medium">🖨 Print</button>
            </>
          )}

          {canEdit && (
            <button onClick={() => router.push('/dashboard/schedules/assign')} className="bg-indigo-600 hover:bg-indigo-700 text-white px-2.5 py-1 rounded-md text-xs font-medium">✏️ Assign</button>
          )}
        </div>

        {view === 'week' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden print-shrink">
            <div className="overflow-x-auto print-table-wrap">
              <table className="w-full border-collapse">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left px-2 py-1.5 text-[10px] font-semibold text-slate-600 uppercase border-b border-slate-200 sticky left-0 bg-slate-50 z-10 min-w-[140px]">
                      Name
                    </th>
                    {weekDates.map((d, i) => {
                      const isToday = isoDate(d) === isoDate(new Date())
                      const bh = bankHolName(d)
                      return (
                        <th
                          key={i}
                          className={`text-center px-1.5 py-1.5 text-[10px] font-semibold uppercase border-b border-slate-200 min-w-[110px] text-slate-600 ${bh ? 'bg-orange-50' : ''}`}
                          title={bh || ''}
                        >
                          <div className="flex items-baseline justify-center gap-1">
                            <span>{d.toLocaleDateString('en-GB', { weekday: 'short' })}</span>
                            {isToday ? (
                              <span className="inline-block bg-blue-600 text-white text-[10px] font-bold normal-case px-1.5 py-0 rounded-full">
                                {formatDateShort(d)}
                              </span>
                            ) : (
                              <span className="text-xs font-bold normal-case">{formatDateShort(d)}</span>
                            )}
                          </div>
                          {bh && (
                            <div className="text-[9px] text-orange-700 normal-case font-medium mt-0.5 truncate" title={bh}>
                              🎉 {bh}
                            </div>
                          )}
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {visibleUsers.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center text-slate-400 py-8 text-xs">
                        No users to show
                      </td>
                    </tr>
                  )}
                  {visibleUsers.map((u) => (
                    <tr key={u.id} className="border-b border-slate-100 last:border-b-0">
                      <td className="px-2 py-1.5 align-top sticky left-0 bg-white z-10 border-r border-slate-100">
                        <p className="font-semibold text-slate-800 text-xs leading-tight">{u.full_name}</p>
                        {u.employee_number && (<p className="text-[10px] text-slate-500 mt-0.5">{u.employee_number}</p>)}
                        {u.is_frozen && (<p className="text-[10px] text-amber-700 font-medium mt-0.5">Frozen</p>)}
                      </td>
                      {weekDates.map((d, i) => {
                        const cellAsgs = cellAssignments(u.id, d)
                        const hol = holidayFor(u.id, d)
                        const hasUnpublished = cellAsgs.some(a => a.is_changed || a.status === 'draft')
                        const wasReassigned = !hasUnpublished && isCellReassigned(cellAsgs)
                        const bh = isBankHol(d)
                        const isEmpty = cellAsgs.length === 0 && !hol
                        const cellConflicts = canEdit
                          ? unresolvedConflictsByCell.get(`${u.id}|${isoDate(d)}`) || []
                          : []
                        const hasConflict = cellConflicts.length > 0

                        return (
                          <td
                            key={i}
                            onClick={() => openCellModal(u.id, d)}
                            className={`px-1 py-1 align-top text-xs border-r border-slate-100 last:border-r-0 cursor-pointer hover:bg-slate-50 transition ${
                              hasConflict ? 'bg-red-50 ring-2 ring-red-300 ring-inset' :
                              hasUnpublished ? 'bg-yellow-100/70' :
                              wasReassigned ? 'bg-yellow-50/70' :
                              bh ? 'bg-orange-50/50' : ''
                            }`}
                          >
                            {hasConflict && (
                              <div className="bg-red-100 border border-red-300 text-red-800 rounded px-1.5 py-0.5 text-[10px] font-semibold mb-0.5 flex items-center gap-1 no-print">
                                <span>⚠️</span>
                                <span>Reassign</span>
                              </div>
                            )}

                            {hol ? (
                              <div className={`px-1.5 py-0.5 rounded font-medium text-[10px] mb-0.5 ${
                                hol.request_type === 'holiday' ? 'bg-red-100 text-red-700' :
                                hol.request_type === 'keep_day_off' ? 'bg-purple-100 text-purple-700' :
                                'bg-amber-100 text-amber-700'
                              }`}>
                                {renderHolidayLabel(hol)}
                              </div>
                            ) : null}

                            {isEmpty && !hasConflict && (
                              <div className="px-1.5 py-0.5 rounded text-[10px] leading-tight bg-slate-50 border border-slate-200 text-slate-400 italic text-center">
                                Day Off
                              </div>
                            )}

                            <div className="space-y-0.5">
                              {cellAsgs.map(a => {
                                const sched = getSchedule(a.schedule_id)
                                const reassigned = a.first_user_id && a.user_id && a.first_user_id !== a.user_id
                                return (
                                  <div
                                    key={a.id}
                                    className={`px-1.5 py-0.5 rounded text-[10px] leading-tight ${
                                      a.status === 'draft' ? 'bg-amber-50 border border-amber-200 text-amber-800' :
                                      a.is_changed ? 'bg-yellow-100 border border-yellow-300 text-yellow-900' :
                                      reassigned ? 'bg-yellow-50 border border-yellow-200 text-yellow-900' :
                                      'bg-blue-50 border border-blue-100 text-blue-900'
                                    }`}
                                  >
                                    <p className="font-semibold truncate">
                                      {sched?.name || '(unknown schedule)'}
                                      {sched && (
                                        <span className="font-normal text-[9px] ml-1">
                                          {formatTime(sched.start_time)}-{formatTime(sched.end_time)}
                                        </span>
                                      )}
                                    </p>
                                  </div>
                                )
                              })}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {view === 'day' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden no-print">
            {bankHolName(dayDate) && (
              <div className="bg-orange-50 border-b border-orange-200 px-4 py-2 text-sm text-orange-800 font-medium">
                🎉 Bank Holiday: {bankHolName(dayDate)}
              </div>
            )}
            <div className="divide-y divide-slate-100">
              {visibleUsers.length === 0 ? (
                <div className="text-center text-slate-400 py-12 text-sm">No users to show</div>
              ) : (
                visibleUsers.map((u) => {
                  const cellAsgs = cellAssignments(u.id, dayDate)
                  const hol = holidayFor(u.id, dayDate)
                  const hasUnpublished = cellAsgs.some(a => a.is_changed || a.status === 'draft')
                  const wasReassigned = !hasUnpublished && isCellReassigned(cellAsgs)
                  const isEmpty = cellAsgs.length === 0 && !hol
                  const cellConflicts = canEdit
                    ? unresolvedConflictsByCell.get(`${u.id}|${isoDate(dayDate)}`) || []
                    : []
                  const hasConflict = cellConflicts.length > 0

                  return (
                    <div
                      key={u.id}
                      onClick={() => openCellModal(u.id, dayDate)}
                      className={`p-4 flex gap-4 cursor-pointer hover:bg-slate-50 transition ${
                        hasConflict ? 'bg-red-50 ring-2 ring-red-300 ring-inset' :
                        hasUnpublished ? 'bg-yellow-100/60' :
                        wasReassigned ? 'bg-yellow-50' : ''
                      }`}
                    >
                      <div className="w-40 flex-shrink-0">
                        <p className="font-semibold text-slate-800 text-sm">{u.full_name}</p>
                        {u.employee_number && (<p className="text-xs text-slate-500 mt-0.5">{u.employee_number}</p>)}
                      </div>
                      <div className="flex-1 flex flex-wrap gap-2">
                        {hasConflict && (
                          <div className="bg-red-100 border border-red-300 text-red-800 rounded px-3 py-1.5 text-xs font-semibold flex items-center gap-1">
                            <span>⚠️</span>
                            <span>Reassign needed</span>
                          </div>
                        )}
                        {hol && (
                          <div className={`px-3 py-1.5 rounded font-medium text-xs ${
                            hol.request_type === 'holiday' ? 'bg-red-100 text-red-700' :
                            hol.request_type === 'keep_day_off' ? 'bg-purple-100 text-purple-700' :
                            'bg-amber-100 text-amber-700'
                          }`}>
                            {renderHolidayLabel(hol)}
                          </div>
                        )}
                        {isEmpty && !hasConflict && (
                          <div className="px-3 py-1.5 rounded text-xs bg-slate-50 border border-slate-200 text-slate-500 italic">
                            Day Off
                          </div>
                        )}
                        {cellAsgs.map(a => {
                          const sched = getSchedule(a.schedule_id)
                          const reassigned = a.first_user_id && a.user_id && a.first_user_id !== a.user_id
                          return (
                            <div
                              key={a.id}
                              className={`px-3 py-1.5 rounded text-xs ${
                                a.status === 'draft' ? 'bg-amber-50 border border-amber-200 text-amber-800' :
                                a.is_changed ? 'bg-yellow-100 border border-yellow-300 text-yellow-900' :
                                reassigned ? 'bg-yellow-50 border border-yellow-200 text-yellow-900' :
                                'bg-blue-50 border border-blue-100 text-blue-900'
                              }`}
                            >
                              <p className="font-semibold">{sched?.name || '(unknown)'}</p>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-3 flex flex-wrap gap-3 text-xs no-print">
          <span className="font-medium text-slate-600">Legend:</span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-blue-50 border border-blue-100 inline-block"></span>
            <span className="text-slate-600">Published</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-amber-50 border border-amber-200 inline-block"></span>
            <span className="text-slate-600">Draft</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-yellow-100 inline-block"></span>
            <span className="text-slate-600">Unpublished change</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-yellow-50 border border-yellow-200 inline-block"></span>
            <span className="text-slate-600">Reassigned</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-orange-50 inline-block"></span>
            <span className="text-slate-600">Bank Holiday</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-red-100 inline-block"></span>
            <span className="text-slate-600">Holiday</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-purple-100 inline-block"></span>
            <span className="text-slate-600">Day Off (booked)</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-slate-50 border border-slate-200 inline-block"></span>
            <span className="text-slate-600">Day Off (unassigned)</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-red-100 ring-2 ring-red-300 inline-block"></span>
            <span className="text-slate-600">Reassign needed</span>
          </span>
          <span className="ml-auto text-slate-500 italic">Click any cell for details</span>
        </div>
      </div>

      {modalUserId && modalDate && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 no-print" onClick={closeCellModal}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 space-y-4">
              <div className="flex justify-between items-start gap-3">
                <div>
                  <h2 className="text-xl font-bold text-slate-800">{modalUser?.full_name}</h2>
                  <p className="text-sm text-slate-500 mt-0.5">{formatDateFull(modalDate)}</p>
                  {modalUser?.employee_number && (<p className="text-xs text-slate-500 mt-0.5">{modalUser.employee_number}</p>)}
                </div>
                <button onClick={closeCellModal} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
              </div>

              {modalConflicts.length > 0 && canEdit && (
                <div className="bg-red-50 border-2 border-red-300 rounded-xl p-3">
                  <p className="text-sm font-bold text-red-800 flex items-center gap-2">
                    <span>⚠️</span> Reassign needed
                  </p>
                  <p className="text-xs text-red-700 mt-1">
                    {modalConflicts.length} schedule{modalConflicts.length > 1 ? 's' : ''} unassigned for this slot — original holder went on holiday:
                  </p>
                  <div className="mt-2 space-y-1">
                    {modalConflicts.map((c: any) => (
                      <div key={c.id} className="text-xs text-red-800">
                        • <span className="font-semibold">{c.schedule_name}</span> ({formatTime(c.start_time || '')}–{formatTime(c.end_time || '')})
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {modalBankHolName && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 flex items-center gap-2">
                  <span className="text-xl">🎉</span>
                  <p className="text-sm text-orange-800 font-medium">Bank Holiday — {modalBankHolName}</p>
                </div>
              )}

              {modalAsgs.length === 0 && !modalHol && modalConflicts.length === 0 && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center">
                  <p className="text-slate-700 font-medium">Day Off</p>
                  <p className="text-xs text-slate-500 mt-1">No schedule assigned for this day.</p>
                </div>
              )}

              {modalHol && (
                <div className={`p-4 rounded-xl border ${
                  modalHol.request_type === 'holiday' ? 'bg-red-50 border-red-200' :
                  modalHol.request_type === 'keep_day_off' ? 'bg-purple-50 border-purple-200' :
                  'bg-amber-50 border-amber-200'
                }`}>
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">
                      {modalHol.request_type === 'holiday' ? '🏖️' : modalHol.request_type === 'keep_day_off' ? '🚫' : '🕓'}
                    </span>
                    <div className="flex-1">
                      <p className={`font-semibold ${
                        modalHol.request_type === 'holiday' ? 'text-red-800' :
                        modalHol.request_type === 'keep_day_off' ? 'text-purple-800' :
                        'text-amber-800'
                      }`}>
                        {renderHolidayLabel(modalHol)}
                      </p>
                      <p className="text-xs text-slate-600 mt-0.5">
                        {modalHol.start_date === modalHol.end_date
                          ? formatDateLong(new Date(modalHol.start_date + 'T00:00:00'))
                          : `${formatDateLong(new Date(modalHol.start_date + 'T00:00:00'))} → ${formatDateLong(new Date(modalHol.end_date + 'T00:00:00'))}`}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {modalAsgs.length > 0 && (
                <div className="space-y-2">
                  {modalAsgs.map(a => {
                    const sched = getSchedule(a.schedule_id)
                    if (!sched) return null
                    const reassigned = a.first_user_id && a.user_id && a.first_user_id !== a.user_id
                    const statusClass = a.status === 'draft' ? 'border-amber-200 bg-amber-50' :
                      a.is_changed ? 'border-yellow-300 bg-yellow-50' :
                      reassigned ? 'border-yellow-200 bg-yellow-50/50' :
                      'border-slate-200 bg-white'

                    const recurringDays = sched.recurring_days
                      ? Object.entries(sched.recurring_days).filter(([_, v]) => v).map(([k]) => DAY_LABELS[k])
                      : []

                    return (
                      <button
                        key={a.id}
                        onClick={() => router.push(`/dashboard/schedules/${sched.id}`)}
                        className={`w-full text-left border rounded-xl p-4 hover:shadow-md transition ${statusClass}`}
                      >
                        <div className="flex items-start gap-2">
                          <span className="text-xl flex-shrink-0">{sched.schedule_type === 'recurring' ? '🔁' : '📅'}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold text-slate-800">{sched.name}</p>
                              {a.status === 'draft' && (<span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">Draft</span>)}
                              {a.is_changed && (<span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-200 text-yellow-800 font-medium">Unpublished change</span>)}
                              {!a.is_changed && reassigned && (<span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 font-medium">Reassigned</span>)}
                            </div>

                            {sched.description && (<p className="text-xs text-slate-600 mt-1">{sched.description}</p>)}

                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-700 mt-2">
                              <span>🕐 {formatTime(sched.start_time)}–{formatTime(sched.end_time)}</span>
                              {sched.schedule_type === 'one_off' && sched.start_date && (
                                <span>
                                  📆 {sched.start_date === sched.end_date
                                    ? formatDateShort(new Date(sched.start_date + 'T00:00:00'))
                                    : `${formatDateShort(new Date(sched.start_date + 'T00:00:00'))}–${formatDateShort(new Date(sched.end_date + 'T00:00:00'))}`}
                                </span>
                              )}
                              {sched.doc_count > 0 && (<span>📎 {sched.doc_count}</span>)}
                            </div>

                            {sched.schedule_type === 'recurring' && recurringDays.length > 0 && (
                              <div className="flex gap-1 flex-wrap mt-2">
                                {recurringDays.map(d => (
                                  <span key={d} className="text-[10px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">{d}</span>
                                ))}
                              </div>
                            )}

                            <p className="text-[10px] text-slate-400 mt-2">Click to open schedule details →</p>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}

              <div className="flex gap-2 pt-3 border-t border-slate-100">
                {canEdit && (
                  <button onClick={() => router.push('/dashboard/schedules/assign')} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
                    ✏️ Go to Assign Page
                  </button>
                )}
                <button onClick={closeCellModal} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium">
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
