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

  if (!integration?.credentials?.api_key || !integration?.credentials?.site_id) {
    return NextResponse.json({ error: 'Wix not configured' }, { status: 400 })
  }

  const { api_key, site_id } = integration.credentials
  const headers = {
    'Authorization': api_key,
    'wix-site-id': site_id,
    'Content-Type': 'application/json',
  }

  // Fetch Wix products
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

  // Fetch WMS products (exclude sub-products — they don't exist in Wix)
  const { data: wmsProducts } = await admin
    .from('products')
    .select('id, name, sku, wix_product_id')
    .eq('org_id', adminUser.org_id)
    .eq('is_sub_product', false)
    .order('name')

  const wixSummary = allWixProducts.map(p => ({
    id: p.id,
    name: p.name,
    sku: p.sku || p.variants?.[0]?.variant?.sku || '',
  }))

  return NextResponse.json({
    wix: wixSummary,
    wms: (wmsProducts || []).map(p => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      mapped: !!p.wix_product_id,
    })),
    stats: {
      wixTotal: allWixProducts.length,
      wmsTotal: (wmsProducts || []).length,
      wmsMapped: (wmsProducts || []).filter(p => p.wix_product_id).length,
      wmsUnmapped: (wmsProducts || []).filter(p => !p.wix_product_id).length,
    },
  })
}
