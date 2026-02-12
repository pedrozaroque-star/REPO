'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { Plus, Search, Tag, DollarSign, Scale, Box, Save, X } from 'lucide-react'

export default function InventoryItemsPage() {
    const [items, setItems] = useState<any[]>([])
    const [categories, setCategories] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState('')
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [saving, setSaving] = useState(false)

    // Form State
    const [newItem, setNewItem] = useState({
        name: '',
        sku: '',
        category_id: '',
        unit_type: 'pza',
        cost: '',
        yield_percent: '100',
        alert_threshold: ''
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

    async function handleSave() {
        if (!newItem.name || !newItem.category_id) {
            alert('Nombre y Categoría son requeridos.')
            return
        }

        setSaving(true)
        try {
            const res = await fetch('/api/inventory/items', {
                method: 'POST',
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
                name: '', sku: '', category_id: '', unit_type: 'pza', cost: '', yield_percent: '100', alert_threshold: ''
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

    return (
        <div className="p-8 max-w-7xl mx-auto">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Insumos (Ingredients)</h1>
                    <p className="text-slate-500">Define las materias primas que compras (Cajas, Bolsas, Unidades).</p>
                </div>
                <button
                    onClick={() => setIsModalOpen(true)}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 transition-all hover:scale-105 active:scale-95"
                >
                    <Plus size={20} />
                    Nuevo Insumo
                </button>
            </div>

            {/* Filters */}
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 mb-6 sticky top-0 z-10">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                    <input
                        type="text"
                        placeholder="Buscar por nombre, SKU o categoría..."
                        className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none transition-all"
                        value={filter}
                        onChange={e => setFilter(e.target.value)}
                    />
                </div>
            </div>

            {/* Grid of Items (Card View for Modern Look) */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {loading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="h-40 bg-slate-200 dark:bg-slate-800 rounded-xl animate-pulse"></div>
                    ))
                ) : filteredItems.length === 0 ? (
                    <div className="col-span-full py-12 text-center text-slate-500">
                        <Box size={48} className="mx-auto mb-4 opacity-20" />
                        <p>No se encontraron insumos. ¡Crea el primero!</p>
                    </div>
                ) : (
                    filteredItems.map(item => (
                        <div key={item.id} className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-5 hover:shadow-md transition-shadow group relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button className="text-slate-400 hover:text-indigo-500"><Tag size={16} /></button>
                            </div>

                            <div className="flex items-start justify-between mb-4">
                                <div>
                                    <span className="inline-block px-2 py-1 rounded text-xs font-semibold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 mb-2">
                                        {item.category?.name || 'Sin Categoría'}
                                    </span>
                                    <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 leading-tight mb-1">{item.name}</h3>
                                    {item.sku && <p className="text-xs font-mono text-slate-400">SKU: {item.sku}</p>}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4 text-sm border-t border-slate-100 dark:border-slate-700/50 pt-4">
                                <div>
                                    <p className="text-slate-400 text-xs mb-1">Unidad de Compra</p>
                                    <p className="font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                                        <Scale size={14} className="text-indigo-500" />
                                        {item.unit_type}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-slate-400 text-xs mb-1">Rendimiento</p>
                                    <p className={`font-medium flex items-center gap-1 ${Number(item.yield_percent) < 100 ? 'text-amber-500' : 'text-emerald-500'}`}>
                                        {Number(item.yield_percent)}%
                                    </p>
                                </div>
                                <div className="col-span-2">
                                    <p className="text-slate-400 text-xs mb-1">Costo Estimado</p>
                                    <p className="font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                                        <DollarSign size={14} className="text-emerald-500" />
                                        ${Number(item.purchase_unit_cost || 0).toFixed(2)} / {item.unit_type}
                                    </p>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-slate-800 w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden transform transition-all scale-100">
                        <div className="p-6 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
                            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Nuevo Insumo</h2>
                            <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                                <X size={24} />
                            </button>
                        </div>

                        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                            {/* Name */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nombre del Insumo *</label>
                                <input
                                    type="text"
                                    value={newItem.name}
                                    onChange={e => setNewItem({ ...newItem, name: e.target.value })}
                                    placeholder="Ej: Limón Persa (Caja 40lb)"
                                    className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none transition-shadow"
                                    autoFocus
                                />
                            </div>

                            {/* Category & SKU */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Categoría *</label>
                                    <select
                                        value={newItem.category_id}
                                        onChange={e => setNewItem({ ...newItem, category_id: e.target.value })}
                                        className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                    >
                                        <option value="">Seleccionar...</option>
                                        {categories.map(cat => (
                                            <option key={cat.id} value={cat.id}>{cat.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">SKU (Opcional)</label>
                                    <input
                                        type="text"
                                        value={newItem.sku}
                                        onChange={e => setNewItem({ ...newItem, sku: e.target.value })}
                                        placeholder="Código Proveedor"
                                        className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                    />
                                </div>
                            </div>

                            {/* Unit & Yield */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Unidad de Compra *</label>
                                    <select
                                        value={newItem.unit_type}
                                        onChange={e => setNewItem({ ...newItem, unit_type: e.target.value })}
                                        className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                    >
                                        <option value="lb">Libras (lb)</option>
                                        <option value="oz">Onzas (oz)</option>
                                        <option value="kg">Kilogramos (kg)</option>
                                        <option value="g">Gramos (g)</option>
                                        <option value="gal">Galones (gal)</option>
                                        <option value="l">Litros (l)</option>
                                        <option value="pza">Pieza (pza)</option>
                                        <option value="caja">Caja (box/case)</option>
                                        <option value="paq">Paquete (pack)</option>
                                        <option value="bto">Bulto (bag)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Rendimiento (%)</label>
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
                            </div>

                            {/* Cost */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Costo Estimado (Última Compra)</label>
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
                            </div>
                        </div>

                        <div className="p-6 border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50 flex justify-end gap-3">
                            <button
                                onClick={() => setIsModalOpen(false)}
                                className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors font-medium text-sm"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-md transition-all hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 font-medium text-sm"
                            >
                                {saving ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Guardando...</> : <><Save size={18} /> Guardar Insumo</>}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
