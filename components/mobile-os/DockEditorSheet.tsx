/**
 * @module components/mobile-os/DockEditorSheet
 * @description Hoja modal interactiva estilo iOS / iPadOS / One UI (`Bottom Sheet` en teléfono, modal centrado de cristal
 * en tablet, `z-[130]`) para personalizar los accesos directos de la barra inferior (`BottomTabBar` / OS Dock) y alternar
 * en 1 toque entre `Modo OS` y `Versión Web`.
 *
 * @businessRules
 * - Los extremos izquierdo (`Inicio` -> `/inicio`) y derecho (`Más` -> `__drawer__`) permanecen fijos por ergonomía operativa.
 * - El usuario puede configurar entre `DOCK_MIN_EDITABLE_SLOTS` (1) y `DOCK_MAX_EDITABLE_SLOTS` (4) módulos intermedios,
 *   únicamente dentro de los grupos y módulos permitidos para su rol (`permittedGroups`).
 * - Incluye selector segmentado superior (`Modo OS` vs `Versión Web`) sincronizado con `homeViewMode` para que el usuario
 *   pueda cambiar el estilo de inicio móvil desde cualquier pantalla del sistema.
 * - Soporta reemplazo directo tocando un espacio, reordenamiento (`←` / `→`), eliminación (`✕`) con protección de mínimo 1 icono,
 *   búsqueda insensible a acentos (`normalizeOSSearch`) con `text-base` (16px, sin auto-zoom en iOS Safari) y restauración a valores por defecto.
 *
 * @dataFlow
 * - Recibe `dockItems`, `permittedGroups`, `homeViewMode` y callbacks de mutación desde `BottomTabBar` (`useMobileDockPreferences`).
 * - Consume `useLanguage()` de `lib/i18n.tsx` para etiquetas 100% bilingües (ES/EN) sin cadenas hardcodeadas.
 *
 * @notes
 * - Evita `setState` síncrono dentro de `useEffect` (`react-hooks/set-state-in-effect`): el índice seleccionado efectivo se deriva
 *   en tiempo de renderizado y el estado interno se reinicia limpiamente al abrir una nueva sesión del editor.
 * - Mantiene `outline-none focus:outline-none` en todos los botones e inputs interactivos.
 */

'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
    ArrowLeft,
    ArrowRight,
    Check,
    Globe,
    Home,
    LayoutGrid,
    Lock,
    Plus,
    RotateCcw,
    Search,
    Smartphone,
    X,
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import {
    DOCK_MAX_EDITABLE_SLOTS,
    DOCK_MIN_EDITABLE_SLOTS,
    OS_SECTION_THEMES,
    normalizeOSSearch,
    type MobileHomeViewMode,
    type OSGroupId,
    type OSModuleGroup,
    type OSModuleItem,
} from '@/lib/mobile-os-catalog'

interface GroupPreviewPalette {
    squircleBg: string
    squircleText: string
    ringSelected: string
    inBarBadge: string
}

const GROUP_PREVIEW_PALETTES: Record<OSGroupId, GroupPreviewPalette> = {
    analisis: {
        squircleBg: 'bg-gradient-to-br from-rose-500 to-red-600 shadow-rose-500/25',
        squircleText: 'text-white',
        ringSelected: 'ring-rose-500 dark:ring-rose-400',
        inBarBadge: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
    },
    operaciones: {
        squircleBg: 'bg-gradient-to-br from-blue-500 to-indigo-600 shadow-blue-500/25',
        squircleText: 'text-white',
        ringSelected: 'ring-blue-500 dark:ring-blue-400',
        inBarBadge: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30',
    },
    inventario: {
        squircleBg: 'bg-gradient-to-br from-purple-500 to-violet-600 shadow-purple-500/25',
        squircleText: 'text-white',
        ringSelected: 'ring-purple-500 dark:ring-purple-400',
        inBarBadge: 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30',
    },
    equipo: {
        squircleBg: 'bg-gradient-to-br from-cyan-500 to-sky-600 shadow-cyan-500/25',
        squircleText: 'text-white',
        ringSelected: 'ring-cyan-500 dark:ring-cyan-400',
        inBarBadge: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30',
    },
    finanzas: {
        squircleBg: 'bg-gradient-to-br from-emerald-500 to-teal-600 shadow-emerald-500/25',
        squircleText: 'text-white',
        ringSelected: 'ring-emerald-500 dark:ring-emerald-400',
        inBarBadge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
    },
    gestion: {
        squircleBg: 'bg-gradient-to-br from-amber-500 to-orange-600 shadow-amber-500/25',
        squircleText: 'text-white',
        ringSelected: 'ring-amber-500 dark:ring-amber-400',
        inBarBadge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
    },
}

