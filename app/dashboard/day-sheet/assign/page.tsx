'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh'
import { notifyEvent } from '@/lib/notifyEvent'
import PublishPickerModal, { type PublishFilter } from '@/components/PublishPickerModal'

const supabase = createClient()

// ── Date helpers ─────────────────────────────────────────────────────
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
  const out = new Date(d); out.setDate(out.getDate() + n); return out
}

const formatDateShort = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })

const formatTime = (t: string | null) => (t ? t.slice(0, 5) : '')

const DAY_FROM_INDEX = ['sun','mon','tue','wed','thu','fri','sat']

// ── Types ────────────────────────────────────────────────────────────
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
  linked_group_id: string | null
}

type Profile = {
  id: string
  full_name: string | null
  role: string
  is_frozen: boolean | null
  display_order: number | null
}

type Assignment = {
  day_sheet_id: string
  assignment_date: string
  user_id: string | null
  status: 'draft' | 'published'
  is_changed: boolean
  published_at: string | null
}

// State key = `${sheet_id}|${date}`. Tracks pending/server values for
// each (sheet, date) cell.
type DriverPick = string | null
type CellMap = Record<string, DriverPick>

// Publish status per cell, also keyed by sheet|date. Cells with no
// assignment row at all are absent from the map (treated as "no
// publish state"). 'draft' = saved but never published. 'changed' =
// published once but edited since (server's is_changed=true).
// 'published' = published, no edits since.
type PublishStatus = 'draft' | 'changed' | 'published'
type PublishMap = Record<string, PublishStatus>

// ── Does this sheet run on this date? ────────────────────────────────
const sheetRunsOn = (s: DaySheet, dateIso: string): boolean => {
  if (dateIso < s.start_date) return false
  if (s.end_date && dateIso > s.end_date) return false
  if (s.sheet_type === 'one_off') {
    // A one-off sheet without end_date runs on its single start_date
    // only. With end_date set, it runs on every day in
    // [start_date, end_date] inclusive — the bounds checks above have
    // already enforced the range, so we just say yes.
    return s.end_date ? true : dateIso === s.start_date
  }
  if (s.sheet_type === 'recurring') {
    const slug = DAY_FROM_INDEX[new Date(dateIso + 'T00:00:00').getDay()]
    return (s.recurring_days || []).includes(slug)
  }
  return false
}

const cellKey = (sheetId: string, dateIso: string) => `${sheetId}|${dateIso}`

