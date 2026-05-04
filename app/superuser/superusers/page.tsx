'use client'

/**
 * /superuser/superusers
 *
 * Manage the list of superusers (people with role='superuser').
 * Wrapped automatically by /superuser/layout.tsx — that gates
 * non-superusers and provides the SuperuserSidebar + IdleTimeoutGuard,
 * so this page only handles its own UI.
 *
 * Actions (all via the existing /api/create-user and /api/update-user
 * endpoints, same way the per-company users page does):
 *   • Create a new superuser
 *   • Edit name and email (login email actually changes via the API)
 *   • Freeze / unfreeze (toggle_freeze)
 *   • Soft-delete (delete: true)
 *
 * Note: superusers don't belong to a company, so we pass company_id=null
 * to /api/create-user. The API already supports this for the
 * 'superuser' role.
 *
 * Audit logging happens server-side in the API routes (driven by the
 * actor_id / actor_email / actor_role fields in the body) — same
 * pattern as the per-company users page.
 */

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'

const supabase = createClient()

type Profile = {
  id: string
  full_name: string | null
  email: string | null
  role: string
  is_frozen: boolean
  is_deleted: boolean
}

export default function SuperusersPage() {
  const [superusers, setSuperusers] = useState<Profile[]>([])
  const [currentUser, setCurrentUser] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [showRemoved, setShowRemoved] = useState(false)

  const [showAddForm, setShowAddForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [editingUser, setEditingUser] = useState<Profile | null>(null)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')

  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  const showMessage = (msg: string, type: 'success' | 'error') => {
    setMessage(msg)
    setMessageType(type)
    setTimeout(() => setMessage(''), 4000)
  }

  const fetchSuperusers = useCallback(async () => {
    let query = supabase
      .from('profiles')
      .select('id, full_name, email, role, is_frozen, is_deleted')
      .eq('role', 'superuser')

    if (!showRemoved) {
      query = query.eq('is_deleted', false)
    }

    const { data, error } = await query.order('full_name', { ascending: true })
    if (error) {
      showMessage('Could not load superusers: ' + error.message, 'error')
      return
    }
    setSuperusers((data as Profile[]) || [])
  }, [showRemoved])

  const fetchCurrentUser = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, is_frozen, is_deleted')
      .eq('id', user.id)
      .single()
    if (profile) setCurrentUser(profile as Profile)
  }, [])

  useEffect(() => {
    const init = async () => {
      await Promise.all([fetchCurrentUser(), fetchSuperusers()])
      setLoading(false)
    }
    init()
  }, [fetchCurrentUser, fetchSuperusers])

  // ── Add ──────────────────────────────────────────────────────────
  const handleAddSuperuser = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const res = await fetch('/api/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: newEmail,
          password: newPassword,
          full_name: newName,
          role: 'superuser',
          company_id: null,
          actor_id: currentUser?.id,
          actor_email: currentUser?.email,
          actor_role: currentUser?.role,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        showMessage('Error creating superuser: ' + (data.error || 'unknown'), 'error')
        return
      }
      showMessage('Superuser created successfully', 'success')
      setNewName('')
      setNewEmail('')
      setNewPassword('')
      setShowAddForm(false)
      await fetchSuperusers()
    } finally {
      setSubmitting(false)
    }
  }

  // ── Edit ─────────────────────────────────────────────────────────
  const startEdit = (user: Profile) => {
    setEditingUser(user)
    setEditName(user.full_name || '')
    setEditEmail(user.email || '')
  }

  const cancelEdit = () => {
    setEditingUser(null)
    setEditName('')
    setEditEmail('')
  }

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingUser) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/update-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: editingUser.id,
          full_name: editName,
          email: editEmail,
          role: 'superuser',
          actor_id: currentUser?.id,
          actor_email: currentUser?.email,
          actor_role: currentUser?.role,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        showMessage('Error updating user: ' + (data.error || 'unknown'), 'error')
        return
      }
      showMessage('User updated', 'success')
      cancelEdit()
      await fetchSuperusers()
    } finally {
      setSubmitting(false)
    }
  }

  // ── Freeze ───────────────────────────────────────────────────────
  const handleFreeze = async (user: Profile) => {
    if (user.id === currentUser?.id) return
    const res = await fetch('/api/update-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: user.id,
        toggle_freeze: !user.is_frozen,
        actor_id: currentUser?.id,
        actor_email: currentUser?.email,
        actor_role: currentUser?.role,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      showMessage('Error: ' + (data.error || 'unknown'), 'error')
      return
    }
    showMessage(user.is_frozen ? 'User unfrozen' : 'User frozen', 'success')
    await fetchSuperusers()
  }

  // ── Soft-delete ──────────────────────────────────────────────────
  const handleSoftDelete = async (user: Profile) => {
    if (user.id === currentUser?.id) return
    if (!confirm(`Remove ${user.full_name || user.email} from the superusers list?\n\nThe user can be recovered later.`)) return
    const res = await fetch('/api/update-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: user.id,
        delete: true,
        actor_id: currentUser?.id,
        actor_email: currentUser?.email,
        actor_role: currentUser?.role,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      showMessage('Error removing user: ' + (data.error || 'unknown'), 'error')
      return
    }
    showMessage('User removed', 'success')
    await fetchSuperusers()
  }

  // ── Restore (un-delete) ──────────────────────────────────────────
  const handleRestore = async (user: Profile) => {
    if (!confirm(`Restore ${user.full_name || user.email}?\n\nThey'll appear in the active superusers list.`)) return
    const res = await fetch('/api/update-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: user.id,
        restore: true,
        actor_id: currentUser?.id,
        actor_email: currentUser?.email,
        actor_role: currentUser?.role,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      showMessage('Error restoring user: ' + (data.error || 'unknown'), 'error')
      return
    }
    showMessage('User restored', 'success')
    await fetchSuperusers()
  }

  // ── Render ───────────────────────────────────────────────────────
  if (loading) {
    return <div className="p-8 text-slate-400 italic">Loading…</div>
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex justify-between items-baseline mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Superusers</h1>
          <p className="text-sm text-slate-500 mt-1">
            Platform-level admins. Not tied to a single company.
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
        >
          {showAddForm ? 'Cancel' : '+ Add superuser'}
        </button>
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm font-medium ${
          messageType === 'success'
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {message}
        </div>
      )}

      {showAddForm && (
        <section className="mb-4 bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
          <h2 className="text-lg font-semibold text-slate-800 mb-3">New superuser</h2>
          <form onSubmit={handleAddSuperuser} className="space-y-3" autoComplete="off">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Full name</label>
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoComplete="off"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
              <input
                type="email"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoComplete="off"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoComplete="new-password"
                minLength={8}
                required
              />
              <p className="text-xs text-slate-500 mt-1">
                Minimum 8 characters. Share this with the new superuser
                out-of-band; they can change it after first sign-in.
              </p>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
            >
              {submitting ? 'Creating…' : 'Create superuser'}
            </button>
          </form>
        </section>
      )}

      {editingUser && (
        <section className="mb-4 bg-amber-50 rounded-2xl border border-amber-200 p-5">
          <h2 className="text-lg font-semibold text-amber-900 mb-3">
            Edit {editingUser.full_name || editingUser.email}
          </h2>
          <form onSubmit={handleSaveEdit} className="space-y-3" autoComplete="off">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Full name</label>
              <input
                type="text"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoComplete="off"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
              <input
                type="email"
                value={editEmail}
                onChange={e => setEditEmail(e.target.value)}
                className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoComplete="off"
                required
              />
              <p className="text-xs text-slate-500 mt-1">
                Changing this updates the user&apos;s login email too.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={submitting}
                className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
              >
                {submitting ? 'Saving…' : 'Save changes'}
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium px-4 py-2 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
        <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
          <h2 className="text-lg font-semibold text-slate-800">
            {showRemoved ? 'All superusers' : 'Active superusers'} ({superusers.length})
          </h2>
          <label className="text-xs text-slate-600 inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showRemoved}
              onChange={e => setShowRemoved(e.target.checked)}
              className="rounded border-slate-300"
            />
            Show removed users
          </label>
        </div>
        {superusers.length === 0 ? (
          <p className="text-sm text-slate-400 italic">
            {showRemoved ? 'No superusers found.' : 'No superusers found.'}
          </p>
        ) : (
          <ul className="space-y-2">
            {superusers.map(user => (
              <li
                key={user.id}
                className={`flex items-center justify-between gap-3 border rounded-lg px-4 py-3 ${
                  user.is_deleted
                    ? 'border-slate-300 bg-slate-50 opacity-75'
                    : user.is_frozen
                      ? 'border-amber-300 bg-amber-50'
                      : 'border-slate-200'
                }`}
              >
                <div className="min-w-0">
                  <p className={`font-medium ${user.is_deleted ? 'text-slate-500 line-through' : 'text-slate-800'}`}>
                    {user.full_name || '(no name)'}
                    {user.id === currentUser?.id && (
                      <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full no-underline inline-block">
                        You
                      </span>
                    )}
                    {user.is_deleted && (
                      <span className="ml-2 text-xs bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full no-underline inline-block">
                        Removed
                      </span>
                    )}
                    {!user.is_deleted && user.is_frozen && (
                      <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                        Frozen
                      </span>
                    )}
                  </p>
                  <p className={`text-sm truncate ${user.is_deleted ? 'text-slate-400' : 'text-slate-500'}`}>
                    {user.email}
                  </p>
                </div>
                {user.id !== currentUser?.id && (
                  <div className="flex gap-2 flex-shrink-0">
                    {user.is_deleted ? (
                      <button
                        onClick={() => handleRestore(user)}
                        className="text-xs bg-green-100 hover:bg-green-200 text-green-700 px-3 py-1.5 rounded-lg font-medium"
                      >
                        Restore
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => startEdit(user)}
                          className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleFreeze(user)}
                          className={`text-xs px-3 py-1.5 rounded-lg ${
                            user.is_frozen
                              ? 'bg-green-100 hover:bg-green-200 text-green-700'
                              : 'bg-amber-100 hover:bg-amber-200 text-amber-700'
                          }`}
                        >
                          {user.is_frozen ? 'Unfreeze' : 'Freeze'}
                        </button>
                        <button
                          onClick={() => handleSoftDelete(user)}
                          className="text-xs bg-red-100 hover:bg-red-200 text-red-700 px-3 py-1.5 rounded-lg"
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
