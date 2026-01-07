'use client'

import React, { useState, useEffect, useMemo } from 'react'
import ProtectedRoute from '@/components/ProtectedRoute'
import { Download, TrendingUp, AlertOctagon, UserCheck, ArrowUpRight, ArrowDownRight, Search, Printer, ChevronRight } from 'lucide-react'
import { getSupabaseClient, formatStoreName } from '@/lib/supabase'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import * as XLSX from 'xlsx'

// --- TYPES ---
interface Inspection {
    id: number
    store_id: number
    overall_score: number
    inspection_date: string
    supervisor_name: string
    answers: any
    service_score: number
    meat_score: number
    food_score: number
    cleaning_score: number
}

interface StoreData {
    id: number
    name: string
}

interface AssistantChecklist {
    id: number
    store_id: number
    store_name: string
    checklist_type: string
    score: number
    created_at: string
    user_name: string
    answers: any
}

export default function ReportesPage() {
    return (
        <ProtectedRoute>
            <ReportesContent />
        </ProtectedRoute>
    )
}

function ReportesContent() {
    const [loading, setLoading] = useState(true)
    const [inspections, setInspections] = useState<Inspection[]>([])
    const [assistantChecks, setAssistantChecks] = useState<AssistantChecklist[]>([])
    const [stores, setStores] = useState<StoreData[]>([])
    const [timeRange, setTimeRange] = useState('month')
    const [searchTerm, setSearchTerm] = useState('')

    useEffect(() => {
        fetchData()
    }, [timeRange])

    const fetchData = async () => {
        setLoading(true)
        const supabase = await getSupabaseClient()

        const { data: storesList } = await supabase.from('stores').select('id, name')
        setStores(storesList || [])

        let query = supabase.from('supervisor_inspections').select('*').order('inspection_date', { ascending: false })

        // Date Filtering
        const now = new Date()
        const start = new Date()
        if (timeRange === 'week') start.setDate(now.getDate() - 7)
        if (timeRange === 'month') start.setMonth(now.getMonth() - 1)
        if (timeRange === 'quarter') start.setMonth(now.getMonth() - 3)
        if (timeRange === 'year') start.setFullYear(now.getFullYear() - 1)

        if (timeRange !== 'all') query = query.gte('inspection_date', start.toISOString())
        const { data: inspData } = await query
        setInspections(inspData || [])

        // Fetch Assistant Checklists
        let aQuery = supabase.from('assistant_checklists').select('*').order('created_at', { ascending: false })
        if (timeRange !== 'all') aQuery = aQuery.gte('created_at', start.toISOString())
        const { data: assistData } = await aQuery
        setAssistantChecks(assistData || [])

        setLoading(false)
    }

    // --- ANALYTICS ENGINES ---

    // 1. Store Performance Matrix
    const storeMatrix = useMemo(() => {
        const matrix: any[] = []
        stores.forEach(store => {
            const storeInsps = inspections.filter(i => i.store_id === store.id)
            const storeAssist = assistantChecks.filter(a => a.store_id === store.id)

            if (storeInsps.length === 0 && storeAssist.length === 0) return

            const totalScoreSum = storeInsps.reduce((acc, curr) => acc + curr.overall_score, 0) +
                storeAssist.reduce((acc, curr) => acc + (curr.score || 0), 0)
            const totalCount = storeInsps.length + storeAssist.length
            const avg = Math.round(totalScoreSum / totalCount)

            // Trend Estimate (Supervisor scores are usually more stable for trends)
            const lastScore = storeInsps[0]?.overall_score || storeAssist[0]?.score || 0
            const trend = lastScore - avg

            // Cat Averages (Weighted towards Supervisor inspections for specific categories)
            const service = Math.round(storeInsps.reduce((acc, curr) => acc + (curr.service_score || 0), 0) / (storeInsps.length || 1))
            const hygiene = Math.round(storeInsps.reduce((acc, curr) => acc + (curr.cleaning_score || 0), 0) / (storeInsps.length || 1))

            // For product, we can blend in temperature compliance
            const tempCompliant = storeAssist.filter(a => a.checklist_type === 'temperaturas' && a.score === 100).length
            const tempTotal = storeAssist.filter(a => a.checklist_type === 'temperaturas').length
            const tempScore = tempTotal > 0 ? Math.round((tempCompliant / tempTotal) * 100) : 100

            const product = Math.round((
                storeInsps.reduce((acc, curr) => acc + (curr.food_score || 0), 0) + (tempTotal > 0 ? tempScore : 0)
            ) / ((storeInsps.length || 0) + (tempTotal > 0 ? 1 : 0) || 1))

            matrix.push({
                id: store.id,
                name: formatStoreName(store.name),
                inspections: totalCount,
                avgScore: avg,
                trend,
                service,
                hygiene,
                product
            })
        })
        return matrix.sort((a, b) => b.avgScore - a.avgScore)
    }, [inspections, assistantChecks, stores])

    // 2. Failure Analysis (Top Failed Questions)
    const failureAnalysis = useMemo(() => {
        const failures: Record<string, { count: number, section: string }> = {}

        // 1. Scan Supervisor Inspections
        inspections.forEach(insp => {
            if (!insp.answers) return
            Object.entries(insp.answers).forEach(([sectionKey, sectionData]: [string, any]) => {
                if (keyIsSystem(sectionKey)) return
                if (sectionData.items) {
                    Object.values(sectionData.items).forEach((item: any) => {
                        const label = item.label || 'Pregunta desconocida'
                        const val = item.score !== undefined ? item.score : item
                        if (val === 0 || val === 'NO') {
                            if (!failures[label]) failures[label] = { count: 0, section: sectionKey }
                            failures[label].count++
                        }
                    })
                }
            })
        })

        // 2. Scan Assistant Checklists (Temps & Daily)
        assistantChecks.forEach(check => {
            if (!check.answers) return
            Object.entries(check.answers).forEach(([key, val]: [string, any]) => {
                if (keyIsSystem(key)) return
                const rawVal = typeof val === 'object' ? val.value : val

                let isFail = false
                if (check.checklist_type === 'temperaturas') {
                    const num = Number(rawVal)
                    const isRefrig = key.toLowerCase().includes('refrig') || key.toLowerCase().includes('frio')
                    isFail = isRefrig ? (num < 34 || num > 41) : (num < 165)
                } else {
                    if (rawVal === 'NO') isFail = true
                }

                if (isFail) {
                    if (!failures[key]) failures[key] = { count: 0, section: check.checklist_type || 'Assistant' }
                    failures[key].count++
                }
            })
        })

        return Object.entries(failures)
            .map(([label, data]) => ({ label, ...data }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5)
    }, [inspections, assistantChecks])

    // 3. Supervisor Audit
    const supervisorStats = useMemo(() => {
        const sups: Record<string, { count: number, avgGiven: number }> = {}
        inspections.forEach(i => {
            const name = i.supervisor_name || 'Desconocido'
            if (!sups[name]) sups[name] = { count: 0, avgGiven: 0 }
            sups[name].count++
            sups[name].avgGiven += i.overall_score
        })
        return Object.entries(sups).map(([name, data]) => ({
            name,
            count: data.count,
            avg: Math.round(data.avgGiven / data.count)
        })).sort((a, b) => b.count - a.count)
    }, [inspections])


    const exportExcel = () => {
        const wb = XLSX.utils.book_new()

        // Sheet 1: Store Matrix
        const ws1 = XLSX.utils.json_to_sheet(storeMatrix)
        XLSX.utils.book_append_sheet(wb, ws1, "Rendimiento Tiendas")

        // Sheet 2: Failures
        const ws2 = XLSX.utils.json_to_sheet(failureAnalysis)
        XLSX.utils.book_append_sheet(wb, ws2, "Fallas Comunes")

        XLSX.writeFile(wb, `Reporte_Calidad_${new Date().toISOString().split('T')[0]}.xlsx`)
    }

    return (
        <div className="flex bg-transparent text-gray-900 font-sans w-full animate-in fade-in duration-500">
            <div className="flex-1 flex flex-col h-full w-full relative pl-0 md:pl-0">

                {/* 1. COMPACT HEADER BAR */}
                <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-4 flex flex-col md:flex-row justify-between items-center gap-4 sticky top-14 lg:top-0 z-20 shadow-sm">
                    <div className="flex items-center gap-3 w-full md:w-auto">
                        <div className="p-2 bg-slate-900 text-white rounded-lg">
                            <TrendingUp size={20} />
                        </div>
                        <div>
                            <h1 className="text-lg md:text-xl font-black text-gray-900 leading-none">Inteligencia Operativa</h1>
                            <p className="text-xs font-bold text-gray-400 mt-1 uppercase tracking-wide">Reporte Consolidado</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 overflow-x-auto w-full md:w-auto pb-2 md:pb-0 hide-scrollbar">
                        <div className="flex bg-gray-100 p-1 rounded-lg shrink-0">
                            {['week', 'month', 'quarter', 'year'].map(r => (
                                <button
                                    key={r}
                                    onClick={() => setTimeRange(r)}
                                    className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all uppercase ${timeRange === r ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                                >
                                    {r === 'week' ? 'Sem' : r === 'month' ? 'Mes' : r === 'quarter' ? 'QTD' : 'Año'}
                                </button>
                            ))}
                        </div>
                        <button onClick={exportExcel} className="p-2 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors border border-transparent hover:border-green-200 shrink-0" title="Exportar Excel">
                            <Download size={20} />
                        </button>
                    </div>
                </div>

                <div className="p-4 md:p-8 space-y-4 md:space-y-8 overflow-y-auto pb-24 no-scrollbar">

                    {/* 2. STORE PERFORMANCE MATRIX (THE CORE REPORT) */}
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                        <div className="px-4 md:px-6 py-4 border-b border-gray-100 flex flex-col md:flex-row justify-block md:justify-between items-start md:items-center bg-gray-50/50 gap-3">
                            <h3 className="font-bold text-gray-800 flex items-center gap-2">
                                <TrendingUp size={16} className="text-blue-500" />
                                Matriz de Rendimiento
                            </h3>
                            <div className="relative w-full md:w-auto">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                    type="text"
                                    placeholder="Filtrar..."
                                    className="pl-8 pr-4 py-1.5 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-blue-400 font-medium w-full"
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* DESKTOP TABLE (Hidden on Mobile) */}
                        <div className="hidden md:block overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-gray-50 text-gray-500 font-bold uppercase text-xs">
                                    <tr>
                                        <th className="px-6 py-3">Sucursal</th>
                                        <th className="px-6 py-3 text-center text-xs">Score Global</th>
                                        <th className="px-6 py-3 text-center text-xs">Tendencia</th>
                                        <th className="px-6 py-3 text-center text-xs text-blue-500">Servicio</th>
                                        <th className="px-6 py-3 text-center text-xs text-purple-500">Limpieza</th>
                                        <th className="px-6 py-3 text-center text-xs text-orange-500">Producto/Temps</th>
                                        <th className="px-6 py-3 text-center text-xs"># Auditorías</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {storeMatrix.filter(s => s.name.toLowerCase().includes(searchTerm.toLowerCase())).map((store) => (
                                        <tr key={store.id} className="hover:bg-blue-50/30 transition-colors group">
                                            <td className="px-6 py-4 font-bold text-gray-900 group-hover:text-blue-700">
                                                {store.name}
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <ScoreBadge score={store.avgScore} />
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <div className={`flex items-center justify-center gap-1 font-bold ${store.trend >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                                    {store.trend > 0 ? <ArrowUpRight size={14} /> : store.trend < 0 ? <ArrowDownRight size={14} /> : '-'}
                                                    {store.trend !== 0 && Math.abs(store.trend)}%
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-center text-gray-600 font-medium">{store.service}%</td>
                                            <td className="px-6 py-4 text-center text-gray-600 font-medium">{store.hygiene}%</td>
                                            <td className="px-6 py-4 text-center text-gray-600 font-medium">{store.product}%</td>
                                            <td className="px-6 py-4 text-center text-gray-400 font-medium">{store.inspections}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* MOBILE CARDS (Visible only on Mobile) */}
                        <div className="md:hidden divide-y divide-gray-100">
                            {storeMatrix.filter(s => s.name.toLowerCase().includes(searchTerm.toLowerCase())).map((store) => (
                                <div key={store.id} className="p-4 active:bg-gray-50">
                                    <div className="flex justify-between items-start mb-3">
                                        <div className="font-bold text-gray-900">{store.name}</div>
                                        <ScoreBadge score={store.avgScore} />
                                    </div>
                                    <div className="grid grid-cols-3 gap-2 text-center mb-3">
                                        <div className="bg-blue-50 p-2 rounded-lg">
                                            <div className="text-[10px] text-blue-400 font-bold uppercase">Servicio</div>
                                            <div className="font-black text-blue-700">{store.service}%</div>
                                        </div>
                                        <div className="bg-purple-50 p-2 rounded-lg">
                                            <div className="text-[10px] text-purple-400 font-bold uppercase">Limpieza</div>
                                            <div className="font-black text-purple-700">{store.hygiene}%</div>
                                        </div>
                                        <div className="bg-orange-50 p-2 rounded-lg">
                                            <div className="text-[10px] text-orange-400 font-bold uppercase">Producto</div>
                                            <div className="font-black text-orange-700">{store.product}%</div>
                                        </div>
                                    </div>
                                    <div className="flex justify-between items-center text-xs text-gray-400 font-medium">
                                        <span>{store.inspections} visitas</span>
                                        <div className={`flex items-center gap-1 ${store.trend >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                            {store.trend > 0 ? <ArrowUpRight size={14} /> : store.trend < 0 ? <ArrowDownRight size={14} /> : '-'}
                                            {store.trend !== 0 && Math.abs(store.trend)}% vs mes pasado
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {storeMatrix.length === 0 && (
                            <div className="p-12 text-center text-gray-400 font-medium">No hay datos para el periodo seleccionado.</div>
                        )}
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-8">

                        {/* 3. COMMON FAILURES REPORT (TOP ISSUES) */}
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 flex flex-col">
                            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-red-50/30">
                                <h3 className="font-bold text-gray-800 flex items-center gap-2">
                                    <AlertOctagon size={16} className="text-red-500" />
                                    Top 5 Incidencias
                                </h3>
                                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
                            </div>
                            <div className="p-4 md:p-6 flex-1">
                                {failureAnalysis.length > 0 ? (
                                    <div className="space-y-4">
                                        {failureAnalysis.map((fail, idx) => (
                                            <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-gray-50 border border-gray-100">
                                                <div className="flex-1 pr-4">
                                                    <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">{fail.section}</div>
                                                    <div className="text-sm font-bold text-gray-800 leading-tight">{fail.label}</div>
                                                </div>
                                                <div className="flex flex-col items-center justify-center bg-white w-10 h-10 rounded-lg shadow-sm border border-gray-100 shrink-0">
                                                    <span className="text-sm font-black text-red-500">{fail.count}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="h-full flex items-center justify-center text-gray-400 font-medium">
                                        Excelente trabajo. No se detectaron fallas recurrentes. 🌟
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* 4. SUPERVISOR METRICS (AUDIT THE AUDITOR) */}
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-200">
                            <div className="px-6 py-4 border-b border-gray-100 bg-purple-50/30">
                                <h3 className="font-bold text-gray-800 flex items-center gap-2">
                                    <UserCheck size={16} className="text-purple-500" />
                                    Actividad de Supervisores
                                </h3>
                            </div>
                            <div className="p-6">
                                <div className="h-[250px] w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={supervisorStats} layout="vertical" barSize={12} margin={{ left: 0, right: 20 }}>
                                            <XAxis type="number" hide />
                                            <YAxis dataKey="name" type="category" width={90} tick={{ fontSize: 10, fontWeight: 600, fill: '#64748B' }} axisLine={false} tickLine={false} />
                                            <Tooltip cursor={{ fill: '#F1F5F9' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                                            <Bar dataKey="count" name="Inspecciones" fill="#8B5CF6" radius={[0, 4, 4, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </div>

                    </div>

                </div>
            </div>
        </div>
    )
}

function ScoreBadge({ score }: { score: number }) {
    let colorClass = 'bg-red-100 text-red-700'
    if (score >= 90) colorClass = 'bg-green-100 text-green-700'
    else if (score >= 80) colorClass = 'bg-yellow-100 text-yellow-700'

    return (
        <span className={`px-2.5 py-1 rounded-md text-xs font-black border border-transparent ${colorClass}`}>
            {score}%
        </span>
    )
}

function keyIsSystem(key: string) {
    return key.startsWith('_') || key === 'undefined'
}
