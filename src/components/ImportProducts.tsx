import { useState } from 'react'
import { FileSpreadsheet } from 'lucide-react'
import { supabase, errMsg } from '../lib/supabase'
import { parseProductsFile, exportProducts, type ParsedFile } from '../lib/excel'
import { Button, Modal, useToast } from './ui'

const BATCH = 250

export default function ImportProducts({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [parsed, setParsed] = useState<ParsedFile | null>(null)
  const [fileName, setFileName] = useState('')
  const [updateStock, setUpdateStock] = useState(true)
  const [progress, setProgress] = useState<number | null>(null)
  const [result, setResult] = useState<{ inserted: number; updated: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    if (progress !== null) return
    setParsed(null)
    setResult(null)
    setError(null)
    setFileName('')
    onClose()
  }

  const pick = async (file?: File) => {
    if (!file) return
    setError(null)
    setResult(null)
    setFileName(file.name)
    try {
      setParsed(await parseProductsFile(file))
    } catch (e) {
      setParsed(null)
      setError(errMsg(e))
    }
  }

  const run = async () => {
    if (!parsed) return
    const total = { inserted: 0, updated: 0 }
    setProgress(0)
    try {
      for (let i = 0; i < parsed.rows.length; i += BATCH) {
        const { data, error } = await supabase.rpc('import_products', {
          rows: parsed.rows.slice(i, i + BATCH),
          p_update_stock: updateStock,
        })
        if (error) throw new Error(`Rows ${i + 2}–${Math.min(i + BATCH, parsed.rows.length) + 1}: ${error.message}`)
        total.inserted += data.inserted
        total.updated += data.updated
        setProgress(Math.min(100, Math.round(((i + BATCH) / parsed.rows.length) * 100)))
      }
      setResult(total)
      toast(`Import finished: ${total.inserted} added, ${total.updated} updated`)
      onDone()
    } catch (e) {
      setError(errMsg(e) + (total.inserted + total.updated ? ` (${total.inserted + total.updated} rows were already saved)` : ''))
      onDone()
    } finally {
      setProgress(null)
    }
  }

  return (
    <Modal open={open} onClose={close} title="Import products from Excel">
      <div className="space-y-4 text-sm">
        <p className="text-slate-600">
          Use the same columns as your <b>Export Items</b> sheet. Items are matched by <b>Item code</b>, then by <b>Item name</b>: matches
          are updated, new ones are added.
        </p>
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-6 text-center hover:border-indigo-400">
          <FileSpreadsheet className="h-8 w-8 text-emerald-600" />
          <span className="font-medium">{fileName || 'Choose .xlsx / .xls / .csv file'}</span>
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        <button className="text-indigo-600" onClick={() => exportProducts([], 'stockpilot-import-template.xlsx')}>
          Download empty template
        </button>

        {parsed && !result && (
          <div className="space-y-2 rounded-lg bg-slate-50 p-3">
            <div>
              <b>{parsed.rows.length}</b> products found{parsed.skipped ? `, ${parsed.skipped} empty rows skipped` : ''}.
            </div>
            <div className="text-xs text-slate-500">Columns used: {parsed.matched.join(', ')}</div>
            {parsed.unknown.length > 0 && <div className="text-xs text-amber-700">Ignored columns: {parsed.unknown.join(', ')}</div>}
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={updateStock} onChange={(e) => setUpdateStock(e.target.checked)} className="mt-0.5" />
              <span>
                Set stock from the file's “Current stock quantity”
                <span className="block text-xs text-slate-500">Untick to keep the current stock of products that already exist.</span>
              </span>
            </label>
          </div>
        )}

        {progress !== null && (
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full bg-indigo-600 transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}
        {error && <p className="rounded-lg bg-red-50 p-2 text-red-700">{error}</p>}
        {result && (
          <p className="rounded-lg bg-emerald-50 p-2 text-emerald-700">
            Done: {result.inserted} added, {result.updated} updated.
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={close} disabled={progress !== null}>
            {result ? 'Close' : 'Cancel'}
          </Button>
          {!result && (
            <Button onClick={run} disabled={!parsed?.rows.length} loading={progress !== null}>
              Import {parsed?.rows.length ?? ''} products
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
