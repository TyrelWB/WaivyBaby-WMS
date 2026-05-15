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

  const { orderId } = await req.json()

  const { data: integration } = await admin
    .from('integrations')
    .select('credentials')
    .eq('org_id', adminUser.org_id)
    .eq('provider', 'shipstation')
    .single()

  if (!integration?.credentials?.api_key || !integration?.credentials?.api_secret) {
    return NextResponse.json({ error: 'ShipStation not configured' }, { status: 400 })
  }

  const { data: orderInt } = await admin
    .from('order_integrations')
    .select('external_id')
    .eq('order_id', orderId)
    .eq('provider', 'shipstation')
    .single()

  if (!orderInt?.external_id) {
    return NextResponse.json({ error: 'Order not pushed to ShipStation yet' }, { status: 400 })
  }

  const { api_key, api_secret } = integration.credentials
  const auth = 'Basic ' + Buffer.from(`${api_key}:${api_secret}`).toString('base64')

  const ssRes = await fetch(`https://ssapi.shipstation.com/shipments?orderId=${orderInt.external_id}&includeShipmentItems=false`, {
    headers: { 'Authorization': auth },
  })

  if (!ssRes.ok) {
    return NextResponse.json({ error: `ShipStation error (${ssRes.status})` }, { status: 400 })
  }

  const data = await ssRes.json()
  const shipments: any[] = data.shipments || []

  if (shipments.length === 0) {
    return NextResponse.json({ tracking: null, message: 'No label created in ShipStation yet' })
  }

  // Use the most recent shipment
  const latest = shipments.sort((a: any, b: any) => new Date(b.shipDate).getTime() - new Date(a.shipDate).getTime())[0]
  const trackingNumber = latest.trackingNumber
  const carrier = latest.carrierCode
  const service = latest.serviceCode

  await admin.from('order_integrations').update({
    tracking_number: trackingNumber,
    carrier,
    updated_at: new Date().toISOString(),
  }).eq('order_id', orderId).eq('provider', 'shipstation')

  if (trackingNumber) {
    await admin.from('orders').update({
      tracking_number: trackingNumber,
      carrier: carrier || null,
    }).eq('id', orderId)
  }

  return NextResponse.json({ tracking: trackingNumber, carrier, service, shipDate: latest.shipDate })
}
