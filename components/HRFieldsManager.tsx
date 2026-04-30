'use client'

/**
 * HRFieldsManager — modal opened from the ⚙️ button on the users page.
 * Superuser uses this to define which custom HR fields exist for the
 * company (NI Number, Driving Licence Expiry, etc).
 *
 * Each field has: label, type, dropdown options (if dropdown), required flag.
 *
 * Field type cannot be changed after creation. Other things (label,
 * required, dropdown options) can be edited freely.
 */

import { useEffect, useState } from 'react'

export type HRFieldType = 'text' | 'long_text' | 'number' | 'date' | 'dropdown' | 'checkbox'

export type HRFieldDef = {
  id: string
  company_id: string
  field_key: string
  label: string
  field_type: HRFieldType
  dropdown_options: string[]
  is_required: boolean
  display_order: number
}

const TYPE_OPTIONS: { value: HRFieldType; label: string; icon: string; canRequire: boolean }[] = [
  { value: 'text',      label: 'Short text', icon: '📝', canRequire: false },
  { value: 'long_text', label: 'Long text',  icon: '📄', canRequire: false },
  { value: 'number',    label: 'Number',     icon: '🔢', canRequire: true  },
  { value: 'date',      label: 'Date',       icon: '📅', canRequire: true  },
  { value: 'dropdown',  label: 'Dropdown',   icon: '📋', canRequire: true  },
  { value: 'checkbox',  label: 'Yes/No',     icon: '☑️', canRequire: false },
]

type Props = {
  open: boolean
  companyId: string
  companyName: string
  actorId: string
  actorEmail: string
  onClose: () => void
  onChanged?: () => void
}

