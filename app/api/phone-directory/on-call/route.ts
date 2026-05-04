/**
 * GET /api/phone-directory/on-call
 *
 * Returns:
 *   slots:   all upcoming + recent slots, joined to the directory entry.
 *            Phone numbers are in the response (so the client can build
 *            tel: hrefs) but never displayed on the on-call surfaces.
 *   current: subset of slots active RIGHT NOW. Cross-midnight handled —
 *            see currentlyActive() below.
 *   today:   today's ISO date (server local time).
 *   now_hhmm:current "HH:MM" for client-side display if needed.
 *
 * Driver: requires pd_unlock cookie.
 * Admin: bypasses (admins manage the rota; their gate is admin role +
 *        login session — the on-call surface never exposes phone numbers).
 *
 * POST /api/phone-directory/on-call
 *   Body: {
 *     phone_directory_entry_id,
 *     start_date, end_date,
 *     is_all_day,
 *     start_time?, end_time?,   // required when !is_all_day, "HH:MM"
 *     notes?
 *   }
 *   Admin only. (No PIN gate — no numbers shown on this surface.)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import {
  verifyUnlockToken,
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

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/

// ── Time helpers ────────────────────────────────────────────────────
// Time strings come back from Postgres as "HH:MM:SS" or "HH:MM". We
// normalise to minutes-since-midnight (0..1439) for comparison.
function timeToMinutes(t: string | null): number | null {
  if (!t) return null
  const h = parseInt(t.slice(0, 2), 10)
  const m = parseInt(t.slice(3, 5), 10)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  if (h < 0 || h > 23 || m < 0 || m > 59) return null
  return h * 60 + m
}

// Today's ISO date in server local time. (Server is UTC on Vercel —
// see the time-zone note in the README.)
function todayIsoLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function yesterdayIsoLocal(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function nowMinutes(): number {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}

type SlotShape = {
  id: string
  start_date: string
  end_date: string
  is_all_day: boolean
  start_time: string | null
  end_time: string | null
}

// Is this slot active right now?
//
//   All-day: today within [start_date, end_date].
//
//   Same-day timed (start <= end):
//     today within range AND now within [start, end].
//
//   Cross-midnight timed (start > end):
//     The slot's "evening half" runs from start_time today through
//     midnight; the "morning half" runs from midnight through
//     end_time on the calendar day AFTER. Either half can be active.
//       - Evening half active: today in date range AND now >= start.
//       - Morning half active: yesterday in date range AND now < end.
//     (yesterday's evening shift extends into today's morning.)
function currentlyActive(s: SlotShape, today: string, yesterday: string, now: number): boolean {
  if (s.is_all_day) {
    return s.start_date <= today && s.end_date >= today
  }
  const start = timeToMinutes(s.start_time)
  const end = timeToMinutes(s.end_time)
  if (start === null || end === null) return false  // shouldn't happen — CHECK enforces

  if (start <= end) {
    // Same-day window
    if (s.start_date > today || s.end_date < today) return false
    return now >= start && now <= end
  }

  // Cross-midnight window. Two halves.
  const eveningActive = (
    s.start_date <= today && s.end_date >= today && now >= start
  )
  const morningActive = (
    s.start_date <= yesterday && s.end_date >= yesterday && now < end
  )
  return eveningActive || morningActive
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
  const today = todayIsoLocal()
  const yesterday = yesterdayIsoLocal()

  // We need slots whose end_date is today-or-later (active or upcoming),
  // PLUS slots whose end_date is yesterday but might still be active in
  // their morning half (cross-midnight wrap). Simplest filter: end_date
  // >= yesterday. Cheap; the currentlyActive() filter narrows it for
  // the `current` array.
  const { data: slots, error } = await svc
    .from('on_call_slots')
    .select(`
      id, company_id, phone_directory_entry_id, start_date, end_date,
      is_all_day, start_time, end_time, notes, created_at,
      phone_directory_entries (
        id, name, phone_number, notes
      )
    `)
    .eq('company_id', profile.company_id)
    .gte('end_date', yesterday)
    .order('start_date', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const now = nowMinutes()
  const current = (slots || []).filter(s => currentlyActive(s, today, yesterday, now))

  return NextResponse.json({
    slots: slots || [],
    current,
    today,
    now_hhmm: `${String(Math.floor(now / 60)).padStart(2, '0')}:${String(now % 60).padStart(2, '0')}`,
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
  const is_all_day: boolean = !!body?.is_all_day
  const start_time: string | null = is_all_day ? null : (body?.start_time || null)
  const end_time: string | null = is_all_day ? null : (body?.end_time || null)
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
  if (!is_all_day) {
    if (!start_time || !HHMM_RE.test(start_time)) {
      return NextResponse.json({ error: 'Start time must be HH:MM (24-hour)' }, { status: 400 })
    }
    if (!end_time || !HHMM_RE.test(end_time)) {
      return NextResponse.json({ error: 'End time must be HH:MM (24-hour)' }, { status: 400 })
    }
    if (start_time === end_time) {
      return NextResponse.json({ error: 'Start and end times cannot be the same' }, { status: 400 })
    }
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

  const insertRow: Record<string, any> = {
    company_id: profile.company_id,
    phone_directory_entry_id,
    start_date,
    end_date,
    is_all_day,
    start_time,
    end_time,
    notes: notes || null,
    created_by: profile.id,
  }

  const { data, error } = await svc
    .from('on_call_slots')
    .insert(insertRow)
    .select(`
      id, company_id, phone_directory_entry_id, start_date, end_date,
      is_all_day, start_time, end_time, notes, created_at,
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
      is_all_day,
      start_time,
      end_time,
    },
    ip_address: req.headers.get('x-forwarded-for') || undefined,
  })

  return NextResponse.json({ slot: data })
}
