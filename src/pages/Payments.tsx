import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, Download } from 'lucide-react'
import { supabase, PAY_MODES, type Payment } from '../lib/supabase'
import { usePermissions } from '../lib/auth'
import { money, dateTime } from '../lib/format'
import { downloadSheet } from '../lib/excel'
import { Button, Card, Empty, Field, Input, PageHeader, Select, Spinner, useToast } from '../components/ui'

const today = () => new Date().toLocaleDateString('en-CA')

/** Ledger of every payment in (from customers) and out (to suppliers), each tied to its bill. */
export default function Payments() {
  const { isManager } = usePermissions()
  const toast = useToast()
  const [from, setFrom] = useState(today())
  const [to, setTo] = useState(today())
  const [dir, setDir] = useState<'all' | 'in' | 'out'>('all')
  const [mode, setMode] = useState('all')
  const [rows, setRows] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('payments')
      .select('*')
      .gte('created_at', new Date(`${from}T00:00:00`).toISOString())
      .lte('created_at', new Date(`${to}T23:59:59.999`).toISOString())
    if (dir !== 'all') q = q.eq('direction', dir)
    if (mode !== 'all') q = q.eq('mode', mode)
    const { data, error } = await q.order('created_at', { ascending: false }).limit(2000)
    if (error) toast(error.message, false)
    setRows((data ?? []) as Payment[])
    setLoading(false)
  }, [from, to, dir, mode, toast])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const sumIn = rows.filter((r) => r.direction === 'in').reduce((s, r) => s + Number(r.amount), 0)
  const sumOut = rows.filter((r) => r.direction === 'out').reduce((s, r) => s + Number(r.amount), 0)
  const byMode = rows.reduce<Record<string, { in: number; out: number }>>((m, r) => {
    m[r.mode] ??= { in: 0, out: 0 }
    m[r.mode][r.direction] += Number(r.amount)
    return m
  }, {})

  const exportRows = () =>
    downloadSheet(
      rows
        .slice()
        .reverse()
        .map((r) => ({
          Date: dateTime(r.created_at),
          Type: r.direction === 'in' ? 'Received' : 'Paid',
          'Bill / Purchase no': r.direction === 'in' ? `Bill #${r.sale_id}` : `Purchase #${r.purchase_id}`,
          Party: r.party_name ?? '',
          Mode: r.mode,
          In: r.direction === 'in' ? Number(r.amount) : '',
          Out: r.direction === 'out' ? Number(r.amount) : '',
          Note: r.note ?? '',
          By: r.created_by_name ?? '',
        })),
      'Payments',
      `payments-${from}-to-${to}.xlsx`,
    )

  return (
    <div className="space-y-4">
      <PageHeader
        title="Payments"
        subtitle={isManager ? 'All money in and out, by bill' : 'Payments you collected'}
        actions={
          <Button variant="secondary" onClick={exportRows} disabled={!rows.length}>
            <Download className="h-4 w-4" /> Excel
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="From">
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </Field>
        {isManager && (
          <Field label="Type">
            <Select value={dir} onChange={(e) => setDir(e.target.value as typeof dir)}>
              <option value="all">In & out</option>
              <option value="in">Received (in)</option>
              <option value="out">Paid (out)</option>
            </Select>
          </Field>
        )}
        <Field label="Mode">
          <Select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="all">All modes</option>
            {PAY_MODES.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3">
          <div className="text-xs text-slate-500">Received</div>
          <div className="font-semibold text-emerald-700 sm:text-lg">{money(sumIn)}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-slate-500">Paid out</div>
          <div className="font-semibold text-red-700 sm:text-lg">{money(sumOut)}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-slate-500">Net</div>
          <div className="font-semibold sm:text-lg">{money(sumIn - sumOut)}</div>
        </Card>
      </div>
      {Object.keys(byMode).length > 0 && (
        <Card className="flex flex-wrap gap-x-5 gap-y-1 p-3 text-xs text-slate-600">
          {Object.entries(byMode).map(([m, v]) => (
            <span key={m}>
              <b>{m}</b>: in {money(v.in)}
              {isManager && ` · out ${money(v.out)}`}
            </span>
          ))}
        </Card>
      )}

      <Card className="overflow-hidden">
        {loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <Empty>No payments in this period.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => {
              const isIn = r.direction === 'in'
              const link = isIn ? `/sales?bill=${r.sale_id}` : `/purchases?id=${r.purchase_id}`
              return (
                <li key={r.id}>
                  <Link to={link} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className={`rounded-full p-1.5 ${isIn ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                        {isIn ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {isIn ? `Bill #${r.sale_id}` : `Purchase #${r.purchase_id}`} · {r.party_name || (isIn ? 'Walk-in' : 'No supplier')}
                        </div>
                        <div className="truncate text-xs text-slate-500">
                          {dateTime(r.created_at)} · {r.mode}
                          {r.created_by_name ? ` · ${r.created_by_name}` : ''}
                          {r.note ? ` · ${r.note}` : ''}
                        </div>
                      </div>
                    </div>
                    <span className={`shrink-0 text-sm font-semibold ${isIn ? 'text-emerald-700' : 'text-red-700'}`}>
                      {isIn ? '+' : '−'}
                      {money(r.amount)}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}
