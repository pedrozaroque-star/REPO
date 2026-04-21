'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import { Calendar, Store, AlertTriangle, User, Filter, ChevronLeft, ChevronRight, ShieldAlert, Target, Info, X } from 'lucide-react'
import DateRangeFilter from '@/components/sales/DateRangeFilter'
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Cell } from 'recharts'

// Utiliza cliente supabase de entorno publico para lecturas
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type DiscountRow = {
    id: string
    store_id: string
    store_name: string
    business_date: string
    discount_name: string
    discount_amount: number
    approver_name: string
    server_name: string
    opened_date: string
    order_id?: string
    check_id?: string
}

export default function AuditoriaDescuentos() {
    const [discounts, setDiscounts] = useState<DiscountRow[]>([])
    const [loading, setLoading] = useState(false)
    const [period, setPeriod] = useState<'today' | 'yesterday' | 'week' | 'month' | 'quarter' | 'custom' | 'last_week' | 'last_7' | 'last_month'>('yesterday')
    const [startDate, setStartDate] = useState(() => {
        const d = new Date()
        d.setDate(d.getDate() - 1)
        return d.toISOString().split('T')[0]
    })
    const [endDate, setEndDate] = useState(() => {
        const d = new Date()
        d.setDate(d.getDate() - 1)
        return d.toISOString().split('T')[0]
    })
    const [storeFilter, setStoreFilter] = useState('all')

    const [uniqueStores, setUniqueStores] = useState<string[]>([])

    const shiftDate = (days: number) => {
        const [sYear, sMonth, sDay] = startDate.split('-').map(Number);
        const [eYear, eMonth, eDay] = endDate.split('-').map(Number);
        
        const currentStart = new Date(sYear, sMonth - 1, sDay);
        const currentEnd = new Date(eYear, eMonth - 1, eDay);
        
        currentStart.setDate(currentStart.getDate() + days);
        currentEnd.setDate(currentEnd.getDate() + days);
        
        const formatD = (d: Date) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        
        setPeriod('custom');
        setStartDate(formatD(currentStart));
        setEndDate(formatD(currentEnd));
    }

    const todayStr = (() => {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    })();
    const isTodayOrFuture = endDate >= todayStr;

    useEffect(() => {
        fetchDiscounts()
    }, [startDate, endDate, storeFilter])

    const fetchDiscounts = async () => {
        setLoading(true)
        try {
            let allData: any[] = [];
            let from = 0;
            const pageSize = 1000;
            let hasMore = true;

            while (hasMore) {
                let query = supabase.from('sales_discounts_log').select('*')
                
                if (startDate && endDate) {
                    if (startDate === endDate) {
                        query = query.eq('business_date', startDate)
                    } else {
                        query = query.gte('business_date', startDate).lte('business_date', endDate)
                    }
                }
                if (storeFilter !== 'all') {
                    query = query.eq('store_name', storeFilter)
                }

                // Es CRÍTICO ordenar para que la paginación de PostgREST sea predecible y no devuelva duplicados entre chunks.
                const { data, error } = await query.order('id', { ascending: true }).range(from, from + pageSize - 1)
                
                if (error) throw error
                if (data) {
                    allData = [...allData, ...data];
                }
                
                if (!data || data.length < pageSize) {
                    hasMore = false;
                } else {
                    from += pageSize;
                }
            }
            
            setDiscounts(allData)
            
            if (storeFilter === 'all') {
                const stores = Array.from(new Set((allData || []).map(d => d.store_name))).sort()
                setUniqueStores(stores)
            }
            
        } catch (error) {
            console.error("Error fetching discounts:", error)
        } finally {
            setLoading(false)
        }
    }

    const [focusKeyword, setFocusKeyword] = useState('all')
    const [selectedModalData, setSelectedModalData] = useState<{type: 'REASON' | 'EMPLOYEE' | 'STORE', title: string, data: DiscountRow[]} | null>(null);
    const [modalSort, setModalSort] = useState<{column: string, direction: 'asc' | 'desc'}>({ column: 'monto', direction: 'desc' });
    const [orderDetailData, setOrderDetailData] = useState<{loading: boolean, data?: any, error?: string, checkId?: string, storeName?: string, cajeraName?: string} | null>(null);

    // Welcome Wizard & Risk Radar
    const [showWizard, setShowWizard] = useState(true);
    const [riskAlerts, setRiskAlerts] = useState<{ loading: boolean, data: any[] }>({ loading: true, data: [] });

    useEffect(() => {
        if (showWizard) {
            const fetchRisks = async () => {
                setRiskAlerts(prev => ({...prev, loading: true}));
                const d = new Date();
                const eDate = d.toISOString().split('T')[0];
                d.setDate(d.getDate() - 15);
                const sDate = d.toISOString().split('T')[0];

                let allRisks: any[] = [];
                let from = 0;
                const pageSize = 1000;
                let hasMore = true;

                while (hasMore) {
                    const { data, error } = await supabase.from('sales_discounts_log')
                        .select('store_name, discount_name, discount_amount, approver_name, server_name')
                        .in('discount_name', ['First Responder Discount', 'Employee Discount', 'Senior Discount', 'Senior'])
                        .gte('business_date', sDate)
                        .lte('business_date', eDate)
                        .order('id')
                        .range(from, from + pageSize - 1);
                    
                    if (data) allRisks = [...allRisks, ...data];
                    if (!data || data.length < pageSize) {
                        hasMore = false;
                    } else {
                        from += pageSize;
                    }
                }

                // Agrupar por cajero
                const grouped = allRisks.reduce((acc, curr) => {
                    const emp = curr.approver_name || curr.server_name || 'Autoservicio';
                    if (!acc[emp]) acc[emp] = { firstResponderTotal: 0, employeeTotal: 0, seniorTotal: 0, stores: {} };
                    
                    if (curr.discount_name === 'First Responder Discount') {
                        acc[emp].firstResponderTotal += Number(curr.discount_amount);
                    } else if (curr.discount_name === 'Employee Discount') {
                        acc[emp].employeeTotal += Number(curr.discount_amount);
                    } else if (curr.discount_name === 'Senior Discount' || curr.discount_name === 'Senior') {
                        acc[emp].seniorTotal += Number(curr.discount_amount);
                    }

                    if (!acc[emp].stores[curr.store_name]) acc[emp].stores[curr.store_name] = 0;
                    acc[emp].stores[curr.store_name] += Number(curr.discount_amount);
                    
                    return acc;
                }, {} as Record<string, any>);

                const structured = Object.entries(grouped)
                    .map(([emp, vals]: [string, any]) => {
                        const topStore = Object.entries(vals.stores).sort((a: any, b: any) => b[1] - a[1])[0]?.[0] || 'Desconocida';
                        
                        let cause = "Investigar patrón";
                        const fr = vals.firstResponderTotal;
                        const em = vals.employeeTotal;
                        const sen = vals.seniorTotal;

                        const maxAmt = Math.max(fr, em, sen);

                        if (maxAmt === fr && fr > 50) cause = "Posible colusión en First Responder";
                        else if (maxAmt === em && em > 50) cause = "Posible abuso de Privilegio Interno";
                        else if (maxAmt === sen && sen > 50) cause = "Abuso de Descuento Senior (Falsos Mayores)";
                        else if ((fr > 0 && em > 0) || (sen > 0 && em > 0)) cause = "Patrón mixto altamente atípico";
                        else cause = "Volumen sospechoso general";

                        return {
                            employee: emp,
                            highestStore: topStore,
                            firstResponderTotal: vals.firstResponderTotal,
                            employeeTotal: vals.employeeTotal,
                            seniorTotal: vals.seniorTotal,
                            totalRisk: vals.firstResponderTotal + vals.employeeTotal + vals.seniorTotal,
                            probableCause: cause
                        };
                    })
                    .sort((a, b) => b.totalRisk - a.totalRisk)
                    .slice(0, 5); // Solo el Top 5 Empleados de riesgo

                setRiskAlerts({ loading: false, data: structured });
            };
            fetchRisks();
        }
    }, [showWizard]);

    const handleModalSort = (column: string) => {
        setModalSort(prev => ({
            column,
            direction: prev.column === column && prev.direction === 'asc' ? 'desc' : 'asc'
        }));
    };

    let sortedModalData = selectedModalData ? [...selectedModalData.data] : [];
    if (selectedModalData) {
        sortedModalData.sort((a, b) => {
            let valA: any = '';
            let valB: any = '';
            if (modalSort.column === 'hora') {
                valA = new Date(a.opened_date || a.business_date).getTime();
                valB = new Date(b.opened_date || b.business_date).getTime();
            } else if (modalSort.column === 'sucursal') {
                valA = (a.store_name || '').toLowerCase();
                valB = (b.store_name || '').toLowerCase();
            } else if (modalSort.column === 'descuento') {
                valA = (a.discount_name || '').toLowerCase();
                valB = (b.discount_name || '').toLowerCase();
            } else if (modalSort.column === 'cajero') {
                valA = (a.approver_name || a.server_name || '').toLowerCase();
                valB = (b.approver_name || b.server_name || '').toLowerCase();
            } else if (modalSort.column === 'monto') {
                valA = Number(a.discount_amount);
                valB = Number(b.discount_amount);
            }
            if (valA < valB) return modalSort.direction === 'asc' ? -1 : 1;
            if (valA > valB) return modalSort.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }
    
    // Lista de tipos de descuentos únicos para ayudar a depurar/seleccionar
    const uniqueDiscountTypes = Array.from(new Set(discounts.map(d => d.discount_name))).sort()

    // Análisis de los datos dinámico (Basado en el filtro que elijan)
    const isPriorityDiscount = (name: string) => {
        const k = focusKeyword.toLowerCase()
        if (k === 'all') return true;
        
        const n = name.toLowerCase()
        if (k === 'senior') {
            return n.includes('senior') || n.includes('sr.') || n.includes('sr ') || n.includes('senor')
        }
        return n === k
    }

    const seniors = discounts.filter(d => isPriorityDiscount(d.discount_name))
    const others = discounts.filter(d => !isPriorityDiscount(d.discount_name))

    const totalSeniorAmount = seniors.reduce((acc, curr) => acc + Number(curr.discount_amount), 0)
    const totalOtherAmount = others.reduce((acc, curr) => acc + Number(curr.discount_amount), 0)
    
    // Group seniors by Approver (Cashier) to find suspicious activity
    const seniorsByApprover = seniors.reduce((acc, curr) => {
        // En Toast a veces approver_name puede venir vacío, usamos el server_name como fallback
        const name = curr.approver_name || curr.server_name || 'Desconocido'
        if (!acc[name]) acc[name] = { count: 0, amount: 0, store: curr.store_name }
        acc[name].count += 1
        acc[name].amount += Number(curr.discount_amount)
        return acc
    }, {} as Record<string, {count: number, amount: number, store: string}>)

    const topSeniorApprovers = Object.entries(seniorsByApprover)
        .sort((a, b) => b[1].amount - a[1].amount)
        .slice(0, 8)

    // Agrupación Toast: Resumen de Descuentos
    const summaryByDiscount = discounts.reduce((acc, curr) => {
        const name = curr.discount_name
        if (!acc[name]) acc[name] = { count: 0, amount: 0 }
        acc[name].count += 1
        acc[name].amount += Number(curr.discount_amount)
        return acc
    }, {} as Record<string, {count: number, amount: number}>)
    const discountReasonsTable = Object.entries(summaryByDiscount).sort((a, b) => b[1].amount - a[1].amount)

    // Agrupación Toast: Desglose por Empleado
    const summaryByEmployee = discounts.reduce((acc, curr) => {
        const empName = curr.approver_name || curr.server_name || 'Desconocido'
        const discName = curr.discount_name
        if (!acc[empName]) acc[empName] = { totalCount: 0, totalAmount: 0, stores: new Set<string>(), breakdowns: {} }
        acc[empName].totalCount += 1
        acc[empName].totalAmount += Number(curr.discount_amount)
        if (curr.store_name) acc[empName].stores.add(curr.store_name)
        if (!acc[empName].breakdowns[discName]) acc[empName].breakdowns[discName] = { count: 0, amount: 0 }
        acc[empName].breakdowns[discName].count += 1
        acc[empName].breakdowns[discName].amount += Number(curr.discount_amount)
        return acc
    }, {} as Record<string, { totalCount: number, totalAmount: number, stores: Set<string>, breakdowns: Record<string, {count: number, amount: number}> }>)
    const employeeTable = Object.entries(summaryByEmployee).sort((a, b) => b[1].totalAmount - a[1].totalAmount)

    // Gráfico: Impacto por Sucursal
    const storeImpactData = Object.entries(seniors.reduce((acc, curr) => {
        if (!acc[curr.store_name]) acc[curr.store_name] = 0;
        acc[curr.store_name] += Number(curr.discount_amount);
        return acc;
    }, {} as Record<string, number>))
    .map(([name, value]) => ({ 
        name: name.replace(/tacos gavilan/i, '').trim(), 
        value 
    }))
    .sort((a, b) => b.value - a.value);

    // Gráfico alternativo cuando se filtra 1 sola sucursal
    const isSingleStore = storeImpactData.length === 1;
    const singleStoreEmployeeData = Object.entries(seniors.reduce((acc, curr) => {
        const empName = curr.approver_name || curr.server_name || 'Autoservicio';
        if (!acc[empName]) acc[empName] = 0;
        acc[empName] += Number(curr.discount_amount);
        return acc;
    }, {} as Record<string, number>))
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 15);

    return (
        <div className="min-h-screen bg-transparent text-slate-900 dark:text-white font-sans pb-24">
            <div className="w-full max-w-7xl mx-auto px-4 md:px-6 py-8 relative z-10 space-y-6">
                
                {/* Header & Controls */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                             <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-200 shadow-sm">
                                AUDITORÍA ACTIVA
                            </span>
                             <button
                                onClick={() => setShowWizard(true)}
                                className="px-2.5 py-0.5 rounded text-[10px] font-bold bg-red-500 hover:bg-red-600 transition-colors text-white shadow-sm shadow-red-500/30 flex items-center gap-1.5 cursor-pointer"
                            >
                                <ShieldAlert size={12} className={riskAlerts.data.length > 0 ? "animate-pulse" : ""} />
                                Radar de Riesgos (15 Días)
                            </button>
                        </div>
                        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                            <AlertTriangle className="text-amber-500 w-8 h-8" />
                            Reporte de Descuentos
                        </h1>
                        <p className="text-slate-500 mt-1">Monitoreo y análisis de descuentos aplicados en sistema</p>
                    </div>

                    <div className="flex flex-col sm:flex-row flex-wrap items-center gap-2 bg-white/70 dark:bg-slate-900/80 p-1.5 rounded-2xl border border-black/5 dark:border-slate-800 backdrop-blur-xl shadow-lg shadow-black/5 w-full md:w-auto z-50">
                        <div className="flex items-center gap-1 mx-1">
                            <button 
                                onClick={() => shiftDate(-1)}
                                className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-200 dark:hover:text-white dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
                                title="Día Anterior"
                            >
                                <ChevronLeft className="w-5 h-5" />
                            </button>
                            <DateRangeFilter
                                period={period}
                                startDate={startDate}
                                endDate={endDate}
                                onChange={(p, s, e) => {
                                    setPeriod(p as any)
                                    setStartDate(s)
                                    setEndDate(e)
                                }}
                            />
                            <button 
                                onClick={() => shiftDate(1)}
                                disabled={isTodayOrFuture}
                                className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-200 dark:hover:text-white dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                                title="Día Siguiente"
                            >
                                <ChevronRight className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="flex items-center px-3 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl border border-black/5 dark:border-slate-700">
                            <Store className="w-4 h-4 text-slate-500 mr-2" />
                            <select 
                                value={storeFilter} 
                                onChange={e => setStoreFilter(e.target.value)}
                                className="bg-transparent text-slate-700 dark:text-slate-300 border-none outline-none focus:ring-0 text-sm font-medium appearance-none w-full pr-4"
                            >
                                <option value="all">Todas las Sucursales</option>
                                {uniqueStores.map(s => (
                                    <option key={s} value={s}>{s}</option>
                                ))}
                            </select>
                        </div>
                        
                        <div className="flex items-center px-3 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl border border-black/5 dark:border-slate-700">
                            <Filter className="w-4 h-4 text-amber-500 mr-2" />
                            <select 
                                value={focusKeyword} 
                                onChange={e => setFocusKeyword(e.target.value)}
                                className="bg-transparent text-slate-700 dark:text-slate-300 border-none outline-none focus:ring-0 text-sm font-medium appearance-none w-full pr-4 text-amber-600 dark:text-amber-500"
                            >
                                <option value="all">Foco Global: Todos</option>
                                <option value="senior">Foco Global: Seniors</option>
                                <optgroup label="Descuentos del Día">
                                    {uniqueDiscountTypes.map(s => (
                                        <option key={s} value={s}>Analizar: {s}</option>
                                    ))}
                                </optgroup>
                            </select>
                        </div>

                        <div className="flex flex-col sm:flex-row items-center gap-2 w-full mt-2 pt-2 border-t border-black/5 dark:border-slate-800">
                            <button 
                                onClick={async () => {
                                    if(loading) return;
                                    setLoading(true)
                                    try {
                                        const res = await fetch('/api/sync-discounts', {
                                            method: 'POST',
                                            body: JSON.stringify({ date: startDate })
                                        })
                                        const r = await res.json()
                                        if (r.success) {
                                            alert(`✅ EXTRACCIÓN MASIVA EXITOSA.\nSe sincronizó el día INICIAL seleccionado: ${startDate}.`)
                                            await fetchDiscounts()
                                        } else {
                                            alert('❌ Error descargando: ' + r.error)
                                        }
                                    } catch (e) {
                                        console.error(e)
                                    } finally {
                                        setLoading(false)
                                    }
                                }}
                                disabled={loading || !startDate}
                                className="w-full sm:w-auto px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 rounded-xl font-bold text-sm transition-all shadow-md flex justify-center items-center gap-2"
                            >
                                {loading ? 'Escaneando cajas...' : `📡 Sincronizar desde Toast (${startDate})`}
                            </button>
                        </div>
                    </div>
                </div>

                {/* KPIs */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Senior KPI (High Priority) */}
                    <div className="bg-white dark:bg-slate-900 border-l-4 border-l-amber-500 border-t border-r border-b border-black/5 dark:border-slate-800 p-6 rounded-xl relative overflow-hidden flex flex-col justify-between shadow-md">
                        <div className="absolute -right-4 -top-4 opacity-5">
                            <AlertTriangle className="w-32 h-32 text-amber-500" />
                        </div>
                        <h2 className="text-slate-500 dark:text-slate-400 font-semibold tracking-wide uppercase text-xs mb-1 truncate">TOTAL APLICADO EN: {focusKeyword === 'senior' ? 'SENIOR DISCOUNT' : focusKeyword === 'all' ? 'TODOS LOS DESCUENTOS' : focusKeyword.toUpperCase()}</h2>
                        <div className="text-4xl font-extrabold text-amber-600 dark:text-amber-500">${totalSeniorAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        <div className="mt-2 text-slate-600 dark:text-slate-400 text-sm font-medium bg-amber-50 dark:bg-amber-500/10 inline-table px-2 py-1 rounded w-fit border border-amber-100 dark:border-amber-500/20">
                            {seniors.length.toLocaleString('en-US')} Aplicaciones detectadas
                        </div>
                    </div>

                    {/* Other Discounts KPI */}
                    <div className="bg-white dark:bg-slate-900/50 border border-black/5 dark:border-slate-800 p-6 rounded-xl flex flex-col justify-between shadow-sm">
                        <h2 className="text-slate-500 dark:text-slate-400 font-semibold tracking-wide uppercase text-xs mb-1">Otros Descuentos</h2>
                        <div className="text-3xl font-bold text-slate-700 dark:text-slate-200">${totalOtherAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        <div className="mt-2 text-slate-500 text-sm">{others.length.toLocaleString('en-US')} Transacciones ordinarias</div>
                    </div>

                    {/* Grand Total */}
                    <div className="bg-slate-50 dark:bg-slate-900/80 border border-black/5 dark:border-slate-800 p-6 rounded-xl flex flex-col justify-between shadow-sm">
                        <h2 className="text-slate-500 dark:text-slate-400 font-semibold tracking-wide uppercase text-xs mb-1">Total General</h2>
                        <div className="text-3xl font-bold text-slate-900 dark:text-white">${(totalSeniorAmount + totalOtherAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        <div className="mt-2 text-slate-500 text-sm">Suma de todos los descuentos del día</div>
                    </div>
                </div>

                {loading ? (
                    <div className="flex justify-center py-20 text-emerald-500">
                        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-emerald-500"></div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        
                        {/* Senior Discount Breakdown (Takes 2 columns on Large screens) */}
                        <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-black/5 dark:border-slate-800 rounded-2xl shadow-xl shadow-black/5 overflow-hidden flex flex-col">
                            <div className="bg-slate-50 dark:bg-slate-800/50 p-5 border-b border-black/5 dark:border-slate-800 flex items-center justify-between">
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                    <User className="w-5 h-5 text-amber-500" /> 
                                    Desglose: {focusKeyword === 'senior' ? 'Senior Discounts' : focusKeyword === 'all' ? 'Todos Los Descuentos' : focusKeyword}
                                </h3>
                                <span className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400 px-3 py-1 rounded-full font-bold">
                                    Enfoque Principal
                                </span>
                            </div>
                            
                            <div className="p-0 grid grid-cols-1 md:grid-cols-2">
                                <div className="p-5 border-b md:border-b-0 md:border-r border-black/5 dark:border-slate-800 bg-white dark:bg-transparent">
                                    <h4 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-4">Top Cajeras Aplicando {focusKeyword === 'senior' ? 'Senior' : focusKeyword === 'all' ? 'Descuentos' : focusKeyword}</h4>
                                    <div className="space-y-3">
                                        {topSeniorApprovers.length === 0 && <p className="text-slate-500 text-sm italic">Sin datos para mostrar.</p>}
                                        {topSeniorApprovers.map(([name, data], i) => (
                                            <div 
                                                key={name} 
                                                className="flex justify-between items-center group hover:bg-amber-50 dark:hover:bg-amber-900/20 p-2 -mx-2 rounded-lg transition-colors cursor-pointer"
                                                onClick={() => setSelectedModalData({
                                                    type: 'EMPLOYEE',
                                                    title: `Desglose: ${name} (${focusKeyword === 'senior' ? 'Senior Discounts' : focusKeyword === 'all' ? 'Todos' : focusKeyword})`,
                                                    data: seniors.filter(d => (d.approver_name || d.server_name || 'Autoservicio') === name)
                                                })}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <span className={`font-mono text-sm font-bold w-4 text-center ${i < 3 ? 'text-amber-500' : 'text-slate-300 dark:text-slate-600'}`}>
                                                        {i + 1}.
                                                    </span>
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <p className="text-sm font-bold text-slate-700 dark:text-slate-200 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">{name}</p>
                                                            <span className="opacity-0 group-hover:opacity-100 text-[9px] bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 rounded font-bold text-slate-600 dark:text-slate-300 transition-opacity">Ver Detalles</span>
                                                        </div>
                                                        <p className="text-[10px] font-semibold uppercase text-slate-400">{data.store}</p>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-sm font-bold text-slate-900 dark:text-white">${data.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                                    <p className="text-[11px] text-slate-500 font-medium">{data.count.toLocaleString('en-US')} tickets</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                
                                <div className="p-5 bg-slate-50/50 dark:bg-slate-900/20">
                                    <h4 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-4 flex justify-between">
                                        <span>Últimas Transacciones</span>
                                        <span className="text-[10px] normal-case font-normal">Hora exacta Toast</span>
                                    </h4>
                                    <div className="max-h-[350px] overflow-y-auto pr-2 space-y-3 custom-scrollbar">
                                        {seniors.length === 0 && <p className="text-slate-500 text-sm italic">N/A</p>}
                                        {seniors.sort((a,b) => new Date(b.opened_date || b.business_date).getTime() - new Date(a.opened_date || a.business_date).getTime()).map(s => {
                                            const timeString = s.opened_date 
                                                ? new Date(s.opened_date).toLocaleTimeString('en-US', {hour: '2-digit', minute:'2-digit', hour12:true})
                                                : '--:--'
                                            const isRange = startDate !== endDate;
                                            
                                            // Nombre real en Toast:
                                            const realNameUsed = s.discount_name
                                            const cajera = s.approver_name || s.server_name || 'Autoservicio'

                                            return (
                                            <div key={s.id} className="text-xs bg-white dark:bg-slate-800 p-3 rounded border border-black/5 dark:border-slate-700 shadow-sm">
                                                <div className="flex justify-between mb-1.5 border-b border-slate-100 dark:border-slate-700 pb-1.5">
                                                    <span className="text-slate-700 dark:text-slate-200 font-bold">{cajera}</span>
                                                    <span className="text-emerald-600 dark:text-emerald-400 font-mono font-bold">${Number(s.discount_amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                </div>
                                                <div className="flex justify-between items-center mt-2">
                                                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">{s.store_name}</span>
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-[10px] italic text-slate-400 hidden sm:inline-block">({realNameUsed})</span>
                                                        <span className="bg-slate-100 dark:bg-slate-900 text-slate-400 px-1.5 py-0.5 rounded font-mono text-[10px] text-right flex flex-col justify-center leading-tight">
                                                            {isRange && s.business_date && <span className="text-[8px] font-bold text-slate-400 dark:text-slate-500">{s.business_date}</span>}
                                                            <span>{timeString}</span>
                                                        </span>
                                                        <button 
                                                            title="Ver recibo de la orden"
                                                            className="hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-400/10 px-1.5 py-0.5 rounded cursor-pointer border border-slate-200 dark:border-slate-600 hover:border-amber-200 dark:hover:border-amber-500/30 transition-all font-mono font-bold text-[10px] text-sky-600 dark:text-sky-400"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if(s.order_id === 'N/A' || !s.order_id) return alert('No hay ID interno para jalar esta orden.');
                                                                setOrderDetailData({ loading: true, checkId: s.check_id, storeName: s.store_name, cajeraName: s.approver_name || s.server_name || 'Autoservicio' });
                                                                fetch(`/api/toast-order-detail?guid=${s.order_id}&storeId=${s.store_id}`)
                                                                    .then(res => res.json())
                                                                    .then(data => {
                                                                        if(data.error) setOrderDetailData(prev => prev ? { ...prev, loading: false, error: data.error } : null);
                                                                        else setOrderDetailData(prev => prev ? { ...prev, loading: false, data: data.order } : null);
                                                                    })
                                                                    .catch(err => setOrderDetailData(prev => prev ? { ...prev, loading: false, error: err.message } : null));
                                                            }}
                                                        >
                                                            #{s.check_id || 'N/A'}
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        )})}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Impact Graph (Takes 1 column) */}
                        <div className="bg-white dark:bg-slate-900 border border-black/5 dark:border-slate-800 rounded-2xl shadow-xl shadow-black/5 overflow-hidden flex flex-col">
                            <div className="p-5 border-b border-black/5 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex justify-between items-center">
                                <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                    {isSingleStore ? <User className="w-5 h-5 text-emerald-500" /> : <Store className="w-5 h-5 text-sky-500" />}
                                    {isSingleStore ? 'Impacto por Cajero(a)' : 'Impacto por Sucursal'}
                                </h3>
                                <span className="text-[10px] uppercase font-bold text-slate-400">
                                    {isSingleStore ? `Top 15 - ${storeImpactData[0].name}` : 'Todas'}
                                </span>
                            </div>
                            <div className="p-5 flex-1 w-full min-h-[400px] h-full flex flex-col">
                                {storeImpactData.length === 0 ? (
                                    <div className="h-full flex items-center justify-center"><p className="text-slate-400 italic text-sm">No hay información suficiente para graficar.</p></div>
                                ) : (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart
                                            data={isSingleStore ? singleStoreEmployeeData : storeImpactData}
                                            layout="vertical"
                                            margin={{ top: 0, right: 30, left: 10, bottom: 0 }}
                                        >
                                            <XAxis type="number" hide />
                                            <YAxis 
                                                dataKey="name" 
                                                type="category" 
                                                axisLine={false} 
                                                tickLine={false} 
                                                tick={{ fill: '#64748b', fontSize: 11, fontWeight: 'bold' }} 
                                                width={90}
                                            />
                                            <RechartsTooltip 
                                                cursor={{fill: 'transparent'}}
                                                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1)', padding: '10px 15px', backgroundColor: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(5px)' }}
                                                itemStyle={{ color: '#0f172a', fontWeight: 'bold' }}
                                                formatter={(value: any) => [`$${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 'Descuentos']}
                                                labelStyle={{ display: 'none' }}
                                            />
                                            <Bar 
                                                dataKey="value" 
                                                radius={[0, 6, 6, 0]} 
                                                barSize={24}
                                                onClick={(e) => {
                                                    if(e && e.name) {
                                                        if (isSingleStore) {
                                                            setSelectedModalData({
                                                                type: 'EMPLOYEE',
                                                                title: `Cajero: ${e.name} en ${storeImpactData[0].name}`,
                                                                data: seniors.filter(d => (d.approver_name || d.server_name || 'Autoservicio') === e.name)
                                                            })
                                                        } else {
                                                            setSelectedModalData({
                                                                type: 'STORE',
                                                                title: `Sucursal: ${e.name} (${focusKeyword === 'senior' ? 'Senior Discounts' : focusKeyword === 'all' ? 'Todos' : focusKeyword})`,
                                                                data: seniors.filter(d => d.store_name?.toLowerCase().includes((e.name as string).toLowerCase()))
                                                            })
                                                        }
                                                    }
                                                }}
                                                cursor="pointer"
                                            >
                                                {(isSingleStore ? singleStoreEmployeeData : storeImpactData).map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={index === 0 ? '#10b981' : (isSingleStore ? '#34d399' : '#38bdf8')} className="hover:opacity-80 transition-opacity" />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                )}
                            </div>
                        </div>

                        {/* ----------------- NUEVAS TABLAS ESTILO TOAST WEB ----------------- */}
                        <div className="lg:col-span-3 grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
                            
                            {/* Tabla 1: Resumen General (Discount Reasons) */}
                            <div className="bg-white dark:bg-slate-900 border border-black/5 dark:border-slate-800 rounded-2xl shadow-xl overflow-hidden flex flex-col">
                                <div className="p-5 border-b border-black/5 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-center justify-between">
                                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">Resumen General de Descuentos</h3>
                                    <span className="text-[10px] uppercase font-bold text-slate-400 bg-transparent px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">Discount Reasons (Toast)</span>
                                </div>
                                <div className="overflow-x-auto max-h-[500px] custom-scrollbar">
                                    <table className="w-full text-left text-sm whitespace-nowrap">
                                        <thead className="text-[11px] uppercase tracking-wider text-slate-500 bg-slate-50/80 dark:bg-slate-900/80 border-b border-slate-100 dark:border-slate-800 sticky top-0 backdrop-blur-md z-10">
                                            <tr>
                                                <th className="px-5 py-3 font-semibold">Tipo de Descuento</th>
                                                <th className="px-5 py-3 font-semibold text-right">Cant.</th>
                                                <th className="px-5 py-3 font-semibold text-right">Monto Total</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                                            {discountReasonsTable.length === 0 && (
                                                <tr><td colSpan={3} className="px-5 py-4 text-center italic text-slate-400">Sin datos</td></tr>
                                            )}
                                            {discountReasonsTable.map(([name, data]) => (
                                                <tr key={name} onClick={() => setSelectedModalData({ type: 'REASON', title: `Desglose: ${name}`, data: discounts.filter(d => d.discount_name === name) })} className="hover:bg-amber-50/50 dark:hover:bg-amber-900/20 transition-colors cursor-pointer relative group">
                                                    <td className="px-5 py-3 font-bold text-slate-700 dark:text-slate-300">
                                                        <div className="flex items-center justify-between">
                                                            {name}
                                                            <span className="opacity-0 group-hover:opacity-100 text-[10px] bg-slate-200 dark:bg-slate-700 px-2 py-0.5 rounded text-slate-600 dark:text-slate-300 transition-opacity">Ver Detalles</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-5 py-3 text-right text-slate-600 dark:text-slate-400 font-mono">{data.count.toLocaleString('en-US')}</td>
                                                    <td className="px-5 py-3 text-right text-slate-900 dark:text-white font-mono font-bold">${data.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                        <tfoot className="bg-slate-100 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-700 font-bold sticky bottom-0 z-10">
                                            <tr>
                                                <td className="px-5 py-3 text-slate-800 dark:text-slate-200">GRAN TOTAL</td>
                                                <td className="px-5 py-3 text-right text-slate-900 dark:text-white font-mono">{discountReasonsTable.reduce((sum, [_, d]) => sum + d.count, 0).toLocaleString('en-US')}</td>
                                                <td className="px-5 py-3 text-right text-emerald-600 dark:text-emerald-400 font-mono text-lg">${discountReasonsTable.reduce((sum, [_, d]) => sum + d.amount, 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>

                            {/* Tabla 2: Desglose por Empleado (Discount by Employee) */}
                            <div className="bg-white dark:bg-slate-900 border border-black/5 dark:border-slate-800 rounded-2xl shadow-xl overflow-hidden flex flex-col">
                                <div className="p-5 border-b border-black/5 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-center justify-between">
                                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">Desglose a Fondo Por Cajero(a)</h3>
                                    <span className="text-[10px] uppercase font-bold text-slate-400 bg-transparent px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">Por Empleado (Toast)</span>
                                </div>
                                <div className="overflow-x-auto max-h-[500px] custom-scrollbar">
                                    <table className="w-full min-w-[500px] text-left text-sm">
                                        <thead className="text-[11px] uppercase tracking-wider text-slate-500 bg-slate-50/80 dark:bg-slate-900/80 border-b border-slate-100 dark:border-slate-800 sticky top-0 backdrop-blur-md z-10">
                                            <tr>
                                                <th className="px-4 sm:px-5 py-3 font-semibold min-w-[120px] max-w-[200px]">Cajero(a)</th>
                                                <th className="px-4 sm:px-5 py-3 font-semibold">Tipo Detectado</th>
                                                <th className="px-4 sm:px-5 py-3 font-semibold text-right whitespace-nowrap">Cant.</th>
                                                <th className="px-4 sm:px-5 py-3 font-semibold text-right whitespace-nowrap">Monto</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                                            {employeeTable.length === 0 && (
                                                <tr><td colSpan={4} className="px-5 py-4 text-center italic text-slate-400">Sin datos</td></tr>
                                            )}
                                            {employeeTable.map(([empName, data]) => (
                                                <tr key={empName} onClick={() => setSelectedModalData({ type: 'EMPLOYEE', title: `Auditoría: ${empName}`, data: discounts.filter(d => (d.approver_name || d.server_name || 'Desconocido') === empName) })} className="hover:bg-amber-50/50 dark:hover:bg-amber-900/20 transition-colors cursor-pointer group">
                                                    <td className="px-4 sm:px-5 py-3 font-bold text-slate-800 dark:text-slate-200 align-top relative min-w-[120px] max-w-[200px]">
                                                        <div className="flex flex-col pr-2">
                                                            <div className="flex items-center flex-wrap gap-2">
                                                                <span className="truncate max-w-full block" title={empName}>{empName}</span>
                                                                <span className="opacity-0 group-hover:opacity-100 text-[9px] bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-300 transition-opacity hidden lg:inline-block">Detalles</span>
                                                            </div>
                                                            <div className="text-[9px] text-slate-400 dark:text-slate-500 font-bold tracking-widest mt-0.5 uppercase break-words whitespace-normal w-full" title={Array.from(data.stores).join(', ')}>{Array.from(data.stores).join(', ')}</div>
                                                            <div className="text-[10px] text-slate-500 font-medium uppercase mt-1">Total: <span className="text-slate-900 dark:text-white font-mono font-bold">${data.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 sm:px-5 py-3 align-top min-w-[120px]">
                                                        <div className="space-y-2">
                                                            {Object.keys(data.breakdowns).sort((a,b) => data.breakdowns[b].amount - data.breakdowns[a].amount).map(discName => (
                                                                <div key={discName} className={`text-[10px] sm:text-xs leading-tight whitespace-normal break-words ${discName.toLowerCase().includes('senior') ? 'text-amber-600 dark:text-amber-400 font-extrabold' : 'text-slate-600 dark:text-slate-400 font-bold'}`}>
                                                                    {discName}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 sm:px-5 py-3 text-right align-top font-mono text-slate-500 whitespace-nowrap">
                                                        <div className="space-y-2 text-xs">
                                                            {Object.keys(data.breakdowns).sort((a,b) => data.breakdowns[b].amount - data.breakdowns[a].amount).map(discName => (
                                                                <div key={discName} className="py-[1px] text-[10px] sm:text-xs">{data.breakdowns[discName].count.toLocaleString('en-US')}</div>
                                                            ))}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 sm:px-5 py-3 text-right align-top font-mono text-slate-800 dark:text-slate-200 whitespace-nowrap">
                                                        <div className="space-y-2 text-xs">
                                                            {Object.keys(data.breakdowns).sort((a,b) => data.breakdowns[b].amount - data.breakdowns[a].amount).map(discName => (
                                                                <div key={discName} className="py-[1px] font-bold">${data.breakdowns[discName].amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                                            ))}
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                        <tfoot className="bg-slate-100 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-700 font-bold sticky bottom-0 z-10 w-full">
                                            <tr>
                                                <td colSpan={2} className="px-4 sm:px-5 py-3 text-slate-800 dark:text-slate-200 text-xs whitespace-nowrap">TOTAL: {employeeTable.length.toLocaleString('en-US')} CAJEROS</td>
                                                <td className="px-4 sm:px-5 py-3 text-right text-slate-900 dark:text-white font-mono font-bold whitespace-nowrap">{employeeTable.reduce((sum, [_, d]) => sum + d.totalCount, 0).toLocaleString('en-US')}</td>
                                                <td className="px-4 sm:px-5 py-3 text-right text-emerald-600 dark:text-emerald-400 font-mono text-lg font-bold pr-6 sm:pr-8 whitespace-nowrap">${employeeTable.reduce((sum, [_, d]) => sum + d.totalAmount, 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>
                        </div>

                    </div>
                )}

            </div>

            {selectedModalData && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200 cursor-pointer" onClick={() => setSelectedModalData(null)}>
                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col cursor-default" onClick={e => e.stopPropagation()}>
                        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 rounded-t-2xl shrink-0">
                            <h3 className="font-bold text-slate-900 dark:text-white text-lg">{selectedModalData.title}</h3>
                            <button onClick={() => setSelectedModalData(null)} className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-slate-500 transition-colors">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                            </button>
                        </div>
                        <div className="p-0 overflow-auto custom-scrollbar flex-1">
                            <table className="w-full text-left text-sm whitespace-nowrap min-w-max">
                                <thead className="text-[10px] uppercase tracking-wider text-slate-500 bg-white dark:bg-slate-900 sticky top-0 border-b border-slate-100 dark:border-slate-800 z-10 shadow-sm">
                                    <tr>
                                        <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors select-none" onClick={() => handleModalSort('hora')}>
                                            {startDate !== endDate ? 'Fecha y Hora' : 'Hora'} {modalSort.column === 'hora' && (modalSort.direction === 'asc' ? '↑' : '↓')}
                                        </th>
                                        <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors select-none" onClick={() => handleModalSort('sucursal')}>
                                            Sucursal {modalSort.column === 'sucursal' && (modalSort.direction === 'asc' ? '↑' : '↓')}
                                        </th>
                                        <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors select-none" onClick={() => handleModalSort('descuento')}>
                                            Tipo Descuento {modalSort.column === 'descuento' && (modalSort.direction === 'asc' ? '↑' : '↓')}
                                        </th>
                                        <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors select-none" onClick={() => handleModalSort('cajero')}>
                                            Cajero(a) {modalSort.column === 'cajero' && (modalSort.direction === 'asc' ? '↑' : '↓')}
                                        </th>
                                        <th className="px-4 py-3 font-semibold">Orden / Cheque</th>
                                        <th className="px-4 py-3 font-semibold text-right cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors select-none" onClick={() => handleModalSort('monto')}>
                                            Monto Descuento {modalSort.column === 'monto' && (modalSort.direction === 'asc' ? '↑' : '↓')}
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                                    {sortedModalData.map((row, idx) => (
                                        <tr key={`${row.id}-${idx}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors group">
                                            <td className="px-4 py-2.5 font-mono text-slate-600 dark:text-slate-400">
                                                {startDate !== endDate && row.business_date && (
                                                    <div className="text-[9px] font-bold tracking-widest text-slate-400 dark:text-slate-500 uppercase">{row.business_date}</div>
                                                )}
                                                <div>{row.opened_date ? new Date(row.opened_date).toLocaleTimeString('en-US', {hour: '2-digit', minute:'2-digit', hour12:true}) : '--:--'}</div>
                                            </td>
                                            <td className="px-4 py-2.5 text-[11px] font-bold tracking-wide uppercase text-slate-700 dark:text-slate-300">{row.store_name}</td>
                                            <td className="px-4 py-2.5 font-bold text-sky-600 dark:text-sky-400 group-hover:text-amber-500 transition-colors">{row.discount_name}</td>
                                            <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300">{row.approver_name || row.server_name || 'Autoservicio'}</td>
                                            <td className="px-4 py-2.5 text-[11px] font-mono font-bold text-slate-500 dark:text-slate-400">
                                                <button 
                                                    title={`GUID Interno: ${row.order_id}\nDa clic para extraer ticket desde los servidores de Toast.`}
                                                    className="hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-400/10 px-2 py-0.5 rounded cursor-pointer border border-transparent hover:border-amber-200 dark:hover:border-amber-500/30 transition-all font-bold text-sky-600 dark:text-sky-400"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if(row.order_id === 'N/A' || !row.order_id) return alert('No hay ID interno para jalar esta orden.');
                                                        setOrderDetailData({ loading: true, checkId: row.check_id, storeName: row.store_name, cajeraName: row.approver_name || row.server_name || 'Autoservicio' });
                                                        fetch(`/api/toast-order-detail?guid=${row.order_id}&storeId=${row.store_id}`)
                                                            .then(res => res.json())
                                                            .then(data => {
                                                                if(data.error) setOrderDetailData(prev => prev ? { ...prev, loading: false, error: data.error } : null);
                                                                else setOrderDetailData(prev => prev ? { ...prev, loading: false, data: data.order } : null);
                                                            })
                                                            .catch(err => setOrderDetailData(prev => prev ? { ...prev, loading: false, error: err.message } : null));
                                                    }}
                                                >
                                                    #{row.check_id || 'N/A'}
                                                </button>
                                            </td>
                                            <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-900 dark:text-white">${Number(row.discount_amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 rounded-b-2xl flex justify-between items-center shrink-0">
                            <span className="text-sm text-slate-500 font-medium">Se recopilaron {selectedModalData.data.length.toLocaleString('en-US')} aplicaciones activas</span>
                            <span className="font-bold text-slate-900 dark:text-white text-sm">
                                Total Acumulado: <span className="text-emerald-600 dark:text-emerald-400 font-mono text-xl ml-2">${selectedModalData.data.reduce((acc, curr) => acc + Number(curr.discount_amount), 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </span>
                        </div>
                    </div>
                </div>
            )}

            {/* SECONDARY MODAL: RECEIPT VIEWER */}
            {orderDetailData && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in zoom-in-95 duration-200" onClick={() => setOrderDetailData(null)}>
                    <div className="bg-white dark:bg-slate-900/90 rounded-none md:rounded-xl shadow-2xl w-full max-w-sm max-h-[90vh] flex flex-col font-mono text-sm border-2 border-slate-200 dark:border-slate-700" onClick={e => e.stopPropagation()}>
                        
                        <div className="p-4 border-b-2 border-dashed border-slate-300 dark:border-slate-700 font-bold text-center bg-white dark:bg-slate-800 md:rounded-t-xl shrink-0">
                            RECIBO TICKET #{orderDetailData.checkId}
                            {orderDetailData.loading && <p className="text-amber-500 animate-pulse text-xs mt-1">Conectando con cajero virtual...</p>}
                        </div>
                        
                        <div className="p-4 overflow-auto custom-scrollbar flex-1 bg-[#f9fafb] dark:bg-slate-900">
                            {orderDetailData.error && <div className="text-red-500 text-xs break-all bg-red-50 p-2 rounded border border-red-200">{orderDetailData.error}</div>}
                            
                            {orderDetailData.data && (
                                <div className="space-y-4 text-slate-800 dark:text-slate-200">
                                    <div className="text-xs text-center border-b border-slate-200 dark:border-slate-800 pb-3">
                                        <div className="font-bold text-[14px] uppercase tracking-wider mb-1">SUCURSAL {orderDetailData.storeName || orderDetailData.data.restaurantService?.name || 'TACOS GAVILAN'}</div>
                                        <div>{orderDetailData.data.diningOption?.name || 'Para Llevar / Dine In'}</div>
                                        <div>{new Date(orderDetailData.data.openedDate).toLocaleString('es-MX')}</div>
                                        <div className="mt-1">Cajero/a: <span className="font-bold">{orderDetailData.cajeraName || orderDetailData.data.server?.name || 'Automático'}</span></div>
                                    </div>
                                    
                                    <div className="border-b-2 border-dashed border-slate-300 dark:border-slate-700 pb-3 space-y-1">
                                        <div className="flex justify-between font-bold text-[10px] text-slate-400 mb-2 uppercase tracking-widest">
                                            <span>ITEM</span>
                                            <span>TOTAL</span>
                                        </div>
                                        {orderDetailData.data.checks?.map((check:any, idx:number) => (
                                            <div key={idx} className="space-y-2">
                                                {check.selections?.filter((s:any)=> !s.deleted && !s.voided).map((sel:any, i:number) => (
                                                    <div key={i} className="flex justify-between items-start text-xs">
                                                        <span className="flex-1 pr-2">
                                                            {sel.quantity}x {sel.displayName || sel.item?.name}
                                                            {sel.appliedDiscounts?.map((d:any, j:number) => (
                                                                <div key={j} className="text-amber-600 dark:text-amber-400 text-[10px] ml-4 font-bold border-l-2 border-amber-300 pl-1 mt-0.5">
                                                                    DESC {d.name} (-${Number(d.discountAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                                                                </div>
                                                            ))}
                                                        </span>
                                                        <span className="font-bold whitespace-nowrap">${Number(sel.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                    </div>
                                                ))}
                                                {check.appliedDiscounts?.map((d:any, j:number) => (
                                                    <div key={j} className="flex justify-between items-start text-[11px] text-amber-600 dark:text-amber-400 font-bold bg-amber-50 dark:bg-amber-500/10 p-1 -mx-1 rounded">
                                                        <span>DESC. TICKET: {d.name}</span>
                                                        <span>-${Number(d.discountAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        ))}
                                    </div>
                                    
                                    <div className="text-right space-y-1 text-xs">
                                        <div className="flex justify-between text-slate-500"><span>Subtotal:</span> <span>${Number(orderDetailData.data.checks?.[0]?.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                                        <div className="flex justify-between text-slate-500"><span>Tax:</span> <span>${Number(orderDetailData.data.checks?.[0]?.taxAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                                        <div className="flex justify-between font-bold text-lg mt-2 text-slate-900 dark:text-white border-t border-slate-200 dark:border-slate-800 pt-2"><span>TOTAL:</span> <span>${(Number(orderDetailData.data.checks?.[0]?.totalAmount || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                                    </div>

                                    {orderDetailData.data.checks?.[0]?.payments?.length > 0 && (
                                        <div className="text-xs pt-3 border-t-2 border-dashed border-slate-300 dark:border-slate-700">
                                            <div className="font-bold text-slate-400 mb-1">PAGOS APLICADOS:</div>
                                            {orderDetailData.data.checks?.[0]?.payments.map((p:any, pIdx:number) => (
                                                <div key={pIdx} className="flex justify-between text-slate-600 dark:text-slate-400">
                                                    <span>{p.type || 'Pago'} {p.originalPaymentStatus && p.originalPaymentStatus !== 'NONE' ? '(Original)' : ''} {p.refundStatus && p.refundStatus !== 'NONE' ? '(Reembolsado)' : ''}</span>
                                                    <span>${Number(p.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                        
                        <div className="p-3 text-center border-t-2 border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 md:rounded-b-xl shrink-0">
                            <button onClick={() => setOrderDetailData(null)} className="text-xs uppercase tracking-widest font-bold text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 px-6 py-2 rounded transition-colors w-full border border-slate-200 dark:border-slate-700 cursor-pointer">
                                Cerrar Recibo
                            </button>
                        </div>
                    </div>
                </div>
            )}
            
            {/* WIZARD & RIESGO (15 Días) */}
            {showWizard && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-300">
                    <div className="bg-white dark:bg-slate-900 w-full max-w-5xl max-h-[90vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-slate-200 dark:border-slate-700">
                        
                        {/* Header */}
                        <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-6 flex justify-between items-center shrink-0">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-red-500/20 rounded-lg">
                                    <ShieldAlert className="w-8 h-8 text-red-500" />
                                </div>
                                <div className="text-white">
                                    <h2 className="text-2xl font-black tracking-tight flex items-center gap-2">
                                        C.O.R.E. 
                                        <span className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-widest mt-1">Beta</span>
                                    </h2>
                                    <p className="text-slate-400 text-sm">Auditoría Forense P.O.S. y Prevención de Mermas</p>
                                </div>
                            </div>
                            <button onClick={() => setShowWizard(false)} className="p-2 bg-white/5 hover:bg-white/10 rounded-full text-white transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Body */}
                        <div className="flex-1 overflow-auto p-6 md:p-8 flex flex-col md:flex-row gap-8 custom-scrollbar">
                            
                            {/* Instricciones / Reglas */}
                            <div className="flex-1 space-y-6">
                                <div>
                                    <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2 mb-2">
                                        <Info className="w-5 h-5 text-sky-500" /> ¿Cómo utilizar este Dashboard?
                                    </h3>
                                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                                        Este módulo no es para ver ventas, es para <b>encontrar fugas ocultas</b>. La industria QSR sufre robos mediante los micro-descuentos aplicados por el staff sin autorización.
                                    </p>
                                </div>

                                <div className="grid gap-4">
                                    <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
                                        <h4 className="font-bold text-slate-700 dark:text-slate-300 text-sm mb-1">1. "Sweethearting" (El Compadrazgo)</h4>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">Empleados aplicando descuentos de <em>First Responder</em> o <em>Employee</em> a amigos y familiares. Revisa los Top Cajeros; si alguien destaca abruptamente, investígalo.</p>
                                    </div>
                                    <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
                                        <h4 className="font-bold text-slate-700 dark:text-slate-300 text-sm mb-1">2. Cash Pocketing (Robo de Efectivo)</h4>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">El cliente paga en efectivo, el cajero aplica un descuento retroactivo del 50% al ticket antes de cerrarlo, y se roba la diferencia física de la caja menor. Toast cuadrará, pero Gavilán pierde.</p>
                                    </div>
                                    <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
                                        <h4 className="font-bold text-slate-700 dark:text-slate-300 text-sm mb-1">3. Falsos Mayores (Senior Fraud)</h4>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">Si los clientes pagan en efectivo sin reclamar su edad, el cajero puede aplicar un <em>Senior Discount</em> retroactivo y quedarse ese margen repetidamente.</p>
                                    </div>
                                    <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
                                        <h4 className="font-bold text-slate-700 dark:text-slate-300 text-sm mb-1">4. Verificación de Cámara Integral</h4>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">Haz clic en cualquier celda para ver el Check ID. Cruza esa <b>identificación de ticket y la hora exacta</b> con tus grabaciones de seguridad. Comprueba si de verdad había un oficial u anciano elegible.</p>
                                    </div>
                                </div>
                            </div>

                            {/* Resultados de Arrastre de 15 Días */}
                            <div className="w-full md:w-[400px] border-t md:border-t-0 md:border-l border-slate-200 dark:border-slate-700 pt-6 md:pt-0 md:pl-8 flex flex-col">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-lg font-bold text-red-600 dark:text-red-500 flex items-center gap-2">
                                        <Target className="w-5 h-5" /> Radar de Anomalías
                                    </h3>
                                    <span className="text-[10px] uppercase font-black tracking-widest text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">Últimos 15 Días</span>
                                </div>

                                <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                                El escáner del sistema filtró los subsidios vulnerables más usados (<span className="text-slate-700 dark:text-slate-300 font-medium">First Responder</span>, <span className="text-slate-700 dark:text-slate-300 font-medium">Employee Discount</span>, y <span className="text-slate-700 dark:text-slate-300 font-medium">Senior</span>). Estos son los perfiles bajo observación:
                                </p>

                                <div className="flex-1 space-y-3">
                                    {riskAlerts.loading ? (
                                        <div className="flex justify-center items-center h-full">
                                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-500"></div>
                                        </div>
                                    ) : riskAlerts.data.length === 0 ? (
                                        <div className="bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 p-4 rounded-xl text-sm font-bold text-center border border-emerald-200 dark:border-emerald-800/50">
                                            ✅ No se detectaron perfiles altos de riesgo en este periodo de tiempo examinado.
                                        </div>
                                    ) : (
                                        riskAlerts.data.map((r, i) => (
                                            <div key={r.employee} className="bg-red-50 dark:bg-slate-800/80 border border-red-100 dark:border-red-900/30 p-3 rounded-xl flex items-center justify-between relative overflow-hidden group hover:scale-[1.02] transition-transform">
                                                <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-400 dark:bg-red-600"></div>
                                                <div className="flex-1">
                                                    <div className="font-bold text-slate-800 dark:text-slate-200 text-sm flex items-center gap-2">
                                                        <span className="shrink-0 w-5 h-5 rounded bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400 text-[10px] flex items-center justify-center pointer-events-none">{i + 1}</span>
                                                        <span className="truncate">{r.employee}</span>
                                                    </div>
                                                    <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 uppercase font-bold tracking-wider">
                                                        Base Op: {r.highestStore}
                                                    </div>
                                                    <div className="text-[10px] font-medium bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 px-1.5 py-0.5 rounded mt-1.5 inline-block border border-red-200 dark:border-red-800">
                                                        💡 {r.probableCause}
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="font-black text-red-600 dark:text-red-400">
                                                        ${r.totalRisk.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}
                                                    </div>
                                                    <div className="text-[9px] text-slate-500 dark:text-slate-400 leading-tight mt-0.5">
                                                        Policía: ${r.firstResponderTotal.toFixed(0)} <br/>
                                                        Staff: ${r.employeeTotal.toFixed(0)} <br/>
                                                        Senior: ${r.seniorTotal.toFixed(0)}
                                                    </div>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>

                        </div>

                        {/* Footer */}
                        <div className="bg-slate-50 dark:bg-slate-800 p-4 md:px-8 flex justify-end shrink-0 border-t border-slate-200 dark:border-slate-700">
                            <button 
                                onClick={() => setShowWizard(false)}
                                className="bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-100 px-6 py-2.5 rounded-xl font-bold transition-all shadow-lg active:scale-95"
                            >
                                Entendido, Abrir Dashboard
                            </button>
                        </div>
                    </div>
                </div>
            )}

            
            <style jsx global>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 5px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: #cbd5e1;
                    border-radius: 5px;
                }
                .dark .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: #334155;
                }
            `}</style>
        </div>
    )
}
