/**
 * @module components/customer-app-v2/styles/V2BrandChrome
 * @description Sistema visual y cromado oficial de Tacos Gavilan App V2: tipografía Gotham Ultra,
 * Outfit e Inter, clases `.v2-showcase-lockup--*` fieles a tacosgavilan.com, isotipo vectorial
 * Gavilan Brand Standards, Dynamic Island iOS respetando `islandOverlayMode`, barra superior
 * de sucursal, barra inferior de 5 pestañas con contador de bolsa/favoritos y loader animado.
 *
 * @businessRules
 * - Respeta estrictamente la marca oficial **Tacos Gavilan** y el diseño visual V2.
 * - Respeta el prop `islandOverlayMode` para controlar el recubrimiento de Dynamic Island en visor iPhone.
 * - La pestaña `order` navega internamente a la Bolsa y Hub de Checkout sin disparar ventanas externas automáticas.
 *
 * @dataFlow
 * - Renderizado por `CustomerAppV2Pro` y etapas `StoriesOnboardingStage` / `WelcomeGateStage`.
 *
 * @notes
 * - Conecta por primera vez `islandOverlayMode` que antes era ignorado en el render.
 */

'use client'

import React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Check,
  ChevronDown,
  Heart,
  Home,
  MapPin,
  ShoppingBag,
  User,
} from 'lucide-react'
import type {
  LockupVariant,
  MainTab,
  V2AuthoritativeStore,
} from '../types'

/**
 * Inyecta exactamente las fuentes oficiales Gotham Ultra / Outfit / Inter y los lockups
 * tipográficos dorados `.v2-showcase-lockup--*` del sitio oficial tacosgavilan.com.
 */
