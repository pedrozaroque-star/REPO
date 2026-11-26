/**
 * @module components/customer-app-v2/tabs/StoresTab
 * @description Pestaña Tiendas de Tacos Gavilan App V2: directorio completo de 15 sucursales con búsqueda,
 * ordenamiento por GPS real en millas, horarios reales en vivo en zona horaria `America/Los_Angeles`,
 * acordeón semanal de 7 días, enlace a mapa interactivo, llamada directa `tel:` y botón genuino `<a>`
 * de pedido directo por sucursal.
 *
 * @businessRules
 * - Textos 100% bilingües vía `t('mobile_legal.*')`.
 * - Sucursales #5, #6 y #7 de Los Ángeles SIEMPRE formateadas con `formatCustomerStoreName(st, lang)`.
 * - Botón "Ordenar" utiliza icono de compra/enlace externo (nunca `<Phone>`) y enlace `<a>` verificado.
 *
 * @dataFlow
 * - Lee `storesWithDistance`, `selectedStoreId`, `fulfillmentMode`, `buildBranchOrderUrl`, `recordOrderHandoff`, `nowDate`.
 *
 * @notes
 * - 2026-11-24: Corregido icono `<Phone>` erróneo en botón Ordenar y aplicado `formatCustomerStoreName` en las 15 tarjetas.
 */

'use client'

import React, { useMemo, useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  LocateFixed,
  MapPin,
  Navigation,
  Phone,
  Search,
} from 'lucide-react'
import { getStoreStatusInLA } from '../data/stores'
import type { CustomerAppV2Controller } from '../hooks/useCustomerAppV2'
import type { DayOfWeekIndex } from '../types'
import { formatCustomerStoreName, getCustomerStoreCrossStreets } from '@/lib/customer-store-names'

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

