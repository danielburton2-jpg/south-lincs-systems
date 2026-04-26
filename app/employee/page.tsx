'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

const supabase = createClient()

// Map feature names to URL paths and icons
const FEATURE_ROUTES: Record<string, string> = {
  Holidays: '/employee/holidays',
  Schedules: '/employee/schedules',
  Timesheets: '/employee/timesheets',
  Tasks: '/employee/tasks',
  Reports: '/employee/reports',
  Messaging: '/employee/messaging',
  Documents: '/employee/documents',
  'Vehicle Checks': '/employee/vehicle-checks',
}

const FEATURE_ICONS: Record<string, string> = {
  Holidays: '🏖️',
  Schedules: '📅',
  Timesheets: '⏱️',
  Tasks: '✅',
  Reports: '📊',
  Messaging: '💬',
  Documents: '📄',
  'Vehicle Checks': '🚛',
}

export default function EmployeeHome() {
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [userFeatures, setUserFeatures] = useState<any[]>([])
  const [assignedDefectsCount, setAssignedDefectsCount] = useState(0)
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

    // Count open defects assigned to this user
    if (profile.company_id) {
      const { count } = await supabase
        .from('vehicle_defects')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', profile.company_id)
        .eq('status', 'open')
        .eq('assigned_to', user.id)
      setAssignedDefectsCount(count || 0)
    }

    setLoading(false)
  }, [router])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Realtime
  useEffect(() => {
    if (!currentUser?.id) return

    const profileChannel = supabase
      .channel('employee-home-profile')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${currentUser.id}`,
        },
        () => {
          fetchData()
        }
      )
      .subscribe()

    const featuresChannel = supabase
      .channel('employee-home-features')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_features',
          filter: `user_id=eq.${currentUser.id}`,
        },
        () => {
          fetchData()
        }
      )
      .subscribe()

    let defectsChannel: any = null
    if (currentUser.company_id) {
      defectsChannel = supabase
        .channel('employee-home-defects')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'vehicle_defects',
            filter: `company_id=eq.${currentUser.company_id}`,
          },
          () => {
            fetchData()
          }
        )
        .subscribe()
    }

    return () => {
      supabase.removeChannel(profileChannel)
      supabase.removeChannel(featuresChannel)
      if (defectsChannel) supabase.removeChannel(defectsChannel)
    }
  }, [currentUser?.id, currentUser?.company_id, fetchData])

  const getGreeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 17) return 'Good afternoon'
    return 'Good evening'
  }

  const getFirstName = (fullName: string) => {
    return fullName?.split(' ')[0] || ''
  }

  const getFeatureIcon = (name: string) => FEATURE_ICONS[name] || '📌'

  const getFeatureRoute = (name: string) => {
    if (FEATURE_ROUTES[name]) return FEATURE_ROUTES[name]
    return `/employee/${name.toLowerCase().replace(/\s+/g, '-')}`
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

  const holidayBalance = currentUser?.holiday_entitlement
  const showHolidayBalance = hasFeature('Holidays') && holidayBalance !== null && holidayBalance !== undefined
  const showAssignedDefectsBanner = hasFeature('Vehicle Checks') && assignedDefectsCount > 0

  return (
    <main className="min-h-screen bg-gray-50 pb-24">
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

        {showAssignedDefectsBanner && (
          <button
            onClick={() => router.push('/employee/vehicle-checks/defects?filter=mine')}
            className="w-full bg-gradient-to-br from-purple-600 to-purple-800 hover:from-purple-700 hover:to-purple-900 active:from-purple-800 rounded-2xl shadow-lg p-5 text-white text-left transition"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <span className="text-4xl flex-shrink-0">🔧</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm opacity-90">You have</p>
                  <p className="text-2xl font-bold">
                    {assignedDefectsCount} defect{assignedDefectsCount > 1 ? 's' : ''} to repair
                  </p>
                  <p className="text-xs opacity-80 mt-1">Tap to view your assigned work</p>
                </div>
              </div>
              <span className="text-2xl">›</span>
            </div>
          </button>
        )}

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
                  onClick={() => router.push(getFeatureRoute(uf.features.name))}
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

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg">
        <div className="flex justify-around items-center h-16 max-w-md mx-auto">
          <button
            onClick={() => router.push('/employee')}
            className="flex flex-col items-center gap-0.5 text-blue-600"
          >
            <span className="text-xl">🏠</span>
            <span className="text-xs font-medium">Home</span>
          </button>
          <button
            onClick={() => router.push('/employee/profile')}
            className="flex flex-col items-center gap-0.5 text-gray-400 hover:text-gray-600"
          >
            <span className="text-xl">👤</span>
            <span className="text-xs font-medium">Profile</span>
          </button>
        </div>
      </nav>
    </main>
  )
}
