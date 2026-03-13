import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {

  try {

    const body = await req.json()

    const {
      firstName,
      lastName,
      email,
      phone,
      employeeNumber,
      role,
      jobTitle,
      password,
      status,
      companyId
    } = body

    if (!companyId) {
      return NextResponse.json({
        error: "Company ID missing"
      }, { status: 400 })
    }

    /*
      1️⃣ Create auth user
    */

    const { data: authUser, error: authError } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true
      })

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 })
    }

    const userId = authUser.user.id

    /*
      2️⃣ Insert company user
    */

    const { error: insertError } = await supabaseAdmin
      .from("company_users")
      .insert({
        id: userId,
        company_id: companyId,
        first_name: firstName,
        last_name: lastName,
        email: email,
        phone: phone,
        employee_number: employeeNumber,
        role: role,
        job_title: jobTitle,
        status: status
      })

    if (insertError) {
      return NextResponse.json({
        error: insertError.message
      }, { status: 400 })
    }

    return NextResponse.json({
      success: true
    })

  } catch (err: any) {

    return NextResponse.json({
      error: err.message
    }, { status: 500 })

  }

}