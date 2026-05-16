import { createAdminClient } from './supabase/admin'
import { syncInventoryToWix } from './wix-inventory'

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

  const { data: inv } = await admin
    .from('inventory')
    .select('qty_on_hand, qty_reserved')
    .eq('product_id', productId)
    .single()

  if (!inv) return { ok: false, error: 'Inventory record not found' }

  let newOnHand = inv.qty_on_hand ?? 0
  let newReserved = inv.qty_reserved ?? 0

  if (movementType === 'receive' || movementType === 'return') {
    newOnHand = newOnHand + Math.abs(quantityChange)
  } else if (movementType === 'adjust') {
    newOnHand = Math.max(0, newOnHand + quantityChange)
  } else if (movementType === 'reserve') {
    // Move from on hand into reserved
    newOnHand = Math.max(0, newOnHand - Math.abs(quantityChange))
    newReserved = newReserved + Math.abs(quantityChange)
  } else if (movementType === 'release' || movementType === 'cancel') {
    // Move back from reserved to on hand
    newReserved = Math.max(0, newReserved - Math.abs(quantityChange))
    newOnHand = newOnHand + Math.abs(quantityChange)
  } else if (movementType === 'ship') {
    // Item leaves warehouse — remove from reserved
    newReserved = Math.max(0, newReserved - Math.abs(quantityChange))
  } else if (movementType === 'damage') {
    newOnHand = Math.max(0, newOnHand - Math.abs(quantityChange))
  }

  const newAvailable = newOnHand

  await admin.from('inventory').update({
    qty_on_hand: newOnHand,
    qty_reserved: newReserved,
    qty_available: newAvailable,
    updated_at: new Date().toISOString(),
  }).eq('product_id', productId)

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
    // fire-and-forget — don't block the caller
    syncInventoryToWix(productId, orgId).catch(() => {})
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
