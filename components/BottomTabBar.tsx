/**
 * @module components/BottomTabBar
 * @description Barra de navegación inferior móvil y Dock flotante de tablet (`lg:hidden`, `< 1024px`) personalizable
 * estilo sistema operativo (`OS Dock` en `Modo OS` y barra anclada clásica en `Versión Web`).
 *
 * @businessRules
 * - En roles restringidos de módulo único (`isPlanificadorOnly` -> `/planificador`, `isBasecampOnly` -> `/basecamp`, `isEmployeeOnly` -> `/mis-horarios`),
 *   renderiza únicamente su pestaña asignada con personalización deshabilitada (`canCustomizeDock === false`).
 * - Para el resto de roles, mantiene fijos los extremos `Inicio` (`/inicio`) a la izquierda y `Más` (`__drawer__`) a la derecha,
 *   permitiendo personalizar de 1 a 4 accesos directos intermedios (`dockItems`) persistidos por usuario.
 * - Resolución inteligente de ruta activa (`resolveActiveDockIndex`): prioriza `Más` cuando `isDrawerOpen` es `true`,
 *   evalúa coincidencia por prefijo más largo (`longest path prefix`) y respeta `STANDALONE_SIBLING_PATHS` para que
 *   subrutas hermanas independientes como `/ventas/reportes` nunca iluminen falsamente `/ventas` salvo que `/ventas/reportes`
 *   también esté anclado en la barra.
 * - Soporta apertura del editor (`DockEditorSheet`) tanto por evento global `DOCK_OPEN_EDITOR_EVENT` (`'teg:open-dock-editor'`)
 *   como mediante gesto de pulsación larga (`long-press` ~450ms con cancelación por movimiento `>10px`, vibración háptica sutil
 *   y bloqueo de navegación accidental al soltar el dedo).
 *
 * @dataFlow
 * - Consume `useAuth()` de `ProtectedRoute`, `useLanguage()` de `lib/i18n.tsx` y `useMobileDockPreferences()` de `lib/mobile-os-catalog.tsx`.
 * - Se coordina con `components/ClientLayout.tsx` (`onOpenDrawer`, `isDrawerOpen`) y monta `components/mobile-os/DockEditorSheet.tsx`.
 *
 * @notes
 * - En `Modo OS` (`isOSGlassMode`), renderiza una cápsula translúcida estilo iOS Home Screen Dock (`rounded-[34px]`, `backdrop-blur-2xl`)
 *   con iconos `squircle` sólidos de alto impacto (`54px–58px`, `rounded-[14px]`), ocultando etiquetas de texto en `/inicio` para paridad 1:1
 *   con el Home Screen de iPhone y mostrando etiquetas compactas en páginas internas (`pathname !== '/inicio'`).
 * - Conserva `outline-none focus:outline-none` en todos los elementos `<Link>` y `<button>` para evitar bordes de enfoque del navegador.
 * - Limpia cualquier temporizador de `long-press` al desmontar el componente y evita `setState` síncrono en `useEffect`.
 */

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
    CalendarCheck,
    Clock,
    Home,
    LayoutGrid,
} from 'lucide-react'
import { useAuth } from './ProtectedRoute'
import { useLanguage } from '@/lib/i18n'
import DockEditorSheet from './mobile-os/DockEditorSheet'
import {
    DOCK_OPEN_EDITOR_EVENT,
    OS_SECTION_THEMES,
    STANDALONE_SIBLING_PATHS,
    useMobileDockPreferences,
    type OSGroupId,
} from '@/lib/mobile-os-catalog'

interface TabColorStyle {
    activeIcon: string
    inactiveOSIcon: string
    activeBg: string
    inactiveOSBg: string
    activeText: string
    indicatorColor: string
}

