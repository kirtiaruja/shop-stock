import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, type CatalogItem } from './supabase'

const PAGE = 1000

/**
 * Loads the full product list into memory so barcode scans resolve instantly.
 * Managers read the products table (with purchase price); salesmen read the
 * product_catalog view, which hides purchase price.
 */
export function useCatalog(withCost: boolean) {
  const [items, setItems] = useState<CatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [extraCodes, setExtraCodes] = useState<{ barcode_number: string; product_id: number }[]>([])

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    const source = withCost ? 'products' : 'product_catalog'
    const cols = withCost
      ? 'id,name,item_code,category,mrp,sale_price,purchase_price,discount_type,sale_discount,stock,min_stock,tax_rate,base_unit'
      : '*'
    const all: CatalogItem[] = []
    for (let from = 0; ; from += PAGE) {
      let q = supabase.from(source).select(cols)
      if (withCost) q = q.eq('archived', false) // removed products can't be billed (the salesman view already hides them)
      const { data, error } = await q.order('name').range(from, from + PAGE - 1)
      if (error) {
        setError(error.message)
        break
      }
      all.push(...((data ?? []) as unknown as CatalogItem[]))
      if (!data || data.length < PAGE) break
    }
    // extra barcodes (old labels like 121 for product 000121)
    const extra = await supabase.from('product_barcodes').select('barcode_number,product_id').limit(5000)
    setExtraCodes(extra.error ? [] : ((extra.data ?? []) as { barcode_number: string; product_id: number }[]))
    setItems(all)
    setLoading(false)
  }, [withCost])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload()
  }, [reload])

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

  return { items, loading, error, reload, lookup, search }
}
