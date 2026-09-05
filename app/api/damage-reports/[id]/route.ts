import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: adminUser } = await admin.from('admin_users').select('org_id').eq('id', user.id).single()
  if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const { status, reviewed_by } = body

  const { data: report } = await admin.from('damage_reports').select('*').eq('id', id).single()
  if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // If returning to stock, add back to inventory
  if (status === 'returned_to_stock' && report.product_id) {
    const { data: inv } = await admin
      .from('inventory')
      .select('qty_on_hand, qty_available, qty_damaged')
      .eq('product_id', report.product_id)
      .single()

    if (inv) {
      await admin.from('inventory').update({
        qty_on_hand: (inv.qty_on_hand || 0) + report.quantity,
        qty_available: (inv.qty_available || 0) + report.quantity,
        qty_damaged: Math.max(0, (inv.qty_damaged || 0) - report.quantity),
        updated_at: new Date().toISOString(),
      }).eq('product_id', report.product_id)
    }
  }

  const { data, error } = await admin
    .from('damage_reports')
    .update({
      status,
      reviewed_by: reviewed_by || null,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('org_id', adminUser.org_id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
