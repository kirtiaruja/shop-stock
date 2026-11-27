import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Download, Pencil, Trash2 } from 'lucide-react'
import { editPurchase } from '../lib/editBill'
import { supabase, errMsg } from '../lib/supabase'
import { usePermissions } from '../lib/auth'
import { money, qty, dateTime } from '../lib/format'
import { downloadSheet } from '../lib/excel'
import BillPayments from '../components/BillPayments'
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Spinner, useToast } from '../components/ui'

interface PurchaseItem {
  id: number
  product_id?: number | null
  product_name: string
  item_code: string | null
  qty: number
  cost: number
  line_total: number
  discount_type?: string
  discount?: number
  discount_amount?: number
  taxable?: number | null
  tax_rate?: number
  tax_amount?: number
}
interface PurchaseRow {
  id: number
  supplier_id?: number | null
  supplier: string | null
  invoice_no: string | null
  total: number
  subtotal?: number
  discount_total?: number
  tax_total?: number
  tax_inclusive?: boolean
  items_total?: number | null
  bill_discount?: number
  bill_discount_type?: string
  bill_discount_amount?: number
  bill_tax_rate?: number
  bill_tax_amount?: number
  bill_date?: string | null
  paid_amount: number
  due_amount: number
  payment_mode: string
  note: string | null
  created_by_name: string | null
  created_at: string
  edited_at?: string | null
  edited_by_name?: string | null
  purchase_items?: PurchaseItem[]
}

const monthStart = () => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('en-CA')
}
const today = () => new Date().toLocaleDateString('en-CA')

