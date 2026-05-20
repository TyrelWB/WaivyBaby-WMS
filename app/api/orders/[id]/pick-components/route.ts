import { NextRequest, NextResponse } from 'next/server'
import sql from '@/lib/db'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const items = await sql`
    SELECT DISTINCT product_id FROM public.order_items WHERE order_id = ${id}
  `
  if (items.length === 0) return NextResponse.json({})

  const productIds = items.map((i: any) => i.product_id)

  const components = await sql`
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
  `

  const result: Record<string, any[]> = {}
  for (const c of components as any[]) {
    if (!result[c.product_id]) result[c.product_id] = []
    result[c.product_id].push({
      sub_product_id: c.sub_product_id,
      quantity: c.quantity,
      name: c.name,
      sku: c.sku,
      image_url: c.image_url,
    })
  }

  return NextResponse.json(result)
}
