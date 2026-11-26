import { useCallback, useEffect, useState } from 'react'
import { Trash2, Wallet } from 'lucide-react'
import { supabase, errMsg, type Payment } from '../lib/supabase'
import { usePermissions } from '../lib/auth'
import { money, dateTime } from '../lib/format'
import PaymentModal from './PaymentModal'
import { Badge, Button, useToast } from './ui'

/** Paid / due summary and payment history for one bill, with "receive / pay" button. */
export default function BillPayments({
  kind,
  billId,
  total,
  paid,
  party,
  onChanged,
}: {
  kind: 'sale' | 'purchase'
  billId: number
  total: number
  paid: number
  party: string | null
  onChanged: () => void
}) {
  const { isAdmin } = usePermissions()
  const toast = useToast()
  const [rows, setRows] = useState<Payment[]>([])
  const [open, setOpen] = useState(false)
  const due = Math.round((Number(total) - Number(paid)) * 100) / 100

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('bill_payments', { p_kind: kind, p_bill: billId })
    if (error) toast(error.message, false)
    setRows((data ?? []) as Payment[])
  }, [kind, billId, toast])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load, paid])

  const remove = async (p: Payment) => {
    if (!confirm(`Delete this ${money(p.amount)} payment entry? The bill will show it as due again.`)) return
    const { error } = await supabase.rpc('delete_payment', { p_id: p.id })
    if (error) return toast(errMsg(error), false)
    toast('Payment entry deleted')
    onChanged()
  }

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm print:hidden">
      <div className="flex items-center justify-between">
        <span className="font-medium">Payments</span>
        {due > 0 ? <Badge tone="amber">Due {money(due)}</Badge> : <Badge tone="green">Fully paid</Badge>}
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500">No payment yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 py-1.5">
              <span className="min-w-0">
                <span className="font-medium">{money(p.amount)}</span> · {p.mode}
                <span className="block truncate text-xs text-slate-500">
                  {dateTime(p.created_at)}
                  {p.created_by_name ? ` · ${p.created_by_name}` : ''}
                  {p.note ? ` · ${p.note}` : ''}
                </span>
              </span>
              {isAdmin && (
                <button onClick={() => remove(p)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Delete payment">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {due > 0 && (
        <Button variant="secondary" className="w-full" onClick={() => setOpen(true)}>
          <Wallet className="h-4 w-4" /> {kind === 'sale' ? 'Receive payment' : 'Pay supplier'}
        </Button>
      )}
      <PaymentModal
        open={open}
        kind={kind}
        bill={{ id: billId, due, party }}
        onClose={() => setOpen(false)}
        onDone={() => {
          setOpen(false)
          onChanged()
        }}
      />
    </div>
  )
}
