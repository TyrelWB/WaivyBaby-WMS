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
    .select('id, sku, name')
    .eq('org_id', adminUser.org_id)
    .eq('is_sub_product', false)

  if (!wmsProducts || wmsProducts.length === 0) {
    return NextResponse.json({ error: 'No products in WMS' }, { status: 400 })
  }

  const skuToId = new Map(wmsProducts.map(p => [p.sku.toLowerCase().trim(), p.id]))
  const nameToId = new Map(wmsProducts.map(p => [p.name.toLowerCase().trim(), p.id]))

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
  const unmatchedWix: { name: string; sku: string }[] = []

  for (const wixProduct of allWixProducts) {
    const invItemId: string | null = wixProduct.inventoryItemId || null
    const variantId: string | null = wixProduct.variants?.[0]?.id || null
    const variants: any[] = wixProduct.variants || []
    let matched = false
    let wmsId: string | undefined

    // 1. Try variant SKU match
    for (const variant of variants) {
      const sku = variant.variant?.sku || variant.sku || ''
      if (!sku) continue
      wmsId = skuToId.get(sku.toLowerCase().trim())
      if (wmsId) { matched = true; break }
    }

    // 2. Try product-level SKU match
    if (!matched && wixProduct.sku) {
      wmsId = skuToId.get(wixProduct.sku.toLowerCase().trim())
      if (wmsId) matched = true
    }

    // 3. Try name match (normalize: lowercase, trim)
    if (!matched && wixProduct.name) {
      wmsId = nameToId.get(wixProduct.name.toLowerCase().trim())
      if (wmsId) matched = true
    }

    if (matched && wmsId) {
      await admin.from('products').update({
        wix_product_id: wixProduct.id,
        wix_variant_id: variantId,
        wix_inventory_item_id: invItemId,
      }).eq('id', wmsId)
      mapped++
    } else {
      unmatchedWix.push({
        name: wixProduct.name || '(no name)',
        sku: wixProduct.sku || wixProduct.variants?.[0]?.variant?.sku || '(no sku)',
      })
    }
  }

  const { count: unmappedWms } = await admin
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', adminUser.org_id)
    .eq('is_sub_product', false)
    .is('wix_product_id', null)

  return NextResponse.json({
    mapped,
    skipped: unmatchedWix.length,
    total: allWixProducts.length,
    unmatchedWix,
    wmsUnmapped: unmappedWms ?? 0,
  })
}
