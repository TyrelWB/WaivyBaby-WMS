import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: adminUser } = await admin.from('admin_users').select('org_id').eq('id', user.id).single()
  if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orderId, carrierCode, serviceCode, rateId } = await req.json()
  if (!orderId || !rateId) {
    return NextResponse.json({ error: 'Missing orderId or rateId' }, { status: 400 })
  }

  const { data: integration } = await admin
    .from('integrations')
    .select('credentials')
    .eq('org_id', adminUser.org_id)
    .eq('provider', 'shippo')
    .single()

  if (!integration?.credentials?.api_key) {
    return NextResponse.json({ error: 'Shippo not configured' }, { status: 400 })
  }

  const { data: order } = await admin
    .from('orders')
    .select('id')
    .eq('id', orderId)
    .eq('org_id', adminUser.org_id)
    .single()

  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const res = await fetch('https://api.goshippo.com/transactions/', {
    method: 'POST',
    headers: {
      'Authorization': `ShippoToken ${integration.credentials.api_key.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ rate: rateId, label_file_type: 'PDF', async: false }),
  })

  if (!res.ok) {
    const text = await res.text()
    return NextResponse.json({ error: `Shippo error (${res.status}): ${text.slice(0, 400)}` }, { status: 400 })
  }

  const transaction = await res.json()

  if (transaction.status !== 'SUCCESS') {
    const messages = (transaction.messages || []).map((m: any) => m.text).join('; ') || 'Label creation failed'
    return NextResponse.json({ error: messages }, { status: 400 })
  }

  const trackingNumber = transaction.tracking_number
  const labelUrl = transaction.label_url

  await admin.from('orders').update({
    tracking_number: trackingNumber,
    carrier: carrierCode,
    status: 'shipping',
  }).eq('id', orderId)

  await admin.from('order_integrations').upsert({
    org_id: adminUser.org_id,
    order_id: orderId,
    provider: 'shippo',
    external_id: transaction.object_id,
    tracking_number: trackingNumber,
    carrier: carrierCode,
    label_url: labelUrl,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'order_id,provider' })

  return NextResponse.json({ tracking: trackingNumber, labelUrl, carrier: carrierCode, service: serviceCode })
}
