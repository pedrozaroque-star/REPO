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
 * 5. Cruce Bidireccional Claro, Confirmación en 1 Clic, Desglose de Órdenes por Póliza y Cola Progresiva de Sincronización:
 *    - Barra de Cruce Bidireccional (`Toast POS ↔ Plataformas Delivery`) en lenguaje operativo claro: (1) Pagadas y Cuadradas, (2) Pagadas de Menos / Con Descuento, (3) En Toast POS y NO en Plataforma (en tiendas ya sincronizadas), (4) En Plataforma y NO en Toast (con botón de confirmación en 1 clic `🔗 Confirmar Toast #NNN` cuando existe candidato único), y alerta separada de tiendas pendientes de sincronizar con botón `⚡ Sincronizar X Tienda(s) Pendiente(s)`.
 *    - Cola Progresiva Secuencial (`handleProgressiveStoreQueueSync`, `1/15 → 15/15`) al sincronizar múltiples tiendas para evitar límites `HTTP 429` de las plataformas y timeouts de conexión.
 *    - En Tab 4 (`Pólizas QuickBooks`) oculta por defecto los códigos contables grises tras el switch `🧾 Ver códigos contables QBO`, muestra el badge `📋 X órdenes incluidas • ✓ Y cuadradas con Toast` por fila y despliega la tabla completa de `📋 Órdenes Incluidas en esta Póliza` dentro del modal de la póliza.
 *
 * @dataFlow
 * - Consume `GET /api/delivery-reconciliation` y `GET /api/delivery-reconciliation/quickbooks-journal` (con `credentials: 'include'`).
 * - Ejecuta mutaciones autenticadas vía `POST /api/delivery-reconciliation` y `POST /api/delivery-reconciliation/quickbooks-journal`.
 *
 * @notes
 * - Soporte 100% bilingüe (ES/EN) mediante `useLanguage()` (`deliveryReconciliation.*`), sin recargar API al alternar idioma.
 * - Las tarjetas de resumen por plataforma (`DOORDASH`, `UBER_EATS`, `GRUBHUB`) presentan comparativa financiera lado a lado (`Corte Plat.` vs `Toast POS`) aislada estrictamente al periodo seleccionado (sin contaminar semanas abiertas con recuperaciones históricas) e incorporan Puente Contable explicativo línea por línea.
 * - Selector unificado de periodo (`DeliveryPeriodFilter` estilo módulo de Ventas) con selección por Semana (`Lun → Dom`), por Día operativo (`6:00 AM – 5:59 AM PT`) o Rango, inicializando por defecto en `"Semana pasada"` (`last_week`).
 * - Respeta estrictamente el día laboral de Tacos Gavilan (`6:00 AM – 5:59 AM PT` en `America/Los_Angeles`), limpieza de estado/selecciones al cambiar filtros, banners de validación visibles dentro de modales (`z-50`), cierre con `Escape` y matriz real 15×3 `byStorePlatform` editable en modo soporte.
 * - Auditoría integral (nov 2026): `CONCILIATED_NEXT_PAYOUT` se clasifica como en tránsito (`BLOCKED_MISSING_INFO`, fuera de `4. Listos`), disputas `ACCEPTED_LOSS`/`REJECTED` se muestran como pérdidas cerradas sin confundirse con recuperaciones, exclusión de ajustes `$0.00`, paridad contable Tab 4a/4b vía `accounting_gross_receivable` + `line5` (`24001`), validación explícita de `action` en QuickBooks, exportación nativa multi-hoja `.xlsx` + `.csv` y ocultamiento automático de `UNASSIGNED_STORE` cuando no hay registros en cuarentena.
 */

'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import * as XLSX from 'xlsx'
import { useLanguage } from '@/lib/i18n'
import DeliveryPeriodFilter, {
  classifyDeliveryPeriod,
  getPresetBounds,
  type DeliveryPeriodPreset,
} from '@/components/delivery/DeliveryPeriodFilter'
import {
  ShieldCheck,
  RefreshCw,
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
type OrderSubFilter =
  | 'NONE'
  | 'UNDERPAID_OR_DISPUTE'
  | 'WITH_PAYOUT_PENDING_REVIEW'
  | 'TOAST_ONLY'
  | 'TOAST_UNPAID_SYNCED'
  | 'TOAST_PENDING_SYNC'
  | 'PLATFORM_MISSING_TOAST'

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
  toast_only_store_synced?: boolean
  toast_synced_on_date?: boolean
  platform_missing_toast_synced?: boolean
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
  // Disputas y recuperaciones: original disputado, recuperado verificado y saldo pendiente por separado
  recovery_classification?: string
  original_deduction_abs?: number
  original_amount_verified?: boolean
  recovered_amount?: number
  claimed_unverified_amount?: number
  unrecovered_amount?: number
  recovery_credits_evaluated?: Array<{
    credit_id: string
    payout_reference_id: string
    transaction_id: string | null
    amount: number
    deposit_date: string | null
    verified: boolean
    verification_issue: string | null
  }>
  in_selected_period?: boolean
  is_prior_period_recovery?: boolean
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
  accounting_gross_receivable?: number
  accounting_total_fees?: number
  accounting_err_adj?: number
  accounting_gross_variance?: number
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
  doordash_business_id?: string | null
  grubhub_cust_id?: string | null
  ubereats_store_uuid: string | null
  ubereats_org_uuid?: string | null
}

const formatPlatformDisplayName = (plat: string | null | undefined): string => {
  if (plat === 'DOORDASH') return 'DoorDash'
  if (plat === 'UBER_EATS') return 'Uber Eats'
  if (plat === 'GRUBHUB') return 'Grubhub'
  return plat || '—'
}

const shortenRef = (ref: string | null | undefined, maxLen = 16): string => {
  const s = String(ref || '').trim()
  if (!s) return '—'
  if (s.length <= maxLen) return s
  const head = Math.max(6, Math.floor((maxLen - 1) * 0.6))
  const tail = Math.max(4, maxLen - 1 - head)
  return `${s.slice(0, head)}…${s.slice(-tail)}`
}

const fmtMoney = (val: number | null | undefined) => {
  const n = Number(val || 0)
  const safe = Number.isFinite(n) ? n : 0
  const sign = safe < -0.004 ? '-' : ''
  return `${sign}$${Math.abs(safe).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

const fmtDateMDY = (dateStr: string | null | undefined): string => {
  if (!dateStr) return '-'
  const raw = String(dateStr).trim()
  // Solo coincidencias exactas YYYY-MM-DD se formatean directo; ISO con hora UTC se convierte a America/Los_Angeles
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
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

/**
 * Obtiene la fecha operativa actual en `America/Los_Angeles` respetando estrictamente
 * la regla del día laboral de Tacos Gavilan (6:00 AM a 5:59 AM del día siguiente),
 * independiente del timezone del navegador o servidor.
 */
const getLaBusinessDateUtc = (now: Date = new Date()): Date => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const getNum = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0)
  const year = getNum('year')
  const month = getNum('month')
  const day = getNum('day')
  const hour = getNum('hour')
  const baseUtc = new Date(Date.UTC(year, month - 1, day))
  if (hour < 6) {
    baseUtc.setUTCDate(baseUtc.getUTCDate() - 1)
  }
  return baseUtc
}

const utcDateToYmd = (d: Date): string => {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const getLaCurrentWeekBounds = (now: Date = new Date()): { start: string; end: string } => {
  const bizUtc = getLaBusinessDateUtc(now)
  const dayOfWeek = bizUtc.getUTCDay() // 0 = Sun, 1 = Mon ...
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const monday = new Date(bizUtc)
  monday.setUTCDate(bizUtc.getUTCDate() + diffToMonday)
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)
  return { start: utcDateToYmd(monday), end: utcDateToYmd(sunday) }
}

const escapeCsvCell = (val: unknown): string => {
  const raw = String(val ?? '')
    .replace(/\r?\n|\r/g, ' ')
    .trim()
  // Evitar CSV Formula Injection en Excel (=, +, -, @ al inicio de texto no numérico)
  const safe =
    /^[=+\-@]/.test(raw) && !/^[-+]?\d+(\.\d+)?$/.test(raw) ? `'${raw}` : raw
  return `"${safe.replace(/"/g, '""')}"`
}

