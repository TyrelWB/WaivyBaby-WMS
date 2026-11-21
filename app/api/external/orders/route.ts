import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { reserveOrderInventory } from '@/lib/inventory-utils'

function checkApiKey(req: NextRequest): boolean {
  const key = req.headers.get('x-api-key')
  return key === process.env.WMS_API_KEY
}

function orderNumberFor(externalOrderId: string) {
  return `LOV-${externalOrderId}`
}

// GET /api/external/orders?external_order_id=...&since=ISO8601
// Returns status/tracking for orders created via POST, so Lovable can poll for fulfillment updates.
export async function GET(req: NextRequest) {
  if (!checkApiKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data: org } = await admin.from('admin_users').select('org_id').limit(1).single()
  if (!org) return NextResponse.json({ error: 'No org found' }, { status: 500 })

  const { searchParams } = new URL(req.url)
  const externalOrderId = searchParams.get('external_order_id')
  const since = searchParams.get('since')

  let query = admin
    .from('orders')
    .select('order_number, status, tracking_number, carrier, shipped_at, updated_at')
    .eq('org_id', org.org_id)
    .like('order_number', 'LOV-%')
    .order('updated_at', { ascending: false })

  if (externalOrderId) query = query.eq('order_number', orderNumberFor(externalOrderId))
  if (since) query = query.gte('updated_at', since)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const result = (data || []).map(o => ({
    external_order_id: o.order_number.replace(/^LOV-/, ''),
    status: o.status,
    tracking_number: o.tracking_number,
    carrier: o.carrier,
    shipped_at: o.shipped_at,
    updated_at: o.updated_at,
  }))

  return NextResponse.json(result)
}

// POST /api/external/orders
// Body: { order_id, customer_name?, customer_email?, shipping_address?: { line1, line2, city, state, zip, country, phone }, items: [{ sku, quantity }] }
// Creates a WMS order and reserves inventory for it (same lifecycle as any other order — pick/pack/ship happens in the WMS, which deducts qty_on_hand at ship time).
export async function POST(req: NextRequest) {
  if (!checkApiKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  if (!body?.order_id || !Array.isArray(body?.items) || body.items.length === 0) {
    return NextResponse.json({ error: 'Missing order_id or items' }, { status: 400 })
  }

  const { order_id, customer_name, customer_email, shipping_address, items } = body
  const orderNumber = orderNumberFor(String(order_id))

  const admin = createAdminClient()
  const { data: org } = await admin.from('admin_users').select('org_id').limit(1).single()
  if (!org) return NextResponse.json({ error: 'No org found' }, { status: 500 })

  const { data: existing } = await admin
    .from('orders')
    .select('id, order_number')
    .eq('org_id', org.org_id)
    .eq('order_number', orderNumber)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ ok: true, already_exists: true, order_id: existing.id, order_number: existing.order_number })
  }

  const { data: adminUser } = await admin
    .from('admin_users')
    .select('warehouse_id')
    .eq('org_id', org.org_id)
    .limit(1)
    .single()

  const addr = shipping_address || {}

  const { data: newOrder, error: orderError } = await admin.from('orders').insert({
    org_id: org.org_id,
    warehouse_id: adminUser?.warehouse_id || null,
    order_number: orderNumber,
    customer_name: customer_name || null,
    customer_email: customer_email || null,
    status: 'pending',
    is_rush: false,
    is_bulk: false,
    notes: `Lovable #${order_id}`,
    shipping_name: customer_name || null,
    shipping_address_1: addr.line1 || null,
    shipping_address_2: addr.line2 || null,
    shipping_city: addr.city || null,
    shipping_state: addr.state || null,
    shipping_zip: addr.zip || null,
    shipping_country: addr.country || 'US',
    shipping_phone: addr.phone || null,
  }).select('id, order_number').single()

  if (orderError || !newOrder) {
    await admin.from('sync_logs').insert({
      org_id: org.org_id,
      provider: 'lovable',
      event_type: 'order_create',
      status: 'failed',
      reference_type: 'order',
      reference_id: String(order_id),
      payload: body,
      error: orderError?.message || 'Failed to create order',
    })
    return NextResponse.json({ error: 'Failed to create order' }, { status: 500 })
  }

  const unmatchedSkus: string[] = []
  for (const item of items) {
    const sku = item?.sku
    const qty = Number(item?.quantity) || 1
    if (!sku) continue

    const { data: product } = await admin
      .from('products')
      .select('id')
      .eq('org_id', org.org_id)
      .ilike('sku', sku)
      .maybeSingle()

    if (!product) { unmatchedSkus.push(sku); continue }

    await admin.from('order_items').insert({
      order_id: newOrder.id,
      product_id: product.id,
      quantity_ordered: qty,
      quantity_picked: 0,
      status: 'pending',
    })
  }

  const { ok: reserveOk, insufficient } = await reserveOrderInventory(newOrder.id, org.org_id)

  if (!reserveOk && insufficient) {
    await admin.from('exceptions').insert({
      org_id: org.org_id,
      order_id: newOrder.id,
      type: 'insufficient_stock',
      severity: 'hard',
      description: `Stock too low for ${newOrder.order_number}: ${insufficient.join(', ')}`,
      status: 'open',
    })
  }

  await admin.from('sync_logs').insert({
    org_id: org.org_id,
    provider: 'lovable',
    event_type: 'order_create',
    status: 'success',
    reference_type: 'order',
    reference_id: String(order_id),
    payload: { order_id, order_number: newOrder.order_number, items },
    response: { orderId: newOrder.id, inventoryReserved: reserveOk },
  })

  return NextResponse.json({
    ok: true,
    order_id: newOrder.id,
    order_number: newOrder.order_number,
    inventory_reserved: reserveOk,
    ...(insufficient ? { stock_warnings: insufficient } : {}),
    ...(unmatchedSkus.length ? { unmatched_skus: unmatchedSkus } : {}),
  })
}
