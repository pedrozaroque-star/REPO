/**
 * @module app/ordenar/page
 * @description Portal Público Oficial de Pedidos de Tacos Gavilan (`/ordenar`).
 * Experiencia web móvil-primero 100% pública (sin requerir sesión administrativa de TEG),
 * bilingüe (Inglés por defecto con cambio en 1 toque EN/ES usando diccionarios de `lib/i18n.tsx`),
 * con selector de las 15 sucursales del Sur de California, localizador GPS en primer plano
 * ("Find Nearest / Sucursal Más Cercana" en memoria sin envío a servidor), horarios reales en vivo
 * en `America/Los_Angeles` (incluyendo turnos nocturnos post-medianoche), conmutador Pickup / Delivery
 * y enlaces directos verificados `<a target="_blank" rel="noopener noreferrer">` al portal oficial
 * de cada sucursal.
 *
 * @businessRules
 * - Marca oficial estrictamente **Tacos Gavilan**; moneda `USD`; cero emojis y cero
 *   referencias internas de terceros en el copy de cara al cliente.
 * - Sucursales de Los Ángeles (#5, #6 y #7) SIEMPRE formateadas con `formatCustomerStoreName(store, lang)`
 *   (`Los Angeles (Vernon & Broadway)`, `Los Angeles (Central & Washington)`, `Los Angeles (Slauson & Broadway)`
 *   y sus equivalentes en español con `y`).
 * - Lista blanca estricta HTTPS (`isAllowedExternalOrderUrl`) en todos los enlaces de pedido.
 * - Separado completamente del laboratorio interno `/app`, `/app/v1`, `/app/v2` (que permanecen protegidos).
 *
 * @dataFlow
 * - Inicializa instantáneamente desde `V2_STORES` -> hidrata en segundo plano desde `GET /api/mobile/stores`
 *   -> calcula horarios en vivo (`getStoreStatusInLA`) y distancia Haversine local -> genera enlaces
 *   `?hideModal=true&pickup=true|delivery=true` para cada una de las 15 sucursales.
 *
 * @notes
 * - 2026-11-24: Reemplazado el alias anterior hacia `app/app/page.tsx` (laboratorio interno TEG) por un
 *   portal público de producción limpio para clientes reales.
 */

'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  LocateFixed,
  MapPin,
  Navigation,
  Phone,
  Search,
  ShieldCheck,
  ShoppingBag,
  Truck,
} from 'lucide-react'
import { dictionaries } from '@/lib/i18n'
import {
  V2_STORES,
  calculateDistanceMiles,
  getStoreStatusInLA,
  isAllowedExternalOrderUrl,
} from '@/components/customer-app-v2/data/stores'
import {
  GavilanBrandStandardsWordmark,
  V2BrandStyles,
} from '@/components/customer-app-v2/styles/V2BrandChrome'
import type {
  DayOfWeekIndex,
  FulfillmentMode,
  V2AuthoritativeStore,
  V2StoreWithDistance,
} from '@/components/customer-app-v2/types'
import {
  formatCustomerStoreName,
  getCustomerStoreCrossStreets,
} from '@/lib/customer-store-names'
import { sortStoresAlphabetically } from '@/lib/store-display'

const DAY_NAMES_EN: Record<DayOfWeekIndex, string> = {
  0: 'Sun',
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
}

const DAY_NAMES_ES: Record<DayOfWeekIndex, string> = {
  0: 'Dom',
  1: 'Lun',
  2: 'Mar',
  3: 'Mié',
  4: 'Jue',
  5: 'Vie',
  6: 'Sáb',
}

function buildVerifiedOrderUrl(store: V2AuthoritativeStore, mode: FulfillmentMode): string {
  const base = store.toastOrderingUrl.replace(/\/+$/, '')
  const param = mode === 'delivery' ? 'delivery=true' : 'pickup=true'
  const candidate = `${base}/?hideModal=true&${param}`
  return isAllowedExternalOrderUrl(candidate)
    ? candidate
    : 'https://order.online/business/-137616'
}

