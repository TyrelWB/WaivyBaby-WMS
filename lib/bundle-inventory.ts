import { createAdminClient } from './supabase/admin'
import sql from './db'

async function calculateBundleAvailability(productId: string): Promise<number | null> {
  const components = await sql`
    SELECT sub_product_id, quantity FROM public.product_components WHERE product_id = ${productId}
  `
  if ((components as any[]).length === 0) return null

  let min = Infinity
  for (const c of components as any[]) {
    // Check if this component is itself a bundle (has its own sub-products)
    const subComponents = await sql`
      SELECT pc.quantity, COALESCE(i.qty_available, 0) AS qty_available
      FROM public.product_components pc
      LEFT JOIN public.inventory i ON i.product_id = pc.sub_product_id
      WHERE pc.product_id = ${c.sub_product_id}
    `
    let componentAvailable: number
    if ((subComponents as any[]).length > 0) {
      // Nested bundle (e.g. collection → product → sub-products)
      let subMin = Infinity
      for (const sc of subComponents as any[]) {
        const canMake = Math.floor(sc.qty_available / sc.quantity)
        if (canMake < subMin) subMin = canMake
      }
      componentAvailable = subMin === Infinity ? 0 : Math.max(0, subMin)
    } else {
      // Leaf component — read its own inventory
      const invRows = await sql`
        SELECT COALESCE(qty_available, 0) AS qty_available FROM public.inventory WHERE product_id = ${c.sub_product_id}
      `
      componentAvailable = (invRows as any[])[0]?.qty_available ?? 0
    }
    const canMake = Math.floor(componentAvailable / c.quantity)
    if (canMake < min) min = canMake
  }
  return min === Infinity ? 0 : Math.max(0, min)
}

async function refreshBundleInventory(productId: string, orgId: string): Promise<void> {
  const admin = createAdminClient()
  const bundleAvailable = await calculateBundleAvailability(productId)
  if (bundleAvailable === null) return

  const qty = Math.max(0, bundleAvailable)

  const { data: warehouseRow } = await admin.from('admin_users').select('warehouse_id').eq('org_id', orgId).limit(1).single()
  const warehouseId = warehouseRow?.warehouse_id || null

  await sql`
    WITH updated AS (
      UPDATE public.inventory SET
        qty_on_hand   = ${qty},
        qty_available = ${qty},
        updated_at    = NOW()
      WHERE product_id = ${productId}
      RETURNING id
    )
    INSERT INTO public.inventory (product_id, org_id, warehouse_id, qty_on_hand, qty_available, qty_reserved, qty_picked, qty_damaged)
    SELECT ${productId}, ${orgId}, ${warehouseId}, ${qty}, ${qty}, 0, 0, 0
    WHERE NOT EXISTS (SELECT 1 FROM updated)
  `
}

export async function syncBundlesUsingSubProduct(subProductId: string, orgId: string): Promise<void> {
  // Find direct parents (products that use this sub-product)
  const directParents = await sql`
    SELECT DISTINCT product_id FROM public.product_components WHERE sub_product_id = ${subProductId}
  `
  const parentIds = (directParents as any[]).map(r => r.product_id)

  // Also find grandparent collections (collections that use those products)
  const allIds = new Set<string>(parentIds)
  if (parentIds.length > 0) {
    const grandParents = await sql`
      SELECT DISTINCT product_id FROM public.product_components WHERE sub_product_id = ANY(${parentIds}::uuid[])
    `
    for (const gp of grandParents as any[]) allIds.add(gp.product_id)
  }

  for (const id of allIds) {
    refreshBundleInventory(id, orgId).catch(() => {})
  }
}
