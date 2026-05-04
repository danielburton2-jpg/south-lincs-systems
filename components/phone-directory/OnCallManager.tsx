'use client'

/**
 * OnCallManager — admin section dropped into the on-call rota page.
 *
 *   - List of upcoming + active slots, with edit/delete inline
 *   - Add-slot form
 *
 * Each slot has either is_all_day=true OR a start_time + end_time
 * pair. Times can cross midnight (e.g. 22:00–06:00 means evening
 * through next morning).
 *
 * Phone numbers are NEVER displayed on this surface — only names.
 *
 * Overlapping slots are allowed by design — the API doesn't prevent
 * them. If admin saves an overlapping slot the driver sees both with
 * the older one labelled Primary.
 */

import { useEffect, useState } from 'react'

type Entry = {
  id: string
  name: string
  phone_number: string  // present in the data but never rendered here
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
  /** Directory entries the admin can pick from. Passed in to avoid
   *  re-fetching them — the parent page already loaded them. */
  entries: Entry[]
  /** Reload signal: when entries change above, the admin form's
   *  picker should reflect that. */
  entriesVersion: number
}

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

// "06:30:00" -> "06:30". Handles already-trimmed input gracefully.
const trimSeconds = (t: string | null) => (t ? t.slice(0, 5) : '')

// "06:00" + "09:00" -> "06:00–09:00"
// "22:00" + "06:00" -> "22:00–06:00 (overnight)"
const formatTimeRange = (s: Slot): string => {
  if (s.is_all_day) return 'All day'
  const start = trimSeconds(s.start_time)
  const end = trimSeconds(s.end_time)
  if (!start || !end) return ''
  const overnight = start > end
  return `${start}–${end}${overnight ? ' (overnight)' : ''}`
}

export default function OnCallManager({ entries, entriesVersion }: Props) {
  const [slots, setSlots] = useState<Slot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Add form
  const [newEntryId, setNewEntryId] = useState('')
  const [newStartDate, setNewStartDate] = useState(todayIso())
  const [newEndDate, setNewEndDate] = useState(todayIso())
  const [newAllDay, setNewAllDay] = useState(true)
  const [newStartTime, setNewStartTime] = useState('09:00')
  const [newEndTime, setNewEndTime] = useState('17:00')
  const [newNotes, setNewNotes] = useState('')
  const [adding, setAdding] = useState(false)

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editEntryId, setEditEntryId] = useState('')
  const [editStartDate, setEditStartDate] = useState('')
  const [editEndDate, setEditEndDate] = useState('')
  const [editAllDay, setEditAllDay] = useState(true)
  const [editStartTime, setEditStartTime] = useState('09:00')
  const [editEndTime, setEditEndTime] = useState('17:00')
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
      setError('')
    } catch (e: any) {
      setError(e?.message || 'Failed to load on-call rota')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // If parent's entries change, refresh slots so any cascade-deleted
  // ones disappear.
  useEffect(() => {
    if (entriesVersion > 0) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entriesVersion])

  // ── Add slot ─────────────────────────────────────────────────────
  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newEntryId) { alert('Pick someone or something from the directory'); return }
    if (newStartDate > newEndDate) { alert('End date must be on or after start date'); return }
    if (!newAllDay && newStartTime === newEndTime) {
      alert('Start and end times cannot be the same'); return
    }
    setAdding(true)
    try {
      const res = await fetch('/api/phone-directory/on-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone_directory_entry_id: newEntryId,
          start_date: newStartDate,
          end_date: newEndDate,
          is_all_day: newAllDay,
          start_time: newAllDay ? null : newStartTime,
          end_time: newAllDay ? null : newEndTime,
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
      // Keep the dates and times — admin often adds several similar slots
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
    setEditAllDay(s.is_all_day)
    setEditStartTime(trimSeconds(s.start_time) || '09:00')
    setEditEndTime(trimSeconds(s.end_time) || '17:00')
    setEditNotes(s.notes || '')
  }
  const cancelEdit = () => {
    setEditingId(null)
    setEditEntryId(''); setEditStartDate(''); setEditEndDate('')
    setEditAllDay(true); setEditStartTime('09:00'); setEditEndTime('17:00')
    setEditNotes('')
  }
  const saveEdit = async () => {
    if (!editingId) return
    if (!editEntryId) { alert('Pick someone'); return }
    if (editStartDate > editEndDate) { alert('End date must be on or after start date'); return }
    if (!editAllDay && editStartTime === editEndTime) {
      alert('Start and end times cannot be the same'); return
    }
    setEditing(true)
    try {
      const res = await fetch(`/api/phone-directory/on-call/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone_directory_entry_id: editEntryId,
          start_date: editStartDate,
          end_date: editEndDate,
          is_all_day: editAllDay,
          start_time: editAllDay ? null : editStartTime,
          end_time: editAllDay ? null : editEndTime,
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
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={editAllDay}
                        onChange={e => setEditAllDay(e.target.checked)}
                      />
                      All day
                    </label>
                    {!editAllDay && (
                      <div className="flex gap-2 items-center">
                        <input
                          type="time"
                          value={editStartTime}
                          onChange={e => setEditStartTime(e.target.value)}
                          className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-2"
                        />
                        <span className="text-slate-500">to</span>
                        <input
                          type="time"
                          value={editEndTime}
                          onChange={e => setEditEndTime(e.target.value)}
                          className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-2"
                        />
                      </div>
                    )}
                    {!editAllDay && editStartTime > editEndTime && (
                      <p className="text-xs text-amber-700">
                        Crosses midnight — this slot will run from {editStartTime} through {editEndTime} the next morning.
                      </p>
                    )}
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
        <p className="text-sm font-medium text-slate-700 mb-2">Add a new on-call slot</p>
        <form onSubmit={handleAdd} className="space-y-3 bg-slate-50 border border-slate-200 rounded-lg p-3">
          {entries.length === 0 ? (
            <p className="text-sm text-slate-500 italic">
              Add at least one number to the directory before assigning on-call.
            </p>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Who&apos;s on call?</label>
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
                <label className="flex items-center gap-2 text-sm text-slate-700 mb-2">
                  <input
                    type="checkbox"
                    checked={newAllDay}
                    onChange={e => setNewAllDay(e.target.checked)}
                  />
                  All day
                </label>
                {!newAllDay && (
                  <>
                    <div className="flex gap-2 items-center">
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-slate-600 mb-1">From</label>
                        <input
                          type="time"
                          value={newStartTime}
                          onChange={e => setNewStartTime(e.target.value)}
                          className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-slate-600 mb-1">To</label>
                        <input
                          type="time"
                          value={newEndTime}
                          onChange={e => setNewEndTime(e.target.value)}
                          className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
                        />
                      </div>
                    </div>
                    {newStartTime > newEndTime && (
                      <p className="text-xs text-amber-700 mt-2">
                        Crosses midnight — slot will run from {newStartTime} through {newEndTime} the next morning,
                        each day in the date range.
                      </p>
                    )}
                  </>
                )}
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
