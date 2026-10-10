/**
 * @module AccountingPacketDetailPage
 * @description Detailed review and reconciliation view for a single daily sales packet.
 * Allows managers/admins to verify 9 sections (reconciliation, sales channels, taxes, credit cards, third-party payments, cash over/short, and journal entry), edit the actual bank cash deposit, and publish directly to QuickBooks Online.
 * 
 * @businessRules
 * - Follows the exact light/dark adaptive theme of the SM TEG design system.
 * - Shows exact business date in America/Los_Angeles timezone.
 * - Editing actual bank deposit automatically updates the cash_over_short and regenerates the 17-line balanced journal in the database.
 * - Publish button sends the complete JournalEntry to QuickBooks Online and marks the packet as 'published'.
 * - Recalculate fetches fresh calculations from sales metrics for this store and date.
 * 
 * @dataFlow
 * /api/accounting/packets/[id] (GET/PATCH) + /api/accounting/packets/[id]/publish (POST)
 */

'use client'

import React, { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useLanguage } from '@/lib/i18n'
import { getQBStoreRefs } from '@/lib/qb-classes-locations'
import { Loader2, ArrowLeft, Send, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react'

// Inline UI components matching the standard light/dark app theme
const Button = ({ children, className = '', variant = 'default', size = 'default', disabled, onClick, ...props }: any) => {
  const base = 'inline-flex items-center justify-center font-bold rounded-xl transition-all disabled:opacity-50 disabled:pointer-events-none'
  const sizes: Record<string, string> = { default: 'px-4 py-2.5 text-sm', sm: 'px-3 py-1.5 text-xs', icon: 'p-2' }
  const variants: Record<string, string> = {
    default: 'bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 shadow-sm',
    primary: 'bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-600/20',
    success: 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/20',
    danger: 'bg-rose-600 hover:bg-rose-700 text-white shadow-md shadow-rose-600/20',
    outline: 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 shadow-sm',
    indigo: 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/20',
    ghost: 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300',
  }
  return (
    <button 
      className={`${base} ${sizes[size] || sizes.default} ${variants[variant] || variants.default} ${className}`} 
      disabled={disabled} 
      onClick={onClick} 
      {...props}
    >
      {children}
    </button>
  )
}

const Card = ({ children, className = '', ...props }: any) => (
  <div className={`bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm ${className}`} {...props}>
    {children}
  </div>
)

const Badge = ({ children, className = '', ...props }: any) => (
  <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${className}`} {...props}>
    {children}
  </span>
)

interface JournalLine {
  account: string
  memo: string
  debit: number | null
  credit: number | null
  sourceMemo?: string
  location?: string
  className?: string
  class?: string
}

interface Packet {
  id: string
  store_id: string
  business_date: string
  status: 'pending' | 'ready' | 'reviewed' | 'published' | 'rejected'
  stores?: { name: string }
  
  // Summary
  gross_sales: number
  total_discounts?: number
  discounts?: number
  net_sales: number
  total_taxes: number
  paid_in?: number
  
  // Dining options
  dine_in_sales: number
  togo_sales: number
  drive_thru_sales?: number
  kiosk_dine_in_sales?: number
  kiosk_takeout_sales?: number
  delivery_service?: number
  toast_delivery_sales?: number
  toast_online_sales?: number
  uber_delivery_sales: number
  uber_takeout_sales: number
  doordash_delivery_sales: number
  doordash_takeout_sales: number
  grubhub_sales: number
  
  // Taxes
  sales_tax: number
  marketplace_facilitator_tax: number
  facilitator_tax_paid: number
  
  // Payments
  total_credit_cards_gross?: number
  credit_card_deposit?: number
  credit_card_fees?: number
  cc_gross?: number
  cc_deposit?: number
  cc_fees?: number
  uber_payment: number
  doordash_payment: number
  grubhub_payment: number
  ebt_amount: number
  
  // Cash
  expected_cash: number
  cash_deposit: number
  cash_over_short: number
  
  // Journal
  journal_lines: JournalLine[]
  journal_total_debits: number
  journal_total_credits: number
  qb_journal_entry_id?: string
  qb_doc_number?: string
  published_at?: string
  notes?: string
  qb_sync_response?: {
    manual_cash_deposit?: boolean
    deposit_source?: 'manual' | 'toast' | 'pending'
    toast_deposits?: Array<{ guid: string; amount: number; date: string; employee?: string }>
    sales_gross_by_option?: Record<string, number>
    discount_breakdown?: Record<string, number>
    card_breakdown?: Record<string, { gross: number; fee: number; deposit: number }>
    validation?: {
      passed: boolean
      hasOpenOrders: boolean
      openOrdersCount: number
      outOfBalanceOrdersCount: number
      openOrders: Array<{
        orderId: string
        orderNumber: string
        openedDate: string
        closedDate: string | null
        serverName: string
        amount: number
        taxAmount: number
        totalAmount: number
        paymentStatus: string
        status: string
        reason: string
      }>
      checkedAt: string
      message?: string
    }
    post_publish_discrepancy?: {
      hasDiscrepancy: boolean
      detectedAt: string
      publishedNet: number
      liveToastNet: number
      diffNet: number
      liveToastTaxes?: number
      publishedTaxes?: number
    }
  }
}

const formatCurrency = (val: number | null | undefined) => {
  if (val === null || val === undefined) return '$0.00'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val)
}

const formatDateDisplay = (dateStr: string) => {
  if (!dateStr) return ''
  const parts = dateStr.split('-')
  if (parts.length === 3) {
    return `${parts[1]}/${parts[2]}/${parts[0]}`
  }
  return dateStr
}

export default function PacketDetailPage() {
  const { t, language } = useLanguage()
  const params = useParams()
  const router = useRouter()
  const packetId = params.packetId as string

  const [packet, setPacket] = useState<Packet | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Action states
  const [actionLoading, setActionLoading] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishMessage, setPublishMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  
  useEffect(() => {
    fetchPacket()
  }, [packetId])

  const fetchPacket = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/accounting/packets/${packetId}`)
      if (!res.ok) throw new Error('Failed to fetch packet')
      const data = await res.json()
      setPacket(data.packet)
    } catch (err: any) {
      setError(err.message || 'Error fetching packet')
    } finally {
      setLoading(false)
    }
  }


  const handleRecalculate = async () => {
    if (!packet) return
    setActionLoading(true)
    setPublishMessage(null)
    try {
      const res = await fetch(`/api/accounting/packets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          startDate: packet.business_date,
          endDate: packet.business_date,
          storeIds: [packet.store_id]
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to recalculate')
      setPublishMessage({ type: 'success', text: language === 'en' ? 'Packet recalculated successfully from Toast POS!' : '¡Póliza recalculada exitosamente con datos de Toast POS!' })
      await fetchPacket()
    } catch (err: any) {
      setPublishMessage({ type: 'error', text: err.message || 'Recalculate failed' })
    } finally {
      setActionLoading(false)
    }
  }

  const handlePublish = async () => {
    setPublishing(true)
    setPublishMessage(null)
    try {
      const res = await fetch(`/api/accounting/packets/${packetId}/publish`, {
        method: 'POST'
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to publish to QuickBooks')
      setPublishMessage({ type: 'success', text: t('accounting.alert_publish_success') || '¡Póliza publicada exitosamente a QuickBooks Online!' })
      await fetchPacket()
    } catch (err: any) {
      setPublishMessage({ type: 'error', text: err.message || t('accounting.alert_publish_error') || 'Error publishing packet' })
    } finally {
      setPublishing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-blue-600 dark:text-blue-400" />
      </div>
    )
  }

  if (error || !packet) {
    return (
      <div className="p-8 text-rose-600 dark:text-rose-400 min-h-screen space-y-4">
        <p className="text-lg font-bold">{error || t('accounting.packet_not_found') || 'Póliza no encontrada'}</p>
        <Link href="/contabilidad" className="inline-flex items-center text-blue-600 hover:text-blue-500 font-bold">
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t('accounting.back_to_list') || 'Volver a la lista'}
        </Link>
      </div>
    )
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ready': return 'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800/60'
      case 'reviewed': return 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800/60'
      case 'published': return 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-800/60'
      case 'rejected': return 'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-900/40 dark:text-rose-300 dark:border-rose-800/60'
      default: return 'bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
    }
  }

  const isBalanced = Math.abs((packet.journal_total_debits || 0) - (packet.journal_total_credits || 0)) < 0.01

  // Cash Deposit Status (Strictly from Toast POS Cash Management)
  const isDepositPending = Number(packet.cash_deposit || 0) === 0 && Number(packet.expected_cash || 0) > 0
  const isDepositToast = Number(packet.cash_deposit || 0) > 0

  // Open Orders Detection (Step 11 Cohesion Rule)
  const validation = (packet.qb_sync_response as any)?.validation
  const hasOpenOrders = Boolean(
    (validation?.hasOpenOrders && (validation?.openOrdersCount ?? 0) > 0) ||
    (validation?.openOrders && validation.openOrders.length > 0)
  )
  const openOrdersCount = validation?.openOrdersCount || validation?.openOrders?.length || 0

  return (
    <div className="w-full mx-auto px-4 md:px-6 py-6 space-y-6 pb-24">
      
      {/* 1. Header Bar */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" onClick={() => router.push('/contabilidad')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{packet.stores?.name || 'Sucursal'}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-0.5">
              {t('accounting.business_date_label') || 'Fecha Contable:'}{' '} 
              <span className="font-bold text-slate-800 dark:text-slate-200">{formatDateDisplay(packet.business_date)}</span>
              {packet.qb_doc_number && <span className="ml-3 text-xs font-mono font-bold bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 rounded-md text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">Doc: {packet.qb_doc_number}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {packet.status !== 'published' && hasOpenOrders && (
            <Badge className="px-3.5 py-1.5 text-xs font-black bg-amber-500/15 text-amber-800 border-2 border-amber-500/50 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-600/70 flex items-center gap-1.5 shadow-sm animate-pulse">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              <span>{openOrdersCount > 1 ? `${openOrdersCount} ${t('accounting.status_open_orders_plural') || 'Órdenes Abiertas'}` : `1 ${t('accounting.status_open_orders_singular') || 'Orden Abierta'}`}</span>
            </Badge>
          )}
          {packet.status !== 'published' && isDepositPending && (
            <Badge className="px-3.5 py-1.5 text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800 flex items-center gap-1">
              <span>⚠️ {t('accounting.badge_deposit_pending') || 'Depósito Pendiente'}</span>
            </Badge>
          )}
          <Badge className={`capitalize px-4 py-1.5 text-sm ${getStatusColor(packet.status)}`}>
            {t(`accounting.status_${packet.status}`) || packet.status}
          </Badge>
        </div>
      </div>

      {/* Post-Publish Discrepancy Alert Card */}
      {packet.status === 'published' && packet.qb_sync_response?.post_publish_discrepancy?.hasDiscrepancy && (
        <div className="bg-amber-500/10 border-2 border-amber-500/40 dark:border-amber-500/30 rounded-2xl p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-amber-500 text-black rounded-xl shrink-0 mt-0.5 shadow-md">
              <AlertTriangle className="w-6 h-6 stroke-[2.5]" />
            </div>
            <div className="space-y-2 flex-1">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <h3 className="text-base font-black tracking-tight text-amber-950 dark:text-amber-200 flex items-center gap-2">
                  <span>{language === 'en' ? '⚠️ Post-Publishing Toast Discrepancy Detected' : '⚠️ Discrepancia Posterior en Toast POS Detectada'}</span>
                  <span className="bg-amber-500 text-black text-xs font-black px-2.5 py-0.5 rounded-full">
                    Δ ${packet.qb_sync_response.post_publish_discrepancy.diffNet.toFixed(2)} USD
                  </span>
                </h3>
              </div>
              <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed font-medium">
                {language === 'en' 
                  ? `This journal entry was already published to QuickBooks Online with Net Sales of $${packet.qb_sync_response.post_publish_discrepancy.publishedNet.toFixed(2)}. However, Toast POS later settled at $${packet.qb_sync_response.post_publish_discrepancy.liveToastNet.toFixed(2)} (likely due to a late refund, void, or tip adjustment applied by store management).`
                  : `Esta póliza ya fue publicada a QuickBooks Online con Ventas Netas de $${packet.qb_sync_response.post_publish_discrepancy.publishedNet.toFixed(2)}. Sin embargo, Toast POS registró posteriormente un total de $${packet.qb_sync_response.post_publish_discrepancy.liveToastNet.toFixed(2)} (probablemente debido a un reembolso tardío, anulación o ajuste de propinas aplicado en la sucursal).`}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Toast Cash Management Pending Deposit Notice */}
      {packet.status !== 'published' && isDepositPending && (
        <div className="bg-amber-500/10 border-2 border-amber-500/40 dark:border-amber-500/30 rounded-2xl p-5 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="p-2.5 bg-amber-500 text-black rounded-xl shrink-0 mt-0.5 shadow-md">
              <AlertTriangle className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div className="space-y-1.5 flex-1">
              <h3 className="text-sm font-black tracking-tight text-amber-950 dark:text-amber-200 flex items-center gap-2">
                <span>{t('accounting.alert_pending_toast_deposit_title') || 'Depósito Pendiente en Toast POS'}</span>
                <span className="bg-amber-500 text-black text-[11px] font-black px-2 py-0.5 rounded-full">
                  Faltante temporal: -{formatCurrency(packet.expected_cash)}
                </span>
                <span className="bg-rose-500 text-white text-[11px] font-black px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
                  🚫 {t('accounting.badge_qb_blocked') || 'Publicación a QB Bloqueada'}
                </span>
              </h3>
              <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed font-medium">
                {t('accounting.alert_pending_toast_deposit_desc')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Toast POS Open Orders Notice & Details Table (Step 11 Cohesion Rule) */}
      {packet.status !== 'published' && hasOpenOrders && (
        <div className="bg-amber-500/10 border-2 border-amber-500/50 dark:border-amber-500/40 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-start gap-4">
            <div className="p-2.5 bg-amber-500 text-black rounded-xl shrink-0 mt-0.5 shadow-md">
              <AlertTriangle className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div className="space-y-1.5 flex-1">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <h3 className="text-sm font-black tracking-tight text-amber-950 dark:text-amber-200 flex items-center gap-2">
                  <span>{t('accounting.alert_open_orders_title') || 'Órdenes Abiertas en Toast POS — Registradas en Cuenta 12049'}</span>
                  <span className="bg-amber-500 text-black text-[11px] font-black px-2.5 py-0.5 rounded-full shadow-sm">
                    {openOrdersCount} {openOrdersCount > 1 ? (t('accounting.label_orders_count') || 'órdenes detectadas') : 'orden detectada'}
                  </span>
                </h3>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRecalculate}
                  disabled={actionLoading}
                  className="text-xs border-amber-500/40 text-amber-800 dark:text-amber-200 hover:bg-amber-500/20"
                >
                  {actionLoading ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
                  {t('accounting.check_again_toast') || 'Verificar Nuevamente en Toast POS'}
                </Button>
              </div>
              <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed font-medium">
                {t('accounting.alert_open_orders_desc')}
              </p>
            </div>
          </div>

          {/* Open Orders Table */}
          {validation?.openOrders && validation.openOrders.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-amber-500/20 bg-white/70 dark:bg-slate-900/70 shadow-inner">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-amber-500/15 text-amber-950 dark:text-amber-200 uppercase font-black tracking-wider border-b border-amber-500/20 text-left">
                    <th className="py-2 px-3">{t('accounting.col_order_num') || 'Orden #'}</th>
                    <th className="py-2 px-3">{t('accounting.col_open_time') || 'Hora Apertura'}</th>
                    <th className="py-2 px-3">{t('accounting.col_server') || 'Cajero / Mesero'}</th>
                    <th className="py-2 px-3 text-right">{t('accounting.col_order_amount') || 'Total Orden'}</th>
                    <th className="py-2 px-3">{t('accounting.col_issue') || 'Estado / Detalle'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-amber-500/10 font-medium text-slate-800 dark:text-slate-200">
                  {validation.openOrders.map((ord: any, idx: number) => {
                    const openedTime = ord.openedDate ? new Date(ord.openedDate).toLocaleTimeString('es-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' }) : '—'
                    return (
                      <tr key={ord.orderId || idx} className="hover:bg-amber-500/5 transition-colors">
                        <td className="py-2 px-3 font-mono font-bold text-amber-700 dark:text-amber-400">
                          #{ord.orderNumber || ord.orderId?.slice(0, 8)}
                        </td>
                        <td className="py-2 px-3 font-mono text-slate-600 dark:text-slate-400">
                          {openedTime}
                        </td>
                        <td className="py-2 px-3 font-semibold">
                          {ord.serverName || 'Sin asignar'}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                          {formatCurrency(ord.totalAmount || ord.amount || 0)}
                        </td>
                        <td className="py-2 px-3">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                            {ord.reason || ord.status || 'OPEN'}
                          </span>
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

      {publishMessage && (
        <div className={`p-4 rounded-xl flex items-center gap-3 border shadow-sm ${publishMessage.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800/60' : 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-800/60'}`}>
          {publishMessage.type === 'success' ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" /> : <AlertTriangle className="h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />}
          <span className="text-sm font-semibold">{publishMessage.text}</span>
        </div>
      )}

      {/* 2. Action Buttons Row */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {packet.status !== 'published' && (
          <Button 
            variant="indigo" 
            onClick={handleRecalculate} 
            disabled={actionLoading}
          >
            {actionLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin text-white" /> : <RefreshCw className="mr-2 h-4 w-4 text-white" />}
            {t('accounting.btn_recalculate') || 'Recalcular'}
          </Button>
        )}

        {packet.status !== 'published' && (
          <Button 
            variant="primary" 
            onClick={handlePublish} 
            disabled={publishing || !isBalanced || packet.status !== 'ready' || isDepositPending} 
            title={
              isDepositPending 
                ? (t('accounting.blocked_pending_deposit_tooltip') || 'Bloqueado: Depósito de efectivo pendiente en Toast POS')
                : !isBalanced 
                  ? (t('accounting.label_unbalanced') || 'La póliza debe estar balanceada para publicar')
                  : undefined
            }
          >
            {publishing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            {t('accounting.btn_publish') || 'Publicar a QuickBooks'}
          </Button>
        )}

        {packet.status === 'published' && (
          <div className="bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800 px-4 py-2 rounded-xl text-sm font-bold flex items-center">
            <CheckCircle2 className="w-4 h-4 mr-2 text-emerald-600 dark:text-emerald-400" />
            {t('accounting.status_published_qb') || 'Publicada en QuickBooks Online'}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        
        {/* 3. Reconciliation Summary Card */}
        <Card>
          <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4">{t('accounting.section_summary') || 'Resumen de Conciliación'}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800 text-xs uppercase font-bold">
                  <th className="pb-2 text-left">{t('accounting.col_item') || 'Concepto'}</th>
                  <th className="pb-2 text-right">{t('accounting.label_gross') || 'Bruto'}</th>
                  <th className="pb-2 text-right">{t('accounting.label_net') || 'Neto'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
                <tr>
                  <td className="py-2 font-sans text-slate-700 dark:text-slate-300 font-medium">{t('accounting.col_gross_sales') || 'Ventas Brutas'}</td>
                  <td className="py-2 text-right font-semibold text-slate-800 dark:text-slate-200">{formatCurrency(packet.gross_sales)}</td>
                  <td className="py-2 text-right font-semibold text-slate-800 dark:text-slate-200">{formatCurrency(packet.gross_sales)}</td>
                </tr>
                <tr className="text-rose-600 dark:text-rose-400">
                  <td className="py-2 font-sans font-medium">{t('accounting.section_discounts') || 'Descuentos'}</td>
                  <td className="py-2 text-right font-semibold">-{formatCurrency(packet.total_discounts ?? packet.discounts ?? 0)}</td>
                  <td className="py-2 text-right font-semibold">-{formatCurrency(packet.total_discounts ?? packet.discounts ?? 0)}</td>
                </tr>
                <tr className="font-bold text-slate-900 dark:text-white bg-slate-50/50 dark:bg-slate-800/30">
                  <td className="py-2 font-sans">{t('accounting.col_net_sales') || 'Ventas Netas'}</td>
                  <td className="py-2 text-right text-blue-600 dark:text-blue-400">{formatCurrency(packet.net_sales)}</td>
                  <td className="py-2 text-right text-blue-600 dark:text-blue-400">{formatCurrency(packet.net_sales)}</td>
                </tr>
                <tr>
                  <td className="py-2 font-sans text-slate-700 dark:text-slate-300 font-medium">{t('accounting.col_taxes') || 'Impuestos'}</td>
                  <td className="py-2 text-right font-semibold text-slate-800 dark:text-slate-200">{formatCurrency(packet.total_taxes)}</td>
                  <td className="py-2 text-right font-semibold text-slate-800 dark:text-slate-200">{formatCurrency(packet.total_taxes)}</td>
                </tr>
                {Boolean((packet.paid_in || 0) > 0 || packet.journal_lines?.some((l: any) => l.account === '12049')) && (
                  <tr className="text-emerald-600 dark:text-emerald-400">
                    <td className="py-2 font-sans font-medium">{t('accounting.label_paid_in') || 'Paid In Total (Deposits Received)'}</td>
                    <td className="py-2 text-right font-semibold">{formatCurrency(packet.paid_in || packet.journal_lines?.find((l: any) => l.account === '12049')?.credit || 0)}</td>
                    <td className="py-2 text-right font-semibold">{formatCurrency(packet.paid_in || packet.journal_lines?.find((l: any) => l.account === '12049')?.credit || 0)}</td>
                  </tr>
                )}
                <tr className="font-extrabold text-slate-900 dark:text-white border-t-2 border-slate-200 dark:border-slate-700 text-sm">
                  <td className="py-2.5 font-sans">{t('accounting.col_total_gross_receipts') || 'Total Gross Receipts'}</td>
                  <td className="py-2.5 text-right">{formatCurrency(packet.net_sales + packet.total_taxes + (packet.paid_in || packet.journal_lines?.find((l: any) => l.account === '12049')?.credit || 0))}</td>
                  <td className="py-2.5 text-right">{formatCurrency(packet.net_sales + packet.total_taxes + (packet.paid_in || packet.journal_lines?.find((l: any) => l.account === '12049')?.credit || 0))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>

        {/* 4. Sales Details Card */}
        <Card>
          <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4">{t('accounting.section_sales') || 'Detalle por Canal'}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800 text-xs uppercase font-bold">
                  <th className="pb-2 text-left">{t('accounting.col_channel_method') || 'Canal'}</th>
                  <th className="pb-2 text-right">{t('accounting.label_gross') || 'Bruto'}</th>
                  <th className="pb-2 text-right">{t('accounting.label_net') || 'Neto'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
                {(() => {
                  const grossMap = packet.qb_sync_response?.sales_gross_by_option || {}
                  const rows = [
                    { name: t('accounting.dining_for_here') || 'For Here', gross: grossMap.forHere ?? packet.dine_in_sales, net: packet.dine_in_sales },
                    { name: t('accounting.dining_to_go') || 'To Go', gross: grossMap.toGo ?? packet.togo_sales, net: packet.togo_sales },
                    ...(Number(packet.drive_thru_sales || grossMap.driveThru || 0) > 0 ? [{ name: 'Drive Thru', gross: grossMap.driveThru ?? packet.drive_thru_sales, net: packet.drive_thru_sales }] : []),
                    ...(Number(packet.kiosk_dine_in_sales || grossMap.kioskDineIn || 0) > 0 ? [{ name: 'Kiosk Dine In', gross: grossMap.kioskDineIn ?? packet.kiosk_dine_in_sales, net: packet.kiosk_dine_in_sales }] : []),
                    ...(Number(packet.kiosk_takeout_sales || grossMap.kioskTakeOut || 0) > 0 ? [{ name: 'Kiosk Take Out', gross: grossMap.kioskTakeOut ?? packet.kiosk_takeout_sales, net: packet.kiosk_takeout_sales }] : []),
                    ...(Number(packet.toast_online_sales || grossMap.toastOnline || 0) > 0 ? [{ name: 'Toast Online', gross: grossMap.toastOnline ?? packet.toast_online_sales, net: packet.toast_online_sales }] : []),
                    ...(Number(packet.toast_delivery_sales || grossMap.toastDelivery || 0) > 0 ? [{ name: 'Toast Delivery', gross: grossMap.toastDelivery ?? packet.toast_delivery_sales, net: packet.toast_delivery_sales }] : []),
                    { name: 'Uber Eats - Delivery', gross: grossMap.uberDelivery ?? packet.uber_delivery_sales, net: packet.uber_delivery_sales },
                    ...(Number(packet.uber_takeout_sales || grossMap.uberTakeout || 0) > 0 ? [{ name: 'Uber Eats Takeout', gross: grossMap.uberTakeout ?? packet.uber_takeout_sales, net: packet.uber_takeout_sales }] : []),
                    { name: 'DoorDash - Delivery', gross: grossMap.doordashDelivery ?? packet.doordash_delivery_sales, net: packet.doordash_delivery_sales },
                    ...(Number(packet.doordash_takeout_sales || grossMap.doordashTakeout || 0) > 0 ? [{ name: 'DoorDash - Takeout', gross: grossMap.doordashTakeout ?? packet.doordash_takeout_sales, net: packet.doordash_takeout_sales }] : []),
                    ...(Number(packet.grubhub_sales || grossMap.grubhubDelivery || 0) > 0 ? [{ name: 'GrubHub Delivery', gross: grossMap.grubhubDelivery ?? packet.grubhub_sales, net: packet.grubhub_sales }] : []),
                    ...(Number(grossMap.grubhubTakeout || 0) > 0 ? [{ name: 'GrubHub Takeout', gross: grossMap.grubhubTakeout, net: grossMap.grubhubTakeout }] : []),
                  ]
                  return (
                    <>
                      {rows.map((r, i) => (
                        <tr key={i}>
                          <td className="py-2 font-sans text-slate-700 dark:text-slate-300 font-medium">{r.name}</td>
                          <td className="py-2 text-right font-semibold text-slate-800 dark:text-slate-200">{formatCurrency(r.gross)}</td>
                          <td className="py-2 text-right font-semibold text-slate-800 dark:text-slate-200">{formatCurrency(r.net)}</td>
                        </tr>
                      ))}
                      <tr className="font-extrabold text-blue-600 dark:text-blue-400 border-t-2 border-slate-200 dark:border-slate-700">
                        <td className="py-2.5 font-sans">{t('accounting.total_net_sales') || 'Total Ventas'}</td>
                        <td className="py-2.5 text-right">{formatCurrency(packet.gross_sales)}</td>
                        <td className="py-2.5 text-right">{formatCurrency(packet.net_sales)}</td>
                      </tr>
                    </>
                  )
                })()}
              </tbody>
            </table>
          </div>
        </Card>

        {/* 5. Discount Details Card */}
        <Card>
          <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4">{t('accounting.section_discounts') || 'Detalle de Descuentos'}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800 text-xs uppercase font-bold">
                  <th className="pb-2 text-left">{t('accounting.col_discount_type') || 'Tipo de Descuento'}</th>
                  <th className="pb-2 text-right">{t('accounting.label_gross') || 'Bruto'}</th>
                  <th className="pb-2 text-right">{t('accounting.label_net') || 'Neto'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
                {packet.qb_sync_response?.discount_breakdown && Object.keys(packet.qb_sync_response.discount_breakdown).length > 0 ? (
                  Object.entries(packet.qb_sync_response.discount_breakdown).map(([name, amount], idx) => (
                    <tr key={idx}>
                      <td className="py-2 font-sans text-slate-700 dark:text-slate-300 font-medium">{name}</td>
                      <td className="py-2 text-right font-semibold text-rose-600 dark:text-rose-400">{formatCurrency(amount)}</td>
                      <td className="py-2 text-right font-semibold text-rose-600 dark:text-rose-400">{formatCurrency(amount)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="py-2 font-sans text-slate-700 dark:text-slate-300 font-medium">{t('accounting.section_discounts') || 'Descuentos'}</td>
                    <td className="py-2 text-right font-semibold text-rose-600 dark:text-rose-400">{formatCurrency(packet.total_discounts ?? packet.discounts ?? 0)}</td>
                    <td className="py-2 text-right font-semibold text-rose-600 dark:text-rose-400">{formatCurrency(packet.total_discounts ?? packet.discounts ?? 0)}</td>
                  </tr>
                )}
                <tr className="font-extrabold text-rose-600 dark:text-rose-400 border-t-2 border-slate-200 dark:border-slate-700">
                  <td className="py-2.5 font-sans">{t('accounting.total_discounts_label') || 'Total Descuentos'}</td>
                  <td className="py-2.5 text-right">{formatCurrency(packet.total_discounts ?? packet.discounts ?? 0)}</td>
                  <td className="py-2.5 text-right">{formatCurrency(packet.total_discounts ?? packet.discounts ?? 0)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>

        {/* 6. Tax Details Card */}
        <Card>
          <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4">{t('accounting.section_taxes') || 'Detalle de Impuestos'}</h2>
          <div className="space-y-2.5 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">{t('accounting.tax_sales_tax_local') || 'Sales Tax (Local)'}</span>
              <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">{formatCurrency(packet.sales_tax)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">{t('accounting.tax_marketplace_facilitator') || 'Marketplace Facilitator Tax'}</span>
              <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">{formatCurrency(packet.marketplace_facilitator_tax)}</span>
            </div>
            <div className="flex justify-between text-slate-500 dark:text-slate-400">
              <span>{t('accounting.tax_paid_by_uber') || 'Tax Paid by Facilitator (Uber)'}</span>
              <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">{formatCurrency(packet.facilitator_tax_paid)}</span>
            </div>
            <div className="flex justify-between font-extrabold pt-2 border-t-2 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-base">
              <span>{t('accounting.total_taxes_liability') || 'Total Impuestos'}</span>
              <span className="font-mono">{formatCurrency(packet.total_taxes)}</span>
            </div>
          </div>
        </Card>

        {/* 7. Credit Card Payments Card */}
        <Card>
          <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4">{t('accounting.section_credit_cards') || 'Pagos con Tarjeta de Crédito'}</h2>
          {packet.qb_sync_response?.card_breakdown && Object.keys(packet.qb_sync_response.card_breakdown).length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800 text-xs uppercase font-bold">
                    <th className="pb-2 text-left">{t('accounting.col_card_brand') || 'Tipo'}</th>
                    <th className="pb-2 text-right">{t('accounting.label_gross') || 'Bruto'}</th>
                    <th className="pb-2 text-right">{t('accounting.col_fee') || 'Comisión'}</th>
                    <th className="pb-2 text-right">{t('accounting.col_net_deposit') || 'Depósito'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
                  {Object.entries(packet.qb_sync_response.card_breakdown).map(([brand, bData], idx) => (
                    <tr key={idx}>
                      <td className="py-2 font-sans font-semibold text-slate-700 dark:text-slate-300">{brand}</td>
                      <td className="py-2 text-right font-semibold text-slate-800 dark:text-slate-200">{formatCurrency(bData.gross)}</td>
                      <td className="py-2 text-right font-semibold text-rose-600 dark:text-rose-400">-{formatCurrency(bData.fee)}</td>
                      <td className="py-2 text-right font-bold text-blue-600 dark:text-blue-400">{formatCurrency(bData.deposit)}</td>
                    </tr>
                  ))}
                  <tr className="font-extrabold border-t-2 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white">
                    <td className="py-2.5 font-sans">{t('accounting.total_card_payments') || 'Total'}</td>
                    <td className="py-2.5 text-right">{formatCurrency(packet.total_credit_cards_gross ?? packet.cc_gross)}</td>
                    <td className="py-2.5 text-right text-rose-600 dark:text-rose-400">-{formatCurrency(packet.credit_card_fees ?? packet.cc_fees)}</td>
                    <td className="py-2.5 text-right text-blue-600 dark:text-blue-400">{formatCurrency(packet.credit_card_deposit ?? packet.cc_deposit)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <div className="space-y-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">{t('accounting.cc_gross_total') || 'Total Tarjetas Bruto'}</span>
                <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">{formatCurrency(packet.total_credit_cards_gross ?? packet.cc_gross)}</span>
              </div>
              <div className="flex justify-between font-bold text-blue-600 dark:text-blue-400">
                <span>{t('accounting.cc_net_deposit') || 'Depósito Neto al Banco'}</span>
                <span className="font-mono">{formatCurrency(packet.credit_card_deposit ?? packet.cc_deposit)}</span>
              </div>
              <div className="flex justify-between text-slate-500 dark:text-slate-400">
                <span>{t('accounting.label_fees') || 'Comisiones Bancarias'}</span>
                <span className="font-mono font-semibold text-rose-600 dark:text-rose-400">-{formatCurrency(packet.credit_card_fees ?? packet.cc_fees)}</span>
              </div>
            </div>
          )}
        </Card>

        {/* 8. Cash Reconciliation Card */}
        <Card>
          <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4">{t('accounting.section_cash') || 'Conciliación de Efectivo'}</h2>
          <div className="space-y-4 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">{t('accounting.label_expected_cash') || 'Efectivo Esperado'}</span>
              <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{formatCurrency(packet.expected_cash)}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-slate-700 dark:text-slate-300 font-bold">{t('accounting.label_cash_deposit') || 'Depósito en Banco'}</span>
                {isDepositToast && (
                  <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-md border border-emerald-200 dark:border-emerald-800">
                    {t('accounting.badge_deposit_toast') || '✓ Toast POS'}
                  </span>
                )}
                {isDepositPending && (
                  <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 px-2 py-0.5 rounded-md border border-amber-200 dark:border-amber-800">
                    {t('accounting.badge_deposit_pending') || '⚠️ Pendiente'}
                  </span>
                )}
              </div>
              <span className={`font-mono font-bold text-base ${Number(packet.cash_deposit || 0) > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
                {formatCurrency(packet.cash_deposit)}
              </span>
            </div>
            <div className="flex justify-between font-extrabold pt-2 border-t-2 border-slate-200 dark:border-slate-700">
              <span className="text-slate-900 dark:text-white">{t('accounting.label_cash_over_short') || 'Sobrante / (Faltante)'}</span>
              <span className={`font-mono text-base ${packet.cash_over_short < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                {formatCurrency(packet.cash_over_short)}
              </span>
            </div>
            {isDepositPending && (
              <div className="mt-2 p-2.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800/60 rounded-xl">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-900 dark:text-amber-300 leading-snug font-medium">
                    {t('accounting.alert_pending_toast_deposit_desc')}
                  </p>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* 9. Other Payments Card */}
        <Card className="col-span-1 md:col-span-2 lg:col-span-3">
          <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4">{t('accounting.section_other_payments') || 'Cuentas por Cobrar de Aplicaciones, Tarjetas de Regalo y EBT'}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm divide-y divide-slate-100 dark:divide-slate-800">
              <thead>
                <tr className="text-left text-slate-500 dark:text-slate-400 text-xs uppercase font-bold">
                  <th className="pb-2.5">{t('accounting.col_channel_method') || 'Canal / Método'}</th>
                  <th className="pb-2.5 text-right">{t('accounting.col_gross_amount') || 'Monto Bruto'}</th>
                  <th className="pb-2.5 text-right">{t('accounting.col_tax_withheld') || 'Impuesto Retenido'}</th>
                  <th className="pb-2.5 text-right">{t('accounting.col_net_ar') || 'Neto A/R'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
                <tr>
                  <td className="py-2.5 font-sans font-bold text-slate-800 dark:text-slate-200">Uber Eats</td>
                  <td className="py-2.5 text-right font-semibold">{formatCurrency(packet.uber_payment)}</td>
                  <td className="py-2.5 text-right text-rose-600 dark:text-rose-400 font-semibold">-{formatCurrency(packet.facilitator_tax_paid)}</td>
                  <td className="py-2.5 text-right font-bold text-slate-900 dark:text-white">{formatCurrency(packet.uber_payment - packet.facilitator_tax_paid)}</td>
                </tr>
                <tr>
                  <td className="py-2.5 font-sans font-bold text-slate-800 dark:text-slate-200">DoorDash</td>
                  <td className="py-2.5 text-right font-semibold">{formatCurrency(packet.doordash_payment)}</td>
                  <td className="py-2.5 text-right text-slate-400">$0.00</td>
                  <td className="py-2.5 text-right font-bold text-slate-900 dark:text-white">{formatCurrency(packet.doordash_payment)}</td>
                </tr>
                <tr>
                  <td className="py-2.5 font-sans font-bold text-slate-800 dark:text-slate-200">GrubHub</td>
                  <td className="py-2.5 text-right font-semibold">{formatCurrency(packet.grubhub_payment)}</td>
                  <td className="py-2.5 text-right text-slate-400">$0.00</td>
                  <td className="py-2.5 text-right font-bold text-slate-900 dark:text-white">{formatCurrency(packet.grubhub_payment)}</td>
                </tr>
                <tr>
                  <td className="py-2.5 font-sans font-bold text-slate-800 dark:text-slate-200">EBT</td>
                  <td className="py-2.5 text-right font-semibold">{formatCurrency(packet.ebt_amount)}</td>
                  <td className="py-2.5 text-right text-slate-400">$0.00</td>
                  <td className="py-2.5 text-right font-bold text-slate-900 dark:text-white">{formatCurrency(packet.ebt_amount)}</td>
                </tr>
                {packet.journal_lines?.some((l: any) => l.memo.includes('Gift Card')) && (
                  <tr>
                    <td className="py-2.5 font-sans font-bold text-emerald-700 dark:text-emerald-400">{t('accounting.gift_cards_redeemed') || 'Tarjetas de Regalo Canjeadas (Gift Cards)'}</td>
                    <td className="py-2.5 text-right font-semibold text-emerald-700 dark:text-emerald-400">
                      {formatCurrency(packet.journal_lines.find((l: any) => l.memo.includes('Gift Card') && l.debit > 0)?.debit || 0)}
                    </td>
                    <td className="py-2.5 text-right text-slate-400">$0.00</td>
                    <td className="py-2.5 text-right font-bold text-emerald-700 dark:text-emerald-400">
                      {formatCurrency(packet.journal_lines.find((l: any) => l.memo.includes('Gift Card') && l.debit > 0)?.debit || 0)}
                    </td>
                  </tr>
                )}
                {(() => {
                  const openOrdersDebit = Number((packet.qb_sync_response as any)?.deposits_collected ?? packet.journal_lines?.find((l: any) => (l.account === '12049' || l.memo?.includes('Deposit Sales Collected')) && l.debit > 0)?.debit ?? 0)
                  if (openOrdersDebit <= 0) return null
                  return (
                    <tr>
                      <td className="py-2.5 font-sans font-bold text-amber-700 dark:text-amber-400">
                        {language === 'en' ? 'Deposit Sales Collected & Open Orders' : 'Órdenes Abiertas y Depósitos Cobrados (12049)'}
                      </td>
                      <td className="py-2.5 text-right font-semibold text-amber-700 dark:text-amber-400">
                        {formatCurrency(openOrdersDebit)}
                      </td>
                      <td className="py-2.5 text-right text-slate-400">$0.00</td>
                      <td className="py-2.5 text-right font-bold text-amber-700 dark:text-amber-400">
                        {formatCurrency(openOrdersDebit)}
                      </td>
                    </tr>
                  )
                })()}
                <tr className="font-extrabold text-slate-900 dark:text-white border-t-2 border-slate-200 dark:border-slate-700">
                  <td className="py-2.5 font-sans" colSpan={3}>{t('accounting.non_cash_payments_total') || 'Total Pagos No Efectivo'}</td>
                  <td className="py-2.5 text-right text-blue-600 dark:text-blue-400">
                    {formatCurrency(
                      (packet.credit_card_deposit ?? packet.cc_deposit ?? 0) +
                      (packet.credit_card_fees ?? packet.cc_fees ?? 0) +
                      (packet.uber_payment ?? 0) +
                      (packet.doordash_payment ?? 0) +
                      (packet.grubhub_payment ?? 0) +
                      (packet.ebt_amount ?? 0) +
                      (packet.journal_lines?.find((l: any) => l.memo.includes('Gift Card') && l.debit > 0)?.debit || 0) +
                      Number((packet.qb_sync_response as any)?.deposits_collected ?? packet.journal_lines?.find((l: any) => (l.account === '12049' || l.memo?.includes('Deposit Sales Collected')) && l.debit > 0)?.debit ?? 0)
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* 9. Sales Journal Table */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-black text-slate-900 dark:text-white">{t('accounting.section_journal') || 'Póliza de Diario (17 Cuentas Contables)'}</h2>
          <Badge className={isBalanced ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800' : 'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800'}>
            {isBalanced ? (t('accounting.label_balanced') || 'Balanceada ✓') : (t('accounting.label_unbalanced') || '¡Desbalanceada!')}
          </Badge>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm divide-y divide-slate-100 dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400">
              <tr className="text-left">
                <th className="py-3 px-3 font-bold">{t('accounting.col_account') || 'Cuenta'}</th>
                <th className="py-3 px-3 font-bold">{t('accounting.col_memo') || 'Memo'}</th>
                <th className="py-3 px-3 text-right font-bold">{t('accounting.col_debit') || 'Débito'}</th>
                <th className="py-3 px-3 text-right font-bold">{t('accounting.col_credit') || 'Crédito'}</th>
                <th className="py-3 px-3 pl-4 font-bold">{t('accounting.col_source_memo') || 'Source Memo'}</th>
                <th className="py-3 px-3 font-bold text-amber-600 dark:text-amber-400">{t('accounting.col_entity_name') || 'Name (Entity)'}</th>
                <th className="py-3 px-3 font-bold">{t('accounting.col_location') || 'Ubicación'}</th>
                <th className="py-3 px-3 font-bold">{t('accounting.col_class') || 'Clase'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
              {packet.journal_lines?.map((line, idx) => (
                <tr key={idx} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="py-2.5 px-3 font-bold text-blue-600 dark:text-blue-400">{line.account}</td>
                  <td className="py-2.5 px-3 font-sans font-semibold text-slate-800 dark:text-slate-200">{line.memo}</td>
                  <td className="py-2.5 px-3 text-right text-emerald-600 dark:text-emerald-400 font-bold">{line.debit ? formatCurrency(line.debit) : '—'}</td>
                  <td className="py-2.5 px-3 text-right text-sky-600 dark:text-sky-400 font-bold">{line.credit ? formatCurrency(line.credit) : '—'}</td>
                  <td className="py-2.5 px-3 pl-4 font-sans text-slate-500 dark:text-slate-400 text-xs">{line.sourceMemo}</td>
                  <td className="py-2.5 px-3 font-sans text-xs font-bold text-amber-600 dark:text-amber-400">
                    {line.account === '13200' ? (getQBStoreRefs(packet.stores?.name || '').cohCustomerName) : '—'}
                  </td>
                  <td className="py-2.5 px-3 font-sans text-slate-600 dark:text-slate-300 text-xs font-semibold">{line.location}</td>
                  <td className="py-2.5 px-3 font-sans text-slate-600 dark:text-slate-300 text-xs font-semibold">{line.className || line.class}</td>
                </tr>
              ))}
              <tr className="font-extrabold border-t-2 border-slate-200 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-900/80 text-base text-slate-900 dark:text-white">
                <td className="py-3.5 px-3 font-sans" colSpan={2}>{t('accounting.label_journal_totals') || 'Totales de la Póliza'}</td>
                <td className="py-3.5 px-3 text-right text-emerald-600 dark:text-emerald-400">{formatCurrency(packet.journal_total_debits)}</td>
                <td className="py-3.5 px-3 text-right text-sky-600 dark:text-sky-400">{formatCurrency(packet.journal_total_credits)}</td>
                <td colSpan={4} className="py-3.5 px-3 text-center text-xs font-sans text-slate-500 dark:text-slate-400">
                  {isBalanced ? (t('accounting.balanced_perfect') || '✓ Cuadre exacto al centavo ($0.00 diferencia)') : (t('accounting.unbalanced_warning') || '⚠️ Descuadre detectado')}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
      
    </div>
  )
}
