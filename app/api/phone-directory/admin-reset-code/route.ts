/**
 * POST /api/phone-directory/admin-reset-code
 *
 * Body: { user_id }
 *
 * Admin clears a user's PIN. Also resets failed_attempts and
 * dismisses any active alerts for that user. Audit logged.
 *
 * Admin only AND requires pd_admin cookie.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { verifyAdminToken, ADMIN_COOKIE_NAME } from '@/lib/phoneCodeAuth'
import { logAudit } from '@/lib/audit'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() { /* no-op */ },
      },
    },
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const svc = adminClient()
  const { data: caller } = await svc
    .from('profiles')
    .select('id, role, company_id')
    .eq('id', user.id)
    .single()
  if (!caller?.company_id) return NextResponse.json({ error: 'No company' }, { status: 400 })
  if (caller.role !== 'admin') return NextResponse.json({ error: 'Admins only' }, { status: 403 })

  // Admin gate
  const adminToken = cookieStore.get(ADMIN_COOKIE_NAME)?.value
  if (!verifyAdminToken(adminToken, caller.id)) {
    return NextResponse.json({ error: 'Admin PIN required', need_pin: true }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const targetUserId: string = body?.user_id || ''
  if (!targetUserId) return NextResponse.json({ error: 'user_id is required' }, { status: 400 })

  const { data: target } = await svc
    .from('profiles')
    .select('id, company_id, full_name')
    .eq('id', targetUserId)
    .single()
  if (!target || target.company_id !== caller.company_id) {
    return NextResponse.json({ error: 'User not found in your company' }, { status: 404 })
  }

  await svc
    .from('phone_directory_codes')
    .delete()
    .eq('user_id', targetUserId)

  await svc
    .from('phone_directory_alerts')
    .update({ dismissed_at: new Date().toISOString(), dismissed_by: caller.id })
    .eq('user_id', targetUserId)
    .is('dismissed_at', null)

  await logAudit({
    action: 'PHONE_DIRECTORY_CODE_RESET_BY_ADMIN',
    entity: 'phone_directory_codes',
    details: {
      target_user_id: targetUserId,
      target_user_name: target.full_name || null,
      reset_by: caller.id,
    },
    ip_address: req.headers.get('x-forwarded-for') || undefined,
  })

  return NextResponse.json({ ok: true })
}
