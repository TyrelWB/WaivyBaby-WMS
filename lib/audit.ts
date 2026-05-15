import type { SupabaseClient } from '@supabase/supabase-js'

export async function writeAudit(
  supabase: SupabaseClient,
  params: {
    orgId: string
    workerId?: string | null
    action: string
    entityType: string
    entityId: string
    changes?: Record<string, unknown>
    note?: string
  }
) {
  try {
    await supabase.from('audit_log').insert({
      org_id: params.orgId,
      worker_id: params.workerId ?? null,
      action: params.action,
      entity_type: params.entityType,
      entity_id: params.entityId,
      changes: params.changes ?? null,
      note: params.note ?? null,
    })
  } catch {}
}
