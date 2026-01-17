'use client'

import React, { useState, useEffect, useMemo } from 'react'
import ProtectedRoute from '@/components/ProtectedRoute'
import { Download, TrendingUp, AlertOctagon, UserCheck, ArrowUpRight, ArrowDownRight, Search, Printer, ChevronRight } from 'lucide-react'
import { getSupabaseClient, formatStoreName } from '@/lib/supabase'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import * as XLSX from 'xlsx'
import SurpriseLoader from '@/components/SurpriseLoader'

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

    if (loading) return <SurpriseLoader />

    return (
        <div className="flex bg-transparent dark:bg-neutral-900 text-gray-900 dark:text-white font-sans w-full animate-in fade-in duration-500 relative overflow-hidden min-h-screen">
            <div className="absolute inset-0 opacity-10 dark:opacity-40 pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
            <div className="flex-1 flex flex-col h-full w-full relative pl-0 md:pl-0">

                {/* 1. COMPACT HEADER BAR */}
                <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-gray-200 dark:border-slate-800 px-4 md:px-8 py-4 flex flex-col md:flex-row justify-between items-center gap-4 sticky top-14 md:top-0 z-20 shadow-sm transition-all">
                    <div className="flex items-center gap-3 w-full md:w-auto">
                        <div className="p-2 bg-slate-900 dark:bg-red-600 text-white rounded-lg">
                            <TrendingUp size={20} />
                        </div>
                        <div>
                            <h1 className="text-lg md:text-xl font-black text-gray-900 dark:text-white leading-none">Inteligencia Operativa</h1>
                            <p className="text-[10px] font-black text-gray-400 dark:text-slate-500 mt-1 uppercase tracking-widest">Reporte Consolidado</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 overflow-x-auto w-full md:w-auto pb-2 md:pb-0 hide-scrollbar">
                        <div className="flex bg-gray-100 dark:bg-slate-800 p-1 rounded-lg shrink-0">
                            {['week', 'month', 'quarter', 'year'].map(r => (
                                <button
                                    key={r}
                                    onClick={() => setTimeRange(r)}
                                    className={`px-3 py-1.5 text-[10px] font-black rounded-md transition-all uppercase tracking-wider ${timeRange === r ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300'}`}
                                >
                                    {r === 'week' ? 'Sem' : r === 'month' ? 'Mes' : r === 'quarter' ? 'QTD' : 'Año'}
                                </button>
                            ))}
                        </div>
                        <button onClick={exportExcel} className="p-2 text-gray-500 dark:text-slate-400 hover:text-green-600 dark:hover:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors border border-transparent hover:border-green-200 dark:hover:border-green-800 shrink-0" title="Exportar Excel">
                            <Download size={20} />
                        </button>
                    </div>
                </div>

                <div className="p-4 md:p-8 space-y-4 md:space-y-8 overflow-y-auto pb-24 no-scrollbar">

                    {/* 2. STORE PERFORMANCE MATRIX (THE CORE REPORT) */}
                    <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-3xl shadow-sm border border-gray-100 dark:border-slate-800 overflow-hidden transition-all">
                        <div className="px-4 md:px-6 py-4 border-b border-gray-100 dark:border-slate-800 flex flex-col md:flex-row justify-between items-start md:items-center bg-gray-50/50 dark:bg-slate-800/30 gap-3">
                            <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
                                <TrendingUp size={16} className="text-blue-500 dark:text-blue-400" />
                                Matriz de Rendimiento
                            </h3>
                            <div className="relative w-full md:w-auto">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-600" />
                                <input
                                    type="text"
                                    placeholder="Filtrar sucursal..."
                                    className="pl-8 pr-4 py-2 text-xs bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:border-blue-400 dark:focus:border-blue-600 text-gray-900 dark:text-white font-medium w-full md:w-64"
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* DESKTOP TABLE */}
                        <div className="hidden md:block overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-gray-50 dark:bg-slate-800/50 text-gray-500 dark:text-slate-400 font-black uppercase text-[10px] tracking-widest">
                                    <tr>
                                        <th className="px-6 py-4">Sucursal</th>
                                        <th className="px-6 py-4 text-center">Score Global</th>
                                        <th className="px-6 py-4 text-center">Tendencia</th>
                                        <th className="px-6 py-4 text-center text-blue-500 dark:text-blue-400">Servicio</th>
                                        <th className="px-6 py-4 text-center text-purple-500 dark:text-purple-400">Limpieza</th>
                                        <th className="px-6 py-4 text-center text-orange-500 dark:text-orange-400">Producto</th>
                                        <th className="px-6 py-4 text-center">Auditorías</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                                    {storeMatrix.filter(s => s.name.toLowerCase().includes(searchTerm.toLowerCase())).map((store) => (
                                        <tr key={store.id} className="hover:bg-blue-50/30 dark:hover:bg-slate-800/50 transition-colors group">
                                            <td className="px-6 py-4 font-black text-gray-900 dark:text-white group-hover:text-blue-700 dark:group-hover:text-blue-400">
                                                {store.name}
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <ScoreBadge score={store.avgScore} />
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <div className={`flex items-center justify-center gap-1 font-black ${store.trend >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                                                    {store.trend > 0 ? <ArrowUpRight size={14} /> : store.trend < 0 ? <ArrowDownRight size={14} /> : '-'}
                                                    {store.trend !== 0 && Math.abs(store.trend)}%
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-center text-gray-600 dark:text-slate-300 font-bold">{store.service}%</td>
                                            <td className="px-6 py-4 text-center text-gray-600 dark:text-slate-300 font-bold">{store.hygiene}%</td>
                                            <td className="px-6 py-4 text-center text-gray-600 dark:text-slate-300 font-bold">{store.product}%</td>
                                            <td className="px-6 py-4 text-center text-gray-400 dark:text-slate-500 font-medium">{store.inspections}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* MOBILE CARDS */}
                        <div className="md:hidden divide-y divide-gray-100 dark:divide-slate-800">
                            {storeMatrix.filter(s => s.name.toLowerCase().includes(searchTerm.toLowerCase())).map((store) => (
                                <div key={store.id} className="p-4 active:bg-gray-50 dark:active:bg-slate-800">
                                    <div className="flex justify-between items-start mb-3">
                                        <div className="font-black text-gray-900 dark:text-white">{store.name}</div>
                                        <ScoreBadge score={store.avgScore} />
                                    </div>
                                    <div className="grid grid-cols-3 gap-2 text-center mb-3">
                                        <div className="bg-blue-50 dark:bg-blue-900/20 p-2 rounded-xl">
                                            <div className="text-[9px] text-blue-400 dark:text-blue-500 font-black uppercase">Servicio</div>
                                            <div className="font-black text-blue-700 dark:text-blue-400">{store.service}%</div>
                                        </div>
                                        <div className="bg-purple-50 dark:bg-purple-900/20 p-2 rounded-xl">
                                            <div className="text-[9px] text-purple-400 dark:text-purple-500 font-black uppercase">Limpieza</div>
                                            <div className="font-black text-purple-700 dark:text-purple-400">{store.hygiene}%</div>
                                        </div>
                                        <div className="bg-orange-50 dark:bg-orange-900/20 p-2 rounded-xl">
                                            <div className="text-[9px] text-orange-400 dark:text-orange-500 font-black uppercase">Producto</div>
                                            <div className="font-black text-orange-700 dark:text-orange-400">{store.product}%</div>
                                        </div>
                                    </div>
                                    <div className="flex justify-between items-center text-[10px] text-gray-400 dark:text-slate-500 font-bold">
                                        <span>{store.inspections} auditorías</span>
                                        <div className={`flex items-center gap-1 ${store.trend >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                                            {store.trend > 0 ? <ArrowUpRight size={12} /> : store.trend < 0 ? <ArrowDownRight size={12} /> : '-'}
                                            {store.trend !== 0 && Math.abs(store.trend)}% vs mes ant.
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-8">

                        {/* 3. COMMON FAILURES REPORT */}
                        <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-3xl shadow-sm border border-gray-100 dark:border-slate-800 flex flex-col overflow-hidden transition-all">
                            <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-800 flex justify-between items-center bg-red-50/30 dark:bg-red-900/10">
                                <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
                                    <AlertOctagon size={16} className="text-red-500" />
                                    Top 5 Incidencias
                                </h3>
                                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
                            </div>
                            <div className="p-4 md:p-6 flex-1">
                                {failureAnalysis.length > 0 ? (
                                    <div className="space-y-4">
                                        {failureAnalysis.map((fail, idx) => (
                                            <div key={idx} className="flex items-center justify-between p-4 rounded-2xl bg-gray-50/50 dark:bg-slate-800/50 border border-gray-100 dark:border-slate-800 group hover:border-red-200 dark:hover:border-red-900/50 transition-all">
                                                <div className="flex-1 pr-4">
                                                    <div className="text-[9px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest mb-1">{fail.section}</div>
                                                    <div className="text-sm font-bold text-gray-800 dark:text-slate-200 leading-tight group-hover:text-red-600 dark:group-hover:text-red-400 transition-colors">{fail.label}</div>
                                                </div>
                                                <div className="flex flex-col items-center justify-center bg-white dark:bg-slate-900 w-12 h-12 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800 shrink-0">
                                                    <span className="text-sm font-black text-red-500 dark:text-red-400">{fail.count}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="h-full flex items-center justify-center text-gray-400 dark:text-slate-500 font-bold uppercase tracking-widest text-xs italic">
                                        Sin fallas detectadas 🌟
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* 4. SUPERVISOR METRICS */}
                        <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-3xl shadow-sm border border-gray-100 dark:border-slate-800 overflow-hidden transition-all">
                            <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-800 bg-purple-50/30 dark:bg-purple-900/10">
                                <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
                                    <UserCheck size={16} className="text-purple-500" />
                                    Actividad de Supervisores
                                </h3>
                            </div>
                            <div className="p-6">
                                <div className="h-[250px] w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={supervisorStats} layout="vertical" barSize={12} margin={{ left: 0, right: 20 }}>
                                            <XAxis type="number" hide />
                                            <YAxis dataKey="name" type="category" width={90} tick={{ fontSize: 10, fontWeight: 700, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                                            <Tooltip
                                                cursor={{ fill: 'rgba(148, 163, 184, 0.1)' }}
                                                contentStyle={{ backgroundColor: '#0F172A', borderRadius: '12px', border: 'none', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)', color: '#F8FAFC' }}
                                                itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
                                            />
                                            <Bar dataKey="count" name="Inspecciones" radius={[0, 4, 4, 0]}>
                                                {supervisorStats.map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={index % 2 === 0 ? '#8B5CF6' : '#6366F1'} />
                                                ))}
                                            </Bar>
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
    let colorClass = 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-900/50'
    if (score >= 90) colorClass = 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-900/50'
    else if (score >= 80) colorClass = 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-900/50'

    return (
        <span className={`px-2.5 py-1 rounded-lg text-xs font-black border ${colorClass}`}>
            {score}%
        </span>
    )
}

function keyIsSystem(key: string) {
    return key.startsWith('_') || key === 'undefined'
}
