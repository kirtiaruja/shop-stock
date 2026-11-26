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

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    const source = withCost ? 'products' : 'product_catalog'
    const cols = withCost
      ? 'id,name,item_code,category,mrp,sale_price,purchase_price,discount_type,sale_discount,stock,min_stock,tax_rate,base_unit'
      : '*'
    const all: CatalogItem[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from(source).select(cols).order('name').range(from, from + PAGE - 1)
      if (error) {
        setError(error.message)
        break
      }
      all.push(...((data ?? []) as unknown as CatalogItem[]))
      if (!data || data.length < PAGE) break
    }
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
    return m
  }, [items])

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
