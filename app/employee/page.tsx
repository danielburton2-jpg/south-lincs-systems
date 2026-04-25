'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

const supabase = createClient()

export default function EmployeeHome() {
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [userFeatures, setUserFeatures] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()

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
        .select('*')
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
    setLoading(false)
  }, [router])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const getGreeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 17) return 'Good afternoon'
    return 'Good evening'
  }

  const getFirstName = (fullName: string) => {
    return fullName?.split(' ')[0] || ''
  }

  const getFeatureIcon = (name: string) => {
    const icons: Record<string, string> = {
      Holidays: '🏖️',
      Schedules: '📅',
      Timesheets: '⏱️',
      Tasks: '✅',
      Reports: '📊',
      Messaging: '💬',
      Documents: '📄',
    }
    return icons[name] || '📌'
  }

  const hasFeature = (name: string) => {
    return userFeatures.some((uf: any) => uf.features?.name === name)
  }

  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Loading...</p>
      </main>
    )
  }

  // Format holiday entitlement
  const holidayBalance = currentUser?.holiday_entitlement
  const showHolidayBalance = hasFeature('Holidays') && holidayBalance !== null && holidayBalance !== undefined

  const overviewCards: { icon: string; value: string; label: string }[] = []

  if (hasFeature('Holidays')) {
    overviewCards.push({
      icon: '🏖️',
      value: holidayBalance !== null && holidayBalance !== undefined ? holidayBalance.toString() : '—',
      label: 'Days holiday left'
    })
  }
  if (hasFeature('Schedules')) {
    overviewCards.push({ icon: '📅', value: '—', label: 'Shifts this week' })
  }
  if (hasFeature('Timesheets')) {
    overviewCards.push({ icon: '⏱️', value: '—', label: 'Hours this week' })
  }
  if (hasFeature('Tasks')) {
    overviewCards.push({ icon: '✅', value: '—', label: 'Open tasks' })
  }
  if (hasFeature('Messaging')) {
    overviewCards.push({ icon: '💬', value: '—', label: 'New messages' })
  }
  if (hasFeature('Documents')) {
    overviewCards.push({ icon: '📄', value: '—', label: 'New documents' })
  }
  if (hasFeature('Reports')) {
    overviewCards.push({ icon: '📊', value: '—', label: 'Available reports' })
  }

  const bottomNavItems: any[] = [
    { icon: '🏠', label: 'Home', path: '/employee', active: true },
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

  bottomNavItems.push({ icon: '👤', label: 'Profile', path: '/employee/profile', active: false })

  const visibleNavItems = bottomNavItems.slice(0, 5)

  return (
    <main className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div className="bg-gradient-to-br from-blue-600 to-blue-800 text-white px-6 pt-10 pb-8 rounded-b-3xl shadow-lg">
        <div className="flex items-center justify-between mb-1">
          <p className="text-blue-100 text-sm">{today}</p>
          <button
            onClick={() => router.push('/employee/profile')}
            className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center font-semibold text-white hover:bg-white/30 transition"
          >
            {getFirstName(currentUser?.full_name || '').charAt(0)}
          </button>
        </div>
        <h1 className="text-2xl font-bold">
          {getGreeting()}, {getFirstName(currentUser?.full_name || '')}
        </h1>
        <p className="text-blue-100 text-sm mt-1">{company?.name}</p>
      </div>

      <div className="px-6 pt-6 space-y-6">

        {/* Holiday Balance Highlight Card (if user has Holidays) */}
        {showHolidayBalance && (
          <div className="bg-gradient-to-br from-yellow-400 to-orange-500 rounded-2xl shadow-lg p-5 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-90">Your Holiday Balance</p>
                <p className="text-4xl font-bold mt-1">
                  {holidayBalance} <span className="text-lg font-normal">days</span>
                </p>
                {currentUser?.employment_start_date && (
                  <p className="text-xs opacity-80 mt-1">
                    Started: {new Date(currentUser.employment_start_date).toLocaleDateString('en-GB')}
                  </p>
                )}
              </div>
              <div className="text-6xl opacity-80">🏖️</div>
            </div>
          </div>
        )}

        {overviewCards.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Quick Overview
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {overviewCards.map((card, i) => (
                <div key={i} className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100">
                  <div className="text-3xl mb-1">{card.icon}</div>
                  <p className="text-2xl font-bold text-gray-800">{card.value}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{card.label}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Your Apps
          </h2>
          {userFeatures.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-sm p-8 border border-gray-100 text-center">
              <p className="text-gray-400 text-sm">
                You don&apos;t have any features enabled yet. Speak to your manager.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {userFeatures.map((uf: any) => (
                <button
                  key={uf.feature_id}
                  onClick={() => router.push(`/employee/${uf.features.name.toLowerCase()}`)}
                  className="bg-white hover:bg-gray-50 active:bg-gray-100 rounded-2xl shadow-sm p-5 border border-gray-100 text-left transition"
                >
                  <div className="text-3xl mb-2">{getFeatureIcon(uf.features.name)}</div>
                  <p className="font-semibold text-gray-800">{uf.features.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                    {uf.features.description}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>

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