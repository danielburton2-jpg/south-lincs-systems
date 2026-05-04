/**
 * POST /api/phone-directory/dismiss-alert
 *
 * Body: { alert_id }
 *
 * Marks an alert as dismissed (stamps dismissed_at + dismissed_by).
 * Admin-only, same-company.
 *
 * Doesn't reset the user's failed_attempts counter — admin can do
 * that separately by resetting their PIN if they want a clean slate.
 * Otherwise the next 15 failures will trigger another alert.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
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
    .select('id, email, role, company_id')
    .eq('id', user.id)
    .single()
  if (!caller?.company_id) return NextResponse.json({ error: 'No company' }, { status: 400 })
  if (caller.role !== 'admin') return NextResponse.json({ error: 'Admins only' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const alert_id: string = body?.alert_id || ''
  if (!alert_id) return NextResponse.json({ error: 'alert_id is required' }, { status: 400 })

  // Same-company guard
  const { data: alert } = await svc
    .from('phone_directory_alerts')
    .select('id, company_id')
    .eq('id', alert_id)
    .single()
  if (!alert || alert.company_id !== caller.company_id) {
    return NextResponse.json({ error: 'Alert not found' }, { status: 404 })
  }

  await svc
    .from('phone_directory_alerts')
    .update({
      dismissed_at: new Date().toISOString(),
      dismissed_by: caller.id,
    })
    .eq('id', alert_id)

  await logAudit({
    user_id: caller.id,
    user_email: caller.email,
    user_role: caller.role,
    action: 'PHONE_DIRECTORY_ALERT_DISMISSED',
    entity: 'phone_directory_alert',
    details: { alert_id },
    ip_address: req.headers.get('x-forwarded-for') || undefined,
  })

  return NextResponse.json({ ok: true })
}
