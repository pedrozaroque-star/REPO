/**
 * @module app/admin/ronos/page
 * @description Módulo de Auditoría Laboral, Ponchadas en Vivo, Cumplimiento California y Conciliación de Nómina / Facturación Cingular HR (RONOS).
 *   - **Pestaña 1: Auditoría y Cumplimiento Laboral (Compliance)**:
 *     * Monitoreo en tiempo real de ponchadas, horas extras (OT/DT), descansos de comida y fotografías AWS S3.
 *     * Detección algorítmica de violaciones laborales de California (IWC Wage Order 5 / Labor Code § 512):
 *       - Meal Penalties: inicio de comida después de la 5ta hora (> 4h 59m) o descanso < 30 min.
 *       - Exención legal de 6 horas: turnos <= 6.0h pueden omitir comida legalmente.
 *       - Detección de tarjetas rotas/incompletas (Broken Timecards) y descansos excesivos (> 35 min).
 *   - **Pestaña 2: Reloj en Vivo (Live Clock)**:
 *     * Vista en tiempo real de colaboradores actualmente laborando por sucursal.
 *   - **Pestaña 3: Mapeo de Colaboradores (Employee Mapping)**:
 *     * Vinculación bidireccional entre identidades de RONOS (PIN/User ID) y Toast POS (Planificador).
 *     * Detección de traslados multi-tienda y colaboradores flotantes.
 *   - **Pestaña 4: Facturación Cingular & Nómina (Cingular HR Reconciliation Engine)**:
 *     * Conciliación matemática al centavo contra facturas oficiales de Cingular HR (ej. `invoice-TEGW-0009.pdf`).
 *     * Extracción automática de horas de Enfermedad (Sick Pay), Vacaciones (PTO Vacation) y Feriados (Holiday) desde el detalle diario (`workDays`) registrado en las tabletas RONOS de sucursal.
 *     * Desglose de Salarios Brutos (TOT PAY), Margen Cingular (25.98% Markup Fee) y Facturación Total (TOT BILL).
 *     * Exportación de CSV idéntico al Summary Report oficial de Cingular HR.
 *
 * @businessRules
 *   - **Horario Operativo**: El día laboral inicia a las 6:00 AM y termina a las 5:59 AM del siguiente día. El turno PM inicia a las 5:00 PM.
 *   - **Personal Asalariado (Exempt)**:
 *     * General Managers y Area Supervisors: Salario fijo bisemanal (80h estándar).
 *     * Exentos de Overtime, Double Time y Meal Penalties. Tarifa de facturación fija (markup ~24.51%).
 *   - **Personal Por Hora (Non-Exempt - Asistente hacia abajo)**:
 *     * Salario basado 100% en ponchadas reales de reloj checador + horas PTO aprobadas en RONOS.
 *     * Markup Cingular: 25.98% sobre salario base (BILL_RATE = PAY_RATE * 1.25976).
 *     * Horas Regulares: REG_HRS * BILL_RATE.
 *     * Horas Extras (OT 1.5x): OT_HRS * (BILL_RATE * 1.5).
 *     * Horas Dobles (DT 2.0x): DT_HRS * (BILL_RATE * 2.0).
 *     * Otras Horas (Meal Penalties, Sick, Vacation, Holiday): OTHER_HRS * BILL_RATE.
 *   - **Filtro de Placeholder**: El registro `'Manager Default'` (ID 26931, PIN 4444) es un comodín del sistema RONOS y se excluye automáticamente de la nómina real.
 *   - **Bilingüe Obligatorio**: Todo texto visible al usuario debe estar en Español e Inglés mediante `useLanguage()` y `t()`.
 *   - **Nombre de Marca**: Estrictamente **Tacos Gavilan** (nunca "Tacos El Gavilan").
 *
 * @dataFlow
 *   RONOS API v2.0 (`WorkWeek/AdminGetWeekByWeekId` + `WorkWeek/ManagerGetUserWeekByWeekId`) -> `ronos_employee_timecards_cache` (Supabase) + `toast_employees.wage_data` -> `payroll-calculator` -> /admin/ronos Tab 4.
 *
 * @notes
 *   - Corrección forense Agosto 2026: Las horas de vacaciones y enfermedad se capturan en las tabletas RONOS en la tienda y vienen en `workDays[].vacationHours` y `workDays[].sickHours`. Se agregaron columnas dedicadas a `ronos_employee_timecards_cache` para persistencia permanente y cálculo exacto.
 */

'use client'

import React, { useState, useEffect, useMemo } from 'react'
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
  RotateCw,
  Building2,
  ShieldAlert,
  BarChart3,
  Calendar,
  Lock,
  Unlock,
  AlertCircle,
  Eye,
  FileSpreadsheet,
  Mail,
  Send,
  Link as LinkIcon,
  Check,
  UserCheck,
  UserX,
  Sparkles,
  ExternalLink,
  SlidersHorizontal
} from 'lucide-react'

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
  bereavementHours?: number
}

interface EmployeeTimecard {
  employeeUserId: number
  employeeId: number
  firstName: string
  lastName: string
  fullName: string
  pin: string
  jobTitle?: string
  departmentName?: string
  totalWeeklyHours: number
  regularHours: number
  overtimeHours: number
  doubleTimeHours: number
  mealPenaltyCount: number
  brokenHours: boolean
  lockTimecard: boolean
  days: DailyRecord[]
  totalViolationsCount: number
  totalEstimatedPenaltyCostUsd: number
  toastEmployeeId?: string | null
  toastGuid?: string | null
  toastFullName?: string | null
  toastEmail?: string | null
  mappingType?: 'auto' | 'manual' | 'unmapped'
}

interface StoreAuditData {
  storeId: number
  storeCode: string
  storeName: string
  ronosCompanyId: number
  weekId: number
  startDate: string
  endDate: string
  totalEmployees: number
  activeEmployeesCount: number
  totalChainHours: number
  totalRegularHours: number
  totalOvertimeHours: number
  totalDoubleTimeHours: number
  totalMealPenaltiesCount: number
  totalBrokenTimecardsCount: number
  totalEstimatedPenaltyCostUsd: number
  totalEstimatedOvertimeCostUsd: number
  complianceScorePercent: number
  employees: EmployeeTimecard[]
}

interface ChainAuditData {
  totalStores: number
  totalChainEmployees: number
  totalActiveEmployees: number
  totalChainHours: number
  totalOvertimeHours: number
  totalDoubleTimeHours: number
  totalMealPenalties: number
  totalBrokenTimecards: number
  totalPenaltyCostUsd: number
  totalOvertimeCostUsd: number
  stores: Array<{
    storeId: number
    storeCode: string
    storeName: string
    ronosCompanyId: number
    weekId: number
    activeEmployees: number
    totalHours: number
    overtimeHours: number
    mealPenalties: number
    brokenTimecards: number
    penaltyCostUsd: number
    complianceScore: number
  }>
}

interface ToastCandidate {
  id: string
  toast_guid: string
  first_name: string
  last_name: string
  full_name: string
  email: string
  phone: string | null
  job_title?: string
  store_ids: string[]
}

interface MappedEmployeeItem {
  ronosEmployeeUserId: number
  ronosEmployeeId: number
  ronosCompanyId: number
  ronosFullName: string
  ronosFirstName: string
  ronosLastName: string
  ronosPin: string
  ronosJobTitle: string
  toastEmployeeId: string | null
  toastGuid: string | null
  toastFullName: string | null
  toastEmail: string | null
  toastPhone: string | null
  toastJobTitle: string | null
  mappingType: 'auto' | 'manual' | 'inactive' | 'unmapped'
  isConfirmed: boolean
  confidenceScore: number
  transferredToStore?: string | null
}

