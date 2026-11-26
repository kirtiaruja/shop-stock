import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  LayoutDashboard,
  ShoppingCart,
  ReceiptText,
  PackagePlus,
  Truck,
  Boxes,
  Users,
  UserCog,
  Wallet,
  ArrowLeftRight,
  Factory,
  LogOut,
  Menu,
  X,
} from 'lucide-react'
import { roleLabel, useAuth, usePermissions } from '../lib/auth'

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, who: 'staff' },
  { to: '/sale/new', label: 'New Sale', icon: ShoppingCart, who: 'staff' },
  { to: '/sales', label: 'Sales', icon: ReceiptText, who: 'staff' },
  { to: '/purchase/new', label: 'New Purchase', icon: PackagePlus, who: 'manager' },
  { to: '/purchases', label: 'Purchases', icon: Truck, who: 'manager' },
  { to: '/products', label: 'Products', icon: Boxes, who: 'staff' },
  { to: '/dues', label: 'Dues (udhaar)', icon: Wallet, who: 'staff' },
  { to: '/payments', label: 'Payments', icon: ArrowLeftRight, who: 'staff' },
  { to: '/customers', label: 'Customers', icon: Users, who: 'staff' },
  { to: '/suppliers', label: 'Suppliers', icon: Factory, who: 'manager' },
  { to: '/users', label: 'Users', icon: UserCog, who: 'admin' },
] as const

export default function Layout() {
  const { profile, signOut } = useAuth()
  const { isAdmin, isManager } = usePermissions()
  const [open, setOpen] = useState(false)

  const items = nav.filter((n) => n.who === 'staff' || (n.who === 'manager' && isManager) || (n.who === 'admin' && isAdmin))
  const bottom = items.filter((n) => ['/', '/sale/new', '/purchase/new', '/products'].includes(n.to))

  const link = (n: (typeof nav)[number]) => (
    <NavLink
      key={n.to}
      to={n.to}
      end={n.to === '/'}
      onClick={() => setOpen(false)}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
          isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'
        }`
      }
    >
      <n.icon className="h-5 w-5" />
      {n.label}
    </NavLink>
  )

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-lg font-bold text-white">S</div>
        <div>
          <div className="font-semibold text-slate-900">StockPilot</div>
          <div className="text-xs text-slate-500">Shop stock manager</div>
        </div>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3">{items.map(link)}</nav>
      <div className="border-t border-slate-100 p-3">
        <div className="px-3 pb-2">
          <div className="truncate text-sm font-medium text-slate-800">{profile?.full_name || profile?.email}</div>
          <div className="text-xs text-slate-500">{profile ? roleLabel[profile.role] : ''}</div>
        </div>
        <button
          onClick={signOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          <LogOut className="h-5 w-5" /> Sign out
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-50">
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 border-r border-slate-200 bg-white lg:block print:hidden">{sidebar}</aside>

      {/* mobile top bar */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden print:hidden">
        <button onClick={() => setOpen(true)} className="rounded-lg p-1 text-slate-600 hover:bg-slate-100" aria-label="Open menu">
          <Menu className="h-6 w-6" />
        </button>
        <span className="font-semibold text-slate-900">StockPilot</span>
        <span className="w-8" />
      </header>

      {/* mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <aside className="absolute inset-y-0 left-0 w-72 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setOpen(false)} className="absolute right-3 top-4 rounded-lg p-1 text-slate-500" aria-label="Close menu">
              <X className="h-5 w-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <main className="px-4 pb-24 pt-4 sm:px-6 lg:ml-60 lg:px-8 lg:pb-8 lg:pt-6 print:m-0 print:p-0">
        <Outlet />
      </main>

      {/* mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid border-t border-slate-200 bg-white lg:hidden print:hidden" style={{ gridTemplateColumns: `repeat(${bottom.length}, 1fr)` }}>
        {bottom.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${isActive ? 'text-indigo-600' : 'text-slate-500'}`
            }
          >
            <n.icon className="h-5 w-5" />
            {n.label.replace('New ', '')}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
