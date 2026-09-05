import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: adminUser } = await admin.from('admin_users').select('org_id').eq('id', user.id).single()
  if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await admin
    .from('products')
    .select('id, name, sku, description, price, weight, reorder_point, image_url, is_sub_product, supplier:suppliers(name), inventory(qty_available, qty_on_hand, qty_reserved, qty_damaged, bin:bins(location_code)), barcodes:product_barcodes(barcode, is_primary)')
    .eq('org_id', adminUser.org_id)
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: adminUser } = await admin.from('admin_users').select('org_id, warehouse_id').eq('id', user.id).single()
  if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { name, sku, description, price, weight, reorder_point, barcode, bin_location, initial_stock, is_sub_product, link_product_ids } = body

  if (!name?.trim() || !sku?.trim()) return NextResponse.json({ error: 'Name and SKU required' }, { status: 400 })

  const { data: product, error } = await admin.from('products').insert({
    org_id: adminUser.org_id,
    warehouse_id: adminUser.warehouse_id,
    name: name.trim(),
    sku: sku.trim().toUpperCase(),
    description: description?.trim() || null,
    price: parseFloat(price) || 0,
    weight: parseFloat(weight) || null,
    reorder_point: parseInt(reorder_point) || 0,
    is_sub_product: !!is_sub_product,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  if (barcode?.trim()) {
    await admin.from('product_barcodes').insert({
      product_id: product.id,
      org_id: adminUser.org_id,
      barcode: barcode.trim(),
      is_primary: true,
    })
  }

  if (parseInt(initial_stock) > 0) {
    let binId: string | null = null
    if (bin_location?.trim()) {
      const { data: existingBin } = await admin.from('bins').select('id').eq('warehouse_id', adminUser.warehouse_id).eq('location_code', bin_location.trim().toUpperCase()).single()
      if (existingBin) {
        binId = existingBin.id
      } else {
        const { data: newBin } = await admin.from('bins').insert({
          warehouse_id: adminUser.warehouse_id,
          org_id: adminUser.org_id,
          location_code: bin_location.trim().toUpperCase(),
        }).select().single()
        binId = newBin?.id || null
      }
    }
    const qty = parseInt(initial_stock)
    await admin.from('inventory').insert({
      product_id: product.id,
      bin_id: binId,
      warehouse_id: adminUser.warehouse_id,
      org_id: adminUser.org_id,
      qty_on_hand: qty,
      qty_available: qty,
      qty_reserved: 0,
      qty_picked: 0,
      qty_damaged: 0,
    })
  }

  // Link sub-products/products via product_components (used for collections)
  if (link_product_ids?.length > 0) {
    await admin.from('product_components').insert(
      link_product_ids.map((pid: string) => ({ product_id: product.id, sub_product_id: pid, quantity: 1 }))
    )
  }

  return NextResponse.json(product)
}
