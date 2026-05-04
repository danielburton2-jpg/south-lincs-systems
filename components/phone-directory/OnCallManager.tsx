'use client'

/**
 * OnCallManager — admin section for the on-call rota.
 *
 * Two surfaces stacked vertically:
 *
 * 1. Week-grid view (top) — shows existing slots laid out as
 *    a Mon–Sun grid with time-range rows and clickable name pills.
 *    Arrow navigator at the top right; admin can move freely
 *    backward and forward (it's a read-only viewer for past weeks
 *    and a scheduler for future weeks). Click a name to edit
 *    that slot (form drops in below the grid).
 *
 * 2. Add form (bottom) — directory pick, week navigator (back arrow
 *    stops at this week — admin can't backdate), day picker,
 *    all-day or time range, notes. Creates one slot per ticked day.
 *
 * Edit form: same FormBlock as the add form. Saving DELETES the
 * original slot and creates new slots from whatever is ticked.
 *   - Same single tick + new time → replaces with updated time
 *   - Same single tick + extra ticks → original stays + new slots
 *   - Different tick(s) → original deleted, new slots created
 *   - No ticks → original deleted, nothing created
 *
 * Multi-add semantics: stops on first failure. Earlier slots stay
 * created; admin gets an error pointing at the failing day.
 *
 * Phone numbers NEVER displayed on this surface — only names.
 */

import { useEffect, useMemo, useState } from 'react'

type Entry = {
  id: string
  name: string
  phone_number: string  // present in the data but never rendered
  notes: string | null
}

type Slot = {
  id: string
  phone_directory_entry_id: string
  start_date: string
  end_date: string
  is_all_day: boolean
  start_time: string | null
  end_time: string | null
  notes: string | null
  created_at: string
  phone_directory_entries: Entry | null
}

type Props = {
  entries: Entry[]
  entriesVersion: number
}

// ── Date helpers ────────────────────────────────────────────────────
const isoDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Returns the Monday of the week containing `d`. JS getDay() returns
// 0 for Sunday, which is annoying — Sunday should map to "the Monday
// 6 days ago" (the start of the week JUST ENDING), not "the Monday
// in 1 day's time".
const mondayOf = (d: Date): Date => {
  const wd = d.getDay()
  const offset = wd === 0 ? 6 : wd - 1
  const m = new Date(d)
  m.setDate(m.getDate() - offset)
  m.setHours(0, 0, 0, 0)
  return m
}

