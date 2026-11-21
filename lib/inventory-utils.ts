import { createAdminClient } from './supabase/admin'
import { syncBundlesUsingSubProduct } from './wix-inventory'
import sql from './db'

export type MovementType = 'receive' | 'reserve' | 'release' | 'ship' | 'adjust' | 'damage' | 'return' | 'cancel'

export async function recordInventoryMovement(params: {
  orgId: string
  productId: string
  movementType: MovementType
  quantityChange: number
  referenceType?: string
  referenceId?: string
  note?: string
  syncToWix?: boolean
}): Promise<{ ok: boolean; error?: string; qty_on_hand?: number; qty_reserved?: number; qty_available?: number }> {
  const admin = createAdminClient()
  const { orgId, productId, movementType, quantityChange, referenceType, referenceId, note, syncToWix = true } = params

  const abs = Math.abs(quantityChange)

  let updateExpr: ReturnType<typeof sql>
  if (movementType === 'receive' || movementType === 'return') {
    updateExpr = sql`
      UPDATE public.inventory SET
        qty_on_hand   = qty_on_hand + ${abs},
        qty_available = qty_on_hand + ${abs},
        updated_at    = NOW()
      WHERE product_id = ${productId}
      RETURNING qty_on_hand, qty_reserved, qty_available
    `
  } else if (movementType === 'adjust') {
    updateExpr = sql`
      UPDATE public.inventory SET
        qty_on_hand   = GREATEST(0, qty_on_hand + ${quantityChange}),
        qty_available = GREATEST(0, qty_on_hand + ${quantityChange}),
        updated_at    = NOW()
      WHERE product_id = ${productId}
      RETURNING qty_on_hand, qty_reserved, qty_available
    `
  } else if (movementType === 'reserve') {
    updateExpr = sql`
      UPDATE public.inventory SET
        qty_available = qty_available - ${abs},
        qty_reserved  = qty_reserved  + ${abs},
        updated_at    = NOW()
      WHERE product_id = ${productId} AND qty_available >= ${abs}
      RETURNING qty_on_hand, qty_reserved, qty_available
    `
  } else if (movementType === 'release' || movementType === 'cancel') {
    updateExpr = sql`
      UPDATE public.inventory SET
        qty_reserved  = GREATEST(0, qty_reserved - ${abs}),
        qty_available = qty_available + ${abs},
        updated_at    = NOW()
      WHERE product_id = ${productId}
      RETURNING qty_on_hand, qty_reserved, qty_available
    `
  } else if (movementType === 'ship') {
    updateExpr = sql`
      UPDATE public.inventory SET
        qty_reserved = GREATEST(0, qty_reserved - ${abs}),
        updated_at   = NOW()
      WHERE product_id = ${productId}
      RETURNING qty_on_hand, qty_reserved, qty_available
    `
  } else {
    // damage
    updateExpr = sql`
      UPDATE public.inventory SET
        qty_on_hand   = GREATEST(0, qty_on_hand - ${abs}),
        qty_available = GREATEST(0, qty_available - ${abs}),
        updated_at    = NOW()
      WHERE product_id = ${productId}
      RETURNING qty_on_hand, qty_reserved, qty_available
    `
  }

  const rows = await updateExpr as unknown as any[]
  if (rows.length === 0) return { ok: false, error: 'Insufficient stock or inventory record not found' }

  const newOnHand = rows[0].qty_on_hand
  const newReserved = rows[0].qty_reserved
  const newAvailable = rows[0].qty_available

  await admin.from('inventory_movements').insert({
    org_id: orgId,
    product_id: productId,
    movement_type: movementType,
    quantity_change: quantityChange,
    qty_on_hand_after: newOnHand,
    qty_reserved_after: newReserved,
    qty_available_after: newAvailable,
    reference_type: referenceType || null,
    reference_id: referenceId || null,
    note: note || null,
  })

  if (syncToWix) {
    // Wix storefront retired — only recalculate local bundle stock, no outbound push.
    syncBundlesUsingSubProduct(productId, orgId).catch(() => {})
  }

  return { ok: true, qty_on_hand: newOnHand, qty_reserved: newReserved, qty_available: newAvailable }
}

