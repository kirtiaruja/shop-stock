import { round2 } from './format'

export type DiscType = '%' | '₹'
export interface DiscValue {
  value: string // what was typed
  type: DiscType // which box it was typed in
}
export const noDiscount: DiscValue = { value: '', type: '%' }

/** ₹ amount of a DiscValue on a base amount. */
export function discountAmount(base: number, d: DiscValue) {
  const v = Math.max(0, Number(d.value) || 0)
  return d.type === '%' ? round2((base * v) / 100) : round2(v)
}
