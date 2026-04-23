import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const { company_id } = await request.json()

    if (!company_id) {
      return NextResponse.json({ error: 'company_id is required' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Get users
    const { data: users, error: usersError } = await supabase
      .from('profiles')
      .select('*')
      .eq('company_id', company_id)
      .eq('is_deleted', false)
      .order('created_at', { ascending: true })

    if (usersError) {
      console.error('Users error:', usersError)
      return NextResponse.json({ error: usersError.message }, { status: 400 })
    }

    // Get user features separately for each user
    const usersWithFeatures = await Promise.all(
      (users || []).map(async (user) => {
        const { data: userFeatures } = await supabase
          .from('user_features')
          .select('is_enabled, feature_id')
          .eq('user_id', user.id)

        return {
          ...user,
          user_features: userFeatures || [],
        }
      })
    )

    return NextResponse.json({ users: usersWithFeatures })
  } catch (err: any) {
    console.error('API error:', err)
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 })
  }
}