function buildDirectionsHref(store: V2AuthoritativeStore, isAppleDevice: boolean): string {
  if (isAppleDevice) {
    return `https://maps.apple.com/?daddr=${encodeURIComponent(store.address)}`
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(store.address)}`
}

export default function PublicOrderHubPage() {
  const [lang, setLang] = useState<'en' | 'es'>('en')
  const [stores, setStores] = useState<V2AuthoritativeStore[]>(V2_STORES)
  const [selectedStoreId, setSelectedStoreId] = useState<number>(V2_STORES[0]?.id ?? 6)
  const [mode, setMode] = useState<FulfillmentMode>('pickup')
  const [searchQuery, setSearchQuery] = useState('')
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [isLocating, setIsLocating] = useState(false)
  const [gpsError, setGpsError] = useState<string | null>(null)
  const [expandedHoursId, setExpandedHoursId] = useState<number | null>(null)
  const [isAppleDevice, setIsAppleDevice] = useState(false)
  const [nowMs, setNowMs] = useState<number>(() => Date.now())

  // Live 60s clock for accurate America/Los_Angeles open/closed badges
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  // Restore saved customer language preference (defaults to English 'en') + detect Apple platform
  useEffect(() => {
    try {
      const saved = localStorage.getItem('gavilan_ordenar_lang')
      if (saved === 'es' || saved === 'en') {
        setLang(saved)
      }
      const savedStore = localStorage.getItem('gavilan_ordenar_store_id')
      if (savedStore && V2_STORES.some((s) => s.id === Number(savedStore))) {
        setSelectedStoreId(Number(savedStore))
      }
    } catch {
      // ignore
    }
    if (typeof navigator !== 'undefined') {
      setIsAppleDevice(/iPhone|iPad|iPod|Macintosh/i.test(navigator.userAgent))
    }
  }, [])

  // Background hydration from /api/mobile/stores
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/mobile/stores', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data || !Array.isArray(data.stores)) return
        setStores((prev) =>
          prev.map((localStore) => {
            const remote = data.stores.find(
              (r: Record<string, unknown>) => Number(r.id) === localStore.id
            )
            if (!remote) return localStore
            const remoteUrl =
              typeof remote.toastOrderingUrl === 'string' && remote.toastOrderingUrl
                ? remote.toastOrderingUrl
                : localStore.toastOrderingUrl
            return {
              ...localStore,
              address:
                typeof remote.address === 'string' && remote.address
                  ? remote.address
                  : localStore.address,
              phone:
                typeof remote.phone === 'string' && remote.phone
                  ? remote.phone
                  : localStore.phone,
              latitude:
                typeof remote.latitude === 'number' && Number.isFinite(remote.latitude)
                  ? remote.latitude
                  : localStore.latitude,
              longitude:
                typeof remote.longitude === 'number' && Number.isFinite(remote.longitude)
                  ? remote.longitude
                  : localStore.longitude,
              toastOrderingUrl: remoteUrl,
              onlineOrderingUrl: remoteUrl,
            }
          })
        )
      })
      .catch(() => {
        // Keep instant canonical V2_STORES
      })
    return () => controller.abort()
  }, [])

  const t = useCallback(
    (key: string): string => {
      const mobileLegal = dictionaries[lang].mobile_legal as Record<string, string> | undefined
      return mobileLegal?.[key] ?? key
    },
    [lang]
  )

  const toggleLang = useCallback(() => {
    setLang((prev) => {
      const next = prev === 'en' ? 'es' : 'en'
      try {
        localStorage.setItem('gavilan_ordenar_lang', next)
      } catch {
        // ignore
      }
      return next
    })
  }, [])

  const handleSelectStore = useCallback((storeId: number) => {
    setSelectedStoreId(storeId)
    try {
      localStorage.setItem('gavilan_ordenar_store_id', String(storeId))
    } catch {
      // ignore
    }
  }, [])

  const nowDate = useMemo(() => new Date(nowMs), [nowMs])

  const storesWithDistance = useMemo<V2StoreWithDistance[]>(() => {
    const mapped = stores.map((st) => ({
      ...st,
      distanceMiles: userCoords
        ? calculateDistanceMiles(userCoords.lat, userCoords.lng, st.latitude, st.longitude)
        : null,
    }))
    if (userCoords) {
      return [...mapped].sort((a, b) => (a.distanceMiles ?? 999) - (b.distanceMiles ?? 999))
    }
    return sortStoresAlphabetically(mapped, (st) => formatCustomerStoreName(st, lang))
  }, [lang, stores, userCoords])

  const nearestStoreId = userCoords ? storesWithDistance[0]?.id ?? null : null

  const activeStore = useMemo<V2StoreWithDistance>(() => {
    return (
      storesWithDistance.find((s) => s.id === selectedStoreId) ||
      storesWithDistance[0]
    )
  }, [selectedStoreId, storesWithDistance])

  const activeStoreStatus = useMemo(
    () => getStoreStatusInLA(activeStore, lang, nowDate),
    [activeStore, lang, nowDate]
  )

  const filteredStores = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return storesWithDistance
    return storesWithDistance.filter((st) => {
      const displayName = formatCustomerStoreName(st, lang).toLowerCase()
      const cross = (getCustomerStoreCrossStreets(st, lang) || st.crossStreets).toLowerCase()
      return (
        displayName.includes(q) ||
        cross.includes(q) ||
        st.cityTitle.toLowerCase().includes(q) ||
        st.address.toLowerCase().includes(q) ||
        st.zipCode.includes(q)
      )
    })
  }, [lang, searchQuery, storesWithDistance])

  const handleFindNearest = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsError(t('v2_stores_gps_denied'))
      return
    }
    setIsLocating(true)
    setGpsError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setUserCoords(coords)
        let closest = stores[0]
        let minDist = Infinity
        for (const st of stores) {
          const d = calculateDistanceMiles(coords.lat, coords.lng, st.latitude, st.longitude)
          if (d < minDist) {
            minDist = d
            closest = st
          }
        }
        if (closest) handleSelectStore(closest.id)
        setIsLocating(false)
      },
      () => {
        setIsLocating(false)
        setGpsError(t('v2_stores_gps_denied'))
      },
      { enableHighAccuracy: true, timeout: 7000 }
    )
  }, [handleSelectStore, stores, t])

  const dayNames = lang === 'en' ? DAY_NAMES_EN : DAY_NAMES_ES
  const activeDisplayName = formatCustomerStoreName(activeStore, lang)
  const activeCross = ![5, 6, 7].includes(activeStore.id)
    ? getCustomerStoreCrossStreets(activeStore, lang) || activeStore.crossStreets
    : null
  const activeOrderHref = buildVerifiedOrderUrl(activeStore, mode)
  const activeCtaText =
    mode === 'delivery'
      ? `${t('v2_home_quick_order_delivery')} ${activeDisplayName}`
      : `${t('v2_home_quick_order_pickup')} ${activeDisplayName}`

  return (
    <div className="min-h-[100dvh] w-full bg-[#0d0d0f] text-white selection:bg-[#FFC72C] selection:text-[#121212]">
      <V2BrandStyles />

      {/* Top Sticky Brand Bar */}
      <header className="sticky top-0 z-40 bg-[#121212]/95 border-b border-white/10 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src="/tacosgavilan-web/img/logo.png"
              alt="Tacos Gavilan"
              className="w-10 h-10 object-contain shrink-0"
            />
            <div className="flex flex-col items-start min-w-0">
              <GavilanBrandStandardsWordmark className="h-[22px] sm:h-[26px] w-auto" />
              <span className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#FFC72C] mt-0.5 truncate">
                {t('ordenar_badge')}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/app/support"
              className="hidden sm:inline-flex items-center px-3 py-1.5 rounded-full bg-white/8 hover:bg-white/15 border border-white/10 text-xs font-bold text-white/85 transition-colors"
            >
              {t('nav_support')}
            </Link>
            <button
              type="button"
              onClick={toggleLang}
              className="px-3.5 py-1.5 rounded-full bg-[#50050A] hover:bg-[#6e0810] border border-[#FFC72C]/55 text-[#FFC72C] text-xs font-black tracking-wider cursor-pointer transition-colors"
            >
              {lang === 'en' ? 'ES' : 'EN'}
            </button>
          </div>
        </div>
      </header>

      {/* Hero Banner + Mode Switch + Nearest GPS */}
      <section className="relative overflow-hidden border-b border-white/10">
        <img
          src="/tacosgavilan-web/img/hero-bg-mobile.webp?v=114"
          alt="Tacos Gavilan"
          className="absolute inset-0 w-full h-full object-cover object-center opacity-45"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#50050A]/80 via-[#121212]/85 to-[#0d0d0f]" />

        <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 pt-8 pb-7 space-y-6">
          <div className="max-w-2xl space-y-2.5">
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-black/60 border border-[#FFC72C]/50 text-[#FFC72C] text-[10px] font-black uppercase tracking-[0.18em]">
              {t('v2_order_hub_eyebrow')}
            </span>
            <h1 className="v2-gotham text-3xl sm:text-5xl text-white uppercase tracking-tight leading-[0.95]">
              {t('ordenar_hero_title')}
            </h1>
            <p className="text-sm sm:text-base text-white/80 leading-relaxed max-w-xl">
              {t('ordenar_hero_sub')}
            </p>
          </div>

          {/* Interactive Mode Switch + GPS Nearest Control */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="inline-flex p-1 rounded-2xl bg-black/70 border border-white/15 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => setMode('pickup')}
                className={`flex-1 sm:flex-initial px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer ${
                  mode === 'pickup'
                    ? 'bg-[#DA291C] text-white shadow-lg'
                    : 'text-white/70 hover:text-white'
                }`}
              >
                <ShoppingBag size={14} />
                <span>{t('v2_pickup_short')}</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('delivery')}
                className={`flex-1 sm:flex-initial px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer ${
                  mode === 'delivery'
                    ? 'bg-[#DA291C] text-white shadow-lg'
                    : 'text-white/70 hover:text-white'
                }`}
              >
                <Truck size={14} />
                <span>{t('v2_delivery_short')}</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleFindNearest}
              disabled={isLocating}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-[#FFC72C] hover:bg-amber-400 text-[#121212] text-xs font-black uppercase tracking-wider shadow-lg cursor-pointer transition-colors disabled:opacity-70"
            >
              <LocateFixed size={15} className={isLocating ? 'animate-spin' : ''} />
              <span>{isLocating ? t('v2_stores_gps_loading') : t('ordenar_nearest_btn')}</span>
            </button>
          </div>

          {gpsError && (
            <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-xs font-bold max-w-xl">
              {gpsError}
            </div>
          )}

          {/* Selected / Nearest Branch Spotlight Card */}
          <div className="p-5 sm:p-6 rounded-3xl bg-gradient-to-br from-[#230609] via-[#17171a] to-[#121214] border border-[#FFC72C]/50 shadow-[0_20px_55px_rgba(0,0,0,0.65)] space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-black uppercase tracking-[0.16em] text-[#FFC72C]">
                    {t('ordenar_selected_label')}
                  </span>
                  {nearestStoreId === activeStore.id && (
                    <span className="px-2 py-0.5 rounded-full bg-[#FFC72C] text-[#121212] text-[10px] font-black uppercase">
                      {t('ordenar_nearest_badge')}
                    </span>
                  )}
                  {activeStore.distanceMiles !== null && (
                    <span className="px-2 py-0.5 rounded-full bg-white/10 text-[#FFC72C] text-[10px] font-black">
                      {activeStore.distanceMiles.toFixed(1)} {t('v2_stores_distance_mi')}
                    </span>
                  )}
                </div>
                <h2 className="v2-outfit text-xl sm:text-2xl font-black text-white leading-tight">
                  Tacos Gavilan — {activeDisplayName}
                </h2>
                {activeCross && (
                  <p className="text-xs font-extrabold text-[#FFC72C]">{activeCross}</p>
                )}
              </div>

              <div className="flex flex-col sm:items-end gap-1 shrink-0">
                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black border ${
                    activeStoreStatus.isOpen
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                      : 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                  }`}
                >
                  <Clock size={12} />
                  <span>{activeStoreStatus.badgeText}</span>
                </span>
                <span className="text-xs font-semibold text-white/70">
                  {activeStoreStatus.todayHours}
                </span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-5 text-xs text-white/80">
              <span className="inline-flex items-center gap-1.5">
                <MapPin size={13} className="text-[#FFC72C] shrink-0" />
                <span>{activeStore.address}</span>
              </span>
              <a
                href={`tel:${activeStore.phone.replace(/[^\d+]/g, '')}`}
                className="inline-flex items-center gap-1.5 text-[#FFC72C] font-bold hover:underline"
              >
                <Phone size={13} className="shrink-0" />
                <span>{activeStore.phone}</span>
              </a>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-1">
              <a
                href={activeOrderHref}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 py-3.5 px-5 rounded-2xl bg-gradient-to-r from-[#DA291C] to-[#b81d13] hover:from-[#e63225] hover:to-[#c92015] text-white text-xs sm:text-sm font-black uppercase tracking-wider border border-[#FFC72C]/60 shadow-xl flex items-center justify-center gap-2 text-center transition-all"
              >
                <span className="truncate">{activeCtaText}</span>
                <ArrowRight size={15} className="text-[#FFC72C] shrink-0" />
              </a>

              <a
                href={buildDirectionsHref(activeStore, isAppleDevice)}
                target="_blank"
                rel="noopener noreferrer"
                className="py-3.5 px-4 rounded-2xl bg-white/8 hover:bg-white/15 border border-white/15 text-[#FFC72C] text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors"
              >
                <Navigation size={14} />
                <span>{t('wrapper_directions_btn')}</span>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Full 15-Store Directory */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h2 className="v2-gotham text-xl sm:text-2xl text-white uppercase tracking-tight">
              {t('ordenar_all_stores_title')}
            </h2>
            <p className="text-xs text-white/65 mt-0.5">{t('ordenar_all_stores_sub')}</p>
          </div>

          <div className="relative w-full sm:w-80">
            <Search size={15} className="absolute left-3.5 top-3 text-white/45" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('v2_stores_search_placeholder')}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#18181b] border border-white/15 text-xs text-white placeholder-white/45 focus:outline-none focus:border-[#FFC72C]"
            />
          </div>
        </div>

        {filteredStores.length === 0 ? (
          <div className="p-8 rounded-2xl bg-[#18181b] border border-white/10 text-center text-sm text-white/70">
            {t('ordenar_search_empty')}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredStores.map((st) => {
              const status = getStoreStatusInLA(st, lang, nowDate)
              const isSelected = st.id === activeStore.id
              const isNearest = nearestStoreId === st.id
              const isExpanded = expandedHoursId === st.id
              const displayName = formatCustomerStoreName(st, lang)
              const cross = ![5, 6, 7].includes(st.id)
                ? getCustomerStoreCrossStreets(st, lang) || st.crossStreets
                : null
              const orderHref = buildVerifiedOrderUrl(st, mode)
              const btnLabel =
                mode === 'delivery'
                  ? `${t('v2_tab_order')} · ${t('v2_delivery_short')}`
                  : `${t('v2_tab_order')} · ${t('v2_pickup_short')}`

              return (
                <article
                  key={st.id}
                  onClick={() => handleSelectStore(st.id)}
                  className={`p-4 sm:p-5 rounded-2xl border transition-all flex flex-col justify-between gap-4 cursor-pointer ${
                    isSelected
                      ? 'bg-[#DA291C]/12 border-[#FFC72C]'
                      : 'bg-[#161619] border-white/10 hover:border-white/25'
                  }`}
                >
                  <div className="space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="v2-outfit text-base font-black text-white leading-tight">
                            {displayName}
                          </h3>
                          {isNearest && (
                            <span className="px-2 py-0.5 rounded-full bg-[#FFC72C] text-[#121212] text-[9px] font-black uppercase">
                              {t('ordenar_nearest_badge')}
                            </span>
                          )}
                        </div>
                        {cross && (
                          <p className="text-xs font-extrabold text-[#FFC72C] mt-0.5">{cross}</p>
                        )}
                      </div>

                      {st.distanceMiles !== null && (
                        <span className="shrink-0 px-2.5 py-1 rounded-lg bg-white/8 text-[11px] font-black text-[#FFC72C]">
                          {st.distanceMiles.toFixed(1)} {t('v2_stores_distance_mi')}
                        </span>
                      )}
                    </div>

                    <div className="space-y-1 text-xs text-white/75">
                      <p className="flex items-center gap-1.5">
                        <MapPin size={12} className="text-[#FFC72C] shrink-0" />
                        <span className="truncate">{st.address}</span>
                      </p>
                      <div className="flex items-center justify-between gap-2 flex-wrap pt-0.5">
                        <span
                          className={`font-black ${
                            status.isOpen ? 'text-emerald-400' : 'text-amber-400'
                          }`}
                        >
                          ● {status.badgeText} · {status.todayHours}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setExpandedHoursId(isExpanded ? null : st.id)
                          }}
                          className="inline-flex items-center gap-1 text-[11px] font-bold text-white/70 hover:text-white cursor-pointer"
                        >
                          <Clock size={11} />
                          <span>
                            {isExpanded ? t('ordenar_hide_hours') : t('ordenar_show_hours')}
                          </span>
                          {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="p-3 rounded-xl bg-black/50 border border-white/10 space-y-1 text-[11px]"
                      >
                        {([1, 2, 3, 4, 5, 6, 0] as DayOfWeekIndex[]).map((dayIdx) => {
                          const win = st.weeklySchedule[dayIdx]
                          return (
                            <div key={dayIdx} className="flex justify-between text-white/80">
                              <span className="font-bold">{dayNames[dayIdx]}</span>
                              <span>{lang === 'en' ? win.labelEn : win.labelEs}</span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-2 pt-3 border-t border-white/10"
                  >
                    <a
                      href={orderHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => handleSelectStore(st.id)}
                      className="flex-1 py-2.5 px-3 rounded-xl bg-[#DA291C] hover:bg-[#b81d13] text-white text-xs font-black uppercase tracking-wider border border-[#FFC72C]/45 flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <span>{btnLabel}</span>
                      <ExternalLink size={12} className="text-[#FFC72C]" />
                    </a>

                    <a
                      href={`tel:${st.phone.replace(/[^\d+]/g, '')}`}
                      title={st.phone}
                      className="py-2.5 px-3 rounded-xl bg-white/8 hover:bg-white/15 border border-white/10 text-white text-xs font-bold inline-flex items-center gap-1.5 transition-colors"
                    >
                      <Phone size={12} className="text-[#FFC72C]" />
                      <span className="hidden sm:inline">{t('support_call_btn')}</span>
                    </a>

                    <a
                      href={buildDirectionsHref(st, isAppleDevice)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={t('wrapper_directions_btn')}
                      className="py-2.5 px-3 rounded-xl bg-white/8 hover:bg-white/15 border border-white/10 text-[#FFC72C] text-xs font-bold inline-flex items-center gap-1.5 transition-colors"
                    >
                      <Navigation size={12} />
                    </a>
                  </div>
                </article>
              )
            })}
          </div>
        )}

        {/* Confirmation & Support Reassurance Card */}
        <section className="p-5 rounded-2xl bg-[#161619] border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1 max-w-2xl">
            <h3 className="text-sm font-black uppercase tracking-wider text-[#FFC72C] flex items-center gap-2">
              <ShieldCheck size={15} className="text-emerald-400" />
              <span>{t('ordenar_support_title')}</span>
            </h3>
            <p className="text-xs text-white/75 leading-relaxed">{t('ordenar_support_body')}</p>
          </div>

          <Link
            href="/app/support"
            className="shrink-0 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-black text-white transition-colors"
          >
            <span>{t('v2_support_link')}</span>
            <ExternalLink size={12} className="text-[#FFC72C]" />
          </Link>
        </section>
      </main>

      {/* Clean Public Legal Footer */}
      <footer className="border-t border-white/10 bg-[#111114] mt-6">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-white/60">
          <p className="font-bold text-white/80">{t('ordenar_footer_legal')}</p>
          <div className="flex items-center gap-4 font-bold">
            <Link href="/app/support" className="hover:text-[#FFC72C] transition-colors">
              {t('nav_support')}
            </Link>
            <Link href="/app/privacy" className="hover:text-[#FFC72C] transition-colors">
              {t('nav_privacy')}
            </Link>
            <Link href="/app/terms" className="hover:text-[#FFC72C] transition-colors">
              {t('nav_terms')}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
