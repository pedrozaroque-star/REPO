'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import NotificationBell from './NotificationBell'
import ThemeToggle from './ThemeToggle'
import { useState, useMemo, useEffect, useRef } from 'react'
import { useAuth } from './ProtectedRoute'
import { Menu, X, LogOut, ChevronDown, User, QrCode } from 'lucide-react'
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
                { name: 'Supervisor', path: '/inspecciones', icon: '📋', roles: ['supervisor', 'admin'] },
                { name: 'Manager', path: '/checklists-manager', icon: '👔', roles: ['manager', 'supervisor', 'admin'] },
                { name: 'Asistentes', path: '/checklists', icon: '✅', roles: ['asistente', 'manager', 'supervisor', 'admin'] },
                { name: 'Horarios', path: '/horarios', icon: '📅', roles: ['manager', 'supervisor', 'admin'] },
                { name: 'Dashboard', path: '/dashboard', icon: '📊', roles: ['manager', 'supervisor', 'admin'] },
            ]
        },
        {
            title: 'GESTIÓN',
            id: 'gestion',
            items: [
                { name: 'Tiendas', path: '/tiendas', icon: '🏪', roles: ['admin'] },
                { name: 'Usuarios', path: '/usuarios', icon: '👥', roles: ['admin', 'supervisor'] },
                { name: 'Plantillas', path: '/admin/plantillas', icon: '📝', roles: ['admin'] },
            ]
        },
        {
            title: 'ANÁLISIS',
            id: 'analisis',
            items: [
                { name: 'Ventas', path: '/ventas', icon: '💰', roles: ['admin', 'manager', 'supervisor'] },
                {
                    name: 'Reportes',
                    path: '/ventas/reportes',
                    icon: (
                        <div className="relative inline-block">
                            📈
                            <span className="absolute -top-1 -right-2 flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                            </span>
                        </div>
                    ),
                    roles: ['manager', 'supervisor', 'admin']
                },
                { name: 'Planificador', path: '/planificador', icon: '📅', roles: ['manager', 'supervisor', 'admin'] },
                { name: 'Feedback Clientes', path: '/feedback', icon: '💬', roles: ['asistente', 'manager', 'supervisor', 'admin'] },
            ]
        },
        {
            title: 'KIOSKS QR',
            id: 'kioskos',
            items: [
                { name: 'Feedback Clientes', path: '/clientes', icon: <QrCode size={16} />, roles: ['admin', 'manager'] },
                { name: 'Eval. Staff', path: '/evaluacion', icon: <QrCode size={16} />, roles: ['admin', 'manager'] },
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
                <div className="flex items-center gap-8">
                    <Link href="/dashboard" className="flex items-center gap-4 group relative">
                        {/* Placeholder para mantener espacio en el flujo, pero el logo real flota y es gigante */}
                        <div className="h-10 w-10 md:h-12 md:w-12 relative flex-shrink-0">
                            <img
                                src="/logo.png"
                                alt="TEG Logo"
                                className="absolute -top-1 -left-1 w-14 h-14 md:w-24 md:h-24 max-w-none object-contain drop-shadow-xl z-50 transform transition-transform group-hover:scale-110"
                            />
                        </div>
                        <div className="flex flex-col leading-tight ml-4 md:ml-12">
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
                                        return (
                                            <Link
                                                key={item.path}
                                                href={item.path}
                                                onClick={() => setOpenDropdownId(null)}
                                                className={`flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors ${isActive
                                                    ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                                                    : 'text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800 hover:text-gray-900 dark:hover:text-white'
                                                    }`}
                                            >
                                                <span className="text-lg">{item.icon}</span>
                                                {item.name}
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
                <div className="flex items-center gap-3">
                    <ThemeToggle />
                    <NotificationBell />

                    <div className="relative">
                        <button
                            onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                            className="flex items-center gap-2 rounded-full border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1 pr-3 shadow-sm hover:shadow-md transition-all ml-2"
                        >
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-tr from-red-500 to-orange-500 text-white">
                                <User size={16} />
                            </div>
                            <div className="hidden text-left text-xs sm:block">
                                <p className="font-medium text-gray-700 dark:text-slate-200">{user?.name?.split(' ')[0] || 'Usuario'}</p>
                                <p className="text-[10px] text-gray-500 dark:text-slate-400 capitalize">{user?.role || 'Staff'}</p>
                            </div>
                            <ChevronDown size={14} className={`text-gray-400 transition-transform ${userDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {/* User Dropdown */}
                        <AnimatePresence>
                            {userDropdownOpen && (
                                <motion.div
                                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                                    className="absolute right-0 mt-2 w-48 origin-top-right rounded-xl border border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-1 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none"
                                >
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
                        className="md:hidden ml-2 rounded-md p-2 text-gray-500 hover:bg-gray-100"
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
                            className="md:hidden border-t border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900"
                        >
                            <div className="space-y-1 p-4">
                                {filteredGroups.map(group => (
                                    <div key={group.id} className="py-2">
                                        <div className="px-2 py-1 text-xs font-semibold uppercase text-gray-400">
                                            {group.title}
                                        </div>
                                        {group.items.map(item => (
                                            <Link
                                                key={item.path}
                                                href={item.path}
                                                onClick={() => setMobileMenuOpen(false)}
                                                className={`flex items-center gap-3 rounded-lg px-2 py-2 text-sm ${pathname === item.path
                                                    ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 font-medium'
                                                    : 'text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 hover:text-gray-900 dark:hover:text-white'
                                                    }`}
                                            >
                                                <span className="text-lg">{item.icon}</span>
                                                {item.name}
                                            </Link>
                                        ))}
                                    </div>
                                ))}
                                <div className="border-t border-gray-100 pt-2 mt-2">
                                    <button
                                        onClick={handleLogout}
                                        className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm text-red-600 hover:bg-red-50"
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
