import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'

/**
 * Bills in progress are kept in this browser until they are saved or cleared,
 * so you can leave New purchase, make a sale, and come back to the same bill.
 */
export type DraftPage = 'sale' | 'purchase'
/** One open bill: 'sale' is the first sale bill, 'sale#2', 'sale#3'… the others. */
export type BillSlot = string
const PREFIX = 'stockpilot.draft.'
const EVENT = 'stockpilot-draft'
const key = (slot: BillSlot, field: string) => `${PREFIX}${slot}.${field}`
const slotsKey = (page: DraftPage) => `${PREFIX}slots.${page}`

function read<T>(k: string, initial: T): T {
  try {
    const v = localStorage.getItem(k)
    return v == null ? initial : (JSON.parse(v) as T)
  } catch {
    return initial
  }
}

/** useState that survives leaving the page (and a refresh). */
export function useDraft<T>(page: BillSlot, field: string, initial: T | (() => T)) {
  const k = key(page, field)
  const [v, setV] = useState<T>(() => read(k, typeof initial === 'function' ? (initial as () => T)() : initial))
  useEffect(() => {
    try {
      localStorage.setItem(k, JSON.stringify(v))
    } catch {
      /* storage full or unavailable */
    }
    window.dispatchEvent(new Event(EVENT))
  }, [k, v])
  return [v, setV] as const
}

/** Forget every bill in progress (on sign out, so the next person starts clean). */
export function clearAllDrafts() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX) || k === 'stockpilot.purchaseDraft')
      .forEach((k) => localStorage.removeItem(k))
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb)
  window.addEventListener('storage', cb) // another tab
  return () => {
    window.removeEventListener(EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}

// ---------- several bills open at once ----------

interface Slots {
  ids: BillSlot[]
  active: BillSlot
}
function readSlots(page: DraftPage): Slots {
  const s = read<Slots | null>(slotsKey(page), null)
  if (!s || !Array.isArray(s.ids) || !s.ids.length) return { ids: [page], active: page }
  return { ids: s.ids, active: s.ids.includes(s.active) ? s.active : s.ids[0] }
}
function writeSlots(page: DraftPage, s: Slots) {
  try {
    localStorage.setItem(slotsKey(page), JSON.stringify(s))
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVENT))
}
function forgetSlot(slot: BillSlot) {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(`${PREFIX}${slot}.`))
      .forEach((k) => localStorage.removeItem(k))
  } catch {
    /* ignore */
  }
}

/** Open bills of a page, and which one is showing. */
export function useSlots(page: DraftPage): Slots {
  const snap = useSyncExternalStore(subscribe, () => localStorage.getItem(slotsKey(page)) ?? '')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => readSlots(page), [snap, page])
}
export function addSlot(page: DraftPage) {
  const s = readSlots(page)
  let n = 2
  while (s.ids.includes(`${page}#${n}`)) n++
  const id = `${page}#${n}`
  writeSlots(page, { ids: [...s.ids, id], active: id })
}
export function switchSlot(page: DraftPage, id: BillSlot) {
  const s = readSlots(page)
  if (s.ids.includes(id)) writeSlots(page, { ...s, active: id })
}
/** Remove an open bill (its items are forgotten). The last bill is just emptied. */
export function closeSlot(page: DraftPage, id: BillSlot) {
  const s = readSlots(page)
  forgetSlot(id)
  const at = s.ids.indexOf(id)
  let ids = s.ids.filter((x) => x !== id)
  if (!ids.length) ids = [page]
  const active = s.active === id ? ids[Math.max(0, at - 1)] ?? ids[0] : s.active
  writeSlots(page, { ids, active })
}
/** After a bill is saved: close its tab if other bills are open. */
export function finishSlot(page: DraftPage, id: BillSlot) {
  if (readSlots(page).ids.length > 1) closeSlot(page, id)
}

export interface SlotSummary {
  id: BillSlot
  items: number
  party: string | null
  /** saved bill number when this tab is editing one */
  editing: number | null
}
/** Item count and customer / supplier of each open bill, for the tabs. */
export function useSlotSummaries(page: DraftPage, partyField: string): SlotSummary[] {
  const { ids } = useSlots(page)
  const snap = useSyncExternalStore(subscribe, () =>
    JSON.stringify(
      ids.map((id) => [localStorage.getItem(key(id, 'lines')), localStorage.getItem(key(id, partyField)), localStorage.getItem(key(id, 'edit'))]),
    ),
  )
  return useMemo(
    () =>
      (JSON.parse(snap) as [string | null, string | null, string | null][]).map(([l, p, e], i) => {
        let items = 0
        let party: string | null = null
        let editing: number | null = null
        try {
          const lines = JSON.parse(l ?? '[]')
          items = Array.isArray(lines) ? lines.length : 0
          party = (JSON.parse(p ?? 'null') as { name?: string } | null)?.name ?? null
          editing = (JSON.parse(e ?? 'null') as EditInfo | null)?.id ?? null
        } catch {
          /* ignore */
        }
        return { id: ids[i], items, party, editing }
      }),
    [snap, ids],
  )
}

/** Items on all open bills of a page, for the badges on the top buttons. */
export function useDraftItems(page: DraftPage) {
  return useSyncExternalStore(subscribe, () =>
    readSlots(page).ids.reduce((n, id) => {
      const lines = read<unknown[]>(key(id, 'lines'), [])
      return n + (Array.isArray(lines) ? lines.length : 0)
    }, 0),
  )
}

/** What a tab is editing: a saved bill (its number and what was already paid). */
export interface EditInfo {
  id: number
  paid: number
  /** products on the bill before editing (their stock changes too) */
  ids?: number[]
}

/**
 * Open a new tab filled with `values` (draft fields) — used to edit a saved bill.
 * If that bill is already open in a tab, just switch to it.
 */
export function openSlotWith(page: DraftPage, values: Record<string, unknown>) {
  const s = readSlots(page)
  const editId = (values.edit as EditInfo | undefined)?.id
  const already = editId != null && s.ids.find((id) => read<EditInfo | null>(key(id, 'edit'), null)?.id === editId)
  if (already) return switchSlot(page, already)
  // reuse the open tab if it is empty, otherwise add one
  const empty = s.ids.find((id) => !read<unknown[]>(key(id, 'lines'), []).length && !read(key(id, 'edit'), null))
  let id = empty
  if (!id) {
    let n = 2
    while (s.ids.includes(`${page}#${n}`)) n++
    id = `${page}#${n}`
  }
  forgetSlot(id)
  try {
    for (const [f, v] of Object.entries(values)) localStorage.setItem(key(id, f), JSON.stringify(v))
  } catch {
    /* ignore */
  }
  writeSlots(page, { ids: s.ids.includes(id) ? s.ids : [...s.ids, id], active: id })
}
