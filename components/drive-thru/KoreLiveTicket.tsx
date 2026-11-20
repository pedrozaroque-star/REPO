/**
 * @module components/drive-thru/KoreLiveTicket
 * @description Ticket en vivo (live order confirmation board) del simulador "Kore Drive-Thru".
 *   Imita la pantalla de confirmación de orden (OCB) de un drive-thru real: fondo oscuro, letras
 *   grandes, cantidades, modificadores, subtotal, impuesto y total en USD.
 *
 * @businessRules
 * - Moneda exclusiva: dólares estadounidenses (USD) con 2 decimales (`Intl.NumberFormat en-US`).
 * - Los totales SIEMPRE vienen de `computeKoreTotals` (centavos enteros, sin flotantes); este
 *   componente solo formatea, nunca recalcula impuestos.
 * - Si la tasa de impuesto es estimada (`taxIsEstimate`), la etiqueta lo dice explícitamente.
 * - Estados de la orden: `building` (en proceso), `confirmed` (confirmada) y `cancelled` (cancelada).
 * - Recolección de repartidores (`order.sessionKind === 'driver_pickup'`): muestra tarjeta dedicada
 *   con badge de plataforma (`DoorDash`, `Uber Eats`, `Grubhub`, etc.), destacado de **`VENTANA 2` /
 *   `WINDOW 2`**, lista numerada `1..N` de órdenes en el mismo vehículo cruzadas en vivo con Blindaje
 *   Delivery (`🟢 LISTA / EMPACADA`, `🟡 EN COCINA`, `🟠 YA ENTREGADA`, `🔴 VERIFICAR EN VENTANA`),
 *   `#ticket` (`matchedDisplayNumber`), piezas (`itemsCount`), sello y total `$0.00` USD.
 *
 * @dataFlow
 * - Props `order` (KoreOrderState del motor `lib/drive-thru-kore-order.ts`, enriquecido por
 *   `/api/drive-thru/kore/driver-lookup`) + `totals` (KoreOrderTotals) → render. Detecta altas/cambios/bajas
 *   comparando contra el render anterior (useRef) para animar: verde = agregado, ámbar = modificado,
 *   tachado rojo = quitado.
 *
 * @notes
 * - Siempre oscuro (también en modo claro) para parecerse a la pantalla física del drive-thru.
 * - Las líneas quitadas se muestran 1.6 s como "fantasma" tachado antes de desaparecer.
 */
'use client'

import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, XCircle, ShoppingBag, Loader2, Truck, Hash, MapPin, ShieldCheck, Package } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import type {
    KoreDriverOrderLookupStatus,
    KoreDriverPickupOrder,
    KoreOrderLine,
    KoreOrderState,
    KoreOrderTotals,
} from '@/lib/drive-thru-kore-order'

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

/** Formatea centavos enteros a USD ($1,234.56). Valores no finitos → $0.00. */
export function formatUsdCents(cents: number | null | undefined): string {
    const safe = typeof cents === 'number' && Number.isFinite(cents) ? Math.round(cents) : 0
    return USD.format(safe / 100)
}

type FlashKind = 'added' | 'updated'

interface GhostLine {
    line: KoreOrderLine
    expiresAt: number
}

interface KoreLiveTicketProps {
    order: KoreOrderState
    totals: KoreOrderTotals
    taxRatePct: number | null
    taxIsEstimate: boolean
    customerStoreName: string | null
    active: boolean
    /** Cambia en cada nueva sesión para reiniciar la detección de cambios sin animaciones. */
    resetKey: number
}

/** Firma de una línea para detectar cambios (cantidad, modificadores, notas, total). */
function lineSignature(line: KoreOrderLine): string {
    const mods = (line.modifiers || []).map(m => `${m.quantity ?? 1}x${m.guid || m.name}`).join('|')
    return `${line.quantity}#${line.lineTotalCents}#${mods}#${line.notes || ''}`
}

function platformBadgeClasses(platform: string): string {
    const norm = platform.trim().toLowerCase()
    if (norm.includes('doordash')) return 'bg-rose-500 text-white ring-rose-300/40'
    if (norm.includes('uber')) return 'bg-emerald-500 text-white ring-emerald-300/40'
    if (norm.includes('grubhub')) return 'bg-orange-500 text-white ring-orange-300/40'
    if (norm.includes('postmates') || norm.includes('caviar')) return 'bg-indigo-500 text-white ring-indigo-300/40'
    if (norm.includes('gavilan')) return 'bg-amber-400 text-slate-950 ring-amber-200/50'
    return 'bg-sky-500 text-white ring-sky-300/40'
}

