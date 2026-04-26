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

const VEHICLE_TYPE_LABELS: Record<string, string> = {
  class_1: 'Class 1',
  class_2: 'Class 2',
  bus: 'Bus',
  coach: 'Coach',
  minibus: 'Minibus',
}

type Tab = 'checks' | 'defects'

export default function EmployeeHistoryPage() {
  const router = useRouter()
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [submittedChecks, setSubmittedChecks] = useState<any[]>([])
  const [allDefects, setAllDefects] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('checks')
  const [search, setSearch] = useState('')
  const [defectStatusFilter, setDefectStatusFilter] = useState<'all' | 'open' | 'fixed' | 'dismissed'>('all')

  const { showWarning, secondsLeft, stayLoggedIn } = useIdleLogout(true)

  const loadAll = useCallback(async (userId: string, companyId: string) => {
    const [checksRes, defectsRes] = await Promise.all([
      // Submitted checks (driver_signature is set) for this driver only
      supabase
        .from('vehicle_checks')
        .select('*, vehicle:vehicles(registration, fleet_number, vehicle_type, name)')
        .eq('company_id', companyId)
        .eq('driver_id', userId)
        .not('driver_signature', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(100),
      // All defects on company vehicles (history view sees everything)
      supabase
        .from('vehicle_defects')
        .select(`
          *,
          vehicle:vehicles (registration, fleet_number, vehicle_type, name),
          reporter:profiles!vehicle_defects_reported_by_fkey (full_name)
        `)
        .eq('company_id', companyId)
        .order('reported_at', { ascending: false })
        .limit(200),
    ])

    setSubmittedChecks(checksRes.data || [])
    setAllDefects(defectsRes.data || [])
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

    await loadAll(user.id, profile.company_id)
    setLoading(false)
  }, [router, loadAll])

  useEffect(() => { init() }, [init])

  // Realtime
  useEffect(() => {
    if (!currentUser?.id || !currentUser?.company_id) return
    const channel = supabase
      .channel('employee-vc-history')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_checks', filter: `driver_id=eq.${currentUser.id}` }, () => {
        loadAll(currentUser.id, currentUser.company_id)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_defects', filter: `company_id=eq.${currentUser.company_id}` }, () => {
        loadAll(currentUser.id, currentUser.company_id)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [currentUser?.id, currentUser?.company_id, loadAll])

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Loading history...</p>
      </main>
    )
  }

  const filteredChecks = submittedChecks.filter(c => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return c.vehicle?.registration?.toLowerCase().includes(q) ||
      c.vehicle?.fleet_number?.toLowerCase().includes(q) ||
      c.vehicle?.name?.toLowerCase().includes(q)
  })

  const filteredDefects = allDefects
    .filter(d => defectStatusFilter === 'all' ? true : d.status === defectStatusFilter)
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

  const checksCount = submittedChecks.length
  const defectsCount = allDefects.length
  const openDefectsCount = allDefects.filter(d => d.status === 'open').length

  return (
    <main className="min-h-screen bg-gray-50 pb-24">
      <IdleWarningModal show={showWarning} secondsLeft={secondsLeft} onStay={stayLoggedIn} />

      <div className="bg-gradient-to-br from-red-600 to-red-800 text-white px-6 pt-10 pb-6 rounded-b-3xl shadow-lg">
        <div className="flex items-center justify-between">
          <button onClick={() => router.push('/employee/vehicle-checks')} className="text-red-100 text-sm hover:text-white">
            ← Back
          </button>
          <p className="text-red-100 text-sm">{company?.name}</p>
        </div>
        <h1 className="text-2xl font-bold mt-2">📋 History</h1>
        <p className="text-red-100 text-sm mt-1">Past checks and defects</p>
      </div>

      <div className="px-4 pt-4 space-y-3">

        {/* Tabs */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-1.5 flex gap-1">
          <button
            onClick={() => setActiveTab('checks')}
            className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${
              activeTab === 'checks'
                ? 'bg-red-600 text-white'
                : 'bg-transparent text-gray-700 hover:bg-gray-50'
            }`}
          >
            ✅ My Checks ({checksCount})
          </button>
          <button
            onClick={() => setActiveTab('defects')}
            className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${
              activeTab === 'defects'
                ? 'bg-red-600 text-white'
                : 'bg-transparent text-gray-700 hover:bg-gray-50'
            }`}
          >
            ⚠️ Defects ({defectsCount})
          </button>
        </div>

        {/* Search */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-2">
          <input
            type="text"
            placeholder={activeTab === 'checks' ? 'Search registration...' : 'Search reg, item or note...'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border-0 px-3 py-3 text-base text-gray-900 focus:outline-none"
          />
        </div>

        {/* Defect status filters */}
        {activeTab === 'defects' && (
          <div className="grid grid-cols-4 gap-1.5">
            {(['all', 'open', 'fixed', 'dismissed'] as const).map(s => (
              <button
                key={s}
                onClick={() => setDefectStatusFilter(s)}
                className={`py-2 rounded-lg text-xs font-medium transition capitalize ${
                  defectStatusFilter === s
                    ? 'bg-gray-800 text-white'
                    : 'bg-white border border-gray-200 text-gray-700'
                }`}
              >
                {s === 'all' ? `All (${defectsCount})` : s === 'open' ? `Open (${openDefectsCount})` : s}
              </button>
            ))}
          </div>
        )}

        {/* Tab content */}
        {activeTab === 'checks' ? (
          filteredChecks.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-sm p-8 border border-gray-100 text-center">
              <p className="text-5xl mb-3">📋</p>
              <p className="text-gray-700 font-medium">No submitted checks yet</p>
              <p className="text-xs text-gray-500 mt-1">
                {submittedChecks.length === 0 ? 'Your completed walk-round checks will appear here' : 'No matches'}
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-100 overflow-hidden">
              {filteredChecks.map(c => (
                <button
                  key={c.id}
                  onClick={() => router.push(`/employee/vehicle-checks/${c.id}`)}
                  className="w-full text-left p-4 flex items-center gap-3 hover:bg-gray-50 active:bg-gray-100 transition"
                >
                  <span className="text-3xl flex-shrink-0">{VEHICLE_TYPE_ICONS[c.vehicle?.vehicle_type] || '🚗'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-mono font-bold text-gray-800">{c.vehicle?.registration}</p>
                      {c.vehicle?.fleet_number && (
                        <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
                          #{c.vehicle.fleet_number}
                        </span>
                      )}
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                        {VEHICLE_TYPE_LABELS[c.vehicle?.vehicle_type]}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {new Date(c.check_date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
                      {' · '}
                      {new Date(c.completed_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {c.has_defects ? (
                        <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
                          ⚠️ Defects logged
                        </span>
                      ) : (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                          ✓ All passed
                        </span>
                      )}
                      {c.mileage != null && (
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                          {c.mileage.toLocaleString()} mi
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-gray-400 text-sm flex-shrink-0">›</span>
                </button>
              ))}
            </div>
          )
        ) : (
          filteredDefects.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-sm p-8 border border-gray-100 text-center">
              <p className="text-5xl mb-3">✅</p>
              <p className="text-gray-700 font-medium">No defects found</p>
              <p className="text-xs text-gray-500 mt-1">
                {allDefects.length === 0 ? 'Vehicle defects will appear here' : 'No matches'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredDefects.map(d => {
                const v = d.vehicle
                const statusColors: Record<string, string> = {
                  open: 'bg-red-100 text-red-700 border-red-200',
                  fixed: 'bg-green-100 text-green-700 border-green-200',
                  dismissed: 'bg-gray-100 text-gray-600 border-gray-200',
                }
                return (
                  <div
                    key={d.id}
                    className={`bg-white rounded-2xl shadow-sm border p-3 ${
                      d.status === 'open' ? 'border-red-200' : 'border-gray-100'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-2xl flex-shrink-0">{VEHICLE_TYPE_ICONS[v?.vehicle_type] || '🚗'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-mono font-bold text-gray-800 text-sm">{v?.registration}</p>
                          {v?.fleet_number && (
                            <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
                              #{v.fleet_number}
                            </span>
                          )}
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium border capitalize ${statusColors[d.status] || 'bg-gray-100 text-gray-600'}`}>
                            {d.status}
                          </span>
                        </div>
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-2">{d.category}</p>
                        <p className="text-sm font-medium text-gray-800">{d.item_text}</p>
                        {d.defect_note && (
                          <div className="mt-1.5 bg-gray-50 border border-gray-200 rounded-lg p-2">
                            <p className="text-xs text-gray-700 leading-snug whitespace-pre-wrap">{d.defect_note}</p>
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-2 text-xs text-gray-500 flex-wrap">
                          <span>By {d.reporter?.full_name || 'Unknown'}</span>
                          <span>·</span>
                          <span>{new Date(d.reported_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
                          {d.resolved_at && (
                            <>
                              <span>·</span>
                              <span>Resolved {new Date(d.resolved_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        )}

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
