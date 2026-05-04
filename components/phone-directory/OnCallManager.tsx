'use client'

/**
 * OnCallManager — admin section dropped into /dashboard/phone-directory.
 *
 *   - Top: AM/PM split-time editor (one input, one Save button)
 *   - Middle: list of upcoming + active on-call slots, with edit/delete
 *   - Bottom: add-slot form
 *
 * The "list" only shows slots whose end_date is today-or-later. Old
 * slots stay in the database for audit but are hidden from the UI.
 *
 * Overlapping slots are allowed by design — the API doesn't prevent
 * them. If admin saves an overlapping slot the driver will see both
 * with the older one labelled Primary.
 */

import { useEffect, useState } from 'react'

type Entry = {
  id: string
  name: string
  phone_number: string
  notes: string | null
}

type Slot = {
  id: string
  phone_directory_entry_id: string
  start_date: string
  end_date: string
  time_window: 'all_day' | 'am' | 'pm'
  notes: string | null
  created_at: string
  phone_directory_entries: Entry | null
}

type Props = {
  /** Directory entries the admin can pick from. Passed in to avoid
   *  re-fetching them — the parent page already loaded them. */
  entries: Entry[]
  /** Reload signal: when entries change above, the admin form's
   *  picker should reflect that. */
  entriesVersion: number
}

const WINDOW_OPTIONS: { value: Slot['time_window']; label: string }[] = [
  { value: 'all_day', label: 'All day' },
  { value: 'am', label: 'AM only' },
  { value: 'pm', label: 'PM only' },
]

const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const formatDateRange = (s: Slot) => {
  const fmt = (iso: string) => {
    const d = new Date(iso + 'T00:00:00')
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  }
  return s.start_date === s.end_date ? fmt(s.start_date) : `${fmt(s.start_date)} – ${fmt(s.end_date)}`
}

const labelWindow = (w: Slot['time_window']) =>
  w === 'all_day' ? 'All day' : w === 'am' ? 'AM' : 'PM'

