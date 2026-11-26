import { useCallback, useEffect, useState } from 'react'
import { Plus, Search, Pencil, Trash2, Phone, Wallet } from 'lucide-react'
import { supabase, errMsg, type Balance, type Customer, type PartyKind } from '../lib/supabase'
import { usePermissions } from '../lib/auth'
import { money } from '../lib/format'
import { PartyForm } from '../components/CustomerPicker'
import PaymentModal from '../components/PaymentModal'
import { Badge, Button, Card, Empty, PageHeader, Spinner, inputCls, useToast } from '../components/ui'

const PAGE = 50

/** List of customers or suppliers with their outstanding balance. */
export function Parties({ kind }: { kind: PartyKind }) {
  const { isAdmin } = usePermissions()
  const toast = useToast()
  const table = kind === 'customer' ? 'customers' : 'suppliers'
  const label = kind === 'customer' ? 'Customer' : 'Supplier'
  const [rows, setRows] = useState<Customer[]>([])
  const [dues, setDues] = useState<Map<number, number>>(new Map())
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(0)
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [open, setOpen] = useState(false)
  const [paying, setPaying] = useState<Customer | null>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      setTerm(q.trim())
      setPage(0)
    }, 300)
    return () => clearTimeout(t)
  }, [q])

  const load = useCallback(async () => {
    setLoading(true)
    let query = supabase.from(table).select('*', { count: 'exact' })
    if (term) {
      const safe = term.replace(/[%,()]/g, ' ')
      query = query.or(`name.ilike.%${safe}%,contact.ilike.%${safe}%`)
    }
    const [{ data, error, count }, bal] = await Promise.all([
      query.order('name').range(page * PAGE, page * PAGE + PAGE - 1),
      supabase.rpc('party_balances', { p_kind: kind === 'customer' ? 'sale' : 'purchase' }),
    ])
    if (error) toast(error.message, false)
    setRows((data ?? []) as Customer[])
    setDues(new Map(((bal.data ?? []) as Balance[]).map((b) => [b.party_id, Number(b.due)])))
    setCount(count ?? 0)
    setLoading(false)
  }, [table, kind, term, page, toast])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const remove = async (c: Customer) => {
    if (!confirm(`Delete ${label.toLowerCase()} “${c.name}”? Their old bills stay.`)) return
    const { error } = await supabase.from(table).delete().eq('id', c.id)
    if (error) return toast(errMsg(error), false)
    toast(`${label} deleted`)
    load()
  }

  const pages = Math.max(1, Math.ceil(count / PAGE))
  const totalDue = [...dues.values()].reduce((a, b) => a + b, 0)

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${label}s`}
        subtitle={`${count} ${label.toLowerCase()}s${totalDue > 0 ? ` · ${money(totalDue)} ${kind === 'customer' ? 'to receive' : 'to pay'}` : ''}`}
        actions={
          <Button
            onClick={() => {
              setEditing(null)
              setOpen(true)
            }}
          >
            <Plus className="h-4 w-4" /> Add {label.toLowerCase()}
          </Button>
        }
      />
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or phone" className={`${inputCls} pl-9`} />
      </div>
      <Card className="overflow-hidden">
        {loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <Empty>{term ? 'No match.' : `No ${label.toLowerCase()}s yet.`}</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((c) => {
              const due = dues.get(c.id) ?? 0
              return (
                <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-800">{c.name}</div>
                    {c.contact && (
                      <a href={`tel:${c.contact}`} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-600">
                        <Phone className="h-3 w-3" /> {c.contact}
                      </a>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {due > 0 && (
                      <button
                        onClick={() => setPaying(c)}
                        className="mr-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-200"
                        title={kind === 'customer' ? 'Receive payment' : 'Pay supplier'}
                      >
                        <Wallet className="h-3.5 w-3.5" /> {money(due)}
                      </button>
                    )}
                    {due === 0 && <Badge>No dues</Badge>}
                    <button
                      onClick={() => {
                        setEditing(c)
                        setOpen(true)
                      }}
                      className="rounded p-2 text-slate-500 hover:bg-slate-100"
                      aria-label="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    {isAdmin && (
                      <button onClick={() => remove(c)} className="rounded p-2 text-slate-500 hover:bg-red-50 hover:text-red-600" aria-label="Delete">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <Button variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="text-slate-600">
            Page {page + 1} of {pages}
          </span>
          <Button variant="secondary" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
      <PartyForm
        kind={kind}
        open={open}
        editing={editing}
        onClose={() => setOpen(false)}
        onSaved={() => {
          setOpen(false)
          load()
        }}
      />
      <PaymentModal
        open={!!paying}
        kind={kind === 'customer' ? 'sale' : 'purchase'}
        party={paying ? { id: paying.id, name: paying.name } : null}
        onClose={() => setPaying(null)}
        onDone={() => {
          setPaying(null)
          load()
        }}
      />
    </div>
  )
}

export default function Customers() {
  return <Parties kind="customer" />
}
