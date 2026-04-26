import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const { user_id, company_id, start_date, end_date } = await request.json()

    if (!user_id || !company_id || !start_date || !end_date) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Find PUBLISHED assignments for this user in the date range
    const { data: assignments, error } = await supabase
      .from('schedule_assignments')
      .select(`
        id,
        schedule_id,
        assignment_date,
        status,
        published_at,
        schedules ( id, name, start_time, end_time )
      `)
      .eq('company_id', company_id)
      .eq('user_id', user_id)
      .eq('status', 'published')
      .gte('assignment_date', start_date)
      .lte('assignment_date', end_date)
      .order('assignment_date', { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({
      conflicts: assignments || [],
      conflict_count: assignments?.length || 0,
    })
  } catch (err: any) {
    console.error('Check holiday conflicts error:', err)
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 })
  }
}