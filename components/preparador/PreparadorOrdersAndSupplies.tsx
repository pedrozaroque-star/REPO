/**
 * @module components/preparador/PreparadorOrdersAndSupplies
 * @description Panel derecho de la Tableta Preparador (`/inventory/preparador`) que aloja:
 *   1. Barra fija de pestañas `ÓRDENES [N] | INSUMOS [N]` (`48px`, siempre accesible).
 *   2. Dock Intercom Rápido de 1 fila (`50px`, cero truncación): `Café`, `Champurrado`, `Orden Pendiente`,
 *      con confirmación verde real (`callSuccessOrderIds`) y alerta roja reintentable (`callErrorOrderIds`).
 *   3. Riel de Comandas KDS FIFO (`1:1` con Toast KDS) con franja superior completa por canal
 *      (`COMEDOR` verde / `PARA LLEVAR` azul), reloj en vivo (`Hace Xm`), `Smart Auto-Timer (Slauson)`
 *      sin saltos de línea, toggle `Ocultar Bebidas`, y compatibilidad 100% con el radar de proximidad
 *      (`data-orders-hit-zone`, `data-order-card="true"`, `data-order-tap-id`).
 *   4. Pestaña `INSUMOS` con los **34 `ALIMENTOS`** organizados en 5 estaciones de cocina (incluyendo
 *      `Queso Fresco` y `Cebolla Asada`) + sub-pestaña **`DESECHABLES` (9)** + carrito inferior fijo con
 *      chips `-1`/`×`, botón sólido `ENVIAR A BODEGA (N)` y feedback visual real (éxito/error).
 */

'use client'

