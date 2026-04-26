'use client'

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

const formatDateShort = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })

const formatDateLong = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

const formatTime = (t: string) => t?.slice(0, 5) || ''

export default function SchedulesCalendarPage() {
  const router = useRouter()

  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [users, setUsers] = useState<any[]>([])
  const [schedules, setSchedules] = useState<any[]>([])
  const [assignments, setAssignments] = useState<any[]>([])
  const [holidays, setHolidays] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const [view, setView] = useState<'week' | 'day'>('week')
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeekMon(new Date()))
  const [dayDate, setDayDate] = useState<Date>(() => new Date())
  const [justMe, setJustMe] = useState(false)

  const { showWarning, secondsLeft, stayLoggedIn } = useIdleLogout(true)

  const loadAll = useCallback(async (companyId: string, weekFromISO: string, weekToISO: string) => {
    const [profilesRes, schedsRes, asgsRes, holsRes] = await Promise.all([
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
    ])

    const filteredUsers = (profilesRes.data || []).filter((p: any) => p.role !== 'superuser')

    setUsers(filteredUsers)
    setSchedules(schedsRes.data || [])
    setAssignments(asgsRes.data || [])
    setHolidays(holsRes.data || [])

    // Debug — leave this for now so we can see what's loading
    console.log('[Calendar] Loaded:', {
      users: filteredUsers.length,
      schedules: schedsRes.data?.length || 0,
      assignments: asgsRes.data?.length || 0,
      holidays: holsRes.data?.length || 0,
      assignmentsErr: asgsRes.error,
      schedulesErr: schedsRes.error,
      profilesErr: profilesRes.error,
      holidaysErr: holsRes.error,
    })
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
  }, [init])

  useEffect(() => {
    if (!currentUser?.company_id) return
    const from = isoDate(weekStart)
    const to = isoDate(addDays(weekStart, 6))
    loadAll(currentUser.company_id, from, to)
  }, [weekStart, currentUser?.company_id, loadAll])

  // Realtime
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

  // Look up the schedule for an assignment from the schedules array
  const getSchedule = (scheduleId: string) => schedules.find(s => s.id === scheduleId)

  // Find approved holiday/keep-day-off/early-finish for a user on a date
  const holidayFor = (userId: string, d: Date): any | null => {
    const iso = isoDate(d)
    return holidays.find(h =>
      h.user_id === userId &&
      iso >= h.start_date &&
      iso <= h.end_date
    ) || null
  }

  // Get all assignments for this user on this date.
  // Non-admins/managers only see published rows.
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

        {/* Toolbar */}
        <div className="bg-white rounded-xl shadow p-3 flex flex-wrap items-center gap-3">
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
              <button
                onClick={goPrevWeek}
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 w-9 h-9 rounded-lg text-sm font-medium"
              >
                ←
              </button>
              <div className="px-3 py-1.5 font-medium text-gray-800 text-sm whitespace-nowrap">
                {weekLabel}
              </div>
              <button
                onClick={goNextWeek}
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 w-9 h-9 rounded-lg text-sm font-medium"
              >
                →
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <button
                onClick={goPrevDay}
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 w-9 h-9 rounded-lg text-sm font-medium"
              >
                ←
              </button>
              <div className="px-3 py-1.5 font-medium text-gray-800 text-sm whitespace-nowrap">
                {dayDate.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' })}
              </div>
              <button
                onClick={goNextDay}
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 w-9 h-9 rounded-lg text-sm font-medium"
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
            <button
              onClick={() => router.push('/dashboard/schedules/assign')}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium"
            >
              ✏️ Assign
            </button>
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
                            } ${hasUnpublished ? 'bg-yellow-100/60' : ''}`}
                          >
                            {hol ? (
                              <div className={`px-2 py-1 rounded font-medium text-[11px] mb-1 ${
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

                            <div className="space-y-1">
                              {cellAsgs.map(a => {
                                const sched = getSchedule(a.schedule_id)
                                return (
                                  <div
                                    key={a.id}
                                    className={`px-2 py-1 rounded text-[11px] leading-tight ${
                                      a.status === 'draft'
                                        ? 'bg-amber-50 border border-amber-200 text-amber-800'
                                        : a.is_changed
                                        ? 'bg-yellow-100 border border-yellow-300 text-yellow-900'
                                        : 'bg-blue-50 border border-blue-100 text-blue-900'
                                    }`}
                                  >
                                    <p className="font-semibold truncate">{sched?.name || '(unknown schedule)'}</p>
                                    <p className="text-[10px] text-gray-600">
                                      {formatTime(sched?.start_time)}–{formatTime(sched?.end_time)}
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
                      className={`p-4 flex gap-4 ${hasUnpublished ? 'bg-yellow-50' : ''}`}
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
                        {cellAsgs.map(a => {
                          const sched = getSchedule(a.schedule_id)
                          return (
                            <div
                              key={a.id}
                              className={`px-3 py-1.5 rounded text-xs ${
                                a.status === 'draft'
                                  ? 'bg-amber-50 border border-amber-200 text-amber-800'
                                  : a.is_changed
                                  ? 'bg-yellow-100 border border-yellow-300 text-yellow-900'
                                  : 'bg-blue-50 border border-blue-100 text-blue-900'
                              }`}
                            >
                              <p className="font-semibold">{sched?.name || '(unknown)'}</p>
                              <p className="text-[10px] text-gray-600">
                                {formatTime(sched?.start_time)}–{formatTime(sched?.end_time)}
                              </p>
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

        {/* Legend */}
        <div className="bg-white rounded-xl shadow p-3 flex flex-wrap gap-3 text-xs">
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
            <span className="text-gray-600">Changed since publish</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-red-100 inline-block"></span>
            <span className="text-gray-600">Holiday</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-purple-100 inline-block"></span>
            <span className="text-gray-600">Day Off</span>
          </span>
        </div>
      </div>
    </main>
  )
}