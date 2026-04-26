'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useIdleLogout, IdleWarningModal } from '@/lib/useIdleLogout'
import { logAuditClient } from '@/lib/auditClient'

const supabase = createClient()

// --- Date helpers ---
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

const dowOf = (d: Date): string => {
  const j = d.getDay()
  const map: Record<number, string> = { 0: 'sun', 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat' }
  return map[j]
}

// scheduleId|YYYY-MM-DD => { user_id, status, is_changed, original_user_id }
type CellMap = Record<string, {
  user_id: string | null
  status: 'draft' | 'published'
  is_changed: boolean
  assignment_id?: string
  original_user_id?: string | null
}>

const cellKey = (scheduleId: string, date: Date) => `${scheduleId}|${isoDate(date)}`

export default function SchedulesAssignPage() {
  const router = useRouter()

  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [schedules, setSchedules] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [holidays, setHolidays] = useState<any[]>([])
  const [cells, setCells] = useState<CellMap>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [hasUnsaved, setHasUnsaved] = useState(false)

  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeekMon(new Date()))

  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  const { showWarning, secondsLeft, stayLoggedIn } = useIdleLogout(true)

  const showMessage = (msg: string, type: 'success' | 'error') => {
    setMessage(msg)
    setMessageType(type)
    if (type === 'success') setTimeout(() => setMessage(''), 4000)
  }

  // === Load data ===
  const loadAll = useCallback(async (companyId: string, weekFromISO: string, weekToISO: string) => {
    const [usersRes, schedsRes, asgsRes, holsRes] = await Promise.all([
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
        .eq('company_id', companyId)
        .eq('active', true)
        .is('completed_at', null),
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
        .or(`and(start_date.lte.${weekToISO},end_date.gte.${weekFromISO})`),
    ])

    // Anyone in the company who isn't a superuser can be assigned to a schedule.
    // The Schedules feature gate is for *viewing* the calendar — not for being assignable.
    const filteredUsers = (usersRes.data || []).filter((p: any) => p.role !== 'superuser')

    setUsers(filteredUsers)
    setSchedules(schedsRes.data || [])
    setHolidays(holsRes.data || [])

    // Build cells map from existing assignments
    const cmap: CellMap = {}
    ;(asgsRes.data || []).forEach((a: any) => {
      const key = `${a.schedule_id}|${a.assignment_date}`
      cmap[key] = {
        user_id: a.user_id,
        status: a.status,
        is_changed: a.is_changed,
        assignment_id: a.id,
        original_user_id: a.user_id,
      }
    })
    setCells(cmap)
    setHasUnsaved(false)
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

    if (profile.role !== 'admin' && profile.role !== 'manager') {
      router.push('/dashboard/schedules/calendar')
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

  // Warn before leaving with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasUnsaved) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [hasUnsaved])

  // === Derived ===
  const weekDates: Date[] = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  )

  // Does this schedule run on this date?
  const scheduleRunsOnDate = (s: any, d: Date): boolean => {
    const iso = isoDate(d)
    if (s.schedule_type === 'one_off') {
      if (!s.start_date || !s.end_date) return false
      return iso >= s.start_date && iso <= s.end_date
    }
    if (s.start_date && iso < s.start_date) return false
    if (s.end_date && iso > s.end_date) return false
    const dow = dowOf(d)
    return !!s.recurring_days?.[dow]
  }

  // Does this schedule run at any point in the visible week?
  const scheduleRunsThisWeek = (s: any): boolean => {
    return weekDates.some(d => scheduleRunsOnDate(s, d))
  }

  // Schedules to display: only those running this week
  const visibleSchedules = useMemo(
    () => schedules.filter(scheduleRunsThisWeek),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schedules, weekStart]
  )

  // Find approved holiday/keep-day-off/early-finish for a user on a date
  const userUnavailable = (userId: string, d: Date, scheduleStartTime: string): { reason: string } | null => {
    const iso = isoDate(d)
    const h = holidays.find(x =>
      x.user_id === userId &&
      iso >= x.start_date &&
      iso <= x.end_date
    )
    if (!h) return null
    if (h.request_type === 'holiday') {
      return { reason: h.half_day_type ? `Holiday (${h.half_day_type})` : 'Holiday' }
    }
    if (h.request_type === 'keep_day_off') {
      return { reason: 'Day Off' }
    }
    if (h.request_type === 'early_finish') {
      if (h.early_finish_time && scheduleStartTime && scheduleStartTime >= h.early_finish_time) {
        return { reason: `Early Finish ${formatTime(h.early_finish_time)}` }
      }
      return null
    }
    return null
  }

  // Returns users that can be assigned to this schedule on this date
  const availableUsers = (s: any, d: Date): any[] => {
    return users
      .filter(u => !u.is_frozen)
      .filter(u => !userUnavailable(u.id, d, s.start_time))
  }

  // === Cell editing ===
  const setCellUser = (s: any, d: Date, newUserId: string) => {
    const key = cellKey(s.id, d)
    setCells(prev => {
      const existing = prev[key]
      const original = existing?.original_user_id ?? null
      const value = newUserId || null
      const next: CellMap = { ...prev }

      if (!value && !existing) {
        return prev
      }

      next[key] = {
        ...(existing || { status: 'draft', is_changed: true }),
        user_id: value,
        is_changed: original !== value,
        status: existing?.assignment_id ? existing.status : 'draft',
        assignment_id: existing?.assignment_id,
        original_user_id: original,
      }

      return next
    })
    setHasUnsaved(true)
  }

  // === Save draft ===
  const handleSaveDraft = async () => {
    setSaving(true)

    try {
      const ops: Array<Promise<any>> = []
      const insertRows: any[] = []

      Object.entries(cells).forEach(([key, cell]) => {
        const [scheduleId, dateStr] = key.split('|')
        const original = cell.original_user_id ?? null
        const value = cell.user_id

        if (original === value) return

        if (cell.assignment_id) {
          if (!value) {
            ops.push(
              Promise.resolve(
                supabase.from('schedule_assignments').delete().eq('id', cell.assignment_id)
              )
            )
          } else {
            ops.push(
              Promise.resolve(
                supabase.from('schedule_assignments').update({
                  user_id: value,
                  status: 'draft',
                  is_changed: true,
                }).eq('id', cell.assignment_id)
              )
            )
          }
        } else if (value) {
          insertRows.push({
            schedule_id: scheduleId,
            company_id: currentUser.company_id,
            user_id: value,
            assignment_date: dateStr,
            status: 'draft',
            is_changed: true,
            created_by: currentUser.id,
          })
        }
      })

      if (insertRows.length > 0) {
        ops.push(
          Promise.resolve(
            supabase.from('schedule_assignments').insert(insertRows)
          )
        )
      }

      const results = await Promise.all(ops)
      const errors = results.filter((r: any) => r.error)

      if (errors.length > 0) {
        showMessage(`${errors.length} change(s) failed: ${(errors[0] as any).error?.message}`, 'error')
        setSaving(false)
        return
      }

      await logAuditClient({
        user: currentUser,
        action: 'SCHEDULE_ASSIGNMENTS_SAVED',
        entity: 'schedule_assignments',
        details: {
          week: `${isoDate(weekDates[0])} to ${isoDate(weekDates[6])}`,
          changes: results.length,
        },
      })

      const from = isoDate(weekStart)
      const to = isoDate(addDays(weekStart, 6))
      await loadAll(currentUser.company_id, from, to)
      showMessage(`Saved ${results.length} change(s) as draft. Click Publish when ready.`, 'success')
    } catch (err: any) {
      showMessage('Save failed: ' + (err?.message || 'unknown'), 'error')
    } finally {
      setSaving(false)
    }
  }

  // === Navigation ===
  const tryChangeWeek = (newStart: Date) => {
    if (hasUnsaved) {
      if (!confirm('You have unsaved changes. Discard them and change week?')) return
    }
    setWeekStart(newStart)
  }

  const goPrevWeek = () => tryChangeWeek(addDays(weekStart, -7))
  const goNextWeek = () => tryChangeWeek(addDays(weekStart, 7))
  const goToday = () => tryChangeWeek(startOfWeekMon(new Date()))

  const weekLabel = `${formatDateLong(weekDates[0])} – ${formatDateLong(weekDates[6])}`

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-500">Loading assign page...</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-100">
      <IdleWarningModal show={showWarning} secondsLeft={secondsLeft} onStay={stayLoggedIn} />

      <div className="bg-blue-700 text-white px-6 py-4 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">{company?.name}</h1>
          <p className="text-blue-200 text-sm">Assign Users to Schedules</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => router.push('/dashboard/schedules/calendar')}
            className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm"
          >
            📆 View Calendar
          </button>
          <button
            onClick={() => {
              if (hasUnsaved && !confirm('You have unsaved changes. Discard and leave?')) return
              router.push('/dashboard/schedules')
            }}
            className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm"
          >
            ← Back
          </button>
        </div>
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

          <button
            onClick={goToday}
            className="bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-medium"
          >
            Today
          </button>

          <div className="flex-1" />

          {hasUnsaved && (
            <span className="text-xs text-amber-700 font-medium">Unsaved changes</span>
          )}

          <button
            onClick={handleSaveDraft}
            disabled={!hasUnsaved || saving}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            {saving ? 'Saving...' : '💾 Save Draft'}
          </button>

          <button
            disabled
            title="Publish coming in next step"
            className="bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            ✓ Publish
          </button>
        </div>

        {/* Grid */}
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-3 py-3 text-xs font-semibold text-gray-600 uppercase border-b border-gray-200 sticky left-0 bg-gray-50 z-10 min-w-[220px]">
                    Schedule
                  </th>
                  {weekDates.map((d, i) => {
                    const isToday = isoDate(d) === isoDate(new Date())
                    return (
                      <th
                        key={i}
                        className={`text-left px-2 py-3 text-xs font-semibold uppercase border-b border-gray-200 min-w-[160px] ${
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
                {visibleSchedules.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center text-gray-400 py-12 text-sm">
                      No active schedules running this week.
                    </td>
                  </tr>
                )}
                {visibleSchedules.map((s) => (
                  <tr key={s.id} className="border-b border-gray-100 last:border-b-0">
                    <td className="px-3 py-3 align-top sticky left-0 bg-white z-10 border-r border-gray-100">
                      <div className="flex items-start gap-2">
                        <span className="text-lg flex-shrink-0">
                          {s.schedule_type === 'recurring' ? '🔁' : '📅'}
                        </span>
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-800 text-sm leading-tight">{s.name}</p>
                          <p className="text-[11px] text-gray-500 mt-0.5">
                            {formatTime(s.start_time)}–{formatTime(s.end_time)}
                          </p>
                        </div>
                      </div>
                    </td>
                    {weekDates.map((d, i) => {
                      const runs = scheduleRunsOnDate(s, d)
                      const key = cellKey(s.id, d)
                      const cell = cells[key]
                      const value = cell?.user_id || ''
                      const isChanged = cell?.is_changed
                      const isDraft = cell?.status === 'draft'
                      const isToday = isoDate(d) === isoDate(new Date())

                      if (!runs) {
                        return (
                          <td
                            key={i}
                            className="px-2 py-3 align-top text-center bg-gray-50 border-r border-gray-100 last:border-r-0"
                          >
                            <span className="text-gray-300 text-xs">—</span>
                          </td>
                        )
                      }

                      const avail = availableUsers(s, d)
                      const currentUserStillAvailable = !value || avail.some(u => u.id === value)
                      const currentUserObj = value ? users.find(u => u.id === value) : null

                      return (
                        <td
                          key={i}
                          className={`px-2 py-2 align-top text-xs border-r border-gray-100 last:border-r-0 ${
                            isToday ? 'bg-blue-50/30' : ''
                          } ${isChanged ? 'bg-yellow-100/60' : ''}`}
                        >
                          <select
                            value={value}
                            onChange={(e) => setCellUser(s, d, e.target.value)}
                            className={`w-full border rounded px-2 py-1 text-xs bg-white ${
                              !currentUserStillAvailable
                                ? 'border-red-400 text-red-700'
                                : isChanged
                                ? 'border-yellow-400'
                                : isDraft
                                ? 'border-amber-300'
                                : 'border-gray-300'
                            }`}
                          >
                            <option value="">—</option>
                            {!currentUserStillAvailable && currentUserObj && (
                              <option value={currentUserObj.id}>
                                ⚠ {currentUserObj.full_name} (now unavailable)
                              </option>
                            )}
                            {avail.map(u => (
                              <option key={u.id} value={u.id}>
                                {u.full_name}
                              </option>
                            ))}
                          </select>
                          {isDraft && !isChanged && (
                            <p className="text-[10px] text-amber-700 mt-0.5">Draft</p>
                          )}
                          {isChanged && (
                            <p className="text-[10px] text-yellow-700 mt-0.5 font-medium">Changed</p>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Help text */}
        <div className="bg-white rounded-xl shadow p-3 text-xs text-gray-600 space-y-1">
          <p>📋 <strong>How it works:</strong> Pick a user from each dropdown to assign them to that schedule on that day. Days where the schedule doesn't run show "—". Users on holiday, day-off, or with an early finish before the schedule starts are hidden from the dropdown.</p>
          <p>💾 <strong>Save Draft</strong> stores changes without making them visible to employees. <strong>Publish</strong> (coming next step) makes assignments live on the calendar.</p>
        </div>
      </div>
    </main>
  )
}