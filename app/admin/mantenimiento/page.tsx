/**
 * @module app/admin/mantenimiento/page
 * @description Panel administrativo y de supervisión para la Bitácora de Mantenimiento y Proveedores de Tacos Gavilan.
 * @businessRules
 * - Muestra todas las intervenciones técnicas de las 15 sucursales con evidencias fotográficas y firmas.
 * - Permite exportación de reportes a CSV para auditorías de salud, bomberos o contabilidad.
 * - Permite abrir el generador de Códigos QR para imprimir las calcomanías oficiales de cada sucursal.
 * - En el modal de edición/seguimiento administrativo, permite elegir con 1 toque al Encargado en Turno (Supervisor, Manager, Asistente Manager o Shift Leader) cruzando el Módulo PLANIFICADOR (`shifts`) y el Módulo HORARIOS (`schedules`) para la tienda y fecha del servicio (`GET /api/mantenimiento?shift_leaders=1&store_id=...&date=...`).
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
  Wrench, QrCode, Download, Search, Calendar,
  Building2, CheckCircle2, Clock, AlertTriangle,
  X, ExternalLink, RefreshCw, FileText,
  ShieldCheck, User, Trash2, Loader2, UploadCloud, Save
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
  has_repeat_within_30d?: boolean
  created_at: string
  store?: Store
}

interface GlobalKpis {
  totalMonth: number
  pendingPartsCount: number
  distinctStoresCount: number
}

interface ShiftLeaderOption {
  id: string
  name: string
  role: 'supervisor' | 'manager' | 'assistant_manager' | 'shift_leader'
  start_time: string
  end_time: string
  shift_block: 'AM' | 'PM' | 'FULL' | null
  shift_label: string
  source: 'horarios' | 'planificador' | 'horarios+planificador' | 'supervisor' | 'store_roster'
  scheduled_today: boolean
  is_on_shift_now: boolean
}

function formatTimeAndDuration(start?: string, end?: string): string | null {
  if (!start && !end) return null
  const cleanStart = start ? start.slice(0, 5) : ''
  const cleanEnd = end ? end.slice(0, 5) : ''
  if (cleanStart && cleanEnd && /^\d{2}:\d{2}$/.test(cleanStart) && /^\d{2}:\d{2}$/.test(cleanEnd)) {
    const [sh, sm] = cleanStart.split(':').map(Number)
    const [eh, em] = cleanEnd.split(':').map(Number)
    let diffMins = (eh * 60 + em) - (sh * 60 + sm)
    if (diffMins < 0) diffMins += 24 * 60
    const hours = Math.floor(diffMins / 60)
    const mins = diffMins % 60
    const durStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
    return `${cleanStart} – ${cleanEnd} (${durStr})`
  }
  return cleanStart || cleanEnd || null
}

export default function AdminMaintenanceDashboardPage() {
  const { t } = useLanguage()

  const [logs, setLogs] = useState<MaintenanceLog[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [globalKpis, setGlobalKpis] = useState<GlobalKpis | null>(null)
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

  // Estado de Edición / Cierre de Pendientes / Conciliación de Factura en Modal Detalle
  const [editStatus, setEditStatus] = useState<'completed' | 'pending_parts' | 'follow_up_needed'>('completed')
  const [editInvoiceNumber, setEditInvoiceNumber] = useState<string>('')
  const [editCostEstimate, setEditCostEstimate] = useState<string>('')
  const [editManagerName, setEditManagerName] = useState<string>('')
  const [editNotes, setEditNotes] = useState<string>('')
  const [editPhotosInvoice, setEditPhotosInvoice] = useState<string[]>([])
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [isUploadingAdminInvoice, setIsUploadingAdminInvoice] = useState(false)
  const [modalShiftLeaders, setModalShiftLeaders] = useState<ShiftLeaderOption[]>([])
  const [loadingModalLeaders, setLoadingModalLeaders] = useState(false)

  // Sincronizar campos de edición y consultar encargados del turno (Planificador + Horarios) al abrir un registro en el modal
  useEffect(() => {
    let active = true
    if (selectedLog) {
      setEditStatus(selectedLog.status || 'completed')
      setEditInvoiceNumber(selectedLog.invoice_number || '')
      setEditCostEstimate(
        selectedLog.cost_estimate !== null && selectedLog.cost_estimate !== undefined
          ? String(selectedLog.cost_estimate)
          : ''
      )
      setEditManagerName(selectedLog.manager_name || '')
      setEditNotes(selectedLog.notes || '')
      setEditPhotosInvoice(Array.isArray(selectedLog.photos_invoice) ? selectedLog.photos_invoice : [])

      // Cargar encargados del turno de esa tienda y fecha (Supervisor, Manager, Asistente Manager, Shift Leader)
      const loadLeadersForLog = async () => {
        if (!selectedLog.store_id) {
          setModalShiftLeaders([])
          return
        }
        setLoadingModalLeaders(true)
        try {
          const refTime = (selectedLog.end_time || selectedLog.start_time || '').slice(0, 5)
          const qs = new URLSearchParams({
            shift_leaders: '1',
            store_id: String(selectedLog.store_id)
          })
          if (selectedLog.service_date) qs.set('date', selectedLog.service_date)
          if (refTime) qs.set('time', refTime)

          const res = await fetch(`/api/mantenimiento?${qs.toString()}`)
          const json = await res.json()
          if (!active) return
          if (json?.success && Array.isArray(json.leaders)) {
            setModalShiftLeaders(json.leaders)
          } else {
            setModalShiftLeaders([])
          }
        } catch (err) {
          console.warn('Error cargando encargados del turno en modal admin:', err)
          if (active) setModalShiftLeaders([])
        } finally {
          if (active) setLoadingModalLeaders(false)
        }
      }
      loadLeadersForLog()
    } else {
      setModalShiftLeaders([])
    }
    return () => {
      active = false
    }
  }, [selectedLog?.id])

  const getAuthHeaders = (): Record<string, string> => {
    if (typeof window === 'undefined') return {}
    const token = localStorage.getItem('teg_token')
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  // Auto-limpieza de mensaje de feedback tras 4 segundos
  useEffect(() => {
    if (deleteFeedback) {
      const timer = setTimeout(() => {
        setDeleteFeedback(null)
      }, 4000)
      return () => clearTimeout(timer)
    }
  }, [deleteFeedback])

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

      const res = await fetch(`/api/mantenimiento?${params.toString()}`, {
        headers: getAuthHeaders()
      })
      const json = await res.json()

      if (json.success) {
        setLogs(json.data || [])
        if (json.stores) setStores(json.stores)
        if (json.kpis) setGlobalKpis(json.kpis)
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

  // Subida de factura PDF/imagen desde el Panel Admin (post-visita)
  const handleAdminInvoiceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    setIsUploadingAdminInvoice(true)
    try {
      const file = files[0]
      const formData = new FormData()
      formData.append('file', file)
      formData.append('folder', 'invoice')

      const res = await fetch('/api/mantenimiento/upload', {
        method: 'POST',
        body: formData
      })
      const json = await res.json()
      if (json.success && json.url) {
        setEditPhotosInvoice(prev => [...prev, json.url].slice(0, 5))
      } else {
        setDeleteFeedback({ type: 'error', message: json.error || t('maintenance.error_upload_photo') })
      }
    } catch (err: any) {
      setDeleteFeedback({ type: 'error', message: err.message || t('maintenance.error_upload_photo') })
    } finally {
      setIsUploadingAdminInvoice(false)
      e.target.value = ''
    }
  }

  // Guardar actualización de Estado, Factura, Costo, Notas y Validación (PATCH /api/mantenimiento)
  const handleSaveRecordUpdate = async () => {
    if (!selectedLog) return
    setIsSavingEdit(true)
    try {
      const res = await fetch('/api/mantenimiento', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({
          id: selectedLog.id,
          status: editStatus,
          invoice_number: editInvoiceNumber,
          cost_estimate: editCostEstimate,
          manager_name: editManagerName,
          notes: editNotes,
          photos_invoice: editPhotosInvoice
        })
      })
      const json = await res.json()
      if (json.success && json.data) {
        const updatedLog: MaintenanceLog = {
          ...selectedLog,
          ...json.data,
          store: selectedLog.store
        }
        setSelectedLog(updatedLog)
        setLogs(prev => prev.map(l => (l.id === updatedLog.id ? updatedLog : l)))
        setDeleteFeedback({ type: 'success', message: t('maintenance.update_success') })
        fetchData()
      } else {
        setDeleteFeedback({ type: 'error', message: json.error || t('maintenance.update_error') })
      }
    } catch (err: any) {
      setDeleteFeedback({ type: 'error', message: err.message || t('maintenance.update_error') })
    } finally {
      setIsSavingEdit(false)
    }
  }

  // Manejo de eliminación confirmada
  const handleConfirmDelete = async () => {
    if (!logToDelete) return
    setIsDeleting(true)
    try {
      const res = await fetch(`/api/mantenimiento?id=${logToDelete.id}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      })
      const json = await res.json()
      if (json.success) {
        setLogs(prev => prev.filter(l => l.id !== logToDelete.id))
        if (selectedLog?.id === logToDelete.id) {
          setSelectedLog(null)
        }
        setDeleteFeedback({ type: 'success', message: t('maintenance.delete_success') })
        setLogToDelete(null)
        fetchData()
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

  // Filtrado reactivo por texto en cliente (incluye nombre limpio de tienda, teléfono y notas)
  const filteredLogs = useMemo(() => {
    if (!searchTerm.trim()) return logs
    const q = searchTerm.toLowerCase()
    return logs.filter(l =>
      l.company_name?.toLowerCase().includes(q) ||
      l.technician_name?.toLowerCase().includes(q) ||
      l.technician_phone?.toLowerCase().includes(q) ||
      l.area_equipment?.toLowerCase().includes(q) ||
      l.work_description?.toLowerCase().includes(q) ||
      l.invoice_number?.toLowerCase().includes(q) ||
      l.manager_name?.toLowerCase().includes(q) ||
      l.notes?.toLowerCase().includes(q) ||
      l.store?.name?.toLowerCase().includes(q) ||
      formatStoreName(l.store?.name || '').toLowerCase().includes(q)
    )
  }, [logs, searchTerm])

  // Métricas rápidas (prioriza KPIs globales del servidor para que los filtros no distorsionen las tarjetas superiores)
  const totalMonth = useMemo(() => {
    if (globalKpis) return globalKpis.totalMonth
    const pstYearMonth = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit'
    }).format(new Date())
    return logs.filter(l => l.service_date?.startsWith(pstYearMonth)).length
  }, [globalKpis, logs])

  const pendingPartsCount = useMemo(() => {
    if (globalKpis) return globalKpis.pendingPartsCount
    return logs.filter(l => l.status === 'pending_parts').length
  }, [globalKpis, logs])

  const distinctStoresCount = useMemo(() => {
    if (globalKpis) return globalKpis.distinctStoresCount
    const set = new Set(logs.map(l => String(l.store_id)))
    return set.size
  }, [globalKpis, logs])

  const hasActiveFilters =
    selectedStore !== 'all' ||
    selectedCategory !== 'all' ||
    selectedStatus !== 'all' ||
    startDate !== '' ||
    endDate !== '' ||
    searchTerm.trim() !== ''

  const clearAllFilters = () => {
    setSelectedStore('all')
    setSelectedCategory('all')
    setSelectedStatus('all')
    setStartDate('')
    setEndDate('')
    setSearchTerm('')
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

  const getServiceTypeLabel = (type: string) => {
    switch (type) {
      case 'corrective':
        return t('maintenance.type_corrective')
      case 'preventive':
        return t('maintenance.type_preventive')
      case 'emergency':
        return t('maintenance.type_emergency')
      case 'warranty':
        return t('maintenance.type_warranty')
      case 'installation':
        return t('maintenance.type_installation')
      case 'inspection':
        return t('maintenance.type_inspection')
      default:
        return type
    }
  }

  const getStatusLabel = (st: string) => {
    switch (st) {
      case 'completed':
        return t('maintenance.status_completed')
      case 'pending_parts':
        return t('maintenance.status_pending_parts')
      case 'follow_up_needed':
        return t('maintenance.status_follow_up')
      default:
        return st
    }
  }

  // Exportar a CSV (Bilingüe y con fecha PST de Los Ángeles + Horario/Duración + Notas)
  const exportToCSV = () => {
    if (filteredLogs.length === 0) return

    const headers = [
      t('maintenance.date'),
      t('maintenance.time_on_site_col'),
      t('maintenance.store'),
      t('maintenance.vendor'),
      t('maintenance.technician'),
      t('maintenance.technician_phone'),
      t('maintenance.category_title'),
      t('maintenance.service_type'),
      t('maintenance.equipment'),
      t('maintenance.work_description'),
      t('maintenance.parts_replaced'),
      t('maintenance.status_title'),
      t('maintenance.invoice_number'),
      t('maintenance.cost_estimate'),
      t('maintenance.manager_name'),
      t('maintenance.notes_label')
    ]

    const rows = filteredLogs.map(l => [
      `"${l.service_date}"`,
      `"${formatTimeAndDuration(l.start_time, l.end_time) || ''}"`,
      `"${formatStoreName(l.store?.name || 'N/A')}"`,
      `"${(l.company_name || '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`,
      `"${(l.technician_name || '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`,
      `"${l.technician_phone || ''}"`,
      `"${getCategoryBadge(l.category).label}"`,
      `"${getServiceTypeLabel(l.service_type)}"`,
      `"${(l.area_equipment || '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`,
      `"${(l.work_description || '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`,
      `"${(l.parts_replaced || '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`,
      `"${getStatusLabel(l.status)}"`,
      `"${l.invoice_number || ''}"`,
      (l.cost_estimate !== null && l.cost_estimate !== undefined) ? `"${l.cost_estimate}"` : '""',
      `"${(l.manager_name || '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`,
      `"${(l.notes || '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`
    ])

    const pstDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date())

    const csvContent = '\uFEFF' + [headers.map(h => `"${h.replace(/"/g, '""')}"`).join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `bitacora_mantenimiento_tacos_gavilan_${pstDate}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-4 sm:p-8 space-y-8">
      {/* HEADER PRINCIPAL */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#fdc82f] to-[#e69b00] p-1 shadow-lg shadow-amber-500/20 shrink-0">
            <div className="w-full h-full rounded-full bg-white flex items-center justify-center overflow-hidden border border-[#fffbeb]">
              <img src="/logo.png" alt="Tacos Gavilan" className="w-[88%] h-[88%] object-contain" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">
                {t('maintenance.dashboard_title')}
              </h1>
              <img
                src="/ya esta.png"
                alt="¡Ya está!"
                className="h-8 w-auto object-contain drop-shadow-xs"
              />
            </div>
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
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

          {/* Fecha Desde */}
          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">
              {t('maintenance.filter_from')}
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium focus:ring-2 focus:ring-red-500 focus:outline-none"
            />
          </div>

          {/* Fecha Hasta */}
          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">
              {t('maintenance.filter_to')}
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium focus:ring-2 focus:ring-red-500 focus:outline-none"
            />
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

        {hasActiveFilters && (
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={clearAllFilters}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-red-50 dark:hover:bg-red-950/40 text-slate-600 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-400 text-xs font-bold transition-colors"
            >
              <X size={13} />
              <span>{t('maintenance.clear_filters')}</span>
            </button>
          </div>
        )}
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
                  const durationStr = formatTimeAndDuration(log.start_time, log.end_time)

                  return (
                    <tr
                      key={log.id}
                      onClick={() => setSelectedLog(log)}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4 font-bold text-slate-900 dark:text-white whitespace-nowrap">
                        <div>{log.service_date}</div>
                        {durationStr && (
                          <div className="text-[10px] text-slate-400 font-semibold flex items-center gap-1 mt-0.5">
                            <Clock size={10} />
                            <span>{durationStr}</span>
                          </div>
                        )}
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
                        <div className="flex flex-col items-start gap-1">
                          <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${catBadge.color}`}>
                            {catBadge.label}
                          </span>
                          {log.has_repeat_within_30d && (
                            <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                              {t('maintenance.repeat_alert_badge')}
                            </span>
                          )}
                        </div>
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
                        <div className="flex flex-col items-start gap-0.5">
                          <div className="flex items-center gap-1.5">
                            {log.manager_signature_url ? (
                              <ShieldCheck size={14} className="text-emerald-600 shrink-0" />
                            ) : (
                              <User size={14} className="text-amber-500 shrink-0" />
                            )}
                            <span>{log.manager_name}</span>
                          </div>
                          {!log.manager_signature_url && (
                            <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400">
                              {t('maintenance.after_hours_badge')}
                            </span>
                          )}
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
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-black uppercase tracking-wider text-red-600 dark:text-red-400">
                        {formatStoreName(selectedLog.store?.name || 'Tacos Gavilan')} • {selectedLog.service_date}
                      </span>
                      {formatTimeAndDuration(selectedLog.start_time, selectedLog.end_time) && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center gap-1">
                          <Clock size={10} />
                          {formatTimeAndDuration(selectedLog.start_time, selectedLog.end_time)}
                        </span>
                      )}
                    </div>
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
                {/* Alerta de Reincidencia (<30 días) */}
                {selectedLog.has_repeat_within_30d && (
                  <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
                    <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-black block text-xs">{t('maintenance.repeat_alert_badge')}</span>
                      <p className="text-[11px] mt-0.5 leading-relaxed">{t('maintenance.repeat_alert_desc')}</p>
                    </div>
                  </div>
                )}

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
                    <span className="font-bold text-slate-800 dark:text-slate-200 block">
                      {getCategoryBadge(selectedLog.category).label}
                    </span>
                    {selectedLog.service_type && (
                      <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200/80 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                        {getServiceTypeLabel(selectedLog.service_type)}
                      </span>
                    )}
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
                        ${Number(selectedLog.cost_estimate).toFixed(2)} USD
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
                              alt={t('maintenance.before_photos')}
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
                              alt={t('maintenance.after_photos')}
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
                  <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-slate-700 dark:text-slate-300">
                        {t('maintenance.invoice_photo')} ({editPhotosInvoice.length})
                      </span>
                      {editPhotosInvoice.length < 5 && (
                        <label className="cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 text-blue-700 dark:text-blue-300 text-[11px] font-bold border border-blue-200 dark:border-blue-800 transition-colors">
                          <UploadCloud size={13} />
                          <span>
                            {isUploadingAdminInvoice
                              ? t('maintenance.uploading_invoice_admin')
                              : t('maintenance.upload_invoice_admin')}
                          </span>
                          <input
                            type="file"
                            accept="image/*,application/pdf"
                            disabled={isUploadingAdminInvoice}
                            onChange={handleAdminInvoiceUpload}
                            className="hidden"
                          />
                        </label>
                      )}
                    </div>
                    {editPhotosInvoice.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {editPhotosInvoice.map((url, idx) => {
                          const isPdf = url.toLowerCase().endsWith('.pdf') || url.toLowerCase().includes('.pdf?')
                          if (isPdf) {
                            return (
                              <a
                                key={idx}
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="h-28 px-4 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/30 hover:bg-red-100/80 dark:hover:bg-red-900/50 flex flex-col items-center justify-center gap-1.5 text-center transition-colors"
                              >
                                <FileText size={24} className="text-red-600 dark:text-red-400" />
                                <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200">
                                  {t('maintenance.pdf_document')}
                                </span>
                                <span className="text-[10px] font-extrabold text-red-600 dark:text-red-400 underline flex items-center gap-1">
                                  {t('maintenance.open_pdf')} <ExternalLink size={10} />
                                </span>
                              </a>
                            )
                          }
                          return (
                            <img
                              key={idx}
                              src={url}
                              alt={t('maintenance.invoice_photo')}
                              onClick={() => setZoomedImage(url)}
                              className="h-28 object-contain rounded-xl cursor-zoom-in hover:opacity-90 transition-opacity border border-slate-200 dark:border-slate-700 bg-white"
                            />
                          )
                        })}
                      </div>
                    ) : (
                      <p className="text-slate-400 italic text-[11px]">{t('maintenance.no_evidence')}</p>
                    )}
                  </div>
                </div>

                {/* Panel Interactivo de Seguimiento, Cierre de Pendientes y Conciliación de Factura */}
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-3.5">
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-100">
                      {t('maintenance.edit_record_title')}
                    </h4>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {t('maintenance.edit_record_desc')}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                        {t('maintenance.status_title')}
                      </label>
                      <select
                        value={editStatus}
                        onChange={(e) => setEditStatus(e.target.value as any)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold text-xs focus:ring-2 focus:ring-red-500 focus:outline-none"
                      >
                        <option value="completed">{t('maintenance.status_completed')}</option>
                        <option value="pending_parts">{t('maintenance.status_pending_parts')}</option>
                        <option value="follow_up_needed">{t('maintenance.status_follow_up')}</option>
                      </select>
                    </div>

                    <div className="sm:col-span-2 space-y-2">
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300">
                        {t('maintenance.manager_validation_label')} — 👥 {t('maintenance.select_shift_leader_title')}
                      </label>

                      {loadingModalLeaders ? (
                        <div className="flex items-center gap-2 py-2.5 px-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400 font-semibold">
                          <Loader2 size={14} className="animate-spin text-red-600 shrink-0" />
                          <span>{t('maintenance.loading_shift_leaders')}</span>
                        </div>
                      ) : modalShiftLeaders.length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto p-1 rounded-xl bg-white/60 dark:bg-slate-900/40 border border-slate-200/80 dark:border-slate-700/80">
                          {modalShiftLeaders.map((leader) => {
                            const roleLabel =
                              leader.role === 'supervisor'
                                ? t('maintenance.role_supervisor')
                                : leader.role === 'manager'
                                  ? t('maintenance.role_manager')
                                  : leader.role === 'assistant_manager'
                                    ? t('maintenance.role_assistant_manager')
                                    : t('maintenance.role_shift_leader')

                            const formattedOptionValue = `${leader.name} (${roleLabel})`
                            const isSelected =
                              editManagerName.trim().toLowerCase() === formattedOptionValue.toLowerCase() ||
                              editManagerName.trim().toLowerCase() === leader.name.trim().toLowerCase()

                            const roleBadgeClass =
                              leader.role === 'supervisor'
                                ? 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-950/70 dark:text-purple-200 dark:border-purple-800/70'
                                : leader.role === 'manager'
                                  ? 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/70 dark:text-blue-200 dark:border-blue-800/70'
                                  : leader.role === 'assistant_manager'
                                    ? 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/70 dark:text-emerald-200 dark:border-emerald-800/70'
                                    : 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/70 dark:text-amber-200 dark:border-amber-800/70'

                            const shiftBlockLabel =
                              leader.shift_block === 'AM'
                                ? t('maintenance.shift_am_badge')
                                : leader.shift_block === 'PM'
                                  ? t('maintenance.shift_pm_badge')
                                  : leader.shift_block === 'FULL'
                                    ? t('maintenance.shift_full_badge')
                                    : null

                            return (
                              <button
                                key={leader.id}
                                type="button"
                                onClick={() => setEditManagerName(formattedOptionValue)}
                                className={`text-left p-2 rounded-xl border transition-all flex items-start justify-between gap-2 ${
                                  isSelected
                                    ? 'bg-emerald-50/90 dark:bg-emerald-950/50 border-emerald-500 dark:border-emerald-500 ring-2 ring-emerald-500/20 shadow-xs'
                                    : 'bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-700/80 hover:border-red-300 dark:hover:border-red-700'
                                }`}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-xs font-black text-slate-900 dark:text-white truncate">
                                      {leader.name}
                                    </span>
                                    <span className={`px-1.5 py-0.5 rounded-md text-[9.5px] font-extrabold border ${roleBadgeClass}`}>
                                      {roleLabel}
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                                    {leader.start_time && leader.end_time ? (
                                      <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-300 font-mono">
                                        🕒 {leader.start_time} – {leader.end_time}
                                      </span>
                                    ) : null}
                                    {shiftBlockLabel && (
                                      <span className="text-[9.5px] font-bold text-slate-500 dark:text-slate-400">
                                        • {shiftBlockLabel}
                                      </span>
                                    )}
                                    {leader.is_on_shift_now ? (
                                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 text-[9px] font-extrabold">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                        {t('maintenance.on_shift_now_badge')}
                                      </span>
                                    ) : leader.scheduled_today ? (
                                      <span className="px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[9px] font-bold">
                                        📅 {t('maintenance.scheduled_today_badge')}
                                      </span>
                                    ) : (
                                      <span className="px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[9px] font-semibold">
                                        {t('maintenance.store_roster_badge')}
                                      </span>
                                    )}
                                  </div>
                                </div>

                                <div className="shrink-0 mt-0.5">
                                  {isSelected ? (
                                    <CheckCircle2 size={15} className="text-emerald-600 dark:text-emerald-400" />
                                  ) : (
                                    <div className="w-3.5 h-3.5 rounded-full border-2 border-slate-300 dark:border-slate-600" />
                                  )}
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      ) : null}

                      <input
                        type="text"
                        value={editManagerName}
                        onChange={(e) => setEditManagerName(e.target.value)}
                        placeholder={t('maintenance.manager_placeholder')}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold text-xs focus:ring-2 focus:ring-red-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                        {t('maintenance.invoice_number')}
                      </label>
                      <input
                        type="text"
                        value={editInvoiceNumber}
                        onChange={(e) => setEditInvoiceNumber(e.target.value)}
                        placeholder={t('maintenance.invoice_placeholder')}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold text-xs focus:ring-2 focus:ring-red-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                        {t('maintenance.cost_estimate')}
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                        <input
                          type="number"
                          step="0.01"
                          value={editCostEstimate}
                          onChange={(e) => setEditCostEstimate(e.target.value)}
                          placeholder={t('maintenance.cost_placeholder')}
                          className="w-full pl-7 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold text-xs focus:ring-2 focus:ring-red-500 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                      {t('maintenance.notes_label')}
                    </label>
                    <textarea
                      rows={2}
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      placeholder={t('maintenance.notes_placeholder')}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-medium text-xs focus:ring-2 focus:ring-red-500 focus:outline-none resize-none"
                    />
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={isSavingEdit}
                      onClick={handleSaveRecordUpdate}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold flex items-center gap-1.5 shadow-sm transition-all disabled:opacity-50"
                    >
                      {isSavingEdit ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          <span>{t('maintenance.saving_changes')}</span>
                        </>
                      ) : (
                        <>
                          <Save size={14} />
                          <span>{t('maintenance.save_changes')}</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Manager Validation and Signature */}
                <div className="p-4 rounded-2xl bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/60">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <ShieldCheck size={16} className="text-emerald-600" />
                      <span className="font-black uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                        {t('maintenance.manager_sign')}
                      </span>
                    </div>
                    {!selectedLog.manager_signature_url && (
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                        {t('maintenance.after_hours_badge')}
                      </span>
                    )}
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
