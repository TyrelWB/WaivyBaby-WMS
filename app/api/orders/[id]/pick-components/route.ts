import { NextRequest, NextResponse } from 'next/server'
import sql from '@/lib/db'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const items = await sql`
    SELECT DISTINCT product_id FROM public.order_items WHERE order_id = ${id}
  `
  if (items.length === 0) return NextResponse.json({})

  const productIds = items.map((i: any) => i.product_id)

  // First-level components (bundle sub-products OR collection products)
  const firstLevel = await sql`
    SELECT
      pc.product_id,
      pc.sub_product_id,
      pc.quantity,
      p.name,
      p.sku,
      p.image_url
    FROM public.product_components pc
    JOIN public.products p ON pc.sub_product_id = p.id
    WHERE pc.product_id = ANY(${productIds})
    ORDER BY p.name ASC
  ` as any[]

  if (firstLevel.length === 0) return NextResponse.json({})

  // Check which first-level components themselves have sub-components (collection detection)
  const firstLevelProductIds = [...new Set(firstLevel.map((c: any) => c.sub_product_id))]

  const secondLevel = await sql`
    SELECT
      pc.product_id,
      pc.sub_product_id,
      pc.quantity,
      p.name,
      p.sku,
      p.image_url
    FROM public.product_components pc
    JOIN public.products p ON pc.sub_product_id = p.id
    WHERE pc.product_id = ANY(${firstLevelProductIds})
    ORDER BY p.name ASC
  ` as any[]

  // Build a map of which first-level products have sub-components
  const nestedMap: Record<string, any[]> = {}
  for (const c of secondLevel) {
    if (!nestedMap[c.product_id]) nestedMap[c.product_id] = []
    nestedMap[c.product_id].push({
      sub_product_id: c.sub_product_id,
      quantity: c.quantity,
      name: c.name,
      sku: c.sku,
      image_url: c.image_url,
    })
  }

  // Build result per top-level product
  const result: Record<string, any> = {}

  for (const topProductId of productIds) {
    const components = firstLevel.filter((c: any) => c.product_id === topProductId)
    if (components.length === 0) continue

    // If any first-level component has its own sub-components → this is a collection
    const isCollection = components.some((c: any) => nestedMap[c.sub_product_id]?.length > 0)

    if (isCollection) {
      result[topProductId] = {
        type: 'collection',
        products: components.map((c: any) => ({
          product_id: c.sub_product_id,
          name: c.name,
          sku: c.sku,
          image_url: c.image_url,
          quantity: c.quantity,
          sub_products: nestedMap[c.sub_product_id] || [],
        })),
      }
    } else {
      result[topProductId] = {
        type: 'bundle',
        items: components.map((c: any) => ({
          sub_product_id: c.sub_product_id,
          quantity: c.quantity,
          name: c.name,
          sku: c.sku,
          image_url: c.image_url,
        })),
      }
    }
  }

  return NextResponse.json(result)
}
