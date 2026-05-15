import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: adminUser } = await admin.from('admin_users').select('org_id').eq('id', user.id).single()
  if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orderId } = await req.json()
  if (!orderId) return NextResponse.json({ error: 'Missing orderId' }, { status: 400 })

  const { data: integration } = await admin
    .from('integrations')
    .select('credentials')
    .eq('org_id', adminUser.org_id)
    .eq('provider', 'shipstation')
    .single()

  if (!integration?.credentials?.api_key || !integration?.credentials?.api_secret) {
    return NextResponse.json({ error: 'ShipStation not configured' }, { status: 400 })
  }

  const api_key = integration.credentials.api_key.trim()
  const api_secret = integration.credentials.api_secret.trim()
  const auth = 'Basic ' + Buffer.from(`${api_key}:${api_secret}`).toString('base64')

  // Check if already pushed
  const { data: existing } = await admin
    .from('order_integrations')
    .select('external_id')
    .eq('order_id', orderId)
    .eq('provider', 'shipstation')
    .maybeSingle()

  if (existing?.external_id) {
    return NextResponse.json({ ok: true, already_pushed: true, external_id: existing.external_id })
  }

  // Load order + items
  const { data: order } = await admin
    .from('orders')
    .select('*, order_items(quantity_ordered, products(name, sku))')
    .eq('id', orderId)
    .eq('org_id', adminUser.org_id)
    .single()

  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  // Fetch warehouse ID from ShipStation
  const warehouseRes = await fetch('https://ssapi.shipstation.com/warehouses', {
    headers: { 'Authorization': auth },
  })
  let warehouseId: number | null = null
  if (warehouseRes.ok) {
    const warehouses = await warehouseRes.json()
    if (Array.isArray(warehouses) && warehouses.length > 0) {
      warehouseId = warehouses[0].warehouseId
    }
  }

  const address = {
    name: order.customer_name || 'Customer',
    street1: order.shipping_address_1 || ' ',
    city: order.shipping_city || ' ',
    state: order.shipping_state || 'CA',
    postalCode: order.shipping_zip || '00000',
    country: order.shipping_country || 'US',
  }

  const payload: Record<string, unknown> = {
    orderNumber: `WMS-${order.order_number}`,
    orderDate: new Date(order.created_at).toISOString().replace('Z', ''),
    orderStatus: 'awaiting_shipment',
    billTo: address,
    shipTo: address,
    items: (order.order_items || []).map((item: any) => ({
      sku: item.products?.sku || '',
      name: item.products?.name || 'Item',
      quantity: item.quantity_ordered,
      unitPrice: 0,
    })),
    internalNotes: `WMS Order #${order.order_number}${order.notes ? ' — ' + order.notes : ''}`,
    insuranceOptions: { insureShipment: false, insuredValue: 0 },
    ...(warehouseId ? { advancedOptions: { warehouseId } } : {}),
  }

  const body = JSON.stringify(payload)
  const ssRes = await fetch('https://ssapi.shipstation.com/orders/createorder', {
    method: 'POST',
    headers: {
      'Authorization': auth,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body).toString(),
    },
    body,
  })

  if (!ssRes.ok) {
    const errText = await ssRes.text()
    let detail = errText.slice(0, 400) || 'unknown error'
    try { detail = JSON.stringify(JSON.parse(errText)) } catch {}
    return NextResponse.json({ error: `ShipStation error (${ssRes.status}): ${detail}` }, { status: 400 })
  }

  const ssOrder = await ssRes.json()

  await admin.from('order_integrations').insert({
    org_id: adminUser.org_id,
    order_id: orderId,
    provider: 'shipstation',
    external_id: String(ssOrder.orderId),
    external_order_number: ssOrder.orderNumber,
    external_data: { orderId: ssOrder.orderId, orderKey: ssOrder.orderKey },
    pushed_at: new Date().toISOString(),
  })

  return NextResponse.json({ ok: true, external_id: ssOrder.orderId, order_key: ssOrder.orderKey })
}
