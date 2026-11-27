import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, type CatalogItem } from './supabase'

const PAGE = 1000
const COST_COLS =
  'id,name,item_code,category,mrp,sale_price,purchase_price,discount_type,sale_discount,stock,min_stock,tax_rate,base_unit,updated_at,archived'
/** salesmen without purchase price; after this long the list is fully reloaded when the page opens again */
const SALESMAN_FULL_RELOAD_MS = 15 * 60 * 1000

type Extra = { barcode_number: string; product_id: number }
type Row = CatalogItem & { updated_at?: string; archived?: boolean }

/** One copy per browser tab, shared by New Sale and New Purchase, so the list isn't downloaded every time. */
interface Cache {
  items: Row[]
  extra: Extra[]
  loadedAt: number
  /** newest updated_at seen (server time) — managers fetch only rows changed after it */
  syncedAt: string
}
const caches: { cost?: Cache; plain?: Cache } = {}

const newest = (rows: Row[], prev = '') => rows.reduce((m, r) => (r.updated_at && r.updated_at > m ? r.updated_at : m), prev)

/** put changed rows into the list (and drop removed ones) */
function merge(items: Row[], changed: Row[], gone: Set<number> = new Set()) {
  const byId = new Map(items.map((r) => [r.id, r]))
  for (const r of changed) {
    if (r.archived) byId.delete(r.id)
    else byId.set(r.id, r)
  }
  for (const id of gone) byId.delete(id)
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Keeps the product list in memory so barcode scans resolve instantly.
 * Managers read the products table (with purchase price); salesmen read the
 * product_catalog view, which hides purchase price.
 *
 * To save data on the free Supabase plan, the full list (~600 KB for 2,300 products) is only
 * downloaded once per tab; after that only changed products are fetched:
 *  - refresh(ids) after a bill / purchase → just those products
 *  - opening the page again → managers: rows changed since the last sync; salesmen: full reload after 15 min
 */
export function useCatalog(withCost: boolean) {
  const key = withCost ? 'cost' : 'plain'
  const source = withCost ? 'products' : 'product_catalog'
  const cached = caches[key]
  const [items, setItems] = useState<Row[]>(cached?.items ?? [])
  const [extraCodes, setExtraCodes] = useState<Extra[]>(cached?.extra ?? [])
  const [loading, setLoading] = useState(!cached)
  const [error, setError] = useState<string | null>(null)

  const save = useCallback(
    (next: Partial<Cache>) => {
      const c = { items: [], extra: [], loadedAt: Date.now(), syncedAt: '', ...caches[key], ...next } as Cache
      caches[key] = c
      setItems(c.items)
      setExtraCodes(c.extra)
    },
    [key],
  )

  /** full download of the product list */
  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    const all: Row[] = []
    for (let from = 0; ; from += PAGE) {
      let q = supabase.from(source).select(withCost ? COST_COLS : '*')
      if (withCost) q = q.eq('archived', false) // removed products can't be billed (the salesman view already hides them)
      const { data, error } = await q.order('name').range(from, from + PAGE - 1)
      if (error) {
        setError(error.message)
        setLoading(false)
        return
      }
      all.push(...((data ?? []) as unknown as Row[]))
      if (!data || data.length < PAGE) break
    }
    // extra barcodes (old labels like 121 for product 000121)
    const extra = await supabase.from('product_barcodes').select('barcode_number,product_id').limit(5000)
    save({ items: all, extra: extra.error ? [] : ((extra.data ?? []) as Extra[]), loadedAt: Date.now(), syncedAt: newest(all) })
    setLoading(false)
  }, [source, withCost, save])

  /** fetch only these products again (e.g. the items of a bill that was just saved) */
  const refresh = useCallback(
    async (ids: number[]) => {
      const uniq = [...new Set(ids)].filter(Boolean)
      if (!uniq.length) return
      const { data, error } = await supabase
        .from(source)
        .select(withCost ? COST_COLS : '*')
        .in('id', uniq)
      if (error) return setError(error.message)
      const rows = (data ?? []) as unknown as Row[]
      const found = new Set(rows.map((r) => r.id))
      const gone = new Set(uniq.filter((id) => !found.has(id))) // deleted, or removed (hidden from salesmen)
      const c = caches[key]
      // new products may also have new extra barcodes
      const extra = await supabase.from('product_barcodes').select('barcode_number,product_id').in('product_id', uniq)
      const keepExtra = (c?.extra ?? []).filter((x) => !uniq.includes(x.product_id))
      save({
        items: merge(c?.items ?? [], rows, gone),
        extra: extra.error ? (c?.extra ?? []) : [...keepExtra, ...((extra.data ?? []) as Extra[])],
        syncedAt: newest(rows, c?.syncedAt ?? ''),
      })
    },
    [source, withCost, key, save],
  )

  /** managers: fetch products changed since the last sync (other devices, imports, edits) */
  const sync = useCallback(async () => {
    const c = caches[key]
    if (!c) return reload()
    if (!withCost) {
      if (Date.now() - c.loadedAt > SALESMAN_FULL_RELOAD_MS) return reload()
      return
    }
    if (!c.syncedAt) return reload()
    const changed: Row[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from('products').select(COST_COLS).gt('updated_at', c.syncedAt).order('updated_at').range(from, from + PAGE - 1)
      if (error) return setError(error.message)
      changed.push(...((data ?? []) as unknown as Row[]))
      if (!data || data.length < PAGE) break
    }
    if (changed.length) save({ items: merge(c.items, changed), syncedAt: newest(changed, c.syncedAt) })
  }, [key, withCost, reload, save])

  useEffect(() => {
    // first visit: full download; coming back: only what changed
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (caches[key]) sync()
    else reload()
  }, [key, reload, sync])

  const byCode = useMemo(() => {
    const m = new Map<string, CatalogItem>()
    for (const it of items) if (it.item_code) m.set(it.item_code.trim().toLowerCase(), it)
    const byId = new Map(items.map((it) => [it.id, it]))
    for (const x of extraCodes) {
      const it = byId.get(x.product_id)
      const k = x.barcode_number.trim().toLowerCase()
      if (it && !m.has(k)) m.set(k, it)
    }
    return m
  }, [items, extraCodes])

  const byName = useMemo(() => {
    const m = new Map<string, CatalogItem>()
    for (const it of items) m.set(it.name.trim().toLowerCase(), it)
    return m
  }, [items])

  /** Exact match on barcode / item code, then exact name. */
  const lookup = useCallback(
    (text: string) => {
      const k = text.trim().toLowerCase()
      if (!k) return undefined
      return byCode.get(k) ?? byName.get(k)
    },
    [byCode, byName],
  )

  const search = useCallback(
    (text: string, limit = 8) => {
      const k = text.trim().toLowerCase()
      if (!k) return []
      const words = k.split(/\s+/)
      const out: CatalogItem[] = []
      for (const it of items) {
        const hay = `${it.name} ${it.item_code ?? ''}`.toLowerCase()
        if (words.every((w) => hay.includes(w))) {
          out.push(it)
          if (out.length >= limit) break
        }
      }
      return out
    },
    [items],
  )

  return { items: items as CatalogItem[], loading, error, reload, refresh, lookup, search }
}
