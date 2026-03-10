import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request){

  const body = await req.json();

  const { firstName, lastName, email, password } = body;



  const { data:authUser, error:authError } =
    await supabase.auth.admin.createUser({

      email,
      password,
      email_confirm:true

    });

  if(authError){
    return NextResponse.json({ error: authError.message }, { status:400 });
  }



  const { error:insertError } = await supabase
    .from("superusers")
    .insert({

      user_id: authUser.user.id,
      email,
      first_name:firstName,
      last_name:lastName

    });

  if(insertError){
    return NextResponse.json({ error: insertError.message }, { status:400 });
  }



  return NextResponse.json({ success:true });

}