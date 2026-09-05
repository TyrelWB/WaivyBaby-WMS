'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Search, Plus, Package, AlertTriangle, X, Barcode, UploadCloud, Loader2, ChevronDown, Layers, Edit2, Camera, Trash2 } from 'lucide-react'
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
  is_sub_product: boolean
  supplier: { name: string } | null
  inventory: { qty_available: number; qty_on_hand: number; qty_reserved: number; qty_damaged: number; bin: { location_code: string } | null }[]
  barcodes: { barcode: string; is_primary: boolean }[]
}

type CollectionSubProductView = {
  id: string
  name: string
  sku: string
  image_url: string | null
  quantity: number
}

type CollectionProductView = {
  id: string
  name: string
  sku: string
  image_url: string | null
  quantity: number
  sub_products: CollectionSubProductView[]
}

type CollectionView = {
  id: string
  name: string
  sku: string
  image_url: string | null
  products: CollectionProductView[]
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
  const [tab, setTab] = useState<'products' | 'sub-products' | 'collections'>('products')
  const [subProductIds, setSubProductIds] = useState<Set<string>>(new Set())
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [pushingWix, setPushingWix] = useState<string | null>(null)
  const [syncingAllWix, setSyncingAllWix] = useState(false)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [collections, setCollections] = useState<CollectionView[]>([])
  const [loadingCollections, setLoadingCollections] = useState(false)
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(new Set())
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set())
  const [showCollectionForm, setShowCollectionForm] = useState(false)
  const [collectionName, setCollectionName] = useState('')
  const [collectionSku, setCollectionSku] = useState('')
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set())
  const [savingCollection, setSavingCollection] = useState(false)
  const [collectionProductIds, setCollectionProductIds] = useState<Set<string>>(new Set())
  const [addingToCollectionId, setAddingToCollectionId] = useState<string | null>(null)
  const [addingProductSelections, setAddingProductSelections] = useState<Set<string>>(new Set())
  const [savingAddProducts, setSavingAddProducts] = useState(false)
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null)
  const [editCollectionName, setEditCollectionName] = useState('')
  const [editCollectionSku, setEditCollectionSku] = useState('')
  const [savingCollectionEdit, setSavingCollectionEdit] = useState(false)
  const [uploadingCollectionPhoto, setUploadingCollectionPhoto] = useState<string | null>(null)

  async function fetchProducts() {
    setLoading(true)
    const [productsRes, collectionsRes] = await Promise.all([
      fetch('/api/products'),
      fetch('/api/collections'),
    ])
    if (productsRes.ok) setProducts(await productsRes.json() as Product[])
    if (collectionsRes.ok) {
      const cols: CollectionView[] = await collectionsRes.json()
      setCollections(cols)
      setCollectionProductIds(new Set(cols.map(c => c.id)))
    }
    setLoading(false)
  }

  async function createProduct() {
    if (!form.name.trim() || !form.sku.trim()) { toast.error('Name and SKU are required'); return }
    setSaving(true)

    const res = await fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name,
        sku: form.sku,
        description: form.description,
        price: form.price,
        weight: form.weight,
        reorder_point: form.reorder_point,
        barcode: form.barcode,
        bin_location: form.bin_location,
        initial_stock: form.initial_stock,
        is_sub_product: tab === 'sub-products',
      }),
    })

    const d = await res.json()
    if (!res.ok) {
      toast.error(d.error?.includes('unique') ? 'SKU already exists' : (d.error || 'Failed to create'))
      setSaving(false)
      return
    }

    toast.success('Product created')
    setForm(emptyForm)
    setShowForm(false)
    setSaving(false)
    fetchProducts()
    fetchSubProductIds()
  }

  async function adjustStock(productId: string, currentQty: number) {
    const input = window.prompt(`Current stock: ${currentQty}\nEnter adjustment (e.g. +10, -5, or 50 to set):`)
    if (input === null) return

    let qtyChange: number
    if (input.startsWith('+')) qtyChange = parseInt(input.slice(1))
    else if (input.startsWith('-')) qtyChange = -parseInt(input.slice(1))
    else qtyChange = parseInt(input) - currentQty

    if (isNaN(qtyChange)) { toast.error('Invalid quantity'); return }

    const res = await fetch(`/api/products/${productId}/adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qty_change: qtyChange, movement_type: 'adjust', note: 'Manual adjustment' }),
    })

    if (!res.ok) { const d = await res.json(); toast.error(d.error || 'Adjustment failed'); return }
    toast.success(`Stock updated — Wix synced`)
    fetchProducts()
  }

  async function syncAllToWix() {
    setSyncingAllWix(true)
    const res = await fetch('/api/integrations/wix/sync-inventory', { method: 'POST' })
    const d = await res.json()
    if (d.errors?.length) {
      toast.error(d.errors[0])
    } else if (d.synced > 0) {
      toast.success(`Synced ${d.synced} products to Wix`)
    } else {
      toast.error('No products mapped to Wix — run Map Products in Integrations first')
    }
    setSyncingAllWix(false)
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

  async function addProductsToCollection(collectionId: string) {
    if (addingProductSelections.size === 0) { toast.error('Select at least one product'); return }
    setSavingAddProducts(true)
    await Promise.all([...addingProductSelections].map(pid =>
      fetch(`/api/products/${collectionId}/components`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sub_product_id: pid, quantity: 1 }),
      })
    ))
    toast.success('Products added to collection')
    setAddingToCollectionId(null)
    setAddingProductSelections(new Set())
    setSavingAddProducts(false)
    fetchCollections()
  }

  async function saveCollectionEdit(collectionId: string) {
    if (!editCollectionName.trim()) { toast.error('Name required'); return }
    if (!editCollectionSku.trim()) { toast.error('SKU required'); return }
    setSavingCollectionEdit(true)
    const res = await fetch(`/api/products/${collectionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editCollectionName, sku: editCollectionSku }),
    })
    if (res.ok) {
      toast.success('Collection updated')
      setEditingCollectionId(null)
      fetchCollections()
    } else {
      const d = await res.json()
      toast.error(d.error || 'Failed to update')
    }
    setSavingCollectionEdit(false)
  }

  async function uploadCollectionPhoto(collectionId: string, file: File) {
    setUploadingCollectionPhoto(collectionId)
    const ext = file.name.split('.').pop()
    const path = `collections/${collectionId}.${ext}`
    const { error: uploadError } = await supabase.storage.from('product-images').upload(path, file, { upsert: true })
    if (uploadError) { toast.error(uploadError.message); setUploadingCollectionPhoto(null); return }
    const { data: { publicUrl } } = supabase.storage.from('product-images').getPublicUrl(path)
    await fetch(`/api/products/${collectionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: publicUrl }),
    })
    toast.success('Photo uploaded')
    setUploadingCollectionPhoto(null)
    fetchCollections()
  }

  async function fetchCollections() {
    setLoadingCollections(true)
    const res = await fetch('/api/collections')
    if (res.ok) {
      const data: CollectionView[] = await res.json()
      setCollections(data)
      setCollectionProductIds(new Set(data.map(c => c.id)))
    }
    setLoadingCollections(false)
  }

  async function createCollection() {
    if (!collectionName.trim() || !collectionSku.trim()) { toast.error('Name and SKU required'); return }
    setSavingCollection(true)

    const res = await fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: collectionName,
        sku: collectionSku,
        price: 0,
        reorder_point: 0,
        link_product_ids: [...selectedProductIds],
      }),
    })

    const d = await res.json()
    if (!res.ok) {
      toast.error(d.error?.includes('unique') ? 'SKU already exists' : (d.error || 'Failed to create'))
      setSavingCollection(false)
      return
    }

    toast.success('Collection created')
    setCollectionName('')
    setCollectionSku('')
    setSelectedProductIds(new Set())
    setShowCollectionForm(false)
    setSavingCollection(false)
    fetchCollections()
  }

  async function fetchSubProductIds() {
    const res = await fetch('/api/products/sub-product-ids')
    if (res.ok) {
      const ids: string[] = await res.json()
      setSubProductIds(new Set(ids))
    }
  }

  useEffect(() => {
    fetchProducts()
    fetchSubProductIds()
  }, [orgId])

  useEffect(() => {
    if (tab === 'collections') fetchCollections()
  }, [tab, orgId])

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

  const nonSubProducts = products.filter(p => !subProductIds.has(p.id) && !collectionProductIds.has(p.id))
  const subProducts = products.filter(p => subProductIds.has(p.id))
  const tabProducts = tab === 'sub-products' ? subProducts : nonSubProducts

  const filtered = tabProducts.filter(p => {
    const q = search.toLowerCase()
    const matchSearch = !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q)
    const stock = getTotalStock(p)
    const matchFilter = filter === 'all' ? true : filter === 'out' ? stock === 0 : stock > 0 && stock <= p.reorder_point
    return matchSearch && matchFilter
  })

  const lowStockCount = tabProducts.filter(p => { const s = getTotalStock(p); return s > 0 && s <= p.reorder_point }).length
  const outStockCount = tabProducts.filter(p => getTotalStock(p) === 0).length

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Inventory</h1>
          <p className="text-sm text-gray-500 mt-0.5">{tabProducts.length} SKUs · {lowStockCount > 0 && <span className="text-orange-500">{lowStockCount} low stock</span>}{lowStockCount > 0 && outStockCount > 0 && ' · '}{outStockCount > 0 && <span className="text-red-500">{outStockCount} out of stock</span>}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={syncAllToWix} disabled={syncingAllWix} className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">
            {syncingAllWix ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
            Sync All to Wix
          </button>
          {tab !== 'collections' && (
            <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 bg-cyan-500 hover:bg-cyan-600 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">
              <Plus size={16} /> {tab === 'sub-products' ? 'Add Sub-product' : 'Add Product'}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {(['products', 'sub-products', 'collections'] as const).map(t => (
          <button
            key={t}
            onClick={() => { setTab(t); setShowForm(false); setSearch(''); setFilter('all') }}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${tab === t ? 'border-cyan-500 text-cyan-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {t === 'sub-products' ? 'Sub-products' : t === 'collections' ? 'Collections' : 'Products'}
          </button>
        ))}
      </div>

      {/* Add product form */}
      {showForm && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">{tab === 'sub-products' ? 'New Sub-product' : 'New Product'}</h2>
            <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Product Name <span className="text-red-400">*</span></label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" placeholder="Blue Widget XL" autoFocus />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">SKU <span className="text-red-400">*</span></label>
              <input value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" placeholder="BWX-001" />
            </div>
            <div className="col-span-3">
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Description</label>
              <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" placeholder="Optional description" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Price ($)</label>
              <input type="number" step="0.01" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" placeholder="0.00" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Weight (lbs)</label>
              <input type="number" step="0.01" value={form.weight} onChange={e => setForm({ ...form, weight: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" placeholder="0.00" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Reorder Point</label>
              <input type="number" value={form.reorder_point} onChange={e => setForm({ ...form, reorder_point: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" placeholder="10" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Barcode / UPC</label>
              <input value={form.barcode} onChange={e => setForm({ ...form, barcode: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" placeholder="012345678901" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Bin Location</label>
              <input value={form.bin_location} onChange={e => setForm({ ...form, bin_location: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" placeholder="A-02-C" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Initial Stock Qty</label>
              <input type="number" value={form.initial_stock} onChange={e => setForm({ ...form, initial_stock: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" placeholder="0" />
            </div>
            <div className="col-span-3 flex gap-3 justify-end pt-2">
              <button onClick={() => { setShowForm(false); setForm(emptyForm) }} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
              <button onClick={createProduct} disabled={saving} className="bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">
                {saving ? 'Creating...' : 'Create Product'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Collections tab */}
      {tab === 'collections' && (
        <div className="space-y-3">
          {/* New collection form */}
          <div className="flex justify-end">
            <button onClick={() => setShowCollectionForm(!showCollectionForm)} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">
              <Plus size={16} /> New Collection
            </button>
          </div>

          {showCollectionForm && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-900">New Collection</h2>
                <button onClick={() => setShowCollectionForm(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
              </div>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Collection Name <span className="text-red-400">*</span></label>
                  <input value={collectionName} onChange={e => setCollectionName(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Essence Edition" autoFocus />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">SKU <span className="text-red-400">*</span></label>
                  <input value={collectionSku} onChange={e => setCollectionSku(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="ESS-EDITION" />
                </div>
              </div>
              {nonSubProducts.length > 0 && (
                <div className="mb-4">
                  <label className="block text-xs font-medium text-gray-500 mb-2">Select Products to include</label>
                  <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                    {nonSubProducts.map(p => (
                      <label key={p.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedProductIds.has(p.id)}
                          onChange={() => setSelectedProductIds(prev => {
                            const next = new Set(prev)
                            next.has(p.id) ? next.delete(p.id) : next.add(p.id)
                            return next
                          })}
                          className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <div className="w-7 h-7 bg-gray-100 rounded shrink-0 overflow-hidden">
                          {p.image_url ? <img src={p.image_url} className="w-full h-full object-cover" /> : <Package size={12} className="m-auto mt-1.5 text-gray-400" />}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-800">{p.name}</p>
                          <p className="text-xs text-gray-400">{p.sku}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                  {selectedProductIds.size > 0 && <p className="text-xs text-indigo-600 mt-1">{selectedProductIds.size} product{selectedProductIds.size !== 1 ? 's' : ''} selected</p>}
                </div>
              )}
              <div className="flex gap-3 justify-end">
                <button onClick={() => { setShowCollectionForm(false); setCollectionName(''); setCollectionSku(''); setSelectedProductIds(new Set()) }} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
                <button onClick={createCollection} disabled={savingCollection} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium">
                  {savingCollection ? 'Creating...' : 'Create Collection'}
                </button>
              </div>
            </div>
          )}

          {loadingCollections ? (
            <div className="p-8 text-center text-sm text-gray-400">Loading collections...</div>
          ) : collections.length === 0 ? (
            <div className="p-10 text-center bg-white rounded-2xl border border-gray-100 shadow-sm">
              <Layers size={36} className="text-gray-200 mx-auto mb-3" />
              <p className="text-sm text-gray-400">No collections found. Create a collection product and link products to it using the Products tab.</p>
            </div>
          ) : (
            collections.map(col => (
              <div key={col.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {/* Collection header */}
                <div className="flex items-center gap-4 px-6 py-4">
                  {/* Photo — click to upload */}
                  <label className="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center shrink-0 overflow-hidden cursor-pointer relative group">
                    {col.image_url
                      ? <img src={col.image_url} alt={col.name} className="w-full h-full object-cover" />
                      : uploadingCollectionPhoto === col.id
                        ? <Loader2 size={14} className="text-indigo-400 animate-spin" />
                        : <Layers size={16} className="text-indigo-400" />}
                    <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity rounded-lg">
                      <Camera size={12} className="text-white" />
                    </div>
                    <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadCollectionPhoto(col.id, f); e.target.value = '' }} />
                  </label>

                  {/* Name/SKU — click to edit */}
                  {editingCollectionId === col.id ? (
                    <div className="flex-1 flex items-center gap-2" onClick={e => e.stopPropagation()}>
                      <input
                        value={editCollectionName}
                        onChange={e => setEditCollectionName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveCollectionEdit(col.id); if (e.key === 'Escape') setEditingCollectionId(null) }}
                        placeholder="Name"
                        className="flex-1 border border-indigo-300 rounded-lg px-3 py-1.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        autoFocus
                      />
                      <input
                        value={editCollectionSku}
                        onChange={e => setEditCollectionSku(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveCollectionEdit(col.id); if (e.key === 'Escape') setEditingCollectionId(null) }}
                        placeholder="SKU"
                        className="w-28 border border-indigo-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 uppercase"
                      />
                      <button onClick={() => saveCollectionEdit(col.id)} disabled={savingCollectionEdit} className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50">
                        {savingCollectionEdit ? 'Saving...' : 'Save'}
                      </button>
                      <button onClick={() => setEditingCollectionId(null)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
                    </div>
                  ) : (
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpandedCollections(prev => { const next = new Set(prev); next.has(col.id) ? next.delete(col.id) : next.add(col.id); return next })}>
                      <p className="font-semibold text-gray-900">{col.name}</p>
                      <p className="text-xs text-gray-400">SKU: {col.sku} · {col.products.length} {col.products.length === 1 ? 'product' : 'products'}</p>
                    </div>
                  )}

                  <span className="text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full shrink-0">Collection</span>
                  {editingCollectionId !== col.id && (
                    <>
                      <button onClick={() => { setEditingCollectionId(col.id); setEditCollectionName(col.name); setEditCollectionSku(col.sku) }} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors shrink-0">
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => {
                          toast(`Delete "${col.name}"? This removes the collection but keeps the products inside.`, {
                            action: {
                              label: 'Delete',
                              onClick: async () => {
                                const res = await fetch(`/api/products/${col.id}`, { method: 'DELETE' })
                                if (res.ok) { toast.success('Collection deleted'); fetchCollections(); fetchProducts() }
                                else { const d = await res.json(); toast.error(d.error || 'Delete failed') }
                              },
                            },
                            cancel: { label: 'Cancel', onClick: () => {} },
                          })
                        }}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors shrink-0"
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                  <button onClick={() => setExpandedCollections(prev => { const next = new Set(prev); next.has(col.id) ? next.delete(col.id) : next.add(col.id); return next })} className="p-1 shrink-0">
                    <ChevronDown size={16} className={`text-gray-400 transition-transform ${expandedCollections.has(col.id) ? 'rotate-180' : ''}`} />
                  </button>
                </div>

                {/* Products */}
                {expandedCollections.has(col.id) && (
                  <div className="border-t border-gray-100">
                    {col.products.map((prod, pi) => (
                      <div key={prod.id} className={pi > 0 ? 'border-t border-gray-50' : ''}>
                        <button
                          onClick={() => setExpandedProducts(prev => {
                            const next = new Set(prev)
                            next.has(prod.id) ? next.delete(prod.id) : next.add(prod.id)
                            return next
                          })}
                          className="w-full flex items-center gap-3 px-6 py-3 pl-14 hover:bg-gray-50 transition-colors"
                        >
                          <div className="w-8 h-8 bg-cyan-50 rounded-md flex items-center justify-center shrink-0 overflow-hidden">
                            {prod.image_url
                              ? <img src={prod.image_url} alt={prod.name} className="w-full h-full object-cover" />
                              : <Package size={12} className="text-blue-400" />}
                          </div>
                          <div className="flex-1 text-left">
                            <p className="text-sm font-medium text-gray-800">{prod.name}</p>
                            <p className="text-xs text-gray-400">SKU: {prod.sku} · {prod.sub_products.length} sub-products</p>
                          </div>
                          <a
                            href={`/inventory/${prod.id}`}
                            onClick={e => e.stopPropagation()}
                            className="text-xs text-cyan-500 hover:text-cyan-600 mr-3"
                          >
                            Details
                          </a>
                          <ChevronDown size={14} className={`text-gray-400 transition-transform shrink-0 ${expandedProducts.has(prod.id) ? 'rotate-180' : ''}`} />
                        </button>

                        {/* Sub-products */}
                        {expandedProducts.has(prod.id) && prod.sub_products.length > 0 && (
                          <div className="bg-gray-50 border-t border-gray-100">
                            {prod.sub_products.map((sub, si) => (
                              <div key={sub.id} className={`flex items-center gap-3 px-6 py-2.5 pl-24 ${si > 0 ? 'border-t border-gray-100' : ''}`}>
                                <div className="w-7 h-7 bg-white border border-gray-200 rounded flex items-center justify-center shrink-0 overflow-hidden">
                                  {sub.image_url
                                    ? <img src={sub.image_url} alt={sub.name} className="w-full h-full object-cover" />
                                    : <Package size={10} className="text-gray-400" />}
                                </div>
                                <div className="flex-1">
                                  <p className="text-xs font-medium text-gray-700">{sub.name}</p>
                                  <p className="text-xs text-gray-400">SKU: {sub.sku}</p>
                                </div>
                                <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">×{sub.quantity}</span>
                                <a href={`/inventory/${sub.id}`} className="text-xs text-cyan-500 hover:text-cyan-600">Details</a>
                              </div>
                            ))}
                          </div>
                        )}
                        {expandedProducts.has(prod.id) && prod.sub_products.length === 0 && (
                          <div className="px-24 py-3 text-xs text-gray-400 bg-gray-50 border-t border-gray-100">No sub-products linked.</div>
                        )}
                      </div>
                    ))}

                    {/* Add products to collection */}
                    {addingToCollectionId === col.id ? (
                      <div className="border-t border-indigo-100 bg-indigo-50 p-4">
                        <p className="text-xs font-semibold text-indigo-700 mb-2">Select products to add:</p>
                        <div className="max-h-48 overflow-y-auto bg-white border border-indigo-200 rounded-lg divide-y divide-gray-100 mb-3">
                          {nonSubProducts.filter(p => !col.products.some(cp => cp.id === p.id)).map(p => (
                            <label key={p.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={addingProductSelections.has(p.id)}
                                onChange={() => setAddingProductSelections(prev => {
                                  const next = new Set(prev)
                                  next.has(p.id) ? next.delete(p.id) : next.add(p.id)
                                  return next
                                })}
                                className="rounded border-gray-300 text-indigo-600"
                              />
                              <div className="w-6 h-6 bg-gray-100 rounded shrink-0 overflow-hidden">
                                {p.image_url ? <img src={p.image_url} className="w-full h-full object-cover" /> : <Package size={10} className="m-auto mt-1 text-gray-400" />}
                              </div>
                              <div>
                                <p className="text-xs font-medium text-gray-800">{p.name}</p>
                                <p className="text-xs text-gray-400">{p.sku}</p>
                              </div>
                            </label>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => { setAddingToCollectionId(null); setAddingProductSelections(new Set()) }} className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-900">Cancel</button>
                          <button onClick={() => addProductsToCollection(col.id)} disabled={savingAddProducts} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-medium">
                            {savingAddProducts ? 'Adding...' : `Add ${addingProductSelections.size > 0 ? addingProductSelections.size + ' ' : ''}Product${addingProductSelections.size !== 1 ? 's' : ''}`}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="border-t border-gray-100 px-6 py-3">
                        <button
                          onClick={() => { setAddingToCollectionId(col.id); setExpandedCollections(prev => { const next = new Set(prev); next.add(col.id); return next }) }}
                          className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-700 font-medium"
                        >
                          <Plus size={13} /> Add Products
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Filters */}
      {tab !== 'collections' && <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Search by name, SKU..." value={search} onChange={e => setSearch(e.target.value)} className="w-full bg-white border border-gray-200 rounded-lg pl-9 pr-4 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" />
        </div>
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1 shadow-sm">
          {(['all', 'low', 'out'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors ${filter === f ? 'bg-cyan-500 text-white' : 'text-gray-500 hover:text-gray-700'}`}>
              {f === 'low' ? 'Low Stock' : f === 'out' ? 'Out of Stock' : 'All'}
            </button>
          ))}
        </div>
      </div>}

      {/* Product table */}
      {tab !== 'collections' && <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading inventory...</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <Package size={36} className="text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-gray-400">{search || filter !== 'all' ? 'No results match.' : tab === 'sub-products' ? 'No sub-products yet. Add your first sub-product.' : 'No products yet. Add your first product.'}</p>
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
                          <a href={`/inventory/${product.id}`} className="text-sm font-medium text-gray-900 hover:text-cyan-500 transition-colors">{product.name}</a>
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
                        <button onClick={() => adjustStock(product.id, totalStock)} className="text-xs text-cyan-500 hover:text-cyan-600 font-medium">Adjust</button>
                        <a href={`/inventory/${product.id}`} className="text-xs text-gray-500 hover:text-gray-700 font-medium">Details</a>
                        {!subProductIds.has(product.id) && (
                          <button onClick={() => pushToWix(product.id)} disabled={pushingWix === product.id} className="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-700 font-medium disabled:opacity-40">
                            {pushingWix === product.id ? <Loader2 size={10} className="animate-spin" /> : <UploadCloud size={11} />}
                            Update
                          </button>
                        )}
                        <button
                          onClick={async () => {
                            const is_sub_product = tab !== 'sub-products'
                            const res = await fetch(`/api/products/${product.id}/sub-product`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_sub_product }) })
                            if (!res.ok) { const d = await res.json(); toast.error(d.error || 'Failed to update'); return }
                            fetchSubProductIds()
                          }}
                          className="text-xs text-gray-400 hover:text-gray-600 font-medium"
                        >
                          {tab === 'sub-products' ? '→ Product' : '→ Sub-product'}
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
      </div>}

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
