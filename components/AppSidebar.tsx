'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import NotificationBell from './NotificationBell'
import ThemeToggle from './ThemeToggle'
import React, { useState, useMemo, useEffect, useRef } from 'react'
import { useAuth } from './ProtectedRoute'
import { getSupabaseClient } from '@/lib/supabase'
import {
    LogOut, ChevronDown, ChevronRight, ChevronLeft, User, QrCode, ClipboardList,
    Briefcase, CheckSquare, Clock, LayoutDashboard, Store, Users, FileEdit,
    DollarSign, TrendingUp, Calendar, MessageSquare, CalendarCheck, UserCog,
    Monitor, ChefHat, Zap, X, PanelLeftClose, PanelLeft, RefreshCw,
    Settings, Keyboard, HelpCircle, ExternalLink, Moon, Sun, Globe, Shield,
    CalendarDays, Sparkles, Info, UserCircle, Menu
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
    const [userDropdownOpen, setUserDropdownOpen] = useState(false)
    const dropdownRef = useRef<HTMLDivElement>(null)
    const mobileDropdownRef = useRef<HTMLDivElement>(null)

    // Close dropdown on click outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            const isOutsideDesktop = dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
            const isOutsideMobile = mobileDropdownRef.current && !mobileDropdownRef.current.contains(e.target as Node)
            if (isOutsideDesktop && isOutsideMobile) {
                setUserDropdownOpen(false)
            }
        }
        if (userDropdownOpen) document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [userDropdownOpen])

    // Menu groups (same as TopNav)
    const menuGroups: MenuGroup[] = [
        {
            title: t('sections.analysis'), id: 'analisis',
            items: [
                { name: t('items.sales'), plainName: 'Ventas', path: '/ventas', icon: <DollarSign size={20} />, roles: ['admin', 'manager', 'supervisor'] },
                { name: t('items.discounts'), plainName: 'Descuentos', path: '/admin/auditoria-descuentos', icon: <ClipboardList size={20} />, roles: ['admin', 'supervisor', 'manager'] },
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
                { name: t('items.breaks_ai'), plainName: 'Descansos', path: '/descansos', icon: <Zap size={20} />, roles: ['manager', 'supervisor', 'admin'] },
                { name: t('items.feedback'), plainName: 'Feedback', path: '/feedback', icon: <MessageSquare size={20} />, roles: ['asistente', 'manager', 'supervisor', 'admin'] },
            ]
        },
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
                { name: t('items.tv_menus'), plainName: 'TV Menús', path: '/admin/tv-menus', icon: <Monitor size={20} />, roles: ['admin', 'supervisor'] },
                { name: t('items.users'), plainName: 'Usuarios', path: '/usuarios', icon: <Users size={20} />, roles: ['admin', 'supervisor'] },
                { name: t('items.templates'), plainName: 'Plantillas', path: '/admin/plantillas', icon: <FileEdit size={20} />, roles: ['admin'] },
            ]
        },
        {
            title: t('sections.inventory'), id: 'inventario',
            items: [
                { name: t('items.inventory_dashboard'), plainName: 'Inventario', path: '/inventory', icon: <LayoutDashboard size={20} />, roles: ['admin', 'manager', 'supervisor'] },
                { name: t('items.ingredients'), plainName: 'Insumos', path: '/inventory/items', icon: <Store size={20} />, roles: ['admin', 'manager', 'supervisor'] },
                { name: t('items.menu_catalog'), plainName: 'Catálogo', path: '/inventory/menu', icon: <ClipboardList size={20} />, roles: ['admin', 'manager', 'supervisor'] },
                { name: t('items.food_costs'), plainName: 'Costos', path: '/inventory/costs', icon: <TrendingUp size={20} />, roles: ['admin', 'manager'] },
                { name: t('items.prep'), plainName: 'Preparador', path: '/inventory/preparador', icon: <ChefHat size={20} />, roles: ['admin', 'manager', 'supervisor', 'asistente'] },
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
                { name: t('items.roles'), plainName: 'Roles', path: '/roles', icon: <Users size={20} />, roles: ['manager', 'supervisor', 'admin', 'asistente'] },
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

            </Link>
        )
    }

    // Shared nav content
    const renderNavContent = (isMobile: boolean = false) => (
        <nav className={`flex-1 px-3 py-3 space-y-1 overflow-y-auto overflow-x-hidden no-scrollbar`}>
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

    const renderUserDropdownMenu = () => (
        <AnimatePresence>
            {userDropdownOpen && (
                <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 mt-2 w-64 max-h-[calc(100vh-4rem)] overflow-y-auto origin-top-right rounded-2xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950 p-1.5 shadow-2xl ring-1 ring-black/5 z-[100]"
                >
                    {/* ── Profile Header ── */}
                    <div className="px-3 py-2.5 mb-1">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-red-500 to-orange-500 flex items-center justify-center text-white text-sm font-bold shadow-md ring-2 ring-white dark:ring-slate-950">
                                {user?.name?.[0] || <User size={16} />}
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{user?.name || 'Usuario'}</p>
                                <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">{user?.email || ''}</p>
                            </div>
                        </div>
                        <div className="mt-2 flex items-center gap-1.5">
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-900/30">
                                <Shield size={10} />
                                {user?.role || 'Staff'}
                            </span>
                        </div>
                    </div>

                    <div className="h-px bg-slate-100 dark:bg-slate-800 mx-1" />

                    {/* ── Quick Links ── */}
                    <div className="py-1">
                        <Link
                            href="/configuracion"
                            onClick={() => setUserDropdownOpen(false)}
                            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors"
                        >
                            <Settings size={15} className="text-slate-500" />
                            {language === 'es' ? 'Configuración' : 'Settings'}
                        </Link>
                        <Link
                            href="/feedback"
                            onClick={() => setUserDropdownOpen(false)}
                            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors"
                        >
                            <MessageSquare size={15} className="text-emerald-500" />
                            Feedback
                        </Link>
                        <Link
                            href="/dashboard"
                            onClick={() => setUserDropdownOpen(false)}
                            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors"
                        >
                            <LayoutDashboard size={15} className="text-blue-500" />
                            Dashboard
                        </Link>
                    </div>

                    <div className="h-px bg-slate-100 dark:bg-slate-800 mx-1" />

                    {/* ── Appearance ── */}
                    <div className="py-1">
                        <div className="px-3 py-1.5">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">{language === 'es' ? 'Apariencia' : 'Appearance'}</p>
                        </div>
                        {/* Theme inline toggle */}
                        <div className="flex items-center justify-between px-3 py-1.5 rounded-lg">
                            <div className="flex items-center gap-2.5 text-sm text-slate-600 dark:text-slate-300">
                                <Moon size={15} className="text-indigo-500" />
                                <span>{language === 'es' ? 'Modo Oscuro' : 'Dark Mode'}</span>
                            </div>
                            <ThemeToggle />
                        </div>
                        {/* Language inline toggle */}
                        <div className="flex items-center justify-between px-3 py-1.5 rounded-lg">
                            <div className="flex items-center gap-2.5 text-sm text-slate-600 dark:text-slate-300">
                                <Globe size={15} className="text-green-500" />
                                <span>{language === 'es' ? 'Idioma' : 'Language'}</span>
                            </div>
                            <button
                                onClick={() => setLanguage(language === 'es' ? 'en' : 'es')}
                                className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors text-[10px] font-black flex items-center gap-1"
                            >
                                <span className={language === 'en' ? 'text-red-600' : 'text-slate-400'}>EN</span>
                                <span className="text-slate-300 dark:text-slate-600">/</span>
                                <span className={language === 'es' ? 'text-red-600' : 'text-slate-400'}>ES</span>
                            </button>
                        </div>
                    </div>

                    <div className="h-px bg-slate-100 dark:bg-slate-800 mx-1" />

                    {/* ── Utilities ── */}
                    <div className="py-1">
                        <button
                            onClick={() => { window.location.reload(); setUserDropdownOpen(false) }}
                            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors"
                        >
                            <RefreshCw size={15} className="text-blue-500" />
                            {t('nav.update')}
                        </button>
                        <button
                            onClick={() => setUserDropdownOpen(false)}
                            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors"
                        >
                            <div className="flex items-center gap-2.5">
                                <Keyboard size={15} className="text-slate-400" />
                                <span>{language === 'es' ? 'Atajos' : 'Shortcuts'}</span>
                            </div>
                            <kbd className="text-[9px] font-mono bg-slate-100 dark:bg-slate-800 text-slate-400 border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 rounded">Ctrl+K</kbd>
                        </button>
                        <a
                            href="https://tacosgavilan.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors"
                        >
                            <div className="flex items-center gap-2.5">
                                <HelpCircle size={15} className="text-amber-500" />
                                <span>{language === 'es' ? 'Ayuda' : 'Help'}</span>
                            </div>
                            <ExternalLink size={12} className="text-slate-300 dark:text-slate-600" />
                        </a>
                    </div>

                    <div className="h-px bg-slate-100 dark:bg-slate-800 mx-1" />

                    {/* ── App Info ── */}
                    <div className="px-3 py-1.5 flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-300 dark:text-slate-600">
                            <Sparkles size={10} />
                            <span>SM TEG v6.0</span>
                        </div>
                        <span className="text-[9px] text-slate-300 dark:text-slate-700">2026</span>
                    </div>

                    <div className="h-px bg-slate-100 dark:bg-slate-800 mx-1" />

                    {/* ── Logout ── */}
                    <div className="py-1">
                        <button
                            onClick={() => { handleLogout(); setUserDropdownOpen(false) }}
                            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors font-medium"
                        >
                            <LogOut size={15} />
                            {t('nav.logout')}
                        </button>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
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
                
                {/* Sidebar Collapse Button (Moved to top) */}
                <div className="flex-shrink-0 border-b border-slate-100 dark:border-slate-800/80 p-2">
                    <button
                        onClick={() => setIsCollapsed(!isCollapsed)}
                        className="w-full flex items-center justify-center gap-2 py-1.5 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-xs"
                    >
                        {isCollapsed ? <PanelLeft size={16} /> : <><PanelLeftClose size={16} /><span className="font-medium">{language === 'es' ? 'Colapsar' : 'Collapse'}</span></>}
                    </button>
                </div>

                {/* Navigation */}
                {renderNavContent(false)}

            </aside>

            {/* ============ DESKTOP TOP-RIGHT TOOLBAR ============ */}
            <div className={`hidden lg:flex fixed top-3 right-4 z-50 items-center gap-1.5 rounded-2xl px-2.5 py-1.5 bg-white/70 dark:bg-slate-900/70 backdrop-blur-lg border border-slate-200/50 dark:border-slate-800/50 shadow-sm transition-all`}>
                <button
                    onClick={() => setLanguage(language === 'es' ? 'en' : 'es')}
                    className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-[10px] font-black flex items-center gap-0.5"
                >
                    <span className={language === 'en' ? 'text-red-600' : 'text-slate-400'}>EN</span>
                    <span className="text-slate-300 dark:text-slate-700">/</span>
                    <span className={language === 'es' ? 'text-red-600' : 'text-slate-400'}>ES</span>
                </button>
                <ThemeToggle />
                <NotificationBell />

                {/* Separator */}
                <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-0.5" />

                {/* User Avatar + Dropdown */}
                <div ref={dropdownRef} className="relative">
                    <button
                        onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                        className="flex items-center gap-2 rounded-xl p-1 pr-2.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
                    >
                        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-tr from-red-500 to-orange-500 flex items-center justify-center text-white text-[10px] font-bold shadow-sm ring-2 ring-white dark:ring-slate-900">
                            {user?.name?.[0] || <User size={12} />}
                        </div>
                        <div className="hidden sm:block text-left">
                            <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 leading-tight">{user?.name?.split(' ')[0] || 'Usuario'}</p>
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 capitalize leading-tight">{user?.role || 'Staff'}</p>
                        </div>
                        <ChevronDown size={14} className={`text-slate-400 transition-transform duration-200 ${userDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {/* Dropdown Menu */}
                    {renderUserDropdownMenu()}
                </div>
            </div>

            {/* ============ MOBILE TOP BAR ============ */}
            <header className="lg:hidden fixed top-0 left-0 right-0 z-50 h-14 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-slate-200/60 dark:border-slate-800/60 flex items-center justify-between px-2">
                <div className="flex items-center gap-1">
                    <button onClick={() => setMobileDrawerOpen(true)} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                        <Menu size={20} />
                    </button>
                    <Link href="/dashboard" className="flex items-center gap-2 group">
                        <img src="/logo.png" alt="TEG" className="w-7 h-7 object-contain transition-transform group-hover:scale-110" />
                        <span className="text-sm font-black text-slate-900 dark:text-white">
                            SM<span className="text-red-600 font-semibold ml-0.5">TEG</span>
                        </span>
                    </Link>
                </div>

                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setLanguage(language === 'es' ? 'en' : 'es')}
                        className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-[10px] font-black hidden sm:flex items-center gap-0.5"
                    >
                        <span className={language === 'en' ? 'text-red-600' : 'text-slate-400'}>EN</span>
                        <span className="text-slate-300 dark:text-slate-700">/</span>
                        <span className={language === 'es' ? 'text-red-600' : 'text-slate-400'}>ES</span>
                    </button>
                    <div className="hidden sm:block"><ThemeToggle /></div>
                    <NotificationBell />
                    <button 
                        onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                        className="ml-1 flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-tr from-red-500 to-orange-500 flex items-center justify-center text-white text-[10px] font-bold ring-2 ring-white dark:ring-slate-900 shadow-sm"
                    >
                        {user?.name?.[0] || '?'}
                    </button>
                </div>
            </header>

            {/* ============ MOBILE USER DROPDOWN (fixed, outside header) ============ */}
            <AnimatePresence>
                {userDropdownOpen && (
                    <div className="lg:hidden fixed inset-0 z-[90]" ref={mobileDropdownRef}>
                        {/* Backdrop */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-black/20"
                            onClick={() => setUserDropdownOpen(false)}
                        />
                        {/* Dropdown panel */}
                        <motion.div
                            initial={{ opacity: 0, y: -10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -10, scale: 0.95 }}
                            transition={{ duration: 0.15 }}
                            className="absolute right-2 top-[3.75rem] w-72 max-h-[calc(100vh-5rem)] overflow-y-auto rounded-2xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950 p-1.5 shadow-2xl ring-1 ring-black/5"
                        >
                            {/* ── Profile Header ── */}
                            <div className="px-3 py-2.5 mb-1">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-red-500 to-orange-500 flex items-center justify-center text-white text-sm font-bold shadow-md ring-2 ring-white dark:ring-slate-950">
                                        {user?.name?.[0] || <User size={16} />}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{user?.name || 'Usuario'}</p>
                                        <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">{user?.email || ''}</p>
                                    </div>
                                </div>
                                <div className="mt-2 flex items-center gap-1.5">
                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-900/30">
                                        <Shield size={10} />
                                        {user?.role || 'Staff'}
                                    </span>
                                </div>
                            </div>

                            <div className="h-px bg-slate-100 dark:bg-slate-800 mx-1" />

                            {/* ── Quick Links ── */}
                            <div className="py-1">
                                <Link href="/configuracion" onClick={() => setUserDropdownOpen(false)} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors">
                                    <Settings size={15} className="text-slate-500" />
                                    {language === 'es' ? 'Configuración' : 'Settings'}
                                </Link>
                                <Link href="/feedback" onClick={() => setUserDropdownOpen(false)} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors">
                                    <MessageSquare size={15} className="text-emerald-500" />
                                    Feedback
                                </Link>
                                <Link href="/dashboard" onClick={() => setUserDropdownOpen(false)} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors">
                                    <LayoutDashboard size={15} className="text-blue-500" />
                                    Dashboard
                                </Link>
                            </div>

                            <div className="h-px bg-slate-100 dark:bg-slate-800 mx-1" />

                            {/* ── Appearance ── */}
                            <div className="py-1">
                                <div className="px-3 py-1.5">
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">{language === 'es' ? 'Apariencia' : 'Appearance'}</p>
                                </div>
                                <div className="flex items-center justify-between px-3 py-1.5 rounded-lg">
                                    <div className="flex items-center gap-2.5 text-sm text-slate-600 dark:text-slate-300">
                                        <Moon size={15} className="text-indigo-500" />
                                        <span>{language === 'es' ? 'Modo Oscuro' : 'Dark Mode'}</span>
                                    </div>
                                    <ThemeToggle />
                                </div>
                                <div className="flex items-center justify-between px-3 py-1.5 rounded-lg">
                                    <div className="flex items-center gap-2.5 text-sm text-slate-600 dark:text-slate-300">
                                        <Globe size={15} className="text-green-500" />
                                        <span>{language === 'es' ? 'Idioma' : 'Language'}</span>
                                    </div>
                                    <button onClick={() => setLanguage(language === 'es' ? 'en' : 'es')} className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors text-[10px] font-black flex items-center gap-1">
                                        <span className={language === 'en' ? 'text-red-600' : 'text-slate-400'}>EN</span>
                                        <span className="text-slate-300 dark:text-slate-600">/</span>
                                        <span className={language === 'es' ? 'text-red-600' : 'text-slate-400'}>ES</span>
                                    </button>
                                </div>
                            </div>

                            <div className="h-px bg-slate-100 dark:bg-slate-800 mx-1" />

                            {/* ── Utilities ── */}
                            <div className="py-1">
                                <button onClick={() => { window.location.reload(); setUserDropdownOpen(false) }} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors">
                                    <RefreshCw size={15} className="text-blue-500" />
                                    {t('nav.update')}
                                </button>
                                <a href="https://tacosgavilan.com" target="_blank" rel="noopener noreferrer" className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors">
                                    <div className="flex items-center gap-2.5">
                                        <HelpCircle size={15} className="text-amber-500" />
                                        <span>{language === 'es' ? 'Ayuda' : 'Help'}</span>
                                    </div>
                                    <ExternalLink size={12} className="text-slate-300 dark:text-slate-600" />
                                </a>
                            </div>

                            <div className="h-px bg-slate-100 dark:bg-slate-800 mx-1" />

                            {/* ── App Info ── */}
                            <div className="px-3 py-1.5 flex items-center justify-between">
                                <div className="flex items-center gap-1.5 text-[10px] text-slate-300 dark:text-slate-600">
                                    <Sparkles size={10} />
                                    <span>SM TEG v6.0</span>
                                </div>
                                <span className="text-[9px] text-slate-300 dark:text-slate-700">2026</span>
                            </div>

                            <div className="h-px bg-slate-100 dark:bg-slate-800 mx-1" />

                            {/* ── Logout ── */}
                            <div className="py-1">
                                <button onClick={() => { handleLogout(); setUserDropdownOpen(false) }} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors font-medium">
                                    <LogOut size={15} />
                                    {t('nav.logout')}
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

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
