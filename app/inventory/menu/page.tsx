'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { RecipeModal } from './components/RecipeModal'

export default function MenuCatalogPage() {
    const [items, setItems] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [syncing, setSyncing] = useState(false)
    const [filter, setFilter] = useState('')
    const [selectedItem, setSelectedItem] = useState<any>(null)

    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )


    useEffect(() => {
        fetchLocalMenu()
    }, [])

    async function fetchLocalMenu() {
        setLoading(true)

        // 1. Fetch Menu Items
        const { data: menuItems, error } = await supabase
            .from('toast_menu_items')
            .select('*')
            .order('group_name', { ascending: true })
            .order('name', { ascending: true })
            .limit(1000)

        // 2. Fetch Recipe Existence (GUIDs only)
        const { data: recipes } = await supabase
            .from('recipes')
            .select('toast_menu_item_guid')

        // Count ingredients per item
        const ingredientCounts: Record<string, number> = {}
        recipes?.forEach((r: any) => {
            const guid = r.toast_menu_item_guid
            ingredientCounts[guid] = (ingredientCounts[guid] || 0) + 1
        })

        if (!error && menuItems) {
            // Merge status
            const items = menuItems.map(i => ({
                ...i,
                hasRecipe: !!ingredientCounts[i.guid],
                ingredientCount: ingredientCounts[i.guid] || 0
            }))
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
        i.name.toLowerCase().includes(filter.toLowerCase()) ||
        i.group_name?.toLowerCase().includes(filter.toLowerCase())
    )

    return (
        <div className="p-8">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Catálogo de Menú (Toast)</h1>
                    <p className="text-slate-500">Items sincronizados desde el POS. Mapea estos items a recetas.</p>
                </div>
                <button
                    onClick={handleSync}
                    disabled={syncing}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded shadow flex items-center gap-2 disabled:opacity-50"
                >
                    {syncing ? 'Sincronizando...' : '🔄 Sincronizar Ahora'}
                </button>
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
                                <th className="px-4 py-3">Grupo</th>
                                <th className="px-4 py-3">Item (Toast Name)</th>
                                <th className="px-4 py-3">Precio</th>
                                <th className="px-4 py-3">Insumos</th>
                                <th className="px-4 py-3">Receta</th>
                                <th className="px-4 py-3 text-right">Acción</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                            {loading ? (
                                <tr><td colSpan={5} className="p-8 text-center text-slate-500">Cargando catálogo...</td></tr>
                            ) : filteredItems.length === 0 ? (
                                <tr><td colSpan={5} className="p-8 text-center text-slate-500">No hay items sincronizados. Pulsa "Sincronizar Ahora".</td></tr>
                            ) : (
                                filteredItems.map(item => (
                                    <tr key={item.guid} className="hover:bg-slate-50 dark:hover:bg-slate-750">
                                        <td className="px-4 py-3 text-slate-500">{item.group_name}</td>
                                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">{item.name}</td>
                                        <td className="px-4 py-3 text-slate-500">${item.price?.toFixed(2)}</td>
                                        <td className="px-4 py-3 text-slate-500">
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
                    Mostrando primeros 500 items. Usa el buscador para filtrar.
                </div>
            </div>


            <RecipeModal
                isOpen={!!selectedItem}
                onClose={() => setSelectedItem(null)}
                item={selectedItem}
                onSaveSuccess={() => {
                    fetchLocalMenu() // Refresh to update status
                    alert('Receta guardada exitosamente')
                }}
            />
        </div >
    )
}
