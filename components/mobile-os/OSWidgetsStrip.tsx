/**
 * @module components/mobile-os/OSWidgetsStrip
 * @description Widgets en vivo de alto impacto para el SpringBoard Mobile & Tablet OS (`/inicio`, `< 1024px`)
 *              de Tacos Gavilan, diseñados con geometría 1:1 de iOS Home Screen:
 *              1) `OSWidgetsStrip` (Banda 1 — tarjeta ancha `4x2` negro mate `#1c1c1e` con barra inferior
 *                 de 4 acciones rápidas).
 *              2) `OSSpotlightMapWidget` (Banda 2 Derecha — widget cuadrado `2x2` estilo buscador de mapa
 *                 con píldora interior y pin multicolor que abre Spotlight Search).
 *              3) `OSGaugesWidget` (Banda 3 Izquierda — widget cuadrado `2x2` estilo Batteries con 4 anillos
 *                 circulares SVG `#34c759` / ámbar / rojo).
 *
 * @businessRules
 * - Consulta `GET /api/mobile-os/summary` con el JWT de `localStorage` (`teg_token`) de manera
 *   100% asíncrona (cero `setState` síncrono en el cuerpo de `useEffect`).
 * - Moneda estrictamente en dólares estadounidenses (`USD`) y marca oficial `Tacos Gavilan`.
 * - Día laboral en `America/Los_Angeles`: `06:00 AM` a `05:59 AM` del día siguiente; turno `PM` desde `05:00 PM`.
 * - Semáforos financieros:
 *   * `Labor %`: verde (`<= 21.5%`), ámbar (`<= 23%`), rojo (`> 23%`), neutro si `0`.
 *   * `Food Cost %`: verde (`<= 32%`), ámbar (`<= 35%`), rojo (`> 35%`), neutro si `0`.
 * - Cuando `summary.financialPulse === null` (ej. `vikesh@tacosgavilan.com`, `asistente`, `planificador`),
 *   muestra exclusivamente métricas operativas y turnos.
 * - Prevención total de divisiones por cero (`0/0`), `NaN` e `Infinity`.
 *
 * @dataFlow
 * - `useMobileOSSummary()` -> `GET /api/mobile-os/summary` -> `{ summary, isLoading, isRefreshing, refreshSummary }`.
 * - Exporta `OSWidgetsStrip` (default), `OSSpotlightMapWidget` y `OSGaugesWidget`.
 *
 * @notes
 * - Todos los textos visibles consumen claves literales bilingües de `useLanguage()` (`lib/i18n.tsx`).
 * - Rótulos exteriores en blanco nítido con sombra suave sobre el fondo difuminado de pantalla de inicio.
 */

'use client'

import React, { useCallback, useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import {
  Calendar,
  CheckSquare,
  ClipboardCheck,
  Clock,
  DollarSign,
  LayoutDashboard,
  RefreshCw,
  SlidersHorizontal,
  TrendingUp,
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { getFoodCostStatus } from '@/lib/inventory/food-cost-sales-resolver'
import {
  openDockEditor,
  type MobileOSSummaryResponse,
} from '@/lib/mobile-os-catalog'

export interface MobileOSSummaryState {
  summary: MobileOSSummaryResponse | null
  isLoading: boolean
  isRefreshing: boolean
  refreshSummary: () => void
}

/**
 * Hook compartido para consultar `/api/mobile-os/summary` una sola vez y alimentar todos los widgets.
 */
export function useMobileOSSummary(): MobileOSSummaryState {
  const [summary, setSummary] = useState<MobileOSSummaryResponse | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false)

  const fetchSummaryData = useCallback(async (isManualRefresh: boolean) => {
    if (typeof window === 'undefined') return
    if (isManualRefresh) {
      setIsRefreshing(true)
    }

    try {
      const token = window.localStorage.getItem('teg_token')
      if (!token) {
        setIsLoading(false)
        setIsRefreshing(false)
        return
      }

      const res = await fetch('/api/mobile-os/summary', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: 'no-store',
      })

      if (res.ok) {
        const json = (await res.json()) as MobileOSSummaryResponse
        setSummary(json)
      }
    } catch {
      // Conserva el último resumen válido ante intermitencias de red
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    let active = true

    const loadInitial = async () => {
      if (typeof window === 'undefined') return
      try {
        const token = window.localStorage.getItem('teg_token')
        if (!token) {
          if (active) setIsLoading(false)
          return
        }
        const res = await fetch('/api/mobile-os/summary', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: 'no-store',
        })
        if (res.ok && active) {
          const json = (await res.json()) as MobileOSSummaryResponse
          setSummary(json)
        }
      } catch {
        // Silencioso en carga inicial
      } finally {
        if (active) setIsLoading(false)
      }
    }

    void loadInitial()

    return () => {
      active = false
    }
  }, [])

  const refreshSummary = useCallback(() => {
    void fetchSummaryData(true)
  }, [fetchSummaryData])

  return {
    summary,
    isLoading,
    isRefreshing,
    refreshSummary,
  }
}

