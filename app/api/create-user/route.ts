import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'

// Calculate pro-rata holiday entitlement
// Returns the days they should get from their start date until the next holiday year end
function calculateProRata(
  fullYearEntitlement: number,
  employmentStartDate: string,
  holidayYearStartDate: string | null
): number {
  if (!fullYearEntitlement || !employmentStartDate) return fullYearEntitlement || 0

  const startDate = new Date(employmentStartDate + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Use today as employment start if it's in the past (we're pro-rating from today onwards)
  const effectiveStart = startDate < today ? today : startDate

  // Determine the holiday year start month/day. Default to Jan 1 if not set.
  let yearStartMonth = 0 // January
  let yearStartDay = 1
  if (holidayYearStartDate) {
    const hys = new Date(holidayYearStartDate + 'T00:00:00')
    yearStartMonth = hys.getMonth()
    yearStartDay = hys.getDate()
  }

  // Find the NEXT holiday year start after the employment start date
  let yearEnd = new Date(effectiveStart.getFullYear(), yearStartMonth, yearStartDay)
  if (yearEnd <= effectiveStart) {
    yearEnd = new Date(effectiveStart.getFullYear() + 1, yearStartMonth, yearStartDay)
  }

  // Days remaining in the holiday year from effective start
  const msPerDay = 1000 * 60 * 60 * 24
  const daysRemaining = Math.ceil((yearEnd.getTime() - effectiveStart.getTime()) / msPerDay)

  // Total days in a holiday year (365 or 366)
  const yearStart = new Date(yearEnd.getFullYear() - 1, yearStartMonth, yearStartDay)
  const totalDays = Math.round((yearEnd.getTime() - yearStart.getTime()) / msPerDay)

  // Pro-rata calculation, rounded to nearest 0.5 day
  const proRated = (fullYearEntitlement * daysRemaining) / totalDays
  return Math.round(proRated * 2) / 2
}

export async function POST(request: Request) {
  try {
    const {
      email,
      password,
      full_name,
      role,
      company_id,
      job_title,
      employee_number,
      employment_start_date,
      holiday_entitlement,
      full_year_entitlement,
      working_days,
      // Accept both old and new parameter names for safety
      user_features,
      feature_ids,
      manager_titles,
      manager_job_titles,
      actor_id,
      actor_email,
      actor_role,
    } = await request.json()

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Look up the company's holiday year start so we can pro-rata
    let holidayYearStart: string | null = null
    if (company_id) {
      const { data: companyRow } = await supabase
        .from('companies')
        .select('holiday_year_start')
        .eq('id', company_id)
        .single()
      holidayYearStart = companyRow?.holiday_year_start || null
    }

    // Determine the holiday entitlement to save:
    // - If full_year_entitlement is given, pro-rata it from employment start
    // - Otherwise, use whatever holiday_entitlement was passed in (manual override)
    let finalEntitlement: number | null = holiday_entitlement ?? null
    if (full_year_entitlement && full_year_entitlement > 0 && employment_start_date) {
      finalEntitlement = calculateProRata(
        Number(full_year_entitlement),
        employment_start_date,
        holidayYearStart
      )
    }

    // Create auth user
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (error || !data.user) {
      await logAudit({
        user_id: actor_id,
        user_email: actor_email,
        user_role: actor_role,
        action: 'CREATE_USER_FAILED',
        entity: 'profile',
        details: { email, role, error: error?.message },
        ip_address: request.headers.get('x-forwarded-for') || undefined,
      })
      return NextResponse.json({ error: error?.message }, { status: 400 })
    }

    // Create profile
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: data.user.id,
        full_name,
        email,
        role,
        company_id: company_id || null,
        job_title: job_title || null,
        employee_number: employee_number || null,
        employment_start_date: employment_start_date || null,
        holiday_entitlement: finalEntitlement,
        full_year_entitlement: full_year_entitlement ?? null,
        working_days: working_days || null,
      })

    if (profileError) {
      // Try cleanup the auth user we just created
      await supabase.auth.admin.deleteUser(data.user.id).catch(() => {})
      return NextResponse.json({ error: profileError.message }, { status: 400 })
    }

    // Resolve which feature payload to use (support both names)
    const featuresList = user_features
      ? user_features.map((f: any) => ({
          user_id: data.user.id,
          feature_id: f.feature_id,
          is_enabled: f.is_enabled,
        }))
      : feature_ids
      ? feature_ids.map((id: string) => ({
          user_id: data.user.id,
          feature_id: id,
          is_enabled: true,
        }))
      : []

    if (featuresList.length > 0) {
      await supabase.from('user_features').insert(featuresList)
    }

    // Resolve manager titles (support both names)
    const titlesList: string[] =
      (Array.isArray(manager_titles) && manager_titles) ||
      (Array.isArray(manager_job_titles) && manager_job_titles) ||
      []

    if (role === 'manager' && titlesList.length > 0) {
      await supabase.from('manager_job_titles').insert(
        titlesList.map((title: string) => ({
          manager_id: data.user.id,
          job_title: title,
        }))
      )
    }

    await logAudit({
      user_id: actor_id,
      user_email: actor_email,
      user_role: actor_role,
      action: 'CREATE_USER',
      entity: 'profile',
      entity_id: data.user.id,
      details: {
        email,
        role,
        full_name,
        job_title,
        employee_number,
        company_id,
        holiday_entitlement: finalEntitlement,
        full_year_entitlement,
        employment_start_date,
        pro_rata_applied: !!(full_year_entitlement && employment_start_date),
      },
      ip_address: request.headers.get('x-forwarded-for') || undefined,
    })

    return NextResponse.json({
      success: true,
      pro_rata_entitlement: finalEntitlement,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 })
  }
}