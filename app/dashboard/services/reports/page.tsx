'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
const supabase = createClient()

const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function ServicesReportsHubPage() {
  const router = useRouter()
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    totalVehicles: 0,
    overdueCount: 0,
    dueWithin14: 0,
    completedThisMonth: 0,
  })

  const init = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: profile } = await supabase
      .from('profiles').select('*').eq('id', user.id).single()
    if (!profile) { router.push('/login'); return }
    setCurrentUser(profile)

    if (!profile.company_id) { router.push('/dashboard'); return }
    if (profile.role !== 'admin' && profile.role !== 'manager' && profile.role !== 'superuser') {
      router.push('/dashboard'); return
    }

    const { data: companyData } = await supabase
      .from('companies').select('*, company_features (is_enabled, features (name))').eq('id', profile.company_id).single()
    setCompany(companyData)

    const hasFeature = companyData?.company_features?.some(
      (cf: any) => cf.is_enabled && (cf.features?.name === 'Services & Defects' || cf.features?.name === 'Services & MOT')
    )
    if (!hasFeature) { router.push('/dashboard'); return }

    // Quick stats for the hub
    const today = new Date(); today.setHours(0,0,0,0)
    const todayIso = isoDate(today)
    const in14 = isoDate(new Date(today.getTime() + 14*24*60*60*1000))
    const monthStart = isoDate(new Date(today.getFullYear(), today.getMonth(), 1))

    const [vehRes, recRes] = await Promise.all([
      supabase.from('vehicles').select('id, mot_expiry_date, next_service_due, tacho_calibration_date, tax_due_date, loler_due_date, active').eq('company_id', profile.company_id).eq('active', true),
      supabase.from('service_records').select('id, performed_date').eq('company_id', profile.company_id).gte('performed_date', monthStart),
    ])

    const vehicles = vehRes.data || []
    const records = recRes.data || []

    let overdue = 0
    let dueWithin14 = 0
    vehicles.forEach((v: any) => {
      const dates = [v.mot_expiry_date, v.next_service_due, v.tacho_calibration_date, v.tax_due_date, v.loler_due_date].filter(Boolean)
      let isOverdue = false, isDueSoon = false
      dates.forEach((d: string) => {
        if (d < todayIso) isOverdue = true
        else if (d <= in14) isDueSoon = true
      })
      if (isOverdue) overdue++
      else if (isDueSoon) dueWithin14++
    })

    setStats({
      totalVehicles: vehicles.length,
      overdueCount: overdue,
      dueWithin14,
      completedThisMonth: records.length,
    })

    setLoading(false)
  }, [router])

  useEffect(() => { init() }, [init])

  if (loading) {
    return (
      <div className="p-8 text-slate-400 italic">Loading…</div>
    )
  }

  return (
    <div className="p-8 max-w-5xl">

      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 mb-1">Service Reports</h1>
          <p className="text-sm text-slate-500">{company?.name}</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => router.push('/dashboard/services/calendar')}
            className="text-sm text-slate-600 hover:text-slate-800"
          >
            📅 Calendar
          </button>
          <button
            onClick={() => router.push('/dashboard')}
            className="text-sm text-slate-600 hover:text-slate-800"
          >
            ← Back to Dashboard
          </button>
        </div>
      </div>

      <div className="space-y-6">

        {/* Top-line stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 text-center">
            <p className="text-3xl font-bold text-blue-600">{stats.totalVehicles}</p>
            <p className="text-xs text-slate-500 mt-1">Active vehicles</p>
          </div>
          <div className={`rounded-xl shadow p-4 text-center ${stats.overdueCount > 0 ? 'bg-red-50 border-2 border-red-300' : 'bg-white'}`}>
            <p className={`text-3xl font-bold ${stats.overdueCount > 0 ? 'text-red-700' : 'text-green-600'}`}>{stats.overdueCount}</p>
            <p className="text-xs text-slate-500 mt-1">Overdue</p>
          </div>
          <div className={`rounded-xl shadow p-4 text-center ${stats.dueWithin14 > 0 ? 'bg-amber-50 border-2 border-amber-300' : 'bg-white'}`}>
            <p className={`text-3xl font-bold ${stats.dueWithin14 > 0 ? 'text-amber-700' : 'text-slate-400'}`}>{stats.dueWithin14}</p>
            <p className="text-xs text-slate-500 mt-1">Due in 14 days</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 text-center">
            <p className="text-3xl font-bold text-purple-600">{stats.completedThisMonth}</p>
            <p className="text-xs text-slate-500 mt-1">Completed this month</p>
          </div>
        </div>

        {/* Report tiles */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          <button onClick={() => router.push('/dashboard/services/reports/compliance')}
            className="bg-white hover:bg-slate-50 border border-slate-200 rounded-xl p-6 text-left transition shadow-sm hover:shadow-md">
            <div className="flex items-start gap-4">
              <div className="text-4xl">📊</div>
              <div className="flex-1">
                <h3 className="font-semibold text-slate-800 text-lg">Fleet Compliance</h3>
                <p className="text-sm text-slate-600 mt-1">
                  Visual snapshot of every vehicle's compliance status. Identify overdue items at a glance.
                </p>
                <p className="text-xs text-blue-600 mt-2 font-medium">View report →</p>
              </div>
            </div>
          </button>

          <button onClick={() => router.push('/dashboard/services/reports/upcoming')}
            className="bg-white hover:bg-slate-50 border border-slate-200 rounded-xl p-6 text-left transition shadow-sm hover:shadow-md">
            <div className="flex items-start gap-4">
              <div className="text-4xl">⚠️</div>
              <div className="flex-1">
                <h3 className="font-semibold text-slate-800 text-lg">Overdue & Upcoming</h3>
                <p className="text-sm text-slate-600 mt-1">
                  Sortable list of all compliance items due soon. One-click scheduling. PDF for the depot.
                </p>
                <p className="text-xs text-blue-600 mt-2 font-medium">View report →</p>
              </div>
            </div>
          </button>

          <button onClick={() => router.push('/dashboard/services/reports/history')}
            className="bg-white hover:bg-slate-50 border border-slate-200 rounded-xl p-6 text-left transition shadow-sm hover:shadow-md md:col-span-2">
            <div className="flex items-start gap-4">
              <div className="text-4xl">📜</div>
              <div className="flex-1">
                <h3 className="font-semibold text-slate-800 text-lg">Vehicle Service History</h3>
                <p className="text-sm text-slate-600 mt-1">
                  Pick a vehicle to see its full service log. Required for OCRS audits and operator compliance.
                </p>
                <p className="text-xs text-blue-600 mt-2 font-medium">View report →</p>
              </div>
            </div>
          </button>

        </div>

      </div>
    </div>
  )
}
