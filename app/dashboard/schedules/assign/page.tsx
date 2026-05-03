'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { logAuditClient } from '@/lib/auditClient'
import { notifyEvent } from '@/lib/notifyEvent'
import PublishPickerModal, { type PublishFilter } from '@/components/PublishPickerModal'

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

const dowOf = (d: Date): string => {
  const j = d.getDay()
  const map: Record<number, string> = { 0: 'sun', 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat' }
  return map[j]
}

// scheduleId|YYYY-MM-DD => state
type CellMap = Record<string, {
  user_id: string | null
  status: 'draft' | 'published'
  is_changed: boolean             // true if changed AFTER a publish (drives unpublished-change yellow)
  has_been_published: boolean
  first_user_id: string | null    // the very first user ever assigned to this cell — never changes
  assignment_id?: string
  saved_user_id?: string | null   // the user_id currently in the database (to detect unsaved edits)
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
  const [publishing, setPublishing] = useState(false)
  const [publishModalOpen, setPublishModalOpen] = useState(false)
  const [hasUnsaved, setHasUnsaved] = useState(false)

  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeekMon(new Date()))

  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

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
        .select(`id, full_name, role, job_title, is_frozen, display_order`)
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
        .lte('start_date', weekToISO)
        .gte('end_date', weekFromISO),
    ])

    // Surface load errors instead of silently showing empty data
    if (usersRes.error)  console.error('[assign] users load error:', usersRes.error)
    if (schedsRes.error) console.error('[assign] schedules load error:', schedsRes.error)
    if (asgsRes.error)   console.error('[assign] assignments load error:', asgsRes.error)
    if (holsRes.error)   console.error('[assign] holidays load error:', holsRes.error)

    const filteredUsers = (usersRes.data || []).filter((p: any) => p.role !== 'superuser')

    setUsers(filteredUsers)
    setSchedules(schedsRes.data || [])
    setHolidays(holsRes.data || [])

    const cmap: CellMap = {}
    ;(asgsRes.data || []).forEach((a: any) => {
      const key = `${a.schedule_id}|${a.assignment_date}`
      cmap[key] = {
        user_id: a.user_id,
        status: a.status,
        is_changed: a.is_changed,
        has_been_published: !!a.published_at,
        first_user_id: a.first_user_id ?? a.user_id, // fallback if column not yet populated
        assignment_id: a.id,
        saved_user_id: a.user_id,
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

  const weekDates: Date[] = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  )

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

  const scheduleRunsThisWeek = (s: any): boolean => {
    return weekDates.some(d => scheduleRunsOnDate(s, d))
  }

  const visibleSchedules = useMemo(
    () => schedules.filter(scheduleRunsThisWeek),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schedules, weekStart]
  )

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
      const value = newUserId || null
      const next: CellMap = { ...prev }

      if (!value && !existing) {
        return prev
      }

      next[key] = {
        ...(existing || {
          status: 'draft',
          is_changed: false,
          has_been_published: false,
          first_user_id: null,
        }),
        user_id: value,
        // is_changed = changes since last publish (drives the unpublished-change yellow during edit)
        is_changed: existing?.has_been_published
          ? (existing.saved_user_id ?? null) !== value
          : false,
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
        const saved = cell.saved_user_id ?? null
        const value = cell.user_id

        if (saved === value) return

        if (cell.assignment_id) {
          if (!value) {
            ops.push(
              Promise.resolve(
                supabase.from('schedule_assignments').delete().eq('id', cell.assignment_id)
              )
            )
          } else {
            const newIsChanged = cell.has_been_published
            ops.push(
              Promise.resolve(
                supabase.from('schedule_assignments').update({
                  user_id: value,
                  is_changed: newIsChanged,
                }).eq('id', cell.assignment_id)
              )
            )
          }
        } else if (value) {
          // Brand new — first_user_id auto-set by db trigger
          insertRows.push({
            schedule_id: scheduleId,
            company_id: currentUser.company_id,
            user_id: value,
            assignment_date: dateStr,
            status: 'draft',
            is_changed: false,
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
      showMessage(`Saved ${results.length} change(s). Click Publish when ready.`, 'success')
    } catch (err: any) {
      showMessage('Save failed: ' + (err?.message || 'unknown'), 'error')
    } finally {
      setSaving(false)
    }
  }

  // Count assignments needing publish (drafts or post-publish changes)
  const unpublishedCount = useMemo(() => {
    return Object.values(cells).filter(c =>
      c.assignment_id && (c.status === 'draft' || c.is_changed)
    ).length
  }, [cells])

  // Build "publishable cells" — same approach as day-sheet/assign.
  // Used by the picker modal for dropdown options and the live count.
  const publishableCells = useMemo(() => {
    const out: { scheduleId: string; date: string; userId: string | null }[] = []
    for (const [k, c] of Object.entries(cells)) {
      if (!c.assignment_id) continue
      if (c.status !== 'draft' && !c.is_changed) continue
      const [scheduleId, date] = k.split('|')
      if (!scheduleId || !date) continue
      out.push({ scheduleId, date, userId: c.user_id })
    }
    return out
  }, [cells])

  const availableDates = useMemo(() => {
    const set = new Set<string>()
    for (const c of publishableCells) set.add(c.date)
    const sorted = Array.from(set).sort()
    return sorted.map(iso => {
      const d = new Date(iso + 'T00:00:00')
      const label = d.toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long',
      })
      return { id: iso, label }
    })
  }, [publishableCells])

  const availableUsers = useMemo(() => {
    const set = new Set<string>()
    for (const c of publishableCells) {
      if (c.userId) set.add(c.userId)
    }
    return Array.from(set)
      .map(id => {
        const u = users.find((x: any) => x.id === id)
        return { id, label: u?.full_name || '(unknown user)' }
      })
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [publishableCells, users])

  const countFor = useCallback((filter: PublishFilter) => {
    return publishableCells.filter(c => {
      if (filter.date && c.date !== filter.date) return false
      if (filter.userId && c.userId !== filter.userId) return false
      return true
    }).length
  }, [publishableCells])

  const weekRangeLabel = useMemo(() => {
    const f = weekDates[0]
    const t = weekDates[6]
    const fStr = f.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    const tStr = t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    return `${fStr} – ${tStr}`
  }, [weekDates])

  // === Publish ===
  // Two phases:
  //   1. handlePublish(): pre-flight checks (unsaved? nothing to do?),
  //      then opens the picker modal so the planner picks scope.
  //   2. submitPublish(filter): called by the modal once the planner
  //      has picked. Builds a filtered query, fires notifications only
  //      for the rows actually published.
  const handlePublish = async () => {
    if (hasUnsaved) {
      if (!confirm('You have unsaved changes. Save them as draft first, then publish?')) return
      await handleSaveDraft()
    }

    if (unpublishedCount === 0) {
      showMessage('No assignments to publish in this week.', 'error')
      return
    }

    setPublishModalOpen(true)
  }

  const submitPublish = async (filter: PublishFilter) => {
    if (!currentUser?.company_id) return

    setPublishing(true)
    const fromISO = isoDate(weekDates[0])
    const toISO = isoDate(weekDates[6])
    const now = new Date().toISOString()

    try {
      // Build the candidates query so we can ping each assignee after
      // the bulk update succeeds. Same filter is applied to both
      // candidates and update queries so they stay consistent.
      let candQuery = supabase
        .from('schedule_assignments')
        .select('id')
        .eq('company_id', currentUser.company_id)
        .or('status.eq.draft,is_changed.eq.true')
      if (filter.date) {
        candQuery = candQuery.eq('assignment_date', filter.date)
      } else {
        candQuery = candQuery.gte('assignment_date', fromISO).lte('assignment_date', toISO)
      }
      if (filter.userId) {
        candQuery = candQuery.eq('user_id', filter.userId)
      }
      const { data: toPublish } = await candQuery

      let updQuery = supabase
        .from('schedule_assignments')
        .update({
          status: 'published',
          is_changed: false,
          published_at: now,
          published_by: currentUser.id,
        })
        .eq('company_id', currentUser.company_id)
        .or('status.eq.draft,is_changed.eq.true')
      if (filter.date) {
        updQuery = updQuery.eq('assignment_date', filter.date)
      } else {
        updQuery = updQuery.gte('assignment_date', fromISO).lte('assignment_date', toISO)
      }
      if (filter.userId) {
        updQuery = updQuery.eq('user_id', filter.userId)
      }

      const { error } = await updQuery

      if (error) {
        showMessage('Publish failed: ' + error.message, 'error')
        setPublishing(false)
        return
      }

      // Phone push per assignee — only those actually published.
      // Fail-silent — the update has already succeeded.
      if (toPublish && toPublish.length > 0) {
        toPublish.forEach((row: any) => {
          notifyEvent({ kind: 'schedule_assigned', assignment_id: row.id })
        })
      }

      const publishedCount = toPublish?.length || 0

      await logAuditClient({
        user: currentUser,
        action: 'SCHEDULE_ASSIGNMENTS_PUBLISHED',
        entity: 'schedule_assignments',
        details: {
          week: `${fromISO} to ${toISO}`,
          published_count: publishedCount,
          user_id: filter.userId || null,
          date: filter.date || null,
        },
      })

      setPublishModalOpen(false)
      await loadAll(currentUser.company_id, fromISO, toISO)
      showMessage(`Published ${publishedCount} assignment${publishedCount === 1 ? '' : 's'}. Now visible on the calendar.`, 'success')
    } catch (err: any) {
      showMessage('Publish failed: ' + (err?.message || 'unknown'), 'error')
    } finally {
      setPublishing(false)
    }
  }


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
      <div className="p-8 text-slate-400 italic">Loading…</div>
    )
  }

  return (
    <div className="p-6 max-w-[1600px]">

      <div className="mb-4">
        <button
          onClick={() => router.push('/dashboard/schedules')}
          className="text-xs text-slate-500 hover:text-slate-700 mb-2 inline-flex items-center gap-1"
        >
          ← Back to schedules
        </button>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-slate-900 mb-0.5">Assign Schedules</h1>
            <p className="text-xs text-slate-500">{company?.name}</p>
          </div>
          <button
            onClick={() => router.push('/dashboard/schedules/calendar')}
            className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-medium transition"
          >
            📆 View Calendar
          </button>
        </div>
      </div>

      <div className="space-y-3">

        {message && (
          <div className={`p-2.5 rounded-lg text-xs font-medium ${
            messageType === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            {message}
          </div>
        )}

        {unpublishedCount > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 flex items-center gap-2 text-xs">
            <span className="text-base">⚠️</span>
            <p className="text-yellow-800 flex-1">
              <strong>{unpublishedCount}</strong> assignment{unpublishedCount === 1 ? '' : 's'} not yet published — employees won&apos;t see them until you click Publish.
            </p>
          </div>
        )}

        {/* Toolbar */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-2 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-0.5">
            <button
              onClick={goPrevWeek}
              className="bg-slate-100 hover:bg-slate-200 text-slate-700 w-7 h-7 rounded-md text-xs font-medium"
              title="Previous week"
            >
              ←
            </button>
            <div className="px-2 py-1 font-medium text-slate-800 text-xs whitespace-nowrap">
              {weekLabel}
            </div>
            <button
              onClick={goNextWeek}
              className="bg-slate-100 hover:bg-slate-200 text-slate-700 w-7 h-7 rounded-md text-xs font-medium"
              title="Next week"
            >
              →
            </button>
          </div>

          <button
            onClick={goToday}
            className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 px-2 py-1 rounded-md text-xs font-medium"
          >
            Today
          </button>

          <div className="flex-1" />

          {hasUnsaved && (
            <span className="text-xs text-amber-700 font-medium">Unsaved</span>
          )}

          <button
            onClick={handleSaveDraft}
            disabled={!hasUnsaved || saving || publishing}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-2.5 py-1 rounded-md text-xs font-medium"
          >
            {saving ? 'Saving…' : '💾 Save'}
          </button>

          <button
            onClick={handlePublish}
            disabled={publishing || saving || (unpublishedCount === 0 && !hasUnsaved)}
            className="bg-green-600 hover:bg-green-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-2.5 py-1 rounded-md text-xs font-medium"
          >
            {publishing ? 'Publishing…' : `✓ Publish${unpublishedCount > 0 ? ` (${unpublishedCount})` : ''}`}
          </button>
        </div>

        {/* Grid */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left px-2 py-1.5 text-[10px] font-semibold text-slate-600 uppercase border-b border-slate-200 sticky left-0 bg-slate-50 z-10 min-w-[160px]">
                    Schedule
                  </th>
                  {weekDates.map((d, i) => {
                    const isToday = isoDate(d) === isoDate(new Date())
                    return (
                      <th
                        key={i}
                        className={`text-center px-1.5 py-1.5 text-[10px] font-semibold uppercase border-b border-slate-200 min-w-[110px] ${
                          isToday ? 'bg-blue-50 text-blue-800' : 'text-slate-600'
                        }`}
                      >
                        <div className="flex items-baseline justify-center gap-1">
                          <span>{d.toLocaleDateString('en-GB', { weekday: 'short' })}</span>
                          <span className="text-xs font-bold normal-case">{formatDateShort(d)}</span>
                        </div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {visibleSchedules.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center text-slate-400 py-8 text-xs">
                      No active schedules running this week.
                    </td>
                  </tr>
                )}
                {visibleSchedules.map((s) => (
                  <tr key={s.id} className="border-b border-slate-100 last:border-b-0">
                    <td className="px-2 py-1.5 align-top sticky left-0 bg-white z-10 border-r border-slate-100">
                      <div className="flex items-start gap-1.5">
                        <span className="text-sm flex-shrink-0 leading-none mt-0.5">
                          {s.schedule_type === 'recurring' ? '🔁' : '📅'}
                        </span>
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-800 text-xs leading-tight">{s.name}</p>
                          <p className="text-[10px] text-slate-500 mt-0.5">
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
                      const isUnpublishedChange = !!cell?.is_changed
                      const isFreshDraft = !!cell?.assignment_id && cell?.status === 'draft' && !cell?.has_been_published
                      // "Permanent" change indicator: current user differs from the very first user
                      const isHistoricallyChanged =
                        !!cell?.assignment_id &&
                        cell?.first_user_id &&
                        cell?.user_id &&
                        cell.first_user_id !== cell.user_id
                      const isToday = isoDate(d) === isoDate(new Date())

                      if (!runs) {
                        return (
                          <td
                            key={i}
                            className="px-1 py-1 align-top text-center bg-slate-50 border-r border-slate-100 last:border-r-0"
                          >
                            <span className="text-slate-300 text-[10px]">—</span>
                          </td>
                        )
                      }

                      const avail = availableUsers(s, d)
                      const currentUserStillAvailable = !value || avail.some(u => u.id === value)
                      const currentUserObj = value ? users.find(u => u.id === value) : null

                      // Bright yellow = unpublished change (highest priority)
                      // Soft yellow = historically changed since first assignment
                      // Amber = fresh draft (never published)
                      const yellowHighlight = isUnpublishedChange
                      const softYellow = !isUnpublishedChange && isHistoricallyChanged
                      const amberTint = !isUnpublishedChange && !isHistoricallyChanged && isFreshDraft

                      return (
                        <td
                          key={i}
                          className={`px-1 py-1 align-top text-xs border-r border-slate-100 last:border-r-0 ${
                            isToday ? 'bg-blue-50/30' : ''
                          } ${yellowHighlight ? 'bg-yellow-100/70' : softYellow ? 'bg-yellow-50/70' : amberTint ? 'bg-amber-50/60' : ''}`}
                        >
                          <select
                            value={value}
                            onChange={(e) => setCellUser(s, d, e.target.value)}
                            className={`w-full border rounded px-1.5 py-0.5 text-[11px] bg-white ${
                              !currentUserStillAvailable
                                ? 'border-red-400 text-red-700'
                                : yellowHighlight
                                ? 'border-yellow-500'
                                : softYellow
                                ? 'border-yellow-300'
                                : amberTint
                                ? 'border-amber-300'
                                : 'border-slate-300'
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
                          {amberTint && (
                            <p className="text-[10px] text-amber-700 mt-0.5 font-medium">Draft</p>
                          )}
                          {yellowHighlight && (
                            <p className="text-[10px] text-yellow-800 mt-0.5 font-medium">Unpublished change</p>
                          )}
                          {softYellow && (
                            <p className="text-[10px] text-yellow-700 mt-0.5 font-medium">Reassigned</p>
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
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 px-3 py-2 text-[11px] text-slate-600 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2 h-2 bg-amber-100 border border-amber-300 rounded-sm" /> Draft</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2 h-2 bg-yellow-200 border border-yellow-500 rounded-sm" /> Unpublished change</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2 h-2 bg-yellow-50 border border-yellow-300 rounded-sm" /> Reassigned</span>
          <span className="text-slate-400">•</span>
          <span><strong>Save</strong> stores silently. <strong>Publish</strong> makes live for employees.</span>
        </div>
      </div>

      <PublishPickerModal
        open={publishModalOpen}
        onClose={() => { if (!publishing) setPublishModalOpen(false) }}
        onPublish={submitPublish}
        weekRangeLabel={weekRangeLabel}
        availableDates={availableDates}
        availableUsers={availableUsers}
        countFor={countFor}
        busy={publishing}
      />
    </div>
  )
}