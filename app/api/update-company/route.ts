import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'

export async function POST(request: Request) {
  try {
    const {
      company_id,
      name,
      end_date,
      override_end_date,
      notes,
      features,
      is_active,
      toggle_only,
      actor_id,
      actor_email,
      actor_role,
    } = await request.json()

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    if (toggle_only) {
      const { error } = await supabase
        .from('companies')
        .update({ is_active })
        .eq('id', company_id)

      if (error) return NextResponse.json({ error: error.message }, { status: 400 })

      await logAudit({
        user_id: actor_id,
        user_email: actor_email,
        user_role: actor_role,
        action: is_active ? 'ACTIVATE_COMPANY' : 'DEACTIVATE_COMPANY',
        entity: 'company',
        entity_id: company_id,
        ip_address: request.headers.get('x-forwarded-for') || undefined,
      })

      return NextResponse.json({ success: true })
    }

    const { error } = await supabase
      .from('companies')
      .update({ name, end_date, override_end_date, notes })
      .eq('id', company_id)

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    if (features && features.length > 0) {
      for (const f of features) {
        const { data: existing } = await supabase
          .from('company_features')
          .select('id')
          .eq('company_id', company_id)
          .eq('feature_id', f.feature_id)
          .single()

        if (existing) {
          await supabase
            .from('company_features')
            .update({
              is_enabled: f.is_enabled,
              enabled_at: f.is_enabled ? new Date().toISOString() : null,
              enabled_by: f.is_enabled ? actor_id : null,
            })
            .eq('company_id', company_id)
            .eq('feature_id', f.feature_id)
        } else {
          await supabase
            .from('company_features')
            .insert({
              company_id,
              feature_id: f.feature_id,
              is_enabled: f.is_enabled,
              enabled_at: f.is_enabled ? new Date().toISOString() : null,
              enabled_by: f.is_enabled ? actor_id : null,
            })
        }
      }
    }

    await logAudit({
      user_id: actor_id,
      user_email: actor_email,
      user_role: actor_role,
      action: 'EDIT_COMPANY',
      entity: 'company',
      entity_id: company_id,
      details: { name, end_date, override_end_date },
      ip_address: request.headers.get('x-forwarded-for') || undefined,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}