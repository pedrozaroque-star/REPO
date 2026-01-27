'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { motion, AnimatePresence, Reorder } from 'framer-motion'
import { Calendar, Users, Briefcase, Clock, Plus, Zap, Bot, LayoutTemplate, Trash2, ArrowDownAZ, RefreshCcw, LogOut, ChevronLeft, ChevronRight, Loader2, Save, X, AlertCircle } from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase'
import { useAuth } from '@/components/ProtectedRoute'
import { useRouter } from 'next/navigation'

// Libs & Types
import { Shift, Employee, Job } from './lib/types'
import { toast, formatDateISO, addDays, getMonday, getRoleWeight, formatStoreName } from './lib/utils'

// Components
import { PlanificadorHeader } from './components/PlanificadorHeader'
import { FloatingToolbar } from './components/FloatingToolbar'
import { BudgetTool } from './components/BudgetTool'
import { ShiftModal } from './components/ShiftModal'
import { TemplateModal } from './components/TemplateModal'
import { PremiumConfirmModal } from './components/PremiumConfirmModal'
import { EmployeeRow } from './components/EmployeeRow'
import { PrintModal } from './components/PrintModal'
import { GmailConnectModal } from './components/GmailConnectModal'

// Hooks
import { useWeeklyStats } from './hooks/useWeeklyStats'
import { useSmartProjections } from './hooks/useSmartProjections'
import { useVisibleEmployees } from './hooks/useVisibleEmployees'
import { useWeather } from './hooks/useWeather'
import { useActualStats } from './hooks/useActualStats' // NEW
import { WeatherIcon } from './components/WeatherIcon'
import { User as UserIcon } from 'lucide-react'

// --- LOADER COMPONENT ---
function SurpriseLoader() {
    return (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white dark:bg-slate-900">
            <motion.div
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5 }}
                className="relative"
            >
                <div className="absolute inset-0 bg-indigo-500 blur-3xl opacity-20 animate-pulse rounded-full"></div>
                <Loader2 size={64} className="text-indigo-600 dark:text-indigo-400 animate-spin relative z-10" />
            </motion.div>
            <motion.h2
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="mt-8 text-xl font-black text-gray-800 dark:text-white uppercase tracking-[0.2em]"
            >
                Cargando Planificador
            </motion.h2>
            <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="mt-2 text-sm text-gray-500 dark:text-slate-400 font-medium"
            >
                Sincronizando datos de Toast...
            </motion.p>
        </div>
    )
}

