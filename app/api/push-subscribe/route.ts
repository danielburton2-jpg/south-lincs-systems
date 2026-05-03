/**
 * POST /api/push-subscribe
 *
 * Body: { endpoint, keys: { p256dh, auth } }
 *
 * Stores the subscription against the authenticated user. Idempotent:
 * if a subscription with the same endpoint exists, it's reactivated.
 *
 * Drivers/mechanics only — admins/managers don't get web push.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'

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

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, company_id')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'No profile' }, { status: 401 })
  if (!profile.company_id) return NextResponse.json({ error: 'No company' }, { status: 400 })

  // Web push is now available to ALL roles (drivers, mechanics, managers,
  // admins). Originally restricted to drivers only — opened up in zip 4
  // of messaging because admins/managers also need lock-screen pings for
  // new messages.

  const body = await req.json().catch(() => null)
  if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) {
    return NextResponse.json({ error: 'Missing subscription fields' }, { status: 400 })
  }

  const userAgent = req.headers.get('user-agent') || ''

  // Use the service role to upsert — RLS doesn't allow user inserts on
  // this table for safety (so an attacker can't shove an arbitrary
  // endpoint into someone else's row).
  const svc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  // Upsert by endpoint — same browser re-subscribing should reactivate
  // the existing row, not create a duplicate.
  const { error: upsertErr } = await svc
    .from('push_subscriptions')
    .upsert(
      {
        user_id: profile.id,
        company_id: profile.company_id,
        endpoint: body.endpoint,
        p256dh_key: body.keys.p256dh,
        auth_key: body.keys.auth,
        user_agent: userAgent.slice(0, 500),
        is_active: true,
      },
      { onConflict: 'endpoint' },
    )

  if (upsertErr) {
    console.error('[push-subscribe] upsert failed:', upsertErr.message)
    return NextResponse.json({ error: 'Could not save subscription' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
