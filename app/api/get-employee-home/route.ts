import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

/**
 * GET /api/get-employee-home
 *
 * Returns everything the employee home page needs in one call:
 *   • profile  — id, full_name, email, role, job_title, holiday_entitlement
 *   • company  — id, name, end_date, override_end_date (for expiry warning)
 *   • features — enabled features the user has access to.
 *                Access = can_view OR can_edit (or admin role).
 *                Each feature: {id, slug, name, description}
 *
 * Auth via the user's session cookie. Reads via service role.
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
      .select('id, full_name, email, role, job_title, company_id, holiday_entitlement')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    let company: any = null
    if (profile.company_id) {
      const { data: c } = await svc
        .from('companies')
        .select('id, name, end_date, override_end_date')
        .eq('id', profile.company_id)
        .single()
      company = c
    }

    let features: any[] = []

    if (profile.role === 'admin') {
      // Admin: every feature the company has enabled
      const { data: companyFeatures } = await svc
        .from('company_features')
        .select('feature_id, is_enabled')
        .eq('company_id', profile.company_id)
        .eq('is_enabled', true)
      const ids = (companyFeatures || []).map((c: any) => c.feature_id)
      if (ids.length > 0) {
        const { data: fRows } = await svc
          .from('features')
          .select('id, slug, name, description, display_order')
          .in('id', ids)
          .order('display_order', { ascending: true })
        features = fRows || []
      }
    } else {
      // Non-admin: features where user_features.can_view OR can_edit is true.
      // (is_enabled is also relevant for backward compatibility — if can_view
      //  is null but is_enabled is true, count it as access. The form now
      //  always sets these in sync but old data might exist.)
      const { data: ufRows } = await svc
        .from('user_features')
        .select('feature_id, is_enabled, can_view, can_edit')
        .eq('user_id', user.id)
      const accessibleIds = (ufRows || [])
        .filter((r: any) => r.can_view || r.can_edit || r.is_enabled)
        .map((r: any) => r.feature_id)
      if (accessibleIds.length > 0) {
        const { data: fRows } = await svc
          .from('features')
          .select('id, slug, name, description, display_order')
          .in('id', accessibleIds)
          .order('display_order', { ascending: true })
        features = fRows || []
      }
    }

    return NextResponse.json({ profile, company, features })
  } catch (err: any) {
    console.error('get-employee-home error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