// "Mon 5 May"
const formatDayLabel = (d: Date): string => {
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

// "5 May – 11 May"
const formatWeekRange = (start: Date, end: Date): string => {
  const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return `${fmt(start)} – ${fmt(end)}`
}

const formatDateRange = (s: Slot) => {
  const fmt = (iso: string) => {
    const d = new Date(iso + 'T00:00:00')
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  }
  return s.start_date === s.end_date ? fmt(s.start_date) : `${fmt(s.start_date)} – ${fmt(s.end_date)}`
}

const trimSeconds = (t: string | null) => (t ? t.slice(0, 5) : '')

const formatTimeRange = (s: Slot): string => {
  if (s.is_all_day) return 'All day'
  const start = trimSeconds(s.start_time)
  const end = trimSeconds(s.end_time)
  if (!start || !end) return ''
  const overnight = start > end
  return `${start}–${end}${overnight ? ' (overnight)' : ''}`
}

// ── Form-shape used by both add and edit ───────────────────────────
type FormState = {
  entryId: string
  // ISO date of the Monday of the visible week. The week is
  // always Mon–Sun. Forward navigation unlimited; back navigation
  // stops at this-week's Monday in the form (admin can't schedule
  // backwards). The grid-side viewer has no such limit.
  weekMonday: string
  // Map of ISO date → ticked. Past dates are still in the map but
  // rendered disabled.
  ticked: Record<string, boolean>
  isAllDay: boolean
  startTime: string
  endTime: string
  notes: string
}

// Returns the Monday of "this week" as ISO. Used as the form's
// initial week and as the back-arrow lower bound.
const thisWeekMondayIso = (): string => {
  const m = mondayOf(new Date())
  return isoDate(m)
}

const emptyFormState = (): FormState => ({
  entryId: '',
  weekMonday: thisWeekMondayIso(),
  ticked: {},
  isAllDay: true,
  startTime: '09:00',
  endTime: '17:00',
  notes: '',
})

// ── WeekNavigator ──────────────────────────────────────────────────
// Arrow controls used in both the form and the grid:
//
//     <  Week of 4 May – 10 May  >
//
// `minMondayIso` (optional) disables the back-arrow when the current
// Monday is at or before that floor. The form passes this-week's
// Monday so admin can't navigate to a past week. The grid passes
// nothing — it's a viewer, unlimited both directions.
type WeekNavigatorProps = {
  mondayIso: string
  rangeLabel: string
  minMondayIso?: string
  onStep: (delta: number) => void
  /** Jump straight back to this-week's Monday. The button only
   *  shows when the navigator is on a non-current week. */
  onJumpToToday: () => void
  size?: 'normal' | 'small'
}

function WeekNavigator({ mondayIso, rangeLabel, minMondayIso, onStep, onJumpToToday, size = 'normal' }: WeekNavigatorProps) {
  const backDisabled = !!minMondayIso && mondayIso <= minMondayIso
  const showTodayButton = mondayIso !== thisWeekMondayIso()
  const btnBase = size === 'small'
    ? 'w-7 h-7 text-sm'
    : 'w-9 h-9 text-base'
  const todayBtnClasses = size === 'small'
    ? 'h-7 px-2 text-xs'
    : 'h-9 px-3 text-sm'
  const labelClasses = size === 'small'
    ? 'text-xs text-slate-700'
    : 'text-sm text-slate-800 font-medium'
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onStep(-1)}
        disabled={backDisabled}
        aria-label="Previous week"
        className={`${btnBase} flex items-center justify-center rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed`}
      >
        ‹
      </button>
      <span className={`${labelClasses} min-w-[10rem] text-center`}>
        Week of {rangeLabel}
      </span>
      <button
        type="button"
        onClick={() => onStep(1)}
        aria-label="Next week"
        className={`${btnBase} flex items-center justify-center rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}
      >
        ›
      </button>
      {showTodayButton && (
        <button
          type="button"
          onClick={onJumpToToday}
          className={`${todayBtnClasses} rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 font-medium`}
        >
          Today
        </button>
      )}
    </div>
  )
}

export default function OnCallManager({ entries, entriesVersion }: Props) {
  const [slots, setSlots] = useState<Slot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // ADD form state
  const [addForm, setAddForm] = useState<FormState>(emptyFormState)
  const [adding, setAdding] = useState(false)

  // EDIT form state — only populated when editingId is set
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<FormState>(emptyFormState)
  const [editing, setEditing] = useState(false)

  const todayMidnight = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])

  const load = async () => {
    try {
      const res = await fetch('/api/phone-directory/on-call')
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error || 'Failed to load on-call rota')
        return
      }
      setSlots(data.slots || [])
      setError('')
    } catch (e: any) {
      setError(e?.message || 'Failed to load on-call rota')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    if (entriesVersion > 0) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entriesVersion])

  // ── Helpers for the day picker ────────────────────────────────────
  // Returns array of { iso, label, isPast } for the 7 days starting
  // at the given Monday (ISO date string).
  const daysForWeek = (mondayIso: string) => {
    const baseMonday = new Date(mondayIso + 'T00:00:00')
    return Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(baseMonday)
      d.setDate(d.getDate() + i)
      return {
        iso: isoDate(d),
        label: formatDayLabel(d),
        isPast: d < todayMidnight,
      }
    })
  }

  const weekRange = (mondayIso: string): string => {
    const days = daysForWeek(mondayIso)
    return formatWeekRange(
      new Date(days[0].iso + 'T00:00:00'),
      new Date(days[6].iso + 'T00:00:00'),
    )
  }

  // Step a form's visible week by `delta` weeks. Clears ticks (they
  // were for a different set of dates).
  const stepFormWeek = (form: FormState, setForm: (f: FormState) => void) => (delta: number) => {
    const cur = new Date(form.weekMonday + 'T00:00:00')
    cur.setDate(cur.getDate() + delta * 7)
    setForm({ ...form, weekMonday: isoDate(cur), ticked: {} })
  }

  // Reset a form's visible week to this-week's Monday. Clears ticks
  // (they were for a different set of dates).
  const jumpFormWeekToToday = (form: FormState, setForm: (f: FormState) => void) => () => {
    setForm({ ...form, weekMonday: thisWeekMondayIso(), ticked: {} })
  }

  const toggleDay = (form: FormState, setForm: (f: FormState) => void) => (iso: string) => {
    setForm({ ...form, ticked: { ...form.ticked, [iso]: !form.ticked[iso] } })
  }

  // List of ISO dates that are ticked AND not in the past.
  const tickedFutureDates = (form: FormState): string[] => {
    const days = daysForWeek(form.weekMonday)
    return days
      .filter(d => !d.isPast && form.ticked[d.iso])
      .map(d => d.iso)
  }

  // Validate the time-range portion. Returns error message or null.
  const validateTimes = (form: FormState): string | null => {
    if (form.isAllDay) return null
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(form.startTime)) return 'Start time must be HH:MM'
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(form.endTime)) return 'End time must be HH:MM'
    if (form.startTime === form.endTime) return 'Start and end times cannot be the same'
    return null
  }

  // Sequentially POST one slot per ticked date. Stop on first
  // failure. Returns { created, failedDate, error } where created is
  // an array of new Slot objects.
  const createSlotsForDates = async (
    form: FormState,
    dates: string[],
  ): Promise<{ created: Slot[]; failedDate?: string; error?: string }> => {
    const created: Slot[] = []
    for (const date of dates) {
      const res = await fetch('/api/phone-directory/on-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone_directory_entry_id: form.entryId,
          start_date: date,
          end_date: date,
          is_all_day: form.isAllDay,
          start_time: form.isAllDay ? null : form.startTime,
          end_time: form.isAllDay ? null : form.endTime,
          notes: form.notes.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        return { created, failedDate: date, error: data?.error || 'Save failed' }
      }
      created.push(data.slot)
    }
    return { created }
  }

  // ── ADD ──────────────────────────────────────────────────────────
  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!addForm.entryId) { alert('Pick someone from the directory'); return }
    const dates = tickedFutureDates(addForm)
    if (dates.length === 0) {
      alert('Tick at least one day in the chosen week')
      return
    }
    const timeError = validateTimes(addForm)
    if (timeError) { alert(timeError); return }

    setAdding(true)
    try {
      const result = await createSlotsForDates(addForm, dates)
      if (result.created.length > 0) {
        setSlots(prev => [...prev, ...result.created]
          .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.created_at.localeCompare(b.created_at)))
      }
      if (result.failedDate) {
        alert(
          `Created ${result.created.length} slot(s). Then failed on ${result.failedDate}: ${result.error}. ` +
          `You can retry from that day.`
        )
        return
      }
      // All good — reset notes and ticks but keep entry/week/times
      // (admin often adds several similar batches in a row)
      setAddForm({ ...addForm, ticked: {}, notes: '' })
    } finally {
      setAdding(false)
    }
  }

  // ── EDIT ─────────────────────────────────────────────────────────
  // When admin clicks "Edit" on a slot, populate the edit form.
  // The form's visible week jumps to the slot's week. The slot's
  // date is pre-ticked unless it's in a past week (in which case
  // the past-day rule disables that day too — admin would need to
  // tick a future day to "move" the slot).
  const startEdit = (s: Slot) => {
    const slotDate = s.start_date  // single-day slots, start = end
    const slotMonday = mondayOf(new Date(slotDate + 'T00:00:00'))
    const slotMondayIso = isoDate(slotMonday)
    const thisMondayIso = thisWeekMondayIso()

    // If the slot is in a past week, the form's back-arrow lower
    // bound (this week's Monday) means admin can't navigate back to
    // it. We open the form on this-week's Monday in that case, with
    // nothing ticked — admin can navigate forward to find a new
    // home for the slot, or save with no ticks to delete it.
    const slotInThisWeekOrLater = slotMondayIso >= thisMondayIso
    const formMonday = slotInThisWeekOrLater ? slotMondayIso : thisMondayIso
    const slotDay = new Date(slotDate + 'T00:00:00')
    const slotDayIsPast = slotDay < todayMidnight

    setEditingId(s.id)
    setEditForm({
      entryId: s.phone_directory_entry_id,
      weekMonday: formMonday,
      ticked: (slotInThisWeekOrLater && !slotDayIsPast) ? { [slotDate]: true } : {},
      isAllDay: s.is_all_day,
      startTime: trimSeconds(s.start_time) || '09:00',
      endTime: trimSeconds(s.end_time) || '17:00',
      notes: s.notes || '',
    })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditForm(emptyFormState())
  }

  const saveEdit = async () => {
    if (!editingId) return
    if (!editForm.entryId) { alert('Pick someone'); return }
    const dates = tickedFutureDates(editForm)
    const timeError = validateTimes(editForm)
    if (timeError) { alert(timeError); return }

    setEditing(true)
    try {
      // Strategy: delete the original, then create slots for each
      // ticked date. If the create step partially fails we report it.
      // Order matters: delete first so admin doesn't end up with
      // duplicates if create succeeds.
      const delRes = await fetch(`/api/phone-directory/on-call/${editingId}`, { method: 'DELETE' })
      if (!delRes.ok) {
        const data = await delRes.json().catch(() => ({}))
        alert(data?.error || 'Could not delete the original slot — edit aborted')
        return
      }
      // Optimistically remove from local state
      setSlots(prev => prev.filter(s => s.id !== editingId))

      if (dates.length === 0) {
        // Admin unticked everything — they wanted to remove the slot.
        cancelEdit()
        return
      }

      const result = await createSlotsForDates(editForm, dates)
      if (result.created.length > 0) {
        setSlots(prev => [...prev, ...result.created]
          .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.created_at.localeCompare(b.created_at)))
      }
      if (result.failedDate) {
        alert(
          `Original slot deleted. Created ${result.created.length} new slot(s). ` +
          `Then failed on ${result.failedDate}: ${result.error}. You can re-add the missing day(s) manually.`
        )
      }
      cancelEdit()
    } finally {
      setEditing(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this on-call slot?')) return
    const res = await fetch(`/api/phone-directory/on-call/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      alert(data?.error || 'Delete failed')
      return
    }
    setSlots(prev => prev.filter(s => s.id !== id))
  }

  if (loading) {
    return <p className="text-sm text-slate-400 italic">Loading on-call rota…</p>
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
          {error}
        </div>
      )}

      {/* Existing slots — week-grid view */}
      <SlotsGrid
        slots={slots}
        editingId={editingId}
        editForm={editForm}
        setEditForm={setEditForm}
        entries={entries}
        daysForWeek={daysForWeek}
        weekRange={weekRange}
        stepEditWeek={stepFormWeek(editForm, setEditForm)}
        jumpEditWeekToToday={jumpFormWeekToToday(editForm, setEditForm)}
        toggleDay={toggleDay(editForm, setEditForm)}
        formMinMondayIso={thisWeekMondayIso()}
        editing={editing}
        onStartEdit={startEdit}
        onSaveEdit={saveEdit}
        onCancelEdit={cancelEdit}
        onDelete={handleDelete}
      />

      {/* Add form */}
      <div>
        <p className="text-sm font-medium text-slate-700 mb-2">Add new on-call slot(s)</p>
        {entries.length === 0 ? (
          <p className="text-sm text-slate-500 italic bg-slate-50 border border-slate-200 rounded-lg p-3">
            Add at least one number to the directory before assigning on-call.
          </p>
        ) : (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
            <FormBlock
              form={addForm}
              setForm={setAddForm}
              entries={entries}
              daysForWeek={daysForWeek}
              weekRange={weekRange}
              stepWeek={stepFormWeek(addForm, setAddForm)}
              jumpToToday={jumpFormWeekToToday(addForm, setAddForm)}
              toggleDay={toggleDay(addForm, setAddForm)}
              minMondayIso={thisWeekMondayIso()}
              submitLabel={adding ? 'Adding…' : 'Add'}
              onSubmit={handleAdd}
              disabled={adding}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Form block — used by both add and edit ─────────────────────────
type FormBlockProps = {
  form: FormState
  setForm: (f: FormState) => void
  entries: Entry[]
  daysForWeek: (mondayIso: string) => { iso: string; label: string; isPast: boolean }[]
  weekRange: (mondayIso: string) => string
  stepWeek: (delta: number) => void
  jumpToToday: () => void
  toggleDay: (iso: string) => void
  /** Optional floor for the back arrow. Pass this-week's Monday to
   *  prevent admin from navigating to past weeks. Omit for unlimited. */
  minMondayIso?: string
  submitLabel: string
  onSubmit: (e: React.FormEvent) => void
  onCancel?: () => void
  disabled: boolean
  showCancel?: boolean
}

function FormBlock({
  form, setForm, entries, daysForWeek, weekRange,
  stepWeek, jumpToToday, toggleDay, minMondayIso,
  submitLabel, onSubmit, onCancel, disabled, showCancel,
}: FormBlockProps) {
  const days = daysForWeek(form.weekMonday)
  const overnight = !form.isAllDay && form.startTime > form.endTime

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Who&apos;s on call?</label>
        <select
          value={form.entryId}
          onChange={e => setForm({ ...form, entryId: e.target.value })}
          className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
        >
          <option value="">— Pick from directory —</option>
          {entries.map(en => (
            <option key={en.id} value={en.id}>{en.name}</option>
          ))}
        </select>
      </div>

      {/* Week navigator */}
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Week</label>
        <WeekNavigator
          mondayIso={form.weekMonday}
          rangeLabel={weekRange(form.weekMonday)}
          minMondayIso={minMondayIso}
          onStep={stepWeek}
          onJumpToToday={jumpToToday}
        />
      </div>

      {/* Day picker */}
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Days</label>
        <div className="grid grid-cols-7 gap-1">
          {days.map(d => {
            const checked = !!form.ticked[d.iso]
            return (
              <label
                key={d.iso}
                className={`flex flex-col items-center justify-center px-1 py-2 rounded-lg border text-xs select-none ${
                  d.isPast
                    ? 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed'
                    : checked
                      ? 'bg-blue-100 border-blue-500 text-blue-900 font-medium cursor-pointer'
                      : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50 cursor-pointer'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={d.isPast}
                  onChange={() => !d.isPast && toggleDay(d.iso)}
                  className="sr-only"
                />
                <span>{d.label.split(' ')[0]}</span>
                <span className="text-[10px] mt-0.5">{d.label.split(' ').slice(1).join(' ')}</span>
              </label>
            )
          })}
        </div>
        <p className="text-xs text-slate-500 mt-1">Past days are disabled.</p>
      </div>

      {/* All-day / time range */}
      <div>
        <label className="flex items-center gap-2 text-sm text-slate-700 mb-2">
          <input
            type="checkbox"
            checked={form.isAllDay}
            onChange={e => setForm({ ...form, isAllDay: e.target.checked })}
          />
          All day
        </label>
        {!form.isAllDay && (
          <>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="block text-xs font-medium text-slate-600 mb-1">From</label>
                <input
                  type="time"
                  value={form.startTime}
                  onChange={e => setForm({ ...form, startTime: e.target.value })}
                  className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium text-slate-600 mb-1">To</label>
                <input
                  type="time"
                  value={form.endTime}
                  onChange={e => setForm({ ...form, endTime: e.target.value })}
                  className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
                />
              </div>
            </div>
            {overnight && (
              <p className="text-xs text-amber-700 mt-2">
                Crosses midnight — each ticked day will run from {form.startTime} through {form.endTime} the next morning.
              </p>
            )}
          </>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Notes (optional)</label>
        <textarea
          value={form.notes}
          onChange={e => setForm({ ...form, notes: e.target.value })}
          placeholder="e.g. handover phone, escalate after 3 rings"
          rows={2}
          className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={disabled || !form.entryId}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
        >
          {submitLabel}
        </button>
        {showCancel && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={disabled}
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium px-4 py-2 rounded-lg"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}

// ── SlotsGrid: weekly grid view of slots ──────────────────────────
//
// Displays the upcoming on-call rota as a Mon–Sun grid:
//   - Columns: 7 days
//   - Rows: one per unique time-range that has slots in the visible week
//   - Cells: clickable name pills (multiple stacked if overlap)
//
// Has its own week navigator (independent of the add form's).
// When admin clicks Edit on a name, the edit form drops in below
// the grid (full width).

type SlotsGridProps = {
  slots: Slot[]
  editingId: string | null
  editForm: FormState
  setEditForm: (f: FormState) => void
  entries: Entry[]
  daysForWeek: (mondayIso: string) => { iso: string; label: string; isPast: boolean }[]
  weekRange: (mondayIso: string) => string
  /** Step the EDIT form's visible week. Different from the grid's
   *  own navigation — when admin is editing, the form below the
   *  grid uses these. */
  stepEditWeek: (delta: number) => void
  /** Jump the EDIT form back to this-week's Monday. */
  jumpEditWeekToToday: () => void
  toggleDay: (iso: string) => void
  /** Floor for the EDIT form's back arrow. */
  formMinMondayIso: string
  editing: boolean
  onStartEdit: (s: Slot) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onDelete: (id: string) => void
}

// Returns the set of ISO dates a slot "covers" — i.e. where its
// name should appear in the grid. Handles cross-midnight by
// including the morning-after dates too.
function datesCoveredBy(s: Slot): string[] {
  const out: string[] = []
  const start = new Date(s.start_date + 'T00:00:00')
  const end = new Date(s.end_date + 'T00:00:00')

  // Walk start_date through end_date inclusive
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }

  // Cross-midnight: if start_time > end_time, the morning portion
  // also covers the day AFTER each in-range day. Push end_date+1
  // (and any other +1 days inside the range; those are already
  // covered above, so only the trailing +1 needs adding).
  if (!s.is_all_day && s.start_time && s.end_time) {
    const startMin = Number(s.start_time.slice(0, 2)) * 60 + Number(s.start_time.slice(3, 5))
    const endMin = Number(s.end_time.slice(0, 2)) * 60 + Number(s.end_time.slice(3, 5))
    if (startMin > endMin) {
      const extra = new Date(end)
      extra.setDate(extra.getDate() + 1)
      out.push(`${extra.getFullYear()}-${String(extra.getMonth() + 1).padStart(2, '0')}-${String(extra.getDate()).padStart(2, '0')}`)
    }
  }
  return out
}

// Group slots by their time-range signature. Returns Map<label, Slot[]>
// where label is "All day" / "06:00–09:00" / "22:00–06:00 (overnight)".
function groupSlotsByTimeRange(slots: Slot[]): Map<string, Slot[]> {
  const out = new Map<string, Slot[]>()
  for (const s of slots) {
    const key = formatTimeRange(s) || '(unset)'
    const arr = out.get(key) || []
    arr.push(s)
    out.set(key, arr)
  }
  return out
}

function SlotsGrid({
  slots, editingId, editForm, setEditForm, entries,
  daysForWeek, weekRange,
  stepEditWeek, jumpEditWeekToToday, toggleDay, formMinMondayIso,
  editing, onStartEdit, onSaveEdit, onCancelEdit, onDelete,
}: SlotsGridProps) {
  // Independent week navigation for the grid view. Initialised to
  // this-week's Monday; admin can navigate freely both directions
  // (it's a viewer, no past-week restriction).
  const [gridMonday, setGridMonday] = useState<string>(thisWeekMondayIso())

  const stepGridWeek = (delta: number) => {
    const cur = new Date(gridMonday + 'T00:00:00')
    cur.setDate(cur.getDate() + delta * 7)
    setGridMonday(isoDate(cur))
  }

  const jumpGridWeekToToday = () => setGridMonday(thisWeekMondayIso())

  // 7 dates of the visible week
  const days = daysForWeek(gridMonday)
  const dayIsoSet = new Set(days.map(d => d.iso))

  // Which slots appear in the visible week? A slot appears if any of
  // its covered dates intersects the visible week.
  const visibleSlots = slots.filter(s => {
    return datesCoveredBy(s).some(iso => dayIsoSet.has(iso))
  })

  // Group + sort rows. Rows ordered by the start_time of the FIRST
  // slot in each group (so 06:00 comes before 15:00; "All day" goes
  // last).
  const grouped = groupSlotsByTimeRange(visibleSlots)
  const rows = Array.from(grouped.entries())
    .map(([label, ss]) => {
      const sample = ss[0]
      const startKey = sample.is_all_day ? '99:99' : (sample.start_time || '99:99')
      return { label, slots: ss, sortKey: startKey }
    })
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))

  // Quick lookup: which slots cover this specific (iso, label)?
  // Used to populate each cell.
  const slotsAt = (iso: string, label: string): Slot[] => {
    const group = grouped.get(label) || []
    return group.filter(s => datesCoveredBy(s).includes(iso))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
  }

  const editingSlot = editingId ? slots.find(s => s.id === editingId) : null

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium text-slate-700">Active and upcoming slots</p>
        <WeekNavigator
          mondayIso={gridMonday}
          rangeLabel={weekRange(gridMonday)}
          onStep={stepGridWeek}
          onJumpToToday={jumpGridWeekToToday}
          size="small"
        />
      </div>

      {visibleSlots.length === 0 ? (
        <p className="text-sm text-slate-400 italic border border-slate-100 rounded-lg p-4">
          No on-call slots scheduled for this week.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border-b border-slate-200 p-2 text-left text-xs font-medium text-slate-600 bg-slate-50 w-32">
                  Time
                </th>
                {days.map(d => {
                  const [weekday, datePart1, datePart2] = d.label.split(' ')
                  return (
                    <th
                      key={d.iso}
                      className={`border-b border-slate-200 p-2 text-center text-xs font-medium ${
                        d.isPast ? 'text-slate-400 bg-slate-50' : 'text-slate-700 bg-slate-50'
                      }`}
                    >
                      <div>{weekday}</div>
                      <div className="text-[10px] font-normal mt-0.5">{datePart1} {datePart2}</div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.label}>
                  <td className="border-b border-slate-100 p-2 text-xs text-slate-700 bg-slate-50 align-top">
                    {row.label}
                  </td>
                  {days.map(d => {
                    const cellSlots = slotsAt(d.iso, row.label)
                    return (
                      <td
                        key={d.iso}
                        className={`border-b border-l border-slate-100 p-1 align-top ${
                          d.isPast ? 'bg-slate-50' : ''
                        }`}
                      >
                        {cellSlots.length === 0 ? (
                          <div className="h-6" />
                        ) : (
                          <div className="space-y-1">
                            {cellSlots.map(s => (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => onStartEdit(s)}
                                className={`block w-full text-left text-xs px-2 py-1 rounded hover:bg-blue-100 truncate ${
                                  editingId === s.id
                                    ? 'bg-blue-200 text-blue-900 font-semibold'
                                    : 'bg-blue-50 text-blue-800'
                                }`}
                                title={s.phone_directory_entries?.name || '(deleted entry)'}
                              >
                                {s.phone_directory_entries?.name || '(deleted)'}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit form drops in below the grid when an admin is editing.
          Same FormBlock used by the add form. */}
      {editingSlot && (
        <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-amber-900">
              Editing slot: {editingSlot.phone_directory_entries?.name || '(deleted entry)'}
              <span className="text-xs text-amber-700 ml-1">
                · {formatDateRange(editingSlot)} · {formatTimeRange(editingSlot)}
              </span>
            </p>
            <button
              type="button"
              onClick={() => onDelete(editingSlot.id)}
              className="text-xs text-red-600 hover:underline"
            >Delete this slot</button>
          </div>
          <FormBlock
            form={editForm}
            setForm={setEditForm}
            entries={entries}
            daysForWeek={daysForWeek}
            weekRange={weekRange}
            stepWeek={stepEditWeek}
            jumpToToday={jumpEditWeekToToday}
            toggleDay={toggleDay}
            minMondayIso={formMinMondayIso}
            submitLabel={editing ? 'Saving…' : 'Save changes'}
            onSubmit={(e) => { e.preventDefault(); onSaveEdit() }}
            onCancel={onCancelEdit}
            disabled={editing}
            showCancel
          />
        </div>
      )}
    </div>
  )
}
