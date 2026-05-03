'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from './ProtectedRoute'
import { LayoutDashboard, ClipboardList, DollarSign, Calendar, Clock, Grid3X3, Users } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { useMemo, useRef, useState, useEffect, useLayoutEffect } from 'react'
import { motion } from 'framer-motion'

interface BottomTabBarProps {
    onOpenDrawer: () => void
}

export default function BottomTabBar({ onOpenDrawer }: BottomTabBarProps) {
    const pathname = usePathname()
    const { user } = useAuth()
    const { t } = useLanguage()
    const containerRef = useRef<HTMLDivElement>(null)
    const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 })

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
            items.push({ label: 'Ventas', icon: DollarSign, path: '/ventas', id: 'sales' })
            items.push({ label: 'Planner', icon: Calendar, path: '/planificador', id: 'planner' })
        } else {
            items.push({ label: 'Roles', icon: Users, path: '/roles', id: 'roles' })
            items.push({ label: 'Horario', icon: Clock, path: '/mis-horarios', id: 'schedule' })
        }

        return items
    }, [userRole])

    // All items including "Más"
    const allItems = useMemo(() => [
        ...tabs,
        { label: 'Más', icon: Grid3X3, path: '__drawer__', id: 'more' }
    ], [tabs])

    // Find active index
    const activeIndex = useMemo(() => {
        const idx = allItems.findIndex(t => t.path !== '__drawer__' && (pathname === t.path || pathname.startsWith(t.path + '/')))
        return idx >= 0 ? idx : -1
    }, [pathname, allItems])

    // Calculate indicator position based on active tab
    useLayoutEffect(() => {
        if (activeIndex < 0 || !containerRef.current) return
        const container = containerRef.current
        const items = container.querySelectorAll('[data-tab-item]')
        const activeItem = items[activeIndex] as HTMLElement
        if (!activeItem) return

        const containerRect = container.getBoundingClientRect()
        const itemRect = activeItem.getBoundingClientRect()

        setIndicatorStyle({
            left: itemRect.left - containerRect.left + (itemRect.width / 2) - 20,
            width: 40,
        })
    }, [activeIndex, allItems])

    // Recalculate on resize
    useEffect(() => {
        const handleResize = () => {
            if (activeIndex < 0 || !containerRef.current) return
            const container = containerRef.current
            const items = container.querySelectorAll('[data-tab-item]')
            const activeItem = items[activeIndex] as HTMLElement
            if (!activeItem) return
            const containerRect = container.getBoundingClientRect()
            const itemRect = activeItem.getBoundingClientRect()
            setIndicatorStyle({
                left: itemRect.left - containerRect.left + (itemRect.width / 2) - 20,
                width: 40,
            })
        }
        window.addEventListener('resize', handleResize)
        return () => window.removeEventListener('resize', handleResize)
    }, [activeIndex])

    return (
        <div
            className="lg:hidden fixed bottom-0 left-0 right-0 z-50 flex justify-center pointer-events-none"
            style={{ paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }}
        >
            {/* Floating Pill Container */}
            <div
                ref={containerRef}
                className="pointer-events-auto relative mx-4 w-full max-w-[420px] rounded-2xl overflow-hidden"
                style={{
                    background: 'rgba(15, 23, 42, 0.85)',
                    backdropFilter: 'blur(20px) saturate(180%)',
                    WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35), 0 2px 8px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
                }}
            >
                {/* Animated active indicator glow */}
                {activeIndex >= 0 && (
                    <motion.div
                        className="absolute top-0 h-[3px] rounded-full"
                        style={{
                            background: 'linear-gradient(90deg, #ef4444, #f97316, #ef4444)',
                            filter: 'blur(1px)',
                        }}
                        animate={{
                            left: indicatorStyle.left,
                            width: indicatorStyle.width,
                        }}
                        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    />
                )}

                {/* Tabs Row */}
                <div className="flex items-center justify-around h-[58px] px-2">
                    {allItems.map((tab, index) => {
                        const isActive = index === activeIndex
                        const isDrawer = tab.path === '__drawer__'
                        const Icon = tab.icon

                        const content = (
                            <div
                                data-tab-item
                                className={`relative flex flex-col items-center justify-center gap-[3px] py-1.5 px-3 rounded-xl transition-all duration-300 ${
                                    isActive
                                        ? ''
                                        : 'active:scale-90'
                                }`}
                            >
                                {/* Icon container with glow effect when active */}
                                <div className="relative">
                                    <Icon
                                        size={isActive ? 22 : 20}
                                        strokeWidth={isActive ? 2.5 : 1.6}
                                        className={`transition-all duration-300 ${
                                            isActive
                                                ? 'text-white drop-shadow-[0_0_8px_rgba(239,68,68,0.5)]'
                                                : 'text-slate-400'
                                        }`}
                                    />
                                    {/* Active dot indicator below icon */}
                                    {isActive && (
                                        <motion.div
                                            initial={{ scale: 0, opacity: 0 }}
                                            animate={{ scale: 1, opacity: 1 }}
                                            className="absolute -bottom-[2px] left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]"
                                        />
                                    )}
                                </div>

                                {/* Label */}
                                <span
                                    className={`text-[10px] leading-none transition-all duration-300 ${
                                        isActive
                                            ? 'text-white font-bold tracking-wide'
                                            : 'text-slate-500 font-medium'
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
                                    className="outline-none focus:outline-none"
                                >
                                    {content}
                                </button>
                            )
                        }

                        return (
                            <Link
                                key={tab.id}
                                href={tab.path}
                                className="outline-none focus:outline-none"
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
