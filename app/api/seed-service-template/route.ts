/**
 * POST /api/seed-service-template
 *
 * Creates a starter template with common DVSA-style items so a company
 * can get going without typing everything in. Currently seeds a
 * "6-Weekly Safety Inspection" with a sensible default item set
 * matching DVSA Guide to Maintaining Roadworthiness areas.
 *
 * Body: { company_id, vehicle_type, service_type }
 */

import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const SAFETY_ITEMS = [
  // Driver's vision
  { category: 'Drivers Area', item_text: 'Mirrors, glass and visibility', answer_type: 'pass_fail' },
  { category: 'Drivers Area', item_text: 'Wipers and washers', answer_type: 'pass_fail' },
  { category: 'Drivers Area', item_text: 'Driver controls / dashboard / warning lamps', answer_type: 'pass_fail' },
  { category: 'Drivers Area', item_text: 'Horn', answer_type: 'pass_fail' },
  { category: 'Drivers Area', item_text: "Driver's seat & belt", answer_type: 'pass_fail' },
  { category: 'Drivers Area', item_text: 'Speedometer & tachograph operation', answer_type: 'pass_fail' },

  // Lights
  { category: 'Lights', item_text: 'Headlamps (dip & main beam)', answer_type: 'pass_fail' },
  { category: 'Lights', item_text: 'Side & tail lights', answer_type: 'pass_fail' },
  { category: 'Lights', item_text: 'Indicators & hazard warning', answer_type: 'pass_fail' },
  { category: 'Lights', item_text: 'Brake lights', answer_type: 'pass_fail' },
  { category: 'Lights', item_text: 'Number plate lamp', answer_type: 'pass_fail' },
  { category: 'Lights', item_text: 'Reflectors', answer_type: 'pass_fail' },

  // Steering
  { category: 'Steering', item_text: 'Steering wheel & column', answer_type: 'pass_fail' },
  { category: 'Steering', item_text: 'Power steering operation', answer_type: 'pass_fail' },
  { category: 'Steering', item_text: 'Steering linkages, joints and bushes', answer_type: 'pass_fail' },

  // Brakes
  { category: 'Brakes', item_text: 'Service brake operation & response', answer_type: 'pass_fail' },
  { category: 'Brakes', item_text: 'Parking brake operation', answer_type: 'pass_fail' },
  { category: 'Brakes', item_text: 'Air pressure build-up time', answer_type: 'pass_fail' },
  { category: 'Brakes', item_text: 'Air leakage tests', answer_type: 'pass_fail' },
  { category: 'Brakes', item_text: 'Brake pad / lining condition', answer_type: 'pass_fail' },
  { category: 'Brakes', item_text: 'Brake disc / drum condition', answer_type: 'pass_fail' },
  { category: 'Brakes', item_text: 'Front brake pad thickness', answer_type: 'number', unit: 'mm' },
  { category: 'Brakes', item_text: 'Rear brake pad thickness', answer_type: 'number', unit: 'mm' },

  // Suspension
  { category: 'Suspension', item_text: 'Springs & spring fittings', answer_type: 'pass_fail' },
  { category: 'Suspension', item_text: 'Shock absorbers', answer_type: 'pass_fail' },
  { category: 'Suspension', item_text: 'Air suspension system', answer_type: 'pass_fail' },
  { category: 'Suspension', item_text: 'Axles', answer_type: 'pass_fail' },

  // Tyres & wheels
  { category: 'Tyres & Wheels', item_text: 'Tyre condition & damage', answer_type: 'pass_fail' },
  { category: 'Tyres & Wheels', item_text: 'Tyre pressures', answer_type: 'pass_fail' },
  { category: 'Tyres & Wheels', item_text: 'Front nearside tyre tread depth', answer_type: 'number', unit: 'mm' },
  { category: 'Tyres & Wheels', item_text: 'Front offside tyre tread depth', answer_type: 'number', unit: 'mm' },
  { category: 'Tyres & Wheels', item_text: 'Rear nearside tyre tread depth', answer_type: 'number', unit: 'mm' },
  { category: 'Tyres & Wheels', item_text: 'Rear offside tyre tread depth', answer_type: 'number', unit: 'mm' },
  { category: 'Tyres & Wheels', item_text: 'Wheel security & nut condition', answer_type: 'pass_fail' },
  { category: 'Tyres & Wheels', item_text: 'Spare wheel & carrier (if fitted)', answer_type: 'pass_fail' },

  // Body
  { category: 'Body', item_text: 'Cab security & condition', answer_type: 'pass_fail' },
  { category: 'Body', item_text: 'Doors and door catches', answer_type: 'pass_fail' },
  { category: 'Body', item_text: 'Body, chassis & wings', answer_type: 'pass_fail' },
  { category: 'Body', item_text: 'Mudguards & spray suppression', answer_type: 'pass_fail' },
  { category: 'Body', item_text: 'Towing connection (if fitted)', answer_type: 'pass_fail' },
  { category: 'Body', item_text: 'Underrun protection', answer_type: 'pass_fail' },

  // Engine & exhaust
  { category: 'Engine', item_text: 'Engine mounts', answer_type: 'pass_fail' },
  { category: 'Engine', item_text: 'Exhaust system & emissions', answer_type: 'pass_fail' },
  { category: 'Engine', item_text: 'Fuel system (no leaks)', answer_type: 'pass_fail' },
  { category: 'Engine', item_text: 'Coolant level', answer_type: 'toggle', expected_answer: 'yes' },
  { category: 'Engine', item_text: 'Oil level OK', answer_type: 'toggle', expected_answer: 'yes' },
  { category: 'Engine', item_text: 'AdBlue level OK', answer_type: 'toggle', expected_answer: 'yes' },

  // Documentation
  { category: 'Documentation', item_text: 'O-Licence disc displayed', answer_type: 'toggle', expected_answer: 'yes' },
  { category: 'Documentation', item_text: 'Tax / VED in date', answer_type: 'toggle', expected_answer: 'yes' },
  { category: 'Documentation', item_text: 'MOT in date', answer_type: 'toggle', expected_answer: 'yes' },
  { category: 'Documentation', item_text: 'Insurance certificate displayed', answer_type: 'toggle', expected_answer: 'yes' },

  // Mechanic notes
  { category: 'Notes', item_text: 'Defects rectified during inspection', answer_type: 'text' },
  { category: 'Notes', item_text: 'Recommended works for next visit', answer_type: 'text' },
]

