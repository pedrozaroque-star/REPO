/**
 * @module app/admin/conciliar-delivery/page
 * @description Interfaz ejecutiva rediseñada del Módulo Delivery Platform Order Reconciliation de Tacos Gavilan
 *              (Toast POS → Orden de Plataforma → Payout/Settlement → Disputa/Reembolso/Recuperación → Journal Entry de QuickBooks).
 *
 * @businessRules
 * 1. Pregunta Principal de Auditoría:
 *    - La pantalla responde primero: "¿Hay dinero faltante o una diferencia que requiere acción?"
 *    - Siempre muestra el alcance activo: sucursal(es), plataforma(s), periodo operativo (6:00 AM–5:59 AM PT), última sincronización y cobertura de las 15 tiendas.
 * 2. Cuatro Grupos Operativos Mutuamente Claros:
 *    - Grupo 1 (`CONCILIATED_READY`): Conciliado y listo para contabilizar (match exacto por ID, payout comprobado y diferencia $0.00).
 *    - Grupo 2 (`VARIANCE_INVESTIGATE`): Diferencia por investigar ("Con payout, pendiente de revisión" por diferencia de monto o Sales Tax).
 *    - Grupo 3 (`DISPUTE_RECOVERY`): Disputa / recuperación (deducción en payout, disputa abierta o recuperación en corte posterior).
 *    - Grupo 4 (`BLOCKED_MISSING_INFO`): Bloqueado por falta de información o sincronización (match ambiguo, sin ID verificable, falta tax real, tienda desconocida `UNASSIGNED_STORE`, o en Toast pendiente de corte).
 * 3. Reglas Fiscales Obligatorias:
 *    - **DoorDash y Grubhub**: Tacos Gavilan recibe y reporta el Sales Tax (`Cuenta 24001`). `Expected Gross = Toast Net Sales + Tax Real`.
 *    - **Uber Eats**: Marketplace Facilitator; Uber retiene y remite el Sales Tax (`Cuenta 12050`). `Expected Gross = Toast Net Sales (sin tax)` y `Tax paid to merchant = $0.00`.
 *    - Prohibido estimar impuestos (10.25%) o comisiones (20%).
 * 4. Seguridad en Selección, Resolución por Lote y Conciliación Bancaria en QuickBooks Online:
 *    - Limpia la selección de payouts (`selectedQbPayoutIds`) y órdenes (`selectedOrderIds`) al cambiar tienda, plataforma, fechas, filtros o recargar datos.
 *    - Resolución masiva por lote (`batch_resolve_review`, `batch_update_disputes`) y exportación de Paquete de Evidencia de Disputas.
 *    - Verificación de Depósito Bancario en QuickBooks Online (`bankVerification`) comparando `net_payout_amount` contra la cuenta bancaria `100XX` de cada sucursal.
 *    - Prohibido publicar ítems ocultos por filtros o con bloqueos (`!canPublish`).
 *    - Modal de confirmación final antes de publicación masiva mostrando: cantidad, tiendas, plataformas, `payout_reference_id`s y total neto.
 *    - Al abrir un payout para auditar sus órdenes, filtra estrictamente por `payout_reference_id` sin mezclar otros settlements.
 *
 * @dataFlow
 * - Consume `GET /api/delivery-reconciliation` y `GET /api/delivery-reconciliation/quickbooks-journal` (con `credentials: 'include'`).
 * - Ejecuta mutaciones autenticadas vía `POST /api/delivery-reconciliation` y `POST /api/delivery-reconciliation/quickbooks-journal`.
 *
 * @notes
 * - Soporte 100% bilingüe (ES/EN) mediante `useLanguage()` (`deliveryReconciliation.*`).
 */

'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useLanguage } from '@/lib/i18n'
import {
  ShieldCheck,
  RefreshCw,
  Upload,
  Download,
  Search,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Landmark,
  FileSpreadsheet,
  Store,
  Eye,
  Scale,
  Receipt,
  Info,
  X,
  Calendar,
  Lock,
  ArrowRight,
} from 'lucide-react'

type DeliveryPlatform = 'DOORDASH' | 'UBER_EATS' | 'GRUBHUB'
type ActionGroup = 'CONCILIATED_READY' | 'VARIANCE_INVESTIGATE' | 'DISPUTE_RECOVERY' | 'BLOCKED_MISSING_INFO'

interface LifecycleStage {
  step: number
  stage: string
  title_es: string
  title_en: string
  date: string | null
  amount: number
  detail_es: string
  detail_en: string
  completed: boolean
}

interface ReconciledOrder {
  id: string
  store_id: number
  store_name: string
  store_code: string
  platform: DeliveryPlatform
  business_date: string
  placed_at: string | null
  platform_order_id: string
  platform_transaction_id?: string
  payout_reference_id: string | null
  payout_date: string | null
  fulfillment_type?: 'DELIVERY' | 'PICKUP'
  transaction_type?: string
  platform_subtotal: number
  platform_tax: number
  platform_tax_withheld: number
  platform_tax_paid_to_merchant: number
  platform_gross_receivable: number
  commission_fee: number
  delivery_fee: number
  processing_fee: number
  marketing_fee: number
  error_charge: number
  adjustment_amount: number
  tip_amount?: number
  net_payout: number
  toast_order_guid: string | null
  toast_display_number: string | null
  toast_tab_name: string | null
  toast_opened_at: string | null
  toast_dining_option?: string | null
  toast_net_sales: number
  toast_tax: number
  toast_expected_gross: number
  subtotal_variance?: number
  tax_variance?: number
  gross_variance?: number
  subtotal_diff?: number
  tax_diff?: number
  gross_diff?: number
  reconciliation_status: string
  match_confidence: string
  is_disputed: boolean
  dispute_status: string
  dispute_reason: string | null
  dispute_amount?: number
  dispute_notes: string | null
  items_summary?: Array<{ name: string; quantity: number; price: number }>
  raw_payload?: Record<string, any>
  // Enriched audit explanation fields from server
  action_group?: ActionGroup
  status_code?: string
  status_label_es?: string
  status_label_en?: string
  what_happened_es?: string
  what_happened_en?: string
  cause_es?: string
  cause_en?: string
  evidence_es?: string
  evidence_en?: string
  next_action_es?: string
  next_action_en?: string
  lifecycle_trace?: LifecycleStage[]
}

interface PlatformPayout {
  id: string
  store_id: number
  store_name: string
  store_code: string
  platform: DeliveryPlatform
  payout_reference_id: string
  period_start: string | null
  period_end: string | null
  payout_date: string | null
  orders_count: number
  linked_orders_count?: number
  coverage_complete?: boolean
  coverage_warning?: string | null
  subtotal_sales: number
  tax_collected: number
  tax_remitted_by_platform: number
  tax_paid_to_merchant: number
  platform_gross_receivable: number
  commission_fees: number
  delivery_fees: number
  processing_fees: number
  marketing_fees: number
  error_charges: number
  adjustments_amount: number
  tips_amount: number
  net_payout_amount: number
  toast_matched_orders_count: number
  toast_net_sales: number
  toast_tax_amount: number
  toast_expected_gross: number
  gross_variance: number
  bank_account_last4: string | null
  status: string
  source_type: string
  raw_payload?: Record<string, any>
}

interface StoreMapping {
  store_id: number
  store_code: string
  store_name: string
  toast_restaurant_guid: string
  doordash_store_id?: string | null
  doordash_merchant_store_id?: string | null
  grubhub_cust_id?: string | null
  grubhub_merchant_id?: string | null
  ubereats_store_uuid: string | null
}

