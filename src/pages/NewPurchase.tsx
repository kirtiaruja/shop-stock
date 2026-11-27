import { useState } from 'react'
import { closeSlot, finishSlot, useDraft, useSlots, type EditInfo } from '../lib/draft'
import BillTabs from '../components/BillTabs'
import { useNavigate } from 'react-router-dom'
import { PackagePlus, RotateCcw, Barcode, Printer } from 'lucide-react'
import { supabase, errMsg, type CatalogItem, type Product, type Supplier } from '../lib/supabase'
import { useCatalog } from '../lib/catalog'
import { money, qty, round2 } from '../lib/format'
import { GST_RATES, billDiscount, billTax, parseTaxRate, purchaseTotals } from '../lib/purchaseMath'
import DiscountBox from '../components/DiscountBox'
import { noDiscount, type DiscValue } from '../lib/discount'
import ScanBox from '../components/ScanBox'
import type { Line } from '../components/LineList'
import PurchaseLines from '../components/PurchaseLines'
import ProductForm from '../components/ProductForm'
import BarcodeWizard, { type WizardItem } from '../components/BarcodeWizard'
import NoteReader from '../components/NoteReader'
import LabelPrinter from '../components/LabelPrinter'
import { PartyPicker } from '../components/CustomerPicker'
import PaymentBlock, { initialPay, paidAmount, type PayState } from '../components/PaymentBlock'
import { Button, Card, Field, Input, PageHeader, Select, Spinner, useToast } from '../components/ui'

const OLD_DRAFT_KEY = 'stockpilot.purchaseDraft' // items saved by the earlier version
const today = () => new Date().toLocaleDateString('en-CA') // yyyy-mm-dd, local time
const loadOldDraft = (): Line[] => {
  try {
    const d = JSON.parse(localStorage.getItem(OLD_DRAFT_KEY) || '[]')
    localStorage.removeItem(OLD_DRAFT_KEY)
    return Array.isArray(d) ? d : []
  } catch {
    return []
  }
}

export default function NewPurchase() {
  const { active } = useSlots('purchase')
  return <PurchaseBill key={active} slot={active} />
}

