import { createAdminClient } from './supabase/admin'
import { reserveOrderInventory } from './inventory-utils'

async function fetchFullWixOrder(wixOrderId: string, apiKey: string, siteId: string): Promise<any | null> {
  try {
    const res = await fetch(`https://www.wixapis.com/ecommerce/v1/orders/${wixOrderId}`, {
      headers: { 'Authorization': apiKey, 'wix-site-id': siteId },
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.order || data
  } catch {
    return null
  }
}

function parseOrderFields(order: any) {
  const buyerInfo = order.buyerInfo || {}
  const destination = order.shippingInfo?.logistics?.shippingDestination || {}
  const shipAddr = destination.address || order.shippingInfo?.logistics?.shippingAddress || null
  const contact = destination.contactDetails || order.contactDetails || buyerInfo.contactDetails || {}
  const customerName = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || buyerInfo.email || null
  const customerEmail = buyerInfo.email || null
  return { customerName, customerEmail, contact, shipAddr }
}

export async function syncWixOrders(
  orgId: string,
  warehouseId: string | null
): Promise<{ imported: number; updated: number; skipped: number; total: number; errors: string[] }> {
  const admin = createAdminClient()

  const { data: integration } = await admin
    .from('integrations')
    .select('credentials')
    .eq('org_id', orgId)
    .eq('provider', 'wix')
    .single()

  if (!integration?.credentials) {
    return { imported: 0, updated: 0, skipped: 0, total: 0, errors: ['Wix not configured'] }
  }

  const creds = integration.credentials as Record<string, any>
  const apiKey = (creds?.api_key as string) || ''
  const siteId = (creds?.site_id as string) || ''

  if (!apiKey || !siteId) {
    return { imported: 0, updated: 0, skipped: 0, total: 0, errors: ['Wix API key or site ID missing'] }
  }

  const headers = { 'Authorization': apiKey, 'wix-site-id': siteId, 'Content-Type': 'application/json' }

  // Fetch paid orders from last 90 days via Wix eCommerce REST API
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const wixRes = await fetch('https://www.wixapis.com/ecommerce/v1/orders/search', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      search: {
        filter: { 'paymentStatus': { '$hasSome': ['PAID', 'FULLY_PAID', 'NOT_APPLICABLE'] } },
        sort: [{ fieldName: '_createdDate', order: 'DESC' }],
        paging: { limit: 100 },
      },
    }),
  })

  if (!wixRes.ok) {
    const err = await wixRes.text()
    return { imported: 0, updated: 0, skipped: 0, total: 0, errors: [`Wix API error (${wixRes.status}): ${err.slice(0, 200)}`] }
  }

  const wixData = await wixRes.json()
  const wixOrders: any[] = wixData.orders || []

  let imported = 0
  let updated = 0
  let skipped = 0
  const errors: string[] = []

  for (const veloOrder of wixOrders) {
    const wixOrderId = veloOrder._id || veloOrder.id
    if (!wixOrderId) { skipped++; continue }

    const { customerName, customerEmail, contact, shipAddr } = parseOrderFields(veloOrder)
    const lineItems: any[] = veloOrder.lineItems || []

    const { data: existing } = await admin
      .from('orders')
      .select('id, order_number, customer_name, shipping_address_1')
      .eq('org_id', orgId)
      .eq('wix_order_id', wixOrderId)
      .maybeSingle()

    if (existing) {
      const { data: existingItems } = await admin
        .from('order_items')
        .select('id')
        .eq('order_id', existing.id)
        .limit(1)

      const hasItems = existingItems && existingItems.length > 0
      const hasShipping = !!existing.shipping_address_1
      const hasName = !!existing.customer_name

      if (hasItems && hasShipping && hasName) {
        skipped++
        continue
      }

      let addedItems = 0

      if (!hasItems) {
        for (const item of lineItems) {
          const wixProductId = item.catalogReference?.catalogItemId || null
          const sku = item.catalogReference?.externalReference || item.physicalProperties?.sku || ''
          let product: { id: string } | null = null
          if (wixProductId) {
            const { data } = await admin.from('products').select('id').eq('org_id', orgId).eq('wix_product_id', wixProductId).maybeSingle()
            product = data
          }
          if (!product && sku) {
            const { data } = await admin.from('products').select('id').eq('org_id', orgId).ilike('sku', sku).maybeSingle()
            product = data
          }
          if (!product) continue
          await admin.from('order_items').insert({
            order_id: existing.id,
            product_id: product.id,
            quantity_ordered: item.quantity || 1,
            quantity_picked: 0,
            status: 'pending',
          })
          addedItems++
        }
      }

      const updateFields: Record<string, any> = {}
      const realName = [contact.firstName, contact.lastName].filter(Boolean).join(' ')
      if (realName && existing.customer_name !== realName) updateFields.customer_name = realName
      if (customerEmail) updateFields.customer_email = customerEmail
      if (!hasShipping && shipAddr) {
        updateFields.shipping_name = customerName
        updateFields.shipping_address_1 = shipAddr.addressLine || shipAddr.addressLine1 || null
        updateFields.shipping_address_2 = shipAddr.addressLine2 || null
        updateFields.shipping_city = shipAddr.city || null
        updateFields.shipping_state = shipAddr.subdivision || shipAddr.state || null
        updateFields.shipping_zip = shipAddr.postalCode || null
        updateFields.shipping_country = shipAddr.country || 'US'
        updateFields.shipping_phone = contact.phone || null
      }

      if (Object.keys(updateFields).length > 0) {
        await admin.from('orders').update(updateFields).eq('id', existing.id)
      }

      if (addedItems > 0) {
        const { ok: reserveOk, insufficient } = await reserveOrderInventory(existing.id, orgId)
        if (!reserveOk && insufficient) {
          await admin.from('exceptions').insert({
            org_id: orgId,
            order_id: existing.id,
            type: 'insufficient_stock',
            severity: 'hard',
            description: `Stock too low for ${existing.order_number}: ${insufficient.join(', ')}`,
            status: 'open',
          })
        }
      }

      if (addedItems > 0 || Object.keys(updateFields).length > 0) {
        updated++
      } else {
        skipped++
      }
      continue
    }

    const { data: order, error: orderError } = await admin.from('orders').insert({
      org_id: orgId,
      warehouse_id: warehouseId,
      wix_order_id: wixOrderId,
      order_number: `WIX-${veloOrder.number || wixOrderId.slice(0, 8)}`,
      customer_name: customerName,
      customer_email: customerEmail,
      status: 'pending',
      is_rush: false,
      is_bulk: false,
      notes: `Wix #${veloOrder.number || wixOrderId}`,
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

    if (orderError || !order) {
      errors.push(`Failed to create order ${veloOrder.number}: ${orderError?.message}`)
      skipped++
      continue
    }

    for (const item of lineItems) {
      const wixProductId = item.catalogReference?.catalogItemId || null
      const sku = item.catalogReference?.externalReference || item.physicalProperties?.sku || ''
      let product: { id: string } | null = null
      if (wixProductId) {
        const { data } = await admin.from('products').select('id').eq('org_id', orgId).eq('wix_product_id', wixProductId).maybeSingle()
        product = data
      }
      if (!product && sku) {
        const { data } = await admin.from('products').select('id').eq('org_id', orgId).ilike('sku', sku).maybeSingle()
        product = data
      }
      if (!product) continue
      await admin.from('order_items').insert({
        order_id: order.id,
        product_id: product.id,
        quantity_ordered: item.quantity || 1,
        quantity_picked: 0,
        status: 'pending',
      })
    }

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

  return { imported, updated, skipped, total: wixOrders.length, errors }
}
