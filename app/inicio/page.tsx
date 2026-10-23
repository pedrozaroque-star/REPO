/**
 * @module app/inicio/page
 * @description Pantalla de Inicio (Main Modules Launchpad) de Tacos Gavilan.
 * Muestra todos los módulos del sistema organizados por departamento con sus mismos iconos,
 * etiquetas animadas (`new`, `Building`, `BETA`) y una breve descripción de cada uno.
 * Presenta el acceso al Dashboard Ejecutivo original (`/dashboard`) como el primer enlace
 * disponible y más llamativo de toda la pantalla, además de soporte para fijar módulos
 * favoritos ("Mis Accesos Rápidos") y búsqueda instantánea con atajo de teclado (`/`).
 *
 * @businessRules
 * - Al iniciar sesión, el usuario aterriza en `/inicio` en lugar de entrar directamente a `/dashboard`.
 * - En `/inicio`, la barra lateral (`AppSidebar`) se mantiene colapsada por defecto para maximizar el espacio visual.
 * - Al presionar cualquier módulo, la barra lateral se despliega automáticamente como se maneja en el resto del sistema.
 * - Filtra dinámicamente los módulos según el rol del usuario autenticado (`admin`, `supervisor`, `manager`, `asistente`, `planificador`).
 *
 * @dataFlow
 * - Consume `useAuth()` de `components/ProtectedRoute` para el contexto y permisos del usuario.
 * - Consume `useLanguage()` de `lib/i18n` para soporte bilingüe completo (ES/EN).
 * - Coordina con `components/ClientLayout` mediante cambio de ruta y evento `teg:expand-sidebar` para expandir la barra lateral al abrir un módulo.
 * - Persiste los módulos favoritos del usuario en `localStorage` (`teg_favorite_modules`).
 *
 * @notes
 * - Mantiene paridad 1:1 de iconos, rutas, permisos e insignias con `components/AppSidebar.tsx`.
 */

'use client'

import React, { useState, useMemo, useEffect, useRef } from 'react'
import Link from 'next/link'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import { useLanguage } from '@/lib/i18n'
import {
    QrCode, ClipboardList, Briefcase, CheckSquare, Clock, LayoutDashboard,
    Store, Users, FileEdit, DollarSign, TrendingUp, Calendar, MessageSquare,
    CalendarCheck, UserCog, Monitor, ChefHat, Zap, ExternalLink, Globe, Shield,
    Sparkles, Truck, Timer, Shirt, Car, Calculator, Package, BarChart3,
    UserCheck, Bell, Receipt, Wrench, Smartphone, ShieldCheck, Search,
    ArrowRight, ChevronRight, Star, LayoutGrid
} from 'lucide-react'

const BasecampIcon = ({ size = 20 }: { size?: number }) => (
    <svg
        viewBox="0 0 512 512"
        width={size}
        height={size}
        fill="currentColor"
        style={{ flexShrink: 0 }}
    >
        <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M111.962 57.729C155.189 19.34 206.449 0 265.307 0c77.361 0 133.713 49.448 171.582 113.692 37.866 64.24 57.6 143.773 61.686 205.326a26.662 26.662 0 01-3.283 14.894l-.012.028-.016.025c-36.169 62.105-118.272 96.008-229.939 96.011-80.188 1.053-156.884-32.74-210.199-92.613a25.471 25.471 0 01-4.943-25.924c7.15-19.237 20.547-51.324 38.335-78.688 8.892-13.679 18.959-26.299 29.988-35.543 11.026-9.24 23.224-15.276 36.306-15.348h.016c13.181 0 24.573 5.25 34.449 12.345 9.657 6.937 18.057 15.784 25.377 23.491l.444.471.025.024a169.12 169.12 0 0013.322 13.212 392.206 392.206 0 0049.68-83.351l.039-.092.05-.091c6.327-12.016 20.971-16.961 33.293-11.242 12.324 5.718 17.991 20.089 12.892 32.673l-.026.07-.032.066c-26.677 57.123-47.287 86.004-62.615 100.621-7.688 7.334-14.109 11.141-19.363 13.083-5.294 1.959-9.228 1.959-11.664 1.959-11.174 0-20.703-4.308-29.181-10.435-8.312-6.007-15.793-13.897-22.916-21.409l-.301-.317c-3.271-3.468-8.227-8.715-12.998-13.091-2.39-2.194-4.666-4.105-6.614-5.45-.973-.673-1.807-1.166-2.486-1.478a5.54 5.54 0 00-.806-.31c-.048-.013-.091-.022-.128-.03-.8.211-1.931.762-3.402 1.858-1.635 1.218-3.501 2.964-5.563 5.229-4.12 4.526-8.817 10.903-13.77 18.655-9.628 15.064-20.054 35.063-28.896 56.107a223.491 223.491 0 00161.61 64.325h.059c88.439 0 153.567-23.975 181.811-64.431-5.026-55.783-22.994-121.651-53.471-173.599-30.694-52.325-73.656-89.898-128.34-89.898-93.402 0-164.264 65.12-210.272 194.986l-.029.08-.034.079c-5.254 12.403-19.257 18.576-31.962 14.093-12.706-4.487-19.726-18.08-16.023-31.026l.024-.086.029-.084c26.723-75.584 61.75-132.8 104.922-171.138z"
        />
    </svg>
)

const HazardTapeIcon = ({ size = 14 }: { size?: number }) => (
    <svg
        width={size}
        height={Math.round(size * 0.65)}
        viewBox="0 0 20 13"
        fill="none"
        className="shrink-0 rounded-[1.5px] overflow-hidden"
        aria-hidden="true"
    >
        <rect width="20" height="13" fill="#facc15" />
        <path
            d="M-2 4 L2 0 H6 L2 4 H-2 Z M6 4 L10 0 H14 L10 4 H6 Z M14 4 L18 0 H22 L18 4 H14 Z"
            fill="#000000"
        />
        <path
            d="M-2 13 L2 9 H6 L2 13 H-2 Z M6 13 L10 9 H14 L10 13 H6 Z M14 13 L18 9 H22 L18 13 H14 Z"
            fill="#000000"
        />
        <rect width="20" height="13" fill="none" stroke="#000000" strokeWidth="1" />
    </svg>
)

