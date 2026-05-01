'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
const supabase = createClient()

const ALL_VEHICLE_TYPES = [
  { value: 'class_1', label: 'Class 1 (HGV Articulated)', short: 'Class 1', icon: '🚛' },
  { value: 'class_2', label: 'Class 2 (HGV Rigid)',       short: 'Class 2', icon: '🚚' },
  { value: 'bus',     label: 'Bus',                       short: 'Bus',     icon: '🚌' },
  { value: 'coach',   label: 'Coach',                     short: 'Coach',   icon: '🚍' },
  { value: 'minibus', label: 'Minibus',                   short: 'Minibus', icon: '🚐' },
] as const

const SERVICE_TYPES = [
  { value: 'safety_inspection', label: 'Safety Inspection', icon: '🔧', description: '6-weekly DVSA safety inspection' },
  { value: 'mot_prep',          label: 'MOT / Annual Test Prep', icon: '📋', description: 'Pre-MOT preparation checks' },
  { value: 'full_service',      label: 'Full Service', icon: '🛠️', description: 'Comprehensive service / maintenance' },
  { value: 'tacho',             label: 'Tachograph Calibration', icon: '⏱️', description: 'Tacho calibration & download' },
  { value: 'loler',             label: 'LOLER', icon: '⚙️', description: 'Lifting equipment inspection' },
  { value: 'tax',               label: 'Tax (VED) Renewal', icon: '💷', description: 'Tax renewal preparation' },
  { value: 'custom',            label: 'Custom', icon: '📝', description: 'Custom check sheet' },
] as const

const ANSWER_TYPE_LABELS: Record<string, string> = {
  pass_fail: '✓/✗ Pass / Fail / N/A',
  text:      '📝 Text answer',
  toggle:    '🔘 Yes / No',
  number:    '🔢 Number',
}

const ANSWER_TYPE_BADGES: Record<string, { label: string; color: string }> = {
  pass_fail: { label: 'P/F/N',  color: 'bg-blue-100 text-blue-700' },
  text:      { label: 'Text',   color: 'bg-purple-100 text-purple-700' },
  toggle:    { label: 'Yes/No', color: 'bg-amber-100 text-amber-700' },
  number:    { label: 'Number', color: 'bg-emerald-100 text-emerald-700' },
}

type AnswerType = 'pass_fail' | 'text' | 'toggle' | 'number'