export async function reserveOrderInventory(
  orderId: string,
  orgId: string
): Promise<{ ok: boolean; error?: string; insufficient?: string[] }> {
  const admin = createAdminClient()

  const { data: items } = await admin
    .from('order_items')
    .select('product_id, quantity_ordered, products(name, sku)')
    .eq('order_id', orderId)

  if (!items || items.length === 0) return { ok: true }

  const productIds = items.map((i: any) => i.product_id)

  // Resolve component structure (handles regular, bundle, and collection products)
  const { data: firstLevel } = await admin
    .from('product_components')
    .select('product_id, sub_product_id, quantity')
    .in('product_id', productIds)

  const firstLevelIds = [...new Set((firstLevel || []).map((c: any) => c.sub_product_id))]

  const { data: secondLevel } = firstLevelIds.length > 0
    ? await admin.from('product_components').select('product_id, sub_product_id, quantity').in('product_id', firstLevelIds)
    : { data: [] }

  const componentMap: Record<string, { sub_product_id: string; quantity: number }[]> = {}
  for (const c of firstLevel || []) {
    if (!componentMap[c.product_id]) componentMap[c.product_id] = []
    componentMap[c.product_id].push({ sub_product_id: c.sub_product_id, quantity: c.quantity })
  }

  const subComponentMap: Record<string, { sub_product_id: string; quantity: number }[]> = {}
  for (const c of secondLevel || []) {
    if (!subComponentMap[c.product_id]) subComponentMap[c.product_id] = []
    subComponentMap[c.product_id].push({ sub_product_id: c.sub_product_id, quantity: c.quantity })
  }

  // Build flat list of (productId, qty) to reserve from leaf inventory
  type LeafReservation = { productId: string; qty: number; label: string }
  const reservations: LeafReservation[] = []

  for (const item of items) {
    const p = item.products as any
    const label = p?.name || item.product_id
    const itemComponents = componentMap[item.product_id]

    if (!itemComponents || itemComponents.length === 0) {
      reservations.push({ productId: item.product_id, qty: item.quantity_ordered, label })
    } else {
      for (const comp of itemComponents) {
        const subComps = subComponentMap[comp.sub_product_id]
        if (subComps && subComps.length > 0) {
          for (const sub of subComps) {
            reservations.push({ productId: sub.sub_product_id, qty: sub.quantity * comp.quantity * item.quantity_ordered, label })
          }
        } else {
          reservations.push({ productId: comp.sub_product_id, qty: comp.quantity * item.quantity_ordered, label })
        }
      }
    }
  }

  // Check availability before reserving anything
  const insufficient: string[] = []
  for (const r of reservations) {
    const { data: inv } = await admin.from('inventory').select('qty_available').eq('product_id', r.productId).maybeSingle()
    if ((inv?.qty_available ?? 0) < r.qty) {
      insufficient.push(`${r.label} (need ${r.qty}, have ${inv?.qty_available ?? 0})`)
    }
  }

  if (insufficient.length > 0) return { ok: false, error: 'Insufficient stock', insufficient }

  for (const r of reservations) {
    await recordInventoryMovement({
      orgId,
      productId: r.productId,
      movementType: 'reserve',
      quantityChange: r.qty,
      referenceType: 'order',
      referenceId: orderId,
      note: 'Reserved on order creation',
    })
  }

  return { ok: true }
}

export async function releaseOrderInventory(orderId: string, orgId: string): Promise<void> {
  const admin = createAdminClient()

  const { data: items } = await admin
    .from('order_items')
    .select('product_id, quantity_ordered')
    .eq('order_id', orderId)

  if (!items) return

  for (const item of items) {
    await recordInventoryMovement({
      orgId,
      productId: item.product_id,
      movementType: 'cancel',
      quantityChange: item.quantity_ordered,
      referenceType: 'order',
      referenceId: orderId,
      note: 'Released — order cancelled',
    })
  }
}

export async function shipOrderInventory(orderId: string, orgId: string): Promise<void> {
  const admin = createAdminClient()

  const { data: items } = await admin
    .from('order_items')
    .select('product_id, quantity_ordered')
    .eq('order_id', orderId)

  if (!items) return

  for (const item of items) {
    await recordInventoryMovement({
      orgId,
      productId: item.product_id,
      movementType: 'ship',
      quantityChange: item.quantity_ordered,
      referenceType: 'order',
      referenceId: orderId,
      note: 'Shipped',
    })
  }
}
