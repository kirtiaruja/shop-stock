import { useEffect, useRef, useState } from 'react'
import { ScanBarcode } from 'lucide-react'
import type { CatalogItem } from '../lib/supabase'
import { beep } from '../lib/beep'
import { money, qty } from '../lib/format'

interface Props {
  lookup: (text: string) => CatalogItem | undefined
  search: (text: string, limit?: number) => CatalogItem[]
  onPick: (item: CatalogItem) => void
  showCost?: boolean
  disabled?: boolean
}

const isTypingTarget = (el: Element | null) =>
  !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el as HTMLElement).isContentEditable)

/**
 * Works with any USB / Bluetooth barcode scanner in keyboard mode:
 * the scanner "types" the code and presses Enter.
 * - When this box has focus, Enter adds the matching product.
 * - When nothing is focused (e.g. after clicking a button) a fast burst of
 *   keys ending in Enter is still caught and treated as a scan.
 * You can also type part of a name and pick from the list.
 */
export default function ScanBox({ lookup, search, onPick, showCost, disabled }: Props) {
  const [text, setText] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const suggestions = text.trim().length >= 2 ? search(text, 8) : []

  const resolve = (raw: string) => {
    const value = raw.trim()
    if (!value) return
    const hit = lookup(value)
    if (hit) {
      onPick(hit)
      beep(true)
      setMsg(null)
      setText('')
      return
    }
    const list = search(value, 2)
    if (list.length === 1) {
      onPick(list[0])
      beep(true)
      setMsg(null)
      setText('')
      return
    }
    beep(false)
    setMsg(`No product found for “${value}”`)
  }

  // Catch scans when focus is not inside any input.
  const pickRef = useRef(resolve)
  useEffect(() => {
    pickRef.current = resolve
  })
  useEffect(() => {
    if (disabled) return
    let buf = ''
    let last = 0
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(document.activeElement)) return
      if (document.querySelector('[data-modal-open]')) return
      const now = Date.now()
      if (now - last > 80) buf = ''
      last = now
      if (e.key === 'Enter') {
        if (buf.length >= 3) {
          e.preventDefault()
          pickRef.current(buf)
          inputRef.current?.focus()
        }
        buf = ''
      } else if (e.key.length === 1) {
        buf += e.key
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [disabled])

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-xl border-2 border-indigo-200 bg-white px-3 focus-within:border-indigo-500">
        <ScanBarcode className="h-5 w-5 shrink-0 text-indigo-500" />
        <input
          ref={inputRef}
          autoFocus
          disabled={disabled}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setActive(0)
            setMsg(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              // If the user arrowed onto a suggestion, take that one.
              if (suggestions.length && active > 0) {
                onPick(suggestions[active - 1])
                beep(true)
                setText('')
                setActive(0)
              } else resolve(text)
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(a + 1, suggestions.length))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(a - 1, 0))
            } else if (e.key === 'Escape') {
              setText('')
            }
          }}
          placeholder="Scan barcode or type item name / code…"
          className="w-full bg-transparent py-3 text-base outline-none"
          inputMode="search"
          autoComplete="off"
        />
      </div>
      {msg && <p className="mt-1 text-sm text-red-600">{msg}</p>}
      {suggestions.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          {suggestions.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(s)
                  beep(true)
                  setText('')
                  inputRef.current?.focus()
                }}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-indigo-50 ${active === i + 1 ? 'bg-indigo-50' : ''}`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-800">{s.name}</span>
                  <span className="text-xs text-slate-500">
                    {s.item_code || 'no code'} · stock {qty(s.stock)}
                  </span>
                </span>
                <span className="shrink-0 text-right text-xs text-slate-600">
                  {money(showCost ? s.purchase_price : s.sale_price)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
