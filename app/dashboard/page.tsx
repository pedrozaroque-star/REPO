'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseClient, formatStoreName } from '@/lib/supabase'
import { formatDateLA } from '@/lib/checklistPermissions'
import ProtectedRoute from '@/components/ProtectedRoute'
import {
    LayoutDashboard, Plus, BarChart3, Store, Users, ClipboardList,
    MessageSquare, AlertTriangle, CheckCircle, TrendingUp, Activity,
    Target, Timer, Award, Info, ShieldAlert, Camera, ExternalLink
} from 'lucide-react'
import SurpriseLoader from '@/components/SurpriseLoader'
import FeedbackReviewModal from '@/components/FeedbackReviewModal'

function DashboardContent() {
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
    const [startDate, setStartDate] = useState(() => new Date().toISOString().split('T')[0])
    const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])
    const [selectedFeedback, setSelectedFeedback] = useState<any>(null)
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [user, setUser] = useState<any>(null)

    useEffect(() => {
        const fetchUser = async () => {
            const token = localStorage.getItem('teg_token')
            const supabase = await getSupabaseClient()

            if (token) {
                await supabase.auth.setSession({ access_token: token, refresh_token: '' })
            }

            const { data: { user: authUser } } = await supabase.auth.getUser()

            if (authUser) {
                const { data: dbUser } = await supabase.from('users').select('*').eq('id', authUser.id).single()
                if (dbUser) {
                    setUser({
                        ...dbUser,
                        name: dbUser.full_name,
                        email: authUser.email
                    })
                }
            }
        }
        fetchUser()
    }, [])

    useEffect(() => {
        // Ejecutar carga inicial
        fetchStats()

        // Auto-refresh cada 30 segundos (solo si no es custom range, para evitar refreshes molestos mientras editas fechas)
        if (timeFilter !== 'custom') {
            const interval = setInterval(fetchStats, 30000)
            return () => clearInterval(interval)
        }
    }, [router, timeFilter, startDate, endDate]) // Re-run when dates change if in custom mode

    const getDateRange = (filter: string) => {
        const now = new Date()
        const end = new Date(now)
        let start = new Date(now)

        if (filter === 'custom') {
            return {
                start: startDate ? new Date(startDate) : new Date(now.setHours(0, 0, 0, 0)),
                end: endDate ? new Date(endDate) : new Date(now)
            }
        }

        // Reset hours for standard filters
        start.setHours(0, 0, 0, 0)

        switch (filter) {
            case 'today':
                // Start is today 00:00, End is now
                break
            case 'week':
                const day = now.getDay()
                const diff = now.getDate() - day + (day === 0 ? -6 : 1)
                start.setDate(diff)
                break
            case 'month':
                start.setDate(1)
                break
            case 'year':
                start.setMonth(0, 1)
                break
            case 'all':
                start = new Date('2020-01-01') // Way back
                break
        }
        return { start, end }
    }

    const fetchStats = async () => {
        try {
            const token = localStorage.getItem('teg_token')
            const supabase = await getSupabaseClient()

            if (token) {
                await supabase.auth.setSession({ access_token: token, refresh_token: '' })
            }



            const { start, end } = getDateRange(timeFilter)
            const startIso = start.toISOString() // full ISO
            const endIso = end.toISOString()   // full ISO for filters that support time

            // For date-only columns (inspection_date)
            const startDateStr = startIso.split('T')[0]
            const endDateStr = endIso.split('T')[0]

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
                .limit(500)

            if (timeFilter !== 'all') {
                if (timeFilter === 'custom') {
                    // Inclusive range
                    queryInspections = queryInspections
                        .gte('inspection_date', startDateStr)
                        .lte('inspection_date', endDateStr)
                } else {
                    // Standard filters: usually "from start of period until now"
                    queryInspections = queryInspections.gte('inspection_date', startDateStr)
                }
            }

            const { data: inspections } = await queryInspections
            const validInspections = inspections || []

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

            const storeScores: Record<string, { total: number, count: number, name: string, storeId: string }> = {}
            validInspections.forEach((i: any) => {
                const sName = i.stores?.name || 'Unknown'
                const sId = i.store_id || ''
                if (!storeScores[sName]) storeScores[sName] = { total: 0, count: 0, name: sName, storeId: sId }
                storeScores[sName].total += (i.overall_score || 0)
                storeScores[sName].count += 1
            })
            const topStores = Object.values(storeScores).map(s => ({
                name: formatStoreName(s.name),
                avg: Math.round(s.total / s.count),
                storeId: s.storeId
            })).sort((a, b) => b.avg - a.avg).slice(0, 50)

            // 2. Feedback Query
            let queryFeedback = supabase
                .from('customer_feedback')
                .select('*, stores(name,code,city,state)')
                .order('submission_date', { ascending: false })
                .limit(500)

            if (timeFilter !== 'all') {
                if (timeFilter === 'custom') {
                    // For timestamps, make sure end covers the whole day using explicit string construction
                    // endDateStr is YYYY-MM-DD from the input/state. We apppend end of day time.
                    // This avoids timezone shifting issues with Date.setHours on UTC dates.
                    const endFullDayIso = `${endDateStr}T23:59:59.999Z`

                    queryFeedback = queryFeedback
                        .gte('submission_date', startIso)
                        .lte('submission_date', endFullDayIso)
                } else {
                    queryFeedback = queryFeedback.gte('submission_date', startIso)
                }
            }

            const { data: feedbacksRaw } = await queryFeedback
            const feedbacks = feedbacksRaw || []

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

            const safeRecentFeedback = feedbacks.map((f: any) => {
                try {
                    const storeData = f.stores
                    const storeName = Array.isArray(storeData) ? storeData[0]?.name : storeData?.name
                    return {
                        ...f, // Keep all original data for the modal
                        score: f.nps_score || 0,
                        comment: f.comments || '',
                        store: formatStoreName(storeName || 'Tienda'),
                        date: formatDateLA(f.submission_date)
                    }
                } catch (e) { return null }
            }).filter(Boolean)

            setStats({
                totalInspections: validInspections.length,
                avgInspectionScore: validInspections.length > 0
                    ? Math.round(validInspections.reduce((a: any, b: any) => a + (b.overall_score || 0), 0) / validInspections.length)
                    : 0,
                avgNPS,
                recentActivity: validInspections.slice(0, 50).map((i: any) => ({
                    id: i.id,
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

    if (loading) return <SurpriseLoader />

    return (
        <div className="bg-transparent min-h-screen font-sans w-full pb-10">
            <header className="bg-white/70 dark:bg-slate-900/40 backdrop-blur-md sticky top-0 z-30 px-4 md:px-6 py-4 shadow-[0_1px_3px_rgba(0,0,0,0.05)] border-b border-gray-100 dark:border-slate-800">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="bg-slate-900 dark:bg-red-600 text-white p-3 rounded-xl shadow-lg shadow-slate-200 dark:shadow-none">
                            <Target size={28} />
                        </div>
                        <div>
                            <h1 className="text-2xl md:text-3xl font-black text-slate-900 dark:text-white tracking-tighter leading-none flex items-center gap-3">
                                Dashboard
                                <span className="hidden sm:flex items-center gap-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 px-3 py-1.5 rounded-full text-[11px] uppercase tracking-widest border border-red-100 dark:border-red-900/30 font-black">
                                    <span className="relative flex h-3 w-3">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-3 w-3 bg-red-600"></span>
                                    </span>
                                    En Vivo
                                </span>
                            </h1>
                            <p className="hidden md:block text-sm font-bold text-slate-400 dark:text-slate-300 uppercase tracking-widest mt-1.5">Análisis Operativo en Tiempo Real</p>
                        </div>
                    </div>
                    <div className="hidden lg:flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                        {[
                            { id: 'all', label: 'Todo' }, { id: 'today', label: 'Hoy' }, { id: 'week', label: 'Semana' },
                            { id: 'month', label: 'Mes' }, { id: 'year', label: 'Año' }, { id: 'custom', label: 'Rango' }
                        ].map((filter) => (
                            <button key={filter.id} onClick={() => setTimeFilter(filter.id)} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${timeFilter === filter.id ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm' : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-400'}`}>{filter.label}</button>
                        ))}
                    </div>

                    {timeFilter === 'custom' && (
                        <div className="hidden lg:flex items-center gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl ml-2 animate-in slide-in-from-left-2">
                            <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className="bg-white dark:bg-slate-900 border-none rounded-lg px-2 py-1 text-xs font-bold text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none"
                            />
                            <span className="text-slate-400 font-bold text-xs">-</span>
                            <input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className="bg-white dark:bg-slate-900 border-none rounded-lg px-2 py-1 text-xs font-bold text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none"
                            />
                        </div>
                    )}
                    <div className="hidden md:flex flex-col items-end">
                        <span className="text-[11px] font-black text-slate-400 dark:text-slate-300 uppercase tracking-wider">Eficiencia Promedio</span>
                        <span className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                            <Timer size={18} className="text-indigo-600 dark:text-indigo-400" /> {stats.avgDuration}
                        </span>
                    </div>
                </div>
                <div className="lg:hidden mt-3 gap-2 flex flex-col">
                    <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl overflow-x-auto">
                        {[{ id: 'all', label: 'Todo' }, { id: 'today', label: 'Hoy' }, { id: 'week', label: 'Semana' }, { id: 'month', label: 'Mes' }, { id: 'year', label: 'Año' }, { id: 'custom', label: 'Rango' }].map((filter) => (
                            <button key={filter.id} onClick={() => setTimeFilter(filter.id)} className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${timeFilter === filter.id ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm' : 'text-slate-400 dark:text-slate-500 active:text-slate-600'}`}>{filter.label}</button>
                        ))}
                    </div>
                    {timeFilter === 'custom' && (
                        <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 p-2 rounded-xl">
                            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full bg-white dark:bg-slate-900 rounded px-2 py-1 text-xs" />
                            <span className="text-slate-400">-</span>
                            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full bg-white dark:bg-slate-900 rounded px-2 py-1 text-xs" />
                        </div>
                    )}
                </div>
            </header>

            <main className="w-full mx-auto px-4 md:px-6 py-8 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="bg-slate-900 rounded-2xl p-6 text-white shadow-xl flex flex-col justify-between relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity"><Activity size={80} /></div>
                        <div className="flex justify-between items-start">
                            <div>
                                <p className="text-slate-400 dark:text-slate-300 text-xs font-black uppercase tracking-widest">Score Global</p>
                                <h2 className="text-7xl font-black tracking-tighter mt-1">{stats.avgInspectionScore}<span className="text-3xl text-slate-500">%</span></h2>
                            </div>
                            <div className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wide shadow-lg ${stats.avgInspectionScore >= 85 ? 'bg-green-500 text-white' : 'bg-yellow-500 text-white'}`}>{stats.avgInspectionScore >= 85 ? 'Buen Desempeño' : 'Alerta Roja'}</div>
                        </div>
                        <div className="mt-6 pt-6 border-t border-slate-800 flex justify-between items-end">
                            <div>
                                <p className="text-slate-400 dark:text-slate-300 text-xs font-bold uppercase tracking-wide">NPS Clientes</p>
                                <p className="text-3xl font-black">{stats.avgNPS}</p>
                            </div>
                            <div className="text-right">
                                <p className="text-slate-400 dark:text-slate-300 text-xs font-bold uppercase tracking-wide">
                                    {timeFilter === 'today' ? 'Auditorías Hoy' : timeFilter === 'week' ? 'Auditorías Semana' : timeFilter === 'month' ? 'Auditorías Mes' : timeFilter === 'year' ? 'Auditorías Año' : 'Total Auditorías'}
                                </p>
                                <p className="text-3xl font-black text-indigo-400">{stats.totalInspections}</p>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-100 dark:border-slate-800 shadow-sm md:col-span-2 flex flex-col">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="font-black text-slate-900 dark:text-white text-lg flex items-center gap-3"><BarChart3 size={24} className="text-indigo-500" /> Desempeño por Categoría</h3>
                            <span className="text-xs font-black text-slate-400 dark:text-slate-300 uppercase tracking-widest">Áreas de Enfoque</span>
                        </div>
                        <div className="flex-1 grid grid-cols-2 md:grid-cols-3 gap-4">
                            {stats.sectionPerformance.map((cat, i) => (
                                <div key={i} className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700 relative overflow-hidden flex flex-col justify-center">
                                    <div className="flex justify-between items-center relative z-10 mb-2">
                                        <span className="text-xs font-black text-slate-500 dark:text-slate-300 uppercase tracking-wide">{cat.label}</span>
                                        <span className={`text-xl font-black ${cat.score >= 85 ? 'text-green-600 dark:text-green-400' : cat.score >= 75 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-500 dark:text-red-400'}`}>{cat.score}%</span>
                                    </div>
                                    <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden relative z-10">
                                        <div className={`h-full rounded-full transition-all duration-1000 ${cat.score >= 85 ? 'bg-green-500' : cat.score >= 75 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${cat.score}%` }}></div>
                                    </div>
                                    {cat.score < 75 && <div className="absolute inset-0 bg-red-500/5 z-0 animate-pulse"></div>}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-100 dark:border-slate-800 shadow-sm flex flex-col">
                        <h3 className="font-black text-slate-900 dark:text-white text-lg mb-6 flex items-center gap-3"><Award size={24} className="text-orange-500" /> Top Supervisores</h3>
                        <div className="space-y-4 flex-1 overflow-y-auto pr-1 custom-scrollbar">
                            {stats.supervisorStats.map((sup, i) => (
                                <div key={i} className="flex items-center justify-between text-sm group">
                                    <div className="flex items-center gap-3">
                                        <span className="w-6 h-6 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-black flex items-center justify-center text-[11px] group-hover:bg-indigo-600 group-hover:text-white transition-all transform group-hover:scale-110 shadow-sm">{i + 1}</span>
                                        <span className="font-bold text-slate-700 dark:text-slate-200 text-base">{sup.name}</span>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <span className="text-slate-400 dark:text-slate-300 font-bold uppercase text-[10px] tracking-widest">{sup.count} INSP</span>
                                        <span className="font-black text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-lg text-sm shadow-sm group-hover:bg-indigo-50 dark:group-hover:bg-slate-700 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">{sup.avgScore}%</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl p-0 border border-slate-100 dark:border-slate-800 shadow-sm flex flex-col h-[400px] relative">
                        <div className="p-5 border-b border-slate-100 dark:border-slate-800 bg-indigo-50/40 dark:bg-indigo-900/10 flex justify-between items-center">
                            <h3 onClick={() => router.push('/feedback')} className="font-black text-indigo-950 dark:text-indigo-100 text-base flex items-center gap-3 cursor-pointer hover:text-indigo-600 transition-colors">
                                <MessageSquare size={20} className="text-indigo-600 dark:text-indigo-400" />
                                Feedback de Clientes
                                <ExternalLink size={14} className="text-indigo-400 opacity-50" />
                            </h3>
                            <span className="bg-indigo-600 text-white text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-tighter shadow-md shadow-indigo-100">Últimos {stats.recentFeedback?.length || 0}</span>
                        </div>
                        <div className="flex-1 overflow-y-auto overflow-x-visible p-4 space-y-3 custom-scrollbar">
                            {stats.recentFeedback && stats.recentFeedback.length > 0 ? stats.recentFeedback.map((item: any, i: number) => (
                                <div key={i} className="group relative">
                                    <div
                                        onClick={() => { setSelectedFeedback(item); setIsModalOpen(true); }}
                                        className="bg-white dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl p-4 shadow-sm flex gap-4 hover:border-indigo-400 dark:hover:border-indigo-500 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer"
                                    >
                                        <div className={`shrink-0 w-12 h-12 rounded-2xl shadow-inner flex items-center justify-center font-black text-lg ${item.score >= 9 ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : item.score >= 7 ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'}`}>{item.score}</div>
                                        <div className="flex-1">
                                            <div className="flex justify-between items-start mb-1">
                                                <h4 className="font-black text-indigo-900 dark:text-indigo-100 text-sm tracking-tight flex items-center">
                                                    {item.store}
                                                    {item.source === 'google' && (
                                                        <svg viewBox="0 0 24 24" className="w-4 h-4 ml-2" xmlns="http://www.w3.org/2000/svg">
                                                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                                                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                                                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                                                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                                                        </svg>
                                                    )}
                                                </h4>
                                                <div className="flex items-center gap-1.5">
                                                    {item.photo_urls && item.photo_urls.length > 0 && (
                                                        <Camera size={16} className="text-indigo-500" strokeWidth={2.5} />
                                                    )}
                                                    <span className="text-[11px] text-slate-400 dark:text-slate-300 font-black uppercase tracking-widest">{item.date}</span>
                                                </div>
                                            </div>
                                            <p className="text-sm text-slate-700 dark:text-slate-300 font-medium leading-relaxed group-hover:text-slate-900 dark:group-hover:text-white transition-colors">"{item.comment || 'Sin comentario'}"</p>
                                        </div>
                                    </div>
                                </div>
                            )) : (
                                <div className="h-full flex flex-col items-center justify-center text-slate-300"><MessageSquare size={40} className="mb-2 text-indigo-100" /><p className="text-xs font-bold">Sin comentarios recientes</p></div>
                            )}
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900 rounded-2xl p-0 border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col h-[400px]">
                        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-white dark:bg-slate-900">
                            <h3 className="font-black text-slate-900 dark:text-white text-base flex items-center gap-3"><Store size={22} className="text-blue-600 dark:text-blue-400" /> Ranking de Sucursales</h3>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            <table className="w-full text-left">
                                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-black text-[11px] uppercase tracking-widest sticky top-0 z-10">
                                    <tr><th className="pl-6 py-4">#</th><th className="py-4">Tienda</th><th className="pr-6 py-4 text-right">Score</th></tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {stats.topStores.map((store, i) => (
                                        <tr
                                            key={i}
                                            onClick={() => router.push(`/inspecciones?store=${store.storeId}`)}
                                            className="hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-colors group cursor-pointer"
                                        >
                                            <td className="pl-6 py-4 text-slate-400 dark:text-slate-500 font-black text-sm w-12">{i + 1}</td>
                                            <td className="py-4 font-bold text-slate-800 dark:text-slate-200 text-base group-hover:text-blue-700 dark:group-hover:text-blue-400 transition-colors">{store.name}</td>
                                            <td className="pr-6 py-4 text-right"><span className={`font-black px-3 py-1 rounded-lg text-sm shadow-sm ${store.avg >= 85 ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : store.avg >= 75 ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'}`}>{store.avg}%</span></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900 rounded-2xl p-0 border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col h-[400px]">
                        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-indigo-50/40 dark:bg-indigo-900/10">
                            <h3 className="font-black text-indigo-950 dark:text-indigo-100 text-base flex items-center gap-3"><Activity size={22} className="text-indigo-600 dark:text-indigo-400" /> Historial de Actividad</h3>
                        </div>
                        <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar">
                            {stats.recentActivity.map((act, i) => (
                                <div key={i} onClick={() => router.push(`/inspecciones?openId=${act.id}`)} className="flex gap-4 items-start relative px-2 pt-2 pb-6 last:pb-0 group cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 -mx-2 rounded-xl transition-all">
                                    {i !== stats.recentActivity.length - 1 && <div className="absolute left-[22px] top-10 bottom-[-24px] w-[3px] bg-slate-100 dark:bg-slate-800 rounded-full"></div>}
                                    <div className={`shrink-0 w-7 h-7 rounded-full border-4 flex items-center justify-center bg-white dark:bg-slate-900 z-10 shadow-sm transition-transform group-hover:scale-125 ${act.score >= 80 ? 'border-green-500 text-green-500' : 'border-red-500 text-red-500'}`}>
                                        <div className={`w-2.5 h-2.5 rounded-full ${act.score >= 80 ? 'bg-green-500' : 'bg-red-500'} animate-pulse`}></div>
                                    </div>
                                    <div className="flex-1">
                                        <p className="text-sm font-black text-slate-900 dark:text-white leading-none group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors uppercase tracking-tight">{act.store}</p>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">Auditoría de <span className="font-black text-slate-700 dark:text-slate-300">{act.user}</span></p>
                                        <span className={`text-xs font-black mt-2 inline-flex items-center px-2 py-0.5 rounded-md shadow-inner ${act.score >= 80 ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'}`}>Score: {act.score}%</span>
                                    </div>
                                    <div className="flex flex-col items-end gap-1">
                                        <span className="text-[11px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest bg-slate-50 dark:bg-slate-800 px-2 py-1 rounded-lg self-start">{formatDateLA(act.date)}</span>
                                        <span className="text-[10px] font-bold text-indigo-400 dark:text-indigo-300 opacity-0 group-hover:opacity-100 transition-opacity">Ver detalle →</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </main>

            {selectedFeedback && (
                <FeedbackReviewModal
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    feedback={selectedFeedback}
                    currentUser={user || { id: '', full_name: 'Cargando...', role: '' }}
                    onUpdate={fetchStats}
                />
            )}
        </div>
    )
}

export default function DashboardPage() {
    return (
        <ProtectedRoute allowedRoles={['manager', 'supervisor', 'admin', 'auditor']}>
            <DashboardContent />
        </ProtectedRoute>
    )
}
