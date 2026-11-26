import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseConfigured = Boolean(url && key)

export const supabase = createClient(url || 'http://localhost', key || 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true },
})

export type Role = 'admin' | 'co_admin' | 'salesman'

export interface Profile {
  id: string
  full_name: string | null
  email: string | null
  role: Role
  active: boolean
  created_at: string
}

export interface Product {
  id: number
  name: string
  item_code: string | null
  category: string | null
  hsn: string | null
  mrp: number | null
  sale_price: number
  purchase_price: number
  online_price: number
  discount_type: string
  sale_discount: number
  stock: number
  min_stock: number
  location: string | null
  tax_rate: string | null
  inclusive_of_tax: boolean
  base_unit: string | null
  secondary_unit: string | null
  conversion_rate: number | null
}

/** What a salesman can see (no purchase price). */
export type CatalogItem = Pick<
  Product,
  'id' | 'name' | 'item_code' | 'category' | 'mrp' | 'sale_price' | 'discount_type' | 'sale_discount' | 'stock' | 'min_stock' | 'tax_rate' | 'base_unit'
> & { purchase_price?: number }

export interface Customer {
  id: number
  name: string
  contact: string | null
  created_at: string
}

/** Suppliers have the same shape as customers. */
export type Supplier = Customer
export type PartyKind = 'customer' | 'supplier'

export interface Payment {
  id: number
  direction: 'in' | 'out'
  sale_id: number | null
  purchase_id: number | null
  customer_id: number | null
  supplier_id: number | null
  party_name: string | null
  amount: number
  mode: string
  note: string | null
  created_by_name: string | null
  created_at: string
}

export interface Balance {
  party_id: number
  name: string
  contact: string | null
  bills: number
  total: number
  paid: number
  due: number
  oldest: string
}

/** Ways money can actually move. "Credit" is not one of them — it means unpaid. */
export const PAY_MODES = ['Cash', 'UPI', 'Card', 'Bank']

export function errMsg(e: unknown): string {
  if (!e) return 'Something went wrong'
  if (typeof e === 'string') return e
  if (typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return 'Something went wrong'
}
