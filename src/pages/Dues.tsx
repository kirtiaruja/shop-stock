import { useCallback, useEffect, useState } from 'react'
import { Phone, Wallet } from 'lucide-react'
import { supabase, type Balance } from '../lib/supabase'
import { usePermissions } from '../lib/auth'
import { money, dateTime } from '../lib/format'
import PaymentModal from '../components/PaymentModal'
import { Button, Card, Empty, PageHeader, Spinner, useToast } from '../components/ui'

type Tab = 'sale' | 'purchase'

/** Who owes the shop money (customers) and whom the shop owes (suppliers). */
export default function Dues() {
  const { isManager } = usePermissions()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('sale')
  const [rows, setRows] = useState<Balance[]>([])
  const [loading, setLoading] = useState(true)
  const [paying, setPaying] = useState<Balance | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.rpc('party_balances', { p_kind: tab })
    if (error) toast(error.message, false)
    setRows((data ?? []) as Balance[])
    setLoading(false)
  }, [tab, toast])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const total = rows.reduce((s, r) => s + Number(r.due), 0)

  return (
    <div className="space-y-4">
      <PageHeader title="Dues (udhaar)" subtitle="Unpaid balances on credit bills" />

      {isManager && (
        <div className="grid grid-cols-2 rounded-xl bg-white p-1 text-sm font-medium ring-1 ring-slate-200 sm:w-96">
          <button onClick={() => setTab('sale')} className={`rounded-lg py-2 ${tab === 'sale' ? 'bg-indigo-600 text-white' : 'text-slate-600'}`}>
            To receive (customers)
          </button>
          <button onClick={() => setTab('purchase')} className={`rounded-lg py-2 ${tab === 'purchase' ? 'bg-indigo-600 text-white' : 'text-slate-600'}`}>
            To pay (suppliers)
          </button>
        </div>
      )}

      <Card className="flex items-center justify-between p-4">
        <span className="text-sm text-slate-600">{tab === 'sale' ? 'Total to receive' : 'Total to pay'}</span>
        <span className="text-xl font-bold text-amber-700">{money(total)}</span>
      </Card>

      <Card className="overflow-hidden">
        {loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <Empty>No dues. 🎉</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={r.party_id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{r.name}</div>
                  <div className="text-xs text-slate-500">
                    {r.bills} unpaid {tab === 'sale' ? 'bill' : 'purchase'}
                    {Number(r.bills) > 1 ? 's' : ''} · oldest {dateTime(r.oldest)}
                  </div>
                  {r.contact && (
                    <a href={`tel:${r.contact}`} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-600">
                      <Phone className="h-3 w-3" /> {r.contact}
                    </a>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="font-semibold text-amber-700">{money(r.due)}</span>
                  <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => setPaying(r)}>
                    <Wallet className="h-3.5 w-3.5" /> {tab === 'sale' ? 'Receive' : 'Pay'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <PaymentModal
        open={!!paying}
        kind={tab}
        party={paying ? { id: paying.party_id, name: paying.name } : null}
        onClose={() => setPaying(null)}
        onDone={() => {
          setPaying(null)
          load()
        }}
      />
    </div>
  )
}
