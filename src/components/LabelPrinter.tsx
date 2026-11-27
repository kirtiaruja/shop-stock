import { useEffect, useState } from 'react'
import { Printer } from 'lucide-react'
import { supabase, errMsg } from '../lib/supabase'
import { PAPERS, loadSheet, printLabels, saveSheet, sheetsNeeded, type LabelJob } from '../lib/labels'
import type { Line } from './LineList'
import { Button, Field, Modal, Select, Spinner, inputCls, useToast } from './ui'

type Job = LabelJob & { key: number; on: boolean }

/** Print A4 sticker labels for the items in a purchase. */
export default function LabelPrinter({ open, onClose, lines }: { open: boolean; onClose: () => void; lines: Line[] }) {
  const toast = useToast()
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [sheet, setSheet] = useState(loadSheet)
  const [busy, setBusy] = useState(false)

  // build the list when opened: wizard items carry their label, others are looked up
  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      setJobs(null)
      const missing = lines.filter((l) => !l.label).map((l) => l.product_id)
      let info: Record<string, { item_name: string; barcode: string | null; mrp: number | null }> = {}
      if (missing.length) {
        const { data, error } = await supabase.rpc('label_info', { p_product_ids: missing })
        if (error) toast(errMsg(error), false)
        info = (data ?? {}) as typeof info
      }
      if (cancelled) return
      setJobs(
        lines.map((l) => {
          const i = info[String(l.product_id)]
          return {
            key: l.product_id,
            on: true,
            item_name: l.label?.item_name ?? i?.item_name ?? l.name,
            barcode: l.label?.barcode ?? i?.barcode ?? l.item_code ?? '',
            mrp: l.label?.mrp ?? Number(i?.mrp ?? 0),
            desc: l.label?.desc ?? '',
            qty: Math.round(l.qty),
          }
        }),
      )
    })()
    return () => {
      cancelled = true
    }
  }, [open, lines, toast])

  useEffect(() => saveSheet(sheet), [sheet])

  const set = (k: number, patch: Partial<Job>) => setJobs((js) => js && js.map((j) => (j.key === k ? { ...j, ...patch } : j)))
  const chosen = (jobs ?? []).filter((j) => j.on && j.qty > 0)
  const count = chosen.reduce((t, j) => t + j.qty, 0)
  const paper = PAPERS.find((p) => p.id === sheet.paper) || PAPERS[0]
  const noBarcode = chosen.filter((j) => !j.barcode).length

  const print = async () => {
    setBusy(true)
    try {
      const skipped = await printLabels(chosen, sheet.paper, sheet.startPosition)
      if (skipped.length) toast(`Skipped (barcode can't be printed): ${skipped.join(', ')}`, false)
      else toast(`${count} labels ready — print from the PDF that opened`)
      // next time start after the last used sticker
      const per = paper.cols * paper.rows
      setSheet((s) => ({ ...s, startPosition: ((Math.max(1, s.startPosition) - 1 + count) % per) + 1 }))
    } catch (e) {
      toast(errMsg(e), false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Print labels" wide>
      {jobs === null ? (
        <Spinner />
      ) : (
        <div className="space-y-4 text-sm">
          <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
            <Field label="Sticker sheet (A4)">
              <Select value={sheet.paper} onChange={(e) => setSheet((s) => ({ ...s, paper: e.target.value }))}>
                {PAPERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Start at sticker no." hint="To use a half-used sheet">
              <input
                type="number"
                min={1}
                max={paper.cols * paper.rows}
                value={sheet.startPosition}
                onChange={(e) => setSheet((s) => ({ ...s, startPosition: Math.max(1, Number(e.target.value) || 1) }))}
                className={inputCls}
              />
            </Field>
          </div>

          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {jobs.map((j) => (
              <li key={j.key} className={`grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 px-3 py-2 sm:grid-cols-[auto_1fr_6rem_8rem_5rem] ${j.on ? '' : 'opacity-50'}`}>
                <input type="checkbox" checked={j.on} onChange={(e) => set(j.key, { on: e.target.checked })} aria-label="Print this item" />
                <div className="min-w-0">
                  <div className="truncate font-medium">{j.item_name}</div>
                  <div className={`font-mono text-xs ${j.barcode ? 'text-slate-500' : 'text-red-600'}`}>{j.barcode || 'no barcode'}</div>
                </div>
                <input
                  className={`${inputCls} col-start-2 px-2 py-1 sm:col-start-auto`}
                  placeholder="Description"
                  value={j.desc}
                  onChange={(e) => set(j.key, { desc: e.target.value })}
                  aria-label="Description"
                />
                <label className="col-start-2 flex items-center gap-1 sm:col-start-auto">
                  <span className="text-xs text-slate-500">MRP</span>
                  <input type="number" step="0.01" className={`${inputCls} px-2 py-1`} value={j.mrp} onChange={(e) => set(j.key, { mrp: Number(e.target.value) })} />
                </label>
                <label className="col-start-2 flex items-center gap-1 sm:col-start-auto">
                  <span className="text-xs text-slate-500">×</span>
                  <input type="number" min={0} className={`${inputCls} px-2 py-1`} value={j.qty} onChange={(e) => set(j.key, { qty: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
                </label>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-slate-600">
              <b>{count}</b> labels · {sheetsNeeded(paper, sheet.startPosition, count)} sheet(s)
              {noBarcode > 0 && <span className="text-red-600"> · {noBarcode} item(s) without a barcode will be skipped</span>}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
              <Button onClick={print} loading={busy} disabled={!count}>
                <Printer className="h-4 w-4" /> Print labels
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
