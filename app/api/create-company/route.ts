import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'
import { calculateEndDate } from '@/lib/subscription'

/**
 * POST /api/create-company
 *
 * Creates a company. The subscription length text is parsed server-side
 * (same parser as the client uses) and the resulting end_date is stored.
 * If `enabled_feature_ids` is non-empty, also inserts company_features rows.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
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
      vehicle_types,
    } = body

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }

    // Compute end_date from start + length. If either is missing or
    // the length is invalid, end_date stays null.
    const computedEnd = calculateEndDate(start_date, subscription_length)

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const { data, error } = await supabase
      .from('companies')
      .insert({
        name: name.trim(),
        is_active: is_active !== false,
        start_date: start_date || null,
        subscription_length: subscription_length?.trim() || null,
        end_date: computedEnd,
        override_end_date: override_end_date || null,
        contact_name: contact_name || null,
        contact_phone: contact_phone || null,
        contact_email: contact_email || null,
        notes: notes || null,
        vehicle_types: Array.isArray(vehicle_types) ? vehicle_types : null,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    if (Array.isArray(enabled_feature_ids) && enabled_feature_ids.length > 0) {
      const rows = enabled_feature_ids.map((fid: string) => ({
        company_id: data.id,
        feature_id: fid,
        is_enabled: true,
      }))
      const { error: cfErr } = await supabase.from('company_features').insert(rows)
      if (cfErr) console.error('company_features insert failed:', cfErr)
    }

    await logAudit({
      action: 'CREATE_COMPANY',
      entity: 'company',
      entity_id: data.id,
      details: {
        name: data.name,
        subscription_length: data.subscription_length,
        end_date: data.end_date,
        feature_count: Array.isArray(enabled_feature_ids) ? enabled_feature_ids.length : 0,
      },
      ip_address: request.headers.get('x-forwarded-for') || undefined,
    })

    return NextResponse.json({ company: data })
  } catch (err: any) {
    console.error('create-company error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
