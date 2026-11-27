import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Upload, Download, Pencil, Trash2, Search, Camera } from 'lucide-react'
import CameraScanner from '../components/CameraScanner'
import ProductHistory from '../components/ProductHistory'
import OldProducts from '../components/OldProducts'
import { supabase, errMsg, type Product } from '../lib/supabase'
import { usePermissions } from '../lib/auth'
import { money, qty } from '../lib/format'
import { exportProducts } from '../lib/excel'
import ProductForm from '../components/ProductForm'
import ImportProducts from '../components/ImportProducts'
import { Button, Card, Empty, PageHeader, Select, Spinner, StockBadge, inputCls, useToast } from '../components/ui'

const PAGE = 50

export default function Products() {
  const { isManager, isAdmin } = usePermissions()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [rows, setRows] = useState<Product[]>([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(0)
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  const [filter, setFilter] = useState<'all' | 'low' | 'out' | 'old' | 'removed'>('all')
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Product | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [camera, setCamera] = useState(false)
  const [viewing, setViewing] = useState<Product | null>(null)

  // menu shortcuts: /products?filter=low, ?new=1, ?import=1
  const pFilter = params.get('filter')
  const pNew = params.get('new')
  const pImport = params.get('import')
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFilter(pFilter === 'low' || pFilter === 'out' || ((pFilter === 'old' || pFilter === 'removed') && isManager) ? pFilter : 'all')
    setPage(0)
  }, [pFilter, isManager])
  useEffect(() => {
    if (pNew && isManager) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEditing(null)
      setFormOpen(true)
    }
  }, [pNew, isManager])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (pImport && isManager) setImportOpen(true)
  }, [pImport, isManager])
  const clearParam = (k: string) => {
    if (!params.has(k)) return
    const next = new URLSearchParams(params)
    next.delete(k)
    setParams(next, { replace: true })
  }

  // debounce search box
  useEffect(() => {
    const t = setTimeout(() => {
      setTerm(q.trim())
      setPage(0)
    }, 300)
    return () => clearTimeout(t)
  }, [q])

  const source = isManager ? 'products' : 'product_catalog'

  const load = useCallback(async () => {
    setLoading(true)
    let query = supabase.from(source).select('*', { count: 'exact' })
    if (term) {
      const safe = term.replace(/[%,()]/g, ' ')
      query = query.or(`name.ilike.%${safe}%,item_code.ilike.%${safe}%,category.ilike.%${safe}%`)
    }
    if (source === 'products') query = query.eq('archived', false) // removed products are hidden
    if (filter === 'out') query = query.lte('stock', 0)
    if (filter === 'low') query = query.eq('is_low', true)
    const { data, error, count } = await query.order('name').range(page * PAGE, page * PAGE + PAGE - 1)
    const list = (data ?? []) as Product[]
    if (error) toast(error.message, false)
    setRows(list)
    setCount(count ?? 0)
    setLoading(false)
  }, [source, term, filter, page, toast])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const remove = async (p: Product) => {
    if (!confirm(`Delete “${p.name}”? Past bills keep their copy of the name.`)) return
    const { error } = await supabase.from('products').delete().eq('id', p.id)
    if (error) return toast(errMsg(error), false)
    toast('Product deleted')
    load()
  }

  const exportAll = async () => {
    setExporting(true)
    const all: Product[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('products').select('*').eq('archived', false).order('name').range(from, from + 999)
      if (error) {
        toast(error.message, false)
        break
      }
      all.push(...(data as Product[]))
      if (data.length < 1000) break
    }
    exportProducts(all, `products-${new Date().toISOString().slice(0, 10)}.xlsx`)
    setExporting(false)
  }

  const pages = Math.max(1, Math.ceil(count / PAGE))

  return (
    <div className="space-y-4">
      <PageHeader
        title="Products"
        subtitle={`${count} items`}
        actions={
          isManager && (
            <>
              <Button variant="secondary" onClick={exportAll} loading={exporting}>
                <Download className="h-4 w-4" /> Export
              </Button>
              <Button variant="secondary" onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4" /> Import Excel
              </Button>
              <Button
                onClick={() => {
                  setEditing(null)
                  setFormOpen(true)
                }}
              >
                <Plus className="h-4 w-4" /> Add product
              </Button>
            </>
          )
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, code or category (or scan)" className={`${inputCls} pl-9 pr-11`} />
          <button
            onClick={() => setCamera(true)}
            className="absolute right-1 top-1 rounded-md p-1.5 text-indigo-600 hover:bg-indigo-50"
            title="Find a product by scanning it with the camera"
            aria-label="Scan with camera"
          >
            <Camera className="h-5 w-5" />
          </button>
          <CameraScanner open={camera} continuous={false} title="Scan to find a product" onClose={() => setCamera(false)} onDetect={(code) => setQ(code)} />
        </div>
        <Select
          value={filter}
          onChange={(e) => {
            const v = e.target.value
            const next = new URLSearchParams(params)
            if (v === 'all') next.delete('filter')
            else next.set('filter', v)
            setParams(next, { replace: true })
          }}
          className="sm:w-56"
        >
          <option value="all">All products</option>
          <option value="low">Low stock</option>
          <option value="out">Out of stock</option>
          {isManager && <option value="old">Old names, no stock left</option>}
          {isManager && <option value="removed">Removed products</option>}
        </Select>
      </div>

      {filter === 'old' || filter === 'removed' ? (
        <OldProducts mode={filter} search={term} />
      ) : (
        <>
      <Card className="overflow-hidden">
        {loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <Empty>{term ? 'No products match your search.' : 'No products yet. Add one or import your Excel sheet.'}</Empty>
        ) : (
          <>
            {/* table on larger screens */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Item</th>
                    <th className="px-4 py-2 font-medium">Code</th>
                    <th className="px-4 py-2 font-medium">Category</th>
                    <th className="px-4 py-2 text-right font-medium">MRP</th>
                    <th className="px-4 py-2 text-right font-medium">Sale</th>
                    {isManager && <th className="px-4 py-2 text-right font-medium">Purchase</th>}
                    <th className="px-4 py-2 text-right font-medium">Stock</th>
                    {isManager && <th className="px-4 py-2" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((p) => (
                    <tr key={p.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setViewing(p)} title="View item details">
                      <td className="max-w-xs truncate px-4 py-2 font-medium text-slate-800">{p.name}</td>
                      <td className="px-4 py-2 text-slate-600">{p.item_code || '—'}</td>
                      <td className="max-w-[12rem] truncate px-4 py-2 text-slate-600">{p.category || '—'}</td>
                      <td className="px-4 py-2 text-right text-slate-600">{p.mrp != null ? money(p.mrp) : '—'}</td>
                      <td className="px-4 py-2 text-right">{money(p.sale_price)}</td>
                      {isManager && <td className="px-4 py-2 text-right text-slate-600">{money(p.purchase_price)}</td>}
                      <td className="px-4 py-2 text-right">
                        <StockBadge stock={p.stock} min={p.min_stock} />
                      </td>
                      {isManager && (
                        <td className="whitespace-nowrap px-4 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => {
                              setEditing(p)
                              setFormOpen(true)
                            }}
                            className="rounded p-1 text-slate-500 hover:bg-slate-100"
                            aria-label="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          {isAdmin && (
                            <button onClick={() => remove(p)} className="rounded p-1 text-slate-500 hover:bg-red-50 hover:text-red-600" aria-label="Delete">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* cards on phones */}
            <ul className="divide-y divide-slate-100 md:hidden">
              {rows.map((p) => (
                <li
                  key={p.id}
                  className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 active:bg-slate-50"
                  onClick={() => setViewing(p)}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{p.name}</div>
                    <div className="text-xs text-slate-500">
                      {p.item_code || 'no code'} · {money(p.sale_price)}
                      {isManager && ` · cost ${money(p.purchase_price)}`}
                    </div>
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    <StockBadge stock={p.stock} min={p.min_stock} />
                    <div>min {qty(p.min_stock)}</div>
                  </div>
                </li>
              ))}
            </ul>
          </>
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
        </>
      )}

      <ProductHistory
        product={viewing}
        onClose={() => setViewing(null)}
        onEdit={() => {
          setEditing(viewing)
          setViewing(null)
          setFormOpen(true)
        }}
      />
      <ProductForm
        open={formOpen}
        editing={editing}
        onClose={() => {
          setFormOpen(false)
          clearParam('new')
        }}
        onSaved={() => {
          setFormOpen(false)
          clearParam('new')
          load()
        }}
      />
      <ImportProducts
        open={importOpen}
        onClose={() => {
          setImportOpen(false)
          clearParam('import')
        }}
        onDone={load}
      />
    </div>
  )
}
