'use client'

/**
 * Per-feature settings page for a single company.
 *
 * Lists the company's enabled features. For each one, renders the
 * settings form specific to that feature:
 *
 *   • Holidays       → year start, allow half days, allow early finish
 *   • Vehicle Checks → vehicle types (multi-add list)
 *   • Schedules      → no settings yet (placeholder)
 *   • Services       → no settings yet (placeholder)
 *
 * Disabled features are listed below in a "Not enabled" group. They
 * still get configured here once enabled — this page is the single
 * place for per-company feature settings.
 */

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

type Feature = {
  id: string
  slug: string
  name: string
  description: string | null
  display_order: number
}

type Company = {
  id: string
  name: string
  holiday_year_start: string | null
  allow_half_days: boolean
  allow_early_finish: boolean
  vehicle_types: string[]
}

export default function CompanyFeaturesPage() {
  const params = useParams()
  const router = useRouter()
  const id = params?.id as string | undefined

  const [company, setCompany] = useState<Company | null>(null)
  const [features, setFeatures] = useState<Feature[]>([])
  const [enabledIds, setEnabledIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [savingSlug, setSavingSlug] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  // Holidays form state
  const [holYearStart, setHolYearStart] = useState<string>('')
  const [allowHalf, setAllowHalf] = useState(false)
  const [allowEarly, setAllowEarly] = useState(false)

  // Vehicle Checks form state
  const [vehicleTypes, setVehicleTypes] = useState<string[]>([])
  const [vehicleTypeInput, setVehicleTypeInput] = useState('')

  const showMessage = (msg: string, type: 'success' | 'error') => {
    setMessage(msg)
    setMessageType(type)
    setTimeout(() => setMessage(''), 4000)
  }

  // Load
  useEffect(() => {
    if (!id) return
    let cancelled = false
    const load = async () => {
      try {
        const [cRes, fRes] = await Promise.all([
          fetch(`/api/get-company?id=${encodeURIComponent(id)}`),
          fetch('/api/list-features'),
        ])
        const cData = await cRes.json()
        const fData = await fRes.json()
        if (!cRes.ok) throw new Error(cData.error || 'Failed to load company')
        if (!fRes.ok) throw new Error(fData.error || 'Failed to load features')
        if (cancelled) return

        setCompany(cData.company)
        setFeatures(fData.features || [])
        setEnabledIds(cData.enabled_feature_ids || [])

        // Pre-fill the per-feature forms
        setHolYearStart(cData.company.holiday_year_start || '')
        setAllowHalf(!!cData.company.allow_half_days)
        setAllowEarly(!!cData.company.allow_early_finish)
        setVehicleTypes(Array.isArray(cData.company.vehicle_types) ? cData.company.vehicle_types : [])
      } catch (e: any) {
        if (!cancelled) showMessage(e.message || 'Failed to load', 'error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id])

  const isEnabled = (slug: string) => {
    const f = features.find(x => x.slug === slug)
    return f ? enabledIds.includes(f.id) : false
  }

  const saveSettings = async (slug: string, settings: Record<string, any>) => {
    if (!id) return
    setSavingSlug(slug)
    try {
      const res = await fetch('/api/update-company-feature-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, feature_slug: slug, settings }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')
      showMessage('Settings saved', 'success')
    } catch (e: any) {
      showMessage(e.message || 'Save failed', 'error')
    } finally {
      setSavingSlug(null)
    }
  }

  const addVehicleType = () => {
    const v = vehicleTypeInput.trim()
    if (!v) return
    if (vehicleTypes.includes(v)) {
      setVehicleTypeInput('')
      return
    }
    setVehicleTypes(prev => [...prev, v])
    setVehicleTypeInput('')
  }

  const removeVehicleType = (v: string) => {
    setVehicleTypes(prev => prev.filter(x => x !== v))
  }

  if (loading) return <div className="p-8 text-slate-400 italic">Loading…</div>
  if (!company || !id) return null

  const holidaysEnabled = isEnabled('holidays')
  const vehicleChecksEnabled = isEnabled('vehicle_checks')
  const schedulesEnabled = isEnabled('schedules')
  const servicesEnabled = isEnabled('services')

  const enabledFeatures = features.filter(f => enabledIds.includes(f.id))
  const disabledFeatures = features.filter(f => !enabledIds.includes(f.id))

  return (
    <div className="p-8 max-w-3xl">
      <button
        onClick={() => router.push(`/superuser/companies/edit/${id}`)}
        className="text-sm text-slate-500 hover:text-slate-700 mb-4"
      >
        ← Back to company
      </button>

      <h1 className="text-2xl font-bold text-slate-900 mb-1">
        Feature settings
      </h1>
      <p className="text-sm text-slate-500 mb-6">{company.name}</p>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm font-medium ${
          messageType === 'success'
            ? 'bg-green-50 border border-green-200 text-green-700'
            : 'bg-red-50 border border-red-200 text-red-700'
        }`}>
          {message}
        </div>
      )}

      {enabledFeatures.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-lg text-sm">
          No features enabled yet. Go back to the company edit page and tick some features first.
        </div>
      )}

      {/* HOLIDAYS */}
      {holidaysEnabled && (
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-6 space-y-4">
          <h2 className="text-lg font-semibold text-slate-800">Holidays</h2>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Holiday year start</label>
            <input
              type="date"
              value={holYearStart || ''}
              onChange={e => setHolYearStart(e.target.value)}
              className="w-full max-w-xs border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-500 mt-1">
              Used for pro-rata calculations and yearly entitlement reset.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={allowHalf} onChange={e => setAllowHalf(e.target.checked)} className="w-4 h-4" />
            Allow half-day holiday requests
          </label>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={allowEarly} onChange={e => setAllowEarly(e.target.checked)} className="w-4 h-4" />
            Allow early-finish requests
          </label>

          <button
            onClick={() => saveSettings('holidays', {
              holiday_year_start: holYearStart || null,
              allow_half_days: allowHalf,
              allow_early_finish: allowEarly,
            })}
            disabled={savingSlug === 'holidays'}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            {savingSlug === 'holidays' ? 'Saving…' : 'Save Holidays settings'}
          </button>
        </section>
      )}

      {/* VEHICLE CHECKS */}
      {vehicleChecksEnabled && (
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-6 space-y-4">
          <h2 className="text-lg font-semibold text-slate-800">Vehicle Checks</h2>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Vehicle types</label>

            <div className="flex flex-wrap gap-2 mb-3">
              {vehicleTypes.map(v => (
                <span
                  key={v}
                  className="inline-flex items-center gap-1.5 bg-slate-100 text-slate-800 text-sm px-2.5 py-1 rounded-full"
                >
                  {v}
                  <button
                    onClick={() => removeVehicleType(v)}
                    className="text-slate-500 hover:text-red-600 leading-none"
                    aria-label={`Remove ${v}`}
                  >
                    ×
                  </button>
                </span>
              ))}
              {vehicleTypes.length === 0 && (
                <span className="text-sm text-slate-400 italic">No types added yet.</span>
              )}
            </div>

            <div className="flex gap-2 max-w-md">
              <input
                type="text"
                value={vehicleTypeInput}
                onChange={e => setVehicleTypeInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addVehicleType() } }}
                placeholder="e.g. Truck, Van, Bus"
                className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={addVehicleType}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium px-3 py-2 rounded-lg text-sm"
              >
                Add
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              These appear when creating vehicles, vehicle check templates, etc.
            </p>
          </div>

          <button
            onClick={() => saveSettings('vehicle_checks', { vehicle_types: vehicleTypes })}
            disabled={savingSlug === 'vehicle_checks'}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            {savingSlug === 'vehicle_checks' ? 'Saving…' : 'Save Vehicle Checks settings'}
          </button>
        </section>
      )}

      {/* SCHEDULES */}
      {schedulesEnabled && (
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-lg font-semibold text-slate-800 mb-1">Schedules</h2>
          <p className="text-sm text-slate-500 italic">No company-level settings yet.</p>
        </section>
      )}

      {/* SERVICES */}
      {servicesEnabled && (
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-lg font-semibold text-slate-800 mb-1">Services</h2>
          <p className="text-sm text-slate-500 italic">No company-level settings yet.</p>
        </section>
      )}

      {/* Disabled features */}
      {disabledFeatures.length > 0 && (
        <section className="mt-8 pt-6 border-t border-slate-200">
          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
            Not enabled
          </h3>
          <ul className="space-y-1">
            {disabledFeatures.map(f => (
              <li key={f.id} className="text-sm text-slate-500">
                {f.name}
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-500 mt-3">
            <Link href={`/superuser/companies/edit/${id}`} className="text-blue-600 hover:underline">
              Enable on the company edit page →
            </Link>
          </p>
        </section>
      )}
    </div>
  )
}
