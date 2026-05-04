/**
 * GET /api/phone-directory/on-call
 *
 * Returns BOTH:
 *   slots:   all upcoming + recent slots, oldest at the bottom (admin
 *            management view). Includes joined entry data so the
 *            admin UI can render "Sarah Smith — 07700 900123".
 *   current: subset of slots that are active right now (today's date
 *            falls within range AND time_window matches now). Ordered by
 *            created_at ASC (oldest = primary, newer = backup).
 *   am_pm_split_time: the company's split time, so client-side
 *            display can mirror server logic.
 *
 * Driver-side requires a valid unlock cookie (same gate as entries).
 * Admin-side bypasses (admins manage and don't need the PIN).
 *
 * POST /api/phone-directory/on-call
 *   Body: { phone_directory_entry_id, start_date, end_date, time_window, notes? }
 *   Admin only. Creates a new slot in caller's company.
 *
 * Overlap is allowed — no validation against existing slots. Multiple
 * matches at lookup time are surfaced primary-first.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { verifyUnlockToken, UNLOCK_COOKIE_NAME } from '@/lib/phoneCodeAuth'
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

// "HH:MM" (00:00–23:59) or "HH:MM:SS" with optional fractional seconds.
// We only need HH:MM for the comparison so we just take the first 5 chars.
function parseHHMM(timeStr: string): { h: number; m: number } | null {
  if (!timeStr || timeStr.length < 5) return null
  const h = parseInt(timeStr.slice(0, 2), 10)
  const m = parseInt(timeStr.slice(3, 5), 10)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  if (h < 0 || h > 23 || m < 0 || m > 59) return null
  return { h, m }
}

// Build "today" in the server's local time. We deliberately use server
// time rather than UTC here because companies operate in their local
// time zone. Vercel servers run in UTC by default; for a UK-only fleet
// company this is "close enough" — an hour's offset around midnight
// is academic for an on-call rota. If multi-timezone becomes a thing
// later, this is the place to add a company.timezone lookup.
function todayIsoLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Returns 'am' or 'pm' for the current moment vs a split time.
function currentWindow(splitTime: string | null): 'am' | 'pm' {
  const split = parseHHMM(splitTime || '12:00') || { h: 12, m: 0 }
  const now = new Date()
  const h = now.getHours()
  const m = now.getMinutes()
  // AM = strictly before split. PM = at or after split.
  if (h < split.h) return 'am'
  if (h > split.h) return 'pm'
  return m < split.m ? 'am' : 'pm'
}

export async function GET(req: NextRequest) {
  const profile = await getCallerProfile()
  if (!profile) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  // Driver-side gate: require valid unlock cookie. Admins bypass.
  if (profile.role !== 'admin') {
    const cookieStore = await cookies()
    const token = cookieStore.get(UNLOCK_COOKIE_NAME)?.value
    if (!verifyUnlockToken(token, profile.id)) {
      return NextResponse.json({ error: 'Unlock required' }, { status: 403 })
    }
  }

  const svc = adminClient()

  // Need company.am_pm_split_time
  const { data: company } = await svc
    .from('companies')
    .select('am_pm_split_time')
    .eq('id', profile.company_id)
    .single()
  const splitTime: string = company?.am_pm_split_time || '12:00'

  // Pull all slots with their joined entry. Range filter: only
  // include slots whose end_date is today-or-later, so the admin
  // view stays clean of expired entries. (We keep the rows for the
  // audit trail; we just don't surface them.)
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

  return NextResponse.json({
    slots: slots || [],
    current,
    am_pm_split_time: splitTime,
    now_window,
    today,
  })
}

export async function POST(req: NextRequest) {
  const profile = await getCallerProfile()
  if (!profile) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  if (profile.role !== 'admin') {
    return NextResponse.json({ error: 'Admins only' }, { status: 403 })
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

  // Same-company guard on the entry itself
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
