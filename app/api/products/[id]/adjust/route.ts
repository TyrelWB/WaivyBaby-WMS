import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordInventoryMovement } from '@/lib/inventory-utils'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let orgId: string | null = null

  // Try admin auth first
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const admin = createAdminClient()
    const { data: adminUser } = await admin.from('admin_users').select('org_id').eq('id', user.id).single()
    orgId = adminUser?.org_id || null
  }

  // Fall back to worker session cookie
  if (!orgId) {
    const cookieStore = await cookies()
    const raw = cookieStore.get('wms_worker_session')
    if (raw) {
      try { orgId = JSON.parse(raw.value).orgId || null } catch {}
    }
  }

  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { qty_change, movement_type, note } = await req.json()

  const result = await recordInventoryMovement({
    orgId,
    productId: id,
    movementType: movement_type || 'adjust',
    quantityChange: qty_change,
    note: note || 'Manual adjustment',
    syncBundles: true,
  })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true, qty_on_hand: result.qty_on_hand, qty_available: result.qty_available })
}
