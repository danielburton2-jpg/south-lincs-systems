import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'

/**
 * POST /api/publish-day-sheet-assignments
 *
 * Body:
 *   {
 *     company_id,
 *     from, to,                 // required, ISO YYYY-MM-DD
 *     published_by,             // optional, the planner's user id
 *     user_id?: string | null,  // NEW: only publish rows for this user
 *     date?: string | null      // NEW: only publish rows on this date
 *                               //      (when set, [from,to] is treated
 *                               //       as the bounding week and `date`
 *                               //       narrows to a single day)
 *   }
 *
 * Effect:
 *   For day_sheet_assignments rows in the company within [from, to]
 *   that are EITHER status='draft' OR is_changed=true (and match the
 *   optional user_id / date filters):
 *     - status     := 'published'
 *     - is_changed := false
 *     - published_at := now
 *     - published_by := <user id, or null>
 *
 * Returns: { published: <count>, published_ids: <string[]> }
 *
 * Backwards-compatible: callers that omit user_id and date publish the
 * whole week (current behaviour preserved). Callers that ignore
 * `published_ids` see no behaviour change. The driver-side ping
 * fan-out is done by the day-sheet assign page after this returns.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { company_id, from, to, published_by, user_id, date } = body
    if (!company_id) return NextResponse.json({ error: 'company_id is required' }, { status: 400 })
    if (!from || !to) return NextResponse.json({ error: 'from and to (YYYY-MM-DD) are required' }, { status: 400 })

    // If a specific date is set, validate it falls inside [from, to]
    // — guards against client/server skew.
    if (date && (date < from || date > to)) {
      return NextResponse.json({ error: 'date must fall within [from, to]' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    // Build the candidates query. Apply optional filters dynamically.
    let candQuery = supabase
      .from('day_sheet_assignments')
      .select('id')
      .eq('company_id', company_id)
      .or('status.eq.draft,is_changed.eq.true')
    if (date) {
      // Single-day publish — ignore from/to bounds, just match the date
      candQuery = candQuery.eq('assignment_date', date)
    } else {
      candQuery = candQuery.gte('assignment_date', from).lte('assignment_date', to)
    }
    if (user_id) {
      candQuery = candQuery.eq('user_id', user_id)
    }

    const { data: candidates, error: candErr } = await candQuery
    if (candErr) return NextResponse.json({ error: candErr.message }, { status: 400 })

    const count = (candidates || []).length
    if (count === 0) {
      return NextResponse.json({ published: 0, published_ids: [] })
    }

    // Capture IDs before the update — the caller needs them to fan
    // out per-row notifications. (Driver pings happen browser-side
    // because notifyEvent uses cookie-bound auth.)
    const publishedIds: string[] = (candidates || []).map((r: any) => r.id)

    const now = new Date().toISOString()

    let updQuery = supabase
      .from('day_sheet_assignments')
      .update({
        status: 'published',
        is_changed: false,
        published_at: now,
        published_by: published_by || null,
      })
      .eq('company_id', company_id)
      .or('status.eq.draft,is_changed.eq.true')
    if (date) {
      updQuery = updQuery.eq('assignment_date', date)
    } else {
      updQuery = updQuery.gte('assignment_date', from).lte('assignment_date', to)
    }
    if (user_id) {
      updQuery = updQuery.eq('user_id', user_id)
    }

    const { error: updErr } = await updQuery
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 })

    await logAudit({
      action: 'PUBLISH_DAY_SHEET_ASSIGNMENTS',
      entity: 'day_sheet_assignment',
      details: {
        from, to, published: count,
        user_id: user_id || null,
        date: date || null,
      },
      ip_address: request.headers.get('x-forwarded-for') || undefined,
    })

    return NextResponse.json({ published: count, published_ids: publishedIds })
  } catch (err: any) {
    console.error('publish-day-sheet-assignments error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
