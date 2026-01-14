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

            <header className="bg-white sticky top-0 z-30 px-4 md:px-6 py-4 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="bg-slate-900 text-white p-3 rounded-xl shadow-lg shadow-slate-200">
                            <Target size={28} />
                        </div>
                        <div>
                            <h1 className="text-2xl md:text-4xl font-black text-slate-900 tracking-tighter leading-none flex items-center gap-3">
                                Dashboard
                                <span className="hidden sm:flex items-center gap-2 bg-red-50 text-red-600 px-3 py-1.5 rounded-full text-[11px] uppercase tracking-widest border border-red-100 font-black">
                                    <span className="relative flex h-3 w-3">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-3 w-3 bg-red-600"></span>
                                    </span>
                                    En Vivo
                                </span>
                            </h1>
                            <p className="hidden md:block text-sm font-bold text-slate-400 uppercase tracking-widest mt-1.5">Análisis Operativo en Tiempo Real</p>
                        </div>
                    </div>

                    {/* FILTROS DE TIEMPO - Desktop (derecha del header) */}
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

                    {/* Eficiencia Promedio - Hidden on mobile */}
                    <div className="hidden md:flex flex-col items-end">
                        <span className="text-[11px] font-black text-slate-400 uppercase tracking-wider">Eficiencia Promedio</span>
                        <span className="text-lg font-black text-slate-900 flex items-center gap-2">
                            <Timer size={18} className="text-indigo-600" /> {stats.avgDuration}
                        </span>
                    </div>
                </div>

                {/* FILTROS DE TIEMPO - Mobile (debajo del título) */}
                <div className="lg:hidden mt-3 flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl overflow-x-auto">
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
                            className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${timeFilter === filter.id
                                ? 'bg-white text-slate-900 shadow-sm'
                                : 'text-slate-400 active:text-slate-600'
                                }`}
                        >
                            {filter.label}
                        </button>
                    ))}
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
                                <p className="text-slate-400 text-xs font-black uppercase tracking-widest">Score Global</p>
                                <h2 className="text-7xl font-black tracking-tighter mt-1">{stats.avgInspectionScore}<span className="text-3xl text-slate-500">%</span></h2>
                            </div>
                            <div className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wide shadow-lg ${stats.avgInspectionScore >= 85 ? 'bg-green-500 text-white' : 'bg-yellow-500 text-white'}`}>
                                {stats.avgInspectionScore >= 85 ? 'Buen Desempeño' : 'Alerta Roja'}
                            </div>
                        </div>
                        <div className="mt-6 pt-6 border-t border-slate-800 flex justify-between items-end">
                            <div>
                                <p className="text-slate-400 text-xs font-bold uppercase tracking-wide">NPS Clientes</p>
                                <p className="text-3xl font-black">{stats.avgNPS}</p>
                            </div>
                            <div className="text-right">
                                <p className="text-slate-400 text-xs font-bold uppercase tracking-wide">
                                    {timeFilter === 'today' ? 'Auditorías Hoy' :
                                        timeFilter === 'week' ? 'Auditorías Semana' :
                                            timeFilter === 'month' ? 'Auditorías Mes' :
                                                timeFilter === 'year' ? 'Auditorías Año' : 'Total Auditorías'}
                                </p>
                                <p className="text-3xl font-black text-indigo-400">{stats.totalInspections}</p>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm md:col-span-2 flex flex-col">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="font-black text-slate-900 text-lg flex items-center gap-3">
                                <BarChart3 size={24} className="text-indigo-500" />
                                Desempeño por Categoría
                            </h3>
                            <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Áreas de Enfoque</span>
                        </div>
                        <div className="flex-1 grid grid-cols-2 md:grid-cols-3 gap-4">
                            {stats.sectionPerformance.map((cat, i) => (
                                <div key={i} className="bg-slate-50 rounded-2xl p-4 border border-slate-100 relative overflow-hidden flex flex-col justify-center">
                                    <div className="flex justify-between items-center relative z-10 mb-2">
                                        <span className="text-xs font-black text-slate-500 uppercase tracking-wide">{cat.label}</span>
                                        <span className={`text-xl font-black ${cat.score >= 85 ? 'text-green-600' : cat.score >= 75 ? 'text-yellow-600' : 'text-red-500'}`}>
                                            {cat.score}%
                                        </span>
                                    </div>
                                    <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden relative z-10">
                                        <div className={`h-full rounded-full transition-all duration-1000 ${cat.score >= 85 ? 'bg-green-500' : cat.score >= 75 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${cat.score}%` }}></div>
                                    </div>
                                    {cat.score < 75 && <div className="absolute inset-0 bg-red-500/5 z-0 animate-pulse"></div>}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm flex flex-col">
                        <h3 className="font-black text-slate-900 text-lg mb-6 flex items-center gap-3">
                            <Award size={24} className="text-orange-500" />
                            Top Supervisores
                        </h3>
                        <div className="space-y-4 flex-1 overflow-y-auto pr-1 custom-scrollbar">
                            {stats.supervisorStats.map((sup, i) => (
                                <div key={i} className="flex items-center justify-between text-sm group">
                                    <div className="flex items-center gap-3">
                                        <span className="w-6 h-6 rounded-lg bg-slate-100 text-slate-600 font-black flex items-center justify-center text-[11px] group-hover:bg-indigo-600 group-hover:text-white transition-all transform group-hover:scale-110 shadow-sm">
                                            {i + 1}
                                        </span>
                                        <span className="font-bold text-slate-700 text-base">{sup.name}</span>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <span className="text-slate-400 font-bold uppercase text-[10px] tracking-widest">{sup.count} INSP</span>
                                        <span className="font-black text-slate-900 bg-slate-100 px-2 py-1 rounded-lg text-sm shadow-sm group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors">{sup.avgScore}%</span>
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
                        <div className="p-5 border-b border-slate-100 bg-indigo-50/40 flex justify-between items-center">
                            <h3 className="font-black text-indigo-950 text-base flex items-center gap-3">
                                <MessageSquare size={20} className="text-indigo-600" />
                                Feedback de Clientes
                            </h3>
                            <span className="bg-indigo-600 text-white text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-tighter shadow-md shadow-indigo-100">Últimos {stats.recentFeedback?.length || 0}</span>
                        </div>
                        <div className="flex-1 overflow-y-auto overflow-x-visible p-4 space-y-3 custom-scrollbar">
                            {stats.recentFeedback && stats.recentFeedback.length > 0 ? stats.recentFeedback.map((item: any, i: number) => (
                                <div key={i} className="group relative">
                                    <div className="bg-white border-2 border-slate-100 rounded-2xl p-4 shadow-sm flex gap-4 hover:border-indigo-400 hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
                                        <div className={`shrink-0 w-12 h-12 rounded-2xl shadow-inner flex items-center justify-center font-black text-lg ${item.score >= 9 ? 'bg-green-100 text-green-700' : item.score >= 7 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                                            {item.score}
                                        </div>
                                        <div className="flex-1">
                                            <div className="flex justify-between items-start mb-1">
                                                <h4 className="font-black text-indigo-900 text-sm tracking-tight">{item.store}</h4>
                                                <span className="text-[11px] text-slate-400 font-black uppercase tracking-widest">{item.date}</span>
                                            </div>
                                            <p className="text-sm text-slate-700 font-medium leading-relaxed group-hover:text-slate-900 transition-colors">
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
                        <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-white">
                            <h3 className="font-black text-slate-900 text-base flex items-center gap-3">
                                <Store size={22} className="text-blue-600" />
                                Ranking de Sucursales
                            </h3>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            <table className="w-full text-left">
                                <thead className="bg-slate-50 text-slate-500 font-black text-[11px] uppercase tracking-widest sticky top-0 z-10">
                                    <tr>
                                        <th className="pl-6 py-4">#</th>
                                        <th className="py-4">Tienda</th>
                                        <th className="pr-6 py-4 text-right">Score</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {stats.topStores.map((store, i) => (
                                        <tr key={i} className="hover:bg-blue-50/50 transition-colors group">
                                            <td className="pl-6 py-4 text-slate-400 font-black text-sm w-12">{i + 1}</td>
                                            <td className="py-4 font-bold text-slate-800 text-base group-hover:text-blue-700 transition-colors">{store.name}</td>
                                            <td className="pr-6 py-4 text-right">
                                                <span className={`font-black px-3 py-1 rounded-lg text-sm shadow-sm ${store.avg >= 85 ? 'bg-green-100 text-green-700' : store.avg >= 75 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
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
                        <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-indigo-50/40">
                            <h3 className="font-black text-indigo-950 text-base flex items-center gap-3">
                                <Activity size={22} className="text-indigo-600" />
                                Historial de Actividad
                            </h3>
                        </div>
                        <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar">
                            {stats.recentActivity.map((act, i) => (
                                <div key={i} className="flex gap-4 items-start relative pb-6 last:pb-0 group">
                                    {i !== stats.recentActivity.length - 1 && <div className="absolute left-[13px] top-8 bottom-[-24px] w-[3px] bg-slate-100 rounded-full"></div>}

                                    <div className={`shrink-0 w-7 h-7 rounded-full border-4 flex items-center justify-center bg-white z-10 shadow-sm transition-transform group-hover:scale-125 ${act.score >= 80 ? 'border-green-500 text-green-500' : 'border-red-500 text-red-500'}`}>
                                        <div className={`w-2.5 h-2.5 rounded-full ${act.score >= 80 ? 'bg-green-500' : 'bg-red-500'} animate-pulse`}></div>
                                    </div>
                                    <div className="flex-1">
                                        <p className="text-sm font-black text-slate-900 leading-none group-hover:text-indigo-600 transition-colors uppercase tracking-tight">{act.store}</p>
                                        <p className="text-xs text-slate-500 mt-1 font-medium">
                                            Auditoría de <span className="font-black text-slate-700">{act.user}</span>
                                        </p>
                                        <span className={`text-xs font-black mt-2 inline-flex items-center px-2 py-0.5 rounded-md shadow-inner ${act.score >= 80 ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                                            Score: {act.score}%
                                        </span>
                                    </div>
                                    <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest bg-slate-50 px-2 py-1 rounded-lg self-start">
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
