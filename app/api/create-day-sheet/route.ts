import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'

/**
 * POST /api/create-day-sheet
 *
 * Body (one_off, single day):
 *   { company_id, customer_name, sheet_type: 'one_off',
 *     start_date,                                          // required
 *     job_description, start_time, end_time, passenger_count,
 *     job_notes, created_by }                              // optional
 *
 * Body (one_off, multi-day continuous — added in step 5.7):
 *   Same as single day but with `end_date` >= start_date. The job
 *   runs every day from start_date to end_date inclusive. The assign
 *   page treats it as a single block — picking a driver on day 1
 *   auto-fills every day in the range (across week boundaries).
 *
 * Body (recurring):
 *   { company_id, customer_name, sheet_type: 'recurring',
 *     start_date, end_date,                                // required, end may be null
 *     recurring_days: ['mon','tue',...],                   // required, non-empty
 *     job_description, start_time, end_time, passenger_count,
 *     job_notes, created_by }                              // optional
 *
 * Returns the created row.
 *
 * NOTE: For backwards compatibility this API accepts `job_date` as an
 * alias for `start_date` if `start_date` isn't supplied.
 */

const VALID_DAYS = ['mon','tue','wed','thu','fri','sat','sun']

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      company_id, customer_name,
      sheet_type: rawType,
      start_date: rawStart, end_date: rawEnd,
      job_date,                 // legacy alias
      recurring_days,
      job_description, start_time, end_time,
      passenger_count, job_notes, created_by,
    } = body

    if (!company_id) return NextResponse.json({ error: 'company_id is required' }, { status: 400 })
    if (!customer_name?.trim()) return NextResponse.json({ error: 'customer_name is required' }, { status: 400 })

    const sheet_type: 'one_off' | 'recurring' =
      rawType === 'recurring' ? 'recurring' : 'one_off'

    const start_date = rawStart || job_date
    if (!start_date) {
      return NextResponse.json({ error: 'start_date is required (YYYY-MM-DD)' }, { status: 400 })
    }

    let end_date: string | null = null
    let normalisedDays: string[] | null = null

    if (sheet_type === 'recurring') {
      if (!Array.isArray(recurring_days) || recurring_days.length === 0) {
        return NextResponse.json({ error: 'recurring_days must be a non-empty array for recurring sheets' }, { status: 400 })
      }
      normalisedDays = recurring_days
        .map((d: any) => String(d).toLowerCase())
        .filter((d: string) => VALID_DAYS.includes(d))
      if (normalisedDays.length === 0) {
        return NextResponse.json({ error: 'recurring_days contains no valid weekday slugs' }, { status: 400 })
      }

      end_date = rawEnd || null
      if (end_date && end_date < start_date) {
        return NextResponse.json({ error: 'end_date must be on or after start_date' }, { status: 400 })
      }
    } else {
      // one_off — end_date is now optional (step 5.7).
      // If supplied, the sheet runs every day from start_date to
      // end_date inclusive. If null, single-day job.
      end_date = rawEnd || null
      if (end_date && end_date < start_date) {
        return NextResponse.json({ error: 'end_date must be on or after start_date' }, { status: 400 })
      }
    }

    let pax: number | null = null
    if (passenger_count != null && passenger_count !== '') {
      const n = parseInt(String(passenger_count), 10)
      if (!isNaN(n) && n > 0) pax = n
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const { data, error } = await supabase
      .from('day_sheets')
      .insert({
        company_id,
        customer_name: customer_name.trim(),
        sheet_type,
        start_date,
        end_date,
        recurring_days: normalisedDays,
        job_description: job_description?.trim() || null,
        start_time: start_time || null,
        end_time: end_time || null,
        passenger_count: pax,
        job_notes: job_notes?.trim() || null,
        created_by: created_by || null,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    await logAudit({
      action: 'CREATE_DAY_SHEET',
      entity: 'day_sheet',
      entity_id: data.id,
      details: {
        customer_name: data.customer_name,
        sheet_type: data.sheet_type,
        start_date: data.start_date,
        end_date: data.end_date,
      },
      ip_address: request.headers.get('x-forwarded-for') || undefined,
    })

    return NextResponse.json({ day_sheet: data })
  } catch (err: any) {
    console.error('create-day-sheet error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
