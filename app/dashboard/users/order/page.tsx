'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useIdleLogout, IdleWarningModal } from '@/lib/useIdleLogout'
import { logAuditClient } from '@/lib/auditClient'

const supabase = createClient()

const ROLE_BADGE: Record<string, { label: string; class: string }> = {
  admin: { label: 'Admin', class: 'bg-purple-100 text-purple-700' },
  manager: { label: 'Manager', class: 'bg-blue-100 text-blue-700' },
  user: { label: 'User', class: 'bg-gray-100 text-gray-700' },
  superuser: { label: 'Superuser', class: 'bg-red-100 text-red-700' },
}

export default function UserOrderPage() {
  const router = useRouter()
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null)

  const { showWarning, secondsLeft, stayLoggedIn } = useIdleLogout(true)

  const showMessage = (msg: string, type: 'success' | 'error') => {
    setMessage(msg)
    setMessageType(type)
    if (type === 'success') setTimeout(() => setMessage(''), 4000)
  }

  const loadData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    const { data: profile } = await supabase
      .from('profiles').select('*').eq('id', user.id).single()
    if (!profile) {
      router.push('/login')
      return
    }
    setCurrentUser(profile)

    if (profile.role !== 'admin') {
      router.push('/dashboard')
      return
    }

    const { data: companyData } = await supabase
      .from('companies').select('*').eq('id', profile.company_id).single()
    setCompany(companyData)

    const { data: userList } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, job_title, display_order, is_frozen, is_deleted')
      .eq('company_id', profile.company_id)
      .eq('is_deleted', false)
      .order('display_order', { ascending: true, nullsFirst: false })
      .order('full_name', { ascending: true })

    setUsers(userList || [])
    setLoading(false)
  }, [router])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Drag handlers
  const onDragStart = (idx: number) => () => {
    setDraggedIdx(idx)
  }

  const onDragOver = (idx: number) => (e: React.DragEvent) => {
    e.preventDefault()
    if (draggedIdx === null || draggedIdx === idx) return
    setUsers(prev => {
      const next = [...prev]
      const [moved] = next.splice(draggedIdx, 1)
      next.splice(idx, 0, moved)
      setDraggedIdx(idx)
      setHasChanges(true)
      return next
    })
  }

  const onDragEnd = () => {
    setDraggedIdx(null)
  }

  // Mobile: up/down buttons (drag is fiddly on touch)
  const moveUp = (idx: number) => {
    if (idx === 0) return
    setUsers(prev => {
      const next = [...prev]
      ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
      return next
    })
    setHasChanges(true)
  }

  const moveDown = (idx: number) => {
    if (idx === users.length - 1) return
    setUsers(prev => {
      const next = [...prev]
      ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
      return next
    })
    setHasChanges(true)
  }

  const sortAlphabetically = () => {
    setUsers(prev => [...prev].sort((a, b) =>
      (a.full_name || '').localeCompare(b.full_name || '')
    ))
    setHasChanges(true)
  }

  const sortByRole = () => {
    const roleRank: Record<string, number> = { admin: 0, manager: 1, user: 2, superuser: -1 }
    setUsers(prev => [...prev].sort((a, b) => {
      const ra = roleRank[a.role] ?? 99
      const rb = roleRank[b.role] ?? 99
      if (ra !== rb) return ra - rb
      return (a.full_name || '').localeCompare(b.full_name || '')
    }))
    setHasChanges(true)
  }

  const handleSave = async () => {
    setSaving(true)

    // Update each user's display_order to match the current array order
    const updates = users.map((u, idx) =>
      supabase
        .from('profiles')
        .update({ display_order: idx + 1 })
        .eq('id', u.id)
    )

    const results = await Promise.all(updates)
    const errors = results.filter(r => r.error)

    setSaving(false)

    if (errors.length > 0) {
      showMessage(`${errors.length} update(s) failed: ${errors[0].error?.message}`, 'error')
      return
    }

    await logAuditClient({
      user: currentUser,
      action: 'USER_ORDER_UPDATED',
      entity: 'profiles',
      details: {
        company_id: currentUser.company_id,
        new_order: users.map((u, i) => ({ position: i + 1, full_name: u.full_name, id: u.id })),
      },
    })

    setHasChanges(false)
    showMessage('Order saved', 'success')
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-500">Loading...</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-100">
      <IdleWarningModal show={showWarning} secondsLeft={secondsLeft} onStay={stayLoggedIn} />

      <div className="bg-blue-700 text-white px-6 py-4 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">{company?.name}</h1>
          <p className="text-blue-200 text-sm">User Order</p>
        </div>
        <button
          onClick={() => router.push('/dashboard/users')}
          className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm"
        >
          ← Back to Users
        </button>
      </div>

      <div className="max-w-3xl mx-auto p-6 space-y-4">

        {message && (
          <div className={`p-4 rounded-lg text-sm font-medium ${
            messageType === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            {message}
          </div>
        )}

        <div className="bg-white rounded-xl shadow p-6 space-y-1">
          <h2 className="text-xl font-semibold text-gray-800">Set User Display Order</h2>
          <p className="text-sm text-gray-500">
            This is the order users will appear on the schedule calendar. Drag to reorder, or use the arrow buttons.
          </p>
        </div>

        <div className="bg-white rounded-xl shadow p-4 flex flex-wrap gap-2 items-center">
          <button
            onClick={sortAlphabetically}
            className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-medium"
          >
            Sort A–Z
          </button>
          <button
            onClick={sortByRole}
            className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-medium"
          >
            Sort by Role
          </button>
          <div className="flex-1" />
          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            {saving ? 'Saving...' : hasChanges ? 'Save Order' : 'Saved'}
          </button>
        </div>

        <div className="bg-white rounded-xl shadow overflow-hidden">
          <ul className="divide-y divide-gray-100">
            {users.map((u, idx) => {
              const badge = ROLE_BADGE[u.role] || ROLE_BADGE.user
              const isDragging = draggedIdx === idx
              return (
                <li
                  key={u.id}
                  draggable
                  onDragStart={onDragStart(idx)}
                  onDragOver={onDragOver(idx)}
                  onDragEnd={onDragEnd}
                  className={`flex items-center gap-3 px-4 py-3 transition cursor-move ${
                    isDragging ? 'bg-blue-50 opacity-50' : 'hover:bg-gray-50'
                  } ${u.is_frozen ? 'opacity-60' : ''}`}
                >
                  <div className="text-gray-400 select-none flex flex-col items-center">
                    <span className="text-xs">⋮⋮</span>
                    <span className="text-xs font-bold text-gray-600 mt-1">{idx + 1}</span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-gray-800 truncate">
                        {u.full_name || u.email}
                      </p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.class}`}>
                        {badge.label}
                      </span>
                      {u.is_frozen && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">
                          Frozen
                        </span>
                      )}
                    </div>
                    {u.job_title && (
                      <p className="text-xs text-gray-500 truncate">{u.job_title}</p>
                    )}
                  </div>

                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => moveUp(idx)}
                      disabled={idx === 0}
                      className="bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 disabled:text-gray-300 text-gray-700 w-8 h-7 rounded-md text-xs"
                      title="Move up"
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => moveDown(idx)}
                      disabled={idx === users.length - 1}
                      className="bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 disabled:text-gray-300 text-gray-700 w-8 h-7 rounded-md text-xs"
                      title="Move down"
                    >
                      ▼
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>

          {users.length === 0 && (
            <div className="p-8 text-center text-gray-400 text-sm">
              No users to order
            </div>
          )}
        </div>

        {hasChanges && (
          <div className="sticky bottom-4 bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center justify-between gap-3 shadow-lg">
            <p className="text-sm text-amber-800">You have unsaved changes</p>
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              {saving ? 'Saving...' : 'Save Now'}
            </button>
          </div>
        )}
      </div>
    </main>
  )
}