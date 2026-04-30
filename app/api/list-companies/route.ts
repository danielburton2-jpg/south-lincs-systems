import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

/**
 * GET /api/list-companies?q=<search>
 *
 * Returns all companies, optionally filtered by name search.
 * Service-role read (we want superusers to see everything regardless
 * of RLS).
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const q = (searchParams.get('q') || '').trim()

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    let query = supabase
      .from('companies')
      .select('id, name, is_active, start_date, end_date, override_end_date, created_at')
      .order('name', { ascending: true })

    if (q) {
      query = query.ilike('name', `%${q}%`)
    }

    const { data, error } = await query
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ companies: data || [] })
  } catch (err: any) {
    console.error('list-companies error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
