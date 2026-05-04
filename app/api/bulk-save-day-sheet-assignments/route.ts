import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { logAudit, getActorFields } from '@/lib/audit'

/**
 * POST /api/bulk-save-day-sheet-assignments
 *
 * Body:
 *   {
 *     company_id,
 *     items: [
 *       { day_sheet_id, assignment_date, user_id }
 *       // user_id null/undefined → unassign that (sheet, date) pair
 *     ]
 *   }
 *
 * For each item:
 *   - If user_id is null → delete any existing assignment for that
 *     (day_sheet_id, assignment_date).
 *   - Otherwise → insert or update one row keyed on (day_sheet_id,
 *     assignment_date). Existing vehicle_id and day_notes on the row
 *     are preserved (those are owned by step 6).
 *
 * Returns counts of inserts/updates/deletes.
 *
 * Updated in step 5.5: previously items were keyed by day_sheet_id
 * alone (one assignment per sheet, ever). Recurring sheets now have
 * one assignment per (sheet, occurrence-date), so the key is composite.
 */

const DAY_FROM_INDEX = ['sun','mon','tue','wed','thu','fri','sat']

const dayMatchesPattern = (
  date: string,
  pattern: string[] | null,
): boolean => {
  if (!pattern || pattern.length === 0) return true
  const slug = DAY_FROM_INDEX[new Date(date + 'T00:00:00').getDay()]
  return pattern.includes(slug)
}

const isValidOccurrence = (
  sheet: any,
  date: string,
): boolean => {
  if (date < sheet.start_date) return false
  if (sheet.end_date && date > sheet.end_date) return false
  if (sheet.sheet_type === 'one_off') {
    // A one-off sheet without end_date runs only on its start_date.
    // With end_date set, it runs on every day in [start_date, end_date]
    // inclusive — the bounds checks above already enforce the range so
    // we just say yes.
    //
    // (This logic mirrors sheetRunsOn() on the assign page; both must
    //  agree or the front-end shows cells the API will reject.)
    return sheet.end_date ? true : date === sheet.start_date
  }
  if (sheet.sheet_type === 'recurring') {
    return dayMatchesPattern(date, sheet.recurring_days)
  }
  return false
}

