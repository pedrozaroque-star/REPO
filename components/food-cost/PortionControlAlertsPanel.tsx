'use client'

/**
 * @module components/food-cost/PortionControlAlertsPanel
 * @description Panel bilingüe (ES/EN) de Control de Porciones, Política Disciplinaria Obligatoria ("Sí o Sí"),
 *   SLA Fatal Gerencial de 24 Horas, Calibración en Báscula + Strikes Progresivos (1-2-3 Expulsión) y Corte de Turno 5:00 PM.
 *
 * @businessRules
 *   - 100% bilingüe (`ES` / `EN`) mediante `useLanguage()` (`lib/i18n.tsx`) usando claves `portion_alerts.*` y `common.*`.
 *   - **Política Progresiva No Negociable (180 días)**:
 *     * Strike 1: Amonestación Escrita + Calibración en Báscula (`1.5 oz` taco / `6.0 oz` burrito).
 *     * Strike 2: Acta Administrativa Final + Suspensión sin Goce (escala a Supervisor + Directiva).
 *     * Strike 3+: Expulsión / Baja Definitiva Obligatoria por Reincidencia (`pending_mandatory_expulsion` -> `expulsion_confirmed`).
 *   - **Bloqueos Estrictos**: Ninguna alerta puede validarse ni cerrarse sin `disciplinary_action_id` (pesaje real de 5 tacos y 3 burritos,
 *     casilla de calibración presencial en báscula, responsable en turno y compromiso >= 10 caracteres).
 *   - Solo Supervisores Regionales o Administradores (`isSupervisorOrAdmin`) pueden validar/cerrar alertas o confirmar bajas ejecutadas.
 *
 * @dataFlow
 *   Props `{ storeId, startDate, endDate }` → `GET / POST / PATCH /api/food-cost/portion-alerts` → UI reactiva.
 *
 * @notes
 *   - 100% libre de imports de servidor (`nodemailer` / `supabaseAdmin`) para mantener limpio el bundle cliente de Next.js.
 *   - Protegido contra divisiones por cero (`0/0`) y valores nulos en `am_staff` / `pm_staff`.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Flame,
  Gavel,
  Mail,
  RefreshCw,
  Scale,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  Users,
  X,
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { formatSignedUSD, getBusinessDateLA } from '@/lib/inventory/food-cost-sales-resolver'

export interface PortionControlAlertsPanelProps {
  storeId?: string
  startDate?: string
  endDate?: string
}

interface StaffItem {
  name: string
  role: string
  category?: 'grill' | 'leader'
  hours?: number
  shiftsWorked?: number
  station?: string
  toastGuid?: string
  userId?: number
  email?: string
}

interface PortionAlertRow {
  id: string
  store_id: number
  store_name: string
  period_start: string
  period_end: string
  span_days: number
  meat_key: string
  meat_name: string
  theoretical_lbs: number
  actual_lbs: number
  variance_lbs: number
  variance_bags: number
  variance_pct: number
  excess_oz_per_taco: number
  dollar_loss_store: number
  dollar_loss_bodega: number
  dominant_shift: 'AM' | 'PM' | 'BOTH'
  am_theo_lbs: number
  pm_theo_lbs: number
  am_actual_lbs: number | null
  pm_actual_lbs: number | null
  am_staff: StaffItem[]
  pm_staff: StaffItem[]
  manager_email: string | null
  assistant_emails: string[]
  supervisor_email: string | null
  escalated_to_execs: boolean
  severity: 'warning' | 'critical'
  status: 'open' | 'acknowledged' | 'coached' | 'verified' | 'resolved'
  email_sent_at: string | null
  acknowledged_by: string | null
  acknowledged_at: string | null
  coaching_shift: string | null
  coaching_staff_names: string | null
  corrective_action_notes: string | null
  supervisor_verified_by: string | null
  supervisor_verified_at: string | null
  resolved_at: string | null
  due_at?: string | null
  is_overdue?: boolean
  overdue_escalated_at?: string | null
  disciplinary_action_id?: string | null
  created_at?: string | null
}

interface HandoverRow {
  id: string
  store_id: number
  business_date: string
  meat_key: string
  sealed_bags: number
  open_cooked_lbs: number
  counted_by_name: string
  notes: string | null
  created_at: string
}

type DisciplinaryEmployeeRole = 'Taquero' | 'Cook' | 'Prep' | 'Shift Leader' | 'Asistente' | 'Manager'
type DisciplinaryStage = 'strike_1_warning' | 'strike_2_final_suspension' | 'strike_3_expulsion'
type ExpulsionStatus =
  | 'not_applicable'
  | 'pending_mandatory_expulsion'
  | 'expulsion_confirmed'
  | 'appealed_by_director'

interface DisciplinaryActionRow {
  id: string
  alert_id: string | null
  store_id: number
  store_name: string
  employee_key: string
  employee_name: string
  employee_role: DisciplinaryEmployeeRole
  employee_email: string | null
  shift: 'AM' | 'PM' | 'BOTH'
  meat_key: string
  meat_name: string
  offense_number: number
  disciplinary_stage: DisciplinaryStage
  excess_bags: number
  dollar_loss_store: number
  scale_audit_completed: boolean
  sampled_tacos_avg_oz: number
  sampled_burritos_avg_oz: number
  mandatory_commitment: string
  issued_by_name: string
  issued_by_email: string | null
  supervisor_verified_by: string | null
  supervisor_verified_at: string | null
  expulsion_status: ExpulsionStatus
  hr_exec_notified_at: string | null
  created_at: string
}

interface SummaryKpis {
  totalOpenAlerts: number
  criticalOpenAlerts: number
  escalatedExecAlerts: number
  overdueAlerts?: number
  pendingExpulsions?: number
  asadaExcessLbs: number
  asadaExcessBags: number
  asadaStoreLossUsd: number
  totalExcessLbs: number
  totalExcessBags: number
  totalStoreLossUsd: number
  totalBodegaLossUsd: number
}

interface CandidateStaffOption {
  optionKey: string
  name: string
  rawRole: string
  mappedRole: DisciplinaryEmployeeRole
  shift: 'AM' | 'PM'
  priorStrikes: number
  toastGuid?: string
  userId?: number
  email?: string
}

const ROLE_OPTIONS: ReadonlyArray<DisciplinaryEmployeeRole> = [
  'Taquero',
  'Cook',
  'Prep',
  'Shift Leader',
  'Asistente',
  'Manager',
]

const MEAT_BAG_LBS_MAP: Record<string, number> = {
  asada: 10,
  pastor: 5,
  pollo: 5,
  cabeza: 2.5,
  lengua: 2.5,
  chorizo: 0.5,
  carnitas: 0.375,
  buche: 0.375,
}

const CANONICAL_STORES: ReadonlyArray<{ id: number; name: string }> = [
  { id: 1, name: '#1 Rialto' },
  { id: 3, name: '#3 West Covina' },
  { id: 4, name: '#4 Azusa' },
  { id: 5, name: '#5 LA Broadway' },
  { id: 6, name: '#6 LA Central' },
  { id: 7, name: '#7 Slauson' },
  { id: 8, name: '#8 Hollywood' },
  { id: 9, name: '#9 Santa Ana' },
  { id: 10, name: '#10 La Puente' },
  { id: 11, name: '#11 Huntington Park' },
  { id: 12, name: '#12 Norwalk' },
  { id: 13, name: '#13 Bell' },
  { id: 14, name: '#14 Lynwood' },
  { id: 15, name: '#15 South Gate' },
  { id: 16, name: '#16 Downey' },
]

const MEAT_OPTIONS: ReadonlyArray<{ key: string; es: string; en: string }> = [
  { key: 'asada', es: 'Carne Asada (Bolsa 10 lb)', en: 'Carne Asada (10 lb Bag)' },
  { key: 'pastor', es: 'Pastor (Bolsa 5 lb)', en: 'Pastor (5 lb Bag)' },
  { key: 'pollo', es: 'Pollo (Bolsa 5 lb)', en: 'Chicken / Pollo (5 lb Bag)' },
  { key: 'cabeza', es: 'Cabeza (Bolsa 2.5 lb)', en: 'Cabeza (2.5 lb Bag)' },
  { key: 'lengua', es: 'Lengua (Bolsa 2.5 lb)', en: 'Lengua (2.5 lb Bag)' },
  { key: 'chorizo', es: 'Chorizo (Paquete 8 oz)', en: 'Chorizo (8 oz Pouch)' },
  { key: 'carnitas', es: 'Carnitas (Paquete 6 oz)', en: 'Carnitas (6 oz Pouch)' },
  { key: 'buche', es: 'Buche (Paquete 6 oz)', en: 'Buche (6 oz Pouch)' },
]

function normalizeClientPersonName(rawName: string): string {
  return String(rawName || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildClientNameKey(storeId: number, rawName: string): string {
  const clean = normalizeClientPersonName(rawName) || 'unknown'
  return `name:${Number(storeId)}:${clean}`
}

function mapClientStaffRole(rawRole?: string | null): DisciplinaryEmployeeRole {
  const lower = String(rawRole || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  if (/\b(taquero|parrillero|carnes|tacos|trompero)\b/.test(lower) || lower.includes('carnes_')) {
    return 'Taquero'
  }
  if (/\b(asistente|assistant|asst)\b/.test(lower)) {
    return 'Asistente'
  }
  if (/\b(shift\s*leader|shift_leader|shiftleader|encargado|lider)\b/.test(lower)) {
    return 'Shift Leader'
  }
  if (/\b(manager|gerente|general_manager)\b/.test(lower)) {
    return 'Manager'
  }
  if (/\b(prep|preparador|preparacion)\b/.test(lower)) {
    return 'Prep'
  }
  return 'Cook'
}

function buildAuthHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem('teg_token')
    if (token && token !== 'null' && token !== 'undefined') {
      headers.Authorization = `Bearer ${token}`
    }
  }
  return headers
}

export default function PortionControlAlertsPanel({
  storeId,
  startDate,
  endDate,
}: PortionControlAlertsPanelProps) {
  const { language, t } = useLanguage()

  const [activeTab, setActiveTab] = useState<'alerts' | 'strikes'>('alerts')
  const [alerts, setAlerts] = useState<PortionAlertRow[]>([])
  const [handovers, setHandovers] = useState<HandoverRow[]>([])
  const [disciplinaryActions, setDisciplinaryActions] = useState<DisciplinaryActionRow[]>([])
  const [employeeStrikeCounts, setEmployeeStrikeCounts] = useState<Record<string, number>>({})
  const [overdueCount, setOverdueCount] = useState<number>(0)
  const [summary, setSummary] = useState<SummaryKpis>({
    totalOpenAlerts: 0,
    criticalOpenAlerts: 0,
    escalatedExecAlerts: 0,
    overdueAlerts: 0,
    pendingExpulsions: 0,
    asadaExcessLbs: 0,
    asadaExcessBags: 0,
    asadaStoreLossUsd: 0,
    totalExcessLbs: 0,
    totalExcessBags: 0,
    totalStoreLossUsd: 0,
    totalBodegaLossUsd: 0,
  })
  const [isSupervisorOrAdmin, setIsSupervisorOrAdmin] = useState(false)
  const [allowedStoreIds, setAllowedStoreIds] = useState<number[]>([])
  const [statusFilter, setStatusFilter] = useState<'active' | 'all' | 'resolved'>('active')
  const [strikeStageFilter, setStrikeStageFilter] = useState<'all' | DisciplinaryStage>('all')
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [busyAlertId, setBusyAlertId] = useState<string | null>(null)
  const [busyStrikeId, setBusyStrikeId] = useState<string | null>(null)
  const [bannerMsg, setBannerMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // Modal de Corrección Obligatoria en Báscula + Strike Progresivo
  const [coachingAlert, setCoachingAlert] = useState<PortionAlertRow | null>(null)
  const [selectedStaffOptionKey, setSelectedStaffOptionKey] = useState<string>('')
  const [manualEmployeeName, setManualEmployeeName] = useState<string>('')
  const [selectedEmployeeRole, setSelectedEmployeeRole] = useState<DisciplinaryEmployeeRole>('Taquero')
  const [coachingShift, setCoachingShift] = useState<'AM' | 'PM' | 'BOTH'>('PM')
  const [sampledTacosOz, setSampledTacosOz] = useState<string>('')
  const [sampledBurritosOz, setSampledBurritosOz] = useState<string>('')
  const [scaleAuditChecked, setScaleAuditChecked] = useState<boolean>(false)
  const [coachingNotes, setCoachingNotes] = useState<string>('')
  const [savingCoaching, setSavingCoaching] = useState<boolean>(false)

  // Modal de Corte de Turno 5:00 PM
  const [handoverOpen, setHandoverOpen] = useState(false)
  const [handoverStoreId, setHandoverStoreId] = useState<string>('')
  const [handoverDate, setHandoverDate] = useState<string>(() => getBusinessDateLA())
  const [handoverMeat, setHandoverMeat] = useState<string>('asada')
  const [handoverSealedBags, setHandoverSealedBags] = useState<string>('')
  const [handoverOpenLbs, setHandoverOpenLbs] = useState<string>('0')
  const [handoverNotes, setHandoverNotes] = useState<string>('')
  const [savingHandover, setSavingHandover] = useState(false)

  const lookupPriorStrikes = useCallback(
    (targetStoreId: number, name: string, toastGuid?: string, userId?: number): number => {
      let best = 0
      if (toastGuid) {
        best = Math.max(best, employeeStrikeCounts[`toast:${toastGuid.toLowerCase()}`] || 0)
      }
      if (userId && userId > 0) {
        best = Math.max(best, employeeStrikeCounts[`user:${userId}`] || 0)
      }
      const nk = buildClientNameKey(targetStoreId, name)
      best = Math.max(best, employeeStrikeCounts[nk] || 0)
      return best
    },
    [employeeStrikeCounts]
  )

  const fetchAlerts = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (storeId && storeId !== 'all') qs.set('store_id', storeId)
      if (startDate) qs.set('start_date', startDate)
      if (endDate) qs.set('end_date', endDate)
      qs.set('status', statusFilter)

      const res = await fetch(`/api/food-cost/portion-alerts?${qs.toString()}`, {
        method: 'GET',
        credentials: 'include',
        headers: buildAuthHeaders(),
        cache: 'no-store',
      })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json?.error || 'Error')
      }

      setAlerts(Array.isArray(json.alerts) ? json.alerts : [])
      setHandovers(Array.isArray(json.handovers) ? json.handovers : [])
      setDisciplinaryActions(Array.isArray(json.disciplinaryActions) ? json.disciplinaryActions : [])
      setEmployeeStrikeCounts(json.employeeStrikeCounts && typeof json.employeeStrikeCounts === 'object' ? json.employeeStrikeCounts : {})
      setOverdueCount(Number(json.overdueCount) || 0)
      if (json.summary) setSummary(json.summary)
      setIsSupervisorOrAdmin(Boolean(json.isSupervisorOrAdmin))
      const allowed = Array.isArray(json.allowedStoreIds) ? json.allowedStoreIds.map(Number) : []
      setAllowedStoreIds(allowed)

      setHandoverStoreId((prev) => {
        if (storeId && storeId !== 'all' && /^\d+$/.test(storeId)) return storeId
        if (prev) return prev
        if (allowed.length > 0) return String(allowed[0])
        return '14'
      })
    } catch (err: any) {
      setBannerMsg({ type: 'err', text: err?.message || 'Error' })
    } finally {
      setLoading(false)
    }
  }, [storeId, startDate, endDate, statusFilter])

  useEffect(() => {
    fetchAlerts()
  }, [fetchAlerts])

  const selectableStores = useMemo(() => {
    if (allowedStoreIds.length === 0) return CANONICAL_STORES
    return CANONICAL_STORES.filter((s) => allowedStoreIds.includes(s.id))
  }, [allowedStoreIds])

  const candidateStaffOptions = useMemo<CandidateStaffOption[]>(() => {
    if (!coachingAlert) return []
    const seen = new Set<string>()
    const list: CandidateStaffOption[] = []

    const appendFromShift = (staffArr: StaffItem[], shift: 'AM' | 'PM') => {
      for (const s of staffArr || []) {
        const cleanName = String(s.name || '').trim()
        if (!cleanName) continue
        const dedupKey = `${shift}|${normalizeClientPersonName(cleanName)}`
        if (seen.has(dedupKey)) continue
        seen.add(dedupKey)
        const mappedRole = mapClientStaffRole(s.role)
        const prior = lookupPriorStrikes(coachingAlert.store_id, cleanName, s.toastGuid, s.userId)
        list.push({
          optionKey: dedupKey,
          name: cleanName,
          rawRole: s.role || mappedRole,
          mappedRole,
          shift,
          priorStrikes: prior,
          toastGuid: s.toastGuid,
          userId: s.userId,
          email: s.email,
        })
      }
    }

    if (coachingAlert.dominant_shift === 'PM') {
      appendFromShift(coachingAlert.pm_staff || [], 'PM')
      appendFromShift(coachingAlert.am_staff || [], 'AM')
    } else {
      appendFromShift(coachingAlert.am_staff || [], 'AM')
      appendFromShift(coachingAlert.pm_staff || [], 'PM')
    }

    return list
  }, [coachingAlert, lookupPriorStrikes])

  const activeEmployeeName = useMemo(() => {
    if (selectedStaffOptionKey === '__manual__') {
      return manualEmployeeName.trim()
    }
    const found = candidateStaffOptions.find((o) => o.optionKey === selectedStaffOptionKey)
    return found ? found.name : ''
  }, [selectedStaffOptionKey, manualEmployeeName, candidateStaffOptions])

  const selectedPriorStrikes = useMemo(() => {
    if (!coachingAlert || !activeEmployeeName) return 0
    const found = candidateStaffOptions.find((o) => o.optionKey === selectedStaffOptionKey)
    if (found) return found.priorStrikes
    return lookupPriorStrikes(coachingAlert.store_id, activeEmployeeName)
  }, [coachingAlert, activeEmployeeName, candidateStaffOptions, selectedStaffOptionKey, lookupPriorStrikes])

  const pendingExpulsionsCount = useMemo(() => {
    return disciplinaryActions.filter((a) => a.expulsion_status === 'pending_mandatory_expulsion').length
  }, [disciplinaryActions])

  const filteredStrikes = useMemo(() => {
    if (strikeStageFilter === 'all') return disciplinaryActions
    return disciplinaryActions.filter((d) => d.disciplinary_stage === strikeStageFilter)
  }, [disciplinaryActions, strikeStageFilter])

  const handleScanNow = async () => {
    setScanning(true)
    setBannerMsg(null)
    try {
      const res = await fetch('/api/food-cost/portion-alerts', {
        method: 'POST',
        credentials: 'include',
        headers: buildAuthHeaders(),
        body: JSON.stringify({
          action: 'scan',
          store_id: storeId && storeId !== 'all' ? storeId : undefined,
          start_date: startDate || undefined,
          end_date: endDate || undefined,
          send_emails: false,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Scan failed')

      const count = Array.isArray(json.triggeredAlerts) ? json.triggeredAlerts.length : 0
      setBannerMsg({
        type: 'ok',
        text: t('portion_alerts.msg_scan_done', {
          start: json.periodStart || '',
          end: json.periodEnd || '',
          count,
        }),
      })
      await fetchAlerts()
    } catch (err: any) {
      setBannerMsg({ type: 'err', text: err?.message || 'Error' })
    } finally {
      setScanning(false)
    }
  }

  const handlePatchWorkflow = async (
    alertId: string,
    action: 'acknowledge' | 'supervisor_verify' | 'resolve'
  ) => {
    setBusyAlertId(alertId)
    setBannerMsg(null)
    try {
      const res = await fetch('/api/food-cost/portion-alerts', {
        method: 'PATCH',
        credentials: 'include',
        headers: buildAuthHeaders(),
        body: JSON.stringify({ id: alertId, action }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Action failed')

      setBannerMsg({
        type: 'ok',
        text: t('portion_alerts.msg_status_updated'),
      })
      await fetchAlerts()
    } catch (err: any) {
      setBannerMsg({ type: 'err', text: err?.message || 'Error' })
    } finally {
      setBusyAlertId(null)
    }
  }

  const handleConfirmExpulsion = async (disciplinaryActionId: string) => {
    setBusyStrikeId(disciplinaryActionId)
    setBannerMsg(null)
    try {
      const res = await fetch('/api/food-cost/portion-alerts', {
        method: 'PATCH',
        credentials: 'include',
        headers: buildAuthHeaders(),
        body: JSON.stringify({
          action: 'confirm_expulsion',
          disciplinary_action_id: disciplinaryActionId,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Confirmation failed')

      setBannerMsg({
        type: 'ok',
        text: t('portion_alerts.msg_expulsion_confirmed'),
      })
      await fetchAlerts()
    } catch (err: any) {
      setBannerMsg({ type: 'err', text: err?.message || 'Error' })
    } finally {
      setBusyStrikeId(null)
    }
  }

  const handleSendEscaleraEmail = async (alertId: string) => {
    setBusyAlertId(alertId)
    setBannerMsg(null)
    try {
      const res = await fetch('/api/food-cost/portion-alerts', {
        method: 'POST',
        credentials: 'include',
        headers: buildAuthHeaders(),
        body: JSON.stringify({ action: 'send_alert', alert_id: alertId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Email dispatch failed')

      setBannerMsg({
        type: 'ok',
        text: t('portion_alerts.msg_email_sent', {
          recipients: (json.dispatched?.to || []).join(', '),
        }),
      })
      await fetchAlerts()
    } catch (err: any) {
      setBannerMsg({ type: 'err', text: err?.message || 'Error' })
    } finally {
      setBusyAlertId(null)
    }
  }

  const openCoachingModal = (alert: PortionAlertRow) => {
    setCoachingAlert(alert)
    const defaultShift: 'AM' | 'PM' | 'BOTH' =
      (alert.coaching_shift as 'AM' | 'PM' | 'BOTH') ||
      (alert.dominant_shift === 'AM' || alert.dominant_shift === 'PM' ? alert.dominant_shift : 'PM')
    setCoachingShift(defaultShift)

    const primaryStaff = defaultShift === 'AM' ? alert.am_staff || [] : alert.pm_staff || []
    const secondaryStaff = defaultShift === 'AM' ? alert.pm_staff || [] : alert.am_staff || []
    const firstCandidate = primaryStaff[0] || secondaryStaff[0]

    if (firstCandidate && firstCandidate.name) {
      const shiftPrefix = primaryStaff[0] ? (defaultShift === 'AM' ? 'AM' : 'PM') : defaultShift === 'AM' ? 'PM' : 'AM'
      setSelectedStaffOptionKey(`${shiftPrefix}|${normalizeClientPersonName(firstCandidate.name)}`)
      setSelectedEmployeeRole(mapClientStaffRole(firstCandidate.role))
      setManualEmployeeName('')
    } else {
      setSelectedStaffOptionKey('__manual__')
      setSelectedEmployeeRole('Taquero')
      setManualEmployeeName('')
    }

    const estTacoOz = Math.max(1.5, 1.5 + (Number(alert.excess_oz_per_taco) || 0))
    const estBurritoOz = Math.max(6.0, 6.0 + (Number(alert.excess_oz_per_taco) || 0) * 4)
    setSampledTacosOz(estTacoOz > 1.5 ? estTacoOz.toFixed(2) : '')
    setSampledBurritosOz(estBurritoOz > 6.0 ? estBurritoOz.toFixed(2) : '')
    setScaleAuditChecked(false)
    setCoachingNotes('')
  }

  const handleSelectCandidateChange = (val: string) => {
    setSelectedStaffOptionKey(val)
    if (val === '__manual__') return
    const opt = candidateStaffOptions.find((o) => o.optionKey === val)
    if (opt) {
      setSelectedEmployeeRole(opt.mappedRole)
      setCoachingShift(opt.shift)
    }
  }

  const handleSaveCoaching = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!coachingAlert) return
    setSavingCoaching(true)
    setBannerMsg(null)

    const chosenOpt = candidateStaffOptions.find((o) => o.optionKey === selectedStaffOptionKey)
    try {
      const res = await fetch('/api/food-cost/portion-alerts', {
        method: 'PATCH',
        credentials: 'include',
        headers: buildAuthHeaders(),
        body: JSON.stringify({
          id: coachingAlert.id,
          action: 'log_coaching',
          employeeName: activeEmployeeName,
          employeeRole: selectedEmployeeRole,
          employeeToastGuid: chosenOpt?.toastGuid || null,
          employeeUserId: chosenOpt?.userId || null,
          employeeEmail: chosenOpt?.email || null,
          shift: coachingShift,
          scaleAuditCompleted: scaleAuditChecked,
          sampledTacosAvgOz: Number(sampledTacosOz),
          sampledBurritosAvgOz: Number(sampledBurritosOz),
          correctiveActionNotes: coachingNotes,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Error')

      setCoachingAlert(null)
      setBannerMsg({
        type: 'ok',
        text: t('portion_alerts.msg_strike_saved', {
          num: json.offenseNumber || selectedPriorStrikes + 1,
        }),
      })
      await fetchAlerts()
    } catch (err: any) {
      setBannerMsg({ type: 'err', text: err?.message || 'Error' })
    } finally {
      setSavingCoaching(false)
    }
  }

  const handleSaveHandover = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingHandover(true)
    setBannerMsg(null)
    try {
      const res = await fetch('/api/food-cost/portion-alerts', {
        method: 'POST',
        credentials: 'include',
        headers: buildAuthHeaders(),
        body: JSON.stringify({
          action: 'save_handover',
          store_id: Number(handoverStoreId),
          business_date: handoverDate,
          meat_key: handoverMeat,
          sealed_bags: Number(handoverSealedBags || 0),
          open_cooked_lbs: Number(handoverOpenLbs || 0),
          notes: handoverNotes,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Error')

      setHandoverSealedBags('')
      setHandoverOpenLbs('0')
      setHandoverNotes('')
      setHandoverOpen(false)
      setBannerMsg({
        type: 'ok',
        text: t('portion_alerts.msg_handover_saved'),
      })
      await fetchAlerts()
    } catch (err: any) {
      setBannerMsg({ type: 'err', text: err?.message || 'Error' })
    } finally {
      setSavingHandover(false)
    }
  }

  const getStepCompleted = (alert: PortionAlertRow, step: 1 | 2 | 3 | 4): boolean => {
    if (step === 1) return true
    if (step === 2) {
      return Boolean(alert.acknowledged_at) || ['acknowledged', 'coached', 'verified', 'resolved'].includes(alert.status)
    }
    if (step === 3) {
      return Boolean(alert.disciplinary_action_id) || ['coached', 'verified', 'resolved'].includes(alert.status)
    }
    return Boolean(alert.supervisor_verified_at) || ['verified', 'resolved'].includes(alert.status)
  }

  const renderSlaBadge = (alert: PortionAlertRow) => {
    const hasMandatoryCorrection =
      Boolean(alert.disciplinary_action_id) || ['coached', 'verified', 'resolved'].includes(alert.status)

    if (hasMandatoryCorrection) {
      return (
        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/30">
          {t('portion_alerts.sla_completed_badge')}
        </span>
      )
    }

    const dueMs = alert.due_at
      ? new Date(alert.due_at).getTime()
      : alert.created_at
        ? new Date(alert.created_at).getTime() + 24 * 3600_000
        : Date.now() + 24 * 3600_000
    const remMs = dueMs - Date.now()

    if (Boolean(alert.is_overdue) || remMs <= 0) {
      return (
        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-red-600 text-white animate-pulse shadow-sm">
          {t('portion_alerts.sla_overdue_badge')}
        </span>
      )
    }

    const hrs = Math.floor(remMs / 3600_000)
    const mins = Math.max(0, Math.floor((remMs % 3600_000) / 60_000))
    return (
      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200 border border-amber-300 dark:border-amber-500/30">
        {t('portion_alerts.sla_countdown_prefix')} {hrs}
        {t('portion_alerts.sla_hours_short')} {mins}
        {t('portion_alerts.sla_mins_short')}
      </span>
    )
  }

  const parsedTacosNum = Number(sampledTacosOz)
  const parsedBurritosNum = Number(sampledBurritosOz)
  const tacosDelta = Number.isFinite(parsedTacosNum) && parsedTacosNum > 0 ? parsedTacosNum - 1.5 : null
  const burritosDelta = Number.isFinite(parsedBurritosNum) && parsedBurritosNum > 0 ? parsedBurritosNum - 6.0 : null

  return (
    <section className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#14171f] shadow-sm overflow-hidden">
      {/* Encabezado Ejecutivo */}
      <div className="px-5 py-4 border-b border-gray-200 dark:border-white/10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 bg-gradient-to-r from-rose-50/70 via-white to-amber-50/40 dark:from-rose-950/20 dark:via-[#14171f] dark:to-amber-950/10">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-rose-600 text-white shadow-sm shrink-0">
            <Flame className="w-5 h-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base sm:text-lg font-extrabold text-gray-900 dark:text-white">
                {t('portion_alerts.title')}
              </h2>
              <span className="px-2 py-0.5 text-[11px] font-bold rounded-full bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300">
                {t('portion_alerts.benchmark_pill')}
              </span>
            </div>
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-0.5">
              {t('portion_alerts.subtitle')}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {activeTab === 'alerts' && (
            <div className="inline-flex rounded-lg border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 p-0.5 text-xs font-semibold">
              {(['active', 'all', 'resolved'] as const).map((tab) => {
                const active = statusFilter === tab
                const label =
                  tab === 'active'
                    ? t('portion_alerts.filter_active')
                    : tab === 'all'
                      ? t('portion_alerts.filter_all')
                      : t('portion_alerts.filter_resolved')
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setStatusFilter(tab)}
                    className={`px-2.5 py-1.5 rounded-md transition ${
                      active
                        ? 'bg-white dark:bg-white/15 text-gray-900 dark:text-white shadow-sm'
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          )}

          <button
            type="button"
            onClick={() => setHandoverOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition"
          >
            <Clock className="w-3.5 h-3.5" />
            {t('portion_alerts.btn_handover_5pm')}
          </button>

          <button
            type="button"
            onClick={handleScanNow}
            disabled={scanning}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-gray-900 hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-200 text-white dark:text-gray-900 shadow-sm transition disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
            {scanning ? t('portion_alerts.scanning') : t('portion_alerts.btn_scan_now')}
          </button>
        </div>
      </div>

      {/* Banner Prominente de Política Disciplinaria Obligatoria ("Sí o Sí") */}
      <div className="px-5 py-3 bg-rose-950 text-white border-b border-rose-800 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-2">
        <div className="flex items-start sm:items-center gap-2.5 text-xs">
          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5 sm:mt-0" />
          <div>
            <span className="font-black tracking-wide text-amber-300 mr-1.5">
              {t('portion_alerts.policy_banner_title')}
            </span>
            <span className="font-semibold text-rose-50">
              {t('portion_alerts.policy_banner_rules')}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {overdueCount > 0 && (
            <span className="px-2.5 py-1 rounded-full text-[11px] font-black bg-red-600 text-white animate-pulse">
              ⏰ {overdueCount} {t('portion_alerts.overdue_pill')}
            </span>
          )}
          {pendingExpulsionsCount > 0 && (
            <button
              type="button"
              onClick={() => {
                setActiveTab('strikes')
                setStrikeStageFilter('strike_3_expulsion')
              }}
              className="px-2.5 py-1 rounded-full text-[11px] font-black bg-amber-400 text-gray-950 hover:bg-amber-300 transition"
            >
              🚨 {pendingExpulsionsCount} {t('portion_alerts.pending_expulsions_pill')}
            </button>
          )}
        </div>
      </div>

      {/* Sub-pestañas: 1) Alertas y Escalera de Mando | 2) Registro de Strikes, Reincidencias y Expulsiones */}
      <div className="px-5 pt-2.5 bg-gray-50 dark:bg-black/30 border-b border-gray-200 dark:border-white/10 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setActiveTab('alerts')}
          className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-extrabold rounded-t-lg border-b-2 transition ${
            activeTab === 'alerts'
              ? 'border-rose-600 text-rose-700 dark:text-rose-400 bg-white dark:bg-[#14171f]'
              : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
          }`}
        >
          <Flame className="w-3.5 h-3.5" />
          <span>{t('portion_alerts.tab_alerts')}</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300">
            {alerts.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('strikes')}
          className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-extrabold rounded-t-lg border-b-2 transition ${
            activeTab === 'strikes'
              ? 'border-rose-600 text-rose-700 dark:text-rose-400 bg-white dark:bg-[#14171f]'
              : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
          }`}
        >
          <Gavel className="w-3.5 h-3.5" />
          <span>{t('portion_alerts.tab_strikes')}</span>
          <span
            className={`px-1.5 py-0.5 rounded-full text-[10px] font-black ${
              pendingExpulsionsCount > 0
                ? 'bg-red-600 text-white animate-pulse'
                : 'bg-gray-200 text-gray-800 dark:bg-white/15 dark:text-gray-200'
            }`}
          >
            {disciplinaryActions.length}
          </span>
        </button>
      </div>

      {/* Mensaje de confirmación / error */}
      {bannerMsg && (
        <div
          className={`px-5 py-2.5 text-xs font-semibold flex items-center justify-between border-b ${
            bannerMsg.type === 'ok'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20'
              : 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20'
          }`}
        >
          <span>{bannerMsg.text}</span>
          <button type="button" onClick={() => setBannerMsg(null)} className="p-1 opacity-70 hover:opacity-100">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Franja de KPIs Resumen */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 p-4 bg-gray-50/70 dark:bg-black/20 border-b border-gray-200 dark:border-white/10">
        <div className="rounded-xl p-3.5 bg-white dark:bg-white/[0.03] border border-rose-200 dark:border-rose-500/25">
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-rose-700 dark:text-rose-400">
            {t('portion_alerts.kpi_asada_excess')}
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-xl font-black text-gray-900 dark:text-white">
              +{summary.asadaExcessBags.toFixed(1)} {t('portion_alerts.bags_unit')}
            </span>
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
              (+{summary.asadaExcessLbs.toFixed(1)} lb)
            </span>
          </div>
          <div className="mt-1 text-xs font-bold text-rose-600 dark:text-rose-400">
            {t('portion_alerts.store_loss')} {formatSignedUSD(summary.asadaStoreLossUsd)}
          </div>
        </div>

        <div className="rounded-xl p-3.5 bg-white dark:bg-white/[0.03] border border-gray-200 dark:border-white/10">
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {t('portion_alerts.kpi_total_meat_loss')}
          </div>
          <div className="mt-1 text-xl font-black text-rose-600 dark:text-rose-400">
            {formatSignedUSD(summary.totalStoreLossUsd)}
          </div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t('portion_alerts.bodega_cost')} {formatSignedUSD(summary.totalBodegaLossUsd)} · +{summary.totalExcessLbs.toFixed(1)} lb
          </div>
        </div>

        <div className="rounded-xl p-3.5 bg-white dark:bg-white/[0.03] border border-gray-200 dark:border-white/10">
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {t('portion_alerts.kpi_open_escalations')}
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-xl font-black text-gray-900 dark:text-white">{summary.totalOpenAlerts}</span>
            <span className="text-xs font-bold text-rose-600 dark:text-rose-400">
              ({summary.criticalOpenAlerts} {t('portion_alerts.critical_unit')})
            </span>
          </div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {summary.escalatedExecAlerts} {t('portion_alerts.exec_copied')}
          </div>
        </div>

        <div className="rounded-xl p-3.5 bg-white dark:bg-white/[0.03] border border-amber-200 dark:border-amber-500/25">
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-amber-700 dark:text-amber-400">
            {t('portion_alerts.kpi_handovers')}
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-xl font-black text-gray-900 dark:text-white">{handovers.length}</span>
            <button
              type="button"
              onClick={() => setHandoverOpen(true)}
              className="text-xs font-bold text-amber-700 dark:text-amber-400 underline hover:no-underline"
            >
              {t('portion_alerts.capture_now')}
            </button>
          </div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {handovers[0]
              ? `${t('portion_alerts.latest_prefix')} #${handovers[0].store_id} (${handovers[0].business_date}) · ${handovers[0].sealed_bags} ${t('portion_alerts.bags_unit')}`
              : t('portion_alerts.no_handovers_yet')}
          </div>
        </div>
      </div>

      {/* CONTENIDO PESTAÑA 1: ALERTAS Y ESCALERA DE MANDO */}
      {activeTab === 'alerts' ? (
        <div className="p-4 space-y-4">
          {loading ? (
            <div className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
              {t('portion_alerts.loading')}
            </div>
          ) : alerts.length === 0 ? (
            <div className="py-10 px-4 text-center rounded-xl border border-dashed border-gray-200 dark:border-white/10">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
              <p className="text-sm font-bold text-gray-900 dark:text-white">
                {t('portion_alerts.empty_title')}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t('portion_alerts.empty_hint')}
              </p>
            </div>
          ) : (
            alerts.map((alert) => {
              const isCritical = alert.severity === 'critical'
              const isAsada = alert.meat_key === 'asada'
              const bagLbs = MEAT_BAG_LBS_MAP[alert.meat_key] || 10
              const theoBags = bagLbs > 0 ? alert.theoretical_lbs / bagLbs : 0
              const actualBags = bagLbs > 0 ? alert.actual_lbs / bagLbs : 0
              const isBusy = busyAlertId === alert.id
              const hasStrike = Boolean(alert.disciplinary_action_id)

              const steps = [
                {
                  num: 1 as const,
                  label: t('portion_alerts.step1'),
                  sub: alert.email_sent_at
                    ? `${t('portion_alerts.emailed_prefix')} ${new Date(alert.email_sent_at).toLocaleDateString()}`
                    : t('portion_alerts.detected'),
                  icon: AlertTriangle,
                },
                {
                  num: 2 as const,
                  label: t('portion_alerts.step2'),
                  sub: alert.acknowledged_by || t('portion_alerts.pending'),
                  icon: UserCheck,
                },
                {
                  num: 3 as const,
                  label: t('portion_alerts.step3'),
                  sub: alert.coaching_staff_names
                    ? `${alert.coaching_shift || 'AM/PM'}: ${alert.coaching_staff_names}`
                    : t('portion_alerts.pending'),
                  icon: ClipboardCheck,
                },
                {
                  num: 4 as const,
                  label: t('portion_alerts.step4'),
                  sub: alert.supervisor_verified_by || t('portion_alerts.pending'),
                  icon: ShieldCheck,
                },
              ]

              return (
                <div
                  key={alert.id}
                  className={`rounded-xl border p-4 transition ${
                    isCritical
                      ? 'border-rose-300 dark:border-rose-500/40 bg-rose-50/20 dark:bg-rose-950/10'
                      : 'border-amber-300 dark:border-amber-500/30 bg-amber-50/15 dark:bg-amber-950/10'
                  }`}
                >
                  {/* Fila Superior: Tienda, Carne, Severidad, SLA 24h y Pérdida USD */}
                  <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 pb-3 border-b border-gray-200/80 dark:border-white/10">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`px-2.5 py-1 rounded-md text-xs font-black uppercase tracking-wide ${
                          isCritical ? 'bg-rose-600 text-white' : 'bg-amber-500 text-gray-950'
                        }`}
                      >
                        {isCritical ? t('portion_alerts.badge_critical') : t('portion_alerts.badge_warning')}
                      </span>

                      <span
                        className={`px-2.5 py-1 rounded-md text-xs font-extrabold ${
                          isAsada
                            ? 'bg-red-100 text-red-900 dark:bg-red-500/20 dark:text-red-200 border border-red-300 dark:border-red-500/30'
                            : 'bg-gray-100 text-gray-800 dark:bg-white/10 dark:text-gray-200'
                        }`}
                      >
                        🥩 {alert.meat_name}
                      </span>

                      <h3 className="text-base font-extrabold text-gray-900 dark:text-white">
                        #{alert.store_id} {alert.store_name}
                      </h3>

                      <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                        ({alert.period_start} → {alert.period_end} · {alert.span_days}d)
                      </span>

                      {renderSlaBadge(alert)}

                      {alert.escalated_to_execs && (
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-gray-900 text-white dark:bg-white dark:text-gray-900">
                          {t('portion_alerts.exec_escalation')}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-right">
                      <div>
                        <div className="text-[11px] uppercase font-bold text-gray-500 dark:text-gray-400">
                          {t('portion_alerts.excess_bags')}
                        </div>
                        <div className="text-sm font-black text-rose-600 dark:text-rose-400">
                          +{Number(alert.variance_bags).toFixed(1)} {t('portion_alerts.bags_unit')} (+{Number(alert.variance_lbs).toFixed(1)} lb / +{Number(alert.variance_pct).toFixed(1)}%)
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase font-bold text-gray-500 dark:text-gray-400">
                          {t('portion_alerts.usd_lost')}
                        </div>
                        <div className="text-base font-black text-rose-600 dark:text-rose-400">
                          {formatSignedUSD(Number(alert.dollar_loss_store))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Métricas de Balance + Exceso en Taco/Burrito */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 my-3 text-xs">
                    <div className="p-2.5 rounded-lg bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/10">
                      <span className="text-gray-500 dark:text-gray-400 block">
                        {t('portion_alerts.pos_theoretical')}
                      </span>
                      <strong className="text-sm text-gray-900 dark:text-white">
                        {theoBags.toFixed(1)} {t('portion_alerts.bags_unit')} ({Number(alert.theoretical_lbs).toFixed(1)} lb)
                      </strong>
                    </div>
                    <div className="p-2.5 rounded-lg bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/10">
                      <span className="text-gray-500 dark:text-gray-400 block">
                        {t('portion_alerts.physical_used')}
                      </span>
                      <strong className="text-sm text-gray-900 dark:text-white">
                        {actualBags.toFixed(1)} {t('portion_alerts.bags_unit')} ({Number(alert.actual_lbs).toFixed(1)} lb)
                      </strong>
                    </div>
                    <div className="p-2.5 rounded-lg bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/10">
                      <span className="text-gray-500 dark:text-gray-400 block">
                        {t('portion_alerts.scoop_drift')}
                      </span>
                      <strong className="text-sm text-amber-700 dark:text-amber-400">
                        +{Number(alert.excess_oz_per_taco).toFixed(2)} oz / +{(Number(alert.excess_oz_per_taco) * 4).toFixed(2)} oz
                      </strong>
                    </div>
                    <div className="p-2.5 rounded-lg bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/10">
                      <span className="text-gray-500 dark:text-gray-400 block">
                        {t('portion_alerts.dominant_shift')}
                      </span>
                      <strong className="text-sm text-gray-900 dark:text-white">
                        {alert.dominant_shift === 'BOTH'
                          ? t('portion_alerts.shift_both')
                          : `${t('portion_alerts.shift_prefix')} ${alert.dominant_shift}`}
                      </strong>
                    </div>
                  </div>

                  {/* Desglose AM vs PM y Taqueros en Turno con Conteo de Strikes en Vivo */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                    <div className="p-3 rounded-lg bg-white dark:bg-white/[0.03] border border-gray-200 dark:border-white/10">
                      <div className="flex items-center justify-between text-xs font-bold text-gray-800 dark:text-gray-200 mb-1.5">
                        <span>☀️ {t('portion_alerts.am_shift')}</span>
                        <span>
                          POS: {Number(alert.am_theo_lbs).toFixed(1)} lb
                          {alert.am_actual_lbs !== null
                            ? ` · ${t('portion_alerts.actual_short')}: ${Number(alert.am_actual_lbs).toFixed(1)} lb`
                            : ''}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(alert.am_staff || []).length === 0 ? (
                          <span className="text-[11px] text-gray-400">{t('portion_alerts.no_staff')}</span>
                        ) : (
                          (alert.am_staff || []).slice(0, 6).map((s, idx) => {
                            const prior = lookupPriorStrikes(alert.store_id, s.name, s.toastGuid, s.userId)
                            return (
                              <span
                                key={`${s.name}-${idx}`}
                                className={`px-2 py-0.5 rounded text-[11px] font-semibold inline-flex items-center gap-1 ${
                                  s.category === 'grill'
                                    ? 'bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/25'
                                    : 'bg-blue-50 text-blue-800 border border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/25'
                                }`}
                              >
                                <span>
                                  {s.name} ({s.role})
                                </span>
                                {prior > 0 && (
                                  <span
                                    className={`px-1 rounded text-[10px] font-black ${
                                      prior >= 2 ? 'bg-red-600 text-white' : 'bg-amber-500 text-gray-950'
                                    }`}
                                  >
                                    {prior} {t('portion_alerts.strikes_tag')}
                                  </span>
                                )}
                              </span>
                            )
                          })
                        )}
                      </div>
                    </div>

                    <div className="p-3 rounded-lg bg-white dark:bg-white/[0.03] border border-gray-200 dark:border-white/10">
                      <div className="flex items-center justify-between text-xs font-bold text-gray-800 dark:text-gray-200 mb-1.5">
                        <span>🌙 {t('portion_alerts.pm_shift')}</span>
                        <span>
                          POS: {Number(alert.pm_theo_lbs).toFixed(1)} lb
                          {alert.pm_actual_lbs !== null
                            ? ` · ${t('portion_alerts.actual_short')}: ${Number(alert.pm_actual_lbs).toFixed(1)} lb`
                            : ''}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(alert.pm_staff || []).length === 0 ? (
                          <span className="text-[11px] text-gray-400">{t('portion_alerts.no_staff')}</span>
                        ) : (
                          (alert.pm_staff || []).slice(0, 6).map((s, idx) => {
                            const prior = lookupPriorStrikes(alert.store_id, s.name, s.toastGuid, s.userId)
                            return (
                              <span
                                key={`${s.name}-${idx}`}
                                className={`px-2 py-0.5 rounded text-[11px] font-semibold inline-flex items-center gap-1 ${
                                  s.category === 'grill'
                                    ? 'bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/25'
                                    : 'bg-blue-50 text-blue-800 border border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/25'
                                }`}
                              >
                                <span>
                                  {s.name} ({s.role})
                                </span>
                                {prior > 0 && (
                                  <span
                                    className={`px-1 rounded text-[10px] font-black ${
                                      prior >= 2 ? 'bg-red-600 text-white' : 'bg-amber-500 text-gray-950'
                                    }`}
                                  >
                                    {prior} {t('portion_alerts.strikes_tag')}
                                  </span>
                                )}
                              </span>
                            )
                          })
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Stepper de 4 Pasos de la Escalera de Mando */}
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 mb-3">
                    {steps.map((st) => {
                      const done = getStepCompleted(alert, st.num)
                      const IconComp = st.icon
                      return (
                        <div
                          key={st.num}
                          className={`flex items-center gap-2 p-2.5 rounded-lg border text-xs ${
                            done
                              ? 'bg-emerald-50/80 border-emerald-300 text-emerald-900 dark:bg-emerald-500/15 dark:border-emerald-500/30 dark:text-emerald-200'
                              : 'bg-white/70 border-gray-200 text-gray-500 dark:bg-white/[0.02] dark:border-white/10 dark:text-gray-400'
                          }`}
                        >
                          <IconComp className={`w-4 h-4 shrink-0 ${done ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}`} />
                          <div className="min-w-0">
                            <div className="font-bold truncate">{st.label}</div>
                            <div className="text-[11px] opacity-80 truncate">{st.sub}</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {alert.corrective_action_notes && (
                    <div className="mb-3 px-3 py-2 rounded-lg bg-gray-100 dark:bg-white/5 text-xs text-gray-700 dark:text-gray-300 whitespace-pre-line">
                      <strong>{t('portion_alerts.notes_label')}</strong> {alert.corrective_action_notes}
                    </div>
                  )}

                  {/* Botones de Acción de la Escalera de Mando con Bloqueo si no hay Strike */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-gray-200/70 dark:border-white/10">
                    <div className="text-[11px] text-gray-500 dark:text-gray-400">
                      <Users className="w-3.5 h-3.5 inline mr-1" />
                      {t('portion_alerts.chain_label')} {alert.manager_email || '—'} · CC: {alert.supervisor_email || '—'}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {!getStepCompleted(alert, 2) && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handlePatchWorkflow(alert.id, 'acknowledge')}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white transition disabled:opacity-50"
                        >
                          {t('portion_alerts.btn_ack')}
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => openCoachingModal(alert)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-extrabold bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition disabled:opacity-50"
                      >
                        <Scale className="w-3.5 h-3.5" />
                        {t('portion_alerts.btn_coach_mandatory')}
                      </button>

                      {isSupervisorOrAdmin && alert.status !== 'verified' && alert.status !== 'resolved' && (
                        <button
                          type="button"
                          disabled={isBusy || !hasStrike}
                          title={!hasStrike ? t('portion_alerts.block_verify_hint') : undefined}
                          onClick={() => handlePatchWorkflow(alert.id, 'supervisor_verify')}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {t('portion_alerts.btn_verify')}
                        </button>
                      )}

                      {isSupervisorOrAdmin && alert.status !== 'resolved' && (
                        <button
                          type="button"
                          disabled={isBusy || !hasStrike}
                          title={!hasStrike ? t('portion_alerts.block_verify_hint') : undefined}
                          onClick={() => handlePatchWorkflow(alert.id, 'resolve')}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold border border-gray-300 dark:border-white/20 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10 transition disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {t('portion_alerts.btn_resolve')}
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleSendEscaleraEmail(alert.id)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white transition disabled:opacity-50"
                      >
                        <Mail className="w-3.5 h-3.5" />
                        {alert.email_sent_at ? t('portion_alerts.btn_resend_email') : t('portion_alerts.btn_send_email')}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      ) : (
        /* CONTENIDO PESTAÑA 2: REGISTRO DE STRIKES, REINCIDENCIAS Y EXPULSIONES */
        <div className="p-4 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="text-sm sm:text-base font-extrabold text-gray-900 dark:text-white flex items-center gap-2">
                <Gavel className="w-4 h-4 text-rose-600" />
                {t('portion_alerts.strikes_tab_title')}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {t('portion_alerts.strikes_tab_subtitle')}
              </p>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { key: 'all', label: t('portion_alerts.strikes_filter_all') },
                  { key: 'strike_1_warning', label: t('portion_alerts.strikes_filter_s1') },
                  { key: 'strike_2_final_suspension', label: t('portion_alerts.strikes_filter_s2') },
                  { key: 'strike_3_expulsion', label: t('portion_alerts.strikes_filter_expulsion') },
                ] as const
              ).map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setStrikeStageFilter(f.key)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border transition ${
                    strikeStageFilter === f.key
                      ? 'bg-rose-600 text-white border-rose-600'
                      : 'bg-white dark:bg-white/5 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-white/10'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {filteredStrikes.length === 0 ? (
            <div className="py-10 px-4 text-center rounded-xl border border-dashed border-gray-200 dark:border-white/10">
              <ShieldCheck className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
              <p className="text-sm font-bold text-gray-900 dark:text-white">
                {t('portion_alerts.strikes_empty')}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-white/10">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-100/80 dark:bg-white/5 text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-white/10">
                    <th className="py-2.5 px-3 font-extrabold">{t('portion_alerts.col_date_store')}</th>
                    <th className="py-2.5 px-3 font-extrabold">{t('portion_alerts.col_employee')}</th>
                    <th className="py-2.5 px-3 font-extrabold">{t('portion_alerts.col_meat_excess')}</th>
                    <th className="py-2.5 px-3 font-extrabold">{t('portion_alerts.col_scale_sample')}</th>
                    <th className="py-2.5 px-3 font-extrabold">{t('portion_alerts.col_stage_status')}</th>
                    <th className="py-2.5 px-3 font-extrabold text-right">{t('portion_alerts.col_actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-white/10">
                  {filteredStrikes.map((row) => {
                    const isExpulsion = row.disciplinary_stage === 'strike_3_expulsion'
                    const isStrike2 = row.disciplinary_stage === 'strike_2_final_suspension'
                    const isPendingExpulsion = row.expulsion_status === 'pending_mandatory_expulsion'
                    const busy = busyStrikeId === row.id

                    return (
                      <tr
                        key={row.id}
                        className={
                          isExpulsion
                            ? 'bg-red-50/50 dark:bg-red-950/20'
                            : isStrike2
                              ? 'bg-amber-50/40 dark:bg-amber-950/15'
                              : 'bg-white dark:bg-transparent'
                        }
                      >
                        <td className="py-3 px-3 align-top">
                          <div className="font-bold text-gray-900 dark:text-white">
                            #{row.store_id} {row.store_name}
                          </div>
                          <div className="text-[11px] text-gray-500 dark:text-gray-400">
                            {new Date(row.created_at).toLocaleString()}
                          </div>
                        </td>

                        <td className="py-3 px-3 align-top">
                          <div className="font-extrabold text-gray-900 dark:text-white">{row.employee_name}</div>
                          <div className="text-[11px] text-gray-600 dark:text-gray-400">
                            {row.employee_role} · {t('portion_alerts.shift_prefix')} {row.shift}
                          </div>
                          <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">
                            {row.mandatory_commitment}
                          </div>
                        </td>

                        <td className="py-3 px-3 align-top">
                          <div className="font-bold text-gray-900 dark:text-white">{row.meat_name}</div>
                          <div className="font-extrabold text-rose-600 dark:text-rose-400">
                            +{Number(row.excess_bags).toFixed(1)} {t('portion_alerts.bags_unit')} ·{' '}
                            {formatSignedUSD(Number(row.dollar_loss_store))}
                          </div>
                        </td>

                        <td className="py-3 px-3 align-top">
                          <div className="font-semibold text-gray-900 dark:text-white">
                            {t('portion_alerts.tacos_sample_short')}{' '}
                            <strong className={Number(row.sampled_tacos_avg_oz) > 1.55 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}>
                              {Number(row.sampled_tacos_avg_oz).toFixed(2)} oz
                            </strong>
                          </div>
                          <div className="font-semibold text-gray-900 dark:text-white">
                            {t('portion_alerts.burritos_sample_short')}{' '}
                            <strong className={Number(row.sampled_burritos_avg_oz) > 6.15 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}>
                              {Number(row.sampled_burritos_avg_oz).toFixed(2)} oz
                            </strong>
                          </div>
                        </td>

                        <td className="py-3 px-3 align-top space-y-1">
                          <div>
                            {isExpulsion ? (
                              <span className="inline-block px-2 py-0.5 rounded-md text-[11px] font-black bg-red-600 text-white">
                                {t('portion_alerts.stage_s3_badge', { num: row.offense_number })}
                              </span>
                            ) : isStrike2 ? (
                              <span className="inline-block px-2 py-0.5 rounded-md text-[11px] font-extrabold bg-amber-500 text-gray-950">
                                {t('portion_alerts.stage_s2_badge')}
                              </span>
                            ) : (
                              <span className="inline-block px-2 py-0.5 rounded-md text-[11px] font-bold bg-blue-100 text-blue-900 dark:bg-blue-500/20 dark:text-blue-200">
                                {t('portion_alerts.stage_s1_badge')}
                              </span>
                            )}
                          </div>

                          {isExpulsion && (
                            <div>
                              {isPendingExpulsion ? (
                                <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300">
                                  {t('portion_alerts.expulsion_pending_badge')}
                                </span>
                              ) : row.expulsion_status === 'expulsion_confirmed' ? (
                                <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300">
                                  {t('portion_alerts.expulsion_confirmed_badge')}
                                </span>
                              ) : (
                                <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-gray-200 text-gray-800 dark:bg-white/10 dark:text-gray-300">
                                  {t('portion_alerts.expulsion_appealed_badge')}
                                </span>
                              )}
                            </div>
                          )}

                          <div className="text-[10px] text-gray-500 dark:text-gray-400">
                            {t('portion_alerts.issued_by_prefix')} {row.issued_by_name}
                            {row.supervisor_verified_by
                              ? ` · ${t('portion_alerts.verified_by_prefix')} ${row.supervisor_verified_by}`
                              : ''}
                          </div>
                        </td>

                        <td className="py-3 px-3 align-top text-right">
                          {isSupervisorOrAdmin && isExpulsion && isPendingExpulsion ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleConfirmExpulsion(row.id)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-extrabold bg-red-600 hover:bg-red-700 text-white shadow-sm transition disabled:opacity-50"
                            >
                              <AlertOctagon className="w-3.5 h-3.5" />
                              {busy ? t('portion_alerts.confirming_expulsion') : t('portion_alerts.btn_confirm_expulsion')}
                            </button>
                          ) : row.supervisor_verified_by ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {row.supervisor_verified_by}
                            </span>
                          ) : (
                            <span className="text-[11px] text-gray-400">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* MODAL OBLIGATORIO: Calibración en Báscula + Emisión Automática de Strike 1 / 2 / 3 */}
      {coachingAlert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 overflow-y-auto">
          <div className="w-full max-w-xl rounded-2xl bg-white dark:bg-[#181c26] border border-gray-200 dark:border-white/10 shadow-2xl overflow-hidden my-6">
            <div className="px-5 py-4 border-b border-gray-200 dark:border-white/10 flex items-start justify-between bg-rose-50/70 dark:bg-rose-950/30">
              <div className="flex items-start gap-2.5">
                <Scale className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-base font-extrabold text-gray-900 dark:text-white">
                    {t('portion_alerts.modal_coach_title')}
                  </h3>
                  <p className="text-xs font-semibold text-rose-700 dark:text-rose-300 mt-0.5">
                    #{coachingAlert.store_id} {coachingAlert.store_name} · {coachingAlert.meat_name} (+
                    {Number(coachingAlert.variance_bags).toFixed(1)} {t('portion_alerts.bags_unit')})
                  </p>
                  <p className="text-[11px] text-gray-600 dark:text-gray-400 mt-1">
                    {t('portion_alerts.modal_coach_mandatory_sub')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCoachingAlert(null)}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveCoaching} className="p-5 space-y-4">
              {/* Selector de Colaborador en Turno + Nivel de Strike en Vivo */}
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                  {t('portion_alerts.select_employee_label')}
                </label>
                <select
                  value={selectedStaffOptionKey}
                  onChange={(e) => handleSelectCandidateChange(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-white/15 bg-white dark:bg-black/30 text-sm font-semibold text-gray-900 dark:text-white"
                >
                  <option value="" disabled>
                    {t('portion_alerts.select_employee_placeholder')}
                  </option>
                  {candidateStaffOptions.map((opt) => (
                    <option key={opt.optionKey} value={opt.optionKey}>
                      [{opt.shift}] {opt.name} ({opt.rawRole}) — {opt.priorStrikes} {t('portion_alerts.strikes_tag')}
                    </option>
                  ))}
                  <option value="__manual__">{t('portion_alerts.manual_employee_option')}</option>
                </select>

                {selectedStaffOptionKey === '__manual__' && (
                  <div className="mt-2.5">
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      {t('portion_alerts.manual_employee_name_label')}
                    </label>
                    <input
                      type="text"
                      required
                      minLength={2}
                      value={manualEmployeeName}
                      onChange={(e) => setManualEmployeeName(e.target.value)}
                      placeholder={t('portion_alerts.manual_employee_name_ph')}
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-white/15 bg-white dark:bg-black/30 text-sm text-gray-900 dark:text-white"
                    />
                  </div>
                )}

                {activeEmployeeName.length >= 2 && (
                  <div
                    className={`mt-2.5 px-3 py-2.5 rounded-xl border text-xs font-extrabold ${
                      selectedPriorStrikes >= 2
                        ? 'bg-red-600 text-white border-red-700 animate-pulse'
                        : selectedPriorStrikes === 1
                          ? 'bg-amber-100 text-amber-950 border-amber-400 dark:bg-amber-500/20 dark:text-amber-200 dark:border-amber-500/40'
                          : 'bg-blue-50 text-blue-900 border-blue-200 dark:bg-blue-500/15 dark:text-blue-200 dark:border-blue-500/30'
                    }`}
                  >
                    {selectedPriorStrikes === 0
                      ? t('portion_alerts.prior_0_badge')
                      : selectedPriorStrikes === 1
                        ? t('portion_alerts.prior_1_badge')
                        : t('portion_alerts.prior_2_plus_badge', {
                            count: selectedPriorStrikes,
                            next: selectedPriorStrikes + 1,
                          })}
                  </div>
                )}
              </div>

              {/* Puesto y Turno Auditado */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                    {t('portion_alerts.employee_role_label')}
                  </label>
                  <select
                    value={selectedEmployeeRole}
                    onChange={(e) => setSelectedEmployeeRole(e.target.value as DisciplinaryEmployeeRole)}
                    required
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-white/15 bg-white dark:bg-black/30 text-sm font-semibold text-gray-900 dark:text-white"
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                    {t('portion_alerts.coach_shift_label')}
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['AM', 'PM', 'BOTH'] as const).map((sh) => (
                      <button
                        key={sh}
                        type="button"
                        onClick={() => setCoachingShift(sh)}
                        className={`py-2 rounded-lg text-xs font-bold border transition ${
                          coachingShift === sh
                            ? 'bg-amber-600 text-white border-amber-600'
                            : 'border-gray-200 dark:border-white/15 text-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {sh === 'BOTH' ? t('portion_alerts.shift_both') : `${t('portion_alerts.shift_prefix')} ${sh}`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Pesaje Obligatorio en Báscula: 5 Tacos (meta 1.50 oz) y 3 Burritos (meta 6.00 oz) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/10">
                <div>
                  <label className="block text-xs font-extrabold text-gray-800 dark:text-gray-200 mb-1">
                    ⚖️ {t('portion_alerts.tacos_oz_label')} *
                  </label>
                  <input
                    type="number"
                    step="0.05"
                    min="0.1"
                    max="24"
                    required
                    value={sampledTacosOz}
                    onChange={(e) => setSampledTacosOz(e.target.value)}
                    placeholder="1.50"
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-white/15 bg-white dark:bg-black/40 text-sm font-black text-gray-900 dark:text-white"
                  />
                  <div className="mt-1 text-[11px] flex items-center justify-between">
                    <span className="text-gray-500 dark:text-gray-400">{t('portion_alerts.tacos_oz_target_hint')}</span>
                    {tacosDelta !== null && (
                      <span className={tacosDelta > 0.05 ? 'font-bold text-rose-600 dark:text-rose-400' : 'font-bold text-emerald-600 dark:text-emerald-400'}>
                        {tacosDelta > 0.05
                          ? `+${tacosDelta.toFixed(2)} oz ${t('portion_alerts.delta_over_target')}`
                          : t('portion_alerts.delta_on_target')}
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-gray-800 dark:text-gray-200 mb-1">
                    ⚖️ {t('portion_alerts.burritos_oz_label')} *
                  </label>
                  <input
                    type="number"
                    step="0.05"
                    min="0.5"
                    max="48"
                    required
                    value={sampledBurritosOz}
                    onChange={(e) => setSampledBurritosOz(e.target.value)}
                    placeholder="6.00"
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-white/15 bg-white dark:bg-black/40 text-sm font-black text-gray-900 dark:text-white"
                  />
                  <div className="mt-1 text-[11px] flex items-center justify-between">
                    <span className="text-gray-500 dark:text-gray-400">{t('portion_alerts.burritos_oz_target_hint')}</span>
                    {burritosDelta !== null && (
                      <span className={burritosDelta > 0.15 ? 'font-bold text-rose-600 dark:text-rose-400' : 'font-bold text-emerald-600 dark:text-emerald-400'}>
                        {burritosDelta > 0.15
                          ? `+${burritosDelta.toFixed(2)} oz ${t('portion_alerts.delta_over_target')}`
                          : t('portion_alerts.delta_on_target')}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Casilla Obligatoria de Calibración Presencial en Báscula */}
              <label className="flex items-start gap-2.5 p-3 rounded-xl border border-amber-300 dark:border-amber-500/35 bg-amber-50/60 dark:bg-amber-950/20 cursor-pointer">
                <input
                  type="checkbox"
                  required
                  checked={scaleAuditChecked}
                  onChange={(e) => setScaleAuditChecked(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-rose-600 focus:ring-rose-500"
                />
                <span className="text-xs font-bold text-gray-800 dark:text-gray-200 leading-relaxed">
                  {t('portion_alerts.scale_checkbox_label')}
                </span>
              </label>

              {/* Compromiso Obligatorio (>= 10 caracteres) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300">
                    {t('portion_alerts.coach_notes_label')} *
                  </label>
                  <span
                    className={`text-[11px] font-bold ${
                      coachingNotes.trim().length >= 10 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {coachingNotes.trim().length} {t('portion_alerts.min_chars_hint')}
                  </span>
                </div>
                <textarea
                  rows={3}
                  required
                  minLength={10}
                  value={coachingNotes}
                  onChange={(e) => setCoachingNotes(e.target.value)}
                  placeholder={t('portion_alerts.coach_notes_placeholder')}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-white/15 bg-white dark:bg-black/30 text-sm text-gray-900 dark:text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCoachingAlert(null)}
                  className="px-4 py-2 rounded-lg text-xs font-bold border border-gray-300 dark:border-white/15 text-gray-700 dark:text-gray-300"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={
                    savingCoaching ||
                    activeEmployeeName.length < 2 ||
                    !scaleAuditChecked ||
                    coachingNotes.trim().length < 10
                  }
                  className={`px-4 py-2 rounded-lg text-xs font-extrabold text-white shadow-sm transition disabled:opacity-50 ${
                    selectedPriorStrikes >= 2
                      ? 'bg-red-600 hover:bg-red-700'
                      : selectedPriorStrikes === 1
                        ? 'bg-orange-600 hover:bg-orange-700'
                        : 'bg-amber-600 hover:bg-amber-700'
                  }`}
                >
                  {savingCoaching
                    ? t('portion_alerts.saving')
                    : selectedPriorStrikes >= 2
                      ? t('portion_alerts.submit_strike_3')
                      : selectedPriorStrikes === 1
                        ? t('portion_alerts.submit_strike_2')
                        : t('portion_alerts.submit_strike_1')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Conteo Físico Cambio de Turno 5:00 PM */}
      {handoverOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#181c26] border border-gray-200 dark:border-white/10 shadow-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200 dark:border-white/10 flex items-center justify-between bg-amber-50/60 dark:bg-amber-950/20">
              <div className="flex items-center gap-2.5">
                <Scale className="w-5 h-5 text-amber-600" />
                <div>
                  <h3 className="text-base font-extrabold text-gray-900 dark:text-white">
                    {t('portion_alerts.handover_modal_title')}
                  </h3>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    {t('portion_alerts.handover_modal_sub')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setHandoverOpen(false)}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveHandover} className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    {t('portion_alerts.store_label')}
                  </label>
                  <select
                    value={handoverStoreId}
                    onChange={(e) => setHandoverStoreId(e.target.value)}
                    required
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-white/15 bg-white dark:bg-black/30 text-sm text-gray-900 dark:text-white"
                  >
                    {selectableStores.map((st) => (
                      <option key={st.id} value={String(st.id)}>
                        {st.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    {t('portion_alerts.date_label')}
                  </label>
                  <input
                    type="date"
                    value={handoverDate}
                    onChange={(e) => setHandoverDate(e.target.value)}
                    required
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-white/15 bg-white dark:bg-black/30 text-sm text-gray-900 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  {t('portion_alerts.meat_label')}
                </label>
                <select
                  value={handoverMeat}
                  onChange={(e) => setHandoverMeat(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-white/15 bg-white dark:bg-black/30 text-sm text-gray-900 dark:text-white"
                >
                  {MEAT_OPTIONS.map((m) => (
                    <option key={m.key} value={m.key}>
                      {language === 'en' ? m.en : m.es}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    {t('portion_alerts.sealed_bags_label')}
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    required
                    value={handoverSealedBags}
                    onChange={(e) => setHandoverSealedBags(e.target.value)}
                    placeholder="18"
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-white/15 bg-white dark:bg-black/30 text-sm font-bold text-gray-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    {t('portion_alerts.open_lbs_label')}
                  </label>
                  <input
                    type="number"
                    step="0.25"
                    min="0"
                    value={handoverOpenLbs}
                    onChange={(e) => setHandoverOpenLbs(e.target.value)}
                    placeholder="6.5"
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-white/15 bg-white dark:bg-black/30 text-sm font-bold text-gray-900 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  {t('portion_alerts.handover_notes_label')}
                </label>
                <input
                  type="text"
                  value={handoverNotes}
                  onChange={(e) => setHandoverNotes(e.target.value)}
                  placeholder={t('portion_alerts.handover_notes_ph')}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-white/15 bg-white dark:bg-black/30 text-sm text-gray-900 dark:text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setHandoverOpen(false)}
                  className="px-4 py-2 rounded-lg text-xs font-bold border border-gray-300 dark:border-white/15 text-gray-700 dark:text-gray-300"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={savingHandover}
                  className="px-4 py-2 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50"
                >
                  {savingHandover ? t('portion_alerts.saving') : t('portion_alerts.save_handover_btn')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
