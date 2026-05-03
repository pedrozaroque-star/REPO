'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { RecipeModal } from './components/RecipeModal'
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { calculateIngredientCost } from '@/lib/inventory/recipe-calculations'
import { useLanguage } from '@/lib/i18n'

export default function MenuCatalogPage() {
    const [items, setItems] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [syncing, setSyncing] = useState(false)
    const [filter, setFilter] = useState('')
    const [selectedItem, setSelectedItem] = useState<any>(null)
    const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>({ key: 'foodCostPercent', direction: 'desc' })

    const { t } = useLanguage()

    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )


    useEffect(() => {
        fetchLocalMenu()
    }, [])

    async function fetchLocalMenu(silent = false) { // Accept silent flag
        if (!silent) setLoading(true)

        // 1. Fetch Menu Items (include recipe_na)
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
                type,
                inventory_items (
                    purchase_unit_cost,
                    quantity_per_unit,
                    yield_percent,
                    unit_measure,
                    unit_type
                )
            `)
            .limit(20000)

        if (recipeError) console.error("Recipe Fetch Error:", recipeError)
        console.log(`Recipes Loaded: ${recipes?.length}`)
        if (recipes && recipes.length > 0) console.log("Sample Recipe:", recipes[0])

        // Calculate Costs per Item
        const itemCosts: Record<string, number> = {} // Only Food
        const cogsDineIn: Record<string, number> = {}
        const cogsTakeout: Record<string, number> = {}
        const cogsDelivery: Record<string, number> = {}
        const ingredientCounts: Record<string, number> = {} // Only Food

        let calculatedCount = 0
        recipes?.forEach((r: any) => {
            const guid = r.toast_menu_item_guid
            
            const inv = r.inventory_items
            if (inv) {
                const ingredientCost = calculateIngredientCost(r.quantity, r.unit, inv)
                const type = r.type || 'food'

                if (type === 'food') {
                    ingredientCounts[guid] = (ingredientCounts[guid] || 0) + 1
                    itemCosts[guid] = (itemCosts[guid] || 0) + ingredientCost
                } else if (type === 'cogs_dine_in') {
                    cogsDineIn[guid] = (cogsDineIn[guid] || 0) + ingredientCost
                } else if (type === 'cogs_takeout') {
                    cogsTakeout[guid] = (cogsTakeout[guid] || 0) + ingredientCost
                } else if (type === 'cogs_delivery') {
                    cogsDelivery[guid] = (cogsDelivery[guid] || 0) + ingredientCost
                }

                calculatedCount++
            }
        })
        console.log(`Calculated costs for ${Object.keys(itemCosts).length} items (Total ingredients procesed: ${calculatedCount})`)

        if (!error && menuItems) {
            // Merge status
            const items = menuItems.map(i => {
                const cost = itemCosts[i.guid] || 0
                const price = i.price || 0
                const isNa = !!i.recipe_na

                // To measure global baseline profitability without over-complicating this specific table, 
                // we'll calculate the 'blended' UI display using ONLY pure food cost first. 
                // But let's expose the worst-case (Uber delivery) to show if an item is bleeding money.
                const worstCogs = Math.max(cogsDineIn[i.guid] || 0, cogsTakeout[i.guid] || 0, cogsDelivery[i.guid] || 0)
                const totalWorstCost = cost + worstCogs

                const margin = (price > 0 && cost > 0 && !isNa) ? ((price - totalWorstCost) / price) * 100 : null
                const foodCostPercent = (price > 0 && cost > 0 && !isNa) ? (totalWorstCost / price) * 100 : null
                const netProfit = (price > 0 && cost > 0 && !isNa) ? (price - totalWorstCost) : null

                return {
                    ...i,
                    hasRecipe: !!ingredientCounts[i.guid] || isNa, // Complete if has recipe OR marked N/A
                    isNa,
                    ingredientCount: ingredientCounts[i.guid] || 0,
                    recipeCost: cost,
                    cogsDineIn: cogsDineIn[i.guid] || 0,
                    cogsTakeout: cogsTakeout[i.guid] || 0,
                    cogsDelivery: cogsDelivery[i.guid] || 0,
                    marginPercent: margin, // can be null
                    foodCostPercent,      // can be null
                    netProfit             // can be null
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
            alert('Error syncing with Toast.')
        } finally {
            setSyncing(false)
        }
    }

    const filteredItems = items.filter(i =>
        (i.name.toLowerCase().includes(filter.toLowerCase()) || i.group_name?.toLowerCase().includes(filter.toLowerCase()))
    )

    // Sorting Logic
    const sortedItems = [...filteredItems].sort((a, b) => {
        if (!sortConfig) return 0
        const { key, direction } = sortConfig

        let valA = a[key]
        let valB = b[key]

        // Handle null/undefined (Always push to bottom/end regardless of direction)
        if (valA === null || valA === undefined) {
            if (valB === null || valB === undefined) return 0
            // valA is null, valB is not. We want A AFTER B.
            return 1
        }
        if (valB === null || valB === undefined) {
            // valB is null, valA is not. We want B AFTER A.
            return -1
        }

        // Handle numeric values
        if (typeof valA === 'number' && typeof valB === 'number') {
            return direction === 'asc' ? valA - valB : valB - valA
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

    return (
        <div className="p-8">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('menu_catalog.title')}</h1>
                    <p className="text-slate-500">{t('menu_catalog.subtitle')}</p>
                </div>
                <div className="flex gap-4">
                    <button
                        onClick={handleSync}
                        disabled={syncing}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded shadow flex items-center gap-2 disabled:opacity-50"
                    >
                        {syncing ? t('menu_catalog.syncing_btn') : `🔄 ${t('menu_catalog.sync_btn')}`}
                    </button>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-lg shadow border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
                    <input
                        type="text"
                        placeholder={t('menu_catalog.search_placeholder') as string}
                        className="w-full max-w-md px-3 py-2 border rounded-md dark:bg-slate-800 dark:border-slate-700"
                        value={filter}
                        onChange={e => setFilter(e.target.value)}
                    />
                </div>

                <div className="overflow-x-auto max-h-[75vh] overflow-y-auto relative">
                    <table className="w-full text-left text-sm relative border-collapse">
                        <thead className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 uppercase text-xs font-semibold shadow-md ring-1 ring-slate-200 dark:ring-slate-700">
                            <tr>
                                <th
                                    className="px-4 py-3 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 group"
                                    onClick={() => requestSort('group_name')}
                                >
                                    <div className="flex items-center">{t('menu_catalog.columns.group')} <SortIcon columnKey="group_name" /></div>
                                </th>
                                <th
                                    className="px-4 py-3 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 group"
                                    onClick={() => requestSort('name')}
                                >
                                    <div className="flex items-center">{t('menu_catalog.columns.item')} <SortIcon columnKey="name" /></div>
                                </th>
                                <th
                                    className="px-4 py-3 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 group text-right"
                                    onClick={() => requestSort('price')}
                                >
                                    <div className="flex items-center justify-end">{t('menu_catalog.columns.price')} <SortIcon columnKey="price" /></div>
                                </th>
                                <th
                                    className="px-4 py-3 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 group text-right"
                                    onClick={() => requestSort('recipeCost')}
                                >
                                    <div className="flex items-center justify-end">{t('menu_catalog.columns.cost')} <SortIcon columnKey="recipeCost" /></div>
                                </th>
                                <th className="px-4 py-3 text-right">
                                    <div className="flex items-center justify-end">{t('menu_catalog.columns.packaging')}</div>
                                </th>
                                <th
                                    className="px-4 py-3 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 group text-right"
                                    onClick={() => requestSort('foodCostPercent')}
                                >
                                    <div className="flex items-center justify-end">{t('menu_catalog.columns.cost_percent')} <SortIcon columnKey="foodCostPercent" /></div>
                                </th>
                                <th
                                    className="px-4 py-3 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 group text-right"
                                    onClick={() => requestSort('marginPercent')}
                                >
                                    <div className="flex items-center justify-end">{t('menu_catalog.columns.margin_percent')} <SortIcon columnKey="marginPercent" /></div>
                                </th>
                                <th
                                    className="px-4 py-3 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 group text-right"
                                    onClick={() => requestSort('netProfit')}
                                >
                                    <div className="flex items-center justify-end">{t('menu_catalog.columns.profit')} <SortIcon columnKey="netProfit" /></div>
                                </th>
                                <th
                                    className="px-4 py-3 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 group text-center"
                                    onClick={() => requestSort('ingredientCount')}
                                >
                                    <div className="flex items-center justify-center">{t('menu_catalog.columns.inputs')} <SortIcon columnKey="ingredientCount" /></div>
                                </th>
                                <th
                                    className="px-4 py-3 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 group text-center"
                                    onClick={() => requestSort('hasRecipe')}
                                >
                                    <div className="flex items-center justify-center">{t('menu_catalog.columns.status')} <SortIcon columnKey="hasRecipe" /></div>
                                </th>
                                <th className="px-4 py-3 text-right">{t('menu_catalog.columns.action')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                            {loading ? (
                                <tr><td colSpan={10} className="p-8 text-center text-slate-500">{t('menu_catalog.status.loading')}</td></tr>
                            ) : sortedItems.length === 0 ? (
                                <tr><td colSpan={10} className="p-8 text-center text-slate-500">{t('menu_catalog.status.empty')}</td></tr>
                            ) : (
                                sortedItems.map(item => (
                                    <tr key={item.guid} className="hover:bg-slate-50 dark:hover:bg-slate-750">
                                        <td className="px-4 py-3 text-slate-500 text-xs">{item.group_name}</td>
                                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100 flex items-center gap-2">
                                            {item.name}
                                            {item.group_name?.startsWith('[Mod]') && (
                                                <span className="bg-purple-100 text-purple-700 text-[10px] px-1.5 py-0.5 rounded border border-purple-200 uppercase tracking-wide">
                                                    Mod
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-right text-slate-600 font-medium">${item.price?.toFixed(2)}</td>

                                        {/* Costo Receta */}
                                        <td className="px-4 py-3 text-right text-slate-500">
                                            {item.isNa ? (
                                                <span className="text-xs text-slate-400 italic">N/A</span>
                                            ) : item.recipeCost > 0 ? (
                                                `$${item.recipeCost.toFixed(2)}`
                                            ) : '-'}
                                        </td>

                                        {/* Costo COGS */}
                                        <td className="px-4 py-3 text-right text-slate-500 text-xs">
                                            {item.isNa ? (
                                                <span className="text-xs text-slate-400 italic">N/A</span>
                                            ) : (item.cogsDineIn > 0 || item.cogsTakeout > 0 || item.cogsDelivery > 0) ? (
                                                <div className="flex flex-col items-end gap-1">
                                                    <div className="flex flex-wrap justify-end gap-1">
                                                        {item.cogsDineIn > 0 && <span className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 text-[10px] px-1.5 py-0.5 rounded shadow-sm border border-slate-200 dark:border-slate-700 font-mono" title="For Here">🏠 ${item.cogsDineIn.toFixed(2)}</span>}
                                                        {item.cogsTakeout > 0 && <span className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 text-[10px] px-1.5 py-0.5 rounded shadow-sm border border-slate-200 dark:border-slate-700 font-mono" title="To Go">🛍️ ${item.cogsTakeout.toFixed(2)}</span>}
                                                    </div>
                                                    <div>
                                                        {item.cogsDelivery > 0 && <span className="bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 text-[10px] px-1.5 py-0.5 rounded shadow-sm border border-indigo-200 dark:border-indigo-800 font-mono font-bold" title="Uber/DD">🛵 ${item.cogsDelivery.toFixed(2)}</span>}
                                                    </div>
                                                </div>
                                            ) : (
                                                <span className="text-slate-300">-</span>
                                            )}
                                        </td>

                                        {/* Costo % */}
                                        <td className="px-4 py-3 text-right">
                                            {item.isNa ? (
                                                <span className="text-xs text-slate-400 italic">N/A</span>
                                            ) : item.recipeCost > 0 && item.price > 0 ? (
                                                <span className={`font-mono text-xs font-bold ${item.foodCostPercent > 32 ? 'text-red-500' : item.foodCostPercent > 30 ? 'text-yellow-500' : 'text-emerald-600'}`}>
                                                    {item.foodCostPercent.toFixed(1)}%
                                                </span>
                                            ) : '-'}
                                        </td>

                                        {/* Utilidad % (Margen) */}
                                        <td className="px-4 py-3 text-right">
                                            {item.isNa ? (
                                                <span className="text-xs text-slate-400 italic">N/A</span>
                                            ) : item.recipeCost > 0 && item.price > 0 && item.marginPercent !== null ? (
                                                <span className={`font-bold text-xs ${item.marginPercent < 68 ? 'text-red-500' : item.marginPercent < 70 ? 'text-yellow-500' : 'text-emerald-600'}`}>
                                                    {item.marginPercent.toFixed(1)}%
                                                </span>
                                            ) : '-'}
                                        </td>

                                        {/* Utilidad ($) */}
                                        <td className="px-4 py-3 text-right">
                                            {item.isNa ? (
                                                <span className="text-xs text-slate-400 italic">N/A</span>
                                            ) : item.recipeCost > 0 && item.price > 0 ? (
                                                <span className={`font-mono font-bold ${item.netProfit < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                                                    ${item.netProfit.toFixed(2)}
                                                </span>
                                            ) : '-'}
                                        </td>

                                        <td className="px-4 py-3 text-center text-slate-500">
                                            {item.isNa ? (
                                                <span className="text-xs text-slate-400 italic">N/A</span>
                                            ) : item.ingredientCount > 0 ? (
                                                <span className="font-semibold text-slate-700 dark:text-slate-300">{item.ingredientCount}</span>
                                            ) : (
                                                <span className="text-slate-300">-</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            {item.isNa ? (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
                                                    N/A
                                                </span>
                                            ) : item.hasRecipe ? (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800 border border-emerald-200">
                                                    ✅
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-500">
                                                    -
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <button
                                                onClick={() => setSelectedItem(item)}
                                                className="text-indigo-600 hover:text-indigo-900 font-semibold text-xs border border-indigo-200 hover:border-indigo-400 bg-indigo-50 hover:bg-indigo-100 px-3 py-1 rounded transition-colors"
                                            >
                                                {t('menu_catalog.edit_recipe')}
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="p-2 text-xs text-center text-slate-400 border-t border-slate-200 dark:border-slate-700">
                    {(t('menu_catalog.footer_stats') as string).replace('{n}', sortedItems.length.toString())}
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
