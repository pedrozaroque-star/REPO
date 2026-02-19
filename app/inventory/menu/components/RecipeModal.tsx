'use client'

import { useState, useEffect } from 'react'
import { X, Plus, Trash2, Save, Search, AlertCircle } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface RecipeModalProps {
    isOpen: boolean
    onClose: () => void
    item: { guid: string, name: string } | null
    onSaveSuccess: () => void
}

// Helper for unit conversion (duplicated from page.tsx for safety)
function getConversionFactor(rUnit: string, iUnit: string): number {
    rUnit = rUnit?.toLowerCase()?.trim() || ''
    iUnit = iUnit?.toLowerCase()?.trim() || ''
    if (rUnit === iUnit) return 1

    // Weight
    if (rUnit === 'oz' && iUnit === 'lb') return 1 / 16
    if (rUnit === 'lb' && iUnit === 'oz') return 16
    if (rUnit === 'g' && iUnit === 'kg') return 1 / 1000
    if (rUnit === 'kg' && iUnit === 'g') return 1000
    // Volume
    if (rUnit === 'ml' && iUnit === 'l') return 1 / 1000
    if (rUnit === 'l' && iUnit === 'ml') return 1000
    if ((rUnit === 'gal' || rUnit === 'gallon') && (iUnit === 'oz' || iUnit === 'fl oz')) return 128
    if ((rUnit === 'oz' || rUnit === 'fl oz') && (iUnit === 'gal' || iUnit === 'gallon')) return 1 / 128

    // Count
    if (rUnit === 'dz' && (iUnit === 'pza' || iUnit === 'unit')) return 12

    return 1
}

