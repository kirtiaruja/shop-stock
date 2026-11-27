import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PackagePlus, RotateCcw, Barcode, Printer } from 'lucide-react'
import { supabase, errMsg, type CatalogItem, type Product, type Supplier } from '../lib/supabase'
import { useCatalog } from '../lib/catalog'
import { money } from '../lib/format'
import ScanBox from '../components/ScanBox'
import LineList, { linesTotal, type Line } from '../components/LineList'
import ProductForm from '../components/ProductForm'
import BarcodeWizard, { type WizardItem } from '../components/BarcodeWizard'
import NoteReader from '../components/NoteReader'
import LabelPrinter from '../components/LabelPrinter'
import { PartyPicker } from '../components/CustomerPicker'
import PaymentBlock, { initialPay, paidAmount, type PayState } from '../components/PaymentBlock'
import { Button, Card, Field, Input, PageHeader, Spinner, useToast } from '../components/ui'

const DRAFT_KEY = 'stockpilot.purchaseDraft'
const loadDraft = (): Line[] => {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || '[]')
    return Array.isArray(d) ? d : []
  } catch {
    return []
  }
}

export default function NewPurchase() {
  const cat = useCatalog(true)
  const toast = useToast()
  const nav = useNavigate()
  const [lines, setLines] = useState<Line[]>(loadDraft)
  const [wizard, setWizard] = useState(false)
  const [note, setNoteOpen] = useState(false)
  const [labels, setLabels] = useState(false)
  const [supplier, setSupplier] = useState<Supplier | null>(null)
  const [pay, setPay] = useState<PayState>(initialPay)
  const [invoice, setInvoice] = useState('')
  const [remark, setRemark] = useState('')
  const [updateCost, setUpdateCost] = useState(true)
  const [busy, setBusy] = useState(false)
  const [newOpen, setNewOpen] = useState(false)

  const add = (p: CatalogItem | Product) =>
    setLines((ls) => {
      const i = ls.findIndex((l) => l.product_id === p.id)
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l))
      return [...ls, { product_id: p.id, name: p.name, item_code: p.item_code, qty: 1, rate: Number(p.purchase_price) || 0, stock: Number(p.stock) }]
    })

  // keep the purchase in progress if the page is refreshed
  useEffect(() => {
    try {
      if (lines.length) localStorage.setItem(DRAFT_KEY, JSON.stringify(lines))
      else localStorage.removeItem(DRAFT_KEY)
    } catch {
      /* ignore */
    }
  }, [lines])

  /** Item made in the barcode wizard / note reader → purchase line with its label. */
  const addFromWizard = ({ result, qty, cost, desc }: WizardItem) =>
    setLines((ls) => {
      const p = result.product
      const label = { item_name: result.item_name, barcode: result.barcode_number, mrp: result.mrp, desc }
      const i = ls.findIndex((l) => l.product_id === p.id)
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: l.qty + qty, rate: cost, label } : l))
      return [...ls, { product_id: p.id, name: p.name, item_code: result.barcode_number, qty, rate: cost, stock: Number(p.stock), label }]
    })

  const total = linesTotal(lines)
  const paid = paidAmount(pay, total)

  const reset = () => {
    setLines([])
    setSupplier(null)
    setPay(initialPay)
    setInvoice('')
    setRemark('')
  }

  const save = async () => {
    if (!lines.length) return toast('Add at least one item', false)
    if (lines.some((l) => !(l.qty > 0))) return toast('Every item needs a quantity above 0', false)
    if (paid < total && !supplier) return toast('Select a supplier for a credit purchase', false)
    setBusy(true)
    const { data, error } = await supabase.rpc('create_purchase', {
      p: {
        supplier_id: supplier?.id ?? null,
        supplier: supplier?.name ?? null,
        payment_mode: pay.mode,
        paid_amount: paid,
        invoice_no: invoice,
        note: remark,
        update_cost: updateCost,
        items: lines.map((l) => ({ product_id: l.product_id, qty: l.qty, cost: l.rate })),
      },
    })
    setBusy(false)
    if (error) return toast(errMsg(error), false)
    toast(paid < total ? `Purchase #${data} saved — ${money(total - paid)} to pay` : `Purchase #${data} saved — stock updated`)
    reset()
    cat.reload()
    nav(`/purchases?id=${data}`)
  }

  if (cat.loading && !cat.items.length) return <Spinner label="Loading products…" />

  return (
    <div className="space-y-4">
      <PageHeader
        title="New purchase"
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
      {cat.error && <p className="text-sm text-red-600">{cat.error}</p>}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-3">
          <ScanBox lookup={cat.lookup} search={cat.search} onPick={add} showCost disabled={newOpen || wizard || note || labels} />
          <LineList lines={lines} onChange={setLines} rateLabel="Cost" />
        </div>

        <Card className="h-fit space-y-4 p-4 lg:sticky lg:top-6">
          <Field label="Supplier">
            <PartyPicker kind="supplier" value={supplier} onChange={setSupplier} placeholder="Supplier name or phone" />
          </Field>
          <Field label="Supplier invoice no.">
            <Input value={invoice} onChange={(e) => setInvoice(e.target.value)} />
          </Field>
          <Field label="Note">
            <Input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Optional" />
          </Field>
          <label className="flex items-start gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={updateCost} onChange={(e) => setUpdateCost(e.target.checked)} className="mt-0.5" />
            Save these costs as the products' new purchase price
          </label>
          <div className="flex justify-between border-t border-slate-100 pt-3 text-xl font-bold">
            <span>Total</span>
            <span>{money(total)}</span>
          </div>
          <PaymentBlock pay={pay} onChange={setPay} total={total} partyLabel="supplier" hasParty={!!supplier} />
          <div className="flex gap-2">
            <Button variant="secondary" onClick={reset} disabled={!lines.length || busy} title="Clear">
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button className="flex-1 py-3 text-base" loading={busy} onClick={save} disabled={!lines.length}>
              Save purchase
            </Button>
          </div>
        </Card>
      </div>

      <BarcodeWizard
        open={wizard}
        onClose={() => {
          setWizard(false)
          cat.reload()
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
          cat.reload()
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
          cat.reload()
        }}
      />
    </div>
  )
}
