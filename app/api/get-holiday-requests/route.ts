import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const { user_id, company_id, scope } = await request.json()

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    let query = supabase
      .from('holiday_requests')
      .select('*')
      .order('start_date', { ascending: false })

    if (scope === 'mine' && user_id) {
      query = query.eq('user_id', user_id)
    } else if (scope === 'company' && company_id) {
      query = query.eq('company_id', company_id)
    }

    const { data, error } = await query

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    // Enrich with user info
    if (data && data.length > 0) {
      const userIds = [...new Set(data.map(r => r.user_id))]
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, email, job_title')
        .in('id', userIds)

      const enriched = data.map(req => ({
        ...req,
        user: profiles?.find(p => p.id === req.user_id) || null,
      }))

      return NextResponse.json({ requests: enriched })
    }

    return NextResponse.json({ requests: [] })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 })
  }
}