type HubModuleItem = {
    id: string
    title: string
    description: string
    path: string
    icon: React.ReactNode
    iconColorClass: string
    roles: string[]
    openInNewTab?: boolean
    badgeType?: 'new' | 'building' | 'beta'
    badgeLabel?: string
    isPrimaryDashboard?: boolean
}

type HubModuleGroup = {
    id: string
    title: string
    subtitle: string
    groupIcon: React.ReactNode
    items: HubModuleItem[]
}

const SECTION_THEMES: Record<string, {
    headerIconBg: string
    headerIconColor: string
    borderHover: string
    badgeBg: string
    pillActive: string
    sectionBorder: string
}> = {
    analisis: {
        headerIconBg: 'bg-rose-500/10 dark:bg-rose-500/20 border-rose-500/20',
        headerIconColor: 'text-rose-600 dark:text-rose-400',
        borderHover: 'hover:border-rose-400/80 dark:hover:border-rose-500/70 hover:shadow-rose-500/5',
        badgeBg: 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200/80 dark:border-rose-800/70',
        pillActive: 'bg-rose-600 text-white border-rose-600 shadow-xs',
        sectionBorder: 'border-t-2 border-t-rose-500/80',
    },
    finanzas: {
        headerIconBg: 'bg-emerald-500/10 dark:bg-emerald-500/20 border-emerald-500/20',
        headerIconColor: 'text-emerald-600 dark:text-emerald-400',
        borderHover: 'hover:border-emerald-400/80 dark:hover:border-emerald-500/70 hover:shadow-emerald-500/5',
        badgeBg: 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-800/70',
        pillActive: 'bg-emerald-600 text-white border-emerald-600 shadow-xs',
        sectionBorder: 'border-t-2 border-t-emerald-500/80',
    },
    operaciones: {
        headerIconBg: 'bg-blue-500/10 dark:bg-blue-500/20 border-blue-500/20',
        headerIconColor: 'text-blue-600 dark:text-blue-400',
        borderHover: 'hover:border-blue-400/80 dark:hover:border-blue-500/70 hover:shadow-blue-500/5',
        badgeBg: 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200/80 dark:border-blue-800/70',
        pillActive: 'bg-blue-600 text-white border-blue-600 shadow-xs',
        sectionBorder: 'border-t-2 border-t-blue-500/80',
    },
    inventario: {
        headerIconBg: 'bg-purple-500/10 dark:bg-purple-500/20 border-purple-500/20',
        headerIconColor: 'text-purple-600 dark:text-purple-400',
        borderHover: 'hover:border-purple-400/80 dark:hover:border-purple-500/70 hover:shadow-purple-500/5',
        badgeBg: 'bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border-purple-200/80 dark:border-purple-800/70',
        pillActive: 'bg-purple-600 text-white border-purple-600 shadow-xs',
        sectionBorder: 'border-t-2 border-t-purple-500/80',
    },
    equipo: {
        headerIconBg: 'bg-cyan-500/10 dark:bg-cyan-500/20 border-cyan-500/20',
        headerIconColor: 'text-cyan-600 dark:text-cyan-400',
        borderHover: 'hover:border-cyan-400/80 dark:hover:border-cyan-500/70 hover:shadow-cyan-500/5',
        badgeBg: 'bg-cyan-50 dark:bg-cyan-950/60 text-cyan-700 dark:text-cyan-300 border-cyan-200/80 dark:border-cyan-800/70',
        pillActive: 'bg-cyan-600 text-white border-cyan-600 shadow-xs',
        sectionBorder: 'border-t-2 border-t-cyan-500/80',
    },
    gestion: {
        headerIconBg: 'bg-amber-500/10 dark:bg-amber-500/20 border-amber-500/20',
        headerIconColor: 'text-amber-600 dark:text-amber-400',
        borderHover: 'hover:border-amber-400/80 dark:hover:border-amber-500/70 hover:shadow-amber-500/5',
        badgeBg: 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200/80 dark:border-amber-800/70',
        pillActive: 'bg-amber-600 text-white border-amber-600 shadow-xs',
        sectionBorder: 'border-t-2 border-t-amber-500/80',
    },
}

const FAVORITES_STORAGE_KEY = 'teg_favorite_modules_v1'

