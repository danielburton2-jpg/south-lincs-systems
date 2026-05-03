'use client'

/**
 * CompanyForm — shared by /create and /edit/[id] pages.
 *
 * Subscription dates UX:
 *   • Start date — date picker (as before)
 *   • Subscription length — free text ("1 year", "6 months", "30 days" etc.)
 *   • End date — calculated, shown read-only, updates live as you type
 *   • Override end date — separate field, takes priority over end_date
 *     when middleware decides if a company is expired
 *
 * Schedules mode picker (added in migration 029):
 *   • Only shown when the Schedules feature is ticked
 *   • Radio choice between 'shift_patterns' (existing behaviour) and
 *     'day_sheet' (new trip-style planning)
 *   • Persisted on the companies table as `schedules_mode`
 *   • If Schedules is unticked, the mode resets to 'shift_patterns' on
 *     save (the field still has a value, it's just not in use until
 *     Schedules is re-enabled)
 *
 * The parser lives in lib/subscription.ts and is shared with the API
 * routes — same logic on both sides.
 */

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { calculateEndDate, parseSubscriptionLength } from '@/lib/subscription'

export type Feature = {
  id: string
  slug: string
  name: string
  description: string | null
  display_order: number
}

export type SchedulesMode = 'shift_patterns' | 'day_sheet'

export type CompanyFormValues = {
  id?: string
  name: string
  is_active: boolean
  start_date: string | null
  subscription_length: string | null   // free text
  override_end_date: string | null
  contact_name: string | null
  contact_phone: string | null
  contact_email: string | null
  notes: string | null
  enabled_feature_ids?: string[]
  vehicle_types?: string[]
  schedules_mode?: SchedulesMode
}

type Props = {
  mode: 'create' | 'edit'
  initialValues: CompanyFormValues
}

const EMPTY: CompanyFormValues = {
  name: '',
  is_active: true,
  start_date: null,
  subscription_length: null,
  override_end_date: null,
  contact_name: null,
  contact_phone: null,
  contact_email: null,
  notes: null,
  enabled_feature_ids: [],
  vehicle_types: [],
  schedules_mode: 'shift_patterns',
}

// Catalogue of vehicle types — kept in sync with the Vehicles page.
const ALL_VEHICLE_TYPES: { value: string; label: string; icon: string }[] = [
  { value: 'class_1', label: 'Class 1 (HGV Articulated)', icon: '🚛' },
  { value: 'class_2', label: 'Class 2 (HGV Rigid)',       icon: '🚚' },
  { value: 'bus',     label: 'Bus',                       icon: '🚌' },
  { value: 'coach',   label: 'Coach',                     icon: '🚍' },
  { value: 'minibus', label: 'Minibus',                   icon: '🚐' },
]

