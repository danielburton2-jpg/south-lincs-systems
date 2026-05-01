'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
const supabase = createClient()

const SERVICE_TYPE_META: Record<string, { label: string; icon: string }> = {
  safety_inspection: { label: 'Safety Inspection', icon: '🔧' },
  mot_prep:          { label: 'MOT Prep',           icon: '📋' },
  full_service:      { label: 'Full Service',       icon: '🛠️' },
  tacho:             { label: 'Tacho Calibration',  icon: '⏱️' },
  loler:             { label: 'LOLER',              icon: '⚙️' },
  tax:               { label: 'Tax (VED)',          icon: '💷' },
  custom:            { label: 'Custom',             icon: '📝' },
}

const STATUS_BADGE: Record<string, string> = {
  scheduled:   'bg-blue-100 text-blue-800 border-blue-300',
  in_progress: 'bg-amber-100 text-amber-800 border-amber-300',
  completed:   'bg-green-100 text-green-800 border-green-300',
  cancelled:   'bg-slate-100 text-slate-500 border-slate-300',
  overdue:     'bg-red-100 text-red-800 border-red-400',
}

const PRIORITY_LABEL: Record<string, { label: string; color: string }> = {
  low:    { label: 'Low',    color: 'text-slate-500' },
  normal: { label: 'Normal', color: 'text-blue-600' },
  high:   { label: 'High',   color: 'text-orange-600' },
  urgent: { label: '🚨 Urgent', color: 'text-red-600 font-bold' },
}

const VEHICLE_ICONS: Record<string, string> = {
  class_1: '🚛', class_2: '🚚', bus: '🚌', coach: '🚍', minibus: '🚐',
}

const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const startOfWeekMon = (d: Date): Date => {
  const out = new Date(d); out.setHours(0, 0, 0, 0)
  const day = out.getDay()
  out.setDate(out.getDate() + (day === 0 ? -6 : 1 - day))
  return out
}

