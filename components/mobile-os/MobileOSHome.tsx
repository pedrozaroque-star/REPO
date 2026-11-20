/**
 * @module components/mobile-os/MobileOSHome
 * @description Pantalla de Inicio (`min-h-[100dvh]`) a pantalla completa estilo iOS SpringBoard
 *              para teléfonos y tablets (`< lg`, `< 1024px`) de Tacos Gavilan (`/inicio`).
 *              Replica con fidelidad 1:1 la composición visual y geométrica de iOS Home Screen:
 *              - Fondo atmosférico difuminado de borde a borde (`fixed inset-0 z-0 lg:hidden`)
 *              - Barra superior translúcida con hora en vivo + píldoras `🌐 Versión Web` y `✏️ Editar Barra`
 *              - 2 páginas deslizables horizontalmente (`activePage: 0 | 1`) con puntos indicadores:
 *                * Página 1 (Geometría exacta de 3 bandas):
 *                  1) Banda 1 (`4x2`): Widget oscuro `#1c1c1e` con nombre, barra de energía, ventas/operación y 4 acciones.
 *                  2) Banda 2 (`2x2` + `2x2`): Primeras 4 carpetas oficiales esmeriladas `3x3` con globo rojo `#ff3b30` a la izquierda + widget `OSSpotlightMapWidget` a la derecha.
 *                  3) Banda 3 (`2x2` + `2x2`): Widget `OSGaugesWidget` de 4 anillos circulares a la izquierda + carpetas restantes / apps favoritas + squircle blanco `Asistente IA` abajo a la derecha.
 *                * Página 2: Cuadrícula completa de iconos squircle individuales a color.
 *              - Píldora translúcida centrada `🔍 Buscar` justo encima del Dock inferior.
 *
 * @businessRules
 * - Exclusivo para dispositivos `< 1024px` cuando `homeViewMode === 'os'`; Desktop (`>= 1024px`) permanece intacto.
 * - Incluye cambio instantáneo de 1 toque (`🌐 Versión Web`) que persiste `homeViewMode: 'web'`.
 * - Los 6 grupos departamentales (`analisis`, `operaciones`, `inventario`, `equipo`, `finanzas`,
 *   `gestion`) se mantienen estrictamente oficiales y no editables.
 * - El squircle blanco `Asistente IA` dispara `CustomEvent('teg:open-support-chat')` para abrir el chat IA en 1 toque.
 * - Al tocar `customer_app`, despliega la hoja de acción OS (`Versión 1`, `Versión 2`, `Pantalla Completa`).
 *
 * @dataFlow
 * - `useAuth()` (`ProtectedRoute`) + `useLanguage()` (`lib/i18n`) + `useMobileDockPreferences(user, t)`
 *   (`lib/mobile-os-catalog`) + `useMobileOSSummary()` (`OSWidgetsStrip`).
 *
 * @notes
 * - Todos los campos de búsqueda usan `text-base` (`16px`) para evitar auto-zoom en Safari iOS.
 * - Cero `@typescript-eslint/no-explicit-any` y cero `react-hooks/set-state-in-effect`.
 */

'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ExternalLink,
  Globe,
  Navigation,
  Search,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Star,
  X,
} from 'lucide-react'
import { useAuth } from '@/components/ProtectedRoute'
import { useLanguage } from '@/lib/i18n'
import {
  FAVORITES_STORAGE_KEY,
  HazardTapeIcon,
  normalizeOSSearch,
  openDockEditor,
  OS_SECTION_THEMES,
  useMobileDockPreferences,
  type OSGroupId,
  type OSModuleGroup,
  type OSModuleItem,
} from '@/lib/mobile-os-catalog'
import OSWidgetsStrip, {
  OSGaugesWidget,
  OSSpotlightMapWidget,
  useMobileOSSummary,
} from '@/components/mobile-os/OSWidgetsStrip'
import OSFolderModal from '@/components/mobile-os/OSFolderModal'

export const FAVORITES_UPDATED_EVENT = 'teg:favorites-updated'

const DEFAULT_QUICK_APP_PRIORITY: readonly string[] = [
  'dashboard',
  'sales',
  'basecamp',
  'planner',
  'bodega_orders',
  'prep',
  'manager',
  'assistants',
  'supervisor',
  'phone_agent',
  'blindaje_delivery',
  'actividades',
  'my_schedule',
  'training',
  'viele_sons',
  'food_cost_margins',
  'discounts',
  'drive_thru_leaderboard',
  'feedback',
  'safe',
]

