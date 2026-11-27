/* eslint-disable react-refresh/only-export-components */
import { money, qty, dateTime } from '../lib/format'

export interface SaleDetail {
  id: number
  customer_name: string | null
  subtotal: number
  discount: number
  total: number
  paid_amount: number
  due_amount: number
  payment_mode: string
  note: string | null
  created_by_name: string | null
  created_at: string
  customer_id?: number | null
  edited_at?: string | null
  edited_by_name?: string | null
  sale_items: { id: number; product_id?: number | null; product_name: string; item_code: string | null; qty: number; price: number; line_total: number }[]
}

/** Shop name / address shown on printed bills. Change these to yours. */
export const SHOP = {
  name: import.meta.env.VITE_SHOP_NAME || 'My Shop',
  line: import.meta.env.VITE_SHOP_ADDRESS || '',
  phone: import.meta.env.VITE_SHOP_PHONE || '',
}

/** Narrow bill that prints well on 58/80 mm thermal printers and on A4. */
export default function Receipt({ sale }: { sale: SaleDetail }) {
  return (
    <div id="receipt" className="mx-auto w-full max-w-[80mm] bg-white font-mono text-[12px] leading-snug text-black">
      <div className="text-center">
        <div className="text-base font-bold">{SHOP.name}</div>
        {SHOP.line && <div>{SHOP.line}</div>}
        {SHOP.phone && <div>Ph: {SHOP.phone}</div>}
      </div>
      <div className="my-2 border-t border-dashed border-black" />
      <div className="flex justify-between">
        <span>Bill #{sale.id}</span>
        <span>{dateTime(sale.created_at)}</span>
      </div>
      <div>Customer: {sale.customer_name || 'Walk-in'}</div>
      <div className="my-2 border-t border-dashed border-black" />
      {sale.sale_items.map((it) => (
        <div key={it.id} className="mb-1">
          <div>{it.product_name}</div>
          <div className="flex justify-between">
            <span>
              {qty(it.qty)} x {money(it.price)}
            </span>
            <span>{money(it.line_total)}</span>
          </div>
        </div>
      ))}
      <div className="my-2 border-t border-dashed border-black" />
      <div className="flex justify-between">
        <span>Items: {sale.sale_items.length}</span>
        <span>Total qty: {qty(sale.sale_items.reduce((s, it) => s + Number(it.qty), 0))}</span>
      </div>
      <div className="flex justify-between">
        <span>Subtotal</span>
        <span>{money(sale.subtotal)}</span>
      </div>
      {Number(sale.discount) > 0 && (
        <div className="flex justify-between">
          <span>Discount</span>
          <span>-{money(sale.discount)}</span>
        </div>
      )}
      <div className="flex justify-between text-sm font-bold">
        <span>TOTAL</span>
        <span>{money(sale.total)}</span>
      </div>
      {Number(sale.due_amount) > 0 ? (
        <>
          <div className="flex justify-between">
            <span>Paid</span>
            <span>{money(sale.paid_amount)}</span>
          </div>
          <div className="flex justify-between font-bold">
            <span>BALANCE DUE</span>
            <span>{money(sale.due_amount)}</span>
          </div>
        </>
      ) : (
        <div className="flex justify-between">
          <span>Paid by</span>
          <span>{sale.payment_mode}</span>
        </div>
      )}
      <div className="my-2 border-t border-dashed border-black" />
      <div className="text-center">Thank you! Visit again.</div>
    </div>
  )
}

export function printReceipt() {
  document.body.classList.add('printing-receipt')
  window.print()
  setTimeout(() => document.body.classList.remove('printing-receipt'), 500)
}
