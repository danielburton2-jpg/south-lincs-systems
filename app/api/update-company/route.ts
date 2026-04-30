import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'
import { calculateEndDate } from '@/lib/subscription'

/**
 * POST /api/update-company
 *
 * Body: { id, ...basic fields, subscription_length, enabled_feature_ids }
 *
 * If start_date OR subscription_length changes, end_date is recomputed.
 * Features sync is delete-and-insert.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      id,
      name,
      is_active,
      start_date,
      subscription_length,
      override_end_date,
      contact_name,
      contact_phone,
      contact_email,
      notes,
      enabled_feature_ids,
    } = body

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    // Build the update payload from whatever fields were sent
    const updatePayload: any = {}
    if (name !== undefined)              updatePayload.name              = String(name).trim()
    if (is_active !== undefined)         updatePayload.is_active         = !!is_active
    if (start_date !== undefined)        updatePayload.start_date        = start_date || null
    if (subscription_length !== undefined) {
      updatePayload.subscription_length = subscription_length?.trim() || null
    }
    if (override_end_date !== undefined) updatePayload.override_end_date = override_end_date || null
    if (contact_name !== undefined)      updatePayload.contact_name      = contact_name || null
    if (contact_phone !== undefined)     updatePayload.contact_phone     = contact_phone || null
    if (contact_email !== undefined)     updatePayload.contact_email     = contact_email || null
    if (notes !== undefined)             updatePayload.notes             = notes || null

    // Recompute end_date if either of its inputs were sent.
    // To do that we need the current values from the DB for whichever
    // input wasn't sent.
    if (start_date !== undefined || subscription_length !== undefined) {
      const { data: existing } = await supabase
        .from('companies')
        .select('start_date, subscription_length')
        .eq('id', id)
        .single()

      const effectiveStart = start_date !== undefined
        ? (start_date || null)
        : (existing?.start_date || null)
      const effectiveLength = subscription_length !== undefined
        ? (subscription_length || null)
        : (existing?.subscription_length || null)

      updatePayload.end_date = calculateEndDate(effectiveStart, effectiveLength)
    }

    if (Object.keys(updatePayload).length > 0) {
      const { error: upErr } = await supabase
        .from('companies')
        .update(updatePayload)
        .eq('id', id)
      if (upErr) {
        return NextResponse.json({ error: upErr.message }, { status: 400 })
      }
    }

    // Sync features (only if provided)
    if (Array.isArray(enabled_feature_ids)) {
      await supabase.from('company_features').delete().eq('company_id', id)
      if (enabled_feature_ids.length > 0) {
        const rows = enabled_feature_ids.map((fid: string) => ({
          company_id: id,
          feature_id: fid,
          is_enabled: true,
        }))
        const { error: insErr } = await supabase.from('company_features').insert(rows)
        if (insErr) console.error('company_features sync failed:', insErr)
      }
    }

    await logAudit({
      action: 'UPDATE_COMPANY',
      entity: 'company',
      entity_id: id,
      details: { fields: Object.keys(updatePayload), features_synced: Array.isArray(enabled_feature_ids) },
      ip_address: request.headers.get('x-forwarded-for') || undefined,
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('update-company error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
