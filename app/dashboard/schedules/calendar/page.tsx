'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useIdleLogout, IdleWarningModal } from '@/lib/useIdleLogout'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

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
  const [bankHolidays, setBankHolidays] = useState<Set<string>>(new Set())
  const [bankHolidayNames, setBankHolidayNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  const [view, setView] = useState<'week' | 'day'>('week')
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeekMon(new Date()))
  const [dayDate, setDayDate] = useState<Date>(() => new Date())
  const [justMe, setJustMe] = useState(false)

  const [modalUserId, setModalUserId] = useState<string | null>(null)
  const [modalDate, setModalDate] = useState<Date | null>(null)

  const { showWarning, secondsLeft, stayLoggedIn } = useIdleLogout(true)

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
        .select(`id, full_name, role, job_title, display_order, is_frozen`)
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

  useEffect(() => {
    if (!currentUser?.company_id) return
    const channel = supabase
      .channel('schedules-calendar-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule_assignments', filter: `company_id=eq.${currentUser.company_id}` }, () => {
        const from = isoDate(weekStart)
        const to = isoDate(addDays(weekStart, 6))
        loadAll(currentUser.company_id, from, to)
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [currentUser?.company_id, weekStart, loadAll])

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

  const cellText = (userId: string, d: Date): string => {
    const lines: string[] = []
    const hol = holidayFor(userId, d)
    if (hol) lines.push(renderHolidayLabel(hol))
    const cellAsgs = cellAssignments(userId, d)
    cellAsgs.forEach(a => {
      const s = getSchedule(a.schedule_id)
      if (s) {
        lines.push(`${s.name}\n${formatTime(s.start_time)}–${formatTime(s.end_time)}`)
      }
    })
    if (lines.length === 0) return 'Day Off'
    return lines.join('\n\n')
  }

  const exportPDF = () => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const generatedOn = new Date().toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })

    doc.setFontSize(16)
    doc.setFont('helvetica', 'bold')
    doc.text(company?.name || 'Company', 14, 14)

    doc.setFontSize(11)
    doc.setFont('helvetica', 'normal')
    doc.text(`Schedule Calendar — ${weekLabel}`, 14, 20)

    doc.setFontSize(8)
    doc.setTextColor(110)
    doc.text(`Generated: ${generatedOn}`, pageWidth - 14, 14, { align: 'right' })
    doc.setTextColor(0)

    const head = [['Name', ...weekDates.map(d => {
      const bh = bankHolName(d)
      const base = `${d.toLocaleDateString('en-GB', { weekday: 'short' })}\n${formatDateShort(d)}`
      return bh ? `${base}\n(${bh})` : base
    })]]
    const body = visibleUsers.map(u => [
      u.full_name + (u.job_title ? `\n${u.job_title}` : ''),
      ...weekDates.map(d => cellText(u.id, d)),
    ])

    autoTable(doc, {
      startY: 26,
      head,
      body,
      theme: 'grid',
      tableLineColor: [180, 180, 180],
      tableLineWidth: 0.2,
      headStyles: {
        fillColor: [29, 78, 216],
        textColor: 255,
        fontStyle: 'bold',
        fontSize: 8,
        halign: 'center',
        valign: 'middle',
        lineColor: [180, 180, 180],
        lineWidth: 0.2,
        cellPadding: 2,
      },
      bodyStyles: {
        fontSize: 7,
        cellPadding: 2,
        valign: 'middle',
        halign: 'center',
        lineColor: [220, 220, 220],
        lineWidth: 0.1,
        minCellHeight: 14,
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: {
          cellWidth: 35,
          fontStyle: 'bold',
          halign: 'left',
          valign: 'middle',
          fillColor: [243, 244, 246],
          textColor: [30, 30, 30],
        },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 'auto' },
        3: { cellWidth: 'auto' },
        4: { cellWidth: 'auto' },
        5: { cellWidth: 'auto' },
        6: { cellWidth: 'auto' },
        7: { cellWidth: 'auto' },
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index > 0) {
          const text = Array.isArray(data.cell.text) ? data.cell.text.join('') : data.cell.text
          if (text === 'Day Off') {
            data.cell.styles.textColor = [150, 150, 150]
            data.cell.styles.fontStyle = 'italic'
          }
        }
      },
      didDrawPage: () => {
        const pageCount = doc.getNumberOfPages()
        const pageNum = doc.getCurrentPageInfo().pageNumber
        const pageHeight = doc.internal.pageSize.getHeight()
        doc.setFontSize(8)
        doc.setTextColor(150)
        doc.text(
          `Page ${pageNum} of ${pageCount}`,
          pageWidth - 14,
          pageHeight - 8,
          { align: 'right' }
        )
        doc.setTextColor(0)
      },
      margin: { left: 8, right: 8, top: 26, bottom: 14 },
    })

    doc.save(`schedule-${isoDate(weekDates[0])}-to-${isoDate(weekDates[6])}.pdf`)
  }

  const handlePrint = () => {
    window.print()
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-500">Loading calendar...</p>
      </main>
    )
  }

  const printDate = new Date().toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  const bankHolsInWeek = weekDates
    .filter(d => isBankHol(d))
    .map(d => ({ date: d, name: bankHolName(d)! }))

  return (
    <main className="min-h-screen bg-gray-100">
      <IdleWarningModal show={showWarning} secondsLeft={secondsLeft} onStay={stayLoggedIn} />

      <style jsx global>{`
        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          main { background: white !important; }
          @page { size: A4 landscape; margin: 0.5cm; }

          .print-table-wrap { overflow: visible !important; }
          .print-table-wrap table { width: 100% !important; table-layout: fixed !important; font-size: 8pt !important; }
          .print-table-wrap th, .print-table-wrap td {
            min-width: 0 !important;
            padding: 3px 4px !important;
            word-break: break-word;
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
        }
        .print-only { display: none; }
      `}</style>

      <div className="bg-blue-700 text-white px-6 py-4 flex justify-between items-center no-print">
        <div>
          <h1 className="text-2xl font-bold">{company?.name}</h1>
          <p className="text-blue-200 text-sm">Schedule Calendar</p>
        </div>
        <button
          onClick={() => router.push('/dashboard/schedules')}
          className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm"
        >
          ← Back
        </button>
      </div>

      <div className="print-only px-6 py-4 border-b border-gray-300">
        <h1 className="text-2xl font-bold text-gray-900">{company?.name}</h1>
        <p className="text-sm text-gray-700">Schedule Calendar — {weekLabel}</p>
        <div className="flex justify-between text-xs text-gray-600 mt-2">
          <span>Generated: {printDate}</span>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto p-4 md:p-6 space-y-4">

        {bankHolsInWeek.length > 0 && (
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 flex items-center gap-3">
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

        <div className="bg-white rounded-xl shadow p-3 flex flex-wrap items-center gap-3 no-print">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setView('week')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                view === 'week' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Week
            </button>
            <button
              onClick={() => setView('day')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                view === 'day' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Day
            </button>
          </div>

          {view === 'week' ? (
            <div className="flex items-center gap-1">
              <button onClick={goPrevWeek} className="bg-gray-100 hover:bg-gray-200 text-gray-700 w-9 h-9 rounded-lg text-sm font-medium">←</button>
              <div className="px-3 py-1.5 font-medium text-gray-800 text-sm whitespace-nowrap">{weekLabel}</div>
              <button onClick={goNextWeek} className="bg-gray-100 hover:bg-gray-200 text-gray-700 w-9 h-9 rounded-lg text-sm font-medium">→</button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <button onClick={goPrevDay} className="bg-gray-100 hover:bg-gray-200 text-gray-700 w-9 h-9 rounded-lg text-sm font-medium">←</button>
              <div className="px-3 py-1.5 font-medium text-gray-800 text-sm whitespace-nowrap">
                {dayDate.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' })}
              </div>
              <button onClick={goNextDay} className="bg-gray-100 hover:bg-gray-200 text-gray-700 w-9 h-9 rounded-lg text-sm font-medium">→</button>
            </div>
          )}

          <button onClick={goToday} className="bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-medium">
            Today
          </button>

          <div className="flex-1" />

          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input type="checkbox" checked={justMe} onChange={(e) => setJustMe(e.target.checked)} className="w-4 h-4" />
            Just me
          </label>

          {view === 'week' && (
            <>
              <button onClick={exportPDF} disabled={visibleUsers.length === 0} className="bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white px-3 py-1.5 rounded-lg text-xs font-medium">⬇ PDF</button>
              <button onClick={handlePrint} disabled={visibleUsers.length === 0} className="bg-gray-700 hover:bg-gray-800 disabled:bg-gray-300 text-white px-3 py-1.5 rounded-lg text-xs font-medium">🖨 Print</button>
            </>
          )}

          {canEdit && (
            <button onClick={() => router.push('/dashboard/schedules/assign')} className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium">✏️ Assign</button>
          )}
        </div>

        {view === 'week' && (
          <div className="bg-white rounded-xl shadow overflow-hidden print-shrink">
            <div className="overflow-x-auto print-table-wrap">
              <table className="w-full border-collapse">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-3 text-xs font-semibold text-gray-600 uppercase border-b border-gray-200 sticky left-0 bg-gray-50 z-10 min-w-[160px]">
                      Name
                    </th>
                    {weekDates.map((d, i) => {
                      const isToday = isoDate(d) === isoDate(new Date())
                      const bh = bankHolName(d)
                      return (
                        <th
                          key={i}
                          className={`text-left px-3 py-3 text-xs font-semibold uppercase border-b border-gray-200 min-w-[140px] text-gray-600 ${bh ? 'bg-orange-50' : ''}`}
                          title={bh || ''}
                        >
                          <div>{d.toLocaleDateString('en-GB', { weekday: 'short' })}</div>
                          <div className="mt-0.5">
                            {isToday ? (
                              <span className="inline-block bg-blue-600 text-white text-sm font-bold normal-case px-2 py-0.5 rounded-full">
                                {formatDateShort(d)}
                              </span>
                            ) : (
                              <span className="text-sm font-bold normal-case">{formatDateShort(d)}</span>
                            )}
                          </div>
                          {bh && (
                            <div className="text-[10px] text-orange-700 normal-case font-medium mt-1 truncate" title={bh}>
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
                      <td colSpan={8} className="text-center text-gray-400 py-12 text-sm">
                        No users to show
                      </td>
                    </tr>
                  )}
                  {visibleUsers.map((u) => (
                    <tr key={u.id} className="border-b border-gray-100 last:border-b-0">
                      <td className="px-3 py-3 align-top sticky left-0 bg-white z-10 border-r border-gray-100">
                        <p className="font-semibold text-gray-800 text-sm leading-tight">{u.full_name}</p>
                        {u.job_title && (<p className="text-[11px] text-gray-500 mt-0.5">{u.job_title}</p>)}
                        {u.is_frozen && (<p className="text-[10px] text-amber-700 font-medium mt-0.5">Frozen</p>)}
                      </td>
                      {weekDates.map((d, i) => {
                        const cellAsgs = cellAssignments(u.id, d)
                        const hol = holidayFor(u.id, d)
                        const hasUnpublished = cellAsgs.some(a => a.is_changed || a.status === 'draft')
                        const wasReassigned = !hasUnpublished && isCellReassigned(cellAsgs)
                        const bh = isBankHol(d)
                        const isEmpty = cellAsgs.length === 0 && !hol

                        return (
                          <td
                            key={i}
                            onClick={() => openCellModal(u.id, d)}
                            className={`px-2 py-2 align-top text-xs border-r border-gray-100 last:border-r-0 cursor-pointer hover:bg-gray-50 transition ${
                              hasUnpublished ? 'bg-yellow-100/70' : wasReassigned ? 'bg-yellow-50/70' : bh ? 'bg-orange-50/50' : ''
                            }`}
                          >
                            {hol ? (
                              <div className={`px-2 py-1 rounded font-medium text-[11px] mb-1 ${
                                hol.request_type === 'holiday' ? 'bg-red-100 text-red-700' :
                                hol.request_type === 'keep_day_off' ? 'bg-purple-100 text-purple-700' :
                                'bg-amber-100 text-amber-700'
                              }`}>
                                {renderHolidayLabel(hol)}
                              </div>
                            ) : null}

                            {isEmpty && (
                              <div className="px-2 py-1 rounded text-[11px] leading-tight bg-gray-50 border border-gray-200 text-gray-500 italic text-center">
                                Day Off
                              </div>
                            )}

                            <div className="space-y-1">
                              {cellAsgs.map(a => {
                                const sched = getSchedule(a.schedule_id)
                                const reassigned = a.first_user_id && a.user_id && a.first_user_id !== a.user_id
                                return (
                                  <div
                                    key={a.id}
                                    className={`px-2 py-1 rounded text-[11px] leading-tight ${
                                      a.status === 'draft' ? 'bg-amber-50 border border-amber-200 text-amber-800' :
                                      a.is_changed ? 'bg-yellow-100 border border-yellow-300 text-yellow-900' :
                                      reassigned ? 'bg-yellow-50 border border-yellow-200 text-yellow-900' :
                                      'bg-blue-50 border border-blue-100 text-blue-900'
                                    }`}
                                  >
                                    <p className="font-semibold truncate">{sched?.name || '(unknown schedule)'}</p>
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
          <div className="bg-white rounded-xl shadow overflow-hidden no-print">
            {bankHolName(dayDate) && (
              <div className="bg-orange-50 border-b border-orange-200 px-4 py-2 text-sm text-orange-800 font-medium">
                🎉 Bank Holiday: {bankHolName(dayDate)}
              </div>
            )}
            <div className="divide-y divide-gray-100">
              {visibleUsers.length === 0 ? (
                <div className="text-center text-gray-400 py-12 text-sm">No users to show</div>
              ) : (
                visibleUsers.map((u) => {
                  const cellAsgs = cellAssignments(u.id, dayDate)
                  const hol = holidayFor(u.id, dayDate)
                  const hasUnpublished = cellAsgs.some(a => a.is_changed || a.status === 'draft')
                  const wasReassigned = !hasUnpublished && isCellReassigned(cellAsgs)
                  const isEmpty = cellAsgs.length === 0 && !hol

                  return (
                    <div
                      key={u.id}
                      onClick={() => openCellModal(u.id, dayDate)}
                      className={`p-4 flex gap-4 cursor-pointer hover:bg-gray-50 transition ${
                        hasUnpublished ? 'bg-yellow-100/60' : wasReassigned ? 'bg-yellow-50' : ''
                      }`}
                    >
                      <div className="w-40 flex-shrink-0">
                        <p className="font-semibold text-gray-800 text-sm">{u.full_name}</p>
                        {u.job_title && (<p className="text-xs text-gray-500 mt-0.5">{u.job_title}</p>)}
                      </div>
                      <div className="flex-1 flex flex-wrap gap-2">
                        {hol && (
                          <div className={`px-3 py-1.5 rounded font-medium text-xs ${
                            hol.request_type === 'holiday' ? 'bg-red-100 text-red-700' :
                            hol.request_type === 'keep_day_off' ? 'bg-purple-100 text-purple-700' :
                            'bg-amber-100 text-amber-700'
                          }`}>
                            {renderHolidayLabel(hol)}
                          </div>
                        )}
                        {isEmpty && (
                          <div className="px-3 py-1.5 rounded text-xs bg-gray-50 border border-gray-200 text-gray-500 italic">
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

        <div className="bg-white rounded-xl shadow p-3 flex flex-wrap gap-3 text-xs no-print">
          <span className="font-medium text-gray-600">Legend:</span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-blue-50 border border-blue-100 inline-block"></span>
            <span className="text-gray-600">Published</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-amber-50 border border-amber-200 inline-block"></span>
            <span className="text-gray-600">Draft</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-yellow-100 inline-block"></span>
            <span className="text-gray-600">Unpublished change</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-yellow-50 border border-yellow-200 inline-block"></span>
            <span className="text-gray-600">Reassigned</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-orange-50 inline-block"></span>
            <span className="text-gray-600">Bank Holiday</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-red-100 inline-block"></span>
            <span className="text-gray-600">Holiday</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-purple-100 inline-block"></span>
            <span className="text-gray-600">Day Off (booked)</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-gray-50 border border-gray-200 inline-block"></span>
            <span className="text-gray-600">Day Off (unassigned)</span>
          </span>
          <span className="ml-auto text-gray-500 italic">Click any cell for details</span>
        </div>
      </div>

      {modalUserId && modalDate && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 no-print" onClick={closeCellModal}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 space-y-4">
              <div className="flex justify-between items-start gap-3">
                <div>
                  <h2 className="text-xl font-bold text-gray-800">{modalUser?.full_name}</h2>
                  <p className="text-sm text-gray-500 mt-0.5">{formatDateFull(modalDate)}</p>
                  {modalUser?.job_title && (<p className="text-xs text-gray-500 mt-0.5">{modalUser.job_title}</p>)}
                </div>
                <button onClick={closeCellModal} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
              </div>

              {modalBankHolName && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 flex items-center gap-2">
                  <span className="text-xl">🎉</span>
                  <p className="text-sm text-orange-800 font-medium">Bank Holiday — {modalBankHolName}</p>
                </div>
              )}

              {modalAsgs.length === 0 && !modalHol && (
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
                  <p className="text-gray-700 font-medium">Day Off</p>
                  <p className="text-xs text-gray-500 mt-1">No schedule assigned for this day.</p>
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
                      <p className="text-xs text-gray-600 mt-0.5">
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
                      'border-gray-200 bg-white'

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
                              <p className="font-semibold text-gray-800">{sched.name}</p>
                              {a.status === 'draft' && (<span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">Draft</span>)}
                              {a.is_changed && (<span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-200 text-yellow-800 font-medium">Unpublished change</span>)}
                              {!a.is_changed && reassigned && (<span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 font-medium">Reassigned</span>)}
                            </div>

                            {sched.description && (<p className="text-xs text-gray-600 mt-1">{sched.description}</p>)}

                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-700 mt-2">
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
                                  <span key={d} className="text-[10px] bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded">{d}</span>
                                ))}
                              </div>
                            )}

                            <p className="text-[10px] text-gray-400 mt-2">Click to open schedule details →</p>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}

              <div className="flex gap-2 pt-3 border-t border-gray-100">
                {canEdit && (
                  <button onClick={() => router.push('/dashboard/schedules/assign')} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
                    ✏️ Go to Assign Page
                  </button>
                )}
                <button onClick={closeCellModal} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium">
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}