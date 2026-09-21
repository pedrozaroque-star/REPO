/**
 * @module app/admin/ronos/page
 * @description Módulo Ejecutivo de Auditoría Laboral RONOS, Asistencia y Conciliación Cingular HR / Simplify HR.
 *   - Rediseño sobrio y limpio en 5 pestañas compactas:
 *     1. Resumen ('summary'): Requiere revisión, Todo en orden, Sin información suficiente.
 *     2. Asistencia ('attendance'): Reloj checador en tienda ("En vivo hoy" vs "Historial semanal"), 6 estados simples.
 *     3. Nómina ('payroll'): Conciliación Cingular HR al centavo, pagos confirmados, supervisores administrativos y recibos pendientes con texto reglamentario.
 *     4. Equipo ('team'): Colaboradores activos, traslados confirmados y cola de revisión manual 1 a 1 (Confirmar, Descartar, Cancelar).
 *     5. Administración ('admin'): Sincronización en vivo, salud de integraciones, diagnóstico de tiendas fallidas y caché.
 *   - Encabezado único y sobrio: "RONOS · [Tienda o cadena] · [Período exacto] · Actualizado [hora]".
 *
 * @businessRules
 *   - Acceso exclusivo para usuarios con rol 'admin' (Dirección General y Auditoría Ejecutiva).
 *   - Día laboral oficial: Inicia a las 6:00 AM y termina a las 5:59 AM del día siguiente.
 *   - Cubre el 100% de la empresa: 16 ubicaciones activas (15 restaurantes + La Bodega Central Vernon #28).
 *   - Facturación Cingular HR: Margen del 26.00% sobre nómina regular (BILL_RATE = PAY_RATE * 1.26).
 *
 * @dataFlow
 *   RONOS API v2.0 + Simplify HR OS Paystubs -> Supabase cache -> `/api/ronos/*` -> RonosLaborAuditPage.
 *
 * @notes
 *   - Rediseño v3.0 Mobile-First con controles táctiles >= 44px.
 *   - Preserva la coincidencia exacta al centavo de Hollywood TEGH-0009 ($46,064.13) y Downey TEGD-0008 ($53,442.71).
 *   - Al cambiar de tienda o período: NUNCA mostrar datos viejos bajo nuevo filtro; limpiar y mostrar "Actualizando".
 *   - Soporte bilingüe completo (i18n) sin textos hardcodeados.
 */

'use client'

import React, { useState, useEffect, useMemo, useRef } from 'react'
import ProtectedRoute from '@/components/ProtectedRoute'
import { useLanguage } from '@/lib/i18n'
import { AlertCircle } from 'lucide-react'

// Tipos compartidos y helpers
import {
  StoreOption,
  WorkWeekOption,
  BiWeeklyPeriod,
  StoreAuditData,
  ChainAuditData,
  PayrollReportData,
  MappedEmployeeItem,
  ToastCandidate,
  EmployeeTimecard,
  PhotoModalState,
  EmailModalState
} from '@/components/ronos/types'
import { computeCingularBiWeeklyPeriods, getPacificDateString } from '@/components/ronos/helpers'

// Componentes modulares de las 5 Pestañas
import RonosHeader, { RonosTabId } from '@/components/ronos/RonosHeader'
import RonosHomeTab from '@/components/ronos/RonosHomeTab'
import StoreAttendanceTab from '@/components/ronos/StoreAttendanceTab'
import PayrollReconciliationTab from '@/components/ronos/PayrollReconciliationTab'
import PeopleMappingTab from '@/components/ronos/PeopleMappingTab'
import RonosAdminTab from '@/components/ronos/RonosAdminTab'
import PhotoModal from '@/components/ronos/modals/PhotoModal'
import WarningEmailModal from '@/components/ronos/modals/WarningEmailModal'

