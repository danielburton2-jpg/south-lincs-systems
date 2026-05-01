import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'

/**
 * POST /api/create-user
 *
 * Creates an auth user, a profile, plus user_features rows and
 * manager_job_titles rows if applicable.
 *
 * If the auth user is created but the profile insert fails, we roll
 * back the auth user to avoid orphans.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      email,
      password,
      full_name,
      role,
      company_id,
      job_title,
      employee_number,
      employment_start_date,
      holiday_entitlement,
      full_year_entitlement,
      working_days,
      user_features,
      manager_titles,
      actor_id,
      actor_email,
      actor_role,
    } = body

    if (!email || !password || !full_name || !role) {
      return NextResponse.json(
        { error: 'email, password, full_name and role are required' },
        { status: 400 },
      )
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    // 1. Create the auth user
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email: email.trim(),
      password,
      email_confirm: true,
    })
    if (createErr || !created.user) {
      return NextResponse.json(
        { error: createErr?.message || 'Failed to create auth user' },
        { status: 400 },
      )
    }

    // 2. Insert the profile (the on_auth_user_created trigger created
    //    a default profile, so this is an UPDATE not an INSERT).
    const profileFields: any = {
      email: email.trim(),
      full_name,
      role,
      company_id: company_id || null,
      job_title: job_title || null,
      employee_number: employee_number || null,
      employment_start_date: employment_start_date || null,
      holiday_entitlement: holiday_entitlement ?? null,
      full_year_entitlement: full_year_entitlement ?? null,
      working_days: working_days || undefined, // keeps DB default if not provided
    }
    // Strip undefined so DB defaults apply
    Object.keys(profileFields).forEach((k) => {
      if (profileFields[k] === undefined) delete profileFields[k]
    })

    const { error: profileErr } = await supabase
      .from('profiles')
      .update(profileFields)
      .eq('id', created.user.id)

    if (profileErr) {
      // Roll back the auth user — don't leave orphans
      await supabase.auth.admin.deleteUser(created.user.id).catch(() => {})
      return NextResponse.json({ error: profileErr.message }, { status: 400 })
    }

    // 3. Insert user_features rows
    if (Array.isArray(user_features) && user_features.length > 0) {
      const rows = user_features.map((f: any) => ({
        user_id: created.user.id,
        feature_id: f.feature_id,
        is_enabled: !!f.is_enabled,
        can_view: f.can_view ?? !!f.is_enabled,
        can_view_all: f.can_view_all ?? false,
        can_edit: f.can_edit ?? !!f.is_enabled,
        can_view_reports: f.can_view_reports ?? false,
      }))
      const { error: ufErr } = await supabase.from('user_features').insert(rows)
      if (ufErr) console.error('user_features insert failed:', ufErr)
    }

    // 4. Insert manager_job_titles rows
    if (Array.isArray(manager_titles) && manager_titles.length > 0) {
      const rows = manager_titles.map((title: string) => ({
        manager_id: created.user.id,
        job_title: title,
      }))
      const { error: mtErr } = await supabase.from('manager_job_titles').insert(rows)
      if (mtErr) console.error('manager_job_titles insert failed:', mtErr)
    }

    await logAudit({
      user_id: actor_id,
      user_email: actor_email,
      user_role: actor_role,
      action: 'CREATE_USER',
      entity: 'profile',
      entity_id: created.user.id,
      details: { email, full_name, role, company_id },
      ip_address: request.headers.get('x-forwarded-for') || undefined,
    })

    return NextResponse.json({ success: true, user_id: created.user.id })
  } catch (err: any) {
    console.error('create-user error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
