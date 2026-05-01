'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'
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

const VEHICLE_ICONS: Record<string, string> = {
  class_1: '🚛', class_2: '🚚', bus: '🚌', coach: '🚍', minibus: '🚐',
}

const MAX_PHOTO_SIZE = 10 * 1024 * 1024
const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Helpers
const isAnswered = (item: any): boolean => {
  const t = item.answer_type || 'pass_fail'
  if (t === 'pass_fail') return !!item.result
  if (t === 'text')      return !!(item.text_answer || '').trim()
  if (t === 'toggle')    return !!item.toggle_answer
  if (t === 'number')    return item.number_answer !== null && item.number_answer !== undefined && item.number_answer !== ''
  return false
}

const isItemDefect = (item: any): boolean => {
  const t = item.answer_type || 'pass_fail'
  if (t === 'pass_fail') return item.result === 'fail'
  if (t === 'toggle') {
    if (!item.toggle_answer || !item.expected_answer) return false
    return item.toggle_answer !== item.expected_answer
  }
  return false
}

export default function ServiceRecordPage() {
  const router = useRouter()
  const params = useParams()
  const recordId = params?.id as string

  const [currentUser, setCurrentUser] = useState<any>(null)
  const [record, setRecord] = useState<any>(null)
  const [vehicle, setVehicle] = useState<any>(null)
  const [items, setItems] = useState<any[]>([])
  const [photos, setPhotos] = useState<Record<string, any[]>>({})
  const [parts, setParts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set())

  // Form fields the mechanic fills in
  const [startMileage, setStartMileage] = useState('')
  const [endMileage,   setEndMileage]   = useState('')
  const [mechanicNotes, setMechanicNotes] = useState('')
  const [signature, setSignature] = useState('')
  const [partsCost, setPartsCost] = useState('')
  const [labourCost, setLabourCost] = useState('')
  const [otherCost, setOtherCost] = useState('')
  const [labourHours, setLabourHours] = useState('')
  const [costNotes, setCostNotes] = useState('')

  // MOT prep specific
  const [motCertExpiry, setMotCertExpiry] = useState('')

  // Parts entry
  const [showAddPart, setShowAddPart] = useState(false)
  const [newPartDesc, setNewPartDesc] = useState('')
  const [newPartNum, setNewPartNum] = useState('')
  const [newPartQty, setNewPartQty] = useState('1')
  const [newPartCost, setNewPartCost] = useState('')

  const [photoUploadingFor, setPhotoUploadingFor] = useState<string | null>(null)
  const showMessage = (m: string, t: 'success' | 'error') => {
    setMessage(m); setMessageType(t); setTimeout(() => setMessage(''), 4000)
  }

  const loadAll = useCallback(async () => {
    if (!recordId) return

    const { data: rec } = await supabase
      .from('service_records')
      .select('*, vehicle:vehicles(*)')
      .eq('id', recordId)
      .maybeSingle()

    if (!rec) { router.push('/employee/services'); return }

    setRecord(rec)
    setVehicle(rec.vehicle)
    setStartMileage(rec.start_mileage != null ? String(rec.start_mileage) : '')
    setEndMileage(rec.end_mileage != null ? String(rec.end_mileage) : '')
    setMechanicNotes(rec.notes || '')
    setSignature(rec.signature || '')
    setPartsCost(rec.parts_cost != null ? String(rec.parts_cost) : '')
    setLabourCost(rec.labour_cost != null ? String(rec.labour_cost) : '')
    setOtherCost(rec.other_cost != null ? String(rec.other_cost) : '')
    setLabourHours(rec.labour_hours != null ? String(rec.labour_hours) : '')
    setCostNotes(rec.cost_notes || '')
    setMotCertExpiry(rec.mot_certificate_expiry || '')

    const { data: itemsData } = await supabase
      .from('service_record_items')
      .select('*')
      .eq('record_id', recordId)
      .order('display_order', { ascending: true })
    setItems(itemsData || [])

    // Photos
    const itemIds = (itemsData || []).map((i: any) => i.id)
    if (itemIds.length > 0) {
      const { data: photosData } = await supabase
        .from('service_record_photos')
        .select('*')
        .in('record_item_id', itemIds)
      const map: Record<string, any[]> = {}
      ;(photosData || []).forEach((p: any) => {
        if (!map[p.record_item_id]) map[p.record_item_id] = []
        map[p.record_item_id].push(p)
      })
      setPhotos(map)
    }

    // Parts
    const { data: partsData } = await supabase
      .from('service_parts').select('*').eq('record_id', recordId).order('created_at', { ascending: true })
    setParts(partsData || [])
  }, [recordId, router])

  const init = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    const { data: profile } = await supabase
      .from('profiles').select('*').eq('id', user.id).single()
    if (!profile) { router.push('/login'); return }
    setCurrentUser(profile)
    await loadAll()
    setLoading(false)
  }, [router, loadAll])

  useEffect(() => { init() }, [init])

  // Pre-fill signature with mechanic's name
  useEffect(() => {
    if (currentUser?.full_name && !signature) setSignature(currentUser.full_name)
  }, [currentUser?.full_name, signature])

  const isCompleted = !!record?.signature   // we use signature as the "completed" flag

  // ── Item update functions ──────────────────────────────────────────
  const updateItemResult = async (itemId: string, result: 'pass' | 'fail' | 'na') => {
    const { error } = await supabase.from('service_record_items').update({ result }).eq('id', itemId)
    if (error) { showMessage('Could not save: ' + error.message, 'error'); return }
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, result } : i))
  }
  const updateToggleAnswer = async (itemId: string, answer: 'yes' | 'no') => {
    const { error } = await supabase.from('service_record_items').update({ toggle_answer: answer }).eq('id', itemId)
    if (error) { showMessage('Could not save: ' + error.message, 'error'); return }
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, toggle_answer: answer } : i))
  }
  const updateTextAnswer = async (itemId: string, value: string) => {
    const { error } = await supabase.from('service_record_items').update({ text_answer: value }).eq('id', itemId)
    if (error) { showMessage('Could not save: ' + error.message, 'error'); return }
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, text_answer: value } : i))
  }
  const updateNumberAnswer = async (itemId: string, value: string) => {
    const num = value === '' ? null : parseFloat(value)
    const { error } = await supabase.from('service_record_items').update({ number_answer: num }).eq('id', itemId)
    if (error) { showMessage('Could not save: ' + error.message, 'error'); return }
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, number_answer: num } : i))
  }
  const updateDefectNote = async (itemId: string, note: string) => {
    const { error } = await supabase.from('service_record_items').update({ defect_note: note }).eq('id', itemId)
    if (error) { showMessage('Could not save: ' + error.message, 'error'); return }
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, defect_note: note } : i))
  }

  // ── Photo upload ──────────────────────────────────────────────────
  const handlePhotoSelect = async (itemId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > MAX_PHOTO_SIZE) {
      showMessage('Photo too large (max 10 MB)', 'error'); e.target.value = ''; return
    }
    setPhotoUploadingFor(itemId)
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `${currentUser.company_id}/${recordId}/${itemId}/${Date.now()}_${safeName}`
    const { error: upErr } = await supabase.storage
      .from('service-photos')
      .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || 'image/jpeg' })
    if (upErr) {
      showMessage('Upload failed: ' + upErr.message, 'error')
      setPhotoUploadingFor(null); e.target.value = ''; return
    }
    const { data: photoRow, error: rowErr } = await supabase
      .from('service_record_photos')
      .insert({
        record_item_id: itemId, company_id: currentUser.company_id, storage_path: path,
        file_name: file.name, file_size: file.size, mime_type: file.type || null, uploaded_by: currentUser.id,
      })
      .select().single()
    if (rowErr) {
      showMessage('Saved file but DB row failed: ' + rowErr.message, 'error')
      setPhotoUploadingFor(null); e.target.value = ''; return
    }
    setPhotos(prev => ({ ...prev, [itemId]: [...(prev[itemId] || []), photoRow] }))
    setPhotoUploadingFor(null); e.target.value = ''
    showMessage('Photo uploaded', 'success')
  }

  const removePhoto = async (photo: any) => {
    if (!confirm('Remove this photo?')) return
    await supabase.storage.from('service-photos').remove([photo.storage_path])
    await supabase.from('service_record_photos').delete().eq('id', photo.id)
    setPhotos(prev => {
      const copy = { ...prev }
      copy[photo.record_item_id] = (copy[photo.record_item_id] || []).filter(p => p.id !== photo.id)
      return copy
    })
  }

  // ── Parts ─────────────────────────────────────────────────────────
  const addPart = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newPartDesc.trim()) return
    const qty = parseFloat(newPartQty) || 1
    const cost = parseFloat(newPartCost) || 0
    const { data, error } = await supabase.from('service_parts').insert({
      record_id: recordId,
      part_number: newPartNum.trim() || null,
      description: newPartDesc.trim(),
      quantity: qty,
      unit_cost: cost,
    }).select().single()
    if (error) { showMessage(error.message, 'error'); return }
    setParts(prev => [...prev, data])
    setNewPartDesc(''); setNewPartNum(''); setNewPartQty('1'); setNewPartCost('')
  }
  const removePart = async (id: string) => {
    if (!confirm('Remove this part?')) return
    await supabase.from('service_parts').delete().eq('id', id)
    setParts(prev => prev.filter(p => p.id !== id))
  }
  const partsTotal = parts.reduce((sum, p) => sum + (p.total_cost || 0), 0)

  // ── Submit (sign off) ─────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!signature.trim()) { showMessage('Sign-off name is required', 'error'); return }

    const unanswered = items.filter(i => !isAnswered(i))
    if (unanswered.length > 0) {
      showMessage(`${unanswered.length} item${unanswered.length > 1 ? 's' : ''} still need answering`, 'error')
      const cats = new Set(unanswered.map(i => i.category))
      setCollapsedCategories(prev => {
        const c = new Set(prev); cats.forEach(x => c.delete(x)); return c
      })
      return
    }

    // Defect items must have a note
    const defectsMissingNote = items.filter(i => isItemDefect(i) && !(i.defect_note || '').trim())
    if (defectsMissingNote.length > 0) {
      showMessage(`${defectsMissingNote.length} defect${defectsMissingNote.length > 1 ? 's need' : ' needs'} a note`, 'error')
      return
    }

    // Service type-specific validation
    if (record.service_type === 'mot_prep' && !motCertExpiry) {
      // Only enforce if pass — see below
    }

    setSubmitting(true)

    const defectCount = items.filter(i => isItemDefect(i)).length
    const overallPass = defectCount === 0

    // For MOT prep, if it passes, the cert expiry is required
    if (record.service_type === 'mot_prep' && overallPass && !motCertExpiry) {
      setSubmitting(false)
      showMessage('Enter the new MOT certificate expiry date (or mark a defect if it didn\'t pass)', 'error')
      return
    }

    const startM = startMileage ? parseInt(startMileage, 10) : null
    const endM = endMileage ? parseInt(endMileage, 10) : null
    const partsTotalNum = parseFloat(partsCost) || partsTotal || 0
    const labourCostNum = parseFloat(labourCost) || 0
    const otherCostNum = parseFloat(otherCost) || 0
    const labourHoursNum = labourHours ? parseFloat(labourHours) : null

    const { error: updErr } = await supabase.from('service_records').update({
      start_mileage: startM,
      end_mileage: endM,
      pass: overallPass,
      defects_found: defectCount,
      signature: signature.trim(),
      notes: mechanicNotes.trim() || null,
      parts_cost: partsTotalNum,
      labour_cost: labourCostNum,
      other_cost: otherCostNum,
      labour_hours: labourHoursNum,
      cost_notes: costNotes.trim() || null,
      mot_certificate_expiry: record.service_type === 'mot_prep' && overallPass ? motCertExpiry : null,
    }).eq('id', recordId)

    if (updErr) {
      setSubmitting(false)
      showMessage('Could not submit: ' + updErr.message, 'error')
      return
    }

    // Mark schedule complete
    if (record.schedule_id) {
      await supabase.from('service_schedules').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        completed_by: currentUser.id,
      }).eq('id', record.schedule_id)
    }

    setSubmitting(false)
    showMessage('Submitted!', 'success')
    setTimeout(() => router.push('/employee/services'), 800)
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-500">Loading service sheet...</p>
      </main>
    )
  }

  if (!record) return null

  const meta = SERVICE_TYPE_META[record.service_type] || SERVICE_TYPE_META.custom
  const grouped: Record<string, any[]> = {}
  items.forEach(i => { if (!grouped[i.category]) grouped[i.category] = []; grouped[i.category].push(i) })
  const categoryOrder = Object.keys(grouped)

  const unansweredCount = items.filter(i => !isAnswered(i)).length
  const defectCount = items.filter(i => isItemDefect(i)).length

  const toggleCategory = (cat: string) => {
    setCollapsedCategories(prev => {
      const c = new Set(prev)
      if (c.has(cat)) c.delete(cat); else c.add(cat)
      return c
    })
  }

  return (
    <main className="min-h-screen bg-slate-50 pb-32">
      <div className="bg-gradient-to-br from-orange-600 to-orange-800 text-white px-6 pt-10 pb-6 rounded-b-3xl shadow-lg">
        <div className="flex items-center justify-between">
          <button onClick={() => router.push('/employee/services')} className="text-orange-100 text-sm hover:text-white">← Jobs</button>
          <p className="text-orange-100 text-sm">{meta.icon} {meta.label}</p>
        </div>
        <h1 className="text-2xl font-bold mt-2 font-mono">
          {VEHICLE_ICONS[vehicle?.vehicle_type] || '🚗'} {vehicle?.registration}
        </h1>
        {vehicle?.fleet_number && <p className="text-orange-100 text-sm">Fleet #{vehicle.fleet_number}</p>}
        {vehicle?.name && <p className="text-orange-100 text-sm">{vehicle.name}</p>}
      </div>

      <div className="px-4 pt-4 space-y-3">

        {message && (
          <div className={`p-3 rounded-xl text-sm font-medium ${messageType === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{message}</div>
        )}

        {isCompleted && (
          <div className="bg-green-50 border-2 border-green-300 text-green-800 p-3 rounded-xl text-sm font-medium">
            ✓ This service was signed off on {new Date(record.created_at).toLocaleDateString('en-GB')}.
            {record.pass ? ' Outcome: PASS.' : ' Outcome: FAIL with defects.'}
          </div>
        )}

        {/* Summary bar */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-3 grid grid-cols-3 gap-2 text-center text-sm">
          <div>
            <p className="text-2xl font-bold text-slate-800">{items.length}</p>
            <p className="text-xs text-slate-500">Items</p>
          </div>
          <div>
            <p className={`text-2xl font-bold ${unansweredCount > 0 ? 'text-amber-600' : 'text-green-600'}`}>{unansweredCount}</p>
            <p className="text-xs text-slate-500">Pending</p>
          </div>
          <div>
            <p className={`text-2xl font-bold ${defectCount > 0 ? 'text-red-600' : 'text-green-600'}`}>{defectCount}</p>
            <p className="text-xs text-slate-500">Defects</p>
          </div>
        </div>

        {/* Mileage */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-3 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Start mileage</label>
            <input type="number" min={0} value={startMileage} onChange={e => setStartMileage(e.target.value)} disabled={isCompleted}
              placeholder={vehicle?.current_mileage ? String(vehicle.current_mileage) : 'e.g. 124500'}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 disabled:opacity-50" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">End mileage</label>
            <input type="number" min={0} value={endMileage} onChange={e => setEndMileage(e.target.value)} disabled={isCompleted}
              placeholder="After service"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 disabled:opacity-50" />
          </div>
        </div>

        {/* CHECK ITEMS */}
        {categoryOrder.map(cat => {
          const list = grouped[cat]
          const collapsed = collapsedCategories.has(cat)
          const catPending = list.filter(i => !isAnswered(i)).length
          const catDefects = list.filter(i => isItemDefect(i)).length

          return (
            <div key={cat} className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <button onClick={() => toggleCategory(cat)}
                className="w-full bg-slate-50 px-4 py-3 flex items-center justify-between hover:bg-slate-100 transition">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-slate-800 text-sm uppercase tracking-wide">{cat}</h3>
                  <span className="text-xs text-slate-500">({list.length})</span>
                  {catPending > 0 && (
                    <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">{catPending} pending</span>
                  )}
                  {catDefects > 0 && (
                    <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">⚠️ {catDefects} defect{catDefects > 1 ? 's' : ''}</span>
                  )}
                </div>
                <span className="text-slate-400 text-sm">{collapsed ? '▼' : '▲'}</span>
              </button>

              {!collapsed && (
                <ul className="divide-y divide-slate-100">
                  {list.map(item => {
                    const itemPhotos = photos[item.id] || []
                    const answerType = item.answer_type || 'pass_fail'
                    const isUnanswered = !isAnswered(item)
                    const isDefect = isItemDefect(item)

                    return (
                      <li key={item.id} className={`p-3 ${isUnanswered ? 'bg-amber-50/30' : ''}`}>
                        <p className="text-sm text-slate-800 leading-snug">
                          {item.item_text}
                          {item.unit && <span className="text-xs text-slate-500 ml-1">({item.unit})</span>}
                          {isUnanswered && <span className="text-amber-600 ml-1">*</span>}
                        </p>

                        {/* PASS / FAIL / N/A */}
                        {answerType === 'pass_fail' && (
                          <div className="grid grid-cols-3 gap-2 mt-2">
                            {(['pass', 'fail', 'na'] as const).map(r => (
                              <button key={r} onClick={() => updateItemResult(item.id, r)} disabled={isCompleted}
                                className={`py-2 rounded-lg text-sm font-medium border-2 transition disabled:opacity-50 ${
                                  item.result === r
                                    ? r === 'pass' ? 'bg-green-500 border-green-500 text-white'
                                    : r === 'fail' ? 'bg-red-500 border-red-500 text-white'
                                                   : 'bg-slate-500 border-slate-500 text-white'
                                    : 'bg-white border-slate-200 text-slate-700 hover:border-slate-400'
                                }`}>
                                {r === 'pass' ? '✓ Pass' : r === 'fail' ? '✗ Fail' : '– N/A'}
                              </button>
                            ))}
                          </div>
                        )}

                        {/* TEXT */}
                        {answerType === 'text' && (
                          <div className="mt-2">
                            <textarea defaultValue={item.text_answer || ''}
                              onBlur={(e) => updateTextAnswer(item.id, e.target.value)}
                              disabled={isCompleted} rows={2}
                              placeholder="Type your answer..."
                              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 disabled:opacity-50" />
                          </div>
                        )}

                        {/* TOGGLE */}
                        {answerType === 'toggle' && (
                          <div className="mt-2">
                            <div className="grid grid-cols-2 gap-2">
                              {(['yes', 'no'] as const).map(a => (
                                <button key={a} onClick={() => updateToggleAnswer(item.id, a)} disabled={isCompleted}
                                  className={`py-2 rounded-lg text-sm font-medium border-2 transition disabled:opacity-50 ${
                                    item.toggle_answer === a
                                      ? (item.expected_answer === a ? 'bg-green-500 border-green-500 text-white' : 'bg-red-500 border-red-500 text-white')
                                      : 'bg-white border-slate-200 text-slate-700 hover:border-blue-300'
                                  }`}>
                                  {a === 'yes' ? 'Yes' : 'No'}
                                </button>
                              ))}
                            </div>
                            {item.toggle_answer && item.expected_answer && (
                              <p className={`text-[10px] mt-1 font-medium ${
                                item.toggle_answer === item.expected_answer ? 'text-green-600' : 'text-red-600'
                              }`}>
                                {item.toggle_answer === item.expected_answer ? '✓ Correct' : '⚠️ Counts as a defect'}
                              </p>
                            )}
                          </div>
                        )}

                        {/* NUMBER */}
                        {answerType === 'number' && (
                          <div className="mt-2 flex items-center gap-2">
                            <input type="number" step="0.01" defaultValue={item.number_answer ?? ''}
                              onBlur={(e) => updateNumberAnswer(item.id, e.target.value)}
                              disabled={isCompleted}
                              placeholder="Enter value"
                              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 disabled:opacity-50" />
                            {item.unit && <span className="text-sm text-slate-600 font-medium">{item.unit}</span>}
                          </div>
                        )}

                        {/* DEFECT NOTE + PHOTOS */}
                        {isDefect && (
                          <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
                            <div>
                              <label className="block text-xs font-medium text-red-800 mb-1">
                                Defect note <span className="text-red-600">*</span>
                              </label>
                              <textarea defaultValue={item.defect_note || ''}
                                onBlur={(e) => updateDefectNote(item.id, e.target.value)}
                                disabled={isCompleted} rows={2}
                                placeholder="Describe the defect..."
                                className="w-full border border-red-300 rounded-lg px-3 py-2 text-sm text-slate-900 bg-white disabled:opacity-50" />
                            </div>

                            <div>
                              <p className="text-xs font-medium text-red-800 mb-1">
                                Photos {itemPhotos.length > 0 && `(${itemPhotos.length})`}
                              </p>
                              {itemPhotos.length > 0 && (
                                <div className="grid grid-cols-3 gap-2 mb-2">
                                  {itemPhotos.map(p => (
                                    <div key={p.id} className="relative">
                                      <div className="w-full bg-slate-200 rounded-lg p-2 text-center">
                                        <span className="text-3xl">📷</span>
                                        <p className="text-[10px] text-slate-600 truncate">{p.file_name}</p>
                                      </div>
                                      {!isCompleted && (
                                        <button onClick={() => removePhoto(p)}
                                          className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 text-xs leading-none flex items-center justify-center"
                                          title="Remove">×</button>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                              {!isCompleted && (
                                <label className="inline-block bg-white hover:bg-slate-50 border border-red-300 text-red-700 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer">
                                  {photoUploadingFor === item.id ? 'Uploading...' : '📷 Add Photo'}
                                  <input type="file" accept="image/*" capture="environment"
                                    onChange={(e) => handlePhotoSelect(item.id, e)}
                                    disabled={photoUploadingFor === item.id} className="hidden" />
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

        {/* PARTS USED */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-slate-800">Parts used</h3>
            {!isCompleted && (
              <button onClick={() => setShowAddPart(!showAddPart)}
                className="text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-1.5 rounded-full font-medium">
                {showAddPart ? 'Close' : '+ Add part'}
              </button>
            )}
          </div>

          {showAddPart && !isCompleted && (
            <form onSubmit={addPart} className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3 space-y-2">
              <input value={newPartDesc} onChange={e => setNewPartDesc(e.target.value)}
                placeholder="Part description (required)"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900" required />
              <div className="grid grid-cols-3 gap-2">
                <input value={newPartNum} onChange={e => setNewPartNum(e.target.value)}
                  placeholder="Part #"
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900" />
                <input type="number" step="0.01" min={0} value={newPartQty} onChange={e => setNewPartQty(e.target.value)}
                  placeholder="Qty"
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900" />
                <input type="number" step="0.01" min={0} value={newPartCost} onChange={e => setNewPartCost(e.target.value)}
                  placeholder="Unit £"
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900" />
              </div>
              <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
                Add
              </button>
            </form>
          )}

          {parts.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-2">No parts added.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {parts.map(p => (
                <li key={p.id} className="py-2 flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-slate-800">{p.description}</p>
                    <p className="text-xs text-slate-500">
                      {p.part_number && `#${p.part_number} • `}
                      {p.quantity} × £{Number(p.unit_cost).toFixed(2)} = <strong>£{Number(p.total_cost).toFixed(2)}</strong>
                    </p>
                  </div>
                  {!isCompleted && (
                    <button onClick={() => removePart(p.id)} className="text-xs text-red-600 hover:text-red-800 underline">×</button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {parts.length > 0 && (
            <p className="text-right text-sm text-slate-700 mt-2 pt-2 border-t border-slate-100">
              Parts subtotal: <strong>£{partsTotal.toFixed(2)}</strong>
            </p>
          )}
        </div>

        {/* COSTS */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 space-y-3">
          <h3 className="font-semibold text-slate-800">Costs</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Parts cost (£)</label>
              <input type="number" step="0.01" min={0} value={partsCost} onChange={e => setPartsCost(e.target.value)}
                disabled={isCompleted}
                placeholder={partsTotal > 0 ? partsTotal.toFixed(2) : '0.00'}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 disabled:opacity-50" />
              <p className="text-[10px] text-slate-500 mt-0.5">Leave blank to use sum of parts above (£{partsTotal.toFixed(2)})</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Labour cost (£)</label>
              <input type="number" step="0.01" min={0} value={labourCost} onChange={e => setLabourCost(e.target.value)}
                disabled={isCompleted}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 disabled:opacity-50" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Labour hours</label>
              <input type="number" step="0.25" min={0} value={labourHours} onChange={e => setLabourHours(e.target.value)}
                disabled={isCompleted}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 disabled:opacity-50" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Other costs (£)</label>
              <input type="number" step="0.01" min={0} value={otherCost} onChange={e => setOtherCost(e.target.value)}
                disabled={isCompleted}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 disabled:opacity-50" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Cost notes</label>
            <textarea value={costNotes} onChange={e => setCostNotes(e.target.value)} disabled={isCompleted} rows={2}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 disabled:opacity-50" />
          </div>
        </div>

        {/* MOT PREP — special expiry field */}
        {record.service_type === 'mot_prep' && (
          <div className="bg-indigo-50 rounded-2xl shadow-sm border-2 border-indigo-300 p-4">
            <h3 className="font-semibold text-indigo-900">📋 New MOT certificate expiry</h3>
            <p className="text-xs text-indigo-700 mt-0.5">Required if the prep PASSES. The vehicle's MOT date will auto-update.</p>
            <input type="date" value={motCertExpiry} onChange={e => setMotCertExpiry(e.target.value)}
              disabled={isCompleted}
              className="w-full mt-2 border border-indigo-300 rounded-lg px-3 py-2 text-slate-900 bg-white disabled:opacity-50" />
          </div>
        )}

        {/* NOTES + SIGN-OFF */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Mechanic notes <span className="text-slate-400">(optional)</span></label>
            <textarea value={mechanicNotes} onChange={e => setMechanicNotes(e.target.value)} disabled={isCompleted} rows={2}
              placeholder="Anything else to flag"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 disabled:opacity-50" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Sign-off <span className="text-red-500">*</span></label>
            <input type="text" value={signature} onChange={e => setSignature(e.target.value)} disabled={isCompleted}
              placeholder="Your full name"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 disabled:opacity-50" />
          </div>
        </div>

        {/* Submit bar */}
        {!isCompleted && (
          <div className="fixed bottom-16 left-0 right-0 bg-white border-t border-slate-200 px-4 py-3 shadow-lg">
            <button onClick={handleSubmit} disabled={submitting}
              className={`w-full py-3 rounded-xl font-bold text-white transition disabled:opacity-50 ${
                defectCount > 0 ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'
              }`}>
              {submitting ? 'Submitting...' :
                unansweredCount > 0 ? `${unansweredCount} item${unansweredCount > 1 ? 's' : ''} still pending` :
                defectCount > 0 ? `Submit with ${defectCount} defect${defectCount > 1 ? 's' : ''}` :
                'Submit Service Sheet'}
            </button>
          </div>
        )}

      </div>

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 shadow-lg">
        <div className="flex justify-around items-center h-16 max-w-md mx-auto">
          <button onClick={() => router.push('/employee')} className="flex flex-col items-center gap-0.5 text-slate-400 hover:text-slate-600">
            <span className="text-xl">🏠</span>
            <span className="text-xs font-medium">Home</span>
          </button>
          <button onClick={() => router.push('/employee/services')} className="flex flex-col items-center gap-0.5 text-orange-600">
            <span className="text-xl">🔧</span>
            <span className="text-xs font-medium">Jobs</span>
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