export function V2BrandStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&family=Inter:wght@300;400;500;600;700&display=swap');
      @font-face {
        font-family: 'Gotham Ultra';
        src: url('/tacosgavilan-web/fonts/GothamUltra.otf') format('opentype'),
             url('/tacosgavilan-web/fonts/Gotham%20Ultra.otf') format('opentype');
        font-weight: 900;
        font-style: normal;
        font-display: swap;
      }
      .v2-gotham {
        font-family: 'Gotham Ultra', 'Outfit', 'Montserrat', sans-serif;
        font-weight: 900;
      }
      .v2-outfit {
        font-family: 'Outfit', 'Inter', sans-serif;
      }
      .v2-showcase-lockup {
        --lockup-size: 1.75rem;
        position: relative;
        display: inline-block;
        font-family: 'Gotham Ultra', 'Montserrat', 'Outfit', sans-serif;
        font-weight: 900;
        color: #F5C424;
        line-height: 1;
        text-align: left;
        font-size: var(--lockup-size);
        padding-top: calc(var(--lockup-size) * var(--lockup-pad-top, 0.34));
      }
      .v2-lockup-scale-sm {
        --lockup-size: 1.3rem !important;
      }
      .v2-lockup-scale-md {
        --lockup-size: 1.7rem;
      }
      .v2-lockup-scale-lg {
        --lockup-size: 2.05rem;
      }
      .v2-showcase-lockup-main {
        display: block;
        font-family: 'Gotham Ultra', 'Montserrat', 'Outfit', sans-serif;
        font-weight: 900;
        font-size: var(--lockup-size);
        line-height: 0.82;
        letter-spacing: -0.025em;
        color: #F5C424;
        white-space: nowrap;
      }
      .v2-showcase-lockup-top {
        position: absolute;
        left: var(--prefix-left, 0%);
        bottom: calc(var(--lockup-size) * var(--prefix-bottom, 0.70));
        font-family: 'Gotham Ultra', 'Montserrat', 'Outfit', sans-serif;
        font-weight: 900;
        font-size: calc(var(--lockup-size) * var(--prefix-scale, 0.45));
        line-height: 0.88;
        letter-spacing: -0.01em;
        color: #F5C424;
        white-space: nowrap;
      }
      .v2-showcase-lockup--los-tacos {
        --prefix-left: 24.3%;
        --prefix-scale: 0.45;
        --prefix-bottom: 0.69;
        --lockup-pad-top: 0.32;
      }
      .v2-showcase-lockup--el-burrito {
        --prefix-left: 20.4%;
        --prefix-scale: 0.46;
        --prefix-bottom: 0.69;
        --lockup-pad-top: 0.32;
      }
      .v2-showcase-lockup--super-burrito {
        --prefix-left: 0.5%;
        --prefix-scale: 0.47;
        --prefix-bottom: 0.83;
        --lockup-pad-top: 0.45;
      }
      .v2-showcase-lockup--super-mulita {
        --prefix-left: 0.6%;
        --prefix-scale: 0.47;
        --prefix-bottom: 0.83;
        --lockup-pad-top: 0.45;
      }
      .v2-showcase-lockup--la-torta {
        --prefix-left: 26.4%;
        --prefix-scale: 0.46;
        --prefix-bottom: 0.69;
        --lockup-pad-top: 0.32;
      }
      .v2-showcase-lockup--el-plato {
        --prefix-left: 36.5%;
        --prefix-scale: 0.46;
        --prefix-bottom: 0.69;
        --lockup-pad-top: 0.32;
      }
      .v2-showcase-lockup--los-sopes {
        --prefix-left: 25.1%;
        --prefix-scale: 0.44;
        --prefix-bottom: 0.72;
        --lockup-pad-top: 0.34;
      }
      .v2-showcase-lockup--super-nachos {
        --prefix-left: 21.3%;
        --prefix-scale: 0.43;
        --prefix-bottom: 0.76;
        --lockup-pad-top: 0.36;
      }
      .v2-showcase-lockup--super-quesadilla {
        --lockup-size: 1.45rem;
        --prefix-left: 16.1%;
        --prefix-scale: 0.48;
        --prefix-bottom: 0.82;
        --lockup-pad-top: 0.44;
      }
      .v2-showcase-lockup--la-quesadilla {
        --lockup-size: 1.45rem;
        --prefix-left: 28%;
        --prefix-scale: 0.48;
        --prefix-bottom: 0.82;
        --lockup-pad-top: 0.44;
      }
      .v2-showcase-lockup--las-mulitas {
        --prefix-left: 22%;
        --prefix-scale: 0.45;
        --prefix-bottom: 0.82;
        --lockup-pad-top: 0.44;
      }
      .v2-showcase-lockup--menu-taco {
        --lockup-size: 1.65rem;
        --prefix-left: 15%;
        --prefix-scale: 0.43;
        --prefix-bottom: 0.82;
        --lockup-pad-top: 0.44;
      }
      .v2-showcase-lockup--single {
        --lockup-size: 1.7rem;
        padding-top: 0;
        text-align: center;
      }
      .v2-showcase-lockup--taco-plate {
        --lockup-size: 1.7rem;
        --prefix-left: 32%;
        --prefix-scale: 0.45;
        --prefix-bottom: 0.82;
        --lockup-pad-top: 0.44;
      }
    `}</style>
  )
}

/**
 * Renderiza el lockup oficial Gotham Ultra del platillo.
 */
export function renderWebsiteLockup(
  variant: LockupVariant | string,
  main: string,
  top?: string,
  sizeClass: 'sm' | 'md' | 'lg' = 'md'
) {
  return (
    <span className={`v2-showcase-lockup v2-showcase-lockup--${variant} v2-lockup-scale-${sizeClass}`}>
      {top ? <span className="v2-showcase-lockup-top">{top}</span> : null}
      <span className="v2-showcase-lockup-main">{main}</span>
    </span>
  )
}

/**
 * Oficial "TACOS Gavilan" Wordmark SVG (Gavilan Brand Standards Pages 4, 7, 10, 14-18).
 */
export function GavilanBrandStandardsWordmark({
  className = 'h-[31px] w-auto',
  withTaglineSide = false,
}: {
  className?: string
  withTaglineSide?: boolean
}) {
  return (
    <svg
      viewBox={withTaglineSide ? '535 100 2390 304' : '535 100 1238 304'}
      className={className}
      role="img"
      aria-label={withTaglineSide ? 'Tacos Gavilan — Ya está.' : 'Tacos Gavilan'}
    >
      <g fill="#DA291C">
        <path d="M540.4,288.9v-0.6c0-61.8,48.8-107.8,114-107.8c35.5,0,64.1,11.8,86.6,31.3l-38.7,46.7c-13.6-11.5-28.7-18-45.8-18c-26.9,0-46.4,20.7-46.4,48.8v0.6c0,29.3,20.4,49.3,49.3,49.3c11.8,0,18.3-1.8,23.6-4.7v-20.7h-35.5v-44.3h100.2v95.7c-22.5,18.3-53.8,31-91.3,31C592.1,396.2,540.4,353,540.4,288.9z" />
        <path d="M1387.5,345.4c0-67.9,85.2-58.4,104.7-50.3c0-50.7-71.7-25.3-82.4-21l-11.8-44.6c34.3-17.2,112-23.7,142.9,7.1c22.2,22.2,18.1,47.2,18.1,159.7h-67.1v-20.7C1456.3,413.9,1387.5,396.3,1387.5,345.4z M1492.8,319.3c-0.1,0-38.6-5.7-38.6,21.4c0,13.1,12.6,16.3,18,16.3C1495.6,356.9,1492.8,328.1,1492.8,319.3z" />
        <path d="M778.6,345.4c0-67.9,85.2-58.4,104.7-50.3c0-50.7-71.7-25.3-82.4-21l-11.8-44.6c34.3-17.2,112-23.7,142.9,7.1c22.2,22.2,18.1,47.2,18.1,159.7H883v-20.7C847.5,413.9,778.6,396.3,778.6,345.4z M882.9,319.3c-0.1,0-38.6-5.7-38.6,21.4c0,13.1,12.6,16.3,18,16.3C885.8,356.9,882.9,328.1,882.9,319.3z" />
        <path d="M969.4,216.2h70.3l29.4,90l22.9-90h69.4l-61.9,180h-61.5L969.4,216.2z" />
        <path d="M1188.4,180.2h69.4v54h-69.4V180.2z M1188.4,252.2h69.4v144h-69.4V252.2z" />
        <path d="M1294.6,180.2h67.1v216h-67.1V180.2z" />
        <path d="M1592.7,216.2h67.1v26.3c10.3-13.3,26.6-26.3,49.3-26.3c34,0,55.3,22.5,55.3,58.8v121.2h-67.1v-108c0-13.9-8.3-21.9-18.3-21.9c-10,0-19.2,8-19.2,21.9v108h-67.1V216.2z" />
        <path d="M778.2,125.7h-20.8v-17.5h60.7v17.5h-20.8v54.5h-19.2V125.7z" />
        <path d="M860.9,108.2h18.5l29.5,72h-20.6l-5-12.8h-26.7l-4.9,12.8h-20.2L860.9,108.2z M877.8,152l-7.7-20.3l-7.8,20.3H877.8z" />
        <path d="M922.5,144.4v-0.2c0-20.2,15.5-36,36.5-36c14.1,0,23.2,5.9,29.4,14.4l-14.4,11.2c-4-4.9-8.5-8.1-15.1-8.1c-9.7,0-16.5,8.2-16.5,18.3v0.2c0,10.4,6.8,18.5,16.5,18.5c7.2,0,11.5-3.4,15.6-8.4l14.4,10.3c-6.5,9-15.3,15.6-30.7,15.6C938.4,180.2,922.5,165,922.5,144.4z" />
        <path d="M1006.9,144.4v-0.2c0-19.9,16-36,37.4-36c21.4,0,37.2,15.9,37.2,35.8v0.2c0,19.9-16,36-37.4,36C1022.7,180.2,1006.9,164.2,1006.9,144.4z M1061.9,144.4v-0.2c0-10-7.2-18.7-17.8-18.7c-10.5,0-17.5,8.5-17.5,18.5v0.2c0,10,7.2,18.7,17.7,18.7C1054.9,162.9,1061.9,154.4,1061.9,144.4z" />
        <path d="M1092,168.3l10.7-12.8c6.8,5.4,14.4,8.3,22.4,8.3c5.1,0,7.9-1.8,7.9-4.7v-0.2c0-2.9-2.3-4.5-11.7-6.6c-14.7-3.4-26.1-7.5-26.1-21.8v-0.2c0-12.9,10.2-22.2,26.8-22.2c11.8,0,21,3.2,28.5,9.2l-9.6,13.5c-6.3-4.5-13.3-6.8-19.4-6.8c-4.6,0-6.9,2-6.9,4.5v0.2c0,3.2,2.4,4.5,12,6.7c15.9,3.5,25.8,8.6,25.8,21.6v0.2c0,14.1-11.2,22.5-28,22.5C1112.1,179.8,1100.5,175.9,1092,168.3z" />
      </g>
      {withTaglineSide && (
        <g fill="#FE5000">
          <path d="M1999.2,356.9l3.5-22l19.7-6.3l5.3-33.9l-27.1-88.3l-19.2-5.6l3.3-21l47.6-1.3l22.8,83.3l32.1-55.4l-17.2-5.6l3.3-21l71.6-1.3l-3.5,22.3l-18.7,7.1l-58,90.9l-4.8,29.9l17.7,6.3l-3.5,22H1999.2z" />
          <path d="M2214.3,356.9l8.9-37.5c-1.3,2.5-22.3,40-54.2,40c-22.3,0-36.2-20.2-36.2-45.8c0-63.3,38.2-95.9,77.5-95.9c17.5,0,29.6,9.4,29.6,9.4l7.3-6.8h23l-17.7,110.4l19.5,3.8l-3.3,20L2214.3,356.9z M2229.3,248c0,0-7.3-3-18.5-3c-23.3,0-40,27.1-40,63.8c0,13.4,4.8,21,12.4,21c25.3,0,42.3-60.8,42.3-60.8L2229.3,248z" />
          <path d="M2470.5,339.9c-7.3,5.1-32.7,19.5-59.5,19.5c-30.4,0-50.4-17.2-50.4-46.8c0-55.9,34.7-94.9,76.2-94.9c29.9,0,48.1,14.2,48.1,36.2c0,28.6-31.6,48.6-87.3,49.1c0,22,8.9,27.3,23.8,27.3c14.9,0,32.9-7.3,38.5-9.1L2470.5,339.9z M2433.8,246.3c-15.2,0-28.1,14.4-33.2,34.4c32.1-0.8,47.6-10.9,47.6-22.3C2448.2,250.3,2443.4,246.3,2433.8,246.3z" />
          <path d="M2517.3,330.3c0,0,7.3,2.8,17.5,2.8c13.4,0,21.5-5.1,21.5-14.7c0-20.8-53.7-20.3-53.7-57.7c0-29.6,24.8-43,56.4-43c22.5,0,43,7.1,43,7.1l-6.8,38h-21.8l-1.3-16.5c0,0-5.3-2.3-14.7-2.3c-11.1,0-17.7,5.1-17.7,13.4c0,20.8,54.9,20.5,54.9,56.7c0,29.1-25.8,45.3-61.8,45.3c-22.8,0-44-6.3-44-6.3l6.6-40.5h21.8V330.3z" />
          <path d="M2702.8,344.2c-6.8,4.3-28.4,15.2-43.3,15.2c-20.5,0-29.6-11.4-29.6-33.2c0-4.6,0.3-9.6,1.3-15.2l9.4-59.7h-22.8l3.8-24l23.3-3.3l5.6-34.7l37-7.1l-6.8,41.8h33.9l-4.3,27.3h-33.9l-8.9,54.9c-1,5.6-1.3,8.9-1.3,12.4c0,8.1,3.3,12.4,10.6,12.4c7.3,0,20.5-5.1,20.5-5.1L2702.8,344.2z" />
          <path d="M2799.8,356.9l8.9-37.5c-1.3,2.5-22.3,40-54.2,40c-22.3,0-36.2-20.2-36.2-45.8c0-63.3,38.2-95.9,77.5-95.9c17.5,0,29.6,9.4,29.6,9.4l7.3-6.8h23L2838,330.5l19.5,3.8l-3.3,20L2799.8,356.9z M2814.7,248c0,0-7.3-3-18.5-3c-23.3,0-40,27.1-40,63.8c0,13.4,4.8,21,12.4,21c25.3,0,42.3-60.8,42.3-60.8L2814.7,248z M2842.8,143l-63,43.5l11.6,18.5l64.5-35.7L2842.8,143z" />
          <path d="M2898.7,314.3c11.1,0,18.7,6.8,18.7,18c0,14.7-8.4,27.8-24.8,27.8c-11.1,0-18.2-7.1-18.2-18.2C2874.4,327.3,2882.3,314.3,2898.7,314.3z" />
        </g>
      )}
    </svg>
  )
}

/**
 * Barra superior iOS (hora en LA, señal y Dynamic Island opcional según `islandOverlayMode`).
 */
export function IosStatusBar({
  fullscreenNative,
  islandOverlayMode = true,
  clockText,
}: {
  fullscreenNative?: boolean
  islandOverlayMode?: boolean
  clockText: string
}) {
  if (fullscreenNative) return null

  return (
    <div
      className={`pointer-events-none absolute top-0 inset-x-0 z-40 px-6 flex items-center justify-between text-white text-[11px] font-bold tracking-tight ${
        islandOverlayMode ? 'h-11 pt-2' : 'h-8 pt-1.5 bg-gradient-to-b from-black/70 to-transparent'
      }`}
    >
      <span className="font-mono tracking-tight">{clockText}</span>
      {islandOverlayMode && (
        <div
          aria-hidden="true"
          className="w-[106px] h-[27px] rounded-full bg-black border border-white/10 shadow-[0_2px_10px_rgba(0,0,0,0.9)] flex items-center justify-end pr-2.5"
        >
          <span className="w-2.5 h-2.5 rounded-full bg-[#111827] border border-white/15" />
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <div className="flex items-end gap-[1.5px] h-2.5">
          <span className="w-[2px] h-1 bg-white rounded-full" />
          <span className="w-[2px] h-1.5 bg-white rounded-full" />
          <span className="w-[2px] h-2 bg-white rounded-full" />
          <span className="w-[2px] h-2.5 bg-white rounded-full" />
        </div>
        <span className="text-[9px] font-black">5G</span>
        <div className="w-4 h-2.5 rounded-[3px] border border-white/80 p-[1px] flex items-center">
          <div className="w-full h-full bg-emerald-400 rounded-[1px]" />
        </div>
      </div>
    </div>
  )
}

/**
 * Barra de sucursal activa y selector de idioma dentro de la etapa `main`.
 */
export function TopStoreBar({
  currentStore,
  isOpen,
  badgeText,
  lang,
  islandOverlayMode = true,
  fullscreenNative,
  isDemoPreview,
  demoBadgeLabel,
  onOpenStoreModal,
  onToggleLang,
}: {
  currentStore: V2AuthoritativeStore
  isOpen: boolean
  badgeText: string
  lang: 'es' | 'en'
  islandOverlayMode?: boolean
  fullscreenNative?: boolean
  isDemoPreview?: boolean
  demoBadgeLabel?: string
  onOpenStoreModal: () => void
  onToggleLang: () => void
}) {
  const topPad = fullscreenNative
    ? 'pt-3'
    : islandOverlayMode
    ? 'pt-[48px]'
    : 'pt-9'

  return (
    <div
      className={`shrink-0 bg-[#121212]/95 border-b border-white/10 px-4 pb-2.5 ${topPad} backdrop-blur-xl z-30`}
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onOpenStoreModal}
          className="min-w-0 flex-1 flex items-center gap-2 text-left group cursor-pointer"
        >
          <img
            src="/logo.png?v=75"
            alt="Tacos Gavilan"
            className="w-8 h-8 object-contain shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  isOpen ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
              />
              <span className="text-[9px] font-black uppercase tracking-wider text-white/65 truncate">
                Tacos Gavilan · {badgeText}
              </span>
            </div>
            <div className="flex items-center gap-1 text-xs font-black text-white truncate">
              <MapPin size={12} className="text-[#FFC72C] shrink-0" />
              <span className="truncate">{currentStore.cityTitle}</span>
              <span className="text-[11px] font-bold text-[#FFC72C] truncate">
                ({currentStore.crossStreets})
              </span>
              <ChevronDown
                size={13}
                className="text-[#FFC72C] shrink-0 group-hover:translate-y-0.5 transition-transform"
              />
            </div>
          </div>
        </button>

        <div className="flex items-center gap-1.5 shrink-0">
          {isDemoPreview && demoBadgeLabel && (
            <span className="px-2 py-0.5 rounded-full bg-[#FFC72C]/20 border border-[#FFC72C]/50 text-[#FFC72C] text-[9px] font-black uppercase tracking-wider">
              Demo #12
            </span>
          )}
          <button
            type="button"
            onClick={onToggleLang}
            className="px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 text-white border border-white/15 text-[10px] font-black tracking-wider cursor-pointer transition-colors"
          >
            {lang === 'en' ? 'ES' : 'EN'}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Barra de navegación inferior de 5 pestañas con contador de bolsa en vivo.
 */
