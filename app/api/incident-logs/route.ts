import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cookies } from 'next/headers'

async function getOrgId(): Promise<string | null> {
  const admin = createAdminClient()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const { data } = await admin.from('admin_users').select('org_id').eq('id', user.id).single()
    return data?.org_id || null
  }
  // Worker session cookie is a JSON blob, not a lookup token — parse it directly.
  const cookieStore = await cookies()
  const raw = cookieStore.get('wms_worker_session')
  if (raw) {
    try { return JSON.parse(raw.value).orgId || null } catch { return null }
  }
  return null
}

export async function GET() {
  const orgId = await getOrgId()
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('incident_logs')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}

export async function POST(req: NextRequest) {
  const orgId = await getOrgId()
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { title, description, severity, category, location, reported_by } = body

  if (!title?.trim() || !description?.trim()) {
    return NextResponse.json({ error: 'Title and description required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin.from('incident_logs').insert({
    org_id: orgId,
    title: title.trim(),
    description: description.trim(),
    severity: severity || 'low',
    category: category || 'other',
    location: location?.trim() || null,
    reported_by: reported_by?.trim() || null,
    status: 'open',
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
