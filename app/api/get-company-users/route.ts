import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

/**
 * POST /api/get-company-users
 *
 * Body: { company_id, include_deleted? }
 *
 * Returns:
 *   • users — profiles for this company, each with their user_features
 *     and manager_job_titles attached
 *
 * If `include_deleted` is true, returns all users (active and
 * soft-deleted). Otherwise (default) only active users. The page
 * uses this flag to power its "Show removed users" toggle.
 */
export async function POST(request: Request) {
  try {
    const { company_id, include_deleted } = await request.json()
    if (!company_id) {
      return NextResponse.json({ error: 'company_id is required' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    let query = supabase
      .from('profiles')
      .select('*')
      .eq('company_id', company_id)
      .order('created_at', { ascending: true })

    if (!include_deleted) {
      query = query.eq('is_deleted', false)
    }

    const { data: users, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    // Attach features + manager_titles to each user
    const enriched = await Promise.all(
      (users || []).map(async (u) => {
        const [{ data: features }, { data: titles }] = await Promise.all([
          supabase
            .from('user_features')
            .select('feature_id, is_enabled, can_view, can_view_all, can_edit, can_view_reports')
            .eq('user_id', u.id),
          supabase
            .from('manager_job_titles')
            .select('job_title')
            .eq('manager_id', u.id),
        ])
        return {
          ...u,
          user_features: features || [],
          manager_titles: (titles || []).map((t: any) => t.job_title),
        }
      })
    )

    return NextResponse.json({ users: enriched })
  } catch (err: any) {
    console.error('get-company-users error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
