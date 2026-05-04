/**
 * POST /api/phone-directory/verify-code
 *
 * Body: { code }
 *
 * Behaviour:
 *   - Looks up the user's stored hash. 404 if no code set yet.
 *   - Compares (constant-time scrypt). On match: resets failed_attempts,
 *     stamps last_unlocked_at, sets the unlock cookie, returns ok.
 *   - On miss: increments failed_attempts. If we just crossed 15
 *     (mod 15 — every 15 in a row), insert a phone_directory_alerts
 *     row so admin sees the banner. Always logs to audit.
 *   - Per-failure response delay (linear up to 10s) to slow scripted
 *     brute-force without locking the user out.
 *
 * The alert threshold logic: alert fires at the 15th, 30th, 45th, ...
 * consecutive failure. Counter resets on successful entry. So a real
 * driver who fails 4 times then gets it right won't trigger anything,
 * but a script grinding through PINs trips an alert every 15 attempts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import {
  verifyCode,
  signUnlockToken,
  throttleMsForFailures,
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
    .select('id, full_name')
    .eq('id', user.id)
    .single()

  // Apply throttle delay BEFORE checking, based on the failures we'd
  // be about to see if this attempt is wrong. (We could throttle
  // after, but doing it before means a scripted attacker can't avoid
  // the delay by hammering then bailing on the response.)
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
      action: 'PHONE_DIRECTORY_UNLOCKED',
      entity: 'phone_directory_codes',
      details: { user_id: user.id },
      ip_address: req.headers.get('x-forwarded-for') || undefined,
    })

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

  // Wrong code — increment, log, possibly raise alert
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
    details: { user_id: user.id, failed_attempts: newCount },
    ip_address: req.headers.get('x-forwarded-for') || undefined,
  })

  // Alert at every Nth multiple of the threshold (15, 30, 45...)
  // so a determined attacker trips the banner repeatedly even if
  // admin keeps dismissing.
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
