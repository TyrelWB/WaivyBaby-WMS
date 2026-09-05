import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cookies } from 'next/headers'

async function getOrgId(): Promise<string | null> {
  const admin = createAdminClient()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const { data } = await admin.from('admin_users').select('org_id').eq('id', user.id).single()
    return data?.org_id || null
  }
  const cookieStore = await cookies()
  const sessionToken = cookieStore.get('wms_worker_session')?.value
  if (sessionToken) {
    const { data } = await admin.from('worker_sessions').select('org_id').eq('token', sessionToken).eq('is_active', true).single()
    return data?.org_id || null
  }
  return null
}

export async function GET() {
  const orgId = await getOrgId()
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('damage_reports')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}

export async function POST(req: NextRequest) {
  const orgId = await getOrgId()
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { product_id, product_name, quantity, reason, notes, reported_by } = body

  if (!product_name?.trim() || !reason?.trim()) {
    return NextResponse.json({ error: 'Product name and reason required' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Deduct from inventory immediately
  if (product_id) {
    const { data: inv } = await admin
      .from('inventory')
      .select('qty_on_hand, qty_available, qty_damaged')
      .eq('product_id', product_id)
      .single()

    if (inv) {
      await admin.from('inventory').update({
        qty_on_hand: Math.max(0, (inv.qty_on_hand || 0) - quantity),
        qty_available: Math.max(0, (inv.qty_available || 0) - quantity),
        qty_damaged: (inv.qty_damaged || 0) + quantity,
        updated_at: new Date().toISOString(),
      }).eq('product_id', product_id)
    }
  }

  const { data, error } = await admin.from('damage_reports').insert({
    org_id: orgId,
    product_id: product_id || null,
    product_name: product_name.trim(),
    quantity: parseInt(quantity) || 1,
    reason: reason.trim(),
    notes: notes?.trim() || null,
    reported_by: reported_by?.trim() || null,
    status: 'pending',
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
