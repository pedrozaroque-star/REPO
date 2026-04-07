'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Calendar, Loader2, Zap, ArrowLeft, History, RefreshCw, Maximize, Minimize } from 'lucide-react'
import { motion } from 'framer-motion'
import { getSupabaseClient } from '@/lib/supabase'
import { formatDateISO, formatStoreName, getMonday, addDays, getRoleWeight } from '@/app/planificador-v2/lib/utils'
import { Shift, Employee, Job } from '@/app/planificador-v2/lib/types'

import { scheduleBreaksWithDemand } from '@/lib/breaks-engine'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

export default function DescansosPage() {
    const searchParams = useSearchParams()
    
    const containerRef = useRef<HTMLDivElement>(null)
    const [isFullscreen, setIsFullscreen] = useState(false)

    useEffect(() => {
        const onFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement)
        }
        document.addEventListener('fullscreenchange', onFullscreenChange)
        return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
    }, [])

    const toggleFullscreen = () => {
        if (!document.fullscreenElement) {
            containerRef.current?.requestFullscreen().catch(err => {
                alert(`Error intentando Fullscreen: ${err.message}`)
            })
        } else {
            document.exitFullscreen()
        }
    }
    
    const [loading, setLoading] = useState(true)
    const [calculating, setCalculating] = useState(false)
    const [stores, setStores] = useState<any[]>([])
    const [selectedStoreId, setSelectedStoreId] = useState<string>('')
    const [currentDate, setCurrentDate] = useState(() => {
        const paramDate = searchParams?.get('date')
        if (paramDate) {
            // Reconstruit YYYY-MM-DD avoiding TZ shift by appending noon
            const d = new Date(paramDate + 'T12:00:00')
            if (!isNaN(d.getTime())) return d
        }
        return new Date()
    })
    
    // Roster de la semana (Idéntico a Planificador)
    const [rosterEmployees, setRosterEmployees] = useState<Employee[]>([])
    
    // Turnos específicos del día actual para renderizar
    const [todayShifts, setTodayShifts] = useState<Shift[]>([])
    const [punches, setPunches] = useState<any[]>([]) 
    const [operatingHours, setOperatingHours] = useState<any[]>([])
    const [smartShifts, setSmartShifts] = useState<Shift[]>([])

    const [showRealPunches, setShowRealPunches] = useState(false)
    const [isRefreshingToast, setIsRefreshingToast] = useState(false)

    useEffect(() => {
        async function loadBasics() {
            setLoading(true)
            const supabase = await getSupabaseClient()
            const { data: storesData } = await supabase.from('stores').select('*').order('name')
            if (storesData) {
                setStores(storesData)
                if (storesData.length > 0) {
                    const storeParam = searchParams?.get('store')
                    const matchedStore = storeParam ? storesData.find(s => String(s.id) === storeParam) : null
                    setSelectedStoreId(matchedStore ? String(matchedStore.id) : String(storesData[0].id))
                }
            }
            setLoading(false)
        }
        loadBasics()
    }, [searchParams])

    const storeGuid = useMemo(() => {
        return stores.find(s => String(s.id) === String(selectedStoreId))?.external_id
    }, [stores, selectedStoreId])

    const dateStr = formatDateISO(currentDate)

    const pullToastPunches = useCallback(async (isManual = false) => {
        if (!storeGuid) return;
        if (isManual) setIsRefreshingToast(true);
        
        try {
            // Si es manual, forzamos la sincronización directa con los servidores de Toast
            if (isManual) {
                await fetch('/api/sync/sales-live', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ storeId: storeGuid })
                })
            }

            const supabase = await getSupabaseClient()
            const { data: punchData } = await supabase
                .from('punches')
                .select('employee_toast_guid, clock_in, clock_out, breaks')
                .eq('store_id', storeGuid)
                .eq('business_date', dateStr)
            
            if (punchData) setPunches(punchData)
        } catch (error) {
            console.error("Error pulling Toast punches:", error)
        } finally {
            if (isManual) setIsRefreshingToast(false);
        }
    }, [storeGuid, dateStr]);

    // Polling hook for live Toast updates
    useEffect(() => {
        if (!showRealPunches) return; // Sólo actualizar si la vista está activa
        const intervalId = setInterval(() => {
            pullToastPunches(false);
        }, 5 * 60 * 1000);
        return () => clearInterval(intervalId);
    }, [showRealPunches, pullToastPunches]);

    const loadDayData = async () => {
        if (!storeGuid) return;
        setCalculating(true)
        const supabase = await getSupabaseClient()

        // 1. Fechas de toda la semana para emular el Roster del Planificador
        const weekStartM = getMonday(currentDate)
        const startStr = formatDateISO(weekStartM)
        const endStr = formatDateISO(addDays(weekStartM, 6))

        // 2. Traer Empleados, Trabajos y Turnos de la semana
        let allEmpDataRaw: any[] = []
        let page = 0
        const PAGE_SIZE = 1000
        let hasMore = true
        while (hasMore) {
            const { data, error } = await supabase
                .from('toast_employees')
                .select('*')
                .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
            
            if (error || !data) break;
            allEmpDataRaw = [...allEmpDataRaw, ...data]
            if (data.length < PAGE_SIZE) hasMore = false
            page++
        }

        const { data: jobsDataRaw } = await supabase.from('toast_jobs').select('*')
        const { data: weekShiftsData } = await supabase.from('shifts')
            .select('*')
            .eq('store_id', storeGuid)
            .gte('shift_date', startStr)
            .lte('shift_date', endStr)

        const allEmpData = allEmpDataRaw as Employee[] || []
        const jobs = jobsDataRaw as Job[] || []
        const weekShifts = weekShiftsData as Shift[] || []

        // 3. Reconstruir la lista exacta de empleados activos que usa el planificador (useVisibleEmployees)
        const ALLOWED_ROLES = ['manager', 'shift', 'cook', 'cocinero', 'cashier', 'cajero', 'prep', 'taquero', 'assistant', 'asst'];
        
        // Filtro por tienda primero
        const storeEmployees = allEmpData.filter((e: any) => {
            let empStoreIds: string[] = []
            if (Array.isArray(e.store_ids)) {
                empStoreIds = e.store_ids
            } else if (typeof e.store_ids === 'string') {
                if (e.store_ids.trim().startsWith('[')) {
                    try {
                        const parsed = JSON.parse(e.store_ids)
                        if (Array.isArray(parsed)) empStoreIds = parsed
                    } catch {
                        empStoreIds = [e.store_ids]
                    }
                } else {
                    empStoreIds = [e.store_ids]
                }
            }
            return empStoreIds.includes(storeGuid)
        })

        // Filtro de visibilidad
        const visibleEmployees = storeEmployees.filter(emp => {
            const hasShiftThisWeek = weekShifts.some(s => String(s.employee_id) === String(emp.id));
            if (hasShiftThisWeek) return true;
            if (emp.deleted) return false;

            const empJobGuids = new Set<string>();
            if (emp.job_references && Array.isArray(emp.job_references)) {
                emp.job_references.forEach((r: any) => empJobGuids.add(r.guid));
            }
            if (emp.wage_data && Array.isArray(emp.wage_data)) {
                emp.wage_data.forEach((w: any) => empJobGuids.add(w.job_guid));
            }

            let hasAllowedRole = false;
            for (const guid of Array.from(empJobGuids)) {
                const job = jobs.find(j => j.guid === guid || String(j.id) === guid);
                if (job && job.title) {
                    const titleLower = job.title.toLowerCase();
                    if (ALLOWED_ROLES.some(role => titleLower.includes(role))) {
                        hasAllowedRole = true;
                        break;
                    }
                }
            }
            return hasAllowedRole;
        });

        // Sort EXACTO como en el planificador
        const sortedVisibleEmployees = visibleEmployees.sort((a, b) => {
            const getTitle = (e: Employee) => {
                const ref = e.job_references?.[0];
                if (!ref) return '';
                const j = jobs.find(job => job.guid === ref.guid || String(job.id) === ref.guid);
                return j?.title || '';
            }
            const shiftsA = weekShifts.filter(s => s.employee_id == a.id);
            const shiftsB = weekShifts.filter(s => s.employee_id == b.id);
            const weightA = getRoleWeight(getTitle(a), shiftsA);
            const weightB = getRoleWeight(getTitle(b), shiftsB);

            if (weightA !== weightB) return weightA - weightB;
            return (a.chosen_name || a.first_name || '').localeCompare(b.chosen_name || b.first_name || '');
        });

        // CRITICO: En la pantalla de descansos, NO DEBEMOS DIBUJAR a los Managers Generales
        // pero queremos seguir dibujando al resto del roster idéntico al planificador.
        const rosterWithoutManagers = sortedVisibleEmployees.filter(emp => {
            const ref = emp.job_references?.[0];
            const j = jobs.find(job => job.guid === ref?.guid || String(job.id) === ref?.guid);
            const jobTitle = (j?.title || '').toLowerCase();
            const isGeneralManager = (jobTitle.includes('manager') || jobTitle.includes('gerente')) && 
                              !jobTitle.includes('assist') && 
                              !jobTitle.includes('asst') && 
                              !jobTitle.includes('shift');
            return !isGeneralManager;
        });

        setRosterEmployees(rosterWithoutManagers);

        // 4. Aislar los turnos estrictamente del día actual (currentDate)
        const todayRawShifts = weekShifts.filter(s => s.shift_date === dateStr);
        setTodayShifts(todayRawShifts);

        // 5. Fetch Toast Punches for reality check (Inicial)
        await pullToastPunches(false);

        // 6. Forecast y Cálculos de IA
        try {
            const projRes = await fetch('/api/projections/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ storeId: storeGuid, weekStart: dateStr })
            })
            const projData = await projRes.json()
            let hoursToDraw = []
            
            if (projData?.meta?.dailyDetails?.length > 0) {
                // Find the specific day's hours
                const dayMatch = projData.meta.dailyDetails.find((d: any) => d.date === dateStr)
                if (dayMatch && dayMatch.hourly_breakdown) {
                    hoursToDraw = dayMatch.hourly_breakdown
                }
            }
            
            setOperatingHours(hoursToDraw)
            
            if (todayRawShifts) {
                // Generar 100% en vivo con la IA (Ignora el sobre-escrito en DB y usa la proyección más nueva)
                const augmented = scheduleBreaksWithDemand(todayRawShifts, hoursToDraw);
                setSmartShifts(augmented as Shift[]);

                // Autoguardar silenciosamente si la IA detecta una mejor optimización que la existente
                const shiftsToUpdate = augmented.filter(s => {
                    const original = todayRawShifts.find(old => old.id === s.id);
                    return JSON.stringify(s.breaks_schedule) !== JSON.stringify(original?.breaks_schedule);
                });

                if (shiftsToUpdate.length > 0) {
                    for (const shift of shiftsToUpdate) {
                        try {
                            await supabase.from('shifts').update({ breaks_schedule: shift.breaks_schedule }).eq('id', shift.id);
                        } catch (err) {
                            console.error("Error auto-saving breaks:", err);
                        }
                    }
                }
            }
        } catch (e) {
            console.error("Error generating forecast:", e)
            if (todayRawShifts) {
                 const augmented = scheduleBreaksWithDemand(todayRawShifts, [])
                 setSmartShifts(augmented as Shift[])
            }
        }
        setCalculating(false)
    }

    useEffect(() => {
        loadDayData()
    }, [storeGuid, dateStr])

    const START_HOUR = 6 // 6 AM
    const END_HOUR = 28  // 4 AM Next Day
    const TOTAL_HOURS = END_HOUR - START_HOUR

    const getTimelinePosition = (isoTimeString: string) => {
        if (!isoTimeString) return 0
        const d = new Date(isoTimeString)
        let h = d.getHours()
        if (h < START_HOUR) h += 24
        const m = d.getMinutes()
        const totalMinutes = (h - START_HOUR) * 60 + m
        return Math.max(0, Math.min(100, (totalMinutes / (TOTAL_HOURS * 60)) * 100))
    }

    const getTimelineWidth = (startIso: string, endIso: string) => {
        if (!startIso) return 0
        const s = new Date(startIso)
        const e = endIso ? new Date(endIso) : new Date() 
        let sH = s.getHours()
        if (sH < START_HOUR) sH += 24
        let eH = e.getHours()
        if (eH < START_HOUR) eH += 24
        if (eH < sH) eH += 24 
        
        const durationMins = ((eH - sH) * 60) + e.getMinutes() - s.getMinutes()
        return Math.max(0, Math.min(100, (durationMins / (TOTAL_HOURS * 60)) * 100))
    }

    const formatHour = (h: number) => {
        const d = new Date()
        const hour = h >= 24 ? h - 24 : h
        d.setHours(hour, 0, 0, 0)
        return d.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true })
    }

    if (loading) return <div className="p-10 text-white flex items-center gap-2"><Loader2 className="animate-spin text-amber-500" /> Sincronizando con Planificador...</div>

    const activeEmployees = rosterEmployees.filter(emp => {
        const shift = smartShifts.find(s => String(s.employee_id) === String(emp.id))
        const empPunch = punches.find(p => p.employee_toast_guid === emp.toast_guid && p.clock_in)
        return shift || empPunch;
    });

    return (
        <div ref={containerRef} className={`font-sans selection:bg-indigo-500/30 transition-all ${isFullscreen ? 'fixed inset-0 z-[9999] bg-slate-50 h-[100vh] w-[100vw] overflow-y-auto' : 'min-h-screen bg-slate-50 text-slate-800'}`}>
            <header className="bg-white border-b border-slate-200 px-6 py-4 flex flex-wrap items-center justify-between shadow-sm sticky top-0 z-30 gap-4">
                <div className="flex items-center gap-6">
                    <Link href="/planificador" className="text-slate-500 hover:text-slate-800 transition-colors flex items-center gap-1 font-bold">
                        <ArrowLeft size={16} /> Volver
                    </Link>
                    <h1 className="text-xl font-black text-slate-800 flex items-center gap-2">
                        <Zap className="text-amber-500" />
                        AI Breaks & Lunches
                    </h1>
                    <select
                        value={selectedStoreId}
                        onChange={(e) => setSelectedStoreId(e.target.value)}
                        className="bg-slate-100 border border-slate-200 rounded-lg px-4 py-2 text-sm font-bold text-slate-800 focus:ring-2 focus:ring-amber-500 cursor-pointer min-w-[180px]"
                    >
                        {stores.map((s: any) => (
                            <option key={s.id} value={s.id}>{formatStoreName(s.name)}</option>
                        ))}
                    </select>
                    <input 
                        type="date"
                        value={dateStr}
                        onChange={(e) => {
                             const nd = new Date(e.target.value + 'T12:00:00')
                             setCurrentDate(nd)
                        }}
                        className="bg-slate-100 text-slate-800 rounded-lg px-3 py-2 text-sm font-bold border border-slate-200 focus:ring-2 focus:ring-amber-500"
                    />
                     {calculating && <div className="flex items-center gap-2 text-amber-500 text-xs font-bold animate-pulse"><Loader2 size={12} className="animate-spin" /> Procesando...</div>}
                </div>
                
                <div className="flex items-center gap-2 md:gap-3">
                    <button 
                        onClick={toggleFullscreen}
                        className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-2 rounded-lg font-bold text-sm transition-colors border border-slate-200"
                        title="Modo Tableta (Pantalla Completa)"
                    >
                        {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
                        <span className="hidden lg:inline">{isFullscreen ? 'Salir' : 'Tableta'}</span>
                    </button>
                    {showRealPunches && (
                        <button 
                            onClick={() => pullToastPunches(true)}
                            disabled={isRefreshingToast}
                            className="bg-cyan-50 hover:bg-cyan-100 text-cyan-700 border border-cyan-200 px-3 py-2 rounded-lg text-sm font-bold shadow-sm transition-all flex items-center gap-2 disabled:opacity-50"
                            title="Refrescar datos de Toast manualmente"
                        >
                            <RefreshCw size={16} className={isRefreshingToast ? 'animate-spin' : ''} />
                        </button>
                    )}
                    <button 
                        onClick={() => setShowRealPunches(!showRealPunches)}
                        className={`px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition-all flex items-center gap-2 border ${showRealPunches ? 'bg-cyan-600 text-white border-cyan-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 border-slate-200'}`}
                        title="Comparar vs el histórico real de Toast"
                    >
                        <History size={16} /> Auditoría (Real Toast)
                    </button>
                    {/* Botones de Anclar eliminados: el sistema ahora actualiza dinámicamente y salva en BD todo el tiempo. */}
                </div>
            </header>

            <main className={`p-4 md:p-6 mx-auto transition-all ${isFullscreen ? 'w-full max-w-full' : 'max-w-screen-2xl'}`}>
                <div className="mb-6">
                    <h2 className="text-2xl font-black text-slate-900">
                        {showRealPunches ? "Plan vs Realidad (Toast Punches)" : "Smart Timeline"}
                    </h2>
                    <p className="text-slate-500 text-sm mt-1">
                        {showRealPunches 
                            ? "Compara las horas donde la IA programó descansos (línea gruesa) versus a qué hora realmente oprimieron <Break> en el sistema (Líneas Cyan abajo)." 
                            : "Asignación automática basada en volumen de ventas respetando las leyes laborales de CA. (Fondo Brillante = Pico, Gris = Valle)."
                        }
                    </p>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl shadow-xl relative">
                    
                    {/* Operating Hours Background Chart (HEATMAP) */}
                    {(
                        <div className="absolute top-10 bottom-0 left-48 right-0 z-[5] flex pointer-events-none overflow-hidden rounded-br-xl">
                            {Array.from({ length: TOTAL_HOURS }).map((_, i) => {
                                const h = START_HOUR + i;
                                const hData = operatingHours?.find(o => o.hour === h || o.hour === (h >= 24 ? h - 24 : -1));
                                let sales = hData?.projected_sales || 0;
                                let maxSales = operatingHours?.length > 0 ? Math.max(...operatingHours.map(o => o.projected_sales)) : 0;
                                
                                // Fallback dinámico si no hay histórico: curva típica de afluencia (Rush de Mediodía y Tarde)
                                if (maxSales < 10) {
                                    const baseMockCurve: Record<number, number> = {
                                        6: 10, 7: 30, 8: 80, 9: 150, 
                                        10: 300, 11: 600, 12: 950, 13: 850, 14: 400, 15: 250, 16: 300, 
                                        17: 500, 18: 800, 19: 900, 20: 750, 21: 500, 22: 300, 23: 150, 
                                        24: 50, 25: 20, 26: 10, 27: 5
                                    };
                                    sales = baseMockCurve[h] || 0;
                                    maxSales = 950;
                                }

                                // Escala de opacidad basada en el volumen (0.0 a 1.0)
                                const intensity = sales / maxSales;
                                const isPeak = intensity >= 0.75; // Pico es cuando llega al 75% o más del volumen max

                                return (
                                    <div 
                                        key={i} 
                                        className="flex-1 h-full border-r border-slate-200/60 relative transition-colors duration-700"
                                        style={{ 
                                            // Si hay volumen, pintamos toda la columna ambar escalando la opacidad, si es casi cero se queda transparente
                                            backgroundColor: intensity > 0.05 ? `rgba(251, 191, 36, ${intensity * 0.45})` : 'transparent' 
                                        }}
                                    >
                                        {isPeak && (
                                            <div className="absolute top-0 w-full text-center text-amber-600 font-extrabold text-[9px] uppercase tracking-widest pt-2 drop-shadow-sm/50">
                                                PICO
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    )}

                    {/* Timeline Headers */}
                    <div className="flex border-b border-slate-200 bg-slate-50 relative sticky top-[180px] md:top-[65px] z-30 shadow-sm rounded-t-xl">
                        <div className="w-48 shrink-0 border-r border-slate-200 p-3 text-xs font-black text-slate-500 uppercase tracking-wider flex items-center bg-slate-50 rounded-tl-xl">
                            Empleado
                        </div>
                        <div className="flex-1 relative h-10 bg-slate-50 rounded-tr-xl">
                            {Array.from({ length: TOTAL_HOURS }).map((_, i) => (
                                <div 
                                    key={i} 
                                    className="absolute top-0 bottom-0 border-l border-slate-200 flex items-center px-1"
                                    style={{ left: `${(i / TOTAL_HOURS) * 100}%` }}
                                >
                                    <span className="text-[10px] text-slate-500 font-bold whitespace-nowrap">
                                        {formatHour(START_HOUR + i)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Employees Rows */}
                    <div className="divide-y divide-slate-100 relative z-10">
                        {activeEmployees.length === 0 ? (
                            <div className="p-8 text-center text-slate-500">No hay turnos planificados ni registros de Toast para este día.</div>
                        ) : activeEmployees.map((emp) => {
                            // Link con los turnos inteligentes (ya traen la data de breaks inyectada)
                            const shift = smartShifts.find(s => String(s.employee_id) === String(emp.id))
                                const isOff = !shift
                            
                            const empPunch = punches.find(p => p.employee_toast_guid === emp.toast_guid)
                            
                            return (
                                <div key={emp.id} className="flex hover:bg-slate-50 transition-colors group">
                                    <div className="w-48 shrink-0 border-r border-slate-100 p-3 flex flex-col justify-center bg-white backdrop-blur">
                                        <div className="text-sm font-bold text-slate-800 truncate">
                                            {emp.first_name} {emp.last_name}
                                        </div>
                                        {isOff ? (
                                            <div className="text-[10px] text-slate-400 font-bold mt-0.5">DÍA LIBRE (OFF)</div>
                                        ) : (
                                            <div className="text-[10px] text-slate-500 font-medium">
                                                {new Date(shift.start_time).toLocaleTimeString('en-US', {hour: '2-digit', minute:'2-digit'})} - {new Date(shift.end_time).toLocaleTimeString('en-US', {hour: '2-digit', minute:'2-digit'})}
                                            </div>
                                        )}
                                        {showRealPunches && empPunch && (
                                            <div className="text-[9px] text-cyan-600 mt-1 uppercase font-bold">
                                                Toast: {new Date(empPunch.clock_in).toLocaleTimeString('en-US', {hour: '2-digit', minute:'2-digit'})}
                                            </div>
                                        )}
                                    </div>
                                    
                                    <div className={`flex-1 relative py-2 ${showRealPunches ? 'min-h-[80px]' : 'min-h-[60px]'}`}>
                                        
                                        {!isOff && (
                                            <motion.div 
                                                initial={{ opacity: 0, scaleX: 0 }}
                                                animate={{ opacity: 1, scaleX: 1 }}
                                                style={{ 
                                                    left: `${getTimelinePosition(shift.start_time)}%`, 
                                                    width: `${getTimelineWidth(shift.start_time, shift.end_time)}%`,
                                                    transformOrigin: 'left'
                                                }}
                                                className={`absolute ${showRealPunches ? 'top-3' : 'top-1/2 -translate-y-1/2'} h-8 bg-indigo-100 border border-indigo-200 rounded-md flex items-center overflow-visible z-20 hover:z-40 shadow-sm`}
                                            >
                                                {/* Scheduled Breaks */}
                                                {shift.breaks_schedule?.map((b: any, idx: number) => {
                                                    const subLeft = getTimelinePosition(b.start_time)
                                                    const posLeft = getTimelinePosition(shift.start_time)
                                                    const wPct = getTimelineWidth(shift.start_time, shift.end_time)
                                                    let relativeLeft = ((subLeft - posLeft) / wPct) * 100
                                                    if(relativeLeft < 0) relativeLeft = 0;
                                                    const bWidth = getTimelineWidth(b.start_time, b.end_time)
                                                    let relativeWidth = (bWidth / wPct) * 100
                                                    
                                                    const isMeal = b.type === 'meal_30'
                                                    
                                                    return (
                                                        <div 
                                                            key={`plan-${idx}`}
                                                            className={`absolute top-0 bottom-0 rounded border group/break cursor-pointer transition-transform hover:scale-105 ${
                                                                isMeal 
                                                                    ? 'bg-amber-500 border-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.5)]' 
                                                                    : 'bg-emerald-500 border-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.5)]'
                                                            }`}
                                                            style={{ 
                                                                left: `${relativeLeft}%`, 
                                                                width: `${relativeWidth}%`,
                                                            }}
                                                        >
                                                            <div className="opacity-0 group-hover/break:opacity-100 absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[10px] font-bold px-2 py-1 rounded whitespace-nowrap shadow-lg pointer-events-none z-50">
                                                                {isMeal ? 'Almuerzo Planeado' : 'Descanso Planeado'}<br/>
                                                                {new Date(b.start_time).toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit'})}
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                            </motion.div>
                                        )}

                                        {showRealPunches && empPunch && (
                                            <motion.div 
                                                initial={{ opacity: 0 }}
                                                animate={{ opacity: 1 }}
                                                style={{ 
                                                    left: `${getTimelinePosition(empPunch.clock_in)}%`, 
                                                    width: `${getTimelineWidth(empPunch.clock_in, empPunch.clock_out)}%`,
                                                }}
                                                className="absolute bottom-3 h-4 bg-cyan-900/50 border-b-2 border-cyan-500/50 rounded-sm flex items-center overflow-visible z-10 hover:z-30"
                                            >
                                                {empPunch.breaks && Array.isArray(empPunch.breaks) && empPunch.breaks.map((rb: any, idx: number) => {
                                                    if (!rb.inDate) return null;
                                                    const rLeft = getTimelinePosition(rb.inDate)
                                                    const pLeft = getTimelinePosition(empPunch.clock_in)
                                                    const pWidth = getTimelineWidth(empPunch.clock_in, empPunch.clock_out)
                                                    
                                                    const relativeLeft = ((rLeft - pLeft) / pWidth) * 100
                                                    const currentOutDate = rb.outDate || new Date().toISOString()
                                                    const rWidth = getTimelineWidth(rb.inDate, currentOutDate)
                                                    const relativeWidth = (rWidth / pWidth) * 100

                                                    const durationMins = (new Date(currentOutDate).getTime() - new Date(rb.inDate).getTime()) / 60000;
                                                    const isRealMeal = durationMins > 20;

                                                    return (
                                                         <div 
                                                            key={`real-${idx}`}
                                                            className={`absolute top-0 bottom-0 rounded border border-cyan-400 group/rbreak cursor-help ${isRealMeal ? 'bg-cyan-500' : 'bg-teal-400'}`}
                                                            style={{ 
                                                                left: `${relativeLeft}%`, 
                                                                width: `${relativeWidth}%`,
                                                            }}
                                                        >
                                                            <div className="opacity-0 group-hover/rbreak:opacity-100 absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-800 text-cyan-300 text-[10px] font-bold px-2 py-1 rounded whitespace-nowrap shadow-lg pointer-events-none z-50">
                                                                {isRealMeal ? 'Lunch Real' : 'Break Real'}: {durationMins.toFixed(0)} min<br/>
                                                                {new Date(rb.inDate).toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit'})}
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                            </motion.div>
                                        )}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>

                <div className="mt-6 flex items-center justify-between">
                    <div className="bg-white border border-slate-200 p-4 rounded-xl flex items-center gap-6 shadow-sm">
                        <div className="flex items-center gap-2">
                            <div className="w-4 h-4 bg-amber-500 rounded"></div>
                            <span className="text-xs font-bold text-slate-700">Meal (30 min)</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-4 h-4 bg-emerald-500 rounded"></div>
                            <span className="text-xs font-bold text-slate-700">Rest (10 min)</span>
                        </div>
                        {showRealPunches && (
                            <div className="flex items-center gap-2 ml-4 pl-4 border-l border-slate-300">
                                <div className="w-4 h-4 bg-cyan-500 rounded"></div>
                                <span className="text-xs font-bold text-cyan-700">Break Real Toast</span>
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    )
}
