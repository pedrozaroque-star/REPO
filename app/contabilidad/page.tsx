/**
 * @module AccountingPage
 * @description Main accounting dashboard for daily sales journal entry management.
 * Shows a grid of 15 stores by 7 dates with packet status badges and allows generating/publishing entries to QuickBooks Online.
 * 
 * @businessRules
 * - Shows weekly view (Monday to Sunday) based on America/Los_Angeles business date.
 * - Stores are loaded from active stores in Supabase.
 * - Packets flow through states: pending → ready → reviewed → published (or rejected).
 * - Publish All sends all ready/reviewed packets for the selected date to QuickBooks Online.
 * - Follows the exact light/dark adaptive theme of the SM TEG design system.
 * 
 * @dataFlow
 * Supabase (stores) + /api/accounting/packets → Grid Table → /contabilidad/[packetId]
 * 
 * @notes
 * - Uses exact QuickBooks account mappings matching legacy Cohesion behavior.
 * - Saves $450/mo ($5,400/yr) by replacing Cohesion.
 */

'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, CheckCircle2, Circle, AlertCircle, PlayCircle, Loader2, Settings, Sparkles, Send } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { createClient } from '@/lib/supabase-client'

interface Store {
  id: string
  name: string
}

interface Packet {
  id: string
  store_id: string
  business_date: string
  status: 'pending' | 'ready' | 'reviewed' | 'published' | 'rejected'
  net_sales: number
}

// Map status to badge styles matching the standard app palette
const STATUS_STYLES = {
  pending: 'bg-slate-100 text-slate-500 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700',
  ready: 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800/60 shadow-sm',
  reviewed: 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800/60 shadow-sm',
  published: 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-800/60 shadow-sm',
  rejected: 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 dark:bg-rose-900/40 dark:text-rose-300 dark:border-rose-800/60 shadow-sm',
}

const STATUS_ICONS = {
  pending: <Circle className="w-3.5 h-3.5 mr-1" />,
  ready: <PlayCircle className="w-3.5 h-3.5 mr-1 text-blue-600 dark:text-blue-400" />,
  reviewed: <AlertCircle className="w-3.5 h-3.5 mr-1 text-amber-600 dark:text-amber-400" />,
  published: <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-600 dark:text-emerald-400" />,
  rejected: <AlertCircle className="w-3.5 h-3.5 mr-1 text-rose-600 dark:text-rose-400" />,
}