export default function HRFieldsManager({
  open, companyId, companyName, actorId, actorEmail, onClose, onChanged,
}: Props) {
  const [fields, setFields] = useState<HRFieldDef[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Add form
  const [newLabel, setNewLabel] = useState('')
  const [newType, setNewType] = useState<HRFieldType>('text')
  const [newRequired, setNewRequired] = useState(false)
  const [newOptionsText, setNewOptionsText] = useState('')

  // Inline edit
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editRequired, setEditRequired] = useState(false)
  const [editOptionsText, setEditOptionsText] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/company-user-fields?company_id=${companyId}`)
      const data = await res.json()
      if (res.ok) setFields(data.fields || [])
      else setError(data.error || 'Failed to load')
    } catch (e: any) {
      setError(e?.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      setError('')
      setEditingId(null)
      setNewLabel('')
      setNewType('text')
      setNewRequired(false)
      setNewOptionsText('')
      load()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, companyId])

  if (!open) return null

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newLabel.trim()) {
      setError('Field label is required')
      return
    }
    if (newType === 'dropdown') {
      const opts = newOptionsText.split(',').map(s => s.trim()).filter(Boolean)
      if (opts.length === 0) {
        setError('Dropdown needs at least one option')
        return
      }
    }
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/company-user-fields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          company_id: companyId,
          label: newLabel.trim(),
          field_type: newType,
          dropdown_options: newType === 'dropdown'
            ? newOptionsText.split(',').map(s => s.trim()).filter(Boolean)
            : [],
          is_required: newRequired,
          actor_id: actorId,
          actor_email: actorEmail,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to add')
      setNewLabel('')
      setNewType('text')
      setNewRequired(false)
      setNewOptionsText('')
      await load()
      onChanged?.()
    } catch (e: any) {
      setError(e?.message || 'Failed to add')
    } finally {
      setBusy(false)
    }
  }

  const startEdit = (f: HRFieldDef) => {
    setEditingId(f.id)
    setEditLabel(f.label)
    setEditRequired(f.is_required)
    setEditOptionsText((f.dropdown_options || []).join(', '))
    setError('')
  }
  const cancelEdit = () => setEditingId(null)

  const handleSaveEdit = async (f: HRFieldDef) => {
    if (!editLabel.trim()) {
      setError('Label cannot be empty')
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/company-user-fields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          field_id: f.id,
          label: editLabel.trim(),
          is_required: editRequired,
          dropdown_options: f.field_type === 'dropdown'
            ? editOptionsText.split(',').map(s => s.trim()).filter(Boolean)
            : undefined,
          actor_id: actorId,
          actor_email: actorEmail,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save')
      setEditingId(null)
      await load()
      onChanged?.()
    } catch (e: any) {
      setError(e?.message || 'Failed to save')
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (f: HRFieldDef) => {
    if (!confirm(`Remove the field "${f.label}"?\n\nValues already saved for this field will be preserved (hidden from the UI). If you re-add a field with the same internal key, they'll come back.`)) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/company-user-fields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete',
          field_id: f.id,
          actor_id: actorId,
          actor_email: actorEmail,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete')
      await load()
      onChanged?.()
    } catch (e: any) {
      setError(e?.message || 'Failed to delete')
    } finally {
      setBusy(false)
    }
  }

  const newTypeMeta = TYPE_OPTIONS.find(t => t.value === newType)!

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">HR Information — Settings</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Configure custom fields for <strong>{companyName}</strong>. Admins can fill these in when editing users.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
        </div>

        {error && (
          <div className="mx-6 mt-3 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{error}</div>
        )}

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Existing fields */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-2">Existing fields</h3>
            {loading ? (
              <p className="text-sm text-slate-500 italic">Loading…</p>
            ) : fields.length === 0 ? (
              <p className="text-sm text-slate-400 italic">No HR fields yet. Add one below.</p>
            ) : (
              <ul className="divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden">
                {fields.map(f => {
                  const meta = TYPE_OPTIONS.find(t => t.value === f.field_type)
                  const isEditing = editingId === f.id
                  return (
                    <li key={f.id} className="p-3">
                      {!isEditing ? (
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-lg">{meta?.icon}</span>
                              <span className="font-medium text-slate-800">{f.label}</span>
                              <span className="text-[10px] uppercase font-bold text-slate-400">{meta?.label}</span>
                              {f.is_required && (
                                <span className="text-[10px] uppercase font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">Required</span>
                              )}
                            </div>
                            {f.field_type === 'dropdown' && f.dropdown_options.length > 0 && (
                              <p className="text-xs text-slate-500 mt-0.5 ml-7 truncate">
                                Options: {f.dropdown_options.join(', ')}
                              </p>
                            )}
                            <p className="text-[10px] text-slate-400 mt-0.5 ml-7 font-mono">key: {f.field_key}</p>
                          </div>
                          <div className="flex gap-1 flex-shrink-0">
                            <button onClick={() => startEdit(f)} disabled={busy}
                              className="text-xs bg-blue-100 hover:bg-blue-200 text-blue-800 px-2 py-1 rounded font-medium">
                              Edit
                            </button>
                            <button onClick={() => handleDelete(f)} disabled={busy}
                              className="text-xs bg-red-100 hover:bg-red-200 text-red-800 px-2 py-1 rounded font-medium">
                              Remove
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2 bg-blue-50/50 p-2 rounded">
                          <div>
                            <label className="text-xs font-medium text-slate-600">Label</label>
                            <input
                              type="text"
                              value={editLabel}
                              onChange={e => setEditLabel(e.target.value)}
                              className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
                            />
                          </div>
                          {f.field_type === 'dropdown' && (
                            <div>
                              <label className="text-xs font-medium text-slate-600">Options (comma-separated)</label>
                              <input
                                type="text"
                                value={editOptionsText}
                                onChange={e => setEditOptionsText(e.target.value)}
                                className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
                              />
                            </div>
                          )}
                          {['date', 'number', 'dropdown'].includes(f.field_type) && (
                            <label className="flex items-center gap-2 text-xs text-slate-700">
                              <input type="checkbox" checked={editRequired}
                                onChange={e => setEditRequired(e.target.checked)} />
                              Required (admin must fill in to save user)
                            </label>
                          )}
                          <div className="flex gap-2">
                            <button onClick={() => handleSaveEdit(f)} disabled={busy}
                              className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded font-medium">
                              Save
                            </button>
                            <button onClick={cancelEdit} disabled={busy}
                              className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1 rounded font-medium">
                              Cancel
                            </button>
                          </div>
                          <p className="text-[10px] text-slate-400 italic">
                            Note: field type can&apos;t be changed after creation. To change the type, remove this field and add a new one.
                          </p>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* Add new */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">+ Add a new field</h3>
            <form onSubmit={handleAdd} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Field label</label>
                <input
                  type="text"
                  value={newLabel}
                  onChange={e => setNewLabel(e.target.value)}
                  placeholder="e.g. NI Number, Driving Licence Expiry, Emergency Contact"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Field type</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {TYPE_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        setNewType(opt.value)
                        if (!opt.canRequire) setNewRequired(false)
                      }}
                      className={`p-2 border-2 rounded-lg text-xs text-left transition ${
                        newType === opt.value
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="text-base">{opt.icon}</div>
                      <div className="font-medium text-slate-800">{opt.label}</div>
                    </button>
                  ))}
                </div>
              </div>
              {newType === 'dropdown' && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Dropdown options</label>
                  <input
                    type="text"
                    value={newOptionsText}
                    onChange={e => setNewOptionsText(e.target.value)}
                    placeholder="e.g. Full, Provisional, None — separate with commas"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}
              {newTypeMeta.canRequire && (
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={newRequired}
                    onChange={e => setNewRequired(e.target.checked)} />
                  Required — admin must fill in this field to save a user
                </label>
              )}
              <button
                type="submit"
                disabled={busy || !newLabel.trim()}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {busy ? 'Adding…' : '+ Add field'}
              </button>
            </form>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-slate-200 flex justify-end bg-slate-50">
          <button onClick={onClose}
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-5 py-2 rounded-lg font-medium">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
