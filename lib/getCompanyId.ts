import { supabase } from "@/supabase/client"

export async function getCompanyId() {

  const { data: authData, error: authError } =
    await supabase.auth.getUser()

  if (authError || !authData?.user) {
    console.log("❌ No auth user")
    return null
  }

  const userId = authData.user.id

  const { data, error } = await supabase
    .from("company_users")
    .select("company_id")
    .eq("auth_user_id", userId)
    .single()

  if (error) {
    console.log("❌ Company lookup error:", error)
    return null
  }

  if (!data?.company_id) {
    console.log("❌ No company_id found")
    return null
  }

  return data.company_id
}