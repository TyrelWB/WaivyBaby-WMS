import { createAdminClient } from './supabase/admin'
import sql from './db'

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

  if (!integration?.credentials) {
    return { ok: false, error: 'Wix not configured' }
  }

  const { webhook_secret, api_key, site_id } = integration.credentials
  const carrierName = CARRIER_NAMES[order.carrier?.toLowerCase() || ''] || order.carrier || 'Other'

  let status = 'success'
  let error: string | undefined

  try {
    const res = await fetch('https://www.waivybaby.com/_functions/fulfillOrder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: webhook_secret || 'waivybaby2024',
        orderId: order.wix_order_id,
        trackingNumber: order.tracking_number,
        carrier: carrierName,
        apiKey: api_key || '',
        siteId: site_id || '',
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      status = 'failed'
      error = `Velo fulfillment error (${res.status}): ${JSON.stringify(data).slice(0, 200)}`
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

async function calculateBundleAvailability(productId: string): Promise<number | null> {
  const components = await sql`
    SELECT sub_product_id, quantity FROM public.product_components WHERE product_id = ${productId}
  `
  if ((components as any[]).length === 0) return null

  let min = Infinity
  for (const c of components as any[]) {
    // Check if this component is itself a bundle (has its own sub-products)
    const subComponents = await sql`
      SELECT pc.quantity, COALESCE(i.qty_available, 0) AS qty_available
      FROM public.product_components pc
      LEFT JOIN public.inventory i ON i.product_id = pc.sub_product_id
      WHERE pc.product_id = ${c.sub_product_id}
    `
    let componentAvailable: number
    if ((subComponents as any[]).length > 0) {
      // Nested bundle (e.g. collection → product → sub-products)
      let subMin = Infinity
      for (const sc of subComponents as any[]) {
        const canMake = Math.floor(sc.qty_available / sc.quantity)
        if (canMake < subMin) subMin = canMake
      }
      componentAvailable = subMin === Infinity ? 0 : Math.max(0, subMin)
    } else {
      // Leaf component — read its own inventory
      const invRows = await sql`
        SELECT COALESCE(qty_available, 0) AS qty_available FROM public.inventory WHERE product_id = ${c.sub_product_id}
      `
      componentAvailable = (invRows as any[])[0]?.qty_available ?? 0
    }
    const canMake = Math.floor(componentAvailable / c.quantity)
    if (canMake < min) min = canMake
  }
  return min === Infinity ? 0 : Math.max(0, min)
}

async function refreshBundleInventory(productId: string, orgId: string): Promise<void> {
  const admin = createAdminClient()
  const bundleAvailable = await calculateBundleAvailability(productId)
  if (bundleAvailable === null) return

  const qty = Math.max(0, bundleAvailable)

  const { data: warehouseRow } = await admin.from('admin_users').select('warehouse_id').eq('org_id', orgId).limit(1).single()
  const warehouseId = warehouseRow?.warehouse_id || null

  await sql`
    WITH updated AS (
      UPDATE public.inventory SET
        qty_on_hand   = ${qty},
        qty_available = ${qty},
        updated_at    = NOW()
      WHERE product_id = ${productId}
      RETURNING id
    )
    INSERT INTO public.inventory (product_id, org_id, warehouse_id, qty_on_hand, qty_available, qty_reserved, qty_picked, qty_damaged)
    SELECT ${productId}, ${orgId}, ${warehouseId}, ${qty}, ${qty}, 0, 0, 0
    WHERE NOT EXISTS (SELECT 1 FROM updated)
  `

  syncInventoryToWix(productId, orgId).catch(() => {})
}

export async function syncBundlesUsingSubProduct(subProductId: string, orgId: string): Promise<void> {
  // Find direct parents (products that use this sub-product)
  const directParents = await sql`
    SELECT DISTINCT product_id FROM public.product_components WHERE sub_product_id = ${subProductId}
  `
  const parentIds = (directParents as any[]).map(r => r.product_id)

  // Also find grandparent collections (collections that use those products)
  const allIds = new Set<string>(parentIds)
  if (parentIds.length > 0) {
    const grandParents = await sql`
      SELECT DISTINCT product_id FROM public.product_components WHERE sub_product_id = ANY(${parentIds}::uuid[])
    `
    for (const gp of grandParents as any[]) allIds.add(gp.product_id)
  }

  for (const id of allIds) {
    refreshBundleInventory(id, orgId).catch(() => {})
  }
}

export async function syncInventoryToWix(productId: string, orgId: string, delta?: number): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient()

  const [{ data: product }, { data: integration }, { data: inventory }] = await Promise.all([
    admin.from('products').select('wix_product_id, wix_inventory_item_id, wix_variant_id, sku').eq('id', productId).single(),
    admin.from('integrations').select('credentials').eq('org_id', orgId).eq('provider', 'wix').single(),
    admin.from('inventory').select('qty_on_hand, qty_reserved').eq('product_id', productId).single(),
  ])

  if (!product?.wix_inventory_item_id) {
    return { ok: false, error: 'Product not mapped to Wix — run Map Products first' }
  }

  if (!product.wix_product_id) {
    return { ok: false, error: 'Product missing Wix product ID — re-run Map Products' }
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

  const bundleAvailable = await calculateBundleAvailability(productId)
  const availableQty = bundleAvailable !== null ? bundleAvailable : Math.max(0, inventory?.qty_on_hand || 0)

  // Call Wix Velo backend function with absolute quantity
  const wixUrl = `https://www.waivybaby.com/_functions/updateInventory`
  const wixPayload = {
    secret: integration.credentials.webhook_secret || 'waivybaby2024',
    productId: product.wix_product_id,
    variantId,
    quantity: availableQty,
  }

  let status = 'success'
  let error: string | undefined
  let response: any = {}

  try {
    const res = await fetch(wixUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(wixPayload),
    })
    response = await res.json().catch(() => ({}))
    if (!res.ok) {
      status = 'failed'
      error = `Velo error (${res.status}): ${JSON.stringify(response).slice(0, 300)}`
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
    payload: { productId, availableQty, sku: product.sku, inventoryItemId: product.wix_inventory_item_id, variantId, wixProductId: product.wix_product_id },
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
    .eq('is_sub_product', false)
    .not('wix_inventory_item_id', 'is', null)
    .not('wix_product_id', 'is', null)

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
