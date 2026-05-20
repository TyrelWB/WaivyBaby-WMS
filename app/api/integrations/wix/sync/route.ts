import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncWixOrders } from '@/lib/wix-orders'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: adminUser } = await admin.from('admin_users').select('org_id, warehouse_id').eq('id', user.id).single()
  if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await syncWixOrders(adminUser.org_id, adminUser.warehouse_id)

  if (result.errors.length > 0 && result.total === 0) {
    return NextResponse.json({ error: result.errors[0] }, { status: 400 })
  }

  return NextResponse.json(result)
}
