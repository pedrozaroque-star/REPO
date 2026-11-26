/**
 * @module components/customer-app-v2/tabs/OrderHubTab
 * @description Pestaña Ordenar de Tacos Gavilan App V2: Hub de Pedido Directo verificado por sucursal.
 * Presenta la sucursal activa con nombre canónico de cara al cliente (`formatCustomerStoreName`),
 * estado en vivo Abierto/Cerrado en `America/Los_Angeles`, selector limpio Pickup / Delivery sin modales
 * falsos de recarga, enlace genuino `<a target="_blank" rel="noopener noreferrer">` al portal oficial
 * de pedidos de la sucursal, acceso rápido al Explorador de Menú en Vivo, tarjeta de Soporte/Llamada
 * directa e historial reciente de sucursales con marca de tiempo.
 *
 * @businessRules
 * - Cero carritos sin salida, cero botones de `order_session` rotos, cero avisos técnicos de Toast/DoorDash/order.online.
 * - Todo enlace externo pasa por `buildBranchOrderUrl` (lista blanca HTTPS `isAllowedExternalOrderUrl`).
 * - Sucursales #5, #6 y #7 de Los Ángeles SIEMPRE formateadas con `formatCustomerStoreName(store, lang)`.
 * - Cumple Apple Guideline 3.1.3(e) y Google Play Payments Policy (bienes físicos preparados en restaurante).
 *
 * @dataFlow
 * - Consume `CustomerAppV2Controller` (`currentStore`, `currentStoreStatus`, `fulfillmentMode`,
 *   `currentOrderOnlineUrl`, `buildBranchOrderUrl`, `recordOrderHandoff`, `recentOrderSessions`).
 *
 * @notes
 * - 2026-11-24: Reconstruido como Hub de Pedido Directo 100% honesto eliminando teatro de bolsa/checkout y recarga falsa.
 */

'use client'

import React from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Clock,
  ExternalLink,
  MapPin,
  Navigation,
  Phone,
  ShieldCheck,
  ShoppingBag,
  Truck,
  UtensilsCrossed,
} from 'lucide-react'
import type { CustomerAppV2Controller } from '../hooks/useCustomerAppV2'
import { formatCustomerStoreName, getCustomerStoreCrossStreets } from '@/lib/customer-store-names'

