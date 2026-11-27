/**
 * Handwritten note → label rows. Port of the Barcode Wizard's note_parser.py (same rules, same matching).
 *
 * Understands lines like:
 *     APPL F/S  M/6  L/7  XL/6 - 356.30
 *     APPL FS M6 L7 XL6 356.30
 *     OPEX BLOOMER 80/6 85/4 - 60.30
 * and the two-line layout phones often produce for "size over quantity":
 *     APPL F/S M L XL - 356.30
 *     6 7 6
 */
import { actualFromMrp, priceCode } from './pricing'

const LETTER_SIZE = '(?:XS|S|M|L|XL|XXL|XXXL|[2-6]XL)'
const NUM_SIZE = '(?:\\d{2,3}\\s?CM|\\d{2,3})'
const SEP = '\\s*[/:×*]\\s*'

const PAIR_RE = new RegExp(
  `(?<![A-Z0-9/])(?:(?<ls>${LETTER_SIZE})\\s*[/:×*]?\\s*(?<lq>\\d{1,3})|(?<ns>${NUM_SIZE})${SEP}(?<nq>\\d{1,3}))(?![A-Z0-9])`,
  'g',
)
const SIZE_ONLY_RE = new RegExp(`(?<![A-Z0-9/])(${LETTER_SIZE}|\\d{2,3}\\s?CM)(?![A-Z0-9])`, 'g')
const MRP_RE = /(?:[-–—=]|RS\.?|₹)\s*(\d{1,5}(?:\.\d{1,2})?)\s*\/?-?\s*$|(?<![\d/])(\d{1,5}\.\d{1,2})\s*$/

export interface CatalogEntry {
  name: string
  prefix: string
  label: string
}
export interface Match extends CatalogEntry {
  score: number
}
export interface NoteRow {
  line: string
  text: string
  prefix: string
  label: string
  score: number
  options: Match[]
  size: string
  qty: number
  mrp: string
  actual: string
  code: string
  unsure: string[]
}

export function clean(text: string) {
  let t = (text || '').toUpperCase()
  t = t.replace(/\\/g, '/').replace(/\|/g, '/')
  t = t.replace(/\bF\s*\/?\s*S\b/g, 'F/S')
  t = t.replace(/\bH\s*\/?\s*S\b/g, 'H/S')
  return t.replace(/\s+/g, ' ').trim()
}

const stripChars = (s: string, chars: string) => {
  let a = 0
  let b = s.length
  while (a < b && chars.includes(s[a])) a++
  while (b > a && chars.includes(s[b - 1])) b--
  return s.slice(a, b)
}

type Pair = [string, number | null]

/** → [product text, [(size, qty)], mrp text] or null */
export function parseLine(line: string): [string, Pair[], string | null] | null {
  let t = clean(line)
  if (!t) return null
  let mrp: string | null = null
  const m = MRP_RE.exec(t)
  if (m) {
    mrp = m[1] || m[2]
    t = stripChars(t.slice(0, m.index).trim(), ' -–—=')
  }
  const pairs: Pair[] = []
  let first: number | null = null
  for (const pm of t.matchAll(PAIR_RE)) {
    const g = pm.groups!
    let size: string
    let q: string
    if (g.ls) {
      size = g.ls
      q = g.lq
    } else {
      size = g.ns.replace(/ /g, '')
      q = g.nq
    }
    pairs.push([size, parseInt(q, 10)])
    if (first === null) first = pm.index!
  }
  let product: string
  if (pairs.length) {
    product = stripChars(t.slice(0, first!), ' -/')
  } else {
    const sizes = [...t.matchAll(SIZE_ONLY_RE)].map((sm) => [sm[1].replace(/ /g, ''), sm.index!] as const)
    if (sizes.length) {
      product = stripChars(t.slice(0, sizes[0][1]), ' -/')
      for (const [s] of sizes) pairs.push([s, null])
    } else {
      product = t
    }
  }
  return [product, pairs, mrp]
}

interface Item {
  text: string
  pairs: Pair[]
  mrp: string | null
  line: string
}

