'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Search, Plus, Package, AlertTriangle, X, Barcode, UploadCloud, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { generateBinBarcode } from '@/lib/barcode'
import { useAdminContext } from '../admin-context'

type Product = {
  id: string
  name: string
  sku: string
  description: string | null
  price: number
  weight: number | null
  reorder_point: number
  image_url: string | null
  supplier: { name: string } | null
  inventory: { qty_available: number; qty_on_hand: number; qty_reserved: number; qty_damaged: number; bin: { location_code: string } | null }[]
  barcodes: { barcode: string; is_primary: boolean }[]
}

const emptyForm = {
  name: '',
  sku: '',
  description: '',
  price: '',
  weight: '',
  reorder_point: '0',
  barcode: '',
  bin_location: '',
  initial_stock: '0',
}

export default function InventoryPage() {
  const supabase = createClient()
  const { orgId, warehouseId } = useAdminContext()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'low' | 'out'>('all')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [pushingWix, setPushingWix] = useState<string | null>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  async function fetchProducts() {
    if (!orgId) { setLoading(false); return }

    const { data } = await supabase
      .from('products')
      .select('id, name, sku, description, price, weight, reorder_point, image_url, supplier:suppliers(name), inventory(qty_available, qty_on_hand, qty_reserved, qty_damaged, bin:bins(location_code)), barcodes:product_barcodes(barcode, is_primary)')
      .eq('org_id', orgId)
      .order('name')

    setProducts(data as unknown as Product[] || [])
    setLoading(false)
  }

  async function createProduct() {
    if (!form.name.trim() || !form.sku.trim()) { toast.error('Name and SKU are required'); return }
    if (!orgId) return
    setSaving(true)

    const { data: product, error } = await supabase.from('products').insert({
      org_id: orgId,
      warehouse_id: warehouseId,
      name: form.name.trim(),
      sku: form.sku.trim().toUpperCase(),
      description: form.description.trim() || null,
      price: parseFloat(form.price) || 0,
      weight: parseFloat(form.weight) || null,
      reorder_point: parseInt(form.reorder_point) || 0,
    }).select().single()

    if (error) {
      toast.error(error.message.includes('unique') ? 'SKU already exists' : error.message)
      setSaving(false)
      return
    }

    // Add barcode if provided
    if (form.barcode.trim()) {
      await supabase.from('product_barcodes').insert({
        product_id: product.id,
        org_id: orgId,
        barcode: form.barcode.trim(),
        is_primary: true,
      })
    }

    // Create or find bin and set initial stock
    if (parseInt(form.initial_stock) > 0) {
      let binId: string | null = null

      if (form.bin_location.trim()) {
        const { data: existingBin } = await supabase.from('bins').select('id').eq('warehouse_id', warehouseId).eq('location_code', form.bin_location.trim().toUpperCase()).single()
        if (existingBin) {
          binId = existingBin.id
        } else {
          const { data: newBin } = await supabase.from('bins').insert({
            warehouse_id: warehouseId,
            org_id: orgId,
            location_code: form.bin_location.trim().toUpperCase(),
            barcode: generateBinBarcode(form.bin_location.trim()),
          }).select().single()
          binId = newBin?.id || null
        }
      }

      const qty = parseInt(form.initial_stock)
      await supabase.from('inventory').insert({
        product_id: product.id,
        bin_id: binId,
        warehouse_id: warehouseId,
        org_id: orgId,
        qty_on_hand: qty,
        qty_available: qty,
        qty_reserved: 0,
        qty_picked: 0,
        qty_damaged: 0,
      })
    }

    toast.success('Product created')
    setForm(emptyForm)
    setShowForm(false)
    setSaving(false)
    fetchProducts()
  }

  async function adjustStock(productId: string, currentQty: number) {
    const input = window.prompt(`Current stock: ${currentQty}\nEnter adjustment (e.g. +10, -5, or 50 to set):`)
    if (input === null) return

    let newQty = currentQty
    if (input.startsWith('+')) newQty = currentQty + parseInt(input.slice(1))
    else if (input.startsWith('-')) newQty = currentQty - parseInt(input.slice(1))
    else newQty = parseInt(input)

    if (isNaN(newQty) || newQty < 0) { toast.error('Invalid quantity'); return }

    const { data: inv } = await supabase.from('inventory').select('id').eq('product_id', productId).eq('org_id', orgId).limit(1).single()

    if (inv) {
      await supabase.from('inventory').update({
        qty_on_hand: newQty,
        qty_available: Math.max(0, newQty - (0)),
        updated_at: new Date().toISOString(),
      }).eq('id', inv.id)

      await supabase.from('inventory_adjustments').insert({
        inventory_id: inv.id,
        product_id: productId,
        org_id: orgId,
        adjustment_type: 'adjust',
        qty_before: currentQty,
        qty_change: newQty - currentQty,
        qty_after: newQty,
        reason: 'Manual adjustment',
      })
    } else {
      // No inventory record yet — create one
      await supabase.from('inventory').insert({
        product_id: productId,
        org_id: orgId,
        warehouse_id: warehouseId,
        qty_on_hand: newQty,
        qty_available: newQty,
        qty_reserved: 0,
        qty_picked: 0,
        qty_damaged: 0,
      })
    }

    toast.success(`Stock updated to ${newQty}`)
    fetchProducts()
  }

  async function pushToWix(productId: string) {
    setPushingWix(productId)
    const res = await fetch('/api/integrations/wix/sync-inventory', { method: 'POST' })
    const d = await res.json()
    if (d.errors?.length) {
      toast.error(d.errors[0])
    } else if (d.synced > 0) {
      toast.success('Updated on Wix')
    } else {
      toast.error('Not mapped to Wix — run Map Products in Integrations first')
    }
    setPushingWix(null)
  }

  async function deleteProduct(id: string) {
    toast('Delete this product? This will also delete its inventory records.', {
      action: {
        label: 'Delete', onClick: async () => {
          const res = await fetch(`/api/products/${id}`, { method: 'DELETE' })
          if (res.ok) {
            toast.success('Product deleted')
            fetchProducts()
          } else {
            const d = await res.json()
            toast.error(d.error || 'Delete failed')
          }
        }
      },
      cancel: { label: 'Cancel', onClick: () => {} },
    })
  }

  useEffect(() => { fetchProducts() }, [orgId])

  function getTotalStock(p: Product) {
    return p.inventory.reduce((s, i) => s + i.qty_on_hand, 0)
  }
  function getAvailableStock(p: Product) {
    return p.inventory.reduce((s, i) => s + i.qty_available, 0)
  }
  function getBinLocations(p: Product) {
    return p.inventory.map(i => i.bin?.location_code).filter(Boolean).join(', ')
  }
  function getPrimaryBarcode(p: Product) {
    return p.barcodes.find(b => b.is_primary)?.barcode || p.barcodes[0]?.barcode || null
  }

  const filtered = products.filter(p => {
    const q = search.toLowerCase()
    const matchSearch = !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q)
    const stock = getTotalStock(p)
    const matchFilter = filter === 'all' ? true : filter === 'out' ? stock === 0 : stock > 0 && stock <= p.reorder_point
    return matchSearch && matchFilter
  })

  const lowStockCount = products.filter(p => { const s = getTotalStock(p); return s > 0 && s <= p.reorder_point }).length
  const outStockCount = products.filter(p => getTotalStock(p) === 0).length

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
          <p className="text-sm text-gray-500 mt-0.5">{products.length} SKUs · {lowStockCount > 0 && <span className="text-orange-500">{lowStockCount} low stock</span>}{lowStockCount > 0 && outStockCount > 0 && ' · '}{outStockCount > 0 && <span className="text-red-500">{outStockCount} out of stock</span>}</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          <Plus size={16} /> Add Product
        </button>
      </div>

      {/* Add product form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">New Product</h2>
            <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Product Name <span className="text-red-400">*</span></label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Blue Widget XL" autoFocus />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">SKU <span className="text-red-400">*</span></label>
              <input value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="BWX-001" />
            </div>
            <div className="col-span-3">
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Description</label>
              <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Optional description" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Price ($)</label>
              <input type="number" step="0.01" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="0.00" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Weight (lbs)</label>
              <input type="number" step="0.01" value={form.weight} onChange={e => setForm({ ...form, weight: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="0.00" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Reorder Point</label>
              <input type="number" value={form.reorder_point} onChange={e => setForm({ ...form, reorder_point: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="10" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Barcode / UPC</label>
              <input value={form.barcode} onChange={e => setForm({ ...form, barcode: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="012345678901" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Bin Location</label>
              <input value={form.bin_location} onChange={e => setForm({ ...form, bin_location: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="A-02-C" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Initial Stock Qty</label>
              <input type="number" value={form.initial_stock} onChange={e => setForm({ ...form, initial_stock: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="0" />
            </div>
            <div className="col-span-3 flex gap-3 justify-end pt-2">
              <button onClick={() => { setShowForm(false); setForm(emptyForm) }} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
              <button onClick={createProduct} disabled={saving} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                {saving ? 'Creating...' : 'Create Product'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Search by name, SKU..." value={search} onChange={e => setSearch(e.target.value)} className="w-full bg-white border border-gray-200 rounded-lg pl-9 pr-4 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1 shadow-sm">
          {(['all', 'low', 'out'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors ${filter === f ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-700'}`}>
              {f === 'low' ? 'Low Stock' : f === 'out' ? 'Out of Stock' : 'All'}
            </button>
          ))}
        </div>
      </div>

      {/* Product table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading inventory...</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <Package size={36} className="text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-gray-400">{search || filter !== 'all' ? 'No products match.' : 'No products yet. Add your first product.'}</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Product</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Barcode</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Location</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Stock</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Available</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(product => {
                const totalStock = getTotalStock(product)
                const availableStock = getAvailableStock(product)
                const isOut = totalStock === 0
                const isLow = !isOut && totalStock <= product.reorder_point
                const barcode = getPrimaryBarcode(product)
                const location = getBinLocations(product)

                return (
                  <tr key={product.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-gray-100 rounded-lg flex items-center justify-center shrink-0 overflow-hidden">
                          {product.image_url ? (
                            <img
                              src={product.image_url}
                              alt={product.name}
                              className="w-full h-full object-cover cursor-zoom-in"
                              onClick={() => setLightboxUrl(product.image_url)}
                            />
                          ) : (
                            <Package size={15} className="text-gray-400" />
                          )}
                        </div>
                        <div>
                          <a href={`/inventory/${product.id}`} className="text-sm font-medium text-gray-900 hover:text-blue-600 transition-colors">{product.name}</a>
                          <p className="text-xs text-gray-400">SKU: {product.sku}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-3.5">
                      {barcode ? (
                        <div className="flex items-center gap-1.5">
                          <Barcode size={12} className="text-gray-400" />
                          <code className="text-xs text-gray-600 font-mono">{barcode}</code>
                        </div>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-6 py-3.5">
                      {location ? (
                        <span className="text-xs bg-gray-100 text-gray-600 font-mono px-2 py-0.5 rounded">{location}</span>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-bold ${isOut ? 'text-red-600' : isLow ? 'text-orange-500' : 'text-gray-900'}`}>
                          {totalStock}
                        </span>
                        {(isOut || isLow) && (
                          <AlertTriangle size={13} className={isOut ? 'text-red-500' : 'text-orange-400'} />
                        )}
                      </div>
                      {product.reorder_point > 0 && (
                        <p className="text-xs text-gray-400">Reorder at {product.reorder_point}</p>
                      )}
                    </td>
                    <td className="px-6 py-3.5">
                      <span className={`text-sm font-semibold ${availableStock === 0 ? 'text-red-500' : 'text-green-600'}`}>
                        {availableStock}
                      </span>
                    </td>
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-3">
                        <button onClick={() => adjustStock(product.id, totalStock)} className="text-xs text-blue-600 hover:text-blue-700 font-medium">Adjust</button>
                        <a href={`/inventory/${product.id}`} className="text-xs text-gray-500 hover:text-gray-700 font-medium">Details</a>
                        <button onClick={() => pushToWix(product.id)} disabled={pushingWix === product.id} className="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-700 font-medium disabled:opacity-40">
                          {pushingWix === product.id ? <Loader2 size={10} className="animate-spin" /> : <UploadCloud size={11} />}
                          Update
                        </button>
                        <button onClick={() => deleteProduct(product.id)} className="text-xs text-red-400 hover:text-red-600 font-medium">Delete</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Image lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
          onClick={() => setLightboxUrl(null)}
        >
          <img
            src={lightboxUrl}
            alt="Product"
            className="max-w-full max-h-full rounded-xl shadow-2xl object-contain"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
