import { useEffect, useState, type ComponentType } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  ShoppingCart,
  PackagePlus,
  Boxes,
  Users,
  Wallet,
  ChevronDown,
  LogOut,
  Menu,
  X,
  Plus,
} from 'lucide-react'
import { roleLabel, useAuth, usePermissions } from '../lib/auth'

type Who = 'staff' | 'manager' | 'admin'
interface Item {
  to: string
  label: string
  who: Who
}
interface Group {
  key: string
  label: string
  icon: ComponentType<{ className?: string }>
  who: Who
  to?: string // a group with `to` and no items is a single link
  items?: Item[]
}

const NAV: Group[] = [
  { key: 'dash', label: 'Dashboard', icon: LayoutDashboard, who: 'staff', to: '/' },
  {
    key: 'sales',
    label: 'Sales',
    icon: ShoppingCart,
    who: 'staff',
    items: [
      { to: '/sale/new', label: 'New sale', who: 'staff' },
      { to: '/sales', label: 'All sales', who: 'staff' },
    ],
  },
  {
    key: 'purchases',
    label: 'Purchases',
    icon: PackagePlus,
    who: 'manager',
    items: [
      { to: '/purchase/new', label: 'New purchase', who: 'manager' },
      { to: '/purchases', label: 'All purchases', who: 'manager' },
      { to: '/suppliers', label: 'Suppliers', who: 'manager' },
    ],
  },
  {
    key: 'products',
    label: 'Products',
    icon: Boxes,
    who: 'staff',
    items: [
      { to: '/products', label: 'All products', who: 'staff' },
      { to: '/products?filter=low', label: 'Low stock', who: 'staff' },
      { to: '/products?new=1', label: 'Add product', who: 'manager' },
      { to: '/products?import=1', label: 'Import from Excel', who: 'manager' },
      { to: '/products?filter=old', label: 'Old names, no stock', who: 'manager' },
    ],
  },
  {
    key: 'money',
    label: 'Payments',
    icon: Wallet,
    who: 'staff',
    items: [
      { to: '/dues', label: 'Dues (udhaar)', who: 'staff' },
      { to: '/payments', label: 'Payment ledger', who: 'staff' },
    ],
  },
  {
    key: 'people',
    label: 'People',
    icon: Users,
    who: 'staff',
    items: [
      { to: '/customers', label: 'Customers', who: 'staff' },
      { to: '/users', label: 'Users & roles', who: 'admin' },
    ],
  },
]

const OPEN_KEY = 'stockpilot.nav.open'
const readOpen = (): Record<string, boolean> => {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) || '{}')
  } catch {
    return {}
  }
}

/** True when `to` (which may carry a ?query) is the page being shown. */
function isCurrent(to: string, path: string, search: string) {
  const [p, q] = to.split('?')
  if (p !== path) return false
  const want = new URLSearchParams(q ?? '')
  const have = new URLSearchParams(search)
  // "All products" is current only when no sub-view is chosen
  if (!q) return !['filter', 'new', 'import'].some((k) => have.has(k))
  return [...want.entries()].every(([k, v]) => have.get(k) === v)
}

