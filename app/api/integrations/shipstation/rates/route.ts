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

  const api_key = integration.credentials.api_key.trim()
  const api_secret = integration.credentials.api_secret.trim()
  const auth = 'Basic ' + Buffer.from(`${api_key}:${api_secret}`).toString('base64')

  const { data: order } = await admin
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .eq('org_id', adminUser.org_id)
    .single()

  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (!order.shipping_zip) return NextResponse.json({ error: 'Shipping address required' }, { status: 400 })
  if (!order.weight_oz) return NextResponse.json({ error: 'Package weight required' }, { status: 400 })

  // Get warehouse ship-from postal code
  const warehouseRes = await fetch('https://ssapi.shipstation.com/warehouses', {
    headers: { 'Authorization': auth },
  })
  let fromPostalCode = '10001'
  if (warehouseRes.ok) {
    const warehouses = await warehouseRes.json()
    if (Array.isArray(warehouses) && warehouses.length > 0) {
      fromPostalCode = warehouses[0].originAddress?.postalCode || fromPostalCode
    }
  }

  // Get connected carriers
  const carriersRes = await fetch('https://ssapi.shipstation.com/carriers', {
    headers: { 'Authorization': auth },
  })
  if (!carriersRes.ok) return NextResponse.json({ error: 'Failed to fetch carriers' }, { status: 400 })
  const carriers: any[] = await carriersRes.json()
  if (!carriers.length) return NextResponse.json({ error: 'No carriers connected in ShipStation' }, { status: 400 })

  // Fetch rates for each carrier in parallel
  const rateRequests = carriers.map(async (carrier: any) => {
    const body = JSON.stringify({
      carrierCode: carrier.code,
      fromPostalCode,
      toCountry: order.shipping_country || 'US',
      toPostalCode: order.shipping_zip,
      toState: order.shipping_state || '',
      toCity: order.shipping_city || '',
      weight: { value: order.weight_oz, units: 'ounces' },
      residential: true,
    })
    try {
      const res = await fetch('https://ssapi.shipstation.com/shipments/getrates', {
        method: 'POST',
        headers: {
          'Authorization': auth,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body).toString(),
        },
        body,
      })
      if (!res.ok) return []
      const data = await res.json()
      return Array.isArray(data) ? data.map((r: any) => ({ ...r, carrierCode: r.carrierCode || carrier.code })) : []
    } catch {
      return []
    }
  })

  const allRates = (await Promise.all(rateRequests)).flat()
  const seen = new Set<string>()
  const unique = allRates.filter((r: any) => {
    const key = `${r.carrierCode}-${r.serviceCode}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const sorted = unique.sort((a: any, b: any) => (a.shipmentCost + a.otherCost) - (b.shipmentCost + b.otherCost))
  return NextResponse.json({ rates: sorted })
}
