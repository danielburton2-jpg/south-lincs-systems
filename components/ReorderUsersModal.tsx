'use client'

/**
 * ReorderUsersModal — admin-only modal for setting the display order
 * of users in their company. Used on /dashboard/users.
 *
 * UX:
 *   • Shows all non-frozen, non-deleted users in current display_order
 *   • Each row has up/down arrow buttons
 *   • Up disabled on top row, down disabled on bottom row
 *   • Order is committed only when admin clicks "Save Order"
 *   • Cancel discards changes
 *
 * On save, we POST the entire ordered array to /api/users-reorder which
 * rewrites display_order values in multiples of 10 (10, 20, 30, …) so
 * future inserts can slot in without renumbering everything.
 */

import { useEffect, useState } from 'react'

type User = {
  id: string
  full_name: string | null
  email: string | null
  role: string
  job_title?: string | null
  display_order?: number | null
}

type Props = {
  users: User[]
  onClose: () => void
  onSaved: () => void
}

export default function ReorderUsersModal({ users, onClose, onSaved }: Props) {
  const [list, setList] = useState<User[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Initialise from props, sorted by current display_order then full_name
  useEffect(() => {
    const sorted = [...users].sort((a, b) => {
      const ao = a.display_order ?? 999_999
      const bo = b.display_order ?? 999_999
      if (ao !== bo) return ao - bo
      return (a.full_name || a.email || '').localeCompare(b.full_name || b.email || '')
    })
    setList(sorted)
  }, [users])

  const moveUp = (idx: number) => {
    if (idx <= 0) return
    setList(prev => {
      const next = [...prev]
      const [item] = next.splice(idx, 1)
      next.splice(idx - 1, 0, item)
      return next
    })
  }

  const moveDown = (idx: number) => {
    setList(prev => {
      if (idx >= prev.length - 1) return prev
      const next = [...prev]
      const [item] = next.splice(idx, 1)
      next.splice(idx + 1, 0, item)
      return next
    })
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)

    // Re-number in multiples of 10
    const orders = list.map((u, idx) => ({
      id: u.id,
      display_order: (idx + 1) * 10,
    }))

    try {
      const res = await fetch('/api/users-reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Save failed')
        setSaving(false)
        return
      }
      onSaved()
    } catch (e: any) {
      setError(e?.message || 'Network error')
      setSaving(false)
    }
  }

  const roleBadge = (role: string) => {
    const map: Record<string, string> = {
      admin:   'bg-indigo-100 text-indigo-700',
      manager: 'bg-blue-100 text-blue-700',
      user:    'bg-slate-100 text-slate-600',
    }
    return (
      <span className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${map[role] || 'bg-slate-100 text-slate-600'}`}>
        {role}
      </span>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">

        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Reorder Users</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Use the arrows to set the order users appear on the schedules calendar and assign pages.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none ml-3 disabled:opacity-50"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {list.length === 0 ? (
            <p className="text-center text-slate-400 py-8 text-sm">No users to reorder.</p>
          ) : (
            <ul>
              {list.map((u, idx) => {
                const atTop = idx === 0
                const atBottom = idx === list.length - 1
                return (
                  <li
                    key={u.id}
                    className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-slate-50 border-b border-slate-100 last:border-b-0"
                  >
                    <span className="text-xs text-slate-400 font-mono w-7 text-right">
                      {idx + 1}.
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-slate-800 text-sm truncate">
                          {u.full_name || u.email || '(no name)'}
                        </p>
                        {roleBadge(u.role)}
                      </div>
                      {u.job_title && (
                        <p className="text-xs text-slate-500 truncate">{u.job_title}</p>
                      )}
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button
                        onClick={() => moveUp(idx)}
                        disabled={atTop || saving}
                        className="w-8 h-8 rounded-md bg-slate-100 hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed text-slate-700 text-sm font-medium flex items-center justify-center transition"
                        title="Move up"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => moveDown(idx)}
                        disabled={atBottom || saving}
                        className="w-8 h-8 rounded-md bg-slate-100 hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed text-slate-700 text-sm font-medium flex items-center justify-center transition"
                        title="Move down"
                      >
                        ↓
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mx-5 mb-2 p-2 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs">
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 flex gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium py-2.5 rounded-xl transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || list.length === 0}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-xl transition disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Order'}
          </button>
        </div>
      </div>
    </div>
  )
}
