'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useIdleLogout, IdleWarningModal } from '@/lib/useIdleLogout'

const supabase = createClient()

const VEHICLE_TYPE_ICONS: Record<string, string> = {
  class_1: '🚛',
  class_2: '🚚',
  bus: '🚌',
  coach: '🚍',
  minibus: '🚐',
}

export default function EmployeeDefectsPage() {
  const router = useRouter()
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [defects, setDefects] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterBy, setFilterBy] = useState<'all' | 'mine'>('all')

  const { showWarning, secondsLeft, stayLoggedIn } = useIdleLogout(true)

  const loadDefects = useCallback(async (userId: string, companyId: string) => {
    const { data } = await supabase
      .from('vehicle_defects')
      .select(`
        *,
        vehicle:vehicles (registration, fleet_number, vehicle_type, name),
        reporter:profiles!vehicle_defects_reported_by_fkey (full_name)
      `)
      .eq('company_id', companyId)
      .eq('status', 'open')
      .order('reported_at', { ascending: false })

    setDefects(data || [])
  }, [])

  const init = useCallback(async () => {
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

    if (!profile.company_id) {
      router.push('/employee')
      return
    }

    const { data: companyData } = await supabase
      .from('companies')
      .select(`*, company_features (is_enabled, features (name))`)
      .eq('id', profile.company_id)
      .single()
    setCompany(companyData)

    const companyHasFeature = companyData?.company_features?.some(
      (cf: any) => cf.is_enabled && cf.features?.name === 'Vehicle Checks'
    )
    if (!companyHasFeature) {
      router.push('/employee')
      return
    }

    const { data: userFeats } = await supabase
      .from('user_features')
      .select('is_enabled, features (name)')
      .eq('user_id', user.id)
      .eq('is_enabled', true)
    const userHasFeature = (userFeats as any[])?.some(
      (uf: any) => uf.features?.name === 'Vehicle Checks'
    )
    if (!userHasFeature) {
      router.push('/employee')
      return
    }

    await loadDefects(user.id, profile.company_id)
    setLoading(false)
  }, [router, loadDefects])

  useEffect(() => { init() }, [init])

  // Realtime
  useEffect(() => {
    if (!currentUser?.id || !currentUser?.company_id) return
    const channel = supabase
      .channel('employee-vc-defects')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_defects', filter: `company_id=eq.${currentUser.company_id}` }, () => {
        loadDefects(currentUser.id, currentUser.company_id)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [currentUser?.id, currentUser?.company_id, loadDefects])

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Loading defects...</p>
      </main>
    )
  }

  const filtered = defects
    .filter(d => filterBy === 'all' ? true : d.reported_by === currentUser?.id)
    .filter(d => {
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return d.vehicle?.registration?.toLowerCase().includes(q) ||
        d.vehicle?.fleet_number?.toLowerCase().includes(q) ||
        d.vehicle?.name?.toLowerCase().includes(q) ||
        d.item_text?.toLowerCase().includes(q) ||
        d.category?.toLowerCase().includes(q) ||
        d.defect_note?.toLowerCase().includes(q)
    })

  // Group by vehicle for display
  const grouped: Record<string, any[]> = {}
  filtered.forEach(d => {
    const key = d.vehicle_id
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(d)
  })

  return (
    <main className="min-h-screen bg-gray-50 pb-32">
      <IdleWarningModal show={showWarning} secondsLeft={secondsLeft} onStay={stayLoggedIn} />

      <div className="bg-gradient-to-br from-red-600 to-red-800 text-white px-6 pt-10 pb-6 rounded-b-3xl shadow-lg">
        <div className="flex items-center justify-between">
          <button onClick={() => router.push('/employee/vehicle-checks')} className="text-red-100 text-sm hover:text-white">
            ← Back
          </button>
          <p className="text-red-100 text-sm">{company?.name}</p>
        </div>
        <h1 className="text-2xl font-bold mt-2">⚠️ Defects</h1>
        <p className="text-red-100 text-sm mt-1">
          {defects.length} open defect{defects.length === 1 ? '' : 's'} on company vehicles
        </p>
      </div>

      <div className="px-4 pt-4 space-y-3">

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-2">
          <input
            type="text"
            placeholder="Search registration, item or note..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border-0 px-3 py-3 text-base text-gray-900 focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setFilterBy('all')}
            className={`py-2 rounded-xl text-sm font-medium transition ${
              filterBy === 'all'
                ? 'bg-red-600 text-white'
                : 'bg-white border border-gray-200 text-gray-700'
            }`}
          >
            All defects
          </button>
          <button
            onClick={() => setFilterBy('mine')}
            className={`py-2 rounded-xl text-sm font-medium transition ${
              filterBy === 'mine'
                ? 'bg-red-600 text-white'
                : 'bg-white border border-gray-200 text-gray-700'
            }`}
          >
            Reported by me
          </button>
        </div>

        {filtered.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm p-8 border border-gray-100 text-center">
            <p className="text-5xl mb-3">✅</p>
            <p className="text-gray-700 font-medium">No open defects</p>
            <p className="text-xs text-gray-500 mt-1">
              {defects.length === 0 ? 'All vehicles are good to go' : 'No defects match your filters'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {Object.entries(grouped).map(([vehicleId, list]) => {
              const v = list[0]?.vehicle
              return (
                <div key={vehicleId} className="bg-white rounded-2xl shadow-sm border border-red-200 overflow-hidden">
                  <div className="bg-red-50 px-4 py-3 border-b border-red-200">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-2xl">{VEHICLE_TYPE_ICONS[v?.vehicle_type] || '🚗'}</span>
                      <p className="font-mono font-bold text-gray-800">{v?.registration}</p>
                      {v?.fleet_number && (
                        <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
                          #{v.fleet_number}
                        </span>
                      )}
                      <span className="text-xs bg-red-200 text-red-800 px-2 py-0.5 rounded-full font-medium">
                        {list.length} defect{list.length > 1 ? 's' : ''}
                      </span>
                    </div>
                    {v?.name && (
                      <p className="text-xs text-gray-600 mt-0.5">{v.name}</p>
                    )}
                  </div>
                  <ul className="divide-y divide-gray-100">
                    {list.map(d => (
                      <li key={d.id} className="p-3">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{d.category}</p>
                        <p className="text-sm font-medium text-gray-800">{d.item_text}</p>
                        {d.defect_note && (
                          <div className="mt-2 bg-red-50 border border-red-200 rounded-lg p-2">
                            <p className="text-xs text-red-800 leading-snug whitespace-pre-wrap">{d.defect_note}</p>
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-2 text-xs text-gray-500 flex-wrap">
                          <span>Reported by {d.reporter?.full_name || 'Unknown'}</span>
                          <span>·</span>
                          <span>{new Date(d.reported_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        )}

      </div>

      {/* Sticky bottom: Report a defect */}
      <div className="fixed bottom-16 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 shadow-lg">
        <button
          onClick={() => router.push('/employee/vehicle-checks/defects/new')}
          className="w-full bg-red-600 hover:bg-red-700 text-white py-3 rounded-xl font-bold text-sm"
        >
          + Report Defect
        </button>
      </div>

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg">
        <div className="flex justify-around items-center h-16 max-w-md mx-auto">
          <button onClick={() => router.push('/employee')} className="flex flex-col items-center gap-0.5 text-gray-400 hover:text-gray-600">
            <span className="text-xl">🏠</span>
            <span className="text-xs font-medium">Home</span>
          </button>
          <button onClick={() => router.push('/employee/profile')} className="flex flex-col items-center gap-0.5 text-gray-400 hover:text-gray-600">
            <span className="text-xl">👤</span>
            <span className="text-xs font-medium">Profile</span>
          </button>
        </div>
      </nav>
    </main>
  )
}
