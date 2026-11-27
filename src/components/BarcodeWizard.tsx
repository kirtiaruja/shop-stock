/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, Plus, NotebookPen } from 'lucide-react'
import { supabase, errMsg } from '../lib/supabase'
import { money } from '../lib/format'
import { CODE_RE, actualFromMrp, costFromFormula, loadCostFormula, priceCode, saveCostFormula } from '../lib/pricing'
import { Button, Field, Input, Modal, Spinner, useToast } from './ui'

const DEFAULT_SIZES = ['S', 'M', 'L', 'XL', 'XXL']
const DEFAULT_INNER_SIZES = ['75CM', '80CM', '85CM', '90CM', '95CM', '100CM', '105CM', '110CM']

type Step = 'category' | 'style' | 'sleeve' | 'brand' | 'istyle' | 'size' | 'price' | 'details'
const STEP_LABEL: Record<Step, string> = {
  category: 'Category',
  style: 'Style',
  sleeve: 'Sleeve',
  brand: 'Brand',
  istyle: 'Style',
  size: 'Size',
  price: 'Price',
  details: 'Details',
}

interface Sleeve {
  sleeve: string | null
  label_prefix: string
}
interface StyleRow {
  style: string
  sleeves: Sleeve[]
}

/** What the wizard hands back to the purchase for each finished item. */
export interface WizardResult {
  barcode_number: string
  item_name: string
  created: boolean
  mrp: number
  code: string
  product: { id: number; name: string; item_code: string | null; sale_price: number; purchase_price: number; stock: number }
}
export interface WizardItem {
  result: WizardResult
  qty: number
  cost: number
  desc: string
}

/** Calls wizard_barcode — shared with the handwritten-note reader. */
export async function makeBarcode(p: { prefix: string; size: string; code: string; mrp: number; sale_price?: number | null; purchase_price?: number | null }) {
  const { data, error } = await supabase.rpc('wizard_barcode', { p })
  if (error) throw new Error(errMsg(error))
  return data as WizardResult
}

interface Ask {
  title: string
  fields: { key: string; label: string; placeholder?: string }[]
  onOk: (v: Record<string, string>) => void | Promise<void>
}

