/**
 * @module app/admin/mantenimiento/page
 * @description Panel administrativo y de supervisión para la Bitácora de Mantenimiento y Proveedores de Tacos Gavilan.
 * @businessRules
 * - Muestra todas las intervenciones técnicas de las 15 sucursales con evidencias fotográficas y firmas.
 * - Permite exportación de reportes a CSV para auditorías de salud, bomberos o contabilidad.
 * - Permite abrir el generador de Códigos QR para imprimir las calcomanías oficiales de cada sucursal.
 * - Permite a administradores y supervisores eliminar registros de servicios con diálogo de confirmación y purga de Storage.
 * - Aplica zona horaria PST 'America/Los_Angeles' y soporte bilingüe con useLanguage().
 * @dataFlow
 * - /api/mantenimiento -> maintenance_service_logs & stores -> Renderizado de métricas, bitácora y eliminación.
 * @notes
 * - Incluye modal interactivo con visor de imágenes a pantalla completa para inspección forense de trabajos.
 */

'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Wrench, QrCode, Download, Search, Filter, Calendar,
  Building2, CheckCircle2, Clock, AlertTriangle, Eye,
  X, ChevronDown, ChevronRight, ExternalLink, Flame,
  Snowflake, Droplets, Bug, Sparkles, RefreshCw, FileText,
  DollarSign, ShieldCheck, User, Phone, Check, ArrowUpDown,
  Trash2, Loader2
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { formatStoreName } from '@/lib/supabase'
import MaintenanceQRModal from '@/components/maintenance/MaintenanceQRModal'

interface Store {
  id: string
  name: string
  code?: string
  city?: string
  address?: string
}

interface MaintenanceLog {
  id: string
  store_id: string
  service_date: string
  start_time?: string
  end_time?: string
  company_name: string
  technician_name: string
  technician_phone?: string
  category: string
  service_type: string
  area_equipment: string
  work_description: string
  parts_replaced?: string
  status: 'completed' | 'pending_parts' | 'follow_up_needed'
  photos_before?: string[]
  photos_after?: string[]
  photos_invoice?: string[]
  invoice_number?: string
  cost_estimate?: number
  manager_name: string
  manager_signature_url?: string
  notes?: string
  created_at: string
  store?: Store
}

