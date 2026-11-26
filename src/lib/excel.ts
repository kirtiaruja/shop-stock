import * as XLSX from 'xlsx'
import type { Product } from './supabase'

/** Excel column header ↔ database field. Same layout as your "Export Items" sheet. */
export const COLUMNS: { header: string; field: keyof Product; kind: 'text' | 'num' | 'bool' }[] = [
  { header: 'Item name*', field: 'name', kind: 'text' },
  { header: 'Item code', field: 'item_code', kind: 'text' },
  { header: 'Category', field: 'category', kind: 'text' },
  { header: 'HSN', field: 'hsn', kind: 'text' },
  { header: 'Default Mrp', field: 'mrp', kind: 'num' },
  { header: 'Sale price', field: 'sale_price', kind: 'num' },
  { header: 'Purchase price', field: 'purchase_price', kind: 'num' },
  { header: 'Online Store Price', field: 'online_price', kind: 'num' },
  { header: 'Discount Type', field: 'discount_type', kind: 'text' },
  { header: 'Sale Discount', field: 'sale_discount', kind: 'num' },
  { header: 'Current stock quantity', field: 'stock', kind: 'num' },
  { header: 'Minimum stock quantity', field: 'min_stock', kind: 'num' },
  { header: 'Item Location', field: 'location', kind: 'text' },
  { header: 'Tax Rate', field: 'tax_rate', kind: 'text' },
  { header: 'Inclusive Of Tax', field: 'inclusive_of_tax', kind: 'bool' },
  { header: 'Base Unit (x)', field: 'base_unit', kind: 'text' },
  { header: 'Secondary Unit (y)', field: 'secondary_unit', kind: 'text' },
  { header: 'Conversion Rate (n) (x = ny)', field: 'conversion_rate', kind: 'num' },
]

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const byHeader = new Map(COLUMNS.map((c) => [norm(c.header), c]))
// a few friendly aliases
byHeader.set('itemname', COLUMNS[0])
byHeader.set('name', COLUMNS[0])
byHeader.set('barcode', COLUMNS[1])
byHeader.set('mrp', COLUMNS[4])
byHeader.set('stock', COLUMNS[10])

export interface ParsedFile {
  rows: Record<string, unknown>[]
  matched: string[]
  unknown: string[]
  skipped: number
}

/** Reads the first sheet and turns each row into an import record. */
export async function parseProductsFile(file: File): Promise<ParsedFile> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null, raw: true })
  const headers = raw.length ? Object.keys(raw[0]) : []
  const matched: string[] = []
  const unknown: string[] = []
  const map: [string, (typeof COLUMNS)[number]][] = []
  for (const h of headers) {
    const c = byHeader.get(norm(h))
    if (c) {
      map.push([h, c])
      matched.push(h)
    } else unknown.push(h)
  }
  if (!map.some(([, c]) => c.field === 'name')) throw new Error('Could not find the "Item name*" column in this file.')

  let skipped = 0
  const rows: Record<string, unknown>[] = []
  for (const r of raw) {
    const out: Record<string, unknown> = {}
    for (const [h, c] of map) {
      const v = r[h]
      if (v === null || v === undefined || String(v).trim() === '') {
        out[c.field] = null
        continue
      }
      if (c.kind === 'num') {
        const n = Number(String(v).replace(/[,₹\s]/g, ''))
        out[c.field] = Number.isFinite(n) ? n : null
      } else if (c.kind === 'bool') {
        out[c.field] = ['y', 'yes', 'true', '1'].includes(String(v).trim().toLowerCase())
      } else {
        // codes like 00123 must stay text
        out[c.field] = String(v).trim()
      }
    }
    if (!out.name) {
      skipped++
      continue
    }
    rows.push(out)
  }
  return { rows, matched, unknown, skipped }
}

/** Downloads products in the same column layout, so the file can be edited and imported back. */
export function exportProducts(products: Product[], fileName = 'stockpilot-products.xlsx') {
  const data = products.map((p) =>
    Object.fromEntries(
      COLUMNS.map((c) => {
        const v = p[c.field]
        return [c.header, c.kind === 'bool' ? (v ? 'Y' : 'N') : (v ?? '')]
      }),
    ),
  )
  const ws = XLSX.utils.json_to_sheet(data, { header: COLUMNS.map((c) => c.header) })
  ws['!cols'] = COLUMNS.map((c) => ({ wch: c.field === 'name' ? 40 : 14 }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Export Items')
  XLSX.writeFile(wb, fileName)
}

/** Generic sheet download used by the sales / purchases reports. */
export function downloadSheet(rows: Record<string, unknown>[], sheet: string, fileName: string) {
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheet)
  XLSX.writeFile(wb, fileName)
}
