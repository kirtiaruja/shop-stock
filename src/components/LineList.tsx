/* eslint-disable react-refresh/only-export-components */
import { Minus, Plus, Trash2 } from 'lucide-react'
import { money, qty as fmtQty, round2 } from '../lib/format'

export interface Line {
  product_id: number
  name: string
  item_code: string | null
  qty: number
  rate: number // sale price or purchase cost
  stock: number
  /** label details when the item came from the barcode wizard (purchases only) */
  label?: LabelInfo
}

export interface LabelInfo {
  item_name: string
  barcode: string
  mrp: number
  desc?: string
}

interface Props {
  lines: Line[]
  onChange: (lines: Line[]) => void
  rateLabel: string
  warnStock?: boolean
  canEditRate?: boolean
}

/** Editable bill lines, used by both New Sale and New Purchase. */
export default function LineList({ lines, onChange, rateLabel, warnStock, canEditRate = true }: Props) {
  const set = (i: number, patch: Partial<Line>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const remove = (i: number) => onChange(lines.filter((_, j) => j !== i))

  if (lines.length === 0)
    return (
      <div className="rounded-xl border-2 border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
        Scan a barcode or search a product to add it here.
      </div>
    )

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="hidden grid-cols-[1fr_8rem_7rem_7rem_2.5rem] gap-3 border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-500 md:grid">
        <span>Item</span>
        <span className="text-center">Qty</span>
        <span className="text-right">{rateLabel}</span>
        <span className="text-right">Amount</span>
        <span />
      </div>
      <ul className="divide-y divide-slate-100">
        {lines.map((l, i) => {
          const over = warnStock && l.qty > l.stock
          return (
            <li key={l.product_id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 px-4 py-3 md:grid-cols-[1fr_8rem_7rem_7rem_2.5rem]">
              <div className="min-w-0">
                <div className="line-clamp-2 text-sm font-medium text-slate-800">{l.name}</div>
                <div className={`text-xs ${over ? 'text-red-600' : 'text-slate-500'}`}>
                  {l.item_code || 'no code'} · in stock {fmtQty(l.stock)}
                  {over && ' · more than stock!'}
                </div>
                {warnStock && !(l.rate > 0) && <div className="text-xs font-medium text-amber-600">Price is 0 — enter the selling price</div>}
              </div>
              <button onClick={() => remove(i)} className="justify-self-end rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 md:order-last" aria-label="Remove item">
                <Trash2 className="h-4 w-4" />
              </button>
              <div className="flex items-center justify-center rounded-lg border border-slate-300">
                <button className="p-2 text-slate-500" onClick={() => set(i, { qty: Math.max(1, l.qty - 1) })} aria-label="Less">
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={l.qty}
                  onChange={(e) => set(i, { qty: Number(e.target.value) })}
                  className="w-12 bg-transparent text-center text-sm outline-none"
                />
                <button className="p-2 text-slate-500" onClick={() => set(i, { qty: l.qty + 1 })} aria-label="More">
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex items-center justify-end gap-2 md:contents">
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  disabled={!canEditRate}
                  value={l.rate}
                  onChange={(e) => set(i, { rate: Number(e.target.value) })}
                  className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm outline-none focus:border-indigo-500 disabled:bg-slate-50 md:w-full"
                  aria-label={rateLabel}
                />
                <span className="w-24 text-right text-sm font-semibold md:w-auto">{money(round2(l.qty * l.rate))}</span>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export const linesTotal = (lines: Line[]) => round2(lines.reduce((s, l) => s + round2(l.qty * l.rate), 0))
