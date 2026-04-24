'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useIdleLogout, IdleWarningModal } from '@/lib/useIdleLogout'

const supabase = createClient()

export default function Dashboard() {
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [userFeatures, setUserFeatures] = useState<any[]>([])
  const [managerTitles, setManagerTitles] = useState<string[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const { showWarning, secondsLeft, stayLoggedIn } = useIdleLogout(true)

  const fetchData = useCallback(async () => {
    setLoading(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()

    if (!profile) {
      router.push('/login')
      return
    }

    setCurrentUser(profile)

    if (profile.company_id) {
      const { data: companyData } = await supabase
        .from('companies')
        .select(`
          *,
          company_features (
            is_enabled,
            feature_id,
            features (id, name, description)
          )
        `)
        .eq('id', profile.company_id)
        .single()
      setCompany(companyData)
    }

    const { data: featuresData } = await supabase
      .from('user_features')
      .select(`
        is_enabled,
        feature_id,
        features (id, name, description)
      `)
      .eq('user_id', user.id)
      .eq('is_enabled', true)
    setUserFeatures(featuresData || [])

    if (profile.role === 'manager') {
      const { data: titles } = await supabase
        .from('manager_job_titles')
        .select('job_title')
        .eq('manager_id', user.id)
      setManagerTitles(titles?.map((t: any) => t.job_title) || [])
    }

    const res = await fetch('/api/get-company-users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: profile.company_id }),
    })
    const result = await res.json()
    if (result.users) setUsers(result.users)

    setLoading(false)
  }, [router])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const visibleUsers = currentUser?.role === 'admin'
    ? users
    : currentUser?.role === 'manager'
    ? users.filter(u => u.job_title && managerTitles.includes(u.job_title))
    : []

  const handleSignOut = async () => {
    await fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: currentUser?.id,
        user_email: currentUser?.email,
        user_role: currentUser?.role,
        action: 'LOGOUT',
        entity: 'auth',
        details: { email: currentUser?.email },
      }),
    })
    await supabase.auth.signOut()
    router.push('/login')
  }

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin': return 'bg-purple-100 text-purple-700'
      case 'manager': return 'bg-blue-100 text-blue-700'
      case 'user': return 'bg-gray-100 text-gray-700'
      default: return 'bg-gray-100 text-gray-700'
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-500">Loading dashboard...</p>
      </main>
    )
  }

  const effectiveEnd = company?.override_end_date || company?.end_date
  const daysRemaining = effectiveEnd
    ? Math.ceil((new Date(effectiveEnd).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
    : null

  return (
    <main className="min-h-screen bg-gray-100">
      <IdleWarningModal show={showWarning} secondsLeft={secondsLeft} onStay={stayLoggedIn} />

      <div className="bg-blue-700 text-white px-6 py-4 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">{company?.name || 'Dashboard'}</h1>
          <p className="text-blue-200 text-sm">South Lincs Systems</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-sm font-medium">{currentUser?.full_name}</p>
            <p className="text-blue-200 text-xs capitalize">{currentUser?.role}</p>
          </div>
          <button
            onClick={handleSignOut}
            className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm"
          >
            Sign Out
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-6 space-y-6">

        {daysRemaining !== null && daysRemaining <= 14 && daysRemaining >= 0 && (
          <div className="bg-yellow-50 border border-yellow-300 rounded-xl p-4">
            <p className="text-yellow-800 font-medium">
              ⚠️ Your subscription expires in {daysRemaining} days ({new Date(effectiveEnd!).toLocaleDateString('en-GB')})
            </p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-xl shadow p-5 text-center">
            <p className="text-3xl font-bold text-blue-600">{visibleUsers.length}</p>
            <p className="text-gray-500 text-sm mt-1">
              {currentUser?.role === 'admin' ? 'Total Users' : 'Your Team'}
            </p>
          </div>
          <div className="bg-white rounded-xl shadow p-5 text-center">
            <p className="text-3xl font-bold text-purple-600">{userFeatures.length}</p>
            <p className="text-gray-500 text-sm mt-1">Your Features</p>
          </div>
          <div className="bg-white rounded-xl shadow p-5 text-center">
            <p className="text-3xl font-bold text-green-600">
              {visibleUsers.filter(u => !u.is_frozen).length}
            </p>
            <p className="text-gray-500 text-sm mt-1">Active Users</p>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">Your Features</h2>
          {currentUser?.role === 'admin' ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {company?.company_features
                ?.filter((cf: any) => cf.is_enabled)
                .map((cf: any) => (
                  <button
                    key={cf.feature_id}
                    onClick={() => router.push(`/dashboard/${cf.features.name.toLowerCase()}`)}
                    className="bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-xl p-4 text-left transition"
                  >
                    <p className="font-semibold text-purple-700">{cf.features.name}</p>
                    <p className="text-xs text-purple-600 mt-1">{cf.features.description}</p>
                  </button>
                ))}
            </div>
          ) : userFeatures.length === 0 ? (
            <p className="text-gray-400 text-sm">You don&apos;t have access to any features yet.</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {userFeatures.map((uf: any) => (
                <button
                  key={uf.feature_id}
                  onClick={() => router.push(`/dashboard/${uf.features.name.toLowerCase()}`)}
                  className="bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl p-4 text-left transition"
                >
                  <p className="font-semibold text-blue-700">{uf.features.name}</p>
                  <p className="text-xs text-blue-600 mt-1">{uf.features.description}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl shadow p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-gray-800">
              {currentUser?.role === 'admin' ? 'All Users' : 'Your Team'}
            </h2>
            {currentUser?.role === 'admin' && (
              <button
                onClick={() => router.push('/dashboard/users')}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition text-sm"
              >
                Manage Users →
              </button>
            )}
            {currentUser?.role === 'manager' && visibleUsers.length > 0 && (
              <button
                onClick={() => router.push('/dashboard/users')}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition text-sm"
              >
                View Team →
              </button>
            )}
          </div>

          {currentUser?.role === 'manager' && managerTitles.length === 0 && (
            <p className="text-gray-400 text-sm italic">
              No job titles have been assigned to you yet. Ask your admin to assign you some.
            </p>
          )}

          {currentUser?.role === 'manager' && managerTitles.length > 0 && (
            <p className="text-gray-500 text-sm mb-3">
              You manage staff with these job titles:{' '}
              <span className="font-medium">{managerTitles.join(', ')}</span>
            </p>
          )}

          {visibleUsers.length === 0 ? (
            <p className="text-gray-400 text-sm">No users to display.</p>
          ) : (
            <ul className="space-y-2">
              {visibleUsers.slice(0, 5).map((user) => (
                <li
                  key={user.id}
                  className={`flex justify-between items-center border rounded-lg px-4 py-2 ${
                    user.is_frozen ? 'border-orange-300 bg-orange-50' : 'border-gray-200'
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-gray-800 text-sm">{user.full_name}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getRoleBadgeColor(user.role)}`}>
                        {user.role}
                      </span>
                      {user.job_title && (
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                          {user.job_title}
                        </span>
                      )}
                      {user.is_frozen && (
                        <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full">Frozen</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{user.email}</p>
                  </div>
                </li>
              ))}
              {visibleUsers.length > 5 && (
                <p className="text-center text-sm text-gray-400 pt-2">
                  + {visibleUsers.length - 5} more users
                </p>
              )}
            </ul>
          )}
        </div>

      </div>
    </main>
  )
}