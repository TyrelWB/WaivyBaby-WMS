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

  const { data: integration } = await admin
    .from('integrations')
    .select('credentials')
    .eq('org_id', adminUser.org_id)
    .eq('provider', 'wix')
    .single()

  const creds = integration?.credentials as Record<string, any>
  const secret = creds?.webhook_secret || 'waivybaby2024'

  const veloRes = await fetch(`https://www.waivybaby.com/_functions/getNewOrders?secret=${secret}`)
  const veloText = await veloRes.text()
  let veloData: any
  try { veloData = JSON.parse(veloText) } catch { veloData = veloText }

  const orders = veloData?.orders || []
  const sample = orders.slice(0, 2).map((o: any) => ({
    _id: o._id,
    id: o.id,
    number: o.number,
    paymentStatus: o.paymentStatus,
    lineItemsCount: (o.lineItems || []).length,
    lineItemsSample: (o.lineItems || []).slice(0, 2).map((item: any) => ({
      sku_externalRef: item.catalogReference?.externalReference,
      sku_physical: item.physicalProperties?.sku,
      quantity: item.quantity,
    })),
    hasShipping: !!o.shippingInfo?.logistics?.shippingAddress,
  }))

  return NextResponse.json({ total: orders.length, sample })
}
