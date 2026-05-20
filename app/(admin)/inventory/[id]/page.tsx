'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft, AlertTriangle, Plus, Minus, Edit2, Save, X, Barcode, MapPin, Camera, Loader2, Package, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAdminContext } from '../../admin-context'

type Product = {
  id: string
  name: string
  sku: string
  description: string | null
  price: number | null
  weight: number | null
  reorder_point: number | null
  image_url: string | null
}

type InventoryRecord = {
  id: string
  qty_on_hand: number
  qty_available: number
  qty_reserved: number
  qty_picked: number
  qty_damaged: number
  bins: { location_code: string; id: string } | null
}

type ProductBarcode = {
  id: string
  barcode: string
  is_primary: boolean
}

type AdjustmentRecord = {
  id: string
  adjustment_type: string
  qty_change: number
  reason: string | null
  created_at: string
  workers: { name: string } | null
}

type Component = {
  sub_product_id: string
  quantity: number
  name: string
  sku: string
  image_url: string | null
}

type SubProduct = {
  id: string
  name: string
  sku: string
  image_url: string | null
}

export default function InventoryDetailPage() {
  const supabase = createClient()
  const params = useParams()
  const router = useRouter()
  const productId = params.id as string
  const { orgId, warehouseId } = useAdminContext()
  const photoInputRef = useRef<HTMLInputElement>(null)

  const [product, setProduct] = useState<Product | null>(null)
  const [inventory, setInventory] = useState<InventoryRecord | null>(null)
  const [barcodes, setBarcodes] = useState<ProductBarcode[]>([])
  const [adjustments, setAdjustments] = useState<AdjustmentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', sku: '', description: '', price: '', weight: '', reorder_point: '', bin_location: '' })
  const [saving, setSaving] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [newBarcode, setNewBarcode] = useState('')
  const [addingBarcode, setAddingBarcode] = useState(false)
  const [components, setComponents] = useState<Component[]>([])
  const [subProducts, setSubProducts] = useState<SubProduct[]>([])
  const [addingComponent, setAddingComponent] = useState(false)
  const [componentSearch, setComponentSearch] = useState('')
  const [componentQty, setComponentQty] = useState('1')
  const [selectedSubProduct, setSelectedSubProduct] = useState<SubProduct | null>(null)
  const [savingComponent, setSavingComponent] = useState(false)

  async function fetchComponents() {
    const res = await fetch(`/api/products/${productId}/components`)
    if (res.ok) setComponents(await res.json())
  }

  async function fetchSubProducts() {
    const res = await fetch('/api/products/sub-products')
    if (res.ok) setSubProducts(await res.json())
  }

  async function addComponent() {
    if (!selectedSubProduct || !componentQty) return
    const qty = parseInt(componentQty)
    if (isNaN(qty) || qty < 1) { toast.error('Invalid quantity'); return }
    setSavingComponent(true)
    const res = await fetch(`/api/products/${productId}/components`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sub_product_id: selectedSubProduct.id, quantity: qty }),
    })
    if (!res.ok) {
      const d = await res.json()
      toast.error(d.error || 'Failed to add component')
    } else {
      toast.success(`${selectedSubProduct.name} added to recipe`)
      setAddingComponent(false)
      setSelectedSubProduct(null)
      setComponentSearch('')
      setComponentQty('1')
      fetchComponents()
    }
    setSavingComponent(false)
  }

  async function removeComponent(subProductId: string, name: string) {
    const res = await fetch(`/api/products/${productId}/components`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sub_product_id: subProductId }),
    })
    if (!res.ok) {
      toast.error('Failed to remove component')
    } else {
      toast.success(`${name} removed from recipe`)
      fetchComponents()
    }
  }

  async function updateComponentQty(subProductId: string, quantity: number) {
    if (quantity < 1) return
    const res = await fetch(`/api/products/${productId}/components`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sub_product_id: subProductId, quantity }),
    })
    if (!res.ok) toast.error('Failed to update quantity')
    else fetchComponents()
  }

  async function fetchProduct() {
    if (!orgId) { setLoading(false); return }

    const [{ data: prodData }, { data: invData }, { data: barcodeData }, { data: adjData }] = await Promise.all([
      supabase.from('products').select('id, name, sku, description, price, weight, reorder_point, image_url').eq('id', productId).single(),
      supabase.from('inventory').select('id, qty_on_hand, qty_available, qty_reserved, qty_picked, qty_damaged, bins(id, location_code)').eq('product_id', productId).eq('org_id', orgId).single(),
      supabase.from('product_barcodes').select('id, barcode, is_primary').eq('product_id', productId).order('is_primary', { ascending: false }),
      supabase.from('inventory_adjustments').select('id, adjustment_type, qty_change, reason, created_at, workers(name)').eq('product_id', productId).eq('org_id', orgId).order('created_at', { ascending: false }).limit(20),
    ])

    const inv = invData as unknown as InventoryRecord | null

    if (prodData) {
      setProduct(prodData)
      setEditForm({
        name: prodData.name,
        sku: prodData.sku,
        description: prodData.description || '',
        price: prodData.price?.toString() || '',
        weight: prodData.weight?.toString() || '',
        reorder_point: prodData.reorder_point?.toString() || '',
        bin_location: inv?.bins?.location_code || '',
      })
    }
    setInventory(inv)
    setBarcodes(barcodeData || [])
    setAdjustments(adjData as unknown as AdjustmentRecord[] || [])
    setLoading(false)
  }

  async function saveProduct() {
    if (!product || !editForm.name.trim() || !editForm.sku.trim()) { toast.error('Name and SKU are required'); return }
    setSaving(true)

    const { error } = await supabase.from('products').update({
      name: editForm.name.trim(),
      sku: editForm.sku.trim(),
      description: editForm.description || null,
      price: editForm.price ? parseFloat(editForm.price) : null,
      weight: editForm.weight ? parseFloat(editForm.weight) : null,
      reorder_point: editForm.reorder_point ? parseInt(editForm.reorder_point) : null,
    }).eq('id', productId)

    if (error) { toast.error(error.message); setSaving(false); return }

    // Update product local state immediately
    setProduct(prev => prev ? {
      ...prev,
      name: editForm.name.trim(),
      sku: editForm.sku.trim(),
      description: editForm.description || null,
      price: editForm.price ? parseFloat(editForm.price) : null,
      weight: editForm.weight ? parseFloat(editForm.weight) : null,
      reorder_point: editForm.reorder_point ? parseInt(editForm.reorder_point) : null,
    } : prev)

    // Update bin location if changed
    const newBinLocation = editForm.bin_location.trim().toUpperCase()
    const currentBinLocation = inventory?.bins?.location_code || ''
    if (inventory && newBinLocation !== currentBinLocation) {
      if (!newBinLocation) {
        await supabase.from('inventory').update({ bin_id: null }).eq('id', inventory.id)
        setInventory(prev => prev ? { ...prev, bins: null } : prev)
      } else {
        const { data: existingBin } = await supabase.from('bins').select('id').eq('warehouse_id', warehouseId).eq('location_code', newBinLocation).single()
        let binId = existingBin?.id
        if (!binId) {
          const { data: newBin, error: binError } = await supabase.from('bins').insert({
            warehouse_id: warehouseId,
            org_id: orgId,
            location_code: newBinLocation,
          }).select('id').single()
          if (binError) toast.error('Bin error: ' + binError.message)
          binId = newBin?.id
        }
        if (binId) {
          await supabase.from('inventory').update({ bin_id: binId }).eq('id', inventory.id)
          setInventory(prev => prev ? { ...prev, bins: { id: binId!, location_code: newBinLocation } } : prev)
        }
      }
    }

    toast.success('Product updated')
    setSaving(false)
    setEditing(false)
  }

  async function uploadPhoto(file: File) {
    if (!orgId) return
    setUploadingPhoto(true)
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const path = `${orgId}/${productId}.${ext}`

    const { error: uploadError } = await supabase.storage.from('product-images').upload(path, file, { upsert: true })
    if (uploadError) { toast.error(uploadError.message); setUploadingPhoto(false); return }

    const { data: { publicUrl } } = supabase.storage.from('product-images').getPublicUrl(path)

    const { error: updateError } = await supabase.from('products').update({ image_url: publicUrl }).eq('id', productId)
    if (updateError) { toast.error(updateError.message); setUploadingPhoto(false); return }

    // Update local state immediately with cache-busting timestamp
    setProduct(prev => prev ? { ...prev, image_url: publicUrl + '?t=' + Date.now() } : prev)
    toast.success('Photo uploaded')
    setUploadingPhoto(false)
  }

  async function removePhoto() {
    await supabase.from('products').update({ image_url: null }).eq('id', productId)
    setProduct(prev => prev ? { ...prev, image_url: null } : prev)
    toast.success('Photo removed')
  }

  async function adjustStock(type: 'add' | 'remove' | 'set') {
    if (!inventory || !orgId) return
    const input = window.prompt(
      type === 'add' ? 'How many to add?' :
      type === 'remove' ? 'How many to remove?' :
      'Set stock to what quantity?'
    )
    if (input === null) return
    const qty = parseInt(input)
    if (isNaN(qty) || qty < 0) { toast.error('Invalid quantity'); return }

    let newQtyOnHand = inventory.qty_on_hand
    let qtyChange = qty
    if (type === 'add') newQtyOnHand += qty
    else if (type === 'remove') { newQtyOnHand = Math.max(0, inventory.qty_on_hand - qty); qtyChange = -qty }
    else { qtyChange = qty - inventory.qty_on_hand; newQtyOnHand = qty }

    const newAvailable = Math.max(0, newQtyOnHand - inventory.qty_reserved - inventory.qty_picked)
    const reason = window.prompt('Reason (optional):') || null

    await supabase.from('inventory').update({ qty_on_hand: newQtyOnHand, qty_available: newAvailable }).eq('id', inventory.id)
    await supabase.from('inventory_adjustments').insert({
      org_id: orgId,
      product_id: productId,
      inventory_id: inventory.id,
      adjustment_type: type === 'add' ? 'manual_add' : type === 'remove' ? 'manual_remove' : 'manual_set',
      qty_before: inventory.qty_on_hand,
      qty_after: newQtyOnHand,
      qty_change: qtyChange,
      reason,
    })

    toast.success('Stock updated')
    fetchProduct()
  }

  async function addBarcode() {
    if (!newBarcode.trim()) return
    const { error } = await supabase.from('product_barcodes').insert({
      product_id: productId,
      org_id: orgId,
      barcode: newBarcode.trim(),
      is_primary: barcodes.length === 0,
    })
    if (error) { toast.error(error.message); return }
    toast.success('Barcode added')
    setNewBarcode('')
    setAddingBarcode(false)
    fetchProduct()
  }

  async function removeBarcode(id: string) {
    await supabase.from('product_barcodes').delete().eq('id', id)
    toast.success('Barcode removed')
    fetchProduct()
  }

  async function setPrimaryBarcode(id: string) {
    await supabase.from('product_barcodes').update({ is_primary: false }).eq('product_id', productId)
    await supabase.from('product_barcodes').update({ is_primary: true }).eq('id', id)
    toast.success('Primary barcode updated')
    fetchProduct()
  }

  useEffect(() => {
    fetchProduct()
    fetchComponents()
    fetchSubProducts()
  }, [productId, orgId])

  if (loading) return <div className="p-6 text-sm text-gray-400">Loading...</div>
  if (!product) return <div className="p-6 text-sm text-red-500">Product not found.</div>

  const isLowStock = inventory && inventory.qty_available <= (product.reorder_point || 0) && inventory.qty_available > 0
  const isOutOfStock = inventory && inventory.qty_available <= 0

  return (
    <div className="p-6 max-w-3xl">
      {/* Back + header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.push('/inventory')} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">{product.name}</h1>
          <p className="text-sm text-gray-400 font-mono mt-0.5">SKU: {product.sku}</p>
        </div>
        {!editing ? (
          <button onClick={() => setEditing(true)} className="flex items-center gap-2 text-sm text-gray-600 border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50 transition-colors">
            <Edit2 size={14} /> Edit
          </button>
        ) : (
          <div className="flex gap-2">
            <button onClick={() => setEditing(false)} className="text-sm text-gray-500 px-3 py-2"><X size={14} /></button>
            <button onClick={saveProduct} disabled={saving} className="flex items-center gap-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-2 disabled:opacity-50">
              <Save size={14} /> {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        {/* Stock card */}
        <div className={`col-span-1 bg-white rounded-xl border shadow-sm p-5 ${isOutOfStock ? 'border-red-200' : isLowStock ? 'border-yellow-200' : 'border-gray-100'}`}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Stock</span>
            {(isLowStock || isOutOfStock) && (
              <AlertTriangle size={14} className={isOutOfStock ? 'text-red-500' : 'text-yellow-500'} />
            )}
          </div>
          <p className={`text-4xl font-bold mb-1 ${isOutOfStock ? 'text-red-600' : isLowStock ? 'text-yellow-600' : 'text-gray-900'}`}>
            {inventory?.qty_available ?? 0}
          </p>
          <p className="text-xs text-gray-400">available</p>
          <div className="mt-3 space-y-1 text-xs text-gray-400">
            <div className="flex justify-between"><span>On hand</span><span className="font-medium text-gray-700">{inventory?.qty_on_hand ?? 0}</span></div>
            <div className="flex justify-between"><span>Reserved</span><span className="font-medium text-gray-700">{inventory?.qty_reserved ?? 0}</span></div>
            <div className="flex justify-between"><span>Picked</span><span className="font-medium text-gray-700">{inventory?.qty_picked ?? 0}</span></div>
            {(inventory?.qty_damaged ?? 0) > 0 && (
              <div className="flex justify-between text-red-400"><span>Damaged</span><span className="font-medium">{inventory?.qty_damaged}</span></div>
            )}
          </div>
          <div className="mt-4 flex gap-1.5">
            <button onClick={() => adjustStock('add')} className="flex-1 flex items-center justify-center gap-1 text-xs bg-green-50 hover:bg-green-100 text-green-700 rounded-lg py-1.5 transition-colors">
              <Plus size={12} /> Add
            </button>
            <button onClick={() => adjustStock('remove')} className="flex-1 flex items-center justify-center gap-1 text-xs bg-red-50 hover:bg-red-100 text-red-600 rounded-lg py-1.5 transition-colors">
              <Minus size={12} /> Remove
            </button>
            <button onClick={() => adjustStock('set')} className="flex-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg py-1.5 transition-colors">
              Set
            </button>
          </div>
        </div>

        {/* Product info */}
        <div className="col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-4">Product Details</h3>
          {editing ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Name</label>
                  <input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">SKU</label>
                  <input value={editForm.sku} onChange={e => setEditForm({ ...editForm, sku: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Price ($)</label>
                  <input type="number" value={editForm.price} onChange={e => setEditForm({ ...editForm, price: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Weight (lbs)</label>
                  <input type="number" value={editForm.weight} onChange={e => setEditForm({ ...editForm, weight: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Reorder Point</label>
                  <input type="number" value={editForm.reorder_point} onChange={e => setEditForm({ ...editForm, reorder_point: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Bin Location</label>
                  <div className="relative">
                    <MapPin size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      value={editForm.bin_location}
                      onChange={e => setEditForm({ ...editForm, bin_location: e.target.value.toUpperCase() })}
                      placeholder="e.g. A1-01"
                      className="w-full border border-gray-200 rounded-lg pl-7 pr-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Description</label>
                <textarea value={editForm.description} onChange={e => setEditForm({ ...editForm, description: e.target.value })} rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-y-3 gap-x-6 text-sm">
              {product.description && <div className="col-span-2"><p className="text-xs text-gray-400 mb-0.5">Description</p><p className="text-gray-700">{product.description}</p></div>}
              {product.price !== null && <div><p className="text-xs text-gray-400 mb-0.5">Price</p><p className="font-medium text-gray-900">${product.price.toFixed(2)}</p></div>}
              {product.weight !== null && <div><p className="text-xs text-gray-400 mb-0.5">Weight</p><p className="font-medium text-gray-900">{product.weight} lbs</p></div>}
              {product.reorder_point !== null && <div><p className="text-xs text-gray-400 mb-0.5">Reorder Point</p><p className="font-medium text-gray-900">{product.reorder_point} units</p></div>}
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Bin Location</p>
                {inventory?.bins ? (
                  <div className="flex items-center gap-1.5">
                    <MapPin size={12} className="text-gray-400" />
                    <p className="font-mono font-medium text-gray-900">{inventory.bins.location_code}</p>
                  </div>
                ) : (
                  <p className="text-gray-400 text-xs">Not assigned</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Photos */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Camera size={16} className="text-gray-400" />
            <h3 className="font-semibold text-gray-900 text-sm">Photos</h3>
          </div>
          <button
            onClick={() => photoInputRef.current?.click()}
            disabled={uploadingPhoto}
            className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 disabled:opacity-50"
          >
            {uploadingPhoto ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            {uploadingPhoto ? 'Uploading...' : product.image_url ? 'Replace' : 'Upload'}
          </button>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); e.target.value = '' }}
          />
        </div>

        {product.image_url ? (
          <div className="relative group w-40">
            <img src={product.image_url} alt={product.name} className="w-40 h-40 object-cover rounded-lg border border-gray-100" />
            <button
              onClick={removePhoto}
              className="absolute top-1.5 right-1.5 bg-white border border-gray-200 rounded-full p-1 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50 hover:border-red-200"
            >
              <X size={12} className="text-gray-500 hover:text-red-500" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => photoInputRef.current?.click()}
            className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-gray-200 rounded-lg text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors"
          >
            <Camera size={20} className="mb-1.5" />
            <span className="text-xs">Click to upload a photo</span>
          </button>
        )}
      </div>

      {/* Barcodes */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Barcode size={16} className="text-gray-400" />
            <h3 className="font-semibold text-gray-900 text-sm">Barcodes</h3>
          </div>
          <button onClick={() => setAddingBarcode(!addingBarcode)} className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1">
            <Plus size={12} /> Add
          </button>
        </div>

        {addingBarcode && (
          <div className="flex gap-2 mb-3">
            <input
              value={newBarcode}
              onChange={e => setNewBarcode(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addBarcode() }}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Scan or type barcode..."
              autoFocus
            />
            <button onClick={addBarcode} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700">Add</button>
            <button onClick={() => { setAddingBarcode(false); setNewBarcode('') }} className="text-gray-400 hover:text-gray-600 px-2"><X size={14} /></button>
          </div>
        )}

        {barcodes.length === 0 ? (
          <p className="text-sm text-gray-400">No barcodes yet. Add one to enable scanning this product.</p>
        ) : (
          <div className="space-y-2">
            {barcodes.map(bc => (
              <div key={bc.id} className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2">
                <span className="font-mono text-sm text-gray-800 flex-1">{bc.barcode}</span>
                {bc.is_primary && <span className="text-xs bg-blue-100 text-blue-600 font-medium px-2 py-0.5 rounded-full">Primary</span>}
                {!bc.is_primary && (
                  <button onClick={() => setPrimaryBarcode(bc.id)} className="text-xs text-gray-400 hover:text-blue-600 transition-colors">Set Primary</button>
                )}
                <button onClick={() => removeBarcode(bc.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bundle Recipe */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Package size={16} className="text-gray-400" />
            <h3 className="font-semibold text-gray-900 text-sm">Bundle Recipe</h3>
            {components.length > 0 && (
              <span className="text-xs bg-purple-100 text-purple-600 font-medium px-2 py-0.5 rounded-full">{components.length} items</span>
            )}
          </div>
          <button
            onClick={() => { setAddingComponent(!addingComponent); setSelectedSubProduct(null); setComponentSearch(''); setComponentQty('1') }}
            className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
          >
            <Plus size={12} /> Add sub-product
          </button>
        </div>

        {addingComponent && (
          <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
            <p className="text-xs text-gray-500 mb-2 font-medium">Search sub-products</p>
            {!selectedSubProduct ? (
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  autoFocus
                  value={componentSearch}
                  onChange={e => setComponentSearch(e.target.value)}
                  placeholder="Search by name or SKU..."
                  className="w-full border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {componentSearch && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-md max-h-48 overflow-y-auto">
                    {subProducts
                      .filter(sp =>
                        (sp.name.toLowerCase().includes(componentSearch.toLowerCase()) ||
                         sp.sku.toLowerCase().includes(componentSearch.toLowerCase())) &&
                        !components.some(c => c.sub_product_id === sp.id)
                      )
                      .map(sp => (
                        <button
                          key={sp.id}
                          onClick={() => { setSelectedSubProduct(sp); setComponentSearch('') }}
                          className="w-full flex items-center gap-3 px-3 py-2 hover:bg-blue-50 text-left"
                        >
                          {sp.image_url ? (
                            <img src={sp.image_url} alt={sp.name} className="w-8 h-8 object-cover rounded border border-gray-100 shrink-0" />
                          ) : (
                            <div className="w-8 h-8 rounded bg-gray-100 border border-gray-200 shrink-0 flex items-center justify-center">
                              <Package size={12} className="text-gray-400" />
                            </div>
                          )}
                          <div>
                            <p className="text-sm font-medium text-gray-900">{sp.name}</p>
                            <p className="text-xs text-gray-400 font-mono">{sp.sku}</p>
                          </div>
                        </button>
                      ))
                    }
                    {subProducts.filter(sp =>
                      (sp.name.toLowerCase().includes(componentSearch.toLowerCase()) ||
                       sp.sku.toLowerCase().includes(componentSearch.toLowerCase())) &&
                      !components.some(c => c.sub_product_id === sp.id)
                    ).length === 0 && (
                      <p className="text-sm text-gray-400 px-3 py-2">No sub-products found</p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-3">
                {selectedSubProduct.image_url ? (
                  <img src={selectedSubProduct.image_url} alt={selectedSubProduct.name} className="w-10 h-10 object-cover rounded border border-gray-100 shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded bg-gray-100 border border-gray-200 shrink-0 flex items-center justify-center">
                    <Package size={14} className="text-gray-400" />
                  </div>
                )}
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">{selectedSubProduct.name}</p>
                  <p className="text-xs text-gray-400 font-mono">{selectedSubProduct.sku}</p>
                </div>
                <button onClick={() => setSelectedSubProduct(null)} className="text-gray-400 hover:text-gray-600">
                  <X size={14} />
                </button>
              </div>
            )}

            {selectedSubProduct && (
              <div className="mt-3 flex items-center gap-2">
                <label className="text-xs text-gray-500">Quantity per bundle:</label>
                <input
                  type="number"
                  min="1"
                  value={componentQty}
                  onChange={e => setComponentQty(e.target.value)}
                  className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={addComponent}
                  disabled={savingComponent}
                  className="flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-1.5 disabled:opacity-50 ml-auto"
                >
                  {savingComponent ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                  Add to recipe
                </button>
                <button onClick={() => { setAddingComponent(false); setSelectedSubProduct(null); setComponentSearch(''); setComponentQty('1') }} className="text-gray-400 hover:text-gray-600">
                  <X size={14} />
                </button>
              </div>
            )}
          </div>
        )}

        {components.length === 0 ? (
          <p className="text-sm text-gray-400">No components yet. Add sub-products to define what makes up this bundle.</p>
        ) : (
          <div className="space-y-2">
            {components.map(c => (
              <div key={c.sub_product_id} className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2">
                {c.image_url ? (
                  <img src={c.image_url} alt={c.name} className="w-9 h-9 object-cover rounded border border-gray-100 shrink-0" />
                ) : (
                  <div className="w-9 h-9 rounded bg-gray-100 border border-gray-200 shrink-0 flex items-center justify-center">
                    <Package size={12} className="text-gray-400" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{c.name}</p>
                  <p className="text-xs text-gray-400 font-mono">{c.sku}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => updateComponentQty(c.sub_product_id, c.quantity - 1)}
                    disabled={c.quantity <= 1}
                    className="w-6 h-6 rounded border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                  >
                    <Minus size={10} />
                  </button>
                  <span className="w-8 text-center text-sm font-semibold text-gray-900">{c.quantity}</span>
                  <button
                    onClick={() => updateComponentQty(c.sub_product_id, c.quantity + 1)}
                    className="w-6 h-6 rounded border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-100"
                  >
                    <Plus size={10} />
                  </button>
                </div>
                <button
                  onClick={() => removeComponent(c.sub_product_id, c.name)}
                  className="text-gray-300 hover:text-red-500 transition-colors ml-1"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Adjustment history */}
      {adjustments.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h3 className="font-semibold text-gray-900 text-sm mb-4">Adjustment History</h3>
          <div className="divide-y divide-gray-50">
            {adjustments.map(adj => (
              <div key={adj.id} className="flex items-center gap-4 py-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${adj.qty_change > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                  {adj.qty_change > 0 ? '+' : ''}{adj.qty_change}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 capitalize">{adj.adjustment_type.replace('_', ' ')}</p>
                  {adj.reason && <p className="text-xs text-gray-400">{adj.reason}</p>}
                </div>
                <div className="text-right text-xs text-gray-400 shrink-0">
                  <p>{new Date(adj.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                  {adj.workers && <p>{adj.workers.name}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
