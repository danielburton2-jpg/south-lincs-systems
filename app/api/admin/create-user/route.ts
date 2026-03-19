<<<<<<< HEAD
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

/* ADMIN CLIENT (SERVICE ROLE - SERVER ONLY) */
=======
import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
>>>>>>> d80cabaf8de6025d187f0b7eccf894f4bdbf9f43

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

<<<<<<< HEAD
export async function POST(req: Request){

  try{
=======
export async function POST(req: Request) {

  try {
>>>>>>> d80cabaf8de6025d187f0b7eccf894f4bdbf9f43

    const body = await req.json()

    const {
<<<<<<< HEAD
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
=======
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
>>>>>>> d80cabaf8de6025d187f0b7eccf894f4bdbf9f43
      await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true
      })

<<<<<<< HEAD
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
=======
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
>>>>>>> d80cabaf8de6025d187f0b7eccf894f4bdbf9f43

  }

}