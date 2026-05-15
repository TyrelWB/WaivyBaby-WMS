import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function GET() {
  const cookieStore = await cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    }
  )

  // Get the authenticated user from the anon client (to verify session)
  const anonClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    }
  )

  const { data: { user } } = await anonClient.auth.getUser()
  if (!user) return NextResponse.json(null, { status: 401 })

  const { data } = await supabase
    .from('admin_users')
    .select('org_id, warehouse_id, role')
    .eq('id', user.id)
    .single()

  if (!data) return NextResponse.json(null, { status: 404 })

  return NextResponse.json(data)
}
