/**
 * @module components/preparador/PreparadorGrillPanel
 * @description Panel izquierdo de Ritmo de Cocción de Parrilla (`42%` ancho en desktop/tableta) diseñado
 *   para mostrar las 5 carnes de parrilla (`ASADA`, `PASTOR`, `POLLO`, `CABEZA`, `LENGUA`) al 100% sin
 *   recortes verticales ni scroll en la Samsung Galaxy Tab S10 FE 10.9" (`1024×640` / `1152×720`).
 *
 * @businessRules
 * - Reglas explícitas de Carlos (U48, U50, U51, U53, U58, U61, U62):
 *   - En modos `Manual` y `Básica`: CERO leyenda `Máx. Charola`, CERO subtítulo `"Proyección en Vivo"`,
 *     CERO badge `"PROGRAMADO SEMANAL"` y sin abrir modal explicativo al tocar tarjetas.
 *   - En modo `Avanzada`: muestra `PROY LBS | REAL` + chip `Máx. Charola` + enlace `? Info`.
 *   - En `isFullscreen` (Modo Tableta / Kiosco): la edición manual de libras queda 100% bloqueada.
 * - Solo proyecta las 5 carnes de parrilla; `Buche`, `Chorizo` y `Carnitas` se cocinan al momento.
 * - Muestra `weatherAlert` cuando está activo (corrigiendo el estado previamente ignorado en UI).
 * - Sustituye la tira cortada de 48 puntos verticales por una barra de progreso limpia de `3px` + stepper `44×44px`.
 */

'use client'

import React from 'react'
import { ChevronLeft, ChevronRight, CloudRain, HelpCircle, Loader2 } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'

export interface GrillMeatEditRequest {
  key: string
  meatType: string
  bucketLabel: string
  intervalStart?: string
  periodStartH?: number
  periodEndH?: number
  currentVal: number
  isManualMode: boolean
}

export interface PreparadorGrillPanelProps {
  isDark: boolean
  isFullscreen: boolean
  hideCookingPanel: boolean
  mobileTab: 'parrilla' | 'insumos' | 'resumen'
  fetchingMeat: boolean
  carouselBuckets: any[]
  activeIndex: number
  currentBucketIndex: number
  viewMode: '30min' | 'tramos'
  cardDisplayMode: 'manual' | 'basic' | 'advanced'
  intelligenceAcelerador: number
  weatherAlert: boolean
  manualOverrides: Record<string, number>
  manualWeeklySchedule: Record<string, number>
  carouselContainerRef: React.RefObject<HTMLDivElement | null>
  grillPanelRef: React.RefObject<HTMLDivElement | null>
  onPrevBucket: () => void
  onNextBucket: () => void
  onJumpToCurrent: () => void
  onTouchStart: (e: React.TouchEvent) => void
  onTouchMove: (e: React.TouchEvent) => void
  onTouchEnd: () => void
  onEditMeat: (req: GrillMeatEditRequest) => void
  onOpenGuide: () => void
  onOpenDay: () => void
  onOpenWaste: () => void
  onOpenInfo: () => void
}

const SECONDARY_MEATS = ['PASTOR', 'POLLO', 'CABEZA', 'LENGUA'] as const

