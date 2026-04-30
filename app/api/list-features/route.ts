import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

/**
 * GET /api/list-features
 *
 * Returns all rows from the features catalogue.
 */
export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const { data, error } = await supabase
      .from('features')
      .select('id, slug, name, description, display_order')
      .order('display_order', { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ features: data || [] })
  } catch (err: any) {
    console.error('list-features error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
