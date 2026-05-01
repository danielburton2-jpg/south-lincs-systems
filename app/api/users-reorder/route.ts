/**
 * POST /api/users-reorder
 *
 * Admin-only bulk update of profiles.display_order. Takes an array of
 * { id, display_order } pairs and writes them in one round-trip.
 *
 * Body shape:
 *   {
 *     orders: [
 *       { id: 'uuid-1', display_order: 10 },
 *       { id: 'uuid-2', display_order: 20 },
 *       ...
 *     ]
 *   }
 *
 * Auth:
 *   • Caller must be authenticated and have role='admin'
 *   • All ids in the request must belong to the caller's company
 *
 * Uses the service-role key so the bulk update isn't rate-limited by RLS.
 */

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { logAudit } from '@/lib/audit'

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body || !Array.isArray(body.orders)) {
      return NextResponse.json({ error: 'Missing or invalid orders array' }, { status: 400 })
    }

    const cookieStore = await cookies()
    const userClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll() { /* no-op */ },
        },
      },
    )

    // Verify caller is admin
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { data: callerProfile } = await userClient
      .from('profiles')
      .select('id, role, company_id, email')
      .eq('id', user.id)
      .single()

    if (!callerProfile || callerProfile.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    // Service-role client for bulk writes (bypasses RLS)
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    // Validate every id in the payload belongs to the admin's company.
    // Prevents a malicious admin sending orders for another company's users.
    const ids = body.orders.map((o: any) => o.id).filter(Boolean)
    if (ids.length === 0) {
      return NextResponse.json({ ok: true, updated: 0 })
    }

    const { data: matchingRows, error: lookupErr } = await admin
      .from('profiles')
      .select('id, company_id')
      .in('id', ids)

    if (lookupErr) {
      return NextResponse.json({ error: 'Lookup failed: ' + lookupErr.message }, { status: 500 })
    }

    const wrongCompanyIds = (matchingRows || [])
      .filter(r => r.company_id !== callerProfile.company_id)
      .map(r => r.id)
    if (wrongCompanyIds.length > 0) {
      return NextResponse.json(
        { error: 'Some users do not belong to your company', ids: wrongCompanyIds },
        { status: 403 },
      )
    }

    // Apply updates one by one. Bulk update of arbitrary values is awkward
    // in PostgREST; for typical company sizes (< 100 users) the round-trips
    // are fine.
    const errors: any[] = []
    for (const o of body.orders) {
      if (!o.id || typeof o.display_order !== 'number') continue
      const { error } = await admin
        .from('profiles')
        .update({ display_order: o.display_order })
        .eq('id', o.id)
      if (error) errors.push({ id: o.id, error: error.message })
    }

    if (errors.length > 0) {
      return NextResponse.json(
        { error: 'Some updates failed', failures: errors },
        { status: 500 },
      )
    }

    // Audit
    await logAudit({
      user_id: callerProfile.id,
      user_email: callerProfile.email,
      user_role: 'admin',
      action: 'USERS_REORDERED',
      entity: 'profiles',
      details: { count: body.orders.length },
    })

    return NextResponse.json({ ok: true, updated: body.orders.length })
  } catch (err: any) {
    console.error('[/api/users-reorder] unexpected:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
