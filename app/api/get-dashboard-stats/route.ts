import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

/**
 * GET /api/get-dashboard-stats
 *
 * Returns counts and basic info for the admin/manager dashboard:
 *   • company           — basic company info + subscription dates
 *   • totalUsers        — count of users in this company (excluding deleted)
 *   • activeUsers       — totalUsers minus frozen
 *   • frozenUsers       — count of frozen users
 *   • managerTitles     — for managers, the job titles they oversee (empty array for admin)
 *
 * For managers, we filter user counts to only their team (people with
 * job titles that the manager oversees). Admins see the whole company.
 *
 * Auth via the user's session cookie — service role for the actual reads.
 */
export async function GET() {
  try {
    const cookieStore = await cookies()
    const ssr = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll() { /* no-op */ },
        },
      },
    )
    const { data: { user } } = await ssr.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const svc = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const { data: profile } = await svc
      .from('profiles')
      .select('id, role, company_id')
      .eq('id', user.id)
      .single()

    if (!profile || !profile.company_id) {
      return NextResponse.json({ error: 'No company assigned' }, { status: 400 })
    }
    if (profile.role !== 'admin' && profile.role !== 'manager') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get the company
    const { data: company } = await svc
      .from('companies')
      .select('id, name, is_active, start_date, end_date, override_end_date, subscription_length')
      .eq('id', profile.company_id)
      .single()

    // For managers: load the job titles they oversee
    let managerTitles: string[] = []
    if (profile.role === 'manager') {
      const { data: titles } = await svc
        .from('manager_job_titles')
        .select('job_title')
        .eq('manager_id', user.id)
      managerTitles = (titles || []).map(t => t.job_title)
    }

    // Get all (non-deleted) users for the company
    const { data: companyUsers } = await svc
      .from('profiles')
      .select('id, role, job_title, is_frozen')
      .eq('company_id', profile.company_id)
      .eq('is_deleted', false)

    // For admin: counts include all users
    // For manager: counts include only people they oversee (by job title)
    const visibleUsers = profile.role === 'admin'
      ? (companyUsers || [])
      : (companyUsers || []).filter(u =>
          u.job_title && managerTitles.includes(u.job_title)
        )

    const totalUsers   = visibleUsers.length
    const frozenUsers  = visibleUsers.filter(u => u.is_frozen).length
    const activeUsers  = totalUsers - frozenUsers

    return NextResponse.json({
      company,
      totalUsers,
      activeUsers,
      frozenUsers,
      managerTitles,
    })
  } catch (err: any) {
    console.error('get-dashboard-stats error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