function PurchaseBill({ slot }: { slot: string }) {
  const cat = useCatalog(true)
  const toast = useToast()
  const nav = useNavigate()
  const [lines, setLines] = useDraft<Line[]>(slot, 'lines', () => (slot === 'purchase' ? loadOldDraft() : []))
  const [wizard, setWizard] = useState(false)
  const [note, setNoteOpen] = useState(false)
  const [labels, setLabels] = useState(false)
  const [supplier, setSupplier] = useDraft<Supplier | null>(slot, 'supplier', null)
  const [pay, setPay] = useDraft<PayState>(slot, 'pay', initialPay)
  const [invoice, setInvoice] = useDraft(slot, 'invoice', '')
  const [remark, setRemark] = useDraft(slot, 'note', '')
  const [updateCost, setUpdateCost] = useDraft(slot, 'updateCost', true)
  const [busy, setBusy] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [billDate, setBillDate] = useDraft(slot, 'billDate', today)
  const [taxInclusive, setTaxInclusive] = useDraft(slot, 'taxInclusive', false)
  /** GST for items that have no rate of their own (e.g. new items from the barcode wizard) */
  const [billRate, setBillRate] = useDraft(slot, 'billTax', 0)
  const [billDisc, setBillDisc] = useDraft<DiscValue>(slot, 'billDiscount', noDiscount)

  const add = (p: CatalogItem | Product) =>
    setLines((ls) => {
      const i = ls.findIndex((l) => l.product_id === p.id)
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l))
      return [
        ...ls,
        {
          product_id: p.id,
          name: p.name,
          item_code: p.item_code,
          qty: 1,
          rate: Number(p.purchase_price) || 0,
          stock: Number(p.stock),
          disc: 0,
          discType: '%',
          tax: parseTaxRate(p.tax_rate) ?? 0,
        },
      ]
    })

  /** Item made in the barcode wizard / note reader → purchase line with its label. */
  const addFromWizard = ({ result, qty, cost, desc }: WizardItem) =>
    setLines((ls) => {
      const p = result.product
      const label = { item_name: result.item_name, barcode: result.barcode_number, mrp: result.mrp, desc }
      const i = ls.findIndex((l) => l.product_id === p.id)
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: l.qty + qty, rate: cost, label } : l))
      return [
        ...ls,
        { product_id: p.id, name: p.name, item_code: result.barcode_number, qty, rate: cost, stock: Number(p.stock), label, disc: 0, discType: '%', tax: 0 },
      ]
    })

  const sums = purchaseTotals(lines, taxInclusive)
  const bill = billDiscount(sums.total, Number(billDisc.value), billDisc.type)
  const btax = billTax(bill.total, billRate)
  const total = btax.total
  /** set when this tab is editing a saved purchase */
  const [edit, setEdit] = useDraft<EditInfo | null>(slot, 'edit', null)
  const alreadyPaid = edit ? edit.paid : 0
  const balance = round2(Math.max(0, total - alreadyPaid))
  /** editing made the bill smaller than what was paid → give the difference back */
  const giveBack = edit ? round2(Math.max(0, alreadyPaid - total)) : 0
  const paid = paidAmount(pay, balance)

  const reset = () => {
    setLines([])
    setSupplier(null)
    setPay(initialPay)
    setInvoice('')
    setRemark('')
    setBillDate(today())
    setBillDisc(noDiscount)
    setBillRate(0)
    setEdit(null)
  }

  const save = async () => {
    if (!lines.length) return toast('Add at least one item', false)
    if (lines.some((l) => !(l.qty > 0))) return toast('Every item needs a quantity above 0', false)
    if (paid < balance && !supplier) return toast('Select a supplier for a credit purchase', false)
    if (bill.tooMuch) return toast('Bill discount is more than the bill amount', false)
    if (!billDate || billDate > today()) return toast("The bill date can't be in the future", false)
    setBusy(true)
    const body = {
      supplier_id: supplier?.id ?? null,
      supplier: supplier?.name ?? null,
      payment_mode: pay.mode,
      paid_amount: paid,
      invoice_no: invoice,
      note: remark,
      update_cost: updateCost,
      bill_date: billDate,
      tax_inclusive: taxInclusive,
      bill_discount: Number(billDisc.value) || 0,
      bill_discount_type: billDisc.type,
      bill_tax_rate: Number(billRate) || 0,
      items: lines.map((l) => ({
        product_id: l.product_id,
        qty: l.qty,
        cost: l.rate,
        discount: l.disc ?? 0,
        discount_type: l.discType ?? '%',
        tax_rate: l.tax ?? 0,
      })),
    }
    const { data, error } = edit
      ? await supabase.rpc('update_purchase', { p_id: edit.id, p: body })
      : await supabase.rpc('create_purchase', { p: body })
    setBusy(false)
    if (error) return toast(errMsg(error), false)
    const due = round2(balance - paid)
    toast(`Purchase #${data} ${edit ? 'updated' : 'saved'}${giveBack > 0 ? ` — supplier owes back ${money(giveBack)}` : due > 0 ? ` — ${money(due)} to pay` : ' — stock updated'}`)
    const boughtIds = [...lines.map((l) => l.product_id), ...(edit?.ids ?? [])]
    reset()
    finishSlot('purchase', slot)
    cat.refresh(boughtIds)
    nav(`/purchases?id=${data}`)
  }

  if (cat.loading && !cat.items.length) return <Spinner label="Loading products…" />

  return (
    <div className="space-y-4">
      <PageHeader
        title={edit ? `Edit purchase #${edit.id}` : 'New purchase'}
        subtitle="Make barcodes for new stock, or scan items you received"
        actions={
          <>
            <Button onClick={() => setWizard(true)}>
              <Barcode className="h-4 w-4" /> Generate barcodes
            </Button>
            <Button variant="secondary" onClick={() => setLabels(true)} disabled={!lines.length}>
              <Printer className="h-4 w-4" /> Print labels
            </Button>
            <Button variant="secondary" onClick={() => setNewOpen(true)}>
              <PackagePlus className="h-4 w-4" /> New product
            </Button>
          </>
        }
      />
      <BillTabs page="purchase" partyField="supplier" />
      {edit && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>
            Editing <b>purchase #{edit.id}</b>. Change items, costs, supplier, date, discount or GST, then tap <b>Save changes</b>.
            {alreadyPaid > 0 && <> Already paid: {money(alreadyPaid)}.</>}
          </span>
          <Button variant="secondary" className="py-1" onClick={() => closeSlot('purchase', slot)}>
            Cancel edit
          </Button>
        </div>
      )}
      {cat.error && <p className="text-sm text-red-600">{cat.error}</p>}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-3">
          <ScanBox lookup={cat.lookup} search={cat.search} onPick={add} showCost disabled={newOpen || wizard || note || labels} />
          <PurchaseLines lines={lines} onChange={setLines} taxInclusive={taxInclusive} />
        </div>

        <Card className="h-fit space-y-4 p-4 lg:sticky lg:top-6">
          <Field label="Supplier">
            <PartyPicker kind="supplier" value={supplier} onChange={setSupplier} placeholder="Supplier name or phone" />
          </Field>
          <Field label="Bill date">
            <Input type="date" value={billDate} max={today()} onChange={(e) => setBillDate(e.target.value)} />
          </Field>
          <Field label="Supplier invoice no.">
            <Input value={invoice} onChange={(e) => setInvoice(e.target.value)} />
          </Field>
          <Field label="Bill discount (type % or ₹)">
            <DiscountBox base={sums.total} value={billDisc} onChange={setBillDisc} invalid={bill.tooMuch} />
          </Field>
          <Field label="GST on bill amount">
            <Select value={billRate} onChange={(e) => setBillRate(Number(e.target.value))} aria-label="GST on bill amount">
              {GST_RATES.map((g) => (
                <option key={g} value={g}>
                  {g === 0 ? 'No GST on bill' : `${g}% on bill amount`}
                </option>
              ))}
            </Select>
            <span className="mt-1 block text-xs text-slate-500">Added on the bill amount after the bill discount. Each item can still have its own GST.</span>
            <label className="mt-1.5 flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={taxInclusive} onChange={(e) => setTaxInclusive(e.target.checked)} />
              Item costs already include their GST
            </label>
          </Field>
          <Field label="Note">
            <Input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Optional" />
          </Field>
          <label className="flex items-start gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={updateCost} onChange={(e) => setUpdateCost(e.target.checked)} className="mt-0.5" />
            Save the cost (after discounts, without GST) as the products' purchase price
          </label>
          <div className="space-y-1 border-t border-slate-100 pt-3 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>Items · Total qty</span>
              <span>
                {lines.length} · <b className="text-slate-900">{qty(lines.reduce((s, l) => s + (Number(l.qty) || 0), 0))}</b>
              </span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Items total</span>
              <span>{money(sums.gross)}</span>
            </div>
            {sums.disc > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>Item discounts</span>
                <span>−{money(sums.disc)}</span>
              </div>
            )}
            <div className="flex justify-between text-slate-600">
              <span>Taxable value</span>
              <span>{money(sums.taxable)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Item GST{taxInclusive ? ' (included)' : ''}</span>
              <span>{money(sums.tax)}</span>
            </div>
            {(bill.amount > 0 || btax.amount > 0) && (
              <div className="flex justify-between text-slate-600">
                <span>Subtotal</span>
                <span>{money(sums.total)}</span>
              </div>
            )}
            {bill.amount > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>Bill discount ({billDisc.type === '%' ? Number(billDisc.value) : round2((bill.amount / sums.total) * 100)}%)</span>
                <span>−{money(bill.amount)}</span>
              </div>
            )}
            {btax.amount > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>GST on bill ({Number(billRate)}%)</span>
                <span>+{money(btax.amount)}</span>
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
                  <span>Supplier gives back</span>
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
            <PaymentBlock pay={pay} onChange={setPay} total={balance} partyLabel="supplier" hasParty={!!supplier} />
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={reset} disabled={!lines.length || busy} title="Clear">
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button className="flex-1 py-3 text-base" loading={busy} onClick={save} disabled={!lines.length}>
              {edit ? 'Save changes' : 'Save purchase'}
            </Button>
          </div>
        </Card>
      </div>

      <BarcodeWizard
        open={wizard}
        onClose={() => {
          setWizard(false)
          cat.refresh(lines.map((l) => l.product_id)) // new products made by the wizard
        }}
        onAdd={addFromWizard}
        onOpenNote={() => {
          setWizard(false)
          setNoteOpen(true)
        }}
      />
      <NoteReader
        open={note}
        onClose={() => {
          setNoteOpen(false)
          cat.refresh(lines.map((l) => l.product_id))
        }}
        onAdd={addFromWizard}
      />
      <LabelPrinter open={labels} onClose={() => setLabels(false)} lines={lines} />
      <ProductForm
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onSaved={(p) => {
          setNewOpen(false)
          // opening stock is entered in the form; the purchase line adds on top of it
          add({ ...p, stock: Number(p.stock) })
          cat.refresh([p.id])
        }}
      />
    </div>
  )
}
