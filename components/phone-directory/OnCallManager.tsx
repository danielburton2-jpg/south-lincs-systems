'use client'

/**
 * OnCallManager — admin section dropped into the on-call rota page.
 *
 * Add/edit form shape (step 21):
 *   1. Pick someone from the directory (names only)
 *   2. Pick "This week" or "Next week" — a Mon–Sun range
 *   3. Tick days (past days disabled)
 *   4. All day, OR a time range
 *   5. Notes (optional)
 *   6. Add slot(s) — creates one slot per ticked day, all with the
 *      same time
 *
 * Edit form: same shape. The slot's existing day is pre-ticked, time
 * pre-filled. Saving DELETES the original slot and creates new slots
 * from whatever is ticked. So:
 *   - Same single tick + new time → replaces with updated time
 *   - Same single tick + extra ticks → original stays + new slots
 *   - Different tick(s) → original deleted, new slots created
 *   - No ticks → original deleted, nothing created
 *
 * Multi-add semantics: stops on first failure. Earlier slots stay
 * created; admin gets an error pointing at the failing day and can
 * retry from there.
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
  weekChoice: 'this' | 'next'
  // Map of ISO date → ticked. Only dates in the current Mon-Sun
  // window are present. Past dates are still in the map but
  // rendered disabled.
  ticked: Record<string, boolean>
  isAllDay: boolean
  startTime: string
  endTime: string
  notes: string
}

const emptyFormState = (): FormState => ({
  entryId: '',
  weekChoice: 'this',
  ticked: {},
  isAllDay: true,
  startTime: '09:00',
  endTime: '17:00',
  notes: '',
})

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
  // Returns array of { iso, label, isPast } for the 7 days in the
  // selected week.
  const daysForWeek = (weekChoice: 'this' | 'next') => {
    const baseMonday = mondayOf(new Date())
    if (weekChoice === 'next') baseMonday.setDate(baseMonday.getDate() + 7)
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

  const weekRange = (weekChoice: 'this' | 'next'): string => {
    const days = daysForWeek(weekChoice)
    return formatWeekRange(
      new Date(days[0].iso + 'T00:00:00'),
      new Date(days[6].iso + 'T00:00:00'),
    )
  }

  // When admin switches from "This week" to "Next week" (or vice
  // versa), we clear the ticks — they're for a different set of dates.
  const setWeekChoice = (form: FormState, setForm: (f: FormState) => void) => (next: 'this' | 'next') => {
    setForm({ ...form, weekChoice: next, ticked: {} })
  }

  const toggleDay = (form: FormState, setForm: (f: FormState) => void) => (iso: string) => {
    setForm({ ...form, ticked: { ...form.ticked, [iso]: !form.ticked[iso] } })
  }

  // List of ISO dates that are ticked AND not in the past.
  const tickedFutureDates = (form: FormState): string[] => {
    const days = daysForWeek(form.weekChoice)
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
  // When admin clicks "Edit" on a slot, populate the edit form. The
  // slot's date is pre-ticked. We figure out which week (this/next)
  // the slot's date belongs to so the picker shows the right week.
  const startEdit = (s: Slot) => {
    const slotDate = s.start_date  // single-day slots, start = end
    const slotMonday = mondayOf(new Date(slotDate + 'T00:00:00'))
    const thisMonday = mondayOf(new Date())
    const nextMonday = new Date(thisMonday); nextMonday.setDate(nextMonday.getDate() + 7)

    let weekChoice: 'this' | 'next' = 'this'
    if (slotMonday.getTime() === nextMonday.getTime()) weekChoice = 'next'
    // If the slot is in any other week (past, or further future),
    // we can't show it in our two-week picker. We default to 'this'
    // and pre-tick nothing — admin will see the slot is unticked
    // and can choose what to do (delete by saving with no ticks, or
    // pick a day in the next two weeks to move it to).
    const inPickerRange =
      slotMonday.getTime() === thisMonday.getTime() ||
      slotMonday.getTime() === nextMonday.getTime()

    setEditingId(s.id)
    setEditForm({
      entryId: s.phone_directory_entry_id,
      weekChoice,
      ticked: inPickerRange ? { [slotDate]: true } : {},
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

      {/* Existing slots */}
      <div>
        <p className="text-sm font-medium text-slate-700 mb-2">Active and upcoming slots</p>
        {slots.length === 0 ? (
          <p className="text-sm text-slate-400 italic">No on-call slots set up yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
            {slots.map(s => (
              <li key={s.id} className="p-3">
                {editingId === s.id ? (
                  <FormBlock
                    form={editForm}
                    setForm={setEditForm}
                    entries={entries}
                    daysForWeek={daysForWeek}
                    weekRange={weekRange}
                    setWeekChoice={setWeekChoice(editForm, setEditForm)}
                    toggleDay={toggleDay(editForm, setEditForm)}
                    submitLabel={editing ? 'Saving…' : 'Save changes'}
                    onSubmit={saveEdit}
                    onCancel={cancelEdit}
                    disabled={editing}
                    showCancel
                  />
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-800">
                        {s.phone_directory_entries?.name || '(deleted entry)'}
                      </p>
                      <p className="text-xs text-slate-600 mt-1">
                        <span className="inline-block px-1.5 py-0.5 rounded bg-slate-100 mr-1">
                          {formatTimeRange(s)}
                        </span>
                        {formatDateRange(s)}
                      </p>
                      {s.notes && (
                        <p className="text-xs text-slate-500 mt-1">{s.notes}</p>
                      )}
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={() => startEdit(s)}
                        className="text-xs text-blue-600 hover:underline"
                      >Edit</button>
                      <button
                        onClick={() => handleDelete(s.id)}
                        className="text-xs text-red-600 hover:underline"
                      >Delete</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

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
              setWeekChoice={setWeekChoice(addForm, setAddForm)}
              toggleDay={toggleDay(addForm, setAddForm)}
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
  daysForWeek: (wc: 'this' | 'next') => { iso: string; label: string; isPast: boolean }[]
  weekRange: (wc: 'this' | 'next') => string
  setWeekChoice: (next: 'this' | 'next') => void
  toggleDay: (iso: string) => void
  submitLabel: string
  onSubmit: (e: React.FormEvent) => void
  onCancel?: () => void
  disabled: boolean
  showCancel?: boolean
}

function FormBlock({
  form, setForm, entries, daysForWeek, weekRange,
  setWeekChoice, toggleDay,
  submitLabel, onSubmit, onCancel, disabled, showCancel,
}: FormBlockProps) {
  const days = daysForWeek(form.weekChoice)
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

      {/* Week toggle */}
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Week</label>
        <div className="flex gap-2">
          {(['this', 'next'] as const).map(wc => (
            <button
              key={wc}
              type="button"
              onClick={() => setWeekChoice(wc)}
              className={`flex-1 text-sm px-3 py-2 rounded-lg border ${
                form.weekChoice === wc
                  ? 'bg-blue-50 border-blue-400 text-blue-800 font-medium'
                  : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {wc === 'this' ? 'This week' : 'Next week'}
              <span className="block text-xs text-slate-500 font-normal mt-0.5">
                {weekRange(wc)}
              </span>
            </button>
          ))}
        </div>
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
