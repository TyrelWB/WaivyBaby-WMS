import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST() {
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

  if (!integration?.credentials?.api_key || !integration?.credentials?.site_id) {
    return NextResponse.json({ error: 'Wix not configured' }, { status: 400 })
  }

  const { api_key, site_id } = integration.credentials
  const headers = {
    'Authorization': api_key,
    'wix-site-id': site_id,
    'Content-Type': 'application/json',
  }

  const { data: wmsProducts } = await admin
    .from('products')
    .select('id, sku')
    .eq('org_id', adminUser.org_id)

  if (!wmsProducts || wmsProducts.length === 0) {
    return NextResponse.json({ error: 'No products in WMS' }, { status: 400 })
  }

  const skuToId = new Map(wmsProducts.map(p => [p.sku.toLowerCase().trim(), p.id]))

  // Fetch all Wix products (paginated)
  const allWixProducts: any[] = []
  let offset = 0
  while (true) {
    const res = await fetch('https://www.wixapis.com/stores/v1/products/query', {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: { paging: { limit: 100, offset } } }),
    })
    if (!res.ok) break
    const data = await res.json()
    const products = data.products || []
    allWixProducts.push(...products)
    if (products.length < 100) break
    offset += 100
  }

  if (allWixProducts.length === 0) {
    return NextResponse.json({ error: 'No products found in Wix' }, { status: 400 })
  }

  let mapped = 0
  let skipped = 0

  for (const wixProduct of allWixProducts) {
    // inventoryItemId and variant[0].id come directly from the product response
    const invItemId: string | null = wixProduct.inventoryItemId || null
    // Non-variant products use "00000000-0000-0000-0000-000000000000" as the default variant ID
    const variantId: string | null = wixProduct.variants?.[0]?.id || null

    const variants: any[] = wixProduct.variants || []
    let matched = false

    // Try to match by variant SKU
    for (const variant of variants) {
      const sku = variant.variant?.sku || variant.sku || ''
      if (!sku) continue
      const wmsId = skuToId.get(sku.toLowerCase().trim())
      if (!wmsId) continue

      await admin.from('products').update({
        wix_product_id: wixProduct.id,
        wix_variant_id: variantId,
        wix_inventory_item_id: invItemId,
      }).eq('id', wmsId)

      mapped++
      matched = true
    }

    // Fallback: match by product-level SKU
    if (!matched && wixProduct.sku) {
      const wmsId = skuToId.get(wixProduct.sku.toLowerCase().trim())
      if (wmsId) {
        await admin.from('products').update({
          wix_product_id: wixProduct.id,
          wix_variant_id: variantId,
          wix_inventory_item_id: invItemId,
        }).eq('id', wmsId)
        mapped++
      } else {
        skipped++
      }
    } else if (!matched) {
      skipped++
    }
  }

  return NextResponse.json({ mapped, skipped, total: allWixProducts.length })
}
