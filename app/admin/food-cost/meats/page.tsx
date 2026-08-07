'use client'

import { useState, useEffect } from 'react'
import { Scale, Loader2, AlertTriangle } from 'lucide-react'
import DateRangeFilter from '@/components/sales/DateRangeFilter'
import FoodCostNavigationTabs from '@/components/food-cost/FoodCostNavigationTabs'
import { useLanguage } from '@/lib/i18n'

interface BreakdownItem {
    guid: string
    itemName: string
    soldQty: number
    portionQty: number
    unit: string
    rawLbs: number
    yieldPct: number
    salesAmount?: number
    costAmount?: number
    utilityAmount?: number
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
    const { t } = useLanguage()
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
    const [period, setPeriod] = useState('today')

    // Default to Carne Asada if we know the ID, otherwise user selects
    const [ingredients, setIngredients] = useState<any[]>([])
    const [selectedIngredient, setSelectedIngredient] = useState('')

    // State for Auditoria
    const [actualBagsInput, setActualBagsInput] = useState('')

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
                const allItems = json.items || [] // Fix: Destructure items from response object

                // Filter specifically for requested Meats
                const targetProteins = ['ASADA', 'PASTOR', 'POLLO', 'CARNITAS', 'CHORIZO', 'CABEZA', 'LENGUA', 'BUCHE']
                const meats = allItems.filter((i: any) => {
                    const name = i.name.toUpperCase()
                    // Must contain at least one of target proteins
                    return targetProteins.some(p => name.includes(p)) &&
                        // Exclude non-meat items that might match (e.g. 'Salsa de Pollo' if that existed, though unlikely. Keep it simple for now)
                        !name.includes('SALSA')
                })
                setIngredients(meats)

                // Prioritize Carne Asada if found
                const asada = meats.find((m: any) => m.name.toLowerCase().includes('asada') && m.name.toLowerCase().includes('carne'), 'i')
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
            <FoodCostNavigationTabs />
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
                        <Scale className="w-8 h-8 text-red-600" />
                        {t('food_cost.meat_analysis')}
                    </h1>
                    <p className="text-slate-500 mt-1">{t('food_cost.meat_subtitle')}</p>
                </div>

                {/* Controls */}
                <div className="flex flex-wrap items-center gap-3 bg-white dark:bg-slate-800 p-2 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700">
                    <select
                        value={storeId}
                        onChange={(e) => setStoreId(e.target.value)}
                        className="p-2 border rounded bg-transparent dark:text-white dark:border-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="all">{t('sales.all_stores')}</option>
                        {stores.map(s => <option key={s.id} value={s.external_id || s.id}>{s.name}</option>)}
                    </select>

                    <select
                        value={selectedIngredient}
                        onChange={(e) => setSelectedIngredient(e.target.value)}
                        className="p-2 border rounded bg-transparent dark:text-white dark:border-slate-600 max-w-[200px] focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        {ingredients.length === 0 && <option>{t('food_cost.loading')}</option>}
                        {ingredients.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </select>

                    <DateRangeFilter
                        period={period}
                        startDate={startDate}
                        endDate={endDate}
                        onChange={(p, start, end) => {
                            setPeriod(p as any) // Safe cast for simple string match
                            setStartDate(start)
                            setEndDate(end)
                        }}
                    />

                    <button
                        onClick={runAnalysis}
                        disabled={loading || !selectedIngredient}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium flex items-center gap-2 disabled:opacity-50 transition-colors"
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : t('food_cost.analyze')}
                    </button>
                </div>
            </div>

            {/* Results */}
            {data && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Key Metrics */}
                    <div className="lg:col-span-1 space-y-4">
                        <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                            <h3 className="text-sm font-medium text-slate-500 uppercase">{t('food_cost.table.usage')}</h3>
                            <p className="text-4xl font-bold text-slate-900 dark:text-white mt-2">
                                {data.totalRawLbs.toLocaleString('en-US', { maximumFractionDigits: 1 })} <span className="text-lg text-slate-400 font-normal">lbs</span>
                            </p>
                            <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700 flex justify-between items-center text-sm">
                                <span className="text-slate-500">{t('food_cost.table.yield')}</span>
                                <span className="font-mono font-bold text-emerald-600">{data.yieldPercent}%</span>
                            </div>
                        </div>