export default function MechanicJobsPage() {
  const router = useRouter()
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [jobs, setJobs] = useState<any[]>([])
  const [vehiclesById, setVehiclesById] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'today' | 'this_week' | 'upcoming' | 'history' | 'defects'>('today')
  const [search, setSearch] = useState('')
  const [creatingForJob, setCreatingForJob] = useState<string | null>(null)

  // Defects assigned to this mechanic (open + recently fixed by them)
  const [defects, setDefects] = useState<any[]>([])
  // Mark-fixed dialog
  const [fixingDefect, setFixingDefect] = useState<any | null>(null)
  const [fixNote, setFixNote] = useState('')
  const [submittingFix, setSubmittingFix] = useState(false)

  const init = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: profile } = await supabase
      .from('profiles').select('*').eq('id', user.id).single()
    if (!profile) { router.push('/login'); return }
    setCurrentUser(profile)

    if (!profile.company_id) { router.push('/employee'); return }

    const { data: companyData } = await supabase
      .from('companies').select('*, company_features (is_enabled, features (name))').eq('id', profile.company_id).single()
    setCompany(companyData)

    // Company-level gate. Slug 'services_mot' kept the same after the
    // 017 rename — only the display name changed to 'Services & Defects'.
    // Match on either name to stay robust if anyone re-runs an older
    // migration or seeds with the original label.
    const companyHasService = companyData?.company_features?.some(
      (cf: any) => cf.is_enabled && (
        cf.features?.name === 'Services & Defects' ||
        cf.features?.name === 'Services & MOT'
      )
    )
    if (!companyHasService) { router.push('/employee'); return }

    // Per-user gate. Mechanic-status IS the Services & Defects flag —
    // there's no separate 'Mechanic' feature. Same dual-name check as
    // above for migration robustness.
    const { data: userFeats } = await supabase
      .from('user_features')
      .select('is_enabled, features (name)')
      .eq('user_id', user.id)
      .eq('is_enabled', true)
    const userIsMechanic = (userFeats as any[])?.some(
      (uf: any) =>
        uf.features?.name === 'Services & Defects' ||
        uf.features?.name === 'Services & MOT'
    )
    if (!userIsMechanic) { router.push('/employee'); return }

    // Load vehicles for display info
    const { data: vehData } = await supabase
      .from('vehicles')
      .select('id, registration, fleet_number, name, vehicle_type, mot_expiry_date, next_service_due')
      .eq('company_id', profile.company_id)
    const vMap: Record<string, any> = {}
    ;(vehData || []).forEach((v: any) => { vMap[v.id] = v })
    setVehiclesById(vMap)

    // Load jobs assigned to me — RLS automatically filters
    const { data: jobData } = await supabase
      .from('service_schedules')
      .select('*')
      .eq('assigned_to', user.id)
      .order('priority', { ascending: false })
      .order('scheduled_date', { ascending: true })
      .order('week_commencing', { ascending: true })
    setJobs(jobData || [])

    // Load defects assigned to me. Show open ones plus any I've
    // marked fixed/resolved in the last 30 days, so the "I just
    // fixed that" state has a moment to settle before the row
    // disappears from the tab.
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 30)
    const { data: defectData } = await supabase
      .from('vehicle_defects')
      .select('*')
      .eq('assigned_to', user.id)
      .or(`status.eq.open,and(status.in.(fixed,resolved),resolved_at.gte.${cutoff.toISOString()})`)
      .order('reported_at', { ascending: false })
    setDefects(defectData || [])

    setLoading(false)
  }, [router])

  useEffect(() => { init() }, [init])

  // Realtime
  useEffect(() => {
    if (!currentUser?.id) return
    const channel = supabase.channel('mechanic-jobs-rt')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'service_schedules', filter: `assigned_to=eq.${currentUser.id}` },
        () => init()
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'vehicle_defects', filter: `assigned_to=eq.${currentUser.id}` },
        () => init()
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [currentUser?.id, init])

  // Tab filtering
  const today = isoDate(new Date())
  const weekStart = isoDate(startOfWeekMon(new Date()))
  const weekEnd = isoDate((() => { const d = startOfWeekMon(new Date()); d.setDate(d.getDate() + 6); return d })())

  const filteredJobs = jobs.filter(j => {
    if (search.trim()) {
      const q = search.toLowerCase()
      const v = vehiclesById[j.vehicle_id]
      if (!v) return false
      const match =
        v.registration?.toLowerCase().includes(q) ||
        (v.fleet_number || '').toLowerCase().includes(q) ||
        (v.name || '').toLowerCase().includes(q)
      if (!match) return false
    }
    const dateKey = j.date_mode === 'week' ? j.week_commencing : j.scheduled_date
    if (!dateKey) return false

    if (tab === 'today') {
      if (j.status === 'completed' || j.status === 'cancelled') return false
      if (j.date_mode === 'week') {
        return dateKey >= weekStart && dateKey <= weekEnd && today >= weekStart && today <= weekEnd
      }
      return dateKey === today
    }
    if (tab === 'this_week') {
      if (j.status === 'completed' || j.status === 'cancelled') return false
      return dateKey >= weekStart && dateKey <= weekEnd
    }
    if (tab === 'upcoming') {
      if (j.status === 'completed' || j.status === 'cancelled') return false
      return dateKey > weekEnd
    }
    if (tab === 'history') {
      return j.status === 'completed' || j.status === 'cancelled'
    }
    return true
  })

  const counts = {
    today: jobs.filter(j => {
      const dk = j.date_mode === 'week' ? j.week_commencing : j.scheduled_date
      if (j.status === 'completed' || j.status === 'cancelled') return false
      if (j.date_mode === 'week') return dk >= weekStart && dk <= weekEnd && today >= weekStart && today <= weekEnd
      return dk === today
    }).length,
    this_week: jobs.filter(j => {
      const dk = j.date_mode === 'week' ? j.week_commencing : j.scheduled_date
      if (j.status === 'completed' || j.status === 'cancelled') return false
      return dk >= weekStart && dk <= weekEnd
    }).length,
    upcoming: jobs.filter(j => {
      const dk = j.date_mode === 'week' ? j.week_commencing : j.scheduled_date
      if (j.status === 'completed' || j.status === 'cancelled') return false
      return dk > weekEnd
    }).length,
    history: jobs.filter(j => j.status === 'completed' || j.status === 'cancelled').length,
    defects: defects.filter(d => d.status === 'open').length,
  }

  // Defects sorted by severity (critical → major → minor) then by date (newest first).
  // Open ones first, fixed/resolved ones at the bottom.
  const SEVERITY_RANK: Record<string, number> = { critical: 0, major: 1, minor: 2 }
  const sortedDefects = [...defects].sort((a, b) => {
    const aOpen = a.status === 'open' ? 0 : 1
    const bOpen = b.status === 'open' ? 0 : 1
    if (aOpen !== bOpen) return aOpen - bOpen
    const aSev = SEVERITY_RANK[a.severity] ?? 99
    const bSev = SEVERITY_RANK[b.severity] ?? 99
    if (aSev !== bSev) return aSev - bSev
    return (b.reported_at || '').localeCompare(a.reported_at || '')
  })

  // Filter defects by search box too
  const filteredDefects = sortedDefects.filter(d => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    const v = vehiclesById[d.vehicle_id]
    return (
      v?.registration?.toLowerCase().includes(q) ||
      (v?.fleet_number || '').toLowerCase().includes(q) ||
      (d.description || '').toLowerCase().includes(q)
    )
  })

  // Open or create the service record for this job
  const openJob = async (job: any) => {
    if (creatingForJob) return
    setCreatingForJob(job.id)

    // Look for an existing in-progress record for this schedule
    const { data: existing } = await supabase
      .from('service_records')
      .select('id')
      .eq('schedule_id', job.id)
      .maybeSingle()

    if (existing?.id) {
      router.push(`/employee/services/${existing.id}`)
      return
    }

    // Create a new service record + snapshot template items
    const v = vehiclesById[job.vehicle_id]
    const { data: record, error: recErr } = await supabase
      .from('service_records')
      .insert({
        schedule_id: job.id,
        company_id: job.company_id,
        vehicle_id: job.vehicle_id,
        service_type: job.service_type,
        template_id: job.template_id,
        performed_by: currentUser.id,
        performed_date: isoDate(new Date()),
      })
      .select()
      .single()

    if (recErr || !record) {
      alert('Could not start: ' + (recErr?.message || 'unknown error'))
      setCreatingForJob(null)
      return
    }

    // Snapshot template items
    if (job.template_id) {
      const { data: items } = await supabase
        .from('service_template_items')
        .select('*')
        .eq('template_id', job.template_id)
        .order('display_order', { ascending: true })

      if (items && items.length > 0) {
        await supabase.from('service_record_items').insert(
          items.map((it: any) => ({
            record_id: record.id,
            template_item_id: it.id,
            category: it.category,
            item_text: it.item_text,
            answer_type: it.answer_type || 'pass_fail',
            expected_answer: it.expected_answer || null,
            unit: it.unit || null,
            display_order: it.display_order,
          }))
        )
      }
    }

    // Mark schedule as in_progress + record start time
    await supabase.from('service_schedules')
      .update({ status: 'in_progress', started_at: new Date().toISOString() })
      .eq('id', job.id)

    setCreatingForJob(null)
    router.push(`/employee/services/${record.id}`)
  }

  // Mark a defect fixed. Optional note saved into resolution_notes.
  const submitFix = async () => {
    if (!fixingDefect) return
    setSubmittingFix(true)
    const { error } = await supabase
      .from('vehicle_defects')
      .update({
        status: 'fixed',
        resolved_by: currentUser.id,
        resolved_at: new Date().toISOString(),
        resolution_notes: fixNote.trim() || null,
      })
      .eq('id', fixingDefect.id)
    setSubmittingFix(false)
    if (error) { alert('Could not mark fixed: ' + error.message); return }
    setFixingDefect(null)
    setFixNote('')
    // Realtime will refresh; explicit init() also covers if RT misses
    init()
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-500">Loading jobs...</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-50 pb-24">
      <div className="bg-gradient-to-br from-orange-600 to-orange-800 text-white px-6 pt-10 pb-6 rounded-b-3xl shadow-lg">
        <div className="flex items-center justify-between">
          <button onClick={() => router.push('/employee')} className="text-orange-100 text-sm hover:text-white">← Home</button>
          <p className="text-orange-100 text-sm">{company?.name}</p>
        </div>
        <h1 className="text-2xl font-bold mt-2">🔧 My Service Jobs</h1>
        <p className="text-orange-100 text-sm mt-1">{currentUser?.full_name}</p>
      </div>

      <div className="px-4 pt-4 space-y-3">

        {/* Search */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-2">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by registration or fleet number..."
            className="w-full border-0 px-3 py-3 text-base text-slate-900 focus:outline-none"
          />
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-1 flex gap-1 overflow-x-auto">
          {([
            { v: 'today',     label: 'Today',     n: counts.today,     red: false },
            { v: 'this_week', label: 'This week', n: counts.this_week, red: false },
            { v: 'upcoming',  label: 'Upcoming',  n: counts.upcoming,  red: false },
            { v: 'history',   label: 'History',   n: counts.history,   red: false },
            { v: 'defects',   label: 'Defects',   n: counts.defects,   red: true  },
          ] as const).map(t => (
            <button key={t.v} onClick={() => setTab(t.v)}
              className={`flex-1 py-2 rounded-xl text-sm font-medium transition whitespace-nowrap ${
                tab === t.v ? 'bg-orange-100 text-orange-800' : 'text-slate-600 hover:bg-slate-50'
              }`}>
              {t.label}
              {t.n > 0 && (
                <span className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${
                  t.red ? 'bg-red-500 text-white' : 'bg-white/80'
                }`}>{t.n}</span>
              )}
            </button>
          ))}
        </div>

        {/* Body — defects tab or job list */}
        {tab === 'defects' ? (
          filteredDefects.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-sm p-8 border border-slate-100 text-center">
              <p className="text-5xl mb-3">✅</p>
              <p className="text-slate-500 text-sm">No defects assigned to you.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredDefects.map(d => {
                const v = vehiclesById[d.vehicle_id]
                const isOpen = d.status === 'open'
                const sevColor =
                  d.severity === 'critical' ? 'bg-red-100 text-red-800 border-red-300' :
                  d.severity === 'major'    ? 'bg-orange-100 text-orange-800 border-orange-300' :
                                              'bg-amber-50 text-amber-700 border-amber-200'
                const sevIcon =
                  d.severity === 'critical' ? '🚨' :
                  d.severity === 'major'    ? '⚠️' : '⚙️'
                return (
                  <div key={d.id}
                    className={`bg-white rounded-2xl shadow-sm border p-3 ${
                      isOpen ? 'border-slate-100' : 'border-slate-200 opacity-70'
                    }`}>
                    <div className="flex items-start gap-3">
                      <div className="text-3xl flex-shrink-0">{sevIcon}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-2xl">{VEHICLE_ICONS[v?.vehicle_type] || '🚗'}</span>
                          <p className="font-mono font-bold text-slate-800">{v?.registration || '?'}</p>
                          {v?.fleet_number && (
                            <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">#{v.fleet_number}</span>
                          )}
                          <span className={`text-[10px] uppercase px-2 py-0.5 rounded border ${sevColor}`}>{d.severity || 'minor'}</span>
                          {!isOpen && (
                            <span className="text-[10px] uppercase px-2 py-0.5 rounded border bg-green-100 text-green-700 border-green-300">
                              ✓ {d.status}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-slate-800 mt-1 whitespace-pre-wrap">{d.description}</p>
                        <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                          <span>📅 {new Date(d.reported_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
                          {d.category && <span>· {d.category}</span>}
                        </div>
                        {d.resolution_notes && (
                          <p className="text-xs text-slate-600 mt-1 italic bg-slate-50 rounded px-2 py-1">
                            Fix note: {d.resolution_notes}
                          </p>
                        )}
                      </div>
                      {isOpen && (
                        <button
                          onClick={() => { setFixingDefect(d); setFixNote('') }}
                          className="bg-green-600 hover:bg-green-700 text-white text-xs font-bold px-3 py-2 rounded-full flex-shrink-0 self-center"
                        >
                          Mark fixed
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        ) : filteredJobs.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm p-8 border border-slate-100 text-center">
            <p className="text-5xl mb-3">✅</p>
            <p className="text-slate-500 text-sm">
              {tab === 'today' && 'No jobs scheduled for today.'}
              {tab === 'this_week' && 'No jobs scheduled for this week.'}
              {tab === 'upcoming' && 'No upcoming jobs.'}
              {tab === 'history' && 'No completed jobs yet.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredJobs.map(job => {
              const v = vehiclesById[job.vehicle_id]
              const meta = SERVICE_TYPE_META[job.service_type] || SERVICE_TYPE_META.custom
              const prio = PRIORITY_LABEL[job.priority] || PRIORITY_LABEL.normal
              const dateLabel = job.date_mode === 'week'
                ? `WC ${new Date(job.week_commencing).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`
                : new Date(job.scheduled_date).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })
              const isCompleted = job.status === 'completed'
              const isCancelled = job.status === 'cancelled'
              const isCreating = creatingForJob === job.id

              return (
                <button key={job.id}
                  onClick={() => !isCompleted && !isCancelled ? openJob(job) : null}
                  disabled={isCreating}
                  className={`w-full text-left bg-white rounded-2xl shadow-sm border p-3 transition disabled:opacity-50 ${
                    isCompleted || isCancelled
                      ? 'border-slate-200 cursor-default'
                      : 'border-slate-100 hover:bg-slate-50 active:bg-slate-100'
                  }`}>
                  <div className="flex items-start gap-3">
                    <div className="text-3xl flex-shrink-0">{meta.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-2xl">{VEHICLE_ICONS[v?.vehicle_type] || '🚗'}</span>
                        <p className="font-mono font-bold text-slate-800">{v?.registration || '?'}</p>
                        {v?.fleet_number && (
                          <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">#{v.fleet_number}</span>
                        )}
                        <span className={`text-[10px] uppercase px-2 py-0.5 rounded border ${STATUS_BADGE[job.status]}`}>{job.status.replace('_', ' ')}</span>
                      </div>
                      <p className="text-sm text-slate-700 mt-0.5">{meta.label}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs">
                        <span className="text-slate-600">📅 {dateLabel}</span>
                        <span className={prio.color}>{prio.label}</span>
                      </div>
                      {job.notes && (
                        <p className="text-xs text-slate-500 mt-1 italic">{job.notes}</p>
                      )}
                    </div>
                    {!isCompleted && !isCancelled && (
                      <span className="bg-orange-600 text-white text-xs font-bold px-3 py-2 rounded-full flex-shrink-0 self-center">
                        {isCreating ? '...' : (job.status === 'in_progress' ? 'Resume' : 'Start')}
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        )}

      </div>

      {/* Mark-fixed dialog */}
      {fixingDefect && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4"
             onClick={() => !submittingFix && setFixingDefect(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3"
               onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-slate-900">Mark defect fixed</h2>
            <p className="text-sm text-slate-600 whitespace-pre-wrap">{fixingDefect.description}</p>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Fix note (optional)</label>
              <textarea
                value={fixNote}
                onChange={e => setFixNote(e.target.value)}
                rows={3}
                placeholder="What you did to fix it…"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setFixingDefect(null)}
                disabled={submittingFix}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={submitFix}
                disabled={submittingFix}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {submittingFix ? 'Saving…' : 'Mark fixed'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom nav */}
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
