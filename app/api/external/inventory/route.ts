import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncBundlesUsingSubProduct } from '@/lib/wix-inventory'
import { pushStockToStripe } from '@/lib/stripe-inventory'

function checkApiKey(req: NextRequest): boolean {
  const key = req.headers.get('x-api-key')
  return key === process.env.WMS_API_KEY
}

// GET /api/external/inventory
// Returns all products with their inventory quantities
export async function GET(req: NextRequest) {
  if (!checkApiKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  // Get org_id from the first org (single-tenant for WaivyBaby)
  const { data: org } = await admin.from('admin_users').select('org_id').limit(1).single()
  if (!org) return NextResponse.json({ error: 'No org found' }, { status: 500 })

  const { data: products, error } = await admin
    .from('products')
    .select('id, name, sku, is_sub_product, inventory(qty_available, qty_on_hand, qty_reserved)')
    .eq('org_id', org.org_id)
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const result = (products || []).map(p => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    is_sub_product: p.is_sub_product,
    qty_available: (p.inventory as any)?.[0]?.qty_available ?? 0,
    qty_on_hand: (p.inventory as any)?.[0]?.qty_on_hand ?? 0,
    qty_reserved: (p.inventory as any)?.[0]?.qty_reserved ?? 0,
  }))

  return NextResponse.json(result)
}

// POST /api/external/inventory
// Body: { sku: string, qty_change: number, reason?: string }
// qty_change can be positive (add stock) or negative (deduct stock)
export async function POST(req: NextRequest) {
  if (!checkApiKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  if (!body?.sku || body.qty_change === undefined) {
    return NextResponse.json({ error: 'Missing sku or qty_change' }, { status: 400 })
  }

  const { sku, qty_change, reason } = body
  const qtyChange = Number(qty_change)
  if (isNaN(qtyChange)) {
    return NextResponse.json({ error: 'qty_change must be a number' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: org } = await admin.from('admin_users').select('org_id').limit(1).single()
  if (!org) return NextResponse.json({ error: 'No org found' }, { status: 500 })

  const { data: product } = await admin
    .from('products')
    .select('id, name, sku')
    .eq('org_id', org.org_id)
    .ilike('sku', sku)
    .single()

  if (!product) {
    return NextResponse.json({ error: `Product not found: ${sku}` }, { status: 404 })
  }

  const { data: inv } = await admin
    .from('inventory')
    .select('qty_on_hand, qty_available, qty_reserved')
    .eq('product_id', product.id)
    .single()

  const currentQty = inv?.qty_on_hand ?? 0
  const newQty = Math.max(0, currentQty + qtyChange)
  const newAvailable = Math.max(0, (inv?.qty_available ?? 0) + qtyChange)

  if (inv) {
    await admin
      .from('inventory')
      .update({ qty_on_hand: newQty, qty_available: newAvailable, updated_at: new Date().toISOString() })
      .eq('product_id', product.id)
  } else {
    const { data: orgData } = await admin.from('admin_users').select('warehouse_id').eq('org_id', org.org_id).limit(1).single()
    await admin.from('inventory').insert({
      product_id: product.id,
      org_id: org.org_id,
      warehouse_id: (orgData as any)?.warehouse_id || null,
      qty_on_hand: Math.max(0, qtyChange),
      qty_available: Math.max(0, qtyChange),
      qty_reserved: 0,
      qty_picked: 0,
      qty_damaged: 0,
    })
  }

  // Push updated stock to Stripe
  pushStockToStripe(product.id, newAvailable).catch(() => {})

  // If this is a sub-product, cascade up to parent bundles
  syncBundlesUsingSubProduct(product.id, org.org_id).catch(() => {})

  await admin.from('sync_logs').insert({
    org_id: org.org_id,
    provider: 'external',
    event_type: 'inventory_update',
    status: 'success',
    reference_type: 'product',
    reference_id: product.id,
    payload: { sku, qty_change: qtyChange, new_qty: newQty, reason: reason || 'external API' },
  })

  return NextResponse.json({
    ok: true,
    sku: product.sku,
    name: product.name,
    previous_qty: currentQty,
    new_qty: newQty,
  })
}
