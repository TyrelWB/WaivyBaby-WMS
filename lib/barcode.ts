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
