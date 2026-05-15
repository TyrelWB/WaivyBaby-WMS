import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { reserveOrderInventory } from '@/lib/inventory-utils'

export async function POST(req: Request) {
  const admin = createAdminClient()

  // Parse body
  let body: any
  try {
    const text = await req.text()
    body = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Wix sends { entityId, slug, data } where data is a JSON string
  let orderData: any
  try {
    orderData = typeof body.data === 'string' ? JSON.parse(body.data) : body
  } catch {
    orderData = body
  }

  const order = orderData.order || orderData
  const wixOrderId = order.id || body.entityId

  if (!wixOrderId) {
    return NextResponse.json({ error: 'No order ID in webhook' }, { status: 400 })
  }

  // Find org by webhook secret query param
  const url = new URL(req.url)
  const secret = url.searchParams.get('secret')

  const { data: integrations } = await admin
    .from('integrations')
    .select('org_id, credentials')
    .eq('provider', 'wix')

  if (!integrations || integrations.length === 0) {
    return NextResponse.json({ error: 'No Wix integration found' }, { status: 400 })
  }

  const integration = secret
    ? integrations.find(i => i.credentials?.webhook_secret === secret)
    : integrations[0]

  if (!integration) {
    return NextResponse.json({ error: 'Webhook secret invalid' }, { status: 401 })
  }

  const orgId = integration.org_id

  // Only process paid orders
  const paymentStatus = order.paymentStatus || order.payment_status || ''
  if (!['PAID', 'FULLY_PAID', 'NOT_APPLICABLE'].includes(paymentStatus)) {
    return NextResponse.json({ ok: true, skipped: true, reason: `Payment status: ${paymentStatus}` })
  }

  // Deduplicate
  const { data: existing } = await admin
    .from('orders')
    .select('id')
    .eq('org_id', orgId)
    .eq('wix_order_id', wixOrderId)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ ok: true, already_exists: true, order_id: existing.id })
  }

  // Get default warehouse
  const { data: adminUser } = await admin
    .from('admin_users')
    .select('warehouse_id')
    .eq('org_id', orgId)
    .limit(1)
    .single()

  // Parse customer
  const buyerInfo = order.buyerInfo || {}
  const contact = buyerInfo.contactDetails || {}
  const customerName = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || buyerInfo.email || null
  const customerEmail = buyerInfo.email || null

  // Parse shipping address
  const shipAddr = order.shippingInfo?.logistics?.shippingAddress
    || order.shippingInfo?.logistics?.deliverToAddress
    || null

  // Create WMS order
  const { data: newOrder, error: orderError } = await admin.from('orders').insert({
    org_id: orgId,
    warehouse_id: adminUser?.warehouse_id || null,
    order_number: `WIX-${order.number || wixOrderId.slice(0, 8)}`,
    customer_name: customerName,
    customer_email: customerEmail,
    status: 'pending',
    wix_order_id: wixOrderId,
    is_rush: false,
    is_bulk: false,
    notes: `Wix #${order.number || wixOrderId}`,
    ...(shipAddr ? {
      shipping_name: customerName,
      shipping_address_1: shipAddr.addressLine || shipAddr.addressLine1 || null,
      shipping_address_2: shipAddr.addressLine2 || null,
      shipping_city: shipAddr.city || null,
      shipping_state: shipAddr.subdivision || shipAddr.state || null,
      shipping_zip: shipAddr.postalCode || null,
      shipping_country: shipAddr.country || 'US',
      shipping_phone: contact.phone || null,
    } : {}),
  }).select('id, order_number').single()

  if (orderError || !newOrder) {
    await admin.from('sync_logs').insert({
      org_id: orgId,
      provider: 'wix',
      event_type: 'order_create',
      status: 'failed',
      reference_type: 'order',
      reference_id: wixOrderId,
      payload: { wixOrderId },
      error: orderError?.message || 'Failed to create order',
    })
    return NextResponse.json({ error: 'Failed to create order' }, { status: 500 })
  }

  // Add order items
  const lineItems: any[] = order.lineItems || []
  for (const item of lineItems) {
    const sku = item.catalogReference?.externalReference || item.physicalProperties?.sku || ''
    if (!sku) continue

    const { data: product } = await admin
      .from('products')
      .select('id')
      .eq('org_id', orgId)
      .ilike('sku', sku)
      .maybeSingle()

    if (!product) continue

    await admin.from('order_items').insert({
      order_id: newOrder.id,
      product_id: product.id,
      quantity_ordered: item.quantity || 1,
      quantity_picked: 0,
      status: 'pending',
    })
  }

  // Reserve inventory immediately
  const { ok: reserveOk, insufficient } = await reserveOrderInventory(newOrder.id, orgId)

  if (!reserveOk && insufficient) {
    await admin.from('exceptions').insert({
      org_id: orgId,
      order_id: newOrder.id,
      type: 'insufficient_stock',
      severity: 'hard',
      description: `Stock too low for ${newOrder.order_number}: ${insufficient.join(', ')}`,
      status: 'open',
    })
  }

  await admin.from('sync_logs').insert({
    org_id: orgId,
    provider: 'wix',
    event_type: 'order_create',
    status: 'success',
    reference_type: 'order',
    reference_id: wixOrderId,
    payload: { wixOrderId, orderNumber: newOrder.order_number },
    response: { orderId: newOrder.id, inventoryReserved: reserveOk },
  })

  return NextResponse.json({
    ok: true,
    order_id: newOrder.id,
    order_number: newOrder.order_number,
    inventory_reserved: reserveOk,
    ...(insufficient ? { stock_warnings: insufficient } : {}),
  })
}
