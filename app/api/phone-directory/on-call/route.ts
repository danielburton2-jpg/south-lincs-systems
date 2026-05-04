/**
 * GET /api/phone-directory/on-call
 *
 * Returns slots + current + split time. Phone numbers ARE included
 * in the response (the client needs them to construct tel: hrefs)
 * but the on-call surfaces never DISPLAY them — only construct
 * dial links. The display threat model is shoulder-surfing on the
 * driver's screen, not network interception (admin already has full
 * visibility on the Manage page).
 *
 * Driver: requires pd_unlock cookie.
 * Admin: bypasses the cookie. Reads anyway for the on-call manager.
 *
 * POST /api/phone-directory/on-call
 *   Body: { phone_directory_entry_id, start_date, end_date, time_window, notes? }
 *   Admin only AND requires pd_admin cookie.
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

const VALID_WINDOWS = new Set(['all_day', 'am', 'pm'])
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function parseHHMM(timeStr: string): { h: number; m: number } | null {
  if (!timeStr || timeStr.length < 5) return null
  const h = parseInt(timeStr.slice(0, 2), 10)
  const m = parseInt(timeStr.slice(3, 5), 10)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  if (h < 0 || h > 23 || m < 0 || m > 59) return null
  return { h, m }
}

function todayIsoLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function currentWindow(splitTime: string | null): 'am' | 'pm' {
  const split = parseHHMM(splitTime || '12:00') || { h: 12, m: 0 }
  const now = new Date()
  const h = now.getHours()
  const m = now.getMinutes()
  if (h < split.h) return 'am'
  if (h > split.h) return 'pm'
  return m < split.m ? 'am' : 'pm'
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

  const { data: company } = await svc
    .from('companies')
    .select('am_pm_split_time')
    .eq('id', profile.company_id)
    .single()
  const splitTime: string = company?.am_pm_split_time || '12:00'

  const today = todayIsoLocal()
  const { data: slots, error } = await svc
    .from('on_call_slots')
    .select(`
      id, company_id, phone_directory_entry_id, start_date, end_date,
      time_window, notes, created_at,
      phone_directory_entries (
        id, name, phone_number, notes
      )
    `)
    .eq('company_id', profile.company_id)
    .gte('end_date', today)
    .order('start_date', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const now_window = currentWindow(splitTime)
  const current = (slots || []).filter(s =>
    s.start_date <= today &&
    s.end_date >= today &&
    (s.time_window === 'all_day' || s.time_window === now_window)
  )

  const res = NextResponse.json({
    slots: slots || [],
    current,
    am_pm_split_time: splitTime,
    now_window,
    today,
  })

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

  const cookieStore = await cookies()
  const adminToken = cookieStore.get(ADMIN_COOKIE_NAME)?.value
  if (!verifyAdminToken(adminToken, profile.id)) {
    return NextResponse.json({ error: 'Admin PIN required', need_pin: true }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const phone_directory_entry_id: string = body?.phone_directory_entry_id || ''
  const start_date: string = body?.start_date || ''
  const end_date: string = body?.end_date || ''
  const time_window_raw: string = body?.time_window || ''
  const notes: string | null = body?.notes ? String(body.notes).trim() : null

  if (!phone_directory_entry_id) {
    return NextResponse.json({ error: 'Pick a directory entry' }, { status: 400 })
  }
  if (!ISO_DATE_RE.test(start_date) || !ISO_DATE_RE.test(end_date)) {
    return NextResponse.json({ error: 'Dates must be YYYY-MM-DD' }, { status: 400 })
  }
  if (start_date > end_date) {
    return NextResponse.json({ error: 'End date must be on or after start date' }, { status: 400 })
  }
  if (!VALID_WINDOWS.has(time_window_raw)) {
    return NextResponse.json({ error: 'Window must be all_day, am, or pm' }, { status: 400 })
  }

  const svc = adminClient()

  const { data: entry } = await svc
    .from('phone_directory_entries')
    .select('id, company_id')
    .eq('id', phone_directory_entry_id)
    .single()
  if (!entry || entry.company_id !== profile.company_id) {
    return NextResponse.json({ error: 'Directory entry not found' }, { status: 404 })
  }

  const { data, error } = await svc
    .from('on_call_slots')
    .insert({
      company_id: profile.company_id,
      phone_directory_entry_id,
      start_date,
      end_date,
      time_window: time_window_raw,
      notes: notes || null,
      created_by: profile.id,
    })
    .select(`
      id, company_id, phone_directory_entry_id, start_date, end_date,
      time_window, notes, created_at,
      phone_directory_entries ( id, name, phone_number, notes )
    `)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logAudit({
    action: 'ON_CALL_SLOT_CREATED',
    entity: 'on_call_slot',
    details: {
      id: data.id,
      phone_directory_entry_id,
      start_date,
      end_date,
      time_window: time_window_raw,
    },
    ip_address: req.headers.get('x-forwarded-for') || undefined,
  })

  return NextResponse.json({ slot: data })
}
