import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import sql from '@/lib/db'

async function calculateBundleDetail(productId: string): Promise<{
  qty: number | null
  components: { name: string; sku: string; needed: number; available: number; canMake: number }[]
}> {
  const components = await sql`
    SELECT pc.sub_product_id, pc.quantity, p.name, p.sku
    FROM public.product_components pc
    JOIN public.products p ON p.id = pc.sub_product_id
    WHERE pc.product_id = ${productId}
  `
  if ((components as any[]).length === 0) return { qty: null, components: [] }

  let min = Infinity
  const detail: { name: string; sku: string; needed: number; available: number; canMake: number }[] = []

  for (const c of components as any[]) {
    const subComponents = await sql`
      SELECT pc.quantity, COALESCE(i.qty_available, 0) AS qty_available
      FROM public.product_components pc
      LEFT JOIN public.inventory i ON i.product_id = pc.sub_product_id
      WHERE pc.product_id = ${c.sub_product_id}
    `
    let componentAvailable: number
    if ((subComponents as any[]).length > 0) {
      let subMin = Infinity
      for (const sc of subComponents as any[]) {
        const canMake = Math.floor(sc.qty_available / sc.quantity)
        if (canMake < subMin) subMin = canMake
      }
      componentAvailable = subMin === Infinity ? 0 : Math.max(0, subMin)
    } else {
      const invRows = await sql`
        SELECT COALESCE(qty_available, 0) AS qty_available FROM public.inventory WHERE product_id = ${c.sub_product_id}
      `
      componentAvailable = (invRows as any[])[0]?.qty_available ?? 0
    }
    const canMake = Math.floor(componentAvailable / c.quantity)
    detail.push({ name: c.name, sku: c.sku, needed: c.quantity, available: componentAvailable, canMake })
    if (canMake < min) min = canMake
  }

  return { qty: min === Infinity ? 0 : Math.max(0, min), components: detail }
}

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: adminUser } = await admin.from('admin_users').select('org_id, warehouse_id').eq('id', user.id).single()
  if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const bundleIds = await sql`
    SELECT DISTINCT product_id FROM public.product_components
    WHERE product_id IN (
      SELECT id FROM public.products WHERE org_id = ${adminUser.org_id} AND is_sub_product = false
    )
  `

  let updated = 0
  let skipped = 0
  const results: { name: string; qty: number; components: { name: string; sku: string; needed: number; available: number; canMake: number }[] }[] = []

  for (const row of bundleIds as any[]) {
    const { qty, components } = await calculateBundleDetail(row.product_id)
    if (qty === null) { skipped++; continue }

    // UPDATE existing row if any; INSERT if none exist
    await sql`
      WITH updated AS (
        UPDATE public.inventory SET
          qty_on_hand   = ${qty},
          qty_available = ${qty},
          updated_at    = NOW()
        WHERE product_id = ${row.product_id}
        RETURNING id
      )
      INSERT INTO public.inventory (product_id, org_id, warehouse_id, qty_on_hand, qty_available, qty_reserved, qty_picked, qty_damaged)
      SELECT ${row.product_id}, ${adminUser.org_id}, ${adminUser.warehouse_id}, ${qty}, ${qty}, 0, 0, 0
      WHERE NOT EXISTS (SELECT 1 FROM updated)
    `

    const { data: prod } = await admin.from('products').select('name').eq('id', row.product_id).single()
    results.push({ name: prod?.name || row.product_id, qty, components })
    updated++
  }

  return NextResponse.json({ updated, skipped, results })
}
