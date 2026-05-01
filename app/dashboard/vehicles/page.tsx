'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { logAuditClient } from '@/lib/auditClient'

const supabase = createClient()

const ALL_VEHICLE_TYPES = [
  { value: 'class_1', label: 'Class 1 (HGV Articulated)', icon: '🚛' },
  { value: 'class_2', label: 'Class 2 (HGV Rigid)', icon: '🚚' },
  { value: 'bus', label: 'Bus', icon: '🚌' },
  { value: 'coach', label: 'Coach', icon: '🚍' },
  { value: 'minibus', label: 'Minibus', icon: '🚐' },
] as const

// Helper: format YYYY-MM-DD <-> Date safely
const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const daysBetween = (dateStr: string | null) => {
  if (!dateStr) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(dateStr)
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

// Status badge for a date — returns Tailwind classes + label
function complianceBadge(dateStr: string | null, label: string) {
  if (!dateStr) return null
  const days = daysBetween(dateStr)
  if (days === null) return null

  if (days < 0) {
    return { color: 'bg-red-100 text-red-700 border-red-300', text: `${label}: ${Math.abs(days)}d overdue` }
  }
  if (days <= 14) {
    return { color: 'bg-amber-100 text-amber-700 border-amber-300', text: `${label}: ${days}d` }
  }
  if (days <= 30) {
    return { color: 'bg-yellow-50 text-yellow-700 border-yellow-200', text: `${label}: ${days}d` }
  }
  return { color: 'bg-green-50 text-green-700 border-green-200', text: `${label}: ${days}d` }
}

export default function VehiclesPage() {
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [enabledTypes, setEnabledTypes] = useState<string[]>([])
  const [vehicles, setVehicles] = useState<any[]>([])
  const [openDefectsByVehicle, setOpenDefectsByVehicle] = useState<Record<string, number>>({})
  const [serviceDefaults, setServiceDefaults] = useState<Record<string, any>>({}) // keyed by vehicle_type
  const [hasServicesFeature, setHasServicesFeature] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  const [showForm, setShowForm] = useState(false)
  const [editingVehicle, setEditingVehicle] = useState<any>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState<string>('all')
  const [submitting, setSubmitting] = useState(false)

  // Existing fields
  const [registration, setRegistration] = useState('')
  const [fleetNumber, setFleetNumber] = useState('')
  const [vehicleType, setVehicleType] = useState<string>('')
  const [name, setName] = useState('')
  const [active, setActive] = useState(true)
  const [notes, setNotes] = useState('')

  // NEW compliance fields (only shown if Services & MOT feature enabled)
  const [serviceIntervalWeeks, setServiceIntervalWeeks] = useState<string>('')   // empty string = use company default
  const [lastServiceDate, setLastServiceDate] = useState<string>('')
  const [motExpiryDate, setMotExpiryDate] = useState<string>('')
  const [tachoCalibrationDate, setTachoCalibrationDate] = useState<string>('')
  const [taxDueDate, setTaxDueDate] = useState<string>('')
  const [lolerDueDate, setLolerDueDate] = useState<string>('')
  const [currentMileage, setCurrentMileage] = useState<string>('')

  const router = useRouter()
  // Idle auto-logout: not enabled here (the dashboard layout's
  // IdleTimeoutGuard already handles admin/manager logout if configured).

  const showMessage = (msg: string, type: 'success' | 'error') => {
    setMessage(msg)
    setMessageType(type)
    setTimeout(() => setMessage(''), 4000)
  }

  const loadAll = useCallback(async (companyId: string) => {
    const [vehRes, defRes] = await Promise.all([
      supabase
        .from('vehicles')
        .select('*')
        .eq('company_id', companyId)
        .order('registration', { ascending: true }),
      supabase
        .from('vehicle_defects')
        .select('id, vehicle_id, status')
        .eq('company_id', companyId)
        .eq('status', 'open'),
    ])

    setVehicles(vehRes.data || [])

    const counts: Record<string, number> = {}
    ;(defRes.data || []).forEach((d: any) => {
      counts[d.vehicle_id] = (counts[d.vehicle_id] || 0) + 1
    })
    setOpenDefectsByVehicle(counts)
  }, [])

  const loadServiceDefaults = useCallback(async (companyId: string) => {
    const { data } = await supabase
      .from('company_service_defaults')
      .select('*')
      .eq('company_id', companyId)
    const map: Record<string, any> = {}
    ;(data || []).forEach((d: any) => { map[d.vehicle_type] = d })
    setServiceDefaults(map)
  }, [])

  const init = useCallback(async () => {
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

    if (profile.role !== 'admin') {
      router.push('/dashboard')
      return
    }

    if (!profile.company_id) {
      router.push('/dashboard')
      return
    }

    const { data: companyData } = await supabase
      .from('companies')
      .select(`*, company_features (is_enabled, features (name))`)
      .eq('id', profile.company_id)
      .single()
    setCompany(companyData)

    const companyHasFeature = companyData?.company_features?.some(
      (cf: any) => cf.is_enabled && cf.features?.name === 'Vehicle Checks'
    )
    if (!companyHasFeature) {
      router.push('/dashboard')
      return
    }

    // Check if Services & MOT feature is enabled
    const hasServices = companyData?.company_features?.some(
      (cf: any) => cf.is_enabled && cf.features?.name === 'Services & MOT'
    )
    setHasServicesFeature(!!hasServices)

    const types: string[] = companyData?.vehicle_types && companyData.vehicle_types.length > 0
      ? companyData.vehicle_types
      : ['class_1', 'class_2', 'bus', 'coach', 'minibus']
    setEnabledTypes(types)

    setVehicleType(types[0] || 'class_2')

    await loadAll(profile.company_id)
    if (hasServices) await loadServiceDefaults(profile.company_id)
    setLoading(false)
  }, [router, loadAll, loadServiceDefaults])

  useEffect(() => { init() }, [init])

  useEffect(() => {
    if (!currentUser?.company_id) return
    const channel = supabase
      .channel('vehicles-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles', filter: `company_id=eq.${currentUser.company_id}` }, () => {
        loadAll(currentUser.company_id)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_defects', filter: `company_id=eq.${currentUser.company_id}` }, () => {
        loadAll(currentUser.company_id)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [currentUser?.company_id, loadAll])

  const visibleVehicleTypes = ALL_VEHICLE_TYPES.filter(t => enabledTypes.includes(t.value))

  const resetForm = () => {
    setRegistration('')
    setFleetNumber('')
    setVehicleType(enabledTypes[0] || 'class_2')
    setName('')
    setActive(true)
    setNotes('')
    setServiceIntervalWeeks('')
    setLastServiceDate('')
    setMotExpiryDate('')
    setTachoCalibrationDate('')
    setTaxDueDate('')
    setLolerDueDate('')
    setCurrentMileage('')
    setEditingVehicle(null)
  }

  const handleStartEdit = (vehicle: any) => {
    setEditingVehicle(vehicle)
    setRegistration(vehicle.registration || '')
    setFleetNumber(vehicle.fleet_number || '')
    setVehicleType(vehicle.vehicle_type)
    setName(vehicle.name || '')
    setActive(vehicle.active)
    setNotes(vehicle.notes || '')
    setServiceIntervalWeeks(vehicle.service_interval_weeks ? String(vehicle.service_interval_weeks) : '')
    setLastServiceDate(vehicle.last_service_date || '')
    setMotExpiryDate(vehicle.mot_expiry_date || '')
    setTachoCalibrationDate(vehicle.tacho_calibration_date || '')
    setTaxDueDate(vehicle.tax_due_date || '')
    setLolerDueDate(vehicle.loler_due_date || '')
    setCurrentMileage(vehicle.current_mileage != null ? String(vehicle.current_mileage) : '')
    setShowForm(true)
  }

  // Calculate next service due based on inputs (display-only, the trigger
  // handles the real persistence when records are added)
  const previewNextServiceDue = (): string | null => {
    if (!lastServiceDate) return null
    const interval = serviceIntervalWeeks
      ? parseInt(serviceIntervalWeeks, 10)
      : (serviceDefaults[vehicleType]?.service_interval_weeks ?? 6)
    if (!interval || isNaN(interval) || interval < 1) return null
    const d = new Date(lastServiceDate)
    d.setDate(d.getDate() + interval * 7)
    return isoDate(d)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!registration.trim()) {
      showMessage('Registration is required', 'error')
      return
    }

    if (!enabledTypes.includes(vehicleType)) {
      showMessage('That vehicle type is not enabled for your company', 'error')
      return
    }

    setSubmitting(true)

    const payload: any = {
      company_id: currentUser.company_id,
      registration: registration.trim().toUpperCase(),
      fleet_number: fleetNumber.trim() || null,
      vehicle_type: vehicleType,
      name: name.trim() || null,
      active,
      notes: notes.trim() || null,
    }

    // Compliance fields — only persist if the Services & MOT feature is on
    if (hasServicesFeature) {
      const intervalNum = serviceIntervalWeeks ? parseInt(serviceIntervalWeeks, 10) : null
      payload.service_interval_weeks = (intervalNum && intervalNum > 0) ? intervalNum : null

      payload.last_service_date      = lastServiceDate || null
      payload.mot_expiry_date        = motExpiryDate || null
      payload.tacho_calibration_date = tachoCalibrationDate || null
      payload.tax_due_date           = taxDueDate || null
      payload.loler_due_date         = lolerDueDate || null

      const mileageNum = currentMileage ? parseInt(currentMileage, 10) : null
      payload.current_mileage = (mileageNum && mileageNum >= 0) ? mileageNum : null

      // Calculate next_service_due if we have what we need
      if (lastServiceDate) {
        const interval = (intervalNum && intervalNum > 0)
          ? intervalNum
          : (serviceDefaults[vehicleType]?.service_interval_weeks ?? 6)
        const d = new Date(lastServiceDate)
        d.setDate(d.getDate() + interval * 7)
        payload.next_service_due = isoDate(d)
      } else {
        payload.next_service_due = null
      }
    }

    if (editingVehicle) {
      const { error } = await supabase
        .from('vehicles')
        .update(payload)
        .eq('id', editingVehicle.id)

      setSubmitting(false)

      if (error) {
        showMessage('Error saving: ' + error.message, 'error')
        return
      }

      await logAuditClient({
        user: currentUser,
        action: 'VEHICLE_UPDATED',
        entity: 'vehicle',
        entity_id: editingVehicle.id,
        details: payload,
      })

      showMessage('Vehicle updated', 'success')
    } else {
      const { data, error } = await supabase
        .from('vehicles')
        .insert({ ...payload, created_by: currentUser.id })
        .select()
        .single()

      setSubmitting(false)

      if (error) {
        showMessage('Error creating: ' + error.message, 'error')
        return
      }

      await logAuditClient({
        user: currentUser,
        action: 'VEHICLE_CREATED',
        entity: 'vehicle',
        entity_id: data?.id,
        details: payload,
      })

      showMessage('Vehicle added', 'success')
    }

    resetForm()
    setShowForm(false)
  }

  const handleDelete = async (vehicle: any) => {
    if (!confirm(`Delete ${vehicle.registration}? This will remove all check history and defects for this vehicle.`)) return

    const { error } = await supabase
      .from('vehicles')
      .delete()
      .eq('id', vehicle.id)

    if (error) {
      showMessage('Error deleting: ' + error.message, 'error')
      return
    }

    await logAuditClient({
      user: currentUser,
      action: 'VEHICLE_DELETED',
      entity: 'vehicle',
      entity_id: vehicle.id,
      details: {
        registration: vehicle.registration,
        fleet_number: vehicle.fleet_number,
        vehicle_type: vehicle.vehicle_type,
      },
    })

    showMessage('Vehicle deleted', 'success')
  }

  const getTypeIcon = (type: string) => ALL_VEHICLE_TYPES.find(t => t.value === type)?.icon || '🚗'
  const getTypeLabel = (type: string) => ALL_VEHICLE_TYPES.find(t => t.value === type)?.label || type

  const filteredVehicles = vehicles
    .filter(v => showInactive ? true : v.active)
    .filter(v => filterType === 'all' ? true : v.vehicle_type === filterType)
    .filter(v => {
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return v.registration.toLowerCase().includes(q) ||
        (v.fleet_number || '').toLowerCase().includes(q) ||
        (v.name || '').toLowerCase().includes(q)
    })

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-500">Loading vehicles...</p>
      </main>
    )
  }

  if (visibleVehicleTypes.length === 0) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="bg-white rounded-xl shadow p-8 max-w-md text-center">
          <p className="text-5xl mb-3">🚛</p>
          <p className="text-gray-700 font-medium mb-2">No vehicle types enabled</p>
          <p className="text-sm text-gray-500 mb-4">
            Ask your superuser to enable at least one vehicle type for this company in the company settings.
          </p>
          <button
            onClick={() => router.push('/dashboard')}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm"
          >
            ← Back to Dashboard
          </button>
        </div>
      </main>
    )
  }

  const previewNext = previewNextServiceDue()
  const defaultIntervalForType = serviceDefaults[vehicleType]?.service_interval_weeks

  return (
    <main className="min-h-screen bg-gray-100">
      <div className="bg-blue-700 text-white px-6 py-4 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">{company?.name}</h1>
          <p className="text-blue-200 text-sm">Vehicles</p>
        </div>
        <button
          onClick={() => router.push('/dashboard')}
          className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm"
        >
          ← Back
        </button>
      </div>

      <div className="max-w-6xl mx-auto p-6 space-y-4">

        {message && (
          <div className={`p-4 rounded-lg text-sm font-medium ${
            messageType === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            {message}
          </div>
        )}

        <div className="flex justify-between items-center flex-wrap gap-3">
          <h2 className="text-xl font-semibold text-gray-800">Fleet Management</h2>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => router.push('/dashboard/vehicle-checks/templates')}
              className="bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium"
            >
              📋 Checklists
            </button>
            <button
              onClick={() => router.push('/dashboard/vehicle-checks/defects')}
              className="bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium"
            >
              ⚠️ Defects
            </button>
            <button
              onClick={() => router.push('/dashboard/vehicle-checks/reports')}
              className="bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium"
            >
              📊 Reports
            </button>
            {hasServicesFeature && (
              <>
                <button
                  onClick={() => router.push('/dashboard/services/templates')}
                  className="bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium"
                >
                  🔧 Service Templates
                </button>
                <button
                  onClick={() => router.push('/dashboard/services/settings')}
                  className="bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium"
                >
                  ⚙️ Service Settings
                </button>
              </>
            )}
            <button
              onClick={() => {
                resetForm()
                setShowForm(!showForm)
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              {showForm ? 'Cancel' : '+ Add Vehicle'}
            </button>
          </div>
        </div>

        {showForm && (
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">
              {editingVehicle ? `Edit — ${editingVehicle.registration}` : 'New Vehicle'}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Registration <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={registration}
                    onChange={(e) => setRegistration(e.target.value.toUpperCase())}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 uppercase font-mono"
                    placeholder="AB12 CDE"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Fleet Number <span className="text-gray-400">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={fleetNumber}
                    onChange={(e) => setFleetNumber(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                    placeholder="e.g. 142"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vehicle Type *</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {visibleVehicleTypes.map(t => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setVehicleType(t.value)}
                      className={`p-3 rounded-lg border-2 text-left transition ${
                        vehicleType === t.value
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="text-2xl mb-1">{t.icon}</div>
                      <p className="text-sm font-medium text-gray-800">{t.label}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name / Make-Model <span className="text-gray-400">(optional)</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                  placeholder="e.g. Volvo B9R, Scania G410"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notes <span className="text-gray-400">(optional)</span>
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                  placeholder="Any extra info"
                />
              </div>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-sm font-medium text-gray-700">Vehicle is active</span>
              </label>

              {/* ╔══════════════════════════════════════════════════╗
                  ║ COMPLIANCE & SERVICE — only if feature enabled  ║
                  ╚══════════════════════════════════════════════════╝ */}
              {hasServicesFeature && (
                <fieldset className="border-t-2 border-gray-100 pt-4 mt-4 space-y-4">
                  <legend className="px-2 -ml-2 text-sm font-semibold text-gray-700">
                    🔧 Compliance & Service
                  </legend>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Service interval */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Service interval (weeks)
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={52}
                        value={serviceIntervalWeeks}
                        onChange={e => setServiceIntervalWeeks(e.target.value)}
                        placeholder={defaultIntervalForType ? `Company default: ${defaultIntervalForType}` : 'e.g. 6'}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Leave blank to use company default ({defaultIntervalForType || 6} weeks).
                      </p>
                    </div>

                    {/* Current mileage */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Current mileage <span className="text-gray-400">(optional)</span>
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={currentMileage}
                        onChange={e => setCurrentMileage(e.target.value)}
                        placeholder="e.g. 124500"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                      />
                    </div>

                    {/* Last service date */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Last service date
                      </label>
                      <input
                        type="date"
                        value={lastServiceDate}
                        onChange={e => setLastServiceDate(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                      />
                      {previewNext && (
                        <p className="text-xs text-emerald-700 mt-1">
                          → Next service due: {new Date(previewNext).toLocaleDateString('en-GB')}
                        </p>
                      )}
                      <p className="text-xs text-gray-500 mt-1">
                        Auto-updates when a safety inspection is completed.
                      </p>
                    </div>

                    {/* MOT expiry */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        MOT expiry date
                      </label>
                      <input
                        type="date"
                        value={motExpiryDate}
                        onChange={e => setMotExpiryDate(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Auto-updates when MOT prep passes (mechanic enters new cert date).
                      </p>
                    </div>

                    {/* Tacho — optional */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Tacho calibration date <span className="text-gray-400">(optional)</span>
                      </label>
                      <input
                        type="date"
                        value={tachoCalibrationDate}
                        onChange={e => setTachoCalibrationDate(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                      />
                    </div>

                    {/* Tax — optional */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Tax (VED) due date <span className="text-gray-400">(optional)</span>
                      </label>
                      <input
                        type="date"
                        value={taxDueDate}
                        onChange={e => setTaxDueDate(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                      />
                    </div>

                    {/* LOLER — optional */}
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        LOLER inspection due date <span className="text-gray-400">(optional, if vehicle has lifting equipment)</span>
                      </label>
                      <input
                        type="date"
                        value={lolerDueDate}
                        onChange={e => setLolerDueDate(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                      />
                    </div>
                  </div>
                </fieldset>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : (editingVehicle ? 'Save Changes' : 'Add Vehicle')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    resetForm()
                    setShowForm(false)
                  }}
                  className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-6 py-3 rounded-lg font-medium transition"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="bg-white rounded-xl shadow p-4 flex flex-wrap gap-3 items-center">
          <input
            type="text"
            placeholder="Search by registration, fleet number or name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
          />

          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white"
          >
            <option value="all">All types</option>
            {visibleVehicleTypes.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>

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

        {filteredVehicles.length === 0 ? (
          <div className="bg-white rounded-xl shadow p-12 text-center">
            <div className="text-5xl mb-3">🚛</div>
            <p className="text-gray-500 mb-1">
              {vehicles.length === 0 ? 'No vehicles yet' : 'No vehicles match your filters'}
            </p>
            {vehicles.length === 0 && (
              <button
                onClick={() => setShowForm(true)}
                className="mt-4 text-blue-600 hover:underline text-sm font-medium"
              >
                Add your first vehicle →
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow overflow-hidden">
            <ul className="divide-y divide-gray-100">
              {filteredVehicles.map(v => {
                const openDefects = openDefectsByVehicle[v.id] || 0
                const serviceBadge = hasServicesFeature ? complianceBadge(v.next_service_due, 'Service') : null
                const motBadge     = hasServicesFeature ? complianceBadge(v.mot_expiry_date,  'MOT')     : null
                const tachoBadge   = hasServicesFeature ? complianceBadge(v.tacho_calibration_date, 'Tacho') : null
                const taxBadge     = hasServicesFeature ? complianceBadge(v.tax_due_date,     'Tax')     : null
                const lolerBadge   = hasServicesFeature ? complianceBadge(v.loler_due_date,   'LOLER')   : null
                return (
                  <li key={v.id} className={`p-4 ${!v.active ? 'opacity-60' : ''}`}>
                    <div className="flex justify-between items-start gap-3">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className="text-3xl flex-shrink-0">{getTypeIcon(v.vehicle_type)}</div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-bold text-gray-800 font-mono uppercase">{v.registration}</p>
                            {v.fleet_number && (
                              <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
                                Fleet #{v.fleet_number}
                              </span>
                            )}
                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                              {getTypeLabel(v.vehicle_type)}
                            </span>
                            {!v.active && (
                              <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full font-medium">
                                Inactive
                              </span>
                            )}
                            {openDefects > 0 && (
                              <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
                                ⚠️ {openDefects} open defect{openDefects > 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                          {v.name && (
                            <p className="text-sm text-gray-600 mt-0.5">{v.name}</p>
                          )}
                          {v.notes && (
                            <p className="text-xs text-gray-500 mt-1 italic">{v.notes}</p>
                          )}

                          {/* Compliance row */}
                          {hasServicesFeature && (serviceBadge || motBadge || tachoBadge || taxBadge || lolerBadge) && (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {[serviceBadge, motBadge, tachoBadge, taxBadge, lolerBadge].filter(Boolean).map((b, i) => (
                                <span key={i}
                                  className={`text-[11px] border px-1.5 py-0.5 rounded font-medium ${b!.color}`}>
                                  {b!.text}
                                </span>
                              ))}
                              {v.current_mileage != null && (
                                <span className="text-[11px] border border-gray-200 bg-gray-50 text-gray-600 px-1.5 py-0.5 rounded font-medium">
                                  {v.current_mileage.toLocaleString()} mi
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex gap-2 flex-shrink-0">
                        <button
                          onClick={() => handleStartEdit(v)}
                          className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(v)}
                          className="text-sm bg-red-100 hover:bg-red-200 text-red-700 px-3 py-1.5 rounded-lg"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

      </div>
    </main>
  )
}
