import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import AdminSidebar from './sidebar'
import { AdminContextProvider } from './admin-context'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const admin = createAdminClient()
  const { data: adminUser } = await admin
    .from('admin_users')
    .select('org_id, warehouse_id')
    .eq('id', user.id)
    .single()

  if (!adminUser) redirect('/login')

  return (
    <AdminContextProvider orgId={adminUser.org_id} warehouseId={adminUser.warehouse_id}>
      <div className="flex h-screen overflow-hidden bg-gray-50">
        <AdminSidebar email={user.email ?? ''} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </AdminContextProvider>
  )
}
