/**
 * @module components/preparador/PreparadorTopRail
 * @description Barra superior instrumental única (`50px`) de la Tableta Preparador (`/inventory/preparador`)
 *   con estética industrial "Warm Ceramic & Comal Graphite" calibrada para Samsung Galaxy Tab S10 FE 10.9"
 *   (`1024×640` / `1152×720`), MESWAO 15.6" (`1366×768+`) y teléfonos móviles (`< lg`).
 *
 * @businessRules
 * - Regla U54 / U62 (Modo Tableta / Kiosco): Al estar en `isFullscreen === true`, oculta TODOS los controles
 *   administrativos (`⚙ Gerente`, selector de sucursal, fecha, modos) y deja únicamente los controles de operación
 *   en vivo: Estación + Sucursal, interruptor `Parrilla + Panel | Solo Órdenes` (+ acceso `+ Insumos`),
 *   LED `● EN VIVO`, botón `↻`, `☀ Despertar` y `Salir`.
 * - En `Solo Órdenes`, expone el botón `+ Insumos` con contador de carrito para que el cocinero nunca quede
 *   bloqueado para pedir alimentos a Cocina Trasera.
 * - Muestra botón rápido `Volver a Hoy` cuando el gerente consulta una fecha histórica (`!isToday`).
 *
 * @dataFlow
 * - Recibe estado y handlers desde `app/inventory/preparador/page.tsx`.
 */

'use client'

