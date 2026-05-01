'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
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

export default function EmployeeVehicleChecksHome() {
  const router = useRouter()
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [pendingChecks, setPendingChecks] = useState<any[]>([])
  const [openDefectsCount, setOpenDefectsCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const loadAll = useCallback(async (userId: string, companyId: string) => {
    const [pendingRes, defRes] = await Promise.all([
      // In-progress checks for THIS driver (no driver_signature yet)
      supabase
        .from('vehicle_checks')
        .select('*, vehicle:vehicles(registration, fleet_number, vehicle_type, name)')
        .eq('company_id', companyId)
        .eq('driver_id', userId)
        .is('driver_signature', null)
        .order('completed_at', { ascending: false }),
      // Open defects count company-wide (so driver knows what to look out for)
      supabase
        .from('vehicle_defects')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('status', 'open'),
    ])

    setPendingChecks(pendingRes.data || [])
    setOpenDefectsCount(defRes.count || 0)
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
      .channel('employee-vehicle-checks-home')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_checks', filter: `driver_id=eq.${currentUser.id}` }, () => {
        loadAll(currentUser.id, currentUser.company_id)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_defects', filter: `company_id=eq.${currentUser.company_id}` }, () => {
        loadAll(currentUser.id, currentUser.company_id)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [currentUser?.id, currentUser?.company_id, loadAll])

  const deleteDraft = async (checkId: string) => {
    if (!confirm('Discard this in-progress check? This cannot be undone.')) return
    await supabase.from('vehicle_checks').delete().eq('id', checkId)
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-500">Loading...</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-50 pb-32">
      <div className="bg-gradient-to-br from-red-600 to-red-800 text-white px-6 pt-10 pb-6 rounded-b-3xl shadow-lg">
        <div className="flex items-center justify-between">
          <button onClick={() => router.push('/employee')} className="text-red-100 text-sm hover:text-white">
            ← Home
          </button>
          <p className="text-red-100 text-sm">{company?.name}</p>
        </div>
        <h1 className="text-2xl font-bold mt-2">🚛 Vehicle Checks</h1>
      </div>

      <div className="px-4 pt-4 space-y-4">

        {/* Top action buttons */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => router.push('/employee/vehicle-checks/new')}
            className="bg-white hover:bg-slate-50 active:bg-slate-100 rounded-2xl shadow-sm border border-slate-100 p-5 text-center transition"
          >
            <div className="text-4xl mb-2">🆕</div>
            <p className="font-bold text-slate-800">New Check</p>
            <p className="text-xs text-slate-500 mt-0.5">Pick a vehicle</p>
          </button>
          <button
            onClick={() => router.push('/employee/vehicle-checks/defects')}
            className={`rounded-2xl shadow-sm border p-5 text-center transition relative ${
              openDefectsCount > 0
                ? 'bg-red-50 hover:bg-red-100 active:bg-red-200 border-red-200'
                : 'bg-white hover:bg-slate-50 active:bg-slate-100 border-slate-100'
            }`}
          >
            <div className="text-4xl mb-2">⚠️</div>
            <p className={`font-bold ${openDefectsCount > 0 ? 'text-red-800' : 'text-slate-800'}`}>Defects</p>
            <p className={`text-xs mt-0.5 ${openDefectsCount > 0 ? 'text-red-600' : 'text-slate-500'}`}>
              {openDefectsCount > 0 ? `${openDefectsCount} open` : 'View / report'}
            </p>
            {openDefectsCount > 0 && (
              <span className="absolute top-2 right-2 bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full min-w-[22px]">
                {openDefectsCount}
              </span>
            )}
          </button>
        </div>

        {/* Pending checks */}
        <div>
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 px-1">
            Pending Checks
          </h2>

          {pendingChecks.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 text-center">
              <p className="text-4xl mb-2">✅</p>
              <p className="text-slate-700 font-medium">All caught up</p>
              <p className="text-xs text-slate-500 mt-1">No checks in progress.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {pendingChecks.map(c => (
                <div key={c.id} className="bg-amber-50 border border-amber-200 rounded-2xl shadow-sm overflow-hidden">
                  <button
                    onClick={() => router.push(`/employee/vehicle-checks/${c.id}`)}
                    className="w-full text-left p-4 flex items-center gap-3 hover:bg-amber-100 active:bg-amber-200 transition"
                  >
                    <div className="text-3xl flex-shrink-0">
                      {VEHICLE_TYPE_ICONS[c.vehicle?.vehicle_type] || '🚗'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-mono font-bold text-slate-800">{c.vehicle?.registration}</p>
                        {c.vehicle?.fleet_number && (
                          <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
                            #{c.vehicle.fleet_number}
                          </span>
                        )}
                        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                          {VEHICLE_TYPE_LABELS[c.vehicle?.vehicle_type]}
                        </span>
                      </div>
                      {c.vehicle?.name && (
                        <p className="text-sm text-slate-600 mt-0.5">{c.vehicle.name}</p>
                      )}
                      <p className="text-xs text-amber-700 mt-1 font-medium">
                        ⏳ Started {new Date(c.completed_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} at {new Date(c.completed_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <span className="bg-amber-600 text-white text-xs font-bold px-3 py-2 rounded-full flex-shrink-0">
                      Resume
                    </span>
                  </button>
                  <div className="border-t border-amber-200 px-4 py-2 flex justify-end">
                    <button
                      onClick={() => deleteDraft(c.id)}
                      className="text-xs text-red-700 hover:underline"
                    >
                      Discard draft
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Sticky bottom: View History */}
      <div className="fixed bottom-16 left-0 right-0 bg-white border-t border-slate-200 px-4 py-3 shadow-lg">
        <button
          onClick={() => router.push('/employee/vehicle-checks/history')}
          className="w-full bg-slate-100 hover:bg-slate-200 text-slate-800 py-3 rounded-xl font-medium text-sm"
        >
          📋 View Submitted Checks & Defects
        </button>
      </div>

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 shadow-lg">
        <div className="flex justify-around items-center h-16 max-w-md mx-auto">
          <button onClick={() => router.push('/employee')} className="flex flex-col items-center gap-0.5 text-slate-400 hover:text-slate-600">
            <span className="text-xl">🏠</span>
            <span className="text-xs font-medium">Home</span>
          </button>
          <button onClick={() => router.push('/employee/profile')} className="flex flex-col items-center gap-0.5 text-slate-400 hover:text-slate-600">
            <span className="text-xl">👤</span>
            <span className="text-xs font-medium">Profile</span>
          </button>
        </div>
      </nav>
    </main>
  )
}