export default function CompanyForm({ mode, initialValues }: Props) {
  const router = useRouter()
  const [v, setV] = useState<CompanyFormValues>({ ...EMPTY, ...initialValues })
  const [features, setFeatures] = useState<Feature[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  // Load features for the tickboxes
  useEffect(() => {
    let cancelled = false
    fetch('/api/list-features')
      .then(r => r.json())
      .then(data => {
        if (!cancelled && Array.isArray(data.features)) {
          setFeatures(data.features)
        }
      })
      .catch(() => { /* swallow */ })
    return () => { cancelled = true }
  }, [])

  const setField = <K extends keyof CompanyFormValues>(k: K, val: CompanyFormValues[K]) => {
    setV(prev => ({ ...prev, [k]: val }))
  }

  const toggleFeature = (id: string) => {
    setV(prev => {
      const cur = prev.enabled_feature_ids || []
      const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]
      return { ...prev, enabled_feature_ids: next }
    })
  }

  const toggleVehicleType = (value: string) => {
    setV(prev => {
      const cur = prev.vehicle_types || []
      const next = cur.includes(value) ? cur.filter(x => x !== value) : [...cur, value]
      return { ...prev, vehicle_types: next }
    })
  }

  // Is the Vehicle Checks feature ticked? Drives whether we show the
  // vehicle types panel.
  const vehicleChecksFeature = features.find(f => f.slug === 'vehicle_checks')
  const vehicleChecksEnabled = !!(
    vehicleChecksFeature &&
    (v.enabled_feature_ids || []).includes(vehicleChecksFeature.id)
  )

  // Is the Schedules feature ticked? Drives whether we show the mode
  // picker.
  const schedulesFeature = features.find(f => f.slug === 'schedules')
  const schedulesEnabled = !!(
    schedulesFeature &&
    (v.enabled_feature_ids || []).includes(schedulesFeature.id)
  )

  const showMessage = (msg: string, type: 'success' | 'error') => {
    setMessage(msg)
    setMessageType(type)
    setTimeout(() => setMessage(''), 4000)
  }

  // ── Live end-date preview ──────────────────────────────────────
  const calculatedEnd = useMemo(
    () => calculateEndDate(v.start_date, v.subscription_length),
    [v.start_date, v.subscription_length]
  )

  // Display the end date in a human-readable way (e.g. "28 July 2026")
  const calculatedEndDisplay = useMemo(() => {
    if (!calculatedEnd) return null
    try {
      const d = new Date(calculatedEnd)
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    } catch {
      return calculatedEnd
    }
  }, [calculatedEnd])

  // Did the user type a length? Did it parse? (For the validation hint.)
  const lengthParsed = parseSubscriptionLength(v.subscription_length)
  const lengthEntered = !!v.subscription_length?.trim()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!v.name.trim()) {
      showMessage('Company name is required', 'error')
      return
    }
    if (lengthEntered && !lengthParsed) {
      showMessage('Subscription length is invalid. Try things like "1 year", "6 months", "30 days".', 'error')
      return
    }

    setSubmitting(true)
    setMessage('')

    const url = mode === 'create' ? '/api/create-company' : '/api/update-company'

    // If Schedules is not ticked, send the default mode regardless of
    // what's in state — keeps the DB tidy.
    const effectiveMode: SchedulesMode = schedulesEnabled
      ? (v.schedules_mode || 'shift_patterns')
      : 'shift_patterns'

    const payload: any = {
      name: v.name.trim(),
      is_active: v.is_active,
      start_date: v.start_date || null,
      subscription_length: v.subscription_length?.trim() || null,
      override_end_date: v.override_end_date || null,
      contact_name: v.contact_name?.trim() || null,
      contact_phone: v.contact_phone?.trim() || null,
      contact_email: v.contact_email?.trim() || null,
      notes: v.notes?.trim() || null,
      enabled_feature_ids: v.enabled_feature_ids || [],
      vehicle_types: v.vehicle_types || [],
      schedules_mode: effectiveMode,
    }
    if (mode === 'edit') payload.id = v.id

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        showMessage(data.error || 'Failed to save', 'error')
        setSubmitting(false)
        return
      }
      if (mode === 'create' && data.company?.id) {
        const tickedAny = (v.enabled_feature_ids || []).length > 0
        const dest = tickedAny
          ? `/superuser/companies/${data.company.id}/features`
          : `/superuser/companies/edit/${data.company.id}`
        router.push(dest)
      } else {
        showMessage('Saved', 'success')
        router.refresh()
      }
    } catch (err: any) {
      showMessage(err.message || 'Server error', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-baseline justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">
          {mode === 'create' ? 'Create Company' : 'Edit Company'}
        </h1>
        {mode === 'edit' && v.id && (
          <Link
            href={`/superuser/companies/${v.id}/features`}
            className="text-sm text-blue-600 hover:underline"
          >
            Configure feature settings →
          </Link>
        )}
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm font-medium ${
          messageType === 'success'
            ? 'bg-green-50 border border-green-200 text-green-700'
            : 'bg-red-50 border border-red-200 text-red-700'
        }`}>
          {message}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Basic */}
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-4">
          <h2 className="text-lg font-semibold text-slate-800">Basic</h2>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Company name *</label>
            <input
              type="text"
              value={v.name}
              onChange={e => setField('name', e.target.value)}
              required
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={v.is_active}
                onChange={e => setField('is_active', e.target.checked)}
                className="w-4 h-4"
              />
              Active
              <span className="text-xs text-slate-500">(if unticked, users in this company cannot sign in)</span>
            </label>
          </div>
        </section>

        {/* Subscription */}
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-4">
          <h2 className="text-lg font-semibold text-slate-800">Subscription</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Start date</label>
              <input
                type="date"
                value={v.start_date || ''}
                onChange={e => setField('start_date', e.target.value || null)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Length
                <span className="ml-1 text-xs text-slate-500">(e.g. &quot;1 year&quot;, &quot;6 months&quot;)</span>
              </label>
              <input
                type="text"
                value={v.subscription_length || ''}
                onChange={e => setField('subscription_length', e.target.value || null)}
                placeholder="e.g. 1 year"
                className={`w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 ${
                  lengthEntered && !lengthParsed
                    ? 'border-red-300 focus:ring-red-500'
                    : 'border-slate-300 focus:ring-blue-500'
                }`}
              />
              {lengthEntered && !lengthParsed && (
                <p className="text-xs text-red-600 mt-1">
                  Couldn&apos;t parse. Try &quot;1 year&quot;, &quot;6 months&quot;, &quot;12 weeks&quot;, &quot;30 days&quot;.
                </p>
              )}
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-sm">
            <span className="text-slate-500">End date (calculated):</span>{' '}
            {calculatedEndDisplay ? (
              <span className="text-slate-800 font-medium">{calculatedEndDisplay}</span>
            ) : (
              <span className="text-slate-400 italic">
                Enter a start date and length above
              </span>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Override end date
              <span className="ml-1 text-xs text-slate-500">(takes priority if set)</span>
            </label>
            <input
              type="date"
              value={v.override_end_date || ''}
              onChange={e => setField('override_end_date', e.target.value || null)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-500 mt-1">
              Use to extend (or shorten) the subscription beyond the calculated end date.
            </p>
          </div>
        </section>

        {/* Contact */}
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-4">
          <h2 className="text-lg font-semibold text-slate-800">Contact</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Contact name</label>
              <input
                type="text"
                value={v.contact_name || ''}
                onChange={e => setField('contact_name', e.target.value || null)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
              <input
                type="tel"
                value={v.contact_phone || ''}
                onChange={e => setField('contact_phone', e.target.value || null)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input
              type="email"
              value={v.contact_email || ''}
              onChange={e => setField('contact_email', e.target.value || null)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </section>

        {/* Notes */}
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-4">
          <h2 className="text-lg font-semibold text-slate-800">Notes</h2>
          <textarea
            value={v.notes || ''}
            onChange={e => setField('notes', e.target.value || null)}
            rows={4}
            placeholder="Internal notes about this company"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </section>

        {/* Features */}
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold text-slate-800">Features</h2>
            <p className="text-xs text-slate-500">
              {mode === 'create'
                ? 'Tick to enable. You can configure each on the next page.'
                : 'Tick to enable. Configure on the dedicated settings page.'}
            </p>
          </div>

          {features.length === 0 ? (
            <p className="text-sm text-slate-400 italic">No features available.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {features.map(f => {
                const enabled = (v.enabled_feature_ids || []).includes(f.id)
                return (
                  <label
                    key={f.id}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${
                      enabled
                        ? 'border-blue-400 bg-blue-50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={() => toggleFeature(f.id)}
                      className="mt-0.5 w-4 h-4"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800">{f.name}</p>
                      {f.description && (
                        <p className="text-xs text-slate-500 mt-0.5">{f.description}</p>
                      )}
                    </div>
                  </label>
                )
              })}
            </div>
          )}
        </section>

        {/* Schedules mode picker — only when Schedules feature is ticked */}
        {schedulesEnabled && (
          <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold text-slate-800">Schedules mode</h2>
              <p className="text-xs text-slate-500">
                Pick one. Companies cannot use both modes at the same time.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <label
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${
                  v.schedules_mode === 'shift_patterns'
                    ? 'border-blue-400 bg-blue-50'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <input
                  type="radio"
                  name="schedules_mode"
                  value="shift_patterns"
                  checked={v.schedules_mode === 'shift_patterns'}
                  onChange={() => setField('schedules_mode', 'shift_patterns')}
                  className="mt-0.5 w-4 h-4"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">Shift patterns</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Recurring or one-off shifts assigned to drivers via the weekly grid.
                    The current behaviour for all existing companies.
                  </p>
                </div>
              </label>

              <label
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${
                  v.schedules_mode === 'day_sheet'
                    ? 'border-blue-400 bg-blue-50'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <input
                  type="radio"
                  name="schedules_mode"
                  value="day_sheet"
                  checked={v.schedules_mode === 'day_sheet'}
                  onChange={() => setField('schedules_mode', 'day_sheet')}
                  className="mt-0.5 w-4 h-4"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">Day sheet</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Trip-style planning. Customer + outbound + return jobs on a date,
                    with a printable day-view that mirrors a paper running sheet.
                  </p>
                </div>
              </label>
            </div>

            {mode === 'edit' && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                ⚠️ Switching modes hides the data from the other mode but does not delete it.
                Don&apos;t switch a live company without checking with them first.
              </p>
            )}
          </section>
        )}

        {/* Vehicle types — only when Vehicle Checks feature is ticked */}
        {vehicleChecksEnabled && (
          <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold text-slate-800">Vehicle Types</h2>
              <p className="text-xs text-slate-500">
                Tick the types this company operates. Untick all to allow every type.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {ALL_VEHICLE_TYPES.map(t => {
                const enabled = (v.vehicle_types || []).includes(t.value)
                return (
                  <label
                    key={t.value}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition ${
                      enabled
                        ? 'border-blue-400 bg-blue-50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={() => toggleVehicleType(t.value)}
                      className="w-4 h-4"
                    />
                    <span className="text-xl flex-shrink-0">{t.icon}</span>
                    <span className="text-sm font-medium text-slate-800 flex-1">{t.label}</span>
                  </label>
                )
              })}
            </div>
            {(v.vehicle_types || []).length === 0 && (
              <p className="text-xs text-slate-500 italic">
                No types selected — all vehicle types will be available.
              </p>
            )}
          </section>
        )}

        {/* Submit */}
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-2.5 rounded-lg transition disabled:opacity-50"
          >
            {submitting
              ? (mode === 'create' ? 'Creating…' : 'Saving…')
              : (mode === 'create' ? 'Create Company' : 'Save Changes')}
          </button>
          <button
            type="button"
            onClick={() => router.push('/superuser/companies/edit')}
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium px-6 py-2.5 rounded-lg transition"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
