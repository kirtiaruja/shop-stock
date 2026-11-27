import { useCallback, useEffect, useMemo, useState } from 'react'
import { Archive, RotateCcw } from 'lucide-react'
import { supabase, errMsg } from '../lib/supabase'
import { usePermissions } from '../lib/auth'
import { money, qty, dateTime } from '../lib/format'
import { Badge, Button, Card, Empty, Spinner, useToast } from './ui'

interface Row {
  id: number
  name: string
  item_code: string | null
  stock: number
  sale_price: number
  last_sold?: string | null
  archived_at?: string | null
}

/**
 * mode "old":     old-style names (brand names / not the simple format) with no stock left → remove (hide)
 * mode "removed": products removed earlier → restore
 */
export default function OldProducts({ mode, search }: { mode: 'old' | 'removed'; search: string }) {
  const { isAdmin } = usePermissions()
  const toast = useToast()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setRows(null)
    let data: Row[] = []
    if (mode === 'old') {
      const r = await supabase.rpc('old_style_products')
      if (r.error) toast(errMsg(r.error), false)
      data = (r.data ?? []) as Row[]
    } else {
      for (let from = 0; ; from += 1000) {
        const r = await supabase.from('products').select('id,name,item_code,stock,sale_price,archived_at').eq('archived', true).order('name').range(from, from + 999)
        if (r.error) {
          toast(errMsg(r.error), false)
          break
        }
        data.push(...((r.data ?? []) as Row[]))
        if (!r.data || r.data.length < 1000) break
      }
    }
    setRows(data)
    setPicked(new Set(data.map((d) => d.id)))
  }, [mode, toast])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const shown = useMemo(() => {
    const t = search.trim().toLowerCase()
    return (rows ?? []).filter((r) => !t || r.name.toLowerCase().includes(t) || (r.item_code ?? '').toLowerCase().includes(t))
  }, [rows, search])
  const chosen = shown.filter((r) => picked.has(r.id))

  const toggle = (id: number) =>
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const allOn = shown.length > 0 && chosen.length === shown.length

  const act = async () => {
    if (!chosen.length) return
    const verb = mode === 'old' ? 'Remove' : 'Restore'
    if (
      mode === 'old' &&
      !confirm(`Remove ${chosen.length} products? They disappear from product lists and billing. Their sales history stays, and you can restore them any time.`)
    )
      return
    setBusy(true)
    const { data, error } = await supabase.rpc(mode === 'old' ? 'archive_products' : 'restore_products', { p_ids: chosen.map((r) => r.id) })
    setBusy(false)
    if (error) return toast(errMsg(error), false)
    toast(`${verb}d ${data} products`)
    load()
  }

  if (rows === null) return <Spinner />

  return (
    <div className="space-y-3">
      <Card className="p-4 text-sm text-slate-600">
        {mode === 'old' ? (
          <>
            Products whose name is <b>not in the simple format</b> (brand names on clothing, or names the barcode wizard can't read) and that have{' '}
            <b>no stock left</b>. Clothing in the simple format (e.g. <code>JEANS 32 A300</code>) and innerwear with its brand (e.g. <code>LEHAR LONG 90</code>) are
            never listed. Removing only hides a product — its history stays, and it comes back by itself if you purchase it again.
          </>
        ) : (
          <>Products removed earlier. Restore them to show them in product lists and billing again.</>
        )}
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={allOn} onChange={() => setPicked(allOn ? new Set() : new Set([...picked, ...shown.map((r) => r.id)]))} />
          {shown.length} products · {chosen.length} selected
        </label>
        {isAdmin ? (
          <Button variant={mode === 'old' ? 'danger' : 'primary'} onClick={act} loading={busy} disabled={!chosen.length}>
            {mode === 'old' ? <Archive className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
            {mode === 'old' ? 'Remove' : 'Restore'} {chosen.length} selected
          </Button>
        ) : (
          <span className="text-xs text-slate-500">Only Admin can {mode === 'old' ? 'remove' : 'restore'} products.</span>
        )}
      </div>

      <Card className="overflow-hidden">
        {shown.length === 0 ? (
          <Empty>{mode === 'old' ? 'Nothing to remove — no old-style products with zero stock.' : 'No removed products.'}</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {shown.map((r) => (
              <li key={r.id}>
                <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                  <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-800">{r.name}</div>
                    <div className="text-xs text-slate-500">
                      {r.item_code || 'no code'} · {money(r.sale_price)}
                      {mode === 'old' && ` · last sold ${r.last_sold ? dateTime(r.last_sold) : 'never'}`}
                      {mode === 'removed' && r.archived_at && ` · removed ${dateTime(r.archived_at)}`}
                    </div>
                  </div>
                  <Badge tone={Number(r.stock) < 0 ? 'red' : 'slate'}>stock {qty(r.stock)}</Badge>
                </label>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {mode === 'old' && shown.some((r) => Number(r.stock) < 0) && (
        <p className="text-xs text-slate-500">
          Red = stock below zero. That usually means sales were billed without the purchase being entered — check the shelf before removing those.
        </p>
      )}
    </div>
  )
}
