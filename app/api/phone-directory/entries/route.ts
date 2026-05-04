/**
 * GET /api/phone-directory/entries
 *   - Driver: requires valid pd_unlock cookie. Cookie is short-lived
 *     (5 min, set by verify-code/set-code). The driver page UI
 *     re-prompts on every mount — this cookie is just the API gate
 *     so the directory keeps loading for ~5 minutes after PIN entry.
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
  UNLOCK_COOKIE_NAME,
  ADMIN_COOKIE_NAME,
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

  if (profile.role !== 'admin') {
    const cookieStore = await cookies()
    const token = cookieStore.get(UNLOCK_COOKIE_NAME)?.value
    if (!verifyUnlockToken(token, profile.id)) {
      return NextResponse.json({ error: 'Unlock required' }, { status: 403 })
    }
  }

  const svc = adminClient()
  const { data, error } = await svc
    .from('phone_directory_entries')
    .select('id, name, phone_number, notes, sort_order')
    .eq('company_id', profile.company_id)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Note: in step 18 we re-issued the unlock cookie on every successful
  // read to roll the 8-hour TTL forward. In step 19 the cookie's TTL
  // dropped to 5 minutes and the driver UI re-prompts on every page
  // mount. Re-issuing on each read would defeat the "fresh PIN per
  // visit" rule (a driver scrolling/refreshing would never expire),
  // so we deliberately don't extend it. The cookie's only job now
  // is to keep the API working for ~5 minutes after PIN entry.
  return NextResponse.json({ entries: data || [] })
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
