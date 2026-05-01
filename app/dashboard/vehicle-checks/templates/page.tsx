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

const ANSWER_TYPE_LABELS: Record<string, string> = {
  pass_fail: '✓/✗ Pass / Fail / N/A',
  text: '📝 Text answer',
  toggle: '🔘 Yes / No',
}

const ANSWER_TYPE_BADGES: Record<string, { label: string; color: string }> = {
  pass_fail: { label: 'Pass/Fail', color: 'bg-green-100 text-green-700' },
  text: { label: 'Text', color: 'bg-purple-100 text-purple-700' },
  toggle: { label: 'Yes/No', color: 'bg-amber-100 text-amber-700' },
}

export default function ChecklistTemplatesPage() {
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [enabledVehicleTypes, setEnabledVehicleTypes] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  const [activeType, setActiveType] = useState<string>('')
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [items, setItems] = useState<any[]>([])

  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [inlineCategory, setInlineCategory] = useState('')
  const [inlineText, setInlineText] = useState('')
  const [inlineAnswerType, setInlineAnswerType] = useState<'pass_fail' | 'text' | 'toggle'>('pass_fail')
  const [inlineExpectedAnswer, setInlineExpectedAnswer] = useState<'yes' | 'no'>('yes')
  const [savingId, setSavingId] = useState<string | null>(null)

  const [addingNew, setAddingNew] = useState(false)
  const [newCategory, setNewCategory] = useState('')
  const [newText, setNewText] = useState('')
  const [newAnswerType, setNewAnswerType] = useState<'pass_fail' | 'text' | 'toggle'>('pass_fail')
  const [newExpectedAnswer, setNewExpectedAnswer] = useState<'yes' | 'no'>('yes')

  const router = useRouter()
  const showMessage = (msg: string, type: 'success' | 'error') => {
    setMessage(msg)
    setMessageType(type)
    setTimeout(() => setMessage(''), 4000)
  }

  const loadTemplate = useCallback(async (companyId: string, type: string) => {
    let { data: template } = await supabase
      .from('vehicle_check_templates')
      .select('*')
      .eq('company_id', companyId)
      .eq('vehicle_type', type)
      .maybeSingle()

    if (!template) {
      const { data: newTemplate, error } = await supabase
        .from('vehicle_check_templates')
        .insert({ company_id: companyId, vehicle_type: type })
        .select()
        .single()

      if (error) {
        showMessage('Error creating template: ' + error.message, 'error')
        return
      }
      template = newTemplate
    }

    setTemplateId(template.id)

    const { data: itemsData } = await supabase
      .from('vehicle_check_template_items')
      .select('*')
      .eq('template_id', template.id)
      .order('display_order', { ascending: true })

    setItems(itemsData || [])
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

    const types: string[] = companyData?.vehicle_types && companyData.vehicle_types.length > 0
      ? companyData.vehicle_types
      : ['class_1', 'class_2', 'bus', 'coach', 'minibus']
    setEnabledVehicleTypes(types)

    const initialType = types[0] || 'class_1'
    setActiveType(initialType)

    await loadTemplate(profile.company_id, initialType)
    setLoading(false)
  }, [router, loadTemplate])

  useEffect(() => { init() }, [init])

  useEffect(() => {
    if (!currentUser?.company_id || !activeType) return
    loadTemplate(currentUser.company_id, activeType)
    setEditingItemId(null)
    setAddingNew(false)
  }, [activeType, currentUser?.company_id, loadTemplate])

  useEffect(() => {
    if (!templateId) return
    const channel = supabase
      .channel(`template-items-${templateId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_check_template_items', filter: `template_id=eq.${templateId}` }, () => {
        if (currentUser?.company_id && activeType) {
          loadTemplate(currentUser.company_id, activeType)
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [templateId, currentUser?.company_id, activeType, loadTemplate])

  const handleStartInlineEdit = (item: any) => {
    setEditingItemId(item.id)
    setInlineCategory(item.category)
    setInlineText(item.item_text)
    setInlineAnswerType(item.answer_type || 'pass_fail')
    setInlineExpectedAnswer(item.expected_answer || 'yes')
    setAddingNew(false)
  }

  const handleCancelInlineEdit = () => {
    setEditingItemId(null)
    setInlineCategory('')
    setInlineText('')
    setInlineAnswerType('pass_fail')
    setInlineExpectedAnswer('yes')
  }

  const handleSaveInlineEdit = async (item: any) => {
    if (!inlineCategory.trim() || !inlineText.trim()) {
      showMessage('Both category and item text are required', 'error')
      return
    }

    setSavingId(item.id)

    const payload: any = {
      category: inlineCategory.trim(),
      item_text: inlineText.trim(),
      answer_type: inlineAnswerType,
      expected_answer: inlineAnswerType === 'toggle' ? inlineExpectedAnswer : null,
    }

    const { error } = await supabase
      .from('vehicle_check_template_items')
      .update(payload)
      .eq('id', item.id)

    setSavingId(null)

    if (error) {
      showMessage('Error: ' + error.message, 'error')
      return
    }

    await logAuditClient({
      user: currentUser,
      action: 'CHECK_ITEM_UPDATED',
      entity: 'vehicle_check_template_item',
      entity_id: item.id,
      details: { vehicle_type: activeType, ...payload },
    })

    handleCancelInlineEdit()
  }

  const handleStartAddNew = () => {
    setAddingNew(true)
    setNewCategory('')
    setNewText('')
    setNewAnswerType('pass_fail')
    setNewExpectedAnswer('yes')
    setEditingItemId(null)
  }

  const handleCancelAddNew = () => {
    setAddingNew(false)
    setNewCategory('')
    setNewText('')
    setNewAnswerType('pass_fail')
    setNewExpectedAnswer('yes')
  }

  const handleSaveNew = async () => {
    if (!templateId) return
    if (!newCategory.trim() || !newText.trim()) {
      showMessage('Both category and item text are required', 'error')
      return
    }

    const maxOrder = items.length > 0 ? Math.max(...items.map(i => i.display_order || 0)) : 0
    const { data, error } = await supabase
      .from('vehicle_check_template_items')
      .insert({
        template_id: templateId,
        category: newCategory.trim(),
        item_text: newText.trim(),
        answer_type: newAnswerType,
        expected_answer: newAnswerType === 'toggle' ? newExpectedAnswer : null,
        display_order: maxOrder + 10,
      })
      .select()
      .single()

    if (error) {
      showMessage('Error: ' + error.message, 'error')
      return
    }

    await logAuditClient({
      user: currentUser,
      action: 'CHECK_ITEM_CREATED',
      entity: 'vehicle_check_template_item',
      entity_id: data?.id,
      details: { vehicle_type: activeType, category: newCategory, item_text: newText, answer_type: newAnswerType },
    })

    handleCancelAddNew()
    showMessage('Item added', 'success')
  }

  const handleDelete = async (item: any) => {
    if (!confirm(`Delete "${item.item_text}"?`)) return

    const { error } = await supabase
      .from('vehicle_check_template_items')
      .delete()
      .eq('id', item.id)

    if (error) {
      showMessage('Error: ' + error.message, 'error')
      return
    }

    await logAuditClient({
      user: currentUser,
      action: 'CHECK_ITEM_DELETED',
      entity: 'vehicle_check_template_item',
      entity_id: item.id,
      details: { vehicle_type: activeType, category: item.category, item_text: item.item_text },
    })

    showMessage('Item deleted', 'success')
  }

  const handleMove = async (item: any, direction: 'up' | 'down') => {
    const sameCategoryItems = items
      .filter(i => i.category === item.category)
      .sort((a, b) => (a.display_order || 0) - (b.display_order || 0))

    const currentIndex = sameCategoryItems.findIndex(i => i.id === item.id)
    const swapIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1

    if (swapIndex < 0 || swapIndex >= sameCategoryItems.length) return

    const otherItem = sameCategoryItems[swapIndex]

    await supabase
      .from('vehicle_check_template_items')
      .update({ display_order: otherItem.display_order })
      .eq('id', item.id)

    await supabase
      .from('vehicle_check_template_items')
      .update({ display_order: item.display_order })
      .eq('id', otherItem.id)
  }

  const handleResetToDefaults = async () => {
    if (!confirm(`Reset ALL ${getTypeLabel(activeType)} checklist items back to the DVSA defaults? This will delete any custom items you've added.`)) return
    if (!confirm('Are you absolutely sure? This cannot be undone.')) return

    if (!templateId) return

    const { error: delError } = await supabase
      .from('vehicle_check_template_items')
      .delete()
      .eq('template_id', templateId)

    if (delError) {
      showMessage('Error clearing items: ' + delError.message, 'error')
      return
    }

    const defaults = DEFAULT_ITEMS[activeType] || []
    if (defaults.length > 0) {
      const { error: insError } = await supabase
        .from('vehicle_check_template_items')
        .insert(defaults.map((d, i) => ({
          template_id: templateId,
          category: d.category,
          item_text: d.item_text,
          answer_type: 'pass_fail',
          display_order: (i + 1) * 10,
        })))

      if (insError) {
        showMessage('Error seeding defaults: ' + insError.message, 'error')
        return
      }
    }

    await logAuditClient({
      user: currentUser,
      action: 'CHECK_TEMPLATE_RESET',
      entity: 'vehicle_check_template',
      entity_id: templateId,
      details: { vehicle_type: activeType },
    })

    showMessage('Reset to DVSA defaults', 'success')
  }

  const getTypeLabel = (type: string) => ALL_VEHICLE_TYPES.find(t => t.value === type)?.label || type
  const getTypeIcon = (type: string) => ALL_VEHICLE_TYPES.find(t => t.value === type)?.icon || '🚗'

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

  const distinctCategories = Array.from(new Set(items.map(i => i.category))).sort()

  const visibleVehicleTypes = ALL_VEHICLE_TYPES.filter(t => enabledVehicleTypes.includes(t.value))

  if (loading) {
    return (
      <div className="p-8 text-slate-400 italic">Loading templates…</div>
    )
  }

  if (visibleVehicleTypes.length === 0) {
    return (
      <div className="p-8 max-w-3xl">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8 text-center">
          <p className="text-5xl mb-3">🚛</p>
          <p className="text-slate-800 font-medium mb-2">No vehicle types enabled</p>
          <p className="text-sm text-slate-500 mb-4">
            Ask your superuser to enable at least one vehicle type for this company in the company settings.
          </p>
          <button
            onClick={() => router.push('/dashboard/vehicles')}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            ← Back to Vehicles
          </button>
        </div>
      </div>
    )
  }

  // Inline form helper component (DRY)
  const renderEditForm = (
    category: string, setCategory: (s: string) => void,
    text: string, setText: (s: string) => void,
    aType: 'pass_fail' | 'text' | 'toggle', setAType: (t: 'pass_fail' | 'text' | 'toggle') => void,
    expected: 'yes' | 'no', setExpected: (e: 'yes' | 'no') => void,
    listId: string,
  ) => (
    <>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
        <input
          type="text"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          list={listId}
          placeholder="e.g. Lights, Tyres"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 bg-white"
          autoFocus
        />
        {distinctCategories.length > 0 && (
          <datalist id={listId}>
            {distinctCategories.map(c => <option key={c} value={c} />)}
          </datalist>
        )}
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Item text</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="e.g. Headlights working — main beam and dipped"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 bg-white"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Answer type</label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {(['pass_fail', 'text', 'toggle'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setAType(t)}
              className={`px-3 py-2 rounded-lg border-2 text-xs font-medium transition text-left ${
                aType === t
                  ? 'border-blue-500 bg-blue-50 text-blue-800'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
              }`}
            >
              {ANSWER_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>
      {aType === 'toggle' && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <label className="block text-xs font-medium text-amber-800 mb-1">Which answer is correct/safe?</label>
          <p className="text-xs text-amber-700 mb-2">If the driver picks the other answer, it counts as a defect.</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setExpected('yes')}
              className={`flex-1 px-3 py-2 rounded-lg border-2 text-sm font-medium transition ${
                expected === 'yes'
                  ? 'border-green-500 bg-green-50 text-green-800'
                  : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              ✓ Yes is correct
            </button>
            <button
              type="button"
              onClick={() => setExpected('no')}
              className={`flex-1 px-3 py-2 rounded-lg border-2 text-sm font-medium transition ${
                expected === 'no'
                  ? 'border-green-500 bg-green-50 text-green-800'
                  : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              ✗ No is correct
            </button>
          </div>
        </div>
      )}
    </>
  )

  return (
    <div className="p-8 max-w-5xl">

      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 mb-1">Walk-Round Checklists</h1>
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
          <div className={`p-4 rounded-lg text-sm font-medium ${
            messageType === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            {message}
          </div>
        )}

        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm text-slate-700">
          <p className="font-medium text-slate-800">📋 What is this?</p>
          <p className="mt-1">
            These are the items drivers will tick off during a walk-round check. Each item can be set to <strong>Pass/Fail/N/A</strong>, <strong>Text answer</strong> (driver types a response), or <strong>Yes/No toggle</strong>. Click any item to edit it inline.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-2">
          <div className="flex gap-1 flex-wrap">
            {visibleVehicleTypes.map(t => (
              <button
                key={t.value}
                onClick={() => setActiveType(t.value)}
                className={`flex-1 min-w-[100px] px-3 py-2 rounded-lg text-sm font-medium transition ${
                  activeType === t.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-700'
                }`}
              >
                <span className="text-lg mr-1">{t.icon}</span>
                <span className="hidden sm:inline">{t.label.split(' ')[0]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">
              {getTypeIcon(activeType)} {getTypeLabel(activeType)}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">{items.length} items in {distinctCategories.length} categories</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={handleResetToDefaults}
              className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-lg text-xs font-medium"
            >
              ↻ Reset to DVSA Defaults
            </button>
            <button
              onClick={handleStartAddNew}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              + Add Item
            </button>
          </div>
        </div>

        {items.length === 0 && !addingNew ? (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-12 text-center">
            <div className="text-5xl mb-3">📋</div>
            <p className="text-slate-500 mb-1">No items yet</p>
            <button
              onClick={handleResetToDefaults}
              className="mt-4 text-blue-600 hover:underline text-sm font-medium"
            >
              Load DVSA defaults →
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {addingNew && (
              <div className="bg-white rounded-xl shadow overflow-hidden border-2 border-blue-400">
                <div className="bg-blue-50 px-4 py-2 border-b border-blue-200">
                  <p className="text-sm font-semibold text-blue-800">+ New item</p>
                </div>
                <div className="p-3 space-y-3">
                  {renderEditForm(
                    newCategory, setNewCategory,
                    newText, setNewText,
                    newAnswerType, setNewAnswerType,
                    newExpectedAnswer, setNewExpectedAnswer,
                    'cats-add'
                  )}
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={handleCancelAddNew}
                      className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveNew}
                      className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>
            )}

            {categoryOrder.map(category => {
              const list = grouped[category] || []
              return (
                <div key={category} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                  <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
                    <h3 className="font-semibold text-slate-800 text-sm uppercase tracking-wide">{category}</h3>
                    <p className="text-xs text-slate-500">{list.length} items</p>
                  </div>
                  <ul className="divide-y divide-slate-100">
                    {list.map((item, idx) => {
                      const isEditing = editingItemId === item.id
                      const isSaving = savingId === item.id
                      const itemAnswerType = item.answer_type || 'pass_fail'
                      const badge = ANSWER_TYPE_BADGES[itemAnswerType] || ANSWER_TYPE_BADGES.pass_fail

                      if (isEditing) {
                        return (
                          <li key={item.id} className="p-3 bg-blue-50 border-l-4 border-blue-500 space-y-3">
                            {renderEditForm(
                              inlineCategory, setInlineCategory,
                              inlineText, setInlineText,
                              inlineAnswerType, setInlineAnswerType,
                              inlineExpectedAnswer, setInlineExpectedAnswer,
                              'cats-edit'
                            )}
                            <div className="flex gap-2 justify-end">
                              <button
                                onClick={handleCancelInlineEdit}
                                disabled={isSaving}
                                className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded disabled:opacity-50"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => handleSaveInlineEdit(item)}
                                disabled={isSaving}
                                className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded disabled:opacity-50"
                              >
                                {isSaving ? 'Saving...' : 'Save'}
                              </button>
                            </div>
                          </li>
                        )
                      }

                      return (
                        <li key={item.id} className="p-3 flex items-center gap-3 hover:bg-slate-50 group">
                          <div className="flex flex-col gap-0.5 flex-shrink-0">
                            <button
                              onClick={() => handleMove(item, 'up')}
                              disabled={idx === 0}
                              className="text-slate-400 hover:text-slate-700 disabled:opacity-20 text-xs leading-none"
                              title="Move up"
                            >
                              ▲
                            </button>
                            <button
                              onClick={() => handleMove(item, 'down')}
                              disabled={idx === list.length - 1}
                              className="text-slate-400 hover:text-slate-700 disabled:opacity-20 text-xs leading-none"
                              title="Move down"
                            >
                              ▼
                            </button>
                          </div>
                          <button
                            onClick={() => handleStartInlineEdit(item)}
                            className="flex-1 text-left text-sm text-slate-800 hover:text-blue-600 cursor-pointer min-w-0"
                            title="Click to edit"
                          >
                            <div className="flex items-center gap-2 flex-wrap">
                              <span>{item.item_text}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${badge.color}`}>
                                {badge.label}
                              </span>
                              {itemAnswerType === 'toggle' && item.expected_answer && (
                                <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">
                                  ✓ {item.expected_answer.toUpperCase()}
                                </span>
                              )}
                            </div>
                          </button>
                          <div className="flex gap-2 flex-shrink-0 opacity-60 group-hover:opacity-100 transition">
                            <button
                              onClick={() => handleStartInlineEdit(item)}
                              className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1 rounded"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDelete(item)}
                              className="text-xs bg-red-100 hover:bg-red-200 text-red-700 px-2 py-1 rounded"
                            >
                              Delete
                            </button>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
          </div>
        )}

      </div>
    </div>
  )
}

const DEFAULT_ITEMS: Record<string, { category: string; item_text: string }[]> = {
  class_1: [
    { category: 'Cab', item_text: 'Cab interior clean and tidy' },
    { category: 'Cab', item_text: 'Seat belts working and secure' },
    { category: 'Cab', item_text: 'Steering wheel and column secure' },
    { category: 'Cab', item_text: 'Horn working' },
    { category: 'Cab', item_text: 'Mirrors clean, secure and properly adjusted' },
    { category: 'Cab', item_text: 'Windscreen clean, no damage, wipers/washers working' },
    { category: 'Cab', item_text: 'Dashboard warning lights all clear' },
    { category: 'Cab', item_text: 'Tachograph working with sufficient paper/data' },
    { category: 'Cab', item_text: 'Speedometer working' },
    { category: 'Lights', item_text: 'Headlights (main beam and dipped) working' },
    { category: 'Lights', item_text: 'Sidelights working' },
    { category: 'Lights', item_text: 'Brake lights working' },
    { category: 'Lights', item_text: 'Indicators front and rear working' },
    { category: 'Lights', item_text: 'Hazard lights working' },
    { category: 'Lights', item_text: 'Reversing lights working' },
    { category: 'Lights', item_text: 'Number plate lights working' },
    { category: 'Lights', item_text: 'Marker lights and reflectors clean and working' },
    { category: 'Tractor Unit', item_text: 'Tractor unit tyres - tread depth above 1mm' },
    { category: 'Tractor Unit', item_text: 'Tractor unit tyres - no cuts or damage' },
    { category: 'Tractor Unit', item_text: 'Tractor unit wheel nuts secure and indicators in line' },
    { category: 'Tractor Unit', item_text: 'Tractor unit suspension and air bags' },
    { category: 'Tractor Unit', item_text: 'Diesel level and no fuel leaks' },
    { category: 'Tractor Unit', item_text: 'AdBlue level' },
    { category: 'Tractor Unit', item_text: 'Engine oil level' },
    { category: 'Tractor Unit', item_text: 'Coolant level' },
    { category: 'Tractor Unit', item_text: 'Power steering fluid' },
    { category: 'Tractor Unit', item_text: 'Air pressure builds up correctly' },
    { category: 'Tractor Unit', item_text: 'No air leaks from tractor unit' },
    { category: 'Coupling', item_text: 'Fifth wheel coupling secure and locked' },
    { category: 'Coupling', item_text: 'Susies (air lines and electrics) connected and secure' },
    { category: 'Coupling', item_text: 'Trailer parking brake released' },
    { category: 'Trailer', item_text: 'Trailer tyres - tread depth above 1mm' },
    { category: 'Trailer', item_text: 'Trailer tyres - no cuts or damage' },
    { category: 'Trailer', item_text: 'Trailer wheel nuts secure' },
    { category: 'Trailer', item_text: 'Trailer lights all working' },
    { category: 'Trailer', item_text: 'Trailer mudguards and spray suppression secure' },
    { category: 'Trailer', item_text: 'Trailer body/curtains/doors secure' },
    { category: 'Trailer', item_text: 'Load secure and within limits' },
    { category: 'Trailer', item_text: 'Number plate clean and visible' },
    { category: 'Brakes', item_text: 'Service brake working correctly' },
    { category: 'Brakes', item_text: 'Parking brake holds vehicle' },
    { category: 'Brakes', item_text: 'No brake warning lights' },
    { category: 'Documents', item_text: 'Driving licence and CPC card' },
    { category: 'Documents', item_text: 'Vehicle registration document available' },
  ],
  class_2: [
    { category: 'Cab', item_text: 'Cab interior clean and tidy' },
    { category: 'Cab', item_text: 'Seat belts working and secure' },
    { category: 'Cab', item_text: 'Steering wheel and column secure' },
    { category: 'Cab', item_text: 'Horn working' },
    { category: 'Cab', item_text: 'Mirrors clean, secure and properly adjusted' },
    { category: 'Cab', item_text: 'Windscreen clean, no damage, wipers/washers working' },
    { category: 'Cab', item_text: 'Dashboard warning lights all clear' },
    { category: 'Cab', item_text: 'Tachograph working with sufficient paper/data' },
    { category: 'Cab', item_text: 'Speedometer working' },
    { category: 'Lights', item_text: 'Headlights (main beam and dipped) working' },
    { category: 'Lights', item_text: 'Sidelights working' },
    { category: 'Lights', item_text: 'Brake lights working' },
    { category: 'Lights', item_text: 'Indicators front and rear working' },
    { category: 'Lights', item_text: 'Hazard lights working' },
    { category: 'Lights', item_text: 'Reversing lights working' },
    { category: 'Lights', item_text: 'Number plate lights working' },
    { category: 'Lights', item_text: 'Marker lights and reflectors clean and working' },
    { category: 'Tyres & Wheels', item_text: 'Front tyres - tread depth above 1mm' },
    { category: 'Tyres & Wheels', item_text: 'Rear tyres - tread depth above 1mm' },
    { category: 'Tyres & Wheels', item_text: 'No cuts, bulges or damage to any tyres' },
    { category: 'Tyres & Wheels', item_text: 'Wheel nuts secure and indicators in line' },
    { category: 'Tyres & Wheels', item_text: 'Spare wheel secure (if fitted)' },
    { category: 'Fluids & Engine', item_text: 'Diesel level and no fuel leaks' },
    { category: 'Fluids & Engine', item_text: 'AdBlue level' },
    { category: 'Fluids & Engine', item_text: 'Engine oil level' },
    { category: 'Fluids & Engine', item_text: 'Coolant level' },
    { category: 'Fluids & Engine', item_text: 'Power steering fluid' },
    { category: 'Fluids & Engine', item_text: 'Windscreen washer fluid' },
    { category: 'Air System', item_text: 'Air pressure builds up correctly' },
    { category: 'Air System', item_text: 'No air leaks' },
    { category: 'Body & Load', item_text: 'Body and doors secure' },
    { category: 'Body & Load', item_text: 'Load secure and within limits' },
    { category: 'Body & Load', item_text: 'Mudguards and spray suppression secure' },
    { category: 'Body & Load', item_text: 'Number plates clean and visible' },
    { category: 'Brakes', item_text: 'Service brake working correctly' },
    { category: 'Brakes', item_text: 'Parking brake holds vehicle' },
    { category: 'Brakes', item_text: 'No brake warning lights' },
    { category: 'Documents', item_text: 'Driving licence and CPC card' },
    { category: 'Documents', item_text: 'Vehicle registration document available' },
  ],
  bus: [
    { category: 'Cab', item_text: 'Driver area clean and tidy' },
    { category: 'Cab', item_text: 'Driver seat belt working' },
    { category: 'Cab', item_text: 'Steering wheel secure with no excessive play' },
    { category: 'Cab', item_text: 'Horn working' },
    { category: 'Cab', item_text: 'Mirrors clean, secure and adjusted' },
    { category: 'Cab', item_text: 'Windscreen clean, no damage, wipers/washers working' },
    { category: 'Cab', item_text: 'Dashboard warning lights all clear' },
    { category: 'Cab', item_text: 'Tachograph/ticket machine working' },
    { category: 'Cab', item_text: 'Destination blind/sign clear and correct' },
    { category: 'Lights', item_text: 'Headlights (main beam and dipped) working' },
    { category: 'Lights', item_text: 'Sidelights working' },
    { category: 'Lights', item_text: 'Brake lights working' },
    { category: 'Lights', item_text: 'Indicators front and rear working' },
    { category: 'Lights', item_text: 'Hazard lights working' },
    { category: 'Lights', item_text: 'Interior saloon lights working' },
    { category: 'Lights', item_text: 'Reversing lights working' },
    { category: 'Lights', item_text: 'Number plate lights working' },
    { category: 'Tyres & Wheels', item_text: 'All tyres - tread depth above 1mm' },
    { category: 'Tyres & Wheels', item_text: 'No cuts, bulges or damage' },
    { category: 'Tyres & Wheels', item_text: 'Wheel nuts secure and indicators in line' },
    { category: 'Saloon', item_text: 'Passenger seats secure and undamaged' },
    { category: 'Saloon', item_text: 'Passenger seat belts working (if fitted)' },
    { category: 'Saloon', item_text: 'Floor clean and trip-hazard free' },
    { category: 'Saloon', item_text: 'Bell/stop buttons working' },
    { category: 'Saloon', item_text: 'Emergency exit clearly marked and operable' },
    { category: 'Saloon', item_text: 'Emergency hammer/cutter present' },
    { category: 'Saloon', item_text: 'CCTV operating (if fitted)' },
    { category: 'Saloon', item_text: 'Wheelchair ramp/lift operating' },
    { category: 'Saloon', item_text: 'Wheelchair restraint and seat belt available' },
    { category: 'Doors', item_text: 'Entrance door opens, closes and seals correctly' },
    { category: 'Doors', item_text: 'Exit door opens, closes and seals correctly' },
    { category: 'Doors', item_text: 'Door warning buzzer working' },
    { category: 'Fluids & Engine', item_text: 'Diesel level and no leaks' },
    { category: 'Fluids & Engine', item_text: 'AdBlue level' },
    { category: 'Fluids & Engine', item_text: 'Engine oil level' },
    { category: 'Fluids & Engine', item_text: 'Coolant level' },
    { category: 'Fluids & Engine', item_text: 'Air pressure builds up correctly' },
    { category: 'Brakes', item_text: 'Service brake working' },
    { category: 'Brakes', item_text: 'Parking brake holds vehicle' },
    { category: 'Brakes', item_text: 'No brake warning lights' },
    { category: 'Safety', item_text: 'Fire extinguisher in date and accessible' },
    { category: 'Safety', item_text: 'First aid kit complete and in date' },
    { category: 'Safety', item_text: 'Body panels and bumpers secure' },
    { category: 'Documents', item_text: 'Driving licence and CPC card' },
    { category: 'Documents', item_text: 'PSV operator disc displayed' },
  ],
  coach: [
    { category: 'Cab', item_text: 'Driver area clean and tidy' },
    { category: 'Cab', item_text: 'Driver seat belt working' },
    { category: 'Cab', item_text: 'Steering wheel secure with no excessive play' },
    { category: 'Cab', item_text: 'Horn working' },
    { category: 'Cab', item_text: 'Mirrors clean, secure and adjusted' },
    { category: 'Cab', item_text: 'Windscreen clean, no damage, wipers/washers working' },
    { category: 'Cab', item_text: 'Dashboard warning lights all clear' },
    { category: 'Cab', item_text: 'Tachograph working with sufficient paper/data' },
    { category: 'Cab', item_text: 'PA system / microphone working' },
    { category: 'Lights', item_text: 'Headlights (main beam and dipped) working' },
    { category: 'Lights', item_text: 'Sidelights working' },
    { category: 'Lights', item_text: 'Brake lights working' },
    { category: 'Lights', item_text: 'Indicators front and rear working' },
    { category: 'Lights', item_text: 'Hazard lights working' },
    { category: 'Lights', item_text: 'Interior saloon lights working' },
    { category: 'Lights', item_text: 'Reading lights at each seat' },
    { category: 'Lights', item_text: 'Reversing lights working' },
    { category: 'Lights', item_text: 'Number plate lights working' },
    { category: 'Tyres & Wheels', item_text: 'All tyres - tread depth above 1mm' },
    { category: 'Tyres & Wheels', item_text: 'No cuts, bulges or damage' },
    { category: 'Tyres & Wheels', item_text: 'Wheel nuts secure and indicators in line' },
    { category: 'Saloon', item_text: 'Passenger seats secure with seat belts working' },
    { category: 'Saloon', item_text: 'Floor and aisle clean and trip-hazard free' },
    { category: 'Saloon', item_text: 'Air conditioning / heating working' },
    { category: 'Saloon', item_text: 'Emergency exits clearly marked and operable' },
    { category: 'Saloon', item_text: 'Emergency hammer/cutter present' },
    { category: 'Saloon', item_text: 'Toilet (if fitted) clean and operating' },
    { category: 'Saloon', item_text: 'CCTV operating (if fitted)' },
    { category: 'Saloon', item_text: 'Wheelchair ramp/lift operating (if fitted)' },
    { category: 'Doors', item_text: 'Entrance door opens, closes and seals correctly' },
    { category: 'Doors', item_text: 'Door warning buzzer working' },
    { category: 'Luggage', item_text: 'Luggage compartments secure with no damage' },
    { category: 'Luggage', item_text: 'Luggage compartment locks working' },
    { category: 'Fluids & Engine', item_text: 'Diesel level and no leaks' },
    { category: 'Fluids & Engine', item_text: 'AdBlue level' },
    { category: 'Fluids & Engine', item_text: 'Engine oil level' },
    { category: 'Fluids & Engine', item_text: 'Coolant level' },
    { category: 'Fluids & Engine', item_text: 'Air pressure builds up correctly' },
    { category: 'Brakes', item_text: 'Service brake working' },
    { category: 'Brakes', item_text: 'Parking brake holds vehicle' },
    { category: 'Brakes', item_text: 'No brake warning lights' },
    { category: 'Safety', item_text: 'Fire extinguisher in date and accessible' },
    { category: 'Safety', item_text: 'First aid kit complete and in date' },
    { category: 'Safety', item_text: 'Spillage kit available' },
    { category: 'Safety', item_text: 'Body panels and bumpers secure' },
    { category: 'Documents', item_text: 'Driving licence and CPC card' },
    { category: 'Documents', item_text: 'PSV operator disc displayed' },
  ],
  minibus: [
    { category: 'Cab', item_text: 'Driver area clean and tidy' },
    { category: 'Cab', item_text: 'Driver seat belt working' },
    { category: 'Cab', item_text: 'Steering wheel secure' },
    { category: 'Cab', item_text: 'Horn working' },
    { category: 'Cab', item_text: 'Mirrors clean, secure and adjusted' },
    { category: 'Cab', item_text: 'Windscreen clean, no damage, wipers/washers working' },
    { category: 'Cab', item_text: 'Dashboard warning lights all clear' },
    { category: 'Cab', item_text: 'Speedometer working' },
    { category: 'Lights', item_text: 'Headlights (main beam and dipped) working' },
    { category: 'Lights', item_text: 'Sidelights working' },
    { category: 'Lights', item_text: 'Brake lights working' },
    { category: 'Lights', item_text: 'Indicators front and rear working' },
    { category: 'Lights', item_text: 'Hazard lights working' },
    { category: 'Lights', item_text: 'Interior lights working' },
    { category: 'Lights', item_text: 'Reversing lights working' },
    { category: 'Lights', item_text: 'Number plate lights working' },
    { category: 'Tyres & Wheels', item_text: 'All tyres - tread depth above 1.6mm' },
    { category: 'Tyres & Wheels', item_text: 'No cuts, bulges or damage' },
    { category: 'Tyres & Wheels', item_text: 'Wheel nuts secure' },
    { category: 'Tyres & Wheels', item_text: 'Spare wheel secure (if fitted)' },
    { category: 'Saloon', item_text: 'All passenger seat belts working' },
    { category: 'Saloon', item_text: 'Seats and seat anchorages secure' },
    { category: 'Saloon', item_text: 'Wheelchair ramp/lift operating (if fitted)' },
    { category: 'Saloon', item_text: 'Wheelchair restraints available (if applicable)' },
    { category: 'Saloon', item_text: 'Emergency exit clearly marked and operable' },
    { category: 'Saloon', item_text: 'Emergency hammer/cutter present' },
    { category: 'Doors', item_text: 'Side door opens and closes correctly' },
    { category: 'Doors', item_text: 'Rear/tailgate door secure' },
    { category: 'Fluids & Engine', item_text: 'Fuel level and no leaks' },
    { category: 'Fluids & Engine', item_text: 'Engine oil level' },
    { category: 'Fluids & Engine', item_text: 'Coolant level' },
    { category: 'Fluids & Engine', item_text: 'Brake fluid level' },
    { category: 'Fluids & Engine', item_text: 'Power steering fluid' },
    { category: 'Fluids & Engine', item_text: 'Windscreen washer fluid' },
    { category: 'Brakes', item_text: 'Service brake working' },
    { category: 'Brakes', item_text: 'Parking brake holds vehicle' },
    { category: 'Brakes', item_text: 'No brake warning lights' },
    { category: 'Safety', item_text: 'Fire extinguisher in date and accessible' },
    { category: 'Safety', item_text: 'First aid kit complete and in date' },
    { category: 'Safety', item_text: 'Body panels and bumpers secure' },
    { category: 'Documents', item_text: 'Driving licence (D1 if 9+ seats)' },
    { category: 'Documents', item_text: 'Section 19 / Section 22 permit if required' },
  ],
}
