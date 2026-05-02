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
 *   • features — array of enabled features for this user, each with
 *                {feature_id, slug, name, description}
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

    // Feature loading depends on role.
    //
    // Drivers (role='user'):  only what their user_features row enables.
    //                         Per-user gating, the original design.
    //
    // Admins / managers:      every feature the COMPANY has enabled,
    //                         regardless of per-user flags. Reason —
    //                         when an admin uses the View Switcher to
    //                         go driving (do a walkround on a phone,
    //                         clock holiday on the go, etc.), they need
    //                         to actually be able to USE the app, not
    //                         see an empty grid because no one ticked
    //                         their user_features rows.
    let features: any[] = []
    if (profile.role === 'admin' || profile.role === 'manager') {
      // All features the company has enabled (joined to the catalogue)
      if (profile.company_id) {
        const { data: cfRows } = await svc
          .from('company_features')
          .select('feature_id, is_enabled, features (id, slug, name, description, display_order)')
          .eq('company_id', profile.company_id)
          .eq('is_enabled', true)

        features = (cfRows || [])
          .map((r: any) => r.features)
          .filter(Boolean)
          .sort((a: any, b: any) => (a.display_order ?? 0) - (b.display_order ?? 0))
      }
    } else {
      // Drivers — per-user gating
      const { data: ufRows } = await svc
        .from('user_features')
        .select('feature_id, is_enabled')
        .eq('user_id', user.id)
        .eq('is_enabled', true)

      const enabledFeatureIds = (ufRows || []).map(r => r.feature_id)

      if (enabledFeatureIds.length > 0) {
        const { data: fRows } = await svc
          .from('features')
          .select('id, slug, name, description, display_order')
          .in('id', enabledFeatureIds)
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