import React from 'react'
import {
  Maximize2,
  Minimize2,
  RefreshCw,
  Settings,
  SlidersHorizontal,
  Store,
  Sun,
  UtensilsCrossed,
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { formatStoreDisplayName } from '@/lib/store-display'

export interface PreparadorTopRailProps {
  isDark: boolean
  isFullscreen: boolean
  hideCookingPanel: boolean
  activeTab: 'alimentos' | 'ordenes'
  cartTotalQty: number
  storeName: string
  cardDisplayMode: 'manual' | 'basic' | 'advanced'
  viewMode: '30min' | 'tramos'
  isToday: boolean
  selectedDate: string
  loadingReadyOrders: boolean
  wakingUpTablet: boolean
  liveClockText: string
  bindInstantTap: (key: string, action: () => void) => Record<string, any>
  onToggleHideCooking: (next: boolean) => void
  onOpenSuppliesQuick: () => void
  onBackToToday: () => void
  onManualRefresh: () => void
  onWakeUpTablet: () => void
  onOpenManagerSheet: () => void
  onToggleFullscreen: () => void
}

export default function PreparadorTopRail({
  isDark,
  isFullscreen,
  hideCookingPanel,
  activeTab,
  cartTotalQty,
  storeName,
  cardDisplayMode,
  viewMode,
  isToday,
  selectedDate,
  loadingReadyOrders,
  wakingUpTablet,
  liveClockText,
  bindInstantTap,
  onToggleHideCooking,
  onOpenSuppliesQuick,
  onBackToToday,
  onManualRefresh,
  onWakeUpTablet,
  onOpenManagerSheet,
  onToggleFullscreen,
}: PreparadorTopRailProps) {
  const { t } = useLanguage()

  const displayStore = storeName ? formatStoreDisplayName(storeName) : '—'
  const modeShort =
    cardDisplayMode === 'manual'
      ? t('prep.manualMode')
      : cardDisplayMode === 'basic'
        ? t('prep.basicMode')
        : t('prep.advancedMode')
  const viewShort = viewMode === '30min' ? '30M' : t('prep.viewTramos')

  const surfaceBar = isDark
    ? 'bg-[#181A1F] border-b border-[#2C3038] text-[#F5F2EB]'
    : 'bg-white border-b border-[#D8D0C2] text-[#171614]'

  const pillMuted = isDark
    ? 'bg-[#111214] border border-[#2C3038] text-[#D1D5DB]'
    : 'bg-[#F3EFE7] border border-[#D8D0C2] text-[#3F3B35]'

  const btnNeutral = isDark
    ? 'bg-[#23272F] hover:bg-[#2C313B] text-[#F5F2EB] border border-[#343944] border-b-[3px] border-b-[#090A0C]'
    : 'bg-white hover:bg-[#F7F4EE] text-[#171614] border border-[#D8D0C2] border-b-[3px] border-b-[#BFB5A3]'

  const segmentedShell = isDark
    ? 'bg-[#111214] border border-[#2C3038]'
    : 'bg-[#E8E2D6] border border-[#D8D0C2]'

  const segmentedActive = isDark
    ? 'bg-[#F5F2EB] text-[#111214] shadow-xs'
    : 'bg-[#171614] text-white shadow-xs'

  const segmentedInactive = isDark
    ? 'text-[#9CA3AF] hover:text-[#F5F2EB]'
    : 'text-[#5C574F] hover:text-[#171614]'

  return (
    <>
      {/* TOP BAR MÓVIL COMPACTO (< lg) */}
      <header
        data-no-proximity="true"
        className={`lg:hidden h-12 px-3 flex items-center justify-between gap-2 shrink-0 z-30 ${surfaceBar}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-1 h-5 rounded-full bg-[#C8371A] dark:bg-[#EF4444] shrink-0" />
          <span className="font-black text-xs tracking-wider uppercase shrink-0">
            {t('prep.headerBrand')}
          </span>
          <button
            type="button"
            onClick={onOpenManagerSheet}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-extrabold truncate cursor-pointer active:scale-95 ${pillMuted}`}
          >
            <Store className="w-3 h-3 shrink-0 opacity-70" />
            <span className="truncate max-w-[120px]">{displayStore}</span>
          </button>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-black uppercase ${
              isDark
                ? 'bg-[#122E1F] text-[#86EFAC] border border-[#1E4D33]'
                : 'bg-[#E6F4EA] text-[#14532D] border border-[#B7DFC2]'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#15803D] dark:bg-[#22C55E]" />
            {t('prep.liveIndicator')}
          </span>
          <button
            type="button"
            onClick={onOpenManagerSheet}
            className={`w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer active:scale-95 ${btnNeutral}`}
            title={t('prep.ajustes')}
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* BARRA INSTRUMENTAL ÚNICA TABLETA / DESKTOP (>= lg, 50px) */}
      <header
        data-no-proximity="true"
        className={`hidden lg:flex h-[50px] px-2.5 xl:px-3.5 items-center justify-between gap-2 shrink-0 z-30 select-none ${surfaceBar}`}
      >
        {/* IZQUIERDA: Estación + Sucursal + Chip discreto de Modo/Fecha */}
        <div className="flex items-center gap-2 min-w-0 shrink-0">
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="w-1 h-[22px] rounded-full bg-[#C8371A] shrink-0" />
            <span className="font-black text-sm tracking-tight uppercase whitespace-nowrap">
              {t('prep.headerBrand')}
            </span>
          </div>

          <span className={`h-4 w-px shrink-0 ${isDark ? 'bg-[#2C3038]' : 'bg-[#D8D0C2]'}`} />

          <span
            className={`px-2.5 py-1 rounded-md text-xs font-extrabold whitespace-nowrap shrink-0 ${pillMuted}`}
          >
            {displayStore}
          </span>

          {!isFullscreen && (
            <span
              className={`hidden xl:inline-flex items-center px-2 py-1 rounded-md text-[11px] font-bold uppercase tracking-wide whitespace-nowrap shrink-0 ${pillMuted}`}
            >
              {modeShort} · {viewShort}
            </span>
          )}

          {!isToday && (
            <button
              type="button"
              {...bindInstantTap('rail:back-today', onBackToToday)}
              className="px-2 py-1 rounded-md bg-[#C8371A] hover:bg-[#A82D15] text-white text-[11px] font-black uppercase tracking-wide whitespace-nowrap shrink-0 cursor-pointer active:scale-95"
              title={selectedDate}
            >
              {t('prep.backToToday')} ({selectedDate.slice(5)})
            </button>
          )}
        </div>

        {/* CENTRO: UN solo interruptor segmentado físico + acceso rápido +Insumos en Solo Órdenes */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className={`inline-flex items-center p-0.5 rounded-lg ${segmentedShell}`}>
            <button
              type="button"
              {...bindInstantTap('rail:split-view', () => onToggleHideCooking(false))}
              className={`px-2.5 py-1.5 rounded-md text-xs font-black tracking-tight whitespace-nowrap transition-colors cursor-pointer touch-manipulation ${
                !hideCookingPanel ? segmentedActive : segmentedInactive
              }`}
            >
              {t('prep.grillAndPanel')}
            </button>
            <button
              type="button"
              {...bindInstantTap('rail:only-orders', () => onToggleHideCooking(true))}
              className={`px-2.5 py-1.5 rounded-md text-xs font-black tracking-tight whitespace-nowrap transition-colors cursor-pointer touch-manipulation ${
                hideCookingPanel ? segmentedActive : segmentedInactive
              }`}
            >
              {t('prep.onlyOrdersMode')}
            </button>
          </div>

          {hideCookingPanel && (
            <button
              type="button"
              {...bindInstantTap('rail:quick-supplies', onOpenSuppliesQuick)}
              className={`h-[34px] px-2.5 rounded-lg text-xs font-black whitespace-nowrap inline-flex items-center gap-1.5 cursor-pointer active:translate-y-[1px] touch-manipulation ${
                activeTab === 'alimentos'
                  ? 'bg-[#C8371A] text-white border border-[#9A2711] border-b-[3px] border-b-[#7F1D1D]'
                  : btnNeutral
              }`}
            >
              <UtensilsCrossed className="w-3.5 h-3.5 shrink-0" />
              <span>{t('prep.plusSupplies')}</span>
              {cartTotalQty > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-[#C8371A] text-white text-[10px] font-black tabular-nums">
                  {cartTotalQty}
                </span>
              )}
            </button>
          )}
        </div>

        {/* DERECHA: Reloj (>=xl), ● EN VIVO, ↻ Sync, Gerente (oculto en Kiosco) / Despertar (en Kiosco) y TABLETA/SALIR */}
        <div className="flex items-center gap-1.5 shrink-0">
          {liveClockText && (
            <span
              className={`hidden 2xl:inline-block text-xs font-black tabular-nums px-2 ${
                isDark ? 'text-[#9CA3AF]' : 'text-[#5C574F]'
              }`}
            >
              {liveClockText}
            </span>
          )}

          <span
            className={`h-[34px] px-2.5 rounded-lg inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide whitespace-nowrap shrink-0 ${
              isDark
                ? 'bg-[#122E1F] text-[#86EFAC] border border-[#1E4D33]'
                : 'bg-[#E6F4EA] text-[#14532D] border border-[#B7DFC2]'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-[#15803D] dark:bg-[#22C55E]" />
            <span>{t('prep.liveIndicator')}</span>
          </span>

          <button
            type="button"
            {...bindInstantTap('rail:refresh', onManualRefresh)}
            title={t('prep.refreshOrdersTooltip')}
            aria-label={t('prep.refreshOrdersTooltip')}
            className={`w-[36px] h-[34px] rounded-lg flex items-center justify-center cursor-pointer active:translate-y-[1px] touch-manipulation ${btnNeutral}`}
          >
            <RefreshCw className={`w-4 h-4 ${loadingReadyOrders ? 'animate-spin' : ''}`} />
          </button>

          {/* Modo Kiosco (U54): Despertar directo, CERO botón Gerente; Modo Normal: ⚙ Gerente */}
          {isFullscreen ? (
            <button
              type="button"
              {...bindInstantTap('rail:wake-kiosk', onWakeUpTablet)}
              disabled={wakingUpTablet}
              title={t('prep.wakeUpTabletDesc')}
              className={`h-[34px] px-2.5 rounded-lg text-xs font-black uppercase tracking-tight whitespace-nowrap inline-flex items-center gap-1.5 cursor-pointer active:translate-y-[1px] touch-manipulation disabled:opacity-50 ${
                isDark
                  ? 'bg-[#33230B] hover:bg-[#442E0E] text-[#FCD34D] border border-[#6E4912] border-b-[3px] border-b-[#1E1406]'
                  : 'bg-[#FEF3C7] hover:bg-[#FDE68A] text-[#92400E] border border-[#E5B84B] border-b-[3px] border-b-[#C9962B]'
              }`}
            >
              <Sun className={`w-3.5 h-3.5 shrink-0 ${wakingUpTablet ? 'animate-spin' : ''}`} />
              <span>{t('prep.shortWakeBtn')}</span>
            </button>
          ) : (
            <button
              type="button"
              {...bindInstantTap('rail:manager-sheet', onOpenManagerSheet)}
              className={`h-[34px] px-2.5 rounded-lg text-xs font-black whitespace-nowrap inline-flex items-center gap-1.5 cursor-pointer active:translate-y-[1px] touch-manipulation ${btnNeutral}`}
            >
              <Settings className="w-3.5 h-3.5 shrink-0" />
              <span>{t('prep.managerBtn')}</span>
            </button>
          )}

          <button
            type="button"
            {...bindInstantTap('rail:fullscreen', onToggleFullscreen)}
            title={t('prep.tabletMode')}
            className={`h-[34px] px-3 rounded-lg text-xs font-black uppercase tracking-wide whitespace-nowrap inline-flex items-center gap-1.5 cursor-pointer active:translate-y-[1px] touch-manipulation ${
              isFullscreen
                ? btnNeutral
                : isDark
                  ? 'bg-[#F5F2EB] hover:bg-white text-[#111214] border border-white border-b-[3px] border-b-[#9CA3AF]'
                  : 'bg-[#171614] hover:bg-[#2A2825] text-white border border-[#171614] border-b-[3px] border-b-black'
            }`}
          >
            {isFullscreen ? (
              <>
                <Minimize2 className="w-3.5 h-3.5 shrink-0" />
                <span>{t('prep.shortExitBtn')}</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5 shrink-0" />
                <span>{t('prep.tablet')}</span>
              </>
            )}
          </button>
        </div>
      </header>
    </>
  )
}
