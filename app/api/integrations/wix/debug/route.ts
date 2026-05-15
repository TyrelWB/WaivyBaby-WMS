import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: adminUser } = await admin.from('admin_users').select('org_id').eq('id', user.id).single()
  if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: integration } = await admin
    .from('integrations')
    .select('credentials')
    .eq('org_id', adminUser.org_id)
    .eq('provider', 'wix')
    .single()

  const { api_key, site_id } = integration?.credentials || {}
  const headers = { 'Authorization': api_key, 'wix-site-id': site_id, 'Content-Type': 'application/json' }

  // Fetch first page of inventory items
  const invRes = await fetch('https://www.wixapis.com/stores/v1/inventoryItems/query', {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: { paging: { limit: 5, offset: 0 } } }),
  })
  const invRaw = await invRes.text()

  // Fetch first page of products
  const prodRes = await fetch('https://www.wixapis.com/stores/v1/products/query', {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: { paging: { limit: 3, offset: 0 } } }),
  })
  const prodRaw = await prodRes.text()

  // Test inventory update endpoints
  const invItemId = '20e63e08-f827-5d9a-bd07-172057db3391'
  const variantId = '00000000-0000-0000-0000-000000000000'
  const testPayload = JSON.stringify({ inventoryItemId: invItemId, variantQuantityInfos: [{ variantId, quantity: 99 }] })

  const productId = 'df19c1f7-07d8-a265-42f8-e8dfa824cc6e'
  const urlsToTest = [
    { label: 'product PATCH with variant stock', url: `https://www.wixapis.com/stores/v1/products/${productId}`, method: 'PATCH', body: JSON.stringify({ product: { variants: [{ id: variantId, stock: { trackQuantity: true, quantity: 99 } }] } }) },
    { label: 'product PATCH with stock quantity', url: `https://www.wixapis.com/stores/v1/products/${productId}`, method: 'PATCH', body: JSON.stringify({ product: { stock: { trackInventory: true, quantity: 99 } } }) },
    { label: 'updateVariantsData', url: `https://www.wixapis.com/stores/v1/products/${productId}/variants/updateVariantsData`, method: 'POST', body: JSON.stringify({ variants: [{ id: variantId, stock: { trackQuantity: true, quantity: 99 } }] }) },
    { label: 'variant PATCH', url: `https://www.wixapis.com/stores/v1/products/${productId}/variants/${variantId}`, method: 'PATCH', body: JSON.stringify({ variant: { stock: { quantity: 99 } } }) },
  ]
  const urlResults: Record<string, any> = {}
  for (const t of urlsToTest) {
    try {
      const r = await fetch(t.url, { method: t.method, headers, body: t.body })
      const raw = await r.text()
      let body: any = raw.slice(0, 150)
      try { body = JSON.parse(raw) } catch {}
      urlResults[t.label] = { status: r.status, body }
    } catch (e: any) {
      urlResults[t.label] = { error: e.message }
    }
  }

  // Fetch mapped product from DB
  const { data: mappedProduct } = await admin
    .from('products')
    .select('sku, wix_product_id, wix_variant_id, wix_inventory_item_id')
    .eq('org_id', adminUser.org_id)
    .not('wix_product_id', 'is', null)
    .limit(1)
    .maybeSingle()

  // Try fetching the individual inventory item for the mapped product
  let invItemResult: any = null
  if (mappedProduct?.wix_inventory_item_id) {
    const r = await fetch(`https://www.wixapis.com/stores/v1/inventoryItems/${mappedProduct.wix_inventory_item_id}`, { headers })
    const raw = await r.text()
    try { invItemResult = { status: r.status, body: JSON.parse(raw) } } catch { invItemResult = { status: r.status, body: raw.slice(0, 300) } }
  }

  // Also fetch the Wix product directly to see its inventoryItemId
  let wixProductDirect: any = null
  if (mappedProduct?.wix_product_id) {
    const r = await fetch(`https://www.wixapis.com/stores/v1/products/${mappedProduct.wix_product_id}`, { headers })
    const raw = await r.text()
    try {
      const parsed = JSON.parse(raw)
      wixProductDirect = { status: r.status, inventoryItemId: parsed.product?.inventoryItemId, stock: parsed.product?.stock, variants: parsed.product?.variants }
    } catch { wixProductDirect = { status: r.status } }
  }

  let invParsed: any = invRaw
  let prodParsed: any = { firstProductInventoryItemId: null }
  try { invParsed = { status: invRes.status } } catch {}
  try {
    const p = JSON.parse(prodRaw)
    prodParsed = { totalResults: p.totalResults, firstProductInventoryItemId: p.products?.[0]?.inventoryItemId }
  } catch {}

  return NextResponse.json({
    inventoryQueryStatus: invRes.status,
    urlTests: urlResults,
    mappedProduct,
    wixProductDirect,
  })
}
