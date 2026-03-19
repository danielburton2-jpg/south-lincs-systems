import { supabase } from "@/supabase/client"

export async function auditLog({
  action,
  table,
  description = "",
  companyId = null,
  targetId = null,
  fieldName = null,
  oldValue = null,
  newValue = null
}: any){

  try{

    /* GET SESSION */

    const { data:session } =
      await supabase.auth.getSession()

    const userId =
      session?.session?.user?.id || null

    /* GET IP ADDRESS (optional) */

    let ipAddress = null

    try{

      const res = await fetch("https://api.ipify.org?format=json")
      const data = await res.json()

      ipAddress = data.ip

    }catch{
      ipAddress = null
    }

    /* INSERT AUDIT RECORD */

    const { error } = await supabase
      .from("audit_logs")
      .insert({

        user_id: userId,

        action: action,

        description: description,

        table_name: table,

        field_name: fieldName,

        old_value: oldValue,

        new_value: newValue,

        company_id: companyId,

        target_id: targetId,

        ip_address: ipAddress

      })

    if(error){

      console.error("AUDIT ERROR:", error.message)

    }

  }
  catch(err){

    console.error("AUDIT LOGGER FAILURE:", err)

  }

}