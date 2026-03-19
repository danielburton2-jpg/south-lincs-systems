import { supabase } from "@/supabase/client"

export const getUserFeatures = async (userId:string, companyId:string) => {

  const { data:userFeatures } = await supabase
    .from("user_features")
    .select("feature_key")
    .eq("user_id",userId)

  const { data:companyFeatures } = await supabase
    .from("company_features")
    .select("feature_key")
    .eq("company_id",companyId)
    .eq("enabled",true)

  const userSet = new Set(
    userFeatures?.map((f:any)=>f.feature_key)
  )

  const companySet = new Set(
    companyFeatures?.map((f:any)=>f.feature_key)
  )

  const enabled:any = {}

  companySet.forEach((key)=>{

    if(userSet.has(key)){
      enabled[key] = true
    }

  })

  return enabled

}