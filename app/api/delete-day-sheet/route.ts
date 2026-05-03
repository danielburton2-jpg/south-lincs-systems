import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'

/**
 * POST /api/delete-day-sheet
 *
 * Body: { id }
 *
 * Soft delete — sets active=false. The day sheet stays in the DB so
 * historical reports/printouts still render correctly. The list page
 * filters out active=false rows by default.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { id } = body
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const { error } = await supabase
      .from('day_sheets')
      .update({ active: false })
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    await logAudit({
      action: 'DELETE_DAY_SHEET',
      entity: 'day_sheet',
      entity_id: id,
      details: { soft_delete: true },
      ip_address: request.headers.get('x-forwarded-for') || undefined,
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('delete-day-sheet error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
