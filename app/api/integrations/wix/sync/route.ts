import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { reserveOrderInventory } from '@/lib/inventory-utils'

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

  for (const wixOrder of wixOrders) {
    const wixOrderId = wixOrder._id || wixOrder.id
    if (!wixOrderId) { skipped++; continue }

    const { data: existing } = await admin
      .from('orders')
      .select('id, order_number')
      .eq('org_id', adminUser.org_id)
      .eq('wix_order_id', wixOrderId)
      .maybeSingle()

    if (existing) {
      // Check if existing order has items — if not, try to populate it
      const { data: existingItems } = await admin
        .from('order_items')
        .select('id')
        .eq('order_id', existing.id)
        .limit(1)

      if (existingItems && existingItems.length > 0) {
        skipped++
        continue
      }

      // Order exists but is empty — fill in items and reserve inventory
      const lineItems: any[] = wixOrder.lineItems || []
      let addedItems = 0
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

      // Also update shipping address if missing
      const contact = wixOrder.buyerInfo?.contactDetails
      const customerName = [contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || wixOrder.buyerInfo?.email || null
      const shipAddr = wixOrder.shippingInfo?.logistics?.shippingAddress || wixOrder.shippingInfo?.logistics?.deliverToAddress || null
      if (shipAddr) {
        await admin.from('orders').update({
          customer_name: customerName,
          customer_email: wixOrder.buyerInfo?.email || null,
          shipping_name: customerName,
          shipping_address_1: shipAddr.addressLine || shipAddr.addressLine1 || null,
          shipping_address_2: shipAddr.addressLine2 || null,
          shipping_city: shipAddr.city || null,
          shipping_state: shipAddr.subdivision || shipAddr.state || null,
          shipping_zip: shipAddr.postalCode || null,
          shipping_country: shipAddr.country || 'US',
          shipping_phone: contact?.phone || null,
        }).eq('id', existing.id)
      }

      if (addedItems > 0) {
        await reserveOrderInventory(existing.id, adminUser.org_id)
        updated++
      } else {
        skipped++
      }
      continue
    }

    const contact = wixOrder.buyerInfo?.contactDetails
    const customerName = [contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || wixOrder.buyerInfo?.email || null
    const customerEmail = wixOrder.buyerInfo?.email || null
    const shipAddr = wixOrder.shippingInfo?.logistics?.shippingAddress || wixOrder.shippingInfo?.logistics?.deliverToAddress || null

    const { data: order, error: orderError } = await admin.from('orders').insert({
      org_id: adminUser.org_id,
      warehouse_id: adminUser.warehouse_id,
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

    if (orderError || !order) { skipped++; continue }

    const lineItems: any[] = wixOrder.lineItems || []
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
