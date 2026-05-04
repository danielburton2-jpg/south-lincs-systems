/**
 * POST /api/phone-directory/set-code
 *
 * First-time PIN setup. Body: { code }
 *
 *   - code: string of exactly 6 digits
 *
 * Behaviour:
 *   - Verifies caller is signed in
 *   - Verifies caller's company has the Phone Directory feature enabled
 *   - Verifies caller has access to the feature (admin OR user_features
 *     row enabled)
 *   - Refuses if a code is already set — admin must reset first
 *     (use /api/phone-directory/admin-reset-code)
 *   - Stores hash, sets unlock cookie so the user can immediately
 *     access the directory without re-entering on this same visit
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import {
  hashCode,
  signUnlockToken,
  UNLOCK_COOKIE_NAME,
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
    .select('id, company_id, role, full_name')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) {
    return NextResponse.json({ error: 'No company' }, { status: 400 })
  }

  // Feature gate — same pattern as the existing employee feature checks.
  const featureOk = await checkFeatureAccess(svc, profile)
  if (!featureOk) {
    return NextResponse.json({ error: 'Phone Directory is not enabled for you' }, { status: 403 })
  }

  // Refuse if a code is already set (must go via admin reset)
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
    action: 'PHONE_DIRECTORY_CODE_SET',
    entity: 'phone_directory_codes',
    details: { user_id: user.id },
    ip_address: req.headers.get('x-forwarded-for') || undefined,
  })

  // Issue unlock token — they're already in, no need to re-enter.
  const token = signUnlockToken(user.id)
  const res = NextResponse.json({ ok: true })
  res.cookies.set({
    name: UNLOCK_COOKIE_NAME,
    value: token.value,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: token.maxAgeSeconds,
  })
  return res
}

// Helper: returns true if profile.role==='admin' OR a user_features row
// for the phone_directory feature has is_enabled=true.
async function checkFeatureAccess(
  svc: ReturnType<typeof adminClient>,
  profile: { id: string; company_id: string; role: string },
): Promise<boolean> {
  if (profile.role === 'admin') return true

  const { data: feature } = await svc
    .from('features').select('id').eq('slug', 'phone_directory').single()
  if (!feature) return false

  // Company must have it on
  const { data: cf } = await svc
    .from('company_features')
    .select('is_enabled')
    .eq('company_id', profile.company_id)
    .eq('feature_id', feature.id)
    .maybeSingle()
  if (!cf?.is_enabled) return false

  // User must have it on
  const { data: uf } = await svc
    .from('user_features')
    .select('is_enabled')
    .eq('user_id', profile.id)
    .eq('feature_id', feature.id)
    .maybeSingle()
  return !!uf?.is_enabled
}
