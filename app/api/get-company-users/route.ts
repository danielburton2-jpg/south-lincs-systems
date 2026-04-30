import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

/**
 * POST /api/get-company-users
 *
 * Body: { company_id }
 *
 * Returns:
 *   • users — profiles for this company (excluding soft-deleted),
 *     each with their user_features and manager_job_titles attached
 */
export async function POST(request: Request) {
  try {
    const { company_id } = await request.json()
    if (!company_id) {
      return NextResponse.json({ error: 'company_id is required' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const { data: users, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('company_id', company_id)
      .eq('is_deleted', false)
      .order('created_at', { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    // Attach features + manager_titles to each user
    const enriched = await Promise.all(
      (users || []).map(async (u) => {
        const [{ data: features }, { data: titles }] = await Promise.all([
          supabase
            .from('user_features')
            .select('feature_id, is_enabled, can_view, can_edit, can_view_reports')
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
