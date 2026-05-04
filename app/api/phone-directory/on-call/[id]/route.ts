/**
 * PATCH /api/phone-directory/on-call/[id]
 *   Body: subset of {
 *     phone_directory_entry_id, start_date, end_date,
 *     is_all_day, start_time, end_time, notes
 *   }
 *   To switch to all-day: send is_all_day=true (times will be cleared).
 *   To switch to timed:   send is_all_day=false AND both times.
 *   Admin only. (No PIN gate — see route.ts.)
 *
 * DELETE /api/phone-directory/on-call/[id]
 *   Admin only. (No PIN gate — see route.ts.)
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

async function adminCallerOrError() {
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
  if (!user) return { error: NextResponse.json({ error: 'Not signed in' }, { status: 401 }) }
  const svc = adminClient()
  const { data: profile } = await svc
    .from('profiles').select('id, email, role, company_id').eq('id', user.id).single()
  if (!profile?.company_id) return { error: NextResponse.json({ error: 'No company' }, { status: 400 }) }
  if (profile.role !== 'admin') return { error: NextResponse.json({ error: 'Admins only' }, { status: 403 }) }

  // No PIN gate — see route.ts comment. The on-call surface never
  // shows phone numbers, so admin role + login session is the gate.

  return { profile, svc }
}

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const r = await adminCallerOrError()
  if ('error' in r) return r.error
  const { profile, svc } = r

  const body = await req.json().catch(() => null)
  const updates: Record<string, any> = {}

  if (body?.phone_directory_entry_id) {
    const { data: entry } = await svc
      .from('phone_directory_entries')
      .select('id, company_id')
      .eq('id', body.phone_directory_entry_id)
      .single()
    if (!entry || entry.company_id !== profile.company_id) {
      return NextResponse.json({ error: 'Directory entry not found' }, { status: 404 })
    }
    updates.phone_directory_entry_id = body.phone_directory_entry_id
  }
  if (body?.start_date) {
    if (!ISO_DATE_RE.test(body.start_date)) {
      return NextResponse.json({ error: 'start_date must be YYYY-MM-DD' }, { status: 400 })
    }
    updates.start_date = body.start_date
  }
  if (body?.end_date) {
    if (!ISO_DATE_RE.test(body.end_date)) {
      return NextResponse.json({ error: 'end_date must be YYYY-MM-DD' }, { status: 400 })
    }
    updates.end_date = body.end_date
  }
  if (body?.notes !== undefined) {
    updates.notes = body.notes ? String(body.notes).trim() : null
  }

  // Time fields. Three patterns:
  //  - Caller sends is_all_day=true → set is_all_day, null the times
  //  - Caller sends is_all_day=false → set is_all_day, require both times
  //  - Caller sends neither → leave times alone
  if (body?.is_all_day === true) {
    updates.is_all_day = true
    updates.start_time = null
    updates.end_time = null
  } else if (body?.is_all_day === false) {
    if (!body.start_time || !HHMM_RE.test(body.start_time)) {
      return NextResponse.json({ error: 'Start time must be HH:MM (24-hour)' }, { status: 400 })
    }
    if (!body.end_time || !HHMM_RE.test(body.end_time)) {
      return NextResponse.json({ error: 'End time must be HH:MM (24-hour)' }, { status: 400 })
    }
    if (body.start_time === body.end_time) {
      return NextResponse.json({ error: 'Start and end times cannot be the same' }, { status: 400 })
    }
    updates.is_all_day = false
    updates.start_time = body.start_time
    updates.end_time = body.end_time
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { data: existing } = await svc
    .from('on_call_slots')
    .select('id, company_id, start_date, end_date')
    .eq('id', id)
    .single()
  if (!existing || existing.company_id !== profile.company_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const finalStart = updates.start_date || existing.start_date
  const finalEnd = updates.end_date || existing.end_date
  if (finalStart > finalEnd) {
    return NextResponse.json({ error: 'End date must be on or after start date' }, { status: 400 })
  }

  const { data, error } = await svc
    .from('on_call_slots')
    .update(updates)
    .eq('id', id)
    .select(`
      id, company_id, phone_directory_entry_id, start_date, end_date,
      is_all_day, start_time, end_time, notes, created_at,
      phone_directory_entries ( id, name, phone_number, notes )
    `)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logAudit({
    user_id: profile.id,
    user_email: profile.email,
    user_role: profile.role,
    action: 'ON_CALL_SLOT_UPDATED',
    entity: 'on_call_slot',
    details: { id, updates },
    ip_address: req.headers.get('x-forwarded-for') || undefined,
  })

  return NextResponse.json({ slot: data })
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const r = await adminCallerOrError()
  if ('error' in r) return r.error
  const { profile, svc } = r

  const { data: existing } = await svc
    .from('on_call_slots')
    .select('id, company_id')
    .eq('id', id)
    .single()
  if (!existing || existing.company_id !== profile.company_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { error } = await svc
    .from('on_call_slots')
    .delete()
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logAudit({
    user_id: profile.id,
    user_email: profile.email,
    user_role: profile.role,
    action: 'ON_CALL_SLOT_DELETED',
    entity: 'on_call_slot',
    details: { id },
    ip_address: req.headers.get('x-forwarded-for') || undefined,
  })

  return NextResponse.json({ ok: true })
}
