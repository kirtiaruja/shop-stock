import { Plus, X } from 'lucide-react'
import { addSlot, closeSlot, switchSlot, useSlots, useSlotSummaries, type DraftPage } from '../lib/draft'

/** Tabs for several bills open at once ("hold" a bill and start the next one). */
export default function BillTabs({ page, partyField }: { page: DraftPage; partyField: string }) {
  const { active } = useSlots(page)
  const bills = useSlotSummaries(page, partyField)
  const noun = page === 'sale' ? 'Bill' : 'Purchase'

  const close = (id: string, items: number, n: number, editing: number | null) => {
    if (items > 0 && !confirm(`Close ${noun.toLowerCase()} ${n}? Its ${items} item${items === 1 ? '' : 's'} will be removed.${editing ? ' The saved bill stays as it was.' : ''}`)) return
    closeSlot(page, id)
  }

  return (
    <div className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label={`Open ${noun.toLowerCase()}s`}>
      {bills.map((b, i) => {
        const on = b.id === active
        const many = bills.length > 1
        return (
          <div
            key={b.id}
            className={`flex shrink-0 items-center rounded-lg border text-sm ${on ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
          >
            <button role="tab" aria-selected={on} onClick={() => switchSlot(page, b.id)} className="flex items-center gap-1.5 py-1.5 pl-3 pr-2">
              <span className="font-medium">{b.editing ? `Edit #${b.editing}` : `${noun} ${i + 1}`}</span>
              {b.party && <span className={`max-w-28 truncate ${on ? 'text-indigo-100' : 'text-slate-500'}`}>· {b.party}</span>}
              <span className={`rounded-full px-1.5 text-xs ${on ? 'bg-white/20' : 'bg-slate-100 text-slate-600'}`}>{b.items}</span>
            </button>
            {many && (
              <button
                onClick={() => close(b.id, b.items, i + 1, b.editing)}
                className={`mr-1 rounded p-0.5 ${on ? 'hover:bg-white/20' : 'text-slate-400 hover:bg-slate-200'}`}
                aria-label={`Close ${noun.toLowerCase()} ${i + 1}`}
                title="Close this bill"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )
      })}
      <button
        onClick={() => addSlot(page)}
        className="flex shrink-0 items-center gap-1 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:border-indigo-400 hover:text-indigo-700"
        title={`Keep this ${noun.toLowerCase()} open and start another`}
      >
        <Plus className="h-4 w-4" /> New {noun.toLowerCase()}
      </button>
    </div>
  )
}
