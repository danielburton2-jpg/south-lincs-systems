import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function logAudit({
  user_id,
  user_email,
  user_role,
  action,
  entity,
  entity_id,
  details,
  ip_address,
}: {
  user_id?: string
  user_email?: string
  user_role?: string
  action: string
  entity?: string
  entity_id?: string
  details?: object
  ip_address?: string
}) {
  const { error } = await supabase.from('audit_logs').insert({
    user_id: user_id || null,
    user_email: user_email || null,
    user_role: user_role || null,
    action,
    entity: entity || null,
    entity_id: entity_id || null,
    details: details || null,
    ip_address: ip_address || null,
  })

  if (error) {
    console.error('Audit log error:', error.message)
  }
}