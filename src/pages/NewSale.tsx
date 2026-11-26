import { useState } from 'react'
import { Printer, RotateCcw } from 'lucide-react'
import { supabase, errMsg, type CatalogItem, type Customer } from '../lib/supabase'
import { useCatalog } from '../lib/catalog'
import { usePermissions } from '../lib/auth'
import { money, round2 } from '../lib/format'
import ScanBox from '../components/ScanBox'
import LineList, { linesTotal, type Line } from '../components/LineList'
import CustomerPicker from '../components/CustomerPicker'
import PaymentBlock, { initialPay, paidAmount, type PayState } from '../components/PaymentBlock'
import Receipt, { printReceipt, type SaleDetail } from '../components/Receipt'
import { Button, Card, Field, Input, Modal, PageHeader, Spinner, useToast } from '../components/ui'

/** Selling price after the product's default discount (from your Excel). */
function defaultPrice(p: CatalogItem) {
  const price = Number(p.sale_price) || 0
  const d = Number(p.sale_discount) || 0
  if (!d) return price
  return round2(p.discount_type?.includes('%') ? price - (price * d) / 100 : price - d)
}

export default function NewSale() {
  const { isManager } = usePermissions()
  const cat = useCatalog(false)
  const toast = useToast()
  const [lines, setLines] = useState<Line[]>([])
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [discount, setDiscount] = useState('')
  const [discountPct, setDiscountPct] = useState(false)
  const [pay, setPay] = useState<PayState>(initialPay)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<SaleDetail | null>(null)

  const add = (p: CatalogItem) =>
    setLines((ls) => {
      const i = ls.findIndex((l) => l.product_id === p.id)
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l))
      return [...ls, { product_id: p.id, name: p.name, item_code: p.item_code, qty: 1, rate: defaultPrice(p), stock: Number(p.stock) }]
    })

  const subtotal = linesTotal(lines)
  const d = Number(discount) || 0
  const discountAmt = round2(Math.min(subtotal, Math.max(0, discountPct ? (subtotal * d) / 100 : d)))
  const total = round2(subtotal - discountAmt)
  const paid = paidAmount(pay, total)
  const itemCount = lines.reduce((s, l) => s + l.qty, 0)

  const reset = () => {
    setLines([])
    setCustomer(null)
    setDiscount('')
    setNote('')
    setPay(initialPay)
  }

  const save = async () => {
    if (!lines.length) return toast('Add at least one item', false)
    if (lines.some((l) => !(l.qty > 0))) return toast('Every item needs a quantity above 0', false)
    if (lines.some((l) => !(l.rate > 0)) && !confirm('Some items have price 0. Save the bill anyway?')) return
    if (paid < total && !customer) return toast('Select a customer for a credit (udhaar) bill', false)
    setBusy(true)
    const { data, error } = await supabase.rpc('create_sale', {
      p: {
        customer_id: customer?.id ?? null,
        customer_name: customer?.name ?? null,
        discount: discountAmt,
        payment_mode: pay.mode,
        paid_amount: paid,
        note,
        items: lines.map((l) => ({ product_id: l.product_id, qty: l.qty, price: l.rate })),
      },
    })
    if (error) {
      setBusy(false)
      return toast(errMsg(error), false)
    }
    const { data: sale } = await supabase.from('sales').select('*, sale_items(*)').eq('id', data).single()
    setBusy(false)
    toast(paid < total ? `Bill #${data} saved — ${money(total - paid)} due` : `Bill #${data} saved`)
    setDone(sale as SaleDetail)
    reset()
    cat.reload()
  }

  if (cat.loading && !cat.items.length) return <Spinner label="Loading products…" />

  return (
    <div className="space-y-4">
      <PageHeader title="New sale" subtitle="Scan items with the barcode scanner, or search by name" />
      {cat.error && <p className="text-sm text-red-600">{cat.error}</p>}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-3">
          <ScanBox lookup={cat.lookup} search={cat.search} onPick={add} disabled={!!done} />
          <LineList lines={lines} onChange={setLines} rateLabel="Price" warnStock canEditRate />
        </div>

        <Card className="h-fit space-y-4 p-4 lg:sticky lg:top-6">
          <Field label="Customer">
            <CustomerPicker value={customer} onChange={setCustomer} />
          </Field>
          <Field label={`Discount (${discountPct ? '%' : '₹'})`}>
            <div className="flex">
              <Input type="number" inputMode="decimal" min={0} value={discount} onChange={(e) => setDiscount(e.target.value)} className="rounded-r-none" />
              <button
                onClick={() => setDiscountPct(!discountPct)}
                className="rounded-r-lg border border-l-0 border-slate-300 bg-slate-50 px-3 text-sm text-slate-600"
                title="Switch between ₹ and %"
              >
                {discountPct ? '%' : '₹'}
              </button>
            </div>
          </Field>
          <Field label="Note">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
          </Field>

          <div className="space-y-1 border-t border-slate-100 pt-3 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>Items</span>
              <span>{itemCount}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Subtotal</span>
              <span>{money(subtotal)}</span>
            </div>
            {discountAmt > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>Discount</span>
                <span>-{money(discountAmt)}</span>
              </div>
            )}
            <div className="flex justify-between pt-1 text-xl font-bold text-slate-900">
              <span>Total</span>
              <span>{money(total)}</span>
            </div>
          </div>
          <PaymentBlock pay={pay} onChange={setPay} total={total} partyLabel="customer" hasParty={!!customer} />
          <div className="flex gap-2">
            <Button variant="secondary" onClick={reset} disabled={!lines.length || busy} title="Clear bill">
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button className="flex-1 py-3 text-base" loading={busy} onClick={save} disabled={!lines.length}>
              Save bill
            </Button>
          </div>
          {!isManager && <p className="text-xs text-slate-400">Stock is reduced as soon as the bill is saved.</p>}
        </Card>
      </div>

      <Modal open={!!done} onClose={() => setDone(null)} title={done ? `Bill #${done.id} saved` : ''}>
        {done && (
          <div className="space-y-4">
            <Receipt sale={done} />
            <div className="flex gap-2 print:hidden">
              <Button variant="secondary" className="flex-1" onClick={printReceipt}>
                <Printer className="h-4 w-4" /> Print
              </Button>
              <Button className="flex-1" onClick={() => setDone(null)} autoFocus>
                Next bill
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