export default function ConciliarDeliveryPage() {
  const { t, language } = useLanguage()
  const isEn = language === 'en'

  // Por defecto inicia en "Semana pasada" (last_week, Lunes -> Domingo cerrado previo en 6AM-5:59AM PT)
  const initialWeek = useMemo(() => getPresetBounds('last_week'), [])
  const [startDate, setStartDate] = useState<string>(initialWeek.start)
  const [endDate, setEndDate] = useState<string>(initialWeek.end)
  const [selectedPeriod, setSelectedPeriod] = useState<DeliveryPeriodPreset>('last_week')
  const [selectedStore, setSelectedStore] = useState<string>('ALL')
  const [selectedPlatform, setSelectedPlatform] = useState<string>('ALL')
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL')
  const [activePayoutRef, setActivePayoutRef] = useState<string>('')
  // P1 #13: Abrir por defecto en "Atención requerida" (orders), NO en QuickBooks
  const [selectedActionGroup, setSelectedActionGroup] = useState<'ALL' | ActionGroup>('ALL')
  const [selectedOrderSubFilter, setSelectedOrderSubFilter] = useState<OrderSubFilter>('NONE')
  const [disputesSubFilter, setDisputesSubFilter] = useState<'ALL' | 'PENDING' | 'RECOVERED' | 'CLOSED_LOSS'>('ALL')
  const [searchInput, setSearchInput] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [activeTab, setActiveTab] = useState<'orders' | 'qb_journals' | 'disputes' | 'payouts' | 'mappings'>('orders')
  const [cutsSubView, setCutsSubView] = useState<'qb' | 'bank'>('qb')
  const [ordersPage, setOrdersPage] = useState<number>(1)
  const [ordersPageSize, setOrdersPageSize] = useState<number>(100)
  const [showTaxRulesPopover, setShowTaxRulesPopover] = useState<boolean>(false)
  const [showAdvancedSupport, setShowAdvancedSupport] = useState<boolean>(false)
  const [showQbAccountCodes, setShowQbAccountCodes] = useState<boolean>(false)
  const [varianceBridgeOpenMap, setVarianceBridgeOpenMap] = useState<
    Partial<Record<DeliveryPlatform, boolean>>
  >({})
  const [expandedVarianceBucketOrders, setExpandedVarianceBucketOrders] = useState<
    Record<string, boolean>
  >({})
  const [currentUserLabel, setCurrentUserLabel] = useState<string>('Admin / Contador')

  // Edición inline de IDs de plataforma por sucursal (en modo soporte de Tab 3)
  const [editingMappingStoreId, setEditingMappingStoreId] = useState<number | null>(null)
  const [mappingDraft, setMappingDraft] = useState<{
    doordash_store_id: string
    doordash_business_id: string
    grubhub_cust_id: string
    ubereats_store_uuid: string
    ubereats_org_uuid: string
  }>({
    doordash_store_id: '',
    doordash_business_id: '',
    grubhub_cust_id: '',
    ubereats_store_uuid: '',
    ubereats_org_uuid: '',
  })
  const [savingMapping, setSavingMapping] = useState<boolean>(false)

  // Cola progresiva tienda por tienda para evitar rate limits HTTP 429 y bloqueo anti-doble-clic
  const [syncQueueProgress, setSyncQueueProgress] = useState<{
    active: boolean
    completed: number
    current: number
    total: number
    currentStoreName: string
  } | null>(null)
  const [syncQueueCancelling, setSyncQueueCancelling] = useState<boolean>(false)
  const cancelSyncQueueRef = useRef<boolean>(false)
  const syncQueueAbortRef = useRef<AbortController | null>(null)
  const singleSyncAbortRef = useRef<AbortController | null>(null)
  const syncInFlightRef = useRef<boolean>(false)

  // P1 #15: Control de secuencias y AbortController para evitar condiciones de carrera (race conditions)
  const fetchSeqRef = useRef<number>(0)
  const qbFetchSeqRef = useRef<number>(0)
  const fetchAbortRef = useRef<AbortController | null>(null)
  const qbAbortRef = useRef<AbortController | null>(null)

  const [loading, setLoading] = useState<boolean>(true)
  const [syncing, setSyncing] = useState<boolean>(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [bannerMessage, setBannerMessage] = useState<{
    type: 'success' | 'error' | 'warning'
    text: string
  } | null>(null)

  const [mappings, setMappings] = useState<StoreMapping[]>([])
  const [userScope, setUserScope] = useState<{ isGlobalScope: boolean; assignedStoreId: number | null } | null>(null)
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

  // P1 #15: Limpiar selección de payouts, órdenes y página siempre que cambien filtros, subfiltros o búsqueda
  useEffect(() => {
    setSelectedQbPayoutIds(new Set())
    setSelectedOrderIds(new Set())
    setShowBatchConfirmModal(false)
    setBatchOrderConfirmModal(null)
    setOrdersPage(1)
  }, [
    selectedStore,
    selectedPlatform,
    selectedStatus,
    startDate,
    endDate,
    searchQuery,
    qbQuickFilter,
    activePayoutRef,
    selectedActionGroup,
    selectedOrderSubFilter,
  ])

  useEffect(() => {
    setConfirmImportStoreAssignment(false)
  }, [selectedStore])

  useEffect(() => {
    setVarianceBridgeOpenMap({})
    setExpandedVarianceBucketOrders({})
  }, [selectedStore, startDate, endDate, activePayoutRef])

  // Cerrar modal activo o popover con tecla Escape (deshabilitado mientras una mutación está en curso)
  useEffect(() => {
    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return
      if (publishingQb || resolvingQboCandidate || savingBatch || savingDispute || importing) return
      if (showAssignStoreConfirmModal) {
        setShowAssignStoreConfirmModal(false)
      } else if (batchOrderConfirmModal) {
        setBatchOrderConfirmModal(null)
      } else if (showBatchConfirmModal) {
        setShowBatchConfirmModal(false)
      } else if (selectedOrder) {
        setSelectedOrder(null)
        setBannerMessage(null)
      } else if (selectedQbRecord) {
        setSelectedQbRecord(null)
        setBannerMessage(null)
      } else if (showImportModal) {
        setShowImportModal(false)
        setImportPlatform('AUTO')
        setImportText('')
        setImportFileName('')
        setConfirmImportStoreAssignment(false)
        setBannerMessage(null)
      } else if (showTaxRulesPopover) {
        setShowTaxRulesPopover(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    publishingQb,
    resolvingQboCandidate,
    savingBatch,
    savingDispute,
    importing,
    showAssignStoreConfirmModal,
    batchOrderConfirmModal,
    showBatchConfirmModal,
    selectedOrder,
    selectedQbRecord,
    showImportModal,
    showTaxRulesPopover,
  ])

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

  useEffect(() => {
    return () => {
      cancelSyncQueueRef.current = true
      syncQueueAbortRef.current?.abort()
      singleSyncAbortRef.current?.abort()
      fetchAbortRef.current?.abort()
      qbAbortRef.current?.abort()
    }
  }, [])

  const parseSafeJson = async (res: Response): Promise<any> => {
    const raw = await res.text().catch(() => '')
    if (!raw) return {}
    try {
      return JSON.parse(raw)
    } catch {
      return { success: false, error: `HTTP ${res.status}: ${raw.slice(0, 140)}` }
    }
  }

  const tRef = useRef(t)
  tRef.current = t

  const isDateRangeValid = useMemo(() => {
    if (!startDate || !endDate) return false
    return endDate >= startDate
  }, [startDate, endDate])

  type FetchFilterOverride = {
    storeId?: string
    platform?: string
    status?: string
    startDate?: string
    endDate?: string
    search?: string
    payoutRef?: string
  }

  const fetchData = useCallback(
    async (override?: FetchFilterOverride) => {
      const effStore = override?.storeId ?? selectedStore
      const effPlatform = override?.platform ?? selectedPlatform
      const effStatus = override?.status ?? selectedStatus
      const effStart = override?.startDate ?? startDate
      const effEnd = override?.endDate ?? endDate
      const effSearch = override?.search ?? searchQuery
      const effPayoutRef = override?.payoutRef !== undefined ? override.payoutRef : activePayoutRef

      if (!effStart || !effEnd || effEnd < effStart) {
        setFetchError(tRef.current('deliveryReconciliation.date_range_invalid_error'))
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
          store_id: effStore,
          platform: effPlatform,
          status: effStatus,
          start_date: effStart,
          end_date: effEnd,
          search: effSearch,
        })
        if (effPayoutRef) {
          qs.set('payout_reference_id', effPayoutRef)
        }
        const res = await authFetch(`/api/delivery-reconciliation?${qs.toString()}`, {
          signal: controller.signal,
        })
        const data = await parseSafeJson(res)
        if (seq !== fetchSeqRef.current) return
        if (!res.ok || !data.success) {
          throw new Error(data.error || `HTTP ${res.status}`)
        }
        setMappings(data.mappings || [])
        if (data.userScope) {
          setUserScope(data.userScope)
          if (!data.userScope.isGlobalScope && data.userScope.assignedStoreId) {
            const scopedIdStr = String(data.userScope.assignedStoreId)
            setSelectedStore((prev) => (prev === scopedIdStr ? prev : scopedIdStr))
          }
        }
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
    },
    [selectedStore, selectedPlatform, selectedStatus, startDate, endDate, searchQuery, activePayoutRef, authFetch]
  )

  useEffect(() => {
    fetchData()
    return () => {
      fetchAbortRef.current?.abort()
    }
  }, [fetchData])

  const fetchQbJournalRecords = useCallback(
    async (override?: FetchFilterOverride) => {
      const effStore = override?.storeId ?? selectedStore
      const effPlatform = override?.platform ?? selectedPlatform
      const effStatus = override?.status ?? selectedStatus
      const effStart = override?.startDate ?? startDate
      const effEnd = override?.endDate ?? endDate
      const effSearch = override?.search ?? searchQuery

      if (!effStart || !effEnd || effEnd < effStart) return
      qbAbortRef.current?.abort()
      const controller = new AbortController()
      qbAbortRef.current = controller
      const seq = ++qbFetchSeqRef.current

      setQbLoading(true)
      setSelectedQbPayoutIds(new Set())
      try {
        const qs = new URLSearchParams({
          store_id: effStore,
          platform: effPlatform,
          status: effStatus,
          start_date: effStart,
          end_date: effEnd,
        })
        if (effSearch.trim()) qs.set('search', effSearch.trim())
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
        setSelectedQbRecord((prevRec: any) => {
          if (!prevRec) return prevRec
          const fresh = (data.records || []).find((nr: any) => nr.id === prevRec.id)
          return fresh || prevRec
        })
      } catch (err: any) {
        if (err?.name === 'AbortError' || seq !== qbFetchSeqRef.current) return
        console.error('Error loading QB Journal Entries:', err)
        setFetchError((prev) => prev || err.message || 'Error al cargar pólizas de QuickBooks')
      } finally {
        if (seq === qbFetchSeqRef.current) {
          setQbLoading(false)
        }
      }
    },
    [selectedStore, selectedPlatform, selectedStatus, startDate, endDate, searchQuery, authFetch]
  )

  useEffect(() => {
    fetchQbJournalRecords()
    return () => {
      qbAbortRef.current?.abort()
    }
  }, [fetchQbJournalRecords])

  const handleQuickBooksReauth = () => {
    const authWindow = window.open(qbReauthUrl, 'QuickBooksAuth', 'width=600,height=700')
    if (!authWindow) {
      setBannerMessage({ type: 'error', text: t('deliveryReconciliation.reauth_popup_blocked') })
      return
    }
    const handleMessage = (event: MessageEvent) => {
      if (event.data === 'qb_authorized') {
        clearInterval(timer)
        window.removeEventListener('message', handleMessage)
        setQbAuthError(false)
        fetchQbJournalRecords()
      }
    }
    window.addEventListener('message', handleMessage)
    const timer = setInterval(() => {
      if (authWindow.closed) {
        clearInterval(timer)
        window.removeEventListener('message', handleMessage)
        fetchQbJournalRecords()
      }
    }, 1000)
  }

  const handleOpenQbModal = (rec: any) => {
    setBannerMessage(null)
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
      const nextType: 'success' | 'warning' =
        data.outcome === 'STILL_MISSING_UNLOCKED' || data.recoveryRequired ? 'warning' : 'success'
      setBannerMessage({
        type: nextType,
        text:
          data.outcome === 'RECOVERED_EXISTING_IN_QBO'
            ? isEn
              ? `Recovered existing QBO Journal Entry #${data.journalEntry?.docNumber || data.journalEntry?.id}.`
              : `Se recuperó y vinculó la póliza existente en QBO #${data.journalEntry?.docNumber || data.journalEntry?.id}.`
            : data.outcome === 'CANDIDATES_FOUND_REQUIRE_CONFIRMATION'
            ? isEn
              ? 'Candidate QBO entries found; please confirm or discard in the settlement detail.'
              : 'Se encontraron pólizas candidatas en QBO; confirme o descarte en el detalle del corte.'
            : data.recoveryRequired
            ? t('deliveryReconciliation.qb_verify_still_missing')
            : isEn
            ? 'Verified absent in QBO: settlement unlocked for safe retry.'
            : 'Verificado ausente en QBO: corte desbloqueado para reintento seguro.',
      })
      await Promise.all([fetchData(), fetchQbJournalRecords()])
      if (data.outcome === 'RECOVERED_EXISTING_IN_QBO') {
        setSelectedQbRecord(null)
      }
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
          action: 'publish',
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
      const resultsArr: any[] = Array.isArray(data.results) ? data.results : []
      const succeededItems = resultsArr.filter((r: any) => r.success)
      const failedItems = resultsArr.filter((r: any) => !r.success)
      if (data.recoveryRequired && succeededItems.length === 0) {
        const recErr = resultsArr.find((r: any) => r.recoveryRequired)?.error
        setBannerMessage({
          type: 'error',
          text: recErr || data.error || 'Estado de recuperación requerido: verifica en QuickBooks antes de reintentar.',
        })
        setShowBatchConfirmModal(false)
        setSelectedQbPayoutIds(new Set())
        await Promise.all([fetchData(), fetchQbJournalRecords()])
        return
      }
      if (!data.success || (succeededItems.length === 0 && failedItems.length > 0)) {
        const firstErr = failedItems[0]?.error
        throw new Error(firstErr || data.error || 'Error al publicar Journal Entry en QuickBooks Online')
      }
      const createdList = succeededItems
        .map((r: any) => `#${r.journalEntry?.docNumber} (${r.storeName} - ${formatPlatformDisplayName(r.platform)} #${r.payoutRef})`)
        .join(', ')
      if (failedItems.length > 0) {
        const errDetails = failedItems
          .slice(0, 3)
          .map((r: any) => `${r.storeName || ''} #${r.payoutRef || ''}: ${r.error || 'Error'}`)
          .join(' | ')
        setBannerMessage({
          type: 'warning',
          text: t('deliveryReconciliation.qb_partial_publish_warning', {
            ok: succeededItems.length,
            list: createdList,
            failed: failedItems.length,
            errors: errDetails,
          }),
        })
      } else {
        setBannerMessage({
          type: 'success',
          text: t('deliveryReconciliation.qb_published_toast', { list: createdList }),
        })
      }
      setSelectedQbPayoutIds(new Set())
      setShowBatchConfirmModal(false)
      setSelectedQbRecord(null)
      await Promise.all([fetchData(), fetchQbJournalRecords()])
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
    preserveFilters?: boolean
  }) => {
    const rawTargetStore = override?.storeId || selectedStore
    const targetStore = rawTargetStore === '0' ? 'ALL' : rawTargetStore
    const targetPlatform = override?.platform || selectedPlatform
    const targetStart = override?.startDate || startDate
    const targetEnd = override?.endDate || endDate
    const targetPayoutRef = override?.payoutRef !== undefined ? override.payoutRef : activePayoutRef
    const targetSearch = override?.payoutRef !== undefined ? '' : searchQuery

    if (syncInFlightRef.current) return
    if (rawTargetStore === '0' && !override?.storeId) {
      setBannerMessage({
        type: 'warning',
        text: 'Selecciona una sucursal específica o "Todas las Sucursales" para sincronizar en vivo.',
      })
      return
    }
    if (!targetStart || !targetEnd || targetEnd < targetStart) {
      const msg = t('deliveryReconciliation.date_range_invalid_error')
      if (mappings.length === 0) setFetchError(msg)
      setBannerMessage({ type: 'error', text: msg })
      return
    }

    if (!override?.preserveFilters) {
      if (override?.storeId) setSelectedStore(override.storeId)
      if (override?.platform) setSelectedPlatform(override.platform)
    }
    if (override?.startDate) setStartDate(override.startDate)
    if (override?.endDate) setEndDate(override.endDate)
    if (override?.payoutRef !== undefined) {
      setActivePayoutRef(override.payoutRef)
      setSearchInput('')
      setSearchQuery('')
    }
    if (override?.openOrdersTab) {
      setSelectedActionGroup('ALL')
      setSelectedOrderSubFilter('NONE')
      setActiveTab('orders')
    }

    syncInFlightRef.current = true
    setSyncing(true)
    setBannerMessage(null)
    const reqCtrl = new AbortController()
    singleSyncAbortRef.current = reqCtrl
    const timeoutId = setTimeout(() => reqCtrl.abort(), 240000)

    try {
      const res = await authFetch('/api/delivery-reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: reqCtrl.signal,
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
      const data = await parseSafeJson(res)
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}: Sync failed`)
      }
      const syncErrors: string[] = Array.isArray(data.syncErrors) ? data.syncErrors : []
      const baseMsg = t('deliveryReconciliation.sync_success_msg', {
        toastCount: data.toastOrdersSynced || 0,
        ghOrders: data.platformOrdersSynced || 0,
        ghPayouts: data.payoutsSynced || 0,
      })
      const warnSuffix =
        syncErrors.length > 0
          ? ` ${t('deliveryReconciliation.sync_warnings_suffix', {
              count: syncErrors.length,
              details: syncErrors.slice(0, 2).join(' | '),
            })}`
          : ''
      setBannerMessage({
        type: syncErrors.length > 0 ? 'warning' : 'success',
        text: `${baseMsg}${warnSuffix}`,
      })
      const refreshOverride: FetchFilterOverride = override?.preserveFilters
        ? {}
        : {
            storeId: override?.storeId || selectedStore,
            platform: targetPlatform,
            startDate: targetStart,
            endDate: targetEnd,
            payoutRef: targetPayoutRef,
            search: targetSearch,
          }
      await Promise.all([fetchData(refreshOverride), fetchQbJournalRecords(refreshOverride)])
    } catch (err: any) {
      const errMsg =
        err?.name === 'AbortError'
          ? 'La sincronización excedió el límite de 240s o fue cancelada.'
          : err?.message || 'Error en sincronización en vivo'
      if (mappings.length === 0) setFetchError(errMsg)
      setBannerMessage({ type: 'error', text: errMsg })
    } finally {
      clearTimeout(timeoutId)
      singleSyncAbortRef.current = null
      syncInFlightRef.current = false
      setSyncing(false)
    }
  }

  const handleProgressiveStoreQueueSync = async (targetStoreIds?: number[]) => {
    if (syncInFlightRef.current) return
    if (!startDate || !endDate || endDate < startDate) {
      const msg = t('deliveryReconciliation.date_range_invalid_error')
      if (mappings.length === 0) setFetchError(msg)
      setBannerMessage({ type: 'error', text: msg })
      return
    }

    const storesList =
      Array.isArray(targetStoreIds) && targetStoreIds.length > 0
        ? mappings.filter((m) => targetStoreIds.includes(Number(m.store_id)))
        : [...mappings].sort((a, b) => a.store_name.localeCompare(b.store_name, 'es'))

    if (storesList.length === 0) {
      return handleLiveSyncForStore()
    }

    syncInFlightRef.current = true
    cancelSyncQueueRef.current = false
    setSyncQueueCancelling(false)
    setSyncing(true)
    setBannerMessage(null)
    let completedCount = 0
    const collectedSyncErrors = new Set<string>()

    try {
      const batchSize = 1
      for (let i = 0; i < storesList.length; i += batchSize) {
        if (cancelSyncQueueRef.current) break
        const batch = storesList.slice(i, i + batchSize)
        const batchNames = batch.map((st) => st.store_name).join(', ')
        setSyncQueueProgress({
          active: true,
          completed: completedCount,
          current: Math.min(i + batch.length, storesList.length),
          total: storesList.length,
          currentStoreName: batchNames,
        })
        const batchAbort = new AbortController()
        syncQueueAbortRef.current = batchAbort
        const stepTimeoutId = setTimeout(() => batchAbort.abort(), 240000)
        try {
          const res = await authFetch('/api/delivery-reconciliation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: batchAbort.signal,
            body: JSON.stringify({
              action: 'sync_live',
              store_ids: batch.map((st) => Number(st.store_id)),
              platform: selectedPlatform,
              start_date: startDate,
              end_date: endDate,
              sync_toast: true,
              sync_grubhub: selectedPlatform === 'ALL' || selectedPlatform === 'GRUBHUB',
            }),
          })
          const data = await parseSafeJson(res)
          if (res.status === 401 || res.status === 403) {
            collectedSyncErrors.add(
              String(
                data?.error ||
                  t('deliveryReconciliation.sync_queue_http_error', {
                    status: res.status,
                    store: batchNames,
                  })
              )
            )
            break
          }
          if (!res.ok || !data?.success) {
            collectedSyncErrors.add(
              String(
                data?.error ||
                  t('deliveryReconciliation.sync_queue_http_error', {
                    status: res.status,
                    store: batchNames,
                  })
              )
            )
          } else {
            completedCount += batch.length
            setSyncQueueProgress({
              active: true,
              completed: completedCount,
              current: Math.min(i + batch.length, storesList.length),
              total: storesList.length,
              currentStoreName: batchNames,
            })
            if (Array.isArray(data.syncErrors)) {
              for (const errStr of data.syncErrors) {
                if (errStr) collectedSyncErrors.add(String(errStr))
              }
            }
          }
        } catch (batchErr: any) {
          if (cancelSyncQueueRef.current) {
            break
          }
          if (batchErr?.name === 'AbortError') {
            collectedSyncErrors.add(`Tiempo límite (240s) excedido en ${batchNames}`)
          } else if (batchErr?.message) {
            collectedSyncErrors.add(String(batchErr.message))
          }
        } finally {
          clearTimeout(stepTimeoutId)
        }
        if (i + batchSize < storesList.length && !cancelSyncQueueRef.current) {
          await new Promise((r) => setTimeout(r, 1000))
        }
      }

      const uniqueErrs = Array.from(collectedSyncErrors)
      const warnSuffix =
        uniqueErrs.length > 0
          ? ` ${t('deliveryReconciliation.sync_warnings_suffix', {
              count: uniqueErrs.length,
              details: uniqueErrs.slice(0, 2).join(' | '),
            })}`
          : ''
      if (cancelSyncQueueRef.current) {
        setBannerMessage({
          type: 'warning',
          text: `${t('deliveryReconciliation.sync_queue_cancelled_toast', {
            done: completedCount,
            total: storesList.length,
          })}${warnSuffix}`,
        })
      } else if (completedCount === 0 && uniqueErrs.length > 0) {
        setBannerMessage({
          type: 'error',
          text: t('deliveryReconciliation.sync_queue_failed_toast', {
            total: storesList.length,
            details: uniqueErrs.slice(0, 2).join(' | '),
          }),
        })
      } else {
        const doneText = t('deliveryReconciliation.sync_queue_done_toast', { count: completedCount })
        setBannerMessage({
          type: uniqueErrs.length > 0 ? 'warning' : 'success',
          text: `${doneText}${warnSuffix}`,
        })
      }
      await Promise.all([fetchData(), fetchQbJournalRecords()])
    } catch (err: any) {
      setBannerMessage({ type: 'error', text: err?.message || 'Error en cola de sincronización' })
    } finally {
      syncQueueAbortRef.current = null
      syncInFlightRef.current = false
      setSyncQueueCancelling(false)
      setSyncQueueProgress(null)
      setSyncing(false)
    }
  }

  const handleLiveSync = () => {
    if ((userScope?.isGlobalScope ?? true) && selectedStore === 'ALL' && mappings.length > 1) {
      return handleProgressiveStoreQueueSync()
    }
    return handleLiveSyncForStore()
  }

  const handleStartEditMapping = (m: StoreMapping) => {
    setEditingMappingStoreId(m.store_id)
    setMappingDraft({
      doordash_store_id: m.doordash_store_id || '',
      doordash_business_id: m.doordash_business_id || '',
      grubhub_cust_id: m.grubhub_cust_id || '',
      ubereats_store_uuid: m.ubereats_store_uuid || '',
      ubereats_org_uuid: m.ubereats_org_uuid || '',
    })
  }

  const handleSaveStoreMapping = async (store: StoreMapping) => {
    setSavingMapping(true)
    setBannerMessage(null)
    try {
      const res = await authFetch('/api/delivery-reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_mapping',
          store_id: store.store_id,
          updates: {
            doordash_store_id: mappingDraft.doordash_store_id.trim() || null,
            doordash_business_id: mappingDraft.doordash_business_id.trim() || null,
            grubhub_cust_id: mappingDraft.grubhub_cust_id.trim() || null,
            ubereats_store_uuid: mappingDraft.ubereats_store_uuid.trim() || null,
            ubereats_org_uuid: mappingDraft.ubereats_org_uuid.trim() || null,
          },
        }),
      })
      const data = await parseSafeJson(res)
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Error updating store mapping')
      }
      setEditingMappingStoreId(null)
      setBannerMessage({
        type: 'success',
        text: t('deliveryReconciliation.mapping_saved_toast', { store: store.store_name }),
      })
      await fetchData()
    } catch (err: any) {
      setBannerMessage({ type: 'error', text: err.message })
    } finally {
      setSavingMapping(false)
    }
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportFileName(file.name)
    const reader = new FileReader()
    reader.onload = (ev) => {
      setImportText(String(ev.target?.result || ''))
    }
    reader.onerror = () => {
      setImportText('')
      setImportFileName('')
      setBannerMessage({
        type: 'error',
        text: t('deliveryReconciliation.file_read_error', { name: file.name }),
      })
    }
    reader.readAsText(file)
    e.target.value = ''
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
    setBannerMessage(null)
    setSelectedOrder(ord)
    // P0 #5: Siempre iniciar sin tienda destino seleccionada (jamás preseleccionar Lynwood #14)
    setAssignTargetStoreId('')
    setShowAssignStoreConfirmModal(false)
    const rawDisp = String(ord.dispute_status || 'NONE').toUpperCase()
    const normalizedForSelect =
      rawDisp === 'NEEDS_DISPUTE'
        ? 'OPEN'
        : rawDisp === 'ACCEPTED_LOSS'
        ? 'ACCEPTED_LOSS'
        : rawDisp === 'DENIED'
        ? 'REJECTED'
        : rawDisp === 'DISPUTE_RECOVERED' || ord.status_code === 'DISPUTE_RECOVERED'
        ? 'REIMBURSED'
        : ['NONE', 'OPEN', 'SUBMITTED', 'APPROVED', 'REIMBURSED', 'REJECTED', 'ACCEPTED_LOSS'].includes(rawDisp)
        ? rawDisp
        : 'OPEN'
    setDisputeStatusInput(normalizedForSelect)
    setDisputeNotesInput(ord.dispute_notes || ord.raw_payload?.variance_approval?.reason || '')
    // Si ya existen créditos en `recovery_credits_evaluated`, dejar el formulario limpio para permitir agregar un nuevo crédito en otro corte sin sobrescribir el primero
    const hasExistingCredits = Array.isArray(ord.recovery_credits_evaluated) && ord.recovery_credits_evaluated.length > 0
    setReimbursementRefInput(hasExistingCredits ? '' : ord.raw_payload?.reimbursement_payout_ref || '')
    setReimbursementAmountInput(
      !hasExistingCredits && ord.raw_payload?.reimbursement_amount !== undefined && ord.raw_payload?.reimbursement_amount !== null
        ? String(ord.raw_payload.reimbursement_amount)
        : ''
    )
    setReimbursementDateInput(hasExistingCredits ? '' : ord.raw_payload?.reimbursement_deposit_date || '')
    setReimbursementDescInput(hasExistingCredits ? '' : ord.raw_payload?.reimbursement_description || '')
  }

  const isReimbursedFormValid = useMemo(() => {
    if (disputeStatusInput !== 'REIMBURSED') return true
    const anyInputEntered =
      reimbursementRefInput.trim().length > 0 ||
      reimbursementAmountInput.trim().length > 0 ||
      reimbursementDateInput.trim().length > 0 ||
      reimbursementDescInput.trim().length > 0
    const isAlreadyVerifiedRecovered =
      selectedOrder?.status_code === 'DISPUTE_RECOVERED' &&
      Number(selectedOrder?.recovered_amount || 0) >= 0.01
    if (isAlreadyVerifiedRecovered && !anyInputEntered) {
      return disputeNotesInput.trim().length >= 5
    }
    const hasRef = reimbursementRefInput.trim().length > 0
    const amt = Number(reimbursementAmountInput)
    const hasAmt = Number.isFinite(amt) && amt >= 0.01
    const hasDate = /^\d{4}-\d{2}-\d{2}$/.test(reimbursementDateInput.trim())
    const hasNote =
      reimbursementDescInput.trim().length >= 5 || disputeNotesInput.trim().length >= 5
    return hasRef && hasAmt && hasDate && hasNote
  }, [
    disputeStatusInput,
    selectedOrder,
    reimbursementRefInput,
    reimbursementAmountInput,
    reimbursementDateInput,
    reimbursementDescInput,
    disputeNotesInput,
  ])

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
    setBannerMessage(null)
    try {
      const statusMap: Record<string, string> = {
        NONE: 'NONE',
        NEEDS_DISPUTE: 'OPEN',
        OPEN: 'OPEN',
        SUBMITTED: 'SUBMITTED',
        APPROVED: 'APPROVED',
        REIMBURSED: 'REIMBURSED',
        DENIED: 'DENIED',
        REJECTED: 'REJECTED',
        ACCEPTED_LOSS: 'ACCEPTED_LOSS',
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
      if (data.warning) {
        setBannerMessage({ type: 'warning', text: data.warning })
      } else if (data.recovery_verification?.verified) {
        setBannerMessage({
          type: 'success',
          text: isEn
            ? `Recovery credit verified in settlement (#${reimbursementRefInput.trim()}).`
            : `Crédito de recuperación verificado en el settlement (#${reimbursementRefInput.trim()}).`,
        })
      }
      setSelectedOrder(null)
      await Promise.all([fetchData(), fetchQbJournalRecords()])
    } catch (err: any) {
      setBannerMessage({ type: 'error', text: err.message })
    } finally {
      setSavingDispute(false)
    }
  }

  const handleApproveReviewOrder = async (
    ord: ReconciledOrder,
    candidateToastGuid?: string,
    notesOverride?: string
  ) => {
    const effectiveNotes =
      notesOverride !== undefined ? notesOverride.trim() : disputeNotesInput.trim()
    if (!candidateToastGuid && effectiveNotes.length < 5) {
      setBannerMessage({
        type: 'error',
        text: t('deliveryReconciliation.variance_reason_required_error'),
      })
      return
    }
    setSavingDispute(true)
    setBannerMessage(null)
    try {
      const res = await authFetch('/api/delivery-reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'resolve_review_order',
          id: ord.id,
          review_decision: candidateToastGuid ? 'CONFIRM_TOAST_MATCH' : 'APPROVE_VARIANCE',
          selected_toast_guid: candidateToastGuid,
          review_notes: effectiveNotes,
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
    setBannerMessage(null)
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
    const validIds = orderIds.filter((id) => {
      if (id.startsWith('UNASSIGNED-')) return false
      const ord = orders.find((o) => o.id === id)
      if (!ord) return true
      const dispUpper = String(ord.dispute_status || '').toUpperCase()
      return (
        ord.status_code !== 'DISPUTE_RECOVERED' &&
        ord.status_code !== 'DISPUTE_CLOSED_UNRECOVERED' &&
        !['ACCEPTED_LOSS', 'REJECTED', 'DENIED'].includes(dispUpper)
      )
    })
    if (validIds.length === 0) {
      setBannerMessage({
        type: 'warning',
        text: t('deliveryReconciliation.dispute_batch_no_eligible'),
      })
      setBatchOrderConfirmModal(null)
      return
    }
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
          dispute_notes: batchNotes.trim() || t('deliveryReconciliation.batch_notes_submitted_default'),
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Error al actualizar estado de disputas en lote')
      }
      setBannerMessage({
        type: 'success',
        text: t('deliveryReconciliation.dispute_batch_updated_count', { count: data.updatedCount ?? validIds.length }),
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
    const headers = isEn
      ? [
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
          'Original Disputed Amount',
          'Recovery Payout Ref',
          'Verified Recovery Amount',
          'Pending Unrecovered Amount',
          'Items Summary (Toast POS)',
          'Audit Evidence',
        ]
      : [
          'Fecha Operativa',
          'Sucursal',
          'Plataforma',
          'ID Orden Plataforma',
          'Cheque Toast #',
          'Nombre Cuenta Toast',
          'Venta Neta Toast',
          'Tax Toast',
          'Bruto Esperado Toast',
          'Subtotal Plataforma',
          'Tax a Tacos Gavilan (24001)',
          'Tax Retenido MFT (12050)',
          'Bruto Reconocido Plataforma',
          'Cargo por Error / Deducción',
          'Neto Pagado',
          'Corte Deducción Original',
          'Estado Disputa',
          'Motivo Disputa',
          'Monto Original Disputado',
          'Corte(s) de Recuperación',
          'Recuperado Verificado',
          'Saldo Pendiente',
          'Platillos (Toast POS)',
          'Evidencia de Auditoría',
        ]
    const csvLines = [
      headers.map(escapeCsvCell).join(','),
      ...targetOrders.map((o) => {
        const itemsText = Array.isArray(o.items_summary)
          ? o.items_summary
              .map((it: any) => `${it.quantity || 1}x ${it.name} ($${Number(it.price || 0).toFixed(2)})`)
              .join(' | ')
          : ''
        const recRefs =
          Array.isArray(o.recovery_credits_evaluated) && o.recovery_credits_evaluated.length > 0
            ? Array.from(new Set(o.recovery_credits_evaluated.map((c) => c.payout_reference_id))).join(' + ')
            : o.raw_payload?.reimbursement_payout_ref || ''
        return [
          escapeCsvCell(fmtDateMDY(o.business_date)),
          escapeCsvCell(o.store_name),
          escapeCsvCell(formatPlatformDisplayName(o.platform)),
          escapeCsvCell(o.platform_order_id),
          escapeCsvCell(o.toast_display_number || ''),
          escapeCsvCell(o.toast_tab_name || ''),
          Number(o.toast_net_sales || 0).toFixed(2),
          Number(o.toast_tax || 0).toFixed(2),
          Number(o.toast_expected_gross || 0).toFixed(2),
          Number(o.platform_subtotal || 0).toFixed(2),
          Number(o.platform_tax_paid_to_merchant || 0).toFixed(2),
          Number(o.platform_tax_withheld || 0).toFixed(2),
          Number(o.platform_gross_receivable || 0).toFixed(2),
          Number(o.error_charge || 0).toFixed(2),
          Number(o.net_payout || 0).toFixed(2),
          escapeCsvCell(o.payout_reference_id || ''),
          escapeCsvCell(o.dispute_status || 'NONE'),
          escapeCsvCell(o.dispute_reason || ''),
          Number(o.original_deduction_abs ?? o.dispute_amount ?? Math.abs(Number(o.error_charge || 0))).toFixed(2),
          escapeCsvCell(recRefs),
          Number(o.recovered_amount ?? 0).toFixed(2),
          Number(o.unrecovered_amount ?? 0).toFixed(2),
          escapeCsvCell(itemsText),
          escapeCsvCell((isEn ? o.evidence_en : o.evidence_es) || ''),
        ].join(',')
      }),
    ]
    const blob = new Blob(['\uFEFF' + csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `TacosGavilan_Dispute_Evidence_Package_${startDate}_${endDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Órdenes estrictamente dentro del período seleccionado (Tab 1 & KPIs sin mezcla de recuperaciones externas)
  const periodOrders = useMemo(() => orders.filter((o) => o.in_selected_period !== false), [orders])
  const isClosedLossOrder = (o: ReconciledOrder) => {
    const d = String(o.dispute_status || '').toUpperCase()
    return o.status_code === 'DISPUTE_CLOSED_UNRECOVERED' || ['ACCEPTED_LOSS', 'DENIED', 'REJECTED'].includes(d)
  }
  const hasDisputeFinancialImpact = (o: ReconciledOrder) => {
    const orig = Number(o.original_deduction_abs ?? o.dispute_amount ?? Math.abs(Number(o.error_charge || 0) + Number(o.adjustment_amount || 0)))
    const rec = Number(o.recovered_amount ?? 0)
    const pen = Number(o.unrecovered_amount ?? 0)
    return Math.abs(orig) > 0.01 || Math.abs(rec) > 0.01 || Math.abs(pen) > 0.01
  }

  // Agrupación de órdenes en los 4 grupos mutuamente claros + subfiltros 1:1
  const group1Conciliated = useMemo(
    () => periodOrders.filter((o) => o.action_group === 'CONCILIATED_READY'),
    [periodOrders]
  )
  const group2Variance = useMemo(
    () => periodOrders.filter((o) => o.action_group === 'VARIANCE_INVESTIGATE'),
    [periodOrders]
  )
  const group3Disputes = useMemo(
    () => orders.filter((o) => o.action_group === 'DISPUTE_RECOVERY' && hasDisputeFinancialImpact(o)),
    [orders]
  )
  const periodDisputesCount = useMemo(
    () => periodOrders.filter((o) => o.action_group === 'DISPUTE_RECOVERY' && hasDisputeFinancialImpact(o)).length,
    [periodOrders]
  )
  const openDisputeOrders = useMemo(
    () =>
      group3Disputes.filter(
        (o) => o.status_code !== 'DISPUTE_RECOVERED' && !isClosedLossOrder(o)
      ),
    [group3Disputes]
  )
  const recoveredDisputeOrders = useMemo(
    () => group3Disputes.filter((o) => o.status_code === 'DISPUTE_RECOVERED'),
    [group3Disputes]
  )
  const closedLossDisputeOrders = useMemo(
    () => group3Disputes.filter((o) => isClosedLossOrder(o)),
    [group3Disputes]
  )
  const filteredDisputes = useMemo(() => {
    if (disputesSubFilter === 'PENDING') return openDisputeOrders
    if (disputesSubFilter === 'RECOVERED') return recoveredDisputeOrders
    if (disputesSubFilter === 'CLOSED_LOSS') return closedLossDisputeOrders
    return group3Disputes
  }, [disputesSubFilter, group3Disputes, openDisputeOrders, recoveredDisputeOrders, closedLossDisputeOrders])
  const disputesKpi = useMemo(() => {
    let original = 0
    let recovered = 0
    let closedLoss = 0
    let pending = 0
    for (const o of group3Disputes) {
      const orig = Number(o.original_deduction_abs ?? o.dispute_amount ?? Math.abs(Number(o.error_charge || 0)))
      const safeOrig = Number.isFinite(orig) ? orig : 0
      const rec = Number(o.recovered_amount ?? 0)
      const safeRec = Number.isFinite(rec) ? rec : 0
      original += safeOrig
      recovered += safeRec
      if (isClosedLossOrder(o)) {
        closedLoss += Math.max(0, Number((safeOrig - safeRec).toFixed(2)))
      } else {
        const pen = Number(o.unrecovered_amount ?? 0)
        pending += Number.isFinite(pen) ? pen : 0
      }
    }
    return { original, recovered, closedLoss, pending }
  }, [group3Disputes])
  const underpaidOrDisputeOrders = useMemo(
    () =>
      periodOrders.filter(
        (o) =>
          o.action_group === 'VARIANCE_INVESTIGATE' ||
          (o.action_group === 'DISPUTE_RECOVERY' &&
            o.status_code !== 'DISPUTE_RECOVERED' &&
            !isClosedLossOrder(o))
      ),
    [periodOrders]
  )
  const group4Blocked = useMemo(
    () => periodOrders.filter((o) => o.action_group === 'BLOCKED_MISSING_INFO'),
    [periodOrders]
  )
  const withPayoutPendingReviewOrders = useMemo(
    () =>
      periodOrders.filter(
        (o) =>
          o.match_confidence !== 'TOAST_ONLY' &&
          o.reconciliation_status !== 'MISSING_IN_PLATFORM' &&
          o.action_group !== 'CONCILIATED_READY' &&
          Boolean(o.payout_reference_id && String(o.payout_reference_id).trim()) &&
          Number(o.store_id) > 0 &&
          o.status_code !== 'DISPUTE_RECOVERED' &&
          !isClosedLossOrder(o)
      ),
    [periodOrders]
  )
  const toastOnlyOrders = useMemo(
    () =>
      periodOrders.filter(
        (o) => o.match_confidence === 'TOAST_ONLY' || o.reconciliation_status === 'MISSING_IN_PLATFORM'
      ),
    [periodOrders]
  )
  const toastUnpaidSyncedOrders = useMemo(
    () => toastOnlyOrders.filter((o) => Boolean(o.toast_only_store_synced)),
    [toastOnlyOrders]
  )
  const toastPendingSyncOrders = useMemo(
    () => toastOnlyOrders.filter((o) => !o.toast_only_store_synced),
    [toastOnlyOrders]
  )
  const platformMissingToastOrders = useMemo(
    () =>
      periodOrders.filter((o) =>
        o.platform_missing_toast_synced !== undefined
          ? Boolean(o.platform_missing_toast_synced) && !o.raw_payload?.toast_voided
          : o.match_confidence !== 'TOAST_ONLY' &&
            o.reconciliation_status !== 'MISSING_IN_PLATFORM' &&
            !o.toast_order_guid &&
            !o.raw_payload?.toast_voided &&
            o.raw_payload?.explicit_review_decision !== 'CONFIRM_TOAST_MATCH' &&
            (Number(o.platform_subtotal || 0) > 0 || Number(o.platform_gross_receivable || 0) > 0)
      ),
    [periodOrders]
  )

  const displayedOrders = useMemo(() => {
    if (selectedOrderSubFilter === 'UNDERPAID_OR_DISPUTE') return underpaidOrDisputeOrders
    if (selectedOrderSubFilter === 'WITH_PAYOUT_PENDING_REVIEW') return withPayoutPendingReviewOrders
    if (selectedOrderSubFilter === 'TOAST_ONLY') return toastOnlyOrders
    if (selectedOrderSubFilter === 'TOAST_UNPAID_SYNCED') return toastUnpaidSyncedOrders
    if (selectedOrderSubFilter === 'TOAST_PENDING_SYNC') return toastPendingSyncOrders
    if (selectedOrderSubFilter === 'PLATFORM_MISSING_TOAST') return platformMissingToastOrders
    if (selectedActionGroup === 'CONCILIATED_READY') return group1Conciliated
    if (selectedActionGroup === 'VARIANCE_INVESTIGATE') return group2Variance
    if (selectedActionGroup === 'DISPUTE_RECOVERY') return group3Disputes
    if (selectedActionGroup === 'BLOCKED_MISSING_INFO') return group4Blocked
    return periodOrders
  }, [
    orders,
    selectedOrderSubFilter,
    underpaidOrDisputeOrders,
    withPayoutPendingReviewOrders,
    toastOnlyOrders,
    toastUnpaidSyncedOrders,
    toastPendingSyncOrders,
    platformMissingToastOrders,
    selectedActionGroup,
    group1Conciliated,
    group2Variance,
    group3Disputes,
    group4Blocked,
    periodOrders,
  ])

  const handleExportCsv = () => {
    const sourceRows = displayedOrders
    if (sourceRows.length === 0) return
    const headers = isEn
      ? [
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
      : [
          'Fecha Operativa',
          'Sucursal',
          'Plataforma',
          'Grupo Operativo',
          'Estado',
          'ID Orden Plataforma',
          'Ticket Toast #',
          'Venta Neta Toast',
          'Tax Toast',
          'Bruto Esperado Toast',
          'Subtotal Plataforma',
          'Tax a Tacos Gavilan (24001)',
          'Tax Retenido MFT (12050)',
          'Bruto Reconocido Plataforma',
          'Total Comisiones',
          'Cargo Error / Ajuste',
          'Neto Pagado',
          'Diferencia Bruta',
          'Qué Pasó',
          'Causa',
          'Evidencia',
          'Siguiente Acción',
          'ID Corte (Payout)',
          'Corte(s) de Reembolso',
        ]
    const csvLines = [
      headers.map(escapeCsvCell).join(','),
      ...sourceRows.map((o) => {
        const varVal = Number(o.gross_variance ?? o.gross_diff ?? 0)
        const feesVal =
          Number(o.commission_fee || 0) +
          Number(o.delivery_fee || 0) +
          Number(o.processing_fee || 0) +
          Number(o.marketing_fee || 0)
        const recRefs =
          Array.isArray(o.recovery_credits_evaluated) && o.recovery_credits_evaluated.length > 0
            ? Array.from(new Set(o.recovery_credits_evaluated.map((c) => c.payout_reference_id))).join(' + ')
            : o.raw_payload?.reimbursement_payout_ref || ''
        return [
          escapeCsvCell(fmtDateMDY(o.business_date)),
          escapeCsvCell(o.store_name),
          escapeCsvCell(formatPlatformDisplayName(o.platform)),
          escapeCsvCell(o.action_group || ''),
          escapeCsvCell((isEn ? o.status_label_en : o.status_label_es) || o.reconciliation_status),
          escapeCsvCell(o.platform_order_id),
          escapeCsvCell(o.toast_display_number || ''),
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
          escapeCsvCell((isEn ? o.what_happened_en : o.what_happened_es) || ''),
          escapeCsvCell((isEn ? o.cause_en : o.cause_es) || ''),
          escapeCsvCell((isEn ? o.evidence_en : o.evidence_es) || ''),
          escapeCsvCell((isEn ? o.next_action_en : o.next_action_es) || ''),
          escapeCsvCell(o.payout_reference_id || ''),
          escapeCsvCell(recRefs),
        ].join(',')
      }),
    ]
    const blob = new Blob(['\uFEFF' + csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `TacosGavilan_Conciliacion_Delivery_${startDate}_${endDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleExportXlsx = () => {
    const sourceRows = displayedOrders
    const visiblePayouts = payouts.filter((p) => {
      if (selectedStore !== 'ALL' && String(p.store_id) !== String(selectedStore)) return false
      if (selectedPlatform !== 'ALL' && p.platform !== selectedPlatform) return false
      return true
    })
    if (sourceRows.length === 0 && visiblePayouts.length === 0) return

    const n2 = (v: unknown) => Math.round((Number(v || 0) || 0) * 100) / 100
    const wb = XLSX.utils.book_new()

    // Hoja 1: Resumen Ejecutivo por Plataforma
    const platformsList: DeliveryPlatform[] = ['DOORDASH', 'UBER_EATS', 'GRUBHUB']
    const summaryRows = platformsList.map((plat) => {
      const pOrders = sourceRows.filter((o) => o.platform === plat)
      const pCuts = visiblePayouts.filter((p) => p.platform === plat)
      const fees = pOrders.reduce(
        (s, o) =>
          s +
          Number(o.commission_fee || 0) +
          Number(o.delivery_fee || 0) +
          Number(o.processing_fee || 0) +
          Number(o.marketing_fee || 0),
        0
      )
      const errAdj = pOrders.reduce((s, o) => s + Number(o.error_charge || 0) + Number(o.adjustment_amount || 0), 0)
      return isEn
        ? {
            Platform: formatPlatformDisplayName(plat),
            Period: `${startDate} -> ${endDate}`,
            Orders: pOrders.length,
            'Weekly Payouts': pCuts.length,
            'Toast Net Sales': n2(pOrders.reduce((s, o) => s + Number(o.toast_net_sales || 0), 0)),
            'Toast Tax': n2(pOrders.reduce((s, o) => s + Number(o.toast_tax || 0), 0)),
            'Toast Expected Gross': n2(pOrders.reduce((s, o) => s + Number(o.toast_expected_gross || 0), 0)),
            'Platform Subtotal': n2(pOrders.reduce((s, o) => s + Number(o.platform_subtotal || 0), 0)),
            'Tax to Tacos Gavilan (24001)': n2(pOrders.reduce((s, o) => s + Number(o.platform_tax_paid_to_merchant || 0), 0)),
            'MFT Tax Withheld (12050)': n2(pOrders.reduce((s, o) => s + Number(o.platform_tax_withheld || 0), 0)),
            'Platform Gross Receivable': n2(pOrders.reduce((s, o) => s + Number(o.platform_gross_receivable || 0), 0)),
            'Total Fees': n2(fees),
            'Error Charge / Adj': n2(errAdj),
            'Orders Net Payout': n2(pOrders.reduce((s, o) => s + Number(o.net_payout || 0), 0)),
            'Settlements Net Deposit': n2(pCuts.reduce((s, p) => s + Number(p.net_payout_amount || 0), 0)),
            'Gross Variance': n2(pOrders.reduce((s, o) => s + Number(o.gross_variance ?? o.gross_diff ?? 0), 0)),
          }
        : {
            Plataforma: formatPlatformDisplayName(plat),
            Periodo: `${startDate} -> ${endDate}`,
            Ordenes: pOrders.length,
            'Cortes Semanales': pCuts.length,
            'Venta Neta Toast': n2(pOrders.reduce((s, o) => s + Number(o.toast_net_sales || 0), 0)),
            'Tax Toast': n2(pOrders.reduce((s, o) => s + Number(o.toast_tax || 0), 0)),
            'Bruto Esperado Toast': n2(pOrders.reduce((s, o) => s + Number(o.toast_expected_gross || 0), 0)),
            'Subtotal Plataforma': n2(pOrders.reduce((s, o) => s + Number(o.platform_subtotal || 0), 0)),
            'Tax a Tacos Gavilan (24001)': n2(pOrders.reduce((s, o) => s + Number(o.platform_tax_paid_to_merchant || 0), 0)),
            'Tax Retenido MFT (12050)': n2(pOrders.reduce((s, o) => s + Number(o.platform_tax_withheld || 0), 0)),
            'Bruto Reconocido Plataforma': n2(pOrders.reduce((s, o) => s + Number(o.platform_gross_receivable || 0), 0)),
            'Total Comisiones': n2(fees),
            'Cargo Error / Ajuste': n2(errAdj),
            'Neto Ordenes': n2(pOrders.reduce((s, o) => s + Number(o.net_payout || 0), 0)),
            'Deposito Neto Cortes': n2(pCuts.reduce((s, p) => s + Number(p.net_payout_amount || 0), 0)),
            'Diferencia Bruta': n2(pOrders.reduce((s, o) => s + Number(o.gross_variance ?? o.gross_diff ?? 0), 0)),
          }
    })
    const wsSummary = XLSX.utils.json_to_sheet(summaryRows)
    wsSummary['!cols'] = Array(16).fill({ wch: 22 })
    XLSX.utils.book_append_sheet(wb, wsSummary, isEn ? 'Summary' : 'Resumen')

    // Hoja 2: Cortes Semanales (Payouts)
    const payoutSheetRows = visiblePayouts.map((p) =>
      isEn
        ? {
            'Payout Date': p.payout_date ? fmtDateMDY(p.payout_date) : '',
            Store: p.store_name,
            Platform: formatPlatformDisplayName(p.platform),
            'Payout Reference ID': p.payout_reference_id,
            'Period Start': p.period_start ? fmtDateMDY(p.period_start) : '',
            'Period End': p.period_end ? fmtDateMDY(p.period_end) : '',
            Orders: Number(p.orders_count || 0),
            Subtotal: n2(p.subtotal_sales),
            'Tax to Tacos Gavilan (24001)': n2(p.tax_paid_to_merchant),
            'MFT Tax Withheld (12050)': n2(p.tax_remitted_by_platform),
            'Accounting Gross': n2(p.accounting_gross_receivable ?? p.platform_gross_receivable),
            'Total Fees': n2(
              p.accounting_total_fees ??
                Number(p.commission_fees || 0) +
                  Number(p.delivery_fees || 0) +
                  Number(p.processing_fees || 0) +
                  Number(p.marketing_fees || 0)
            ),
            'Error Charges': n2(p.error_charges),
            Adjustments: n2(p.adjustments_amount),
            Tips: n2(p.tips_amount),
            'Net Deposit': n2(p.net_payout_amount),
            'Toast Expected Gross': n2(p.toast_expected_gross),
            'Gross Variance': n2(p.accounting_gross_variance ?? p.gross_variance),
            Status: p.status,
          }
        : {
            'Fecha Deposito': p.payout_date ? fmtDateMDY(p.payout_date) : '',
            Sucursal: p.store_name,
            Plataforma: formatPlatformDisplayName(p.platform),
            'ID Corte (Payout)': p.payout_reference_id,
            'Inicio Periodo': p.period_start ? fmtDateMDY(p.period_start) : '',
            'Fin Periodo': p.period_end ? fmtDateMDY(p.period_end) : '',
            Ordenes: Number(p.orders_count || 0),
            Subtotal: n2(p.subtotal_sales),
            'Tax a Tacos Gavilan (24001)': n2(p.tax_paid_to_merchant),
            'Tax Retenido MFT (12050)': n2(p.tax_remitted_by_platform),
            'Bruto Contable': n2(p.accounting_gross_receivable ?? p.platform_gross_receivable),
            'Total Comisiones': n2(
              p.accounting_total_fees ??
                Number(p.commission_fees || 0) +
                  Number(p.delivery_fees || 0) +
                  Number(p.processing_fees || 0) +
                  Number(p.marketing_fees || 0)
            ),
            'Cargos Error': n2(p.error_charges),
            Ajustes: n2(p.adjustments_amount),
            Propinas: n2(p.tips_amount),
            'Deposito Neto': n2(p.net_payout_amount),
            'Bruto Esperado Toast': n2(p.toast_expected_gross),
            'Diferencia Bruta': n2(p.accounting_gross_variance ?? p.gross_variance),
            Estado: p.status,
          }
    )
    const wsPayouts = XLSX.utils.json_to_sheet(payoutSheetRows)
    wsPayouts['!cols'] = Array(19).fill({ wch: 20 })
    XLSX.utils.book_append_sheet(wb, wsPayouts, isEn ? 'Weekly Payouts' : 'Cortes Semanales')

    // Hoja 3: Detalle de Órdenes (con números reales sumables en Excel)
    const orderSheetRows = sourceRows.map((o) => {
      const varVal = Number(o.gross_variance ?? o.gross_diff ?? 0)
      const feesVal =
        Number(o.commission_fee || 0) +
        Number(o.delivery_fee || 0) +
        Number(o.processing_fee || 0) +
        Number(o.marketing_fee || 0)
      const recRefs =
        Array.isArray(o.recovery_credits_evaluated) && o.recovery_credits_evaluated.length > 0
          ? Array.from(new Set(o.recovery_credits_evaluated.map((c) => c.payout_reference_id))).join(' + ')
          : o.raw_payload?.reimbursement_payout_ref || ''
      return isEn
        ? {
            'Business Date': fmtDateMDY(o.business_date),
            Store: o.store_name,
            Platform: formatPlatformDisplayName(o.platform),
            'Action Group': o.action_group || '',
            'Status Label': o.status_label_en || o.reconciliation_status,
            'Platform Order ID': o.platform_order_id,
            'Toast Order #': o.toast_display_number || '',
            'Toast Net Sales': n2(o.toast_net_sales),
            'Toast Tax': n2(o.toast_tax),
            'Toast Expected Gross': n2(o.toast_expected_gross),
            'Platform Subtotal': n2(o.platform_subtotal),
            'Platform Tax Passed to TEG (24001)': n2(o.platform_tax_paid_to_merchant),
            'Platform Tax Withheld (12050)': n2(o.platform_tax_withheld),
            'Platform Gross Receivable': n2(o.platform_gross_receivable),
            'Total Fees': n2(feesVal),
            'Error Charge / Adj': n2(Number(o.error_charge || 0) + Number(o.adjustment_amount || 0)),
            'Net Payout': n2(o.net_payout),
            'Gross Variance': n2(varVal),
            'What Happened': o.what_happened_en || '',
            Cause: o.cause_en || '',
            Evidence: o.evidence_en || '',
            'Next Action': o.next_action_en || '',
            'Payout Reference ID': o.payout_reference_id || '',
            'Reimbursement Payout Ref': recRefs,
          }
        : {
            'Fecha Operativa': fmtDateMDY(o.business_date),
            Sucursal: o.store_name,
            Plataforma: formatPlatformDisplayName(o.platform),
            'Grupo Operativo': o.action_group || '',
            Estado: o.status_label_es || o.reconciliation_status,
            'ID Orden Plataforma': o.platform_order_id,
            'Ticket Toast #': o.toast_display_number || '',
            'Venta Neta Toast': n2(o.toast_net_sales),
            'Tax Toast': n2(o.toast_tax),
            'Bruto Esperado Toast': n2(o.toast_expected_gross),
            'Subtotal Plataforma': n2(o.platform_subtotal),
            'Tax a Tacos Gavilan (24001)': n2(o.platform_tax_paid_to_merchant),
            'Tax Retenido MFT (12050)': n2(o.platform_tax_withheld),
            'Bruto Reconocido Plataforma': n2(o.platform_gross_receivable),
            'Total Comisiones': n2(feesVal),
            'Cargo Error / Ajuste': n2(Number(o.error_charge || 0) + Number(o.adjustment_amount || 0)),
            'Neto Pagado': n2(o.net_payout),
            'Diferencia Bruta': n2(varVal),
            'Que Paso': o.what_happened_es || '',
            Causa: o.cause_es || '',
            Evidencia: o.evidence_es || '',
            'Siguiente Accion': o.next_action_es || '',
            'ID Corte (Payout)': o.payout_reference_id || '',
            'Corte(s) de Reembolso': recRefs,
          }
    })
    const wsOrders = XLSX.utils.json_to_sheet(orderSheetRows)
    wsOrders['!cols'] = Array(24).fill({ wch: 20 })
    XLSX.utils.book_append_sheet(wb, wsOrders, isEn ? 'Order Detail' : 'Ordenes Detalle')

    XLSX.writeFile(wb, `TacosGavilan_Conciliacion_Delivery_${startDate}_${endDate}.xlsx`)
  }

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

  useEffect(() => {
    if (!startDate || !endDate) return
    const detected = classifyDeliveryPeriod(startDate, endDate)
    setSelectedPeriod((prev) => (prev === detected ? prev : detected))
  }, [startDate, endDate])

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
      if (ord.action_group === 'DISPUTE_RECOVERY') {
        const d = String(ord.dispute_status || '').toUpperCase()
        if (
          ord.status_code === 'DISPUTE_RECOVERED' ||
          ord.status_code === 'DISPUTE_CLOSED_UNRECOVERED' ||
          ['ACCEPTED_LOSS', 'DENIED', 'REJECTED'].includes(d)
        ) {
          return false
        }
      } else if (ord.action_group !== 'VARIANCE_INVESTIGATE') {
        return false
      }
      if (activeSelectedBatchGroup && ord.action_group !== activeSelectedBatchGroup) {
        return false
      }
      return true
    },
    [activeSelectedBatchGroup]
  )

  const translateStatusCode = useCallback(
    (code: string | null | undefined, fallback?: string | null) => {
      const keyMap: Record<string, string> = {
        CONCILIATED_NEXT_PAYOUT: 'deliveryReconciliation.status_CONCILIATED_NEXT_PAYOUT',
        MATCHED_OK: 'deliveryReconciliation.status_MATCHED_OK',
        DISPUTE_OPEN: 'deliveryReconciliation.status_DISPUTE_OPEN',
        DISPUTE_SUBMITTED: 'deliveryReconciliation.status_DISPUTE_SUBMITTED',
        DISPUTE_APPROVED: 'deliveryReconciliation.status_DISPUTE_APPROVED',
        DISPUTE_PARTIALLY_RECOVERED: 'deliveryReconciliation.status_DISPUTE_PARTIALLY_RECOVERED',
        DISPUTE_RECOVERED: 'deliveryReconciliation.status_DISPUTE_RECOVERED',
        DISPUTE_CLOSED_UNRECOVERED: 'deliveryReconciliation.status_DISPUTE_CLOSED_UNRECOVERED',
        WITH_PAYOUT_PENDING_REVIEW: 'deliveryReconciliation.status_WITH_PAYOUT_PENDING_REVIEW',
        REQUIRES_REVIEW: 'deliveryReconciliation.status_REQUIRES_REVIEW',
      }
      const c = String(code || '').toUpperCase()
      if (c && keyMap[c]) return t(keyMap[c])
      return fallback || c || '—'
    },
    [t]
  )

  const translateVerificationIssue = useCallback(
    (issue: string | null | undefined) => {
      const issueMap: Record<string, string> = {
        RECOVERY_IN_SAME_PAYOUT_AS_DEDUCTION: 'deliveryReconciliation.issue_RECOVERY_IN_SAME_PAYOUT_AS_DEDUCTION',
        PAYOUT_NOT_FOUND_IN_PLATFORM_CUTS: 'deliveryReconciliation.issue_PAYOUT_NOT_FOUND_IN_PLATFORM_CUTS',
        CREDIT_WITHOUT_POSITIVE_SETTLEMENT_MOVEMENT: 'deliveryReconciliation.issue_CREDIT_WITHOUT_POSITIVE_SETTLEMENT_MOVEMENT',
        CREDIT_WITHOUT_MATCHED_AMOUNT: 'deliveryReconciliation.issue_CREDIT_WITHOUT_MATCHED_AMOUNT',
      }
      const raw = String(issue || '').trim()
      if (raw && issueMap[raw]) return t(issueMap[raw])
      return raw
    },
    [t]
  )

  const activeStoreLabel = useMemo(() => {
    if (selectedStore === 'ALL') return t('deliveryReconciliation.all_stores')
    if (selectedStore === '0') return t('deliveryReconciliation.unassigned_store_option')
    const found = mappings.find((m) => String(m.store_id) === String(selectedStore))
    return found ? `${found.store_name} (${found.store_code})` : `#${selectedStore}`
  }, [selectedStore, mappings, t])

  const getStorePlatformCoverageEntry = useCallback(
    (storeId: number, platform: DeliveryPlatform) => {
      const matrix =
        coverageReport?.byStorePlatform ||
        coverageReport?.storePlatformMatrix ||
        syncStatus?.storePlatformCoverage ||
        []
      if (Array.isArray(matrix)) {
        const match = matrix.find(
          (item: any) => Number(item.store_id ?? item.storeId) === Number(storeId) && item.platform === platform
        )
        if (match) {
          return {
            status: match.status || 'NOT_CONNECTED',
            orders_count: match.orders_count ?? match.ordersCount ?? 0,
            payouts_count: match.payouts_count ?? match.payoutsCount ?? 0,
            toast_only_count: match.toast_only_count ?? match.toastOnlyCount ?? 0,
            last_sync_at: match.last_sync_at ?? match.lastSyncAt ?? null,
            cause_es: match.cause_es ?? match.causeEs ?? '',
            cause_en: match.cause_en ?? match.causeEn ?? '',
            next_action_es: match.next_action_es ?? match.nextActionEs ?? '',
            next_action_en: match.next_action_en ?? match.nextActionEn ?? '',
          }
        }
      }
      const stSync = syncStatus?.byStore?.[storeId]
      const lastSyncAt =
        platform === 'DOORDASH'
          ? stSync?.ddLastSync || null
          : platform === 'GRUBHUB'
          ? stSync?.ghLastSync || null
          : stSync?.ueLastSync || null
      return {
        status: 'NOT_SYNCED_IN_RANGE',
        orders_count: 0,
        payouts_count: 0,
        toast_only_count: 0,
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
    const rawLabel = (isEn ? ord.status_label_en : ord.status_label_es) || ''
    const label = rawLabel || translateStatusCode(ord.status_code || ord.reconciliation_status, ord.reconciliation_status)
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
    openDisputeOrders.length > 0 ||
    group4Blocked.length > 0 ||
    !coverageReport?.isCoverageComplete

  const isAnyModalOpen =
    showBatchConfirmModal ||
    Boolean(selectedQbRecord) ||
    Boolean(batchOrderConfirmModal) ||
    Boolean(selectedOrder) ||
    showImportModal

  const renderBannerAlert = () => {
    if (!bannerMessage) return null
    const styleClass =
      bannerMessage.type === 'success'
        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
        : bannerMessage.type === 'warning'
        ? 'bg-amber-500/15 border-amber-500/40 text-amber-800 dark:text-amber-200'
        : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
    return (
      <div className={`p-3 rounded-xl border flex items-center justify-between gap-2 ${styleClass}`}>
        <span className="text-xs md:text-sm font-semibold">{bannerMessage.text}</span>
        <button
          type="button"
          onClick={() => setBannerMessage(null)}
          className="p-1 hover:opacity-75 shrink-0"
          aria-label={t('deliveryReconciliation.modal_close')}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    )
  }

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
            type="button"
            onClick={() => {
              fetchData()
              fetchQbJournalRecords()
            }}
            className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-extrabold shrink-0"
          >
            {t('deliveryReconciliation.retry_btn')}
          </button>
        </div>
      )}

      {/* 1. CABECERA SIMPLIFICADA: ALCANCE, COBERTURA, ÚLTIMA SINCRONIZACIÓN Y SELECTOR UNIFICADO SEMANA/DÍA */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm space-y-4">
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="min-w-0">
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

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleLiveSync}
              disabled={syncing || loading || !isDateRangeValid || selectedStore === '0'}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-bold text-xs md:text-sm shadow-sm transition whitespace-nowrap"
            >
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
              {syncing
                ? t('deliveryReconciliation.syncing_short')
                : (userScope?.isGlobalScope ?? true) && selectedStore === 'ALL' && mappings.length > 1
                ? t('deliveryReconciliation.sync_queue_btn', { count: mappings.length })
                : t('deliveryReconciliation.sync_store_period_btn')}
            </button>

            <button
              type="button"
              onClick={handleExportXlsx}
              disabled={syncing || (displayedOrders.length === 0 && payouts.length === 0)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs md:text-sm shadow-sm transition whitespace-nowrap"
            >
              <FileSpreadsheet className="w-4 h-4" />
              {t('deliveryReconciliation.export_xlsx_short')}
            </button>

            <button
              type="button"
              onClick={handleExportCsv}
              disabled={syncing || displayedOrders.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-50 text-slate-700 dark:text-slate-200 font-semibold text-xs md:text-sm border border-slate-200 dark:border-slate-700 transition whitespace-nowrap"
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
                type="button"
                onClick={() => setShowTaxRulesPopover(false)}
                className="p-1 rounded hover:bg-indigo-500/10"
                aria-label={t('deliveryReconciliation.modal_close')}
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
              <strong className="text-slate-500 dark:text-slate-400">{t('deliveryReconciliation.scope_bar_stores')}</strong>{' '}
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
              <strong className="text-slate-500 dark:text-slate-400">{t('deliveryReconciliation.scope_bar_platforms')}</strong>{' '}
              <span className="font-extrabold text-slate-900 dark:text-white">
                {selectedPlatform === 'ALL'
                  ? t('deliveryReconciliation.all_platforms')
                  : formatPlatformDisplayName(selectedPlatform)}
              </span>
            </span>
            <span>•</span>
            <span>
              <strong className="text-slate-500 dark:text-slate-400">{t('deliveryReconciliation.scope_bar_period')}</strong>{' '}
              <span className="font-mono font-extrabold text-indigo-600 dark:text-indigo-400">
                {startDate === endDate
                  ? fmtDateMDY(startDate)
                  : `${fmtDateMDY(startDate)} → ${fmtDateMDY(endDate)}`}
              </span>
            </span>
            <span>•</span>
            <span>
              <strong className="text-slate-500 dark:text-slate-400">{t('deliveryReconciliation.scope_bar_last_sync')}</strong>{' '}
              <span className="font-mono font-semibold">{fmtLaTimestamp(latestSyncTimestamp)}</span>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {activePayoutRef && (
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-600 text-white font-mono text-xs font-extrabold"
                title={activePayoutRef}
              >
                {t('deliveryReconciliation.scope_active_payout_filter', {
                  ref: shortenRef(activePayoutRef, 20),
                })}
                <button
                  type="button"
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

        {/* BARRA DE 4 FILTROS CON SELECTOR UNIFICADO DE PERIODO (POR SEMANA / POR DÍA, DEFAULT: SEMANA PASADA) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <div>
            <label
              htmlFor="conciliar-filter-store"
              className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1"
            >
              {t('deliveryReconciliation.filter_1_store')}
            </label>
            <select
              id="conciliar-filter-store"
              name="store"
              disabled={syncing}
              aria-label={t('deliveryReconciliation.filter_1_store')}
              value={selectedStore}
              onChange={(e) => {
                setSelectedStore(e.target.value)
                setActivePayoutRef('')
                setSelectedOrderSubFilter('NONE')
              }}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs md:text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {(userScope?.isGlobalScope ?? true) && (
                <>
                  <option value="ALL">{t('deliveryReconciliation.all_stores')}</option>
                  {((coverageReport?.unassignedOrdersCount || 0) + (coverageReport?.unassignedPayoutsCount || 0) > 0 ||
                    selectedStore === '0') && (
                    <option value="0">{t('deliveryReconciliation.unassigned_store_option')}</option>
                  )}
                </>
              )}
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
            <label
              htmlFor="conciliar-filter-platform"
              className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1"
            >
              {t('deliveryReconciliation.filter_2_platform')}
            </label>
            <select
              id="conciliar-filter-platform"
              name="platform"
              disabled={syncing}
              aria-label={t('deliveryReconciliation.filter_2_platform')}
              value={selectedPlatform}
              onChange={(e) => {
                setSelectedPlatform(e.target.value)
                setActivePayoutRef('')
                setSelectedOrderSubFilter('NONE')
              }}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs md:text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="ALL">{t('deliveryReconciliation.filter_all_platforms_combo')}</option>
              <option value="DOORDASH">DoorDash</option>
              <option value="UBER_EATS">Uber Eats</option>
              <option value="GRUBHUB">Grubhub</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="conciliar-filter-period"
              className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1"
            >
              {t('deliveryReconciliation.filter_3_period')}
            </label>
            <DeliveryPeriodFilter
              period={selectedPeriod}
              startDate={startDate}
              endDate={endDate}
              disabled={syncing}
              onChange={(nextPeriod, nextStart, nextEnd) => {
                setSelectedPeriod(nextPeriod)
                setStartDate(nextStart)
                setEndDate(nextEnd)
                setActivePayoutRef('')
                setSelectedOrderSubFilter('NONE')
              }}
            />
          </div>

          <div>
            <label
              htmlFor="conciliar-filter-search"
              className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1"
            >
              {t('deliveryReconciliation.filter_4_search')}
            </label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
              <input
                id="conciliar-filter-search"
                name="search"
                type="text"
                disabled={syncing}
                aria-label={t('deliveryReconciliation.filter_4_search')}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={t('deliveryReconciliation.filter_5_placeholder')}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pl-9 pr-7 py-2 text-xs md:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput('')
                    setSearchQuery('')
                  }}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  aria-label={t('deliveryReconciliation.batch_clear_selection')}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {!isAnyModalOpen && renderBannerAlert()}

      {syncQueueProgress?.active && (
        <div className="p-3.5 rounded-2xl bg-indigo-500/10 border-2 border-indigo-500/30 space-y-2 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs md:text-sm font-extrabold text-indigo-800 dark:text-indigo-200">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-indigo-600 shrink-0" />
              <span>
                {t('deliveryReconciliation.sync_queue_progress_done', {
                  done: syncQueueProgress.completed,
                  total: syncQueueProgress.total,
                  store: syncQueueProgress.currentStoreName,
                })}
              </span>
            </div>
            <button
              type="button"
              disabled={syncQueueCancelling}
              onClick={() => {
                cancelSyncQueueRef.current = true
                setSyncQueueCancelling(true)
                syncQueueAbortRef.current?.abort()
              }}
              className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white text-xs font-extrabold"
            >
              {syncQueueCancelling
                ? t('deliveryReconciliation.sync_queue_cancelling_btn')
                : t('deliveryReconciliation.sync_queue_cancel_btn')}
            </button>
          </div>
          <div className="w-full h-2.5 rounded-full bg-indigo-200/60 dark:bg-indigo-950 overflow-hidden">
            <div
              className="h-full bg-indigo-600 transition-all duration-300"
              style={{
                width: `${Math.min(
                  100,
                  Math.round((syncQueueProgress.completed / Math.max(1, syncQueueProgress.total)) * 100)
                )}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* 2. PREGUNTA PRINCIPAL + LOS 4 GRUPOS EN ORDEN DE PRIORIDAD VISUAL (1. BLOQUEADOS -> 2. DIFERENCIAS -> 3. DISPUTAS -> 4. LISTOS) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm space-y-3.5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="text-base md:text-lg font-extrabold flex items-center gap-2">
              {hasActionNeeded ? (
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
              ) : (
                <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
              )}
              <span>{t('deliveryReconciliation.bidirectional_title')}</span>
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
              {t('deliveryReconciliation.bidirectional_subtitle')}
            </p>
          </div>
          {(selectedActionGroup !== 'ALL' || selectedOrderSubFilter !== 'NONE') && (
            <button
              type="button"
              onClick={() => {
                setSelectedActionGroup('ALL')
                setSelectedOrderSubFilter('NONE')
              }}
              className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-bold"
            >
              {t('deliveryReconciliation.group_all_title')} ({orders.length})
            </button>
          )}
        </div>

        {/* BARRA DE CRUCE BIDIRECCIONAL TOAST POS <-> PLATAFORMAS DELIVERY */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
          <button
            type="button"
            onClick={() => {
              setSelectedOrderSubFilter('NONE')
              setSelectedActionGroup(selectedActionGroup === 'CONCILIATED_READY' ? 'ALL' : 'CONCILIATED_READY')
              setOrdersPage(1)
              setActiveTab('orders')
            }}
            className={`text-left rounded-xl border p-2.5 transition ${
              selectedActionGroup === 'CONCILIATED_READY' && selectedOrderSubFilter === 'NONE'
                ? 'ring-2 ring-emerald-500 border-emerald-500 bg-emerald-500/10'
                : 'border-emerald-500/25 bg-emerald-500/5 hover:border-emerald-500/50'
            }`}
          >
            <div className="font-extrabold text-emerald-800 dark:text-emerald-300">
              {t('deliveryReconciliation.bidir_card_paid_ok_title')}
            </div>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-lg font-extrabold font-mono text-emerald-700 dark:text-emerald-300">
                {group1Conciliated.length}
              </span>
              <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                {fmtMoney(summary?.conciliatedReadyGross || 0)}
              </span>
            </div>
            {(summary?.inTransitNextPayoutCount || 0) > 0 && (
              <div className="mt-1 text-[10px] font-bold text-indigo-700 dark:text-indigo-300">
                {t('deliveryReconciliation.top_box1_in_transit_note', {
                  count: summary.inTransitNextPayoutCount,
                  gross: fmtMoney(summary.inTransitNextPayoutGross || 0),
                })}
              </div>
            )}
            <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
              {t('deliveryReconciliation.bidir_card_paid_ok_desc')}
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectedActionGroup('ALL')
              setSelectedOrderSubFilter(
                selectedOrderSubFilter === 'UNDERPAID_OR_DISPUTE' ? 'NONE' : 'UNDERPAID_OR_DISPUTE'
              )
              setOrdersPage(1)
              setActiveTab('orders')
            }}
            className={`text-left rounded-xl border p-2.5 transition ${
              selectedOrderSubFilter === 'UNDERPAID_OR_DISPUTE'
                ? 'ring-2 ring-amber-500 border-amber-500 bg-amber-500/10'
                : 'border-amber-500/25 bg-amber-500/5 hover:border-amber-500/50'
            }`}
          >
            <div className="font-extrabold text-amber-800 dark:text-amber-300">
              {t('deliveryReconciliation.bidir_card_underpaid_title')}
            </div>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-lg font-extrabold font-mono text-amber-700 dark:text-amber-300">
                {underpaidOrDisputeOrders.length}
              </span>
              <span className="font-mono font-bold text-amber-700 dark:text-amber-400">
                {fmtMoney(
                  Number(summary?.varianceInvestigateAmount || 0) +
                    Number(summary?.disputePendingRecoveryAmount ?? 0)
                )}
              </span>
            </div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
              {t('deliveryReconciliation.bidir_card_underpaid_desc')}
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectedActionGroup('ALL')
              setSelectedOrderSubFilter(
                selectedOrderSubFilter === 'TOAST_UNPAID_SYNCED' ? 'NONE' : 'TOAST_UNPAID_SYNCED'
              )
              setOrdersPage(1)
              setActiveTab('orders')
            }}
            className={`text-left rounded-xl border p-2.5 transition ${
              selectedOrderSubFilter === 'TOAST_UNPAID_SYNCED'
                ? 'ring-2 ring-rose-500 border-rose-500 bg-rose-500/10'
                : 'border-rose-500/25 bg-rose-500/5 hover:border-rose-500/50'
            }`}
          >
            <div className="font-extrabold text-rose-800 dark:text-rose-300">
              {t('deliveryReconciliation.bidir_card_toast_unpaid_title')}
            </div>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-lg font-extrabold font-mono text-rose-700 dark:text-rose-300">
                {toastUnpaidSyncedOrders.length}
              </span>
              <span className="font-mono font-bold text-rose-700 dark:text-rose-400">
                {fmtMoney(summary?.bidirectionalSummary?.inToastUnpaidSyncedStoreGross || 0)}
              </span>
            </div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
              {t('deliveryReconciliation.bidir_card_toast_unpaid_desc')}
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectedActionGroup('ALL')
              setSelectedOrderSubFilter(
                selectedOrderSubFilter === 'PLATFORM_MISSING_TOAST' ? 'NONE' : 'PLATFORM_MISSING_TOAST'
              )
              setOrdersPage(1)
              setActiveTab('orders')
            }}
            className={`text-left rounded-xl border p-2.5 transition ${
              selectedOrderSubFilter === 'PLATFORM_MISSING_TOAST'
                ? 'ring-2 ring-indigo-500 border-indigo-500 bg-indigo-500/10'
                : 'border-indigo-500/25 bg-indigo-500/5 hover:border-indigo-500/50'
            }`}
          >
            <div className="font-extrabold text-indigo-800 dark:text-indigo-300">
              {t('deliveryReconciliation.bidir_card_platform_only_title')}
            </div>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-lg font-extrabold font-mono text-indigo-700 dark:text-indigo-300">
                {platformMissingToastOrders.length}
              </span>
              <span className="font-mono font-bold text-indigo-700 dark:text-indigo-400">
                {fmtMoney(
                  platformMissingToastOrders.reduce(
                    (acc, o) => acc + Number(o.platform_gross_receivable || 0),
                    0
                  )
                )}
              </span>
            </div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
              {t('deliveryReconciliation.bidir_card_platform_only_desc')}
            </div>
          </button>
        </div>

        {toastPendingSyncOrders.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-100/80 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs">
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              {t('deliveryReconciliation.bidir_pending_store_sync_badge', {
                orders: toastPendingSyncOrders.length,
                stores: summary?.bidirectionalSummary?.pendingSyncStoreIds?.length || 0,
              })}{' '}
              ({fmtMoney(summary?.bidirectionalSummary?.inToastPendingStoreSyncGross || 0)})
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedActionGroup('ALL')
                  setSelectedOrderSubFilter(
                    selectedOrderSubFilter === 'TOAST_PENDING_SYNC' ? 'NONE' : 'TOAST_PENDING_SYNC'
                  )
                  setOrdersPage(1)
                  setActiveTab('orders')
                }}
                className={`px-2.5 py-1 rounded-lg border font-bold transition ${
                  selectedOrderSubFilter === 'TOAST_PENDING_SYNC'
                    ? 'bg-slate-800 text-white border-slate-800 dark:bg-slate-200 dark:text-slate-900'
                    : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                {t('deliveryReconciliation.filter_toast_pending_sync', { count: toastPendingSyncOrders.length })}
              </button>
              {Array.isArray(summary?.bidirectionalSummary?.pendingSyncStoreIds) &&
                summary.bidirectionalSummary.pendingSyncStoreIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      handleProgressiveStoreQueueSync(summary.bidirectionalSummary.pendingSyncStoreIds)
                    }
                    disabled={syncing || loading || !isDateRangeValid}
                    className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-extrabold"
                  >
                    {t('deliveryReconciliation.sync_queue_pending_btn', {
                      count: summary.bidirectionalSummary.pendingSyncStoreIds.length,
                    })}
                  </button>
                )}
            </div>
          </div>
        )}

        {/* TARJETAS DE LOS 4 GRUPOS EN ORDEN DE PRIORIDAD: 1. BLOQUEADOS -> 2. DIFERENCIAS -> 3. DISPUTAS -> 4. LISTOS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* PRIORIDAD 1: BLOQUEADOS (BLOCKED_MISSING_INFO) */}
          <button
            type="button"
            onClick={() => {
              setSelectedOrderSubFilter('NONE')
              setSelectedActionGroup(selectedActionGroup === 'BLOCKED_MISSING_INFO' ? 'ALL' : 'BLOCKED_MISSING_INFO')
              setOrdersPage(1)
              setActiveTab('orders')
            }}
            className={`text-left w-full rounded-2xl border p-3.5 transition ${
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
          </button>

          {/* PRIORIDAD 2: DIFERENCIAS POR INVESTIGAR (VARIANCE_INVESTIGATE) */}
          <button
            type="button"
            onClick={() => {
              setSelectedOrderSubFilter('NONE')
              setSelectedActionGroup(selectedActionGroup === 'VARIANCE_INVESTIGATE' ? 'ALL' : 'VARIANCE_INVESTIGATE')
              setOrdersPage(1)
              setActiveTab('orders')
            }}
            className={`text-left w-full rounded-2xl border p-3.5 transition ${
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
                {fmtMoney(summary?.varianceInvestigateAmount || 0)}
              </span>
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
              {t('deliveryReconciliation.group_2_desc')}
            </p>
          </button>

          {/* PRIORIDAD 3: DISPUTAS / RECUPERACIONES (DISPUTE_RECOVERY) */}
          <button
            type="button"
            onClick={() => {
              setSelectedOrderSubFilter('NONE')
              setSelectedActionGroup(selectedActionGroup === 'DISPUTE_RECOVERY' ? 'ALL' : 'DISPUTE_RECOVERY')
              setOrdersPage(1)
              setActiveTab('orders')
            }}
            className={`text-left w-full rounded-2xl border p-3.5 transition ${
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
                {periodDisputesCount}
              </span>
              <span className="text-xs font-mono font-bold text-rose-700 dark:text-rose-400">
                {fmtMoney(summary?.disputePendingRecoveryAmount ?? summary?.disputeRecoveryAmount ?? 0)}
              </span>
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
              {t('deliveryReconciliation.group_3_desc')}
            </p>
          </button>

          {/* PRIORIDAD 4: LISTOS PARA CONTABILIZAR (CONCILIATED_READY) */}
          <button
            type="button"
            onClick={() => {
              setSelectedOrderSubFilter('NONE')
              setSelectedActionGroup(selectedActionGroup === 'CONCILIATED_READY' ? 'ALL' : 'CONCILIATED_READY')
              setOrdersPage(1)
              setActiveTab('orders')
            }}
            className={`text-left w-full rounded-2xl border p-3.5 transition ${
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
            {(summary?.inTransitNextPayoutCount || 0) > 0 && (
              <div className="mt-1 text-[10px] font-bold text-indigo-700 dark:text-indigo-300">
                {t('deliveryReconciliation.top_box1_in_transit_note', {
                  count: summary.inTransitNextPayoutCount,
                  gross: fmtMoney(summary.inTransitNextPayoutGross || 0),
                })}
              </div>
            )}
            <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
              {t('deliveryReconciliation.group_1_desc')}
            </p>
          </button>
        </div>
      </div>

      {/* 3. RESUMEN POR PLATAFORMA EN EL CONTEXTO SELECCIONADO (AISLADO AL PERIODO, SIN CONTAMINACIÓN DE RECUPERACIONES EXTERNAS) */}
      {summary?.byPlatform && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
          {(['DOORDASH', 'UBER_EATS', 'GRUBHUB'] as DeliveryPlatform[]).map((plat) => {
            const pData = summary.byPlatform[plat] || {}
            const isSelected = selectedPlatform === plat
            const isFilteredOut = selectedPlatform !== 'ALL' && !isSelected
            const isUber = plat === 'UBER_EATS'
            const borderClass =
              plat === 'DOORDASH'
                ? 'border-red-500/30 bg-white dark:bg-slate-900'
                : plat === 'UBER_EATS'
                ? 'border-emerald-500/30 bg-white dark:bg-slate-900'
                : 'border-orange-500/30 bg-white dark:bg-slate-900'

            const hasPayouts = (pData.payoutsCount || 0) > 0
            const prelimOrdersCount = Number(pData.periodPlatformOrdersCount ?? 0)
            const prelimGross = Number(pData.periodPlatformGross ?? pData.settledPlatformGross ?? 0)
            const prelimFees = Number(pData.periodPlatformFees ?? 0)
            const prelimNet = Number(pData.periodPlatformNetPayout ?? 0)
            const hasPrelimActivity = !hasPayouts && (prelimOrdersCount > 0 || Math.abs(prelimGross) > 0.009 || Math.abs(prelimNet) > 0.009)

            const grossCut = hasPayouts ? Number(pData.payoutsGrossTotal || 0) : 0
            const subCut = hasPayouts ? Number(pData.payoutsSubtotalTotal || 0) : 0
            const taxCut = isUber
              ? hasPayouts
                ? Number(pData.payoutsTaxWithheld || 0)
                : 0
              : hasPayouts
              ? Number(pData.payoutsTaxToMerchant || 0)
              : 0

            const feesCut = hasPayouts ? Number(pData.payoutsFeesTotal || 0) : 0
            const errorsCut = hasPayouts ? Number(pData.payoutsErrorTotal || 0) : 0
            const netBankCut = hasPayouts ? Number(pData.payoutsNetTotal || 0) : 0

            const hasPlatformCutActivity = hasPayouts
            const hasCutTaxBreakdown =
              hasPayouts &&
              (pData.payoutsWithTaxBreakdownCount || 0) === (pData.payoutsCount || 0) &&
              (pData.payoutsCount || 0) > 0

            const otherCutAdj = hasPayouts
              ? Number((netBankCut - (grossCut + feesCut + errorsCut)).toFixed(2))
              : 0

            const toastSubPeriod = Number(pData.periodToastNet ?? pData.toastNet ?? 0)
            const toastTaxPeriod = Number(pData.periodToastTax ?? pData.toastTax ?? 0)
            const toastGrossPeriod = Number(
              pData.periodToastExpectedGross ?? pData.toastExpectedGross ?? 0
            )
            const toastOrdersCount = Number(pData.periodToastOrdersCount ?? 0)
            const hasToastActivity = toastOrdersCount > 0 || Math.abs(toastGrossPeriod) > 0.009
            const isOpenPeriodWithoutCut = !hasPayouts && (hasToastActivity || hasPrelimActivity)

            const toastExpectedNet = hasPayouts
              ? Number((toastGrossPeriod + (netBankCut - grossCut)).toFixed(2))
              : 0
            const grossVsToastDiff = Number((grossCut - toastGrossPeriod).toFixed(2))

            const conciliatedCount = pData.conciliatedReadyCount || 0
            const inTransitCardCount = pData.inTransitNextPayoutCount || 0
            const pendingReviewCount = pData.withPayoutPendingReviewCount || 0
            const rowGridClass =
              'grid grid-cols-[minmax(0,1fr)_80px_80px] xl:grid-cols-[minmax(0,1fr)_88px_88px] gap-x-1.5 items-baseline'

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
                className={`flex flex-col h-full cursor-pointer rounded-2xl border p-3.5 transition shadow-sm ${borderClass} ${
                  isSelected
                    ? 'ring-2 ring-indigo-500'
                    : isFilteredOut
                    ? 'opacity-60 hover:opacity-95 border-dashed'
                    : 'hover:border-slate-400'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-2.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {renderPlatformBadge(plat)}
                    {isFilteredOut && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                        {t('deliveryReconciliation.card_filtered_out_hint', {
                          platform: formatPlatformDisplayName(selectedPlatform),
                        })}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap justify-end">
                    {toastOrdersCount > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/70 dark:border-indigo-800/70">
                        {t('deliveryReconciliation.card_toast_orders_badge', {
                          count: toastOrdersCount,
                        })}
                      </span>
                    )}
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      {pData.payoutsCount || 0}{' '}
                      {(pData.payoutsCount || 0) === 1
                        ? t('deliveryReconciliation.weekly_cut_singular')
                        : t('deliveryReconciliation.weekly_cut_plural')}
                    </span>
                  </div>
                </div>

                <div className="flex-1 flex flex-col justify-between space-y-1.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl p-2.5 border border-slate-200/80 dark:border-slate-800 text-[11px]">
                  {/* Encabezado de Columnas: Concepto | Corte Plat. | Toast POS */}
                  <div
                    className={`${rowGridClass} pb-1.5 mb-0.5 border-b border-slate-200/80 dark:border-slate-700/80 text-[10px] uppercase tracking-wider font-extrabold`}
                  >
                    <span className="text-slate-400 truncate">
                      {t('deliveryReconciliation.card_col_concept')}
                    </span>
                    <span className="text-right text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {t('deliveryReconciliation.card_col_payout')}
                    </span>
                    <span className="text-right text-indigo-600 dark:text-indigo-400 whitespace-nowrap">
                      {t('deliveryReconciliation.card_col_toast')}
                    </span>
                  </div>

                  {/* (+) Ventas Brutas */}
                  <div className={rowGridClass}>
                    <span
                      className="text-slate-600 dark:text-slate-300 font-semibold truncate"
                      title={`${t('deliveryReconciliation.card_gross_sales')} ${
                        isUber
                          ? t('deliveryReconciliation.card_without_tax')
                          : t('deliveryReconciliation.card_with_tax')
                      }`}
                    >
                      {t('deliveryReconciliation.card_gross_short')}{' '}
                      {isUber
                        ? t('deliveryReconciliation.card_without_tax')
                        : t('deliveryReconciliation.card_with_tax')}
                      :
                    </span>
                    <span className="font-mono tabular-nums font-bold text-slate-900 dark:text-white text-right whitespace-nowrap">
                      {isOpenPeriodWithoutCut ? '—' : fmtMoney(grossCut)}
                    </span>
                    <span className="font-mono tabular-nums font-bold text-indigo-700 dark:text-indigo-300 text-right whitespace-nowrap">
                      {fmtMoney(toastGrossPeriod)}
                    </span>
                  </div>

                  {/* Desglose Subtotal + Sales Tax */}
                  {(hasPlatformCutActivity || hasToastActivity) && (
                    <div className="space-y-0.5 pb-1">
                      <div className={`${rowGridClass} text-[10.5px]`}>
                        <span className="pl-2 text-slate-400 dark:text-slate-500 truncate">
                          {t('deliveryReconciliation.card_sub_net_no_tax')}
                        </span>
                        <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400 text-right whitespace-nowrap">
                          {hasCutTaxBreakdown ? fmtMoney(subCut) : '—'}
                        </span>
                        <span className="font-mono tabular-nums text-indigo-600/80 dark:text-indigo-400/80 text-right whitespace-nowrap">
                          {fmtMoney(toastSubPeriod)}
                        </span>
                      </div>
                      <div className={`${rowGridClass} text-[10.5px]`}>
                        <span className="pl-2 text-slate-400 dark:text-slate-500 truncate">
                          {isUber
                            ? t('deliveryReconciliation.card_sub_uber_tax_info')
                            : t('deliveryReconciliation.card_sub_sales_tax_teg')}
                        </span>
                        <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400 text-right whitespace-nowrap">
                          {hasCutTaxBreakdown ? fmtMoney(taxCut) : '—'}
                        </span>
                        <span className="font-mono tabular-nums text-indigo-600/80 dark:text-indigo-400/80 text-right whitespace-nowrap">
                          {fmtMoney(toastTaxPeriod)}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* (-) Comisiones y Tarifas */}
                  <div className={rowGridClass}>
                    <span
                      className="text-slate-500 dark:text-slate-400 font-semibold truncate"
                      title={t('deliveryReconciliation.card_platform_fees')}
                    >
                      {t('deliveryReconciliation.card_fees_short')}
                    </span>
                    <span className="font-mono tabular-nums font-bold text-amber-600 dark:text-amber-400 text-right whitespace-nowrap">
                      {isOpenPeriodWithoutCut ? '—' : fmtMoney(feesCut)}
                    </span>
                    <span className="font-mono tabular-nums font-bold text-amber-600/90 dark:text-amber-400/90 text-right whitespace-nowrap">
                      {hasPlatformCutActivity || !hasToastActivity ? fmtMoney(feesCut) : '—'}
                    </span>
                  </div>

                  {/* (-) Cargos por Error / Reembolsos */}
                  {Math.abs(errorsCut) > 0.01 && (
                    <div className={rowGridClass}>
                      <span
                        className="text-slate-500 dark:text-slate-400 font-semibold truncate"
                        title={
                          errorsCut > 0
                            ? t('deliveryReconciliation.card_reimbursements_won')
                            : t('deliveryReconciliation.card_error_charges')
                        }
                      >
                        {errorsCut > 0
                          ? t('deliveryReconciliation.card_reimbursements_won')
                          : t('deliveryReconciliation.card_error_charges')}
                      </span>
                      <span
                        className={`font-mono tabular-nums font-bold text-right whitespace-nowrap ${
                          errorsCut > 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {errorsCut > 0 ? `+${fmtMoney(errorsCut)}` : fmtMoney(errorsCut)}
                      </span>
                      <span
                        className={`font-mono tabular-nums font-bold text-right whitespace-nowrap ${
                          errorsCut > 0
                            ? 'text-emerald-600/90 dark:text-emerald-400/90'
                            : 'text-rose-600/90 dark:text-rose-400/90'
                        }`}
                      >
                        {errorsCut > 0 ? `+${fmtMoney(errorsCut)}` : fmtMoney(errorsCut)}
                      </span>
                    </div>
                  )}

                  {/* (+/-) Propinas / Ajustes (ej. Grubhub tips o ajuste MFT Uber) */}
                  {Math.abs(otherCutAdj) > 0.01 && (
                    <div className={rowGridClass}>
                      <span className="text-slate-500 dark:text-slate-400 font-semibold truncate">
                        {t('deliveryReconciliation.card_tips_or_tax_adj')}
                      </span>
                      <span
                        className={`font-mono tabular-nums font-bold text-right whitespace-nowrap ${
                          otherCutAdj > 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {otherCutAdj > 0 ? `+${fmtMoney(otherCutAdj)}` : fmtMoney(otherCutAdj)}
                      </span>
                      <span
                        className={`font-mono tabular-nums font-bold text-right whitespace-nowrap ${
                          otherCutAdj > 0
                            ? 'text-emerald-600/90 dark:text-emerald-400/90'
                            : 'text-rose-600/90 dark:text-rose-400/90'
                        }`}
                      >
                        {otherCutAdj > 0 ? `+${fmtMoney(otherCutAdj)}` : fmtMoney(otherCutAdj)}
                      </span>
                    </div>
                  )}

                  {/* (=) Depósito Neto en Banco vs Calculado desde Toast */}
                  <div
                    className={`${rowGridClass} pt-1.5 border-t border-slate-200 dark:border-slate-700 text-xs`}
                  >
                    <span
                      className="font-extrabold text-emerald-700 dark:text-emerald-400 truncate"
                      title={t('deliveryReconciliation.card_net_bank_deposit')}
                    >
                      {t('deliveryReconciliation.card_net_deposit_short')}
                    </span>
                    <span className="font-mono tabular-nums font-extrabold text-emerald-600 dark:text-emerald-400 text-right whitespace-nowrap">
                      {isOpenPeriodWithoutCut ? '—' : fmtMoney(netBankCut)}
                    </span>
                    <span className="font-mono tabular-nums font-extrabold text-indigo-700 dark:text-indigo-300 text-right whitespace-nowrap">
                      {hasPlatformCutActivity || !hasToastActivity
                        ? fmtMoney(toastExpectedNet)
                        : '—'}
                    </span>
                  </div>

                  {/* Δ Diferencia (Corte − Toast POS) + Puente Contable Explicativo */}
                  {(hasPayouts || hasToastActivity || hasPrelimActivity) && (() => {
                    const vBridge = pData.varianceBreakdown
                    const hasBridgeContent = Boolean(
                      vBridge &&
                        vBridge.mode !== 'NO_ACTIVITY' &&
                        (vBridge.mode === 'OPEN_PERIOD_NO_PAYOUT' ||
                          Math.abs(grossVsToastDiff) > 0.01 ||
                          (vBridge.items?.length || 0) > 0)
                    )
                    const isVarianceBridgeOpen =
                      varianceBridgeOpenMap[plat] !== undefined
                        ? Boolean(varianceBridgeOpenMap[plat])
                        : Boolean(isSelected && hasBridgeContent && !isOpenPeriodWithoutCut)

                    const fmtSignedMoney = (val: number) =>
                      val > 0.005 ? `+${fmtMoney(val)}` : fmtMoney(val)

                    const formatRefsLabel = (refs?: string[]) => {
                      if (!refs || refs.length === 0) return '#—'
                      const visible = refs.slice(0, 3).map((r) => `#${shortenRef(r, 14)}`)
                      const remaining = refs.length - 3
                      const extra =
                        remaining > 0
                          ? ` ${t(
                              remaining === 1
                                ? 'deliveryReconciliation.var_more_refs_singular'
                                : 'deliveryReconciliation.var_more_refs_plural',
                              { count: remaining }
                            )}`
                          : ''
                      return `${visible.join(', ')}${extra}`
                    }

                    const formatDatesLabel = (dates?: string[]) =>
                      dates && dates.length > 0
                        ? dates.slice(0, 4).map((d) => fmtDateMDY(d)).join(', ')
                        : '—'

                    return (
                      <div className="pt-1 border-t border-dashed border-slate-200/80 dark:border-slate-700/70 space-y-2">
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-slate-600 dark:text-slate-300">
                              {t('deliveryReconciliation.card_variance_vs_toast')}
                            </span>
                            {hasBridgeContent && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setVarianceBridgeOpenMap((prev) => ({
                                    ...prev,
                                    [plat]: !isVarianceBridgeOpen,
                                  }))
                                }}
                                className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-500/25 transition"
                              >
                                {isVarianceBridgeOpen
                                  ? t('deliveryReconciliation.var_btn_hide')
                                  : t('deliveryReconciliation.var_btn_show')}
                              </button>
                            )}
                          </div>
                          {!hasPayouts ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200/80 dark:bg-slate-700/80 text-slate-700 dark:text-slate-200 whitespace-nowrap">
                              {t('deliveryReconciliation.no_payout_issued_short')}
                            </span>
                          ) : (
                            <span
                              className={`font-mono tabular-nums font-extrabold whitespace-nowrap ${
                                Math.abs(grossVsToastDiff) <= 0.01
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : grossVsToastDiff < 0
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : 'text-amber-600 dark:text-amber-400'
                              }`}
                            >
                              {Math.abs(grossVsToastDiff) <= 0.01
                                ? `${fmtMoney(0)} ✓`
                                : fmtSignedMoney(grossVsToastDiff)}
                            </span>
                          )}
                        </div>

                        {hasBridgeContent && isVarianceBridgeOpen && vBridge && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="cursor-default rounded-xl bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-700/80 p-2.5 space-y-2 text-[11px] shadow-inner"
                          >
                            <div className="font-extrabold text-[10px] uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                              {t('deliveryReconciliation.var_panel_title')}
                            </div>

                            {/* Banner de Diagnóstico Contable */}
                            {vBridge.mode === 'OPEN_PERIOD_NO_PAYOUT' ? (
                              <div className="rounded-lg p-2 bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 space-y-1">
                                <div className="font-extrabold text-slate-800 dark:text-slate-100">
                                  {t('deliveryReconciliation.var_diag_open_period_title')}
                                </div>
                                <p className="text-slate-600 dark:text-slate-300 leading-snug">
                                  {t('deliveryReconciliation.var_diag_open_period_desc', {
                                    toastCount: toastOrdersCount,
                                    toastGross: fmtMoney(toastGrossPeriod),
                                  })}
                                </p>
                              </div>
                            ) : vBridge.mode === 'SUMMARY_ONLY_PENDING_ORDER_SYNC' ? (
                              <div className="rounded-lg p-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 space-y-1">
                                <div className="font-extrabold text-amber-800 dark:text-amber-300">
                                  {t('deliveryReconciliation.var_diag_pending_sync_title')}
                                </div>
                                <p className="text-amber-700 dark:text-amber-200/90 leading-snug">
                                  {t('deliveryReconciliation.var_diag_pending_sync_desc')
                                    .replace('{refs}', formatRefsLabel(vBridge.payoutRefs))
                                    .replace('{cutGross}', fmtMoney(grossCut))
                                    .replace('{toastCount}', String(toastOrdersCount))
                                    .replace('{toastGross}', fmtMoney(toastGrossPeriod))
                                    .replace('{diff}', fmtSignedMoney(grossVsToastDiff))}
                                </p>
                              </div>
                            ) : vBridge.diagnosticStatus === 'OK_TIMING_OR_FAVORABLE' ? (
                              <div className="rounded-lg p-2 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800/60 space-y-1">
                                <div className="font-extrabold text-emerald-800 dark:text-emerald-300">
                                  {t('deliveryReconciliation.var_diag_ok_title')}
                                </div>
                                <p className="text-emerald-700 dark:text-emerald-200/90 leading-snug">
                                  {t('deliveryReconciliation.var_diag_ok_desc')}
                                </p>
                              </div>
                            ) : (
                              <div className="rounded-lg p-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 space-y-1">
                                <div className="font-extrabold text-amber-800 dark:text-amber-300">
                                  {t('deliveryReconciliation.var_diag_review_title')}
                                </div>
                                <p className="text-amber-700 dark:text-amber-200/90 leading-snug">
                                  {t('deliveryReconciliation.var_diag_review_desc')}
                                </p>
                              </div>
                            )}

                            {/* Ecuación Paso a Paso cuando hay desglose de órdenes */}
                            {vBridge.mode === 'FULL_ORDER_BRIDGE' && (
                              <div className="space-y-1.5 pt-0.5">
                                <div className="flex items-baseline justify-between gap-2 pb-1 border-b border-slate-100 dark:border-slate-800">
                                  <span className="font-bold text-indigo-700 dark:text-indigo-300">
                                    {t('deliveryReconciliation.var_bridge_start_toast', {
                                      count: toastOrdersCount,
                                    })}
                                  </span>
                                  <span className="font-mono tabular-nums font-extrabold text-indigo-700 dark:text-indigo-300 whitespace-nowrap">
                                    {fmtMoney(vBridge.toastBaseGross)}
                                  </span>
                                </div>

                                {vBridge.matchedExactCount > 0 && (
                                  <div className="text-[10.5px] font-semibold text-emerald-700 dark:text-emerald-400 px-1">
                                    {t('deliveryReconciliation.var_bridge_matched_note', {
                                      count: vBridge.matchedExactCount,
                                      amount: fmtMoney(vBridge.matchedExactGross),
                                    })}
                                  </div>
                                )}

                                {vBridge.items.map((item: any) => {
                                  const bucketKey = `${plat}:${item.code}`
                                  const isOrdersExpanded = Boolean(
                                    expandedVarianceBucketOrders[bucketKey]
                                  )
                                  const refsLabel = formatRefsLabel(
                                    item.refs?.length ? item.refs : vBridge.payoutRefs
                                  )
                                  const datesLabel = formatDatesLabel(item.dates)
                                  const rawTitle = t(
                                    `deliveryReconciliation.var_item_${item.code}_title`
                                  )
                                    .replace(/\{count\}/g, String(item.count))
                                    .replace(/\{refs\}/g, refsLabel)
                                    .replace(/\{dates\}/g, datesLabel)
                                  const rawDesc = t(
                                    `deliveryReconciliation.var_item_${item.code}_desc`
                                  )
                                    .replace(/\{count\}/g, String(item.count))
                                    .replace(/\{refs\}/g, refsLabel)
                                    .replace(/\{dates\}/g, datesLabel)

                                  return (
                                    <div
                                      key={item.code}
                                      className="rounded-lg border border-slate-200/90 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 p-2 space-y-1"
                                    >
                                      <div className="flex items-start justify-between gap-2">
                                        <span className="font-bold text-slate-800 dark:text-slate-100 leading-snug">
                                          {rawTitle}
                                        </span>
                                        <span
                                          className={`font-mono tabular-nums font-extrabold whitespace-nowrap ${
                                            item.grossDelta > 0
                                              ? 'text-emerald-600 dark:text-emerald-400'
                                              : 'text-rose-600 dark:text-rose-400'
                                          }`}
                                        >
                                          {fmtSignedMoney(item.grossDelta)}
                                        </span>
                                      </div>

                                      <div className="flex items-center justify-between gap-2 flex-wrap text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                                        <span>
                                          {isUber
                                            ? `Sub: ${fmtSignedMoney(item.subtotalDelta)}`
                                            : t('deliveryReconciliation.var_sub_tax_chip', {
                                                sub: fmtSignedMoney(item.subtotalDelta),
                                                tax: fmtSignedMoney(item.taxDelta),
                                              })}
                                        </span>
                                        {item.orders && item.orders.length > 0 && (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              setExpandedVarianceBucketOrders((prev) => ({
                                                ...prev,
                                                [bucketKey]: !isOrdersExpanded,
                                              }))
                                            }}
                                            className="font-sans px-1.5 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-indigo-700 dark:text-indigo-300 font-bold hover:bg-indigo-50 dark:hover:bg-slate-800 transition"
                                          >
                                            {isOrdersExpanded
                                              ? t('deliveryReconciliation.var_hide_orders_btn')
                                              : t('deliveryReconciliation.var_view_orders_btn', {
                                                  count:
                                                    item.count > item.orders.length
                                                      ? `${item.orders.length}/${item.count}`
                                                      : item.orders.length,
                                                })}
                                          </button>
                                        )}
                                      </div>

                                      <p className="text-[10.5px] text-slate-600 dark:text-slate-300 leading-snug">
                                        {rawDesc}
                                      </p>

                                      {isOrdersExpanded && item.orders && item.orders.length > 0 && (
                                        <div className="mt-1.5 pt-1.5 border-t border-slate-200 dark:border-slate-700 max-h-48 overflow-y-auto space-y-1">
                                          {item.orders.map((ordSample: any) => {
                                            const matchedOrd = orders.find(
                                              (o) => o.id === ordSample.id
                                            )
                                            return (
                                              <div
                                                key={ordSample.id}
                                                onClick={() => {
                                                  if (matchedOrd) handleOpenOrderModal(matchedOrd)
                                                }}
                                                className={`flex items-center justify-between gap-2 text-[10px] py-0.5 px-1 rounded ${
                                                  matchedOrd
                                                    ? 'cursor-pointer hover:bg-indigo-50 dark:hover:bg-slate-800'
                                                    : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                                                }`}
                                              >
                                                <div className="min-w-0 truncate text-slate-700 dark:text-slate-300">
                                                  <span className="font-mono font-bold">
                                                    #{ordSample.platform_order_id}
                                                  </span>
                                                  {ordSample.toast_display_number && (
                                                    <span className="text-indigo-600 dark:text-indigo-400 font-semibold">
                                                      {' '}
                                                      • Toast #{ordSample.toast_display_number}
                                                    </span>
                                                  )}
                                                  {ordSample.placed_pt ? (
                                                    <span className="text-slate-400">
                                                      {' '}
                                                      • {ordSample.placed_pt}
                                                    </span>
                                                  ) : ordSample.business_date ? (
                                                    <span className="text-slate-400">
                                                      {' '}
                                                      • {fmtDateMDY(ordSample.business_date)}
                                                    </span>
                                                  ) : null}
                                                  {ordSample.payout_reference_id && (
                                                    <span className="text-slate-500 font-mono">
                                                      {' '}
                                                      • #{shortenRef(ordSample.payout_reference_id, 14)}
                                                    </span>
                                                  )}
                                                </div>
                                                <span
                                                  className={`font-mono tabular-nums font-bold whitespace-nowrap ${
                                                    ordSample.delta > 0
                                                      ? 'text-emerald-600 dark:text-emerald-400'
                                                      : 'text-rose-600 dark:text-rose-400'
                                                  }`}
                                                >
                                                  {fmtSignedMoney(ordSample.delta)}
                                                </span>
                                              </div>
                                            )
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}

                                <div className="flex items-baseline justify-between gap-2 pt-1.5 border-t border-slate-200 dark:border-slate-700">
                                  <span className="font-extrabold text-slate-900 dark:text-white">
                                    {t('deliveryReconciliation.var_bridge_end_payout')}
                                  </span>
                                  <span className="font-mono tabular-nums font-extrabold text-slate-900 dark:text-white whitespace-nowrap">
                                    {fmtMoney(vBridge.payoutTargetGross)}
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })()}
                  {hasPrelimActivity && (
                    <div className="mt-1.5 rounded-lg bg-indigo-50/90 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-800/60 px-2 py-1 text-[10px] font-semibold text-indigo-800 dark:text-indigo-200">
                      {t('deliveryReconciliation.preliminary_open_orders_note', {
                        count: prelimOrdersCount,
                        gross: fmtMoney(prelimGross),
                        fees: fmtMoney(prelimFees),
                        net: fmtMoney(prelimNet),
                      })}
                    </div>
                  )}
                </div>

                <div className="mt-auto pt-2.5 flex flex-wrap items-center justify-between gap-1 text-[11px]">
                  <div className="flex flex-wrap items-center gap-1">
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
                    {t('deliveryReconciliation.card_reconciled_chip', { count: conciliatedCount })}
                  </button>
                  {inTransitCardCount > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedPlatform(plat)
                        setActivePayoutRef('')
                        setSelectedOrderSubFilter('NONE')
                        setSelectedActionGroup('BLOCKED_MISSING_INFO')
                        setOrdersPage(1)
                        setActiveTab('orders')
                      }}
                      className="px-2 py-0.5 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-500/25 font-bold transition"
                    >
                      {t('deliveryReconciliation.in_transit_next_payout_pill', { count: inTransitCardCount })}
                    </button>
                  )}
                  </div>
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
                          : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400'
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

      {/* 4. PESTAÑAS DE NAVEGACIÓN COMPACTAS SIN TRUNCAMIENTO EN ESCRITORIO */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-1.5 shadow-sm">
        <div role="tablist" aria-label={t('deliveryReconciliation.title')} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-1.5">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'orders'}
            onClick={() => setActiveTab('orders')}
            className={`flex items-center justify-center gap-1.5 px-2.5 py-2.5 rounded-xl text-xs font-extrabold transition ${
              activeTab === 'orders'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Receipt className="w-4 h-4 shrink-0" />
            <span className="truncate">{t('deliveryReconciliation.nav_step_attention')}</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] font-extrabold shrink-0 ${
                activeTab === 'orders'
                  ? 'bg-white/20 text-white'
                  : 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400'
              }`}
            >
              {periodOrders.length}
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'disputes'}
            onClick={() => setActiveTab('disputes')}
            className={`flex items-center justify-center gap-1.5 px-2.5 py-2.5 rounded-xl text-xs font-extrabold transition ${
              activeTab === 'disputes'
                ? 'bg-rose-600 text-white shadow-sm'
                : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="truncate">{t('deliveryReconciliation.nav_step_disputes')}</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] font-extrabold shrink-0 ${
                activeTab === 'disputes'
                  ? 'bg-white/20 text-white'
                  : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
              }`}
            >
              {openDisputeOrders.length > 0 ? openDisputeOrders.length : group3Disputes.length}
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'mappings'}
            onClick={() => setActiveTab('mappings')}
            className={`flex items-center justify-center gap-1.5 px-2.5 py-2.5 rounded-xl text-xs font-extrabold transition ${
              activeTab === 'mappings'
                ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900 shadow-sm'
                : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Store className="w-4 h-4 shrink-0" />
            <span className="truncate">{t('deliveryReconciliation.nav_step_coverage')}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'qb_journals' || activeTab === 'payouts'}
            onClick={() => {
              setCutsSubView('qb')
              setActiveTab('qb_journals')
            }}
            className={`flex items-center justify-center gap-1.5 px-2.5 py-2.5 rounded-xl text-xs font-extrabold transition ${
              activeTab === 'qb_journals' || activeTab === 'payouts'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Landmark className="w-4 h-4 shrink-0" />
            <span className="truncate">{t('deliveryReconciliation.nav_step_qbo_final')}</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] font-extrabold shrink-0 ${
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
                📋 {t('deliveryReconciliation.quick_filter_all')} ({periodOrders.length})
              </button>
              {(withPayoutPendingReviewOrders.length > 0 || selectedOrderSubFilter === 'WITH_PAYOUT_PENDING_REVIEW') && (
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
                  setSelectedActionGroup(
                    selectedActionGroup === 'BLOCKED_MISSING_INFO' && selectedOrderSubFilter === 'NONE' ? 'ALL' : 'BLOCKED_MISSING_INFO'
                  )
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
                  setSelectedActionGroup(
                    selectedActionGroup === 'VARIANCE_INVESTIGATE' && selectedOrderSubFilter === 'NONE' ? 'ALL' : 'VARIANCE_INVESTIGATE'
                  )
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
                  setSelectedActionGroup(
                    selectedActionGroup === 'DISPUTE_RECOVERY' && selectedOrderSubFilter === 'NONE' ? 'ALL' : 'DISPUTE_RECOVERY'
                  )
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
                  setSelectedActionGroup(
                    selectedActionGroup === 'CONCILIATED_READY' && selectedOrderSubFilter === 'NONE' ? 'ALL' : 'CONCILIATED_READY'
                  )
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border ${
                  selectedActionGroup === 'CONCILIATED_READY' && selectedOrderSubFilter === 'NONE'
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
                }`}
              >
                ✅ {t('deliveryReconciliation.group_1_title')} ({group1Conciliated.length})
              </button>
              {(underpaidOrDisputeOrders.length > 0 || selectedOrderSubFilter === 'UNDERPAID_OR_DISPUTE') && (
                <button
                  onClick={() => {
                    setSelectedActionGroup('ALL')
                    setSelectedOrderSubFilter(
                      selectedOrderSubFilter === 'UNDERPAID_OR_DISPUTE' ? 'NONE' : 'UNDERPAID_OR_DISPUTE'
                    )
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border ${
                    selectedOrderSubFilter === 'UNDERPAID_OR_DISPUTE'
                      ? 'bg-amber-700 text-white border-amber-700'
                      : 'bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-400 border-amber-500/30'
                  }`}
                >
                  {t('deliveryReconciliation.filter_underpaid_or_dispute', { count: underpaidOrDisputeOrders.length })}
                </button>
              )}
              {(toastOnlyOrders.length > 0 || selectedOrderSubFilter === 'TOAST_ONLY') && (
                <button
                  onClick={() => {
                    setSelectedActionGroup('ALL')
                    setSelectedOrderSubFilter(selectedOrderSubFilter === 'TOAST_ONLY' ? 'NONE' : 'TOAST_ONLY')
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border ${
                    selectedOrderSubFilter === 'TOAST_ONLY'
                      ? 'bg-slate-700 text-white border-slate-700'
                      : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700'
                  }`}
                >
                  {t('deliveryReconciliation.filter_toast_only_all', { count: toastOnlyOrders.length })}
                </button>
              )}
              {(toastPendingSyncOrders.length > 0 || selectedOrderSubFilter === 'TOAST_PENDING_SYNC') && (
                <button
                  onClick={() => {
                    setSelectedActionGroup('ALL')
                    setSelectedOrderSubFilter(
                      selectedOrderSubFilter === 'TOAST_PENDING_SYNC' ? 'NONE' : 'TOAST_PENDING_SYNC'
                    )
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border ${
                    selectedOrderSubFilter === 'TOAST_PENDING_SYNC'
                      ? 'bg-sky-600 text-white border-sky-600'
                      : 'bg-white dark:bg-slate-900 text-sky-700 dark:text-sky-400 border-sky-500/30'
                  }`}
                >
                  {t('deliveryReconciliation.filter_toast_pending_sync', { count: toastPendingSyncOrders.length })}
                </button>
              )}
              {(toastUnpaidSyncedOrders.length > 0 || selectedOrderSubFilter === 'TOAST_UNPAID_SYNCED') && (
                <button
                  onClick={() => {
                    setSelectedActionGroup('ALL')
                    setSelectedOrderSubFilter(
                      selectedOrderSubFilter === 'TOAST_UNPAID_SYNCED' ? 'NONE' : 'TOAST_UNPAID_SYNCED'
                    )
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border ${
                    selectedOrderSubFilter === 'TOAST_UNPAID_SYNCED'
                      ? 'bg-rose-700 text-white border-rose-700'
                      : 'bg-white dark:bg-slate-900 text-rose-700 dark:text-rose-400 border-rose-500/30'
                  }`}
                >
                  {t('deliveryReconciliation.filter_toast_unpaid_synced', {
                    count: toastUnpaidSyncedOrders.length,
                  })}
                </button>
              )}
              {(platformMissingToastOrders.length > 0 || selectedOrderSubFilter === 'PLATFORM_MISSING_TOAST') && (
                <button
                  onClick={() => {
                    setSelectedActionGroup('ALL')
                    setSelectedOrderSubFilter(
                      selectedOrderSubFilter === 'PLATFORM_MISSING_TOAST' ? 'NONE' : 'PLATFORM_MISSING_TOAST'
                    )
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border ${
                    selectedOrderSubFilter === 'PLATFORM_MISSING_TOAST'
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-400 border-indigo-500/30'
                  }`}
                >
                  {t('deliveryReconciliation.filter_platform_missing_toast', {
                    count: platformMissingToastOrders.length,
                  })}
                </button>
              )}
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
                  id="conciliar-batch-notes"
                  name="batch_notes"
                  type="text"
                  aria-label={t('deliveryReconciliation.batch_notes_placeholder')}
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
            <div className="p-12 text-center text-slate-500">{t('deliveryReconciliation.loading_records')}</div>
          ) : displayedOrders.length === 0 ? (
            <div className="p-12 text-center text-slate-500">{t('deliveryReconciliation.empty_orders')}</div>
          ) : (
            <div className="overflow-x-auto">
              {/* BARRA DE PAGINACIÓN SUPERIOR PARA ALTO VOLUMEN DE ÓRDENES (9,400+ ÓRDENES SIN LAG EN DOM) */}
              <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="text-slate-600 dark:text-slate-300 font-semibold font-mono">
                  {t('deliveryReconciliation.pagination_showing', {
                    from: (safeOrdersPage - 1) * ordersPageSize + 1,
                    to: Math.min(safeOrdersPage * ordersPageSize, displayedOrders.length),
                    total: displayedOrders.length,
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor="orders-page-size" className="flex items-center gap-1.5 text-slate-500 font-semibold">
                    <span>{t('deliveryReconciliation.pagination_rows_per_page')}</span>
                    <select
                      id="orders-page-size"
                      disabled={syncing}
                      name="orders-page-size"
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
                      onClick={() => setOrdersPage(Math.max(1, safeOrdersPage - 1))}
                      disabled={safeOrdersPage <= 1}
                      className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-40 font-bold hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                      {t('deliveryReconciliation.pagination_prev')}
                    </button>
                    <span className="px-2.5 py-1 font-mono font-extrabold text-slate-800 dark:text-slate-200">
                      {t('deliveryReconciliation.pagination_page_of', { page: safeOrdersPage, total: totalOrderPages })}
                    </span>
                    <button
                      onClick={() => setOrdersPage(Math.min(totalOrderPages, safeOrdersPage + 1))}
                      disabled={safeOrdersPage >= totalOrderPages}
                      className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-40 font-bold hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                      {t('deliveryReconciliation.pagination_next')}
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
                        aria-label={t('deliveryReconciliation.batch_select_all')}
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
                            title={!isSelectable ? t('deliveryReconciliation.batch_checkbox_hint') : undefined}
                            aria-label={t('deliveryReconciliation.batch_checkbox_hint')}
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
                              <div
                                className="truncate"
                                title={`Toast #${ord.toast_display_number}${ord.toast_tab_name ? ` • ${ord.toast_tab_name}` : ''}`}
                              >
                                Toast #{ord.toast_display_number}
                                {ord.toast_tab_name ? ` • ${ord.toast_tab_name}` : ''}
                              </div>
                              {(ord.raw_payload as any)?.toast_voided && (
                                <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-[9px] font-extrabold">
                                  {t('deliveryReconciliation.voided_in_pos_badge')}
                                </span>
                              )}
                            </div>
                          )}
                          {ord.payout_reference_id && (
                            <div className="text-[10px] font-mono text-indigo-600 dark:text-indigo-400 truncate" title={ord.payout_reference_id}>
                              {t('deliveryReconciliation.cut_prefix')}: #{shortenRef(ord.payout_reference_id, 18)}
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
                                {t('deliveryReconciliation.void_orig_prefix')}{' '}
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
                          {(ord.raw_payload?.reimbursement_payout_ref || (ord.recovery_credits_evaluated || []).length > 0) &&
                            (() => {
                              // Insignia basada en la evaluación del servidor: solo créditos localizados en el settlement cuentan como recuperados
                              const isRecoveredFull = ord.status_code === 'DISPUTE_RECOVERED'
                              const isPartialRec = ord.status_code === 'DISPUTE_PARTIALLY_RECOVERED'
                              const verifiedCredits = (ord.recovery_credits_evaluated || []).filter((c) => c.verified)
                              const refsLabel =
                                verifiedCredits.length > 0
                                  ? verifiedCredits.map((c) => `#${c.payout_reference_id}`).join(', ')
                                  : `#${ord.raw_payload?.reimbursement_payout_ref || ''}`
                              const recAmt = Number(ord.recovered_amount || 0)
                              const dedAmt = Number(ord.original_deduction_abs || Math.abs(Number(ord.error_charge || 0)))
                              const pendingAmt = Number(ord.unrecovered_amount || 0)
                              const badgeClass = isRecoveredFull
                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                                : isPartialRec
                                ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30'
                                : 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30'
                              return (
                                <div className="mt-1">
                                  <span
                                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-[9px] leading-tight font-extrabold border ${badgeClass}`}
                                    title={(ord.recovery_credits_evaluated || [])
                                      .map(
                                        (c) =>
                                          `${c.verified ? '✅' : '⏳'} #${c.payout_reference_id} ${fmtMoney(c.amount)}${c.deposit_date ? ` (${c.deposit_date})` : ''}${c.verification_issue ? ` — ${translateVerificationIssue(c.verification_issue)}` : ''}`
                                      )
                                      .join('\n')}
                                  >
                                    {isRecoveredFull
                                      ? `✅ ${t('deliveryReconciliation.reimbursed_in_payout_badge', {
                                          ref: refsLabel.replace(/^#/, ''),
                                          amount: fmtMoney(recAmt),
                                        })}`
                                      : isPartialRec
                                      ? `⚠️ ${t('deliveryReconciliation.partial_recovery_badge', {
                                          refs: refsLabel,
                                          recovered: fmtMoney(recAmt),
                                          original: fmtMoney(dedAmt),
                                          pending: fmtMoney(pendingAmt),
                                        })}`
                                      : `⏳ ${t('deliveryReconciliation.recovery_pending_verification_badge')}`}
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
                          {(() => {
                            const sug =
                              ord.raw_payload?.suggested_toast_candidate ||
                              (Array.isArray(ord.raw_payload?.ambiguous_toast_candidates) &&
                              ord.raw_payload.ambiguous_toast_candidates.length === 1
                                ? ord.raw_payload.ambiguous_toast_candidates[0]
                                : null)
                            const sugGuid = sug?.toastOrderGuid || sug?.toastGuid
                            if (!sug || !sugGuid || ord.toast_order_guid) return null
                            const sugAmt =
                              Number(sug.netSales || 0) +
                              (ord.platform === 'UBER_EATS' ? 0 : Number(sug.taxAmount || 0))
                            return (
                              <button
                                type="button"
                                onClick={() => handleApproveReviewOrder(ord, sugGuid, '')}
                                disabled={savingDispute}
                                className="mt-1 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[11px] font-extrabold shadow-sm transition"
                              >
                                {t('deliveryReconciliation.confirm_suggested_toast_btn', {
                                  num: sug.toastDisplayNumber || sug.displayNumber || 'POS',
                                  amount: fmtMoney(sugAmt),
                                })}
                              </button>
                            )
                          })()}
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
                <div className="text-slate-600 dark:text-slate-300 font-semibold font-mono">
                  {t('deliveryReconciliation.pagination_showing', {
                    from: (safeOrdersPage - 1) * ordersPageSize + 1,
                    to: Math.min(safeOrdersPage * ordersPageSize, displayedOrders.length),
                    total: displayedOrders.length,
                  })}
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
                    onClick={() => setOrdersPage(Math.max(1, safeOrdersPage - 1))}
                    disabled={safeOrdersPage <= 1}
                    className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-40 font-bold hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    {t('deliveryReconciliation.pagination_prev')}
                  </button>
                  <span className="px-2.5 py-1 font-mono font-extrabold text-slate-800 dark:text-slate-200">
                    {t('deliveryReconciliation.pagination_page_of', { page: safeOrdersPage, total: totalOrderPages })}
                  </span>
                  <button
                    onClick={() => setOrdersPage(Math.min(totalOrderPages, safeOrdersPage + 1))}
                    disabled={safeOrdersPage >= totalOrderPages}
                    className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-40 font-bold hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    {t('deliveryReconciliation.pagination_next')}
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
                {t('deliveryReconciliation.qb_subview_accounting')}
              </button>
              <button
                onClick={() => {
                  setCutsSubView('bank')
                  setActiveTab('payouts')
                }}
                className="px-3 py-1 rounded-lg bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-sm transition"
              >
                {t('deliveryReconciliation.qb_subview_bank')}
              </button>
            </div>
          </div>
          {loading ? (
            <div className="p-12 text-center text-slate-500">{t('deliveryReconciliation.loading_records')}</div>
          ) : payouts.length === 0 ? (
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
                    <th className="p-3 text-right">{t('deliveryReconciliation.payout_toast_expected')}</th>
                    <th className="p-3 text-right">{t('deliveryReconciliation.payout_gross')}</th>
                    <th className="p-3 text-right">{t('deliveryReconciliation.payout_variance')}</th>
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
                    const recognizedGross =
                      p.accounting_gross_receivable ?? Number(p.platform_gross_receivable || 0)
                    const feesTotal =
                      p.accounting_total_fees ??
                      Number(p.commission_fees || 0) +
                        Number(p.delivery_fees || 0) +
                        Number(p.processing_fees || 0) +
                        Number(p.marketing_fees || 0)
                    const errTotal =
                      p.accounting_err_adj ??
                      Number(p.error_charges || 0) + Number(p.adjustments_amount || 0)
                    const toastExp = Number(p.toast_expected_gross || 0)
                    const toastVar =
                      p.accounting_gross_variance ??
                      p.gross_variance ??
                      Number((recognizedGross - toastExp).toFixed(2))
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
                          setSearchInput('')
                          setSearchQuery('')
                          setSelectedActionGroup('ALL')
                          setSelectedOrderSubFilter('NONE')
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
                              {t('deliveryReconciliation.incomplete_coverage_short')}
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-right font-mono font-semibold text-indigo-700 dark:text-indigo-300">
                          {fmtMoney(toastExp)}
                        </td>
                        <td className="p-3 text-right font-mono font-bold">
                          {fmtMoney(recognizedGross)}
                        </td>
                        <td
                          className={`p-3 text-right font-mono font-extrabold ${
                            Math.abs(toastVar) <= 0.05
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {fmtMoney(toastVar)}
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
                        <td
                          className={`p-3 text-right font-mono font-extrabold ${
                            Number(p.net_payout_amount || 0) < 0
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-emerald-600 dark:text-emerald-400'
                          }`}
                        >
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
                              setSearchInput('')
                              setSearchQuery('')
                              setSelectedActionGroup('ALL')
                              setSelectedOrderSubFilter('NONE')
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
          {!loading && group3Disputes.length > 0 && (
            <div className="p-3.5 bg-rose-500/5 border-b border-slate-200 dark:border-slate-800 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
                  <div className="text-[10px] font-extrabold uppercase text-slate-500">
                    {t('deliveryReconciliation.disputes_kpi_original')}
                  </div>
                  <div className="font-mono font-extrabold text-lg text-slate-900 dark:text-slate-100">
                    {fmtMoney(disputesKpi.original)}
                  </div>
                </div>
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
                  <div className="text-[10px] font-extrabold uppercase text-emerald-700 dark:text-emerald-400">
                    {t('deliveryReconciliation.disputes_kpi_recovered')}
                  </div>
                  <div className="font-mono font-extrabold text-lg text-emerald-700 dark:text-emerald-400">
                    {fmtMoney(disputesKpi.recovered)}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-400/30 bg-slate-500/5 p-3">
                  <div className="text-[10px] font-extrabold uppercase text-slate-600 dark:text-slate-300">
                    {t('deliveryReconciliation.disputes_kpi_closed_loss')}
                  </div>
                  <div className="font-mono font-extrabold text-lg text-slate-700 dark:text-slate-200">
                    {fmtMoney(disputesKpi.closedLoss)}
                  </div>
                </div>
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3">
                  <div className="text-[10px] font-extrabold uppercase text-rose-700 dark:text-rose-400">
                    {t('deliveryReconciliation.disputes_kpi_pending')}
                  </div>
                  <div className="font-mono font-extrabold text-lg text-rose-700 dark:text-rose-400">
                    {fmtMoney(disputesKpi.pending)}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      ['ALL', t('deliveryReconciliation.disputes_subfilter_all', { count: group3Disputes.length })],
                      ['PENDING', t('deliveryReconciliation.disputes_subfilter_pending', { count: openDisputeOrders.length })],
                      ['RECOVERED', t('deliveryReconciliation.disputes_subfilter_recovered', { count: recoveredDisputeOrders.length })],
                      ['CLOSED_LOSS', t('deliveryReconciliation.disputes_subfilter_closed_loss', { count: closedLossDisputeOrders.length })],
                    ] as Array<['ALL' | 'PENDING' | 'RECOVERED' | 'CLOSED_LOSS', string]>
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setDisputesSubFilter(key)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border ${
                        disputesSubFilter === key
                          ? 'bg-rose-600 text-white border-rose-600'
                          : 'bg-white dark:bg-slate-900 text-rose-700 dark:text-rose-300 border-rose-500/30'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => handleExportBatchEvidencePackage(filteredDisputes)}
                  disabled={filteredDisputes.length === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-extrabold shadow-sm transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  {t('deliveryReconciliation.batch_export_evidence_btn', { count: filteredDisputes.length })}
                </button>
              </div>
            </div>
          )}
          {loading ? (
            <div className="p-12 text-center text-slate-500">{t('deliveryReconciliation.loading_records')}</div>
          ) : filteredDisputes.length === 0 ? (
            <div className="p-12 text-center text-emerald-600 dark:text-emerald-400 font-semibold">
              {t('deliveryReconciliation.empty_disputes')}
            </div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {filteredDisputes.map((ord) => (
                <div key={ord.id} className="p-4 space-y-3 hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {renderPlatformBadge(ord.platform)}
                      <span className="font-mono font-extrabold text-sm">#{ord.platform_order_id}</span>
                      <span className="text-xs font-bold text-slate-500">
                        {ord.store_name} • {fmtDateMDY(ord.business_date)}
                      </span>
                      {ord.in_selected_period === false && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-500/25">
                          {t('deliveryReconciliation.prior_period_recovery_badge')}
                        </span>
                      )}
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
                            st.step === 4 && ord.recovery_classification === 'FULL_RECOVERY'
                              ? 'bg-emerald-500/10 border-emerald-500/30'
                              : st.step === 4 &&
                                (ord.recovery_classification === 'PARTIAL_RECOVERY' ||
                                  ord.recovery_classification === 'UNVERIFIED_RECOVERY')
                              ? 'bg-amber-500/10 border-amber-500/30'
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

                  {/* RESUMEN DE IMPORTE ORIGINAL, RECUPERADO VERIFICADO, PENDIENTE Y DESGLOSE POR PAYOUT */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
                    <div className="flex flex-wrap items-center gap-3 font-mono text-[11px]">
                      <span className="px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold">
                        {t('deliveryReconciliation.modal_original_disputed')}:{' '}
                        {ord.original_amount_verified === false
                          ? t('deliveryReconciliation.modal_pending_verification_val')
                          : fmtMoney(ord.original_deduction_abs ?? ord.dispute_amount ?? Math.abs(Number(ord.error_charge || 0)))}
                      </span>
                      <span className="px-2 py-0.5 rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-bold">
                        {t('deliveryReconciliation.disputes_kpi_recovered')}: {fmtMoney(ord.recovered_amount ?? 0)}
                      </span>
                      <span className="px-2 py-0.5 rounded-lg bg-rose-500/10 text-rose-700 dark:text-rose-300 font-bold">
                        {t('deliveryReconciliation.disputes_kpi_pending')}: {fmtMoney(ord.unrecovered_amount ?? 0)}
                      </span>
                    </div>
                    {Array.isArray(ord.recovery_credits_evaluated) && ord.recovery_credits_evaluated.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {ord.recovery_credits_evaluated.map((cr) => (
                          <span
                            key={cr.credit_id}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-mono text-[10px] font-bold border ${
                              cr.verified
                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                                : 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30'
                            }`}
                          >
                            {cr.verified ? '✅' : '⏳'} #{cr.payout_reference_id} +{fmtMoney(cr.amount)}
                            {cr.deposit_date ? ` (${fmtDateMDY(cr.deposit_date)})` : ''}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
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
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-extrabold text-slate-700 dark:text-slate-200">
                {t('deliveryReconciliation.step_4_mappings')} ({selectedStore !== 'ALL' && selectedStore !== '0' ? mappings.filter((m) => String(m.store_id) === String(selectedStore)).length : mappings.length})
              </span>
              {selectedStore !== 'ALL' && selectedStore !== '0' && (
                <button
                  type="button"
                  onClick={() => setSelectedStore('ALL')}
                  className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800/70 transition"
                >
                  {t('deliveryReconciliation.mappings_filter_notice', { store: activeStoreLabel, total: mappings.length })}
                </button>
              )}
            </div>
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
                  .filter((m) =>
                    selectedStore !== 'ALL' && selectedStore !== '0'
                      ? String(m.store_id) === String(selectedStore)
                      : true
                  )
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
                          : status === 'NOT_SYNCED_IN_RANGE'
                          ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30'
                          : 'bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700'

                      const badgeLabel =
                        status === 'COMPLETE'
                          ? t('deliveryReconciliation.coverage_status_COMPLETE')
                          : status === 'PARTIAL'
                          ? t('deliveryReconciliation.coverage_status_PARTIAL')
                          : status === 'FAILED'
                          ? t('deliveryReconciliation.coverage_status_FAILED')
                          : status === 'NOT_SYNCED_IN_RANGE'
                          ? t('deliveryReconciliation.coverage_status_NOT_SYNCED_IN_RANGE')
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
                          {renderPlatCell('DOORDASH', m.doordash_store_id || '-')}
                        </td>
                        <td className="p-3">
                          {renderPlatCell('GRUBHUB', m.grubhub_cust_id || '-')}
                        </td>
                        <td className="p-3">
                          {renderPlatCell('UBER_EATS', m.ubereats_store_uuid || '-')}
                        </td>
                        <td className="p-3 text-xs whitespace-nowrap">
                          <button
                            onClick={() => {
                              handleLiveSyncForStore({
                                storeId: String(m.store_id),
                                openOrdersTab: false,
                                preserveFilters: true,
                              })
                            }}
                            disabled={syncing || loading || !isDateRangeValid}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold transition"
                          >
                            <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
                            {t('deliveryReconciliation.sync_this_store_btn')}
                          </button>
                          {showAdvancedSupport && editingMappingStoreId !== m.store_id && (
                            <button
                              type="button"
                              onClick={() => handleStartEditMapping(m)}
                              className="mt-1.5 flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 transition"
                            >
                              ✏️ {t('deliveryReconciliation.mapping_edit_btn')}
                            </button>
                          )}
                          {showAdvancedSupport && editingMappingStoreId === m.store_id && (
                            <div className="mt-2 space-y-1.5 min-w-[220px]">
                              {(
                                [
                                  ['doordash_store_id', t('deliveryReconciliation.mapping_dd_store_id')],
                                  ['doordash_business_id', t('deliveryReconciliation.mapping_dd_business_id')],
                                  ['grubhub_cust_id', t('deliveryReconciliation.mapping_gh_cust_id')],
                                  ['ubereats_store_uuid', t('deliveryReconciliation.mapping_ue_uuid')],
                                  ['ubereats_org_uuid', t('deliveryReconciliation.mapping_ue_org_uuid')],
                                ] as Array<[keyof typeof mappingDraft, string]>
                              ).map(([field, label]) => (
                                <label key={field} className="block">
                                  <span className="block text-[10px] font-bold text-slate-500">{label}</span>
                                  <input
                                    type="text"
                                    name={`${field}-${m.store_id}`}
                                    value={mappingDraft[field]}
                                    onChange={(e) => setMappingDraft((prev) => ({ ...prev, [field]: e.target.value }))}
                                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-[11px] font-mono"
                                  />
                                </label>
                              ))}
                              <div className="flex gap-1.5 pt-0.5">
                                <button
                                  type="button"
                                  onClick={() => handleSaveStoreMapping(m)}
                                  disabled={savingMapping}
                                  className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[11px] font-extrabold"
                                >
                                  {t('deliveryReconciliation.mapping_save_btn')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingMappingStoreId(null)}
                                  disabled={savingMapping}
                                  className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-[11px] font-semibold"
                                >
                                  {t('deliveryReconciliation.mapping_cancel_btn')}
                                </button>
                              </div>
                            </div>
                          )}
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
              <button
                type="button"
                onClick={() => setShowQbAccountCodes((v) => !v)}
                className={`px-2.5 py-1 rounded-xl text-xs font-bold border transition ${
                  showQbAccountCodes
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                }`}
              >
                🧾 {t('deliveryReconciliation.qb_toggle_account_codes')}
              </button>

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
            <div className="p-12 text-center text-slate-500">{t('deliveryReconciliation.loading_qb_records')}</div>
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
                        aria-label={t('deliveryReconciliation.batch_select_all')}
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
                    <th className="px-1.5 py-2">{t('deliveryReconciliation.qb_col_audit_status')}</th>
                    <th className="px-1.5 py-2">{t('deliveryReconciliation.qb_col_dispute_recovery')}</th>
                    <th className="px-1.5 py-2 text-center">{t('deliveryReconciliation.qb_col_actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {displayedQbRecords.map((r) => {
                    const prev = r.journalPreview || {}
                    const audit = prev.auditBreakdown || {}
                    const allLines: any[] = Array.isArray(prev.lines) ? prev.lines : []
                    const line1 = allLines[0]
                    const line2 = allLines[1]
                    const line3 = allLines[2]
                    const adjustmentLines = allLines.slice(3)
                    const line3Signed =
                      line3 !== undefined
                        ? line3.postingType === 'Debit'
                          ? -Number(line3.amount ?? 0)
                          : Number(line3.amount ?? 0)
                        : Number(r.platform_gross_receivable ?? 0)
                    const line2Signed =
                      line2 !== undefined
                        ? line2.postingType === 'Credit'
                          ? Number(line2.amount ?? 0)
                          : -Number(line2.amount ?? 0)
                        : -Math.abs(Number(r.total_fees ?? 0))
                    const safeLine2Display = Math.abs(line2Signed) < 0.005 ? 0 : line2Signed
                    const errAdjNet = adjustmentLines.reduce((acc, ln: any) => {
                      const amt = Number(ln?.amount ?? 0)
                      return acc + (ln?.postingType === 'Credit' ? amt : -amt)
                    }, 0)
                    const line1Signed =
                      line1 !== undefined
                        ? line1.postingType === 'Credit'
                          ? -Number(line1.amount ?? 0)
                          : Number(line1.amount ?? 0)
                        : Number(r.net_payout_amount ?? 0)
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
                            aria-label={`#${r.payout_reference_id}`}
                            className="rounded border-slate-300 disabled:opacity-40"
                          />
                        </td>
                        <td className="px-1.5 py-2 whitespace-nowrap">
                          <div className="font-bold text-slate-900 dark:text-white text-[11px]">
                            {fmtDateMDY(r.period_start)} → {fmtDateMDY(r.period_end)}
                          </div>
                          <div
                            className="text-[10px] font-mono text-indigo-600 dark:text-indigo-400 max-w-[165px] truncate"
                            title={`#${r.payout_reference_id}`}
                          >
                            Ref: #{shortenRef(r.payout_reference_id, 20)}
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
                            {fmtMoney(line3Signed)}
                          </div>
                          {showQbAccountCodes && (
                            <div className="text-[10px] text-slate-400 max-w-[85px] 2xl:max-w-[125px] ml-auto truncate" title={line3?.accountName}>
                              {line3?.accountName}
                            </div>
                          )}
                        </td>
                        <td className="px-1.5 py-2 text-right font-mono whitespace-nowrap">
                          <div className="font-bold text-amber-600 dark:text-amber-400">
                            {fmtMoney(safeLine2Display)}
                          </div>
                          {showQbAccountCodes && (
                            <div className="text-[10px] text-slate-400 max-w-[85px] 2xl:max-w-[125px] ml-auto truncate" title={line2?.accountName}>
                              {line2?.accountName}
                            </div>
                          )}
                        </td>
                        <td className="px-1.5 py-2 text-right font-mono max-w-[95px] 2xl:max-w-[135px]">
                          {adjustmentLines.length > 0 ? (
                            <div>
                              <span
                                className={`font-extrabold ${
                                  errAdjNet >= 0.005
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : errAdjNet <= -0.005
                                    ? 'text-rose-600 dark:text-rose-400'
                                    : 'text-slate-400'
                                }`}
                              >
                                {errAdjNet >= 0.005 ? `+${fmtMoney(errAdjNet)}` : fmtMoney(Math.abs(errAdjNet) < 0.005 ? 0 : errAdjNet)}
                              </span>
                              {showQbAccountCodes && (
                                <div
                                  className="text-[10px] text-slate-400 max-w-[95px] 2xl:max-w-[135px] ml-auto truncate"
                                  title={adjustmentLines.map((ln: any) => ln.accountName).filter(Boolean).join(' + ')}
                                >
                                  {adjustmentLines.map((ln: any) => ln.accountName).filter(Boolean).join(' + ')}
                                </div>
                              )}
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
                          <div
                            className={`font-extrabold ${
                              Number(r.net_payout_amount || 0) < 0
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-emerald-600 dark:text-emerald-400'
                            }`}
                          >
                            {fmtMoney(line1 !== undefined ? line1Signed : r.net_payout_amount ?? 0)}
                          </div>
                          {showQbAccountCodes && (
                            <div className="text-[10px] text-slate-400 max-w-[85px] 2xl:max-w-[125px] ml-auto truncate" title={line1?.accountName}>
                              {line1?.accountName}
                            </div>
                          )}
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
                                title={t('deliveryReconciliation.qb_bank_transit_tooltip')}
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
                                {t('deliveryReconciliation.qb_check_before_retry')}
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
                          ) : r.payoutPolicyStatus?.code === 'PUBLISH_FAILED' || r.qbLastError ? (
                            <div className="flex flex-col gap-1 items-start">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30">
                                {t('deliveryReconciliation.qb_badge_publish_failed')}
                              </span>
                              {r.qbLastError && (
                                <div className="text-[10px] text-rose-600 dark:text-rose-400 max-w-[165px] leading-tight line-clamp-2" title={r.qbLastError}>
                                  {r.qbLastError}
                                </div>
                              )}
                            </div>
                          ) : !r.canPublish ? (
                            <div className="flex flex-col gap-1 items-start">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30">
                                {r.qboMatchEvaluation?.classification === 'HISTORICAL_CANDIDATE_PENDING_REVIEW'
                                  ? t('deliveryReconciliation.qb_historical_candidate_badge')
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
                                {t('deliveryReconciliation.qb_ready_4line_hint')}
                              </span>
                            </div>
                          )}
                        </td>

                        {/* 2. ESTADO DE AUDITORÍA DE ÓRDENES (SIEMPRE VISIBLE AUNQUE LA PÓLIZA ESTÉ CREADA) */}
                        <td className="px-2 py-2.5 max-w-[195px]">
                          <div className="flex flex-col items-start gap-1.5">
                          {r.toastCrossCheckSummary && (
                            <button
                              type="button"
                              onClick={() => handleOpenQbModal(r)}
                              className="mb-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-extrabold bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-500/25 transition"
                            >
                              {(r.toastCrossCheckSummary.linkedOrdersCount || 0) === 0 &&
                              (r.toastCrossCheckSummary.declaredOrdersCount || 0) > 0
                                ? t('deliveryReconciliation.qb_included_orders_pending_sync_badge', {
                                    declared: r.toastCrossCheckSummary.declaredOrdersCount,
                                  })
                                : t('deliveryReconciliation.qb_included_orders_badge', {
                                    linked: r.toastCrossCheckSummary.linkedOrdersCount || 0,
                                    ok: r.toastCrossCheckSummary.matchedOkCount || 0,
                                  })}
                            </button>
                          )}
                          {warnings.length === 0 ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25">
                              {t('deliveryReconciliation.qb_audit_clean_badge')}
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
                                {t('deliveryReconciliation.qb_audit_alerts_count', { count: warnings.length })}
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
                          </div>
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
                              {t('deliveryReconciliation.qb_no_disputes_label')}
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
                                setSearchInput('')
                                setSearchQuery('')
                                setSelectedActionGroup('ALL')
                                setSelectedOrderSubFilter('NONE')
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
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-xl w-full p-6 space-y-4 shadow-2xl max-h-[92vh] overflow-y-auto">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                <h3 className="text-lg font-extrabold">{t('deliveryReconciliation.batch_confirm_modal_title')}</h3>
                <button
                  onClick={() => setShowBatchConfirmModal(false)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {renderBannerAlert()}
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
                  <span className="font-semibold text-right">{uniquePlatforms.map((pl) => formatPlatformDisplayName(pl)).join(', ')}</span>
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
        // Misma condición que el servidor para separar Sales Tax real (24001) en reembolsos
        const canSplitTax =
          selectedQbRecord.platform !== 'UBER_EATS' &&
          embeddedTax > 0.01 &&
          rawErrAdj < -0.01 &&
          embeddedTax < Math.abs(rawErrAdj)

        const modalLines = (() => {
          const baseLines: any[] = prev.lines || []
          if (!jeModalSplitTax || !canSplitTax) {
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
        // Totales en vivo calculados sobre las líneas visibles (incluye la línea 5 si se separa el tax)
        const modalDebits = modalLines.reduce(
          (acc: number, l: any) => acc + (l.postingType === 'Debit' ? Number(l.amount || 0) : 0),
          0
        )
        const modalCredits = modalLines.reduce(
          (acc: number, l: any) => acc + (l.postingType === 'Credit' ? Number(l.amount || 0) : 0),
          0
        )
        const modalBalanced = modalLines.length > 0 && Math.abs(modalDebits - modalCredits) < 0.005

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

              {renderBannerAlert()}

              {/* TRES ESTADOS INDEPENDIENTES DEL CORTE: (1) PÓLIZA QBO Y BANCO, (2) AUDITORÍA DE ÓRDENES, (3) DISPUTAS Y RECUPERACIÓN */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/50 space-y-1">
                  <div className="text-[10px] font-extrabold uppercase text-slate-500">
                    {t('deliveryReconciliation.qb_modal_status_1_title')}
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
                    {t('deliveryReconciliation.qb_modal_status_2_title')}
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
                    {t('deliveryReconciliation.qb_modal_status_2_sub')}
                  </div>
                </div>

                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/50 space-y-1">
                  <div className="text-[10px] font-extrabold uppercase text-slate-500">
                    {t('deliveryReconciliation.qb_modal_status_3_title')}
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
                    {(isEn ? dispStat.label_en : dispStat.label_es) || t('deliveryReconciliation.qb_no_disputes_label')}
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono">
                    {t('deliveryReconciliation.card_error_charges')}{' '}
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
                      {t('deliveryReconciliation.qb_modal_acct_short')} {selectedQbRecord.bankVerification.bankAccountNum}
                    </div>
                  </div>
                </div>
              )}

              {/* PANEL DE VERIFICACIÓN DE ESTADO DE RECUPERACIÓN (RECOVERY_REQUIRED) */}
              {selectedQbRecord.recoveryRequired && (
                <div className="p-4 rounded-xl bg-rose-500/10 border-2 border-rose-500/40 space-y-2.5 text-xs">
                  <div className="font-extrabold text-rose-800 dark:text-rose-200 flex items-center justify-between gap-2">
                    <span>
                      {t('deliveryReconciliation.qb_modal_recovery_banner')}
                    </span>
                    <button
                      onClick={() => handleVerifyQboRecoveryStatus(selectedQbRecord.id)}
                      disabled={resolvingQboCandidate}
                      className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-extrabold shadow-sm"
                    >
                      {resolvingQboCandidate
                        ? t('deliveryReconciliation.qb_modal_checking_btn')
                        : t('deliveryReconciliation.qb_modal_verify_now_btn')}
                    </button>
                  </div>
                </div>
              )}

              {/* PANEL DE CANDIDATOS DE PÓLIZAS HISTÓRICAS EN QBO PARA CONFIRMAR O DESCARTAR CON AUDITORÍA */}
              {!selectedQbRecord.hasJournalEntry && qboCandidates.length > 0 && (
                <div className="p-4 rounded-xl bg-amber-500/10 border-2 border-amber-500/40 space-y-3 text-xs">
                  <div className="font-extrabold text-amber-900 dark:text-amber-200">
                    {t('deliveryReconciliation.qb_modal_candidates_title', { count: qboCandidates.length })}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label htmlFor="qbo-cand-reason" className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                        {t('deliveryReconciliation.qb_modal_reason_label')}
                      </label>
                      <input
                        id="qbo-cand-reason"
                        name="qbo_candidate_reason"
                        type="text"
                        value={qboCandidateReason}
                        onChange={(e) => setQboCandidateReason(e.target.value)}
                        placeholder={t('deliveryReconciliation.qb_modal_reason_placeholder')}
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs"
                      />
                    </div>
                    <div>
                      <label htmlFor="qbo-cand-evidence" className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                        {t('deliveryReconciliation.qb_modal_evidence_label')}
                      </label>
                      <input
                        id="qbo-cand-evidence"
                        name="qbo_candidate_evidence"
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
                            {t('deliveryReconciliation.qb_modal_confirm_link_btn')}
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
                            {t('deliveryReconciliation.qb_modal_discard_cand_btn')}
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
                    {t('deliveryReconciliation.qb_modal_blocked_safety_title')}
                  </div>
                  {blockers.map((b, idx) => (
                    <div key={idx} className="pl-5 space-y-0.5">
                      <div className="font-bold">• {isEn ? b.message_en : b.message_es}</div>
                      {(b.cause_es || b.cause_en) && (
                        <div className="text-[11px] opacity-90">
                          <strong>{t('deliveryReconciliation.label_cause')}</strong> {isEn ? b.cause_en : b.cause_es}
                        </div>
                      )}
                      {(b.next_action_es || b.next_action_en) && (
                        <div className="text-[11px] font-bold text-rose-700 dark:text-rose-300">
                          → <strong>{t('deliveryReconciliation.label_next_action')}</strong>{' '}
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
                    {t('deliveryReconciliation.qb_modal_audit_alerts_title')}
                  </div>
                  {warnings.map((w, idx) => (
                    <div key={idx} className="pl-5 space-y-0.5">
                      <div className="font-bold">• {isEn ? w.message_en : w.message_es}</div>
                      {(w.cause_es || w.cause_en) && (
                        <div className="text-[11px] opacity-90">
                          <strong>{t('deliveryReconciliation.label_cause')}</strong> {isEn ? w.cause_en : w.cause_es}
                        </div>
                      )}
                      {(w.next_action_es || w.next_action_en) && (
                        <div className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
                          → <strong>{t('deliveryReconciliation.label_next_action')}</strong>{' '}
                          {isEn ? w.next_action_en : w.next_action_es}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                <div>
                  <label htmlFor="qbo-je-txn-date" className="block text-xs font-bold text-slate-500 mb-1">
                    {t('deliveryReconciliation.qb_modal_date_label')}
                  </label>
                  <input
                    id="qbo-je-txn-date"
                    name="qbo_je_txn_date"
                    type="date"
                    value={jeModalDate}
                    onChange={(e) => setJeModalDate(e.target.value)}
                    disabled={selectedQbRecord.hasJournalEntry}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-mono font-bold disabled:opacity-60"
                  />
                </div>
                <div>
                  <label htmlFor="qbo-je-doc-num" className="block text-xs font-bold text-slate-500 mb-1">
                    {t('deliveryReconciliation.qb_modal_doc_num_label')}
                  </label>
                  <input
                    id="qbo-je-doc-num"
                    name="qbo_je_doc_num"
                    type="text"
                    value={jeModalDocNumber}
                    onChange={(e) => setJeModalDocNumber(e.target.value)}
                    disabled={selectedQbRecord.hasJournalEntry}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-mono font-bold disabled:opacity-60"
                  />
                </div>
                <div className="flex flex-col justify-center">
                  {canSplitTax ? (
                    <label htmlFor="qbo-je-split-tax" className="flex items-start gap-2 cursor-pointer text-xs">
                      <input
                        id="qbo-je-split-tax"
                        name="qbo_je_split_tax"
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
                          platform: formatPlatformDisplayName(selectedQbRecord.platform),
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
                      modalBalanced
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                        : 'bg-rose-500/15 text-rose-700'
                    }`}
                  >
                    {modalBalanced ? '✓' : '✗'} {t('deliveryReconciliation.qb_total_debits_eq_credits', {
                      debits: fmtMoney(modalDebits),
                      eq: modalBalanced ? '=' : '≠',
                      credits: fmtMoney(modalCredits),
                    })}
                  </span>
                </div>

                <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-xl">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-100 dark:bg-slate-800 font-bold text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                        <th className="p-2.5">#</th>
                        <th className="p-2.5 uppercase">{t('deliveryReconciliation.qb_col_je_account')}</th>
                        <th className="p-2.5 text-right uppercase">{t('deliveryReconciliation.qb_col_je_debits')}</th>
                        <th className="p-2.5 text-right uppercase">{t('deliveryReconciliation.qb_col_je_credits')}</th>
                        <th className="p-2.5 uppercase">{t('deliveryReconciliation.qb_col_je_description')}</th>
                        <th className="p-2.5 uppercase">{t('deliveryReconciliation.qb_col_je_location')}</th>
                        <th className="p-2.5 uppercase">{t('deliveryReconciliation.qb_col_je_class')}</th>
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

              {/* DESGLOSE COMPLETO DE ÓRDENES INCLUIDAS EN ESTA PÓLIZA (CRUCE ORDEN X ORDEN CON TOAST POS) */}
              {(() => {
                const incOrders: any[] = prev.auditBreakdown?.includedOrders || []
                const crossSum =
                  prev.auditBreakdown?.toastCrossCheckSummary || selectedQbRecord.toastCrossCheckSummary || {}
                return (
                  <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h4 className="text-xs md:text-sm font-extrabold uppercase text-indigo-700 dark:text-indigo-300">
                          {t('deliveryReconciliation.qb_modal_included_orders_title')}
                        </h4>
                        <p className="text-[11px] text-slate-500 font-semibold">
                          {t('deliveryReconciliation.qb_modal_included_orders_sub', {
                            declared: crossSum.declaredOrdersCount ?? incOrders.length,
                            linked: crossSum.linkedOrdersCount ?? incOrders.length,
                            ok: crossSum.matchedOkCount ?? 0,
                            diff: crossSum.underpaidOrDeductedCount ?? 0,
                          })}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const targetStoreId = String(selectedQbRecord.store_id)
                          const targetPlat = selectedQbRecord.platform
                          const targetRef = selectedQbRecord.payout_reference_id
                          const pStart = selectedQbRecord.period_start
                          const pEnd = selectedQbRecord.period_end
                          setSelectedQbRecord(null)
                          setSelectedStore(targetStoreId)
                          setSelectedPlatform(targetPlat)
                          if (pStart && pEnd) {
                            setStartDate(pStart)
                            setEndDate(pEnd)
                          }
                          setActivePayoutRef(targetRef)
                          setSearchInput('')
                          setSearchQuery('')
                          setSelectedActionGroup('ALL')
                          setSelectedOrderSubFilter('NONE')
                          setActiveTab('orders')
                        }}
                        className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold shadow-sm"
                      >
                        {t('deliveryReconciliation.qb_audit_orders_btn')}
                      </button>
                    </div>

                    {incOrders.length === 0 ? (
                      <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-800 dark:text-amber-200 flex items-center justify-between gap-2">
                        <span>
                          {t('deliveryReconciliation.qb_modal_orders_not_synced')}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const sId = String(selectedQbRecord.store_id)
                            const plat = selectedQbRecord.platform
                            const pStart = selectedQbRecord.period_start || startDate
                            const pEnd = selectedQbRecord.period_end || endDate
                            const ref = selectedQbRecord.payout_reference_id
                            setSelectedQbRecord(null)
                            handleLiveSyncForStore({
                              storeId: sId,
                              platform: plat,
                              startDate: pStart,
                              endDate: pEnd,
                              payoutRef: ref,
                              openOrdersTab: true,
                            })
                          }}
                          disabled={syncing || loading}
                          className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-extrabold shrink-0"
                        >
                          {t('deliveryReconciliation.sync_this_store_btn')}
                        </button>
                      </div>
                    ) : (
                      <div className="max-h-64 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-xl">
                        <table className="w-full text-left border-collapse text-[11px]">
                          <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800 font-bold text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                            <tr>
                              <th className="p-2">{t('deliveryReconciliation.qb_modal_col_date')}</th>
                              <th className="p-2">{t('deliveryReconciliation.qb_modal_col_order')}</th>
                              <th className="p-2">{t('deliveryReconciliation.qb_modal_col_toast_cust')}</th>
                              <th className="p-2 text-right">{t('deliveryReconciliation.qb_modal_col_toast_exp')}</th>
                              <th className="p-2 text-right">{t('deliveryReconciliation.qb_modal_col_plat_gross')}</th>
                              <th className="p-2 text-right">{t('deliveryReconciliation.qb_modal_col_fees')}</th>
                              <th className="p-2 text-right">{t('deliveryReconciliation.qb_modal_col_error_adj')}</th>
                              <th className="p-2 text-right">{t('deliveryReconciliation.qb_modal_col_net_paid')}</th>
                              <th className="p-2">{t('deliveryReconciliation.qb_modal_col_cross_status')}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                            {incOrders.map((io: any) => {
                              const matchedOrder = orders.find(
                                (o) => o.id === io.id || (io.platform_order_id && o.platform_order_id === io.platform_order_id && o.store_id === selectedQbRecord.store_id)
                              )
                              return (
                              <tr
                                key={io.id || io.platform_order_id}
                                title={matchedOrder ? t('deliveryReconciliation.qb_included_order_open_tooltip') : undefined}
                                onClick={() => {
                                  if (!matchedOrder) return
                                  setSelectedQbRecord(null)
                                  handleOpenOrderModal(matchedOrder)
                                }}
                                className={`font-mono ${matchedOrder ? 'cursor-pointer hover:bg-indigo-50/70 dark:hover:bg-indigo-950/30' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'}`}
                              >
                                <td className="p-2 whitespace-nowrap">{fmtDateMDY(io.business_date)}</td>
                                <td className="p-2 font-bold text-indigo-700 dark:text-indigo-300">#{io.platform_order_id}</td>
                                <td className="p-2 font-sans">
                                  {io.toast_display_number
                                    ? `${t('deliveryReconciliation.toast_check_prefix')}${io.toast_display_number}${io.toast_tab_name ? ` • ${io.toast_tab_name}` : ''}`
                                    : io.customer_name || '—'}
                                </td>
                                <td className="p-2 text-right">{fmtMoney(io.toast_expected_gross)}</td>
                                <td className="p-2 text-right font-bold text-indigo-600 dark:text-indigo-400">
                                  {fmtMoney(io.platform_gross_receivable)}
                                </td>
                                <td className="p-2 text-right text-amber-600 dark:text-amber-400">
                                  {fmtMoney(io.total_fees)}
                                </td>
                                <td
                                  className={`p-2 text-right font-bold ${
                                    Number(io.error_charge || 0) < -0.01 ? 'text-rose-600' : 'text-slate-400'
                                  }`}
                                >
                                  {fmtMoney(io.error_charge)}
                                </td>
                                <td className="p-2 text-right font-extrabold text-emerald-600 dark:text-emerald-400">
                                  {fmtMoney(io.net_payout)}
                                </td>
                                <td className="p-2 font-sans font-bold whitespace-nowrap">
                                  {io.cross_check_state === 'MATCHED_OK'
                                    ? t('deliveryReconciliation.qb_cross_matched_ok')
                                    : io.cross_check_state === 'DEDUCTED_OR_DISPUTED'
                                    ? t('deliveryReconciliation.qb_cross_deducted')
                                    : io.cross_check_state === 'MISSING_IN_TOAST'
                                    ? t('deliveryReconciliation.qb_cross_missing_toast')
                                    : t('deliveryReconciliation.qb_cross_variance')}
                                </td>
                              </tr>
                            )})}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })()}

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
        const getRowDisputeImpact = (o: ReconciledOrder) => {
          const rawNet = Number(o.error_charge || 0) + Number(o.adjustment_amount || 0)
          if (Math.abs(rawNet) > 0.005) return Math.abs(rawNet)
          return Math.abs(Number(o.dispute_amount || 0))
        }
        const totalAmount = selectedVisibleOrders.reduce((acc, o) => {
          if (isVarianceBatch) {
            return acc + Math.abs(Number(o.gross_variance ?? o.gross_diff ?? 0))
          }
          return acc + getRowDisputeImpact(o)
        }, 0)

        return (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-xl w-full p-6 space-y-4 shadow-2xl max-h-[92vh] overflow-y-auto">
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

              {renderBannerAlert()}
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
                  <span className="font-semibold text-right">{uniquePlatforms.map((pl) => formatPlatformDisplayName(pl)).join(', ')}</span>
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
                    {t('deliveryReconciliation.batch_order_confirm_orders_list')}
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
                              ? Math.abs(Number(o.gross_variance ?? o.gross_diff ?? 0))
                              : getRowDisputeImpact(o)
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
                    // Los handlers cierran el modal solo en éxito; si fallan, el banner queda visible dentro del modal
                    const targetOrderIds = selectedVisibleOrders.map((o) => o.id)
                    if (isVarianceBatch) {
                      await handleBatchApproveVariance(targetOrderIds)
                    } else {
                      await handleBatchMarkDisputeSubmitted(targetOrderIds)
                    }
                  }}
                  disabled={savingBatch}
                  className={`px-5 py-2 rounded-xl text-white text-sm font-extrabold shadow-sm disabled:opacity-50 ${
                    isVarianceBatch ? 'bg-amber-600 hover:bg-amber-700' : 'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  {isVarianceBatch
                    ? t('deliveryReconciliation.batch_approve_variance_btn', { count: selectedVisibleOrders.length })
                    : t('deliveryReconciliation.batch_mark_submitted_btn', { count: selectedVisibleOrders.length })}
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

            {renderBannerAlert()}

            {/* DESGLOSE FINANCIERO LADO A LADO: TOAST POS vs PLATAFORMA vs DIFERENCIA */}
            {(() => {
              const so = selectedOrder
              const isUber = so.platform === 'UBER_EATS'
              const commAbs = Math.abs(Number(so.commission_fee || 0)) + Math.abs(Number(so.delivery_fee || 0))
              const procAbs = Math.abs(Number(so.processing_fee || 0)) + Math.abs(Number(so.marketing_fee || 0))
              const errAdjVal = Number(so.error_charge || 0) + Number(so.adjustment_amount || 0)
              const hasToast = Boolean(so.toast_order_guid) || Number(so.toast_expected_gross || 0) !== 0
              const rows: Array<{ key: string; label: string; toast: number | null; plat: number | null; strong?: boolean }> = [
                { key: 'sub', label: t('deliveryReconciliation.modal_row_subtotal'), toast: hasToast ? Number(so.toast_net_sales || 0) : null, plat: Number(so.platform_subtotal || 0) },
                { key: 'tax', label: t('deliveryReconciliation.modal_row_sales_tax'), toast: hasToast && !isUber ? Number(so.toast_tax || 0) : null, plat: isUber ? null : Number(so.platform_tax_paid_to_merchant || 0) },
                { key: 'gross', label: t('deliveryReconciliation.modal_row_gross_expected'), toast: hasToast ? Number(so.toast_expected_gross || 0) : null, plat: Number(so.platform_gross_receivable || 0), strong: true },
                { key: 'comm', label: t('deliveryReconciliation.modal_row_commissions'), toast: null, plat: -commAbs },
                { key: 'proc', label: t('deliveryReconciliation.modal_row_proc_mktg'), toast: null, plat: -procAbs },
                { key: 'err', label: errAdjVal > 0.005 ? `(+) ${t('deliveryReconciliation.card_reimbursements_won')}` : t('deliveryReconciliation.modal_row_error_adj'), toast: null, plat: errAdjVal },
                { key: 'tip', label: t('deliveryReconciliation.modal_row_tips'), toast: null, plat: Number(so.tip_amount || 0) },
                { key: 'net', label: t('deliveryReconciliation.modal_row_net_payout'), toast: null, plat: Number(so.net_payout || 0), strong: true },
              ]
              return (
                <div className="space-y-2">
                  <div className="text-xs font-extrabold uppercase text-indigo-600 dark:text-indigo-400">
                    {t('deliveryReconciliation.modal_financial_comparison_title')}
                  </div>
                  <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-xl">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-100 dark:bg-slate-800 font-bold text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                          <th className="p-2">{t('deliveryReconciliation.modal_col_concept')}</th>
                          <th className="p-2 text-right">{t('deliveryReconciliation.modal_col_toast')}</th>
                          <th className="p-2 text-right">{t('deliveryReconciliation.modal_col_platform')}</th>
                          <th className="p-2 text-right">{t('deliveryReconciliation.modal_col_diff')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono">
                        {rows.map((row) => {
                          const diff = row.toast !== null && row.plat !== null ? row.plat - row.toast : null
                          return (
                            <tr key={row.key} className={row.strong ? 'bg-slate-50 dark:bg-slate-800/40 font-extrabold' : ''}>
                              <td className="p-2 font-sans font-semibold text-slate-700 dark:text-slate-200">{row.label}</td>
                              <td className="p-2 text-right text-slate-700 dark:text-slate-200">
                                {row.toast === null ? '—' : fmtMoney(row.toast)}
                              </td>
                              <td className="p-2 text-right text-indigo-700 dark:text-indigo-300">
                                {row.plat === null ? '—' : fmtMoney(row.plat)}
                              </td>
                              <td
                                className={`p-2 text-right ${
                                  diff === null
                                    ? 'text-slate-400'
                                    : Math.abs(diff) <= 0.05
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-rose-600 dark:text-rose-400'
                                }`}
                              >
                                {diff === null ? '—' : fmtMoney(diff)}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })()}

            {/* DIAGNÓSTICO COMPLETO: QUÉ PASÓ, CAUSA, EVIDENCIA Y SIGUIENTE ACCIÓN */}
            {(selectedOrder.what_happened_es || selectedOrder.cause_es || selectedOrder.evidence_es || selectedOrder.next_action_es) && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 p-3 space-y-1.5 text-xs">
                <div className="text-xs font-extrabold uppercase text-indigo-600 dark:text-indigo-400">
                  {t('deliveryReconciliation.modal_audit_diagnosis_title')}
                </div>
                {(isEn ? selectedOrder.what_happened_en : selectedOrder.what_happened_es) && (
                  <div>
                    <strong>{t('deliveryReconciliation.label_what_happened')}</strong>{' '}
                    {isEn ? selectedOrder.what_happened_en : selectedOrder.what_happened_es}
                  </div>
                )}
                {(isEn ? selectedOrder.cause_en : selectedOrder.cause_es) && (
                  <div>
                    <strong>{t('deliveryReconciliation.label_cause')}</strong>{' '}
                    {isEn ? selectedOrder.cause_en : selectedOrder.cause_es}
                  </div>
                )}
                {(isEn ? selectedOrder.evidence_en : selectedOrder.evidence_es) && (
                  <div>
                    <strong>{t('deliveryReconciliation.label_evidence')}</strong>{' '}
                    <span className="font-mono text-indigo-600 dark:text-indigo-400">
                      {isEn ? selectedOrder.evidence_en : selectedOrder.evidence_es}
                    </span>
                  </div>
                )}
                {(isEn ? selectedOrder.next_action_en : selectedOrder.next_action_es) && (
                  <div className="font-bold text-emerald-700 dark:text-emerald-400">
                    → {t('deliveryReconciliation.label_next_action')}{' '}
                    {isEn ? selectedOrder.next_action_en : selectedOrder.next_action_es}
                  </div>
                )}
              </div>
            )}

            {/* PLATILLOS DE LA ORDEN EN TOAST POS */}
            {Array.isArray(selectedOrder.items_summary) && selectedOrder.items_summary.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-extrabold uppercase text-indigo-600 dark:text-indigo-400">
                  {t('deliveryReconciliation.modal_toast_items_title')}
                </div>
                <div className="max-h-40 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                  {selectedOrder.items_summary.map((it, idx) => (
                    <div key={`${it.name}-${idx}`} className="flex justify-between gap-2 px-3 py-1.5">
                      <span className="font-semibold text-slate-700 dark:text-slate-200">
                        {Number(it.quantity || 1)}× {it.name}
                      </span>
                      <span className="font-mono text-slate-600 dark:text-slate-300">{fmtMoney(Number(it.price || 0))}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
                        st.step === 4 && selectedOrder.recovery_classification === 'FULL_RECOVERY'
                          ? 'bg-emerald-500/10 border-emerald-500/30'
                          : st.step === 4 &&
                            (selectedOrder.recovery_classification === 'PARTIAL_RECOVERY' ||
                              selectedOrder.recovery_classification === 'UNVERIFIED_RECOVERY')
                          ? 'bg-amber-500/10 border-amber-500/30'
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
                  {t('deliveryReconciliation.modal_assign_store_prompt')}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={assignTargetStoreId}
                    id="order-assign-store-select"
                    name="assign_target_store_id"
                    aria-label={t('deliveryReconciliation.modal_assign_store_prompt')}
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
                    {t('deliveryReconciliation.modal_assign_store_btn')}
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
                          <span className="font-extrabold">{formatPlatformDisplayName(selectedOrder.platform)}</span>
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

            {/* SI HAY CANDIDATOS SUGERIDOS O AMBIGUOS DE TOAST POS, MOSTRAR SELECTOR EXPLÍCITO */}
            {(() => {
              const candList: any[] = Array.isArray(selectedOrder.raw_payload?.ambiguous_toast_candidates) &&
                selectedOrder.raw_payload.ambiguous_toast_candidates.length > 0
                  ? selectedOrder.raw_payload.ambiguous_toast_candidates
                  : selectedOrder.raw_payload?.suggested_toast_candidate
                  ? [selectedOrder.raw_payload.suggested_toast_candidate]
                  : []
              if (candList.length === 0) return null
              return (
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2 text-xs">
                  <div className="font-extrabold text-amber-800 dark:text-amber-200">
                    {t('deliveryReconciliation.modal_candidates_toast_prompt')}
                  </div>
                  <div className="space-y-1.5">
                    {candList.map((cand: any) => {
                      const candGuid = cand.toastOrderGuid || cand.toastGuid
                      return (
                        <div
                          key={candGuid}
                          className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                        >
                          <span className="font-mono">
                            {t('deliveryReconciliation.toast_check_prefix')}{cand.toastDisplayNumber || cand.displayNumber} • {t('deliveryReconciliation.sub_prefix')}: {fmtMoney(cand.netSales)} • {t('deliveryReconciliation.tax_prefix')}: {fmtMoney(cand.taxAmount)}
                          </span>
                          <button
                            onClick={() => handleApproveReviewOrder(selectedOrder, candGuid, '')}
                            disabled={savingDispute}
                            className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                          >
                            {t('deliveryReconciliation.modal_confirm_check_btn')}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}

            {/* SEGUIMIENTO DE DISPUTA Y REEMBOLSO EN CORTE POSTERIOR (solo lectura si la orden solo existe en Toast POS) */}
            {selectedOrder.match_confidence === 'TOAST_ONLY' || selectedOrder.store_id <= 0 ? (
              <div className="space-y-3 border-t border-slate-200 dark:border-slate-800 pt-4">
                {selectedOrder.match_confidence === 'TOAST_ONLY' && (
                  <div className="p-3 rounded-xl bg-sky-500/10 border border-sky-500/30 text-xs text-sky-800 dark:text-sky-200 font-semibold">
                    ℹ️ {t('deliveryReconciliation.modal_toast_only_readonly_note')}
                  </div>
                )}
                <div className="flex justify-end">
                  <button
                    onClick={() => setSelectedOrder(null)}
                    className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold"
                  >
                    {t('deliveryReconciliation.modal_close')}
                  </button>
                </div>
              </div>
            ) : (
            <div className="space-y-3 border-t border-slate-200 dark:border-slate-800 pt-4">
              {/* SEPARACIÓN ESTRICTA: IMPORTE ORIGINAL DISPUTADO, RECUPERACIONES VERIFICADAS Y SALDO PENDIENTE */}
              {(selectedOrder.action_group === 'DISPUTE_RECOVERY' ||
                Number(selectedOrder.original_deduction_abs || 0) > 0 ||
                Number(selectedOrder.dispute_amount || 0) > 0 ||
                (Array.isArray(selectedOrder.recovery_credits_evaluated) &&
                  selectedOrder.recovery_credits_evaluated.length > 0)) && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/50 p-3 space-y-2.5 text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-2">
                      <div className="text-[10px] font-bold uppercase text-slate-500">
                        {t('deliveryReconciliation.modal_original_disputed')}
                      </div>
                      <div className="font-mono font-extrabold text-sm text-slate-900 dark:text-slate-100 mt-0.5">
                        {selectedOrder.original_amount_verified === false
                          ? t('deliveryReconciliation.modal_pending_verification_val')
                          : fmtMoney(
                              selectedOrder.original_deduction_abs ??
                                selectedOrder.dispute_amount ??
                                Math.abs(Number(selectedOrder.error_charge || 0))
                            )}
                      </div>
                    </div>
                    <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-2">
                      <div className="text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-400">
                        {t('deliveryReconciliation.disputes_kpi_recovered')}
                      </div>
                      <div className="font-mono font-extrabold text-sm text-emerald-700 dark:text-emerald-400 mt-0.5">
                        {fmtMoney(selectedOrder.recovered_amount ?? 0)}
                      </div>
                    </div>
                    <div className="rounded-lg bg-rose-500/5 border border-rose-500/20 p-2">
                      <div className="text-[10px] font-bold uppercase text-rose-700 dark:text-rose-400">
                        {t('deliveryReconciliation.disputes_kpi_pending')}
                      </div>
                      <div className="font-mono font-extrabold text-sm text-rose-700 dark:text-rose-400 mt-0.5">
                        {fmtMoney(selectedOrder.unrecovered_amount ?? 0)}
                      </div>
                    </div>
                  </div>

                  {Array.isArray(selectedOrder.recovery_credits_evaluated) &&
                    selectedOrder.recovery_credits_evaluated.length > 0 && (
                      <div className="space-y-1.5 pt-1 border-t border-slate-200 dark:border-slate-700">
                        <div className="text-[11px] font-extrabold text-slate-600 dark:text-slate-300">
                          {t('deliveryReconciliation.modal_recovery_movements_title', {
                            count: selectedOrder.recovery_credits_evaluated.length,
                          })}
                        </div>
                        <div className="space-y-1">
                          {selectedOrder.recovery_credits_evaluated.map((cr) => (
                            <div
                              key={cr.credit_id}
                              className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-[11px]"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className={`px-1.5 py-0.5 rounded font-sans text-[10px] font-extrabold border ${
                                    cr.verified
                                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                                      : 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30'
                                  }`}
                                >
                                  {cr.verified
                                    ? t('deliveryReconciliation.modal_verified_in_settlement')
                                    : `⏳ ${t('deliveryReconciliation.recovery_pending_verification_badge')}`}
                                </span>
                                <span className="font-bold text-indigo-600 dark:text-indigo-400">
                                  #{cr.payout_reference_id}
                                </span>
                                {cr.transaction_id && (
                                  <span className="text-slate-400 text-[10px]">TX: {cr.transaction_id}</span>
                                )}
                                {cr.deposit_date && (
                                  <span className="text-slate-500">{fmtDateMDY(cr.deposit_date)}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="font-extrabold text-emerald-700 dark:text-emerald-400">
                                  +{fmtMoney(cr.amount)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setReimbursementRefInput(cr.payout_reference_id || '')
                                    setReimbursementAmountInput(String(cr.amount ?? ''))
                                    setReimbursementDateInput(cr.deposit_date || '')
                                    setReimbursementDescInput((cr as any).description || '')
                                    setDisputeStatusInput('REIMBURSED')
                                  }}
                                  className="px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-sans text-[10px] font-bold hover:bg-slate-100 dark:hover:bg-slate-800"
                                >
                                  {t('deliveryReconciliation.modal_edit_credit_btn')}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                </div>
              )}

              <div className="flex items-center justify-between">
                <label htmlFor="order-modal-dispute-status" className="block text-xs font-bold uppercase text-slate-500">
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
                id="order-modal-dispute-status"
                name="dispute_status"
                value={disputeStatusInput}
                onChange={(e) => setDisputeStatusInput(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-semibold"
              >
                <option value="NONE">{t('deliveryReconciliation.dispute_NONE')}</option>
                <option value="OPEN">{t('deliveryReconciliation.dispute_NEEDS_DISPUTE')}</option>
                <option value="SUBMITTED">{t('deliveryReconciliation.dispute_SUBMITTED')}</option>
                <option value="APPROVED">{t('deliveryReconciliation.dispute_APPROVED')}</option>
                <option value="REIMBURSED">{t('deliveryReconciliation.dispute_REIMBURSED')}</option>
                <option value="ACCEPTED_LOSS">{t('deliveryReconciliation.dispute_ACCEPTED_LOSS')}</option>
                <option value="REJECTED">{t('deliveryReconciliation.dispute_DENIED')}</option>
              </select>
              {(disputeStatusInput === 'ACCEPTED_LOSS' || disputeStatusInput === 'REJECTED') && (
                <div className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300">
                  ℹ️ {t('deliveryReconciliation.dispute_closed_loss_note')}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3">
                <div className="sm:col-span-2 text-[11px] font-extrabold uppercase text-emerald-700 dark:text-emerald-400">
                  {t('deliveryReconciliation.cross_payout_section_title')}
                </div>
                <div>
                  <label htmlFor="order-reimb-ref" className="block text-[11px] font-bold text-slate-500 mb-1">
                    {t('deliveryReconciliation.cross_payout_ref_label')}
                  </label>
                  <input
                    id="order-reimb-ref"
                    name="reimbursement_payout_ref"
                    type="text"
                    value={reimbursementRefInput}
                    onChange={(e) => setReimbursementRefInput(e.target.value)}
                    placeholder={t('deliveryReconciliation.modal_reimb_ref_placeholder')}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="order-reimb-amt" className="block text-[11px] font-bold text-slate-500 mb-1">
                    {t('deliveryReconciliation.cross_payout_amount_label')}
                  </label>
                  <input
                    id="order-reimb-amt"
                    name="reimbursement_amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={reimbursementAmountInput}
                    onChange={(e) => setReimbursementAmountInput(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="order-reimb-date" className="block text-[11px] font-bold text-slate-500 mb-1">
                    {t('deliveryReconciliation.cross_payout_date_label')}
                  </label>
                  <input
                    id="order-reimb-date"
                    name="reimbursement_deposit_date"
                    type="date"
                    value={reimbursementDateInput}
                    onChange={(e) => setReimbursementDateInput(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="order-reimb-desc" className="block text-[11px] font-bold text-slate-500 mb-1">
                    {t('deliveryReconciliation.cross_payout_desc_label')}
                  </label>
                  <input
                    id="order-reimb-desc"
                    name="reimbursement_description"
                    type="text"
                    value={reimbursementDescInput}
                    onChange={(e) => setReimbursementDescInput(e.target.value)}
                    placeholder={t('deliveryReconciliation.modal_reimb_desc_placeholder')}
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
                id="order-dispute-notes"
                name="dispute_notes"
                aria-label={t('deliveryReconciliation.modal_dispute_notes_placeholder')}
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
            )}
          </div>
        </div>
      )}

      {/* MODAL IMPORTAR REPORTE CSV / JSON (P1 #10: CONFIRMACIÓN EXPLÍCITA DE SUCURSAL) */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-xl w-full p-6 space-y-4 shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="text-lg font-extrabold">{t('deliveryReconciliation.import_modal_title')}</h3>
              <button
                onClick={() => {
                  if (importing) return
                  setShowImportModal(false)
                  setImportText('')
                  setImportFileName('')
                  setImportPlatform('AUTO')
                  setConfirmImportStoreAssignment(false)
                  setBannerMessage(null)
                }}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {renderBannerAlert()}
            <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400">
              {t('deliveryReconciliation.import_modal_desc')}
            </p>

            <div>
              <label htmlFor="import-platform-select" className="block text-xs font-bold text-slate-500 mb-1">
                {t('deliveryReconciliation.import_select_platform')}
              </label>
              <select
                id="import-platform-select"
                name="import_platform"
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
              <label htmlFor="import-file-input" className="block text-xs font-bold text-slate-500 mb-1">
                {t('deliveryReconciliation.import_drop_file')}
              </label>
              <input
                id="import-file-input"
                name="import_file"
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
                  id="import-confirm-store"
                  name="confirm_import_store_assignment"
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
                onClick={() => {
                  if (importing) return
                  setShowImportModal(false)
                  setImportText('')
                  setImportFileName('')
                  setImportPlatform('AUTO')
                  setConfirmImportStoreAssignment(false)
                  setBannerMessage(null)
                }}
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