export default function AccountingPage() {
  const { t, language } = useLanguage()
  const router = useRouter()
  const supabase = createClient()

  const [currentDate, setCurrentDate] = useState<Date>(() => {
    const nowStr = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
    return new Date(nowStr)
  })

  const [stores, setStores] = useState<Store[]>([])
  const [packets, setPackets] = useState<Packet[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isPublishingAll, setIsPublishingAll] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Calculate the Mon-Sun week for the currentDate
  const weekDays = React.useMemo(() => {
    const d = new Date(currentDate)
    d.setHours(0, 0, 0, 0)
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? -6 : 1) // adjust when day is sunday
    const monday = new Date(d.setDate(diff))
    
    const days: Date[] = []
    for (let i = 0; i < 7; i++) {
      const nextDay = new Date(monday)
      nextDay.setDate(monday.getDate() + i)
      days.push(nextDay)
    }
    return days
  }, [currentDate])

  const startDateStr = weekDays[0].toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
  const endDateStr = weekDays[6].toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })

  const loadData = async () => {
    setIsLoading(true)
    setError(null)
    try {
      // Fetch stores
      const { data: storesData, error: storesError } = await supabase
        .from('stores')
        .select('id, name')
        .eq('is_active', true)
        .order('name')

      if (storesError) throw new Error(storesError.message)

      // Strip 'Tacos Gavilan' prefix for display
      const formattedStores = (storesData || []).map(s => ({
        ...s,
        name: s.name.replace(/^Tacos Gavilan\s*-\s*/i, '').replace(/^Tacos Gavilan\s*/i, '')
      }))
      setStores(formattedStores)

      // Fetch packets
      const res = await fetch(`/api/accounting/packets?startDate=${startDateStr}&endDate=${endDateStr}`)
      if (!res.ok) throw new Error('Failed to fetch packets')
      
      const data = await res.json()
      setPackets(data.packets || [])
    } catch (err: any) {
      console.error(err)
      setError(err.message || 'An error occurred loading data')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [startDateStr, endDateStr])

  const handlePrevWeek = () => {
    const prev = new Date(currentDate)
    prev.setDate(prev.getDate() - 7)
    setCurrentDate(prev)
  }

  const handleNextWeek = () => {
    const next = new Date(currentDate)
    next.setDate(next.getDate() + 7)
    setCurrentDate(next)
  }

  const handleGenerate = async () => {
    setIsGenerating(true)
    setError(null)
    setSuccessMessage(null)
    try {
      const res = await fetch('/api/accounting/packets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate: startDateStr, endDate: endDateStr })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to generate entries')
      setSuccessMessage(`${t('accounting.alert_generate_success') || 'Pólizas generadas exitosamente'}: ${data.generated || 0} ${language === 'en' ? 'entries generated' : 'pólizas procesadas'}`)
      await loadData()
    } catch (err: any) {
      console.error(err)
      setError(err.message || 'An error occurred generating packets')
    } finally {
      setIsGenerating(false)
    }
  }

  const handlePublishAll = async () => {
    const targetDate = weekDays[0].toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
    const confirmMsg = language === 'en'
      ? `Publish all ready journal entries for ${targetDate} to QuickBooks Online?`
      : `¿Publicar todas las pólizas listas del ${targetDate} a QuickBooks Online?`
    
    if (!window.confirm(confirmMsg)) return

    setIsPublishingAll(true)
    setError(null)
    setSuccessMessage(null)
    try {
      const res = await fetch('/api/accounting/packets/publish-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessDate: targetDate })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to batch publish entries')
      setSuccessMessage(`${t('accounting.alert_publish_success') || 'Publicación exitosa'}: ${data.published || 0} ${language === 'en' ? 'stores published to QuickBooks' : 'sucursales enviadas a QuickBooks'}`)
      await loadData()
    } catch (err: any) {
      console.error(err)
      setError(err.message || 'Error publishing batch to QuickBooks')
    } finally {
      setIsPublishingAll(false)
    }
  }

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val)
  }

  const getPacketForCell = (storeId: string, dateStr: string) => {
    return packets.find(p => String(p.store_id) === String(storeId) && p.business_date === dateStr)
  }

  const calculateDailyTotal = (dateStr: string) => {
    return packets
      .filter(p => p.business_date === dateStr)
      .reduce((sum, p) => sum + (p.net_sales || 0), 0)
  }

  return (
    <div className="w-full mx-auto px-4 md:px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{t('accounting.title')}</h1>
            <span className="bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 text-xs font-bold px-3 py-1 rounded-full border border-amber-200 dark:border-amber-700/60">
              {t('accounting.info_savings') || 'Ahorro: $5,400 USD/año'}
            </span>
          </div>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">{t('accounting.subtitle') || 'Conciliación diaria de ventas y publicación a QuickBooks Online'}</p>
        </div>
        
        {/* Actions */}
        <div className="flex items-center gap-3 flex-wrap">
          <Link
            href="/contabilidad/configuracion"
            className="bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold transition-all flex items-center border border-slate-200 dark:border-slate-700 shadow-sm hover:border-slate-300"
          >
            <Settings className="w-4 h-4 mr-2 text-slate-500 dark:text-slate-400" />
            {t('accounting.tab_settings') || 'Configuración'}
          </Link>
          <button
            onClick={handleGenerate}
            disabled={isGenerating || isLoading}
            className="bg-slate-900 hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 text-white rounded-xl px-4 py-2.5 text-sm font-bold transition-all disabled:opacity-50 flex items-center shadow-sm"
          >
            {isGenerating ? <Loader2 className="w-4 h-4 mr-2 animate-spin text-blue-400" /> : <Sparkles className="w-4 h-4 mr-2 text-blue-400" />}
            {t('accounting.btn_generate') || 'Generar Pólizas'}
          </button>
          <button
            onClick={handlePublishAll}
            disabled={isPublishingAll || isLoading}
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-4 py-2.5 text-sm font-bold transition-all flex items-center shadow-md shadow-blue-600/20 disabled:opacity-50"
          >
            {isPublishingAll ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
            {t('accounting.btn_publish_all') || 'Publicar Todo el Día'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 text-rose-800 dark:text-rose-200 p-4 rounded-xl flex items-center shadow-sm">
          <AlertCircle className="w-5 h-5 mr-3 shrink-0 text-rose-600 dark:text-rose-400" />
          <span className="text-sm font-medium">{error}</span>
        </div>
      )}

      {successMessage && (
        <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-200 p-4 rounded-xl flex items-center shadow-sm">
          <CheckCircle2 className="w-5 h-5 mr-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span className="text-sm font-medium">{successMessage}</span>
        </div>
      )}

      {/* Main Card */}
      <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        
        {/* Toolbar */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/70 dark:bg-slate-900/50">
          <div className="flex items-center gap-3">
            <button onClick={handlePrevWeek} className="p-2 hover:bg-white dark:hover:bg-slate-800 rounded-xl transition-all border border-slate-200 dark:border-slate-700 shadow-sm">
              <ChevronLeft className="w-5 h-5 text-slate-700 dark:text-slate-300" />
            </button>
            <span className="font-bold text-base px-2 text-slate-800 dark:text-slate-200">
              {weekDays[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} 
              {' — '}
              {weekDays[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
            <button onClick={handleNextWeek} className="p-2 hover:bg-white dark:hover:bg-slate-800 rounded-xl transition-all border border-slate-200 dark:border-slate-700 shadow-sm">
              <ChevronRight className="w-5 h-5 text-slate-700 dark:text-slate-300" />
            </button>
          </div>
        </div>

        {/* Grid Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
              <tr>
                <th className="px-6 py-4 font-bold w-52 shrink-0 text-slate-900 dark:text-white uppercase text-xs tracking-wider">
                  {t('accounting.col_store') || 'Sucursal'}
                </th>
                {weekDays.map((d, i) => (
                  <th key={i} className="px-3 py-4 font-bold text-center min-w-[130px]">
                    <div className="flex flex-col">
                      <span className="text-slate-900 dark:text-white font-extrabold">{d.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                      <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 mt-0.5">
                        {d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-850">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="py-24 text-center text-slate-400">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-blue-600 dark:text-blue-400" />
                    <span className="font-semibold text-slate-500">Cargando cuadrícula de pólizas...</span>
                  </td>
                </tr>
              ) : (
                <>
                  {stores.map(store => (
                    <tr key={store.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="px-6 py-4 font-bold text-slate-900 dark:text-slate-100 truncate">
                        {store.name}
                      </td>
                      {weekDays.map((d, i) => {
                        const dateStr = d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
                        const packet = getPacketForCell(store.id, dateStr)

                        return (
                          <td key={i} className="px-2 py-3 text-center">
                            {packet ? (
                              <Link href={`/contabilidad/${packet.id}`}>
                                <div 
                                  className={`inline-flex flex-col items-center justify-center px-3 py-1.5 text-xs rounded-xl cursor-pointer transition-all hover:scale-105 ${STATUS_STYLES[packet.status] || STATUS_STYLES.pending}`}
                                  title={`Venta Neta: ${formatCurrency(packet.net_sales)}`}
                                >
                                  <div className="flex items-center font-bold">
                                    {STATUS_ICONS[packet.status]}
                                    <span>{t(`accounting.status_${packet.status}`) || packet.status}</span>
                                  </div>
                                  <span className="text-[11px] font-mono font-bold mt-0.5 opacity-90">
                                    {formatCurrency(packet.net_sales)}
                                  </span>
                                </div>
                              </Link>
                            ) : (
                              <span className="text-slate-400 dark:text-slate-600 font-mono text-xs">—</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                  {/* Totals Row */}
                  <tr className="bg-slate-50/90 dark:bg-slate-900/80 border-t-2 border-slate-200 dark:border-slate-700 font-bold text-slate-900 dark:text-slate-100">
                    <td className="px-6 py-4 text-slate-500 dark:text-slate-400 uppercase text-xs tracking-wider font-extrabold">
                      {language === 'en' ? 'Daily Totals' : 'Totales Diarios'}
                    </td>
                    {weekDays.map((d, i) => {
                      const dateStr = d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
                      const total = calculateDailyTotal(dateStr)
                      return (
                        <td key={i} className="px-3 py-4 text-center font-mono text-blue-600 dark:text-blue-400 font-extrabold text-sm">
                          {total > 0 ? formatCurrency(total) : '—'}
                        </td>
                      )
                    })}
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>

        {/* Legend Footer */}
        <div className="p-4 bg-slate-50/70 dark:bg-slate-900/60 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between text-xs text-slate-600 dark:text-slate-400 gap-4">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="font-bold text-slate-800 dark:text-slate-200">{language === 'en' ? 'Status Legend:' : 'Estados:'}</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span> {t('accounting.status_ready') || 'Listo (Calculado)'}</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span> {t('accounting.status_reviewed') || 'Revisado (Aprobado)'}</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> {t('accounting.status_published') || 'Publicado en QuickBooks'}</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span> {t('accounting.status_rejected') || 'Rechazado'}</span>
          </div>
          <div className="text-slate-600 dark:text-slate-400 font-medium">
            {language === 'en' ? 'Click any badge to review and adjust cash deposit' : 'Haz clic en cualquier botón para ver la póliza y ajustar efectivo'}
          </div>
        </div>
      </div>
    </div>
  )
}