export default function OnCallManager({ entries, entriesVersion }: Props) {
  const [slots, setSlots] = useState<Slot[]>([])
  const [splitTime, setSplitTime] = useState<string>('12:00')
  const [splitTimeDraft, setSplitTimeDraft] = useState<string>('12:00')
  const [savingSplit, setSavingSplit] = useState(false)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Add form
  const [newEntryId, setNewEntryId] = useState('')
  const [newStartDate, setNewStartDate] = useState(todayIso())
  const [newEndDate, setNewEndDate] = useState(todayIso())
  const [newWindow, setNewWindow] = useState<Slot['time_window']>('all_day')
  const [newNotes, setNewNotes] = useState('')
  const [adding, setAdding] = useState(false)

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editEntryId, setEditEntryId] = useState('')
  const [editStartDate, setEditStartDate] = useState('')
  const [editEndDate, setEditEndDate] = useState('')
  const [editWindow, setEditWindow] = useState<Slot['time_window']>('all_day')
  const [editNotes, setEditNotes] = useState('')
  const [editing, setEditing] = useState(false)

  const load = async () => {
    try {
      const res = await fetch('/api/phone-directory/on-call')
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error || 'Failed to load on-call rota')
        return
      }
      setSlots(data.slots || [])
      setSplitTime(data.am_pm_split_time || '12:00')
      setSplitTimeDraft((data.am_pm_split_time || '12:00').slice(0, 5))
      setError('')
    } catch (e: any) {
      setError(e?.message || 'Failed to load on-call rota')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // If the admin deletes/edits/adds a directory entry, the slots may
  // have orphan refs (CASCADE handles deletes) — refresh to be safe.
  useEffect(() => {
    if (entriesVersion > 0) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entriesVersion])

  // ── Split time ───────────────────────────────────────────────────
  const handleSaveSplit = async () => {
    setSavingSplit(true)
    try {
      const res = await fetch('/api/phone-directory/set-split-time', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ am_pm_split_time: splitTimeDraft }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data?.error || 'Save failed')
        return
      }
      setSplitTime(splitTimeDraft)
    } finally {
      setSavingSplit(false)
    }
  }

  // ── Add slot ─────────────────────────────────────────────────────
  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newEntryId) { alert('Pick someone or something from the directory'); return }
    if (newStartDate > newEndDate) { alert('End date must be on or after start date'); return }
    setAdding(true)
    try {
      const res = await fetch('/api/phone-directory/on-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone_directory_entry_id: newEntryId,
          start_date: newStartDate,
          end_date: newEndDate,
          time_window: newWindow,
          notes: newNotes.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data?.error || 'Add failed')
        return
      }
      setSlots(prev => [...prev, data.slot]
        .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.created_at.localeCompare(b.created_at)))
      setNewNotes('')
      // Keep the dates and window — admin often adds several similar slots in a row
    } finally {
      setAdding(false)
    }
  }

  // ── Edit slot ────────────────────────────────────────────────────
  const startEdit = (s: Slot) => {
    setEditingId(s.id)
    setEditEntryId(s.phone_directory_entry_id)
    setEditStartDate(s.start_date)
    setEditEndDate(s.end_date)
    setEditWindow(s.time_window)
    setEditNotes(s.notes || '')
  }
  const cancelEdit = () => {
    setEditingId(null)
    setEditEntryId(''); setEditStartDate(''); setEditEndDate('')
    setEditWindow('all_day'); setEditNotes('')
  }
  const saveEdit = async () => {
    if (!editingId) return
    if (!editEntryId) { alert('Pick someone'); return }
    if (editStartDate > editEndDate) { alert('End date must be on or after start date'); return }
    setEditing(true)
    try {
      const res = await fetch(`/api/phone-directory/on-call/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone_directory_entry_id: editEntryId,
          start_date: editStartDate,
          end_date: editEndDate,
          time_window: editWindow,
          notes: editNotes.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data?.error || 'Save failed')
        return
      }
      setSlots(prev => prev.map(s => s.id === editingId ? data.slot : s))
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

      {/* AM/PM split */}
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
        <p className="text-xs font-medium text-slate-700 mb-2">AM/PM split time</p>
        <p className="text-xs text-slate-500 mb-2">
          Time of day where AM ends and PM begins. Default 12:00.
          A driver opening the directory before this time sees an "AM" slot;
          after, they see the "PM" slot. "All day" slots show regardless.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="time"
            value={splitTimeDraft}
            onChange={e => setSplitTimeDraft(e.target.value)}
            className="text-sm border border-slate-300 rounded-lg px-3 py-1.5"
          />
          <button
            onClick={handleSaveSplit}
            disabled={savingSplit || splitTimeDraft === splitTime.slice(0, 5)}
            className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
          >
            {savingSplit ? 'Saving…' : 'Save'}
          </button>
          <span className="text-xs text-slate-500">
            (currently {splitTime.slice(0, 5)})
          </span>
        </div>
      </div>

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
                  <div className="space-y-2">
                    <select
                      value={editEntryId}
                      onChange={e => setEditEntryId(e.target.value)}
                      className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
                    >
                      <option value="">— Pick from directory —</option>
                      {entries.map(en => (
                        <option key={en.id} value={en.id}>
                          {en.name}
                        </option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <input
                        type="date"
                        value={editStartDate}
                        onChange={e => setEditStartDate(e.target.value)}
                        className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-2"
                      />
                      <input
                        type="date"
                        value={editEndDate}
                        onChange={e => setEditEndDate(e.target.value)}
                        className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-2"
                      />
                    </div>
                    <select
                      value={editWindow}
                      onChange={e => setEditWindow(e.target.value as Slot['time_window'])}
                      className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
                    >
                      {WINDOW_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <textarea
                      value={editNotes}
                      onChange={e => setEditNotes(e.target.value)}
                      placeholder="Notes (optional)"
                      rows={2}
                      className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={saveEdit}
                        disabled={editing}
                        className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                      >Save</button>
                      <button
                        onClick={cancelEdit}
                        disabled={editing}
                        className="px-3 py-1.5 text-sm rounded bg-slate-100 hover:bg-slate-200 text-slate-700"
                      >Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-800">
                        {s.phone_directory_entries?.name || '(deleted entry)'}
                      </p>
                      <p className="text-xs text-slate-600 mt-1">
                        <span className="inline-block px-1.5 py-0.5 rounded bg-slate-100 mr-1">
                          {labelWindow(s.time_window)}
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
        <p className="text-sm font-medium text-slate-700 mb-2">Add a new on-call slot</p>
        <form onSubmit={handleAdd} className="space-y-2 bg-slate-50 border border-slate-200 rounded-lg p-3">
          {entries.length === 0 ? (
            <p className="text-sm text-slate-500 italic">
              Add at least one number to the directory above before assigning on-call.
            </p>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Who's on call?</label>
                <select
                  value={newEntryId}
                  onChange={e => setNewEntryId(e.target.value)}
                  className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
                >
                  <option value="">— Pick from directory —</option>
                  {entries.map(en => (
                    <option key={en.id} value={en.id}>
                      {en.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Start date</label>
                  <input
                    type="date"
                    value={newStartDate}
                    onChange={e => setNewStartDate(e.target.value)}
                    className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-slate-600 mb-1">End date</label>
                  <input
                    type="date"
                    value={newEndDate}
                    onChange={e => setNewEndDate(e.target.value)}
                    className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Window</label>
                <select
                  value={newWindow}
                  onChange={e => setNewWindow(e.target.value as Slot['time_window'])}
                  className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
                >
                  {WINDOW_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Notes (optional)</label>
                <textarea
                  value={newNotes}
                  onChange={e => setNewNotes(e.target.value)}
                  placeholder="e.g. handover phone, escalate after 3 rings"
                  rows={2}
                  className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
                />
              </div>
              <button
                type="submit"
                disabled={adding || !newEntryId}
                className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
              >
                {adding ? 'Adding…' : 'Add slot'}
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  )
}
