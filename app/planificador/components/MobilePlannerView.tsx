/**
 * @module app/planificador/components/MobilePlannerView
 * @description Mobile-optimized schedule planner command center for Tacos Gavilan restaurant managers,
 * supervisors, and planners on smartphones and tablets (< 1024px / < lg).
 * Features built-in store & week navigation, 3 dedicated views (`Por Día` | `Semana` | `Budget`),
 * a Team Send & Share Hub (`Enviar y Compartir Horarios`), individual employee official `.ics` email
 * dispatch, pre-filled WhatsApp & SMS schedule sharing, PDF/Print sheet launch, 1-tap quick presets,
 * split-shift & open-shift rendering, and Toast POS punch/break compliance overlays.
 *
 * @businessRules
 * - Workday starts at 6:00 AM and ends at 5:59 AM next day in `America/Los_Angeles`.
 * - PM shift starts at 5:00 PM (`17:00`) per corporate standard.
 * - Corporate labor cost target for Tacos Gavilan is strictly < 21.5%.
 * - Individual & team shift durations use `shiftStats[id]?.duration` (NOT `.totalHours`) with ISO timestamp fallback.
 * - Full bilingual support (Spanish and English) via useLanguage().
 *
 * @dataFlow
 * Planificador page props -> MobilePlannerView (Daily / Team Week / Budget tabs) -> Bottom Sheets -> API / Native Share / Toast
 *
 * @notes
 * - Completely refactored to support effortless viewing AND sending of schedules on 360px-430px screens.
 * - All bottom sheets sit at z-[120] with safe-area-inset-bottom padding above BottomTabBar (z-50).
 * - Synced default weekday index uses render-time week-key tracking (React Compiler safe, zero setState in useEffect).
 */

'use client'

import React, { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
    Users,
    Clock,
    ChevronRight,
    ChevronLeft,
    AlertCircle,
    Plus,
    RefreshCcw,
    Bot,
    BarChart3,
    Search,
    Copy,
    Zap,
    Trash2,
    CheckCircle2,
    X,
    Sliders,
    Coffee,
    Sun,
    Utensils,
    Moon,
    Lock,
    Settings,
    MoreVertical,
    Phone,
    Mail,
    MessageSquare,
    CalendarDays,
    Send,
    Share2,
    Printer,
    LayoutTemplate,
    Loader2
} from 'lucide-react'
import {
    formatDateISO,
    formatTime12h,
    stringToColor,
    addDays,
    formatDateNice,
    formatStoreName,
    getBusinessTodayISO,
    getLAHoursMinutes,
    formatPhoneForWhatsApp,
    buildEmployeeScheduleText,
    buildTeamScheduleText
} from '../lib/utils'
import { useLanguage } from '@/lib/i18n'
import Link from 'next/link'

interface MobilePlannerViewProps {
    shifts: any[]
    employees: any[]
    jobs: any[]
    weekDays: Date[]
    shiftStats: Record<string, any>
    laborStats: Record<string, any>
    projections: Record<string, any>
    actuals: Record<string, any>
    punches?: any[]
    currentDate?: Date
    onDateChange?: (date: Date) => void
    weekStart?: Date
    onEditShift: (shift: any, date: Date, empId: string) => void
    onAddShift: (date: Date, empId: string) => void
    onSaveShift?: (shift: any) => Promise<void>
    onDeleteShift?: (id: string) => Promise<void>
    onShowSalesDetail: (date: string) => void
    onRefresh: () => void
    onCalculateProjections: () => void
    isExternalLoading?: boolean
    onCloneClick?: () => void
    onSyncToast?: () => void
    isSyncingEmployees?: boolean
    onGenerateSmart?: () => void
    isGeneratingAPI?: boolean
    draftCount?: number
    onPublish?: () => void
    storeName?: string
    stores?: any[]
    selectedStoreId?: string
    onStoreChange?: (id: string) => void
    storeGuid?: string
    googleConnected?: boolean
    googleEmail?: string
    onConnectGmail?: () => void
    totalShiftsCount?: number
    weeklyEmpStats?: Record<string, any>
    onSendEmployeeSchedule?: (empId: string) => Promise<boolean>
    sendingEmpId?: string | null
    onOpenTemplates?: () => void
    onPrint?: () => void
    onClearWeek?: () => void
    weather?: Record<string, any>
    canEdit?: boolean
}

