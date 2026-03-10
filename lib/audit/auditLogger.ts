import { supabase } from "@/supabase/client"

export async function auditLog(
  userId:string,
  action:string,
  description:string
){

  console.log("AUDIT ATTEMPT:",userId,action)

  const { data, error } = await supabase
    .from("audit_logs")
    .insert([
      {
        user_id:userId,
        action:action,
        description:description
      }
    ])

  if(error){
    console.error("AUDIT ERROR:",error)
  } else {
    console.log("AUDIT SUCCESS:",data)
  }

}