function readFavoriteIdsSnapshot(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string' && v.length > 0)
  } catch {
    return []
  }
}

/**
 * Emblema geométrico negro sobre fondo blanco para el icono `Asistente IA` (inspirado en el
 * squircle blanco limpio de IA en la esquina inferior derecha del iPhone).
 */
const AIAssistantKnotGlyph = ({ size = 28 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 2.75a4.25 4.25 0 0 1 3.92 2.61 4.25 4.25 0 0 1 3.72 6.32 4.25 4.25 0 0 1-1.62 5.86 4.25 4.25 0 0 1-6.02 3.71 4.25 4.25 0 0 1-5.92-2.61 4.25 4.25 0 0 1-1.72-6.32 4.25 4.25 0 0 1 1.62-5.86A4.25 4.25 0 0 1 12 2.75Z" />
    <circle cx="12" cy="12" r="2.7" />
  </svg>
)

type BandSlotEntry =
  | { kind: 'folder'; group: OSModuleGroup }
  | { kind: 'app'; item: OSModuleItem }
  | { kind: 'ai_assistant' }

export default function MobileOSHome() {
  const { user } = useAuth()
  const { t } = useLanguage()
  const {
    permittedGroups,
    permittedModulesMap,
    canCustomizeDock,
    setHomeViewMode,
  } = useMobileDockPreferences(user, t)

  const { summary, isLoading, isRefreshing, refreshSummary } = useMobileOSSummary()

  const [favoriteIds, setFavoriteIds] = useState<string[]>(readFavoriteIdsSnapshot)
  const [activePage, setActivePage] = useState<0 | 1>(0)
  const [openFolderId, setOpenFolderId] = useState<OSGroupId | null>(null)
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false)
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [customerAppSheetOpen, setCustomerAppSheetOpen] = useState<boolean>(false)
  const [fallbackClock, setFallbackClock] = useState<string>('--:--')

  const searchInputRef = useRef<HTMLInputElement>(null)
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const computeLaClock = () =>
      new Date()
        .toLocaleTimeString('en-US', {
          timeZone: 'America/Los_Angeles',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        })
        .replace(/\s*(AM|PM)$/i, '')

    const rafId = window.requestAnimationFrame(() => {
      setFallbackClock(computeLaClock())
    })
    const intervalId = window.setInterval(() => {
      setFallbackClock(computeLaClock())
    }, 30_000)

    return () => {
      window.cancelAnimationFrame(rafId)
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    const syncFavorites = () => {
      setFavoriteIds(readFavoriteIdsSnapshot())
    }
    window.addEventListener(FAVORITES_UPDATED_EVENT, syncFavorites)
    window.addEventListener('storage', syncFavorites)
    return () => {
      window.removeEventListener(FAVORITES_UPDATED_EVENT, syncFavorites)
      window.removeEventListener('storage', syncFavorites)
    }
  }, [])

  const toggleFavorite = useCallback((e: React.MouseEvent, moduleId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setFavoriteIds((prev) => {
      const next = prev.includes(moduleId)
        ? prev.filter((id) => id !== moduleId)
        : [...prev, moduleId]
      try {
        window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(next))
        window.dispatchEvent(new CustomEvent(FAVORITES_UPDATED_EVENT))
      } catch {
        // ignore quota errors
      }
      return next
    })
  }, [])

  const handleLaunchModule = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('teg:expand-sidebar'))
    }
  }, [])

  const handleOpenSupportChat = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('teg:open-support-chat'))
    }
  }, [])

  const openSpotlightSearch = useCallback(() => {
    setIsSearchOpen(true)
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus()
    })
  }, [])

  const closeSpotlightSearch = useCallback(() => {
    setSearchQuery('')
    setIsSearchOpen(false)
    searchInputRef.current?.blur()
  }, [])

  const firstName = useMemo(() => {
    const rawName = (user?.name || '').trim()
    if (!rawName) return 'Tacos Gavilan'
    return rawName.split(/\s+/)[0] || rawName
  }, [user?.name])

  const statusBarClock = summary?.laTimeLabel
    ? summary.laTimeLabel.replace(/\s*(AM|PM)$/i, '')
    : fallbackClock

  const activeFolderGroup = useMemo(() => {
    if (!openFolderId) return null
    return permittedGroups.find((g) => g.id === openFolderId) ?? null
  }, [openFolderId, permittedGroups])

  // Lista priorizada de módulos individuales (Favoritos fijados -> Módulos frecuentes del rol)
  const orderedQuickApps = useMemo(() => {
    const list: OSModuleItem[] = []
    const seen = new Set<string>()

    for (const favId of favoriteIds) {
      const item = permittedModulesMap.get(favId)
      if (item && !seen.has(item.id)) {
        seen.add(item.id)
        list.push(item)
      }
    }

    for (const candidateId of DEFAULT_QUICK_APP_PRIORITY) {
      const item = permittedModulesMap.get(candidateId)
      if (item && !seen.has(item.id)) {
        seen.add(item.id)
        list.push(item)
      }
    }

    for (const group of permittedGroups) {
      for (const item of group.items) {
        if (!seen.has(item.id)) {
          seen.add(item.id)
          list.push(item)
        }
      }
    }

    return list
  }, [favoriteIds, permittedModulesMap, permittedGroups])

  // Distribución exacta para la Página 1 (3 Bandas asimétricas idénticas a la captura de iOS):
  // - Banda 2 Izquierda (2x2 = 4 celdas): Primeras 4 carpetas oficiales (rellenando con apps si el rol tiene < 4 carpetas).
  // - Banda 3 Derecha (2x2 = 4 celdas): Carpetas oficiales restantes (slots 4..5) + apps rápidas en las primeras 3 celdas,
  //   y el squircle blanco `Asistente IA` fijo en la 4ª celda (abajo a la derecha).
  const page1Quadrants = useMemo(() => {
    const band2Left: BandSlotEntry[] = []
    const band3Right: BandSlotEntry[] = []
    let appCursor = 0

    const firstFolders = permittedGroups.slice(0, 4)
    for (const folder of firstFolders) {
      band2Left.push({ kind: 'folder', group: folder })
    }
    while (band2Left.length < 4 && appCursor < orderedQuickApps.length) {
      band2Left.push({ kind: 'app', item: orderedQuickApps[appCursor] })
      appCursor += 1
    }

    const remainingFolders = permittedGroups.slice(4, 6)
    for (const folder of remainingFolders) {
      if (band3Right.length < 3) {
        band3Right.push({ kind: 'folder', group: folder })
      }
    }
    while (band3Right.length < 3 && appCursor < orderedQuickApps.length) {
      band3Right.push({ kind: 'app', item: orderedQuickApps[appCursor] })
      appCursor += 1
    }

    // 4ª celda (abajo a la derecha): Asistente IA estilo squircle blanco
    band3Right.push({ kind: 'ai_assistant' })

    return { band2Left, band3Right }
  }, [permittedGroups, orderedQuickApps])

  // Página 2: hasta 20 apps individuales en cuadrícula SpringBoard
  const page2Apps = useMemo(() => {
    return orderedQuickApps.slice(0, 19)
  }, [orderedQuickApps])

  const normalizedQuery = normalizeOSSearch(searchQuery)
  const isSearching = normalizedQuery.length > 0

  const searchResults = useMemo(() => {
    if (!normalizedQuery) return []
    const matches: OSModuleItem[] = []
    const seen = new Set<string>()

    for (const group of permittedGroups) {
      const groupTitleNorm = normalizeOSSearch(group.title)
      for (const item of group.items) {
        if (seen.has(item.id)) continue
        const matched =
          normalizeOSSearch(item.title).includes(normalizedQuery) ||
          normalizeOSSearch(item.shortTitle).includes(normalizedQuery) ||
          normalizeOSSearch(item.description).includes(normalizedQuery) ||
          groupTitleNorm.includes(normalizedQuery)
        if (matched) {
          seen.add(item.id)
          matches.push(item)
        }
      }
    }
    return matches
  }, [permittedGroups, normalizedQuery])

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (isSearching || isSearchOpen) return
    const touch = e.touches[0]
    if (!touch) return
    swipeStartRef.current = { x: touch.clientX, y: touch.clientY }
  }

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current
    swipeStartRef.current = null
    if (!start || isSearching || isSearchOpen) return
    const touch = e.changedTouches[0]
    if (!touch) return
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.25) {
      if (dx < 0 && activePage === 0) {
        setActivePage(1)
      } else if (dx > 0 && activePage === 1) {
        setActivePage(0)
      }
    }
  }

  const renderFrostedFolderTile = (group: OSModuleGroup) => {
    const previewItems = group.items.slice(0, 9)
    const fallbackTheme = OS_SECTION_THEMES[group.id] || OS_SECTION_THEMES.operaciones

    return (
      <button
        key={`folder-${group.id}`}
        type="button"
        onClick={() => setOpenFolderId(group.id)}
        className="flex flex-col items-center gap-1.5 w-full group/folder cursor-pointer outline-none select-none"
      >
        <div className="w-full max-w-[74px] aspect-square rounded-[18px] bg-white/24 backdrop-blur-2xl border border-white/28 p-2 shadow-[0_8px_20px_rgba(0,0,0,0.18)] relative group-active/folder:scale-94 transition-transform">
          {/* Globo rojo #ff3b30 estilo iOS en esquina superior derecha */}
          <span className="absolute -top-1.5 -right-1.5 z-10 inline-flex items-center justify-center bg-[#ff3b30] text-white text-[11px] font-semibold leading-none rounded-full px-1.5 min-w-[21px] h-[21px] shadow-sm">
            {group.items.length}
          </span>

          {/* Mosaico 3x3 de mini iconos vivos */}
          <div className="grid grid-cols-3 grid-rows-3 gap-1 w-full h-full">
            {Array.from({ length: 9 }).map((_, cellIdx) => {
              const miniItem = previewItems[cellIdx]
              if (!miniItem) {
                return <div key={`empty-${group.id}-${cellIdx}`} />
              }
              return (
                <div
                  key={miniItem.id}
                  className={`w-full h-full rounded-[4px] ${
                    miniItem.appTileBg || fallbackTheme.squircleGradient
                  } text-white flex items-center justify-center shadow-2xs`}
                >
                  {miniItem.renderIcon(9)}
                </div>
              )
            })}
          </div>
        </div>

        <span className="text-[11px] font-medium text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)] tracking-tight truncate max-w-full text-center leading-tight">
          {group.title}
        </span>
      </button>
    )
  }

  const renderSquircleAppTile = (item: OSModuleItem, keyPrefix: string) => {
    const isFav = favoriteIds.includes(item.id)

    const iconBox = (
      <div className="relative w-full max-w-[64px] aspect-square flex items-center justify-center">
        <div
          className={`w-full h-full rounded-[15px] ${item.appTileBg} text-white flex items-center justify-center shadow-[0_8px_20px_rgba(0,0,0,0.26)] ring-1 ring-inset ring-white/22 group-active/app:scale-92 transition-transform`}
        >
          {item.renderIcon(28)}
        </div>

        {item.badgeType === 'new' && (
          <span className="new-badge-animated absolute -top-1.5 -right-1.5 z-10 bg-[#ff3b30] text-white text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full shadow-xs leading-none">
            {item.badgeLabel || 'NEW'}
          </span>
        )}
        {item.badgeType === 'beta' && (
          <span className="absolute -top-1.5 -right-1.5 z-10 bg-purple-600 text-white text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full shadow-xs border border-white/35 leading-none">
            {item.badgeLabel || 'BETA'}
          </span>
        )}
        {item.badgeType === 'building' && (
          <span className="absolute -top-1.5 -right-1.5 z-10 bg-amber-400/95 p-0.5 rounded shadow-xs border border-slate-900/30 leading-none">
            <HazardTapeIcon size={12} />
          </span>
        )}
        {isFav && (
          <span
            className="absolute -bottom-1 -left-1 z-10 w-4 h-4 rounded-full bg-amber-400 text-slate-950 border border-white/75 flex items-center justify-center shadow-2xs"
            aria-hidden="true"
          >
            <Star size={8} fill="currentColor" />
          </span>
        )}
        {item.openInNewTab && (
          <span
            className="absolute -bottom-1 -right-1 z-10 w-4 h-4 rounded-full bg-slate-900/90 text-white border border-white/30 flex items-center justify-center shadow-2xs"
            aria-hidden="true"
          >
            <ExternalLink size={8} />
          </span>
        )}
      </div>
    )

    if (item.id === 'customer_app') {
      return (
        <button
          key={`${keyPrefix}-${item.id}`}
          type="button"
          onClick={() => setCustomerAppSheetOpen(true)}
          className="group/app flex flex-col items-center gap-1.5 w-full cursor-pointer outline-none select-none"
        >
          {iconBox}
          <span className="text-[11px] font-medium text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)] tracking-tight truncate max-w-full text-center leading-tight">
            {item.shortTitle || item.title}
          </span>
        </button>
      )
    }

    return (
      <Link
        key={`${keyPrefix}-${item.id}`}
        href={item.path}
        prefetch={false}
        target={item.openInNewTab ? '_blank' : undefined}
        rel={item.openInNewTab ? 'noopener noreferrer' : undefined}
        onClick={handleLaunchModule}
        className="group/app flex flex-col items-center gap-1.5 w-full outline-none select-none"
      >
        {iconBox}
        <span className="text-[11px] font-medium text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)] tracking-tight truncate max-w-full text-center leading-tight">
          {item.shortTitle || item.title}
        </span>
      </Link>
    )
  }

  const renderAIAssistantSquircle = (keyPrefix: string) => (
    <button
      key={`${keyPrefix}-ai-assistant`}
      type="button"
      onClick={handleOpenSupportChat}
      className="group/ai flex flex-col items-center gap-1.5 w-full cursor-pointer outline-none select-none"
    >
      <div className="w-full max-w-[64px] aspect-square rounded-[15px] bg-white text-slate-950 flex items-center justify-center shadow-[0_8px_22px_rgba(0,0,0,0.28)] ring-1 ring-black/5 group-active/ai:scale-92 transition-transform">
        <AIAssistantKnotGlyph size={30} />
      </div>
      <span className="text-[11px] font-medium text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)] tracking-tight truncate max-w-full text-center leading-tight">
        {t('mobile_os.ai_assistant_app')}
      </span>
    </button>
  )

  const renderBandSlot = (entry: BandSlotEntry, keyPrefix: string) => {
    if (entry.kind === 'folder') {
      return renderFrostedFolderTile(entry.group)
    }
    if (entry.kind === 'ai_assistant') {
      return renderAIAssistantSquircle(keyPrefix)
    }
    return renderSquircleAppTile(entry.item, keyPrefix)
  }

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className="relative min-h-[100dvh] w-full select-none overflow-x-clip"
    >
      {/* Fondo Atmosférico Difuminado a Pantalla Completa (borde a borde detrás del contenido y del Dock) */}
      <div
        className="fixed inset-0 z-0 lg:hidden pointer-events-none overflow-hidden bg-[#8b7369]"
        aria-hidden="true"
      >
        <div className="absolute inset-0 bg-gradient-to-b from-[#9ea5ad] via-[#7c5d55] to-[#b29b8b]" />
        <div className="absolute -top-16 inset-x-0 h-64 bg-gradient-to-b from-[#adb4bc]/90 to-transparent blur-2xl" />
        <div className="absolute top-[24%] -left-16 w-80 h-80 rounded-full bg-[#593631]/80 blur-3xl" />
        <div className="absolute top-[30%] -right-12 w-80 h-80 rounded-full bg-[#754d44]/75 blur-3xl" />
        <div className="absolute top-[56%] left-[12%] w-72 h-72 rounded-full bg-[#bca799]/65 blur-3xl" />
        <div className="absolute bottom-0 inset-x-0 h-56 bg-gradient-to-t from-[#a88e7c]/85 via-[#b59f8f]/55 to-transparent blur-2xl" />
      </div>

      {/* Lienzo Principal SpringBoard */}
      <div className="relative z-10 min-h-[100dvh] w-full max-w-[430px] md:max-w-[640px] mx-auto px-4 sm:px-5 pt-2.5 pb-[calc(104px+env(safe-area-inset-bottom))] flex flex-col justify-between gap-3">
        {/* Fila Superior Estilo Status Bar de iOS + Píldoras Translúcidas de Acción */}
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="flex flex-col items-start">
            <div className="inline-flex items-center gap-1 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)]">
              <span className="text-[15px] font-bold tracking-tight tabular-nums leading-none">
                {statusBarClock}
              </span>
              <Navigation size={11} className="fill-white text-white" />
            </div>
            <span className="w-11 h-[2.5px] rounded-full bg-white/85 mt-1" aria-hidden="true" />
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setHomeViewMode('web')}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-black/26 hover:bg-black/38 backdrop-blur-xl text-white border border-white/25 shadow-xs active:scale-95 transition-all cursor-pointer outline-none"
            >
              <Globe size={11} className="text-[#fdc82f]" />
              <span>{t('mobile_os.switch_to_web')}</span>
            </button>

            {canCustomizeDock && (
              <button
                type="button"
                onClick={() => openDockEditor()}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-white/24 hover:bg-white/34 backdrop-blur-xl text-white border border-white/30 shadow-xs active:scale-95 transition-all cursor-pointer outline-none"
              >
                <SlidersHorizontal size={11} />
                <span>{t('mobile_os.edit_dock')}</span>
              </button>
            )}
          </div>
        </div>

        {/* Barra Spotlight Desplegable cuando el usuario toca Buscar */}
        <AnimatePresence initial={false}>
          {(isSearchOpen || isSearching) && (
            <motion.div
              key="spotlight-bar"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.16 }}
              className="relative"
            >
              <Search
                size={16}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/75 pointer-events-none"
              />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    closeSpotlightSearch()
                  }
                }}
                placeholder={t('mobile_os.search_apps_placeholder')}
                className="w-full pl-10 pr-10 py-2.5 rounded-2xl bg-black/40 backdrop-blur-2xl border border-white/28 text-base text-white placeholder-white/65 shadow-lg focus:outline-none focus:ring-2 focus:ring-white/40"
              />
              <button
                type="button"
                onClick={closeSpotlightSearch}
                title={t('mobile_os.folder_close')}
                aria-label={t('mobile_os.folder_close')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white/20 text-white flex items-center justify-center hover:bg-white/30 cursor-pointer outline-none"
              >
                <X size={14} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Cuerpo Central: Resultados Spotlight o Páginas Deslizables del SpringBoard */}
        <div className="flex-1 flex flex-col justify-center">
          {isSearching ? (
            searchResults.length === 0 ? (
              <div className="rounded-[28px] bg-black/35 backdrop-blur-2xl border border-white/22 p-8 text-center space-y-2 text-white">
                <p className="text-sm font-bold">{t('home_hub.no_results_title')}</p>
                <p className="text-xs text-white/75">{t('home_hub.no_results_desc')}</p>
                <button
                  type="button"
                  onClick={closeSpotlightSearch}
                  className="mt-2 inline-flex items-center justify-center px-4 py-2 rounded-full bg-white/22 hover:bg-white/32 border border-white/30 text-white text-xs font-semibold transition-colors cursor-pointer outline-none"
                >
                  {t('home_hub.clear_filters')}
                </button>
              </div>
            ) : (
              <div className="py-2 grid grid-cols-4 md:grid-cols-6 gap-x-3.5 gap-y-4 items-start">
                {searchResults.map((item) => renderSquircleAppTile(item, 'search'))}
              </div>
            )
          ) : activePage === 0 ? (
            <motion.div
              key="springboard-page-0"
              initial={{ opacity: 0.92, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.18 }}
              className="space-y-4"
            >
              {/* BANDA 1 (4x2): Tarjeta Oscura Principal con 4 Acciones Rápidas */}
              <OSWidgetsStrip
                firstName={firstName}
                canCustomizeDock={canCustomizeDock}
                summary={summary}
                isLoading={isLoading}
                isRefreshing={isRefreshing}
                onRefresh={refreshSummary}
                onNavigateModule={handleLaunchModule}
              />

              {/* BANDA 2 (Izquierda 2x2 Carpetas + Derecha 2x2 Buscador Mapa) */}
              <div className="grid grid-cols-2 gap-4 items-start">
                <div className="grid grid-cols-2 gap-x-3 gap-y-3 items-start">
                  {page1Quadrants.band2Left.map((entry, idx) =>
                    renderBandSlot(entry, `b2-${idx}`)
                  )}
                </div>

                <OSSpotlightMapWidget onOpenSearch={openSpotlightSearch} />
              </div>

              {/* BANDA 3 (Izquierda 2x2 Anillos Batteries + Derecha 2x2 Carpetas/Apps + Asistente IA) */}
              <div className="grid grid-cols-2 gap-4 items-start">
                <OSGaugesWidget
                  summary={summary}
                  onNavigateModule={handleLaunchModule}
                />

                <div className="grid grid-cols-2 gap-x-3 gap-y-3 items-start">
                  {page1Quadrants.band3Right.map((entry, idx) =>
                    renderBandSlot(entry, `b3-${idx}`)
                  )}
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="springboard-page-1"
              initial={{ opacity: 0.92, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.18 }}
              className="space-y-3 py-1"
            >
              <div className="grid grid-cols-4 md:grid-cols-6 gap-x-3.5 gap-y-4 items-start">
                {page2Apps.map((item) => renderSquircleAppTile(item, 'p2'))}
                {renderAIAssistantSquircle('p2')}
              </div>
            </motion.div>
          )}
        </div>

        {/* Pie encima del Dock: Puntos de Página + Píldora Translúcida Centrada `🔍 Buscar` */}
        {!isSearching && (
          <div className="pt-1 flex flex-col items-center gap-2">
            <div className="inline-flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActivePage(0)}
                aria-label="1"
                className={`h-1.5 rounded-full transition-all cursor-pointer outline-none ${
                  activePage === 0 ? 'w-4 bg-white' : 'w-1.5 bg-white/45 hover:bg-white/70'
                }`}
              />
              <button
                type="button"
                onClick={() => setActivePage(1)}
                title={t('mobile_os.page_apps')}
                aria-label={t('mobile_os.page_apps')}
                className={`h-1.5 rounded-full transition-all cursor-pointer outline-none ${
                  activePage === 1 ? 'w-4 bg-white' : 'w-1.5 bg-white/45 hover:bg-white/70'
                }`}
              />
            </div>

            <button
              type="button"
              onClick={openSpotlightSearch}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-white/22 hover:bg-white/30 backdrop-blur-xl border border-white/25 text-white text-xs font-medium shadow-xs active:scale-95 transition-all cursor-pointer outline-none"
            >
              <Search size={12} />
              <span>{t('mobile_os.search_pill')}</span>
            </button>
          </div>
        )}
      </div>

      {/* Modal Expandido de Carpeta Oficial No Editable */}
      <OSFolderModal
        group={activeFolderGroup}
        favoriteIds={favoriteIds}
        onToggleFavorite={toggleFavorite}
        onClose={() => setOpenFolderId(null)}
        onOpenCustomerApp={() => setCustomerAppSheetOpen(true)}
        onLaunchModule={handleLaunchModule}
      />

      {/* Mini Hoja de Acción OS para App Clientes (Versión 1 / Versión 2 / Pantalla Completa) */}
      <AnimatePresence>
        {customerAppSheetOpen && (
          <motion.div
            key="customer-app-sheet"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={() => setCustomerAppSheetOpen(false)}
            className="fixed inset-0 z-[135] bg-black/55 backdrop-blur-2xl flex items-end sm:items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, y: 28, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-[28px] bg-white/95 dark:bg-slate-900/95 backdrop-blur-2xl border border-white/60 dark:border-slate-700/80 shadow-2xl p-5 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-rose-500 to-red-600 text-white flex items-center justify-center shadow-sm">
                    <Smartphone size={20} />
                  </div>
                  <h4 className="text-base font-black text-slate-900 dark:text-white tracking-tight">
                    {t('mobile_os.customer_app_choose')}
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={() => setCustomerAppSheetOpen(false)}
                  title={t('mobile_os.folder_close')}
                  aria-label={t('mobile_os.folder_close')}
                  className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center cursor-pointer outline-none"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="space-y-2 pt-1">
                <a
                  href="/app?v=1"
                  onClick={() => setCustomerAppSheetOpen(false)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-sm font-bold border border-slate-200 dark:border-slate-700 transition-colors outline-none"
                >
                  <span>{t('items.customer_app_v1')}</span>
                  <Smartphone size={16} className="text-slate-400" />
                </a>

                <a
                  href="/app?v=2"
                  onClick={() => setCustomerAppSheetOpen(false)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-2xl bg-gradient-to-r from-[#50050a] to-red-700 text-[#FDC82F] text-sm font-black border border-[#FDC82F]/50 shadow-sm transition-transform active:scale-98 outline-none"
                >
                  <span className="inline-flex items-center gap-2">
                    <Sparkles size={15} />
                    <span>{t('items.customer_app_v2')}</span>
                  </span>
                  <Smartphone size={16} />
                </a>

                <a
                  href="/app?v=2&fullscreen=1"
                  onClick={() => setCustomerAppSheetOpen(false)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-2xl bg-[#FDC82F] hover:bg-amber-400 text-slate-950 text-sm font-black border border-amber-500 shadow-sm transition-transform active:scale-98 outline-none"
                >
                  <span>{t('items.customer_app_fullscreen')}</span>
                  <Smartphone size={16} />
                </a>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
