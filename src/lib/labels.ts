/**
 * A4 sticker labels — same sheets and layout as the Barcode Wizard:
 * product name, (optional description), Code 39 barcode, barcode number, "MRP Rs. 0.00".
 * jsPDF and JsBarcode load only when you print.
 */

export interface Paper {
  id: string
  name: string
  cols: number
  rows: number
  w: number
  h: number
  top: number
  left: number
  gapX: number
  gapY: number
}

// Check the size printed on your label pack and pick the matching one. To add a sheet: copy a line and change the numbers (mm).
export const PAPERS: Paper[] = [
  { id: '65', name: '65 labels · 38.1 × 21.2 mm (5 × 13)', cols: 5, rows: 13, w: 38.1, h: 21.2, top: 10.7, left: 4.75, gapX: 2.54, gapY: 0 },
  { id: '48', name: '48 labels · 45.7 × 21.2 mm (4 × 12)', cols: 4, rows: 12, w: 45.7, h: 21.2, top: 21.6, left: 9.85, gapX: 2.5, gapY: 0 },
  { id: '44', name: '44 labels · 48.5 × 25.4 mm (4 × 11)', cols: 4, rows: 11, w: 48.5, h: 25.4, top: 8.8, left: 8, gapX: 0, gapY: 0 },
  { id: '40', name: '40 labels · 52.5 × 29.7 mm (4 × 10)', cols: 4, rows: 10, w: 52.5, h: 29.7, top: 0, left: 0, gapX: 0, gapY: 0 },
  { id: '40s', name: '40 labels · 45.7 × 25.4 mm (4 × 10)', cols: 4, rows: 10, w: 45.7, h: 25.4, top: 21.5, left: 9.7, gapX: 2.6, gapY: 0 },
  { id: '24', name: '24 labels · 70 × 37 mm (3 × 8)', cols: 3, rows: 8, w: 70, h: 37, top: 0.5, left: 0, gapX: 0, gapY: 0 },
  { id: '24s', name: '24 labels · 63.5 × 33.9 mm (3 × 8)', cols: 3, rows: 8, w: 63.5, h: 33.9, top: 12.9, left: 7.21, gapX: 2.54, gapY: 0 },
  { id: '21', name: '21 labels · 63.5 × 38.1 mm (3 × 7)', cols: 3, rows: 7, w: 63.5, h: 38.1, top: 15.15, left: 7.21, gapX: 2.54, gapY: 0 },
  { id: '16', name: '16 labels · 99.1 × 33.9 mm (2 × 8)', cols: 2, rows: 8, w: 99.1, h: 33.9, top: 12.9, left: 4.65, gapX: 2.54, gapY: 0 },
  { id: '14', name: '14 labels · 99.1 × 38.1 mm (2 × 7)', cols: 2, rows: 7, w: 99.1, h: 38.1, top: 15.15, left: 4.65, gapX: 2.54, gapY: 0 },
]

export interface LabelJob {
  item_name: string
  barcode: string
  mrp: number
  desc?: string
  qty: number
}

