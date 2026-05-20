import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import sql from '@/lib/db'

async function getAuth() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: adminUser } = await admin.from('admin_users').select('org_id').eq('id', user.id).single()
  if (!adminUser) return null
  return adminUser.org_id as string
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const orgId = await getAuth()
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rows = await sql`
    SELECT
      pc.sub_product_id,
      pc.quantity,
      p.name,
      p.sku,
      p.image_url
    FROM public.product_components pc
    JOIN public.products p ON pc.sub_product_id = p.id
    WHERE pc.product_id = ${id}
    ORDER BY p.name
  `

  return NextResponse.json(rows)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const orgId = await getAuth()
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { sub_product_id, quantity } = await req.json()
  if (!sub_product_id || !quantity || quantity < 1) {
    return NextResponse.json({ error: 'sub_product_id and quantity required' }, { status: 400 })
  }

  try {
    await sql`
      DELETE FROM public.product_components
      WHERE product_id = ${id} AND sub_product_id = ${sub_product_id}
    `
    await sql`
      INSERT INTO public.product_components (product_id, sub_product_id, quantity)
      VALUES (${id}, ${sub_product_id}, ${quantity})
    `
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const orgId = await getAuth()
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { sub_product_id } = await req.json()
  if (!sub_product_id) return NextResponse.json({ error: 'sub_product_id required' }, { status: 400 })

  try {
    await sql`
      DELETE FROM public.product_components
      WHERE product_id = ${id} AND sub_product_id = ${sub_product_id}
    `
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
