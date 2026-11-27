import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, Pencil, SlidersHorizontal } from 'lucide-react'
import { supabase, type CatalogItem } from '../lib/supabase'
import { usePermissions } from '../lib/auth'
import { money, qty as fmtQty, dateTime } from '../lib/format'
import { Badge, Button, Empty, Modal, Spinner, StockBadge, useToast } from './ui'

interface Row {
  at: string
  kind: 'sale' | 'purchase' | 'adjust'
  ref_id: number
  party: string | null
  qty: number
  rate: number | null
  amount: number | null
  note: string | null
  by_name: string | null
}

type Tab = 'all' | 'sale' | 'purchase' | 'adjust'

/** Every bill, purchase and stock change for one product — like Vyapar's item details. */
export default function ProductHistory({
  product,
  onClose,
  onEdit,
}: {
  product: (CatalogItem & { purchase_price?: number; location?: string | null }) | null
  onClose: () => void
  onEdit?: () => void
}) {
  const { isManager } = usePermissions()
  const toast = useToast()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [tab, setTab] = useState<Tab>('all')
  const pid = product?.id

  useEffect(() => {
    if (!pid) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRows(null)
    setTab('all')
    supabase.rpc('product_history', { p_id: pid }).then(({ data, error }) => {
      if (error) toast(error.message, false)
      setRows((data ?? []) as Row[])
    })
  }, [pid, toast])

  if (!product) return null

  // Stock after each entry, worked backwards from today's stock (only when we see every entry).
  const after: number[] = []
  if (rows && isManager) {
    let s = Number(product.stock)
    for (const r of rows) {
      after.push(s)
      s -= Number(r.qty)
    }
  }

  const sold = (rows ?? []).filter((r) => r.kind === 'sale').reduce((a, r) => a - Number(r.qty), 0)
  const bought = (rows ?? []).filter((r) => r.kind === 'purchase').reduce((a, r) => a + Number(r.qty), 0)
  const lastSale = rows?.find((r) => r.kind === 'sale')
  const shown = (rows ?? []).map((r, i) => ({ r, i })).filter(({ r }) => tab === 'all' || r.kind === tab)

  const tabs: { k: Tab; label: string }[] = [
    { k: 'all', label: 'All' },
    { k: 'sale', label: 'Sales' },
    ...(isManager
      ? [
          { k: 'purchase' as Tab, label: 'Purchases' },
          { k: 'adjust' as Tab, label: 'Adjustments' },
        ]
      : []),
  ]

  return (
    <Modal open onClose={onClose} title="Item details" wide>
      <div className="space-y-4 text-sm">
        {/* header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-semibold text-slate-900">{product.name}</div>
            <div className="text-xs text-slate-500">
              {product.item_code || 'no code'}
              {product.category ? ` · ${product.category}` : ''}
              {product.location ? ` · ${product.location}` : ''}
            </div>
          </div>
          {isManager && onEdit && (
            <Button variant="secondary" onClick={onEdit}>
              <Pencil className="h-4 w-4" /> Edit
            </Button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="In stock">
            <StockBadge stock={product.stock} min={product.min_stock} />
          </Stat>
          <Stat label="Sale price">{money(product.sale_price)}</Stat>
          {isManager && product.purchase_price != null ? <Stat label="Purchase price">{money(product.purchase_price)}</Stat> : <Stat label="MRP">{product.mrp != null ? money(product.mrp) : '—'}</Stat>}
          <Stat label={isManager ? 'Sold / bought' : 'You sold'}>
            {fmtQty(sold)}
            {isManager && ` / ${fmtQty(bought)}`}
          </Stat>
        </div>
        {lastSale && <p className="text-xs text-slate-500">Last sold {dateTime(lastSale.at)}</p>}

        {/* tabs */}
        <div className="flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1">
          {tabs.map((t) => (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium ${tab === t.k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* list */}
        {rows === null ? (
          <Spinner />
        ) : shown.length === 0 ? (
          <Empty>No entries yet.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {shown.map(({ r, i }) => {
              const inOut = Number(r.qty) >= 0
              const body = (
                <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={`shrink-0 rounded-full p-1.5 ${
                        r.kind === 'adjust' ? 'bg-slate-100 text-slate-600' : inOut ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700'
                      }`}
                    >
                      {r.kind === 'adjust' ? <SlidersHorizontal className="h-3.5 w-3.5" /> : inOut ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-800">
                        {r.kind === 'sale' && `Sale · Bill #${r.ref_id}`}
                        {r.kind === 'purchase' && `Purchase #${r.ref_id}`}
                        {r.kind === 'adjust' && 'Stock adjustment'}
                        {r.party && <span className="font-normal text-slate-500"> · {r.party}</span>}
                      </div>
                      <div className="truncate text-xs text-slate-500">
                        {dateTime(r.at)}
                        {r.rate != null && ` · ${money(r.rate)} each`}
                        {r.note && ` · ${r.note}`}
                        {r.by_name && ` · ${r.by_name}`}
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={`font-semibold ${inOut ? 'text-emerald-700' : 'text-slate-900'}`}>
                      {inOut ? '+' : '−'}
                      {fmtQty(Math.abs(Number(r.qty)))}
                    </div>
                    {isManager && after[i] !== undefined && <div className="text-[11px] text-slate-400">stock {fmtQty(after[i])}</div>}
                  </div>
                </div>
              )
              if (r.kind === 'adjust') return <li key={`a${r.ref_id}`}>{body}</li>
              const to = r.kind === 'sale' ? `/sales?bill=${r.ref_id}` : `/purchases?id=${r.ref_id}`
              return (
                <li key={`${r.kind}${r.ref_id}-${i}`}>
                  <Link to={to} className="block hover:bg-slate-50">
                    {body}
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
        {rows && rows.length >= 500 && (
          <p className="text-xs text-slate-500">
            Showing the latest 500 entries. <Badge>older not shown</Badge>
          </p>
        )}
        {!isManager && <p className="text-xs text-slate-400">You see the bills you made for this item.</p>}
      </div>
    </Modal>
  )
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg bg-slate-50 p-2.5">
      <div className="text-[11px] font-medium text-slate-500">{label}</div>
      <div className="mt-0.5 font-semibold text-slate-900">{children}</div>
    </div>
  )
}