const SHEET_KEY = 'stockpilot.labelSheet'
export function loadSheet(): { paper: string; startPosition: number } {
  try {
    const s = JSON.parse(localStorage.getItem(SHEET_KEY) || '{}')
    return { paper: PAPERS.some((p) => p.id === s.paper) ? s.paper : '65', startPosition: Number(s.startPosition) || 1 }
  } catch {
    return { paper: '65', startPosition: 1 }
  }
}
export function saveSheet(s: { paper: string; startPosition: number }) {
  try {
    localStorage.setItem(SHEET_KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

export function sheetsNeeded(paper: Paper, startPosition: number, labels: number) {
  const per = paper.cols * paper.rows
  return labels ? Math.ceil((Math.max(1, startPosition) - 1 + labels) / per) : 0
}

/** Builds the label PDF and opens it in a new tab for printing. Returns skipped barcodes. */
export async function printLabels(jobs: LabelJob[], paperId: string, startPosition: number): Promise<string[]> {
  const [{ jsPDF }, JsBarcodeMod] = await Promise.all([import('jspdf'), import('jsbarcode')])
  const JsBarcode = JsBarcodeMod.default
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const P = PAPERS.find((p) => p.id === paperId) || PAPERS[0]
  const perPage = P.cols * P.rows
  const PT = 0.3528 // 1 pt in mm
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

  // font sizes scale with the label height
  const nameFs = clamp(P.h * 0.32, 5, 9)
  const priceFs = clamp(P.h * 0.36, 5.5, 10)
  const numFs = clamp(P.h * 0.26, 4.5, 7)
  const pad = clamp(P.h * 0.06, 1, 2)
  const gap = 0.6
  const descFs = clamp(P.h * 0.26, 4.5, 7.5)
  const barW = P.w * 0.6 // barcode width = 60% of the sticker
  const layout = (hasDesc: boolean) => {
    const textH = (nameFs + priceFs + numFs + (hasDesc ? descFs : 0)) * PT * 1.15
    const gaps = (hasDesc ? 4 : 3) * gap
    const barH = clamp(P.h - 2 * pad - textH - gaps, 4, 14)
    return { barH, blockH: textH + barH + gaps }
  }
  const fitText = (text: string, fs: number, maxW: number) => {
    doc.setFontSize(fs)
    while (doc.getTextWidth(text) > maxW && fs > 4) doc.setFontSize((fs -= 0.25))
    while (doc.getTextWidth(text) > maxW && text.length > 1) text = text.slice(0, -1)
    return text
  }

  const skipped: string[] = []
  let labelIndex = Math.max(1, Math.floor(startPosition) || 1) - 1

  for (const it of jobs) {
    const name = String(it.item_name || '')
    const barcode = String(it.barcode || '')
    const price = 'MRP Rs. ' + (Number(it.mrp) || 0).toFixed(2)
    const qty = Math.max(0, Math.floor(Number(it.qty) || 0))
    const desc = String(it.desc || '').trim()
    const { barH, blockH } = layout(!!desc)

    const canvas = document.createElement('canvas')
    try {
      JsBarcode(canvas, barcode, { format: 'CODE39', displayValue: false, width: 2, height: 60, margin: 0 })
    } catch {
      skipped.push(barcode || name)
      continue
    }
    const img = canvas.toDataURL('image/png')

    for (let i = 0; i < qty; i++) {
      const inPage = labelIndex % perPage
      if (labelIndex > 0 && inPage === 0) doc.addPage()
      const row = Math.floor(inPage / P.cols)
      const col = inPage % P.cols
      const x = P.left + col * (P.w + P.gapX)
      const y = P.top + row * (P.h + P.gapY)
      const cx = x + P.w / 2
      let cy = y + (P.h - blockH) / 2 // centre the block vertically

      // 1. product name
      doc.setFont('helvetica', 'bold')
      const n = fitText(name, nameFs, P.w - 2 * pad)
      cy += nameFs * PT
      doc.text(n, cx, cy, { align: 'center' })
      cy += gap + 0.3

      // 1b. description (optional)
      if (desc) {
        doc.setFont('helvetica', 'normal')
        const d = fitText(desc, descFs, P.w - 2 * pad)
        cy += descFs * PT
        doc.text(d, cx, cy, { align: 'center' })
        cy += gap
      }

      // 2. barcode
      doc.addImage(img, 'PNG', cx - barW / 2, cy, barW, barH)
      cy += barH + gap

      // 3. barcode number
      doc.setFont('courier', 'bold')
      doc.setFontSize(numFs)
      cy += numFs * PT
      doc.text(barcode, cx, cy, { align: 'center' })
      cy += gap

      // 4. price
      doc.setFont('helvetica', 'bold')
      const pr = fitText(price, priceFs, P.w - 2 * pad)
      cy += priceFs * PT
      doc.text(pr, cx, cy, { align: 'center' })

      labelIndex++
    }
  }

  const url = doc.output('bloburl') as unknown as string
  const win = window.open(url, '_blank')
  if (win) {
    win.addEventListener?.('load', () => {
      try {
        win.print()
      } catch {
        /* user prints from the PDF viewer */
      }
    })
  } else {
    // pop-up blocked → download instead
    doc.save('labels.pdf')
  }
  return skipped
}
