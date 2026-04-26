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
  const [pendingHolidayCount, setPendingHolidayCount] = useState(0)
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

    let titles: string[] = []
    if (profile.role === 'manager') {
      const { data: titlesData } = await supabase
        .from('manager_job_titles')
        .select('job_title')
        .eq('manager_id', user.id)
      titles = titlesData?.map((t: any) => t.job_title) || []
      setManagerTitles(titles)
    }

    const res = await fetch('/api/get-company-users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: profile.company_id }),
    })
    const result = await res.json()
    if (result.users) setUsers(result.users)

    const holRes = await fetch('/api/get-holiday-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: profile.company_id, scope: 'company' }),
    })
    const holResult = await holRes.json()
    if (holResult.requests) {
      let pending = holResult.requests.filter((r: any) =>
        r.status === 'pending' || r.status === 'cancel_pending'
      )
      if (profile.role === 'manager') {
        pending = pending.filter((r: any) =>
          r.user?.job_title && titles.includes(r.user.job_title)
        )
      }
      pending = pending.filter((r: any) => r.user_id !== user.id)
      setPendingHolidayCount(pending.length)
    }

    setLoading(false)
  }, [router])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Realtime updates
  useEffect(() => {
    if (!currentUser?.company_id) return

    const channel = supabase
      .channel('dashboard-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'holiday_requests',
          filter: `company_id=eq.${currentUser.company_id}`,
        },
        () => fetchData()
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profiles',
          filter: `company_id=eq.${currentUser.company_id}`,
        },
        () => fetchData()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [currentUser?.company_id, fetchData])

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

  const hasFeature = (name: string) => {
    return userFeatures.some((uf: any) => uf.features?.name === name)
  }

  const hasCompanyFeature = (name: string) => {
    return company?.company_features?.some((cf: any) =>
      cf.is_enabled && cf.features?.name === name
    )
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

  const isAdmin = currentUser?.role === 'admin'
  const isManager = currentUser?.role === 'manager'
  const showHolidayApprovals = (isAdmin || (isManager && managerTitles.length > 0)) && hasCompanyFeature('Holidays')
  const showMyHolidays = (isAdmin || isManager) && hasFeature('Holidays') && currentUser?.holiday_entitlement !== null && currentUser?.holiday_entitlement !== undefined
  const showSchedules = hasCompanyFeature('Schedules') && (isAdmin || hasFeature('Schedules'))

  const balance = currentUser?.holiday_entitlement

  return (
    <main className="min-h-screen bg-gray-100">
      <IdleWarningModal show={showWarning} secondsLeft={secondsLeft} onStay={stayLoggedIn} />

      <div className="bg-blue-700 text-white px-6 py-4 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">{company?.name || 'Dashboard'}</h1>
          <p className="text-blue-200 text-sm">South Lincs Systems</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/dashboard/profile')}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 px-3 py-2 rounded-lg transition"
          >
            <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center font-semibold text-sm">
              {currentUser?.full_name?.charAt(0)}
            </div>
            <div className="text-left hidden sm:block">
              <p className="text-sm font-medium">{currentUser?.full_name}</p>
              <p className="text-blue-200 text-xs capitalize">{currentUser?.role}</p>
            </div>
          </button>
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

        {/* Stats - 3 across */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-white rounded-xl shadow p-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{visibleUsers.length}</p>
            <p className="text-gray-500 text-xs mt-1">
              {currentUser?.role === 'admin' ? 'Total Users' : 'Your Team'}
            </p>
          </div>
          <div className="bg-white rounded-xl shadow p-4 text-center">
            <p className="text-2xl font-bold text-green-600">
              {visibleUsers.filter(u => !u.is_frozen).length}
            </p>
            <p className="text-gray-500 text-xs mt-1">Active Users</p>
          </div>
          <button
            onClick={() => showHolidayApprovals && router.push('/dashboard/holidays')}
            className={`rounded-xl shadow p-4 text-center transition ${
              pendingHolidayCount > 0
                ? 'bg-yellow-50 border-2 border-yellow-400 hover:bg-yellow-100 animate-pulse'
                : 'bg-white hover:bg-gray-50'
            } ${showHolidayApprovals ? 'cursor-pointer' : 'cursor-default'}`}
            disabled={!showHolidayApprovals}
          >
            <p className={`text-2xl font-bold ${pendingHolidayCount > 0 ? 'text-yellow-700' : 'text-gray-400'}`}>
              {pendingHolidayCount}
            </p>
            <p className="text-gray-600 text-xs mt-1 font-medium">Pending Requests</p>
          </button>
        </div>

        {/* Quick Actions - smaller compact tiles */}
        <div className="bg-white rounded-xl shadow p-5">
          <h2 className="text-lg font-semibold text-gray-800 mb-3">Quick Actions</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">

            {isAdmin && (
              <button
                onClick={() => router.push('/dashboard/users')}
                className="bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg p-3 text-left transition"
              >
                <div className="text-2xl mb-1">👥</div>
                <p className="font-semibold text-purple-700 text-sm">Manage Users</p>
                <p className="text-[11px] text-purple-600 mt-0.5">Add, edit users</p>
              </button>
            )}

            {isManager && (
              <button
                onClick={() => router.push('/dashboard/users')}
                className="bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg p-3 text-left transition"
              >
                <div className="text-2xl mb-1">👥</div>
                <p className="font-semibold text-purple-700 text-sm">Your Team</p>
                <p className="text-[11px] text-purple-600 mt-0.5">View team</p>
              </button>
            )}

            {showHolidayApprovals && (
              <button
                onClick={() => router.push('/dashboard/holidays')}
                className="bg-yellow-50 hover:bg-yellow-100 border border-yellow-200 rounded-lg p-3 text-left transition relative"
              >
                <div className="text-2xl mb-1">🏖️</div>
                <p className="font-semibold text-yellow-700 text-sm">Holiday Approvals</p>
                <p className="text-[11px] text-yellow-600 mt-0.5">Approve requests</p>
                {pendingHolidayCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                    {pendingHolidayCount}
                  </span>
                )}
              </button>
            )}

            {showMyHolidays && (
              <button
                onClick={() => router.push('/dashboard/my-holidays')}
                className="bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-lg p-3 text-left transition"
              >
                <div className="text-2xl mb-1">🏝️</div>
                <p className="font-semibold text-orange-700 text-sm">My Holidays</p>
                <p className="text-[11px] text-orange-600 mt-0.5">
                  {balance !== null && balance !== undefined ? `${balance} days left` : 'Request time off'}
                </p>
              </button>
            )}

            {showSchedules && (
              <button
                onClick={() => router.push('/dashboard/schedules')}
                className="bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg p-3 text-left transition"
              >
                <div className="text-2xl mb-1">📅</div>
                <p className="font-semibold text-teal-700 text-sm">Schedules</p>
                <p className="text-[11px] text-teal-600 mt-0.5">View & manage rotas</p>
              </button>
            )}

            <button
              onClick={() => router.push('/dashboard/profile')}
              className="bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg p-3 text-left transition"
            >
              <div className="text-2xl mb-1">👤</div>
              <p className="font-semibold text-gray-700 text-sm">My Profile</p>
              <p className="text-[11px] text-gray-600 mt-0.5">Settings, password</p>
            </button>

          </div>
        </div>

      </div>
    </main>
  )
}