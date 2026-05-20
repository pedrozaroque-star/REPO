'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Calendar, Loader2, Zap, ArrowLeft, History, RefreshCw, Maximize, Minimize, ChevronLeft, ChevronRight } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { motion, AnimatePresence } from 'framer-motion'
import { format, addMonths, subMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek, isSameMonth, isSameDay } from 'date-fns'
import { es } from 'date-fns/locale'
import { getSupabaseClient } from '@/lib/supabase'
import { formatDateISO, formatStoreName, getMonday, addDays, getRoleWeight } from '@/app/planificador/lib/utils'
import { Shift, Employee, Job } from '@/app/planificador/lib/types'
import { useAuth } from '@/components/ProtectedRoute'

import { scheduleBreaksWithDemand } from '@/lib/breaks-engine'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

const START_HOUR = 6 // 6 AM
const END_HOUR = 30  // 6 AM Next Day (cubre turnos hasta 5:59 AM, fin de día laboral)
const TOTAL_HOURS = END_HOUR - START_HOUR

export default function DescansosPage() {
    const { user } = useAuth()
    const searchParams = useSearchParams()
    const { t } = useLanguage()

    const [mounted, setMounted] = useState(false)
    useEffect(() => setMounted(true), [])

    const containerRef = useRef<HTMLDivElement>(null)
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [calendarOpen, setCalendarOpen] = useState(false)
    const [calendarViewDate, setCalendarViewDate] = useState(new Date())


    const handleBreakDragEnd = async (e: any, info: any, shift: Shift, breakIdx: number) => {
        const b = shift.breaks_schedule[breakIdx];
        const timelineEl = document.getElementById('timeline-header');
        if (!timelineEl) return;
        const totalPx = timelineEl.getBoundingClientRect().width;
        // Total minutes = TOTAL_HOURS * 60, here TOTAL_HOURS is 24
        const pxPerMinute = totalPx / (24 * 60);
        
        const offsetMins = Math.round(info.offset.x / pxPerMinute);
        if (Math.abs(offsetMins) < 5) return;
        
        const origStart = new Date(b.start_time).getTime();
        const durMs = new Date(b.end_time).getTime() - origStart;
        const newStartMs = origStart + (offsetMins * 60000);
        const newEndMs = newStartMs + durMs;
        
        const shiftStart = new Date(shift.start_time).getTime();
        const shiftEnd = new Date(shift.end_time).getTime();
        
        if (newStartMs < shiftStart || newEndMs > shiftEnd) {
            alert('El descanso no puede quedar fuera del horario del turno.');
            return;
        }

        const isMeal = b.type === 'meal_30';
        let warningMsgs = [];
        
        if (isMeal) {
            if (newStartMs > shiftStart + (5 * 3600000)) {
                warningMsgs.push('Meal Penalty Riesgo: El Lunch inicia después de la 5ta hora (Ley de CA).');
            }
        }
        
        const rk = (((shift as any).job_title || shift.job_id || 'unknown') as string).toLowerCase().trim();
        for (const otherShift of smartShifts) {
            if (otherShift.id === shift.id) continue;
            const otherRk = (((otherShift as any).job_title || otherShift.job_id || 'unknown') as string).toLowerCase().trim();
            if (rk === otherRk) {
                for (const otherB of otherShift.breaks_schedule || []) {
                    const os = new Date(otherB.start_time).getTime();
                    const oe = new Date(otherB.end_time).getTime();
                    const overlapMs = Math.max(0, Math.min(newEndMs, oe) - Math.max(newStartMs, os));
                    if (overlapMs > 0) {
                        warningMsgs.push(`Superposición con ${(otherShift as any).employee_name || 'otro empleado'} que tiene el mismo rol.`);
                    }
                }
            }
        }

        if (warningMsgs.length > 0) {
            const proceed = window.confirm(`ADVERTENCIA:\n\n- ${warningMsgs.join('\n- ')}\n\n¿Estás seguro de que quieres moverlo aquí?`);
            if (!proceed) return;
        }
        
        const newBreaks = [...shift.breaks_schedule];
        newBreaks[breakIdx] = {
            ...b,
            start_time: new Date(newStartMs).toISOString(),
            end_time: new Date(newEndMs).toISOString(),
            is_manual: true
        };
        
        setSmartShifts(prev => prev.map(s => s.id === shift.id ? { ...s, breaks_schedule: newBreaks } : s));
        
        try {
            const { getSupabaseClient } = await import('@/lib/supabase');
            const supabase = await getSupabaseClient();
            await supabase.from('shifts').update({ breaks_schedule: newBreaks }).eq('id', shift.id);
        } catch (err) {
            console.error('Failed to save manual break', err);
        }
    };

    useEffect(() => {
        const onFullscreenChange = () => {
            const doc = document as any;
            setIsFullscreen(!!(doc.fullscreenElement || doc.webkitFullscreenElement))
        }
        document.addEventListener('fullscreenchange', onFullscreenChange)
        document.addEventListener('webkitfullscreenchange', onFullscreenChange)
        return () => {
            document.removeEventListener('fullscreenchange', onFullscreenChange)
            document.removeEventListener('webkitfullscreenchange', onFullscreenChange)
        }
    }, [])

    const toggleFullscreen = () => {
        const doc = document as any;
        const elem = containerRef.current as any;
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

        if (!isFullscreen) {
            if (isIOS) {
                setIsFullscreen(true); // En iOS/iPadOS forzamos CSS (su API de fullscreen suele fallar o limitar a videos)
            } else if (elem?.requestFullscreen) {
                elem.requestFullscreen().catch(() => setIsFullscreen(true));
            } else if (elem?.webkitRequestFullscreen) {
                elem.webkitRequestFullscreen();
                setTimeout(() => { if (!doc.webkitFullscreenElement) setIsFullscreen(true) }, 200);
            } else {
                setIsFullscreen(true);
            }
        } else {
            if (isIOS) {
                setIsFullscreen(false);
            } else if (doc.exitFullscreen && doc.fullscreenElement) {
                doc.exitFullscreen().catch(() => setIsFullscreen(false));
            } else if (doc.webkitExitFullscreen && doc.webkitFullscreenElement) {
                doc.webkitExitFullscreen();
                setTimeout(() => { if (!doc.webkitFullscreenElement) setIsFullscreen(false) }, 200);
            } else {
                setIsFullscreen(false);
            }
        }
    }

    const [loading, setLoading] = useState(true)
    const [calculating, setCalculating] = useState(false)
    const [stores, setStores] = useState<any[]>([])
    const [selectedStoreId, setSelectedStoreId] = useState<string>('')
    const [currentDate, setCurrentDate] = useState<Date>(() => {
        const paramDate = searchParams?.get('date')
        if (paramDate) {
            // Reconstruit YYYY-MM-DD avoiding TZ shift by appending noon
            const d = new Date(paramDate + 'T12:00:00')
            if (!isNaN(d.getTime())) return d
        }
        const now = new Date()
        if (now.getHours() < 6) {
            now.setDate(now.getDate() - 1);
        }
        return now
    })

    // Roster de la semana (Idéntico a Planificador)
    const [rosterEmployees, setRosterEmployees] = useState<Employee[]>([])

    // Turnos específicos del día actual para renderizar
    const [todayShifts, setTodayShifts] = useState<Shift[]>([])
    const [punches, setPunches] = useState<any[]>([])
    const [operatingHours, setOperatingHours] = useState<any[]>([])
    const [smartShifts, setSmartShifts] = useState<Shift[]>([])
    const [allJobs, setAllJobs] = useState<Job[]>([])

    const [showRealPunches, setShowRealPunches] = useState(true)
    const [isRefreshingToast, setIsRefreshingToast] = useState(false)

    const [absentEmpIds, setAbsentEmpIds] = useState<Set<string>>(new Set())
    const [absentModalEmp, setAbsentModalEmp] = useState<Employee | null>(null)
    const [aiStatus, setAiStatus] = useState<{ message: string, type: 'info' | 'success' | 'alert' } | null>(null)
    const lastDataRef = useRef<{ shifts: Shift[], hours: any[], employees: Employee[], jobs: Job[] }>({ shifts: [], hours: [], employees: [], jobs: [] })

    const triggerAiRecalculation = async (absentSet: Set<string>, dataOverride?: any, isManualAction: boolean = false, forceRecalculate: boolean = false) => {
        setCalculating(true);
        await new Promise(r => setTimeout(r, 50));

        const { shifts, hours, employees, jobs } = dataOverride || lastDataRef.current;
        if (!shifts || shifts.length === 0) {
            setCalculating(false);
            return;
        }

        const presentShifts = shifts.filter((s: Shift) => {
            if (s.employee_id === null) return true;
            return !absentSet.has(String(s.employee_id));
        });

        const shiftsForAi = presentShifts.map((s: Shift) => {
            const emp = employees.find((e: Employee) => e.id === s.employee_id || e.toast_guid === (s as any).employee_toast_guid);
            let extTitle = '';
            if (emp && emp.job_references && emp.job_references.length > 0) {
                const jobRef = emp.job_references[0];
                // Deep Fix: Usar el title embebido si existe, en vez de depender ciegamente del JOIN
                if (jobRef.title) extTitle = jobRef.title;
                else {
                    const job = jobs.find((j: Job) => j.guid === jobRef.guid || String(j.id) === jobRef.guid);
                    if (job) extTitle = job.title;
                }
            }
            if (!extTitle) {
                const shiftJob = jobs.find((j: Job) => j.guid === s.job_id || String(j.id) === String(s.job_id));
                if (shiftJob) extTitle = shiftJob.title;
            }

            // Failsafe estructural para garantizar que breaks-engine identifique el rol
            if (!extTitle && emp) {
                extTitle = 'cook'; // Fallback genérico para BOH en vez de tirar un UUID que rompe el wavePenalty
            }

            const titleLowerCase = extTitle.toLowerCase();
            const employeeName = emp ? `${emp.first_name} ${emp.last_name}`.toLowerCase() : '';
            const isLeader = titleLowerCase.includes('manager') || titleLowerCase.includes('asst') || titleLowerCase.includes('shift') || titleLowerCase.includes('lead') || titleLowerCase.includes('asistente') || titleLowerCase.includes('assistant') || titleLowerCase.includes('encargado') || employeeName.includes('alberto romero') || employeeName.includes('manager');
            return { ...s, is_leader: isLeader, job_title: extTitle, employee_name: employeeName };
        });

        // 🧠 BYPASS DE OPTIMIZACIÓN: Si los turnos ya tienen breaks calculados, los reusamos.
        if (!isManualAction && !forceRecalculate) {
            // Verificamos si AL MENOS UN TURNO ya tiene descansos asignados en BD.
            // Si es así, significa que la IA ya procesó el día entero previamente.
            // (Si hay turnos nuevos, el mánager deberá presionar RECALCULAR manualmente).
            const alreadyCalculated = shiftsForAi.some((s: any) => s.breaks_schedule && s.breaks_schedule.length > 0);
            
            if (alreadyCalculated) {
                console.log("⏭️ Bypass IA: Turnos ya calculados previamente. Cargando caché de BD.");
                setSmartShifts(shiftsForAi);
                setCalculating(false);
                return;
            }
        }

        try {
            const augmented = scheduleBreaksWithDemand(shiftsForAi, hours);
            setSmartShifts(augmented as Shift[]);

            const supabase = await getSupabaseClient()
            const shiftsToUpdate = augmented.filter((s: any) => {
                const original = shifts.find((old: Shift) => old.id === s.id);
                const stringifyBreak = (b: any) => `${b.type}_${new Date(b.start_time).getTime()}_${new Date(b.end_time).getTime()}`;
                const newStr = s.breaks_schedule.map(stringifyBreak).sort().join('|');
                const oldStr = (original?.breaks_schedule || []).map(stringifyBreak).sort().join('|');
                return newStr !== oldStr;
            });

            if (shiftsToUpdate.length > 0) {
                await Promise.all(shiftsToUpdate.map(async shift => {
                    if (!shift.id) return;
                    const { error } = await supabase.from('shifts').update({ breaks_schedule: shift.breaks_schedule }).eq('id', shift.id);
                    if (error) console.warn("Supabase DB Warning:", error.message || JSON.stringify(error));
                }));

                // 🧠 DEEP FIX: Diferenciar el motivo del mensaje
                if (isManualAction) {
                    setAiStatus({ message: 'Asistencia actualizada: Descansos re-balanceados para cubrir huecos operativos', type: 'success' });
                } else {
                    // Si fue automático (al cargar), el mensaje debe ser sobre optimización, no asistencia
                    setAiStatus({ message: 'Inteligencia Artificial: Horario optimizado para maximizar cobertura en picos de venta', type: 'success' });
                }
            } else if (isManualAction) {
                setAiStatus({ message: 'Asistencia registrada: No se requirieron cambios en los descansos de los demás', type: 'info' });
            }

            // 🚩 PERSISTENCIA PROFUNDA: Guardar ausentes en DB en Paralelo
            if (isManualAction && shifts) {
                const validShifts = shifts.filter((s: Shift) => s.employee_id !== null && s.id != null);
                await Promise.all(validShifts.map(async (s: Shift) => {
                    const id = String(s.employee_id);
                    if (absentSet.has(id)) {
                        await supabase.from('shifts').update({ is_callback: true }).eq('id', s.id);
                    } else if (s.is_callback === true) {
                        await supabase.from('shifts').update({ is_callback: false }).eq('id', s.id);
                    }
                }));
            }
        } catch (e) {
            console.error(e);
        }
        setCalculating(false);
    }

    useEffect(() => {
        async function loadBasics() {
            setLoading(true)
            const supabase = await getSupabaseClient()

            // RBAC
            let userRole = 'staff'
            let userStoreId: any = null

            if (user) {
                const { data: uData } = await supabase.from('users').select('role, store_id').eq('id', user.id).single()
                if (uData) {
                    userRole = uData.role || 'staff'
                    userStoreId = uData.store_id
                }
            }

            let storeQuery = supabase.from('stores').select('*').order('name')
            if (userRole !== 'admin' && userStoreId) {
                storeQuery = storeQuery.eq('id', userStoreId)
            } else if (userRole !== 'admin' && !userStoreId) {
                if (userRole === 'manager' || userRole === 'gerente') {
                    alert('No tienes tienda asignada (Descansos). Contacta a soporte.')
                    storeQuery = storeQuery.eq('id', -1)
                }
            }

            const { data: storesData } = await storeQuery

            if (storesData) {
                setStores(storesData)
                if (storesData.length > 0) {
                    const storeParam = searchParams?.get('store') || localStorage.getItem('planner_store')
                    const matchedStore = storeParam ? storesData.find((s: any) => String(s.id) === storeParam || String(s.external_id) === storeParam) : null

                    if (storesData.length === 1) {
                        setSelectedStoreId(String(storesData[0].id))
                    } else if (matchedStore) {
                        setSelectedStoreId(String(matchedStore.id))
                    } else {
                        setSelectedStoreId(String(storesData[0].id))
                    }
                }
            }
            setLoading(false)
        }
        if (user) loadBasics()
    }, [user])

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

    // --- RELOJ Y LÍNEA DE HORA ACTUAL ---
    const [currentTime, setCurrentTime] = useState<Date>(new Date())
    const lastBusinessDateRef = useRef<string>('')

    useEffect(() => {
        setCurrentTime(new Date()); // Init just in case
        const timer = setInterval(() => setCurrentTime(new Date()), 30000) // Update every 30s
        return () => clearInterval(timer)
    }, [])

    // Escaner 6:00 AM Auto-Rollover
    useEffect(() => {
        const now = currentTime;
        const bDate = new Date(now);
        if (now.getHours() < START_HOUR) {
            bDate.setDate(bDate.getDate() - 1);
        }
        const currentBDateStr = formatDateISO(bDate);

        if (lastBusinessDateRef.current && lastBusinessDateRef.current !== currentBDateStr) {
            // El reloj acaba de cruzar las 6:00 AM (Cambio de Día de Negocio)
            // Avanzamos o retrocedemos la página al día real que inició automáticamente
            setCurrentDate(new Date(currentBDateStr + 'T12:00:00'));
        }
        lastBusinessDateRef.current = currentBDateStr;
    }, [currentTime])

    const isTodayLineVisible = useMemo(() => {
        if (!mounted) return false
        const now = currentTime
        let nowBusinessDate = new Date(now)
        if (now.getHours() < START_HOUR) {
            nowBusinessDate.setDate(nowBusinessDate.getDate() - 1)
        }
        return formatDateISO(currentDate) === formatDateISO(nowBusinessDate)
    }, [currentDate, currentTime, mounted])

    const currentTimeLeft = useMemo(() => {
        const now = currentTime
        let shiftHour = now.getHours() + now.getMinutes() / 60
        if (shiftHour < START_HOUR) shiftHour += 24
        return Math.max(0, Math.min(100, ((shiftHour - START_HOUR) / 24) * 100))
    }, [currentTime])

    const loadDayData = async () => {
        if (!storeGuid) return;
        setCalculating(true) // Mostramos spinner de "Procesando" brevemente

        // RESET ausentes al cambiar de día/tienda
        const freshAbsentSet = new Set<string>();
        setAbsentEmpIds(freshAbsentSet);
        setAiStatus(null);

        const supabase = await getSupabaseClient()

        // 1. Fechas de toda la semana para emular el Roster del Planificador
        const weekStartM = getMonday(currentDate)
        const startStr = formatDateISO(weekStartM)
        const endStr = formatDateISO(addDays(weekStartM, 6))

        // 2a. CARGA EXTREMADAMENTE RÁPIDA: Supabase DB (Milisegundos)
        const [empRes, jobsRes, weekShiftsRes] = await Promise.all([
            supabase.from('toast_employees').select('*').contains('store_ids', JSON.stringify([storeGuid])),
            supabase.from('toast_jobs').select('*'),
            supabase.from('shifts')
                .select('*')
                .eq('store_id', storeGuid)
                .gte('shift_date', startStr)
                .lte('shift_date', endStr)
        ]);

        const allEmpData = empRes.data as Employee[] || []
        const jobs = jobsRes.data as Job[] || []
        setAllJobs(jobs)
        const weekShifts = weekShiftsRes.data as Shift[] || []

        // 3. Reconstruir la lista exacta de empleados activos que usa el planificador
        const ALLOWED_ROLES = ['manager', 'shift', 'cook', 'cocinero', 'cashier', 'cajero', 'prep', 'taquero', 'assistant', 'asst'];

        const storeEmployees = allEmpData.filter((e: any) => {
            let empStoreIds: string[] = []
            if (Array.isArray(e.store_ids)) {
                empStoreIds = e.store_ids
            } else if (typeof e.store_ids === 'string') {
                try {
                    const parsed = JSON.parse(e.store_ids)
                    if (Array.isArray(parsed)) empStoreIds = parsed
                } catch {
                    empStoreIds = [e.store_ids]
                }
            }
            return empStoreIds.includes(storeGuid)
        })

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

        const todayRawShifts = weekShifts.filter(s => s.shift_date === dateStr);
        setTodayShifts(todayRawShifts);

        const dbAbsentees = todayRawShifts
            .filter(s => s.is_callback === true && s.employee_id !== null)
            .map(s => String(s.employee_id));

        if (dbAbsentees.length > 0) {
            setAbsentEmpIds(new Set(dbAbsentees));
        }

        const hydratedAbsentSet = new Set(dbAbsentees);
        
        try {
            // --- 🧠 DEEP ARCHITECTURE: RENDERIZADO PROGRESIVO ---
            const alreadyCalculated = todayRawShifts.some((s: any) => s.breaks_schedule && s.breaks_schedule.length > 0);
            
            // Definimos la tarea lenta (Toast API y Projections) que no bloquea la interfaz si hay Bypass
            const fetchSlowData = async () => {
                const [_, projData] = await Promise.all([
                    pullToastPunches(false),
                    fetch('/api/projections/generate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ storeId: storeGuid, weekStart: dateStr, days: 1 })
                    }).then(r => r.json()).catch(e => { console.error(e); return null; })
                ]);

                let hoursToDraw = []
                if (projData?.meta?.dailyDetails?.length > 0) {
                    const dayMatch = projData.meta.dailyDetails.find((d: any) => d.date === dateStr)
                    if (dayMatch && dayMatch.hourly_breakdown) {
                        hoursToDraw = dayMatch.hourly_breakdown
                    }
                }
                setOperatingHours(hoursToDraw);
                return hoursToDraw;
            };

            if (alreadyCalculated) {
                // RUTA RÁPIDA (Bypass): Quitamos el cuadro de carga instantáneamente.
                const data = { shifts: todayRawShifts, hours: [], employees: allEmpData as Employee[], jobs: jobs };
                lastDataRef.current = data;
                await triggerAiRecalculation(hydratedAbsentSet, data, false);
                setCalculating(false); // ¡PANTALLA LIBERADA EN ~150ms!
                
                // Cargamos el Heatmap y Toast en segundo plano sin bloquear al usuario
                fetchSlowData()
                    .then((loadedHours) => {
                        if (lastDataRef.current) lastDataRef.current.hours = loadedHours; // Por si oprime "Recalcular" después
                    })
                    .catch(e => console.error("Error en carga de fondo:", e));
            } else {
                // RUTA LENTA (Primera vez): Requerimos las proyecciones para que la IA decida
                const loadedHours = await fetchSlowData();
                const data = { shifts: todayRawShifts, hours: loadedHours, employees: allEmpData as Employee[], jobs: jobs };
                lastDataRef.current = data;
                await triggerAiRecalculation(hydratedAbsentSet, data, false);
            }
        } catch (error) {
            console.error("Error en la cadena principal de loadDayData:", error);
        } finally {
            setCalculating(false); // Garantía absoluta de liberar la pantalla
        }
    }

    // --- REALTIME MONITORING (Auditoría Automática) ---
    useEffect(() => {
        if (!storeGuid || !dateStr) return

        let channel: any = null

        let rebalanceTimer: any = null;

        const setupRealtime = async () => {
            const supabase = await getSupabaseClient()
            channel = supabase
                .channel('rebalance-monitor')
                .on('postgres_changes', {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'shifts',
                    filter: `store_id=eq.${storeGuid}`
                }, (payload: any) => {
                    if (payload.new.shift_date === dateStr) {
                        // DEBOUNCE: Si vienen 10 cambios seguidos (el cron), solo re-cargamos una vez al final
                        if (rebalanceTimer) clearTimeout(rebalanceTimer);
                        rebalanceTimer = setTimeout(() => {
                            setAiStatus({ message: 'Auditoría Toast: Descansos re-balanceados por ponchada irregular', type: 'info' });
                            loadDayData();
                        }, 2000);
                    }
                })
                .subscribe()
        }

        setupRealtime()

        return () => {
            if (channel) {
                // We use a separate async cleanup if needed, but simple channel removal works
                const supabaseAsync = getSupabaseClient()
                supabaseAsync.then(s => s.removeChannel(channel))
            }
        }
    }, [storeGuid, dateStr])

    useEffect(() => {
        loadDayData()
    }, [storeGuid, dateStr])

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

    // if (loading) return <div className="p-10 text-white flex items-center gap-2"><Loader2 className="animate-spin text-amber-500" /> Sincronizando con Planificador...</div>

    const activeEmployees = rosterEmployees.filter(emp => {
        const shiftBase = todayShifts.find(s => String(s.employee_id) === String(emp.id))
        const shiftAi = smartShifts.find(s => String(s.employee_id) === String(emp.id))
        const empPunch = punches.find(p => p.employee_toast_guid === emp.toast_guid && p.clock_in)
        return shiftBase || shiftAi || empPunch;
    });

    return (
        <div ref={containerRef} className={`font-sans selection:bg-indigo-500/30 transition-all ${isFullscreen ? 'fixed inset-0 z-[9999] bg-slate-50 h-[100vh] w-[100vw] overflow-y-auto' : 'min-h-screen bg-slate-50 text-slate-800'}`}>
            {/* FULL SCREEN PROCESSING MODAL */}
            <AnimatePresence>
                {(loading || calculating) && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[99999] flex flex-col items-center justify-center bg-slate-900/60 backdrop-blur-md"
                    >
                        <motion.div
                            initial={{ scale: 0.9, y: 20 }}
                            animate={{ scale: 1, y: 0 }}
                            exit={{ scale: 0.9, y: 20 }}
                            className="bg-white p-8 rounded-2xl shadow-2xl flex flex-col items-center max-w-sm w-[90%] border-2 border-amber-400"
                        >
                            <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mb-6 shadow-inner ring-4 ring-amber-100">
                                <Zap className="text-amber-500 animate-bounce" size={32} />
                            </div>
                            <h2 className="text-xl font-black text-slate-800 mb-2 uppercase tracking-tight text-center">
                                {loading ? t('descansos.loading') : 'AI Processing'}
                            </h2>
                            <p className="text-sm font-medium text-slate-500 text-center mb-6 px-4">
                                {loading
                                    ? 'Loading shifts and configurations from the master Planner.'
                                    : 'Calculating coverage and optimizing breaks in real time.'}
                            </p>
                            <Loader2 className="animate-spin text-amber-500" size={36} />
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <header className={`bg-white border-b border-slate-200 px-6 py-4 flex flex-wrap items-center justify-between shadow-sm sticky ${isFullscreen ? 'top-0 z-[100]' : 'top-16 z-50'} gap-4 transition-all duration-300`}>
                <div className="flex items-center gap-6">
                    <h1 className={`font-black text-slate-800 flex items-center gap-2 ${isFullscreen ? 'text-xl' : 'text-xl md:ml-12'} transition-all`}>
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

                    <div className="flex items-center bg-slate-100 border border-slate-200 rounded-lg p-0.5 shadow-inner">
                        <button
                            onClick={() => {
                                const nd = new Date(currentDate)
                                nd.setDate(nd.getDate() - 1)
                                setCurrentDate(nd)
                            }}
                            className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-200 rounded-md transition-colors"
                        >
                            <ChevronLeft size={18} />
                        </button>

                        <div className="relative">
                            <div 
                                className={`flex items-center justify-center px-4 min-w-[140px] group cursor-pointer hover:bg-slate-200/50 rounded-md transition-colors py-1.5 ${calendarOpen ? 'bg-slate-200/50' : ''}`}
                                onClick={() => {
                                    setCalendarViewDate(currentDate)
                                    setCalendarOpen(!calendarOpen)
                                }}
                            >
                                <Calendar size={14} className={`mr-2 transition-colors ${calendarOpen ? 'text-amber-600' : 'text-slate-400 group-hover:text-amber-500'}`} />
                                <span className={`text-sm font-black uppercase tracking-tight ${calendarOpen ? 'text-amber-700' : 'text-slate-800'}`}>
                                    {format(currentDate, "EEE, d MMM", { locale: es }).replace('.', '')}
                                </span>
                            </div>

                            {/* CUSTOM PREMIUM CALENDAR DROPDOWN */}
                            <AnimatePresence>
                                {calendarOpen && (
                                    <>
                                        <div className="fixed inset-0 z-40" onClick={() => setCalendarOpen(false)}></div>
                                        <motion.div 
                                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                            animate={{ opacity: 1, y: 0, scale: 1 }}
                                            exit={{ opacity: 0, y: 10, scale: 0.95 }}
                                            transition={{ duration: 0.15 }}
                                            className="absolute top-full mt-2 left-1/2 -translate-x-1/2 w-[280px] bg-white border border-slate-200 rounded-2xl shadow-xl z-50 p-4 font-sans select-none"
                                        >
                                            <div className="flex items-center justify-between mb-4">
                                                <button onClick={() => setCalendarViewDate(subMonths(calendarViewDate, 1))} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors">
                                                    <ChevronLeft size={16} />
                                                </button>
                                                <span className="text-sm font-black text-slate-800 capitalize">
                                                    {format(calendarViewDate, 'MMMM yyyy', { locale: es })}
                                                </span>
                                                <button onClick={() => setCalendarViewDate(addMonths(calendarViewDate, 1))} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors">
                                                    <ChevronRight size={16} />
                                                </button>
                                            </div>
                                            
                                            <div className="grid grid-cols-7 gap-1 mb-2">
                                                {['L','M','X','J','V','S','D'].map(day => (
                                                    <div key={day} className="text-center text-[10px] font-black text-slate-400">{day}</div>
                                                ))}
                                            </div>

                                            <div className="grid grid-cols-7 gap-1">
                                                {(() => {
                                                    const monthStart = startOfMonth(calendarViewDate)
                                                    const monthEnd = endOfMonth(monthStart)
                                                    const startDate = startOfWeek(monthStart, { weekStartsOn: 1 })
                                                    const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 })
                                                    
                                                    const days = []
                                                    let day = startDate
                                                    
                                                    while (day <= endDate) {
                                                        const isSelected = isSameDay(day, currentDate)
                                                        const isCurrentMonth = isSameMonth(day, monthStart)
                                                        const isToday = isSameDay(day, new Date())
                                                        const cloneDay = day

                                                        days.push(
                                                            <button
                                                                key={day.toString()}
                                                                onClick={() => {
                                                                    const nd = new Date(cloneDay)
                                                                    nd.setHours(12,0,0,0)
                                                                    setCurrentDate(nd)
                                                                    setCalendarOpen(false)
                                                                }}
                                                                className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold transition-all mx-auto
                                                                    ${!isCurrentMonth ? 'text-slate-300 pointer-events-none opacity-40' : ''}
                                                                    ${isSelected ? 'bg-amber-500 text-white shadow-md shadow-amber-500/30' : ''}
                                                                    ${!isSelected && isToday ? 'text-amber-600 bg-amber-50' : ''}
                                                                    ${!isSelected && !isToday && isCurrentMonth ? 'text-slate-700 hover:bg-slate-100' : ''}
                                                                `}
                                                            >
                                                                {format(day, 'd')}
                                                            </button>
                                                        )
                                                        day = addDays(day, 1)
                                                    }
                                                    return days
                                                })()}
                                            </div>
                                            
                                            <div className="pt-3 mt-3 border-t border-slate-100 flex justify-center">
                                                <button 
                                                    onClick={() => {
                                                        const m = new Date()
                                                        m.setHours(12,0,0,0)
                                                        setCurrentDate(m)
                                                        setCalendarOpen(false)
                                                    }}
                                                    className="text-xs font-bold text-amber-600 hover:text-amber-700 hover:bg-amber-50 px-3 py-1.5 rounded-full transition-colors"
                                                >
                                                    Ir a Hoy
                                                </button>
                                            </div>
                                        </motion.div>
                                    </>
                                )}
                            </AnimatePresence>
                        </div>

                        <button
                            onClick={() => {
                                const nd = new Date(currentDate)
                                nd.setDate(nd.getDate() + 1)
                                setCurrentDate(nd)
                            }}
                            className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-200 rounded-md transition-colors"
                        >
                            <ChevronRight size={18} />
                        </button>
                    </div>
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
                            className="bg-cyan-50 hover:bg-cyan-100 text-cyan-700 border border-cyan-200 px-4 py-2.5 rounded-xl text-base font-black shadow-sm transition-all flex items-center justify-center disabled:opacity-50 min-w-[52px]"
                            title="Recargar datos de Toast manualmente"
                        >
                            <RefreshCw size={20} className={isRefreshingToast ? 'animate-spin' : ''} />
                        </button>
                    )}
                    <button
                        onClick={() => setShowRealPunches(!showRealPunches)}
                        className={`px-6 py-2.5 rounded-xl text-base tracking-wider font-black shadow-md transition-all flex items-center gap-2 border ${showRealPunches ? 'bg-cyan-600 text-white border-cyan-700 hover:bg-cyan-700 ring-2 ring-cyan-600/30 ring-offset-1' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 border-slate-200'}`}
                        title="Comparar vs el histórico real de Toast"
                    >
                        <History size={20} /> AUDITAR
                    </button>
                </div>
            </header>

            <main className={`p-4 md:p-6 mx-auto transition-all ${isFullscreen ? 'w-full max-w-full' : 'max-w-screen-2xl'}`}>
                {!isFullscreen && (
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
                )}

                <div className="bg-white border border-slate-200 rounded-xl shadow-xl relative">

                    {/* Operating Hours Background Chart (HEATMAP) */}
                    {(
                        <div className="absolute top-10 bottom-0 left-64 right-0 z-[5] pointer-events-none overflow-hidden rounded-br-xl">
                            {Array.from({ length: TOTAL_HOURS }).map((_, i) => {
                                const h = START_HOUR + i;
                                const hData = operatingHours?.find(o => o.hour === h || o.hour === (h >= 24 ? h - 24 : -1));
                                let sales = hData?.projected_sales || 0;

                                // ── NORMALIZACIÓN PER-TURNO ──
                                // Cada hora se normaliza contra el MAX de su PROPIA ventana (AM o PM),
                                // NO contra el max global del día. Así el rush AM (ej: 12pm=$600)
                                // se ve tan intenso como el rush PM (ej: 7pm=$900) visualmente.
                                // AM window: 6-16, PM window: 17-28
                                const isAmHour = h >= 6 && h < 17;
                                let maxSales = 0;

                                if (operatingHours?.length > 0) {
                                    const windowStart = isAmHour ? 6 : 17;
                                    const windowEnd = isAmHour ? 17 : 29;
                                    for (const o of operatingHours) {
                                        const oH = Number(o.hour);
                                        if (oH >= windowStart && oH < windowEnd && o.projected_sales > maxSales) {
                                            maxSales = o.projected_sales;
                                        }
                                    }
                                    // Fallback: si la ventana no tiene datos, usar max global
                                    if (maxSales < 10) {
                                        maxSales = Math.max(...operatingHours.map(o => o.projected_sales));
                                    }
                                }

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
                                const intensity = maxSales > 0 ? sales / maxSales : 0;
                                let bgColor = '';
                                let peakLabel = '';
                                let labelColor = '';

                                // Colores alineados con el engine:
                                // Engine: MEAL block >= 0.80, REST block >= 0.65
                                // Visual: solo las horas que el engine BLOQUEA se ven calientes
                                if (intensity >= 0.95) {
                                    bgColor = `rgba(185, 28, 28, 0.40)`;
                                    peakLabel = 'MAX';
                                    labelColor = 'text-red-800';
                                } else if (intensity >= 0.85) {
                                    bgColor = `rgba(220, 38, 38, 0.30)`;
                                } else if (intensity >= 0.80) {
                                    bgColor = `rgba(239, 68, 68, 0.22)`;
                                } else if (intensity >= 0.70) {
                                    bgColor = `rgba(249, 115, 22, 0.16)`;
                                } else if (intensity >= 0.60) {
                                    bgColor = `rgba(251, 146, 60, 0.10)`;
                                } else if (intensity >= 0.45) {
                                    bgColor = `rgba(253, 230, 138, 0.07)`;
                                } else if (intensity > 0.25) {
                                    bgColor = `rgba(254, 243, 199, 0.05)`;
                                }

                                return (
                                    <div
                                        key={i}
                                        className="absolute top-0 bottom-0 border-l border-slate-200/60 transition-colors duration-700"
                                        style={{
                                            left: `${(i / TOTAL_HOURS) * 100}%`,
                                            width: `${(1 / TOTAL_HOURS) * 100}%`,
                                            backgroundColor: bgColor
                                        }}
                                    >
                                        {peakLabel && (
                                            <div className={`absolute top-0 w-full text-center font-extrabold text-[10px] uppercase tracking-widest pt-2.5 drop-shadow-sm/50 ${labelColor}`}>
                                                {peakLabel}
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    )}

                    {/* Timeline Headers */}
                    <div className={`flex border-b border-slate-200 bg-slate-50 relative sticky ${isFullscreen ? 'top-[210px] md:top-[80px]' : 'top-[270px] md:top-[144px]'} z-40 shadow-sm rounded-t-xl transition-all duration-300`}>
                        <div className="w-64 shrink-0 border-r border-slate-200 p-3 text-sm font-black text-slate-500 uppercase tracking-wider flex items-center bg-slate-50 rounded-tl-xl">
                            Employee
                        </div>
                        <div className="flex-1 relative h-10 bg-slate-50 rounded-tr-xl">
                            {Array.from({ length: TOTAL_HOURS }).map((_, i) => (
                                <div
                                    key={i}
                                    className="absolute top-0 bottom-0 border-l border-slate-200 flex items-center px-1"
                                    style={{ left: `${(i / TOTAL_HOURS) * 100}%` }}
                                >
                                    <span className="text-[13px] text-slate-500 font-bold whitespace-nowrap drop-shadow-sm">
                                        {formatHour(START_HOUR + i)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Employees Rows */}
                    <div className="divide-y divide-slate-100 relative z-10">
                        {activeEmployees.length === 0 ? (
                            <div className="p-8 text-center text-slate-500">No scheduled shifts or Toast records for this day.</div>
                        ) : activeEmployees.map((emp) => {
                            // Link con los turnos inteligentes (ya traen la data de breaks inyectada)
                            const shift = smartShifts.find(s => String(s.employee_id) === String(emp.id))
                            const isOff = !shift

                            const empPunch = punches.find(p => p.employee_toast_guid === emp.toast_guid)

                            return (
                                <div key={emp.id} className="flex hover:bg-slate-50 transition-colors group relative z-10 focus-within:z-50 hover:z-40">
                                    <div className="w-64 shrink-0 border-r border-slate-100 p-3 flex flex-col justify-center bg-white backdrop-blur">
                                        <div
                                            className={`text-lg leading-tight font-black truncate cursor-pointer transition-colors ${absentEmpIds.has(String(emp.id)) ? 'text-red-500 line-through opacity-80' : 'text-slate-800 hover:text-indigo-600'}`}
                                            onClick={() => setAbsentModalEmp(emp)}
                                            title="Click para marcar Ausente o Editar"
                                        >
                                            {emp.first_name} {emp.last_name}
                                        </div>
                                        {(() => {
                                            // Resolver el título del puesto
                                            const ref = emp.job_references?.[0];
                                            const jobMatch = ref ? allJobs.find(j => j.guid === ref.guid || String(j.id) === ref.guid) : null;
                                            const jobTitle = jobMatch?.title || (shift as any)?.job_title || '';
                                            return jobTitle ? (
                                                <div className="text-xs font-bold text-blue-500 truncate mt-0.5 uppercase tracking-wide">
                                                    {jobTitle}
                                                </div>
                                            ) : null;
                                        })()}
                                        {isOff ? (
                                            <div className="text-sm text-slate-400 font-bold mt-0.5">OFF</div>
                                        ) : (
                                            <div className="text-sm text-slate-600 font-bold mt-1">
                                                {new Date(shift.start_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} - {new Date(shift.end_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                        )}
                                        {showRealPunches && empPunch && (
                                            <div className="text-xs text-cyan-600 mt-1 uppercase font-bold">
                                                Toast: {new Date(empPunch.clock_in).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
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
                                                className={`absolute ${showRealPunches ? 'top-3' : 'top-1/2 -translate-y-1/2'} h-9 bg-indigo-100 border border-indigo-200 rounded-md flex items-center overflow-visible z-[70] shadow-sm`}
                                            >
                                                {/* Scheduled Breaks */}
                                                {shift.breaks_schedule?.map((b: any, idx: number) => {
                                                    const subLeft = getTimelinePosition(b.start_time)
                                                    const posLeft = getTimelinePosition(shift.start_time)
                                                    const wPct = getTimelineWidth(shift.start_time, shift.end_time)
                                                    let relativeLeft = ((subLeft - posLeft) / wPct) * 100
                                                    if (relativeLeft < 0) relativeLeft = 0;
                                                    const bWidth = getTimelineWidth(b.start_time, b.end_time)
                                                    let relativeWidth = (bWidth / wPct) * 100

                                                    const isMeal = b.type === 'meal_30'

                                                    return (
                                                        <motion.div
                                                            key={`plan-${idx}`}
                                                            tabIndex={0}
                                                            drag="x"
                                                            dragMomentum={false}
                                                            onDragEnd={(e, info) => handleBreakDragEnd(e, info, shift, idx)}
                                                            className={`absolute -top-1 -bottom-1 rounded border group/break cursor-pointer transition-transform hover:scale-110 active:scale-110 focus:outline-none min-w-[20px] before:absolute before:content-[''] before:-inset-[10px] before:z-[-1] ${isMeal
                                                                ? 'bg-amber-500 border-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.5)]'
                                                                : 'bg-emerald-500 border-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.5)]'
                                                                }`}
                                                            style={{
                                                                left: `${relativeLeft}%`,
                                                                width: `max(${relativeWidth}%, 20px)`,
                                                            }}
                                                        >
                                                            <div className="opacity-0 group-hover/break:opacity-100 group-focus/break:opacity-100 group-active/break:opacity-100 absolute -top-12 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[14px] font-bold px-3 py-1.5 rounded whitespace-nowrap shadow-lg pointer-events-none z-[80] transition-opacity">
                                                                {isMeal ? 'Planned Meal' : 'Planned Break'}<br />
                                                                {new Date(b.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                                                            </div>
                                                        </motion.div>
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
                                                className="absolute bottom-3 h-4 bg-cyan-900/50 border-b-2 border-cyan-500/50 rounded-sm flex items-center overflow-visible z-10 hover:z-30 focus-within:z-50"
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
                                                            tabIndex={0}
                                                            className={`absolute top-0 bottom-0 rounded border border-cyan-400 group/rbreak cursor-help focus:outline-none ${isRealMeal ? 'bg-cyan-500' : 'bg-teal-400'}`}
                                                            style={{
                                                                left: `${relativeLeft}%`,
                                                                width: `${relativeWidth}%`,
                                                            }}
                                                        >
                                                            <div className="opacity-0 group-hover/rbreak:opacity-100 group-focus/rbreak:opacity-100 group-active/rbreak:opacity-100 absolute -top-12 left-1/2 -translate-x-1/2 bg-slate-800 text-cyan-300 text-[14px] font-bold px-3 py-1.5 rounded whitespace-nowrap shadow-lg pointer-events-none z-50 transition-opacity">
                                                                {isRealMeal ? 'Lunch Real' : 'Break Real'}: {durationMins.toFixed(0)} min<br />
                                                                {new Date(rb.inDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
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

                    {/* LINEA MORADA HORA ACTUAL */}
                    {isTodayLineVisible && (
                        <div className="absolute top-0 bottom-0 left-64 right-0 pointer-events-none z-[60] rounded-r-xl overflow-hidden">
                            <div
                                className="absolute top-0 bottom-0 w-[10px] -translate-x-[5px] pointer-events-auto cursor-help group/timeline z-50 flex flex-col items-center"
                                style={{ left: `${currentTimeLeft}%` }}
                            >
                                {/* Línea visible central */}
                                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[3px] h-full bg-fuchsia-600 shadow-[0_0_12px_rgba(192,38,211,0.8)] group-hover/timeline:w-[5px] transition-all duration-200"></div>

                                {/* Contenedor pegajoso para que el Tooltip baje junto con el scroll del usuario */}
                                <div className="sticky top-[220px] md:top-[160px] self-center flex flex-col items-center mt-20 pointer-events-none">
                                    {/* Punto focal brillante */}
                                    <div className="w-3 h-3 rounded-full bg-fuchsia-400 border-[2px] border-white shadow-[0_0_10px_rgba(192,38,211,1)] opacity-0 group-hover/timeline:opacity-100 transition-opacity mb-2"></div>

                                    {/* Tooltip Globo */}
                                    <div className="opacity-0 group-hover/timeline:opacity-100 bg-slate-900 border border-fuchsia-500/50 text-white text-[13px] font-bold px-4 py-2 rounded-lg shadow-2xl transition-all duration-300 whitespace-nowrap z-[60] translate-y-2 group-hover/timeline:translate-y-0 text-center">
                                        <div className="text-slate-400 text-[10px] uppercase tracking-widest mb-0.5">Real Time</div>
                                        <div className="text-fuchsia-400 text-lg tabular-nums tracking-tight">
                                            {currentTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
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
                <AnimatePresence>
                    {aiStatus && (
                        <motion.div
                            initial={{ opacity: 0, y: 50, scale: 0.9 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.8 }}
                            style={{
                                position: 'fixed',
                                bottom: '24px',
                                left: '50%',
                                transform: 'translateX(-50%)',
                                zIndex: 9999,
                                background: aiStatus.type === 'success' ? '#059669' : '#4f46e5',
                                color: 'white',
                                padding: '12px 24px',
                                borderRadius: '999px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                                border: '2px solid rgba(255,255,255,0.2)',
                                fontWeight: '600',
                                fontSize: '14px',
                                cursor: 'pointer'
                            }}
                            onClick={() => setAiStatus(null)}
                            title="Click para cerrar"
                        >
                            <div style={{ background: 'rgba(255,255,255,0.2)', padding: '6px', borderRadius: '50%' }}>
                                <Zap size={18} fill="white" />
                            </div>
                            {aiStatus.message}
                            <div className="ml-2 opacity-50 px-2 py-0.5 rounded-full border border-white/30 text-[10px]">CLOSE</div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </main>

            {/* Absent Modal Wrapper */}
            {absentModalEmp && (
                <div className="fixed inset-0 z-[99999] bg-slate-900/80 flex items-center justify-center p-4 backdrop-blur-md">
                    <div className="bg-white rounded-3xl shadow-2xl p-10 w-full max-w-xl border border-slate-300">
                        <h3 className="text-4xl font-black text-slate-900 mb-2 flex items-center gap-3">
                            <Calendar size={36} className="text-indigo-600" />
                            Manage Employee
                        </h3>
                        <p className="text-slate-900 text-3xl font-black mb-10 pb-8 border-b-2 border-slate-200">
                            {absentModalEmp.first_name} {absentModalEmp.last_name}
                        </p>

                        <div className="flex flex-col gap-6">
                            <button
                                onClick={() => {
                                    const newSet = new Set(absentEmpIds);
                                    const empIdStr = String(absentModalEmp.id);
                                    if (newSet.has(empIdStr)) {
                                        newSet.delete(empIdStr);
                                    } else {
                                        newSet.add(empIdStr);
                                    }
                                    setAbsentEmpIds(newSet);
                                    triggerAiRecalculation(newSet, null, true); // Es una acción manual
                                    setAbsentModalEmp(null);
                                }}
                                className={`px-8 py-6 rounded-2xl text-2xl font-black shadow-xl flex items-center justify-center gap-3 transition-transform hover:scale-[1.02] active:scale-[0.98] ${absentEmpIds.has(String(absentModalEmp.id))
                                    ? 'bg-indigo-600 text-white hover:bg-indigo-700 border-2 border-indigo-900'
                                    : 'bg-red-600 text-white hover:bg-red-700 border-2 border-red-900'
                                    }`}
                            >
                                {absentEmpIds.has(String(absentModalEmp.id))
                                    ? 'Restore Shift (Unmark Absence)'
                                    : 'Mark Absent (Remove from Schedule)'}
                            </button>
                            <button
                                onClick={() => setAbsentModalEmp(null)}
                                className="px-8 py-5 rounded-2xl text-xl font-bold text-slate-900 bg-slate-200 hover:bg-slate-300 border-2 border-slate-300 mt-2 transition-colors shadow-sm"
                            >
                                Cancel
                            </button>
                        </div>

                        <div className="mt-10 text-lg text-slate-800 font-bold leading-relaxed text-center bg-amber-50 border border-amber-200 p-5 rounded-xl shadow-inner">
                            When excluding this employee, the AI will automatically reschedule break times for the rest of the team to cover their hours.
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
