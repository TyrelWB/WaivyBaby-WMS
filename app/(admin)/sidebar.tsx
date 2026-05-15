'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  LayoutDashboard, Package, ShoppingCart, Users, Warehouse,
  BarChart2, Settings, LogOut, ChevronLeft, ChevronRight,
  AlertTriangle, Truck, RotateCcw, ShoppingBasket, Building2, Link2, FileText
} from 'lucide-react'

const groups = [
  {
    label: 'Overview',
    links: [
      { label: 'Command Center', href: '/dashboard', icon: LayoutDashboard },
      { label: 'Analytics', href: '/analytics', icon: BarChart2 },
    ]
  },
  {
    label: 'Operations',
    links: [
      { label: 'Orders', href: '/orders', icon: ShoppingCart },
      { label: 'Receiving', href: '/receiving', icon: Truck },
      { label: 'Returns', href: '/returns', icon: RotateCcw },
      { label: 'Exceptions', href: '/exceptions', icon: AlertTriangle },
      { label: 'Reports', href: '/reports', icon: FileText },
    ]
  },
  {
    label: 'Warehouse',
    links: [
      { label: 'Inventory', href: '/inventory', icon: Package },
      { label: 'Baskets', href: '/baskets', icon: ShoppingBasket },
    ]
  },
  {
    label: 'Team',
    links: [
      { label: 'Workers', href: '/workers', icon: Users },
      { label: 'Suppliers', href: '/suppliers', icon: Building2 },
    ]
  },
  {
    label: 'Settings',
    links: [
      { label: 'Integrations', href: '/integrations', icon: Link2 },
      { label: 'Settings', href: '/settings', icon: Settings },
    ]
  },
]

export default function AdminSidebar({ email }: { email: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [collapsed, setCollapsed] = useState(false)

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <aside className={`${collapsed ? 'w-16' : 'w-60'} bg-gray-950 border-r border-gray-800 flex flex-col min-h-screen transition-all duration-200 shrink-0`}>
      <div className="flex items-center justify-between px-4 py-5 border-b border-gray-800">
        {!collapsed && (
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-blue-500 rounded-lg flex items-center justify-center shrink-0">
              <Warehouse size={14} className="text-white" />
            </div>
            <div className="flex flex-col leading-none">
              <span className="font-bold text-white text-sm">Waivy WMS</span>
              <span className="text-[10px] font-semibold text-blue-400 tracking-wide">BETA</span>
            </div>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 rounded-lg hover:bg-gray-800 text-gray-500 ml-auto"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-6 overflow-y-auto">
        {groups.map(group => (
          <div key={group.label}>
            {!collapsed && (
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2 px-2">{group.label}</p>
            )}
            <div className="space-y-0.5">
              {group.links.map(link => {
                const Icon = link.icon
                const active = pathname === link.href || (link.href !== '/dashboard' && pathname.startsWith(link.href))
                return (
                  <a
                    key={link.href}
                    href={link.href}
                    title={collapsed ? link.label : undefined}
                    className={`flex items-center gap-3 px-2 py-2 rounded-lg text-sm font-medium transition-colors ${
                      active
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                    }`}
                  >
                    <Icon size={17} />
                    {!collapsed && <span>{link.label}</span>}
                  </a>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="p-3 border-t border-gray-800 space-y-0.5">
        {!collapsed && (
          <div className="px-2 py-2 mb-1">
            <p className="text-xs font-medium text-gray-300 truncate">{email}</p>
            <p className="text-xs text-gray-600">Admin</p>
          </div>
        )}
        <button
          onClick={handleLogout}
          title={collapsed ? 'Sign out' : undefined}
          className="flex items-center gap-3 px-2 py-2 rounded-lg text-sm font-medium text-gray-500 hover:bg-red-950 hover:text-red-400 w-full transition-colors"
        >
          <LogOut size={17} />
          {!collapsed && <span>Sign out</span>}
        </button>
      </div>
    </aside>
  )
}