export async function POST(request: Request) {
  try {
    const { company_id, vehicle_type, service_type } = await request.json()
    if (!company_id || !vehicle_type || !service_type) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Build template name based on service type
    const namesByType: Record<string, string> = {
      safety_inspection: '6-Weekly Safety Inspection (DVSA-style)',
      mot_prep:          'MOT Preparation Check',
      full_service:      'Full Service',
      tacho:             'Tacho Calibration',
      loler:             'LOLER Inspection',
      tax:               'Tax (VED) Check',
      custom:            'Custom Template',
    }
    const templateName = namesByType[service_type] || 'Service Template'

    // Create the template
    const { data: tmpl, error: tErr } = await supabase
      .from('service_templates')
      .insert({
        company_id,
        vehicle_type,
        service_type,
        name: templateName,
        description: 'Starter template - feel free to edit, add or remove items',
        active: true,
      })
      .select().single()

    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 400 })

    // Only seed item content for safety inspections (others are blank-but-ready)
    const items = service_type === 'safety_inspection' ? SAFETY_ITEMS : []

    if (items.length > 0) {
      const rows = items.map((it: any, idx: number) => ({
        template_id: tmpl.id,
        category: it.category,
        item_text: it.item_text,
        answer_type: it.answer_type || 'pass_fail',
        expected_answer: it.expected_answer || null,
        unit: it.unit || null,
        display_order: (idx + 1) * 10,
        required: true,
      }))
      const { error: iErr } = await supabase.from('service_template_items').insert(rows)
      if (iErr) return NextResponse.json({ error: iErr.message }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      template_id: tmpl.id,
      template_name: tmpl.name,
      items_count: items.length,
    })
  } catch (err: any) {
    console.error('seed-service-template error:', err)
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 })
  }
}
