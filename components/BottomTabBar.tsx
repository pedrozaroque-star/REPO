/**
 * @module components/BottomTabBar
 * @description Barra de navegación inferior móvil con cápsulas táctiles de alto contraste e iconos ampliados
 * para acceso rápido a Inicio (`/inicio`), tareas operativas, ventas, planificador y el menú completo (`AppSidebar` drawer).
 *
 * @businessRules
 * - Adapta las pestañas según el rol del usuario autenticado (`admin`, `supervisor`, `manager`, `asistente`, `planificador`).
 * - Sincroniza el estado activo con `isDrawerOpen` para resaltar el botón de menú (`Más`) mientras el drawer móvil está abierto.
 * - Utiliza diccionarios bilingües `t('bottom_nav.*')` de `lib/i18n.tsx` (ES/EN) sin etiquetas hardcodeadas.
 *
 * @dataFlow
 * - Consume `useAuth()` para permisos de rol y `useLanguage()` para traducciones en vivo.
 * - Se coordina con `components/ClientLayout.tsx` (espaciado inferior `pb-[102px]` en móvil) y `AppSidebar`.
 */

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from './ProtectedRoute'
import {
    Home,
    ClipboardCheck,
    CheckSquare,
    CircleDollarSign,
    CalendarCheck,
    ClipboardList,
    Clock,
    LayoutGrid,
    type LucideIcon,
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { useMemo } from 'react'
import { motion } from 'framer-motion'

type TabColorStyle = {
    activeIcon: string
    activeBg: string
    activeText: string
    indicatorColor: string
}

// Color map aligned with department palette (brand red, operations blue, sales rose, staff cyan)
const TAB_COLORS: Record<string, TabColorStyle> = {
    home: {
        activeIcon: 'text-red-600 dark:text-red-400',
        activeBg: 'bg-red-500/12 dark:bg-red-500/25 ring-1 ring-red-500/25',
        activeText: 'text-red-600 dark:text-red-400',
        indicatorColor: 'bg-red-600',
    },
    inspect: {
        activeIcon: 'text-blue-600 dark:text-blue-400',
        activeBg: 'bg-blue-500/12 dark:bg-blue-500/25 ring-1 ring-blue-500/25',
        activeText: 'text-blue-600 dark:text-blue-400',
        indicatorColor: 'bg-blue-600',
    },
    tasks: {
        activeIcon: 'text-blue-600 dark:text-blue-400',
        activeBg: 'bg-blue-500/12 dark:bg-blue-500/25 ring-1 ring-blue-500/25',
        activeText: 'text-blue-600 dark:text-blue-400',
        indicatorColor: 'bg-blue-600',
    },
    actividades: {
        activeIcon: 'text-blue-600 dark:text-blue-400',
        activeBg: 'bg-blue-500/12 dark:bg-blue-500/25 ring-1 ring-blue-500/25',
        activeText: 'text-blue-600 dark:text-blue-400',
        indicatorColor: 'bg-blue-600',
    },
    sales: {
        activeIcon: 'text-rose-600 dark:text-rose-400',
        activeBg: 'bg-rose-500/12 dark:bg-rose-500/25 ring-1 ring-rose-500/25',
        activeText: 'text-rose-600 dark:text-rose-400',
        indicatorColor: 'bg-rose-600',
    },
    planner: {
        activeIcon: 'text-cyan-600 dark:text-cyan-400',
        activeBg: 'bg-cyan-500/12 dark:bg-cyan-500/25 ring-1 ring-cyan-500/25',
        activeText: 'text-cyan-600 dark:text-cyan-400',
        indicatorColor: 'bg-cyan-600',
    },
    schedule: {
        activeIcon: 'text-cyan-600 dark:text-cyan-400',
        activeBg: 'bg-cyan-500/12 dark:bg-cyan-500/25 ring-1 ring-cyan-500/25',
        activeText: 'text-cyan-600 dark:text-cyan-400',
        indicatorColor: 'bg-cyan-600',
    },
    more: {
        activeIcon: 'text-red-600 dark:text-red-400',
        activeBg: 'bg-red-500/12 dark:bg-red-500/25 ring-1 ring-red-500/25',
        activeText: 'text-red-600 dark:text-red-400',
        indicatorColor: 'bg-red-600',
    },
}

const STANDALONE_SIBLING_PATHS = ['/ventas/reportes']

interface BottomTabBarProps {
    onOpenDrawer: () => void
    isDrawerOpen?: boolean
}

export default function BottomTabBar({ onOpenDrawer, isDrawerOpen = false }: BottomTabBarProps) {
    const pathname = usePathname()
    const { user } = useAuth()
    const { t } = useLanguage()

    const rawRole = (user?.role || user?.user_type || '').toLowerCase()
    const userRole =
        rawRole === 'gerente'
            ? 'manager'
            : rawRole === 'regional_manager'
                ? 'supervisor'
                : rawRole === 'assistant'
                    ? 'asistente'
                    : rawRole
    const userEmailNorm = (user?.email || '').trim().toLowerCase()
    const isPlanificadorOnly = userEmailNorm === 'stephany@cingularhr.com' || userRole === 'planificador'
    const isEmployeeOnly = (user?.user_type || '').toLowerCase() === 'employee' || rawRole === 'employee'
    const isVikesh = userEmailNorm === 'vikesh@tacosgavilan.com'

    const tabs = useMemo(() => {
        if (isPlanificadorOnly) {
            return [{ label: t('bottom_nav.planner'), icon: CalendarCheck, path: '/planificador', id: 'planner' }]
        }
        if (isEmployeeOnly) {
            return [{ label: t('bottom_nav.schedule'), icon: Clock, path: '/mis-horarios', id: 'schedule' }]
        }

        const items: { label: string; icon: LucideIcon; path: string; id: string }[] = [
            { label: t('bottom_nav.home'), icon: Home, path: '/inicio', id: 'home' },
        ]

        if (['supervisor', 'admin', 'auditor'].includes(userRole)) {
            items.push({ label: t('bottom_nav.inspect'), icon: ClipboardCheck, path: '/inspecciones', id: 'inspect' })
        } else if (userRole === 'manager') {
            items.push({ label: t('bottom_nav.tasks'), icon: CheckSquare, path: '/checklists-manager', id: 'tasks' })
        } else {
            items.push({ label: t('bottom_nav.tasks'), icon: CheckSquare, path: '/checklists', id: 'tasks' })
        }

        if (['admin', 'manager', 'supervisor'].includes(userRole)) {
            if (!isVikesh) {
                items.push({ label: t('bottom_nav.sales'), icon: CircleDollarSign, path: '/ventas', id: 'sales' })
            }
            items.push({ label: t('bottom_nav.planner'), icon: CalendarCheck, path: '/planificador', id: 'planner' })
        } else if (userRole !== 'auditor') {
            items.push({ label: t('bottom_nav.activities'), icon: ClipboardList, path: '/actividades', id: 'actividades' })
            items.push({ label: t('bottom_nav.schedule'), icon: Clock, path: '/mis-horarios', id: 'schedule' })
        }

        return items
    }, [userRole, isPlanificadorOnly, isEmployeeOnly, isVikesh, t])

    // All items including "Más" / "More" drawer launcher
    const allItems = useMemo(() => {
        if (isPlanificadorOnly || isEmployeeOnly) {
            return tabs
        }
        return [
            ...tabs,
            { label: t('bottom_nav.more'), icon: LayoutGrid, path: '__drawer__', id: 'more' }
        ]
    }, [tabs, isPlanificadorOnly, isEmployeeOnly, t])

    // Determine active tab index (prioritize drawer button while drawer is open; exclude standalone sibling sub-routes)
    const activeIndex = useMemo(() => {
        if (isDrawerOpen) {
            return allItems.findIndex(item => item.path === '__drawer__')
        }
        const isStandaloneSibling = STANDALONE_SIBLING_PATHS.some(
            p => pathname === p || pathname.startsWith(p + '/')
        )
        const idx = allItems.findIndex(
            item =>
                item.path !== '__drawer__' &&
                (pathname === item.path || (!isStandaloneSibling && pathname.startsWith(item.path + '/')))
        )
        return idx >= 0 ? idx : -1
    }, [pathname, allItems, isDrawerOpen])

    return (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50">
            {/* Elevated mobile navigation bar with opaque safe-area surface */}
            <div
                className="bg-white/95 dark:bg-slate-950/95 backdrop-blur-xl border-t border-slate-200/90 dark:border-slate-800 shadow-[0_-6px_24px_-6px_rgba(15,23,42,0.10)]"
                style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
            >
                <div className="flex items-stretch justify-around h-[74px] px-1.5">
                    {allItems.map((tab, index) => {
                        const isActive = index === activeIndex
                        const isDrawer = tab.path === '__drawer__'
                        const Icon = tab.icon
                        const colors = TAB_COLORS[tab.id] || TAB_COLORS.more

                        const content = (
                            <div className="relative flex flex-col items-center justify-center gap-1.5 flex-1 h-full py-1.5 select-none">
                                {/* Active top indicator bar */}
                                {isActive && (
                                    <motion.div
                                        layoutId="bottomTabIndicator"
                                        className={`absolute top-0 left-1/2 -translate-x-1/2 w-10 h-[3.5px] rounded-b-full ${colors.indicatorColor}`}
                                        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                                    />
                                )}

                                {/* Enlarged tactile icon capsule */}
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
                                    <Icon
                                        size={isActive ? 25 : 23}
                                        strokeWidth={isActive ? 2.45 : 2.15}
                                        className={`relative z-10 transition-transform duration-200 group-active:scale-90 ${
                                            isActive
                                                ? colors.activeIcon
                                                : 'text-slate-600 dark:text-slate-300'
                                        }`}
                                    />
                                </div>

                                {/* Clear Label */}
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
                                    key={tab.id}
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
                                key={tab.id}
                                href={tab.path}
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
    )
}
