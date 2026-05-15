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

  const { data, error } = await admin
    .from('integrations')
    .select('provider, is_enabled, credentials, last_synced_at')
    .eq('org_id', adminUser.org_id)

  if (error) return NextResponse.json({ wix: null, shipstation: null, needsMigration: true })

  const result: Record<string, unknown> = { wix: null, shipstation: null }
  for (const row of data || []) {
    const creds = row.credentials || {}
    const fields = Object.keys(creds).filter(k => !!creds[k])
    result[row.provider] = {
      configured: fields.length > 0,
      fields,
      last_synced_at: row.last_synced_at,
      is_enabled: row.is_enabled,
    }
  }

  return NextResponse.json(result)
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: adminUser } = await admin.from('admin_users').select('org_id').eq('id', user.id).single()
  if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { provider, credentials } = body
  if (!provider) return NextResponse.json({ error: 'Missing provider' }, { status: 400 })

  // Merge: only update fields that have new non-empty values
  const { data: existing } = await admin
    .from('integrations')
    .select('credentials')
    .eq('org_id', adminUser.org_id)
    .eq('provider', provider)
    .single()

  const merged = { ...(existing?.credentials || {}) }
  for (const [key, value] of Object.entries(credentials || {})) {
    if (value && typeof value === 'string' && value.trim()) {
      merged[key] = value.trim()
    }
  }

  const { error } = await admin.from('integrations').upsert({
    org_id: adminUser.org_id,
    provider,
    credentials: merged,
    is_enabled: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'org_id,provider' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
