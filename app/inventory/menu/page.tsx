'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { RecipeModal } from './components/RecipeModal'
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'

export default function MenuCatalogPage() {
    const [items, setItems] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [syncing, setSyncing] = useState(false)
    const [filter, setFilter] = useState('')
    const [selectedItem, setSelectedItem] = useState<any>(null)
    const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null)

    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )


    useEffect(() => {
        fetchLocalMenu()
    }, [])

    async function fetchLocalMenu(silent = false) { // Accept silent flag
        if (!silent) setLoading(true)

        // 1. Fetch Menu Items
        const { data: menuItems, error } = await supabase
            .from('toast_menu_items')
            .select('*')
            .order('group_name', { ascending: true })
            .order('name', { ascending: true })
            .limit(20000)

        // 2. Fetch Recipes with Ingredients and Costs
        console.log("Fetching recipes...")
        const { data: recipes, error: recipeError } = await supabase
            .from('recipes')
            .select(`
                toast_menu_item_guid,
                quantity,
                unit,
                inventory_items (
                    purchase_unit_cost,
                    quantity_per_unit,
                    yield_percent,
                    unit_measure
                )
            `)
            .limit(20000)

        if (recipeError) console.error("Recipe Fetch Error:", recipeError)
        console.log(`Recipes Loaded: ${recipes?.length}`)
        if (recipes && recipes.length > 0) console.log("Sample Recipe:", recipes[0])

        // Calculate Costs per Item
        const itemCosts: Record<string, number> = {}
        const ingredientCounts: Record<string, number> = {}

        let calculatedCount = 0
        recipes?.forEach((r: any) => {
            const guid = r.toast_menu_item_guid
            ingredientCounts[guid] = (ingredientCounts[guid] || 0) + 1

            // Cost Calculation
            const inv = r.inventory_items
            if (inv) {
                // Unit Conversion Logic
                const rUnit = r.unit?.toLowerCase()?.trim() || ''
                let iUnit = inv.unit_measure?.toLowerCase()?.trim() || ''

                // Smart Fallback: If inventory unit is 'pza' or 'unit', try to detect real unit from the description string (unit_type)
                if (iUnit === 'pza' || iUnit === 'unit') {
                    const desc = inv.unit_type?.toLowerCase() || ''
                    if (desc.includes('gallon') || desc.includes('gal')) iUnit = 'gal'
                    else if (desc.includes('lb')) iUnit = 'lb'
                    else if (desc.includes('oz')) iUnit = 'oz'
                    else if (desc.includes('kg')) iUnit = 'kg'
                    else if (desc.includes('l') && !desc.includes('gal')) iUnit = 'l'
                    else if (desc.includes('ml')) iUnit = 'ml'
                }

                let conversionFactor = 1

                if (rUnit !== iUnit) {
                    // Weight
                    if (rUnit === 'oz' && iUnit === 'lb') conversionFactor = 1 / 16
                    else if (rUnit === 'lb' && iUnit === 'oz') conversionFactor = 16
                    else if (rUnit === 'g' && iUnit === 'kg') conversionFactor = 1 / 1000
                    else if (rUnit === 'kg' && iUnit === 'g') conversionFactor = 1000
                    // Volume
                    else if (rUnit === 'ml' && iUnit === 'l') conversionFactor = 1 / 1000
                    else if (rUnit === 'l' && iUnit === 'ml') conversionFactor = 1000
                    else if ((rUnit === 'gal' || rUnit === 'gallon') && (iUnit === 'oz' || iUnit === 'fl oz')) conversionFactor = 128
                    else if ((rUnit === 'oz' || rUnit === 'fl oz') && (iUnit === 'gal' || iUnit === 'gallon')) conversionFactor = 1 / 128
                    // Count
                    else if (rUnit === 'dz' && (iUnit === 'pza' || iUnit === 'unit')) conversionFactor = 12
                }

                const quantityInInvUnits = (r.quantity || 0) * conversionFactor

                const costPerUnit = (inv.purchase_unit_cost || 0) / (inv.quantity_per_unit || 1)
                const yieldFactor = (inv.yield_percent || 100) / 100

                const ingredientCost = (costPerUnit * quantityInInvUnits) / yieldFactor

                itemCosts[guid] = (itemCosts[guid] || 0) + ingredientCost
                calculatedCount++
            } else {
                // Debug missing inventories periodically
                if (Math.random() < 0.001) console.warn("Missing Inventory for Recipe:", r)
            }
        })
        console.log(`Calculated costs for ${Object.keys(itemCosts).length} items (Total ingredients procesed: ${calculatedCount})`)

        if (!error && menuItems) {
            // Merge status
            const items = menuItems.map(i => {
                const cost = itemCosts[i.guid] || 0
                const price = i.price || 0
                const margin = price > 0 ? ((price - cost) / price) * 100 : 0

                return {
                    ...i,
                    hasRecipe: !!ingredientCounts[i.guid],
                    ingredientCount: ingredientCounts[i.guid] || 0,
                    recipeCost: cost,
                    marginPercent: margin
                }
            })
            setItems(items)
        }
        setLoading(false)
    }

    async function handleSync() {
        setSyncing(true)
        try {
            const res = await fetch('/api/cron/sync-menu')
            if (!res.ok) throw new Error('Error syncing')
            const data = await res.json()
            alert(`Sincronización Completada: ${data.count} items procesados.`)
            fetchLocalMenu() // Refresh list
        } catch (e) {
            alert('Error al sincronizar con Toast.')
        } finally {
            setSyncing(false)
        }
    }

    const filteredItems = items.filter(i =>
        (i.name.toLowerCase().includes(filter.toLowerCase()) || i.group_name?.toLowerCase().includes(filter.toLowerCase())) &&
        (i.price && i.price > 0)
    )

    // Sorting Logic
    const sortedItems = [...filteredItems].sort((a, b) => {
        if (!sortConfig) return 0
        const { key, direction } = sortConfig

        let valA = a[key]
        let valB = b[key]

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

    return (
        <div className="p-8">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Catálogo de Menú (Toast)</h1>
                    <p className="text-slate-500">Items sincronizados desde el POS. Mapea estos items a recetas.</p>
                </div>
                <div className="flex gap-4">
                    <button
                        onClick={handleSync}
                        disabled={syncing}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded shadow flex items-center gap-2 disabled:opacity-50"
                    >
                        {syncing ? 'Sincronizando...' : '🔄 Sincronizar Ahora'}
                    </button>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-lg shadow border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
                    <input
                        type="text"
                        placeholder="Buscar por nombre o grupo..."
                        className="w-full max-w-md px-3 py-2 border rounded-md dark:bg-slate-800 dark:border-slate-700"
                        value={filter}
                        onChange={e => setFilter(e.target.value)}
                    />
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 uppercase text-xs font-semibold">
                            <tr>
                                <th
                                    className="px-4 py-3 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 group"
                                    onClick={() => requestSort('group_name')}
                                >
                                    <div className="flex items-center">Grupo <SortIcon columnKey="group_name" /></div>
                                </th>
                                <th
                                    className="px-4 py-3 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 group"
                                    onClick={() => requestSort('name')}
                                >
                                    <div className="flex items-center">Item (Toast Name) <SortIcon columnKey="name" /></div>
                                </th>
                                <th
                                    className="px-4 py-3 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 group text-right"
                                    onClick={() => requestSort('price')}
                                >
                                    <div className="flex items-center justify-end">Precio <SortIcon columnKey="price" /></div>
                                </th>
                                <th
                                    className="px-4 py-3 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 group text-right"
                                    onClick={() => requestSort('recipeCost')}
                                >
                                    <div className="flex items-center justify-end">Costo Receta <SortIcon columnKey="recipeCost" /></div>
                                </th>
                                <th
                                    className="px-4 py-3 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 group text-right"
                                    onClick={() => requestSort('marginPercent')}
                                >
                                    <div className="flex items-center justify-end">Margen <SortIcon columnKey="marginPercent" /></div>
                                </th>
                                <th
                                    className="px-4 py-3 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 group text-center"
                                    onClick={() => requestSort('ingredientCount')}
                                >
                                    <div className="flex items-center justify-center">Insumos <SortIcon columnKey="ingredientCount" /></div>
                                </th>
                                <th
                                    className="px-4 py-3 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 group text-center"
                                    onClick={() => requestSort('hasRecipe')}
                                >
                                    <div className="flex items-center justify-center">Estado <SortIcon columnKey="hasRecipe" /></div>
                                </th>
                                <th className="px-4 py-3 text-right">Acción</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                            {loading ? (
                                <tr><td colSpan={8} className="p-8 text-center text-slate-500">Cargando catálogo...</td></tr>
                            ) : sortedItems.length === 0 ? (
                                <tr><td colSpan={8} className="p-8 text-center text-slate-500">No hay items sincronizados. Pulsa "Sincronizar Ahora".</td></tr>
                            ) : (
                                sortedItems.map(item => (
                                    <tr key={item.guid} className="hover:bg-slate-50 dark:hover:bg-slate-750">
                                        <td className="px-4 py-3 text-slate-500 text-xs">{item.group_name}</td>
                                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100 flex items-center gap-2">
                                            {item.name}
                                            {item.group_name?.startsWith('[Mod]') && (
                                                <span className="bg-purple-100 text-purple-700 text-[10px] px-1.5 py-0.5 rounded border border-purple-200 uppercase tracking-wide">
                                                    Modificador
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-right text-slate-600 font-medium">${item.price?.toFixed(2)}</td>

                                        {/* Costo Receta */}
                                        <td className="px-4 py-3 text-right text-slate-500">
                                            {item.recipeCost > 0 ? `$${item.recipeCost.toFixed(2)}` : '-'}
                                        </td>

                                        {/* Margen */}
                                        <td className="px-4 py-3 text-right">
                                            {item.recipeCost > 0 ? (
                                                <span className={`font-bold ${item.marginPercent < 65 ? 'text-red-500' : 'text-emerald-600'}`}>
                                                    {item.marginPercent.toFixed(1)}%
                                                </span>
                                            ) : '-'}
                                        </td>

                                        <td className="px-4 py-3 text-center text-slate-500">
                                            {item.ingredientCount > 0 ? (
                                                <span className="font-semibold text-slate-700 dark:text-slate-300">{item.ingredientCount}</span>
                                            ) : (
                                                <span className="text-slate-300">-</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            {item.hasRecipe ? (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800 border border-emerald-200">
                                                    ✅ Mapeado
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-500">
                                                    Sin Receta
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <button
                                                onClick={() => setSelectedItem(item)}
                                                className="text-indigo-600 hover:text-indigo-900 font-semibold text-xs border border-indigo-200 hover:border-indigo-400 bg-indigo-50 hover:bg-indigo-100 px-3 py-1 rounded transition-colors"
                                            >
                                                Editar Receta
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="p-2 text-xs text-center text-slate-400 border-t border-slate-200 dark:border-slate-700">
                    Mostrando (filtrados y ordenados) {sortedItems.length} items.
                </div>
            </div>


            <RecipeModal
                isOpen={!!selectedItem}
                onClose={() => setSelectedItem(null)}
                item={selectedItem}
                onSaveSuccess={() => {
                    fetchLocalMenu(true) // Silent refresh!
                    // alert remove
                }}
            />
        </div >
    )
}