export default function Layout() {
  const { profile, signOut } = useAuth()
  const { isAdmin, isManager } = usePermissions()
  const { pathname, search } = useLocation()
  const [drawer, setDrawer] = useState(false)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(readOpen)

  const allowed = (who: Who) => who === 'staff' || (who === 'manager' && isManager) || (who === 'admin' && isAdmin)
  const groups = NAV.filter((g) => allowed(g.who))
    .map((g) => ({ ...g, items: g.items?.filter((i) => allowed(i.who)) }))
    .filter((g) => g.to || (g.items && g.items.length))

  // keep the section of the current page open
  const activeGroup = groups.find((g) => g.items?.some((i) => i.to.split('?')[0] === pathname))?.key
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (activeGroup) setOpenGroups((o) => (o[activeGroup] ? o : { ...o, [activeGroup]: true }))
  }, [activeGroup])
  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(openGroups))
    } catch {
      /* storage unavailable */
    }
  }, [openGroups])

  // close the phone menu after navigating
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrawer(false)
  }, [pathname, search])

  const toggle = (k: string) => setOpenGroups((o) => ({ ...o, [k]: !o[k] }))

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-lg font-bold text-white">S</div>
        <div>
          <div className="font-semibold text-slate-900">StockPilot</div>
          <div className="text-xs text-slate-500">Shop stock manager</div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-3">
        {groups.map((g) => {
          if (g.to)
            return (
              <NavLink
                key={g.key}
                to={g.to}
                end
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-100'}`
                }
              >
                <g.icon className="h-5 w-5" />
                {g.label}
              </NavLink>
            )
          const open = !!openGroups[g.key]
          const hasActive = g.key === activeGroup
          return (
            <div key={g.key}>
              <button
                onClick={() => toggle(g.key)}
                aria-expanded={open}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${hasActive ? 'text-indigo-700' : 'text-slate-700'} hover:bg-slate-100`}
              >
                <g.icon className="h-5 w-5" />
                <span className="flex-1 text-left">{g.label}</span>
                <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
              </button>
              {open && (
                <div className="mb-1 ml-5 space-y-0.5 border-l border-slate-200 pl-3">
                  {g.items!.map((i) => {
                    const cur = isCurrent(i.to, pathname, search)
                    return (
                      <Link
                        key={i.to}
                        to={i.to}
                        className={`block rounded-md px-3 py-1.5 text-sm ${cur ? 'bg-indigo-50 font-medium text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}
                      >
                        {i.label}
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>
      <div className="border-t border-slate-100 p-3">
        <div className="px-3 pb-2">
          <div className="truncate text-sm font-medium text-slate-800">{profile?.full_name || profile?.email}</div>
          <div className="text-xs text-slate-500">{profile ? roleLabel[profile.role] : ''}</div>
        </div>
        <button onClick={signOut} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
          <LogOut className="h-5 w-5" /> Sign out
        </button>
      </div>
    </div>
  )

  /** Quick "add sale / add purchase" buttons shown at the top of every page. */
  const quick = (
    <div className="flex items-center gap-2">
      <Link
        to="/sale/new"
        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-sm font-medium text-white sm:gap-1.5 sm:px-3 ${pathname === '/sale/new' ? 'bg-indigo-800' : 'bg-indigo-600 hover:bg-indigo-700'}`}
      >
        <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Add</span> <span className="sm:hidden">Sale</span><span className="hidden sm:inline">sale</span>
      </Link>
      {isManager && (
        <Link
          to="/purchase/new"
          className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-2 text-sm font-medium sm:gap-1.5 sm:px-3 ${pathname === '/purchase/new' ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-emerald-600 text-emerald-700 hover:bg-emerald-50'}`}
        >
          <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Add</span> <span className="sm:hidden">Purchase</span><span className="hidden sm:inline">purchase</span>
        </Link>
      )}
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-50">
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 border-r border-slate-200 bg-white lg:block print:hidden">{sidebar}</aside>

      {/* top bar (all screens) */}
      <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur lg:ml-60 lg:px-8 print:hidden">
        <div className="flex items-center gap-2">
          <button onClick={() => setDrawer(true)} className="rounded-lg p-1 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open menu">
            <Menu className="h-6 w-6" />
          </button>
          <span className="hidden font-semibold text-slate-900 min-[400px]:inline lg:hidden">StockPilot</span>
        </div>
        {quick}
      </header>

      {/* phone menu */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" onClick={() => setDrawer(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <aside className="absolute inset-y-0 left-0 w-72 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setDrawer(false)} className="absolute right-3 top-4 rounded-lg p-1 text-slate-500" aria-label="Close menu">
              <X className="h-5 w-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <main className="px-4 pb-24 pt-4 sm:px-6 lg:ml-60 lg:px-8 lg:pb-8 lg:pt-6 print:m-0 print:p-0">
        <Outlet />
      </main>

      {/* phone bottom bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-slate-200 bg-white lg:hidden print:hidden">
        {[
          { to: '/', label: 'Home', icon: LayoutDashboard },
          { to: '/sales', label: 'Sales', icon: ShoppingCart },
          { to: '/products', label: 'Products', icon: Boxes },
          { to: '/dues', label: 'Dues', icon: Wallet },
        ].map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${isActive ? 'text-indigo-600' : 'text-slate-500'}`}
          >
            <n.icon className="h-5 w-5" />
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
