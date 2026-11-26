/* eslint-disable react-refresh/only-export-components */
import { PAY_MODES } from '../lib/supabase'
import { money, round2 } from '../lib/format'
import { Field, Input, Select } from './ui'

export interface PayState {
  mode: string
  credit: boolean
  paidNow: string
}
export const initialPay: PayState = { mode: 'Cash', credit: false, paidNow: '' }

/** Amount actually paid now for a bill of `total`. */
export function paidAmount(pay: PayState, total: number) {
  if (!pay.credit) return total
  const v = Number(pay.paidNow) || 0
  return round2(Math.min(Math.max(v, 0), total))
}

/**
 * Payment section used on New Sale and New Purchase.
 * Normal bill: fully paid by the chosen mode.
 * Credit (udhaar): optionally part-paid now, the rest stays due on the bill.
 */
export default function PaymentBlock({
  pay,
  onChange,
  total,
  partyLabel,
  hasParty,
}: {
  pay: PayState
  onChange: (p: PayState) => void
  total: number
  partyLabel: string
  hasParty: boolean
}) {
  const paid = paidAmount(pay, total)
  const due = round2(total - paid)

  return (
    <div className="space-y-3 rounded-lg bg-slate-50 p-3">
      <div className="grid grid-cols-2 rounded-lg bg-white p-1 text-sm font-medium ring-1 ring-slate-200">
        <button
          type="button"
          onClick={() => onChange({ ...pay, credit: false })}
          className={`rounded-md py-1.5 ${!pay.credit ? 'bg-indigo-600 text-white' : 'text-slate-600'}`}
        >
          Paid now
        </button>
        <button
          type="button"
          onClick={() => onChange({ ...pay, credit: true })}
          className={`rounded-md py-1.5 ${pay.credit ? 'bg-amber-500 text-white' : 'text-slate-600'}`}
        >
          Credit (udhaar)
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {pay.credit && (
          <Field label="Paid now (₹)">
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              max={total}
              value={pay.paidNow}
              onChange={(e) => onChange({ ...pay, paidNow: e.target.value })}
              placeholder="0"
            />
          </Field>
        )}
        <Field label={pay.credit ? 'Paid by' : 'Payment mode'}>
          <Select value={pay.mode} onChange={(e) => onChange({ ...pay, mode: e.target.value })} disabled={pay.credit && paid === 0}>
            {PAY_MODES.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
        </Field>
      </div>

      {pay.credit && (
        <div className="flex justify-between text-sm">
          <span className="text-slate-600">Balance due</span>
          <span className="font-semibold text-amber-700">{money(due)}</span>
        </div>
      )}
      {pay.credit && due > 0 && !hasParty && <p className="text-xs font-medium text-red-600">Select a {partyLabel} for a credit bill.</p>}
    </div>
  )
}
