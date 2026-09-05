import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: adminUser } = await admin.from('admin_users').select('org_id').eq('id', user.id).single()
  if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await admin
    .from('restock_notifications')
    .select('*')
    .eq('org_id', adminUser.org_id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}

// POST — scan all products and generate notifications for low stock
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: adminUser } = await admin.from('admin_users').select('org_id').eq('id', user.id).single()
  if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const orgId = adminUser.org_id

  // Get all products with inventory and reorder points
  const { data: products } = await admin
    .from('products')
    .select('id, name, sku, reorder_point, inventory(qty_available)')
    .eq('org_id', orgId)
    .eq('is_sub_product', false)
    .gt('reorder_point', 0)

  if (!products?.length) return NextResponse.json({ generated: 0, message: 'No products with reorder points set' })

  let generated = 0
  let skipped = 0

  for (const product of products) {
    const qty = (product.inventory as any)?.[0]?.qty_available ?? 0
    const reorderPoint = product.reorder_point || 0

    if (qty <= reorderPoint) {
      // Check if open notification already exists for this product
      const { data: existing } = await admin
        .from('restock_notifications')
        .select('id')
        .eq('org_id', orgId)
        .eq('product_id', product.id)
        .eq('status', 'open')
        .single()

      if (existing) {
        // Update qty on existing notification
        await admin.from('restock_notifications').update({
          qty_available: qty,
          updated_at: new Date().toISOString(),
        }).eq('id', existing.id)
        skipped++
      } else {
        await admin.from('restock_notifications').insert({
          org_id: orgId,
          product_id: product.id,
          product_name: product.name,
          sku: product.sku,
          qty_available: qty,
          reorder_point: reorderPoint,
          status: 'open',
        })
        generated++
      }
    } else {
      // Auto-resolve if stock is back above reorder point
      await admin.from('restock_notifications').update({
        status: 'resolved',
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('org_id', orgId).eq('product_id', product.id).eq('status', 'open')
    }
  }

  return NextResponse.json({ generated, skipped, total: products.length })
}
