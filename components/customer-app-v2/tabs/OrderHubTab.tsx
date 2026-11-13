/**
 * @module components/customer-app-v2/tabs/OrderHubTab
 * @description Pestaña Ordenar de Tacos Gavilan App V2 con paridad completa frente a V1:
 * bolsa sincronizada con `/api/mobile/cart`, propina configurable, autocompletado real de dirección
 * para Delivery (`/api/mobile/address/autocomplete`), cotización financiera en vivo (`/api/mobile/order/quote`),
 * sesión de checkout Camino 1 (`/api/mobile/doordash/checkout-session`) con respaldo seguro a `order.online`,
 * buscador de estado de orden 3-State (`/api/mobile/order/status`) e historial de sesiones con marca de tiempo.
 *
 * @businessRules
 * - Todo enlace externo pasa por el validador allowlist `isAllowedExternalOrderUrl` dentro del controlador.
 * - Muestra desglose financiero transparente y distingue claramente cotización autoritativa Toast vs estimado.
 * - En historial de sesiones, muestra fecha/hora formateada (`openedAt`) en zona America/Los_Angeles.
 *
 * @dataFlow
 * - Consume `CustomerAppV2Controller` (`bagItems`, `quote`, `deliveryAddress`, `storefrontSession`, etc.).
 *
 * @notes
 * - Respeta las leyes Apple Guideline 3.1.3(e) y Google Play Payments Policy (bienes físicos).
 */

'use client'

