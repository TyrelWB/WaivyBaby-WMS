import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: adminUser } = await admin.from('admin_users').select('org_id').eq('id', user.id).single()
  if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const orgId = adminUser.org_id

  // Delete in dependency order to avoid FK violations
  await admin.from('scan_events').delete().eq('org_id', orgId)
  await admin.from('audit_log').delete().eq('org_id', orgId)
  await admin.from('exceptions').delete().eq('org_id', orgId)
  await admin.from('tasks').delete().eq('org_id', orgId)
  // box_items cascade from boxes, boxes cascade from orders
  await admin.from('orders').delete().eq('org_id', orgId)
  // receiving_items cascade from receiving
  await admin.from('receiving').delete().eq('org_id', orgId)
  // return_items cascade from returns
  await admin.from('returns').delete().eq('org_id', orgId)
  // cycle_count_items cascade from cycle_counts
  await admin.from('cycle_counts').delete().eq('org_id', orgId)
  await admin.from('inventory_adjustments').delete().eq('org_id', orgId)
  await admin.from('inventory').delete().eq('org_id', orgId)
  await admin.from('baskets').delete().eq('org_id', orgId)
  await admin.from('workers').delete().eq('org_id', orgId)
  // product_barcodes cascade from products
  await admin.from('products').delete().eq('org_id', orgId)
  await admin.from('suppliers').delete().eq('org_id', orgId)
  await admin.from('bins').delete().eq('org_id', orgId)
  await admin.from('zones').delete().eq('org_id', orgId)

  return NextResponse.json({ success: true })
}
