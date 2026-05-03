import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'

/**
 * POST /api/bulk-save-driver-day-assignments
 *
 * Body:
 *   {
 *     company_id,
 *     items: [
 *       { user_id, assignment_date, vehicle_id, day_notes }
 *       // any of vehicle_id/day_notes may be null
 *     ]
 *   }
 *
 * For each item:
 *   - If vehicle_id and day_notes are BOTH null/empty → delete the
 *     row for that (user, date).
 *   - Otherwise → upsert the row keyed on (user_id, assignment_date).
 *
 * Validates that each user_id and vehicle_id (when set) belongs to
 * the calling company.
 *
 * Returns counts of inserts/updates/deletes.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { company_id, items } = body
    if (!company_id) return NextResponse.json({ error: 'company_id is required' }, { status: 400 })
    if (!Array.isArray(items)) return NextResponse.json({ error: 'items must be an array' }, { status: 400 })

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    // Validate ownership: every user_id and vehicle_id must belong to
    // this company. Pull both up front in two queries.
    const userIds = Array.from(new Set(
      items.map((it: any) => it?.user_id).filter(Boolean)
    ))
    const vehicleIds = Array.from(new Set(
      items.map((it: any) => it?.vehicle_id).filter(Boolean)
    ))

    if (userIds.length === 0) {
      return NextResponse.json({ inserted: 0, updated: 0, deleted: 0 })
    }

    const ownedUsers = new Set<string>()
    {
      const { data, error } = await supabase
        .from('profiles')
        .select('id')
        .eq('company_id', company_id)
        .in('id', userIds)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      ;(data || []).forEach(r => ownedUsers.add(r.id))
    }

    const ownedVehicles = new Set<string>()
    if (vehicleIds.length > 0) {
      const { data, error } = await supabase
        .from('vehicles')
        .select('id')
        .eq('company_id', company_id)
        .in('id', vehicleIds)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      ;(data || []).forEach(r => ownedVehicles.add(r.id))
    }

    const validItems = items.filter((it: any) => {
      if (!it?.user_id || !it?.assignment_date) return false
      if (!ownedUsers.has(it.user_id)) return false
      if (it.vehicle_id && !ownedVehicles.has(it.vehicle_id)) return false
      return true
    })
    if (validItems.length !== items.length) {
      console.warn(
        `[bulk-save-driver-day] ${items.length - validItems.length} items rejected (ownership or shape).`
      )
    }

    // Pre-fetch existing rows so we can decide insert vs update vs delete
    const { data: existing, error: exErr } = await supabase
      .from('driver_day_assignments')
      .select('id, user_id, assignment_date')
      .in('user_id', userIds)
    if (exErr) return NextResponse.json({ error: exErr.message }, { status: 400 })

    const byPair = new Map<string, string>()  // user_id|date -> row id
    ;(existing || []).forEach(r => {
      byPair.set(`${r.user_id}|${r.assignment_date}`, r.id)
    })

    const toInsert: any[] = []
    const toUpdate: { id: string; vehicle_id: string | null; day_notes: string | null }[] = []
    const toDelete: string[] = []

    for (const it of validItems) {
      const key = `${it.user_id}|${it.assignment_date}`
      const vehicle_id = it.vehicle_id || null
      const day_notes = (it.day_notes && String(it.day_notes).trim()) || null
      const cur = byPair.get(key)

      if (vehicle_id == null && day_notes == null) {
        // Both empty — delete the row if any
        if (cur) toDelete.push(cur)
      } else if (!cur) {
        toInsert.push({
          company_id,
          user_id: it.user_id,
          assignment_date: it.assignment_date,
          vehicle_id,
          day_notes,
        })
      } else {
        toUpdate.push({ id: cur, vehicle_id, day_notes })
      }
    }

    let insCount = 0, updCount = 0, delCount = 0

    if (toInsert.length > 0) {
      const { error: e1 } = await supabase
        .from('driver_day_assignments')
        .insert(toInsert)
      if (e1) return NextResponse.json({ error: 'insert failed: ' + e1.message }, { status: 400 })
      insCount = toInsert.length
    }

    for (const u of toUpdate) {
      const { error: eU } = await supabase
        .from('driver_day_assignments')
        .update({ vehicle_id: u.vehicle_id, day_notes: u.day_notes })
        .eq('id', u.id)
      if (eU) return NextResponse.json({ error: 'update failed: ' + eU.message }, { status: 400 })
      updCount += 1
    }

    if (toDelete.length > 0) {
      const { error: eD } = await supabase
        .from('driver_day_assignments')
        .delete()
        .in('id', toDelete)
      if (eD) return NextResponse.json({ error: 'delete failed: ' + eD.message }, { status: 400 })
      delCount = toDelete.length
    }

    await logAudit({
      action: 'BULK_SAVE_DRIVER_DAY_ASSIGNMENTS',
      entity: 'driver_day_assignment',
      details: { inserted: insCount, updated: updCount, deleted: delCount },
      ip_address: request.headers.get('x-forwarded-for') || undefined,
    })

    return NextResponse.json({ inserted: insCount, updated: updCount, deleted: delCount })
  } catch (err: any) {
    console.error('bulk-save-driver-day-assignments error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