function driverLookupBadgeSpec(
    lookupStatus: KoreDriverOrderLookupStatus | string | null | undefined
): { i18nKey: string; classes: string } | null {
    switch (lookupStatus) {
        case 'ready':
            return {
                i18nKey: 'drive_thru.kore_driver_status_ready',
                classes: 'bg-emerald-500/20 text-emerald-200 border-emerald-400/50',
            }
        case 'preparing':
            return {
                i18nKey: 'drive_thru.kore_driver_status_preparing',
                classes: 'bg-amber-500/20 text-amber-200 border-amber-400/50',
            }
        case 'already_handed':
            return {
                i18nKey: 'drive_thru.kore_driver_status_handed',
                classes: 'bg-orange-500/20 text-orange-200 border-orange-400/50',
            }
        case 'ambiguous':
        case 'not_found':
            return {
                i18nKey: 'drive_thru.kore_driver_status_verify',
                classes: 'bg-rose-500/20 text-rose-200 border-rose-400/50',
            }
        default:
            return null
    }
}

export default function KoreLiveTicket({ order, totals, taxRatePct, taxIsEstimate, customerStoreName, active, resetKey }: KoreLiveTicketProps) {
    const { t } = useLanguage()
    const prevRef = useRef<Map<string, { sig: string; line: KoreOrderLine }>>(new Map())
    const lastResetRef = useRef<number>(resetKey)
    const timersRef = useRef<number[]>([])
    const [flashes, setFlashes] = useState<Record<string, FlashKind>>({})
    const [ghosts, setGhosts] = useState<GhostLine[]>([])

    // Limpia temporizadores pendientes al desmontar
    useEffect(() => {
        return () => {
            timersRef.current.forEach(id => window.clearTimeout(id))
            timersRef.current = []
        }
    }, [])

    // Detecta altas, cambios y bajas contra el render anterior (o reinicia sin animación cuando cambia resetKey)
    useEffect(() => {
        if (lastResetRef.current !== resetKey) {
            lastResetRef.current = resetKey
            timersRef.current.forEach(id => window.clearTimeout(id))
            timersRef.current = []
            prevRef.current = new Map(order.lines.map(line => [line.lineId, { sig: lineSignature(line), line }]))
            setFlashes({})
            setGhosts([])
            return
        }
        const prev = prevRef.current
        const next = new Map<string, { sig: string; line: KoreOrderLine }>()
        const newFlashes: Record<string, FlashKind> = {}
        for (const line of order.lines) {
            const sig = lineSignature(line)
            next.set(line.lineId, { sig, line })
            const before = prev.get(line.lineId)
            if (!before) newFlashes[line.lineId] = 'added'
            else if (before.sig !== sig) newFlashes[line.lineId] = 'updated'
        }
        const removed: GhostLine[] = []
        const now = Date.now()
        for (const [id, entry] of prev) {
            if (!next.has(id)) removed.push({ line: entry.line, expiresAt: now + 1600 })
        }
        prevRef.current = next
        if (Object.keys(newFlashes).length > 0) {
            setFlashes(f => ({ ...f, ...newFlashes }))
            const ids = Object.keys(newFlashes)
            const tid = window.setTimeout(() => {
                setFlashes(f => {
                    const copy = { ...f }
                    for (const id of ids) delete copy[id]
                    return copy
                })
            }, 1400)
            timersRef.current.push(tid)
        }
        if (removed.length > 0) {
            setGhosts(g => [...g.filter(x => x.expiresAt > now), ...removed])
            const tid = window.setTimeout(() => {
                setGhosts(g => g.filter(x => x.expiresAt > Date.now()))
            }, 1700)
            timersRef.current.push(tid)
        }
    }, [order, resetKey])

    const status = order.status
    const isDriverPickup = order.sessionKind === 'driver_pickup'
    const pickup = isDriverPickup ? order.driverPickup ?? null : null
    const pickupOrders = Array.isArray(pickup?.orders) ? pickup.orders : []
    const rawPlatform = typeof pickup?.platform === 'string' && pickup.platform.trim() ? pickup.platform.trim() : 'Other'
    const platformLabel = rawPlatform.toLowerCase() === 'other' ? t('drive_thru.kore_driver_platform_other') : rawPlatform
    const itemCount = isDriverPickup ? pickupOrders.length : (Number.isFinite(totals.itemCount) ? totals.itemCount : 0)
    const ratePct = typeof taxRatePct === 'number' && Number.isFinite(taxRatePct) ? taxRatePct : null

    return (
        <div className="relative overflow-hidden rounded-3xl border-4 border-slate-800 bg-slate-950 text-white shadow-2xl shadow-black/30 flex flex-col min-h-[460px]">
            {/* Encabezado tipo pantalla de drive-thru */}
            <div className={`flex items-center justify-between gap-3 px-5 py-4 ${
                isDriverPickup ? 'bg-gradient-to-r from-sky-600 to-indigo-700' : 'bg-gradient-to-r from-orange-600 to-red-600'
            }`}>
                <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/85">{t('drive_thru.kore_brand')}</p>
                    <h3 className="text-xl sm:text-2xl font-black leading-tight truncate">
                        {isDriverPickup ? t('drive_thru.kore_driver_title') : t('drive_thru.kore_ticket_title')}
                    </h3>
                    {customerStoreName && (
                        <p className="text-xs font-semibold text-white/85 truncate">{customerStoreName}</p>
                    )}
                </div>
                <div className="shrink-0">
                    {status === 'confirmed' && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500 px-3 py-1.5 text-sm font-black shadow-lg animate-in zoom-in-50 duration-300">
                            <CheckCircle2 size={16} /> {t('drive_thru.kore_order_confirmed')}
                        </span>
                    )}
                    {status === 'cancelled' && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500 px-3 py-1.5 text-sm font-black shadow-lg animate-in zoom-in-50 duration-300">
                            <XCircle size={16} /> {t('drive_thru.kore_order_cancelled')}
                        </span>
                    )}
                    {status === 'building' && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-black/25 px-3 py-1.5 text-xs font-bold">
                            {active ? <Loader2 size={14} className="animate-spin" /> : isDriverPickup ? <Truck size={14} /> : <ShoppingBag size={14} />}
                            {t('drive_thru.kore_order_building')}
                        </span>
                    )}
                </div>
            </div>

            {/* Contenido principal: Recolección de repartidor O Líneas de orden */}
            <div className={`flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-2 ${status === 'cancelled' ? 'opacity-50' : ''}`}>
                {isDriverPickup ? (
                    <div className="space-y-3">
                        <div className="rounded-2xl border border-sky-500/30 bg-sky-500/10 p-3.5 flex items-center justify-between gap-3 flex-wrap">
                            <div className="flex items-center gap-2.5 flex-wrap">
                                <span className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-black ring-2 shadow-sm ${platformBadgeClasses(rawPlatform)}`}>
                                    <Truck size={16} />
                                    <span>{platformLabel}</span>
                                </span>
                                <span className="inline-flex items-center gap-1 rounded-xl bg-amber-400 px-3 py-1.5 text-sm font-black text-slate-950 ring-2 ring-amber-200/60 shadow-sm">
                                    <MapPin size={15} />
                                    <span>{t('drive_thru.kore_driver_window2_badge')}</span>
                                </span>
                                <span className="text-sm font-bold text-sky-200">
                                    {t('drive_thru.kore_driver_orders_count', { count: pickupOrders.length })}
                                </span>
                            </div>
                            <p className="text-xs font-semibold text-slate-300">{t('drive_thru.kore_driver_subtitle')}</p>
                        </div>

                        {status !== 'cancelled' && (
                            <div className="rounded-xl border border-amber-400/35 bg-amber-500/10 px-3.5 py-2 text-xs font-bold text-amber-200 flex items-center gap-2">
                                <ShieldCheck size={15} className="text-amber-300 shrink-0" />
                                <span>{t('drive_thru.kore_driver_window2_banner')}</span>
                            </div>
                        )}

                        {pickupOrders.length === 0 ? (
                            <div className="py-10 text-center text-sm text-slate-400">{t('drive_thru.kore_driver_empty')}</div>
                        ) : (
                            <ol className="space-y-2.5">
                                {pickupOrders.map((po: KoreDriverPickupOrder, idx: number) => {
                                    const code = typeof po.orderCode === 'string' ? po.orderCode.trim() : ''
                                    const badgeSpec = driverLookupBadgeSpec(po.lookupStatus)
                                    const rawTicket = typeof po.matchedDisplayNumber === 'string' ? po.matchedDisplayNumber.replace(/^#+/, '').trim() : ''
                                    const piecesCount = typeof po.itemsCount === 'number' && Number.isFinite(po.itemsCount) && po.itemsCount > 0 ? Math.round(po.itemsCount) : null
                                    const matchedPlat =
                                        typeof po.matchedPlatform === 'string' && po.matchedPlatform.trim() && po.matchedPlatform.trim().toLowerCase() !== rawPlatform.toLowerCase()
                                            ? po.matchedPlatform.trim()
                                            : null
                                    return (
                                        <li
                                            key={`${po.customerName}-${code}-${idx}`}
                                            className="rounded-2xl bg-white/[0.05] border border-white/10 px-3.5 py-3 flex items-start gap-3 animate-in slide-in-from-left-3 fade-in duration-200"
                                        >
                                            <span className="shrink-0 w-10 h-10 rounded-xl bg-sky-500 text-white text-xl font-black flex items-center justify-center tabular-nums mt-0.5">
                                                {idx + 1}
                                            </span>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                                    <p className="text-lg sm:text-xl font-black leading-snug break-words">{po.customerName}</p>
                                                    {badgeSpec && (
                                                        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-black tracking-wide ${badgeSpec.classes}`}>
                                                            {t(badgeSpec.i18nKey)}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="mt-1.5 flex items-center gap-2 flex-wrap text-xs font-semibold text-slate-300">
                                                    <span className="inline-flex items-center gap-1">
                                                        <Hash size={12} className="text-sky-400 shrink-0" />
                                                        <span>
                                                            {code
                                                                ? t('drive_thru.kore_driver_code', { code })
                                                                : t('drive_thru.kore_driver_no_code')}
                                                        </span>
                                                    </span>
                                                    {rawTicket && (
                                                        <span className="inline-flex items-center rounded-lg bg-sky-500/20 border border-sky-400/35 px-2 py-0.5 text-sky-200 font-bold tabular-nums">
                                                            {t('drive_thru.kore_driver_ticket_num', { num: rawTicket })}
                                                        </span>
                                                    )}
                                                    {piecesCount !== null && (
                                                        <span className="inline-flex items-center gap-1 rounded-lg bg-white/10 border border-white/15 px-2 py-0.5 text-slate-200 font-bold tabular-nums">
                                                            <Package size={12} className="text-slate-300 shrink-0" />
                                                            <span>{t('drive_thru.kore_driver_pieces', { count: piecesCount })}</span>
                                                        </span>
                                                    )}
                                                    {po.packedAndSealed === true && (
                                                        <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/20 border border-emerald-400/40 px-2 py-0.5 text-emerald-200 font-bold">
                                                            <ShieldCheck size={12} className="text-emerald-300 shrink-0" />
                                                            <span>{t('drive_thru.kore_driver_sealed')}</span>
                                                        </span>
                                                    )}
                                                    {matchedPlat && (
                                                        <span className="inline-flex items-center rounded-lg bg-indigo-500/20 border border-indigo-400/35 px-2 py-0.5 text-indigo-200 font-bold">
                                                            {matchedPlat}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </li>
                                    )
                                })}
                            </ol>
                        )}

                        {pickup?.notes && (
                            <p className="text-sm italic text-amber-300 px-1 break-words">
                                {t('drive_thru.kore_note')}: {pickup.notes}
                            </p>
                        )}

                        {status === 'confirmed' && pickupOrders.length > 0 && (
                            <div className="rounded-2xl bg-emerald-500/20 border border-emerald-400/50 px-4 py-2.5 text-sm font-bold text-emerald-200 flex items-center justify-between gap-2 flex-wrap">
                                <div className="flex items-center gap-2">
                                    <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
                                    <span>{t('drive_thru.kore_driver_pull_forward')}</span>
                                </div>
                                <span className="inline-flex items-center gap-1 rounded-lg bg-amber-400 px-2.5 py-1 text-xs font-black text-slate-950">
                                    <MapPin size={13} />
                                    <span>{t('drive_thru.kore_driver_window2_badge')}</span>
                                </span>
                            </div>
                        )}
                    </div>
                ) : order.lines.length === 0 && ghosts.length === 0 && (
                    <div className="h-full min-h-[220px] flex flex-col items-center justify-center text-center text-slate-500 gap-3">
                        <ShoppingBag size={44} className="text-slate-700" />
                        <p className="text-base font-semibold max-w-xs">{t('drive_thru.kore_ticket_empty')}</p>
                    </div>
                )}

                {!isDriverPickup && order.lines.map(line => {
                    const flash = flashes[line.lineId]
                    return (
                        <div
                            key={line.lineId}
                            className={`rounded-2xl px-3 py-2.5 transition-colors duration-700 ${
                                flash === 'added'
                                    ? 'bg-emerald-500/20 ring-2 ring-emerald-400/70 animate-in slide-in-from-left-4 fade-in duration-300'
                                    : flash === 'updated'
                                        ? 'bg-amber-500/20 ring-2 ring-amber-400/70'
                                        : 'bg-white/[0.03]'
                            }`}
                        >
                            <div className="flex items-start gap-3">
                                <span className="shrink-0 min-w-[2.5rem] h-10 px-2 rounded-xl bg-orange-500 text-white text-xl font-black flex items-center justify-center tabular-nums">
                                    {line.quantity}
                                </span>
                                <div className="flex-1 min-w-0">
                                    <p className="text-lg sm:text-xl font-black leading-snug break-words">{line.name}</p>
                                    {line.modifiers && line.modifiers.length > 0 && (
                                        <ul className="mt-0.5 space-y-0.5">
                                            {line.modifiers.map((m, idx) => {
                                                const modQty = Number.isInteger(m.quantity) && m.quantity > 1 ? m.quantity : 1
                                                const modCents = (Number.isFinite(m.priceCents) ? m.priceCents : 0) * modQty
                                                return (
                                                    <li key={`${m.guid || m.name}-${idx}`} className="text-sm text-slate-300 flex justify-between gap-2">
                                                        <span className="truncate">• {modQty > 1 ? `${modQty}× ` : ''}{m.name}</span>
                                                        {modCents !== 0 && (
                                                            <span className="shrink-0 tabular-nums text-slate-400">
                                                                {modCents > 0 ? '+' : '−'}{formatUsdCents(Math.abs(modCents))}
                                                            </span>
                                                        )}
                                                    </li>
                                                )
                                            })}
                                        </ul>
                                    )}
                                    {line.notes && (
                                        <p className="mt-1 text-sm italic text-amber-300 break-words">
                                            {t('drive_thru.kore_note')}: {line.notes}
                                        </p>
                                    )}
                                </div>
                                <span className="shrink-0 text-lg sm:text-xl font-black tabular-nums">{formatUsdCents(line.lineTotalCents)}</span>
                            </div>
                        </div>
                    )
                })}

                {!isDriverPickup && ghosts.map(g => (
                    <div key={`ghost-${g.line.lineId}-${g.expiresAt}`} className="rounded-2xl px-3 py-2.5 bg-rose-500/15 ring-1 ring-rose-500/40 animate-out fade-out duration-1000 fill-mode-forwards">
                        <div className="flex items-center gap-3 line-through decoration-rose-400 decoration-2 text-rose-200/80">
                            <span className="shrink-0 min-w-[2.5rem] h-10 px-2 rounded-xl bg-rose-500/40 text-xl font-black flex items-center justify-center tabular-nums">
                                {g.line.quantity}
                            </span>
                            <p className="flex-1 min-w-0 text-lg font-black truncate">{g.line.name}</p>
                            <span className="shrink-0 text-lg font-black tabular-nums">{formatUsdCents(g.line.lineTotalCents)}</span>
                        </div>
                    </div>
                ))}
            </div>

            {/* Totales */}
            <div className="border-t-2 border-dashed border-slate-700 px-5 py-4 bg-black/40 space-y-1.5">
                <div className="flex justify-between text-base text-slate-300">
                    <span>{t('drive_thru.kore_subtotal')} · {t('drive_thru.kore_items_count', { count: itemCount })}</span>
                    <span className="tabular-nums font-bold">{formatUsdCents(totals.subtotalCents)}</span>
                </div>
                <div className="flex justify-between text-base text-slate-300">
                    <span>
                        {t('drive_thru.kore_tax')}
                        {ratePct !== null && ` (${ratePct.toFixed(2)}%)`}
                        {taxIsEstimate && (
                            <span className="ml-2 rounded-md bg-amber-500/20 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-300">
                                {t('drive_thru.kore_tax_estimated')}
                            </span>
                        )}
                    </span>
                    <span className="tabular-nums font-bold">{formatUsdCents(totals.taxCents)}</span>
                </div>
                <div className="flex justify-between items-end pt-1">
                    <span className="text-xl font-black uppercase tracking-wide">{t('drive_thru.kore_total')}</span>
                    <span className="text-4xl sm:text-5xl font-black tabular-nums text-emerald-400">{formatUsdCents(totals.totalCents)}</span>
                </div>
            </div>
        </div>
    )
}
