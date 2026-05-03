import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'

/**
 * POST /api/update-day-sheet
 *
 * Body: { id, ...any subset of editable fields }
 *
 * Editable fields:
 *   customer_name, job_description,
 *   sheet_type, start_date, end_date, recurring_days,
 *   start_time, end_time, passenger_count, job_notes, active,
 *   job_date  (legacy alias for start_date)
 *
 * Step 5.7 change: one_off sheets may now have an end_date. If set,
 * the sheet is treated as a multi-day continuous block (every day from
 * start to end inclusive). If null, single-day job. Only recurring_days
 * is still forced null on one_off — that's a recurring-only field.
 *
 * Cascade-clean: if recurrence-affecting fields change such that
 * existing assignments fall outside the new pattern, those assignments
 * are deleted. The audit log captures how many rows were dropped.
 */

const VALID_DAYS = ['mon','tue','wed','thu','fri','sat','sun']
const DAY_FROM_INDEX = ['sun','mon','tue','wed','thu','fri','sat']

const dayMatchesPattern = (
  date: string,
  pattern: string[] | null,
): boolean => {
  if (!pattern || pattern.length === 0) return true
  const slug = DAY_FROM_INDEX[new Date(date + 'T00:00:00').getDay()]
  return pattern.includes(slug)
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { id } = body
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const { data: existing, error: exErr } = await supabase
      .from('day_sheets')
      .select('id, sheet_type, start_date, end_date, recurring_days')
      .eq('id', id)
      .single()
    if (exErr) return NextResponse.json({ error: exErr.message }, { status: 404 })

    const updatePayload: any = {}

    if (body.customer_name !== undefined)   updatePayload.customer_name   = body.customer_name?.trim() || null
    if (body.job_description !== undefined) updatePayload.job_description = body.job_description?.trim() || null
    if (body.start_time !== undefined)      updatePayload.start_time      = body.start_time || null
    if (body.end_time !== undefined)        updatePayload.end_time        = body.end_time || null
    if (body.job_notes !== undefined)       updatePayload.job_notes       = body.job_notes?.trim() || null
    if (body.active !== undefined)          updatePayload.active          = !!body.active

    if (body.passenger_count !== undefined) {
      let pax: number | null = null
      if (body.passenger_count != null && body.passenger_count !== '') {
        const n = parseInt(String(body.passenger_count), 10)
        if (!isNaN(n) && n > 0) pax = n
      }
      updatePayload.passenger_count = pax
    }

    // Recurrence-related fields
    if (body.sheet_type !== undefined) {
      if (body.sheet_type !== 'one_off' && body.sheet_type !== 'recurring') {
        return NextResponse.json({ error: "sheet_type must be 'one_off' or 'recurring'" }, { status: 400 })
      }
      updatePayload.sheet_type = body.sheet_type
    }
    if (body.start_date !== undefined || body.job_date !== undefined) {
      updatePayload.start_date = body.start_date || body.job_date || null
    }
    if (body.end_date !== undefined) {
      updatePayload.end_date = body.end_date || null
    }
    if (body.recurring_days !== undefined) {
      if (body.recurring_days === null) {
        updatePayload.recurring_days = null
      } else if (Array.isArray(body.recurring_days)) {
        const norm = body.recurring_days
          .map((d: any) => String(d).toLowerCase())
          .filter((d: string) => VALID_DAYS.includes(d))
        updatePayload.recurring_days = norm.length > 0 ? norm : null
      } else {
        return NextResponse.json({ error: 'recurring_days must be an array or null' }, { status: 400 })
      }
    }

    // Resolve effective post-update values for cascade-clean check
    const effective = {
      sheet_type: updatePayload.sheet_type ?? existing.sheet_type,
      start_date: updatePayload.start_date ?? existing.start_date,
      end_date:   updatePayload.end_date   !== undefined ? updatePayload.end_date   : existing.end_date,
      recurring_days: (updatePayload.recurring_days !== undefined ? updatePayload.recurring_days : existing.recurring_days) as string[] | null,
    }

    // Validate recurring shape
    if (effective.sheet_type === 'recurring') {
      if (!effective.recurring_days || effective.recurring_days.length === 0) {
        return NextResponse.json({ error: 'recurring_days must be non-empty for recurring sheets' }, { status: 400 })
      }
      if (effective.end_date && effective.end_date < effective.start_date) {
        return NextResponse.json({ error: 'end_date must be on or after start_date' }, { status: 400 })
      }
    } else {
      // one_off: recurring_days is forced null. end_date is now allowed
      // (step 5.7). Validate ordering if both are set.
      updatePayload.recurring_days = null
      if (effective.end_date && effective.end_date < effective.start_date) {
        return NextResponse.json({ error: 'end_date must be on or after start_date' }, { status: 400 })
      }
    }

    if (!updatePayload.customer_name && body.customer_name !== undefined) {
      return NextResponse.json({ error: 'customer_name cannot be empty' }, { status: 400 })
    }

    if (Object.keys(updatePayload).length === 0) {
      return NextResponse.json({ error: 'No editable fields supplied' }, { status: 400 })
    }

    const { data: updated, error: updErr } = await supabase
      .from('day_sheets')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single()
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 })

    // ── Cascade-clean ─────────────────────────────────────────────
    let cascadeRemoved = 0
    const recurrenceChanged =
      updatePayload.sheet_type !== undefined ||
      updatePayload.start_date !== undefined ||
      updatePayload.end_date !== undefined ||
      updatePayload.recurring_days !== undefined

    if (recurrenceChanged) {
      const { data: asgs, error: asgErr } = await supabase
        .from('day_sheet_assignments')
        .select('id, assignment_date')
        .eq('day_sheet_id', id)
      if (asgErr) {
        console.warn('[update-day-sheet] cascade-clean fetch failed:', asgErr.message)
      } else {
        const toDelete: string[] = []
        for (const a of asgs || []) {
          const d = a.assignment_date
          if (!d) continue
          if (d < effective.start_date) { toDelete.push(a.id); continue }
          if (effective.end_date && d > effective.end_date) { toDelete.push(a.id); continue }
          if (effective.sheet_type === 'recurring' &&
              effective.recurring_days &&
              !dayMatchesPattern(d, effective.recurring_days)) {
            toDelete.push(a.id); continue
          }
          // one_off — valid range is [start_date, end_date or start_date]
          if (effective.sheet_type === 'one_off') {
            const upperBound = effective.end_date || effective.start_date
            if (d < effective.start_date || d > upperBound) {
              toDelete.push(a.id); continue
            }
          }
        }
        if (toDelete.length > 0) {
          const { error: delErr } = await supabase
            .from('day_sheet_assignments')
            .delete()
            .in('id', toDelete)
          if (delErr) {
            console.warn('[update-day-sheet] cascade-clean delete failed:', delErr.message)
          } else {
            cascadeRemoved = toDelete.length
          }
        }
      }
    }

    await logAudit({
      action: 'UPDATE_DAY_SHEET',
      entity: 'day_sheet',
      entity_id: id,
      details: {
        fields: Object.keys(updatePayload),
        cascade_assignments_removed: cascadeRemoved,
      },
      ip_address: request.headers.get('x-forwarded-for') || undefined,
    })

    return NextResponse.json({ day_sheet: updated, cascade_assignments_removed: cascadeRemoved })
  } catch (err: any) {
    console.error('update-day-sheet error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