export default function AdminMaintenanceDashboardPage() {
  const { t, language } = useLanguage()
  const isEs = language === 'es'

  const [logs, setLogs] = useState<MaintenanceLog[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(true)

  // Filtros
  const [selectedStore, setSelectedStore] = useState<string>('all')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [selectedStatus, setSelectedStatus] = useState<string>('all')
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')

  // Modales
  const [selectedLog, setSelectedLog] = useState<MaintenanceLog | null>(null)
  const [qrModalOpen, setQrModalOpen] = useState(false)
  const [zoomedImage, setZoomedImage] = useState<string | null>(null)
  const [logToDelete, setLogToDelete] = useState<MaintenanceLog | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteFeedback, setDeleteFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Auto-limpieza de mensaje de feedback de eliminación tras 4 segundos
  useEffect(() => {
    if (deleteFeedback) {
      const timer = setTimeout(() => {
        setDeleteFeedback(null)
      }, 4000)
      return () => clearTimeout(timer)
    }
  }, [deleteFeedback])

  // Manejo de eliminación confirmada
  const handleConfirmDelete = async () => {
    if (!logToDelete) return
    setIsDeleting(true)
    try {
      const res = await fetch(`/api/mantenimiento?id=${logToDelete.id}`, {
        method: 'DELETE'
      })
      const json = await res.json()
      if (json.success) {
        setLogs(prev => prev.filter(l => l.id !== logToDelete.id))
        if (selectedLog?.id === logToDelete.id) {
          setSelectedLog(null)
        }
        setDeleteFeedback({ type: 'success', message: t('maintenance.delete_success') })
        setLogToDelete(null)
      } else {
        setDeleteFeedback({ type: 'error', message: json.error || t('maintenance.delete_error') })
      }
    } catch (err: any) {
      console.error('Error al eliminar registro de mantenimiento:', err)
      setDeleteFeedback({ type: 'error', message: err.message || t('maintenance.delete_error') })
    } finally {
      setIsDeleting(false)
    }
  }

  // Cargar datos
  const fetchData = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (selectedStore !== 'all') params.append('store_id', selectedStore)
      if (selectedCategory !== 'all') params.append('category', selectedCategory)
      if (selectedStatus !== 'all') params.append('status', selectedStatus)
      if (startDate) params.append('from', startDate)
      if (endDate) params.append('to', endDate)
      if (searchTerm.trim()) params.append('search', searchTerm.trim())

      const res = await fetch(`/api/mantenimiento?${params.toString()}`)
      const json = await res.json()

      if (json.success) {
        setLogs(json.data || [])
        if (json.stores) setStores(json.stores)
      }
    } catch (err) {
      console.error('Error cargando bitácora de mantenimiento:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [selectedStore, selectedCategory, selectedStatus, startDate, endDate])

  // Filtrado reactivo por texto en cliente
  const filteredLogs = useMemo(() => {
    if (!searchTerm.trim()) return logs
    const q = searchTerm.toLowerCase()
    return logs.filter(l =>
      l.company_name?.toLowerCase().includes(q) ||
      l.technician_name?.toLowerCase().includes(q) ||
      l.area_equipment?.toLowerCase().includes(q) ||
      l.work_description?.toLowerCase().includes(q) ||
      l.invoice_number?.toLowerCase().includes(q) ||
      l.store?.name?.toLowerCase().includes(q)
    )
  }, [logs, searchTerm])

  // Métricas rápidas
  const totalMonth = useMemo(() => {
    const now = new Date()
    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    return logs.filter(l => l.service_date?.startsWith(currentYearMonth)).length
  }, [logs])

  const pendingPartsCount = useMemo(() => {
    return logs.filter(l => l.status === 'pending_parts').length
  }, [logs])

  const distinctStoresCount = useMemo(() => {
    const set = new Set(logs.map(l => l.store_id))
    return set.size
  }, [logs])

  // Exportar a CSV
  const exportToCSV = () => {
    if (filteredLogs.length === 0) return

    const headers = [
      'Fecha', 'Sucursal', 'Empresa Proveedora', 'Tecnico', 'Telefono',
      'Categoria', 'Tipo Servicio', 'Equipo/Area', 'Descripcion',
      'Piezas Reemplazadas', 'Estado', 'Factura', 'Costo Estimado', 'Encargado Tienda'
    ]

    const rows = filteredLogs.map(l => [
      `"${l.service_date}"`,
      `"${formatStoreName(l.store?.name || 'N/A')}"`,
      `"${(l.company_name || '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`,
      `"${(l.technician_name || '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`,
      `"${l.technician_phone || ''}"`,
      `"${l.category}"`,
      `"${l.service_type}"`,
      `"${(l.area_equipment || '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`,
      `"${(l.work_description || '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`,
      `"${(l.parts_replaced || '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`,
      `"${l.status}"`,
      `"${l.invoice_number || ''}"`,
      (l.cost_estimate !== null && l.cost_estimate !== undefined) ? `"${l.cost_estimate}"` : '""',
      `"${(l.manager_name || '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`
    ])

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `bitacora_mantenimiento_tacos_gavilan_${new Date().toISOString().split('T')[0]}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Helper para etiquetas de categorías
  const getCategoryBadge = (cat: string) => {
    switch (cat) {
      case 'hood_cleaning':
        return { label: t('maintenance.category_hood'), color: 'text-amber-700 bg-amber-50 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300' }
      case 'refrigeration':
        return { label: t('maintenance.category_refrigeration'), color: 'text-blue-700 bg-blue-50 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300' }
      case 'grease_trap':
        return { label: t('maintenance.category_grease_trap'), color: 'text-teal-700 bg-teal-50 border-teal-200 dark:bg-teal-950/50 dark:text-teal-300' }
      case 'pest_control':
        return { label: t('maintenance.category_pest_control'), color: 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300' }
      case 'cooking_equipment':
        return { label: t('maintenance.category_cooking'), color: 'text-red-700 bg-red-50 border-red-200 dark:bg-red-950/50 dark:text-red-300' }
      case 'electrical':
        return { label: t('maintenance.category_electrical'), color: 'text-yellow-700 bg-yellow-50 border-yellow-200 dark:bg-yellow-950/50 dark:text-yellow-300' }
      case 'power_washing':
        return { label: t('maintenance.category_power_washing'), color: 'text-cyan-700 bg-cyan-50 border-cyan-200 dark:bg-cyan-950/50 dark:text-cyan-300' }
      case 'security_locks':
        return { label: t('maintenance.category_security'), color: 'text-indigo-700 bg-indigo-50 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300' }
      case 'it_pos':
        return { label: t('maintenance.category_it'), color: 'text-purple-700 bg-purple-50 border-purple-200 dark:bg-purple-950/50 dark:text-purple-300' }
      default:
        return { label: t('maintenance.category_general'), color: 'text-slate-700 bg-slate-50 border-slate-200 dark:bg-slate-800 dark:text-slate-300' }
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-4 sm:p-8 space-y-8">
      {/* HEADER PRINCIPAL */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-red-600 text-white shadow-lg shadow-red-600/20">
            <Wrench size={26} />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">
              {t('maintenance.dashboard_title')}
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              {t('maintenance.dashboard_subtitle')}
            </p>
          </div>
        </div>

        {/* BOTONES DE ACCIÓN */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setQrModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-750 text-xs font-bold text-slate-800 dark:text-slate-200 shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <QrCode size={16} className="text-red-600" />
            <span>{t('maintenance.qr_button')}</span>
          </button>

          <button
            type="button"
            onClick={exportToCSV}
            disabled={filteredLogs.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-750 text-xs font-bold text-slate-800 dark:text-slate-200 shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40"
          >
            <Download size={16} className="text-emerald-600" />
            <span>{t('maintenance.export_csv')}</span>
          </button>

          <a
            href="/mantenimiento/registro"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold shadow-md shadow-red-600/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <ExternalLink size={16} />
            <span>{t('maintenance.open_kiosk')}</span>
          </a>
        </div>
      </div>

      {/* MENSAJE DE FEEDBACK TRAS ELIMINAR O ACCIÓN */}
      <AnimatePresence>
        {deleteFeedback && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`p-4 rounded-2xl flex items-center justify-between gap-3 text-xs font-bold border shadow-sm transition-all ${
              deleteFeedback.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-850 text-emerald-800 dark:text-emerald-300'
                : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-850 text-red-800 dark:text-red-300'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {deleteFeedback.type === 'success' ? (
                <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
              ) : (
                <AlertTriangle size={16} className="text-red-600 dark:text-red-400 flex-shrink-0" />
              )}
              <span>{deleteFeedback.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setDeleteFeedback(null)}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-black/5 transition-colors"
            >
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* TARJETAS KPI DE RESUMEN */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {t('maintenance.total_month')}
            </span>
            <div className="text-3xl font-black text-slate-900 dark:text-white mt-1">
              {totalMonth}
            </div>
          </div>
          <div className="p-3 rounded-2xl bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400">
            <Calendar size={24} />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {t('maintenance.pending_parts_card')}
            </span>
            <div className="text-3xl font-black text-amber-600 dark:text-amber-400 mt-1">
              {pendingPartsCount}
            </div>
          </div>
          <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400">
            <AlertTriangle size={24} />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {t('maintenance.serviced_stores')}
            </span>
            <div className="text-3xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
              {distinctStoresCount} <span className="text-xs text-slate-400 font-normal">/ {stores.length || 15}</span>
            </div>
          </div>
          <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
            <Building2 size={24} />
          </div>
        </div>
      </div>

      {/* FILTROS Y BÚSQUEDA */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Tienda */}
          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">
              {t('maintenance.filter_store')}
            </label>
            <select
              value={selectedStore}
              onChange={(e) => setSelectedStore(e.target.value)}
              className="w-full px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium focus:ring-2 focus:ring-red-500 focus:outline-none"
            >
              <option value="all">{t('maintenance.all_stores')}</option>
              {stores.map(s => (
                <option key={s.id} value={s.id}>
                  {formatStoreName(s.name)}{s.address ? ` — ${s.address}` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Categoría */}
          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">
              {t('maintenance.filter_category')}
            </label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium focus:ring-2 focus:ring-red-500 focus:outline-none"
            >
              <option value="all">{t('maintenance.all_categories')}</option>
              <option value="hood_cleaning">{t('maintenance.category_hood')}</option>
              <option value="refrigeration">{t('maintenance.category_refrigeration')}</option>
              <option value="grease_trap">{t('maintenance.category_grease_trap')}</option>
              <option value="pest_control">{t('maintenance.category_pest_control')}</option>
              <option value="cooking_equipment">{t('maintenance.category_cooking')}</option>
              <option value="electrical">{t('maintenance.category_electrical')}</option>
              <option value="power_washing">{t('maintenance.category_power_washing')}</option>
              <option value="security_locks">{t('maintenance.category_security')}</option>
              <option value="it_pos">{t('maintenance.category_it')}</option>
              <option value="general">{t('maintenance.category_general')}</option>
            </select>
          </div>

          {/* Estado */}
          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">
              {t('maintenance.filter_status')}
            </label>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium focus:ring-2 focus:ring-red-500 focus:outline-none"
            >
              <option value="all">{t('maintenance.all_statuses')}</option>
              <option value="completed">{t('maintenance.status_completed')}</option>
              <option value="pending_parts">{t('maintenance.status_pending_parts')}</option>
              <option value="follow_up_needed">{t('maintenance.status_follow_up')}</option>
            </select>
          </div>

          {/* Búsqueda */}
          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">
              {t('common.search')}
            </label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-3 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={t('maintenance.filter_search')}
                className="w-full pl-9 pr-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium focus:ring-2 focus:ring-red-500 focus:outline-none"
              />
            </div>
          </div>
        </div>
      </div>

      {/* TABLA PRINCIPAL DE REGISTROS */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400">
            <RefreshCw className="animate-spin mx-auto mb-2" size={24} />
            <span className="text-xs font-semibold">{t('maintenance.loading_logs')}</span>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <Wrench className="mx-auto mb-2 opacity-30" size={36} />
            <p className="text-xs font-semibold">{t('maintenance.no_data')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700 text-slate-500 uppercase font-black tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-4">{t('maintenance.date')}</th>
                  <th className="py-3 px-4">{t('maintenance.store')}</th>
                  <th className="py-3 px-4">{t('maintenance.vendor')}</th>
                  <th className="py-3 px-4">{t('maintenance.category_title')}</th>
                  <th className="py-3 px-4">{t('maintenance.equipment')}</th>
                  <th className="py-3 px-4">{t('maintenance.status_title')}</th>
                  <th className="py-3 px-4 text-center">{t('maintenance.evidence_title')}</th>
                  <th className="py-3 px-4">{t('maintenance.manager_name')}</th>
                  <th className="py-3 px-4 text-right">{t('maintenance.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                {filteredLogs.map(log => {
                  const catBadge = getCategoryBadge(log.category)
                  const totalPhotos = (log.photos_before?.length || 0) + (log.photos_after?.length || 0) + (log.photos_invoice?.length || 0)

                  return (
                    <tr
                      key={log.id}
                      onClick={() => setSelectedLog(log)}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4 font-bold text-slate-900 dark:text-white whitespace-nowrap">
                        {log.service_date}
                      </td>
                      <td className="py-3 px-4 font-bold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                        <div className="font-extrabold text-slate-900 dark:text-white">
                          {formatStoreName(log.store?.name || 'N/A')}
                        </div>
                        {log.store?.address && (
                          <div className="text-[10px] text-slate-400 font-normal">
                            {log.store.address}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-extrabold text-slate-900 dark:text-white">{log.company_name}</div>
                        <div className="text-[11px] text-slate-400">{log.technician_name}</div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${catBadge.color}`}>
                          {catBadge.label}
                        </span>
                      </td>
                      <td className="py-3 px-4 max-w-xs truncate text-slate-700 dark:text-slate-300">
                        {log.area_equipment}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {log.status === 'completed' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300">
                            <CheckCircle2 size={12} />
                            {t('maintenance.status_completed')}
                          </span>
                        ) : log.status === 'pending_parts' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300">
                            <AlertTriangle size={12} />
                            {t('maintenance.status_pending_parts')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300">
                            <Clock size={12} />
                            {t('maintenance.status_follow_up')}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        {totalPhotos > 0 ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-extrabold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                            📸 {totalPhotos}
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[11px]">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {log.manager_signature_url ? (
                            <ShieldCheck size={14} className="text-emerald-600" />
                          ) : (
                            <User size={14} className="text-slate-400" />
                          )}
                          <span>{log.manager_name}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedLog(log)
                            }}
                            className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/60 dark:hover:text-red-400 text-xs font-bold transition-colors"
                          >
                            {t('maintenance.view_details')}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setLogToDelete(log)
                            }}
                            title={t('maintenance.delete_btn_tooltip')}
                            className="p-1.5 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 dark:hover:text-red-400 transition-colors"
                          >
                            <Trash2 size={14} />
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

      {/* MODAL DETALLE DE SERVICIO */}
      <AnimatePresence>
        {selectedLog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-3xl overflow-hidden flex flex-col max-h-[92vh]"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-red-50 to-amber-50 dark:from-red-950/20 dark:to-amber-950/20">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-2xl bg-red-600 text-white shadow-md">
                    <Wrench size={22} />
                  </div>
                  <div>
                    <span className="text-[11px] font-black uppercase tracking-wider text-red-600 dark:text-red-400">
                      {formatStoreName(selectedLog.store?.name || 'Tacos Gavilan')} • {selectedLog.service_date}
                    </span>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                      {selectedLog.company_name} — {selectedLog.area_equipment}
                    </h3>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedLog(null)}
                  className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Modal Content */}
              <div className="p-6 overflow-y-auto space-y-6 text-xs">
                {/* Meta Cards Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 dark:bg-slate-800/40 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700">
                  <div>
                    <span className="text-slate-400 font-bold block">{t('maintenance.technician')}</span>
                    <span className="font-extrabold text-slate-900 dark:text-white">{selectedLog.technician_name}</span>
                    {selectedLog.technician_phone && (
                      <span className="text-slate-500 block text-[11px]">{selectedLog.technician_phone}</span>
                    )}
                  </div>

                  <div>
                    <span className="text-slate-400 font-bold block">{t('maintenance.category_title')}</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      {getCategoryBadge(selectedLog.category).label}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 font-bold block">{t('maintenance.status_title')}</span>
                    <span className="font-extrabold text-slate-900 dark:text-white">
                      {selectedLog.status === 'completed'
                        ? t('maintenance.status_completed')
                        : selectedLog.status === 'pending_parts'
                        ? t('maintenance.status_pending_parts')
                        : t('maintenance.status_follow_up')}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 font-bold block">{t('maintenance.invoice_number')}</span>
                    <span className="font-extrabold text-slate-900 dark:text-white">
                      {selectedLog.invoice_number || 'N/A'}
                    </span>
                    {(selectedLog.cost_estimate !== null && selectedLog.cost_estimate !== undefined) && (
                      <span className="text-emerald-600 font-bold block text-[11px]">
                        ${selectedLog.cost_estimate.toFixed(2)} USD
                      </span>
                    )}
                  </div>
                </div>

                {/* Work Description */}
                <div>
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('maintenance.work_description')}
                  </h4>
                  <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700 text-slate-800 dark:text-slate-200 leading-relaxed font-medium">
                    {selectedLog.work_description}
                  </div>
                </div>

                {/* Parts Replaced */}
                {selectedLog.parts_replaced && (
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                      {t('maintenance.parts_replaced')}
                    </h4>
                    <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-medium">
                      {selectedLog.parts_replaced}
                    </div>
                  </div>
                )}

                {/* Photographic Evidence Gallery */}
                <div className="space-y-4 pt-2">
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    {t('maintenance.evidence_title')}
                  </h4>

                  {/* Antes vs Después Side-by-side */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Fotos Antes */}
                    <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700">
                      <span className="font-bold text-slate-700 dark:text-slate-300 mb-2 block">
                        {t('maintenance.before_photos')} ({selectedLog.photos_before?.length || 0})
                      </span>
                      {selectedLog.photos_before && selectedLog.photos_before.length > 0 ? (
                        <div className="grid grid-cols-2 gap-2">
                          {selectedLog.photos_before.map((url, idx) => (
                            <img
                              key={idx}
                              src={url}
                              alt="Antes"
                              onClick={() => setZoomedImage(url)}
                              className="w-full h-24 object-cover rounded-xl cursor-zoom-in hover:opacity-90 transition-opacity border border-slate-200 dark:border-slate-700"
                            />
                          ))}
                        </div>
                      ) : (
                        <p className="text-slate-400 italic text-[11px]">{t('maintenance.no_evidence')}</p>
                      )}
                    </div>

                    {/* Fotos Después */}
                    <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700">
                      <span className="font-bold text-slate-700 dark:text-slate-300 mb-2 block">
                        {t('maintenance.after_photos')} ({selectedLog.photos_after?.length || 0})
                      </span>
                      {selectedLog.photos_after && selectedLog.photos_after.length > 0 ? (
                        <div className="grid grid-cols-2 gap-2">
                          {selectedLog.photos_after.map((url, idx) => (
                            <img
                              key={idx}
                              src={url}
                              alt="Después"
                              onClick={() => setZoomedImage(url)}
                              className="w-full h-24 object-cover rounded-xl cursor-zoom-in hover:opacity-90 transition-opacity border border-slate-200 dark:border-slate-700"
                            />
                          ))}
                        </div>
                      ) : (
                        <p className="text-slate-400 italic text-[11px]">{t('maintenance.no_evidence')}</p>
                      )}
                    </div>
                  </div>

                  {/* Factura / Orden Física */}
                  {selectedLog.photos_invoice && selectedLog.photos_invoice.length > 0 && (
                    <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700">
                      <span className="font-bold text-slate-700 dark:text-slate-300 mb-2 block">
                        {t('maintenance.invoice_photo')}
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {selectedLog.photos_invoice.map((url, idx) => (
                          <img
                            key={idx}
                            src={url}
                            alt="Factura"
                            onClick={() => setZoomedImage(url)}
                            className="h-28 object-contain rounded-xl cursor-zoom-in hover:opacity-90 transition-opacity border border-slate-200 dark:border-slate-700 bg-white"
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Manager Validation and Signature */}
                <div className="p-4 rounded-2xl bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/60">
                  <div className="flex items-center gap-2 mb-2">
                    <ShieldCheck size={16} className="text-emerald-600" />
                    <span className="font-black uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                      {t('maintenance.manager_sign')}
                    </span>
                  </div>
                  <p className="text-slate-700 dark:text-slate-300 font-semibold mb-2">
                    {t('maintenance.verified_by')} <strong className="text-emerald-700 dark:text-emerald-300">{selectedLog.manager_name}</strong>
                  </p>

                  {selectedLog.manager_signature_url && (
                    <div className="p-2 bg-white rounded-xl border border-emerald-200 inline-block">
                      <img
                        src={selectedLog.manager_signature_url}
                        alt="Firma del encargado"
                        className="h-20 object-contain block"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Modal Footer */}
              <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setLogToDelete(selectedLog)}
                  className="px-4 py-2 rounded-2xl bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 text-xs font-bold flex items-center gap-1.5 transition-colors border border-red-200/50 dark:border-red-900/40"
                >
                  <Trash2 size={14} />
                  <span>{t('maintenance.delete_record')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedLog(null)}
                  className="px-5 py-2 rounded-2xl bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-xs font-bold text-slate-800 dark:text-slate-200 transition-colors"
                >
                  {t('maintenance.close')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL ZOOM DE IMAGEN */}
      <AnimatePresence>
        {zoomedImage && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md cursor-zoom-out"
            onClick={() => setZoomedImage(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="relative max-w-4xl max-h-[90vh] overflow-hidden rounded-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={zoomedImage}
                alt="Zoom Evidencia"
                className="w-full h-auto max-h-[85vh] object-contain rounded-2xl shadow-2xl"
              />
              <button
                type="button"
                onClick={() => setZoomedImage(null)}
                className="absolute top-3 right-3 p-2 rounded-full bg-black/70 text-white hover:bg-red-600 transition-colors"
              >
                <X size={18} />
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL GENERADOR DE QR */}
      <MaintenanceQRModal
        isOpen={qrModalOpen}
        onClose={() => setQrModalOpen(false)}
        stores={stores}
      />

      {/* MODAL DE CONFIRMACIÓN DE ELIMINACIÓN */}
      <AnimatePresence>
        {logToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-md overflow-hidden p-6"
            >
              <div className="flex items-center gap-3.5 mb-4">
                <div className="w-12 h-12 rounded-2xl bg-red-100 dark:bg-red-950/60 flex items-center justify-center text-red-600 dark:text-red-400 flex-shrink-0">
                  <Trash2 size={24} />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                    {t('maintenance.delete_confirm_title')}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {t('maintenance.delete_confirm_message')}
                  </p>
                </div>
              </div>

              {/* Ficha Resumen del Registro a Eliminar */}
              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 text-xs space-y-1.5 mb-5">
                <div className="flex justify-between">
                  <span className="text-slate-400 font-bold">{t('maintenance.vendor')}:</span>
                  <span className="font-extrabold text-slate-900 dark:text-white">{logToDelete.company_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400 font-bold">{t('maintenance.technician')}:</span>
                  <span className="font-medium text-slate-800 dark:text-slate-200">{logToDelete.technician_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400 font-bold">{t('maintenance.store')}:</span>
                  <span className="font-extrabold text-slate-900 dark:text-white">
                    {formatStoreName(logToDelete.store?.name || 'N/A')}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400 font-bold">{t('maintenance.date')}:</span>
                  <span className="font-medium text-slate-800 dark:text-slate-200">{logToDelete.service_date}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400 font-bold">{t('maintenance.equipment')}:</span>
                  <span className="font-medium text-slate-800 dark:text-slate-200 truncate max-w-[200px]">
                    {logToDelete.area_equipment}
                  </span>
                </div>

                {/* Aviso visual de borrado de fotos y firma en Storage */}
                {((logToDelete.photos_before?.length || 0) + (logToDelete.photos_after?.length || 0) + (logToDelete.photos_invoice?.length || 0) + (logToDelete.manager_signature_url ? 1 : 0)) > 0 && (
                  <div className="flex items-center gap-2 p-2.5 mt-2 rounded-xl bg-red-50/80 dark:bg-red-950/40 border border-red-200/60 dark:border-red-900/40 text-[11px] font-bold text-red-700 dark:text-red-300">
                    <span className="text-sm">📸</span>
                    <span>
                      {t('maintenance.photos_will_be_deleted', {
                        count: (logToDelete.photos_before?.length || 0) + (logToDelete.photos_after?.length || 0) + (logToDelete.photos_invoice?.length || 0) + (logToDelete.manager_signature_url ? 1 : 0)
                      })}
                    </span>
                  </div>
                )}
              </div>

              {/* Botones de Acción */}
              <div className="flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => setLogToDelete(null)}
                  className="px-4 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 transition-colors disabled:opacity-50"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={handleConfirmDelete}
                  className="px-4 py-2 rounded-2xl bg-red-600 hover:bg-red-700 text-white text-xs font-extrabold shadow-md shadow-red-600/20 flex items-center gap-1.5 transition-all disabled:opacity-50"
                >
                  {isDeleting ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>{t('maintenance.deleting')}</span>
                    </>
                  ) : (
                    <>
                      <Trash2 size={14} />
                      <span>{t('maintenance.delete_record')}</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