const normalizeSearch = (str: string) =>
    (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

const formatCompactTime = (iso: string) => {
    const { hour, minute } = getLAHoursMinutes(iso)
    const ampm = hour >= 12 ? 'p' : 'a'
    const h12 = hour % 12 || 12
    return minute === 0 ? `${h12}${ampm}` : `${h12}:${String(minute).padStart(2, '0')}${ampm}`
}

const getReadableBadgeProps = (hexColor: string): { className?: string; style?: React.CSSProperties } => {
    const clean = (hexColor || '').replace('#', '')
    if (clean.length === 6) {
        const r = parseInt(clean.slice(0, 2), 16)
        const g = parseInt(clean.slice(2, 4), 16)
        const b = parseInt(clean.slice(4, 6), 16)
        const luma = 0.299 * r + 0.587 * g + 0.114 * b
        if (luma < 75) {
            return {
                className: 'bg-slate-200 text-slate-900 border-slate-300 dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600'
            }
        }
    }
    return {
        style: { color: hexColor, borderColor: `${hexColor}45`, backgroundColor: `${hexColor}16` }
    }
}

export function MobilePlannerView({
    shifts,
    employees,
    jobs,
    weekDays,
    shiftStats,
    laborStats,
    projections,
    actuals,
    punches = [],
    currentDate,
    onDateChange,
    weekStart,
    onEditShift,
    onAddShift,
    onSaveShift,
    onDeleteShift,
    onShowSalesDetail,
    onRefresh,
    onCalculateProjections,
    isExternalLoading,
    onCloneClick,
    onSyncToast,
    isSyncingEmployees,
    onGenerateSmart,
    isGeneratingAPI,
    draftCount = 0,
    onPublish,
    storeName,
    stores = [],
    selectedStoreId = '',
    onStoreChange,
    storeGuid,
    googleConnected = false,
    googleEmail = '',
    onConnectGmail,
    totalShiftsCount = 0,
    weeklyEmpStats = {},
    onSendEmployeeSchedule,
    sendingEmpId = null,
    onOpenTemplates,
    onPrint,
    onClearWeek,
    weather = {},
    canEdit = true
}: MobilePlannerViewProps) {
    const { t, language } = useLanguage()
    const locale = language === 'en' ? 'en-US' : 'es-ES'

    // Active View Mode
    const [activeTab, setActiveTab] = useState<'daily' | 'team_week' | 'weekly'>('daily')

    // Business-Today Synced Day Index (React Compiler safe: render-time weekKey reset, zero setState in useEffect)
    const weekStartSafe = weekStart || weekDays[0] || new Date()
    const weekKey = formatDateISO(weekStartSafe)
    const businessTodayISO = getBusinessTodayISO()
    const defaultDayIndex = useMemo(() => {
        const idx = weekDays.findIndex(d => formatDateISO(d) === businessTodayISO)
        return idx >= 0 ? idx : 0
    }, [weekDays, businessTodayISO])

    const [daySelection, setDaySelection] = useState<{ weekKey: string; index: number }>(() => ({
        weekKey,
        index: defaultDayIndex
    }))
    const selectedDateIndex = daySelection.weekKey === weekKey ? daySelection.index : defaultDayIndex
    const setSelectedDateIndex = (index: number) => setDaySelection({ weekKey, index })

    const selectedDate = weekDays[selectedDateIndex] || weekDays[0] || new Date()
    const dateStr = formatDateISO(selectedDate)

    // Filters & Search
    const [filterStatus, setFilterStatus] = useState<'all' | 'scheduled' | 'available'>('all')
    const [selectedRole, setSelectedRole] = useState<string>('all')
    const [searchQuery, setSearchQuery] = useState<string>('')
    const [teamSearchQuery, setTeamSearchQuery] = useState<string>('')
    const [showOffInTeamWeek, setShowOffInTeamWeek] = useState<boolean>(false)

    // Mobile Bottom Sheets & Drawers
    const [selectedEmployeeForPreset, setSelectedEmployeeForPreset] = useState<any | null>(null)
    const [selectedShiftForActions, setSelectedShiftForActions] = useState<{ shift: any; employee: any } | null>(null)
    const [selectedEmployeeForContact, setSelectedEmployeeForContact] = useState<any | null>(null)
    const [isSendHubOpen, setIsSendHubOpen] = useState(false)
    const [isToolsDrawerOpen, setIsToolsDrawerOpen] = useState(false)

    // Floating Native Mobile Toast Notification
    const [mobileToast, setMobileToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
    const showToast = (message: string, type: 'success' | 'error' = 'success') => {
        setMobileToast({ message, type })
        setTimeout(() => {
            setMobileToast(prev => prev?.message === message ? null : prev)
        }, 3200)
    }

    // Shift Duration Helper (fixes 0.0h / fake 8.0h bug by reading `.duration`, NOT `.totalHours` on `shiftStats`)
    const getShiftHours = (shift: any): number => {
        const statDur = shift?.id ? shiftStats[shift.id]?.duration : undefined
        if (typeof statDur === 'number' && !Number.isNaN(statDur)) return statDur
        if (shift?.start_time && shift?.end_time) {
            const diffMs = new Date(shift.end_time).getTime() - new Date(shift.start_time).getTime()
            if (diffMs > 0) return diffMs / 3600000
        }
        return 0
    }

    const getEmpWeeklyHours = (empId: any): number => {
        const statTotal = weeklyEmpStats?.[empId]?.totalHours
        if (typeof statTotal === 'number' && !Number.isNaN(statTotal)) return statTotal
        return shifts
            .filter(s => String(s.employee_id) === String(empId))
            .reduce((acc, s) => acc + getShiftHours(s), 0)
    }

    // Resolve Employee Primary Role Title
    const getEmployeeJobTitle = (emp: any): string => {
        const jobGuid = emp.job_references?.[0]?.guid
        const job = jobs.find(j => j.guid === jobGuid)
        return job?.title || 'Team Member'
    }

    // Week date range text
    const weekEndSafe = addDays(weekStartSafe, 6)
    const weekRangeLabel = `${formatDateNice(weekStartSafe, locale)} - ${formatDateNice(weekEndSafe, locale)}, ${weekStartSafe.getFullYear()}`

    // Shifts for selected day
    const dayShifts = useMemo(() => {
        return shifts.filter(s => s.shift_date === dateStr)
    }, [shifts, dateStr])

    const openDayShifts = useMemo(() => {
        return dayShifts.filter(s => !s.employee_id || s.is_open)
    }, [dayShifts])

    // Day metrics
    const dayProjections = parseFloat(projections[dateStr] || '0')
    const dayActuals = actuals[dateStr]?.sales || 0
    const daySchedStats = laborStats[dateStr] || { cost: 0, hours: 0 }
    const dayActStats = actuals[dateStr]?.labor || { cost: 0, hours: 0 }

    const laborPctProj = dayProjections > 0 ? (daySchedStats.cost / dayProjections) * 100 : 0
    const laborPctAct = dayActuals > 0 ? (dayActStats.cost / dayActuals) * 100 : (dayProjections > 0 ? (dayActStats.cost / dayProjections) * 100 : 0)

    // Scheduled vs Available Counts
    const scheduledEmpIdSet = useMemo(() => {
        return new Set(dayShifts.filter(s => s.employee_id).map(s => String(s.employee_id)))
    }, [dayShifts])

    const weekScheduledEmpIdSet = useMemo(() => {
        return new Set(shifts.filter(s => s.employee_id).map(s => String(s.employee_id)))
    }, [shifts])

    const totalEmployeesCount = employees.length
    const scheduledEmployeesCount = useMemo(() => {
        return employees.filter(emp => scheduledEmpIdSet.has(String(emp.id))).length
    }, [employees, scheduledEmpIdSet])
    const availableEmployeesCount = totalEmployeesCount - scheduledEmployeesCount

    // Unique Job Roles for dropdown filter
    const availableJobRoles = useMemo(() => {
        const rolesSet = new Set<string>()
        employees.forEach(emp => {
            const jobGuid = emp.job_references?.[0]?.guid
            const job = jobs.find(j => j.guid === jobGuid)
            if (job?.title) rolesSet.add(job.title)
        })
        return Array.from(rolesSet).sort()
    }, [employees, jobs])

    // Filtered Employees List (Tab 1: Daily)
    const filteredEmployees = useMemo(() => {
        const normQuery = normalizeSearch(searchQuery)
        return employees.filter(emp => {
            const isScheduled = scheduledEmpIdSet.has(String(emp.id))
            if (filterStatus === 'scheduled' && !isScheduled) return false
            if (filterStatus === 'available' && isScheduled) return false

            const jobTitle = getEmployeeJobTitle(emp)
            if (selectedRole !== 'all' && jobTitle !== selectedRole) return false

            if (normQuery) {
                const fullName = normalizeSearch(`${emp.chosen_name || emp.first_name} ${emp.last_name}`)
                const normJob = normalizeSearch(jobTitle)
                if (!fullName.includes(normQuery) && !normJob.includes(normQuery)) return false
            }

            return true
        })
    }, [employees, scheduledEmpIdSet, filterStatus, selectedRole, searchQuery, jobs])

    // Filtered Employees List (Tab 2: Team Week)
    const teamWeekEmployees = useMemo(() => {
        const normQuery = normalizeSearch(teamSearchQuery)
        return employees.filter(emp => {
            const hasWeekShift = weekScheduledEmpIdSet.has(String(emp.id))
            if (!showOffInTeamWeek && !hasWeekShift) return false
            if (normQuery) {
                const fullName = normalizeSearch(`${emp.chosen_name || emp.first_name} ${emp.last_name}`)
                const normJob = normalizeSearch(getEmployeeJobTitle(emp))
                if (!fullName.includes(normQuery) && !normJob.includes(normQuery)) return false
            }
            return true
        })
    }, [employees, weekScheduledEmpIdSet, showOffInTeamWeek, teamSearchQuery, jobs])

    // Weekly Budget Stats Calc
    const weeklyStats = useMemo(() => {
        let totalProjSales = 0
        let totalActualSales = 0
        let totalHoursSched = 0
        let totalCostSched = 0
        let totalHoursAct = 0
        let totalCostAct = 0

        weekDays.forEach(day => {
            const dStr = formatDateISO(day)
            totalProjSales += parseFloat(projections[dStr] || '0')
            totalActualSales += actuals[dStr]?.sales || 0

            const sched = laborStats[dStr]
            if (sched) {
                totalHoursSched += sched.hours || 0
                totalCostSched += sched.cost || 0
            }

            const act = actuals[dStr]?.labor
            if (act) {
                totalHoursAct += act.hours || 0
                totalCostAct += act.cost || 0
            }
        })

        const totalLaborPctProj = totalProjSales > 0 ? (totalCostSched / totalProjSales) * 100 : 0
        const totalLaborPctAct = totalActualSales > 0
            ? (totalCostAct / totalActualSales) * 100
            : (totalProjSales > 0 ? (totalCostAct / totalProjSales) * 100 : 0)

        return {
            totalProjSales,
            totalActualSales,
            totalHoursSched,
            totalCostSched,
            totalHoursAct,
            totalCostAct,
            totalLaborPctProj,
            totalLaborPctAct
        }
    }, [projections, actuals, laborStats, weekDays])

    // Handler: Jump to Today (updates week AND LA business weekday index)
    const handleJumpToday = () => {
        const now = new Date()
        onDateChange?.(now)
        const targetISO = getBusinessTodayISO(now)
        const idx = weekDays.findIndex(d => formatDateISO(d) === targetISO)
        if (idx >= 0) setSelectedDateIndex(idx)
    }

    // Handler: 1-Tap Quick Preset Assignment
    const handleApplyPreset = async (presetType: 'apertura' | 'medio' | 'turno_pm' | 'cierre') => {
        if (!selectedEmployeeForPreset || !onSaveShift || !canEdit) return

        const emp = selectedEmployeeForPreset
        const defaultJobGuid = emp.job_references?.[0]?.guid
        const matchedJob = jobs.find(j => j.guid === defaultJobGuid) || jobs[0]
        const jobId = matchedJob?.id || ''

        let startHour = 7
        let startMin = 0
        let endHour = 15
        let endMin = 30
        let isOvernight = false

        if (presetType === 'medio') {
            startHour = 11
            startMin = 0
            endHour = 19
            endMin = 30
        } else if (presetType === 'turno_pm') {
            startHour = 17
            startMin = 0
            endHour = 1
            endMin = 30
            isOvernight = true
        } else if (presetType === 'cierre') {
            startHour = 16
            startMin = 0
            endHour = 0
            endMin = 30
            isOvernight = true
        }

        const start = new Date(selectedDate)
        start.setHours(startHour, startMin, 0, 0)

        const end = new Date(selectedDate)
        if (isOvernight) end.setDate(end.getDate() + 1)
        end.setHours(endHour, endMin, 0, 0)

        const shiftPayload = {
            employee_id: emp.id,
            job_id: jobId,
            start_time: start.toISOString(),
            end_time: end.toISOString(),
            is_open: false,
            notes: '',
            status: 'draft'
        }

        try {
            await onSaveShift(shiftPayload)
            showToast(t('planner.toasts.shift_saved'))
        } catch {
            showToast(t('planner.toasts.shift_save_error'), 'error')
        } finally {
            setSelectedEmployeeForPreset(null)
        }
    }

    // Handler: Duplicate Shift to Next Day (protected against duplicates!)
    const handleDuplicateToNextDay = async () => {
        if (!selectedShiftForActions || !onSaveShift || !canEdit) return
        const { shift } = selectedShiftForActions

        try {
            const nextDayDate = addDays(selectedDate, 1)
            const nextDayStr = formatDateISO(nextDayDate)

            if (shift.employee_id) {
                const existingTomorrow = shifts.find(
                    s => String(s.employee_id) === String(shift.employee_id) && s.shift_date === nextDayStr
                )
                if (existingTomorrow) {
                    const existingRange = `${formatTime12h(existingTomorrow.start_time)} - ${formatTime12h(existingTomorrow.end_time)}`
                    showToast(t('planner.mobile.already_has_shift_tomorrow').replace('{time}', existingRange), 'error')
                    setSelectedShiftForActions(null)
                    return
                }
            }

            const originalStart = new Date(shift.start_time)
            const originalEnd = new Date(shift.end_time)
            const durationMs = Math.max(0, originalEnd.getTime() - originalStart.getTime())
            const { hour: startH, minute: startM } = getLAHoursMinutes(shift.start_time)

            const newStart = new Date(nextDayDate)
            newStart.setHours(startH, startM, 0, 0)
            const newEnd = new Date(newStart.getTime() + durationMs)

            const duplicatePayload = {
                employee_id: shift.employee_id,
                job_id: shift.job_id,
                start_time: newStart.toISOString(),
                end_time: newEnd.toISOString(),
                is_open: shift.is_open || false,
                notes: shift.notes || '',
                status: 'draft'
            }

            await onSaveShift(duplicatePayload)
            showToast(t('planner.mobile.duplicate_success'))
        } catch {
            showToast(t('planner.mobile.duplicate_error'), 'error')
        } finally {
            setSelectedShiftForActions(null)
        }
    }

    // Handler: Delete Shift from Action Sheet
    const handleDeleteCurrentShift = async () => {
        if (!selectedShiftForActions || !onDeleteShift || !canEdit) return
        const { shift } = selectedShiftForActions

        try {
            await onDeleteShift(shift.id)
            showToast(t('planner.toasts.shift_deleted'))
        } catch {
            showToast(t('planner.toasts.shift_save_error'), 'error')
        } finally {
            setSelectedShiftForActions(null)
        }
    }

    // Share / Copy Helpers (Employee & Team)
    const getEmployeeMessageText = (emp: any) => {
        const empWeekShifts = shifts.filter(s => String(s.employee_id) === String(emp.id))
        const empName = `${emp.chosen_name || emp.first_name} ${emp.last_name}`.trim()
        return buildEmployeeScheduleText({
            empName,
            storeName: formatStoreName(storeName || 'Tacos Gavilan'),
            weekDays,
            shifts: empWeekShifts,
            jobs,
            shiftStats,
            weeklyHours: getEmpWeeklyHours(emp.id),
            language
        })
    }

    const handleShareWhatsAppEmployee = (emp: any) => {
        const waPhone = formatPhoneForWhatsApp(emp.phone)
        if (!waPhone) {
            showToast(t('planner.mobile.no_phone_whatsapp'), 'error')
            return
        }
        const text = getEmployeeMessageText(emp)
        window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer')
    }

    const handleShareSMSEmployee = (emp: any) => {
        const rawDigits = (emp.phone || '').replace(/[^\d+]/g, '')
        if (!rawDigits) {
            showToast(t('planner.mobile.no_phone'), 'error')
            return
        }
        const text = getEmployeeMessageText(emp)
        window.location.href = `sms:${rawDigits}?&body=${encodeURIComponent(text)}`
    }

    const handleCopyOrShareText = async (text: string, allowNativeShare = false) => {
        if (allowNativeShare && typeof navigator !== 'undefined' && navigator.share) {
            try {
                await navigator.share({
                    title: formatStoreName(storeName || 'Tacos Gavilan'),
                    text
                })
                return
            } catch {
                // Fall back to clipboard if share cancelled/unsupported
            }
        }
        try {
            if (typeof navigator !== 'undefined' && navigator.clipboard) {
                await navigator.clipboard.writeText(text)
                showToast(t('planner.mobile.copied_schedule'))
            }
        } catch {
            showToast(t('planner.toasts.conn_error'), 'error')
        }
    }

    const handleShareTeamWhatsApp = () => {
        const msg = buildTeamScheduleText({
            storeName: formatStoreName(storeName || 'Tacos Gavilan'),
            weekDays,
            employees,
            shifts,
            language
        })
        window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank', 'noopener,noreferrer')
    }

    const handleOpenPrintSheet = () => {
        if (!storeGuid) {
            onPrint?.()
            return
        }
        const url = `/planificador/imprimir?storeId=${encodeURIComponent(storeGuid)}&startDate=${encodeURIComponent(weekKey)}`
        window.open(url, '_blank', 'noopener,noreferrer')
    }

    const printSheetUrl = storeGuid
        ? `/planificador/imprimir?storeId=${encodeURIComponent(storeGuid)}&startDate=${encodeURIComponent(weekKey)}`
        : ''

    return (
        <div className="flex flex-col flex-1 min-h-0 bg-gray-50 dark:bg-slate-950 font-sans">
            {/* STICKY MOBILE COMMAND HEADER (Store + Gmail + Week Nav + Tabs + Enviar) */}
            <div className="bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800 shrink-0 shadow-2xs z-20">
                {/* Row 1: Store Selector, Gmail Pill, Tools Button */}
                <div className="px-3 pt-2.5 pb-1.5 flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                        {stores.length > 1 && onStoreChange ? (
                            <select
                                value={selectedStoreId}
                                onChange={(e) => onStoreChange(e.target.value)}
                                className="w-full max-w-[210px] bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl px-3 py-2 text-base font-black text-gray-900 dark:text-white truncate focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                                {stores.map((s: any) => (
                                    <option key={s.id} value={s.id}>{formatStoreName(s.name)}</option>
                                ))}
                            </select>
                        ) : (
                            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 rounded-xl text-sm font-black truncate max-w-full">
                                <CalendarDays size={15} className="shrink-0" />
                                <span className="truncate">{formatStoreName(storeName || 'Tacos Gavilan')}</span>
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                        {googleConnected ? (
                            <div
                                className="flex items-center gap-1.5 px-2.5 py-2 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 rounded-xl text-[11px] font-bold border border-emerald-200 dark:border-emerald-800"
                                title={googleEmail}
                            >
                                <div className="w-2 h-2 bg-emerald-500 rounded-full shrink-0" />
                                <span className="max-w-[76px] truncate">Gmail</span>
                            </div>
                        ) : (
                            onConnectGmail && (
                                <button
                                    type="button"
                                    onClick={onConnectGmail}
                                    className="flex items-center gap-1 px-2.5 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-[11px] font-black shadow-xs active:scale-95 transition-all"
                                >
                                    <Mail size={14} />
                                    <span>{t('planner.mobile.gmail_connect_action')}</span>
                                </button>
                            )
                        )}

                        <button
                            type="button"
                            onClick={() => setIsToolsDrawerOpen(true)}
                            aria-label={t('planner.mobile.tools')}
                            className="w-10 h-10 flex items-center justify-center bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-xl active:scale-95 transition-all relative"
                        >
                            <Sliders size={18} />
                            {draftCount > 0 && (
                                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-indigo-600 rounded-full" />
                            )}
                        </button>
                    </div>
                </div>

                {/* Row 2: Built-In Week Navigator */}
                <div className="px-3 pb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center bg-gray-100 dark:bg-slate-800/80 rounded-xl p-0.5 flex-1 min-w-0 justify-between">
                        <button
                            type="button"
                            onClick={() => onDateChange?.(addDays(currentDate || weekStartSafe, -7))}
                            aria-label={t('planner.mobile.previous_week')}
                            className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-white dark:hover:bg-slate-700 text-gray-600 dark:text-slate-300 active:scale-95 transition-all shrink-0"
                        >
                            <ChevronLeft size={18} />
                        </button>
                        <span className="text-xs font-black text-gray-800 dark:text-slate-100 truncate px-1 text-center">
                            {weekRangeLabel}
                        </span>
                        <button
                            type="button"
                            onClick={() => onDateChange?.(addDays(currentDate || weekStartSafe, 7))}
                            aria-label={t('planner.mobile.next_week')}
                            className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-white dark:hover:bg-slate-700 text-gray-600 dark:text-slate-300 active:scale-95 transition-all shrink-0"
                        >
                            <ChevronRight size={18} />
                        </button>
                    </div>

                    {onDateChange && (
                        <button
                            type="button"
                            onClick={handleJumpToday}
                            className="px-3 h-10 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-300 font-black text-xs rounded-xl border border-indigo-200/70 dark:border-indigo-800 active:scale-95 transition-all shrink-0"
                        >
                            {t('planner.mobile.today')}
                        </button>
                    )}
                </div>

                {/* Row 3: View Tabs (`Por Día` | `Semana` | `Budget`) + Prominent `Enviar` Button */}
                <div className="px-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3 sm:gap-5 overflow-x-auto no-scrollbar">
                        {[
                            { id: 'daily', label: t('planner.mobile.tab_daily') },
                            { id: 'team_week', label: t('planner.mobile.tab_team_week') },
                            { id: 'weekly', label: t('planner.mobile.tab_budget') }
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setActiveTab(tab.id as any)}
                                className={`pb-2.5 pt-1 text-xs font-black tracking-wide uppercase transition-all relative whitespace-nowrap shrink-0 ${
                                    activeTab === tab.id
                                        ? 'text-indigo-600 dark:text-indigo-400'
                                        : 'text-gray-400 dark:text-slate-500'
                                }`}
                            >
                                {tab.label}
                                {activeTab === tab.id && (
                                    <motion.div
                                        layoutId="mobileTab"
                                        className="absolute bottom-0 left-0 right-0 h-1 bg-indigo-600 rounded-t-full"
                                    />
                                )}
                            </button>
                        ))}
                    </div>

                    <button
                        type="button"
                        onClick={() => setIsSendHubOpen(true)}
                        className={`mb-1.5 px-3.5 py-2 rounded-xl text-white font-black text-xs uppercase tracking-wide shadow-sm flex items-center gap-1.5 active:scale-95 transition-all shrink-0 ${
                            draftCount > 0
                                ? 'bg-gradient-to-r from-indigo-600 to-purple-600'
                                : 'bg-gradient-to-r from-emerald-600 to-teal-600'
                        }`}
                    >
                        <Send size={13} />
                        <span>{t('planner.mobile.send_schedules')}</span>
                        {draftCount > 0 && (
                            <span className="ml-0.5 px-1.5 py-0.2 bg-white/25 rounded-full text-[10px] font-black">
                                {draftCount}
                            </span>
                        )}
                    </button>
                </div>
            </div>

            {/* MAIN CONTENT AREA */}
            <div className="flex-1 overflow-y-auto no-scrollbar">
                {activeTab === 'daily' && (
                    <div className="p-3 space-y-3 pb-40">
                        {/* 7-DAY FULL FIT SELECTOR GRID */}
                        <div className="bg-white/95 dark:bg-slate-900 rounded-2xl p-1.5 border border-gray-200/80 dark:border-slate-800 shadow-2xs">
                            <div className="grid grid-cols-7 gap-1">
                                {weekDays.map((date, i) => {
                                    const isSelected = i === selectedDateIndex
                                    const dStr = formatDateISO(date)
                                    const dayName = date.toLocaleDateString(locale, { weekday: 'short' }).replace('.', '').slice(0, 3)
                                    const dayNum = date.getDate()
                                    const dayStaffCount = new Set(
                                        shifts.filter(s => s.shift_date === dStr && s.employee_id).map(s => String(s.employee_id))
                                    ).size
                                    const isToday = dStr === businessTodayISO

                                    return (
                                        <button
                                            key={dStr}
                                            type="button"
                                            onClick={() => setSelectedDateIndex(i)}
                                            className={`flex flex-col items-center py-2 px-0.5 rounded-xl transition-all relative ${
                                                isSelected
                                                    ? 'bg-gradient-to-b from-indigo-600 to-indigo-700 text-white shadow-sm font-bold'
                                                    : 'text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800'
                                            }`}
                                        >
                                            {isToday && !isSelected && (
                                                <div className="absolute top-1 right-1 w-1.5 h-1.5 bg-blue-500 rounded-full" />
                                            )}
                                            <span className="text-[10px] uppercase font-black tracking-tight mb-0.5 opacity-90">{dayName}</span>
                                            <span className="text-sm font-black leading-none">{dayNum}</span>
                                            <span className={`text-[9px] font-bold mt-1 px-1 rounded-full ${
                                                isSelected
                                                    ? 'bg-white/20 text-white'
                                                    : 'bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400'
                                            }`}>
                                                {dayStaffCount > 0 ? `${dayStaffCount}p` : '-'}
                                            </span>
                                        </button>
                                    )
                                })}
                            </div>
                            {weather?.[dateStr]?.temp?.max !== undefined && (
                                <div className="mt-1.5 px-2 pt-1.5 border-t border-gray-100 dark:border-slate-800 flex items-center justify-between text-[11px] font-bold text-gray-500 dark:text-slate-400">
                                    <span className="capitalize">
                                        {selectedDate.toLocaleDateString(locale, { weekday: 'long', month: 'short', day: 'numeric' })}
                                    </span>
                                    <span>
                                        {Math.round(weather[dateStr].temp.max)}° {weather[dateStr].weather?.[0]?.description ? `• ${weather[dateStr].weather[0].description}` : ''}
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* DAILY METRICS CARD */}
                        <motion.div
                            whileTap={{ scale: 0.99 }}
                            onClick={() => onShowSalesDetail(dateStr)}
                            className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-800 overflow-hidden cursor-pointer"
                        >
                            <div className="bg-gradient-to-r from-indigo-600 to-indigo-700 px-4 py-2.5 text-white flex justify-between items-center">
                                <div className="flex items-center gap-1.5">
                                    <BarChart3 size={14} className="text-indigo-200" />
                                    <h3 className="text-[10px] font-black uppercase tracking-wider">{t('planner.mobile.day_metrics')}</h3>
                                </div>
                                <div className="flex gap-8 text-[9px] font-black uppercase tracking-widest text-indigo-100">
                                    <span className="w-16 text-right">{t('planner.mobile.kpi_plan')}</span>
                                    <span className="w-16 text-right">{t('planner.mobile.kpi_actual')}</span>
                                </div>
                            </div>

                            <div className="divide-y divide-gray-100 dark:divide-slate-800/80 text-xs">
                                <div className="flex items-center justify-between px-4 py-2.5">
                                    <span className="font-bold text-gray-600 dark:text-slate-400 uppercase tracking-wide">{t('planner.mobile.kpi_hours')}</span>
                                    <div className="flex gap-8">
                                        <span className="font-black text-blue-600 dark:text-blue-400 w-16 text-right">
                                            {daySchedStats.hours.toFixed(1)}h
                                        </span>
                                        <span className={`font-black w-16 text-right ${dayActStats.hours > 0 ? (dayActStats.hours > daySchedStats.hours ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400') : 'text-gray-300 dark:text-slate-600'}`}>
                                            {dayActStats.hours > 0 ? `${dayActStats.hours.toFixed(1)}h` : '-'}
                                        </span>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50/40 dark:bg-slate-900/40">
                                    <span className="font-bold text-gray-600 dark:text-slate-400 uppercase tracking-wide">{t('planner.mobile.kpi_labor_cost')}</span>
                                    <div className="flex gap-8">
                                        <span className="font-black text-blue-600 dark:text-blue-400 w-16 text-right">
                                            ${Math.round(daySchedStats.cost).toLocaleString('en-US')}
                                        </span>
                                        <span className={`font-black w-16 text-right ${dayActStats.cost > 0 ? (dayActStats.cost > daySchedStats.cost ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400') : 'text-gray-300 dark:text-slate-600'}`}>
                                            {dayActStats.cost > 0 ? `$${Math.round(dayActStats.cost).toLocaleString('en-US')}` : '-'}
                                        </span>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between px-4 py-2.5">
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-gray-600 dark:text-slate-400 uppercase tracking-wide">{t('planner.mobile.kpi_sales')}</span>
                                        <div className="flex gap-1">
                                            <button
                                                type="button"
                                                onClick={(e) => { e.stopPropagation(); onRefresh(); }}
                                                className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg text-indigo-500 active:scale-95 transition-all"
                                                title={t('common.refresh')}
                                            >
                                                <RefreshCcw size={13} className={isExternalLoading ? 'animate-spin' : ''} />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={(e) => { e.stopPropagation(); onCalculateProjections(); }}
                                                className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg text-purple-500 active:scale-95 transition-all"
                                                title={t('planner.mobile.smart_gen')}
                                            >
                                                <Bot size={13} />
                                            </button>
                                        </div>
                                    </div>
                                    <div className="flex gap-8">
                                        <span className="font-black text-blue-600 dark:text-blue-400 w-16 text-right">
                                            ${Math.round(Number(dayProjections)).toLocaleString('en-US')}
                                        </span>
                                        <span className={`font-black w-16 text-right ${dayActuals > 0 ? (dayActuals < dayProjections ? 'text-amber-500' : 'text-emerald-500') : 'text-gray-300 dark:text-slate-600'}`}>
                                            {dayActuals > 0 ? `$${Math.round(dayActuals).toLocaleString('en-US')}` : '-'}
                                        </span>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50/40 dark:bg-slate-900/40">
                                    <span className="font-bold text-gray-600 dark:text-slate-400 uppercase tracking-wide">{t('planner.mobile.kpi_labor_pct')}</span>
                                    <div className="flex gap-8 items-center">
                                        <span className={`font-black w-16 text-right ${laborPctProj > 21.5 ? 'text-red-500' : 'text-blue-600 dark:text-blue-400'}`}>
                                            {laborPctProj.toFixed(1)}%
                                        </span>
                                        <div className="w-16 flex justify-end">
                                            <span className={`px-2 py-0.5 rounded-md text-[11px] font-black border ${laborPctAct > 21.5
                                                ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400 border-red-200 dark:border-red-900'
                                                : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900'
                                                }`}>
                                                {laborPctAct.toFixed(1)}%
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="px-4 py-1.5 bg-gray-50 dark:bg-slate-800/60 flex justify-center items-center gap-1.5 text-[9px] font-black uppercase tracking-wider text-gray-400 dark:text-slate-500">
                                <BarChart3 size={11} className="text-indigo-500" />
                                <span>{t('planner.mobile.tap_sales_detail')}</span>
                            </div>
                        </motion.div>

                        {/* SEARCH & FILTERS BAR */}
                        <div className="space-y-2 pt-1">
                            <div className="relative">
                                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder={t('planner.mobile.search_placeholder')}
                                    className="w-full pl-10 pr-9 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-base font-semibold text-gray-800 dark:text-slate-200 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs"
                                />
                                {searchQuery && (
                                    <button
                                        type="button"
                                        onClick={() => setSearchQuery('')}
                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 rounded-full"
                                    >
                                        <X size={15} />
                                    </button>
                                )}
                            </div>

                            <div className="flex flex-wrap items-center gap-2 justify-between">
                                <div className="flex bg-gray-200/70 dark:bg-slate-800 p-0.5 rounded-xl text-[11px] font-bold overflow-x-auto no-scrollbar max-w-full">
                                    <button
                                        type="button"
                                        onClick={() => setFilterStatus('all')}
                                        className={`px-2.5 py-1.5 rounded-lg transition-all whitespace-nowrap ${filterStatus === 'all'
                                            ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-2xs font-black'
                                            : 'text-gray-500 dark:text-slate-400'
                                            }`}
                                    >
                                        {t('planner.mobile.all')} ({totalEmployeesCount})
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setFilterStatus('scheduled')}
                                        className={`px-2.5 py-1.5 rounded-lg transition-all whitespace-nowrap ${filterStatus === 'scheduled'
                                            ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-2xs font-black'
                                            : 'text-gray-500 dark:text-slate-400'
                                            }`}
                                    >
                                        {t('planner.mobile.scheduled')} ({scheduledEmployeesCount})
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setFilterStatus('available')}
                                        className={`px-2.5 py-1.5 rounded-lg transition-all whitespace-nowrap ${filterStatus === 'available'
                                            ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-2xs font-black'
                                            : 'text-gray-500 dark:text-slate-400'
                                            }`}
                                    >
                                        {t('planner.mobile.available')} ({availableEmployeesCount})
                                    </button>
                                </div>

                                <select
                                    value={selectedRole}
                                    onChange={(e) => setSelectedRole(e.target.value)}
                                    className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl px-2.5 py-2 text-base font-bold text-gray-700 dark:text-slate-300 flex-1 sm:flex-initial min-w-[130px] max-w-full truncate shadow-2xs cursor-pointer focus:outline-none"
                                >
                                    <option value="all">{t('planner.mobile.all_roles')}</option>
                                    {availableJobRoles.map(role => (
                                        <option key={role} value={role}>{role}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* OPEN SHIFTS SECTION */}
                        {openDayShifts.length > 0 && (
                            <div className="bg-amber-50/80 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/50 rounded-2xl p-3 space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-black uppercase tracking-wider text-amber-800 dark:text-amber-300">
                                        {t('planner.mobile.open_shifts_title')} ({openDayShifts.length})
                                    </span>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {openDayShifts.map(os => {
                                        const job = jobs.find(j => j.id === os.job_id)
                                        return (
                                            <button
                                                key={os.id}
                                                type="button"
                                                disabled={!canEdit}
                                                onClick={() => canEdit && onEditShift(os, selectedDate, '')}
                                                className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 text-xs font-bold text-gray-800 dark:text-slate-200 flex items-center gap-2 shadow-2xs active:scale-95 transition-all"
                                            >
                                                <Clock size={12} className="text-amber-600" />
                                                <span>{formatTime12h(os.start_time)} - {formatTime12h(os.end_time)}</span>
                                                <span className="text-[10px] text-amber-700 dark:text-amber-400 font-black uppercase">
                                                    {job?.title || ''} ({getShiftHours(os).toFixed(1)}h)
                                                </span>
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>
                        )}

                        {/* EMPLOYEE CARDS LIST (SPACIOUS 2-ZONE CARD LAYOUT) */}
                        <div className="space-y-2.5 mt-1">
                            {filteredEmployees.length === 0 ? (
                                <div className="text-center py-10 bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 p-6">
                                    <Users size={32} className="mx-auto text-gray-300 dark:text-slate-600 mb-2" />
                                    <p className="text-xs font-bold text-gray-500 dark:text-slate-400">
                                        {t('planner.mobile.no_employees_found')}
                                    </p>
                                </div>
                            ) : (
                                filteredEmployees.map((emp) => {
                                    const empShifts = dayShifts.filter(s => String(s.employee_id) === String(emp.id))
                                    const hasShift = empShifts.length > 0
                                    const jobTitle = getEmployeeJobTitle(emp)
                                    const jobColor = stringToColor(jobTitle)
                                    const badgeProps = getReadableBadgeProps(jobColor)
                                    const empWeeklyHrs = getEmpWeeklyHours(emp.id)

                                    // Toast Punch Overlay
                                    const formatRealTime = (isoString?: string) => {
                                        if (!isoString) return null
                                        return formatTime12h(isoString)
                                    }
                                    const matchedPunch = punches && punches.length > 0 && hasShift
                                        ? punches.find((p: any) => p.employee_toast_guid === emp.toast_guid && p.business_date === dateStr)
                                        : null
                                    const realIn = matchedPunch?.clock_in ? formatRealTime(matchedPunch.clock_in) || '' : ''
                                    const realOut = matchedPunch?.clock_out ? formatRealTime(matchedPunch.clock_out) || '' : ''

                                    return (
                                        <div
                                            key={emp.id}
                                            className={`rounded-2xl border transition-all p-3.5 shadow-2xs space-y-2.5 ${
                                                hasShift
                                                    ? 'bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800'
                                                    : 'bg-white/70 dark:bg-slate-900/40 border-dashed border-gray-200 dark:border-slate-800'
                                            }`}
                                        >
                                            {/* Zone 1: Full-width Header (Zero Name Truncation Squeeze) */}
                                            <div className="flex items-start justify-between gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedEmployeeForContact(emp)}
                                                    className="flex items-center gap-3 flex-1 min-w-0 text-left active:opacity-80 transition-opacity"
                                                >
                                                    <div className="relative shrink-0">
                                                        <div
                                                            className="w-11 h-11 rounded-full flex items-center justify-center text-white font-black text-sm shadow-xs"
                                                            style={{ background: `linear-gradient(135deg, ${jobColor}, ${jobColor}dd)` }}
                                                        >
                                                            {emp.first_name?.[0]}{emp.last_name?.[0]}
                                                        </div>
                                                        {hasShift && (
                                                            <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-500 border-2 border-white dark:border-slate-900 rounded-full" />
                                                        )}
                                                    </div>

                                                    <div className="flex-1 min-w-0">
                                                        <h4 className="font-black text-gray-900 dark:text-white text-[15px] leading-snug truncate">
                                                            {emp.chosen_name || emp.first_name} {emp.last_name}
                                                        </h4>
                                                        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                                                            <span
                                                                className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md border ${badgeProps.className || ''}`}
                                                                style={badgeProps.style}
                                                            >
                                                                {jobTitle}
                                                            </span>
                                                            {empWeeklyHrs > 0 && (
                                                                <span className="text-[11px] font-bold text-gray-500 dark:text-slate-400">
                                                                    {empWeeklyHrs.toFixed(1)} {t('planner.mobile.hours_short')}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </button>

                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedEmployeeForContact(emp)}
                                                    className="px-2.5 py-1.5 rounded-xl bg-gray-100 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 text-gray-700 dark:text-slate-200 font-bold text-[11px] flex items-center gap-1 active:scale-95 transition-all shrink-0"
                                                >
                                                    <Send size={12} className="text-indigo-500" />
                                                    <span>{t('planner.mobile.view_send_week')}</span>
                                                </button>
                                            </div>

                                            {/* Zone 2: Shifts / Quick Assign Row */}
                                            {hasShift ? (
                                                <div className="space-y-1.5">
                                                    {empShifts.map((s) => {
                                                        const dur = getShiftHours(s)
                                                        const isDraft = s.status === 'draft'
                                                        const shiftJob = jobs.find(j => j.id === s.job_id)
                                                        return (
                                                            <div
                                                                key={s.id}
                                                                className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border ${
                                                                    isDraft
                                                                        ? 'bg-amber-50/70 dark:bg-amber-950/25 border-dashed border-amber-300 dark:border-amber-700'
                                                                        : 'bg-indigo-50/80 dark:bg-indigo-950/35 border-indigo-200 dark:border-indigo-900'
                                                                }`}
                                                            >
                                                                <button
                                                                    type="button"
                                                                    disabled={!canEdit}
                                                                    onClick={() => canEdit && setSelectedShiftForActions({ shift: s, employee: emp })}
                                                                    className="flex-1 min-w-0 text-left flex flex-wrap items-center gap-x-2 gap-y-1"
                                                                >
                                                                    <span className="inline-flex items-center gap-1.5 font-black text-xs text-indigo-900 dark:text-indigo-200">
                                                                        <Clock size={13} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                                                                        <span>{formatTime12h(s.start_time)} - {formatTime12h(s.end_time)}</span>
                                                                    </span>
                                                                    <span className="text-[11px] font-black text-indigo-600 dark:text-indigo-300">
                                                                        ({dur.toFixed(1)}h)
                                                                    </span>
                                                                    {shiftJob?.title && shiftJob.title !== jobTitle && (
                                                                        <span className="text-[10px] font-bold text-gray-500 dark:text-slate-400">
                                                                            • {shiftJob.title}
                                                                        </span>
                                                                    )}
                                                                    <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
                                                                        isDraft
                                                                            ? 'bg-amber-200/80 text-amber-900 dark:bg-amber-900/60 dark:text-amber-200'
                                                                            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300'
                                                                    }`}>
                                                                        {isDraft ? t('planner.mobile.draft_badge') : t('planner.mobile.published_badge')}
                                                                    </span>
                                                                    {shiftStats[s.id]?.totalOT > 0 && (
                                                                        <span className="text-[10px] text-red-600 dark:text-red-400 font-black uppercase">
                                                                            {shiftStats[s.id].totalOT.toFixed(1)}h OT ⚡
                                                                        </span>
                                                                    )}
                                                                </button>

                                                                {canEdit && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setSelectedShiftForActions({ shift: s, employee: emp })}
                                                                        aria-label={t('planner.mobile.actions')}
                                                                        className="p-2 -mr-1 text-gray-500 hover:text-gray-800 dark:text-slate-400 dark:hover:text-white rounded-lg shrink-0"
                                                                    >
                                                                        <MoreVertical size={17} />
                                                                    </button>
                                                                )}
                                                            </div>
                                                        )
                                                    })}

                                                    {(realIn || realOut || (matchedPunch?.breaks && matchedPunch.breaks.length > 0)) && (
                                                        <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-0.5">
                                                            {(realIn || realOut) && (
                                                                <span className="text-[10px] font-bold text-sky-600 dark:text-sky-400 flex items-center gap-1">
                                                                    <span>{t('planner.mobile.punch_in_out')}:</span>
                                                                    <span>{realIn || '--'} ➔ {realOut || '--'}</span>
                                                                </span>
                                                            )}
                                                            {matchedPunch?.breaks && Array.isArray(matchedPunch.breaks) && matchedPunch.breaks.length > 0 && (
                                                                <div className="flex items-center gap-1">
                                                                    {matchedPunch.breaks.map((rk: any, bIdx: number) => (
                                                                        <span
                                                                            key={bIdx}
                                                                            className={`text-[9px] font-black px-1.5 py-0.5 rounded ${
                                                                                rk.paid
                                                                                    ? 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300'
                                                                                    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                                                                            }`}
                                                                        >
                                                                            {rk.paid ? 'BRK' : 'LUN'}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                canEdit && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setSelectedEmployeeForPreset(emp)}
                                                        className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/30 hover:bg-indigo-100 dark:hover:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 font-black text-xs uppercase tracking-wider border border-indigo-200 dark:border-indigo-800 active:scale-[0.99] transition-all"
                                                    >
                                                        <Plus size={15} />
                                                        <span>{t('planner.mobile.assign_shift')}</span>
                                                    </button>
                                                )
                                            )}
                                        </div>
                                    )
                                })
                            )}
                        </div>
                    </div>
                )}

                {activeTab === 'team_week' && (
                    <div className="p-3 space-y-3 pb-40">
                        {/* Quick Team Actions Bar */}
                        <div className="bg-white dark:bg-slate-900 rounded-2xl p-3 border border-gray-200 dark:border-slate-800 shadow-2xs space-y-2.5">
                            <div className="relative">
                                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                    type="text"
                                    value={teamSearchQuery}
                                    onChange={(e) => setTeamSearchQuery(e.target.value)}
                                    placeholder={t('planner.mobile.search_placeholder')}
                                    className="w-full pl-10 pr-9 py-2.5 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-base font-semibold text-gray-800 dark:text-slate-200 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                                {teamSearchQuery && (
                                    <button
                                        type="button"
                                        onClick={() => setTeamSearchQuery('')}
                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-gray-400"
                                    >
                                        <X size={15} />
                                    </button>
                                )}
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <button
                                    type="button"
                                    onClick={() => setShowOffInTeamWeek(!showOffInTeamWeek)}
                                    className="px-3 py-1.5 rounded-xl bg-gray-100 dark:bg-slate-800 text-xs font-bold text-gray-700 dark:text-slate-300 border border-gray-200 dark:border-slate-700"
                                >
                                    {showOffInTeamWeek ? t('planner.mobile.hide_off_employees') : t('planner.mobile.show_off_employees')} ({employees.length})
                                </button>

                                <div className="flex items-center gap-1.5">
                                    <button
                                        type="button"
                                        onClick={handleShareTeamWhatsApp}
                                        className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-black flex items-center gap-1.5 active:scale-95 transition-all"
                                    >
                                        <MessageSquare size={13} />
                                        <span>WhatsApp</span>
                                    </button>
                                    {storeGuid && (
                                        <button
                                            type="button"
                                            onClick={handleOpenPrintSheet}
                                            className="px-3 py-1.5 rounded-xl bg-gray-900 dark:bg-slate-700 text-white text-xs font-black flex items-center gap-1.5 active:scale-95 transition-all"
                                        >
                                            <Printer size={13} />
                                            <span>PDF</span>
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Team Weekly Cards */}
                        {teamWeekEmployees.length === 0 ? (
                            <div className="text-center py-10 bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 p-6 space-y-3">
                                <CalendarDays size={32} className="mx-auto text-gray-300 dark:text-slate-600" />
                                <p className="text-sm font-bold text-gray-500 dark:text-slate-400">
                                    {t('planner.mobile.no_scheduled_week')}
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {teamWeekEmployees.map(emp => {
                                    const empWeekShifts = shifts.filter(s => String(s.employee_id) === String(emp.id))
                                    const empTotalHrs = getEmpWeeklyHours(emp.id)
                                    const hasDraft = empWeekShifts.some(s => s.status === 'draft')
                                    const jobTitle = getEmployeeJobTitle(emp)
                                    const jobColor = stringToColor(jobTitle)
                                    const badgeProps = getReadableBadgeProps(jobColor)
                                    const isSendingThis = sendingEmpId === String(emp.id)

                                    return (
                                        <div
                                            key={emp.id}
                                            className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 p-3.5 shadow-2xs space-y-3"
                                        >
                                            {/* Header */}
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0 flex-1">
                                                    <h4 className="font-black text-gray-900 dark:text-white text-[15px] leading-snug truncate">
                                                        {emp.chosen_name || emp.first_name} {emp.last_name}
                                                    </h4>
                                                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                                                        <span
                                                            className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md border ${badgeProps.className || ''}`}
                                                            style={badgeProps.style}
                                                        >
                                                            {jobTitle}
                                                        </span>
                                                        {hasDraft && (
                                                            <span className="text-[10px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                                                                {t('planner.mobile.draft_badge')}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="text-right shrink-0">
                                                    <span className="text-sm font-black text-indigo-600 dark:text-indigo-400">
                                                        {empTotalHrs.toFixed(1)} {t('planner.mobile.hours_short')}
                                                    </span>
                                                    {empTotalHrs > 40 && (
                                                        <div className="text-[10px] font-black text-red-600 dark:text-red-400">
                                                            +{(empTotalHrs - 40).toFixed(1)}h OT
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* 7-Day Compact Schedule Strip */}
                                            <div className="grid grid-cols-7 gap-1">
                                                {weekDays.map((d) => {
                                                    const dIso = formatDateISO(d)
                                                    const dayLetter = d.toLocaleDateString(locale, { weekday: 'short' }).replace('.', '').slice(0, 2)
                                                    const dayMatches = empWeekShifts.filter(s => s.shift_date === dIso)
                                                    const firstShift = dayMatches[0]
                                                    const dayHasDraft = dayMatches.some(s => s.status === 'draft')

                                                    return (
                                                        <button
                                                            key={dIso}
                                                            type="button"
                                                            disabled={!canEdit}
                                                            onClick={() => {
                                                                if (!canEdit) return
                                                                if (firstShift) {
                                                                    onEditShift(firstShift, d, emp.id)
                                                                } else {
                                                                    onAddShift(d, emp.id)
                                                                }
                                                            }}
                                                            className={`flex flex-col items-center justify-center p-1 rounded-xl border min-h-[52px] transition-all ${
                                                                firstShift
                                                                    ? dayHasDraft
                                                                        ? 'bg-amber-50 dark:bg-amber-950/30 border-dashed border-amber-300 dark:border-amber-700'
                                                                        : 'bg-indigo-50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800'
                                                                    : 'bg-gray-50 dark:bg-slate-800/50 border-gray-100 dark:border-slate-800 text-gray-400'
                                                            }`}
                                                        >
                                                            <span className="text-[9px] font-black uppercase text-gray-500 dark:text-slate-400">
                                                                {dayLetter} {d.getDate()}
                                                            </span>
                                                            {firstShift ? (
                                                                <div className="mt-0.5 text-[9px] font-black text-indigo-900 dark:text-indigo-200 leading-tight text-center">
                                                                    <div>{formatCompactTime(firstShift.start_time)}</div>
                                                                    <div className="opacity-75">{formatCompactTime(firstShift.end_time)}</div>
                                                                </div>
                                                            ) : (
                                                                <span className="text-xs font-bold text-gray-300 dark:text-slate-600 mt-1">—</span>
                                                            )}
                                                        </button>
                                                    )
                                                })}
                                            </div>

                                            {/* 1-Tap Direct Send Buttons */}
                                            <div className="grid grid-cols-3 gap-1.5 pt-1 border-t border-gray-100 dark:border-slate-800">
                                                <button
                                                    type="button"
                                                    disabled={isSendingThis || empWeekShifts.length === 0}
                                                    onClick={() => onSendEmployeeSchedule?.(emp.id)}
                                                    className="py-2 px-2 rounded-xl bg-purple-600 hover:bg-purple-700 disabled:opacity-45 text-white font-black text-[11px] flex items-center justify-center gap-1 active:scale-95 transition-all"
                                                >
                                                    {isSendingThis ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
                                                    <span className="truncate">Email</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={empWeekShifts.length === 0}
                                                    onClick={() => handleShareWhatsAppEmployee(emp)}
                                                    className="py-2 px-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-45 text-white font-black text-[11px] flex items-center justify-center gap-1 active:scale-95 transition-all"
                                                >
                                                    <MessageSquare size={13} />
                                                    <span className="truncate">WhatsApp</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedEmployeeForContact(emp)}
                                                    className="py-2 px-2 rounded-xl bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 text-gray-800 dark:text-slate-200 font-black text-[11px] flex items-center justify-center gap-1 active:scale-95 transition-all"
                                                >
                                                    <Share2 size={13} />
                                                    <span className="truncate">SMS / +</span>
                                                </button>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'weekly' && (
                    /* WEEKLY BUDGET TAB */
                    <div className="p-3 space-y-3 pb-40">
                        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-800 overflow-hidden">
                            <div className="bg-gradient-to-r from-indigo-600 to-indigo-700 px-4 py-3 text-white flex justify-between items-center gap-2">
                                <h3 className="text-[11px] font-black uppercase tracking-wider truncate">
                                    {t('planner.mobile.weekly_budget')} ({weekRangeLabel})
                                </h3>
                                <div className="flex gap-8 text-[9px] font-black uppercase tracking-widest text-indigo-100 shrink-0">
                                    <span className="w-16 text-right">{t('planner.mobile.kpi_plan')}</span>
                                    <span className="w-16 text-right">{t('planner.mobile.kpi_actual')}</span>
                                </div>
                            </div>

                            <div className="divide-y divide-gray-100 dark:divide-slate-800 text-xs">
                                <div className="flex items-center justify-between px-4 py-3">
                                    <span className="font-bold text-gray-700 dark:text-slate-300 uppercase tracking-wide">{t('planner.mobile.kpi_hours')}</span>
                                    <div className="flex gap-8">
                                        <span className="font-black text-blue-600 dark:text-blue-400 w-16 text-right">
                                            {weeklyStats.totalHoursSched.toFixed(1)}h
                                        </span>
                                        <span className={`font-black w-16 text-right ${weeklyStats.totalHoursAct > 0 ? (weeklyStats.totalHoursAct > weeklyStats.totalHoursSched ? 'text-red-500' : 'text-emerald-500') : 'text-gray-300 dark:text-slate-600'}`}>
                                            {weeklyStats.totalHoursAct > 0 ? `${weeklyStats.totalHoursAct.toFixed(1)}h` : '-'}
                                        </span>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between px-4 py-3 bg-gray-50/40 dark:bg-slate-900/40">
                                    <span className="font-bold text-gray-700 dark:text-slate-300 uppercase tracking-wide">{t('planner.mobile.kpi_labor_cost')}</span>
                                    <div className="flex gap-8">
                                        <span className="font-black text-blue-600 dark:text-blue-400 w-16 text-right">
                                            ${Math.round(weeklyStats.totalCostSched).toLocaleString('en-US')}
                                        </span>
                                        <span className={`font-black w-16 text-right ${weeklyStats.totalCostAct > 0 ? (weeklyStats.totalCostAct > weeklyStats.totalCostSched ? 'text-red-500' : 'text-emerald-500') : 'text-gray-300 dark:text-slate-600'}`}>
                                            {weeklyStats.totalCostAct > 0 ? `$${Math.round(weeklyStats.totalCostAct).toLocaleString('en-US')}` : '-'}
                                        </span>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between px-4 py-3">
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-gray-700 dark:text-slate-300 uppercase tracking-wide">{t('planner.mobile.kpi_sales')}</span>
                                        <div className="flex gap-1">
                                            <button type="button" onClick={onRefresh} className="p-1.5 hover:bg-gray-100 rounded text-indigo-500 active:scale-95 transition-all">
                                                <RefreshCcw size={13} className={isExternalLoading ? 'animate-spin' : ''} />
                                            </button>
                                            <button type="button" onClick={onCalculateProjections} className="p-1.5 hover:bg-gray-100 rounded text-purple-500 active:scale-95 transition-all">
                                                <Bot size={13} />
                                            </button>
                                        </div>
                                    </div>
                                    <div className="flex gap-8">
                                        <span className="font-black text-blue-600 dark:text-blue-400 w-16 text-right">
                                            ${Math.round(weeklyStats.totalProjSales).toLocaleString('en-US')}
                                        </span>
                                        <span className={`font-black w-16 text-right ${weeklyStats.totalActualSales > 0 ? (weeklyStats.totalActualSales < weeklyStats.totalProjSales ? 'text-amber-500' : 'text-emerald-500') : 'text-gray-300 dark:text-slate-600'}`}>
                                            ${Math.round(weeklyStats.totalActualSales).toLocaleString('en-US')}
                                        </span>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between px-4 py-3 bg-gray-50/40 dark:bg-slate-900/40">
                                    <span className="font-bold text-gray-700 dark:text-slate-300 uppercase tracking-wide">{t('planner.mobile.kpi_labor_pct')}</span>
                                    <div className="flex gap-8 items-center">
                                        <span className={`font-black w-16 text-right ${weeklyStats.totalLaborPctProj > 21.5 ? 'text-red-500' : 'text-blue-600 dark:text-blue-400'}`}>
                                            {weeklyStats.totalLaborPctProj.toFixed(1)}%
                                        </span>
                                        <div className="w-16 flex justify-end">
                                            <span className={`px-2 py-0.5 rounded-md text-[11px] font-black border ${weeklyStats.totalLaborPctAct > 21.5
                                                ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400 border-red-200 dark:border-red-900'
                                                : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900'
                                                }`}>
                                                {weeklyStats.totalLaborPctAct > 0 ? `${weeklyStats.totalLaborPctAct.toFixed(1)}%` : '-'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* TACTICAL TARGET CARD (< 21.5%) */}
                        <div className={`p-4 rounded-2xl shadow-xs border-l-4 ${weeklyStats.totalLaborPctAct > 21.5
                            ? 'bg-red-50 dark:bg-red-950/20 border-red-500'
                            : 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-500'
                            }`}>
                            <div className="flex gap-3">
                                <div className={`p-2 rounded-xl text-white shrink-0 h-fit ${weeklyStats.totalLaborPctAct > 21.5 ? 'bg-red-500' : 'bg-emerald-500'}`}>
                                    <AlertCircle size={18} />
                                </div>
                                <div className="flex-1">
                                    <h4 className={`text-xs font-black uppercase tracking-wider ${weeklyStats.totalLaborPctAct > 21.5 ? 'text-red-800 dark:text-red-200' : 'text-emerald-800 dark:text-emerald-200'}`}>
                                        {weeklyStats.totalLaborPctAct > 21.5 ? t('planner.mobile.target_exceeded') : t('planner.mobile.target_met')}
                                    </h4>
                                    <p className={`text-xs mt-1 font-medium leading-relaxed ${weeklyStats.totalLaborPctAct > 21.5 ? 'text-red-700/90 dark:text-red-300/80' : 'text-emerald-700/90 dark:text-emerald-300/80'}`}>
                                        {weeklyStats.totalLaborPctAct > 21.5 ? t('planner.mobile.labor_over_limit') : t('planner.mobile.labor_on_target')}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* 1-TAP QUICK PRESETS BOTTOM SHEET */}
            <AnimatePresence>
                {selectedEmployeeForPreset && (
                    <div
                        onClick={() => setSelectedEmployeeForPreset(null)}
                        className="fixed inset-0 z-[120] flex items-end justify-center bg-black/60 backdrop-blur-xs"
                    >
                        <motion.div
                            initial={{ y: '100%' }}
                            animate={{ y: 0 }}
                            exit={{ y: '100%' }}
                            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                            onClick={(e) => e.stopPropagation()}
                            className="bg-white dark:bg-slate-900 rounded-t-3xl w-full max-w-md max-h-[88dvh] overflow-y-auto p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-2xl border-t border-gray-200 dark:border-slate-800 space-y-4"
                        >
                            <div className="flex justify-between items-center border-b border-gray-100 dark:border-slate-800 pb-3">
                                <div>
                                    <span className="text-[10px] font-black uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                                        {t('planner.mobile.assign_shift')}
                                    </span>
                                    <h3 className="font-black text-base text-gray-900 dark:text-white">
                                        {selectedEmployeeForPreset.chosen_name || selectedEmployeeForPreset.first_name} {selectedEmployeeForPreset.last_name}
                                    </h3>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setSelectedEmployeeForPreset(null)}
                                    className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-400"
                                >
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="text-[11px] font-black text-gray-400 uppercase tracking-widest">
                                {t('planner.mobile.quick_presets')}
                            </div>

                            <div className="grid grid-cols-1 gap-2">
                                <button
                                    type="button"
                                    onClick={() => handleApplyPreset('apertura')}
                                    className="flex items-center justify-between p-3 rounded-xl bg-amber-50/70 hover:bg-amber-100/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 text-left active:scale-98 transition-all"
                                >
                                    <div className="flex items-center gap-2.5">
                                        <Sun size={18} className="text-amber-500 shrink-0" />
                                        <div>
                                            <div className="font-black text-xs text-amber-900 dark:text-amber-200">{t('planner.mobile.apertura')}</div>
                                            <div className="text-[10px] text-amber-700 dark:text-amber-400">{t('planner.mobile.preset_open_desc')}</div>
                                        </div>
                                    </div>
                                    <ChevronRight size={16} className="text-amber-400" />
                                </button>

                                <button
                                    type="button"
                                    onClick={() => handleApplyPreset('medio')}
                                    className="flex items-center justify-between p-3 rounded-xl bg-blue-50/70 hover:bg-blue-100/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/40 text-left active:scale-98 transition-all"
                                >
                                    <div className="flex items-center gap-2.5">
                                        <Utensils size={18} className="text-blue-500 shrink-0" />
                                        <div>
                                            <div className="font-black text-xs text-blue-900 dark:text-blue-200">{t('planner.mobile.medio')}</div>
                                            <div className="text-[10px] text-blue-700 dark:text-blue-400">{t('planner.mobile.preset_mid_desc')}</div>
                                        </div>
                                    </div>
                                    <ChevronRight size={16} className="text-blue-400" />
                                </button>

                                <button
                                    type="button"
                                    onClick={() => handleApplyPreset('turno_pm')}
                                    className="flex items-center justify-between p-3 rounded-xl bg-purple-50/70 hover:bg-purple-100/70 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-900/40 text-left active:scale-98 transition-all"
                                >
                                    <div className="flex items-center gap-2.5">
                                        <Moon size={18} className="text-purple-500 shrink-0" />
                                        <div>
                                            <div className="font-black text-xs text-purple-900 dark:text-purple-200">{t('planner.mobile.turno_pm')}</div>
                                            <div className="text-[10px] text-purple-700 dark:text-purple-400">{t('planner.mobile.preset_pm_desc')}</div>
                                        </div>
                                    </div>
                                    <ChevronRight size={16} className="text-purple-400" />
                                </button>

                                <button
                                    type="button"
                                    onClick={() => handleApplyPreset('cierre')}
                                    className="flex items-center justify-between p-3 rounded-xl bg-indigo-50/70 hover:bg-indigo-100/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/40 text-left active:scale-98 transition-all"
                                >
                                    <div className="flex items-center gap-2.5">
                                        <Lock size={18} className="text-indigo-500 shrink-0" />
                                        <div>
                                            <div className="font-black text-xs text-indigo-900 dark:text-indigo-200">{t('planner.mobile.cierre')}</div>
                                            <div className="text-[10px] text-indigo-700 dark:text-indigo-400">{t('planner.mobile.preset_close_desc')}</div>
                                        </div>
                                    </div>
                                    <ChevronRight size={16} className="text-indigo-400" />
                                </button>

                                <button
                                    type="button"
                                    onClick={() => {
                                        const emp = selectedEmployeeForPreset
                                        setSelectedEmployeeForPreset(null)
                                        onAddShift(selectedDate, emp.id)
                                    }}
                                    className="flex items-center justify-center gap-2 p-3.5 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 text-gray-700 dark:text-slate-200 font-bold text-xs active:scale-98 transition-all"
                                >
                                    <Settings size={15} />
                                    <span>{t('planner.mobile.custom')}</span>
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* SHIFT ACTIONS BOTTOM SHEET */}
            <AnimatePresence>
                {selectedShiftForActions && (
                    <div
                        onClick={() => setSelectedShiftForActions(null)}
                        className="fixed inset-0 z-[120] flex items-end justify-center bg-black/60 backdrop-blur-xs"
                    >
                        <motion.div
                            initial={{ y: '100%' }}
                            animate={{ y: 0 }}
                            exit={{ y: '100%' }}
                            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                            onClick={(e) => e.stopPropagation()}
                            className="bg-white dark:bg-slate-900 rounded-t-3xl w-full max-w-md max-h-[88dvh] overflow-y-auto p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-2xl border-t border-gray-200 dark:border-slate-800 space-y-4"
                        >
                            <div className="flex justify-between items-center border-b border-gray-100 dark:border-slate-800 pb-3">
                                <div>
                                    <span className="text-[10px] font-black uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                                        {t('planner.mobile.actions')}
                                    </span>
                                    <h3 className="font-black text-base text-gray-900 dark:text-white">
                                        {selectedShiftForActions.employee.chosen_name || selectedShiftForActions.employee.first_name} {selectedShiftForActions.employee.last_name}
                                    </h3>
                                    <p className="text-xs font-bold text-gray-500 dark:text-slate-400 mt-0.5">
                                        {formatTime12h(selectedShiftForActions.shift.start_time)} - {formatTime12h(selectedShiftForActions.shift.end_time)} ({getShiftHours(selectedShiftForActions.shift).toFixed(1)}h)
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setSelectedShiftForActions(null)}
                                    className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-400"
                                >
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="space-y-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        const { shift, employee } = selectedShiftForActions
                                        setSelectedShiftForActions(null)
                                        onEditShift(shift, selectedDate, employee.id)
                                    }}
                                    className="w-full flex items-center gap-3 p-3.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-bold text-xs active:scale-98 transition-all"
                                >
                                    <Settings size={18} />
                                    <span>{t('planner.mobile.edit_shift')}</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={handleDuplicateToNextDay}
                                    className="w-full flex items-center gap-3 p-3.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-bold text-xs active:scale-98 transition-all"
                                >
                                    <Copy size={18} />
                                    <span>{t('planner.mobile.duplicate_next_day')}</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={handleDeleteCurrentShift}
                                    className="w-full flex items-center gap-3 p-3.5 rounded-xl bg-red-50 hover:bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400 font-bold text-xs active:scale-98 transition-all"
                                >
                                    <Trash2 size={18} />
                                    <span>{t('planner.mobile.delete_shift')}</span>
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* EMPLOYEE WEEKLY SCHEDULE & SEND BOTTOM SHEET */}
            <AnimatePresence>
                {selectedEmployeeForContact && (() => {
                    const emp = selectedEmployeeForContact
                    const jobTitle = getEmployeeJobTitle(emp)
                    const jobColor = stringToColor(jobTitle)
                    const badgeProps = getReadableBadgeProps(jobColor)
                    const empWeekShifts = shifts.filter(s => String(s.employee_id) === String(emp.id))
                    const totalWeekHours = getEmpWeeklyHours(emp.id)
                    const todayShift = empWeekShifts.find(s => s.shift_date === dateStr)
                    const posId = emp.external_id || (emp.toast_guid ? emp.toast_guid.slice(0, 8) : null)
                    const isSendingThis = sendingEmpId === String(emp.id)
                    const empMsgText = getEmployeeMessageText(emp)

                    return (
                        <div
                            onClick={() => setSelectedEmployeeForContact(null)}
                            className="fixed inset-0 z-[120] flex items-end justify-center bg-black/60 backdrop-blur-xs"
                        >
                            <motion.div
                                initial={{ y: '100%' }}
                                animate={{ y: 0 }}
                                exit={{ y: '100%' }}
                                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                                onClick={(e) => e.stopPropagation()}
                                className="bg-white dark:bg-slate-900 rounded-t-3xl w-full max-w-md max-h-[88dvh] overflow-y-auto no-scrollbar p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-2xl border-t border-gray-200 dark:border-slate-800 space-y-4"
                            >
                                {/* HEADER */}
                                <div className="flex justify-between items-start border-b border-gray-100 dark:border-slate-800 pb-3 gap-2">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div
                                            className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-black text-base shadow-sm shrink-0"
                                            style={{ background: `linear-gradient(135deg, ${jobColor}, ${jobColor}dd)` }}
                                        >
                                            {emp.first_name?.[0]}{emp.last_name?.[0]}
                                        </div>
                                        <div className="min-w-0">
                                            <span className="text-[10px] font-black uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                                                {t('planner.mobile.weekly_schedule')}
                                            </span>
                                            <h3 className="font-black text-base text-gray-900 dark:text-white leading-tight truncate">
                                                {emp.chosen_name || emp.first_name} {emp.last_name}
                                            </h3>
                                            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                                <span
                                                    className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md border ${badgeProps.className || ''}`}
                                                    style={badgeProps.style}
                                                >
                                                    {jobTitle}
                                                </span>
                                                {posId && (
                                                    <span className="text-[10px] font-bold text-gray-400 dark:text-slate-500">
                                                        #{posId}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        {emp.phone && (
                                            <a
                                                href={`tel:${emp.phone}`}
                                                aria-label={t('planner.mobile.call')}
                                                className="w-10 h-10 flex items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
                                            >
                                                <Phone size={18} />
                                            </a>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => setSelectedEmployeeForContact(null)}
                                            className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-400"
                                        >
                                            <X size={20} />
                                        </button>
                                    </div>
                                </div>

                                {/* ONE-TAP SEND & SHARE ACTIONS */}
                                <div className="space-y-2">
                                    {onSendEmployeeSchedule && (
                                        <button
                                            type="button"
                                            disabled={isSendingThis || empWeekShifts.length === 0}
                                            onClick={() => onSendEmployeeSchedule(emp.id)}
                                            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:opacity-95 disabled:opacity-50 text-white font-black text-xs uppercase tracking-wide shadow-sm active:scale-98 transition-all"
                                        >
                                            {isSendingThis ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} />}
                                            <span>{isSendingThis ? t('planner.mobile.sending_email') : t('planner.mobile.send_email_one')}</span>
                                        </button>
                                    )}

                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            type="button"
                                            disabled={empWeekShifts.length === 0}
                                            onClick={() => handleShareWhatsAppEmployee(emp)}
                                            className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-45 text-white font-black text-xs active:scale-98 transition-all"
                                        >
                                            <MessageSquare size={14} />
                                            <span>WhatsApp</span>
                                        </button>
                                        <button
                                            type="button"
                                            disabled={!emp.phone || empWeekShifts.length === 0}
                                            onClick={() => handleShareSMSEmployee(emp)}
                                            className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-45 text-white font-black text-xs active:scale-98 transition-all"
                                        >
                                            <MessageSquare size={14} />
                                            <span>SMS</span>
                                        </button>
                                    </div>

                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            type="button"
                                            onClick={() => handleCopyOrShareText(empMsgText, false)}
                                            className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 text-gray-800 dark:text-slate-200 font-bold text-xs active:scale-98 transition-all"
                                        >
                                            <Copy size={14} />
                                            <span>{t('planner.mobile.copy_schedule')}</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleCopyOrShareText(empMsgText, true)}
                                            className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 text-gray-800 dark:text-slate-200 font-bold text-xs active:scale-98 transition-all"
                                        >
                                            <Share2 size={14} />
                                            <span>{t('planner.mobile.share_native')}</span>
                                        </button>
                                    </div>
                                </div>

                                {/* WEEKLY SCHEDULE BREAKDOWN */}
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[11px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
                                            <CalendarDays size={13} className="text-indigo-500" />
                                            {t('planner.mobile.weekly_schedule')}
                                        </span>
                                        <span className="text-xs font-black text-indigo-600 dark:text-indigo-400">
                                            {totalWeekHours.toFixed(1)} {t('planner.mobile.hours_short')}
                                        </span>
                                    </div>

                                    <div className="divide-y divide-gray-100 dark:divide-slate-800 bg-gray-50 dark:bg-slate-800/40 rounded-2xl border border-gray-100 dark:border-slate-800 text-xs overflow-hidden">
                                        {weekDays.map((d) => {
                                            const dayIso = formatDateISO(d)
                                            const dayLabel = d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric' })
                                            const dayMatchShifts = empWeekShifts.filter(s => s.shift_date === dayIso)
                                            const isSelectedDay = dayIso === dateStr

                                            return (
                                                <div
                                                    key={dayIso}
                                                    onClick={() => {
                                                        if (!canEdit) return
                                                        setSelectedEmployeeForContact(null)
                                                        if (dayMatchShifts[0]) {
                                                            onEditShift(dayMatchShifts[0], d, emp.id)
                                                        } else {
                                                            onAddShift(d, emp.id)
                                                        }
                                                    }}
                                                    className={`flex items-center justify-between px-3 py-2.5 ${canEdit ? 'cursor-pointer active:bg-indigo-50/80 dark:active:bg-indigo-950/40' : ''} ${
                                                        isSelectedDay ? 'bg-indigo-50/70 dark:bg-indigo-950/30 font-bold' : ''
                                                    }`}
                                                >
                                                    <span className={`text-[11px] uppercase ${isSelectedDay ? 'font-black text-indigo-600 dark:text-indigo-400' : 'text-gray-500 dark:text-slate-400'}`}>
                                                        {dayLabel} {isSelectedDay && '•'}
                                                    </span>
                                                    {dayMatchShifts.length > 0 ? (
                                                        <div className="flex flex-col items-end gap-0.5">
                                                            {dayMatchShifts.map((ds) => (
                                                                <div key={ds.id} className="flex items-center gap-1.5">
                                                                    <span className="font-bold text-gray-800 dark:text-slate-200">
                                                                        {formatTime12h(ds.start_time)} - {formatTime12h(ds.end_time)}
                                                                    </span>
                                                                    <span className="text-[10px] font-black text-indigo-600 dark:text-indigo-400">
                                                                        ({getShiftHours(ds).toFixed(1)}h)
                                                                    </span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <span className="text-[11px] font-semibold text-gray-400 dark:text-slate-500">
                                                            {t('planner.mobile.off_day')}
                                                        </span>
                                                    )}
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>

                                {/* TODAY'S QUICK ACTION BUTTON */}
                                {canEdit && (
                                    <div className="pt-1">
                                        {todayShift ? (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const s = todayShift
                                                    setSelectedEmployeeForContact(null)
                                                    onEditShift(s, selectedDate, emp.id)
                                                }}
                                                className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-black text-xs active:scale-98 transition-all"
                                            >
                                                <Settings size={15} />
                                                <span>{t('planner.mobile.edit_shift')} ({formatTime12h(todayShift.start_time)} - {formatTime12h(todayShift.end_time)})</span>
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setSelectedEmployeeForContact(null)
                                                    setSelectedEmployeeForPreset(emp)
                                                }}
                                                className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs active:scale-98 transition-all shadow-xs"
                                            >
                                                <Plus size={15} />
                                                <span>{t('planner.mobile.assign_shift')} {emp.chosen_name || emp.first_name}</span>
                                            </button>
                                        )}
                                    </div>
                                )}
                            </motion.div>
                        </div>
                    )
                })()}
            </AnimatePresence>

            {/* TEAM SEND & SHARE HUB BOTTOM SHEET */}
            <AnimatePresence>
                {isSendHubOpen && (
                    <div
                        onClick={() => setIsSendHubOpen(false)}
                        className="fixed inset-0 z-[120] flex items-end justify-center bg-black/60 backdrop-blur-xs"
                    >
                        <motion.div
                            initial={{ y: '100%' }}
                            animate={{ y: 0 }}
                            exit={{ y: '100%' }}
                            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                            onClick={(e) => e.stopPropagation()}
                            className="bg-white dark:bg-slate-900 rounded-t-3xl w-full max-w-md max-h-[88dvh] overflow-y-auto p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-2xl border-t border-gray-200 dark:border-slate-800 space-y-4"
                        >
                            <div className="flex justify-between items-start border-b border-gray-100 dark:border-slate-800 pb-3">
                                <div>
                                    <h3 className="font-black text-base text-gray-900 dark:text-white flex items-center gap-2">
                                        <Send size={18} className="text-indigo-600" />
                                        <span>{t('planner.mobile.send_hub_title')}</span>
                                    </h3>
                                    <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                                        {t('planner.mobile.send_hub_subtitle')}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setIsSendHubOpen(false)}
                                    className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-400"
                                >
                                    <X size={20} />
                                </button>
                            </div>

                            {/* Status Summary Pill */}
                            <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 bg-gray-50 dark:bg-slate-800/60 rounded-2xl border border-gray-200 dark:border-slate-700 text-xs font-bold">
                                <span className="text-gray-700 dark:text-slate-200">
                                    {t('planner.mobile.shifts_count').replace('{n}', String(totalShiftsCount || shifts.length))} • {weekScheduledEmpIdSet.size} {t('planner.mobile.scheduled')}
                                </span>
                                {googleConnected ? (
                                    <span className="text-emerald-600 dark:text-emerald-400 font-black flex items-center gap-1">
                                        <CheckCircle2 size={13} /> {t('planner.mobile.gmail_connected')}
                                    </span>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => { setIsSendHubOpen(false); onConnectGmail?.(); }}
                                        className="text-amber-600 dark:text-amber-400 font-black underline"
                                    >
                                        {t('planner.mobile.gmail_connect_action')}
                                    </button>
                                )}
                            </div>

                            <div className="space-y-2.5">
                                {onPublish && (
                                    <button
                                        type="button"
                                        disabled={draftCount === 0 && totalShiftsCount === 0 && shifts.length === 0}
                                        onClick={() => { setIsSendHubOpen(false); onPublish(); }}
                                        className={`w-full py-3.5 px-4 rounded-2xl text-white font-black text-xs uppercase tracking-wider shadow-md flex items-center justify-center gap-2 active:scale-98 transition-all disabled:opacity-45 ${
                                            draftCount > 0
                                                ? 'bg-gradient-to-r from-indigo-600 to-purple-600'
                                                : 'bg-gradient-to-r from-emerald-600 to-teal-600'
                                        }`}
                                    >
                                        <Zap size={16} fill="currentColor" />
                                        <span>
                                            {draftCount > 0
                                                ? `${t('planner.mobile.send_email_drafts')} (${draftCount})`
                                                : t('planner.mobile.send_email_all')}
                                        </span>
                                    </button>
                                )}

                                <button
                                    type="button"
                                    disabled={shifts.length === 0}
                                    onClick={() => { setIsSendHubOpen(false); handleShareTeamWhatsApp(); }}
                                    className="w-full py-3 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-45 text-white font-black text-xs flex items-center justify-center gap-2 active:scale-98 transition-all"
                                >
                                    <MessageSquare size={16} />
                                    <span>{t('planner.mobile.share_whatsapp_team')}</span>
                                </button>

                                <button
                                    type="button"
                                    disabled={shifts.length === 0}
                                    onClick={() => {
                                        const txt = buildTeamScheduleText({
                                            storeName: formatStoreName(storeName || 'Tacos Gavilan'),
                                            weekDays,
                                            employees,
                                            shifts,
                                            language
                                        })
                                        handleCopyOrShareText(txt, true)
                                    }}
                                    className="w-full py-3 px-4 rounded-2xl bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 disabled:opacity-45 text-gray-800 dark:text-slate-100 font-bold text-xs flex items-center justify-center gap-2 active:scale-98 transition-all"
                                >
                                    <Copy size={15} />
                                    <span>{t('planner.mobile.copy_schedule')}</span>
                                </button>

                                {printSheetUrl ? (
                                    <button
                                        type="button"
                                        onClick={() => { setIsSendHubOpen(false); handleOpenPrintSheet(); }}
                                        className="w-full py-3 px-4 rounded-2xl bg-gray-900 dark:bg-slate-700 hover:bg-black text-white font-bold text-xs flex items-center justify-center gap-2 active:scale-98 transition-all"
                                    >
                                        <Printer size={15} />
                                        <span>{t('planner.mobile.open_print_pdf')}</span>
                                    </button>
                                ) : onPrint && (
                                    <button
                                        type="button"
                                        onClick={() => { setIsSendHubOpen(false); onPrint(); }}
                                        className="w-full py-3 px-4 rounded-2xl bg-gray-900 dark:bg-slate-700 hover:bg-black text-white font-bold text-xs flex items-center justify-center gap-2 active:scale-98 transition-all"
                                    >
                                        <Printer size={15} />
                                        <span>{t('planner.mobile.open_print_pdf')}</span>
                                    </button>
                                )}
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* MOBILE TOOLS DRAWER */}
            <AnimatePresence>
                {isToolsDrawerOpen && (
                    <div
                        onClick={() => setIsToolsDrawerOpen(false)}
                        className="fixed inset-0 z-[120] flex items-end justify-center bg-black/60 backdrop-blur-xs"
                    >
                        <motion.div
                            initial={{ y: '100%' }}
                            animate={{ y: 0 }}
                            exit={{ y: '100%' }}
                            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                            onClick={(e) => e.stopPropagation()}
                            className="bg-white dark:bg-slate-900 rounded-t-3xl w-full max-w-md max-h-[88dvh] overflow-y-auto p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-2xl border-t border-gray-200 dark:border-slate-800 space-y-4"
                        >
                            <div className="flex justify-between items-center border-b border-gray-100 dark:border-slate-800 pb-3">
                                <div>
                                    <h3 className="font-black text-base text-gray-900 dark:text-white flex items-center gap-2">
                                        <Sliders size={18} className="text-indigo-600" />
                                        <span>{t('planner.mobile.tools')}</span>
                                    </h3>
                                    {storeName && (
                                        <p className="text-[11px] font-bold text-gray-500 dark:text-slate-400">
                                            {formatStoreName(storeName)}
                                        </p>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setIsToolsDrawerOpen(false)}
                                    className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-400"
                                >
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="grid grid-cols-2 gap-2.5">
                                {onSyncToast && (
                                    <button
                                        type="button"
                                        onClick={() => { setIsToolsDrawerOpen(false); onSyncToast(); }}
                                        disabled={isSyncingEmployees}
                                        className="flex flex-col items-center justify-center p-3.5 rounded-2xl bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-800 dark:text-slate-200 font-bold text-xs gap-2 active:scale-95 transition-all"
                                    >
                                        <RefreshCcw size={20} className={`text-indigo-600 ${isSyncingEmployees ? 'animate-spin' : ''}`} />
                                        <span className="text-center">{t('planner.mobile.sync_toast')}</span>
                                    </button>
                                )}

                                {onGenerateSmart && (
                                    <button
                                        type="button"
                                        onClick={() => { setIsToolsDrawerOpen(false); onGenerateSmart(); }}
                                        disabled={isGeneratingAPI}
                                        className="flex flex-col items-center justify-center p-3.5 rounded-2xl bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 text-purple-900 dark:text-purple-200 font-bold text-xs gap-2 active:scale-95 transition-all"
                                    >
                                        <Bot size={20} className={`text-purple-600 ${isGeneratingAPI ? 'animate-spin' : ''}`} />
                                        <span className="text-center">{t('planner.mobile.smart_gen')}</span>
                                    </button>
                                )}

                                {onCloneClick && (
                                    <button
                                        type="button"
                                        onClick={() => { setIsToolsDrawerOpen(false); onCloneClick(); }}
                                        className="flex flex-col items-center justify-center p-3.5 rounded-2xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-200 font-bold text-xs gap-2 active:scale-95 transition-all"
                                    >
                                        <Copy size={20} className="text-blue-600" />
                                        <span className="text-center">{t('planner.mobile.clone_week')}</span>
                                    </button>
                                )}

                                {onOpenTemplates && (
                                    <button
                                        type="button"
                                        onClick={() => { setIsToolsDrawerOpen(false); onOpenTemplates(); }}
                                        className="flex flex-col items-center justify-center p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 font-bold text-xs gap-2 active:scale-95 transition-all"
                                    >
                                        <LayoutTemplate size={20} className="text-amber-600" />
                                        <span className="text-center">{t('planner.mobile.templates_btn')}</span>
                                    </button>
                                )}

                                {(printSheetUrl || onPrint) && (
                                    <button
                                        type="button"
                                        onClick={() => { setIsToolsDrawerOpen(false); handleOpenPrintSheet(); }}
                                        className="flex flex-col items-center justify-center p-3.5 rounded-2xl bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-800 dark:text-slate-200 font-bold text-xs gap-2 active:scale-95 transition-all"
                                    >
                                        <Printer size={20} className="text-gray-700 dark:text-slate-300" />
                                        <span className="text-center">{t('planner.mobile.open_print_pdf')}</span>
                                    </button>
                                )}

                                <Link
                                    href={`/descansos?store=${encodeURIComponent(selectedStoreId)}&date=${encodeURIComponent(dateStr)}`}
                                    onClick={() => setIsToolsDrawerOpen(false)}
                                    className="flex flex-col items-center justify-center p-3.5 rounded-2xl bg-orange-50 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-800 text-orange-900 dark:text-orange-200 font-bold text-xs gap-2 active:scale-95 transition-all"
                                >
                                    <Coffee size={20} className="text-orange-600" />
                                    <span className="text-center">{t('planner.mobile.ai_breaks')}</span>
                                </Link>
                            </div>

                            {onClearWeek && shifts.length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => { setIsToolsDrawerOpen(false); onClearWeek(); }}
                                    className="w-full py-2.5 px-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 font-bold text-xs flex items-center justify-center gap-2 active:scale-98 transition-all"
                                >
                                    <Trash2 size={15} />
                                    <span>{t('planner.mobile.clear_week_btn')}</span>
                                </button>
                            )}
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* FLOATING NATIVE MOBILE TOAST */}
            <AnimatePresence>
                {mobileToast && (
                    <motion.div
                        initial={{ opacity: 0, y: -20, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -20, scale: 0.95 }}
                        className={`fixed top-[68px] left-1/2 -translate-x-1/2 z-[260] px-4 py-2.5 rounded-full shadow-2xl flex items-center gap-2 text-xs font-black select-none max-w-[92vw] ${
                            mobileToast.type === 'error'
                                ? 'bg-red-600 text-white shadow-red-500/30'
                                : 'bg-gray-900/95 dark:bg-white/95 text-white dark:text-gray-900 shadow-black/30 backdrop-blur-md'
                        }`}
                    >
                        {mobileToast.type === 'error' ? (
                            <AlertCircle size={15} className="text-white shrink-0" />
                        ) : (
                            <CheckCircle2 size={15} className="text-emerald-400 dark:text-emerald-600 shrink-0" />
                        )}
                        <span className="truncate">{mobileToast.message}</span>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
