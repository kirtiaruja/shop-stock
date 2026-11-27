import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Download, Pencil, Printer, Trash2 } from 'lucide-react'
import { editSale } from '../lib/editBill'
import { supabase, errMsg } from '../lib/supabase'
import { usePermissions } from '../lib/auth'
import { money, dateTime } from '../lib/format'
import { downloadSheet } from '../lib/excel'
import Receipt, { printReceipt, type SaleDetail } from '../components/Receipt'
import BillPayments from '../components/BillPayments'
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Spinner, useToast } from '../components/ui'

const today = () => new Date().toLocaleDateString('en-CA') // yyyy-mm-dd in local time
const startOf = (d: string) => new Date(`${d}T00:00:00`).toISOString()
const endOf = (d: string) => new Date(`${d}T23:59:59.999`).toISOString()

type SaleRow = Omit<SaleDetail, 'sale_items'>

export default function Sales() {
  const { isAdmin, isManager } = usePermissions()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const nav = useNavigate()
  const [from, setFrom] = useState(today())
  const [to, setTo] = useState(today())
  const [rows, setRows] = useState<SaleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<SaleDetail | null>(null)
  const [onlyDue, setOnlyDue] = useState(false)
  const [tick, setTick] = useState(0)
  const billId = params.get('bill')

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('sales').select('*')
    // "Unpaid only" shows every bill with a balance, whatever its date
    q = onlyDue ? q.gt('due_amount', 0) : q.gte('created_at', startOf(from)).lte('created_at', endOf(to))
    const { data, error } = await q.order('created_at', { ascending: false }).limit(1000)
    if (error) toast(error.message, false)
    setRows((data ?? []) as SaleRow[])
    setLoading(false)
  }, [from, to, onlyDue, toast])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  useEffect(() => {
    if (!billId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDetail(null)
      return
    }
    supabase
      .from('sales')
      .select('*, sale_items(*)')
      .eq('id', billId)
      .single()
      .then(({ data, error }) => {
        if (error) toast(error.message, false)
        else setDetail(data as SaleDetail)
      })
  }, [billId, toast, tick])

  const close = () => setParams({})

  const remove = async () => {
    if (!detail) return
    if (!confirm(`Delete bill #${detail.id}? The items will be added back to stock.`)) return
    const { error } = await supabase.rpc('delete_sale', { p_id: detail.id })
    if (error) return toast(errMsg(error), false)
    toast(`Bill #${detail.id} deleted`)
    close()
    load()
  }

  const exportRange = async () => {
    const { data, error } = await supabase
      .from('sales')
      .select('*, sale_items(*)')
      .gte('created_at', startOf(from))
      .lte('created_at', endOf(to))
      .order('created_at')
    if (error) return toast(error.message, false)
    const out = (data as SaleDetail[]).flatMap((s) =>
      s.sale_items.map((it) => ({
        'Bill no': s.id,
        Date: dateTime(s.created_at),
        Customer: s.customer_name || 'Walk-in',
        Item: it.product_name,
        'Item code': it.item_code,
        Qty: Number(it.qty),
        Price: Number(it.price),
        Amount: Number(it.line_total),
        'Bill discount': Number(s.discount),
        'Bill total': Number(s.total),
        'Bill paid': Number(s.paid_amount),
        'Bill due': Number(s.due_amount),
        Payment: s.payment_mode,
        'Sold by': s.created_by_name,
      })),
    )
    downloadSheet(out, 'Sales', `sales-${from}-to-${to}.xlsx`)
  }

  const total = rows.reduce((s, r) => s + Number(r.total), 0)
  const received = rows.reduce((s, r) => s + Number(r.paid_amount), 0)
  const due = rows.reduce((s, r) => s + Number(r.due_amount), 0)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sales"
        subtitle={isManager ? 'All bills' : 'Bills you created'}
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
          <input type="checkbox" checked={onlyDue} onChange={(e) => setOnlyDue(e.target.checked)} /> Unpaid bills only (any date)
        </label>
      </div>

      <Card className="flex flex-wrap gap-x-6 gap-y-1 p-4 text-sm">
        <span>
          <b>{rows.length}</b> bills
        </span>
        <span>
          Total <b>{money(total)}</b>
        </span>
        <span className="text-slate-600">Received {money(received)}</span>
        {due > 0 && <span className="font-medium text-amber-700">Due {money(due)}</span>}
      </Card>

      <Card className="overflow-hidden">
        {loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <Empty>No bills in this period.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={r.id}>
                <button onClick={() => setParams({ bill: String(r.id) })} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      #{r.id} · {r.customer_name || 'Walk-in'}
                    </div>
                    <div className="text-xs text-slate-500">
                      {dateTime(r.created_at)}
                      {isManager && r.created_by_name ? ` · ${r.created_by_name}` : ''}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold">{money(r.total)}</div>
                    {Number(r.due_amount) > 0 ? (
                      <Badge tone="amber">Due {money(r.due_amount)}</Badge>
                    ) : (
                      <Badge tone="slate">{r.payment_mode === 'Credit' ? 'Paid' : r.payment_mode}</Badge>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={!!billId} onClose={close} title={detail ? `Bill #${detail.id}` : 'Bill'}>
        {!detail ? (
          <Spinner />
        ) : (
          <div className="space-y-4">
            <Receipt sale={detail} />
            {detail.note && <p className="text-sm text-slate-600 print:hidden">Note: {detail.note}</p>}
            {detail.edited_at && (
              <p className="text-xs text-slate-500 print:hidden">
                Edited {dateTime(detail.edited_at)}
                {detail.edited_by_name ? ` by ${detail.edited_by_name}` : ''}
              </p>
            )}
            <BillPayments
              kind="sale"
              billId={detail.id}
              total={detail.total}
              paid={detail.paid_amount}
              party={detail.customer_name}
              onChanged={() => {
                setTick((t) => t + 1)
                load()
              }}
            />
            <div className="flex gap-2 print:hidden">
              {isAdmin && (
                <Button variant="danger" onClick={remove}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
              {isManager && (
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={async () => {
                    const missing = await editSale(detail)
                    if (missing) toast('Some products on this bill were deleted — they are left out', false)
                    nav('/sale/new')
                  }}
                >
                  <Pencil className="h-4 w-4" /> Edit
                </Button>
              )}
              <Button variant="secondary" className="flex-1" onClick={printReceipt}>
                <Printer className="h-4 w-4" /> Print
              </Button>
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
