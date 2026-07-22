'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from './ProtectedRoute'
import { LayoutDashboard, ClipboardList, DollarSign, Calendar, Clock, Grid3X3, Users } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { useMemo } from 'react'
import { motion } from 'framer-motion'

// Match sidebar GROUP_COLORS for each tab
const TAB_COLORS: Record<string, { icon: string; activeIcon: string; activeBg: string; activeText: string; indicatorColor: string }> = {
    home:     { icon: 'text-slate-400 dark:text-slate-500', activeIcon: 'text-blue-600 dark:text-blue-400',    activeBg: 'bg-blue-50 dark:bg-blue-950/40',       activeText: 'text-blue-600 dark:text-blue-400',    indicatorColor: 'bg-blue-500' },
    inspect:  { icon: 'text-slate-400 dark:text-slate-500', activeIcon: 'text-blue-600 dark:text-blue-400',    activeBg: 'bg-blue-50 dark:bg-blue-950/40',       activeText: 'text-blue-600 dark:text-blue-400',    indicatorColor: 'bg-blue-500' },
    tasks:    { icon: 'text-slate-400 dark:text-slate-500', activeIcon: 'text-blue-600 dark:text-blue-400',    activeBg: 'bg-blue-50 dark:bg-blue-950/40',       activeText: 'text-blue-600 dark:text-blue-400',    indicatorColor: 'bg-blue-500' },
    sales:    { icon: 'text-slate-400 dark:text-slate-500', activeIcon: 'text-orange-600 dark:text-orange-400', activeBg: 'bg-orange-50 dark:bg-orange-950/40',   activeText: 'text-orange-600 dark:text-orange-400', indicatorColor: 'bg-orange-500' },
    planner:  { icon: 'text-slate-400 dark:text-slate-500', activeIcon: 'text-orange-600 dark:text-orange-400', activeBg: 'bg-orange-50 dark:bg-orange-950/40',   activeText: 'text-orange-600 dark:text-orange-400', indicatorColor: 'bg-orange-500' },
    roles:    { icon: 'text-slate-400 dark:text-slate-500', activeIcon: 'text-cyan-600 dark:text-cyan-400',    activeBg: 'bg-cyan-50 dark:bg-cyan-950/40',       activeText: 'text-cyan-600 dark:text-cyan-400',    indicatorColor: 'bg-cyan-500' },
    schedule: { icon: 'text-slate-400 dark:text-slate-500', activeIcon: 'text-cyan-600 dark:text-cyan-400',    activeBg: 'bg-cyan-50 dark:bg-cyan-950/40',       activeText: 'text-cyan-600 dark:text-cyan-400',    indicatorColor: 'bg-cyan-500' },
    more:     { icon: 'text-slate-400 dark:text-slate-500', activeIcon: 'text-slate-600 dark:text-slate-300',  activeBg: 'bg-slate-50 dark:bg-slate-800/40',     activeText: 'text-slate-600 dark:text-slate-300',  indicatorColor: 'bg-slate-400' },
}

interface BottomTabBarProps {
    onOpenDrawer: () => void
}

export default function BottomTabBar({ onOpenDrawer }: BottomTabBarProps) {
    const pathname = usePathname()
    const { user } = useAuth()
    const { language } = useLanguage()

    const userRole = (user?.role || user?.user_type || '').toLowerCase()

    const tabs = useMemo(() => {
        const items: { label: string; icon: typeof LayoutDashboard; path: string; id: string }[] = [
            { label: 'Home', icon: LayoutDashboard, path: '/dashboard', id: 'home' },
        ]

        if (['supervisor', 'admin'].includes(userRole)) {
            items.push({ label: 'Inspect', icon: ClipboardList, path: '/inspecciones', id: 'inspect' })
        } else if (userRole === 'manager') {
            items.push({ label: 'Tasks', icon: ClipboardList, path: '/checklists-manager', id: 'tasks' })
        } else {
            items.push({ label: 'Tasks', icon: ClipboardList, path: '/checklists', id: 'tasks' })
        }

        if (['admin', 'manager', 'supervisor'].includes(userRole)) {
            items.push({ label: language === 'es' ? 'Ventas' : 'Sales', icon: DollarSign, path: '/ventas', id: 'sales' })
            items.push({ label: 'Planner', icon: Calendar, path: '/planificador', id: 'planner' })
        } else {
            items.push({ label: language === 'es' ? 'Actividades' : 'Activities', icon: ClipboardList, path: '/actividades', id: 'actividades' })
            items.push({ label: language === 'es' ? 'Horario' : 'Schedule', icon: Clock, path: '/mis-horarios', id: 'schedule' })
        }

        return items
    }, [userRole, language])

    // All items including "Más"
    const allItems = useMemo(() => [
        ...tabs,
        { label: language === 'es' ? 'Más' : 'More', icon: Grid3X3, path: '__drawer__', id: 'more' }
    ], [tabs, language])

    // Find active index
    const activeIndex = useMemo(() => {
        const idx = allItems.findIndex(t => t.path !== '__drawer__' && (pathname === t.path || pathname.startsWith(t.path + '/')))
        return idx >= 0 ? idx : -1
    }, [pathname, allItems])

    return (
        <div
            className="lg:hidden fixed bottom-0 left-0 right-0 z-50"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
            {/* Clean card container matching sidebar style */}
            <div className="bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800">
                {/* Tabs Row */}
                <div className="flex items-stretch justify-around h-[60px]">
                    {allItems.map((tab, index) => {
                        const isActive = index === activeIndex
                        const isDrawer = tab.path === '__drawer__'
                        const Icon = tab.icon
                        const colors = TAB_COLORS[tab.id] || TAB_COLORS.more

                        const content = (
                            <div
                                className={`relative flex flex-col items-center justify-center gap-1 flex-1 py-2 transition-all duration-200 ${
                                    isActive ? '' : 'active:scale-95'
                                }`}
                            >
                                {/* Active top indicator bar */}
                                {isActive && (
                                    <motion.div
                                        layoutId="bottomTabIndicator"
                                        className={`absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[3px] rounded-b-full ${colors.indicatorColor}`}
                                        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                                    />
                                )}

                                {/* Icon */}
                                <div className={`transition-all duration-200 ${
                                    isActive
                                        ? `${colors.activeIcon} scale-110`
                                        : colors.icon
                                }`}>
                                    <Icon
                                        size={20}
                                        strokeWidth={isActive ? 2.5 : 1.8}
                                    />
                                </div>

                                {/* Label */}
                                <span
                                    className={`text-[10px] leading-none transition-all duration-200 ${
                                        isActive
                                            ? `${colors.activeText} font-bold`
                                            : 'text-slate-400 dark:text-slate-500 font-medium'
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
                                    onClick={onOpenDrawer}
                                    className="flex-1 outline-none focus:outline-none"
                                >
                                    {content}
                                </button>
                            )
                        }

                        return (
                            <Link
                                key={tab.id}
                                href={tab.path}
                                className="flex-1 outline-none focus:outline-none"
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
