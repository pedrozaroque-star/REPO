'use client'

import { useState, useEffect } from 'react'
import { Scale, Loader2 } from 'lucide-react'

interface BreakdownItem {
    guid: string
    itemName: string
    soldQty: number
    portionQty: number
    unit: string
    rawLbs: number
    yieldPct: number
}

interface MeatAnalysis {
    ingredientId: string
    ingredientName: string
    totalQuantityUsed: number
    totalRawLbs: number
    yieldPercent: number
    breakdown: BreakdownItem[]
}

export default function MeatAnalysisPage() {
    const [loading, setLoading] = useState(false)
    const [data, setData] = useState<MeatAnalysis | null>(null)
    const [stores, setStores] = useState<{ id: string, name: string, external_id: string }[]>([])
    const [storeId, setStoreId] = useState('5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02') // Default West Covina

    // Correctly get local date YYYY-MM-DD
    const getLocalDate = () => {
        const d = new Date()
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    }

    const [startDate, setStartDate] = useState(getLocalDate())
    const [endDate, setEndDate] = useState(getLocalDate())

    // Default to Carne Asada if we know the ID, otherwise user selects
    const [ingredients, setIngredients] = useState<any[]>([])
    const [selectedIngredient, setSelectedIngredient] = useState('')

    useEffect(() => {
        const fetchInitialData = async () => {
            // 1. Fetch Stores
            try {
                const sRes = await fetch('/api/stores')
                const sJson = await sRes.json()
                if (Array.isArray(sJson)) setStores(sJson)
            } catch (e) {
                console.error("Failed to fetch stores", e)
            }

            // 2. Fetch Ingredients
            try {
                const res = await fetch('/api/inventory/items')
                const json = await res.json()
                // Filter specifically for requested Meats
                const targetProteins = ['ASADA', 'PASTOR', 'POLLO', 'CARNITAS', 'CHORIZO', 'CABEZA', 'LENGUA', 'BUCHE']
                const meats = json.filter((i: any) => {
                    const name = i.name.toUpperCase()
                    // Must contain at least one of target proteins
                    return targetProteins.some(p => name.includes(p)) &&
                        // Exclude non-meat items that might match (e.g. 'Salsa de Pollo' if that existed, though unlikely. Keep it simple for now)
                        !name.includes('SALSA')
                })
                setIngredients(meats)

                // Prioritize Carne Asada if found
                const asada = meats.find((m: any) => m.name.toLowerCase().includes('asada') && m.name.toLowerCase().includes('carne'))
                if (asada) {
                    setSelectedIngredient(asada.id)
                } else if (meats.length > 0) {
                    setSelectedIngredient(meats[0].id)
                }
            } catch (e) {
                console.error("Failed to fetch ingredients", e)
            }
        }
        fetchInitialData()
    }, [])

    const runAnalysis = async () => {
        if (!selectedIngredient) return
        setLoading(true)
        try {
            const res = await fetch(`/api/inventory/meat-analysis?storeId=${storeId}&startDate=${startDate}&endDate=${endDate}&ingredientId=${selectedIngredient}`)
            const json = await res.json()
            if (json.error) alert(json.error)
            else setData(json)
        } catch (e) {
            console.error(e)
        } finally {
            setLoading(false)
        }
    }

    // Metrics Math
    // User Metric: 10 lb Bag -> 6.15 lb Cooked.
    // 1 Taco = 1.5 oz Cooked.
    // Tacos per 10lb Bag = (6.15 * 16) / 1.5 = 98.4 / 1.5 = 65.6 Tacos.
    // This matches user's observation of ~66.

    const bagsUsed = data ? (data.totalRawLbs / 10) : 0
    const tacosEquivalent = data ? (bagsUsed * 65.6) : 0
    // Or closer: (Total Raw Lbs * 16) / (1.5 / 0.615)

    return (
        <div className="p-6 max-w-[1600px] mx-auto space-y-6">
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
                <Scale className="w-8 h-8 text-red-600" />
                Análisis de Consumo de Carnes
            </h1>

            {/* Controls */}
            <div className="flex flex-wrap items-center gap-3 bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                <select
                    value={storeId}
                    onChange={(e) => setStoreId(e.target.value)}
                    className="p-2 border rounded bg-transparent dark:text-white dark:border-slate-600"
                >
                    {stores.map(s => <option key={s.id} value={s.external_id || s.id}>{s.name}</option>)}
                </select>

                <select
                    value={selectedIngredient}
                    onChange={(e) => setSelectedIngredient(e.target.value)}
                    className="p-2 border rounded bg-transparent dark:text-white dark:border-slate-600 max-w-[300px]"
                >
                    {ingredients.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>

                <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="p-2 border rounded bg-transparent dark:text-white dark:border-slate-600"
                />
                <span className="text-slate-400">to</span>
                <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="p-2 border rounded bg-transparent dark:text-white dark:border-slate-600"
                />

                <button
                    onClick={runAnalysis}
                    disabled={loading || !selectedIngredient}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded font-medium flex items-center gap-2 disabled:opacity-50 ml-auto"
                >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Analizar Consumo'}
                </button>
            </div>

            {/* Results */}
            {data && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Key Metrics */}
                    <div className="lg:col-span-1 space-y-4">
                        <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                            <h3 className="text-sm font-medium text-slate-500 uppercase">Consumo Total (Crudo)</h3>
                            <p className="text-4xl font-bold text-slate-900 dark:text-white mt-2">
                                {data.totalRawLbs.toLocaleString('en-US', { maximumFractionDigits: 1 })} <span className="text-lg text-slate-400 font-normal">lbs</span>
                            </p>
                            <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700 flex justify-between items-center text-sm">
                                <span className="text-slate-500">Rendimiento (Yield)</span>
                                <span className="font-mono font-bold text-emerald-600">{data.yieldPercent}%</span>
                            </div>
                        </div>

                        <div className="bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-900/20 dark:to-orange-900/10 p-6 rounded-xl border border-orange-200 dark:border-orange-800">
                            <h3 className="text-sm font-bold text-orange-800 dark:text-orange-400 uppercase tracking-widest mb-1">Equivalencia en Bolsas</h3>
                            <p className="text-5xl font-black text-orange-900 dark:text-orange-100">
                                {bagsUsed.toFixed(1)} <span className="text-xl font-medium opacity-70">bolsas</span>
                            </p>
                            <p className="text-xs text-orange-700 dark:text-orange-300 mt-2">
                                Basado en bolsas de 10 lbs (Bodega)
                            </p>
                        </div>

                        <div className="bg-slate-50 dark:bg-slate-800/50 p-6 rounded-xl border border-dashed border-slate-300 dark:border-slate-600">
                            <h3 className="text-xs font-semibold text-slate-500 uppercase">Equivalencia Tacos</h3>
                            <p className="text-2xl font-bold text-slate-700 dark:text-slate-300 mt-1">
                                ~ {Math.round(tacosEquivalent).toLocaleString()} <span className="text-sm font-normal">unidades</span>
                            </p>
                            <div className="mt-3 text-[10px] text-slate-400 border-t border-slate-200 dark:border-slate-700 pt-2 space-y-1">
                                <p>• 1 Taco = 1.5 oz (Cocinado)</p>
                                <p>• Yield: 10 lbs Crudo → 6.15 lbs Cocinado</p>
                                <p>• <strong>65.6 Tacos</strong> por Bolsa de 10lbs</p>
                            </div>
                        </div>
                    </div>

                    {/* Breakdown Table */}
                    <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex justify-between items-center">
                            <h3 className="font-semibold text-slate-700 dark:text-slate-200">Desglose por Producto</h3>
                            <span className="text-xs text-slate-400">Ordenado por consumo</span>
                        </div>
                        <div className="overflow-auto flex-1">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 uppercase tracking-wider font-semibold border-b dark:border-slate-700 sticky top-0">
                                    <tr>
                                        <th className="px-6 py-3">Producto</th>
                                        <th className="px-6 py-3 text-right">Cant. Vendida</th>
                                        <th className="px-6 py-3 text-right">Tu Receta</th>
                                        <th className="px-6 py-3 text-right">Consumo (Lbs Crudo)</th>
                                        <th className="px-6 py-3 text-right">% del Total</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                                    {data.breakdown.map((item) => (
                                        <tr key={item.guid} className="hover:bg-slate-50 dark:hover:bg-slate-750/50">
                                            <td className="px-6 py-3 font-medium text-slate-900 dark:text-slate-100">
                                                {item.itemName}
                                            </td>
                                            <td className="px-6 py-3 text-right font-mono text-slate-600 dark:text-slate-400">
                                                {item.soldQty}
                                            </td>
                                            <td className="px-6 py-3 text-right text-slate-500">
                                                {item.portionQty} {item.unit}
                                            </td>
                                            <td className="px-6 py-3 text-right font-bold text-slate-900 dark:text-white">
                                                {item.rawLbs.toFixed(2)}
                                            </td>
                                            <td className="px-6 py-3 text-right text-slate-400 text-xs">
                                                {((item.rawLbs / data.totalRawLbs) * 100).toFixed(1)}%
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
