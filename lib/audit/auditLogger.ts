import { supabase } from "@/supabase/client";

type AuditPayload = {
  userId: string | null;
  action: string;
  description: string;
};

export async function auditLog({ userId, action, description }: AuditPayload) {
  try {
    await supabase.from("audit_log").insert([
      {
        user_id: userId,
        action,
        description,
        created_at: new Date().toISOString(),
      },
    ]);
  } catch (err) {
    console.error("Audit log failed:", err);
  }
}