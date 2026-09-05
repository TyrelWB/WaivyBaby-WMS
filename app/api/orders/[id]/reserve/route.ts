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

  // First-level components (bundle sub-products OR collection products)
  const firstLevel = await sql`
    SELECT product_id, sub_product_id, quantity
    FROM public.product_components
    WHERE product_id = ANY(${productIds})
  ` as any[]

  const firstLevelIds = [...new Set(firstLevel.map((c: any) => c.sub_product_id))]

  // Second-level components (sub-products of collection products)
  const secondLevel = firstLevelIds.length > 0 ? await sql`
    SELECT product_id, sub_product_id, quantity
    FROM public.product_components
    WHERE product_id = ANY(${firstLevelIds})
  ` as any[] : []

  // Map: product_id → first-level components
  const componentMap: Record<string, { sub_product_id: string; quantity: number }[]> = {}
  for (const c of firstLevel) {
    if (!componentMap[c.product_id]) componentMap[c.product_id] = []
    componentMap[c.product_id].push({ sub_product_id: c.sub_product_id, quantity: c.quantity })
  }

  // Map: first-level product_id → its sub-components
  const subComponentMap: Record<string, { sub_product_id: string; quantity: number }[]> = {}
  for (const c of secondLevel) {
    if (!subComponentMap[c.product_id]) subComponentMap[c.product_id] = []
    subComponentMap[c.product_id].push({ sub_product_id: c.sub_product_id, quantity: c.quantity })
  }

  const insufficient: string[] = []

  for (const item of items as any[]) {
    const qty = item.quantity_ordered - item.quantity_picked
    if (qty <= 0) continue

    const itemComponents = componentMap[item.product_id]

    if (!itemComponents || itemComponents.length === 0) {
      // Regular product — reserve directly
      const updated = await sql`
        UPDATE public.inventory
        SET qty_available = qty_available - ${qty},
            qty_reserved  = qty_reserved  + ${qty}
        WHERE product_id = ${item.product_id}
          AND qty_available >= ${qty}
        RETURNING id
      `
      if ((updated as any[]).length === 0) insufficient.push(item.product_id)
      continue
    }

    for (const component of itemComponents) {
      const subComponents = subComponentMap[component.sub_product_id]

      if (subComponents && subComponents.length > 0) {
        // Collection: component is a mid-level product — reserve from its sub-products
        for (const sub of subComponents) {
          const reserveQty = sub.quantity * component.quantity * qty
          const updated = await sql`
            UPDATE public.inventory
            SET qty_available = qty_available - ${reserveQty},
                qty_reserved  = qty_reserved  + ${reserveQty}
            WHERE product_id = ${sub.sub_product_id}
              AND qty_available >= ${reserveQty}
            RETURNING id
          `
          if ((updated as any[]).length === 0) insufficient.push(sub.sub_product_id)
        }
      } else {
        // Bundle: component is a leaf — reserve directly
        const reserveQty = component.quantity * qty
        const updated = await sql`
          UPDATE public.inventory
          SET qty_available = qty_available - ${reserveQty},
              qty_reserved  = qty_reserved  + ${reserveQty}
          WHERE product_id = ${component.sub_product_id}
            AND qty_available >= ${reserveQty}
          RETURNING id
        `
        if ((updated as any[]).length === 0) insufficient.push(component.sub_product_id)
      }
    }
  }

  if (insufficient.length > 0) {
    return NextResponse.json({ ok: false, insufficient }, { status: 409 })
  }

  return NextResponse.json({ ok: true })
}
