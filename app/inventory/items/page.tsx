'use client'

import { useState, useEffect } from 'react'
import { useLanguage } from '@/lib/i18n'
import { createBrowserClient } from '@supabase/ssr'
import { Plus, Search, Tag, DollarSign, Scale, Box, Save, X, ArrowUpDown, ArrowUp, ArrowDown, RefreshCw } from 'lucide-react'

export default function InventoryItemsPage() {
    const { t } = useLanguage()
    const [items, setItems] = useState<any[]>([])
    const [categories, setCategories] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState('')
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [syncing, setSyncing] = useState(false)
    const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>({ key: 'purchase_unit_cost', direction: 'desc' })

    // Form State
    const [newItem, setNewItem] = useState({
        id: '', // Added ID for editing
        name: '',
        sku: '',
        category_id: '',
        unit_type: 'Case', // Default to Case
        quantity_per_unit: '1',
        unit_measure: 'pza',
        cost: '',
        yield_percent: '100',
        alert_threshold: '',
        is_bodega: false
    })

    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    useEffect(() => {
        fetchData()
    }, [])

    async function fetchData() {
        setLoading(true)
        try {
            const res = await fetch('/api/inventory/items')
            if (!res.ok) throw new Error('Error fetching items')
            const data = await res.json()
            setItems(data.items || [])
            setCategories(data.categories || [])
        } catch (e) {
            console.error(e)
        } finally {
            setLoading(false)
        }
    }

    async function handleSync() {
        setSyncing(true)
        try {
            const res = await fetch('/api/inventory/sync-quickbooks', { method: 'POST' })
            if (!res.ok) throw new Error('Error en la sincronización')
            const data = await res.json()
            alert(`Sincronización exitosa: ${data.updatedCount} actualizados y ${data.createdCount} nuevos creados.`)
            fetchData()
        } catch (e: any) {
            alert(`Error: ${e.message}`)
        } finally {
            setSyncing(false)
        }
    }

    async function handleSave() {
        if (!newItem.name || !newItem.category_id) {
            alert('Nombre y Categoría son requeridos.')
            return
        }

        setSaving(true)
        try {
            const method = newItem.id ? 'PUT' : 'POST' // Update if ID exists
            const res = await fetch('/api/inventory/items', {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newItem)
            })

            if (!res.ok) {
                const err = await res.json()
                throw new Error(err.error || 'Error saving')
            }

            // Success
            setIsModalOpen(false)
            setNewItem({
                id: '', name: '', sku: '', category_id: '', unit_type: 'Case', quantity_per_unit: '1', unit_measure: 'pza', cost: '', yield_percent: '100', alert_threshold: '', is_bodega: false
            })
            fetchData() // Refresh list
        } catch (e: any) {
            alert(`Error: ${e.message}`)
        } finally {
            setSaving(false)
        }
    }

    const filteredItems = items.filter(i =>
        i.name.toLowerCase().includes(filter.toLowerCase()) ||
        i.sku?.toLowerCase().includes(filter.toLowerCase()) ||
        i.category?.name?.toLowerCase().includes(filter.toLowerCase())
    )

    // Sorting Logic
    const sortedItems = [...filteredItems].sort((a, b) => {
        if (!sortConfig) return 0
        const { key, direction } = sortConfig

        let valA: any
        let valB: any

        // Mapeo de columnas especiales
        if (key === 'category') {
            valA = a.category?.name
            valB = b.category?.name
        } else if (key === 'unitCost') {
            valA = (Number(a.purchase_unit_cost || 0) / (Number(a.quantity_per_unit) || 1))
            valB = (Number(b.purchase_unit_cost || 0) / (Number(b.quantity_per_unit) || 1))
        } else {
            valA = a[key]
            valB = b[key]
        }

        // Handle numeric strings (force number comparison if looks like number)
        if (!isNaN(Number(valA)) && !isNaN(Number(valB)) && valA !== '' && valB !== '') {
            valA = Number(valA)
            valB = Number(valB)
        }

        // Handle string comparison (case insensitive)
        if (typeof valA === 'string') valA = valA.toLowerCase()
        if (typeof valB === 'string') valB = valB.toLowerCase()

        if (valA < valB) return direction === 'asc' ? -1 : 1
        if (valA > valB) return direction === 'asc' ? 1 : -1
        return 0
    })

    const requestSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'asc'
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc'
        }
        setSortConfig({ key, direction })
    }

    const SortIcon = ({ columnKey }: { columnKey: string }) => {
        if (sortConfig?.key !== columnKey) return <ArrowUpDown size={14} className="ml-1 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
        return sortConfig.direction === 'asc'
            ? <ArrowUp size={14} className="ml-1 text-indigo-500" />
            : <ArrowDown size={14} className="ml-1 text-indigo-500" />
    }

    const openEdit = (item: any) => {
        setNewItem({
            id: item.id,
            name: item.name,
            sku: item.sku || '',
            category_id: item.category_id,
            unit_type: item.unit_type || 'Case',
            quantity_per_unit: item.quantity_per_unit || '1',
            unit_measure: item.unit_measure || 'pza',
            cost: item.purchase_unit_cost || '',
            yield_percent: item.yield_percent || '100',
            alert_threshold: item.alert_threshold || '',
            is_bodega: item.is_bodega || false
        })
        setIsModalOpen(true)
    }

    const openCreate = () => {
        setNewItem({
            id: '', name: '', sku: '', category_id: '', unit_type: 'Case', quantity_per_unit: '1', unit_measure: 'pza', cost: '', yield_percent: '100', alert_threshold: '', is_bodega: false
        })
        setIsModalOpen(true)
    }

    return (
        <div className="p-8 max-w-7xl mx-auto">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Ingredients</h1>
                    <p className="text-slate-500">Define the raw materials you purchase (Cases, Bags, Units).</p>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={handleSync}
                        disabled={syncing}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
                    >
                        {syncing ? <RefreshCw size={20} className="animate-spin" /> : <RefreshCw size={20} />}
                        Sync with Intuit QuickBooks
                    </button>
                    <button
                        onClick={openCreate}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 transition-all hover:scale-105 active:scale-95"
                    >
                        <Plus size={20} />
                        New Item
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 mb-6 sticky top-0 z-10">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                    <input
                        type="text"
                        placeholder="Search by name, SKU, or category..."
                        className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none transition-all"
                        value={filter}
                        onChange={e => setFilter(e.target.value)}
                    />
                </div>
            </div>

            {/* Table View */}
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50 dark:bg-slate-900/50 text-xs uppercase tracking-wider text-slate-500 font-semibold border-b border-slate-200 dark:border-slate-700 select-none">
                                <th
                                    className="px-4 py-3 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group"
                                    onClick={() => requestSort('name')}
                                >
                                    <div className="flex items-center">Item <SortIcon columnKey="name" /></div>
                                </th>
                                <th
                                    className="px-4 py-3 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group"
                                    onClick={() => requestSort('category')}
                                >
                                    <div className="flex items-center">Category <SortIcon columnKey="category" /></div>
                                </th>
                                <th
                                    className="px-4 py-3 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group"
                                    onClick={() => requestSort('unit_type')}
                                >
                                    <div className="flex items-center">Presentation <SortIcon columnKey="unit_type" /></div>
                                </th>
                                <th
                                    className="px-4 py-3 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group"
                                    onClick={() => requestSort('is_bodega')}
                                >
                                    <div className="flex items-center">Type <SortIcon columnKey="is_bodega" /></div>
                                </th>
                                <th
                                    className="px-4 py-3 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group text-right"
                                    onClick={() => requestSort('purchase_unit_cost')}
                                >
                                    <div className="flex items-center justify-end">Purchase Cost <SortIcon columnKey="purchase_unit_cost" /></div>
                                </th>
                                <th
                                    className="px-4 py-3 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group text-right"
                                    onClick={() => requestSort('unitCost')}
                                >
                                    <div className="flex items-center justify-end">Unit Cost <SortIcon columnKey="unitCost" /></div>
                                </th>
                                <th
                                    className="px-4 py-3 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group text-center"
                                    onClick={() => requestSort('yield_percent')}
                                >
                                    <div className="flex items-center justify-center">Yield <SortIcon columnKey="yield_percent" /></div>
                                </th>
                                <th className="px-4 py-3 text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-700 text-sm">
                            {loading ? (
                                <tr>
                                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                                        <div className="flex flex-col items-center justify-center gap-2">
                                            <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-600 rounded-full animate-spin" />
                                            <span>Loading items...</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : sortedItems.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                                        <Box size={48} className="mx-auto mb-2 opacity-20" />
                                        <p>No items found.</p>
                                    </td>
                                </tr>
                            ) : (
                                sortedItems.map(item => (
                                    <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors group">
                                        <td className="px-4 py-3">
                                            <div className="font-medium text-slate-900 dark:text-slate-100">{item.name}</div>
                                            {item.sku && <div className="text-xs text-slate-400 font-mono">SKU: {item.sku}</div>}
                                        </td>
                                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                                            {item.category?.name || '-'}
                                        </td>
                                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                                            {item.quantity_per_unit || 1} {item.unit_measure || 'pza'} <span className="text-slate-400">({item.unit_type})</span>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            {item.is_bodega ? (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800 uppercase tracking-widest">
                                                    Warehouse
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 border border-blue-200 dark:border-blue-800 uppercase tracking-widest">
                                                    Restaurant
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-right font-medium text-slate-700 dark:text-slate-200">
                                            ${Number(item.purchase_unit_cost || 0).toFixed(2)}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <span className="font-mono text-xs text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">
                                                ${(Number(item.purchase_unit_cost || 0) / (Number(item.quantity_per_unit) || 1)).toFixed(3)} / {item.unit_measure || 'pza'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${Number(item.yield_percent) < 100
                                                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                                                : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                                }`}>
                                                {Number(item.yield_percent)}%
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <button
                                                onClick={() => openEdit(item)}
                                                className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded transition-colors"
                                                title="Edit"
                                            >
                                                <Tag size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-slate-800 w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden transform transition-all scale-100">
                        <div className="p-6 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
                            <h2 className="text-xl font-bold text-slate-900 dark:text-white">{newItem.id ? t('Edit Item') : t('New Item')}</h2>
                            <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                                <X size={24} />
                            </button>
                        </div>

                        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                            {/* Name */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Item Name *</label>
                                <input
                                    type="text"
                                    value={newItem.name}
                                    onChange={e => setNewItem({ ...newItem, name: e.target.value })}
                                    placeholder="Ej: Limón Persa (Caja 40lb)"
                                    className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none transition-shadow"
                                    autoFocus
                                />
                            </div>

                            {/* Category & SKU & Bodega */}
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Category *</label>
                                    <select
                                        value={newItem.category_id}
                                        onChange={e => setNewItem({ ...newItem, category_id: e.target.value })}
                                        className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                    >
                                        <option value="">Select...</option>
                                        {categories.map(cat => (
                                            <option key={cat.id} value={cat.id}>{cat.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">SKU (Optional)</label>
                                    <input
                                        type="text"
                                        value={newItem.sku}
                                        onChange={e => setNewItem({ ...newItem, sku: e.target.value })}
                                        placeholder="Vendor Code"
                                        className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Item Purpose</label>
                                    <label className="flex items-center gap-3 p-2 mt-1 border border-slate-200 dark:border-slate-700 rounded-lg cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                                        <input
                                            type="checkbox"
                                            checked={newItem.is_bodega}
                                            onChange={e => setNewItem({ ...newItem, is_bodega: e.target.checked })}
                                            className="w-5 h-5 rounded border-slate-300 text-amber-600 focus:ring-amber-600"
                                        />
                                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                            {newItem.is_bodega ? '📦 Warehouse Item' : '🍽️ Restaurant Item'}
                                        </span>
                                    </label>
                                </div>
                            </div>

                            {/* Unit & Yield */}
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Purchase Type</label>
                                    <input
                                        type="text"
                                        list="containers"
                                        value={newItem.unit_type}
                                        onChange={e => setNewItem({ ...newItem, unit_type: e.target.value })}
                                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                        placeholder="Ej: Case"
                                    />
                                    <datalist id="containers">
                                        <option value="Case" />
                                        <option value="Box" />
                                        <option value="Bag" />
                                        <option value="Each" />
                                        <option value="Pack" />
                                    </datalist>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Quantity</label>
                                    <input
                                        type="number"
                                        value={newItem.quantity_per_unit}
                                        onChange={e => setNewItem({ ...newItem, quantity_per_unit: e.target.value })}
                                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                        placeholder="1"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Base Unit</label>
                                    <select
                                        value={newItem.unit_measure}
                                        onChange={e => setNewItem({ ...newItem, unit_measure: e.target.value })}
                                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                    >
                                        <option value="lb">lb (Libras)</option>
                                        <option value="oz">oz (Onzas)</option>
                                        <option value="kg">kg (Kiles)</option>
                                        <option value="g">g (Gramos)</option>
                                        <option value="gal">gal (Galones)</option>
                                        <option value="l">l (Litros)</option>
                                        <option value="pza">pza (Piezas/Count)</option>
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Yield (%)</label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            value={newItem.yield_percent}
                                            onChange={e => setNewItem({ ...newItem, yield_percent: e.target.value })}
                                            min="1" max="100"
                                            className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none pr-8"
                                        />
                                        <span className="absolute right-3 top-2 text-slate-400">%</span>
                                    </div>
                                    <p className="text-[10px] text-slate-400 mt-1">Ej: Aguacate limpio = 85.0%</p>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Estimated Cost (Per {newItem.unit_type})</label>
                                    <div className="relative">
                                        <span className="absolute left-3 top-2 text-slate-400">$</span>
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={newItem.cost}
                                            onChange={e => setNewItem({ ...newItem, cost: e.target.value })}
                                            placeholder="0.00"
                                            className="w-full pl-8 pr-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                        />
                                    </div>
                                    <p className="text-[10px] text-emerald-600 mt-1 font-bold">
                                        = ${(Number(newItem.cost || 0) / (Number(newItem.quantity_per_unit) || 1)).toFixed(3)} / {newItem.unit_measure}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="p-6 border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50 flex justify-end gap-3">
                            <button
                                onClick={() => setIsModalOpen(false)}
                                className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors font-medium text-sm"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-md transition-all hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 font-medium text-sm"
                            >
                                {saving ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving...</> : <><Save size={18} /> Save Item</>}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
