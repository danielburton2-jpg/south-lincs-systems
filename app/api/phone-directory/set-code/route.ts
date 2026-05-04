/**
 * POST /api/phone-directory/set-code
 *
 * First-time PIN setup. Body: { code }
 *
 * Behaviour:
 *   - Verifies caller is signed in
 *   - Verifies caller's company has Phone Directory enabled
 *   - Verifies caller has access (admin OR user_features enabled)
 *   - Refuses if a code is already set — admin must reset first
 *   - Stores hash, sets cookies (driver + admin if admin) so the
 *     user can immediately access without re-entering
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import {
  hashCode,
  signUnlockToken,
  signAdminToken,
  UNLOCK_COOKIE_NAME,
  ADMIN_COOKIE_NAME,
  cookieOptions,
} from '@/lib/phoneCodeAuth'
import { logAudit } from '@/lib/audit'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

const CODE_RE = /^\d{6}$/

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

  const body = await req.json().catch(() => null)
  const code: string = body?.code || ''
  if (!CODE_RE.test(code)) {
    return NextResponse.json({ error: 'Code must be exactly 6 digits' }, { status: 400 })
  }

  const svc = adminClient()
  const { data: profile } = await svc
    .from('profiles')
    .select('id, email, company_id, role, full_name')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) {
    return NextResponse.json({ error: 'No company' }, { status: 400 })
  }

  const featureOk = await checkFeatureAccess(svc, profile)
  if (!featureOk) {
    return NextResponse.json({ error: 'Phone Directory is not enabled for you' }, { status: 403 })
  }

  const { data: existing } = await svc
    .from('phone_directory_codes')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (existing) {
    return NextResponse.json({
      error: 'Code already set. Ask an admin to reset it if you have forgotten it.',
    }, { status: 409 })
  }

  const codeHash = hashCode(code)
  const { error: insErr } = await svc
    .from('phone_directory_codes')
    .insert({
      user_id: user.id,
      company_id: profile.company_id,
      code_hash: codeHash,
      last_unlocked_at: new Date().toISOString(),
    })
  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 400 })
  }

  await logAudit({
    user_id: profile.id,
    user_email: profile.email,
    user_role: profile.role,
    action: 'PHONE_DIRECTORY_CODE_SET',
    entity: 'phone_directory_codes',
    details: { user_id: user.id, role: profile.role },
    ip_address: req.headers.get('x-forwarded-for') || undefined,
  })

  // Same cookie logic as verify-code: always issue driver cookie;
  // additionally issue admin cookie if admin.
  const res = NextResponse.json({ ok: true })
  const driverToken = signUnlockToken(user.id)
  res.cookies.set({
    name: UNLOCK_COOKIE_NAME,
    value: driverToken.value,
    ...cookieOptions(driverToken.maxAgeSeconds),
  })
  if (profile.role === 'admin') {
    const adminToken = signAdminToken(user.id)
    res.cookies.set({
      name: ADMIN_COOKIE_NAME,
      value: adminToken.value,
      ...cookieOptions(adminToken.maxAgeSeconds),
    })
  }
  return res
}

async function checkFeatureAccess(
  svc: ReturnType<typeof adminClient>,
  profile: { id: string; company_id: string; role: string },
): Promise<boolean> {
  if (profile.role === 'admin') return true
  const { data: feature } = await svc
    .from('features').select('id').eq('slug', 'phone_directory').single()
  if (!feature) return false
  const { data: cf } = await svc
    .from('company_features')
    .select('is_enabled')
    .eq('company_id', profile.company_id)
    .eq('feature_id', feature.id)
    .maybeSingle()
  if (!cf?.is_enabled) return false
  const { data: uf } = await svc
    .from('user_features')
    .select('is_enabled')
    .eq('user_id', profile.id)
    .eq('feature_id', feature.id)
    .maybeSingle()
  return !!uf?.is_enabled
}
