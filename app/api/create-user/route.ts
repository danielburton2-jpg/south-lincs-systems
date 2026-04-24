import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'

export async function POST(request: Request) {
  try {
    const {
      email,
      password,
      full_name,
      role,
      company_id,
      job_title,
      employment_start_date,
      holiday_entitlement,
      user_features,
      manager_titles,
      actor_id,
      actor_email,
      actor_role,
    } = await request.json()

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (error || !data.user) {
      await logAudit({
        user_id: actor_id,
        user_email: actor_email,
        user_role: actor_role,
        action: 'CREATE_USER_FAILED',
        entity: 'profile',
        details: { email, role, error: error?.message },
        ip_address: request.headers.get('x-forwarded-for') || undefined,
      })
      return NextResponse.json({ error: error?.message }, { status: 400 })
    }

    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: data.user.id,
        full_name,
        email,
        role,
        company_id: company_id || null,
        job_title: job_title || null,
        employment_start_date: employment_start_date || null,
        holiday_entitlement: holiday_entitlement ?? null,
      })

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 400 })
    }

    if (user_features && user_features.length > 0) {
      await supabase.from('user_features').insert(
        user_features.map((f: any) => ({
          user_id: data.user.id,
          feature_id: f.feature_id,
          is_enabled: f.is_enabled,
        }))
      )
    }

    if (manager_titles && manager_titles.length > 0) {
      await supabase.from('manager_job_titles').insert(
        manager_titles.map((title: string) => ({
          manager_id: data.user.id,
          job_title: title,
        }))
      )
    }

    await logAudit({
      user_id: actor_id,
      user_email: actor_email,
      user_role: actor_role,
      action: 'CREATE_USER',
      entity: 'profile',
      entity_id: data.user.id,
      details: { email, role, full_name, job_title, company_id, holiday_entitlement, employment_start_date },
      ip_address: request.headers.get('x-forwarded-for') || undefined,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}