import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import sql from '@/lib/db'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: adminUser } = await admin.from('admin_users').select('org_id').eq('id', user.id).single()
  if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { is_sub_product } = await req.json()

  try {
    await sql`UPDATE public.products SET is_sub_product = ${is_sub_product} WHERE id = ${id} AND org_id = ${adminUser.org_id}`
  } catch (e: any) {
    console.error('sub-product update error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
