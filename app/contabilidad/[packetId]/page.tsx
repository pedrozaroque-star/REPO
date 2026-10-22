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
import { Loader2, ArrowLeft, Send, RefreshCw, CheckCircle2, AlertTriangle, AlertCircle, Download, Printer, RotateCcw } from 'lucide-react'
import * as xlsx from 'xlsx'

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
  deferred_gift_cards?: number
  tips_payable?: number
  
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
  credit_card_other_deductions?: number
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
  cash_payouts_total?: number
  cash_payouts?: Array<{ amount: number; reason?: string; comment?: string }>
  
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
    fetchPacket(true)
  }, [packetId])

  const fetchPacket = async (autoCheckToast = false) => {
    if (autoCheckToast) setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/accounting/packets/${packetId}`)
      if (!res.ok) throw new Error('Failed to fetch packet')
      const data = await res.json()
      const pkt: Packet = data.packet
      setPacket(pkt)
      setLoading(false)

      // Si al entrar al paquete el depósito en banco aún aparece en $0.00, verificar automáticamente
      // en segundo plano si la sucursal ya lo capturó en Toast POS Cash Management:
      if (
        autoCheckToast &&
        pkt &&
        pkt.status !== 'published' &&
        Number(pkt.cash_deposit || 0) <= 0 &&
        Number(pkt.expected_cash || 0) > 0
      ) {
        try {
          const syncRes = await fetch(`/api/accounting/packets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              startDate: pkt.business_date,
              endDate: pkt.business_date,
              storeIds: [pkt.store_id],
            }),
          })
          if (syncRes.ok) {
            const refreshedRes = await fetch(`/api/accounting/packets/${packetId}`)
            if (refreshedRes.ok) {
              const refreshedData = await refreshedRes.json()
              if (refreshedData.packet) {
                setPacket(refreshedData.packet)
              }
            }
          }
        } catch {
          // Silent background check
        }
      }
    } catch (err: any) {
      setError(err.message || 'Error fetching packet')
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

  const handleExportExcel = () => {
    if (!packet || !packet.journal_lines || packet.journal_lines.length === 0) return
    
    // Cohesion exact 6 canonical columns: Account, Debit, Credit, Description, SalesTaxVendorName, SourceMemo
    const exportRows = packet.journal_lines.map((line: any) => ({
      Account: line.account,
      Debit: line.debit > 0 ? Number(line.debit) : 0.0,
      Credit: line.credit > 0 ? Number(line.credit) : 0.0,
      Description: line.memo || '',
      SalesTaxVendorName: '',
      SourceMemo: line.sourceMemo || '',
    }))

    const ws = xlsx.utils.json_to_sheet(exportRows, { header: ['Account', 'Debit', 'Credit', 'Description', 'SalesTaxVendorName', 'SourceMemo'] })
    const wb = xlsx.utils.book_new()
    xlsx.utils.book_append_sheet(wb, ws, 'Sales Journal')
    
    const storeNameClean = (packet.stores?.name || 'Store').replace(/[^a-zA-Z0-9]/g, '_')
    const fileName = `Poliza_${storeNameClean}_${packet.business_date}.xlsx`
    xlsx.writeFile(wb, fileName)
  }

  const handlePrint = () => {
    window.print()
  }

  const handleReopen = async () => {
    if (!packet) return
    const confirmMsg = language === 'en'
      ? 'Are you sure you want to reopen this journal entry for editing and review?'
      : '¿Estás seguro de que deseas reabrir esta póliza para edición y revisión?'
    if (!window.confirm(confirmMsg)) return

    setActionLoading(true)
    setPublishMessage(null)
    try {
      const res = await fetch(`/api/accounting/packets/${packetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ready' })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to reopen packet')
      setPublishMessage({
        type: 'success',
        text: language === 'en' ? 'Packet reopened successfully!' : '¡Póliza reabierta exitosamente!'
      })
      await fetchPacket()
    } catch (err: any) {
      setPublishMessage({ type: 'error', text: err.message || 'Error reopening packet' })
    } finally {
      setActionLoading(false)
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
  const isDepositPending = Number(packet.cash_deposit || 0) <= 0 && Number(packet.expected_cash || 0) > 0
  const isDepositToast = Number(packet.cash_deposit || 0) > 0

  const validation = (packet.qb_sync_response as any)?.validation
  const hasOpenOrders = Boolean(
    validation?.hasOpenOrders ||
    (validation?.openOrdersCount && validation.openOrdersCount > 0) ||
    (validation?.outOfBalanceOrdersCount && validation.outOfBalanceOrdersCount > 0) ||
    (packet as any).has_open_orders
  )
  const openOrdersList = validation?.openOrders || []

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
        <div className="flex items-center gap-2 flex-wrap">
          {isDepositPending && packet.status !== 'published' && (
            <Badge className="px-3 py-1 text-xs bg-amber-50 text-amber-800 border-2 border-amber-400/60 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-600/70 font-bold flex items-center gap-1 shadow-sm">
              <AlertCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              {t('accounting.status_pending_deposit') || 'Depósito Pendiente'}
            </Badge>
          )}
          {hasOpenOrders && packet.status !== 'published' && (
            <Badge className="px-3 py-1 text-xs bg-rose-50 text-rose-800 border-2 border-rose-400/60 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-600/70 font-bold flex items-center gap-1 shadow-sm">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
              {t('accounting.status_open_orders') || 'Órdenes Abiertas'}
            </Badge>
          )}
          <Badge className={`capitalize px-4 py-1.5 text-sm ${getStatusColor(packet.status)}`}>
            {t(`accounting.status_${packet.status}`) || packet.status}
          </Badge>
        </div>
      </div>

      {/* Pending Toast Bank Deposit Lock Banner */}
      {isDepositPending && packet.status !== 'published' && (
        <div className="bg-amber-500/10 border-2 border-amber-500/40 dark:border-amber-500/30 rounded-2xl p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-amber-500 text-white rounded-xl shrink-0 mt-0.5 shadow-md">
              <AlertCircle className="w-6 h-6 stroke-[2.5]" />
            </div>
            <div className="space-y-2 flex-1">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <h3 className="text-base font-black tracking-tight text-amber-950 dark:text-amber-200 flex items-center gap-2">
                  <span>
                    {language === 'en'
                      ? '🔒 Publishing Locked — Bank Deposit Pending in Toast POS'
                      : '🔒 Publicación Bloqueada — Depósito en Banco Pendiente en Toast POS'}
                  </span>
                  <span className="bg-amber-500 text-white text-xs font-black px-2.5 py-0.5 rounded-full">
                    {language === 'en' ? 'Expected:' : 'Esperado:'} {formatCurrency(packet.expected_cash)}
                  </span>
                </h3>
              </div>
              <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed font-medium">
                {language === 'en'
                  ? `This store has an Expected Cash of ${formatCurrency(packet.expected_cash)}, but the Bank Deposit ($0.00) has not yet been recorded in Toast POS Cash Management. Publishing to QuickBooks is locked until the deposit is entered in Toast POS. Once entered in Toast, click "Recalculate" to pull the deposit and unlock publishing.`
                  : `Esta sucursal tiene un Efectivo Esperado de ${formatCurrency(packet.expected_cash)}, pero aún no ha registrado su Depósito en Banco ($0.00) en Toast POS. La publicación a QuickBooks está bloqueada hasta que el depósito esté capturado en Toast POS. En cuanto la sucursal lo registre en Toast, presiona "Recalcular" para actualizar el depósito y habilitar la publicación.`}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Open Orders Alert Card (Step 11 Operational Warning) */}
      {hasOpenOrders && packet.status !== 'published' && (
        <div className="bg-rose-500/10 border-2 border-rose-500/40 dark:border-rose-500/30 rounded-2xl p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-rose-500 text-white rounded-xl shrink-0 mt-0.5 shadow-md">
              <AlertTriangle className="w-6 h-6 stroke-[2.5]" />
            </div>
            <div className="space-y-3 flex-1">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <h3 className="text-base font-black tracking-tight text-rose-950 dark:text-rose-200 flex items-center gap-2">
                  <span>{language === 'en' ? '⚠️ Open / Out of Balance Orders in Toast POS' : '⚠️ Órdenes Abiertas o Desbalanceadas en Toast POS'}</span>
                  <span className="bg-rose-500 text-white text-xs font-black px-2.5 py-0.5 rounded-full">
                    {validation?.openOrdersCount || openOrdersList.length} {language === 'en' ? 'orders' : 'órdenes'}
                  </span>
                </h3>
              </div>
              <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed font-medium">
                {language === 'en' 
                  ? 'There are unclosed tickets or out-of-balance checks in Toast POS for this business date. The variance is automatically assigned to account 12049 (Deposit Sales Collected & Open Orders) so the journal balances.'
                  : 'Existen tickets sin cerrar o cheques desbalanceados en Toast POS para esta fecha comercial. La diferencia se asigna automáticamente a la cuenta 12049 (Depósitos Cobrados y Órdenes Abiertas) para cuadrar la póliza.'}
              </p>
              {openOrdersList.length > 0 && (
                <div className="mt-2 overflow-x-auto max-h-48 overflow-y-auto rounded-xl border border-rose-200 dark:border-rose-800/60 bg-white/80 dark:bg-slate-900/80">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-300 font-bold border-b border-rose-100 dark:border-rose-900">
                      <tr>
                        <th className="px-3 py-2"># Orden</th>
                        <th className="px-3 py-2">Cajero / Mesero</th>
                        <th className="px-3 py-2">Estado</th>
                        <th className="px-3 py-2 text-right">Total</th>
                        <th className="px-3 py-2">Motivo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-rose-100 dark:divide-rose-900/40 font-mono">
                      {openOrdersList.map((ord: any, idx: number) => (
                        <tr key={idx} className="hover:bg-rose-50/50 dark:hover:bg-rose-950/30">
                          <td className="px-3 py-1.5 font-bold text-slate-800 dark:text-slate-200">{ord.orderNumber}</td>
                          <td className="px-3 py-1.5 font-sans text-slate-600 dark:text-slate-400">{ord.serverName}</td>
                          <td className="px-3 py-1.5">
                            <span className="px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-900/60 text-rose-700 dark:text-rose-300 font-semibold text-[10px]">
                              {ord.status}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-right font-bold text-slate-900 dark:text-white">${Number(ord.totalAmount || 0).toFixed(2)}</td>
                          <td className="px-3 py-1.5 font-sans text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-xs">{ord.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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


      {publishMessage && (
        <div className={`p-4 rounded-xl flex items-center gap-3 border shadow-sm ${publishMessage.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800/60' : 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-800/60'}`}>
          {publishMessage.type === 'success' ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" /> : <AlertTriangle className="h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />}
          <span className="text-sm font-semibold">{publishMessage.text}</span>
        </div>
      )}

      {/* 2. Action Buttons Row */}
      <div className="flex flex-wrap items-center justify-end gap-3 print:hidden">
        {/* Export to Excel */}
        <Button 
          variant="outline" 
          onClick={handleExportExcel}
          title={language === 'en' ? 'Export Journal Entry to Excel (.xlsx)' : 'Exportar Póliza a Excel (.xlsx)'}
        >
          <Download className="mr-2 h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          {t('accounting.btn_export_excel') || 'Exportar a Excel'}
        </Button>

        {/* Print */}
        <Button 
          variant="outline" 
          onClick={handlePrint}
          title={language === 'en' ? 'Print or Save as PDF' : 'Imprimir o Guardar como PDF'}
        >
          <Printer className="mr-2 h-4 w-4 text-slate-600 dark:text-slate-300" />
          {t('accounting.btn_print') || 'Imprimir'}
        </Button>

        {/* Reopen button if published or rejected */}
        {(packet.status === 'published' || packet.status === 'rejected') && (
          <Button 
            variant="outline" 
            onClick={handleReopen} 
            disabled={actionLoading}
            className="text-amber-600 border-amber-300 hover:bg-amber-50 dark:border-amber-700 dark:hover:bg-amber-950/40"
          >
            {actionLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
            {t('accounting.btn_reopen') || 'Reabrir Póliza'}
          </Button>
        )}

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
            disabled={publishing || !isBalanced || isDepositPending} 
            title={
              isDepositPending
                ? (language === 'en'
                    ? 'Cannot publish to QuickBooks until the Bank Deposit is recorded in Toast POS'
                    : 'No se puede publicar a QuickBooks hasta que el Depósito en Banco esté registrado en Toast POS')
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
            {isDepositPending
              ? (language === 'en' ? 'Publish Locked (Pending Toast Deposit)' : 'Publicación Bloqueada (Falta Depósito en Toast)')
              : (t('accounting.btn_publish') || 'Publicar a QuickBooks')}
          </Button>
        )}

        {packet.status === 'published' && (
          <div className="bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800 px-4 py-2 rounded-xl text-sm font-bold flex items-center">
            <CheckCircle2 className="w-4 h-4 mr-2 text-emerald-600 dark:text-emerald-400" />
            {t('accounting.status_published_qb') || 'Publicada en QuickBooks Online'}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* 3. Reconciliation Summary Card (Gross Sales & Receipts - 1:1 Cohesion) */}
        <Card>
          <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4">{t('accounting.section_summary') || 'Resumen de Conciliación'}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800 text-xs uppercase font-bold">
                  <th className="pb-2 pr-2 text-left">{t('accounting.col_item') || 'Concepto'}</th>
                  <th className="pb-2 px-2 text-right">{t('accounting.label_gross') || 'Bruto'}</th>
                  <th className="pb-2 pl-2 text-right">{t('accounting.label_net') || 'Neto'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
                <tr>
                  <td className="py-2 pr-2 font-sans text-slate-700 dark:text-slate-300 font-medium">{t('accounting.col_net_sales') || 'Ventas'}</td>
                  <td className="py-2 px-2 text-right font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">{formatCurrency(packet.gross_sales)}</td>
                  <td className="py-2 pl-2 text-right font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">{formatCurrency(packet.net_sales)}</td>
                </tr>
                <tr className="text-rose-600 dark:text-rose-400">
                  <td className="py-2 pr-2 font-sans font-medium">{t('accounting.section_discounts') || 'Ventas - Descuentos'}</td>
                  <td className="py-2 px-2 text-right font-semibold whitespace-nowrap">-{formatCurrency(packet.total_discounts ?? packet.discounts ?? 0)}</td>
                  <td className="py-2 pl-2 text-right font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">{formatCurrency(0)}</td>
                </tr>
                {(() => {
                  const paidInLine = packet.journal_lines?.find((l: any) => 
                    l.memo?.toLowerCase().includes('paid in') || 
                    l.sourceMemo?.toLowerCase().includes('paid in')
                  )
                  const paidInFromLine = paidInLine
                    ? Math.round((Number(paidInLine.credit || 0) - Number(paidInLine.debit || 0)) * 100) / 100
                    : undefined
                  const paidInAmount = Number(
                    packet.paid_in ?? 
                    (packet.qb_sync_response as any)?.validation?.paid_in ?? 
                    (packet.qb_sync_response as any)?.paidIn ?? 
                    paidInFromLine ?? 
                    0
                  )
                  const giftCardLine = packet.journal_lines?.find((l: any) => 
                    l.sourceMemo === 'Deferred: Gift Cards' ||
                    l.sourceMemo === 'Deferred Sales: Gift Cards' ||
                    (l.account === '20500' && l.credit > 0)
                  )
                  const giftCardsAmount = Number(
                    packet.deferred_gift_cards ?? 
                    giftCardLine?.credit ?? 
                    0
                  )
                  const tipsLine = packet.journal_lines?.find((l: any) => 
                    l.sourceMemo === 'Tips Payable' || l.memo?.toLowerCase().includes('tips/grat payable')
                  )
                  const tipsPayableAmount = Number(
                    packet.tips_payable ?? 
                    tipsLine?.credit ?? 
                    0
                  )
                  const netPlusDeferred = Number(packet.net_sales || 0) + giftCardsAmount
                  const totalGrossReceipts = Number(packet.net_sales || 0) + Number(packet.total_taxes || 0) + paidInAmount + giftCardsAmount + tipsPayableAmount

                  return (
                    <>
                      {giftCardsAmount > 0 && (
                        <tr className="text-amber-600 dark:text-amber-400">
                          <td className="py-2 pr-2 font-sans font-medium">{t('accounting.label_gift_cards_deferred') || 'Deferred Sales - Gift Cards'}</td>
                          <td className="py-2 px-2 text-right font-semibold whitespace-nowrap">{formatCurrency(giftCardsAmount)}</td>
                          <td className="py-2 pl-2 text-right font-semibold whitespace-nowrap">{formatCurrency(giftCardsAmount)}</td>
                        </tr>
                      )}
                      <tr className="font-bold text-slate-900 dark:text-white bg-slate-50/50 dark:bg-slate-800/30">
                        <td className="py-2 pr-2 font-sans">Net Sales + Deferred</td>
                        <td className="py-2 px-2 text-right"></td>
                        <td className="py-2 pl-2 text-right text-blue-600 dark:text-blue-400 whitespace-nowrap">{formatCurrency(netPlusDeferred)}</td>
                      </tr>
                      <tr>
                        <td className="py-2 pr-2 font-sans text-slate-700 dark:text-slate-300 font-medium">{t('accounting.col_taxes') || 'Impuestos'}</td>
                        <td className="py-2 px-2 text-right font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">{formatCurrency(packet.total_taxes)}</td>
                        <td className="py-2 pl-2 text-right font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">{formatCurrency(packet.total_taxes)}</td>
                      </tr>
                      {tipsPayableAmount > 0 && (
                        <tr className="text-indigo-600 dark:text-indigo-400">
                          <td className="py-2 pr-2 font-sans font-medium">{t('accounting.label_tips_payable') || 'Tips/Grat Payable'}</td>
                          <td className="py-2 px-2 text-right font-semibold whitespace-nowrap">{formatCurrency(tipsPayableAmount)}</td>
                          <td className="py-2 pl-2 text-right font-semibold whitespace-nowrap">{formatCurrency(tipsPayableAmount)}</td>
                        </tr>
                      )}
                      {Math.abs(paidInAmount) > 0 && (
                        <tr className={paidInAmount > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                          <td className="py-2 pr-2 font-sans font-medium">{t('accounting.label_paid_in') || 'Paid In Total (Deposits Received)'}</td>
                          <td className="py-2 px-2 text-right font-semibold whitespace-nowrap">{formatCurrency(paidInAmount)}</td>
                          <td className="py-2 pl-2 text-right font-semibold whitespace-nowrap">{formatCurrency(paidInAmount)}</td>
                        </tr>
                      )}
                      <tr className="font-extrabold text-slate-900 dark:text-white border-t-2 border-slate-200 dark:border-slate-700 text-sm">
                        <td className="py-2.5 pr-2 font-sans">{t('accounting.col_total_gross_receipts') || 'Total Gross Receipts'}</td>
                        <td className="py-2.5 px-2 text-right"></td>
                        <td className="py-2.5 pl-2 text-right whitespace-nowrap">{formatCurrency(totalGrossReceipts)}</td>
                      </tr>
                    </>
                  )
                })()}
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
                  <th className="pb-2 pr-2 text-left">{t('accounting.col_channel_method') || 'Canal'}</th>
                  <th className="pb-2 px-2 text-right">{t('accounting.label_gross') || 'Bruto'}</th>
                  <th className="pb-2 pl-2 text-right">{t('accounting.label_net') || 'Neto'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
                {(() => {
                  const grossMap: Record<string, number> = (packet.qb_sync_response as any)?.sales_gross_by_option || {}

                  // Helper para obtener el importe Neto exacto desde journal_lines
                  const getNetFromJournal = (searchMemos: string[], fallback: number = 0) => {
                    const line = packet.journal_lines?.find((l: any) => {
                      const m = (l.memo || '').toLowerCase().trim()
                      const sm = (l.sourceMemo || '').toLowerCase().trim()
                      return searchMemos.some(term => {
                        const tLower = term.toLowerCase().trim()
                        return m === tLower || sm === tLower || sm === `dining option: ${tLower}` || sm === `service charge: ${tLower}`
                      })
                    })
                    return line ? Math.round((Number(line.credit || 0) - Number(line.debit || 0)) * 100) / 100 : fallback
                  }

                  const forHereNet = Number(packet.dine_in_sales ?? getNetFromJournal(['for here'], 0))
                  const toGoNet = Number(packet.togo_sales ?? getNetFromJournal(['to go'], 0))
                  const phoneNet = Number(getNetFromJournal(['phone'], 0))
                  const curbsideNet = Number(getNetFromJournal(['curbside pickup'], 0))
                  const driveThruNet = Number(packet.drive_thru_sales ?? getNetFromJournal(['drive thru'], 0))
                  const kioskDineInNet = Number(packet.kiosk_dine_in_sales ?? getNetFromJournal(['kiosk dine in'], 0))
                  const kioskTakeOutNet = Number(packet.kiosk_takeout_sales ?? getNetFromJournal(['kiosk take out'], 0))
                  const toastOnlineNet = Number(packet.toast_online_sales ?? getNetFromJournal(['toast online'], 0))
                  const onlineOrderingTakeoutNet = Number(getNetFromJournal(['online ordering - takeout'], 0))
                  const toastDeliveryNet = Number(packet.toast_delivery_sales ?? getNetFromJournal(['toast delivery services'], 0))
                  const deliveryServiceNet = Number(getNetFromJournal(['delivery service', 'delivery charge'], 0))
                  const uberDeliveryNet = Number(packet.uber_delivery_sales ?? getNetFromJournal(['uber eats - delivery'], 0))
                  const uberTakeoutNet = Number(packet.uber_takeout_sales ?? getNetFromJournal(['uber eats takeout', 'uber eats - takeout'], 0))
                  const ddDeliveryNet = Number(packet.doordash_delivery_sales ?? getNetFromJournal(['doordash - delivery'], 0))
                  const ddTakeoutNet = Number(packet.doordash_takeout_sales ?? getNetFromJournal(['doordash - takeout'], 0))
                  const ghTakeoutNet = Number(getNetFromJournal(['grubhub - takeout'], 0))
                  const ghDeliveryNet = Number(getNetFromJournal(['grubhub delivery', 'grubhub - delivery'], Math.max(0, Number(packet.grubhub_sales || 0) - ghTakeoutNet)))

                  const rows = [
                    ...(Math.abs(curbsideNet) > 0 || grossMap.curbside ? [{ name: 'Curbside Pickup', gross: grossMap.curbside ?? curbsideNet, net: curbsideNet }] : []),
                    ...(Math.abs(deliveryServiceNet) > 0 ? [{ name: 'Delivery Service', gross: deliveryServiceNet, net: deliveryServiceNet }] : []),
                    { name: 'DoorDash - Delivery', gross: grossMap.doordashDelivery ?? ddDeliveryNet, net: ddDeliveryNet },
                    ...(Math.abs(ddTakeoutNet) > 0 || grossMap.doordashTakeout ? [{ name: 'DoorDash - Takeout', gross: grossMap.doordashTakeout ?? ddTakeoutNet, net: ddTakeoutNet }] : []),
                    { name: 'For Here', gross: grossMap.forHere ?? forHereNet, net: forHereNet },
                    ...(Math.abs(ghDeliveryNet) > 0 || grossMap.grubhubDelivery ? [{ name: 'GrubHub Delivery', gross: grossMap.grubhubDelivery ?? ghDeliveryNet, net: ghDeliveryNet }] : []),
                    ...(Math.abs(ghTakeoutNet) > 0 || grossMap.grubhubTakeout ? [{ name: 'Grubhub - Takeout', gross: grossMap.grubhubTakeout ?? ghTakeoutNet, net: ghTakeoutNet }] : []),
                    ...(Math.abs(driveThruNet) > 0 || grossMap.driveThru ? [{ name: 'Drive Thru', gross: grossMap.driveThru ?? driveThruNet, net: driveThruNet }] : []),
                    ...(Math.abs(kioskDineInNet) > 0 || grossMap.kioskDineIn ? [{ name: 'Kiosk Dine In', gross: grossMap.kioskDineIn ?? kioskDineInNet, net: kioskDineInNet }] : []),
                    ...(Math.abs(kioskTakeOutNet) > 0 || grossMap.kioskTakeOut ? [{ name: 'Kiosk Take Out', gross: grossMap.kioskTakeOut ?? kioskTakeOutNet, net: kioskTakeOutNet }] : []),
                    ...(Math.abs(onlineOrderingTakeoutNet) > 0 || grossMap.onlineOrderingTakeout ? [{ name: 'Online Ordering - Takeout', gross: grossMap.onlineOrderingTakeout ?? onlineOrderingTakeoutNet, net: onlineOrderingTakeoutNet }] : []),
                    ...(Math.abs(phoneNet) > 0 || grossMap.phone ? [{ name: 'Phone', gross: grossMap.phone ?? phoneNet, net: phoneNet }] : []),
                    { name: 'To Go', gross: grossMap.toGo ?? toGoNet, net: toGoNet },
                    ...(Math.abs(toastDeliveryNet) > 0 || grossMap.toastDelivery ? [{ name: 'Toast Delivery Services', gross: grossMap.toastDelivery ?? toastDeliveryNet, net: toastDeliveryNet }] : []),
                    ...(Math.abs(toastOnlineNet) > 0 || grossMap.toastOnline ? [{ name: 'Toast Online', gross: grossMap.toastOnline ?? toastOnlineNet, net: toastOnlineNet }] : []),
                    { name: 'Uber Eats - Delivery', gross: grossMap.uberDelivery ?? uberDeliveryNet, net: uberDeliveryNet },
                    ...(Math.abs(uberTakeoutNet) > 0 || grossMap.uberTakeout ? [{ name: 'Uber Eats Takeout', gross: grossMap.uberTakeout ?? uberTakeoutNet, net: uberTakeoutNet }] : []),
                  ]
                  return (
                    <>
                      {rows.map((r, i) => (
                        <tr key={i}>
                          <td className="py-2 pr-2 font-sans text-slate-700 dark:text-slate-300 font-medium">{r.name}</td>
                          <td className="py-2 px-2 text-right font-semibold text-slate-800 dark:text-slate-200">{formatCurrency(r.gross)}</td>
                          <td className="py-2 pl-2 text-right font-semibold text-slate-800 dark:text-slate-200">{formatCurrency(r.net)}</td>
                        </tr>
                      ))}
                      <tr className="font-extrabold text-blue-600 dark:text-blue-400 border-t-2 border-slate-200 dark:border-slate-700">
                        <td className="py-2.5 pr-2 font-sans">{t('accounting.total_net_sales') || 'Total Sales'}</td>
                        <td className="py-2.5 px-2 text-right">{formatCurrency(packet.gross_sales)}</td>
                        <td className="py-2.5 pl-2 text-right">{formatCurrency(packet.net_sales)}</td>
                      </tr>
                    </>
                  )
                })()}
              </tbody>
            </table>
          </div>
        </Card>

        {/* 5. Discount Details Card (1:1 Cohesion Single Amount Column, Alphabetical) */}
        <Card>
          <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4">{t('accounting.section_discounts') || 'Detalle de Descuentos'}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800 text-xs uppercase font-bold">
                  <th className="pb-2 pr-2 text-left">{t('accounting.col_discount_type') || 'Tipo de Descuento'}</th>
                  <th className="pb-2 pl-2 text-right">{language === 'en' ? 'Amount' : 'Monto'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
                {packet.qb_sync_response?.discount_breakdown && Object.keys(packet.qb_sync_response.discount_breakdown).length > 0 ? (
                  Object.entries(packet.qb_sync_response.discount_breakdown)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([name, amount], idx) => (
                      <tr key={idx}>
                        <td className="py-2 pr-2 font-sans text-slate-700 dark:text-slate-300 font-medium">{name}</td>
                        <td className="py-2 pl-2 text-right font-semibold text-slate-800 dark:text-slate-200">{formatCurrency(amount)}</td>
                      </tr>
                    ))
                ) : (
                  <tr>
                    <td className="py-2 pr-2 font-sans text-slate-700 dark:text-slate-300 font-medium">{t('accounting.section_discounts') || 'Descuentos'}</td>
                    <td className="py-2 pl-2 text-right font-semibold text-slate-800 dark:text-slate-200">{formatCurrency(packet.total_discounts ?? packet.discounts ?? 0)}</td>
                  </tr>
                )}
                <tr className="font-extrabold text-slate-900 dark:text-white border-t-2 border-slate-200 dark:border-slate-700">
                  <td className="py-2.5 pr-2 font-sans">{t('accounting.total_discounts_label') || 'Total Discounts'}</td>
                  <td className="py-2.5 pl-2 text-right">{formatCurrency(packet.total_discounts ?? packet.discounts ?? 0)}</td>
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
              <span className="text-slate-500 dark:text-slate-400">Marketplace Facilitator Taxes Not Paid</span>
              <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">{formatCurrency(packet.marketplace_facilitator_tax)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">{t('accounting.tax_sales_tax_local') || 'Sales Tax'}</span>
              <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">{formatCurrency(packet.sales_tax)}</span>
            </div>
            <div className="flex justify-between text-slate-500 dark:text-slate-400">
              <span>{t('accounting.tax_paid_by_uber') || 'Taxes Paid by Facilitator'}</span>
              <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">{formatCurrency(packet.facilitator_tax_paid)}</span>
            </div>
            <div className="flex justify-between font-extrabold pt-2 border-t-2 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-base">
              <span>{t('accounting.total_taxes_liability') || 'Total Tax Liability'}</span>
              <span className="font-mono">{formatCurrency(packet.total_taxes)}</span>
            </div>
          </div>
        </Card>

        {/* 7. Non-Cash Payments Card (1:1 Cohesion Non-Cash Payments) */}
        <Card>
          <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4">
            {language === 'en' ? 'Non-Cash Payments' : 'Pagos No Efectivo (Non-Cash Payments)'}
          </h2>
          {(() => {
            const ccOtherDedLine = packet.journal_lines?.find((l: any) => l.sourceMemo === 'Credit Cards: Other Deductions' || l.memo === 'Credit Card Other Deductions')
            const ccOtherDed = Number(
              (packet.qb_sync_response as any)?.credit_card_other_deductions ??
              (packet.qb_sync_response as any)?.validation?.credit_card_other_deductions ??
              ccOtherDedLine?.debit ??
              0
            )
            const giftCardRedeem = Number(packet.journal_lines?.find((l: any) => l.memo.includes('Gift Card') && l.debit > 0)?.debit || 0)
            const otherPaymentsGross = Math.round((
              Number(packet.uber_payment || 0) +
              Number(packet.doordash_payment || 0) +
              Number(packet.grubhub_payment || 0) +
              Number(packet.ebt_amount || 0) +
              giftCardRedeem
            ) * 100) / 100
            const depLine = packet.journal_lines?.find((l: any) => l.account === '12049' || l.memo?.includes('Deposit Sales Collected'))
            const openOrdersAmt = Number(
              (packet.qb_sync_response as any)?.validation?.deposits_collected ??
              (packet.qb_sync_response as any)?.deposits_collected ??
              (depLine ? (Number(depLine.debit || 0) - Number(depLine.credit || 0)) : 0)
            )
            const ccDeposit = Number(packet.credit_card_deposit ?? packet.cc_deposit ?? 0)
            const ccFees = Number(packet.credit_card_fees ?? packet.cc_fees ?? 0)
            const totalNonCash = Math.round((ccDeposit + ccFees + ccOtherDed + otherPaymentsGross + openOrdersAmt) * 100) / 100

            const brandOrder = ['VISA', 'MASTERCARD', 'DISCOVER', 'AMEX', 'OTHER']
            const brandLabel: Record<string, string> = {
              VISA: 'Visa',
              MASTERCARD: 'MasterCard',
              DISCOVER: 'Discover',
              AMEX: 'American Express',
              OTHER: 'Other Card',
            }
            const cardEntries = Object.entries(packet.qb_sync_response?.card_breakdown || {}).sort(
              ([a], [b]) => (brandOrder.indexOf(a) === -1 ? 99 : brandOrder.indexOf(a)) - (brandOrder.indexOf(b) === -1 ? 99 : brandOrder.indexOf(b))
            )

            return (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800 text-xs uppercase font-bold">
                      <th className="pb-2 pr-2 text-left">{t('accounting.col_card_brand') || 'Concepto'}</th>
                      <th className="pb-2 px-2 text-right">{t('accounting.label_gross') || 'Bruto'}</th>
                      <th className="pb-2 pl-2 text-right">{t('accounting.col_net_deposit') || 'Depósito'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
                    {cardEntries.map(([brand, bData], idx) => (
                      <tr key={idx}>
                        <td className="py-1.5 pr-2 font-sans font-medium text-slate-700 dark:text-slate-300">{brandLabel[brand] || brand}</td>
                        <td className="py-1.5 px-2 text-right text-slate-800 dark:text-slate-200">{formatCurrency(bData.gross)}</td>
                        <td className="py-1.5 pl-2 text-right text-slate-800 dark:text-slate-200">{formatCurrency(bData.deposit)}</td>
                      </tr>
                    ))}
                    <tr className="font-bold border-t border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white bg-slate-50/50 dark:bg-slate-800/30">
                      <td className="py-2 pr-2 font-sans">Total Credit Cards</td>
                      <td className="py-2 px-2 text-right">{formatCurrency(packet.total_credit_cards_gross ?? packet.cc_gross)}</td>
                      <td className="py-2 pl-2 text-right text-blue-600 dark:text-blue-400">{formatCurrency(ccDeposit)}</td>
                    </tr>
                    <tr>
                      <td className="py-1.5 pr-2 font-sans font-medium text-slate-700 dark:text-slate-300">Credit Card Fees</td>
                      <td className="py-1.5 px-2 text-right"></td>
                      <td className="py-1.5 pl-2 text-right text-slate-800 dark:text-slate-200">{formatCurrency(ccFees)}</td>
                    </tr>
                    {ccOtherDed > 0 && (
                      <tr>
                        <td className="py-1.5 pr-2 font-sans font-medium text-slate-700 dark:text-slate-300">Credit Card Other Deductions</td>
                        <td className="py-1.5 px-2 text-right"></td>
                        <td className="py-1.5 pl-2 text-right text-slate-800 dark:text-slate-200">{formatCurrency(ccOtherDed)}</td>
                      </tr>
                    )}
                    <tr>
                      <td className="py-1.5 pr-2 font-sans font-medium text-slate-700 dark:text-slate-300">Other Payments</td>
                      <td className="py-1.5 px-2 text-right text-slate-800 dark:text-slate-200">{formatCurrency(otherPaymentsGross)}</td>
                      <td className="py-1.5 pl-2 text-right text-slate-800 dark:text-slate-200">{formatCurrency(otherPaymentsGross)}</td>
                    </tr>
                    {Math.abs(openOrdersAmt) >= 0.005 && (
                      <tr>
                        <td className="py-1.5 pr-2 font-sans font-medium text-slate-700 dark:text-slate-300">Deposit Sales Collected &amp; Open Orders</td>
                        <td className="py-1.5 px-2 text-right text-slate-800 dark:text-slate-200">{formatCurrency(Math.abs(openOrdersAmt))}</td>
                        <td className="py-1.5 pl-2 text-right font-semibold text-slate-800 dark:text-slate-200">{formatCurrency(openOrdersAmt)}</td>
                      </tr>
                    )}
                    <tr className="font-extrabold border-t-2 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white">
                      <td className="py-2.5 pr-2 font-sans" colSpan={2}>{t('accounting.non_cash_payments_total') || 'Total Non-Cash Payments'}</td>
                      <td className="py-2.5 pl-2 text-right text-blue-600 dark:text-blue-400">{formatCurrency(totalNonCash)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )
          })()}
        </Card>

        {/* 8. Cash Reconciliation Card */}
        <Card>
          <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4">{t('accounting.section_cash') || 'Conciliación de Efectivo'}</h2>
          {(() => {
            const payoutLines = packet.journal_lines?.filter((l: any) => 
              (l.account === '50006' || l.memo?.toLowerCase().includes('materials and supplies') || l.sourceMemo?.toLowerCase().includes('cash payout')) &&
              l.debit > 0
            ) || []
            const cashPayoutsTotal = Number(
              (packet.qb_sync_response as any)?.cash_payouts_total ??
              payoutLines.reduce((sum: number, l: any) => sum + (Number(l.debit) || 0), 0)
            )
            const rawExpected = Number(packet.expected_cash || 0)
            const expectedCashFromSales = Number(
              (packet.qb_sync_response as any)?.expected_cash_from_sales ??
              (packet.qb_sync_response as any)?.validation?.expected_cash_from_sales ??
              (cashPayoutsTotal > 0 ? rawExpected + cashPayoutsTotal : rawExpected)
            )

            // Cash In, Cash Out & Tip Out de Toast POS Cash Management
            const cashInLine = packet.journal_lines?.find((l: any) => l.account === '12100' && l.memo === 'Cash In' && l.credit > 0)
            const cashOutLine = packet.journal_lines?.find((l: any) => l.account === '12100' && l.memo === 'Cash Out' && l.debit > 0)
            const tipOutLine = packet.journal_lines?.find((l: any) => l.account === '12100' && l.memo === 'Tip Out' && l.debit > 0)
            const cashInAmount = Number(
              (packet.qb_sync_response as any)?.cash_in ??
              (packet.qb_sync_response as any)?.validation?.cash_in ??
              cashInLine?.credit ?? 0
            )
            const cashOutAmount = Number(
              (packet.qb_sync_response as any)?.cash_out ??
              (packet.qb_sync_response as any)?.validation?.cash_out ??
              cashOutLine?.debit ?? 0
            )
            const tipOutAmount = Number(
              (packet.qb_sync_response as any)?.tip_out ??
              (packet.qb_sync_response as any)?.validation?.tip_out ??
              tipOutLine?.debit ?? 0
            )

            const expectedCashDeposit = (packet.qb_sync_response as any)?.expected_cash_deposit !== undefined
              ? Number((packet.qb_sync_response as any).expected_cash_deposit)
              : (cashPayoutsTotal > 0 || cashInAmount > 0 || cashOutAmount > 0 || tipOutAmount > 0
                  ? Math.round((expectedCashFromSales + cashInAmount - cashOutAmount - tipOutAmount - cashPayoutsTotal) * 100) / 100
                  : rawExpected)

            const hasAdjustments = cashPayoutsTotal > 0 || cashInAmount > 0 || cashOutAmount > 0 || tipOutAmount > 0

            return (
              <div className="space-y-4 text-sm">
                {hasAdjustments ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-slate-400">
                        {language === 'en' ? 'Expected Cash From Sales' : 'Efectivo Esperado de Ventas'}
                      </span>
                      <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                        {formatCurrency(expectedCashFromSales)}
                      </span>
                    </div>
                    {cashInAmount > 0 && (
                      <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-semibold">
                        <span>{t('accounting.label_cash_in') || 'Cash In'}</span>
                        <span className="font-mono">+{formatCurrency(cashInAmount)}</span>
                      </div>
                    )}
                    {cashOutAmount > 0 && (
                      <div className="flex justify-between text-rose-600 dark:text-rose-400 font-semibold">
                        <span>{t('accounting.label_cash_out') || 'Cash Out'}</span>
                        <span className="font-mono">-{formatCurrency(cashOutAmount)}</span>
                      </div>
                    )}
                    {tipOutAmount > 0 && (
                      <div className="flex justify-between text-rose-600 dark:text-rose-400 font-semibold">
                        <span>Tip Out</span>
                        <span className="font-mono">-{formatCurrency(tipOutAmount)}</span>
                      </div>
                    )}
                    {cashPayoutsTotal > 0 && (
                      <div className="flex justify-between text-rose-600 dark:text-rose-400 font-semibold">
                        <span>{language === 'en' ? 'Cash Payouts' : 'Gastos en Efectivo (Payouts)'}</span>
                        <span className="font-mono">-{formatCurrency(cashPayoutsTotal)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-slate-900 dark:text-white pt-1 border-t border-slate-100 dark:border-slate-800">
                      <span>{language === 'en' ? 'Expected Cash Deposit' : 'Depósito en Efectivo Esperado'}</span>
                      <span className="font-mono text-emerald-700 dark:text-emerald-400">{formatCurrency(expectedCashDeposit)}</span>
                    </div>
                  </>
                ) : (
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">{t('accounting.label_expected_cash') || 'Efectivo Esperado'}</span>
                    <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{formatCurrency(packet.expected_cash)}</span>
                  </div>
                )}
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
                  <div className="flex items-center gap-2">
                    <span className={`font-mono font-bold text-base ${Number(packet.cash_deposit || 0) > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
                      {formatCurrency(packet.cash_deposit)}
                    </span>
                  </div>
                </div>
                <div className="flex justify-between font-extrabold pt-2 border-t-2 border-slate-200 dark:border-slate-700">
                  <span className="text-slate-900 dark:text-white">{t('accounting.label_cash_over_short') || 'Sobrante / (Faltante)'}</span>
                  <span className={`font-mono text-base ${packet.cash_over_short < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                    {formatCurrency(packet.cash_over_short)}
                  </span>
                </div>

                {isDepositPending && packet.status !== 'published' && (
                  <div className="mt-2 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700/70 text-xs text-amber-800 dark:text-amber-300 font-semibold flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                    <span>
                      {language === 'en'
                        ? 'Publishing to QuickBooks is locked until the Bank Deposit is entered in Toast POS.'
                        : 'Publicación a QuickBooks bloqueada hasta que se capture el Depósito en Banco en Toast POS.'}
                    </span>
                  </div>
                )}

                {/* Detalle de Cash Payouts si existen */}
                {cashPayoutsTotal > 0 && payoutLines.length > 0 && (
                  <div className="mt-3 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 text-xs">
                    <div className="font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center justify-between">
                      <span>{language === 'en' ? 'Cash Payout Details' : 'Detalle de Gastos en Efectivo'}</span>
                      <span className="font-mono text-rose-600 dark:text-rose-400 font-bold">-{formatCurrency(cashPayoutsTotal)}</span>
                    </div>
                    <div className="divide-y divide-slate-200/60 dark:divide-slate-700/60 font-mono">
                      {payoutLines.map((pl: any, idx: number) => (
                        <div key={idx} className="py-1 flex justify-between items-center text-[11px]">
                          <span className="font-sans text-slate-600 dark:text-slate-400 truncate max-w-[200px]" title={pl.memo}>
                            {pl.memo || 'COGS-Materials and Supplies'}
                          </span>
                          <span className="font-bold text-slate-800 dark:text-slate-200">{formatCurrency(pl.debit)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })()}
        </Card>

        {/* 9. Other Payment Details Card (1:1 Cohesion Other Payment Details) */}
        <Card className="col-span-1 lg:col-span-2">
          <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4">
            {language === 'en' ? 'Other Payment Details' : 'Detalle de Otros Pagos (Other Payment Details)'}
          </h2>
          <div className="overflow-x-auto">
            {(() => {
              const giftCardRedeem = Number(packet.journal_lines?.find((l: any) => l.memo.includes('Gift Card') && l.debit > 0)?.debit || 0)
              const uberGross = Number(packet.uber_payment || 0)
              const uberTaxPaid = Number(packet.facilitator_tax_paid || 0)
              const ddGross = Number(packet.doordash_payment || 0)
              const ghGross = Number(packet.grubhub_payment || 0)
              const ebtGross = Number(packet.ebt_amount || 0)
              const totalOtherGross = Math.round((uberGross + ddGross + ghGross + ebtGross + giftCardRedeem) * 100) / 100
              const totalOtherNet = Math.round((totalOtherGross - uberTaxPaid) * 100) / 100

              return (
                <table className="w-full text-sm divide-y divide-slate-100 dark:divide-slate-800">
                  <thead>
                    <tr className="text-left text-slate-500 dark:text-slate-400 text-xs uppercase font-bold">
                      <th className="pb-2.5 pr-2">{t('accounting.col_channel_method') || 'Canal / Método'}</th>
                      <th className="pb-2.5 px-2 text-right">{t('accounting.col_gross_amount') || 'Gross'}</th>
                      <th className="pb-2.5 px-2 text-right">{t('accounting.col_tax_withheld') || 'Taxes Paid'}</th>
                      <th className="pb-2.5 pl-2 text-right">{t('accounting.col_net_ar') || 'Net'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
                    {ddGross > 0 && (
                      <tr>
                        <td className="py-2.5 pr-2 font-sans font-bold text-slate-800 dark:text-slate-200">DoorDash</td>
                        <td className="py-2.5 px-2 text-right font-semibold">{formatCurrency(ddGross)}</td>
                        <td className="py-2.5 px-2 text-right text-slate-400">$0.00</td>
                        <td className="py-2.5 pl-2 text-right font-bold text-slate-900 dark:text-white">{formatCurrency(ddGross)}</td>
                      </tr>
                    )}
                    {ebtGross > 0 && (
                      <tr>
                        <td className="py-2.5 pr-2 font-sans font-bold text-slate-800 dark:text-slate-200">EBT</td>
                        <td className="py-2.5 px-2 text-right font-semibold">{formatCurrency(ebtGross)}</td>
                        <td className="py-2.5 px-2 text-right text-slate-400">$0.00</td>
                        <td className="py-2.5 pl-2 text-right font-bold text-slate-900 dark:text-white">{formatCurrency(ebtGross)}</td>
                      </tr>
                    )}
                    {ghGross > 0 && (
                      <tr>
                        <td className="py-2.5 pr-2 font-sans font-bold text-slate-800 dark:text-slate-200">GrubHub</td>
                        <td className="py-2.5 px-2 text-right font-semibold">{formatCurrency(ghGross)}</td>
                        <td className="py-2.5 px-2 text-right text-slate-400">$0.00</td>
                        <td className="py-2.5 pl-2 text-right font-bold text-slate-900 dark:text-white">{formatCurrency(ghGross)}</td>
                      </tr>
                    )}
                    {uberGross > 0 && (
                      <tr>
                        <td className="py-2.5 pr-2 font-sans font-bold text-slate-800 dark:text-slate-200">Uber Eats</td>
                        <td className="py-2.5 px-2 text-right font-semibold">{formatCurrency(uberGross)}</td>
                        <td className="py-2.5 px-2 text-right text-rose-600 dark:text-rose-400 font-semibold">-{formatCurrency(uberTaxPaid)}</td>
                        <td className="py-2.5 pl-2 text-right font-bold text-slate-900 dark:text-white">{formatCurrency(uberGross - uberTaxPaid)}</td>
                      </tr>
                    )}
                    {giftCardRedeem > 0 && (
                      <tr>
                        <td className="py-2.5 pr-2 font-sans font-bold text-emerald-700 dark:text-emerald-400">{t('accounting.gift_cards_redeemed') || 'Gift Cards'}</td>
                        <td className="py-2.5 px-2 text-right font-semibold text-emerald-700 dark:text-emerald-400">{formatCurrency(giftCardRedeem)}</td>
                        <td className="py-2.5 px-2 text-right text-slate-400">$0.00</td>
                        <td className="py-2.5 pl-2 text-right font-bold text-emerald-700 dark:text-emerald-400">{formatCurrency(giftCardRedeem)}</td>
                      </tr>
                    )}
                    <tr className="font-extrabold text-slate-900 dark:text-white border-t-2 border-slate-200 dark:border-slate-700">
                      <td className="py-2.5 pr-2 font-sans">Total</td>
                      <td className="py-2.5 px-2 text-right">{formatCurrency(totalOtherGross)}</td>
                      <td className="py-2.5 px-2 text-right text-rose-600 dark:text-rose-400">{uberTaxPaid > 0 ? `-${formatCurrency(uberTaxPaid)}` : '$0.00'}</td>
                      <td className="py-2.5 pl-2 text-right text-blue-600 dark:text-blue-400">{formatCurrency(totalOtherNet)}</td>
                    </tr>
                  </tbody>
                </table>
              )
            })()}
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