                        <div className="bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-900/20 dark:to-orange-900/10 p-6 rounded-xl border border-orange-200 dark:border-orange-800">
                            <h3 className="text-sm font-bold text-orange-800 dark:text-orange-400 uppercase tracking-widest mb-1">{t('food_cost.meat_table.bags_10')}</h3>
                            <p className="text-5xl font-black text-orange-900 dark:text-orange-100">
                                {bagsUsed.toFixed(1)} <span className="text-xl font-medium opacity-70">bolsas</span>
                            </p>
                            <p className="text-xs text-orange-700 dark:text-orange-300 mt-2">
                                Basado en bolsas de 10 lbs (Bodega)
                            </p>
                        </div>

                        {/* Auditoria Rapida Comparator */}
                        <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border-l-4 border-l-blue-500 border-y border-r border-slate-200 dark:border-slate-700">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-sm font-bold text-slate-800 dark:text-white uppercase flex items-center gap-2">
                                    <AlertTriangle className="w-5 h-5 text-blue-500" />
                                    Auditoría Rápida
                                </h3>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className="text-xs font-semibold text-slate-500 block mb-1 uppercase tracking-wider">¿Realidad vs Sistema?</label>
                                    <p className="text-[10px] text-slate-400 mb-2">
                                        Ingresa cuántas bolsas se sacaron realmente del congelador para detectar desviaciones.
                                    </p>
                                    <div className="flex gap-2 items-center">
                                        <input
                                            type="number"
                                            placeholder="0.0"
                                            className="w-24 p-2 text-right text-lg font-bold border rounded-lg bg-slate-50 dark:bg-slate-900 border-slate-300 dark:border-slate-600 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                                            value={actualBagsInput}
                                            onChange={(e) => setActualBagsInput(e.target.value)}
                                        />
                                        <span className="text-sm font-medium text-slate-600 dark:text-slate-400">Bolsas Reales</span>
                                    </div>
                                </div>

                                {actualBagsInput && (
                                    <div className={`p-4 rounded-lg border flex flex-col gap-2 transition-all duration-300 animate-in fade-in zoom-in-95 ${Number(actualBagsInput) > bagsUsed
                                        ? 'bg-red-50 border-red-200 text-red-900 dark:bg-red-900/20 dark:border-red-800'
                                        : 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-900/20 dark:border-emerald-800'
                                        }`}>
                                        <div className="flex justify-between items-end border-b pb-2 border-black/5 dark:border-white/10">
                                            <span className="text-xs font-bold uppercase opacity-70">
                                                {Number(actualBagsInput) > bagsUsed ? 'Desperdicio' : 'Eficiencia'}
                                            </span>
                                            <span className="font-black text-xl font-mono dark:text-white">
                                                {Number(actualBagsInput) > bagsUsed ? '+' : ''}
                                                {(Number(actualBagsInput) - bagsUsed).toFixed(1)} <span className="text-sm font-normal">bolsas</span>
                                            </span>
                                        </div>

                                        <p className="text-xs leading-snug font-medium dark:text-slate-200">
                                            {Number(actualBagsInput) > bagsUsed
                                                ? `🚨 ALERTA: Usaste un ${((Number(actualBagsInput) - bagsUsed) / bagsUsed * 100).toFixed(1)}% MÁS de lo debido. Posible robo, porciones grandes o desperdicio.`
                                                : `✅ EXCELENTE: Tu equipo está dentro del rango ideal.`
                                            }
                                        </p>
                                    </div>
                                )}
                            </div>
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

                        {/* Explanation Card */}
                        <div className="bg-blue-50 dark:bg-blue-900/20 p-6 rounded-xl border border-blue-100 dark:border-blue-800/50">
                            <h3 className="text-xs font-bold text-blue-800 dark:text-blue-300 uppercase flex items-center gap-2 mb-4">
                                <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                                Guía de Lectura
                            </h3>
                            <div className="space-y-4 text-xs text-slate-600 dark:text-slate-300">
                                <div className="flex flex-col gap-1">
                                    <span className="font-bold text-slate-900 dark:text-white uppercase text-[10px] tracking-wider">Consumo (Lbs)</span>
                                    <p className="leading-relaxed opacity-90">
                                        Es la carne <strong>CRUDA</strong> necesaria para cubrir la venta. Incluye la merma natural al cocinar (Yield).
                                    </p>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <span className="font-bold text-red-600 uppercase text-[10px] tracking-wider">Costo Carne</span>
                                    <p className="leading-relaxed opacity-90">
                                        Dinero invertido solo en la proteína.
                                        <br /><code className="text-[10px] bg-white dark:bg-black/20 px-1 rounded">Lbs Crudas × Precio Compra</code>
                                    </p>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <span className="font-bold text-emerald-600 uppercase text-[10px] tracking-wider">Utilidad</span>
                                    <p className="leading-relaxed opacity-90">
                                        Ganancia bruta directa.
                                        <br /><code className="text-[10px] bg-white dark:bg-black/20 px-1 rounded">Venta Neta - Costo Carne</code>
                                    </p>
                                    <p className="text-[10px] italic text-slate-400 mt-1">
                                        *No incluye tortilla, salsa, ni labor.
                                    </p>
                                </div>