export default function RonosLaborAuditPage() {
  const { t, language } = useLanguage()

  // Tab: 'store' | 'chain' | 'mapping' | 'payroll'
  const [activeTab, setActiveTab] = useState<'store' | 'chain' | 'mapping' | 'payroll'>('store')

  // Selections
  const [selectedCompanyId, setSelectedCompanyId] = useState<number>(34) // Default Lynwood
  const [selectedWeekId, setSelectedWeekId] = useState<number | undefined>(undefined)

  // Data States
  const [stores, setStores] = useState<StoreOption[]>([])
  const [weeks, setWeeks] = useState<WorkWeekOption[]>([])
  const [storeData, setStoreData] = useState<StoreAuditData | null>(null)
  const [chainData, setChainData] = useState<ChainAuditData | null>(null)

  // Payroll / Cingular HR Data States
  const [payrollData, setPayrollData] = useState<any | null>(null)
  const [payrollLoading, setPayrollLoading] = useState<boolean>(false)
  const [payrollBiWeekly, setPayrollBiWeekly] = useState<boolean>(true)
  const [selectedBiWeeklyPeriod, setSelectedBiWeeklyPeriod] = useState<string>('')
  const [payrollSearch, setPayrollSearch] = useState<string>('')
  const [payrollAuditFilter, setPayrollAuditFilter] = useState<'all' | 'exact' | 'alerts' | 'pto'>('all')

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
  const [lastTransferScan, setLastTransferScan] = useState<string | null>(null)

  // Loading & Sync States
  const [loading, setLoading] = useState<boolean>(true)
  const [syncing, setSyncing] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  // Filtering
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [filterType, setFilterType] = useState<'active' | 'all' | 'violations' | 'broken'>('active')
  const [expandedEmployees, setExpandedEmployees] = useState<Record<number, boolean>>({})

  // Modal Photo Preview
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

  // 1. Carga Inicial al Montar Componente
  useEffect(() => {
    fetchStoreAudit(selectedCompanyId)
  }, [])

  // 2. Manejo de Cambio de Pestaña
  useEffect(() => {
    if (activeTab === 'chain') {
      fetchChainAudit(selectedWeekId)
    }
    if (activeTab === 'mapping') {
      fetchMappings(selectedCompanyId)
    }
    if (activeTab === 'payroll' && !payrollData) {
      const periodId = selectedBiWeeklyPeriod || (biWeeklyPeriods[0]?.id || '')
      fetchPayroll(selectedCompanyId, payrollBiWeekly ? periodId : selectedWeekId, payrollBiWeekly)
    }
  }, [activeTab])

  // Cambio de tienda global: limpia estados previos y carga los datos de la nueva tienda
  const handleStoreChange = async (newCompanyId: number, targetWeekId?: number) => {
    setSelectedCompanyId(newCompanyId)
    setSelectedWeekId(targetWeekId)
    setSelectedBiWeeklyPeriod('')
    setStoreData(null)
    setPayrollData(null)
    await fetchStoreAudit(newCompanyId, targetWeekId)
    if (activeTab === 'mapping') {
      fetchMappings(newCompanyId)
    } else if (activeTab === 'chain') {
      fetchChainAudit(targetWeekId)
    }
  }

  // Fetch Store Level Data
  const fetchStoreAudit = async (companyId: number, weekId?: number) => {
    setLoading(true)
    setError(null)
    try {
      let url = `/api/ronos/punches?companyId=${companyId}`
      if (weekId) url += `&weekId=${weekId}`

      const res = await fetch(url)
      const json = await res.json()

      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Error al obtener datos de RONOS')
      }

      setStoreData(json.data)
      if (json.weeks && Array.isArray(json.weeks)) {
        setWeeks(json.weeks)
        if (!weekId && json.weeks.length > 0) {
          setSelectedWeekId(json.weeks[0].weekId)
        }

        // Si estamos en la pestaña de nómina o se cambió de tienda, calcular el periodo predeterminado de esta tienda
        const wList = json.weeks
        const sIdx = (wList.length > 0 && new Date(wList[0]?.endDate || '').getTime() > Date.now()) ? 1 : 0
        let targetPeriod = ''
        if (payrollBiWeekly && wList.length >= sIdx + 2) {
          targetPeriod = `${wList[sIdx + 1].weekId},${wList[sIdx].weekId}`
        } else if (wList.length > 0) {
          targetPeriod = `${wList[sIdx]?.weekId || wList[0]?.weekId}`
        }
        setSelectedBiWeeklyPeriod(targetPeriod)
        if (activeTab === 'payroll') {
          fetchPayroll(companyId, targetPeriod, payrollBiWeekly)
        }
      }
      if (json.stores) setStores(json.stores)
    } catch (err: any) {
      console.error('Fetch store audit error:', err)
      setError(err.message || 'Error de conexión con RONOS API')
    } finally {
      setLoading(false)
    }
  }

  // Fetch Chain Level Data
  const fetchChainAudit = async (weekId?: number, forceLive: boolean = false) => {
    setLoading(true)
    setError(null)
    try {
      const selectedWeek = weeks.find(w => w.weekId === weekId)
      const startDate = selectedWeek?.startDate?.substring(0, 10) || ''
      let url = `/api/ronos/punches?mode=chain`
      if (weekId) url += `&weekId=${weekId}`
      if (startDate) url += `&startDate=${startDate}`
      if (forceLive) url += `&force=true`

      const res = await fetch(url)
      const json = await res.json()

      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Error al obtener auditoría corporativa')
      }

      setChainData(json.data)
    } catch (err: any) {
      console.error('Fetch chain audit error:', err)
      setError(err.message || 'Error de conexión con RONOS API')
    } finally {
      setLoading(false)
    }
  }

  // Fetch Payroll / Cingular HR Data
  const fetchPayroll = async (
    companyId: number,
    weekIdsArg?: string | number,
    biWeekly: boolean = payrollBiWeekly
  ) => {
    setPayrollLoading(true)
    try {
      let url = `/api/ronos/payroll?companyId=${companyId}&biWeekly=${biWeekly}`
      if (weekIdsArg) {
        url += `&weekIds=${weekIdsArg}`
      } else if (biWeekly && selectedBiWeeklyPeriod) {
        url += `&weekIds=${selectedBiWeeklyPeriod}`
      } else if (!biWeekly && selectedWeekId) {
        url += `&weekIds=${selectedWeekId}`
      }
      const res = await fetch(url)
      const json = await res.json()
      if (json.success && json.data) {
        setPayrollData(json.data)
      }
    } catch (err: any) {
      console.error('Fetch payroll error:', err)
    } finally {
      setPayrollLoading(false)
    }
  }

  // Fetch Mappings
  const fetchMappings = async (companyId: number) => {
    setMappingLoading(true)
    try {
      const res = await fetch(`/api/ronos/mappings?companyId=${companyId}`)
      const json = await res.json()
      if (json.success && json.data) {
        setMappingsList(json.data.mappings || [])
        setToastCandidates(json.data.toastCandidates || [])
        setMappingStats(json.data.stats || { totalRonos: 0, autoMatched: 0, manuallyMatched: 0, inactive: 0, unmapped: 0 })
      }
    } catch (err: any) {
      console.error('Fetch mappings error:', err)
    } finally {
      setMappingLoading(false)
    }
  }

  // Refresh Transfer Detection Cache
  const handleRefreshTransfers = async () => {
    if (!selectedCompanyId) return
    setRefreshingTransfers(true)
    try {
      const res = await fetch('/api/ronos/refresh-transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ronosCompanyId: selectedCompanyId })
      })
      const json = await res.json()
      if (json.success) {
        setLastTransferScan(json.cachedAt)
        // Recargar mappings para reflejar los nuevos traslados
        await fetchMappings(selectedCompanyId)
      }
    } catch (err: any) {
      console.error('Refresh transfers error:', err)
    } finally {
      setRefreshingTransfers(false)
    }
  }

  // Save Mapping (Manual, Inactive, or Unlink)
  const handleSaveSingleMapping = async (item: MappedEmployeeItem, selectedToastId: string) => {
    setSavingMappingId(item.ronosEmployeeUserId)

    const isInactive = selectedToastId === '__INACTIVE__'
    const isUnlinking = selectedToastId === ''
    const toastMatch = (!isInactive && !isUnlinking) ? toastCandidates.find(t => t.id === selectedToastId) : null
    const mappingType: 'auto' | 'manual' | 'inactive' | 'unmapped' = isInactive ? 'inactive' : toastMatch ? 'manual' : 'unmapped'

    try {
      if (isUnlinking) {
        // Eliminar mapeo explícito
        const res = await fetch(`/api/ronos/mappings?ronosUserId=${item.ronosEmployeeUserId}&companyId=${selectedCompanyId}`, {
          method: 'DELETE'
        })
        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}))
          throw new Error(errJson.error || 'Error al desvincular mapeo')
        }
      } else {
        // Guardar mapeo (Toast o Inactivo)
        const res = await fetch('/api/ronos/mappings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ronosEmployeeUserId: item.ronosEmployeeUserId,
            ronosEmployeeId: item.ronosEmployeeId,
            ronosCompanyId: selectedCompanyId,
            ronosFullName: item.ronosFullName,
            ronosPin: item.ronosPin,
            ronosJobTitle: isInactive ? 'Inactivo' : item.ronosJobTitle,
            toastEmployeeId: toastMatch?.id || null,
            toastGuid: toastMatch?.toast_guid || null,
            toastFullName: isInactive ? 'INACTIVO / NO LABORA' : toastMatch?.full_name || null,
            toastEmail: isInactive ? null : toastMatch?.email || null,
            mappingType,
            isConfirmed: true
          })
        })
        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}))
          throw new Error(errJson.error || 'Error al guardar mapeo')
        }
      }

      // Refrescar lista de mapeos y auditoría de tienda
      await fetchMappings(selectedCompanyId)
      fetchStoreAudit(selectedCompanyId, selectedWeekId)
    } catch (err) {
      console.error('Error saving mapping:', err)
    } finally {
      setSavingMappingId(null)
    }
  }

  // Auto-Map All High Confidence (Parallelized with Promise.allSettled)
  const handleAutoMapAll = async () => {
    setMappingLoading(true)
    try {
      const unmappedOrAuto = mappingsList.filter(m => m.mappingType === 'auto' && m.toastEmployeeId && !m.isConfirmed)
      await Promise.allSettled(
        unmappedOrAuto.map(item =>
          fetch('/api/ronos/mappings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ronosEmployeeUserId: item.ronosEmployeeUserId,
              ronosEmployeeId: item.ronosEmployeeId,
              ronosCompanyId: selectedCompanyId,
              ronosFullName: item.ronosFullName,
              ronosPin: item.ronosPin,
              ronosJobTitle: item.ronosJobTitle,
              toastEmployeeId: item.toastEmployeeId,
              toastGuid: item.toastGuid,
              toastFullName: item.toastFullName,
              toastEmail: item.toastEmail,
              mappingType: 'auto',
              isConfirmed: true
            })
          })
        )
      )
      await fetchMappings(selectedCompanyId)
      fetchStoreAudit(selectedCompanyId, selectedWeekId)
    } catch (err) {
      console.error('Error auto-mapping all:', err)
    } finally {
      setMappingLoading(false)
    }
  }

  // Open Warning Email Modal
  const openEmailModal = async (emp: EmployeeTimecard, day?: DailyRecord, violation?: ComplianceViolation) => {
    const targetDate = day?.date || storeData?.startDate || new Date().toISOString()
    const targetViolTitle = violation?.title || (emp.mealPenaltyCount > 0 ? 'Violación 5ta Hora (Meal Penalty)' : 'Incumplimiento de Horario')
    const targetViolDesc = violation?.description || (emp.mealPenaltyCount > 0 ? `Turno con ${emp.mealPenaltyCount} penalización(es) de comida registradas en la semana.` : 'Irregularidad en registro de ponchadas.')

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
      clockInTime: day?.clockInTime,
      lunchStartTime: day?.lunchStartTime,
      lunchEndTime: day?.lunchEndTime,
      clockOutTime: day?.clockOutTime,
      totalHoursWorked: day?.totalHours || emp.totalWeeklyHours,
      additionalNotes: '',
      escalera: null,
      isSending: false,
      sendSuccess: false,
      sendError: null
    })

    // Cargar escalera de mando para la tienda
    try {
      const res = await fetch(`/api/ronos/notify-violation?companyId=${selectedCompanyId}`)
      const json = await res.json()
      if (json.success && json.escalera) {
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

      const json = await res.json()
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Error al despachar el correo de aviso laboral')
      }

      setEmailModal(prev => ({ ...prev, isSending: false, sendSuccess: true }))
    } catch (err: any) {
      console.error('Send warning email error:', err)
      setEmailModal(prev => ({ ...prev, isSending: false, sendError: err.message || 'Error al enviar correo' }))
    }
  }

  // Sync On Demand
  const handleSyncLive = async () => {
    setSyncing(true)
    setError(null)
    try {
      if (activeTab === 'chain') {
        const res = await fetch('/api/ronos/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ syncChain: true, weekId: selectedWeekId, syncSimplify: true })
        })
        const json = await res.json()
        if (json.success) {
          setChainData(json.data)
        }
      } else if (activeTab === 'payroll') {
        const res = await fetch('/api/ronos/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyId: selectedCompanyId, weekId: selectedWeekId, syncSimplify: true })
        })
        const json = await res.json()
        if (json.success) {
          const periodId = payrollBiWeekly ? (selectedBiWeeklyPeriod || biWeeklyPeriods[0]?.id || '') : selectedWeekId
          await fetchPayroll(selectedCompanyId, periodId, payrollBiWeekly)
        }
      } else if (activeTab === 'mapping') {
        await handleRefreshTransfers()
        await fetchMappings(selectedCompanyId)
      } else {
        const res = await fetch('/api/ronos/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyId: selectedCompanyId, weekId: selectedWeekId, syncSimplify: true })
        })
        const json = await res.json()
        if (json.success) {
          setStoreData(json.data)
        }
      }
    } catch (err: any) {
      console.error('Sync live error:', err)
      setError(err.message || 'Error en sincronización en vivo')
    } finally {
      setSyncing(false)
    }
  }

  // Toggle Employee Expand
  const toggleEmployee = (empUserId: number) => {
    setExpandedEmployees(prev => ({
      ...prev,
      [empUserId]: !prev[empUserId]
    }))
  }

  // Expand / Collapse All
  const toggleAllEmployees = (expand: boolean) => {
    if (!storeData?.employees) return
    const newState: Record<number, boolean> = {}
    storeData.employees.forEach(emp => {
      newState[emp.employeeUserId] = expand
    })
    setExpandedEmployees(newState)
  }

  // Open Photo Modal
  const openPhoto = (url: string, title: string, empName: string, timestamp: string) => {
    if (!url) return
    setPhotoModal({
      isOpen: true,
      photoUrl: url,
      title,
      employeeName: empName,
      timestamp,
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
    if (!storeData || !storeData.employees) return []

    return storeData.employees.filter(emp => {
      const query = searchTerm.toLowerCase().trim()
      const matchSearch =
        !query ||
        emp.fullName.toLowerCase().includes(query) ||
        (emp.pin || '').includes(query) ||
        (emp.jobTitle && emp.jobTitle.toLowerCase().includes(query)) ||
        (emp.toastEmail && emp.toastEmail.toLowerCase().includes(query))

      if (!matchSearch) return false

      if (filterType === 'violations') {
        return emp.totalViolationsCount > 0 || emp.mealPenaltyCount > 0
      }
      if (filterType === 'broken') {
        return emp.brokenHours
      }
      if (filterType === 'active') {
        return emp.totalWeeklyHours > 0
      }

      return true
    }).sort((a, b) => (a.fullName || '').localeCompare(b.fullName || '', 'es', { sensitivity: 'base' }))
  }, [storeData, searchTerm, filterType])

  // Filtered Mappings for Tab 3
  const filteredMappings = useMemo(() => {
    return mappingsList.filter(item => {
      const query = mappingSearch.toLowerCase().trim()
      const matchSearch =
        !query ||
        item.ronosFullName.toLowerCase().includes(query) ||
        (item.ronosPin || '').includes(query) ||
        (item.toastFullName && item.toastFullName.toLowerCase().includes(query)) ||
        (item.toastEmail && item.toastEmail.toLowerCase().includes(query))

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

  // Paired bi-weekly payroll periods for Cingular
  const biWeeklyPeriods = useMemo(() => {
    if (!weeks || weeks.length === 0) return []
    const periods: Array<{
      id: string
      weekIds: [number, number]
      startDate: string
      endDate: string
      label: string
    }> = []

    // Si la semana 0 es la semana en curso (termina en el futuro o activa), los periodos cerrados inician en index 1
    const startIndex = (weeks.length > 0 && new Date(weeks[0]?.endDate || '').getTime() > Date.now()) ? 1 : 0

    // Agregar primero el periodo bisemanal cerrado más reciente (ej. 10 al 23 de agosto)
    for (let i = startIndex; i < weeks.length - 1; i += 2) {
      const wEnd = weeks[i] // e.g. 154247 (Aug 17 - Aug 23)
      const wStart = weeks[i + 1] // e.g. 154246 (Aug 10 - Aug 16)
      if (wStart && wEnd) {
        periods.push({
          id: `${wStart.weekId},${wEnd.weekId}`,
          weekIds: [wStart.weekId, wEnd.weekId],
          startDate: wStart.startDate?.substring(0, 10),
          endDate: wEnd.endDate?.substring(0, 10),
          label: `Periodo Bisemanal (${wStart.startDate?.substring(0, 10)} al ${wEnd.endDate?.substring(0, 10)}) • Sem #${wStart.weekId} + #${wEnd.weekId}`
        })
      }
    }

    // Agregar la semana en curso al final como opción si está en progreso
    if (startIndex === 1 && weeks.length > 0) {
      const w0 = weeks[0]
      periods.push({
        id: `${w0.weekId}`,
        weekIds: [w0.weekId, w0.weekId],
        startDate: w0.startDate?.substring(0, 10),
        endDate: w0.endDate?.substring(0, 10),
        label: `Semana en Curso (${w0.startDate?.substring(0, 10)} al ${w0.endDate?.substring(0, 10)}) • Sem #${w0.weekId} (En progreso)`
      })
    }

    return periods
  }, [weeks])

  // Export to CSV
  const handleExportCSV = () => {
    if (!storeData || !storeData.employees) return

    const rows: string[] = []
    rows.push(['ID Empleado', 'Nombre RONOS', 'PIN', 'Puesto', 'Correo Toast Vinculado', 'Horas Totales', 'Horas Regulares', 'Overtime (OT)', 'Double Time (DT)', 'Penalizaciones Meal', 'Broken Timecard', 'Fuga Estimada USD'].join(','))

    storeData.employees.forEach(emp => {
      rows.push([
        emp.employeeUserId,
        `"${emp.fullName}"`,
        emp.pin,
        `"${emp.jobTitle || 'Team Member'}"`,
        `"${emp.toastEmail || 'Sin Vincular'}"`,
        emp.totalWeeklyHours,
        emp.regularHours,
        emp.overtimeHours,
        emp.doubleTimeHours,
        emp.mealPenaltyCount,
        emp.brokenHours ? 'SI' : 'NO',
        `$${(emp.totalEstimatedPenaltyCostUsd ?? 0).toFixed(2)}`
      ].join(','))
    })

    const csvContent = 'data:text/csv;charset=utf-8,' + rows.join('\n')
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', `Auditoria_RONOS_${storeData.storeCode}_Semana_${storeData.weekId}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-4 sm:p-6 lg:p-8 transition-colors duration-200">
      {/* Header */}
      <div className="max-w-7xl mx-auto mb-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-6">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 rounded-xl">
                <Clock className="w-7 h-7" />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-3">
                  {t('ronos.title')}
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 font-semibold">
                    Cingular HR
                  </span>
                </h1>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                  {t('ronos.subtitle')}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={handleSyncLive}
              disabled={syncing || loading}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-semibold shadow-md shadow-amber-500/20 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
              <span>{syncing ? t('ronos.syncing') : t('ronos.btn_sync_live')}</span>
            </button>

            {activeTab === 'store' && storeData && (
              <button
                onClick={handleExportCSV}
                className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600 text-slate-700 dark:text-slate-200 font-medium text-sm transition-all hover:bg-slate-50 dark:hover:bg-slate-800 shadow-xs cursor-pointer"
              >
                <Download className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                <span>{t('ronos.btn_export_csv')}</span>
              </button>
            )}
          </div>
        </div>

        {/* Main Tab Navigation - Executive Segmented Card Tabs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-6 p-2 bg-slate-200/80 dark:bg-slate-900/90 rounded-2xl border border-slate-300/80 dark:border-slate-800 shadow-inner">
          {/* Tab 1: Store */}
          <button
            type="button"
            onClick={() => setActiveTab('store')}
            className={`flex items-center gap-3.5 p-3.5 rounded-xl font-bold transition-all text-left cursor-pointer border ${
              activeTab === 'store'
                ? 'bg-white dark:bg-slate-800 text-slate-950 dark:text-white shadow-md border-amber-500/40 dark:border-amber-500/40 ring-2 ring-amber-500/20'
                : 'bg-transparent border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/60 dark:hover:bg-slate-800/60'
            }`}
          >
            <div className={`p-2.5 rounded-xl transition-colors ${
              activeTab === 'store'
                ? 'bg-amber-500 text-slate-950 shadow-sm'
                : 'bg-slate-300/70 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
            }`}>
              <Building2 className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="block font-black text-sm text-slate-900 dark:text-white tracking-tight truncate">
                {t('ronos.tab_store')}
              </span>
              <span className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 truncate mt-0.5">
                {storeData?.storeName ? `Tienda ${storeData.storeName}` : 'Horas y fotos'}
              </span>
            </div>
          </button>

          {/* Tab 2: Chain */}
          <button
            type="button"
            onClick={() => setActiveTab('chain')}
            className={`flex items-center gap-3.5 p-3.5 rounded-xl font-bold transition-all text-left cursor-pointer border ${
              activeTab === 'chain'
                ? 'bg-white dark:bg-slate-800 text-slate-950 dark:text-white shadow-md border-amber-500/40 dark:border-amber-500/40 ring-2 ring-amber-500/20'
                : 'bg-transparent border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/60 dark:hover:bg-slate-800/60'
            }`}
          >
            <div className={`p-2.5 rounded-xl transition-colors ${
              activeTab === 'chain'
                ? 'bg-amber-500 text-slate-950 shadow-sm'
                : 'bg-slate-300/70 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
            }`}>
              <BarChart3 className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="block font-black text-sm text-slate-900 dark:text-white tracking-tight truncate">
                {t('ronos.tab_chain')}
              </span>
              <span className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 truncate mt-0.5">
                Comparativo de 16 tiendas
              </span>
            </div>
          </button>

          {/* Tab 3: Mapping */}
          <button
            type="button"
            onClick={() => setActiveTab('mapping')}
            className={`flex items-center gap-3.5 p-3.5 rounded-xl font-bold transition-all text-left cursor-pointer border ${
              activeTab === 'mapping'
                ? 'bg-white dark:bg-slate-800 text-slate-950 dark:text-white shadow-md border-amber-500/40 dark:border-amber-500/40 ring-2 ring-amber-500/20'
                : 'bg-transparent border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/60 dark:hover:bg-slate-800/60'
            }`}
          >
            <div className={`p-2.5 rounded-xl transition-colors ${
              activeTab === 'mapping'
                ? 'bg-amber-500 text-slate-950 shadow-sm'
                : 'bg-slate-300/70 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
            }`}>
              <LinkIcon className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="block font-black text-sm text-slate-900 dark:text-white tracking-tight truncate">
                {t('ronos.tab_mapping')}
              </span>
              <span className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 truncate mt-0.5">
                Toast & Correos
              </span>
            </div>
          </button>

          {/* Tab 4: Payroll */}
          <button
            type="button"
            onClick={() => setActiveTab('payroll')}
            className={`flex items-center gap-3.5 p-3.5 rounded-xl font-bold transition-all text-left cursor-pointer border ${
              activeTab === 'payroll'
                ? 'bg-white dark:bg-slate-800 text-slate-950 dark:text-white shadow-md border-emerald-500/40 dark:border-emerald-500/40 ring-2 ring-emerald-500/20'
                : 'bg-transparent border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/60 dark:hover:bg-slate-800/60'
            }`}
          >
            <div className={`p-2.5 rounded-xl transition-colors ${
              activeTab === 'payroll'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-slate-300/70 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
            }`}>
              <DollarSign className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="block font-black text-sm text-slate-900 dark:text-white tracking-tight truncate">
                {t('ronos.tab_payroll')}
              </span>
              <span className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 truncate mt-0.5">
                Facturas Cingular & Nómina
              </span>
            </div>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Error Alert */}
        {error && (
          <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300 flex items-start gap-3 shadow-xs">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
            <div>
              <p className="font-semibold text-rose-900 dark:text-rose-200">Error en Comunicación con RONOS</p>
              <p className="text-sm text-rose-700 dark:text-rose-300/90 mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════════ */}
        {/* SELECTOR GLOBAL DE TIENDA Y SEMANA DE TRABAJO (VISIBLE EN TODAS LAS PESTAÑAS) */}
        {/* ═══════════════════════════════════════════════════════════════════════════ */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 shadow-xs">
          {/* Store Selector */}
          <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-amber-500" />
              {t('ronos.select_store')}
            </label>
            <select
              value={selectedCompanyId}
              onChange={(e) => handleStoreChange(Number(e.target.value))}
              disabled={loading || payrollLoading}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 dark:text-white font-medium focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 shadow-xs cursor-pointer"
            >
              {stores.map(store => (
                <option key={store.ronosCompanyId} value={store.ronosCompanyId}>
                  {store.tegName} (Tienda #{store.tegStoreId})
                </option>
              ))}
            </select>
          </div>

          {/* Week Selector */}
          <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-amber-500" />
              {t('ronos.select_week')} {activeTab === 'payroll' && payrollBiWeekly && '(Bisemanal Cingular)'}
            </label>
            {activeTab === 'payroll' && payrollBiWeekly ? (
              <select
                value={selectedBiWeeklyPeriod || (biWeeklyPeriods[0]?.id || '')}
                onChange={(e) => {
                  setSelectedBiWeeklyPeriod(e.target.value)
                  fetchPayroll(selectedCompanyId, e.target.value, true)
                }}
                disabled={payrollLoading}
                className="w-full bg-emerald-50/70 dark:bg-slate-950 border border-emerald-300 dark:border-emerald-700/60 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 dark:text-white font-semibold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 shadow-xs cursor-pointer"
              >
                {biWeeklyPeriods.slice(0, 12).map((p, idx) => (
                  <option key={p.id} value={p.id}>
                    {idx === 0 ? '🟢 ' : ''}{p.label}
                  </option>
                ))}
              </select>
            ) : (
              <select
                value={selectedWeekId || ''}
                onChange={(e) => {
                  const newWeekId = Number(e.target.value)
                  setSelectedWeekId(newWeekId)
                  if (activeTab === 'store') {
                    fetchStoreAudit(selectedCompanyId, newWeekId)
                  } else if (activeTab === 'chain') {
                    fetchChainAudit(newWeekId)
                  } else if (activeTab === 'payroll') {
                    fetchPayroll(selectedCompanyId, newWeekId, false)
                  }
                }}
                disabled={loading}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 dark:text-white font-medium focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 shadow-xs cursor-pointer"
              >
                {weeks.slice(0, 12).map((w, idx) => (
                  <option key={w.weekId} value={w.weekId}>
                    {idx === 0 ? '🟢 ' : ''}Semana #{w.weekId} ({w.startDate?.substring(0, 10)} al {w.endDate?.substring(0, 10)})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Quick Summary Badge */}
          <div className="flex flex-col justify-center bg-slate-50 dark:bg-slate-950/60 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800/80">
            <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
              <span className="font-semibold text-slate-700 dark:text-slate-300">Sucursal Seleccionada:</span>
              <span className="font-bold text-amber-600 dark:text-amber-400">
                {stores.find(s => s.ronosCompanyId === selectedCompanyId)?.tegName || 'Lynwood'}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 mt-1.5">
              <span>Colaboradores en Nómina:</span>
              <span className="font-bold text-slate-900 dark:text-white">
                {storeData?.activeEmployeesCount || 0} activos / {storeData?.totalEmployees || 0} registrados
              </span>
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════════════ */}
        {/* TAB 1: AUDITORÍA POR SUCURSAL */}
        {/* ═══════════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'store' && (
          <>
            {/* KPI Cards Grid - Clean Modern Corporate */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Card 1: Horas Totales */}
              <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('ronos.kpi_total_hours')}
                  </span>
                  <div className="p-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl">
                    <Clock className="w-5 h-5" />
                  </div>
                </div>
                <div className="mt-3">
                  <div className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                    {storeData?.totalChainHours || 0} <span className="text-sm font-semibold text-slate-500">hrs</span>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 flex items-center gap-2 font-medium">
                    <span>Reg: <strong className="text-slate-800 dark:text-slate-200">{storeData?.totalRegularHours || 0}h</strong></span>
                    <span>•</span>
                    <span>OT/DT: <strong className="text-amber-600 dark:text-amber-400">{((storeData?.totalOvertimeHours || 0) + (storeData?.totalDoubleTimeHours || 0)).toFixed(2)}h</strong></span>
                  </div>
                </div>
              </div>

              {/* Card 2: Meal Penalty Fugas */}
              <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('ronos.kpi_meal_penalties')}
                  </span>
                  <div className={`p-2 rounded-xl ${(storeData?.totalMealPenaltiesCount || 0) > 0 ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                </div>
                <div className="mt-3">
                  <div className={`text-3xl font-black tracking-tight ${(storeData?.totalMealPenaltiesCount || 0) > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'}`}>
                    {storeData?.totalMealPenaltiesCount || 0} <span className="text-sm font-semibold text-slate-500">multas</span>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 font-medium">
                    Fuga Cingular HR: <strong className={(storeData?.totalMealPenaltiesCount || 0) > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-200'}>${storeData?.totalEstimatedPenaltyCostUsd || 0} USD</strong>
                  </div>
                </div>
              </div>

              {/* Card 3: Overtime Cost */}
              <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('ronos.kpi_overtime_cost')}
                  </span>
                  <div className="p-2 bg-slate-100 dark:bg-slate-800 text-amber-600 dark:text-amber-400 rounded-xl">
                    <DollarSign className="w-5 h-5" />
                  </div>
                </div>
                <div className="mt-3">
                  <div className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                    ${storeData?.totalEstimatedOvertimeCostUsd || 0} <span className="text-sm font-semibold text-slate-500">USD</span>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 font-medium">
                    Horas Extras: <strong className="text-amber-600 dark:text-amber-400">{storeData?.totalOvertimeHours || 0}h OT</strong> / {storeData?.totalDoubleTimeHours || 0}h DT
                  </div>
                </div>
              </div>

              {/* Card 4: Compliance Score */}
              <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('ronos.kpi_compliance_score')}
                  </span>
                  <div className="p-2 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-xl">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                </div>
                <div className="mt-3">
                  <div className={`text-3xl font-black tracking-tight ${
                    (storeData?.complianceScorePercent ?? 100) >= 90
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : (storeData?.complianceScorePercent ?? 100) >= 75
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}>
                    {storeData?.complianceScorePercent ?? 100}%
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 font-medium flex items-center justify-between">
                    <span>Incompletas (Broken): <strong className="text-slate-800 dark:text-slate-200">{storeData?.totalBrokenTimecardsCount || 0}</strong></span>
                  </div>
                </div>
              </div>
            </div>

            {/* Filter and Search Bar for Employees */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-2xl bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="relative w-full sm:w-80">
                <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Buscar por nombre, PIN, correo Toast o puesto..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl pl-10 pr-4 py-2 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-amber-500 shadow-xs"
                />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
                <button
                  onClick={() => setFilterType('active')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    filterType === 'active'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'bg-emerald-50 dark:bg-slate-950 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20 hover:bg-emerald-100 dark:hover:bg-emerald-500/10'
                  }`}
                >
                  <Clock className="w-3.5 h-3.5" />
                  Con Horas ({storeData?.activeEmployeesCount || 0})
                </button>
                <button
                  onClick={() => setFilterType('all')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    filterType === 'all'
                      ? 'bg-slate-800 dark:bg-slate-700 text-white shadow-xs'
                      : 'bg-slate-100 dark:bg-slate-950 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800'
                  }`}
                >
                  Todos en Nómina ({storeData?.employees?.length || 0})
                </button>
                <button
                  onClick={() => setFilterType('violations')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                    filterType === 'violations'
                      ? 'bg-rose-600 text-white shadow-xs'
                      : 'bg-rose-50 dark:bg-slate-950 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-500/20 hover:bg-rose-100 dark:hover:bg-rose-500/10'
                  }`}
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Con Violaciones ({storeData?.employees?.filter(e => e.totalViolationsCount > 0 || e.mealPenaltyCount > 0).length || 0})
                </button>
                <button
                  onClick={() => setFilterType('broken')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                    filterType === 'broken'
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'bg-amber-50 dark:bg-slate-950 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20 hover:bg-amber-100 dark:hover:bg-amber-500/10'
                  }`}
                >
                  Incompletas ({storeData?.employees?.filter(e => e.brokenHours).length || 0})
                </button>

                <div className="h-5 w-px bg-slate-200 dark:bg-slate-800 mx-1 hidden sm:block" />

                <button
                  onClick={() => toggleAllEmployees(true)}
                  className="px-2.5 py-1.5 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors cursor-pointer"
                >
                  Expandir todo
                </button>
                <button
                  onClick={() => toggleAllEmployees(false)}
                  className="px-2.5 py-1.5 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors cursor-pointer"
                >
                  Colapsar
                </button>
              </div>
            </div>

            {/* Employees Interactive Cards List */}
            {loading ? (
              <div className="p-12 text-center rounded-2xl bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 shadow-xs">
                <RefreshCw className="w-8 h-8 text-amber-500 animate-spin mx-auto mb-3" />
                <p className="text-slate-800 dark:text-slate-300 font-semibold">{t('ronos.syncing')}</p>
                <p className="text-xs text-slate-500 mt-1">Conectando con la base de datos de RONOS y analizando cumplimiento de leyes de California...</p>
              </div>
            ) : filteredEmployees.length === 0 ? (
              <div className="p-12 text-center rounded-2xl bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 shadow-xs">
                <Users className="w-8 h-8 text-slate-400 dark:text-slate-600 mx-auto mb-3" />
                <p className="text-slate-800 dark:text-slate-300 font-semibold">{t('ronos.empty_title')}</p>
                <p className="text-xs text-slate-500 mt-1">{t('ronos.empty_desc')}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredEmployees.map((emp) => {
                  const isExpanded = !!expandedEmployees[emp.employeeUserId]
                  const hasViolations = emp.totalViolationsCount > 0 || emp.mealPenaltyCount > 0

                  return (
                    <div
                      key={emp.employeeUserId}
                      className={`rounded-2xl border transition-all overflow-hidden shadow-xs ${
                        hasViolations
                          ? 'bg-rose-50/50 dark:bg-slate-900/90 border-rose-200 dark:border-rose-500/30'
                          : emp.brokenHours
                          ? 'bg-amber-50/50 dark:bg-slate-900/90 border-amber-200 dark:border-amber-500/30'
                          : 'bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700'
                      }`}
                    >
                      {/* Employee Header Row */}
                      <div
                        onClick={() => toggleEmployee(emp.employeeUserId)}
                        className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer select-none"
                      >
                        <div className="flex items-center gap-3.5">
                          <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-800 dark:text-slate-200 font-bold text-sm shadow-xs">
                            {emp.firstName?.[0] || 'E'}{emp.lastName?.[0] || ''}
                          </div>

                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
                                {emp.fullName}
                              </h3>
                              <span className="text-xs px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-mono">
                                PIN: {emp.pin}
                              </span>
                              <span className="text-xs px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-semibold">
                                {emp.jobTitle || 'Colaborador'}
                              </span>

                              {/* Toast Email / Mapping Badge */}
                              {emp.toastEmail ? (
                                <span className="text-xs px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-500/30 font-medium flex items-center gap-1">
                                  <Mail className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                                  {emp.toastEmail}
                                </span>
                              ) : (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setActiveTab('mapping')
                                    setMappingSearch(emp.fullName)
                                  }}
                                  className="text-xs px-2 py-0.5 rounded-md bg-amber-100 hover:bg-amber-200 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30 font-semibold flex items-center gap-1 cursor-pointer"
                                >
                                  <LinkIcon className="w-3 h-3" />
                                  {t('ronos.btn_link_toast')}
                                </button>
                              )}
                            </div>

                            {/* Alert Badges */}
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                              {emp.mealPenaltyCount > 0 && (
                                <span className="text-[11px] px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-500/20 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-500/30 font-bold flex items-center gap-1">
                                  <AlertTriangle className="w-3 h-3" />
                                  {emp.mealPenaltyCount} Violación(es) 5ta Hora (${emp.totalEstimatedPenaltyCostUsd} USD)
                                </span>
                              )}

                              {emp.brokenHours && (
                                <span className="text-[11px] px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30 font-bold flex items-center gap-1">
                                  <AlertCircle className="w-3 h-3" />
                                  Ponchada Incompleta
                                </span>
                              )}

                              {!hasViolations && !emp.brokenHours && emp.totalWeeklyHours > 0 && (
                                <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20 flex items-center gap-1 font-semibold">
                                  <CheckCircle2 className="w-3 h-3" />
                                  Conforme a Ley
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Hours Metrics and Quick Action */}
                        <div className="flex items-center gap-4 sm:gap-6 justify-between md:justify-end border-t md:border-t-0 pt-3 md:pt-0 border-slate-200 dark:border-slate-800">
                          {/* Send Warning Button on Card */}
                          {hasViolations && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                openEmailModal(emp)
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-xs transition-all active:scale-95 cursor-pointer"
                            >
                              <Mail className="w-3.5 h-3.5" />
                              <span>{t('ronos.btn_notify_email')}</span>
                            </button>
                          )}

                          <div className="text-right">
                            <span className="text-xs text-slate-500 dark:text-slate-400 block font-medium">Total Semanal</span>
                            <span className="text-lg font-bold text-slate-900 dark:text-white">
                              {emp.totalWeeklyHours.toFixed(2)} <span className="text-xs font-normal text-slate-500 dark:text-slate-400">hrs</span>
                            </span>
                          </div>

                          <div className="text-right">
                            <span className="text-xs text-slate-500 dark:text-slate-400 block font-medium">Regulares</span>
                            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                              {emp.regularHours.toFixed(2)}h
                            </span>
                          </div>

                          <div className="text-right">
                            <span className="text-xs text-slate-500 dark:text-slate-400 block font-medium">Overtime</span>
                            <span className={`text-sm font-semibold ${emp.overtimeHours > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400 dark:text-slate-500'}`}>
                              {emp.overtimeHours.toFixed(2)}h
                            </span>
                          </div>

                          <div className="text-slate-400 p-1">
                            {isExpanded ? <ChevronUp className="w-5 h-5 text-amber-500" /> : <ChevronDown className="w-5 h-5" />}
                          </div>
                        </div>
                      </div>

                      {/* Expanded Daily Details */}
                      {isExpanded && (
                        <div className="border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 p-4 sm:p-5">
                          <h4 className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                            <Calendar className="w-3.5 h-3.5 text-amber-500" />
                            Desglose de Ponchadas y Fotografías Día por Día
                          </h4>

                          {emp.days && emp.days.length > 0 ? (
                            <div className="space-y-3">
                              {emp.days.map((day, dIdx) => {
                                const hasDayPunches = day.punches && day.punches.length > 0
                                const hasPTO = (day.vacationHours || 0) > 0 || (day.sickHours || 0) > 0 || (day.holidayHours || 0) > 0 || (day.bereavementHours || 0) > 0
                                if (!hasDayPunches && day.totalHours === 0 && !hasPTO) return null

                                return (
                                  <div
                                    key={dIdx}
                                    className={`p-3.5 rounded-xl border shadow-xs ${
                                      day.violations && day.violations.length > 0
                                        ? 'bg-rose-50/80 dark:bg-rose-950/20 border-rose-200 dark:border-rose-500/30'
                                        : 'bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800'
                                    }`}
                                  >
                                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-2.5 border-b border-slate-200 dark:border-slate-800/80">
                                      <div className="flex items-center gap-2.5">
                                        <span className="text-sm font-bold text-slate-900 dark:text-white">
                                          {day.dayName}
                                        </span>
                                        <span className="text-xs text-slate-500 dark:text-slate-400">
                                          ({day.date?.substring(0, 10)})
                                        </span>
                                        <span className="text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold">
                                          {day.totalHours} hrs (Reg: {day.regularHours}h | OT: {day.overtimeHours}h)
                                        </span>
                                      </div>

                                      {/* Violations in Day & Action Button */}
                                      <div className="flex items-center gap-2 flex-wrap">
                                        {day.violations && day.violations.length > 0 && day.violations.map((v, vIdx) => (
                                          <span
                                            key={vIdx}
                                            className="text-xs px-2 py-0.5 rounded-md bg-rose-100 dark:bg-rose-500/20 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-500/30 font-bold"
                                          >
                                            ⚠️ {v.title}: {v.description}
                                          </span>
                                        ))}

                                        {day.violations && day.violations.length > 0 && (
                                          <button
                                            onClick={() => openEmailModal(emp, day, day.violations[0])}
                                            className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold cursor-pointer transition-all shadow-xs"
                                          >
                                            <Send className="w-3 h-3" />
                                            <span>Notificar Falta</span>
                                          </button>
                                        )}
                                      </div>
                                    </div>

                                    {/* Punches & Photos Grid (Soporte dinámico para 1, 2 o más descansos de comida) */}
                                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-3">
                                      {day.punches && day.punches.length > 0 ? (
                                        day.punches.map((p, pIdx) => {
                                          const pTypeUpper = (p.punchTypeName || '').toUpperCase()
                                          const isClockIn = pTypeUpper.includes('CLOCK IN') || (p.punchType === 1 && pIdx === 0)
                                          const isLunchStart = pTypeUpper.includes('START') || p.punchType === 3
                                          const isLunchEnd = pTypeUpper.includes('END') || (p.punchType === 1 && pIdx > 0)
                                          const isClockOut = pTypeUpper.includes('CLOCK OUT') || p.punchType === 2

                                          const badgeColor = isClockIn
                                            ? 'text-emerald-700 dark:text-emerald-400'
                                            : isLunchStart
                                            ? 'text-amber-700 dark:text-amber-400'
                                            : isLunchEnd
                                            ? 'text-teal-700 dark:text-teal-400'
                                            : isClockOut
                                            ? 'text-rose-700 dark:text-rose-400'
                                            : 'text-slate-700 dark:text-slate-400'

                                          const dotEmoji = isClockIn ? '🟢' : isLunchStart ? '🟡' : isLunchEnd ? '🟢' : isClockOut ? '🔴' : '⚪'

                                          return (
                                            <div
                                              key={p.punchId || pIdx}
                                              className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
                                            >
                                              <span className={`text-[11px] font-bold ${badgeColor} block mb-1 uppercase tracking-tight truncate`}>
                                                {dotEmoji} {p.punchTypeName || 'PONCHADA'}
                                              </span>
                                              <div className="text-xs font-mono text-slate-900 dark:text-white font-bold">
                                                {p.localTime ? new Date(p.localTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--'}
                                              </div>
                                              {p.photoURL ? (
                                                <button
                                                  onClick={() => openPhoto(p.photoURL!, p.punchTypeName || 'Ponchada', emp.fullName, p.localTime || '')}
                                                  className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-400 hover:underline bg-amber-50 dark:bg-amber-500/10 px-2 py-1 rounded border border-amber-200 dark:border-amber-500/20 cursor-pointer font-semibold w-full justify-center"
                                                >
                                                  <Camera className="w-3 h-3" /> Ver Foto S3
                                                </button>
                                              ) : (
                                                <span className="mt-2 block text-[10px] text-slate-400 italic text-center py-1">Sin foto</span>
                                              )}
                                            </div>
                                          )
                                        })
                                      ) : (
                                        <>
                                          {/* Fallback 4 Cards */}
                                          <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                                            <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 block mb-1">
                                              🟢 CLOCK IN
                                            </span>
                                            <div className="text-xs font-mono text-slate-900 dark:text-white font-bold">
                                              {day.clockInTime ? new Date(day.clockInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--'}
                                            </div>
                                          </div>
                                          <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                                            <span className="text-[11px] font-bold text-amber-700 dark:text-amber-400 block mb-1">
                                              🟡 LUNCH START
                                            </span>
                                            <div className="text-xs font-mono text-slate-900 dark:text-white font-bold">
                                              {day.lunchStartTime ? new Date(day.lunchStartTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--'}
                                            </div>
                                          </div>
                                          <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                                            <span className="text-[11px] font-bold text-teal-700 dark:text-teal-400 block mb-1">
                                              🟢 LUNCH END
                                            </span>
                                            <div className="text-xs font-mono text-slate-900 dark:text-white font-bold">
                                              {day.lunchEndTime ? new Date(day.lunchEndTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--'}
                                            </div>
                                          </div>
                                          <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                                            <span className="text-[11px] font-bold text-rose-700 dark:text-rose-400 block mb-1">
                                              🔴 CLOCK OUT
                                            </span>
                                            <div className="text-xs font-mono text-slate-900 dark:text-white font-bold">
                                              {day.clockOutTime ? new Date(day.clockOutTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--'}
                                            </div>
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          ) : (
                            <p className="text-xs text-slate-500 italic">No hay ponchadas atómicas registradas para esta semana.</p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════════ */}
        {/* TAB 2: SEMÁFORO Y RANKING CORPORATIVO DE LA CADENA */}
        {/* ═══════════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'chain' && (
          <div className="space-y-6">
            {/* Chain Header Summary */}
            <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-black text-slate-900 dark:text-white flex items-center gap-2.5">
                    <BarChart3 className="w-6 h-6 text-amber-500" />
                    {t('ronos.chain_title')}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
                    {t('ronos.chain_subtitle')}
                  </p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800 text-center">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-semibold">{t('ronos.chain_stores_count')}</span>
                    <span className="text-lg font-black text-slate-900 dark:text-white">{chainData?.totalStores || 16}</span>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800 text-center">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-semibold">{t('ronos.chain_active_employees')}</span>
                    <span className="text-lg font-black text-slate-900 dark:text-white">{chainData?.totalActiveEmployees || 0}</span>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800 text-center">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-semibold">{t('ronos.chain_total_penalties')}</span>
                    <span className={`text-lg font-black ${(chainData?.totalMealPenalties || 0) > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'}`}>
                      {chainData?.totalMealPenalties || 0}
                    </span>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800 text-center">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-semibold">{t('ronos.chain_penalty_leakage')}</span>
                    <span className={`text-lg font-black ${(chainData?.totalPenaltyCostUsd || 0) > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'}`}>
                      ${chainData?.totalPenaltyCostUsd || 0}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Stores Leaderboard Table */}
            {loading ? (
              <div className="p-12 text-center rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
                <RefreshCw className="w-8 h-8 text-amber-500 animate-spin mx-auto mb-3" />
                <p className="text-slate-800 dark:text-slate-200 font-bold">{t('ronos.chain_auditing_live')}</p>
                <p className="text-xs text-slate-500 mt-1">{t('ronos.chain_auditing_desc')}</p>
              </div>
            ) : !chainData?.stores || chainData.stores.length === 0 ? (
              <div className="p-12 text-center rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
                <Building2 className="w-8 h-8 text-slate-400 mx-auto mb-3" />
                <p className="text-slate-800 dark:text-slate-200 font-bold">{t('ronos.empty_title')}</p>
                <p className="text-xs text-slate-500 mt-1">{t('ronos.empty_desc')}</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 overflow-hidden shadow-xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-100/90 dark:bg-slate-950/80 text-xs uppercase text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 font-bold tracking-wider">
                      <tr>
                        <th className="py-4 px-4">{t('ronos.col_store_num')}</th>
                        <th className="py-4 px-4">{t('ronos.col_store_name')}</th>
                        <th className="py-4 px-4 text-center">{t('ronos.col_active_staff')}</th>
                        <th className="py-4 px-4 text-center">{t('ronos.chain_total_hours')}</th>
                        <th className="py-4 px-4 text-center">{t('ronos.kpi_overtime_hours')}</th>
                        <th className="py-4 px-4 text-center">{t('ronos.kpi_meal_penalties')}</th>
                        <th className="py-4 px-4 text-center">{t('ronos.kpi_estimated_leakage')}</th>
                        <th className="py-4 px-4 text-center">{t('ronos.col_compliance_legal')}</th>
                        <th className="py-4 px-4 text-center">{t('ronos.col_action')}</th>
                      </tr>
                    </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
                    {chainData?.stores?.map((st, idx) => {
                      const isHighPenalty = st.mealPenalties > 5

                      return (
                        <tr
                          key={st.ronosCompanyId}
                          className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          <td className="py-3.5 px-4 font-bold text-slate-500 dark:text-slate-400">
                            {idx + 1}
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="font-bold text-slate-900 dark:text-white block">{st.storeName}</span>
                            <span className="text-xs text-slate-500 font-mono">RONOS ID: {st.ronosCompanyId}</span>
                          </td>
                          <td className="py-3.5 px-4 text-center font-bold text-slate-700 dark:text-slate-200">
                            {st.activeEmployees}
                          </td>
                          <td className="py-3.5 px-4 text-center font-bold text-slate-900 dark:text-white">
                            {st.totalHours}h
                          </td>
                          <td className="py-3.5 px-4 text-center font-semibold text-amber-600 dark:text-amber-400">
                            {st.overtimeHours}h
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                              st.mealPenalties === 0
                                ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20'
                                : isHighPenalty
                                ? 'bg-rose-100 dark:bg-rose-500/20 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-500/40 animate-pulse'
                                : 'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30'
                            }`}>
                              {st.mealPenalties} {t('ronos.label_penalties_count')}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-center font-bold text-rose-600 dark:text-rose-400">
                            ${st.penaltyCostUsd}
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <div className="w-16 bg-slate-200 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    st.complianceScore >= 90
                                      ? 'bg-emerald-500'
                                      : st.complianceScore >= 75
                                      ? 'bg-amber-500'
                                      : 'bg-rose-500'
                                  }`}
                                  style={{ width: `${st.complianceScore}%` }}
                                />
                              </div>
                              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{st.complianceScore}%</span>
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <button
                              onClick={() => {
                                handleStoreChange(st.ronosCompanyId, selectedWeekId)
                                setActiveTab('store')
                              }}
                              className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-amber-500 hover:text-slate-950 dark:bg-slate-800 dark:hover:bg-amber-500 text-slate-800 dark:text-slate-200 text-xs font-semibold transition-all cursor-pointer shadow-xs"
                            >
                              {t('ronos.btn_view_store')}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════════ */}
        {/* TAB 3: MAPEO DE PERSONAL (RONOS ↔ TOAST PLANIFICADOR) */}
        {/* ═══════════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'mapping' && (
          <div className="space-y-6">
            {/* Mapping Header & Controls */}
            <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <LinkIcon className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                    {t('ronos.mapping_title')}
                  </h2>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 max-w-3xl">
                    {t('ronos.mapping_desc')}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={handleAutoMapAll}
                    disabled={mappingLoading}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold shadow-md shadow-blue-500/20 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>{t('ronos.btn_auto_map_all')}</span>
                  </button>
                </div>
              </div>

              {/* Stats Bar */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-6">
                <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 text-center">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-semibold">{t('ronos.stat_total_ronos')}</span>
                  <span className="text-lg font-bold text-slate-900 dark:text-white">{mappingStats.totalRonos}</span>
                </div>
                <div className="p-3 bg-emerald-50 dark:bg-slate-950 rounded-xl border border-emerald-200 dark:border-emerald-500/20 text-center">
                  <span className="text-[11px] text-emerald-700 dark:text-emerald-400 block font-semibold">{t('ronos.stat_auto_matched')}</span>
                  <span className="text-lg font-bold text-emerald-700 dark:text-emerald-400">{mappingStats.autoMatched}</span>
                </div>
                <div className="p-3 bg-blue-50 dark:bg-slate-950 rounded-xl border border-blue-200 dark:border-blue-500/20 text-center">
                  <span className="text-[11px] text-blue-700 dark:text-blue-400 block font-semibold">{t('ronos.stat_manually_matched')}</span>
                  <span className="text-lg font-bold text-blue-700 dark:text-blue-400">{mappingStats.manuallyMatched}</span>
                </div>
                <div className="p-3 bg-slate-100 dark:bg-slate-950 rounded-xl border border-slate-300 dark:border-slate-700 text-center">
                  <span className="text-[11px] text-slate-600 dark:text-slate-400 block font-semibold">{t('ronos.stat_inactives')}</span>
                  <span className="text-lg font-bold text-slate-700 dark:text-slate-300">{mappingStats.inactive}</span>
                </div>
                <div className="p-3 bg-amber-50 dark:bg-slate-950 rounded-xl border border-amber-200 dark:border-amber-500/20 text-center">
                  <span className="text-[11px] text-amber-700 dark:text-amber-400 block font-semibold">{t('ronos.stat_unmapped_count')}</span>
                  <span className="text-lg font-bold text-amber-700 dark:text-amber-400">{mappingStats.unmapped}</span>
                </div>
              </div>
            </div>

            {/* Filter Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-2xl bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="relative w-full sm:w-80">
                <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder={t('ronos.search_mapping_placeholder')}
                  value={mappingSearch}
                  onChange={(e) => setMappingSearch(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl pl-10 pr-4 py-2 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-amber-500 shadow-xs"
                />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
                <button
                  onClick={() => setMappingFilter('all')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    mappingFilter === 'all'
                      ? 'bg-slate-800 dark:bg-slate-700 text-white'
                      : 'bg-slate-100 dark:bg-slate-950 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800'
                  }`}
                >
                  {t('ronos.filter_all_label')} ({mappingsList.length})
                </button>
                <button
                  onClick={() => setMappingFilter('unmapped')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                    mappingFilter === 'unmapped'
                      ? 'bg-amber-600 text-white'
                      : 'bg-amber-50 dark:bg-slate-950 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20 hover:bg-amber-100 dark:hover:bg-amber-500/10'
                  }`}
                >
                  <AlertCircle className="w-3.5 h-3.5" />
                  {t('ronos.filter_unmapped_label')} ({mappingsList.filter(m => m.mappingType === 'unmapped').length})
                </button>
                <button
                  onClick={() => setMappingFilter('matched')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                    mappingFilter === 'matched'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-emerald-50 dark:bg-slate-950 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20 hover:bg-emerald-100 dark:hover:bg-emerald-500/10'
                  }`}
                >
                  <UserCheck className="w-3.5 h-3.5" />
                  {t('ronos.filter_matched_label')} ({mappingsList.filter(m => m.mappingType === 'auto' || m.mappingType === 'manual').length})
                </button>
                <button
                  onClick={() => setMappingFilter('inactive')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                    mappingFilter === 'inactive'
                      ? 'bg-slate-700 text-white'
                      : 'bg-slate-100 dark:bg-slate-950 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800 hover:bg-slate-200 dark:hover:bg-slate-800'
                  }`}
                >
                  <UserX className="w-3.5 h-3.5" />
                  {t('ronos.filter_inactives')} ({mappingsList.filter(m => m.mappingType === 'inactive').length})
                </button>

                {/* Botón de Escanear Traslados */}
                <button
                  onClick={handleRefreshTransfers}
                  disabled={refreshingTransfers || mappingLoading}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ml-auto ${
                    refreshingTransfers
                      ? 'bg-purple-600 text-white'
                      : 'bg-purple-50 dark:bg-slate-950 text-purple-700 dark:text-purple-400 border border-purple-200 dark:border-purple-500/20 hover:bg-purple-100 dark:hover:bg-purple-500/10'
                  }`}
                  title={lastTransferScan ? `Último escaneo: ${new Date(lastTransferScan).toLocaleTimeString('es-MX')}` : 'Escanear ponchadas en todas las tiendas'}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${refreshingTransfers ? 'animate-spin' : ''}`} />
                  {refreshingTransfers ? t('ronos.scanning_transfers') : t('ronos.btn_scan_transfers')}
                </button>
              </div>
            </div>

            {/* Mappings Table */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-100/90 dark:bg-slate-950/80 text-xs uppercase text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 font-bold tracking-wider">
                    <tr>
                      <th className="py-3.5 px-4">{t('ronos.col_ronos_employee')}</th>
                      <th className="py-3.5 px-4">{t('ronos.col_pin_job')}</th>
                      <th className="py-3.5 px-4 text-center">{t('ronos.col_mapping_status')}</th>
                      <th className="py-3.5 px-4">{t('ronos.col_toast_linked_emp')}</th>
                      <th className="py-3.5 px-4">{t('ronos.col_verified_email')}</th>
                      <th className="py-3.5 px-4 text-center">{t('ronos.col_action')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
                    {mappingLoading ? (
                      <tr>
                        <td colSpan={6} className="py-12 text-center text-slate-500">
                          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-amber-500" />
                          <span>Cargando lista de personal y candidatos de Toast...</span>
                        </td>
                      </tr>
                    ) : filteredMappings.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-12 text-center text-slate-500">
                          No se encontraron empleados que coincidan con los filtros.
                        </td>
                      </tr>
                    ) : (
                      filteredMappings.map(item => {
                        const isSaving = savingMappingId === item.ronosEmployeeUserId
                        const isInactive = item.mappingType === 'inactive'
                        const isMatched = (item.mappingType === 'auto' || item.mappingType === 'manual') && !!item.toastEmployeeId

                        return (
                          <tr key={item.ronosEmployeeUserId} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                            <td className="py-3 px-4">
                              <span className={`font-bold block ${isInactive ? 'text-slate-400 dark:text-slate-500 line-through' : 'text-slate-900 dark:text-white'}`}>
                                {item.ronosFullName}
                              </span>
                              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                <span className="text-xs text-slate-400 font-mono">User ID: {item.ronosEmployeeUserId}</span>
                                {item.transferredToStore && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 font-bold border border-purple-200 dark:border-purple-800/50 inline-flex items-center gap-1">
                                    🔀 Trasladado(a) a {item.transferredToStore}
                                  </span>
                                )}
                              </div>
                            </td>

                            <td className="py-3 px-4">
                              <span className="text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono block w-fit mb-1">
                                PIN: {item.ronosPin}
                              </span>
                              <span className="text-xs text-slate-500 block">{item.ronosJobTitle || 'Colaborador'}</span>
                            </td>

                            <td className="py-3 px-4 text-center">
                              {isInactive ? (
                                <span className="text-xs px-2.5 py-1 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 font-semibold inline-flex items-center gap-1">
                                  <UserX className="w-3 h-3 text-slate-500" />
                                  {t('ronos.status_inactive')}
                                </span>
                              ) : item.mappingType === 'auto' ? (
                                <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 font-semibold inline-flex items-center gap-1">
                                  <Sparkles className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                  {t('ronos.status_auto_matched')} ({item.confidenceScore}%)
                                </span>
                              ) : item.mappingType === 'manual' ? (
                                <span className="text-xs px-2.5 py-1 rounded-full bg-blue-100 dark:bg-blue-500/20 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-500/30 font-semibold inline-flex items-center gap-1">
                                  <Check className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                                  {t('ronos.status_manually_matched')}
                                </span>
                              ) : (
                                <span className="text-xs px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30 font-semibold inline-flex items-center gap-1">
                                  <AlertCircle className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                                  {t('ronos.status_unmapped')}
                                </span>
                              )}
                            </td>

                            <td className="py-3 px-4">
                              <select
                                value={isInactive ? '__INACTIVE__' : (item.toastEmployeeId || '')}
                                onChange={(e) => handleSaveSingleMapping(item, e.target.value)}
                                disabled={isSaving}
                                className={`w-full max-w-xs border rounded-xl px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:border-amber-500 shadow-xs ${
                                  isInactive
                                    ? 'bg-slate-100 dark:bg-slate-900/80 border-slate-300 dark:border-slate-700 text-slate-500 italic'
                                    : 'bg-slate-50 dark:bg-slate-950 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white'
                                }`}
                              >
                                <option value="">-- {t('ronos.select_toast_employee')} --</option>
                                <option value="__INACTIVE__" className="text-rose-600 dark:text-rose-400 font-bold bg-rose-50 dark:bg-slate-900">
                                  {item.transferredToStore
                                    ? `🚫 [Marcar como Inactivo (Trasladado a ${item.transferredToStore})]`
                                    : t('ronos.option_mark_inactive')}
                                </option>
                                {toastCandidates
                                  .filter(tc => {
                                    // 1. Mostrar siempre el candidato actualmente asignado a este colaborador
                                    if (item.toastEmployeeId === tc.id) return true
                                    // 2. Ocultar candidatos que YA estén asignados a OTRO colaborador en la lista
                                    const isClaimedByOther = mappingsList.some(
                                      other => other.ronosEmployeeUserId !== item.ronosEmployeeUserId && other.toastEmployeeId === tc.id
                                    )
                                    return !isClaimedByOther
                                  })
                                  .map(tc => (
                                    <option key={tc.id} value={tc.id}>
                                      {tc.full_name} ({tc.job_title}) {tc.email ? `• ${tc.email}` : ''}
                                    </option>
                                  ))}
                              </select>
                            </td>

                            <td className="py-3 px-4">
                              {isInactive ? (
                                <span className="text-xs text-slate-400 italic font-medium">{t('ronos.no_email_inactive')}</span>
                              ) : item.toastEmail ? (
                                <span className="text-xs font-mono text-blue-600 dark:text-blue-400 font-semibold block">
                                  {item.toastEmail}
                                </span>
                              ) : (
                                <span className="text-xs text-slate-400 italic">Sin correo registrado</span>
                              )}
                            </td>

                            <td className="py-3 px-4">
                              {isSaving ? (
                                <RefreshCw className="w-4 h-4 animate-spin text-amber-500 mx-auto" />
                              ) : isInactive ? (
                                <button
                                  onClick={() => handleSaveSingleMapping(item, '')}
                                  className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold transition-colors cursor-pointer"
                                >
                                  {t('ronos.btn_reactivate')}
                                </button>
                              ) : isMatched ? (
                                <button
                                  onClick={() => handleSaveSingleMapping(item, '')}
                                  className="text-[11px] px-2 py-1 rounded bg-slate-100 hover:bg-rose-100 dark:bg-slate-800 dark:hover:bg-rose-950/40 text-slate-600 hover:text-rose-700 dark:text-slate-400 dark:hover:text-rose-300 transition-colors cursor-pointer"
                                >
                                  {t('ronos.btn_unlink')}
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleSaveSingleMapping(item, '__INACTIVE__')}
                                  className="text-[11px] px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-slate-800 dark:hover:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-500/20 font-semibold transition-colors cursor-pointer inline-flex items-center gap-1"
                                >
                                  <UserX className="w-3 h-3" />
                                  {item.transferredToStore ? `${t('ronos.transferred_to_badge')} ${item.transferredToStore}` : t('ronos.btn_mark_inactive')}
                                </button>
                              )}
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

        {/* ═══════════════════════════════════════════════════════════════════════════ */}
        {/* TAB 4: FACTURACIÓN CINGULAR & NÓMINA (PEO MARKUP & RECONCILIATION)        */}
        {/* ═══════════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'payroll' && (
          <div className="space-y-6">
            {/* Header & Controls */}
            <div className="p-6 rounded-3xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 shadow-sm space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800/80 pb-5">
                <div>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <DollarSign className="w-5 h-5 text-emerald-500" />
                    {t('ronos.tab_payroll')}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    {t('ronos.payroll_subtitle')}
                  </p>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  {/* Selector Periodo Bisemanal vs Semanal */}
                  <div className="flex items-center bg-slate-100 dark:bg-slate-950 p-1 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-semibold">
                    <button
                      onClick={() => {
                        setPayrollBiWeekly(true)
                        const periodId = selectedBiWeeklyPeriod || (biWeeklyPeriods[0]?.id || '')
                        fetchPayroll(selectedCompanyId, periodId, true)
                      }}
                      className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                        payrollBiWeekly
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {t('ronos.period_biweekly')}
                    </button>
                    <button
                      onClick={() => {
                        setPayrollBiWeekly(false)
                        fetchPayroll(selectedCompanyId, selectedWeekId, false)
                      }}
                      className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                        !payrollBiWeekly
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {t('ronos.period_single_week')}
                    </button>
                  </div>

                  {/* Exportar CSV Cingular */}
                  <a
                    href={`/api/ronos/payroll?companyId=${selectedCompanyId}&weekIds=${payrollBiWeekly ? (selectedBiWeeklyPeriod || biWeeklyPeriods[0]?.id || '') : (selectedWeekId || '')}&biWeekly=${payrollBiWeekly}&format=csv`}
                    download
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition-all shadow-sm shadow-emerald-600/20 cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>{t('ronos.btn_export_cingular_csv')}</span>
                  </a>
                </div>
              </div>

              {/* 4 KPI Summary Cards */}
              {payrollLoading ? (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} className="p-5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-center animate-pulse">
                      <div className="h-3.5 bg-slate-200 dark:bg-slate-800 rounded w-28 mx-auto mb-3" />
                      <div className="h-7 bg-slate-300 dark:bg-slate-700 rounded w-36 mx-auto mb-2" />
                      <div className="h-2.5 bg-slate-200 dark:bg-slate-800 rounded w-44 mx-auto" />
                    </div>
                  ))}
                </div>
              ) : payrollData ? (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="p-4 rounded-2xl bg-emerald-50/70 dark:bg-slate-950 border border-emerald-200 dark:border-emerald-500/20 text-center">
                      <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-400 block mb-1">
                        {t('ronos.kpi_total_invoiced')}
                      </span>
                      <span className="text-2xl font-black text-emerald-700 dark:text-emerald-300">
                        ${payrollData.totalInvoicedAmount?.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-1">
                        Facturación Total Cingular HR
                      </span>
                    </div>

                    <div className="p-4 rounded-2xl bg-blue-50/70 dark:bg-slate-950 border border-blue-200 dark:border-blue-500/20 text-center">
                      <span className="text-xs font-semibold text-blue-800 dark:text-blue-400 block mb-1">
                        {t('ronos.kpi_gross_pay')}
                      </span>
                      <span className="text-2xl font-black text-blue-700 dark:text-blue-300">
                        ${payrollData.totalGrossPay?.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-1">
                        {payrollData.salariedCount ?? 0} Asalariados • {payrollData.hourlyCount ?? 0} Por Hora
                      </span>
                    </div>

                    <div className="p-4 rounded-2xl bg-amber-50/70 dark:bg-slate-950 border border-amber-200 dark:border-amber-500/20 text-center">
                      <span className="text-xs font-semibold text-amber-800 dark:text-amber-400 block mb-1">
                        {t('ronos.kpi_cingular_fee')}
                      </span>
                      <span className="text-2xl font-black text-amber-700 dark:text-amber-300">
                        ${payrollData.totalCingularFee?.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-1">
                        Markup Efectivo: {payrollData.effectiveMarkupPercentage}%
                      </span>
                    </div>

                    <div className="p-4 rounded-2xl bg-purple-50/70 dark:bg-slate-950 border border-purple-200 dark:border-purple-500/20 text-center">
                      <span className="text-xs font-semibold text-purple-800 dark:text-purple-400 block mb-1">
                        {t('ronos.kpi_period_hours')}
                      </span>
                      <span className="text-2xl font-black text-purple-700 dark:text-purple-300">
                        {payrollData.totalHours} <span className="text-sm font-normal">hrs</span>
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-1">
                        Reg: {payrollData.totalRegularHours}h | Sal: {payrollData.totalSalaryHours}h | OT: {payrollData.totalOvertimeHours}h | Sick: {payrollData.totalSickHours}h | Vac: {payrollData.totalVacationHours}h
                      </span>
                    </div>
                  </div>

                  {/* Panel Ejecutivo de Auditoría y Conciliación PEO (Simplify HR vs Cingular Invoice) */}
                  <div className="rounded-2xl p-4 bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-amber-500/10 border border-emerald-500/30 dark:border-emerald-500/20 shadow-xs flex flex-col gap-3">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-emerald-500/20 pb-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
                        <div>
                          <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                            {t('ronos.audit_panel_title')}
                          </h4>
                          <p className="text-xs text-slate-600 dark:text-slate-400">
                            {t('ronos.audit_panel_subtitle')}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 font-bold text-xs">
                          {payrollData.reconciliationPercentage ?? 100}% {t('ronos.audit_reconciled_rate')}
                        </span>
                        {(payrollData.auditSavingsAmount || 0) > 0 && (
                          <span className="px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-800 dark:text-amber-300 font-bold text-xs">
                            +${payrollData.auditSavingsAmount.toFixed(2)} Ahorro Favorable (0% Markup)
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div className="bg-white/80 dark:bg-slate-900/80 p-2.5 rounded-xl border border-emerald-200/60 dark:border-emerald-900/40">
                        <span className="text-slate-500 block text-[11px]">Cuadres Exactos</span>
                        <span className="font-bold text-emerald-700 dark:text-emerald-400 text-sm">
                          {payrollData.exactMatchesCount ?? payrollData.employees?.length ?? 0} / {payrollData.employees?.length ?? 0} colab.
                        </span>
                      </div>
                      <div className="bg-white/80 dark:bg-slate-900/80 p-2.5 rounded-xl border border-amber-200/60 dark:border-amber-900/40">
                        <span className="text-slate-500 block text-[11px]">Observaciones PEO</span>
                        <span className="font-bold text-amber-700 dark:text-amber-400 text-sm">
                          {payrollData.auditAlertsCount ?? 0} caso(s)
                        </span>
                      </div>
                      <div className="bg-white/80 dark:bg-slate-900/80 p-2.5 rounded-xl border border-blue-200/60 dark:border-blue-900/40">
                        <span className="text-slate-500 block text-[11px]">Permisos Pagados (PTO)</span>
                        <span className="font-bold text-blue-700 dark:text-blue-400 text-sm">
                          {(payrollData.totalSickHours || 0) + (payrollData.totalVacationHours || 0)} hrs pagadas
                        </span>
                      </div>
                      <div className="bg-white/80 dark:bg-slate-900/80 p-2.5 rounded-xl border border-purple-200/60 dark:border-purple-900/40">
                        <span className="text-slate-500 block text-[11px]">Personal Asalariado</span>
                        <span className="font-bold text-purple-700 dark:text-purple-400 text-sm">
                          {payrollData.salariedCount ?? 0} GM (80h fijas)
                        </span>
                      </div>
                    </div>
                  </div>
                </>
              ) : null}
            </div>

            {/* Filter Bar & Audit Pills */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 p-4 rounded-2xl bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="relative w-full sm:w-80">
                <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Buscar colaborador por nombre o PIN..."
                  value={payrollSearch}
                  onChange={(e) => setPayrollSearch(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl pl-10 pr-4 py-2 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-amber-500 shadow-xs"
                />
              </div>

              {/* Status Filter Pills */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => setPayrollAuditFilter('all')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                    payrollAuditFilter === 'all'
                      ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-xs'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {t('ronos.filter_all_status')} ({payrollData?.employees?.length || 0})
                </button>
                <button
                  type="button"
                  onClick={() => setPayrollAuditFilter('exact')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                    payrollAuditFilter === 'exact'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/60'
                  }`}
                >
                  ✓ {t('ronos.filter_exact_status')} ({payrollData?.exactMatchesCount || payrollData?.employees?.length || 0})
                </button>
                {(payrollData?.auditAlertsCount || 0) > 0 && (
                  <button
                    type="button"
                    onClick={() => setPayrollAuditFilter('alerts')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                      payrollAuditFilter === 'alerts'
                        ? 'bg-amber-600 text-white shadow-xs'
                        : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/60'
                    }`}
                  >
                    💡 {t('ronos.filter_alerts_status')} ({payrollData?.auditAlertsCount})
                  </button>
                )}
                {payrollData?.employees?.some((e: any) => e.auditStatus === 'pto') && (
                  <button
                    type="button"
                    onClick={() => setPayrollAuditFilter('pto')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                      payrollAuditFilter === 'pto'
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/60'
                    }`}
                  >
                    ℹ️ Permisos PTO ({payrollData?.employees ? payrollData.employees.filter((e: any) => e.auditStatus === 'pto').length : 0})
                  </button>
                )}
              </div>
            </div>

            {/* Reconciliation Table */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-100/90 dark:bg-slate-950/80 text-xs uppercase text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 font-bold tracking-wider">
                    <tr>
                      <th className="py-3.5 px-4">Colaborador & Auditoría PEO</th>
                      <th className="py-3.5 px-4 text-center">{t('ronos.col_type')}</th>
                      <th className="py-3.5 px-4 text-right">{t('ronos.col_pay_rate')}</th>
                      <th className="py-3.5 px-4 text-right">{t('ronos.col_bill_rate')}</th>
                      <th className="py-3.5 px-4 text-right">{t('ronos.col_gross_pay')}</th>
                      <th className="py-3.5 px-4 text-right">{t('ronos.col_invoiced_bill')}</th>
                      <th className="py-3.5 px-4 text-right">{t('ronos.col_markup_fee')}</th>
                      <th className="py-3.5 px-4 text-center">{t('ronos.col_hours_breakdown')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
                    {payrollLoading ? (
                      <tr>
                        <td colSpan={8} className="py-12 text-center text-slate-500">
                          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-emerald-500" />
                          <span>Calculando conciliación de nómina y facturación Cingular HR...</span>
                        </td>
                      </tr>
                    ) : !payrollData?.employees || payrollData.employees.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-12 text-center text-slate-500">
                          No se encontraron registros de nómina para esta sucursal y periodo.
                        </td>
                      </tr>
                    ) : (
                      payrollData.employees
                        .filter((emp: any) => {
                          const q = payrollSearch.toLowerCase().trim()
                          const matchesQuery = !q || emp.fullName.toLowerCase().includes(q) || (emp.employeeId || '').includes(q)
                          if (!matchesQuery) return false

                          if (payrollAuditFilter === 'exact') return emp.auditStatus === 'exact'
                          if (payrollAuditFilter === 'alerts') return emp.auditStatus === 'saving' || emp.auditStatus === 'variance'
                          if (payrollAuditFilter === 'pto') return emp.auditStatus === 'pto'
                          return true
                        })
                        .map((emp: any) => (
                          <tr key={emp.employeeUserId} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                            <td className="py-3 px-4">
                              <span className="font-bold text-slate-900 dark:text-white block">
                                {emp.fullName}
                              </span>
                              <span className="text-xs text-slate-500 dark:text-slate-400">
                                ID: {emp.employeeId || emp.employeeUserId}
                              </span>

                              {/* Audit Badge & Note */}
                              {emp.auditStatus === 'saving' ? (
                                <div className="mt-1.5 flex flex-col gap-0.5">
                                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 dark:text-amber-300 bg-amber-100/90 dark:bg-amber-950/80 border border-amber-300 dark:border-amber-700/60 px-2 py-0.5 rounded-md w-fit">
                                    💡 {emp.auditBadgeText || t('ronos.audit_saving_badge')}
                                  </span>
                                  <span className="text-[11px] text-amber-700 dark:text-amber-400 font-medium">
                                    {emp.auditNote}
                                  </span>
                                </div>
                              ) : emp.auditStatus === 'variance' ? (
                                <div className="mt-1.5 flex flex-col gap-0.5">
                                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-800 dark:text-rose-300 bg-rose-100/90 dark:bg-rose-950/80 border border-rose-300 dark:border-rose-700/60 px-2 py-0.5 rounded-md w-fit">
                                    ⚠️ {emp.auditBadgeText || t('ronos.audit_variance_badge')}
                                  </span>
                                  <span className="text-[11px] text-rose-700 dark:text-rose-400 font-medium">
                                    {emp.auditNote}
                                  </span>
                                </div>
                              ) : emp.auditStatus === 'pto' ? (
                                <div className="mt-1.5 flex flex-col gap-0.5">
                                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-800 dark:text-blue-300 bg-blue-100/90 dark:bg-blue-950/80 border border-blue-300 dark:border-blue-700/60 px-2 py-0.5 rounded-md w-fit">
                                    ℹ️ {emp.auditBadgeText || t('ronos.audit_pto_badge')}
                                  </span>
                                  <span className="text-[11px] text-blue-700 dark:text-blue-400 font-medium">
                                    {emp.auditNote}
                                  </span>
                                </div>
                              ) : (
                                <div className="mt-1.5 flex flex-col gap-0.5">
                                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/40 px-2 py-0.5 rounded-md w-fit">
                                    ✓ {t('ronos.audit_exact_badge')}
                                  </span>
                                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                    {emp.auditNote}
                                  </span>
                                </div>
                              )}
                            </td>

                            <td className="py-3 px-4 text-center">
                              <span
                                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${
                                  emp.isSalaried
                                    ? 'bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-500/30'
                                    : 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-500/30'
                                }`}
                              >
                                {emp.isSalaried ? t('ronos.badge_exempt_salaried') : t('ronos.badge_non_exempt_hourly')}
                              </span>
                              <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5">
                                {emp.jobTitle}
                              </span>
                            </td>

                            <td className="py-3 px-4 text-right font-medium text-slate-700 dark:text-slate-300">
                              ${(emp.payRate ?? 0).toFixed(2)}/h
                            </td>

                            <td className="py-3 px-4 text-right font-semibold text-emerald-700 dark:text-emerald-400">
                              ${(emp.billRate ?? 0).toFixed(2)}/h
                            </td>

                            <td className="py-3 px-4 text-right font-bold text-slate-900 dark:text-white">
                              ${(emp.totalGrossPay ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </td>

                            <td className="py-3 px-4 text-right font-bold text-emerald-600 dark:text-emerald-400">
                              ${(emp.totalInvoicedAmount ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </td>

                            <td className="py-3 px-4 text-right text-xs font-medium text-amber-600 dark:text-amber-400">
                              +${(emp.cingularFeeAmount ?? 0).toFixed(2)} ({emp.markupPercentage ?? 25.98}%)
                            </td>

                            <td className="py-3 px-4 text-center">
                              <div className="flex items-center justify-center gap-1.5 flex-wrap text-xs">
                                {emp.salaryHours > 0 && (
                                  <span className="px-2 py-0.5 rounded bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300 font-medium">
                                    Sal: {emp.salaryHours}h
                                  </span>
                                )}
                                {emp.regularHours > 0 && (
                                  <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium">
                                    Reg: {emp.regularHours}h
                                  </span>
                                )}
                                {emp.overtimeHours > 0 && (
                                  <span className="px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 font-bold">
                                    OT: {emp.overtimeHours}h
                                  </span>
                                )}
                                {emp.mealPenaltyHours > 0 && (
                                  <span className="px-2 py-0.5 rounded bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-300 font-bold">
                                    Meal: {emp.mealPenaltyHours}h
                                  </span>
                                )}
                                {emp.sickHours > 0 && (
                                  <span className="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-bold">
                                    Sick: {emp.sickHours}h
                                  </span>
                                )}
                                {emp.vacationHours > 0 && (
                                  <span className="px-2 py-0.5 rounded bg-teal-50 dark:bg-teal-950 text-teal-700 dark:text-teal-300 font-bold">
                                    Vac: {emp.vacationHours}h
                                  </span>
                                )}
                              </div>
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
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL DE ENVÍO DE AVISO DE INCUMPLIMIENTO LABORAL POR CORREO */}
      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {emailModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative w-full max-w-xl rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-6 overflow-hidden max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4 mb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Mail className="w-5 h-5 text-rose-600 dark:text-rose-400" />
                  {t('ronos.modal_notify_title')}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {t('ronos.modal_notify_desc')}
                </p>
              </div>
              <button
                onClick={() => setEmailModal(prev => ({ ...prev, isOpen: false }))}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>

            {/* Success Banner */}
            {emailModal.sendSuccess ? (
              <div className="p-6 text-center rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-500/30 my-4">
                <CheckCircle2 className="w-12 h-12 text-emerald-600 dark:text-emerald-400 mx-auto mb-3" />
                <h4 className="text-base font-bold text-emerald-900 dark:text-emerald-200">
                  {t('ronos.warning_sent_success')}
                </h4>
                <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
                  Se envió copia al Gerente, Supervisor y a la Dirección de Tacos Gavilan.
                </p>
                <button
                  onClick={() => setEmailModal(prev => ({ ...prev, isOpen: false }))}
                  className="mt-5 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer"
                >
                  {t('ronos.btn_close')}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Error Banner */}
                {emailModal.sendError && (
                  <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>{emailModal.sendError}</span>
                  </div>
                )}

                {/* Recipient Box */}
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                    {t('ronos.notify_recipient')}:
                  </label>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="text-sm font-bold text-slate-900 dark:text-white block">{emailModal.employeeName}</span>
                      <span className="text-xs font-mono text-blue-600 dark:text-blue-400 font-semibold">{emailModal.employeeEmail || '⚠️ Sin correo de Toast vinculado'}</span>
                    </div>
                    {!emailModal.employeeEmail && (
                      <button
                        onClick={() => {
                          setEmailModal(prev => ({ ...prev, isOpen: false }))
                          setActiveTab('mapping')
                          setMappingSearch(emailModal.employeeName)
                        }}
                        className="text-xs px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold cursor-pointer"
                      >
                        Vincular Toast
                      </button>
                    )}
                  </div>
                </div>

                {/* Chain of Command CC Box */}
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs">
                  <label className="block font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                    {t('ronos.notify_cc')}:
                  </label>
                  <div className="space-y-1 text-slate-700 dark:text-slate-300">
                    <div>• <strong>Gerente:</strong> {emailModal.escalera?.managerName || 'Gerente de Sucursal'} ({emailModal.escalera?.managerEmail || 'carlos@tacosgavilan.com'})</div>
                    <div>• <strong>Supervisor:</strong> {emailModal.escalera?.supervisorName || 'Supervisión'} ({emailModal.escalera?.supervisorEmail || 'willian@tacosgavilan.com'})</div>
                    <div>• <strong>Directiva TEG:</strong> carlos@, raquel@, gonzalo@, roberto@tacosgavilan.com</div>
                  </div>
                </div>

                {/* Violation Details Box */}
                <div className="p-3.5 rounded-xl bg-rose-50/70 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-500/30 text-xs">
                  <span className="font-bold text-rose-800 dark:text-rose-300 block mb-1">
                    📌 {emailModal.violationTitle}
                  </span>
                  <p className="text-rose-700 dark:text-rose-300/90 font-medium">
                    {emailModal.violationDescription}
                  </p>
                  <div className="mt-2 text-slate-600 dark:text-slate-400 flex items-center gap-4">
                    <span>Fecha: <strong>{emailModal.violationDate?.substring(0, 10)}</strong></span>
                    {emailModal.totalHoursWorked && (
                      <span>Horas: <strong>{emailModal.totalHoursWorked.toFixed(2)}h</strong></span>
                    )}
                  </div>
                </div>

                {/* Automated Monitoring Notice */}
                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-500/30 text-xs text-amber-800 dark:text-amber-300">
                  ⚡ <strong>Monitoreo Automatizado:</strong> El correo enfatiza que el sistema de auditoría de Tacos Gavilan audita automáticamente en tiempo real todas las ponchadas del colaborador.
                </div>

                {/* Additional Note Input */}
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                    {t('ronos.notify_notes_label')}
                  </label>
                  <textarea
                    rows={2}
                    value={emailModal.additionalNotes}
                    onChange={(e) => setEmailModal(prev => ({ ...prev, additionalNotes: e.target.value }))}
                    placeholder={t('ronos.notify_notes_placeholder')}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl p-3 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-amber-500 shadow-xs"
                  />
                </div>

                {/* Modal Footer */}
                <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-slate-800">
                  <button
                    onClick={() => setEmailModal(prev => ({ ...prev, isOpen: false }))}
                    className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-400 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    {t('ronos.btn_close')}
                  </button>

                  <button
                    onClick={handleSendWarningEmail}
                    disabled={emailModal.isSending || !emailModal.employeeEmail}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-md shadow-rose-600/20 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                  >
                    {emailModal.isSending ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>{t('ronos.sending_warning')}</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5" />
                        <span>{t('ronos.btn_send_warning_now')}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL DE FOTOGRAFÍA AL PONCHAR (AWS S3) */}
      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {photoModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative w-full max-w-lg rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-6 overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4 mb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Camera className="w-5 h-5 text-amber-500" />
                  {t('ronos.modal_photo_title')}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {photoModal.employeeName} • {photoModal.title} ({photoModal.timestamp ? new Date(photoModal.timestamp).toLocaleString() : ''})
                </p>
              </div>
              <button
                onClick={() => setPhotoModal(prev => ({ ...prev, isOpen: false }))}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>

            {/* Photo Display Container */}
            <div className="relative bg-slate-100 dark:bg-slate-950 rounded-2xl p-4 flex items-center justify-center min-h-[320px] max-h-[480px] overflow-hidden border border-slate-200 dark:border-slate-800">
              <img
                src={photoModal.photoUrl}
                alt={`Ponchada de ${photoModal.employeeName}`}
                style={{ transform: `rotate(${photoModal.rotation}deg)` }}
                className="max-h-96 max-w-full rounded-xl object-contain shadow-lg transition-transform duration-300"
              />
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between mt-5 pt-4 border-t border-slate-200 dark:border-slate-800">
              <button
                onClick={handleRotate}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold cursor-pointer shadow-xs"
              >
                <RotateCw className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                {t('ronos.btn_rotate')}
              </button>

              <button
                onClick={() => setPhotoModal(prev => ({ ...prev, isOpen: false }))}
                className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold cursor-pointer shadow-xs"
              >
                {t('ronos.btn_close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
