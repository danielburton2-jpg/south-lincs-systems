'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useIdleLogout, IdleWarningModal } from '@/lib/useIdleLogout'

const supabase = createClient()

// === Date helpers ===
const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const startOfWeekMon = (d: Date): Date => {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  // getDay() returns 0 (Sun) - 6 (Sat). We want Monday as start.
  const day = out.getDay() // 0=Sun,1=Mon,...6=Sat
  const diff = day === 0 ? -6 : 1 - day // shift to Monday
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

const formatTime = (t: string) => t?.slice(0, 5) || ''

const DOW_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
const DOW_LABEL: Record<string, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun'
}

// Returns the lowercase day-of-week key for a Date, e.g. 'mon'
const dowOf = (d: Date): string => {
  const j = d.getDay() // 0=Sun
  const map: Record<number, string> = { 0: 'sun', 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat' }
  return map[j]
}

export default function SchedulesCalendarPage() {
  const router = useRouter()

  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [users, setUsers] = useState<any[]>([])
  const [schedules, setSchedules] = useState<any[]>([])
  const [assignments, setAssignments] = useState<any[]>([])
  const [holidays, setHolidays] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  const [view, setView] = useState<'week' | 'day'>('week')
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeekMon(new Date()))
  const [dayDate, setDayDate] = useState<Date>(() => new Date())
  const [justMe, setJustMe] = useState(false)

  const { showWarning, secondsLeft, stayLoggedIn } = useIdleLogout(true)

  const showMessage = (msg: string, type: 'success' | 'error') => {
    setMessage(msg)
    setMessageType(type)
    if (type === 'success') setTimeout(() => setMessage(''), 4000)
  }

  // === Load all the data we need ===
  const loadAll = useCallback(async (uid: string, companyId: string, weekFromISO: string, weekToISO: string) => {
    // Users in admin-defined order who have the Schedules feature
    // Admins are visible by default, and any non-admin who has user_features.is_enabled for Schedules
    const [{ data: profilesData }, { data: scheds }, { data: asgs }, { data: hols }] = await Promise.all([
      supabase
        .from('profiles')
        .select(`id, full_name, email, role, job_title, display_order, is_frozen, user_features (is_enabled, features (name))`)
        .eq('company_id', companyId)
        .eq('is_deleted', false)
        .order('display_order', { ascending: true, nullsFirst: false })
        .order('full_name', { ascending: true }),
      supabase
        .from('schedules')
        .select('*')
        .eq('company_id', companyId)
        .eq('active', true)
        .is('completed_at', null),
      supabase
        .from('schedule_assignments')
        .select(`*, schedule:schedule_id (id, name, start_time, end_time, schedule_type)`)
        .eq('company_id', companyId)
        .gte('assignment_date', weekFromISO)
        .lte('assignment_date', weekToISO),
      supabase
        .from('holiday_requests')
        .select('id, user_id, request_type, status, start_date, end_date, half_day_type, early_finish_time')
        .eq('company_id', companyId)
        .eq('status', 'approved')
        .or(`and(start_date.lte.${weekToISO},end_date.gte.${weekFromISO})`),
    ])

    // Filter users to those who can see schedules
    const filtered = (profilesData || []).filter((p: any) => {
      if (p.role === 'admin') return true
      const has = (p.user_features || []).some(
        (uf: any) => uf.is_enabled && uf.features?.name === 'Schedules'
      )
      return has
    })

    setUsers(filtered)
    setSchedules(scheds || [])
    setAssignments(asgs || [])
    setHolidays(hols || [])
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

    // Compute current visible window
    const from = isoDate(weekStart)
    const to = isoDate(addDays(weekStart, 6))
    await loadAll(user.id, profile.company_id, from, to)
    setLoading(false)
  }, [router, weekStart, loadAll])

  useEffect(() => {
    init()
  }, [init])

  // Reload when week changes (after first load)
  useEffect(() => {
    if (!currentUser?.company_id) return
    const from = isoDate(weekStart)
    const to = isoDate(addDays(weekStart, 6))
    loadAll(currentUser.id, currentUser.company_id, from, to)
  }, [weekStart, currentUser?.id, currentUser?.company_id, loadAll])

  // Realtime
  useEffect(() => {
    if (!currentUser?.company_id) return
    const channel = supabase
      .channel('schedules-calendar-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule_assignments', filter: `company_id=eq.${currentUser.company_id}` }, () => {
        const from = isoDate(weekStart)
        const to = isoDate(addDays(weekStart, 6))
        loadAll(currentUser.id, currentUser.company_id, from, to)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedules', filter: `company_id=eq.${currentUser.company_id}` }, () => {
        const from = isoDate(weekStart)
        const to = isoDate(addDays(weekStart, 6))
        loadAll(currentUser.id, currentUser.company_id, from, to)
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [currentUser?.company_id, currentUser?.id, weekStart, loadAll])

  // === Derived helpers ===
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

  // Does this schedule run on this date?
  const scheduleRunsOnDate = (s: any, d: Date): boolean => {
    const iso = isoDate(d)
    if (s.schedule_type === 'one_off') {
      if (!s.start_date || !s.end_date) return false
      return iso >= s.start_date && iso <= s.end_date
    }
    // recurring
    if (s.start_date && iso < s.start_date) return false
    if (s.end_date && iso > s.end_date) return false
    const dow = dowOf(d)
    return !!s.recurring_days?.[dow]
  }

  // Find approved holiday/keep-day-off/early-finish for a user on a date
  const holidayFor = (userId: string, d: Date): any | null => {
    const iso = isoDate(d)
    return holidays.find(h =>
      h.user_id === userId &&
      iso >= h.start_date &&
      iso <= h.end_date
    ) || null
  }

  // Get all assignments for this user on this date
  const cellAssignments = (userId: string, d: Date): any[] => {
    const iso = isoDate(d)
    return assignments
      .filter(a => a.user_id === userId && a.assignment_date === iso)
      .filter(a => {
        // For non-admins/non-managers: only show published
        if (canEdit) return true
        return a.status === 'published'
      })
      .sort((a, b) => {
        const ta = a.schedule?.start_time || ''
        const tb = b.schedule?.start_time || ''
        return ta.localeCompare(tb)
      })
  }

  // Find unassigned schedules running this day (for the picker we'll wire up next)
  const schedulesRunningOn = (d: Date): any[] => {
    return schedules.filter(s => scheduleRunsOnDate(s, d))
  }

  // === Navigation ===
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

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-500">Loading calendar...</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-100">
      <IdleWarningModal show={showWarning} secondsLeft={secondsLeft} onStay={stayLoggedIn} />

      {/* Header */}
      <div className="bg-blue-700 text-white px-6 py-4 flex justify-between items-center">
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

      <div className="max-w-[1400px] mx-auto p-4 md:p-6 space-y-4">

        {message && (
          <div className={`p-4 rounded-lg text-sm font-medium ${
            messageType === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            {message}
          </div>
        )}

        {/* Toolbar */}
        <div className="bg-white rounded-xl shadow p-3 flex flex-wrap items-center gap-3">

          {/* View toggle */}
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

          {/* Date nav */}
          {view === 'week' ? (
            <div className="flex items-center gap-1">
              <button
                onClick={goPrevWeek}
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 w-9 h-9 rounded-lg text-sm font-medium"
                title="Previous week"
              >
                ←
              </button>
              <div className="px-3 py-1.5 font-medium text-gray-800 text-sm whitespace-nowrap">
                {weekLabel}
              </div>
              <button
                onClick={goNextWeek}
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 w-9 h-9 rounded-lg text-sm font-medium"
                title="Next week"
              >
                →
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <button
                onClick={goPrevDay}
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 w-9 h-9 rounded-lg text-sm font-medium"
                title="Previous day"
              >
                ←
              </button>
              <div className="px-3 py-1.5 font-medium text-gray-800 text-sm whitespace-nowrap">
                {dayDate.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' })}
              </div>
              <button
                onClick={goNextDay}
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 w-9 h-9 rounded-lg text-sm font-medium"
                title="Next day"
              >
                →
              </button>
            </div>
          )}

          <button
            onClick={goToday}
            className="bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-medium"
          >
            Today
          </button>

          <div className="flex-1" />

          {/* Just me toggle */}
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={justMe}
              onChange={(e) => setJustMe(e.target.checked)}
              className="w-4 h-4"
            />
            Just me
          </label>

          {canEdit && (
            <span className="text-xs text-gray-400 italic">
              Click any cell to assign (coming next step)
            </span>
          )}
        </div>

        {/* Week View */}
        {view === 'week' && (
          <div className="bg-white rounded-xl shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-3 text-xs font-semibold text-gray-600 uppercase border-b border-gray-200 sticky left-0 bg-gray-50 z-10 min-w-[160px]">
                      Name
                    </th>
                    {weekDates.map((d, i) => {
                      const isToday = isoDate(d) === isoDate(new Date())
                      return (
                        <th
                          key={i}
                          className={`text-left px-3 py-3 text-xs font-semibold uppercase border-b border-gray-200 min-w-[140px] ${
                            isToday ? 'bg-blue-50 text-blue-800' : 'text-gray-600'
                          }`}
                        >
                          <div>{d.toLocaleDateString('en-GB', { weekday: 'short' })}</div>
                          <div className="text-sm font-bold normal-case mt-0.5">{formatDateShort(d)}</div>
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
                        {u.job_title && (
                          <p className="text-[11px] text-gray-500 mt-0.5">{u.job_title}</p>
                        )}
                        {u.is_frozen && (
                          <p className="text-[10px] text-amber-700 font-medium mt-0.5">Frozen</p>
                        )}
                      </td>
                      {weekDates.map((d, i) => {
                        const cellAsgs = cellAssignments(u.id, d)
                        const hol = holidayFor(u.id, d)
                        const hasUnpublished = cellAsgs.some(a => a.is_changed || a.status === 'draft')
                        const isToday = isoDate(d) === isoDate(new Date())

                        return (
                          <td
                            key={i}
                            className={`px-2 py-2 align-top text-xs border-r border-gray-100 last:border-r-0 ${
                              isToday ? 'bg-blue-50/30' : ''
                            } ${hasUnpublished ? 'bg-yellow-100/60' : ''} ${
                              canEdit ? 'cursor-pointer hover:bg-gray-50' : ''
                            }`}
                            onClick={() => {
                              if (!canEdit) return
                              showMessage('Cell editor coming in the next step', 'success')
                            }}
                          >
                            {hol ? (
                              <div className={`px-2 py-1 rounded font-medium text-[11px] ${
                                hol.request_type === 'holiday'
                                  ? 'bg-red-100 text-red-700'
                                  : hol.request_type === 'keep_day_off'
                                  ? 'bg-purple-100 text-purple-700'
                                  : 'bg-amber-100 text-amber-700'
                              }`}>
                                {renderHolidayLabel(hol)}
                              </div>
                            ) : null}

                            {cellAsgs.length === 0 && !hol && (
                              <span className="text-gray-300 text-xs">—</span>
                            )}

                            <div className="space-y-1 mt-1">
                              {cellAsgs.map(a => (
                                <div
                                  key={a.id}
                                  className={`px-2 py-1 rounded text-[11px] leading-tight ${
                                    a.status === 'draft'
                                      ? 'bg-amber-50 border border-amber-200 text-amber-800'
                                      : 'bg-blue-50 border border-blue-100 text-blue-900'
                                  }`}
                                >
                                  <p className="font-semibold truncate">{a.schedule?.name}</p>
                                  <p className="text-[10px] text-gray-600">
                                    {formatTime(a.schedule?.start_time)}–{formatTime(a.schedule?.end_time)}
                                  </p>
                                </div>
                              ))}
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

        {/* Day View */}
        {view === 'day' && (
          <div className="bg-white rounded-xl shadow overflow-hidden">
            <div className="divide-y divide-gray-100">
              {visibleUsers.length === 0 ? (
                <div className="text-center text-gray-400 py-12 text-sm">No users to show</div>
              ) : (
                visibleUsers.map((u) => {
                  const cellAsgs = cellAssignments(u.id, dayDate)
                  const hol = holidayFor(u.id, dayDate)
                  const hasUnpublished = cellAsgs.some(a => a.is_changed || a.status === 'draft')

                  return (
                    <div
                      key={u.id}
                      onClick={() => {
                        if (!canEdit) return
                        showMessage('Cell editor coming in the next step', 'success')
                      }}
                      className={`p-4 flex gap-4 ${hasUnpublished ? 'bg-yellow-50' : ''} ${canEdit ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                    >
                      <div className="w-40 flex-shrink-0">
                        <p className="font-semibold text-gray-800 text-sm">{u.full_name}</p>
                        {u.job_title && (
                          <p className="text-xs text-gray-500 mt-0.5">{u.job_title}</p>
                        )}
                      </div>
                      <div className="flex-1 flex flex-wrap gap-2">
                        {hol && (
                          <div className={`px-3 py-1.5 rounded font-medium text-xs ${
                            hol.request_type === 'holiday'
                              ? 'bg-red-100 text-red-700'
                              : hol.request_type === 'keep_day_off'
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-amber-100 text-amber-700'
                          }`}>
                            {renderHolidayLabel(hol)}
                          </div>
                        )}
                        {cellAsgs.length === 0 && !hol && (
                          <span className="text-gray-300 text-sm">—</span>
                        )}
                        {cellAsgs.map(a => (
                          <div
                            key={a.id}
                            className={`px-3 py-1.5 rounded text-xs ${
                              a.status === 'draft'
                                ? 'bg-amber-50 border border-amber-200 text-amber-800'
                                : 'bg-blue-50 border border-blue-100 text-blue-900'
                            }`}
                          >
                            <p className="font-semibold">{a.schedule?.name}</p>
                            <p className="text-[10px] text-gray-600">
                              {formatTime(a.schedule?.start_time)}–{formatTime(a.schedule?.end_time)}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="bg-white rounded-xl shadow p-3 flex flex-wrap gap-3 text-xs">
          <span className="font-medium text-gray-600">Legend:</span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-blue-50 border border-blue-100 inline-block"></span>
            <span className="text-gray-600">Published assignment</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-amber-50 border border-amber-200 inline-block"></span>
            <span className="text-gray-600">Draft (not yet published)</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-yellow-100 inline-block"></span>
            <span className="text-gray-600">Cell with unpublished changes</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-red-100 inline-block"></span>
            <span className="text-gray-600">Holiday</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-purple-100 inline-block"></span>
            <span className="text-gray-600">Day Off</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-amber-100 inline-block"></span>
            <span className="text-gray-600">Early Finish</span>
          </span>
        </div>
      </div>
    </main>
  )
}