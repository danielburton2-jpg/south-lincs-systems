import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

/* 🔥 ADMIN CLIENT (SERVICE ROLE) */

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request){

  try{

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
      companyId,

      /* 🔥 NEW FIELDS */
      holidayEnabled,
      holidayEntitlement

    } = body

    /* =========================
       VALIDATION
    ========================= */

    if(!email || !password){
      return NextResponse.json(
        { error: "Email and password required" },
        { status: 400 }
      )
    }

    if(!companyId){
      return NextResponse.json(
        { error: "Company ID missing" },
        { status: 400 }
      )
    }

    /* =========================
       CREATE AUTH USER
    ========================= */

    const { data: authData, error: authError } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true
      })

    if(authError){
      return NextResponse.json(
        { error: authError.message },
        { status: 400 }
      )
    }

    const authUserId = authData.user?.id

    if(!authUserId){
      return NextResponse.json(
        { error: "Failed to create auth user" },
        { status: 500 }
      )
    }

    /* =========================
       CREATE COMPANY USER
    ========================= */

    const { error: insertError } =
      await supabaseAdmin
        .from("company_users")
        .insert({
          first_name: firstName,
          last_name: lastName,
          email,
          phone,
          employee_number: employeeNumber,
          role,
          job_title: jobTitle,
          status,
          company_id: companyId,

          /* 🔥 CRITICAL LINK */
          auth_user_id: authUserId,

          /* 🔥 HOLIDAY */
          holiday_enabled: holidayEnabled || false,
          holiday_entitlement: holidayEnabled
            ? Number(holidayEntitlement || 0)
            : 0
        })

    if(insertError){
      return NextResponse.json(
        { error: insertError.message },
        { status: 400 }
      )
    }

    /* =========================
       SUCCESS
    ========================= */

    return NextResponse.json({
      success: true
    })

  }catch(err:any){

    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    )

  }

}