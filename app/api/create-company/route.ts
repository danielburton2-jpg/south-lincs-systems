import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'

export async function POST(request: Request) {
  try {
    const {
      name,
      start_date,
      end_date,
      notes,
      holiday_year_start,
      allow_half_days,
      allow_early_finish,
      features,
      actor_id,
      actor_email,
      actor_role,
    } = await request.json()

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: company, error } = await supabase
      .from('companies')
      .insert({
        name,
        start_date,
        end_date,
        notes: notes || null,
        holiday_year_start: holiday_year_start || null,
        allow_half_days: allow_half_days || false,
        allow_early_finish: allow_early_finish || false,
      })
      .select()
      .single()

    if (error || !company) {
      return NextResponse.json({ error: error?.message }, { status: 400 })
    }

    if (features && features.length > 0) {
      await supabase.from('company_features').insert(features.map((f: any) => ({
        company_id: company.id,
        feature_id: f.feature_id,
        is_enabled: f.is_enabled,
        enabled_at: f.is_enabled ? new Date().toISOString() : null,
        enabled_by: f.is_enabled ? actor_id : null,
      })))
    }

    await logAudit({
      user_id: actor_id,
      user_email: actor_email,
      user_role: actor_role,
      action: 'CREATE_COMPANY',
      entity: 'company',
      entity_id: company.id,
      details: { name, end_date, holiday_year_start, allow_half_days, allow_early_finish },
      ip_address: request.headers.get('x-forwarded-for') || undefined,
    })

    return NextResponse.json({ success: true, company })
  } catch (err) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}