const BasecampTabIcon = ({ size = 24 }: { size?: number }) => (
    <svg viewBox="0 0 512 512" width={size} height={size} fill="currentColor" style={{ flexShrink: 0 }}>
        <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M111.962 57.729C155.189 19.34 206.449 0 265.307 0c77.361 0 133.713 49.448 171.582 113.692 37.866 64.24 57.6 143.773 61.686 205.326a26.662 26.662 0 01-3.283 14.894l-.012.028-.016.025c-36.169 62.105-118.272 96.008-229.939 96.011-80.188 1.053-156.884-32.74-210.199-92.613a25.471 25.471 0 01-4.943-25.924c7.15-19.237 20.547-51.324 38.335-78.688 8.892-13.679 18.959-26.299 29.988-35.543 11.026-9.24 23.224-15.276 36.306-15.348h.016c13.181 0 24.573 5.25 34.449 12.345 9.657 6.937 18.057 15.784 25.377 23.491l.444.471.025.024a169.12 169.12 0 0013.322 13.212 392.206 392.206 0 0049.68-83.351l.039-.092.05-.091c6.327-12.016 20.971-16.961 33.293-11.242 12.324 5.718 17.991 20.089 12.892 32.673l-.026.07-.032.066c-26.677 57.123-47.287 86.004-62.615 100.621-7.688 7.334-14.109 11.141-19.363 13.083-5.294 1.959-9.228 1.959-11.664 1.959-11.174 0-20.703-4.308-29.181-10.435-8.312-6.007-15.793-13.897-22.916-21.409l-.301-.317c-3.271-3.468-8.227-8.715-12.998-13.091-2.39-2.194-4.666-4.105-6.614-5.45-.973-.673-1.807-1.166-2.486-1.478a5.54 5.54 0 00-.806-.31c-.048-.013-.091-.022-.128-.03-.8.211-1.931.762-3.402 1.858-1.635 1.218-3.501 2.964-5.563 5.229-4.12 4.526-8.817 10.903-13.77 18.655-9.628 15.064-20.054 35.063-28.896 56.107a223.491 223.491 0 00161.61 64.325h.059c88.439 0 153.567-23.975 181.811-64.431-5.026-55.783-22.994-121.651-53.471-173.599-30.694-52.325-73.656-89.898-128.34-89.898-93.402 0-164.264 65.12-210.272 194.986l-.029.08-.034.079c-5.254 12.403-19.257 18.576-31.962 14.093-12.706-4.487-19.726-18.08-16.023-31.026l.024-.086.029-.084c26.723-75.584 61.75-132.8 104.922-171.138z"
        />
    </svg>
)

const ANCHOR_TAB_COLORS: Record<'home' | 'planner' | 'basecamp' | 'schedule' | 'more', TabColorStyle> = {
    home: {
        activeIcon: 'text-red-600 dark:text-red-400',
        inactiveOSIcon: 'text-red-600 dark:text-red-400',
        activeBg: 'bg-red-500/15 dark:bg-red-500/25 ring-1 ring-red-500/30',
        inactiveOSBg: 'bg-red-500/8 dark:bg-red-500/15 border border-red-500/20',
        activeText: 'text-red-600 dark:text-red-400',
        indicatorColor: 'bg-red-600',
    },
    planner: {
        activeIcon: 'text-cyan-600 dark:text-cyan-400',
        inactiveOSIcon: 'text-cyan-600 dark:text-cyan-400',
        activeBg: 'bg-cyan-500/15 dark:bg-cyan-500/25 ring-1 ring-cyan-500/30',
        inactiveOSBg: 'bg-cyan-500/8 dark:bg-cyan-500/15 border border-cyan-500/20',
        activeText: 'text-cyan-600 dark:text-cyan-400',
        indicatorColor: 'bg-cyan-600',
    },
    basecamp: {
        activeIcon: 'text-sky-600 dark:text-sky-400',
        inactiveOSIcon: 'text-sky-600 dark:text-sky-400',
        activeBg: 'bg-sky-500/15 dark:bg-sky-500/25 ring-1 ring-sky-500/30',
        inactiveOSBg: 'bg-sky-500/8 dark:bg-sky-500/15 border border-sky-500/20',
        activeText: 'text-sky-600 dark:text-sky-400',
        indicatorColor: 'bg-sky-600',
    },
    schedule: {
        activeIcon: 'text-cyan-600 dark:text-cyan-400',
        inactiveOSIcon: 'text-cyan-600 dark:text-cyan-400',
        activeBg: 'bg-cyan-500/15 dark:bg-cyan-500/25 ring-1 ring-cyan-500/30',
        inactiveOSBg: 'bg-cyan-500/8 dark:bg-cyan-500/15 border border-cyan-500/20',
        activeText: 'text-cyan-600 dark:text-cyan-400',
        indicatorColor: 'bg-cyan-600',
    },
    more: {
        activeIcon: 'text-red-600 dark:text-red-400',
        inactiveOSIcon: 'text-slate-700 dark:text-slate-200',
        activeBg: 'bg-red-500/15 dark:bg-red-500/25 ring-1 ring-red-500/30',
        inactiveOSBg: 'bg-slate-200/75 dark:bg-slate-800/85 border border-slate-300/70 dark:border-slate-700/80',
        activeText: 'text-red-600 dark:text-red-400',
        indicatorColor: 'bg-red-600',
    },
}