export default function DaySheetAssignPage() {
  const router = useRouter()
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [users, setUsers] = useState<Profile[]>([])
  const [sheets, setSheets] = useState<DaySheet[]>([])
  const [serverAssignments, setServerAssignments] = useState<CellMap>({})
  const [serverPublishMap, setServerPublishMap] = useState<PublishMap>({})
  const [pending, setPending] = useState<CellMap>({})
  const [overridden, setOverridden] = useState<Record<string, true>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishModalOpen, setPublishModalOpen] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeekMon(new Date()))

  const showMessage = (msg: string, type: 'success' | 'error' = 'success') => {
    setMessage(msg); setMessageType(type)
    if (type === 'success') setTimeout(() => setMessage(''), 4000)
  }

  // Resolve current user → company_id
  useEffect(() => {
    let cancelled = false
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const { data: profile } = await supabase
        .from('profiles')
        .select('company_id, role')
        .eq('id', user.id)
        .single()
      if (cancelled) return
      if (!profile?.company_id) { router.push('/dashboard'); return }
      setCompanyId(profile.company_id)
      setCurrentUserId(user.id)
    }
    init()
    return () => { cancelled = true }
  }, [router])

  // ── 7 columns of dates ──────────────────────────────────────────
  const weekDates = useMemo(() => {
    const out: Date[] = []
    for (let i = 0; i < 7; i++) out.push(addDays(weekStart, i))
    return out
  }, [weekStart])
  const weekFromIso = useMemo(() => isoDate(weekDates[0]), [weekDates])
  const weekToIso = useMemo(() => isoDate(weekDates[6]), [weekDates])

  // Fetch users + sheets overlapping the week + assignments in week
  const fetchData = useCallback(async () => {
    if (!companyId) return
    setLoading(true)

    const [usersRes, sheetsRes, asgRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, full_name, role, is_frozen, display_order')
        .eq('company_id', companyId)
        .eq('is_deleted', false)
        .order('display_order', { ascending: true, nullsFirst: false })
        .order('full_name', { ascending: true }),
      supabase
        .from('day_sheets')
        .select('id, customer_name, job_description, sheet_type, start_date, end_date, recurring_days, start_time, end_time, passenger_count, job_notes, linked_group_id')
        .eq('company_id', companyId)
        .eq('active', true)
        .lte('start_date', weekToIso)
        .or(`end_date.is.null,end_date.gte.${weekFromIso}`)
        .order('start_time', { ascending: true, nullsFirst: false })
        .order('start_date', { ascending: true }),
      supabase
        .from('day_sheet_assignments')
        .select('day_sheet_id, assignment_date, user_id, status, is_changed, published_at')
        .eq('company_id', companyId)
        .gte('assignment_date', weekFromIso)
        .lte('assignment_date', weekToIso),
    ])

    if (usersRes.error)  console.error('[day-sheet-assign] users error:', usersRes.error)
    if (sheetsRes.error) console.error('[day-sheet-assign] sheets error:', sheetsRes.error)
    if (asgRes.error)    console.error('[day-sheet-assign] assignments error:', asgRes.error)

    const filteredUsers = (usersRes.data || []).filter(p => p.role !== 'superuser')
    const sheetData = (sheetsRes.data || []) as DaySheet[]

    const serverMap: CellMap = {}
    const pubMap: PublishMap = {}
    ;(asgRes.data || []).forEach((a: Assignment) => {
      const k = cellKey(a.day_sheet_id, a.assignment_date)
      serverMap[k] = a.user_id || null
      // Decide publish status: if there's no published_at, it's a draft.
      // If published_at is set but the row was edited since (is_changed),
      // mark as 'changed'. Otherwise it's cleanly 'published'.
      if (!a.published_at) {
        pubMap[k] = 'draft'
      } else if (a.is_changed) {
        pubMap[k] = 'changed'
      } else {
        pubMap[k] = 'published'
      }
    })

    setUsers(filteredUsers)
    setSheets(sheetData)
    setServerAssignments(serverMap)
    setServerPublishMap(pubMap)
    setPending(serverMap)
    setOverridden({})
    setLoading(false)
  }, [companyId, weekFromIso, weekToIso])

  useEffect(() => { fetchData() }, [fetchData])

  useRealtimeRefresh(
    'day-sheet-assign',
    [
      { table: 'day_sheets', companyId },
      { table: 'day_sheet_assignments', companyId },
    ],
    fetchData,
    !!companyId,
  )

  // Filter sheets to those that run AT LEAST ONE day in the visible
  // week. Sheets that never run this week (e.g. a Mon-only recurring
  // looking at a week with no Monday gap, or a one-off whose date is
  // outside the week) get hidden so we don't show 7 empty cells.
  const visibleSheets = useMemo(() => {
    return sheets.filter(s => weekDates.some(d => sheetRunsOn(s, isoDate(d))))
  }, [sheets, weekDates])

  // ── Unsaved detection ────────────────────────────────────────────
  const hasUnsaved = useMemo(() => {
    const allKeys = new Set([
      ...Object.keys(pending),
      ...Object.keys(serverAssignments),
    ])
    for (const k of allKeys) {
      const p = pending[k] ?? null
      const s = serverAssignments[k] ?? null
      if (p !== s) return true
    }
    return false
  }, [pending, serverAssignments])

  useEffect(() => {
    if (!hasUnsaved) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [hasUnsaved])

  // ── Driver pick + auto-fill (step 5.7) ──────────────────────────
  // Auto-fill rules:
  //
  //   Axis 1 — Linked siblings on the same date.
  //     ALWAYS applies, regardless of sheet type. Picking a driver on
  //     Job 1's Monday auto-fills Job 2's Monday (if they're linked
  //     and Job 2 also runs that Monday).
  //
  //   Axis 2 — Same sheet, other dates.
  //     ONLY applies for one_off sheets that have an end_date (i.e.
  //     a multi-day continuous range). The fan-out covers EVERY day
  //     in the range, not just the visible week — so if the planner
  //     navigates to next week, the auto-filled cells are already
  //     populated in pending state.
  //     Recurring sheets do NOT propagate across days — each weekday
  //     is picked independently. Single-day one_off sheets have only
  //     one date so this axis doesn't apply.
  //
  //   Axis 3 — Transitive (linked siblings on other dates).
  //     Only fires when axis 2 fired, applied to each linked sibling
  //     for each cross-day date.
  //
  // All axes skip any cell already manually overridden in this session.
  const setDriverFor = (sheetId: string, dateIso: string, userId: string | null) => {
    const key = cellKey(sheetId, dateIso)

    // Compute the dates this picker should fan out to. Done outside
    // setPending so we can show the planner a confirmation toast for
    // multi-day fans.
    const sheet = sheets.find(s => s.id === sheetId)
    const sameSheetDates: string[] = []
    if (sheet) {
      const isMultiDayOneOff =
        sheet.sheet_type === 'one_off' &&
        sheet.end_date &&
        sheet.end_date !== sheet.start_date

      if (isMultiDayOneOff) {
        // Walk every day in [start_date, end_date] — even days outside
        // the visible week.
        const cur = new Date(sheet.start_date + 'T00:00:00')
        const end = new Date(sheet.end_date! + 'T00:00:00')
        while (cur <= end) {
          const d = isoDate(cur)
          if (d !== dateIso) sameSheetDates.push(d)
          cur.setDate(cur.getDate() + 1)
        }
      }
    }

    setPending(prev => {
      const next = { ...prev, [key]: userId }
      setOverridden(o => ({ ...o, [key]: true }))

      if (!sheet) return next

      const tryFill = (sId: string, dIso: string) => {
        const k = cellKey(sId, dIso)
        if (k === key) return
        if (overridden[k]) return
        next[k] = userId
      }

      // Axis 1: linked siblings on same date — always
      if (sheet.linked_group_id) {
        sheets.forEach(other => {
          if (other.id === sheetId) return
          if (other.linked_group_id !== sheet.linked_group_id) return
          if (!sheetRunsOn(other, dateIso)) return
          tryFill(other.id, dateIso)
        })
      }

      // Axis 2: same sheet, other dates — only for multi-day one_off.
      // sameSheetDates is empty for single-day or recurring sheets.
      for (const otherDate of sameSheetDates) {
        tryFill(sheet.id, otherDate)

        // Axis 3 (transitive): linked siblings on those other dates
        if (sheet.linked_group_id) {
          sheets.forEach(other => {
            if (other.id === sheetId) return
            if (other.linked_group_id !== sheet.linked_group_id) return
            if (!sheetRunsOn(other, otherDate)) return
            tryFill(other.id, otherDate)
          })
        }
      }

      return next
    })

    // Confirmation toast for multi-day fan-out, so the planner knows
    // the auto-fill happened across cells they can't see.
    if (sameSheetDates.length > 0 && userId) {
      const totalDays = sameSheetDates.length + 1
      showMessage(
        `Auto-filled across ${totalDays} day${totalDays === 1 ? '' : 's'} (${sheet?.start_date} – ${sheet?.end_date}). Click Save day to commit.`,
        'success',
      )
    }
  }

  // ── Save day ─────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!companyId || saving) return
    setSaving(true)
    setMessage('')

    const items: Array<{ day_sheet_id: string; assignment_date: string; user_id: string | null }> = []
    const allKeys = new Set([
      ...Object.keys(pending),
      ...Object.keys(serverAssignments),
    ])
    for (const k of allKeys) {
      const p = pending[k] ?? null
      const s = serverAssignments[k] ?? null
      if (p === s) continue
      const [sheetId, date] = k.split('|')
      if (!sheetId || !date) continue
      items.push({ day_sheet_id: sheetId, assignment_date: date, user_id: p })
    }

    if (items.length === 0) {
      showMessage('Nothing to save.', 'success')
      setSaving(false)
      return
    }

    try {
      const res = await fetch('/api/bulk-save-day-sheet-assignments', {
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

  const userById = useMemo(() => {
    const m = new Map<string, Profile>()
    users.forEach(u => m.set(u.id, u))
    return m
  }, [users])

  // Count cells that need publishing in the visible week (drafts or
  // post-publish edits). This counts SAVED rows only — pending unsaved
  // edits are excluded; planner needs to Save first.
  const unpublishedCount = useMemo(() => {
    return Object.values(serverPublishMap).filter(
      v => v === 'draft' || v === 'changed'
    ).length
  }, [serverPublishMap])

  // Build the set of "publishable cells" — keys for cells in the
  // visible week that are draft or changed. Used by both the modal
  // dropdowns and the live count.
  const publishableCells = useMemo(() => {
    const set: { sheetId: string; date: string; userId: string | null }[] = []
    for (const [k, v] of Object.entries(serverPublishMap)) {
      if (v !== 'draft' && v !== 'changed') continue
      const [sheetId, date] = k.split('|')
      if (!sheetId || !date) continue
      const userId = serverAssignments[k] ?? null
      set.push({ sheetId, date, userId })
    }
    return set
  }, [serverPublishMap, serverAssignments])

  // Dates in the visible week that have publishable cells.
  const availableDates = useMemo(() => {
    const dateSet = new Set<string>()
    for (const c of publishableCells) dateSet.add(c.date)
    const sorted = Array.from(dateSet).sort()
    return sorted.map(iso => {
      const d = new Date(iso + 'T00:00:00')
      const label = d.toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long',
      })
      return { id: iso, label }
    })
  }, [publishableCells])

  // Users with publishable cells in the visible week.
  const availableUsers = useMemo(() => {
    const userSet = new Set<string>()
    for (const c of publishableCells) {
      if (c.userId) userSet.add(c.userId)
    }
    return Array.from(userSet)
      .map(id => {
        const u = users.find(x => x.id === id)
        return { id, label: u?.full_name || '(unknown user)' }
      })
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [publishableCells, users])

  // Live count for the modal preview — how many cells will actually
  // be published given the current filter.
  const countFor = useCallback((filter: PublishFilter) => {
    return publishableCells.filter(c => {
      if (filter.date && c.date !== filter.date) return false
      if (filter.userId && c.userId !== filter.userId) return false
      return true
    }).length
  }, [publishableCells])

  // Friendly label for the "Whole week" tickbox. Shows the Mon–Sun
  // range, e.g. "5 May – 11 May".
  const weekRangeLabel = useMemo(() => {
    const f = weekDates[0]
    const t = weekDates[6]
    const fStr = f.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    const tStr = t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    return `${fStr} – ${tStr}`
  }, [weekDates])

  // ── Publish ──────────────────────────────────────────────────────
  // Two phases:
  //   1. handlePublish(): pre-flight checks (unsaved? nothing to do?),
  //      then opens the picker modal so the planner picks scope.
  //   2. submitPublish(filter): called by the modal once the planner
  //      has picked. Sends the filter to the API.
  //
  // Drivers will see published assignments once the employee-side day
  // sheet view is built — until then publishing has no driver-facing
  // effect, but the planner still needs the lock-in to track
  // changes.
  const handlePublish = async () => {
    if (!companyId || publishing) return

    let justSaved = false
    if (hasUnsaved) {
      if (!confirm('You have unsaved changes. Save them as draft first, then publish?')) return
      await handleSave()
      justSaved = true
    }

    // Re-check after a possible save. If there's still nothing
    // publishable, surface a friendly message instead of opening an
    // empty modal.
    if (!justSaved && unpublishedCount === 0) {
      showMessage('Nothing to publish in this week.', 'error')
      return
    }

    setPublishModalOpen(true)
  }

  const submitPublish = async (filter: PublishFilter) => {
    if (!companyId) return
    setPublishing(true)
    setMessage('')
    try {
      const res = await fetch('/api/publish-day-sheet-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          from: weekFromIso,
          to: weekToIso,
          published_by: currentUserId,
          user_id: filter.userId,
          date: filter.date,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        showMessage(data.error || 'Failed to publish', 'error')
        return
      }
      setPublishModalOpen(false)
      showMessage(
        `Published ${data.published || 0} assignment${data.published === 1 ? '' : 's'}.`,
        'success',
      )

      // Fire-and-forget per-row driver pings. The publish API
      // returns the IDs of rows that just got flipped to 'published'
      // — we ping each one. notifyEvent itself is fail-silent so a
      // bad push doesn't surface to the planner. Don't await: a
      // slow push provider shouldn't hold up the UI redraw.
      const ids: string[] = Array.isArray(data.published_ids) ? data.published_ids : []
      for (const id of ids) {
        notifyEvent({ kind: 'day_sheet_assigned', assignment_id: id })
      }

      await fetchData()
    } catch (err: any) {
      showMessage(err?.message || 'Server error', 'error')
    } finally {
      setPublishing(false)
    }
  }


  const todayIso = isoDate(new Date())

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-[1600px]">
      <div className="flex items-baseline justify-between mb-4 gap-4 flex-wrap">
        <div>
          <Link href="/dashboard/day-sheet" className="text-sm text-blue-600 hover:underline">
            ← Back to Day Sheet list
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 mt-2">Assign drivers</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWeekStart(addDays(weekStart, -7))}
            className="px-3 py-1.5 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg"
            disabled={saving}
          >← Prev week</button>
          <button
            type="button"
            onClick={() => setWeekStart(startOfWeekMon(new Date()))}
            className="px-3 py-1.5 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg"
            disabled={saving}
          >This week</button>
          <button
            type="button"
            onClick={() => setWeekStart(addDays(weekStart, 7))}
            className="px-3 py-1.5 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg"
            disabled={saving}
          >Next week →</button>
        </div>
      </div>

      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="text-sm text-slate-600">
          Week of <span className="font-medium text-slate-800">
            {weekDates[0].toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}
          </span> — <span className="font-medium text-slate-800">
            {weekDates[6].toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || publishing || !hasUnsaved}
            className={`px-5 py-2 text-sm font-medium rounded-lg transition ${
              saving || publishing || !hasUnsaved
                ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
            }`}
          >
            {saving ? 'Saving…' : hasUnsaved ? 'Save day' : 'No changes'}
          </button>
          <button
            type="button"
            onClick={handlePublish}
            disabled={publishing || saving || unpublishedCount === 0 || hasUnsaved}
            title={
              hasUnsaved
                ? 'Save your changes first'
                : unpublishedCount === 0
                ? 'Nothing to publish in this week'
                : 'Push these assignments to drivers'
            }
            className={`px-5 py-2 text-sm font-medium rounded-lg transition flex items-center gap-2 ${
              publishing || saving || unpublishedCount === 0 || hasUnsaved
                ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                : 'bg-emerald-600 hover:bg-emerald-700 text-white'
            }`}
          >
            {publishing
              ? 'Publishing…'
              : (
                <>
                  <span>Publish</span>
                  {unpublishedCount > 0 && !hasUnsaved && (
                    <span className="bg-white/20 text-white text-[11px] font-semibold rounded-full min-w-[20px] h-[18px] px-1.5 flex items-center justify-center">
                      {unpublishedCount}
                    </span>
                  )}
                </>
              )}
          </button>
        </div>
      </div>

      {hasUnsaved && (
        <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg">
          You have unsaved changes. Click <strong>Save day</strong> to commit them. Saved changes stay as <strong>draft</strong> until you click <strong>Publish</strong>.
        </div>
      )}

      {!hasUnsaved && unpublishedCount > 0 && (
        <div className="mb-3 px-3 py-2 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-lg">
          {unpublishedCount} assignment{unpublishedCount === 1 ? '' : 's'} in draft. Click <strong>Publish</strong> when you&apos;re ready for drivers to see them.
        </div>
      )}

      {message && (
        <div className={`mb-3 p-3 rounded-lg text-sm font-medium ${
          messageType === 'success'
            ? 'bg-green-50 border border-green-200 text-green-700'
            : 'bg-red-50 border border-red-200 text-red-700'
        }`}>{message}</div>
      )}

      {/* Grid */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-2 py-1.5 text-[10px] font-semibold text-slate-600 uppercase border-b border-slate-200 sticky left-0 bg-slate-50 z-10 min-w-[200px]">
                  Job
                </th>
                {weekDates.map((d, i) => {
                  const isToday = isoDate(d) === todayIso
                  return (
                    <th
                      key={i}
                      className={`text-center px-1.5 py-1.5 text-[10px] font-semibold uppercase border-b border-slate-200 min-w-[120px] ${
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
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center text-slate-400 py-8 text-xs italic">
                    Loading…
                  </td>
                </tr>
              ) : visibleSheets.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center text-slate-400 py-8 text-xs">
                    No day sheets in this week.{' '}
                    <Link href="/dashboard/day-sheet/new" className="text-blue-600 hover:underline">
                      + New Day Sheet
                    </Link>
                  </td>
                </tr>
              ) : (
                visibleSheets.map(s => (
                  <tr key={s.id} className="border-b border-slate-100 last:border-b-0">
                    <td className="px-2 py-1.5 align-top sticky left-0 bg-white z-10 border-r border-slate-100">
                      <div className="flex items-start gap-1.5">
                        <span className="text-sm flex-shrink-0 leading-none mt-0.5">
                          {s.sheet_type === 'recurring'
                            ? '🔁'
                            : (s.end_date && s.end_date !== s.start_date ? '🗓' : '📅')}
                        </span>
                        <div className="min-w-0">
                          {/* Job name itself is the link to the edit page.
                              Metadata (times, linked chip, separate Open
                              link) deliberately removed in step 5.8 to
                              keep the column compact. */}
                          <Link
                            href={`/dashboard/day-sheet/${s.id}`}
                            className="font-semibold text-slate-800 hover:text-blue-700 hover:underline text-xs leading-tight block"
                          >
                            {s.job_description || s.customer_name}
                          </Link>
                        </div>
                      </div>
                    </td>
                    {weekDates.map((d, i) => {
                      const dIso = isoDate(d)
                      const runs = sheetRunsOn(s, dIso)
                      const isToday = dIso === todayIso

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

                      const k = cellKey(s.id, dIso)
                      const value = pending[k] ?? null
                      const serverValue = serverAssignments[k] ?? null
                      const isDirty = value !== serverValue
                      // Publish state from server (only meaningful when
                      // not isDirty — a dirty cell hasn't been saved
                      // yet so it has no server publish state).
                      const pubState = serverPublishMap[k]
                      const isDraft   = !isDirty && value != null && pubState === 'draft'
                      const isChanged = !isDirty && value != null && pubState === 'changed'
                      const isPublished = !isDirty && value != null && pubState === 'published'

                      // Auto-filled when a value is set, this cell wasn't
                      // overridden, and there exists at least one
                      // overridden cell from which it could have been
                      // filled — same sheet on another date, OR a
                      // linked sibling on this/another date.
                      const isAutoFilled = (() => {
                        if (overridden[k]) return false
                        if (value == null) return false
                        // Same sheet, any other date overridden?
                        for (const other of weekDates) {
                          const otherIso = isoDate(other)
                          if (otherIso === dIso) continue
                          if (overridden[cellKey(s.id, otherIso)]) return true
                        }
                        // Linked sibling overridden anywhere?
                        if (s.linked_group_id) {
                          for (const sib of sheets) {
                            if (sib.id === s.id) continue
                            if (sib.linked_group_id !== s.linked_group_id) continue
                            for (const other of weekDates) {
                              const otherIso = isoDate(other)
                              if (overridden[cellKey(sib.id, otherIso)]) return true
                            }
                          }
                        }
                        return false
                      })()

                      const driverObj = value ? userById.get(value) : null

                      // Cell tint priority: dirty (yellow) > changed
                      // (orange-ish) > draft (slate hash) > published
                      // (clean). Today's tint is layered underneath.
                      const cellTint = isDirty
                        ? 'bg-amber-50/60'
                        : isChanged
                        ? 'bg-orange-50/60'
                        : ''

                      return (
                        <td
                          key={i}
                          className={`px-1 py-1 align-top text-xs border-r border-slate-100 last:border-r-0 ${
                            isToday ? 'bg-blue-50/30' : ''
                          } ${cellTint}`}
                        >
                          <select
                            value={value || ''}
                            onChange={e => setDriverFor(s.id, dIso, e.target.value || null)}
                            className={`w-full border rounded px-1.5 py-0.5 text-[11px] ${
                              isAutoFilled
                                ? 'border-violet-400 border-dashed bg-violet-50 text-violet-800 italic'
                                : isDirty
                                ? 'border-amber-400 bg-white'
                                : isChanged
                                ? 'border-orange-400 bg-white'
                                : isDraft
                                ? 'border-slate-400 bg-white'
                                : 'border-slate-300 bg-white'
                            }`}
                          >
                            <option value="">—</option>
                            {users.map(u => (
                              <option key={u.id} value={u.id}>
                                {u.full_name || '(no name)'}{u.is_frozen ? ' (frozen)' : ''}
                              </option>
                            ))}
                          </select>
                          {isAutoFilled && (
                            <p className="text-[9px] text-violet-700 mt-0.5">✱ auto</p>
                          )}
                          {!isAutoFilled && isDraft && (
                            <p className="text-[9px] text-slate-500 mt-0.5">draft</p>
                          )}
                          {!isAutoFilled && isChanged && (
                            <p className="text-[9px] text-orange-700 mt-0.5">edited</p>
                          )}
                          {!isAutoFilled && isPublished && (
                            <p className="text-[9px] text-emerald-700 mt-0.5">✓ live</p>
                          )}
                          {!isAutoFilled && driverObj?.is_frozen && (
                            <p className="text-[9px] text-amber-700 mt-0.5">⚠ frozen</p>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 text-xs text-slate-500 flex items-center gap-4 flex-wrap">
        <span>🔁 recurring · 🗓 multi-day · 📅 single day · 🔗 linked group</span>
        <span><span className="inline-block w-2.5 h-2.5 bg-amber-100 border border-amber-300 align-middle mr-1"></span> unsaved</span>
        <span><span className="inline-block w-2.5 h-2.5 bg-white border border-slate-400 align-middle mr-1"></span> draft (saved, not yet published)</span>
        <span><span className="inline-block w-2.5 h-2.5 bg-orange-50 border border-orange-400 align-middle mr-1"></span> edited since publish</span>
        <span><span className="inline-block w-2.5 h-2.5 bg-white border border-slate-300 align-middle mr-1"></span> ✓ live (visible to drivers)</span>
        <span><span className="inline-block w-2.5 h-2.5 bg-violet-50 border border-violet-400 align-middle mr-1" style={{ borderStyle: 'dashed' }}></span> auto-filled (override by changing)</span>
        <span><span className="inline-block w-2.5 h-2.5 bg-slate-100 border border-slate-200 align-middle mr-1"></span> doesn&apos;t run that day</span>
      </div>

      <div className="mt-4 text-xs text-slate-500">
        💡 Drivers don&apos;t see anything until you click <strong>Publish</strong>. Saved changes stay as draft until then. Vehicle and per-day notes come in step 6.
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
