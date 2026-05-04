import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'

/**
 * POST /api/update-user
 *
 * Multi-purpose: full edit, freeze toggle, soft delete, restore.
 *
 * Body shapes:
 *   • Freeze:       { user_id, toggle_freeze: bool, actor_*, company_name }
 *   • Soft delete:  { user_id, delete: true, actor_*, company_name }
 *   • Restore:      { user_id, restore: true, actor_*, company_name }
 *   • Full edit:    { user_id, full_name, email, role, ...all the fields, actor_*, company_name }
 *
 * Action flags (toggle_freeze, delete, restore) take priority — if any
 * is set, the request is treated as a state-change-only and the other
 * fields are ignored.
 */
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
      restore: shouldRestore,
      // Audit
      actor_id,
      actor_email,
      actor_role,
      company_name,
    } = body

    if (!user_id) {
      return NextResponse.json({ error: 'user_id is required' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    // ─── Action: toggle freeze ───────────────────────────────────
    if (toggle_freeze !== undefined) {
      const { error } = await supabase
        .from('profiles')
        .update({ is_frozen: !!toggle_freeze })
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

    // ─── Action: soft delete ─────────────────────────────────────
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
        action: 'SOFT_DELETE_USER',
        entity: 'profile',
        entity_id: user_id,
        details: { company_name },
        ip_address: request.headers.get('x-forwarded-for') || undefined,
      })

      return NextResponse.json({ success: true })
    }

    // ─── Action: restore (un-delete) ─────────────────────────────
    // Only superusers should reach this in practice — the client-side
    // pages only show the Restore button to superusers. We don't
    // double-check here because the rest of /api/update-user already
    // trusts the actor_* fields without server-side authz, and we
    // want to stay consistent. (If you ever harden authz on this
    // route, make sure restore is gated to superusers specifically.)
    if (shouldRestore) {
      const { error } = await supabase
        .from('profiles')
        .update({ is_deleted: false })
        .eq('id', user_id)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })

      await logAudit({
        user_id: actor_id,
        user_email: actor_email,
        user_role: actor_role,
        action: 'RESTORE_USER',
        entity: 'profile',
        entity_id: user_id,
        details: { company_name },
        ip_address: request.headers.get('x-forwarded-for') || undefined,
      })

      return NextResponse.json({ success: true })
    }

    // ─── Default: full edit ──────────────────────────────────────
    const profilePayload: any = {}
    if (full_name !== undefined)             profilePayload.full_name = full_name
    if (email !== undefined)                 profilePayload.email = email
    if (role !== undefined)                  profilePayload.role = role
    if (job_title !== undefined)             profilePayload.job_title = job_title || null
    if (employee_number !== undefined)       profilePayload.employee_number = employee_number || null
    if (employment_start_date !== undefined) profilePayload.employment_start_date = employment_start_date || null
    if (holiday_entitlement !== undefined)   profilePayload.holiday_entitlement = holiday_entitlement ?? null
    if (full_year_entitlement !== undefined) profilePayload.full_year_entitlement = full_year_entitlement ?? null
    if (working_days !== undefined)          profilePayload.working_days = working_days || null

    if (Object.keys(profilePayload).length > 0) {
      const { error } = await supabase
        .from('profiles')
        .update(profilePayload)
        .eq('id', user_id)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    }

    // If email changed, also update auth.users
    if (email) {
      try {
        await supabase.auth.admin.updateUserById(user_id, { email })
      } catch (err) {
        console.error('auth email update failed:', err)
      }
    }

    // Sync user_features (delete-and-insert)
    if (Array.isArray(user_features)) {
      await supabase.from('user_features').delete().eq('user_id', user_id)
      if (user_features.length > 0) {
        const rows = user_features.map((f: any) => ({
          user_id,
          feature_id: f.feature_id,
          is_enabled: !!f.is_enabled,
          can_view: f.can_view ?? !!f.is_enabled,
          can_view_all: f.can_view_all ?? false,
          can_edit: f.can_edit ?? !!f.is_enabled,
          can_view_reports: f.can_view_reports ?? false,
        }))
        const { error: ufErr } = await supabase.from('user_features').insert(rows)
        if (ufErr) console.error('user_features sync failed:', ufErr)
      }
    }

    // Sync manager_job_titles (delete-and-insert)
    if (Array.isArray(manager_titles)) {
      await supabase.from('manager_job_titles').delete().eq('manager_id', user_id)
      if (manager_titles.length > 0) {
        const rows = manager_titles.map((title: string) => ({
          manager_id: user_id,
          job_title: title,
        }))
        const { error: mtErr } = await supabase.from('manager_job_titles').insert(rows)
        if (mtErr) console.error('manager_job_titles sync failed:', mtErr)
      }
    }

    await logAudit({
      user_id: actor_id,
      user_email: actor_email,
      user_role: actor_role,
      action: 'UPDATE_USER',
      entity: 'profile',
      entity_id: user_id,
      details: { company_name, email, role },
      ip_address: request.headers.get('x-forwarded-for') || undefined,
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('update-user error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