const GROUP_TAB_COLORS: Record<OSGroupId, TabColorStyle> = {
    analisis: {
        activeIcon: 'text-rose-600 dark:text-rose-400',
        inactiveOSIcon: 'text-rose-600 dark:text-rose-400',
        activeBg: 'bg-rose-500/15 dark:bg-rose-500/25 ring-1 ring-rose-500/30',
        inactiveOSBg: 'bg-rose-500/10 dark:bg-rose-500/18 border border-rose-500/20',
        activeText: 'text-rose-600 dark:text-rose-400',
        indicatorColor: 'bg-rose-600',
    },
    operaciones: {
        activeIcon: 'text-blue-600 dark:text-blue-400',
        inactiveOSIcon: 'text-blue-600 dark:text-blue-400',
        activeBg: 'bg-blue-500/15 dark:bg-blue-500/25 ring-1 ring-blue-500/30',
        inactiveOSBg: 'bg-blue-500/10 dark:bg-blue-500/18 border border-blue-500/20',
        activeText: 'text-blue-600 dark:text-blue-400',
        indicatorColor: 'bg-blue-600',
    },
    inventario: {
        activeIcon: 'text-purple-600 dark:text-purple-400',
        inactiveOSIcon: 'text-purple-600 dark:text-purple-400',
        activeBg: 'bg-purple-500/15 dark:bg-purple-500/25 ring-1 ring-purple-500/30',
        inactiveOSBg: 'bg-purple-500/10 dark:bg-purple-500/18 border border-purple-500/20',
        activeText: 'text-purple-600 dark:text-purple-400',
        indicatorColor: 'bg-purple-600',
    },
    equipo: {
        activeIcon: 'text-cyan-600 dark:text-cyan-400',
        inactiveOSIcon: 'text-cyan-600 dark:text-cyan-400',
        activeBg: 'bg-cyan-500/15 dark:bg-cyan-500/25 ring-1 ring-cyan-500/30',
        inactiveOSBg: 'bg-cyan-500/10 dark:bg-cyan-500/18 border border-cyan-500/20',
        activeText: 'text-cyan-600 dark:text-cyan-400',
        indicatorColor: 'bg-cyan-600',
    },
    finanzas: {
        activeIcon: 'text-emerald-600 dark:text-emerald-400',
        inactiveOSIcon: 'text-emerald-600 dark:text-emerald-400',
        activeBg: 'bg-emerald-500/15 dark:bg-emerald-500/25 ring-1 ring-emerald-500/30',
        inactiveOSBg: 'bg-emerald-500/10 dark:bg-emerald-500/18 border border-emerald-500/20',
        activeText: 'text-emerald-600 dark:text-emerald-400',
        indicatorColor: 'bg-emerald-600',
    },
    gestion: {
        activeIcon: 'text-amber-600 dark:text-amber-400',
        inactiveOSIcon: 'text-amber-600 dark:text-amber-400',
        activeBg: 'bg-amber-500/15 dark:bg-amber-500/25 ring-1 ring-amber-500/30',
        inactiveOSBg: 'bg-amber-500/10 dark:bg-amber-500/18 border border-amber-500/20',
        activeText: 'text-amber-600 dark:text-amber-400',
        indicatorColor: 'bg-amber-600',
    },
}

