import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: adminUser } = await admin.from('admin_users').select('org_id').eq('id', user.id).single()
  if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await admin
    .from('sync_logs')
    .select('id, event_type, status, payload, response, error, created_at')
    .eq('org_id', adminUser.org_id)
    .eq('provider', 'wix')
    .eq('event_type', 'inventory_update')
    .order('created_at', { ascending: false })
    .limit(30)

  return NextResponse.json(data || [])
}
