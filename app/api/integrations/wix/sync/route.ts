import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: adminUser } = await admin.from('admin_users').select('org_id, warehouse_id').eq('id', user.id).single()
  if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: integration } = await admin
    .from('integrations')
    .select('credentials, last_synced_at')
    .eq('org_id', adminUser.org_id)
    .eq('provider', 'wix')
    .single()

  if (!integration?.credentials?.api_key || !integration?.credentials?.site_id) {
    return NextResponse.json({ error: 'Wix not configured' }, { status: 400 })
  }

  const { api_key, site_id } = integration.credentials

  const wixRes = await fetch('https://www.wixapis.com/ecommerce/v1/orders/query', {
    method: 'POST',
    headers: {
      'Authorization': api_key,
      'wix-site-id': site_id,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: {
        filter: { paymentStatus: { $eq: 'PAID' }, fulfillmentStatus: { $eq: 'NOT_FULFILLED' } },
        sort: [{ fieldName: 'createdDate', order: 'DESC' }],
        paging: { limit: 100 },
      }
    }),
  })

  if (!wixRes.ok) {
    const err = await wixRes.text()
    return NextResponse.json({ error: `Wix API error (${wixRes.status}): ${err.slice(0, 300)}` }, { status: 400 })
  }

  const wixData = await wixRes.json()
  const wixOrders: any[] = wixData.orders || []

  let imported = 0
  let skipped = 0

  for (const wixOrder of wixOrders) {
    const orderNumber = `WIX-${wixOrder.number}`

    // Deduplicate by order_number
    const { data: existing } = await admin
      .from('orders')
      .select('id')
      .eq('org_id', adminUser.org_id)
      .eq('order_number', orderNumber)
      .maybeSingle()

    if (existing) { skipped++; continue }

    const contact = wixOrder.buyerInfo?.contactDetails
    const customerName = [contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || null
    const customerEmail = wixOrder.buyerInfo?.email || null

    const shipAddr = wixOrder.shippingInfo?.logistics?.shippingAddress || wixOrder.shippingInfo?.logistics?.deliverToAddress || null

    const { data: order, error: orderError } = await admin.from('orders').insert({
      org_id: adminUser.org_id,
      warehouse_id: adminUser.warehouse_id,
      order_number: orderNumber,
      customer_name: customerName,
      customer_email: customerEmail,
      status: 'pending',
      is_rush: false,
      is_bulk: false,
      notes: `Imported from Wix · ${wixOrder.id}`,
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
    }).select('id').single()

    if (orderError || !order) { skipped++; continue }

    const lineItems: any[] = wixOrder.lineItems || []
    for (const item of lineItems) {
      const sku = item.catalogReference?.externalReference || item.physicalProperties?.sku || ''
      if (!sku) continue

      const { data: product } = await admin
        .from('products')
        .select('id')
        .eq('org_id', adminUser.org_id)
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

    imported++
  }

  await admin.from('integrations').update({
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('org_id', adminUser.org_id).eq('provider', 'wix')

  return NextResponse.json({ imported, skipped, total: wixOrders.length })
}