function safeFinite(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function clampRatio(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0 || numerator <= 0) {
    return 0
  }
  return Math.min(1, Math.max(0, numerator / denominator))
}

function formatUsdWhole(amount: number): string {
  const clean = safeFinite(amount)
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(clean)
}

function formatUsdCents(amount: number): string {
  const clean = safeFinite(amount)
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(clean)
}

type SemanticTone = 'green' | 'amber' | 'rose' | 'neutral'

function getLaborTone(laborPct: number): SemanticTone {
  const clean = safeFinite(laborPct)
  if (clean <= 0) return 'neutral'
  if (clean <= 21.5) return 'green'
  if (clean <= 23) return 'amber'
  return 'rose'
}

function getFoodCostTone(foodCostPct: number): SemanticTone {
  const clean = safeFinite(foodCostPct)
  if (clean <= 0) return 'neutral'
  const status = getFoodCostStatus(clean)
  if (status === 'healthy') return 'green'
  if (status === 'warning') return 'amber'
  return 'rose'
}

const TONE_RING_STROKE: Record<SemanticTone, string> = {
  green: '#34c759',
  amber: '#f59e0b',
  rose: '#ff3b30',
  neutral: 'rgba(255,255,255,0.2)',
}

const TONE_DOT_CLASS: Record<SemanticTone, string> = {
  green: 'bg-[#34c759]',
  amber: 'bg-amber-400',
  rose: 'bg-[#ff3b30]',
  neutral: 'bg-white/35',
}

export interface OSWidgetsStripProps {
  firstName: string
  canCustomizeDock: boolean
  summary: MobileOSSummaryResponse | null
  isLoading: boolean
  isRefreshing: boolean
  onRefresh: () => void
  onNavigateModule?: () => void
}

/**
 * Banda 1 (`4x2`): Tarjeta superior negra mate (`#1c1c1e`) estilo widget principal de iOS con
 * nombre del usuario, indicador tipo batería + pulso USD/operativo, emblema derecho, marca de
 * tiempo sobre el divisor y barra inferior segmentada de 4 accesos directos.
 */
