'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseClient, formatStoreName } from '@/lib/supabase'
import { formatDateLA } from '@/lib/checklistPermissions'
import {
    LayoutDashboard,
    Plus,
    BarChart3,
    Store,
    Users,
    ClipboardList,
    MessageSquare,
    AlertTriangle,
    CheckCircle,
    TrendingUp,
    Activity,
    Target,
    Timer,
    Award,
    Info,
    ShieldAlert
} from 'lucide-react'

export default function DashboardPage() {
    const router = useRouter()
    const [stats, setStats] = useState({
        totalInspections: 0,
        avgInspectionScore: 0,
        avgNPS: 0,
        recentActivity: [] as any[],
        topStores: [] as any[],
        sectionPerformance: [] as any[],
        supervisorStats: [] as any[],
        avgDuration: '0 min',
        recentFeedback: [] as any[]
    })
    const [loading, setLoading] = useState(true)
    const [timeFilter, setTimeFilter] = useState('month')

    useEffect(() => {
        const user = localStorage.getItem('teg_user')
        if (!user) {
            router.push('/')
            return
        }

        // Ejecutar carga inicial
        fetchStats()

        // Auto-refresh cada 30 segundos
        const interval = setInterval(fetchStats, 30000)
        return () => clearInterval(interval)
    }, [router, timeFilter]) // Re-ejecutar cuando cambia el filtro

    const getDateFilter = (filter: string) => {
        const now = new Date()
        now.setHours(0, 0, 0, 0) // Reset time to start of day needed for some calcs

        switch (filter) {
            case 'today':
                return now.toISOString()
            case 'week':
                // Retroceder al último lunes
                const day = now.getDay()
                const diff = now.getDate() - day + (day === 0 ? -6 : 1) // adjust when day is sunday
                const monday = new Date(now.setDate(diff))
                return monday.toISOString()
            case 'month':
                return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
            case 'year':
                return new Date(now.getFullYear(), 0, 1).toISOString()
            default:
                return null // 'all'
        }
    }

    const fetchStats = async () => {
        try {
            const token = localStorage.getItem('teg_token')
            const supabase = await getSupabaseClient()

            if (token) {
                await supabase.auth.setSession({ access_token: token, refresh_token: '' })
            }

            const startDate = getDateFilter(timeFilter)

            // 1. Inspecciones Query
            let queryInspections = supabase
                .from('supervisor_inspections')
                .select(`
          id, overall_score, inspection_date, start_time, end_time, duration, shift,
          service_score, meat_score, food_score, tortilla_score, cleaning_score, log_score, grooming_score,
          store_id, inspector_id,
          stores(name, code),
          users!inspector_id(full_name),
          created_at
        `)
                .order('created_at', { ascending: false })
                .limit(500) // Limit increased for analytics

            if (startDate) {
                // Usar inspection_date (fecha real de operación) en lugar de created_at
                // Cortar a YYYY-MM-DD para comparar correctamente con columna tipo Date
                const dateOnly = startDate.split('T')[0]
                queryInspections = queryInspections.gte('inspection_date', dateOnly)
            }

            const { data: inspections } = await queryInspections


            const validInspections = inspections || []

            // ... (Rest of logic remains similar but uses filtered validInspections)

            const categories = [
                { key: 'service_score', label: 'Servicio' },
                { key: 'meat_score', label: 'Carnes' },
                { key: 'food_score', label: 'Alimentos' },
                { key: 'tortilla_score', label: 'Tortillas' },
                { key: 'cleaning_score', label: 'Limpieza' },
                { key: 'grooming_score', label: 'Personal' }
            ]

            const sectionPerf = categories.map(cat => {
                const scores = validInspections.map((i: any) => i[cat.key]).filter(s => s !== null && s !== undefined)
                const avg = scores.length > 0 ? Math.round(scores.reduce((a: any, b: any) => a + b, 0) / scores.length) : 0
                return { label: cat.label, score: avg }
            }).sort((a, b) => a.score - b.score)

            const supervisorMap: Record<string, any> = {}
            validInspections.forEach((i: any) => {
                const name = i.users?.full_name || 'Desconocido'
                if (!supervisorMap[name]) supervisorMap[name] = { count: 0, totalScore: 0, name }
                supervisorMap[name].count++
                supervisorMap[name].totalScore += i.overall_score || 0
            })

            const supervisorStats = Object.values(supervisorMap).map((s: any) => ({
                name: s.name.split(' ')[0],
                count: s.count,
                avgScore: Math.round(s.totalScore / s.count)
            })).sort((a, b) => b.count - a.count).slice(0, 50)

            let totalMinutes = 0
            let durationCount = 0
            validInspections.forEach((i: any) => {
                if (i.duration) {
                    let mins = 0
                    if (i.duration.includes('h')) {
                        const parts = i.duration.split('h')
                        mins += parseInt(parts[0]) * 60
                        if (parts[1]) mins += parseInt(parts[1])
                    } else {
                        mins = parseInt(i.duration)
                    }
                    if (!isNaN(mins) && mins > 0 && mins < 400) {
                        totalMinutes += mins
                        durationCount++
                    }
                }
            })
            const avgDurationVal = durationCount > 0 ? Math.round(totalMinutes / durationCount) : 0
            const avgDurationStr = avgDurationVal > 60 ? `${Math.floor(avgDurationVal / 60)}h ${avgDurationVal % 60}m` : `${avgDurationVal} min`

            const storeScores: Record<string, { total: number, count: number, name: string }> = {}
            validInspections.forEach((i: any) => {
                const sName = i.stores?.name || 'Unknown'
                if (!storeScores[sName]) storeScores[sName] = { total: 0, count: 0, name: sName }
                storeScores[sName].total += (i.overall_score || 0)
                storeScores[sName].count += 1
            })
            const topStores = Object.values(storeScores).map(s => ({
                name: formatStoreName(s.name),
                avg: Math.round(s.total / s.count)
            })).sort((a, b) => b.avg - a.avg).slice(0, 50)


            // 2. Feedback Query
            let queryFeedback = supabase
                .from('customer_feedback')
                .select('nps_score, comments, submission_date, stores(name)')
                .order('submission_date', { ascending: false })
                .limit(500)

            if (startDate) {
                queryFeedback = queryFeedback.gte('submission_date', startDate)
            }

            const { data: feedbacksRaw } = await queryFeedback

            const feedbacks = feedbacksRaw || []

            // Calculate NPS Logic
            let promoters = 0, detractors = 0, validResponses = 0
            feedbacks.forEach((f: any) => {
                if (f.nps_score !== null && f.nps_score !== undefined) {
                    const score = Number(f.nps_score)
                    if (!isNaN(score)) {
                        validResponses++
                        if (score >= 9) promoters++
                        else if (score <= 6) detractors++
                    }
                }
            })
            const avgNPS = validResponses > 0 ? Math.round(((promoters - detractors) / validResponses) * 100) : 0

            // Map safely to avoid render crashes
            const safeRecentFeedback = feedbacks.map((f: any) => {
                try {
                    const storeData = f.stores
                    // Handle if Supabase returns store as array or object
                    const storeName = Array.isArray(storeData)
                        ? storeData[0]?.name
                        : storeData?.name

                    return {
                        score: f.nps_score || 0,
                        comment: f.comments || '',
                        store: formatStoreName(storeName || 'Tienda'),
                        date: formatDateLA(f.submission_date)
                    }
                } catch (e) {
                    return null
                }
            }).filter(Boolean) // Remove failed items

            setStats({
                totalInspections: validInspections.length,
                avgInspectionScore: validInspections.length > 0
                    ? Math.round(validInspections.reduce((a: any, b: any) => a + (b.overall_score || 0), 0) / validInspections.length)
                    : 0,
                avgNPS,
                recentActivity: validInspections.slice(0, 50).map((i: any) => ({
                    store: formatStoreName(i.stores?.name),
                    user: i.users?.full_name?.split(' ')[0],
                    date: i.inspection_date,
                    score: i.overall_score
                })),
                topStores,
                sectionPerformance: sectionPerf,
                supervisorStats,
                avgDuration: avgDurationStr !== '0 min' ? avgDurationStr : 'N/A',
                recentFeedback: safeRecentFeedback
            })

            setLoading(false)
        } catch (err) {
            console.error(err)
            setLoading(false)
        }
    }

    if (loading) return <div className="flex h-screen items-center justify-center bg-gray-50"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>

    return (
        <div className="bg-[#F8FAFC] min-h-screen font-sans w-full pb-10">

            <header className="bg-white sticky top-0 z-30 px-6 py-4 shadow-[0_1px_3px_rgba(0,0,0,0.05)] flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="bg-slate-900 text-white p-2 rounded-lg">
                        <Target size={20} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-black text-slate-900 tracking-tight leading-none flex items-center gap-2">
                            Dashboard
                            <span className="flex items-center gap-1.5 bg-red-50 text-red-600 px-2.5 py-1 rounded-full text-xs uppercase tracking-wider border border-red-100 font-bold">
                                <span className="relative flex h-2.5 w-2.5">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-600"></span>
                                </span>
                                Live
                            </span>
                        </h1>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Análisis Operativo en Tiempo Real</p>
                    </div>
                </div>

                {/* FILTROS DE TIEMPO */}
                <div className="hidden lg:flex items-center bg-slate-100 p-1 rounded-xl">
                    {[
                        { id: 'all', label: 'Todo' },
                        { id: 'today', label: 'Hoy' },
                        { id: 'week', label: 'Semana' },
                        { id: 'month', label: 'Mes' },
                        { id: 'year', label: 'Año' },
                    ].map((filter) => (
                        <button
                            key={filter.id}
                            onClick={() => setTimeFilter(filter.id)}
                            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${timeFilter === filter.id
                                ? 'bg-white text-slate-900 shadow-sm'
                                : 'text-slate-400 hover:text-slate-600'
                                }`}
                        >
                            {filter.label}
                        </button>
                    ))}
                </div>

                <div className="flex items-center gap-4">
                    <div className="hidden md:flex flex-col items-end mr-4 border-r border-gray-100 pr-4">
                        <span className="text-[10px] font-black text-slate-400 uppercase">Eficiencia Promedio</span>
                        <span className="text-sm font-black text-slate-900 flex items-center gap-1">
                            <Timer size={14} className="text-indigo-600" /> {stats.avgDuration}
                        </span>
                    </div>

                </div>
            </header>

            <main className="w-full mx-auto px-4 md:px-6 py-8 space-y-6">

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="bg-slate-900 rounded-2xl p-6 text-white shadow-xl flex flex-col justify-between relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                            <Activity size={80} />
                        </div>
                        <div className="flex justify-between items-start">
                            <div>
                                <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Score Global</p>
                                <h2 className="text-5xl font-black tracking-tighter mt-1">{stats.avgInspectionScore}<span className="text-2xl text-slate-500">%</span></h2>
                            </div>
                            <div className={`px-2 py-1 rounded text-[10px] font-black uppercase ${stats.avgInspectionScore >= 85 ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                                {stats.avgInspectionScore >= 85 ? 'Objetivo Cumplido' : 'Requiere Atención'}
                            </div>
                        </div>
                        <div className="mt-4 pt-4 border-t border-slate-800 flex justify-between items-end">
                            <div>
                                <p className="text-slate-400 text-[10px] font-bold">NPS Clientes</p>
                                <p className="text-xl font-black">{stats.avgNPS}</p>
                            </div>
                            <div className="text-right">
                                <p className="text-slate-400 text-[10px] font-bold">
                                    {timeFilter === 'today' ? 'Auditorías Hoy' :
                                        timeFilter === 'week' ? 'Auditorías Semana' :
                                            timeFilter === 'month' ? 'Auditorías Mes' :
                                                timeFilter === 'year' ? 'Auditorías Año' : 'Total Auditorías'}
                                </p>
                                <p className="text-xl font-black text-indigo-400">{stats.totalInspections}</p>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm md:col-span-2 flex flex-col">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                                <BarChart3 size={16} className="text-indigo-500" />
                                Desempeño por Categoría
                            </h3>
                            <span className="text-[10px] font-bold text-slate-400 uppercase">Áreas Críticas (Menor a Mayor)</span>
                        </div>
                        <div className="flex-1 grid grid-cols-2 md:grid-cols-3 gap-3">
                            {stats.sectionPerformance.map((cat, i) => (
                                <div key={i} className="bg-slate-50 rounded-xl p-3 border border-slate-100 relative overflow-hidden">
                                    <div className="flex justify-between items-center relative z-10">
                                        <span className="text-xs font-bold text-slate-600">{cat.label}</span>
                                        <span className={`text-sm font-black ${cat.score >= 85 ? 'text-green-600' : cat.score >= 75 ? 'text-yellow-600' : 'text-red-500'}`}>
                                            {cat.score}%
                                        </span>
                                    </div>
                                    <div className="mt-2 w-full bg-slate-200 h-1 rounded-full overflow-hidden relative z-10">
                                        <div className={`h-full rounded-full ${cat.score >= 85 ? 'bg-green-500' : cat.score >= 75 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${cat.score}%` }}></div>
                                    </div>
                                    {cat.score < 75 && <div className="absolute inset-0 bg-red-500/5 z-0 animate-pulse"></div>}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm flex flex-col">
                        <h3 className="font-bold text-slate-900 text-sm mb-4 flex items-center gap-2">
                            <Award size={16} className="text-orange-500" />
                            Top Supervisores
                        </h3>
                        <div className="space-y-3 flex-1 overflow-y-auto pr-1 custom-scrollbar">
                            {stats.supervisorStats.map((sup, i) => (
                                <div key={i} className="flex items-center justify-between text-xs group">
                                    <div className="flex items-center gap-2">
                                        <span className="w-5 h-5 rounded bg-slate-100 text-slate-500 font-bold flex items-center justify-center text-[10px] group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-colors">
                                            {i + 1}
                                        </span>
                                        <span className="font-semibold text-slate-700">{sup.name}</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="text-slate-400 font-medium">{sup.count} insp</span>
                                        <span className="font-black text-slate-900 bg-slate-100 px-1.5 rounded">{sup.avgScore}%</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                    {/* Alerts with Hover Tooltips */}
                    {/* CUSTOMER FEEDBACK WIDGET */}
                    <div className="bg-white rounded-2xl p-0 border border-slate-100 shadow-sm flex flex-col h-[400px] relative">
                        <div className="p-4 border-b border-slate-50 bg-indigo-50/30 flex justify-between items-center">
                            <h3 className="font-bold text-indigo-900 text-sm flex items-center gap-2">
                                <MessageSquare size={16} className="text-indigo-600" />
                                Feedback Clientes
                            </h3>
                            <span className="bg-indigo-100 text-indigo-700 text-[10px] font-black px-2 py-0.5 rounded-full">Últimos {stats.recentFeedback?.length || 0}</span>
                        </div>
                        <div className="flex-1 overflow-y-auto overflow-x-visible p-4 space-y-3 custom-scrollbar">
                            {stats.recentFeedback && stats.recentFeedback.length > 0 ? stats.recentFeedback.map((item: any, i: number) => (
                                <div key={i} className="group relative">
                                    <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex gap-3 hover:border-indigo-200 hover:shadow-md transition-all">
                                        <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-black text-xs ${item.score >= 9 ? 'bg-green-100 text-green-700' : item.score >= 7 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                                            {item.score}
                                        </div>
                                        <div className="flex-1">
                                            <div className="flex justify-between items-start">
                                                <h4 className="font-bold text-slate-800 text-xs">{item.store}</h4>
                                                <span className="text-[10px] text-slate-400 font-medium">{item.date}</span>
                                            </div>
                                            <p className="text-xs text-slate-600 font-medium mt-1 leading-relaxed line-clamp-2 group-hover:line-clamp-none transition-all duration-300">
                                                "{item.comment || 'Sin comentario'}"
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )) : (
                                <div className="h-full flex flex-col items-center justify-center text-slate-300">
                                    <MessageSquare size={40} className="mb-2 text-indigo-100" />
                                    <p className="text-xs font-bold">Sin comentarios recientes</p>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl p-0 border border-slate-100 shadow-sm overflow-hidden flex flex-col h-[400px]">
                        <div className="p-4 border-b border-slate-50 flex justify-between items-center">
                            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                                <Store size={16} className="text-blue-500" />
                                Ranking Sucursales
                            </h3>
                        </div>
                        <div className="flex-1 overflow-y-auto">
                            <table className="w-full text-left text-xs">
                                <thead className="bg-slate-50 text-slate-400 font-bold uppercase sticky top-0">
                                    <tr>
                                        <th className="pl-4 py-3">#</th>
                                        <th className="py-3">Tienda</th>
                                        <th className="pr-4 py-3 text-right">Score</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {stats.topStores.map((store, i) => (
                                        <tr key={i} className="hover:bg-slate-50/50">
                                            <td className="pl-4 py-3 text-slate-400 font-bold w-10">{i + 1}</td>
                                            <td className="py-3 font-semibold text-slate-700">{store.name}</td>
                                            <td className="pr-4 py-3 text-right">
                                                <span className={`font-black px-2 py-0.5 rounded ${store.avg >= 85 ? 'bg-green-100 text-green-700' : store.avg >= 75 ? 'text-yellow-600' : 'text-red-600'}`}>
                                                    {store.avg}%
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl p-0 border border-slate-100 shadow-sm overflow-hidden flex flex-col h-[400px]">
                        <div className="p-4 border-b border-slate-50 flex justify-between items-center bg-indigo-50/30">
                            <h3 className="font-bold text-indigo-900 text-sm flex items-center gap-2">
                                <Activity size={16} className="text-indigo-600" />
                                Última Actividad
                            </h3>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-4">
                            {stats.recentActivity.map((act, i) => (
                                <div key={i} className="flex gap-3 items-start relative pb-4 last:pb-0">
                                    {i !== stats.recentActivity.length - 1 && <div className="absolute left-[11px] top-6 bottom-[-16px] w-[2px] bg-slate-100"></div>}

                                    <div className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center bg-white z-10 ${act.score >= 80 ? 'border-green-500 text-green-500' : 'border-red-500 text-red-500'}`}>
                                        <div className={`w-2 h-2 rounded-full ${act.score >= 80 ? 'bg-green-500' : 'bg-red-500'}`}></div>
                                    </div>
                                    <div>
                                        <p className="text-xs font-bold text-slate-800">{act.store}</p>
                                        <p className="text-[10px] text-slate-500">
                                            Auditado por <span className="font-semibold text-indigo-600">{act.user}</span>
                                        </p>
                                        <span className={`text-[10px] font-black mt-1 inline-block ${act.score >= 80 ? 'text-green-600' : 'text-red-600'}`}>
                                            Resultado: {act.score}%
                                        </span>
                                    </div>
                                    <span className="ml-auto text-xs font-bold text-slate-500">
                                        {formatDateLA(act.date)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                </div>
            </main>
        </div>
    )
}
