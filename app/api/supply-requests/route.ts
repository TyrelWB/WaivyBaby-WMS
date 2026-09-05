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

  // Worker session
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
    .from('supply_requests')
    .select('*')
    .eq('org_id', orgId)
    .neq('status', 'received')
    .order('priority', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}

export async function POST(req: NextRequest) {
  const orgId = await getOrgId()
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { item_name, quantity, unit, priority, notes, requested_by } = body

  if (!item_name?.trim()) return NextResponse.json({ error: 'Item name required' }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin.from('supply_requests').insert({
    org_id: orgId,
    item_name: item_name.trim(),
    quantity: parseInt(quantity) || 1,
    unit: unit?.trim() || 'units',
    priority: priority || 'normal',
    notes: notes?.trim() || null,
    requested_by: requested_by?.trim() || null,
    status: 'pending',
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
