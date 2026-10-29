/**
 * @module app/admin/conciliar-delivery/page
 * @description Interfaz ejecutiva del Módulo Conciliar Delivery Plataformas (Toast POS vs. DoorDash, Uber Eats y Grubhub).
 *
 * @businessRules
 * 1. Regla Fiscal de Impuestos sobre Ventas (Marketplace Sales Tax Rule):
 *    - **DoorDash y Grubhub**: Entregan el Sales Tax a Tacos Gavilan para declararlo al estado (Cuenta QuickBooks `24001`).
 *      Por lo tanto, `Total Bruto Esperado = Venta Neta Toast + Tax`.
 *    - **Uber Eats**: Retiene y paga el Sales Tax directamente al estado como Marketplace Facilitator (Cuenta `12050`).
 *      Por lo tanto, `Total Bruto Esperado = Venta Neta Toast (Subtotal sin Tax)`.
 * 2. Día Operativo: 6:00 AM a 5:59 AM del día siguiente (`America/Los_Angeles`).
 * 3. Conciliación en 5 vistas: Orden por Orden, Cortes Bancarios (`Deposits`), Disputas/Cargos por Error, Mapeo de las 15 Sucursales y **Pólizas QuickBooks (`Journal Entry`)**.
 * 4. Automatización de `Settlement Journal Entry` en QuickBooks Online (`/api/delivery-reconciliation/quickbooks-journal`), replicando la sesión OAuth 2.0 y creación individual/en lote de `Crear Bills`, con desglose de órdenes descontadas/reembolsadas (ej. `#650DD`) y recuperación opcional de `Sales Tax (Cuenta 24001)` en reembolsos de DoorDash y Grubhub.
 * 5. Soporte 100% bilingüe (ES/EN) mediante `useLanguage()` (`deliveryReconciliation.*`).
 *
 * @dataFlow
 * - Consume `GET /api/delivery-reconciliation` y ejecuta mutaciones mediante `POST /api/delivery-reconciliation`.
 *
 * @notes
 * - Incluye sincronización directa en vivo con Toast POS API + Grubhub Merchant Accounting API, e importador universal CSV/JSON para DoorDash y Uber Eats.
 */

'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
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
  DollarSign,
  Landmark,
  FileSpreadsheet,
  Store,
  Eye,
  Filter,
  Scale,
  Receipt,
  ArrowUpRight,
  Info,
  X,
} from 'lucide-react'

type DeliveryPlatform = 'DOORDASH' | 'UBER_EATS' | 'GRUBHUB'

interface ReconciledOrder {
  id: string
  store_id: number
  store_name: string
  store_code: string
  platform: DeliveryPlatform
  business_date: string
  placed_at: string | null
  platform_order_id: string
  platform_transaction_id: string
  payout_reference_id: string | null
  payout_date: string | null
  fulfillment_type: 'DELIVERY' | 'PICKUP'
  transaction_type: string
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
  tip_amount: number
  net_payout: number
  toast_order_guid: string | null
  toast_display_number: string | null
  toast_tab_name: string | null
  toast_opened_at: string | null
  toast_dining_option: string | null
  toast_net_sales: number
  toast_tax: number
  toast_expected_gross: number
  subtotal_diff: number
  tax_diff: number
  gross_diff: number
  reconciliation_status: string
  match_confidence: string
  is_disputed: boolean
  dispute_status: string
  dispute_reason: string | null
  dispute_amount: number
  dispute_notes: string | null
  packing_audit_id: string | null
  items_summary: Array<{ name: string; quantity: number; price: number }>
  raw_payload?: Record<string, any>
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
  doordash_store_id: string | null
  doordash_delivery_comm_pct: number
  doordash_pickup_comm_pct: number
  grubhub_cust_id: string | null
  grubhub_delivery_comm_pct: number
  grubhub_pickup_comm_pct: number
  ubereats_store_uuid: string | null
  ubereats_delivery_comm_pct: number
  ubereats_pickup_comm_pct: number
}