export interface DockEditorSheetProps {
    isOpen: boolean
    onClose: () => void
    dockItems: OSModuleItem[]
    permittedGroups: OSModuleGroup[]
    homeViewMode: MobileHomeViewMode
    onChangeHomeViewMode: (mode: MobileHomeViewMode) => void
    onReplaceSlot: (slotIndex: number, moduleId: string) => void
    onMoveSlotLeft: (slotIndex: number) => void
    onMoveSlotRight: (slotIndex: number) => void
    onAddSlot: (moduleId: string) => void
    onRemoveSlot: (slotIndex: number) => void
    onResetDefaults: () => void
    isSavingSync?: boolean
}

export default function DockEditorSheet({
    isOpen,
    onClose,
    dockItems,
    permittedGroups,
    homeViewMode,
    onChangeHomeViewMode,
    onReplaceSlot,
    onMoveSlotLeft,
    onMoveSlotRight,
    onAddSlot,
    onRemoveSlot,
    onResetDefaults,
}: DockEditorSheetProps) {
    const { t } = useLanguage()
    const [selectedSlotIndex, setSelectedSlotIndex] = useState<number | null>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [hintKind, setHintKind] = useState<'min' | 'max' | null>(null)
    const searchInputRef = useRef<HTMLInputElement | null>(null)

    // Close on Escape key for tablet/keyboard users
    useEffect(() => {
        if (!isOpen) return
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose()
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [isOpen, onClose])

    // Derived clamped selection index without synchronous setState in useEffect
    const effectiveSelectedSlot =
        selectedSlotIndex !== null && selectedSlotIndex >= 0 && selectedSlotIndex < dockItems.length
            ? selectedSlotIndex
            : null

    // Active slot used by the tactile ← / → / ✕ control bar (defaults to slot 0 if none explicitly tapped)
    const controlSlotIndex =
        effectiveSelectedSlot !== null
            ? effectiveSelectedSlot
            : dockItems.length > 0
                ? 0
                : null

    const controlSlotItem = controlSlotIndex !== null ? dockItems[controlSlotIndex] : null
    const canRemoveSlots = dockItems.length > DOCK_MIN_EDITABLE_SLOTS
    const canAddMoreSlots = dockItems.length < DOCK_MAX_EDITABLE_SLOTS

    const dockIndexById = useMemo(() => {
        const map = new Map<string, number>()
        dockItems.forEach((item, idx) => {
            map.set(item.id, idx)
        })
        return map
    }, [dockItems])

    const filteredGroups = useMemo(() => {
        const q = normalizeOSSearch(searchQuery)
        if (!q) return permittedGroups

        return permittedGroups
            .map(group => {
                const groupMatches = normalizeOSSearch(group.title).includes(q)
                const matchingItems = group.items.filter(item => {
                    if (item.path === '/inicio') return false
                    if (groupMatches) return true
                    const haystack = normalizeOSSearch(
                        `${item.title} ${item.shortTitle} ${item.description}`
                    )
                    return haystack.includes(q)
                })
                return {
                    ...group,
                    items: matchingItems,
                }
            })
            .filter(group => group.items.length > 0)
    }, [permittedGroups, searchQuery])

    const handleSelectSlot = (index: number) => {
        setHintKind(null)
        setSelectedSlotIndex(prev => (prev === index ? null : index))
    }

    const handleQuickRemoveSlot = (index: number) => {
        if (!canRemoveSlots) {
            setSelectedSlotIndex(index)
            setHintKind('min')
            return
        }
        setHintKind(null)
        onRemoveSlot(index)
        setSelectedSlotIndex(prev => {
            if (prev === null) return null
            if (prev === index) return null
            return prev > index ? prev - 1 : prev
        })
    }

    const handleMoveLeft = () => {
        if (controlSlotIndex === null || controlSlotIndex <= 0) return
        setHintKind(null)
        const target = controlSlotIndex - 1
        onMoveSlotLeft(controlSlotIndex)
        setSelectedSlotIndex(target)
    }

    const handleMoveRight = () => {
        if (controlSlotIndex === null || controlSlotIndex >= dockItems.length - 1) return
        setHintKind(null)
        const target = controlSlotIndex + 1
        onMoveSlotRight(controlSlotIndex)
        setSelectedSlotIndex(target)
    }

    const handleAppTap = (item: OSModuleItem) => {
        const existingIndex = dockIndexById.get(item.id)
        if (existingIndex !== undefined) {
            if (canRemoveSlots) {
                setHintKind(null)
                onRemoveSlot(existingIndex)
                setSelectedSlotIndex(null)
            } else {
                setSelectedSlotIndex(existingIndex)
                setHintKind('min')
            }
            return
        }

        if (effectiveSelectedSlot !== null) {
            setHintKind(null)
            onReplaceSlot(effectiveSelectedSlot, item.id)
            return
        }

        if (canAddMoreSlots) {
            setHintKind(null)
            onAddSlot(item.id)
            return
        }

        // Already at max editable slots (4) and no slot focused: focus last slot and surface helper
        const lastSlot = Math.max(0, dockItems.length - 1)
        setSelectedSlotIndex(lastSlot)
        setHintKind('max')
    }

    const handleReset = () => {
        setHintKind(null)
        setSelectedSlotIndex(null)
        onResetDefaults()
    }

    const showMinHint = hintKind === 'min' || (!canRemoveSlots && effectiveSelectedSlot !== null)
    const showMaxHint =
        hintKind === 'max' || (!canAddMoreSlots && effectiveSelectedSlot === null)

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="lg:hidden fixed inset-0 z-[130] flex items-end md:items-center md:justify-center md:p-6">
                    {/* Frosted OS Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.18 }}
                        onClick={onClose}
                        aria-hidden="true"
                        className="absolute inset-0 bg-slate-950/60 backdrop-blur-md"
                    />

                    {/* Bottom Sheet on Phone / Centered Glass Modal on Tablet */}
                    <motion.div
                        role="dialog"
                        aria-modal="true"
                        aria-label={t('mobile_os.customize_dock_title')}
                        initial={{ y: 48, opacity: 0, scale: 0.98 }}
                        animate={{ y: 0, opacity: 1, scale: 1 }}
                        exit={{ y: 40, opacity: 0, scale: 0.98 }}
                        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
                        className="relative z-10 w-full md:max-w-xl max-h-[88dvh] flex flex-col rounded-t-[28px] md:rounded-[28px] bg-white/98 dark:bg-slate-950/98 backdrop-blur-2xl border-t md:border border-slate-200/90 dark:border-slate-800 shadow-2xl overflow-hidden"
                    >
                        {/* Phone Drag Handle */}
                        <div className="md:hidden flex justify-center pt-2.5 pb-1 shrink-0">
                            <div className="w-10 h-1.5 rounded-full bg-slate-300 dark:bg-slate-700" />
                        </div>

                        {/* Sheet Header */}
                        <div className="px-4 sm:px-5 pt-2 md:pt-4 pb-2.5 flex items-start justify-between gap-3 border-b border-slate-200/80 dark:border-slate-800/80 shrink-0">
                            <div className="min-w-0">
                                <h2 className="text-base sm:text-lg font-black tracking-tight text-slate-900 dark:text-white">
                                    {t('mobile_os.customize_dock_title')}
                                </h2>
                                <p className="text-xs text-slate-500 dark:text-slate-400 leading-snug mt-0.5">
                                    {t('mobile_os.customize_dock_subtitle')}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={onClose}
                                aria-label={t('mobile_os.dock_done')}
                                className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800/90 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center justify-center shrink-0 transition-colors cursor-pointer outline-none focus:outline-none"
                            >
                                <X size={17} />
                            </button>
                        </div>

                        {/* Top Controls: Home Style Segmented Switch + Live Dock Preview Strip */}
                        <div className="px-4 sm:px-5 pt-3 pb-2.5 space-y-2.5 bg-slate-50/70 dark:bg-slate-900/50 border-b border-slate-200/80 dark:border-slate-800/80 shrink-0">
                            {/* Segmented Toggle: Modo OS vs Versión Web */}
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-2">
                                <div className="min-w-0 px-1">
                                    <div className="text-[11px] font-black uppercase tracking-wider text-slate-700 dark:text-slate-200">
                                        {t('mobile_os.view_mode_label')}
                                    </div>
                                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                        {homeViewMode === 'os'
                                            ? t('mobile_os.view_mode_os_desc')
                                            : t('mobile_os.view_mode_web_desc')}
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/90 shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => onChangeHomeViewMode('os')}
                                        aria-pressed={homeViewMode === 'os'}
                                        className={`relative px-3 py-1.5 rounded-lg text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all cursor-pointer outline-none focus:outline-none ${
                                            homeViewMode === 'os'
                                                ? 'bg-red-600 text-white shadow-xs'
                                                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                                        }`}
                                    >
                                        <Smartphone size={13} />
                                        <span>{t('mobile_os.switch_to_os')}</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => onChangeHomeViewMode('web')}
                                        aria-pressed={homeViewMode === 'web'}
                                        className={`relative px-3 py-1.5 rounded-lg text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all cursor-pointer outline-none focus:outline-none ${
                                            homeViewMode === 'web'
                                                ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-950 shadow-xs'
                                                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                                        }`}
                                    >
                                        <Globe size={13} />
                                        <span>{t('mobile_os.switch_to_web')}</span>
                                    </button>
                                </div>
                            </div>

                            {/* Live Interactive OS Dock Preview Strip */}
                            <div className="rounded-[22px] bg-white/95 dark:bg-slate-950/90 border border-slate-200/90 dark:border-slate-800 px-2 py-2.5 shadow-sm">
                                <div className="flex items-start justify-between gap-1">
                                    {/* Left Locked Anchor: Inicio */}
                                    <div className="flex-1 min-w-0 flex flex-col items-center gap-1 py-1 opacity-75 select-none">
                                        <div className="relative w-11 h-11 rounded-[14px] bg-red-500/12 dark:bg-red-500/20 border border-red-500/25 flex items-center justify-center text-red-600 dark:text-red-400">
                                            <Home size={20} strokeWidth={2.3} />
                                            <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-slate-800 dark:bg-slate-700 text-white flex items-center justify-center shadow-xs">
                                                <Lock size={9} />
                                            </span>
                                        </div>
                                        <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300 truncate max-w-full px-0.5">
                                            {t('bottom_nav.home')}
                                        </span>
                                        <span className="text-[9px] font-bold uppercase tracking-tight text-slate-400 dark:text-slate-500 truncate max-w-full">
                                            {t('mobile_os.dock_locked_home')}
                                        </span>
                                    </div>

                                    {/* Middle Editable Slots (1..4) with iOS Jiggle */}
                                    {dockItems.map((item, idx) => {
                                        const isSelected = effectiveSelectedSlot === idx
                                        const palette =
                                            GROUP_PREVIEW_PALETTES[item.groupId] ||
                                            GROUP_PREVIEW_PALETTES.operaciones

                                        return (
                                            <div
                                                key={item.id}
                                                className="flex-1 min-w-0 flex flex-col items-center relative"
                                            >
                                                <motion.div
                                                    animate={{
                                                        rotate: idx % 2 === 0 ? [-1.3, 1.3, -1.3] : [1.3, -1.3, 1.3],
                                                    }}
                                                    transition={{
                                                        repeat: Infinity,
                                                        duration: 0.36,
                                                        ease: 'easeInOut',
                                                    }}
                                                    className="relative w-full flex flex-col items-center"
                                                >
                                                    {/* Quick Remove Corner Badge */}
                                                    <button
                                                        type="button"
                                                        onClick={() => handleQuickRemoveSlot(idx)}
                                                        aria-label={t('mobile_os.dock_remove')}
                                                        title={
                                                            canRemoveSlots
                                                                ? t('mobile_os.dock_remove')
                                                                : t('mobile_os.dock_min_reached')
                                                        }
                                                        className={`absolute -top-1 right-1 sm:right-2 z-20 w-5 h-5 rounded-full flex items-center justify-center shadow-sm transition-transform active:scale-90 cursor-pointer outline-none focus:outline-none ${
                                                            canRemoveSlots
                                                                ? 'bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-950 hover:bg-red-600 dark:hover:bg-red-500 dark:hover:text-white'
                                                                : 'bg-slate-300 dark:bg-slate-800 text-slate-500 dark:text-slate-500 opacity-60'
                                                        }`}
                                                    >
                                                        <X size={11} strokeWidth={2.8} />
                                                    </button>

                                                    {/* Tappable Editable Slot */}
                                                    <button
                                                        type="button"
                                                        onClick={() => handleSelectSlot(idx)}
                                                        aria-pressed={isSelected}
                                                        className={`w-full flex flex-col items-center gap-1 py-1 px-0.5 rounded-2xl transition-all cursor-pointer outline-none focus:outline-none ${
                                                            isSelected
                                                                ? `bg-slate-100 dark:bg-slate-800/90 ring-2 ${palette.ringSelected} shadow-xs`
                                                                : 'hover:bg-slate-100/70 dark:hover:bg-slate-900/70'
                                                        }`}
                                                    >
                                                        <div
                                                            className={`w-11 h-11 rounded-[14px] shadow-md flex items-center justify-center text-white ${
                                                                item.appTileBg || palette.squircleBg
                                                            }`}
                                                        >
                                                            {item.renderIcon(20)}
                                                        </div>
                                                        <span className="text-[10px] font-extrabold text-slate-800 dark:text-slate-100 truncate max-w-full px-0.5">
                                                            {item.shortTitle || item.title}
                                                        </span>
                                                        <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500">
                                                            #{idx + 1}
                                                        </span>
                                                    </button>
                                                </motion.div>
                                            </div>
                                        )
                                    })}

                                    {/* Optional "+" Empty Slot Button when < 4 items */}
                                    {canAddMoreSlots && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setHintKind(null)
                                                setSelectedSlotIndex(null)
                                                searchInputRef.current?.focus()
                                            }}
                                            aria-label={t('mobile_os.dock_add_slot')}
                                            className={`flex-1 min-w-0 flex flex-col items-center gap-1 py-1 px-0.5 rounded-2xl transition-all cursor-pointer outline-none focus:outline-none ${
                                                effectiveSelectedSlot === null
                                                    ? 'bg-emerald-500/8 dark:bg-emerald-500/15 ring-1 ring-emerald-500/35'
                                                    : 'hover:bg-slate-100/70 dark:hover:bg-slate-900/70'
                                            }`}
                                        >
                                            <div className="w-11 h-11 rounded-[14px] border-2 border-dashed border-emerald-500/60 dark:border-emerald-400/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                                                <Plus size={20} strokeWidth={2.5} />
                                            </div>
                                            <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 truncate max-w-full px-0.5">
                                                {t('mobile_os.dock_add_slot')}
                                            </span>
                                            <span className="text-[9px] font-semibold text-slate-400 dark:text-slate-500 truncate max-w-full">
                                                {t('mobile_os.dock_slot_empty')}
                                            </span>
                                        </button>
                                    )}

                                    {/* Right Locked Anchor: Más */}
                                    <div className="flex-1 min-w-0 flex flex-col items-center gap-1 py-1 opacity-75 select-none">
                                        <div className="relative w-11 h-11 rounded-[14px] bg-slate-200/80 dark:bg-slate-800 border border-slate-300/80 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200">
                                            <LayoutGrid size={20} strokeWidth={2.2} />
                                            <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-slate-800 dark:bg-slate-700 text-white flex items-center justify-center shadow-xs">
                                                <Lock size={9} />
                                            </span>
                                        </div>
                                        <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300 truncate max-w-full px-0.5">
                                            {t('bottom_nav.more')}
                                        </span>
                                        <span className="text-[9px] font-bold uppercase tracking-tight text-slate-400 dark:text-slate-500 truncate max-w-full">
                                            {t('mobile_os.dock_locked_more')}
                                        </span>
                                    </div>
                                </div>

                                {/* Tactile Slot Reorder & Remove Controls */}
                                {controlSlotItem && controlSlotIndex !== null && (
                                    <div className="mt-2 pt-2 border-t border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-slate-900 dark:bg-white text-white dark:text-slate-950 text-[10px] font-black shrink-0">
                                                #{controlSlotIndex + 1}
                                            </span>
                                            <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100 truncate">
                                                {controlSlotItem.title}
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-1.5 shrink-0">
                                            <button
                                                type="button"
                                                onClick={handleMoveLeft}
                                                disabled={controlSlotIndex <= 0}
                                                aria-label={t('mobile_os.dock_move_left')}
                                                title={t('mobile_os.dock_move_left')}
                                                className="h-8 px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-35 disabled:pointer-events-none flex items-center justify-center gap-1 text-xs font-bold transition-colors cursor-pointer outline-none focus:outline-none"
                                            >
                                                <ArrowLeft size={14} />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleMoveRight}
                                                disabled={controlSlotIndex >= dockItems.length - 1}
                                                aria-label={t('mobile_os.dock_move_right')}
                                                title={t('mobile_os.dock_move_right')}
                                                className="h-8 px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-35 disabled:pointer-events-none flex items-center justify-center gap-1 text-xs font-bold transition-colors cursor-pointer outline-none focus:outline-none"
                                            >
                                                <ArrowRight size={14} />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleQuickRemoveSlot(controlSlotIndex)}
                                                aria-label={t('mobile_os.dock_remove')}
                                                title={t('mobile_os.dock_remove')}
                                                className={`h-8 px-2.5 rounded-xl border flex items-center justify-center gap-1 text-xs font-bold transition-colors cursor-pointer outline-none focus:outline-none ${
                                                    canRemoveSlots
                                                        ? 'border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-950/70'
                                                        : 'border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 text-slate-400 dark:text-slate-600'
                                                }`}
                                            >
                                                <X size={14} />
                                                <span className="hidden sm:inline">{t('mobile_os.dock_remove')}</span>
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Min / Max Slot Helper Banner */}
                                {(showMinHint || showMaxHint) && (
                                    <div className="mt-2 px-2.5 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 text-[11px] font-bold text-amber-800 dark:text-amber-200 text-center">
                                        {showMinHint
                                            ? t('mobile_os.dock_min_reached')
                                            : t('mobile_os.dock_max_reached')}
                                    </div>
                                )}
                            </div>

                            {/* Search Bar (text-base prevents iOS Safari zoom!) */}
                            <div className="relative">
                                <Search
                                    size={16}
                                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                                />
                                <input
                                    ref={searchInputRef}
                                    type="text"
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    placeholder={t('mobile_os.dock_search_placeholder')}
                                    className="w-full h-10 pl-9 pr-9 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 text-base text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500/50 transition-all"
                                />
                                {searchQuery.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => setSearchQuery('')}
                                        aria-label={t('home_hub.clear_filters')}
                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-slate-200/80 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center cursor-pointer outline-none focus:outline-none"
                                    >
                                        <X size={13} />
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Scrollable Categorized App Picker */}
                        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-3 space-y-4">
                            {filteredGroups.length === 0 ? (
                                <div className="py-10 text-center space-y-2">
                                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                                        {t('home_hub.no_results_title')}
                                    </p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        {t('home_hub.no_results_desc')}
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => setSearchQuery('')}
                                        className="mt-2 px-3.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer outline-none focus:outline-none"
                                    >
                                        {t('home_hub.clear_filters')}
                                    </button>
                                </div>
                            ) : (
                                filteredGroups.map(group => {
                                    const sectionTheme =
                                        OS_SECTION_THEMES[group.id] || OS_SECTION_THEMES.operaciones
                                    const palette =
                                        GROUP_PREVIEW_PALETTES[group.id] ||
                                        GROUP_PREVIEW_PALETTES.operaciones

                                    return (
                                        <section key={group.id} className="space-y-2">
                                            {/* Group Header */}
                                            <div className="flex items-center justify-between gap-2 px-0.5">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <span
                                                        className={`w-6 h-6 rounded-lg border flex items-center justify-center shrink-0 ${sectionTheme.headerIconBg} ${sectionTheme.headerIconColor}`}
                                                    >
                                                        {group.renderGroupIcon(14)}
                                                    </span>
                                                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200 truncate">
                                                        {group.title}
                                                    </h3>
                                                </div>
                                                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 shrink-0">
                                                    {group.items.length} {t('mobile_os.folder_apps_count')}
                                                </span>
                                            </div>

                                            {/* Squircle Module Picker Grid */}
                                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                                {group.items
                                                    .filter(item => item.path !== '/inicio')
                                                    .map(item => {
                                                        const existingSlot = dockIndexById.get(item.id)
                                                        const isInDock = existingSlot !== undefined

                                                        return (
                                                            <button
                                                                key={item.id}
                                                                type="button"
                                                                onClick={() => handleAppTap(item)}
                                                                className={`flex items-center gap-2.5 p-2 rounded-2xl border text-left transition-all active:scale-[0.98] cursor-pointer outline-none focus:outline-none ${
                                                                    isInDock
                                                                        ? 'bg-slate-100/95 dark:bg-slate-800/90 border-slate-300 dark:border-slate-700 shadow-xs'
                                                                        : 'bg-white dark:bg-slate-900/70 border-slate-200/80 dark:border-slate-800/90 hover:border-slate-300 dark:hover:border-slate-700'
                                                                }`}
                                                            >
                                                                <div
                                                                    className={`w-10 h-10 rounded-[13px] shadow-sm flex items-center justify-center shrink-0 text-white ${
                                                                        item.appTileBg || palette.squircleBg
                                                                    }`}
                                                                >
                                                                    {item.renderIcon(20)}
                                                                </div>

                                                                <div className="min-w-0 flex-1">
                                                                    <div className="text-xs font-extrabold text-slate-900 dark:text-white leading-tight line-clamp-1">
                                                                        {item.shortTitle || item.title}
                                                                    </div>
                                                                    <div className="mt-0.5 flex items-center gap-1">
                                                                        {isInDock ? (
                                                                            <span
                                                                                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md border text-[9.5px] font-extrabold ${palette.inBarBadge}`}
                                                                            >
                                                                                <Check size={10} strokeWidth={3} />
                                                                                <span>
                                                                                    {t('mobile_os.dock_in_bar')} #{existingSlot + 1}
                                                                                </span>
                                                                            </span>
                                                                        ) : (
                                                                            <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                                                                                {item.title}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </button>
                                                        )
                                                    })}
                                            </div>
                                        </section>
                                    )
                                })
                            )}
                        </div>

                        {/* Footer Actions */}
                        <div className="px-4 sm:px-5 py-3 border-t border-slate-200/90 dark:border-slate-800 bg-white/95 dark:bg-slate-950/95 flex items-center justify-between gap-3 shrink-0">
                            <button
                                type="button"
                                onClick={handleReset}
                                className="px-3.5 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-100/90 dark:bg-slate-900 text-xs font-extrabold text-slate-700 dark:text-slate-200 hover:bg-slate-200/80 dark:hover:bg-slate-800 flex items-center gap-1.5 transition-colors cursor-pointer outline-none focus:outline-none"
                            >
                                <RotateCcw size={14} />
                                <span>{t('mobile_os.dock_reset')}</span>
                            </button>

                            <button
                                type="button"
                                onClick={onClose}
                                className="px-5 py-2.5 rounded-2xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white text-xs font-black uppercase tracking-wider shadow-md shadow-red-600/20 flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer outline-none focus:outline-none"
                            >
                                <Check size={15} strokeWidth={2.6} />
                                <span>{t('mobile_os.dock_done')}</span>
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    )
}
