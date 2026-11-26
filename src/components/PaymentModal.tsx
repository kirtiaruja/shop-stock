import { useEffect, useState } from 'react'
import { supabase, errMsg, PAY_MODES } from '../lib/supabase'
import { money, dateTime, round2 } from '../lib/format'
import { Button, Field, Input, Modal, Select, Spinner, useToast } from './ui'

interface OpenBill {
  bill_id: number
  created_at: string
  total: number
  paid: number
  due: number
  ref: string | null
}

interface Props {
  open: boolean
  onClose: () => void
  onDone: () => void
  kind: 'sale' | 'purchase'
  /** pay against one bill … */
  bill?: { id: number; due: number; party: string | null } | null
  /** … or against a customer / supplier (spread over their unpaid bills, oldest first) */
  party?: { id: number; name: string } | null
}

/** Receive money from a customer (sale) or pay a supplier (purchase). */
export default function PaymentModal({ open, onClose, onDone, kind, bill, party }: Props) {
  const toast = useToast()
  const [bills, setBills] = useState<OpenBill[] | null>(null)
  const [target, setTarget] = useState<string>('auto')
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState('Cash')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const billId = bill?.id
  const billDue = bill?.due
  const partyId = party?.id

  // reset the form each time it opens (deps are plain values so parent re-renders don't wipe what you typed)
  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNote('')
    setMode('Cash')
    setTarget(billId ? String(billId) : 'auto')
    if (billId) {
      setBills(null)
      setAmount(String(billDue ?? ''))
      return
    }
    if (partyId) {
      setBills(null)
      supabase.rpc('open_bills', { p_kind: kind, p_party: partyId }).then(({ data, error }) => {
        if (error) toast(error.message, false)
        const list = (data ?? []) as OpenBill[]
        setBills(list)
        setAmount(String(round2(list.reduce((s, b) => s + Number(b.due), 0))))
      })
    }
  }, [open, billId, billDue, partyId, kind, toast])

  const maxDue = bill
    ? Number(bill.due)
    : target === 'auto'
      ? round2((bills ?? []).reduce((s, b) => s + Number(b.due), 0))
      : Number((bills ?? []).find((b) => String(b.bill_id) === target)?.due ?? 0)

  const save = async () => {
    const amt = Number(amount)
    if (!(amt > 0)) return toast('Enter an amount', false)
    if (amt > maxDue + 0.001) return toast(`Amount is more than the balance due (${money(maxDue)})`, false)
    setBusy(true)
    const { data, error } = await supabase.rpc('record_payment', {
      p: {
        kind,
        bill_id: target === 'auto' ? null : Number(target),
        party_id: target === 'auto' ? party?.id : null,
        amount: amt,
        mode,
        note,
      },
    })
    setBusy(false)
    if (error) return toast(errMsg(error), false)
    const parts = (data as { bill_id: number; amount: number }[]).map((x) => `#${x.bill_id}: ${money(x.amount)}`).join(', ')
    toast(`${kind === 'sale' ? 'Received' : 'Paid'} ${money(amt)} → ${parts}`)
    onDone()
  }

  const who = bill?.party ?? party?.name ?? ''
  const title = kind === 'sale' ? `Receive payment${who ? ` from ${who}` : ''}` : `Pay supplier${who ? ` ${who}` : ''}`
  const billWord = kind === 'sale' ? 'Bill' : 'Purchase'

  return (
    <Modal open={open} onClose={onClose} title={title}>
      {party && !bill && bills === null ? (
        <Spinner />
      ) : (
        <div className="space-y-4 text-sm">
          {bill ? (
            <div className="rounded-lg bg-amber-50 p-3">
              {billWord} #{bill.id} · balance due <b>{money(bill.due)}</b>
            </div>
          ) : bills && bills.length === 0 ? (
            <p className="text-slate-500">Nothing is due.</p>
          ) : (
            <>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {bills?.map((b) => (
                  <li key={b.bill_id} className="flex justify-between gap-3 px-3 py-2">
                    <span>
                      {billWord} #{b.bill_id}
                      {b.ref && <span className="text-slate-500"> · inv {b.ref}</span>}
                      <span className="block text-xs text-slate-500">
                        {dateTime(b.created_at)} · total {money(b.total)}, paid {money(b.paid)}
                      </span>
                    </span>
                    <span className="font-semibold text-amber-700">{money(b.due)}</span>
                  </li>
                ))}
              </ul>
              <Field label="Apply to">
                <Select
                  value={target}
                  onChange={(e) => {
                    setTarget(e.target.value)
                    const b = bills?.find((x) => String(x.bill_id) === e.target.value)
                    setAmount(String(b ? b.due : round2((bills ?? []).reduce((s, x) => s + Number(x.due), 0))))
                  }}
                >
                  <option value="auto">Oldest bills first (automatic)</option>
                  {bills?.map((b) => (
                    <option key={b.bill_id} value={b.bill_id}>
                      {billWord} #{b.bill_id} only — {money(b.due)} due
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}

          {maxDue > 0 && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Amount (₹)" hint={`Max ${money(maxDue)}`}>
                  <Input type="number" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
                </Field>
                <Field label="Paid by">
                  <Select value={mode} onChange={(e) => setMode(e.target.value)}>
                    {PAY_MODES.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Note">
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="UPI ref no., cheque no. … (optional)" />
              </Field>
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            {maxDue > 0 && (
              <Button loading={busy} onClick={save}>
                {kind === 'sale' ? 'Save receipt' : 'Save payment'}
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
