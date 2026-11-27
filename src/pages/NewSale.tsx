import { useState } from 'react'
import { Printer, RotateCcw } from 'lucide-react'
import { supabase, errMsg, type CatalogItem, type Customer } from '../lib/supabase'
import { useCatalog } from '../lib/catalog'
import { closeSlot, finishSlot, useDraft, useSlots, type EditInfo } from '../lib/draft'
import BillTabs from '../components/BillTabs'
import { usePermissions } from '../lib/auth'
import { money, qty, round2 } from '../lib/format'
import ScanBox from '../components/ScanBox'
import LineList, { linesTotal, type Line } from '../components/LineList'
import DiscountBox from '../components/DiscountBox'
import { discountAmount, noDiscount, type DiscValue } from '../lib/discount'
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
  const { active } = useSlots('sale')
  return <SaleBill key={active} slot={active} />
}

function SaleBill({ slot }: { slot: string }) {
  const { isManager } = usePermissions()
  const cat = useCatalog(false)
  const toast = useToast()
  const [lines, setLines] = useDraft<Line[]>(slot, 'lines', [])
  const [customer, setCustomer] = useDraft<Customer | null>(slot, 'customer', null)
  const [discount, setDiscount] = useDraft<DiscValue>(slot, 'discount', noDiscount)
  const [pay, setPay] = useDraft<PayState>(slot, 'pay', initialPay)
  const [note, setNote] = useDraft(slot, 'note', '')
  /** set when this tab is editing a saved bill */
  const [edit, setEdit] = useDraft<EditInfo | null>(slot, 'edit', null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<SaleDetail | null>(null)

  const add = (p: CatalogItem) =>
    setLines((ls) => {
      const i = ls.findIndex((l) => l.product_id === p.id)
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l))
      return [...ls, { product_id: p.id, name: p.name, item_code: p.item_code, qty: 1, rate: defaultPrice(p), stock: Number(p.stock) }]
    })

  const subtotal = linesTotal(lines)
  const rawDiscount = discountAmount(subtotal, discount)
  const tooMuch = rawDiscount > subtotal
  const discountAmt = Math.min(subtotal, rawDiscount)
  const total = round2(subtotal - discountAmt)
  // editing: payments already on the bill stay; only the balance (if any) is paid now
  const alreadyPaid = edit ? edit.paid : 0
  const balance = round2(Math.max(0, total - alreadyPaid))
  /** editing made the bill smaller than what was paid → give the difference back */
  const giveBack = edit ? round2(Math.max(0, alreadyPaid - total)) : 0
  const paid = paidAmount(pay, balance)
  const itemCount = lines.reduce((s, l) => s + l.qty, 0)

  const reset = () => {
    setLines([])
    setCustomer(null)
    setDiscount(noDiscount)
    setNote('')
    setPay(initialPay)
    setEdit(null)
  }

  const save = async () => {
    if (!lines.length) return toast('Add at least one item', false)
    if (lines.some((l) => !(l.qty > 0))) return toast('Every item needs a quantity above 0', false)
    if (lines.some((l) => !(l.rate > 0)) && !confirm('Some items have price 0. Save the bill anyway?')) return
    if (tooMuch) return toast('Discount is more than the bill amount', false)
    if (paid < balance && !customer) return toast('Select a customer for a credit (udhaar) bill', false)
    setBusy(true)
    const body = {
        customer_id: customer?.id ?? null,
        customer_name: customer?.name ?? null,
        discount: discountAmt,
        payment_mode: pay.mode,
        paid_amount: paid,
        note,
        items: lines.map((l) => ({ product_id: l.product_id, qty: l.qty, price: l.rate })),
    }
    const { data, error } = edit
      ? await supabase.rpc('update_sale', { p_id: edit.id, p: body })
      : await supabase.rpc('create_sale', { p: body })
    if (error) {
      setBusy(false)
      return toast(errMsg(error), false)
    }
    const { data: sale } = await supabase.from('sales').select('*, sale_items(*)').eq('id', data).single()
    setBusy(false)
    const due = round2(balance - paid)
    toast(`Bill #${data} ${edit ? 'updated' : 'saved'}${giveBack > 0 ? ` — give back ${money(giveBack)}` : due > 0 ? ` — ${money(due)} due` : ''}`)
    setDone(sale as SaleDetail)
    const soldIds = [...lines.map((l) => l.product_id), ...(edit?.ids ?? [])]
    reset()
    cat.refresh(soldIds) // only the products on this bill, not the whole list
  }

  /** receipt closed → close this bill's tab if other bills are waiting */
  const closeReceipt = () => {
    setDone(null)
    finishSlot('sale', slot)
  }

  if (cat.loading && !cat.items.length) return <Spinner label="Loading products…" />

  return (
    <div className="space-y-4">
      <PageHeader title={edit ? `Edit bill #${edit.id}` : 'New sale'} subtitle="Scan items with the barcode scanner, or search by name" />
      <BillTabs page="sale" partyField="customer" />
      {edit && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>
            Editing <b>bill #{edit.id}</b>. Change items, prices, customer or discount, then tap <b>Save changes</b>.
            {alreadyPaid > 0 && <> Already paid: {money(alreadyPaid)}.</>}
          </span>
          <Button variant="secondary" className="py-1" onClick={() => closeSlot('sale', slot)}>
            Cancel edit
          </Button>
        </div>
      )}
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
          <Field label="Discount (type % or ₹)">
            <DiscountBox base={subtotal} value={discount} onChange={setDiscount} invalid={tooMuch} />
          </Field>
          <Field label="Note">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
          </Field>

          <div className="space-y-1 border-t border-slate-100 pt-3 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>Items · Total qty</span>
              <span>
                {lines.length} · <b className="text-slate-900">{qty(itemCount)}</b>
              </span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Subtotal</span>
              <span>{money(subtotal)}</span>
            </div>
            {discountAmt > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>Discount ({discount.type === '%' ? Number(discount.value) : round2((discountAmt / subtotal) * 100)}%)</span>
                <span>−{money(discountAmt)}</span>
              </div>
            )}
            <div className="flex justify-between pt-1 text-xl font-bold text-slate-900">
              <span>Total</span>
              <span>{money(total)}</span>
            </div>
          </div>
          {edit && alreadyPaid > 0 && (
            <div className="-mt-2 space-y-1 text-sm text-slate-600">
              <div className="flex justify-between">
                <span>Already paid</span>
                <span>{money(alreadyPaid)}</span>
              </div>
              {giveBack > 0 ? (
                <div className="flex justify-between rounded-md bg-amber-100 px-2 py-1 font-semibold text-amber-900">
                  <span>Give back to customer</span>
                  <span>{money(giveBack)}</span>
                </div>
              ) : (
                <div className="flex justify-between font-semibold">
                  <span>Balance</span>
                  <span>{money(balance)}</span>
                </div>
              )}
            </div>
          )}
          {(!edit || balance > 0) && (
            <PaymentBlock pay={pay} onChange={setPay} total={balance} partyLabel="customer" hasParty={!!customer} />
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={reset} disabled={!lines.length || busy} title="Clear bill">
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button className="flex-1 py-3 text-base" loading={busy} onClick={save} disabled={!lines.length}>
              {edit ? 'Save changes' : 'Save bill'}
            </Button>
          </div>
          {!isManager && <p className="text-xs text-slate-400">Stock is reduced as soon as the bill is saved.</p>}
        </Card>
      </div>

      <Modal open={!!done} onClose={closeReceipt} title={done ? `Bill #${done.id} ${done.edited_at ? 'updated' : 'saved'}` : ''}>
        {done && (
          <div className="space-y-4">
            <Receipt sale={done} />
            <div className="flex gap-2 print:hidden">
              <Button variant="secondary" className="flex-1" onClick={printReceipt}>
                <Printer className="h-4 w-4" /> Print
              </Button>
              <Button className="flex-1" onClick={closeReceipt} autoFocus>
                Next bill
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
