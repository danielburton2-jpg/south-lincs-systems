import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      user_id,
      full_name,
      email,
      role,
      job_title,
      employee_number,
      employment_start_date,
      holiday_entitlement,
      full_year_entitlement,
      working_days,
      user_features,
      manager_titles,
      // Action-only flags
      toggle_freeze,
      delete: shouldDelete,
      actor_id,
      actor_email,
      actor_role,
      company_name,
    } = body

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // ─────────────────────────────────────────────────────────
    // Action: toggle freeze
    // ─────────────────────────────────────────────────────────
    if (toggle_freeze !== undefined) {
      const { error } = await supabase
        .from('profiles')
        .update({ is_frozen: toggle_freeze })
        .eq('id', user_id)

      if (error) return NextResponse.json({ error: error.message }, { status: 400 })

      await logAudit({
        user_id: actor_id,
        user_email: actor_email,
        user_role: actor_role,
        action: toggle_freeze ? 'FREEZE_USER' : 'UNFREEZE_USER',
        entity: 'profile',
        entity_id: user_id,
        details: { company_name },
        ip_address: request.headers.get('x-forwarded-for') || undefined,
      })

      return NextResponse.json({ success: true })
    }

    // ─────────────────────────────────────────────────────────
    // Action: soft delete
    // ─────────────────────────────────────────────────────────
    if (shouldDelete) {
      const { error } = await supabase
        .from('profiles')
        .update({ is_deleted: true })
        .eq('id', user_id)

      if (error) return NextResponse.json({ error: error.message }, { status: 400 })

      await logAudit({
        user_id: actor_id,
        user_email: actor_email,
        user_role: actor_role,
        action: 'DELETE_USER',
        entity: 'profile',
        entity_id: user_id,
        details: { company_name },
        ip_address: request.headers.get('x-forwarded-for') || undefined,
      })

      return NextResponse.json({ success: true })
    }

    // ─────────────────────────────────────────────────────────
    // Default action: full edit
    // ─────────────────────────────────────────────────────────

    // Build the update object dynamically so we don't overwrite fields that
    // weren't sent (e.g. when called from a partial-edit context).
    const updatePayload: any = {}
    if (full_name !== undefined) updatePayload.full_name = full_name
    if (email !== undefined) updatePayload.email = email
    if (role !== undefined) updatePayload.role = role
    if (job_title !== undefined) updatePayload.job_title = job_title || null
    if (employee_number !== undefined) updatePayload.employee_number = employee_number || null
    if (employment_start_date !== undefined) updatePayload.employment_start_date = employment_start_date || null
    if (holiday_entitlement !== undefined) updatePayload.holiday_entitlement = holiday_entitlement ?? null
    if (full_year_entitlement !== undefined) updatePayload.full_year_entitlement = full_year_entitlement ?? null
    if (working_days !== undefined) updatePayload.working_days = working_days || null

    if (Object.keys(updatePayload).length > 0) {
      const { error } = await supabase
        .from('profiles')
        .update(updatePayload)
        .eq('id', user_id)

      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    }

    // Update user features (upsert each row)
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

    // Replace manager titles
    if (manager_titles !== undefined) {
      await supabase.from('manager_job_titles').delete().eq('manager_id', user_id)
      if (manager_titles.length > 0) {
        await supabase.from('manager_job_titles').insert(
          manager_titles.map((title: string) => ({
            manager_id: user_id,
            job_title: title,
          }))
        )
      }
    }

    await logAudit({
      user_id: actor_id,
      user_email: actor_email,
      user_role: actor_role,
      action: 'EDIT_COMPANY_USER',
      entity: 'profile',
      entity_id: user_id,
      details: {
        full_name,
        email,
        role,
        job_title,
        employee_number,
        company_name,
        holiday_entitlement,
        full_year_entitlement,
        employment_start_date,
      },
      ip_address: request.headers.get('x-forwarded-for') || undefined,
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('Update user error:', err)
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 })
  }
}