function RonosLaborAuditContent() {
  const { t } = useLanguage()

  // 5 Pestañas Compactas: 'summary' | 'attendance' | 'payroll' | 'team' | 'admin' (Default: 'summary')
  const [activeTab, setActiveTab] = useState<RonosTabId>('summary')

  // Selección de tienda y semana (Default: 0 = Todas las Tiendas)
  const [selectedCompanyId, setSelectedCompanyId] = useState<number>(0)
  const [selectedWeekId, setSelectedWeekId] = useState<number | undefined>(undefined)

  // Catálogos principales
  const [stores, setStores] = useState<StoreOption[]>([])
  const [weeks, setWeeks] = useState<WorkWeekOption[]>([])
  const [storeData, setStoreData] = useState<StoreAuditData | null>(null)
  const [chainData, setChainData] = useState<ChainAuditData | null>(null)

  // Empleado seleccionado para vista detallada de ponchadas
  const [selectedEmployeeUserId, setSelectedEmployeeUserId] = useState<number | null>(null)
  const selectedEmployeeDetail = useMemo(() => {
    if (!selectedEmployeeUserId || !Array.isArray(storeData?.employees)) return null
    return storeData.employees.find(e => e.employeeUserId === selectedEmployeeUserId) || null
  }, [selectedEmployeeUserId, storeData])

  const setSelectedEmployeeDetail = (emp: EmployeeTimecard | null) => {
    setSelectedEmployeeUserId(emp?.employeeUserId ?? null)
  }

  // Nómina y Cingular HR States
  const [payrollData, setPayrollData] = useState<PayrollReportData | null>(null)
  const [payrollLoading, setPayrollLoading] = useState<boolean>(false)
  const [payrollError, setPayrollError] = useState<string | null>(null)
  const [payrollBiWeekly, setPayrollBiWeekly] = useState<boolean>(true)
  const [selectedBiWeeklyPeriod, setSelectedBiWeeklyPeriod] = useState<string>('')
  const [payrollInvoiceMode, setPayrollInvoiceMode] = useState<'consolidated' | 'regular' | 'supplemental'>('consolidated')

  // Mappings Toast POS States
  const [mappingsList, setMappingsList] = useState<MappedEmployeeItem[]>([])
  const [toastCandidates, setToastCandidates] = useState<ToastCandidate[]>([])
  const [mappingStats, setMappingStats] = useState({
    totalRonos: 0,
    autoMatched: 0,
    manuallyMatched: 0,
    inactive: 0,
    unmapped: 0
  })
  const [savingMappingId, setSavingMappingId] = useState<number | null>(null)
  const [refreshingTransfers, setRefreshingTransfers] = useState<boolean>(false)

  // Loading & Global States por Dominio (Hallazgo J)
  const [summaryLoading, setSummaryLoading] = useState<boolean>(true)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  const [attendanceLoading, setAttendanceLoading] = useState<boolean>(false)
  const [attendanceError, setAttendanceError] = useState<string | null>(null)

  const [teamLoading, setTeamLoading] = useState<boolean>(false)
  const [teamError, setTeamError] = useState<string | null>(null)

  const [isUpdating, setIsUpdating] = useState<boolean>(false)
  const [syncing, setSyncing] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSyncedTime, setLastSyncedTime] = useState<string | null>(null)

  // Estado derivado general para compatibilidad
  const loading = summaryLoading || attendanceLoading || teamLoading

  // Referencias para cancelación de peticiones obsoletas
  const storeRequestRef = useRef(0)
  const storeAbortRef = useRef<AbortController | null>(null)
  const chainAbortRef = useRef<AbortController | null>(null)
  const payrollRequestRef = useRef(0)
  const payrollAbortRef = useRef<AbortController | null>(null)
  const mappingsAbortRef = useRef<AbortController | null>(null)

  // Modal Foto Reloj Checador State
  const [photoModal, setPhotoModal] = useState<PhotoModalState>({
    isOpen: false,
    photoUrl: '',
    title: '',
    employeeName: '',
    timestamp: '',
    rotation: 0
  })

  // Modal Aviso Infracción State
  const [emailModal, setEmailModal] = useState<EmailModalState>({
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

  // Periodos bisemanales computados
  const biWeeklyPeriods = useMemo(() => computeCingularBiWeeklyPeriods(weeks), [weeks])

  // Periodo resuelto para nómina
  const resolvedPayrollPeriodId = useMemo(() => {
    if (payrollBiWeekly) {
      if (selectedBiWeeklyPeriod) return selectedBiWeeklyPeriod
      return biWeeklyPeriods[0]?.id || ''
    }
    return selectedWeekId || 0
  }, [payrollBiWeekly, selectedBiWeeklyPeriod, biWeeklyPeriods, selectedWeekId])

  // 1. MONTAJE INICIAL: Carga catálogos de tiendas y semanas
  useEffect(() => {
    let isMounted = true

    const initCatalog = async () => {
      setSummaryLoading(true)
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null
        const headers: Record<string, string> = {}
        if (token) headers['Authorization'] = `Bearer ${token}`

        const res = await fetch('/api/ronos/punches?companyId=34&_t=' + Date.now(), { headers })
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}))
          throw new Error(errBody?.error || `Error al cargar catálogo inicial (${res.status})`)
        }
        const json = await res.json()

        if (!isMounted) return

        if (json?.success) {
          if (Array.isArray(json.stores)) setStores(json.stores)
          if (Array.isArray(json.weeks) && json.weeks.length > 0) {
            setWeeks(json.weeks)
            const computedBiWeeks = computeCingularBiWeeklyPeriods(json.weeks)
            if (computedBiWeeks.length > 0) {
              const defaultPeriod = computedBiWeeks[0]
              setSelectedBiWeeklyPeriod(defaultPeriod.id)
              setSelectedWeekId(defaultPeriod.weekIds[1] || json.weeks[0]?.weekId)
            } else {
              setSelectedWeekId(json.weeks[0]?.weekId)
            }
          }
        } else {
          throw new Error(json?.error || 'Respuesta inválida del servidor RONOS')
        }
      } catch (err: any) {
        if (isMounted) {
          console.error('Init catalog error:', err)
          setError(err?.message || 'Error al conectar con el servidor RONOS')
        }
      } finally {
        if (isMounted) setSummaryLoading(false)
      }
    }

    initCatalog()
    return () => { isMounted = false }
  }, [])

  // 2. DISPARADOR AL CAMBIAR DE PESTAÑA O MODO DE FACTURA
  useEffect(() => {
    if (weeks.length === 0) return

    if (activeTab === 'summary') {
      fetchChainAudit(selectedWeekId)
      const periodId = payrollBiWeekly ? (selectedBiWeeklyPeriod || biWeeklyPeriods[0]?.id || '') : selectedWeekId
      if (periodId) {
        fetchPayroll(selectedCompanyId, periodId, payrollBiWeekly, payrollInvoiceMode)
      }
    } else if (activeTab === 'payroll') {
      const periodId = payrollBiWeekly ? (selectedBiWeeklyPeriod || biWeeklyPeriods[0]?.id || '') : selectedWeekId
      if (periodId) {
        fetchPayroll(selectedCompanyId, periodId, payrollBiWeekly, payrollInvoiceMode)
      }
    } else if (activeTab === 'attendance') {
      if (selectedCompanyId > 0) {
        fetchStoreAudit(selectedCompanyId, selectedWeekId)
      }
    } else if (activeTab === 'team') {
      fetchMappings(selectedCompanyId)
    } else if (activeTab === 'admin') {
      fetchChainAudit(selectedWeekId)
    }
  }, [
    activeTab,
    payrollInvoiceMode,
    selectedCompanyId,
    selectedWeekId,
    selectedBiWeeklyPeriod,
    payrollBiWeekly,
    weeks.length
  ])

  // 3. FETCH: AUDITORÍA DE TIENDA INDIVIDUAL
  const fetchStoreAudit = async (
    companyId: number,
    weekId?: number,
    force = false,
    targetStartDate?: string
  ) => {
    const requestId = ++storeRequestRef.current
    storeAbortRef.current?.abort()
    const abortCtrl = new AbortController()
    storeAbortRef.current = abortCtrl

    setAttendanceLoading(true)
    setAttendanceError(null)
    setError(null)

    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null
      const headers: Record<string, string> = {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
      if (token) headers['Authorization'] = `Bearer ${token}`

      let url = `/api/ronos/punches?companyId=${companyId}`
      if (weekId) url += `&weekId=${weekId}`
      if (targetStartDate) url += `&startDate=${targetStartDate}`
      if (force) url += `&force=true`
      url += `&_t=${Date.now()}`

      const res = await fetch(url, { signal: abortCtrl.signal, cache: 'no-store', headers })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody?.error || `Error de red con RONOS (${res.status})`)
      }
      const json = await res.json()
      if (requestId !== storeRequestRef.current) return

      if (!json?.success) throw new Error(json?.error || 'Error al obtener datos de RONOS')

      setStoreData(json.data)
      if (Array.isArray(json.weeks) && json.weeks.length > 0) {
        // Evitar recrear weeks si los IDs no cambiaron (Rompe ciclo infinito de re-render)
        setWeeks(prevWeeks => {
          const newIds = json.weeks.map((w: any) => w.weekId).join(',')
          const currentIds = prevWeeks.map(w => w.weekId).join(',')
          return newIds !== currentIds ? json.weeks : prevWeeks
        })

        let resolvedWeek = targetStartDate
          ? json.weeks.find((w: any) => w?.startDate?.substring(0, 10) === targetStartDate)
          : null
        if (!resolvedWeek && weekId) {
          resolvedWeek = json.weeks.find((w: any) => w?.weekId === weekId) || null
        }
        if (!resolvedWeek) {
          resolvedWeek = json.weeks.find((w: any) => new Date(w?.endDate || '').getTime() <= Date.now()) || json.weeks[0]
        }
        if (resolvedWeek && resolvedWeek.weekId !== selectedWeekId) {
          setSelectedWeekId(resolvedWeek.weekId)
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      if (requestId === storeRequestRef.current) {
        setAttendanceError(err?.message || 'Error al conectar con el checador')
        setError(err?.message || 'Error al conectar con el checador')
      }
    } finally {
      if (requestId === storeRequestRef.current) {
        setAttendanceLoading(false)
        setIsUpdating(false)
      }
    }
  }

  // 4. FETCH: AUDITORÍA DE TODA LA CADENA (16 Ubicaciones)
  const fetchChainAudit = async (weekId?: number) => {
    chainAbortRef.current?.abort()
    const abortCtrl = new AbortController()
    chainAbortRef.current = abortCtrl

    setSummaryLoading(true)
    setSummaryError(null)
    setError(null)

    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null
      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`

      // El Resumen solo necesita métricas agregadas. `mode=chain` evita descargar
      // todas las tarjetas y empleados de cada tienda, reservado para Asistencia/Equipo.
      let url = '/api/ronos/punches?mode=chain'
      if (weekId) url += `&weekId=${weekId}`
      url += `&_t=${Date.now()}`

      const res = await fetch(url, { signal: abortCtrl.signal, cache: 'no-store', headers })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody?.error || `Error al consultar cadena (${res.status})`)
      }
      const json = await res.json()
      if (json?.success) {
        setChainData(json.data)
        if (Array.isArray(json.stores)) setStores(json.stores)
      } else {
        throw new Error(json?.error || 'Error al obtener datos corporativos')
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      setSummaryError(err?.message || 'Error al cargar resumen corporativo')
      setError(err?.message || 'Error al cargar resumen corporativo')
    } finally {
      setSummaryLoading(false)
      setIsUpdating(false)
    }
  }

  // 5. FETCH: NÓMINA Y FACTURACIÓN CINGULAR HR
  const fetchPayroll = async (
    companyId: number,
    periodId: string | number,
    biWeekly: boolean,
    mode: 'consolidated' | 'regular' | 'supplemental'
  ) => {
    const requestId = ++payrollRequestRef.current
    payrollAbortRef.current?.abort()
    const abortCtrl = new AbortController()
    payrollAbortRef.current = abortCtrl
    let requestTimedOut = false
    const timeoutId = window.setTimeout(() => {
      requestTimedOut = true
      abortCtrl.abort()
    }, 60_000)

    setPayrollLoading(true)
    setPayrollError(null)

    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null
      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`

      const url = `/api/ronos/payroll?companyId=${companyId}&weekIds=${periodId}&biWeekly=${biWeekly}&mode=${mode}&_t=${Date.now()}`
      const res = await fetch(url, { signal: abortCtrl.signal, cache: 'no-store', headers })
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}))
        throw new Error(errJson?.error || `Error al calcular nómina (${res.status})`)
      }
      const json = await res.json()

      if (requestId !== payrollRequestRef.current) return
      if (!json?.success) throw new Error(json?.error || 'Error al calcular nómina')

      setPayrollData(json.data)
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        if (requestTimedOut && requestId === payrollRequestRef.current) {
          setPayrollError(t('ronos.payroll.request_timeout'))
        }
        return
      }
      if (requestId === payrollRequestRef.current) setPayrollError(err?.message || 'Error al cargar nómina')
    } finally {
      window.clearTimeout(timeoutId)
      if (requestId === payrollRequestRef.current) {
        setPayrollLoading(false)
        setIsUpdating(false)
      }
    }
  }

  // 6. FETCH: MAPPINGS TOAST POS ↔ RONOS
  const fetchMappings = async (companyId: number) => {
    mappingsAbortRef.current?.abort()
    const abortCtrl = new AbortController()
    mappingsAbortRef.current = abortCtrl

    setTeamLoading(true)
    setTeamError(null)
    setError(null)

    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null
      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch(`/api/ronos/mappings?companyId=${companyId}&_t=${Date.now()}`, {
        signal: abortCtrl.signal,
        cache: 'no-store',
        headers
      })
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}))
        throw new Error(errJson?.error || `Error al cargar directorio (${res.status})`)
      }
      const json = await res.json()
      if (json?.success) {
        setMappingsList(json.data?.mappings || [])
        setToastCandidates(json.data?.toastCandidates || [])
        setMappingStats(json.data?.stats || { totalRonos: 0, autoMatched: 0, manuallyMatched: 0, inactive: 0, unmapped: 0 })
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      setTeamError(err?.message || 'Error al cargar directorio de vinculaciones')
      setError(err?.message || 'Error al cargar directorio de vinculaciones')
    } finally {
      setTeamLoading(false)
      setIsUpdating(false)
    }
  }

  // 7. HANDLERS DE CAMBIO DE TIENDA Y SEMANA (REGLA: NUNCA MOSTRAR DATOS VIEJOS)
  const handleStoreChange = async (newCompanyId: number) => {
    setSelectedCompanyId(newCompanyId)
    setSelectedEmployeeDetail(null)

    // Limpieza inmediata de datos anteriores para evitar mostrar datos viejos
    setIsUpdating(true)
    setStoreData(null)
    setPayrollData(null)

    if (newCompanyId === 0) {
      if (activeTab === 'payroll' || activeTab === 'summary') {
        const periodId = payrollBiWeekly ? (selectedBiWeeklyPeriod || biWeeklyPeriods[0]?.id || '') : (selectedWeekId ?? '')
        fetchPayroll(0, periodId, payrollBiWeekly, payrollInvoiceMode)
        fetchChainAudit(selectedWeekId)
      } else if (activeTab === 'attendance') {
        setIsUpdating(false)
      } else if (activeTab === 'team') {
        fetchMappings(0)
      } else if (activeTab === 'admin') {
        fetchChainAudit(selectedWeekId)
      }
      return
    }

    const currentPeriod = biWeeklyPeriods.find(p => p.id === selectedBiWeeklyPeriod)
    const targetStartDate = currentPeriod?.startDate?.substring(0, 10) || weeks.find(w => w.weekId === selectedWeekId)?.startDate?.substring(0, 10)

    if (activeTab === 'payroll') {
      const periodId = payrollBiWeekly ? (selectedBiWeeklyPeriod || biWeeklyPeriods[0]?.id || '') : (selectedWeekId ?? '')
      fetchPayroll(newCompanyId, periodId, payrollBiWeekly, payrollInvoiceMode)
      await fetchStoreAudit(newCompanyId, undefined, false, targetStartDate)
    } else if (activeTab === 'attendance' || activeTab === 'summary') {
      await fetchStoreAudit(newCompanyId, undefined, false, targetStartDate)
      fetchChainAudit(selectedWeekId)
    } else if (activeTab === 'team') {
      await fetchMappings(newCompanyId)
    }
  }

  const handleWeekChange = (newWeekId: number) => {
    setSelectedWeekId(newWeekId)
    setSelectedEmployeeDetail(null)

    // Limpieza inmediata de datos anteriores
    setIsUpdating(true)
    setStoreData(null)
    setPayrollData(null)

    if (activeTab === 'summary') {
      fetchChainAudit(newWeekId)
      const periodId = payrollBiWeekly ? (selectedBiWeeklyPeriod || biWeeklyPeriods[0]?.id || '') : newWeekId
      if (periodId) {
        fetchPayroll(selectedCompanyId, periodId, payrollBiWeekly, payrollInvoiceMode)
      }
    } else if (activeTab === 'attendance') {
      if (selectedCompanyId > 0) fetchStoreAudit(selectedCompanyId, newWeekId)
      else setIsUpdating(false)
    } else if (activeTab === 'payroll' && !payrollBiWeekly) {
      fetchPayroll(selectedCompanyId, newWeekId, false, payrollInvoiceMode)
    } else {
      setIsUpdating(false)
    }
  }

  const handleBiWeeklyPeriodChange = (periodId: string) => {
    setSelectedBiWeeklyPeriod(periodId)

    // Limpieza inmediata de datos de nómina
    setIsUpdating(true)
    setPayrollData(null)

    if (activeTab === 'payroll' || activeTab === 'summary') {
      fetchPayroll(selectedCompanyId, periodId, true, payrollInvoiceMode)
    } else {
      setIsUpdating(false)
    }
  }

  const handlePayrollBiWeeklyToggle = (val: boolean) => {
    if (val === payrollBiWeekly) return
    setPayrollBiWeekly(val)
    setPayrollData(null)
    setIsUpdating(true)

    const targetPeriodId = val
      ? (selectedBiWeeklyPeriod || biWeeklyPeriods[0]?.id || '')
      : selectedWeekId
    if (targetPeriodId && (activeTab === 'payroll' || activeTab === 'summary')) {
      fetchPayroll(selectedCompanyId, targetPeriodId, val, payrollInvoiceMode)
    } else {
      setIsUpdating(false)
    }
  }

  // 8. ACCIÓN: SINCRONIZAR EN VIVO (LIVE SYNC)
  const handleSyncLive = async () => {
    setSyncing(true)
    setError(null)
    try {
      const isChain = selectedCompanyId === 0
      const token = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch('/api/ronos/sync', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          companyId: selectedCompanyId,
          syncChain: isChain,
          weekId: selectedWeekId,
          force: true
        })
      })
      const json = await res.json()
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || 'Error al sincronizar con el servidor RONOS')
      }

      setLastSyncedTime(new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }))

      if (activeTab === 'summary') {
        await fetchChainAudit(selectedWeekId)
        const periodId = payrollBiWeekly ? (selectedBiWeeklyPeriod || biWeeklyPeriods[0]?.id || '') : (selectedWeekId ?? '')
        fetchPayroll(selectedCompanyId, periodId, payrollBiWeekly, payrollInvoiceMode)
      } else if (activeTab === 'attendance') {
        if (selectedCompanyId > 0) await fetchStoreAudit(selectedCompanyId, selectedWeekId, true)
      } else if (activeTab === 'payroll') {
        const periodId = payrollBiWeekly ? (selectedBiWeeklyPeriod || biWeeklyPeriods[0]?.id || '') : (selectedWeekId ?? '')
        await fetchPayroll(selectedCompanyId, periodId, payrollBiWeekly, payrollInvoiceMode)
      } else if (activeTab === 'team') {
        await fetchMappings(selectedCompanyId)
      } else if (activeTab === 'admin') {
        await fetchChainAudit(selectedWeekId)
      }
    } catch (err: any) {
      setError(err?.message || 'Error al sincronizar datos en vivo')
    } finally {
      setSyncing(false)
    }
  }

  // 9. ACCIÓN: GUARDAR MAPEADO INDIVIDUAL
  const handleSaveSingleMapping = async (item: MappedEmployeeItem, toastId: string) => {
    setSavingMappingId(item.ronosEmployeeUserId)
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch('/api/ronos/mappings', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ronosEmployeeUserId: item.ronosEmployeeUserId,
          ronosCompanyId: item.ronosCompanyId,
          toastEmployeeId: toastId === 'UNLINK' ? null : toastId === 'INACTIVE' ? 'INACTIVE' : toastId,
          isManual: true
        })
      })
      const json = await res.json()
      if (json?.success) {
        fetchMappings(selectedCompanyId)
      } else {
        setError(json?.error || 'Error al guardar vinculación de personal')
      }
    } catch (err: any) {
      console.error(err)
      setError(err?.message || 'Error al guardar vinculación de personal')
    } finally {
      setSavingMappingId(null)
    }
  }

  // 10. ACCIÓN: REFRESCAR TRASLADOS MULTI-TIENDA
  const handleRefreshTransfers = async () => {
    setRefreshingTransfers(true)
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch('/api/ronos/refresh-transfers', {
        method: 'POST',
        headers,
        body: JSON.stringify({ weekId: selectedWeekId })
      })
      const json = await res.json()
      if (json?.success) {
        fetchMappings(selectedCompanyId)
      } else {
        setError(json?.error || 'Error al refrescar traslados')
      }
    } catch (err: any) {
      console.error(err)
      setError(err?.message || 'Error al refrescar traslados')
    } finally {
      setRefreshingTransfers(false)
    }
  }

  // 11. MODAL FOTOS: ABRIR Y ROTAR
  const handleOpenPhoto = (photoUrl: string, title: string, employeeName: string, timestamp: string) => {
    setPhotoModal({
      isOpen: true,
      photoUrl,
      title,
      employeeName,
      timestamp,
      rotation: 0
    })
  }

  const handleRotatePhoto = () => {
    setPhotoModal(prev => ({
      ...prev,
      rotation: (prev.rotation + 90) % 360
    }))
  }

  // 12. MODAL EMAIL: ABRIR Y ENVIAR AVISO
  const handleOpenEmailModal = (employee: EmployeeTimecard) => {
    const today = new Date()
    const dateStr = getPacificDateString(today)
    const storeInfo = stores.find(s => s.ronosCompanyId === selectedCompanyId)

    setEmailModal({
      isOpen: true,
      employeeUserId: employee.employeeUserId,
      employeeName: employee.fullName,
      employeeEmail: employee.toastEmail || '',
      employeePin: employee.pin || '',
      employeeJobTitle: employee.jobTitle || 'Team Member',
      violationDate: dateStr,
      violationType: 'MEAL_PENALTY',
      violationTitle: 'Aviso de Incidencia - Omisión de Descanso de Comida (30 min)',
      violationDescription: 'Se detectó que el turno excedió las 5.0 horas sin registrar su descanso de 30 minutos conforme al Código Laboral de California § 512.',
      additionalNotes: '',
      warningStage: 'first',
      storeName: storeInfo?.tegName || 'Lynwood',
      ronosCompanyId: selectedCompanyId,
      escalera: null,
      isSending: false,
      sendSuccess: false,
      sendError: null
    })
  }

  const handleSendWarningEmail = async () => {
    setEmailModal(prev => ({ ...prev, isSending: true, sendError: null }))
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch('/api/ronos/notify-violation', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          employeeUserId: emailModal.employeeUserId,
          employeeEmail: emailModal.employeeEmail,
          employeeName: emailModal.employeeName,
          employeePin: emailModal.employeePin,
          employeeJobTitle: emailModal.employeeJobTitle,
          violationDate: emailModal.violationDate,
          violationType: emailModal.violationType,
          violationTitle: emailModal.violationTitle,
          violationDescription: emailModal.violationDescription,
          additionalNotes: emailModal.additionalNotes,
          warningStage: emailModal.warningStage,
          clockInTime: emailModal.clockInTime,
          lunchStartTime: emailModal.lunchStartTime,
          lunchEndTime: emailModal.lunchEndTime,
          clockOutTime: emailModal.clockOutTime,
          totalHoursWorked: emailModal.totalHoursWorked,
          ronosCompanyId: emailModal.ronosCompanyId,
          escalera: emailModal.escalera
        })
      })

      const json = await res.json()
      if (json?.success) {
        setEmailModal(prev => ({ ...prev, isSending: false, sendSuccess: true }))
        setTimeout(() => {
          setEmailModal(prev => ({ ...prev, isOpen: false, sendSuccess: false }))
        }, 1800)
      } else {
        throw new Error(json?.error || 'Error al enviar aviso por correo')
      }
    } catch (err: any) {
      console.error(err)
      setEmailModal(prev => ({ ...prev, isSending: false, sendError: err?.message || 'Error al enviar aviso' }))
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-3 sm:p-5 lg:p-6 space-y-4">
      <main className="max-w-7xl mx-auto space-y-4">
        {/* Banner de error global */}
        {error && (
          <div
            role="alert"
            className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs font-semibold flex items-center justify-between gap-3 shadow-xs"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label="Cerrar alerta"
              className="text-rose-500 hover:text-rose-700 font-bold cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              ✕
            </button>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════ */}
        {/* ENCABEZADO ÚNICO Y 5 PESTAÑAS COMPACTAS                                 */}
        {/* ═══════════════════════════════════════════════════════════════════════ */}
        <RonosHeader
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          stores={stores}
          weeks={weeks}
          biWeeklyPeriods={biWeeklyPeriods}
          selectedCompanyId={selectedCompanyId}
          selectedWeekId={selectedWeekId}
          selectedBiWeeklyPeriod={selectedBiWeeklyPeriod}
          payrollBiWeekly={payrollBiWeekly}
          setPayrollBiWeekly={handlePayrollBiWeeklyToggle}
          onStoreChange={handleStoreChange}
          onWeekChange={handleWeekChange}
          onBiWeeklyPeriodChange={handleBiWeeklyPeriodChange}
          onSyncLive={handleSyncLive}
          syncing={syncing}
          lastSyncedTime={lastSyncedTime}
          isUpdating={isUpdating}
        />

        {/* ═══════════════════════════════════════════════════════════════════════ */}
        {/* CONTENIDO DE LA PESTAÑA ACTIVA (5 SECCIONES COMPACTAS)                  */}
        {/* ═══════════════════════════════════════════════════════════════════════ */}

        {/* PESTAÑA 1: RESUMEN (Requiere revisión, Todo en orden, Sin información) */}
        {activeTab === 'summary' && (
          <RonosHomeTab
            chainData={chainData}
            payrollData={payrollData}
            storeData={storeData}
            selectedCompanyId={selectedCompanyId}
            stores={stores}
            loading={summaryLoading && !storeData && !chainData}
            onNavigateToTab={(tab) => {
              setActiveTab(tab)
              if (tab === 'payroll') {
                const periodId = payrollBiWeekly ? (selectedBiWeeklyPeriod || biWeeklyPeriods[0]?.id || '') : (selectedWeekId ?? '')
                fetchPayroll(selectedCompanyId, periodId, payrollBiWeekly, payrollInvoiceMode)
              } else if (tab === 'attendance') {
                if (selectedCompanyId > 0) fetchStoreAudit(selectedCompanyId, selectedWeekId)
              } else if (tab === 'team') {
                fetchMappings(selectedCompanyId)
              }
            }}
            onSelectStore={(companyId) => {
              handleStoreChange(companyId)
            }}
          />
        )}

        {/* PESTAÑA 2: ASISTENCIA (RELOJ CHECADOR EN TIENDA) */}
        {activeTab === 'attendance' && (
          <StoreAttendanceTab
            storeData={storeData}
            loading={attendanceLoading && !storeData}
            selectedCompanyId={selectedCompanyId}
            stores={stores}
            selectedEmployeeDetail={selectedEmployeeDetail}
            onSelectEmployee={setSelectedEmployeeDetail}
            onOpenPhoto={handleOpenPhoto}
            onOpenEmail={handleOpenEmailModal}
            onSelectStore={(companyId) => {
              handleStoreChange(companyId)
            }}
          />
        )}

        {/* PESTAÑA 3: NÓMINA (CINGULAR HR & CONCILIACIÓN PEO) */}
        {activeTab === 'payroll' && (
          <PayrollReconciliationTab
            payrollData={payrollData}
            payrollLoading={payrollLoading}
            payrollError={payrollError}
            payrollInvoiceMode={payrollInvoiceMode}
            setPayrollInvoiceMode={setPayrollInvoiceMode}
            selectedCompanyId={selectedCompanyId}
            resolvedPayrollPeriodId={resolvedPayrollPeriodId}
            payrollBiWeekly={payrollBiWeekly}
            onRefresh={() => fetchPayroll(selectedCompanyId, resolvedPayrollPeriodId, payrollBiWeekly, payrollInvoiceMode)}
          />
        )}

        {/* PESTAÑA 4: EQUIPO (DIRECTORIO, TRASLADOS Y COLA 1 A 1) */}
        {activeTab === 'team' && (
          <PeopleMappingTab
            mappingsList={mappingsList}
            toastCandidates={toastCandidates}
            mappingStats={mappingStats}
            loading={teamLoading}
            savingMappingId={savingMappingId}
            refreshingTransfers={refreshingTransfers}
            onSaveSingleMapping={handleSaveSingleMapping}
            onRefreshTransfers={handleRefreshTransfers}
          />
        )}

        {/* PESTAÑA 5: ADMINISTRACIÓN (SINCRONIZACIÓN Y SALUD) */}
        {activeTab === 'admin' && (
          <RonosAdminTab
            chainData={chainData}
            stores={stores}
            selectedCompanyId={selectedCompanyId}
            syncing={syncing}
            lastSyncedTime={lastSyncedTime}
            onSyncLive={handleSyncLive}
          />
        )}
      </main>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* MODALES ACCESIBLES COMPARTIDOS                                          */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <PhotoModal
        modalState={photoModal}
        onClose={() => setPhotoModal(prev => ({ ...prev, isOpen: false }))}
        onRotate={handleRotatePhoto}
      />

      <WarningEmailModal
        modalState={emailModal}
        onChangeState={setEmailModal}
        onClose={() => setEmailModal(prev => ({ ...prev, isOpen: false }))}
        onSend={handleSendWarningEmail}
      />
    </div>
  )
}

export default function RonosLaborAuditPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <RonosLaborAuditContent />
    </ProtectedRoute>
  )
}
