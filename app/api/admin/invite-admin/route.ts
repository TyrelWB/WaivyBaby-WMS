import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%'
  let pw = ''
  for (let i = 0; i < 12; i++) pw += chars[Math.floor(Math.random() * chars.length)]
  return pw
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: requester } = await admin.from('admin_users').select('org_id, warehouse_id').eq('id', user.id).single()
  if (!requester) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { email, fullName } = await req.json()
  if (!email?.trim()) return NextResponse.json({ error: 'Email is required' }, { status: 400 })

  const tempPassword = generateTempPassword()

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: email.trim(),
    password: tempPassword,
    email_confirm: true,
  })
  if (authError || !authData.user) {
    return NextResponse.json({ error: authError?.message || 'Failed to create user' }, { status: 400 })
  }

  const { error: adminError } = await admin.from('admin_users').insert({
    id: authData.user.id,
    org_id: requester.org_id,
    warehouse_id: requester.warehouse_id,
    role: 'admin',
    full_name: fullName?.trim() || null,
  })
  if (adminError) {
    await admin.auth.admin.deleteUser(authData.user.id)
    return NextResponse.json({ error: adminError.message }, { status: 500 })
  }

  return NextResponse.json({ email: email.trim(), tempPassword })
}
