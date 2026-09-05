'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { createClient } from '@/lib/supabase/client'
import {
  LayoutDashboard, Package, ShoppingCart, Users,
  BarChart2, Settings, LogOut, Truck,
  RotateCcw, ShoppingBasket, Link2, FileText,
  MapPin, Warehouse, ClipboardList, AlertTriangle, Zap, CalendarCheck, Sparkles
} from 'lucide-react'

const groups = [
  [
    { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { href: '/analytics', icon: BarChart2, label: 'Analytics' },
  ],
  [
    { href: '/orders', icon: ShoppingCart, label: 'Orders' },
    { href: '/receiving', icon: Truck, label: 'Receiving' },
    { href: '/returns', icon: RotateCcw, label: 'Returns' },
    { href: '/reports', icon: FileText, label: 'Reports' },
    { href: '/daily-report', icon: CalendarCheck, label: 'Daily Report' },
    { href: '/damage-reports', icon: Zap, label: 'Damage Reports' },
  ],
  [
    { href: '/inventory', icon: Package, label: 'Inventory' },
    { href: '/restock', icon: AlertTriangle, label: 'Restock Alerts' },
    { href: '/shopping-list', icon: ClipboardList, label: 'Shopping List' },
    { href: '/locations', icon: MapPin, label: 'Locations' },
    { href: '/baskets', icon: ShoppingBasket, label: 'Baskets' },
  ],
  [
    { href: '/workers', icon: Users, label: 'Workers' },
    { href: '/incident-log', icon: AlertTriangle, label: 'Incident Log' },
    { href: '/cleaning', icon: Sparkles, label: 'Cleaning' },
  ],
]

const bottomItems = [
  { href: '/integrations', icon: Link2, label: 'Integrations' },
  { href: '/settings', icon: Settings, label: 'Settings' },
]

function Tooltip({ label, anchorRef }: { label: string; anchorRef: React.RefObject<HTMLElement | null> }) {
  const [style, setStyle] = useState<React.CSSProperties>({})
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect()
      setStyle({
        position: 'fixed',
        top: rect.top + rect.height / 2,
        left: rect.right + 10,
        transform: 'translateY(-50%)',
        zIndex: 9999,
      })
    }
  }, [anchorRef])

  if (!mounted) return null
  return createPortal(
    <div
      style={style}
      className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-xs font-medium whitespace-nowrap shadow-xl pointer-events-none border border-white/10"
    >
      {label}
    </div>,
    document.body
  )
}

function NavItem({ href, icon: Icon, label, active }: { href: string; icon: React.ElementType; label: string; active: boolean }) {
  const [hovered, setHovered] = useState(false)
  const ref = useRef<HTMLAnchorElement>(null)

  return (
    <>
      <a
        ref={ref}
        href={href}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={`relative w-10 h-10 flex items-center justify-center rounded-xl transition-all ${
          active
            ? 'bg-cyan-500/15 text-cyan-400'
            : 'text-gray-500 hover:bg-white/5 hover:text-gray-300'
        }`}
      >
        {active && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-cyan-400 rounded-r-full -ml-2" />
        )}
        <Icon size={17} />
      </a>
      {hovered && <Tooltip label={label} anchorRef={ref} />}
    </>
  )
}

function LogoutButton({ onLogout }: { onLogout: () => void }) {
  const [hovered, setHovered] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)

  return (
    <>
      <button
        ref={ref}
        onClick={onLogout}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="w-10 h-10 flex items-center justify-center rounded-xl text-gray-600 hover:bg-red-900/20 hover:text-red-400 transition-all mt-1"
      >
        <LogOut size={17} />
      </button>
      {hovered && <Tooltip label="Sign out" anchorRef={ref} />}
    </>
  )
}

export default function AdminSidebar({ email }: { email: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <aside className="w-[60px] bg-[#111318] flex flex-col min-h-screen shrink-0 border-r border-white/5">
      {/* Logo */}
      <div className="flex items-center justify-center h-14 border-b border-white/5">
        <div className="w-8 h-8 bg-cyan-500 rounded-lg flex items-center justify-center">
          <Warehouse size={15} className="text-white" />
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 flex flex-col gap-4 py-4 overflow-y-auto">
        {groups.map((group, gi) => (
          <div key={gi} className="flex flex-col items-center gap-0.5 px-2">
            {group.map(link => {
              const active = pathname === link.href || (link.href !== '/dashboard' && pathname.startsWith(link.href))
              return <NavItem key={link.href} href={link.href} icon={link.icon} label={link.label} active={active} />
            })}
            {gi < groups.length - 1 && (
              <div className="w-6 h-px bg-white/8 my-2 mx-auto" />
            )}
          </div>
        ))}
      </nav>

      {/* Bottom */}
      <div className="flex flex-col items-center gap-0.5 px-2 pb-4 border-t border-white/5 pt-3">
        {bottomItems.map(link => {
          const active = pathname.startsWith(link.href)
          return <NavItem key={link.href} href={link.href} icon={link.icon} label={link.label} active={active} />
        })}
        <LogoutButton onLogout={handleLogout} />
      </div>
    </aside>
  )
}
