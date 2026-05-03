'use client'
/**
 * ComposeModal
 *
 * Modal for creating a new thread. Three target modes:
 *   • Person — pick one or more people from the company by name
 *   • Job Title — pick a job title; thread is shared across everyone with it
 *   • Everyone — message every active user in the company
 *
 * On success, calls onCreated with the new thread id so the caller
 * can navigate the user into it.
 */
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase'

const supabase = createClient()

type Profile = {
  id: string
  full_name: string
  job_title: string | null
  role: string
}

type Props = {
  /** The current user's id, so we don't list them in the recipient picker. */
  currentUserId: string
  /** Caller closes the modal. */
  onClose: () => void
  /** Caller navigates the user into the new thread. */
  onCreated: (threadId: string) => void
  /** Visual accent for the primary button. */
  accent?: 'slate' | 'indigo'
}

export default function ComposeModal({ currentUserId, onClose, onCreated, accent = 'slate' }: Props) {
  const [tab, setTab] = useState<'person' | 'job_title' | 'everyone'>('person')
  const [users, setUsers] = useState<Profile[]>([])
  const [loadingUsers, setLoadingUsers] = useState(true)
  const [search, setSearch] = useState('')
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set())
  const [pickedJobTitle, setPickedJobTitle] = useState('')
  const [optionalTitle, setOptionalTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Load company users on mount. RLS scopes to current company.
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, job_title, role')
        .neq('id', currentUserId)  // don't show self
        .order('full_name', { ascending: true })
      setUsers((data || []) as Profile[])
      setLoadingUsers(false)
    }
    load()
  }, [currentUserId])

  const accentBg = accent === 'indigo' ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-slate-800 hover:bg-slate-900'
  const accentTab = accent === 'indigo' ? 'border-indigo-600 text-indigo-700' : 'border-slate-800 text-slate-900'

  const distinctJobTitles = useMemo(() => {
    const s = new Set<string>()
    for (const u of users) {
      if (u.job_title && u.job_title.trim()) s.add(u.job_title.trim())
    }
    return Array.from(s).sort()
  }, [users])

  const filteredUsers = useMemo(() => {
    if (!search.trim()) return users
    const q = search.toLowerCase()
    return users.filter(u =>
      u.full_name.toLowerCase().includes(q) ||
      (u.job_title || '').toLowerCase().includes(q)
    )
  }, [users, search])

  const peopleWithTitle = useMemo(() => {
    if (!pickedJobTitle) return []
    return users.filter(u =>
      (u.job_title || '').toLowerCase().trim() === pickedJobTitle.toLowerCase().trim()
    )
  }, [users, pickedJobTitle])

  const togglePick = (id: string) => {
    setPickedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSubmit = async () => {
    setError('')
    setSubmitting(true)

    let payload: any
    if (tab === 'person') {
      if (pickedIds.size === 0) { setError('Pick at least one person'); setSubmitting(false); return }
      payload = {
        kind: 'user_list',
        user_ids: Array.from(pickedIds),
        title: optionalTitle.trim() || null,
      }
    } else if (tab === 'job_title') {
      if (!pickedJobTitle) { setError('Pick a job title'); setSubmitting(false); return }
      payload = {
        kind: 'job_title',
        job_title: pickedJobTitle,
        title: optionalTitle.trim() || null,
      }
    } else {
      payload = {
        kind: 'all_company',
        title: optionalTitle.trim() || null,
      }
    }

    try {
      const res = await fetch('/api/messages/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Could not create thread')
        return
      }
      onCreated(data.thread.id)
    } catch (err: any) {
      setError(err?.message || 'Failed')
    } finally {
      setSubmitting(false)
    }
  }

  const totalCompanySize = users.length + 1  // includes self

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-2 sm:p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl max-w-md w-full max-h-[92vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-semibold text-slate-800">New message</h2>
          <button onClick={onClose} className="text-slate-500 text-2xl leading-none">×</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-100">
          {([
            ['person', '👤 Person'],
            ['job_title', '👥 Job Title'],
            ['everyone', '🏢 Everyone'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`flex-1 py-2.5 text-xs font-medium border-b-2 transition ${
                tab === key
                  ? accentTab
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tab body */}
        <div className="flex-1 overflow-y-auto p-3">
          {tab === 'person' && (
            <>
              <input
                type="text"
                placeholder="Search people…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
              {pickedIds.size > 0 && (
                <div className="mb-3 flex flex-wrap gap-1">
                  {Array.from(pickedIds).map(id => {
                    const u = users.find(x => x.id === id)
                    if (!u) return null
                    return (
                      <span key={id} className="bg-slate-100 text-slate-700 text-xs px-2 py-1 rounded-full flex items-center gap-1">
                        {u.full_name}
                        <button type="button" onClick={() => togglePick(id)} className="text-slate-400 hover:text-slate-700">×</button>
                      </span>
                    )
                  })}
                </div>
              )}
              {loadingUsers ? (
                <p className="text-sm text-slate-400 italic">Loading…</p>
              ) : filteredUsers.length === 0 ? (
                <p className="text-sm text-slate-400 italic">No matches</p>
              ) : (
                <ul className="space-y-1">
                  {filteredUsers.map(u => {
                    const picked = pickedIds.has(u.id)
                    return (
                      <li key={u.id}>
                        <button
                          type="button"
                          onClick={() => togglePick(u.id)}
                          className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-3 transition ${
                            picked ? 'bg-slate-100' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-xs font-semibold flex-shrink-0">
                            {u.full_name.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-slate-800 truncate">{u.full_name}</p>
                            {u.job_title && <p className="text-[10px] text-slate-500 truncate">{u.job_title}</p>}
                          </div>
                          {picked && <span className="text-slate-700">✓</span>}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          )}

          {tab === 'job_title' && (
            <>
              {distinctJobTitles.length === 0 ? (
                <p className="text-sm text-slate-400 italic">No job titles set in your company yet.</p>
              ) : (
                <>
                  <p className="text-xs text-slate-500 mb-2">Pick a job title — the thread will include everyone with that title (live, so future hires join automatically).</p>
                  <ul className="space-y-1">
                    {distinctJobTitles.map(jt => {
                      const count = users.filter(u =>
                        (u.job_title || '').toLowerCase().trim() === jt.toLowerCase()
                      ).length
                      return (
                        <li key={jt}>
                          <button
                            type="button"
                            onClick={() => setPickedJobTitle(jt)}
                            className={`w-full text-left px-3 py-2 rounded-lg flex items-center justify-between transition ${
                              pickedJobTitle === jt ? 'bg-slate-100' : 'hover:bg-slate-50'
                            }`}
                          >
                            <span className="text-sm text-slate-800">{jt}</span>
                            <span className="text-xs text-slate-500">{count} {count === 1 ? 'person' : 'people'}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                  {pickedJobTitle && (
                    <p className="text-xs text-slate-500 mt-3">
                      Thread will include {peopleWithTitle.length} {peopleWithTitle.length === 1 ? 'person' : 'people'} with the title <strong>{pickedJobTitle}</strong>.
                    </p>
                  )}
                </>
              )}
            </>
          )}

          {tab === 'everyone' && (
            <div className="text-center py-6">
              <p className="text-5xl mb-3">🏢</p>
              <p className="text-sm text-slate-700 font-medium">Message everyone in your company</p>
              <p className="text-xs text-slate-500 mt-1">
                {totalCompanySize} {totalCompanySize === 1 ? 'person' : 'people'} will receive this. Future hires automatically join.
              </p>
            </div>
          )}

          <div className="mt-4 pt-3 border-t border-slate-100">
            <input
              type="text"
              placeholder="Optional thread title (e.g. 'MOT planning')"
              value={optionalTitle}
              onChange={e => setOptionalTitle(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
          </div>

          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-slate-100 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-slate-600 px-4 py-2 rounded-lg hover:bg-slate-50"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className={`${accentBg} text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50`}
          >
            {submitting ? 'Creating…' : 'Start chat'}
          </button>
        </div>
      </div>
    </div>
  )
}
