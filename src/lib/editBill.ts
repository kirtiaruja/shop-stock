import { supabase } from './supabase'
import { openSlotWith, type EditInfo } from './draft'
import type { Line } from '../components/LineList'
import { initialPay } from '../components/PaymentBlock'

/** Current stock of some products (for the "in stock" note on each line). */
async function stockOf(ids: number[]) {
  const { data } = await supabase.from('product_catalog').select('id, stock').in('id', ids)
  return new Map((data ?? []).map((r: { id: number; stock: number }) => [r.id, Number(r.stock)]))
}
async function party(table: 'customers' | 'suppliers', id: number | null | undefined) {
  if (!id) return null
  const { data } = await supabase.from(table).select('id, name, contact, created_at').eq('id', id).maybeSingle()
  return data
}

export interface SaleForEdit {
  id: number
  customer_id?: number | null
  discount: number
  note: string | null
  paid_amount: number
  sale_items: { product_id?: number | null; product_name: string; item_code: string | null; qty: number; price: number }[]
}

/** Open a saved sale bill in a New sale tab for editing. */
export async function editSale(s: SaleForEdit) {
  const items = s.sale_items.filter((it) => it.product_id)
  const stock = await stockOf(items.map((it) => it.product_id!))
  const lines: Line[] = items.map((it) => ({
    product_id: it.product_id!,
    name: it.product_name,
    item_code: it.item_code,
    qty: Number(it.qty),
    rate: Number(it.price),
    stock: stock.get(it.product_id!) ?? 0,
  }))
  const edit: EditInfo = { id: s.id, paid: Number(s.paid_amount), ids: items.map((it) => it.product_id!) }
  openSlotWith('sale', {
    lines,
    customer: await party('customers', s.customer_id),
    discount: Number(s.discount) > 0 ? { value: String(Number(s.discount)), type: '₹' } : { value: '', type: '%' },
    note: s.note ?? '',
    pay: initialPay,
    edit,
  })
  return items.length < s.sale_items.length // some products were deleted
}

export interface PurchaseForEdit {
  id: number
  supplier_id?: number | null
  invoice_no: string | null
  note: string | null
  bill_date?: string | null
  created_at: string
  tax_inclusive?: boolean
  bill_discount?: number
  bill_discount_type?: string
  bill_tax_rate?: number
  paid_amount: number
  purchase_items?: {
    product_id?: number | null
    product_name: string
    item_code: string | null
    qty: number
    cost: number
    discount?: number
    discount_type?: string
    tax_rate?: number
  }[]
}

/** Open a saved purchase in a New purchase tab for editing. */
export async function editPurchase(p: PurchaseForEdit) {
  const all = p.purchase_items ?? []
  const items = all.filter((it) => it.product_id)
  const stock = await stockOf(items.map((it) => it.product_id!))
  const lines: Line[] = items.map((it) => ({
    product_id: it.product_id!,
    name: it.product_name,
    item_code: it.item_code,
    qty: Number(it.qty),
    rate: Number(it.cost),
    stock: stock.get(it.product_id!) ?? 0,
    disc: Number(it.discount ?? 0),
    discType: it.discount_type === '₹' ? '₹' : '%',
    tax: Number(it.tax_rate ?? 0),
  }))
  const edit: EditInfo = { id: p.id, paid: Number(p.paid_amount), ids: items.map((it) => it.product_id!) }
  openSlotWith('purchase', {
    lines,
    supplier: await party('suppliers', p.supplier_id),
    invoice: p.invoice_no ?? '',
    note: p.note ?? '',
    billDate: p.bill_date ?? new Date(p.created_at).toLocaleDateString('en-CA'),
    taxInclusive: !!p.tax_inclusive,
    billDiscount: Number(p.bill_discount) > 0 ? { value: String(Number(p.bill_discount)), type: p.bill_discount_type === '₹' ? '₹' : '%' } : { value: '', type: '%' },
    billTax: Number(p.bill_tax_rate ?? 0),
    updateCost: true,
    pay: initialPay,
    edit,
  })
  return items.length < all.length
}