export function RecipeModal({ isOpen, onClose, item, onSaveSuccess }: RecipeModalProps) {
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [ingredients, setIngredients] = useState<any[]>([]) // Current recipe ingredients
    const [availableItems, setAvailableItems] = useState<any[]>([]) // All inventory items for dropdown

    // For search/add
    const [searchTerm, setSearchTerm] = useState('')

    useEffect(() => {
        if (isOpen && item) {
            fetchData()
        }
    }, [isOpen, item])

    async function fetchData() {
        setLoading(true)
        try {
            // 1. Load available inventory items
            const resItems = await fetch('/api/inventory/items')
            const dataItems = await resItems.json()
            setAvailableItems(dataItems.items || [])

            // 2. Load existing recipe
            const resRecipe = await fetch(`/api/inventory/recipes?guid=${item?.guid}`)
            const dataRecipe = await resRecipe.json()

            // Map to local state
            const loadedIngredients = (dataRecipe || []).map((r: any) => ({
                inventory_item_id: r.inventory_item.id,
                name: r.inventory_item.name,
                unit_type: r.inventory_item.unit_type,
                quantity: r.quantity,
                unit: r.unit,
                // Cost Data
                purchase_unit_cost: r.inventory_item.purchase_unit_cost,
                quantity_per_unit: r.inventory_item.quantity_per_unit,
                unit_measure: r.inventory_item.unit_measure,
                yield_percent: r.inventory_item.yield_percent
            }))

            setIngredients(loadedIngredients)

        } catch (e) {
            console.error(e)
            alert('Error cargando datos')
        } finally {
            setLoading(false)
        }
    }

    function addIngredient(invItem: any) {
        // Check if already exists
        if (ingredients.find(i => i.inventory_item_id === invItem.id)) {
            alert('Este ingrediente ya está en la receta.')
            return
        }

        setIngredients([...ingredients, {
            inventory_item_id: invItem.id,
            name: invItem.name,
            unit_type: invItem.unit_type,
            quantity: 1, // default
            unit: invItem.unit_type, // default to buy unit
            // Cost Data
            purchase_unit_cost: invItem.purchase_unit_cost,
            quantity_per_unit: invItem.quantity_per_unit,
            unit_measure: invItem.unit_measure,
            yield_percent: invItem.yield_percent
        }])
        setSearchTerm('')
    }

    function removeIngredient(index: number) {
        const newIngs = [...ingredients]
        newIngs.splice(index, 1)
        setIngredients(newIngs)
    }

    function updateIngredient(index: number, field: string, value: any) {
        const newIngs = [...ingredients]
        newIngs[index] = { ...newIngs[index], [field]: value }
        setIngredients(newIngs)
    }

    async function handleSave() {
        setSaving(true)
        try {
            const payload = {
                toast_guid: item?.guid,
                ingredients: ingredients.map(i => ({
                    inventory_item_id: i.inventory_item_id,
                    quantity: Number(i.quantity),
                    unit: i.unit
                }))
            }

            const res = await fetch('/api/inventory/recipes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })

            if (!res.ok) throw new Error('Failed to save')

            onSaveSuccess()
            onClose()
        } catch (e) {
            alert('Error guardando receta')
        } finally {
            setSaving(false)
        }
    }

    // Filter available items based on search
    const searchResults = searchTerm
        ? availableItems.filter(i => i.name.toLowerCase().includes(searchTerm.toLowerCase()))
        : []

    if (!isOpen || !item) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white dark:bg-slate-800 w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col max-h-[90vh]"
            >
                {/* Header */}
                <div className="p-6 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex justify-between items-start">
                    <div>
                        <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            🧾 Receta: <span className="text-indigo-600 dark:text-indigo-400">{item.name}</span>
                        </h2>
                        <p className="text-sm text-slate-500 mt-1">Define qué ingredientes componen este producto.</p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                        <X size={24} />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {loading ? (
                        <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>
                    ) : (
                        <>
                            {/* Search Box */}
                            <div className="relative">
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Agregar Insumo</label>
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                    <input
                                        type="text"
                                        placeholder="Buscar insumo (ej: Carne, Tomate)..."
                                        value={searchTerm}
                                        onChange={e => setSearchTerm(e.target.value)}
                                        className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                    />
                                </div>

                                {/* Autocomplete Results */}
                                {searchResults.length > 0 && (
                                    <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl z-20 max-h-48 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700/50">
                                        {searchResults.map(res => (
                                            <button
                                                key={res.id}
                                                onClick={() => addIngredient(res)}
                                                className="w-full text-left px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 flex justify-between items-center group"
                                            >
                                                <span className="font-medium text-slate-700 dark:text-slate-200">{res.name}</span>
                                                <span className="text-xs text-slate-400 group-hover:text-slate-500">{res.unit_type}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Ingredient List */}
                            <div className="space-y-3">
                                <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-slate-700/50">
                                    <h3 className="font-bold text-slate-700 dark:text-slate-300 text-sm">Ingredientes Seleccionados ({ingredients.length})</h3>
                                    {ingredients.length === 0 && <span className="text-xs text-amber-500 flex items-center gap-1"><AlertCircle size={12} /> Receta vacía</span>}
                                </div>

                                {ingredients.length === 0 ? (
                                    <div className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-8 text-center text-slate-400">
                                        <p>Usa el buscador para agregar ingredientes.</p>
                                    </div>
                                ) : (
                                    ingredients.map((ing, idx) => {
                                        // Smart Unit Logic
                                        const purchaseUnit = ing.unit_type?.toLowerCase() || ''
                                        let unitOptions = [ing.unit_type]

                                        if (purchaseUnit.includes('lb') || purchaseUnit.includes('oz') || purchaseUnit.includes('kg') || purchaseUnit.includes('g') || (purchaseUnit.includes('bag') && (purchaseUnit.includes('lb') || purchaseUnit.includes('oz')))) {
                                            // Detected Weight (Restricted to Imperial per user request)
                                            unitOptions = [...new Set([ing.unit_type, 'lb', 'oz'])]
                                        } else if (purchaseUnit.includes('gal') || purchaseUnit.includes('l') || purchaseUnit.includes('ml')) {
                                            // Detected Volume (Restricted to Imperial)
                                            unitOptions = [...new Set([ing.unit_type, 'gal', 'fl oz'])]
                                        } else {
                                            // Generic / Count
                                            unitOptions = [...new Set([ing.unit_type, 'pza'])]
                                        }

                                        // Cost Calculation
                                        const costPerUnit = (ing.purchase_unit_cost || 0) / (ing.quantity_per_unit || 1)
                                        const yieldFactor = (ing.yield_percent || 100) / 100
                                        const conversion = getConversionFactor(ing.unit, ing.unit_measure)
                                        const recipeCost = (costPerUnit * (Number(ing.quantity) || 0) * conversion) / yieldFactor

                                        // Total Calc Helper
                                        // We can't update a variable here easily for the total, so we'll do it separately or inline.
                                        // Better to calculate total before mapping.

                                        return (
                                            <div key={idx} className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                                                <div className="flex-1">
                                                    <p className="font-bold text-slate-800 dark:text-white text-sm">{ing.name}</p>
                                                    <div className="flex gap-4 mt-1">
                                                        <p className="text-xs text-slate-500">
                                                            Costo Insumo: <span className="font-mono text-slate-700 dark:text-slate-300 font-medium">${ing.purchase_unit_cost?.toFixed(2)}</span> / {ing.unit_type}
                                                        </p>
                                                        {ing.yield_percent < 100 && (
                                                            <p className="text-xs text-amber-600 dark:text-amber-500">
                                                                Merma: {100 - ing.yield_percent}%
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="flex flex-col items-end gap-1">
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            type="number"
                                                            value={ing.quantity}
                                                            onChange={e => updateIngredient(idx, 'quantity', e.target.value)}
                                                            className="w-20 px-2 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded text-right font-mono text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                                        />
                                                        <select
                                                            value={ing.unit}
                                                            onChange={e => updateIngredient(idx, 'unit', e.target.value)}
                                                            className="max-w-[120px] px-2 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                                        >
                                                            {unitOptions.map(u => (
                                                                <option key={u} value={u}>{u}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <p className="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400">
                                                        = ${recipeCost.toFixed(3)}
                                                    </p>
                                                </div>

                                                <button
                                                    onClick={() => removeIngredient(idx)}
                                                    className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors ml-2"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        )
                                    })
                                )}
                            </div>

                            {/* Total Footer */}
                            {ingredients.length > 0 && (
                                <div className="mt-4 p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl border border-indigo-100 dark:border-indigo-800/50 flex justify-between items-center">
                                    <span className="font-semibold text-indigo-900 dark:text-indigo-200">Costo Total Receta:</span>
                                    <span className="text-xl font-bold font-mono text-indigo-600 dark:text-indigo-400">
                                        ${ingredients.reduce((sum, ing) => {
                                            const costPerUnit = (ing.purchase_unit_cost || 0) / (ing.quantity_per_unit || 1)
                                            const yieldFactor = (ing.yield_percent || 100) / 100
                                            const conversion = getConversionFactor(ing.unit, ing.unit_measure)
                                            const cost = (costPerUnit * (Number(ing.quantity) || 0) * conversion) / yieldFactor
                                            return sum + cost
                                        }, 0).toFixed(3)}
                                    </span>
                                </div>
                            )}

                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50 flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 font-medium rounded-lg text-sm">
                        Cancelar
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow font-medium flex items-center gap-2 disabled:opacity-50 text-sm"
                    >
                        {saving ? 'Guardando...' : <><Save size={16} /> Guardar Receta</>}
                    </button>
                </div>
            </motion.div>
        </div>
    )
}
