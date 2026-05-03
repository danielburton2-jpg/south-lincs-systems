import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

/**
 * GET /api/get-day-sheet?id=<uuid>
 *
 * Returns the day sheet plus, if it has a linked_group_id, the other
 * day sheets in the same group (so the edit page can show "linked to:").
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const { data: day_sheet, error } = await supabase
      .from('day_sheets')
      .select('*')
      .eq('id', id)
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 404 })

    let linked_siblings: any[] = []
    if (day_sheet.linked_group_id) {
      const { data: siblings } = await supabase
        .from('day_sheets')
        .select('id, customer_name, job_description, job_date, start_time, end_time, passenger_count')
        .eq('linked_group_id', day_sheet.linked_group_id)
        .eq('active', true)
        .neq('id', day_sheet.id)
        .order('start_time', { ascending: true, nullsFirst: false })
      linked_siblings = siblings || []
    }

    return NextResponse.json({ day_sheet, linked_siblings })
  } catch (err: any) {
    console.error('get-day-sheet error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
