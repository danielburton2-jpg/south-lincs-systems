'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useIdleLogout, IdleWarningModal } from '@/lib/useIdleLogout'

const supabase = createClient()

export default function SuperuserDashboard() {
  const [companies, setCompanies] = useState<any[]>([])
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [expiringCount, setExpiringCount] = useState(0)
  const router = useRouter()
  const { showWarning, secondsLeft, stayLoggedIn } = useIdleLogout(true)

  const fetchCurrentUser = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()
      setCurrentUser(profile)
    }
  }, [])

  const fetchCompanies = useCallback(async () => {
    const { data } = await supabase
      .from('companies')
      .select('*')
      .order('created_at', { ascending: false })
    if (data) {
      setCompanies(data)
      const today = new Date()
      const in7Days = new Date()
      in7Days.setDate(today.getDate() + 7)
      const expiring = data.filter((c: any) => {
        const effectiveEnd = c.override_end_date || c.end_date
        if (!effectiveEnd) return false
        const end = new Date(effectiveEnd)
        return end >= today && end <= in7Days
      })
      setExpiringCount(expiring.length)
    }
  }, [])

  useEffect(() => {
    fetchCurrentUser()
    fetchCompanies()
  }, [fetchCurrentUser, fetchCompanies])

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

  return (
    <main className="min-h-screen bg-gray-100">
      <IdleWarningModal show={showWarning} secondsLeft={secondsLeft} onStay={stayLoggedIn} />

      <div className="bg-blue-700 text-white px-6 py-4 flex justify-between items-center">
        <h1 className="text-2xl font-bold">South Lincs Systems</h1>
        <div className="flex items-center gap-4">
          <span className="text-blue-200 text-sm">
            Welcome, {currentUser?.full_name || 'Superuser'}
          </span>
          <button
            onClick={handleSignOut}
            className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm"
          >
            Sign Out
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-6 space-y-6">

        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-xl shadow p-5 text-center">
            <p className="text-3xl font-bold text-blue-600">{companies.length}</p>
            <p className="text-gray-500 text-sm mt-1">Total Companies</p>
          </div>
          <div className="bg-white rounded-xl shadow p-5 text-center">
            <p className="text-3xl font-bold text-green-600">
              {companies.filter((c) => c.is_active).length}
            </p>
            <p className="text-gray-500 text-sm mt-1">Active Companies</p>
          </div>
          <div className={`rounded-xl shadow p-5 text-center ${expiringCount > 0 ? 'bg-yellow-50' : 'bg-white'}`}>
            <p className={`text-3xl font-bold ${expiringCount > 0 ? 'text-yellow-600' : 'text-gray-400'}`}>
              {expiringCount}
            </p>
            <p className="text-gray-500 text-sm mt-1">Expiring Soon</p>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-2">Company Management</h2>
          <p className="text-gray-500 text-sm mb-4">
            Create and manage companies, subscriptions and features
          </p>
          <button
            onClick={() => router.push('/superuser/companies')}
            className="bg-blue-600 text-white px-5 py-2 rounded-lg hover:bg-blue-700 transition"
          >
            Manage Companies →
          </button>
        </div>

        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-2">Superuser Management</h2>
          <p className="text-gray-500 text-sm mb-4">Add, edit, freeze or remove superusers</p>
          <button
            onClick={() => router.push('/superuser/superusers')}
            className="bg-blue-600 text-white px-5 py-2 rounded-lg hover:bg-blue-700 transition"
          >
            Manage Superusers →
          </button>
        </div>

        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-2">Audit Log</h2>
          <p className="text-gray-500 text-sm mb-4">View all system activity</p>
          <button
            onClick={() => router.push('/superuser/audit')}
            className="bg-blue-600 text-white px-5 py-2 rounded-lg hover:bg-blue-700 transition"
          >
            View Audit Log →
          </button>
        </div>

      </div>
    </main>
  )
}