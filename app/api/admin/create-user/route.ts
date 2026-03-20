import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

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
      companyId
    } = body

    // CREATE AUTH USER
    const { data:authData, error:authError } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true
      })

    if(authError){
      return NextResponse.json({ error: authError.message }, { status: 400 })
    }

    const userId = authData.user.id

    // INSERT INTO company_users
    const { error:insertError } =
      await supabaseAdmin
        .from("company_users")
        .insert({
          id: userId,
          first_name: firstName,
          last_name: lastName,
          email,
          phone,
          employee_number: employeeNumber,
          role,
          job_title: jobTitle,
          status,
          company_id: companyId
        })

    if(insertError){
      return NextResponse.json({ error: insertError.message }, { status: 400 })
    }

    return NextResponse.json({ success: true })

  }catch(err:any){

    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    )

  }

}