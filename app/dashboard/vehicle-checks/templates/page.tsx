'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useIdleLogout, IdleWarningModal } from '@/lib/useIdleLogout'
import { logAuditClient } from '@/lib/auditClient'

const supabase = createClient()

const VEHICLE_TYPES = [
  { value: 'class_1', label: 'Class 1 (HGV Articulated)', icon: '🚛' },
  { value: 'class_2', label: 'Class 2 (HGV Rigid)', icon: '🚚' },
  { value: 'bus', label: 'Bus', icon: '🚌' },
  { value: 'coach', label: 'Coach', icon: '🚍' },
  { value: 'minibus', label: 'Minibus', icon: '🚐' },
] as const

export default function ChecklistTemplatesPage() {
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  const [activeType, setActiveType] = useState<string>('class_1')
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [items, setItems] = useState<any[]>([])

  // Add/edit form state
  const [showAdd, setShowAdd] = useState(false)
  const [editingItem, setEditingItem] = useState<any>(null)
  const [formCategory, setFormCategory] = useState('')
  const [formItemText, setFormItemText] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const router = useRouter()
  const { showWarning, secondsLeft, stayLoggedIn } = useIdleLogout(true)

  const showMessage = (msg: string, type: 'success' | 'error') => {
    setMessage(msg)
    setMessageType(type)
    setTimeout(() => setMessage(''), 4000)
  }

  const loadTemplate = useCallback(async (companyId: string, type: string) => {
    // Get template (may not exist yet for newly added vehicle type)
    let { data: template } = await supabase
      .from('vehicle_check_templates')
      .select('*')
      .eq('company_id', companyId)
      .eq('vehicle_type', type)
      .maybeSingle()

    if (!template) {
      // Auto-create empty template
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

    await loadTemplate(profile.company_id, activeType)
    setLoading(false)
  }, [router, activeType, loadTemplate])

  useEffect(() => { init() }, [init])

  // Reload when switching vehicle type
  useEffect(() => {
    if (!currentUser?.company_id) return
    loadTemplate(currentUser.company_id, activeType)
  }, [activeType, currentUser?.company_id, loadTemplate])

  // Realtime
  useEffect(() => {
    if (!templateId) return
    const channel = supabase
      .channel(`template-items-${templateId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_check_template_items', filter: `template_id=eq.${templateId}` }, () => {
        loadTemplate(currentUser.company_id, activeType)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [templateId, currentUser?.company_id, activeType, loadTemplate])

  const handleStartAdd = () => {
    setEditingItem(null)
    setFormCategory('')
    setFormItemText('')
    setShowAdd(true)
  }

  const handleStartEdit = (item: any) => {
    setEditingItem(item)
    setFormCategory(item.category)
    setFormItemText(item.item_text)
    setShowAdd(true)
  }

  const handleCancelForm = () => {
    setShowAdd(false)
    setEditingItem(null)
    setFormCategory('')
    setFormItemText('')
  }

  const handleSubmitItem = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!templateId) return

    if (!formCategory.trim() || !formItemText.trim()) {
      showMessage('Both category and item text are required', 'error')
      return
    }

    setSubmitting(true)

    if (editingItem) {
      const { error } = await supabase
        .from('vehicle_check_template_items')
        .update({
          category: formCategory.trim(),
          item_text: formItemText.trim(),
        })
        .eq('id', editingItem.id)

      setSubmitting(false)

      if (error) {
        showMessage('Error: ' + error.message, 'error')
        return
      }

      await logAuditClient({
        user: currentUser,
        action: 'CHECK_ITEM_UPDATED',
        entity: 'vehicle_check_template_item',
        entity_id: editingItem.id,
        details: { vehicle_type: activeType, category: formCategory, item_text: formItemText },
      })

      showMessage('Item updated', 'success')
    } else {
      // Append at end with display_order = max + 10
      const maxOrder = items.length > 0 ? Math.max(...items.map(i => i.display_order || 0)) : 0
      const { data, error } = await supabase
        .from('vehicle_check_template_items')
        .insert({
          template_id: templateId,
          category: formCategory.trim(),
          item_text: formItemText.trim(),
          display_order: maxOrder + 10,
        })
        .select()
        .single()

      setSubmitting(false)

      if (error) {
        showMessage('Error: ' + error.message, 'error')
        return
      }

      await logAuditClient({
        user: currentUser,
        action: 'CHECK_ITEM_CREATED',
        entity: 'vehicle_check_template_item',
        entity_id: data?.id,
        details: { vehicle_type: activeType, category: formCategory, item_text: formItemText },
      })

      showMessage('Item added', 'success')
    }

    handleCancelForm()
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
    // Find item in same category
    const sameCategoryItems = items
      .filter(i => i.category === item.category)
      .sort((a, b) => (a.display_order || 0) - (b.display_order || 0))

    const currentIndex = sameCategoryItems.findIndex(i => i.id === item.id)
    const swapIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1

    if (swapIndex < 0 || swapIndex >= sameCategoryItems.length) return

    const otherItem = sameCategoryItems[swapIndex]

    // Swap display_order values
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

    // Delete all current items
    const { error: delError } = await supabase
      .from('vehicle_check_template_items')
      .delete()
      .eq('template_id', templateId)

    if (delError) {
      showMessage('Error clearing items: ' + delError.message, 'error')
      return
    }

    // Re-seed defaults via SQL function would be cleaner, but we'll do it client-side
    const defaults = DEFAULT_ITEMS[activeType] || []
    if (defaults.length > 0) {
      const { error: insError } = await supabase
        .from('vehicle_check_template_items')
        .insert(defaults.map((d, i) => ({
          template_id: templateId,
          category: d.category,
          item_text: d.item_text,
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

  const getTypeLabel = (type: string) => VEHICLE_TYPES.find(t => t.value === type)?.label || type
  const getTypeIcon = (type: string) => VEHICLE_TYPES.find(t => t.value === type)?.icon || '🚗'

  // Group items by category
  const grouped: Record<string, any[]> = {}
  items.forEach(item => {
    if (!grouped[item.category]) grouped[item.category] = []
    grouped[item.category].push(item)
  })
  Object.keys(grouped).forEach(cat => {
    grouped[cat].sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
  })

  // Get distinct categories (sorted by first item's order)
  const categoryOrder = Object.entries(grouped)
    .map(([cat, list]) => ({ cat, firstOrder: list[0]?.display_order || 0 }))
    .sort((a, b) => a.firstOrder - b.firstOrder)
    .map(x => x.cat)

  const distinctCategories = Array.from(new Set(items.map(i => i.category))).sort()

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-500">Loading templates...</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-100">
      <IdleWarningModal show={showWarning} secondsLeft={secondsLeft} onStay={stayLoggedIn} />

      <div className="bg-blue-700 text-white px-6 py-4 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">{company?.name}</h1>
          <p className="text-blue-200 text-sm">Walk-Round Checklists</p>
        </div>
        <button
          onClick={() => router.push('/dashboard/vehicles')}
          className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm"
        >
          ← Back
        </button>
      </div>

      <div className="max-w-5xl mx-auto p-6 space-y-4">

        {message && (
          <div className={`p-4 rounded-lg text-sm font-medium ${
            messageType === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            {message}
          </div>
        )}

        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
          <p className="font-medium">📋 What is this?</p>
          <p className="mt-1 text-blue-700">
            These are the items drivers will tick off when doing a walk-round check. Each vehicle type has its own checklist. You can add, edit or remove items, and reset back to DVSA defaults at any time.
          </p>
        </div>

        {/* Vehicle type tabs */}
        <div className="bg-white rounded-xl shadow p-2">
          <div className="flex gap-1 flex-wrap">
            {VEHICLE_TYPES.map(t => (
              <button
                key={t.value}
                onClick={() => setActiveType(t.value)}
                className={`flex-1 min-w-[100px] px-3 py-2 rounded-lg text-sm font-medium transition ${
                  activeType === t.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-50 hover:bg-gray-100 text-gray-700'
                }`}
              >
                <span className="text-lg mr-1">{t.icon}</span>
                <span className="hidden sm:inline">{t.label.split(' ')[0]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Title + actions */}
        <div className="bg-white rounded-xl shadow p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">
              {getTypeIcon(activeType)} {getTypeLabel(activeType)}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">{items.length} items in {distinctCategories.length} categories</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={handleResetToDefaults}
              className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded-lg text-xs font-medium"
            >
              ↻ Reset to DVSA Defaults
            </button>
            <button
              onClick={handleStartAdd}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              + Add Item
            </button>
          </div>
        </div>

        {showAdd && (
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">
              {editingItem ? 'Edit Item' : 'New Checklist Item'}
            </h3>
            <form onSubmit={handleSubmitItem} className="space-y-4">

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Category *
                </label>
                <input
                  type="text"
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  list="existing-categories"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                  placeholder="e.g. Lights, Tyres, Cab"
                  required
                />
                {distinctCategories.length > 0 && (
                  <datalist id="existing-categories">
                    {distinctCategories.map(c => <option key={c} value={c} />)}
                  </datalist>
                )}
                <p className="text-xs text-gray-500 mt-1">Pick from existing categories or type a new one</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Item Text *
                </label>
                <textarea
                  value={formItemText}
                  onChange={(e) => setFormItemText(e.target.value)}
                  rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                  placeholder="e.g. Headlights working — main beam and dipped"
                  required
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg font-medium disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : (editingItem ? 'Save Changes' : 'Add Item')}
                </button>
                <button
                  type="button"
                  onClick={handleCancelForm}
                  className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-6 py-2.5 rounded-lg font-medium"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {items.length === 0 ? (
          <div className="bg-white rounded-xl shadow p-12 text-center">
            <div className="text-5xl mb-3">📋</div>
            <p className="text-gray-500 mb-1">No items yet</p>
            <button
              onClick={handleResetToDefaults}
              className="mt-4 text-blue-600 hover:underline text-sm font-medium"
            >
              Load DVSA defaults →
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {categoryOrder.map(category => {
              const list = grouped[category] || []
              return (
                <div key={category} className="bg-white rounded-xl shadow overflow-hidden">
                  <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                    <h3 className="font-semibold text-gray-800 text-sm uppercase tracking-wide">{category}</h3>
                    <p className="text-xs text-gray-500">{list.length} items</p>
                  </div>
                  <ul className="divide-y divide-gray-100">
                    {list.map((item, idx) => (
                      <li key={item.id} className="p-3 flex items-center gap-3 hover:bg-gray-50">
                        <div className="flex flex-col gap-0.5 flex-shrink-0">
                          <button
                            onClick={() => handleMove(item, 'up')}
                            disabled={idx === 0}
                            className="text-gray-400 hover:text-gray-700 disabled:opacity-20 text-xs leading-none"
                            title="Move up"
                          >
                            ▲
                          </button>
                          <button
                            onClick={() => handleMove(item, 'down')}
                            disabled={idx === list.length - 1}
                            className="text-gray-400 hover:text-gray-700 disabled:opacity-20 text-xs leading-none"
                            title="Move down"
                          >
                            ▼
                          </button>
                        </div>
                        <p className="flex-1 text-sm text-gray-800">{item.item_text}</p>
                        <div className="flex gap-2 flex-shrink-0">
                          <button
                            onClick={() => handleStartEdit(item)}
                            className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-1 rounded"
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
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        )}

      </div>
    </main>
  )
}

// ─────────────────────────────────────────────────────────
// Default DVSA items used by "Reset to defaults" button
// (mirrors the seed SQL from Step 2)
// ─────────────────────────────────────────────────────────
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