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

const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function EmployeeVehicleChecksHome() {
  const router = useRouter()
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [vehicles, setVehicles] = useState<any[]>([])
  const [openDefectsByVehicle, setOpenDefectsByVehicle] = useState<Record<string, number>>({})
  const [todaysChecks, setTodaysChecks] = useState<any[]>([])
  const [recentChecks, setRecentChecks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  const { showWarning, secondsLeft, stayLoggedIn } = useIdleLogout(true)

  const todayIso = isoDate(new Date())

  const loadAll = useCallback(async (userId: string, companyId: string) => {
    const [vehRes, defRes, todayRes, recentRes] = await Promise.all([
      supabase
        .from('vehicles')
        .select('*')
        .eq('company_id', companyId)
        .eq('active', true)
        .order('registration', { ascending: true }),
      supabase
        .from('vehicle_defects')
        .select('id, vehicle_id, status')
        .eq('company_id', companyId)
        .eq('status', 'open'),
      supabase
        .from('vehicle_checks')
        .select('*, vehicle:vehicles(registration, fleet_number, vehicle_type)')
        .eq('company_id', companyId)
        .eq('driver_id', userId)
        .eq('check_date', todayIso)
        .order('completed_at', { ascending: false }),
      supabase
        .from('vehicle_checks')
        .select('*, vehicle:vehicles(registration, fleet_number, vehicle_type)')
        .eq('company_id', companyId)
        .eq('driver_id', userId)
        .order('completed_at', { ascending: false })
        .limit(10),
    ])

    setVehicles(vehRes.data || [])

    const counts: Record<string, number> = {}
    ;(defRes.data || []).forEach((d: any) => {
      counts[d.vehicle_id] = (counts[d.vehicle_id] || 0) + 1
    })
    setOpenDefectsByVehicle(counts)

    setTodaysChecks(todayRes.data || [])
    setRecentChecks(recentRes.data || [])
  }, [todayIso])

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles', filter: `company_id=eq.${currentUser.company_id}` }, () => {
        loadAll(currentUser.id, currentUser.company_id)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_defects', filter: `company_id=eq.${currentUser.company_id}` }, () => {
        loadAll(currentUser.id, currentUser.company_id)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_checks', filter: `driver_id=eq.${currentUser.id}` }, () => {
        loadAll(currentUser.id, currentUser.company_id)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [currentUser?.id, currentUser?.company_id, loadAll])

  const startNewCheck = async (vehicle: any) => {
    if (creating) return
    setCreating(vehicle.id)
    setMessage('')

    // Create the check row, then load template items into vehicle_check_items
    const { data: check, error: checkErr } = await supabase
      .from('vehicle_checks')
      .insert({
        company_id: currentUser.company_id,
        vehicle_id: vehicle.id,
        driver_id: currentUser.id,
        check_date: todayIso,
        has_defects: false,
      })
      .select()
      .single()

    if (checkErr || !check) {
      setMessage('Could not start check: ' + (checkErr?.message || 'unknown error'))
      setCreating(null)
      return
    }

    // Find the template for this vehicle type
    const { data: template } = await supabase
      .from('vehicle_check_templates')
      .select('id')
      .eq('company_id', currentUser.company_id)
      .eq('vehicle_type', vehicle.vehicle_type)
      .maybeSingle()

    if (template) {
      const { data: items } = await supabase
        .from('vehicle_check_template_items')
        .select('*')
        .eq('template_id', template.id)
        .order('display_order', { ascending: true })

      if (items && items.length > 0) {
        // Pre-fill check items as 'pass' so driver only changes failures (faster default)
        // Actually: default to no result, force driver to mark each
        // We'll insert with result='pass' as starting state, but driver must touch them
        // Simpler: insert all as pass, driver toggles to fail/na as needed
        await supabase.from('vehicle_check_items').insert(
          items.map((it: any) => ({
            check_id: check.id,
            template_item_id: it.id,
            category: it.category,
            item_text: it.item_text,
            result: 'pass',
            display_order: it.display_order,
          }))
        )
      }
    }

    setCreating(null)
    router.push(`/employee/vehicle-checks/${check.id}`)
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Loading...</p>
      </main>
    )
  }

  const filtered = vehicles.filter(v => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return v.registration.toLowerCase().includes(q) ||
      (v.fleet_number || '').toLowerCase().includes(q) ||
      (v.name || '').toLowerCase().includes(q)
  })

  return (
    <main className="min-h-screen bg-gray-50 pb-24">
      <IdleWarningModal show={showWarning} secondsLeft={secondsLeft} onStay={stayLoggedIn} />

      <div className="bg-gradient-to-br from-red-600 to-red-800 text-white px-6 pt-10 pb-6 rounded-b-3xl shadow-lg">
        <div className="flex items-center justify-between">
          <button onClick={() => router.push('/employee')} className="text-red-100 text-sm hover:text-white">
            ← Home
          </button>
          <p className="text-red-100 text-sm">{company?.name}</p>
        </div>
        <h1 className="text-2xl font-bold mt-2">🚛 Vehicle Check</h1>
        <p className="text-red-100 text-sm mt-1">Pick a vehicle to start your walk-round</p>
      </div>

      <div className="px-4 pt-4 space-y-3">

        {message && (
          <div className="bg-red-100 border border-red-300 text-red-700 p-3 rounded-xl text-sm">
            {message}
          </div>
        )}

        {todaysChecks.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Today's checks</p>
            <ul className="space-y-2">
              {todaysChecks.map(c => (
                <li key={c.id}>
                  <button
                    onClick={() => router.push(`/employee/vehicle-checks/${c.id}`)}
                    className="w-full text-left flex items-center gap-3 bg-green-50 hover:bg-green-100 active:bg-green-200 border border-green-200 rounded-lg px-3 py-2 transition"
                  >
                    <span className="text-2xl">{VEHICLE_TYPE_ICONS[c.vehicle?.vehicle_type] || '🚗'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-mono font-bold text-gray-800 text-sm">{c.vehicle?.registration}</p>
                      <p className="text-xs text-gray-600">
                        {c.has_defects ? '⚠️ With defects' : '✅ All passed'} · {new Date(c.completed_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <span className="text-green-600 text-sm">›</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-2">
          <input
            type="text"
            placeholder="Search registration or fleet number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border-0 px-3 py-2 text-sm text-gray-900 focus:outline-none"
          />
        </div>

        {filtered.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm p-8 border border-gray-100 text-center">
            <p className="text-5xl mb-3">🚛</p>
            <p className="text-gray-500 text-sm">
              {vehicles.length === 0 ? 'No vehicles available yet' : 'No vehicles match your search'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(v => {
              const openDefects = openDefectsByVehicle[v.id] || 0
              const checkedToday = todaysChecks.some(c => c.vehicle_id === v.id)
              return (
                <button
                  key={v.id}
                  onClick={() => startNewCheck(v)}
                  disabled={creating === v.id}
                  className={`w-full text-left bg-white hover:bg-gray-50 active:bg-gray-100 rounded-2xl shadow-sm border p-4 transition disabled:opacity-50 ${
                    openDefects > 0 ? 'border-red-300' : 'border-gray-100'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="text-3xl flex-shrink-0">
                      {VEHICLE_TYPE_ICONS[v.vehicle_type] || '🚗'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-mono font-bold text-gray-800">{v.registration}</p>
                        {v.fleet_number && (
                          <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
                            #{v.fleet_number}
                          </span>
                        )}
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                          {VEHICLE_TYPE_LABELS[v.vehicle_type]}
                        </span>
                      </div>
                      {v.name && (
                        <p className="text-sm text-gray-600 mt-0.5">{v.name}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {openDefects > 0 && (
                          <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
                            ⚠️ {openDefects} open defect{openDefects > 1 ? 's' : ''}
                          </span>
                        )}
                        {checkedToday && (
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                            ✓ Checked today
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex-shrink-0 self-center">
                      {creating === v.id ? (
                        <span className="text-sm text-gray-400">Starting...</span>
                      ) : (
                        <span className="bg-red-600 text-white text-xs font-bold px-3 py-2 rounded-full">
                          {checkedToday ? 'Re-check' : 'Start Check'}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {recentChecks.length > 0 && (
          <div className="pt-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 px-1">Your recent checks</p>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-100">
              {recentChecks.slice(0, 5).map(c => (
                <button
                  key={c.id}
                  onClick={() => router.push(`/employee/vehicle-checks/${c.id}`)}
                  className="w-full text-left p-3 flex items-center gap-3 hover:bg-gray-50 active:bg-gray-100 transition"
                >
                  <span className="text-2xl flex-shrink-0">{VEHICLE_TYPE_ICONS[c.vehicle?.vehicle_type] || '🚗'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-mono font-bold text-gray-800 text-sm">{c.vehicle?.registration}</p>
                    <p className="text-xs text-gray-500">
                      {new Date(c.check_date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })}
                      {c.has_defects ? ' · ⚠️ defects' : ' · ✅ all passed'}
                    </p>
                  </div>
                  <span className="text-gray-400 text-sm">›</span>
                </button>
              ))}
            </div>
          </div>
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