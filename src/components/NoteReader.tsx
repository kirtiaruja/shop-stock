import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { supabase, errMsg } from '../lib/supabase'
import { buildRows, type CatalogEntry, type NoteRow } from '../lib/noteParser'
import { CODE_RE, actualFromMrp, costFromFormula, loadCostFormula, priceCode } from '../lib/pricing'
import { makeBarcode, type WizardItem } from './BarcodeWizard'
import { Button, Modal, inputCls, useToast } from './ui'

type Row = NoteRow & { failed?: string }

/** selling price must not be above MRP (e.g. "60.30" reads as ₹300 — needs fixing) */
const priceOk = (r: Row) => !(Number(r.actual) > parseFloat(r.mrp))
const rowOk = (r: Row) =>
  !!r.prefix && !!String(r.size).trim() && parseFloat(r.mrp) > 0 && CODE_RE.test((r.code || '').toUpperCase()) && Number(r.qty) > 0 && priceOk(r)

/**
 * Paste the text of a handwritten purchase note (copied with Google Lens / iPhone Live Text),
 * check the rows, and add them all to the purchase with barcodes.
 */
export default function NoteReader({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (item: WizardItem) => void }) {
  const toast = useToast()
  const [text, setText] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const read = async () => {
    setError('')
    if (!text.trim()) return setError('Paste the note text first.')
    let cat = catalog
    if (!cat) {
      setBusy(true)
      const { data, error } = await supabase.rpc('wizard_catalog')
      setBusy(false)
      if (error) return setError(errMsg(error))
      cat = data as CatalogEntry[]
      setCatalog(cat)
    }
    const r = buildRows(text.slice(0, 5000), cat)
    if (!r.length) return setError('Could not find any items in the text.')
    setRows(r)
  }

  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch, failed: undefined } : r)))
  const ready = rows.filter(rowOk)
  const labels = ready.reduce((t, r) => t + Number(r.qty), 0)

  const addAll = async () => {
    const formula = loadCostFormula()
    const left: Row[] = []
    let added = 0
    setBusy(true)
    for (const row of rows) {
      if (!rowOk(row)) {
        left.push(row)
        continue
      }
      try {
        const sale = Number(row.actual) || null
        const cost = sale ? costFromFormula(formula, sale) : null
        const r = await makeBarcode({
          prefix: row.prefix,
          size: String(row.size).toUpperCase().replace(/\s+/g, ''),
          code: row.code.toUpperCase(),
          mrp: parseFloat(row.mrp),
          sale_price: sale,
          purchase_price: cost,
        })
        onAdd({ result: r, qty: Number(row.qty), cost: cost ?? (Number(r.product.purchase_price) || 0), desc: '' })
        added++
      } catch (e) {
        left.push({ ...row, failed: errMsg(e) })
      }
    }
    setBusy(false)
    setRows(left)
    toast(`${added} ${added === 1 ? 'item' : 'items'} added to the purchase${left.length ? ` · ${left.length} still need fixing` : ''}`, !left.length)
    if (!left.length) {
      setText('')
      onClose()
    }
  }

  const cell = `${inputCls} px-2 py-1.5`
  const bad = (r: Row, k: string) => (r.unsure.includes(k) ? 'border-amber-400 bg-amber-50' : '')

  return (
    <Modal open={open} onClose={onClose} title="Read a handwritten note" wide>
      <div className="space-y-4 text-sm">
        {!rows.length ? (
          <>
            <p className="text-slate-600">
              Take a photo of the supplier's note, copy its text with <b>Google Lens</b> or iPhone <b>Live Text</b>, and paste it here. One line per item, for
              example <code className="rounded bg-slate-100 px-1">APPL F/S M/6 L/7 XL/6 - 356.30</code>.
            </p>
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              className={`${inputCls} font-mono`}
              placeholder={'APPL F/S  M/6  L/7  XL/6 - 356.30\nOPEX BLOOMER 80/6 85/4 - 60.30'}
            />
            {error && <p className="rounded-lg bg-red-50 p-2 text-red-700">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={read} loading={busy}>
                Read note
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-slate-600">
              Check each row. Yellow boxes are guesses. Rows that aren't complete stay here after adding.
            </p>
            <div className="space-y-2">
              {rows.map((r, i) => (
                <div key={i} className={`rounded-lg border p-2.5 ${rowOk(r) ? 'border-slate-200' : 'border-amber-300 bg-amber-50/40'}`}>
                  <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span className="truncate font-mono">{r.line}</span>
                    <button className="shrink-0 text-red-600" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                      Remove
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-[2fr_repeat(5,minmax(0,1fr))]">
                    <select value={r.prefix} onChange={(e) => set(i, { prefix: e.target.value, unsure: r.unsure.filter((u) => u !== 'product') })} className={`${cell} col-span-2 sm:col-span-1 ${bad(r, 'product')}`}>
                      <option value="">— pick product for “{r.text}” —</option>
                      {r.options.map((o) => (
                        <option key={o.prefix} value={o.prefix}>
                          {o.prefix} · {o.label} ({Math.round(o.score * 100)}%)
                        </option>
                      ))}
                    </select>
                    <input aria-label="Size" placeholder="Size" value={r.size} onChange={(e) => set(i, { size: e.target.value.toUpperCase() })} className={`${cell} ${bad(r, 'size')}`} />
                    <input aria-label="Qty" placeholder="Qty" type="number" min={1} value={r.qty} onChange={(e) => set(i, { qty: Number(e.target.value) })} className={`${cell} ${bad(r, 'qty')}`} />
                    <input
                      aria-label="MRP"
                      placeholder="MRP"
                      value={r.mrp}
                      onChange={(e) => {
                        const actual = actualFromMrp(e.target.value)
                        set(i, { mrp: e.target.value, actual, code: priceCode(actual) })
                      }}
                      className={`${cell} ${bad(r, 'mrp')}`}
                    />
                    <input
                      aria-label="Selling price"
                      placeholder="Sell"
                      value={r.actual}
                      onChange={(e) => set(i, { actual: e.target.value, code: priceCode(e.target.value) })}
                      className={`${cell} ${bad(r, 'actual')}`}
                    />
                    <input aria-label="Code" placeholder="Code" value={r.code} onChange={(e) => set(i, { code: e.target.value.toUpperCase() })} className={`${cell} font-mono`} />
                  </div>
                  {!priceOk(r) && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-amber-700">
                      <AlertTriangle className="h-3.5 w-3.5" /> Selling price ₹{r.actual} is more than the MRP ₹{r.mrp} — fix the MRP or selling price.
                    </p>
                  )}
                  {r.failed && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-red-600">
                      <AlertTriangle className="h-3.5 w-3.5" /> {r.failed}
                    </p>
                  )}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="ghost" onClick={() => setRows([])}>
                ← Edit text
              </Button>
              <Button onClick={addAll} loading={busy} disabled={!ready.length}>
                Add {ready.length} {ready.length === 1 ? 'row' : 'rows'} ({labels} pcs)
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
