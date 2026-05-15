import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncWixOrders } from '@/lib/wix-orders'

export async function GET(req: Request) {
  const secret = new URL(req.url).searchParams.get('secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data: integrations } = await admin
    .from('integrations')
    .select('org_id')
    .eq('provider', 'wix')

  if (!integrations || integrations.length === 0) {
    return NextResponse.json({ ok: true, message: 'No Wix integrations' })
  }

  const results = []
  for (const integration of integrations) {
    const { data: adminUser } = await admin
      .from('admin_users')
      .select('warehouse_id')
      .eq('org_id', integration.org_id)
      .limit(1)
      .single()

    const result = await syncWixOrders(integration.org_id, adminUser?.warehouse_id || null)
    results.push({ org_id: integration.org_id, ...result })
  }

  return NextResponse.json({ ok: true, results })
}
