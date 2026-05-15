import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(req: Request) {
  const secret = new URL(req.url).searchParams.get('secret')
  if (secret !== process.env.WMS_CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  const { data: integrations } = await admin.from('integrations').select('org_id, credentials').eq('provider', 'wix')
  if (!integrations || integrations.length === 0) return NextResponse.json({ error: 'No Wix integration' })

  const integration = integrations[0]
  const orgId = integration.org_id
  const creds = integration.credentials as Record<string, any>
  const veloSecret = creds?.webhook_secret || 'waivybaby2024'

  const { data: wmsOrders } = await admin
    .from('orders')
    .select('id, order_number, wix_order_id, customer_name, shipping_address_1, status')
    .eq('org_id', orgId)
    .like('order_number', 'WIX-%')
    .order('order_number', { ascending: false })
    .limit(10)

  const wmsWithItems = await Promise.all((wmsOrders || []).map(async o => {
    const { count } = await admin.from('order_items').select('id', { count: 'exact', head: true }).eq('order_id', o.id)
    return { ...o, item_count: count }
  }))

  const veloRes = await fetch(`https://www.waivybaby.com/_functions/getNewOrders?secret=${veloSecret}`)
  const veloData = await veloRes.json()
  const veloOrders: any[] = veloData?.orders || []

  const testOrderId = veloOrders[0]?._id || veloOrders[0]?.id
  let restApiSample: any = null
  if (testOrderId && creds?.api_key && creds?.site_id) {
    try {
      const r = await fetch(`https://www.wixapis.com/ecommerce/v1/orders/${testOrderId}`, {
        headers: { 'Authorization': creds.api_key, 'wix-site-id': creds.site_id },
      })
      const d = await r.json()
      const o = d.order || d
      restApiSample = {
        http_status: r.status,
        _id: o._id,
        number: o.number,
        buyerInfo: o.buyerInfo,
        shippingInfo: o.shippingInfo,
        lineItemsCount: (o.lineItems || []).length,
      }
    } catch (e: any) {
      restApiSample = { error: e.message }
    }
  }

  return NextResponse.json({ wms_orders: wmsWithItems, rest_api_sample: restApiSample })
}
