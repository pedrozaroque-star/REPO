'use client'

/**
 * @module app/planificador/page
 * @description Master weekly schedule planner for Tacos Gavilan store general managers and supervisors.
 * Integrates directly with Toast POS for live employee wage syncing, real punches, California
 * meal and rest break compliance sentinels, AI smart schedule generation, and sales budget tracking.
 * 
 * @businessRules
 * - The business workday begins at 6:00 AM and ends at 5:59 AM of the following calendar day.
 * - The afternoon/evening (PM) shift begins at 5:00 PM.
 * - Corporate labor cost target for Tacos Gavilan is strictly < 21.5%.
 * - Shifts starting between 00:00 and 05:59 AM belong to the previous calendar day's business date.
 * - If an employee has recorded punches in Toast for a day without a planned shift, the system auto-generates
 *   a draft shift to ensure labor hours and costs are reflected in the Budget Tool and sales reports.
 * - General Manager hours and wages are excluded from hourly employee labor budget calculations.
 * - Employees can only be scheduled for positions (toast_jobs) configured in Toast POS.
 * 
 * @dataFlow
 * Supabase (stores, toast_employees, toast_jobs, punches, shifts, weekly_budgets)
 * <-> Toast POS API (/labor/v1/employees, /labor/v1/punches)
 * <-> Intelligence v3.1 (/api/ventas, sales_projections_cache)
 * 
 * @notes
 * - Fixed employee sync to pass Content-Type header and target store exclusively.
 * - Optimized employee loading to filter via jsonb contains directly in database (160ms vs 407ms).
 * - Fixed past-midnight shift cloning bug preventing 24-hour backward regression.
 * - Shifts are not marked published until Gmail notification dispatch succeeds, preventing lockout.
 * - Resets `breaks_schedule: []` when cloning weeks, dragging/dropping shifts, or editing shift times/employee/role so Motor V30 Universal recalculates fresh breaks using latest `break_manual_overrides`.
 * - [2026-11-27] Fixed critical Realtime stale-closure bug (`useEffect([storeGuid])` calling stale `loadStoreData()` closed over initial `weekStart`, which wiped edits on other weeks once `public.shifts` joined `supabase_realtime` with `REPLICA IDENTITY FULL`). Added `loadSeqRef` monotonic load guard, fresh `activeContextRef`, buffered Realtime payload reconciliation via `applyRealtimeShiftPayload`, `reconcileShiftsUpsert` (fixing single-shift `.map()` drop bug + DB error rollback), `getBusinessDateISOFromTimestamp` (fixing V8 `hour12: false` returning `"24"` at `00:00` midnight), DST-safe LA cloning/templates/drag-drop, and synced `Reorder.Group values={visibleEmployees}`.
 */

import { useState, useEffect, useMemo, useRef } from 'react'
import { motion, AnimatePresence, Reorder } from 'framer-motion'
import { Calendar, Users, Briefcase, Clock, Plus, Zap, Bot, LayoutTemplate, Trash2, ArrowDownAZ, RefreshCcw, LogOut, ChevronLeft, ChevronRight, Loader2, Save, X, AlertCircle, AlertTriangle, Copy, Sparkles, Mail } from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase'
import { useAuth } from '@/components/ProtectedRoute'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLanguage } from '@/lib/i18n'

// Libs & Types
import { Shift, Employee, Job } from './lib/types'
import {
    toast,
    formatDateISO,
    formatDateNice,
    formatTime12h,
    addDays,
    addCalendarDaysISO,
    laWallClockToDate,
    getMonday,
    getRoleWeight,
    formatStoreName,
    getLAHoursMinutes,
    getBusinessDateISOFromTimestamp,
    getBusinessTodayISO,
    buildShiftTimestampsForBusinessDate,
    findOverlappingShift,
    reconcileShiftsUpsert,
    applyRealtimeShiftPayload,
    shiftsMatchCoreFields
} from './lib/utils'
import { evaluatePunchBreakViolation } from '@/lib/break-violations-policy'

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
import { SalesDetailModal } from './components/SalesDetailModal'
import { MobilePlannerView } from './components/MobilePlannerView'
import { CloneModal } from './components/CloneModal'

// Hooks
import { useWeeklyStats } from './hooks/useWeeklyStats'
import { useSmartProjections } from './hooks/useSmartProjections'
import { useVisibleEmployees } from './hooks/useVisibleEmployees'
import { useWeather } from './hooks/useWeather'
import { useActualStats } from './hooks/useActualStats' // NEW
import { WeatherIcon } from './components/WeatherIcon'
import { User as UserIcon } from 'lucide-react'
import { sortStoresAlphabetically } from '@/lib/store-display'

function getPlannerAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (typeof window !== 'undefined') {
        const token = window.localStorage.getItem('teg_token')
        if (token && token !== 'null' && token !== 'undefined') {
            headers.Authorization = `Bearer ${token}`
        }
    }
    return headers
}

// --- LOADER COMPONENT ---
function SurpriseLoader({ loadingText, syncingText }: { loadingText: string, syncingText: string }) {
    return (
        <div className="fixed inset-0 z-[250] flex flex-col items-center justify-center bg-white dark:bg-slate-900">
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
                {loadingText}
            </motion.h2>
            <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="mt-2 text-sm text-gray-500 dark:text-slate-400 font-medium"
            >
                {syncingText}
            </motion.p>
        </div>
    )
}

