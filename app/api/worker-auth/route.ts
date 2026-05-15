import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cookies } from 'next/headers'

export async function POST(request: Request) {
  const { pin } = await request.json()
  if (!pin) return NextResponse.json({ error: 'PIN required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: worker } = await admin
    .from('workers')
    .select('id, name, role, org_id, warehouse_id')
    .eq('pin', pin)
    .eq('is_active', true)
    .single()

  if (!worker) return NextResponse.json({ error: 'Invalid PIN' }, { status: 401 })

  const cookieStore = await cookies()
  cookieStore.set('wms_worker_session', JSON.stringify({
    workerId: worker.id,
    name: worker.name,
    role: worker.role,
    orgId: worker.org_id,
    warehouseId: worker.warehouse_id,
  }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 12, // 12 hours
    path: '/',
  })

  return NextResponse.json({ workerId: worker.id, name: worker.name, role: worker.role })
}

export async function DELETE() {
  const cookieStore = await cookies()
  cookieStore.delete('wms_worker_session')
  return NextResponse.json({ ok: true })
}
