import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Default parcel size (inches) — the WMS only tracks package weight, not dimensions,
// so every shipment is rated as if packed in a generic small box.
const DEFAULT_PARCEL = { length: '10', width: '8', height: '4', distance_unit: 'in' }

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: adminUser } = await admin.from('admin_users').select('org_id').eq('id', user.id).single()
  if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orderId, weightOz } = await req.json()
  if (!orderId) return NextResponse.json({ error: 'Missing orderId' }, { status: 400 })

  const { data: integration } = await admin
    .from('integrations')
    .select('credentials')
    .eq('org_id', adminUser.org_id)
    .eq('provider', 'shippo')
    .single()

  const creds = integration?.credentials
  if (!creds?.api_key) {
    return NextResponse.json({ error: 'Shippo not configured' }, { status: 400 })
  }
  if (!creds.ship_from_street1 || !creds.ship_from_city || !creds.ship_from_state || !creds.ship_from_zip) {
    return NextResponse.json({ error: 'Ship-from address not configured — set it in Integrations' }, { status: 400 })
  }

  if (weightOz) {
    await admin.from('orders').update({ weight_oz: Math.round(weightOz) }).eq('id', orderId).eq('org_id', adminUser.org_id)
  }

  const { data: order } = await admin
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .eq('org_id', adminUser.org_id)
    .single()

  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (!order.shipping_zip) return NextResponse.json({ error: 'Shipping address required' }, { status: 400 })
  if (!order.weight_oz) return NextResponse.json({ error: 'Package weight required' }, { status: 400 })

  const payload = {
    address_from: {
      name: creds.ship_from_name || 'Warehouse',
      street1: creds.ship_from_street1,
      street2: creds.ship_from_street2 || '',
      city: creds.ship_from_city,
      state: creds.ship_from_state,
      zip: creds.ship_from_zip,
      country: creds.ship_from_country || 'US',
      phone: creds.ship_from_phone || '',
      email: creds.ship_from_email || '',
    },
    address_to: {
      name: order.shipping_name || order.customer_name || 'Customer',
      street1: order.shipping_address_1 || '',
      street2: order.shipping_address_2 || '',
      city: order.shipping_city || '',
      state: order.shipping_state || '',
      zip: order.shipping_zip,
      country: order.shipping_country || 'US',
      phone: order.shipping_phone || '',
    },
    parcels: [{
      ...DEFAULT_PARCEL,
      weight: String(order.weight_oz),
      mass_unit: 'oz',
    }],
    async: false,
  }

  const res = await fetch('https://api.goshippo.com/shipments/', {
    method: 'POST',
    headers: {
      'Authorization': `ShippoToken ${creds.api_key.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const text = await res.text()
    return NextResponse.json({ error: `Shippo error (${res.status}): ${text.slice(0, 400)}` }, { status: 400 })
  }

  const data = await res.json()
  const rawRates: any[] = data.rates || []

  const rates = rawRates
    .filter(r => r.amount)
    .map(r => ({
      rateId: r.object_id,
      carrierCode: r.provider,
      serviceCode: r.servicelevel?.token || r.servicelevel?.name,
      serviceName: r.servicelevel?.name || r.provider,
      shipmentCost: parseFloat(r.amount),
      otherCost: 0,
      transitDays: r.estimated_days ?? null,
    }))
    .sort((a, b) => a.shipmentCost - b.shipmentCost)

  return NextResponse.json({ rates })
}
