import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: adminUser } = await admin.from('admin_users').select('org_id').eq('id', user.id).single()
  if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const [{ data: product }, { data: inventory }, { data: barcodes }, { data: adjustments }] = await Promise.all([
    admin.from('products').select('id, name, sku, description, price, weight, reorder_point, image_url').eq('id', id).eq('org_id', adminUser.org_id).single(),
    admin.from('inventory').select('id, qty_on_hand, qty_available, qty_reserved, qty_picked, qty_damaged, bins(id, location_code)').eq('product_id', id).eq('org_id', adminUser.org_id).single(),
    admin.from('product_barcodes').select('id, barcode, is_primary').eq('product_id', id).order('is_primary', { ascending: false }),
    admin.from('inventory_adjustments').select('id, adjustment_type, qty_change, reason, created_at, workers(name)').eq('product_id', id).eq('org_id', adminUser.org_id).order('created_at', { ascending: false }).limit(20),
  ])

  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  return NextResponse.json({ product, inventory, barcodes: barcodes || [], adjustments: adjustments || [] })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: adminUser } = await admin.from('admin_users').select('org_id').eq('id', user.id).single()
  if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()

  const updates: Record<string, any> = {}
  if (body.name !== undefined) updates.name = body.name.trim()
  if (body.sku !== undefined) updates.sku = body.sku.trim().toUpperCase()
  if (body.image_url !== undefined) updates.image_url = body.image_url

  const { error } = await admin.from('products').update(updates).eq('id', id).eq('org_id', adminUser.org_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: adminUser } = await admin.from('admin_users').select('org_id').eq('id', user.id).single()
  if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  // Verify product belongs to this org
  const { data: product } = await admin.from('products').select('id').eq('id', id).eq('org_id', adminUser.org_id).single()
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  // Delete in dependency order
  const invRows = await admin.from('inventory').select('id').eq('product_id', id)
  const invIds = (invRows.data || []).map(r => r.id)
  if (invIds.length > 0) {
    await admin.from('inventory_adjustments').delete().in('inventory_id', invIds)
    await admin.from('inventory_movements').delete().eq('product_id', id)
  }
  await admin.from('order_items').delete().eq('product_id', id)
  await admin.from('inventory').delete().eq('product_id', id)
  await admin.from('product_barcodes').delete().eq('product_id', id)
  await admin.from('product_components').delete().eq('product_id', id)
  await admin.from('products').delete().eq('id', id)

  return NextResponse.json({ ok: true })
}
