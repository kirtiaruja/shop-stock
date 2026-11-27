import { round2 } from '../lib/format'
import type { DiscType, DiscValue } from '../lib/discount'
import { Input } from './ui'


const show = (n: number) => (Number.isFinite(n) && n > 0 ? String(round2(n)) : '')

/** Two linked boxes: type a % and the ₹ is worked out, or type ₹ and the % is worked out. */
export default function DiscountBox({
  base,
  value,
  onChange,
  invalid,
}: {
  base: number // amount the discount is taken from
  value: DiscValue
  onChange: (v: DiscValue) => void
  invalid?: boolean
}) {
  const v = Number(value.value) || 0
  const pct = value.type === '%' ? value.value : base > 0 ? show((v / base) * 100) : ''
  const amt = value.type === '₹' ? value.value : show((base * v) / 100)
  const box = (label: DiscType, text: string, aria: string) => (
    <div className="relative">
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        aria-label={aria}
        value={text}
        placeholder="0"
        onChange={(e) => onChange({ value: e.target.value, type: label })}
        className={`pr-7 text-right ${value.type === label && value.value ? 'font-semibold' : 'text-slate-500'} ${invalid ? 'border-red-500 text-red-600' : ''}`}
      />
      <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-slate-400">{label}</span>
    </div>
  )
  return (
    <div className="grid grid-cols-2 gap-2">
      {box('%', pct, 'Discount percent')}
      {box('₹', amt, 'Discount amount')}
    </div>
  )
}
