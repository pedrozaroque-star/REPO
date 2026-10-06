/**
 * @module app/evaluacion/page
 * @description Módulo de Evaluación de Personal (STAFF y Corporativo) de Tacos Gavilan.
 * Proporciona un panel ejecutivo dual para la supervisión y gerencia:
 * 1. Pestaña de Historial y Métricas: KPIs consolidados, filtros multi-sucursal y corporativos, búsqueda,
 *    y modal de auditoría de las 25 preguntas con aprobación administrativa.
 * 2. Pestaña de Nueva Evaluación: Formulario interactivo en tiempo real con detección GPS y soporte para Oficina Central / Corporativo.
 * @businessRules
 * - La jornada laboral inicia a las 6:00 AM y termina a las 5:59 AM del siguiente día.
 * - Registros antes de las 6:00 AM pertenecen al día laboral anterior.
 * - Puestos de línea u operativos omiten preguntas de liderazgo, mientras puestos de mando o RRHH las evalúan.
 * - Solo personal administrativo o gerencial puede marcar evaluaciones como 'reviewed' y añadir notas.
 * @dataFlow
 * - Supabase ('staff_evaluations' + 'stores' + 'users') -> React State -> Modal de Revisión / Mutación.
 * @notes
 * - Soporta tanto columnas individuales q1_1 a q5_5 como el campo answers JSONB.
 * - Soporta 'store_id' NULL para evaluaciones de Oficina Central / Corporativo sin romper integridad relacional.
 * - Bilingüe (Español / Inglés) vía useLanguage().
 */

'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
    UserCheck, Users, Star, Award, ThumbsUp, ThumbsDown,
    Filter, Search, MapPin, Calendar, Clock, ChevronRight,
    Plus, RefreshCw, ExternalLink, CheckCircle2, AlertCircle,
    Briefcase, User, Sparkles, Building2
} from 'lucide-react'
import { getSupabaseClient, formatStoreName } from '@/lib/supabase'
import { formatDateLA, formatTimeLA } from '@/lib/checklistPermissions'
import { useLanguage } from '@/lib/i18n'
import { useAuth } from '@/components/ProtectedRoute'
import SurpriseLoader from '@/components/SurpriseLoader'
import StaffEvaluationForm, { STAFF_ROLES, STORE_ROLES, CORPORATE_ROLES } from '@/components/StaffEvaluationForm'
import StaffEvaluationReviewModal from '@/components/StaffEvaluationReviewModal'

interface Store {
    id: number
    name: string
}

