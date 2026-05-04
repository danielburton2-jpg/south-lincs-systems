import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { logAudit, getActorFields } from '@/lib/audit'

/**
 * POST /api/link-day-sheets
 *
 * Body (link mode):
 *   { action: 'link', source_id, target_id }
 * Body (unlink mode):
 *   { action: 'unlink', id }
 *
 * Linking rules (updated for recurring sheets in step 5.5):
 *   - Both sheets must belong to the same company.
 *   - Both sheets must have the SAME recurrence shape:
 *       sheet_type, start_date, end_date, recurring_days
 *     (`recurring_days` arrays compared as sets — order-independent.)
 *     Linking sheets that run on different sets of dates would make
 *     auto-fill ambiguous, so we forbid it.
 *   - Group merge: if both sheets already belong to different groups,
 *     all members of the target's group migrate into the source's
 *     group so we don't orphan anyone.
 */

const sameRecurrence = (a: any, b: any): boolean => {
  if (a.sheet_type !== b.sheet_type) return false
  if (a.start_date !== b.start_date) return false
  if ((a.end_date || null) !== (b.end_date || null)) return false
  // recurring_days: compare as sets
  const arrA: string[] = Array.isArray(a.recurring_days) ? a.recurring_days : []
  const arrB: string[] = Array.isArray(b.recurring_days) ? b.recurring_days : []
  if (arrA.length !== arrB.length) return false
  const setA = new Set(arrA.map(d => String(d).toLowerCase()))
  for (const d of arrB) if (!setA.has(String(d).toLowerCase())) return false
  return true
}

export async function POST(request: Request) {
  try {
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
    const action = body?.action

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    if (action === 'unlink') {
      const { id } = body
      if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

      const { error } = await supabase
        .from('day_sheets')
        .update({ linked_group_id: null })
        .eq('id', id)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })

      await logAudit({
        ...actor,
        action: 'UNLINK_DAY_SHEET',
        entity: 'day_sheet',
        entity_id: id,
        details: {},
        ip_address: request.headers.get('x-forwarded-for') || undefined,
      })

      return NextResponse.json({ success: true })
    }

    if (action === 'link') {
      const { source_id, target_id } = body
      if (!source_id || !target_id) {
        return NextResponse.json({ error: 'source_id and target_id are required' }, { status: 400 })
      }
      if (source_id === target_id) {
        return NextResponse.json({ error: 'Cannot link a day sheet to itself' }, { status: 400 })
      }

      const { data: rows, error: fetchErr } = await supabase
        .from('day_sheets')
        .select('id, company_id, sheet_type, start_date, end_date, recurring_days, linked_group_id')
        .in('id', [source_id, target_id])

      if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 400 })
      if (!rows || rows.length !== 2) {
        return NextResponse.json({ error: 'One or both day sheets not found' }, { status: 404 })
      }

      const source = rows.find(r => r.id === source_id)!
      const target = rows.find(r => r.id === target_id)!

      if (source.company_id !== target.company_id) {
        return NextResponse.json({ error: 'Day sheets are in different companies' }, { status: 400 })
      }
      if (!sameRecurrence(source, target)) {
        return NextResponse.json({
          error: 'Day sheets must share the same recurrence pattern (sheet_type, start_date, end_date, recurring_days) to be linked.',
        }, { status: 400 })
      }

      // Decide which group id wins
      let groupId: string
      let oldTargetGroupToMerge: string | null = null

      if (source.linked_group_id && target.linked_group_id) {
        if (source.linked_group_id === target.linked_group_id) {
          return NextResponse.json({ success: true, linked_group_id: source.linked_group_id, noop: true })
        }
        groupId = source.linked_group_id
        oldTargetGroupToMerge = target.linked_group_id
      } else if (source.linked_group_id) {
        groupId = source.linked_group_id
      } else if (target.linked_group_id) {
        groupId = target.linked_group_id
      } else {
        groupId = randomUUID()
      }

      const { error: updErr } = await supabase
        .from('day_sheets')
        .update({ linked_group_id: groupId })
        .in('id', [source_id, target_id])
      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 })

      if (oldTargetGroupToMerge) {
        await supabase
          .from('day_sheets')
          .update({ linked_group_id: groupId })
          .eq('linked_group_id', oldTargetGroupToMerge)
      }

      await logAudit({
        ...actor,
        action: 'LINK_DAY_SHEETS',
        entity: 'day_sheet',
        entity_id: source_id,
        details: { target_id, linked_group_id: groupId, merged_old_group: oldTargetGroupToMerge },
        ip_address: request.headers.get('x-forwarded-for') || undefined,
      })

      return NextResponse.json({ success: true, linked_group_id: groupId })
    }

    return NextResponse.json({ error: "action must be 'link' or 'unlink'" }, { status: 400 })
  } catch (err: any) {
    console.error('link-day-sheets error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
