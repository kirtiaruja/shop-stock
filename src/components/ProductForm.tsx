import { useEffect, useState } from 'react'
import { supabase, errMsg, type Product } from '../lib/supabase'
import { Camera } from 'lucide-react'
import { Button, Field, Input, Modal, Select, useToast } from './ui'
import CameraScanner from './CameraScanner'
import { beep } from '../lib/beep'

type FormState = Record<keyof Omit<Product, 'id'>, string>

const empty: FormState = {
  name: '',
  item_code: '',
  category: '',
  hsn: '',
  mrp: '',
  sale_price: '',
  purchase_price: '',
  online_price: '',
  discount_type: 'Discount %',
  sale_discount: '0',
  stock: '0',
  min_stock: '0',
  location: '',
  tax_rate: '',
  inclusive_of_tax: 'false',
  base_unit: '',
  secondary_unit: '',
  conversion_rate: '',
}

const toForm = (p: Product): FormState =>
  Object.fromEntries(Object.keys(empty).map((k) => [k, p[k as keyof Product] == null ? '' : String(p[k as keyof Product])])) as FormState

const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v))
const textOrNull = (v: string) => (v.trim() === '' ? null : v.trim())

export default function ProductForm({
  open,
  onClose,
  onSaved,
  editing,
  initialCode = '',
}: {
  open: boolean
  onClose: () => void
  onSaved: (p: Product) => void
  editing?: Product | null
  initialCode?: string
}) {
  const toast = useToast()
  const [f, setF] = useState<FormState>(empty)
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [camera, setCamera] = useState(false)

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setF(editing ? toForm(editing) : { ...empty, item_code: initialCode })
      setMore(false)
    }
  }, [open, editing, initialCode])

  const set = (k: keyof FormState) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }))

  const save = async () => {
    if (!f.name.trim()) return toast('Item name is required', false)
    if (f.sale_price.trim() === '') return toast('Sale price is required', false)
    const row = {
      name: f.name.trim(),
      item_code: textOrNull(f.item_code),
      category: textOrNull(f.category),
      hsn: textOrNull(f.hsn),
      mrp: numOrNull(f.mrp),
      sale_price: Number(f.sale_price) || 0,
      purchase_price: Number(f.purchase_price) || 0,
      online_price: f.online_price.trim() === '' ? Number(f.sale_price) || 0 : Number(f.online_price),
      discount_type: f.discount_type || 'Discount %',
      sale_discount: Number(f.sale_discount) || 0,
      stock: Number(f.stock) || 0,
      min_stock: Number(f.min_stock) || 0,
      location: textOrNull(f.location),
      tax_rate: textOrNull(f.tax_rate),
      inclusive_of_tax: f.inclusive_of_tax === 'true',
      base_unit: textOrNull(f.base_unit),
      secondary_unit: textOrNull(f.secondary_unit),
      conversion_rate: numOrNull(f.conversion_rate),
      updated_at: new Date().toISOString(),
    }
    setBusy(true)
    const res = editing
      ? await supabase.from('products').update(row).eq('id', editing.id).select().single()
      : await supabase.from('products').insert(row).select().single()
    setBusy(false)
    if (res.error) {
      const m = errMsg(res.error)
      if (m.includes('products_item_code_key')) return toast('Another product already has this item code', false)
      if (m.includes('products_name_key')) return toast('Another product already has this name', false)
      return toast(m, false)
    }
    toast(editing ? 'Product updated' : 'Product added')
    onSaved(res.data as Product)
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit product' : 'Add product'} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Item name *">
            <Input autoFocus value={f.name} onChange={set('name')} />
          </Field>
        </div>
        <Field label="Item code / barcode" hint="Scan the barcode into this box">
          <div className="flex gap-2">
            <Input value={f.item_code} onChange={set('item_code')} onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()} />
            <Button variant="secondary" className="shrink-0 px-3" onClick={() => setCamera(true)} title="Scan with camera">
              <Camera className="h-4 w-4" />
            </Button>
          </div>
          <CameraScanner
            open={camera}
            continuous={false}
            title="Scan the item's barcode"
            onClose={() => setCamera(false)}
            onDetect={(code) => {
              beep(true)
              setF((s) => ({ ...s, item_code: code }))
            }}
          />
        </Field>
        <Field label="Category">
          <Input value={f.category} onChange={set('category')} />
        </Field>
        <Field label="Sale price *">
          <Input type="number" inputMode="decimal" value={f.sale_price} onChange={set('sale_price')} />
        </Field>
        <Field label="Purchase price">
          <Input type="number" inputMode="decimal" value={f.purchase_price} onChange={set('purchase_price')} />
        </Field>
        <Field label="MRP">
          <Input type="number" inputMode="decimal" value={f.mrp} onChange={set('mrp')} />
        </Field>
        <Field label={editing ? 'Current stock' : 'Opening stock'} hint={editing ? 'Changing this adjusts stock directly' : undefined}>
          <Input type="number" inputMode="decimal" value={f.stock} onChange={set('stock')} />
        </Field>
        <Field label="Minimum stock" hint="Shows as low stock at or below this">
          <Input type="number" inputMode="decimal" value={f.min_stock} onChange={set('min_stock')} />
        </Field>
        <Field label="Base unit">
          <Input value={f.base_unit} onChange={set('base_unit')} placeholder="PIECES, BOX…" list="units" />
          <datalist id="units">
            <option value="PIECES" />
            <option value="BOX" />
          </datalist>
        </Field>
      </div>

      <button className="mt-4 text-sm font-medium text-indigo-600" onClick={() => setMore(!more)}>
        {more ? 'Hide' : 'Show'} more fields (HSN, tax, online price, discount, units…)
      </button>
      {more && (
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field label="HSN">
            <Input value={f.hsn} onChange={set('hsn')} />
          </Field>
          <Field label="Online store price">
            <Input type="number" inputMode="decimal" value={f.online_price} onChange={set('online_price')} placeholder="Same as sale price" />
          </Field>
          <Field label="Discount type">
            <Select value={f.discount_type} onChange={set('discount_type')}>
              <option>Discount %</option>
              <option>Discount Amount</option>
            </Select>
          </Field>
          <Field label="Sale discount">
            <Input type="number" inputMode="decimal" value={f.sale_discount} onChange={set('sale_discount')} />
          </Field>
          <Field label="Tax rate">
            <Input value={f.tax_rate} onChange={set('tax_rate')} placeholder="GST@5%" list="taxes" />
            <datalist id="taxes">
              {['GST@0%', 'GST@5%', 'GST@12%', 'GST@18%', 'GST@28%'].map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </Field>
          <Field label="Inclusive of tax">
            <Select value={f.inclusive_of_tax} onChange={set('inclusive_of_tax')}>
              <option value="false">No</option>
              <option value="true">Yes</option>
            </Select>
          </Field>
          <Field label="Item location">
            <Input value={f.location} onChange={set('location')} />
          </Field>
          <Field label="Secondary unit">
            <Input value={f.secondary_unit} onChange={set('secondary_unit')} />
          </Field>
          <Field label="Conversion rate (base = n × secondary)">
            <Input type="number" inputMode="decimal" value={f.conversion_rate} onChange={set('conversion_rate')} />
          </Field>
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button loading={busy} onClick={save}>
          Save product
        </Button>
      </div>
    </Modal>
  )
}