export default function StaffEvaluationsPage() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const storeParam = searchParams.get('store')
    const { t, language } = useLanguage()
    const isEs = language === 'es'
    const { user } = useAuth()

    const [activeTab, setActiveTab] = useState<'dashboard' | 'new'>('dashboard')
    const [evaluations, setEvaluations] = useState<any[]>([])
    const [stores, setStores] = useState<Store[]>([])
    const [storeMap, setStoreMap] = useState<Record<number, string>>({})
    const [loading, setLoading] = useState(true)

    // Filters
    const [storeFilter, setStoreFilter] = useState<string>(storeParam || 'all')
    const [roleFilter, setRoleFilter] = useState<string>('all')
    const [statusFilter, setStatusFilter] = useState<string>('all')
    const [recFilter, setRecFilter] = useState<string>('all')
    const [searchQuery, setSearchQuery] = useState<string>('')
    const [dateRangeFilter, setDateRangeFilter] = useState<string>('all')

    // Modal state
    const [selectedEvaluation, setSelectedEvaluation] = useState<any | null>(null)
    const [isModalOpen, setIsModalOpen] = useState(false)

    useEffect(() => {
        fetchStores()
        fetchEvaluations()
    }, [])

    const fetchStores = async () => {
        try {
            const supabase = await getSupabaseClient()
            const { data } = await supabase.from('stores').select('id, name').order('name')
            const list = data || []
            setStores(list)
            const map: Record<number, string> = {}
            list.forEach(s => {
                map[s.id] = formatStoreName(s.name)
            })
            setStoreMap(map)
        } catch (err) {
            console.error('Error fetching stores:', err)
        }
    }

    const fetchEvaluations = async () => {
        try {
            setLoading(true)
            const supabase = await getSupabaseClient()
            const { data, error } = await supabase
                .from('staff_evaluations')
                .select('*')
                .order('evaluation_date', { ascending: false })
                .limit(200)

            if (error) throw error
            setEvaluations(data || [])
        } catch (err) {
            console.error('Error fetching staff evaluations:', err)
        } finally {
            setLoading(false)
        }
    }

    // Filtered list
    const filteredEvaluations = useMemo(() => {
        return evaluations.filter(ev => {
            // Store / Location filter
            if (storeFilter !== 'all') {
                if (storeFilter === 'corporate') {
                    const isCorp = ev.store_id === null || (ev.location_name || '').toLowerCase().includes('corporativ') || (ev.location_name || '').toLowerCase().includes('oficina')
                    if (!isCorp) return false
                } else if (String(ev.store_id) !== String(storeFilter)) {
                    return false
                }
            }
            // Role filter
            if (roleFilter !== 'all') {
                const evRole = (ev.evaluated_role || '').toLowerCase().trim()
                if (roleFilter === 'Otro') {
                    const standardRoles = STORE_ROLES.concat(CORPORATE_ROLES.filter(r => r !== 'Otro')).map(r => r.toLowerCase())
                    const isStandard = standardRoles.includes(evRole)
                    if (isStandard && evRole !== 'otro') return false
                } else if (evRole !== roleFilter.toLowerCase()) {
                    return false
                }
            }
            // Status filter
            if (statusFilter !== 'all') {
                const currentStatus = ev.review_status || 'pending'
                if (currentStatus !== statusFilter) return false
            }
            // Recommendation filter
            if (recFilter !== 'all') {
                const isRec = (ev.recomendaria || '').toLowerCase() === 'si'
                if (recFilter === 'si' && !isRec) return false
                if (recFilter === 'no' && isRec) return false
            }
            // Search query
            if (searchQuery.trim()) {
                const query = searchQuery.toLowerCase().trim()
                const name = (ev.evaluated_name || '').toLowerCase()
                const evaluator = (ev.evaluator_name || '').toLowerCase()
                const strengths = (ev.fortalezas || '').toLowerCase()
                const improve = (ev.areas_mejora || '').toLowerCase()
                if (
                    !name.includes(query) &&
                    !evaluator.includes(query) &&
                    !strengths.includes(query) &&
                    !improve.includes(query)
                ) {
                    return false
                }
            }
            // Date filter
            if (dateRangeFilter !== 'all') {
                const evDate = new Date(ev.evaluation_date)
                const now = new Date()
                if (dateRangeFilter === 'today') {
                    const todayStr = formatDateLA(now.toISOString())
                    const itemStr = formatDateLA(ev.evaluation_date)
                    if (todayStr !== itemStr) return false
                } else if (dateRangeFilter === '7d') {
                    const diffDays = (now.getTime() - evDate.getTime()) / (1000 * 60 * 60 * 24)
                    if (diffDays > 7) return false
                } else if (dateRangeFilter === '30d') {
                    const diffDays = (now.getTime() - evDate.getTime()) / (1000 * 60 * 60 * 24)
                    if (diffDays > 30) return false
                }
            }

            return true
        })
    }, [evaluations, storeFilter, roleFilter, statusFilter, recFilter, searchQuery, dateRangeFilter])

    // KPI Metrics calculation
    const metrics = useMemo(() => {
        const total = filteredEvaluations.length
        if (total === 0) {
            return { total: 0, avgScore: 0, recPct: 0, pending: 0 }
        }

        let scoreSum = 0
        let recCount = 0
        let pendingCount = 0

        filteredEvaluations.forEach(ev => {
            const score = ev.desempeno_general ?? 0
            scoreSum += score
            if ((ev.recomendaria || '').toLowerCase() === 'si') recCount++
            if (!ev.review_status || ev.review_status === 'pending') pendingCount++
        })

        return {
            total,
            avgScore: Number((scoreSum / total).toFixed(1)),
            recPct: Math.round((recCount / total) * 100),
            pending: pendingCount
        }
    }, [filteredEvaluations])

    const handleRowClick = (ev: any) => {
        setSelectedEvaluation(ev)
        setIsModalOpen(true)
    }

    return (
        <div className="space-y-6 pb-12 animate-in fade-in duration-300">

            {/* TOP HEADER */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <div className="space-y-1">
                    <div className="flex items-center gap-2.5">
                        <div className="p-2.5 bg-red-600/10 dark:bg-red-500/20 text-red-600 dark:text-red-400 rounded-2xl">
                            <UserCheck size={28} />
                        </div>
                        <div>
                            <h1 className="text-2xl sm:text-3xl font-black text-slate-800 dark:text-white tracking-tight">
                                {isEs ? 'Evaluación de Personal' : 'Staff Evaluations'}
                            </h1>
                            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                                {isEs
                                    ? 'Desempeño, liderazgo y crecimiento del equipo de tienda'
                                    : 'Performance, leadership and growth of store team members'}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <button
                        onClick={() => window.open('/evaluacion/kiosk', '_blank')}
                        className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 font-bold text-xs rounded-xl transition-all flex items-center gap-2 border border-slate-200 dark:border-slate-700"
                        title={isEs ? 'Abrir modo kiosko para tabletas' : 'Open tablet kiosk mode'}
                    >
                        <span>📱</span>
                        <span>{isEs ? 'Modo Kiosko / Tablet' : 'Kiosk / Tablet Mode'}</span>
                        <ExternalLink size={13} className="opacity-60" />
                    </button>

                    <button
                        onClick={fetchEvaluations}
                        disabled={loading}
                        className="p-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 rounded-xl transition-all disabled:opacity-50 border border-slate-200 dark:border-slate-700"
                        title={isEs ? 'Actualizar datos' : 'Refresh data'}
                    >
                        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {/* TAB NAVIGATION */}
            <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
                <button
                    onClick={() => setActiveTab('dashboard')}
                    className={`px-5 py-2.5 rounded-2xl font-black text-sm tracking-wide transition-all flex items-center gap-2 ${
                        activeTab === 'dashboard'
                            ? 'bg-red-600 text-white shadow-md shadow-red-600/30'
                            : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                >
                    <Award size={18} />
                    <span>{isEs ? 'Historial y Métricas' : 'History & Metrics'}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                        activeTab === 'dashboard' ? 'bg-white/20 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                    }`}>
                        {evaluations.length}
                    </span>
                </button>

                <button
                    onClick={() => setActiveTab('new')}
                    className={`px-5 py-2.5 rounded-2xl font-black text-sm tracking-wide transition-all flex items-center gap-2 ${
                        activeTab === 'new'
                            ? 'bg-red-600 text-white shadow-md shadow-red-600/30'
                            : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                >
                    <Plus size={18} />
                    <span>{isEs ? 'Nueva Evaluación' : 'New Evaluation'}</span>
                </button>
            </div>

            {/* TAB 1: DASHBOARD & HISTORIAL */}
            {activeTab === 'dashboard' && (
                <div className="space-y-6">

                    {/* KPI CARDS */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        {/* Total Evaluations */}
                        <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col justify-between">
                            <span className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center justify-between">
                                {isEs ? 'Total Evaluaciones' : 'Total Evaluations'}
                                <Users size={16} className="text-slate-400" />
                            </span>
                            <div className="my-2">
                                <span className="text-3xl sm:text-4xl font-black text-slate-800 dark:text-white">
                                    {metrics.total}
                                </span>
                            </div>
                            <span className="text-xs text-slate-500">
                                {isEs ? 'En el periodo actual' : 'In current view'}
                            </span>
                        </div>

                        {/* Overall Average */}
                        <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col justify-between">
                            <span className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center justify-between">
                                {isEs ? 'Promedio General' : 'Overall Average'}
                                <Award size={16} className="text-amber-500" />
                            </span>
                            <div className="my-2 flex items-baseline gap-1.5">
                                <span className={`text-3xl sm:text-4xl font-black ${
                                    metrics.avgScore >= 8 ? 'text-emerald-600 dark:text-emerald-400' :
                                    metrics.avgScore >= 6 ? 'text-amber-500 dark:text-amber-400' : 'text-red-600 dark:text-red-400'
                                }`}>
                                    {metrics.avgScore}
                                </span>
                                <span className="text-sm text-slate-400 font-bold">/ 10</span>
                            </div>
                            <span className="text-xs text-slate-500">
                                {metrics.avgScore >= 8 ? (isEs ? 'Nivel Alto' : 'High Performance') :
                                 metrics.avgScore >= 6 ? (isEs ? 'Nivel Satisfactorio' : 'Satisfactory') :
                                 (isEs ? 'Atención Requerida' : 'Attention Needed')}
                            </span>
                        </div>

                        {/* % Recommended */}
                        <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col justify-between">
                            <span className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center justify-between">
                                {isEs ? '% Recomendados' : '% Recommended'}
                                <ThumbsUp size={16} className="text-emerald-500" />
                            </span>
                            <div className="my-2 flex items-baseline gap-1.5">
                                <span className="text-3xl sm:text-4xl font-black text-emerald-600 dark:text-emerald-400">
                                    {metrics.recPct}%
                                </span>
                            </div>
                            <span className="text-xs text-slate-500">
                                {isEs ? 'Aprobados para crecimiento' : 'Endorsed for growth'}
                            </span>
                        </div>

                        {/* Pending Review */}
                        <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col justify-between">
                            <span className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center justify-between">
                                {isEs ? 'Por Dictaminar' : 'Pending Review'}
                                <AlertCircle size={16} className="text-amber-500" />
                            </span>
                            <div className="my-2">
                                <span className={`text-3xl sm:text-4xl font-black ${
                                    metrics.pending > 0 ? 'text-amber-500 dark:text-amber-400' : 'text-slate-400'
                                }`}>
                                    {metrics.pending}
                                </span>
                            </div>
                            <span className="text-xs text-slate-500">
                                {isEs ? 'Pendientes de supervisión' : 'Awaiting sign-off'}
                            </span>
                        </div>
                    </div>

                    {/* FILTERS TOOLBAR */}
                    <div className="p-5 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                        <div className="flex items-center gap-2 text-xs font-black text-slate-400 uppercase tracking-widest">
                            <Filter size={15} />
                            <span>{isEs ? 'Filtros de Búsqueda' : 'Search Filters'}</span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                            {/* Store select */}
                            <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                                    {isEs ? 'Sucursal' : 'Store'}
                                </label>
                                <select
                                    value={storeFilter}
                                    onChange={e => setStoreFilter(e.target.value)}
                                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-red-600"
                                >
                                    <option value="all">{isEs ? 'Todas las Sucursales y Oficinas' : 'All Stores & Offices'}</option>
                                    <option value="corporate">{isEs ? '🏢 Oficina Central / Corporativo' : '🏢 Corporate / Central Office'}</option>
                                    {stores.map(s => (
                                        <option key={s.id} value={String(s.id)}>
                                            {formatStoreName(s.name)}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Role select */}
                            <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                                    {isEs ? 'Puesto / Rol' : 'Role'}
                                </label>
                                <select
                                    value={roleFilter}
                                    onChange={e => setRoleFilter(e.target.value)}
                                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-red-600"
                                >
                                    <option value="all">{isEs ? 'Todos los Puestos' : 'All Roles'}</option>
                                    <optgroup label={isEs ? '🌮 Personal de Sucursal' : '🌮 Store Staff'}>
                                        {STORE_ROLES.map(r => (
                                            <option key={r} value={r}>{r}</option>
                                        ))}
                                    </optgroup>
                                    <optgroup label={isEs ? '🏢 Corporativo, RRHH & Soporte' : '🏢 Corporate, HR & Support'}>
                                        {CORPORATE_ROLES.map(r => (
                                            <option key={r} value={r}>{r}</option>
                                        ))}
                                    </optgroup>
                                </select>
                            </div>

                            {/* Status select */}
                            <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                                    {isEs ? 'Dictamen' : 'Status'}
                                </label>
                                <select
                                    value={statusFilter}
                                    onChange={e => setStatusFilter(e.target.value)}
                                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-red-600"
                                >
                                    <option value="all">{isEs ? 'Todos los Estatus' : 'All Statuses'}</option>
                                    <option value="pending">{isEs ? '⏳ Pendiente' : '⏳ Pending'}</option>
                                    <option value="reviewed">{isEs ? '✅ Revisado' : '✅ Reviewed'}</option>
                                    <option value="action_needed">{isEs ? '⚠️ Plan de Acción' : '⚠️ Action Needed'}</option>
                                </select>
                            </div>

                            {/* Recommendation select */}
                            <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                                    {isEs ? 'Recomendación' : 'Recommendation'}
                                </label>
                                <select
                                    value={recFilter}
                                    onChange={e => setRecFilter(e.target.value)}
                                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-red-600"
                                >
                                    <option value="all">{isEs ? 'Todas' : 'All'}</option>
                                    <option value="si">{isEs ? '✓ Recomendados' : '✓ Recommended'}</option>
                                    <option value="no">{isEs ? '✗ No Recomendados' : '✗ Not Recommended'}</option>
                                </select>
                            </div>

                            {/* Date range filter */}
                            <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                                    {isEs ? 'Periodo' : 'Timeframe'}
                                </label>
                                <select
                                    value={dateRangeFilter}
                                    onChange={e => setDateRangeFilter(e.target.value)}
                                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-red-600"
                                >
                                    <option value="all">{isEs ? 'Todo el Historial' : 'All Time'}</option>
                                    <option value="today">{isEs ? 'Hoy (Jornada)' : 'Today (Business Day)'}</option>
                                    <option value="7d">{isEs ? 'Últimos 7 Días' : 'Last 7 Days'}</option>
                                    <option value="30d">{isEs ? 'Últimos 30 Días' : 'Last 30 Days'}</option>
                                </select>
                            </div>
                        </div>

                        {/* Search input */}
                        <div className="relative">
                            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                placeholder={isEs ? 'Buscar por nombre del empleado, evaluador o fortalezas...' : 'Search by staff name, evaluator or keyword...'}
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-red-600"
                            />
                        </div>
                    </div>

                    {/* EVALUATIONS LIST */}
                    {loading ? (
                        <div className="py-20 flex justify-center">
                            <SurpriseLoader />
                        </div>
                    ) : filteredEvaluations.length === 0 ? (
                        <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
                            <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mx-auto">
                                <Users size={28} />
                            </div>
                            <h3 className="text-base font-bold text-slate-800 dark:text-white">
                                {isEs ? 'No se encontraron evaluaciones' : 'No evaluations found'}
                            </h3>
                            <p className="text-xs text-slate-500 max-w-sm mx-auto">
                                {isEs
                                    ? 'Ajusta los filtros seleccionados o realiza una nueva evaluación para tu equipo.'
                                    : 'Adjust your search filters or start a new staff evaluation.'}
                            </p>
                            <button
                                onClick={() => setActiveTab('new')}
                                className="mt-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl transition-all shadow-md"
                            >
                                {isEs ? '+ Nueva Evaluación' : '+ New Evaluation'}
                            </button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {filteredEvaluations.map(ev => {
                                const score = ev.desempeno_general ?? 0
                                const isRec = (ev.recomendaria || '').toLowerCase() === 'si'
                                const status = ev.review_status || 'pending'
                                const sName = ev.location_name || storeMap[ev.store_id] || (ev.store_id ? `Tienda ${ev.store_id}` : (isEs ? 'Oficina Central / Corporativo' : 'Corporate / Central Office'))

                                return (
                                    <div
                                        key={ev.id}
                                        onClick={() => handleRowClick(ev)}
                                        className="p-5 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md hover:border-red-300 dark:hover:border-red-900/60 cursor-pointer transition-all flex flex-col justify-between space-y-4 group"
                                    >
                                        <div className="space-y-2">
                                            {/* Row 1: Badges */}
                                            <div className="flex items-center justify-between text-xs">
                                                <span className="font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1">
                                                    <MapPin size={13} className="text-red-600" />
                                                    {sName}
                                                </span>
                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                                                    status === 'reviewed'
                                                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                                        : status === 'action_needed'
                                                        ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300'
                                                        : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                                }`}>
                                                    {status === 'reviewed' ? (isEs ? 'Revisado' : 'Reviewed') :
                                                     status === 'action_needed' ? (isEs ? 'Plan Acción' : 'Action Plan') :
                                                     (isEs ? 'Pendiente' : 'Pending')}
                                                </span>
                                            </div>

                                            {/* Row 2: Name & Role */}
                                            <div className="flex items-start justify-between gap-2 pt-1">
                                                <div>
                                                    <h4 className="text-base font-black text-slate-800 dark:text-white group-hover:text-red-600 transition-colors">
                                                        {ev.evaluated_name}
                                                    </h4>
                                                    <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 inline-block mt-1">
                                                        {ev.evaluated_role}
                                                    </span>
                                                </div>

                                                {/* Score */}
                                                <div className="text-right">
                                                    <div className={`text-2xl font-black ${
                                                        score >= 8 ? 'text-emerald-600 dark:text-emerald-400' :
                                                        score >= 6 ? 'text-amber-500 dark:text-amber-400' : 'text-red-600 dark:text-red-400'
                                                    }`}>
                                                        {score}<span className="text-xs text-slate-400 font-bold">/10</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Strengths snippet */}
                                            {ev.fortalezas && (
                                                <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2 italic pt-1 border-t border-slate-100 dark:border-slate-800">
                                                    "{ev.fortalezas}"
                                                </p>
                                            )}
                                        </div>

                                        {/* Footer: Date, Rec, & Action */}
                                        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-400">
                                            <div className="flex items-center gap-1.5 font-medium">
                                                <Calendar size={13} />
                                                <span>{formatDateLA(ev.evaluation_date)}</span>
                                            </div>

                                            <div className="flex items-center gap-2">
                                                {isRec ? (
                                                    <span className="text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1 text-[11px]" title={isEs ? 'Recomendado' : 'Recommended'}>
                                                        <ThumbsUp size={13} /> {isEs ? 'Recomendado' : 'Recommended'}
                                                    </span>
                                                ) : (
                                                    <span className="text-red-500 font-bold flex items-center gap-1 text-[11px]" title={isEs ? 'No recomendado' : 'Not recommended'}>
                                                        <ThumbsDown size={13} /> {isEs ? 'No rec.' : 'Not rec.'}
                                                    </span>
                                                )}

                                                <ChevronRight size={16} className="text-slate-400 group-hover:translate-x-1 transition-transform" />
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* TAB 2: NUEVA EVALUACIÓN */}
            {activeTab === 'new' && (
                <div className="space-y-4">
                    <StaffEvaluationForm
                        preselectedStoreId={storeParam || ''}
                        onCompleted={() => {
                            fetchEvaluations()
                            setActiveTab('dashboard')
                        }}
                    />
                </div>
            )}

            {/* DETAILED REVIEW MODAL */}
            {selectedEvaluation && (
                <StaffEvaluationReviewModal
                    isOpen={isModalOpen}
                    onClose={() => {
                        setIsModalOpen(false)
                        setSelectedEvaluation(null)
                    }}
                    evaluation={selectedEvaluation}
                    currentUser={user}
                    storeName={selectedEvaluation.location_name || storeMap[selectedEvaluation.store_id] || (selectedEvaluation.store_id ? formatStoreName(`Tienda ${selectedEvaluation.store_id}`) : (isEs ? 'Oficina Central / Corporativo' : 'Corporate / Central Office'))}
                    onUpdate={fetchEvaluations}
                />
            )}
        </div>
    )
}
