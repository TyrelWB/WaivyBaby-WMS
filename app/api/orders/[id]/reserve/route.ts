import { NextRequest, NextResponse } from 'next/server'
import sql from '@/lib/db'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = createAdminClient()

  const { data: items } = await admin
    .from('order_items')
    .select('id, product_id, quantity_ordered, quantity_picked')
    .eq('order_id', id)
    .not('status', 'eq', 'picked')

  if (!items || items.length === 0) return NextResponse.json({ ok: true })

  const productIds = items.map((i: any) => i.product_id)

  const components = await sql`
    SELECT product_id, sub_product_id, quantity
    FROM public.product_components
    WHERE product_id = ANY(${productIds})
  `

  const componentMap: Record<string, { sub_product_id: string; quantity: number }[]> = {}
  for (const c of components as any[]) {
    if (!componentMap[c.product_id]) componentMap[c.product_id] = []
    componentMap[c.product_id].push({ sub_product_id: c.sub_product_id, quantity: c.quantity })
  }

  const insufficient: string[] = []

  for (const item of items as any[]) {
    const qty = item.quantity_ordered - item.quantity_picked
    if (qty <= 0) continue

    const itemComponents = componentMap[item.product_id]

    if (itemComponents && itemComponents.length > 0) {
      for (const component of itemComponents) {
        const reserveQty = component.quantity * qty
        const updated = await sql`
          UPDATE public.inventory
          SET qty_available = qty_available - ${reserveQty},
              qty_reserved  = qty_reserved  + ${reserveQty}
          WHERE product_id = ${component.sub_product_id}
            AND qty_available >= ${reserveQty}
          RETURNING id
        `
        if ((updated as any[]).length === 0) {
          insufficient.push(component.sub_product_id)
        }
      }
    } else {
      const updated = await sql`
        UPDATE public.inventory
        SET qty_available = qty_available - ${qty},
            qty_reserved  = qty_reserved  + ${qty}
        WHERE product_id = ${item.product_id}
          AND qty_available >= ${qty}
        RETURNING id
      `
      if ((updated as any[]).length === 0) {
        insufficient.push(item.product_id)
      }
    }
  }

  if (insufficient.length > 0) {
    return NextResponse.json({ ok: false, insufficient }, { status: 409 })
  }

  return NextResponse.json({ ok: true })
}
