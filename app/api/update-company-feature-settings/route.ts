import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'

/**
 * POST /api/update-company-feature-settings
 *
 * Body: { id, feature_slug, settings }
 *
 * Each feature owns specific company-level settings:
 *
 *   holidays:
 *     { holiday_year_start: 'YYYY-MM-DD', allow_half_days: bool, allow_early_finish: bool }
 *
 *   vehicle_checks:
 *     { vehicle_types: string[] }
 *
 *   schedules:    {} (no settings yet)
 *   services:     {} (no settings yet)
 *
 * The settings get written to the matching columns on the companies row.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { id, feature_slug, settings } = body

    if (!id || !feature_slug) {
      return NextResponse.json({ error: 'id and feature_slug required' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const updatePayload: any = {}

    switch (feature_slug) {
      case 'holidays':
        if ('holiday_year_start'  in (settings || {})) updatePayload.holiday_year_start  = settings.holiday_year_start || null
        if ('allow_half_days'     in (settings || {})) updatePayload.allow_half_days     = !!settings.allow_half_days
        if ('allow_early_finish'  in (settings || {})) updatePayload.allow_early_finish  = !!settings.allow_early_finish
        break
      case 'vehicle_checks':
        if (Array.isArray(settings?.vehicle_types)) {
          updatePayload.vehicle_types = settings.vehicle_types
            .map((s: any) => String(s || '').trim())
            .filter(Boolean)
        }
        break
      case 'schedules':
      case 'services':
        // No company-level settings yet
        break
      default:
        return NextResponse.json({ error: 'Unknown feature_slug' }, { status: 400 })
    }

    if (Object.keys(updatePayload).length === 0) {
      return NextResponse.json({ success: true, no_changes: true })
    }

    const { error } = await supabase
      .from('companies')
      .update(updatePayload)
      .eq('id', id)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    await logAudit({
      action: 'UPDATE_COMPANY_FEATURE_SETTINGS',
      entity: 'company',
      entity_id: id,
      details: { feature_slug, fields: Object.keys(updatePayload) },
      ip_address: request.headers.get('x-forwarded-for') || undefined,
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('update-company-feature-settings error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
