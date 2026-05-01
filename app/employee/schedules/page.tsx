'use client'

/**
 * /employee/schedules — employee mobile schedule view.
 *
 * Two modes:
 *   • "My Schedule" — the user's own assignments + holidays for the week
 *   • "Everyone"    — every employee's assignments + holidays for the week
 *
 * The "Everyone" toggle is only visible if the user has the
 * can_view_all permission on the Schedules feature (set by admin in
 * Feature Access). Without it, only the personal view is available.
 *
 * Mobile-first card-per-day layout. Each day shows either the user's
 * own row, or a list of rows (one per person who has something that
 * day) when in everyone mode. Persons with no assignment AND no
 * holiday are not listed.
 */

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useIdleLogout, IdleWarningModal } from '@/lib/useIdleLogout'

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

const formatDateLong = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

const formatDateShort = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })

const formatTime = (t: string) => t?.slice(0, 5) || ''

const formatBytes = (b: number) => {
  if (!b) return ''
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

const getFileIcon = (mime: string | null) => {
  if (!mime) return '📄'
  if (mime.startsWith('image/')) return '🖼️'
  if (mime === 'application/pdf') return '📕'
  if (mime.includes('word') || mime.includes('document')) return '📝'
  if (mime.includes('sheet') || mime.includes('excel')) return '📊'
  return '📄'
}

type ViewMode = 'mine' | 'everyone'

export default function EmployeeSchedulePage() {
  const router = useRouter()

  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [schedules, setSchedules] = useState<any[]>([])
  const [assignments, setAssignments] = useState<any[]>([])
  const [holidays, setHolidays] = useState<any[]>([])
  const [companyUsers, setCompanyUsers] = useState<any[]>([])  // for everyone mode
  const [bankHolidays, setBankHolidays] = useState<Set<string>>(new Set())
  const [bankHolidayNames, setBankHolidayNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  // Permission flags
  const [canViewAll, setCanViewAll] = useState(false)

  // View mode — controls whether we show only the user's row or everyone's.
  const [viewMode, setViewMode] = useState<ViewMode>('mine')

  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeekMon(new Date()))

  const [openSchedule, setOpenSchedule] = useState<any | null>(null)
  const [openDocs, setOpenDocs] = useState<any[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [docMessage, setDocMessage] = useState('')

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

  // Loads the data needed for the current view mode.
  // - 'mine':     just the user's own assignments + holidays for the week
  // - 'everyone': every assignment + holiday in the company for the week,
  //               plus the list of company users so we can render names
  const loadAll = useCallback(async (
    userId: string,
    companyId: string,
    weekFromISO: string,
    weekToISO: string,
    mode: ViewMode,
  ) => {
    const schedulesP = supabase
      .from('schedules').select('*').eq('company_id', companyId)

    const asgsP = mode === 'everyone'
      ? supabase
          .from('schedule_assignments')
          .select('*')
          .eq('company_id', companyId)
          .eq('status', 'published')
          .gte('assignment_date', weekFromISO)
          .lte('assignment_date', weekToISO)
      : supabase
          .from('schedule_assignments')
          .select('*')
          .eq('company_id', companyId)
          .eq('user_id', userId)
          .eq('status', 'published')
          .gte('assignment_date', weekFromISO)
          .lte('assignment_date', weekToISO)

    const holsP = mode === 'everyone'
      ? supabase
          .from('holiday_requests')
          .select('id, user_id, request_type, status, start_date, end_date, half_day_type, early_finish_time')
          .eq('company_id', companyId)
          .eq('status', 'approved')
          .lte('start_date', weekToISO)
          .gte('end_date', weekFromISO)
      : supabase
          .from('holiday_requests')
          .select('id, user_id, request_type, status, start_date, end_date, half_day_type, early_finish_time')
          .eq('company_id', companyId)
          .eq('user_id', userId)
          .eq('status', 'approved')
          .lte('start_date', weekToISO)
          .gte('end_date', weekFromISO)

    const usersP = mode === 'everyone'
      ? supabase
          .from('profiles')
          .select('id, full_name, role, job_title, display_order')
          .eq('company_id', companyId)
          .eq('is_deleted', false)
          .eq('is_frozen', false)
          .order('display_order', { ascending: true, nullsFirst: false })
          .order('full_name', { ascending: true })
      : Promise.resolve({ data: [] as any[] })

    const [schedsRes, asgsRes, holsRes, usersRes] = await Promise.all([
      schedulesP, asgsP, holsP, usersP,
    ])

    setSchedules(schedsRes.data || [])
    setAssignments(asgsRes.data || [])
    setHolidays(holsRes.data || [])
    setCompanyUsers(usersRes.data || [])
  }, [])

  const init = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    if (!profile) { router.push('/login'); return }
    setCurrentUser(profile)
    if (!profile.company_id) { router.push('/employee'); return }

    const { data: companyData } = await supabase
      .from('companies')
      .select(`*, company_features (is_enabled, features (name))`)
      .eq('id', profile.company_id).single()
    setCompany(companyData)

    const companyHasSchedules = companyData?.company_features?.some(
      (cf: any) => cf.is_enabled && cf.features?.name === 'Schedules'
    )
    if (!companyHasSchedules) { router.push('/employee'); return }

    // Read the schedules feature row for this user (admins skip this — they
    // get everything implicitly, but admins shouldn't be on /employee anyway).
    let userIsEnabled = profile.role === 'admin'
    let userCanViewAll = profile.role === 'admin'

    if (profile.role !== 'admin') {
      const { data: schedulesFeature } = await supabase
        .from('features').select('id').eq('slug', 'schedules').single()
      if (schedulesFeature) {
        const { data: uf } = await supabase
          .from('user_features')
          .select('is_enabled, can_view_all')
          .eq('user_id', user.id)
          .eq('feature_id', schedulesFeature.id)
          .maybeSingle()
        userIsEnabled = !!uf?.is_enabled
        userCanViewAll = !!uf?.can_view_all
      }
    }

    if (!userIsEnabled) {
      router.push('/employee')
      return
    }

    setCanViewAll(userCanViewAll)

    const from = isoDate(weekStart)
    const to = isoDate(addDays(weekStart, 6))
    await loadAll(user.id, profile.company_id, from, to, viewMode)
    setLoading(false)
  // viewMode intentionally NOT in deps — that's the next effect's job
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, weekStart, loadAll])

  useEffect(() => { init(); fetchBankHolidays() }, [init])

  // Refetch when week or mode changes (after init has set currentUser).
  useEffect(() => {
    if (!currentUser?.id || !currentUser?.company_id) return
    const from = isoDate(weekStart)
    const to = isoDate(addDays(weekStart, 6))
    loadAll(currentUser.id, currentUser.company_id, from, to, viewMode)
  }, [weekStart, viewMode, currentUser?.id, currentUser?.company_id, loadAll])

  // Realtime subscription. In 'mine' mode, filter by user_id. In
  // 'everyone' mode, listen to all changes for the company.
  useEffect(() => {
    if (!currentUser?.id || !currentUser?.company_id) return

    const reload = () => {
      const from = isoDate(weekStart)
      const to = isoDate(addDays(weekStart, 6))
      loadAll(currentUser.id, currentUser.company_id, from, to, viewMode)
    }

    const channel = supabase.channel('employee-schedule-realtime')

    if (viewMode === 'everyone') {
      channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule_assignments', filter: `company_id=eq.${currentUser.company_id}` }, reload)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'holiday_requests', filter: `company_id=eq.${currentUser.company_id}` }, reload)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: `company_id=eq.${currentUser.company_id}` }, reload)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'schedules', filter: `company_id=eq.${currentUser.company_id}` }, reload)
    } else {
      channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule_assignments', filter: `user_id=eq.${currentUser.id}` }, reload)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'holiday_requests', filter: `user_id=eq.${currentUser.id}` }, reload)
    }

    channel.subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [currentUser?.id, currentUser?.company_id, weekStart, viewMode, loadAll])

  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  )

  const getSchedule = (id: string) => schedules.find(s => s.id === id)

  const isBankHol = (d: Date): boolean => bankHolidays.has(isoDate(d))
  const bankHolName = (d: Date): string | null => bankHolidayNames[isoDate(d)] || null

  const goPrevWeek = () => setWeekStart(prev => addDays(prev, -7))
  const goNextWeek = () => setWeekStart(prev => addDays(prev, 7))
  const goToday = () => setWeekStart(startOfWeekMon(new Date()))

  const renderHolidayLabel = (h: any) => {
    if (h.request_type === 'holiday') return h.half_day_type ? `Holiday (${h.half_day_type})` : 'Holiday'
    if (h.request_type === 'keep_day_off') return 'Day Off'
    if (h.request_type === 'early_finish') return `Early Finish ${formatTime(h.early_finish_time || '')}`
    return 'Off'
  }

  // --- Helpers used in 'mine' mode ---

  const myHolidayFor = (d: Date): any | null => {
    if (!currentUser?.id) return null
    const iso = isoDate(d)
    return holidays.find(h => h.user_id === currentUser.id && iso >= h.start_date && iso <= h.end_date) || null
  }

  const myDayAssignments = (d: Date): any[] => {
    if (!currentUser?.id) return []
    const iso = isoDate(d)
    return assignments
      .filter(a => a.user_id === currentUser.id && a.assignment_date === iso)
      .sort((a, b) => {
        const sa = getSchedule(a.schedule_id)
        const sb = getSchedule(b.schedule_id)
        return (sa?.start_time || '').localeCompare(sb?.start_time || '')
      })
  }

  // --- Helpers used in 'everyone' mode ---

  const userById = (id: string) => companyUsers.find(u => u.id === id)

  /**
   * For a given date in 'everyone' mode, return rows for everyone who
   * has either an assignment or an approved holiday that day.
   * Sorted by display_order, then full_name.
   */
  const everyoneRowsForDate = (d: Date): {
    user: any,
    assignments: any[],
    holiday: any | null,
  }[] => {
    const iso = isoDate(d)

    type Row = { user: any, assignments: any[], holiday: any | null }
    const rows = new Map<string, Row>()

    // Add assignments
    for (const a of assignments) {
      if (a.assignment_date !== iso) continue
      const u = userById(a.user_id)
      if (!u) continue
      const key = u.id
      if (!rows.has(key)) rows.set(key, { user: u, assignments: [], holiday: null })
      rows.get(key)!.assignments.push(a)
    }

    // Add holidays (one per user max for the day)
    for (const h of holidays) {
      if (!(iso >= h.start_date && iso <= h.end_date)) continue
      const u = userById(h.user_id)
      if (!u) continue
      const key = u.id
      if (!rows.has(key)) rows.set(key, { user: u, assignments: [], holiday: h })
      else if (!rows.get(key)!.holiday) rows.get(key)!.holiday = h
    }

    // Sort assignments within each row by start time
    rows.forEach(row => {
      row.assignments.sort((a, b) => {
        const sa = getSchedule(a.schedule_id)
        const sb = getSchedule(b.schedule_id)
        return (sa?.start_time || '').localeCompare(sb?.start_time || '')
      })
    })

    // Sort the rows themselves by display_order then full_name
    return Array.from(rows.values()).sort((ra, rb) => {
      const ao = ra.user.display_order ?? 999_999
      const bo = rb.user.display_order ?? 999_999
      if (ao !== bo) return ao - bo
      return (ra.user.full_name || '').localeCompare(rb.user.full_name || '')
    })
  }

  const openScheduleModal = async (sched: any) => {
    setOpenSchedule(sched); setOpenDocs([]); setDocMessage(''); setDocsLoading(true)
    const { data } = await supabase
      .from('schedule_documents').select('*')
      .eq('schedule_id', sched.id).order('uploaded_at', { ascending: false })
    setOpenDocs(data || []); setDocsLoading(false)
  }

  const closeModal = () => { setOpenSchedule(null); setOpenDocs([]); setDocMessage('') }

  const handleDownload = async (doc: any) => {
    setDocMessage('')
    const { data, error } = await supabase.storage
      .from('schedule-documents')
      .createSignedUrl(doc.storage_path, 60)
    if (error || !data?.signedUrl) { setDocMessage('Could not open file'); return }
    window.location.href = data.signedUrl
  }

  const weekLabel = `${formatDateLong(weekDates[0])} – ${formatDateLong(weekDates[6])}`

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Loading...</p>
      </main>
    )
  }

  const todayIso = isoDate(new Date())

  return (
    <main className="min-h-screen bg-gray-50 pb-24">
      <IdleWarningModal show={showWarning} secondsLeft={secondsLeft} onStay={stayLoggedIn} />

      <div className="bg-gradient-to-br from-blue-600 to-blue-800 text-white px-6 pt-10 pb-6 rounded-b-3xl shadow-lg">
        <div className="flex items-center justify-between">
          <button onClick={() => router.push('/employee')} className="text-blue-100 text-sm hover:text-white">← Home</button>
          <p className="text-blue-100 text-sm">{company?.name}</p>
        </div>
        <h1 className="text-2xl font-bold mt-2">📅 {viewMode === 'everyone' ? 'Team Schedule' : 'My Schedule'}</h1>
        <p className="text-blue-100 text-sm mt-1">{weekLabel}</p>
      </div>

      <div className="px-4 pt-4 space-y-3">

        {/* View mode toggle (only when user can view everyone) */}
        {canViewAll && (
          <div className="bg-white rounded-xl shadow-sm p-1 flex gap-1">
            <button
              onClick={() => setViewMode('mine')}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
                viewMode === 'mine'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-transparent text-gray-600 hover:bg-gray-50'
              }`}
            >
              My Schedule
            </button>
            <button
              onClick={() => setViewMode('everyone')}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
                viewMode === 'everyone'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-transparent text-gray-600 hover:bg-gray-50'
              }`}
            >
              Everyone
            </button>
          </div>
        )}

        {/* Week navigation */}
        <div className="flex items-center gap-2 bg-white rounded-xl shadow-sm p-2">
          <button onClick={goPrevWeek} className="bg-gray-100 hover:bg-gray-200 text-gray-700 w-10 h-10 rounded-lg text-base font-medium flex-shrink-0">←</button>
          <button onClick={goToday} className="flex-1 bg-blue-50 hover:bg-blue-100 text-blue-700 px-3 py-2 rounded-lg text-sm font-medium">This Week</button>
          <button onClick={goNextWeek} className="bg-gray-100 hover:bg-gray-200 text-gray-700 w-10 h-10 rounded-lg text-base font-medium flex-shrink-0">→</button>
        </div>

        {/* Day cards */}
        <div className="space-y-2">
          {weekDates.map((d, idx) => {
            const isToday = isoDate(d) === todayIso
            const bh = bankHolName(d)

            // ─── 'mine' mode ───
            if (viewMode === 'mine') {
              const dayAsgs = myDayAssignments(d)
              const hol = myHolidayFor(d)
              const isEmpty = dayAsgs.length === 0 && !hol

              return (
                <div key={idx} className={`bg-white rounded-2xl shadow-sm border overflow-hidden ${isToday ? 'border-blue-400 ring-2 ring-blue-100' : 'border-gray-100'}`}>
                  <div className={`px-4 py-2 flex items-center justify-between ${isToday ? 'bg-blue-50' : bh ? 'bg-orange-50' : 'bg-gray-50'}`}>
                    <div className="flex items-center gap-2">
                      <p className={`font-semibold text-sm ${isToday ? 'text-blue-800' : 'text-gray-800'}`}>{d.toLocaleDateString('en-GB', { weekday: 'long' })}</p>
                      <span className={`text-xs ${isToday ? 'text-blue-700' : 'text-gray-500'}`}>{formatDateShort(d)}</span>
                      {isToday && <span className="text-[10px] bg-blue-600 text-white px-2 py-0.5 rounded-full font-medium">TODAY</span>}
                    </div>
                    {bh && <span className="text-[10px] bg-orange-200 text-orange-800 px-2 py-0.5 rounded-full font-medium">🎉 {bh}</span>}
                  </div>

                  <div className="p-3 space-y-2">
                    {hol && (
                      <div className={`p-3 rounded-lg ${hol.request_type === 'holiday' ? 'bg-red-50 border border-red-200' : hol.request_type === 'keep_day_off' ? 'bg-purple-50 border border-purple-200' : 'bg-amber-50 border border-amber-200'}`}>
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{hol.request_type === 'holiday' ? '🏖️' : hol.request_type === 'keep_day_off' ? '🚫' : '🕓'}</span>
                          <p className={`font-semibold text-sm ${hol.request_type === 'holiday' ? 'text-red-800' : hol.request_type === 'keep_day_off' ? 'text-purple-800' : 'text-amber-800'}`}>{renderHolidayLabel(hol)}</p>
                        </div>
                      </div>
                    )}

                    {dayAsgs.map(a => {
                      const sched = getSchedule(a.schedule_id)
                      if (!sched) return null
                      return (
                        <button key={a.id} onClick={() => openScheduleModal(sched)} className="w-full text-left bg-blue-50 hover:bg-blue-100 active:bg-blue-200 border border-blue-200 rounded-lg p-3 transition">
                          <div className="flex items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-blue-900 text-sm">{sched.name}</p>
                              <p className="text-xs text-blue-700 mt-0.5">{formatTime(sched.start_time)} – {formatTime(sched.end_time)}</p>
                            </div>
                            <span className="text-blue-400 text-sm flex-shrink-0">›</span>
                          </div>
                        </button>
                      )
                    })}

                    {isEmpty && <div className="px-3 py-2 text-center text-gray-400 text-sm italic">Day Off</div>}
                  </div>
                </div>
              )
            }

            // ─── 'everyone' mode ───
            const rows = everyoneRowsForDate(d)
            const isEmpty = rows.length === 0

            return (
              <div key={idx} className={`bg-white rounded-2xl shadow-sm border overflow-hidden ${isToday ? 'border-blue-400 ring-2 ring-blue-100' : 'border-gray-100'}`}>
                <div className={`px-4 py-2 flex items-center justify-between ${isToday ? 'bg-blue-50' : bh ? 'bg-orange-50' : 'bg-gray-50'}`}>
                  <div className="flex items-center gap-2">
                    <p className={`font-semibold text-sm ${isToday ? 'text-blue-800' : 'text-gray-800'}`}>{d.toLocaleDateString('en-GB', { weekday: 'long' })}</p>
                    <span className={`text-xs ${isToday ? 'text-blue-700' : 'text-gray-500'}`}>{formatDateShort(d)}</span>
                    {isToday && <span className="text-[10px] bg-blue-600 text-white px-2 py-0.5 rounded-full font-medium">TODAY</span>}
                  </div>
                  {bh && <span className="text-[10px] bg-orange-200 text-orange-800 px-2 py-0.5 rounded-full font-medium">🎉 {bh}</span>}
                </div>

                <div className="p-3 space-y-2">
                  {isEmpty ? (
                    <div className="px-3 py-2 text-center text-gray-400 text-sm italic">Nobody scheduled</div>
                  ) : (
                    rows.map(row => {
                      const isMe = row.user.id === currentUser?.id
                      return (
                        <div key={row.user.id} className={`rounded-lg p-2.5 ${isMe ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50 border border-gray-200'}`}>
                          <p className={`text-xs font-semibold mb-1.5 ${isMe ? 'text-blue-800' : 'text-gray-700'}`}>
                            {row.user.full_name || '(no name)'}
                            {isMe && <span className="ml-1.5 text-[10px] bg-blue-600 text-white px-1.5 py-0.5 rounded-full">YOU</span>}
                          </p>

                          {row.holiday && (
                            <div className={`mb-1 p-2 rounded ${row.holiday.request_type === 'holiday' ? 'bg-red-100' : row.holiday.request_type === 'keep_day_off' ? 'bg-purple-100' : 'bg-amber-100'}`}>
                              <p className={`text-xs ${row.holiday.request_type === 'holiday' ? 'text-red-800' : row.holiday.request_type === 'keep_day_off' ? 'text-purple-800' : 'text-amber-800'}`}>
                                {row.holiday.request_type === 'holiday' ? '🏖️' : row.holiday.request_type === 'keep_day_off' ? '🚫' : '🕓'}{' '}
                                {renderHolidayLabel(row.holiday)}
                              </p>
                            </div>
                          )}

                          {row.assignments.map(a => {
                            const sched = getSchedule(a.schedule_id)
                            if (!sched) return null
                            return (
                              <button
                                key={a.id}
                                onClick={() => openScheduleModal(sched)}
                                className="w-full text-left bg-white hover:bg-blue-50 active:bg-blue-100 border border-blue-200 rounded p-2 mb-1 last:mb-0 transition"
                              >
                                <div className="flex items-start gap-2">
                                  <div className="flex-1 min-w-0">
                                    <p className="font-medium text-blue-900 text-xs">{sched.name}</p>
                                    <p className="text-[11px] text-blue-700">{formatTime(sched.start_time)} – {formatTime(sched.end_time)}</p>
                                  </div>
                                  <span className="text-blue-400 text-xs flex-shrink-0">›</span>
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )
          })}
        </div>

      </div>

      {openSchedule && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center sm:p-4" onClick={closeModal}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex justify-between items-start gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-bold text-gray-800 break-words">{openSchedule.name}</h2>
              </div>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-700 text-2xl leading-none flex-shrink-0">×</button>
            </div>

            <div className="p-5 space-y-4">
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">Time</p>
                <p className="font-medium text-gray-800">{formatTime(openSchedule.start_time)} – {formatTime(openSchedule.end_time)}</p>
              </div>

              {openSchedule.schedule_type === 'one_off' && openSchedule.start_date && (
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 mb-1">Date</p>
                  <p className="font-medium text-gray-800">
                    {openSchedule.start_date === openSchedule.end_date
                      ? formatDateLong(new Date(openSchedule.start_date + 'T00:00:00'))
                      : `${formatDateLong(new Date(openSchedule.start_date + 'T00:00:00'))} → ${formatDateLong(new Date(openSchedule.end_date + 'T00:00:00'))}`}
                  </p>
                </div>
              )}

              {openSchedule.description && (
                <div>
                  <p className="text-xs text-gray-500 mb-1 font-medium">Description</p>
                  <p className="text-sm text-gray-800 whitespace-pre-wrap">{openSchedule.description}</p>
                </div>
              )}

              <div className="pt-3 border-t border-gray-100">
                <p className="text-sm font-semibold text-gray-800 mb-2">Attachments</p>
                {docMessage && <p className="text-xs text-red-600 mb-2">{docMessage}</p>}
                {docsLoading ? (
                  <p className="text-sm text-gray-400 italic">Loading attachments...</p>
                ) : openDocs.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">No attachments</p>
                ) : (
                  <ul className="space-y-2">
                    {openDocs.map(doc => (
                      <li key={doc.id}>
                        <button onClick={() => handleDownload(doc)} className="w-full flex items-center gap-3 bg-gray-50 hover:bg-gray-100 active:bg-gray-200 rounded-lg px-3 py-2 text-left transition">
                          <span className="text-2xl flex-shrink-0">{getFileIcon(doc.mime_type)}</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-800 truncate">{doc.file_name}</p>
                            <p className="text-xs text-gray-500">{formatBytes(doc.file_size)}</p>
                          </div>
                          <span className="text-blue-600 text-sm font-medium flex-shrink-0">Open</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <button onClick={closeModal} className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 py-3 rounded-lg font-medium transition">Close</button>
            </div>
          </div>
        </div>
      )}

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg">
        <div className="flex justify-around items-center h-16 max-w-md mx-auto">
          <button onClick={() => router.push('/employee')} className="flex flex-col items-center gap-0.5 text-gray-400 hover:text-gray-600">
            <span className="text-xl">🏠</span>
            <span className="text-xs font-medium">Home</span>
          </button>
          <button onClick={() => router.push('/employee/profile')} className="flex flex-col items-center gap-0.5 text-gray-400 hover:text-gray-600">
            <span className="text-xl">👤</span>
            <span className="text-xs font-medium">Profile</span>
          </button>
        </div>
      </nav>
    </main>
  )
}
