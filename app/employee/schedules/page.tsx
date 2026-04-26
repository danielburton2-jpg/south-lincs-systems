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

const formatDateLong = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

const formatDateShort = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })

const formatTime = (t: string) => t?.slice(0, 5) || ''

export default function EmployeeSchedulePage() {
  const router = useRouter()

  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [schedules, setSchedules] = useState<any[]>([])
  const [assignments, setAssignments] = useState<any[]>([])
  const [holidays, setHolidays] = useState<any[]>([])
  const [bankHolidays, setBankHolidays] = useState<Set<string>>(new Set())
  const [bankHolidayNames, setBankHolidayNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeekMon(new Date()))

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

  const loadAll = useCallback(async (userId: string, companyId: string, weekFromISO: string, weekToISO: string) => {
    const [schedsRes, asgsRes, holsRes] = await Promise.all([
      supabase
        .from('schedules')
        .select('*')
        .eq('company_id', companyId),
      supabase
        .from('schedule_assignments')
        .select('*')
        .eq('company_id', companyId)
        .eq('user_id', userId)
        .eq('status', 'published')
        .gte('assignment_date', weekFromISO)
        .lte('assignment_date', weekToISO),
      supabase
        .from('holiday_requests')
        .select('id, user_id, request_type, status, start_date, end_date, half_day_type, early_finish_time')
        .eq('company_id', companyId)
        .eq('user_id', userId)
        .eq('status', 'approved')
        .lte('start_date', weekToISO)
        .gte('end_date', weekFromISO),
    ])

    setSchedules(schedsRes.data || [])
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
      router.push('/employee')
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
      router.push('/employee')
      return
    }

    const { data: userFeats } = await supabase
      .from('user_features')
      .select('is_enabled, features (name)')
      .eq('user_id', user.id)
      .eq('is_enabled', true)
    const userHasSchedules = (userFeats as any[])?.some(
      (uf: any) => uf.features?.name === 'Schedules'
    )
    if (!userHasSchedules) {
      router.push('/employee')
      return
    }

    const from = isoDate(weekStart)
    const to = isoDate(addDays(weekStart, 6))
    await loadAll(user.id, profile.company_id, from, to)
    setLoading(false)
  }, [router, weekStart, loadAll])

  useEffect(() => {
    init()
    fetchBankHolidays()
  }, [init])

  useEffect(() => {
    if (!currentUser?.id || !currentUser?.company_id) return
    const from = isoDate(weekStart)
    const to = isoDate(addDays(weekStart, 6))
    loadAll(currentUser.id, currentUser.company_id, from, to)
  }, [weekStart, currentUser?.id, currentUser?.company_id, loadAll])

  useEffect(() => {
    if (!currentUser?.id || !currentUser?.company_id) return
    const channel = supabase
      .channel('employee-schedule-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule_assignments', filter: `user_id=eq.${currentUser.id}` }, () => {
        const from = isoDate(weekStart)
        const to = isoDate(addDays(weekStart, 6))
        loadAll(currentUser.id, currentUser.company_id, from, to)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'holiday_requests', filter: `user_id=eq.${currentUser.id}` }, () => {
        const from = isoDate(weekStart)
        const to = isoDate(addDays(weekStart, 6))
        loadAll(currentUser.id, currentUser.company_id, from, to)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [currentUser?.id, currentUser?.company_id, weekStart, loadAll])

  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  )

  const getSchedule = (id: string) => schedules.find(s => s.id === id)

  const holidayFor = (d: Date): any | null => {
    const iso = isoDate(d)
    return holidays.find(h => iso >= h.start_date && iso <= h.end_date) || null
  }

  const dayAssignments = (d: Date): any[] => {
    const iso = isoDate(d)
    return assignments
      .filter(a => a.assignment_date === iso)
      .sort((a, b) => {
        const sa = getSchedule(a.schedule_id)
        const sb = getSchedule(b.schedule_id)
        const ta = sa?.start_time || ''
        const tb = sb?.start_time || ''
        return ta.localeCompare(tb)
      })
  }

  const isBankHol = (d: Date): boolean => bankHolidays.has(isoDate(d))
  const bankHolName = (d: Date): string | null => bankHolidayNames[isoDate(d)] || null

  const goPrevWeek = () => setWeekStart(prev => addDays(prev, -7))
  const goNextWeek = () => setWeekStart(prev => addDays(prev, 7))
  const goToday = () => setWeekStart(startOfWeekMon(new Date()))

  const renderHolidayLabel = (h: any) => {
    if (h.request_type === 'holiday') {
      if (h.half_day_type) return `Holiday (${h.half_day_type})`
      return 'Holiday'
    }
    if (h.request_type === 'keep_day_off') return 'Day Off'
    if (h.request_type === 'early_finish') return `Early Finish ${formatTime(h.early_finish_time || '')}`
    return 'Off'
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
          <button
            onClick={() => router.push('/employee')}
            className="text-blue-100 text-sm hover:text-white"
          >
            ← Home
          </button>
          <p className="text-blue-100 text-sm">{company?.name}</p>
        </div>
        <h1 className="text-2xl font-bold mt-2">📅 My Schedule</h1>
        <p className="text-blue-100 text-sm mt-1">{weekLabel}</p>
      </div>

      <div className="px-4 pt-4 space-y-3">

        <div className="flex items-center gap-2 bg-white rounded-xl shadow-sm p-2">
          <button
            onClick={goPrevWeek}
            className="bg-gray-100 hover:bg-gray-200 text-gray-700 w-10 h-10 rounded-lg text-base font-medium flex-shrink-0"
          >
            ←
          </button>
          <button
            onClick={goToday}
            className="flex-1 bg-blue-50 hover:bg-blue-100 text-blue-700 px-3 py-2 rounded-lg text-sm font-medium"
          >
            This Week
          </button>
          <button
            onClick={goNextWeek}
            className="bg-gray-100 hover:bg-gray-200 text-gray-700 w-10 h-10 rounded-lg text-base font-medium flex-shrink-0"
          >
            →
          </button>
        </div>

        <div className="space-y-2">
          {weekDates.map((d, idx) => {
            const dayAsgs = dayAssignments(d)
            const hol = holidayFor(d)
            const bh = bankHolName(d)
            const isToday = isoDate(d) === todayIso
            const isEmpty = dayAsgs.length === 0 && !hol

            return (
              <div
                key={idx}
                className={`bg-white rounded-2xl shadow-sm border overflow-hidden ${
                  isToday ? 'border-blue-400 ring-2 ring-blue-100' : 'border-gray-100'
                }`}
              >
                <div className={`px-4 py-2 flex items-center justify-between ${
                  isToday ? 'bg-blue-50' : bh ? 'bg-orange-50' : 'bg-gray-50'
                }`}>
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
                  {bh && (
                    <span className="text-[10px] bg-orange-200 text-orange-800 px-2 py-0.5 rounded-full font-medium">
                      🎉 {bh}
                    </span>
                  )}
                </div>

                <div className="p-3 space-y-2">
                  {hol && (
                    <div className={`p-3 rounded-lg ${
                      hol.request_type === 'holiday' ? 'bg-red-50 border border-red-200' :
                      hol.request_type === 'keep_day_off' ? 'bg-purple-50 border border-purple-200' :
                      'bg-amber-50 border border-amber-200'
                    }`}>
                      <div className="flex items-center gap-2">
                        <span className="text-lg">
                          {hol.request_type === 'holiday' ? '🏖️' : hol.request_type === 'keep_day_off' ? '🚫' : '🕓'}
                        </span>
                        <p className={`font-semibold text-sm ${
                          hol.request_type === 'holiday' ? 'text-red-800' :
                          hol.request_type === 'keep_day_off' ? 'text-purple-800' :
                          'text-amber-800'
                        }`}>
                          {renderHolidayLabel(hol)}
                        </p>
                      </div>
                    </div>
                  )}

                  {dayAsgs.map(a => {
                    const sched = getSchedule(a.schedule_id)
                    if (!sched) return null
                    return (
                      <div
                        key={a.id}
                        className="bg-blue-50 border border-blue-200 rounded-lg p-3"
                      >
                        <div className="flex items-start gap-2">
                          <span className="text-lg flex-shrink-0">
                            {sched.schedule_type === 'recurring' ? '🔁' : '📅'}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-blue-900 text-sm">{sched.name}</p>
                            <p className="text-xs text-blue-700 mt-0.5">
                              🕐 {formatTime(sched.start_time)}–{formatTime(sched.end_time)}
                            </p>
                            {sched.description && (
                              <p className="text-xs text-blue-600 mt-1 line-clamp-2">{sched.description}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}

                  {isEmpty && (
                    <div className="px-3 py-2 text-center text-gray-400 text-sm italic">
                      Day Off
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

      </div>

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