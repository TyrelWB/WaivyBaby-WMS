import { createAdminClient } from './supabase/admin'

const CARRIER_NAMES: Record<string, string> = {
  ups: 'UPS',
  fedex: 'FedEx',
  stamps_com: 'USPS',
  usps: 'USPS',
  dhl_express: 'DHL Express',
  canada_post: 'Canada Post',
}

export async function fulfillWixOrder(
  orderId: string,
  orgId: string
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const admin = createAdminClient()

  const { data: order } = await admin
    .from('orders')
    .select('wix_order_id, tracking_number, carrier')
    .eq('id', orderId)
    .single()

  if (!order?.wix_order_id) return { ok: false, skipped: true }
  if (!order.tracking_number) return { ok: false, error: 'No tracking number' }

  const { data: integration } = await admin
    .from('integrations')
    .select('credentials')
    .eq('org_id', orgId)
    .eq('provider', 'wix')
    .single()

  if (!integration?.credentials?.api_key || !integration?.credentials?.site_id) {
    return { ok: false, error: 'Wix not configured' }
  }

  const { api_key, site_id } = integration.credentials
  const headers = {
    'Authorization': api_key,
    'wix-site-id': site_id,
    'Content-Type': 'application/json',
  }

  const orderRes = await fetch(`https://www.wixapis.com/ecommerce/v1/orders/${order.wix_order_id}`, { headers })
  if (!orderRes.ok) {
    return { ok: false, error: `Wix order fetch failed (${orderRes.status})` }
  }

  const wixOrderData = await orderRes.json()
  const lineItems: any[] = (wixOrderData.order || wixOrderData).lineItems || []
  if (lineItems.length === 0) return { ok: false, error: 'No Wix line items' }

  const carrierName = CARRIER_NAMES[order.carrier?.toLowerCase() || ''] || order.carrier || 'Other'

  let status = 'success'
  let error: string | undefined

  try {
    const res = await fetch('https://www.wixapis.com/ecommerce/v1/fulfillments/createFulfillment', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        orderId: order.wix_order_id,
        fulfillment: {
          lineItems: lineItems.map((li: any) => ({ id: li.id, quantity: li.quantity })),
          trackingInfo: { trackingNumber: order.tracking_number, shippingProvider: carrierName, trackingLink: '' },
        },
      }),
    })
    if (!res.ok) {
      const err = await res.text()
      status = 'failed'
      error = `Wix fulfillment error (${res.status}): ${err.slice(0, 200)}`
    }
  } catch (e: any) {
    status = 'failed'
    error = e.message
  }

  await admin.from('sync_logs').insert({
    org_id: orgId,
    provider: 'wix',
    event_type: 'order_fulfill',
    status,
    reference_type: 'order',
    reference_id: order.wix_order_id,
    payload: { orderId, wixOrderId: order.wix_order_id, tracking: order.tracking_number },
    error: error || null,
  })

  return error ? { ok: false, error } : { ok: true }
}

export async function syncInventoryToWix(productId: string, orgId: string): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient()

  const [{ data: product }, { data: integration }, { data: inventory }] = await Promise.all([
    admin.from('products').select('wix_product_id, wix_inventory_item_id, wix_variant_id, sku').eq('id', productId).single(),
    admin.from('integrations').select('credentials').eq('org_id', orgId).eq('provider', 'wix').single(),
    admin.from('inventory').select('qty_on_hand, qty_reserved').eq('product_id', productId).single(),
  ])

  if (!product?.wix_inventory_item_id) {
    return { ok: false, error: 'Product not mapped to Wix — run Map Products first' }
  }

  if (!integration?.credentials?.api_key || !integration?.credentials?.site_id) {
    return { ok: false, error: 'Wix not configured' }
  }

  const { api_key, site_id } = integration.credentials
  const wixHeaders = {
    'Authorization': api_key,
    'wix-site-id': site_id,
    'Content-Type': 'application/json',
  }

  // If variant ID wasn't stored during mapping, fetch it now from the inventory item
  let variantId = product.wix_variant_id
  if (!variantId && product.wix_product_id) {
    // Fetch the Wix product directly — variants[0].id is the default variant ID
    const prodRes = await fetch(`https://www.wixapis.com/stores/v1/products/${product.wix_product_id}`, {
      headers: wixHeaders,
    })
    if (prodRes.ok) {
      const prodData = await prodRes.json()
      variantId = prodData.product?.variants?.[0]?.id || null
      if (variantId) {
        await admin.from('products').update({ wix_variant_id: variantId }).eq('id', productId)
      }
    }
  }

  if (!variantId) {
    return { ok: false, error: 'Could not find Wix variant ID — check product has a SKU in Wix' }
  }

  const availableQty = Math.max(0, inventory?.qty_on_hand || 0)
  const { webhook_secret } = integration.credentials

  // Call the Wix Velo HTTP function (has full backend inventory access)
  const veloUrl = `https://www.waivybaby.com/_functions/updateInventory`
  const payload = {
    secret: webhook_secret || 'waivybaby2024',
    inventoryItemId: product.wix_inventory_item_id,
    productId: product.wix_product_id,
    variantId,
    quantity: availableQty,
  }

  let status = 'success'
  let error: string | undefined
  let response: any = {}

  try {
    const res = await fetch(veloUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    response = await res.json().catch(() => ({}))
    if (!res.ok) {
      status = 'failed'
      error = `Velo function error (${res.status}): ${JSON.stringify(response).slice(0, 200)}`
    }
  } catch (e: any) {
    status = 'failed'
    error = e.message
  }

  await admin.from('sync_logs').insert({
    org_id: orgId,
    provider: 'wix',
    event_type: 'inventory_update',
    status,
    reference_type: 'product',
    reference_id: productId,
    payload: { productId, availableQty, sku: product.sku },
    response,
    error: error || null,
  })

  return error ? { ok: false, error } : { ok: true }
}

export async function syncAllInventoryToWix(orgId: string): Promise<{ synced: number; failed: number; errors: string[] }> {
  const admin = createAdminClient()

  const { data: products } = await admin
    .from('products')
    .select('id, sku, wix_inventory_item_id')
    .eq('org_id', orgId)
    .not('wix_inventory_item_id', 'is', null)

  if (!products || products.length === 0) return { synced: 0, failed: 0, errors: [] }

  let synced = 0
  let failed = 0
  const errors: string[] = []

  for (const product of products) {
    const result = await syncInventoryToWix(product.id, orgId)
    if (result.ok) {
      synced++
    } else {
      failed++
      errors.push(`${product.sku}: ${result.error}`)
    }
  }

  return { synced, failed, errors }
}
