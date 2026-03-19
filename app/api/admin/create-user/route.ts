import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

/* ADMIN CLIENT (SERVICE ROLE - SERVER ONLY) */

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request){

  try{

    const body = await req.json()

    const {
      first_name,
      last_name,
      email,
      password,
      role,
      company_id,
      phone,
      employee_number,
      job_title,
      status
    } = body

    /* VALIDATION */

    if(!email || !password){
      return NextResponse.json(
        { error: "Email and password required" },
        { status: 400 }
      )
    }

    if(!company_id){
      return NextResponse.json(
        { error: "Company ID missing" },
        { status: 400 }
      )
    }

    /* CREATE AUTH USER */

    const { data:authData, error:authError } =
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

    const userId = authData.user.id

    /* INSERT INTO COMPANY_USERS */

    const { error:dbError } = await supabaseAdmin
      .from("company_users")
      .insert({
        id: userId,
        email,
        first_name,
        last_name,
        company_id,
        role,

        phone,
        employee_number,
        job_title,
        status
      })

    if(dbError){

      /* CLEANUP AUTH USER IF DB FAILS */

      await supabaseAdmin.auth.admin.deleteUser(userId)

      return NextResponse.json(
        { error: dbError.message },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      userId
    })

  }
  catch(err:any){

    console.error("CREATE USER ERROR:", err)

    return NextResponse.json(
      { error: err.message || "Server error" },
      { status: 500 }
    )

  }

}