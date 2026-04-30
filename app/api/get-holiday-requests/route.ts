import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

/**
 * POST /api/get-holiday-requests
 *
 * Body shapes:
 *   { user_id, scope: 'mine' }                 — just this user's requests
 *   { company_id, scope: 'company' }           — every request in the company
 *
 * Each request includes the joined `user` profile (full_name, job_title)
 * and the `reviewer` profile (if reviewed).
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { scope, user_id, company_id } = body

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    let query = supabase
      .from('holiday_requests')
      .select(`
        *,
        user:profiles!holiday_requests_user_id_fkey (id, full_name, email, job_title),
        reviewer:profiles!holiday_requests_reviewed_by_fkey (id, full_name)
      `)
      .order('created_at', { ascending: false })

    if (scope === 'mine') {
      if (!user_id) return NextResponse.json({ error: 'user_id required' }, { status: 400 })
      query = query.eq('user_id', user_id)
    } else if (scope === 'company') {
      if (!company_id) return NextResponse.json({ error: 'company_id required' }, { status: 400 })
      query = query.eq('company_id', company_id)
    } else {
      return NextResponse.json({ error: 'scope must be mine or company' }, { status: 400 })
    }

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ requests: data || [] })
  } catch (err: any) {
    console.error('get-holiday-requests error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
