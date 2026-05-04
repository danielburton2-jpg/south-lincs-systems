'use client'

/**
 * /dashboard/phone-directory — admin manages the directory.
 *
 *   - Top: alert banner (with "Reset PIN" buttons inline)
 *   - Middle: list of entries with edit / delete
 *   - Bottom: "Add new entry" form
 *   - Side: "Reset user PIN" picker — admin can clear any user's PIN
 *     so they can choose a fresh one on next access
 *
 * Admin-only. Non-admins are redirected.
 */

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import PhoneDirectoryAlertBanner from '@/components/PhoneDirectoryAlertBanner'
import OnCallManager from '@/components/phone-directory/OnCallManager'

const supabase = createClient()

type Entry = {
  id: string
  name: string
  phone_number: string
  notes: string | null
  sort_order: number
}

type UserRow = {
  id: string
  full_name: string | null
  email: string | null
  has_code: boolean
}

export default function AdminPhoneDirectoryPage() {
  const router = useRouter()

  const [companyId, setCompanyId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [entries, setEntries] = useState<Entry[]>([])
  const [entriesVersion, setEntriesVersion] = useState(0)
  const [users, setUsers] = useState<UserRow[]>([])

  // Add form
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newNotes, setNewNotes] = useState('')
  const [adding, setAdding] = useState(false)

  // Edit state — keyed by id; when set, that row renders inputs
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editing, setEditing] = useState(false)

  // ── Init ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, role, company_id')
        .eq('id', user.id)
        .single()
      if (cancelled) return
      if (!profile?.company_id) { router.push('/dashboard'); return }
      if (profile.role !== 'admin') { router.push('/dashboard'); return }
      setCompanyId(profile.company_id)
      await Promise.all([loadEntries(), loadUsers(profile.company_id)])
      if (!cancelled) setLoading(false)
    }
    init()
    return () => { cancelled = true }
  }, [router])

  const loadEntries = async () => {
    try {
      const res = await fetch('/api/phone-directory/entries')
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error || 'Failed to load entries')
        return
      }
      setEntries(data.entries || [])
      setEntriesVersion(v => v + 1)
    } catch (e: any) {
      setError(e?.message || 'Failed to load entries')
    }
  }

  const loadUsers = async (cid: string) => {
    // Pull all users in this company plus a hint of who has a code set
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('company_id', cid)
      .order('full_name')
    const { data: codes } = await supabase
      .from('phone_directory_codes')
      .select('user_id')
      .eq('company_id', cid)
    const codeSet = new Set((codes || []).map((c: any) => c.user_id))
    setUsers((profs || []).map((p: any) => ({
      id: p.id,
      full_name: p.full_name,
      email: p.email,
      has_code: codeSet.has(p.id),
    })))
  }

  // ── Add ──────────────────────────────────────────────────────────
  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!newName.trim() || !newPhone.trim()) {
      setError('Name and phone number are required')
      return
    }
    setAdding(true)
    try {
      const res = await fetch('/api/phone-directory/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          phone_number: newPhone.trim(),
          notes: newNotes.trim() || null,
          sort_order: entries.length,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error || 'Failed to add')
        return
      }
      setEntries(prev => [...prev, data.entry])
      setEntriesVersion(v => v + 1)
      setNewName(''); setNewPhone(''); setNewNotes('')
    } finally {
      setAdding(false)
    }
  }

  // ── Edit ─────────────────────────────────────────────────────────
  const startEdit = (e: Entry) => {
    setEditingId(e.id)
    setEditName(e.name)
    setEditPhone(e.phone_number)
    setEditNotes(e.notes || '')
  }
  const cancelEdit = () => {
    setEditingId(null)
    setEditName(''); setEditPhone(''); setEditNotes('')
  }
  const saveEdit = async () => {
    if (!editingId) return
    if (!editName.trim() || !editPhone.trim()) {
      alert('Name and phone number are required')
      return
    }
    setEditing(true)
    try {
      const res = await fetch(`/api/phone-directory/entries/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          phone_number: editPhone.trim(),
          notes: editNotes.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data?.error || 'Failed to save')
        return
      }
      setEntries(prev => prev.map(e => e.id === editingId ? data.entry : e))
      setEntriesVersion(v => v + 1)
      cancelEdit()
    } finally {
      setEditing(false)
    }
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}" from the directory?`)) return
    const res = await fetch(`/api/phone-directory/entries/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      alert(data?.error || 'Failed to delete')
      return
    }
    setEntries(prev => prev.filter(e => e.id !== id))
    setEntriesVersion(v => v + 1)
  }

  // ── Reset user PIN ───────────────────────────────────────────────
  const handleResetCode = async (userId: string, name: string) => {
    if (!confirm(`Reset PIN for ${name}? They will be asked to set a new code on next access.`)) return
    const res = await fetch('/api/phone-directory/admin-reset-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      alert(data?.error || 'Reset failed')
      return
    }
    if (companyId) await loadUsers(companyId)
  }

  // ── Render ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-8 text-slate-400 italic">Loading…</div>
    )
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-4">
        <Link href="/dashboard" className="text-sm text-blue-600 hover:underline">← Back to dashboard</Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-2">Phone Directory</h1>
        <p className="text-sm text-slate-500 mt-1">
          Numbers your drivers can tap to call. Drivers see the directory only after entering their PIN.
        </p>
      </div>

      {error && (
        <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
          {error}
        </div>
      )}

      <PhoneDirectoryAlertBanner showResetButton />

      {/* Entries list */}
      <section className="mt-6 bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
        <h2 className="text-lg font-semibold text-slate-800 mb-3">Numbers</h2>
        {entries.length === 0 ? (
          <p className="text-sm text-slate-400 italic">No entries yet. Add one below.</p>
        ) : (
          <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
            {entries.map(e => (
              <li key={e.id} className="p-3 hover:bg-slate-50">
                {editingId === e.id ? (
                  <div className="space-y-2">
                    <input
                      value={editName}
                      onChange={ev => setEditName(ev.target.value)}
                      placeholder="Name"
                      className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
                    />
                    <input
                      value={editPhone}
                      onChange={ev => setEditPhone(ev.target.value)}
                      placeholder="Phone number"
                      type="tel"
                      className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
                    />
                    <textarea
                      value={editNotes}
                      onChange={ev => setEditNotes(ev.target.value)}
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
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-800 truncate">{e.name}</p>
                      <p className="text-sm text-slate-700">{e.phone_number}</p>
                      {e.notes && <p className="text-xs text-slate-500 mt-0.5">{e.notes}</p>}
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={() => startEdit(e)}
                        className="text-xs text-blue-600 hover:underline"
                      >Edit</button>
                      <button
                        onClick={() => handleDelete(e.id, e.name)}
                        className="text-xs text-red-600 hover:underline"
                      >Delete</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Add form */}
      <section className="mt-6 bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
        <h2 className="text-lg font-semibold text-slate-800 mb-3">Add a number</h2>
        <form onSubmit={handleAdd} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Name *</label>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="e.g. Workshop"
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Phone number *</label>
            <input
              value={newPhone}
              onChange={e => setNewPhone(e.target.value)}
              placeholder="e.g. 01234 567890"
              type="tel"
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Notes (optional)</label>
            <textarea
              value={newNotes}
              onChange={e => setNewNotes(e.target.value)}
              placeholder="e.g. Open Mon-Fri 8am-5pm"
              rows={2}
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
            />
          </div>
          <button
            type="submit"
            disabled={adding}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
          >
            {adding ? 'Adding…' : 'Add'}
          </button>
        </form>
      </section>

      {/* On-call rota */}
      <section className="mt-6 bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
        <h2 className="text-lg font-semibold text-slate-800 mb-1">On-call rota</h2>
        <p className="text-xs text-slate-500 mb-3">
          Pick someone (or a phone, like an on-call mobile) from the directory above
          and assign them to a date range and time window. Drivers see them at the top of
          their phone directory while on call.
        </p>
        <OnCallManager entries={entries} entriesVersion={entriesVersion} />
      </section>

      {/* Reset user PINs */}
      <section className="mt-6 bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
        <h2 className="text-lg font-semibold text-slate-800 mb-1">Reset a user's PIN</h2>
        <p className="text-xs text-slate-500 mb-3">
          Clears their saved code. They&apos;ll be asked to choose a new one when they next open the directory.
        </p>
        {users.length === 0 ? (
          <p className="text-sm text-slate-400 italic">No users in this company.</p>
        ) : (
          <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
            {users.map(u => (
              <li key={u.id} className="p-3 flex items-center justify-between gap-3 hover:bg-slate-50">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">
                    {u.full_name || u.email || '(no name)'}
                  </p>
                  <p className="text-xs text-slate-500">
                    {u.has_code ? 'PIN is set' : 'No PIN set'}
                  </p>
                </div>
                <button
                  onClick={() => handleResetCode(u.id, u.full_name || u.email || 'this user')}
                  disabled={!u.has_code}
                  className="text-xs px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Reset PIN
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