function InicioHubContent() {
    const { user } = useAuth()
    const { t } = useLanguage()
    const [searchQuery, setSearchQuery] = useState('')
    const [activeCategory, setActiveCategory] = useState<string>('all')
    const [favoriteIds, setFavoriteIds] = useState<string[]>([])
    const searchInputRef = useRef<HTMLInputElement>(null)

    // Load user's pinned favorite modules from localStorage
    useEffect(() => {
        try {
            const raw = localStorage.getItem(FAVORITES_STORAGE_KEY)
            if (raw) {
                const parsed = JSON.parse(raw)
                if (Array.isArray(parsed)) setFavoriteIds(parsed)
            }
        } catch {
            // ignore storage errors
        }
    }, [])

    // Press "/" anywhere to focus the search input, Escape to clear
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement)?.tagName
            const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable
            if (e.key === '/' && !isTyping) {
                e.preventDefault()
                searchInputRef.current?.focus()
            } else if (e.key === 'Escape' && document.activeElement === searchInputRef.current) {
                setSearchQuery('')
                searchInputRef.current?.blur()
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [])

    const toggleFavorite = (e: React.MouseEvent, moduleId: string) => {
        e.preventDefault()
        e.stopPropagation()
        setFavoriteIds(prev => {
            const next = prev.includes(moduleId)
                ? prev.filter(id => id !== moduleId)
                : [...prev, moduleId]
            try {
                localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(next))
            } catch {
                // ignore
            }
            return next
        })
    }

    const handleModuleClick = () => {
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('teg:expand-sidebar'))
        }
    }

    // Time-aware friendly greeting
    const timeGreeting = useMemo(() => {
        const hour = new Date().getHours()
        if (hour >= 5 && hour < 12) return t('home_hub.good_morning')
        if (hour >= 12 && hour < 19) return t('home_hub.good_afternoon')
        return t('home_hub.good_evening')
    }, [t])

    // All modules organized in the exact same 6 operational groups and badge rules as AppSidebar.tsx,
    // with distinct, vibrant icon colors so every module is visually recognizable at a glance.
    const moduleGroups: HubModuleGroup[] = useMemo(() => [
        {
            id: 'analisis',
            title: t('sections.analysis'),
            subtitle: t('home_hub.section_sub.analisis'),
            groupIcon: <TrendingUp size={18} />,
            items: [
                {
                    id: 'dashboard',
                    title: t('items.dashboard'),
                    description: t('home_hub.desc.dashboard'),
                    path: '/dashboard',
                    icon: <LayoutDashboard size={20} />,
                    iconColorClass: 'bg-red-600 text-[#fdc82f] border-red-500',
                    roles: ['manager', 'supervisor', 'admin', 'auditor'],
                    isPrimaryDashboard: true,
                },
                {
                    id: 'sales',
                    title: t('items.sales'),
                    description: t('home_hub.desc.sales'),
                    path: '/ventas',
                    icon: <DollarSign size={20} />,
                    iconColorClass: 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 border-emerald-500/20',
                    roles: ['admin', 'manager', 'supervisor'],
                },
                {
                    id: 'reports',
                    title: t('items.reports'),
                    description: t('home_hub.desc.reports'),
                    path: '/ventas/reportes',
                    icon: (
                        <div className="relative inline-block">
                            <TrendingUp size={20} />
                            <span className="absolute -top-1 -right-1.5 flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                            </span>
                        </div>
                    ),
                    iconColorClass: 'bg-orange-500/10 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400 border-orange-500/20',
                    roles: ['manager', 'supervisor', 'admin'],
                },
                {
                    id: 'discounts',
                    title: t('items.discounts'),
                    description: t('home_hub.desc.discounts'),
                    path: '/admin/auditoria-descuentos',
                    icon: <ClipboardList size={20} />,
                    iconColorClass: 'bg-rose-500/10 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400 border-rose-500/20',
                    roles: ['admin', 'supervisor', 'manager'],
                },
                {
                    id: 'drive_thru_leaderboard',
                    title: t('items.drive_thru_leaderboard'),
                    description: t('home_hub.desc.drive_thru'),
                    path: '/drive-thru',
                    icon: <Timer size={20} />,
                    iconColorClass: 'bg-violet-500/10 text-violet-600 dark:bg-violet-500/20 dark:text-violet-400 border-violet-500/20',
                    roles: ['manager', 'supervisor', 'admin'],
                },
                {
                    id: 'feedback',
                    title: t('items.feedback'),
                    description: t('home_hub.desc.feedback'),
                    path: '/feedback',
                    icon: <MessageSquare size={20} />,
                    iconColorClass: 'bg-sky-500/10 text-sky-600 dark:bg-sky-500/20 dark:text-sky-400 border-sky-500/20',
                    roles: ['asistente', 'manager', 'supervisor', 'admin'],
                },
                {
                    id: 'eval_staff',
                    title: t('items.eval_staff'),
                    description: t('home_hub.desc.eval_staff'),
                    path: '/evaluacion',
                    icon: <UserCheck size={20} />,
                    iconColorClass: 'bg-teal-500/10 text-teal-600 dark:bg-teal-500/20 dark:text-teal-400 border-teal-500/20',
                    roles: ['admin', 'manager', 'supervisor'],
                },
            ],
        },
        {
            id: 'operaciones',
            title: t('sections.operations'),
            subtitle: t('home_hub.section_sub.operaciones'),
            groupIcon: <Briefcase size={18} />,
            items: [
                {
                    id: 'basecamp',
                    title: t('items.basecamp'),
                    description: t('home_hub.desc.basecamp'),
                    path: '/basecamp',
                    icon: <BasecampIcon size={20} />,
                    iconColorClass: 'bg-sky-500/15 text-[#1d7db5] dark:bg-sky-500/20 dark:text-sky-400 border-sky-500/30',
                    roles: ['manager', 'supervisor', 'admin', 'asistente'],
                    badgeType: 'new',
                    badgeLabel: 'new',
                },
                {
                    id: 'manager',
                    title: t('items.manager'),
                    description: t('home_hub.desc.manager'),
                    path: '/checklists-manager',
                    icon: <Briefcase size={20} />,
                    iconColorClass: 'bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 border-blue-500/20',
                    roles: ['manager', 'supervisor', 'admin'],
                },
                {
                    id: 'assistants',
                    title: t('items.assistants'),
                    description: t('home_hub.desc.assistants'),
                    path: '/checklists',
                    icon: <CheckSquare size={20} />,
                    iconColorClass: 'bg-cyan-500/10 text-cyan-600 dark:bg-cyan-500/20 dark:text-cyan-400 border-cyan-500/20',
                    roles: ['asistente', 'manager', 'supervisor', 'admin'],
                },
                {
                    id: 'supervisor',
                    title: t('items.supervisor'),
                    description: t('home_hub.desc.supervisor'),
                    path: '/inspecciones',
                    icon: <ClipboardList size={20} />,
                    iconColorClass: 'bg-violet-500/10 text-violet-600 dark:bg-violet-500/20 dark:text-violet-400 border-violet-500/20',
                    roles: ['supervisor', 'admin'],
                },
                {
                    id: 'prep',
                    title: t('items.prep'),
                    description: t('home_hub.desc.prep'),
                    path: '/inventory/preparador',
                    icon: <ChefHat size={20} />,
                    iconColorClass: 'bg-orange-500/10 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400 border-orange-500/20',
                    roles: ['admin', 'manager', 'supervisor', 'asistente'],
                },
                {
                    id: 'blindaje_delivery',
                    title: t('items.blindaje_delivery'),
                    description: t('home_hub.desc.blindaje_delivery'),
                    path: '/admin/blindaje-delivery',
                    icon: <ShieldCheck size={20} />,
                    iconColorClass: 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 border-emerald-500/20',
                    roles: ['admin', 'manager', 'supervisor', 'asistente'],
                    badgeType: 'new',
                    badgeLabel: 'new',
                },
                {
                    id: 'order_ready_board',
                    title: t('items.order_ready_board'),
                    description: t('home_hub.desc.order_ready_board'),
                    path: '/order-ready-board',
                    icon: <Bell size={20} />,
                    iconColorClass: 'bg-red-500/10 text-red-600 dark:bg-red-500/20 dark:text-red-400 border-red-500/20',
                    roles: ['asistente', 'manager', 'supervisor', 'admin'],
                    badgeType: 'new',
                    badgeLabel: 'new',
                },
                {
                    id: 'safe',
                    title: t('items.safe'),
                    description: t('home_hub.desc.safe'),
                    path: '/caja-fuerte',
                    icon: <Shield size={20} />,
                    iconColorClass: 'bg-slate-600/10 text-slate-700 dark:bg-slate-400/15 dark:text-slate-300 border-slate-500/20',
                    roles: ['admin', 'supervisor', 'manager', 'asistente'],
                },
                {
                    id: 'actividades',
                    title: t('items.actividades'),
                    description: t('home_hub.desc.actividades'),
                    path: '/actividades',
                    icon: <ClipboardList size={20} />,
                    iconColorClass: 'bg-teal-500/10 text-teal-600 dark:bg-teal-500/20 dark:text-teal-400 border-teal-500/20',
                    roles: ['manager', 'supervisor', 'admin', 'asistente'],
                },
                {
                    id: 'maintenance',
                    title: t('items.maintenance'),
                    description: t('home_hub.desc.maintenance'),
                    path: '/admin/mantenimiento',
                    icon: <Wrench size={20} />,
                    iconColorClass: 'bg-yellow-500/15 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400 border-yellow-500/30',
                    roles: ['asistente', 'manager', 'supervisor', 'admin'],
                    badgeType: 'building',
                },
            ],
        },
        {
            id: 'inventario',
            title: t('sections.inventory'),
            subtitle: t('home_hub.section_sub.inventario'),
            groupIcon: <Package size={18} />,
            items: [
                {
                    id: 'bodega_orders',
                    title: t('items.bodega_orders'),
                    description: t('home_hub.desc.bodega_orders'),
                    path: '/inventory/orders',
                    icon: <Truck size={20} />,
                    iconColorClass: 'bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 border-blue-500/20',
                    roles: ['admin', 'manager', 'supervisor'],
                },
                {
                    id: 'viele_sons',
                    title: t('items.viele_sons'),
                    description: t('home_hub.desc.viele_sons'),
                    path: '/admin/compras/viele',
                    icon: <Package size={20} />,
                    iconColorClass: 'bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 border-amber-500/20',
                    roles: ['admin', 'manager', 'supervisor'],
                    badgeType: 'new',
                    badgeLabel: 'new',
                },
                {
                    id: 'uniforms_control',
                    title: t('items.uniforms_control'),
                    description: t('home_hub.desc.uniforms_control'),
                    path: '/inventory/uniforms',
                    icon: <Shirt size={20} />,
                    iconColorClass: 'bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400 border-indigo-500/20',
                    roles: ['admin', 'manager', 'supervisor', 'asistente'],
                },
                {
                    id: 'food_cost_margins',
                    title: t('items.food_cost_margins'),
                    description: t('home_hub.desc.food_cost_margins'),
                    path: '/admin/food-cost',
                    icon: <TrendingUp size={20} />,
                    iconColorClass: 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 border-emerald-500/20',
                    roles: ['admin', 'manager', 'supervisor'],
                },
                {
                    id: 'supplier_prices',
                    title: t('items.supplier_prices'),
                    description: t('home_hub.desc.supplier_prices'),
                    path: '/admin/precios-proveedores',
                    icon: <Calculator size={20} />,
                    iconColorClass: 'bg-rose-500/10 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400 border-rose-500/20',
                    roles: ['admin'],
                },
                {
                    id: 'ingredients',
                    title: t('items.ingredients'),
                    description: t('home_hub.desc.ingredients'),
                    path: '/inventory/items',
                    icon: <Store size={20} />,
                    iconColorClass: 'bg-purple-500/10 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400 border-purple-500/20',
                    roles: ['admin', 'manager', 'supervisor'],
                },
                {
                    id: 'menu_catalog',
                    title: t('items.menu_catalog'),
                    description: t('home_hub.desc.menu_catalog'),
                    path: '/inventory/menu',
                    icon: <ClipboardList size={20} />,
                    iconColorClass: 'bg-orange-500/10 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400 border-orange-500/20',
                    roles: ['admin', 'manager', 'supervisor'],
                },
                {
                    id: 'food_costs',
                    title: t('items.food_costs'),
                    description: t('home_hub.desc.food_costs'),
                    path: '/inventory/costs',
                    icon: <TrendingUp size={20} />,
                    iconColorClass: 'bg-teal-500/10 text-teal-600 dark:bg-teal-500/20 dark:text-teal-400 border-teal-500/20',
                    roles: ['admin', 'manager'],
                },
            ],
        },
        {
            id: 'equipo',
            title: t('sections.team'),
            subtitle: t('home_hub.section_sub.equipo'),
            groupIcon: <Clock size={18} />,
            items: [
                {
                    id: 'schedules',
                    title: t('items.schedules'),
                    description: t('home_hub.desc.schedules'),
                    path: '/horarios',
                    icon: <Clock size={20} />,
                    iconColorClass: 'bg-cyan-500/10 text-cyan-600 dark:bg-cyan-500/20 dark:text-cyan-400 border-cyan-500/20',
                    roles: ['manager', 'supervisor', 'admin'],
                },
                {
                    id: 'planner',
                    title: t('items.planner'),
                    description: t('home_hub.desc.planner'),
                    path: '/planificador',
                    icon: <Calendar size={20} />,
                    iconColorClass: 'bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400 border-indigo-500/20',
                    roles: ['manager', 'supervisor', 'admin', 'planificador'],
                },
                {
                    id: 'breaks_ai',
                    title: t('items.breaks_ai'),
                    description: t('home_hub.desc.breaks_ai'),
                    path: '/descansos',
                    icon: <Zap size={20} />,
                    iconColorClass: 'bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 border-amber-500/20',
                    roles: ['manager', 'supervisor', 'admin'],
                },
                {
                    id: 'my_schedule',
                    title: t('items.my_schedule'),
                    description: t('home_hub.desc.my_schedule'),
                    path: '/mis-horarios',
                    icon: <CalendarCheck size={20} />,
                    iconColorClass: 'bg-purple-500/10 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400 border-purple-500/20',
                    roles: ['asistente', 'manager', 'supervisor', 'admin'],
                    badgeType: 'beta',
                    badgeLabel: 'BETA',
                },
                {
                    id: 'self_scheduling',
                    title: t('items.self_scheduling'),
                    description: t('home_hub.desc.self_scheduling'),
                    path: '/gestion/auto-schedule',
                    icon: <UserCog size={20} />,
                    iconColorClass: 'bg-violet-500/10 text-violet-600 dark:bg-violet-500/20 dark:text-violet-400 border-violet-500/20',
                    roles: ['supervisor', 'admin'],
                    badgeType: 'beta',
                    badgeLabel: 'BETA',
                },
            ],
        },
        {
            id: 'finanzas',
            title: t('sections.finance_accounting'),
            subtitle: t('home_hub.section_sub.finanzas'),
            groupIcon: <BarChart3 size={18} />,
            items: [
                {
                    id: 'pnl',
                    title: t('items.pnl'),
                    description: t('home_hub.desc.pnl'),
                    path: '/admin/pnl',
                    icon: <BarChart3 size={20} />,
                    iconColorClass: 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 border-emerald-500/20',
                    roles: ['admin'],
                },
                {
                    id: 'cohesion',
                    title: t('items.cohesion'),
                    description: t('home_hub.desc.cohesion'),
                    path: '/contabilidad',
                    icon: <Calculator size={20} />,
                    iconColorClass: 'bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 border-amber-500/20',
                    roles: ['admin'],
                    badgeType: 'new',
                    badgeLabel: 'NEW',
                },
                {
                    id: 'create_bills',
                    title: t('items.create_bills'),
                    description: t('home_hub.desc.create_bills'),
                    path: '/admin/crear-bills',
                    icon: <Receipt size={20} />,
                    iconColorClass: 'bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 border-blue-500/20',
                    roles: ['admin'],
                    badgeType: 'new',
                    badgeLabel: 'NEW',
                },
                {
                    id: 'external_accounting',
                    title: t('items.external_accounting'),
                    description: t('home_hub.desc.external_accounting'),
                    path: '/admin/contabilidad-externa',
                    icon: <DollarSign size={20} />,
                    iconColorClass: 'bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300 border-emerald-500/30',
                    roles: ['admin'],
                    badgeType: 'new',
                    badgeLabel: 'NEW',
                },
                {
                    id: 'ronos',
                    title: t('items.ronos'),
                    description: t('home_hub.desc.ronos'),
                    path: '/admin/ronos',
                    icon: <Clock size={20} />,
                    iconColorClass: 'bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400 border-indigo-500/20',
                    roles: ['admin'],
                    badgeType: 'building',
                },
                {
                    id: 'miles_finance',
                    title: t('items.miles'),
                    description: t('home_hub.desc.miles'),
                    path: '/miles',
                    icon: <Car size={20} />,
                    iconColorClass: 'bg-teal-500/10 text-teal-600 dark:bg-teal-500/20 dark:text-teal-400 border-teal-500/20',
                    roles: ['admin', 'supervisor'],
                },
            ],
        },
        {
            id: 'gestion',
            title: t('sections.management'),
            subtitle: t('home_hub.section_sub.gestion'),
            groupIcon: <Shield size={18} />,
            items: [
                {
                    id: 'stores',
                    title: t('items.stores'),
                    description: t('home_hub.desc.stores'),
                    path: '/tiendas',
                    icon: <Store size={20} />,
                    iconColorClass: 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 border-emerald-500/20',
                    roles: ['admin'],
                },
                {
                    id: 'users',
                    title: t('items.users'),
                    description: t('home_hub.desc.users'),
                    path: '/usuarios',
                    icon: <Users size={20} />,
                    iconColorClass: 'bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 border-blue-500/20',
                    roles: ['admin', 'supervisor'],
                },
                {
                    id: 'templates',
                    title: t('items.templates'),
                    description: t('home_hub.desc.templates'),
                    path: '/admin/plantillas',
                    icon: <FileEdit size={20} />,
                    iconColorClass: 'bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 border-amber-500/20',
                    roles: ['admin'],
                },
                {
                    id: 'tv_menus',
                    title: t('items.tv_menus'),
                    description: t('home_hub.desc.tv_menus'),
                    path: '/admin/tv-menus',
                    icon: <Monitor size={20} />,
                    iconColorClass: 'bg-purple-500/10 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400 border-purple-500/20',
                    roles: ['admin', 'supervisor'],
                },
                {
                    id: 'kiosk_feedback',
                    title: t('items.kiosk_feedback'),
                    description: t('home_hub.desc.kiosk_feedback'),
                    path: '/clientes',
                    icon: <QrCode size={20} />,
                    iconColorClass: 'bg-sky-500/10 text-sky-600 dark:bg-sky-500/20 dark:text-sky-400 border-sky-500/20',
                    roles: ['admin', 'manager', 'supervisor'],
                },
                {
                    id: 'new_website',
                    title: t('items.new_website'),
                    description: t('home_hub.desc.new_website'),
                    path: '/nueva-web',
                    icon: <Globe size={20} />,
                    iconColorClass: 'bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400 border-indigo-500/20',
                    roles: ['asistente', 'manager', 'supervisor', 'admin'],
                    badgeType: 'new',
                    badgeLabel: 'new',
                },
                {
                    id: 'customer_app',
                    title: t('items.customer_app'),
                    description: t('home_hub.desc.customer_app'),
                    path: '/app',
                    icon: <Smartphone size={20} />,
                    iconColorClass: 'bg-rose-500/10 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400 border-rose-500/20',
                    roles: ['asistente', 'manager', 'supervisor', 'admin'],
                    badgeType: 'building',
                },
                {
                    id: 'gavilan_pos',
                    title: t('items.gavilan_pos'),
                    description: t('home_hub.desc.gavilan_pos'),
                    path: '/gavilan-pos',
                    icon: <Monitor size={20} />,
                    iconColorClass: 'bg-orange-500/15 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400 border-orange-500/30',
                    roles: ['admin', 'supervisor', 'manager'],
                    openInNewTab: true,
                    badgeType: 'building',
                },
                {
                    id: 'activity_reports',
                    title: t('items.activity_reports'),
                    description: t('home_hub.desc.activity_reports'),
                    path: '/admin/reporte-actividades',
                    icon: <TrendingUp size={20} />,
                    iconColorClass: 'bg-cyan-500/10 text-cyan-600 dark:bg-cyan-500/20 dark:text-cyan-400 border-cyan-500/20',
                    roles: ['admin'],
                },
                {
                    id: 'system_health',
                    title: t('items.system_health'),
                    description: t('home_hub.desc.system_health'),
                    path: '/admin/salud-sistema',
                    icon: <Shield size={20} />,
                    iconColorClass: 'bg-rose-500/10 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400 border-rose-500/20',
                    roles: ['admin'],
                },
            ],
        },
    ], [t])

    // Filter groups by user role (identical permission rules as AppSidebar)
    const roleFilteredGroups = useMemo(() => {
        const isVikesh = user?.email === 'vikesh@tacosgavilan.com'
        const userEmailNorm = (user?.email || '').trim().toLowerCase()
        const isPlanificadorOnly = userEmailNorm === 'stephany@cingularhr.com' || user?.role?.toLowerCase() === 'planificador'
        const userRole = (user?.role || user?.user_type || '').toLowerCase()
        const canAccessExternalAccounting =
            ['raquel@tacosgavilan.com', 'roberto@tacosgavilan.com', 'roque@tacosgavilan.com', 'rvelasquez95@yahoo.com'].includes(userEmailNorm) ||
            [45, 46, 47].includes(Number(user?.id))

        return moduleGroups
            .map(group => {
                if (isVikesh && (group.id === 'inventario' || group.id === 'food_cost')) {
                    return { ...group, items: [] }
                }
                const validItems = group.items.filter(item => {
                    if (item.path === '/admin/contabilidad-externa') return canAccessExternalAccounting
                    if (isPlanificadorOnly) return item.path === '/planificador'
                    if (isVikesh && (item.path === '/ventas' || item.path === '/ventas/reportes')) return false
                    if (!item.roles || item.roles.length === 0) return true
                    if (!userRole) return false
                    return item.roles.includes(userRole)
                })
                return { ...group, items: validItems }
            })
            .filter(group => group.items.length > 0)
    }, [moduleGroups, user])

    // Check if current user can access main Dashboard (/dashboard)
    const canAccessDashboard = useMemo(() => {
        const userRole = (user?.role || user?.user_type || '').toLowerCase()
        return ['admin', 'supervisor', 'manager', 'auditor'].includes(userRole)
    }, [user])

    // Flatten available modules for Favorites lookup (preserving each item's category groupId)
    const favoriteModules = useMemo(() => {
        if (favoriteIds.length === 0) return []
        const map = new Map<string, { item: HubModuleItem; groupId: string }>()
        for (const g of roleFilteredGroups) {
            for (const item of g.items) {
                if (!map.has(item.id)) map.set(item.id, { item, groupId: g.id })
            }
        }
        return favoriteIds
            .map(id => map.get(id))
            .filter((x): x is { item: HubModuleItem; groupId: string } => Boolean(x))
    }, [roleFilteredGroups, favoriteIds])

    // Apply search query and category filter.
    // When showing "all" without search query and the Featured Dashboard Banner is shown at the top,
    // we avoid duplicating a second "Dashboard" card right below it unless the user filters/searches.
    const displayedGroups = useMemo(() => {
        const q = searchQuery.trim().toLowerCase()
        const hideDuplicateDashboard = canAccessDashboard && activeCategory === 'all' && !q

        return roleFilteredGroups
            .filter(group => {
                if (activeCategory === 'all' || activeCategory === 'new') return true
                return group.id === activeCategory
            })
            .map(group => {
                const matchingItems = group.items.filter(item => {
                    if (hideDuplicateDashboard && item.isPrimaryDashboard) return false
                    if (activeCategory === 'new' && item.badgeType !== 'new') return false
                    if (!q) return true
                    return (
                        item.title.toLowerCase().includes(q) ||
                        item.description.toLowerCase().includes(q) ||
                        group.title.toLowerCase().includes(q)
                    )
                })
                return { ...group, items: matchingItems }
            })
            .filter(group => group.items.length > 0)
    }, [roleFilteredGroups, searchQuery, activeCategory, canAccessDashboard])

    const totalAvailableModules = useMemo(() => {
        return roleFilteredGroups.reduce((acc, g) => acc + g.items.length, 0)
    }, [roleFilteredGroups])

    const newModulesCount = useMemo(() => {
        return roleFilteredGroups.reduce(
            (acc, g) => acc + g.items.filter(i => i.badgeType === 'new').length,
            0
        )
    }, [roleFilteredGroups])

    const firstName = user?.name?.split(' ')[0] || 'Usuario'

    // Helper to render a single Horizontal Module Tile (strictly respecting its section color)
    const renderModuleTile = (item: HubModuleItem, groupId: string) => {
        const theme = SECTION_THEMES[groupId] || SECTION_THEMES.operaciones
        const isFav = favoriteIds.includes(item.id)

        return (
            <Link
                key={`${groupId}-${item.id}`}
                href={item.path}
                target={item.openInNewTab ? '_blank' : undefined}
                rel={item.openInNewTab ? 'noopener noreferrer' : undefined}
                onClick={handleModuleClick}
                className={`group/card relative flex items-start gap-3.5 rounded-xl p-3.5 border bg-slate-50/60 dark:bg-slate-950/50 hover:bg-white dark:hover:bg-slate-900 border-slate-200/80 dark:border-slate-800/90 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${theme.borderHover}`}
            >
                {/* Left Icon Box — strictly respects the section's color */}
                <div className={`w-11 h-11 rounded-xl border flex items-center justify-center shrink-0 transition-transform duration-200 group-hover/card:scale-105 ${theme.headerIconBg} ${theme.headerIconColor}`}>
                    {item.icon}
                </div>

                {/* Middle: Title + Badges + Description */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                        <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 group-hover/card:text-red-600 dark:group-hover/card:text-red-400 transition-colors leading-snug">
                            {item.title}
                        </h4>

                        <div className="flex items-center gap-1.5 shrink-0">
                            {item.openInNewTab && (
                                <ExternalLink size={12} className="text-slate-400 dark:text-slate-500 group-hover/card:text-blue-500 transition-colors shrink-0" />
                            )}

                            {item.badgeType === 'new' && (
                                <span className="new-badge-animated bg-blue-600 dark:bg-blue-500 text-white text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded shadow-xs inline-flex items-center justify-center border border-blue-400/30 leading-none">
                                    {item.badgeLabel || 'new'}
                                </span>
                            )}

                            {item.badgeType === 'building' && (
                                <span className="new-badge-animated bg-amber-500/20 dark:bg-amber-500/25 text-amber-900 dark:text-amber-200 px-1.5 py-1 rounded shadow-xs inline-flex items-center justify-center border border-amber-500/40 leading-none">
                                    <HazardTapeIcon size={14} />
                                </span>
                            )}

                            {item.badgeType === 'beta' && (
                                <span className="text-[9px] bg-purple-100 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 border border-purple-300 dark:border-purple-700 px-1.5 py-0.5 rounded font-black tracking-widest leading-none">
                                    {item.badgeLabel || 'BETA'}
                                </span>
                            )}
                        </div>
                    </div>

                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-snug line-clamp-2">
                        {item.description}
                    </p>

                    {item.id === 'customer_app' && (
                        <div className="mt-2.5 flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    window.location.href = '/app?v=1'
                                }}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-200/80 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300/70 dark:border-slate-700 transition-all cursor-pointer"
                            >
                                <span>{t('items.customer_app_v1') || 'Versión 1'}</span>
                            </button>
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    window.location.href = '/app?v=2'
                                }}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-black bg-gradient-to-r from-[#50050a] to-red-700 hover:from-[#3d0307] hover:to-red-800 text-[#FDC82F] border border-[#FDC82F]/60 shadow-sm transition-all cursor-pointer"
                            >
                                <Sparkles size={11} />
                                <span>{t('items.customer_app_v2') || 'Versión 2'}</span>
                            </button>
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    window.location.href = '/app?v=2&fullscreen=1'
                                }}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-black bg-[#FDC82F] hover:bg-amber-400 text-[#121212] border border-amber-500 shadow-sm transition-all cursor-pointer"
                            >
                                <Smartphone size={11} />
                                <span>TEST FULLSCREEN</span>
                            </button>
                        </div>
                    )}
                </div>

                {/* Right: Star (Quick Pin) + Chevron */}
                <div className="flex items-center gap-1 shrink-0 self-center">
                    <button
                        type="button"
                        onClick={(e) => toggleFavorite(e, item.id)}
                        title={isFav ? t('home_hub.unpin_favorite') : t('home_hub.pin_favorite')}
                        className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                            isFav
                                ? 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/40 opacity-100'
                                : 'text-slate-300 dark:text-slate-600 hover:text-amber-500 hover:bg-slate-100 dark:hover:bg-slate-800 opacity-0 group-hover/card:opacity-100'
                        }`}
                    >
                        <Star size={14} fill={isFav ? 'currentColor' : 'none'} />
                    </button>
                    <ChevronRight
                        size={16}
                        className="text-slate-300 dark:text-slate-600 group-hover/card:text-red-500 group-hover/card:translate-x-0.5 transition-all"
                    />
                </div>
            </Link>
        )
    }

    return (
        <div className="space-y-4 pb-8">
            {/* ── Compact, Friendly Header + Instant Search Bar ── */}
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3.5 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200/80 dark:border-slate-800 rounded-2xl px-5 py-4 shadow-xs">
                <div className="flex items-center gap-3.5">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#50050a] to-red-700 flex items-center justify-center shadow-sm border border-red-500/30 shrink-0 p-1.5">
                        <img src="/logo.png" alt="Tacos Gavilan" className="w-full h-full object-contain" />
                    </div>
                    <div>
                        <h1 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tracking-tight flex flex-wrap items-center gap-2">
                            <span>{timeGreeting}, {firstName}!</span>
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                <LayoutGrid size={11} className="text-red-500" />
                                {totalAvailableModules} {t('home_hub.modules_available')}
                            </span>
                        </h1>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {t('home_hub.subtitle')}
                        </p>
                    </div>
                </div>

                {/* Prominent Search Input */}
                <div className="relative w-full lg:w-96">
                    <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                        ref={searchInputRef}
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={t('home_hub.search_placeholder')}
                        className="w-full pl-10 pr-14 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500 transition-all"
                    />
                    {searchQuery ? (
                        <button
                            type="button"
                            onClick={() => setSearchQuery('')}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-1.5 py-0.5 rounded bg-slate-200/70 dark:bg-slate-800 cursor-pointer"
                        >
                            ✕
                        </button>
                    ) : (
                        <kbd className="hidden sm:inline-block absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono font-bold text-slate-400 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-1.5 py-0.5 rounded shadow-2xs pointer-events-none">
                            /
                        </kbd>
                    )}
                </div>
            </div>

            {/* ── #1 FIRST & MOST EYE-CATCHING LINK: Compact Featured Executive Dashboard Banner ── */}
            {canAccessDashboard && (
                <Link
                    href="/dashboard"
                    onClick={handleModuleClick}
                    className="group relative block overflow-hidden rounded-2xl bg-gradient-to-r from-[#5a070d] via-[#84101a] to-[#3d0509] px-5 py-4 sm:px-6 sm:py-4.5 text-white shadow-md ring-1 ring-[#fdc82f]/60 hover:ring-2 hover:ring-[#fdc82f] hover:shadow-xl transition-all duration-200"
                >
                    <div className="pointer-events-none absolute -right-12 -top-12 w-64 h-64 rounded-full bg-[#fdc82f]/15 blur-2xl group-hover:bg-[#fdc82f]/25 transition-all" />

                    <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                        <div className="flex items-center gap-4 min-w-0">
                            {/* Glowing Dashboard Icon */}
                            <div className="w-13 h-13 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br from-[#fdc82f] to-[#f59e0b] p-0.5 shadow-md shrink-0 group-hover:scale-105 transition-transform">
                                <div className="w-full h-full rounded-[14px] bg-[#3f0509] flex items-center justify-center text-[#fdc82f]">
                                    <LayoutDashboard size={26} strokeWidth={2.2} />
                                </div>
                            </div>

                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#fdc82f] text-slate-950 text-[9px] font-black uppercase tracking-wider">
                                        <span className="relative flex h-1.5 w-1.5">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-600 opacity-75"></span>
                                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-600"></span>
                                        </span>
                                        {t('home_hub.hero_badge')}
                                    </span>
                                    <div className="hidden xl:flex items-center gap-1.5 text-[11px] font-semibold text-amber-200/90">
                                        <span>• {t('home_hub.hero_pill_sales')}</span>
                                        <span>• {t('home_hub.hero_pill_costs')}</span>
                                        <span>• {t('home_hub.hero_pill_alerts')}</span>
                                        <span>• {t('home_hub.hero_pill_nps')}</span>
                                    </div>
                                </div>

                                <h2 className="text-base sm:text-xl font-black tracking-tight text-white group-hover:text-[#fdc82f] transition-colors mt-0.5 truncate">
                                    {t('home_hub.hero_title')}
                                </h2>

                                <p className="text-xs text-red-100/85 line-clamp-1 mt-0.5">
                                    {t('home_hub.hero_desc')}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center md:justify-end shrink-0">
                            <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#fdc82f] to-[#f59e0b] text-slate-950 font-black text-xs uppercase tracking-wider shadow-sm group-hover:scale-105 transition-transform">
                                <span>{t('home_hub.hero_cta')}</span>
                                <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" />
                            </div>
                        </div>
                    </div>
                </Link>
            )}

            {/* ── User's Pinned Favorites ("Mis Accesos Rápidos") ── */}
            {favoriteModules.length > 0 && !searchQuery && activeCategory === 'all' && (
                <section className="bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-800/50 rounded-2xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Star size={15} className="text-amber-500 fill-amber-500" />
                            <h3 className="text-xs font-black uppercase tracking-wider text-amber-900 dark:text-amber-200">
                                {t('home_hub.favorites_title')}
                            </h3>
                        </div>
                        <span className="text-[11px] text-amber-700/80 dark:text-amber-400/80 hidden sm:inline">
                            {t('home_hub.favorites_hint')}
                        </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
                        {favoriteModules.map(({ item, groupId }) => renderModuleTile(item, groupId))}
                    </div>
                </section>
            )}

            {/* ── Friendly Category Filter Tabs with Icons ── */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                <button
                    type="button"
                    onClick={() => setActiveCategory('all')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 border flex items-center gap-1.5 cursor-pointer ${
                        activeCategory === 'all'
                            ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-slate-900 dark:border-white shadow-xs'
                            : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                >
                    <LayoutGrid size={13} />
                    <span>{t('home_hub.filter_all')}</span>
                    <span className="text-[10px] opacity-75">({totalAvailableModules})</span>
                </button>

                {newModulesCount > 0 && (
                    <button
                        type="button"
                        onClick={() => setActiveCategory('new')}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 border flex items-center gap-1.5 cursor-pointer ${
                            activeCategory === 'new'
                                ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                    >
                        <Sparkles size={13} className={activeCategory === 'new' ? 'text-white' : 'text-blue-600 dark:text-blue-400'} />
                        <span>{t('home_hub.filter_new')}</span>
                        <span className="text-[10px] opacity-80">({newModulesCount})</span>
                    </button>
                )}

                {roleFilteredGroups.map(group => {
                    const theme = SECTION_THEMES[group.id] || SECTION_THEMES.operaciones
                    const isSelected = activeCategory === group.id
                    return (
                        <button
                            key={group.id}
                            type="button"
                            onClick={() => setActiveCategory(group.id)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 border flex items-center gap-1.5 cursor-pointer ${
                                isSelected
                                    ? theme.pillActive
                                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
                            }`}
                        >
                            <span className={isSelected ? 'text-white' : theme.headerIconColor}>
                                {group.groupIcon}
                            </span>
                            <span>{group.title}</span>
                            <span className="text-[10px] opacity-75">({group.items.length})</span>
                        </button>
                    )
                })}
            </div>

            {/* ── Department Sections with Compact Horizontal Module Tiles ── */}
            {displayedGroups.length === 0 ? (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-10 text-center">
                    <p className="text-base font-bold text-slate-800 dark:text-slate-200">
                        {t('home_hub.no_results_title')}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {t('home_hub.no_results_desc')}
                    </p>
                    <button
                        type="button"
                        onClick={() => {
                            setSearchQuery('')
                            setActiveCategory('all')
                        }}
                        className="mt-4 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-colors cursor-pointer"
                    >
                        {t('home_hub.clear_filters')}
                    </button>
                </div>
            ) : (
                <div className="space-y-4">
                    {displayedGroups.map(group => {
                        const theme = SECTION_THEMES[group.id] || SECTION_THEMES.operaciones
                        return (
                            <section
                                key={group.id}
                                className={`bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200/80 dark:border-slate-800 ${theme.sectionBorder} rounded-2xl p-4 sm:p-5 shadow-xs space-y-3.5`}
                            >
                                {/* Department Header */}
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${theme.headerIconBg} ${theme.headerIconColor}`}>
                                            {group.groupIcon}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <h3 className="text-xs sm:text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
                                                    {group.title}
                                                </h3>
                                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${theme.badgeBg}`}>
                                                    {group.items.length}
                                                </span>
                                            </div>
                                            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate hidden sm:block">
                                                {group.subtitle}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* Horizontal Module Tiles Grid */}
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
                                    {group.items.map(item => renderModuleTile(item, group.id))}
                                </div>
                            </section>
                        )
                    })}
                </div>
            )}
        </div>
    )
}

export default function InicioPage() {
    return (
        <ProtectedRoute allowedRoles={['admin', 'supervisor', 'manager', 'asistente', 'auditor']}>
            <InicioHubContent />
        </ProtectedRoute>
    )
}
