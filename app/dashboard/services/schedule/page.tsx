'use client'

import { useEffect, useState, useCallback, Suspense } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter, useSearchParams } from 'next/navigation'
const supabase = createClient()

const SERVICE_TYPES = [
  { value: 'safety_inspection', label: 'Safety Inspection', icon: '🔧' },
  { value: 'mot_prep',          label: 'MOT Prep',           icon: '📋' },
  { value: 'full_service',      label: 'Full Service',       icon: '🛠️' },
  { value: 'tacho',             label: 'Tacho Calibration',  icon: '⏱️' },
  { value: 'loler',             label: 'LOLER',              icon: '⚙️' },
  { value: 'tax',               label: 'Tax (VED)',          icon: '💷' },
  { value: 'custom',            label: 'Custom',             icon: '📝' },
] as const

const VEHICLE_TYPE_ICONS: Record<string, string> = {
  class_1: '🚛', class_2: '🚚', bus: '🚌', coach: '🚍', minibus: '🚐',
}

const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const startOfWeekMon = (d: Date): Date => {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  const day = out.getDay()
  const diff = day === 0 ? -6 : 1 - day
  out.setDate(out.getDate() + diff)
  return out
}

function ScheduleForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [vehicles, setVehicles] = useState<any[]>([])
  const [mechanics, setMechanics] = useState<any[]>([])
  const [templates, setTemplates] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  // Form fields
  const [vehicleId, setVehicleId] = useState<string>('')
  const [serviceType, setServiceType] = useState<string>('safety_inspection')
  const [templateId, setTemplateId] = useState<string>('')
  const [dateMode, setDateMode] = useState<'date' | 'week'>('date')
  const [scheduledDate, setScheduledDate] = useState<string>('')
  const [weekCommencing, setWeekCommencing] = useState<string>('')
  const [assignedTo, setAssignedTo] = useState<string>('')
  const [priority, setPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal')
  const [notes, setNotes] = useState<string>('')

  const showMessage = (m: string, t: 'success' | 'error') => {
    setMessage(m); setMessageType(t); setTimeout(() => setMessage(''), 4000)
  }

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

    // Load vehicles
    const { data: vehData } = await supabase
      .from('vehicles')
      .select('*')
      .eq('company_id', profile.company_id)
      .eq('active', true)
      .order('registration', { ascending: true })
    setVehicles(vehData || [])

    // Load mechanics — use the API endpoint that uses the service role
    // (bypasses RLS issues with user_features for non-superuser callers)
    try {
      // Look up the Services & Defects feature by slug (slug never
      // changes, name has been renamed from 'Services & MOT'). Users
      // with this feature enabled are the company's mechanics — they
      // can be assigned services and defects.
      const { data: feat } = await supabase
        .from('features').select('id').eq('slug', 'services_mot').single()

      const usersRes = await fetch('/api/get-company-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: profile.company_id }),
      })
      const usersResult = await usersRes.json()

      if (feat?.id && usersResult?.users) {
        const filtered = usersResult.users
          .filter((u: any) => !u.is_frozen && !u.is_deleted)
          .filter((u: any) =>
            (u.user_features || []).some(
              (uf: any) => uf.feature_id === feat.id && uf.is_enabled
            )
          )
          .map((u: any) => ({
            id: u.id,
            full_name: u.full_name,
            email: u.email,
            company_id: u.company_id,
            role: u.role,
          }))
        setMechanics(filtered)
      }
    } catch (err) {
      console.error('Failed to load mechanics:', err)
    }

    // Pre-fill from URL params
    const vid = searchParams.get('vehicle_id')
    const stype = searchParams.get('service_type')
    const wc = searchParams.get('week_commencing')
    const dm = searchParams.get('date_mode')
    if (vid) setVehicleId(vid)
    if (stype) setServiceType(stype)
    if (dm === 'week' || dm === 'date') setDateMode(dm)
    if (wc) {
      // Snap to Monday just in case
      setWeekCommencing(isoDate(startOfWeekMon(new Date(wc))))
      // If we got a week_commencing param, default to week mode unless caller said otherwise
      if (!dm) setDateMode('week')
    }

    setLoading(false)
  }, [router, searchParams])

  useEffect(() => { init() }, [init])

  // Load templates whenever vehicle + service type change
  useEffect(() => {
    if (!currentUser?.company_id || !vehicleId) { setTemplates([]); setTemplateId(''); return }
    const v = vehicles.find(v => v.id === vehicleId)
    if (!v) return

    supabase
      .from('service_templates')
      .select('*')
      .eq('company_id', currentUser.company_id)
      .eq('vehicle_type', v.vehicle_type)
      .eq('service_type', serviceType)
      .eq('active', true)
      .then(({ data }) => {
        setTemplates(data || [])
        // Auto-select first template
        if (data && data.length > 0) setTemplateId(data[0].id)
        else setTemplateId('')
      })
  }, [currentUser?.company_id, vehicleId, serviceType, vehicles])

  // When date mode changes to 'week', auto-snap selected date to Monday
  useEffect(() => {
    if (dateMode === 'week' && scheduledDate) {
      const wc = startOfWeekMon(new Date(scheduledDate))
      setWeekCommencing(isoDate(wc))
    }
  }, [dateMode, scheduledDate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMessage('')

    if (!vehicleId) { showMessage('Pick a vehicle', 'error'); return }
    if (dateMode === 'date' && !scheduledDate) { showMessage('Pick a date', 'error'); return }
    if (dateMode === 'week' && !weekCommencing) { showMessage('Pick a week', 'error'); return }

    setSubmitting(true)

    const payload = {
      company_id: currentUser.company_id,
      vehicle_id: vehicleId,
      service_type: serviceType,
      template_id: templateId || null,
      date_mode: dateMode,
      scheduled_date: dateMode === 'date' ? scheduledDate : null,
      week_commencing: dateMode === 'week' ? weekCommencing : null,
      assigned_to: assignedTo || null,
      assigned_by: assignedTo ? currentUser.id : null,
      assigned_at: assignedTo ? new Date().toISOString() : null,
      priority,
      notes: notes.trim() || null,
      status: 'scheduled',
    }

    const { data, error } = await supabase
      .from('service_schedules')
      .insert(payload)
      .select()
      .single()

    setSubmitting(false)

    if (error) { showMessage('Could not schedule: ' + error.message, 'error'); return }

    showMessage('Scheduled. Redirecting to calendar…', 'success')
    setTimeout(() => router.push('/dashboard/services/calendar'), 1000)
  }

  if (loading) {
    return (
      <div className="p-8 text-slate-400 italic">Loading…</div>
    )
  }

  const selectedVehicle = vehicles.find(v => v.id === vehicleId)

  return (
    <div className="p-8 max-w-3xl">

      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 mb-1">Schedule Service</h1>
          <p className="text-sm text-slate-500">{company?.name}</p>
        </div>
        <button
          onClick={() => router.push('/dashboard/services/calendar')}
          className="text-sm text-slate-600 hover:text-slate-800"
        >
          ← Calendar
        </button>
      </div>

      <div className="space-y-4">

        {message && (
          <div className={`p-3 rounded-lg text-sm font-medium ${messageType === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{message}</div>
        )}

        <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-4">
          <h2 className="font-semibold text-slate-800 text-lg">Schedule a service or MOT prep</h2>

          {/* Vehicle */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Vehicle *</label>
            <select value={vehicleId} onChange={e => setVehicleId(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 bg-white" required>
              <option value="">— pick a vehicle —</option>
              {vehicles.map(v => (
                <option key={v.id} value={v.id}>
                  {VEHICLE_TYPE_ICONS[v.vehicle_type] || '🚗'} {v.registration}
                  {v.fleet_number ? ` (#${v.fleet_number})` : ''}
                  {v.name ? ` — ${v.name}` : ''}
                </option>
              ))}
            </select>
            {selectedVehicle && (
              <div className="mt-2 text-xs text-slate-600 bg-slate-50 rounded-lg p-2">
                {selectedVehicle.last_service_date && <p>Last service: {new Date(selectedVehicle.last_service_date).toLocaleDateString('en-GB')}</p>}
                {selectedVehicle.next_service_due && <p>Next service due: <strong>{new Date(selectedVehicle.next_service_due).toLocaleDateString('en-GB')}</strong></p>}
                {selectedVehicle.mot_expiry_date && <p>MOT expires: <strong>{new Date(selectedVehicle.mot_expiry_date).toLocaleDateString('en-GB')}</strong></p>}
              </div>
            )}
          </div>

          {/* Service type */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Service type *</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {SERVICE_TYPES.map(s => (
                <button key={s.value} type="button" onClick={() => setServiceType(s.value)}
                  className={`p-2 rounded-lg border-2 text-left text-sm transition ${
                    serviceType === s.value ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'
                  }`}>
                  <span className="text-lg">{s.icon}</span> {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Template */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Check sheet template</label>
            {templates.length === 0 ? (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg p-3">
                No active template found for this vehicle type and service type.{' '}
                <button type="button" onClick={() => router.push('/dashboard/services/templates')}
                  className="underline font-medium">Create one →</button>
              </div>
            ) : (
              <select value={templateId} onChange={e => setTemplateId(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 bg-white">
                {templates.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Date mode toggle + date pickers */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">When</label>
            <div className="flex gap-2 mb-2">
              <button type="button" onClick={() => setDateMode('date')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                  dateMode === 'date' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}>📅 Specific date</button>
              <button type="button" onClick={() => setDateMode('week')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                  dateMode === 'week' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}>🗓️ Week commencing</button>
            </div>
            {dateMode === 'date' ? (
              <input type="date" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900" />
            ) : (
              <>
                <input type="date" value={weekCommencing}
                  onChange={e => {
                    const d = new Date(e.target.value)
                    setWeekCommencing(isoDate(startOfWeekMon(d)))
                  }}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900" />
                {weekCommencing && (
                  <p className="text-xs text-slate-500 mt-1">
                    Week commencing Monday {new Date(weekCommencing).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Mechanic */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Assign to mechanic</label>
            {mechanics.length === 0 ? (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg p-3">
                No mechanics yet — give a user the <strong>Services &amp; Defects</strong> feature in the user editor.
              </div>
            ) : (
              <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 bg-white">
                <option value="">— unassigned —</option>
                {mechanics.map(m => (
                  <option key={m.id} value={m.id}>{m.full_name} ({m.email})</option>
                ))}
              </select>
            )}
          </div>

          {/* Priority */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Priority</label>
            <select value={priority} onChange={e => setPriority(e.target.value as any)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 bg-white">
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">🚨 Urgent</option>
            </select>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Notes (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              placeholder="Any specific instructions for the mechanic"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900" />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={submitting}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium disabled:opacity-50">
              {submitting ? 'Scheduling...' : 'Schedule'}
            </button>
            <button type="button" onClick={() => router.push('/dashboard/services/calendar')}
              className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-6 py-3 rounded-lg font-medium">Cancel</button>
          </div>
        </form>

      </div>
    </div>
  )
}

export default function SchedulePage() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-400 italic">Loading…</div>}>
      <ScheduleForm />
    </Suspense>
  )
}