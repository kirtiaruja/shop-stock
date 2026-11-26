import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ShoppingCart, PackagePlus, AlertTriangle } from 'lucide-react'
import { supabase, type CatalogItem } from '../lib/supabase'
import { usePermissions, useAuth } from '../lib/auth'
import { money, qty, dateTime } from '../lib/format'
import { Card, PageHeader, Spinner, StockBadge, Button } from '../components/ui'

interface Stats {
  today_total: number
  today_bills: number
  month_total: number
  products: number
  low_stock: number
  month_purchase: number | null
  receivable: number
  payable: number | null
  today_in: number | null
  today_out: number | null
}
interface SaleRow {
  id: number
  customer_name: string | null
  total: number
  due_amount: number
  created_at: string
}

export default function Dashboard() {
  const { isManager } = usePermissions()
  const { profile } = useAuth()
  const [stats, setStats] = useState<Stats | null>(null)
  const [low, setLow] = useState<CatalogItem[]>([])
  const [recent, setRecent] = useState<SaleRow[]>([])
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      const [s, l, r] = await Promise.all([
        supabase.rpc('dashboard_stats'),
        // stock at or below its minimum, lowest first
        supabase.from('product_catalog').select('*').eq('is_low', true).order('stock').limit(10),
        supabase.from('sales').select('id,customer_name,total,due_amount,created_at').order('created_at', { ascending: false }).limit(6),
      ])
      if (s.error) setErr(s.error.message)
      setStats(s.data as Stats)
      setLow((l.data ?? []) as CatalogItem[])
      setRecent((r.data ?? []) as SaleRow[])
    })()
  }, [])

  if (err) return <p className="text-red-600">{err}</p>
  if (!stats) return <Spinner />

  const tiles = [
    { label: isManager ? "Today's sales" : 'My sales today', value: money(stats.today_total), sub: `${stats.today_bills} bills` },
    { label: isManager ? 'This month' : 'My sales this month', value: money(stats.month_total) },
    ...(isManager && stats.month_purchase !== null ? [{ label: 'Purchases this month', value: money(stats.month_purchase) }] : []),
    { label: 'Products', value: String(stats.products), sub: `${stats.low_stock} low / out of stock` },
  ]
  const money2 = [
    { label: 'To receive (udhaar)', value: money(stats.receivable), to: '/dues', tone: 'text-amber-700' },
    ...(isManager
      ? [
          { label: 'To pay suppliers', value: money(stats.payable), to: '/dues', tone: 'text-amber-700' },
          { label: 'Money in today', value: money(stats.today_in), to: '/payments', tone: 'text-emerald-700' },
          { label: 'Money out today', value: money(stats.today_out), to: '/payments', tone: 'text-red-700' },
        ]
      : []),
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Hello, ${profile?.full_name?.split(' ')[0] || 'there'}`}
        subtitle="Here is how the shop is doing"
        actions={
          <>
            <Link to="/sale/new">
              <Button>
                <ShoppingCart className="h-4 w-4" /> New sale
              </Button>
            </Link>
            {isManager && (
              <Link to="/purchase/new">
                <Button variant="secondary">
                  <PackagePlus className="h-4 w-4" /> New purchase
                </Button>
              </Link>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label} className="p-4">
            <div className="text-xs font-medium text-slate-500">{t.label}</div>
            <div className="mt-1 text-lg font-semibold text-slate-900 sm:text-2xl">{t.value}</div>
            {t.sub && <div className="text-xs text-slate-500">{t.sub}</div>}
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {money2.map((t) => (
          <Link key={t.label} to={t.to}>
            <Card className="p-4 hover:border-indigo-300">
              <div className="text-xs font-medium text-slate-500">{t.label}</div>
              <div className={`mt-1 text-lg font-semibold sm:text-xl ${t.tone}`}>{t.value}</div>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 font-medium">
            <AlertTriangle className="h-4 w-4 text-amber-500" /> Low stock
          </div>
          {low.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">Nothing is running low.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {low.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <span className="min-w-0 truncate">{p.name}</span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-slate-500">
                    min {qty(p.min_stock)} <StockBadge stock={p.stock} min={p.min_stock} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <div className="border-b border-slate-100 px-4 py-3 font-medium">Recent bills</div>
          {recent.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">No sales yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {recent.map((s) => (
                <li key={s.id}>
                  <Link to={`/sales?bill=${s.id}`} className="flex items-center justify-between px-4 py-2 text-sm hover:bg-slate-50">
                    <span>
                      <span className="font-medium">#{s.id}</span> · {s.customer_name || 'Walk-in'}
                      <span className="block text-xs text-slate-500">{dateTime(s.created_at)}</span>
                    </span>
                    <span className="text-right">
                      <span className="block font-medium">{money(s.total)}</span>
                      {Number(s.due_amount) > 0 && <span className="text-xs text-amber-700">due {money(s.due_amount)}</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