export default function ServiceTemplatesPage() {
  const router = useRouter()
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [enabledVehicleTypes, setEnabledVehicleTypes] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  const [activeVehicleType, setActiveVehicleType] = useState<string>('class_1')
  const [activeServiceType, setActiveServiceType] = useState<string>('safety_inspection')

  const [templates, setTemplates] = useState<any[]>([])
  const [activeTemplate, setActiveTemplate] = useState<any | null>(null)
  const [items, setItems] = useState<any[]>([])

  // Template form
  const [showTemplateForm, setShowTemplateForm] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [templateDescription, setTemplateDescription] = useState('')
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null)

  // Item editing
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [inlineCategory, setInlineCategory] = useState('')
  const [inlineText, setInlineText] = useState('')
  const [inlineAnswerType, setInlineAnswerType] = useState<AnswerType>('pass_fail')
  const [inlineExpectedAnswer, setInlineExpectedAnswer] = useState<'yes' | 'no'>('yes')
  const [inlineUnit, setInlineUnit] = useState('')

  // Add new item
  const [showNewItemForm, setShowNewItemForm] = useState(false)
  const [newCategory, setNewCategory] = useState('')
  const [newText, setNewText] = useState('')
  const [newAnswerType, setNewAnswerType] = useState<AnswerType>('pass_fail')
  const [newExpectedAnswer, setNewExpectedAnswer] = useState<'yes' | 'no'>('yes')
  const [newUnit, setNewUnit] = useState('')

  const showMessage = (m: string, t: 'success' | 'error') => {
    setMessage(m); setMessageType(t); setTimeout(() => setMessage(''), 4000)
  }

  // ── Initial load ──────────────────────────────────────────────────
  const init = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: profile } = await supabase
      .from('profiles').select('*').eq('id', user.id).single()
    if (!profile) { router.push('/login'); return }
    setCurrentUser(profile)

    if (profile.role !== 'admin' && profile.role !== 'superuser') {
      // Manager with the feature flag also OK
      if (profile.role !== 'manager') { router.push('/dashboard'); return }
    }

    if (!profile.company_id) { router.push('/dashboard'); return }

    const { data: companyData } = await supabase
      .from('companies').select('*').eq('id', profile.company_id).single()
    setCompany(companyData)

    const types: string[] = companyData?.vehicle_types && companyData.vehicle_types.length > 0
      ? companyData.vehicle_types
      : ALL_VEHICLE_TYPES.map(t => t.value)
    setEnabledVehicleTypes(types)
    if (!types.includes(activeVehicleType) && types.length > 0) {
      setActiveVehicleType(types[0])
    }

    setLoading(false)
  }, [router, activeVehicleType])

  useEffect(() => { init() }, [init])

  // ── Load templates whenever vehicle/service type changes ─────────
  const loadTemplates = useCallback(async () => {
    if (!currentUser?.company_id) return
    const { data } = await supabase
      .from('service_templates')
      .select('*')
      .eq('company_id', currentUser.company_id)
      .eq('vehicle_type', activeVehicleType)
      .eq('service_type', activeServiceType)
      .order('created_at', { ascending: true })
    setTemplates(data || [])
    // Auto-select first template
    if (data && data.length > 0) {
      if (!activeTemplate || !data.find(t => t.id === activeTemplate.id)) {
        setActiveTemplate(data[0])
      }
    } else {
      setActiveTemplate(null)
      setItems([])
    }
  }, [currentUser?.company_id, activeVehicleType, activeServiceType, activeTemplate])

  useEffect(() => { loadTemplates() }, [loadTemplates])

  // ── Load items whenever active template changes ───────────────────
  const loadItems = useCallback(async () => {
    if (!activeTemplate) { setItems([]); return }
    const { data } = await supabase
      .from('service_template_items')
      .select('*')
      .eq('template_id', activeTemplate.id)
      .order('display_order', { ascending: true })
    setItems(data || [])
  }, [activeTemplate])

  useEffect(() => { loadItems() }, [loadItems])

  // ── Create / update template ──────────────────────────────────────
  const saveTemplate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!templateName.trim()) { showMessage('Template name is required', 'error'); return }

    if (editingTemplateId) {
      const { error } = await supabase
        .from('service_templates')
        .update({
          name: templateName.trim(),
          description: templateDescription.trim() || null,
        })
        .eq('id', editingTemplateId)
      if (error) { showMessage(error.message, 'error'); return }
      showMessage('Template updated', 'success')
    } else {
      const { data, error } = await supabase
        .from('service_templates')
        .insert({
          company_id: currentUser.company_id,
          vehicle_type: activeVehicleType,
          service_type: activeServiceType,
          name: templateName.trim(),
          description: templateDescription.trim() || null,
          active: true,
        })
        .select().single()
      if (error) { showMessage(error.message, 'error'); return }
      showMessage('Template created', 'success')
      setActiveTemplate(data)
    }
    setShowTemplateForm(false)
    setEditingTemplateId(null)
    setTemplateName(''); setTemplateDescription('')
    loadTemplates()
  }

  const startEditTemplate = (t: any) => {
    setEditingTemplateId(t.id)
    setTemplateName(t.name)
    setTemplateDescription(t.description || '')
    setShowTemplateForm(true)
  }

  const deleteTemplate = async (t: any) => {
    if (!confirm(`Delete template "${t.name}"? Existing service records that used it will be kept (snapshotted).`)) return
    const { error } = await supabase.from('service_templates').delete().eq('id', t.id)
    if (error) { showMessage(error.message, 'error'); return }
    showMessage('Template deleted', 'success')
    setActiveTemplate(null)
    loadTemplates()
  }

  const toggleActive = async (t: any) => {
    const { data, error } = await supabase
      .from('service_templates')
      .update({ active: !t.active })
      .eq('id', t.id).select().single()
    if (error) { showMessage(error.message, 'error'); return }
    if (activeTemplate?.id === t.id) setActiveTemplate(data)
    loadTemplates()
  }

  // ── Add new item ──────────────────────────────────────────────────
  const addItem = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeTemplate) return
    if (!newCategory.trim() || !newText.trim()) {
      showMessage('Category and item text are required', 'error'); return
    }

    const nextOrder = items.length > 0 ? Math.max(...items.map(i => i.display_order || 0)) + 10 : 10

    const { error } = await supabase.from('service_template_items').insert({
      template_id: activeTemplate.id,
      category: newCategory.trim(),
      item_text: newText.trim(),
      answer_type: newAnswerType,
      expected_answer: newAnswerType === 'toggle' ? newExpectedAnswer : null,
      unit: newAnswerType === 'number' ? (newUnit.trim() || null) : null,
      display_order: nextOrder,
      required: true,
    })
    if (error) { showMessage(error.message, 'error'); return }

    showMessage('Item added', 'success')
    setNewText('')   // keep category for fast bulk-add
    setNewUnit('')
    loadItems()
  }

  // ── Inline edit existing item ─────────────────────────────────────
  const startEditItem = (item: any) => {
    setEditingItemId(item.id)
    setInlineCategory(item.category)
    setInlineText(item.item_text)
    setInlineAnswerType(item.answer_type || 'pass_fail')
    setInlineExpectedAnswer(item.expected_answer || 'yes')
    setInlineUnit(item.unit || '')
  }

  const saveInlineItem = async () => {
    if (!editingItemId) return
    if (!inlineCategory.trim() || !inlineText.trim()) {
      showMessage('Category and item text are required', 'error'); return
    }
    const { error } = await supabase.from('service_template_items')
      .update({
        category: inlineCategory.trim(),
        item_text: inlineText.trim(),
        answer_type: inlineAnswerType,
        expected_answer: inlineAnswerType === 'toggle' ? inlineExpectedAnswer : null,
        unit: inlineAnswerType === 'number' ? (inlineUnit.trim() || null) : null,
      })
      .eq('id', editingItemId)
    if (error) { showMessage(error.message, 'error'); return }
    showMessage('Item updated', 'success')
    setEditingItemId(null)
    loadItems()
  }

  const cancelEditItem = () => setEditingItemId(null)

  const deleteItem = async (item: any) => {
    if (!confirm(`Remove "${item.item_text}" from this template?`)) return
    const { error } = await supabase.from('service_template_items').delete().eq('id', item.id)
    if (error) { showMessage(error.message, 'error'); return }
    showMessage('Item removed', 'success')
    loadItems()
  }

  // ── Reorder items ─────────────────────────────────────────────────
  const moveItem = async (item: any, direction: 'up' | 'down') => {
    const idx = items.findIndex(i => i.id === item.id)
    if (idx < 0) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= items.length) return

    const swap = items[swapIdx]
    // Swap their display_order values
    await supabase.from('service_template_items').update({ display_order: swap.display_order }).eq('id', item.id)
    await supabase.from('service_template_items').update({ display_order: item.display_order }).eq('id', swap.id)
    loadItems()
  }

  // ── Seed a starter template ───────────────────────────────────────
  const seedStarterTemplate = async () => {
    if (!confirm('Create a starter "6-Weekly Safety Inspection" template with common DVSA items? You can edit/remove items afterwards.')) return
    const res = await fetch('/api/seed-service-template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_id: currentUser.company_id,
        vehicle_type: activeVehicleType,
        service_type: activeServiceType,
      }),
    })
    const json = await res.json()
    if (!res.ok) { showMessage(json.error || 'Failed to seed', 'error'); return }
    showMessage(`Created "${json.template_name}" with ${json.items_count} items`, 'success')
    loadTemplates()
  }

  // ── Group items by category for nicer rendering ───────────────────
  const grouped: Record<string, any[]> = {}
  items.forEach(i => {
    if (!grouped[i.category]) grouped[i.category] = []
    grouped[i.category].push(i)
  })
  const categoryOrder = Object.keys(grouped)

  if (loading) {
    return (
      <div className="p-8 text-slate-400 italic">Loading templates…</div>
    )
  }

  const visibleVehicleTypes = ALL_VEHICLE_TYPES.filter(t => enabledVehicleTypes.includes(t.value))
  const activeServiceMeta = SERVICE_TYPES.find(s => s.value === activeServiceType)
  const activeVehicleMeta = ALL_VEHICLE_TYPES.find(v => v.value === activeVehicleType)

  return (
    <div className="p-8 max-w-5xl">

      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 mb-1">Service Check Templates</h1>
          <p className="text-sm text-slate-500">{company?.name}</p>
        </div>
        <button
          onClick={() => router.push('/dashboard')}
          className="text-sm text-slate-600 hover:text-slate-800"
        >
          ← Back to Dashboard
        </button>
      </div>

      <div className="space-y-4">

        {message && (
          <div className={`p-3 rounded-lg text-sm font-medium ${
            messageType === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>{message}</div>
        )}

        <div className="bg-blue-50 border border-blue-200 text-blue-800 text-sm p-3 rounded-lg">
          Service templates define what gets checked during each service type. Each company can have one or more templates per vehicle type per service type. Click any item to edit it inline. Reorder with the ▲/▼ arrows.
        </div>

        {/* Vehicle type tabs */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide px-2 mb-2">Vehicle Type</p>
          <div className="flex gap-1 overflow-x-auto">
            {visibleVehicleTypes.map(t => (
              <button key={t.value}
                onClick={() => { setActiveVehicleType(t.value); setActiveTemplate(null) }}
                className={`px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition ${
                  activeVehicleType === t.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}>
                <span className="mr-1">{t.icon}</span>
                <span className="hidden sm:inline">{t.short}</span>
                <span className="sm:hidden">{t.value === 'class_1' ? 'C1' : t.value === 'class_2' ? 'C2' : t.label[0].toUpperCase()}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Service type tabs */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide px-2 mb-2">Service Type</p>
          <div className="flex gap-1 overflow-x-auto">
            {SERVICE_TYPES.map(s => (
              <button key={s.value}
                onClick={() => { setActiveServiceType(s.value); setActiveTemplate(null) }}
                className={`px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition ${
                  activeServiceType === s.value
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}>
                <span className="mr-1">{s.icon}</span>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Templates list for the selected combination */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="font-semibold text-slate-800">
                {activeVehicleMeta?.icon} {activeVehicleMeta?.label} — {activeServiceMeta?.label}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">{activeServiceMeta?.description}</p>
            </div>
            <div className="flex gap-2">
              {templates.length === 0 && activeServiceType === 'safety_inspection' && (
                <button onClick={seedStarterTemplate}
                  className="text-xs bg-emerald-100 hover:bg-emerald-200 text-emerald-700 px-3 py-1.5 rounded-full font-medium">
                  ✨ Seed starter template
                </button>
              )}
              <button onClick={() => { setShowTemplateForm(true); setEditingTemplateId(null); setTemplateName(''); setTemplateDescription('') }}
                className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-full font-medium">
                + New template
              </button>
            </div>
          </div>

          {/* Template form */}
          {showTemplateForm && (
            <form onSubmit={saveTemplate} className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3 space-y-2">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Template name *</label>
                <input value={templateName} onChange={e => setTemplateName(e.target.value)}
                  placeholder='e.g. "6-Weekly Safety Inspection"'
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900" required />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Description (optional)</label>
                <input value={templateDescription} onChange={e => setTemplateDescription(e.target.value)}
                  placeholder="Short description for mechanics"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900" />
              </div>
              <div className="flex gap-2">
                <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
                  {editingTemplateId ? 'Update template' : 'Create template'}
                </button>
                <button type="button" onClick={() => { setShowTemplateForm(false); setEditingTemplateId(null) }}
                  className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm">
                  Cancel
                </button>
              </div>
            </form>
          )}

          {templates.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-6">
              No templates yet for this combination. Create one with the button above, or seed a starter template.
            </p>
          ) : (
            <div className="space-y-1">
              {templates.map(t => (
                <div key={t.id}
                  className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer ${
                    activeTemplate?.id === t.id ? 'bg-blue-100 border border-blue-300' : 'hover:bg-slate-50 border border-transparent'
                  }`}
                  onClick={() => setActiveTemplate(t)}>
                  <div className="flex-1">
                    <p className="font-medium text-slate-800 text-sm">{t.name}</p>
                    {t.description && <p className="text-xs text-slate-500">{t.description}</p>}
                  </div>
                  {!t.active && (
                    <span className="text-[10px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">Inactive</span>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); startEditTemplate(t) }}
                    className="text-xs text-blue-600 hover:text-blue-800 underline">Edit</button>
                  <button onClick={(e) => { e.stopPropagation(); toggleActive(t) }}
                    className="text-xs text-slate-600 hover:text-slate-800 underline">
                    {t.active ? 'Disable' : 'Enable'}
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); deleteTemplate(t) }}
                    className="text-xs text-red-600 hover:text-red-800 underline">Delete</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Items editor */}
        {activeTemplate && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-slate-800">
                Items in <span className="text-blue-700">{activeTemplate.name}</span>
                <span className="text-xs font-normal text-slate-500 ml-2">({items.length})</span>
              </h2>
              <button onClick={() => setShowNewItemForm(!showNewItemForm)}
                className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-full font-medium">
                {showNewItemForm ? 'Close' : '+ Add item'}
              </button>
            </div>

            {/* New item form */}
            {showNewItemForm && (
              <form onSubmit={addItem} className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 mb-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Category *</label>
                    <input value={newCategory} onChange={e => setNewCategory(e.target.value)}
                      placeholder="e.g. Brakes, Lights, Tyres"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900" required />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Answer type *</label>
                    <select value={newAnswerType} onChange={e => setNewAnswerType(e.target.value as AnswerType)}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900">
                      {Object.entries(ANSWER_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Item text *</label>
                  <input value={newText} onChange={e => setNewText(e.target.value)}
                    placeholder='e.g. "Check brake pad thickness"'
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900" required />
                </div>
                {newAnswerType === 'toggle' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Expected answer (passing answer)</label>
                    <select value={newExpectedAnswer} onChange={e => setNewExpectedAnswer(e.target.value as 'yes' | 'no')}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900">
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                    <p className="text-[10px] text-slate-500 mt-1">If the mechanic's answer doesn't match this, it counts as a defect.</p>
                  </div>
                )}
                {newAnswerType === 'number' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Unit (optional)</label>
                    <input value={newUnit} onChange={e => setNewUnit(e.target.value)}
                      placeholder='e.g. "mm", "psi", "litres"'
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900" />
                  </div>
                )}
                <div className="flex gap-2">
                  <button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
                    Add item
                  </button>
                  <button type="button" onClick={() => setShowNewItemForm(false)}
                    className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm">
                    Done
                  </button>
                </div>
              </form>
            )}

            {/* Items list */}
            {items.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-6">
                No items yet. Add items above to define what gets checked during this service.
              </p>
            ) : (
              <div className="space-y-3">
                {categoryOrder.map(cat => (
                  <div key={cat} className="border border-slate-200 rounded-lg overflow-hidden">
                    <div className="bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 uppercase tracking-wide">
                      {cat} ({grouped[cat].length})
                    </div>
                    <ul className="divide-y divide-slate-100">
                      {grouped[cat].map((item, idx) => {
                        const itemIdx = items.findIndex(i => i.id === item.id)
                        const isFirst = itemIdx === 0
                        const isLast  = itemIdx === items.length - 1
                        const isEditing = editingItemId === item.id
                        const badge = ANSWER_TYPE_BADGES[item.answer_type || 'pass_fail']

                        if (isEditing) {
                          return (
                            <li key={item.id} className="p-2 bg-yellow-50 space-y-2">
                              <div className="grid grid-cols-2 gap-2">
                                <input value={inlineCategory} onChange={e => setInlineCategory(e.target.value)}
                                  placeholder="Category"
                                  className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm text-slate-900" />
                                <select value={inlineAnswerType} onChange={e => setInlineAnswerType(e.target.value as AnswerType)}
                                  className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm text-slate-900">
                                  {Object.entries(ANSWER_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                </select>
                              </div>
                              <input value={inlineText} onChange={e => setInlineText(e.target.value)}
                                placeholder="Item text"
                                className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm text-slate-900" />
                              {inlineAnswerType === 'toggle' && (
                                <select value={inlineExpectedAnswer} onChange={e => setInlineExpectedAnswer(e.target.value as 'yes' | 'no')}
                                  className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm text-slate-900">
                                  <option value="yes">Expected: Yes</option>
                                  <option value="no">Expected: No</option>
                                </select>
                              )}
                              {inlineAnswerType === 'number' && (
                                <input value={inlineUnit} onChange={e => setInlineUnit(e.target.value)}
                                  placeholder="Unit (optional)"
                                  className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm text-slate-900" />
                              )}
                              <div className="flex gap-2">
                                <button onClick={saveInlineItem} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium">Save</button>
                                <button onClick={cancelEditItem} className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-3 py-1.5 rounded-lg text-xs">Cancel</button>
                              </div>
                            </li>
                          )
                        }

                        return (
                          <li key={item.id} className="p-2 flex items-center gap-2 hover:bg-slate-50">
                            <div className="flex flex-col gap-0.5">
                              <button onClick={() => moveItem(item, 'up')} disabled={isFirst}
                                className="text-xs text-slate-400 hover:text-slate-700 disabled:opacity-20">▲</button>
                              <button onClick={() => moveItem(item, 'down')} disabled={isLast}
                                className="text-xs text-slate-400 hover:text-slate-700 disabled:opacity-20">▼</button>
                            </div>
                            <button onClick={() => startEditItem(item)} className="flex-1 text-left">
                              <span className="text-sm text-slate-800">{item.item_text}</span>
                              {item.unit && <span className="text-xs text-slate-500 ml-2">({item.unit})</span>}
                            </button>
                            <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${badge.color}`}>
                              {badge.label}
                            </span>
                            {item.answer_type === 'toggle' && item.expected_answer && (
                              <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                                ✓ {item.expected_answer}
                              </span>
                            )}
                            <button onClick={() => startEditItem(item)} className="text-xs text-blue-600 hover:text-blue-800 underline">Edit</button>
                            <button onClick={() => deleteItem(item)} className="text-xs text-red-600 hover:text-red-800 underline">×</button>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