export function BottomTabBar({
  activeTab,
  bagCount,
  favoritesCount,
  fullscreenNative,
  labels,
  onSelectTab,
}: {
  activeTab: MainTab
  bagCount: number
  favoritesCount: number
  fullscreenNative?: boolean
  labels: Record<MainTab, string>
  onSelectTab: (tab: MainTab) => void
}) {
  const items: Array<{ id: MainTab; icon: React.ReactNode; badge?: number }> = [
    { id: 'home', icon: <Home size={18} /> },
    { id: 'stores', icon: <MapPin size={18} /> },
    { id: 'order', icon: <ShoppingBag size={19} />, badge: bagCount },
    { id: 'cravings', icon: <Heart size={18} />, badge: favoritesCount },
    { id: 'account', icon: <User size={18} /> },
  ]

  return (
    <div
      className={`shrink-0 bg-[#141416]/95 border-t border-white/10 backdrop-blur-xl px-2 pt-2 ${
        fullscreenNative ? 'pb-3' : 'pb-6'
      } z-30`}
    >
      <div className="grid grid-cols-5 gap-1">
        {items.map((item) => {
          const active = activeTab === item.id
          const isCenterOrder = item.id === 'order'
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`relative flex flex-col items-center justify-center py-1 rounded-xl transition-all cursor-pointer ${
                active
                  ? 'text-[#FFC72C]'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              <div
                className={`relative flex items-center justify-center ${
                  isCenterOrder
                    ? `w-9 h-7 rounded-full ${
                        active
                          ? 'bg-[#DA291C] text-white shadow-[0_4px_14px_rgba(218,41,28,0.5)]'
                          : 'bg-white/10 text-white'
                      }`
                    : ''
                }`}
              >
                {item.icon}
                {typeof item.badge === 'number' && item.badge > 0 && (
                  <span
                    className={`absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-black flex items-center justify-center border border-[#141416] ${
                      isCenterOrder
                        ? 'bg-[#FFC72C] text-[#121212]'
                        : 'bg-[#DA291C] text-white'
                    }`}
                  >
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-extrabold mt-0.5 truncate max-w-full">
                {labels[item.id]}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Overlay de transición con isotipo animado de Tacos Gavilan.
 */
export function BrandTransitionLoader({
  visible,
  label,
  done,
}: {
  visible: boolean
  label: string
  done: boolean
}) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="v2-brand-loader"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-50 bg-black/65 backdrop-blur-sm flex flex-col items-center justify-center"
        >
          <motion.div
            initial={{ scale: 0.75, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.85, opacity: 0 }}
            transition={{ type: 'spring', damping: 16, stiffness: 240 }}
            className="w-28 h-28 rounded-3xl bg-white shadow-[0_25px_60px_rgba(0,0,0,0.65)] flex flex-col items-center justify-center p-3 relative"
          >
            <motion.img
              src="/logo.png?v=75"
              alt="Tacos Gavilan"
              animate={{ rotate: done ? 0 : [0, -8, 8, 0] }}
              transition={{ duration: 0.45 }}
              className="w-18 h-18 object-contain"
            />
            {done && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-lg border-2 border-white"
              >
                <Check size={16} strokeWidth={3} />
              </motion.div>
            )}
          </motion.div>
          {label && (
            <p className="mt-3 text-xs font-black uppercase tracking-widest text-white drop-shadow">
              {label}
            </p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/**
 * Indicador inferior Home Indicator en iPhone visor.
 */
export function IosHomeIndicator({ fullscreenNative }: { fullscreenNative?: boolean }) {
  if (fullscreenNative) return null
  return (
    <div className="absolute bottom-1.5 inset-x-0 z-[75] pointer-events-none flex justify-center">
      <div className="w-[126px] h-[4.5px] rounded-full bg-white/40 shadow-xs" />
    </div>
  )
}
