'use client'

/**
 * HRFieldsPanel — renders inline on user create/edit forms.
 *
 * Reads the company's HR field definitions and renders the right input
 * for each one. No header / no panel wrapper — fields look like normal
 * form fields and sit right where the parent puts them.
 *
 * Also exports validateHRFields() — a helper to check required fields
 * before submitting. Returns null on success, or an error message naming
 * the first missing required field.
 */

import type { HRFieldDef } from './HRFieldsManager'

type Props = {
  fields: HRFieldDef[]
  values: Record<string, any>
  onChange: (next: Record<string, any>) => void
  showRequiredHints?: boolean
  readOnly?: boolean
}

export default function HRFieldsPanel({
  fields, values, onChange, showRequiredHints, readOnly,
}: Props) {
  if (!fields || fields.length === 0) return null

  const setValue = (key: string, v: any) => {
    onChange({ ...values, [key]: v })
  }

  // Stable order — by display_order, then label
  const sorted = [...fields].sort((a, b) => {
    const dx = (a.display_order || 0) - (b.display_order || 0)
    return dx !== 0 ? dx : a.label.localeCompare(b.label)
  })

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {sorted.map(f => {
        const v = values?.[f.field_key]
        const reqMark = f.is_required && showRequiredHints
          ? <span className="text-red-600 ml-0.5">*</span>
          : null

        return (
          <div key={f.id} className={f.field_type === 'long_text' ? 'md:col-span-2' : ''}>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {f.label}{reqMark}
            </label>

            {f.field_type === 'text' && (
              <input
                type="text"
                value={v ?? ''}
                onChange={e => setValue(f.field_key, e.target.value)}
                disabled={readOnly}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 disabled:bg-slate-100"
              />
            )}

            {f.field_type === 'long_text' && (
              <textarea
                value={v ?? ''}
                onChange={e => setValue(f.field_key, e.target.value)}
                rows={3}
                disabled={readOnly}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 disabled:bg-slate-100"
              />
            )}

            {f.field_type === 'number' && (
              <input
                type="number"
                value={v ?? ''}
                onChange={e => setValue(f.field_key, e.target.value === '' ? null : Number(e.target.value))}
                disabled={readOnly}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 disabled:bg-slate-100"
              />
            )}

            {f.field_type === 'date' && (
              <input
                type="date"
                value={v ?? ''}
                onChange={e => setValue(f.field_key, e.target.value)}
                disabled={readOnly}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 disabled:bg-slate-100"
              />
            )}

            {f.field_type === 'dropdown' && (
              <select
                value={v ?? ''}
                onChange={e => setValue(f.field_key, e.target.value || null)}
                disabled={readOnly}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 bg-white disabled:bg-slate-100"
              >
                <option value="">— select —</option>
                {(f.dropdown_options || []).map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            )}

            {f.field_type === 'checkbox' && (
              <label className="flex items-center gap-2 cursor-pointer pt-2">
                <input
                  type="checkbox"
                  checked={!!v}
                  onChange={e => setValue(f.field_key, e.target.checked)}
                  disabled={readOnly}
                  className="w-4 h-4"
                />
                <span className="text-sm text-slate-700">Yes</span>
              </label>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Validate that all required HR fields have a value.
 * Returns null if all good, otherwise an error message naming the
 * first missing field.
 */
export function validateHRFields(
  fields: HRFieldDef[],
  values: Record<string, any>,
): string | null {
  for (const f of fields) {
    if (!f.is_required) continue
    const v = values?.[f.field_key]
    const empty = v === undefined || v === null || v === ''
      || (typeof v === 'number' && isNaN(v))
    if (empty) {
      return `Please fill in "${f.label}"`
    }
  }
  return null
}
