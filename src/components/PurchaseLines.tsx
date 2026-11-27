import { Minus, Plus, Trash2 } from 'lucide-react'
import { money, qty as fmtQty } from '../lib/format'
import { GST_RATES, purchaseLine } from '../lib/purchaseMath'
import type { Line } from './LineList'

const box = 'rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-indigo-500'

/** Purchase items: qty, cost, discount (% or ₹) and GST per item. */
export default function PurchaseLines({ lines, onChange, taxInclusive }: { lines: Line[]; onChange: (l: Line[]) => void; taxInclusive: boolean }) {
  const set = (i: number, patch: Partial<Line>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const remove = (i: number) => onChange(lines.filter((_, j) => j !== i))

  if (lines.length === 0)
    return (
      <div className="rounded-xl border-2 border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
        Use <b>Generate barcodes</b> for new stock, or scan / search items you received.
      </div>
    )

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="hidden grid-cols-[1fr_7.5rem_6rem_8rem_5.5rem_6.5rem_2rem] gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500 lg:grid">
        <span>Item</span>
        <span className="text-center">Qty</span>
        <span className="text-right">Cost{taxInclusive ? ' (incl. GST)' : ''}</span>
        <span className="text-center">Discount</span>
        <span className="text-center">GST</span>
        <span className="text-right">Amount</span>
        <span />
      </div>
      <ul className="divide-y divide-slate-100">
        {lines.map((l, i) => {
          const x = purchaseLine(l, taxInclusive)
          const dType = l.discType ?? '%'
          return (
            <li key={l.product_id} className="grid grid-cols-2 items-center gap-2 px-3 py-3 lg:grid-cols-[1fr_7.5rem_6rem_8rem_5.5rem_6.5rem_2rem]">
              {/* item */}
              <div className="col-span-2 flex min-w-0 items-start justify-between gap-2 lg:col-span-1">
                <div className="min-w-0">
                  <div className="line-clamp-2 text-sm font-medium text-slate-800">{l.name}</div>
                  <div className="text-xs text-slate-500">
                    {l.item_code || 'no code'} · in stock {fmtQty(l.stock)}
                  </div>
                </div>
                <button onClick={() => remove(i)} className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 lg:hidden" aria-label="Remove item">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {/* qty */}
              <label className="flex flex-col gap-0.5 lg:block">
                <span className="text-[11px] text-slate-500 lg:hidden">Qty</span>
                <div className="flex items-center justify-center rounded-lg border border-slate-300">
                  <button className="p-1.5 text-slate-500" onClick={() => set(i, { qty: Math.max(1, l.qty - 1) })} aria-label="Less">
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={l.qty || ''}
                    placeholder="0"
                    onChange={(e) => set(i, { qty: Number(e.target.value) })}
                    className="w-10 bg-transparent text-center text-sm outline-none"
                    aria-label="Quantity"
                  />
                  <button className="p-1.5 text-slate-500" onClick={() => set(i, { qty: l.qty + 1 })} aria-label="More">
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </label>

              {/* cost */}
              <label className="flex flex-col gap-0.5 lg:block">
                <span className="text-[11px] text-slate-500 lg:hidden">Cost{taxInclusive ? ' incl. GST' : ''}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={l.rate || ''}
                  placeholder="0"
                  onChange={(e) => set(i, { rate: Number(e.target.value) })}
                  className={`${box} w-full text-right`}
                  aria-label="Cost per piece"
                />
              </label>

              {/* discount */}
              <label className="flex flex-col gap-0.5 lg:block">
                <span className="text-[11px] text-slate-500 lg:hidden">Discount</span>
                <div className="flex">
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={l.disc || ''}
                    placeholder="0"
                    onChange={(e) => set(i, { disc: Number(e.target.value) })}
                    className={`${box} w-full rounded-r-none text-right ${x.tooMuchDiscount ? 'border-red-400 bg-red-50' : ''}`}
                    aria-label="Discount"
                  />
                  <button
                    type="button"
                    onClick={() => set(i, { discType: dType === '%' ? '₹' : '%' })}
                    className="rounded-r-lg border border-l-0 border-slate-300 bg-slate-50 px-2 text-sm text-slate-600"
                    title="Switch between % and ₹ (for this line)"
                  >
                    {dType}
                  </button>
                </div>
              </label>

              {/* GST */}
              <label className="flex flex-col gap-0.5 lg:block">
                <span className="text-[11px] text-slate-500 lg:hidden">GST</span>
                <select value={l.tax ?? 0} onChange={(e) => set(i, { tax: Number(e.target.value) })} className={`${box} w-full bg-white`} aria-label="GST">
                  {[...new Set([...GST_RATES, l.tax ?? 0])].map((r) => (
                    <option key={r} value={r}>
                      {r}%
                    </option>
                  ))}
                </select>
              </label>

              {/* amount */}
              <div className="text-right">
                <div className="text-sm font-semibold">{money(x.total)}</div>
                {(x.disc > 0 || x.tax > 0) && (
                  <div className="text-[11px] text-slate-500">
                    {x.disc > 0 && `−${money(x.disc)} `}
                    {x.tax > 0 && `GST ${money(x.tax)}`}
                  </div>
                )}
              </div>

              <button onClick={() => remove(i)} className="hidden justify-self-end rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 lg:block" aria-label="Remove item">
                <Trash2 className="h-4 w-4" />
              </button>
              {x.tooMuchDiscount && <p className="col-span-2 text-xs text-red-600 lg:col-span-7">Discount is more than this item's amount.</p>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
