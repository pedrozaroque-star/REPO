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

  // Modo de visualización: 'vertical' (predeterminado para tableta en mesa de empaque) o 'split' (2 columnas para PC)
  const [layoutMode, setLayoutMode] = useState<'vertical' | 'split'>('vertical')


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

  // Recuperar sesión de empacador y modo de diseño en montaje
  useEffect(() => {
    try {
      const savedMode = localStorage.getItem('blindaje_layout_mode')
      if (savedMode === 'split' || savedMode === 'vertical') {
        setLayoutMode(savedMode)
      } else {
        setLayoutMode('vertical')
      }
    } catch {
      setLayoutMode('vertical')
    }

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

  const handleToggleLayout = (mode: 'vertical' | 'split') => {
    setLayoutMode(mode)
    try {
      localStorage.setItem('blindaje_layout_mode', mode)
    } catch {}
  }


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

  // Marcar/Desmarcar todos los artículos y condimentos a la vez
  const handleCheckAll = () => {
    if (!activeOrder || !activeOrder.items) return
    const orderGuid = activeOrder.order_guid
    const orderChecks = matchedItems[orderGuid] || {}
    const shouldCheckAll = !matchStats.isComplete

    const updatedMap: Record<string, boolean> = { ...orderChecks }
    activeOrder.items.forEach(item => {
      updatedMap[item.id] = shouldCheckAll
      if (item.modifiers && item.modifiers.length > 0) {
        item.modifiers.forEach((_, mIdx) => {
          updatedMap[`${item.id}_mod_${mIdx}`] = shouldCheckAll
        })
      }
    })

    setMatchedItems(prev => ({
      ...prev,
      [orderGuid]: updatedMap
    }))
  }

  // Renderizador de la sección de orden activa (Adaptado verticalmente con números y letras GRANDES para tableta)
  const renderActiveOrderSection = () => {
    if (!activeOrder) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center p-8 sm:p-12 text-center h-full min-h-[400px]">
          <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-center text-slate-300 dark:text-slate-700 mb-4 shadow-sm">
            <ShoppingBag className="w-10 h-10 sm:w-12 sm:h-12" />
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-800 dark:text-slate-200">
            Selecciona una orden delivery arriba
          </h2>
          <p className="text-sm sm:text-base text-slate-500 max-w-md mt-2 leading-relaxed">
            Toca cualquier tarjeta de pedido en la barra superior para iniciar el cotejo táctil y la toma de doble evidencia.
          </p>
        </div>
      )
    }

    const orderChecks = matchedItems[activeOrder.order_guid] || {}
    const platformBadge = getPlatformBadge(activeOrder.platform)

    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto w-full space-y-6 pb-20">
        {/* TARJETA DE RESUMEN DE LA ORDEN (NÚMEROS Y TEXTO GRANDE) */}
        <div className="p-5 sm:p-7 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-3.5">
              <span className={`text-sm sm:text-base font-black px-3.5 py-1.5 rounded-xl border ${platformBadge.bg}`}>
                {platformBadge.label}
              </span>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black font-mono tracking-tight text-slate-900 dark:text-white">
                #{activeOrder.ticket_number || activeOrder.toast_order_id.slice(-4)}
              </h2>
            </div>
            <div>
              {activeOrder.audit?.status === 'delivered' ? (
                <span className="px-4 py-2 rounded-2xl text-sm sm:text-base font-black bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800/40 flex items-center gap-2">
                  <Truck className="w-5 h-5" />
                  ENTREGADO AL CHOFER
                </span>
              ) : activeOrder.audit?.status === 'sealed' ? (
                <span className="px-4 py-2 rounded-2xl text-sm sm:text-base font-black bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800/40 flex items-center gap-2">
                  <Lock className="w-5 h-5" />
                  BOLSA SELLADA Y BLINDADA
                </span>
              ) : (
                <span className="px-4 py-2 rounded-2xl text-sm sm:text-base font-black bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/40 flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-amber-600" />
                  EN PROCESO DE EMPAQUE
                </span>
              )}
            </div>
          </div>

          {/* DATOS CLAVE DEL CLIENTE Y CANAL */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-1">
            <div>
              <span className="text-xs sm:text-sm text-slate-400 block font-semibold">Cliente:</span>
              <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white block truncate">
                {activeOrder.customer_name || 'Cliente'}
              </span>
            </div>
            <div>
              <span className="text-xs sm:text-sm text-slate-400 block font-semibold">Plataforma / Canal:</span>
              <span className="text-base sm:text-lg font-bold text-slate-700 dark:text-slate-300 block">
                {activeOrder.dining_option_name}
              </span>
            </div>
            <div>
              <span className="text-xs sm:text-sm text-slate-400 block font-semibold">Hora de Entrada:</span>
              <span className="text-base sm:text-lg font-bold font-mono text-slate-700 dark:text-slate-300 block">
                {new Date(activeOrder.opened_at).toLocaleTimeString('es-US', {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: true
                })}
              </span>
            </div>
            <div>
              <span className="text-xs sm:text-sm text-slate-400 block font-semibold">Empacador Activo:</span>
              <span className="text-base sm:text-lg font-black text-red-600 dark:text-red-400 block">
                {packer?.name || 'Sin identificar'}
              </span>
            </div>
          </div>

          {/* ALERTA DE BEBIDA REFRIGERADA */}
          {activeOrder.has_refrigerated_beverages && (
            <div className="p-4 rounded-2xl bg-amber-500 text-white flex items-center gap-3 shadow-md animate-pulse">
              <BadgeAlert className="w-7 h-7 flex-shrink-0" />
              <div>
                <p className="text-base sm:text-lg font-black tracking-wide leading-tight">
                  ¡ATENCIÓN! ESTA ORDEN CONTIENE BEBIDAS EN EL REFRIGERADOR
                </p>
                <p className="text-xs sm:text-sm font-semibold opacity-95">
                  No olvides sacar la bebida del refrigerador antes de sellar la bolsa.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* PASO 1: COTEJO INTERACTIVO DE ARTÍCULOS (MATCH GATE) */}
        <div className="p-5 sm:p-7 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3.5">
              <div
                className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-2xl shadow-sm ${
                  matchStats.isComplete ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
                }`}
              >
                1
              </div>
              <div>
                <h3 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
                  Cotejo de Platillos y Condimentos
                </h3>
                <p className="text-xs sm:text-sm font-medium text-slate-500">
                  Toca con el dedo cada platillo y salsa conforme lo empacas.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span
                className={`text-lg sm:text-xl font-mono font-black px-4 py-2 rounded-2xl border ${
                  matchStats.isComplete
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                    : 'bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700'
                }`}
              >
                {matchStats.checked}/{matchStats.total} ({matchStats.percentage}%)
              </span>
              <button
                onClick={handleCheckAll}
                className="py-2.5 px-5 rounded-2xl bg-slate-900 hover:bg-black dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 text-sm sm:text-base font-black shadow-sm active:scale-95 transition-all"
              >
                {matchStats.isComplete ? 'Desmarcar Todo' : 'COTEJAR TODO'}
              </button>
            </div>
          </div>

          {/* LISTA DE PLATILLOS CON LETRAS GRANDES Y BOTONES DE FÁCIL TOQUE */}
          <div className="space-y-3.5">
            {activeOrder.items.map(item => {
              const itemChecked = !!orderChecks[item.id]

              return (
                <div
                  key={item.id}
                  className={`p-4 sm:p-5 rounded-3xl border-2 transition-all ${
                    itemChecked
                      ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-400 dark:border-emerald-700'
                      : 'bg-white dark:bg-slate-850 border-slate-200 dark:border-slate-800 hover:border-slate-300'
                  }`}
                >
                  {/* Encabezado del Platillo Principal */}
                  <div
                    onClick={() => toggleItemAndModifiers(item)}
                    className="flex items-center justify-between gap-4 cursor-pointer"
                  >
                    <div className="flex items-center gap-4">
                      {/* Checkbox táctil grande */}
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation()
                          toggleItemAndModifiers(item)
                        }}
                        className={`w-11 h-11 sm:w-12 sm:h-12 rounded-2xl flex items-center justify-center transition-all shadow-sm flex-shrink-0 ${
                          itemChecked
                            ? 'bg-emerald-600 text-white shadow-emerald-500/25 ring-2 ring-emerald-500/30'
                            : 'bg-slate-100 dark:bg-slate-800 border-2 border-slate-300 dark:border-slate-600 text-transparent'
                        }`}
                      >
                        <Check className="w-7 h-7 stroke-[3]" />
                      </button>

                      <div className="flex items-baseline gap-3">
                        <span className="text-3xl sm:text-4xl font-black font-mono text-red-600 dark:text-red-400">
                          {item.quantity}x
                        </span>
                        <div>
                          <h4
                            className={`text-xl sm:text-2xl font-black ${
                              itemChecked
                                ? 'line-through text-slate-500 dark:text-slate-400'
                                : 'text-slate-900 dark:text-white'
                            }`}
                          >
                            {item.name}
                          </h4>
                          {item.is_refrigerated_beverage && (
                            <span className="inline-block mt-1 text-xs sm:text-sm font-black text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/50 px-2.5 py-0.5 rounded-lg border border-amber-300 dark:border-amber-800">
                              🧊 BEBIDA EN REFRIGERADOR
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Instrucciones especiales */}
                  {item.instructions && (
                    <div className="mt-3 p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-sm sm:text-base font-bold text-amber-900 dark:text-amber-200">
                      Nota especial: {item.instructions}
                    </div>
                  )}

                  {/* Condimentos / Modificadores (Salsas, Cebolla, Cilantro, etc.) */}
                  {item.modifiers && item.modifiers.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
                      <p className="text-xs sm:text-sm font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
                        Condimentos y Modificadores (Toca para confirmar):
                      </p>
                      <div className="flex flex-wrap gap-2.5">
                        {item.modifiers.map((mod, mIdx) => {
                          const modKey = `${item.id}_mod_${mIdx}`
                          const modChecked = !!orderChecks[modKey]

                          return (
                            <button
                              key={modKey}
                              type="button"
                              onClick={() => toggleItemMatch(modKey)}
                              className={`py-3 px-4 sm:px-5 rounded-2xl text-base sm:text-lg font-bold border-2 transition-all flex items-center gap-2.5 active:scale-95 shadow-sm ${
                                modChecked
                                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-emerald-500/20'
                                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-slate-300'
                              }`}
                            >
                              <div
                                className={`w-5 h-5 rounded-md flex items-center justify-center border-2 ${
                                  modChecked ? 'bg-white border-white text-emerald-600' : 'border-slate-300 dark:border-slate-600'
                                }`}
                              >
                                {modChecked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                              </div>
                              <span>
                                {mod.quantity > 1 ? `${mod.quantity}x ` : ''}
                                {mod.name}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* PASO 2: PROTOCOLO DE DOBLE FOTO DE EVIDENCIA */}
        <div
          className={`p-5 sm:p-7 rounded-3xl border transition-all ${
            matchStats.isComplete
              ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm'
              : 'bg-slate-100/60 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800 opacity-70'
          }`}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3.5">
              <div
                className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-2xl ${
                  matchStats.isComplete ? 'bg-red-600 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                }`}
              >
                2
              </div>
              <div>
                <h3 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
                  Protocolo de Doble Foto de Evidencia
                  {!matchStats.isComplete && (
                    <span className="text-xs font-black px-2.5 py-1 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 flex items-center gap-1">
                      <Lock className="w-3.5 h-3.5" /> BLOQUEADO
                    </span>
                  )}
                </h3>
                <p className="text-xs sm:text-sm font-medium text-slate-500">
                  Ambas fotografías son obligatorias para desmentir quejas falsas y proteger contra contracargos.
                </p>
              </div>
            </div>
          </div>

          {!matchStats.isComplete ? (
            <div className="p-8 rounded-3xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-700 text-center py-10 space-y-2">
              <Lock className="w-10 h-10 mx-auto text-slate-400" />
              <p className="text-base sm:text-lg font-black text-slate-800 dark:text-slate-200">
                Match Gate Incompleto ({matchStats.percentage}%)
              </p>
              <p className="text-sm font-medium text-slate-500 max-w-md mx-auto">
                Coteja el 100% de los artículos y condimentos en el Paso 1 para desbloquear la cámara de fotos.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* FOTO 1: CONTENIDO ABIERTO + TICKET */}
              <div className="p-5 rounded-3xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-700 flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <h4 className="text-base sm:text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                      <Camera className="w-5 h-5 text-red-600" />
                      Foto 1: Contenido Abierto + Ticket
                    </h4>
                    {photo1Url && (
                      <span className="text-xs font-black px-3 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300">
                        GUARDADA ✓
                      </span>
                    )}
                  </div>
                  <p className="text-xs sm:text-sm font-medium text-slate-500">
                    Destapa los recipientes y pon el ticket al lado para desmentir quejas de comida faltante.
                  </p>
                </div>

                <div className="mt-2">
                  {photo1Url ? (
                    <div className="relative rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 shadow-sm aspect-video bg-black/5">
                      <img src={photo1Url} alt="Contenido Abierto" className="w-full h-full object-cover" />
                      <label className="absolute bottom-3 right-3 px-4 py-2 rounded-xl bg-black/75 hover:bg-black text-white text-xs sm:text-sm font-bold cursor-pointer transition-colors shadow-lg backdrop-blur-sm">
                        Cambiar Foto 1
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="hidden"
                          disabled={photo1Uploading}
                          onChange={e => handlePhotoUpload(e, 'photo1_open')}
                        />
                      </label>
                    </div>
                  ) : (
                    <label className="flex flex-col items-center justify-center py-10 sm:py-12 border-3 border-dashed border-red-300 dark:border-red-900/60 rounded-3xl cursor-pointer hover:bg-red-50/50 dark:hover:bg-red-950/20 transition-all bg-white dark:bg-slate-900 shadow-sm group">
                      <Camera className="w-12 h-12 text-red-600 dark:text-red-400 group-hover:scale-110 transition-transform mb-2" />
                      <span className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
                        {photo1Uploading ? 'Subiendo Fotografía...' : 'Tomar Foto 1 (Contenido)'}
                      </span>
                      <span className="text-xs sm:text-sm font-semibold text-slate-400 mt-1">
                        Toca para activar cámara de la tableta
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

              {/* FOTO 2: BOLSA SELLADA CON TICKET VISIBLE */}
              <div className="p-5 rounded-3xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-700 flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <h4 className="text-base sm:text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                      <Camera className="w-5 h-5 text-purple-600" />
                      Foto 2: Bolsa Sellada + Ticket
                    </h4>
                    {photo2Url && (
                      <span className="text-xs font-black px-3 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300">
                        GUARDADA ✓
                      </span>
                    )}
                  </div>
                  <p className="text-xs sm:text-sm font-medium text-slate-500">
                    Sella la bolsa con grapas o sticker de seguridad y enfoca el ticket exterior.
                  </p>
                </div>

                <div className="mt-2">
                  {photo2Url ? (
                    <div className="relative rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 shadow-sm aspect-video bg-black/5">
                      <img src={photo2Url} alt="Bolsa Sellada" className="w-full h-full object-cover" />
                      <label className="absolute bottom-3 right-3 px-4 py-2 rounded-xl bg-black/75 hover:bg-black text-white text-xs sm:text-sm font-bold cursor-pointer transition-colors shadow-lg backdrop-blur-sm">
                        Cambiar Foto 2
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="hidden"
                          disabled={photo2Uploading}
                          onChange={e => handlePhotoUpload(e, 'photo2_sealed')}
                        />
                      </label>
                    </div>
                  ) : (
                    <label className="flex flex-col items-center justify-center py-10 sm:py-12 border-3 border-dashed border-purple-300 dark:border-purple-900/60 rounded-3xl cursor-pointer hover:bg-purple-50/50 dark:hover:bg-purple-950/20 transition-all bg-white dark:bg-slate-900 shadow-sm group">
                      <Camera className="w-12 h-12 text-purple-600 dark:text-purple-400 group-hover:scale-110 transition-transform mb-2" />
                      <span className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
                        {photo2Uploading ? 'Subiendo Fotografía...' : 'Tomar Foto 2 (Bolsa Sellada)'}
                      </span>
                      <span className="text-xs sm:text-sm font-semibold text-slate-400 mt-1">
                        Toca para activar cámara de la tableta
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

          {/* BOTÓN DE SELLAR Y GUARDAR AUDITORÍA */}
          {matchStats.isComplete && photo1Url && photo2Url && (
            <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-end">
              <button
                onClick={handleSaveSealedAudit}
                className="w-full sm:w-auto px-8 py-4 sm:py-5 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-black text-lg sm:text-xl shadow-xl shadow-red-500/25 flex items-center justify-center gap-3 transition-all active:scale-95"
              >
                <ShieldCheck className="w-6 h-6" />
                <span>Guardar Doble Evidencia y Sellar Orden</span>
              </button>
            </div>
          )}
        </div>

        {/* PASO 3: CUSTODIA Y ENTREGA AL CHOFER (HANDOFF GATE) */}
        <div className="p-5 sm:p-7 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center font-black text-2xl shadow-sm">
                3
              </div>
              <div>
                <h3 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
                  Custodia y Entrega al Repartidor (Handoff Gate)
                </h3>
                <p className="text-xs sm:text-sm font-medium text-slate-500">
                  Exige ver la aplicación viva en el teléfono del chofer antes de entregar la bolsa.
                </p>
              </div>
            </div>

            {activeOrder.audit?.status === 'delivered' ? (
              <div className="text-right">
                <span className="text-base sm:text-lg font-black text-blue-600 dark:text-blue-400 flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5" /> Entregada por {activeOrder.audit.handoff_employee_name}
                </span>
                <span className="text-xs sm:text-sm font-semibold text-slate-400 block mt-0.5">
                  Chofer: {activeOrder.audit.courier_name || 'Verificado'}
                </span>
              </div>
            ) : (
              <button
                onClick={() => setShowHandoffModal(true)}
                className="w-full sm:w-auto px-7 py-4 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-black text-base sm:text-lg shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2.5 transition-all active:scale-95"
              >
                <Truck className="w-5 h-5" />
                <span>Entregar al Chofer</span>
              </button>
            )}
          </div>
        </div>
      </div>
    )
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
              className={`px-3.5 py-2 rounded-lg text-xs sm:text-sm font-bold transition-all ${
                selectedStoreId === store.id
                  ? 'bg-red-600 text-white shadow-md'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {store.name}
            </button>
          ))}
        </div>

        {/* Selector de Modo: Tableta Vertical vs 2 Columnas */}
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1.5 rounded-xl border border-slate-200 dark:border-slate-700">
          <button
            onClick={() => handleToggleLayout('vertical')}
            className={`px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-bold flex items-center gap-1.5 transition-all ${
              layoutMode === 'vertical'
                ? 'bg-red-600 text-white shadow-md'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
            title="Modo Tableta Vertical (Diseño optimizado de arriba a abajo con letras grandes)"
          >
            <Smartphone className="w-4 h-4" />
            <span>Tableta Vertical</span>
          </button>
          <button
            onClick={() => handleToggleLayout('split')}
            className={`px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-bold flex items-center gap-1.5 transition-all ${
              layoutMode === 'split'
                ? 'bg-red-600 text-white shadow-md'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
            title="Modo 2 Columnas (Lista lateral y mesa)"
          >
            <StoreIcon className="w-4 h-4" />
            <span>2 Columnas</span>
          </button>
        </div>

        {/* Acceso a Bóveda de Disputas & Colaborador Logueado en RONOS */}
        <div className="flex items-center gap-3">
          <Link
            href="/admin/blindaje-delivery"
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors shadow-sm"
          >
            <FileText className="w-4 h-4 text-red-600 dark:text-red-400" />
            <span>Bóveda de Disputas</span>
          </Link>

          {packer ? (
            <div className="flex items-center gap-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800/40 px-3.5 py-2 rounded-xl shadow-sm">
              <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
              <div className="text-left">
                <p className="text-xs sm:text-sm font-black text-emerald-800 dark:text-emerald-300 leading-tight">{packer.name}</p>
                <p className="text-[11px] sm:text-xs text-emerald-600 dark:text-emerald-400 font-mono font-bold leading-tight">PIN RONOS: {packer.pin}</p>
              </div>
              <button
                onClick={handleLogout}
                title="Cambiar turno / Salir"
                className="ml-1 text-slate-400 hover:text-red-600 transition-colors p-1"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowPinModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-black text-xs sm:text-sm shadow-md shadow-red-500/25 transition-all active:scale-95"
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

      {/* 2. CONTENIDO PRINCIPAL SEGÚN MODO DE VISUALIZACIÓN */}
      {layoutMode === 'vertical' ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* A. CARRUSEL SUPERIOR HORIZONTAL DE ÓRDENES DELIVERY EN TABLETA */}
          <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-3 sm:p-4 shadow-sm flex-shrink-0">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-2.5">
              <div className="flex items-center gap-3">
                <span className="text-xs sm:text-sm font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-red-600 dark:text-red-400" />
                  Órdenes Delivery ({filteredOrders.length}):
                </span>

                {/* Buscador táctil */}
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Buscar ticket, cliente..."
                    className="pl-9 pr-7 py-1.5 rounded-xl text-xs sm:text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 w-44 sm:w-56 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500/20"
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-white">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Filtros de Plataforma Rápidos */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                {(['ALL', 'UBER_EATS', 'DOORDASH', 'GRUBHUB', 'TOAST_ONLINE'] as const).map(plat => (
                  <button
                    key={plat}
                    onClick={() => setPlatformFilter(plat)}
                    className={`px-3 py-1.5 rounded-xl text-xs sm:text-sm font-bold whitespace-nowrap transition-all ${
                      platformFilter === plat
                        ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-sm'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                    }`}
                  >
                    {plat === 'ALL' ? `Todas (${orders.length})` : plat === 'UBER_EATS' ? 'Uber Eats' : plat === 'DOORDASH' ? 'DoorDash' : plat === 'GRUBHUB' ? 'Grubhub' : 'Toast'}
                  </button>
                ))}
              </div>
            </div>

            {/* Carrusel Horizontal de Tarjetas de Órdenes */}
            <div className="flex items-center gap-3 overflow-x-auto pb-1 scrollbar-thin">
              {filteredOrders.length === 0 ? (
                <div className="py-2 text-xs sm:text-sm text-slate-400 font-medium italic">
                  No hay órdenes de delivery que coincidan con el filtro actual.
                </div>
              ) : (
                filteredOrders.map(order => {
                  const badge = getPlatformBadge(order.platform)
                  const isSelected = selectedOrderGuid === order.order_guid
                  const isSealed = order.audit?.status === 'sealed'
                  const isDelivered = order.audit?.status === 'delivered'

                  return (
                    <button
                      key={order.order_guid}
                      onClick={() => setSelectedOrderGuid(order.order_guid)}
                      className={`flex-shrink-0 p-3 sm:p-3.5 rounded-2xl border text-left transition-all min-w-[210px] max-w-[260px] relative overflow-hidden active:scale-95 ${
                        isSelected
                          ? 'bg-red-50/70 dark:bg-red-950/40 border-red-500 shadow-md ring-2 ring-red-500/30'
                          : isDelivered
                          ? 'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800 opacity-60'
                          : 'bg-white dark:bg-slate-850 border-slate-200 dark:border-slate-800 hover:border-slate-300 shadow-sm'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5 mb-1.5">
                        <span className={`text-[11px] sm:text-xs font-black px-2 py-0.5 rounded-md border ${badge.bg}`}>
                          {badge.label}
                        </span>
                        <span className="text-sm sm:text-base font-black font-mono text-slate-900 dark:text-white">
                          #{order.ticket_number || order.toast_order_id.slice(-4)}
                        </span>
                      </div>
                      <p className="text-sm sm:text-base font-black text-slate-900 dark:text-white truncate">
                        {order.customer_name || 'Cliente'}
                      </p>
                      <div className="flex items-center justify-between text-xs sm:text-sm text-slate-500 mt-1 font-semibold">
                        <span>{order.total_items_count} artículos</span>
                        <span className="font-mono text-slate-400">
                          {new Date(order.opened_at).toLocaleTimeString('es-US', { hour: '2-digit', minute: '2-digit', hour12: true })}
                        </span>
                      </div>
                      {order.has_refrigerated_beverages && (
                        <div className="mt-1 text-[11px] font-black text-amber-700 dark:text-amber-300 flex items-center gap-1">
                          <BadgeAlert className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
                          <span>¡BEBIDA EN REFRI!</span>
                        </div>
                      )}
                      {isDelivered ? (
                        <div className="mt-1 text-[11px] font-black text-blue-600 dark:text-blue-400">
                          Entregado ✓
                        </div>
                      ) : isSealed ? (
                        <div className="mt-1 text-[11px] font-black text-purple-600 dark:text-purple-400">
                          Sellado y Blindado ✓
                        </div>
                      ) : null}
                    </button>
                  )
                })
              )}
            </div>
          </div>

          {/* B. MESA DE EMPAQUE VERTICAL (100% ANCHO, FÁCIL LECTURA EN TABLETA) */}
          <main className="flex-1 bg-slate-50/70 dark:bg-slate-950 overflow-y-auto">
            {renderActiveOrderSection()}
          </main>
        </div>
      ) : (
        /* MODO 2 COLUMNAS (DESKTOP) */
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
          <aside className="lg:col-span-4 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col h-full overflow-hidden shadow-sm">
            <div className="p-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-850">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-red-600 dark:text-red-400" />
                <h2 className="text-xs sm:text-sm font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Órdenes de Delivery
                </h2>
              </div>
              <span className="text-xs sm:text-sm font-bold px-2.5 py-0.5 rounded-full bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900/40 shadow-sm">
                {filteredOrders.length} {filteredOrders.length !== orders.length ? `de ${orders.length}` : 'activas'}
              </span>
            </div>

            {/* Buscador táctil y filtros rápidos */}
            <div className="p-2.5 border-b border-slate-200 dark:border-slate-800 space-y-2 bg-white dark:bg-slate-900">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Buscar por ticket #, cliente..."
                  className="w-full pl-9 pr-8 py-2 rounded-xl text-xs sm:text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
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
                {(['ALL', 'UBER_EATS', 'DOORDASH', 'GRUBHUB', 'TOAST_ONLINE'] as const).map(plat => (
                  <button
                    key={plat}
                    onClick={() => setPlatformFilter(plat)}
                    className={`px-2.5 py-1 rounded-lg text-xs sm:text-sm font-bold transition-all whitespace-nowrap ${
                      platformFilter === plat
                        ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-sm'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                    }`}
                  >
                    {plat === 'ALL' ? `Todas (${orders.length})` : plat === 'UBER_EATS' ? 'Uber Eats' : plat === 'DOORDASH' ? 'DoorDash' : plat === 'GRUBHUB' ? 'Grubhub' : 'Toast'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5">
              {filteredOrders.length === 0 && !loadingOrders && (
                <div className="text-center py-16 px-4">
                  <ShoppingBag className="w-12 h-12 mx-auto text-slate-300 dark:text-slate-700 mb-3" />
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                    {orders.length === 0 ? 'Sin órdenes de entrega pendientes' : 'No coinciden órdenes con el filtro'}
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
                        : 'bg-white dark:bg-slate-850 border-slate-200 dark:border-slate-800 hover:border-slate-300 shadow-sm'
                    }`}
                  >
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
                        <span className={`text-xs font-black px-2 py-0.5 rounded-md border ${badge.bg}`}>
                          {badge.label}
                        </span>
                        <span className="text-sm font-mono font-black text-slate-900 dark:text-white">
                          #{order.ticket_number || order.toast_order_id.slice(-4)}
                        </span>
                      </div>

                      <div className="flex items-baseline justify-between gap-2">
                        <h3 className="text-sm sm:text-base font-black text-slate-900 dark:text-white truncate">
                          {order.customer_name || 'Cliente sin nombre'}
                        </h3>
                        <span className="text-xs text-slate-400 flex items-center gap-1 font-mono font-semibold">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          {new Date(order.opened_at).toLocaleTimeString('es-US', {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: true
                          })}
                        </span>
                      </div>

                      <div className="mt-2 flex items-center justify-between text-xs sm:text-sm text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800">
                        <span>{order.dining_option_name}</span>
                        <span className="font-bold text-slate-700 dark:text-slate-300">
                          {order.total_items_count} artículos
                        </span>
                      </div>

                      {order.has_refrigerated_beverages && (
                        <div className="mt-2 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/40 text-xs font-black text-amber-800 dark:text-amber-300">
                          <BadgeAlert className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
                          <span>¡BEBIDA EN REFRIGERADOR!</span>
                        </div>
                      )}

                      {isDelivered ? (
                        <div className="mt-2 flex items-center gap-1.5 text-xs font-black text-blue-600 dark:text-blue-400">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Entregado a chofer ({order.audit?.courier_name || 'Repartidor'})</span>
                        </div>
                      ) : isSealed ? (
                        <div className="mt-2 flex items-center gap-1.5 text-xs font-black text-purple-600 dark:text-purple-400">
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

          <main className="lg:col-span-8 bg-slate-50/70 dark:bg-slate-950 flex flex-col h-full overflow-y-auto">
            {renderActiveOrderSection()}
          </main>
        </div>
      )}

      {/* 3. MODAL DE INGRESO CON PIN DE RONOS (CALIBRADO PARA TABLETA) */}
      {showPinModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-9 max-w-lg w-full shadow-2xl space-y-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="text-center space-y-2">
              <div className="w-16 h-16 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 flex items-center justify-center text-red-600 dark:text-red-400 mx-auto shadow-sm">
                <User className="w-8 h-8" />
              </div>
              <h3 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white">Ingreso con PIN de RONOS</h3>
              <p className="text-sm sm:text-base font-medium text-slate-500">
                Padrón activo de colaboradores • Tacos Gavilan
              </p>
              <div className="inline-block text-xs sm:text-sm font-black uppercase tracking-wider px-4 py-1 rounded-full bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800/50 mt-1">
                Sucursal: {PILOT_STORES.find(s => s.id === selectedStoreId)?.name}
              </div>
            </div>

            {/* Display del PIN en tamaño GIGANTE */}
            <div className="bg-slate-100 dark:bg-slate-950 border-2 border-slate-300 dark:border-slate-700 rounded-3xl p-4 sm:p-5 text-center shadow-inner">
              <div className="text-5xl sm:text-6xl font-mono font-black tracking-[0.4em] text-slate-900 dark:text-white min-h-[64px] flex items-center justify-center">
                {pinInput ? '•'.repeat(pinInput.length) : <span className="text-slate-400 text-xl sm:text-2xl font-normal">Ingresa PIN</span>}
              </div>
            </div>

            {pinError && (
              <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-300 text-sm sm:text-base text-center font-bold">
                {pinError}
              </div>
            )}

            {/* Numpad Táctil GIGANTE para Tableta */}
            <div className="grid grid-cols-3 gap-3 sm:gap-4">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                <button
                  key={num}
                  type="button"
                  onClick={() => pinInput.length < 6 && setPinInput(prev => prev + num)}
                  className="h-20 sm:h-24 rounded-3xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 active:scale-95 text-4xl sm:text-5xl font-black text-slate-900 dark:text-white transition-all shadow-sm border border-slate-200/80 dark:border-slate-700 flex items-center justify-center"
                >
                  {num}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPinInput('')}
                className="h-20 sm:h-24 rounded-3xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-850 dark:hover:bg-slate-800 text-sm sm:text-base font-black text-slate-600 dark:text-slate-300 transition-all border border-slate-200 dark:border-slate-800 active:scale-95 flex items-center justify-center"
              >
                LIMPIAR
              </button>
              <button
                type="button"
                onClick={() => pinInput.length < 6 && setPinInput(prev => prev + '0')}
                className="h-20 sm:h-24 rounded-3xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 active:scale-95 text-4xl sm:text-5xl font-black text-slate-900 dark:text-white transition-all shadow-sm border border-slate-200/80 dark:border-slate-700 flex items-center justify-center"
              >
                0
              </button>
              <button
                type="button"
                onClick={() => setPinInput(prev => prev.slice(0, -1))}
                className="h-20 sm:h-24 rounded-3xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-850 dark:hover:bg-slate-800 text-sm sm:text-base font-black text-slate-600 dark:text-slate-300 transition-all border border-slate-200 dark:border-slate-800 active:scale-95 flex items-center justify-center"
              >
                BORRAR
              </button>
            </div>

            <button
              onClick={() => handleVerifyPin()}
              disabled={pinLoading || pinInput.length < 3}
              className="w-full py-5 rounded-3xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-black text-lg sm:text-2xl transition-all shadow-xl shadow-red-500/25 flex items-center justify-center gap-2 active:scale-95"
            >
              {pinLoading ? <RefreshCw className="w-7 h-7 animate-spin" /> : <span>Confirmar PIN en RONOS</span>}
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
