import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fulfillWixOrder } from '@/lib/wix-inventory'

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: adminUser } = await admin.from('admin_users').select('org_id').eq('id', user.id).single()
  if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orderId, carrierCode, serviceCode } = await req.json()
  if (!orderId || !carrierCode || !serviceCode) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

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

  const { data: order } = await admin
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .eq('org_id', adminUser.org_id)
    .single()

  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  // Get warehouse ship-from address
  const warehouseRes = await fetch('https://ssapi.shipstation.com/warehouses', {
    headers: { 'Authorization': auth },
  })
  let shipFrom: Record<string, unknown> = { name: 'Warehouse', street1: ' ', city: ' ', state: 'CA', postalCode: '00000', country: 'US' }
  if (warehouseRes.ok) {
    const warehouses = await warehouseRes.json()
    if (Array.isArray(warehouses) && warehouses.length > 0) {
      const wh = warehouses[0]
      const addr = wh.originAddress || {}
      shipFrom = {
        name: wh.warehouseName || 'Warehouse',
        street1: addr.street1 || ' ',
        street2: addr.street2 || null,
        city: addr.city || ' ',
        state: addr.state || 'CA',
        postalCode: addr.postalCode || '00000',
        country: addr.country || 'US',
        phone: addr.phone || null,
      }
    }
  }

  const payload = {
    carrierCode,
    serviceCode,
    packageCode: 'package',
    confirmation: 'none',
    shipDate: new Date().toISOString().split('T')[0],
    weight: { value: order.weight_oz || 16, units: 'ounces' },
    shipFrom,
    shipTo: {
      name: order.shipping_name || order.customer_name || 'Customer',
      street1: order.shipping_address_1 || ' ',
      street2: order.shipping_address_2 || null,
      city: order.shipping_city || ' ',
      state: order.shipping_state || 'CA',
      postalCode: order.shipping_zip || '00000',
      country: order.shipping_country || 'US',
      phone: order.shipping_phone || null,
    },
    insuranceOptions: { insureShipment: false, insuredValue: 0 },
    testLabel: false,
  }

  const body = JSON.stringify(payload)
  const labelRes = await fetch('https://ssapi.shipstation.com/shipments/createlabel', {
    method: 'POST',
    headers: {
      'Authorization': auth,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body).toString(),
    },
    body,
  })

  if (!labelRes.ok) {
    const err = await labelRes.text()
    let detail = err.slice(0, 400) || 'unknown error'
    try { detail = JSON.stringify(JSON.parse(err)) } catch {}
    return NextResponse.json({ error: `ShipStation error (${labelRes.status}): ${detail}` }, { status: 400 })
  }

  const labelData = await labelRes.json()
  const { trackingNumber, labelUrl, shipmentCost } = labelData

  await admin.from('orders').update({
    tracking_number: trackingNumber,
    carrier: carrierCode,
    status: 'shipping',
  }).eq('id', orderId)

  await admin.from('order_integrations').upsert({
    org_id: adminUser.org_id,
    order_id: orderId,
    provider: 'shipstation',
    tracking_number: trackingNumber,
    carrier: carrierCode,
    label_url: labelUrl,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'order_id,provider' })

  // Fire-and-forget: mark Wix order fulfilled so customer gets tracking email
  fulfillWixOrder(orderId, adminUser.org_id).catch(() => {})

  return NextResponse.json({ tracking: trackingNumber, labelUrl, cost: shipmentCost, carrier: carrierCode, service: serviceCode })
}