const fmtMoney = (val: number | null | undefined) => {
  const n = Number(val || 0)
  const sign = n < -0.004 ? '-' : ''
  return `${sign}$${Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

const fmtLaTimestamp = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return (
    d.toLocaleString('es-MX', {
      timeZone: 'America/Los_Angeles',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }) + ' PT'
  )
}

export default function ConciliarDeliveryPage() {
  const { t } = useLanguage()

  // Default range: last 5 days up to today
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date(Date.now() - 5 * 86400000)
    return d.toISOString().slice(0, 10)
  })
  const [endDate, setEndDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [selectedStore, setSelectedStore] = useState<string>('14') // Default Lynwood #14 for fast initial load, or ALL
  const [selectedPlatform, setSelectedPlatform] = useState<string>('ALL')
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL')
  const [quickFilter, setQuickFilter] = useState<'SETTLED' | 'DISPUTES' | 'MATCHED' | 'PENDING_TOAST' | 'ALL'>('SETTLED')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [activeTab, setActiveTab] = useState<'orders' | 'payouts' | 'disputes' | 'mappings' | 'qb_journals'>('orders')

  const [loading, setLoading] = useState<boolean>(true)
  const [syncing, setSyncing] = useState<boolean>(false)
  const [bannerMessage, setBannerMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [mappings, setMappings] = useState<StoreMapping[]>([])
  const [orders, setOrders] = useState<ReconciledOrder[]>([])
  const [payouts, setPayouts] = useState<PlatformPayout[]>([])
  const [summary, setSummary] = useState<any>(null)
  const [syncStatus, setSyncStatus] = useState<any>(null)

  // Estado para Pestaña 5: Pólizas QuickBooks (Settlement Journal Entries)
  const [qbRecords, setQbRecords] = useState<any[]>([])
  const [qbSummary, setQbSummary] = useState<any>(null)
  const [qbLoading, setQbLoading] = useState<boolean>(false)
  const [qbAuthError, setQbAuthError] = useState<boolean>(false)
  const [qbReauthUrl, setQbReauthUrl] = useState<string>('/api/integrations/quickbooks/auth')
  const [qbNextDocNumber, setQbNextDocNumber] = useState<string>('20261053')
  const [qbQuickFilter, setQbQuickFilter] = useState<'ALL' | 'PENDING' | 'CREATED'>('ALL')
  const [selectedQbPayoutIds, setSelectedQbPayoutIds] = useState<Set<string>>(new Set())
  const [publishingQb, setPublishingQb] = useState<boolean>(false)
  const [selectedQbRecord, setSelectedQbRecord] = useState<any | null>(null)
  const [jeModalDate, setJeModalDate] = useState<string>('')
  const [jeModalDocNumber, setJeModalDocNumber] = useState<string>('')
  const [jeModalSplitTax, setJeModalSplitTax] = useState<boolean>(false)

  // Modal de detalle de orden y disputa
  const [selectedOrder, setSelectedOrder] = useState<ReconciledOrder | null>(null)
  const [disputeStatusInput, setDisputeStatusInput] = useState<string>('NONE')
  const [disputeNotesInput, setDisputeNotesInput] = useState<string>('')
  const [reimbursementRefInput, setReimbursementRefInput] = useState<string>('')
  const [reimbursementAmountInput, setReimbursementAmountInput] = useState<string>('')
  const [reimbursementDateInput, setReimbursementDateInput] = useState<string>('')
  const [reimbursementDescInput, setReimbursementDescInput] = useState<string>('')
  const [savingDispute, setSavingDispute] = useState<boolean>(false)

  // Modal de importación CSV / JSON
  const [showImportModal, setShowImportModal] = useState<boolean>(false)
  const [importPlatform, setImportPlatform] = useState<'AUTO' | DeliveryPlatform>('AUTO')
  const [importText, setImportText] = useState<string>('')
  const [importFileName, setImportFileName] = useState<string>('')
  const [importing, setImporting] = useState<boolean>(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({
        store_id: selectedStore,
        platform: selectedPlatform,
        status: selectedStatus,
        start_date: startDate,
        end_date: endDate,
        search: searchQuery,
      })
      const res = await fetch(`/api/delivery-reconciliation?${qs.toString()}`)
      const data = await res.json()
      if (data.success) {
        setMappings(data.mappings || [])
        setOrders(data.orders || [])
        setPayouts(data.payouts || [])
        setSummary(data.summary || null)
        setSyncStatus(data.syncStatus || null)
      }
    } catch (err: any) {
      console.error('Error loading delivery reconciliation:', err)
    } finally {
      setLoading(false)
    }
  }, [selectedStore, selectedPlatform, selectedStatus, startDate, endDate, searchQuery])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const fetchQbJournalRecords = useCallback(async () => {
    setQbLoading(true)
    try {
      const qs = new URLSearchParams({
        store_id: selectedStore,
        platform: selectedPlatform,
        status: selectedStatus,
        start_date: startDate,
        end_date: endDate,
      })
      if (searchQuery.trim()) qs.set('search', searchQuery.trim())
      const res = await fetch(`/api/delivery-reconciliation/quickbooks-journal?${qs.toString()}`)
      const data = await res.json()
      if (data.success) {
        setQbRecords(data.records || [])
        setQbSummary(data.summary || null)
        setQbAuthError(Boolean(data.isAuthError))
        if (data.reauthUrl) setQbReauthUrl(data.reauthUrl)
        if (data.nextSuggestedDocNumber) setQbNextDocNumber(data.nextSuggestedDocNumber)
      }
    } catch (err: any) {
      console.error('Error loading QB Journal Entries:', err)
    } finally {
      setQbLoading(false)
    }
  }, [selectedStore, selectedPlatform, selectedStatus, startDate, endDate, searchQuery])

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
  }

  const handlePublishQbJournalEntries = async (
    payoutIdsToCreate: string[],
    options?: { txnDate?: string; docNumber?: string; splitTaxOnRefunds?: boolean }
  ) => {
    if (payoutIdsToCreate.length === 0) return
    setPublishingQb(true)
    setBannerMessage(null)
    try {
      const res = await fetch('/api/delivery-reconciliation/quickbooks-journal', {
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
      if (!data.success) {
        const firstErr = data.results?.find((r: any) => !r.success)?.error
        throw new Error(firstErr || data.error || 'Error al publicar Journal Entry en QuickBooks Online')
      }
      const createdList = (data.results || [])
        .filter((r: any) => r.success)
        .map((r: any) => `#${r.journalEntry?.docNumber} (${r.storeName} - ${r.platform})`)
        .join(', ')
      setBannerMessage({
        type: 'success',
        text: `✅ Journal Entry publicado exitosamente en QuickBooks Online: ${createdList}`,
      })
      setSelectedQbPayoutIds(new Set())
      setSelectedQbRecord(null)
      await fetchQbJournalRecords()
    } catch (err: any) {
      setBannerMessage({ type: 'error', text: err.message })
    } finally {
      setPublishingQb(false)
    }
  }

  const handleLiveSyncForStore = async (overrideStoreId?: string) => {
    const targetStore = overrideStoreId || selectedStore
    if (overrideStoreId) setSelectedStore(overrideStoreId)
    setSyncing(true)
    setBannerMessage(null)
    try {
      const res = await fetch('/api/delivery-reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'sync_live',
          store_id: targetStore,
          start_date: startDate,
          end_date: endDate,
          sync_toast: true,
          sync_grubhub: true,
        }),
      })
      const data = await res.json()
      if (!data.success) {
        throw new Error(data.error || 'Sync failed')
      }
      setBannerMessage({
        type: 'success',
        text: t('deliveryReconciliation.sync_success_msg', {
          toastCount: data.toastOrdersSynced || 0,
          ghOrders: data.platformOrdersSynced || 0,
          ghPayouts: data.payoutsSynced || 0,
        }),
      })
      await Promise.all([fetchData(), fetchQbJournalRecords()])
    } catch (err: any) {
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
      const res = await fetch('/api/delivery-reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'import_report',
          raw_content: importText,
          platform: importPlatform,
          store_id: selectedStore,
          start_date: startDate,
          end_date: endDate,
          sync_toast: true,
        }),
      })
      const data = await res.json()
      if (!data.success) {
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
      await Promise.all([fetchData(), fetchQbJournalRecords()])
    } catch (err: any) {
      setBannerMessage({ type: 'error', text: err.message })
    } finally {
      setImporting(false)
    }
  }

  const handleOpenOrderModal = (ord: ReconciledOrder) => {
    setSelectedOrder(ord)
    setDisputeStatusInput(ord.dispute_status || 'NONE')
    setDisputeNotesInput(ord.dispute_notes || '')
    setReimbursementRefInput(ord.raw_payload?.reimbursement_payout_ref || '')
    setReimbursementAmountInput(
      ord.raw_payload?.reimbursement_amount !== undefined && ord.raw_payload?.reimbursement_amount !== null
        ? String(ord.raw_payload.reimbursement_amount)
        : ''
    )
    setReimbursementDateInput(ord.raw_payload?.reimbursement_deposit_date || '')
    setReimbursementDescInput(ord.raw_payload?.reimbursement_description || '')
  }

  const handleSaveDispute = async () => {
    if (!selectedOrder) return
    setSavingDispute(true)
    try {
      const res = await fetch('/api/delivery-reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_dispute',
          id: selectedOrder.id,
          dispute_status: disputeStatusInput,
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
      if (data.success) {
        setSelectedOrder(null)
        await fetchData()
      }
    } finally {
      setSavingDispute(false)
    }
  }

  const handleExportCsv = () => {
    if (orders.length === 0) return
    const headers = [
      'Business Date',
      'Store',
      'Platform',
      'Fulfillment',
      'Platform Order ID',
      'Toast Order #',
      'Toast Tab Name',
      'Toast Net Sales',
      'Toast Tax',
      'Toast Expected Gross',
      'Platform Subtotal',
      'Platform Tax Total',
      'Platform Tax Passed to TEG',
      'Platform Tax Withheld (Uber)',
      'Platform Gross Receivable',
      'Commission Fee',
      'Delivery Fee',
      'Processing Fee',
      'Marketing Fee',
      'Error Charge',
      'Adjustment',
      'Net Payout',
      'Gross Variance',
      'Reconciliation Status',
      'Dispute Status',
      'Payout Reference ID',
      'Payout Date',
    ]
    const csvLines = [
      headers.join(','),
      ...orders.map((o) =>
        [
          o.business_date,
          `"${o.store_name}"`,
          o.platform,
          o.fulfillment_type,
          `"${o.platform_order_id}"`,
          `"${o.toast_display_number || ''}"`,
          `"${(o.toast_tab_name || '').replace(/"/g, '""')}"`,
          Number(o.toast_net_sales || 0).toFixed(2),
          Number(o.toast_tax || 0).toFixed(2),
          Number(o.toast_expected_gross || 0).toFixed(2),
          Number(o.platform_subtotal || 0).toFixed(2),
          Number(o.platform_tax || 0).toFixed(2),
          Number(o.platform_tax_paid_to_merchant || 0).toFixed(2),
          Number(o.platform_tax_withheld || 0).toFixed(2),
          Number(o.platform_gross_receivable || 0).toFixed(2),
          Number(o.commission_fee || 0).toFixed(2),
          Number(o.delivery_fee || 0).toFixed(2),
          Number(o.processing_fee || 0).toFixed(2),
          Number(o.marketing_fee || 0).toFixed(2),
          Number(o.error_charge || 0).toFixed(2),
          Number(o.adjustment_amount || 0).toFixed(2),
          Number(o.net_payout || 0).toFixed(2),
          Number(o.gross_diff || 0).toFixed(2),
          o.reconciliation_status,
          o.dispute_status,
          `"${o.payout_reference_id || ''}"`,
          o.payout_date || '',
        ].join(',')
      ),
    ]
    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `conciliacion_delivery_${startDate}_${endDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const disputedOrders = useMemo(
    () =>
      orders.filter(
        (o) =>
          o.is_disputed ||
          o.reconciliation_status === 'REFUNDED_OR_DISPUTED' ||
          o.reconciliation_status === 'AMOUNT_MISMATCH' ||
          o.reconciliation_status === 'TAX_MISMATCH' ||
          Number(o.error_charge || 0) < -0.01
      ),
    [orders]
  )

  const settledOrders = useMemo(
    () =>
      orders.filter(
        (o) => o.match_confidence !== 'TOAST_ONLY' && o.reconciliation_status !== 'MISSING_IN_PLATFORM'
      ),
    [orders]
  )

  const matchedOrdersList = useMemo(
    () => orders.filter((o) => o.reconciliation_status === 'MATCHED'),
    [orders]
  )

  const pendingToastOrders = useMemo(
    () =>
      orders.filter(
        (o) => o.match_confidence === 'TOAST_ONLY' || o.reconciliation_status === 'MISSING_IN_PLATFORM'
      ),
    [orders]
  )

  const displayedOrders = useMemo(() => {
    if (quickFilter === 'SETTLED') return settledOrders
    if (quickFilter === 'DISPUTES') return disputedOrders
    if (quickFilter === 'MATCHED') return matchedOrdersList
    if (quickFilter === 'PENDING_TOAST') return pendingToastOrders
    return orders
  }, [orders, quickFilter, settledOrders, disputedOrders, matchedOrdersList, pendingToastOrders])

  const displayedQbRecords = useMemo(() => {
    if (qbQuickFilter === 'PENDING') return qbRecords.filter((r) => !r.hasJournalEntry)
    if (qbQuickFilter === 'CREATED') return qbRecords.filter((r) => r.hasJournalEntry)
    return qbRecords
  }, [qbRecords, qbQuickFilter])

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

  const renderStatusBadge = (status: string) => {
    const label = t(`deliveryReconciliation.status_${status}`) || status
    if (status === 'MATCHED') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
          <CheckCircle2 className="w-3.5 h-3.5" />
          {label}
        </span>
      )
    }
    if (status === 'REFUNDED_OR_DISPUTED' || status === 'CANCELLED_UNPAID') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30">
          <XCircle className="w-3.5 h-3.5" />
          {label}
        </span>
      )
    }
    if (status === 'AMOUNT_MISMATCH' || status === 'TAX_MISMATCH') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
          <AlertTriangle className="w-3.5 h-3.5" />
          {label}
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-500/15 text-slate-600 dark:text-slate-300 border border-slate-500/30">
        <Info className="w-3.5 h-3.5" />
        {label}
      </span>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-3 md:p-5 space-y-4">
      {/* HEADER COMPACTO EJECUTIVO */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 text-[11px] font-bold tracking-wider">
              <Scale className="w-3 h-3" />
              {t('deliveryReconciliation.badge')}
            </span>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-orange-500/10 text-orange-700 dark:text-orange-300 border border-orange-500/20">
              DD + GH: Tax a TEG (Cta 24001)
            </span>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20">
              Uber Eats: Uber paga Tax (Cta 12050)
            </span>
          </div>
          <h1 className="text-xl md:text-2xl font-extrabold tracking-tight">
            {t('deliveryReconciliation.title')}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleLiveSync}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-bold text-xs md:text-sm shadow-sm transition"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? t('deliveryReconciliation.syncing_btn') : t('deliveryReconciliation.sync_live_btn')}
          </button>

          <button
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-xs md:text-sm border border-slate-200 dark:border-slate-700 transition"
          >
            <Download className="w-4 h-4" />
            {t('deliveryReconciliation.export_csv_btn')}
          </button>
        </div>
      </div>

      {/* BARRA COMPACTA DE FILTROS + ESTADO DE SINCRONIZACIÓN */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5 shadow-sm space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
              {t('deliveryReconciliation.store_filter')}
            </label>
            <select
              value={selectedStore}
              onChange={(e) => setSelectedStore(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs md:text-sm font-semibold"
            >
              <option value="ALL">{t('deliveryReconciliation.all_stores')}</option>
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
              {t('deliveryReconciliation.platform_filter')}
            </label>
            <select
              value={selectedPlatform}
              onChange={(e) => setSelectedPlatform(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs md:text-sm font-semibold"
            >
              <option value="ALL">{t('deliveryReconciliation.all_platforms')}</option>
              <option value="DOORDASH">DoorDash</option>
              <option value="UBER_EATS">Uber Eats</option>
              <option value="GRUBHUB">Grubhub</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
              {t('deliveryReconciliation.status_filter')}
            </label>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs md:text-sm font-semibold"
            >
              <option value="ALL">{t('deliveryReconciliation.all_statuses')}</option>
              <option value="MATCHED">{t('deliveryReconciliation.status_MATCHED')}</option>
              <option value="AMOUNT_MISMATCH">{t('deliveryReconciliation.status_AMOUNT_MISMATCH')}</option>
              <option value="TAX_MISMATCH">{t('deliveryReconciliation.status_TAX_MISMATCH')}</option>
              <option value="REFUNDED_OR_DISPUTED">{t('deliveryReconciliation.status_REFUNDED_OR_DISPUTED')}</option>
              <option value="MISSING_IN_PLATFORM">{t('deliveryReconciliation.status_MISSING_IN_PLATFORM')}</option>
              <option value="MISSING_IN_TOAST">{t('deliveryReconciliation.status_MISSING_IN_TOAST')}</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
              {t('deliveryReconciliation.start_date')}
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs md:text-sm font-semibold"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
              {t('deliveryReconciliation.end_date')}
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs md:text-sm font-semibold"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
              {t('common.search')}
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('deliveryReconciliation.search_placeholder')}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pl-8 pr-2.5 py-1.5 text-xs md:text-sm"
              />
            </div>
          </div>
        </div>

        {/* CINTA COMPACTA DE ÚLTIMA SINCRONIZACIÓN */}
        {syncStatus && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px]">
            <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800">
              <span className="font-bold flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                Toast POS:
              </span>
              <span className="font-mono text-slate-600 dark:text-slate-300">
                {fmtLaTimestamp(syncStatus.TOAST?.lastSyncedAt || syncStatus.TOAST?.globalLastSyncedAt)} (
                {syncStatus.TOAST?.ordersCount || syncStatus.TOAST?.globalOrdersCount || 0} órd.)
              </span>
            </div>

            <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-red-500/5 border border-red-500/20">
              <span className="font-bold text-red-600 dark:text-red-400 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                DoorDash:
              </span>
              <span className="font-mono text-slate-600 dark:text-slate-300">
                {fmtLaTimestamp(syncStatus.DOORDASH?.lastSyncedAt || syncStatus.DOORDASH?.globalLastSyncedAt)} (
                {syncStatus.DOORDASH?.ordersCount ?? syncStatus.DOORDASH?.globalOrdersCount ?? 0} órd.)
              </span>
            </div>

            <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
              <span className="font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                Uber Eats:
              </span>
              <span className="font-mono text-slate-600 dark:text-slate-300">
                {fmtLaTimestamp(syncStatus.UBER_EATS?.lastSyncedAt || syncStatus.UBER_EATS?.globalLastSyncedAt)} (
                {syncStatus.UBER_EATS?.ordersCount || syncStatus.UBER_EATS?.globalOrdersCount || 0} órd.)
              </span>
            </div>

            <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-orange-500/5 border border-orange-500/20">
              <span className="font-bold text-orange-600 dark:text-orange-400 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                Grubhub:
              </span>
              <span className="font-mono text-slate-600 dark:text-slate-300">
                {fmtLaTimestamp(syncStatus.GRUBHUB?.lastSyncedAt || syncStatus.GRUBHUB?.globalLastSyncedAt)} (
                {syncStatus.GRUBHUB?.ordersCount ?? syncStatus.GRUBHUB?.globalOrdersCount ?? 0} órd.)
              </span>
            </div>
          </div>
        )}
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

      {/* 3 TARJETAS COMPARATIVAS POR PLATAFORMA (DOORDASH | UBER EATS | GRUBHUB) */}
      {summary?.byPlatform && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {(['DOORDASH', 'UBER_EATS', 'GRUBHUB'] as DeliveryPlatform[]).map((plat) => {
            const pData = summary.byPlatform[plat] || {}
            const isSelected = selectedPlatform === plat
            const isUber = plat === 'UBER_EATS'
            const borderClass =
              plat === 'DOORDASH'
                ? 'border-red-500/30 bg-red-500/[0.03]'
                : plat === 'UBER_EATS'
                ? 'border-emerald-500/30 bg-emerald-500/[0.03]'
                : 'border-orange-500/30 bg-orange-500/[0.03]'

            return (
              <div
                key={plat}
                onClick={() => setSelectedPlatform(isSelected ? 'ALL' : plat)}
                className={`cursor-pointer rounded-2xl border p-3.5 transition shadow-sm ${borderClass} ${
                  isSelected ? 'ring-2 ring-indigo-500' : 'hover:border-slate-400'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {renderPlatformBadge(plat)}
                    <span className="text-xs font-bold text-slate-500">
                      {pData.settledOrdersCount || 0} conciliadas
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] font-bold">
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                      ✓ {pData.matchedCount || 0} OK
                    </span>
                    {(pData.disputedCount || 0) > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400">
                        ⚠ {pData.disputedCount} disp.
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 bg-white/80 dark:bg-slate-900/80 rounded-xl p-2.5 border border-slate-200/70 dark:border-slate-800 text-xs">
                  <div>
                    <div className="text-[10px] text-slate-400 uppercase font-bold">
                      {t('deliveryReconciliation.plat_card_toast_expected')}
                    </div>
                    <div className="text-base font-extrabold font-mono text-slate-900 dark:text-white">
                      {fmtMoney(pData.settledToastExpected || 0)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-slate-400 uppercase font-bold">
                      {t('deliveryReconciliation.plat_card_plat_recognized')}
                    </div>
                    <div className="text-base font-extrabold font-mono text-indigo-600 dark:text-indigo-400">
                      {fmtMoney(pData.platformGross || 0)}
                    </div>
                  </div>
                </div>

                <div className="mt-2 space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">
                      {isUber
                        ? t('deliveryReconciliation.plat_card_tax_withheld')
                        : t('deliveryReconciliation.plat_card_tax_passed')}
                    </span>
                    <span className="font-mono font-bold">
                      {isUber
                        ? `${fmtMoney(pData.platformTaxWithheld || 0)} ($0 a TEG)`
                        : fmtMoney(pData.platformTaxToMerchant || 0)}
                    </span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-slate-500">
                      {t('deliveryReconciliation.plat_card_fees_errors')}
                    </span>
                    <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">
                      {fmtMoney(pData.totalFees || 0)} /{' '}
                      <span className="text-rose-600 dark:text-rose-400">
                        {fmtMoney(pData.errorCharges || 0)}
                      </span>
                    </span>
                  </div>

                  <div className="flex justify-between pt-1 border-t border-slate-200/60 dark:border-slate-800 font-bold">
                    <span className="text-emerald-700 dark:text-emerald-400">
                      {t('deliveryReconciliation.plat_card_net_payout')}
                    </span>
                    <span className="font-mono text-emerald-600 dark:text-emerald-400">
                      {fmtMoney(pData.netPayout || 0)} ({pData.payoutsCount || 0} cortes)
                    </span>
                  </div>

                  {(pData.pendingToastCount || 0) > 0 && (
                    <div className="flex justify-between text-[11px] text-slate-400 pt-0.5">
                      <span>⏳ {t('deliveryReconciliation.plat_card_pending_toast')}</span>
                      <span className="font-mono">
                        {pData.pendingToastCount} órd. ({fmtMoney(pData.pendingToastGross || 0)})
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* TABS NAVIGATION + PÍLDORAS DE FILTRO RÁPIDO */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setActiveTab('orders')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs md:text-sm font-bold transition ${
              activeTab === 'orders'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
            }`}
          >
            <Receipt className="w-4 h-4" />
            {t('deliveryReconciliation.tab_orders')} ({displayedOrders.length})
          </button>

          <button
            onClick={() => setActiveTab('payouts')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs md:text-sm font-bold transition ${
              activeTab === 'payouts'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
            }`}
          >
            <Landmark className="w-4 h-4" />
            {t('deliveryReconciliation.tab_payouts')} ({payouts.length})
          </button>

          <button
            onClick={() => setActiveTab('disputes')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs md:text-sm font-bold transition ${
              activeTab === 'disputes'
                ? 'bg-rose-600 text-white shadow-sm'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
            }`}
          >
            <AlertTriangle className="w-4 h-4" />
            {t('deliveryReconciliation.tab_disputes')} ({disputedOrders.length})
          </button>

          <button
            onClick={() => setActiveTab('mappings')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs md:text-sm font-bold transition ${
              activeTab === 'mappings'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
            }`}
          >
            <Store className="w-4 h-4" />
            {t('deliveryReconciliation.tab_mappings')} ({mappings.length})
          </button>

          <button
            onClick={() => setActiveTab('qb_journals')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs md:text-sm font-bold transition ${
              activeTab === 'qb_journals'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-slate-800 border border-emerald-500/30'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            {t('deliveryReconciliation.tab_qb_journals')} ({qbRecords.length})
            {(qbSummary?.pendingCount || 0) > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-500 text-white">
                {qbSummary.pendingCount} pend.
              </span>
            )}
          </button>
        </div>

        {/* BOTONES DE DIAGNÓSTICO RÁPIDO (SOLO EN TAB DE ÓRDENES) */}
        {activeTab === 'orders' && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setQuickFilter('SETTLED')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border ${
                quickFilter === 'SETTLED'
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
              }`}
            >
              🔍 {t('deliveryReconciliation.quick_filter_settled')} ({settledOrders.length})
            </button>

            <button
              onClick={() => setQuickFilter('DISPUTES')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border ${
                quickFilter === 'DISPUTES'
                  ? 'bg-rose-600 text-white border-rose-600'
                  : 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 border-rose-500/30'
              }`}
            >
              🚨 {t('deliveryReconciliation.quick_filter_disputes')} ({disputedOrders.length})
            </button>

            <button
              onClick={() => setQuickFilter('MATCHED')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border ${
                quickFilter === 'MATCHED'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
              }`}
            >
              ✅ {t('deliveryReconciliation.quick_filter_matched')} ({matchedOrdersList.length})
            </button>

            <button
              onClick={() => setQuickFilter('PENDING_TOAST')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border ${
                quickFilter === 'PENDING_TOAST'
                  ? 'bg-amber-600 text-white border-amber-600'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
              }`}
            >
              ⏳ {t('deliveryReconciliation.quick_filter_pending_toast')} ({pendingToastOrders.length})
            </button>

            <button
              onClick={() => setQuickFilter('ALL')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border ${
                quickFilter === 'ALL'
                  ? 'bg-slate-800 text-white border-slate-800 dark:bg-slate-200 dark:text-slate-900'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
              }`}
            >
              📋 {t('deliveryReconciliation.quick_filter_all')} ({orders.length})
            </button>
          </div>
        )}

        {/* BOTONES DE FILTRO RÁPIDO (EN TAB DE PÓLIZAS QUICKBOOKS) */}
        {activeTab === 'qb_journals' && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setQbQuickFilter('ALL')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border ${
                qbQuickFilter === 'ALL'
                  ? 'bg-slate-800 text-white border-slate-800 dark:bg-slate-200 dark:text-slate-900'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
              }`}
            >
              📋 {t('deliveryReconciliation.quick_filter_all')} ({qbRecords.length})
            </button>

            <button
              onClick={() => setQbQuickFilter('PENDING')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border ${
                qbQuickFilter === 'PENDING'
                  ? 'bg-amber-600 text-white border-amber-600'
                  : 'bg-white dark:bg-slate-900 text-amber-600 dark:text-amber-400 border-amber-500/30'
              }`}
            >
              ⏳ {t('deliveryReconciliation.qb_status_pending')} ({qbSummary?.pendingCount || 0})
            </button>

            <button
              onClick={() => setQbQuickFilter('CREATED')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border ${
                qbQuickFilter === 'CREATED'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
              }`}
            >
              ✅ {t('deliveryReconciliation.qb_status_created')} ({qbSummary?.createdCount || 0})
            </button>
          </div>
        )}
      </div>

      {/* TAB 1: ORDEN POR ORDEN */}
      {activeTab === 'orders' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-slate-500">{t('deliveryReconciliation.syncing_btn')}</div>
          ) : displayedOrders.length === 0 ? (
            <div className="p-12 text-center text-slate-500">{t('deliveryReconciliation.empty_orders')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs md:text-sm">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800 font-bold">
                    <th className="p-3">{t('deliveryReconciliation.col_date')}</th>
                    <th className="p-3">{t('deliveryReconciliation.col_store')}</th>
                    <th className="p-3">{t('deliveryReconciliation.col_platform')}</th>
                    <th className="p-3">{t('deliveryReconciliation.col_order_id')}</th>
                    <th className="p-3 text-right">{t('deliveryReconciliation.col_toast_net')}</th>
                    <th className="p-3 text-right">{t('deliveryReconciliation.col_toast_tax')}</th>
                    <th className="p-3 text-right bg-slate-200/50 dark:bg-slate-800">
                      {t('deliveryReconciliation.col_toast_expected')}
                    </th>
                    <th className="p-3 text-right">{t('deliveryReconciliation.col_plat_subtotal')}</th>
                    <th className="p-3 text-right">{t('deliveryReconciliation.col_plat_tax_merchant')}</th>
                    <th className="p-3 text-right bg-indigo-500/10">
                      {t('deliveryReconciliation.col_plat_gross')}
                    </th>
                    <th className="p-3 text-right">{t('deliveryReconciliation.col_commission')}</th>
                    <th className="p-3 text-right">{t('deliveryReconciliation.col_fees')}</th>
                    <th className="p-3 text-right">{t('deliveryReconciliation.col_error_adj')}</th>
                    <th className="p-3 text-right font-extrabold text-emerald-700 dark:text-emerald-400">
                      {t('deliveryReconciliation.col_net_payout')}
                    </th>
                    <th className="p-3 text-right">{t('deliveryReconciliation.col_variance')}</th>
                    <th className="p-3">{t('deliveryReconciliation.col_status')}</th>
                    <th className="p-3 text-center">{t('deliveryReconciliation.col_actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {displayedOrders.map((ord) => {
                    const commDel = Number(ord.commission_fee || 0) + Number(ord.delivery_fee || 0)
                    const procMkt = Number(ord.processing_fee || 0) + Number(ord.marketing_fee || 0)
                    const errAdj = Number(ord.error_charge || 0) + Number(ord.adjustment_amount || 0)
                    const varAmt = Number(ord.gross_diff || 0)

                    return (
                      <tr
                        key={ord.id}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition"
                      >
                        <td className="p-3 whitespace-nowrap font-medium">{ord.business_date}</td>
                        <td className="p-3 whitespace-nowrap font-semibold">{ord.store_name}</td>
                        <td className="p-3 whitespace-nowrap">
                          <div className="flex flex-col gap-1">
                            {renderPlatformBadge(ord.platform)}
                            <span className="text-[11px] text-slate-400">
                              {ord.fulfillment_type === 'PICKUP'
                                ? t('deliveryReconciliation.fulfillment_pickup')
                                : t('deliveryReconciliation.fulfillment_delivery')}
                            </span>
                          </div>
                        </td>
                        <td className="p-3">
                          <div className="font-mono font-bold text-slate-900 dark:text-white">
                            {ord.platform_order_id}
                          </div>
                          {ord.toast_display_number && (
                            <div className="text-xs text-slate-500">
                              Toast #{ord.toast_display_number} • {ord.toast_tab_name}
                            </div>
                          )}
                          {ord.payout_reference_id && (
                            <div className="text-[11px] font-mono text-indigo-600 dark:text-indigo-400">
                              Corte: #{ord.payout_reference_id}
                            </div>
                          )}
                        </td>
                        <td className="p-3 text-right font-mono">{fmtMoney(ord.toast_net_sales)}</td>
                        <td className="p-3 text-right font-mono">
                          <div>{fmtMoney(ord.toast_tax)}</div>
                          {ord.platform === 'UBER_EATS' && ord.toast_tax > 0 && (
                            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 block">
                              (Uber Remits)
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-right font-mono font-bold bg-slate-100/60 dark:bg-slate-800/40">
                          {fmtMoney(ord.toast_expected_gross)}
                        </td>
                        <td className="p-3 text-right font-mono">{fmtMoney(ord.platform_subtotal)}</td>
                        <td className="p-3 text-right font-mono">{fmtMoney(ord.platform_tax_paid_to_merchant)}</td>
                        <td className="p-3 text-right font-mono font-bold bg-indigo-500/5 text-indigo-700 dark:text-indigo-300">
                          {fmtMoney(ord.platform_gross_receivable)}
                        </td>
                        <td className="p-3 text-right font-mono text-amber-600 dark:text-amber-400">
                          {fmtMoney(commDel)}
                        </td>
                        <td className="p-3 text-right font-mono text-amber-600 dark:text-amber-400">
                          {fmtMoney(procMkt)}
                        </td>
                        <td
                          className={`p-3 text-right font-mono font-semibold ${
                            errAdj < -0.01 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400'
                          }`}
                        >
                          <div>{fmtMoney(errAdj)}</div>
                          {ord.raw_payload?.reimbursement_payout_ref && (
                            <div className="mt-1">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                                ✅{' '}
                                {t('deliveryReconciliation.reimbursed_in_payout_badge', {
                                  ref: ord.raw_payload.reimbursement_payout_ref,
                                  amount: fmtMoney(ord.raw_payload.reimbursement_amount || ord.dispute_amount),
                                })}
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="p-3 text-right font-mono font-extrabold text-emerald-600 dark:text-emerald-400">
                          {fmtMoney(ord.net_payout)}
                        </td>
                        <td
                          className={`p-3 text-right font-mono font-bold ${
                            Math.abs(varAmt) <= 0.05
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {fmtMoney(varAmt)}
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          <div className="flex flex-col gap-1 items-start">
                            {renderStatusBadge(ord.reconciliation_status)}
                            {ord.raw_payload?.reimbursement_payout_ref && (
                              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
                                {t('deliveryReconciliation.reimbursed_in_payout_sub', {
                                  date: ord.raw_payload.reimbursement_deposit_date || '-',
                                  desc: ord.raw_payload.reimbursement_description || 'Goodwill Refund',
                                })}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-3 text-center">
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
            </div>
          )}
        </div>
      )}

      {/* TAB 2: CORTES Y DEPÓSITOS BANCARIOS */}
      {activeTab === 'payouts' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
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
                    <th className="p-3">{t('deliveryReconciliation.payout_bank')}</th>
                    <th className="p-3 text-right">{t('deliveryReconciliation.payout_orders')}</th>
                    <th className="p-3 text-right">{t('deliveryReconciliation.payout_gross')}</th>
                    <th className="p-3 text-right">{t('deliveryReconciliation.payout_fees_total')}</th>
                    <th className="p-3 text-right">{t('deliveryReconciliation.payout_errors_total')}</th>
                    <th className="p-3 text-right font-extrabold text-emerald-700 dark:text-emerald-400">
                      {t('deliveryReconciliation.payout_net_deposited')}
                    </th>
                    <th className="p-3 text-right">{t('deliveryReconciliation.payout_toast_expected')}</th>
                    <th className="p-3 text-right">{t('deliveryReconciliation.payout_variance')}</th>
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
                          setSearchQuery(p.payout_reference_id)
                          setQuickFilter('ALL')
                          setActiveTab('orders')
                        }}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer transition"
                      >
                        <td className="p-3 font-bold">{p.payout_date || '-'}</td>
                        <td className="p-3 font-semibold">{p.store_name}</td>
                        <td className="p-3">{renderPlatformBadge(p.platform)}</td>
                        <td className="p-3 font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">
                          {p.payout_reference_id}
                        </td>
                        <td className="p-3 text-xs text-slate-500">
                          {p.period_start} → {p.period_end}
                        </td>
                        <td className="p-3 font-mono text-xs">
                          {p.bank_account_last4 ? `•••• ${p.bank_account_last4}` : '-'}
                        </td>
                        <td className="p-3 text-right font-bold">{p.orders_count}</td>
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
                          <div>{fmtMoney(errTotal)}</div>
                          {Array.isArray(p.raw_payload?.cross_payout_refunds) &&
                            p.raw_payload.cross_payout_refunds.map((cr: any, idx: number) => (
                              <div
                                key={idx}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setSearchQuery(cr.orderCode || '')
                                  setQuickFilter('ALL')
                                  setActiveTab('orders')
                                }}
                                className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 cursor-pointer"
                                title={cr.description || ''}
                              >
                                🔄{' '}
                                {t('deliveryReconciliation.payout_includes_refund_badge', {
                                  order: cr.orderCode,
                                  amount: fmtMoney(cr.amount),
                                })}
                              </div>
                            ))}
                        </td>
                        <td className="p-3 text-right font-mono font-extrabold text-emerald-600 dark:text-emerald-400">
                          {fmtMoney(p.net_payout_amount)}
                        </td>
                        <td className="p-3 text-right font-mono">{fmtMoney(p.toast_expected_gross)}</td>
                        <td
                          className={`p-3 text-right font-mono font-bold ${
                            Math.abs(Number(p.gross_variance || 0)) <= 0.1
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {fmtMoney(p.gross_variance)}
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

      {/* TAB 3: DISPUTAS Y CARGOS POR ERROR */}
      {activeTab === 'disputes' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
          {disputedOrders.length === 0 ? (
            <div className="p-12 text-center text-emerald-600 dark:text-emerald-400 font-semibold">
              {t('deliveryReconciliation.empty_disputes')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs md:text-sm">
                <thead>
                  <tr className="bg-rose-500/10 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-800 font-bold">
                    <th className="p-3">{t('deliveryReconciliation.col_date')}</th>
                    <th className="p-3">{t('deliveryReconciliation.col_store')}</th>
                    <th className="p-3">{t('deliveryReconciliation.col_platform')}</th>
                    <th className="p-3">{t('deliveryReconciliation.col_order_id')}</th>
                    <th className="p-3 text-right">{t('deliveryReconciliation.col_toast_expected')}</th>
                    <th className="p-3 text-right">{t('deliveryReconciliation.col_plat_gross')}</th>
                    <th className="p-3 text-right">{t('deliveryReconciliation.col_error_adj')}</th>
                    <th className="p-3 text-right">{t('deliveryReconciliation.col_net_payout')}</th>
                    <th className="p-3">{t('deliveryReconciliation.col_status')}</th>
                    <th className="p-3">{t('deliveryReconciliation.modal_update_dispute')}</th>
                    <th className="p-3 text-center">{t('deliveryReconciliation.col_actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {disputedOrders.map((ord) => (
                    <tr key={ord.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="p-3 font-medium">{ord.business_date}</td>
                      <td className="p-3 font-semibold">{ord.store_name}</td>
                      <td className="p-3">{renderPlatformBadge(ord.platform)}</td>
                      <td className="p-3 font-mono font-bold">
                        {ord.platform_order_id}
                        {ord.toast_display_number && (
                          <span className="block text-xs font-normal text-slate-500">
                            Toast #{ord.toast_display_number} ({ord.toast_tab_name})
                          </span>
                        )}
                        {ord.payout_reference_id && (
                          <span className="block text-[11px] font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                            Corte descuento: #{ord.payout_reference_id}
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-right font-mono font-bold">{fmtMoney(ord.toast_expected_gross)}</td>
                      <td className="p-3 text-right font-mono">{fmtMoney(ord.platform_gross_receivable)}</td>
                      <td className="p-3 text-right font-mono font-bold text-rose-600 dark:text-rose-400">
                        <div>{fmtMoney(Number(ord.error_charge || 0) + Number(ord.adjustment_amount || 0))}</div>
                        {ord.raw_payload?.reimbursement_payout_ref && (
                          <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                            +{fmtMoney(ord.raw_payload.reimbursement_amount || ord.dispute_amount)} en #
                            {ord.raw_payload.reimbursement_payout_ref}
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-right font-mono font-bold">{fmtMoney(ord.net_payout)}</td>
                      <td className="p-3">{renderStatusBadge(ord.reconciliation_status)}</td>
                      <td className="p-3">
                        <div className="flex flex-col gap-1 items-start">
                          <span
                            className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                              ord.dispute_status === 'APPROVED'
                                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                                : ord.dispute_status === 'DENIED'
                                ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30'
                                : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                            }`}
                          >
                            {t(`deliveryReconciliation.dispute_${ord.dispute_status}`) || ord.dispute_status}
                          </span>
                          {ord.raw_payload?.reimbursement_payout_ref && (
                            <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                              ✅{' '}
                              {t('deliveryReconciliation.reimbursed_in_payout_badge', {
                                ref: ord.raw_payload.reimbursement_payout_ref,
                                amount: fmtMoney(ord.raw_payload.reimbursement_amount || ord.dispute_amount),
                              })}
                              <span className="block text-[10px] font-normal text-slate-500">
                                {t('deliveryReconciliation.reimbursed_in_payout_sub', {
                                  date: ord.raw_payload.reimbursement_deposit_date || '-',
                                  desc: ord.raw_payload.reimbursement_description || '',
                                })}
                              </span>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => handleOpenOrderModal(ord)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          {t('deliveryReconciliation.view_items_btn')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: MAPEO DE LAS 15 SUCURSALES */}
      {activeTab === 'mappings' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs md:text-sm">
              <thead>
                <tr className="bg-slate-100 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800 font-bold">
                  <th className="p-3">{t('deliveryReconciliation.col_store')}</th>
                  <th className="p-3">Toast Restaurant GUID</th>
                  <th className="p-3">DoorDash Store ID</th>
                  <th className="p-3">Grubhub Cust ID</th>
                  <th className="p-3">Uber Eats Store UUID</th>
                  <th className="p-3">{t('deliveryReconciliation.col_last_sync')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {[...mappings]
                  .sort((a, b) => a.store_name.localeCompare(b.store_name, 'es'))
                  .map((m) => {
                    const stSync = syncStatus?.byStore?.[m.store_id]
                    const hasOrdersSynced =
                      (stSync?.toastOrders || 0) > 0 &&
                      ((stSync?.ddOrders || 0) > 0 || (stSync?.ghOrders || 0) > 0 || (stSync?.ueOrders || 0) > 0)
                    return (
                      <tr key={m.store_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="p-3 font-bold">
                          {m.store_name}{' '}
                          <span className="text-xs text-slate-400 font-normal">({m.store_code})</span>
                        </td>
                      <td className="p-3 font-mono text-xs text-slate-500">
                        <div>{m.toast_restaurant_guid}</div>
                        {stSync?.toastLastSync && (
                          <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold mt-0.5">
                            Toast: {fmtLaTimestamp(stSync.toastLastSync)} ({stSync.toastOrders} órd.)
                          </div>
                        )}
                      </td>
                      <td className="p-3 font-mono text-xs">
                        <div className="font-bold text-red-600 dark:text-red-400">
                          {m.doordash_store_id || '-'}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {stSync?.ddLastSync
                            ? `${fmtLaTimestamp(stSync.ddLastSync)} (${stSync.ddOrders} órd / ${stSync.ddPayouts} cortes)`
                            : '—'}
                        </div>
                      </td>
                      <td className="p-3 font-mono text-xs">
                        <div className="font-bold text-orange-600 dark:text-orange-400">
                          {m.grubhub_cust_id || '-'}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {stSync?.ghLastSync
                            ? `${fmtLaTimestamp(stSync.ghLastSync)} (${stSync.ghOrders} órd / ${stSync.ghPayouts} cortes)`
                            : '—'}
                        </div>
                      </td>
                      <td className="p-3 font-mono text-xs">
                        <div className="font-bold text-emerald-600 dark:text-emerald-400">
                          {m.ubereats_store_uuid || '-'}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {stSync?.ueLastSync
                            ? `${fmtLaTimestamp(stSync.ueLastSync)} (${stSync.ueOrders} órd / ${stSync.uePayouts} cortes)`
                            : '—'}
                        </div>
                      </td>
                      <td className="p-3 text-xs">
                        <div className="flex items-center gap-2">
                          {hasOrdersSynced ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {t('deliveryReconciliation.store_sync_active')}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                              {t('deliveryReconciliation.store_sync_pending')}
                            </span>
                          )}
                          <button
                            onClick={() => {
                              setActiveTab('orders')
                              handleLiveSyncForStore(String(m.store_id))
                            }}
                            disabled={syncing}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold transition"
                          >
                            <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
                            {t('deliveryReconciliation.sync_this_store_btn')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 5: PÓLIZAS QUICKBOOKS (SETTLEMENT JOURNAL ENTRIES) */}
      {activeTab === 'qb_journals' && (
        <div className="space-y-4">
          {/* BARRA SUPERIOR DE CONEXIÓN QUICKBOOKS ONLINE Y CREACIÓN EN LOTE */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 shadow-sm">
            <div className="flex flex-wrap items-center gap-2.5">
              {qbAuthError ? (
                <div className="flex flex-wrap items-center gap-2 bg-rose-500/10 border border-rose-500/30 px-3.5 py-2 rounded-xl">
                  <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                  <span className="text-xs font-bold text-rose-700 dark:text-rose-300">
                    Sesión de QuickBooks Online expirada
                  </span>
                  <button
                    onClick={handleQuickBooksReauth}
                    className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-extrabold transition"
                  >
                    {t('deliveryReconciliation.qb_reconnect_btn')}
                  </button>
                </div>
              ) : (
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs font-bold">
                  <CheckCircle2 className="w-4 h-4" />
                  {t('deliveryReconciliation.qb_connected_badge')} (Tacos Gavilan LLC)
                </div>
              )}

              <button
                onClick={handleQuickBooksReauth}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold transition"
              >
                🔗 {t('deliveryReconciliation.qb_reconnect_btn')}
              </button>

              <button
                onClick={fetchQbJournalRecords}
                disabled={qbLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold transition"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${qbLoading ? 'animate-spin' : ''}`} />
                {t('deliveryReconciliation.qb_refresh_btn')}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {selectedQbPayoutIds.size > 0 && (
                <button
                  onClick={() => handlePublishQbJournalEntries(Array.from(selectedQbPayoutIds))}
                  disabled={publishingQb}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs md:text-sm font-extrabold shadow-sm transition"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  {publishingQb
                    ? t('deliveryReconciliation.qb_creating_btn')
                    : t('deliveryReconciliation.qb_batch_create_btn', { count: selectedQbPayoutIds.size })}
                </button>
              )}
            </div>
          </div>

          {/* 4 TARJETAS KPI DE PÓLIZAS QUICKBOOKS E IMPUESTOS (CLICABLES COMO FILTRO) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div
              onClick={() => setQbQuickFilter('ALL')}
              className={`cursor-pointer bg-white dark:bg-slate-900 border rounded-2xl p-4 shadow-sm transition ${
                qbQuickFilter === 'ALL'
                  ? 'border-indigo-500 ring-2 ring-indigo-500/20'
                  : 'border-slate-200 dark:border-slate-800 hover:border-indigo-400'
              }`}
            >
              <div className="text-[11px] font-bold uppercase text-slate-400">
                {t('deliveryReconciliation.qb_kpi_total_cuts')}
              </div>
              <div className="text-2xl font-extrabold font-mono mt-1">{qbSummary?.totalCount || 0}</div>
              <div className="text-xs text-slate-500 mt-1">
                Depósito Neto Total: <span className="font-mono font-bold">{fmtMoney(qbSummary?.totalNetPayout)}</span>
              </div>
            </div>

            <div
              onClick={() => setQbQuickFilter(qbQuickFilter === 'PENDING' ? 'ALL' : 'PENDING')}
              className={`cursor-pointer bg-white dark:bg-slate-900 border rounded-2xl p-4 shadow-sm transition ${
                qbQuickFilter === 'PENDING'
                  ? 'border-amber-500 ring-2 ring-amber-500/25'
                  : 'border-amber-500/30 hover:border-amber-500'
              }`}
            >
              <div className="text-[11px] font-bold uppercase text-amber-600 dark:text-amber-400">
                {t('deliveryReconciliation.qb_kpi_pending_je')}
              </div>
              <div className="text-2xl font-extrabold font-mono text-amber-600 dark:text-amber-400 mt-1">
                {qbSummary?.pendingCount || 0}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Por contabilizar: <span className="font-mono font-bold">{fmtMoney(qbSummary?.pendingNetPayout)}</span>
              </div>
            </div>

            <div
              onClick={() => setQbQuickFilter(qbQuickFilter === 'CREATED' ? 'ALL' : 'CREATED')}
              className={`cursor-pointer bg-white dark:bg-slate-900 border rounded-2xl p-4 shadow-sm transition ${
                qbQuickFilter === 'CREATED'
                  ? 'border-emerald-500 ring-2 ring-emerald-500/25'
                  : 'border-emerald-500/30 hover:border-emerald-500'
              }`}
            >
              <div className="text-[11px] font-bold uppercase text-emerald-600 dark:text-emerald-400">
                {t('deliveryReconciliation.qb_kpi_created_je')}
              </div>
              <div className="text-2xl font-extrabold font-mono text-emerald-600 dark:text-emerald-400 mt-1">
                {qbSummary?.createdCount || 0}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Siguiente Folio Sugerido: <span className="font-mono font-bold">#{qbNextDocNumber}</span>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-rose-500/30 rounded-2xl p-4 shadow-sm">
              <div className="text-[11px] font-bold uppercase text-rose-600 dark:text-rose-400">
                {t('deliveryReconciliation.qb_kpi_at_risk_tax')}
              </div>
              <div className="text-2xl font-extrabold font-mono text-rose-600 dark:text-rose-400 mt-1">
                {fmtMoney(
                  displayedQbRecords.reduce(
                    (acc, r) => acc + Number(r.journalPreview?.auditBreakdown?.totalAtRiskTax || 0),
                    0
                  )
                )}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Sales Tax (DD/GH) en reembolsos u órdenes no pagadas
              </div>
            </div>
          </div>

          {/* TABLA DE PÓLIZAS DE LIQUIDACIÓN SEMANAL (4 LÍNEAS QUICKBOOKS) */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
            {qbLoading ? (
              <div className="p-12 text-center text-slate-500">{t('deliveryReconciliation.syncing_btn')}</div>
            ) : displayedQbRecords.length === 0 ? (
              <div className="p-12 text-center text-slate-500">{t('deliveryReconciliation.empty_payouts')}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs md:text-sm">
                  <thead>
                    <tr className="bg-slate-100 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800 font-bold">
                      <th className="p-3 w-10 text-center">
                        <input
                          type="checkbox"
                          checked={
                            displayedQbRecords.filter((r) => !r.hasJournalEntry).length > 0 &&
                            displayedQbRecords
                              .filter((r) => !r.hasJournalEntry)
                              .every((r) => selectedQbPayoutIds.has(r.id))
                          }
                          onChange={(e) => {
                            if (e.target.checked) {
                              const next = new Set<string>()
                              displayedQbRecords
                                .filter((r) => !r.hasJournalEntry)
                                .forEach((r) => next.add(r.id))
                              setSelectedQbPayoutIds(next)
                            } else {
                              setSelectedQbPayoutIds(new Set())
                            }
                          }}
                          className="rounded border-slate-300"
                        />
                      </th>
                      <th className="p-3">{t('deliveryReconciliation.payout_period')}</th>
                      <th className="p-3">{t('deliveryReconciliation.col_store')}</th>
                      <th className="p-3">{t('deliveryReconciliation.col_platform')}</th>
                      <th className="p-3 text-right">{t('deliveryReconciliation.qb_col_bank_debit')}</th>
                      <th className="p-3 text-right">{t('deliveryReconciliation.qb_col_fees_debit')}</th>
                      <th className="p-3 text-right">{t('deliveryReconciliation.qb_col_ar_credit')}</th>
                      <th className="p-3 text-right">{t('deliveryReconciliation.qb_col_sales_adj')}</th>
                      <th className="p-3">{t('deliveryReconciliation.qb_col_orders_involved')}</th>
                      <th className="p-3">{t('deliveryReconciliation.qb_col_je_status')}</th>
                      <th className="p-3 text-center">{t('deliveryReconciliation.col_actions')}</th>
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

                      return (
                        <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                          <td className="p-3 text-center">
                            <input
                              type="checkbox"
                              disabled={r.hasJournalEntry}
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
                          <td className="p-3 whitespace-nowrap">
                            <div className="font-bold text-slate-900 dark:text-white">
                              {r.period_start} → {r.period_end}
                            </div>
                            <div className="text-[11px] font-mono text-indigo-600 dark:text-indigo-400">
                              Ref: #{r.payout_reference_id}
                            </div>
                          </td>
                          <td className="p-3 font-bold whitespace-nowrap">{r.store_name}</td>
                          <td className="p-3 whitespace-nowrap">{renderPlatformBadge(r.platform)}</td>
                          <td className="p-3 text-right font-mono">
                            <div className="font-extrabold text-emerald-600 dark:text-emerald-400">
                              {fmtMoney(line1?.amount || r.net_payout_amount)}
                            </div>
                            <div className="text-[10px] text-slate-400">{line1?.accountName}</div>
                          </td>
                          <td className="p-3 text-right font-mono">
                            <div className="font-bold text-amber-600 dark:text-amber-400">
                              {fmtMoney(line2?.amount || r.total_fees)}
                            </div>
                            <div className="text-[10px] text-slate-400">{line2?.accountName}</div>
                          </td>
                          <td className="p-3 text-right font-mono">
                            <div className="font-bold text-indigo-600 dark:text-indigo-400">
                              {fmtMoney(line3?.amount || r.platform_gross_receivable)}
                            </div>
                            <div className="text-[10px] text-slate-400">{line3?.accountName}</div>
                          </td>
                          <td className="p-3 text-right font-mono">
                            {line4 ? (
                              <div>
                                <span
                                  className={`font-extrabold ${
                                    line4.postingType === 'Credit'
                                      ? 'text-emerald-600 dark:text-emerald-400'
                                      : 'text-rose-600 dark:text-rose-400'
                                  }`}
                                >
                                  {line4.postingType === 'Credit' ? 'CR ' : 'DR '}
                                  {fmtMoney(line4.amount)}
                                </span>
                                <div className="text-[10px] text-slate-400">{line4.accountName}</div>
                              </div>
                            ) : (
                              <span className="text-slate-400">$0.00</span>
                            )}
                          </td>
                          <td className="p-3">
                            <div className="flex flex-col gap-1 items-start">
                              {Array.isArray(audit.crossPayoutRefunds) &&
                                audit.crossPayoutRefunds.map((cr: any, idx: number) => (
                                  <span
                                    key={idx}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
                                  >
                                    🔄 Reembolso #{cr.orderCode} (+{fmtMoney(cr.amount)})
                                  </span>
                                ))}
                              {(audit.deductedOrders?.length || 0) > 0 && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-700 dark:text-rose-300">
                                  🚨 {audit.deductedOrders.length} órd. con descuento
                                </span>
                              )}
                              {(audit.totalAtRiskTax || 0) > 0.01 && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                                  ⚠ Tax 24001: {fmtMoney(audit.totalAtRiskTax)}
                                </span>
                              )}
                              {(audit.crossPayoutRefunds?.length || 0) === 0 &&
                                (audit.deductedOrders?.length || 0) === 0 &&
                                (audit.totalAtRiskTax || 0) <= 0.01 && (
                                  <span className="text-[11px] text-slate-400">
                                    {audit.settledOrdersCount || 0} órd. liquidadas
                                  </span>
                                )}
                            </div>
                          </td>
                          <td className="p-3 whitespace-nowrap">
                            {r.hasJournalEntry ? (
                              <div className="flex flex-col gap-0.5 items-start">
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-extrabold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  {t('deliveryReconciliation.qb_status_created')}
                                </span>
                                {r.qbJournalEntry?.docNumber && (
                                  <span className="text-[11px] font-mono font-bold text-slate-500">
                                    JE #{r.qbJournalEntry.docNumber} (ID: {r.qbJournalEntry.id})
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                                ⏳ {t('deliveryReconciliation.qb_status_pending')}
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-center whitespace-nowrap">
                            <button
                              onClick={() => handleOpenQbModal(r)}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-extrabold transition ${
                                r.hasJournalEntry
                                  ? 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'
                                  : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm'
                              }`}
                            >
                              <Eye className="w-3.5 h-3.5" />
                              {r.hasJournalEntry
                                ? t('deliveryReconciliation.qb_view_single_btn')
                                : t('deliveryReconciliation.qb_create_single_btn')}
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
        </div>
      )}

      {/* MODAL DE PÓLIZA QUICKBOOKS (JOURNAL ENTRY) Y RADIOGRAFÍA DE ÓRDENES E IMPUESTOS */}
      {selectedQbRecord && (() => {
        const prev = selectedQbRecord.journalPreview || {}
        const audit = prev.auditBreakdown || {}
        const embeddedTax = Number(prev.embeddedRefundTax || 0)
        const rawErrAdj = Number(prev.rawErrAdj || 0)

        // Si el usuario activa el checkbox `jeModalSplitTax` en DoorDash/Grubhub, separar la línea 4 en Subtotal (4006X) + Tax (24001)
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
              description: `${line4Orig.description} (Subtotal sin Tax)`,
            },
            {
              lineNumber: 5,
              accountNumber: '24001',
              accountQbId: '40',
              accountName: '24001 Sales tax payable',
              postingType: 'Debit',
              amount: embeddedTax,
              description: `${line4Orig.description} (Recuperación Sales Tax 24001)`,
              locationName: line4Orig.locationName,
              className: line4Orig.className,
            },
          ]
        })()

        return (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-5xl w-full p-6 space-y-5 shadow-2xl max-h-[92vh] overflow-y-auto">
              {/* CABECERA DEL MODAL */}
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    {renderPlatformBadge(selectedQbRecord.platform)}
                    <h3 className="text-lg font-extrabold">{t('deliveryReconciliation.qb_modal_title')}</h3>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Sucursal: <span className="font-bold">{selectedQbRecord.store_name}</span> • Corte:{' '}
                    <span className="font-mono font-bold">#{selectedQbRecord.payout_reference_id}</span> • Periodo:{' '}
                    <span className="font-mono">
                      {selectedQbRecord.period_start} → {selectedQbRecord.period_end}
                    </span>
                  </p>
                </div>
                <button
                  onClick={() => setSelectedQbRecord(null)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* BANNER SI YA ESTÁ CREADO EN QUICKBOOKS */}
              {selectedQbRecord.hasJournalEntry && selectedQbRecord.qbJournalEntry && (
                <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between text-emerald-800 dark:text-emerald-200 text-xs md:text-sm font-bold">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                    <span>
                      {t('deliveryReconciliation.qb_modal_already_created_banner', {
                        doc: selectedQbRecord.qbJournalEntry.docNumber || '-',
                        id: selectedQbRecord.qbJournalEntry.id,
                        date: selectedQbRecord.qbJournalEntry.txnDate,
                      })}
                    </span>
                  </div>
                </div>
              )}

              {/* CONTROLES DE FECHA, FOLIO Y OPCIÓN DE RECUPERAR SALES TAX (24001) */}
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
                          Debita {fmtMoney(embeddedTax)} de 24001 Sales tax payable
                        </span>
                      </div>
                    </label>
                  ) : (
                    <div className="text-xs text-slate-500">
                      <span className="font-bold text-slate-700 dark:text-slate-200 block">
                        Regla de Impuestos ({selectedQbRecord.platform}):
                      </span>
                      {selectedQbRecord.platform === 'UBER_EATS'
                        ? 'Uber Eats es Marketplace Facilitator (retiene y declara el Sales Tax directamente).'
                        : 'Sin cargos por error con Sales Tax por revertir en este corte.'}
                    </div>
                  )}
                </div>
              </div>

              {/* TABLA DE LÍNEAS DEL JOURNAL ENTRY EN QUICKBOOKS ONLINE */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs md:text-sm font-extrabold uppercase text-slate-600 dark:text-slate-300">
                    {t('deliveryReconciliation.qb_modal_lines_title')}
                  </h4>
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                    ✓ Total Debits = Total Credits ({fmtMoney(prev.totalDebits)})
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
                      <tr className="bg-slate-100/80 dark:bg-slate-800/90 font-extrabold border-t-2 border-slate-300 dark:border-slate-700">
                        <td colSpan={2} className="p-2.5 text-right">
                          Total
                        </td>
                        <td className="p-2.5 text-right font-mono text-emerald-700 dark:text-emerald-400">
                          {fmtMoney(prev.totalDebits)}
                        </td>
                        <td className="p-2.5 text-right font-mono text-indigo-700 dark:text-indigo-400">
                          {fmtMoney(prev.totalCredits)}
                        </td>
                        <td colSpan={3} />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* SECCIÓN 1: ÓRDENES INVOLUCRADAS EN DESCUENTOS / REEMBOLSOS DE ESTE CORTE (LÍNEA 4) */}
              <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <h4 className="text-xs md:text-sm font-extrabold uppercase text-slate-700 dark:text-slate-200">
                    {t('deliveryReconciliation.qb_modal_deducted_orders_title')}
                  </h4>
                  <div className="text-xs font-mono">
                    Chargebacks del Corte:{' '}
                    <span className="font-bold text-rose-600 dark:text-rose-400">
                      {fmtMoney(prev.chargebacksInCut || 0)}
                    </span>{' '}
                    | Otros Pagos / Reembolsos:{' '}
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">
                      +{fmtMoney(prev.adjustmentsInCut || 0)}
                    </span>{' '}
                    ={' '}
                    <span className="font-extrabold">
                      {fmtMoney(prev.rawErrAdj || 0)} ({(prev.rawErrAdj || 0) < 0 ? 'DEBIT' : 'CREDIT'})
                    </span>
                  </div>
                </div>

                {/* REEMBOLSOS DE OTROS CORTES (EJ. #650DD +$240.99) */}
                {Array.isArray(audit.crossPayoutRefunds) && audit.crossPayoutRefunds.length > 0 && (
                  <div className="space-y-1.5">
                    {audit.crossPayoutRefunds.map((cr: any, idx: number) => (
                      <div
                        key={idx}
                        className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs"
                      >
                        <div className="font-bold text-emerald-800 dark:text-emerald-200">
                          🔄 Disputa Ganada / Reembolso de Otro Periodo: Orden{' '}
                          <span className="font-mono font-extrabold">#{cr.orderCode}</span>{' '}
                          {cr.orderDate ? `(Fecha original: ${cr.orderDate})` : ''} —{' '}
                          <span className="font-mono">&ldquo;{cr.description}&rdquo;</span>
                        </div>
                        <span className="font-mono font-extrabold text-emerald-700 dark:text-emerald-300">
                          +{fmtMoney(cr.amount)} (Crédito a favor en Línea 4)
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* TABLA DE ÓRDENES CON DESCUENTO / CARGO POR ERROR EN ESTE CORTE */}
                {Array.isArray(audit.deductedOrders) && audit.deductedOrders.length > 0 ? (
                  <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-rose-500/10 text-slate-700 dark:text-slate-200 font-bold border-b border-slate-200 dark:border-slate-700">
                          <th className="p-2">Fecha</th>
                          <th className="p-2"># Orden</th>
                          <th className="p-2">Toast # / Cliente</th>
                          <th className="p-2 text-right">Toast Subtotal</th>
                          <th className="p-2 text-right">Toast Tax</th>
                          <th className="p-2 text-right">Cargo Error / Ajuste</th>
                          <th className="p-2 text-right">Neto Pagado</th>
                          <th className="p-2">Estado Disputa</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {audit.deductedOrders.map((o: any) => (
                          <tr key={o.id}>
                            <td className="p-2 font-mono">{o.business_date}</td>
                            <td className="p-2 font-mono font-bold">{o.platform_order_id}</td>
                            <td className="p-2">
                              {o.toast_display_number ? `#${o.toast_display_number} • ${o.toast_tab_name || ''}` : '-'}
                            </td>
                            <td className="p-2 text-right font-mono">{fmtMoney(o.toast_net_sales)}</td>
                            <td className="p-2 text-right font-mono">{fmtMoney(o.toast_tax)}</td>
                            <td className="p-2 text-right font-mono font-bold text-rose-600 dark:text-rose-400">
                              {fmtMoney(Number(o.error_charge || 0) + Number(o.adjustment_amount || 0))}
                            </td>
                            <td className="p-2 text-right font-mono font-bold">{fmtMoney(o.net_payout)}</td>
                            <td className="p-2">
                              <span className="font-semibold">{o.dispute_status}</span>
                              {o.reimbursement_payout_ref && (
                                <span className="block text-[10px] font-bold text-emerald-600">
                                  Reembolsada en #{o.reimbursement_payout_ref} (+{fmtMoney(o.reimbursement_amount)})
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">
                    {Math.abs(prev.chargebacksInCut || 0) > 0.01
                      ? `Este corte incluye ${fmtMoney(
                          prev.chargebacksInCut
                        )} en ajustes/chargebacks globales del estado de cuenta semanal. Sincroniza el rango de fechas de este periodo para ver el detalle orden por orden.`
                      : 'No hay órdenes individuales con descuento por cargo de error en este corte.'}
                  </div>
                )}
              </div>

              {/* SECCIÓN 2: ÓRDENES EN TOAST POS NO PAGADAS EN EL CORTE + ALERTA DE IMPUESTOS (CUENTA 24001) */}
              <div className="bg-amber-500/5 border border-amber-500/25 rounded-xl p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <h4 className="text-xs md:text-sm font-extrabold uppercase text-amber-800 dark:text-amber-300">
                    {t('deliveryReconciliation.qb_modal_unpaid_toast_title')}
                  </h4>
                  <div className="text-xs font-mono">
                    Órdenes en Toast sin Pago:{' '}
                    <span className="font-extrabold">{audit.unpaidToastOrdersCount || 0}</span> | Subtotal:{' '}
                    <span className="font-bold">{fmtMoney(audit.unpaidToastSubtotal || 0)}</span> | Tax Cta 24001:{' '}
                    <span className="font-extrabold text-rose-600 dark:text-rose-400">
                      {fmtMoney(audit.unpaidToastTax || 0)}
                    </span>
                  </div>
                </div>

                <p className="text-xs text-slate-600 dark:text-slate-300">
                  {t('deliveryReconciliation.qb_modal_split_tax_desc')}
                </p>

                {Array.isArray(audit.unpaidToastOrdersSample) && audit.unpaidToastOrdersSample.length > 0 && (
                  <div className="overflow-x-auto border border-amber-500/20 rounded-lg bg-white dark:bg-slate-900 max-h-48">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-amber-500/10 font-bold border-b border-slate-200 dark:border-slate-700">
                          <th className="p-2">Fecha Operativa</th>
                          <th className="p-2"># Orden / Ticket Toast</th>
                          <th className="p-2">Tab Name</th>
                          <th className="p-2 text-right">Subtotal Toast</th>
                          <th className="p-2 text-right">Sales Tax (Cta 24001)</th>
                          <th className="p-2 text-right">Bruto Esperado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {audit.unpaidToastOrdersSample.map((uo: any) => (
                          <tr key={uo.id}>
                            <td className="p-2 font-mono">{uo.business_date}</td>
                            <td className="p-2 font-mono font-bold">
                              {uo.platform_order_id} (Toast #{uo.toast_display_number || '-'})
                            </td>
                            <td className="p-2">{uo.toast_tab_name || '-'}</td>
                            <td className="p-2 text-right font-mono">{fmtMoney(uo.toast_net_sales)}</td>
                            <td className="p-2 text-right font-mono font-bold text-rose-600 dark:text-rose-400">
                              {fmtMoney(uo.toast_tax)}
                            </td>
                            <td className="p-2 text-right font-mono font-bold">{fmtMoney(uo.toast_expected_gross)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* BOTONES DE ACCIÓN DEL MODAL */}
              <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  onClick={() => setSelectedQbRecord(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold"
                >
                  {t('deliveryReconciliation.modal_close')}
                </button>
                {!selectedQbRecord.hasJournalEntry && (
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

      {/* MODAL DETALLE DE ORDEN Y DISPUTA */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-2xl w-full p-6 space-y-5 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-lg font-extrabold">{t('deliveryReconciliation.modal_order_detail_title')}</h3>
                <p className="text-xs text-slate-500">
                  {selectedOrder.store_name} • {selectedOrder.business_date} • #{selectedOrder.platform_order_id}
                </p>
              </div>
              <button
                onClick={() => setSelectedOrder(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl p-4 border border-slate-200 dark:border-slate-700 space-y-2">
                <div className="text-xs font-extrabold uppercase text-slate-500">Toast POS</div>
                <div className="flex justify-between text-sm">
                  <span>Ticket / Tab:</span>
                  <span className="font-mono font-bold">
                    #{selectedOrder.toast_display_number || '-'} ({selectedOrder.toast_tab_name || '-'})
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>{t('deliveryReconciliation.col_toast_net')}:</span>
                  <span className="font-mono font-semibold">{fmtMoney(selectedOrder.toast_net_sales)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>{t('deliveryReconciliation.col_toast_tax')}:</span>
                  <span className="font-mono font-semibold">{fmtMoney(selectedOrder.toast_tax)}</span>
                </div>
                <div className="flex justify-between text-sm font-extrabold border-t border-slate-200 dark:border-slate-700 pt-2">
                  <span>{t('deliveryReconciliation.col_toast_expected')}:</span>
                  <span className="font-mono">{fmtMoney(selectedOrder.toast_expected_gross)}</span>
                </div>
              </div>

              <div className="bg-indigo-500/5 rounded-xl p-4 border border-indigo-500/20 space-y-2">
                <div className="text-xs font-extrabold uppercase text-indigo-600 dark:text-indigo-400">
                  {selectedOrder.platform}
                </div>
                <div className="flex justify-between text-sm">
                  <span>{t('deliveryReconciliation.col_plat_subtotal')}:</span>
                  <span className="font-mono font-semibold">{fmtMoney(selectedOrder.platform_subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>{t('deliveryReconciliation.col_plat_tax_merchant')}:</span>
                  <span className="font-mono font-semibold">
                    {fmtMoney(selectedOrder.platform_tax_paid_to_merchant)}
                  </span>
                </div>
                <div className="flex justify-between text-sm font-bold">
                  <span>{t('deliveryReconciliation.col_plat_gross')}:</span>
                  <span className="font-mono">{fmtMoney(selectedOrder.platform_gross_receivable)}</span>
                </div>
                <div className="flex justify-between text-xs text-amber-600 dark:text-amber-400">
                  <span>{t('deliveryReconciliation.col_commission')}:</span>
                  <span className="font-mono">
                    {fmtMoney(Number(selectedOrder.commission_fee || 0) + Number(selectedOrder.delivery_fee || 0))}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-amber-600 dark:text-amber-400">
                  <span>{t('deliveryReconciliation.col_fees')}:</span>
                  <span className="font-mono">
                    {fmtMoney(Number(selectedOrder.processing_fee || 0) + Number(selectedOrder.marketing_fee || 0))}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-rose-600 dark:text-rose-400">
                  <span>{t('deliveryReconciliation.col_error_adj')}:</span>
                  <span className="font-mono">
                    {fmtMoney(Number(selectedOrder.error_charge || 0) + Number(selectedOrder.adjustment_amount || 0))}
                  </span>
                </div>
                <div className="flex justify-between text-sm font-extrabold text-emerald-600 dark:text-emerald-400 border-t border-indigo-500/20 pt-2">
                  <span>{t('deliveryReconciliation.col_net_payout')}:</span>
                  <span className="font-mono">{fmtMoney(selectedOrder.net_payout)}</span>
                </div>
              </div>
            </div>

            {selectedOrder.payout_reference_id && (
              <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs">
                <span className="font-bold text-slate-600 dark:text-slate-300">
                  {t('deliveryReconciliation.original_deduction_cut_label')}
                </span>
                <span className="font-mono font-extrabold text-indigo-600 dark:text-indigo-400">
                  #{selectedOrder.payout_reference_id}{' '}
                  {selectedOrder.payout_date ? `(${selectedOrder.payout_date})` : ''}
                </span>
              </div>
            )}

            {selectedOrder.raw_payload?.reimbursement_payout_ref && (
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold uppercase text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    {t('deliveryReconciliation.cross_payout_section_title')}
                  </span>
                  <span className="font-mono font-extrabold text-sm text-emerald-700 dark:text-emerald-300">
                    +{fmtMoney(selectedOrder.raw_payload.reimbursement_amount || selectedOrder.dispute_amount)}
                  </span>
                </div>
                <div className="text-xs font-semibold text-emerald-800 dark:text-emerald-200">
                  Corte de Reembolso:{' '}
                  <span className="font-mono font-extrabold">
                    #{selectedOrder.raw_payload.reimbursement_payout_ref}
                  </span>{' '}
                  {selectedOrder.raw_payload.reimbursement_period
                    ? `(${selectedOrder.raw_payload.reimbursement_period})`
                    : ''}{' '}
                  • Depositado: <span className="font-mono">{selectedOrder.raw_payload.reimbursement_deposit_date || '-'}</span>
                </div>
                {selectedOrder.raw_payload.reimbursement_description && (
                  <div className="text-xs font-mono text-emerald-700 dark:text-emerald-300">
                    Concepto oficial: &ldquo;{selectedOrder.raw_payload.reimbursement_description}&rdquo;
                  </div>
                )}
              </div>
            )}

            {Array.isArray(selectedOrder.raw_payload?.orderDetails?.issueDetails) &&
              selectedOrder.raw_payload.orderDetails.issueDetails.map((iss: any, iIdx: number) => {
                const disp = iss?.disputeDetails
                if (!disp) return null
                return (
                  <div
                    key={iIdx}
                    className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3.5 border border-slate-200 dark:border-slate-700 space-y-2"
                  >
                    <div className="text-xs font-extrabold uppercase text-slate-600 dark:text-slate-300">
                      {t('deliveryReconciliation.evidence_photos_title')}
                    </div>
                    {disp.additionalNotes && (
                      <p className="text-xs italic text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800">
                        &ldquo;{disp.additionalNotes}&rdquo;
                      </p>
                    )}
                    {Array.isArray(disp.evidenceUrls) && disp.evidenceUrls.length > 0 && (
                      <div className="grid grid-cols-3 gap-2 pt-1">
                        {disp.evidenceUrls.map((url: string, uIdx: number) => (
                          <a
                            key={uIdx}
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="block rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 hover:opacity-90 transition"
                          >
                            <img
                              src={url}
                              alt={`Evidence ${uIdx + 1}`}
                              className="w-full h-24 object-cover"
                            />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}

            {selectedOrder.items_summary && selectedOrder.items_summary.length > 0 && (
              <div className="bg-slate-50 dark:bg-slate-800/40 rounded-xl p-3 border border-slate-200 dark:border-slate-800">
                <div className="text-xs font-bold text-slate-500 mb-2">Platillos de la Orden (Toast POS)</div>
                <div className="space-y-1">
                  {selectedOrder.items_summary.map((it, idx) => (
                    <div key={idx} className="flex justify-between text-xs">
                      <span>
                        {it.quantity}x {it.name}
                      </span>
                      <span className="font-mono">{fmtMoney(it.price)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-3 border-t border-slate-200 dark:border-slate-800 pt-4">
              <label className="block text-xs font-bold uppercase text-slate-500">
                {t('deliveryReconciliation.modal_update_dispute')}
              </label>
              <select
                value={disputeStatusInput}
                onChange={(e) => setDisputeStatusInput(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-semibold"
              >
                <option value="NONE">{t('deliveryReconciliation.dispute_NONE')}</option>
                <option value="NEEDS_DISPUTE">{t('deliveryReconciliation.dispute_NEEDS_DISPUTE')}</option>
                <option value="SUBMITTED">{t('deliveryReconciliation.dispute_SUBMITTED')}</option>
                <option value="APPROVED">{t('deliveryReconciliation.dispute_APPROVED')}</option>
                <option value="DENIED">{t('deliveryReconciliation.dispute_DENIED')}</option>
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
                    placeholder="Z7OUBJC8LJSSGWM"
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
                    placeholder="240.99"
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
                    placeholder="Goodwill OE Refund #650DD 20260928"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs"
                  />
                </div>
              </div>

              <textarea
                rows={3}
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
                  disabled={savingDispute}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold"
                >
                  {t('deliveryReconciliation.modal_save_dispute')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL IMPORTAR REPORTE CSV / JSON */}
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
                  Archivo cargado: {importFileName} ({importText.length.toLocaleString()} bytes)
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              <button
                onClick={() => setShowImportModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold"
              >
                {t('deliveryReconciliation.modal_close')}
              </button>
              <button
                onClick={handleProcessImport}
                disabled={importing || !importText.trim()}
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
