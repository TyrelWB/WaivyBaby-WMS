import { createAdminClient } from './supabase/admin'
import { syncInventoryToWix, syncBundlesUsingSubProduct } from './wix-inventory'
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
    syncInventoryToWix(productId, orgId).catch(() => {})
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

  // Check all items have sufficient stock before reserving any
  const insufficient: string[] = []
  for (const item of items) {
    const { data: inv } = await admin
      .from('inventory')
      .select('qty_available')
      .eq('product_id', item.product_id)
      .single()

    const available = inv?.qty_available ?? 0
    if (available < item.quantity_ordered) {
      const p = item.products as any
      insufficient.push(`${p?.name || item.product_id} (need ${item.quantity_ordered}, have ${available})`)
    }
  }

  if (insufficient.length > 0) {
    return { ok: false, error: 'Insufficient stock', insufficient }
  }

  for (const item of items) {
    await recordInventoryMovement({
      orgId,
      productId: item.product_id,
      movementType: 'reserve',
      quantityChange: item.quantity_ordered,
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
