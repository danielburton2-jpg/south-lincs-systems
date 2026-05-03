import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

/**
 * GET /api/list-day-sheets?company_id=...&from=YYYY-MM-DD&to=YYYY-MM-DD&active=true
 *
 * Returns day sheets for a company whose date range *overlaps* the
 * given window. A sheet's range is [start_date, end_date] (or open-
 * ended if end_date is null). With `from` and `to` both supplied,
 * a sheet matches when:
 *
 *   start_date <= to AND (end_date IS NULL OR end_date >= from)
 *
 * `active` defaults to true (omit deleted/archived rows).
 *
 * Sorted by start_date asc, then start_time asc.
 *
 * Note: this returns the SHEETS, not their occurrence-dates. The
 * assign page expands recurring sheets into per-date rows in its
 * own client logic.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const company_id = searchParams.get('company_id')
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const activeParam = searchParams.get('active')
    const onlyActive = activeParam == null ? true : activeParam === 'true'

    if (!company_id) {
      return NextResponse.json({ error: 'company_id is required' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    let q = supabase
      .from('day_sheets')
      .select('*')
      .eq('company_id', company_id)

    if (onlyActive) q = q.eq('active', true)

    // Range overlap. If only `from` supplied, we want sheets whose
    // window doesn't end before `from`. If only `to` supplied, we want
    // sheets that start on or before `to`.
    if (to)   q = q.lte('start_date', to)
    if (from) q = q.or(`end_date.is.null,end_date.gte.${from}`)

    q = q.order('start_date', { ascending: true })
         .order('start_time', { ascending: true, nullsFirst: false })

    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ day_sheets: data || [] })
  } catch (err: any) {
    console.error('list-day-sheets error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
