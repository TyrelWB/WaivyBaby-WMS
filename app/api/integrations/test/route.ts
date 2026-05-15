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

  const { provider } = await req.json()

  const { data: integration } = await admin
    .from('integrations')
    .select('credentials')
    .eq('org_id', adminUser.org_id)
    .eq('provider', provider)
    .single()

  if (!integration?.credentials) {
    return NextResponse.json({ ok: false, error: 'Not configured' })
  }

  const creds = integration.credentials

  if (provider === 'wix') {
    if (!creds.api_key || !creds.site_id) {
      return NextResponse.json({ ok: false, error: 'Missing API key or Site ID' })
    }
    try {
      const res = await fetch('https://www.wixapis.com/ecommerce/v1/orders/query', {
        method: 'POST',
        headers: {
          'Authorization': creds.api_key,
          'wix-site-id': creds.site_id,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: { paging: { limit: 1 } } }),
      })
      if (!res.ok) {
        const text = await res.text()
        return NextResponse.json({ ok: false, error: `Wix responded ${res.status}: ${text.slice(0, 200)}` })
      }
      return NextResponse.json({ ok: true })
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e.message })
    }
  }

  if (provider === 'shipstation') {
    if (!creds.api_key || !creds.api_secret) {
      return NextResponse.json({ ok: false, error: 'Missing API key or secret' })
    }
    const auth = 'Basic ' + Buffer.from(`${creds.api_key}:${creds.api_secret}`).toString('base64')
    try {
      const res = await fetch('https://ssapi.shipstation.com/carriers', {
        headers: { 'Authorization': auth },
      })
      if (!res.ok) {
        return NextResponse.json({ ok: false, error: `ShipStation responded ${res.status}` })
      }
      return NextResponse.json({ ok: true })
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e.message })
    }
  }

  return NextResponse.json({ ok: false, error: 'Unknown provider' })
}
