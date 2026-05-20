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

  for (const item of items as any[]) {
    const qty = item.quantity_ordered - item.quantity_picked
    if (qty <= 0) continue

    const itemComponents = componentMap[item.product_id]

    if (itemComponents && itemComponents.length > 0) {
      // Bundle: reserve each sub-product
      for (const component of itemComponents) {
        const reserveQty = component.quantity * qty
        const { data: inv } = await admin
          .from('inventory')
          .select('id, qty_available, qty_reserved')
          .eq('product_id', component.sub_product_id)
          .single()
        if (inv) {
          await admin.from('inventory').update({
            qty_available: Math.max(0, inv.qty_available - reserveQty),
            qty_reserved: inv.qty_reserved + reserveQty,
          }).eq('id', inv.id)
        }
      }
    } else {
      // Regular product: reserve as normal
      const { data: inv } = await admin
        .from('inventory')
        .select('id, qty_available, qty_reserved')
        .eq('product_id', item.product_id)
        .single()
      if (inv) {
        await admin.from('inventory').update({
          qty_available: Math.max(0, inv.qty_available - qty),
          qty_reserved: inv.qty_reserved + qty,
        }).eq('id', inv.id)
      }
    }
  }

  return NextResponse.json({ ok: true })
}
