/**
 * @module BlindajeDeliveryEmpaque
 * @description Mesa de empaque en tableta para restaurantes de Tacos Gavilan. Incluye cotejo interactivo de artículos, validación de PIN en RONOS, protocolo de doble foto de evidencia y custodia de entrega al repartidor.
 * @businessRules
 * - Horario Laboral: 6:00 AM a 5:59 AM del siguiente día (Turno PM desde 5:00 PM).
 * - Identificación de Personal: PIN de 4 dígitos validado directamente contra el padrón activo de RONOS (Cingular HR), no Toast.
 * - Match Gate 100%: Las cámaras de evidencia quedan estrictamente bloqueadas hasta que se coteja el 100% de los platillos.
 * - Alerta de Bebidas Críticas: Detecta y resalta con banner intermitente bebidas refrigeradas (Horchata, Jarritos, sodas) para evitar olvidos en el refrigerador.
 * - Protocolo de Doble Evidencia: Foto 1 (Contenido abierto con ticket visible) y Foto 2 (Bolsa sellada con etiqueta de seguridad intacta).
 * - Custodia de Entrega (Handoff Gate): Confirmación visual obligatoria de la app activa del repartidor y registro con PIN en RONOS del colaborador que entrega.
 * @dataFlow Toast API (Órdenes Off-Premise) + RONOS (PINs) -> Supabase Storage (delivery-evidence) + DB (delivery_packing_audits)
 * @notes Piloto oficial en Slauson (#7) y LA Central (#6). Estilo adaptado al diseño corporativo claro de Tacos Gavilan.
 */

'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useLanguage } from '@/lib/i18n'
import Link from 'next/link'
import {
  ShieldCheck,
  Camera,
  CheckCircle2,
  AlertTriangle,
  Lock,
  RefreshCw,
  LogOut,
  User,
  ShoppingBag,
  Clock,
  Check,
  X,
  Truck,
  FileText,
  Smartphone,
  Store as StoreIcon,
  BadgeAlert,
  ArrowUpRight,
  Search
} from 'lucide-react'

// Sucursales piloto
const PILOT_STORES = [
  { id: 7, name: 'Slauson (#7)', ronosCompanyId: 328, code: 'SLAUSON' },
  { id: 6, name: 'LA Central (#6)', ronosCompanyId: 31, code: 'LACENTRAL' }
]

interface RonosPacker {
  pin: string
  name: string
  jobTitle: string
  storeId: number
}

interface ToastItem {
  id: string
  name: string
  quantity: number
  price: number
  instructions?: string
  modifiers: {
    id: string
    name: string
    quantity: number
    price: number
  }[]
  is_refrigerated_beverage?: boolean
}

interface ToastOrder {
  order_guid: string
  toast_order_id: string
  ticket_number: string
  dining_option_name: string
  platform: 'DOORDASH' | 'UBER_EATS' | 'GRUBHUB' | 'TOAST_ONLINE' | 'TAKEOUT' | 'OTHER'
  customer_name: string
  customer_phone?: string
  opened_at: string
  server_name: string
  items: ToastItem[]
  total_items_count: number
  has_refrigerated_beverages: boolean
  audit?: {
    id: string
    status: 'pending_match' | 'matched' | 'sealed' | 'delivered'
    photo_open_content_url?: string
    photo_sealed_bag_url?: string
    packer_name?: string
    handoff_employee_name?: string
    courier_name?: string
  }
}

