import { round2 } from './format'

export const GST_RATES = [0, 5, 12, 18, 28]

export interface PurchaseLineInput {
  qty: number
  rate: number // cost per piece as written on the supplier's bill
  disc?: number
  discType?: '%' | '₹'
  tax?: number // GST %
}

/** Same rules as create_purchase() in the database, so the screen always matches what is saved. */
export function purchaseLine(l: PurchaseLineInput, taxInclusive: boolean) {
  const gross = round2((Number(l.qty) || 0) * (Number(l.rate) || 0))
  const d = Math.max(0, Number(l.disc) || 0)
  const disc = (l.discType ?? '%') === '%' ? round2((gross * d) / 100) : round2(d)
  const after = round2(gross - disc)
  const r = Math.max(0, Number(l.tax) || 0)
  let taxable: number
  let tax: number
  let total: number
  if (taxInclusive) {
    total = after
    taxable = round2(after / (1 + r / 100))
    tax = round2(total - taxable)
  } else {
    taxable = after
    tax = round2((after * r) / 100)
    total = round2(taxable + tax)
  }
  return { gross, disc, taxable, tax, total, tooMuchDiscount: disc > gross }
}

export function purchaseTotals(lines: PurchaseLineInput[], taxInclusive: boolean) {
  return lines.reduce(
    (t, l) => {
      const x = purchaseLine(l, taxInclusive)
      return {
        gross: round2(t.gross + x.gross),
        disc: round2(t.disc + x.disc),
        taxable: round2(t.taxable + x.taxable),
        tax: round2(t.tax + x.tax),
        total: round2(t.total + x.total),
      }
    },
    { gross: 0, disc: 0, taxable: 0, tax: 0, total: 0 },
  )
}

/** "GST@5%" / "5%" / "GST 12" → 5 / 12 ; anything else → null */
export function parseTaxRate(t: string | null | undefined): number | null {
  const m = String(t ?? '').match(/(\d+(?:\.\d+)?)\s*%?/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null
}

/** Discount on the whole bill, taken off the items total (after item discounts and GST) — same as create_purchase(). */
export function billDiscount(itemsTotal: number, value: number, type: '%' | '₹') {
  const v = Math.max(0, Number(value) || 0)
  const amount = type === '%' ? round2((itemsTotal * v) / 100) : round2(v)
  return { amount, total: round2(itemsTotal - amount), tooMuch: amount > itemsTotal }
}

/** GST on the bill amount after the bill discount, added on top — same as create_purchase(). */
export function billTax(afterDiscount: number, rate: number) {
  const r = Math.max(0, Number(rate) || 0)
  const amount = round2((afterDiscount * r) / 100)
  return { amount, total: round2(afterDiscount + amount) }
}
