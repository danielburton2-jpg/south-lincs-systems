'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
const supabase = createClient()

const ALL_VEHICLE_TYPES = [
  { value: 'class_1', label: 'Class 1 (HGV Articulated)', icon: '🚛' },
  { value: 'class_2', label: 'Class 2 (HGV Rigid)', icon: '🚚' },
  { value: 'bus',     label: 'Bus',                       icon: '🚌' },
  { value: 'coach',   label: 'Coach',                     icon: '🚍' },
  { value: 'minibus', label: 'Minibus',                   icon: '🚐' },
] as const

type Defaults = {
  vehicle_type: string
  service_interval_weeks: number
  mot_reminder_days: number
  service_reminder_days: number
  mot_prep_lead_days: number
  tacho_reminder_days: number
  tax_reminder_days: number
  loler_reminder_days: number
}

const BLANK: Defaults = {
  vehicle_type: '',
  service_interval_weeks: 6,
  mot_reminder_days: 30,
  service_reminder_days: 14,
  mot_prep_lead_days: 14,
  tacho_reminder_days: 30,
  tax_reminder_days: 30,
  loler_reminder_days: 30,
}

export default function ServiceSettingsPage() {
  const router = useRouter()
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [enabledTypes, setEnabledTypes] = useState<string[]>([])
  const [defaultsByType, setDefaultsByType] = useState<Record<string, Defaults>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  const showMessage = (m: string, t: 'success' | 'error') => {
    setMessage(m); setMessageType(t); setTimeout(() => setMessage(''), 4000)
  }

  const loadDefaults = useCallback(async (companyId: string) => {
    const { data } = await supabase
      .from('company_service_defaults')
      .select('*')
      .eq('company_id', companyId)
    const map: Record<string, Defaults> = {}
    ;(data || []).forEach((d: any) => {
      map[d.vehicle_type] = {
        vehicle_type: d.vehicle_type,
        service_interval_weeks: d.service_interval_weeks ?? 6,
        mot_reminder_days: d.mot_reminder_days ?? 30,
        service_reminder_days: d.service_reminder_days ?? 14,
        mot_prep_lead_days: d.mot_prep_lead_days ?? 14,
        tacho_reminder_days: d.tacho_reminder_days ?? 30,
        tax_reminder_days: d.tax_reminder_days ?? 30,
        loler_reminder_days: d.loler_reminder_days ?? 30,
      }
    })
    setDefaultsByType(map)
  }, [])

  const init = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    const { data: profile } = await supabase
      .from('profiles').select('*').eq('id', user.id).single()
    if (!profile) { router.push('/login'); return }
    setCurrentUser(profile)

    if (profile.role !== 'admin' && profile.role !== 'superuser') {
      router.push('/dashboard'); return
    }
    if (!profile.company_id) { router.push('/dashboard'); return }

    const { data: companyData } = await supabase
      .from('companies').select('*, company_features (is_enabled, features (name))').eq('id', profile.company_id).single()
    setCompany(companyData)

    const hasServices = companyData?.company_features?.some(
      (cf: any) => cf.is_enabled && cf.features?.name === 'Services & MOT'
    )
    if (!hasServices) { router.push('/dashboard'); return }

    const types: string[] = companyData?.vehicle_types && companyData.vehicle_types.length > 0
      ? companyData.vehicle_types
      : ALL_VEHICLE_TYPES.map(t => t.value)
    setEnabledTypes(types)

    await loadDefaults(profile.company_id)
    setLoading(false)
  }, [router, loadDefaults])

  useEffect(() => { init() }, [init])

  const updateField = (vt: string, field: keyof Defaults, value: number) => {
    setDefaultsByType(prev => ({
      ...prev,
      [vt]: { ...(prev[vt] || { ...BLANK, vehicle_type: vt }), [field]: value },
    }))
  }

  const save = async (vt: string) => {
    setSaving(vt)
    const cur = defaultsByType[vt] || { ...BLANK, vehicle_type: vt }

    const payload = {
      company_id: currentUser.company_id,
      vehicle_type: vt,
      service_interval_weeks: cur.service_interval_weeks,
      mot_reminder_days: cur.mot_reminder_days,
      service_reminder_days: cur.service_reminder_days,
      mot_prep_lead_days: cur.mot_prep_lead_days,
      tacho_reminder_days: cur.tacho_reminder_days,
      tax_reminder_days: cur.tax_reminder_days,
      loler_reminder_days: cur.loler_reminder_days,
      updated_at: new Date().toISOString(),
    }

    // Upsert by (company_id, vehicle_type)
    const { error } = await supabase
      .from('company_service_defaults')
      .upsert(payload, { onConflict: 'company_id,vehicle_type' })

    setSaving(null)
    if (error) { showMessage(error.message, 'error'); return }
    showMessage(`Saved settings for ${ALL_VEHICLE_TYPES.find(v => v.value === vt)?.label || vt}`, 'success')
  }

  if (loading) {
    return (
      <div className="p-8 text-slate-400 italic">Loading settings…</div>
    )
  }

  const visible = ALL_VEHICLE_TYPES.filter(t => enabledTypes.includes(t.value))

  return (
    <div className="p-8 max-w-4xl">

      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 mb-1">Service Settings</h1>
          <p className="text-sm text-slate-500">{company?.name}</p>
        </div>
        <button
          onClick={() => router.push('/dashboard/vehicles')}
          className="text-sm text-slate-600 hover:text-slate-800"
        >
          ← Back to Vehicles
        </button>
      </div>

      <div className="space-y-4">

        {message && (
          <div className={`p-3 rounded-lg text-sm font-medium ${messageType === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{message}</div>
        )}

        <div className="bg-slate-50 border border-slate-200 text-slate-700 text-sm p-3 rounded-lg">
          <strong>Per-vehicle-type defaults.</strong> These apply to every vehicle of that type unless an individual vehicle has its own override (set on the vehicle's edit page).
          The <strong>MOT prep lead time</strong> is how many days <em>before</em> MOT expiry the calendar will prompt you to schedule the prep job.
        </div>

        {visible.map(vt => {
          const cur = defaultsByType[vt.value] || { ...BLANK, vehicle_type: vt.value }
          return (
            <div key={vt.value} className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-slate-800 text-lg">
                  <span className="text-2xl mr-2">{vt.icon}</span>
                  {vt.label}
                </h2>
                <button onClick={() => save(vt.value)}
                  disabled={saving === vt.value}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                  {saving === vt.value ? 'Saving...' : 'Save'}
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Service interval (weeks)</label>
                  <input type="number" min={1} max={52} value={cur.service_interval_weeks}
                    onChange={e => updateField(vt.value, 'service_interval_weeks', parseInt(e.target.value, 10) || 6)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900" />
                  <p className="text-xs text-slate-500 mt-1">Typical: 6 weeks (HGV), 4-13 weeks (PSV).</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">MOT prep lead time (days)</label>
                  <input type="number" min={1} max={90} value={cur.mot_prep_lead_days}
                    onChange={e => updateField(vt.value, 'mot_prep_lead_days', parseInt(e.target.value, 10) || 14)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900" />
                  <p className="text-xs text-slate-500 mt-1">How long before MOT expiry to schedule prep. 7 = week before, 14 = 2 weeks before.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Service reminder (days)</label>
                  <input type="number" min={1} max={90} value={cur.service_reminder_days}
                    onChange={e => updateField(vt.value, 'service_reminder_days', parseInt(e.target.value, 10) || 14)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900" />
                  <p className="text-xs text-slate-500 mt-1">Show "amber" warning this many days before service is due.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">MOT reminder (days)</label>
                  <input type="number" min={1} max={90} value={cur.mot_reminder_days}
                    onChange={e => updateField(vt.value, 'mot_reminder_days', parseInt(e.target.value, 10) || 30)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Tacho reminder (days)</label>
                  <input type="number" min={1} max={365} value={cur.tacho_reminder_days}
                    onChange={e => updateField(vt.value, 'tacho_reminder_days', parseInt(e.target.value, 10) || 30)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Tax / VED reminder (days)</label>
                  <input type="number" min={1} max={90} value={cur.tax_reminder_days}
                    onChange={e => updateField(vt.value, 'tax_reminder_days', parseInt(e.target.value, 10) || 30)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900" />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">LOLER reminder (days)</label>
                  <input type="number" min={1} max={90} value={cur.loler_reminder_days}
                    onChange={e => updateField(vt.value, 'loler_reminder_days', parseInt(e.target.value, 10) || 30)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900" />
                </div>
              </div>
            </div>
          )
        })}

        {visible.length === 0 && (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8 text-center">
            <p className="text-5xl mb-3">🚛</p>
            <p className="text-slate-500">No vehicle types enabled for this company.</p>
          </div>
        )}

      </div>
    </div>
  )
}
