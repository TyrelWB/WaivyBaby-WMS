import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

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
  await admin.from('products').delete().eq('id', id)

  return NextResponse.json({ ok: true })
}
