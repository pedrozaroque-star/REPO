/**
 * @module BovedaDisputasBlindajeDelivery
 * @description Panel de Historial de Custodia y Entrega Blindada para Tacos Gavilan. Permite revisar cadena de custodia de empaque, entrega a repartidor y estatus automático de órdenes no recogidas (+2h).
 * @businessRules
 * - Horario Laboral de Tacos Gavilan: 6:00 AM a 5:59 AM del siguiente día (Turno PM desde 5:00 PM).
 * - Identificación de Personal: Rastreabilidad estricta mediante el PIN de RONOS del empacador y del colaborador que entrega al chofer.
 * - Estatus Automático (+2h): Si una orden cumple 2 horas o más desde su apertura sin ser recogida por ningún chofer, cambia automáticamente a UNCLAIMED_2H.
 * - Sin Evidencia Fotográfica: Se eliminaron completamente los botones de Expediente y captura de fotografías operativas.
 * @dataFlow Supabase `delivery_packing_audits` & `stores` -> API `/api/delivery-armor/disputes` -> BovedaDisputas UI
 * @notes Piloto inicial en Slauson (#7) y LA Central (#6). Estilo adaptado al diseño claro oficial de Tacos Gavilan con soporte de modo oscuro.
 */

'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import {
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Search,
  Filter,
  RefreshCw,
  Truck,
  Store as StoreIcon,
  ShoppingBag,
  ArrowUpRight
} from 'lucide-react'

// Sucursales piloto
const PILOT_STORES = [
  { id: 0, name: 'Todas las Sucursales' },
  { id: 7, name: 'Slauson (#7)' },
  { id: 6, name: 'LA Central (#6)' }
]

interface DeliveryAuditRow {
  id: string
  store_id: number
  store_name: string
  order_guid: string
  toast_order_id: string
  ticket_number: string
  dining_option_name: string
  platform: 'DOORDASH' | 'UBER_EATS' | 'GRUBHUB' | 'TOAST_ONLINE' | 'TAKEOUT' | 'OTHER'
  customer_name: string
  customer_phone?: string
  opened_at: string
  items_ordered: any[]
  packer_employee_id: string
  packer_name: string
  packer_pin: string
  handoff_at?: string
  handoff_employee_id?: string
  handoff_employee_name?: string
  handoff_employee_pin?: string
  courier_name?: string
  courier_verified?: boolean
  status: 'pending_match' | 'matched' | 'sealed' | 'delivered' | 'unclaimed'
  dispute_status: 'none' | 'disputed' | 'won' | 'lost'
  dispute_notes?: string
  created_at: string
  quick_checks?: any
  risk_level?: string
  evidence_policy?: string
  courier_verification_method?: string
  courier_order_reference?: string
  live_pickup_confirmed?: boolean
}