import React, { useState } from 'react'
import {
  AlertTriangle,
  Bell,
  BellRing,
  Check,
  CheckCircle2,
  Clock,
  Coffee,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  ShoppingBag,
  Trash2,
  Utensils,
  UtensilsCrossed,
  Volume2,
  X,
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { computeSmartOrderAutoCallPlan, formatCountdownMmSs, type AutoCallTimerConfig } from '@/lib/order-ready-auto-timer'

export interface SupplyStationGroup {
  id: string
  titleKey: string
  accentColor: string
  items: string[]
}

export const FOOD_STATION_GROUPS: SupplyStationGroup[] = [
  {
    id: 'cold',
    titleKey: 'prep.stationCold',
    accentColor: '#15803D',
    items: ['Guacamole', 'Crema', 'Mayonesa', 'Mulitas', 'Quesadillas'],
  },
  {
    id: 'steam',
    titleKey: 'prep.stationSteam',
    accentColor: '#B45309',
    items: ['Arroz', 'Cabeza', 'Lengua', 'Frijol molido'],
  },
  {
    id: 'griddle',
    titleKey: 'prep.stationGrillSalsas',
    accentColor: '#1D4ED8',
    items: [
      'Milaneza',
      'Salchicha',
      'Jamon',
      'Huevos',
      'Papelitos',
      'Queso Jack',
      'Queso Fresco',
      'Queso cotija',
      'Queso Nachos',
      'Cebolla y cilantro',
      'Salsa verde',
      'Salsa roja',
    ],
  },
  {
    id: 'meats',
    titleKey: 'prep.stationMeats',
    accentColor: '#C8371A',
    items: [
      'Asada',
      'Pastor',
      'Pollo',
      'Carnitas',
      'Chorizo',
      'Buche',
      'Cebolla Asada',
      'Frijoles de la Olla',
    ],
  },
  {
    id: 'bread',
    titleKey: 'prep.stationTortillas',
    accentColor: '#7C5A2B',
    items: ['Tortillas de maiz', 'Tortillas Burritos', 'Teleras', 'Chips', 'Manteca'],
  },
]

export const DISPOSABLE_ITEMS: string[] = [
  'Cover tacos',
  'Papel tortas',
  'Platos blancos',
  'Platos nachos',
  'Platos (3)',
  'Platos sopes',
  'Charolas rojas',
  'Vasos 4oz',
  'Vasos 8oz',
]

export interface ParsedLineItem {
  name: string
  quantity: number
  modifiers?: string[]
}

export interface PreparadorOrdersAndSuppliesProps {
  isDark: boolean
  hideCookingPanel: boolean
  mobileTab: 'parrilla' | 'insumos' | 'resumen'
  activeTab: 'alimentos' | 'ordenes'
  readyOrdersList: any[]
  callingOrderIds: Set<string>
  callSuccessOrderIds: Set<string>
  callErrorOrderIds: Set<string>
  hideDrinks: boolean
  isSmartAutoVoiceStore: boolean
  autoCallConfig: AutoCallTimerConfig
  smartNowMs: number
  elapsedNowMs: number
  cart: { name: string; qty: number }[]
  sending: boolean
  supplyFeedback: { type: 'success' | 'error'; message: string } | null
  ordersScrollContainerRef: React.RefObject<HTMLDivElement | null>
  shouldUseScrollSafeOrderTouch: boolean
  parseOrderItemsSummary: (raw: any) => ParsedLineItem[]
  isDrinkItem: (name: string) => boolean
  bindInstantTap: (key: string, action: () => void) => Record<string, any>
  bindForgivingTap: (key: string, action: () => void) => Record<string, any>
  bindOrderCardTap: (tapKey: string, action: () => void, scrollSafe: boolean) => Record<string, any>
  onSelectTab: (tab: 'alimentos' | 'ordenes') => void
  onToggleHideDrinks: () => void
  onCallOrder: (order: any) => void
  onProximityTouchStart: (e: React.TouchEvent<HTMLDivElement>) => void
  onProximityTouchMove: (e: React.TouchEvent<HTMLDivElement>) => void
  onProximityPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
  onAddToCart: (name: string) => void
  onDecreaseItem: (name: string) => void
  onRemoveItem: (name: string) => void
  onSendRequest: () => void
}

export default function PreparadorOrdersAndSupplies({
  isDark,
  hideCookingPanel,
  mobileTab,
  activeTab,
  readyOrdersList,
  callingOrderIds,
  callSuccessOrderIds,
  callErrorOrderIds,
  hideDrinks,
  isSmartAutoVoiceStore,
  autoCallConfig,
  smartNowMs,
  elapsedNowMs,
  cart,
  sending,
  supplyFeedback,
  ordersScrollContainerRef,
  shouldUseScrollSafeOrderTouch,
  parseOrderItemsSummary,
  isDrinkItem,
  bindInstantTap,
  bindForgivingTap,
  bindOrderCardTap,
  onSelectTab,
  onToggleHideDrinks,
  onCallOrder,
  onProximityTouchStart,
  onProximityTouchMove,
  onProximityPointerDown,
  onAddToCart,
  onDecreaseItem,
  onRemoveItem,
  onSendRequest,
}: PreparadorOrdersAndSuppliesProps) {
  const { t } = useLanguage()
  const [supplySubTab, setSupplySubTab] = useState<'alimentos' | 'desechables'>('alimentos')

  const cartTotalQty = cart.reduce((acc, item) => acc + item.qty, 0)
  const effectiveNow = isSmartAutoVoiceStore ? smartNowMs : elapsedNowMs

  const panelBg = isDark ? 'bg-[#111214] text-[#F5F2EB]' : 'bg-[#F3EFE7] text-[#171614]'
  const borderHair = isDark ? 'border-[#2C3038]' : 'border-[#D8D0C2]'
  const mutedText = isDark ? 'text-[#9CA3AF]' : 'text-[#5C574F]'

  // Grid adaptativo de órdenes: 1->1col, 2-4->2col, 5+ Split->3col, 5+ Solo Órdenes->4col
  const orderCount = readyOrdersList.length
  const isCompactCards = orderCount >= 5
  const ordersGridClass =
    orderCount <= 1
      ? 'grid-cols-1'
      : orderCount <= 4
        ? 'grid-cols-1 sm:grid-cols-2'
        : hideCookingPanel
          ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4'
          : 'grid-cols-2 lg:grid-cols-3'

  const intercomItems = [
    {
      id: 'bev-cafe',
      orderNumber: 'CAFE',
      label: t('prep.callCafeBtn'),
      accent: '#B45309',
      icon: Coffee,
    },
    {
      id: 'bev-champurrado',
      orderNumber: 'CHAMPURRADO',
      label: t('prep.callChampurradoBtn'),
      accent: '#C2590A',
      icon: Coffee,
    },
    {
      id: 'bev-orden-pendiente',
      orderNumber: 'ORDEN_PENDIENTE',
      label: t('prep.callOrdenPendienteBtn'),
      accent: '#15803D',
      icon: Bell,
    },
  ]

  const formatElapsedLabel = (createdIso: string | undefined) => {
    const ms = createdIso ? Date.parse(createdIso) : NaN
    if (!Number.isFinite(ms)) return t('prep.now')
    const mins = Math.max(0, Math.floor((effectiveNow - ms) / 60_000))
    if (mins < 1) return t('prep.now')
    return t('prep.agoMinutes').replace('{m}', String(mins))
  }

  const getWaitMinutes = (createdIso: string | undefined) => {
    const ms = createdIso ? Date.parse(createdIso) : NaN
    if (!Number.isFinite(ms)) return 0
    return Math.max(0, Math.floor((effectiveNow - ms) / 60_000))
  }

  const renderOrderCard = (ord: any, index: number) => {
    const orderId = String(ord.id)
    const isCalling = callingOrderIds.has(orderId)
    const isSent = callSuccessOrderIds.has(orderId)
    const isErr = callErrorOrderIds.has(orderId)
    const isForHere = String(ord.dining_option || '').toUpperCase() === 'FOR_HERE'
    const waitMins = getWaitMinutes(ord.created_at)
    const isOver10 = waitMins >= 10
    const isOver5 = waitMins >= 5 && waitMins < 10

    const parsedItems = parseOrderItemsSummary(ord.items_summary)
    const foodItems = parsedItems.filter((it) => !isDrinkItem(it.name))
    const drinkItems = parsedItems.filter((it) => isDrinkItem(it.name))
    const drinkQtySum = drinkItems.reduce((sum, d) => sum + Math.max(1, d.quantity || 1), 0)
    const visibleItems = hideDrinks ? foodItems : parsedItems

    // Smart Auto-Timer (piloto Slauson)
    let smartCountdownLabel: string | null = null
    let smartAlreadyCalled = false
    if (isSmartAutoVoiceStore) {
      if (ord.announced_at) {
        smartAlreadyCalled = true
      } else {
        const plan = computeSmartOrderAutoCallPlan(ord, index, autoCallConfig, smartNowMs)
        if (plan.remainingMs > 0) {
          smartCountdownLabel = formatCountdownMmSs(plan.remainingMs)
        }
      }
    }

    const channelBg = isForHere
      ? isDark
        ? 'bg-[#122E1F] text-[#86EFAC] border-b border-[#1E4D33]'
        : 'bg-[#E6F4EA] text-[#14532D] border-b border-[#B7DFC2]'
      : isDark
        ? 'bg-[#142442] text-[#93C5FD] border-b border-[#1E3A8A]'
        : 'bg-[#E8F0FE] text-[#1E3A8A] border-b border-[#BFDBFE]'

    const urgencyBorder = isErr
      ? 'border-[#C8371A] dark:border-[#EF4444]'
      : isOver10
        ? 'border-[#C8371A] dark:border-[#EF4444]'
        : isOver5
          ? 'border-[#B45309] dark:border-[#F59E0B]'
          : isDark
            ? 'border-[#2C3038]'
            : 'border-[#D8D0C2]'

    const footerStyle = isErr
      ? 'bg-[#C8371A] text-white'
      : isSent
        ? 'bg-[#15803D] text-white'
        : isCalling
          ? 'bg-[#B45309] text-white'
          : isSmartAutoVoiceStore && smartAlreadyCalled
            ? isDark
              ? 'bg-[#23272F] text-[#F5F2EB]'
              : 'bg-[#171614] text-white'
            : isSmartAutoVoiceStore && smartCountdownLabel
              ? 'bg-[#1D4ED8] text-white'
              : 'bg-[#15803D] text-white'

    const footerText = isErr
      ? t('prep.errorRetryShort')
      : isSent
        ? t('prep.orderCallSent')
        : isCalling
          ? t('prep.callingOrder')
          : isSmartAutoVoiceStore && smartAlreadyCalled
            ? t('prep.repeatCallOrder')
            : isSmartAutoVoiceStore && smartCountdownLabel
              ? t('prep.autoCallCompact').replace('{time}', smartCountdownLabel)
              : isCompactCards
                ? t('prep.callShort')
                : t('prep.callOrder')

    return (
      <button
        key={orderId}
        type="button"
        data-order-card="true"
        data-order-tap-id={`ord:${orderId}`}
        style={{ touchAction: shouldUseScrollSafeOrderTouch ? 'pan-y' : 'none' }}
        {...bindOrderCardTap(
          `ord:${orderId}`,
          () => onCallOrder(ord),
          shouldUseScrollSafeOrderTouch
        )}
        className={`relative rounded-2xl border-2 border-b-[4px] overflow-hidden flex flex-col justify-between text-left transition-transform active:translate-y-[1px] select-none cursor-pointer [&_*]:pointer-events-none ${urgencyBorder} ${
          isDark
            ? 'bg-[#1B1D21] border-b-[#090A0C] text-[#F5F2EB]'
            : 'bg-white border-b-[#BFB5A3] text-[#171614]'
        } ${isCompactCards ? 'min-h-[144px]' : 'min-h-[192px]'}`}
      >
        {/* Franja superior completa por canal (COMEDOR verde / PARA LLEVAR azul) */}
        <div className={`w-full h-[30px] px-2.5 flex items-center justify-between gap-1.5 shrink-0 ${channelBg}`}>
          <span className="inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-wide whitespace-nowrap shrink-0">
            {isForHere ? <Utensils className="w-3.5 h-3.5" /> : <ShoppingBag className="w-3.5 h-3.5" />}
            <span>{isForHere ? t('prep.forHereChannel') : t('prep.toGoChannel')}</span>
          </span>

          {isSmartAutoVoiceStore && smartAlreadyCalled ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-black text-[#15803D] dark:text-[#4ADE80] whitespace-nowrap shrink-0">
              <Check className="w-3.5 h-3.5" strokeWidth={3} />
              <span>{t('prep.calledShort')}</span>
            </span>
          ) : isSmartAutoVoiceStore && smartCountdownLabel ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-black tabular-nums whitespace-nowrap shrink-0">
              <Clock className="w-3 h-3" />
              <span>{smartCountdownLabel}</span>
            </span>
          ) : (
            <span
              className={`inline-flex items-center gap-1 text-[11px] font-extrabold tabular-nums whitespace-nowrap shrink-0 ${
                isOver10
                  ? 'text-[#C8371A] dark:text-[#FCA5A5]'
                  : isOver5
                    ? 'text-[#B45309] dark:text-[#FCD34D]'
                    : 'opacity-85'
              }`}
            >
              <Clock className="w-3 h-3" />
              <span>{formatElapsedLabel(ord.created_at)}</span>
            </span>
          )}
        </div>

        {/* Centro: Número gigante tabular + Cliente / Resumen */}
        <div className="flex-1 px-3 py-2 flex flex-col items-center justify-center text-center min-w-0 w-full">
          <div className="flex items-baseline justify-center gap-0.5 leading-none">
            <span className={`font-black ${isCompactCards ? 'text-xl' : 'text-3xl'} opacity-45`}>#</span>
            <span
              className={`font-black tabular-nums tracking-tight ${
                isCompactCards ? 'text-4xl xl:text-5xl' : 'text-5xl xl:text-6xl'
              }`}
            >
              {ord.order_number}
            </span>
          </div>

          {ord.customer_name && (
            <div className="mt-1 text-xs font-extrabold truncate max-w-full opacity-90">
              {ord.customer_name}
            </div>
          )}

          {visibleItems.length > 0 && (
            <div
              className={`mt-1 text-[11px] font-bold leading-snug line-clamp-2 max-w-full ${mutedText}`}
            >
              {visibleItems
                .slice(0, isCompactCards ? 2 : 3)
                .map((it) => `${it.quantity > 1 ? `${it.quantity} ` : ''}${it.name}`)
                .join(' · ')}
              {hideDrinks && drinkQtySum > 0 && (
                <span>
                  {' '}
                  · +{drinkQtySum} {t('prep.shortDrinkUnit')}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Pie táctil integrado (`38px`) */}
        <div
          className={`w-full h-[38px] px-2.5 flex items-center justify-center gap-1.5 text-xs font-black uppercase tracking-wide shrink-0 overflow-hidden ${footerStyle}`}
        >
          {isErr ? (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          ) : isSent ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : isCalling ? (
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          ) : (
            <Volume2 className="w-4 h-4 shrink-0" />
          )}
          <span className="truncate">{footerText}</span>
        </div>
      </button>
    )
  }

  return (
    <section
      className={`w-full lg:flex-1 flex-col min-h-0 overflow-hidden ${panelBg} ${
        mobileTab === 'insumos' ? 'flex flex-1' : 'hidden lg:flex'
      }`}
    >
      {/* BARRA DE PESTAÑAS `ÓRDENES | INSUMOS` (`48px`, siempre visible en Split; en Solo Órdenes se usa +Insumos arriba) */}
      {!hideCookingPanel && (
        <div
          data-no-proximity="true"
          className={`h-[48px] px-3 pl-4 border-b flex items-center gap-2 shrink-0 ${borderHair}`}
        >
          <button
            type="button"
            {...bindInstantTap('tab:ordenes', () => onSelectTab('ordenes'))}
            className={`flex-1 h-[38px] rounded-xl text-xs sm:text-sm font-black uppercase tracking-wide flex items-center justify-center gap-2 cursor-pointer transition-colors touch-manipulation ${
              activeTab === 'ordenes'
                ? isDark
                  ? 'bg-[#122E1F] text-[#86EFAC] border-2 border-[#22C55E]'
                  : 'bg-[#E6F4EA] text-[#14532D] border-2 border-[#15803D]'
                : isDark
                  ? 'bg-[#1B1D21] text-[#9CA3AF] border border-[#2C3038]'
                  : 'bg-[#E8E2D6] text-[#5C574F] border border-[#D8D0C2]'
            }`}
          >
            <BellRing className="w-4 h-4 shrink-0" />
            <span>{t('prep.ordersTab')}</span>
            {orderCount > 0 && (
              <span className="px-2 py-0.5 rounded-md bg-[#15803D] text-white text-[11px] font-black tabular-nums">
                {orderCount}
              </span>
            )}
          </button>

          <button
            type="button"
            {...bindInstantTap('tab:alimentos', () => onSelectTab('alimentos'))}
            className={`flex-1 h-[38px] rounded-xl text-xs sm:text-sm font-black uppercase tracking-wide flex items-center justify-center gap-2 cursor-pointer transition-colors touch-manipulation ${
              activeTab === 'alimentos'
                ? isDark
                  ? 'bg-[#33230B] text-[#FCD34D] border-2 border-[#F59E0B]'
                  : 'bg-[#FEF3C7] text-[#92400E] border-2 border-[#B45309]'
                : isDark
                  ? 'bg-[#1B1D21] text-[#9CA3AF] border border-[#2C3038]'
                  : 'bg-[#E8E2D6] text-[#5C574F] border border-[#D8D0C2]'
            }`}
          >
            <UtensilsCrossed className="w-4 h-4 shrink-0" />
            <span>{t('prep.insumos')}</span>
            {cartTotalQty > 0 && (
              <span className="px-2 py-0.5 rounded-md bg-[#C8371A] text-white text-[11px] font-black tabular-nums">
                {cartTotalQty}
              </span>
            )}
          </button>
        </div>
      )}

      {/* CONTENIDO PRINCIPAL: ÓRDENES vs INSUMOS */}
      {activeTab === 'ordenes' ? (
        <div
          className={`flex-1 flex flex-col min-h-0 overflow-hidden overscroll-y-contain px-3 pt-2 pb-2 ${
            hideCookingPanel ? 'lg:pl-5' : 'lg:pl-4'
          }`}
        >
          {/* Sub-cabecera compacta de Órdenes + Toggle Ocultar Bebidas */}
          <div
            data-no-proximity="true"
            className="flex items-center justify-between gap-2 pb-2 shrink-0"
          >
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="text-xs sm:text-sm font-black uppercase tracking-wide truncate">
                {t('prep.readyOrdersTitle')}
              </h3>
              <span className="px-2 py-0.5 rounded-md bg-[#15803D] text-white text-xs font-black tabular-nums shrink-0">
                {orderCount}
              </span>
              {isSmartAutoVoiceStore && (
                <span
                  className={`hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-black whitespace-nowrap ${
                    isDark
                      ? 'bg-[#142442] text-[#93C5FD] border border-[#1E3A8A]'
                      : 'bg-[#E8F0FE] text-[#1E3A8A] border border-[#BFDBFE]'
                  }`}
                >
                  <Clock className="w-3 h-3" />
                  <span>{t('prep.smartAutoVoiceActiveBadge')}</span>
                </span>
              )}
            </div>

            <button
              type="button"
              {...bindInstantTap('ord:toggle-drinks', onToggleHideDrinks)}
              className={`h-8 px-2.5 rounded-lg text-[11px] font-black inline-flex items-center gap-1.5 shrink-0 cursor-pointer active:scale-95 border ${
                isDark
                  ? 'bg-[#1B1D21] border-[#2C3038] text-[#D1D5DB]'
                  : 'bg-[#E8E2D6] border-[#CFC6B4] text-[#3F3B35]'
              }`}
            >
              {hideDrinks ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              <span className="whitespace-nowrap">
                {hideDrinks ? t('prep.drinksHidden') : t('prep.drinksVisible')}
              </span>
            </button>
          </div>

          {/* ZONA TÁCTIL CON RADAR DE PROXIMIDAD: Dock Intercom (1 fila 50px) + Riel KDS FIFO */}
          <div
            data-orders-hit-zone="true"
            onTouchStart={onProximityTouchStart}
            onTouchMove={onProximityTouchMove}
            onPointerDown={onProximityPointerDown}
            className="flex-1 flex flex-col min-h-0 overflow-hidden gap-2.5"
          >
            {/* DOCK INTERCOM RÁPIDO 1 FILA (`50px`, CERO TRUNCACIÓN, CON ESTADO REAL DE ERROR) */}
            <div className="grid grid-cols-3 gap-2 shrink-0">
              {intercomItems.map((bev) => {
                const isCalling = callingOrderIds.has(bev.id)
                const isSent = callSuccessOrderIds.has(bev.id)
                const isErr = callErrorOrderIds.has(bev.id)
                const IconComp = bev.icon
                return (
                  <button
                    key={bev.id}
                    type="button"
                    data-order-card="true"
                    data-order-tap-id={`bev:${bev.id}`}
                    style={{
                      touchAction: 'none',
                      borderLeftWidth: isSent || isErr ? '1px' : '4px',
                      borderLeftColor: isSent || isErr ? undefined : bev.accent,
                    }}
                    {...bindOrderCardTap(
                      `bev:${bev.id}`,
                      () => onCallOrder({ id: bev.id, order_number: bev.orderNumber, dining_option: 'TOGO' }),
                      false
                    )}
                    className={`h-[50px] px-2.5 rounded-xl border border-b-[3px] flex items-center justify-between gap-1.5 overflow-hidden transition-transform active:translate-y-[1px] select-none cursor-pointer [&_*]:pointer-events-none ${
                      isErr
                        ? 'bg-[#C8371A] text-white border-[#9A2711] border-b-[#7F1D1D]'
                        : isSent
                          ? 'bg-[#15803D] text-white border-[#0E4F26] border-b-[#0B3B1D]'
                          : isCalling
                            ? 'bg-[#B45309] text-white border-[#92400E] border-b-[#78350F]'
                            : isDark
                              ? 'bg-[#1B1D21] text-[#F5F2EB] border-[#2C3038] border-b-[#090A0C]'
                              : 'bg-white text-[#171614] border-[#D8D0C2] border-b-[#BFB5A3]'
                    }`}
                  >
                    <span className="inline-flex items-center gap-1.5 min-w-0">
                      <IconComp className="w-4 h-4 shrink-0" />
                      <span className="text-xs sm:text-sm font-black tracking-tight truncate">
                        {isErr
                          ? t('prep.errorRetryShort')
                          : isSent
                            ? t('prep.orderCallSent')
                            : isCalling
                              ? t('prep.callingOrder')
                              : bev.label}
                      </span>
                    </span>
                    {isErr ? (
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                    ) : isSent ? (
                      <Check className="w-4 h-4 shrink-0" strokeWidth={3} />
                    ) : isCalling ? (
                      <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    ) : (
                      <Volume2 className="w-4 h-4 shrink-0 opacity-65" />
                    )}
                  </button>
                )
              })}
            </div>

            {/* CUADRÍCULA DE ÓRDENES EN VIVO */}
            <div
              ref={ordersScrollContainerRef}
              className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain pb-16 lg:pb-1 pr-0.5"
            >
              {orderCount === 0 ? (
                <div
                  className={`h-full min-h-[220px] rounded-2xl border-2 border-dashed flex flex-col items-center justify-center text-center p-6 ${
                    isDark
                      ? 'border-[#2C3038] bg-[#16181C]/60'
                      : 'border-[#D8D0C2] bg-white/70'
                  }`}
                >
                  <div
                    className={`w-12 h-12 rounded-full flex items-center justify-center mb-3 ${
                      isDark ? 'bg-[#122E1F] text-[#4ADE80]' : 'bg-[#E6F4EA] text-[#15803D]'
                    }`}
                  >
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <p className="text-base font-black">{t('prep.readyOrdersEmpty')}</p>
                  <p className={`text-xs font-medium mt-1 max-w-sm ${mutedText}`}>
                    {t('prep.readyOrdersEmptySub')}
                  </p>
                </div>
              ) : (
                <div className={`grid gap-2.5 ${ordersGridClass}`}>
                  {readyOrdersList.map((ord, idx) => renderOrderCard(ord, idx))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* PESTAÑA INSUMOS: 34 ALIMENTOS (5 estaciones) + 9 DESECHABLES + CARRITO FIJO INFERIOR */
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Sub-tabs ALIMENTOS (34) | DESECHABLES (9) */}
          <div
            data-no-proximity="true"
            className={`px-3 pl-4 py-2 border-b flex items-center justify-between gap-2 shrink-0 ${borderHair}`}
          >
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSupplySubTab('alimentos')}
                className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wide cursor-pointer ${
                  supplySubTab === 'alimentos'
                    ? isDark
                      ? 'bg-[#F5F2EB] text-[#111214]'
                      : 'bg-[#171614] text-white'
                    : isDark
                      ? 'bg-[#1B1D21] text-[#9CA3AF] border border-[#2C3038]'
                      : 'bg-[#E8E2D6] text-[#5C574F] border border-[#D8D0C2]'
                }`}
              >
                {t('prep.foodItems')} (34)
              </button>
              <button
                type="button"
                onClick={() => setSupplySubTab('desechables')}
                className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wide cursor-pointer ${
                  supplySubTab === 'desechables'
                    ? isDark
                      ? 'bg-[#F5F2EB] text-[#111214]'
                      : 'bg-[#171614] text-white'
                    : isDark
                      ? 'bg-[#1B1D21] text-[#9CA3AF] border border-[#2C3038]'
                      : 'bg-[#E8E2D6] text-[#5C574F] border border-[#D8D0C2]'
                }`}
              >
                {t('prep.disposables')} (9)
              </button>
            </div>
            <span className={`hidden sm:inline text-[11px] font-bold ${mutedText}`}>
              {t('prep.tapToAddSupplies')}
            </span>
          </div>

          {/* Feedback visual real al enviar pedido a Cocina Trasera */}
          {supplyFeedback && (
            <div
              className={`mx-3 mt-2 px-3 py-2 rounded-xl text-xs font-black flex items-center gap-2 shrink-0 ${
                supplyFeedback.type === 'success'
                  ? 'bg-[#15803D] text-white'
                  : 'bg-[#C8371A] text-white'
              }`}
            >
              {supplyFeedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0" />
              )}
              <span>{supplyFeedback.message}</span>
            </div>
          )}

          {/* Grid de Insumos agrupados por estación */}
          <div className="flex-1 min-h-0 overflow-y-auto px-3 pl-4 py-2.5 space-y-3.5 pb-6">
            {supplySubTab === 'alimentos' ? (
              FOOD_STATION_GROUPS.map((group) => (
                <div key={group.id} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-1 h-3.5 rounded-full shrink-0"
                      style={{ backgroundColor: group.accentColor }}
                    />
                    <span className={`text-[11px] font-black uppercase tracking-wider ${mutedText}`}>
                      {t(group.titleKey)} ({group.items.length})
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
                    {group.items.map((name) => {
                      const inCart = cart.find((c) => c.name === name)
                      return (
                        <button
                          key={name}
                          type="button"
                          {...bindForgivingTap(`alim:${name}`, () => onAddToCart(name))}
                          style={{
                            borderLeftWidth: '4px',
                            borderLeftColor: group.accentColor,
                          }}
                          className={`relative min-h-[54px] px-2.5 py-2 rounded-xl border border-b-[3px] flex items-center justify-center text-center transition-transform active:translate-y-[1px] select-none cursor-pointer touch-manipulation ${
                            inCart
                              ? isDark
                                ? 'bg-[#2A261E] border-[#F59E0B] border-b-[#92400E] text-[#F5F2EB]'
                                : 'bg-[#EAE3D5] border-[#171614] border-b-[#171614] text-[#171614]'
                              : isDark
                                ? 'bg-[#1B1D21] border-[#2C3038] border-b-[#090A0C] text-[#F5F2EB]'
                                : 'bg-white border-[#D8D0C2] border-b-[#BFB5A3] text-[#171614]'
                          }`}
                        >
                          <span className="text-xs sm:text-sm font-extrabold leading-tight break-words">
                            {name}
                          </span>
                          {inCart && inCart.qty > 0 && (
                            <span className="absolute top-1 right-1 min-w-[22px] h-[22px] px-1 rounded-full bg-[#C8371A] text-white text-[11px] font-black tabular-nums flex items-center justify-center">
                              {inCart.qty}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))
            ) : (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-1 h-3.5 rounded-full bg-[#5C574F] shrink-0" />
                  <span className={`text-[11px] font-black uppercase tracking-wider ${mutedText}`}>
                    {t('prep.stationDisposables')} ({DISPOSABLE_ITEMS.length})
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
                  {DISPOSABLE_ITEMS.map((name) => {
                    const inCart = cart.find((c) => c.name === name)
                    return (
                      <button
                        key={name}
                        type="button"
                        {...bindForgivingTap(`des:${name}`, () => onAddToCart(name))}
                        style={{ borderLeftWidth: '4px', borderLeftColor: '#6B7280' }}
                        className={`relative min-h-[54px] px-2.5 py-2 rounded-xl border border-b-[3px] flex items-center justify-center text-center transition-transform active:translate-y-[1px] select-none cursor-pointer touch-manipulation ${
                          inCart
                            ? isDark
                              ? 'bg-[#2A261E] border-[#F59E0B] border-b-[#92400E] text-[#F5F2EB]'
                              : 'bg-[#EAE3D5] border-[#171614] border-b-[#171614] text-[#171614]'
                            : isDark
                              ? 'bg-[#1B1D21] border-[#2C3038] border-b-[#090A0C] text-[#F5F2EB]'
                              : 'bg-white border-[#D8D0C2] border-b-[#BFB5A3] text-[#171614]'
                        }`}
                      >
                        <span className="text-xs sm:text-sm font-extrabold leading-tight break-words">
                          {name}
                        </span>
                        {inCart && inCart.qty > 0 && (
                          <span className="absolute top-1 right-1 min-w-[22px] h-[22px] px-1 rounded-full bg-[#C8371A] text-white text-[11px] font-black tabular-nums flex items-center justify-center">
                            {inCart.qty}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Carrito inferior fijo con chips (-1 y eliminar ×) + botón sólido ENVIAR A BODEGA */}
          {cart.length > 0 && (
            <div
              data-no-proximity="true"
              className={`px-3 pl-4 py-2.5 border-t flex items-center gap-2.5 shrink-0 pb-[calc(70px+env(safe-area-inset-bottom))] lg:pb-2.5 ${
                isDark ? 'bg-[#181A1F] border-[#2C3038]' : 'bg-white border-[#D8D0C2]'
              }`}
            >
              <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto py-0.5">
                {cart.map((c) => (
                  <div
                    key={c.name}
                    className={`inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-lg border shrink-0 ${
                      isDark
                        ? 'bg-[#111214] border-[#2C3038] text-[#F5F2EB]'
                        : 'bg-[#F3EFE7] border-[#D8D0C2] text-[#171614]'
                    }`}
                  >
                    <button
                      type="button"
                      {...bindInstantTap(`cart-dec:${c.name}`, () => onDecreaseItem(c.name))}
                      title="-1"
                      className={`w-7 h-7 rounded-md text-xs font-black tabular-nums flex items-center justify-center cursor-pointer ${
                        isDark ? 'bg-[#23272F] text-[#F5F2EB]' : 'bg-white border border-[#D8D0C2] text-[#171614]'
                      }`}
                    >
                      {c.qty}
                    </button>
                    <span className="text-xs font-extrabold whitespace-nowrap">{c.name}</span>
                    <button
                      type="button"
                      {...bindInstantTap(`cart-rm:${c.name}`, () => onRemoveItem(c.name))}
                      aria-label={`Remove ${c.name}`}
                      className="w-7 h-7 rounded-full bg-[#C8371A] hover:bg-[#A82D15] text-white flex items-center justify-center cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" strokeWidth={3} />
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                disabled={sending}
                {...bindInstantTap('cart:send', onSendRequest)}
                className="h-12 px-5 rounded-xl bg-[#C8371A] hover:bg-[#A82D15] border-b-[3px] border-[#7F1D1D] active:translate-y-[1px] text-white text-xs sm:text-sm font-black uppercase tracking-wide whitespace-nowrap inline-flex items-center gap-2 shrink-0 cursor-pointer disabled:opacity-50 touch-manipulation"
              >
                {sending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4 hidden" />
                )}
                <span>
                  {t('prep.sendToBackKitchen')} ({cartTotalQty})
                </span>
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
