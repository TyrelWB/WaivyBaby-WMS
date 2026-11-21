import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Deletes every order (all statuses) and directly order-linked data, without
// touching products, inventory, workers, or warehouse configuration.
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: adminUser } = await admin.from('admin_users').select('org_id').eq('id', user.id).single()
  if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const orgId = adminUser.org_id

  // Delete in dependency order to avoid FK violations — order_items, boxes,
  // and box_items cascade automatically from orders.
  await admin.from('scan_events').delete().eq('org_id', orgId)
  await admin.from('audit_log').delete().eq('org_id', orgId)
  await admin.from('exceptions').delete().eq('org_id', orgId)
  const { error, count } = await admin.from('orders').delete({ count: 'exact' }).eq('org_id', orgId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ deleted: count ?? 0 })
}