export function OrderHubTab({ ctrl }: { ctrl: CustomerAppV2Controller }) {
  const {
    lang,
    t,
    setActiveTab,
    currentStore,
    currentStoreStatus,
    fulfillmentMode,
    handleSelectOrderMode,
    setStoreModalOpen,
    wrapperNotice,
    wrapperWarning,
    currentOrderOnlineUrl,
    buildBranchOrderUrl,
    recordOrderHandoff,
    recentOrderSessions,
    stores,
    handleClearRecentOrderSessions,
  } = ctrl

  const formatSessionTime = (iso: string) => {
    try {
      return new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'es-MX', {
        timeZone: 'America/Los_Angeles',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(iso))
    } catch {
      return iso
    }
  }

  const branchDisplayName = formatCustomerStoreName(currentStore, lang)
  const branchCrossStreets = ![5, 6, 7].includes(currentStore.id)
    ? getCustomerStoreCrossStreets(currentStore, lang) || currentStore.crossStreets
    : null

  const primaryCtaLabel =
    fulfillmentMode === 'delivery'
      ? `${t('mobile_legal.v2_home_quick_order_delivery')} ${branchDisplayName}`
      : `${t('mobile_legal.v2_home_quick_order_pickup')} ${branchDisplayName}`

  return (
    <div className="w-full h-full flex flex-col bg-[#121212] relative">
      {/* Row 1: Compact Navigation Header */}
      <div className="px-3.5 py-2 bg-[#161618] border-b border-white/10 flex items-center justify-between gap-2 shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab('home')}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/8 hover:bg-white/15 text-white/90 text-[11px] font-bold transition-colors cursor-pointer"
        >
          <ArrowLeft size={12} />
          <span>{t('mobile_legal.v2_tab_home')}</span>
        </button>

        <div className="flex items-center gap-1.5 text-[10px] font-extrabold text-white/85 truncate">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              currentStoreStatus.isOpen ? 'bg-emerald-400' : 'bg-amber-400'
            }`}
          />
          <span className="truncate">
            {branchDisplayName} · {currentStoreStatus.badgeText}
          </span>
        </div>
      </div>

      {/* Row 2: Active Store & Mode Switch */}
      <div className="px-3.5 py-2.5 bg-[#1c1c1e] border-b border-white/10 flex items-center justify-between gap-2 shrink-0">
        <button
          type="button"
          onClick={() => setStoreModalOpen(true)}
          className="min-w-0 flex-1 flex items-center gap-2 text-left px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-colors cursor-pointer"
        >
          <MapPin size={13} className="text-[#FDC82F] shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[9px] font-extrabold uppercase tracking-wider text-white/55">
              {t('mobile_legal.wrapper_active_store_label')}
            </div>
            <div className="text-xs font-black text-white truncate flex items-center gap-1.5">
              <span className="truncate">{branchDisplayName}</span>
              {branchCrossStreets && (
                <span className="text-[#FFC72C] font-extrabold font-sans truncate">
                  {branchCrossStreets}
                </span>
              )}
            </div>
          </div>
          <ChevronDown size={13} className="text-[#FDC82F] shrink-0" />
        </button>

        <div className="flex items-center gap-1 p-1 rounded-xl bg-black/40 border border-white/10 shrink-0">
          <button
            type="button"
            onClick={() => handleSelectOrderMode('pickup')}
            className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1 ${
              fulfillmentMode === 'pickup'
                ? 'bg-[#DA291C] text-white shadow'
                : 'text-white/65 hover:text-white'
            }`}
          >
            <ShoppingBag size={11} />
            <span>{t('mobile_legal.v2_pickup_short')}</span>
          </button>
          <button
            type="button"
            onClick={() => handleSelectOrderMode('delivery')}
            className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1 ${
              fulfillmentMode === 'delivery'
                ? 'bg-[#DA291C] text-white shadow'
                : 'text-white/65 hover:text-white'
            }`}
          >
            <Truck size={11} />
            <span>{t('mobile_legal.v2_delivery_short')}</span>
          </button>
        </div>
      </div>

      {/* Notices */}
      {wrapperNotice && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs font-bold flex items-center gap-2 shrink-0">
          <Check size={14} className="shrink-0" />
          <span>{wrapperNotice}</span>
        </div>
      )}
      {wrapperWarning && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-xl bg-red-500/15 border border-red-500/40 text-red-300 text-xs font-bold flex items-center gap-2 shrink-0">
          <AlertTriangle size={14} className="shrink-0" />
          <span>{wrapperWarning}</span>
        </div>
      )}

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-4 pb-24">
        {/* Card 1: Branded Direct Branch Handoff */}
        <div className="rounded-2xl overflow-hidden bg-gradient-to-b from-[#230609] via-[#18181b] to-[#141416] border border-[#FFC72C]/45 shadow-[0_14px_38px_rgba(0,0,0,0.55)]">
          <div className="p-4 space-y-3.5">
            <div className="flex items-center gap-3">
              <img
                src="/logo.png?v=75"
                alt="Tacos Gavilan"
                className="w-12 h-12 object-contain shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#FFC72C]">
                  {t('mobile_legal.v2_order_hub_eyebrow')}
                </p>
                <h3 className="v2-outfit text-base font-black text-white leading-tight truncate mt-0.5">
                  Tacos Gavilan — {branchDisplayName}
                </h3>
                {branchCrossStreets && (
                  <p className="text-[11px] font-bold text-[#FFC72C] truncate">
                    {branchCrossStreets}
                  </p>
                )}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-black/45 border border-white/10 space-y-1.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 font-black ${
                    currentStoreStatus.isOpen ? 'text-emerald-400' : 'text-amber-400'
                  }`}
                >
                  <Clock size={12} />
                  <span>{currentStoreStatus.badgeText}</span>
                </span>
                <span className="text-[11px] font-semibold text-white/75">
                  {currentStoreStatus.todayHours}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-white/75 text-[11px]">
                <MapPin size={12} className="text-[#FFC72C] shrink-0" />
                <span className="truncate">{currentStore.address}</span>
              </div>
            </div>

            <p className="text-[11.5px] text-white/75 leading-relaxed flex items-start gap-2">
              <ShieldCheck size={14} className="text-emerald-400 shrink-0 mt-0.5" />
              <span>{t('mobile_legal.v2_order_hub_ready_sub')}</span>
            </p>

            {/* Primary Genuine Anchor CTA (No popup-blocked window.open) */}
            <div className="space-y-2 pt-1">
              <a
                href={currentOrderOnlineUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => recordOrderHandoff(currentStore, fulfillmentMode)}
                className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-[#DA291C] to-[#b81d13] hover:from-[#e63225] hover:to-[#c92015] text-white text-xs font-black uppercase tracking-wider border border-[#FFC72C]/60 shadow-lg flex items-center justify-center gap-2 text-center transition-all"
              >
                <span className="truncate">{primaryCtaLabel}</span>
                <ArrowRight size={14} className="text-[#FFC72C] shrink-0" />
              </a>

              <button
                type="button"
                onClick={() => setActiveTab('home')}
                className="w-full py-2.5 px-4 rounded-xl bg-white/8 hover:bg-white/15 border border-white/15 text-[#FFC72C] text-[11px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <UtensilsCrossed size={13} />
                <span>{t('mobile_legal.v2_order_hub_browse_menu_btn')}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Card 2: Already Ordered? Direct Support & Tracking */}
        <div className="p-4 rounded-2xl bg-[#18181b] border border-white/10 space-y-3">
          <h4 className="text-xs font-black uppercase tracking-wider text-white">
            {t('mobile_legal.v2_order_support_title')}
          </h4>
          <p className="text-[11.5px] text-white/75 leading-relaxed">
            {t('mobile_legal.v2_order_support_desc')}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <a
              href={`tel:${currentStore.phone.replace(/[^\d+]/g, '')}`}
              className="py-2.5 rounded-xl bg-white/8 hover:bg-white/15 border border-white/10 text-white text-[11px] font-bold flex items-center justify-center gap-1.5"
            >
              <Phone size={12} className="text-[#FFC72C]" />
              <span>{t('mobile_legal.wrapper_call_store_support')}</span>
            </a>
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
                currentStore.address
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="py-2.5 rounded-xl bg-white/8 hover:bg-white/15 border border-white/10 text-[#FFC72C] text-[11px] font-bold flex items-center justify-center gap-1.5"
            >
              <Navigation size={12} />
              <span>{t('mobile_legal.wrapper_directions_btn')}</span>
            </a>
          </div>
        </div>

        {/* Card 3: Recent Store Visits with Timestamp */}
        <div className="p-4 rounded-2xl bg-[#18181b] border border-white/10 space-y-2.5">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-black uppercase tracking-wider text-white">
              {t('mobile_legal.wrapper_recent_sessions_title')}
            </h4>
            {recentOrderSessions.length > 0 && (
              <button
                type="button"
                onClick={handleClearRecentOrderSessions}
                className="text-[10px] font-bold text-red-400 hover:text-red-300 cursor-pointer"
              >
                {t('mobile_legal.v2_clear_history_btn')}
              </button>
            )}
          </div>

          {recentOrderSessions.length === 0 ? (
            <p className="text-[11px] text-white/55">
              {t('mobile_legal.wrapper_recent_sessions_empty')}
            </p>
          ) : (
            <div className="space-y-2">
              {recentOrderSessions.map((sess) => {
                const st = stores.find((s) => s.id === sess.storeId) || currentStore
                const sessionHref = buildBranchOrderUrl(st, sess.mode)
                return (
                  <div
                    key={sess.id}
                    className="p-2.5 rounded-xl bg-black/45 border border-white/10 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-black text-white truncate">
                        {formatCustomerStoreName(st, lang)} · {sess.mode.toUpperCase()}
                      </p>
                      <p className="text-[10px] text-white/55 truncate">
                        {t('mobile_legal.v2_orders_session_opened_at')} {formatSessionTime(sess.openedAt)}
                      </p>
                    </div>
                    <a
                      href={sessionHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => recordOrderHandoff(st, sess.mode)}
                      className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#DA291C] hover:bg-[#b81d13] text-white text-[10px] font-black uppercase"
                    >
                      <span>{t('mobile_legal.v2_order_again_btn')}</span>
                      <ExternalLink size={10} />
                    </a>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
