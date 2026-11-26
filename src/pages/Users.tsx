import { useCallback, useEffect, useState } from 'react'
import { supabase, errMsg, type Profile, type Role } from '../lib/supabase'
import { roleLabel, useAuth } from '../lib/auth'
import { dateTime } from '../lib/format'
import { Badge, Card, PageHeader, Spinner, useToast } from '../components/ui'

const ROLE_HELP: Record<Role, string> = {
  admin: 'Everything, including users and deleting bills',
  co_admin: 'Sales, purchases, products, Excel import, all reports',
  salesman: 'Make sales, add customers, view products (no purchase prices)',
}

export default function Users() {
  const { profile: me } = useAuth()
  const toast = useToast()
  const [rows, setRows] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('profiles').select('*').order('created_at')
    if (error) toast(error.message, false)
    setRows((data ?? []) as Profile[])
    setLoading(false)
  }, [toast])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const update = async (p: Profile, patch: Partial<Profile>) => {
    const { error } = await supabase.from('profiles').update(patch).eq('id', p.id)
    if (error) return toast(errMsg(error), false)
    toast('User updated')
    load()
  }

  if (loading) return <Spinner />

  const pending = rows.filter((r) => !r.active).length

  return (
    <div className="space-y-4">
      <PageHeader title="Users" subtitle={pending ? `${pending} waiting for approval` : 'Staff accounts and their access'} />

      <Card className="p-4 text-sm text-slate-600">
        New staff sign up from the login page with “Create account”. They appear here as <b>inactive</b> — switch them on and pick their role.
        <ul className="mt-2 space-y-1">
          {(Object.keys(ROLE_HELP) as Role[]).map((r) => (
            <li key={r}>
              <b>{roleLabel[r]}:</b> {ROLE_HELP[r]}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="overflow-hidden">
        <ul className="divide-y divide-slate-100">
          {rows.map((u) => {
            const self = u.id === me?.id
            return (
              <li key={u.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {u.full_name || '—'} {self && <Badge tone="indigo">You</Badge>}
                    {!u.active && <Badge tone="amber">Inactive</Badge>}
                  </div>
                  <div className="truncate text-xs text-slate-500">
                    {u.email} · joined {dateTime(u.created_at)}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <select
                    value={u.role}
                    disabled={self}
                    onChange={(e) => update(u, { role: e.target.value as Role })}
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50"
                  >
                    {(Object.keys(roleLabel) as Role[]).map((r) => (
                      <option key={r} value={r}>
                        {roleLabel[r]}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={u.active} disabled={self} onChange={(e) => update(u, { active: e.target.checked })} />
                    Active
                  </label>
                </div>
              </li>
            )
          })}
        </ul>
      </Card>
    </div>
  )
}