export default function BovedaDisputasBlindajeDeliveryPage() {
  // Filtros
  const [selectedStoreId, setSelectedStoreId] = useState<number>(0)
  const [selectedPlatform, setSelectedPlatform] = useState<string>('ALL')
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL')
  const [searchQuery, setSearchQuery] = useState<string>('')

  // Estado de Datos
  const [audits, setAudits] = useState<DeliveryAuditRow[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  // Cargar auditorías desde la API
  const fetchAudits = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const url = new URL('/api/delivery-armor/disputes', window.location.origin)
      if (selectedStoreId > 0) {
        url.searchParams.set('storeId', String(selectedStoreId))
      }
      const res = await fetch(url.toString())
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}))
        throw new Error(errJson.error || `Error ${res.status} al consultar la base de datos.`)
      }
      const data = await res.json()
      const rawAudits = data.audits || []
      const normalizedAudits: DeliveryAuditRow[] = rawAudits.map((a: any) => ({
        id: a.id,
        store_id: a.store_id,
        store_name: a.stores?.name || a.store_name || `Sucursal #${a.store_id}`,
        order_guid: a.toast_order_guid || a.order_guid,
        toast_order_id: a.toast_order_guid || a.toast_order_id,
        ticket_number: a.toast_display_number || a.ticket_number || 'S/N',
        dining_option_name: a.dining_option_name || 'Delivery',
        platform: a.platform || 'OTHER',
        customer_name: a.customer_name || 'Cliente Delivery',
        customer_phone: a.customer_phone,
        opened_at: a.order_opened_at || a.opened_at || a.created_at,
        items_ordered: a.items_json || a.items_ordered || [],
        packer_employee_id: String(a.packer_ronos_user_id || a.packer_employee_id || a.packer_pin || ''),
        packer_name: a.packer_ronos_name || a.packer_name || 'Colaborador',
        packer_pin: '••••',
        handoff_at: a.handed_at || a.handoff_at,
        handoff_employee_id: String(a.handed_by_ronos_user_id || a.handoff_employee_id || ''),
        handoff_employee_name: a.handed_by_ronos_name || a.handoff_employee_name,
        handoff_employee_pin: '••••',
        courier_name: a.driver_name || a.courier_name,
        courier_verified: a.driver_confirmed || a.courier_verified,
        status:
          a.status === 'PACKED_AND_SEALED'
            ? 'sealed'
            : a.status === 'DELIVERED'
            ? 'delivered'
            : a.status === 'UNCLAIMED_2H'
            ? 'unclaimed'
            : a.status === 'MATCHED'
            ? 'matched'
            : a.status || 'pending_match',
        dispute_status: a.dispute_status || 'none',
        dispute_notes: a.dispute_notes,
        created_at: a.created_at,
        quick_checks: a.quick_checks,
        risk_level: a.risk_level || 'NORMAL',
        evidence_policy: a.evidence_policy || 'NONE',
        courier_verification_method: a.courier_verification_method,
        courier_order_reference: a.courier_order_reference,
        live_pickup_confirmed: !!a.live_pickup_confirmed
      }))
      setAudits(normalizedAudits)
    } catch (err: any) {
      setError(err.message || 'Error cargando auditorías de empaque.')
    } finally {
      setLoading(false)
    }
  }, [selectedStoreId])

  useEffect(() => {
    fetchAudits()
  }, [fetchAudits])

  // Filtrado reactivo en memoria
  const filteredAudits = useMemo(() => {
    return audits.filter(item => {
      if (selectedStoreId > 0 && item.store_id !== selectedStoreId) return false
      if (selectedPlatform !== 'ALL' && item.platform !== selectedPlatform) return false
      if (selectedStatus !== 'ALL' && item.status !== selectedStatus) return false

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchTicket = item.ticket_number?.toLowerCase().includes(q)
        const matchCustomer = item.customer_name?.toLowerCase().includes(q)
        const matchOrder = item.toast_order_id?.toLowerCase().includes(q)
        const matchKey =
          item.courier_order_reference?.toLowerCase().includes(q) ||
          item.quick_checks?.platformOrderKey?.toLowerCase().includes(q) ||
          item.quick_checks?.shortOrderKey?.toLowerCase().includes(q)
        const matchPacker = item.packer_name?.toLowerCase().includes(q)
        const matchHandoff = item.handoff_employee_name?.toLowerCase().includes(q)
        const matchCourier = item.courier_name?.toLowerCase().includes(q)
        if (!matchTicket && !matchCustomer && !matchOrder && !matchKey && !matchPacker && !matchHandoff && !matchCourier) {
          return false
        }
      }

      return true
    })
  }, [audits, selectedStoreId, selectedPlatform, selectedStatus, searchQuery])

  // Métricas clave (KPIs)
  const stats = useMemo(() => {
    const total = filteredAudits.length
    const sealedCount = filteredAudits.filter(a => a.status === 'sealed').length
    const deliveredCount = filteredAudits.filter(a => a.status === 'delivered').length
    const unclaimedCount = filteredAudits.filter(a => a.status === 'unclaimed').length
    const sealedOrDelivered = sealedCount + deliveredCount + unclaimedCount
    const estimatedSavings = sealedOrDelivered * 32
    return {
      total,
      sealedCount,
      deliveredCount,
      unclaimedCount,
      estimatedSavings
    }
  }, [filteredAudits])

  // Helper para badge de plataforma
  const getPlatformBadge = (platform: DeliveryAuditRow['platform']) => {
    switch (platform) {
      case 'DOORDASH':
        return { bg: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800/40', label: 'DoorDash' }
      case 'UBER_EATS':
        return { bg: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/40', label: 'Uber Eats' }
      case 'GRUBHUB':
        return { bg: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800/40', label: 'Grubhub' }
      case 'TOAST_ONLINE':
        return { bg: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800/40', label: 'Toast Direct' }
      case 'TAKEOUT':
        return { bg: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800/40', label: 'Takeout' }
      default:
        return { bg: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700', label: 'Otro' }
    }
  }

  return (
    <div className="min-h-screen bg-slate-50/60 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans pb-24">
      {/* 1. ENCABEZADO EJECUTIVO */}
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 py-5 sticky top-0 z-30 shadow-sm backdrop-blur-md">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 flex items-center justify-center text-red-600 dark:text-red-400 shadow-sm">
              <ShieldCheck className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                  Blindaje Delivery
                </h1>
                <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/40">
                  HISTORIAL DE CUSTODIA
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Tacos Gavilan • Control de Empaque y Entrega a Repartidores
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/admin/blindaje-delivery/empaque"
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs shadow-md shadow-red-500/20 transition-all active:scale-95"
            >
              <ShoppingBag className="w-4 h-4" />
              <span>Abrir Entrega Blindada (Tablet)</span>
              <ArrowUpRight className="w-3.5 h-3.5 opacity-80" />
            </Link>

            <button
              onClick={fetchAudits}
              disabled={loading}
              className="p-2.5 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-all shadow-sm disabled:opacity-50"
              title="Refrescar auditorías"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-red-600' : ''}`} />
            </button>
          </div>
        </div>
      </header>

      {/* 2. BANNER DE PILOTO OFICIAL */}
      <div className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900/40 px-6 py-2.5">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900 dark:text-amber-300">
          <div className="flex items-center gap-2 font-bold">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <span>PILOTO ACTIVO: SLAUSON (#7) Y LA CENTRAL (#6)</span>
          </div>
          <span className="text-amber-700 dark:text-amber-400 font-mono text-[11px]">
            Horario Laboral: 6:00 AM – 5:59 AM • Turno PM desde 5:00 PM
          </span>
        </div>
      </div>

      <main className="max-w-7xl mx-auto w-full px-4 md:px-6 py-6 space-y-6">
        {error && (
          <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold">
            {error}
          </div>
        )}

        {/* 3. TARJETAS DE MÉTRICAS (KPIS) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Total Órdenes Blindadas */}
          <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-4 border-l-4 border-l-slate-700">
            <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
              <ShoppingBag className="w-6 h-6" />
            </div>
            <div>
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 block">Órdenes Blindadas</span>
              <span className="text-2xl font-black text-slate-900 dark:text-white">{stats.total}</span>
              <span className="text-[11px] text-slate-400 block">Con registro en sistema</span>
            </div>
          </div>

          {/* Empacadas y Selladas */}
          <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-4 border-l-4 border-l-emerald-500">
            <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 block">Listas en Estante</span>
              <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{stats.sealedCount}</span>
              <span className="text-[11px] text-slate-400 block">Esperando recolección</span>
            </div>
          </div>

          {/* Entregas al Chofer */}
          <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-4 border-l-4 border-l-blue-500">
            <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/40">
              <Truck className="w-6 h-6" />
            </div>
            <div>
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 block">Entregas al Chofer</span>
              <span className="text-2xl font-black text-blue-600 dark:text-blue-400">{stats.deliveredCount}</span>
              <span className="text-[11px] text-slate-400 block">Custodia con PIN registrada</span>
            </div>
          </div>

          {/* No Recogidas (+2h) */}
          <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-4 border-l-4 border-l-orange-500">
            <div className="w-12 h-12 rounded-xl bg-orange-50 dark:bg-orange-950/40 flex items-center justify-center text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-800/40">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 block">No Recogidas (+2h)</span>
              <span className="text-2xl font-black text-orange-600 dark:text-orange-400 font-mono">
                {stats.unclaimedCount}
              </span>
              <span className="text-[11px] text-slate-400 block">Cambio automático a las 2 horas</span>
            </div>
          </div>
        </div>

        {/* 4. BARRA DE FILTROS & BÚSQUEDA */}
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
            {/* Selector de Sucursal */}
            <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200">
              <StoreIcon className="w-4 h-4 text-slate-400" />
              <select
                value={selectedStoreId}
                onChange={e => setSelectedStoreId(parseInt(e.target.value, 10))}
                className="bg-transparent text-slate-800 dark:text-slate-200 font-semibold focus:outline-none cursor-pointer"
              >
                {PILOT_STORES.map(s => (
                  <option key={s.id} value={s.id} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Selector de Plataforma */}
            <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200">
              <Filter className="w-4 h-4 text-slate-400" />
              <select
                value={selectedPlatform}
                onChange={e => setSelectedPlatform(e.target.value)}
                className="bg-transparent text-slate-800 dark:text-slate-200 font-semibold focus:outline-none cursor-pointer"
              >
                <option value="ALL" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Todas las Plataformas</option>
                <option value="DOORDASH" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">DoorDash</option>
                <option value="UBER_EATS" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Uber Eats</option>
                <option value="GRUBHUB" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Grubhub</option>
                <option value="TOAST_ONLINE" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Toast Direct</option>
                <option value="TAKEOUT" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Takeout / To Go</option>
              </select>
            </div>

            {/* Selector de Estado */}
            <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200">
              <select
                value={selectedStatus}
                onChange={e => setSelectedStatus(e.target.value)}
                className="bg-transparent text-slate-800 dark:text-slate-200 font-semibold focus:outline-none cursor-pointer"
              >
                <option value="ALL" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Todos los Estados</option>
                <option value="sealed" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Listas en Estante</option>
                <option value="delivered" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Entregadas a Chofer</option>
                <option value="unclaimed" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">No Recogidas (+2h)</option>
              </select>
            </div>
          </div>

          {/* Campo de Búsqueda */}
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar por Cliente, #Check, Clave, Empacador..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-red-500 focus:bg-white dark:focus:bg-slate-900 transition-colors"
            />
          </div>
        </div>

        {/* 5. TABLA DE REGISTROS DE CUSTODIA (SIN EVIDENCIAS NI BOTÓN EXPEDIENTE) */}
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider text-[11px]">
                  <th className="py-3.5 px-4">Ticket / Canal</th>
                  <th className="py-3.5 px-4">Sucursal</th>
                  <th className="py-3.5 px-4">Cliente</th>
                  <th className="py-3.5 px-4">Empacador (RONOS)</th>
                  <th className="py-3.5 px-4">Custodia Entrega</th>
                  <th className="py-3.5 px-4">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {loading && (
                  <tr>
                    <td colSpan={6} className="py-16 text-center text-slate-500 dark:text-slate-400">
                      <RefreshCw className="w-6 h-6 animate-spin mx-auto text-red-600 mb-2" />
                      <span className="font-medium">Cargando registros de custodia...</span>
                    </td>
                  </tr>
                )}

                {!loading && filteredAudits.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-16 text-center text-slate-500 dark:text-slate-400">
                      <ShieldCheck className="w-12 h-12 mx-auto text-slate-300 dark:text-slate-700 mb-2.5" />
                      <p className="text-sm font-bold text-slate-700 dark:text-slate-300">No se encontraron auditorías registradas</p>
                      <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                        Las órdenes empaquetadas y entregadas en la estación de tableta aparecerán aquí con su cadena de custodia.
                      </p>
                    </td>
                  </tr>
                )}

                {!loading &&
                  filteredAudits.map(audit => {
                    const badge = getPlatformBadge(audit.platform)
                    const orderKey =
                      audit.courier_order_reference ||
                      audit.quick_checks?.shortOrderKey ||
                      audit.quick_checks?.platformOrderKey ||
                      `#${audit.ticket_number || audit.toast_order_id.slice(-4)}`
                    const kdsSec = audit.quick_checks?.kdsPrepSeconds
                    const kdsText =
                      kdsSec != null && Number.isFinite(Number(kdsSec))
                        ? `KDS: ${Math.floor(Number(kdsSec) / 60)}m ${Number(kdsSec) % 60}s`
                        : null
                    return (
                      <tr
                        key={audit.id}
                        className="hover:bg-slate-50/70 dark:hover:bg-slate-800/50 transition-colors"
                      >
                        {/* Ticket & Canal */}
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-black text-slate-900 dark:text-white text-sm">
                              {orderKey}
                            </span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${badge.bg}`}>
                              {badge.label}
                            </span>
                          </div>
                          <span className="text-[11px] text-slate-400 block mt-0.5">
                            Ticket #{audit.ticket_number} •{' '}
                            {new Date(audit.created_at).toLocaleTimeString('es-US', {
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: true
                            })}
                            {kdsText ? ` • ${kdsText}` : ''}
                          </span>
                        </td>

                        {/* Sucursal */}
                        <td className="py-3.5 px-4 font-semibold text-slate-800 dark:text-slate-200">
                          {audit.store_name}
                        </td>

                        {/* Cliente */}
                        <td className="py-3.5 px-4">
                          <span className="font-bold text-slate-900 dark:text-slate-100 block truncate max-w-[180px]">
                            {audit.customer_name}
                          </span>
                        </td>

                        {/* Empacador (RONOS PIN) */}
                        <td className="py-3.5 px-4">
                          <span className="font-semibold text-slate-800 dark:text-slate-200 block truncate max-w-[140px]">
                            {audit.packer_name}
                          </span>
                          <span className="text-[10px] font-mono font-bold text-red-600 dark:text-red-400">
                            PIN: {audit.packer_pin}
                          </span>
                        </td>

                        {/* Custodia Entrega */}
                        <td className="py-3.5 px-4">
                          {audit.status === 'delivered' ? (
                            <div>
                              <span className="font-semibold text-blue-700 dark:text-blue-300 block truncate max-w-[160px]">
                                {audit.handoff_employee_name || 'Entregador'}
                              </span>
                              <span className="text-[10px] text-slate-500 dark:text-slate-400 block">
                                {audit.courier_name || 'Chofer verificado'}
                              </span>
                            </div>
                          ) : audit.status === 'unclaimed' ? (
                            <span className="text-[11px] font-bold text-orange-700 dark:text-orange-400">
                              Sin chofer tras 2+ horas
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-400 italic">
                              Pendiente de chofer
                            </span>
                          )}
                        </td>

                        {/* Estado */}
                        <td className="py-3.5 px-4">
                          {audit.status === 'delivered' ? (
                            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800/40 flex items-center gap-1.5 w-max">
                              <Truck className="w-3.5 h-3.5" /> Entregada
                            </span>
                          ) : audit.status === 'unclaimed' ? (
                            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-orange-50 text-orange-700 border border-orange-300 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800/40 flex items-center gap-1.5 w-max">
                              <AlertTriangle className="w-3.5 h-3.5" /> No Recogida (+2h)
                            </span>
                          ) : audit.status === 'sealed' ? (
                            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/40 flex items-center gap-1.5 w-max">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Lista
                            </span>
                          ) : (
                            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/40 flex items-center gap-1.5 w-max">
                              En Cotejo
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  )
}
