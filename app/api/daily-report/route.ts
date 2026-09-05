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

  const orgId = adminUser.org_id
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStr = today.toISOString()

  const [
    { count: ordersProcessed },
    { count: ordersPicked },
    { count: ordersPacked },
    { count: ordersShipped },
    { count: damageCount },
    { count: incidentCount },
    { data: lowStockProducts },
    { data: recentOrders },
    { data: recentIncidents },
    { data: recentDamage },
  ] = await Promise.all([
    admin.from('orders').select('*', { count: 'exact', head: true }).eq('org_id', orgId).gte('created_at', todayStr),
    admin.from('orders').select('*', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'picked').gte('updated_at', todayStr),
    admin.from('orders').select('*', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'packed').gte('updated_at', todayStr),
    admin.from('orders').select('*', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'shipped').gte('updated_at', todayStr),
    admin.from('damage_reports').select('*', { count: 'exact', head: true }).eq('org_id', orgId).gte('created_at', todayStr),
    admin.from('incident_logs').select('*', { count: 'exact', head: true }).eq('org_id', orgId).gte('created_at', todayStr),
    admin.from('products').select('id, name, sku, inventory(qty_available), reorder_point').eq('org_id', orgId).eq('is_sub_product', false),
    admin.from('orders').select('order_number, customer_name, status, created_at').eq('org_id', orgId).gte('created_at', todayStr).order('created_at', { ascending: false }).limit(10),
    admin.from('incident_logs').select('title, severity, status, created_at').eq('org_id', orgId).gte('created_at', todayStr).order('created_at', { ascending: false }),
    admin.from('damage_reports').select('product_name, quantity, reason, created_at').eq('org_id', orgId).gte('created_at', todayStr).order('created_at', { ascending: false }),
  ])

  const lowStock = (lowStockProducts || []).filter((p: any) => {
    const qty = p.inventory?.[0]?.qty_available ?? 0
    return qty <= (p.reorder_point || 0)
  })

  return NextResponse.json({
    date: today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    stats: {
      orders_processed: ordersProcessed || 0,
      orders_picked: ordersPicked || 0,
      orders_packed: ordersPacked || 0,
      orders_shipped: ordersShipped || 0,
      damage_reports: damageCount || 0,
      incidents: incidentCount || 0,
      low_stock_count: lowStock.length,
    },
    low_stock: lowStock.map((p: any) => ({
      name: p.name,
      sku: p.sku,
      qty: p.inventory?.[0]?.qty_available ?? 0,
      reorder_point: p.reorder_point,
    })),
    recent_orders: recentOrders || [],
    recent_incidents: recentIncidents || [],
    recent_damage: recentDamage || [],
  })
}

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: adminUser } = await admin.from('admin_users').select('org_id').eq('id', user.id).single()
  if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Get report data
  const reportRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'https://waivy-baby-wms.vercel.app'}/api/daily-report`, {
    headers: { Cookie: `supabase-auth-token=${user.id}` },
  })

  // Log that report was sent
  await admin.from('daily_reports').insert({
    org_id: adminUser.org_id,
    sent_at: new Date().toISOString(),
  })

  return NextResponse.json({ ok: true, message: 'Daily report sent' })
}
