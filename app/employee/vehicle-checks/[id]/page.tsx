'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'
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

export default function VehicleCheckFormPage() {
  const router = useRouter()
  const params = useParams()
  const checkId = params?.id as string

  const [currentUser, setCurrentUser] = useState<any>(null)
  const [check, setCheck] = useState<any>(null)
  const [vehicle, setVehicle] = useState<any>(null)
  const [items, setItems] = useState<any[]>([])
  const [photos, setPhotos] = useState<Record<string, any[]>>({}) // by check_item_id
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  const [openItemId, setOpenItemId] = useState<string | null>(null)
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set())

  const [driverNotes, setDriverNotes] = useState('')
  const [driverSignature, setDriverSignature] = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [photoUploadingFor, setPhotoUploadingFor] = useState<string | null>(null)

  const { showWarning, secondsLeft, stayLoggedIn } = useIdleLogout(true)

  const showMessage = (msg: string, type: 'success' | 'error') => {
    setMessage(msg)
    setMessageType(type)
    setTimeout(() => setMessage(''), 4000)
  }

  const loadAll = useCallback(async () => {
    if (!checkId) return

    // Load check + vehicle
    const { data: checkData, error: checkErr } = await supabase
      .from('vehicle_checks')
      .select('*, vehicle:vehicles(*)')
      .eq('id', checkId)
      .single()

    if (checkErr || !checkData) {
      router.push('/employee/vehicle-checks')
      return
    }

    setCheck(checkData)
    setVehicle(checkData.vehicle)
    setDriverNotes(checkData.driver_notes || '')
    setDriverSignature(checkData.driver_signature || '')

    // Load items
    const { data: itemsData } = await supabase
      .from('vehicle_check_items')
      .select('*')
      .eq('check_id', checkId)
      .order('display_order', { ascending: true })

    setItems(itemsData || [])

    // Load photos for failed items
    const failedItemIds = (itemsData || []).filter(i => i.result === 'fail').map(i => i.id)
    if (failedItemIds.length > 0) {
      const { data: photosData } = await supabase
        .from('vehicle_check_photos')
        .select('*')
        .in('check_item_id', failedItemIds)

      const map: Record<string, any[]> = {}
      ;(photosData || []).forEach((p: any) => {
        if (!map[p.check_item_id]) map[p.check_item_id] = []
        map[p.check_item_id].push(p)
      })
      setPhotos(map)
    }
  }, [checkId, router])

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
    await loadAll()
    setLoading(false)
  }, [router, loadAll])

  useEffect(() => { init() }, [init])

  // Update item result
  const updateItemResult = async (itemId: string, result: 'pass' | 'fail' | 'na') => {
    setSaving(true)

    // If switching from fail to pass/na, optionally clear note? Keep it for now (admin can see history).
    const updates: any = { result }
    if (result !== 'fail') {
      // Don't clear the note — could be useful audit trail
    }

    const { error } = await supabase
      .from('vehicle_check_items')
      .update(updates)
      .eq('id', itemId)

    setSaving(false)

    if (error) {
      showMessage('Could not save: ' + error.message, 'error')
      return
    }

    // Local update for instant UI
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, result } : i))

    // If they marked it as fail, auto-open the defect note expander
    if (result === 'fail') {
      setOpenItemId(itemId)
    } else if (openItemId === itemId) {
      setOpenItemId(null)
    }
  }

  // Update defect note (debounced via blur)
  const updateDefectNote = async (itemId: string, note: string) => {
    const { error } = await supabase
      .from('vehicle_check_items')
      .update({ defect_note: note })
      .eq('id', itemId)

    if (error) {
      showMessage('Could not save note: ' + error.message, 'error')
      return
    }

    setItems(prev => prev.map(i => i.id === itemId ? { ...i, defect_note: note } : i))
  }

  // Photo upload
  const handlePhotoSelect = async (itemId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > MAX_PHOTO_SIZE) {
      showMessage('Photo too large (max 10 MB)', 'error')
      e.target.value = ''
      return
    }

    setPhotoUploadingFor(itemId)

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `${currentUser.company_id}/${checkId}/${itemId}/${Date.now()}_${safeName}`

    const { error: upErr } = await supabase.storage
      .from('vehicle-check-photos')
      .upload(path, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type || 'image/jpeg',
      })

    if (upErr) {
      showMessage('Upload failed: ' + upErr.message, 'error')
      setPhotoUploadingFor(null)
      e.target.value = ''
      return
    }

    const { data: photoRow, error: rowErr } = await supabase
      .from('vehicle_check_photos')
      .insert({
        check_item_id: itemId,
        company_id: currentUser.company_id,
        storage_path: path,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type || null,
        uploaded_by: currentUser.id,
      })
      .select()
      .single()

    if (rowErr) {
      showMessage('Saved file but DB row failed: ' + rowErr.message, 'error')
      setPhotoUploadingFor(null)
      e.target.value = ''
      return
    }

    // Update local state
    setPhotos(prev => ({
      ...prev,
      [itemId]: [...(prev[itemId] || []), photoRow],
    }))

    setPhotoUploadingFor(null)
    e.target.value = ''
    showMessage('Photo uploaded', 'success')
  }

  const removePhoto = async (photo: any) => {
    if (!confirm('Remove this photo?')) return

    await supabase.storage.from('vehicle-check-photos').remove([photo.storage_path])
    await supabase.from('vehicle_check_photos').delete().eq('id', photo.id)

    setPhotos(prev => {
      const copy = { ...prev }
      copy[photo.check_item_id] = (copy[photo.check_item_id] || []).filter(p => p.id !== photo.id)
      return copy
    })
  }

  // Submit final check
  const handleSubmit = async () => {
    // Find failed items needing notes
    const failedNoNote = items.filter(i => i.result === 'fail' && !(i.defect_note || '').trim())
    if (failedNoNote.length > 0) {
      showMessage(`${failedNoNote.length} failed item${failedNoNote.length > 1 ? 's need' : ' needs'} a defect note before submitting`, 'error')
      // Auto-open first failing item
      setOpenItemId(failedNoNote[0].id)
      return
    }

    if (!driverSignature.trim()) {
      showMessage('Please type your name to sign off the check', 'error')
      return
    }

    setSubmitting(true)

    const failedItems = items.filter(i => i.result === 'fail')
    const hasDefects = failedItems.length > 0

    // Update the check
    const { error: checkErr } = await supabase
      .from('vehicle_checks')
      .update({
        has_defects: hasDefects,
        driver_signature: driverSignature.trim(),
        driver_notes: driverNotes.trim() || null,
        completed_at: new Date().toISOString(),
      })
      .eq('id', checkId)

    if (checkErr) {
      setSubmitting(false)
      showMessage('Could not submit: ' + checkErr.message, 'error')
      return
    }

    // For each failed item, create a vehicle_defect row (only if not already exists for this check_item)
    if (hasDefects) {
      const { data: existingDefects } = await supabase
        .from('vehicle_defects')
        .select('check_item_id')
        .eq('check_id', checkId)

      const existingItemIds = new Set((existingDefects || []).map((d: any) => d.check_item_id))

      const newDefects = failedItems
        .filter(i => !existingItemIds.has(i.id))
        .map(i => ({
          company_id: currentUser.company_id,
          vehicle_id: vehicle.id,
          check_id: checkId,
          check_item_id: i.id,
          reported_by: currentUser.id,
          category: i.category,
          item_text: i.item_text,
          defect_note: i.defect_note,
          status: 'open',
        }))

      if (newDefects.length > 0) {
        await supabase.from('vehicle_defects').insert(newDefects)
      }
    }

    setSubmitting(false)
    showMessage('Check submitted!', 'success')
    setTimeout(() => {
      router.push('/employee/vehicle-checks')
    }, 1000)
  }

  const toggleCategory = (category: string) => {
    setCollapsedCategories(prev => {
      const copy = new Set(prev)
      if (copy.has(category)) copy.delete(category)
      else copy.add(category)
      return copy
    })
  }

  const openPhoto = async (photo: any) => {
    const { data, error } = await supabase.storage
      .from('vehicle-check-photos')
      .createSignedUrl(photo.storage_path, 60)
    if (error || !data?.signedUrl) {
      showMessage('Could not open photo', 'error')
      return
    }
    window.location.href = data.signedUrl
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Loading check...</p>
      </main>
    )
  }

  if (!check || !vehicle) return null

  // Group items by category
  const grouped: Record<string, any[]> = {}
  items.forEach(item => {
    if (!grouped[item.category]) grouped[item.category] = []
    grouped[item.category].push(item)
  })
  Object.keys(grouped).forEach(cat => {
    grouped[cat].sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
  })
  const categoryOrder = Object.entries(grouped)
    .map(([cat, list]) => ({ cat, firstOrder: list[0]?.display_order || 0 }))
    .sort((a, b) => a.firstOrder - b.firstOrder)
    .map(x => x.cat)

  const totalItems = items.length
  const passCount = items.filter(i => i.result === 'pass').length
  const failCount = items.filter(i => i.result === 'fail').length
  const naCount = items.filter(i => i.result === 'na').length

  const isCompleted = !!check.driver_signature

  return (
    <main className="min-h-screen bg-gray-50 pb-32">
      <IdleWarningModal show={showWarning} secondsLeft={secondsLeft} onStay={stayLoggedIn} />

      <div className="bg-gradient-to-br from-red-600 to-red-800 text-white px-6 pt-10 pb-6 rounded-b-3xl shadow-lg">
        <div className="flex items-center justify-between">
          <button
            onClick={() => router.push('/employee/vehicle-checks')}
            className="text-red-100 text-sm hover:text-white"
          >
            ← Back
          </button>
          {isCompleted && (
            <span className="text-xs bg-green-500 text-white px-2 py-1 rounded-full font-medium">
              ✓ Completed
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-2">
          <span className="text-3xl">{VEHICLE_TYPE_ICONS[vehicle.vehicle_type] || '🚗'}</span>
          <div>
            <h1 className="text-xl font-bold font-mono">{vehicle.registration}</h1>
            <p className="text-red-100 text-xs">
              {VEHICLE_TYPE_LABELS[vehicle.vehicle_type]}
              {vehicle.fleet_number && ` · #${vehicle.fleet_number}`}
              {vehicle.name && ` · ${vehicle.name}`}
            </p>
          </div>
        </div>
      </div>

      <div className="px-4 pt-4 space-y-3">

        {message && (
          <div className={`p-3 rounded-xl text-sm font-medium ${
            messageType === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            {message}
          </div>
        )}

        {/* Progress summary */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Progress</p>
            <p className="text-xs text-gray-500">{passCount + failCount + naCount} / {totalItems}</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-green-50 border border-green-200 rounded-lg p-2 text-center">
              <p className="text-xl font-bold text-green-700">{passCount}</p>
              <p className="text-xs text-green-600 font-medium">Pass</p>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-center">
              <p className="text-xl font-bold text-red-700">{failCount}</p>
              <p className="text-xs text-red-600 font-medium">Fail</p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-2 text-center">
              <p className="text-xl font-bold text-gray-700">{naCount}</p>
              <p className="text-xs text-gray-600 font-medium">N/A</p>
            </div>
          </div>
        </div>

        {/* Categories */}
        {categoryOrder.map(category => {
          const list = grouped[category] || []
          const collapsed = collapsedCategories.has(category)
          const catFails = list.filter(i => i.result === 'fail').length

          return (
            <div key={category} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <button
                onClick={() => toggleCategory(category)}
                className="w-full bg-gray-50 px-4 py-3 flex items-center justify-between hover:bg-gray-100 transition"
              >
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-gray-800 text-sm uppercase tracking-wide">{category}</h3>
                  <span className="text-xs text-gray-500">({list.length})</span>
                  {catFails > 0 && (
                    <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
                      ⚠️ {catFails} fail
                    </span>
                  )}
                </div>
                <span className="text-gray-400 text-sm">{collapsed ? '▼' : '▲'}</span>
              </button>

              {!collapsed && (
                <ul className="divide-y divide-gray-100">
                  {list.map(item => {
                    const isOpen = openItemId === item.id
                    const itemPhotos = photos[item.id] || []
                    return (
                      <li key={item.id} className="p-3">
                        <div className="flex items-start gap-2">
                          <p className="flex-1 text-sm text-gray-800 leading-snug">{item.item_text}</p>
                        </div>

                        {/* Pass / Fail / N/A buttons */}
                        <div className="grid grid-cols-3 gap-2 mt-2">
                          <button
                            onClick={() => updateItemResult(item.id, 'pass')}
                            disabled={isCompleted}
                            className={`py-2 rounded-lg text-sm font-medium border-2 transition disabled:opacity-50 ${
                              item.result === 'pass'
                                ? 'bg-green-500 border-green-500 text-white'
                                : 'bg-white border-gray-200 text-gray-700 hover:border-green-300'
                            }`}
                          >
                            ✓ Pass
                          </button>
                          <button
                            onClick={() => updateItemResult(item.id, 'fail')}
                            disabled={isCompleted}
                            className={`py-2 rounded-lg text-sm font-medium border-2 transition disabled:opacity-50 ${
                              item.result === 'fail'
                                ? 'bg-red-500 border-red-500 text-white'
                                : 'bg-white border-gray-200 text-gray-700 hover:border-red-300'
                            }`}
                          >
                            ✗ Fail
                          </button>
                          <button
                            onClick={() => updateItemResult(item.id, 'na')}
                            disabled={isCompleted}
                            className={`py-2 rounded-lg text-sm font-medium border-2 transition disabled:opacity-50 ${
                              item.result === 'na'
                                ? 'bg-gray-500 border-gray-500 text-white'
                                : 'bg-white border-gray-200 text-gray-700 hover:border-gray-400'
                            }`}
                          >
                            – N/A
                          </button>
                        </div>

                        {/* Defect note + photos (only when failed) */}
                        {item.result === 'fail' && (
                          <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
                            <div>
                              <label className="block text-xs font-medium text-red-800 mb-1">
                                Defect note <span className="text-red-600">*</span>
                              </label>
                              <textarea
                                defaultValue={item.defect_note || ''}
                                onBlur={(e) => updateDefectNote(item.id, e.target.value)}
                                disabled={isCompleted}
                                rows={2}
                                placeholder="Describe the defect..."
                                className="w-full border border-red-300 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white disabled:opacity-50"
                              />
                            </div>

                            {/* Photos */}
                            <div>
                              <p className="text-xs font-medium text-red-800 mb-1">
                                Photos {itemPhotos.length > 0 && `(${itemPhotos.length})`}
                              </p>
                              {itemPhotos.length > 0 && (
                                <div className="grid grid-cols-3 gap-2 mb-2">
                                  {itemPhotos.map(p => (
                                    <div key={p.id} className="relative">
                                      <button
                                        onClick={() => openPhoto(p)}
                                        className="w-full bg-gray-200 rounded-lg p-2 text-center hover:bg-gray-300 transition"
                                      >
                                        <span className="text-3xl">📷</span>
                                        <p className="text-[10px] text-gray-600 truncate">{p.file_name}</p>
                                      </button>
                                      {!isCompleted && (
                                        <button
                                          onClick={() => removePhoto(p)}
                                          className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 text-xs leading-none flex items-center justify-center"
                                          title="Remove"
                                        >
                                          ×
                                        </button>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                              {!isCompleted && (
                                <label className="inline-block bg-white hover:bg-gray-50 border border-red-300 text-red-700 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer">
                                  {photoUploadingFor === item.id ? 'Uploading...' : '📷 Add Photo'}
                                  <input
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    onChange={(e) => handlePhotoSelect(item.id, e)}
                                    disabled={photoUploadingFor === item.id}
                                    className="hidden"
                                  />
                                </label>
                              )}
                            </div>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}

        {/* Driver notes + signature */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Notes <span className="text-gray-400">(optional)</span>
            </label>
            <textarea
              value={driverNotes}
              onChange={(e) => setDriverNotes(e.target.value)}
              disabled={isCompleted}
              rows={2}
              placeholder="Anything else to flag?"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Sign-off <span className="text-red-500">*</span>
              <span className="text-gray-400 ml-1">(type your full name)</span>
            </label>
            <input
              type="text"
              value={driverSignature}
              onChange={(e) => setDriverSignature(e.target.value)}
              disabled={isCompleted}
              placeholder="e.g. John Smith"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 disabled:opacity-50"
            />
          </div>
        </div>

        {/* Submit button (sticky bottom) */}
        {!isCompleted && (
          <div className="fixed bottom-16 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 shadow-lg">
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className={`w-full py-3 rounded-xl font-bold text-white transition ${
                failCount > 0
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-green-600 hover:bg-green-700'
              } disabled:opacity-50`}
            >
              {submitting ? 'Submitting...' :
                failCount > 0 ? `Submit with ${failCount} defect${failCount > 1 ? 's' : ''}` :
                'Submit Check'}
            </button>
          </div>
        )}

      </div>

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