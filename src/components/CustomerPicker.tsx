import { useEffect, useState } from 'react'
import { UserPlus, X } from 'lucide-react'
import { supabase, errMsg, type Customer, type PartyKind } from '../lib/supabase'
import { Button, Field, Input, Modal, inputCls, useToast } from './ui'

const TABLE: Record<PartyKind, 'customers' | 'suppliers'> = { customer: 'customers', supplier: 'suppliers' }
const LABEL: Record<PartyKind, string> = { customer: 'customer', supplier: 'supplier' }

interface Props {
  kind?: PartyKind
  value: Customer | null
  onChange: (c: Customer | null) => void
  placeholder?: string
}

/** Search-and-pick a customer or supplier, with a quick "add new" button. */
export function PartyPicker({ kind = 'customer', value, onChange, placeholder }: Props) {
  const [q, setQ] = useState('')
  const [list, setList] = useState<Customer[]>([])
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setList([])
      return
    }
    const t = setTimeout(async () => {
      const safe = term.replace(/[%,()]/g, ' ')
      const { data } = await supabase
        .from(TABLE[kind])
        .select('*')
        .or(`name.ilike.%${safe}%,contact.ilike.%${safe}%`)
        .order('name')
        .limit(8)
      setList((data ?? []) as Customer[])
    }, 250)
    return () => clearTimeout(t)
  }, [q, kind])

  if (value)
    return (
      <div className="flex items-center justify-between rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
        <span>
          <span className="font-medium">{value.name}</span>
          {value.contact && <span className="text-slate-500"> · {value.contact}</span>}
        </span>
        <button onClick={() => onChange(null)} className="text-slate-400 hover:text-slate-700" aria-label={`Remove ${LABEL[kind]}`}>
          <X className="h-4 w-4" />
        </button>
      </div>
    )

  return (
    <div className="relative">
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder ?? `${LABEL[kind]} name or phone`} className={inputCls} />
        <Button variant="secondary" onClick={() => setAdding(true)} title={`Add new ${LABEL[kind]}`} className="px-3">
          <UserPlus className="h-4 w-4" />
        </Button>
      </div>
      {list.length > 0 && (
        <ul className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          {list.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => {
                  onChange(c)
                  setQ('')
                  setList([])
                }}
                className="w-full px-3 py-2 text-left text-sm hover:bg-indigo-50"
              >
                {c.name} <span className="text-slate-500">{c.contact}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.trim().length >= 2 && list.length === 0 && (
        <button className="mt-1 text-xs font-medium text-indigo-600" onClick={() => setAdding(true)}>
          + Add “{q.trim()}” as new {LABEL[kind]}
        </button>
      )}
      <PartyForm
        kind={kind}
        open={adding}
        initialName={q}
        onClose={() => setAdding(false)}
        onSaved={(c) => {
          onChange(c)
          setQ('')
          setAdding(false)
        }}
      />
    </div>
  )
}

export function PartyForm({
  kind = 'customer',
  open,
  onClose,
  onSaved,
  editing,
  initialName = '',
}: {
  kind?: PartyKind
  open: boolean
  onClose: () => void
  onSaved: (c: Customer) => void
  editing?: Customer | null
  initialName?: string
}) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      const isPhone = /^\d+$/.test(initialName.trim())
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setName(editing?.name ?? (isPhone ? '' : initialName.trim()))
      setContact(editing?.contact ?? (isPhone ? initialName.trim() : ''))
    }
  }, [open, editing, initialName])

  const save = async () => {
    if (!name.trim()) return toast(`Enter the ${LABEL[kind]} name`, false)
    setBusy(true)
    const row = { name: name.trim(), contact: contact.trim() || null }
    const res = editing
      ? await supabase.from(TABLE[kind]).update(row).eq('id', editing.id).select().single()
      : await supabase.from(TABLE[kind]).insert(row).select().single()
    setBusy(false)
    if (res.error) return toast(errMsg(res.error), false)
    toast(editing ? 'Saved' : `${kind === 'customer' ? 'Customer' : 'Supplier'} added`)
    onSaved(res.data as Customer)
  }

  const title = `${editing ? 'Edit' : 'Add'} ${LABEL[kind]}`
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <Field label="Name">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Contact number">
          <Input type="tel" inputMode="tel" value={contact} onChange={(e) => setContact(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={save}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/* Kept for the existing imports. */
export default function CustomerPicker(props: Omit<Props, 'kind'>) {
  return <PartyPicker kind="customer" placeholder="Customer name or phone (optional)" {...props} />
}
export const CustomerForm = (props: Omit<Parameters<typeof PartyForm>[0], 'kind'>) => <PartyForm kind="customer" {...props} />