const LONG_PRESS_DURATION_MS = 450
const LONG_PRESS_MOVE_TOLERANCE_PX = 10

interface RenderedDockTab {
    key: string
    label: string
    path: string
    openInNewTab?: boolean
    squircleBg: string
    colors: TabColorStyle
    renderIcon: (isActive: boolean, isOSSquircle: boolean) => React.ReactNode
}

/**
 * Resolves the active dock item index:
 * 1. Prioritizes `__drawer__` (`Más`) whenever `isDrawerOpen` is true.
 * 2. Evaluates longest-prefix route matching across dock items.
 * 3. Respects `STANDALONE_SIBLING_PATHS` so standalone sub-routes (e.g. `/ventas/reportes`)
 *    never falsely highlight a shorter parent route (`/ventas`) unless that standalone route itself is in the dock.
 */
export function resolveActiveDockIndex(
    items: ReadonlyArray<{ path: string }>,
    pathname: string | null,
    isDrawerOpen: boolean,
    standaloneSiblingPaths: readonly string[] = STANDALONE_SIBLING_PATHS
): number {
    if (isDrawerOpen) {
        return items.findIndex(item => item.path === '__drawer__')
    }
    if (!pathname) return -1

    let bestIndex = -1
    let bestSpecificity = -1

    for (let i = 0; i < items.length; i++) {
        const rawPath = items[i].path
        if (!rawPath || rawPath === '__drawer__') continue
        const cleanPath = rawPath.split('?')[0]

        if (pathname === cleanPath) {
            const specificity = cleanPath.length + 10000
            if (specificity > bestSpecificity) {
                bestSpecificity = specificity
                bestIndex = i
            }
            continue
        }

        if (cleanPath !== '/' && pathname.startsWith(cleanPath + '/')) {
            const blockedByStandaloneSibling = standaloneSiblingPaths.some(
                sibling =>
                    sibling !== cleanPath &&
                    sibling.startsWith(cleanPath + '/') &&
                    (pathname === sibling || pathname.startsWith(sibling + '/'))
            )
            if (blockedByStandaloneSibling) continue

            const specificity = cleanPath.length
            if (specificity > bestSpecificity) {
                bestSpecificity = specificity
                bestIndex = i
            }
        }
    }

    return bestIndex
}

interface BottomTabBarProps {
    onOpenDrawer: () => void
    isDrawerOpen?: boolean
}