export default function BarcodeWizard({
  open,
  onClose,
  onAdd,
  onOpenNote,
}: {
  open: boolean
  onClose: () => void
  onAdd: (item: WizardItem) => void
  onOpenNote: () => void
}) {
  const toast = useToast()
  const [mode, setMode] = useState<'generic' | 'innerwear' | null>(null)
  const [step, setStep] = useState<Step>('category')
  const [categories, setCategories] = useState<{ category: string; n: number }[] | null>(null)
  const [styles, setStyles] = useState<StyleRow[]>([])
  const [sleeves, setSleeves] = useState<Sleeve[]>([])
  const [sizes, setSizes] = useState<string[]>([])
  const [brands, setBrands] = useState<{ brand: string; n: number }[]>([])
  const [istyles, setIstyles] = useState<{ style: string; n: number }[]>([])
  const [sel, setSel] = useState({ category: '', style: '', sleeve: '' as string | null, prefix: '', brand: '', istyle: '', size: '' })
  const [price, setPrice] = useState('')
  const [actual, setActual] = useState('')
  const [code, setCode] = useState('')
  const [actualEdited, setActualEdited] = useState(false)
  const [codeEdited, setCodeEdited] = useState(false)
  const [qty, setQty] = useState('1')
  const [desc, setDesc] = useState('')
  const [formula, setFormula] = useState(loadCostFormula)
  const [cost, setCost] = useState('')
  const [costEdited, setCostEdited] = useState(false)
  const [brandSearch, setBrandSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ask, setAsk] = useState<Ask | null>(null)
  const [askVals, setAskVals] = useState<Record<string, string>>({})
  const priceRef = useRef<HTMLInputElement>(null)

  const steps: Step[] =
    mode === 'innerwear'
      ? ['category', 'brand', 'istyle', 'size', 'price', 'details']
      : (['category', 'style'] as Step[]).concat(sleeves.length > 1 ? ['sleeve'] : [], ['size', 'price', 'details'])

  const call = useCallback(async <T,>(fn: string, args?: Record<string, unknown>): Promise<T> => {
    setError('')
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc(fn, args)
      if (error) throw new Error(errMsg(error))
      return data as T
    } catch (e) {
      setError(errMsg(e))
      throw e
    } finally {
      setBusy(false)
    }
  }, [])

  const loadCategories = useCallback(async () => setCategories(await call('wizard_categories')), [call])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open && categories === null) loadCategories().catch(() => {})
  }, [open, categories, loadCategories])

  useEffect(() => saveCostFormula(formula), [formula])

  const go = (s: Step) => {
    setStep(s)
    setError('')
    setAsk(null)
  }
  const back = () => {
    const i = steps.indexOf(step)
    if (i > 0) go(steps[i - 1])
  }
  const reset = () => {
    setMode(null)
    setSleeves([])
    setPrice('')
    setActual('')
    setCode('')
    setDesc('')
    setActualEdited(false)
    setCodeEdited(false)
    setCost('')
    setCostEdited(false)
    setQty('1')
    setBrandSearch('')
    setSel({ category: '', style: '', sleeve: '', prefix: '', brand: '', istyle: '', size: '' })
    go('category')
  }

  // ---------- clothing (generic) ----------
  const pickCategory = async (c: string) => {
    setSel((s) => ({ ...s, category: c }))
    if (c === 'Innerwear') {
      setMode('innerwear')
      setBrands(await call('wizard_brands'))
      go('brand')
    } else {
      setMode('generic')
      setSleeves([])
      setStyles(await call('wizard_styles', { p_category: c }))
      go('style')
    }
  }
  const pickSleeve = async (v: Sleeve) => {
    setSel((s) => ({ ...s, sleeve: v.sleeve, prefix: v.label_prefix }))
    const got = await call<string[]>('wizard_sizes', { p_prefix: v.label_prefix })
    setSizes(got?.length ? got : DEFAULT_SIZES)
    go('size')
  }
  const pickStyle = async (s: StyleRow) => {
    setSel((x) => ({ ...x, style: s.style }))
    setSleeves(s.sleeves)
    if (s.sleeves.length === 1) return pickSleeve(s.sleeves[0])
    go('sleeve')
  }
  const addItem = async (category: string, style: string, sleeve: string) => {
    const r = await call<{ category: string; style: string; sleeve: string | null; label_prefix: string }>('wizard_add_item', {
      p: { category, style, sleeve },
    })
    await loadCategories()
    setSel((s) => ({ ...s, category: r.category }))
    setMode('generic')
    const list = await call<StyleRow[]>('wizard_styles', { p_category: r.category })
    setStyles(list)
    const s = list.find((x) => x.style === r.style)
    const sl = s?.sleeves.find((x) => x.label_prefix === r.label_prefix)
    if (s && sl) {
      setSel((x) => ({ ...x, style: s.style }))
      setSleeves(s.sleeves)
      await pickSleeve(sl)
    }
  }

  // ---------- innerwear ----------
  const pickBrand = async (b: string) => {
    setSel((s) => ({ ...s, brand: b }))
    setIstyles(await call('wizard_brand_styles', { p_brand: b }))
    go('istyle')
  }
  const pickIStyle = async (st: string) => {
    setSel((s) => ({ ...s, istyle: st, prefix: `${s.brand} ${st}`.trim() }))
    const got = await call<string[]>('wizard_brand_sizes', { p_brand: sel.brand, p_style: st })
    setSizes(got?.length ? got : DEFAULT_INNER_SIZES)
    go('size')
  }

  // ---------- size / price / details ----------
  const pickSize = (sz: string) => {
    setSel((s) => ({ ...s, size: sz }))
    go('price')
    setTimeout(() => priceRef.current?.focus(), 50)
  }
  const onMrp = (v: string) => {
    setPrice(v)
    const a = actualEdited ? actual : actualFromMrp(v)
    if (!actualEdited) setActual(a)
    if (!codeEdited) setCode(priceCode(a))
  }
  const onActual = (v: string) => {
    setActual(v)
    setActualEdited(true)
    if (!codeEdited) setCode(priceCode(v))
  }
  const onCode = (v: string) => {
    const c = v.toUpperCase().replace(/\s+/g, '')
    setCodeEdited(c !== '')
    setCode(c || priceCode(actual))
  }
  const priceNext = () => {
    if (!(parseFloat(price) > 0)) return setError('Enter the MRP')
    if (!CODE_RE.test(code)) return setError('Code must look like D50, A200 or Z60')
    if (Number(actual) > parseFloat(price)) return setError(`Selling price ₹${actual} is more than the MRP ₹${price}. Check the MRP decimals.`)
    go('details')
  }
  const sale = Number(actual) || 0
  const formulaCost = costFromFormula(formula, sale)
  const costValue = costEdited ? cost : formulaCost != null ? String(formulaCost) : ''

  const save = async (again: boolean) => {
    const q = Math.max(1, Math.floor(Number(qty) || 1))
    const c = costValue === '' ? null : Number(costValue)
    try {
      setBusy(true)
      setError('')
      const r = await makeBarcode({ prefix: sel.prefix, size: sel.size, code, mrp: parseFloat(price), sale_price: sale || null, purchase_price: c })
      onAdd({ result: r, qty: q, cost: c ?? (Number(r.product.purchase_price) || 0), desc: desc.trim() })
      toast(`${r.created ? 'New barcode' : 'Existing barcode'} ${r.barcode_number} · ${r.item_name} × ${q}`)
      setQty('1')
      setCostEdited(false)
      if (again) go('size')
      else reset()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const openAsk = (a: Ask) => {
    setAskVals({})
    setAsk(a)
  }

  const tile = 'rounded-xl border border-slate-200 bg-white px-3 py-3 text-left text-sm font-medium text-slate-800 hover:border-indigo-400 hover:bg-indigo-50 disabled:opacity-50'
  const addTile = 'flex items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 px-3 py-3 text-sm font-medium text-slate-500 hover:border-indigo-400 hover:text-indigo-600'
  const filteredBrands = brandSearch.trim() ? brands.filter((b) => b.brand.includes(brandSearch.trim().toUpperCase())) : brands

  return (
    <Modal open={open} onClose={onClose} title="Generate barcodes" wide>
      <div className="space-y-4">
        {/* stepper */}
        <div className="flex items-center gap-2">
          {step !== 'category' && (
            <button onClick={back} className="flex shrink-0 items-center rounded-lg px-2 py-1 text-sm text-slate-600 hover:bg-slate-100" aria-label="Back">
              <ChevronLeft className="h-4 w-4" /> Back
            </button>
          )}
          <div className="flex flex-1 gap-1 overflow-x-auto">
            {steps.map((s, i) => {
              const done = steps.indexOf(step) > i
              return (
                <span
                  key={s}
                  className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${
                    s === step ? 'bg-indigo-600 text-white' : done ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {i + 1}. {STEP_LABEL[s]}
                </span>
              )
            })}
          </div>
          <Button variant="secondary" className="shrink-0 px-3 py-1.5 text-xs" onClick={onOpenNote} title="Read a handwritten note">
            <NotebookPen className="h-4 w-4" /> <span className="hidden sm:inline">Note</span>
          </Button>
        </div>

        {/* selection so far */}
        {(sel.category || sel.brand) && step !== 'category' && (
          <div className="text-xs text-slate-500">
            {[sel.category, mode === 'innerwear' ? sel.brand : sel.style, mode === 'innerwear' ? sel.istyle : sel.sleeve, sel.size]
              .filter(Boolean)
              .join(' › ')}
            {sel.prefix && step !== 'style' && step !== 'sleeve' && step !== 'brand' && step !== 'istyle' && (
              <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">{sel.prefix}</span>
            )}
          </div>
        )}

        {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}

        {/* inline "add new" form */}
        {ask && (
          <form
            className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-3"
            onSubmit={async (e) => {
              e.preventDefault()
              try {
                await ask.onOk(askVals)
                setAsk(null)
              } catch {
                /* error shown above */
              }
            }}
          >
            <div className="text-sm font-medium">{ask.title}</div>
            <div className="grid gap-2 sm:grid-cols-3">
              {ask.fields.map((f, i) => (
                <Field key={f.key} label={f.label}>
                  <Input
                    autoFocus={i === 0}
                    placeholder={f.placeholder}
                    value={askVals[f.key] ?? ''}
                    onChange={(e) => setAskVals((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                </Field>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" type="button" onClick={() => setAsk(null)}>
                Cancel
              </Button>
              <Button type="submit" loading={busy}>
                Add
              </Button>
            </div>
          </form>
        )}

        {/* ---- steps ---- */}
        {step === 'category' &&
          (categories === null ? (
            <Spinner />
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {categories.map((c) => (
                <button key={c.category} className={tile} disabled={busy} onClick={() => pickCategory(c.category).catch(() => {})}>
                  {c.category}
                  <span className="block text-xs font-normal text-slate-400">{c.n} labels</span>
                </button>
              ))}
              <button
                className={addTile}
                onClick={() =>
                  openAsk({
                    title: 'New category',
                    fields: [
                      { key: 'category', label: 'Category', placeholder: 'e.g. Blazer' },
                      { key: 'style', label: 'Style', placeholder: 'e.g. Regular' },
                      { key: 'sleeve', label: 'Sleeve (F/S, H/S or empty)', placeholder: '' },
                    ],
                    onOk: (v) => addItem(v.category ?? '', v.style ?? '', (v.sleeve ?? '').trim().toUpperCase()),
                  })
                }
              >
                <Plus className="h-4 w-4" /> New category
              </button>
            </div>
          ))}

        {step === 'style' && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {styles.map((s) => (
              <button key={s.style} className={tile} disabled={busy} onClick={() => pickStyle(s).catch(() => {})}>
                {s.style}
                {s.sleeves.length > 1 && <span className="block text-xs font-normal text-slate-400">{s.sleeves.map((x) => x.sleeve || '—').join(' / ')}</span>}
              </button>
            ))}
            <button
              className={addTile}
              onClick={() =>
                openAsk({
                  title: `New style for ${sel.category}`,
                  fields: [
                    { key: 'style', label: 'Style', placeholder: 'e.g. Regular' },
                    { key: 'sleeve', label: 'Sleeve (F/S, H/S or empty)' },
                  ],
                  onOk: (v) => addItem(sel.category, v.style ?? '', (v.sleeve ?? '').trim().toUpperCase()),
                })
              }
            >
              <Plus className="h-4 w-4" /> New style
            </button>
          </div>
        )}

        {step === 'sleeve' && (
          <div className="grid grid-cols-2 gap-2">
            {sleeves.map((v) => (
              <button key={v.label_prefix} className={`${tile} py-5 text-center text-base`} disabled={busy} onClick={() => pickSleeve(v).catch(() => {})}>
                {v.sleeve || 'No sleeve'}
                <span className="block font-mono text-[11px] font-normal text-slate-400">{v.label_prefix}</span>
              </button>
            ))}
          </div>
        )}

        {step === 'brand' && (
          <div className="space-y-2">
            <Input placeholder="Search brand" value={brandSearch} onChange={(e) => setBrandSearch(e.target.value)} />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {filteredBrands.map((b) => (
                <button key={b.brand} className={tile} disabled={busy} onClick={() => pickBrand(b.brand).catch(() => {})}>
                  {b.brand}
                  <span className="block text-xs font-normal text-slate-400">{b.n} labels</span>
                </button>
              ))}
              <button
                className={addTile}
                onClick={() =>
                  openAsk({
                    title: 'New innerwear brand',
                    fields: [{ key: 'brand', label: 'Brand' }],
                    onOk: async (v) => {
                      const b = await call<string>('wizard_add_brand', { p_brand: v.brand ?? '' })
                      setBrands(await call('wizard_brands'))
                      await pickBrand(b)
                    },
                  })
                }
              >
                <Plus className="h-4 w-4" /> New brand
              </button>
            </div>
          </div>
        )}

        {step === 'istyle' && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {istyles.map((s) => (
              <button key={s.style} className={tile} disabled={busy} onClick={() => pickIStyle(s.style).catch(() => {})}>
                {s.style || '(no style)'}
                <span className="block text-xs font-normal text-slate-400">{s.n} labels</span>
              </button>
            ))}
            <button
              className={addTile}
              onClick={() =>
                openAsk({
                  title: `New style for ${sel.brand}`,
                  fields: [{ key: 'style', label: 'Style', placeholder: 'e.g. RN WH, BRIEF' }],
                  onOk: (v) => pickIStyle((v.style ?? '').trim().toUpperCase()),
                })
              }
            >
              <Plus className="h-4 w-4" /> New style
            </button>
          </div>
        )}

        {step === 'size' && (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {sizes.map((sz) => (
              <button key={sz} className={`${tile} py-4 text-center text-base`} onClick={() => pickSize(sz)}>
                {sz}
              </button>
            ))}
            <button
              className={addTile}
              onClick={() =>
                openAsk({
                  title: 'Custom size',
                  fields: [{ key: 'size', label: 'Size', placeholder: 'e.g. 3XL, 42, 95CM' }],
                  onOk: (v) => {
                    const s = (v.size ?? '').trim().toUpperCase().replace(/\s+/g, '')
                    if (s) pickSize(s)
                  },
                })
              }
            >
              <Plus className="h-4 w-4" /> Other
            </button>
          </div>
        )}

        {step === 'price' && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              priceNext()
            }}
          >
            <div className="grid grid-cols-3 gap-3">
              <Field label="MRP (₹)" hint="Decimals hold the selling price">
                <Input ref={priceRef} type="number" inputMode="decimal" min={0} step="any" value={price} onChange={(e) => onMrp(e.target.value)} placeholder="650.50" />
              </Field>
              <Field label="Selling price (₹)">
                <Input type="number" inputMode="numeric" min={1} step="any" value={actual} onChange={(e) => onActual(e.target.value)} />
              </Field>
              <Field label="Code">
                <Input value={code} onChange={(e) => onCode(e.target.value)} className="font-mono uppercase" placeholder="E00" />
              </Field>
            </div>
            <p className="text-xs text-slate-500">
              650.50 → sells at ₹500 → code E00 · 1500.12 → ₹1200 → A200 · no decimals → selling price = MRP
            </p>
            <div className="flex justify-end">
              <Button type="submit">Next</Button>
            </div>
          </form>
        )}

        {step === 'details' && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              save(true)
            }}
          >
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <div className="font-mono font-medium">
                {sel.prefix} {sel.size} {code}
              </div>
              <div className="text-xs text-slate-500">
                MRP {money(parseFloat(price) || 0)} · sells at {money(sale)}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Quantity received">
                <Input autoFocus type="number" inputMode="numeric" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
              </Field>
              <Field label="Purchase price (₹ each)">
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={costValue}
                  onChange={(e) => {
                    setCost(e.target.value)
                    setCostEdited(true)
                  }}
                />
              </Field>
              <Field label="Label description (optional)">
                <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. colour" />
              </Field>
            </div>
            <details className="text-xs text-slate-500">
              <summary className="cursor-pointer">Purchase price formula: {formula || '(none)'}</summary>
              <div className="mt-2 flex items-center gap-2">
                <Input value={formula} onChange={(e) => setFormula(e.target.value)} className="font-mono" placeholder="salePrice*(1-0.35)" />
                <Button variant="secondary" type="button" onClick={() => setFormula('salePrice*(1-0.35)')}>
                  Reset
                </Button>
              </div>
              <p className="mt-1">Uses the selling price. Leave empty to keep each product's current purchase price.</p>
            </details>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" type="button" loading={busy} onClick={() => save(false)}>
                Add & new item
              </Button>
              <Button type="submit" loading={busy}>
                Add & next size
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  )
}
