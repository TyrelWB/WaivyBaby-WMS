import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import AdminSidebar from './sidebar'
import { AdminContextProvider } from './admin-context'
import { Search } from 'lucide-react'

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
      <div className="flex h-screen overflow-hidden bg-[#F2F3F5]">
        <AdminSidebar email={user.email ?? ''} />
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Top bar */}
          <header className="h-14 flex items-center px-5 gap-3 bg-[#F2F3F5] shrink-0">
            <div className="flex-1 max-w-xl mx-auto relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search orders, products, workers..."
                className="w-full bg-white border border-gray-200 rounded-xl pl-8 pr-4 py-2 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/30 focus:border-cyan-400 transition-all shadow-sm"
              />
            </div>
          </header>
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
    </AdminContextProvider>
  )
}