export default function BlindajeDeliveryEmpaquePage() {
  const { t, language } = useLanguage()

  // Estado de Sucursal
  const [selectedStoreId, setSelectedStoreId] = useState<number>(7) // Slauson por defecto
  
  // Estado de Autenticación RONOS
  const [packer, setPacker] = useState<RonosPacker | null>(null)
  const [pinInput, setPinInput] = useState<string>('')
  const [pinLoading, setPinLoading] = useState<boolean>(false)
  const [pinError, setPinError] = useState<string | null>(null)
  const [showPinModal, setShowPinModal] = useState<boolean>(false)

  // Estado de Órdenes Toast
  const [orders, setOrders] = useState<ToastOrder[]>([])
  const [loadingOrders, setLoadingOrders] = useState<boolean>(false)
  const [ordersError, setOrdersError] = useState<string | null>(null)
  const [selectedOrderGuid, setSelectedOrderGuid] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [platformFilter, setPlatformFilter] = useState<'ALL' | 'UBER_EATS' | 'DOORDASH' | 'GRUBHUB' | 'TOAST_ONLINE'>('ALL')

  // Estado de Cotejo Interactivo (Match Checklist)
  const [matchedItems, setMatchedItems] = useState<Record<string, Record<string, boolean>>>({})

  // Estado de Fotos de Evidencia
  const [photo1Uploading, setPhoto1Uploading] = useState<boolean>(false)
  const [photo2Uploading, setPhoto2Uploading] = useState<boolean>(false)
  const [photo1Url, setPhoto1Url] = useState<string | null>(null)
  const [photo2Url, setPhoto2Url] = useState<string | null>(null)

  // Estado de Handoff (Entrega al Chofer)
  const [showHandoffModal, setShowHandoffModal] = useState<boolean>(false)
  const [handoffAppConfirmed, setHandoffAppConfirmed] = useState<boolean>(false)
  const [handoffCourierName, setHandoffCourierName] = useState<string>('')
  const [handoffPin, setHandoffPin] = useState<string>('')
  const [handoffSubmitting, setHandoffSubmitting] = useState<boolean>(false)
  const [handoffSuccessMsg, setHandoffSuccessMsg] = useState<string | null>(null)

  // Recuperar sesión de empacador en montaje
  useEffect(() => {
    try {
      const savedPin = sessionStorage.getItem('blindaje_packer_pin')
      const savedName = sessionStorage.getItem('blindaje_packer_name')
      const savedTitle = sessionStorage.getItem('blindaje_packer_title')
      const savedStore = sessionStorage.getItem('blindaje_packer_store')
      if (savedPin && savedName) {
        setPacker({
          pin: savedPin,
          name: savedName,
          jobTitle: savedTitle || 'Colaborador',
          storeId: savedStore ? parseInt(savedStore, 10) : selectedStoreId
        })
      } else {
        setShowPinModal(true)
      }
    } catch {
      setShowPinModal(true)
    }
  }, [selectedStoreId])

  // Cargar órdenes de Toast API
  const fetchOrders = useCallback(async () => {
    setLoadingOrders(true)
    setOrdersError(null)
    try {
      const res = await fetch(`/api/delivery-armor/orders?storeId=${selectedStoreId}`)
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}))
        throw new Error(errJson.error || `Error ${res.status} al consultar Toast`)
      }
      const data = await res.json()
      const rawList = data.orders || []
      const normalizedOrders: ToastOrder[] = rawList.map((o: any) => ({
        order_guid: o.orderGuid || o.order_guid,
        toast_order_id: o.orderGuid || o.toast_order_id,
        ticket_number: o.displayNumber || o.ticket_number || 'S/N',
        dining_option_name: o.diningOptionName || o.dining_option_name || 'Delivery',
        platform: o.platform || 'OTHER',
        customer_name: o.customerName || o.customer_name || 'Cliente',
        opened_at: o.openedDate || o.opened_at || new Date().toISOString(),
        server_name: o.server_name || 'Toast POS',
        items: (o.items || []).map((i: any) => ({
          id: i.id,
          name: i.displayName || i.name,
          quantity: Number(i.quantity || 1),
          price: Number(i.price || 0),
          modifiers: Array.isArray(i.modifiers)
            ? i.modifiers.map((m: any) => typeof m === 'string' ? { id: m, name: m, quantity: 1, price: 0 } : m)
            : [],
          is_refrigerated_beverage: !!(i.isHighRiskDrink || i.is_refrigerated_beverage)
        })),
        total_items_count: o.totalItemsCount || (o.items || []).length,
        has_refrigerated_beverages: (o.items || []).some((i: any) => i.isHighRiskDrink || i.is_refrigerated_beverage),
        audit: o.audit ? {
          id: o.audit.id,
          status: o.audit.status === 'PACKED_AND_SEALED' ? 'sealed' : (o.audit.status === 'DELIVERED' ? 'delivered' : 'pending_match'),
          photo_open_content_url: o.audit.photoOpenUrl || o.audit.photo_open_content_url,
          photo_sealed_bag_url: o.audit.photoSealedUrl || o.audit.photo_sealed_bag_url,
          packer_name: o.audit.packerName || o.audit.packer_name,
          handoff_employee_name: o.audit.handedByName || o.audit.handoff_employee_name,
          courier_name: o.audit.driverName || o.audit.courier_name
        } : undefined
      }))
      setOrders(normalizedOrders)
      // Si no hay orden seleccionada o la seleccionada ya no existe, seleccionar automáticamente la más reciente (primera)
      setSelectedOrderGuid(prev => {
        if (!prev) return normalizedOrders[0]?.order_guid || null
        const exists = normalizedOrders.some(o => o.order_guid === prev)
        return exists ? prev : (normalizedOrders[0]?.order_guid || null)
      })
    } catch (err: any) {
      setOrdersError(err.message || 'No se pudieron cargar las órdenes de Toast')
    } finally {
      setLoadingOrders(false)
    }
  }, [selectedStoreId])

  // Cargar órdenes al cambiar de tienda
  useEffect(() => {
    fetchOrders()
    const timer = setInterval(() => {
      fetchOrders()
    }, 25000)
    return () => clearInterval(timer)
  }, [fetchOrders])

  // Órdenes filtradas por plataforma de delivery y búsqueda
  const filteredOrders = useMemo(() => {
    return orders.filter(o => {
      // Filtro de plataforma específica (Uber Eats, DoorDash, Grubhub, Toast Online)
      if (platformFilter !== 'ALL' && o.platform !== platformFilter) {
        return false
      }

      // Filtro de búsqueda por texto (número de ticket, nombre de cliente o canal)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchesTicket = (o.ticket_number || '').toLowerCase().includes(q)
        const matchesCust = (o.customer_name || '').toLowerCase().includes(q)
        const matchesOption = (o.dining_option_name || '').toLowerCase().includes(q)
        if (!matchesTicket && !matchesCust && !matchesOption) return false
      }

      return true
    })
  }, [orders, platformFilter, searchQuery])

  // Orden seleccionada activa
  const activeOrder = useMemo(() => {
    if (!selectedOrderGuid) return null
    return orders.find(o => o.order_guid === selectedOrderGuid) || null
  }, [orders, selectedOrderGuid])

  // Sincronizar fotos y cotejo si la orden activa ya tiene auditoría previa
  useEffect(() => {
    if (activeOrder?.audit) {
      if (activeOrder.audit.photo_open_content_url) {
        setPhoto1Url(activeOrder.audit.photo_open_content_url)
      } else {
        setPhoto1Url(null)
      }
      if (activeOrder.audit.photo_sealed_bag_url) {
        setPhoto2Url(activeOrder.audit.photo_sealed_bag_url)
      } else {
        setPhoto2Url(null)
      }
    } else {
      setPhoto1Url(null)
      setPhoto2Url(null)
    }
  }, [activeOrder])

  // Cálculo de progreso de cotejo para la orden activa (Platillos + Condimentos táctiles)
  const matchStats = useMemo(() => {
    if (!activeOrder || !activeOrder.items) return { total: 0, checked: 0, percentage: 0, isComplete: false }
    const orderItems = activeOrder.items
    const orderChecks = matchedItems[activeOrder.order_guid] || {}

    let total = 0
    let checked = 0

    orderItems.forEach(item => {
      // Platillo principal
      total += 1
      if (orderChecks[item.id]) checked += 1

      // Condimentos / Modificadores individuales que requieren cotejo táctil
      if (item.modifiers && item.modifiers.length > 0) {
        item.modifiers.forEach((_, mIdx) => {
          total += 1
          if (orderChecks[`${item.id}_mod_${mIdx}`]) checked += 1
        })
      }
    })

    const percentage = total > 0 ? Math.round((checked / total) * 100) : 0
    return {
      total,
      checked,
      percentage,
      isComplete: total > 0 && checked === total
    }
  }, [activeOrder, matchedItems])

  // Validar PIN contra RONOS
  const handleVerifyPin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!pinInput || pinInput.length < 3) {
      setPinError('Ingresa tu PIN de RONOS de 4 dígitos.')
      return
    }

    setPinLoading(true)
    setPinError(null)

    try {
      const res = await fetch('/api/delivery-armor/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: selectedStoreId,
          pin: pinInput.trim()
        })
      })

      const data = await res.json()
      if (!res.ok || (!data.ok && !data.verified)) {
        setPinError(data.error || 'PIN no encontrado en RONOS para esta sucursal.')
        setPinLoading(false)
        return
      }

      const emp = data.employee || {}
      const packerData: RonosPacker = {
        pin: pinInput.trim(),
        name: emp.fullName || emp.full_name || 'Colaborador',
        jobTitle: emp.jobTitle || emp.job_title || 'Colaborador',
        storeId: selectedStoreId
      }
      setPacker(packerData)
      try {
        sessionStorage.setItem('blindaje_packer_pin', packerData.pin)
        sessionStorage.setItem('blindaje_packer_name', packerData.name)
        sessionStorage.setItem('blindaje_packer_title', packerData.jobTitle)
        sessionStorage.setItem('blindaje_packer_store', String(selectedStoreId))
      } catch {}
      setPinInput('')
      setShowPinModal(false)
    } catch (err: any) {
      setPinError(err.message || 'Error de conexión con el servidor')
    } finally {
      setPinLoading(false)
    }
  }

  // Cerrar sesión / rotar turno
  const handleLogout = () => {
    setPacker(null)
    try {
      sessionStorage.removeItem('blindaje_packer_pin')
      sessionStorage.removeItem('blindaje_packer_name')
      sessionStorage.removeItem('blindaje_packer_title')
    } catch {}
    setShowPinModal(true)
  }

  // Toggle artículo individual o condimento en cotejo
  const toggleItemMatch = (checkKey: string) => {
    if (!activeOrder) return
    const orderGuid = activeOrder.order_guid
    setMatchedItems(prev => {
      const currentOrderMap = prev[orderGuid] || {}
      return {
        ...prev,
        [orderGuid]: {
          ...currentOrderMap,
          [checkKey]: !currentOrderMap[checkKey]
        }
      }
    })
  }

  // Marcar platillo y todos sus condimentos a la vez con un solo toque
  const toggleItemAndModifiers = (item: ToastItem) => {
    if (!activeOrder) return
    const orderGuid = activeOrder.order_guid
    setMatchedItems(prev => {
      const currentOrderMap = prev[orderGuid] || {}
      const isCurrentlyChecked = !!currentOrderMap[item.id]
      const nextStatus = !isCurrentlyChecked

      const updatedMap = { ...currentOrderMap, [item.id]: nextStatus }
      if (item.modifiers && item.modifiers.length > 0) {
        item.modifiers.forEach((_, mIdx) => {
          updatedMap[`${item.id}_mod_${mIdx}`] = nextStatus
        })
      }

      return {
        ...prev,
        [orderGuid]: updatedMap
      }
    })
  }

  // Subir Foto 1 o Foto 2
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>, photoType: 'photo1_open' | 'photo2_sealed') => {
    const file = e.target.files?.[0]
    if (!file || !activeOrder) return

    if (photoType === 'photo1_open') setPhoto1Uploading(true)
    if (photoType === 'photo2_sealed') setPhoto2Uploading(true)

    try {
      const formData = new FormData()
      formData.append('photo', file)
      formData.append('orderGuid', activeOrder.order_guid)
      formData.append('photoType', photoType)

      const res = await fetch('/api/delivery-armor/upload-photo', {
        method: 'POST',
        body: formData
      })

      const data = await res.json()
      if (!res.ok || !data.publicUrl) {
        throw new Error(data.error || 'Error al subir la fotografía de evidencia.')
      }

      if (photoType === 'photo1_open') {
        setPhoto1Url(data.publicUrl)
      } else {
        setPhoto2Url(data.publicUrl)
      }
    } catch (err: any) {
      alert(`Error al guardar foto: ${err.message}`)
    } finally {
      if (photoType === 'photo1_open') setPhoto1Uploading(false)
      if (photoType === 'photo2_sealed') setPhoto2Uploading(false)
    }
  }

  // Guardar y Sellar Orden (Registrar Auditoría)
  const handleSaveSealedAudit = async () => {
    if (!activeOrder || !packer) return
    if (!matchStats.isComplete) {
      alert('Debes cotejar el 100% de los artículos antes de sellar la orden.')
      return
    }
    if (!photo1Url || !photo2Url) {
      alert('Se requieren obligatoriamente ambas fotos: Foto 1 (Contenido abierto) y Foto 2 (Bolsa sellada).')
      return
    }

    try {
      const res = await fetch('/api/delivery-armor/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id: selectedStoreId,
          order_guid: activeOrder.order_guid,
          toast_order_id: activeOrder.toast_order_id,
          ticket_number: activeOrder.ticket_number,
          dining_option_name: activeOrder.dining_option_name,
          platform: activeOrder.platform,
          customer_name: activeOrder.customer_name,
          customer_phone: activeOrder.customer_phone,
          opened_at: activeOrder.opened_at,
          items_ordered: activeOrder.items,
          packer_employee_id: packer.pin,
          packer_name: packer.name,
          packer_pin: packer.pin,
          photo_open_content_url: photo1Url,
          photo_sealed_bag_url: photo2Url,
          status: 'sealed'
        })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error guardando auditoría de empaque.')

      alert('¡Orden sellada y blindada con éxito! La bolsa ya está lista para entrega al repartidor.')
      fetchOrders()
    } catch (err: any) {
      alert(`Error: ${err.message}`)
    }
  }

  // Ejecutar Entrega al Chofer (Handoff)
  const handleExecuteHandoff = async () => {
    if (!activeOrder) return
    if (!handoffAppConfirmed) {
      alert('Debes confirmar que viste la pantalla viva de la app del repartidor.')
      return
    }

    const pinToUse = handoffPin.trim() || packer?.pin
    if (!pinToUse) {
      alert('Debes ingresar tu PIN de RONOS para registrar la custodia de entrega.')
      return
    }

    setHandoffSubmitting(true)
    try {
      const res = await fetch('/api/delivery-armor/audit', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_guid: activeOrder.order_guid,
          store_id: selectedStoreId,
          handoff_pin: pinToUse,
          courier_name: handoffCourierName.trim() || undefined,
          courier_verified: true
        })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al registrar la entrega al repartidor.')

      setHandoffSuccessMsg(`¡Orden entregada a ${handoffCourierName || 'repartidor'} por ${data.audit.handoff_employee_name}!`)
      setTimeout(() => {
        setHandoffSuccessMsg(null)
        setShowHandoffModal(false)
        setHandoffCourierName('')
        setHandoffPin('')
        setHandoffAppConfirmed(false)
        fetchOrders()
      }, 2000)
    } catch (err: any) {
      alert(`Error de entrega: ${err.message}`)
    } finally {
      setHandoffSubmitting(false)
    }
  }

  // Color de badge por plataforma
  const getPlatformBadge = (platform: ToastOrder['platform']) => {
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
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans select-none">
      {/* 1. BARRA SUPERIOR: ENCABEZADO EJECUTIVO & PILOTO */}
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-5 py-3.5 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-30 shadow-sm backdrop-blur-md">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 flex items-center justify-center text-red-600 dark:text-red-400 shadow-sm">
            <ShieldCheck className="w-7 h-7" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                Blindaje Delivery
                <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800/50">
                  MESA DE EMPAQUE
                </span>
              </h1>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Tacos Gavilan • Control de Empaque y Protección contra Contracargos
            </p>
          </div>
        </div>

        {/* Selector de Sucursal Piloto */}
        <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 p-1.5 rounded-xl border border-slate-200 dark:border-slate-700">
          <StoreIcon className="w-4 h-4 text-slate-500 ml-1.5" />
          {PILOT_STORES.map(store => (
            <button
              key={store.id}
              onClick={() => {
                setSelectedStoreId(store.id)
                setSelectedOrderGuid(null)
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                selectedStoreId === store.id
                  ? 'bg-red-600 text-white shadow-md'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {store.name}
            </button>
          ))}
        </div>

        {/* Acceso a Bóveda de Disputas & Colaborador Logueado en RONOS */}
        <div className="flex items-center gap-3">
          <Link
            href="/admin/blindaje-delivery"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors shadow-sm"
          >
            <FileText className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
            <span>Bóveda de Disputas</span>
          </Link>

          {packer ? (
            <div className="flex items-center gap-2.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/40 px-3 py-1.5 rounded-xl shadow-sm">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <div className="text-left">
                <p className="text-xs font-bold text-emerald-800 dark:text-emerald-300 leading-tight">{packer.name}</p>
                <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono leading-tight">PIN RONOS: {packer.pin}</p>
              </div>
              <button
                onClick={handleLogout}
                title="Cambiar turno / Salir"
                className="ml-1 text-slate-400 hover:text-red-600 transition-colors"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowPinModal(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs shadow-md shadow-red-500/20 transition-all active:scale-95"
            >
              <User className="w-4 h-4" />
              <span>Ingresar PIN RONOS</span>
            </button>
          )}

          <button
            onClick={fetchOrders}
            disabled={loadingOrders}
            className="p-2 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shadow-sm disabled:opacity-50"
            title="Refrescar órdenes de Toast"
          >
            <RefreshCw className={`w-4 h-4 ${loadingOrders ? 'animate-spin text-red-600' : ''}`} />
          </button>
        </div>
      </header>

      {/* 2. CONTENIDO PRINCIPAL: DOS COLUMNAS */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
        {/* COLUMNA IZQUIERDA: COLA DE ÓRDENES DELIVERY (4 COLS) */}
        <aside className="lg:col-span-4 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col h-full overflow-hidden shadow-sm">
          <div className="p-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-850">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-red-600 dark:text-red-400" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                Órdenes de Delivery
              </h2>
            </div>
            <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900/40 shadow-sm">
              {filteredOrders.length} {filteredOrders.length !== orders.length ? `de ${orders.length}` : 'activas'}
            </span>
          </div>

          {/* Buscador táctil y filtros rápidos de plataforma de delivery */}
          <div className="p-2.5 border-b border-slate-200 dark:border-slate-800 space-y-2 bg-white dark:bg-slate-900">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Buscar por ticket #, cliente..."
                className="w-full pl-9 pr-8 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
              <button
                onClick={() => setPlatformFilter('ALL')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all whitespace-nowrap ${
                  platformFilter === 'ALL'
                    ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-sm'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                }`}
              >
                Todas ({orders.length})
              </button>
              <button
                onClick={() => setPlatformFilter('UBER_EATS')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all whitespace-nowrap ${
                  platformFilter === 'UBER_EATS'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/40 hover:bg-emerald-100'
                }`}
              >
                Uber Eats
              </button>
              <button
                onClick={() => setPlatformFilter('DOORDASH')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all whitespace-nowrap ${
                  platformFilter === 'DOORDASH'
                    ? 'bg-red-600 text-white shadow-sm'
                    : 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900/40 hover:bg-red-100'
                }`}
              >
                DoorDash
              </button>
              <button
                onClick={() => setPlatformFilter('GRUBHUB')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all whitespace-nowrap ${
                  platformFilter === 'GRUBHUB'
                    ? 'bg-orange-600 text-white shadow-sm'
                    : 'bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-900/40 hover:bg-orange-100'
                }`}
              >
                Grubhub
              </button>
              <button
                onClick={() => setPlatformFilter('TOAST_ONLINE')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all whitespace-nowrap ${
                  platformFilter === 'TOAST_ONLINE'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-900/40 hover:bg-blue-100'
                }`}
              >
                Toast Online
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5">
            {ordersError && (
              <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-300 text-xs flex items-start gap-2 shadow-sm">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{ordersError}</span>
              </div>
            )}

            {filteredOrders.length === 0 && !loadingOrders && (
              <div className="text-center py-16 px-4">
                <ShoppingBag className="w-12 h-12 mx-auto text-slate-300 dark:text-slate-700 mb-3" />
                <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                  {orders.length === 0 ? 'Sin órdenes de entrega pendientes' : 'No coinciden órdenes con el filtro'}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  {orders.length === 0 
                    ? 'Las órdenes de DoorDash, Uber Eats, Grubhub y Toast Online aparecerán aquí automáticamente.'
                    : 'Intenta limpiar el buscador o cambiar de pestaña.'}
                </p>
              </div>
            )}

            {filteredOrders.map(order => {
              const badge = getPlatformBadge(order.platform)
              const isSelected = selectedOrderGuid === order.order_guid
              const isSealed = order.audit?.status === 'sealed'
              const isDelivered = order.audit?.status === 'delivered'

              return (
                <div
                  key={order.order_guid}
                  onClick={() => setSelectedOrderGuid(order.order_guid)}
                  className={`p-3.5 rounded-2xl border transition-all cursor-pointer relative overflow-hidden ${
                    isSelected
                      ? 'bg-red-50/40 dark:bg-red-950/20 border-red-500 shadow-md ring-2 ring-red-500/20'
                      : isDelivered
                      ? 'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800 opacity-60'
                      : 'bg-white dark:bg-slate-850 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 shadow-sm'
                  }`}
                >
                  {/* Status Strip */}
                  <div
                    className={`absolute top-0 left-0 bottom-0 w-1.5 ${
                      isDelivered
                        ? 'bg-blue-500'
                        : isSealed
                        ? 'bg-purple-500'
                        : order.has_refrigerated_beverages
                        ? 'bg-amber-500'
                        : 'bg-slate-300 dark:bg-slate-700'
                    }`}
                  />

                  <div className="pl-2">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${badge.bg}`}>
                        {badge.label}
                      </span>
                      <span className="text-xs font-mono font-black text-slate-900 dark:text-white">
                        #{order.ticket_number || order.toast_order_id.slice(-4)}
                      </span>
                    </div>

                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                        {order.customer_name || 'Cliente sin nombre'}
                      </h3>
                      <span className="text-[11px] text-slate-400 flex items-center gap-1 font-mono">
                        <Clock className="w-3 h-3 text-slate-400" />
                        {new Date(order.opened_at).toLocaleTimeString('es-US', {
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: true
                        })}
                      </span>
                    </div>

                    <div className="mt-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800">
                      <span>{order.dining_option_name}</span>
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        {order.total_items_count} artículos
                      </span>
                    </div>

                    {/* Alerta de Bebida Refrigerada */}
                    {order.has_refrigerated_beverages && (
                      <div className="mt-2 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/40 text-[11px] font-bold text-amber-800 dark:text-amber-300">
                        <BadgeAlert className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
                        <span>¡LLEVA BEBIDA EN REFRIGERADOR!</span>
                      </div>
                    )}

                    {/* Estado de Auditoría */}
                    {isDelivered ? (
                      <div className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-blue-600 dark:text-blue-400">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Entregado a chofer ({order.audit?.courier_name || 'Repartidor'})</span>
                      </div>
                    ) : isSealed ? (
                      <div className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-purple-600 dark:text-purple-400">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Bolsa Sellada y Protegida ✓</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        </aside>

        {/* COLUMNA DERECHA: MESA DE EMPAQUE INTERACTIVA (8 COLS) */}
        <main className="lg:col-span-8 bg-slate-50/70 dark:bg-slate-950 flex flex-col h-full overflow-y-auto">
          {!activeOrder ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <div className="w-16 h-16 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-center text-slate-400 mb-4 shadow-sm">
                <ShoppingBag className="w-8 h-8" />
              </div>
              <h2 className="text-base font-bold text-slate-800 dark:text-slate-200">Selecciona una orden de la lista</h2>
              <p className="text-xs text-slate-500 max-w-sm mt-1">
                Toca cualquier orden en la columna izquierda para iniciar el cotejo interactivo y la captura de las 2 fotos de evidencia.
              </p>
            </div>
          ) : (
            <div className="p-4 lg:p-6 max-w-4xl mx-auto w-full space-y-6">
              {/* TARJETA DE RESUMEN DE LA ORDEN */}
              <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3.5 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${
                        getPlatformBadge(activeOrder.platform).bg
                      }`}
                    >
                      {getPlatformBadge(activeOrder.platform).label}
                    </span>
                    <h2 className="text-xl font-black text-slate-900 dark:text-white">
                      Orden #{activeOrder.ticket_number || activeOrder.toast_order_id.slice(-4)}
                    </h2>
                  </div>
                  <div className="flex items-center gap-2">
                    {activeOrder.audit?.status === 'delivered' ? (
                      <span className="px-3 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800/40 flex items-center gap-1.5">
                        <Truck className="w-3.5 h-3.5" />
                        ENTREGADO AL CHOFER
                      </span>
                    ) : activeOrder.audit?.status === 'sealed' ? (
                      <span className="px-3 py-1 rounded-full text-xs font-bold bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800/40 flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5" />
                        BOLSA SELLADA Y BLINDADA
                      </span>
                    ) : (
                      <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/40 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        EN PROCESO DE EMPAQUE
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-3.5 text-xs">
                  <div>
                    <span className="text-slate-400 block font-medium">Cliente:</span>
                    <span className="font-bold text-slate-800 dark:text-slate-100 text-sm">{activeOrder.customer_name}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-medium">Canal:</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">{activeOrder.dining_option_name}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-medium">Hora de Entrada:</span>
                    <span className="font-mono text-slate-700 dark:text-slate-300">
                      {new Date(activeOrder.opened_at).toLocaleTimeString('es-US', {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true
                      })}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-medium">Empacador Activo:</span>
                    <span className="font-bold text-red-600 dark:text-red-400">{packer?.name || 'Sin identificar'}</span>
                  </div>
                </div>
              </div>

              {/* PASO 1: COTEJO INTERACTIVO DE ARTÍCULOS (MATCH GATE) */}
              <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-7 h-7 rounded-xl flex items-center justify-center font-black text-xs ${
                        matchStats.isComplete ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
                      }`}
                    >
                      1
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                        Cotejo Interactivo de Artículos (Match Gate)
                      </h3>
                      <p className="text-xs text-slate-500">
                        Toca cada platillo conforme lo empacas en la bolsa.
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span
                      className={`text-xs font-mono font-bold px-2.5 py-1 rounded-lg ${
                        matchStats.isComplete
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/40'
                          : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      {matchStats.checked} de {matchStats.total} ({matchStats.percentage}%)
                    </span>
                  </div>
                </div>

                {/* Barra de Progreso */}
                <div className="w-full h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      matchStats.isComplete ? 'bg-emerald-500' : 'bg-red-600'
                    }`}
                    style={{ width: `${matchStats.percentage}%` }}
                  />
                </div>

                {/* Banner de Bebidas Críticas si aplica */}
                {activeOrder.has_refrigerated_beverages && (
                  <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800/40 flex items-center gap-3 animate-pulse shadow-sm">
                    <BadgeAlert className="w-6 h-6 text-amber-600 flex-shrink-0" />
                    <div>
                      <h4 className="text-xs font-black text-amber-900 dark:text-amber-200 uppercase tracking-wide">
                        ¡ATENCIÓN! ESTA ORDEN CONTIENE BEBIDAS EN REFRIGERADOR
                      </h4>
                      <p className="text-xs text-amber-800 dark:text-amber-300/90 mt-0.5">
                        Asegúrate de sacar las Horchatas, aguas frescas o sodas mexicanas del refrigerador antes de sellar.
                      </p>
                    </div>
                  </div>
                )}

                {/* Lista de Artículos para Cotejar */}
                <div className="space-y-2">
                  {activeOrder.items.map((item, idx) => {
                    const isChecked = matchedItems[activeOrder.order_guid]?.[item.id] || false
                    return (
                      <div
                        key={`${item.id}-${idx}`}
                        className={`p-3.5 rounded-xl border transition-all ${
                          isChecked
                            ? 'bg-emerald-50/70 border-emerald-300 dark:bg-emerald-950/20 dark:border-emerald-800/40'
                            : item.is_refrigerated_beverage
                            ? 'bg-amber-50/50 border-amber-300 dark:bg-amber-950/20 dark:border-amber-800/40 hover:bg-amber-50'
                            : 'bg-slate-50/80 dark:bg-slate-800/70 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div 
                            onClick={() => toggleItemMatch(item.id)}
                            className="flex items-start gap-3 flex-1 min-w-0 cursor-pointer"
                          >
                            <div
                              className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 border transition-all ${
                                isChecked
                                  ? 'bg-emerald-600 border-emerald-600 text-white'
                                  : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800'
                              }`}
                            >
                              {isChecked && <Check className="w-4 h-4 stroke-[3]" />}
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-black text-red-600 dark:text-red-400 font-mono">
                                  {item.quantity}x
                                </span>
                                <span
                                  className={`text-sm font-bold truncate ${
                                    isChecked ? 'line-through text-slate-400' : 'text-slate-900 dark:text-white'
                                  }`}
                                >
                                  {item.name}
                                </span>
                                {item.is_refrigerated_beverage && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/50">
                                    BEBIDA FRÍA
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => toggleItemAndModifiers(item)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap active:scale-95 ${
                              isChecked
                                ? 'bg-emerald-600 text-white shadow-sm'
                                : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            {isChecked ? 'PLATILLO LISTO ✓' : 'COTEJAR TODO'}
                          </button>
                        </div>

                        {/* Condimentos y Modificadores táctiles (Toca con el dedo) */}
                        {item.modifiers && item.modifiers.length > 0 && (
                          <div className="mt-3 pt-2.5 border-t border-slate-200/80 dark:border-slate-700/80">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-1.5">
                              Condimentos & Preparación (Toca con el dedo para confirmar):
                            </span>
                            <div className="flex flex-wrap gap-2">
                              {item.modifiers.map((mod, mIdx) => {
                                const modKey = `${item.id}_mod_${mIdx}`
                                const isModChecked = matchedItems[activeOrder.order_guid]?.[modKey] || false

                                return (
                                  <button
                                    key={mIdx}
                                    type="button"
                                    onClick={() => toggleItemMatch(modKey)}
                                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border shadow-sm active:scale-95 ${
                                      isModChecked
                                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-emerald-500/20'
                                        : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-600 hover:border-emerald-500 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/20'
                                    }`}
                                  >
                                    <div
                                      className={`w-4 h-4 rounded-md flex items-center justify-center border transition-all ${
                                        isModChecked
                                          ? 'bg-white text-emerald-600 border-white'
                                          : 'bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-500'
                                      }`}
                                    >
                                      {isModChecked && <Check className="w-3 h-3 stroke-[3]" />}
                                    </div>
                                    <span>{mod.name}</span>
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )}

                        {/* Instrucciones especiales */}
                        {item.instructions && (
                          <p className="text-xs text-amber-700 dark:text-amber-400 mt-2 pl-2 italic">
                            Nota: {item.instructions}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* PASO 2: PROTOCOLO DE DOBLE FOTO DE EVIDENCIA */}
              <div
                className={`p-5 rounded-2xl border transition-all ${
                  matchStats.isComplete
                    ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm'
                    : 'bg-slate-100/60 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800 opacity-70'
                }`}
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-7 h-7 rounded-xl flex items-center justify-center font-black text-xs ${
                        matchStats.isComplete ? 'bg-red-600 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                      }`}
                    >
                      2
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        Protocolo de Doble Foto de Evidencia
                        {!matchStats.isComplete && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 flex items-center gap-1">
                            <Lock className="w-3 h-3" /> BLOQUEADO
                          </span>
                        )}
                      </h3>
                      <p className="text-xs text-slate-500">
                        Ambas fotografías son requeridas para desmentir quejas falsas y robos en camino.
                      </p>
                    </div>
                  </div>
                </div>

                {!matchStats.isComplete ? (
                  <div className="p-6 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-700 text-center py-8">
                    <Lock className="w-8 h-8 mx-auto text-slate-400 mb-2" />
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      Match Gate Incompleto ({matchStats.percentage}%)
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1 max-w-sm mx-auto">
                      Coteja el 100% de los artículos en el Paso 1 para desbloquear la cámara de fotos.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* FOTO 1: CONTENIDO ABIERTO + TICKET */}
                    <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-700 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                            <Camera className="w-4 h-4 text-red-600" />
                            Foto 1: Contenido Abierto + Ticket
                          </h4>
                          {photo1Url && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300">
                              GUARDADA ✓
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                          Destapa recipientes y coloca el ticket al lado para desmentir quejas falsas de comida faltante.
                        </p>
                      </div>

                      <div className="mt-4">
                        {photo1Url ? (
                          <div className="relative group rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-white aspect-video flex items-center justify-center shadow-sm">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={photo1Url}
                              alt="Foto 1: Contenido Abierto"
                              className="w-full h-full object-cover"
                            />
                            <label className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center cursor-pointer transition-opacity text-xs font-bold text-white gap-2">
                              <Camera className="w-4 h-4" />
                              <span>Reemplazar Foto</span>
                              <input
                                type="file"
                                accept="image/*"
                                capture="environment"
                                className="hidden"
                                onChange={e => handlePhotoUpload(e, 'photo1_open')}
                              />
                            </label>
                          </div>
                        ) : (
                          <label
                            className={`w-full py-5 rounded-xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-all ${
                              photo1Uploading
                                ? 'bg-red-50 border-red-400 text-red-700'
                                : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 hover:border-red-500 hover:bg-red-50/20 text-slate-700 dark:text-slate-300 shadow-sm'
                            }`}
                          >
                            <Camera className="w-6 h-6 mb-1 text-red-600" />
                            <span className="text-xs font-bold">
                              {photo1Uploading ? 'Subiendo Fotografía...' : '📸 Tomar Foto de Contenido'}
                            </span>
                            <span className="text-[10px] text-slate-400 mt-0.5">
                              Toca para activar la cámara de la tableta
                            </span>
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              className="hidden"
                              disabled={photo1Uploading}
                              onChange={e => handlePhotoUpload(e, 'photo1_open')}
                            />
                          </label>
                        )}
                      </div>
                    </div>

                    {/* FOTO 2: BOLSA SELLADA + SELLO INVIOLABLE */}
                    <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-700 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                            <Lock className="w-4 h-4 text-purple-600" />
                            Foto 2: Bolsa Sellada + Sello Intacto
                          </h4>
                          {photo2Url && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300">
                              GUARDADA ✓
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                          Dobla la bolsa y pega el sello destructible; toma la foto para deslindar a la tienda de robos del repartidor.
                        </p>
                      </div>

                      <div className="mt-4">
                        {photo2Url ? (
                          <div className="relative group rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-white aspect-video flex items-center justify-center shadow-sm">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={photo2Url}
                              alt="Foto 2: Bolsa Sellada"
                              className="w-full h-full object-cover"
                            />
                            <label className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center cursor-pointer transition-opacity text-xs font-bold text-white gap-2">
                              <Camera className="w-4 h-4" />
                              <span>Reemplazar Foto</span>
                              <input
                                type="file"
                                accept="image/*"
                                capture="environment"
                                className="hidden"
                                onChange={e => handlePhotoUpload(e, 'photo2_sealed')}
                              />
                            </label>
                          </div>
                        ) : (
                          <label
                            className={`w-full py-5 rounded-xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-all ${
                              photo2Uploading
                                ? 'bg-purple-50 border-purple-400 text-purple-700'
                                : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 hover:border-purple-500 hover:bg-purple-50/20 text-slate-700 dark:text-slate-300 shadow-sm'
                            }`}
                          >
                            <Lock className="w-6 h-6 mb-1 text-purple-600" />
                            <span className="text-xs font-bold">
                              {photo2Uploading ? 'Subiendo Fotografía...' : '📸 Tomar Foto de Bolsa Sellada'}
                            </span>
                            <span className="text-[10px] text-slate-400 mt-0.5">
                              Toca para activar la cámara de la tableta
                            </span>
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              className="hidden"
                              disabled={photo2Uploading}
                              onChange={e => handlePhotoUpload(e, 'photo2_sealed')}
                            />
                          </label>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* BOTÓN DE SELLAR Y GUARDAR */}
                {matchStats.isComplete && photo1Url && photo2Url && (
                  <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                    <button
                      onClick={handleSaveSealedAudit}
                      className="px-6 py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm shadow-md shadow-red-500/20 flex items-center gap-2 transition-all active:scale-95"
                    >
                      <ShieldCheck className="w-5 h-5" />
                      <span>Guardar Doble Evidencia y Sellar Orden</span>
                    </button>
                  </div>
                )}
              </div>

              {/* PASO 3: CUSTODIA Y ENTREGA AL CHOFER (HANDOFF GATE) */}
              <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-xl bg-blue-600 text-white flex items-center justify-center font-black text-xs">
                      3
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        Custodia y Entrega al Repartidor (Handoff Gate)
                      </h3>
                      <p className="text-xs text-slate-500">
                        Exige ver la aplicación activa en el teléfono del chofer antes de liberar la bolsa.
                      </p>
                    </div>
                  </div>

                  {activeOrder.audit?.status === 'delivered' ? (
                    <div className="text-right">
                      <span className="text-xs font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4" /> Entregada por {activeOrder.audit.handoff_employee_name}
                      </span>
                      <span className="text-[11px] text-slate-400 block">
                        Chofer: {activeOrder.audit.courier_name || 'Verificado'}
                      </span>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowHandoffModal(true)}
                      className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-md shadow-blue-500/20 flex items-center gap-2 transition-all active:scale-95"
                    >
                      <Truck className="w-4 h-4" />
                      <span>Entregar al Chofer</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* 3. MODAL DE INGRESO CON PIN DE RONOS */}
      {showPinModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-200">
            <div className="text-center space-y-1">
              <div className="w-12 h-12 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 flex items-center justify-center text-red-600 dark:text-red-400 mx-auto mb-2">
                <User className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Ingreso con PIN de RONOS</h3>
              <p className="text-xs text-slate-500">
                Padrón activo de colaboradores • Tacos Gavilan
              </p>
              <div className="text-[11px] font-bold text-red-600 dark:text-red-400 mt-1">
                Sucursal: {PILOT_STORES.find(s => s.id === selectedStoreId)?.name}
              </div>
            </div>

            {/* Display del PIN */}
            <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 text-center">
              <div className="text-3xl font-mono font-black tracking-widest text-slate-900 dark:text-white min-h-[40px] flex items-center justify-center">
                {pinInput ? '•'.repeat(pinInput.length) : <span className="text-slate-400 text-base">Ingresa PIN</span>}
              </div>
            </div>

            {pinError && (
              <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-300 text-xs text-center font-medium">
                {pinError}
              </div>
            )}

            {/* Numpad Táctil para Tableta */}
            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                <button
                  key={num}
                  type="button"
                  onClick={() => pinInput.length < 6 && setPinInput(prev => prev + num)}
                  className="py-3.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 active:scale-95 text-lg font-bold text-slate-900 dark:text-white transition-all shadow-sm"
                >
                  {num}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPinInput('')}
                className="py-3.5 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-850 dark:hover:bg-slate-800 text-xs font-bold text-slate-500 transition-all border border-slate-200 dark:border-slate-800"
              >
                LIMPIAR
              </button>
              <button
                type="button"
                onClick={() => pinInput.length < 6 && setPinInput(prev => prev + '0')}
                className="py-3.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 active:scale-95 text-lg font-bold text-slate-900 dark:text-white transition-all shadow-sm"
              >
                0
              </button>
              <button
                type="button"
                onClick={() => setPinInput(prev => prev.slice(0, -1))}
                className="py-3.5 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-850 dark:hover:bg-slate-800 text-xs font-bold text-slate-500 transition-all border border-slate-200 dark:border-slate-800"
              >
                BORRAR
              </button>
            </div>

            <button
              onClick={() => handleVerifyPin()}
              disabled={pinLoading || pinInput.length < 3}
              className="w-full py-3.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold text-sm transition-all shadow-md shadow-red-500/20 flex items-center justify-center gap-2 active:scale-95"
            >
              {pinLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <span>Confirmar PIN en RONOS</span>}
            </button>
          </div>
        </div>
      )}

      {/* 4. MODAL DE CUSTODIA Y ENTREGA AL CHOFER (HANDOFF GATE) */}
      {showHandoffModal && activeOrder && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3.5 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/40 flex items-center justify-center text-blue-600 dark:text-blue-400">
                  <Truck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Custodia de Entrega al Chofer</h3>
                  <p className="text-[11px] text-slate-400">
                    Orden #{activeOrder.ticket_number} • {activeOrder.customer_name}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowHandoffModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {handoffSuccessMsg ? (
              <div className="p-6 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/40 text-center space-y-2">
                <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
                <h4 className="text-base font-bold text-emerald-800 dark:text-emerald-300">¡Entrega Blindada!</h4>
                <p className="text-xs text-emerald-700 dark:text-emerald-400">{handoffSuccessMsg}</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200 shadow-sm">
                  <Smartphone className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block text-amber-950 dark:text-amber-100">PROTOCOLO CONTRA ROBO DE ORDEN:</span>
                    Exige al repartidor mostrar la pantalla viva de DoorDash / Uber Eats con el nombre del cliente{' '}
                    <strong className="underline text-red-600 dark:text-red-400">{activeOrder.customer_name}</strong> antes de entregar la bolsa.
                  </div>
                </div>

                <label className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-750 transition-colors">
                  <input
                    type="checkbox"
                    checked={handoffAppConfirmed}
                    onChange={e => setHandoffAppConfirmed(e.target.checked)}
                    className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 mt-0.5"
                  />
                  <span className="text-xs text-slate-700 dark:text-slate-300 font-semibold leading-snug">
                    Confirmo haber visto la pantalla viva del chofer con la orden activa y ruta de navegación de Tacos Gavilan.
                  </span>
                </label>

                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Nombre del Repartidor (opcional):
                  </label>
                  <input
                    type="text"
                    placeholder="Ej. Juan Carlos (DoorDash)"
                    value={handoffCourierName}
                    onChange={e => setHandoffCourierName(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500 focus:bg-white dark:focus:bg-slate-900"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    PIN de RONOS del colaborador que entrega:
                  </label>
                  <input
                    type="password"
                    maxLength={6}
                    placeholder={`PIN actual: ${packer?.pin || '••••'}`}
                    value={handoffPin}
                    onChange={e => setHandoffPin(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white font-mono focus:outline-none focus:border-blue-500 focus:bg-white dark:focus:bg-slate-900"
                  />
                  <span className="text-[10px] text-slate-400 mt-1 block">
                    Si eres {packer?.name || 'el empacador actual'}, déjalo en blanco para usar tu PIN activo.
                  </span>
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowHandoffModal(false)}
                    className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={!handoffAppConfirmed || handoffSubmitting}
                    onClick={handleExecuteHandoff}
                    className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs shadow-md shadow-blue-500/20 flex items-center gap-2 transition-all active:scale-95"
                  >
                    {handoffSubmitting ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <ShieldCheck className="w-4 h-4" />
                        <span>Validar con RONOS y Entregar</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
