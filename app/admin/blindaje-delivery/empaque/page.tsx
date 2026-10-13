/**
 * @module BlindajeDeliveryEmpaque
 * @description Estación vertical de Entrega Blindada para validar el empaque y liberar cada bolsa al chofer correcto.
 * @businessRules El personal usa PIN RONOS; nunca se entrega por nombre; se confirman platillos, bebidas, bolsas y sello; DoorDash usa QR nativo y las demás plataformas usan el ID visible en la app; las órdenes de riesgo requieren foto sellada.
 * @dataFlow Toast -> /api/delivery-armor/orders -> tableta -> /api/delivery-armor/audit -> Supabase.
 * @notes Piloto Slauson (#7) y LA Central (#6). Reemplaza el checklist por artículo y la doble foto universal.
 */

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Camera, Check, CheckCircle2, FileText, Lock, LogOut, RefreshCw, Search, ShieldCheck, ShoppingBag, Smartphone, Truck, User, X } from 'lucide-react'

const STORES = [{ id: 7, name: 'Slauson (#7)' }, { id: 6, name: 'LA Central (#6)' }]
type Platform = 'DOORDASH' | 'UBER_EATS' | 'GRUBHUB' | 'TOAST_ONLINE' | 'OTHER'
type CheckKey = 'foodComplete' | 'drinksComplete' | 'bagCountCorrect' | 'bagSealed'
type Checks = Record<CheckKey, boolean>
const EMPTY: Checks = { foodComplete: false, drinksComplete: false, bagCountCorrect: false, bagSealed: false }

interface Packer { pin: string; name: string; title: string; id: number; storeId: number }
interface Item { id: string; name: string; quantity: number; modifiers: string[]; isDrink: boolean }
interface Order {
  guid: string; ticket: string; diningOption: string; platform: Platform; customer: string; openedAt: string
  items: Item[]; itemCount: number; hasDrinks: boolean
  audit?: { status: 'pending' | 'ready' | 'released'; checks?: Checks; bags?: number; sealedPhoto?: string; handedBy?: string; driver?: string }
}

const label = (platform: Platform) => platform === 'DOORDASH' ? 'DoorDash' : platform === 'UBER_EATS' ? 'Uber Eats' : platform === 'GRUBHUB' ? 'Grubhub' : platform === 'TOAST_ONLINE' ? 'Toast Delivery' : 'Delivery'