export function parseNote(text: string): Item[] {
  const lines = (text || '').split(/\r?\n/).filter((l) => l.trim())
  const items: Item[] = []
  let i = 0
  while (i < lines.length) {
    const parsed = parseLine(lines[i])
    i++
    if (!parsed) continue
    const [product, pairs, mrp] = parsed
    // next line is only numbers → quantities for sizes written without them
    if (pairs.length && pairs.some(([, q]) => q === null) && i < lines.length) {
      const nums = lines[i].match(/\d{1,3}/g) || []
      if (nums.length && /^[\d\s/,.-]+$/.test(lines[i].trim()) && nums.length === pairs.length) {
        pairs.forEach((p, k) => (p[1] = parseInt(nums[k], 10)))
        i++
      }
    }
    if (!product && !pairs.length) continue
    if (!product && items.length) {
      // a continuation line of the previous product
      const last = items[items.length - 1]
      last.pairs.push(...pairs)
      last.mrp = last.mrp || mrp
      continue
    }
    items.push({ text: product, pairs, mrp, line: lines[i - 1] })
  }
  return items
}

/* ---------- Python difflib.SequenceMatcher(None, a, b).ratio() ---------- */
function similarity(a: string, b: string): number {
  if (!a.length && !b.length) return 1
  const b2j = new Map<string, number[]>()
  for (let j = 0; j < b.length; j++) {
    const list = b2j.get(b[j])
    if (list) list.push(j)
    else b2j.set(b[j], [j])
  }
  // difflib "autojunk": with 200+ chars, very common characters are ignored
  if (b.length >= 200) {
    const ntest = Math.floor(b.length / 100) + 1
    for (const [ch, idx] of [...b2j]) if (idx.length > ntest) b2j.delete(ch)
  }
  const longest = (alo: number, ahi: number, blo: number, bhi: number): [number, number, number] => {
    let besti = alo
    let bestj = blo
    let bestsize = 0
    let j2len = new Map<number, number>()
    for (let i = alo; i < ahi; i++) {
      const next = new Map<number, number>()
      for (const j of b2j.get(a[i]) ?? []) {
        if (j < blo) continue
        if (j >= bhi) break
        const k = (j2len.get(j - 1) ?? 0) + 1
        next.set(j, k)
        if (k > bestsize) {
          besti = i - k + 1
          bestj = j - k + 1
          bestsize = k
        }
      }
      j2len = next
    }
    return [besti, bestj, bestsize]
  }
  let matches = 0
  const queue: [number, number, number, number][] = [[0, a.length, 0, b.length]]
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop()!
    const [i, j, k] = longest(alo, ahi, blo, bhi)
    if (k) {
      matches += k
      if (alo < i && blo < j) queue.push([alo, i, blo, j])
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi])
    }
  }
  return (2 * matches) / (a.length + b.length)
}

const norm = (s: string) => clean(s).replace(/[^A-Z0-9/]/g, '')

export function bestMatches(productText: string, catalog: CatalogEntry[], limit = 5): Match[] {
  const q = norm(productText)
  if (!q) return []
  const scored = new Map<string, [number, CatalogEntry]>()
  for (const c of catalog) {
    const n = norm(c.name)
    let score = similarity(q, n)
    if (q === n) score = 1
    else if (n.startsWith(q) || q.startsWith(n)) score = Math.max(score, 0.85)
    const prev = scored.get(c.prefix)
    if (!prev || score > prev[0]) scored.set(c.prefix, [score, c])
  }
  return [...scored.values()]
    .sort((x, y) => y[0] - x[0])
    .slice(0, limit)
    .map(([s, c]) => ({ ...c, score: Math.round(s * 100) / 100 }))
}

export function buildRows(text: string, catalog: CatalogEntry[], threshold = 0.75): NoteRow[] {
  const rows: NoteRow[] = []
  for (const item of parseNote(text)) {
    const matches = bestMatches(item.text, catalog)
    const top = matches[0] && matches[0].score >= threshold ? matches[0] : null
    const actual = actualFromMrp(item.mrp)
    const pairs: Pair[] = item.pairs.length ? item.pairs : [[null as unknown as string, 1]]
    for (const [size, qty] of pairs) {
      const actualNum = actual === '' ? null : Number(actual)
      rows.push({
        line: item.line,
        text: item.text,
        prefix: top ? top.prefix : '',
        label: top ? top.label : '',
        score: top ? top.score : matches[0]?.score ?? 0,
        options: matches,
        size: size || '',
        qty: qty || 1,
        mrp: item.mrp || '',
        actual: actual,
        code: priceCode(actualNum),
        unsure: (
          [
            ['product', !top],
            ['size', !size],
            ['qty', qty === null],
            ['mrp', !item.mrp],
            ['actual', actualNum === null || (!!item.mrp && actualNum > parseFloat(item.mrp))],
          ] as [string, boolean][]
        )
          .filter(([, bad]) => bad)
          .map(([k]) => k),
      })
    }
  }
  return rows
}
