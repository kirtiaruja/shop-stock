/** Price rules carried over from the Barcode Wizard. */

export const CODE_RE = /^([A-K][0-9]{2,3}|Z[0-9]{2})$/

/** ₹60 → Z60, ₹450 → D50, ₹1200 → A200 */
export function priceCode(p: number | string | null | undefined): string {
  const n = Math.round(Number(p))
  if (!n || n < 1 || n > 9999) return ''
  if (n < 100) return 'Z' + String(n).padStart(2, '0')
  if (n < 1000) return String.fromCharCode(64 + Math.floor(n / 100)) + String(n % 100).padStart(2, '0')
  return String.fromCharCode(64 + Math.floor(n / 1000)) + String(n % 1000).padStart(3, '0')
}

/** D50 → 450, A200 → 1200, Z60 → 60 */
export function codeToPrice(c: string | null | undefined): number | null {
  const s = (c || '').toUpperCase()
  if (!CODE_RE.test(s)) return null
  if (s[0] === 'Z') return Number(s.slice(1))
  if (s.length === 3) return (s.charCodeAt(0) - 64) * 100 + Number(s.slice(1))
  return (s.charCodeAt(0) - 64) * 1000 + Number(s.slice(1))
}

/**
 * Selling price hidden in the MRP decimals: 650.50 → 500, 500.40 → 400, 1500.12 → 1200.
 * No decimals → selling price = MRP. Returns '' when it can't be read.
 */
export function actualFromMrp(mrp: string | number | null | undefined): string {
  const s = String(mrp ?? '').trim()
  const v = parseFloat(s)
  if (!v) return ''
  if (!s.includes('.')) return String(Math.round(v))
  const d = parseInt((s.split('.')[1] + '00').slice(0, 2), 10)
  if (!d) return String(Math.round(v))
  return String(v >= 1000 ? d * 100 : d * 10)
}

const FORMULA_KEY = 'stockpilot.costFormula'
export const DEFAULT_COST_FORMULA = 'salePrice*(1-0.35)'

export function loadCostFormula(): string {
  try {
    return localStorage.getItem(FORMULA_KEY) ?? DEFAULT_COST_FORMULA
  } catch {
    return DEFAULT_COST_FORMULA
  }
}
export function saveCostFormula(f: string) {
  try {
    localStorage.setItem(FORMULA_KEY, f)
  } catch {
    /* ignore */
  }
}

/**
 * Purchase price from a formula like "salePrice*(1-0.35)". Only numbers and + - * / ( ) are allowed.
 * Returns null when the formula is empty or invalid.
 */
export function costFromFormula(formula: string, salePrice: number): number | null {
  const expr = (formula || '').trim()
  if (!expr || !(salePrice > 0)) return null
  const body = expr.replace(/salePrice/g, String(salePrice))
  if (!/^[0-9\s+\-*/().]+$/.test(body)) return null
  try {
    const v = Number(Function(`"use strict"; return (${body})`)())
    return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null
  } catch {
    return null
  }
}
