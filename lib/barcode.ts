import type { createClient } from './supabase/client'

export type BarcodeType = 'basket' | 'order' | 'box' | 'bin' | 'product' | 'unknown'

export interface ParsedBarcode {
  type: BarcodeType
  value: string
  raw: string
}

export function parseBarcode(raw: string): ParsedBarcode {
  const trimmed = raw.trim()

  if (trimmed.startsWith('BSK-')) return { type: 'basket', value: trimmed.replace('BSK-', ''), raw: trimmed }
  if (trimmed.startsWith('ORD-')) return { type: 'order', value: trimmed.replace('ORD-', ''), raw: trimmed }
  if (trimmed.startsWith('BOX-')) return { type: 'box', value: trimmed.replace('BOX-', ''), raw: trimmed }
  if (trimmed.startsWith('BIN-')) return { type: 'bin', value: trimmed.replace('BIN-', ''), raw: trimmed }

  // everything else treated as product barcode (UPC, SKU, etc.)
  return { type: 'product', value: trimmed, raw: trimmed }
}

export function generateBasketBarcode(id: string) {
  return `BSK-${id.slice(0, 8).toUpperCase()}`
}

export function generateOrderBarcode(orderNumber: string) {
  return `ORD-${orderNumber}`
}

export function generateBoxBarcode(orderId: string, boxNumber: number) {
  return `BOX-${orderId.slice(0, 6).toUpperCase()}-${boxNumber}`
}

export function generateBinBarcode(locationCode: string) {
  return `BIN-${locationCode.toUpperCase()}`
}

// SKU is the canonical, guaranteed-unique identifier and what Print Labels
// always encodes, so check it first — that way anything the app printed
// always resolves correctly, even if stale/leftover rows in
// product_barcodes (real-world UPCs, or old seed data) happen to collide
// with a SKU string that now belongs to a different product. Barcodes are
// the fallback, for genuine external barcodes that don't match any SKU.
export async function lookupProductIdByBarcode(
  supabase: ReturnType<typeof createClient>,
  raw: string
): Promise<string | null> {
  const { data: bySku } = await supabase
    .from('products')
    .select('id')
    .eq('sku', raw)
    .maybeSingle()
  if (bySku) return bySku.id

  const { data: byBarcode } = await supabase
    .from('product_barcodes')
    .select('product_id')
    .eq('barcode', raw)
    .maybeSingle()
  return byBarcode?.product_id ?? null
}
