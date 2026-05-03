'use client'

import { useEffect, useMemo, useState } from 'react'

/**
 * Publish picker modal — used by both day-sheet/assign and
 * schedules/assign. Lets the planner pick:
 *   - Whole week OR a single day (mutually exclusive)
 *   - All users OR a single user (mutually exclusive)
 *
 * Defaults to "Whole week" + "All users" — equivalent to the previous
 * unconditional Publish button.
 *
 * The picker drives a `filter = { date, userId }` object:
 *   - date: null when whole week is selected, otherwise the picked
 *     ISO date. The caller intersects this with their visible week.
 *   - userId: null when all users selected, otherwise the picked id.
 */
type Option = { id: string; label: string }

export type PublishFilter = {
  date: string | null
  userId: string | null
}

type Props = {
  open: boolean
  onClose: () => void
  onPublish: (filter: PublishFilter) => Promise<void> | void
  weekRangeLabel: string                   // e.g. "5 May – 11 May"
  availableDates: Option[]                  // dates with unpublished changes
  availableUsers: Option[]                  // users with unpublished changes
  countFor: (filter: PublishFilter) => number
  busy?: boolean
}

export default function PublishPickerModal({
  open,
  onClose,
  onPublish,
  weekRangeLabel,
  availableDates,
  availableUsers,
  countFor,
  busy = false,
}: Props) {
  // Local state. Reset on every open so the modal always starts at
  // "Whole week + all users".
  const [wholeWeek, setWholeWeek] = useState(true)
  const [pickedDate, setPickedDate] = useState<string>('')
  const [allUsers, setAllUsers] = useState(true)
  const [pickedUser, setPickedUser] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setWholeWeek(true)
      setPickedDate('')
      setAllUsers(true)
      setPickedUser('')
      setSubmitting(false)
    }
  }, [open])

  // Mutual-exclusion handlers
  const onWholeWeekChange = (checked: boolean) => {
    setWholeWeek(checked)
    if (checked) setPickedDate('')
  }
  const onPickedDateChange = (value: string) => {
    setPickedDate(value)
    if (value) setWholeWeek(false)
    // If the planner clears the dropdown, fall back to whole week
    if (!value && !wholeWeek) setWholeWeek(true)
  }
  const onAllUsersChange = (checked: boolean) => {
    setAllUsers(checked)
    if (checked) setPickedUser('')
  }
  const onPickedUserChange = (value: string) => {
    setPickedUser(value)
    if (value) setAllUsers(false)
    if (!value && !allUsers) setAllUsers(true)
  }

  // Effective filter from the current state
  const filter: PublishFilter = useMemo(() => ({
    date: wholeWeek ? null : (pickedDate || null),
    userId: allUsers ? null : (pickedUser || null),
  }), [wholeWeek, pickedDate, allUsers, pickedUser])

  const willPublishCount = useMemo(() => countFor(filter), [filter, countFor])

  const description = useMemo(() => {
    const datePart = filter.date
      ? availableDates.find(d => d.id === filter.date)?.label || filter.date
      : `whole week (${weekRangeLabel})`
    const userPart = filter.userId
      ? availableUsers.find(u => u.id === filter.userId)?.label || 'one user'
      : 'all users'
    return `${datePart} · ${userPart}`
  }, [filter, availableDates, availableUsers, weekRangeLabel])

  const handlePublish = async () => {
    if (submitting || busy) return
    if (willPublishCount === 0) return
    setSubmitting(true)
    try {
      await onPublish(filter)
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40"
      onClick={() => !submitting && onClose()}
    >
      <div
        className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md mx-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-5">
          <h3 className="text-lg font-semibold text-slate-900 mb-1">
            Publish changes
          </h3>
          <p className="text-sm text-slate-500 mb-4">
            Pick what to publish. Only days and users with unpublished changes appear in the dropdowns.
          </p>

          {/* Days picker */}
          <div className="border-b border-slate-200 pb-4 mb-4">
            <p className="text-xs font-semibold text-slate-700 uppercase mb-2">Days</p>
            <label className="flex items-center gap-2 mb-2 cursor-pointer">
              <input
                type="checkbox"
                checked={wholeWeek}
                onChange={e => onWholeWeekChange(e.target.checked)}
                disabled={submitting || busy}
              />
              <span className="text-sm text-slate-800">
                Whole week ({weekRangeLabel})
              </span>
            </label>
            <select
              value={pickedDate}
              onChange={e => onPickedDateChange(e.target.value)}
              disabled={submitting || busy || availableDates.length === 0}
              className="w-full text-sm border border-slate-300 rounded-lg px-2 py-1.5 bg-white disabled:bg-slate-50 disabled:text-slate-400"
            >
              <option value="">
                {availableDates.length === 0
                  ? '— no specific days with changes —'
                  : '— or pick one day —'}
              </option>
              {availableDates.map(d => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </select>
          </div>

          {/* Users picker */}
          <div className="border-b border-slate-200 pb-4 mb-4">
            <p className="text-xs font-semibold text-slate-700 uppercase mb-2">Users</p>
            <label className="flex items-center gap-2 mb-2 cursor-pointer">
              <input
                type="checkbox"
                checked={allUsers}
                onChange={e => onAllUsersChange(e.target.checked)}
                disabled={submitting || busy}
              />
              <span className="text-sm text-slate-800">All users</span>
            </label>
            <select
              value={pickedUser}
              onChange={e => onPickedUserChange(e.target.value)}
              disabled={submitting || busy || availableUsers.length === 0}
              className="w-full text-sm border border-slate-300 rounded-lg px-2 py-1.5 bg-white disabled:bg-slate-50 disabled:text-slate-400"
            >
              <option value="">
                {availableUsers.length === 0
                  ? '— no specific users with changes —'
                  : '— or pick one user —'}
              </option>
              {availableUsers.map(u => (
                <option key={u.id} value={u.id}>{u.label}</option>
              ))}
            </select>
          </div>

          {/* Live preview */}
          <div className={`px-3 py-2 rounded-lg text-xs mb-4 ${
            willPublishCount === 0
              ? 'bg-slate-50 text-slate-500'
              : 'bg-blue-50 text-blue-800 border border-blue-200'
          }`}>
            {willPublishCount === 0
              ? `Nothing to publish for: ${description}`
              : `Will publish ${willPublishCount} change${willPublishCount === 1 ? '' : 's'} — ${description}`}
          </div>

          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => !submitting && onClose()}
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handlePublish}
              disabled={submitting || busy || willPublishCount === 0}
              className={`px-5 py-2 text-sm font-medium rounded-lg transition ${
                submitting || busy || willPublishCount === 0
                  ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {submitting ? 'Publishing…' : 'Publish'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
