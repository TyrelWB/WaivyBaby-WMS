import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { reserveOrderInventory } from '@/lib/inventory-utils'

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

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: adminUser } = await admin.from('admin_users').select('org_id, warehouse_id').eq('id', user.id).single()
  if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: integration } = await admin
    .from('integrations')
    .select('credentials')
    .eq('org_id', adminUser.org_id)
    .eq('provider', 'wix')
    .single()

  if (!integration?.credentials) {
    return NextResponse.json({ error: 'Wix not configured' }, { status: 400 })
  }

  const creds = integration.credentials as Record<string, any>
  const webhookSecret = (creds?.webhook_secret as string) || 'waivybaby2024'
  const apiKey = (creds?.api_key as string) || ''
  const siteId = (creds?.site_id as string) || ''

  const veloRes = await fetch(
    `https://www.waivybaby.com/_functions/getNewOrders?secret=${webhookSecret}`
  )

  if (!veloRes.ok) {
    const err = await veloRes.text()
    return NextResponse.json({ error: `Velo error (${veloRes.status}): ${err.slice(0, 200)}` }, { status: 400 })
  }

  const wixData = await veloRes.json()
  if (wixData.error) {
    return NextResponse.json({ error: `Velo error: ${wixData.error}` }, { status: 400 })
  }

  const wixOrders: any[] = wixData.orders || []
  let imported = 0
  let updated = 0
  let skipped = 0

  for (const veloOrder of wixOrders) {
    const wixOrderId = veloOrder._id || veloOrder.id
    if (!wixOrderId) { skipped++; continue }

    // Fetch full order from Wix REST API to get shipping + complete line items
    const fullOrder = apiKey && siteId
      ? (await fetchFullWixOrder(wixOrderId, apiKey, siteId)) || veloOrder
      : veloOrder

    const { customerName, customerEmail, contact, shipAddr } = parseOrderFields(fullOrder)
    const lineItems: any[] = fullOrder.lineItems || veloOrder.lineItems || []

    const { data: existing } = await admin
      .from('orders')
      .select('id, order_number, customer_name, shipping_address_1')
      .eq('org_id', adminUser.org_id)
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

      // Skip only if order is already complete
      if (hasItems && hasShipping && hasName) {
        skipped++
        continue
      }

      let addedItems = 0

      if (!hasItems) {
        for (const item of lineItems) {
          const sku = item.catalogReference?.externalReference || item.physicalProperties?.sku || ''
          if (!sku) continue
          const { data: product } = await admin.from('products').select('id').eq('org_id', adminUser.org_id).ilike('sku', sku).maybeSingle()
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

      // Always update customer name + shipping if we have it
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
        await reserveOrderInventory(existing.id, adminUser.org_id)
      }

      if (addedItems > 0 || Object.keys(updateFields).length > 0) {
        updated++
      } else {
        skipped++
      }
      continue
    }

    // New order
    const { data: order, error: orderError } = await admin.from('orders').insert({
      org_id: adminUser.org_id,
      warehouse_id: adminUser.warehouse_id,
      wix_order_id: wixOrderId,
      order_number: `WIX-${fullOrder.number || wixOrderId.slice(0, 8)}`,
      customer_name: customerName,
      customer_email: customerEmail,
      status: 'pending',
      is_rush: false,
      is_bulk: false,
      notes: `Wix #${fullOrder.number || wixOrderId}`,
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

    if (orderError || !order) { skipped++; continue }

    for (const item of lineItems) {
      const sku = item.catalogReference?.externalReference || item.physicalProperties?.sku || ''
      if (!sku) continue
      const { data: product } = await admin.from('products').select('id').eq('org_id', adminUser.org_id).ilike('sku', sku).maybeSingle()
      if (!product) continue
      await admin.from('order_items').insert({
        order_id: order.id,
        product_id: product.id,
        quantity_ordered: item.quantity || 1,
        quantity_picked: 0,
        status: 'pending',
      })
    }

    await reserveOrderInventory(order.id, adminUser.org_id)
    imported++
  }

  return NextResponse.json({ imported, updated, skipped, total: wixOrders.length })
}
