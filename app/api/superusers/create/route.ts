import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {

  const body = await req.json();

  const { email, password, name } = body;

  /* CREATE AUTH USER */

  const { data:user, error:userError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });

  if (userError) {
    return NextResponse.json({ error: userError.message }, { status: 400 });
  }

  /* ADD TO SUPERUSERS TABLE */

  const { error:superError } = await supabase
    .from("superusers")
    .insert({
      id: user.user.id,
      email,
      name
    });

  if (superError) {
    return NextResponse.json({ error: superError.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });

}