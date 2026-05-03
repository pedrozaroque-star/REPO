'use client'

import { useState, useEffect } from 'react'
import { X, Plus, Trash2, Save, Search, AlertCircle } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { calculateIngredientCost } from '@/lib/inventory/recipe-calculations'

interface RecipeModalProps {
    isOpen: boolean
    onClose: () => void
    item: { guid: string, name: string } | null
    onSaveSuccess: () => void
}

// Helper removed in favor of calculateIngredientCost from recipe-calculations

export function RecipeModal({ isOpen, onClose, item, onSaveSuccess }: RecipeModalProps) {
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [ingredients, setIngredients] = useState<any[]>([]) // Current recipe ingredients
    const [availableItems, setAvailableItems] = useState<any[]>([]) // All inventory items for dropdown

    const [isNa, setIsNa] = useState(false)

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
            const allItems = dataItems.items || []
            // Filter out Bodega items so they can't be used in restaurant recipes
            setAvailableItems(allItems.filter((i: any) => !i.is_bodega))

            // 2. Load existing recipe
            const resRecipe = await fetch(`/api/inventory/recipes?guid=${item?.guid}`)
            const data = await resRecipe.json()

            // Handle new response format vs old format for backward compat
            const recipeList = Array.isArray(data) ? data : (data.recipes || [])
            const meta = Array.isArray(data) ? { recipe_na: false } : (data.meta || {})

            setIsNa(!!meta.recipe_na)

            // Map to local state
            const map = new Map<string, any>()
            ;(recipeList || []).forEach((r: any) => {
                const id = r.inventory_item.id
                if (!map.has(id)) {
                    map.set(id, {
                        inventory_item_id: id,
                        name: r.inventory_item.name,
                        unit_type: r.inventory_item.unit_type,
                        quantity: r.quantity,
                        unit: r.unit,
                        purchase_unit_cost: r.inventory_item.purchase_unit_cost,
                        quantity_per_unit: r.inventory_item.quantity_per_unit,
                        unit_measure: r.inventory_item.unit_measure,
                        yield_percent: r.inventory_item.yield_percent,
                        is_packaging: r.type && r.type !== 'food',
                        channels: {
                            dine_in: r.type === 'cogs_dine_in',
                            takeout: r.type === 'cogs_takeout',
                            delivery: r.type === 'cogs_delivery'
                        }
                    })
                } else {
                    const itemConf = map.get(id)
                    if (r.type !== 'food') itemConf.is_packaging = true
                    if (r.type === 'cogs_dine_in') itemConf.channels.dine_in = true
                    if (r.type === 'cogs_takeout') itemConf.channels.takeout = true
                    if (r.type === 'cogs_delivery') itemConf.channels.delivery = true
                }
            })
            setIngredients(Array.from(map.values()))

        } catch (e) {
            console.error(e)
            alert('Error loading data')
        } finally {
            setLoading(false)
        }
    }

    function addIngredient(invItem: any) {
        if (isNa) return // Prevent adding if N/A

        if (ingredients.find(i => i.inventory_item_id === invItem.id)) {
            alert('Este insumo ya está en la receta.')
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
            yield_percent: invItem.yield_percent,
            is_packaging: false,
            channels: { dine_in: false, takeout: false, delivery: false }
        }])
        setSearchTerm('')
    }

    function removeIngredient(invId: string) {
        setIngredients(ingredients.filter(i => i.inventory_item_id !== invId))
    }

    function updateIngredient(invId: string, field: string, value: any) {
        setIngredients(ingredients.map(i => i.inventory_item_id === invId ? { ...i, [field]: value } : i))
    }

    function updateIngredientChannel(invId: string, channel: string, value: boolean) {
        setIngredients(ingredients.map(i => i.inventory_item_id === invId ? {
            ...i,
            channels: { ...i.channels, [channel]: value }
        } : i))
    }

    async function handleSave() {
        setSaving(true)
        try {
            const flatIngredients: any[] = []
            
            ingredients.forEach(ing => {
                 if (!ing.is_packaging) {
                     flatIngredients.push({
                         inventory_item_id: ing.inventory_item_id,
                         quantity: Number(ing.quantity),
                         unit: ing.unit,
                         type: 'food' 
                     })
                 } else {
                     if (ing.channels.dine_in) {
                         flatIngredients.push({ inventory_item_id: ing.inventory_item_id, quantity: Number(ing.quantity), unit: ing.unit, type: 'cogs_dine_in' })
                     }
                     if (ing.channels.takeout) {
                         flatIngredients.push({ inventory_item_id: ing.inventory_item_id, quantity: Number(ing.quantity), unit: ing.unit, type: 'cogs_takeout' })
                     }
                     if (ing.channels.delivery) {
                         flatIngredients.push({ inventory_item_id: ing.inventory_item_id, quantity: Number(ing.quantity), unit: ing.unit, type: 'cogs_delivery' })
                     }
                 }
            })

            const payload = {
                toast_guid: item?.guid,
                ingredients: flatIngredients,
                recipe_na: isNa
            }

            const res = await fetch('/api/inventory/recipes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}))
                throw new Error(errData.error || 'Failed to save')
            }

            onSaveSuccess()
            onClose()
        } catch (e: any) {
            console.error(e)
            alert(`Error saving recipe: ${e.message}`)
        } finally {
            setSaving(false)
        }
    }

    // Filter available items based on search
    const searchResults = searchTerm
        ? availableItems.filter(i => i.name.toLowerCase().includes(searchTerm.toLowerCase()))
        : []

    function renderIngredientRow(ing: any) {
        // Smart Unit Logic
        const purchaseUnit = ing.unit_type?.toLowerCase() || ''
        let unitOptions = [ing.unit_type]

        if (purchaseUnit.includes('lb') || purchaseUnit.includes('oz') || purchaseUnit.includes('kg') || purchaseUnit.includes('g') || (purchaseUnit.includes('bag') && (purchaseUnit.includes('lb') || purchaseUnit.includes('oz')))) {
            unitOptions = [...new Set([ing.unit_type, 'lb', 'oz', 'pza'])]
        } else if (purchaseUnit.includes('gal') || purchaseUnit.includes('l') || purchaseUnit.includes('ml')) {
            unitOptions = [...new Set([ing.unit_type, 'gal', 'fl oz', 'pza'])]
        } else {
            unitOptions = [...new Set([ing.unit_type, 'pza'])]
        }

        const recipeCost = calculateIngredientCost(ing.quantity, ing.unit, ing)

        return (
            <div key={ing.inventory_item_id} className={`p-4 rounded-xl border shadow-sm mb-3 ${ing.is_packaging ? 'bg-indigo-50/30 border-indigo-200' : 'bg-white dark:bg-slate-800/50 border-slate-200 dark:border-slate-700'}`}>
                <div className="flex gap-4 items-start">
                    <div className="flex-1">
                        <div className="flex justify-between items-start mb-2">
                            <div>
                                <p className="font-bold text-slate-800 dark:text-white text-base">{ing.name}</p>
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
                            <button
                                onClick={() => removeIngredient(ing.inventory_item_id)}
                                className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors cursor-pointer"
                            >
                                <Trash2 size={18} />
                            </button>
                        </div>

                        {/* ROW 2: TOGGLE TIPO & CANTIDAD */}
                        <div className="flex flex-wrap items-center gap-4 mt-3 bg-slate-50/50 p-3 rounded-lg border border-slate-100 dark:bg-slate-900/30 dark:border-slate-800">
                            <div className="flex items-center gap-2">
                                <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-widest">Uso</label>
                                <select 
                                    value={ing.is_packaging ? 'packaging' : 'food'} 
                                    onChange={e => updateIngredient(ing.inventory_item_id, 'is_packaging', e.target.value === 'packaging')}
                                    className="px-3 py-1.5 bg-white border border-slate-300 dark:bg-slate-800 dark:border-slate-600 rounded-md text-sm font-medium focus:ring-2 focus:ring-indigo-500"
                                >
                                    <option value="food">🍽️ Comida</option>
                                    <option value="packaging">📦 Empaque</option>
                                </select>
                            </div>

                            <div className="h-6 w-px bg-slate-200 dark:bg-slate-700 hidden sm:block"></div>

                            <div className="flex items-center gap-2">
                                <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-widest">Cant</label>
                                <input
                                    type="number"
                                    step="any"
                                    min="0"
                                    value={ing.quantity}
                                    onChange={e => updateIngredient(ing.inventory_item_id, 'quantity', e.target.value)}
                                    className="w-20 px-2 py-1.5 bg-white border border-slate-300 dark:bg-slate-800 dark:border-slate-600 rounded-md text-right font-mono text-sm focus:ring-2 focus:ring-indigo-500"
                                />
                                <select
                                    value={ing.unit}
                                    onChange={e => updateIngredient(ing.inventory_item_id, 'unit', e.target.value)}
                                    className="max-w-[120px] px-2 py-1.5 bg-white border border-slate-300 dark:bg-slate-800 dark:border-slate-600 rounded-md text-sm cursor-pointer"
                                >
                                    {unitOptions.map(u => (
                                        <option key={u} value={u}>{u}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="ml-auto">
                                 <p className="text-sm font-mono font-bold text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-3 py-1 rounded-md border border-indigo-100 dark:border-indigo-800/50">
                                    = ${recipeCost.toFixed(3)}
                                 </p>
                            </div>
                        </div>

                        {/* ROW 3: CHANNELS (IF PACKAGING) */}
                        <AnimatePresence>
                            {ing.is_packaging && (
                                <motion.div 
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="mt-3 overflow-hidden"
                                >
                                    <p className="text-xs text-indigo-600 dark:text-indigo-400 font-medium mb-2 flex items-center gap-1">📍 Selecciona en qué canales aplica el cobro de este empaque:</p>
                                    <div className="flex flex-wrap gap-3">
                                        <label className={`flex items-center gap-1.5 text-sm border px-3 py-1.5 rounded-full cursor-pointer shadow-sm transition-colors ${ing.channels.dine_in ? 'bg-indigo-50 border-indigo-300 text-indigo-800 dark:bg-indigo-900/40 dark:border-indigo-500/50 dark:text-indigo-200' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300'}`}>
                                            <input 
                                                type="checkbox" 
                                                checked={ing.channels.dine_in} 
                                                onChange={e => updateIngredientChannel(ing.inventory_item_id, 'dine_in', e.target.checked)} 
                                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 bg-transparent"
                                            />
                                            <span>🏠 For Here</span>
                                        </label>
                                        <label className={`flex items-center gap-1.5 text-sm border px-3 py-1.5 rounded-full cursor-pointer shadow-sm transition-colors ${ing.channels.takeout ? 'bg-indigo-50 border-indigo-300 text-indigo-800 dark:bg-indigo-900/40 dark:border-indigo-500/50 dark:text-indigo-200' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300'}`}>
                                            <input 
                                                type="checkbox" 
                                                checked={ing.channels.takeout} 
                                                onChange={e => updateIngredientChannel(ing.inventory_item_id, 'takeout', e.target.checked)} 
                                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 bg-transparent"
                                            />
                                            <span>🛍️ To Go</span>
                                        </label>
                                        <label className={`flex items-center gap-1.5 text-sm border px-3 py-1.5 rounded-full cursor-pointer shadow-sm transition-colors ${ing.channels.delivery ? 'bg-indigo-50 border-indigo-300 text-indigo-800 dark:bg-indigo-900/40 dark:border-indigo-500/50 dark:text-indigo-200' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300'}`}>
                                            <input 
                                                type="checkbox" 
                                                checked={ing.channels.delivery} 
                                                onChange={e => updateIngredientChannel(ing.inventory_item_id, 'delivery', e.target.checked)} 
                                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 bg-transparent"
                                            />
                                            <span>🛵 Uber/DD</span>
                                        </label>
                                    </div>
                                    {ing.is_packaging && !ing.channels.dine_in && !ing.channels.takeout && !ing.channels.delivery && (
                                        <p className="text-xs text-red-500 mt-2 font-medium">⚠️ Debes seleccionar al menos un canal para que se guarde este empaque.</p>
                                    )}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </div>
        )
    }

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
                            {/* N/A Toggle */}
                            <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-900/50 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                                <input
                                    type="checkbox"
                                    id="recipe_na"
                                    checked={isNa}
                                    onChange={e => setIsNa(e.target.checked)}
                                    className="w-5 h-5 text-indigo-600 rounded focus:ring-indigo-500 border-gray-300"
                                />
                                <label htmlFor="recipe_na" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                    No aplica costo de receta (N/A)
                                </label>
                                <span className="text-xs text-slate-500 ml-auto">
                                    Marcar para excluir de cálculos de costo.
                                </span>
                            </div>

                            {/* Search Box (Conditionall hidden if NA) */}
                            {!isNa && (
                                <div className="space-y-3 bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm relative z-20">
                                    <div className="relative">
                                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wide">Buscar Insumo</label>
                                        <Search className="absolute left-3 top-[32px] text-slate-400" size={18} />
                                        <input
                                            type="text"
                                            placeholder="Buscar ingrediente o empaque (ej: Carne, Tomate, Charola)..."
                                            value={searchTerm}
                                            onChange={e => setSearchTerm(e.target.value)}
                                            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 focus:ring-2 focus:ring-indigo-500 focus:bg-white focus:outline-none text-sm font-medium transition-colors"
                                        />
                                            
                                        {/* Autocomplete Results */}
                                        {searchResults.length > 0 && (
                                            <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl max-h-48 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700/50">
                                                {searchResults.map(res => (
                                                    <button
                                                        key={res.id}
                                                        onClick={() => addIngredient(res)}
                                                        className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700 flex justify-between items-center group transition-colors"
                                                    >
                                                        <span className="font-medium text-slate-800 dark:text-slate-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">{res.name}</span>
                                                        <span className="text-xs text-slate-400 bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded">{res.unit_type}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Ingredient List */}
                            <div className="space-y-4 relative z-10">
                                {isNa ? (
                                    <div className="bg-slate-50 border border-slate-200 dark:bg-slate-900/50 dark:border-slate-700 rounded-lg p-6 text-center">
                                        <p className="text-slate-500 text-sm italic">Receta marcada como N/A. No se calculará costo.</p>
                                    </div>
                                ) : ingredients.length === 0 ? (
                                    <div className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-8 text-center text-slate-400">
                                        <p>Add ingredients or packages by searching above ☝️</p>
                                    </div>
                                ) : (
                                    <div>
                                        {/* List all items unified */}
                                        {ingredients.map((ing) => renderIngredientRow(ing))}
                                    </div>
                                )}
                            </div>

                            {/* Total Footer */}
                            {ingredients.length > 0 && (
                                <div className="mt-4 p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl border border-indigo-100 dark:border-indigo-800/50 flex justify-between items-center">
                                    <span className="font-semibold text-indigo-900 dark:text-indigo-200">Costo Total Receta:</span>
                                    <span className="text-xl font-bold font-mono text-indigo-600 dark:text-indigo-400">
                                        ${ingredients.reduce((sum, ing) => {
                                            const cost = calculateIngredientCost(ing.quantity, ing.unit, ing)
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
                        {saving ? 'Saving...' : <><Save size={16} /> Save Recipe</>}
                    </button>
                </div>
            </motion.div>
        </div>
    )
}
