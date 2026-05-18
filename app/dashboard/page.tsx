'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseClient, formatStoreName } from '@/lib/supabase'
import { formatDateLA } from '@/lib/checklistPermissions'
import ProtectedRoute from '@/components/ProtectedRoute'
import {
    Activity, DollarSign, Target, ClipboardList, ShieldAlert, AlertTriangle, MessageSquare, ExternalLink, Zap, CheckCircle
} from 'lucide-react'
import SurpriseLoader from '@/components/SurpriseLoader'
import FeedbackReviewModal from '@/components/FeedbackReviewModal'
import DateRangeFilter from '@/components/sales/DateRangeFilter'
import { useLanguage } from '@/lib/i18n'

function DashboardContent() {
    const router = useRouter()
    const { t } = useLanguage()
    const [stats, setStats] = useState({
        sales: 0,
        foodCost: 0,
        nps: 0,
        audit: 0,
        matrix: [] as any[],
        radarFeed: [] as any[]
    })
    const [loading, setLoading] = useState(true)
    const [timeFilter, setTimeFilter] = useState('month')
    const [startDate, setStartDate] = useState(() => {
        const d = new Date()
        if (d.getHours() < 6) d.setDate(d.getDate() - 1)
        d.setDate(1)
        return d.toISOString().split('T')[0]
    })
    const [endDate, setEndDate] = useState(() => {
        const d = new Date()
        if (d.getHours() < 6) d.setDate(d.getDate() - 1)
        return d.toISOString().split('T')[0]
    })
    const [selectedFeedback, setSelectedFeedback] = useState<any>(null)
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [user, setUser] = useState<any>(null)

    useEffect(() => {
        const fetchUser = async () => {
            const token = localStorage.getItem('teg_token')
            const supabase = await getSupabaseClient()
            if (token) await supabase.auth.setSession({ access_token: token, refresh_token: '' })
            const { data: { user: authUser } } = await supabase.auth.getUser()
            if (authUser) {
                const { data: dbUser } = await supabase.from('users').select('*').eq('id', authUser.id).single()
                if (dbUser) setUser({ ...dbUser, name: dbUser.full_name, email: authUser.email })
            }
        }
        fetchUser()
    }, [])

    useEffect(() => {
        fetchStats()
        if (timeFilter !== 'custom') {
            const interval = setInterval(fetchStats, 60000)
            return () => clearInterval(interval)
        }
    }, [router, timeFilter, startDate, endDate])

    const fetchStats = async () => {
        try {
            const token = localStorage.getItem('teg_token')
            const supabase = await getSupabaseClient()
            if (token) await supabase.auth.setSession({ access_token: token, refresh_token: '' })

            const startTs = `${startDate}T00:00:00`
            const endTs = `${endDate}T23:59:59.999`

            // Parallel fetching for performance
            const [
                { data: salesData },
                { data: fcData },
                { data: fbData },
                { data: inspData },
                { data: anomaliesData }
            ] = await Promise.all([
                supabase.from('sales_daily_cache').select('store_id, store_name, net_sales').gte('business_date', startDate).lte('business_date', endDate),
                supabase.from('food_cost_daily_cache').select('store_id, store_name, total_cost, total_sales').gte('business_date', startDate).lte('business_date', endDate),
                supabase.from('customer_feedback').select('id, store_id, nps_score, comments, submission_date, stores(name)').gte('submission_date', startTs).lte('submission_date', endTs).order('submission_date', { ascending: false }),
                supabase.from('supervisor_inspections').select('id, store_id, overall_score, inspection_date, stores(name)').gte('inspection_date', startDate).lte('inspection_date', endDate).order('inspection_date', { ascending: false }),
                supabase.from('sales_discounts_log').select('id, store_name, discount_amount, discount_name, business_date, server_name').in('discount_name', ['First Responder Discount', 'Employee Discount', 'Senior Discount', 'Senior']).gte('business_date', startDate).lte('business_date', endDate).gte('discount_amount', 15).order('id', { ascending: false }).limit(50)
            ]);

            const fleet: Record<string, any> = {};
            const ensureStore = (id: string, name: string) => {
                if (!id) return;
                if (!fleet[id]) fleet[id] = { id, name: formatStoreName(name), sales: 0, fcCost: 0, fcSales: 0, npsProm: 0, npsDet: 0, npsCount: 0, inspScore: 0, inspCount: 0 };
            };

            salesData?.forEach(s => {
                ensureStore(s.store_id, s.store_name);
                fleet[s.store_id].sales += Number(s.net_sales || 0);
            });

            fcData?.forEach(f => {
                ensureStore(f.store_id, f.store_name);
                fleet[f.store_id].fcCost += Number(f.total_cost || 0);
                fleet[f.store_id].fcSales += Number(f.total_sales || 0);
            });

            let totalNpsCount = 0;
            let totalNpsProm = 0;
            let totalNpsDet = 0;
            const radarFeed: any[] = [];

            fbData?.forEach(f => {
                const score = Number(f.nps_score);
                if (!isNaN(score)) {
                    totalNpsCount++;
                    if (score >= 9) totalNpsProm++;
                    else if (score <= 6) totalNpsDet++;

                    if (f.store_id) {
                        const storeName = Array.isArray(f.stores) ? f.stores[0]?.name : f.stores?.name;
                        ensureStore(f.store_id, storeName || 'Tienda');
                        fleet[f.store_id].npsCount++;
                        if (score >= 9) fleet[f.store_id].npsProm++;
                        else if (score <= 6) fleet[f.store_id].npsDet++;
                    }

                    if (score <= 6) {
                        radarFeed.push({
                            type: 'feedback',
                            date: f.submission_date,
                            store: formatStoreName(Array.isArray(f.stores) ? f.stores[0]?.name : f.stores?.name),
                            score: score,
                            desc: f.comments ? `"${f.comments}"` : 'Sin comentarios',
                            raw: f
                        });
                    }
                }
            });

            let totalInspScore = 0;
            let totalInspCount = 0;

            inspData?.forEach(i => {
                const score = Number(i.overall_score);
                if (!isNaN(score) && score > 0) {
                    totalInspScore += score;
                    totalInspCount++;

                    if (i.store_id) {
                        const storeName = Array.isArray(i.stores) ? i.stores[0]?.name : i.stores?.name;
                        ensureStore(i.store_id, storeName || 'Tienda');
                        fleet[i.store_id].inspScore += score;
                        fleet[i.store_id].inspCount++;
                    }
                }
            });

            anomaliesData?.forEach(a => {
                radarFeed.push({
                    type: 'anomaly',
                    date: a.business_date,
                    store: formatStoreName(a.store_name),
                    score: Number(a.discount_amount).toFixed(2),
                    desc: `Anomalía: ${a.discount_name} por ${a.server_name?.split(' ')[0] || 'Desconocido'}`
                });
            });

            radarFeed.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

            const matrix = Object.values(fleet).map(s => {
                return {
                    id: s.id,
                    name: s.name,
                    sales: s.sales,
                    foodCost: s.fcSales > 0 ? (s.fcCost / s.fcSales) * 100 : null,
                    nps: s.npsCount > 0 ? Math.round(((s.npsProm - s.npsDet) / s.npsCount) * 100) : null,
                    audit: s.inspCount > 0 ? Math.round(s.inspScore / s.inspCount) : null
                };
            }).sort((a, b) => b.sales - a.sales);

            const totalSales = matrix.reduce((sum, s) => sum + s.sales, 0);
            const globalFcCost = Object.values(fleet).reduce((sum, s) => sum + s.fcCost, 0);
            const globalFcSales = Object.values(fleet).reduce((sum, s) => sum + s.fcSales, 0);

            setStats({
                sales: totalSales,
                foodCost: globalFcSales > 0 ? (globalFcCost / globalFcSales) * 100 : 0,
                nps: totalNpsCount > 0 ? Math.round(((totalNpsProm - totalNpsDet) / totalNpsCount) * 100) : 0,
                audit: totalInspCount > 0 ? Math.round(totalInspScore / totalInspCount) : 0,
                matrix,
                radarFeed: radarFeed.slice(0, 30)
            });

            setLoading(false)
        } catch (err) {
            console.error(err)
            setLoading(false)
        }
    }

    if (loading) return <SurpriseLoader />

    const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);

    return (
        <div className="bg-transparent min-h-screen font-sans w-full pb-10">
            <header className="bg-white/70 dark:bg-slate-900/40 backdrop-blur-md sticky top-0 z-30 px-4 md:px-6 py-4 shadow-[0_1px_3px_rgba(0,0,0,0.05)] border-b border-gray-100 dark:border-slate-800">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="bg-slate-900 dark:bg-red-600 text-white p-3 rounded-xl shadow-lg shadow-slate-200 dark:shadow-none">
                            <Activity size={28} />
                        </div>
                        <div>
                            <h1 className="text-2xl md:text-3xl font-black text-slate-900 dark:text-white tracking-tighter leading-none flex items-center gap-3">
                                Command Center
                                <span className="hidden sm:flex items-center gap-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 px-3 py-1.5 rounded-full text-[11px] uppercase tracking-widest border border-red-100 dark:border-red-900/30 font-black">
                                    <span className="relative flex h-3 w-3">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-3 w-3 bg-red-600"></span>
                                    </span>
                                    LIVE
                                </span>
                            </h1>
                            <p className="hidden md:block text-sm font-bold text-slate-400 dark:text-slate-300 uppercase tracking-widest mt-1.5">
                                C.O.R.E. Operations Matrix
                            </p>
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
                {/* 1. TOP KPIs */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* Sales KPI */}
                    <div className="bg-emerald-500 rounded-2xl p-6 text-white shadow-xl shadow-emerald-500/20 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity"><DollarSign size={80} /></div>
                        <p className="text-emerald-100 text-xs font-black uppercase tracking-widest relative z-10">Ventas Brutas</p>
                        <h2 className="text-4xl font-black tracking-tighter mt-2 relative z-10">{formatCurrency(stats.sales)}</h2>
                    </div>

                    {/* Food Cost KPI */}
                    <div className={`${stats.foodCost > 32 ? 'bg-red-500 shadow-red-500/20' : stats.foodCost > 28 ? 'bg-amber-500 shadow-amber-500/20' : 'bg-slate-900 shadow-slate-900/20'} rounded-2xl p-6 text-white shadow-xl relative overflow-hidden group transition-colors duration-500`}>
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity"><Target size={80} /></div>
                        <p className="text-white/70 text-xs font-black uppercase tracking-widest relative z-10">Food Cost Global</p>
                        <h2 className="text-4xl font-black tracking-tighter mt-2 relative z-10">{stats.foodCost > 0 ? stats.foodCost.toFixed(2) : '--'}%</h2>
                    </div>

                    {/* NPS KPI */}
                    <div className="bg-indigo-600 rounded-2xl p-6 text-white shadow-xl shadow-indigo-600/20 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity"><MessageSquare size={80} /></div>
                        <p className="text-indigo-200 text-xs font-black uppercase tracking-widest relative z-10">NPS (Pulse)</p>
                        <h2 className="text-4xl font-black tracking-tighter mt-2 relative z-10">{stats.nps}</h2>
                    </div>

                    {/* Audit KPI */}
                    <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-100 dark:border-slate-800 shadow-sm relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity text-slate-900 dark:text-white"><ClipboardList size={80} /></div>
                        <p className="text-slate-400 dark:text-slate-500 text-xs font-black uppercase tracking-widest relative z-10">Score Operativo</p>
                        <h2 className={`text-4xl font-black tracking-tighter mt-2 relative z-10 ${stats.audit >= 85 ? 'text-green-500' : stats.audit >= 75 ? 'text-amber-500' : 'text-red-500'}`}>{stats.audit > 0 ? stats.audit : '--'}%</h2>
                    </div>
                </div>

                {/* 2. MATRIZ DE FLOTA & RADAR */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    
                    {/* MATRIZ DE FLOTA */}
                    <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm flex flex-col overflow-hidden">
                        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50">
                            <h3 className="font-black text-slate-900 dark:text-white text-base flex items-center gap-3">
                                <Zap size={22} className="text-blue-500" /> Matriz de Flota
                            </h3>
                        </div>
                        <div className="flex-1 overflow-x-auto custom-scrollbar">
                            <table className="w-full text-left min-w-[600px]">
                                <thead className="bg-white dark:bg-slate-900 text-slate-400 font-black text-[10px] uppercase tracking-widest sticky top-0 z-10 shadow-sm">
                                    <tr>
                                        <th className="pl-6 py-4">Sucursal</th>
                                        <th className="py-4 text-right">Ventas</th>
                                        <th className="py-4 text-center">Food Cost</th>
                                        <th className="py-4 text-center">NPS</th>
                                        <th className="pr-6 py-4 text-center">Auditoría</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
                                    {stats.matrix.map((store, i) => (
                                        <tr key={i} className="hover:bg-blue-50/30 dark:hover:bg-blue-900/10 transition-colors group">
                                            <td className="pl-6 py-3.5 font-bold text-slate-800 dark:text-slate-200 text-sm">{store.name}</td>
                                            <td className="py-3.5 text-right font-black text-emerald-600 dark:text-emerald-400">{formatCurrency(store.sales)}</td>
                                            <td className="py-3.5 text-center">
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-black ${!store.foodCost ? 'bg-slate-100 text-slate-400 dark:bg-slate-800' : store.foodCost > 32 ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' : store.foodCost > 28 ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                                                    {store.foodCost ? `${store.foodCost.toFixed(1)}%` : '-'}
                                                </span>
                                            </td>
                                            <td className="py-3.5 text-center">
                                                <span className={`font-black text-sm ${!store.nps && store.nps !== 0 ? 'text-slate-300' : store.nps >= 50 ? 'text-indigo-500' : store.nps >= 0 ? 'text-slate-600 dark:text-slate-400' : 'text-red-500'}`}>
                                                    {store.nps ?? '-'}
                                                </span>
                                            </td>
                                            <td className="pr-6 py-3.5 text-center">
                                                <span className={`inline-flex items-center justify-center w-10 h-6 rounded-md text-xs font-black shadow-sm ${!store.audit ? 'bg-slate-100 text-slate-400 dark:bg-slate-800' : store.audit >= 85 ? 'bg-green-500 text-white' : store.audit >= 75 ? 'bg-amber-500 text-white' : 'bg-red-500 text-white'}`}>
                                                    {store.audit ?? '-'}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* RADAR DE ACCIÓN */}
                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm flex flex-col h-[500px]">
                        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-red-50/40 dark:bg-red-900/10">
                            <h3 className="font-black text-red-900 dark:text-red-100 text-base flex items-center gap-3">
                                <ShieldAlert size={22} className="text-red-500" /> Radar de Acción
                            </h3>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar bg-slate-50/50 dark:bg-slate-900/50">
                            {stats.radarFeed.length > 0 ? stats.radarFeed.map((item, i) => (
                                <div 
                                    key={i} 
                                    onClick={() => item.type === 'feedback' ? (setSelectedFeedback(item.raw), setIsModalOpen(true)) : null}
                                    className={`relative bg-white dark:bg-slate-800 border ${item.type === 'anomaly' ? 'border-orange-200 dark:border-orange-900/50' : 'border-red-200 dark:border-red-900/50'} rounded-xl p-3 shadow-sm flex gap-3 ${item.type === 'feedback' ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
                                >
                                    <div className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center font-black shadow-inner ${item.type === 'anomaly' ? 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400' : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'}`}>
                                        {item.type === 'anomaly' ? <AlertTriangle size={20} /> : item.score}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex justify-between items-start">
                                            <h4 className={`font-black text-sm tracking-tight truncate pr-2 ${item.type === 'anomaly' ? 'text-orange-900 dark:text-orange-100' : 'text-red-900 dark:text-red-100'}`}>
                                                {item.store}
                                            </h4>
                                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">
                                                {formatDateLA(item.date).split(',')[0]}
                                            </span>
                                        </div>
                                        <p className="text-xs font-medium text-slate-600 dark:text-slate-300 mt-1 leading-snug line-clamp-2">
                                            {item.type === 'anomaly' && <span className="font-bold text-orange-600 dark:text-orange-400 mr-1">${item.score}</span>}
                                            {item.desc}
                                        </p>
                                    </div>
                                </div>
                            )) : (
                                <div className="h-full flex flex-col items-center justify-center text-slate-300">
                                    <CheckCircle size={40} className="mb-2 text-green-200 dark:text-green-900/30" />
                                    <p className="text-xs font-bold text-slate-400">Todo en orden</p>
                                </div>
                            )}
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