export default function PreparadorGrillPanel({
  isDark,
  isFullscreen,
  hideCookingPanel,
  mobileTab,
  fetchingMeat,
  carouselBuckets,
  activeIndex,
  currentBucketIndex,
  viewMode,
  cardDisplayMode,
  intelligenceAcelerador,
  weatherAlert,
  manualOverrides,
  manualWeeklySchedule,
  carouselContainerRef,
  grillPanelRef,
  onPrevBucket,
  onNextBucket,
  onJumpToCurrent,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onEditMeat,
  onOpenGuide,
  onOpenDay,
  onOpenWaste,
  onOpenInfo,
}: PreparadorGrillPanelProps) {
  const { t } = useLanguage()

  const activeBucket = carouselBuckets[activeIndex] || null
  const totalBuckets = Math.max(1, carouselBuckets.length)
  const progressPct = Math.min(100, Math.max(2, ((activeIndex + 1) / totalBuckets) * 100))

  const isPast = activeIndex < currentBucketIndex
  const isCurrent = activeIndex === currentBucketIndex
  const pacePct = Math.round((intelligenceAcelerador - 1) * 100)

  const resolveMeatValues = (meatType: string) => {
    const item = activeBucket?.data?.find((d: any) => d.meat_type === meatType)
    const rawAvg = Number(item?.avg_lbs || 0)
    const durationHrs = Number(item?.duration || (viewMode === '30min' ? 0.5 : 3))
    const elapsedHrs = Number(item?.elapsed_hours || durationHrs)
    const projectedTotal = rawAvg * intelligenceAcelerador
    const projectedRate = viewMode === 'tramos' ? projectedTotal / Math.max(0.5, durationHrs) : projectedTotal
    const autoMaxTray = Math.max(1, Math.ceil(projectedRate))

    const intervalStart: string = item?.interval_start || activeBucket?.id || '06:00:00'
    const overrideKey = `${activeBucket?.id}_${meatType}`
    const manualKey = `${intervalStart}_${meatType}`

    const hasManualWeekly = manualWeeklySchedule[manualKey] !== undefined
    const hasDailyOverride = manualOverrides[overrideKey] !== undefined

    let displayMainInt = autoMaxTray
    if (cardDisplayMode === 'manual') {
      displayMainInt = hasManualWeekly
        ? manualWeeklySchedule[manualKey]
        : hasDailyOverride
          ? manualOverrides[overrideKey]
          : autoMaxTray
    } else if (hasDailyOverride) {
      displayMainInt = manualOverrides[overrideKey]
    }

    const hasReal = item?.real_lbs !== undefined && item?.real_lbs !== null
    const rawReal = hasReal ? Number(item.real_lbs) : null
    const displayReal =
      rawReal !== null
        ? viewMode === 'tramos'
          ? rawReal / Math.max(0.25, elapsedHrs)
          : rawReal
        : null

    return {
      meatType,
      intervalStart,
      overrideKey,
      projectedRate,
      autoMaxTray,
      displayMainInt,
      displayReal,
      hasReal,
      isModified: cardDisplayMode === 'manual' ? hasManualWeekly : hasDailyOverride,
      periodStartH: activeBucket?.startH as number | undefined,
      periodEndH: activeBucket?.endH as number | undefined,
    }
  }

  const handleCardClick = (meatType: string) => {
    if (isFullscreen) return // Regla U62: edición bloqueada en Modo Tableta
    if (cardDisplayMode === 'basic') return // Regla U58: sin modal al tocar en Básica
    if (cardDisplayMode === 'advanced') {
      const m = resolveMeatValues(meatType)
      onEditMeat({
        key: m.overrideKey,
        meatType,
        bucketLabel: activeBucket?.label || '',
        intervalStart: m.intervalStart,
        periodStartH: m.periodStartH,
        periodEndH: m.periodEndH,
        currentVal: m.displayMainInt,
        isManualMode: false,
      })
      return
    }
    // Manual mode
    const m = resolveMeatValues(meatType)
    onEditMeat({
      key: m.overrideKey,
      meatType,
      bucketLabel: activeBucket?.label || '',
      intervalStart: m.intervalStart,
      periodStartH: m.periodStartH,
      periodEndH: m.periodEndH,
      currentVal: m.displayMainInt,
      isManualMode: true,
    })
  }

  const asada = resolveMeatValues('ASADA')
  const secondaries = SECONDARY_MEATS.map((m) => resolveMeatValues(m))

  const panelBorder = isDark ? 'border-[#2C3038]' : 'border-[#D8D0C2]'
  const cardSurface = isDark
    ? 'bg-[#1B1D21] border border-[#2C3038] border-b-[3px] border-b-[#090A0C] text-[#F5F2EB]'
    : 'bg-white border border-[#D8D0C2] border-b-[3px] border-b-[#BFB5A3] text-[#171614]'
  const stepperBtn = isDark
    ? 'bg-[#1B1D21] hover:bg-[#262930] text-[#F5F2EB] border border-[#2C3038] border-b-[3px] border-b-[#090A0C]'
    : 'bg-white hover:bg-[#FAF8F4] text-[#171614] border border-[#D8D0C2] border-b-[3px] border-b-[#BFB5A3]'
  const footerBtn = isDark
    ? 'bg-[#1B1D21] hover:bg-[#252932] text-[#D1D5DB] border border-[#2C3038]'
    : 'bg-[#E8E2D6] hover:bg-[#DDD5C5] text-[#171614] border border-[#CFC6B4]'

  const unitLabel = viewMode === 'tramos' ? `${t('prep.lbs')}/h` : t('prep.lbs')

  return (
    <section
      ref={carouselContainerRef}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      className={`${
        hideCookingPanel ? 'hidden' : mobileTab === 'parrilla' ? 'flex flex-1' : 'hidden lg:flex'
      } w-full lg:w-[42%] lg:max-w-[520px] flex-col min-h-0 overflow-hidden lg:border-r shrink-0 select-none ${panelBorder} ${
        isDark ? 'bg-[#111214]' : 'bg-[#F3EFE7]'
      }`}
    >
      {/* CABECERA-STEPPER UNIFICADA (`52px`) */}
      <div className="px-2.5 pt-2 pb-1.5 flex items-center justify-between gap-2 shrink-0">
        <button
          type="button"
          onClick={onPrevBucket}
          disabled={activeIndex <= 0}
          aria-label={t('prep.prevBlock')}
          className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 cursor-pointer active:translate-y-[1px] disabled:opacity-30 touch-manipulation ${stepperBtn}`}
        >
          <ChevronLeft className="w-5 h-5" strokeWidth={2.6} />
        </button>

        <div className="flex-1 min-w-0 flex flex-col items-center text-center">
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {isCurrent ? (
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider ${
                  isDark
                    ? 'bg-[#3A1614] text-[#FCA5A5] border border-[#7F1D1D]'
                    : 'bg-[#FDECE8] text-[#9A2711] border border-[#E7B5AA]'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#C8371A] dark:bg-[#EF4444]" />
                {t('prep.now')}
              </span>
            ) : (
              <button
                type="button"
                onClick={onJumpToCurrent}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider cursor-pointer ${
                  isDark
                    ? 'bg-[#23272F] text-[#F5F2EB] border border-[#3B414D]'
                    : 'bg-[#171614] text-white'
                }`}
              >
                {t('prep.backToNow')}
              </button>
            )}

            {activeBucket?.isPeak && (
              <span className="px-2 py-0.5 rounded-md bg-[#C8371A] text-white text-[10px] font-black uppercase tracking-wider">
                {t('prep.peak')}
              </span>
            )}

            {pacePct !== 0 && (
              <span
                className={`px-2 py-0.5 rounded-md text-[10px] font-black tabular-nums uppercase tracking-wide ${
                  pacePct > 0
                    ? isDark
                      ? 'bg-[#3A1614] text-[#FCA5A5] border border-[#7F1D1D]'
                      : 'bg-[#FDECE8] text-[#9A2711] border border-[#E7B5AA]'
                    : isDark
                      ? 'bg-[#142442] text-[#93C5FD] border border-[#1E3A8A]'
                      : 'bg-[#E8F0FE] text-[#1E3A8A] border border-[#BFDBFE]'
                }`}
              >
                {t('prep.paceChip')} {pacePct > 0 ? `+${pacePct}%` : `${pacePct}%`}
              </span>
            )}

            {weatherAlert && (
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wide ${
                  isDark
                    ? 'bg-[#33230B] text-[#FCD34D] border border-[#6E4912]'
                    : 'bg-[#FEF3C7] text-[#92400E] border border-[#E5B84B]'
                }`}
              >
                <CloudRain className="w-3 h-3" />
                {t('prep.weatherChip')}
              </span>
            )}
          </div>

          <div className="mt-0.5 flex items-baseline justify-center gap-1.5 min-w-0">
            <span className="text-xs sm:text-sm font-black tracking-tight tabular-nums truncate">
              {viewMode === 'tramos' && activeBucket?.name
                ? `${activeBucket.name} · ${activeBucket.label}`
                : activeBucket?.label || '—'}
            </span>
            <span
              className={`text-[11px] font-bold tabular-nums shrink-0 ${
                isDark ? 'text-[#9CA3AF]' : 'text-[#5C574F]'
              }`}
            >
              ({activeIndex + 1}/{totalBuckets})
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onNextBucket}
          disabled={activeIndex >= totalBuckets - 1}
          aria-label={t('prep.nextBlock')}
          className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 cursor-pointer active:translate-y-[1px] disabled:opacity-30 touch-manipulation ${stepperBtn}`}
        >
          <ChevronRight className="w-5 h-5" strokeWidth={2.6} />
        </button>
      </div>

      {/* Subtítulo exclusivo de Modo Avanzada (Regla U53: jamás visible en Manual/Básica) */}
      {cardDisplayMode === 'advanced' && (
        <div
          className={`px-3 pb-1 flex items-center justify-between text-[11px] font-bold shrink-0 ${
            isDark ? 'text-[#9CA3AF]' : 'text-[#5C574F]'
          }`}
        >
          <span className="truncate">{t('prep.liveProjection')}</span>
          <button
            type="button"
            onClick={onOpenInfo}
            className="inline-flex items-center gap-1 text-[#1D4ED8] dark:text-[#60A5FA] font-black hover:underline shrink-0 cursor-pointer"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span>Info</span>
          </button>
        </div>
      )}

      {/* Barra de progreso fina 3px (reemplaza los 48 puntos verticales recortados) */}
      <div className={`mx-2.5 h-[3px] rounded-full overflow-hidden shrink-0 ${isDark ? 'bg-[#23272F]' : 'bg-[#DDD5C5]'}`}>
        <div
          className="h-full bg-[#C8371A] dark:bg-[#EF4444] transition-all duration-200"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* CUERPO PARRILLA: ASADA protagonista + 2×2 PASTOR/POLLO/CABEZA/LENGUA (0% recorte en 1024×640) */}
      <div ref={grillPanelRef} className="flex-1 min-h-0 px-2.5 py-2 flex flex-col gap-2 overflow-y-auto">
        {fetchingMeat && carouselBuckets.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 opacity-70">
            <Loader2 className="w-7 h-7 animate-spin text-[#C8371A]" />
            <span className="text-xs font-extrabold uppercase tracking-wider">
              {t('prep.calculatingHistory')}
            </span>
          </div>
        ) : (
          <>
            {/* ASADA — TARJETA PROTAGONISTA HORIZONTAL */}
            <button
              type="button"
              onClick={() => handleCardClick('ASADA')}
              disabled={isFullscreen || cardDisplayMode === 'basic'}
              className={`relative flex-[1.15] min-h-[108px] rounded-2xl px-4 py-3 flex items-center justify-between text-left transition-transform ${cardSurface} ${
                !isFullscreen && cardDisplayMode !== 'basic'
                  ? 'cursor-pointer active:translate-y-[1px]'
                  : 'cursor-default'
              }`}
              style={{ borderLeftWidth: '4px', borderLeftColor: '#C8371A' }}
            >
              <div className="flex flex-col justify-center gap-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-5 rounded-full bg-[#C8371A] shrink-0" />
                  <span className="text-lg xl:text-2xl font-black tracking-tight uppercase">
                    ASADA
                  </span>
                </div>
                {cardDisplayMode === 'advanced' && (
                  <span
                    className={`inline-flex w-fit items-center px-2 py-0.5 rounded-md text-[11px] font-black tabular-nums ${
                      isDark
                        ? 'bg-[#33230B] text-[#FCD34D] border border-[#6E4912]'
                        : 'bg-[#FEF3C7] text-[#92400E] border border-[#E5B84B]'
                    }`}
                  >
                    {t('prep.maxTray')}: {asada.autoMaxTray} {unitLabel}
                  </span>
                )}
              </div>

              {cardDisplayMode === 'advanced' ? (
                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <div className="text-3xl xl:text-4xl font-black tabular-nums leading-none">
                      {asada.projectedRate.toFixed(1)}
                    </div>
                    <div
                      className={`text-[10px] font-black uppercase tracking-wider mt-1 ${
                        isDark ? 'text-[#9CA3AF]' : 'text-[#5C574F]'
                      }`}
                    >
                      {t('prep.proy').replace(':', '')} {unitLabel}
                    </div>
                  </div>
                  <div className={`w-px h-10 ${isDark ? 'bg-[#2C3038]' : 'bg-[#D8D0C2]'}`} />
                  <div className="text-right min-w-[66px]">
                    <div
                      className={`text-3xl xl:text-4xl font-black tabular-nums leading-none ${
                        asada.hasReal
                          ? 'text-[#15803D] dark:text-[#22C55E]'
                          : isDark
                            ? 'text-[#6B7280]'
                            : 'text-[#9C9488]'
                      }`}
                    >
                      {asada.displayReal !== null ? asada.displayReal.toFixed(1) : isPast ? '…' : '—'}
                    </div>
                    <div className="text-[10px] font-black uppercase tracking-wider mt-1 text-[#15803D] dark:text-[#22C55E]">
                      {t('prep.real')}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-baseline gap-1.5 shrink-0">
                  <span className="text-5xl xl:text-6xl font-black tabular-nums leading-none tracking-tight">
                    {asada.displayMainInt}
                  </span>
                  <span
                    className={`text-sm xl:text-base font-black uppercase ${
                      isDark ? 'text-[#9CA3AF]' : 'text-[#5C574F]'
                    }`}
                  >
                    {unitLabel}
                  </span>
                </div>
              )}
            </button>

            {/* GRID 2×2 SECUNDARIO: PASTOR, POLLO, CABEZA, LENGUA */}
            <div className="flex-[2] min-h-0 grid grid-cols-2 grid-rows-2 gap-2">
              {secondaries.map((m) => (
                <button
                  key={m.meatType}
                  type="button"
                  onClick={() => handleCardClick(m.meatType)}
                  disabled={isFullscreen || cardDisplayMode === 'basic'}
                  className={`rounded-2xl px-3.5 py-2.5 flex flex-col justify-between transition-transform min-h-[92px] ${cardSurface} ${
                    !isFullscreen && cardDisplayMode !== 'basic'
                      ? 'cursor-pointer active:translate-y-[1px]'
                      : 'cursor-default'
                  }`}
                >
                  {cardDisplayMode === 'advanced' ? (
                    <>
                      <div className="w-full flex items-center justify-between gap-1">
                        <span className="text-xs xl:text-sm font-black uppercase tracking-tight">
                          {m.meatType}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-black tabular-nums ${
                            isDark
                              ? 'bg-[#33230B] text-[#FCD34D]'
                              : 'bg-[#FEF3C7] text-[#92400E]'
                          }`}
                        >
                          {t('prep.tableMax')} {m.autoMaxTray}
                        </span>
                      </div>
                      <div className="w-full flex items-end justify-between gap-1 mt-1">
                        <div className="flex items-baseline gap-1">
                          <span className="text-2xl xl:text-3xl font-black tabular-nums leading-none">
                            {m.projectedRate.toFixed(1)}
                          </span>
                          <span
                            className={`text-[10px] font-bold ${
                              isDark ? 'text-[#9CA3AF]' : 'text-[#5C574F]'
                            }`}
                          >
                            {unitLabel}
                          </span>
                        </div>
                        <div className="text-right">
                          <div
                            className={`text-lg xl:text-2xl font-black tabular-nums leading-none ${
                              m.hasReal
                                ? 'text-[#15803D] dark:text-[#22C55E]'
                                : isDark
                                  ? 'text-[#6B7280]'
                                  : 'text-[#9C9488]'
                            }`}
                          >
                            {m.displayReal !== null ? m.displayReal.toFixed(1) : isPast ? '…' : '—'}
                          </div>
                          <div className="text-[9px] font-black uppercase text-[#15803D] dark:text-[#22C55E]">
                            {t('prep.real')}
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-1">
                      <span
                        className={`text-xs xl:text-sm font-black uppercase tracking-wider ${
                          isDark ? 'text-[#D1D5DB]' : 'text-[#3F3B35]'
                        }`}
                      >
                        {m.meatType}
                      </span>
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl xl:text-4xl font-black tabular-nums leading-none">
                          {m.displayMainInt}
                        </span>
                        <span
                          className={`text-xs font-extrabold ${
                            isDark ? 'text-[#9CA3AF]' : 'text-[#5C574F]'
                          }`}
                        >
                          {unitLabel}
                        </span>
                      </div>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* PIE DEL PANEL DE PARRILLA: Accesos directos compactos (ocultos en Kiosco si prefieres limpieza; accesibles en Gerente) */}
      <div
        className={`px-2.5 py-2 border-t flex items-center justify-between gap-2 shrink-0 ${panelBorder}`}
      >
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenGuide}
            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-black cursor-pointer active:scale-95 ${footerBtn}`}
          >
            {t('prep.viewGuide')}
          </button>
          <button
            type="button"
            onClick={onOpenDay}
            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-black cursor-pointer active:scale-95 ${footerBtn}`}
          >
            {t('prep.viewDay')}
          </button>
          <button
            type="button"
            onClick={onOpenWaste}
            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-black cursor-pointer active:scale-95 ${footerBtn}`}
          >
            {t('prep.wasteReportBtn')}
          </button>
        </div>

        <span
          className={`text-[10px] font-bold truncate ${
            isDark ? 'text-[#6B7280]' : 'text-[#787165]'
          }`}
        >
          {isFullscreen
            ? t('prep.editLockedKiosk')
            : cardDisplayMode === 'manual'
              ? t('prep.tapMeatToEdit')
              : 'Toast Yield'}
        </span>
      </div>
    </section>
  )
}
