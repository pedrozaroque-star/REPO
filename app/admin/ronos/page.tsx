/**
 * @module app/admin/ronos/page
 * @description Módulo de Auditoría Laboral RONOS & Conciliación Cingular HR / Simplify HR.
 *   - Interfaz ejecutiva con estética moderna, limpia y de máxima legibilidad optimizada para auditorías operativas y financieras.
 *   - Formateo inteligente de horarios a 12 horas (AM/PM) en zona horaria America/Los_Angeles y tarjetas visuales por día.
 *   - Monitoreo en tiempo real de ponchadas, horas extras (OT 1.5x / DT 2.0x), descansos de comida (Meal Breaks) y fotos de reloj checador (AWS S3).
 *   - Motor de Cumplimiento de Leyes Laborales de California (IWC Wage Order 5 / California Labor Code § 512):
 *     * Regla de 5ta Hora (Meal Penalty > 5.0h) y descansos cortos (< 30 min) con cálculo de fuga en USD.
 *     * Detección de tarjetas rotas/incompletas (Broken Timecards).
 *     * Exención legal de 6.0 horas (turnos cortos sin penalización).
 *   - Despacho de avisos formales por correo electrónico a colaboradores y a la escalera de mando.
 *   - Pre-Facturación y Conciliación PEO Cingular HR (Exempt Salaried vs Non-Exempt Hourly) sincronizada con salarios de Simplify HR.
 *   - Exportación de auditoría a CSV oficial compatible con contabilidad y nómina.
 *
 * @businessRules
 *   - Acceso exclusivo para usuarios con rol 'admin' (Dirección General y Auditoría Ejecutiva).
 *   - El día laboral inicia a las 6:00 AM y termina a las 5:59 AM del día siguiente. El turno PM inicia a las 5:00 PM.
 *   - Cubre las 16 ubicaciones de Tacos Gavilan (15 restaurantes + La Bodega Vernon #28).
 *   - Facturación Cingular HR: Margen base del 26.00% sobre sueldo de personal por hora (BILL_RATE = PAY_RATE * 1.26).
 *
 * @dataFlow
 *   RONOS API v2.0 -> `ronos_employee_timecards_cache` (Supabase) + Simplify HR / Toast -> `payroll-calculator` -> /admin/ronos.
 *
 * @notes
 *   - Manejo multi-tienda robusto: Al cambiar de tienda se preserva la fecha del ciclo activo (`targetStartDate`) para sincronizar automáticamente los week IDs específicos de cada tienda.
 *   - Filtro global "Todas las Tiendas": Agrega la opción consolidada para visualizar métricas, nómina ($850k+) y vinculaciones de toda la cadena (15 Tiendas + Bodega).
 */

'use client'

import React, { useState, useEffect, useMemo } from 'react'
import ProtectedRoute from '@/components/ProtectedRoute'
import { useLanguage } from '@/lib/i18n'
import {
  Users,
  Clock,
  AlertTriangle,
  DollarSign,
  Camera,
  RefreshCw,
  Search,
  Filter,
  Download,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  Calendar,
  Building2,
  BarChart3,
  Link as LinkIcon,
  Mail,
  UserCheck,
  UserX,
  Send,
  AlertCircle,
  FileSpreadsheet,
  Lock,
  Unlock,
  Check,
  Info,
  RotateCw,
  LogOut,
  Menu,
  FileText,
  MapPin,
  Coffee,
  Plane,
  PlusCircle,
  ArrowLeft,
  Edit3,
  Receipt,
  Sparkles,
  ArrowRight,
  Sun,
  Moon,
  CheckCircle
} from 'lucide-react'
import { isEmployeeSalaried } from '@/lib/payroll-calculator'

// ============================================================================
// HELPERS DE FORMATEO (FECHAS Y HORAS LEGIBLES)
// ============================================================================

/**
 * Convierte timestamps ISO (ej. 2026-08-24T16:50:46.264-07:00) en hora legible 12h (ej. 4:50 PM)
 */
function formatTime12h(val?: string): string {
  if (!val) return ''
  const trimmed = val.trim()
  if (/^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(trimmed)) return trimmed.toUpperCase()

  try {
    const d = new Date(val)
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'America/Los_Angeles'
      })
    }
  } catch {}

  const match = val.match(/T(\d{2}):(\d{2})/)
  if (match) {
    let h = parseInt(match[1], 10)
    const m = match[2]
    const ampm = h >= 12 ? 'PM' : 'AM'
    h = h % 12 || 12
    return `${h}:${m} ${ampm}`
  }

  return val
}

/**
 * Convierte cualquier fecha (YYYY-MM-DD o ISO) a formato estándar oficial de USA: MM/DD/YYYY
 */
function formatUsaDate(dateStr?: string | null): string {
  if (!dateStr) return ''
  const clean = dateStr.substring(0, 10).trim()
  const parts = clean.split('-')
  if (parts.length === 3 && parts[0].length === 4) {
    // YYYY-MM-DD -> MM/DD/YYYY
    return `${parts[1]}/${parts[2]}/${parts[0]}`
  }
  try {
    const d = new Date(clean)
    if (!isNaN(d.getTime())) {
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
      const dd = String(d.getUTCDate()).padStart(2, '0')
      const yyyy = d.getUTCFullYear()
      return `${mm}/${dd}/${yyyy}`
    }
  } catch {}
  return clean
}

/**
 * Convierte un rango de fechas a formato estándar de USA: MM/DD/YYYY - MM/DD/YYYY
 */
function formatUsaDateRange(start?: string | null, end?: string | null): string {
  const s = formatUsaDate(start)
  const e = formatUsaDate(end)
  if (s && e) return `${s} - ${e}`
  return s || e || ''
}

/**
 * Convierte strings de fecha en día de la semana y fecha en formato USA (MM/DD/YYYY)
 */
function formatDayDetails(dateStr?: string, fallbackDay?: string): { dayOfWeek: string; dateFormatted: string } {
  if (!dateStr) return { dayOfWeek: fallbackDay || '', dateFormatted: '' }
  const cleanDate = dateStr.substring(0, 10)
  const parts = cleanDate.split('-').map(Number)
  if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
    const d = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0)
    const dayOfWeek = d.toLocaleDateString('es-ES', { weekday: 'long' })
    const mm = String(parts[1]).padStart(2, '0')
    const dd = String(parts[2]).padStart(2, '0')
    const yyyy = parts[0]
    return {
      dayOfWeek: dayOfWeek.charAt(0).toUpperCase() + dayOfWeek.slice(1),
      dateFormatted: `${mm}/${dd}/${yyyy}` // Formato USA: MM/DD/YYYY
    }
  }
  return { dayOfWeek: fallbackDay || '', dateFormatted: formatUsaDate(cleanDate) }
}

// ============================================================================
// INTERFACES & TIPOS
// ============================================================================

interface StoreOption {
  tegStoreId: number
  tegCode: string
  tegName: string
  ronosCompanyId: number
  ronosName: string
  isBodega?: boolean
}

interface WorkWeekOption {
  weekId: number
  companyId: number
  startDate: string
  endDate: string
}

/**
 * Agrupa las semanas en periodos bisemanales alineados con el ciclo oficial de Cingular HR
 * Serie anclada: Lunes 10 de Agosto de 2026 al Domingo 23 de Agosto de 2026 (Sem 154242 + 154243)
 */
function computeCingularBiWeeklyPeriods(weeks: WorkWeekOption[]): Array<{
  id: string
  weekIds: [number, number]
  startDate: string
  endDate: string
  label: string
}> {
  if (!weeks || !Array.isArray(weeks) || weeks.length === 0) return []

  const ANCHOR_DATE = new Date('2026-08-10T00:00:00') // Known Week 1 Monday (Aug 10 - Aug 23 cycle)
  const MS_PER_DAY = 24 * 60 * 60 * 1000

  // Group weeks by their bi-weekly cycle start date
  const cyclesMap = new Map<string, { week1?: WorkWeekOption; week2?: WorkWeekOption }>()

  for (const w of weeks) {
    if (!w?.startDate) continue
    const sDate = new Date(w.startDate.substring(0, 10) + 'T00:00:00')
    if (isNaN(sDate.getTime())) continue

    const daysDiff = Math.round((sDate.getTime() - ANCHOR_DATE.getTime()) / MS_PER_DAY)
    const weeksDiff = Math.round(daysDiff / 7)

    let cycleStartDate: Date
    let isWeek1 = false

    if (weeksDiff % 2 === 0) {
      // Week 1 of the cycle (e.g. Aug 10, Jul 27, Jul 13, Jun 29, Aug 24)
      cycleStartDate = sDate
      isWeek1 = true
    } else {
      // Week 2 of the cycle (e.g. Aug 17, Aug 3, Jul 20, Jul 6) -> Cycle started 7 days ago
      cycleStartDate = new Date(sDate.getTime() - 7 * MS_PER_DAY)
      isWeek1 = false
    }

    const cycleKey = cycleStartDate.toISOString().substring(0, 10)
    if (!cyclesMap.has(cycleKey)) {
      cyclesMap.set(cycleKey, {})
    }
    const cycle = cyclesMap.get(cycleKey)!
    if (isWeek1) {
      cycle.week1 = w
    } else {
      cycle.week2 = w
    }
  }

  // Convert cyclesMap into sorted period list
  const sortedCycleKeys = Array.from(cyclesMap.keys()).sort((a, b) => b.localeCompare(a))

  const periods: Array<{
    id: string
    weekIds: [number, number]
    startDate: string
    endDate: string
    label: string
  }> = []

  for (const cKey of sortedCycleKeys) {
    const cycle = cyclesMap.get(cKey)!
    if (cycle.week1 && cycle.week2) {
      // Complete bi-weekly period (2 weeks)
      periods.push({
        id: `${cycle.week1.weekId},${cycle.week2.weekId}`,
        weekIds: [cycle.week1.weekId, cycle.week2.weekId],
        startDate: cycle.week1.startDate.substring(0, 10),
        endDate: cycle.week2.endDate.substring(0, 10),
        label: `${formatUsaDate(cycle.week1.startDate)} - ${formatUsaDate(cycle.week2.endDate)}`
      })
    } else if (cycle.week1 && !cycle.week2) {
      // In-progress period (only week 1 available so far)
      periods.push({
        id: `${cycle.week1.weekId}`,
        weekIds: [cycle.week1.weekId, cycle.week1.weekId],
        startDate: cycle.week1.startDate.substring(0, 10),
        endDate: cycle.week1.endDate.substring(0, 10),
        label: `${formatUsaDate(cycle.week1.startDate)} - ${formatUsaDate(cycle.week1.endDate)}`
      })
    } else if (!cycle.week1 && cycle.week2) {
      periods.push({
        id: `${cycle.week2.weekId}`,
        weekIds: [cycle.week2.weekId, cycle.week2.weekId],
        startDate: cycle.week2.startDate.substring(0, 10),
        endDate: cycle.week2.endDate.substring(0, 10),
        label: `${formatUsaDate(cycle.week2.startDate)} - ${formatUsaDate(cycle.week2.endDate)}`
      })
    }
  }

  return periods
}

interface AtomicPunch {
  punchId: number
  employeeId: number
  workWeekId: number
  punchType: number
  punchTypeName: string
  punchTime: string
  localTime: string
  photoURL?: string
  addedPunch?: boolean
  offline?: boolean
}

interface ComplianceViolation {
  type: string
  severity: 'danger' | 'warning' | 'info'
  title: string
  description: string
  estimatedCostUsd: number
  minutes?: number
}

interface DailyRecord {
  date: string
  dayName: string
  totalHours: number
  regularHours: number
  overtimeHours: number
  doubleTimeHours: number
  lunchHours: number
  lunchDurationMinutes: number
  clockInTime?: string
  clockInPhoto?: string
  lunchStartTime?: string
  lunchStartPhoto?: string
  lunchEndTime?: string
  lunchEndPhoto?: string
  clockOutTime?: string
  clockOutPhoto?: string
  punches: AtomicPunch[]
  violations: ComplianceViolation[]
  vacationHours?: number
  sickHours?: number
  holidayHours?: number
  jobTitle?: string
  assignmentCode?: string
}

interface EmployeeTimecard {
  employeeUserId: number
  firstName: string
  lastName: string
  fullName: string
  pin: string
  active: boolean
  totalWeeklyHours: number
  regularHours: number
  overtimeHours: number
  doubleTimeHours: number
  mealPenaltyCount: number
  brokenHours: boolean
  totalViolationsCount: number
  totalEstimatedPenaltyCostUsd: number
  toastEmail: string | null
  jobTitle: string | null
  isSalaried?: boolean
  payType?: 'Hourly' | 'Yearly' | string
  payRate?: number
  days: DailyRecord[]
  transferredToStore?: string | null
  locked?: boolean
}

interface StoreAuditData {
  companyId?: number
  ronosCompanyId?: number
  storeCode: string
  storeName: string
  weekId: number
  startDate: string
  endDate: string
  totalEmployeesCount: number
  activeEmployeesCount: number
  totalWeeklyHours: number
  totalRegularHours: number
  totalOvertimeHours: number
  totalDoubleTimeHours: number
  totalMealPenaltiesCount: number
  totalEstimatedPenaltyCostUsd: number
  totalEstimatedOvertimeCostUsd: number
  complianceScore: number
  employees: EmployeeTimecard[]
  cachedAt: string
}

interface ChainStoreSummary {
  tegStoreId: number
  storeCode: string
  storeName: string
  ronosCompanyId: number
  ronosName: string
  isBodega?: boolean
  weekId: number
  startDate: string
  endDate: string
  totalEmployees: number
  activeEmployees: number
  totalHours: number
  regularHours: number
  overtimeHours: number
  mealPenaltiesCount: number
  estimatedPenaltyCostUsd: number
  complianceScore: number
  brokenEmployeesCount: number
}

interface ChainAuditData {
  weekId?: number
  startDate?: string
  endDate?: string
  totalStores: number
  totalActiveEmployees: number
  totalChainEmployees?: number
  totalChainHours?: number
  chainTotalHours: number
  chainRegularHours?: number
  totalOvertimeHours?: number
  chainOvertimeHours: number
  totalMealPenalties?: number
  chainMealPenaltiesCount: number
  totalPenaltyCostUsd?: number
  chainPenaltyCostUsd: number
  chainAverageComplianceScore: number
  stores: ChainStoreSummary[]
  cachedAt?: string
}

