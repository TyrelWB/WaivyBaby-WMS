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

  const { data: allProds } = await admin
    .from('products')
    .select('id, name, sku, image_url')
    .eq('org_id', adminUser.org_id)

  if (!allProds || allProds.length === 0) return NextResponse.json([])

  const orgProductIds = allProds.map((p: any) => p.id)
  const productMap: Record<string, any> = {}
  for (const p of allProds) productMap[p.id] = p

  const { data: firstLevel } = await admin
    .from('product_components')
    .select('product_id, sub_product_id, quantity')
    .in('product_id', orgProductIds)

  if (!firstLevel || firstLevel.length === 0) return NextResponse.json([])

  const firstLevelSubIds = [...new Set(firstLevel.map((c: any) => c.sub_product_id))]

  const { data: secondLevel } = await admin
    .from('product_components')
    .select('product_id, sub_product_id, quantity')
    .in('product_id', firstLevelSubIds)

  const subParentIds = new Set((secondLevel || []).map((c: any) => c.product_id))

  const collectionIds = orgProductIds.filter((pid: string) => {
    const children = firstLevel.filter((c: any) => c.product_id === pid)
    return children.some((c: any) => subParentIds.has(c.sub_product_id))
  })

  const collections = collectionIds.map((cid: string) => {
    const childRels = firstLevel.filter((c: any) => c.product_id === cid)
    const col = productMap[cid]

    const products = childRels.map((rel: any) => {
      const p = productMap[rel.sub_product_id]
      const subRels = (secondLevel || []).filter((c: any) => c.product_id === rel.sub_product_id)

      return {
        id: rel.sub_product_id,
        name: p?.name || 'Unknown',
        sku: p?.sku || '',
        image_url: p?.image_url || null,
        quantity: rel.quantity,
        sub_products: subRels.map((sr: any) => {
          const sp = productMap[sr.sub_product_id]
          return {
            id: sr.sub_product_id,
            name: sp?.name || 'Unknown',
            sku: sp?.sku || '',
            image_url: sp?.image_url || null,
            quantity: sr.quantity,
          }
        }),
      }
    })

    return {
      id: cid,
      name: col?.name || 'Unknown',
      sku: col?.sku || '',
      image_url: col?.image_url || null,
      products,
    }
  })

  return NextResponse.json(collections)
}
