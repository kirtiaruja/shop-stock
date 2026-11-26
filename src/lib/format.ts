const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })
const num = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 })

export const money = (v: number | null | undefined) => inr.format(Number(v ?? 0))
export const qty = (v: number | null | undefined) => num.format(Number(v ?? 0))

export function dateTime(v: string) {
  return new Date(v).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Round to 2 decimals the same way the database does. */
export const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100