export default function BlindajeDeliveryEmpaquePage() {
  const [storeId, setStoreId] = useState(7)
  const [packer, setPacker] = useState<Packer | null>(null)
  const [pin, setPin] = useState('')
  const [orders, setOrders] = useState<Order[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [checks, setChecks] = useState<Record<string, Checks>>({})
  const [bags, setBags] = useState<Record<string, number>>({})
  const [photos, setPhotos] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [handoff, setHandoff] = useState(false)
  const [driver, setDriver] = useState('')
  const [reference, setReference] = useState('')
  const [nativeOk, setNativeOk] = useState(false)
  const [liveOk, setLiveOk] = useState(false)

  useEffect(() => {
    try {
      const savedStore = Number(sessionStorage.getItem('blindaje_packer_store'))
      const savedPin = sessionStorage.getItem('blindaje_packer_pin') || ''
      const name = sessionStorage.getItem('blindaje_packer_name') || ''
      const id = Number(sessionStorage.getItem('blindaje_packer_user_id'))
      if (savedStore === storeId && /^\d{4}$/.test(savedPin) && name && id) setPacker({ pin: savedPin, name, title: sessionStorage.getItem('blindaje_packer_title') || 'Colaborador', id, storeId })
      else setPacker(null)
    } catch { setPacker(null) }
  }, [storeId])

  const fetchOrders = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const response = await fetch(`/api/delivery-armor/orders?storeId=${storeId}`, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.error || 'No se pudieron cargar las órdenes.')
      const next: Order[] = (data.orders || []).map((raw: any) => ({
        guid: raw.orderGuid, ticket: raw.displayNumber, diningOption: raw.diningOptionName, platform: raw.platform,
        customer: raw.customerName, openedAt: raw.openedDate, itemCount: raw.totalItemsCount,
        hasDrinks: raw.items?.some((item: any) => item.isHighRiskDrink) || false,
        items: (raw.items || []).map((item: any) => ({ id: item.id, name: item.displayName, quantity: item.quantity, modifiers: item.modifiers || [], isDrink: item.isHighRiskDrink })),
        audit: raw.audit ? {
          status: raw.audit.status === 'DELIVERED' ? 'released' : raw.audit.status === 'PACKED_AND_SEALED' ? 'ready' : 'pending',
          checks: raw.audit.quickChecks, bags: raw.audit.confirmedBagCount, sealedPhoto: raw.audit.photoSealedUrl,
          handedBy: raw.audit.handedByName, driver: raw.audit.driverName
        } : undefined
      }))
      setOrders(next)
      setSelected(current => current && next.some(order => order.guid === current) ? current : next[0]?.guid || null)
    } catch (caught: any) { setError(caught.message) } finally { setLoading(false) }
  }, [storeId])

  useEffect(() => {
    if (!packer) return
    void fetchOrders()
    const timer = window.setInterval(fetchOrders, 25000)
    return () => window.clearInterval(timer)
  }, [packer, fetchOrders])

  const order = useMemo(() => orders.find(value => value.guid === selected) || null, [orders, selected])
  const orderChecks = order ? checks[order.guid] || order.audit?.checks || EMPTY : EMPTY
  const bagCount = order ? bags[order.guid] || order.audit?.bags || 1 : 1
  const sealedPhoto = order ? photos[order.guid] || order.audit?.sealedPhoto || '' : ''
  const riskReasons = useMemo(() => order ? [order.hasDrinks ? 'bebida refrigerada' : '', order.itemCount >= 8 ? 'orden grande' : '', bagCount > 1 ? 'múltiples bolsas' : ''].filter(Boolean) : [], [order, bagCount])
  const risk = riskReasons.length > 0
  const complete = Object.values(orderChecks).every(Boolean)
  const visible = orders.filter(value => `${value.ticket} ${value.customer} ${label(value.platform)}`.toLowerCase().includes(search.trim().toLowerCase()))

  async function login(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(null)
    try {
      const response = await fetch('/api/delivery-armor/verify-pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeId, pin }) })
      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.error || 'PIN no válido.')
      const next = { pin, name: data.employee.fullName, title: data.employee.jobTitle, id: data.employee.id, storeId }
      setPacker(next)
      sessionStorage.setItem('blindaje_packer_pin', pin); sessionStorage.setItem('blindaje_packer_name', next.name)
      sessionStorage.setItem('blindaje_packer_title', next.title); sessionStorage.setItem('blindaje_packer_user_id', String(next.id)); sessionStorage.setItem('blindaje_packer_store', String(storeId)); setPin('')
    } catch (caught: any) { setError(caught.message) } finally { setBusy(false) }
  }

  function logout() {
    ;['blindaje_packer_pin', 'blindaje_packer_name', 'blindaje_packer_title', 'blindaje_packer_user_id', 'blindaje_packer_store'].forEach(key => sessionStorage.removeItem(key))
    setPacker(null)
  }

  function toggle(key: CheckKey) {
    if (!order || order.audit?.status === 'released') return
    setChecks(previous => ({ ...previous, [order.guid]: { ...orderChecks, [key]: !orderChecks[key] } }))
  }

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file || !order) return
    setBusy(true); setError(null)
    try {
      const form = new FormData(); form.append('file', file); form.append('type', 'sealed'); form.append('orderGuid', order.guid); form.append('storeId', String(storeId))
      const response = await fetch('/api/delivery-armor/upload-photo', { method: 'POST', body: form }); const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.error || 'No se pudo subir la foto.')
      setPhotos(previous => ({ ...previous, [order.guid]: data.publicUrl }))
    } catch (caught: any) { setError(caught.message) } finally { setBusy(false); event.target.value = '' }
  }

  async function markReady() {
    if (!order || !packer || !complete || (risk && !sealedPhoto)) return
    setBusy(true); setError(null)
    try {
      const response = await fetch('/api/delivery-armor/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        store_id: storeId, order_guid: order.guid, ticket_number: order.ticket, platform: order.platform, dining_option_name: order.diningOption,
        customer_name: order.customer, opened_at: order.openedAt, items_ordered: order.items,
        matchedItems: Object.entries(orderChecks).filter(([, ok]) => ok).map(([key]) => `CONTROL:${key}`), matchCompleted: true,
        photo_sealed_bag_url: sealedPhoto || null, packer_pin: packer.pin, quick_checks: orderChecks,
        expected_bag_count: bagCount, confirmed_bag_count: bagCount, risk_level: risk ? 'HIGH' : 'NORMAL', risk_reasons: riskReasons,
        evidence_policy: risk ? 'SEALED_BAG' : 'NONE'
      }) })
      const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.error || 'No se pudo confirmar el empaque.')
      setSuccess(`Orden #${order.ticket} lista para validar con el chofer.`); await fetchOrders()
    } catch (caught: any) { setError(caught.message) } finally { setBusy(false) }
  }

  function openHandoff() {
    if (!order || order.audit?.status !== 'ready') return
    setDriver(''); setReference(order.platform === 'DOORDASH' ? `QR-${order.ticket}` : ''); setNativeOk(false); setLiveOk(false); setHandoff(true); setError(null)
  }

  async function release() {
    if (!order || !packer || !nativeOk || !liveOk || !reference.trim()) return
    setBusy(true); setError(null)
    try {
      const response = await fetch('/api/delivery-armor/audit', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        order_guid: order.guid, store_id: storeId, handoff_pin: packer.pin, courier_name: driver.trim() || undefined,
        courier_verified: true, verification_method: order.platform === 'DOORDASH' ? 'DOORDASH_QR' : 'PLATFORM_ORDER_ID',
        courier_order_reference: reference.trim(), live_pickup_confirmed: true
      }) })
      const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.error || 'No se pudo liberar la bolsa.')
      setHandoff(false); setSuccess(`Bolsa #${order.ticket} liberada por ${data.audit.handed_by_ronos_name}.`); await fetchOrders()
    } catch (caught: any) { setError(caught.message) } finally { setBusy(false) }
  }

  if (!packer) return <main className="min-h-screen bg-slate-100 grid place-items-center p-5"><form onSubmit={login} className="w-full max-w-xl bg-white border border-slate-200 shadow-xl rounded-[2rem] p-8"><ShieldCheck className="w-16 h-16 text-red-600 mx-auto" /><h1 className="text-4xl font-black text-center mt-3">Entrega Blindada</h1><p className="text-center text-slate-500 mt-2">Acceso con PIN de RONOS</p><select value={storeId} onChange={event => setStoreId(Number(event.target.value))} className="w-full h-14 rounded-2xl border px-4 text-lg font-bold mt-7">{STORES.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}</select><input type="password" inputMode="numeric" maxLength={4} value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, ''))} placeholder="• • • •" className="w-full h-20 rounded-2xl border-2 mt-4 text-center text-4xl font-black tracking-[.5em]" />{error && <p className="text-red-600 font-bold mt-3">{error}</p>}<button disabled={busy || pin.length !== 4} className="w-full h-16 rounded-2xl bg-red-600 text-white text-xl font-black mt-5 disabled:opacity-30">{busy ? 'VALIDANDO…' : 'ENTRAR'}</button></form></main>

  return <main className="min-h-screen bg-slate-100 text-slate-950">
    <header className="sticky top-0 z-30 bg-white border-b px-4 py-3 shadow-sm"><div className="max-w-7xl mx-auto flex justify-between items-center gap-3"><div className="flex items-center gap-3"><ShieldCheck className="w-9 h-9 text-red-600" /><div><h1 className="text-2xl font-black">Entrega Blindada</h1><p className="text-xs text-slate-500">{STORES.find(store => store.id === storeId)?.name}</p></div></div><div className="flex items-center gap-2"><button onClick={fetchOrders} className="p-3 rounded-xl bg-slate-100"><RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} /></button><span className="hidden sm:flex items-center gap-2 p-3 rounded-xl bg-slate-100 font-bold"><User className="w-4 h-4" />{packer.name} <small className="text-slate-400">PIN ••••</small></span><button onClick={logout} className="p-3 rounded-xl bg-slate-100 text-red-600"><LogOut /></button><Link href="/admin/blindaje-delivery" className="p-3 rounded-xl bg-slate-900 text-white"><FileText /></Link></div></div></header>
    <div className="max-w-7xl mx-auto p-4 sm:p-6 grid lg:grid-cols-[350px_1fr] gap-5">
      <aside className="bg-white border rounded-3xl overflow-hidden lg:sticky lg:top-24 lg:h-[calc(100vh-7rem)]"><div className="p-4 border-b relative"><Search className="absolute left-7 top-7 text-slate-400" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Ticket, cliente o plataforma" className="w-full h-12 rounded-xl bg-slate-100 pl-12 pr-4 font-bold" /></div><div className="p-3 space-y-2 overflow-auto lg:h-[calc(100%-81px)]">{visible.map(value => <button key={value.guid} onClick={() => { setSelected(value.guid); setError(null); setSuccess(null) }} className={`w-full p-4 rounded-2xl border-2 text-left ${selected === value.guid ? 'border-red-500 bg-red-50' : 'border-slate-200'}`}><div className="flex justify-between"><strong className="text-3xl font-mono">#{value.ticket}</strong><span className={`text-xs font-black px-2 py-1 rounded-lg ${value.audit?.status === 'released' ? 'bg-blue-100 text-blue-700' : value.audit?.status === 'ready' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{value.audit?.status === 'released' ? 'LIBERADA' : value.audit?.status === 'ready' ? 'LISTA' : 'EMPAQUE'}</span></div><p className="font-bold truncate">{value.customer}</p><small className="text-slate-500">{label(value.platform)} • {value.itemCount} artículos</small></button>)}{!loading && visible.length === 0 && <p className="text-center text-slate-500 p-8">No hay órdenes delivery activas.</p>}</div></aside>
      <section className="min-w-0">{error && <div className="mb-4 p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 font-bold flex gap-3"><AlertTriangle />{error}</div>}{success && <div className="mb-4 p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold flex gap-3"><CheckCircle2 />{success}</div>}{!order ? <div className="h-[500px] bg-white rounded-3xl border grid place-items-center text-center"><div><ShoppingBag className="w-20 h-20 mx-auto text-slate-300" /><h2 className="text-2xl font-black">Selecciona una orden</h2></div></div> : <div className="space-y-5">
        <div className="bg-white border rounded-3xl p-6 shadow-sm"><p className="font-black text-red-600">{label(order.platform)}</p><h2 className="text-6xl font-black font-mono">#{order.ticket}</h2><p className="text-xl font-black">{order.customer}</p>{order.hasDrinks && <div className="mt-4 p-4 rounded-2xl bg-amber-500 text-white text-lg font-black animate-pulse">🧊 BEBIDAS EN REFRIGERADOR</div>}</div>
        <div className="bg-white border rounded-3xl p-6 shadow-sm"><h3 className="text-2xl font-black">1. Cuatro controles rápidos</h3><p className="text-sm text-slate-500 mb-5">Sin tocar cada taco o condimento.</p><div className="grid sm:grid-cols-2 gap-3">{([['foodComplete','Platillos completos',`${order.itemCount} artículos`],['drinksComplete','Bebidas incluidas',order.hasDrinks?'Revisar refrigerador':'Sin bebidas pendientes'],['bagCountCorrect','Bolsas correctas',`${bagCount} bolsa${bagCount === 1 ? '' : 's'}`],['bagSealed','Bolsa sellada','Ticket visible y sello intacto']] as [CheckKey,string,string][]).map(([key,title,help]) => <button key={key} onClick={() => toggle(key)} disabled={order.audit?.status === 'released'} className={`min-h-24 p-4 rounded-2xl border-2 text-left flex items-center gap-4 ${orderChecks[key] ? 'bg-emerald-50 border-emerald-500' : 'border-slate-300'}`}><span className={`w-12 h-12 rounded-xl grid place-items-center ${orderChecks[key] ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-300'}`}><Check /></span><span><strong className="block text-lg">{title}</strong><small>{help}</small></span></button>)}</div><div className="mt-5 flex items-center gap-3"><strong>Bolsas:</strong><button onClick={() => setBags(previous => ({ ...previous, [order.guid]: Math.max(1, bagCount - 1) }))} className="w-12 h-12 rounded-xl bg-slate-200 text-2xl font-black">−</button><span className="text-3xl font-black w-12 text-center">{bagCount}</span><button onClick={() => setBags(previous => ({ ...previous, [order.guid]: Math.min(20, bagCount + 1) }))} className="w-12 h-12 rounded-xl bg-slate-950 text-white text-2xl font-black">+</button></div></div>
        <div className="bg-white border rounded-3xl p-6 shadow-sm"><h3 className="text-2xl font-black">2. Evidencia proporcional</h3><p className="text-sm text-slate-500 mb-4">{risk ? `Obligatoria: ${riskReasons.join(', ')}` : 'Orden normal: foto opcional'}</p><label className={`min-h-28 rounded-2xl border-2 border-dashed grid place-items-center cursor-pointer ${sealedPhoto ? 'border-emerald-500 bg-emerald-50' : risk ? 'border-red-400 bg-red-50' : 'border-slate-300'}`}>{sealedPhoto ? <div className="text-center"><CheckCircle2 className="mx-auto text-emerald-600" /><strong>Foto sellada guardada</strong></div> : <div className="text-center"><Camera className="mx-auto" /><strong>Foto de bolsa sellada + ticket</strong></div>}<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={upload} /></label>{order.audit?.status !== 'released' && order.audit?.status !== 'ready' && <button onClick={markReady} disabled={!complete || busy || (risk && !sealedPhoto)} className="w-full h-16 mt-5 rounded-2xl bg-slate-950 text-white text-xl font-black disabled:opacity-30">CONFIRMAR EMPAQUE Y DEJAR LISTA</button>}</div>
        <div className="bg-white border rounded-3xl p-6 shadow-sm"><h3 className="text-2xl font-black">3. Validar chofer y liberar</h3><p className="text-sm text-slate-500 mb-4">Nunca entregar por nombre.</p>{order.audit?.status === 'released' ? <div className="p-5 rounded-2xl bg-blue-50 border border-blue-200"><strong className="text-blue-800">ENTREGADA AL CHOFER</strong><p>Por {order.audit.handedBy} • {order.audit.driver || 'Chofer verificado'}</p></div> : <button onClick={openHandoff} disabled={order.audit?.status !== 'ready'} className="w-full h-20 rounded-2xl bg-red-600 text-white text-2xl font-black disabled:bg-slate-300"><Truck className="inline mr-2" />{order.audit?.status === 'ready' ? 'VALIDAR CHOFER' : 'PRIMERO CONFIRMA EL EMPAQUE'}</button>}</div>
        <div className="bg-white border rounded-3xl p-5"><h3 className="font-black mb-3">Referencia de contenido</h3>{order.items.map(item => <div key={item.id} className="p-3 mb-2 rounded-xl bg-slate-50"><strong><span className="text-red-600">{item.quantity}x</span> {item.name}</strong>{item.modifiers.length > 0 && <p className="text-sm text-slate-500">{item.modifiers.join(' • ')}</p>}</div>)}</div>
      </div>}</section>
    </div>
    {handoff && order && <div className="fixed inset-0 z-50 bg-black/65 p-4 grid place-items-center"><div className="w-full max-w-2xl max-h-[95vh] overflow-auto bg-white rounded-[2rem] p-7"><div className="flex justify-between"><div><p className="font-black text-red-600">{label(order.platform)}</p><h2 className="text-4xl font-black">Liberar #{order.ticket}</h2></div><button onClick={() => setHandoff(false)} className="p-2 rounded-xl bg-slate-100"><X /></button></div><div className="mt-5 p-5 rounded-2xl bg-amber-50 border border-amber-300"><AlertTriangle className="text-amber-600" /><strong className="text-xl block">No uses el nombre del cliente.</strong><p>{order.platform === 'DOORDASH' ? 'El Dasher debe escanear el QR del ticket y su app debe aceptar esta orden.' : 'Compara el ID visible en la app activa contra el ticket.'}</p></div><label className="block font-black mt-5">Referencia mostrada por la app</label><input value={reference} onChange={event => setReference(event.target.value)} placeholder="ID o confirmación QR" className="w-full h-16 mt-2 rounded-2xl border-2 px-4 text-xl font-black uppercase" /><label className="block font-black mt-4">Nombre del chofer (opcional)</label><input value={driver} onChange={event => setDriver(event.target.value)} className="w-full h-14 mt-2 rounded-2xl border px-4" /><button onClick={() => setNativeOk(!nativeOk)} className={`w-full mt-5 p-4 rounded-2xl border-2 text-left flex gap-3 ${nativeOk ? 'bg-emerald-50 border-emerald-500' : ''}`}><Smartphone /><strong>La verificación nativa aceptó la orden correcta</strong></button><button onClick={() => setLiveOk(!liveOk)} className={`w-full mt-3 p-4 rounded-2xl border-2 text-left flex gap-3 ${liveOk ? 'bg-emerald-50 border-emerald-500' : ''}`}><Check /><strong>Vi la confirmación de recogida en vivo</strong></button><button onClick={release} disabled={!nativeOk || !liveOk || !reference.trim() || busy} className="w-full h-20 mt-6 rounded-2xl bg-red-600 text-white text-2xl font-black disabled:opacity-30"><Lock className="inline mr-2" />LIBERAR BOLSA</button></div></div>}
  </main>
}
