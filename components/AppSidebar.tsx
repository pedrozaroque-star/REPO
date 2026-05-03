'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import NotificationBell from './NotificationBell'
import ThemeToggle from './ThemeToggle'
import React, { useState, useMemo, useEffect } from 'react'
import { useAuth } from './ProtectedRoute'
import { getSupabaseClient } from '@/lib/supabase'
import {
    LogOut, ChevronDown, ChevronRight, ChevronLeft, User, QrCode, ClipboardList,
    Briefcase, CheckSquare, Clock, LayoutDashboard, Store, Users, FileEdit,
    DollarSign, TrendingUp, Calendar, MessageSquare, CalendarCheck, UserCog,
    Monitor, ChefHat, Zap, X, PanelLeftClose, PanelLeft
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useLanguage } from '@/lib/i18n'

interface AppSidebarProps {
    isCollapsed: boolean
    setIsCollapsed: (value: boolean) => void
    mobileDrawerOpen: boolean
    setMobileDrawerOpen: (value: boolean) => void
}

type MenuItem = {
    name: string | React.ReactNode
    plainName?: string
    path: string
    icon: React.ReactNode
    roles: string[]
}

type MenuGroup = {
    title: string
    id: string
    items: MenuItem[]
}

// Color map per group
const GROUP_COLORS: Record<string, { icon: string; activeBg: string; activeBorder: string }> = {
    operaciones: {
        icon: 'text-blue-600 dark:text-blue-400',
        activeBg: 'bg-blue-50 dark:bg-blue-950/40',
        activeBorder: 'border-l-blue-500',
    },
    gestion: {
        icon: 'text-emerald-600 dark:text-emerald-400',
        activeBg: 'bg-emerald-50 dark:bg-emerald-950/40',
        activeBorder: 'border-l-emerald-500',
    },
    analisis: {
        icon: 'text-orange-600 dark:text-orange-400',
        activeBg: 'bg-orange-50 dark:bg-orange-950/40',
        activeBorder: 'border-l-orange-500',
    },
    inventario: {
        icon: 'text-purple-600 dark:text-purple-400',
        activeBg: 'bg-purple-50 dark:bg-purple-950/40',
        activeBorder: 'border-l-purple-500',
    },
    kioskos: {
        icon: 'text-pink-600 dark:text-pink-400',
        activeBg: 'bg-pink-50 dark:bg-pink-950/40',
        activeBorder: 'border-l-pink-500',
    },
    equipo: {
        icon: 'text-cyan-600 dark:text-cyan-400',
        activeBg: 'bg-cyan-50 dark:bg-cyan-950/40',
        activeBorder: 'border-l-cyan-500',
    },
    food_cost: {
        icon: 'text-amber-600 dark:text-amber-400',
        activeBg: 'bg-amber-50 dark:bg-amber-950/40',
        activeBorder: 'border-l-amber-500',
    },
}

