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

import { useEffect, useState } from 'react'

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
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [me, setMe] = useState<{ full_name: string | null; role: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/get-dashboard-stats')
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to load')
        if (cancelled) return
        setStats(data)
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

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

      <div className="grid grid-cols-3 gap-4 mt-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 text-center">
          <p className="text-2xl font-bold text-slate-800">{stats.totalUsers}</p>
          <p className="text-xs text-slate-500 mt-1">
            {isAdmin ? 'Total Users' : 'Your Team'}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 text-center">
          <p className="text-2xl font-bold text-green-600">{stats.activeUsers}</p>
          <p className="text-xs text-slate-500 mt-1">Active</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 text-center">
          <p className="text-2xl font-bold text-orange-500">{stats.frozenUsers}</p>
          <p className="text-xs text-slate-500 mt-1">Frozen</p>
        </div>
      </div>

      {isManager && stats.managerTitles.length === 0 && (
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
          You haven&apos;t been assigned any job titles to manage yet. Ask your admin to set this on your user record.
        </div>
      )}
    </div>
  )
}
