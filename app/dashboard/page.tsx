'use client'

/**
 * /dashboard — admin & manager landing page.
 *
 * Now slimmed down — Quick Actions removed in favour of sidebar
 * navigation. Just shows:
 *   • Welcome heading with company name
 *   • Subscription expiry warning (if effective end date <= 14 days away)
 *   • 3 stat cards: Total / Active / Frozen
 *   • Manager-only callout if no job titles assigned
 *
 * As features get added (Holidays, Vehicles etc), warning banners and
 * counters can come back here. Navigation stays in the sidebar.
 */

import { useEffect, useState, useCallback } from 'react'
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh'

type Stats = {
  company: {
    id: string
    name: string
    is_active: boolean
    start_date: string | null
    end_date: string | null
    override_end_date: string | null
    subscription_length: string | null
  } | null
  totalUsers: number
  activeUsers: number
  frozenUsers: number
  managerTitles: string[]
  // At-a-glance panels — the API tells us per-panel whether to render.
  showHolidays?: boolean
  holidaysPendingCount?: number | null
  showDefects?: boolean
  defectsOpenCount?: number | null
  recentDefects?: Array<{
    id: string
    severity: string | null
    description: string | null
    item_text: string | null
    defect_note: string | null
    reported_at: string
    vehicle: {
      id: string
      registration: string
      fleet_number: string | null
      vehicle_type: string | null
    } | null
  }>
  showServices?: boolean
  nextServices?: Array<{
    id: string
    kind: 'scheduled' | 'compliance'
    service_type: string
    status: string | null
    date: string         // ISO yyyy-mm-dd, for sorting / overdue detection
    dateLabel: string    // pre-formatted (handles "WC ..." for week-commencing)
    vehicle: {
      id: string
      registration: string
      fleet_number: string | null
      vehicle_type: string | null
    } | null
  }>
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [me, setMe] = useState<{ full_name: string | null; role: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch('/api/get-dashboard-stats')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      setStats(data)
      setError('')
    } catch (e: any) {
      setError(e?.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadStats() }, [loadStats])

  // Realtime: refetch the dashboard stats when relevant tables change.
  useRealtimeRefresh(
    'dashboard-home',
    [
      { table: 'profiles',          companyId: stats?.company?.id || null },
      { table: 'companies',         companyId: null },
      { table: 'company_features',  companyId: stats?.company?.id || null },
      { table: 'holiday_requests',  companyId: stats?.company?.id || null },
      { table: 'schedules',         companyId: stats?.company?.id || null },
      { table: 'vehicle_defects',     companyId: stats?.company?.id || null },
      { table: 'service_schedules',   companyId: stats?.company?.id || null },
      { table: 'vehicles',            companyId: stats?.company?.id || null },
    ],
    loadStats,
    !!stats?.company?.id,
  )

  useEffect(() => {
    let cancelled = false
    const loadMe = async () => {
      try {
        const { createClient } = await import('@/lib/supabase')
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user || cancelled) return
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, role')
          .eq('id', user.id)
          .single()
        if (!cancelled && profile) {
          setMe({ full_name: profile.full_name, role: profile.role })
        }
      } catch { /* ignore */ }
    }
    loadMe()
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return <div className="p-8 text-slate-400 italic">Loading dashboard…</div>
  }
  if (error || !stats) {
    return (
      <div className="p-8 max-w-3xl">
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg">
          {error || 'Unable to load dashboard'}
        </div>
      </div>
    )
  }

  const isAdmin   = me?.role === 'admin'
  const isManager = me?.role === 'manager'

  let daysRemaining: number | null = null
  let effectiveEnd: string | null = null
  if (stats.company) {
    effectiveEnd = stats.company.override_end_date || stats.company.end_date
    if (effectiveEnd) {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const end = new Date(effectiveEnd)
      end.setHours(0, 0, 0, 0)
      daysRemaining = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    }
  }

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-2xl font-bold text-slate-900">
        {stats.company?.name || 'Dashboard'}
      </h1>
      <p className="text-sm text-slate-500 mt-1">
        Welcome back{me?.full_name ? `, ${me.full_name}` : ''}.
      </p>

      {daysRemaining !== null && daysRemaining <= 14 && daysRemaining >= 0 && (
        <div className="mt-6 bg-yellow-50 border border-yellow-300 rounded-xl p-4 text-sm">
          <p className="text-yellow-800 font-medium">
            ⚠️ Your subscription expires in {daysRemaining} day{daysRemaining === 1 ? '' : 's'}
            {effectiveEnd ? ` (${new Date(effectiveEnd).toLocaleDateString('en-GB')})` : ''}.
          </p>
          <p className="text-xs text-yellow-700 mt-1">
            Contact us to renew before access is suspended.
          </p>
        </div>
      )}

      {/* Two compact glance tiles — Holidays pending + Open defects.
          Each gates on the respective feature so a company without
          either still gets a clean dashboard. */}
      {(stats.showHolidays || stats.showDefects) && (
        <div className="mt-6 grid grid-cols-2 gap-3 max-w-md">
          {stats.showHolidays && (
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 px-3 py-2.5 flex items-baseline gap-2">
              <span className="text-xl font-bold text-amber-600 tabular-nums">{stats.holidaysPendingCount ?? 0}</span>
              <span className="text-xs text-slate-500">Holidays pending</span>
            </div>
          )}
          {stats.showDefects && (
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 px-3 py-2.5 flex items-baseline gap-2">
              <span className="text-xl font-bold text-red-600 tabular-nums">{stats.defectsOpenCount ?? 0}</span>
              <span className="text-xs text-slate-500">Open defects</span>
            </div>
          )}
        </div>
      )}

      {/* Recent open defects (5 newest) */}
      {stats.showDefects && (stats.recentDefects?.length ?? 0) > 0 && (
        <div className="mt-4 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">Recent open defects</h2>
            <span className="text-xs text-slate-400">5 newest</span>
          </div>
          <ul className="divide-y divide-slate-100">
            {(stats.recentDefects || []).map(d => {
              const sevColor =
                d.severity === 'critical' ? 'bg-red-100 text-red-800 border-red-300' :
                d.severity === 'major'    ? 'bg-orange-100 text-orange-800 border-orange-300' :
                                            'bg-amber-50 text-amber-700 border-amber-200'
              const detail = d.defect_note || d.description || d.item_text || '—'
              return (
                <li key={d.id} className="px-4 py-3 flex items-start gap-3">
                  <span className={`text-[10px] uppercase px-2 py-0.5 rounded border flex-shrink-0 ${sevColor}`}>
                    {d.severity || 'minor'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-sm font-bold text-slate-800">
                      {d.vehicle?.registration || '?'}
                      {d.vehicle?.fleet_number && (
                        <span className="ml-2 text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-sans">
                          #{d.vehicle.fleet_number}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-700 mt-0.5 truncate">{detail}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {new Date(d.reported_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Next 5 scheduled services */}
      {stats.showServices && (stats.nextServices?.length ?? 0) > 0 && (
        <div className="mt-4 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">Next services &amp; compliance</h2>
            <span className="text-xs text-slate-400">up to 5</span>
          </div>
          <ul className="divide-y divide-slate-100">
            {(stats.nextServices || []).map(s => {
              const typeLabel =
                s.service_type === 'service'             ? 'Service' :
                s.service_type === 'mot'                 ? 'MOT' :
                s.service_type === 'mot_prep'            ? 'MOT prep' :
                s.service_type === 'inspection'          ? 'Inspection' :
                s.service_type === 'safety_inspection'   ? 'Safety inspection' :
                s.service_type === 'tacho_calibration'   ? 'Tacho' :
                s.service_type === 'lift_inspection'     ? 'Lift inspection' :
                s.service_type === 'loler_inspection'    ? 'LOLER' :
                s.service_type === 'tax'                 ? 'Tax' :
                s.service_type === 'custom'              ? 'Other' :
                                                           (s.service_type || '—')
              const isInProgress = s.status === 'in_progress'
              // Overdue if the date is strictly before today (string compare
              // works because dates are ISO yyyy-mm-dd).
              const todayIso = new Date().toISOString().slice(0, 10)
              const isOverdue = s.date < todayIso
              return (
                <li key={s.id} className="px-4 py-3 flex items-start gap-3">
                  <span className="text-[10px] uppercase px-2 py-0.5 rounded border flex-shrink-0 bg-slate-100 text-slate-700 border-slate-300">
                    {typeLabel}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-sm font-bold text-slate-800">
                      {s.vehicle?.registration || '?'}
                      {s.vehicle?.fleet_number && (
                        <span className="ml-2 text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-sans">
                          #{s.vehicle.fleet_number}
                        </span>
                      )}
                      {isInProgress && (
                        <span className="ml-2 text-[10px] uppercase px-2 py-0.5 rounded border bg-blue-100 text-blue-700 border-blue-300 font-sans">
                          in progress
                        </span>
                      )}
                      {isOverdue && (
                        <span className="ml-2 text-[10px] uppercase px-2 py-0.5 rounded border bg-red-100 text-red-700 border-red-300 font-sans">
                          overdue
                        </span>
                      )}
                      {s.kind === 'compliance' && !isOverdue && !isInProgress && (
                        <span className="ml-2 text-[10px] uppercase px-2 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200 font-sans">
                          due
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">{s.dateLabel}</p>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {isManager && stats.managerTitles.length === 0 && (
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
          You haven&apos;t been assigned any job titles to manage yet. Ask your admin to set this on your user record.
        </div>
      )}
    </div>
  )
}