export default function OSWidgetsStrip({
  firstName,
  canCustomizeDock,
  summary,
  isLoading,
  isRefreshing,
  onRefresh,
  onNavigateModule,
}: OSWidgetsStripProps) {
  const { t } = useLanguage()

  const financial = summary?.financialPulse ?? null
  const ops = summary?.operationsPulse ?? null
  const role = summary?.role ?? ''
  const shiftLabel =
    summary?.shiftPeriod === 'PM'
      ? t('mobile_os.widget_shift_pm')
      : t('mobile_os.widget_shift_am')

  const laborPct = safeFinite(financial?.laborPct)
  const foodCostPct = safeFinite(financial?.foodCostPct)
  const laborTone = getLaborTone(laborPct)
  const foodTone = getFoodCostTone(foodCostPct)

  const slot1Href = financial ? '/dashboard' : ops?.primaryActionPath || '/checklists'
  const slot1Label = financial
    ? t('mobile_os.widget_open_dashboard')
    : t('mobile_os.widget_open_ops')

  const slot2Href =
    financial && role !== 'auditor'
      ? '/ventas'
      : role === 'auditor'
        ? '/inspecciones'
        : role === 'manager'
          ? '/checklists-manager'
          : ops?.primaryActionPath || '/checklists'
  const slot2Label =
    financial && role !== 'auditor'
      ? t('mobile_os.widget_sales_today')
      : t('mobile_os.widget_ops_title')

  const slot3Href =
    role === 'asistente' || role === 'employee'
      ? '/mis-horarios'
      : ops?.secondaryActionPath || '/planificador'
  const slot3Label = t('mobile_os.widget_open_planner')

  const meterFillPct = financial
    ? Math.max(24, Math.min(100, Math.round(clampRatio(financial.reportingStores || 1, 15) * 100)))
    : ops && ops.shiftsToday > 0
      ? 68
      : 38

  return (
    <div className="flex flex-col items-center w-full">
      <div className="w-full rounded-[28px] bg-gradient-to-b from-[#2b2b2e] via-[#212124] to-[#1a1a1d] text-white shadow-[0_16px_36px_rgba(0,0,0,0.38)] border border-white/[0.08] p-4 relative overflow-hidden">
        <div className="relative z-10 flex items-start justify-between gap-3">
          {/* Izquierda: Nombre + Barra tipo batería + Ventas/Turno + Dirección/Alcance */}
          <Link
            href={slot1Href}
            prefetch={false}
            onClick={onNavigateModule}
            className="min-w-0 flex-1 outline-none"
          >
            <h2 className="text-[20px] sm:text-[22px] font-bold tracking-tight text-white leading-tight truncate">
              {firstName}
            </h2>

            {isLoading && !summary ? (
              <div className="mt-2 space-y-1.5 animate-pulse">
                <div className="h-4 w-32 rounded bg-white/15" />
                <div className="h-3.5 w-44 rounded bg-white/10" />
              </div>
            ) : financial ? (
              <div className="mt-1 space-y-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="inline-flex items-center shrink-0" aria-hidden="true">
                    <div className="w-7 h-3.5 rounded-[4px] bg-white/15 p-[2px] flex items-center">
                      <div
                        className="h-full rounded-[2px] bg-white/65 transition-all duration-500"
                        style={{ width: `${meterFillPct}%` }}
                      />
                    </div>
                    <div className="w-[2px] h-1.5 rounded-r-xs bg-white/30 ml-[1px]" />
                  </div>

                  <span className="text-[15px] sm:text-base font-semibold text-white/80 tabular-nums leading-tight">
                    {formatUsdWhole(financial.netSales)}
                  </span>

                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-white/50">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        financial.isLiveToday ? 'bg-[#34c759]' : 'bg-amber-400'
                      }`}
                    />
                    <span>
                      {financial.isLiveToday
                        ? t('mobile_os.widget_sales_today')
                        : t('mobile_os.widget_sales_latest')}
                    </span>
                  </span>
                </div>

                <p className="text-[12px] sm:text-[13px] font-medium text-white/50 truncate">
                  {summary?.storeScopeLabel}
                  {' • '}
                  {safeFinite(financial.orderCount).toLocaleString('en-US')} {t('mobile_os.widget_orders')}
                  {' • '}
                  {formatUsdCents(financial.avgTicket)}
                </p>

                <div className="pt-1 flex items-center gap-3 text-[11px] font-semibold text-white/65 tabular-nums">
                  <span className="inline-flex items-center gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${TONE_DOT_CLASS[laborTone]}`} />
                    <span>{t('mobile_os.widget_labor')} {laborPct > 0 ? `${laborPct.toFixed(1)}%` : '—'}</span>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${TONE_DOT_CLASS[foodTone]}`} />
                    <span>{t('mobile_os.widget_food_cost')} {foodCostPct > 0 ? `${foodCostPct.toFixed(1)}%` : '—'}</span>
                  </span>
                </div>
              </div>
            ) : (
              <div className="mt-1 space-y-0.5">
                <div className="flex items-center gap-2">
                  <div className="inline-flex items-center shrink-0" aria-hidden="true">
                    <div className="w-7 h-3.5 rounded-[4px] bg-white/15 p-[2px] flex items-center">
                      <div
                        className="h-full rounded-[2px] bg-[#34c759]"
                        style={{ width: `${meterFillPct}%` }}
                      />
                    </div>
                    <div className="w-[2px] h-1.5 rounded-r-xs bg-white/30 ml-[1px]" />
                  </div>
                  <span className="text-[14px] font-semibold text-white/80 truncate">
                    {ops?.myNextShift ? ops.myNextShift.formattedRange : shiftLabel}
                  </span>
                </div>

                <p className="text-[12px] font-medium text-white/50 truncate">
                  {summary?.storeScopeLabel || 'Tacos Gavilan'}
                </p>

                {ops && (
                  <p className="text-[11px] font-medium text-white/60 truncate tabular-nums">
                    {ops.staffChecklistsToday} {t('mobile_os.widget_staff_checklists')}
                    {' • '}
                    {ops.shiftsToday} {t('mobile_os.widget_shifts_today')}
                  </p>
                )}
              </div>
            )}
          </Link>

          {/* Derecha: Emblema visual + Botón Actualizar + Marca de hora encima de la barra */}
          <div className="flex flex-col items-end justify-between shrink-0 self-stretch">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onRefresh}
                title={t('mobile_os.refresh_widgets')}
                aria-label={t('mobile_os.refresh_widgets')}
                className="w-7 h-7 rounded-full bg-white/[0.07] hover:bg-white/15 active:scale-95 border border-white/10 flex items-center justify-center text-white/65 hover:text-white transition-all cursor-pointer outline-none"
              >
                <RefreshCw
                  size={12}
                  className={isRefreshing ? 'animate-spin text-[#34c759]' : ''}
                />
              </button>

              <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-br from-[#3a0b10] via-[#651018] to-[#1d0507] border border-[#fdc82f]/35 shadow-[0_6px_18px_rgba(0,0,0,0.45)] p-2 flex items-center justify-center">
                <Image
                  src="/logo.png"
                  alt="Tacos Gavilan"
                  width={42}
                  height={42}
                  className="w-full h-full object-contain drop-shadow"
                />
              </div>
            </div>

            <span className="mt-2 text-[10px] font-medium text-white/45 tabular-nums">
              {summary?.laTimeLabel || shiftLabel}
            </span>
          </div>
        </div>

        {/* Barra Inferior Segmentada de 4 Acciones (1:1 con la barra de 4 celdas del widget superior) */}
        <div className="mt-2.5 grid grid-cols-4 rounded-[13px] border border-white/[0.07] bg-[#252528] divide-x divide-white/[0.07] overflow-hidden">
          <Link
            href={slot1Href}
            prefetch={false}
            onClick={onNavigateModule}
            title={slot1Label}
            aria-label={slot1Label}
            className="h-11 bg-white/[0.05] hover:bg-white/[0.11] active:bg-white/[0.16] flex items-center justify-center text-white/90 transition-colors outline-none"
          >
            {financial ? <LayoutDashboard size={18} /> : <CheckSquare size={18} />}
          </Link>

          <Link
            href={slot2Href}
            prefetch={false}
            onClick={onNavigateModule}
            title={slot2Label}
            aria-label={slot2Label}
            className="h-11 hover:bg-white/[0.09] active:bg-white/[0.14] flex items-center justify-center text-white/65 hover:text-white transition-colors outline-none"
          >
            {financial && role !== 'auditor' ? (
              <DollarSign size={18} />
            ) : (
              <ClipboardCheck size={18} />
            )}
          </Link>

          <Link
            href={slot3Href}
            prefetch={false}
            onClick={onNavigateModule}
            title={slot3Label}
            aria-label={slot3Label}
            className="h-11 hover:bg-white/[0.09] active:bg-white/[0.14] flex items-center justify-center text-white/65 hover:text-white transition-colors outline-none"
          >
            <Calendar size={18} />
          </Link>

          {canCustomizeDock ? (
            <button
              type="button"
              onClick={() => openDockEditor()}
              title={t('mobile_os.edit_dock')}
              aria-label={t('mobile_os.edit_dock')}
              className="h-11 hover:bg-white/[0.09] active:bg-white/[0.14] flex items-center justify-center text-white/65 hover:text-white transition-colors cursor-pointer outline-none"
            >
              <SlidersHorizontal size={18} />
            </button>
          ) : (
            <button
              type="button"
              onClick={onRefresh}
              title={t('mobile_os.refresh_widgets')}
              aria-label={t('mobile_os.refresh_widgets')}
              className="h-11 hover:bg-white/[0.09] active:bg-white/[0.14] flex items-center justify-center text-white/65 hover:text-white transition-colors cursor-pointer outline-none"
            >
              <RefreshCw size={17} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
          )}
        </div>
      </div>

      <span className="mt-1.5 text-[11px] font-medium text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)] tracking-tight select-none">
        Tacos Gavilan
      </span>
    </div>
  )
}

export interface OSSpotlightMapWidgetProps {
  onOpenSearch: () => void
}

/**
 * Banda 2 Derecha (`2x2`): Widget cuadrado inspirado 1:1 en el widget `Google Maps` de iOS,
 * con trazos vectoriales sutiles de mapa oscuro, píldora superior con pin multicolor y acceso
 * directo a Spotlight Search para abrir cualquier módulo al instante.
 */
export function OSSpotlightMapWidget({ onOpenSearch }: OSSpotlightMapWidgetProps) {
  const { t } = useLanguage()

  return (
    <div className="flex flex-col items-center w-full">
      <button
        type="button"
        onClick={onOpenSearch}
        aria-label={t('mobile_os.spotlight_widget_title')}
        className="w-full aspect-square rounded-[26px] bg-[#1d242b] border border-white/[0.08] shadow-[0_14px_30px_rgba(0,0,0,0.34)] p-3 flex flex-col justify-between relative overflow-hidden text-left cursor-pointer active:scale-[0.98] transition-transform outline-none"
      >
        {/* Geometría vectorial sutil de calles y manzanas en modo oscuro */}
        <svg
          viewBox="0 0 200 200"
          className="pointer-events-none absolute inset-0 w-full h-full"
          aria-hidden="true"
        >
          <rect width="200" height="200" fill="#1d242b" />
          <path
            d="M0 98 Q 68 92 126 38 L 154 0 L 200 0 L 200 72 Q 132 108 0 116 Z"
            fill="#232c35"
          />
          <path
            d="M-10 86 Q 74 82 132 0"
            fill="none"
            stroke="#34404d"
            strokeWidth="8"
            strokeLinecap="round"
          />
          <path
            d="M-10 114 Q 95 104 210 56"
            fill="none"
            stroke="#2c3743"
            strokeWidth="5"
          />
          <path
            d="M88 -10 L 76 92"
            fill="none"
            stroke="#2f3b48"
            strokeWidth="6"
          />
        </svg>

        {/* Píldora interna superior con icono de pin multicolor */}
        <div className="relative z-10 w-full h-11 rounded-full bg-[#2f363f]/95 border border-white/[0.06] px-3 flex items-center shadow-inner">
          <svg
            width="22"
            height="28"
            viewBox="0 0 24 30"
            fill="none"
            aria-hidden="true"
            className="shrink-0"
          >
            <path
              d="M12 1C6.48 1 2 5.48 2 11C2 17.65 10.4 27.1 11.35 28.14C11.71 28.53 12.29 28.53 12.65 28.14C13.6 27.1 22 17.65 22 11C22 5.48 17.52 1 12 1Z"
              fill="#34a853"
            />
            <path
              d="M12 1C6.48 1 2 5.48 2 11C2 13.4 2.86 15.62 4.28 17.4L12 11V1Z"
              fill="#ea4335"
            />
            <path
              d="M12 1V11L19.72 17.4C21.14 15.62 22 13.4 22 11C22 5.48 17.52 1 12 1Z"
              fill="#4285f4"
            />
            <path
              d="M4.28 17.4C6.15 19.78 8.75 22.85 10.45 24.85L15.8 18.5L12 11L4.28 17.4Z"
              fill="#fbbc05"
            />
            <circle cx="12" cy="11" r="4.2" fill="#1d242b" />
          </svg>
        </div>

        {/* Texto inferior izquierdo en 2 líneas */}
        <div className="relative z-10 pt-2">
          <p className="text-[14px] sm:text-[15px] font-medium text-[#cdd6e0] leading-snug line-clamp-2">
            {t('mobile_os.spotlight_widget_title')}
          </p>
        </div>
      </button>

      <span className="mt-1.5 text-[11px] font-medium text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)] tracking-tight truncate max-w-full select-none">
        {t('mobile_os.spotlight_widget_caption')}
      </span>
    </div>
  )
}

interface GaugeRingSpec {
  id: string
  label: string
  displayValue: string
  progress: number
  tone: SemanticTone
  href: string
  icon: React.ReactNode
}

export interface OSGaugesWidgetProps {
  summary: MobileOSSummaryResponse | null
  onNavigateModule?: () => void
}

/**
 * Banda 3 Izquierda (`2x2`): Widget cuadrado esmerilado oscuro con 4 anillos circulares SVG
 * (inspirado 1:1 en el widget `Batteries` de iOS) para indicadores financieros y operativos.
 */
export function OSGaugesWidget({ summary, onNavigateModule }: OSGaugesWidgetProps) {
  const { t } = useLanguage()

  const financial = summary?.financialPulse ?? null
  const ops = summary?.operationsPulse ?? null
  const role = summary?.role ?? ''

  const laborPct = safeFinite(financial?.laborPct)
  const foodCostPct = safeFinite(financial?.foodCostPct)
  const inspections = safeFinite(ops?.inspectionsToday)
  const mgrChecklists = safeFinite(ops?.managerChecklistsToday)
  const staffChecklists = safeFinite(ops?.staffChecklistsToday)
  const shiftsToday = safeFinite(ops?.shiftsToday)

  const rings: GaugeRingSpec[] = financial
    ? [
        {
          id: 'labor',
          label: t('mobile_os.widget_labor'),
          displayValue: laborPct > 0 ? `${laborPct.toFixed(0)}%` : '—',
          progress: laborPct > 0 ? clampRatio(laborPct, 35) : 0,
          tone: getLaborTone(laborPct),
          href: role === 'auditor' ? '/dashboard' : '/ventas',
          icon: <DollarSign size={15} />,
        },
        {
          id: 'food_cost',
          label: t('mobile_os.widget_food_cost'),
          displayValue: foodCostPct > 0 ? `${foodCostPct.toFixed(0)}%` : '—',
          progress: foodCostPct > 0 ? clampRatio(foodCostPct, 50) : 0,
          tone: getFoodCostTone(foodCostPct),
          href: role === 'auditor' ? '/dashboard' : '/admin/food-cost',
          icon: <TrendingUp size={15} />,
        },
        role === 'manager'
          ? {
              id: 'mgr_checklists',
              label: t('mobile_os.widget_mgr_checklists'),
              displayValue: String(mgrChecklists),
              progress: mgrChecklists > 0 ? clampRatio(mgrChecklists, 4) : 0,
              tone: mgrChecklists > 0 ? 'green' : 'neutral',
              href: '/checklists-manager',
              icon: <CheckSquare size={14} />,
            }
          : {
              id: 'inspections',
              label: t('mobile_os.widget_inspections'),
              displayValue: String(inspections),
              progress: inspections > 0 ? clampRatio(inspections, 8) : 0,
              tone: inspections > 0 ? 'green' : 'neutral',
              href: '/inspecciones',
              icon: <ClipboardCheck size={14} />,
            },
        {
          id: 'shifts',
          label: t('mobile_os.widget_shifts_today'),
          displayValue: String(shiftsToday),
          progress: shiftsToday > 0 ? clampRatio(shiftsToday, 40) : 0,
          tone: shiftsToday > 0 ? 'green' : 'neutral',
          href: '/planificador',
          icon: <Clock size={14} />,
        },
      ]
    : [
        {
          id: 'ops_primary',
          label:
            role === 'supervisor' || role === 'admin'
              ? t('mobile_os.widget_inspections')
              : t('mobile_os.widget_staff_checklists'),
          displayValue: String(
            role === 'supervisor' || role === 'admin' ? inspections : staffChecklists
          ),
          progress:
            (role === 'supervisor' || role === 'admin' ? inspections : staffChecklists) > 0
              ? clampRatio(
                  role === 'supervisor' || role === 'admin' ? inspections : staffChecklists,
                  8
                )
              : 0,
          tone:
            (role === 'supervisor' || role === 'admin' ? inspections : staffChecklists) > 0
              ? 'green'
              : 'neutral',
          href: ops?.primaryActionPath || '/checklists',
          icon: <CheckSquare size={14} />,
        },
        {
          id: 'ops_mgr',
          label: t('mobile_os.widget_mgr_checklists'),
          displayValue: String(mgrChecklists),
          progress: mgrChecklists > 0 ? clampRatio(mgrChecklists, 4) : 0,
          tone: mgrChecklists > 0 ? 'green' : 'neutral',
          href: role === 'asistente' ? '/checklists' : '/checklists-manager',
          icon: <ClipboardCheck size={14} />,
        },
        {
          id: 'ops_shifts',
          label: t('mobile_os.widget_shifts_today'),
          displayValue: String(shiftsToday),
          progress: shiftsToday > 0 ? clampRatio(shiftsToday, 25) : 0,
          tone: shiftsToday > 0 ? 'green' : 'neutral',
          href: ops?.secondaryActionPath || '/mis-horarios',
          icon: <Calendar size={14} />,
        },
        {
          id: 'ops_next_shift',
          label: t('mobile_os.widget_next_shift'),
          displayValue: ops?.myNextShift ? 'ON' : '—',
          progress: ops?.myNextShift ? 1 : 0,
          tone: ops?.myNextShift ? 'green' : 'neutral',
          href: role === 'planificador' ? '/planificador' : '/mis-horarios',
          icon: <Clock size={14} />,
        },
      ]

  const radius = 25
  const circumference = 2 * Math.PI * radius

  return (
    <div className="flex flex-col items-center w-full">
      <div className="w-full aspect-square rounded-[26px] bg-[#2a2423]/78 backdrop-blur-2xl border border-white/14 shadow-[0_14px_30px_rgba(0,0,0,0.32)] p-3 grid grid-cols-2 grid-rows-2 gap-2 place-items-center">
        {rings.map((ring) => {
          const dashOffset = circumference * (1 - clampRatio(ring.progress, 1))
          const strokeColor = TONE_RING_STROKE[ring.tone]

          return (
            <Link
              key={ring.id}
              href={ring.href}
              prefetch={false}
              onClick={onNavigateModule}
              title={`${ring.label}: ${ring.displayValue}`}
              className="w-full h-full flex items-center justify-center outline-none active:scale-94 transition-transform"
            >
              <div className="relative w-[60px] h-[60px] sm:w-[66px] sm:h-[66px] flex items-center justify-center">
                <svg
                  viewBox="0 0 60 60"
                  className="w-full h-full -rotate-90"
                  aria-hidden="true"
                >
                  <circle
                    cx="30"
                    cy="30"
                    r={radius}
                    fill="none"
                    stroke="rgba(255,255,255,0.13)"
                    strokeWidth="5.5"
                  />
                  {ring.progress > 0 && (
                    <circle
                      cx="30"
                      cy="30"
                      r={radius}
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth="5.5"
                      strokeLinecap="round"
                      strokeDasharray={circumference}
                      strokeDashoffset={dashOffset}
                    />
                  )}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white leading-none">
                  <span className="text-white/90">{ring.icon}</span>
                  <span className="mt-0.5 text-[9px] font-bold text-white/75 tabular-nums">
                    {ring.displayValue}
                  </span>
                </div>
              </div>
            </Link>
          )
        })}
      </div>

      <span className="mt-1.5 text-[11px] font-medium text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)] tracking-tight truncate max-w-full select-none">
        {t('mobile_os.gauges_title')}
      </span>
    </div>
  )
}
