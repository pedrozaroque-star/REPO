'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import NotificationBell from './NotificationBell'
import ThemeToggle from './ThemeToggle'
import React, { useState, useMemo, useEffect, useRef } from 'react'
import { useAuth } from './ProtectedRoute'
import { Menu, X, LogOut, ChevronDown, User, QrCode, ClipboardList, Briefcase, CheckSquare, Clock, LayoutDashboard, Store, Users, FileEdit, DollarSign, TrendingUp, Calendar, MessageSquare } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

// Definición de tipos para los ítems y grupos (Copiado de Sidebar.tsx)
type MenuItem = {
    name: string
    path: string
    icon: React.ReactNode
    roles: string[]
}

type MenuGroup = {
    title: string
    id: string
    items: MenuItem[]
}

export default function TopNav() {
    const pathname = usePathname()
    const router = useRouter()
    const { user } = useAuth()
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
    const [userDropdownOpen, setUserDropdownOpen] = useState(false)

    // Estructura de grupos (Copiado de Sidebar.tsx)
    const menuGroups: MenuGroup[] = [
        {
            title: 'OPERACIONES',
            id: 'operaciones',
            items: [
                { name: 'Supervisor', path: '/inspecciones', icon: <ClipboardList size={20} />, roles: ['supervisor', 'admin'] },
                { name: 'Manager', path: '/checklists-manager', icon: <Briefcase size={20} />, roles: ['manager', 'supervisor', 'admin'] },
                { name: 'Asistentes', path: '/checklists', icon: <CheckSquare size={20} />, roles: ['asistente', 'manager', 'supervisor', 'admin'] },
                { name: 'Horarios', path: '/horarios', icon: <Clock size={20} />, roles: ['manager', 'supervisor', 'admin'] },
                { name: 'Dashboard', path: '/dashboard', icon: <LayoutDashboard size={20} />, roles: ['manager', 'supervisor', 'admin'] },
            ]
        },
        {
            title: 'GESTIÓN',
            id: 'gestion',
            items: [
                { name: 'Tiendas', path: '/tiendas', icon: <Store size={20} />, roles: ['admin'] },
                { name: 'Usuarios', path: '/usuarios', icon: <Users size={20} />, roles: ['admin', 'supervisor'] },
                { name: 'Plantillas', path: '/admin/plantillas', icon: <FileEdit size={20} />, roles: ['admin'] },
            ]
        },
        {
            title: 'ANÁLISIS',
            id: 'analisis',
            items: [
                { name: 'Ventas', path: '/ventas', icon: <DollarSign size={20} />, roles: ['admin', 'manager', 'supervisor'] },
                {
                    name: 'Reportes',
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
                { name: 'Planificador', path: '/planificador', icon: <Calendar size={20} />, roles: ['manager', 'supervisor', 'admin'] },
                { name: 'Feedback Clientes', path: '/feedback', icon: <MessageSquare size={20} />, roles: ['asistente', 'manager', 'supervisor', 'admin'] },
            ]
        },
        {
            title: 'KIOSKS QR',
            id: 'kioskos',
            items: [
                { name: 'Feedback Clientes', path: '/clientes', icon: <QrCode size={20} />, roles: ['admin', 'manager'] },
                { name: 'Eval. Staff', path: '/evaluacion', icon: <QrCode size={20} />, roles: ['admin', 'manager'] },
            ]
        }
    ]

    const handleLogout = () => {
        localStorage.removeItem('teg_token')
        localStorage.removeItem('teg_user')
        router.push('/login')
    }

    // Filtrar items según el rol (Aplanamos la estructura para el TopNav o usamos Dropdowns)
    // Para TopNav, un enfoque híbrido es mejor: Items principales directos y un "Más" o Agrupados.
    // Vamos a intentar mostrar los más relevantes directos y usar Dropdowns para grupos grandes si no caben.
    // Pero para mantenerlo simple y limpio (SaaS style), vamos a renderizar enlaces directos a las secciones principales
    // y agrupar visualmente.

    const filteredGroups = useMemo(() => {
        return menuGroups.map(group => {
            const validItems = group.items.filter(item => {
                if (!item.roles || item.roles.length === 0) return true
                if (!user?.role) return false
                return item.roles.includes(user.role.toLowerCase())
            })
            return { ...group, items: validItems }
        }).filter(group => group.items.length > 0)
    }, [user])

    // Aplanamos la lista para el menú móvil
    const [openDropdownId, setOpenDropdownId] = useState<string | null>(null)
    const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null)

    // Aplanamos la lista para el menú móvil
    const allLinks = filteredGroups.flatMap(g => g.items)

    // Handle click outside to close dropdowns
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (openDropdownId && !(event.target as Element).closest('.group')) {
                setOpenDropdownId(null)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [openDropdownId])

    return (
        <nav className="sticky top-0 z-[60] w-full border-b border-gray-200/50 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl transition-all">
            <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between px-4 sm:px-6 lg:px-8">

                {/* Logo Section */}
                <div className="flex items-center gap-2 md:gap-8">
                    <Link href="/dashboard" className="flex items-center gap-4 group relative">
                        {/* Placeholder para mantener espacio en el flujo, pero el logo real flota y es gigante */}
                        <div className="h-10 w-10 md:h-12 md:w-12 relative flex-shrink-0">
                            <img
                                src="/logo.png"
                                alt="TEG Logo"
                                className="absolute -top-1 -left-1 w-12 h-12 md:w-24 md:h-24 max-w-none object-contain drop-shadow-xl z-50 transform transition-transform group-hover:scale-110"
                            />
                        </div>
                        <div className="flex flex-col leading-tight ml-10 md:ml-12">
                            <span className="text-xl md:text-2xl font-black tracking-tighter text-slate-900 dark:text-white group-hover:text-red-600 transition-colors">
                                SM<span className="text-base md:text-lg text-red-600 font-medium ml-0.5">TEG</span>
                            </span>
                            <span className="hidden md:block text-base font-medium text-red-600 dark:text-red-500 tracking-wide -mt-0.5 animate-pulse">
                                Sistema de Monitoreo
                            </span>
                        </div>
                    </Link>

                    {/* Desktop Navigation */}
                    <div className="hidden md:flex md:items-center md:gap-1">
                        {filteredGroups.map((group) => (
                            // Para no saturar, renderizamos solo los iconos/links principales o usamos un Dropdown por grupo
                            // En este diseño "SaaS Cloud", a veces es mejor tener un solo nivel si son pocos.
                            // Como son 4 grupos, probemos renderizar un Dropdown por grupo.
                            <div key={group.id} className="relative group"
                                onMouseEnter={() => {
                                    if (closeTimeoutRef.current) {
                                        clearTimeout(closeTimeoutRef.current)
                                        closeTimeoutRef.current = null
                                    }
                                    setOpenDropdownId(group.id)
                                }}
                                onMouseLeave={() => {
                                    closeTimeoutRef.current = setTimeout(() => {
                                        setOpenDropdownId(null)
                                    }, 500)
                                }}
                            >
                                <button
                                    onClick={(e) => {
                                        e.preventDefault()
                                        setOpenDropdownId(openDropdownId === group.id ? null : group.id)
                                    }}
                                    className={`flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${openDropdownId === group.id ? 'bg-gray-100 dark:bg-slate-800 text-gray-900 dark:text-white' : 'text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-900 dark:hover:text-white'
                                        }`}
                                >
                                    {group.title}
                                    <ChevronDown size={14} className={`text-gray-400 transition-transform ${openDropdownId === group.id ? 'rotate-180 text-gray-600 dark:text-white' : 'group-hover:text-gray-600 dark:group-hover:text-white group-hover:rotate-180'}`} />
                                </button>

                                {/* Dropdown Menu */}
                                <div className={`absolute left-0 top-full mt-1 w-56 origin-top-left rounded-xl border border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-2 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none animate-in fade-in slide-in-from-top-2 duration-200 z-[100] ${openDropdownId === group.id ? 'block' : 'hidden md:group-hover:block'
                                    }`}>
                                    <div className="mb-2 px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-400">
                                        {group.title}
                                    </div>
                                    {group.items.map((item) => {
                                        const isActive = pathname === item.path

                                        // Definir estilos de ESTADO ACTIVO por grupo para mayor énfasis
                                        let activeContainerClass = ''
                                        let iconColorClass = 'text-slate-500 dark:text-slate-400'

                                        if (group.id === 'operaciones') {
                                            iconColorClass = 'text-blue-600 dark:text-blue-400'
                                            activeContainerClass = 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                                        } else if (group.id === 'gestion') {
                                            iconColorClass = 'text-emerald-600 dark:text-emerald-400'
                                            activeContainerClass = 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
                                        } else if (group.id === 'analisis') {
                                            iconColorClass = 'text-orange-600 dark:text-orange-400'
                                            activeContainerClass = 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800'
                                        } else if (group.id === 'kioskos') {
                                            iconColorClass = 'text-pink-600 dark:text-pink-400'
                                            activeContainerClass = 'bg-pink-50 dark:bg-pink-900/20 border-pink-200 dark:border-pink-800'
                                        }

                                        return (
                                            <Link
                                                key={item.path}
                                                href={item.path}
                                                onClick={() => setOpenDropdownId(null)}
                                                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all border ${isActive
                                                    ? `${activeContainerClass} shadow-sm translate-x-1`
                                                    : 'border-transparent hover:bg-gray-50 dark:hover:bg-slate-800'
                                                    }`}
                                            >
                                                <div className={`${iconColorClass} transition-transform ${isActive ? 'scale-110' : ''}`}>
                                                    {React.cloneElement(item.icon as any, {
                                                        size: isActive ? 20 : 18,
                                                        strokeWidth: isActive ? 2.5 : 2,
                                                        fill: 'currentColor',
                                                        fillOpacity: isActive ? 0.2 : 0.15
                                                    })}
                                                </div>
                                                <span className={`font-medium ${isActive ? 'text-slate-900 dark:text-white font-bold' : 'text-slate-600 dark:text-slate-300'}`}>
                                                    {item.name}
                                                </span>
                                            </Link>
                                        )
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Botón Especial VENTAS (Solo Admin/Supervisor) */}


                </div>

                {/* Right Section: Notifications & Profile */}
                <div className="flex items-center gap-1 md:gap-3">
                    <ThemeToggle />
                    <NotificationBell />

                    <div className="relative">
                        <button
                            onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                            className="flex items-center gap-2 rounded-full border-none md:border border-gray-200 dark:border-slate-700 bg-transparent md:bg-white md:dark:bg-slate-900 p-1 md:pr-3 shadow-none md:shadow-sm hover:bg-gray-50 dark:hover:bg-slate-800 transition-all ml-1"
                        >
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-tr from-red-500 to-orange-500 text-white shadow-sm ring-2 ring-white dark:ring-slate-900">
                                <User size={16} />
                            </div>
                            <div className="hidden text-left text-xs sm:block">
                                <p className="font-medium text-gray-700 dark:text-slate-200">{user?.name?.split(' ')[0] || 'Usuario'}</p>
                                <p className="text-[10px] text-gray-500 dark:text-slate-400 capitalize">{user?.role || 'Staff'}</p>
                            </div>
                            <ChevronDown size={14} className={`hidden md:block text-gray-400 transition-transform ${userDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {/* User Dropdown */}
                        <AnimatePresence>
                            {userDropdownOpen && (
                                <motion.div
                                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                                    className="absolute right-0 mt-2 w-48 origin-top-right rounded-xl border border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-1 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none z-[100]"
                                >
                                    <button
                                        onClick={() => window.location.reload()}
                                        className="flex w-full items-center gap-2 rounded-lg px-4 py-2 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-colors border-b border-gray-100 dark:border-slate-800"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" /></svg>
                                        Actualizar App
                                    </button>
                                    <button
                                        onClick={handleLogout}
                                        className="flex w-full items-center gap-2 rounded-lg px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                                    >
                                        <LogOut size={16} />
                                        Cerrar Sesión
                                    </button>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    {/* Mobile Menu Button */}
                    <button
                        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                        className="md:hidden ml-1 p-2 text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                    >
                        {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
                    </button>
                </div>
            </div >

            {/* Mobile Menu Overlay */}
            <AnimatePresence>
                {
                    mobileMenuOpen && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="md:hidden overflow-hidden border-t border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl"
                        >
                            <div className="p-4 space-y-6">
                                {filteredGroups.map(group => {
                                    // Colores vibrantes para los iconos (Texto + Fill sutil)
                                    const getGroupColorClass = (id: string) => {
                                        switch (id) {
                                            case 'operaciones': return 'text-blue-600 dark:text-blue-400'
                                            case 'gestion': return 'text-emerald-600 dark:text-emerald-400'
                                            case 'analisis': return 'text-orange-600 dark:text-orange-400'
                                            case 'kioskos': return 'text-pink-600 dark:text-pink-400'
                                            default: return 'text-slate-600 dark:text-slate-400'
                                        }
                                    }
                                    const groupColorClass = getGroupColorClass(group.id)

                                    return (
                                        <div key={group.id} className="space-y-3">
                                            <div className="flex items-center gap-2 pb-1 border-b border-gray-100 dark:border-slate-800">
                                                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
                                                    {group.title}
                                                </span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                {group.items.map(item => {
                                                    const isActive = pathname === item.path
                                                    return (
                                                        <Link
                                                            key={item.path}
                                                            href={item.path}
                                                            onClick={() => setMobileMenuOpen(false)}
                                                            className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${isActive
                                                                ? 'bg-gradient-to-r from-gray-50 to-white dark:from-slate-800 dark:to-slate-900 border-gray-200 dark:border-slate-700 shadow-md transform scale-[1.02]'
                                                                : 'bg-white dark:bg-slate-900 border-transparent shadow-sm hover:shadow-md hover:bg-gray-50 dark:hover:bg-slate-800'
                                                                }`}
                                                        >
                                                            {/* Icono Grande, Coloreado y con "Relleno Duotone" */}
                                                            <div className={`transition-transform duration-300 ${isActive ? 'scale-110' : ''} ${groupColorClass}`}>
                                                                {React.cloneElement(item.icon as any, {
                                                                    size: 26,
                                                                    strokeWidth: 2,
                                                                    fill: 'currentColor',
                                                                    fillOpacity: 0.15
                                                                })}
                                                            </div>

                                                            <span className={`text-xs font-bold leading-tight ${isActive ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-400'}`}>
                                                                {item.name}
                                                            </span>
                                                        </Link>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    )
                                })}
                                <div className="pt-4 border-t border-gray-100 dark:border-slate-800">
                                    <button
                                        onClick={handleLogout}
                                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-100 dark:bg-slate-800 py-3 text-sm font-bold text-slate-600 dark:text-slate-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 transition-colors"
                                    >
                                        <LogOut size={18} />
                                        Cerrar Sesión
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    )
                }
            </AnimatePresence >
        </nav >
    )
}
