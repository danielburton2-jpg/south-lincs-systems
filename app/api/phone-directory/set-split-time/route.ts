/**
 * POST /api/phone-directory/set-split-time
 *
 * Body: { am_pm_split_time }   // "HH:MM"
 *
 * Sets companies.am_pm_split_time. Admin only AND requires pd_admin
 * cookie.
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

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/

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
  const { data: profile } = await svc
    .from('profiles').select('id, role, company_id').eq('id', user.id).single()
  if (!profile?.company_id) return NextResponse.json({ error: 'No company' }, { status: 400 })
  if (profile.role !== 'admin') return NextResponse.json({ error: 'Admins only' }, { status: 403 })

  const adminToken = cookieStore.get(ADMIN_COOKIE_NAME)?.value
  if (!verifyAdminToken(adminToken, profile.id)) {
    return NextResponse.json({ error: 'Admin PIN required', need_pin: true }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const am_pm_split_time: string = body?.am_pm_split_time || ''
  if (!HHMM_RE.test(am_pm_split_time)) {
    return NextResponse.json({ error: 'Time must be HH:MM (24-hour)' }, { status: 400 })
  }

  const { error } = await svc
    .from('companies')
    .update({ am_pm_split_time })
    .eq('id', profile.company_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logAudit({
    action: 'ON_CALL_SPLIT_TIME_CHANGED',
    entity: 'company',
    details: { company_id: profile.company_id, am_pm_split_time },
    ip_address: req.headers.get('x-forwarded-for') || undefined,
  })

  return NextResponse.json({ ok: true, am_pm_split_time })
}
