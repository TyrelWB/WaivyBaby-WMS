import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cookies } from 'next/headers'

async function getRequester(): Promise<{ orgId: string; isAdmin: boolean } | null> {
  const admin = createAdminClient()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const { data } = await admin.from('admin_users').select('org_id').eq('id', user.id).single()
    return data ? { orgId: data.org_id, isAdmin: true } : null
  }

  const cookieStore = await cookies()
  const raw = cookieStore.get('wms_worker_session')
  if (raw) {
    try {
      const session = JSON.parse(raw.value)
      return session.orgId ? { orgId: session.orgId, isAdmin: false } : null
    } catch { return null }
  }
  return null
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requester = await getRequester()
  if (!requester) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const { status } = body

  // Workers (Inventory Control) can only mark items received — placing the order is admin-only.
  if (!requester.isAdmin && status !== 'received') {
    return NextResponse.json({ error: 'Only admin can mark items as ordered' }, { status: 403 })
  }

  const updates: Record<string, any> = { status, updated_at: new Date().toISOString() }
  if (status === 'ordered') updates.ordered_at = new Date().toISOString()
  if (status === 'received') updates.received_at = new Date().toISOString()

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('supply_requests')
    .update(updates)
    .eq('id', id)
    .eq('org_id', requester.orgId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: adminUser } = await admin.from('admin_users').select('org_id').eq('id', user.id).single()
  if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { error } = await admin
    .from('supply_requests')
    .delete()
    .eq('id', id)
    .eq('org_id', adminUser.org_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
