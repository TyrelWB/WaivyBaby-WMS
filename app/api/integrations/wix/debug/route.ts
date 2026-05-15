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

  const orgId = adminUser.org_id

  // Get WMS orders with item counts
  const { data: wmsOrders } = await admin
    .from('orders')
    .select('id, order_number, wix_order_id, status')
    .eq('org_id', orgId)
    .like('order_number', 'WIX-%')
    .order('order_number', { ascending: false })
    .limit(10)

  const wmsWithItems = await Promise.all((wmsOrders || []).map(async o => {
    const { count } = await admin.from('order_items').select('id', { count: 'exact', head: true }).eq('order_id', o.id)
    return { ...o, item_count: count }
  }))

  // Get Velo orders
  const { data: integration } = await admin.from('integrations').select('credentials').eq('org_id', orgId).eq('provider', 'wix').single()
  const creds = integration?.credentials as Record<string, any>
  const secret = creds?.webhook_secret || 'waivybaby2024'

  const veloRes = await fetch(`https://www.waivybaby.com/_functions/getNewOrders?secret=${secret}`)
  const veloData = await veloRes.json()
  const veloOrders: any[] = veloData?.orders || []

  // Check product SKU lookup
  const testSku = 'WMS-364215376135132'
  const { data: product } = await admin.from('products').select('id, sku, name').eq('org_id', orgId).ilike('sku', testSku).maybeSingle()

  // Cross-reference: for each Velo order, does WMS have it and does it have items?
  const crossRef = veloOrders.map((o: any) => {
    const wixId = o._id || o.id
    const wmsMatch = wmsWithItems.find(w => w.wix_order_id === wixId)
    return {
      wix_id: wixId,
      wix_number: o.number,
      lineItems: (o.lineItems || []).map((item: any) => ({
        sku_externalRef: item.catalogReference?.externalReference,
        sku_physical: item.physicalProperties?.sku,
        quantity: item.quantity,
      })),
      wms_found: !!wmsMatch,
      wms_order_number: wmsMatch?.order_number,
      wms_item_count: wmsMatch?.item_count ?? 'no match',
    }
  })

  return NextResponse.json({
    product_lookup: { sku: testSku, found: !!product, product },
    wms_orders: wmsWithItems,
    cross_reference: crossRef,
  })
}
