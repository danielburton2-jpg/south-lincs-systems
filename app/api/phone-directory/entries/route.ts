/**
 * GET /api/phone-directory/entries
 *   - Driver: requires valid pd_unlock cookie. On success, the cookie
 *     is RE-ISSUED so its 8-hour life rolls forward with use. (This
 *     also recovers from any one-off browser cookie drop — every
 *     successful read leaves the cookie freshly set.)
 *   - Admin: bypasses the unlock cookie. Reads anyway because admins
 *     manage the directory; their gate is on writes.
 *
 * POST /api/phone-directory/entries
 *   Body: { name, phone_number, notes? }
 *   Admin only AND requires the short-lived pd_admin cookie (issued
 *   when admin types their PIN on the admin page).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import {
  verifyUnlockToken,
  verifyAdminToken,
  signUnlockToken,
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

async function getCallerProfile() {
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
  if (!user) return null
  const svc = adminClient()
  const { data: profile } = await svc
    .from('profiles')
    .select('id, role, company_id')
    .eq('id', user.id)
    .single()
  return profile && profile.company_id ? profile : null
}

export async function GET(req: NextRequest) {
  const profile = await getCallerProfile()
  if (!profile) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  let needsCookieRefresh = false

  if (profile.role !== 'admin') {
    const cookieStore = await cookies()
    const token = cookieStore.get(UNLOCK_COOKIE_NAME)?.value
    if (!verifyUnlockToken(token, profile.id)) {
      return NextResponse.json({ error: 'Unlock required' }, { status: 403 })
    }
    needsCookieRefresh = true
  }

  const svc = adminClient()
  const { data, error } = await svc
    .from('phone_directory_entries')
    .select('id, name, phone_number, notes, sort_order')
    .eq('company_id', profile.company_id)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const res = NextResponse.json({ entries: data || [] })

  // Re-issue the driver cookie on every successful read. This rolls
  // the 8-hour clock forward while the driver is actively using the
  // directory, and recovers from any one-off browser drop (e.g.
  // Safari ITP eating an old cookie).
  if (needsCookieRefresh) {
    const fresh = signUnlockToken(profile.id)
    res.cookies.set({
      name: UNLOCK_COOKIE_NAME,
      value: fresh.value,
      ...cookieOptions(fresh.maxAgeSeconds),
    })
  }

  return res
}

export async function POST(req: NextRequest) {
  const profile = await getCallerProfile()
  if (!profile) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  if (profile.role !== 'admin') {
    return NextResponse.json({ error: 'Admins only' }, { status: 403 })
  }

  // Admin gate cookie required — proves they typed the PIN recently.
  const cookieStore = await cookies()
  const adminToken = cookieStore.get(ADMIN_COOKIE_NAME)?.value
  if (!verifyAdminToken(adminToken, profile.id)) {
    return NextResponse.json({ error: 'Admin PIN required', need_pin: true }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const name: string = (body?.name || '').trim()
  const phone_number: string = (body?.phone_number || '').trim()
  const notes: string | null = body?.notes ? String(body.notes).trim() : null
  const sort_order: number = Number.isFinite(body?.sort_order) ? body.sort_order : 0

  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!phone_number) return NextResponse.json({ error: 'Phone number is required' }, { status: 400 })

  const svc = adminClient()
  const { data, error } = await svc
    .from('phone_directory_entries')
    .insert({
      company_id: profile.company_id,
      name,
      phone_number,
      notes: notes || null,
      sort_order,
      created_by: profile.id,
    })
    .select('id, name, phone_number, notes, sort_order')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logAudit({
    action: 'PHONE_DIRECTORY_ENTRY_CREATED',
    entity: 'phone_directory_entry',
    details: { id: data.id, name, phone_number },
    ip_address: req.headers.get('x-forwarded-for') || undefined,
  })

  return NextResponse.json({ entry: data })
}
