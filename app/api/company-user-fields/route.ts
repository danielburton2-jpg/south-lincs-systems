import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'

/**
 * /api/company-user-fields
 *
 * Manage per-company HR field definitions.
 *
 * GET  ?company_id=<uuid>            → list field definitions
 * POST { action: 'create', company_id, label, field_type, dropdown_options?, is_required? }
 * POST { action: 'update', field_id, label?, dropdown_options?, is_required?, display_order? }
 * POST { action: 'delete', field_id }
 *
 * field_type cannot be changed after creation (would orphan existing
 * values stored against the field_key on profiles.extra_fields).
 *
 * Authorisation note: in this iteration we don't check actor role
 * server-side — the page itself is gated to superusers via the layout.
 * Add a role check here if this API ever needs to be opened up.
 */

const supabaseAdmin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

/**
 * Build a stable, URL-safe field key from a label.
 * If a key collides with an existing one, append _2, _3, etc.
 */
function makeFieldKey(label: string, existingKeys: string[]): string {
  let base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50)
  if (!base) base = 'field'
  if (!existingKeys.includes(base)) return base
  let n = 2
  while (existingKeys.includes(`${base}_${n}`)) n++
  return `${base}_${n}`
}

const VALID_TYPES = ['text', 'long_text', 'number', 'date', 'dropdown', 'checkbox']
const REQUIRED_CAPABLE = ['date', 'number', 'dropdown']

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const company_id = searchParams.get('company_id')
    if (!company_id) {
      return NextResponse.json({ error: 'company_id required' }, { status: 400 })
    }
    const supabase = supabaseAdmin()
    const { data, error } = await supabase
      .from('company_user_field_definitions')
      .select('*')
      .eq('company_id', company_id)
      .order('display_order', { ascending: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ fields: data || [] })
  } catch (err: any) {
    console.error('company-user-fields GET error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { action, actor_id, actor_email } = body
    const supabase = supabaseAdmin()

    if (action === 'create') {
      const { company_id, label, field_type, dropdown_options, is_required } = body
      if (!company_id || !label || !field_type) {
        return NextResponse.json(
          { error: 'company_id, label and field_type are required' },
          { status: 400 },
        )
      }
      if (!VALID_TYPES.includes(field_type)) {
        return NextResponse.json({ error: 'Invalid field_type' }, { status: 400 })
      }

      // Determine field_key (unique per company) and next display_order
      const { data: existing } = await supabase
        .from('company_user_field_definitions')
        .select('field_key, display_order')
        .eq('company_id', company_id)
      const keys = (existing || []).map((r: any) => r.field_key)
      const field_key = makeFieldKey(label, keys)
      const maxOrder = (existing || []).reduce(
        (m: number, r: any) => Math.max(m, r.display_order || 0),
        0,
      )

      const safeRequired = REQUIRED_CAPABLE.includes(field_type) ? !!is_required : false

      const { data: created, error } = await supabase
        .from('company_user_field_definitions')
        .insert({
          company_id,
          field_key,
          label: label.trim(),
          field_type,
          dropdown_options: field_type === 'dropdown' ? (dropdown_options || []) : [],
          is_required: safeRequired,
          display_order: maxOrder + 1,
        })
        .select()
        .single()

      if (error) return NextResponse.json({ error: error.message }, { status: 400 })

      await logAudit({
        user_id: actor_id, user_email: actor_email, user_role: 'superuser',
        action: 'CREATE_HR_FIELD',
        entity: 'company_user_field_definition',
        entity_id: created.id,
        details: { company_id, label, field_type, field_key },
        ip_address: request.headers.get('x-forwarded-for') || undefined,
      })
      return NextResponse.json({ field: created })
    }

    if (action === 'update') {
      const { field_id, label, dropdown_options, is_required, display_order } = body
      if (!field_id) return NextResponse.json({ error: 'field_id required' }, { status: 400 })

      const updatePayload: any = { updated_at: new Date().toISOString() }
      if (label !== undefined) updatePayload.label = String(label).trim()
      if (dropdown_options !== undefined) updatePayload.dropdown_options = dropdown_options
      if (display_order !== undefined) updatePayload.display_order = display_order

      // Required capability depends on type — fetch current type to decide
      if (is_required !== undefined) {
        const { data: cur } = await supabase
          .from('company_user_field_definitions')
          .select('field_type').eq('id', field_id).single()
        const cap = REQUIRED_CAPABLE.includes(cur?.field_type || '')
        updatePayload.is_required = cap ? !!is_required : false
      }

      const { error } = await supabase
        .from('company_user_field_definitions')
        .update(updatePayload)
        .eq('id', field_id)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })

      await logAudit({
        user_id: actor_id, user_email: actor_email, user_role: 'superuser',
        action: 'UPDATE_HR_FIELD',
        entity: 'company_user_field_definition',
        entity_id: field_id,
        details: updatePayload,
        ip_address: request.headers.get('x-forwarded-for') || undefined,
      })
      return NextResponse.json({ success: true })
    }

    if (action === 'delete') {
      const { field_id } = body
      if (!field_id) return NextResponse.json({ error: 'field_id required' }, { status: 400 })

      const { error } = await supabase
        .from('company_user_field_definitions')
        .delete()
        .eq('id', field_id)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })

      await logAudit({
        user_id: actor_id, user_email: actor_email, user_role: 'superuser',
        action: 'DELETE_HR_FIELD',
        entity: 'company_user_field_definition',
        entity_id: field_id,
        ip_address: request.headers.get('x-forwarded-for') || undefined,
      })
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err: any) {
    console.error('company-user-fields POST error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
