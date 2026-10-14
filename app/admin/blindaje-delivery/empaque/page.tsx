/**
 * @module BlindajeDeliveryEmpaque
 * @description Estación vertical de Entrega Blindada para validar el empaque y liberar cada bolsa al chofer correcto por la Clave Única de la Orden.
 * @businessRules
 *   - Acceso con PIN de 4 dígitos de RONOS con cierre automático de sesión cada 10 minutos.
 *   - Nunca se busca ni se entrega por nombre del cliente; la llave única es la Clave Oficial de cada plataforma (Uber Eats: UBERxxxxx, DoorDash: DD xxxxxxxx + QR, Grubhub: GH #..., Toast: #Ticket).
 *   - Mide automáticamente el tiempo de preparación en cocina desde que llega al KDS hasta que el cocinero borra la orden (READY).
 *   - Flujo directo sin ruido visual: solo terminar de empacar y blindar la entrega.
 * @dataFlow Toast -> /api/delivery-armor/orders -> tableta vertical -> /api/delivery-armor/audit -> Supabase.
 * @notes Piloto Slauson (#7) y LA Central (#6).
 */

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  FileText,
  Lock,
  LogOut,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  Truck,
  User
} from 'lucide-react'

const STORES = [
  { id: 7, name: 'Slauson (#7)' },
  { id: 6, name: 'LA Central (#6)' }
]

const PIN_SESSION_DURATION_MS = 10 * 60 * 1000 // 10 minutos

type Platform = 'DOORDASH' | 'UBER_EATS' | 'GRUBHUB' | 'TOAST_ONLINE' | 'OTHER'
type CheckKey = 'foodComplete' | 'drinksComplete' | 'bagCountCorrect' | 'bagSealed'
type Checks = Record<CheckKey, boolean>

const COMPLETED_CHECKS: Checks = {
  foodComplete: true,
  drinksComplete: true,
  bagCountCorrect: true,
  bagSealed: true
}

interface Packer {
  pin: string
  name: string
  title: string
  id: number
  storeId: number
  expiresAt: number
}

interface Item {
  id: string
  name: string
  quantity: number
  price: number
  modifiers: string[]
  isDrink: boolean
}

interface Order {
  guid: string
  ticket: string
  diningOption: string
  platform: Platform
  customer: string
  maskedCustomer: string
  platformOrderKey: string
  shortOrderKey: string
  assignedDriverHint?: string | null
  openedAt: string
  kdsStatus: 'IN_KITCHEN' | 'READY'
  kdsSentAt: string
  kdsReadyAt: string | null
  kdsPrepSeconds: number | null
  isVoided?: boolean
  items: Item[]
  itemCount: number
  hasDrinks: boolean
  audit?: {
    status: 'pending' | 'ready' | 'released'
    bags?: number
    sealedPhoto?: string
    handedBy?: string
    driver?: string
    courierReference?: string
  }
}

const label = (platform: Platform) =>
  platform === 'DOORDASH'
    ? 'DoorDash'
    : platform === 'UBER_EATS'
    ? 'Uber Eats'
    : platform === 'GRUBHUB'
    ? 'Grubhub'
    : platform === 'TOAST_ONLINE'
    ? 'Toast Delivery'
    : 'Delivery'

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '--'
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  if (mins === 0) return `${secs}s`
  return `${mins}m ${String(secs).padStart(2, '0')}s`
}

