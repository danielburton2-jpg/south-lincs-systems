'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useIdleLogout, IdleWarningModal } from '@/lib/useIdleLogout'

const supabase = createClient()

const VEHICLE_TYPE_ICONS: Record<string, string> = {
  class_1: '🚛',
  class_2: '🚚',
  bus: '🚌',
  coach: '🚍',
  minibus: '🚐',
}

const VEHICLE_TYPE_LABELS: Record<string, string> = {
  class_1: 'Class 1',
  class_2: 'Class 2',
  bus: 'Bus',
  coach: 'Coach',
  minibus: 'Minibus',
}

const MAX_PHOTO_SIZE = 10 * 1024 * 1024

export default function ReportDefectPage() {
  const router = useRouter()
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [vehicles, setVehicles] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  // Form
  const [step, setStep] = useState<'pick-vehicle' | 'fill-form'>('pick-vehicle')
  const [search, setSearch] = useState('')
  const [selectedVehicle, setSelectedVehicle] = useState<any>(null)
  const [category, setCategory] = useState('')
  const [itemText, setItemText] = useState('')
  const [defectNote, setDefectNote] = useState('')
  const [pendingPhotos, setPendingPhotos] = useState<File[]>([])
  const [photoUploading, setPhotoUploading] = useState(false)

  const { showWarning, secondsLeft, stayLoggedIn } = useIdleLogout(true)

  const showMessage = (msg: string, type: 'success' | 'error') => {
    setMessage(msg)
    setMessageType(type)
    setTimeout(() => setMessage(''), 4000)
  }

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

    if (!profile.company_id) {
      router.push('/employee')
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
      router.push('/employee')
      return
    }

    const { data: userFeats } = await supabase
      .from('user_features')
      .select('is_enabled, features (name)')
      .eq('user_id', user.id)
      .eq('is_enabled', true)
    const userHasFeature = (userFeats as any[])?.some(
      (uf: any) => uf.features?.name === 'Vehicle Checks'
    )
    if (!userHasFeature) {
      router.push('/employee')
      return
    }

    const { data: vehData } = await supabase
      .from('vehicles')
      .select('*')
      .eq('company_id', profile.company_id)
      .eq('active', true)
      .order('registration', { ascending: true })

    setVehicles(vehData || [])
    setLoading(false)
  }, [router])

  useEffect(() => { init() }, [init])

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > MAX_PHOTO_SIZE) {
      showMessage('Photo too large (max 10 MB)', 'error')
      e.target.value = ''
      return
    }
    setPendingPhotos(prev => [...prev, file])
    e.target.value = ''
  }

  const removePendingPhoto = (idx: number) => {
    setPendingPhotos(prev => prev.filter((_, i) => i !== idx))
  }

  const handleSubmit = async () => {
    if (!selectedVehicle) {
      showMessage('Pick a vehicle first', 'error')
      return
    }
    if (!category.trim()) {
      showMessage('Please enter a category', 'error')
      return
    }
    if (!itemText.trim()) {
      showMessage('Please describe what the issue is', 'error')
      return
    }
    if (!defectNote.trim()) {
      showMessage('Please add a defect note describing the problem', 'error')
      return
    }

    setSubmitting(true)

    // Step 1 — create a "standalone" check that documents this defect
    const todayIso = new Date().toISOString().slice(0, 10)
    const { data: check, error: checkErr } = await supabase
      .from('vehicle_checks')
      .insert({
        company_id: currentUser.company_id,
        vehicle_id: selectedVehicle.id,
        driver_id: currentUser.id,
        check_date: todayIso,
        has_defects: true,
        driver_signature: currentUser.full_name,
        driver_notes: 'Standalone defect report',
        completed_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (checkErr || !check) {
      setSubmitting(false)
      showMessage('Could not create defect record: ' + (checkErr?.message || 'unknown'), 'error')
      return
    }

    // Step 2 — create a single failed check_item to link the defect to
    const { data: checkItem, error: itemErr } = await supabase
      .from('vehicle_check_items')
      .insert({
        check_id: check.id,
        category: category.trim(),
        item_text: itemText.trim(),
        result: 'fail',
        defect_note: defectNote.trim(),
        display_order: 10,
      })
      .select()
      .single()

    if (itemErr || !checkItem) {
      setSubmitting(false)
      showMessage('Could not save defect: ' + (itemErr?.message || 'unknown'), 'error')
      return
    }

    // Step 3 — create the open defect entry
    const { error: defErr } = await supabase
      .from('vehicle_defects')
      .insert({
        company_id: currentUser.company_id,
        vehicle_id: selectedVehicle.id,
        check_id: check.id,
        check_item_id: checkItem.id,
        reported_by: currentUser.id,
        category: category.trim(),
        item_text: itemText.trim(),
        defect_note: defectNote.trim(),
        status: 'open',
      })

    if (defErr) {
      setSubmitting(false)
      showMessage('Defect record failed: ' + defErr.message, 'error')
      return
    }

    // Step 4 — upload photos (if any) against the check_item
    if (pendingPhotos.length > 0) {
      setPhotoUploading(true)
      for (const file of pendingPhotos) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const path = `${currentUser.company_id}/${check.id}/${checkItem.id}/${Date.now()}_${safeName}`

        const { error: upErr } = await supabase.storage
          .from('vehicle-check-photos')
          .upload(path, file, {
            cacheControl: '3600',
            upsert: false,
            contentType: file.type || 'image/jpeg',
          })

        if (upErr) continue

        await supabase.from('vehicle_check_photos').insert({
          check_item_id: checkItem.id,
          company_id: currentUser.company_id,
          storage_path: path,
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type || null,
          uploaded_by: currentUser.id,
        })
      }
      setPhotoUploading(false)
    }

    setSubmitting(false)
    showMessage('Defect reported', 'success')
    setTimeout(() => {
      router.push('/employee/vehicle-checks/defects')
    }, 800)
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Loading...</p>
      </main>
    )
  }

  const filteredVehicles = vehicles.filter(v => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return v.registration.toLowerCase().includes(q) ||
      (v.fleet_number || '').toLowerCase().includes(q) ||
      (v.name || '').toLowerCase().includes(q)
  })

  return (
    <main className="min-h-screen bg-gray-50 pb-32">
      <IdleWarningModal show={showWarning} secondsLeft={secondsLeft} onStay={stayLoggedIn} />

      <div className="bg-gradient-to-br from-red-600 to-red-800 text-white px-6 pt-10 pb-6 rounded-b-3xl shadow-lg">
        <div className="flex items-center justify-between">
          <button
            onClick={() => {
              if (step === 'fill-form') {
                setStep('pick-vehicle')
                setSelectedVehicle(null)
              } else {
                router.push('/employee/vehicle-checks/defects')
              }
            }}
            className="text-red-100 text-sm hover:text-white"
          >
            ← Back
          </button>
          <p className="text-red-100 text-sm">{company?.name}</p>
        </div>
        <h1 className="text-2xl font-bold mt-2">⚠️ Report Defect</h1>
        <p className="text-red-100 text-sm mt-1">
          {step === 'pick-vehicle' ? 'Step 1 of 2 — pick the vehicle' : 'Step 2 of 2 — describe the issue'}
        </p>
      </div>

      <div className="px-4 pt-4 space-y-3">

        {message && (
          <div className={`p-3 rounded-xl text-sm font-medium ${
            messageType === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            {message}
          </div>
        )}

        {step === 'pick-vehicle' && (
          <>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-2">
              <input
                type="text"
                placeholder="Search registration, fleet number..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
                className="w-full border-0 px-3 py-3 text-base text-gray-900 focus:outline-none"
              />
            </div>

            {filteredVehicles.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-sm p-8 border border-gray-100 text-center">
                <p className="text-5xl mb-3">🚛</p>
                <p className="text-gray-500 text-sm">
                  {vehicles.length === 0 ? 'No vehicles available' : 'No matches'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredVehicles.map(v => (
                  <button
                    key={v.id}
                    onClick={() => {
                      setSelectedVehicle(v)
                      setStep('fill-form')
                    }}
                    className="w-full text-left bg-white hover:bg-gray-50 active:bg-gray-100 rounded-2xl shadow-sm border border-gray-100 p-4 transition"
                  >
                    <div className="flex items-start gap-3">
                      <div className="text-3xl flex-shrink-0">{VEHICLE_TYPE_ICONS[v.vehicle_type] || '🚗'}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-mono font-bold text-gray-800">{v.registration}</p>
                          {v.fleet_number && (
                            <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
                              #{v.fleet_number}
                            </span>
                          )}
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                            {VEHICLE_TYPE_LABELS[v.vehicle_type]}
                          </span>
                        </div>
                        {v.name && <p className="text-sm text-gray-600 mt-0.5">{v.name}</p>}
                      </div>
                      <span className="bg-red-600 text-white text-xs font-bold px-3 py-2 rounded-full flex-shrink-0 self-center">
                        Pick
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {step === 'fill-form' && selectedVehicle && (
          <>
            {/* Vehicle summary */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Vehicle</p>
              <div className="flex items-center gap-3">
                <span className="text-3xl">{VEHICLE_TYPE_ICONS[selectedVehicle.vehicle_type] || '🚗'}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-mono font-bold text-gray-800">{selectedVehicle.registration}</p>
                    {selectedVehicle.fleet_number && (
                      <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
                        #{selectedVehicle.fleet_number}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {VEHICLE_TYPE_LABELS[selectedVehicle.vehicle_type]}
                    {selectedVehicle.name && ` · ${selectedVehicle.name}`}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setStep('pick-vehicle')
                    setSelectedVehicle(null)
                  }}
                  className="text-xs text-red-700 hover:underline"
                >
                  Change
                </button>
              </div>
            </div>

            {/* Defect form */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-4">

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Category <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="e.g. Lights, Tyres, Brakes"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  What's wrong <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={itemText}
                  onChange={(e) => setItemText(e.target.value)}
                  placeholder="e.g. Driver's side mirror cracked"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Details <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={defectNote}
                  onChange={(e) => setDefectNote(e.target.value)}
                  rows={4}
                  placeholder="Describe the defect in detail..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Photos {pendingPhotos.length > 0 && `(${pendingPhotos.length})`}
                </label>
                {pendingPhotos.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    {pendingPhotos.map((p, idx) => (
                      <div key={idx} className="relative">
                        <div className="bg-gray-100 rounded-lg p-2 text-center">
                          <span className="text-3xl">📷</span>
                          <p className="text-[10px] text-gray-600 truncate">{p.name}</p>
                        </div>
                        <button
                          onClick={() => removePendingPhoto(idx)}
                          className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 text-xs leading-none flex items-center justify-center"
                          title="Remove"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <label className="inline-block bg-white hover:bg-gray-50 border border-red-300 text-red-700 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer">
                  📷 Add Photo
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handlePhotoSelect}
                    className="hidden"
                  />
                </label>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
                <p className="font-medium">📝 Reported by</p>
                <p className="mt-0.5">{currentUser?.full_name}</p>
              </div>

            </div>
          </>
        )}

      </div>

      {/* Sticky bottom: Submit button (only on form step) */}
      {step === 'fill-form' && selectedVehicle && (
        <div className="fixed bottom-16 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 shadow-lg">
          <button
            onClick={handleSubmit}
            disabled={submitting || photoUploading}
            className="w-full bg-red-600 hover:bg-red-700 text-white py-3 rounded-xl font-bold text-sm disabled:opacity-50"
          >
            {submitting || photoUploading ? 'Submitting...' : '⚠️ Submit Defect Report'}
          </button>
        </div>
      )}

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg">
        <div className="flex justify-around items-center h-16 max-w-md mx-auto">
          <button onClick={() => router.push('/employee')} className="flex flex-col items-center gap-0.5 text-gray-400 hover:text-gray-600">
            <span className="text-xl">🏠</span>
            <span className="text-xs font-medium">Home</span>
          </button>
          <button onClick={() => router.push('/employee/profile')} className="flex flex-col items-center gap-0.5 text-gray-400 hover:text-gray-600">
            <span className="text-xl">👤</span>
            <span className="text-xs font-medium">Profile</span>
          </button>
        </div>
      </nav>
    </main>
  )
}
