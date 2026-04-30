import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

/**
 * GET /api/get-company?id=<uuid>
 *
 * Returns the company plus an array of enabled feature ids
 * (so the form can pre-tick the right boxes).
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const { data: company, error } = await supabase
      .from('companies')
      .select('*')
      .eq('id', id)
      .single()
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }

    const { data: cf } = await supabase
      .from('company_features')
      .select('feature_id, is_enabled')
      .eq('company_id', id)
    const enabled_feature_ids = (cf || [])
      .filter(r => r.is_enabled)
      .map(r => r.feature_id)

    return NextResponse.json({ company, enabled_feature_ids })
  } catch (err: any) {
    console.error('get-company error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