function formatRemainingMs(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function BlindajeDeliveryEmpaquePage() {
  const [storeId, setStoreId] = useState(7)
  const [packer, setPacker] = useState<Packer | null>(null)
  const [remainingMs, setRemainingMs] = useState<number>(PIN_SESSION_DURATION_MS)
  const [pin, setPin] = useState('')
  const [orders, setOrders] = useState<Order[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [bags, setBags] = useState<Record<string, number>>({})
  const [photos, setPhotos] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const logout = useCallback((expiredNotice?: string) => {
    ;[
      'blindaje_packer_pin',
      'blindaje_packer_name',
      'blindaje_packer_title',
      'blindaje_packer_user_id',
      'blindaje_packer_store',
      'blindaje_packer_expires_at'
    ].forEach(key => sessionStorage.removeItem(key))
    setPacker(null)
    setPin('')
    if (expiredNotice) {
      setError(expiredNotice)
    }
  }, [])

  // Restaurar sesión si sigue dentro de los 10 minutos
  useEffect(() => {
    try {
      const savedStore = Number(sessionStorage.getItem('blindaje_packer_store'))
      const savedPin = sessionStorage.getItem('blindaje_packer_pin') || ''
      const name = sessionStorage.getItem('blindaje_packer_name') || ''
      const id = Number(sessionStorage.getItem('blindaje_packer_user_id'))
      const expiresAt = Number(sessionStorage.getItem('blindaje_packer_expires_at'))
      if (
        savedStore === storeId &&
        /^\d{4}$/.test(savedPin) &&
        name &&
        id &&
        Number.isFinite(expiresAt) &&
        expiresAt > Date.now()
      ) {
        setPacker({
          pin: savedPin,
          name,
          title: sessionStorage.getItem('blindaje_packer_title') || 'Colaborador',
          id,
          storeId,
          expiresAt
        })
        setRemainingMs(expiresAt - Date.now())
      } else {
        logout()
      }
    } catch {
      setPacker(null)
    }
  }, [storeId, logout])

  // Reloj de cierre automático de sesión de PIN cada 10 minutos
  useEffect(() => {
    if (!packer) return
    const checkExpiry = () => {
      const left = packer.expiresAt - Date.now()
      if (left <= 0) {
        logout('La sesión del PIN se cerró automáticamente tras 10 minutos.')
      } else {
        setRemainingMs(left)
      }
    }
    checkExpiry()
    const interval = window.setInterval(checkExpiry, 1000)
    return () => window.clearInterval(interval)
  }, [packer, logout])

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/delivery-armor/orders?storeId=${storeId}`, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.error || 'No se pudieron cargar las órdenes.')
      const next: Order[] = (data.orders || []).map((raw: any) => ({
        guid: raw.orderGuid,
        ticket: raw.displayNumber,
        diningOption: raw.diningOptionName,
        platform: raw.platform,
        customer: raw.customerName,
        maskedCustomer: raw.maskedCustomerName || 'C•••',
        platformOrderKey: raw.platformOrderKey || `#${raw.displayNumber}`,
        shortOrderKey: raw.shortOrderKey || `#${raw.displayNumber}`,
        assignedDriverHint: raw.assignedDriverHint || null,
        openedAt: raw.openedDate,
        kdsStatus: raw.kdsStatus || 'READY',
        kdsSentAt: raw.kdsSentAt || raw.openedDate,
        kdsReadyAt: raw.kdsReadyAt || null,
        kdsPrepSeconds: raw.kdsPrepSeconds ?? null,
        isVoided: !!raw.isVoided,
        itemCount: raw.totalItemsCount,
        hasDrinks: raw.items?.some((item: any) => item.isHighRiskDrink) || false,
        items: (raw.items || []).map((item: any) => ({
          id: item.id,
          name: item.displayName,
          quantity: item.quantity,
          price: Number(item.price || 0),
          modifiers: item.modifiers || [],
          isDrink: item.isHighRiskDrink
        })),
        audit: raw.audit
          ? {
              status:
                raw.audit.status === 'DELIVERED'
                  ? 'released'
                  : raw.audit.status === 'PACKED_AND_SEALED'
                  ? 'ready'
                  : 'pending',
              bags: raw.audit.confirmedBagCount,
              sealedPhoto: raw.audit.photoSealedUrl,
              handedBy: raw.audit.handedByName,
              driver: raw.audit.driverName,
              courierReference: raw.audit.courierOrderReference
            }
          : undefined
      }))
      setOrders(next)
      setSelected(current => {
        if (current && next.some(o => o.guid === current)) return current
        const firstActive = next.find(o => o.audit?.status !== 'released')
        return firstActive?.guid || next[0]?.guid || null
      })
    } catch (caught: any) {
      setError(caught.message)
    } finally {
      setLoading(false)
    }
  }, [storeId])

  useEffect(() => {
    if (!packer) return
    void fetchOrders()
    const timer = window.setInterval(fetchOrders, 20000)
    return () => window.clearInterval(timer)
  }, [packer, fetchOrders])

  const order = useMemo(() => orders.find(value => value.guid === selected) || null, [orders, selected])
  const bagCount = order ? bags[order.guid] || order.audit?.bags || 1 : 1
  const sealedPhoto = order ? photos[order.guid] || order.audit?.sealedPhoto || '' : ''

  const riskReasons = useMemo(
    () =>
      order
        ? [
            order.hasDrinks ? 'con bebidas' : '',
            order.itemCount >= 8 ? '8+ artículos' : '',
            bagCount > 1 ? 'múltiples bolsas' : ''
          ].filter(Boolean)
        : [],
    [order, bagCount]
  )
  const risk = riskReasons.length > 0

  // Bloqueo de búsqueda por nombre del cliente: solo permite buscar por Clave Única o #Ticket
  const blockedByName = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return false
    const matchesKey = orders.some(o =>
      `${o.platformOrderKey} ${o.shortOrderKey} #${o.ticket} ${o.ticket} ${label(o.platform)}`
        .toLowerCase()
        .includes(q)
    )
    if (matchesKey) return false
    const matchesCustomer = orders.some(o => {
      const firstWord = o.customer.split(/\s+/)[0]?.toLowerCase() || ''
      return firstWord.length >= 2 && (o.customer.toLowerCase().includes(q) || firstWord.includes(q))
    })
    return matchesCustomer || /^[a-zA-ZáéíóúñÁÉÍÓÚÑ\s]{3,}$/.test(q)
  }, [orders, search])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return orders
    if (blockedByName) return []
    return orders.filter(value =>
      `${value.platformOrderKey} ${value.shortOrderKey} #${value.ticket} ${value.ticket} ${label(value.platform)}`
        .toLowerCase()
        .includes(q)
    )
  }, [orders, search, blockedByName])

  async function login(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/delivery-armor/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, pin })
      })
      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.error || 'PIN no válido.')
      const expiresAt = Date.now() + PIN_SESSION_DURATION_MS
      const next: Packer = {
        pin,
        name: data.employee.fullName,
        title: data.employee.jobTitle,
        id: data.employee.id,
        storeId,
        expiresAt
      }
      setPacker(next)
      setRemainingMs(PIN_SESSION_DURATION_MS)
      sessionStorage.setItem('blindaje_packer_pin', pin)
      sessionStorage.setItem('blindaje_packer_name', next.name)
      sessionStorage.setItem('blindaje_packer_title', next.title)
      sessionStorage.setItem('blindaje_packer_user_id', String(next.id))
      sessionStorage.setItem('blindaje_packer_store', String(storeId))
      sessionStorage.setItem('blindaje_packer_expires_at', String(expiresAt))
      setPin('')
    } catch (caught: any) {
      setError(caught.message)
    } finally {
      setBusy(false)
    }
  }

  async function savePackingRecord(targetOrder: Order, photoUrlOverride?: string) {
    if (!packer) return
    const currentBags = bags[targetOrder.guid] || targetOrder.audit?.bags || 1
    const currentPhoto = photoUrlOverride ?? photos[targetOrder.guid] ?? targetOrder.audit?.sealedPhoto ?? ''
    const currentReasons = [
      targetOrder.hasDrinks ? 'con bebidas' : '',
      targetOrder.itemCount >= 8 ? '8+ artículos' : '',
      currentBags > 1 ? 'múltiples bolsas' : ''
    ].filter(Boolean)
    const isHighRisk = currentReasons.length > 0

    const response = await fetch('/api/delivery-armor/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        store_id: storeId,
        order_guid: targetOrder.guid,
        ticket_number: targetOrder.ticket,
        platform: targetOrder.platform,
        dining_option_name: targetOrder.diningOption,
        customer_name: targetOrder.customer,
        opened_at: targetOrder.openedAt,
        items_ordered: targetOrder.items.map(i => ({
          id: i.id,
          displayName: i.name,
          quantity: i.quantity,
          price: i.price,
          modifiers: i.modifiers,
          isHighRiskDrink: i.isDrink
        })),
        matchedItems: ['CONTROL:foodComplete', 'CONTROL:drinksComplete', 'CONTROL:bagCountCorrect', 'CONTROL:bagSealed'],
        matchCompleted: true,
        photo_sealed_bag_url: currentPhoto || null,
        packer_pin: packer.pin,
        quick_checks: {
          ...COMPLETED_CHECKS,
          platformOrderKey: targetOrder.platformOrderKey,
          shortOrderKey: targetOrder.shortOrderKey,
          kdsStatus: targetOrder.kdsStatus,
          kdsSentAt: targetOrder.kdsSentAt,
          kdsReadyAt: targetOrder.kdsReadyAt,
          kdsPrepSeconds: targetOrder.kdsPrepSeconds
        },
        expected_bag_count: currentBags,
        confirmed_bag_count: currentBags,
        risk_level: isHighRisk ? 'HIGH' : 'NORMAL',
        risk_reasons: currentReasons,
        evidence_policy: isHighRisk ? 'SEALED_BAG' : 'NONE'
      })
    })
    const data = await response.json()
    if (!response.ok || !data.ok) throw new Error(data.error || 'No se pudo terminar el empaque.')
  }

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file || !order) return
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('type', 'sealed')
      form.append('orderGuid', order.guid)
      form.append('storeId', String(storeId))
      const response = await fetch('/api/delivery-armor/upload-photo', { method: 'POST', body: form })
      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.error || 'No se pudo subir la foto.')
      setPhotos(previous => ({ ...previous, [order.guid]: data.publicUrl }))
      if (order.audit?.status !== 'released') {
        await savePackingRecord(order, data.publicUrl)
        setSuccess(`Empaque terminado: ${order.platformOrderKey}`)
        await fetchOrders()
      }
    } catch (caught: any) {
      setError(caught.message)
    } finally {
      setBusy(false)
      event.target.value = ''
    }
  }

  async function markReady() {
    if (!order || !packer) return
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      await savePackingRecord(order)
      setSuccess(`Sellado de empaque concluido: ${order.platformOrderKey}`)
      await fetchOrders()
    } catch (caught: any) {
      setError(caught.message)
    } finally {
      setBusy(false)
    }
  }

  async function release() {
    if (!order || !packer) return
    if (order.audit?.status !== 'ready') {
      setError('Primero debes concluir el sellado de empaque antes de entregar la orden.')
      return
    }
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      const response = await fetch('/api/delivery-armor/audit', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_guid: order.guid,
          store_id: storeId,
          handoff_pin: packer.pin,
          courier_name: order.assignedDriverHint || 'Chofer verificado',
          courier_verified: true,
          verification_method: order.platform === 'DOORDASH' ? 'DOORDASH_QR' : 'PLATFORM_ORDER_ID',
          courier_order_reference: order.platformOrderKey,
          live_pickup_confirmed: true
        })
      })
      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.error || 'No se pudo liberar la bolsa.')
      setSuccess(`Orden ${order.platformOrderKey} liberada por ${data.audit.handed_by_ronos_name}.`)
      await fetchOrders()
    } catch (caught: any) {
      setError(caught.message)
    } finally {
      setBusy(false)
    }
  }

  if (!packer) {
    return (
      <main className="min-h-screen bg-slate-100 grid place-items-center p-5">
        <form
          onSubmit={login}
          className="w-full max-w-xl bg-white border border-slate-200 shadow-xl rounded-[2rem] p-8"
        >
          <ShieldCheck className="w-16 h-16 text-red-600 mx-auto" />
          <h1 className="text-4xl font-black text-center mt-3">Entrega Blindada</h1>
          <p className="text-center text-slate-500 mt-2">
            Acceso con PIN de RONOS (cierre automático cada 10 min)
          </p>
          <select
            value={storeId}
            onChange={event => setStoreId(Number(event.target.value))}
            className="w-full h-14 rounded-2xl border px-4 text-lg font-bold mt-7"
          >
            {STORES.map(store => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            value={pin}
            onChange={event => setPin(event.target.value.replace(/\D/g, ''))}
            placeholder="• • • •"
            className="w-full h-20 rounded-2xl border-2 mt-4 text-center text-4xl font-black tracking-[.5em]"
          />
          {error && <p className="text-red-600 font-bold mt-3 text-center">{error}</p>}
          <button
            disabled={busy || pin.length !== 4}
            className="w-full h-16 rounded-2xl bg-red-600 text-white text-xl font-black mt-5 disabled:opacity-30"
          >
            {busy ? 'VALIDANDO…' : 'ENTRAR'}
          </button>
        </form>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950 pb-10">
      <header className="sticky top-0 z-30 bg-white border-b px-4 py-3 shadow-sm">
        <div className="max-w-2xl mx-auto flex justify-between items-center gap-3">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-8 h-8 text-red-600" />
            <div>
              <h1 className="text-xl font-black leading-none">Entrega Blindada</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                {STORES.find(store => store.id === storeId)?.name}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchOrders}
              title="Actualizar"
              className="p-2.5 rounded-xl bg-slate-100"
            >
              <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <span className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-100 text-sm font-bold">
              <User className="w-4 h-4" />
              <span className="hidden sm:inline">{packer.name}</span>
              <small className="text-slate-500 font-mono">
                PIN •••• ({formatRemainingMs(remainingMs)})
              </small>
            </span>
            <button
              onClick={() => logout()}
              title="Salir"
              className="p-2.5 rounded-xl bg-slate-100 text-red-600"
            >
              <LogOut className="w-5 h-5" />
            </button>
            <Link
              href="/admin/blindaje-delivery"
              title="Expedientes"
              className="p-2.5 rounded-xl bg-slate-900 text-white"
            >
              <FileText className="w-5 h-5" />
            </Link>
          </div>
        </div>
      </header>

      {/* DISEÑO VERTICAL LIMPIO EN UNA SOLA COLUMNA */}
      <div className="max-w-2xl mx-auto p-4 space-y-4">
        {/* 1. BUSCADOR Y SELECTOR POR CLAVE ÚNICA */}
        <section className="bg-white border rounded-3xl p-4 shadow-sm space-y-3">
          <div className="relative">
            <Search className="w-5 h-5 absolute left-4 top-3.5 text-slate-400" />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Buscar por clave de orden (ej. UBERB5BCB, DD 04BBB1A4, #42)"
              className="w-full h-12 rounded-xl bg-slate-100 pl-11 pr-4 font-bold uppercase placeholder:normal-case"
            />
          </div>

          {blockedByName && (
            <div className="p-3 rounded-xl bg-slate-100 border border-slate-300 text-slate-800 text-sm font-bold">
              No busques por nombre del cliente. Ingresa la clave de la orden de la plataforma.
            </div>
          )}

          <div className="flex gap-2 overflow-x-auto pb-1">
            {visible.map(value => (
              <button
                key={value.guid}
                onClick={() => {
                  setSelected(value.guid)
                  setError(null)
                  setSuccess(null)
                }}
                className={`min-w-[165px] p-3 rounded-2xl border-2 text-left flex-shrink-0 ${
                  selected === value.guid ? 'border-red-600 bg-red-50/40' : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex justify-between items-center gap-2">
                  <span className="text-xs font-bold text-slate-500">{label(value.platform)}</span>
                  <span className="text-[11px] font-black px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">
                    {value.audit?.status === 'released'
                      ? 'LIBERADA'
                      : value.audit?.status === 'ready'
                      ? 'LISTA'
                      : 'EMPAQUE'}
                  </span>
                </div>
                <strong className="block text-lg font-black font-mono mt-1 truncate">
                  {value.platformOrderKey}
                </strong>
                <small className="text-slate-500 block mt-0.5">
                  #{value.ticket} • {value.itemCount} art.{value.hasDrinks ? ' • CON BEBIDAS' : ''}
                </small>
              </button>
            ))}
            {!loading && visible.length === 0 && !blockedByName && (
              <p className="text-center text-slate-500 py-3 text-sm w-full">
                No hay órdenes delivery activas con esa clave.
              </p>
            )}
          </div>
        </section>

        {error && (
          <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 font-bold flex gap-3">
            <AlertTriangle className="flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold flex gap-3">
            <CheckCircle2 className="flex-shrink-0" />
            <span>{success}</span>
          </div>
        )}

        {!order ? (
          <div className="h-80 bg-white rounded-3xl border grid place-items-center text-center p-6">
            <div>
              <ShoppingBag className="w-16 h-16 mx-auto text-slate-300" />
              <h2 className="text-2xl font-black mt-2">Selecciona una orden</h2>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* 2. CABEZAL LIMPIO CON LA CLAVE ÚNICA DE LA ORDEN Y TIEMPO KDS */}
            <section className="bg-white border rounded-3xl p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-black text-red-600">{label(order.platform)}</p>
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 bg-slate-100 px-3 py-1 rounded-lg">
                  <Clock className="w-3.5 h-3.5" />
                  {order.kdsStatus === 'IN_KITCHEN'
                    ? 'En cocina KDS'
                    : `Preparación KDS: ${formatDuration(order.kdsPrepSeconds)}`}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block">
                    Clave única de la orden
                  </span>
                  <h2 className="text-4xl sm:text-5xl font-black font-mono tracking-tight">
                    {order.platformOrderKey}
                  </h2>
                </div>
                <div className="text-right">
                  <span className="text-2xl font-black font-mono text-slate-700 block">
                    Check #{order.ticket}
                  </span>
                  <span className="text-xs text-slate-400 font-semibold">
                    Ref: {order.maskedCustomer}
                  </span>
                </div>
              </div>

              {order.isVoided && (
                <div className="mt-4 p-3 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-sm font-black">
                  ⚠️ ORDEN CANCELADA (VOIDED) EN TOAST
                </div>
              )}

              {order.hasDrinks && (
                <div className="mt-4 inline-block px-3.5 py-1.5 rounded-xl bg-slate-100 border border-slate-300 text-slate-900 text-sm font-black">
                  CON BEBIDAS
                </div>
              )}

              {/* CONTENIDO DE LA ORDEN */}
              <div className="mt-5 pt-4 border-t space-y-2">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-black uppercase text-slate-400">
                    Contenido ({order.itemCount} artículos)
                  </span>
                </div>
                {order.items.map(item => (
                  <div key={item.id} className="p-3 rounded-xl bg-slate-50 flex justify-between items-start gap-2">
                    <div>
                      <strong>
                        <span className="text-red-600 mr-1">{item.quantity}x</span>
                        {item.name}
                      </strong>
                      {item.modifiers.length > 0 && (
                        <p className="text-sm text-slate-500">{item.modifiers.join(' • ')}</p>
                      )}
                    </div>
                    {item.isDrink && (
                      <span className="text-[11px] font-black px-2 py-0.5 rounded bg-slate-200 text-slate-700">
                        CON BEBIDAS
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* 3. CONCLUIR SELLADO DE EMPAQUE Y BLINDAR LA ENTREGA */}
            <section className="bg-white border rounded-3xl p-6 shadow-sm space-y-5">
              {/* PASO 1: CONCLUIR SELLADO DE EMPAQUE (OBLIGATORIO) */}
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xl font-black">1. Concluir sellado de empaque</h3>
                    <p className="text-sm text-slate-500">
                      Confirma cantidad de bolsas y sello. La fotografía es opcional.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <strong className="text-sm">Bolsas:</strong>
                    <button
                      type="button"
                      disabled={order.audit?.status === 'released'}
                      onClick={() =>
                        setBags(previous => ({ ...previous, [order.guid]: Math.max(1, bagCount - 1) }))
                      }
                      className="w-10 h-10 rounded-xl bg-slate-200 text-xl font-black disabled:opacity-30"
                    >
                      −
                    </button>
                    <span className="text-2xl font-black w-8 text-center">{bagCount}</span>
                    <button
                      type="button"
                      disabled={order.audit?.status === 'released'}
                      onClick={() =>
                        setBags(previous => ({ ...previous, [order.guid]: Math.min(20, bagCount + 1) }))
                      }
                      className="w-10 h-10 rounded-xl bg-slate-950 text-white text-xl font-black disabled:opacity-30"
                    >
                      +
                    </button>
                  </div>
                </div>

                <label
                  className={`min-h-20 rounded-2xl border-2 border-dashed grid place-items-center cursor-pointer ${
                    sealedPhoto ? 'border-emerald-500 bg-emerald-50' : 'border-slate-300 bg-slate-50'
                  }`}
                >
                  {sealedPhoto ? (
                    <div className="text-center py-2">
                      <CheckCircle2 className="mx-auto text-emerald-600 w-6 h-6" />
                      <strong className="text-sm">Foto de bolsa sellada guardada</strong>
                    </div>
                  ) : (
                    <div className="text-center py-2">
                      <Camera className="mx-auto w-6 h-6 text-slate-600" />
                      <strong className="text-sm">Foto de bolsa sellada + ticket (Opcional)</strong>
                    </div>
                  )}
                  <input
                    type="file"
                    disabled={order.audit?.status === 'released'}
                    accept="image/jpeg,image/png,image/webp"
                    capture="environment"
                    className="hidden"
                    onChange={upload}
                  />
                </label>

                {order.audit?.status !== 'released' && order.audit?.status !== 'ready' && (
                  <button
                    type="button"
                    onClick={markReady}
                    disabled={busy}
                    className="w-full h-14 rounded-2xl bg-slate-950 text-white text-lg font-black disabled:opacity-30"
                  >
                    CONCLUIR SELLADO DE EMPAQUE
                  </button>
                )}

                {order.audit?.status === 'ready' && (
                  <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-bold flex items-center justify-between">
                    <span>✓ Sellado de empaque concluido</span>
                    <span>{bagCount} bolsa{bagCount === 1 ? '' : 's'}</span>
                  </div>
                )}
              </div>

              {/* PASO 2: BLINDAR ENTREGA AL CHOFER */}
              <div className="pt-5 border-t space-y-3">
                <div>
                  <h3 className="text-xl font-black">2. Blindar la entrega</h3>
                  <p className="text-sm text-slate-500">
                    {order.platform === 'DOORDASH'
                      ? `Verifica clave ${order.platformOrderKey} y que el Dasher escanee el QR del Check #${order.ticket} en vivo.`
                      : `Verifica la clave ${order.platformOrderKey} en la pantalla activa del chofer antes de entregar.`}
                  </p>
                </div>

                {order.audit?.status === 'released' ? (
                  <div className="p-4 rounded-2xl bg-slate-100 border border-slate-300">
                    <strong className="block text-slate-900">
                      ✓ ENTREGADA CON CLAVE {order.platformOrderKey}
                    </strong>
                    <p className="text-sm text-slate-600 mt-0.5">
                      Por {order.audit.handedBy} • {order.audit.driver || 'Chofer verificado'}
                    </p>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={release}
                    disabled={busy || order.audit?.status !== 'ready'}
                    className="w-full h-16 rounded-2xl bg-red-600 text-white text-xl font-black disabled:bg-slate-300 disabled:text-slate-600 flex items-center justify-center gap-2"
                  >
                    {order.audit?.status === 'ready' ? <Truck className="w-6 h-6" /> : <Lock className="w-6 h-6" />}
                    <span>
                      {busy
                        ? 'PROCESANDO…'
                        : order.audit?.status !== 'ready'
                        ? 'PRIMERO CONCLUYE EL SELLADO DE EMPAQUE'
                        : `CONFIRMAR CLAVE ${order.platformOrderKey} Y ENTREGAR`}
                    </span>
                  </button>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  )
}