export default function AppSidebar({ isCollapsed, setIsCollapsed, mobileDrawerOpen, setMobileDrawerOpen }: AppSidebarProps) {
    const pathname = usePathname()
    const router = useRouter()
    const { user } = useAuth()
    const { t, language, setLanguage } = useLanguage()

    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
        operaciones: true, gestion: true, analisis: true,
        inventario: true, kioskos: true, equipo: true, food_cost: true,
    })

    // Menu groups (same as TopNav)
    const menuGroups: MenuGroup[] = [
        {
            title: t('sections.operations'), id: 'operaciones',
            items: [
                { name: t('items.supervisor'), plainName: 'Supervisor', path: '/inspecciones', icon: <ClipboardList size={20} />, roles: ['supervisor', 'admin'] },
                { name: t('items.manager'), plainName: 'Manager', path: '/checklists-manager', icon: <Briefcase size={20} />, roles: ['manager', 'supervisor', 'admin'] },
                { name: t('items.assistants'), plainName: 'Asistentes', path: '/checklists', icon: <CheckSquare size={20} />, roles: ['asistente', 'manager', 'supervisor', 'admin'] },
                { name: t('items.schedules'), plainName: 'Horarios', path: '/horarios', icon: <Clock size={20} />, roles: ['manager', 'supervisor', 'admin'] },
                { name: t('items.dashboard'), plainName: 'Dashboard', path: '/dashboard', icon: <LayoutDashboard size={20} />, roles: ['manager', 'supervisor', 'admin'] },
            ]
        },
        {
            title: t('sections.management'), id: 'gestion',
            items: [
                { name: t('items.stores'), plainName: 'Tiendas', path: '/tiendas', icon: <Store size={20} />, roles: ['admin'] },
                { name: 'TV Menús', plainName: 'TV Menús', path: '/admin/tv-menus', icon: <Monitor size={20} />, roles: ['admin', 'supervisor'] },
                { name: t('items.users'), plainName: 'Usuarios', path: '/usuarios', icon: <Users size={20} />, roles: ['admin', 'supervisor'] },
                { name: t('items.templates'), plainName: 'Plantillas', path: '/admin/plantillas', icon: <FileEdit size={20} />, roles: ['admin'] },
            ]
        },
        {
            title: t('sections.analysis'), id: 'analisis',
            items: [
                { name: t('items.sales'), plainName: 'Ventas', path: '/ventas', icon: <DollarSign size={20} />, roles: ['admin', 'manager', 'supervisor'] },
                { name: 'Descuentos', plainName: 'Descuentos', path: '/admin/auditoria-descuentos', icon: <ClipboardList size={20} />, roles: ['admin', 'supervisor', 'manager'] },
                {
                    name: t('items.reports'), plainName: 'Reportes',
                    path: '/ventas/reportes',
                    icon: (
                        <div className="relative inline-block">
                            <TrendingUp size={20} />
                            <span className="absolute -top-1 -right-2 flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                            </span>
                        </div>
                    ),
                    roles: ['manager', 'supervisor', 'admin']
                },
                { name: t('items.planner'), plainName: 'Planificador', path: '/planificador', icon: <Calendar size={20} />, roles: ['manager', 'supervisor', 'admin'] },
                { name: 'Descansos AI', plainName: 'Descansos', path: '/descansos', icon: <Zap size={20} />, roles: ['manager', 'supervisor', 'admin'] },
                { name: t('items.feedback'), plainName: 'Feedback', path: '/feedback', icon: <MessageSquare size={20} />, roles: ['asistente', 'manager', 'supervisor', 'admin'] },
            ]
        },
        {
            title: t('sections.inventory'), id: 'inventario',
            items: [
                { name: t('items.inventory_dashboard'), plainName: 'Inventario', path: '/inventory', icon: <LayoutDashboard size={20} />, roles: ['admin', 'manager', 'supervisor'] },
                { name: t('items.ingredients'), plainName: 'Insumos', path: '/inventory/items', icon: <Store size={20} />, roles: ['admin', 'manager', 'supervisor'] },
                { name: t('items.menu_catalog'), plainName: 'Catálogo', path: '/inventory/menu', icon: <ClipboardList size={20} />, roles: ['admin', 'manager', 'supervisor'] },
                { name: t('items.food_costs'), plainName: 'Costos', path: '/inventory/costs', icon: <TrendingUp size={20} />, roles: ['admin', 'manager'] },
                { name: 'Preparador', plainName: 'Preparador', path: '/inventory/preparador', icon: <ChefHat size={20} />, roles: ['admin', 'manager', 'supervisor', 'asistente'] },
            ]
        },
        {
            title: t('sections.kiosks'), id: 'kioskos',
            items: [
                { name: t('items.kiosk_feedback'), plainName: 'Kiosk Feedback', path: '/clientes', icon: <QrCode size={20} />, roles: ['admin', 'manager', 'supervisor'] },
                {
                    name: (
                        <div className="flex items-center gap-2">
                            <span>{t('items.eval_staff')}</span>
                            <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 rounded font-black tracking-widest">DEMO</span>
                        </div>
                    ),
                    plainName: 'Eval. Staff',
                    path: '/evaluacion', icon: <QrCode size={20} />,
                    roles: ['admin', 'manager', 'supervisor']
                },
            ]
        },
        {
            title: t('sections.team'), id: 'equipo',
            items: [
                { name: 'ROLES', plainName: 'Roles', path: '/roles', icon: <Users size={20} />, roles: ['manager', 'supervisor', 'admin', 'asistente'] },
                { name: t('items.my_schedule'), plainName: 'Mi Horario', path: '/mis-horarios', icon: <CalendarCheck size={20} />, roles: ['asistente', 'manager', 'supervisor', 'admin'] },
                { name: t('items.self_scheduling'), plainName: 'Auto-Schedule', path: '/gestion/auto-schedule', icon: <UserCog size={20} />, roles: ['supervisor', 'admin'] },
            ]
        },
        {
            title: t('sections.food_cost'), id: 'food_cost',
            items: [
                { name: t('items.food_cost_report'), plainName: 'Food Cost', path: '/admin/food-cost', icon: <DollarSign size={20} />, roles: ['admin', 'manager', 'supervisor'] },
                { name: t('items.food_cost_meats'), plainName: 'Carnes', path: '/admin/food-cost/meats', icon: <TrendingUp size={20} />, roles: ['admin', 'manager', 'supervisor'] },
            ]
        }
    ]

    const handleLogout = () => {
        localStorage.removeItem('teg_token')
        localStorage.removeItem('teg_user')
        router.push('/login')
    }

    // Filter groups by role (same logic as TopNav)
    const filteredGroups = useMemo(() => {
        const isVikesh = user?.email === 'vikesh@tacosgavilan.com'
        return menuGroups.map(group => {
            if (isVikesh && (group.id === 'inventario' || group.id === 'food_cost')) {
                return { ...group, items: [] }
            }
            const validItems = group.items.filter(item => {
                if (isVikesh && (item.path === '/ventas' || item.path === '/ventas/reportes')) return false
                if (!item.roles || item.roles.length === 0) return true
                const userRole = (user?.role || user?.user_type || '').toLowerCase()
                if (!userRole) return false
                return item.roles.includes(userRole)
            })
            return { ...group, items: validItems }
        }).filter(group => group.items.length > 0)
    }, [user, language])

    // 🧹 Weekly notification cleanup (from Sidebar.tsx)
    useEffect(() => {
        const runWeeklyCleanup = async () => {
            if (!user) return
            const now = new Date()
            const isMonday = now.getDay() === 1
            const isAfter6AM = now.getHours() >= 6
            const todayStr = now.toISOString().split('T')[0]
            const lastCleanup = localStorage.getItem('last_week_cleanup')
            if (isMonday && isAfter6AM && lastCleanup !== todayStr) {
                try {
                    const monday6AM = new Date(now)
                    monday6AM.setHours(6, 0, 0, 0)
                    const supabase = await getSupabaseClient()
                    await supabase.from('notifications').delete().eq('user_id', user.id).lt('created_at', monday6AM.toISOString())
                    localStorage.setItem('last_week_cleanup', todayStr)
                } catch (e) { /* silent */ }
            }
        }
        runWeeklyCleanup()
    }, [user])

    // Body scroll lock when mobile drawer is open
    useEffect(() => {
        if (mobileDrawerOpen) {
            const scrollY = window.scrollY
            document.body.style.position = 'fixed'
            document.body.style.top = `-${scrollY}px`
            document.body.style.width = '100%'
            document.body.style.overflow = 'hidden'
            return () => {
                document.body.style.position = ''
                document.body.style.top = ''
                document.body.style.width = ''
                document.body.style.overflow = ''
                window.scrollTo(0, scrollY)
            }
        }
    }, [mobileDrawerOpen])

    const toggleGroup = (groupId: string) => {
        setExpandedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }))
    }

    // Render a single nav item
    const renderNavItem = (item: MenuItem, groupId: string, isMobile: boolean = false) => {
        const isActive = pathname === item.path || (item.path !== '/dashboard' && pathname.startsWith(item.path + '/'))
        const colors = GROUP_COLORS[groupId] || GROUP_COLORS.operaciones

        return (
            <Link
                key={item.path}
                href={item.path}
                onClick={() => { if (isMobile) setMobileDrawerOpen(false) }}
                title={isCollapsed && !isMobile ? (item.plainName || '') : undefined}
                className={`group/item relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-200 border-l-[3px] ${
                    isActive
                        ? `${colors.activeBg} ${colors.activeBorder} font-semibold text-slate-900 dark:text-white`
                        : 'border-l-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200'
                } ${isCollapsed && !isMobile ? 'justify-center px-2' : ''}`}
            >
                <div className={`flex-shrink-0 transition-transform duration-200 ${isActive ? `${colors.icon} scale-110` : `${colors.icon} opacity-70 group-hover/item:opacity-100`}`}>
                    {React.cloneElement(item.icon as any, { size: 18, strokeWidth: isActive ? 2.5 : 2 })}
                </div>
                {(!isCollapsed || isMobile) && (
                    <span className="truncate">{item.name}</span>
                )}
                {/* Collapsed tooltip */}
                {isCollapsed && !isMobile && (
                    <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-slate-900 dark:bg-slate-700 text-white text-xs font-medium rounded-md shadow-lg opacity-0 group-hover/item:opacity-100 pointer-events-none transition-opacity duration-150 whitespace-nowrap z-[200]">
                        {item.plainName || item.name}
                        <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-slate-900 dark:border-r-slate-700" />
                    </div>
                )}
            </Link>
        )
    }

    // Shared nav content
    const renderNavContent = (isMobile: boolean = false) => (
        <nav className="flex-1 overflow-y-auto overflow-x-visible px-3 py-3 space-y-1 no-scrollbar">
            {filteredGroups.map((group) => {
                const isOpen = expandedGroups[group.id] ?? true
                return (
                    <div key={group.id} className="mb-1">
                        {/* Group header */}
                        {(!isCollapsed || isMobile) ? (
                            <button
                                onClick={() => toggleGroup(group.id)}
                                className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors rounded-md"
                            >
                                <span>{group.title}</span>
                                <ChevronDown size={12} className={`transition-transform duration-200 ${isOpen ? '' : '-rotate-90'}`} />
                            </button>
                        ) : (
                            <div className="h-px bg-slate-200 dark:bg-slate-800 my-2 mx-2" />
                        )}

                        {/* Group items */}
                        {(isOpen || (isCollapsed && !isMobile)) && (
                            <div className="space-y-0.5 mt-0.5">
                                {group.items.map(item => renderNavItem(item, group.id, isMobile))}
                            </div>
                        )}
                    </div>
                )
            })}
        </nav>
    )

    return (
        <>
            {/* ============ DESKTOP SIDEBAR ============ */}
            <aside
                className={`hidden lg:flex flex-col fixed inset-y-0 left-0 z-40 bg-white dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 transition-all duration-300 ease-in-out overflow-visible ${
                    isCollapsed ? 'w-[64px]' : 'w-[260px]'
                }`}
            >
                {/* Logo Section */}
                <div className="flex-shrink-0 h-16 border-b border-slate-100 dark:border-slate-800/80 flex items-center px-4 gap-3">
                    <Link href="/dashboard" className="flex items-center gap-3 group min-w-0 flex-1">
                        <div className="flex-shrink-0 w-9 h-9 relative">
                            <img
                                src="/logo.png"
                                alt="TEG Logo"
                                className="w-full h-full object-contain drop-shadow-md transition-transform group-hover:scale-110"
                            />
                        </div>
                        {!isCollapsed && (
                            <div className="flex flex-col leading-tight min-w-0">
                                <span className="text-base font-black tracking-tight text-slate-900 dark:text-white truncate">
                                    SM<span className="text-red-600 font-semibold ml-0.5">TEG</span>
                                </span>
                                <span className="text-[10px] font-medium text-red-500 dark:text-red-400 tracking-wide truncate">
                                    {t('nav.title')}
                                </span>
                            </div>
                        )}
                    </Link>
                </div>

                {/* Navigation */}
                {renderNavContent(false)}

                {/* User Section */}
                <div className="flex-shrink-0 border-t border-slate-100 dark:border-slate-800/80 p-3 space-y-2">
                    {/* User info */}
                    <div className={`flex items-center gap-2.5 px-1 ${isCollapsed ? 'justify-center' : ''}`}>
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-tr from-red-500 to-orange-500 flex items-center justify-center text-white text-xs font-bold shadow-sm ring-2 ring-white dark:ring-slate-950">
                            {user?.name?.[0] || <User size={14} />}
                        </div>
                        {!isCollapsed && (
                            <div className="min-w-0 flex-1">
                                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">{user?.name?.split(' ')[0] || 'Usuario'}</p>
                                <p className="text-[10px] text-slate-400 dark:text-slate-500 capitalize truncate">{user?.role || 'Staff'}</p>
                            </div>
                        )}
                    </div>

                    {/* Action buttons */}
                    <div className={`flex items-center ${isCollapsed ? 'flex-col gap-1' : 'justify-between'}`}>
                        <div className={`flex items-center ${isCollapsed ? 'flex-col gap-0.5' : 'gap-0.5'}`}>
                            <button
                                onClick={() => setLanguage(language === 'es' ? 'en' : 'es')}
                                className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-[10px] font-black flex items-center gap-0.5"
                            >
                                <span className={language === 'en' ? 'text-red-600' : 'text-slate-400'}>EN</span>
                                <span className="text-slate-300 dark:text-slate-700">/</span>
                                <span className={language === 'es' ? 'text-red-600' : 'text-slate-400'}>ES</span>
                            </button>
                            <ThemeToggle />
                            <NotificationBell />
                        </div>
                        {!isCollapsed && (
                            <button
                                onClick={handleLogout}
                                className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-950/30 text-slate-400 hover:text-red-500 transition-colors"
                                title={t('nav.logout')}
                            >
                                <LogOut size={16} />
                            </button>
                        )}
                    </div>

                    {/* Collapse toggle */}
                    <button
                        onClick={() => setIsCollapsed(!isCollapsed)}
                        className="w-full flex items-center justify-center gap-2 py-1.5 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-xs"
                    >
                        {isCollapsed ? <PanelLeft size={16} /> : <><PanelLeftClose size={16} /><span className="font-medium">Colapsar</span></>}
                    </button>
                </div>
            </aside>

            {/* ============ MOBILE TOP BAR ============ */}
            <header className="lg:hidden fixed top-0 left-0 right-0 z-50 h-14 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-slate-200/60 dark:border-slate-800/60 flex items-center justify-between px-4">
                <Link href="/dashboard" className="flex items-center gap-2.5 group">
                    <img src="/logo.png" alt="TEG" className="w-8 h-8 object-contain transition-transform group-hover:scale-110" />
                    <span className="text-base font-black text-slate-900 dark:text-white">
                        SM<span className="text-red-600 font-semibold ml-0.5">TEG</span>
                    </span>
                </Link>

                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setLanguage(language === 'es' ? 'en' : 'es')}
                        className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-[10px] font-black flex items-center gap-0.5"
                    >
                        <span className={language === 'en' ? 'text-red-600' : 'text-slate-400'}>EN</span>
                        <span className="text-slate-300 dark:text-slate-700">/</span>
                        <span className={language === 'es' ? 'text-red-600' : 'text-slate-400'}>ES</span>
                    </button>
                    <ThemeToggle />
                    <NotificationBell />
                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-tr from-red-500 to-orange-500 flex items-center justify-center text-white text-[10px] font-bold ring-2 ring-white dark:ring-slate-900">
                        {user?.name?.[0] || '?'}
                    </div>
                </div>
            </header>

            {/* ============ MOBILE DRAWER OVERLAY ============ */}
            <AnimatePresence>
                {mobileDrawerOpen && (
                    <>
                        {/* Backdrop */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            onClick={() => setMobileDrawerOpen(false)}
                            className="lg:hidden fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm"
                        />
                        {/* Drawer */}
                        <motion.aside
                            initial={{ x: '-100%' }}
                            animate={{ x: 0 }}
                            exit={{ x: '-100%' }}
                            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                            className="lg:hidden fixed inset-y-0 left-0 z-[80] w-[280px] bg-white dark:bg-slate-950 shadow-2xl flex flex-col"
                        >
                            {/* Drawer Header */}
                            <div className="flex-shrink-0 h-14 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between px-4">
                                <div className="flex items-center gap-2.5">
                                    <img src="/logo.png" alt="TEG" className="w-8 h-8 object-contain" />
                                    <span className="text-base font-black text-slate-900 dark:text-white">
                                        SM<span className="text-red-600 font-semibold ml-0.5">TEG</span>
                                    </span>
                                </div>
                                <button
                                    onClick={() => setMobileDrawerOpen(false)}
                                    className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition-colors"
                                >
                                    <X size={20} />
                                </button>
                            </div>

                            {/* Drawer Navigation */}
                            {renderNavContent(true)}

                            {/* Drawer Footer */}
                            <div className="flex-shrink-0 border-t border-slate-100 dark:border-slate-800 p-4">
                                <div className="flex items-center gap-3 mb-3">
                                    <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-red-500 to-orange-500 flex items-center justify-center text-white text-sm font-bold ring-2 ring-white dark:ring-slate-950">
                                        {user?.name?.[0] || '?'}
                                    </div>
                                    <div>
                                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{user?.name?.split(' ')[0] || 'Usuario'}</p>
                                        <p className="text-xs text-slate-400 capitalize">{user?.role || 'Staff'}</p>
                                    </div>
                                </div>
                                <button
                                    onClick={handleLogout}
                                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-red-50 dark:hover:bg-red-950/30 hover:text-red-600 text-sm font-semibold transition-colors"
                                >
                                    <LogOut size={16} />
                                    {t('nav.logout')}
                                </button>
                            </div>
                        </motion.aside>
                    </>
                )}
            </AnimatePresence>
        </>
    )
}
