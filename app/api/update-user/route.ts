import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'

export async function POST(request: Request) {
  try {
    const {
      user_id,
      full_name,
      email,
      role,
      job_title,
      employment_start_date,
      holiday_entitlement,
      working_days,
      user_features,
      manager_titles,
      actor_id,
      actor_email,
      actor_role,
      company_name,
    } = await request.json()

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { error } = await supabase
      .from('profiles')
      .update({
        full_name,
        email,
        role,
        job_title: job_title || null,
        employment_start_date: employment_start_date || null,
        holiday_entitlement: holiday_entitlement ?? null,
        working_days: working_days || null,
      })
      .eq('id', user_id)

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    if (user_features && user_features.length > 0) {
      for (const f of user_features) {
        const { data: existing } = await supabase
          .from('user_features')
          .select('id')
          .eq('user_id', user_id)
          .eq('feature_id', f.feature_id)
          .single()

        if (existing) {
          await supabase
            .from('user_features')
            .update({ is_enabled: f.is_enabled })
            .eq('user_id', user_id)
            .eq('feature_id', f.feature_id)
        } else {
          await supabase
            .from('user_features')
            .insert({ user_id, feature_id: f.feature_id, is_enabled: f.is_enabled })
        }
      }
    }

    await supabase.from('manager_job_titles').delete().eq('manager_id', user_id)
    if (manager_titles && manager_titles.length > 0) {
      await supabase.from('manager_job_titles').insert(
        manager_titles.map((title: string) => ({
          manager_id: user_id,
          job_title: title,
        }))
      )
    }

    await logAudit({
      user_id: actor_id,
      user_email: actor_email,
      user_role: actor_role,
      action: 'EDIT_COMPANY_USER',
      entity: 'profile',
      entity_id: user_id,
      details: { full_name, email, role, job_title, company_name, holiday_entitlement, employment_start_date },
      ip_address: request.headers.get('x-forwarded-for') || undefined,
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('Update user error:', err)
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 })
  }
}