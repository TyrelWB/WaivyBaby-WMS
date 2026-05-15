import { createAdminClient } from './supabase/admin'
import { reserveOrderInventory } from './inventory-utils'

export async function syncWixOrders(
  orgId: string,
  warehouseId: string | null
): Promise<{ imported: number; skipped: number; total: number; errors: string[] }> {
  const admin = createAdminClient()

  const { data: integration } = await admin
    .from('integrations')
    .select('credentials')
    .eq('org_id', orgId)
    .eq('provider', 'wix')
    .single()

  if (!integration?.credentials?.api_key || !integration?.credentials?.site_id) {
    return { imported: 0, skipped: 0, total: 0, errors: ['Wix not configured'] }
  }

  const { api_key, site_id } = integration.credentials
  const headers = {
    'Authorization': api_key,
    'wix-site-id': site_id,
    'Content-Type': 'application/json',
  }

  const wixRes = await fetch('https://www.wixapis.com/ecommerce/v1/orders/query', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query: {
        filter: JSON.stringify({ paymentStatus: 'PAID' }),
        sort: [{ fieldName: 'createdDate', order: 'DESC' }],
        paging: { limit: 50 },
      }
    }),
  })

  if (!wixRes.ok) {
    const err = await wixRes.text()
    return { imported: 0, skipped: 0, total: 0, errors: [`Wix API error (${wixRes.status}): ${err.slice(0, 200)}`] }
  }

  const wixData = await wixRes.json()
  const wixOrders: any[] = wixData.orders || []

  let imported = 0
  let skipped = 0
  const errors: string[] = []

  for (const wixOrder of wixOrders) {
    const wixOrderId = wixOrder.id
    if (!wixOrderId) { skipped++; continue }

    // Deduplicate by wix_order_id
    const { data: existing } = await admin
      .from('orders')
      .select('id')
      .eq('org_id', orgId)
      .eq('wix_order_id', wixOrderId)
      .maybeSingle()

    if (existing) { skipped++; continue }

    const contact = wixOrder.buyerInfo?.contactDetails
    const customerName = [contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || wixOrder.buyerInfo?.email || null
    const customerEmail = wixOrder.buyerInfo?.email || null
    const shipAddr = wixOrder.shippingInfo?.logistics?.shippingAddress || wixOrder.shippingInfo?.logistics?.deliverToAddress || null

    const { data: order, error: orderError } = await admin.from('orders').insert({
      org_id: orgId,
      warehouse_id: warehouseId,
      wix_order_id: wixOrderId,
      order_number: `WIX-${wixOrder.number || wixOrderId.slice(0, 8)}`,
      customer_name: customerName,
      customer_email: customerEmail,
      status: 'pending',
      is_rush: false,
      is_bulk: false,
      notes: `Wix #${wixOrder.number || wixOrderId}`,
      ...(shipAddr ? {
        shipping_name: customerName,
        shipping_address_1: shipAddr.addressLine || shipAddr.addressLine1 || null,
        shipping_address_2: shipAddr.addressLine2 || null,
        shipping_city: shipAddr.city || null,
        shipping_state: shipAddr.subdivision || shipAddr.state || null,
        shipping_zip: shipAddr.postalCode || null,
        shipping_country: shipAddr.country || 'US',
        shipping_phone: contact?.phone || null,
      } : {}),
    }).select('id, order_number').single()

    if (orderError || !order) {
      errors.push(`Failed to create order ${wixOrder.number}: ${orderError?.message}`)
      skipped++
      continue
    }

    // Add order items
    const lineItems: any[] = wixOrder.lineItems || []
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
        order_id: order.id,
        product_id: product.id,
        quantity_ordered: item.quantity || 1,
        quantity_picked: 0,
        status: 'pending',
      })
    }

    // Reserve inventory
    const { ok: reserveOk, insufficient } = await reserveOrderInventory(order.id, orgId)
    if (!reserveOk && insufficient) {
      await admin.from('exceptions').insert({
        org_id: orgId,
        order_id: order.id,
        type: 'insufficient_stock',
        severity: 'hard',
        description: `Stock too low for ${order.order_number}: ${insufficient.join(', ')}`,
        status: 'open',
      })
    }

    imported++
  }

  await admin.from('integrations').update({
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('org_id', orgId).eq('provider', 'wix')

  return { imported, skipped, total: wixOrders.length, errors }
}