interface ToastCandidate {
  id: string
  fullName?: string
  full_name?: string
  first_name?: string
  last_name?: string
  email: string | null
  phone: string | null
  jobTitle?: string | null
  job_title?: string | null
}

interface MappedEmployeeItem {
  ronosEmployeeUserId: number
  ronosCompanyId: number
  ronosFullName: string
  ronosPin: string
  ronosActive: boolean
  toastEmployeeId: string | null
  toastFullName: string | null
  toastEmail: string | null
  toastPhone: string | null
  toastJobTitle: string | null
  mappingType: 'auto' | 'manual' | 'inactive' | 'unmapped'
  isConfirmed: boolean
  confidenceScore: number
  transferredToStore?: string | null
}

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================

function RonosLaborAuditContent() {
  const { t, language } = useLanguage()

  // Pestañas: 'store' | 'chain' | 'mapping' | 'payroll'
  const [activeTab, setActiveTab] = useState<'store' | 'chain' | 'mapping' | 'payroll'>('store')

  // Selección de tienda y semana (Default: 0 = Todas las Tiendas)
  const [selectedCompanyId, setSelectedCompanyId] = useState<number>(0)
  const [selectedWeekId, setSelectedWeekId] = useState<number | undefined>(undefined)

  // Datos principales
  const [stores, setStores] = useState<StoreOption[]>([])
  const [weeks, setWeeks] = useState<WorkWeekOption[]>([])
  const [storeData, setStoreData] = useState<StoreAuditData | null>(null)
  const [chainData, setChainData] = useState<ChainAuditData | null>(null)

  // Vista de empleado individual reactiva a storeData (evita desactualización al reparar ponchadas)
  const [selectedEmployeeUserId, setSelectedEmployeeUserId] = useState<number | null>(null)
  const selectedEmployeeDetail = useMemo(() => {
    if (!selectedEmployeeUserId || !Array.isArray(storeData?.employees)) return null
    return storeData.employees.find(e => e.employeeUserId === selectedEmployeeUserId) || null
  }, [selectedEmployeeUserId, storeData])
  const setSelectedEmployeeDetail = (emp: EmployeeTimecard | null) => {
    setSelectedEmployeeUserId(emp?.employeeUserId ?? null)
  }
  const [lastSyncedTime, setLastSyncedTime] = useState<string | null>(null)

  // Filtros de visualización estilo RONOS (Screenshot 2 / 4)
  const [viewingFilter, setViewingFilter] = useState<'all' | 'salary' | 'hourly'>('all')
  const [showInactive, setShowInactive] = useState<boolean>(false)

  // Payroll / Cingular HR Data States
  const [payrollData, setPayrollData] = useState<any | null>(null)
  const [payrollLoading, setPayrollLoading] = useState<boolean>(false)
  const [payrollBiWeekly, setPayrollBiWeekly] = useState<boolean>(true)
  const [selectedBiWeeklyPeriod, setSelectedBiWeeklyPeriod] = useState<string>('')
  const [payrollSearch, setPayrollSearch] = useState<string>('')
  const [payrollFilterType, setPayrollFilterType] = useState<'all' | 'exact' | 'saving' | 'variance' | 'pto' | 'violations'>('all')

  // Chain / Multi-Store View States
  const [chainSortField, setChainSortField] = useState<'hours' | 'ot' | 'penalties' | 'penaltyCost' | 'compliance' | 'store'>('hours')
  const [chainSortAsc, setChainSortAsc] = useState<boolean>(false)

  // Mapping Data States
  const [mappingsList, setMappingsList] = useState<MappedEmployeeItem[]>([])
  const [toastCandidates, setToastCandidates] = useState<ToastCandidate[]>([])
  const [mappingStats, setMappingStats] = useState<{ totalRonos: number; autoMatched: number; manuallyMatched: number; inactive: number; unmapped: number }>({
    totalRonos: 0,
    autoMatched: 0,
    manuallyMatched: 0,
    inactive: 0,
    unmapped: 0
  })
  const [mappingLoading, setMappingLoading] = useState<boolean>(false)
  const [mappingSearch, setMappingSearch] = useState<string>('')
  const [mappingFilter, setMappingFilter] = useState<'all' | 'unmapped' | 'matched' | 'inactive'>('all')
  const [savingMappingId, setSavingMappingId] = useState<number | null>(null)
  const [refreshingTransfers, setRefreshingTransfers] = useState<boolean>(false)

  // Loading & Sync States
  const [loading, setLoading] = useState<boolean>(true)
  const [syncing, setSyncing] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  // Búsqueda y filtrado rápido
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [filterType, setFilterType] = useState<'active' | 'all' | 'violations' | 'broken'>('all')

  // Modal Photo Preview (AWS S3)
  const [photoModal, setPhotoModal] = useState<{
    isOpen: boolean
    photoUrl: string
    title: string
    employeeName: string
    timestamp: string
    rotation: number
  }>({
    isOpen: false,
    photoUrl: '',
    title: '',
    employeeName: '',
    timestamp: '',
    rotation: 0
  })

  // Modal Send Violation Warning Email
  const [emailModal, setEmailModal] = useState<{
    isOpen: boolean
    employeeUserId: number
    employeeName: string
    employeeEmail: string
    employeePin: string
    employeeJobTitle: string
    violationDate: string
    violationType: string
    violationTitle: string
    violationDescription: string
    clockInTime?: string
    lunchStartTime?: string
    lunchEndTime?: string
    clockOutTime?: string
    totalHoursWorked?: number
    additionalNotes: string
    escalera: {
      managerName: string | null
      managerEmail: string | null
      supervisorName: string | null
      supervisorEmail: string | null
      allCcEmails: string[]
    } | null
    isSending: boolean
    sendSuccess: boolean
    sendError: string | null
  }>({
    isOpen: false,
    employeeUserId: 0,
    employeeName: '',
    employeeEmail: '',
    employeePin: '',
    employeeJobTitle: '',
    violationDate: '',
    violationType: '',
    violationTitle: '',
    violationDescription: '',
    additionalNotes: '',
    escalera: null,
    isSending: false,
    sendSuccess: false,
    sendError: null
  })

  // 1. Centralized Store Change Handler (Soporta Todas las Tiendas y Cruce de Fechas)
  const handleStoreChange = async (newCompanyId: number) => {
    setSelectedCompanyId(newCompanyId)

    if (newCompanyId === 0) {
      // Caso: Todas las Tiendas (Cadena Completa) - permanece en la pestaña activa
      if (activeTab === 'payroll') {
        const periodId = payrollBiWeekly ? (selectedBiWeeklyPeriod || biWeeklyPeriods[0]?.id || '') : selectedWeekId
        fetchPayroll(0, periodId, payrollBiWeekly)
      } else if (activeTab === 'mapping') {
        fetchMappings(0)
      } else if (activeTab === 'chain' || activeTab === 'store') {
        fetchChainAudit(selectedWeekId)
      }
      return
    }

    // Tienda individual - permanece en la pestaña activa
    // Mantener la sincronización cronológica por fecha (targetStartDate)
    const currentPeriod = biWeeklyPeriods.find(p => p.id === selectedBiWeeklyPeriod)
    const targetStartDate = currentPeriod?.startDate || weeks.find(w => w.weekId === selectedWeekId)?.startDate?.substring(0, 10)

    if (activeTab === 'payroll') {
      await fetchStoreAudit(newCompanyId, undefined, false, targetStartDate)
    } else if (activeTab === 'mapping') {
      await fetchMappings(newCompanyId)
    } else if (activeTab === 'store') {
      await fetchStoreAudit(newCompanyId, undefined, false, targetStartDate)
    } else if (activeTab === 'chain') {
      await fetchChainAudit(selectedWeekId)
    }
  }

  // 2. Fetch Store Audit Data (Tab 1)
  const fetchStoreAudit = async (
    companyId: number,
    weekId?: number,
    force = false,
    targetStartDate?: string
  ) => {
    setLoading(true)
    setError(null)
    try {
      let url = `/api/ronos/punches?companyId=${companyId}`
      if (weekId) url += `&weekId=${weekId}`
      if (targetStartDate) url += `&startDate=${targetStartDate}`
      if (force) url += `&force=true`
      url += `&_t=${Date.now()}`

      const res = await fetch(url, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        }
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody?.error || `Error de red con RONOS (${res.status})`)
      }
      const json = await res.json()
      if (!json?.success) {
        throw new Error(json?.error || 'Error al obtener datos de RONOS')
      }

      setStoreData(json.data)
      if (Array.isArray(json.weeks) && json.weeks.length > 0) {
        setWeeks(json.weeks)

        // 1. Resolver selectedWeekId para la nueva tienda
        let resolvedWeek = targetStartDate
          ? json.weeks.find((w: any) => w?.startDate?.substring(0, 10) === targetStartDate)
          : null
        if (!resolvedWeek && weekId) {
          resolvedWeek = json.weeks.find((w: any) => w?.weekId === weekId) || null
        }
        if (!resolvedWeek) {
          resolvedWeek = json.weeks.find((w: any) => new Date(w?.endDate || '').getTime() <= Date.now()) || json.weeks[0]
        }
        const resolvedWeekId = resolvedWeek?.weekId || json.weeks[0].weekId
        setSelectedWeekId(resolvedWeekId)

        // 2. Resolver selectedBiWeeklyPeriod para la nueva tienda
        const computedPeriods = computeCingularBiWeeklyPeriods(json.weeks)
        let resolvedPeriod = targetStartDate
          ? computedPeriods.find(p => p.startDate === targetStartDate)
          : null
        if (!resolvedPeriod) {
          const todayStr = new Date().toISOString().substring(0, 10)
          resolvedPeriod = computedPeriods.find(p => p.weekIds[0] !== p.weekIds[1] && p.endDate <= todayStr) || computedPeriods.find(p => p.weekIds[0] !== p.weekIds[1]) || computedPeriods[0]
        }
        const resolvedPeriodId = resolvedPeriod?.id || (computedPeriods[0]?.id || '')
        setSelectedBiWeeklyPeriod(resolvedPeriodId)

        // 3. Si la pestaña activa es nómina, disparar de inmediato la consulta de nómina para esta tienda
        if (activeTab === 'payroll') {
          fetchPayroll(companyId, payrollBiWeekly ? resolvedPeriodId : resolvedWeekId, payrollBiWeekly)
        }
      }
      if (Array.isArray(json.stores)) setStores(json.stores)
    } catch (err: any) {
      console.error('Fetch store audit error:', err)
      setError(err?.message || 'Error de conexión con RONOS API')
    } finally {
      setLoading(false)
    }
  }

  // 3. Carga Inicial al Montar Componente
  useEffect(() => {
    // Si viene tab en la URL, respetarla
    let initialTab = activeTab
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const tabParam = params.get('tab')
      if (tabParam === 'payroll' || tabParam === 'chain' || tabParam === 'store' || tabParam === 'mapping') {
        initialTab = tabParam
        setActiveTab(tabParam)
      }
    }

    // Cargar catálogos base (tiendas y semanas de referencia desde Lynwood)
    fetch('/api/ronos/punches?companyId=34&_t=' + Date.now())
      .then(res => res.json())
      .then(json => {
        if (Array.isArray(json.stores)) setStores(json.stores)
        if (Array.isArray(json.weeks) && json.weeks.length > 0) {
          setWeeks(json.weeks)
          const computedPeriods = computeCingularBiWeeklyPeriods(json.weeks)
          const todayStr = new Date().toISOString().substring(0, 10)
          const closedCompletePeriod = computedPeriods.find(p => p.weekIds[0] !== p.weekIds[1] && p.endDate <= todayStr)
          const defaultPeriod = closedCompletePeriod || computedPeriods.find(p => p.weekIds[0] !== p.weekIds[1]) || computedPeriods[0]
          if (defaultPeriod) {
            setSelectedBiWeeklyPeriod(defaultPeriod.id)
            if (initialTab === 'payroll') {
              fetchPayroll(0, defaultPeriod.id, true)
            }
          }
        }
      })
      .catch(console.error)

    if (initialTab === 'chain' || (initialTab === 'store' && selectedCompanyId === 0)) {
      fetchChainAudit(selectedWeekId)
    } else if (initialTab === 'mapping') {
      fetchMappings(selectedCompanyId)
    } else if (initialTab === 'payroll') {
      fetchPayroll(selectedCompanyId, undefined, true)
    } else if (initialTab === 'store' && selectedCompanyId > 0) {
      fetchStoreAudit(selectedCompanyId, selectedWeekId)
    }
  }, [])

  // 4. Cargar datos al cambiar de pestaña
  useEffect(() => {
    if (activeTab === 'chain') {
      fetchChainAudit(selectedWeekId)
    } else if (activeTab === 'mapping') {
      fetchMappings(selectedCompanyId)
    } else if (activeTab === 'payroll') {
      const periodId = payrollBiWeekly ? (selectedBiWeeklyPeriod || biWeeklyPeriods[0]?.id || '') : selectedWeekId
      fetchPayroll(selectedCompanyId, periodId, payrollBiWeekly)
    } else if (activeTab === 'store') {
      fetchStoreAudit(selectedCompanyId > 0 ? selectedCompanyId : 34, selectedWeekId)
    }
  }, [activeTab])

  // 3. Fetch Chain Audit Data (Tab 2)
  const fetchChainAudit = async (weekId?: number, force = false) => {
    setLoading(true)
    setError(null)
    try {
      let url = `/api/ronos/punches?chain=true`
      if (weekId) url += `&weekId=${weekId}`
      if (force) url += `&force=true`
      url += `&_t=${Date.now()}`

      const res = await fetch(url, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        }
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody?.error || `Error al obtener auditoría corporativa (${res.status})`)
      }
      const json = await res.json()
      if (!json?.success) {
        throw new Error(json?.error || 'Error al obtener auditoría corporativa')
      }

      setChainData(json.data)
    } catch (err: any) {
      console.error('Fetch chain audit error:', err)
      setError(err?.message || 'Error de conexión con RONOS API')
    } finally {
      setLoading(false)
    }
  }

  // 4. Fetch Payroll Data (Tab 4)
  const fetchPayroll = async (companyId: number, periodId?: number | string, isBiWeekly = true) => {
    setPayrollLoading(true)
    try {
      let url = `/api/ronos/payroll?companyId=${companyId}&biWeekly=${isBiWeekly}`
      if (periodId) {
        url += `&weekIds=${periodId}`
      }
      url += `&_t=${Date.now()}`

      const res = await fetch(url, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        }
      })
      if (!res.ok) throw new Error(`Error de nómina (${res.status})`)
      const json = await res.json().catch(() => ({}))
      if (json?.success && json?.data) {
        setPayrollData(json.data)
      }
    } catch (err: any) {
      console.error('Fetch payroll error:', err)
    } finally {
      setPayrollLoading(false)
    }
  }

  // 5. Fetch Employee Mappings (Tab 3)
  const fetchMappings = async (companyId: number) => {
    setMappingLoading(true)
    try {
      const res = await fetch(`/api/ronos/mappings?companyId=${companyId}&_t=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        }
      })
      if (!res.ok) throw new Error(`Error al obtener mapeos (${res.status})`)
      const json = await res.json().catch(() => ({}))
      if (json?.success && json?.data) {
        setMappingsList(Array.isArray(json.data.mappings) ? json.data.mappings : [])
        const rawCandidates = Array.isArray(json.data.toastCandidates) ? json.data.toastCandidates : []
        const normalized = rawCandidates.map((tc: any) => ({
          id: String(tc.id || ''),
          fullName: String(tc.full_name || tc.fullName || `${tc.first_name || ''} ${tc.last_name || ''}`.trim() || 'Colaborador'),
          full_name: String(tc.full_name || tc.fullName || `${tc.first_name || ''} ${tc.last_name || ''}`.trim() || 'Colaborador'),
          email: tc.email ? String(tc.email) : null,
          phone: tc.phone ? String(tc.phone) : null,
          jobTitle: String(tc.job_title || tc.jobTitle || 'Colaborador'),
          job_title: String(tc.job_title || tc.jobTitle || 'Colaborador')
        }))
        setToastCandidates(normalized)
        setMappingStats(json.data.stats || { totalRonos: 0, autoMatched: 0, manuallyMatched: 0, inactive: 0, unmapped: 0 })
      }
    } catch (err: any) {
      console.error('Fetch mappings error:', err)
    } finally {
      setMappingLoading(false)
    }
  }

  // Handle Refresh Transfers
  const handleRefreshTransfers = async () => {
    setRefreshingTransfers(true)
    try {
      const res = await fetch(`/api/ronos/refresh-transfers?_t=${Date.now()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
        body: JSON.stringify({ companyId: selectedCompanyId, forceScan: true })
      })
      if (!res.ok) throw new Error(`Error en refresh de traslados (${res.status})`)
      const json = await res.json().catch(() => ({}))
      if (json?.success) {
        await fetchMappings(selectedCompanyId)
        await fetchStoreAudit(selectedCompanyId, selectedWeekId, true)
      }
    } catch (err) {
      console.error('Refresh transfers error:', err)
    } finally {
      setRefreshingTransfers(false)
    }
  }

  // Handle Save Single Mapping
  const handleSaveSingleMapping = async (item: MappedEmployeeItem, selectedToastId: string) => {
    if (!item) return
    setSavingMappingId(item.ronosEmployeeUserId)
    const isInactive = selectedToastId === 'INACTIVE'
    const isUnlinking = selectedToastId === 'UNLINK'

    const toastMatch = (!isInactive && !isUnlinking && Array.isArray(toastCandidates)) ? toastCandidates.find(t => t?.id === selectedToastId) ?? null : null

    try {
      await fetch('/api/ronos/mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: selectedCompanyId,
          ronosEmployeeUserId: item.ronosEmployeeUserId,
          ronosFullName: item.ronosFullName,
          ronosPin: item.ronosPin,
          toastEmployeeId: isUnlinking ? null : (isInactive ? 'INACTIVE' : toastMatch?.id),
          toastFullName: isUnlinking ? null : (isInactive ? 'INACTIVO / NO LABORA' : (toastMatch?.fullName || toastMatch?.full_name)),
          toastEmail: isUnlinking ? null : (isInactive ? null : toastMatch?.email),
          toastPhone: isUnlinking ? null : (isInactive ? null : toastMatch?.phone),
          toastJobTitle: isUnlinking ? null : (isInactive ? 'INACTIVO' : (toastMatch?.jobTitle || toastMatch?.job_title)),
          mappingType: isUnlinking ? 'unmapped' : (isInactive ? 'inactive' : 'manual'),
          isConfirmed: !isUnlinking
        })
      })

      await fetchMappings(selectedCompanyId)
      await fetchStoreAudit(selectedCompanyId, selectedWeekId)
    } catch (err) {
      console.error('Error saving mapping:', err)
    } finally {
      setSavingMappingId(null)
    }
  }

  // Auto-Map All
  const handleAutoMapAll = async () => {
    setMappingLoading(true)
    try {
      await fetch('/api/ronos/mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: selectedCompanyId,
          autoMapAll: true
        })
      })
      await fetchMappings(selectedCompanyId)
      await fetchStoreAudit(selectedCompanyId, selectedWeekId)
    } catch (err) {
      console.error('Error auto-mapping all:', err)
    } finally {
      setMappingLoading(false)
    }
  }

  // Open Warning Email Modal
  const openEmailModal = async (emp: EmployeeTimecard, day?: DailyRecord, violation?: ComplianceViolation) => {
    if (!emp) return
    const mealCount = emp.mealPenaltyCount ?? 0
    const targetDate = day?.date || storeData?.startDate || new Date().toISOString()
    const targetViolTitle = violation?.title || (mealCount > 0 ? 'Violación 5ta Hora (Meal Penalty)' : 'Incumplimiento de Horario')
    const targetViolDesc = violation?.description || (mealCount > 0 ? `Turno con ${mealCount} penalización(es) de comida registradas en la semana.` : 'Irregularidad en registro de ponchadas.')

    setEmailModal({
      isOpen: true,
      employeeUserId: emp.employeeUserId,
      employeeName: emp.fullName,
      employeeEmail: emp.toastEmail || '',
      employeePin: emp.pin,
      employeeJobTitle: emp.jobTitle || 'Team Member',
      violationDate: targetDate,
      violationType: violation?.type || 'MEAL_PENALTY',
      violationTitle: targetViolTitle,
      violationDescription: targetViolDesc,
      clockInTime: day?.clockInTime ? formatTime12h(day.clockInTime) : undefined,
      lunchStartTime: day?.lunchStartTime ? formatTime12h(day.lunchStartTime) : undefined,
      lunchEndTime: day?.lunchEndTime ? formatTime12h(day.lunchEndTime) : undefined,
      clockOutTime: day?.clockOutTime ? formatTime12h(day.clockOutTime) : undefined,
      totalHoursWorked: day?.totalHours ?? emp?.totalWeeklyHours ?? 0,
      additionalNotes: '',
      escalera: null,
      isSending: false,
      sendSuccess: false,
      sendError: null
    })

    // Cargar escalera de mando
    try {
      const res = await fetch(`/api/ronos/notify-violation?companyId=${selectedCompanyId}`)
      if (!res.ok) throw new Error(`Error al cargar escalera (${res.status})`)
      const json = await res.json().catch(() => ({}))
      if (json?.success && json?.escalera) {
        setEmailModal(prev => ({ ...prev, escalera: json.escalera }))
      }
    } catch (err) {
      console.warn('Error fetching escalera de mando:', err)
    }
  }

  // Send Warning Email Submit
  const handleSendWarningEmail = async () => {
    if (!emailModal.employeeEmail || !emailModal.employeeEmail.includes('@')) {
      setEmailModal(prev => ({ ...prev, sendError: 'Debes vincular un correo electrónico válido de Toast primero.' }))
      return
    }

    setEmailModal(prev => ({ ...prev, isSending: true, sendError: null, sendSuccess: false }))

    try {
      const res = await fetch('/api/ronos/notify-violation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ronosCompanyId: selectedCompanyId,
          storeName: storeData?.storeName || 'Tacos Gavilan',
          employeeUserId: emailModal.employeeUserId,
          employeeName: emailModal.employeeName,
          employeeEmail: emailModal.employeeEmail,
          employeePin: emailModal.employeePin,
          employeeJobTitle: emailModal.employeeJobTitle,
          violationDate: emailModal.violationDate,
          violationType: emailModal.violationType,
          violationTitle: emailModal.violationTitle,
          violationDescription: emailModal.violationDescription,
          clockInTime: emailModal.clockInTime,
          lunchStartTime: emailModal.lunchStartTime,
          lunchEndTime: emailModal.lunchEndTime,
          clockOutTime: emailModal.clockOutTime,
          totalHoursWorked: emailModal.totalHoursWorked,
          additionalNotes: emailModal.additionalNotes
        })
      })

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody?.error || `Error en servidor de correo (${res.status})`)
      }
      const json = await res.json().catch(() => ({}))
      if (!json?.success) {
        throw new Error(json?.error || 'Error al despachar el correo de aviso laboral')
      }

      setEmailModal(prev => ({ ...prev, isSending: false, sendSuccess: true }))
    } catch (err: any) {
      console.error('Send warning email error:', err)
      setEmailModal(prev => ({ ...prev, isSending: false, sendError: err?.message || 'Error al enviar correo' }))
    }
  }

  // Sync On Demand (RONOS + Simplify HR)
  const handleSyncLive = async () => {
    setSyncing(true)
    setError(null)
    try {
      if (activeTab === 'chain') {
        const res = await fetch(`/api/ronos/sync?_t=${Date.now()}`, {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
          body: JSON.stringify({ syncChain: true, weekId: selectedWeekId, syncSimplify: false })
        })
        if (!res.ok) throw new Error(`Error en sincronización (${res.status})`)
        const json = await res.json().catch(() => ({}))
        if (json?.success && json?.data) {
          setChainData(json.data)
        }
      } else if (activeTab === 'payroll') {
        const res = await fetch(`/api/ronos/sync?_t=${Date.now()}`, {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
          body: JSON.stringify({ companyId: selectedCompanyId, weekId: selectedWeekId, syncSimplify: true })
        })
        if (!res.ok) throw new Error(`Error en sincronización nómina (${res.status})`)
        const json = await res.json().catch(() => ({}))
        if (json?.success) {
          const periodId = payrollBiWeekly ? (selectedBiWeeklyPeriod || biWeeklyPeriods[0]?.id || '') : selectedWeekId
          await fetchPayroll(selectedCompanyId, periodId, payrollBiWeekly)
        }
      } else if (activeTab === 'mapping') {
        await handleRefreshTransfers()
        await fetchMappings(selectedCompanyId)
      } else {
        const res = await fetch(`/api/ronos/sync?_t=${Date.now()}`, {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
          body: JSON.stringify({ companyId: selectedCompanyId, weekId: selectedWeekId, syncSimplify: true })
        })
        if (!res.ok) throw new Error(`Error en sincronización tienda (${res.status})`)
        const json = await res.json().catch(() => ({}))
        if (json?.success && json?.data) {
          setStoreData(json.data)
        }
      }
      setLastSyncedTime(new Date().toLocaleTimeString('es-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    } catch (err: any) {
      console.error('Sync live error:', err)
      setError(err?.message || 'Error en sincronización en vivo')
    } finally {
      setSyncing(false)
    }
  }

  // Open Photo Modal
  const openPhoto = (url: string, title: string, empName: string, timestamp: string) => {
    if (!url) return
    setPhotoModal({
      isOpen: true,
      photoUrl: url,
      title,
      employeeName: empName,
      timestamp: formatTime12h(timestamp),
      rotation: 0
    })
  }

  // Rotate Photo
  const handleRotate = () => {
    setPhotoModal(prev => ({
      ...prev,
      rotation: (prev.rotation + 90) % 360
    }))
  }

  // Filtered Employees for Tab 1
  const filteredEmployees = useMemo(() => {
    if (!Array.isArray(storeData?.employees)) return []
    const query = (searchTerm || '').toLowerCase().trim()

    return storeData.employees.filter(emp => {
      if (!emp) return false

      const hasHours = (emp.totalWeeklyHours ?? 0) > 0 || (emp.days && emp.days.some(d => (d.totalHours ?? 0) > 0))
      // Si "Mostrar Inactivos" está desmarcado, ocultar colaboradores con 0 horas
      if (!showInactive && !hasHours) return false

      const isSal = emp.isSalaried !== undefined ? emp.isSalaried : isEmployeeSalaried(emp.jobTitle || undefined, emp.fullName, emp.payRate)
      if (viewingFilter === 'salary' && !isSal) return false
      if (viewingFilter === 'hourly' && isSal) return false

      const matchSearch =
        !query ||
        (emp.fullName || '').toLowerCase().includes(query) ||
        (emp.pin || '').includes(query) ||
        Boolean(emp.jobTitle && emp.jobTitle.toLowerCase().includes(query)) ||
        Boolean(emp.toastEmail && emp.toastEmail.toLowerCase().includes(query)) ||
        Boolean((emp as any).siteName && String((emp as any).siteName).toLowerCase().includes(query))

      if (!matchSearch) return false

      if (filterType === 'violations') {
        return (emp.totalViolationsCount ?? 0) > 0 || (emp.mealPenaltyCount ?? 0) > 0 || Boolean(emp.brokenHours)
      }
      if (filterType === 'broken') {
        return Boolean(emp.brokenHours)
      }
      if (filterType === 'active') {
        return (emp.totalWeeklyHours ?? 0) > 0
      }

      return true
    }).sort((a, b) => {
      const aHasHours = (a?.totalWeeklyHours ?? 0) > 0 || (a?.days && a.days.some(d => (d.totalHours ?? 0) > 0))
      const bHasHours = (b?.totalWeeklyHours ?? 0) > 0 || (b?.days && b.days.some(d => (d.totalHours ?? 0) > 0))

      // 1. Colaboradores con horas trabajadas siempre van primero arriba
      if (aHasHours && !bHasHours) return -1
      if (!aHasHours && bHasHours) return 1

      // 2. Orden alfabético A-Z por Nombre de pila (First Name) o Nombre Completo
      const aName = (a?.firstName?.trim() || a?.fullName?.trim() || '')
      const bName = (b?.firstName?.trim() || b?.fullName?.trim() || '')
      return aName.localeCompare(bName, 'es', { sensitivity: 'base' })
    })
  }, [storeData, searchTerm, filterType, viewingFilter, showInactive])

  // Filtered Mappings for Tab 3
  const filteredMappings = useMemo(() => {
    if (!Array.isArray(mappingsList)) return []
    const query = (mappingSearch || '').toLowerCase().trim()
    return mappingsList.filter(item => {
      if (!item) return false
      const matchSearch =
        !query ||
        (item.ronosFullName || '').toLowerCase().includes(query) ||
        (item.ronosPin || '').includes(query) ||
        Boolean(item.toastFullName && item.toastFullName.toLowerCase().includes(query)) ||
        Boolean(item.toastEmail && item.toastEmail.toLowerCase().includes(query))

      if (mappingFilter === 'unmapped') {
        return item.mappingType === 'unmapped'
      }
      if (mappingFilter === 'matched') {
        return item.mappingType === 'auto' || item.mappingType === 'manual'
      }
      if (mappingFilter === 'inactive') {
        return item.mappingType === 'inactive'
      }

      return true
    })
  }, [mappingsList, mappingSearch, mappingFilter])

  // Filtered Employees for Tab 4 (Payroll)
  const filteredPayrollEmployees = useMemo(() => {
    if (!Array.isArray(payrollData?.employees)) return []
    const query = (payrollSearch || '').toLowerCase().trim()

    return payrollData.employees.filter((emp: any) => {
      if (!emp) return false

      const matchSearch =
        !query ||
        (emp.fullName || '').toLowerCase().includes(query) ||
        (emp.jobTitle || '').toLowerCase().includes(query) ||
        Boolean(emp.employeeId && String(emp.employeeId).includes(query)) ||
        Boolean(emp.auditNote && String(emp.auditNote).toLowerCase().includes(query))

      if (!matchSearch) return false

      if (payrollFilterType === 'violations') {
        return (emp.overtimeHours ?? 0) > 0 || (emp.doubleTimeHours ?? 0) > 0 || (emp.mealPenaltyHours ?? 0) > 0
      }
      if (payrollFilterType === 'pto') {
        return (emp.sickHours ?? 0) > 0 || (emp.vacationHours ?? 0) > 0 || (emp.holidayHours ?? 0) > 0
      }
      if (payrollFilterType === 'exact') {
        return emp.auditStatus === 'exact'
      }
      if (payrollFilterType === 'saving') {
        return emp.auditStatus === 'saving'
      }
      if (payrollFilterType === 'variance') {
        return emp.auditStatus === 'variance'
      }

      return true
    })
  }, [payrollData, payrollSearch, payrollFilterType])

  // Sorted stores for Tab 2 (Chain-wide audit)
  const sortedChainStores = useMemo(() => {
    if (!Array.isArray(chainData?.stores)) return []
    return [...chainData.stores].sort((a: any, b: any) => {
      let valA: any = 0
      let valB: any = 0
      if (chainSortField === 'store') {
        valA = a.storeName || ''
        valB = b.storeName || ''
        return chainSortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA)
      } else if (chainSortField === 'hours') {
        valA = a.totalHours ?? 0
        valB = b.totalHours ?? 0
      } else if (chainSortField === 'ot') {
        valA = a.overtimeHours ?? 0
        valB = b.overtimeHours ?? 0
      } else if (chainSortField === 'penalties') {
        valA = a.mealPenaltiesCount ?? a.mealPenalties ?? 0
        valB = b.mealPenaltiesCount ?? b.mealPenalties ?? 0
      } else if (chainSortField === 'penaltyCost') {
        valA = a.estimatedPenaltyCostUsd ?? a.penaltyCostUsd ?? 0
        valB = b.estimatedPenaltyCostUsd ?? b.penaltyCostUsd ?? 0
      } else if (chainSortField === 'compliance') {
        valA = a.complianceScore ?? 0
        valB = b.complianceScore ?? 0
      }
      return chainSortAsc ? valA - valB : valB - valA
    })
  }, [chainData, chainSortField, chainSortAsc])

  // Paired bi-weekly payroll periods for Cingular (Anchored to Monday 2026-08-10 series)
  const biWeeklyPeriods = useMemo(() => {
    return computeCingularBiWeeklyPeriods(weeks)
  }, [weeks])

  // Navegación de empleado individual siguiente / anterior
  const handleNavigateEmployee = (direction: 'next' | 'prev') => {
    if (!selectedEmployeeDetail || !storeData?.employees) return
    const list = filteredEmployees.length > 0 ? filteredEmployees : storeData.employees
    const currentIndex = list.findIndex(e => e.employeeUserId === selectedEmployeeDetail.employeeUserId)
    if (currentIndex === -1) return

    if (direction === 'next' && currentIndex < list.length - 1) {
      setSelectedEmployeeDetail(list[currentIndex + 1])
    } else if (direction === 'prev' && currentIndex > 0) {
      setSelectedEmployeeDetail(list[currentIndex - 1])
    }
  }

  // Export to CSV
  const handleExportCSV = () => {
    if (!Array.isArray(storeData?.employees)) return

    const rows: string[] = []
    rows.push(['ID Empleado', 'Nombre RONOS', 'PIN', 'Puesto', 'Correo Toast Vinculado', 'Horas Totales', 'Horas Regulares', 'Overtime (OT)', 'Double Time (DT)', 'Penalizaciones Meal', 'Broken Timecard', 'Fuga Estimada USD'].join(','))

    storeData.employees.forEach(emp => {
      if (!emp) return
      rows.push([
        emp.employeeUserId ?? '',
        `"${emp.fullName || ''}"`,
        emp.pin || '',
        `"${emp.jobTitle || 'Team Member'}"`,
        `"${emp.toastEmail || 'Sin Vincular'}"`,
        (emp.totalWeeklyHours ?? 0),
        (emp.regularHours ?? 0),
        (emp.overtimeHours ?? 0),
        (emp.doubleTimeHours ?? 0),
        (emp.mealPenaltyCount ?? 0),
        emp.brokenHours ? 'SI' : 'NO',
        `$${(emp.totalEstimatedPenaltyCostUsd ?? 0).toFixed(2)}`
      ].join(','))
    })

    const csvContent = 'data:text/csv;charset=utf-8,' + rows.join('\n')
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', `Auditoria_RONOS_${storeData?.storeCode || 'TIENDA'}_Semana_${storeData?.weekId || 'ACTUAL'}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Cálculos en tiempo real para las 5 tarjetas de KPI estilo RONOS (In Today, Lunch Today, Out Today)
  const todayPunchStats = useMemo(() => {
    let inCount = 0
    let lunchCount = 0
    let outCount = 0

    if (!Array.isArray(storeData?.employees) || storeData.employees.length === 0) {
      return { inCount, lunchCount, outCount }
    }

    // Fecha laboral actual en zona horaria de California
    const todayLA = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }) // "YYYY-MM-DD"

    for (const emp of storeData.employees) {
      if (!emp || !Array.isArray(emp.days)) continue

      // Buscar el registro de hoy
      const todayRecord = emp.days.find(d => d?.date && String(d.date).startsWith(todayLA))
      const punches = todayRecord?.punches

      if (Array.isArray(punches) && punches.length > 0) {
        const sorted = [...punches].sort((a, b) => {
          const timeA = new Date(a?.localTime || a?.punchTime || 0).getTime()
          const timeB = new Date(b?.localTime || b?.punchTime || 0).getTime()
          return timeA - timeB
        })

        const lastPunch = sorted[sorted.length - 1]
        const pType = Number(lastPunch?.punchType)

        if (pType === 1) {
          // Clock IN o Lunch END -> Está actualmente trabajando en tienda (IN)
          inCount++
        } else if (pType === 3) {
          // Lunch START -> Está actualmente en su descanso de comida (LUNCH)
          lunchCount++
        } else if (pType === 2) {
          // Clock OUT -> Ya terminó su turno de hoy (OUT)
          outCount++
        }
      }
    }

    return { inCount, lunchCount, outCount }
  }, [storeData])

  const totalEmployeesCount = storeData?.employees?.length || 0
  const approvedCount = storeData?.employees?.filter(e => (e.totalViolationsCount === 0 && !e.brokenHours)).length || 0
  const brokenCount = storeData?.employees?.filter(e => (e.brokenHours || (e.mealPenaltyCount ?? 0) > 0)).length || 0
  const inTodayCount = todayPunchStats.inCount
  const lunchTodayCount = todayPunchStats.lunchCount
  const outTodayCount = todayPunchStats.outCount

  const activeStoreName = selectedCompanyId === 0
    ? (t('ronos.opt_all_stores') || 'Todas las Tiendas')
    : storeData?.storeName
    ? storeData.storeName
    : 'Lynwood'

  return (
    <div className="min-h-screen bg-[#f8fafc] dark:bg-slate-950 text-slate-800 dark:text-slate-100 font-sans transition-colors duration-200">
      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {/* 1. TOP NAVBAR AZUL OFICIAL RONOS (SCREENSHOT 1, 2, 3, 4, 5)                  */}
      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      <header className="bg-[#0288d1] dark:bg-[#01579b] text-white shadow-md sticky top-0 z-40">
        <div className="w-full px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          {/* Left: Hamburger + Title / Back button */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                if (selectedEmployeeDetail) setSelectedEmployeeDetail(null)
              }}
              className="p-1.5 rounded-lg hover:bg-white/15 transition-colors cursor-pointer flex items-center gap-2"
              title="Menú / Volver"
            >
              <Menu className="w-6 h-6" />
              {selectedEmployeeDetail && (
                <ArrowLeft className="w-5 h-5" />
              )}
            </button>

            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-bold tracking-tight select-none">
                {selectedEmployeeDetail
                  ? `${selectedEmployeeDetail.fullName}`
                  : activeTab === 'chain'
                  ? 'Clients (16 Tiendas)'
                  : activeStoreName}
              </h1>
              <span className="hidden md:inline-block text-[11px] bg-white/20 border border-white/30 px-2 py-0.5 rounded font-mono text-white/90">
                RONOS Labor API
              </span>
            </div>
          </div>

          {/* Center: Seamless Tabs Navigation Pills */}
          <div className="hidden lg:flex items-center bg-black/15 p-1 rounded-xl gap-1">
            <button
              onClick={() => {
                setActiveTab('store')
                setSelectedEmployeeDetail(null)
              }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'store'
                  ? 'bg-white text-[#0288d1] shadow-xs'
                  : 'text-white/85 hover:text-white hover:bg-white/10'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              {t('ronos.tab_store')}
            </button>

            <button
              onClick={() => {
                setActiveTab('chain')
                setSelectedEmployeeDetail(null)
              }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'chain'
                  ? 'bg-white text-[#0288d1] shadow-xs'
                  : 'text-white/85 hover:text-white hover:bg-white/10'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              {t('ronos.tab_chain')}
            </button>

            <button
              onClick={() => {
                setActiveTab('mapping')
                setSelectedEmployeeDetail(null)
              }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'mapping'
                  ? 'bg-white text-[#0288d1] shadow-xs'
                  : 'text-white/85 hover:text-white hover:bg-white/10'
              }`}
            >
              <LinkIcon className="w-3.5 h-3.5" />
              {t('ronos.tab_mapping')}
            </button>

            <button
              onClick={() => {
                setActiveTab('payroll')
                setSelectedEmployeeDetail(null)
              }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'payroll'
                  ? 'bg-white text-[#0288d1] shadow-xs'
                  : 'text-white/85 hover:text-white hover:bg-white/10'
              }`}
            >
              <Receipt className="w-3.5 h-3.5" />
              {t('ronos.tab_payroll')}
            </button>
          </div>

          {/* Right: Sync & Actions */}
          <div className="flex items-center gap-2 sm:gap-3">
            {lastSyncedTime && (
              <span className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/15 text-white text-[11px] font-medium border border-white/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>En vivo: {lastSyncedTime}</span>
              </span>
            )}

            <button
              onClick={handleSyncLive}
              disabled={syncing || loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white font-semibold text-xs transition-all active:scale-95 cursor-pointer disabled:opacity-50"
              title="Sincronizar RONOS & Simplify HR directamente sin caché"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{syncing ? t('ronos.syncing') : 'Sincronizar en Vivo'}</span>
            </button>

            <div className="h-4 w-px bg-white/30" />

            <div className="flex items-center gap-1 text-xs font-semibold tracking-wider uppercase select-none">
              <span className="text-white/90">LOGOUT</span>
              <LogOut className="w-3.5 h-3.5 text-white/90 ml-0.5" />
            </div>
          </div>
        </div>

        {/* Mobile Sub-Navigation Tabs */}
        <div className="flex lg:hidden overflow-x-auto border-t border-white/20 px-2 py-1.5 gap-1 scrollbar-none bg-[#0288d1]">
          <button
            onClick={() => { setActiveTab('store'); setSelectedEmployeeDetail(null); }}
            className={`px-3 py-1 rounded text-xs font-bold whitespace-nowrap ${activeTab === 'store' ? 'bg-white text-[#0288d1]' : 'text-white/85'}`}
          >
            {t('ronos.tab_store')}
          </button>
          <button
            onClick={() => { setActiveTab('chain'); setSelectedEmployeeDetail(null); }}
            className={`px-3 py-1 rounded text-xs font-bold whitespace-nowrap ${activeTab === 'chain' ? 'bg-white text-[#0288d1]' : 'text-white/85'}`}
          >
            {t('ronos.tab_chain')}
          </button>
          <button
            onClick={() => { setActiveTab('mapping'); setSelectedEmployeeDetail(null); }}
            className={`px-3 py-1 rounded text-xs font-bold whitespace-nowrap ${activeTab === 'mapping' ? 'bg-white text-[#0288d1]' : 'text-white/85'}`}
          >
            {t('ronos.tab_mapping')}
          </button>
          <button
            onClick={() => { setActiveTab('payroll'); setSelectedEmployeeDetail(null); }}
            className={`px-3 py-1 rounded text-xs font-bold whitespace-nowrap ${activeTab === 'payroll' ? 'bg-white text-[#0288d1]' : 'text-white/85'}`}
          >
            {t('ronos.tab_payroll')}
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-[1600px] mx-auto p-3 sm:p-5 lg:p-6 space-y-5">
        {/* Error Notification */}
        {error && (
          <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs flex items-center gap-2.5 shadow-xs">
            <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════════ */}
        {/* PESTAÑA 1: MI TIENDA (STORE TIMECARDS & PUNCH MATRIX)                       */}
        {/* ═══════════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'store' && (
          <>
            {/* VISTA A: EMPLEADO INDIVIDUAL REDISEÑADA (MAXIMA LEGIBILIDAD) */}
            {selectedEmployeeDetail ? (
              <div className="space-y-4">
                {/* 1. Header Toolbar de Navegación del Empleado */}
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setSelectedEmployeeDetail(null)}
                      className="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold flex items-center gap-2 transition-all cursor-pointer shadow-2xs"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      <span>Volver a Lista</span>
                    </button>

                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-lg font-black text-slate-900 dark:text-white">
                          {selectedEmployeeDetail.fullName}
                        </h2>
                        <span className="text-xs px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 font-mono font-bold">
                          PIN #{selectedEmployeeDetail.pin}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {selectedEmployeeDetail.jobTitle || 'Team Member'} • {activeStoreName}
                      </p>
                    </div>
                  </div>

                  {/* Right Navigation Controls */}
                  <div className="flex items-center gap-2.5 flex-wrap">
                    {/* Selector Directo de Empleado */}
                    <select
                      value={selectedEmployeeDetail.employeeUserId}
                      onChange={(e) => {
                        const target = storeData?.employees.find(emp => emp.employeeUserId === Number(e.target.value))
                        if (target) setSelectedEmployeeDetail(target)
                      }}
                      className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold cursor-pointer max-w-[220px]"
                    >
                      {storeData?.employees.map((emp, idx) => (
                        <option key={`${emp.employeeUserId}-${(emp as any).siteName || idx}`} value={emp.employeeUserId}>
                          {emp.fullName} (#{emp.pin}) {(emp as any).siteName ? `[${(emp as any).siteName}]` : ''}
                        </option>
                      ))}
                    </select>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleNavigateEmployee('prev')}
                        className="p-2 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 cursor-pointer"
                        title="Empleado Anterior"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleNavigateEmployee('next')}
                        className="p-2 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 cursor-pointer"
                        title="Siguiente Empleado"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>

                    <button
                      onClick={() => openEmailModal(selectedEmployeeDetail)}
                      className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-xs cursor-pointer flex items-center gap-1.5 transition-all"
                    >
                      <Mail className="w-3.5 h-3.5" />
                      <span>Avisar Fuga por Correo</span>
                    </button>
                  </div>
                </div>

                {/* 2. 5 KPI Cards Summary del Empleado */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 text-center border border-slate-200 dark:border-slate-800 shadow-xs">
                    <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block mb-1">
                      Total Horas
                    </span>
                    <div className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white">
                      {(selectedEmployeeDetail.totalWeeklyHours ?? 0).toFixed(2)}
                      <span className="text-xs font-normal text-slate-400 ml-1">hrs</span>
                    </div>
                  </div>

                  <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 text-center border border-slate-200 dark:border-slate-800 shadow-xs">
                    <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block mb-1">
                      Horas Regulares
                    </span>
                    <div className="text-2xl sm:text-3xl font-black text-emerald-600 dark:text-emerald-400">
                      {(selectedEmployeeDetail.regularHours ?? 0).toFixed(2)}
                      <span className="text-xs font-normal text-slate-400 ml-1">hrs</span>
                    </div>
                  </div>

                  <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 text-center border border-slate-200 dark:border-slate-800 shadow-xs">
                    <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block mb-1">
                      Overtime (1.5x)
                    </span>
                    <div className={`text-2xl sm:text-3xl font-black ${(selectedEmployeeDetail.overtimeHours ?? 0) > 0 ? 'text-amber-600' : 'text-slate-900 dark:text-white'}`}>
                      {(selectedEmployeeDetail.overtimeHours ?? 0).toFixed(2)}
                      <span className="text-xs font-normal text-slate-400 ml-1">hrs</span>
                    </div>
                  </div>

                  <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 text-center border border-slate-200 dark:border-slate-800 shadow-xs">
                    <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block mb-1">
                      Double Time (2.0x)
                    </span>
                    <div className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white">
                      {(selectedEmployeeDetail.doubleTimeHours ?? 0).toFixed(2)}
                      <span className="text-xs font-normal text-slate-400 ml-1">hrs</span>
                    </div>
                  </div>

                  <div className={`rounded-2xl p-4 text-center border shadow-xs ${
                    (selectedEmployeeDetail.mealPenaltyCount ?? 0) > 0
                      ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white'
                  }`}>
                    <span className="text-[11px] font-bold block mb-1">
                      Meal Penalties (Multas)
                    </span>
                    <div className="text-2xl sm:text-3xl font-black">
                      {selectedEmployeeDetail.mealPenaltyCount ?? 0}
                      <span className="text-xs font-normal ml-1">
                        {(selectedEmployeeDetail.mealPenaltyCount ?? 0) > 0 ? '⚠️ Alerta' : '✅ Conforme'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 3. Desglose de Ponchadas Diarias Formateadas (7 Días) */}
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs p-5 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-5 h-5 text-[#0288d1]" />
                      <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100">
                        Historial y Registro de Ponchadas de la Semana
                      </h3>
                    </div>
                    <span className="text-xs text-slate-400 font-mono">
                      {formatUsaDate(storeData?.startDate)} - {formatUsaDate(storeData?.endDate)}
                    </span>
                  </div>

                  {/* Lista de Tarjetas de Día */}
                  <div className="space-y-3">
                    {selectedEmployeeDetail.days?.map((day, dIdx) => {
                      const hasWorked = (day.totalHours ?? 0) > 0 || (day.punches && day.punches.length > 0)
                      const hasViolations = day.violations && day.violations.length > 0
                      const { dayOfWeek, dateFormatted } = formatDayDetails(day.date, day.dayName)

                      const dayReg = day.regularHours > 0 ? day.regularHours : Math.min(8.0, day.totalHours ?? 0)
                      const dayOt = day.overtimeHours > 0 ? day.overtimeHours : ((day.totalHours ?? 0) > 8.0 ? Math.min(4.0, (day.totalHours ?? 0) - 8.0) : 0)
                      const dayDt = day.doubleTimeHours > 0 ? day.doubleTimeHours : ((day.totalHours ?? 0) > 12.0 ? (day.totalHours ?? 0) - 12.0 : 0)

                      if (!hasWorked) {
                        return (
                          <div
                            key={dIdx}
                            className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 flex items-center justify-between text-xs text-slate-400"
                          >
                            <span className="font-semibold text-slate-600 dark:text-slate-400">
                              {dayOfWeek}, {dateFormatted}
                            </span>
                            <span className="italic">Descanso / Día Libre (0.00 hrs)</span>
                          </div>
                        )
                      }

                      return (
                        <div
                          key={dIdx}
                          className={`rounded-2xl border p-4 transition-all ${
                            hasViolations
                              ? 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800/60 shadow-xs'
                              : 'bg-white dark:bg-slate-800/60 border-slate-200 dark:border-slate-800 shadow-2xs'
                          }`}
                        >
                          {/* Cabecera del Día */}
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-700/60">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className={`font-bold text-sm ${hasViolations ? 'text-rose-700 dark:text-rose-400' : 'text-slate-900 dark:text-white'}`}>
                                  {dayOfWeek}, {dateFormatted}
                                </span>
                                <span className="text-[11px] px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-mono">
                                  {selectedEmployeeDetail.jobTitle || 'crew'}
                                </span>
                              </div>
                            </div>

                            {/* Horas Trabajadas */}
                            <div className="flex items-center gap-2">
                              <span className="px-2.5 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-black text-xs">
                                {(day.totalHours ?? 0).toFixed(2)} hrs trabajadas
                              </span>
                              <span className="text-xs text-slate-500 font-mono">
                                (Reg: {dayReg.toFixed(2)}h {dayOt > 0 ? `• OT: ${dayOt.toFixed(2)}h` : ''} {dayDt > 0 ? `• DT: ${dayDt.toFixed(2)}h` : ''})
                              </span>
                            </div>
                          </div>

                          {/* Violaciones o Alertas si existen */}
                          {hasViolations && (
                            <div className="mt-3 p-2.5 rounded-xl bg-rose-100/70 dark:bg-rose-900/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                                <div>
                                  <span className="font-bold">{day.violations[0]?.title || 'Violación de Horario'}</span>
                                  <span className="mx-1.5">•</span>
                                  <span>{day.violations[0]?.description}</span>
                                </div>
                              </div>
                              <span className="font-black text-rose-700 dark:text-rose-300 text-xs whitespace-nowrap">
                                +${(day.violations[0]?.estimatedCostUsd ?? 19.50).toFixed(2)} USD
                              </span>
                            </div>
                          )}

                          {/* Línea de Tiempo de Ponchadas Formateadas (Mismo Azul de la Portada) */}
                          <div className="mt-3.5 flex items-center gap-3 flex-wrap text-xs">
                            {/* ENTRADA (IN) */}
                            {day.clockInTime && (
                              <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-sky-50/80 dark:bg-sky-950/40 border border-[#0288d1]/30 dark:border-[#0288d1]/50 text-slate-800 dark:text-slate-100 shadow-2xs">
                                <Sun className="w-4 h-4 text-[#0288d1]" />
                                <div>
                                  <span className="text-[10px] text-[#0288d1] dark:text-sky-400 font-bold block uppercase tracking-wider">
                                    Entrada
                                  </span>
                                  <span className="font-black text-sm font-mono text-slate-900 dark:text-white">
                                    {formatTime12h(day.clockInTime)}
                                  </span>
                                </div>
                                {day.clockInPhoto && (
                                  <button
                                    onClick={() => openPhoto(day.clockInPhoto!, 'Entrada', selectedEmployeeDetail.fullName, day.clockInTime!)}
                                    className="p-1.5 ml-1 rounded-lg bg-[#0288d1]/15 hover:bg-[#0288d1]/25 text-[#0288d1] dark:text-sky-300 cursor-pointer transition-colors"
                                    title="Ver Foto de Reloj AWS"
                                  >
                                    <Camera className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            )}

                            {/* LUNCH / COMIDA */}
                            {day.lunchStartTime && (
                              <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-sky-50/80 dark:bg-sky-950/40 border border-[#0288d1]/30 dark:border-[#0288d1]/50 text-slate-800 dark:text-slate-100 shadow-2xs">
                                <Coffee className="w-4 h-4 text-[#0288d1]" />
                                <div>
                                  <span className="text-[10px] text-[#0288d1] dark:text-sky-400 font-bold block uppercase tracking-wider">
                                    Descanso de Comida ({day.lunchDurationMinutes ? `${day.lunchDurationMinutes} min` : '30 min'})
                                  </span>
                                  <span className="font-black text-sm font-mono text-slate-900 dark:text-white">
                                    {formatTime12h(day.lunchStartTime)} {day.lunchEndTime ? `→ ${formatTime12h(day.lunchEndTime)}` : ''}
                                  </span>
                                </div>
                                {day.lunchStartPhoto && (
                                  <button
                                    onClick={() => openPhoto(day.lunchStartPhoto!, 'Inicio de Comida', selectedEmployeeDetail.fullName, day.lunchStartTime!)}
                                    className="p-1.5 ml-1 rounded-lg bg-[#0288d1]/15 hover:bg-[#0288d1]/25 text-[#0288d1] dark:text-sky-300 cursor-pointer transition-colors"
                                    title="Ver Foto de Inicio de Comida"
                                  >
                                    <Camera className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            )}

                            {/* SALIDA (OUT) */}
                            {day.clockOutTime && (
                              <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-sky-50/80 dark:bg-sky-950/40 border border-[#0288d1]/30 dark:border-[#0288d1]/50 text-slate-800 dark:text-slate-100 shadow-2xs">
                                <Moon className="w-4 h-4 text-[#0288d1]" />
                                <div>
                                  <span className="text-[10px] text-[#0288d1] dark:text-sky-400 font-bold block uppercase tracking-wider">
                                    Salida
                                  </span>
                                  <span className="font-black text-sm font-mono text-slate-900 dark:text-white">
                                    {formatTime12h(day.clockOutTime)}
                                  </span>
                                </div>
                                {day.clockOutPhoto && (
                                  <button
                                    onClick={() => openPhoto(day.clockOutPhoto!, 'Salida', selectedEmployeeDetail.fullName, day.clockOutTime!)}
                                    className="p-1.5 ml-1 rounded-lg bg-[#0288d1]/15 hover:bg-[#0288d1]/25 text-[#0288d1] dark:text-sky-300 cursor-pointer transition-colors"
                                    title="Ver Foto de Salida"
                                  >
                                    <Camera className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            ) : (
              /* VISTA B: TABLA MAESTRA DE TIMECARDS ESTILO RONOS.COM (SCREENSHOT 2 & 4) */
              <div className="space-y-5">
                {/* 5 Top KPI Summary Cards (Screenshot 2 & 4) */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {/* In Today */}
                  <div className="bg-white dark:bg-slate-900 rounded-xl p-4 text-center border border-slate-200 dark:border-slate-800 shadow-xs">
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 border-b-2 border-[#03a9f4] pb-0.5 inline-block mb-1">
                      In
                    </span>
                    <span className="text-[10px] text-slate-400 block mb-1.5">Today</span>
                    <div className="text-3xl font-black text-slate-900 dark:text-white">
                      {inTodayCount}
                    </div>
                  </div>

                  {/* Lunch Today */}
                  <div className="bg-white dark:bg-slate-900 rounded-xl p-4 text-center border border-slate-200 dark:border-slate-800 shadow-xs">
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 border-b-2 border-[#03a9f4] pb-0.5 inline-block mb-1">
                      Lunch
                    </span>
                    <span className="text-[10px] text-slate-400 block mb-1.5">Today</span>
                    <div className="text-3xl font-black text-slate-900 dark:text-white">
                      {lunchTodayCount}
                    </div>
                  </div>

                  {/* Out Today */}
                  <div className="bg-white dark:bg-slate-900 rounded-xl p-4 text-center border border-slate-200 dark:border-slate-800 shadow-xs">
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 border-b-2 border-[#03a9f4] pb-0.5 inline-block mb-1">
                      Out
                    </span>
                    <span className="text-[10px] text-slate-400 block mb-1.5">Today</span>
                    <div className="text-3xl font-black text-slate-900 dark:text-white">
                      {outTodayCount}
                    </div>
                  </div>

                  {/* Approved */}
                  <div className="bg-white dark:bg-slate-900 rounded-xl p-4 text-center border border-slate-200 dark:border-slate-800 shadow-xs">
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 border-b-2 border-[#03a9f4] pb-0.5 inline-block mb-1">
                      Approved
                    </span>
                    <span className="text-[10px] text-slate-400 block mb-1.5 truncate">
                      {formatUsaDate(storeData?.startDate)} - {formatUsaDate(storeData?.endDate)}
                    </span>
                    <div className="text-3xl font-black text-[#2e7d32] dark:text-emerald-400">
                      {approvedCount}/{totalEmployeesCount}
                    </div>
                  </div>

                  {/* Broken Timecards */}
                  <div className="bg-white dark:bg-slate-900 rounded-xl p-4 text-center border border-slate-200 dark:border-slate-800 shadow-xs">
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 border-b-2 border-[#03a9f4] pb-0.5 inline-block mb-1">
                      Broken Timecards
                    </span>
                    <span className="text-[10px] text-slate-400 block mb-1.5 truncate">
                      {formatUsaDate(storeData?.startDate)} - {formatUsaDate(storeData?.endDate)}
                    </span>
                    <div className="text-3xl font-black text-[#d32f2f] dark:text-rose-400">
                      {brokenCount}/{totalEmployeesCount}
                    </div>
                  </div>
                </div>

                {/* Section "Employee Timecards" Card Panel */}
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs p-5 space-y-4">
                  {/* Title */}
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                      <span>Employee Timecards</span>
                      {filterType === 'violations' && (
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">
                          Filtrado: Solo Fugas / Broken
                        </span>
                      )}
                    </h2>
                    <span className="text-xs text-slate-400 font-mono">
                      {selectedCompanyId === 0
                        ? (t('ronos.opt_all_stores') || 'Todas las Tiendas')
                        : storeData?.storeName || ''}
                    </span>
                  </div>

                  {/* Filter Toolbar Row 1: Dropdowns + Legend + Real Audit Action Buttons */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-center pt-2">
                    {/* Store / Departments Selector */}
                    <div className="lg:col-span-3">
                      <label className="block text-[11px] text-slate-500 font-semibold mb-1">Departments / Tienda</label>
                      <select
                        value={selectedCompanyId}
                        onChange={(e) => handleStoreChange(Number(e.target.value))}
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold cursor-pointer"
                      >
                        <option value={0}>
                          🌟 {t('ronos.opt_all_stores') || 'Todas las Tiendas'}
                        </option>
                        {stores.map(st => (
                          <option key={st.ronosCompanyId} value={st.ronosCompanyId}>
                            {st.tegName}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Week Selector */}
                    <div className="lg:col-span-3">
                      <label className="block text-[11px] text-slate-500 font-semibold mb-1">Week</label>
                      <select
                        value={selectedWeekId}
                        onChange={(e) => {
                          const wId = Number(e.target.value)
                          setSelectedWeekId(wId)
                          fetchStoreAudit(selectedCompanyId, wId)
                        }}
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold cursor-pointer"
                      >
                        {weeks.map(w => (
                          <option key={w.weekId} value={w.weekId}>
                            {formatUsaDate(w.startDate)} - {formatUsaDate(w.endDate)}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Real Executive Audit Buttons */}
                    <div className="lg:col-span-6 flex items-center justify-end gap-2 flex-wrap">
                      <div className="text-[11px] text-slate-500 flex items-center gap-1.5 mr-2">
                        <span className="font-semibold">Legend:</span>
                        <span className="text-[#2e7d32] font-bold">Approved</span>
                        <span className="text-[#d32f2f] font-bold">Broken / Violations</span>
                      </div>

                      {/* Quick Filter Violations Toggle */}
                      <button
                        onClick={() => setFilterType(prev => prev === 'violations' ? 'all' : 'violations')}
                        className={`px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1.5 shadow-xs transition-all cursor-pointer ${
                          filterType === 'violations'
                            ? 'bg-rose-600 text-white'
                            : 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-300'
                        }`}
                        title="Ver únicamente colaboradores con penalizaciones o ponchadas rotas"
                      >
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>{filterType === 'violations' ? 'Ver Todos' : 'Ver Fugas & Multas'}</span>
                      </button>

                      {/* Export Store CSV */}
                      <button
                        onClick={handleExportCSV}
                        className="px-3 py-1.5 rounded-lg bg-[#0288d1] hover:bg-[#0277bd] text-white font-bold text-xs shadow-xs transition-all active:scale-95 cursor-pointer flex items-center gap-1.5"
                        title="Descargar reporte completo en formato Excel/CSV"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Exportar CSV</span>
                      </button>

                      {/* Go to Cingular Payroll Audit */}
                      <button
                        onClick={() => {
                          setActiveTab('payroll')
                        }}
                        className="px-3.5 py-1.5 rounded-lg bg-[#43a047] hover:bg-[#388e3c] text-white font-bold text-xs shadow-xs transition-all active:scale-95 cursor-pointer flex items-center gap-1.5"
                        title="Auditar pre-factura y conciliar nómina con Cingular HR"
                      >
                        <Receipt className="w-3.5 h-3.5" />
                        <span>Conciliar Cingular HR</span>
                      </button>
                    </div>
                  </div>

                  {/* Filter Toolbar Row 2: Search + Radio Filters + Inactive Checkbox */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                    {/* Search Box with Clear & Sync */}
                    <div className="flex items-center gap-2 max-w-sm w-full">
                      <div className="relative flex-1">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                        <input
                          type="text"
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          placeholder="Search by first and/or last name"
                          className="w-full pl-8 pr-7 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[#03a9f4]"
                        />
                        {searchTerm && (
                          <button
                            onClick={() => setSearchTerm('')}
                            className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <button
                        onClick={() => fetchStoreAudit(selectedCompanyId, selectedWeekId)}
                        className="p-1.5 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
                        title="Refrescar"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                      </button>
                    </div>

                    {/* Viewing Radios + Checkbox */}
                    <div className="flex items-center gap-4 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-500">Viewing:</span>
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input
                            type="radio"
                            name="viewingFilter"
                            checked={viewingFilter === 'all'}
                            onChange={() => setViewingFilter('all')}
                            className="accent-[#0288d1]"
                          />
                          <span>{t('ronos.viewing_all')}</span>
                        </label>
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input
                            type="radio"
                            name="viewingFilter"
                            checked={viewingFilter === 'salary'}
                            onChange={() => setViewingFilter('salary')}
                            className="accent-[#0288d1]"
                          />
                          <span>{t('ronos.viewing_salary')}</span>
                        </label>
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input
                            type="radio"
                            name="viewingFilter"
                            checked={viewingFilter === 'hourly'}
                            onChange={() => setViewingFilter('hourly')}
                            className="accent-[#0288d1]"
                          />
                          <span>{t('ronos.viewing_hourly')}</span>
                        </label>
                      </div>

                      <label className="flex items-center gap-1.5 cursor-pointer font-medium text-slate-700 dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={showInactive}
                          onChange={(e) => setShowInactive(e.target.checked)}
                          className="rounded text-[#0288d1] focus:ring-0"
                        />
                        <span>{t('ronos.show_inactive')}</span>
                      </label>
                    </div>
                  </div>

                  {/* Main Timecards Table (Screenshot 2 / 4) */}
                  <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-700">
                        <tr>
                          <th className="py-2.5 px-3 w-10 text-center">#</th>
                          <th className="py-2.5 px-2 w-10 text-center">Lock</th>
                          <th className="py-2.5 px-3">User ID</th>
                          <th className="py-2.5 px-3">First</th>
                          <th className="py-2.5 px-3">Last</th>
                          <th className="py-2.5 px-3 font-mono">Pin</th>
                          <th className="py-2.5 px-3 text-center">Active</th>
                          <th className="py-2.5 px-3 text-center font-bold">Total</th>
                          <th className="py-2.5 px-3 text-center">Regular</th>
                          <th className="py-2.5 px-3 text-center">Overtime</th>
                          <th className="py-2.5 px-3 text-center">Doubletime</th>
                          <th className="py-2.5 px-3 text-center w-12">Edit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {loading ? (
                          <tr>
                            <td colSpan={12} className="py-12 text-center text-slate-400">
                              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-[#03a9f4]" />
                              <span>Cargando tarjetas de tiempo desde RONOS API...</span>
                            </td>
                          </tr>
                        ) : filteredEmployees.length === 0 ? (
                          <tr>
                            <td colSpan={12} className="py-12 text-center text-slate-400">
                              <Users className="w-6 h-6 mx-auto mb-2 opacity-50" />
                              <span>No se encontraron colaboradores para este filtro.</span>
                            </td>
                          </tr>
                        ) : (
                          filteredEmployees.map((emp, idx) => {
                            const hasHours = (emp.totalWeeklyHours ?? 0) > 0 || (emp.days && emp.days.some(d => (d.totalHours ?? 0) > 0))
                            const isBroken = emp.brokenHours || (emp.mealPenaltyCount ?? 0) > 0
                            const isApproved = !isBroken && hasHours

                            return (
                              <tr
                                key={`${emp.employeeUserId}-${(emp as any).siteName || idx}`}
                                onClick={() => setSelectedEmployeeDetail(emp)}
                                className={`cursor-pointer transition-colors ${
                                  hasHours
                                    ? 'hover:bg-blue-50/50 dark:hover:bg-slate-800/60'
                                    : 'bg-slate-50/60 dark:bg-slate-900/40 text-slate-400 opacity-60 hover:opacity-100 hover:bg-slate-100 dark:hover:bg-slate-800'
                                }`}
                              >
                                <td className="py-2.5 px-3 text-center text-slate-400">
                                  {idx + 1}
                                </td>
                                <td className="py-2.5 px-2 text-center text-rose-500">
                                  <Unlock className="w-3.5 h-3.5 mx-auto" />
                                </td>
                                <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-400">
                                  {emp.employeeUserId}
                                </td>
                                <td className={`py-2.5 px-3 font-bold ${
                                  !hasHours ? 'text-slate-500 dark:text-slate-400' : isBroken ? 'text-[#d32f2f]' : isApproved ? 'text-[#2e7d32]' : 'text-slate-900 dark:text-white'
                                }`}>
                                  <div>{emp.firstName}</div>
                                  {(emp as any).siteName && selectedCompanyId === 0 && (
                                    <span className="text-[10px] font-normal text-slate-400 dark:text-slate-400 block">
                                      {(emp as any).siteName}
                                    </span>
                                  )}
                                </td>
                                <td className={`py-2.5 px-3 font-medium ${!hasHours ? 'text-slate-500 dark:text-slate-400' : 'text-slate-800 dark:text-slate-200'}`}>
                                  <div>{emp.lastName}</div>
                                </td>
                                <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-400">
                                  {emp.pin}
                                </td>
                                <td className="py-2.5 px-3 text-center">
                                  <span className={`text-[11px] font-semibold ${hasHours ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
                                    {hasHours ? 'true' : 'false'}
                                  </span>
                                </td>
                                <td className={`py-2.5 px-3 text-center font-bold ${hasHours ? 'text-slate-900 dark:text-white' : 'text-slate-400'}`}>
                                  {(emp.totalWeeklyHours ?? 0).toFixed(2)}
                                </td>
                                <td className="py-2.5 px-3 text-center text-slate-700 dark:text-slate-300">
                                  {(emp.regularHours ?? 0).toFixed(2)}
                                </td>
                                <td className="py-2.5 px-3 text-center font-medium text-slate-700 dark:text-slate-300">
                                  {(emp.overtimeHours ?? 0).toFixed(2)}
                                </td>
                                <td className="py-2.5 px-3 text-center text-slate-700 dark:text-slate-300">
                                  {(emp.doubleTimeHours ?? 0).toFixed(2)}
                                </td>
                                <td className="py-2.5 px-3 text-center">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setSelectedEmployeeDetail(emp)
                                    }}
                                    className="p-1 rounded text-[#0288d1] hover:bg-blue-100 dark:hover:bg-slate-700 transition-colors"
                                    title="Editar / Ver Detalle de Ponchadas"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              </tr>
                            )
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════════ */}
        {/* PESTAÑA 2: TODAS LAS TIENDAS (SCREENSHOT 1 / MULTI-STORE CLIENTS VIEW)      */}
        {/* ═══════════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'chain' && (
          <div className="space-y-4">
            {/* 5 Corporate KPI Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div className="bg-white dark:bg-slate-900 rounded-xl p-4 text-center border border-slate-200 dark:border-slate-800 shadow-xs">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 border-b-2 border-[#03a9f4] pb-0.5 inline-block mb-1">
                  Tiendas Auditadas
                </span>
                <span className="text-[10px] text-slate-400 block mb-1.5">Red Corporativa</span>
                <div className="text-3xl font-black text-slate-900 dark:text-white">
                  {chainData?.totalStores || 16}
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 rounded-xl p-4 text-center border border-slate-200 dark:border-slate-800 shadow-xs">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 border-b-2 border-[#03a9f4] pb-0.5 inline-block mb-1">
                  Personal Activo
                </span>
                <span className="text-[10px] text-slate-400 block mb-1.5">Cadena Completa</span>
                <div className="text-3xl font-black text-[#0288d1]">
                  {chainData?.totalActiveEmployees || chainData?.totalChainEmployees || 0}
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 rounded-xl p-4 text-center border border-slate-200 dark:border-slate-800 shadow-xs">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 border-b-2 border-[#03a9f4] pb-0.5 inline-block mb-1">
                  Horas Totales
                </span>
                <span className="text-[10px] text-slate-400 block mb-1.5">
                  {(() => {
                    const sw = weeks.find(w => w.weekId === selectedWeekId)
                    return sw ? `${formatUsaDate(sw.startDate)} - ${formatUsaDate(sw.endDate)}` : 'Periodo Actual'
                  })()}
                </span>
                <div className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white">
                  {(chainData?.totalChainHours ?? 0).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}h
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 rounded-xl p-4 text-center border border-slate-200 dark:border-slate-800 shadow-xs">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 border-b-2 border-[#03a9f4] pb-0.5 inline-block mb-1">
                  Meal Penalties
                </span>
                <span className="text-[10px] text-slate-400 block mb-1.5">Total Infracciones</span>
                <div className="text-3xl font-black text-rose-600 dark:text-rose-400">
                  {chainData?.totalMealPenalties || 0}
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 rounded-xl p-4 text-center border border-slate-200 dark:border-slate-800 shadow-xs">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 border-b-2 border-[#03a9f4] pb-0.5 inline-block mb-1">
                  Fuga Estimada USD
                </span>
                <span className="text-[10px] text-slate-400 block mb-1.5">Costo Penalizaciones</span>
                <div className="text-2xl sm:text-3xl font-black text-rose-600 dark:text-rose-400">
                  ${(chainData?.totalPenaltyCostUsd ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">
                    Clients (16 Ubicaciones)
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Auditoría comparativa corporativa para la semana seleccionada
                  </p>
                </div>

                {/* Week Selector for Chain View */}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-500">Periodo:</span>
                  <select
                    value={selectedWeekId}
                    onChange={(e) => {
                      const wId = Number(e.target.value)
                      setSelectedWeekId(wId)
                      fetchChainAudit(wId)
                    }}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold cursor-pointer"
                  >
                    {weeks.map(w => (
                      <option key={w.weekId} value={w.weekId}>
                        {formatUsaDate(w.startDate)} - {formatUsaDate(w.endDate)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Store Table */}
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-700 select-none">
                    <tr>
                      <th className="py-2.5 px-3"># Tienda</th>
                      <th
                        onClick={() => {
                          setChainSortField('store')
                          setChainSortAsc(prev => !prev)
                        }}
                        className="py-2.5 px-3 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                      >
                        Sucursal {chainSortField === 'store' ? (chainSortAsc ? '▲' : '▼') : ''}
                      </th>
                      <th className="py-2.5 px-3 text-center">Personal Activo</th>
                      <th
                        onClick={() => {
                          setChainSortField('hours')
                          setChainSortAsc(prev => !prev)
                        }}
                        className="py-2.5 px-3 text-center font-bold cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                      >
                        Total Horas {chainSortField === 'hours' ? (chainSortAsc ? '▲' : '▼') : ''}
                      </th>
                      <th
                        onClick={() => {
                          setChainSortField('ot')
                          setChainSortAsc(prev => !prev)
                        }}
                        className="py-2.5 px-3 text-center cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                      >
                        Overtime (OT) {chainSortField === 'ot' ? (chainSortAsc ? '▲' : '▼') : ''}
                      </th>
                      <th
                        onClick={() => {
                          setChainSortField('penalties')
                          setChainSortAsc(prev => !prev)
                        }}
                        className="py-2.5 px-3 text-center cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                      >
                        Meal Penalties {chainSortField === 'penalties' ? (chainSortAsc ? '▲' : '▼') : ''}
                      </th>
                      <th
                        onClick={() => {
                          setChainSortField('penaltyCost')
                          setChainSortAsc(prev => !prev)
                        }}
                        className="py-2.5 px-3 text-center cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                      >
                        Fuga ($ USD) {chainSortField === 'penaltyCost' ? (chainSortAsc ? '▲' : '▼') : ''}
                      </th>
                      <th
                        onClick={() => {
                          setChainSortField('compliance')
                          setChainSortAsc(prev => !prev)
                        }}
                        className="py-2.5 px-3 text-center font-bold cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                      >
                        Compliance Score {chainSortField === 'compliance' ? (chainSortAsc ? '▲' : '▼') : ''}
                      </th>
                      <th className="py-2.5 px-3 text-center">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {loading ? (
                      <tr>
                        <td colSpan={9} className="py-12 text-center text-slate-400">
                          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-[#03a9f4]" />
                          <span>Auditando las 16 sucursales en paralelo...</span>
                        </td>
                      </tr>
                    ) : sortedChainStores.map((st: any) => (
                      <tr
                        key={st.ronosCompanyId}
                        className="hover:bg-blue-50/40 dark:hover:bg-slate-800/50 cursor-pointer"
                        onClick={() => {
                          handleStoreChange(st.ronosCompanyId)
                          setSelectedEmployeeDetail(null)
                        }}
                      >
                        <td className="py-2.5 px-3 font-mono text-slate-500">
                          #{st.tegStoreId || st.storeId}
                        </td>
                        <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 text-[#0288d1]" />
                          <span>{st.storeName}</span>
                          {st.isBodega && (
                            <span className="text-[9px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-bold">BODEGA</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-center font-semibold text-slate-700 dark:text-slate-300">
                          {st.activeEmployees}
                        </td>
                        <td className="py-2.5 px-3 text-center font-bold text-slate-900 dark:text-white">
                          {(st.totalHours ?? 0).toFixed(2)} hrs
                        </td>
                        <td className="py-2.5 px-3 text-center text-amber-600 font-semibold">
                          {(st.overtimeHours ?? 0).toFixed(2)} hrs
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span className={`px-2 py-0.5 rounded font-bold ${
                            (st.mealPenaltiesCount ?? st.mealPenalties ?? 0) > 0 ? 'bg-rose-100 text-rose-700' : 'text-slate-400'
                          }`}>
                            {st.mealPenaltiesCount ?? st.mealPenalties ?? 0}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center font-bold text-rose-600">
                          ${(st.estimatedPenaltyCostUsd ?? st.penaltyCostUsd ?? 0).toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span className={`px-2 py-0.5 rounded font-bold ${
                            (st.complianceScore ?? 0) >= 95 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                          }`}>
                            {st.complianceScore ?? 0}%
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleStoreChange(st.ronosCompanyId)
                              setSelectedEmployeeDetail(null)
                            }}
                            className="px-2.5 py-1 rounded bg-[#0288d1] hover:bg-[#0277bd] text-white font-bold text-[11px] cursor-pointer"
                          >
                            {t('ronos.btn_view_store')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════════ */}
        {/* PESTAÑA 3: VINCULAR EMPLEADOS (TOAST & PIN MAPPINGS)                        */}
        {/* ═══════════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'mapping' && (
          <div className="space-y-4">
            {/* 5 Mapping Stats Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div className="bg-white dark:bg-slate-900 rounded-xl p-4 text-center border border-slate-200 dark:border-slate-800 shadow-xs">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 border-b-2 border-[#03a9f4] pb-0.5 inline-block mb-1">
                  Total RONOS
                </span>
                <span className="text-[10px] text-slate-400 block mb-1.5">En esta sucursal</span>
                <div className="text-3xl font-black text-slate-900 dark:text-white">
                  {mappingStats.totalRonos}
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 rounded-xl p-4 text-center border border-slate-200 dark:border-slate-800 shadow-xs">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 border-b-2 border-[#03a9f4] pb-0.5 inline-block mb-1">
                  Auto-Vinculados
                </span>
                <span className="text-[10px] text-slate-400 block mb-1.5">Por PIN / Nombre</span>
                <div className="text-3xl font-black text-emerald-600 dark:text-emerald-400">
                  {mappingStats.autoMatched}
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 rounded-xl p-4 text-center border border-slate-200 dark:border-slate-800 shadow-xs">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 border-b-2 border-[#03a9f4] pb-0.5 inline-block mb-1">
                  Manuales
                </span>
                <span className="text-[10px] text-slate-400 block mb-1.5">Verificados por Admin</span>
                <div className="text-3xl font-black text-[#0288d1]">
                  {mappingStats.manuallyMatched}
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 rounded-xl p-4 text-center border border-slate-200 dark:border-slate-800 shadow-xs">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 border-b-2 border-[#03a9f4] pb-0.5 inline-block mb-1">
                  Inactivos
                </span>
                <span className="text-[10px] text-slate-400 block mb-1.5">Ex-colaboradores</span>
                <div className="text-3xl font-black text-slate-500 dark:text-slate-400">
                  {mappingStats.inactive}
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 rounded-xl p-4 text-center border border-slate-200 dark:border-slate-800 shadow-xs">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 border-b-2 border-[#03a9f4] pb-0.5 inline-block mb-1">
                  Sin Vincular
                </span>
                <span className="text-[10px] text-slate-400 block mb-1.5">Requieren atención</span>
                <div className="text-3xl font-black text-rose-600 dark:text-rose-400">
                  {mappingStats.unmapped}
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                <div>
                  <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <LinkIcon className="w-5 h-5 text-[#0288d1]" />
                    <span>{t('ronos.mapping_title')}</span>
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {t('ronos.mapping_desc')}
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Store Selector for Mapping */}
                  <select
                    value={selectedCompanyId}
                    onChange={(e) => handleStoreChange(Number(e.target.value))}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold cursor-pointer"
                  >
                    <option value={0}>
                      🌟 {t('ronos.opt_all_stores') || 'Todas las Tiendas'}
                    </option>
                    {stores.map(st => (
                      <option key={st.ronosCompanyId} value={st.ronosCompanyId}>
                        {st.tegName}
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={handleAutoMapAll}
                    disabled={mappingLoading}
                    className="px-3.5 py-1.5 rounded-lg bg-[#43a047] hover:bg-[#388e3c] text-white font-bold text-xs shadow-xs transition-all active:scale-95 cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{t('ronos.btn_auto_map_all')}</span>
                  </button>
                  <button
                    onClick={handleRefreshTransfers}
                    disabled={refreshingTransfers}
                    className="px-3.5 py-1.5 rounded-lg bg-[#0288d1] hover:bg-[#0277bd] text-white font-bold text-xs shadow-xs transition-all active:scale-95 cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${refreshingTransfers ? 'animate-spin' : ''}`} />
                    <span>Escanear Traslados</span>
                  </button>
                </div>
              </div>

              {/* Toolbar: Search + Filter Pills */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1 text-xs">
                <div className="relative max-w-sm w-full">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={mappingSearch}
                    onChange={(e) => setMappingSearch(e.target.value)}
                    placeholder="Buscar por colaborador o PIN..."
                    className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[#03a9f4]"
                  />
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => setMappingFilter('all')}
                    className={`px-3 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                      mappingFilter === 'all'
                        ? 'bg-[#0288d1] text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
                    }`}
                  >
                    Todos ({mappingsList.length})
                  </button>
                  <button
                    onClick={() => setMappingFilter('unmapped')}
                    className={`px-3 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                      mappingFilter === 'unmapped'
                        ? 'bg-rose-600 text-white'
                        : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 hover:bg-rose-100'
                    }`}
                  >
                    Sin Vincular ({mappingStats.unmapped})
                  </button>
                  <button
                    onClick={() => setMappingFilter('matched')}
                    className={`px-3 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                      mappingFilter === 'matched'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 hover:bg-emerald-100'
                    }`}
                  >
                    Vinculados ({mappingStats.autoMatched + mappingStats.manuallyMatched})
                  </button>
                  <button
                    onClick={() => setMappingFilter('inactive')}
                    className={`px-3 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                      mappingFilter === 'inactive'
                        ? 'bg-slate-600 text-white'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 hover:bg-slate-200'
                    }`}
                  >
                    Inactivos ({mappingStats.inactive})
                  </button>
                </div>
              </div>

              {/* Mappings Table */}
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="py-2.5 px-3">Colaborador RONOS</th>
                      <th className="py-2.5 px-3">PIN</th>
                      <th className="py-2.5 px-3">Estado Mapeo</th>
                      <th className="py-2.5 px-3">Perfil Toast POS Asociado</th>
                      <th className="py-2.5 px-3">Correo Toast</th>
                      <th className="py-2.5 px-3 text-center">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {mappingLoading ? (
                      <tr>
                        <td colSpan={6} className="py-12 text-center text-slate-400">
                          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-[#03a9f4]" />
                          <span>Cargando catálogo de vinculaciones...</span>
                        </td>
                      </tr>
                    ) : filteredMappings.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-12 text-center text-slate-400">
                          <Users className="w-6 h-6 mx-auto mb-2 opacity-50" />
                          <span>No se encontraron colaboradores para este filtro.</span>
                        </td>
                      </tr>
                    ) : (
                      filteredMappings.map((item) => (
                        <tr key={item.ronosEmployeeUserId} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white">
                            <div className="flex items-center gap-2">
                              <span>{item.ronosFullName}</span>
                              {item.transferredToStore && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                                  <Plane className="w-3 h-3" />
                                  <span>{item.transferredToStore}</span>
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-400">
                            {item.ronosPin}
                          </td>
                          <td className="py-2.5 px-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              item.mappingType === 'auto'
                                ? 'bg-emerald-100 text-emerald-800'
                                : item.mappingType === 'manual'
                                ? 'bg-blue-100 text-blue-800'
                                : item.mappingType === 'inactive'
                                ? 'bg-slate-200 text-slate-600'
                                : 'bg-rose-100 text-rose-800'
                            }`}>
                              {item.mappingType === 'auto' ? 'Auto' : item.mappingType === 'manual' ? 'Manual' : item.mappingType === 'inactive' ? 'Inactivo' : 'Sin Vincular'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <select
                              value={item.toastEmployeeId || ''}
                              onChange={(e) => handleSaveSingleMapping(item, e.target.value)}
                              disabled={savingMappingId === item.ronosEmployeeUserId}
                              className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs w-full max-w-xs cursor-pointer"
                            >
                              <option value="UNLINK">-- Seleccionar Toast --</option>
                              <option value="INACTIVE">🚫 Inactivo (No Labora)</option>
                              {toastCandidates.map(tc => {
                                const name = tc.fullName || tc.full_name || 'Colaborador'
                                const job = tc.jobTitle || tc.job_title || 'Colaborador'
                                return (
                                  <option key={tc.id} value={tc.id}>
                                    {name} ({job})
                                  </option>
                                )
                              })}
                            </select>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-400">
                            {item.toastEmail || 'Sin Correo'}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            {item.mappingType === 'inactive' ? (
                              <button
                                onClick={() => handleSaveSingleMapping(item, 'UNLINK')}
                                className="text-[10px] px-2.5 py-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold cursor-pointer"
                              >
                                Reactivar
                              </button>
                            ) : (
                              <button
                                onClick={() => handleSaveSingleMapping(item, 'INACTIVE')}
                                className="text-[10px] px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 font-medium cursor-pointer"
                              >
                                Marcar Inactivo
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════════ */}
        {/* PESTAÑA 4: FACTURACIÓN Y NÓMINA (CINGULAR HR RECONCILIATION)               */}
        {/* ═══════════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'payroll' && (
          <div className="space-y-5">
            {/* Header & Controls Card */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                <div>
                  <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <Receipt className="w-5 h-5 text-[#0288d1]" />
                    <span>{t('ronos.tab_payroll')}</span>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                      Simplify HR Sync
                    </span>
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Conciliación y auditoría de facturación Cingular HR con tarifas reales de Simplify HR
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Sync Live Simplify HR */}
                  <button
                    onClick={handleSyncLive}
                    disabled={syncing || payrollLoading}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-[#0288d1] border border-blue-200 hover:bg-blue-100 dark:bg-slate-800 dark:border-slate-700 font-bold text-xs shadow-xs cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                    <span>{syncing ? 'Sincronizando...' : 'Refrescar Tarifas Simplify HR'}</span>
                  </button>

                  {/* Export Official Cingular CSV */}
                  <a
                    href={`/api/ronos/payroll?companyId=${selectedCompanyId}&weekIds=${payrollBiWeekly ? (selectedBiWeeklyPeriod || biWeeklyPeriods[0]?.id || '') : (selectedWeekId || '')}&biWeekly=${payrollBiWeekly}&format=csv`}
                    download
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#43a047] hover:bg-[#388e3c] text-white font-bold text-xs shadow-xs cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{t('ronos.btn_export_cingular_csv')}</span>
                  </a>
                </div>
              </div>

              {/* Controls Bar: Store Selector + Period Selector + Mode Radios */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center pt-1">
                {/* Store Selector */}
                <div className="sm:col-span-4">
                  <label className="block text-[11px] text-slate-500 font-semibold mb-1">Sucursal / Tienda</label>
                  <select
                    value={selectedCompanyId}
                    onChange={(e) => handleStoreChange(Number(e.target.value))}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold cursor-pointer"
                  >
                    <option value={0}>
                      🌟 {t('ronos.opt_all_stores') || 'Todas las Tiendas'}
                    </option>
                    {stores.map(st => (
                      <option key={st.ronosCompanyId} value={st.ronosCompanyId}>
                        {st.tegName}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Period Selector */}
                <div className="sm:col-span-5">
                  <label className="block text-[11px] text-slate-500 font-semibold mb-1">
                    {payrollBiWeekly ? 'Periodo Bisemanal Cingular HR' : 'Semana de Nómina'}
                  </label>
                  {payrollBiWeekly ? (
                    <select
                      value={selectedBiWeeklyPeriod}
                      onChange={(e) => {
                        setSelectedBiWeeklyPeriod(e.target.value)
                        fetchPayroll(selectedCompanyId, e.target.value, true)
                      }}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold cursor-pointer"
                    >
                      {biWeeklyPeriods.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select
                      value={selectedWeekId}
                      onChange={(e) => {
                        const wId = Number(e.target.value)
                        setSelectedWeekId(wId)
                        fetchPayroll(selectedCompanyId, wId, false)
                      }}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold cursor-pointer"
                    >
                      {weeks.map(w => (
                        <option key={w.weekId} value={w.weekId}>
                          {formatUsaDate(w.startDate)} - {formatUsaDate(w.endDate)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Mode Radios */}
                <div className="sm:col-span-3 flex items-center justify-end gap-3 pt-3">
                  <label className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer">
                    <input
                      type="radio"
                      name="payrollMode"
                      checked={payrollBiWeekly}
                      onChange={() => {
                        setPayrollBiWeekly(true)
                        const periodId = selectedBiWeeklyPeriod || biWeeklyPeriods[0]?.id || ''
                        fetchPayroll(selectedCompanyId, periodId, true)
                      }}
                      className="accent-[#0288d1]"
                    />
                    <span>Bisemanal (Factura)</span>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer">
                    <input
                      type="radio"
                      name="payrollMode"
                      checked={!payrollBiWeekly}
                      onChange={() => {
                        setPayrollBiWeekly(false)
                        fetchPayroll(selectedCompanyId, selectedWeekId, false)
                      }}
                      className="accent-[#0288d1]"
                    />
                    <span>Semanal</span>
                  </label>
                </div>
              </div>

              {/* 4 Financial KPI Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-center shadow-2xs">
                  <span className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-400 block mb-1">
                    {t('ronos.kpi_total_invoiced')}
                  </span>
                  <span className="text-2xl font-black text-emerald-700 dark:text-emerald-300">
                    ${(payrollData?.totalInvoicedAmount ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                  <span className="text-[10px] text-emerald-600 block mt-0.5">Monto total facturado</span>
                </div>

                <div className="p-3.5 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-center shadow-2xs">
                  <span className="text-[11px] font-semibold text-blue-800 dark:text-blue-400 block mb-1">
                    {t('ronos.kpi_gross_pay')}
                  </span>
                  <span className="text-2xl font-black text-blue-700 dark:text-blue-300">
                    ${(payrollData?.totalGrossPay ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                  <span className="text-[10px] text-blue-600 block mt-0.5">Sueldos brutos a pagar</span>
                </div>

                <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-center shadow-2xs">
                  <span className="text-[11px] font-semibold text-amber-800 dark:text-amber-400 block mb-1">
                    {t('ronos.kpi_cingular_fee')}
                  </span>
                  <span className="text-2xl font-black text-amber-700 dark:text-amber-300">
                    ${(payrollData?.totalCingularFee ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                  <span className="text-[10px] text-amber-600 block mt-0.5">Margen y cargos PEO</span>
                </div>

                <div className="p-3.5 rounded-xl bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 text-center shadow-2xs">
                  <span className="text-[11px] font-semibold text-purple-800 dark:text-purple-400 block mb-1">
                    Horas Totales Facturadas
                  </span>
                  <span className="text-2xl font-black text-purple-700 dark:text-purple-300">
                    {(payrollData?.totalHours ?? 0).toFixed(2)} hrs
                  </span>
                  <span className="text-[10px] text-purple-600 block mt-0.5">
                    {payrollData?.employees?.length || 0} colaboradores
                  </span>
                </div>
              </div>

              {/* Toolbar: Search + Audit Variance Filter Pills */}
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                <div className="relative max-w-sm w-full">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={payrollSearch}
                    onChange={(e) => setPayrollSearch(e.target.value)}
                    placeholder="Buscar por colaborador, puesto o nota de auditoría..."
                    className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[#03a9f4]"
                  />
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    onClick={() => setPayrollFilterType('all')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                      payrollFilterType === 'all'
                        ? 'bg-[#0288d1] text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
                    }`}
                  >
                    Todos ({payrollData?.employees?.length || 0})
                  </button>
                  <button
                    onClick={() => setPayrollFilterType('exact')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                      payrollFilterType === 'exact'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 hover:bg-emerald-100'
                    }`}
                  >
                    Cuadre Exacto
                  </button>
                  <button
                    onClick={() => setPayrollFilterType('saving')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                      payrollFilterType === 'saving'
                        ? 'bg-blue-600 text-white'
                        : 'bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300 hover:bg-blue-100'
                    }`}
                  >
                    Ahorro Favorable
                  </button>
                  <button
                    onClick={() => setPayrollFilterType('variance')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                      payrollFilterType === 'variance'
                        ? 'bg-amber-600 text-white'
                        : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 hover:bg-amber-100'
                    }`}
                  >
                    Diferencia Tarifa
                  </button>
                  <button
                    onClick={() => setPayrollFilterType('pto')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                      payrollFilterType === 'pto'
                        ? 'bg-purple-600 text-white'
                        : 'bg-purple-50 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300 hover:bg-purple-100'
                    }`}
                  >
                    Con PTO / Sick
                  </button>
                  <button
                    onClick={() => setPayrollFilterType('violations')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                      payrollFilterType === 'violations'
                        ? 'bg-rose-600 text-white'
                        : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 hover:bg-rose-100'
                    }`}
                  >
                    Con OT / Multas
                  </button>
                </div>
              </div>

              {/* Payroll Employee Table */}
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="py-2.5 px-3">Colaborador</th>
                      <th className="py-2.5 px-3">Puesto</th>
                      <th className="py-2.5 px-3 text-center">Tipo</th>
                      <th className="py-2.5 px-3 text-center">Pay Rate</th>
                      <th className="py-2.5 px-3 text-center">Bill Rate</th>
                      <th className="py-2.5 px-3 text-center font-bold">Total Horas</th>
                      <th className="py-2.5 px-3 text-center">Regular</th>
                      <th className="py-2.5 px-3 text-center">OT (h)</th>
                      <th className="py-2.5 px-3 text-center">DT (h)</th>
                      <th className="py-2.5 px-3 text-center text-amber-600 dark:text-amber-400 font-semibold">{t('ronos.col_meal_penalties') || 'Meal (Multas)'}</th>
                      <th className="py-2.5 px-3 text-center">Sick/PTO</th>
                      <th className="py-2.5 px-3 text-center font-bold">Sueldo Bruto</th>
                      <th className="py-2.5 px-3 text-center text-amber-700 dark:text-amber-400 font-semibold">Margen Cingular</th>
                      <th className="py-2.5 px-3 text-center font-bold text-emerald-700 dark:text-emerald-400">Total Factura</th>
                      <th className="py-2.5 px-3 text-center">Auditoría</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {payrollLoading ? (
                      <tr>
                        <td colSpan={15} className="py-12 text-center text-slate-400">
                          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-[#03a9f4]" />
                          <span>Calculando pre-factura oficial de Cingular HR con tarifas de Simplify HR...</span>
                        </td>
                      </tr>
                    ) : filteredPayrollEmployees.length === 0 ? (
                      <tr>
                        <td colSpan={15} className="py-12 text-center text-slate-400">
                          <Receipt className="w-6 h-6 mx-auto mb-2 opacity-50" />
                          <span>No hay datos de nómina disponibles para los filtros seleccionados.</span>
                        </td>
                      </tr>
                    ) : (
                      filteredPayrollEmployees.map((emp: any, idx: number) => (
                        <tr key={`${emp.employeeUserId}-${emp.siteName || idx}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white">
                            <div>{emp.fullName}</div>
                            {emp.siteName && (
                              <span className="text-[10px] font-normal text-slate-400 dark:text-slate-400 block">
                                {emp.siteName}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">
                            {emp.jobTitle}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              emp.isSalaried ? 'bg-purple-100 text-purple-800' : 'bg-slate-100 text-slate-700'
                            }`}>
                              {emp.isSalaried ? 'Salaried' : 'Hourly'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono">
                            ${(emp.payRate ?? 0).toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono text-[#0288d1] font-bold">
                            ${(emp.billRate ?? 0).toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-center font-bold text-slate-900 dark:text-white">
                            {(emp.totalHours ?? 0).toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-center text-slate-700 dark:text-slate-300 font-mono">
                            {(emp.regularHours ?? 0).toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono text-amber-600 font-semibold">
                            {(emp.overtimeHours ?? 0).toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono text-rose-600 font-semibold">
                            {(emp.doubleTimeHours ?? 0).toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono font-bold">
                            {(emp.mealPenaltyHours ?? 0) > 0 ? (
                              <span className="inline-block bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 px-1.5 py-0.5 rounded font-bold border border-amber-300 dark:border-amber-800 text-[11px]">
                                {(emp.mealPenaltyHours ?? 0).toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-slate-400 text-[11px]">0.00</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono text-purple-600">
                            {((emp.sickHours ?? 0) + (emp.vacationHours ?? 0) + (emp.holidayHours ?? 0)).toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono font-bold text-slate-900 dark:text-white">
                            ${(emp.totalGrossPay ?? 0).toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono text-amber-700 dark:text-amber-400 font-semibold">
                            ${(emp.cingularFeeAmount ?? 0).toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono font-black text-emerald-600 dark:text-emerald-400">
                            ${(emp.totalInvoicedAmount ?? 0).toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <span
                              title={emp.auditNote || 'Auditoría normal'}
                              className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold cursor-help ${
                                emp.auditStatus === 'exact'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : emp.auditStatus === 'saving'
                                  ? 'bg-blue-100 text-blue-800'
                                  : emp.auditStatus === 'variance'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {emp.auditBadgeText || 'Normal'}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL FOTOGRAFÍA RELOJ CHECADOR AWS S3 (ROTACIÓN & ZOOM)                    */}
      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {photoModal.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full p-5 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-bold text-base text-slate-900 dark:text-white">
                  {photoModal.title} • {photoModal.employeeName}
                </h3>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  {photoModal.timestamp}
                </p>
              </div>
              <button
                onClick={() => setPhotoModal(prev => ({ ...prev, isOpen: false }))}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>

            <div className="bg-slate-950 rounded-xl p-3 flex items-center justify-center min-h-[300px] overflow-hidden">
              <img
                src={photoModal.photoUrl}
                alt={`Ponchada ${photoModal.employeeName}`}
                style={{ transform: `rotate(${photoModal.rotation}deg)` }}
                className="max-h-80 max-w-full rounded object-contain transition-transform duration-300"
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                onClick={handleRotate}
                className="px-3.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-xs font-bold flex items-center gap-1.5"
              >
                <RotateCw className="w-4 h-4 text-[#0288d1]" />
                <span>{t('ronos.btn_rotate')}</span>
              </button>
              <button
                onClick={() => setPhotoModal(prev => ({ ...prev, isOpen: false }))}
                className="px-4 py-1.5 rounded-lg bg-[#0288d1] text-white text-xs font-bold"
              >
                {t('ronos.btn_close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL AVISO LABORAL POR CORREO (ESCALERA DE MANDO)                          */}
      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {emailModal.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-xl w-full p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-rose-100 text-rose-600">
                  <Mail className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900 dark:text-white">
                    {t('ronos.modal_notify_title')}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {emailModal.employeeName} (PIN #{emailModal.employeePin})
                  </p>
                </div>
              </div>
              <button
                onClick={() => setEmailModal(prev => ({ ...prev, isOpen: false }))}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>

            {emailModal.sendSuccess ? (
              <div className="py-8 text-center space-y-3">
                <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
                <h4 className="font-bold text-base text-slate-900 dark:text-white">Aviso Enviado con Éxito</h4>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  El correo formal de advertencia ha sido despachado al colaborador y a la escalera de mando.
                </p>
                <button
                  onClick={() => setEmailModal(prev => ({ ...prev, isOpen: false }))}
                  className="px-5 py-2 rounded-xl bg-[#0288d1] text-white text-xs font-bold"
                >
                  {t('ronos.btn_close')}
                </button>
              </div>
            ) : (
              <div className="space-y-4 text-xs">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {t('ronos.notify_recipient')}
                  </label>
                  <input
                    type="email"
                    value={emailModal.employeeEmail}
                    onChange={(e) => setEmailModal(prev => ({ ...prev, employeeEmail: e.target.value }))}
                    placeholder="ejemplo@tacosgavilan.com"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {t('ronos.notify_notes_label')}
                  </label>
                  <textarea
                    value={emailModal.additionalNotes}
                    onChange={(e) => setEmailModal(prev => ({ ...prev, additionalNotes: e.target.value }))}
                    placeholder={t('ronos.notify_notes_placeholder')}
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>

                {emailModal.sendError && (
                  <div className="p-2.5 rounded bg-rose-50 text-rose-700 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{emailModal.sendError}</span>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <button
                    onClick={() => setEmailModal(prev => ({ ...prev, isOpen: false }))}
                    className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 font-bold"
                  >
                    {t('ronos.btn_close')}
                  </button>
                  <button
                    onClick={handleSendWarningEmail}
                    disabled={emailModal.isSending}
                    className="px-5 py-2 rounded-lg bg-[#e53935] hover:bg-[#d32f2f] text-white font-bold flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{emailModal.isSending ? t('ronos.sending_warning') : t('ronos.btn_send_warning_now')}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Envolver con protección por rol 'admin'
export default function RonosLaborAuditPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <RonosLaborAuditContent />
    </ProtectedRoute>
  )
}