export default function SchedulePlanner() {
    'use no memo' // OPT-OUT: React Compiler can't safely optimize this 1800+ line component
    const { user, loading: authLoading } = useAuth()
    const { t, language } = useLanguage()
    const [loading, setLoading] = useState(true)
    const [syncing, setSyncing] = useState(false)
    const [isGeneratingAPI, setIsGeneratingAPI] = useState(false)
    const [sendingEmpId, setSendingEmpId] = useState<string | null>(null)
    const [googleConnected, setGoogleConnected] = useState(false)
    const [googleEmail, setGoogleEmail] = useState('')
    const router = useRouter()
    const searchParams = useSearchParams()

    // 🔒 FORCE LOGIN: Redirect if no session
    useEffect(() => {
        if (!authLoading && !user) {
            const returnUrl = encodeURIComponent(window.location.pathname + window.location.search)
            router.replace(`/login?redirect=${returnUrl}`)
        }
    }, [authLoading, user, router])

    // State
    const [currentDate, setCurrentDate] = useState(new Date())
    const [stores, setStores] = useState<any[]>([])
    const [selectedStoreId, setSelectedStoreId] = useState<string>('')
    const [showCloneModal, setShowCloneModal] = useState(false)
    const [showWelcomeModal, setShowWelcomeModal] = useState(false)
    const [employees, setEmployees] = useState<Employee[]>([])
    const [jobs, setJobs] = useState<Job[]>([])
    const [shifts, setShifts] = useState<Shift[]>([])

    // Derived (anchored strictly to 12:00 PM America/Los_Angeles so weekStart/weekDays never drift across timezones or DST)
    const weekStartStr = useMemo(() => formatDateISO(getMonday(currentDate)), [currentDate])
    const weekEndStr = useMemo(() => addCalendarDaysISO(weekStartStr, 6), [weekStartStr])
    const weekStart = useMemo(() => laWallClockToDate(weekStartStr, 12, 0), [weekStartStr])
    const weekDays = useMemo(
        () => Array.from({ length: 7 }).map((_, i) => laWallClockToDate(addCalendarDaysISO(weekStartStr, i), 12, 0)),
        [weekStartStr]
    )
    const currentStore = useMemo(() => stores.find(s => String(s.id) === String(selectedStoreId)), [stores, selectedStoreId])
    const storeGuid = currentStore?.external_id

    const [isMobile, setIsMobile] = useState(false)
    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 1024)
        checkMobile()
        window.addEventListener('resize', checkMobile)
        return () => window.removeEventListener('resize', checkMobile)
    }, [])

    const normalizedRole = (() => {
        const r = (user?.role || '').toLowerCase().trim()
        if (r === 'gerente') return 'manager'
        if (r === 'regional_manager') return 'supervisor'
        if (r === 'assistant') return 'asistente'
        return r
    })()
    const canEdit = !normalizedRole || ['admin', 'supervisor', 'manager', 'planificador', 'asistente'].includes(normalizedRole) || normalizedRole.includes('admin') || normalizedRole.includes('supervisor') || normalizedRole.includes('manager')

    // TODO: DELETE THIS EFFECT AFTER JUNE 9, 2026 (Expired Clone Modal announcement)
    // Welcome modal check for Clone feature (Active until Tuesday, June 9, 2026)
    useEffect(() => {
        const today = new Date()
        const expirationDate = new Date('2026-06-09T00:00:00') // June 9, 2026
        const seen = typeof window !== 'undefined' ? localStorage.getItem('teg_planner_clone_welcome_seen') : null
        if (today < expirationDate && !seen) {
            setShowWelcomeModal(true)
        }
    }, [])

    // --- HOOKS ---
    const { stats: laborStats, shiftStats } = useWeeklyStats(shifts, employees, jobs)
    const {
        projections,
        setProjections,
        projectionOverrides,
        savingProjectionDate,
        saveManualProjection,
        unlockManualProjection,
        calculateProjections,
        isGenerating: isCalcProjections
    } = useSmartProjections(storeGuid, weekStart)
    const visibleEmployees: Employee[] = useVisibleEmployees(employees, shifts, jobs)
    const { weather } = useWeather(storeGuid)
    const { actuals, loading: loadingActuals, refetch: refetchActuals, punches } = useActualStats(storeGuid, weekStart) // NEW

    // 🧠 AUTO-TRIGGER AI PROJECTIONS (Cerebrito)
    useEffect(() => {
        if (storeGuid && weekStart) {

            calculateProjections()
        }
    }, [storeGuid, weekStart, calculateProjections])

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
    const [salesDetailModal, setSalesDetailModal] = useState<{ isOpen: boolean, date: string | null }>({ isOpen: false, date: null })
    const [showTemplateModal, setShowTemplateModal] = useState(false)
    const [templateName, setTemplateName] = useState('')
    const [savedTemplates, setSavedTemplates] = useState<any[]>([])
    const [isSavingTemplate, setIsSavingTemplate] = useState(false)
    const [confirmModal, setConfirmModal] = useState<any>({ isOpen: false, title: '', message: '', onConfirm: () => { }, type: 'primary', icon: null })
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false)
    const [shiftsToPublish, setShiftsToPublish] = useState<Shift[]>([])
    const [isToolbarVisible, setIsToolbarVisible] = useState(false)
    const [deletedPublishedEmpIds, setDeletedPublishedEmpIds] = useState<string[]>([])
    const [violationModal, setViolationModal] = useState<{ isOpen: boolean, violations: any[] }>({ isOpen: false, violations: [] })
    const [lastAnalyzedPunches, setLastAnalyzedPunches] = useState<string>('')
    const lastAlertedStore = useRef<string | null>(null)
    const isAutoGeneratingRef = useRef(false)

    // Fresh refs preventing stale closures in Realtime listeners and async mutations
    const activeContextRef = useRef({ storeGuid: '', startStr: '', endStr: '' })
    activeContextRef.current = {
        storeGuid: storeGuid || '',
        startStr: weekStartStr,
        endStr: weekEndStr
    }
    const shiftsRef = useRef<Shift[]>(shifts)
    shiftsRef.current = shifts
    const employeesRef = useRef<Employee[]>(employees)
    employeesRef.current = employees
    const jobsRef = useRef<Job[]>(jobs)
    jobsRef.current = jobs
    const loadSeqRef = useRef(0)
    const pendingLocalMutationsRef = useRef(0)
    const queuedRealtimeEventsRef = useRef<Array<{ payload: any; receivedAt: number }>>([])
    const recentLocalWritesRef = useRef<Map<string, { at: number; shift: Shift | null }>>(new Map())
    const suppressBulkRealtimeUntilRef = useRef(0)
    const realtimeReloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const loadStoreDataRef = useRef<() => Promise<void>>(async () => {})
    const processRealtimePayloadRef = useRef<(payload: any) => void>(() => {})

    // 🚦 BREAK/LUNCH VIOLATIONS ALARM
    useEffect(() => {
        if (!punches || punches.length === 0 || employees.length === 0 || !storeGuid) return;

        // ONLY Trigger if the punches ACTUALLY BELONG to the current store
        // (prevents 'Fast Clicks' bug where it alerts previous store's violations on the new store's screen)
        if (punches[0].store_id && punches[0].store_id !== storeGuid) return;

        // ONLY trigger if we haven't alerted for THIS store yet
        if (lastAlertedStore.current === storeGuid) return;

        const runSignature = `${punches.length}-${storeGuid}-${weekStart.getTime()}`;
        if (lastAnalyzedPunches === runSignature) return;

        const violations: any[] = [];
        punches.forEach((p: any) => {
            if (p.breaks && Array.isArray(p.breaks)) {
                p.breaks.forEach((b: any) => {
                    const evalRes = evaluatePunchBreakViolation({
                        paid: b.paid,
                        inDate: b.inDate,
                        outDate: b.outDate,
                    });
                    if (!evalRes || !evalRes.isViolation) return;

                    violations.push({
                        employeeRef: p.employee_toast_guid,
                        type: evalRes.type,
                        allowed: evalRes.allowedMinutes,
                        actual: evalRes.actualMinutes,
                        date: p.business_date,
                        inDate: b.inDate,
                        outDate: b.outDate,
                        isAnomaly: evalRes.isAnomaly
                    });
                });
            }
        });

        if (violations.length > 0) {
            const detailedViolations = violations.map(v => {
                const emp = employees.find((e: any) => e.toast_guid === v.employeeRef);
                return {
                    ...v,
                    name: emp ? `${emp.chosen_name || emp.first_name} ${emp.last_name}` : 'Unknown'
                };
            }).filter(v => v.name !== 'Unknown');

            if (detailedViolations.length > 0) {
                // Consultar en base de datos si ya fueron avisados
                const checkDbAndShow = async () => {
                    const supabase = await getSupabaseClient()
                    const { data: existing } = await supabase
                        .from('punch_violations')
                        .select('employee_toast_guid, business_date, in_time')
                        .eq('store_id', storeGuid)

                    const mapped = detailedViolations.map(v => {
                        let isAlreadyNotified = false;
                        if (existing && existing.length > 0) {
                            isAlreadyNotified = existing.some((dbV: any) => {
                                return dbV.employee_toast_guid === v.employeeRef &&
                                    dbV.business_date === v.date &&
                                    new Date(dbV.in_time).getTime() === new Date(v.inDate).getTime()
                            })
                        }
                        return {
                            ...v,
                            isNotified: isAlreadyNotified,
                            isAnomaly: v.actual >= 60
                        };
                    })

                    // Mostrar anomalías/violaciones para que el manager las audite en Toast antes de las 11:59 AM
                    if (mapped.length > 0) {
                        setViolationModal({ isOpen: true, violations: mapped });
                    }
                }

                checkDbAndShow();
            }
        }

        // Mark as alerted for this store so we don't show it again when only changing the week
        lastAlertedStore.current = storeGuid;
        setLastAnalyzedPunches(runSignature);
    }, [punches, employees, lastAnalyzedPunches, storeGuid, weekStart]);

    const [isSendingViolations, setIsSendingViolations] = useState(false);

    // Cierre estándar para el Manager: Reconoce el aviso para corregir en Toast antes de las 11:59 AM
    const handleCloseViolationModal = () => {
        setViolationModal(prev => ({ ...prev, isOpen: false }));
        toast.info(
            language === 'en'
                ? 'ℹ️ Notice acknowledged. Remember to fix any punch errors in Toast POS before 11:59 AM.'
                : 'ℹ️ Aviso recibido. Recuerda corregir las ponchadas erróneas en Toast POS antes de las 11:59 AM.'
        );
    };

    // Forzar envío manual inmediato (Supervisor / Admin)
    const handleForceSendViolations = async () => {
        const toSend = violationModal.violations.filter(v => !v.isNotified);

        if (toSend.length === 0) {
            setViolationModal(prev => ({ ...prev, isOpen: false }))
            return;
        }

        setIsSendingViolations(true);
        try {
            const res = await fetch('/api/scheduler/violations/notify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    violations: toSend,
                    storeId: storeGuid
                })
            })

            const resData = await res.json()

            if (!res.ok) {
                throw new Error(resData.error || 'Failed to send notifications')
            }

            toast.success(resData.message || (language === 'en' ? 'Notifications sent to employees and Store Manager.' : 'Notificaciones enviadas a empleados y Gerente de Tienda.'))

            setViolationModal(prev => ({ ...prev, isOpen: false }))
        } catch (error: any) {
            console.error(error)
            toast.error(error.message)
        } finally {
            setIsSendingViolations(false);
        }
    }

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

            // 1. Check OAuth Callback in URL (tokens saved strictly server-side in /api/auth/google/callback)
            if (typeof window !== 'undefined') {
                const params = new URLSearchParams(window.location.search)
                const ge = params.get('ge')
                const oauthErr = params.get('error')
                const oauthSuccess = params.get('success')

                if (ge) {
                    if (oauthErr === 'email_mismatch' || (user?.email && ge.toLowerCase() !== user.email.toLowerCase())) {
                        console.error(`Security Mismatch: System(${user?.email}) != Google(${ge})`)
                        toast.error(`⚠️ ACCESO DENEGADO: Debes conectar TU cuenta corporativa (${user?.email}).\nNo se permite usar ${ge}.`)
                        router.replace('/planificador')
                        return
                    }

                    if (oauthSuccess === 'true') {
                        toast.success(`Gmail conectado: ${ge}`)
                        setGoogleConnected(true)
                        setGoogleEmail(ge)
                        router.replace('/planificador')
                    }
                }
            }

            // 2. Check User Status + Role Context
            let userRole = 'staff'
            let userStoreId: any = null

            if (user) {
                const { data: uData } = await supabase.from('users').select('email, google_email_connected, role, store_id').eq('id', user.id).single()

                if (uData) {
                    const isProtectedExec = (em?: string | null) => {
                        const c = String(em || '').trim().toLowerCase()
                        return c === 'carlos@tacosgavilan.com' || c === 'roque@tacosgavilan.com'
                    }
                    if (uData.google_email_connected && !isProtectedExec(uData.google_email_connected) && !isProtectedExec(uData.email)) {
                        setGoogleConnected(true)
                        setGoogleEmail(uData.google_email_connected)
                    } else if (isProtectedExec(uData.email) || isProtectedExec(uData.google_email_connected) || (uData.role || '').toLowerCase() === 'admin') {
                        setGoogleConnected(true)
                        setGoogleEmail('noreply@tacosgavilan.com')
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
                const sortedStores = sortStoresAlphabetically(storesData, (s: any) => s.name)
                setStores(sortedStores)
                if (storesData.length > 0) {
                    // PERSISTENCE LOGIC: Prefer URL -> LocalStorage -> Default
                    const savedStore = searchParams?.get('store') || localStorage.getItem('planner_store')
                    const matchedStore = savedStore ? storesData.find((s: any) => String(s.id) === savedStore || String(s.external_id) === savedStore) : null

                    if (storesData.length === 1) {
                        setSelectedStoreId(String(storesData[0].id))
                    } else if (matchedStore) {
                        setSelectedStoreId(String(matchedStore.id))
                    } else {
                        // Default to Lynwood or first
                        const lynwood = sortedStores.find((s: any) => s.name.toLowerCase().includes('lynwood'));
                        setSelectedStoreId(String(lynwood ? lynwood.id : sortedStores[0].id));
                    }
                }
            }

            // DATE PERSISTENCE
            const savedDate = searchParams?.get('date') || localStorage.getItem('planner_date')
            if (savedDate) {
                // Parse YYYY-MM-DD strictly at 12:00 PM America/Los_Angeles to avoid browser TZ shift
                const d = /^\d{4}-\d{2}-\d{2}$/.test(savedDate)
                    ? laWallClockToDate(savedDate, 12, 0)
                    : new Date(savedDate)
                if (!isNaN(d.getTime())) {
                    setCurrentDate(d)
                }
            }

            // Fetch Jobs
            const { data: jobsData } = await supabase.from('toast_jobs').select('*').order('title')
            if (jobsData) setJobs(jobsData)

            setLoading(false)
        }
        if (user) checkGoogleAndBasics()
    }, [user])

    // --- STORE SENDER BADGE SYNC (Reflect active Store Manager OAuth or noreply@tacosgavilan.com) ---
    useEffect(() => {
        if (!selectedStoreId || !user) return
        let cancelled = false
        ;(async () => {
            try {
                const supabase = await getSupabaseClient()
                const isProtectedExec = (em?: string | null) => {
                    const c = String(em || '').trim().toLowerCase()
                    return c === 'carlos@tacosgavilan.com' || c === 'roque@tacosgavilan.com'
                }

                const { data: mgrs } = await supabase
                    .from('users')
                    .select('email, google_email_connected, role, is_active')
                    .eq('store_id', Number(selectedStoreId))
                    .in('role', ['manager', 'gerente'])
                    .eq('is_active', true)
                    .order('id', { ascending: true })

                const activeStoreMgr = (mgrs || []).find(
                    (m: any) => m.google_email_connected && !isProtectedExec(m.email) && !isProtectedExec(m.google_email_connected)
                )

                if (cancelled) return

                if (activeStoreMgr?.google_email_connected) {
                    setGoogleConnected(true)
                    setGoogleEmail(activeStoreMgr.google_email_connected)
                    return
                }

                const { data: uData } = await supabase
                    .from('users')
                    .select('email, google_email_connected, role')
                    .eq('id', user.id)
                    .maybeSingle()

                if (cancelled) return

                if (uData?.google_email_connected && !isProtectedExec(uData.email) && !isProtectedExec(uData.google_email_connected)) {
                    setGoogleConnected(true)
                    setGoogleEmail(uData.google_email_connected)
                } else {
                    // System OAuth fallback (noreply@tacosgavilan.com) powers stores without individual manager OAuth (e.g., Bell)
                    setGoogleConnected(true)
                    setGoogleEmail('noreply@tacosgavilan.com')
                }
            } catch (err) {
                console.warn('Error resolving store sender email:', err)
            }
        })()
        return () => { cancelled = true }
    }, [selectedStoreId, user])

    // --- PERSISTENCE WATCHER (Save state on change) ---
    useEffect(() => {
        if (!loading && selectedStoreId) {
            // 1. Save to LocalStorage
            localStorage.setItem('planner_store', selectedStoreId)
            const dStr = formatDateISO(currentDate)
            localStorage.setItem('planner_date', dStr)

            // 2. Update URL silently (without reload)
            const p = new URLSearchParams(window.location.search)
            p.set('store', selectedStoreId)
            p.set('date', dStr)

            const newUrl = `${window.location.pathname}?${p.toString()}`
            window.history.replaceState(null, '', newUrl)
        }
    }, [selectedStoreId, currentDate, loading])

    // --- REALTIME & LOCAL-MUTATION RECONCILIATION HELPERS ---
    const recordLocalShiftWrite = (id: string | undefined | null, shift: Shift | null) => {
        if (!id) return
        const now = Date.now()
        const map = recentLocalWritesRef.current
        map.set(String(id), { at: now, shift })
        if (map.size > 60) {
            for (const [key, entry] of map.entries()) {
                if (now - entry.at > 5000) map.delete(key)
            }
        }
    }

    const ensureEmployeeLoaded = async (employeeId: string | null | undefined) => {
        if (!employeeId) return
        const targetId = String(employeeId)
        if (employeesRef.current.some(e => String(e.id) === targetId)) return
        const expectedStoreGuid = activeContextRef.current.storeGuid
        if (!expectedStoreGuid) return
        try {
            const supabase = await getSupabaseClient()
            const { data: empRow } = await supabase
                .from('toast_employees')
                .select('*')
                .eq('id', targetId)
                .maybeSingle()
            if (!empRow) return
            if (activeContextRef.current.storeGuid !== expectedStoreGuid) return
            setEmployees(prev => {
                if (prev.some(e => String(e.id) === String(empRow.id))) return prev
                return [...prev, empRow].sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
            })
        } catch (err) {
            console.warn('Could not load borrowed employee row:', err)
        }
    }

    const scheduleDebouncedReload = (delayMs = 500) => {
        if (realtimeReloadTimerRef.current) {
            clearTimeout(realtimeReloadTimerRef.current)
        }
        realtimeReloadTimerRef.current = setTimeout(() => {
            realtimeReloadTimerRef.current = null
            if (pendingLocalMutationsRef.current === 0) {
                loadStoreDataRef.current()
            }
        }, delayMs)
    }

    const processRealtimePayload = (payload: any) => {
        if (isAutoGeneratingRef.current || Date.now() < suppressBulkRealtimeUntilRef.current) return
        const ctx = activeContextRef.current
        if (!ctx.storeGuid || !ctx.startStr || !ctx.endStr) return

        const now = Date.now()
        for (const [key, entry] of recentLocalWritesRef.current.entries()) {
            if (now - entry.at > 5000) recentLocalWritesRef.current.delete(key)
        }

        const eventType = String(payload?.eventType || '').toUpperCase()
        if (eventType === 'INSERT' || eventType === 'UPDATE') {
            const row = payload?.new
            if (row?.id) {
                const recent = recentLocalWritesRef.current.get(String(row.id))
                if (recent && now - recent.at < 3000) {
                    if (recent.shift && shiftsMatchCoreFields(recent.shift, row)) {
                        // Idempotent self-echo from our own save — state is already authoritative
                        return
                    }
                    // Delayed echo from a rapid double-edit or concurrent edit: converge cleanly without overwriting newer state
                    scheduleDebouncedReload(800)
                    return
                }
            }
        } else if (eventType === 'DELETE') {
            const deletedId = payload?.old?.id
            if (deletedId) {
                const recent = recentLocalWritesRef.current.get(String(deletedId))
                if (recent && recent.shift === null && now - recent.at < 3000) {
                    return
                }
            }
        }

        const preview = applyRealtimeShiftPayload(shiftsRef.current, payload, ctx)
        if (preview.needsFullReload) {
            scheduleDebouncedReload(400)
            return
        }

        setShifts(prev => {
            const res = applyRealtimeShiftPayload(prev, payload, activeContextRef.current)
            return res.changed ? res.nextShifts : prev
        })

        if (preview.employeeIdToCheck) {
            ensureEmployeeLoaded(preview.employeeIdToCheck)
        }
    }
    processRealtimePayloadRef.current = processRealtimePayload

    const beginLocalMutation = () => {
        pendingLocalMutationsRef.current += 1
    }

    const endLocalMutation = () => {
        pendingLocalMutationsRef.current = Math.max(0, pendingLocalMutationsRef.current - 1)
        if (pendingLocalMutationsRef.current === 0 && queuedRealtimeEventsRef.current.length > 0) {
            const queued = queuedRealtimeEventsRef.current.splice(0, queuedRealtimeEventsRef.current.length)
            for (const item of queued) {
                const ev = item.payload
                const evId = ev?.new?.id || ev?.old?.id
                if (evId) {
                    const recent = recentLocalWritesRef.current.get(String(evId))
                    if (recent && recent.at >= item.receivedAt) {
                        // Already superseded by our own HTTP mutation response
                        continue
                    }
                }
                processRealtimePayloadRef.current(ev)
            }
        }
    }

    // --- DATA LOADING ---
    async function loadStoreData() {
        const { storeGuid: reqStoreGuid, startStr, endStr } = activeContextRef.current
        if (!reqStoreGuid || !startStr || !endStr) return

        const seq = ++loadSeqRef.current
        const isStale = () =>
            seq !== loadSeqRef.current ||
            activeContextRef.current.storeGuid !== reqStoreGuid ||
            activeContextRef.current.startStr !== startStr

        setSyncing(true)
        try {
            const supabase = await getSupabaseClient()
            if (isStale()) return

            let filteredEmployees: any[] = []

            // 1. Fetch store employees directly using JSONB contains filter (optimized from 2,200+ global loop)
            const { data: storeEmployees, error: empError } = await supabase
                .from('toast_employees')
                .select('*')
                .contains('store_ids', JSON.stringify([reqStoreGuid]))
                .order('sort_order', { ascending: true })
                .order('first_name', { ascending: true })

            if (isStale()) return
            if (empError) {
                console.error('Error fetching store employees:', empError)
            }

            filteredEmployees = storeEmployees || []

            // 2. Fetch Shifts for this store & week
            const { data: shiftData, error: shiftError } = await supabase
                .from('shifts')
                .select('*')
                .eq('store_id', reqStoreGuid)
                .gte('shift_date', startStr)
                .lte('shift_date', endStr)

            if (isStale()) return
            if (shiftError) {
                console.error('Error fetching shifts:', shiftError)
            }

            // 3. Ensure jobs are loaded
            let activeJobs = jobsRef.current
            if (activeJobs.length === 0) {
                const { data: jobsData } = await supabase.from('toast_jobs').select('*').order('title')
                if (isStale()) return
                if (jobsData) {
                    setJobs(jobsData)
                    activeJobs = jobsData
                }
            }

            // 4. Fetch actual Toast punches for this store & week
            const { data: punchData } = await supabase
                .from('punches')
                .select('business_date, employee_toast_guid, job_toast_guid, clock_in, clock_out')
                .eq('store_id', reqStoreGuid)
                .gte('business_date', startStr)
                .lte('business_date', endStr)

            if (isStale()) return

            // 5. Include any borrowed / cross-store employees who have shifts or punches in this store
            const existingEmpIds = new Set(filteredEmployees.map((e: any) => String(e.id)))
            const existingEmpGuids = new Set(filteredEmployees.map((e: any) => e.toast_guid))

            const missingIds = [...new Set(
                (shiftData || [])
                    .map((s: any) => s.employee_id)
                    .filter((id: any) => id && !existingEmpIds.has(String(id)))
            )]

            const missingGuids = [...new Set(
                (punchData || [])
                    .map((p: any) => p.employee_toast_guid)
                    .filter((guid: any) => guid && !existingEmpGuids.has(guid))
            )]

            if (missingIds.length > 0 || missingGuids.length > 0) {
                const missingEmps: any[] = []
                if (missingIds.length > 0) {
                    const { data: byId } = await supabase.from('toast_employees').select('*').in('id', missingIds)
                    if (isStale()) return
                    if (byId) missingEmps.push(...byId)
                }
                if (missingGuids.length > 0) {
                    const { data: byGuid } = await supabase.from('toast_employees').select('*').in('toast_guid', missingGuids)
                    if (isStale()) return
                    if (byGuid) {
                        byGuid.forEach((b: any) => {
                            if (!missingEmps.some((m: any) => String(m.id) === String(b.id))) {
                                missingEmps.push(b)
                            }
                        })
                    }
                }
                if (missingEmps.length > 0) {
                    filteredEmployees = [...filteredEmployees, ...missingEmps]
                }
            }

            filteredEmployees.sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
            if (isStale()) return
            setEmployees(filteredEmployees)

            // 6. Auto-detect missing planned shifts from actual Toast punches
            if (shiftData) {
                const resolvedShifts = [...shiftData]
                const missingShifts: any[] = []
                if (punchData && filteredEmployees.length > 0 && activeJobs && activeJobs.length > 0) {
                    punchData.forEach((p: any) => {
                        if (!p.employee_toast_guid || !p.clock_in) return
                        // Find matching employee in our store or borrowed list
                        const emp = filteredEmployees.find((e: any) => e.toast_guid === p.employee_toast_guid)
                        if (!emp) return

                        // Check if shift already exists on this day for this employee
                        const hasShift = resolvedShifts.some((s: any) => String(s.employee_id) === String(emp.id) && s.shift_date === p.business_date)
                        if (!hasShift) {
                            // Find matching job
                            let matchedJob = activeJobs.find((j: any) => j.guid === p.job_toast_guid)
                            if (!matchedJob && emp.job_references && emp.job_references.length > 0) {
                                matchedJob = activeJobs.find((j: any) => j.guid === emp.job_references[0].guid)
                            }
                            const jobId = matchedJob?.id || activeJobs[0]?.id

                            if (jobId) {
                                // Calculate end time: 8 hours after start_time if clock_out is null
                                let endTime = p.clock_out
                                if (!endTime && p.clock_in) {
                                    endTime = new Date(new Date(p.clock_in).getTime() + 8 * 60 * 60 * 1000).toISOString()
                                }

                                missingShifts.push({
                                    employee_id: emp.id,
                                    job_id: jobId,
                                    store_id: reqStoreGuid,
                                    start_time: p.clock_in,
                                    end_time: endTime,
                                    status: 'draft',
                                    shift_date: p.business_date,
                                    notes: 'Auto-generado por asistencia real (Punch Toast)'
                                })
                            }
                        }
                    })
                }

                if (missingShifts.length > 0 && !isStale()) {
                    isAutoGeneratingRef.current = true
                    const { data: insertedShifts, error: insertErr } = await supabase
                        .from('shifts')
                        .insert(missingShifts)
                        .select()

                    if (insertErr) {
                        console.error('Error inserting missing shifts:', insertErr)
                    } else if (insertedShifts) {
                        resolvedShifts.push(...insertedShifts)
                    }
                    setTimeout(() => {
                        isAutoGeneratingRef.current = false
                    }, 1500)
                }

                if (isStale()) return
                setShifts(resolvedShifts)
            }
        } catch (err) {
            console.error('Error in loadStoreData:', err)
        } finally {
            if (seq === loadSeqRef.current) {
                setSyncing(false)
            }
        }
    }
    loadStoreDataRef.current = loadStoreData

    useEffect(() => {
        if (realtimeReloadTimerRef.current) {
            clearTimeout(realtimeReloadTimerRef.current)
            realtimeReloadTimerRef.current = null
        }
        queuedRealtimeEventsRef.current = []
        setDeletedPublishedEmpIds([])
        setShifts([])
        loadStoreDataRef.current()
    }, [storeGuid, weekStartStr])

    // --- REALTIME: Live sync when shifts change (strictly scoped to active store & week via fresh refs) ---
    useEffect(() => {
        if (!storeGuid) return

        let cancelled = false
        let supabaseClient: any = null
        let channel: any = null

        const setupRealtime = async () => {
            supabaseClient = await getSupabaseClient()
            if (cancelled) return

            // Subscribe to changes on shifts table for this store
            channel = supabaseClient
                .channel(`shifts-${storeGuid}`)
                .on(
                    'postgres_changes',
                    {
                        event: '*', // INSERT, UPDATE, DELETE
                        schema: 'public',
                        table: 'shifts',
                        filter: `store_id=eq.${storeGuid}`
                    },
                    (payload: any) => {
                        if (cancelled) return
                        if (isAutoGeneratingRef.current || Date.now() < suppressBulkRealtimeUntilRef.current) {
                            // Ignore our own auto-draft / bulk inserts to prevent recursive double-loading
                            return
                        }
                        if (pendingLocalMutationsRef.current > 0) {
                            // Defer Realtime events while local optimistic saves are in flight
                            queuedRealtimeEventsRef.current.push({ payload, receivedAt: Date.now() })
                            return
                        }
                        processRealtimePayloadRef.current(payload)
                    }
                )
                .subscribe()

            if (cancelled && channel) {
                supabaseClient.removeChannel(channel)
            }
        }

        setupRealtime()

        // Cleanup on unmount or store change
        return () => {
            cancelled = true
            if (realtimeReloadTimerRef.current) {
                clearTimeout(realtimeReloadTimerRef.current)
                realtimeReloadTimerRef.current = null
            }
            if (channel) {
                if (supabaseClient?.removeChannel) {
                    supabaseClient.removeChannel(channel)
                } else {
                    channel.unsubscribe()
                }
            }
        }
    }, [storeGuid])

    // --- HANDLERS ---

    const handleSyncEmployees = async () => {
        if (!storeGuid) return

        setConfirmModal({
            isOpen: true,
            title: t('planner.modals.sync_employees.title'),
            message: t('planner.modals.sync_employees.message'),
            type: 'primary',
            icon: RefreshCcw,
            onConfirm: async () => {
                setIsSyncingEmployees(true)
                try {
                    const res = await fetch(`/api/sync/employees?type=employees&storeId=${storeGuid}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ storeId: storeGuid })
                    });
                    const data = await res.json()
                    if (data.success) {
                        const count = data.employees?.count ?? 0
                        await loadStoreDataRef.current()

                        // Success Modal
                        setConfirmModal({
                            isOpen: true,
                            title: t('planner.modals.sync_employees.success_title'),
                            message: t('planner.modals.sync_employees.success_message').replace('{n}', String(count)),
                            type: 'success',
                            icon: Users,
                            onConfirm: () => setConfirmModal((prev: any) => ({ ...prev, isOpen: false }))
                        })
                    } else {
                        toast.error(t('planner.toasts.sync_error'))
                        setConfirmModal((prev: any) => ({ ...prev, isOpen: false }))
                    }
                } catch (e: any) {
                    toast.error(t('planner.toasts.sync_error') + ': ' + e.message)
                    setConfirmModal((prev: any) => ({ ...prev, isOpen: false }))
                } finally {
                    setIsSyncingEmployees(false)
                    // No auto-close here to show success
                }
            }
        })
    }

    const handleGenerateSmart = async () => {

        if (!storeGuid) return toast.error(t('planner.toasts.no_store'))
        const startStr = activeContextRef.current.startStr || formatDateISO(weekStart)
        const endStr = activeContextRef.current.endStr || addCalendarDaysISO(startStr, 6)

        setConfirmModal({
            isOpen: true,
            title: t('planner.modals.smart_gen.title'),
            message: t('planner.modals.smart_gen.message').replace('{store}', currentStore?.name || ''),
            type: 'primary',
            icon: Bot,
            onConfirm: async () => {
                setIsGeneratingAPI(true)
                beginLocalMutation()
                suppressBulkRealtimeUntilRef.current = Date.now() + 15000
                try {
                    const res = await fetch('/api/scheduler/generate-smart', {
                        method: 'POST',
                        credentials: 'include',
                        headers: getPlannerAuthHeaders(),
                        body: JSON.stringify({ storeId: storeGuid, startDate: startStr, endDate: endStr })
                    })
                    const data = await res.json()
                    if (data.success) {
                        suppressBulkRealtimeUntilRef.current = Date.now() + 2500
                        await loadStoreDataRef.current()
                        // Celebration Modal!
                        setConfirmModal({
                            isOpen: true,
                            title: t('planner.modals.smart_gen.success_title'),
                            message: t('planner.modals.smart_gen.success_message').replace('{n}', String(data.count)),
                            type: 'success', // Green
                            icon: Bot,
                            onConfirm: () => setConfirmModal((prev: any) => ({ ...prev, isOpen: false }))
                        })
                    } else {
                        suppressBulkRealtimeUntilRef.current = 0
                        toast.error(t('planner.toasts.gen_error') + ': ' + data.error)
                        setConfirmModal((prev: any) => ({ ...prev, isOpen: false }))
                    }
                } catch (e: any) {
                    suppressBulkRealtimeUntilRef.current = 0
                    toast.error(t('planner.toasts.conn_error') + ': ' + e.message)
                    setConfirmModal((prev: any) => ({ ...prev, isOpen: false }))
                } finally {
                    endLocalMutation()
                    setIsGeneratingAPI(false)
                    // Do NOT auto-close modal here anymore, because success case keeps it open!
                }
            }
        })
    }

    const handleSaveShift = async (shiftData: Shift | Shift[]) => {
        const reqStoreGuid = activeContextRef.current.storeGuid || storeGuid
        const reqStartStr = activeContextRef.current.startStr
        if (!reqStoreGuid) return
        const supabase = await getSupabaseClient()
        const currentShiftsSnapshot = shiftsRef.current

        // Helper to build a clean DB payload & compute shift_date via LA 6:00 AM business-day rule
        const formatShiftPayload = (s: Shift) => {
            const rawStart = typeof (s.start_time as any) === 'object' ? (s.start_time as any as Date).toISOString() : s.start_time
            const rawEnd = typeof (s.end_time as any) === 'object' ? (s.end_time as any as Date).toISOString() : s.end_time

            const payload: Record<string, any> = {
                employee_id: s.is_open ? null : (s.employee_id || null),
                job_id: s.job_id,
                store_id: reqStoreGuid,
                start_time: rawStart,
                end_time: rawEnd,
                status: 'draft',
                notes: s.notes ?? null,
                is_open: Boolean(s.is_open || !s.employee_id),
                shift_date: rawStart ? getBusinessDateISOFromTimestamp(rawStart) : s.shift_date
            }

            const isNewShift = !s.id || String(s.id).startsWith('temp-')
            const existing = !isNewShift ? currentShiftsSnapshot.find(prev => String(prev.id) === String(s.id)) : undefined
            const scheduleChanged =
                isNewShift ||
                !existing ||
                new Date(existing.start_time).getTime() !== new Date(payload.start_time).getTime() ||
                new Date(existing.end_time).getTime() !== new Date(payload.end_time).getTime() ||
                String(existing.employee_id || '') !== String(payload.employee_id || '') ||
                String(existing.job_id || '') !== String(payload.job_id || '') ||
                String(existing.shift_date || '') !== String(payload.shift_date || '')

            if (scheduleChanged) {
                payload.breaks_schedule = []
            }

            return payload
        }

        // BATCH HANDLING: When shiftData is an array of shifts
        if (Array.isArray(shiftData)) {
            if (shiftData.length === 0) return

            // Track any reassignments from published shifts to notify the previous employee
            shiftData.forEach(s => {
                if (s.id) {
                    const existing = currentShiftsSnapshot.find(prev => String(prev.id) === String(s.id))
                    if (existing && existing.status === 'published' && existing.employee_id && String(existing.employee_id) !== String(s.employee_id || '')) {
                        setDeletedPublishedEmpIds(prev => [...new Set([...prev, existing.employee_id!])])
                    }
                }
            })

            const preparedItems = shiftData.map((s, idx) => {
                const dbPayload = formatShiftPayload(s)
                const isUpdate = Boolean(s.id && !String(s.id).startsWith('temp-'))
                const tempOrRealId = isUpdate
                    ? String(s.id)
                    : `temp-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 6)}`
                return {
                    isUpdate,
                    id: tempOrRealId,
                    dbPayload,
                    optimistic: {
                        ...dbPayload,
                        id: tempOrRealId,
                        store_id: reqStoreGuid,
                        status: 'draft' as const
                    } as Shift
                }
            })

            const previousShiftsBackup = [...currentShiftsSnapshot]
            const tempInsertIds = preparedItems.filter(p => !p.isUpdate).map(p => p.id)

            setShifts(prev =>
                reconcileShiftsUpsert(
                    prev,
                    preparedItems.map(p => p.optimistic),
                    {
                        activeStoreGuid: activeContextRef.current.storeGuid,
                        weekStartStr: activeContextRef.current.startStr,
                        weekEndStr: activeContextRef.current.endStr
                    }
                )
            )

            beginLocalMutation()
            try {
                const toUpdate = preparedItems.filter(p => p.isUpdate)
                const toInsert = preparedItems.filter(p => !p.isUpdate)
                const savedRows: Shift[] = []

                // Execute updates sequentially (<=7 items, clean DB concurrency)
                for (const u of toUpdate) {
                    const { data, error } = await supabase
                        .from('shifts')
                        .update(u.dbPayload)
                        .eq('id', u.id)
                        .select()
                        .single()
                    if (error) throw error
                    if (data) savedRows.push({ ...data, status: 'draft' as const })
                }

                // Execute batch insert
                if (toInsert.length > 0) {
                    const { data, error } = await supabase
                        .from('shifts')
                        .insert(toInsert.map(i => i.dbPayload))
                        .select()
                    if (error) throw error
                    if (data) {
                        data.forEach((row: any) => savedRows.push({ ...row, status: 'draft' as const }))
                    }
                }

                if (savedRows.length > 0) {
                    savedRows.forEach(row => recordLocalShiftWrite(row.id, row))
                    setShifts(prev =>
                        reconcileShiftsUpsert(prev, savedRows, {
                            replaceTempIds: tempInsertIds,
                            activeStoreGuid: activeContextRef.current.storeGuid,
                            weekStartStr: activeContextRef.current.startStr,
                            weekEndStr: activeContextRef.current.endStr
                        })
                    )
                    const uniqueEmpIds = [...new Set(savedRows.map(r => r.employee_id).filter(Boolean))] as string[]
                    uniqueEmpIds.forEach(empId => { ensureEmployeeLoaded(empId) })

                    const countMsg = savedRows.length === 1
                        ? t('planner.toasts.shift_saved')
                        : (language === 'en' ? `${savedRows.length} shifts saved` : `${savedRows.length} turnos guardados`)
                    toast.success(countMsg)
                } else {
                    if (activeContextRef.current.storeGuid === reqStoreGuid && activeContextRef.current.startStr === reqStartStr) {
                        setShifts(previousShiftsBackup)
                    }
                    toast.error(t('planner.toasts.shift_save_error'))
                }
            } catch (err: any) {
                console.error('Error saving shift batch:', err)
                if (activeContextRef.current.storeGuid === reqStoreGuid && activeContextRef.current.startStr === reqStartStr) {
                    setShifts(previousShiftsBackup)
                }
                toast.error(t('planner.toasts.shift_save_error'))
            } finally {
                endLocalMutation()
            }
            return
        }

        // SINGLE SHIFT FLOW
        const isUpdate = Boolean(shiftData.id && !String(shiftData.id).startsWith('temp-'))
        const existingShift = isUpdate
            ? currentShiftsSnapshot.find(prev => String(prev.id) === String(shiftData.id))
            : undefined

        // If an already published shift changed employee, track previous employee
        if (existingShift && existingShift.status === 'published' && existingShift.employee_id && String(existingShift.employee_id) !== String(shiftData.employee_id || '')) {
            setDeletedPublishedEmpIds(prev => [...new Set([...prev, existingShift.employee_id!])])
        }

        const payload = formatShiftPayload(shiftData)
        const tempId = isUpdate
            ? String(shiftData.id)
            : `temp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
        const optimisticShift: Shift = {
            ...payload,
            id: tempId,
            store_id: reqStoreGuid,
            status: 'draft'
        } as Shift

        setShifts(prev =>
            reconcileShiftsUpsert(prev, [optimisticShift], {
                activeStoreGuid: activeContextRef.current.storeGuid,
                weekStartStr: activeContextRef.current.startStr,
                weekEndStr: activeContextRef.current.endStr
            })
        )

        beginLocalMutation()
        try {
            const result = isUpdate
                ? await supabase.from('shifts').update(payload).eq('id', shiftData.id!).select().single()
                : await supabase.from('shifts').insert(payload).select().single()

            if (result.error || !result.data) {
                console.error('Error saving shift:', result.error)
                setShifts(prev => {
                    const withoutTemp = prev.filter(s => String(s.id || '') !== tempId)
                    if (existingShift) {
                        return reconcileShiftsUpsert(withoutTemp, [existingShift], {
                            activeStoreGuid: activeContextRef.current.storeGuid,
                            weekStartStr: activeContextRef.current.startStr,
                            weekEndStr: activeContextRef.current.endStr
                        })
                    }
                    return withoutTemp
                })
                toast.error(t('planner.toasts.shift_save_error'))
                return
            }

            const savedRow: Shift = { ...result.data, status: 'draft' as const }
            recordLocalShiftWrite(savedRow.id, savedRow)
            setShifts(prev =>
                reconcileShiftsUpsert(prev, [savedRow], {
                    replaceTempIds: isUpdate ? [] : [tempId],
                    activeStoreGuid: activeContextRef.current.storeGuid,
                    weekStartStr: activeContextRef.current.startStr,
                    weekEndStr: activeContextRef.current.endStr
                })
            )
            if (savedRow.employee_id) {
                ensureEmployeeLoaded(savedRow.employee_id)
            }
            toast.success(t('planner.toasts.shift_saved'))
        } catch (err: any) {
            console.error('Unexpected error saving shift:', err)
            setShifts(prev => {
                const withoutTemp = prev.filter(s => String(s.id || '') !== tempId)
                if (existingShift) {
                    return reconcileShiftsUpsert(withoutTemp, [existingShift], {
                        activeStoreGuid: activeContextRef.current.storeGuid,
                        weekStartStr: activeContextRef.current.startStr,
                        weekEndStr: activeContextRef.current.endStr
                    })
                }
                return withoutTemp
            })
            toast.error(t('planner.toasts.shift_save_error'))
        } finally {
            endLocalMutation()
        }
    }

    const handleDeleteShift = async (id: string) => {
        const supabase = await getSupabaseClient()
        const shiftToDelete = shiftsRef.current.find(s => String(s.id) === String(id))

        // Track if we are deleting a published shift to enable re-publish
        if (shiftToDelete?.status === 'published' && shiftToDelete.employee_id) {
            setDeletedPublishedEmpIds(prev => [...new Set([...prev, shiftToDelete.employee_id!])])
        }

        setShifts(prev => prev.filter(s => String(s.id) !== String(id)))

        if (String(id).startsWith('temp-')) {
            toast.success(t('planner.toasts.shift_deleted'))
            return
        }

        beginLocalMutation()
        try {
            const { error } = await supabase.from('shifts').delete().eq('id', id)
            if (error) {
                console.error('Error deleting shift:', error)
                if (shiftToDelete) {
                    setShifts(prev =>
                        reconcileShiftsUpsert(prev, [shiftToDelete], {
                            activeStoreGuid: activeContextRef.current.storeGuid,
                            weekStartStr: activeContextRef.current.startStr,
                            weekEndStr: activeContextRef.current.endStr
                        })
                    )
                }
                toast.error(t('planner.toasts.shift_save_error'))
                return
            }
            recordLocalShiftWrite(id, null)
            toast.success(t('planner.toasts.shift_deleted'))
        } finally {
            endLocalMutation()
        }
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
        if (!templateName.trim()) return toast.error(t('planner.toasts.enter_name'))
        setIsSavingTemplate(true)
        try {
            const supabase = await getSupabaseClient()
            const { data: template, error } = await supabase.from('schedule_templates')
                .insert({ store_id: storeGuid, name: templateName, description: `Guardado el ${new Date().toLocaleDateString()}` })
                .select().single()
            if (error) throw error

            const items = shifts.map(s => {
                const startLA = getLAHoursMinutes(s.start_time)
                const endLA = getLAHoursMinutes(s.end_time)
                const d = laWallClockToDate(s.shift_date, 12, 0)
                const dayStr = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' }).format(d)
                const dayOffsetMap: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }
                const dayOffset = dayOffsetMap[dayStr] ?? 0
                return {
                    template_id: template.id,
                    employee_id: s.employee_id,
                    job_id: s.job_id,
                    day_of_week: dayOffset,
                    start_time: startLA.hhmm,
                    end_time: endLA.hhmm,
                    is_open: s.is_open
                }
            })
            if (items.length > 0) await supabase.from('schedule_template_items').insert(items)

            toast.success(t('planner.toasts.template_saved'))
            setTemplateName('')
            setShowTemplateModal(false)
            fetchTemplates()
        } catch (e: any) { toast.error(e.message) }
        finally { setIsSavingTemplate(false) }
    }

    const handleApplyTemplate = async (templateId: string) => {
        setConfirmModal({
            isOpen: true,
            title: t('planner.modals.apply_template.title'),
            message: t('planner.modals.apply_template.message'),
            type: 'warning',
            icon: LayoutTemplate,
            onConfirm: async () => {
                setIsProcessing(true) // Use generic processing state
                setSyncing(true)
                try {
                    const supabase = await getSupabaseClient()
                    const { data: items } = await supabase.from('schedule_template_items').select('*').eq('template_id', templateId)

                    if (!items || items.length === 0) {
                        toast.error(t('planner.toasts.template_empty'))
                        return
                    }

                    const startStr = activeContextRef.current.startStr || formatDateISO(weekStart)
                    const endStr = activeContextRef.current.endStr || addCalendarDaysISO(startStr, 6)

                    // Prepare new shifts strictly in America/Los_Angeles (6:00 AM business-day rule)
                    const newShifts: any[] = []

                    beginLocalMutation()
                    suppressBulkRealtimeUntilRef.current = Date.now() + 4000
                    try {
                        const clearRes = await fetch('/api/scheduler/clear-week', {
                            method: 'POST',
                            credentials: 'include',
                            headers: getPlannerAuthHeaders(),
                            body: JSON.stringify({ storeId: storeGuid, startDate: startStr, endDate: endStr })
                        })
                        if (!clearRes.ok) throw new Error('Failed to clear existing shifts')

                        for (const item of items) {
                            const dateStr = addCalendarDaysISO(startStr, Number(item.day_of_week) || 0)
                            const { start: startDateTime, end: endDateTime } = buildShiftTimestampsForBusinessDate(
                                dateStr,
                                String(item.start_time || '09:00').slice(0, 5),
                                String(item.end_time || '17:00').slice(0, 5)
                            )

                            newShifts.push({
                                employee_id: item.employee_id,
                                job_id: item.job_id,
                                store_id: storeGuid,
                                start_time: startDateTime.toISOString(),
                                end_time: endDateTime.toISOString(),
                                shift_date: dateStr,
                                is_open: item.is_open,
                                breaks_schedule: [],
                                status: 'draft'
                            })
                        }

                        const { error } = await supabase.from('shifts').insert(newShifts)
                        if (error) throw error

                        suppressBulkRealtimeUntilRef.current = Date.now() + 2500
                        toast.success(t('planner.toasts.template_applied'))
                        setShowTemplateModal(false)
                        await loadStoreDataRef.current()
                    } finally {
                        endLocalMutation()
                    }

                    // Success Modal
                    setConfirmModal({
                        isOpen: true,
                        title: t('planner.modals.apply_template.success_title') || 'Plantilla Aplicada',
                        message: `Se han cargado ${newShifts.length} turnos correctamente.`,
                        type: 'success',
                        icon: LayoutTemplate,
                        onConfirm: () => setConfirmModal((prev: any) => ({ ...prev, isOpen: false }))
                    })
                } catch (e: any) {
                    toast.error(e.message)
                    setConfirmModal((prev: any) => ({ ...prev, isOpen: false }))
                } finally {
                    setSyncing(false)
                    setIsProcessing(false)
                    // Do NOT auto-close if success, because we replaced the modal content with success message.
                    // But if error, we closed it.
                }
            }
        })
    }

    const handleDeleteTemplate = async (id: string, e: any) => {
        e.stopPropagation()
        setConfirmModal({
            isOpen: true,
            title: t('planner.modals.delete_template.title'),
            message: t('planner.modals.delete_template.message'),
            type: 'danger',
            icon: Trash2,
            onConfirm: async () => {
                const supabase = await getSupabaseClient()
                await supabase.from('schedule_templates').delete().eq('id', id)
                fetchTemplates()
            }
        })
    }

    const handleCloneWeek = async (sourceWeekStart: Date, overwrite: boolean) => {
        if (!storeGuid) return
        setIsProcessing(true)
        try {
            const supabase = await getSupabaseClient()
            const sourceStartStr = formatDateISO(sourceWeekStart)
            const sourceEndStr = formatDateISO(addDays(sourceWeekStart, 6))

            // 1. Fetch shifts from the source week
            const { data: sourceShifts, error: fetchErr } = await supabase
                .from('shifts')
                .select('*')
                .eq('store_id', storeGuid)
                .gte('shift_date', sourceStartStr)
                .lte('shift_date', sourceEndStr)

            if (fetchErr) throw fetchErr

            if (!sourceShifts || sourceShifts.length === 0) {
                toast.error(t('planner.modals.clone.empty_message') || 'No shifts found to clone.')
                setIsProcessing(false)
                return
            }

            // Exclude shifts for employees who are deleted / inactive in this store
            const activeEmpIds = new Set(employees.filter(e => !e.deleted).map(e => e.id))
            const validSourceShifts = sourceShifts.filter((s: any) => s.is_open || !s.employee_id || activeEmpIds.has(s.employee_id))

            if (validSourceShifts.length === 0) {
                toast.error(t('planner.modals.clone.empty_message') || 'No se encontraron turnos de empleados activos para clonar.')
                setIsProcessing(false)
                return
            }

            const targetStartStr = activeContextRef.current.startStr || formatDateISO(weekStart)
            const targetEndStr = activeContextRef.current.endStr || addCalendarDaysISO(targetStartStr, 6)

            // Exact calendar day difference between LA Mondays (DST-proof)
            const [sy, sm, sd] = sourceStartStr.split('-').map(Number)
            const [ty, tm, td] = targetStartStr.split('-').map(Number)
            const daysDiff = Math.round(
                (Date.UTC(ty, tm - 1, td, 12, 0, 0) - Date.UTC(sy, sm - 1, sd, 12, 0, 0)) / (24 * 3600 * 1000)
            )

            const newShifts = validSourceShifts.map((s: any) => {
                const origBusinessDateStr = s.shift_date || getBusinessDateISOFromTimestamp(s.start_time)
                const dateStr = addCalendarDaysISO(origBusinessDateStr, daysDiff)
                const startLA = getLAHoursMinutes(s.start_time)
                const endLA = getLAHoursMinutes(s.end_time)
                const { start: newStart, end: newEnd } = buildShiftTimestampsForBusinessDate(dateStr, startLA.hhmm, endLA.hhmm)

                // Limpiar breaks_schedule al clonar borradores para que al publicar o abrir /descansos
                // el Motor V30 Universal aplique las últimas preferencias aprendidas con fechas reales de la nueva semana
                return {
                    employee_id: s.employee_id,
                    job_id: s.job_id,
                    store_id: storeGuid,
                    start_time: newStart.toISOString(),
                    end_time: newEnd.toISOString(),
                    shift_date: dateStr,
                    is_open: s.is_open,
                    notes: s.notes || null,
                    breaks_schedule: [],
                    status: 'draft'
                }
            })

            beginLocalMutation()
            suppressBulkRealtimeUntilRef.current = Date.now() + 4000
            try {
                // 2. If overwrite mode is true, clear current target week shifts first
                if (overwrite) {
                    const clearRes = await fetch('/api/scheduler/clear-week', {
                        method: 'POST',
                        credentials: 'include',
                        headers: getPlannerAuthHeaders(),
                        body: JSON.stringify({ storeId: storeGuid, startDate: targetStartStr, endDate: targetEndStr })
                    })
                    if (!clearRes.ok) throw new Error('Failed to clear current week shifts')
                }

                // 4. Insert new shifts
                const { error: insertErr } = await supabase.from('shifts').insert(newShifts)
                if (insertErr) throw insertErr

                suppressBulkRealtimeUntilRef.current = Date.now() + 2500
                // 5. Reload data and notify success
                await loadStoreDataRef.current()
            } finally {
                endLocalMutation()
            }
            setShowCloneModal(false)

            setConfirmModal({
                isOpen: true,
                title: t('planner.modals.clone.success_title'),
                message: t('planner.modals.clone.success_message').replace('{n}', String(newShifts.length)),
                type: 'success',
                icon: Copy,
                onConfirm: () => setConfirmModal((prev: any) => ({ ...prev, isOpen: false }))
            })
        } catch (err: any) {
            console.error('Error cloning week:', err)
            toast.error(err.message || 'Error al clonar el horario')
        } finally {
            setIsProcessing(false)
        }
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
            title: t('planner.modals.reset_order.title'),
            message: t('planner.modals.reset_order.message'),
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
                    title: t('planner.modals.reset_order.success_title'),
                    message: t('planner.modals.reset_order.success_message'),
                    type: 'success',
                    icon: ArrowDownAZ,
                    onConfirm: () => setConfirmModal((prev: any) => ({ ...prev, isOpen: false }))
                })
            }
        })
    }

    const handleClearDrafts = async () => {
        const totalShifts = shifts.length
        if (totalShifts === 0) return toast.info(t('planner.toasts.no_shifts'))

        setConfirmModal({
            isOpen: true,
            title: t('planner.modals.clear_all.title'),
            message: t('planner.modals.clear_all.message').replace('{n}', String(totalShifts)),
            type: 'danger',
            icon: Trash2,
            onConfirm: async () => {
                setIsProcessing(true)
                try {
                    const startStr = formatDateISO(weekStart)
                    const endStr = formatDateISO(addDays(weekStart, 6))

                    // NUCLEAR OPTION VIA API: Force clear everything
                    beginLocalMutation()
                    suppressBulkRealtimeUntilRef.current = Date.now() + 3000
                    try {
                        const res = await fetch('/api/scheduler/clear-week', {
                            method: 'POST',
                            credentials: 'include',
                            headers: getPlannerAuthHeaders(),
                            body: JSON.stringify({ storeId: storeGuid, startDate: startStr, endDate: endStr })
                        })

                        if (!res.ok) throw new Error('Failed to clear shifts')

                        suppressBulkRealtimeUntilRef.current = Date.now() + 2500
                        setShifts([]) // Clear client state completely
                    } finally {
                        endLocalMutation()
                    }

                    setIsProcessing(false)

                    setConfirmModal({
                        isOpen: true,
                        title: t('planner.modals.clear_all.success_title'),
                        message: t('planner.modals.clear_all.success_message').replace('{n}', String(totalShifts)),
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

            // Notify API (Impacted employees: Newly published + Deletions)
            const impactedEmployeeIds = [...new Set([
                ...shiftsToPublish.map(s => s.employee_id).filter(Boolean),
                ...deletedPublishedEmpIds
            ])]
            const startStr = formatDateISO(weekStart)
            const endStr = formatDateISO(addDays(weekStart, 6))

            const token = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null
            const notifyRes = await fetch('/api/notifications/publish-schedule', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {})
                },
                body: JSON.stringify({
                    store_id: storeGuid,
                    start_date: startStr,
                    end_date: endStr,
                    employee_ids: impactedEmployeeIds, // Filter notifications
                    shift_ids: ids, // Pass exact IDs to ensure we notify what we just updated
                    sender_user_id: user?.id // CRITICAL: Identify WHO is publishing to use their Gmail token
                })
            })
            
            const notifyData = await notifyRes.json()

            if (!notifyRes.ok) {
                if (notifyData.error && notifyData.error.includes('GMAIL_AUTH_FAILED')) {
                    if (user?.id) {
                        fetch('/api/admin/update-user', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                ...(token ? { Authorization: `Bearer ${token}` } : {})
                            },
                            body: JSON.stringify({
                                userId: user.id,
                                userData: { google_email_connected: false, google_refresh_token: null }
                            })
                        }).catch(() => {})
                    }
                    setGoogleConnected(false)
                    setGoogleEmail('')
                    setIsGmailModalOpen(true)
                    throw new Error(t('planner.toasts.gmail_auth_failed') || 'Tu conexión a Gmail ha expirado o fue revocada. Por favor, vuelve a conectarlo para enviar los correos.')
                }
                throw new Error(notifyData.error || 'Error sending notifications')
            }

            // ONLY mark shifts as published in database after notification succeeds
            if (ids.length > 0) {
                beginLocalMutation()
                try {
                    const { error: pubErr } = await supabase.from('shifts').update({ status: 'published' }).in('id', ids)
                    if (pubErr) throw pubErr
                    const idSet = new Set(ids.map(id => String(id)))
                    setShifts(prev =>
                        prev.map(s => {
                            if (s.id && idSet.has(String(s.id))) {
                                const updated = { ...s, status: 'published' as const }
                                recordLocalShiftWrite(updated.id, updated)
                                return updated
                            }
                            return s
                        })
                    )
                } finally {
                    endLocalMutation()
                }
            }

            // SAVE BUDGET SNAPSHOT
            // 🛡️ VALIDATION: Ensure projections have all 7 days before saving
            const requiredDates: string[] = []
            for (let i = 0; i < 7; i++) {
                const d = addDays(weekStart, i)
                requiredDates.push(formatDateISO(d))
            }

            const missingDates = requiredDates.filter(d => projections[d] === undefined || projections[d] === '')
            let sourceProjections: Record<string, string> = { ...projections }

            if (missingDates.length > 0) {
                // Attempt to regenerate missing projections while keeping static manual overrides intact
                try {
                    const freshProjections = await calculateProjections()
                    if (freshProjections && Object.keys(freshProjections).length > 0) {
                        sourceProjections = { ...freshProjections, ...projections }
                    }
                } catch (regenError) {
                    console.error('❌ Failed to regenerate projections:', regenError)
                }

                const stillMissing = requiredDates.filter(d => sourceProjections[d] === undefined || sourceProjections[d] === '')
                if (stillMissing.length > 0) {
                    toast.info(t('planner.toasts.projections_incomplete') || `Warning: Projections incomplete for ${stillMissing.length} day(s)`)
                }
            }

            // Persist strictly the 7 dates belonging to this week_start (prevents cross-week date accumulation)
            const finalProjections: Record<string, string> = {}
            requiredDates.forEach(d => {
                if (sourceProjections[d] !== undefined) {
                    finalProjections[d] = String(Math.round(Number(sourceProjections[d]) || 0))
                }
            })



            const { data: savedBudget, error: budgetError } = await supabase.from('weekly_budgets').upsert({
                store_id: storeGuid,
                week_start: startStr,
                sales_projections: finalProjections,
                updated_at: new Date().toISOString()
            }, { onConflict: 'store_id,week_start' }).select()

            if (budgetError) {
                console.error('❌ Error saving budget snapshot:', budgetError)
                toast.error(t('planner.toasts.budget_error') + ': ' + budgetError.message)
            } else {

                // Update local state with the complete projections
                if (Object.keys(finalProjections).length > Object.keys(projections).length) {
                    setProjections(finalProjections)
                }
            }

            // FEEDBACK FINAL
            if (notifyData.success) {
                const { email, errors } = notifyData.stats || { email: 0, errors: 0 }
                if (email > 0) toast.success(t('planner.toasts.publish_success').replace('{n}', String(email)))
                else if (errors > 0) toast.info(t('planner.toasts.publish_partial').replace('{n}', String(errors)))
                else toast.success(t('planner.toasts.publish_no_notify'))

                if (errors > 0) console.error('Email Errors:', notifyData)
            } else {
                toast.error(t('planner.toasts.publish_notify_error') + ': ' + (notifyData.error || notifyData.message))
            }
        } catch (e: any) {
            console.error('CRITICAL PUBLISH ERROR:', e)
            toast.error(e.message)
        }
        finally {
            setDeletedPublishedEmpIds([]) // Clear tracking after publish attempt
            setLoading(false)
        }
    }

    const handleSendEmployeeSchedule = async (empId: string): Promise<boolean> => {
        if (!googleConnected) {
            setIsGmailModalOpen(true)
            toast.info(t('planner.mobile.connect_gmail_first'))
            return false
        }
        if (!storeGuid) {
            toast.error(t('planner.toasts.no_store'))
            return false
        }
        const empShifts = shifts.filter(s => String(s.employee_id) === String(empId))
        if (empShifts.length === 0) {
            toast.info(t('planner.mobile.no_scheduled_week'))
            return false
        }
        const empDraftIds = empShifts.filter(s => s.status === 'draft').map(s => s.id).filter(Boolean)
        setSendingEmpId(String(empId))
        try {
            const token = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null
            const startStr = formatDateISO(weekDays[0])
            const endStr = formatDateISO(weekDays[6])
            const res = await fetch('/api/notifications/publish-schedule', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {})
                },
                body: JSON.stringify({
                    store_id: storeGuid,
                    start_date: startStr,
                    end_date: endStr,
                    employee_ids: [String(empId)],
                    ...(empDraftIds.length > 0 ? { shift_ids: empDraftIds, resend_only: false } : { resend_only: true }),
                    skip_manager_report: true,
                    sender_user_id: user?.id
                })
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok || !data?.success) {
                if (data?.error && String(data.error).includes('GMAIL_AUTH_FAILED')) {
                    if (user?.id) {
                        fetch('/api/admin/update-user', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                ...(token ? { Authorization: `Bearer ${token}` } : {})
                            },
                            body: JSON.stringify({
                                userId: user.id,
                                userData: { google_email_connected: false, google_refresh_token: null }
                            })
                        }).catch(() => {})
                    }
                    setGoogleConnected(false)
                    setGoogleEmail('')
                    setIsGmailModalOpen(true)
                    toast.error(t('planner.toasts.gmail_auth_failed'))
                    return false
                }
                toast.error(data?.error || t('planner.toasts.publish_notify_error'))
                return false
            }
            if (empDraftIds.length > 0) {
                const draftIdSet = new Set(empDraftIds.map(id => String(id)))
                setShifts(prev =>
                    prev.map(s => {
                        if (s.id && draftIdSet.has(String(s.id))) {
                            const updated = { ...s, status: 'published' as const }
                            recordLocalShiftWrite(updated.id, updated)
                            return updated
                        }
                        return s
                    })
                )
            }
            const sentCount = data?.stats?.email ?? 0
            if (sentCount > 0) {
                toast.success(t('planner.mobile.email_sent_one'))
                return true
            }
            if (data?.stats?.skipped_invalid?.length > 0) {
                toast.error(t('planner.mobile.no_email_for_emp'))
                return false
            }
            toast.info(t('planner.toasts.publish_no_notify'))
            return false
        } catch (err: any) {
            toast.error(err?.message || t('planner.toasts.conn_error'))
            return false
        } finally {
            setSendingEmpId(null)
        }
    }

    const handlePublish = async () => {
        // 1. Validate Auth (Google Connect)
        if (!googleConnected) {
            setIsGmailModalOpen(true)
            return
        }

        const drafts = shifts.filter(s => s.status === 'draft')

        // 1. If there are pending drafts, publish them
        if (drafts.length > 0) {
            setShiftsToPublish(drafts)
            setIsConfirmModalOpen(true)
            return
        }

        // 2. If there are deleted published shifts, publish the changes to impacted crew
        if (deletedPublishedEmpIds.length > 0) {
            setShiftsToPublish([])
            setIsConfirmModalOpen(true)
            return
        }

        // 3. If whole week is already published, allow re-publishing to re-notify crew
        if (shifts.length > 0) {
            setShiftsToPublish(shifts)
            setIsConfirmModalOpen(true)
            return
        }

        toast.error(t('planner.modals.publish.no_drafts'))
    }

    const handlePrint = () => {
        if (!storeGuid) {
            toast.error(t('planner.toasts.print_error'))
            return
        }
        setIsPrintModalOpen(true)
    }

    // --- DRAG & DROP ---
    const handleDragStart = (e: any, shift: any) => {
        setDraggedShift(shift)
        e.dataTransfer.effectAllowed = isCtrlPressed ? "copy" : "move"
    }
    const handleDrop = async (e: any, targetEmpId: string | null, targetDate: Date) => {
        e.preventDefault()
        const reqStoreGuid = activeContextRef.current.storeGuid || storeGuid
        if (!draggedShift || !reqStoreGuid) return
        const shiftBeingDragged = draggedShift
        setDraggedShift(null)

        const isCopy = isCtrlPressed
        const supabase = await getSupabaseClient()
        const duration = new Date(shiftBeingDragged.end_time).getTime() - new Date(shiftBeingDragged.start_time).getTime()
        const targetDateStr = formatDateISO(targetDate)

        const origLA = getLAHoursMinutes(shiftBeingDragged.start_time)
        const origEndLA = getLAHoursMinutes(shiftBeingDragged.end_time)
        const { start: newStart, end: builtEnd } = buildShiftTimestampsForBusinessDate(
            targetDateStr,
            origLA.hhmm,
            origEndLA.hhmm !== origLA.hhmm ? origEndLA.hhmm : origLA.hhmm
        )
        const newEnd = origEndLA.hhmm !== origLA.hhmm ? builtEnd : new Date(newStart.getTime() + duration)

        const conflict = findOverlappingShift(shiftsRef.current, {
            employee_id: targetEmpId,
            is_open: !targetEmpId,
            start_time: newStart,
            end_time: newEnd,
            excludeId: isCopy ? null : shiftBeingDragged.id
        })

        if (conflict) {
            const conflictTime = `${formatTime12h(conflict.start_time)} - ${formatTime12h(conflict.end_time)}`
            toast.error(t('planner.modal_shift.overlap_error').replace('{time}', conflictTime))
            return
        }

        const payload: any = {
            employee_id: targetEmpId,
            job_id: shiftBeingDragged.job_id,
            store_id: reqStoreGuid,
            start_time: newStart.toISOString(),
            end_time: newEnd.toISOString(),
            shift_date: targetDateStr,
            status: 'draft',
            is_open: !targetEmpId,
            notes: shiftBeingDragged.notes ?? null,
            breaks_schedule: []
        }

        beginLocalMutation()
        try {
            if (isCopy) {
                const tempId = `temp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
                const optimisticCopy: Shift = { ...payload, id: tempId }
                setShifts(prev =>
                    reconcileShiftsUpsert(prev, [optimisticCopy], {
                        activeStoreGuid: activeContextRef.current.storeGuid,
                        weekStartStr: activeContextRef.current.startStr,
                        weekEndStr: activeContextRef.current.endStr
                    })
                )
                const { data, error } = await supabase.from('shifts').insert(payload).select().single()
                if (error || !data) {
                    console.error('Error copying shift via drag/drop:', error)
                    setShifts(prev => prev.filter(s => String(s.id || '') !== tempId))
                    toast.error(t('planner.toasts.shift_save_error'))
                    return
                }
                const savedCopy: Shift = { ...data, status: 'draft' as const }
                recordLocalShiftWrite(savedCopy.id, savedCopy)
                setShifts(prev =>
                    reconcileShiftsUpsert(prev, [savedCopy], {
                        replaceTempIds: [tempId],
                        activeStoreGuid: activeContextRef.current.storeGuid,
                        weekStartStr: activeContextRef.current.startStr,
                        weekEndStr: activeContextRef.current.endStr
                    })
                )
            } else {
                // Move: If previously published shift changed employee, track previous employee
                if (shiftBeingDragged?.status === 'published' && shiftBeingDragged.employee_id && String(shiftBeingDragged.employee_id) !== String(targetEmpId || '')) {
                    setDeletedPublishedEmpIds(prev => [...new Set([...prev, shiftBeingDragged.employee_id!])])
                }
                const previousSnapshot = { ...shiftBeingDragged }
                const optimisticMove: Shift = { ...shiftBeingDragged, ...payload, id: shiftBeingDragged.id }
                setShifts(prev =>
                    reconcileShiftsUpsert(prev, [optimisticMove], {
                        activeStoreGuid: activeContextRef.current.storeGuid,
                        weekStartStr: activeContextRef.current.startStr,
                        weekEndStr: activeContextRef.current.endStr
                    })
                )
                const { data, error } = await supabase.from('shifts').update(payload).eq('id', shiftBeingDragged.id).select().single()
                if (error || !data) {
                    console.error('Error moving shift via drag/drop:', error)
                    setShifts(prev =>
                        reconcileShiftsUpsert(prev, [previousSnapshot], {
                            activeStoreGuid: activeContextRef.current.storeGuid,
                            weekStartStr: activeContextRef.current.startStr,
                            weekEndStr: activeContextRef.current.endStr
                        })
                    )
                    toast.error(t('planner.toasts.shift_save_error'))
                    return
                }
                const savedMove: Shift = { ...data, status: 'draft' as const }
                recordLocalShiftWrite(savedMove.id, savedMove)
                setShifts(prev =>
                    reconcileShiftsUpsert(prev, [savedMove], {
                        activeStoreGuid: activeContextRef.current.storeGuid,
                        weekStartStr: activeContextRef.current.startStr,
                        weekEndStr: activeContextRef.current.endStr
                    })
                )
            }
        } finally {
            endLocalMutation()
        }
    }

    // Keyboard
    useEffect(() => {
        const down = (e: KeyboardEvent) => (e.ctrlKey || e.shiftKey || e.metaKey) && setIsCtrlPressed(true)
        const up = () => setIsCtrlPressed(false)
        window.addEventListener('keydown', down); window.addEventListener('keyup', up)
        return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
    }, [])

    const handleCloseWelcomeModal = () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('teg_planner_clone_welcome_seen', '1')
        }
        setShowWelcomeModal(false)
    }

    if (loading) return <SurpriseLoader loadingText={t('planner.loading')} syncingText={t('planner.syncing_toast')} />

    return (
        <div className={isMobile ? 'flex flex-col min-h-[calc(100dvh-130px)] bg-gray-50 dark:bg-slate-950' : 'grid grid-rows-[auto_auto_1fr] h-[calc(100vh-140px)] sm:h-[calc(100vh-95px)] bg-gray-50 dark:bg-slate-950 overflow-hidden'}>
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
                weekDays={weekDays}
                existingShifts={shifts}
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
            <CloneModal
                isOpen={showCloneModal}
                onClose={() => setShowCloneModal(false)}
                onConfirm={handleCloneWeek}
                weekStart={weekStart}
                isProcessing={isProcessing}
            />

            {/* TODO: DELETE THIS MODAL JSX AFTER JUNE 9, 2026 (Expired Clone Modal announcement) */}
            {showWelcomeModal && (
                <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-slate-900 w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 relative">
                        <button 
                            onClick={handleCloseWelcomeModal}
                            className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors cursor-pointer"
                        >
                            <X size={20} />
                        </button>
                        <div className="p-8">
                            <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-2xl flex items-center justify-center mb-6 shadow-inner">
                                <Sparkles size={32} />
                            </div>
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2 leading-tight">
                                {t('planner.welcome_modal.title')}
                            </h2>
                            <h3 className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 mb-4 uppercase tracking-wider">
                                {t('planner.welcome_modal.subtitle')}
                            </h3>
                            <p className="text-slate-600 dark:text-slate-400 leading-relaxed mb-6 text-sm">
                                {t('planner.welcome_modal.description')}
                            </p>
                            <button 
                                onClick={handleCloseWelcomeModal}
                                className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition-all shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/50 cursor-pointer flex items-center justify-center gap-2"
                            >
                                <span>{t('planner.welcome_modal.button')}</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {isConfirmModalOpen && (
                <PremiumConfirmModal
                    isOpen={isConfirmModalOpen}
                    onClose={() => setIsConfirmModalOpen(false)}
                    onConfirm={executePublish}
                    title={
                        shiftsToPublish.length > 0 && shifts.some(s => s.status === 'draft')
                            ? t('planner.modals.publish.title')
                            : shiftsToPublish.length === 0 && deletedPublishedEmpIds.length > 0
                            ? (t('planner.modals.publish.deletions_title') || 'Publicar Cambios de Horario')
                            : (t('planner.modals.publish.republish_title') || 'Re-publicar Horario')
                    }
                    message={
                        shiftsToPublish.length > 0 && shifts.some(s => s.status === 'draft')
                            ? t('planner.modals.publish.message').replace('{n}', String(shiftsToPublish.length))
                            : shiftsToPublish.length === 0 && deletedPublishedEmpIds.length > 0
                            ? (t('planner.modals.publish.deletions_message') || 'Se han eliminado turnos previamente publicados. ¿Deseas notificar los cambios a los empleados afectados?')
                            : (t('planner.modals.publish.republish_message') || 'Estás a punto de re-publicar el horario semanal ({n} turnos) y re-notificar a todo el equipo.').replace('{n}', String(shifts.length))
                    }
                    type="primary"
                    generating={isGeneratingAPI} // Reusing loading state for visuals
                />
            )}

            <GmailConnectModal
                isOpen={isGmailModalOpen}
                onClose={() => setIsGmailModalOpen(false)}
            />

            <SalesDetailModal
                isOpen={salesDetailModal.isOpen}
                onClose={() => setSalesDetailModal({ isOpen: false, date: null })}
                storeGuid={storeGuid || currentStore?.id || selectedStoreId || ''}
                date={salesDetailModal.date || ''}
                storeName={currentStore?.name}
                projectedValue={salesDetailModal.date ? projections[salesDetailModal.date] : undefined}
                overrideMeta={salesDetailModal.date ? projectionOverrides[salesDetailModal.date] : undefined}
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

            {!isMobile && (
                <PlanificadorHeader
                    selectedStoreId={selectedStoreId}
                    setSelectedStoreId={setSelectedStoreId}
                    stores={stores}
                    weekStart={weekStart}
                    currentDate={currentDate}
                    setCurrentDate={setCurrentDate}
                    syncing={syncing}
                    draftCount={shifts.filter(s => s.status === 'draft').length + deletedPublishedEmpIds.length}
                    totalShiftsCount={shifts.length}
                    handlePublish={handlePublish}
                    showPublishInfo={showPublishInfo}
                    setShowPublishInfo={setShowPublishInfo}
                    googleConnected={googleConnected}
                    googleEmail={googleEmail}
                    setIsConfirmModalOpen={setIsConfirmModalOpen}
                    isToolbarVisible={isToolbarVisible}
                    setIsToolbarVisible={setIsToolbarVisible}
                    onCloneClick={() => setShowCloneModal(true)}
                    onConnectGmail={() => setIsGmailModalOpen(true)}
                />
            )}

            <AnimatePresence>
                {!isMobile && isToolbarVisible && (
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
                        setShowTemplateInfo={setShowTemplateInfo}
                        showTemplateInfo={showTemplateInfo}
                        handlePrint={handlePrint}
                        showPrintInfo={showPrintInfo}
                        setShowPrintInfo={setShowPrintInfo}
                    />
                )}
            </AnimatePresence>

            {/* MAIN CONTENT AREA */}
            <div className={isMobile ? 'flex-1 min-h-0 relative' : 'flex-1 overflow-hidden relative'}>
                {isMobile ? (
                    <MobilePlannerView
                        shifts={shifts}
                        employees={visibleEmployees}
                        jobs={jobs}
                        weekDays={weekDays}
                        shiftStats={shiftStats}
                        laborStats={dailyLaborStats}
                        projections={projections}
                        projectionOverrides={projectionOverrides}
                        savingProjectionDate={savingProjectionDate}
                        onSaveManualProjection={saveManualProjection}
                        onUnlockManualProjection={unlockManualProjection}
                        actuals={actuals}
                        punches={punches}
                        currentDate={currentDate}
                        onDateChange={setCurrentDate}
                        weekStart={weekStart}
                        onSaveShift={handleSaveShift}
                        onDeleteShift={handleDeleteShift}
                        onCloneClick={() => setShowCloneModal(true)}
                        onSyncToast={handleSyncEmployees}
                        isSyncingEmployees={isSyncingEmployees}
                        onGenerateSmart={handleGenerateSmart}
                        isGeneratingAPI={isGeneratingAPI}
                        draftCount={shifts.filter(s => s.status === 'draft').length + deletedPublishedEmpIds.length}
                        onPublish={handlePublish}
                        storeName={currentStore?.name}
                        stores={stores}
                        selectedStoreId={selectedStoreId}
                        onStoreChange={setSelectedStoreId}
                        storeGuid={storeGuid}
                        googleConnected={googleConnected}
                        googleEmail={googleEmail}
                        onConnectGmail={() => setIsGmailModalOpen(true)}
                        totalShiftsCount={shifts.length}
                        weeklyEmpStats={laborStats}
                        onSendEmployeeSchedule={handleSendEmployeeSchedule}
                        sendingEmpId={sendingEmpId}
                        onOpenTemplates={() => setShowTemplateModal(true)}
                        onPrint={handlePrint}
                        onClearWeek={handleClearDrafts}
                        weather={weather}
                        canEdit={canEdit}
                        isExternalLoading={loadingActuals || isCalcProjections}
                        onRefresh={refetchActuals}
                        onCalculateProjections={() => calculateProjections(true)}
                        onShowSalesDetail={(date: string) => setSalesDetailModal({ isOpen: true, date })}
                        onEditShift={(shift, date, empId) => setModalConfig({ isOpen: true, data: shift, targetDate: date, targetEmpId: empId })}
                        onAddShift={(date, empId) => setModalConfig({ isOpen: true, data: null, targetDate: date, targetEmpId: empId })}
                    />
                ) : (
                    <div className="overflow-auto bg-white dark:bg-slate-950 relative h-full custom-scrollbar flex-1">
                        <div className="w-full sm:w-[99%] mx-auto sm:border-x border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
                            <table className="w-full border-separate border-spacing-0 table-fixed min-w-[1200px]">
                                <colgroup>
                                    <col className="w-[300px]" />
                                    <col className="w-[12.8%]" />
                                    <col className="w-[12.8%]" />
                                    <col className="w-[12.8%]" />
                                    <col className="w-[12.8%]" />
                                    <col className="w-[12.8%]" />
                                    <col className="w-[12.8%]" />
                                    <col className="w-[12.8%]" />
                                </colgroup>
                                <thead>
                                    <tr className="bg-gray-50 dark:bg-slate-900 sticky top-0 z-[25] shadow-sm border-b border-gray-200 dark:border-slate-800">
                                        <th className="p-4 text-left font-black text-lg uppercase tracking-widest text-gray-800 dark:text-indigo-400 bg-gray-50 dark:bg-slate-900 sticky left-0 z-30 shadow-[4px_0_10px_-4px_rgba(0,0,0,0.1)] dark:shadow-[4px_0_10px_-4px_rgba(0,0,0,0.5)]">{t('planner.table_header')}</th>
                                        {weekDays.map((date, i) => {
                                            const dateStr = formatDateISO(date)
                                            const w = weather[dateStr]
                                            const staffCount = new Set(
                                                shifts
                                                    .filter(s => !s.is_open && s.shift_date === dateStr && s.employee_id)
                                                    .map(s => String(s.employee_id))
                                            ).size
                                            const isToday = dateStr === getBusinessTodayISO()
                                            const dayLabelsMonToSun = [
                                                t('planner.days.mon'),
                                                t('planner.days.tue'),
                                                t('planner.days.wed'),
                                                t('planner.days.thu'),
                                                t('planner.days.fri'),
                                                t('planner.days.sat'),
                                                t('planner.days.sun')
                                            ]

                                            return (
                                                <th key={dateStr} className={`p-3 border-l border-gray-200 dark:border-slate-800 align-top transition-colors bg-gray-50 dark:bg-slate-900 ${isToday ? 'bg-blue-50/50 dark:bg-slate-800 relative overflow-hidden' : ''}`}>
                                                    {isToday && <div className="absolute top-0 left-0 w-full h-0.5 bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]" />}
                                                    <div className="flex flex-col h-full min-h-[60px]">
                                                        <div className="flex justify-between items-start mb-2 gap-2">
                                                            <div className="text-left">
                                                                <div className={`text-base font-black leading-tight tracking-tight ${isToday ? 'text-blue-600 dark:text-blue-400' : 'text-gray-900 dark:text-slate-200'}`}>
                                                                    {dayLabelsMonToSun[i]}
                                                                </div>
                                                                <div className={`text-xs font-bold capitalize mt-0.5 ${isToday ? 'text-blue-600/80 dark:text-blue-400/80' : 'text-gray-400 dark:text-slate-500'}`}>
                                                                    {date.toLocaleString(language === 'en' ? 'en-US' : 'es-US', { timeZone: 'America/Los_Angeles', month: 'short' }).replace('.', '')} {Number(dateStr.slice(8, 10))}
                                                                </div>
                                                            </div>
                                                            {w && (
                                                                <div className="flex flex-col items-end flex-shrink-0" title={w.weather?.[0]?.description}>
                                                                    <WeatherIcon condition={w.weather?.[0]?.main} className="w-5 h-5 mb-0.5 text-gray-400 dark:text-slate-500" />
                                                                    <span className="text-[10px] font-bold text-gray-600 dark:text-slate-400">{Math.round(w.temp?.max || 0)}°</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="flex justify-end items-center gap-1.5 mt-auto pt-2 opacity-60 hover:opacity-100 transition-opacity" title={t('planner.employees_scheduled')}>
                                                            <UserIcon className="w-3.5 h-3.5 text-gray-400 dark:text-slate-600" />
                                                            <span className="text-[10px] font-bold text-gray-500 dark:text-slate-500">{staffCount}</span>
                                                        </div>
                                                    </div>
                                                </th>
                                            )
                                        })}
                                    </tr>
                                </thead>
                                <Reorder.Group as="tbody" axis="y" values={visibleEmployees} onReorder={handleReorder}>
                                    {visibleEmployees.map(emp => (
                                        <EmployeeRow
                                            key={emp.id}
                                            emp={emp}
                                            totals={laborStats[emp.id] || { totalHours: 0, totalWage: 0, totalOT: 0 }}
                                            weekDays={weekDays}
                                            getShiftsForCell={(id: string | null, d: Date) =>
                                                shifts
                                                    .filter(s =>
                                                        (id ? (!s.is_open && String(s.employee_id || '') === String(id)) : (Boolean(s.is_open) || !s.employee_id)) &&
                                                        s.shift_date === formatDateISO(d)
                                                    )
                                                    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
                                            }
                                            jobs={jobs}
                                            weeklyStats={shiftStats}
                                            punches={punches}
                                            handleDragStart={handleDragStart}
                                            handleDrop={handleDrop}
                                            setModalConfig={setModalConfig}
                                        />
                                    ))}
                                </Reorder.Group>
                            </table>

                            {/* PADDING FOR BUDGET TOOL: Prevents the sticky BudgetTool from hiding the last row */}
                            <div className="h-56 w-full bg-transparent" />

                            <BudgetTool
                                weekStart={weekStart}
                                shifts={shifts}
                                weeklyStats={shiftStats}
                                laborStats={dailyLaborStats}
                                projections={projections}
                                setProjections={setProjections}
                                projectionOverrides={projectionOverrides}
                                savingProjectionDate={savingProjectionDate}
                                onSaveManualProjection={saveManualProjection}
                                onUnlockManualProjection={unlockManualProjection}
                                actuals={actuals}
                                storeId={storeGuid}
                                onRefresh={refetchActuals}
                                onCalculateProjections={() => calculateProjections(true)}
                                isExternalLoading={loadingActuals || isCalcProjections}
                                onShowSalesDetail={(date: string) => setSalesDetailModal({ isOpen: true, date })}
                                canEdit={canEdit}
                            />
                        </div>
                    </div>
                )}
            </div>

            <PrintModal
                isOpen={isPrintModalOpen}
                onClose={() => setIsPrintModalOpen(false)}
                url={`/planificador/imprimir?storeId=${storeGuid}&startDate=${formatDateISO(weekStart)}`}
            />

            {/* 🚨 DETECTOR DE ANOMALÍAS EN PONCHADAS Y AVISO AUTOMÁTICO 11:59 AM */}
            <AnimatePresence>
                {violationModal.isOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[150] flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-4"
                    >
                        <motion.div
                            initial={{ scale: 0.9, y: 50, opacity: 0 }}
                            animate={{ scale: 1, y: 0, opacity: 1 }}
                            exit={{ scale: 0.9, y: 50, opacity: 0 }}
                            className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-xl max-h-[90dvh] flex flex-col shadow-2xl border-2 border-amber-500/80 overflow-hidden"
                        >
                            {/* Modal Header */}
                            <div className="bg-gradient-to-r from-amber-600 via-orange-600 to-red-600 p-5 sm:p-6 text-center text-white relative shrink-0">
                                <button
                                    type="button"
                                    onClick={handleCloseViolationModal}
                                    aria-label={t('planner.modal_shift.close_modal')}
                                    className="w-10 h-10 flex items-center justify-center rounded-full bg-white/15 hover:bg-white/25 text-white absolute top-3 right-3 transition-colors"
                                >
                                    <X size={20} />
                                </button>
                                <div className="w-14 h-14 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-inner">
                                    <Clock size={32} className="text-white animate-pulse" />
                                </div>
                                <h2 className="text-xl font-black uppercase tracking-wider">
                                    {language === 'en' ? 'Punch Anomalies & Violations Detector' : 'Detector de Anomalías en Ponchadas'}
                                </h2>
                                <p className="text-amber-100 text-xs font-medium mt-1">
                                    {language === 'en'
                                        ? 'Review of Yesterday\'s Break & Meal Punches'
                                        : 'Revisión de Ponchadas y Tiempos de Descanso del Día Anterior'}
                                </p>
                            </div>

                            <div className="p-4 sm:p-6 flex-1 overflow-y-auto custom-scrollbar">
                                {/* ⏰ AVISO CLAVE PARA EL MANAGER: CORRECCIÓN EN TOAST ANTES DE LAS 11:59 AM */}
                                <div className="bg-amber-50 dark:bg-amber-950/40 border-2 border-amber-300 dark:border-amber-700/60 rounded-2xl p-4 mb-5 shadow-sm">
                                    <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200 font-extrabold text-xs uppercase tracking-wide">
                                        <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400" />
                                        {language === 'en' ? 'Manager Notice: Toast Correction Window' : 'Aviso a Gerencia: Ventana de Corrección en TOAST'}
                                    </div>
                                    <p className="text-xs text-amber-800 dark:text-amber-300 mt-1.5 leading-relaxed font-medium">
                                        {language === 'en'
                                            ? 'The system detected the following punch anomalies and exceeded break/lunch times (10m Break / 30m Lunch). As Store Manager, you must audit any clock mistakes in TOAST POS before 11:59 AM and take direct action with each employee. At 11:59 AM, official notices are automatically sent to employees and Management.'
                                            : 'El sistema detectó los siguientes excesos sobre los tiempos autorizados (10 min Break / 30 min Lunch). Como Gerente de Tienda, es tu responsabilidad auditar antes de las 11:59 AM cualquier error de reloj en TOAST POS y dar seguimiento inmediato con cada empleado. A las 11:59 AM se envían los avisos oficiales al empleado y a Gerencia.'}
                                    </p>
                                </div>

                                {/* List of Employees and Punches */}
                                <ul className="space-y-3">
                                    {(() => {
                                        const grouped: Record<string, any[]> = {};
                                        violationModal.violations.forEach(v => {
                                            if (!grouped[v.name]) grouped[v.name] = [];
                                            grouped[v.name].push(v);
                                        });

                                        return Object.entries(grouped)
                                            .sort(([nameA], [nameB]) => nameA.localeCompare(nameB))
                                            .map(([name, vList], idx) => {
                                                const sorted = [...vList].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || new Date(a.inDate).getTime() - new Date(b.inDate).getTime());

                                                return (
                                                    <li key={idx} className="flex flex-col bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 rounded-2xl p-4 shadow-sm">
                                                        <div className="flex justify-between items-center mb-3">
                                                            <span className="font-extrabold text-slate-900 dark:text-slate-100 text-base flex items-center gap-2">
                                                                👤 {name}
                                                            </span>
                                                            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700">
                                                                {vList.length} {vList.length === 1 ? (language === 'en' ? 'record' : 'registro') : (language === 'en' ? 'records' : 'registros')}
                                                            </span>
                                                        </div>
                                                        <div className="space-y-2.5">
                                                            {sorted.map((v, i) => {
                                                                const formatTime = (isoString?: string) => {
                                                                    if (!isoString) return '--';
                                                                    return new Date(isoString).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                                                                };

                                                                const isSevereAnomaly = v.actual >= 60;

                                                                return (
                                                                    <div key={i} className={`flex flex-col bg-white dark:bg-slate-900 rounded-xl p-3 border ${isSevereAnomaly ? 'border-amber-400 dark:border-amber-600/80 bg-amber-50/30' : 'border-slate-200 dark:border-slate-800'}`}>
                                                                        <div className="flex flex-wrap justify-between items-center gap-1.5 mb-1.5">
                                                                            <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                                                                                📅 {formatDateNice(v.date)}
                                                                            </span>

                                                                            {v.isNotified ? (
                                                                                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800 flex items-center gap-1">
                                                                                    <span>✓</span> {language === 'en' ? 'Sent' : 'Enviado'}
                                                                                </span>
                                                                            ) : (
                                                                                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700 flex items-center gap-1">
                                                                                    <span>⏰</span> {language === 'en' ? 'Auto-send at 11:59 AM' : 'Envío Auto: 11:59 AM'}
                                                                                </span>
                                                                            )}
                                                                        </div>

                                                                        {/* Anomaly notice if > 60m */}
                                                                        {isSevereAnomaly && (
                                                                            <div className="text-[11px] font-bold text-amber-700 dark:text-amber-300 bg-amber-100/60 dark:bg-amber-950/60 px-2 py-1 rounded-md mb-2 flex items-center gap-1 border border-amber-300 dark:border-amber-800">
                                                                                <span>⚠️</span> {language === 'en' ? 'Possible punch error (>60m) - Verify in Toast POS' : 'Posible error de ponchada (>60m) - Verificar en Toast POS'}
                                                                            </div>
                                                                        )}

                                                                        <div className="text-[11px] text-slate-600 dark:text-slate-400 font-semibold tracking-tight mb-2">
                                                                            ⏱ {formatTime(v.inDate)} ➔ {formatTime(v.outDate)}
                                                                        </div>

                                                                        <div className="flex justify-between items-center text-xs">
                                                                            <span className="font-semibold text-slate-700 dark:text-slate-300">
                                                                                {v.type === 'BRK' ? (language === 'en' ? 'Break (10m)' : 'Break (10 min)') : (language === 'en' ? 'Lunch (30m)' : 'Lunch (30 min)')}
                                                                            </span>
                                                                            <span className="font-black text-red-600 dark:text-red-400">
                                                                                {language === 'en' ? 'Actual' : 'Real'}: {Math.round(v.actual)} min ({language === 'en' ? 'Allowed' : 'Permitido'}: {v.allowed}m)
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </li>
                                                );
                                            });
                                    })()}
                                </ul>
                            </div>

                            {/* Modal Footer Actions */}
                            <div className="p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-4 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-3 shrink-0">
                                <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                                    💡 {language === 'en' ? 'Auto-sync runs daily at 11:59 AM' : 'Sincronización automática diaria a las 11:59 AM'}
                                </div>

                                <div className="flex items-center gap-2">
                                    {/* Optional Force Send for Supervisor / Admin */}
                                    {(user?.role?.toLowerCase().includes('admin') || user?.role?.toLowerCase().includes('supervisor')) && (
                                        <button
                                            onClick={() => {
                                                const msg = language === 'en'
                                                    ? 'WARNING: You are about to manually dispatch violation notices immediately. Do you want to continue?'
                                                    : 'ATENCIÓN: Se enviarán las notificaciones de infracción de inmediato por correo. ¿Deseas continuar?';
                                                if (window.confirm(msg)) {
                                                    handleForceSendViolations();
                                                }
                                            }}
                                            disabled={isSendingViolations}
                                            className="text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 px-3 py-2 rounded-xl transition-colors border border-slate-300 dark:border-slate-600"
                                            title={language === 'en' ? 'Force immediate send' : 'Forzar envío inmediato'}
                                        >
                                            {isSendingViolations ? (
                                                <Loader2 size={14} className="animate-spin inline mr-1" />
                                            ) : (
                                                '⚡ '
                                            )}
                                            {language === 'en' ? 'Force Send' : 'Forzar Envío'}
                                        </button>
                                    )}

                                    {/* Primary Button for Manager */}
                                    <button
                                        onClick={handleCloseViolationModal}
                                        className="bg-amber-600 hover:bg-amber-700 active:scale-95 text-white font-bold py-2.5 px-6 rounded-xl uppercase tracking-wider text-xs transition-all shadow-md flex items-center gap-1.5"
                                    >
                                        ✓ {language === 'en' ? 'Understood / Review in Toast' : 'Entendido / Revisar en Toast'}
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
