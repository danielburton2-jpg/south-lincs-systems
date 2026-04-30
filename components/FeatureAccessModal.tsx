'use client'

/**
 * FeatureAccessModal — opens from the user form to manage feature
 * access at a granular level.
 *
 * Layout: a list of bordered "feature boxes". Each box's title is the
 * feature name. The contents depend on the feature:
 *
 *   • holidays  — three radios: Off / Read / Edit
 *                 Off  = no access (no tile, can't open page)
 *                 Read = can submit own requests, see own balance
 *                 Edit = can also approve/reject, see calendar, see
 *                        Manage Employee tools (admin gates stay)
 *                        Edit also unlocks reports when those ship.
 *
 *   • all other features — single "Enabled" checkbox for now. Other
 *     features will get their own granular options later when the
 *     features themselves are built.
 *
 * Save merely returns the new user_features array to the parent. The
 * actual database write happens with the form submit.
 *
 * Admin role bypass: if the user being edited is an admin, the modal
 * still shows the controls but tells the admin user that admins
 * always have full access regardless of these settings.
 */

import { useState, useEffect } from 'react'

export type Feature = {
  id: string
  slug: string
  name: string
  description?: string | null
}

export type UserFeatureRow = {
  feature_id: string
  is_enabled: boolean
  can_view?: boolean
  can_edit?: boolean
  can_view_reports?: boolean
}

export type FeatureLevel = 'off' | 'read' | 'edit'

type Props = {
  open: boolean
  features: Feature[]            // catalogue of all features the company has enabled
  initial: UserFeatureRow[]      // current state for this user
  isAdmin: boolean               // if the user being edited is an admin
  onClose: () => void
  onSave: (rows: UserFeatureRow[]) => void
}

const HOLIDAYS_SLUG = 'holidays'

/**
 * Convert a UserFeatureRow into a level for the holidays radio.
 * Edit takes precedence over Read.
 */
function levelFor(row: UserFeatureRow | undefined): FeatureLevel {
  if (!row || !row.is_enabled) return 'off'
  if (row.can_edit) return 'edit'
  if (row.can_view) return 'read'
  return 'off'
}

/**
 * Convert a level back into a UserFeatureRow.
 */
function rowFromLevel(featureId: string, level: FeatureLevel): UserFeatureRow {
  if (level === 'off') {
    return { feature_id: featureId, is_enabled: false, can_view: false, can_edit: false, can_view_reports: false }
  }
  if (level === 'read') {
    return { feature_id: featureId, is_enabled: true, can_view: true, can_edit: false, can_view_reports: false }
  }
  // edit — implies view, and (later) reports
  return { feature_id: featureId, is_enabled: true, can_view: true, can_edit: true, can_view_reports: true }
}

/**
 * Convert an enabled checkbox into a UserFeatureRow.
 */
function rowFromChecked(featureId: string, checked: boolean): UserFeatureRow {
  return {
    feature_id: featureId,
    is_enabled: checked,
    can_view: checked,
    can_edit: checked,
    can_view_reports: false,
  }
}

export default function FeatureAccessModal({
  open, features, initial, isAdmin, onClose, onSave,
}: Props) {
  // Keep a working copy of the rows that we mutate as the user clicks.
  const [working, setWorking] = useState<Record<string, UserFeatureRow>>({})

  // Reset working state every time the modal opens.
  useEffect(() => {
    if (!open) return
    const next: Record<string, UserFeatureRow> = {}
    for (const f of features) {
      const existing = initial.find(r => r.feature_id === f.id)
      next[f.id] = existing
        ? { ...existing }
        : { feature_id: f.id, is_enabled: false, can_view: false, can_edit: false, can_view_reports: false }
    }
    setWorking(next)
  }, [open, features, initial])

  if (!open) return null

  const setHolidaysLevel = (featureId: string, level: FeatureLevel) => {
    setWorking(prev => ({ ...prev, [featureId]: rowFromLevel(featureId, level) }))
  }

  const setEnabled = (featureId: string, checked: boolean) => {
    setWorking(prev => ({ ...prev, [featureId]: rowFromChecked(featureId, checked) }))
  }

  const handleSave = () => {
    onSave(features.map(f => working[f.id]))
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Feature Access</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Choose what this user can see and do in each feature.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {isAdmin && (
            <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-sm text-purple-700">
              ✓ This user is an <strong>admin</strong> and automatically has full access to every feature, regardless of the settings below.
            </div>
          )}

          {features.length === 0 ? (
            <p className="text-sm text-slate-500 italic">
              The company doesn&apos;t have any features enabled.
            </p>
          ) : (
            features.map(f => {
              const row = working[f.id] || { feature_id: f.id, is_enabled: false, can_view: false, can_edit: false }
              if (f.slug === HOLIDAYS_SLUG) {
                const level = levelFor(row)
                return (
                  <div key={f.id} className="border border-slate-200 rounded-xl p-4">
                    <h3 className="font-semibold text-slate-800 mb-1">{f.name}</h3>
                    {f.description && <p className="text-xs text-slate-500 mb-3">{f.description}</p>}
                    <div className="space-y-2">
                      <RadioRow
                        name={`feature-${f.id}`}
                        value="off"
                        checked={level === 'off'}
                        onChange={() => setHolidaysLevel(f.id, 'off')}
                        label="Off"
                        description="No access. Holidays tile hidden from home page."
                      />
                      <RadioRow
                        name={`feature-${f.id}`}
                        value="read"
                        checked={level === 'read'}
                        onChange={() => setHolidaysLevel(f.id, 'read')}
                        label="Read"
                        description="Can submit their own holiday requests and see their own balance."
                      />
                      <RadioRow
                        name={`feature-${f.id}`}
                        value="edit"
                        checked={level === 'edit'}
                        onChange={() => setHolidaysLevel(f.id, 'edit')}
                        label="Edit"
                        description="Everything in Read, plus approve/reject requests, see the calendar, and (later) view reports. Managers still only see staff in their job titles."
                      />
                    </div>
                  </div>
                )
              }

              // Other features — single "Enabled" checkbox for now
              return (
                <div key={f.id} className="border border-slate-200 rounded-xl p-4">
                  <h3 className="font-semibold text-slate-800 mb-1">{f.name}</h3>
                  {f.description && <p className="text-xs text-slate-500 mb-3">{f.description}</p>}
                  <label className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition border ${
                    row.is_enabled ? 'border-blue-400 bg-blue-50' : 'border-slate-200'
                  }`}>
                    <input type="checkbox" className="w-4 h-4"
                      checked={row.is_enabled}
                      onChange={e => setEnabled(f.id, e.target.checked)} />
                    <div className="text-sm">
                      <p className="font-medium text-slate-800">Enabled</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Granular controls for this feature will be available when it&apos;s built out.
                      </p>
                    </div>
                  </label>
                </div>
              )
            })
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex gap-3">
          <button onClick={onClose}
            className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium py-2.5 rounded-lg">
            Cancel
          </button>
          <button onClick={handleSave}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg">
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}

function RadioRow({
  name, value, checked, onChange, label, description,
}: {
  name: string
  value: string
  checked: boolean
  onChange: () => void
  label: string
  description: string
}) {
  return (
    <label className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition border ${
      checked ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-slate-300'
    }`}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange}
        className="mt-1 w-4 h-4" />
      <div className="text-sm flex-1">
        <p className="font-medium text-slate-800">{label}</p>
        <p className="text-xs text-slate-500 mt-0.5">{description}</p>
      </div>
    </label>
  )
}
