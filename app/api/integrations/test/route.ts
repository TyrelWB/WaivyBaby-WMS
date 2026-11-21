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

  if (provider === 'shippo') {
    if (!creds.api_key) {
      return NextResponse.json({ ok: false, error: 'Missing API key' })
    }
    try {
      const res = await fetch('https://api.goshippo.com/carrier_accounts/', {
        headers: { 'Authorization': `ShippoToken ${creds.api_key.trim()}` },
      })
      if (!res.ok) {
        return NextResponse.json({ ok: false, error: `Shippo responded ${res.status}` })
      }
      return NextResponse.json({ ok: true })
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e.message })
    }
  }

  return NextResponse.json({ ok: false, error: 'Unknown provider' })
}
