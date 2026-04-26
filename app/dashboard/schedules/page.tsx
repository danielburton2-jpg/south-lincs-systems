'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useIdleLogout, IdleWarningModal } from '@/lib/useIdleLogout'

const supabase = createClient()

const DAY_LABELS: Record<string, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
}

export default function SchedulesPage() {
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [schedules, setSchedules] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showInactive, setShowInactive] = useState(false)
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

    // ---- Feature gate: company must have Schedules + user must have Schedules ----
    const { data: companyData } = await supabase
      .from('companies')
      .select(`
        *,
        company_features (
          is_enabled,
          feature_id,
          features (id, name)
        )
      `)
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

    // Admins automatically get all features; for others check user_features
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

    // ---- Feature OK, load schedules ----
    const { data: schedulesData } = await supabase
      .from('schedules')
      .select(`
        *,
        schedule_documents (id),
        creator:created_by (full_name)
      `)
      .eq('company_id', profile.company_id)
      .order('created_at', { ascending: false })

    setSchedules(schedulesData || [])
    setLoading(false)
  }, [router])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Realtime
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

  const isAdmin = currentUser?.role === 'admin'
  const isManager = currentUser?.role === 'manager'
  const canManage = isAdmin || isManager

  const visibleSchedules = schedules.filter(s => showInactive ? true : s.active)

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

      <div className="max-w-6xl mx-auto p-6 space-y-6">

        <div className="flex justify-between items-center flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">All Schedules</h2>
            <p className="text-sm text-gray-500">
              {visibleSchedules.length} {visibleSchedules.length === 1 ? 'schedule' : 'schedules'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                className="w-4 h-4"
              />
              Show inactive
            </label>
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

        {visibleSchedules.length === 0 ? (
          <div className="bg-white rounded-xl shadow p-12 text-center">
            <div className="text-5xl mb-3">📅</div>
            <p className="text-gray-500 mb-1">No schedules yet</p>
            {canManage && (
              <button
                onClick={() => router.push('/dashboard/schedules/create')}
                className="mt-4 text-blue-600 hover:underline text-sm font-medium"
              >
                Create your first schedule →
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {visibleSchedules.map(s => (
              <div
                key={s.id}
                onClick={() => router.push(`/dashboard/schedules/${s.id}`)}
                className={`bg-white rounded-xl shadow p-5 hover:shadow-md transition cursor-pointer border-l-4 ${
                  !s.active ? 'border-gray-300 opacity-60' :
                  s.schedule_type === 'recurring' ? 'border-blue-500' : 'border-purple-500'
                }`}
              >
                <div className="flex justify-between items-start gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-lg">
                        {s.schedule_type === 'recurring' ? '🔁' : '📅'}
                      </span>
                      <h3 className="font-semibold text-gray-800 truncate">{s.name}</h3>
                    </div>
                    {s.description && (
                      <p className="text-sm text-gray-500 mt-1 line-clamp-2">{s.description}</p>
                    )}
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap ${
                    s.schedule_type === 'recurring' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                  }`}>
                    {s.schedule_type === 'recurring' ? 'Recurring' : 'One-off'}
                  </span>
                </div>

                <div className="space-y-1.5 text-sm text-gray-600">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400">🕐</span>
                    <span>{formatTime(s.start_time)} – {formatTime(s.end_time)}</span>
                  </div>

                  {s.schedule_type === 'one_off' && s.start_date && (
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400">📆</span>
                      <span>
                        {s.start_date === s.end_date
                          ? formatDate(s.start_date)
                          : `${formatDate(s.start_date)} → ${formatDate(s.end_date)}`}
                      </span>
                    </div>
                  )}

                  {s.schedule_type === 'recurring' && (
                    <>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-gray-400">📋</span>
                        {getRecurringDayPills(s.recurring_days).map(d => (
                          <span key={d} className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">
                            {d}
                          </span>
                        ))}
                      </div>
                      {(s.start_date || s.end_date) && (
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <span>📆</span>
                          <span>
                            {s.start_date ? formatDate(s.start_date) : 'Any time'}
                            {' → '}
                            {s.end_date ? formatDate(s.end_date) : 'Ongoing'}
                          </span>
                        </div>
                      )}
                    </>
                  )}

                  {s.schedule_documents && s.schedule_documents.length > 0 && (
                    <div className="flex items-center gap-2 pt-2 border-t border-gray-100 mt-2">
                      <span className="text-gray-400">📎</span>
                      <span className="text-xs">
                        {s.schedule_documents.length} {s.schedule_documents.length === 1 ? 'document' : 'documents'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}