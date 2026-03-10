import { supabase } from "@/supabase/client"

export async function auditLog(
  userId: string,
  action: string,
  description: string,
  tableName?: string,
  targetId?: string
) {

  const { error } = await supabase
    .from("audit_logs")
    .insert([
      {
        user_id: userId,
        action: action,
        description: description,
        table_name: tableName || null,
        target_id: targetId || null
      }
    ])

  if (error) {
    console.error("AUDIT ERROR:", error)
  }

}