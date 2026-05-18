'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseClient, formatStoreName } from '@/lib/supabase'
import { formatDateLA } from '@/lib/checklistPermissions'
import ProtectedRoute from '@/components/ProtectedRoute'
import {
    LayoutDashboard, Plus, BarChart3, Store, Users, ClipboardList,
    MessageSquare, AlertTriangle, CheckCircle, TrendingUp, Activity,
    Target, Timer, Award, Info, ShieldAlert, Camera, ExternalLink,
    DollarSign
} from 'lucide-react'
import SurpriseLoader from '@/components/SurpriseLoader'
import FeedbackReviewModal from '@/components/FeedbackReviewModal'
import DateRangeFilter from '@/components/sales/DateRangeFilter'
import { useLanguage } from '@/lib/i18n'

function DashboardContent() {
    const router = useRouter()
    const { t } = useLanguage()
    const [stats, setStats] = useState({
        totalInspections: 0,
        avgInspectionScore: 0,
        avgNPS: 0,
        recentActivity: [] as any[],
        topStores: [] as any[],
        sectionPerformance: [] as any[],
        supervisorStats: [] as any[],
        avgDuration: '0 min',
        recentFeedback: [] as any[],
        totalSales: 0,
        foodCostPct: 0,
        anomalies: [] as any[]
    })
    const [loading, setLoading] = useState(true)
    const [timeFilter, setTimeFilter] = useState('month')
    const [startDate, setStartDate] = useState(() => {
        const d = new Date()
        if (d.getHours() < 6) d.setDate(d.getDate() - 1) // Business day adjustment
        d.setDate(1) // Start of month
        return d.toISOString().split('T')[0]
    })
    const [endDate, setEndDate] = useState(() => {
        const d = new Date()
        if (d.getHours() < 6) d.setDate(d.getDate() - 1) // Business day adjustment
        return d.toISOString().split('T')[0]
    })
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

    // getDateRange helper removed (logic handled by DateRangeFilter)

    const fetchStats = async () => {
        try {
            const token = localStorage.getItem('teg_token')
            const supabase = await getSupabaseClient()

            if (token) {
                await supabase.auth.setSession({ access_token: token, refresh_token: '' })
            }

            // USE STATE DATES DIRECTLY
            // DateRangeFilter already provides correct start/end strings
            const startDateStr = startDate
            const endDateStr = endDate

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
                // For standard filters, we usually want >= startDate and <= endDate
                // But inspection_date is just a date column, so simple comparison works.
                queryInspections = queryInspections
                    .gte('inspection_date', startDateStr)
                    .lte('inspection_date', endDateStr)
            }

            const { data: inspections } = await queryInspections

            const validInspections = inspections || []

            const categories = [
                { key: 'service_score', label: t('dashboard.cat_service') },
                { key: 'meat_score', label: t('dashboard.cat_meat') },
                { key: 'food_score', label: t('dashboard.cat_food') },
                { key: 'tortilla_score', label: t('dashboard.cat_tortilla') },
                { key: 'cleaning_score', label: t('dashboard.cat_cleaning') },
                { key: 'grooming_score', label: t('dashboard.cat_grooming') }
            ]

            const sectionPerf = categories.map(cat => {
                // Ignore scores that are zero, null, or undefined to avoid skewing averages
                const scores = validInspections
                    .map((i: any) => i[cat.key])
                    .filter(s => s !== null && s !== undefined && s > 0)

                const avg = scores.length > 0
                    ? Math.round(scores.reduce((a: any, b: any) => a + b, 0) / scores.length)
                    : 0
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
                // Construct ISO timestamps from the date strings
                // Start: YYYY-MM-DDT00:00:00
                // End: YYYY-MM-DDT23:59:59 (inclusive)

                // Note: supabase gte/lte on timestamptz works with ISO strings
                const startTs = `${startDateStr}T00:00:00`
                const endTs = `${endDateStr}T23:59:59.999`

                queryFeedback = queryFeedback
                    .gte('submission_date', startTs)
                    .lte('submission_date', endTs)
            }

            const { data: feedbacksRaw } = await queryFeedback

            // 3. Sales + Food Cost + Anomalías (parallel)
            const [{ data: salesRows }, fcCacheRes, { data: anomRows }] = await Promise.all([
                supabase.from('sales_daily_cache').select('net_sales').gte('business_date', startDateStr).lte('business_date', endDateStr),
                fetch(`/api/inventory/food-cost-cache?startDate=${startDateStr}&endDate=${endDateStr}`).then(r => r.json()).catch(() => ({ totalCost: 0, totalSales: 0, costPercentage: 0 })),
                supabase.from('sales_discounts_log').select('store_name, discount_amount, discount_name, business_date, server_name').in('discount_name', ['First Responder Discount', 'Employee Discount', 'Senior Discount', 'Senior']).gte('business_date', startDateStr).lte('business_date', endDateStr).gte('discount_amount', 15).order('id', { ascending: false }).limit(20)
            ])
            const totalSales = salesRows?.reduce((s: number, r: any) => s + Number(r.net_sales || 0), 0) || 0
            const foodCostPct = fcCacheRes?.costPercentage || 0
            const anomalies = (anomRows || []).map((a: any) => ({ store: formatStoreName(a.store_name), amount: Number(a.discount_amount), name: a.discount_name, date: a.business_date, server: a.server_name?.split(' ')[0] || '?' }))

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
                recentFeedback: safeRecentFeedback,
                totalSales,
                foodCostPct,
                anomalies
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
                                {t('dashboard.title')}
                                <span className="hidden sm:flex items-center gap-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 px-3 py-1.5 rounded-full text-[11px] uppercase tracking-widest border border-red-100 dark:border-red-900/30 font-black">
                                    <span className="relative flex h-3 w-3">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-3 w-3 bg-red-600"></span>
                                    </span>
                                    {t('dashboard.live')}
                                </span>
                            </h1>
                            <p className="hidden md:block text-sm font-bold text-slate-400 dark:text-slate-300 uppercase tracking-widest mt-1.5">{t('dashboard.subtitle')}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="hidden lg:block">
                            <DateRangeFilter
                                period={timeFilter}
                                startDate={startDate}
                                endDate={endDate}
                                onChange={(p, s, e) => {
                                    setTimeFilter(p)
                                    setStartDate(s)
                                    setEndDate(e)
                                }}
                            />
                        </div>
                    </div>
                    <div className="hidden md:flex flex-col items-end">
                        <span className="text-[11px] font-black text-slate-400 dark:text-slate-300 uppercase tracking-wider">{t('dashboard.avg_efficiency')}</span>
                        <span className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                            <Timer size={18} className="text-indigo-600 dark:text-indigo-400" /> {stats.avgDuration}
                        </span>
                    </div>
                </div>
                <div className="lg:hidden mt-3">
                    <DateRangeFilter
                        period={timeFilter}
                        startDate={startDate}
                        endDate={endDate}
                        onChange={(p, s, e) => {
                            setTimeFilter(p)
                            setStartDate(s)
                            setEndDate(e)
                        }}
                        className="w-full"
                    />
                </div>
            </header>

            <main className="w-full mx-auto px-4 md:px-6 py-8 space-y-6">
                {/* KPI STRIP */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-slate-900 rounded-2xl p-5 text-white shadow-xl relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity"><DollarSign size={60} /></div>
                        <p className="text-emerald-400 text-[10px] font-black uppercase tracking-widest">Ventas Netas</p>
                        <h2 className="text-3xl md:text-4xl font-black tracking-tighter mt-1">{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(stats.totalSales)}</h2>
                    </div>
                    <div className={`rounded-2xl p-5 text-white shadow-xl relative overflow-hidden group ${stats.foodCostPct > 32 ? 'bg-red-600' : stats.foodCostPct > 28 ? 'bg-amber-600' : 'bg-slate-900'} transition-colors duration-500`}>
                        <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity"><Target size={60} /></div>
                        <p className="text-white/60 text-[10px] font-black uppercase tracking-widest">Food Cost</p>
                        <h2 className="text-3xl md:text-4xl font-black tracking-tighter mt-1">{stats.foodCostPct > 0 ? stats.foodCostPct.toFixed(1) : '--'}<span className="text-xl text-white/40">%</span></h2>
                    </div>
                    <div className="bg-indigo-600 rounded-2xl p-5 text-white shadow-xl relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity"><MessageSquare size={60} /></div>
                        <p className="text-indigo-200 text-[10px] font-black uppercase tracking-widest">{t('dashboard.nps')}</p>
                        <h2 className="text-3xl md:text-4xl font-black tracking-tighter mt-1">{stats.avgNPS}</h2>
                    </div>
                    <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-100 dark:border-slate-800 shadow-sm relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-3 opacity-5 group-hover:opacity-10 transition-opacity text-slate-900 dark:text-white"><ClipboardList size={60} /></div>
                        <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">{timeFilter === 'today' ? t('dashboard.audits_today') : timeFilter === 'week' ? t('dashboard.audits_week') : timeFilter === 'month' ? t('dashboard.audits_month') : t('dashboard.audits_total')}</p>
                        <h2 className="text-3xl md:text-4xl font-black tracking-tighter mt-1 text-slate-900 dark:text-white">{stats.totalInspections} <span className="text-lg text-slate-400">({stats.avgInspectionScore}%)</span></h2>
                    </div>
                </div>

                {/* ROW 2: Anomalies + Supervisors */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="md:col-span-2 bg-white dark:bg-slate-900 rounded-2xl p-0 border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col" style={{maxHeight:'320px'}}>
                        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-red-50/40 dark:bg-red-900/10">
                            <h3 className="font-black text-red-900 dark:text-red-100 text-base flex items-center gap-3"><ShieldAlert size={22} className="text-red-500" /> Radar de Anomalías</h3>
                            <span className="bg-red-500 text-white text-[10px] font-black px-2.5 py-0.5 rounded-full shadow-sm">{stats.anomalies.length}</span>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            {stats.anomalies.length > 0 ? (
                                <table className="w-full text-left">
                                    <thead className="bg-slate-50 dark:bg-slate-800 text-slate-400 font-black text-[10px] uppercase tracking-widest sticky top-0">
                                        <tr><th className="pl-5 py-3">Sucursal</th><th className="py-3">Descuento</th><th className="py-3">Empleado</th><th className="py-3">Fecha</th><th className="pr-5 py-3 text-right">Monto</th></tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                                        {stats.anomalies.map((a: any, i: number) => (
                                            <tr key={i} className="hover:bg-red-50/30 dark:hover:bg-red-900/10 transition-colors">
                                                <td className="pl-5 py-2.5 font-bold text-sm text-slate-800 dark:text-slate-200">{a.store}</td>
                                                <td className="py-2.5 text-xs text-slate-500 dark:text-slate-400">{a.name?.replace(' Discount','')}</td>
                                                <td className="py-2.5 text-xs font-medium text-slate-600 dark:text-slate-300">{a.server}</td>
                                                <td className="py-2.5 text-xs text-slate-400">{formatDateLA(a.date).split(',')[0]}</td>
                                                <td className="pr-5 py-2.5 text-right"><span className="font-black text-red-600 dark:text-red-400 text-sm">${a.amount.toFixed(2)}</span></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center py-10 text-slate-300"><CheckCircle size={36} className="mb-2 text-green-200" /><p className="text-xs font-bold text-slate-400">Sin anomalías detectadas</p></div>
                            )}
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-100 dark:border-slate-800 shadow-sm flex flex-col" style={{maxHeight:'320px'}}>
                        <h3 className="font-black text-slate-900 dark:text-white text-lg mb-6 flex items-center gap-3"><Award size={24} className="text-orange-500" /> {t('dashboard.top_supervisors')}</h3>
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
                                {t('dashboard.customer_feedback')}
                                <ExternalLink size={14} className="text-indigo-400 opacity-50" />
                            </h3>
                            <span className="bg-indigo-600 text-white text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-tighter shadow-md shadow-indigo-100">{t('dashboard.latest')} {stats.recentFeedback?.length || 0}</span>
                        </div>
                        <div className="flex-1 overflow-y-auto overflow-x-visible p-4 space-y-3 custom-scrollbar">
                            {stats.recentFeedback && stats.recentFeedback.length > 0 ? stats.recentFeedback.map((item: any, i: number) => (
                                <div key={i} className="group relative">
                                    <div
                                        onClick={() => { setSelectedFeedback(item); setIsModalOpen(true); }}
                                        className="bg-white dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl p-4 shadow-sm flex gap-4 hover:border-indigo-400 dark:hover:border-indigo-500 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer"
                                    >
                                        <div className={`shrink-0 w-12 h-12 rounded-2xl shadow-inner flex items-center justify-center font-black text-lg ${item.source === 'google' ? 'bg-white border border-gray-100 shadow-sm' : item.score >= 9 ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : item.score >= 7 ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'}`}>
                                            {item.source === 'google' ? (
                                                <svg viewBox="0 0 24 24" className="w-6 h-6" xmlns="http://www.w3.org/2000/svg">
                                                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                                                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                                                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                                                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                                                </svg>
                                            ) : (
                                                item.score
                                            )}
                                        </div>                                        <div className="flex-1">
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
                                <div className="h-full flex flex-col items-center justify-center text-slate-300"><MessageSquare size={40} className="mb-2 text-indigo-100" /><p className="text-xs font-bold">{t('dashboard.no_comments')}</p></div>
                            )}
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900 rounded-2xl p-0 border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col h-[400px]">
                        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex flex-col bg-white dark:bg-slate-900">
                            <h3 className="font-black text-slate-900 dark:text-white text-base flex items-center gap-3"><Store size={22} className="text-blue-600 dark:text-blue-400" /> Ranking Auditoría</h3>
                            <span className="text-[11px] font-bold text-slate-400 mt-1">Score promedio de inspecciones</span>
                        </div>
                        <div className="flex-1 overflow-x-auto overflow-y-auto custom-scrollbar">
                            <table className="w-full text-left">
                                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-black text-[11px] uppercase tracking-widest sticky top-0 z-10">
                                    <tr><th className="pl-6 py-4">#</th><th className="py-4">{t('dashboard.store')}</th><th className="pr-6 py-4 text-right">{t('dashboard.score')}</th></tr>
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
                            <h3 className="font-black text-indigo-950 dark:text-indigo-100 text-base flex items-center gap-3"><Activity size={22} className="text-indigo-600 dark:text-indigo-400" /> {t('dashboard.activity_history')}</h3>
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
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">{t('dashboard.audit_by')} <span className="font-black text-slate-700 dark:text-slate-300">{act.user}</span></p>
                                        <span className={`text-xs font-black mt-2 inline-flex items-center px-2 py-0.5 rounded-md shadow-inner ${act.score >= 80 ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'}`}>{t('dashboard.score')}: {act.score}%</span>
                                    </div>
                                    <div className="flex flex-col items-end gap-1">
                                        <span className="text-[11px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest bg-slate-50 dark:bg-slate-800 px-2 py-1 rounded-lg self-start">{formatDateLA(act.date)}</span>
                                        <span className="text-[10px] font-bold text-indigo-400 dark:text-indigo-300 opacity-0 group-hover:opacity-100 transition-opacity">{t('dashboard.view_detail')} →</span>
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
                    currentUser={user || { id: '', full_name: 'Loading...', role: '' }}
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