export default function SchedulePlanner() {
    const { user } = useAuth()
    const [loading, setLoading] = useState(true)
    const [syncing, setSyncing] = useState(false)
    const [isGeneratingAPI, setIsGeneratingAPI] = useState(false)
    const [googleConnected, setGoogleConnected] = useState(false)
    const [googleEmail, setGoogleEmail] = useState('')
    const router = useRouter()

    // State
    const [currentDate, setCurrentDate] = useState(new Date())
    const [stores, setStores] = useState<any[]>([])
    const [selectedStoreId, setSelectedStoreId] = useState<string>('')
    const [employees, setEmployees] = useState<Employee[]>([])
    const [jobs, setJobs] = useState<Job[]>([])
    const [shifts, setShifts] = useState<Shift[]>([])

    // Derived
    const weekStart = useMemo(() => getMonday(currentDate), [currentDate])
    const weekDays = useMemo(() => Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i)), [weekStart])
    const currentStore = useMemo(() => stores.find(s => String(s.id) === String(selectedStoreId)), [stores, selectedStoreId])
    const storeGuid = currentStore?.external_id

    // --- HOOKS ---
    const { stats: laborStats, shiftStats } = useWeeklyStats(shifts, employees, jobs)
    const { projections, setProjections, calculateProjections, isGenerating: isCalcProjections } = useSmartProjections(storeGuid, weekStart)
    const visibleEmployees: Employee[] = useVisibleEmployees(employees, shifts, jobs)
    const { weather } = useWeather(storeGuid)
    const { actuals, loading: loadingActuals, refetch: refetchActuals } = useActualStats(storeGuid, weekStart) // NEW

    // Aggregated Daily Stats for Budget Tool
    const dailyLaborStats = useMemo(() => {
        const stats: Record<string, { cost: number, hours: number }> = {}
        weekDays.forEach(day => {
            const dStr = formatDateISO(day)
            // Only count shifts that are assigned to employees (not open shifts if desired, or maybe open shifts count as cost? usually yes if projected)
            // But shiftStats handles duration/cost for any shift passed to it.
            // Let's filter shifts that actually exist in shiftStats to be safe.
            const dayShifts = shifts.filter(s => s.shift_date === dStr)

            let dCost = 0
            let dHours = 0

            dayShifts.forEach(s => {
                if (s.id) {
                    // EXCLUDE MANAGER FROM BUDGET
                    const job = jobs.find(j => j.id === s.job_id)
                    const title = (job?.title || '').toLowerCase()
                    const isManager = title.includes('manager') && !title.includes('assist') && !title.includes('asst') && !title.includes('shift')

                    if (isManager) return

                    const sStat = shiftStats[s.id]
                    if (sStat) {
                        dCost += sStat.cost
                        dHours += sStat.duration
                    }
                }
            })
            stats[dStr] = { cost: dCost, hours: dHours }
        })
        return stats
    }, [weekDays, shifts, shiftStats, jobs])

    // --- MODAL & UI STATES ---
    const [modalConfig, setModalConfig] = useState<any>({ isOpen: false, data: null, targetDate: null, targetEmpId: null })
    const [showTemplateModal, setShowTemplateModal] = useState(false)
    const [templateName, setTemplateName] = useState('')
    const [savedTemplates, setSavedTemplates] = useState<any[]>([])
    const [isSavingTemplate, setIsSavingTemplate] = useState(false)
    const [confirmModal, setConfirmModal] = useState<any>({ isOpen: false, title: '', message: '', onConfirm: () => { }, type: 'primary', icon: null })
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false) // NEW
    const [shiftsToPublish, setShiftsToPublish] = useState<Shift[]>([]) // NEW

    // ... (This block is just to locate the insertion point correctly, I will replace the start of handlers area with the useMemo + handlers)
    // Actually, I can insert it right after the hooks section.

    // ...

    // --- HANDLERS ---
    // ...

    // (Jumping to BudgetTool render)
    /*
            <BudgetTool
                weekStart={weekStart}
                shifts={shifts}
                weeklyStats={shiftStats}
                laborStats={dailyLaborStats} // Changed from laborStats to dailyLaborStats
                projections={projections}
                setProjections={setProjections}
            />
    */

    /* 
       Wait, replace_file_content needs a contiguous block.
       I have two changes:
       1. Adding the useMemo definition.
       2. Updating the BudgetTool prop.
       
       I should use multi_replace.
    */

    // Toolbar Hints
    const [showAIInfo, setShowAIInfo] = useState(false)
    const [showSyncInfo, setShowSyncInfo] = useState(false)
    const [showOrderInfo, setShowOrderInfo] = useState(false)
    const [showClearInfo, setShowClearInfo] = useState(false)
    const [showPublishInfo, setShowPublishInfo] = useState(false)
    const [showTemplateInfo, setShowTemplateInfo] = useState(false)
    const [showPrintInfo, setShowPrintInfo] = useState(false)
    const [isPrintModalOpen, setIsPrintModalOpen] = useState(false) // NEW State
    const [isGmailModalOpen, setIsGmailModalOpen] = useState(false) // NEW Auth Modal
    const [isSyncingEmployees, setIsSyncingEmployees] = useState(false)
    const [isProcessing, setIsProcessing] = useState(false) // Generic processing state for modal spinner

    // Drag & Drop
    const [draggedShift, setDraggedShift] = useState<any>(null)
    const [isCtrlPressed, setIsCtrlPressed] = useState(false)

    // --- OAUTH & INITIAL LOAD ---
    useEffect(() => {
        async function checkGoogleAndBasics() {
            setLoading(true)
            const supabase = await getSupabaseClient()

            // 1. Check OAuth Callback in URL
            if (typeof window !== 'undefined') {
                const params = new URLSearchParams(window.location.search)
                const rt = params.get('rt')
                const ge = params.get('ge')

                if (ge) {
                    // Update User Profile with new Creds
                    // Note: We only get RT on first consent or re-consent. 
                    // If we have RT, save it. If not, maybe we just got the email (re-login without offline access)
                    const updates: any = { google_email_connected: ge }
                    if (rt) updates.google_refresh_token = rt

                    const { error } = await supabase.from('users').update(updates).eq('id', user?.id)

                    if (!error) {
                        toast.success(`Gmail conectado: ${ge}`)
                        setGoogleConnected(true)
                        setGoogleEmail(ge)
                        // Clean URL
                        router.replace('/planificador')
                    } else {
                        toast.error('Error guardando credenciales Google')
                    }
                }
            }

            // 2. Check User Status + Role Context
            let userRole = 'staff'
            let userStoreId: any = null

            if (user) {
                const { data: uData } = await supabase.from('users').select('google_refresh_token, google_email_connected, role, store_id').eq('id', user.id).single()

                if (uData) {
                    if (uData.google_email_connected) {
                        setGoogleConnected(true)
                        setGoogleEmail(uData.google_email_connected)
                    }
                    userRole = uData.role || 'staff'
                    userStoreId = uData.store_id
                }
            }

            // 3. Basics
            // Fetch Stores with RBAC
            let storeQuery = supabase.from('stores').select('*').order('name')

            // SECURITY: If not admin, restrict to assigned store
            if (userRole !== 'admin' && userStoreId) {
                storeQuery = storeQuery.eq('id', userStoreId)
            } else if (userRole !== 'admin' && !userStoreId) {
                // Manager without store assigned? Show nothing or warn
                console.warn('User is not admin but has no store assigned')
                // For safety, maybe select nothing or let them see all? 
                // Better to secure:
                // storeQuery = storeQuery.eq('id', -1) // Returns empty
                // But for now, let's assume if no store assigned, they might be a global viewer or we fallback to default behavior?
                // Let's stick to strict:
                if (userRole === 'manager' || userRole === 'gerente') {
                    alert('No tienes tienda asignada. Contacta a soporte.')
                    storeQuery = storeQuery.eq('id', -1)
                }
            }

            const { data: storesData } = await storeQuery

            if (storesData) {
                setStores(storesData)
                if (storesData.length > 0) {
                    // If restricts to 1 store, select it automatically
                    if (storesData.length === 1) {
                        setSelectedStoreId(String(storesData[0].id))
                    } else {
                        // Admin logic: Default to Lynwood or first
                        const lynwood = storesData.find((s: any) => s.name.toLowerCase().includes('lynwood'));
                        setSelectedStoreId(String(lynwood ? lynwood.id : storesData[0].id));
                    }
                }
            }

            // Fetch Jobs
            const { data: jobsData } = await supabase.from('toast_jobs').select('*').order('title')
            if (jobsData) setJobs(jobsData)

            setLoading(false)
        }
        if (user) checkGoogleAndBasics()
    }, [user])

    // --- DATA LOADING ---
    async function loadStoreData() {
        if (!storeGuid) return;
        setSyncing(true)
        const supabase = await getSupabaseClient()
        const startStr = formatDateISO(weekStart)
        const endStr = formatDateISO(addDays(weekStart, 6))

        // Employees
        const { data: allEmpData } = await supabase
            .from('toast_employees')
            .select('*')
            .order('sort_order', { ascending: true })
            .order('first_name', { ascending: true })

        if (allEmpData) {
            const filtered = allEmpData.filter((e: any) => {
                if (Array.isArray(e.store_ids)) return e.store_ids.includes(storeGuid)
                if (typeof e.store_ids === 'string') return e.store_ids.includes(storeGuid)
                return false
            })
            // Sort logic reused if needed, but DB sort_order should prevail
            setEmployees(filtered)
        }

        // Shifts
        const { data: shiftData } = await supabase
            .from('shifts')
            .select('*')
            .eq('store_id', storeGuid)
            .gte('shift_date', startStr)
            .lte('shift_date', endStr)

        if (shiftData) setShifts(shiftData)

        // Check for Saved Budget (Snapshot)
        const { data: savedBudget } = await supabase
            .from('weekly_budgets')
            .select('*')
            .eq('store_id', storeGuid)
            .eq('week_start', startStr)
            .single()

        if (savedBudget && savedBudget.sales_projections) {
            // Use Saved Snapshot
            console.log('Using saved budget snapshot')
            setProjections(savedBudget.sales_projections)
        } else {
            // Calculate Fresh Projections (Client Side for Footer)
            calculateProjections()
        }

        setSyncing(false)
    }

    useEffect(() => {
        loadStoreData()
    }, [storeGuid, weekStart])

    // --- HANDLERS ---

    const handleSyncEmployees = async () => {
        if (!storeGuid) return

        setConfirmModal({
            isOpen: true,
            title: 'Sincronizar Empleados',
            message: '¿Actualizar la lista de empleados y puestos desde Toast?\nEsto traerá nuevos ingresos y actualizará roles.',
            type: 'primary',
            icon: RefreshCcw,
            onConfirm: async () => {
                setIsSyncingEmployees(true)
                try {
                    const res = await fetch('/api/sync/employees', {
                        method: 'POST',
                        body: JSON.stringify({ storeId: storeGuid })
                    });
                    const data = await res.json()
                    if (data.success) {
                        const count = data.employees?.count ?? 0
                        loadStoreData()

                        // Success Modal
                        setConfirmModal({
                            isOpen: true,
                            title: 'Sincronización Exitosa',
                            message: `Se han actualizado ${count} perfiles de empleados.\nRoles y permisos al día.`,
                            type: 'success',
                            icon: Users,
                            onConfirm: () => setConfirmModal((prev: any) => ({ ...prev, isOpen: false }))
                        })
                    } else {
                        toast.error('Error sincronizando')
                        setConfirmModal((prev: any) => ({ ...prev, isOpen: false }))
                    }
                } catch (e: any) {
                    toast.error('Error sincronizando: ' + e.message)
                    setConfirmModal((prev: any) => ({ ...prev, isOpen: false }))
                } finally {
                    setIsSyncingEmployees(false)
                    // No auto-close here to show success
                }
            }
        })
    }

    const handleGenerateSmart = async () => {
        console.log('🤖 Smart Gen Triggered. StoreGuid:', storeGuid)
        if (!storeGuid) return toast.error('No se ha identificado la tienda (Guid missing)')
        const startStr = formatDateISO(weekStart)
        const endStr = formatDateISO(addDays(weekStart, 6))

        setConfirmModal({
            isOpen: true,
            title: 'Generador Inteligente',
            message: `¿Deseas generar horarios automáticos para "${currentStore?.name}"?\nSe eliminarán los borradores actuales.`,
            type: 'primary',
            icon: Bot,
            onConfirm: async () => {
                setIsGeneratingAPI(true)
                try {
                    const res = await fetch('/api/scheduler/generate-smart', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ storeId: storeGuid, startDate: startStr, endDate: endStr })
                    })
                    const data = await res.json()
                    if (data.success) {
                        loadStoreData()
                        // Celebration Modal!
                        setConfirmModal({
                            isOpen: true,
                            title: '¡Generación Inteligente Completada!',
                            message: `Hemos procesado la operación de tu tienda:

✅ Análisis de historial reciente (90 días)
✅ Detección de patrones de entrada/salida
✅ Aplicación de reglas de descanso
✅ Sincronización con plantilla actual

Resultado: Se han generado ${data.count} turnos optimizados listos para tu revisión.`,
                            type: 'success', // Green
                            icon: Bot,
                            onConfirm: () => setConfirmModal((prev: any) => ({ ...prev, isOpen: false }))
                        })
                    } else {
                        toast.error('Error al generar: ' + data.error)
                        setConfirmModal((prev: any) => ({ ...prev, isOpen: false }))
                    }
                } catch (e: any) {
                    toast.error('Error de conexión: ' + e.message)
                    setConfirmModal((prev: any) => ({ ...prev, isOpen: false }))
                } finally {
                    setIsGeneratingAPI(false)
                    // Do NOT auto-close modal here anymore, because success case keeps it open!
                }
            }
        })
    }

    const handleSaveShift = async (shiftData: Shift) => {
        if (!storeGuid) return
        const supabase = await getSupabaseClient()
        // Optimistic
        const tempId = shiftData.id || `temp-${Date.now()}`
        const optimisticShift = { ...shiftData, id: tempId, store_id: storeGuid }

        if (shiftData.id) setShifts(prev => prev.map(s => s.id === shiftData.id ? optimisticShift : s))
        else setShifts(prev => [...prev, optimisticShift])

        const payload = { ...shiftData, store_id: storeGuid }
        delete payload.id

        // Fix dates
        if (typeof payload.start_time === 'object') payload.start_time = (payload.start_time as Date).toISOString()
        if (typeof payload.end_time === 'object') payload.end_time = (payload.end_time as Date).toISOString()

        if (payload.start_time) {
            const d = new Date(payload.start_time)
            payload.shift_date = d.toLocaleDateString('en-CA')
        }

        let result;
        if (shiftData.id && !shiftData.id.startsWith('temp-')) {
            result = await supabase.from('shifts').update(payload).eq('id', shiftData.id).select().single()
        } else {
            // remove id for insert
            const { id, ...insertPayload } = payload
            result = await supabase.from('shifts').insert(insertPayload).select().single()
        }

        if (result.data) {
            setShifts(prev => prev.map(s => s.id === tempId || s.id === result.data.id ? result.data : s))
            toast.success('Turno guardado')
        } else {
            toast.error('Error al guardar turno')
        }
    }

    const handleDeleteShift = async (id: string) => {
        const supabase = await getSupabaseClient()
        setShifts(prev => prev.filter(s => s.id !== id))
        await supabase.from('shifts').delete().eq('id', id)
        toast.success('Turno eliminado')
    }

    // --- TEMPLATE HANDLERS ---
    const fetchTemplates = async () => {
        if (!storeGuid) return
        const supabase = await getSupabaseClient()
        const { data } = await supabase.from('schedule_templates').select('*').eq('store_id', storeGuid).order('created_at', { ascending: false })
        setSavedTemplates(data || [])
    }
    useEffect(() => { if (selectedStoreId) fetchTemplates() }, [selectedStoreId])

    const handleSaveCurrentAsTemplate = async () => {
        if (!templateName.trim()) return toast.error('Ingresa un nombre')
        setIsSavingTemplate(true)
        try {
            const supabase = await getSupabaseClient()
            const { data: template, error } = await supabase.from('schedule_templates')
                .insert({ store_id: storeGuid, name: templateName, description: `Guardado el ${new Date().toLocaleDateString()}` })
                .select().single()
            if (error) throw error

            const items = shifts.map(s => {
                const startTime = new Date(s.start_time)
                const endTime = new Date(s.end_time)
                const d = new Date(s.shift_date + 'T12:00:00')
                let day = d.getDay()
                const dayOffset = day === 0 ? 6 : day - 1
                return {
                    template_id: template.id,
                    employee_id: s.employee_id,
                    job_id: s.job_id,
                    day_of_week: dayOffset,
                    start_time: startTime.toTimeString().slice(0, 5),
                    end_time: endTime.toTimeString().slice(0, 5),
                    is_open: s.is_open
                }
            })
            if (items.length > 0) await supabase.from('schedule_template_items').insert(items)

            toast.success('Template guardado')
            setTemplateName('')
            setShowTemplateModal(false)
            fetchTemplates()
        } catch (e: any) { toast.error(e.message) }
        finally { setIsSavingTemplate(false) }
    }

    const handleApplyTemplate = async (templateId: string) => {
        setConfirmModal({
            isOpen: true,
            title: 'Aplicar Plantilla',
            message: '¿Reemplazar borradores con esta plantilla?',
            type: 'warning',
            icon: LayoutTemplate,
            onConfirm: async () => {
                setSyncing(true)
                try {
                    const supabase = await getSupabaseClient()
                    const { data: items } = await supabase.from('schedule_template_items').select('*').eq('template_id', templateId)
                    if (!items?.length) return toast.error('Plantilla vacía')

                    const startStr = formatDateISO(weekStart)
                    const endStr = formatDateISO(addDays(weekStart, 6))
                    await supabase.from('shifts').delete().eq('store_id', storeGuid).eq('status', 'draft').gte('shift_date', startStr).lte('shift_date', endStr)

                    const newShifts = items.map(item => {
                        const targetDay = addDays(weekStart, item.day_of_week)
                        const dateStr = formatDateISO(targetDay)
                        const start = new Date(`${dateStr}T${item.start_time}:00`)
                        const end = new Date(`${dateStr}T${item.end_time}:00`)
                        if (end < start) end.setDate(end.getDate() + 1)
                        return {
                            employee_id: item.employee_id, job_id: item.job_id, store_id: storeGuid,
                            start_time: start.toISOString(), end_time: end.toISOString(), shift_date: dateStr,
                            is_open: item.is_open, status: 'draft'
                        }
                    })
                    await supabase.from('shifts').insert(newShifts)
                    toast.success('Aplicado')
                    setShowTemplateModal(false)
                    loadStoreData()
                } catch (e: any) { toast.error(e.message) }
                finally { setSyncing(false) }
            }
        })
    }

    const handleDeleteTemplate = async (id: string, e: any) => {
        e.stopPropagation()
        setConfirmModal({
            isOpen: true,
            title: 'Eliminar Plantilla',
            message: '¿Eliminar permanentemente?',
            type: 'danger',
            icon: Trash2,
            onConfirm: async () => {
                const supabase = await getSupabaseClient()
                await supabase.from('schedule_templates').delete().eq('id', id)
                fetchTemplates()
            }
        })
    }

    // --- OTHER ACTIONS ---
    const handleReorder = async (newOrder: any[]) => {
        // Simplified Logic: Update state then DB (no complex merge needed if UI is correct)
        // Actually, we need to respect the original array to keep deleted/hidden employees stable
        const others = employees.filter(emp => !newOrder.find(v => v.id === emp.id))
        setEmployees([...newOrder, ...others])

        const updates = newOrder.map((emp, i) => ({ id: emp.id, toast_guid: emp.toast_guid, sort_order: i + 1 }))
        const supabase = await getSupabaseClient()
        await supabase.from('toast_employees').upsert(updates, { onConflict: 'id' })
    }

    const handleResetOrder = async () => {
        setConfirmModal({
            isOpen: true,
            title: 'Restablecer Orden',
            message: '¿Ordenar la lista jerárquicamente?\n(Managers > Shifts > Staff, luego Alfabético)',
            type: 'primary',
            icon: ArrowDownAZ,
            onConfirm: async () => {
                setIsProcessing(true) // Show spinner briefly

                // Simulate small delay for UX so user sees something happening
                await new Promise(r => setTimeout(r, 800))

                const sorted = [...employees].sort((a, b) => {
                    const aShifts = shifts.filter(s => s.employee_id === a.id);
                    const bShifts = shifts.filter(s => s.employee_id === b.id);
                    const aJob = a.job_references?.[0]?.title || '';
                    const bJob = b.job_references?.[0]?.title || '';
                    const wA = getRoleWeight(aJob, aShifts);
                    const wB = getRoleWeight(bJob, bShifts);
                    if (wA !== wB) return wA - wB;
                    return a.first_name.localeCompare(b.first_name);
                })
                setEmployees(sorted)
                const updates = sorted.map((emp, i) => ({ id: emp.id, toast_guid: emp.toast_guid, sort_order: i + 1 }))
                const supabase = await getSupabaseClient()
                await supabase.from('toast_employees').upsert(updates, { onConflict: 'id' })

                setIsProcessing(false)

                setConfirmModal({
                    isOpen: true,
                    title: 'Orden Restablecido',
                    message: 'La lista de empleados ha sido organizada por jerarquía y nombre.',
                    type: 'success',
                    icon: ArrowDownAZ,
                    onConfirm: () => setConfirmModal((prev: any) => ({ ...prev, isOpen: false }))
                })
            }
        })
    }

    const handleClearDrafts = async () => {
        const draftCount = shifts.filter(s => s.status === 'draft').length
        if (draftCount === 0) return toast.info('No hay borradores para eliminar')

        setConfirmModal({
            isOpen: true,
            title: 'Limpiar Borradores',
            message: `¿ESTÁS SEGURO?\nSe eliminarán ${draftCount} turnos en estado BORRADOR de esta semana.\nLos turnos publicados NO se tocarán.`,
            type: 'danger',
            icon: Trash2,
            onConfirm: async () => {
                setIsProcessing(true)
                try {
                    const supabase = await getSupabaseClient()
                    const drafts = shifts.filter(s => s.status === 'draft')
                    const ids = drafts.map(s => s.id)

                    await supabase.from('shifts').delete().in('id', ids)
                    setShifts(prev => prev.filter(s => s.status !== 'draft'))

                    setIsProcessing(false)

                    setConfirmModal({
                        isOpen: true,
                        title: 'Limpieza Completada',
                        message: `Se han eliminado ${draftCount} borradores correctamente.\nEl tablero está limpio.`,
                        type: 'success',
                        icon: Trash2,
                        onConfirm: () => setConfirmModal((prev: any) => ({ ...prev, isOpen: false }))
                    })
                } catch (e: any) {
                    setIsProcessing(false)
                    toast.error(e.message)
                    setConfirmModal((prev: any) => ({ ...prev, isOpen: false }))
                }
            }
        })
    }

    const executePublish = async () => {
        setIsConfirmModalOpen(false) // Close the modal immediately
        setLoading(true)
        try {
            const supabase = await getSupabaseClient()
            const ids = shiftsToPublish.map(s => s.id)
            await supabase.from('shifts').update({ status: 'published' }).in('id', ids)
            setShifts(prev => prev.map(s => ids.includes(s.id) ? { ...s, status: 'published' } : s))

            // Notify API (Only impacted employees)
            const impactedEmployeeIds = [...new Set(shiftsToPublish.map(s => s.employee_id).filter(Boolean))]
            const startStr = formatDateISO(weekStart)
            const endStr = formatDateISO(addDays(weekStart, 6))

            await fetch('/api/notifications/publish-schedule', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    store_id: storeGuid,
                    start_date: startStr,
                    end_date: endStr,
                    employee_ids: impactedEmployeeIds, // Filter notifications
                    shift_ids: ids, // NEW: Pass exact IDs to ensure we notify what we just updated
                    sender_user_id: user?.id // CRITICAL: Identify WHO is publishing to use their Gmail token
                })
            })

            // SAVE BUDGET SNAPSHOT
            const { error: budgetError } = await supabase.from('weekly_budgets').upsert({
                store_id: storeGuid,
                week_start: startStr,
                sales_projections: projections,
                updated_at: new Date().toISOString()
            }, { onConflict: 'store_id,week_start' })

            if (budgetError) console.error('Error saving budget snapshot:', budgetError)

            toast.success('Publicado y notificado')
        } catch (e: any) { toast.error(e.message) }
        finally { setLoading(false) }
    }

    const handlePublish = async () => {
        // 1. Validate Auth (Google Connect)
        if (!googleConnected) {
            setIsGmailModalOpen(true)
            return
        }

        const drafts = shifts.filter(s => s.status === 'draft')
        if (drafts.length === 0) return toast.error('No hay turnos "Borrador" para publicar')
        setShiftsToPublish(drafts)
        setIsConfirmModalOpen(true)
    }

    // --- DRAG & DROP ---
    const handleDragStart = (e: any, shift: any) => {
        setDraggedShift(shift)
        e.dataTransfer.effectAllowed = isCtrlPressed ? "copy" : "move"
    }
    const handleDrop = async (e: any, targetEmpId: string | null, targetDate: Date) => {
        e.preventDefault()
        if (!draggedShift || !storeGuid) return
        const isCopy = isCtrlPressed
        const supabase = await getSupabaseClient()
        const duration = new Date(draggedShift.end_time).getTime() - new Date(draggedShift.start_time).getTime()
        const targetDateStr = formatDateISO(targetDate)

        const origStart = new Date(draggedShift.start_time)
        const newStart = new Date(`${targetDateStr}T${origStart.toISOString().split('T')[1]}`)
        const newEnd = new Date(newStart.getTime() + duration)

        const payload: any = {
            employee_id: targetEmpId,
            job_id: draggedShift.job_id,
            store_id: storeGuid,
            start_time: newStart.toISOString(),
            end_time: newEnd.toISOString(),
            shift_date: targetDateStr,
            status: 'draft',
            is_open: !targetEmpId,
            notes: draggedShift.notes
        }

        if (isCopy) {
            const { data } = await supabase.from('shifts').insert(payload).select().single()
            if (data) setShifts(prev => [...prev, data])
        } else {
            // Move
            setShifts(prev => prev.map(s => s.id === draggedShift.id ? { ...s, ...payload, id: s.id } : s))
            const { data } = await supabase.from('shifts').update(payload).eq('id', draggedShift.id).select().single()
            if (data) setShifts(prev => prev.map(s => s.id === data.id ? data : s))
        }
        setDraggedShift(null)
    }

    // Keyboard
    useEffect(() => {
        const down = (e: KeyboardEvent) => (e.ctrlKey || e.shiftKey) && setIsCtrlPressed(true)
        const up = () => setIsCtrlPressed(false)
        window.addEventListener('keydown', down); window.addEventListener('keyup', up)
        return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
    }, [])

    if (loading) return <SurpriseLoader />

    return (
        <div className="grid grid-rows-[auto_auto_1fr] h-[calc(97.5vh-95px)] bg-gray-50 dark:bg-slate-950 overflow-hidden">
            <ShiftModal
                isOpen={modalConfig.isOpen}
                onClose={() => setModalConfig({ ...modalConfig, isOpen: false })}
                onSave={handleSaveShift}
                onDelete={handleDeleteShift}
                initialData={modalConfig.data}
                defaultDate={modalConfig.targetDate}
                defaultEmpId={modalConfig.targetEmpId}
                employees={employees}
                jobs={jobs}
            />
            <TemplateModal
                isOpen={showTemplateModal}
                onClose={() => setShowTemplateModal(false)}
                templates={savedTemplates}
                onSave={handleSaveCurrentAsTemplate}
                onApply={handleApplyTemplate}
                onDelete={handleDeleteTemplate}
                isSaving={isSavingTemplate}
                name={templateName}
                setName={setTemplateName}
            />
            {isConfirmModalOpen && (
                <PremiumConfirmModal
                    isOpen={isConfirmModalOpen}
                    onClose={() => setIsConfirmModalOpen(false)}
                    onConfirm={executePublish}
                    count={shiftsToPublish.length}
                    generating={isGeneratingAPI} // Reusing loading state for visuals
                />
            )}

            <GmailConnectModal
                isOpen={isGmailModalOpen}
                onClose={() => setIsGmailModalOpen(false)}
            />
            <PremiumConfirmModal
                isOpen={confirmModal.isOpen}
                onClose={() => setConfirmModal({ ...confirmModal, isOpen: false })}
                onConfirm={confirmModal.onConfirm}
                title={confirmModal.title}
                message={confirmModal.message}
                type={confirmModal.type}
                icon={confirmModal.icon}
                generating={isGeneratingAPI || isSyncingEmployees || isProcessing} // Unified loading state
            />

            <PlanificadorHeader
                selectedStoreId={selectedStoreId}
                setSelectedStoreId={setSelectedStoreId}
                stores={stores}
                weekStart={weekStart}
                currentDate={currentDate}
                setCurrentDate={setCurrentDate}
                syncing={syncing}
                draftCount={shifts.filter(s => s.status === 'draft').length}
                handlePublish={handlePublish}
                showPublishInfo={showPublishInfo}
                setShowPublishInfo={setShowPublishInfo}
                googleConnected={googleConnected}
                googleEmail={googleEmail}
            />

            <FloatingToolbar
                handleGenerateSmart={handleGenerateSmart}
                isGenerating={isGeneratingAPI}
                showAIInfo={showAIInfo}
                setShowAIInfo={setShowAIInfo}
                setShowTemplateModal={setShowTemplateModal}
                handleSyncEmployees={handleSyncEmployees}
                isSyncingEmployees={isSyncingEmployees}
                showSyncInfo={showSyncInfo}
                setShowSyncInfo={setShowSyncInfo}
                handleResetOrder={handleResetOrder}
                showOrderInfo={showOrderInfo}
                setShowOrderInfo={setShowOrderInfo}
                handleClearDrafts={handleClearDrafts}
                showClearInfo={showClearInfo}
                setShowClearInfo={setShowClearInfo}
                showTemplateInfo={showTemplateInfo}
                setShowTemplateInfo={setShowTemplateInfo}
                handlePrint={() => {
                    if (!storeGuid) return
                    setIsPrintModalOpen(true)
                }}
                showPrintInfo={showPrintInfo}
                setShowPrintInfo={setShowPrintInfo}
            />

            {/* MAIN GRID */}
            <div className="overflow-auto bg-white dark:bg-slate-950 relative custom-scrollbar">
                <div className="w-[99%] mx-auto border-x border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
                    <table className="w-full border-separate border-spacing-0 table-fixed">
                        <colgroup>
                            <col className="w-[25%] min-w-[300px]" />
                            <col className="w-[10.7%]" />
                            <col className="w-[10.7%]" />
                            <col className="w-[10.7%]" />
                            <col className="w-[10.7%]" />
                            <col className="w-[10.7%]" />
                            <col className="w-[10.7%]" />
                            <col className="w-[10.7%]" />
                        </colgroup>
                        <thead>
                            <tr className="bg-gray-50 dark:bg-slate-900 sticky top-0 z-20 shadow-sm border-b border-gray-200 dark:border-slate-800">
                                <th className="p-4 text-left font-black text-lg uppercase tracking-widest text-gray-800 dark:text-indigo-400 bg-gray-50 dark:bg-slate-900 z-30">Equipo</th>
                                {weekDays.map((date, i) => {
                                    const dateStr = formatDateISO(date)
                                    const w = weather[dateStr]

                                    // Staff Count logic
                                    const staffCount = new Set(
                                        shifts
                                            .filter(s => s.shift_date === dateStr && s.employee_id)
                                            .map(s => s.employee_id)
                                    ).size

                                    const isToday = [date.getDate(), date.getMonth()].join('-') === [new Date().getDate(), new Date().getMonth()].join('-')

                                    return (
                                        <th key={i} className={`p-3 border-l border-gray-200 dark:border-slate-800 align-top transition-colors bg-gray-50 dark:bg-slate-900 ${isToday ? 'bg-blue-50/50 dark:bg-slate-800 relative overflow-hidden' : ''}`}>
                                            {isToday && <div className="absolute top-0 left-0 w-full h-0.5 bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]" />}
                                            <div className="flex flex-col h-full min-h-[60px]">
                                                {/* Top Row: Day + Weather */}
                                                <div className="flex justify-between items-start mb-2 gap-2">
                                                    <div className="text-left">
                                                        <div className={`text-base font-black leading-tight tracking-tight ${isToday ? 'text-blue-600 dark:text-blue-400' : 'text-gray-900 dark:text-slate-200'}`}>
                                                            {['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'][date.getDay()]}
                                                        </div>
                                                        <div className={`text-xs font-bold capitalize mt-0.5 ${isToday ? 'text-blue-600/80 dark:text-blue-400/80' : 'text-gray-400 dark:text-slate-500'}`}>
                                                            {date.toLocaleString('es-US', { month: 'short' }).replace('.', '')} {date.getDate()}
                                                        </div>
                                                    </div>

                                                    {/* Weather Widget */}
                                                    {w && (
                                                        <div className="flex flex-col items-end flex-shrink-0" title={w.weather?.[0]?.description}>
                                                            <WeatherIcon condition={w.weather?.[0]?.main} className="w-5 h-5 mb-0.5 text-gray-400 dark:text-slate-500" />
                                                            <span className="text-[10px] font-bold text-gray-600 dark:text-slate-400">
                                                                {Math.round(w.temp?.max || 0)}°
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Bottom Row: Staff Count */}
                                                <div className="flex justify-end items-center gap-1.5 mt-auto pt-2 opacity-60 hover:opacity-100 transition-opacity" title="Empleados Programados">
                                                    <UserIcon className="w-3.5 h-3.5 text-gray-400 dark:text-slate-600" />
                                                    <span className="text-[10px] font-bold text-gray-500 dark:text-slate-500">{staffCount}</span>
                                                </div>
                                            </div>
                                        </th>
                                    )
                                })}
                            </tr>
                        </thead>
                        <Reorder.Group as="tbody" axis="y" values={employees} onReorder={handleReorder}>
                            {visibleEmployees.map(emp => (
                                <EmployeeRow
                                    key={emp.id}
                                    emp={emp}
                                    totals={laborStats[emp.id]}
                                    weekDays={weekDays}
                                    getShiftsForCell={(id: string | null, d: Date) => shifts.filter(s => (s.employee_id === id) && s.shift_date === formatDateISO(d))}
                                    jobs={jobs}
                                    weeklyStats={shiftStats} // Pass derived shift stats
                                    handleDragStart={handleDragStart}
                                    handleDrop={handleDrop}
                                    setModalConfig={setModalConfig}
                                />
                            ))}
                        </Reorder.Group>
                    </table>

                    {/* Budget Tool - Inside scroll container, always after last row */}
                    <BudgetTool
                        weekStart={weekStart}
                        shifts={shifts}
                        weeklyStats={shiftStats}
                        laborStats={dailyLaborStats}
                        projections={projections}
                        setProjections={setProjections}
                        actuals={actuals}
                        storeId={storeGuid}
                        onRefresh={refetchActuals}
                    />
                </div>
            </div>

            <PrintModal
                isOpen={isPrintModalOpen}
                onClose={() => setIsPrintModalOpen(false)}
                url={`/planificador/imprimir?storeId=${storeGuid}&startDate=${formatDateISO(weekStart)}`}
            />
        </div>
    )
}