export async function POST(request: Request) {
  try {
    // Identify the caller for audit. Must be signed in.
    const cookieStore = await cookies()
    const authClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll() { /* no-op */ },
        },
      },
    )
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    const actor = await getActorFields(user.id)

    const body = await request.json()
    const { company_id, items } = body
    if (!company_id) return NextResponse.json({ error: 'company_id is required' }, { status: 400 })
    if (!Array.isArray(items)) return NextResponse.json({ error: 'items must be an array' }, { status: 400 })

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    // Pull all sheets touched by the request, scoped to the company.
    // Use these to validate ownership AND that each (sheet, date) pair
    // is a real occurrence-date.
    const sheetIds = Array.from(new Set(
      items.map((it: any) => it?.day_sheet_id).filter(Boolean)
    ))
    if (sheetIds.length === 0) {
      return NextResponse.json({ inserted: 0, updated: 0, deleted: 0 })
    }

    const { data: sheets, error: shErr } = await supabase
      .from('day_sheets')
      .select('id, sheet_type, start_date, end_date, recurring_days')
      .eq('company_id', company_id)
      .in('id', sheetIds)
    if (shErr) return NextResponse.json({ error: shErr.message }, { status: 400 })

    const sheetMap = new Map<string, any>()
    ;(sheets || []).forEach(s => sheetMap.set(s.id, s))

    const validItems = items.filter((it: any) => {
      if (!it?.day_sheet_id || !it?.assignment_date) return false
      const s = sheetMap.get(it.day_sheet_id)
      if (!s) return false  // not owned by company
      return isValidOccurrence(s, it.assignment_date)
    })
    if (validItems.length !== items.length) {
      console.warn(
        `[bulk-save-day-sheet-assignments] ${items.length - validItems.length} items were rejected (ownership or non-matching date).`
      )
    }

    // Pre-fetch existing assignments for the (sheet, date) pairs being
    // touched.
    const pairKeys = validItems.map((it: any) => `${it.day_sheet_id}|${it.assignment_date}`)
    const dateRange = (() => {
      const dates = validItems.map((it: any) => it.assignment_date as string)
      if (dates.length === 0) return { from: null, to: null }
      dates.sort()
      return { from: dates[0], to: dates[dates.length - 1] }
    })()

    let existing: any[] = []
    if (dateRange.from && dateRange.to) {
      const { data, error: exErr } = await supabase
        .from('day_sheet_assignments')
        .select('id, day_sheet_id, assignment_date, user_id')
        .in('day_sheet_id', sheetIds)
        .gte('assignment_date', dateRange.from)
        .lte('assignment_date', dateRange.to)
      if (exErr) return NextResponse.json({ error: exErr.message }, { status: 400 })
      existing = data || []
    }

    const byPair = new Map<string, { id: string; user_id: string | null }>()
    for (const r of existing) {
      const key = `${r.day_sheet_id}|${r.assignment_date}`
      byPair.set(key, { id: r.id, user_id: r.user_id })
    }

    const toInsert: any[] = []
    const toUpdate: { id: string; user_id: string }[] = []
    const toDelete: string[] = []

    for (const it of validItems) {
      const key = `${it.day_sheet_id}|${it.assignment_date}`
      const newUser = it.user_id || null
      const cur = byPair.get(key)

      if (newUser == null) {
        if (cur) toDelete.push(cur.id)
      } else if (!cur) {
        toInsert.push({
          company_id,
          day_sheet_id: it.day_sheet_id,
          assignment_date: it.assignment_date,
          user_id: newUser,
          status: 'draft',
        })
      } else if (cur.user_id !== newUser) {
        toUpdate.push({ id: cur.id, user_id: newUser })
      }
    }

    let insCount = 0, updCount = 0, delCount = 0

    if (toInsert.length > 0) {
      const { error: e1 } = await supabase
        .from('day_sheet_assignments')
        .insert(toInsert)
      if (e1) return NextResponse.json({ error: 'insert failed: ' + e1.message }, { status: 400 })
      insCount = toInsert.length
    }

    for (const u of toUpdate) {
      const { error: eU } = await supabase
        .from('day_sheet_assignments')
        .update({ user_id: u.user_id, is_changed: true })
        .eq('id', u.id)
      if (eU) return NextResponse.json({ error: 'update failed: ' + eU.message }, { status: 400 })
      updCount += 1
    }

    if (toDelete.length > 0) {
      const { error: eD } = await supabase
        .from('day_sheet_assignments')
        .delete()
        .in('id', toDelete)
      if (eD) return NextResponse.json({ error: 'delete failed: ' + eD.message }, { status: 400 })
      delCount = toDelete.length
    }

    // ── Eager cleanup of orphaned driver_day_assignments ─────────────
    // After the writes above, some drivers may now have NO assignments
    // on a given date (e.g. their only job that day was reassigned to
    // someone else). Their driver_day_assignments row for that date is
    // now an orphan (records vehicle/notes for a day they don't work).
    //
    // Find affected (user_id, date) pairs from the items we just
    // processed. For each, check if the user still has any
    // day_sheet_assignment for that date. If not, delete the
    // driver_day_assignments row.
    let driverDayCleanupCount = 0
    try {
      // Collect candidate (date, user) pairs to inspect. We care about:
      //   - DELETED items (the user that was unassigned)
      //   - UPDATED items (the user who used to be on this row)
      // Inserts can't orphan anyone (they only add work).
      const candidatePairs = new Set<string>()
      for (const it of validItems) {
        const cur = byPair.get(`${it.day_sheet_id}|${it.assignment_date}`)
        const oldUser = cur?.user_id
        const newUser = it.user_id || null
        // If this row USED to have a user and that user is being
        // changed or removed, the old user might now be orphaned on
        // this date.
        if (oldUser && oldUser !== newUser) {
          candidatePairs.add(`${oldUser}|${it.assignment_date}`)
        }
      }

      if (candidatePairs.size > 0) {
        // For each pair, check whether the user still has any
        // assignment on that date. We do this in a single query: pull
        // all day_sheet_assignments for the candidate users on the
        // candidate dates, group client-side.
        const candUserIds = Array.from(new Set(
          Array.from(candidatePairs).map(p => p.split('|')[0])
        ))
        const candDates = Array.from(new Set(
          Array.from(candidatePairs).map(p => p.split('|')[1])
        ))
        const { data: stillThere, error: stErr } = await supabase
          .from('day_sheet_assignments')
          .select('user_id, assignment_date')
          .in('user_id', candUserIds)
          .in('assignment_date', candDates)
        if (stErr) {
          console.warn('[bulk-save-day-sheet-assignments] cleanup fetch failed:', stErr.message)
        } else {
          const stillSet = new Set(
            (stillThere || []).map(r => `${r.user_id}|${r.assignment_date}`)
          )
          const orphanedPairs = Array.from(candidatePairs).filter(p => !stillSet.has(p))
          if (orphanedPairs.length > 0) {
            // Delete driver_day_assignments rows for the orphaned
            // (user, date) pairs. We can't use a composite IN, so do
            // one delete per pair (fine for the typical case where
            // only a handful of drivers change in a save).
            for (const pair of orphanedPairs) {
              const [uid, date] = pair.split('|')
              const { error: delErr } = await supabase
                .from('driver_day_assignments')
                .delete()
                .eq('user_id', uid)
                .eq('assignment_date', date)
                .eq('company_id', company_id)
              if (delErr) {
                console.warn('[bulk-save-day-sheet-assignments] cleanup delete failed:', delErr.message)
              } else {
                driverDayCleanupCount += 1
              }
            }
          }
        }
      }
    } catch (cleanupErr: any) {
      // Cleanup failures are non-fatal — the main save has already
      // succeeded. Log and continue.
      console.warn('[bulk-save-day-sheet-assignments] cleanup error:', cleanupErr?.message)
    }

    await logAudit({
      ...actor,
      action: 'BULK_SAVE_DAY_SHEET_ASSIGNMENTS',
      entity: 'day_sheet_assignment',
      details: {
        inserted: insCount,
        updated: updCount,
        deleted: delCount,
        driver_day_cleanups: driverDayCleanupCount,
      },
      ip_address: request.headers.get('x-forwarded-for') || undefined,
    })

    return NextResponse.json({
      inserted: insCount,
      updated: updCount,
      deleted: delCount,
      driver_day_cleanups: driverDayCleanupCount,
    })
  } catch (err: any) {
    console.error('bulk-save-day-sheet-assignments error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
