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
import { toast, formatDateISO, formatDateNice, addDays, getMonday, getRoleWeight, formatStoreName } from './lib/utils'

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

// --- LOADER COMPONENT ---
function SurpriseLoader({ loadingText, syncingText }: { loadingText: string, syncingText: string }) {
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

    // Derived
    const weekStart = useMemo(() => getMonday(currentDate), [currentDate])
    const weekDays = useMemo(() => Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i)), [weekStart])
    const currentStore = useMemo(() => stores.find(s => String(s.id) === String(selectedStoreId)), [stores, selectedStoreId])
    const storeGuid = currentStore?.external_id

    const [isMobile, setIsMobile] = useState(false)
    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 768)
        checkMobile()
        window.addEventListener('resize', checkMobile)
        return () => window.removeEventListener('resize', checkMobile)
    }, [])

    // TODO: DELETE THIS EFFECT AFTER JUNE 9, 2026 (Expired Clone Modal announcement)
    // Welcome modal check for Clone feature (Active until Tuesday, June 9, 2026)
    useEffect(() => {
        const today = new Date()
        const expirationDate = new Date('2026-06-09T00:00:00') // June 9, 2026
        if (today < expirationDate) {
            setShowWelcomeModal(true)
        }
    }, [])

    // --- HOOKS ---
    const { stats: laborStats, shiftStats } = useWeeklyStats(shifts, employees, jobs)
    const { projections, setProjections, calculateProjections, isGenerating: isCalcProjections } = useSmartProjections(storeGuid, weekStart)
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
                    if (!b.inDate || !b.outDate) return;
                    const start = new Date(b.inDate).getTime();
                    const end = new Date(b.outDate).getTime();
                    const diffMins = (end - start) / 60000;

                    if (b.paid) {
                        if (diffMins >= 13) {
                            violations.push({
                                employeeRef: p.employee_toast_guid,
                                type: 'BRK',
                                allowed: 10,
                                actual: diffMins,
                                date: p.business_date,
                                inDate: b.inDate,
                                outDate: b.outDate,
                                isAnomaly: diffMins >= 60
                            });
                        }
                    } else {
                        if (diffMins >= 33) {
                            violations.push({
                                employeeRef: p.employee_toast_guid,
                                type: 'LUN',
                                allowed: 30,
                                actual: diffMins,
                                date: p.business_date,
                                inDate: b.inDate,
                                outDate: b.outDate,
                                isAnomaly: diffMins >= 60
                            });
                        }
                    }
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

        // 🔒 Pre-check: Si Gmail no está conectado, abrir modal de conexión
        if (!googleConnected) {
            setViolationModal(prev => ({ ...prev, isOpen: false }))
            setIsGmailModalOpen(true)
            toast.error(
                language === 'en'
                    ? 'You must connect your Gmail account first to send notifications. Click "Connect Gmail Now" in the popup.'
                    : 'Debes vincular tu cuenta de Gmail primero para enviar avisos. Haz clic en "Conectar mi Gmail Ahora" en la ventana que se abrió.'
            )
            return;
        }

        setIsSendingViolations(true);
        try {
            const res = await fetch('/api/scheduler/violations/notify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    violations: toSend,
                    userEmail: user?.email,
                    userRole: user?.role,
                    userId: user?.id,
                    storeId: storeGuid
                })
            })

            const resData = await res.json()

            if (!res.ok) {
                if (resData.error && (resData.error.includes('GMAIL_AUTH_FAILED') || resData.error.includes('Gmail'))) {
                   setViolationModal(prev => ({ ...prev, isOpen: false }))
                   setGoogleConnected(false)
                   setGoogleEmail('')
                   setIsGmailModalOpen(true)
                   throw new Error(
                       language === 'en'
                           ? 'Your Gmail connection has expired or was revoked. Please reconnect it to send emails.'
                           : 'Tu conexión a Gmail ha expirado o fue revocada. Por favor, vuelve a conectarlo para enviar los correos.'
                   );
                }
                throw new Error(resData.error || 'Failed to send notifications')
            }

            if (!user?.role?.toLowerCase().includes('admin')) {
                toast.success(resData.message || (language === 'en' ? 'Notifications sent and recorded.' : 'Notificaciones enviadas y guardadas.'))
            }

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

            // 1. Check OAuth Callback in URL
            if (typeof window !== 'undefined') {
                const params = new URLSearchParams(window.location.search)
                const rt = params.get('rt')
                const ge = params.get('ge')

                if (ge) {
                    // SECURITY ENFORCEMENT: System Login Email must match Google Auth Email
                    if (user?.email && ge.toLowerCase() !== user.email.toLowerCase()) {
                        // Alert User
                        // We use a timeout to ensure the toast is seen after redirect (though replace happens fast)
                        // Actually, just show it and return.
                        console.error(`Security Mismatch: System(${user.email}) != Google(${ge})`)
                        toast.error(`⚠️ ACCESO DENEGADO: Debes conectar TU cuenta corporativa (${user.email}).\nNo se permite usar ${ge}.`)

                        // Clear URL and Stop
                        router.replace('/planificador')
                        return
                    }

                    // Update User Profile with new Creds
                    // Note: We only get RT on first consent or re-consent. 
                    // If we have RT, save it. If not, maybe we just got the email (re-login without offline access)
                    const updates: any = { google_email_connected: ge }
                    if (rt) {

                        updates.google_refresh_token = rt
                    } else {

                    }


                    const { error } = await supabase.from('users').update(updates).eq('id', user?.id)

                    if (!error) {

                        toast.success(`Gmail conectado: ${ge}`)
                        setGoogleConnected(true)
                        setGoogleEmail(ge)
                        // Clean URL
                        router.replace('/planificador')
                    } else {
                        console.error('❌ Database Update Failed:', error)
                        toast.error('Error saving DB credentials: ' + error.message)
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
                    // PERSISTENCE LOGIC: Prefer URL -> LocalStorage -> Default
                    const savedStore = searchParams?.get('store') || localStorage.getItem('planner_store')
                    const matchedStore = savedStore ? storesData.find((s: any) => String(s.id) === savedStore || String(s.external_id) === savedStore) : null

                    if (storesData.length === 1) {
                        setSelectedStoreId(String(storesData[0].id))
                    } else if (matchedStore) {
                        setSelectedStoreId(String(matchedStore.id))
                    } else {
                        // Default to Lynwood or first
                        const lynwood = storesData.find((s: any) => s.name.toLowerCase().includes('lynwood'));
                        setSelectedStoreId(String(lynwood ? lynwood.id : storesData[0].id));
                    }
                }
            }

            // DATE PERSISTENCE
            const savedDate = searchParams?.get('date') || localStorage.getItem('planner_date')
            if (savedDate) {
                // Parse YYYY-MM-DD safely forcing noon to avoid TZ shift
                const d = new Date(savedDate + 'T12:00:00')
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

    // --- DATA LOADING ---
    async function loadStoreData() {
        if (!storeGuid) return;

        setSyncing(true)
        const supabase = await getSupabaseClient()
        const startStr = formatDateISO(weekStart)
        const endStr = formatDateISO(addDays(weekStart, 6))

        let filteredEmployees: any[] = []

        // 1. Fetch store employees directly using JSONB contains filter (optimized from 2,200+ global loop)
        const { data: storeEmployees, error: empError } = await supabase
            .from('toast_employees')
            .select('*')
            .contains('store_ids', JSON.stringify([storeGuid]))
            .order('sort_order', { ascending: true })
            .order('first_name', { ascending: true })

        if (empError) {
            console.error('Error fetching store employees:', empError)
        }

        filteredEmployees = storeEmployees || []

        // 2. Fetch Shifts for this store & week
        const { data: shiftData } = await supabase
            .from('shifts')
            .select('*')
            .eq('store_id', storeGuid)
            .gte('shift_date', startStr)
            .lte('shift_date', endStr)

        // 3. Ensure jobs are loaded
        let activeJobs = jobs
        if (activeJobs.length === 0) {
            const { data: jobsData } = await supabase.from('toast_jobs').select('*').order('title')
            if (jobsData) {
                setJobs(jobsData)
                activeJobs = jobsData
            }
        }

        // 4. Fetch actual Toast punches for this store & week
        const { data: punchData } = await supabase
            .from('punches')
            .select('business_date, employee_toast_guid, job_toast_guid, clock_in, clock_out')
            .eq('store_id', storeGuid)
            .gte('business_date', startStr)
            .lte('business_date', endStr)

        // 5. Include any borrowed / cross-store employees who have shifts or punches in this store
        const existingEmpIds = new Set(filteredEmployees.map((e: any) => e.id))
        const existingEmpGuids = new Set(filteredEmployees.map((e: any) => e.toast_guid))

        const missingIds = (shiftData || [])
            .map((s: any) => s.employee_id)
            .filter((id: any) => id && !existingEmpIds.has(id))

        const missingGuids = (punchData || [])
            .map((p: any) => p.employee_toast_guid)
            .filter((guid: any) => guid && !existingEmpGuids.has(guid))

        if (missingIds.length > 0 || missingGuids.length > 0) {
            let missingEmps: any[] = []
            if (missingIds.length > 0) {
                const { data: byId } = await supabase.from('toast_employees').select('*').in('id', missingIds)
                if (byId) missingEmps.push(...byId)
            }
            if (missingGuids.length > 0) {
                const { data: byGuid } = await supabase.from('toast_employees').select('*').in('toast_guid', missingGuids)
                if (byGuid) {
                    byGuid.forEach((b: any) => {
                        if (!missingEmps.some((m: any) => m.id === b.id)) {
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
        setEmployees(filteredEmployees)

        // 6. Auto-detect missing planned shifts from actual Toast punches
        if (shiftData) {
            const missingShifts: any[] = []
            if (punchData && filteredEmployees.length > 0 && activeJobs && activeJobs.length > 0) {
                punchData.forEach((p: any) => {
                    if (!p.employee_toast_guid) return
                    // Find matching employee in our store or borrowed list
                    const emp = filteredEmployees.find((e: any) => e.toast_guid === p.employee_toast_guid)
                    if (!emp) return

                    // Check if shift already exists on this day for this employee
                    const hasShift = shiftData.some((s: any) => s.employee_id === emp.id && s.shift_date === p.business_date)
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
                                store_id: storeGuid,
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

            if (missingShifts.length > 0) {
                isAutoGeneratingRef.current = true
                const { data: insertedShifts, error: insertErr } = await supabase
                    .from('shifts')
                    .insert(missingShifts)
                    .select()

                if (insertErr) {
                    console.error('Error inserting missing shifts:', insertErr)
                } else if (insertedShifts) {
                    shiftData.push(...insertedShifts)
                }
                setTimeout(() => {
                    isAutoGeneratingRef.current = false
                }, 1500)
            }

            setShifts(shiftData)
        }

        setSyncing(false)
    }

    useEffect(() => {
        loadStoreData()
    }, [storeGuid, weekStart])

    // --- REALTIME: Auto-refresh when shifts change (e.g., from self-scheduling) ---
    useEffect(() => {
        if (!storeGuid) return

        let channel: any = null

        const setupRealtime = async () => {
            const supabase = await getSupabaseClient()

            // Subscribe to changes on shifts table for this store
            channel = supabase
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
                        if (isAutoGeneratingRef.current) {
                            // Ignore our own auto-draft inserts to prevent recursive double-loading
                            return
                        }
                        // Reload data when any shift changes
                        loadStoreData()
                    }
                )
                .subscribe()
        }

        setupRealtime()

        // Cleanup on unmount or store change
        return () => {
            if (channel) {
                channel.unsubscribe()
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
                        loadStoreData()

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
        const startStr = formatDateISO(weekStart)
        const endStr = formatDateISO(addDays(weekStart, 6))

        setConfirmModal({
            isOpen: true,
            title: t('planner.modals.smart_gen.title'),
            message: t('planner.modals.smart_gen.message').replace('{store}', currentStore?.name || ''),
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
                            title: t('planner.modals.smart_gen.success_title'),
                            message: t('planner.modals.smart_gen.success_message').replace('{n}', String(data.count)),
                            type: 'success', // Green
                            icon: Bot,
                            onConfirm: () => setConfirmModal((prev: any) => ({ ...prev, isOpen: false }))
                        })
                    } else {
                        toast.error(t('planner.toasts.gen_error') + ': ' + data.error)
                        setConfirmModal((prev: any) => ({ ...prev, isOpen: false }))
                    }
                } catch (e: any) {
                    toast.error(t('planner.toasts.conn_error') + ': ' + e.message)
                    setConfirmModal((prev: any) => ({ ...prev, isOpen: false }))
                } finally {
                    setIsGeneratingAPI(false)
                    // Do NOT auto-close modal here anymore, because success case keeps it open!
                }
            }
        })
    }

    const handleSaveShift = async (shiftData: Shift | Shift[]) => {
        if (!storeGuid) return
        const supabase = await getSupabaseClient()

        // Helper to format payload and calculate shift_date with America/Los_Angeles and 6:00 AM rule
        const formatShiftPayload = (s: Shift) => {
            const payload: any = { ...s, store_id: storeGuid, status: 'draft' }
            if (typeof payload.start_time === 'object') payload.start_time = (payload.start_time as Date).toISOString()
            if (typeof payload.end_time === 'object') payload.end_time = (payload.end_time as Date).toISOString()

            if (payload.start_time) {
                const d = new Date(payload.start_time)
                const laParts = new Intl.DateTimeFormat('en-US', {
                    timeZone: 'America/Los_Angeles',
                    hour12: false,
                    hour: 'numeric',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                }).formatToParts(d)
                const partMap: Record<string, string> = {}
                laParts.forEach(p => partMap[p.type] = p.value)
                const hour = parseInt(partMap.hour, 10)
                const baseDate = new Date(`${partMap.year}-${partMap.month}-${partMap.day}T12:00:00`)
                if (hour < 6) {
                    baseDate.setDate(baseDate.getDate() - 1)
                }
                payload.shift_date = formatDateISO(baseDate)
            }
            return payload
        }

        // BATCH HANDLING: When shiftData is an array of shifts
        if (Array.isArray(shiftData)) {
            if (shiftData.length === 0) return

            // Track any reassignments from published shifts to notify the previous employee
            shiftData.forEach(s => {
                if (s.id) {
                    const existing = shifts.find(prev => prev.id === s.id)
                    if (existing && existing.status === 'published' && existing.employee_id && existing.employee_id !== s.employee_id) {
                        setDeletedPublishedEmpIds(prev => [...new Set([...prev, existing.employee_id!])])
                    }
                }
            })

            // 1. Generate optimistic shifts and apply to UI state
            const optimisticItems: Shift[] = shiftData.map((s, idx) => ({
                ...s,
                id: s.id || `temp-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 6)}`,
                store_id: storeGuid,
                status: 'draft'
            }))

            setShifts(prev => {
                let updated = [...prev]
                optimisticItems.forEach(opt => {
                    const optId = opt.id || ''
                    const isTemp = optId.startsWith('temp-')
                    const matchIdx = updated.findIndex(s => {
                        const sId = s.id || ''
                        if (sId && sId === optId) return true
                        if (isTemp && opt.employee_id && s.employee_id === opt.employee_id && s.shift_date === opt.shift_date) return true
                        return false
                    })
                    if (matchIdx >= 0) updated[matchIdx] = opt
                    else updated.push(opt)
                })
                return updated
            })

            // 2. Separate into updates and inserts
            const toUpdate = optimisticItems.filter(s => s.id && !s.id.startsWith('temp-'))
            const toInsert = optimisticItems.filter(s => !s.id || s.id.startsWith('temp-'))

            try {
                // Execute individual updates
                const updatePromises = toUpdate.map(async (u) => {
                    const payload = formatShiftPayload(u)
                    const shiftId = u.id!
                    delete payload.id
                    return supabase.from('shifts').update(payload).eq('id', shiftId).select().single()
                })

                const updateResults = await Promise.all(updatePromises)

                // Execute batch insert
                let insertedRows: any[] = []
                if (toInsert.length > 0) {
                    const insertPayloads = toInsert.map(i => {
                        const payload = formatShiftPayload(i)
                        delete payload.id
                        return payload
                    })
                    const { data, error } = await supabase.from('shifts').insert(insertPayloads).select()
                    if (error) throw error
                    if (data) insertedRows = data
                }

                const savedRows: any[] = []
                updateResults.forEach(r => { if (r.data) savedRows.push(r.data) })
                if (insertedRows.length > 0) savedRows.push(...insertedRows)

                if (savedRows.length > 0) {
                    setShifts(prev => {
                        let current = [...prev]
                        savedRows.forEach(row => {
                            const matchIdx = current.findIndex(s => {
                                const sId = s.id || ''
                                if (sId && sId === row.id) return true
                                if (sId.startsWith('temp-') && s.employee_id === row.employee_id && s.shift_date === row.shift_date) return true
                                return false
                            })
                            const rowWithDraft = { ...row, status: 'draft' as const }
                            if (matchIdx >= 0) current[matchIdx] = rowWithDraft
                            else current.push(rowWithDraft)
                        })
                        return current
                    })
                    const countMsg = savedRows.length === 1
                        ? t('planner.toasts.shift_saved')
                        : (language === 'en' ? `${savedRows.length} shifts saved` : `${savedRows.length} turnos guardados`)
                    toast.success(countMsg)
                } else {
                    toast.error(t('planner.toasts.shift_save_error'))
                }
            } catch (err: any) {
                toast.error(t('planner.toasts.shift_save_error'))
            }
            return
        }

        // SINGLE SHIFT FLOW
        // If an already published shift changed employee, track previous employee
        if (shiftData.id) {
            const existing = shifts.find(prev => prev.id === shiftData.id)
            if (existing && existing.status === 'published' && existing.employee_id && existing.employee_id !== shiftData.employee_id) {
                setDeletedPublishedEmpIds(prev => [...new Set([...prev, existing.employee_id!])])
            }
        }

        const tempId = shiftData.id || `temp-${Date.now()}`
        const optimisticShift: Shift = { ...shiftData, id: tempId, store_id: storeGuid, status: 'draft' }

        if (shiftData.id) setShifts(prev => prev.map(s => s.id === shiftData.id ? optimisticShift : s))
        else setShifts(prev => [...prev, optimisticShift])

        const payload = formatShiftPayload(shiftData)
        delete payload.id

        let result;
        if (shiftData.id && !shiftData.id.startsWith('temp-')) {
            result = await supabase.from('shifts').update(payload).eq('id', shiftData.id).select().single()
        } else {
            result = await supabase.from('shifts').insert(payload).select().single()
        }

        if (result.data) {
            setShifts(prev => prev.map(s => s.id === tempId || s.id === result.data.id ? { ...result.data, status: 'draft' } : s))
            toast.success(t('planner.toasts.shift_saved'))
        } else {
            toast.error(t('planner.toasts.shift_save_error'))
        }
    }

    const handleDeleteShift = async (id: string) => {
        const supabase = await getSupabaseClient()
        const shiftToDelete = shifts.find(s => s.id === id)

        // Track if we are deleting a published shift to enable re-publish
        if (shiftToDelete?.status === 'published' && shiftToDelete.employee_id) {
            setDeletedPublishedEmpIds(prev => [...new Set([...prev, shiftToDelete.employee_id!])])
        }

        setShifts(prev => prev.filter(s => s.id !== id))
        await supabase.from('shifts').delete().eq('id', id)
        toast.success(t('planner.toasts.shift_deleted'))
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

                    const startStr = formatDateISO(weekStart)
                    const endStr = formatDateISO(addDays(weekStart, 6))

                    // Nuclear delete for the specific range before applying template
                    // Similar to clear-week API but we can do it here if we want to trust client id
                    // Or call the API? Let's stick to client for templates as it's usually smaller than 1000 items
                    // Actually, let's be safe and use loop if needed, but template application is destructive
                    // The clear-week API is safer.
                    const clearRes = await fetch('/api/scheduler/clear-week', {
                        method: 'POST',
                        body: JSON.stringify({ storeId: storeGuid, startDate: startStr, endDate: endStr })
                    })
                    if (!clearRes.ok) throw new Error('Failed to clear existing shifts')

                    // Prepare new shifts
                    const newShifts: any[] = []

                    for (const item of items) {
                        // Calculate date based on weekStart + item.day_of_week
                        // item.day_of_week is 0 (Mon) to 6 (Sun) or similar.
                        // My formatDateISO uses Monday as start?
                        // Let's assume weekStart is Monday.
                        const targetDate = addDays(weekStart, item.day_of_week)
                        const dateStr = formatDateISO(targetDate)

                        // Construct full ISO strings
                        const startDateTime = new Date(`${dateStr}T${item.start_time}`)
                        const endDateTime = new Date(`${dateStr}T${item.end_time}`)

                        // Handle overnight
                        if (endDateTime < startDateTime) {
                            endDateTime.setDate(endDateTime.getDate() + 1)
                        }

                        newShifts.push({
                            employee_id: item.employee_id,
                            job_id: item.job_id,
                            store_id: storeGuid,
                            start_time: startDateTime.toISOString(),
                            end_time: endDateTime.toISOString(),
                            shift_date: dateStr,
                            is_open: item.is_open,
                            status: 'draft'
                        })
                    }

                    const { error } = await supabase.from('shifts').insert(newShifts)
                    if (error) throw error

                    toast.success(t('planner.toasts.template_applied'))
                    setShowTemplateModal(false)
                    await loadStoreData()

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

            const targetStartStr = formatDateISO(weekStart)
            const targetEndStr = formatDateISO(addDays(weekStart, 6))

            // 2. If overwrite mode is true, clear current target week shifts first
            if (overwrite) {
                const clearRes = await fetch('/api/scheduler/clear-week', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ storeId: storeGuid, startDate: targetStartStr, endDate: targetEndStr })
                })
                if (!clearRes.ok) throw new Error('Failed to clear current week shifts')
            }

            // 3. Map shifts to the target week preserving exact days difference (handles overnight / midnight shifts)
            const daysDiff = Math.round((weekStart.getTime() - sourceWeekStart.getTime()) / (24 * 3600 * 1000))

            const newShifts = validSourceShifts.map((s: any) => {
                const origStart = new Date(s.start_time)
                const origEnd = new Date(s.end_time)
                const duration = origEnd.getTime() - origStart.getTime()

                const newStart = addDays(origStart, daysDiff)
                const newEnd = new Date(newStart.getTime() + duration)

                // Shift the business date exactly by daysDiff
                const [origY, origM, origD] = s.shift_date.split('-').map(Number)
                const origBusinessDate = new Date(origY, origM - 1, origD, 12, 0, 0)
                const targetBusinessDate = addDays(origBusinessDate, daysDiff)
                const dateStr = formatDateISO(targetBusinessDate)

                // Shift breaks_schedule timestamps forward by daysDiff if present
                let newBreaks = null
                if (Array.isArray(s.breaks_schedule) && s.breaks_schedule.length > 0) {
                    newBreaks = s.breaks_schedule.map((b: any) => {
                        if (!b) return b
                        const shiftedBreak: any = { ...b }
                        if (b.start) shiftedBreak.start = addDays(new Date(b.start), daysDiff).toISOString()
                        if (b.end) shiftedBreak.end = addDays(new Date(b.end), daysDiff).toISOString()
                        if (b.inDate) shiftedBreak.inDate = addDays(new Date(b.inDate), daysDiff).toISOString()
                        if (b.outDate) shiftedBreak.outDate = addDays(new Date(b.outDate), daysDiff).toISOString()
                        return shiftedBreak
                    })
                }

                return {
                    employee_id: s.employee_id,
                    job_id: s.job_id,
                    store_id: storeGuid,
                    start_time: newStart.toISOString(),
                    end_time: newEnd.toISOString(),
                    shift_date: dateStr,
                    is_open: s.is_open,
                    notes: s.notes || null,
                    breaks_schedule: newBreaks,
                    status: 'draft'
                }
            })

            // 4. Insert new shifts
            const { error: insertErr } = await supabase.from('shifts').insert(newShifts)
            if (insertErr) throw insertErr

            // 5. Reload data and notify success
            await loadStoreData()
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
                    const res = await fetch('/api/scheduler/clear-week', {
                        method: 'POST',
                        body: JSON.stringify({ storeId: storeGuid, startDate: startStr, endDate: endStr })
                    })

                    if (!res.ok) throw new Error('Failed to clear shifts')

                    setShifts([]) // Clear client state completely

                    setShifts([]) // Clear client state completely

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

            const notifyRes = await fetch('/api/notifications/publish-schedule', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
                    // Update state to disconnected and force modal
                    setGoogleConnected(false)
                    setGoogleEmail('')
                    setIsGmailModalOpen(true)
                    throw new Error(t('planner.toasts.gmail_auth_failed') || 'Tu conexión a Gmail ha expirado o fue revocada. Por favor, vuelve a conectarlo para enviar los correos.')
                }
                throw new Error(notifyData.error || 'Error sending notifications')
            }

            // ONLY mark shifts as published in database after notification succeeds
            if (ids.length > 0) {
                await supabase.from('shifts').update({ status: 'published' }).in('id', ids)
                setShifts(prev => prev.map(s => ids.includes(s.id) ? { ...s, status: 'published' } : s))
            }

            // SAVE BUDGET SNAPSHOT
            // 🛡️ VALIDATION: Ensure projections have all 7 days before saving
            const requiredDates: string[] = []
            for (let i = 0; i < 7; i++) {
                const d = addDays(weekStart, i)
                requiredDates.push(formatDateISO(d))
            }

            const missingDates = requiredDates.filter(d => !projections[d] || Number(projections[d]) <= 0)
            let finalProjections = { ...projections }

            if (missingDates.length > 0) {


                // Attempt to regenerate missing projections
                try {
                    const freshProjections = await calculateProjections()
                    if (freshProjections && Object.keys(freshProjections).length > 0) {
                        // Merge: existing overwrites fresh (keep user edits)
                        finalProjections = { ...freshProjections, ...projections }

                    }
                } catch (regenError) {
                    console.error('❌ Failed to regenerate projections:', regenError)
                }

                // Re-check after regeneration
                const stillMissing = requiredDates.filter(d => !finalProjections[d] || Number(finalProjections[d]) <= 0)
                if (stillMissing.length > 0) {

                    toast.info(t('planner.toasts.projections_incomplete') || `Warning: Projections incomplete for ${stillMissing.length} day(s)`)
                }
            }



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
        if (!draggedShift || !storeGuid) return
        const isCopy = isCtrlPressed
        const supabase = await getSupabaseClient()
        const duration = new Date(draggedShift.end_time).getTime() - new Date(draggedShift.start_time).getTime()
        const targetDateStr = formatDateISO(targetDate)

        const origStart = new Date(draggedShift.start_time)
        const newStart = new Date(targetDate)
        newStart.setHours(origStart.getHours(), origStart.getMinutes(), 0, 0)
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
            // Move: If previously published shift changed employee, track previous employee
            if (draggedShift?.status === 'published' && draggedShift.employee_id && draggedShift.employee_id !== targetEmpId) {
                setDeletedPublishedEmpIds(prev => [...new Set([...prev, draggedShift.employee_id!])])
            }
            setShifts(prev => prev.map(s => s.id === draggedShift.id ? { ...s, ...payload, id: s.id } : s))
            const { data } = await supabase.from('shifts').update(payload).eq('id', draggedShift.id).select().single()
            if (data) setShifts(prev => prev.map(s => s.id === data.id ? data : s))
        }
        setDraggedShift(null)
    }

    // Keyboard
    useEffect(() => {
        const down = (e: KeyboardEvent) => (e.ctrlKey || e.shiftKey || e.metaKey) && setIsCtrlPressed(true)
        const up = () => setIsCtrlPressed(false)
        window.addEventListener('keydown', down); window.addEventListener('keyup', up)
        return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
    }, [])

    const handleCloseWelcomeModal = () => {
        setShowWelcomeModal(false)
    }

    if (loading) return <SurpriseLoader loadingText={t('planner.loading')} syncingText={t('planner.syncing_toast')} />

    return (
        <div className="grid grid-rows-[auto_auto_1fr] h-[calc(100vh-140px)] sm:h-[calc(100vh-95px)] bg-gray-50 dark:bg-slate-950 overflow-hidden">
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
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden relative">
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

            <AnimatePresence>
                {isToolbarVisible && (
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
            <div className="flex-1 overflow-hidden relative">
                {isMobile ? (
                    <MobilePlannerView
                        shifts={shifts}
                        employees={visibleEmployees}
                        jobs={jobs}
                        weekDays={weekDays}
                        shiftStats={shiftStats}
                        laborStats={dailyLaborStats}
                        projections={projections}
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
                                                    .filter(s => s.shift_date === dateStr && s.employee_id)
                                                    .map(s => s.employee_id)
                                            ).size
                                            const isToday = [date.getDate(), date.getMonth()].join('-') === [new Date().getDate(), new Date().getMonth()].join('-')

                                            return (
                                                <th key={i} className={`p-3 border-l border-gray-200 dark:border-slate-800 align-top transition-colors bg-gray-50 dark:bg-slate-900 ${isToday ? 'bg-blue-50/50 dark:bg-slate-800 relative overflow-hidden' : ''}`}>
                                                    {isToday && <div className="absolute top-0 left-0 w-full h-0.5 bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]" />}
                                                    <div className="flex flex-col h-full min-h-[60px]">
                                                        <div className="flex justify-between items-start mb-2 gap-2">
                                                            <div className="text-left">
                                                                <div className={`text-base font-black leading-tight tracking-tight ${isToday ? 'text-blue-600 dark:text-blue-400' : 'text-gray-900 dark:text-slate-200'}`}>
                                                                    {[t('planner.days.sun'), t('planner.days.mon'), t('planner.days.tue'), t('planner.days.wed'), t('planner.days.thu'), t('planner.days.fri'), t('planner.days.sat')][date.getDay()]}
                                                                </div>
                                                                <div className={`text-xs font-bold capitalize mt-0.5 ${isToday ? 'text-blue-600/80 dark:text-blue-400/80' : 'text-gray-400 dark:text-slate-500'}`}>
                                                                    {date.toLocaleString(language === 'en' ? 'en-US' : 'es-US', { month: 'short' }).replace('.', '')} {date.getDate()}
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
                                <Reorder.Group as="tbody" axis="y" values={employees} onReorder={handleReorder}>
                                    {visibleEmployees.map(emp => (
                                        <EmployeeRow
                                            key={emp.id}
                                            emp={emp}
                                            totals={laborStats[emp.id]}
                                            weekDays={weekDays}
                                            getShiftsForCell={(id: string | null, d: Date) => shifts.filter(s => (s.employee_id === id) && s.shift_date === formatDateISO(d))}
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
                                actuals={actuals}
                                storeId={storeGuid}
                                onRefresh={refetchActuals}
                                onCalculateProjections={() => calculateProjections(true)}
                                isExternalLoading={loadingActuals || isCalcProjections}
                                onShowSalesDetail={(date: string) => setSalesDetailModal({ isOpen: true, date })}
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
                        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4"
                    >
                        <motion.div
                            initial={{ scale: 0.9, y: 50, opacity: 0 }}
                            animate={{ scale: 1, y: 0, opacity: 1 }}
                            exit={{ scale: 0.9, y: 50, opacity: 0 }}
                            className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-xl shadow-2xl border-2 border-amber-500/80 overflow-hidden"
                        >
                            {/* Modal Header */}
                            <div className="bg-gradient-to-r from-amber-600 via-orange-600 to-red-600 p-6 text-center text-white relative">
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

                            <div className="p-6 max-h-[55vh] overflow-y-auto custom-scrollbar">
                                {/* ⏰ AVISO CLAVE PARA EL MANAGER: CORRECCIÓN EN TOAST ANTES DE LAS 11:59 AM */}
                                <div className="bg-amber-50 dark:bg-amber-950/40 border-2 border-amber-300 dark:border-amber-700/60 rounded-2xl p-4 mb-5 shadow-sm">
                                    <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200 font-extrabold text-xs uppercase tracking-wide">
                                        <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400" />
                                        {language === 'en' ? 'Manager Notice: Toast Correction Window' : 'Aviso a Gerencia: Ventana de Corrección en TOAST'}
                                    </div>
                                    <p className="text-xs text-amber-800 dark:text-amber-300 mt-1.5 leading-relaxed font-medium">
                                        {language === 'en'
                                            ? 'The system detected the following punch anomalies and exceeded break times. You have until 11:59 AM to review and correct any punch mistakes in TOAST POS. At 11:59 AM, the system will automatically dispatch official notification emails to employees.'
                                            : 'El sistema detectó las siguientes anomalías y tiempos excedidos en las ponchadas de ayer. Tienes hasta las 11:59 AM para revisar y corregir cualquier error de ponchada en TOAST POS. A las 11:59 AM, el sistema enviará automáticamente los avisos oficiales a los empleados.'}
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
                            <div className="p-4 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-3">
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