export function StoresTab({ ctrl }: { ctrl: CustomerAppV2Controller }) {
  const {
    lang,
    t,
    nowDate,
    storesWithDistance,
    currentStore,
    fulfillmentMode,
    selectStoreSafely,
    storeSearchQuery,
    setStoreSearchQuery,
    openInAppMap,
    handleLocateGps,
    isLocating,
    gpsError,
    buildBranchOrderUrl,
    recordOrderHandoff,
    setActiveTab,
  } = ctrl

  const [expandedHoursStoreId, setExpandedHoursStoreId] = useState<number | null>(null)

  const filteredStores = useMemo(() => {
    const q = storeSearchQuery.trim().toLowerCase()
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
  }, [lang, storeSearchQuery, storesWithDistance])

  const dayNames = lang === 'en' ? DAY_NAMES_EN : DAY_NAMES_ES

  return (
    <div className="p-4 space-y-3 pb-24">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-black text-white uppercase tracking-tight">
            {t('mobile_legal.v2_stores_title')}
          </h3>
          <p className="text-[11px] text-white/65">
            {lang === 'es'
              ? 'Sur de California · Hora del Pacífico'
              : 'Southern California · Pacific Time'}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => openInAppMap(currentStore.id, true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#DA291C] text-white border border-[#FDC82F]/50 text-xs font-black cursor-pointer"
          >
            <Navigation size={13} className="text-[#FDC82F]" />
            <span>{t('mobile_legal.v2_stores_map_btn')}</span>
          </button>
          <button
            type="button"
            onClick={() => handleLocateGps(false)}
            disabled={isLocating}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#FDC82F] text-[#121212] text-xs font-black cursor-pointer"
          >
            <LocateFixed size={13} className={isLocating ? 'animate-spin' : ''} />
            <span>
              {isLocating
                ? t('mobile_legal.v2_stores_gps_loading')
                : t('mobile_legal.v2_stores_gps_btn')}
            </span>
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-2.5 text-white/45" />
        <input
          type="text"
          value={storeSearchQuery}
          onChange={(e) => setStoreSearchQuery(e.target.value)}
          placeholder={t('mobile_legal.v2_stores_search_placeholder')}
          className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#18181b] border border-white/10 text-xs text-white placeholder-white/45 focus:outline-none focus:border-[#FFC72C]"
        />
      </div>

      {gpsError && (
        <div className="p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-[11px] font-bold">
          {gpsError}
        </div>
      )}

      {/* Store Cards */}
      <div className="space-y-2.5">
        {filteredStores.map((st) => {
          const status = getStoreStatusInLA(st, lang, nowDate)
          const isActive = st.id === currentStore.id
          const hoursExpanded = expandedHoursStoreId === st.id
          const storeDisplay = formatCustomerStoreName(st, lang)
          const storeCross = ![5, 6, 7].includes(st.id)
            ? getCustomerStoreCrossStreets(st, lang) || st.crossStreets
            : null
          const orderHref = buildBranchOrderUrl(st, fulfillmentMode)

          return (
            <div
              key={st.id}
              className={`p-3.5 rounded-2xl border transition-all space-y-2.5 ${
                isActive
                  ? 'bg-[#DA291C]/12 border-[#FDC82F]'
                  : 'bg-[#18181b] border-white/10'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-black text-white">{storeDisplay}</span>
                    {storeCross && (
                      <span className="text-xs font-extrabold text-[#FFC72C]">{storeCross}</span>
                    )}
                    {isActive && (
                      <span className="px-2 py-0.5 rounded-full bg-[#FDC82F] text-[#121212] text-[9px] font-black uppercase">
                        {t('mobile_legal.v2_stores_selected_badge')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-white/70 mt-0.5 flex items-center gap-1">
                    <MapPin size={11} className="text-[#FFC72C] shrink-0" />
                    <span className="truncate">{st.address}</span>
                  </p>
                  <a
                    href={`tel:${st.phone.replace(/[^\d+]/g, '')}`}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-[#FFC72C] hover:underline mt-0.5"
                  >
                    <Phone size={10} />
                    <span>{st.phone}</span>
                  </a>
                </div>

                {st.distanceMiles !== null && (
                  <span className="shrink-0 px-2 py-1 rounded-lg bg-white/8 text-[11px] font-black text-[#FFC72C]">
                    {st.distanceMiles.toFixed(1)} {t('mobile_legal.v2_stores_distance_mi')}
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between text-[11px]">
                <span
                  className={`font-black ${
                    status.isOpen ? 'text-emerald-400' : 'text-amber-400'
                  }`}
                >
                  ● {status.badgeText} · {status.todayHours}
                </span>

                <button
                  type="button"
                  onClick={() =>
                    setExpandedHoursStoreId(hoursExpanded ? null : st.id)
                  }
                  className="inline-flex items-center gap-1 text-white/70 hover:text-white font-bold cursor-pointer"
                >
                  <Clock size={11} />
                  <span>{hoursExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</span>
                </button>
              </div>

              {hoursExpanded && (
                <div className="p-2.5 rounded-xl bg-black/45 border border-white/10 space-y-1 text-[11px]">
                  <p className="text-[10px] font-black uppercase tracking-wider text-[#FFC72C] mb-1">
                    {t('mobile_legal.v2_stores_hours_title')}
                  </p>
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

              <div className="grid grid-cols-3 gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    selectStoreSafely(st.id)
                    setActiveTab('home')
                  }}
                  className={`py-2 rounded-xl text-[11px] font-black uppercase flex items-center justify-center gap-1 cursor-pointer ${
                    isActive
                      ? 'bg-[#FDC82F] text-[#121212]'
                      : 'bg-[#DA291C] text-white hover:bg-[#b81d13]'
                  }`}
                >
                  {isActive && <Check size={12} />}
                  <span>{t('mobile_legal.v2_stores_select_btn')}</span>
                </button>

                <button
                  type="button"
                  onClick={() => openInAppMap(st.id, false)}
                  className="py-2 rounded-xl bg-white/8 hover:bg-white/15 text-[#FFC72C] text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Navigation size={12} />
                  <span>{t('mobile_legal.v2_stores_map_btn')}</span>
                </button>

                <a
                  href={orderHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    selectStoreSafely(st.id)
                    recordOrderHandoff(st, fulfillmentMode)
                  }}
                  className="py-2 rounded-xl bg-white/8 hover:bg-white/15 text-white text-[11px] font-bold flex items-center justify-center gap-1"
                >
                  <ExternalLink size={12} className="text-[#FFC72C]" />
                  <span>{t('mobile_legal.v2_tab_order')}</span>
                </a>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
