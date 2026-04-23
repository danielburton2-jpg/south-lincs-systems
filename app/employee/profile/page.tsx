'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

const supabase = createClient()

export default function EmployeeProfile() {
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [userFeatures, setUserFeatures] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  const fetchData = useCallback(async () => {
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

    if (profile) {
      setCurrentUser(profile)
      if (profile.company_id) {
        const { data: companyData } = await supabase
          .from('companies')
          .select('name')
          .eq('id', profile.company_id)
          .single()
        setCompany(companyData)
      }
    }

    const { data: featuresData } = await supabase
      .from('user_features')
      .select(`
        is_enabled,
        feature_id,
        features (id, name)
      `)
      .eq('user_id', user.id)
      .eq('is_enabled', true)

    setUserFeatures(featuresData || [])
    setLoading(false)
  }, [router])

  useEffect(() => {
    fetchData()
  }, [fetchData])

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

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Loading...</p>
      </main>
    )
  }

  // Build dynamic bottom nav
  const bottomNavItems = [
    { icon: '🏠', label: 'Home', path: '/employee', active: false },
  ]

  if (hasFeature('Holidays')) {
    bottomNavItems.push({ icon: '🏖️', label: 'Holidays', path: '/employee/holidays', active: false })
  }
  if (hasFeature('Schedules')) {
    bottomNavItems.push({ icon: '📅', label: 'Schedule', path: '/employee/schedules', active: false })
  }
  if (hasFeature('Timesheets')) {
    bottomNavItems.push({ icon: '⏱️', label: 'Hours', path: '/employee/timesheets', active: false })
  }
  if (hasFeature('Tasks')) {
    bottomNavItems.push({ icon: '✅', label: 'Tasks', path: '/employee/tasks', active: false })
  }
  if (hasFeature('Messaging')) {
    bottomNavItems.push({ icon: '💬', label: 'Messages', path: '/employee/messaging', active: false })
  }

  bottomNavItems.push({ icon: '👤', label: 'Profile', path: '/employee/profile', active: true })

  const visibleNavItems = bottomNavItems.slice(0, 5)

  return (
    <main className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div className="bg-gradient-to-br from-blue-600 to-blue-800 text-white px-6 pt-10 pb-20 rounded-b-3xl shadow-lg">
        <div className="flex items-center mb-4">
          <button
            onClick={() => router.push('/employee')}
            className="text-white text-sm"
          >
            ← Back
          </button>
        </div>
        <div className="flex flex-col items-center">
          <div className="w-24 h-24 bg-white/20 rounded-full flex items-center justify-center text-4xl font-bold mb-3">
            {currentUser?.full_name?.charAt(0)}
          </div>
          <h1 className="text-2xl font-bold">{currentUser?.full_name}</h1>
          <p className="text-blue-100 text-sm">{currentUser?.job_title || 'Employee'}</p>
        </div>
      </div>

      <div className="px-6 -mt-10 space-y-4">
        <div className="bg-white rounded-2xl shadow-sm p-6 border border-gray-100 space-y-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Email</p>
            <p className="text-gray-800 mt-1">{currentUser?.email}</p>
          </div>
          <div className="border-t border-gray-100 pt-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Company</p>
            <p className="text-gray-800 mt-1">{company?.name || '—'}</p>
          </div>
          <div className="border-t border-gray-100 pt-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Job Title</p>
            <p className="text-gray-800 mt-1">{currentUser?.job_title || '—'}</p>
          </div>
        </div>

        <button
          onClick={handleSignOut}
          className="w-full bg-white hover:bg-red-50 active:bg-red-100 border border-red-200 text-red-600 py-4 rounded-2xl font-medium transition"
        >
          Sign Out
        </button>
      </div>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg">
        <div className="flex justify-around items-center h-16 max-w-md mx-auto">
          {visibleNavItems.map((item) => (
            <button
              key={item.path}
              onClick={() => router.push(item.path)}
              className={`flex flex-col items-center gap-0.5 ${
                item.active ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <span className="text-xl">{item.icon}</span>
              <span className="text-xs font-medium">{item.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </main>
  )
}