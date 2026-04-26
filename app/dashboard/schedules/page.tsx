'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useIdleLogout, IdleWarningModal } from '@/lib/useIdleLogout'

const supabase = createClient()

const DAY_LABELS: Record<string, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
}

const todayISO = () => {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const isCompleted = (s: any) => {
  if (s.completed_at) return true
  if (s.schedule_type === 'one_off' && s.end_date) {
    const today = todayISO()
    if (s.end_date < today) return true
    if (s.end_date === today && s.end_time) {
      const now = new Date()
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
      if (s.end_time < currentTime) return true
    }
  }
  return false
}

export default function SchedulesPage() {
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [schedules, setSchedules] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showInactive, setShowInactive] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'one_off' | 'recurring'>('all')
  const [tick, setTick] = useState(0)
  const router = useRouter()
  const { showWarning, secondsLeft, stayLoggedIn } = useIdleLogout(true)

  const fetchData = useCallback(async () => {
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
      router.push('/dashboard')
      return
    }

    const { data: companyData } = await supabase
      .from('companies')
      .select(`*, company_features (is_enabled, feature_id, features (id, name))`)
      .eq('id', profile.company_id)
      .single()
    setCompany(companyData)

    const companyHasSchedules = companyData?.company_features?.some(
      (cf: any) => cf.is_enabled && cf.features?.name === 'Schedules'
    )
    if (!companyHasSchedules) {
      router.push('/dashboard')
      return
    }

    if (profile.role !== 'admin') {
      const { data: userFeats } = await supabase
        .from('user_features')
        .select('is_enabled, features (name)')
        .eq('user_id', user.id)
        .eq('is_enabled', true)
      const userHasSchedules = (userFeats as any[])?.some(
        (uf: any) => uf.features?.name === 'Schedules'
      )
      if (!userHasSchedules) {
        router.push('/dashboard')
        return
      }
    }

    const { data: schedulesData } = await supabase
      .from('schedules')
      .select(`*, schedule_documents (id), creator:created_by (full_name)`)
      .eq('company_id', profile.company_id)
      .order('created_at', { ascending: false })

    setSchedules(schedulesData || [])
    setLoading(false)
  }, [router])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  useEffect(() => {
    if (!currentUser?.company_id) return

    const channel = supabase
      .channel('schedules-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'schedules',
          filter: `company_id=eq.${currentUser.company_id}`,
        },
        () => fetchData()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [currentUser?.company_id, fetchData])

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 60_000)
    return () => clearInterval(interval)
  }, [])

  const isAdmin = currentUser?.role === 'admin'
  const isManager = currentUser?.role === 'manager'
  const canManage = isAdmin

  const visibleSchedules = (() => {
    void tick
    return schedules
      .filter(s => !isCompleted(s))
      .filter(s => showInactive ? true : s.active)
      .filter(s => filter === 'all' ? true : s.schedule_type === filter)
      .filter(s => {
        if (!search.trim()) return true
        const q = search.toLowerCase()
        return s.name.toLowerCase().includes(q) ||
          (s.description || '').toLowerCase().includes(q)
      })
  })()

  const formatTime = (t: string) => t?.slice(0, 5) || ''
  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

  const getRecurringDayPills = (days: any) => {
    if (!days) return []
    return Object.entries(days).filter(([_, v]) => v).map(([k]) => DAY_LABELS[k] || k)
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-500">Loading schedules...</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-100">
      <IdleWarningModal show={showWarning} secondsLeft={secondsLeft} onStay={stayLoggedIn} />

      <div className="bg-blue-700 text-white px-6 py-4 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">{company?.name}</h1>
          <p className="text-blue-200 text-sm">Schedules</p>
        </div>
        <button
          onClick={() => router.push('/dashboard')}
          className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm"
        >
          ← Back
        </button>
      </div>

      <div className="max-w-6xl mx-auto p-6 space-y-4">

        <div className="flex justify-between items-center flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">Active Schedules</h2>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => router.push('/dashboard/schedules/reports')}
              className="bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium"
            >
              📊 Reports
            </button>
            {canManage && (
              <button
                onClick={() => router.push('/dashboard/schedules/create')}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                + New Schedule
              </button>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-4 flex flex-wrap gap-3 items-center">
          <input
            type="text"
            placeholder="Search by name or description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
          />

          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {(['all', 'one_off', 'recurring'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                  filter === f
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {f === 'all' ? 'All' : f === 'one_off' ? 'One-off' : 'Recurring'}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="w-4 h-4"
            />
            Show inactive
          </label>
        </div>

        {visibleSchedules.length === 0 ? (
          <div className="bg-white rounded-xl shadow p-12 text-center">
            <div className="text-5xl mb-3">📅</div>
            <p className="text-gray-500 mb-1">
              {schedules.length === 0
                ? 'No schedules yet'
                : 'No schedules match your filters'}
            </p>
            {canManage && schedules.length === 0 && (
              <button
                onClick={() => router.push('/dashboard/schedules/create')}
                className="mt-4 text-blue-600 hover:underline text-sm font-medium"
              >
                Create your first schedule →
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow overflow-hidden">
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Name</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Times</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">When</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Docs</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSchedules.map(s => (
                    <tr
                      key={s.id}
                      onClick={() => router.push(`/dashboard/schedules/${s.id}`)}
                      className={`border-b border-gray-100 last:border-b-0 cursor-pointer hover:bg-gray-50 transition ${!s.active ? 'opacity-60' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-2 min-w-0">
                          <span className="text-lg flex-shrink-0">
                            {s.schedule_type === 'recurring' ? '🔁' : '📅'}
                          </span>
                          <div className="min-w-0">
                            <p className="font-semibold text-gray-800 truncate">{s.name}</p>
                            {s.description && (
                              <p className="text-xs text-gray-500 truncate max-w-xs">{s.description}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${
                          s.schedule_type === 'recurring'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-purple-100 text-purple-700'
                        }`}>
                          {s.schedule_type === 'recurring' ? 'Recurring' : 'One-off'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                        {formatTime(s.start_time)} – {formatTime(s.end_time)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {s.schedule_type === 'one_off' && s.start_date && (
                          <span className="whitespace-nowrap">
                            {s.start_date === s.end_date
                              ? formatDate(s.start_date)
                              : `${formatDate(s.start_date)} → ${formatDate(s.end_date)}`}
                          </span>
                        )}
                        {s.schedule_type === 'recurring' && (
                          <div className="flex gap-1 flex-wrap">
                            {getRecurringDayPills(s.recurring_days).map(d => (
                              <span key={d} className="text-xs bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded">
                                {d}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {s.schedule_documents?.length > 0 ? (
                          <span className="flex items-center gap-1">
                            📎 {s.schedule_documents.length}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1 items-start">
                          {s.active ? (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Active</span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">Inactive</span>
                          )}
                          {!s.is_published ? (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">Draft</span>
                          ) : s.has_unpublished_changes ? (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 font-medium">Unpublished changes</span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="md:hidden divide-y divide-gray-100">
              {visibleSchedules.map(s => (
                <div
                  key={s.id}
                  onClick={() => router.push(`/dashboard/schedules/${s.id}`)}
                  className={`p-4 cursor-pointer hover:bg-gray-50 transition ${!s.active ? 'opacity-60' : ''}`}
                >
                  <div className="flex justify-between items-start gap-2 mb-2">
                    <div className="flex items-start gap-2 min-w-0 flex-1">
                      <span className="text-xl flex-shrink-0">
                        {s.schedule_type === 'recurring' ? '🔁' : '📅'}
                      </span>
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-800 truncate">{s.name}</p>
                        {s.description && (
                          <p className="text-xs text-gray-500 line-clamp-1">{s.description}</p>
                        )}
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap flex-shrink-0 ${
                      s.schedule_type === 'recurring'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-purple-100 text-purple-700'
                    }`}>
                      {s.schedule_type === 'recurring' ? 'Recurring' : 'One-off'}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 ml-7">
                    <span>🕐 {formatTime(s.start_time)} – {formatTime(s.end_time)}</span>
                    {s.schedule_type === 'one_off' && s.start_date && (
                      <span>📆 {s.start_date === s.end_date ? formatDate(s.start_date) : `${formatDate(s.start_date)} → ${formatDate(s.end_date)}`}</span>
                    )}
                    {s.schedule_documents?.length > 0 && (
                      <span>📎 {s.schedule_documents.length}</span>
                    )}
                    {!s.active && (
                      <span className="text-gray-400">Inactive</span>
                    )}
                    {!s.is_published && (
                      <span className="text-amber-700 font-medium">Draft</span>
                    )}
                    {s.is_published && s.has_unpublished_changes && (
                      <span className="text-yellow-700 font-medium">Unpublished changes</span>
                    )}
                  </div>

                  {s.schedule_type === 'recurring' && (
                    <div className="flex gap-1 flex-wrap mt-2 ml-7">
                      {getRecurringDayPills(s.recurring_days).map(d => (
                        <span key={d} className="text-[10px] bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded">
                          {d}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}