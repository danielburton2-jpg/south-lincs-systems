/**
 * POST /api/phone-directory/verify-code
 *
 * Body: { code }
 *
 * Behaviour:
 *   - Looks up the user's stored hash. 404 if no code set yet.
 *   - Compares (constant-time scrypt). On match: resets failed_attempts,
 *     stamps last_unlocked_at, issues:
 *       • For drivers (role !== 'admin'): the long-lived `pd_unlock`
 *         cookie (8 hours) used by the driver phone-directory page.
 *       • For admins: the short-lived `pd_admin` cookie (5 minutes)
 *         used to gate admin write APIs. Admin pages always show
 *         the PIN form on mount; this cookie just protects the API
 *         beneath the form.
 *   - On miss: increments failed_attempts. Alert at every 15th miss.
 *     Per-failure response delay (linear up to 10s).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import {
  verifyCode,
  signUnlockToken,
  signAdminToken,
  throttleMsForFailures,
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

const ALERT_THRESHOLD = 15
const CODE_RE = /^\d{6}$/

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

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

  const { data: row } = await svc
    .from('phone_directory_codes')
    .select('user_id, company_id, code_hash, failed_attempts')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!row) {
    return NextResponse.json({ error: 'No code set yet' }, { status: 404 })
  }

  const { data: profile } = await svc
    .from('profiles')
    .select('id, full_name, role')
    .eq('id', user.id)
    .single()

  const throttle = throttleMsForFailures(row.failed_attempts)
  if (throttle > 0) await sleep(throttle)

  const ok = verifyCode(code, row.code_hash)
  if (ok) {
    await svc
      .from('phone_directory_codes')
      .update({
        failed_attempts: 0,
        last_unlocked_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)

    await logAudit({
      action: profile?.role === 'admin'
        ? 'PHONE_DIRECTORY_ADMIN_UNLOCKED'
        : 'PHONE_DIRECTORY_UNLOCKED',
      entity: 'phone_directory_codes',
      details: { user_id: user.id, role: profile?.role || null },
      ip_address: req.headers.get('x-forwarded-for') || undefined,
    })

    const res = NextResponse.json({ ok: true })

    // Always issue the driver unlock cookie too — admins MAY also use
    // the employee surface (e.g. for testing) and shouldn't have to
    // re-enter just because they happen to also be admin. The admin
    // cookie below is additive.
    const driverToken = signUnlockToken(user.id)
    res.cookies.set({
      name: UNLOCK_COOKIE_NAME,
      value: driverToken.value,
      ...cookieOptions(driverToken.maxAgeSeconds),
    })

    // For admins, also issue the short-lived admin cookie that gates
    // admin write APIs. The admin pages always re-prompt on mount;
    // this cookie just protects the API beneath that prompt.
    if (profile?.role === 'admin') {
      const adminToken = signAdminToken(user.id)
      res.cookies.set({
        name: ADMIN_COOKIE_NAME,
        value: adminToken.value,
        ...cookieOptions(adminToken.maxAgeSeconds),
      })
    }

    return res
  }

  // Wrong code
  const newCount = (row.failed_attempts || 0) + 1
  await svc
    .from('phone_directory_codes')
    .update({
      failed_attempts: newCount,
      last_failed_at: new Date().toISOString(),
    })
    .eq('user_id', user.id)

  await logAudit({
    action: 'PHONE_DIRECTORY_BAD_CODE',
    entity: 'phone_directory_codes',
    details: { user_id: user.id, failed_attempts: newCount, role: profile?.role || null },
    ip_address: req.headers.get('x-forwarded-for') || undefined,
  })

  if (newCount > 0 && newCount % ALERT_THRESHOLD === 0) {
    await svc.from('phone_directory_alerts').insert({
      company_id: row.company_id,
      user_id: user.id,
      user_name: profile?.full_name || null,
      failed_count: newCount,
    })
  }

  return NextResponse.json({ error: 'Wrong code' }, { status: 401 })
}