                                <div className="mt-3 pt-3 border-t border-blue-200 dark:border-blue-700/50">
                                    <p className="text-[10px] text-blue-800 dark:text-blue-300 italic">
                                        <strong>Tip Pro:</strong> Este reporte muestra el consumo <em>IDEAL</em>. Si en la realidad gastaste más bolsas de las que dice aquí, la diferencia es desperdicio o robo.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Breakdown Table */}
                    <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex justify-between items-center">
                            <h3 className="font-semibold text-slate-700 dark:text-slate-200">Product Breakdown</h3>
                            <span className="text-xs text-slate-400">Sorted by usage</span>
                        </div>
                        <div className="overflow-x-auto overflow-y-auto flex-1 custom-scrollbar">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 uppercase tracking-wider font-semibold border-b dark:border-slate-700 sticky top-0">
                                    <tr>
                                        <th className="px-6 py-3">{t('food_cost.table.product')}</th>
                                        <th className="px-6 py-3 text-right">{t('food_cost.table.quantity')}</th>
                                        <th className="px-6 py-3 text-right">Recipe</th>
                                        <th className="px-6 py-3 text-right">{t('food_cost.table.usage')}</th>
                                        <th className="px-6 py-3 text-right">{t('food_cost.meat_table.meat')} Cost</th>
                                        <th className="px-6 py-3 text-right">Total Sales</th>
                                        <th className="px-6 py-3 text-right">{t('food_cost.table.profit')}</th>
                                        <th className="px-6 py-3 text-right">% of Total</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                                    {data.breakdown.map((item, idx) => (
                                        <tr key={`${item.guid}-${idx}`} className="hover:bg-slate-50 dark:hover:bg-slate-750/50">
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
                                            <td className="px-6 py-3 text-right text-red-600 font-mono">
                                                ${(item.costAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </td>
                                            <td className="px-6 py-3 text-right text-blue-600 font-mono">
                                                ${(item.salesAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </td>
                                            <td className="px-6 py-3 text-right text-emerald-600 font-bold font-mono">
                                                ${(item.utilityAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </td>
                                            <td className="px-6 py-3 text-right text-slate-400 text-xs">
                                                {((item.rawLbs / data.totalRawLbs) * 100).toFixed(1)}%
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot className="bg-slate-50 dark:bg-slate-900 border-t-2 border-slate-200 dark:border-slate-700 font-bold text-sm sticky bottom-0 shadow-lg">
                                    <tr>
                                        <td className="px-6 py-4 text-slate-900 dark:text-white">{t('food_cost.table.total')}</td>
                                        <td className="px-6 py-4 text-right font-mono">{data.breakdown.reduce((sum, i) => sum + i.soldQty, 0).toLocaleString()}</td>
                                        <td className="px-6 py-4"></td>
                                        <td className="px-6 py-4 text-right text-slate-900 dark:text-white">{data.totalRawLbs.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                                        <td className="px-6 py-4 text-right text-red-600 font-mono">
                                            ${data.breakdown.reduce((sum, i) => sum + (i.costAmount || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </td>
                                        <td className="px-6 py-4 text-right text-blue-600 font-mono">
                                            ${data.breakdown.reduce((sum, i) => sum + (i.salesAmount || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </td>
                                        <td className="px-6 py-4 text-right text-emerald-600 font-mono">
                                            ${data.breakdown.reduce((sum, i) => sum + (i.utilityAmount || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </td>
                                        <td className="px-6 py-4"></td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