export default function Purchases() {
  const { isAdmin, isManager } = usePermissions()
  const nav = useNavigate()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(today())
  const [rows, setRows] = useState<PurchaseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<PurchaseRow | null>(null)
  const [onlyDue, setOnlyDue] = useState(false)
  const [tick, setTick] = useState(0)
  const id = params.get('id')

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('purchases').select('*')
    q = onlyDue
      ? q.gt('due_amount', 0)
      : q.gte('created_at', new Date(`${from}T00:00:00`).toISOString()).lte('created_at', new Date(`${to}T23:59:59.999`).toISOString())
    const { data, error } = await q.order('created_at', { ascending: false }).limit(1000)
    if (error) toast(error.message, false)
    setRows((data ?? []) as PurchaseRow[])
    setLoading(false)
  }, [from, to, onlyDue, toast])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  useEffect(() => {
    if (!id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDetail(null)
      return
    }
    supabase
      .from('purchases')
      .select('*, purchase_items(*)')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (error) toast(error.message, false)
        else setDetail(data as PurchaseRow)
      })
  }, [id, toast, tick])

  const close = () => setParams({})

  const remove = async () => {
    if (!detail) return
    if (!confirm(`Delete purchase #${detail.id}? Its quantities will be taken back out of stock.`)) return
    const { error } = await supabase.rpc('delete_purchase', { p_id: detail.id })
    if (error) return toast(errMsg(error), false)
    toast('Purchase deleted')
    close()
    load()
  }

  const exportRange = async () => {
    const { data, error } = await supabase
      .from('purchases')
      .select('*, purchase_items(*)')
      .gte('created_at', new Date(`${from}T00:00:00`).toISOString())
      .lte('created_at', new Date(`${to}T23:59:59.999`).toISOString())
      .order('created_at')
    if (error) return toast(error.message, false)
    const out = (data as PurchaseRow[]).flatMap((p) =>
      (p.purchase_items ?? []).map((it) => ({
        'Purchase no': p.id,
        Date: dateTime(p.created_at),
        Supplier: p.supplier,
        Invoice: p.invoice_no,
        Item: it.product_name,
        'Item code': it.item_code,
        Qty: Number(it.qty),
        Cost: Number(it.cost),
        'Discount ₹': Number(it.discount_amount ?? 0),
        'Taxable ₹': Number(it.taxable ?? it.line_total),
        'GST %': Number(it.tax_rate ?? 0),
        'GST ₹': Number(it.tax_amount ?? 0),
        Amount: Number(it.line_total),
        'Bill discount ₹': Number(p.bill_discount_amount ?? 0),
        'GST on bill %': Number(p.bill_tax_rate ?? 0),
        'GST on bill ₹': Number(p.bill_tax_amount ?? 0),
        'Purchase total': Number(p.total),
        'Paid': Number(p.paid_amount),
        'Due': Number(p.due_amount),
        'Entered by': p.created_by_name,
      })),
    )
    downloadSheet(out, 'Purchases', `purchases-${from}-to-${to}.xlsx`)
  }

  const total = rows.reduce((s, r) => s + Number(r.total), 0)
  const due = rows.reduce((s, r) => s + Number(r.due_amount), 0)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Purchases"
        subtitle={`${rows.length} purchases · ${money(total)}${due > 0 ? ` · ${money(due)} to pay` : ''}`}
        actions={
          <Button variant="secondary" onClick={exportRange} disabled={!rows.length}>
            <Download className="h-4 w-4" /> Excel
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-3 sm:flex sm:items-end">
        <Field label="From">
          <Input type="date" value={from} max={to} disabled={onlyDue} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <Input type="date" value={to} min={from} disabled={onlyDue} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <label className="col-span-2 flex items-center gap-2 pb-2 text-sm text-slate-700">
          <input type="checkbox" checked={onlyDue} onChange={(e) => setOnlyDue(e.target.checked)} /> Unpaid only (any date)
        </label>
      </div>
      <Card className="overflow-hidden">
        {loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <Empty>No purchases in this period.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={r.id}>
                <button onClick={() => setParams({ id: String(r.id) })} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      #{r.id} · {r.supplier || 'No supplier'}
                      {r.invoice_no && <span className="text-slate-500"> · inv {r.invoice_no}</span>}
                    </div>
                    <div className="text-xs text-slate-500">
                      {dateTime(r.created_at)}
                      {r.created_by_name ? ` · ${r.created_by_name}` : ''}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold">{money(r.total)}</div>
                    {Number(r.due_amount) > 0 ? <Badge tone="amber">Due {money(r.due_amount)}</Badge> : <Badge tone="green">Paid</Badge>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={!!id} onClose={close} title={detail ? `Purchase #${detail.id}` : 'Purchase'} wide>
        {!detail ? (
          <Spinner />
        ) : (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-2 text-slate-600">
              <div>Supplier: <b className="text-slate-800">{detail.supplier || '—'}</b></div>
              <div>Invoice: <b className="text-slate-800">{detail.invoice_no || '—'}</b></div>
              <div>
                Bill date: {detail.bill_date ? new Date(`${detail.bill_date}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : dateTime(detail.created_at)}
              </div>
              <div>By: {detail.created_by_name || '—'}</div>
              {detail.edited_at && (
                <div className="col-span-2 text-xs text-slate-500">
                  Edited {dateTime(detail.edited_at)}
                  {detail.edited_by_name ? ` by ${detail.edited_by_name}` : ''}
                </div>
              )}
            </div>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {(detail.purchase_items ?? []).map((it) => (
                <li key={it.id} className="flex justify-between gap-3 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate">{it.product_name}</span>
                    <span className="text-xs text-slate-500">
                      {qty(it.qty)} × {money(it.cost)}
                      {Number(it.discount_amount) > 0 &&
                        ` · disc ${it.discount_type === '₹' ? money(it.discount) : `${Number(it.discount)}%`} (−${money(it.discount_amount)})`}
                      {Number(it.tax_rate) > 0 && ` · GST ${Number(it.tax_rate)}% ${money(it.tax_amount)}`}
                    </span>
                  </span>
                  <span className="font-medium">{money(it.line_total)}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-between text-slate-600">
              <span>Items · Total qty</span>
              <span>
                {detail.purchase_items?.length ?? 0} · <b className="text-slate-900">{qty((detail.purchase_items ?? []).reduce((s, it) => s + Number(it.qty), 0))}</b>
              </span>
            </div>
            {(Number(detail.discount_total) > 0 || Number(detail.tax_total) > 0 || Number(detail.bill_discount_amount) > 0 || Number(detail.bill_tax_amount) > 0) && (
              <div className="space-y-0.5 text-slate-600">
                <div className="flex justify-between">
                  <span>Items total</span>
                  <span>{money(detail.subtotal)}</span>
                </div>
                {Number(detail.discount_total) > 0 && (
                  <div className="flex justify-between">
                    <span>Item discounts</span>
                    <span>−{money(detail.discount_total)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Item GST{detail.tax_inclusive ? ' (included)' : ''}</span>
                  <span>{money(detail.tax_total)}</span>
                </div>
                {Number(detail.bill_discount_amount) > 0 && (
                  <div className="flex justify-between">
                    <span>
                      Bill discount{detail.bill_discount_type === '%' ? ` (${Number(detail.bill_discount)}%)` : ''}
                    </span>
                    <span>−{money(detail.bill_discount_amount)}</span>
                  </div>
                )}
                {Number(detail.bill_tax_amount) > 0 && (
                  <div className="flex justify-between">
                    <span>GST on bill ({Number(detail.bill_tax_rate)}%)</span>
                    <span>+{money(detail.bill_tax_amount)}</span>
                  </div>
                )}
              </div>
            )}
            <div className="flex justify-between text-base font-bold">
              <span>Total</span>
              <span>{money(detail.total)}</span>
            </div>
            {detail.note && <p className="text-slate-600">Note: {detail.note}</p>}
            <BillPayments
              kind="purchase"
              billId={detail.id}
              total={detail.total}
              paid={detail.paid_amount}
              party={detail.supplier}
              onChanged={() => {
                setTick((t) => t + 1)
                load()
              }}
            />
            <div className="flex gap-2">
              {isAdmin && (
                <Button variant="danger" onClick={remove}>
                  <Trash2 className="h-4 w-4" /> Delete
                </Button>
              )}
              {isManager && (
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={async () => {
                    const missing = await editPurchase(detail)
                    if (missing) toast('Some products on this purchase were deleted — they are left out', false)
                    nav('/purchase/new')
                  }}
                >
                  <Pencil className="h-4 w-4" /> Edit
                </Button>
              )}
              <Button className="flex-1" onClick={close}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