export default function BottomTabBar({ onOpenDrawer, isDrawerOpen = false }: BottomTabBarProps) {
    const pathname = usePathname()
    const { user } = useAuth()
    const { t } = useLanguage()

    const {
        dockItems,
        permittedGroups,
        canCustomizeDock: rawCanCustomizeDock,
        isPlanificadorOnly,
        isEmployeeOnly,
        isSavingSync,
        homeViewMode,
        setHomeViewMode,
        replaceDockSlot,
        moveDockSlot,
        addDockSlot,
        removeDockSlot,
        resetDockToDefaults,
    } = useMobileDockPreferences(user, t)

    const isBasecampOnly = user?.role?.toLowerCase() === 'basecamp'
    const canCustomizeDock = rawCanCustomizeDock && !isBasecampOnly

    const [isEditorOpen, setIsEditorOpen] = useState(false)
    const [editorSessionKey, setEditorSessionKey] = useState(0)

    const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const pointerStartRef = useRef<{ x: number; y: number } | null>(null)
    const longPressTriggeredRef = useRef(false)

    const clearLongPressTimer = useCallback(() => {
        if (longPressTimerRef.current !== null) {
            clearTimeout(longPressTimerRef.current)
            longPressTimerRef.current = null
        }
        pointerStartRef.current = null
    }, [])

    const openEditorModal = useCallback(() => {
        if (!canCustomizeDock) return
        setEditorSessionKey(prev => prev + 1)
        setIsEditorOpen(true)
    }, [canCustomizeDock])

    // Cleanup any active long-press timer on unmount
    useEffect(() => {
        return () => {
            if (longPressTimerRef.current !== null) {
                clearTimeout(longPressTimerRef.current)
            }
        }
    }, [])

    // Listen for global DOCK_OPEN_EDITOR_EVENT ('teg:open-dock-editor') from /inicio "Editar Barra" button
    useEffect(() => {
        if (!canCustomizeDock) return
        const handleOpenDockEditor = () => {
            openEditorModal()
        }
        window.addEventListener(DOCK_OPEN_EDITOR_EVENT, handleOpenDockEditor)
        return () => window.removeEventListener(DOCK_OPEN_EDITOR_EVENT, handleOpenDockEditor)
    }, [canCustomizeDock, openEditorModal])

    const handlePointerDown = useCallback(
        (event: React.PointerEvent<HTMLDivElement>) => {
            if (!canCustomizeDock) return
            if (event.pointerType === 'mouse' && event.button !== 0) return

            clearLongPressTimer()
            longPressTriggeredRef.current = false
            pointerStartRef.current = { x: event.clientX, y: event.clientY }

            longPressTimerRef.current = setTimeout(() => {
                longPressTimerRef.current = null
                longPressTriggeredRef.current = true
                if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                    try {
                        navigator.vibrate(18)
                    } catch {
                        // Ignore haptic errors on unsupported browsers
                    }
                }
                openEditorModal()
            }, LONG_PRESS_DURATION_MS)
        },
        [canCustomizeDock, clearLongPressTimer, openEditorModal]
    )

    const handlePointerMove = useCallback(
        (event: React.PointerEvent<HTMLDivElement>) => {
            if (longPressTimerRef.current === null || pointerStartRef.current === null) return
            const dx = event.clientX - pointerStartRef.current.x
            const dy = event.clientY - pointerStartRef.current.y
            if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_TOLERANCE_PX) {
                clearLongPressTimer()
            }
        },
        [clearLongPressTimer]
    )

    const handlePointerEnd = useCallback(() => {
        clearLongPressTimer()
    }, [clearLongPressTimer])

    const handleClickCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        if (longPressTriggeredRef.current) {
            event.preventDefault()
            event.stopPropagation()
            longPressTriggeredRef.current = false
        }
    }, [])

    const handleContextMenu = useCallback(
        (event: React.MouseEvent<HTMLDivElement>) => {
            if (!canCustomizeDock) return
            event.preventDefault()
        },
        [canCustomizeDock]
    )

    const handleMoveSlotLeft = useCallback(
        (slotIndex: number) => {
            moveDockSlot(slotIndex, slotIndex - 1)
        },
        [moveDockSlot]
    )

    const handleMoveSlotRight = useCallback(
        (slotIndex: number) => {
            moveDockSlot(slotIndex, slotIndex + 1)
        },
        [moveDockSlot]
    )

    // Assemble rendered tabs: restricted single-tab roles vs [Inicio, ...editableDockItems, Más]
    const allItems: RenderedDockTab[] = useMemo(() => {
        if (isPlanificadorOnly) {
            return [
                {
                    key: 'fixed-planner',
                    label: t('bottom_nav.planner'),
                    path: '/planificador',
                    squircleBg: 'bg-gradient-to-br from-cyan-500 to-teal-600',
                    colors: ANCHOR_TAB_COLORS.planner,
                    renderIcon: (isActive, isOSSquircle) => (
                        <CalendarCheck
                            size={isOSSquircle ? 26 : isActive ? 25 : 23}
                            strokeWidth={isOSSquircle ? 2.3 : isActive ? 2.45 : 2.15}
                        />
                    ),
                },
            ]
        }

        if (isBasecampOnly) {
            return [
                {
                    key: 'fixed-basecamp',
                    label: t('bottom_nav.basecamp') || 'Basecamp',
                    path: '/basecamp',
                    squircleBg: 'bg-gradient-to-br from-sky-500 to-blue-600',
                    colors: ANCHOR_TAB_COLORS.basecamp,
                    renderIcon: (isActive, isOSSquircle) => (
                        <BasecampTabIcon size={isOSSquircle ? 26 : isActive ? 25 : 23} />
                    ),
                },
            ]
        }

        if (isEmployeeOnly) {
            return [
                {
                    key: 'fixed-schedule',
                    label: t('bottom_nav.schedule'),
                    path: '/mis-horarios',
                    squircleBg: 'bg-gradient-to-br from-cyan-500 to-teal-600',
                    colors: ANCHOR_TAB_COLORS.schedule,
                    renderIcon: (isActive, isOSSquircle) => (
                        <Clock
                            size={isOSSquircle ? 26 : isActive ? 25 : 23}
                            strokeWidth={isOSSquircle ? 2.3 : isActive ? 2.45 : 2.15}
                        />
                    ),
                },
            ]
        }

        const middleTabs: RenderedDockTab[] = dockItems.map(item => {
            const sectionTheme = OS_SECTION_THEMES[item.groupId]
            const baseColors = GROUP_TAB_COLORS[item.groupId] || GROUP_TAB_COLORS.operaciones
            const colors: TabColorStyle = sectionTheme
                ? {
                      ...baseColors,
                      activeIcon: sectionTheme.activeIcon || baseColors.activeIcon,
                      activeBg: sectionTheme.activeBg || baseColors.activeBg,
                      activeText: sectionTheme.activeText || baseColors.activeText,
                      indicatorColor: sectionTheme.indicatorColor || baseColors.indicatorColor,
                  }
                : baseColors

            return {
                key: `dock-${item.id}`,
                label: item.shortTitle || item.title,
                path: item.path,
                openInNewTab: item.openInNewTab,
                squircleBg:
                    item.appTileBg ||
                    sectionTheme?.squircleGradient ||
                    'bg-gradient-to-br from-blue-500 to-indigo-600',
                colors,
                renderIcon: (isActive, isOSSquircle) =>
                    item.renderIcon(isOSSquircle ? 26 : isActive ? 24 : 22),
            }
        })

        return [
            {
                key: 'anchor-home',
                label: t('bottom_nav.home'),
                path: '/inicio',
                squircleBg: 'bg-gradient-to-br from-rose-500 to-red-600',
                colors: ANCHOR_TAB_COLORS.home,
                renderIcon: (isActive, isOSSquircle) => (
                    <Home
                        size={isOSSquircle ? 26 : isActive ? 24 : 22}
                        strokeWidth={isOSSquircle ? 2.3 : isActive ? 2.45 : 2.15}
                    />
                ),
            },
            ...middleTabs,
            {
                key: 'anchor-more',
                label: t('bottom_nav.more'),
                path: '__drawer__',
                squircleBg: 'bg-gradient-to-br from-slate-600 to-slate-800',
                colors: ANCHOR_TAB_COLORS.more,
                renderIcon: (isActive, isOSSquircle) => (
                    <LayoutGrid
                        size={isOSSquircle ? 26 : isActive ? 24 : 22}
                        strokeWidth={isOSSquircle ? 2.25 : isActive ? 2.45 : 2.15}
                    />
                ),
            },
        ]
    }, [dockItems, isBasecampOnly, isEmployeeOnly, isPlanificadorOnly, t])

    const activeIndex = useMemo(
        () => resolveActiveDockIndex(allItems, pathname, isDrawerOpen, STANDALONE_SIBLING_PATHS),
        [allItems, pathname, isDrawerOpen]
    )

    const isOSGlassMode = canCustomizeDock && homeViewMode === 'os'
    const isOnHomeScreen = pathname === '/inicio'
    const hideOSDockLabels = isOSGlassMode && isOnHomeScreen

    return (
        <>
            <div
                style={isOSGlassMode ? { paddingBottom: 'env(safe-area-inset-bottom)' } : undefined}
                className="lg:hidden fixed bottom-0 left-0 right-0 z-50 pointer-events-none md:px-4"
            >
                <div
                    style={!isOSGlassMode ? { paddingBottom: 'env(safe-area-inset-bottom)' } : undefined}
                    className={
                        isOSGlassMode
                            ? `pointer-events-auto mx-3 mb-2 px-3 py-2.5 rounded-[34px] ${
                                  isOnHomeScreen
                                      ? 'bg-white/26 dark:bg-white/14 border-white/30 dark:border-white/15'
                                      : 'bg-white/82 dark:bg-slate-950/78 border-slate-200/85 dark:border-white/15'
                              } backdrop-blur-2xl border shadow-[0_14px_38px_rgba(0,0,0,0.32)] md:max-w-2xl md:mx-auto transition-all duration-200`
                            : 'pointer-events-auto bg-white/95 dark:bg-slate-950/95 backdrop-blur-xl border-t border-slate-200/90 dark:border-slate-800 shadow-[0_-6px_24px_-6px_rgba(15,23,42,0.10)] md:max-w-2xl md:mx-auto md:mb-2 md:rounded-3xl md:border md:shadow-2xl transition-all duration-200'
                    }
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerEnd}
                    onPointerCancel={handlePointerEnd}
                    onPointerLeave={handlePointerEnd}
                    onClickCapture={handleClickCapture}
                    onContextMenu={handleContextMenu}
                >
                    <div
                        className={
                            isOSGlassMode
                                ? 'flex items-center justify-around gap-1.5 sm:gap-3'
                                : 'flex items-stretch justify-around h-[74px] px-1.5 md:px-3'
                        }
                    >
                        {allItems.map((tab, index) => {
                            const isActive = index === activeIndex
                            const isDrawer = tab.path === '__drawer__'
                            const colors = tab.colors

                            const content = isOSGlassMode ? (
                                <div className="relative flex flex-col items-center justify-center gap-1 select-none py-0.5">
                                    {/* Large Vivid Solid-Gradient iOS Squircle App Icon */}
                                    <div
                                        className={`w-[54px] h-[54px] sm:w-[58px] sm:h-[58px] ${
                                            allItems.length >= 6
                                                ? 'max-[380px]:w-[47px] max-[380px]:h-[47px]'
                                                : ''
                                        } rounded-[14px] ${tab.squircleBg} text-white shadow-[0_6px_16px_rgba(0,0,0,0.28)] border border-white/20 flex items-center justify-center relative transition-transform duration-200 group-active:scale-90 group-focus-visible:ring-2 group-focus-visible:ring-white/80 ${
                                            isActive
                                                ? 'ring-2 ring-white/90 scale-[1.03]'
                                                : 'group-hover:scale-[1.03]'
                                        }`}
                                    >
                                        <span className="relative z-10 flex items-center justify-center drop-shadow-[0_1px_2px_rgba(0,0,0,0.22)]">
                                            {tab.renderIcon(isActive, true)}
                                        </span>
                                    </div>

                                    {/* Pure 1:1 iPhone Home Dock on /inicio (no text labels); compact labels on inner pages */}
                                    {!hideOSDockLabels ? (
                                        <span
                                            className={`text-[10px] sm:text-[11px] leading-tight tracking-tight truncate max-w-[64px] px-0.5 ${
                                                isActive
                                                    ? `${colors.activeText} font-extrabold`
                                                    : 'text-slate-700 dark:text-slate-200 font-bold'
                                            }`}
                                        >
                                            {tab.label}
                                        </span>
                                    ) : (
                                        isActive && (
                                            <motion.span
                                                layoutId="osDockActiveDot"
                                                className="w-1.5 h-1.5 rounded-full bg-white/90 shadow-xs"
                                                transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                                            />
                                        )
                                    )}
                                </div>
                            ) : (
                                <div className="relative flex flex-col items-center justify-center gap-1 flex-1 h-full py-1.5 select-none">
                                    {/* Active top spring indicator */}
                                    {isActive && (
                                        <motion.div
                                            layoutId="bottomTabIndicator"
                                            className={`absolute top-0 left-1/2 -translate-x-1/2 w-9 h-[3.5px] rounded-b-full ${colors.indicatorColor}`}
                                            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                                        />
                                    )}

                                    {/* Classic Web Mode tactile capsule */}
                                    <div
                                        className={`w-[52px] h-[38px] rounded-2xl flex items-center justify-center relative transition-all duration-200 group-focus-visible:ring-2 group-focus-visible:ring-slate-400/40 ${
                                            isActive
                                                ? ''
                                                : 'bg-slate-100/75 dark:bg-slate-900/75 border border-slate-200/70 dark:border-slate-800/80 group-hover:bg-slate-200/70 dark:group-hover:bg-slate-800'
                                        }`}
                                    >
                                        {isActive && (
                                            <motion.div
                                                layoutId="bottomTabPill"
                                                className={`absolute inset-0 rounded-2xl ${colors.activeBg}`}
                                                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                                            />
                                        )}
                                        <span
                                            className={`relative z-10 flex items-center justify-center transition-transform duration-200 group-active:scale-90 ${
                                                isActive
                                                    ? colors.activeIcon
                                                    : 'text-slate-600 dark:text-slate-300'
                                            }`}
                                        >
                                            {tab.renderIcon(isActive, false)}
                                        </span>
                                    </div>

                                    {/* Clear Bilingual Label */}
                                    <span
                                        className={`text-[10.5px] sm:text-[11px] leading-tight tracking-tight transition-colors duration-200 truncate max-w-full px-0.5 ${
                                            isActive
                                                ? `${colors.activeText} font-extrabold`
                                                : 'text-slate-600 dark:text-slate-400 font-semibold'
                                        }`}
                                    >
                                        {tab.label}
                                    </span>
                                </div>
                            )

                            if (isDrawer) {
                                return (
                                    <button
                                        key={tab.key}
                                        type="button"
                                        onClick={onOpenDrawer}
                                        aria-label={tab.label}
                                        aria-expanded={isDrawerOpen}
                                        className="flex-1 min-w-0 flex flex-col outline-none focus:outline-none group cursor-pointer"
                                    >
                                        {content}
                                    </button>
                                )
                            }

                            return (
                                <Link
                                    key={tab.key}
                                    href={tab.path}
                                    target={tab.openInNewTab ? '_blank' : undefined}
                                    rel={tab.openInNewTab ? 'noopener noreferrer' : undefined}
                                    aria-label={tab.label}
                                    className="flex-1 min-w-0 flex flex-col outline-none focus:outline-none group"
                                >
                                    {content}
                                </Link>
                            )
                        })}
                    </div>
                </div>
            </div>

            {canCustomizeDock && (
                <DockEditorSheet
                    key={editorSessionKey}
                    isOpen={isEditorOpen}
                    onClose={() => setIsEditorOpen(false)}
                    dockItems={dockItems}
                    permittedGroups={permittedGroups}
                    homeViewMode={homeViewMode}
                    onChangeHomeViewMode={setHomeViewMode}
                    onReplaceSlot={replaceDockSlot}
                    onMoveSlotLeft={handleMoveSlotLeft}
                    onMoveSlotRight={handleMoveSlotRight}
                    onAddSlot={addDockSlot}
                    onRemoveSlot={removeDockSlot}
                    onResetDefaults={resetDockToDefaults}
                    isSavingSync={isSavingSync}
                />
            )}
        </>
    )
}
