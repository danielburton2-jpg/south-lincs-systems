'use client'

/**
 * /dashboard/users — admin users list.
 *
 * Lists all (non-deleted) users in the admin's company. Each user has
 * Edit / Freeze / Remove buttons. Edit goes to /dashboard/users/edit/[id].
 *
 * Managers shouldn't reach this page — middleware allows them through
 * but the layout doesn't gate by sub-role. We add a quick role check
 * here that redirects managers to /dashboard/team.
 */

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

const supabase = createClient()

type Feature = { id: string; slug: string; name: string }

type User = {
  id: string
  full_name: string | null
  email: string | null
  role: string
  job_title: string | null
  employee_number: string | null
  holiday_entitlement: number | null
  is_frozen: boolean
  user_features: { feature_id: string; is_enabled: boolean }[]
}

export default function DashboardUsersPage() {
  const router = useRouter()
  const [users, setUsers] = useState<User[]>([])
  const [features, setFeatures] = useState<Feature[]>([])
  const [companyName, setCompanyName] = useState('')
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  const showMessage = (msg: string, type: 'success' | 'error') => {
    setMessage(msg)
    setMessageType(type)
    setTimeout(() => setMessage(''), 4000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: profile } = await supabase
        .from('profiles')
        .select('id, email, role, full_name, company_id')
        .eq('id', user.id).single()
      if (!profile?.company_id) return
      setCurrentUser(profile)

      // Managers shouldn't be here — bounce to their team page
      if (profile.role === 'manager') { router.push('/dashboard/team'); return }
      if (profile.role !== 'admin') { router.push('/dashboard'); return }

      // Company name (for the heading)
      const cRes = await fetch(`/api/get-company?id=${encodeURIComponent(profile.company_id)}`)
      const cData = await cRes.json()
      if (cRes.ok) setCompanyName(cData.company?.name || '')

      // Features (for badges)
      const fRes = await fetch('/api/list-features')
      const fData = await fRes.json()
      if (Array.isArray(fData.features)) setFeatures(fData.features)

      // Users
      const uRes = await fetch('/api/get-company-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: profile.company_id }),
      })
      const uData = await uRes.json()
      if (Array.isArray(uData.users)) setUsers(uData.users)
    } catch (e: any) {
      showMessage(e?.message || 'Failed to load', 'error')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => { load() }, [load])

  const featureById = (id: string) => features.find(f => f.id === id)

  const adminCount   = users.filter(u => u.role === 'admin').length
  const managerCount = users.filter(u => u.role === 'manager').length
  const userCount    = users.filter(u => u.role === 'user').length
  const frozenCount  = users.filter(u => u.is_frozen).length

  const roleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin':   return 'bg-purple-100 text-purple-700'
      case 'manager': return 'bg-blue-100 text-blue-700'
      case 'user':    return 'bg-slate-100 text-slate-700'
      default:        return 'bg-slate-100 text-slate-700'
    }
  }

  const handleFreeze = async (u: User) => {
    const res = await fetch('/api/update-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: u.id,
        toggle_freeze: !u.is_frozen,
        actor_id: currentUser?.id,
        actor_email: currentUser?.email,
        actor_role: currentUser?.role,
        company_name: companyName,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      showMessage('Error: ' + (data.error || 'unknown'), 'error')
      return
    }
    showMessage(u.is_frozen ? 'User unfrozen' : 'User frozen', 'success')
    load()
  }

  const handleSoftDelete = async (u: User) => {
    if (!confirm(`Remove ${u.full_name || u.email}?\n\nThe user can be recovered later.`)) return
    const res = await fetch('/api/update-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: u.id,
        delete: true,
        actor_id: currentUser?.id,
        actor_email: currentUser?.email,
        actor_role: currentUser?.role,
        company_name: companyName,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      showMessage('Error: ' + (data.error || 'unknown'), 'error')
      return
    }
    showMessage('User removed', 'success')
    load()
  }

  if (loading) return <div className="p-8 text-slate-400 italic">Loading users…</div>

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-2xl font-bold text-slate-900 mb-2">Users</h1>
      <p className="text-sm text-slate-500 mb-6">{companyName}</p>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 text-center">
          <p className="text-2xl font-bold text-slate-800">{users.length}</p>
          <p className="text-xs text-slate-500 mt-1">Total Users</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 text-center">
          <p className="text-2xl font-bold text-purple-600">{adminCount}</p>
          <p className="text-xs text-slate-500 mt-1">Admins</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 text-center">
          <p className="text-2xl font-bold text-blue-600">{managerCount}</p>
          <p className="text-xs text-slate-500 mt-1">Managers</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 text-center">
          <p className="text-2xl font-bold text-slate-600">{userCount}</p>
          <p className="text-xs text-slate-500 mt-1">Users</p>
        </div>
      </div>

      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-bold text-slate-800">
          All Users
          {frozenCount > 0 && (
            <span className="text-sm font-normal text-orange-500 ml-2">({frozenCount} frozen)</span>
          )}
        </h3>
        <Link href="/dashboard/users/add"
          className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-5 py-2 rounded-lg transition">
          + Add User
        </Link>
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm font-medium ${
          messageType === 'success'
            ? 'bg-green-50 border border-green-200 text-green-700'
            : 'bg-red-50 border border-red-200 text-red-700'
        }`}>
          {message}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
        {users.length === 0 ? (
          <p className="text-sm text-slate-400 italic">No users yet. Click + Add User above.</p>
        ) : (
          <ul className="space-y-3">
            {users.map(u => (
              <li key={u.id} className={`border rounded-xl p-4 ${
                u.is_frozen ? 'border-orange-300 bg-orange-50' : 'border-slate-200'
              }`}>
                <div className="flex justify-between items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-slate-800">{u.full_name || u.email}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleBadgeColor(u.role)}`}>
                        {u.role}
                      </span>
                      {u.employee_number && (
                        <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                          {u.employee_number}
                        </span>
                      )}
                      {u.job_title && (
                        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                          {u.job_title}
                        </span>
                      )}
                      {u.holiday_entitlement !== null && u.holiday_entitlement !== undefined && (
                        <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">
                          🏖️ {u.holiday_entitlement} days
                        </span>
                      )}
                      {u.is_frozen && (
                        <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">Frozen</span>
                      )}
                    </div>
                    <p className="text-sm text-slate-500 mt-0.5">{u.email}</p>
                    {u.user_features && u.user_features.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {u.role === 'admin' ? (
                          <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                            All features
                          </span>
                        ) : (
                          u.user_features
                            .filter(uf => uf.is_enabled)
                            .map(uf => (
                              <span key={uf.feature_id}
                                className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                                {featureById(uf.feature_id)?.name || 'feature'}
                              </span>
                            ))
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <Link href={`/dashboard/users/edit/${u.id}`}
                      className="text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg">
                      Edit
                    </Link>
                    <button onClick={() => handleFreeze(u)}
                      className={`text-sm px-3 py-1.5 rounded-lg ${
                        u.is_frozen
                          ? 'bg-green-100 hover:bg-green-200 text-green-700'
                          : 'bg-orange-100 hover:bg-orange-200 text-orange-700'
                      }`}>
                      {u.is_frozen ? 'Unfreeze' : 'Freeze'}
                    </button>
                    <button onClick={() => handleSoftDelete(u)}
                      className="text-sm bg-red-100 hover:bg-red-200 text-red-700 px-3 py-1.5 rounded-lg">
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