const fmtMoney = (val: number | null | undefined) => {
  const n = Number(val || 0)
  const sign = n < -0.004 ? '-' : ''
  return `${sign}$${Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

const fmtDateMDY = (dateStr: string | null | undefined): string => {
  if (!dateStr) return '-'
  const raw = String(dateStr).trim()
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) {
    return `${m[2]}/${m[3]}/${m[1]}`
  }
  const d = new Date(raw)
  if (!isNaN(d.getTime())) {
    return d.toLocaleDateString('en-US', {
      timeZone: 'America/Los_Angeles',
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    })
  }
  return raw
}

const fmtLaTimestamp = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return (
    d.toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }) + ' PT'
  )
}

const getLaCurrentWeekBounds = (): { start: string; end: string } => {
  const nowLa = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
  const dayOfWeek = nowLa.getDay() // 0 = Sun, 1 = Mon ...
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const monday = new Date(nowLa)
  monday.setDate(nowLa.getDate() + diffToMonday)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const toYmd = (d: Date) => {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  return { start: toYmd(monday), end: toYmd(sunday) }
}

export default function ConciliarDeliveryPage() {
  const { t, language } = useLanguage()
  const isEn = language === 'en'

  // P1 #14: Inicializar dinámicamente en la semana actual de America/Los_Angeles (prohibido hardcodear octubre 2026)
  const initialWeek = useMemo(() => getLaCurrentWeekBounds(), [])
  const [startDate, setStartDate] = useState<string>(initialWeek.start)
  const [endDate, setEndDate] = useState<string>(initialWeek.end)
  const [activePreset, setActivePreset] = useState<'THIS_WEEK' | 'PREV_WEEK' | 'CURRENT_MONTH' | 'CUSTOM'>('THIS_WEEK')
  const [selectedStore, setSelectedStore] = useState<string>('ALL')
  const [selectedPlatform, setSelectedPlatform] = useState<string>('ALL')
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL')
  const [activePayoutRef, setActivePayoutRef] = useState<string>('')
  // P1 #13: Abrir por defecto en "Atención requerida" (orders), NO en QuickBooks
  const [selectedActionGroup, setSelectedActionGroup] = useState<'ALL' | ActionGroup>('ALL')
  const [selectedOrderSubFilter, setSelectedOrderSubFilter] = useState<
    'NONE' | 'WITH_PAYOUT_PENDING_REVIEW' | 'TOAST_ONLY'
  >('NONE')
  const [searchInput, setSearchInput] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [activeTab, setActiveTab] = useState<'orders' | 'qb_journals' | 'disputes' | 'payouts' | 'mappings'>('orders')
  const [cutsSubView, setCutsSubView] = useState<'qb' | 'bank'>('qb')
  const [ordersPage, setOrdersPage] = useState<number>(1)
  const [ordersPageSize, setOrdersPageSize] = useState<number>(100)
  const [showTaxRulesPopover, setShowTaxRulesPopover] = useState<boolean>(false)
  const [showAdvancedSupport, setShowAdvancedSupport] = useState<boolean>(false)
  const [currentUserLabel, setCurrentUserLabel] = useState<string>('Admin / Contador')

  // P1 #15: Control de secuencias y AbortController para evitar condiciones de carrera (race conditions)
  const fetchSeqRef = useRef<number>(0)
  const qbFetchSeqRef = useRef<number>(0)
  const fetchAbortRef = useRef<AbortController | null>(null)
  const qbAbortRef = useRef<AbortController | null>(null)

  const [loading, setLoading] = useState<boolean>(true)
  const [syncing, setSyncing] = useState<boolean>(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [bannerMessage, setBannerMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [mappings, setMappings] = useState<StoreMapping[]>([])
  const [orders, setOrders] = useState<ReconciledOrder[]>([])
  const [payouts, setPayouts] = useState<PlatformPayout[]>([])
  const [summary, setSummary] = useState<any>(null)
  const [syncStatus, setSyncStatus] = useState<any>(null)
  const [coverageReport, setCoverageReport] = useState<any>(null)

  // Estado Pólizas QuickBooks (Settlement Journal Entries)
  const [qbRecords, setQbRecords] = useState<any[]>([])
  const [qbSummary, setQbSummary] = useState<any>(null)
  const [qbLoading, setQbLoading] = useState<boolean>(false)
  const [qbAuthError, setQbAuthError] = useState<boolean>(false)
  const [qbReauthUrl, setQbReauthUrl] = useState<string>('/api/integrations/quickbooks/auth')
  const [qbNextDocNumber, setQbNextDocNumber] = useState<string>('20261060')
  const [qbQuickFilter, setQbQuickFilter] = useState<'ALL' | 'PENDING' | 'CREATED' | 'BLOCKED'>('ALL')
  const [selectedQbPayoutIds, setSelectedQbPayoutIds] = useState<Set<string>>(new Set())
  const [showBatchConfirmModal, setShowBatchConfirmModal] = useState<boolean>(false)
  const [publishingQb, setPublishingQb] = useState<boolean>(false)
  const [selectedQbRecord, setSelectedQbRecord] = useState<any | null>(null)
  const [jeModalDate, setJeModalDate] = useState<string>('')
  const [jeModalDocNumber, setJeModalDocNumber] = useState<string>('')
  const [jeModalSplitTax, setJeModalSplitTax] = useState<boolean>(false)
  const [qboCandidateReason, setQboCandidateReason] = useState<string>('')
  const [qboCandidateEvidence, setQboCandidateEvidence] = useState<string>('')
  const [resolvingQboCandidate, setResolvingQboCandidate] = useState<boolean>(false)

  // Modal de detalle de orden, trazabilidad de 4 etapas, disputa y resolución de revisión
  const [selectedOrder, setSelectedOrder] = useState<ReconciledOrder | null>(null)
  const [disputeStatusInput, setDisputeStatusInput] = useState<string>('NONE')
  const [disputeNotesInput, setDisputeNotesInput] = useState<string>('')
  const [reimbursementRefInput, setReimbursementRefInput] = useState<string>('')
  const [reimbursementAmountInput, setReimbursementAmountInput] = useState<string>('')
  const [reimbursementDateInput, setReimbursementDateInput] = useState<string>('')
  const [reimbursementDescInput, setReimbursementDescInput] = useState<string>('')
  const [savingDispute, setSavingDispute] = useState<boolean>(false)
  // P0 #5: UNASSIGNED_STORE inicia SIN tienda elegida (nunca preseleccionar Lynwood #14 ni otra)
  const [assignTargetStoreId, setAssignTargetStoreId] = useState<string>('')
  const [showAssignStoreConfirmModal, setShowAssignStoreConfirmModal] = useState<boolean>(false)

  // P0 #7: Estado de selección masiva por lote con separación estricta y modal de confirmación
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set())
  const [batchNotes, setBatchNotes] = useState<string>('')
  const [savingBatch, setSavingBatch] = useState<boolean>(false)
  const [batchOrderConfirmModal, setBatchOrderConfirmModal] = useState<{
    open: boolean
    actionType: 'APPROVE_VARIANCE' | 'MARK_DISPUTE_SUBMITTED'
  } | null>(null)

  // Modal de importación CSV / JSON
  const [showImportModal, setShowImportModal] = useState<boolean>(false)
  const [importPlatform, setImportPlatform] = useState<'AUTO' | DeliveryPlatform>('AUTO')
  const [importText, setImportText] = useState<string>('')
  const [importFileName, setImportFileName] = useState<string>('')
  const [importing, setImporting] = useState<boolean>(false)
  const [confirmImportStoreAssignment, setConfirmImportStoreAssignment] = useState<boolean>(false)

  useEffect(() => {
    try {
      const rawUser = typeof window !== 'undefined' ? localStorage.getItem('teg_user') : null
      if (rawUser) {
        const parsed = JSON.parse(rawUser)
        const label = parsed?.name || parsed?.email || parsed?.username
        if (label) setCurrentUserLabel(`${label} (${parsed?.role || 'admin'})`)
      }
    } catch {}
  }, [])

  // P1 #15: Debounce de 300ms en búsqueda
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(searchInput.trim())
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  // P1 #15: Limpiar selección de payouts y órdenes siempre que cambien filtros, tienda, plataforma, fechas o búsqueda
  useEffect(() => {
    setSelectedQbPayoutIds(new Set())
    setSelectedOrderIds(new Set())
    setShowBatchConfirmModal(false)
    setBatchOrderConfirmModal(null)
    setOrdersPage(1)
  }, [selectedStore, selectedPlatform, selectedStatus, startDate, endDate, searchQuery, qbQuickFilter, activePayoutRef, selectedActionGroup])

  const authFetch = useCallback((url: string, init?: RequestInit) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null
    const headers = new Headers(init?.headers || {})
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`)
    }
    return fetch(url, {
      ...init,
      credentials: 'include',
      headers,
    })
  }, [])

  const isDateRangeValid = useMemo(() => {
    if (!startDate || !endDate) return false
    return endDate >= startDate
  }, [startDate, endDate])

  const fetchData = useCallback(async () => {
    if (!isDateRangeValid) {
      setFetchError(t('deliveryReconciliation.date_range_invalid_error'))
      return
    }
    fetchAbortRef.current?.abort()
    const controller = new AbortController()
    fetchAbortRef.current = controller
    const seq = ++fetchSeqRef.current

    setLoading(true)
    setFetchError(null)
    setSelectedQbPayoutIds(new Set())
    setSelectedOrderIds(new Set())
    try {
      const qs = new URLSearchParams({
        store_id: selectedStore,
        platform: selectedPlatform,
        status: selectedStatus,
        start_date: startDate,
        end_date: endDate,
        search: searchQuery,
      })
      if (activePayoutRef) {
        qs.set('payout_reference_id', activePayoutRef)
      }
      const res = await authFetch(`/api/delivery-reconciliation?${qs.toString()}`, {
        signal: controller.signal,
      })
      const data = await res.json()
      if (seq !== fetchSeqRef.current) return
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      setMappings(data.mappings || [])
      setOrders(data.orders || [])
      setPayouts(data.payouts || [])
      setSummary(data.summary || null)
      setSyncStatus(data.syncStatus || null)
      setCoverageReport(data.coverageReport || null)
    } catch (err: any) {
      if (err?.name === 'AbortError' || seq !== fetchSeqRef.current) return
      console.error('Error loading delivery reconciliation:', err)
      setFetchError(err.message || 'Error de conexión al cargar conciliación')
    } finally {
      if (seq === fetchSeqRef.current) {
        setLoading(false)
      }
    }
  }, [selectedStore, selectedPlatform, selectedStatus, startDate, endDate, searchQuery, activePayoutRef, authFetch, isDateRangeValid, t])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const fetchQbJournalRecords = useCallback(async () => {
    if (!isDateRangeValid) return
    qbAbortRef.current?.abort()
    const controller = new AbortController()
    qbAbortRef.current = controller
    const seq = ++qbFetchSeqRef.current

    setQbLoading(true)
    setSelectedQbPayoutIds(new Set())
    try {
      const qs = new URLSearchParams({
        store_id: selectedStore,
        platform: selectedPlatform,
        status: selectedStatus,
        start_date: startDate,
        end_date: endDate,
      })
      if (searchQuery.trim()) qs.set('search', searchQuery.trim())
      const res = await authFetch(`/api/delivery-reconciliation/quickbooks-journal?${qs.toString()}`, {
        signal: controller.signal,
      })
      const data = await res.json()
      if (seq !== qbFetchSeqRef.current) return
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      setQbRecords(data.records || [])
      setQbSummary(data.summary || null)
      setQbAuthError(Boolean(data.isAuthError))
      if (data.reauthUrl) setQbReauthUrl(data.reauthUrl)
      if (data.nextSuggestedDocNumber) setQbNextDocNumber(data.nextSuggestedDocNumber)
    } catch (err: any) {
      if (err?.name === 'AbortError' || seq !== qbFetchSeqRef.current) return
      console.error('Error loading QB Journal Entries:', err)
      setFetchError((prev) => prev || err.message || 'Error al cargar pólizas de QuickBooks')
    } finally {
      if (seq === qbFetchSeqRef.current) {
        setQbLoading(false)
      }
    }
  }, [selectedStore, selectedPlatform, selectedStatus, startDate, endDate, searchQuery, authFetch, isDateRangeValid])

  useEffect(() => {
    fetchQbJournalRecords()
  }, [fetchQbJournalRecords])

  const handleQuickBooksReauth = () => {
    const authWindow = window.open(qbReauthUrl, 'QuickBooksAuth', 'width=600,height=700')
    const handleMessage = (event: MessageEvent) => {
      if (event.data === 'qb_authorized') {
        window.removeEventListener('message', handleMessage)
        setQbAuthError(false)
        fetchQbJournalRecords()
      }
    }
    window.addEventListener('message', handleMessage)
    const timer = setInterval(() => {
      if (authWindow?.closed) {
        clearInterval(timer)
        window.removeEventListener('message', handleMessage)
        fetchQbJournalRecords()
      }
    }, 1000)
  }

  const handleOpenQbModal = (rec: any) => {
    setSelectedQbRecord(rec)
    setJeModalDate(rec.qbJournalEntry?.txnDate || rec.journalPreview?.txnDate || rec.period_end || rec.payout_date || '')
    setJeModalDocNumber(rec.qbJournalEntry?.docNumber || qbNextDocNumber || '')
    setJeModalSplitTax(false)
    const firstCand = rec.qboMatchEvaluation?.candidates?.[0]
    setQboCandidateReason('')
    setQboCandidateEvidence(
      firstCand
        ? `QBO JE #${firstCand.docNumber || firstCand.id} (${firstCand.txnDate}) • $${Number(firstCand.bankDebitAmount || 0).toFixed(2)}`
        : ''
    )
  }

  const handleResolveHistoricalQboCandidate = async (params: {
    payoutId: string
    jeId: string
    docNumber?: string
    txnDate?: string
    decision: 'confirm_qbo_candidate' | 'discard_qbo_candidate'
  }) => {
    if (qboCandidateReason.trim().length < 5) {
      setBannerMessage({
        type: 'error',
        text: isEn
          ? 'Please enter an explicit reason (at least 5 characters) to confirm or discard the historical QBO entry.'
          : 'Debe ingresar un motivo explícito (mínimo 5 caracteres) para confirmar o descartar la póliza histórica de QBO.',
      })
      return
    }
    if (qboCandidateEvidence.trim().length < 3) {
      setBannerMessage({
        type: 'error',
        text: isEn
          ? 'Please enter verifiable evidence (e.g. DocNumber, date, or bank reference).'
          : 'Debe ingresar evidencia verificable (ej. DocNumber, fecha o referencia bancaria).',
      })
      return
    }
    setResolvingQboCandidate(true)
    setBannerMessage(null)
    try {
      const res = await authFetch('/api/delivery-reconciliation/quickbooks-journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: params.decision,
          payoutId: params.payoutId,
          jeId: params.jeId,
          docNumber: params.docNumber,
          txnDate: params.txnDate,
          reason: qboCandidateReason.trim(),
          evidence: qboCandidateEvidence.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Error al resolver candidato de póliza QBO')
      }
      setBannerMessage({
        type: 'success',
        text:
          params.decision === 'confirm_qbo_candidate'
            ? isEn
              ? `Historical QBO Journal Entry #${params.docNumber || params.jeId} confirmed and linked.`
              : `Póliza histórica QBO #${params.docNumber || params.jeId} confirmada y vinculada al corte.`
            : isEn
            ? `Candidate QBO entry #${params.docNumber || params.jeId} discarded with audit log.`
            : `Candidato QBO #${params.docNumber || params.jeId} descartado con registro de auditoría.`,
      })
      setSelectedQbRecord(null)
      await Promise.all([fetchData(), fetchQbJournalRecords()])
    } catch (err: any) {
      setBannerMessage({ type: 'error', text: err.message })
    } finally {
      setResolvingQboCandidate(false)
    }
  }

  const handleVerifyQboRecoveryStatus = async (payoutId: string) => {
    setResolvingQboCandidate(true)
    setBannerMessage(null)
    try {
      const res = await authFetch('/api/delivery-reconciliation/quickbooks-journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'verify_recovery_status',
          payoutId,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Error al verificar estado de recuperación en QuickBooks Online')
      }
      setBannerMessage({
        type: 'success',
        text:
          data.outcome === 'RECOVERED_EXISTING_IN_QBO'
            ? isEn
              ? `Recovered existing QBO Journal Entry #${data.journalEntry?.docNumber || data.journalEntry?.id}.`
              : `Se recuperó y vinculó la póliza existente en QBO #${data.journalEntry?.docNumber || data.journalEntry?.id}.`
            : data.outcome === 'CANDIDATES_FOUND_REQUIRE_CONFIRMATION'
            ? isEn
              ? 'Candidate QBO entries found; please confirm or discard in the settlement detail.'
              : 'Se encontraron pólizas candidatas en QBO; confirme o descarte en el detalle del corte.'
            : isEn
            ? 'Verified absent in QBO: settlement unlocked for safe retry.'
            : 'Verificado ausente en QBO: corte desbloqueado para reintento seguro.',
      })
      setSelectedQbRecord(null)
      await Promise.all([fetchData(), fetchQbJournalRecords()])
    } catch (err: any) {
      setBannerMessage({ type: 'error', text: err.message })
    } finally {
      setResolvingQboCandidate(false)
    }
  }

  const displayedQbRecords = useMemo(() => {
    if (qbQuickFilter === 'PENDING') return qbRecords.filter((r) => !r.hasJournalEntry && r.canPublish)
    if (qbQuickFilter === 'BLOCKED') return qbRecords.filter((r) => !r.hasJournalEntry && !r.canPublish)
    if (qbQuickFilter === 'CREATED') return qbRecords.filter((r) => r.hasJournalEntry)
    return qbRecords
  }, [qbRecords, qbQuickFilter])

  // P1 #15: Prohibido publicar ítems ocultos por filtros o bloqueados
  const selectedVisiblePublishableRecords = useMemo(() => {
    return displayedQbRecords.filter(
      (r) => selectedQbPayoutIds.has(r.id) && !r.hasJournalEntry && r.canPublish
    )
  }, [displayedQbRecords, selectedQbPayoutIds])

  const handlePublishQbJournalEntries = async (
    payoutIdsToCreate: string[],
    options?: { txnDate?: string; docNumber?: string; splitTaxOnRefunds?: boolean }
  ) => {
    if (payoutIdsToCreate.length === 0) return
    setPublishingQb(true)
    setBannerMessage(null)
    try {
      const res = await authFetch('/api/delivery-reconciliation/quickbooks-journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payoutIds: payoutIdsToCreate,
          txnDate: options?.txnDate,
          docNumber: options?.docNumber,
          splitTaxOnRefunds: Boolean(options?.splitTaxOnRefunds),
        }),
      })
      const data = await res.json()
      if (data.isAuthError) {
        setQbAuthError(true)
        if (data.reauthUrl) setQbReauthUrl(data.reauthUrl)
        throw new Error(data.error || 'Sesión de QuickBooks expirada.')
      }
      if (data.recoveryRequired) {
        const recErr = data.results?.find((r: any) => r.recoveryRequired)?.error
        setBannerMessage({
          type: 'error',
          text: recErr || 'Estado de recuperación requerido: verifica en QuickBooks antes de reintentar.',
        })
        setShowBatchConfirmModal(false)
        await fetchQbJournalRecords()
        return
      }
      if (!data.success) {
        const firstErr = data.results?.find((r: any) => !r.success)?.error
        throw new Error(firstErr || data.error || 'Error al publicar Journal Entry en QuickBooks Online')
      }
      const createdList = (data.results || [])
        .filter((r: any) => r.success)
        .map((r: any) => `#${r.journalEntry?.docNumber} (${r.storeName} - ${r.platform} #${r.payoutRef})`)
        .join(', ')
      setBannerMessage({
        type: 'success',
        text: t('deliveryReconciliation.qb_published_toast', { list: createdList }),
      })
      setSelectedQbPayoutIds(new Set())
      setShowBatchConfirmModal(false)
      setSelectedQbRecord(null)
      await fetchQbJournalRecords()
    } catch (err: any) {
      setBannerMessage({ type: 'error', text: err.message })
    } finally {
      setPublishingQb(false)
    }
  }

  const handleLiveSyncForStore = async (override?: {
    storeId?: string
    platform?: string
    startDate?: string
    endDate?: string
    payoutRef?: string
    openOrdersTab?: boolean
  }) => {
    const targetStore = override?.storeId || selectedStore
    const targetPlatform = override?.platform || selectedPlatform
    const targetStart = override?.startDate || startDate
    const targetEnd = override?.endDate || endDate
    const targetPayoutRef = override?.payoutRef !== undefined ? override.payoutRef : activePayoutRef

    if (!targetStart || !targetEnd || targetEnd < targetStart) {
      const msg = t('deliveryReconciliation.date_range_invalid_error')
      setFetchError(msg)
      setBannerMessage({ type: 'error', text: msg })
      return
    }

    if (override?.storeId) setSelectedStore(override.storeId)
    if (override?.platform) setSelectedPlatform(override.platform)
    if (override?.startDate) setStartDate(override.startDate)
    if (override?.endDate) setEndDate(override.endDate)
    if (override?.payoutRef !== undefined) {
      setActivePayoutRef(override.payoutRef)
      setSearchInput('')
      setSearchQuery('')
    }
    if (override?.openOrdersTab) {
      setSelectedActionGroup('ALL')
      setActiveTab('orders')
    }

    setSyncing(true)
    setBannerMessage(null)
    setFetchError(null)
    try {
      const res = await authFetch('/api/delivery-reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'sync_live',
          store_id: targetStore,
          platform: targetPlatform,
          payout_reference_id: targetPayoutRef || undefined,
          start_date: targetStart,
          end_date: targetEnd,
          sync_toast: true,
          sync_grubhub: targetPlatform === 'ALL' || targetPlatform === 'GRUBHUB',
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Sync failed')
      }
      const syncErrors: string[] = Array.isArray(data.syncErrors) ? data.syncErrors : []
      const baseMsg = t('deliveryReconciliation.sync_success_msg', {
        toastCount: data.toastOrdersSynced || 0,
        ghOrders: data.platformOrdersSynced || 0,
        ghPayouts: data.payoutsSynced || 0,
      })
      setBannerMessage({
        type: syncErrors.length > 0 ? 'error' : 'success',
        text:
          syncErrors.length > 0
            ? `${baseMsg} ⚠️ (${syncErrors.length} advertencia(s)/fallo(s): ${syncErrors.slice(0, 2).join(' | ')})`
            : baseMsg,
      })
      await Promise.all([fetchData(), fetchQbJournalRecords()])
    } catch (err: any) {
      setFetchError(err.message)
      setBannerMessage({ type: 'error', text: err.message })
    } finally {
      setSyncing(false)
    }
  }

  const handleLiveSync = () => handleLiveSyncForStore()

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportFileName(file.name)
    const reader = new FileReader()
    reader.onload = (ev) => {
      setImportText(String(ev.target?.result || ''))
    }
    reader.readAsText(file)
  }

  const handleProcessImport = async () => {
    if (!importText.trim()) return
    setImporting(true)
    setBannerMessage(null)
    try {
      const res = await authFetch('/api/delivery-reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'import_report',
          raw_content: importText,
          platform: importPlatform,
          store_id: selectedStore,
          confirm_store_assignment: confirmImportStoreAssignment,
          start_date: startDate,
          end_date: endDate,
          sync_toast: true,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Import failed')
      }
      setBannerMessage({
        type: 'success',
        text: t('deliveryReconciliation.import_success_msg', {
          orders: data.importedOrdersCount || 0,
          payouts: data.importedPayoutsCount || 0,
        }),
      })
      setShowImportModal(false)
      setImportText('')
      setImportFileName('')
      setConfirmImportStoreAssignment(false)
      await Promise.all([fetchData(), fetchQbJournalRecords()])
    } catch (err: any) {
      setBannerMessage({ type: 'error', text: err.message })
    } finally {
      setImporting(false)
    }
  }

  const handleOpenOrderModal = (ord: ReconciledOrder) => {
    setSelectedOrder(ord)
    // P0 #5: Siempre iniciar sin tienda destino seleccionada (jamás preseleccionar Lynwood #14)
    setAssignTargetStoreId('')
    setShowAssignStoreConfirmModal(false)
    setDisputeStatusInput(ord.dispute_status || 'NONE')
    setDisputeNotesInput(ord.dispute_notes || ord.raw_payload?.variance_approval?.reason || '')
    setReimbursementRefInput(ord.raw_payload?.reimbursement_payout_ref || '')
    setReimbursementAmountInput(
      ord.raw_payload?.reimbursement_amount !== undefined && ord.raw_payload?.reimbursement_amount !== null
        ? String(ord.raw_payload.reimbursement_amount)
        : ''
    )
    setReimbursementDateInput(ord.raw_payload?.reimbursement_deposit_date || '')
    setReimbursementDescInput(ord.raw_payload?.reimbursement_description || '')
  }

  const isReimbursedFormValid = useMemo(() => {
    if (disputeStatusInput !== 'REIMBURSED') return true
    const hasRef = reimbursementRefInput.trim().length > 0
    const amt = Number(reimbursementAmountInput)
    const hasAmt = Number.isFinite(amt) && amt > 0
    const hasDate = /^\d{4}-\d{2}-\d{2}$/.test(reimbursementDateInput.trim())
    const hasNote = (reimbursementDescInput.trim() || disputeNotesInput.trim()).length >= 5
    return hasRef && hasAmt && hasDate && hasNote
  }, [disputeStatusInput, reimbursementRefInput, reimbursementAmountInput, reimbursementDateInput, reimbursementDescInput, disputeNotesInput])

  const handleSaveDispute = async () => {
    if (!selectedOrder) return
    if (!isReimbursedFormValid) {
      setBannerMessage({
        type: 'error',
        text: t('deliveryReconciliation.reimbursed_validation_error'),
      })
      return
    }
    setSavingDispute(true)
    try {
      const statusMap: Record<string, string> = {
        NONE: 'NONE',
        NEEDS_DISPUTE: 'OPEN',
        OPEN: 'OPEN',
        SUBMITTED: 'SUBMITTED',
        APPROVED: 'APPROVED',
        REIMBURSED: 'REIMBURSED',
        DENIED: 'REJECTED',
        REJECTED: 'REJECTED',
      }
      const normalizedStatus = statusMap[disputeStatusInput] || 'OPEN'
      const res = await authFetch('/api/delivery-reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_dispute',
          id: selectedOrder.id,
          dispute_status: normalizedStatus,
          dispute_notes: disputeNotesInput,
          dispute_reason: selectedOrder.dispute_reason,
          reimbursement_payout_ref: reimbursementRefInput.trim() || undefined,
          reimbursement_amount: reimbursementAmountInput.trim()
            ? Number(reimbursementAmountInput)
            : undefined,
          reimbursement_deposit_date: reimbursementDateInput.trim() || undefined,
          reimbursement_description: reimbursementDescInput.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Error guardando disputa')
      }
      setSelectedOrder(null)
      await Promise.all([fetchData(), fetchQbJournalRecords()])
    } catch (err: any) {
      setBannerMessage({ type: 'error', text: err.message })
    } finally {
      setSavingDispute(false)
    }
  }

  const handleApproveReviewOrder = async (ord: ReconciledOrder, candidateToastGuid?: string) => {
    if (!candidateToastGuid && disputeNotesInput.trim().length < 5) {
      setBannerMessage({
        type: 'error',
        text: t('deliveryReconciliation.variance_reason_required_error'),
      })
      return
    }
    setSavingDispute(true)
    try {
      const res = await authFetch('/api/delivery-reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'resolve_review_order',
          id: ord.id,
          review_decision: candidateToastGuid ? 'CONFIRM_TOAST_MATCH' : 'APPROVE_VARIANCE',
          selected_toast_guid: candidateToastGuid,
          review_notes: disputeNotesInput.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'No se pudo aprobar la revisión')
      }
      setSelectedOrder(null)
      await Promise.all([fetchData(), fetchQbJournalRecords()])
    } catch (err: any) {
      setBannerMessage({ type: 'error', text: err.message })
    } finally {
      setSavingDispute(false)
    }
  }

  const handleAssignUnassignedStore = async (ord: ReconciledOrder) => {
    if (!assignTargetStoreId) return
    setSavingDispute(true)
    try {
      const res = await authFetch('/api/delivery-reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'assign_unassigned_store',
          target_store_id: Number(assignTargetStoreId),
          platform: ord.platform,
          reference_id: ord.payout_reference_id || ord.platform_order_id,
          confirm_store_assignment: true,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'No se pudo asignar la sucursal')
      }
      setShowAssignStoreConfirmModal(false)
      setSelectedOrder(null)
      await Promise.all([fetchData(), fetchQbJournalRecords()])
    } catch (err: any) {
      setBannerMessage({ type: 'error', text: err.message })
    } finally {
      setSavingDispute(false)
    }
  }

  const handleBatchApproveVariance = async (orderIds: string[]) => {
    const validIds = orderIds.filter((id) => !id.startsWith('UNASSIGNED-'))
    if (validIds.length === 0) return
    if (batchNotes.trim().length < 5) {
      setBannerMessage({
        type: 'error',
        text: t('deliveryReconciliation.variance_reason_required_error'),
      })
      return
    }
    setSavingBatch(true)
    setBannerMessage(null)
    try {
      const res = await authFetch('/api/delivery-reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'batch_resolve_review',
          order_ids: validIds,
          review_decision: 'APPROVE_VARIANCE',
          review_notes: batchNotes.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Error al aprobar varianzas en lote')
      }
      setBannerMessage({
        type: 'success',
        text: t('deliveryReconciliation.batch_success_msg', { count: data.updatedCount || validIds.length }),
      })
      setSelectedOrderIds(new Set())
      setBatchNotes('')
      setBatchOrderConfirmModal(null)
      await Promise.all([fetchData(), fetchQbJournalRecords()])
    } catch (err: any) {
      setBannerMessage({ type: 'error', text: err.message })
    } finally {
      setSavingBatch(false)
    }
  }

  const handleBatchMarkDisputeSubmitted = async (orderIds: string[]) => {
    const validIds = orderIds.filter((id) => !id.startsWith('UNASSIGNED-'))
    if (validIds.length === 0) return
    setSavingBatch(true)
    setBannerMessage(null)
    try {
      const res = await authFetch('/api/delivery-reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'batch_update_disputes',
          order_ids: validIds,
          dispute_status: 'SUBMITTED',
          dispute_notes: batchNotes.trim() || 'Disputa presentada en portal de plataforma (actualización en lote)',
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Error al actualizar estado de disputas en lote')
      }
      setBannerMessage({
        type: 'success',
        text: t('deliveryReconciliation.batch_success_msg', { count: data.updatedCount || validIds.length }),
      })
      setSelectedOrderIds(new Set())
      setBatchNotes('')
      setBatchOrderConfirmModal(null)
      await Promise.all([fetchData(), fetchQbJournalRecords()])
    } catch (err: any) {
      setBannerMessage({ type: 'error', text: err.message })
    } finally {
      setSavingBatch(false)
    }
  }

  const handleExportBatchEvidencePackage = (targetOrders: ReconciledOrder[]) => {
    if (targetOrders.length === 0) return
    const headers = [
      'Business Date',
      'Store',
      'Platform',
      'Platform Order ID',
      'Toast Check #',
      'Toast Tab Name',
      'Toast Net Sales',
      'Toast Tax',
      'Toast Expected Gross',
      'Platform Subtotal',
      'Platform Tax to Merchant (24001)',
      'Platform Tax Withheld (12050)',
      'Platform Gross Receivable',
      'Error Charge / Deduction',
      'Net Payout',
      'Original Deduction Payout Ref',
      'Dispute Status',
      'Dispute Reason',
      'Recovery Payout Ref',
      'Recovery Amount',
      'Items Summary (Toast POS)',
      'Audit Evidence',
    ]
    const csvLines = [
      headers.join(','),
      ...targetOrders.map((o) => {
        const itemsText = Array.isArray(o.items_summary)
          ? o.items_summary.map((it: any) => `${it.quantity || 1}x ${it.name} ($${Number(it.price || 0).toFixed(2)})`).join(' | ')
          : ''
        return [
          fmtDateMDY(o.business_date),
          `"${o.store_name}"`,
          o.platform,
          `"${o.platform_order_id}"`,
          `"${o.toast_display_number || ''}"`,
          `"${(o.toast_tab_name || '').replace(/"/g, '""')}"`,
          Number(o.toast_net_sales || 0).toFixed(2),
          Number(o.toast_tax || 0).toFixed(2),
          Number(o.toast_expected_gross || 0).toFixed(2),
          Number(o.platform_subtotal || 0).toFixed(2),
          Number(o.platform_tax_paid_to_merchant || 0).toFixed(2),
          Number(o.platform_tax_withheld || 0).toFixed(2),
          Number(o.platform_gross_receivable || 0).toFixed(2),
          Number(o.error_charge || 0).toFixed(2),
          Number(o.net_payout || 0).toFixed(2),
          `"${o.payout_reference_id || ''}"`,
          `"${o.dispute_status || 'NONE'}"`,
          `"${(o.dispute_reason || '').replace(/"/g, '""')}"`,
          `"${o.raw_payload?.reimbursement_payout_ref || ''}"`,
          Number(o.raw_payload?.reimbursement_amount || 0).toFixed(2),
          `"${itemsText.replace(/"/g, '""')}"`,
          `"${((isEn ? o.evidence_en : o.evidence_es) || '').replace(/"/g, '""')}"`,
        ].join(',')
      }),
    ]
    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `TacosGavilan_Dispute_Evidence_Package_${startDate}_${endDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleExportCsv = () => {
    if (orders.length === 0) return
    const headers = [
      'Business Date',
      'Store',
      'Platform',
      'Action Group',
      'Status Label',
      'Platform Order ID',
      'Toast Order #',
      'Toast Net Sales',
      'Toast Tax',
      'Toast Expected Gross',
      'Platform Subtotal',
      'Platform Tax Passed to TEG (24001)',
      'Platform Tax Withheld (12050)',
      'Platform Gross Receivable',
      'Total Fees',
      'Error Charge / Adj',
      'Net Payout',
      'Gross Variance',
      'What Happened',
      'Cause',
      'Evidence',
      'Next Action',
      'Payout Reference ID',
      'Reimbursement Payout Ref',
    ]
    const csvLines = [
      headers.join(','),
      ...orders.map((o) => {
        const varVal = Number(o.gross_variance ?? o.gross_diff ?? 0)
        const feesVal =
          Number(o.commission_fee || 0) +
          Number(o.delivery_fee || 0) +
          Number(o.processing_fee || 0) +
          Number(o.marketing_fee || 0)
        return [
          fmtDateMDY(o.business_date),
          `"${o.store_name}"`,
          o.platform,
          o.action_group || '',
          `"${(isEn ? o.status_label_en : o.status_label_es) || o.reconciliation_status}"`,
          `"${o.platform_order_id}"`,
          `"${o.toast_display_number || ''}"`,
          Number(o.toast_net_sales || 0).toFixed(2),
          Number(o.toast_tax || 0).toFixed(2),
          Number(o.toast_expected_gross || 0).toFixed(2),
          Number(o.platform_subtotal || 0).toFixed(2),
          Number(o.platform_tax_paid_to_merchant || 0).toFixed(2),
          Number(o.platform_tax_withheld || 0).toFixed(2),
          Number(o.platform_gross_receivable || 0).toFixed(2),
          feesVal.toFixed(2),
          (Number(o.error_charge || 0) + Number(o.adjustment_amount || 0)).toFixed(2),
          Number(o.net_payout || 0).toFixed(2),
          varVal.toFixed(2),
          `"${((isEn ? o.what_happened_en : o.what_happened_es) || '').replace(/"/g, '""')}"`,
          `"${((isEn ? o.cause_en : o.cause_es) || '').replace(/"/g, '""')}"`,
          `"${((isEn ? o.evidence_en : o.evidence_es) || '').replace(/"/g, '""')}"`,
          `"${((isEn ? o.next_action_en : o.next_action_es) || '').replace(/"/g, '""')}"`,
          `"${o.payout_reference_id || ''}"`,
          `"${o.raw_payload?.reimbursement_payout_ref || ''}"`,
        ].join(',')
      }),
    ]
    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `conciliacion_delivery_${startDate}_${endDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Agrupación de órdenes en los 4 grupos mutuamente claros
  const group1Conciliated = useMemo(
    () => orders.filter((o) => o.action_group === 'CONCILIATED_READY'),
    [orders]
  )
  const group2Variance = useMemo(
    () => orders.filter((o) => o.action_group === 'VARIANCE_INVESTIGATE'),
    [orders]
  )
  const group3Disputes = useMemo(
    () => orders.filter((o) => o.action_group === 'DISPUTE_RECOVERY'),
    [orders]
  )
  const group4Blocked = useMemo(
    () => orders.filter((o) => o.action_group === 'BLOCKED_MISSING_INFO'),
    [orders]
  )
  const withPayoutPendingReviewOrders = useMemo(
    () =>
      orders.filter(
        (o) =>
          o.match_confidence !== 'TOAST_ONLY' &&
          o.reconciliation_status !== 'MISSING_IN_PLATFORM' &&
          o.action_group !== 'CONCILIATED_READY'
      ),
    [orders]
  )
  const toastOnlyOrders = useMemo(
    () =>
      orders.filter(
        (o) => o.match_confidence === 'TOAST_ONLY' || o.reconciliation_status === 'MISSING_IN_PLATFORM'
      ),
    [orders]
  )

  const displayedOrders = useMemo(() => {
    if (selectedOrderSubFilter === 'WITH_PAYOUT_PENDING_REVIEW') return withPayoutPendingReviewOrders
    if (selectedOrderSubFilter === 'TOAST_ONLY') return toastOnlyOrders
    if (selectedActionGroup === 'CONCILIATED_READY') return group1Conciliated
    if (selectedActionGroup === 'VARIANCE_INVESTIGATE') return group2Variance
    if (selectedActionGroup === 'DISPUTE_RECOVERY') return group3Disputes
    if (selectedActionGroup === 'BLOCKED_MISSING_INFO') return group4Blocked
    return orders
  }, [
    orders,
    selectedOrderSubFilter,
    withPayoutPendingReviewOrders,
    toastOnlyOrders,
    selectedActionGroup,
    group1Conciliated,
    group2Variance,
    group3Disputes,
    group4Blocked,
  ])

  const totalOrderPages = useMemo(
    () => Math.max(1, Math.ceil(displayedOrders.length / ordersPageSize)),
    [displayedOrders.length, ordersPageSize]
  )

  const safeOrdersPage = Math.min(ordersPage, totalOrderPages)

  const paginatedOrders = useMemo(() => {
    const startIdx = (safeOrdersPage - 1) * ordersPageSize
    return displayedOrders.slice(startIdx, startIdx + ordersPageSize)
  }, [displayedOrders, safeOrdersPage, ordersPageSize])

  const selectedVisibleOrders = useMemo(() => {
    return displayedOrders.filter((o) => selectedOrderIds.has(o.id))
  }, [displayedOrders, selectedOrderIds])

  const applyDynamicDatePreset = (preset: 'THIS_WEEK' | 'PREV_WEEK' | 'CURRENT_MONTH' | 'CUSTOM') => {
    setActivePayoutRef('')
    setActivePreset(preset)
    if (preset === 'CUSTOM') return
    const nowLa = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
    )
    const toYmd = (d: Date) => {
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      return `${y}-${m}-${day}`
    }
    const dayOfWeek = nowLa.getDay()
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
    if (preset === 'THIS_WEEK') {
      const monday = new Date(nowLa)
      monday.setDate(nowLa.getDate() + diffToMonday)
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      setStartDate(toYmd(monday))
      setEndDate(toYmd(sunday))
    } else if (preset === 'PREV_WEEK') {
      const monday = new Date(nowLa)
      monday.setDate(nowLa.getDate() + diffToMonday - 7)
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      setStartDate(toYmd(monday))
      setEndDate(toYmd(sunday))
    } else if (preset === 'CURRENT_MONTH') {
      const start = new Date(nowLa.getFullYear(), nowLa.getMonth(), 1)
      const end = new Date(nowLa.getFullYear(), nowLa.getMonth() + 1, 0)
      setStartDate(toYmd(start))
      setEndDate(toYmd(end))
    }
  }

  // P0 #7: Separar selección según acción: solo VARIANCE_INVESTIGATE o DISPUTE_RECOVERY, sin mezclar
  const activeSelectedBatchGroup = useMemo<'VARIANCE_INVESTIGATE' | 'DISPUTE_RECOVERY' | null>(() => {
    if (selectedVisibleOrders.length === 0) return null
    const groups = new Set(selectedVisibleOrders.map((o) => o.action_group))
    if (groups.size === 1 && groups.has('VARIANCE_INVESTIGATE')) return 'VARIANCE_INVESTIGATE'
    if (groups.size === 1 && groups.has('DISPUTE_RECOVERY')) return 'DISPUTE_RECOVERY'
    return null
  }, [selectedVisibleOrders])

  const canSelectOrderForBatch = useCallback(
    (ord: ReconciledOrder): boolean => {
      if (ord.id.startsWith('UNASSIGNED-') || ord.store_id <= 0) return false
      if (ord.action_group !== 'VARIANCE_INVESTIGATE' && ord.action_group !== 'DISPUTE_RECOVERY') {
        return false
      }
      if (activeSelectedBatchGroup && ord.action_group !== activeSelectedBatchGroup) {
        return false
      }
      return true
    },
    [activeSelectedBatchGroup]
  )

  const activeStoreLabel = useMemo(() => {
    if (selectedStore === 'ALL') return t('deliveryReconciliation.all_stores')
    if (selectedStore === '0') return t('deliveryReconciliation.unassigned_store_option')
    const found = mappings.find((m) => String(m.store_id) === String(selectedStore))
    return found ? `${found.store_name} (${found.store_code})` : `#${selectedStore}`
  }, [selectedStore, mappings, t])

  const getStorePlatformCoverageEntry = useCallback(
    (storeId: number, platform: DeliveryPlatform) => {
      const matrix = coverageReport?.storePlatformMatrix || syncStatus?.storePlatformCoverage || []
      if (Array.isArray(matrix)) {
        const match = matrix.find(
          (item: any) => Number(item.store_id ?? item.storeId) === Number(storeId) && item.platform === platform
        )
        if (match) {
          return {
            status: match.status || 'NOT_CONNECTED',
            orders_count: match.orders_count ?? match.ordersCount ?? 0,
            payouts_count: match.payouts_count ?? match.payoutsCount ?? 0,
            last_sync_at: match.last_sync_at ?? match.lastSyncAt ?? null,
            cause_es: match.cause_es ?? match.causeEs ?? '',
            cause_en: match.cause_en ?? match.causeEn ?? '',
            next_action_es: match.next_action_es ?? match.nextActionEs ?? '',
            next_action_en: match.next_action_en ?? match.nextActionEn ?? '',
          }
        }
      }
      const stSync = syncStatus?.byStore?.[storeId]
      const ordersCount =
        platform === 'DOORDASH'
          ? stSync?.ddOrders || 0
          : platform === 'GRUBHUB'
          ? stSync?.ghOrders || 0
          : stSync?.ueOrders || 0
      const payoutsCount =
        platform === 'DOORDASH'
          ? stSync?.ddPayouts || 0
          : platform === 'GRUBHUB'
          ? stSync?.ghPayouts || 0
          : stSync?.uePayouts || 0
      const lastSyncAt =
        platform === 'DOORDASH'
          ? stSync?.ddLastSync || null
          : platform === 'GRUBHUB'
          ? stSync?.ghLastSync || null
          : stSync?.ueLastSync || null
      return {
        status: ordersCount > 0 || payoutsCount > 0 ? 'COMPLETE' : 'NOT_CONNECTED',
        orders_count: ordersCount,
        payouts_count: payoutsCount,
        last_sync_at: lastSyncAt,
        cause_es: '',
        cause_en: '',
        next_action_es: '',
        next_action_en: '',
      }
    },
    [coverageReport, syncStatus]
  )

  const renderPlatformBadge = (platform: DeliveryPlatform) => {
    if (platform === 'DOORDASH') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30">
          DoorDash
        </span>
      )
    }
    if (platform === 'UBER_EATS') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
          Uber Eats
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-orange-500/15 text-orange-600 dark:text-orange-400 border border-orange-500/30">
        Grubhub
      </span>
    )
  }

  const renderOrderGroupBadge = (ord: ReconciledOrder) => {
    const label = (isEn ? ord.status_label_en : ord.status_label_es) || ord.reconciliation_status
    if (ord.action_group === 'CONCILIATED_READY') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-xl text-[10px] leading-tight font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
          <CheckCircle2 className="w-3 h-3 shrink-0" />
          <span>{label}</span>
        </span>
      )
    }
    if (ord.action_group === 'DISPUTE_RECOVERY') {
      const isRecovered = ord.status_code === 'DISPUTE_RECOVERED'
      return (
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-xl text-[10px] leading-tight font-bold border ${
            isRecovered
              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
              : 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30'
          }`}
        >
          {isRecovered ? <CheckCircle2 className="w-3 h-3 shrink-0" /> : <XCircle className="w-3 h-3 shrink-0" />}
          <span>{label}</span>
        </span>
      )
    }
    if (ord.action_group === 'VARIANCE_INVESTIGATE') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-xl text-[10px] leading-tight font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
          <AlertTriangle className="w-3 h-3 shrink-0" />
          <span>{label}</span>
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-xl text-[10px] leading-tight font-bold bg-slate-500/15 text-slate-700 dark:text-slate-300 border border-slate-500/30">
        <Lock className="w-3 h-3 shrink-0" />
        <span>{label}</span>
      </span>
    )
  }

  const latestSyncTimestamp = useMemo(() => {
    const candidates = [
      syncStatus?.TOAST?.lastSyncedAt,
      syncStatus?.DOORDASH?.lastSyncedAt,
      syncStatus?.UBER_EATS?.lastSyncedAt,
      syncStatus?.GRUBHUB?.lastSyncedAt,
      syncStatus?.TOAST?.globalLastSyncedAt,
    ].filter(Boolean)
    if (candidates.length === 0) return null
    return candidates.sort().reverse()[0]
  }, [syncStatus])

  const hasActionNeeded =
    group2Variance.length > 0 ||
    group3Disputes.some((o) => o.status_code !== 'DISPUTE_RECOVERED') ||
    group4Blocked.length > 0 ||
    !coverageReport?.isCoverageComplete

  return (
    <div className="w-full text-slate-900 dark:text-slate-100 space-y-3.5">
      {/* BANNER DE ADVERTENCIA VISIBLE SI FALLA FETCH O SYNC (NUNCA OCULTAR DATOS ANTIGUOS SIN ADVERTENCIA) */}
      {fetchError && (
        <div className="p-3.5 rounded-2xl bg-rose-500/15 border-2 border-rose-500/40 text-rose-800 dark:text-rose-200 flex items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-2.5 text-xs md:text-sm font-bold">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
            <span>{t('deliveryReconciliation.stale_data_warning_banner', { error: fetchError })}</span>
          </div>
          <button
            onClick={() => {
              fetchData()
              fetchQbJournalRecords()
            }}
            className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-extrabold shrink-0"
          >
            {isEn ? 'Retry' : 'Reintentar'}
          </button>
        </div>
      )}

      {/* 1. CABECERA SIMPLIFICADA: ALCANCE, COBERTURA, ÚLTIMA SINCRONIZACIÓN Y ACCIÓN REQUERIDA (P1 #14) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 text-[11px] font-bold">
                <Scale className="w-3 h-3" />
                {t('deliveryReconciliation.badge')}
              </span>
              <button
                type="button"
                onClick={() => setShowTaxRulesPopover((v) => !v)}
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-[11px] font-bold border border-slate-200 dark:border-slate-700 transition"
              >
                <Info className="w-3 h-3 text-indigo-500" />
                <span>{t('deliveryReconciliation.tax_rules_tooltip_btn')}</span>
              </button>
            </div>
            <h1 className="text-xl md:text-2xl font-extrabold tracking-tight">
              {t('deliveryReconciliation.title')}
            </h1>
            <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 mt-0.5">
              {t('deliveryReconciliation.workflow_route_banner')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleLiveSync}
              disabled={syncing || !isDateRangeValid}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-bold text-xs md:text-sm shadow-sm transition"
            >
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? t('deliveryReconciliation.syncing_short') : t('deliveryReconciliation.sync_store_period_btn')}
            </button>

            <button
              onClick={() => setShowImportModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-xs md:text-sm border border-slate-200 dark:border-slate-700 transition"
            >
              <Upload className="w-4 h-4" />
              CSV / JSON
            </button>

            <button
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-xs md:text-sm border border-slate-200 dark:border-slate-700 transition"
            >
              <Download className="w-4 h-4" />
              {t('deliveryReconciliation.export_csv_short')}
            </button>
          </div>
        </div>

        {/* TOOLTIP / DETALLE CONTEXTUAL DE REGLAS FISCALES Y CUENTAS CONTABLES QBO (24001 / 12050) */}
        {showTaxRulesPopover && (
          <div className="p-3.5 rounded-xl bg-indigo-500/5 border border-indigo-500/20 text-xs space-y-1.5 relative">
            <div className="flex items-center justify-between font-extrabold text-indigo-800 dark:text-indigo-300">
              <span>{t('deliveryReconciliation.tax_rule_banner_title')}</span>
              <button
                onClick={() => setShowTaxRulesPopover(false)}
                className="p-1 rounded hover:bg-indigo-500/10"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-slate-700 dark:text-slate-300">• {t('deliveryReconciliation.tax_rule_dd_gh')}</p>
            <p className="text-slate-700 dark:text-slate-300">• {t('deliveryReconciliation.tax_rule_uber')}</p>
          </div>
        )}

        {/* BARRA DE ALCANCE VISIBLE SIEMPRE: ALCANCE, COBERTURA (CON BLOQUEO EXPLÍCITO), ÚLTIMA SINCRONIZACIÓN */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-slate-100/80 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              <strong className="text-slate-500">{t('deliveryReconciliation.scope_bar_stores')}</strong>{' '}
              <span className="font-extrabold text-slate-900 dark:text-white">
                {selectedStore === 'ALL'
                  ? t('deliveryReconciliation.all_stores')
                  : selectedStore === '0'
                  ? t('deliveryReconciliation.unassigned_store_option')
                  : mappings.find((m) => String(m.store_id) === String(selectedStore))?.store_name || `#${selectedStore}`}
              </span>
            </span>
            <span>•</span>
            <span>
              <strong className="text-slate-500">{t('deliveryReconciliation.scope_bar_platforms')}</strong>{' '}
              <span className="font-extrabold text-slate-900 dark:text-white">
                {selectedPlatform === 'ALL' ? t('deliveryReconciliation.all_platforms') : selectedPlatform}
              </span>
            </span>
            <span>•</span>
            <span>
              <strong className="text-slate-500">{t('deliveryReconciliation.scope_bar_period')}</strong>{' '}
              <span className="font-mono font-extrabold text-indigo-600 dark:text-indigo-400">
                {fmtDateMDY(startDate)} → {fmtDateMDY(endDate)}
              </span>
            </span>
            <span>•</span>
            <span>
              <strong className="text-slate-500">{t('deliveryReconciliation.scope_bar_last_sync')}</strong>{' '}
              <span className="font-mono font-semibold">{fmtLaTimestamp(latestSyncTimestamp)}</span>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {activePayoutRef && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-600 text-white font-mono text-xs font-extrabold">
                {t('deliveryReconciliation.scope_active_payout_filter', { ref: activePayoutRef })}
                <button
                  onClick={() => setActivePayoutRef('')}
                  title={t('deliveryReconciliation.scope_clear_payout_filter', { ref: activePayoutRef })}
                  className="hover:opacity-80"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            )}
            {coverageReport && (
              <button
                type="button"
                onClick={() => setActiveTab('mappings')}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-extrabold transition ${
                  coverageReport.isCoverageComplete
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                    : 'bg-amber-500/15 text-amber-800 dark:text-amber-200 border border-amber-500/40'
                }`}
              >
                {coverageReport.isCoverageComplete ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{t('deliveryReconciliation.coverage_publishable_badge')}</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span>
                      {isEn
                        ? coverageReport.statusLabelEn || t('deliveryReconciliation.coverage_not_publishable_badge')
                        : coverageReport.statusLabelEs || t('deliveryReconciliation.coverage_not_publishable_badge')}
                    </span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* FILTROS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
              {t('deliveryReconciliation.filter_1_store')}
            </label>
            <select
              value={selectedStore}
              onChange={(e) => {
                setSelectedStore(e.target.value)
                setActivePayoutRef('')
              }}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs md:text-sm font-bold"
            >
              <option value="ALL">{t('deliveryReconciliation.all_stores')}</option>
              <option value="0">{t('deliveryReconciliation.unassigned_store_option')}</option>
              {[...mappings]
                .sort((a, b) => a.store_name.localeCompare(b.store_name, 'es'))
                .map((m) => (
                  <option key={m.store_id} value={String(m.store_id)}>
                    {m.store_name}
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
              {t('deliveryReconciliation.filter_2_platform')}
            </label>
            <select
              value={selectedPlatform}
              onChange={(e) => {
                setSelectedPlatform(e.target.value)
                setActivePayoutRef('')
              }}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs md:text-sm font-bold"
            >
              <option value="ALL">{t('deliveryReconciliation.filter_all_platforms_combo')}</option>
              <option value="DOORDASH">DoorDash</option>
              <option value="UBER_EATS">Uber Eats</option>
              <option value="GRUBHUB">Grubhub</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
              {t('deliveryReconciliation.filter_3_start_date')}
            </label>
            <div className="relative">
              <div className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs md:text-sm font-semibold flex items-center justify-between pointer-events-none">
                <span>{fmtDateMDY(startDate)}</span>
                <Calendar className="w-4 h-4 text-slate-400" />
              </div>
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value)
                  setActivePreset('CUSTOM')
                  setActivePayoutRef('')
                }}
                onClick={(e) => {
                  try {
                    ;(e.currentTarget as HTMLInputElement).showPicker?.()
                  } catch {}
                }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
              {t('deliveryReconciliation.filter_4_end_date')}
            </label>
            <div className="relative">
              <div
                className={`w-full rounded-xl border px-3 py-2 text-xs md:text-sm font-semibold flex items-center justify-between pointer-events-none ${
                  !isDateRangeValid
                    ? 'border-rose-500 bg-rose-500/10 text-rose-700'
                    : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800'
                }`}
              >
                <span>{fmtDateMDY(endDate)}</span>
                <Calendar className="w-4 h-4 text-slate-400" />
              </div>
              <input
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => {
                  setEndDate(e.target.value)
                  setActivePreset('CUSTOM')
                  setActivePayoutRef('')
                }}
                onClick={(e) => {
                  try {
                    ;(e.currentTarget as HTMLInputElement).showPicker?.()
                  } catch {}
                }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
              {t('deliveryReconciliation.filter_5_search')}
            </label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={t('deliveryReconciliation.filter_5_placeholder')}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pl-9 pr-7 py-2 text-xs md:text-sm"
              />
              {searchInput && (
                <button
                  onClick={() => {
                    setSearchInput('')
                    setSearchQuery('')
                  }}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* P1 #14: REDUCIR PRESETS EXACTAMENTE A 4: ESTA SEMANA, SEMANA ANTERIOR, MES ACTUAL, PERSONALIZADO */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
          <span className="text-[11px] font-extrabold text-slate-400 uppercase">
            {t('deliveryReconciliation.quick_weeks_label')}
          </span>
          <button
            onClick={() => applyDynamicDatePreset('THIS_WEEK')}
            className={`px-3 py-1.5 rounded-lg font-bold transition border ${
              activePreset === 'THIS_WEEK' && !activePayoutRef
                ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
            }`}
          >
            {t('deliveryReconciliation.preset_this_week')}
          </button>
          <button
            onClick={() => applyDynamicDatePreset('PREV_WEEK')}
            className={`px-3 py-1.5 rounded-lg font-bold transition border ${
              activePreset === 'PREV_WEEK' && !activePayoutRef
                ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
            }`}
          >
            {t('deliveryReconciliation.preset_prev_week')}
          </button>
          <button
            onClick={() => applyDynamicDatePreset('CURRENT_MONTH')}
            className={`px-3 py-1.5 rounded-lg font-bold transition border ${
              activePreset === 'CURRENT_MONTH' && !activePayoutRef
                ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
            }`}
          >
            {t('deliveryReconciliation.preset_current_month')}
          </button>
          <button
            onClick={() => applyDynamicDatePreset('CUSTOM')}
            className={`px-3 py-1.5 rounded-lg font-bold transition border ${
              activePreset === 'CUSTOM'
                ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
            }`}
          >
            {t('deliveryReconciliation.preset_custom')}
          </button>
        </div>
      </div>

      {bannerMessage && (
        <div
          className={`p-3 rounded-xl border flex items-center justify-between ${
            bannerMessage.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
          }`}
        >
          <span className="text-xs md:text-sm font-semibold">{bannerMessage.text}</span>
          <button onClick={() => setBannerMessage(null)} className="p-1 hover:opacity-75">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 2. PREGUNTA PRINCIPAL + LOS 4 GRUPOS EN ORDEN DE PRIORIDAD VISUAL (P1 #13: 1. BLOQUEADOS -> 2. DIFERENCIAS -> 3. DISPUTAS -> 4. LISTOS) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm space-y-3.5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="text-base md:text-lg font-extrabold flex items-center gap-2">
              {hasActionNeeded ? (
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
              ) : (
                <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
              )}
              <span>{t('deliveryReconciliation.primary_question_title')}</span>
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
              {hasActionNeeded
                ? t('deliveryReconciliation.primary_question_action_needed', {
                    variances: group2Variance.length,
                    varAmt: Number(summary?.varianceInvestigateAmount || 0).toFixed(2),
                    disputes: group3Disputes.length,
                    dispAmt: Number(summary?.disputeRecoveryAmount || 0).toFixed(2),
                    blocked: group4Blocked.length,
                  })
                : t('deliveryReconciliation.primary_question_ok')}
            </p>
          </div>
          {(selectedActionGroup !== 'ALL' || selectedOrderSubFilter !== 'NONE') && (
            <button
              onClick={() => {
                setSelectedActionGroup('ALL')
                setSelectedOrderSubFilter('NONE')
              }}
              className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-xs font-bold"
            >
              {t('deliveryReconciliation.group_all_title')} ({orders.length})
            </button>
          )}
        </div>

        {/* TARJETAS DE LOS 4 GRUPOS EN ORDEN DE PRIORIDAD: 1. BLOQUEADOS -> 2. DIFERENCIAS -> 3. DISPUTAS -> 4. LISTOS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* PRIORIDAD 1: BLOQUEADOS (BLOCKED_MISSING_INFO) */}
          <div
            onClick={() => {
              setSelectedOrderSubFilter('NONE')
              setSelectedActionGroup(selectedActionGroup === 'BLOCKED_MISSING_INFO' ? 'ALL' : 'BLOCKED_MISSING_INFO')
              setActiveTab('orders')
            }}
            className={`cursor-pointer rounded-2xl border p-3.5 transition ${
              selectedActionGroup === 'BLOCKED_MISSING_INFO' && selectedOrderSubFilter === 'NONE'
                ? 'ring-2 ring-slate-600 border-slate-600 bg-slate-500/15'
                : 'border-slate-300 dark:border-slate-700 bg-slate-100/70 dark:bg-slate-800/50 hover:border-slate-400'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-extrabold text-slate-800 dark:text-slate-200">
                {t('deliveryReconciliation.group_4_title')}
              </span>
              <Lock className="w-4 h-4 text-slate-600 dark:text-slate-400 shrink-0" />
            </div>
            <div className="flex items-baseline justify-between mt-2">
              <span className="text-2xl font-extrabold font-mono text-slate-800 dark:text-slate-200">
                {group4Blocked.length}
              </span>
              <span className="text-xs font-mono font-bold text-slate-600 dark:text-slate-400">
                {fmtMoney(summary?.blockedMissingInfoAmount || 0)}
              </span>
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
              {t('deliveryReconciliation.group_4_desc')}
            </p>
          </div>

          {/* PRIORIDAD 2: DIFERENCIAS POR INVESTIGAR (VARIANCE_INVESTIGATE) */}
          <div
            onClick={() => {
              setSelectedOrderSubFilter('NONE')
              setSelectedActionGroup(selectedActionGroup === 'VARIANCE_INVESTIGATE' ? 'ALL' : 'VARIANCE_INVESTIGATE')
              setActiveTab('orders')
            }}
            className={`cursor-pointer rounded-2xl border p-3.5 transition ${
              selectedActionGroup === 'VARIANCE_INVESTIGATE' && selectedOrderSubFilter === 'NONE'
                ? 'ring-2 ring-amber-500 border-amber-500 bg-amber-500/10'
                : 'border-amber-500/30 bg-amber-500/5 hover:border-amber-500/60'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-extrabold text-amber-800 dark:text-amber-300">
                {t('deliveryReconciliation.group_2_title')}
              </span>
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            </div>
            <div className="flex items-baseline justify-between mt-2">
              <span className="text-2xl font-extrabold font-mono text-amber-700 dark:text-amber-300">
                {group2Variance.length}
              </span>
              <span className="text-xs font-mono font-bold text-amber-700 dark:text-amber-400">
                {isEn ? 'Var:' : 'Dif:'} {fmtMoney(summary?.varianceInvestigateAmount || 0)}
              </span>
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
              {t('deliveryReconciliation.group_2_desc')}
            </p>
          </div>

          {/* PRIORIDAD 3: DISPUTAS / RECUPERACIONES (DISPUTE_RECOVERY) */}
          <div
            onClick={() => {
              setSelectedOrderSubFilter('NONE')
              setSelectedActionGroup(selectedActionGroup === 'DISPUTE_RECOVERY' ? 'ALL' : 'DISPUTE_RECOVERY')
              setActiveTab('orders')
            }}
            className={`cursor-pointer rounded-2xl border p-3.5 transition ${
              selectedActionGroup === 'DISPUTE_RECOVERY' && selectedOrderSubFilter === 'NONE'
                ? 'ring-2 ring-rose-500 border-rose-500 bg-rose-500/10'
                : 'border-rose-500/30 bg-rose-500/5 hover:border-rose-500/60'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-extrabold text-rose-800 dark:text-rose-300">
                {t('deliveryReconciliation.group_3_title')}
              </span>
              <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
            </div>
            <div className="flex items-baseline justify-between mt-2">
              <span className="text-2xl font-extrabold font-mono text-rose-700 dark:text-rose-300">
                {group3Disputes.length}
              </span>
              <span className="text-xs font-mono font-bold text-rose-700 dark:text-rose-400">
                {fmtMoney(summary?.disputeRecoveryAmount || 0)}
              </span>
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
              {t('deliveryReconciliation.group_3_desc')}
            </p>
          </div>

          {/* PRIORIDAD 4: LISTOS PARA CONTABILIZAR (CONCILIATED_READY) */}
          <div
            onClick={() => {
              setSelectedOrderSubFilter('NONE')
              setSelectedActionGroup(selectedActionGroup === 'CONCILIATED_READY' ? 'ALL' : 'CONCILIATED_READY')
              setActiveTab('orders')
            }}
            className={`cursor-pointer rounded-2xl border p-3.5 transition ${
              selectedActionGroup === 'CONCILIATED_READY' && selectedOrderSubFilter === 'NONE'
                ? 'ring-2 ring-emerald-500 border-emerald-500 bg-emerald-500/10'
                : 'border-emerald-500/30 bg-emerald-500/5 hover:border-emerald-500/60'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-extrabold text-emerald-800 dark:text-emerald-300">
                {t('deliveryReconciliation.group_1_title')}
              </span>
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            </div>
            <div className="flex items-baseline justify-between mt-2">
              <span className="text-2xl font-extrabold font-mono text-emerald-700 dark:text-emerald-300">
                {group1Conciliated.length}
              </span>
              <span className="text-xs font-mono font-bold text-emerald-700 dark:text-emerald-400">
                {fmtMoney(summary?.conciliatedReadyGross || 0)}
              </span>
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
              {t('deliveryReconciliation.group_1_desc')}
            </p>
          </div>
        </div>
      </div>

      {/* 3. RESUMEN POR PLATAFORMA EN EL CONTEXTO SELECCIONADO */}
      {summary?.byPlatform && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
          {(['DOORDASH', 'UBER_EATS', 'GRUBHUB'] as DeliveryPlatform[]).map((plat) => {
            const pData = summary.byPlatform[plat] || {}
            const isSelected = selectedPlatform === plat
            const isUber = plat === 'UBER_EATS'
            const borderClass =
              plat === 'DOORDASH'
                ? 'border-red-500/30 bg-white dark:bg-slate-900'
                : plat === 'UBER_EATS'
                ? 'border-emerald-500/30 bg-white dark:bg-slate-900'
                : 'border-orange-500/30 bg-white dark:bg-slate-900'

            const grossCut = pData.payoutsGrossTotal || pData.settledPlatformGross || pData.platformGross || 0
            const feesCut = pData.payoutsFeesTotal || pData.totalFees || 0
            const errorsCut = pData.payoutsErrorTotal || pData.errorCharges || 0
            const netBankCut = pData.payoutsNetTotal || pData.netPayout || 0
            const conciliatedCount = pData.conciliatedReadyCount || 0
            const pendingReviewCount = pData.withPayoutPendingReviewCount || 0

            return (
              <div
                key={plat}
                onClick={() => {
                  const nextPlat = isSelected ? 'ALL' : plat
                  setSelectedPlatform(nextPlat)
                  setActivePayoutRef('')
                  setSelectedOrderSubFilter('NONE')
                  if (
                    nextPlat !== 'ALL' &&
                    (activeTab === 'qb_journals' || activeTab === 'payouts') &&
                    (pData.payoutsCount || 0) === 0 &&
                    (pData.ordersCount || 0) > 0
                  ) {
                    setActiveTab('orders')
                    if (pendingReviewCount > 0) {
                      setSelectedActionGroup('ALL')
                      setSelectedOrderSubFilter('WITH_PAYOUT_PENDING_REVIEW')
                    }
                  }
                }}
                className={`cursor-pointer rounded-2xl border p-4 transition shadow-sm ${borderClass} ${
                  isSelected ? 'ring-2 ring-indigo-500' : 'hover:border-slate-400'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    {renderPlatformBadge(plat)}
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                    {pData.payoutsCount || 0}{' '}
                    {(pData.payoutsCount || 0) === 1
                      ? t('deliveryReconciliation.weekly_cut_singular')
                      : t('deliveryReconciliation.weekly_cut_plural')}
                  </span>
                </div>

                <div className="space-y-1.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl p-3 border border-slate-200/80 dark:border-slate-800 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 font-semibold">
                      {t('deliveryReconciliation.card_gross_sales')}{' '}
                      {isUber
                        ? t('deliveryReconciliation.card_without_tax')
                        : t('deliveryReconciliation.card_with_tax')}
                      :
                    </span>
                    <span className="font-mono font-bold text-slate-900 dark:text-white">
                      {fmtMoney(grossCut)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 font-semibold">
                      {t('deliveryReconciliation.card_platform_fees')}
                    </span>
                    <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
                      {fmtMoney(feesCut)}
                    </span>
                  </div>
                  {Math.abs(errorsCut) > 0.01 && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-semibold">
                        {errorsCut > 0
                          ? t('deliveryReconciliation.card_reimbursements_won')
                          : t('deliveryReconciliation.card_error_charges')}
                      </span>
                      <span
                        className={`font-mono font-bold ${
                          errorsCut > 0 ? 'text-emerald-600' : 'text-rose-600'
                        }`}
                      >
                        {errorsCut > 0 ? `+${fmtMoney(errorsCut)}` : fmtMoney(errorsCut)}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-1.5 border-t border-slate-200 dark:border-slate-700 text-sm">
                    <span className="font-extrabold text-emerald-700 dark:text-emerald-400">
                      {t('deliveryReconciliation.card_net_bank_deposit')}
                    </span>
                    <span className="font-mono font-extrabold text-emerald-600 dark:text-emerald-400">
                      {fmtMoney(netBankCut)}
                    </span>
                  </div>
                </div>

                <div className="mt-2.5 pt-2 flex flex-wrap items-center justify-between gap-1 text-[11px]">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedPlatform(plat)
                      setActivePayoutRef('')
                      setSelectedOrderSubFilter('NONE')
                      setSelectedActionGroup('CONCILIATED_READY')
                      setOrdersPage(1)
                      setActiveTab('orders')
                    }}
                    className="px-2 py-0.5 rounded-lg hover:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 font-bold transition"
                  >
                    ✓ {conciliatedCount} {isEn ? 'reconciled' : 'conciliadas'}
                  </button>
                  {pendingReviewCount > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedPlatform(plat)
                        setActivePayoutRef('')
                        setSelectedActionGroup('ALL')
                        setSelectedOrderSubFilter('WITH_PAYOUT_PENDING_REVIEW')
                        setOrdersPage(1)
                        setActiveTab('orders')
                      }}
                      className={`px-2 py-0.5 rounded-lg font-bold transition ${
                        isSelected && selectedOrderSubFilter === 'WITH_PAYOUT_PENDING_REVIEW'
                          ? 'bg-amber-600 text-white shadow-sm'
                          : 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30'
                      }`}
                    >
                      ⚠ {pendingReviewCount} {t('deliveryReconciliation.status_WITH_PAYOUT_PENDING_REVIEW')}
                    </button>
                  )}
                  {(pData.pendingToastCount || 0) > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedPlatform(plat)
                        setActivePayoutRef('')
                        setSelectedActionGroup('ALL')
                        setSelectedOrderSubFilter('TOAST_ONLY')
                        setOrdersPage(1)
                        setActiveTab('orders')
                      }}
                      className={`px-2 py-0.5 rounded-lg font-semibold transition ${
                        isSelected && selectedOrderSubFilter === 'TOAST_ONLY'
                          ? 'bg-slate-700 text-white'
                          : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500'
                      }`}
                    >
                      ⏳ {pData.pendingToastCount} Toast
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 4. PESTAÑAS DE NAVEGACIÓN REORDENADAS (P1 #13: ATENCIÓN REQUERIDA PRIMERO, QUICKBOOKS PASO FINAL) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-1.5 shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-1.5">
          <button
            onClick={() => setActiveTab('orders')}
            className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs md:text-sm font-extrabold transition ${
              activeTab === 'orders'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Receipt className="w-4 h-4 shrink-0" />
            <span className="truncate">{t('deliveryReconciliation.nav_step_attention')}</span>
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-extrabold ${
                activeTab === 'orders'
                  ? 'bg-white/20 text-white'
                  : 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400'
              }`}
            >
              {orders.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('disputes')}
            className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs md:text-sm font-extrabold transition ${
              activeTab === 'disputes'
                ? 'bg-rose-600 text-white shadow-sm'
                : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="truncate">{t('deliveryReconciliation.nav_step_disputes')}</span>
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-extrabold ${
                activeTab === 'disputes'
                  ? 'bg-white/20 text-white'
                  : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
              }`}
            >
              {group3Disputes.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('mappings')}
            className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs md:text-sm font-extrabold transition ${
              activeTab === 'mappings'
                ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900 shadow-sm'
                : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Store className="w-4 h-4 shrink-0" />
            <span className="truncate">{t('deliveryReconciliation.nav_step_coverage')}</span>
          </button>

          <button
            onClick={() => setActiveTab('qb_journals')}
            className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs md:text-sm font-extrabold transition ${
              activeTab === 'qb_journals' || activeTab === 'payouts'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Landmark className="w-4 h-4 shrink-0" />
            <span className="truncate">{t('deliveryReconciliation.nav_step_qbo_final')}</span>
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-extrabold ${
                activeTab === 'qb_journals' || activeTab === 'payouts'
                  ? 'bg-white/20 text-white'
                  : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
              }`}
            >
              {qbRecords.length}
            </span>
          </button>
        </div>
      </div>

      {/* TAB: AUDITORÍA ORDEN POR ORDEN CON EXPLICACIÓN EN LENGUAJE SIMPLE (QUÉ PASÓ, CAUSA, EVIDENCIA, SIGUIENTE ACCIÓN) */}
      {activeTab === 'orders' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-3.5 bg-slate-50/70 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-extrabold text-slate-500 mr-1">
                {t('deliveryReconciliation.filter_inside_orders_label')}
              </span>
              <button
                onClick={() => {
                  setSelectedActionGroup('ALL')
                  setSelectedOrderSubFilter('NONE')
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border ${
                  selectedActionGroup === 'ALL' && selectedOrderSubFilter === 'NONE'
                    ? 'bg-slate-800 text-white border-slate-800 dark:bg-slate-200 dark:text-slate-900'
                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                }`}
              >
                📋 {t('deliveryReconciliation.quick_filter_all')} ({orders.length})
              </button>
              {withPayoutPendingReviewOrders.length > 0 && (
                <button
                  onClick={() => {
                    setSelectedActionGroup('ALL')
                    setSelectedOrderSubFilter(
                      selectedOrderSubFilter === 'WITH_PAYOUT_PENDING_REVIEW' ? 'NONE' : 'WITH_PAYOUT_PENDING_REVIEW'
                    )
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border ${
                    selectedOrderSubFilter === 'WITH_PAYOUT_PENDING_REVIEW'
                      ? 'bg-amber-600 text-white border-amber-600'
                      : 'bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-400 border-amber-500/30'
                  }`}
                >
                  ⚠ {t('deliveryReconciliation.status_WITH_PAYOUT_PENDING_REVIEW')} ({withPayoutPendingReviewOrders.length})
                </button>
              )}
              <button
                onClick={() => {
                  setSelectedOrderSubFilter('NONE')
                  setSelectedActionGroup('BLOCKED_MISSING_INFO')
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border ${
                  selectedActionGroup === 'BLOCKED_MISSING_INFO' && selectedOrderSubFilter === 'NONE'
                    ? 'bg-slate-700 text-white border-slate-700'
                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700'
                }`}
              >
                🛑 {t('deliveryReconciliation.group_4_title')} ({group4Blocked.length})
              </button>
              <button
                onClick={() => {
                  setSelectedOrderSubFilter('NONE')
                  setSelectedActionGroup('VARIANCE_INVESTIGATE')
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border ${
                  selectedActionGroup === 'VARIANCE_INVESTIGATE' && selectedOrderSubFilter === 'NONE'
                    ? 'bg-amber-600 text-white border-amber-600'
                    : 'bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-400 border-amber-500/30'
                }`}
              >
                ⚠️ {t('deliveryReconciliation.group_2_title')} ({group2Variance.length})
              </button>
              <button
                onClick={() => {
                  setSelectedOrderSubFilter('NONE')
                  setSelectedActionGroup('DISPUTE_RECOVERY')
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border ${
                  selectedActionGroup === 'DISPUTE_RECOVERY' && selectedOrderSubFilter === 'NONE'
                    ? 'bg-rose-600 text-white border-rose-600'
                    : 'bg-white dark:bg-slate-900 text-rose-700 dark:text-rose-400 border-rose-500/30'
                }`}
              >
                🚨 {t('deliveryReconciliation.group_3_title')} ({group3Disputes.length})
              </button>
              <button
                onClick={() => {
                  setSelectedOrderSubFilter('NONE')
                  setSelectedActionGroup('CONCILIATED_READY')
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border ${
                  selectedActionGroup === 'CONCILIATED_READY' && selectedOrderSubFilter === 'NONE'
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
                }`}
              >
                ✅ {t('deliveryReconciliation.group_1_title')} ({group1Conciliated.length})
              </button>
            </div>
          </div>

          {/* P0 #7: BARRA DE RESOLUCIÓN MASIVA POR LOTE SEPARADA ESTRICTAMENTE SEGÚN ACCIÓN */}
          {selectedVisibleOrders.length > 0 && (
            <div className="p-3 bg-indigo-500/10 border-b border-indigo-500/30 flex flex-wrap items-center justify-between gap-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-1 rounded-full bg-indigo-600 text-white font-extrabold">
                  {t('deliveryReconciliation.batch_selected_count', { count: selectedVisibleOrders.length })}
                </span>
                <input
                  type="text"
                  value={batchNotes}
                  onChange={(e) => setBatchNotes(e.target.value)}
                  placeholder={t('deliveryReconciliation.batch_notes_placeholder')}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs min-w-[260px]"
                />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {activeSelectedBatchGroup === 'VARIANCE_INVESTIGATE' && (
                  <button
                    onClick={() => {
                      if (batchNotes.trim().length < 5) {
                        setBannerMessage({
                          type: 'error',
                          text: t('deliveryReconciliation.variance_reason_required_error'),
                        })
                        return
                      }
                      setBatchOrderConfirmModal({ open: true, actionType: 'APPROVE_VARIANCE' })
                    }}
                    disabled={savingBatch}
                    className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-extrabold transition"
                  >
                    {t('deliveryReconciliation.batch_approve_variance_btn', {
                      count: selectedVisibleOrders.length,
                    })}
                  </button>
                )}
                {activeSelectedBatchGroup === 'DISPUTE_RECOVERY' && (
                  <button
                    onClick={() =>
                      setBatchOrderConfirmModal({ open: true, actionType: 'MARK_DISPUTE_SUBMITTED' })
                    }
                    disabled={savingBatch}
                    className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-extrabold transition"
                  >
                    {t('deliveryReconciliation.batch_mark_dispute_submitted_btn', {
                      count: selectedVisibleOrders.length,
                    })}
                  </button>
                )}
                <button
                  onClick={() => handleExportBatchEvidencePackage(selectedVisibleOrders)}
                  className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold transition"
                >
                  {t('deliveryReconciliation.batch_export_evidence_btn', {
                    count: selectedVisibleOrders.length,
                  })}
                </button>
                <button
                  onClick={() => setSelectedOrderIds(new Set())}
                  className="px-2.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold"
                >
                  {t('deliveryReconciliation.batch_clear_selection')}
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="p-12 text-center text-slate-500">{t('deliveryReconciliation.syncing_btn')}</div>
          ) : displayedOrders.length === 0 ? (
            <div className="p-12 text-center text-slate-500">{t('deliveryReconciliation.empty_orders')}</div>
          ) : (
            <div className="overflow-x-auto">
              {/* BARRA DE PAGINACIÓN SUPERIOR PARA ALTO VOLUMEN DE ÓRDENES (9,400+ ÓRDENES SIN LAG EN DOM) */}
              <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="text-slate-600 dark:text-slate-300 font-semibold">
                  {isEn ? (
                    <>
                      Showing{' '}
                      <strong className="font-mono text-slate-900 dark:text-white">
                        {(safeOrdersPage - 1) * ordersPageSize + 1}–
                        {Math.min(safeOrdersPage * ordersPageSize, displayedOrders.length)}
                      </strong>{' '}
                      of <strong className="font-mono text-slate-900 dark:text-white">{displayedOrders.length}</strong>{' '}
                      orders
                    </>
                  ) : (
                    <>
                      Mostrando{' '}
                      <strong className="font-mono text-slate-900 dark:text-white">
                        {(safeOrdersPage - 1) * ordersPageSize + 1}–
                        {Math.min(safeOrdersPage * ordersPageSize, displayedOrders.length)}
                      </strong>{' '}
                      de <strong className="font-mono text-slate-900 dark:text-white">{displayedOrders.length}</strong>{' '}
                      órdenes
                    </>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5 text-slate-500 font-semibold">
                    <span>{isEn ? 'Rows per page:' : 'Filas por página:'}</span>
                    <select
                      value={ordersPageSize}
                      onChange={(e) => {
                        setOrdersPageSize(Number(e.target.value))
                        setOrdersPage(1)
                      }}
                      className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs font-bold"
                    >
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                      <option value={250}>250</option>
                      <option value={500}>500</option>
                    </select>
                  </label>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setOrdersPage(1)}
                      disabled={safeOrdersPage <= 1}
                      className="px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-40 font-bold hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                      «
                    </button>
                    <button
                      onClick={() => setOrdersPage((p) => Math.max(1, p - 1))}
                      disabled={safeOrdersPage <= 1}
                      className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-40 font-bold hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                      {isEn ? 'Prev' : 'Ant.'}
                    </button>
                    <span className="px-2.5 py-1 font-mono font-extrabold text-slate-800 dark:text-slate-200">
                      {isEn
                        ? `Page ${safeOrdersPage} of ${totalOrderPages}`
                        : `Pág. ${safeOrdersPage} de ${totalOrderPages}`}
                    </span>
                    <button
                      onClick={() => setOrdersPage((p) => Math.min(totalOrderPages, p + 1))}
                      disabled={safeOrdersPage >= totalOrderPages}
                      className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-40 font-bold hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                      {isEn ? 'Next' : 'Sig.'}
                    </button>
                    <button
                      onClick={() => setOrdersPage(totalOrderPages)}
                      disabled={safeOrdersPage >= totalOrderPages}
                      className="px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-40 font-bold hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                      »
                    </button>
                  </div>
                </div>
              </div>

              <table className="w-full text-left border-collapse text-[11px] xl:text-xs">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800 font-bold">
                    <th className="px-2 py-2.5 w-8 text-center">
                      <input
                        type="checkbox"
                        checked={
                          paginatedOrders.filter((o) => canSelectOrderForBatch(o)).length > 0 &&
                          paginatedOrders
                            .filter((o) => canSelectOrderForBatch(o))
                            .every((o) => selectedOrderIds.has(o.id))
                        }
                        onChange={(e) => {
                          const next = new Set(selectedOrderIds)
                          if (e.target.checked) {
                            const eligible = paginatedOrders.filter((o) => canSelectOrderForBatch(o))
                            const targetGroup = activeSelectedBatchGroup || eligible[0]?.action_group
                            eligible
                              .filter((o) => o.action_group === targetGroup)
                              .forEach((o) => next.add(o.id))
                          } else {
                            paginatedOrders.forEach((o) => next.delete(o.id))
                          }
                          setSelectedOrderIds(next)
                        }}
                        className="rounded border-slate-300"
                      />
                    </th>
                    <th className="px-1.5 py-2">{t('deliveryReconciliation.col_date_store')}</th>
                    <th className="px-1.5 py-2">{t('deliveryReconciliation.col_order_id')}</th>
                    <th className="px-1.5 py-2 text-right bg-slate-200/40 dark:bg-slate-800/60">
                      {t('deliveryReconciliation.col_toast_stack')}
                    </th>
                    <th className="px-1.5 py-2 text-right bg-indigo-500/10">
                      {t('deliveryReconciliation.col_plat_stack')}
                    </th>
                    <th className="px-1.5 py-2 text-right">{t('deliveryReconciliation.col_variance')}</th>
                    <th className="px-1.5 py-2 text-right">{t('deliveryReconciliation.col_error_adj')}</th>
                    <th className="px-1.5 py-2 text-right font-extrabold text-emerald-700 dark:text-emerald-400">
                      {t('deliveryReconciliation.col_net_payout')}
                    </th>
                    <th className="px-1.5 py-2 max-w-[155px]">{t('deliveryReconciliation.col_status')}</th>
                    <th className="px-1.5 py-2 min-w-[170px] max-w-[235px]">{t('deliveryReconciliation.col_explanation')}</th>
                    <th className="px-1.5 py-2 text-center">{t('deliveryReconciliation.col_actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {paginatedOrders.map((ord) => {
                    const errAdj = Number(ord.error_charge || 0) + Number(ord.adjustment_amount || 0)
                    const varAmt = Number(ord.gross_variance ?? ord.gross_diff ?? 0)
                    const whatHappened = isEn ? ord.what_happened_en : ord.what_happened_es
                    const causeText = isEn ? ord.cause_en : ord.cause_es
                    const evidenceText = isEn ? ord.evidence_en : ord.evidence_es
                    const nextActionText = isEn ? ord.next_action_en : ord.next_action_es
                    const isOrderSelected = selectedOrderIds.has(ord.id)
                    const isSelectable = canSelectOrderForBatch(ord)

                    return (
                      <tr key={ord.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition align-top">
                        <td className="px-1.5 py-2 text-center">
                          <input
                            type="checkbox"
                            disabled={!isSelectable}
                            title={
                              !isSelectable
                                ? isEn
                                  ? 'Only Variance or Dispute orders of the same group can be selected for batch actions'
                                  : 'Solo órdenes con Diferencia o Disputa del mismo grupo pueden seleccionarse en lote'
                                : undefined
                            }
                            checked={isOrderSelected}
                            onChange={(e) => {
                              if (!isSelectable) return
                              const next = new Set(selectedOrderIds)
                              if (e.target.checked) next.add(ord.id)
                              else next.delete(ord.id)
                              setSelectedOrderIds(next)
                            }}
                            className="rounded border-slate-300 disabled:opacity-30"
                          />
                        </td>
                        <td className="px-1.5 py-2 whitespace-nowrap">
                          <div className="font-bold text-slate-900 dark:text-white">
                            {fmtDateMDY(ord.business_date)}
                          </div>
                          <div
                            className={`text-[11px] font-semibold mb-0.5 ${
                              ord.store_id === 0 ? 'text-rose-600 font-extrabold' : 'text-slate-500'
                            }`}
                          >
                            {ord.store_name}
                          </div>
                          <div>{renderPlatformBadge(ord.platform)}</div>
                        </td>
                        <td className="px-1.5 py-2 max-w-[140px]">
                          <div className="font-mono font-bold text-slate-900 dark:text-white truncate" title={ord.platform_order_id}>
                            {ord.platform_order_id}
                          </div>
                          {ord.toast_display_number && (
                            <div className="text-[10px] text-slate-500 leading-tight">
                              <div className="truncate" title={`Toast #${ord.toast_display_number} • ${ord.toast_tab_name}`}>
                                Toast #{ord.toast_display_number} • {ord.toast_tab_name}
                              </div>
                              {(ord.raw_payload as any)?.toast_voided && (
                                <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-[9px] font-extrabold">
                                  {isEn ? 'VOIDED IN POS' : 'ANULADO EN POS'}
                                </span>
                              )}
                            </div>
                          )}
                          {ord.payout_reference_id && (
                            <div className="text-[10px] font-mono text-indigo-600 dark:text-indigo-400 truncate" title={ord.payout_reference_id}>
                              {t('deliveryReconciliation.cut_prefix')}: #{ord.payout_reference_id}
                            </div>
                          )}
                        </td>
                        <td className="px-1.5 py-2 text-right font-mono bg-slate-100/50 dark:bg-slate-800/30 whitespace-nowrap">
                          <div className="font-extrabold text-slate-900 dark:text-white">
                            {fmtMoney(ord.toast_expected_gross)}
                          </div>
                          <div className="text-[10px] text-slate-500 leading-tight">
                            <div>{t('deliveryReconciliation.sub_prefix')}: {fmtMoney(ord.toast_net_sales)}</div>
                            <div>
                              {t('deliveryReconciliation.tax_prefix')}: {fmtMoney(ord.toast_tax)}
                              {ord.platform === 'UBER_EATS' && ord.toast_tax > 0 ? ' (Uber)' : ''}
                            </div>
                          </div>
                          {(ord.raw_payload as any)?.toast_voided &&
                            Number((ord.raw_payload as any)?.toast_voided_original_subtotal || 0) > 0 && (
                              <div className="text-[10px] font-bold text-amber-700 dark:text-amber-400">
                                {isEn ? 'VOID orig:' : 'Orig. VOID:'}{' '}
                                {fmtMoney(Number((ord.raw_payload as any)?.toast_voided_original_subtotal || 0))}
                              </div>
                            )}
                        </td>
                        <td className="px-1.5 py-2 text-right font-mono bg-indigo-500/5 whitespace-nowrap">
                          <div className="font-extrabold text-indigo-700 dark:text-indigo-300">
                            {fmtMoney(ord.platform_gross_receivable)}
                          </div>
                          <div className="text-[10px] text-slate-500 leading-tight">
                            <div>{t('deliveryReconciliation.sub_prefix')}: {fmtMoney(ord.platform_subtotal)}</div>
                            <div>{t('deliveryReconciliation.tax_prefix')}: {fmtMoney(ord.platform_tax_paid_to_merchant)}</div>
                          </div>
                        </td>
                        <td
                          className={`px-1.5 py-2 text-right font-mono font-extrabold whitespace-nowrap ${
                            Math.abs(varAmt) <= 0.05
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {fmtMoney(varAmt)}
                        </td>
                        <td
                          className={`px-1.5 py-2 text-right font-mono font-semibold max-w-[125px] ${
                            errAdj < -0.01 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400'
                          }`}
                        >
                          <div>{fmtMoney(errAdj)}</div>
                          {ord.raw_payload?.reimbursement_payout_ref && (() => {
                            const recAmt = Number(
                              ord.raw_payload.reimbursement_amount ||
                                ord.dispute_amount ||
                                Math.abs(ord.error_charge)
                            )
                            const dedAmt = Math.abs(Number(ord.error_charge || 0))
                            const isPartialRec =
                              ord.status_code === 'DISPUTE_PARTIALLY_RECOVERED' ||
                              (dedAmt > 0.05 && recAmt > 0 && recAmt < dedAmt - 0.05)
                            return (
                              <div className="mt-1">
                                <span
                                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-[9px] leading-tight font-extrabold border ${
                                    isPartialRec
                                      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30'
                                      : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                                  }`}
                                >
                                  {isPartialRec ? '⚠️ ' : '✅ '}
                                  {isPartialRec
                                    ? isEn
                                      ? `Partial #${ord.raw_payload.reimbursement_payout_ref} (${fmtMoney(recAmt)}/${fmtMoney(dedAmt)})`
                                      : `Parcial #${ord.raw_payload.reimbursement_payout_ref} (${fmtMoney(recAmt)}/${fmtMoney(dedAmt)})`
                                    : t('deliveryReconciliation.reimbursed_in_payout_badge', {
                                        ref: ord.raw_payload.reimbursement_payout_ref,
                                        amount: fmtMoney(recAmt),
                                      })}
                                </span>
                              </div>
                            )
                          })()}
                        </td>
                        <td className="px-1.5 py-2 text-right font-mono font-extrabold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                          {fmtMoney(ord.net_payout)}
                        </td>
                        <td className="px-1.5 py-2 max-w-[155px]">{renderOrderGroupBadge(ord)}</td>
                        <td className="px-2 py-2.5 text-[11px] space-y-0.5 max-w-[260px]">
                          {whatHappened && (
                            <div className="line-clamp-2" title={whatHappened}>
                              <strong className="text-slate-700 dark:text-slate-200">
                                {t('deliveryReconciliation.label_what_happened')}
                              </strong>{' '}
                              <span className="text-slate-600 dark:text-slate-300">{whatHappened}</span>
                            </div>
                          )}
                          {causeText && (
                            <div className="line-clamp-2" title={causeText}>
                              <strong className="text-slate-700 dark:text-slate-200">
                                {t('deliveryReconciliation.label_cause')}
                              </strong>{' '}
                              <span className="text-slate-500 dark:text-slate-400">{causeText}</span>
                            </div>
                          )}
                          {evidenceText && (
                            <div className="line-clamp-1" title={evidenceText}>
                              <strong className="text-slate-700 dark:text-slate-200">
                                {t('deliveryReconciliation.label_evidence')}
                              </strong>{' '}
                              <span className="font-mono text-indigo-600 dark:text-indigo-400">{evidenceText}</span>
                            </div>
                          )}
                          {nextActionText && (
                            <div className="pt-0.5 text-emerald-700 dark:text-emerald-400 font-bold line-clamp-2" title={nextActionText}>
                              → {nextActionText}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2.5 text-center whitespace-nowrap">
                          <button
                            onClick={() => handleOpenOrderModal(ord)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-semibold transition"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            {t('deliveryReconciliation.view_items_btn')}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {/* BARRA DE PAGINACIÓN INFERIOR */}
              <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-900/80 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="text-slate-600 dark:text-slate-300 font-semibold">
                  {isEn ? (
                    <>
                      Showing{' '}
                      <strong className="font-mono text-slate-900 dark:text-white">
                        {(safeOrdersPage - 1) * ordersPageSize + 1}–
                        {Math.min(safeOrdersPage * ordersPageSize, displayedOrders.length)}
                      </strong>{' '}
                      of <strong className="font-mono text-slate-900 dark:text-white">{displayedOrders.length}</strong>{' '}
                      orders
                    </>
                  ) : (
                    <>
                      Mostrando{' '}
                      <strong className="font-mono text-slate-900 dark:text-white">
                        {(safeOrdersPage - 1) * ordersPageSize + 1}–
                        {Math.min(safeOrdersPage * ordersPageSize, displayedOrders.length)}
                      </strong>{' '}
                      de <strong className="font-mono text-slate-900 dark:text-white">{displayedOrders.length}</strong>{' '}
                      órdenes
                    </>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setOrdersPage(1)}
                    disabled={safeOrdersPage <= 1}
                    className="px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-40 font-bold hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    «
                  </button>
                  <button
                    onClick={() => setOrdersPage((p) => Math.max(1, p - 1))}
                    disabled={safeOrdersPage <= 1}
                    className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-40 font-bold hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    {isEn ? 'Prev' : 'Ant.'}
                  </button>
                  <span className="px-2.5 py-1 font-mono font-extrabold text-slate-800 dark:text-slate-200">
                    {isEn
                      ? `Page ${safeOrdersPage} of ${totalOrderPages}`
                      : `Pág. ${safeOrdersPage} de ${totalOrderPages}`}
                  </span>
                  <button
                    onClick={() => setOrdersPage((p) => Math.min(totalOrderPages, p + 1))}
                    disabled={safeOrdersPage >= totalOrderPages}
                    className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-40 font-bold hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    {isEn ? 'Next' : 'Sig.'}
                  </button>
                  <button
                    onClick={() => setOrdersPage(totalOrderPages)}
                    disabled={safeOrdersPage >= totalOrderPages}
                    className="px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-40 font-bold hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    »
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB: CORTES BANCARIOS */}
      {activeTab === 'payouts' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-3.5 bg-slate-50/70 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
            <span className="text-xs font-extrabold text-slate-600 dark:text-slate-300">
              {t('deliveryReconciliation.tab_payouts')} ({payouts.length})
            </span>
            <div className="inline-flex rounded-xl p-1 bg-slate-200/70 dark:bg-slate-800 border border-slate-300/60 dark:border-slate-700 text-xs font-bold">
              <button
                onClick={() => {
                  setCutsSubView('qb')
                  setActiveTab('qb_journals')
                }}
                className="px-3 py-1 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 transition"
              >
                🧾 {t('deliveryReconciliation.view_mode_qb')}
              </button>
              <button
                onClick={() => {
                  setCutsSubView('bank')
                  setActiveTab('payouts')
                }}
                className="px-3 py-1 rounded-lg bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-sm transition"
              >
                🏦 {t('deliveryReconciliation.view_mode_bank')}
              </button>
            </div>
          </div>
          {payouts.length === 0 ? (
            <div className="p-12 text-center text-slate-500">{t('deliveryReconciliation.empty_payouts')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs md:text-sm">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800 font-bold">
                    <th className="p-3">{t('deliveryReconciliation.payout_date')}</th>
                    <th className="p-3">{t('deliveryReconciliation.col_store')}</th>
                    <th className="p-3">{t('deliveryReconciliation.col_platform')}</th>
                    <th className="p-3">{t('deliveryReconciliation.payout_ref')}</th>
                    <th className="p-3">{t('deliveryReconciliation.payout_period')}</th>
                    <th className="p-3 text-right">{t('deliveryReconciliation.payout_orders')}</th>
                    <th className="p-3 text-right">{t('deliveryReconciliation.payout_gross')}</th>
                    <th className="p-3 text-right">{t('deliveryReconciliation.payout_fees_total')}</th>
                    <th className="p-3 text-right">{t('deliveryReconciliation.payout_errors_total')}</th>
                    <th className="p-3 text-right font-extrabold text-emerald-700 dark:text-emerald-400">
                      {t('deliveryReconciliation.payout_net_deposited')}
                    </th>
                    <th className="p-3 text-center">{t('deliveryReconciliation.col_actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {payouts.map((p) => {
                    const feesTotal =
                      Number(p.commission_fees || 0) +
                      Number(p.delivery_fees || 0) +
                      Number(p.processing_fees || 0) +
                      Number(p.marketing_fees || 0)
                    const errTotal = Number(p.error_charges || 0) + Number(p.adjustments_amount || 0)
                    return (
                      <tr
                        key={p.id}
                        onClick={() => {
                          // P1 #15: Al abrir un payout, conservar y usar payout_reference_id sin mezclar otros settlements
                          setSelectedStore(String(p.store_id))
                          setSelectedPlatform(p.platform)
                          if (p.period_start) setStartDate(p.period_start)
                          if (p.period_end) setEndDate(p.period_end)
                          setActivePayoutRef(p.payout_reference_id)
                          setSearchQuery('')
                          setSelectedActionGroup('ALL')
                          setActiveTab('orders')
                        }}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer transition"
                      >
                        <td className="p-3 font-bold">{fmtDateMDY(p.payout_date)}</td>
                        <td className="p-3 font-semibold">{p.store_name}</td>
                        <td className="p-3">{renderPlatformBadge(p.platform)}</td>
                        <td className="p-3 font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">
                          #{p.payout_reference_id}
                        </td>
                        <td className="p-3 text-xs text-slate-500">
                          <div>{fmtDateMDY(p.period_start)} → {fmtDateMDY(p.period_end)}</div>
                          {(p.raw_payload?.is_month_end_cutoff ||
                            (p.platform === 'GRUBHUB' && /^\d{6}01/.test(String(p.payout_reference_id || '')))) && (
                            <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-700 dark:text-orange-300 border border-orange-500/30 text-[9px] font-extrabold">
                              {t('deliveryReconciliation.gh_month_end_cut_badge')}
                            </span>
                          )}
                          {!p.raw_payload?.is_month_end_cutoff &&
                            !(p.platform === 'GRUBHUB' && /^\d{6}01/.test(String(p.payout_reference_id || ''))) &&
                            (p.raw_payload?.is_new_month_remainder ||
                              (p.platform === 'GRUBHUB' &&
                                typeof p.period_start === 'string' &&
                                p.period_start.endsWith('-01') &&
                                p.period_end !== p.period_start &&
                                Number(String(p.period_end || '').slice(-2)) <= 6)) && (
                              <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30 text-[9px] font-extrabold">
                                {t('deliveryReconciliation.gh_new_month_cut_badge')}
                              </span>
                            )}
                        </td>
                        <td className="p-3 text-right font-bold">
                          {p.linked_orders_count ?? p.orders_count}
                          {!p.coverage_complete && (
                            <span className="block text-[10px] text-amber-600 font-semibold">
                              {isEn ? 'Incomplete coverage' : 'Cobertura incompleta'}
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-right font-mono font-bold">
                          {fmtMoney(p.platform_gross_receivable)}
                        </td>
                        <td className="p-3 text-right font-mono text-amber-600 dark:text-amber-400">
                          {fmtMoney(feesTotal)}
                        </td>
                        <td
                          className={`p-3 text-right font-mono ${
                            errTotal < -0.01
                              ? 'text-rose-600 dark:text-rose-400'
                              : errTotal > 0.01
                              ? 'text-emerald-600 dark:text-emerald-400 font-bold'
                              : 'text-slate-400'
                          }`}
                        >
                          {fmtMoney(errTotal)}
                        </td>
                        <td className="p-3 text-right font-mono font-extrabold text-emerald-600 dark:text-emerald-400">
                          {fmtMoney(p.net_payout_amount)}
                        </td>
                        <td className="p-3 text-center whitespace-nowrap">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedStore(String(p.store_id))
                              setSelectedPlatform(p.platform)
                              if (p.period_start) setStartDate(p.period_start)
                              if (p.period_end) setEndDate(p.period_end)
                              setActivePayoutRef(p.payout_reference_id)
                              setSelectedActionGroup('ALL')
                              setActiveTab('orders')
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold shadow-sm transition"
                          >
                            {t('deliveryReconciliation.qb_audit_orders_btn')}
                          </button>
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

      {/* TAB: DISPUTAS Y RECUPERACIONES (CON TRAZABILIDAD DE 4 ETAPAS ENTRE CORTES) */}
      {activeTab === 'disputes' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
          {group3Disputes.length > 0 && (
            <div className="p-3.5 bg-rose-500/5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-extrabold text-rose-700 dark:text-rose-300">
                🚨 {t('deliveryReconciliation.group_3_title')} ({group3Disputes.length})
              </span>
              <button
                onClick={() => handleExportBatchEvidencePackage(group3Disputes)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold shadow-sm transition"
              >
                <Download className="w-3.5 h-3.5" />
                {t('deliveryReconciliation.batch_export_evidence_btn')} ({group3Disputes.length})
              </button>
            </div>
          )}
          {group3Disputes.length === 0 ? (
            <div className="p-12 text-center text-emerald-600 dark:text-emerald-400 font-semibold">
              {t('deliveryReconciliation.empty_disputes')}
            </div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {group3Disputes.map((ord) => (
                <div key={ord.id} className="p-4 space-y-3 hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {renderPlatformBadge(ord.platform)}
                      <span className="font-mono font-extrabold text-sm">#{ord.platform_order_id}</span>
                      <span className="text-xs font-bold text-slate-500">
                        {ord.store_name} • {fmtDateMDY(ord.business_date)}
                      </span>
                      {renderOrderGroupBadge(ord)}
                    </div>
                    <button
                      onClick={() => handleOpenOrderModal(ord)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-extrabold transition"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      {t('deliveryReconciliation.view_items_btn')}
                    </button>
                  </div>

                  {/* LÍNEA DE TIEMPO DE 4 ETAPAS (ORDEN ORIGINAL -> ORDEN PLATAFORMA -> DEDUCCIÓN EN PAYOUT -> DISPUTA Y RECUPERACIÓN) */}
                  {Array.isArray(ord.lifecycle_trace) && (
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5 pt-1">
                      {ord.lifecycle_trace.map((st) => (
                        <div
                          key={st.step}
                          className={`rounded-xl p-3 border text-xs ${
                            st.step === 4 && ord.raw_payload?.reimbursement_payout_ref
                              ? 'bg-emerald-500/10 border-emerald-500/30'
                              : st.step === 3 && Number(ord.error_charge || 0) < -0.01
                              ? 'bg-rose-500/10 border-rose-500/30'
                              : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between font-extrabold text-slate-800 dark:text-slate-100 mb-1">
                            <span>
                              {st.step}. {isEn ? st.title_en : st.title_es}
                            </span>
                            <span className="font-mono">{fmtMoney(st.amount)}</span>
                          </div>
                          <p className="text-[11px] text-slate-600 dark:text-slate-300">
                            {isEn ? st.detail_en : st.detail_es}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB: CONEXIÓN Y COBERTURA DE LAS 15 SUCURSALES (P1 #9 & #16: OCULTA GUIDs TÉCNICOS POR DEFECTO) */}
      {activeTab === 'mappings' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-3.5 bg-slate-50/70 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-extrabold text-slate-700 dark:text-slate-200">
              {t('deliveryReconciliation.step_4_mappings')} ({mappings.length})
            </span>
            <button
              onClick={() => setShowAdvancedSupport((prev) => !prev)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300 transition"
            >
              🔧 {t('deliveryReconciliation.advanced_support_toggle')}{' '}
              <span>{showAdvancedSupport ? '▲' : '▼'}</span>
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs md:text-sm">
              <thead>
                <tr className="bg-slate-100 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800 font-bold">
                  <th className="p-3">{t('deliveryReconciliation.col_store')}</th>
                  <th className="p-3">Toast POS</th>
                  <th className="p-3">DoorDash</th>
                  <th className="p-3">Grubhub</th>
                  <th className="p-3">Uber Eats</th>
                  <th className="p-3">{t('deliveryReconciliation.col_actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {[...mappings]
                  .sort((a, b) => a.store_name.localeCompare(b.store_name, 'es'))
                  .map((m) => {
                    const stSync = syncStatus?.byStore?.[m.store_id]
                    const renderPlatCell = (plat: 'DOORDASH' | 'GRUBHUB' | 'UBER_EATS', techId: string) => {
                      const cov = getStorePlatformCoverageEntry(m.store_id, plat)
                      const status = cov?.status || 'NOT_CONNECTED'
                      const ordersCnt = Number(cov?.orders_count ?? 0)
                      const payoutsCnt = Number(cov?.payouts_count ?? 0)
                      const lastSyncTs = cov?.last_sync_at || null
                      const cause = isEn ? cov?.cause_en : cov?.cause_es
                      const nextAct = isEn ? cov?.next_action_en : cov?.next_action_es

                      const badgeClass =
                        status === 'COMPLETE'
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                          : status === 'PARTIAL'
                          ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30'
                          : status === 'FAILED'
                          ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30'
                          : 'bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700'

                      const badgeLabel =
                        status === 'COMPLETE'
                          ? t('deliveryReconciliation.coverage_status_COMPLETE')
                          : status === 'PARTIAL'
                          ? t('deliveryReconciliation.coverage_status_PARTIAL')
                          : status === 'FAILED'
                          ? t('deliveryReconciliation.coverage_status_FAILED')
                          : t('deliveryReconciliation.coverage_status_NOT_CONNECTED')

                      return (
                        <div className="space-y-1 text-xs">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold border ${badgeClass}`}>
                              {badgeLabel}
                            </span>
                            <span className="font-mono text-[11px] font-bold text-slate-700 dark:text-slate-300">
                              {ordersCnt} {t('deliveryReconciliation.ord_short')} / {payoutsCnt}{' '}
                              {t('deliveryReconciliation.cuts_short')}
                            </span>
                          </div>
                          {lastSyncTs && (
                            <div className="text-[10px] text-slate-500 font-mono">
                              {fmtLaTimestamp(lastSyncTs)}
                            </div>
                          )}
                          {status !== 'COMPLETE' && cause && (
                            <div className="text-[10px] text-rose-600 dark:text-rose-400">
                              {cause}
                            </div>
                          )}
                          {status !== 'COMPLETE' && nextAct && (
                            <div className="text-[10px] text-amber-700 dark:text-amber-300 font-semibold">
                              → {nextAct}
                            </div>
                          )}
                          {showAdvancedSupport && (
                            <div className="pt-1 border-t border-slate-200/70 dark:border-slate-800 font-mono text-[10px] text-slate-400">
                              ID: {techId || '-'}
                            </div>
                          )}
                        </div>
                      )
                    }

                    return (
                      <tr key={m.store_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 align-top">
                        <td className="p-3 font-bold whitespace-nowrap">
                          <div>{m.store_name}</div>
                          <span className="text-xs text-slate-400 font-normal">{m.store_code}</span>
                        </td>
                        <td className="p-3 text-xs">
                          <div className="font-bold text-emerald-700 dark:text-emerald-400">
                            {stSync?.toastOrders || 0} {t('deliveryReconciliation.ord_short')}
                          </div>
                          {stSync?.toastLastSync && (
                            <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                              {fmtLaTimestamp(stSync.toastLastSync)}
                            </div>
                          )}
                          {showAdvancedSupport && (
                            <div className="pt-1 mt-1 border-t border-slate-200/70 dark:border-slate-800 font-mono text-[10px] text-slate-400">
                              GUID: {m.toast_restaurant_guid}
                            </div>
                          )}
                        </td>
                        <td className="p-3">
                          {renderPlatCell('DOORDASH', m.doordash_store_id || m.doordash_merchant_store_id || '-')}
                        </td>
                        <td className="p-3">
                          {renderPlatCell('GRUBHUB', m.grubhub_cust_id || m.grubhub_merchant_id || '-')}
                        </td>
                        <td className="p-3">
                          {renderPlatCell('UBER_EATS', m.ubereats_store_uuid || '-')}
                        </td>
                        <td className="p-3 text-xs whitespace-nowrap">
                          <button
                            onClick={() => {
                              handleLiveSyncForStore({
                                storeId: String(m.store_id),
                                openOrdersTab: true,
                              })
                            }}
                            disabled={syncing}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold transition"
                          >
                            <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
                            {t('deliveryReconciliation.sync_this_store_btn')}
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

      {/* TAB: CORTES SEMANALES Y PÓLIZAS QUICKBOOKS (CON VALIDACIÓN DE BLOQUEOS Y CONFIRMACIÓN DE LOTE) */}
      {activeTab === 'qb_journals' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-3.5 bg-slate-50/70 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => setQbQuickFilter('ALL')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border ${
                  qbQuickFilter === 'ALL'
                    ? 'bg-slate-800 text-white border-slate-800 dark:bg-slate-200 dark:text-slate-900'
                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                }`}
              >
                {t('deliveryReconciliation.qb_filter_all_cuts', { count: qbRecords.length })}
              </button>
              <button
                onClick={() => setQbQuickFilter('PENDING')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border ${
                  qbQuickFilter === 'PENDING'
                    ? 'bg-amber-600 text-white border-amber-600'
                    : 'bg-white dark:bg-slate-900 text-amber-600 dark:text-amber-400 border-amber-500/30'
                }`}
              >
                {t('deliveryReconciliation.qb_filter_pending', {
                  count: qbSummary?.readyToPublishCount ?? qbSummary?.pendingCount ?? 0,
                })}
              </button>
              <button
                onClick={() => setQbQuickFilter('BLOCKED')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border ${
                  qbQuickFilter === 'BLOCKED'
                    ? 'bg-rose-600 text-white border-rose-600'
                    : 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 border-rose-500/30'
                }`}
              >
                {t('deliveryReconciliation.qb_badge_blocked')} ({qbSummary?.blockedCount || 0})
              </button>
              <button
                onClick={() => setQbQuickFilter('CREATED')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border ${
                  qbQuickFilter === 'CREATED'
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                }`}
              >
                {t('deliveryReconciliation.qb_filter_created', { count: qbSummary?.createdCount || 0 })}
              </button>

              {selectedVisiblePublishableRecords.length > 0 && (
                <button
                  onClick={() => setShowBatchConfirmModal(true)}
                  disabled={publishingQb}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-extrabold shadow-sm transition"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  {publishingQb
                    ? t('deliveryReconciliation.qb_publishing_short')
                    : t('deliveryReconciliation.qb_publish_selected_btn', {
                        count: selectedVisiblePublishableRecords.length,
                      })}
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {qbAuthError ? (
                <button
                  onClick={handleQuickBooksReauth}
                  className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-extrabold transition"
                >
                  ⚠ {t('deliveryReconciliation.qb_reconnect_btn')}
                </button>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs font-bold">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {t('deliveryReconciliation.qb_connected_short')}
                </span>
              )}

              <div className="inline-flex rounded-xl p-1 bg-slate-200/70 dark:bg-slate-800 border border-slate-300/60 dark:border-slate-700 text-xs font-bold">
                <button
                  onClick={() => {
                    setCutsSubView('qb')
                    setActiveTab('qb_journals')
                  }}
                  className={`px-2.5 py-1 rounded-lg transition ${
                    cutsSubView === 'qb'
                      ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {t('deliveryReconciliation.qb_subview_accounting')}
                </button>
                <button
                  onClick={() => {
                    setCutsSubView('bank')
                    setActiveTab('payouts')
                  }}
                  className={`px-2.5 py-1 rounded-lg transition ${
                    cutsSubView === 'bank'
                      ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {t('deliveryReconciliation.qb_subview_bank')}
                </button>
              </div>
            </div>
          </div>

          {qbLoading ? (
            <div className="p-12 text-center text-slate-500">{t('deliveryReconciliation.syncing_btn')}</div>
          ) : displayedQbRecords.length === 0 ? (
            <div className="p-12 text-center text-slate-500">{t('deliveryReconciliation.empty_payouts')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-[11px] xl:text-xs">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800 font-bold">
                    <th className="px-2 py-2.5 w-7 text-center">
                      <input
                        type="checkbox"
                        checked={
                          displayedQbRecords.filter((r) => !r.hasJournalEntry && r.canPublish).length > 0 &&
                          displayedQbRecords
                            .filter((r) => !r.hasJournalEntry && r.canPublish)
                            .every((r) => selectedQbPayoutIds.has(r.id))
                        }
                        onChange={(e) => {
                          if (e.target.checked) {
                            const next = new Set<string>()
                            displayedQbRecords
                              .filter((r) => !r.hasJournalEntry && r.canPublish)
                              .forEach((r) => next.add(r.id))
                            setSelectedQbPayoutIds(next)
                          } else {
                            setSelectedQbPayoutIds(new Set())
                          }
                        }}
                        className="rounded border-slate-300"
                      />
                    </th>
                    <th className="px-1.5 py-2">{t('deliveryReconciliation.qb_col_cut_week')}</th>
                    <th className="px-1.5 py-2">
                      {t('deliveryReconciliation.col_store')} / {t('deliveryReconciliation.col_platform')}
                    </th>
                    <th className="px-1.5 py-2 text-right max-w-[95px]">{t('deliveryReconciliation.qb_col_gross_recognized')}</th>
                    <th className="px-1.5 py-2 text-right max-w-[95px]">{t('deliveryReconciliation.qb_col_platform_fees')}</th>
                    <th className="px-1.5 py-2 text-right max-w-[95px]">{t('deliveryReconciliation.qb_col_refunds_errors')}</th>
                    <th className="px-1.5 py-2 text-right max-w-[95px] font-extrabold text-emerald-700 dark:text-emerald-400">
                      {t('deliveryReconciliation.qb_col_bank_deposit')}
                    </th>
                    <th className="px-1.5 py-2">{t('deliveryReconciliation.qb_col_policy_status')}</th>
                    <th className="px-1.5 py-2">{isEn ? 'Order Audit Status' : 'Estado de Auditoría'}</th>
                    <th className="px-1.5 py-2">{isEn ? 'Dispute / Recovery' : 'Disputa / Recuperación'}</th>
                    <th className="px-1.5 py-2 text-center">{t('deliveryReconciliation.qb_col_actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {displayedQbRecords.map((r) => {
                    const prev = r.journalPreview || {}
                    const audit = prev.auditBreakdown || {}
                    const line1 = prev.lines?.[0]
                    const line2 = prev.lines?.[1]
                    const line3 = prev.lines?.[2]
                    const line4 = prev.lines?.[3]
                    const isChecked = selectedQbPayoutIds.has(r.id)
                    const blockers: any[] = (r.publishBlockers || []).filter(
                      (b: any) => b.code !== 'ALREADY_PUBLISHED_IN_QBO'
                    )
                    const warnings: any[] = r.auditWarnings || prev.auditWarnings || []
                    const dispStat = r.disputeRecoveryStatus || {}

                    return (
                      <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition align-top">
                        <td className="px-2 py-2.5 text-center">
                          <input
                            type="checkbox"
                            disabled={r.hasJournalEntry || !r.canPublish}
                            checked={isChecked}
                            onChange={(e) => {
                              const next = new Set(selectedQbPayoutIds)
                              if (e.target.checked) next.add(r.id)
                              else next.delete(r.id)
                              setSelectedQbPayoutIds(next)
                            }}
                            className="rounded border-slate-300 disabled:opacity-40"
                          />
                        </td>
                        <td className="px-1.5 py-2 whitespace-nowrap">
                          <div className="font-bold text-slate-900 dark:text-white text-[11px]">
                            {fmtDateMDY(r.period_start)} → {fmtDateMDY(r.period_end)}
                          </div>
                          <div className="text-[10px] font-mono text-indigo-600 dark:text-indigo-400">
                            Ref: #{r.payout_reference_id}
                          </div>
                          {r.is_month_end_cutoff && (
                            <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-700 dark:text-orange-300 border border-orange-500/30 text-[9px] font-extrabold">
                              {t('deliveryReconciliation.gh_month_end_cut_badge')}
                            </span>
                          )}
                          {!r.is_month_end_cutoff && r.is_new_month_remainder && (
                            <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30 text-[9px] font-extrabold">
                              {t('deliveryReconciliation.gh_new_month_cut_badge')}
                            </span>
                          )}
                        </td>
                        <td className="px-1.5 py-2 whitespace-nowrap">
                          <div className="font-bold text-slate-900 dark:text-white mb-0.5">{r.store_name}</div>
                          <div>{renderPlatformBadge(r.platform)}</div>
                        </td>
                        <td className="px-1.5 py-2 text-right font-mono whitespace-nowrap">
                          <div className="font-bold text-indigo-600 dark:text-indigo-400">
                            {fmtMoney(line3?.amount || r.platform_gross_receivable)}
                          </div>
                          <div className="text-[10px] text-slate-400 max-w-[85px] 2xl:max-w-[125px] ml-auto truncate" title={line3?.accountName}>
                            {line3?.accountName}
                          </div>
                        </td>
                        <td className="px-1.5 py-2 text-right font-mono whitespace-nowrap">
                          <div className="font-bold text-amber-600 dark:text-amber-400">
                            -{fmtMoney(line2?.amount || r.total_fees)}
                          </div>
                          <div className="text-[10px] text-slate-400 max-w-[85px] 2xl:max-w-[125px] ml-auto truncate" title={line2?.accountName}>
                            {line2?.accountName}
                          </div>
                        </td>
                        <td className="px-1.5 py-2 text-right font-mono max-w-[95px] 2xl:max-w-[135px]">
                          {line4 ? (
                            <div>
                              <span
                                className={`font-extrabold ${
                                  line4.postingType === 'Credit'
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-rose-600 dark:text-rose-400'
                                }`}
                              >
                                {line4.postingType === 'Credit' ? '+' : '-'}
                                {fmtMoney(line4.amount)}
                              </span>
                              <div className="text-[10px] text-slate-400 max-w-[85px] 2xl:max-w-[125px] ml-auto truncate" title={line4.accountName}>
                                {line4.accountName}
                              </div>
                            </div>
                          ) : (
                            <span className="text-slate-400">$0.00</span>
                          )}
                          {Array.isArray(audit.crossPayoutRefunds) &&
                            audit.crossPayoutRefunds.map((cr: any, idx: number) => (
                              <div
                                key={idx}
                                className="mt-0.5 text-[10px] leading-tight font-extrabold text-emerald-600 dark:text-emerald-400"
                              >
                                {t('deliveryReconciliation.qb_reimb_short', {
                                  order: cr.orderCode,
                                  amount: fmtMoney(cr.amount),
                                })}
                              </div>
                            ))}
                        </td>
                        <td className="px-1.5 py-2 text-right font-mono whitespace-nowrap">
                          <div className="font-extrabold text-emerald-600 dark:text-emerald-400">
                            {fmtMoney(line1?.amount || r.net_payout_amount)}
                          </div>
                          <div className="text-[10px] text-slate-400 max-w-[85px] 2xl:max-w-[125px] ml-auto truncate" title={line1?.accountName}>
                            {line1?.accountName}
                          </div>
                          {r.bankVerification?.status === 'VERIFIED_IN_BANK' && (
                            <div className="mt-1">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                                🏦 {t('deliveryReconciliation.bank_verified_badge')}
                              </span>
                            </div>
                          )}
                          {r.bankVerification?.status === 'JE_POSTED_IN_TRANSIT' && (
                            <div className="mt-1">
                              <span
                                title={
                                  isEn
                                    ? 'Journal Entry posted in QBO; bank feed deposit confirmation is independent.'
                                    : 'Póliza registrada en QBO; la confirmación del depósito en banco es independiente.'
                                }
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30"
                              >
                                🧾 {t('deliveryReconciliation.bank_je_posted_badge')}
                              </span>
                            </div>
                          )}
                        </td>

                        {/* 1. ESTADO DEL PAYOUT / PÓLIZA QBO (INDEPENDIENTE DE AUDITORÍA) */}
                        <td className="px-2 py-2.5 max-w-[165px]">
                          {r.recoveryRequired ? (
                            <div className="flex flex-col gap-1 items-start">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-500/15 text-rose-700 border border-rose-500/30">
                                {t('deliveryReconciliation.qb_badge_recovery')}
                              </span>
                              <span className="text-[10px] text-rose-600 dark:text-rose-400">
                                {isEn
                                  ? 'Check QBO before retrying.'
                                  : 'Consultar QBO antes de reintentar.'}
                              </span>
                            </div>
                          ) : r.hasJournalEntry ? (
                            <div className="flex flex-col gap-0.5 items-start">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                {t('deliveryReconciliation.qb_badge_created')}
                              </span>
                              {r.qbJournalEntry?.docNumber && (
                                <span className="text-[10px] font-mono font-bold text-slate-500">
                                  JE #{r.qbJournalEntry.docNumber} (ID {r.qbJournalEntry.id})
                                </span>
                              )}
                            </div>
                          ) : !r.canPublish ? (
                            <div className="flex flex-col gap-1 items-start">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30">
                                {r.qboMatchEvaluation?.classification === 'HISTORICAL_CANDIDATE_PENDING_REVIEW'
                                  ? isEn
                                    ? 'Historical Candidate'
                                    : 'Candidato Histórico QBO'
                                  : t('deliveryReconciliation.qb_badge_blocked')}
                              </span>
                              {blockers[0] && (
                                <div className="text-[10px] text-rose-600 dark:text-rose-400 max-w-[160px] leading-tight space-y-0.5">
                                  <div className="line-clamp-2">{isEn ? blockers[0].message_en : blockers[0].message_es}</div>
                                  {(blockers[0].next_action_es || blockers[0].next_action_en) && (
                                    <div className="font-bold text-rose-700 dark:text-rose-300 line-clamp-2">
                                      → {isEn ? blockers[0].next_action_en : blockers[0].next_action_es}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1 items-start">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                                {t('deliveryReconciliation.qb_badge_pending')}
                              </span>
                              <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold">
                                {isEn ? 'Ready to post 4-line JE' : 'Listo para crear póliza'}
                              </span>
                            </div>
                          )}
                        </td>

                        {/* 2. ESTADO DE AUDITORÍA DE ÓRDENES (SIEMPRE VISIBLE AUNQUE LA PÓLIZA ESTÉ CREADA) */}
                        <td className="px-2 py-2.5 max-w-[175px]">
                          {warnings.length === 0 ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25">
                              ✓ {isEn ? 'Order audit clean' : 'Auditoría sin alertas'}
                            </span>
                          ) : (
                            <div
                              className="flex flex-col gap-1 items-start"
                              title={`${isEn ? warnings[0].message_en : warnings[0].message_es}${
                                warnings[0].next_action_es || warnings[0].next_action_en
                                  ? ` → ${isEn ? warnings[0].next_action_en : warnings[0].next_action_es}`
                                  : ''
                              }`}
                            >
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                                ⚠{' '}
                                {isEn
                                  ? `${warnings.length} audit alert(s) pending`
                                  : `${warnings.length} alerta(s) de auditoría`}
                              </span>
                              <div className="text-[10px] text-amber-800 dark:text-amber-300 max-w-[170px] leading-tight space-y-0.5">
                                <div className="line-clamp-2">{isEn ? warnings[0].message_en : warnings[0].message_es}</div>
                                {(warnings[0].next_action_es || warnings[0].next_action_en) && (
                                  <div className="font-bold text-indigo-600 dark:text-indigo-400 line-clamp-2">
                                    → {isEn ? warnings[0].next_action_en : warnings[0].next_action_es}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </td>

                        {/* 3. ESTADO DE DISPUTA / RECUPERACIÓN (SEPARADO) */}
                        <td className="px-2 py-2.5 max-w-[135px]">
                          {dispStat.code === 'PARTIAL_RECOVERY' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                              ⚠️ {isEn ? dispStat.label_en : dispStat.label_es}
                            </span>
                          ) : dispStat.code === 'FULL_RECOVERY' || dispStat.code === 'POSITIVE_REIMBURSEMENT' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                              ✅ {isEn ? dispStat.label_en : dispStat.label_es}
                            </span>
                          ) : dispStat.code === 'OPEN_DISPUTES' || dispStat.code === 'UNVERIFIED_RECOVERY' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30">
                              🚨 {isEn ? dispStat.label_en : dispStat.label_es}
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-400">
                              {isEn ? 'No disputes' : 'Sin disputas'}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2.5 text-center whitespace-nowrap">
                          <div className="flex flex-col items-stretch justify-center gap-1">
                            <button
                              onClick={() => {
                                // P1 #15: Filtrar estrictamente por payout_reference_id al auditar órdenes de un corte
                                setSelectedStore(String(r.store_id))
                                setSelectedPlatform(r.platform)
                                if (r.period_start && r.period_end) {
                                  setStartDate(r.period_start)
                                  setEndDate(r.period_end)
                                }
                                setActivePayoutRef(r.payout_reference_id)
                                setSelectedActionGroup('ALL')
                                setActiveTab('orders')
                              }}
                              title={t('deliveryReconciliation.qb_audit_orders_tooltip')}
                              className="inline-flex items-center justify-center gap-1 px-2 py-1 rounded-lg text-[11px] font-extrabold bg-indigo-50 hover:bg-indigo-600 hover:text-white dark:bg-indigo-950/50 dark:hover:bg-indigo-600 text-indigo-700 dark:text-indigo-300 transition border border-indigo-200 dark:border-indigo-800"
                            >
                              {t('deliveryReconciliation.qb_audit_orders_btn')}
                            </button>
                            <button
                              onClick={() => handleOpenQbModal(r)}
                              className={`inline-flex items-center justify-center gap-1 px-2 py-1 rounded-lg text-[11px] font-extrabold transition ${
                                r.hasJournalEntry || !r.canPublish
                                  ? 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'
                                  : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm'
                              }`}
                            >
                              <Eye className="w-3.5 h-3.5" />
                              {r.hasJournalEntry || !r.canPublish
                                ? t('deliveryReconciliation.qb_view_policy_btn')
                                : t('deliveryReconciliation.qb_create_policy_btn')}
                            </button>
                          </div>
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

      {/* MODAL DE CONFIRMACIÓN FINAL PARA PUBLICACIÓN MASIVA EN QUICKBOOKS (P1 #15) */}
      {showBatchConfirmModal && selectedVisiblePublishableRecords.length > 0 && (() => {
        const uniqueStores = Array.from(new Set(selectedVisiblePublishableRecords.map((r) => r.store_name)))
        const uniquePlatforms = Array.from(new Set(selectedVisiblePublishableRecords.map((r) => r.platform)))
        const payoutRefs = selectedVisiblePublishableRecords.map((r) => `#${r.payout_reference_id}`)
        const totalNet = selectedVisiblePublishableRecords.reduce(
          (acc, r) => acc + Number(r.net_payout_amount || 0),
          0
        )

        return (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-xl w-full p-6 space-y-4 shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                <h3 className="text-lg font-extrabold">{t('deliveryReconciliation.batch_confirm_modal_title')}</h3>
                <button
                  onClick={() => setShowBatchConfirmModal(false)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-300">
                {t('deliveryReconciliation.batch_confirm_modal_desc')}
              </p>

              <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-2.5 text-xs">
                <div className="flex justify-between">
                  <span className="font-bold text-slate-500">{t('deliveryReconciliation.batch_confirm_count')}</span>
                  <span className="font-mono font-extrabold text-sm">{selectedVisiblePublishableRecords.length}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="font-bold text-slate-500 shrink-0">{t('deliveryReconciliation.batch_confirm_stores')}</span>
                  <span className="font-semibold text-right">{uniqueStores.join(', ')}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="font-bold text-slate-500 shrink-0">{t('deliveryReconciliation.batch_confirm_platforms')}</span>
                  <span className="font-semibold text-right">{uniquePlatforms.join(', ')}</span>
                </div>
                <div>
                  <span className="font-bold text-slate-500 block mb-1">
                    {t('deliveryReconciliation.batch_confirm_payout_refs')}
                  </span>
                  <div className="font-mono text-[11px] bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-200 dark:border-slate-700 max-h-28 overflow-y-auto">
                    {payoutRefs.join(', ')}
                  </div>
                </div>
                <div className="flex justify-between pt-2 border-t border-slate-200 dark:border-slate-700 text-sm">
                  <span className="font-extrabold text-emerald-700 dark:text-emerald-400">
                    {t('deliveryReconciliation.batch_confirm_net_total')}
                  </span>
                  <span className="font-mono font-extrabold text-emerald-600 dark:text-emerald-400">
                    {fmtMoney(totalNet)}
                  </span>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  onClick={() => setShowBatchConfirmModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold"
                >
                  {t('deliveryReconciliation.modal_close')}
                </button>
                <button
                  onClick={() =>
                    handlePublishQbJournalEntries(selectedVisiblePublishableRecords.map((r) => r.id))
                  }
                  disabled={publishingQb}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-extrabold shadow-sm"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  {publishingQb
                    ? t('deliveryReconciliation.qb_creating_btn')
                    : t('deliveryReconciliation.batch_confirm_btn')}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* MODAL INDIVIDUAL DE PÓLIZA QUICKBOOKS (JOURNAL ENTRY) */}
      {selectedQbRecord && (() => {
        const prev = selectedQbRecord.journalPreview || {}
        const embeddedTax = Number(prev.embeddedRefundTax || 0)
        const rawErrAdj = Number(prev.rawErrAdj || 0)
        const blockers: any[] = (selectedQbRecord.publishBlockers || []).filter(
          (b: any) => b.code !== 'ALREADY_PUBLISHED_IN_QBO'
        )
        const warnings: any[] = selectedQbRecord.auditWarnings || prev.auditWarnings || []
        const qboCandidates: any[] = selectedQbRecord.qboMatchEvaluation?.candidates || []
        const dispStat = selectedQbRecord.disputeRecoveryStatus || {}

        const modalLines = (() => {
          const baseLines: any[] = prev.lines || []
          if (!jeModalSplitTax || selectedQbRecord.platform === 'UBER_EATS' || embeddedTax <= 0.01 || rawErrAdj >= 0) {
            return baseLines
          }
          const firstThree = baseLines.slice(0, 3)
          const line4Orig = baseLines[3]
          if (!line4Orig) return baseLines
          const subPortion = Number((Math.abs(rawErrAdj) - embeddedTax).toFixed(2))
          return [
            ...firstThree,
            {
              ...line4Orig,
              lineNumber: 4,
              amount: subPortion,
              description: `${line4Orig.description} (Subtotal excl. Real Tax)`,
            },
            {
              lineNumber: 5,
              accountNumber: '24001',
              accountQbId: '40',
              accountName: '24001 Sales tax payable',
              postingType: 'Debit',
              amount: embeddedTax,
              description: `${line4Orig.description} (Reversión Sales Tax Real 24001)`,
              locationName: line4Orig.locationName,
              className: line4Orig.className,
            },
          ]
        })()

        return (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-5xl w-full p-6 space-y-5 shadow-2xl max-h-[92vh] overflow-y-auto">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    {renderPlatformBadge(selectedQbRecord.platform)}
                    <h3 className="text-lg font-extrabold">{t('deliveryReconciliation.qb_modal_title')}</h3>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {t('deliveryReconciliation.qb_modal_subtitle', {
                      store: selectedQbRecord.store_name,
                      ref: selectedQbRecord.payout_reference_id,
                      start: fmtDateMDY(selectedQbRecord.period_start),
                      end: fmtDateMDY(selectedQbRecord.period_end),
                    })}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedQbRecord(null)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* TRES ESTADOS INDEPENDIENTES DEL CORTE: (1) PÓLIZA QBO Y BANCO, (2) AUDITORÍA DE ÓRDENES, (3) DISPUTAS Y RECUPERACIÓN */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/50 space-y-1">
                  <div className="text-[10px] font-extrabold uppercase text-slate-500">
                    {isEn ? '1. Payout / QBO Entry Status' : '1. Estado del Payout / Póliza QBO'}
                  </div>
                  <div className="font-extrabold text-slate-900 dark:text-white">
                    {isEn
                      ? selectedQbRecord.payoutPolicyStatus?.label_en ||
                        (selectedQbRecord.hasJournalEntry ? 'Posted in QBO' : 'Pending QBO Entry')
                      : selectedQbRecord.payoutPolicyStatus?.label_es ||
                        (selectedQbRecord.hasJournalEntry ? 'Póliza registrada en QBO' : 'Pendiente de Póliza')}
                  </div>
                  <div className="text-[11px] text-indigo-700 dark:text-indigo-300 font-semibold">
                    {isEn
                      ? selectedQbRecord.bankVerification?.label_en
                      : selectedQbRecord.bankVerification?.label_es}
                  </div>
                </div>

                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/50 space-y-1">
                  <div className="text-[10px] font-extrabold uppercase text-slate-500">
                    {isEn ? '2. Order Audit Status (Independent)' : '2. Estado de Auditoría de Órdenes'}
                  </div>
                  <div
                    className={`font-extrabold ${
                      warnings.length === 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-amber-700 dark:text-amber-300'
                    }`}
                  >
                    {isEn
                      ? selectedQbRecord.auditStatus?.label_en ||
                        (warnings.length === 0 ? 'Order audit clean' : `${warnings.length} audit alert(s)`)
                      : selectedQbRecord.auditStatus?.label_es ||
                        (warnings.length === 0 ? 'Auditoría sin alertas' : `${warnings.length} alerta(s) pendiente(s)`)}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {isEn
                      ? 'Publishing a QBO entry does not erase pending order alerts.'
                      : 'Publicar la póliza no borra ni da por conciliadas las alertas de órdenes.'}
                  </div>
                </div>

                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/50 space-y-1">
                  <div className="text-[10px] font-extrabold uppercase text-slate-500">
                    {isEn ? '3. Dispute / Recovery Status' : '3. Estado de Disputa / Recuperación'}
                  </div>
                  <div
                    className={`font-extrabold ${
                      dispStat.code === 'OPEN_DISPUTES' || dispStat.code === 'UNVERIFIED_RECOVERY'
                        ? 'text-rose-700 dark:text-rose-400'
                        : dispStat.code === 'PARTIAL_RECOVERY'
                        ? 'text-amber-700 dark:text-amber-300'
                        : 'text-emerald-700 dark:text-emerald-400'
                    }`}
                  >
                    {isEn ? dispStat.label_en || 'No disputes' : dispStat.label_es || 'Sin disputas'}
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono">
                    {isEn ? 'Net Refunds / Error Charges:' : 'Reembolsos / Cargos por Error:'}{' '}
                    {fmtMoney(rawErrAdj)}
                  </div>
                </div>
              </div>

              {selectedQbRecord.hasJournalEntry && selectedQbRecord.qbJournalEntry && (
                <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between text-emerald-800 dark:text-emerald-200 text-xs md:text-sm font-bold">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                    <span>
                      {t('deliveryReconciliation.qb_modal_already_created_banner', {
                        doc: selectedQbRecord.qbJournalEntry.docNumber || '-',
                        id: selectedQbRecord.qbJournalEntry.id,
                        date: fmtDateMDY(selectedQbRecord.qbJournalEntry.txnDate),
                      })}
                    </span>
                  </div>
                </div>
              )}

              {selectedQbRecord.bankVerification && (
                <div
                  className={`p-3.5 rounded-xl border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                    selectedQbRecord.bankVerification.status === 'VERIFIED_IN_BANK'
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-200'
                      : selectedQbRecord.bankVerification.status === 'JE_POSTED_IN_TRANSIT'
                      ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-800 dark:text-indigo-200'
                      : 'bg-slate-100 dark:bg-slate-800/70 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="space-y-0.5">
                    <div className="font-extrabold flex items-center gap-1.5">
                      <Landmark className="w-4 h-4 shrink-0" />
                      <span>{t('deliveryReconciliation.bank_modal_title')}</span>
                    </div>
                    <p className="text-[11px] opacity-90">
                      {isEn
                        ? selectedQbRecord.bankVerification.label_en
                        : selectedQbRecord.bankVerification.label_es}
                    </p>
                  </div>
                  <div className="font-mono font-extrabold text-right shrink-0">
                    <div>{fmtMoney(selectedQbRecord.bankVerification.expectedDepositAmount)}</div>
                    <div className="text-[10px] opacity-80">
                      {isEn ? 'Acct' : 'Cta'} {selectedQbRecord.bankVerification.bankAccountNum}
                    </div>
                  </div>
                </div>
              )}

              {/* PANEL DE VERIFICACIÓN DE ESTADO DE RECUPERACIÓN (RECOVERY_REQUIRED) */}
              {selectedQbRecord.recoveryRequired && (
                <div className="p-4 rounded-xl bg-rose-500/10 border-2 border-rose-500/40 space-y-2.5 text-xs">
                  <div className="font-extrabold text-rose-800 dark:text-rose-200 flex items-center justify-between gap-2">
                    <span>
                      ⚠️{' '}
                      {isEn
                        ? 'Recovery State Required (RECOVERY_REQUIRED): Verify QuickBooks Online before retrying'
                        : 'Estado de Recuperación (RECOVERY_REQUIRED): Consultar QuickBooks Online antes de reintentar'}
                    </span>
                    <button
                      onClick={() => handleVerifyQboRecoveryStatus(selectedQbRecord.id)}
                      disabled={resolvingQboCandidate}
                      className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-extrabold shadow-sm"
                    >
                      {resolvingQboCandidate
                        ? isEn
                          ? 'Checking QBO...'
                          : 'Consultando QBO...'
                        : isEn
                        ? 'Verify Status in QBO Now'
                        : 'Verificar Estado en QBO Ahora'}
                    </button>
                  </div>
                </div>
              )}

              {/* PANEL DE CANDIDATOS DE PÓLIZAS HISTÓRICAS EN QBO PARA CONFIRMAR O DESCARTAR CON AUDITORÍA */}
              {!selectedQbRecord.hasJournalEntry && qboCandidates.length > 0 && (
                <div className="p-4 rounded-xl bg-amber-500/10 border-2 border-amber-500/40 space-y-3 text-xs">
                  <div className="font-extrabold text-amber-900 dark:text-amber-200">
                    🔍{' '}
                    {isEn
                      ? `Historical QuickBooks Journal Entry Candidate(s) Found (${qboCandidates.length}) — Confirm Link or Discard:`
                      : `Posible(s) Póliza(s) Histórica(s) en QuickBooks Detectada(s) (${qboCandidates.length}) — Confirmar Vínculo o Descartar:`}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                        {isEn ? 'Reason (Mandatory, min 5 chars):' : 'Motivo (Obligatorio, mín. 5 caracteres):'}
                      </label>
                      <input
                        type="text"
                        value={qboCandidateReason}
                        onChange={(e) => setQboCandidateReason(e.target.value)}
                        placeholder={
                          isEn
                            ? 'e.g. Verified historical settlement entry posted by accounting'
                            : 'Ej. Póliza histórica verificada por contabilidad para este corte'
                        }
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                        {isEn ? 'Verifiable Evidence (DocNumber / Date / Bank):' : 'Evidencia Verificable (DocNumber / Fecha / Banco):'}
                      </label>
                      <input
                        type="text"
                        value={qboCandidateEvidence}
                        onChange={(e) => setQboCandidateEvidence(e.target.value)}
                        placeholder="QBO DocNumber / TxnDate / Bank Deposit"
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-mono"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    {qboCandidates.map((cand: any) => (
                      <div
                        key={cand.id}
                        className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                      >
                        <div className="space-y-0.5">
                          <div className="font-mono font-extrabold text-slate-900 dark:text-white">
                            QBO ID #{cand.id} • Doc #{cand.docNumber || '—'} • {fmtDateMDY(cand.txnDate)}
                          </div>
                          <div className="text-[11px] text-slate-600 dark:text-slate-300 font-mono">
                            Bank Debit: {fmtMoney(cand.bankDebitAmount)} | Receivable Credit:{' '}
                            {fmtMoney(cand.receivableCreditAmount)}
                          </div>
                          {cand.privateNote && (
                            <div className="text-[10px] text-slate-400 truncate max-w-xl">
                              Note: {cand.privateNote}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() =>
                              handleResolveHistoricalQboCandidate({
                                payoutId: selectedQbRecord.id,
                                jeId: cand.id,
                                docNumber: cand.docNumber,
                                txnDate: cand.txnDate,
                                decision: 'confirm_qbo_candidate',
                              })
                            }
                            disabled={resolvingQboCandidate}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-extrabold"
                          >
                            {isEn ? 'Confirm & Link' : 'Confirmar y Vincular'}
                          </button>
                          <button
                            onClick={() =>
                              handleResolveHistoricalQboCandidate({
                                payoutId: selectedQbRecord.id,
                                jeId: cand.id,
                                docNumber: cand.docNumber,
                                txnDate: cand.txnDate,
                                decision: 'discard_qbo_candidate',
                              })
                            }
                            disabled={resolvingQboCandidate}
                            className="px-3 py-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-50 text-rose-700 dark:text-rose-300 font-bold"
                          >
                            {isEn ? 'Discard Candidate' : 'Descartar Candidato'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {blockers.length > 0 && !selectedQbRecord.hasJournalEntry && (
                <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 space-y-2 text-rose-800 dark:text-rose-200 text-xs">
                  <div className="font-extrabold flex items-center gap-1.5">
                    <Lock className="w-4 h-4 text-rose-600" />
                    {isEn ? 'Publication blocked by accounting safety rules:' : 'Publicación bloqueada por seguridad contable:'}
                  </div>
                  {blockers.map((b, idx) => (
                    <div key={idx} className="pl-5 space-y-0.5">
                      <div className="font-bold">• {isEn ? b.message_en : b.message_es}</div>
                      {(b.cause_es || b.cause_en) && (
                        <div className="text-[11px] opacity-90">
                          <strong>{isEn ? 'Cause:' : 'Causa:'}</strong> {isEn ? b.cause_en : b.cause_es}
                        </div>
                      )}
                      {(b.next_action_es || b.next_action_en) && (
                        <div className="text-[11px] font-bold text-rose-700 dark:text-rose-300">
                          → <strong>{isEn ? 'Next action:' : 'Siguiente acción:'}</strong>{' '}
                          {isEn ? b.next_action_en : b.next_action_es}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* ALERTAS DE AUDITORÍA SIEMPRE VISIBLES INCLUSO SI LA PÓLIZA QBO YA FUE PUBLICADA */}
              {warnings.length > 0 && (
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2 text-amber-800 dark:text-amber-200 text-xs">
                  <div className="font-extrabold flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    {isEn
                      ? 'Informative order-by-order audit alerts (independent from QBO Journal Entry status):'
                      : 'Alertas informativas de auditoría de órdenes (independientes del estado de la póliza QBO):'}
                  </div>
                  {warnings.map((w, idx) => (
                    <div key={idx} className="pl-5 space-y-0.5">
                      <div className="font-bold">• {isEn ? w.message_en : w.message_es}</div>
                      {(w.cause_es || w.cause_en) && (
                        <div className="text-[11px] opacity-90">
                          <strong>{isEn ? 'Cause:' : 'Causa:'}</strong> {isEn ? w.cause_en : w.cause_es}
                        </div>
                      )}
                      {(w.next_action_es || w.next_action_en) && (
                        <div className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
                          → <strong>{isEn ? 'Next action:' : 'Siguiente acción:'}</strong>{' '}
                          {isEn ? w.next_action_en : w.next_action_es}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">
                    {t('deliveryReconciliation.qb_modal_date_label')}
                  </label>
                  <input
                    type="date"
                    value={jeModalDate}
                    onChange={(e) => setJeModalDate(e.target.value)}
                    disabled={selectedQbRecord.hasJournalEntry}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-mono font-bold disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">
                    {t('deliveryReconciliation.qb_modal_doc_num_label')}
                  </label>
                  <input
                    type="text"
                    value={jeModalDocNumber}
                    onChange={(e) => setJeModalDocNumber(e.target.value)}
                    disabled={selectedQbRecord.hasJournalEntry}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-mono font-bold disabled:opacity-60"
                  />
                </div>
                <div className="flex flex-col justify-center">
                  {selectedQbRecord.platform !== 'UBER_EATS' && embeddedTax > 0.01 && rawErrAdj < 0 ? (
                    <label className="flex items-start gap-2 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={jeModalSplitTax}
                        onChange={(e) => setJeModalSplitTax(e.target.checked)}
                        disabled={selectedQbRecord.hasJournalEntry}
                        className="mt-0.5 rounded border-slate-300"
                      />
                      <div>
                        <span className="font-extrabold text-amber-700 dark:text-amber-300 block">
                          {t('deliveryReconciliation.qb_modal_split_tax_label')} (+{fmtMoney(embeddedTax)})
                        </span>
                        <span className="text-[11px] text-slate-500">
                          {t('deliveryReconciliation.qb_modal_debit_24001_hint', {
                            amount: fmtMoney(embeddedTax),
                          })}
                        </span>
                      </div>
                    </label>
                  ) : (
                    <div className="text-xs text-slate-500">
                      <span className="font-bold text-slate-700 dark:text-slate-200 block">
                        {t('deliveryReconciliation.qb_modal_tax_rule_label', {
                          platform: selectedQbRecord.platform,
                        })}
                      </span>
                      {selectedQbRecord.platform === 'UBER_EATS'
                        ? t('deliveryReconciliation.qb_modal_tax_rule_uber')
                        : t('deliveryReconciliation.qb_modal_tax_rule_no_err')}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs md:text-sm font-extrabold uppercase text-slate-600 dark:text-slate-300">
                    {t('deliveryReconciliation.qb_modal_lines_title')}
                  </h4>
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-extrabold ${
                      prev.isBalanced
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                        : 'bg-rose-500/15 text-rose-700'
                    }`}
                  >
                    {prev.isBalanced ? '✓' : '✗'} Total Debits ({fmtMoney(prev.totalDebits)}) = Total Credits (
                    {fmtMoney(prev.totalCredits)})
                  </span>
                </div>

                <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-xl">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-100 dark:bg-slate-800 font-bold text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                        <th className="p-2.5">#</th>
                        <th className="p-2.5">ACCOUNT</th>
                        <th className="p-2.5 text-right">DEBITS</th>
                        <th className="p-2.5 text-right">CREDITS</th>
                        <th className="p-2.5">DESCRIPTION</th>
                        <th className="p-2.5">LOCATION</th>
                        <th className="p-2.5">CLASS</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {modalLines.map((l: any) => (
                        <tr key={l.lineNumber} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="p-2.5 font-mono text-slate-400">{l.lineNumber}</td>
                          <td className="p-2.5 font-bold text-slate-900 dark:text-white">{l.accountName}</td>
                          <td className="p-2.5 text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">
                            {l.postingType === 'Debit' ? fmtMoney(l.amount) : ''}
                          </td>
                          <td className="p-2.5 text-right font-mono font-bold text-indigo-700 dark:text-indigo-400">
                            {l.postingType === 'Credit' ? fmtMoney(l.amount) : ''}
                          </td>
                          <td className="p-2.5 font-mono text-slate-600 dark:text-slate-300">{l.description}</td>
                          <td className="p-2.5 font-semibold">{l.locationName}</td>
                          <td className="p-2.5 font-semibold">{l.className}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  onClick={() => setSelectedQbRecord(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold"
                >
                  {t('deliveryReconciliation.modal_close')}
                </button>
                {!selectedQbRecord.hasJournalEntry && selectedQbRecord.canPublish && (
                  <button
                    onClick={() =>
                      handlePublishQbJournalEntries([selectedQbRecord.id], {
                        txnDate: jeModalDate,
                        docNumber: jeModalDocNumber,
                        splitTaxOnRefunds: jeModalSplitTax,
                      })
                    }
                    disabled={publishingQb}
                    className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-extrabold shadow-sm transition"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    {publishingQb
                      ? t('deliveryReconciliation.qb_creating_btn')
                      : t('deliveryReconciliation.qb_modal_publish_btn')}
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* MODAL DE CONFIRMACIÓN PARA ACCIONES MASIVAS DE ÓRDENES (P0 #7: VARIANZA O DISPUTA) */}
      {batchOrderConfirmModal && selectedVisibleOrders.length > 0 && (() => {
        const isVarianceBatch = batchOrderConfirmModal.actionType === 'APPROVE_VARIANCE'
        const uniqueStores = Array.from(new Set(selectedVisibleOrders.map((o) => o.store_name)))
        const uniquePlatforms = Array.from(new Set(selectedVisibleOrders.map((o) => o.platform)))
        const uniquePayoutRefs = Array.from(
          new Set(
            selectedVisibleOrders
              .map((o) => (o.payout_reference_id ? `#${o.payout_reference_id}` : ''))
              .filter(Boolean)
          )
        )
        const totalAmount = selectedVisibleOrders.reduce((acc, o) => {
          if (isVarianceBatch) {
            return acc + Math.abs(Number(o.gross_variance ?? o.gross_diff ?? 0))
          }
          return acc + Math.abs(Number(o.dispute_amount || o.error_charge || o.adjustment_amount || 0))
        }, 0)

        return (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-xl w-full p-6 space-y-4 shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                <h3 className="text-lg font-extrabold">
                  {t('deliveryReconciliation.batch_action_confirm_title')}
                </h3>
                <button
                  onClick={() => setBatchOrderConfirmModal(null)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-300 font-semibold">
                {isVarianceBatch
                  ? t('deliveryReconciliation.batch_action_effect_variance')
                  : t('deliveryReconciliation.batch_action_effect_dispute')}
              </p>

              <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="font-bold text-slate-500">
                    {t('deliveryReconciliation.batch_selected_count', { count: selectedVisibleOrders.length })}
                  </span>
                  <span className="font-mono font-extrabold text-sm">{fmtMoney(totalAmount)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="font-bold text-slate-500 shrink-0">
                    {t('deliveryReconciliation.batch_confirm_stores')}
                  </span>
                  <span className="font-semibold text-right">{uniqueStores.join(', ')}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="font-bold text-slate-500 shrink-0">
                    {t('deliveryReconciliation.batch_confirm_platforms')}
                  </span>
                  <span className="font-semibold text-right">{uniquePlatforms.join(', ')}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="font-bold text-slate-500 shrink-0">
                    {t('deliveryReconciliation.batch_confirm_payout_refs')}
                  </span>
                  <span className="font-mono text-right">
                    {uniquePayoutRefs.length > 0 ? uniquePayoutRefs.join(', ') : '—'}
                  </span>
                </div>
                <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                  <div className="font-bold text-slate-500 mb-1">
                    {isEn ? 'Selected orders:' : 'Órdenes seleccionadas:'}
                  </div>
                  <div className="max-h-36 overflow-y-auto space-y-1 font-mono text-[11px] bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-200 dark:border-slate-700">
                    {selectedVisibleOrders.map((o) => (
                      <div key={o.id} className="flex justify-between">
                        <span>
                          #{o.platform_order_id} • {o.store_name}
                        </span>
                        <span className="font-bold">
                          {fmtMoney(
                            isVarianceBatch
                              ? Number(o.gross_variance ?? o.gross_diff ?? 0)
                              : Number(o.dispute_amount || o.error_charge || 0)
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  onClick={() => setBatchOrderConfirmModal(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold"
                >
                  {t('deliveryReconciliation.modal_close')}
                </button>
                <button
                  onClick={async () => {
                    const targetOrderIds = selectedVisibleOrders.map((o) => o.id)
                    setBatchOrderConfirmModal(null)
                    if (isVarianceBatch) {
                      await handleBatchApproveVariance(targetOrderIds)
                    } else {
                      await handleBatchMarkDisputeSubmitted(targetOrderIds)
                    }
                  }}
                  disabled={savingDispute}
                  className={`px-5 py-2 rounded-xl text-white text-sm font-extrabold shadow-sm ${
                    isVarianceBatch ? 'bg-amber-600 hover:bg-amber-700' : 'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  {isVarianceBatch
                    ? t('deliveryReconciliation.batch_approve_variance_btn')
                    : t('deliveryReconciliation.batch_mark_submitted_btn')}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* MODAL DETALLE DE ORDEN, TRAZABILIDAD DE 4 ETAPAS Y RESOLUCIÓN */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-3xl w-full p-6 space-y-5 shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  {renderPlatformBadge(selectedOrder.platform)}
                  <h3 className="text-lg font-extrabold">{t('deliveryReconciliation.modal_order_detail_title')}</h3>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {selectedOrder.store_name} • {fmtDateMDY(selectedOrder.business_date)} • #{selectedOrder.platform_order_id}
                </p>
              </div>
              <button
                onClick={() => setSelectedOrder(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* TRAZABILIDAD COMPLETA DE 4 ETAPAS (ORDEN ORIGINAL -> ORDEN PLATAFORMA -> PAYOUT -> DISPUTA/RECUPERACIÓN) */}
            {Array.isArray(selectedOrder.lifecycle_trace) && (
              <div className="space-y-2">
                <div className="text-xs font-extrabold uppercase text-indigo-600 dark:text-indigo-400">
                  {t('deliveryReconciliation.trace_title')}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {selectedOrder.lifecycle_trace.map((st) => (
                    <div
                      key={st.step}
                      className={`rounded-xl p-3 border text-xs ${
                        st.step === 4 && selectedOrder.raw_payload?.reimbursement_payout_ref
                          ? 'bg-emerald-500/10 border-emerald-500/30'
                          : st.step === 3 && Number(selectedOrder.error_charge || 0) < -0.01
                          ? 'bg-rose-500/10 border-rose-500/30'
                          : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between font-extrabold mb-1">
                        <span>
                          {st.step}. {isEn ? st.title_en : st.title_es}
                        </span>
                        <span className="font-mono">{fmtMoney(st.amount)}</span>
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-slate-300">
                        {isEn ? st.detail_en : st.detail_es}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* P0 #5: SI ES TIENDA DESCONOCIDA (UNASSIGNED_STORE), INICIAR SIN PRE-SELECCIÓN Y EXIGIR CONFIRMACIÓN */}
            {(selectedOrder.store_id === 0 || selectedOrder.store_code === 'UNASSIGNED_STORE') && (
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2.5 text-xs">
                <div className="font-extrabold text-amber-800 dark:text-amber-200">
                  {isEn
                    ? 'Manually assign this transaction to a Tacos Gavilan store:'
                    : 'Asignar manualmente esta transacción a una sucursal de Tacos Gavilan:'}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={assignTargetStoreId}
                    onChange={(e) => {
                      setAssignTargetStoreId(e.target.value)
                      setShowAssignStoreConfirmModal(false)
                    }}
                    className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-bold"
                  >
                    <option value="">{t('deliveryReconciliation.unassigned_select_store_placeholder')}</option>
                    {[...mappings]
                      .sort((a, b) => a.store_name.localeCompare(b.store_name, 'es'))
                      .map((m) => (
                        <option key={m.store_id} value={String(m.store_id)}>
                          {m.store_name} ({m.store_code})
                        </option>
                      ))}
                  </select>
                  <button
                    onClick={() => setShowAssignStoreConfirmModal(true)}
                    disabled={savingDispute || !assignTargetStoreId}
                    className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white font-extrabold"
                  >
                    {isEn ? 'Assign Store & Reconcile' : 'Asignar Sucursal y Conciliar'}
                  </button>
                </div>

                {/* MODAL / PANEL DE CONFIRMACIÓN DE ASIGNACIÓN DE TIENDA DESCONOCIDA */}
                {showAssignStoreConfirmModal && assignTargetStoreId && (() => {
                  const destStore = mappings.find((m) => String(m.store_id) === assignTargetStoreId)
                  return (
                    <div className="mt-3 p-3.5 rounded-xl bg-white dark:bg-slate-900 border-2 border-amber-500 space-y-2.5 shadow-md">
                      <div className="font-extrabold text-amber-800 dark:text-amber-300">
                        ⚠️ {t('deliveryReconciliation.unassigned_confirm_title')}
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-slate-300">
                        {t('deliveryReconciliation.unassigned_confirm_desc')}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px] bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700">
                        <div>
                          <span className="font-bold text-slate-500">
                            {t('deliveryReconciliation.unassigned_confirm_ref')}:{' '}
                          </span>
                          <span className="font-mono font-extrabold">
                            #{selectedOrder.platform_order_id}
                            {selectedOrder.payout_reference_id ? ` (Payout #${selectedOrder.payout_reference_id})` : ''}
                          </span>
                        </div>
                        <div>
                          <span className="font-bold text-slate-500">
                            {t('deliveryReconciliation.unassigned_confirm_platform')}:{' '}
                          </span>
                          <span className="font-extrabold">{selectedOrder.platform}</span>
                        </div>
                        <div>
                          <span className="font-bold text-slate-500">
                            {t('deliveryReconciliation.unassigned_confirm_dest_store')}:{' '}
                          </span>
                          <span className="font-extrabold text-emerald-700 dark:text-emerald-400">
                            {destStore ? `${destStore.store_name} (${destStore.store_code})` : assignTargetStoreId}
                          </span>
                        </div>
                        <div>
                          <span className="font-bold text-slate-500">
                            {t('deliveryReconciliation.unassigned_confirm_amount')}:{' '}
                          </span>
                          <span className="font-mono font-extrabold">
                            {fmtMoney(selectedOrder.platform_gross_receivable)}
                          </span>
                        </div>
                        <div className="sm:col-span-2">
                          <span className="font-bold text-slate-500">
                            {t('deliveryReconciliation.unassigned_confirm_user')}:{' '}
                          </span>
                          <span className="font-mono font-bold">{currentUserLabel}</span>
                        </div>
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => setShowAssignStoreConfirmModal(false)}
                          className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold"
                        >
                          {t('deliveryReconciliation.modal_close')}
                        </button>
                        <button
                          onClick={() => handleAssignUnassignedStore(selectedOrder)}
                          disabled={savingDispute}
                          className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold"
                        >
                          {t('deliveryReconciliation.unassigned_confirm_btn')}
                        </button>
                      </div>
                    </div>
                  )
                })()}
              </div>
            )}

            {/* SI HAY CANDIDATOS AMBIGUOS DE TOAST POS, MOSTRAR SELECTOR EXPLÍCITO */}
            {Array.isArray(selectedOrder.raw_payload?.ambiguous_toast_candidates) &&
              selectedOrder.raw_payload.ambiguous_toast_candidates.length > 0 && (
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2 text-xs">
                  <div className="font-extrabold text-amber-800 dark:text-amber-200">
                    {isEn
                      ? 'Ambiguous Toast POS candidates (select the correct check):'
                      : 'Candidatos ambiguos en Toast POS (selecciona el ticket correcto):'}
                  </div>
                  <div className="space-y-1.5">
                    {selectedOrder.raw_payload.ambiguous_toast_candidates.map((cand: any) => {
                      const candGuid = cand.toastOrderGuid || cand.toastGuid
                      return (
                        <div
                          key={candGuid}
                          className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                        >
                          <span className="font-mono">
                            Toast #{cand.displayNumber} • Net: {fmtMoney(cand.netSales)} • Tax: {fmtMoney(cand.taxAmount)}
                          </span>
                          <button
                            onClick={() => handleApproveReviewOrder(selectedOrder, candGuid)}
                            disabled={savingDispute}
                            className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold"
                          >
                            {isEn ? 'Confirm this Check' : 'Confirmar este Ticket'}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

            {/* SEGUIMIENTO DE DISPUTA Y REEMBOLSO EN CORTE POSTERIOR */}
            <div className="space-y-3 border-t border-slate-200 dark:border-slate-800 pt-4">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold uppercase text-slate-500">
                  {t('deliveryReconciliation.modal_update_dispute')}
                </label>
                {/* P0 #2 & #7: Solo órdenes con VARIANCE_INVESTIGATE permiten aprobar varianza */}
                {selectedOrder.action_group === 'VARIANCE_INVESTIGATE' && selectedOrder.store_id > 0 && (
                  <button
                    onClick={() => handleApproveReviewOrder(selectedOrder)}
                    disabled={savingDispute}
                    className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold"
                  >
                    {t('deliveryReconciliation.approve_variance_btn')}
                  </button>
                )}
              </div>
              <select
                value={disputeStatusInput}
                onChange={(e) => setDisputeStatusInput(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-semibold"
              >
                <option value="NONE">{t('deliveryReconciliation.dispute_NONE')}</option>
                <option value="OPEN">{t('deliveryReconciliation.dispute_NEEDS_DISPUTE')}</option>
                <option value="SUBMITTED">{t('deliveryReconciliation.dispute_SUBMITTED')}</option>
                <option value="APPROVED">{t('deliveryReconciliation.dispute_APPROVED')}</option>
                <option value="REIMBURSED">
                  {isEn ? 'Reimbursed in Subsequent Payout' : 'Reembolsada en Payout Posterior'}
                </option>
                <option value="REJECTED">{t('deliveryReconciliation.dispute_DENIED')}</option>
              </select>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3">
                <div className="sm:col-span-2 text-[11px] font-extrabold uppercase text-emerald-700 dark:text-emerald-400">
                  {t('deliveryReconciliation.cross_payout_section_title')}
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">
                    {t('deliveryReconciliation.cross_payout_ref_label')}
                  </label>
                  <input
                    type="text"
                    value={reimbursementRefInput}
                    onChange={(e) => setReimbursementRefInput(e.target.value)}
                    placeholder={isEn ? 'e.g. Payout reference ID' : 'Ej. ID de referencia del payout'}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">
                    {t('deliveryReconciliation.cross_payout_amount_label')}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={reimbursementAmountInput}
                    onChange={(e) => setReimbursementAmountInput(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">
                    {t('deliveryReconciliation.cross_payout_date_label')}
                  </label>
                  <input
                    type="date"
                    value={reimbursementDateInput}
                    onChange={(e) => setReimbursementDateInput(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">
                    {t('deliveryReconciliation.cross_payout_desc_label')}
                  </label>
                  <input
                    type="text"
                    value={reimbursementDescInput}
                    onChange={(e) => setReimbursementDescInput(e.target.value)}
                    placeholder={
                      isEn
                        ? 'e.g. Approved dispute reimbursement in subsequent settlement'
                        : 'Ej. Reembolso de disputa aprobado en liquidación posterior'
                    }
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs"
                  />
                </div>
              </div>

              {disputeStatusInput === 'REIMBURSED' && !isReimbursedFormValid && (
                <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-700 dark:text-rose-300 font-semibold">
                  ⚠️ {t('deliveryReconciliation.reimbursed_validation_error')}
                </div>
              )}

              <textarea
                rows={2}
                value={disputeNotesInput}
                onChange={(e) => setDisputeNotesInput(e.target.value)}
                placeholder={t('deliveryReconciliation.modal_dispute_notes_placeholder')}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-sm"
              />

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setSelectedOrder(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold"
                >
                  {t('deliveryReconciliation.modal_close')}
                </button>
                <button
                  onClick={handleSaveDispute}
                  disabled={savingDispute || !isReimbursedFormValid}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-bold"
                >
                  {t('deliveryReconciliation.modal_save_dispute')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL IMPORTAR REPORTE CSV / JSON (P1 #10: CONFIRMACIÓN EXPLÍCITA DE SUCURSAL) */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-xl w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="text-lg font-extrabold">{t('deliveryReconciliation.import_modal_title')}</h3>
              <button
                onClick={() => setShowImportModal(false)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400">
              {t('deliveryReconciliation.import_modal_desc')}
            </p>

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">
                {t('deliveryReconciliation.import_select_platform')}
              </label>
              <select
                value={importPlatform}
                onChange={(e) => setImportPlatform(e.target.value as any)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-semibold"
              >
                <option value="AUTO">{t('deliveryReconciliation.import_auto_detect')}</option>
                <option value="DOORDASH">DoorDash (Transactions Breakdown / Payouts CSV)</option>
                <option value="UBER_EATS">Uber Eats (Payment / Orders CSV)</option>
                <option value="GRUBHUB">Grubhub (Accounting CSV / JSON)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">
                {t('deliveryReconciliation.import_drop_file')}
              </label>
              <input
                type="file"
                accept=".csv,.json,.txt"
                onChange={handleFileUpload}
                className="w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-bold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
              />
              {importFileName && (
                <div className="text-xs text-emerald-600 mt-1 font-semibold">
                  {t('deliveryReconciliation.import_loaded_file', {
                    name: importFileName,
                    bytes: importText.length.toLocaleString(),
                  })}
                </div>
              )}
            </div>

            {selectedStore !== 'ALL' && selectedStore !== '0' && (
              <label className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmImportStoreAssignment}
                  onChange={(e) => setConfirmImportStoreAssignment(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300"
                />
                <span className="font-semibold text-amber-800 dark:text-amber-200">
                  {t('deliveryReconciliation.import_confirm_store_checkbox', { store: activeStoreLabel })}
                </span>
              </label>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              <button
                onClick={() => setShowImportModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold"
              >
                {t('deliveryReconciliation.modal_close')}
              </button>
              <button
                onClick={handleProcessImport}
                disabled={
                  importing ||
                  !importText.trim() ||
                  (selectedStore !== 'ALL' && selectedStore !== '0' && !confirmImportStoreAssignment)
                }
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-bold"
              >
                {importing
                  ? t('deliveryReconciliation.import_processing')
                  : t('deliveryReconciliation.import_process_btn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