import React from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  ExternalLink,
  MapPin,
  Minus,
  Navigation,
  Phone,
  Plus,
  RotateCcw,
  Search,
  ShoppingBag,
  Trash2,
  Truck,
} from 'lucide-react'
import type { CustomerAppV2Controller } from '../hooks/useCustomerAppV2'

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
    setWrapperResetModalOpen,
    wrapperNotice,
    wrapperWarning,
    bagItems,
    updateBagLineQuantity,
    clearBag,
    tipPercent,
    setTipPercent,
    quote,
    addressQuery,
    setAddressQuery,
    addressSuggestions,
    addressLoading,
    handleSelectAddressSuggestion,
    deliveryAddress,
    setDeliveryAddress,
    storefrontSession,
    handleStartStorefrontCheckout,
    launchWrappedOrderOnline,
    v2AccessToken,
    isDemoPreview,
    orderLookupId,
    setOrderLookupId,
    orderLookupLoading,
    orderLookupError,
    trackedOrderStatus,
    handleLookupOrderStatus,
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

  return (
    <div className="w-full h-full flex flex-col bg-[#121212] relative">
      {/* Row 1: Navigation & Reset Header */}
      <div className="px-3.5 py-2 bg-[#161618] border-b border-white/10 flex items-center justify-between gap-2 shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab('home')}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/8 hover:bg-white/15 text-white/90 text-[11px] font-bold transition-colors cursor-pointer"
        >
          <ArrowLeft size={12} />
          <span>{t('mobile_legal.v2_tab_home')}</span>
        </button>

        <div className="flex items-center gap-1.5 text-[10px] font-extrabold text-white/80 truncate">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              currentStoreStatus.isOpen ? 'bg-emerald-400' : 'bg-amber-400'
            }`}
          />
          <span className="truncate">
            {currentStore.cityTitle} • {currentStoreStatus.badgeText}
          </span>
        </div>

        <button
          type="button"
          onClick={() => setWrapperResetModalOpen(true)}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/8 hover:bg-white/15 text-white/80 border border-white/10 text-[10px] font-bold transition-colors cursor-pointer shrink-0"
        >
          <RotateCcw size={11} className="text-[#FDC82F]" />
          <span>{t('mobile_legal.wrapper_nav_reset')}</span>
        </button>
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
              <span>{currentStore.cityTitle}</span>
              <span className="text-[#FFC72C] font-extrabold font-sans truncate">
                {currentStore.crossStreets}
              </span>
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
        {/* Card 1: Live Bag & Quote Breakdown */}
        <div className="p-4 rounded-2xl bg-[#18181b] border border-white/10 space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="v2-gotham text-base text-white uppercase tracking-tight">
              {t('mobile_legal.v2_bag_title')}
            </h3>
            {bagItems.length > 0 && (
              <button
                type="button"
                onClick={clearBag}
                className="text-[10px] font-black uppercase tracking-wider text-red-400 hover:text-red-300 cursor-pointer"
              >
                {t('mobile_legal.v2_bag_clear_btn')}
              </button>
            )}
          </div>

          {bagItems.length === 0 ? (
            <div className="py-4 text-center space-y-2.5">
              <ShoppingBag size={28} className="mx-auto text-[#FFC72C]/75" />
              <p className="text-sm font-black text-white">
                {t('mobile_legal.v2_bag_empty_title')}
              </p>
              <p className="text-xs text-white/65 leading-relaxed">
                {t('mobile_legal.v2_bag_empty_desc')}
              </p>
              <div className="pt-2 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('home')}
                  className="w-full py-2.5 rounded-xl bg-[#DA291C] hover:bg-[#b81d13] text-white text-xs font-black uppercase tracking-wider cursor-pointer"
                >
                  {t('mobile_legal.v2_bag_browse_menu')}
                </button>
                <button
                  type="button"
                  onClick={() => launchWrappedOrderOnline(currentStore, fulfillmentMode)}
                  className="w-full py-2.5 rounded-xl bg-white/8 hover:bg-white/15 border border-[#FFC72C]/35 text-[#FFC72C] text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <ExternalLink size={13} />
                  <span>{t('mobile_legal.v2_checkout_direct_order_online_cta')}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Bag Lines */}
              <div className="space-y-2">
                {bagItems.map((line) => {
                  const modsUnit = line.modifiers.reduce((s, m) => s + (Number(m.price) || 0), 0)
                  const lineTotal = (line.unitPrice + modsUnit) * line.quantity
                  return (
                    <div
                      key={line.lineId}
                      className="p-3 rounded-xl bg-[#121214] border border-white/10 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-black text-white truncate">{line.name}</p>
                          {line.modifiers.length > 0 && (
                            <p className="text-[10.5px] text-white/60 mt-0.5">
                              {line.modifiers.map((m) => m.name).join(' · ')}
                            </p>
                          )}
                          {line.specialInstructions && (
                            <p className="text-[10px] text-[#FFC72C]/85 italic mt-0.5">
                              “{line.specialInstructions}”
                            </p>
                          )}
                        </div>
                        <span className="text-xs font-black text-[#FFC72C] shrink-0">
                          ${lineTotal.toFixed(2)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="inline-flex items-center gap-2 bg-black/50 border border-white/10 rounded-lg px-2 py-1">
                          <button
                            type="button"
                            onClick={() => updateBagLineQuantity(line.lineId, -1)}
                            aria-label={t('mobile_legal.v2_bag_remove')}
                            className="p-0.5 text-white/75 hover:text-white cursor-pointer"
                          >
                            {line.quantity <= 1 ? <Trash2 size={12} /> : <Minus size={12} />}
                          </button>
                          <span className="text-xs font-black text-white min-w-[16px] text-center">
                            {line.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateBagLineQuantity(line.lineId, 1)}
                            className="p-0.5 text-white/75 hover:text-white cursor-pointer"
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Delivery Address Autocomplete when Mode === delivery */}
              {fulfillmentMode === 'delivery' && (
                <div className="p-3 rounded-xl bg-black/40 border border-white/10 space-y-2.5">
                  <label className="block text-[10px] font-black uppercase tracking-wider text-[#FFC72C]">
                    {t('mobile_legal.v2_delivery_address_label')}
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={addressQuery}
                      onChange={(e) => {
                        setAddressQuery(e.target.value)
                        if (e.target.value.trim().length < 3) {
                          setDeliveryAddress((prev) => ({ ...prev, street: '', formattedAddress: '' }))
                        }
                      }}
                      placeholder={t('mobile_legal.v2_delivery_address_placeholder')}
                      className="w-full px-3 py-2 rounded-lg bg-[#1c1c1e] border border-white/15 text-xs text-white placeholder-white/40 focus:outline-none focus:border-[#FFC72C]"
                    />
                    {addressLoading && (
                      <span className="absolute right-2.5 top-2.5 text-[10px] text-[#FFC72C]">
                        ...
                      </span>
                    )}
                  </div>

                  {addressSuggestions.length > 0 && (
                    <div className="rounded-xl bg-[#1c1c1e] border border-[#FFC72C]/35 divide-y divide-white/10 max-h-40 overflow-y-auto">
                      {addressSuggestions.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => handleSelectAddressSuggestion(s)}
                          className="w-full px-3 py-2 text-left hover:bg-white/10 transition-colors cursor-pointer"
                        >
                          <p className="text-xs font-bold text-white truncate">{s.primaryText}</p>
                          <p className="text-[10px] text-white/60 truncate">{s.secondaryText}</p>
                        </button>
                      ))}
                    </div>
                  )}

                  {deliveryAddress.street && (
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={deliveryAddress.apartmentNumber}
                        onChange={(e) =>
                          setDeliveryAddress((prev) => ({
                            ...prev,
                            apartmentNumber: e.target.value,
                          }))
                        }
                        placeholder={t('mobile_legal.v2_delivery_apt_placeholder')}
                        className="px-2.5 py-1.5 rounded-lg bg-[#1c1c1e] border border-white/15 text-[11px] text-white placeholder-white/40"
                      />
                      <input
                        type="text"
                        value={deliveryAddress.instructions}
                        onChange={(e) =>
                          setDeliveryAddress((prev) => ({
                            ...prev,
                            instructions: e.target.value,
                          }))
                        }
                        placeholder={t('mobile_legal.v2_delivery_instructions_placeholder')}
                        className="px-2.5 py-1.5 rounded-lg bg-[#1c1c1e] border border-white/15 text-[11px] text-white placeholder-white/40"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Suggested Tip Selector */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-white/75">
                  {t('mobile_legal.v2_bag_tip_label')}
                </span>
                <div className="flex items-center gap-1">
                  {[0, 10, 15, 18].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => setTipPercent(pct)}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-black border cursor-pointer ${
                        tipPercent === pct
                          ? 'bg-[#FFC72C] text-[#121212] border-[#FFC72C]'
                          : 'bg-white/5 text-white/75 border-white/10'
                      }`}
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>

              {/* Financial Quote Summary */}
              <div className="pt-2 border-t border-white/10 space-y-1.5 text-xs">
                {quote.status === 'loading' && (
                  <p className="text-[11px] text-[#FFC72C] font-bold">
                    {t('mobile_legal.v2_bag_quote_loading')}
                  </p>
                )}
                <div className="flex justify-between text-white/75">
                  <span>{t('mobile_legal.v2_bag_subtotal')}</span>
                  <span>${quote.subtotal.toFixed(2)}</span>
                </div>
                {quote.taxAmount > 0 && (
                  <div className="flex justify-between text-white/75">
                    <span>{t('mobile_legal.v2_bag_tax')}</span>
                    <span>${quote.taxAmount.toFixed(2)}</span>
                  </div>
                )}
                {quote.deliveryFee > 0 && (
                  <div className="flex justify-between text-white/75">
                    <span>{t('mobile_legal.v2_bag_delivery_fee')}</span>
                    <span>${quote.deliveryFee.toFixed(2)}</span>
                  </div>
                )}
                {quote.serviceChargeTotal > 0 && (
                  <div className="flex justify-between text-white/75">
                    <span>{t('mobile_legal.v2_bag_service_fee')}</span>
                    <span>${quote.serviceChargeTotal.toFixed(2)}</span>
                  </div>
                )}
                {quote.tipAmount > 0 && (
                  <div className="flex justify-between text-white/75">
                    <span>{t('mobile_legal.v2_bag_tip_label')}</span>
                    <span>${quote.tipAmount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-black text-white pt-1 border-t border-white/10">
                  <span>{t('mobile_legal.v2_bag_total')}</span>
                  <span className="text-[#FFC72C]">${quote.totalAmount.toFixed(2)}</span>
                </div>
                <p className="text-[10px] text-white/50">
                  {quote.message || t('mobile_legal.v2_bag_quote_estimate_note')}
                </p>
              </div>

              {/* Checkout Action */}
              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  onClick={handleStartStorefrontCheckout}
                  disabled={storefrontSession.status === 'creating'}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#DA291C] to-[#b81d13] hover:from-[#e63225] hover:to-[#c92015] text-white text-xs font-black uppercase tracking-wider border border-[#FDC82F]/55 shadow-lg cursor-pointer disabled:opacity-60"
                >
                  {storefrontSession.status === 'creating'
                    ? t('mobile_legal.v2_checkout_storefront_creating')
                    : t('mobile_legal.v2_checkout_storefront_cta')}
                </button>

                {storefrontSession.message && (
                  <div className="p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/40 text-[11px] text-amber-200 leading-relaxed">
                    {storefrontSession.message}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => launchWrappedOrderOnline(currentStore, fulfillmentMode)}
                  className="w-full py-2.5 rounded-xl bg-white/8 hover:bg-white/15 border border-white/15 text-[#FFC72C] text-[11px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <ExternalLink size={12} />
                  <span>{t('mobile_legal.v2_checkout_direct_order_online_cta')}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Card 2: Live Order Status Lookup (Authenticated) */}
        {v2AccessToken && !isDemoPreview && (
          <div className="p-4 rounded-2xl bg-[#18181b] border border-white/10 space-y-2.5">
            <h4 className="text-xs font-black uppercase tracking-wider text-[#FFC72C]">
              {t('mobile_legal.v2_orders_tracker_title')}
            </h4>
            <form onSubmit={handleLookupOrderStatus} className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search size={13} className="absolute left-2.5 top-2.5 text-white/40" />
                <input
                  type="text"
                  value={orderLookupId}
                  onChange={(e) => setOrderLookupId(e.target.value)}
                  placeholder={t('mobile_legal.v2_orders_lookup_placeholder')}
                  className="w-full pl-8 pr-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white placeholder-white/40 focus:outline-none focus:border-[#FFC72C]"
                />
              </div>
              <button
                type="submit"
                disabled={orderLookupLoading || !orderLookupId.trim()}
                className="px-3 py-2 rounded-xl bg-[#DA291C] text-white text-[11px] font-black uppercase cursor-pointer disabled:opacity-50"
              >
                {t('mobile_legal.v2_orders_lookup_btn')}
              </button>
            </form>
            {orderLookupError && (
              <p className="text-[11px] text-amber-300">{orderLookupError}</p>
            )}
            {trackedOrderStatus && (
              <div className="p-3 rounded-xl bg-black/50 border border-[#FFC72C]/35 space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white/75">
                    {t('mobile_legal.v2_orders_active_status')}
                  </span>
                  <span className="font-black text-[#FFC72C]">
                    ${trackedOrderStatus.totalAmount.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap text-[10px] font-black">
                  <span className="px-2 py-0.5 rounded-full bg-white/10 text-white">
                    POS: {trackedOrderStatus.kitchenStatus}
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">
                    PAY: {trackedOrderStatus.paymentStatus}
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-[#FFC72C]/20 text-[#FFC72C]">
                    {trackedOrderStatus.channel}: {trackedOrderStatus.deliveryStatus}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Card 3: Confirmation & Support Actions */}
        <div className="p-4 rounded-2xl bg-[#18181b] border border-white/10 space-y-3">
          <h4 className="text-xs font-black uppercase tracking-wider text-white">
            {t('mobile_legal.wrapper_receipt_card_title')}
          </h4>
          <p className="text-[11px] text-white/70 leading-relaxed">
            {t('mobile_legal.wrapper_receipt_card_desc')}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <a
              href={`tel:${currentStore.phone.replace(/[^\d+]/g, '')}`}
              className="py-2 rounded-xl bg-white/8 hover:bg-white/15 border border-white/10 text-white text-[11px] font-bold flex items-center justify-center gap-1.5"
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
              className="py-2 rounded-xl bg-white/8 hover:bg-white/15 border border-white/10 text-[#FFC72C] text-[11px] font-bold flex items-center justify-center gap-1.5"
            >
              <Navigation size={12} />
              <span>{t('mobile_legal.wrapper_directions_btn')}</span>
            </a>
          </div>
        </div>

        {/* Card 4: Recent Store Sessions with Timestamp */}
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
                return (
                  <div
                    key={sess.id}
                    className="p-2.5 rounded-xl bg-black/45 border border-white/10 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-black text-white truncate">
                        {st.cityTitle} · {sess.mode.toUpperCase()}
                      </p>
                      <p className="text-[10px] text-white/55 truncate">
                        {t('mobile_legal.v2_orders_session_opened_at')} {formatSessionTime(sess.openedAt)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => launchWrappedOrderOnline(st, sess.mode)}
                      className="shrink-0 px-2.5 py-1.5 rounded-lg bg-[#DA291C] text-white text-[10px] font-black uppercase cursor-pointer"
                    >
                      {t('mobile_legal.v2_order_again_btn')}
                    </button>
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
