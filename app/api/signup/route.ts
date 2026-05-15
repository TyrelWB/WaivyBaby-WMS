import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const { email, password, fullName, orgName } = await request.json()

  if (!email || !password || !orgName) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (authError || !authData.user) {
    return NextResponse.json({ error: authError?.message || 'Failed to create user' }, { status: 400 })
  }

  const userId = authData.user.id
  const slug = orgName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '-' + Date.now()

  const { data: org, error: orgError } = await admin
    .from('organizations')
    .insert({ name: orgName, slug })
    .select('id')
    .single()

  if (orgError || !org) {
    await admin.auth.admin.deleteUser(userId)
    return NextResponse.json({ error: 'Failed to create organization' }, { status: 500 })
  }

  const { data: warehouse, error: warehouseError } = await admin
    .from('warehouses')
    .insert({ org_id: org.id, name: `${orgName} Warehouse`, timezone: 'America/New_York' })
    .select('id')
    .single()

  if (warehouseError || !warehouse) {
    await admin.auth.admin.deleteUser(userId)
    return NextResponse.json({ error: 'Failed to create warehouse' }, { status: 500 })
  }

  const { error: adminError } = await admin.from('admin_users').insert({
    id: userId,
    org_id: org.id,
    warehouse_id: warehouse.id,
    role: 'admin',
    full_name: fullName || null,
  })

  if (adminError) {
    await admin.auth.admin.deleteUser(userId)
    return NextResponse.json({ error: 'Failed to create admin record' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
