/**
 * @module components/AppSidebar
 * @description Barra lateral de navegación principal (Desktop Sidebar + Mobile Drawer) del sistema Tacos Gavilan.
 * Organiza los módulos operativos, financieros, de análisis, inventario, equipo y gestión por rol de usuario.
 *
 * @businessRules
 * - Todos los grupos de categorías inician cerrados por defecto (`effectiveExpandedGroups = {}`), abriendo automáticamente únicamente la categoría que contiene la ruta activa (`pathname`) con auto-scroll suave hacia el módulo activo.
 * - Modo acordeón inteligente: al abrir manualmente un grupo, colapsa los demás para mantener limpia la navegación, con opción global de Abrir/Cerrar todos en 1 clic.
 * - Incluye buscador instantáneo de módulos insensible a mayúsculas y acentos, además de accesos rápidos fijos superiores (`Inicio` y `Dashboard`).
 * - Filtra dinámicamente los módulos según el rol del usuario autenticado (`admin`, `supervisor`, `manager`, `asistente`, `planificador`).
 * - Los módulos configurados con `openInNewTab: true` (ej. `/app` Customer App y `/gavilan-pos` Gavilan POS) se abren en una pestaña independiente (`target="_blank"`) con icono de enlace externo.
 * - Soporta insignias animadas (`NEW`, `Building`) con ubicación en línea o debajo del título (`badgePosition: 'below'`).
 * - Soporta cambio de idioma en vivo (ES/EN), modo claro/oscuro, notificaciones y modal de historial de versiones (`ChangelogModal`).
 *
 * @dataFlow
 * - Consume `useAuth()` para permisos de rol, `useLanguage()` para internacionalización (`i18n`), y `SYSTEM_VERSION` para control de versión.
 *
 * @notes
 * - Ancho expandido de `276px` (y `64px` colapsado) sincronizado con `components/ClientLayout.tsx`, donde `/app` y `/gavilan-pos` están registrados en `publicRoutes` para renderizarse a pantalla completa sin el sidebar administrativo.
 */

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
    CalendarDays, Sparkles, Info, UserCircle, Menu, Folder, Truck, Timer, Shirt, Car, Calculator, Package, BarChart3, UserCheck, Bell, Receipt, Wrench, Smartphone, ShieldCheck, HardHat, Construction, Layers, PhoneCall,
    Search, LayoutGrid, ChevronsUpDown, ChevronsDownUp
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useLanguage } from '@/lib/i18n'
import { SYSTEM_VERSION } from '@/lib/version'
import { ChangelogModal } from './ChangelogModal'

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
    tooltip?: string
    openInNewTab?: boolean
    badgeText?: string
    badgeIcon?: React.ReactNode
    badgePosition?: 'inline' | 'below'
    badgeStyle?: 'default' | 'hazard-tape'
    subItems?: {
        name: string
        path: string
        badgeText?: string
        openInNewTab?: boolean
        tooltip?: string
    }[]
}

type MenuGroup = {
    title: string
    id: string
    groupIcon: React.ReactNode
    items: MenuItem[]
}

type GroupColorTheme = {
    icon: string
    activeBg: string
    activeBorder: string
    headerIconBox: string
    headerOpenCard: string
    headerActiveClosed: string
    dot: string
    treeLine: string
    countActive: string
}

// Color map per group (matching /inicio department palette)
const GROUP_COLORS: Record<string, GroupColorTheme> = {
    operaciones: {
        icon: 'text-blue-600 dark:text-blue-400',
        activeBg: 'bg-blue-50 dark:bg-blue-950/40',
        activeBorder: 'border-l-blue-500',
        headerIconBox: 'bg-blue-500/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/20',
        headerOpenCard: 'bg-white dark:bg-slate-900 border-blue-200/90 dark:border-blue-800/70 shadow-2xs',
        headerActiveClosed: 'bg-blue-50/70 dark:bg-blue-950/30 border-blue-300/80 dark:border-blue-800/80',
        dot: 'bg-blue-500',
        treeLine: 'border-blue-200/80 dark:border-blue-900/50',
        countActive: 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200/80 dark:border-blue-800/70',
    },
    finanzas: {
        icon: 'text-emerald-600 dark:text-emerald-400',
        activeBg: 'bg-emerald-50 dark:bg-emerald-950/40',
        activeBorder: 'border-l-emerald-500',
        headerIconBox: 'bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
        headerOpenCard: 'bg-white dark:bg-slate-900 border-emerald-200/90 dark:border-emerald-800/70 shadow-2xs',
        headerActiveClosed: 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-300/80 dark:border-emerald-800/80',
        dot: 'bg-emerald-500',
        treeLine: 'border-emerald-200/80 dark:border-emerald-900/50',
        countActive: 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-800/70',
    },
    gestion: {
        icon: 'text-amber-600 dark:text-amber-400',
        activeBg: 'bg-amber-50 dark:bg-amber-950/40',
        activeBorder: 'border-l-amber-500',
        headerIconBox: 'bg-amber-500/10 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/20',
        headerOpenCard: 'bg-white dark:bg-slate-900 border-amber-200/90 dark:border-amber-800/70 shadow-2xs',
        headerActiveClosed: 'bg-amber-50/70 dark:bg-amber-950/30 border-amber-300/80 dark:border-amber-800/80',
        dot: 'bg-amber-500',
        treeLine: 'border-amber-200/80 dark:border-amber-900/50',
        countActive: 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200/80 dark:border-amber-800/70',
    },
    analisis: {
        icon: 'text-rose-600 dark:text-rose-400',
        activeBg: 'bg-rose-50 dark:bg-rose-950/40',
        activeBorder: 'border-l-rose-500',
        headerIconBox: 'bg-rose-500/10 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400 border-rose-500/20',
        headerOpenCard: 'bg-white dark:bg-slate-900 border-rose-200/90 dark:border-rose-800/70 shadow-2xs',
        headerActiveClosed: 'bg-rose-50/70 dark:bg-rose-950/30 border-rose-300/80 dark:border-rose-800/80',
        dot: 'bg-rose-500',
        treeLine: 'border-rose-200/80 dark:border-rose-900/50',
        countActive: 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200/80 dark:border-rose-800/70',
    },
    inventario: {
        icon: 'text-purple-600 dark:text-purple-400',
        activeBg: 'bg-purple-50 dark:bg-purple-950/40',
        activeBorder: 'border-l-purple-500',
        headerIconBox: 'bg-purple-500/10 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400 border-purple-500/20',
        headerOpenCard: 'bg-white dark:bg-slate-900 border-purple-200/90 dark:border-purple-800/70 shadow-2xs',
        headerActiveClosed: 'bg-purple-50/70 dark:bg-purple-950/30 border-purple-300/80 dark:border-purple-800/80',
        dot: 'bg-purple-500',
        treeLine: 'border-purple-200/80 dark:border-purple-900/50',
        countActive: 'bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border-purple-200/80 dark:border-purple-800/70',
    },
    equipo: {
        icon: 'text-cyan-600 dark:text-cyan-400',
        activeBg: 'bg-cyan-50 dark:bg-cyan-950/40',
        activeBorder: 'border-l-cyan-500',
        headerIconBox: 'bg-cyan-500/10 dark:bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 border-cyan-500/20',
        headerOpenCard: 'bg-white dark:bg-slate-900 border-cyan-200/90 dark:border-cyan-800/70 shadow-2xs',
        headerActiveClosed: 'bg-cyan-50/70 dark:bg-cyan-950/30 border-cyan-300/80 dark:border-cyan-800/80',
        dot: 'bg-cyan-500',
        treeLine: 'border-cyan-200/80 dark:border-cyan-900/50',
        countActive: 'bg-cyan-50 dark:bg-cyan-950/60 text-cyan-700 dark:text-cyan-300 border-cyan-200/80 dark:border-cyan-800/70',
    },
}

const normalizeSidebarText = (value: string): string =>
    value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()

const isSidebarItemActive = (
    item: MenuItem,
    currentPath: string | null,
    allPaths: string[] = []
): boolean => {
    if (!currentPath) return false
    const matchesSub = Boolean(item.subItems?.some(sub => currentPath === sub.path))
    if (currentPath === item.path || matchesSub) return true
    if (item.path === '/dashboard' || !currentPath.startsWith(item.path + '/')) return false
    const hasMoreSpecificSibling = allPaths.some(
        p => p !== item.path && p.length > item.path.length && (currentPath === p || currentPath.startsWith(p + '/'))
    )
    return !hasMoreSpecificSibling
}

export default function AppSidebar({ isCollapsed, setIsCollapsed, mobileDrawerOpen, setMobileDrawerOpen }: AppSidebarProps) {
    const pathname = usePathname()
    const router = useRouter()
    const { user } = useAuth()
    const { t, language, setLanguage } = useLanguage()

    const [expandedSubItems, setExpandedSubItems] = useState<Record<string, boolean>>({})
    // Path-scoped manual accordion overrides; default state keeps all groups closed (except active route group)
    const [groupOverrides, setGroupOverrides] = useState<{ path: string | null; groups: Record<string, boolean> }>({ path: null, groups: {} })
    const [searchState, setSearchState] = useState<{ path: string | null; query: string }>({ path: null, query: '' })
    const sidebarSearch = searchState.path === pathname ? searchState.query : ''
    const setSidebarSearch = (query: string) => setSearchState({ path: pathname, query })
    const [userDropdownOpen, setUserDropdownOpen] = useState(false)
    const [changelogOpen, setChangelogOpen] = useState(false)
    const dropdownRef = useRef<HTMLDivElement>(null)
    const mobileDropdownRef = useRef<HTMLDivElement>(null)
    const desktopNavRef = useRef<HTMLElement>(null)
    const mobileNavRef = useRef<HTMLElement>(null)
    const searchInputRef = useRef<HTMLInputElement>(null)

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

    // Menu groups (Structured into 6 logical operational categories)
    const menuGroups: MenuGroup[] = [
        {
            title: t('sidebar_nav.groups.analisis'),
            id: 'analisis',
            groupIcon: <TrendingUp size={15} />,
            items: [
                {
                    name: t('items.dashboard'),
                    plainName: 'Dashboard',
                    path: '/dashboard',
                    icon: <LayoutDashboard size={20} />,
                    roles: ['manager', 'supervisor', 'admin', 'auditor'],
                    tooltip: language === 'en'
                        ? 'Executive dashboard with real-time Toast POS sales and store alerts (Tablero principal con métricas en vivo)'
                        : 'Tablero principal con métricas en tiempo real, ventas Toast POS y alertas operativas'
                },
                {
                    name: t('items.sales'),
                    plainName: 'Ventas',
                    path: '/ventas',
                    icon: <DollarSign size={20} />,
                    roles: ['admin', 'manager', 'supervisor'],
                    tooltip: language === 'en'
                        ? 'Live net sales analysis, hourly comparisons, and revenue trends (Análisis de ventas netas e ingresos)'
                        : 'Análisis en vivo de ventas netas, comparativos por hora y tendencias de ingresos'
                },
                {
                    name: t('items.reports'),
                    plainName: 'Reportes',
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
                    roles: ['manager', 'supervisor', 'admin'],
                    tooltip: language === 'en'
                        ? 'Consolidated sales reports, delivery channels, taxes, and payment methods (Reportes financieros consolidados)'
                        : 'Reportes consolidados de ventas, canales de entrega, impuestos y métodos de pago'
                },
                {
                    name: t('items.discounts'),
                    plainName: 'Descuentos',
                    path: '/admin/auditoria-descuentos',
                    icon: <ClipboardList size={20} />,
                    roles: ['admin', 'supervisor', 'manager'],
                    tooltip: language === 'en'
                        ? 'Detailed audit of manager comps, promos, and POS discounts (Auditoría de cortesías y descuentos)'
                        : 'Auditoría detallada de cortesías, promociones y descuentos aplicados en la caja POS'
                },
                {
                    name: t('items.drive_thru_leaderboard'),
                    plainName: 'Drive-Thru',
                    path: '/drive-thru',
                    icon: <Timer size={20} />,
                    roles: ['manager', 'supervisor', 'admin'],
                    tooltip: language === 'en'
                        ? 'Drive-Thru speed of service metrics and store leaderboard (Métricas de velocidad de atención autoservicio)'
                        : 'Métricas de velocidad de atención y ranking entre sucursales para el Drive-Thru'
                },
                {
                    name: t('items.feedback'),
                    plainName: 'Feedback Clientes',
                    path: '/feedback',
                    icon: <MessageSquare size={20} />,
                    roles: ['asistente', 'manager', 'supervisor', 'admin'],
                    tooltip: language === 'en'
                        ? 'Customer feedback and reviews collected from kiosks and surveys (Revisiones y opiniones de clientes)'
                        : 'Revisiones y comentarios de clientes recopilados en kioskos y encuestas'
                },
                {
                    name: t('items.eval_staff'),
                    plainName: 'Feedback Staff',
                    path: '/evaluacion',
                    icon: <UserCheck size={20} />,
                    roles: ['admin', 'manager', 'supervisor'],
                    tooltip: language === 'en'
                        ? 'Staff feedback and performance evaluation dashboard (Feedback y evaluaciones de desempeño del personal)'
                        : 'Tablero ejecutivo de feedback, evaluaciones de desempeño y habilidades del personal'
                },
            ]
        },
        {
            title: t('sidebar_nav.groups.operaciones'),
            id: 'operaciones',
            groupIcon: <Briefcase size={15} />,
            items: [
                {
                    name: t('items.basecamp') || 'Basecamp',
                    plainName: 'Basecamp',
                    path: '/basecamp',
                    icon: <BasecampIcon size={20} />,
                    roles: ['manager', 'supervisor', 'admin', 'asistente'],
                    tooltip: language === 'en'
                        ? 'Communication hub, operational tickets, and company announcements (Casos, tickets y avisos a corporativo)'
                        : 'Plataforma diaria de comunicación, casos operativos y avisos a la compañía'
                },
                {
                    name: t('items.manager'),
                    plainName: 'Checklists Manager',
                    path: '/checklists-manager',
                    icon: <Briefcase size={20} />,
                    roles: ['manager', 'supervisor', 'admin'],
                    tooltip: language === 'en'
                        ? 'Opening, shift change, and closing task checklists for managers (Listas de tareas para gerentes)'
                        : 'Listas de tareas de apertura, cambio de turno y cierre para el gerente'
                },
                {
                    name: t('items.assistants'),
                    plainName: 'Checklists Asistentes',
                    path: '/checklists',
                    icon: <CheckSquare size={20} />,
                    roles: ['asistente', 'manager', 'supervisor', 'admin'],
                    tooltip: language === 'en'
                        ? 'Daily operational checklists for assistant managers and line leads (Rutinas operativas para asistentes)'
                        : 'Checklists de rutinas operativas diarias para asistentes de gerencia'
                },
                {
                    name: t('items.supervisor'),
                    plainName: 'Checklists Supervisor',
                    path: '/inspecciones',
                    icon: <ClipboardList size={20} />,
                    roles: ['supervisor', 'admin'],
                    tooltip: language === 'en'
                        ? 'Quality, cleanliness, and brand standard audits by supervisors (Auditorías de calidad e higiene)'
                        : 'Auditorías de calidad, limpieza y estándares de marca por supervisores'
                },
                {
                    name: t('items.prep'),
                    plainName: 'Preparador (Pace)',
                    path: '/inventory/preparador',
                    icon: <ChefHat size={20} />,
                    roles: ['admin', 'manager', 'supervisor', 'asistente'],
                    tooltip: language === 'en'
                        ? 'Intraday 30-min meat cooking pace projection for grill cooks (Proyección de carne a cocinar por bloques)'
                        : 'Proyección intradía de libras de carne a cocinar por bloques de 30 minutos'
                },
                {
                    name: t('items.blindaje_delivery') || 'Blindaje Delivery',
                    plainName: 'Blindaje Delivery',
                    path: '/admin/blindaje-delivery',
                    icon: <ShieldCheck size={20} />,
                    roles: ['admin', 'manager', 'supervisor', 'asistente'],
                    tooltip: language === 'en'
                        ? 'Packing & custody station, KDS voice announcer, and driver handoff verification'
                        : 'Mesa de empaque, locutor de voz KDS y verificación de entrega a choferes'
                },
                {
                    name: t('items.order_ready_board'),
                    plainName: 'Order Ready Board',
                    path: '/order-ready-board',
                    icon: <Bell size={20} />,
                    roles: ['asistente', 'manager', 'supervisor', 'admin'],
                    tooltip: language === 'en'
                        ? 'Customer-facing order pickup display and voice announcer (Tablero de pedidos listos y locutor de voz)'
                        : 'Tablero de pedidos listos para clientes y locutor de voz automático'
                },
                {
                    name: t('items.phone_agent'),
                    plainName: 'Contestadora IA',
                    path: '/admin/llamadas',
                    icon: <PhoneCall size={20} />,
                    roles: ['admin', 'supervisor', 'regional_manager', 'manager', 'gerente', 'asistente', 'assistant'],
                    badgeText: 'new',
                    tooltip: t('home_hub.desc.phone_agent')
                },
                {
                    name: t('items.safe'),
                    plainName: 'Caja Fuerte',
                    path: '/caja-fuerte',
                    icon: <Shield size={20} />,
                    roles: ['admin', 'supervisor', 'manager', 'asistente'],
                    tooltip: language === 'en'
                        ? 'Safe audit of bills, coins, and uniform sales cash reconciliation (Arqueo semanal de bóveda)'
                        : 'Arqueo de billetes, monedas y conciliación de efectivo de uniformes en bóveda'
                },
                {
                    name: t('items.actividades') || 'Actividades',
                    plainName: 'Actividades',
                    path: '/actividades',
                    icon: <ClipboardList size={20} />,
                    roles: ['manager', 'supervisor', 'admin', 'asistente'],
                    tooltip: language === 'en'
                        ? 'Assignment and tracking of individual maintenance tasks (Asignación de tareas individuales)'
                        : 'Asignación y seguimiento de tareas individuales de mantenimiento y limpieza'
                },
                {
                    name: t('items.training') || 'Training (Academia 4 Días)',
                    plainName: 'Training (Academia 4 Días)',
                    path: '/training',
                    icon: <Sparkles size={20} />,
                    roles: ['manager', 'supervisor', 'admin', 'asistente'],
                    badgeText: 'new',
                    tooltip: language === 'en'
                        ? 'Interactive 4-day SOP training academy with real kitchen videos, neural male voiceover (Orus), exact oz portions, and temporary 4-day access codes'
                        : 'Academia interactiva de entrenamiento SOP en 4 días con videos reales, locutor masculino neural (Orus), gramajes en oz y códigos temporales de 4 días'
                },
                {
                    name: t('items.maintenance') || 'Mantenimiento & Proveedores',
                    plainName: 'Mantenimiento',
                    path: '/admin/mantenimiento',
                    icon: <Wrench size={20} />,
                    roles: ['asistente', 'manager', 'supervisor', 'admin'],
                    badgeIcon: <HazardTapeIcon size={16} />,
                    tooltip: language === 'en'
                        ? 'Vendor service visits, equipment repairs, and technical photo evidence log'
                        : 'Registro de visitas de técnicos, reparaciones de equipos y evidencias fotográficas de proveedores'
                },
            ]
        },
        {
            title: t('sidebar_nav.groups.inventario'),
            id: 'inventario',
            groupIcon: <Package size={15} />,
            items: [
                {
                    name: t('items.bodega_orders'),
                    plainName: 'Orden diaria',
                    path: '/inventory/orders',
                    icon: <Truck size={20} />,
                    roles: ['admin', 'manager', 'supervisor'],
                    tooltip: language === 'en'
                        ? 'Auto-calculation of daily warehouse supply orders sent to QuickBooks (Pedido diario a Bodega Central)'
                        : 'Generación automática de pedidos diarios a Bodega Central y envío a QuickBooks'
                },
                {
                    name: t('items.viele_sons'),
                    plainName: 'Viele & Sons',
                    path: '/admin/compras/viele',
                    icon: <Package size={20} />,
                    roles: ['admin', 'manager', 'supervisor'],
                    tooltip: language === 'en'
                        ? 'Weekly supplies count, order calculation, and direct Sage 100 checkout (Insumos y desechables)'
                        : 'Conteo semanal de insumos y desechables, cálculo automático de orden y checkout en Viele & Sons'
                },
                {
                    name: t('items.uniforms_control'),
                    plainName: 'Control de Uniformes',
                    path: '/inventory/uniforms',
                    icon: <Shirt size={20} />,
                    roles: ['admin', 'manager', 'supervisor', 'asistente'],
                    tooltip: language === 'en'
                        ? 'Uniform stock management, new hire package issues, and sales (Existencias de ropa y entregas)'
                        : 'Gestión de existencias de uniformes, paquetes a empleados y ventas'
                },
                {
                    name: t('items.food_cost_margins'),
                    plainName: 'Food Cost & Márgenes',
                    path: '/admin/food-cost',
                    icon: <TrendingUp size={20} />,
                    roles: ['admin', 'manager', 'supervisor'],
                    tooltip: language === 'en'
                        ? 'Comprehensive food cost analysis, meat yields, and menu margins (Análisis general, carnes y márgenes)'
                        : 'Análisis integral de Food Cost por sucursal, rendimiento de carnes y margen por platillo'
                },
                {
                    name: t('items.supplier_prices') || 'Radar de Precios',
                    plainName: 'Radar de Precios',
                    path: '/admin/precios-proveedores',
                    icon: <Calculator size={20} />,
                    roles: ['admin'],
                    tooltip: language === 'en'
                        ? 'Smart supplier price intake, inflation detection, and 15-store COGS audit (Radar de precios e impacto en recetas)'
                        : 'Ingesta inteligente de precios de proveedores, detección de aumentos y auditoría de COGS'
                },
                {
                    name: t('items.ingredients'),
                    plainName: 'Insumos de Bodega',
                    path: '/inventory/items',
                    icon: <Store size={20} />,
                    roles: ['admin', 'manager', 'supervisor'],
                    tooltip: language === 'en'
                        ? 'Master raw ingredients catalog with purchase costs (Catálogo maestro de insumos y costos)'
                        : 'Catálogo maestro de ingredientes e insumos con sus costos y empaques'
                },
                {
                    name: t('items.menu_catalog'),
                    plainName: 'Recetas (Menú)',
                    path: '/inventory/menu',
                    icon: <ClipboardList size={20} />,
                    roles: ['admin', 'manager', 'supervisor'],
                    tooltip: language === 'en'
                        ? 'Recipe engineering and ingredient portioning per menu item (Fichas técnicas y recetas teóricas)'
                        : 'Fichas técnicas y recetas con la porción exacta de cada ingrediente por platillo'
                },
                {
                    name: t('items.food_costs'),
                    plainName: 'Costos (Legacy)',
                    path: '/inventory/costs',
                    icon: <TrendingUp size={20} />,
                    roles: ['admin', 'manager'],
                    tooltip: language === 'en'
                        ? 'Legacy dish cost analysis (Márgenes por platillo)'
                        : 'Análisis de costos y margen de ganancia por platillo del menú'
                },
            ]
        },
        {
            title: t('sidebar_nav.groups.equipo'),
            id: 'equipo',
            groupIcon: <Clock size={15} />,
            items: [
                {
                    name: t('items.schedules'),
                    plainName: 'Horarios de Tienda',
                    path: '/horarios',
                    icon: <Clock size={20} />,
                    roles: ['manager', 'supervisor', 'admin'],
                    tooltip: language === 'en'
                        ? 'Creation and publishing of weekly restaurant employee schedules (Programación semanal del personal)'
                        : 'Creación y publicación de horarios de trabajo semanales del restaurante'
                },
                {
                    name: t('items.planner'),
                    plainName: 'Planificador',
                    path: '/planificador',
                    icon: <Calendar size={20} />,
                    roles: ['manager', 'supervisor', 'admin', 'planificador'],
                    tooltip: language === 'en'
                        ? 'Weekly shift & demand planning, SPLH targets, and morning punch anomaly audit (Planificador de turnos y auditoría de ponchadas)'
                        : 'Planificación semanal de turnos por demanda, metas SPLH y auditoría matutina de ponchadas'
                },
                {
                    name: t('items.breaks_ai'),
                    plainName: 'Descansos',
                    path: '/descansos',
                    icon: <Zap size={20} />,
                    roles: ['manager', 'supervisor', 'admin'],
                    tooltip: language === 'en'
                        ? 'Smart meal break scheduling and labor compliance tracking (Programación de descansos y comidas según norma)'
                        : 'Programación inteligente y control de descansos/comidas según norma laboral'
                },
                {
                    name: (
                        <div className="flex items-center gap-2">
                            <span>{t('items.my_schedule')}</span>
                            <span className="text-[10px] bg-purple-100 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 border border-purple-300 dark:border-purple-700 px-1.5 py-0.5 rounded font-black tracking-widest">BETA</span>
                        </div>
                    ),
                    plainName: 'Mi Horario',
                    path: '/mis-horarios',
                    icon: <CalendarCheck size={20} />,
                    roles: ['asistente', 'manager', 'supervisor', 'admin'],
                    tooltip: language === 'en'
                        ? '[BETA - Testing] Individual view of assigned work shifts and attendance records (Consulta de turnos en pruebas)'
                        : '[BETA - En Pruebas] Consulta individual de turnos de trabajo asignados y registro de asistencias'
                },
                {
                    name: (
                        <div className="flex items-center gap-2">
                            <span>{t('items.self_scheduling')}</span>
                            <span className="text-[10px] bg-purple-100 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 border border-purple-300 dark:border-purple-700 px-1.5 py-0.5 rounded font-black tracking-widest">BETA</span>
                        </div>
                    ),
                    plainName: 'Auto-Schedule',
                    path: '/gestion/auto-schedule',
                    icon: <UserCog size={20} />,
                    roles: ['supervisor', 'admin'],
                    tooltip: language === 'en'
                        ? '[BETA - Testing] AI-powered automatic labor scheduling (Generador de turnos AI en pruebas)'
                        : '[BETA - En Pruebas] Generación automática de horarios óptimos mediante inteligencia artificial'
                },
            ]
        },
        {
            title: t('sidebar_nav.groups.finanzas'),
            id: 'finanzas',
            groupIcon: <BarChart3 size={15} />,
            items: [
                {
                    name: t('items.pnl') || 'P&L Multi-Sucursal',
                    plainName: 'P&L Multi-Sucursal',
                    path: '/admin/pnl',
                    icon: <BarChart3 size={20} />,
                    roles: ['admin'],
                    tooltip: language === 'en'
                        ? 'Multi-unit side-by-side Profit & Loss statement across all 15 stores with intercompany elimination'
                        : 'Estado de Resultados multi-sucursal lado a lado de las 15 tiendas con eliminación intercompañía'
                },
                {
                    name: 'Cohesion',
                    plainName: 'Cohesion',
                    path: '/contabilidad',
                    icon: <Calculator size={20} />,
                    roles: ['admin'],
                    badgeText: 'new',
                    tooltip: language === 'en'
                        ? 'Daily sales journal entries for QuickBooks — replaces Cohesion (Pólizas de ventas diarias)'
                        : 'Pólizas de ventas diarias para QuickBooks — reemplaza Cohesion ($450/mes)'
                },
                {
                    name: t('items.create_bills') || 'Crear Bills',
                    plainName: 'Crear Bills',
                    path: '/admin/crear-bills',
                    icon: <Receipt size={20} />,
                    roles: ['admin'],
                    badgeText: 'new',
                    tooltip: language === 'en'
                        ? 'Automatic synchronization and Bill creation from Warehouse Invoices in QuickBooks Online'
                        : 'Sincronización y creación automática de Bills desde Invoices de Bodega en QuickBooks'
                },
                {
                    name: t('items.conciliar_delivery') || 'Conciliar Delivery Plataformas',
                    plainName: 'Conciliar Delivery Plataformas',
                    path: '/admin/conciliar-delivery',
                    icon: <ShieldCheck size={20} />,
                    roles: ['admin', 'supervisor'],
                    badgeText: 'new',
                    tooltip: language === 'en'
                        ? 'Order-by-order reconciliation, bank payouts, Sales Tax rules, and disputes between Toast POS and DoorDash, Uber Eats & Grubhub'
                        : 'Conciliación orden por orden, cortes bancarios, Sales Tax y disputas entre Toast POS y DoorDash, Uber Eats y Grubhub'
                },
                {
                    name: t('items.external_accounting') || 'Contabilidad Externa',
                    plainName: 'Contabilidad Externa',
                    path: '/admin/contabilidad-externa',
                    icon: <DollarSign size={20} />,
                    roles: ['admin'],
                    badgeText: 'new',
                    tooltip: language === 'en'
                        ? 'Exclusive module for Raquel, Roberto & Roque: 8 Companies, Checks, Deposits, Inflows, Outflows & CPA Reports'
                        : 'Módulo exclusivo Raquel, Roberto y Roque: 8 Empresas, Cheques, Depósitos, Entradas, Salidas y Reportes para Contadora'
                },
                {
                    name: 'RONOS',
                    plainName: 'RONOS',
                    path: '/admin/ronos',
                    icon: <Clock size={20} />,
                    roles: ['admin'],
                    badgeIcon: <HazardTapeIcon size={16} />,
                    tooltip: language === 'en'
                        ? 'Live timecard audit, time clock camera photos, meal penalty leakage & 15-store compliance (Auditoría de ponchadas, fotos y multas Cingular HR)'
                        : 'Auditoría en vivo de ponchadas, fotos de reloj checador, penalizaciones de lunch y cumplimiento Cingular HR'
                },
                {
                    name: t('items.miles') || 'MilesIQ',
                    plainName: 'MilesIQ',
                    path: '/miles',
                    icon: <Car size={20} />,
                    roles: ['admin', 'supervisor'],
                    tooltip: language === 'en'
                        ? 'Supervisor mileage tracking, drive log, reimbursement calculation, and HR payroll dispatch'
                        : 'Control y cálculo de millas manejadas por supervisores, registro de viajes y despacho a RRHH'
                },
            ]
        },
        {
            title: t('sidebar_nav.groups.gestion'),
            id: 'gestion',
            groupIcon: <Shield size={15} />,
            items: [
                {
                    name: t('items.stores'),
                    plainName: 'Tiendas',
                    path: '/tiendas',
                    icon: <Store size={20} />,
                    roles: ['admin'],
                    tooltip: language === 'en'
                        ? 'Master setup and location data for all Tacos Gavilan stores (Datos maestros de sucursales)'
                        : 'Configuración y datos maestros de las sucursales de Tacos Gavilan'
                },
                {
                    name: t('items.users'),
                    plainName: 'Usuarios',
                    path: '/usuarios',
                    icon: <Users size={20} />,
                    roles: ['admin', 'supervisor'],
                    tooltip: language === 'en'
                        ? 'User accounts, access roles, and store assignment administration (Gestión de usuarios y permisos)'
                        : 'Administración de usuarios, contraseñas y permisos por rol'
                },
                {
                    name: t('items.templates'),
                    plainName: 'Plantillas Checklists',
                    path: '/admin/plantillas',
                    icon: <FileEdit size={20} />,
                    roles: ['admin'],
                    tooltip: language === 'en'
                        ? 'Design and editing of templates for operational checklists (Creador de plantillas)'
                        : 'Diseño y edición de plantillas para listas de verificación operativas'
                },
                {
                    name: t('items.tv_menus'),
                    plainName: 'TV Menús',
                    path: '/admin/tv-menus',
                    icon: <Monitor size={20} />,
                    roles: ['admin', 'supervisor'],
                    tooltip: language === 'en'
                        ? 'Digital menu board content, pricing, and display management (Gestión de pantallas de menú)'
                        : 'Gestión de contenidos y precios en pantallas digitales de menú en tienda'
                },
                {
                    name: t('items.kiosk_feedback'),
                    plainName: 'Kiosk Feedback',
                    path: '/clientes',
                    icon: <QrCode size={20} />,
                    roles: ['admin', 'manager', 'supervisor'],
                    tooltip: language === 'en'
                        ? 'In-store customer satisfaction survey kiosk setup (Configuración de pantallas de opinión)'
                        : 'Configuración de pantallas de encuestas de satisfacción del cliente en comedor'
                },
                {
                    name: t('items.new_website') || (language === 'en' ? 'Website' : 'Sitio Web'),
                    plainName: language === 'en' ? 'Website' : 'Sitio Web',
                    path: '/nueva-web',
                    icon: <Globe size={20} />,
                    roles: ['asistente', 'manager', 'supervisor', 'admin'],
                    tooltip: language === 'en'
                        ? 'Tacos Gavilan official website traffic, order conversions, and live preview (tacosgavilan.com)'
                        : 'Tráfico, conversiones de órdenes y vista en vivo del Sitio Web oficial de Tacos Gavilan (tacosgavilan.com)'
                },
                {
                    name: t('items.customer_app') || (language === 'en' ? 'Customer App' : 'App Clientes'),
                    plainName: 'App Clientes',
                    path: '/app',
                    icon: <Smartphone size={20} />,
                    roles: ['asistente', 'manager', 'supervisor', 'admin'],
                    openInNewTab: true,
                    badgeIcon: <HazardTapeIcon size={16} />,
                    tooltip: language === 'en'
                        ? 'Opens in a new tab: Customer mobile ordering app preview and menu consultation (App móvil de pedidos y consulta para clientes)'
                        : 'Abre en nueva pestaña: Consulta y vista previa de la app móvil de pedidos para clientes'
                },
                {
                    name: t('items.gavilan_pos') || 'Gavilan POS',
                    plainName: 'Gavilan POS',
                    path: '/gavilan-pos',
                    icon: <Monitor size={20} />,
                    roles: ['admin', 'supervisor', 'manager'],
                    openInNewTab: true,
                    badgeIcon: <HazardTapeIcon size={16} />,
                    tooltip: language === 'en'
                        ? 'Opens in a new tab: Next-Gen Gavilan POS Cloud & Terminal Ecosystem (Menus, KDS HDMI, ESC/POS Tickets, EBT RMP & Direct Delivery)'
                        : 'Abre en nueva pestaña: Ecosistema Gavilan POS & KDS (Menús, KDS HDMI, Tickets ESC/POS, EBT RMP y Delivery Directo)'
                },
                {
                    name: t('items.activity_reports') || 'Reporte de Actividades',
                    plainName: 'Reporte de Actividades',
                    path: '/admin/reporte-actividades',
                    icon: <TrendingUp size={20} />,
                    roles: ['admin'],
                    tooltip: language === 'en'
                        ? 'Interactive executive report of monthly roadmaps, audited dev hours, and Gantt schedules (Septiembre, Agosto, Julio, Junio)'
                        : 'Consulta ejecutiva de bitácora de desarrollo, horas trabajadas y cronograma Gantt 24h (Septiembre, Agosto, Julio, Junio)'
                },
                {
                    name: t('items.system_health'),
                    plainName: 'Salud del Sistema',
                    path: '/admin/salud-sistema',
                    icon: <Shield size={20} />,
                    roles: ['admin'],
                    tooltip: language === 'en'
                        ? 'Real-time infrastructure health, Supabase disk vs 8GB spend cap, and automated email alerts (Guardián del Sistema)'
                        : 'Monitoreo en tiempo real de infraestructura, almacenamiento vs Spend Cap y alertas automáticas por correo'
                },
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
        const userEmailNorm = (user?.email || '').trim().toLowerCase()
        const isPlanificadorOnly = userEmailNorm === 'stephany@cingularhr.com' || user?.role?.toLowerCase() === 'planificador'
        const canAccessExternalAccounting =
            ['raquel@tacosgavilan.com', 'roberto@tacosgavilan.com', 'roque@tacosgavilan.com'].includes(userEmailNorm) &&
            [45, 46, 47].includes(Number(user?.id))
        return menuGroups.map(group => {
            if (isVikesh && (group.id === 'inventario' || group.id === 'food_cost')) {
                return { ...group, items: [] }
            }
            const validItems = group.items.filter(item => {
                if (item.path === '/admin/contabilidad-externa') return canAccessExternalAccounting
                if (isPlanificadorOnly) return item.path === '/planificador'
                if (isVikesh && (item.path === '/ventas' || item.path === '/ventas/reportes')) return false
                if (!item.roles || item.roles.length === 0) return true
                const userRole = (user?.role || user?.user_type || '').toLowerCase()
                if (!userRole) return false
                return item.roles.includes(userRole)
            })
            return { ...group, items: validItems }
        }).filter(group => group.items.length > 0)
    }, [user, language])

    const allMenuPaths = useMemo(
        () => filteredGroups.flatMap(g => g.items.map(i => i.path)),
        [filteredGroups]
    )

    const canViewDashboard = useMemo(
        () => filteredGroups.some(g => g.items.some(i => i.path === '/dashboard')),
        [filteredGroups]
    )

    const normalizedSearch = useMemo(() => normalizeSidebarText(sidebarSearch), [sidebarSearch])
    const isSearching = normalizedSearch.length > 0

    const displayedGroups = useMemo(() => {
        if (!normalizedSearch) return filteredGroups
        return filteredGroups
            .map(group => {
                if (normalizeSidebarText(group.title).includes(normalizedSearch)) {
                    return group
                }
                const matchingItems = group.items.filter(item => {
                    const searchable = [
                        typeof item.name === 'string' ? item.name : '',
                        item.plainName || '',
                        item.tooltip || '',
                        item.path,
                        ...(item.subItems?.map(sub => `${sub.name} ${sub.path}`) || []),
                    ].join(' ')
                    return normalizeSidebarText(searchable).includes(normalizedSearch)
                })
                return { ...group, items: matchingItems }
            })
            .filter(group => group.items.length > 0)
    }, [filteredGroups, normalizedSearch])

    const activeRouteGroupId = useMemo(() => {
        if (!pathname || pathname === '/inicio') return null
        return (
            filteredGroups.find(g =>
                g.items.some(item => isSidebarItemActive(item, pathname, allMenuPaths))
            )?.id ?? null
        )
    }, [pathname, filteredGroups, allMenuPaths])

    const effectiveExpandedGroups = useMemo(() => {
        if (groupOverrides.path === pathname) {
            return groupOverrides.groups
        }
        return activeRouteGroupId ? { [activeRouteGroupId]: true } : {}
    }, [groupOverrides, pathname, activeRouteGroupId])

    const areAllGroupsOpen = useMemo(
        () => filteredGroups.length > 0 && filteredGroups.every(g => Boolean(effectiveExpandedGroups[g.id])),
        [filteredGroups, effectiveExpandedGroups]
    )

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

    // Smoothly scroll the active module into view after the accordion animation settles
    useEffect(() => {
        if (!pathname || pathname === '/inicio' || isSearching) return

        const scrollActiveIntoView = (navEl: HTMLElement | null) => {
            if (!navEl) return
            const activeItem = navEl.querySelector<HTMLElement>('[data-active-nav-item="true"]')
            if (!activeItem) return

            const navRect = navEl.getBoundingClientRect()
            const itemRect = activeItem.getBoundingClientRect()
            if (navRect.height <= 0) return

            const relativeTop = itemRect.top - navRect.top
            const relativeBottom = itemRect.bottom - navRect.top
            const padding = 48

            if (relativeTop < padding || relativeBottom > navRect.height - padding) {
                const targetTop = navEl.scrollTop + relativeTop - navRect.height / 2 + itemRect.height / 2
                navEl.scrollTo({
                    top: Math.max(0, targetTop),
                    behavior: 'smooth',
                })
            }
        }

        const timer = setTimeout(() => {
            scrollActiveIntoView(desktopNavRef.current)
            if (mobileDrawerOpen) {
                scrollActiveIntoView(mobileNavRef.current)
            }
        }, 240)

        return () => clearTimeout(timer)
    }, [pathname, filteredGroups, isCollapsed, mobileDrawerOpen, isSearching])

    // Accordion toggle: opening one category collapses the others cleanly
    const toggleGroup = (groupId: string) => {
        const isCurrentlyOpen = Boolean(effectiveExpandedGroups[groupId])
        setGroupOverrides({
            path: pathname,
            groups: isCurrentlyOpen ? {} : { [groupId]: true },
        })
    }

    const toggleAllGroups = () => {
        setGroupOverrides({
            path: pathname,
            groups: areAllGroupsOpen ? {} : Object.fromEntries(filteredGroups.map(g => [g.id, true])),
        })
    }

    // Render a single nav item
    const renderNavItem = (item: MenuItem, groupId: string, isMobile: boolean = false) => {
        const isActive = isSidebarItemActive(item, pathname, allMenuPaths)
        const colors = GROUP_COLORS[groupId] || GROUP_COLORS.operaciones
        const isBuildingBadge = item.path === '/admin/mantenimiento' || item.path === '/admin/ronos' || item.path === '/app' || item.path === '/gavilan-pos' || Boolean(item.badgeIcon)
        const hasNewBadge = item.badgeText === 'new' || item.path === '/basecamp' || item.path === '/admin/compras/viele' || item.path === '/order-ready-board' || item.path === '/nueva-web' || item.path === '/admin/blindaje-delivery' || item.path === '/admin/crear-bills' || item.path === '/contabilidad'
        const badgeText = item.badgeText || (hasNewBadge ? 'new' : null)
        const labelStr = typeof item.name === 'string' ? item.name : (item.plainName || '')
        const badgePosition = item.badgePosition || (isBuildingBadge && labelStr.length > 22 ? 'below' : 'inline')
        const badgeIcon = item.badgeIcon || (isBuildingBadge ? <HazardTapeIcon size={14} /> : null)
        const hasAnyBadge = Boolean(badgeText || badgeIcon)
        const badgeBubbleClass = isBuildingBadge
            ? 'bg-amber-500/20 dark:bg-amber-500/25 border-amber-500/40 text-amber-900 dark:text-amber-200 px-1.5 py-1'
            : 'bg-blue-600 dark:bg-blue-500 border-blue-400/30 text-white text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5'

        if (item.subItems && item.subItems.length > 0) {
            const isSubOpen = Boolean(expandedSubItems[item.path])
            return (
                <div key={item.path} className="space-y-1">
                    <button
                        type="button"
                        data-active-nav-item={isActive ? 'true' : undefined}
                        onClick={() => {
                            if (isCollapsed && !isMobile) {
                                setIsCollapsed(false)
                                setExpandedSubItems(prev => ({ ...prev, [item.path]: true }))
                            } else {
                                setExpandedSubItems(prev => ({ ...prev, [item.path]: !prev[item.path] }))
                            }
                        }}
                        title={item.tooltip || (typeof item.name === 'string' ? item.name : item.plainName) || ''}
                        className={`w-full group/item relative flex items-center gap-2.5 rounded-lg border-l-[3px] transition-all duration-200 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30 ${
                            isMobile ? 'px-2.5 py-2.5 text-[14px]' : 'px-2.5 py-2 text-[13px]'
                        } ${
                            isActive || isSubOpen
                                ? `${colors.activeBg} ${colors.activeBorder} font-semibold text-slate-900 dark:text-white`
                                : 'border-l-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200'
                        } ${isCollapsed && !isMobile ? 'justify-center px-2' : ''}`}
                    >
                        <div className={`flex-shrink-0 transition-transform duration-200 ${
                            isMobile
                                ? `w-8 h-8 rounded-xl border flex items-center justify-center ${
                                    isActive || isSubOpen
                                        ? colors.headerIconBox
                                        : 'bg-slate-100/80 dark:bg-slate-800/80 border-slate-200/70 dark:border-slate-700/60'
                                }`
                                : ''
                        } ${
                            isActive || isSubOpen ? `${colors.icon} ${isMobile ? '' : 'scale-105'}` : `${colors.icon} opacity-80 group-hover/item:opacity-100`
                        }`}>
                            {React.isValidElement<{ size?: number; strokeWidth?: number }>(item.icon) && typeof item.icon.type !== 'string'
                                ? React.cloneElement(item.icon, { size: isMobile ? 20 : 17, strokeWidth: isActive || isSubOpen ? 2.4 : 2 })
                                : item.icon}
                        </div>
                        {(!isCollapsed || isMobile) ? (
                            <div className="flex flex-col min-w-0 flex-1 text-left">
                                <div className="flex items-center justify-between w-full min-w-0 gap-1.5">
                                    {typeof item.name === 'string' ? (
                                        <span className="line-clamp-2 leading-snug break-words">{item.name}</span>
                                    ) : (
                                        <span className="min-w-0 leading-snug">{item.name}</span>
                                    )}
                                    <div className="flex items-center gap-1.5 ml-1.5 shrink-0">
                                        {hasAnyBadge && badgePosition === 'inline' && (
                                            <span className={`new-badge-animated ${badgeBubbleClass} rounded shadow-sm shrink-0 inline-flex items-center gap-1.5 border leading-none`}>
                                                {badgeIcon}
                                                {badgeText && <span>{badgeText}</span>}
                                            </span>
                                        )}
                                        <ChevronDown size={13} className={`text-slate-400 transition-transform duration-200 ${isSubOpen ? 'rotate-180 text-amber-500' : ''}`} />
                                    </div>
                                </div>
                            </div>
                        ) : (
                            hasAnyBadge && (
                                <span className={`absolute top-1.5 right-1.5 w-2 h-2 ${hasNewBadge ? 'bg-blue-500' : 'bg-amber-500'} rounded-full shadow-sm animate-ping new-badge-animated`} />
                            )
                        )}
                    </button>
                    <AnimatePresence initial={false}>
                        {isSubOpen && (!isCollapsed || isMobile) && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.18 }}
                                className="overflow-hidden pl-7 pr-1 space-y-1"
                            >
                                {item.subItems.map((sub) => {
                                    const isV2 = sub.path.includes('v=2')
                                    return (
                                        <Link
                                            key={sub.path}
                                            href={sub.path}
                                            target={sub.openInNewTab ? '_blank' : undefined}
                                            rel={sub.openInNewTab ? 'noopener noreferrer' : undefined}
                                            onClick={() => {
                                                if (isMobile) setMobileDrawerOpen(false)
                                            }}
                                            title={sub.tooltip || sub.name}
                                            className={`group/sub flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all border ${
                                                isV2
                                                    ? 'bg-gradient-to-r from-[#50050a]/10 to-amber-500/10 dark:from-[#50050a]/40 dark:to-amber-500/15 border-amber-500/40 text-slate-900 dark:text-amber-100 hover:border-amber-500'
                                                    : 'bg-slate-50/70 dark:bg-slate-900/50 border-slate-200/70 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                                            }`}
                                        >
                                            <span className="truncate flex items-center gap-1.5">
                                                <span className={`w-1.5 h-1.5 rounded-full ${isV2 ? 'bg-amber-500 animate-pulse' : 'bg-slate-400'}`} />
                                                {sub.name}
                                            </span>
                                            <span className="flex items-center gap-1 shrink-0">
                                                {sub.badgeText && (
                                                    <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${
                                                        isV2
                                                            ? 'bg-gradient-to-r from-[#50050a] to-red-700 text-[#FDC82F] border border-[#FDC82F]/50 shadow-xs'
                                                            : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                                                    }`}>
                                                        {sub.badgeText}
                                                    </span>
                                                )}
                                                {sub.openInNewTab && (
                                                    <ExternalLink size={10} className="text-slate-400 group-hover/sub:text-amber-500 transition-colors" />
                                                )}
                                            </span>
                                        </Link>
                                    )
                                })}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            )
        }

        return (
            <Link
                key={item.path}
                href={item.path}
                data-active-nav-item={isActive ? 'true' : undefined}
                target={item.openInNewTab ? '_blank' : undefined}
                rel={item.openInNewTab ? 'noopener noreferrer' : undefined}
                onClick={() => {
                    if (isMobile) setMobileDrawerOpen(false)
                    if (pathname === '/inicio' && !isMobile && !item.openInNewTab) setIsCollapsed(false)
                    if (!item.openInNewTab) setSidebarSearch('')
                }}
                title={item.tooltip || (typeof item.name === 'string' ? item.name : item.plainName) || ''}
                className={`group/item relative flex items-center gap-2.5 rounded-lg border-l-[3px] transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30 ${
                    isMobile ? 'px-2.5 py-2.5 text-[14px]' : 'px-2.5 py-2 text-[13px]'
                } ${
                    isActive
                        ? `${colors.activeBg} ${colors.activeBorder} font-semibold text-slate-900 dark:text-white`
                        : 'border-l-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200'
                } ${isCollapsed && !isMobile ? 'justify-center px-2' : ''}`}
            >
                <div className={`flex-shrink-0 transition-transform duration-200 ${
                    isMobile
                        ? `w-8 h-8 rounded-xl border flex items-center justify-center ${
                            isActive
                                ? colors.headerIconBox
                                : 'bg-slate-100/80 dark:bg-slate-800/80 border-slate-200/70 dark:border-slate-700/60'
                        }`
                        : ''
                } ${
                    isActive ? `${colors.icon} ${isMobile ? '' : 'scale-105'}` : `${colors.icon} opacity-80 group-hover/item:opacity-100`
                }`}>
                    {React.isValidElement<{ size?: number; strokeWidth?: number }>(item.icon) && typeof item.icon.type !== 'string'
                        ? React.cloneElement(item.icon, { size: isMobile ? 20 : 17, strokeWidth: isActive ? 2.4 : 2 })
                        : item.icon}
                </div>
                {(!isCollapsed || isMobile) ? (
                    <div className="flex flex-col min-w-0 flex-1">
                        <div className="flex items-center justify-between w-full min-w-0 gap-1.5">
                            {typeof item.name === 'string' ? (
                                <span className="line-clamp-2 leading-snug break-words">{item.name}</span>
                            ) : (
                                <span className="min-w-0 leading-snug">{item.name}</span>
                            )}
                            <div className="flex items-center gap-1 ml-1.5 shrink-0">
                                {item.openInNewTab && (
                                    <ExternalLink size={11} className="text-slate-400 group-hover/item:text-blue-600 transition-colors" />
                                )}
                                {hasAnyBadge && badgePosition === 'inline' && (
                                    <span className={`new-badge-animated ${badgeBubbleClass} rounded shadow-sm shrink-0 inline-flex items-center gap-1.5 border leading-none`}>
                                        {badgeIcon}
                                        {badgeText && <span>{badgeText}</span>}
                                    </span>
                                )}
                            </div>
                        </div>
                        {hasAnyBadge && badgePosition === 'below' && (
                            <div className="flex items-center mt-1">
                                <span className={`new-badge-animated ${badgeBubbleClass} rounded shadow-sm inline-flex items-center gap-1.5 border leading-none`}>
                                    {badgeIcon}
                                    {badgeText && <span>{badgeText}</span>}
                                </span>
                            </div>
                        )}
                    </div>
                ) : (
                    hasAnyBadge && (
                        <span className={`absolute top-1.5 right-1.5 w-2 h-2 ${hasNewBadge ? 'bg-blue-500' : 'bg-amber-500'} rounded-full shadow-sm animate-ping new-badge-animated`} />
                    )
                )}

            </Link>
        )
    }

    // Shared nav content
    const renderNavContent = (isMobile: boolean = false) => {
        const showExpanded = !isCollapsed || isMobile
        const groupsToRender = showExpanded ? displayedGroups : filteredGroups

        return (
            <div className="flex-1 min-h-0 flex flex-col">
                {showExpanded && (
                    <div className="flex-shrink-0 px-2.5 pt-2.5 pb-2 space-y-2 border-b border-slate-100 dark:border-slate-800/80">
                        {/* Quick Pinned Shortcuts: Inicio & Dashboard */}
                        <div className={`grid gap-1.5 ${canViewDashboard ? 'grid-cols-2' : 'grid-cols-1'}`}>
                            <Link
                                href="/inicio"
                                onClick={() => {
                                    if (isMobile) setMobileDrawerOpen(false)
                                    setSidebarSearch('')
                                }}
                                className={`flex items-center justify-center gap-1.5 px-2.5 rounded-lg border font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30 ${
                                    isMobile ? 'py-2 text-[13px]' : 'py-1.5 text-xs'
                                } ${
                                    pathname === '/inicio'
                                        ? 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800/70 text-red-700 dark:text-red-300 shadow-2xs'
                                        : 'bg-slate-50/80 dark:bg-slate-900/60 border-slate-200/80 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                                }`}
                            >
                                <LayoutGrid size={isMobile ? 16 : 13.5} className={pathname === '/inicio' ? 'text-red-600 dark:text-red-400' : 'text-slate-400'} />
                                <span className="truncate">{t('sidebar_nav.quick_home')}</span>
                            </Link>
                            {canViewDashboard && (
                                <Link
                                    href="/dashboard"
                                    onClick={() => {
                                        if (isMobile) setMobileDrawerOpen(false)
                                        if (pathname === '/inicio' && !isMobile) setIsCollapsed(false)
                                        setSidebarSearch('')
                                    }}
                                    className={`flex items-center justify-center gap-1.5 px-2.5 rounded-lg border font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30 ${
                                        isMobile ? 'py-2 text-[13px]' : 'py-1.5 text-xs'
                                    } ${
                                        pathname === '/dashboard'
                                            ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/70 text-rose-700 dark:text-rose-300 shadow-2xs'
                                            : 'bg-slate-50/80 dark:bg-slate-900/60 border-slate-200/80 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                                    }`}
                                >
                                    <LayoutDashboard size={isMobile ? 16 : 13.5} className={pathname === '/dashboard' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400'} />
                                    <span className="truncate">{t('sidebar_nav.quick_dashboard')}</span>
                                </Link>
                            )}
                        </div>

                        {/* Instant Search & Expand/Collapse All */}
                        <div className="flex items-center gap-1.5">
                            <div className="relative flex-1 min-w-0">
                                <Search size={13.5} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    ref={!isMobile ? searchInputRef : undefined}
                                    type="text"
                                    value={sidebarSearch}
                                    onChange={(e) => setSidebarSearch(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Escape') setSidebarSearch('')
                                    }}
                                    placeholder={t('sidebar_nav.search_placeholder')}
                                    aria-label={t('sidebar_nav.search_placeholder')}
                                    className="w-full h-8 pl-8 pr-7 rounded-lg text-xs bg-slate-50 dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-800 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:bg-white dark:focus:bg-slate-900 focus:border-slate-300 dark:focus:border-slate-600 focus:ring-2 focus:ring-red-500/15 transition-all"
                                />
                                {sidebarSearch.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => setSidebarSearch('')}
                                        title={t('sidebar_nav.clear_search')}
                                        aria-label={t('sidebar_nav.clear_search')}
                                        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer focus:outline-none"
                                    >
                                        <X size={12} />
                                    </button>
                                )}
                            </div>
                            <button
                                type="button"
                                onClick={toggleAllGroups}
                                title={areAllGroupsOpen ? t('sidebar_nav.collapse_all') : t('sidebar_nav.expand_all')}
                                aria-label={areAllGroupsOpen ? t('sidebar_nav.collapse_all') : t('sidebar_nav.expand_all')}
                                className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30"
                            >
                                {areAllGroupsOpen ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
                            </button>
                        </div>
                    </div>
                )}

                <nav
                    ref={isMobile ? mobileNavRef : desktopNavRef}
                    className={`flex-1 min-h-0 px-2.5 py-2.5 overflow-y-auto overflow-x-hidden no-scrollbar ${showExpanded ? 'space-y-2' : 'space-y-1'}`}
                >
                    {showExpanded && isSearching && groupsToRender.length === 0 ? (
                        <div className="px-3 py-8 text-center rounded-xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30">
                            <Search size={20} className="mx-auto text-slate-300 dark:text-slate-600 mb-2" />
                            <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                                {t('sidebar_nav.no_results')}
                            </p>
                            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                                {t('sidebar_nav.no_results_hint')}
                            </p>
                            <button
                                type="button"
                                onClick={() => setSidebarSearch('')}
                                className="mt-3 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-400 transition-colors cursor-pointer focus:outline-none"
                            >
                                {t('sidebar_nav.clear_search')}
                            </button>
                        </div>
                    ) : (
                        groupsToRender.map((group) => {
                            const colors = GROUP_COLORS[group.id] || GROUP_COLORS.operaciones
                            const isOpen = isSearching ? true : Boolean(effectiveExpandedGroups[group.id])
                            const hasActiveItem = group.items.some(item => isSidebarItemActive(item, pathname, allMenuPaths))

                            if (!showExpanded) {
                                return (
                                    <div key={group.id} className="pb-1">
                                        <div className="h-px bg-slate-200/80 dark:bg-slate-800 my-1.5 mx-2" />
                                        <div className="space-y-0.5">
                                            {group.items.map(item => renderNavItem(item, group.id, isMobile))}
                                        </div>
                                    </div>
                                )
                            }

                            return (
                                <div key={group.id}>
                                    {/* Interactive Department Category Card Header */}
                                    <button
                                        type="button"
                                        aria-expanded={isOpen}
                                        onClick={() => toggleGroup(group.id)}
                                        className={`w-full group/hdr flex items-center gap-2.5 rounded-xl border text-left transition-all duration-200 cursor-pointer select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30 ${
                                            isMobile ? 'px-3 py-2.5' : 'px-2.5 py-2'
                                        } ${
                                            isOpen
                                                ? colors.headerOpenCard
                                                : hasActiveItem
                                                    ? colors.headerActiveClosed
                                                    : 'bg-slate-50/70 dark:bg-slate-900/40 hover:bg-slate-100/80 dark:hover:bg-slate-800/70 border-slate-200/70 dark:border-slate-800/80 hover:border-slate-300/80 dark:hover:border-slate-700'
                                        }`}
                                    >
                                        <div className={`border flex items-center justify-center shrink-0 transition-transform duration-200 group-hover/hdr:scale-105 ${
                                            isMobile ? 'w-9 h-9 rounded-xl' : 'w-7 h-7 rounded-lg'
                                        } ${colors.headerIconBox}`}>
                                            {React.isValidElement<{ size?: number; strokeWidth?: number }>(group.groupIcon)
                                                ? React.cloneElement(group.groupIcon, { size: isMobile ? 19 : 15, strokeWidth: 2.2 })
                                                : group.groupIcon}
                                        </div>
                                        <span className={`flex-1 min-w-0 font-semibold tracking-tight truncate ${
                                            isMobile ? 'text-[13.5px]' : 'text-[12.5px]'
                                        } ${
                                            isOpen || hasActiveItem
                                                ? 'text-slate-900 dark:text-white'
                                                : 'text-slate-700 dark:text-slate-200'
                                        }`}>
                                            {group.title}
                                        </span>
                                        <div className="flex items-center gap-1.5 shrink-0">
                                            {!isOpen && hasActiveItem && (
                                                <span
                                                    className={`w-2 h-2 rounded-full ${colors.dot}`}
                                                    title={t('sidebar_nav.active_here')}
                                                />
                                            )}
                                            <span className={`text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-md border ${
                                                isOpen || hasActiveItem
                                                    ? colors.countActive
                                                    : 'bg-white/80 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 border-slate-200/70 dark:border-slate-700/70'
                                            }`}>
                                                {group.items.length}
                                            </span>
                                            <ChevronRight
                                                size={isMobile ? 16 : 14}
                                                className={`text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-90 text-slate-600 dark:text-slate-300' : ''}`}
                                            />
                                        </div>
                                    </button>

                                    {/* Smooth Accordion Group Items */}
                                    <AnimatePresence initial={false}>
                                        {isOpen && (
                                            <motion.div
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: 'auto', opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                transition={{ duration: 0.18, ease: 'easeInOut' }}
                                                className="overflow-hidden"
                                            >
                                                <div className={`border-l-2 ${colors.treeLine} space-y-0.5 pt-1.5 pb-1 ${isMobile ? 'ml-[18px] pl-3' : 'ml-3.5 pl-2.5'}`}>
                                                    {group.items.map(item => renderNavItem(item, group.id, isMobile))}
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            )
                        })
                    )}
                </nav>
            </div>
        )
    }

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
                            href="/inicio"
                            onClick={() => setUserDropdownOpen(false)}
                            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors"
                        >
                            <Layers size={15} className="text-red-500" />
                            {t('items.home_hub')}
                        </Link>
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
                            onClick={() => {
                                setUserDropdownOpen(false)
                                if (pathname === '/inicio') setIsCollapsed(false)
                            }}
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

                    {/* ── App Info & Version Counter (Click to open Changelog Modal) ── */}
                    <button
                        type="button"
                        onClick={() => {
                            setChangelogOpen(true)
                            setUserDropdownOpen(false)
                        }}
                        className="w-full text-left px-3 py-2 my-1 mx-1 rounded-xl bg-gradient-to-r from-emerald-50 via-teal-50/70 to-emerald-50 dark:from-emerald-950/50 dark:via-teal-950/30 dark:to-emerald-950/50 border border-emerald-300/80 dark:border-emerald-700/70 flex items-center justify-between shadow-xs hover:border-emerald-400 dark:hover:border-emerald-500 hover:shadow-sm transition-all cursor-pointer group"
                        title={t('changelog.view_history')}
                    >
                        <div className="flex items-center gap-2">
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                            </span>
                            <div className="flex flex-col">
                                <span className="text-[11px] font-black text-emerald-900 dark:text-emerald-200 tracking-tight flex items-center gap-1.5">
                                    {SYSTEM_VERSION.brand}
                                    <span className="px-1.5 py-0.2 bg-emerald-600 text-white dark:bg-emerald-500 dark:text-slate-950 rounded-md text-[9px] font-mono font-black shadow-xs group-hover:scale-105 transition-transform">
                                        {SYSTEM_VERSION.version}
                                    </span>
                                </span>
                                <span className="text-[9px] font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                                    {language === 'es' ? SYSTEM_VERSION.labelEs : SYSTEM_VERSION.labelEn}
                                    <Sparkles className="w-2.5 h-2.5 opacity-60 group-hover:opacity-100 transition-opacity" />
                                </span>
                            </div>
                        </div>
                        <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-md bg-white/90 dark:bg-slate-900/90 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 shadow-2xs group-hover:bg-emerald-100 dark:group-hover:bg-emerald-900/50 transition-colors">
                            {SYSTEM_VERSION.year}
                        </span>
                    </button>

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
            <style>{`
                @keyframes basecamp-pulse {
                    0% { transform: scale(1); filter: drop-shadow(0 0 0 rgba(29, 125, 181, 0)); }
                    50% { transform: scale(1.02); filter: drop-shadow(0 0 6px rgba(29, 125, 181, 0.3)); }
                    100% { transform: scale(1); filter: drop-shadow(0 0 0 rgba(29, 125, 181, 0)); }
                }
                @keyframes basecamp-icon-pulse {
                    0% { transform: scale(1); }
                    50% { transform: scale(1.1) rotate(2deg); }
                    100% { transform: scale(1); }
                }
                @keyframes new-badge-pulse {
                    0%, 100% { opacity: 0.95; transform: scale(1); }
                    50% { opacity: 1; transform: scale(1.08); }
                }
                .basecamp-animated-item {
                    animation: basecamp-pulse 2.5s infinite ease-in-out;
                    border-left-color: rgba(29, 125, 181, 0.7) !important;
                    background: rgba(29, 125, 181, 0.05) !important;
                }
                .basecamp-animated-item-active {
                    animation: basecamp-pulse 2.5s infinite ease-in-out;
                }
                .basecamp-animated-icon {
                    animation: basecamp-icon-pulse 2.5s infinite ease-in-out;
                    color: #1d7db5 !important;
                }
                .new-badge-animated {
                    animation: new-badge-pulse 1.5s infinite ease-in-out;
                }
            `}</style>
            {/* ============ DESKTOP SIDEBAR ============ */}
            <aside
                className={`hidden lg:flex flex-col fixed inset-y-0 left-0 z-40 bg-white dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 transition-all duration-300 ease-in-out overflow-visible ${
                    isCollapsed ? 'w-[64px]' : 'w-[276px]'
                }`}
            >
                {/* Logo Section — Clicking SM TEG returns to /inicio and collapses sidebar */}
                <div className={`flex-shrink-0 h-16 border-b border-slate-100 dark:border-slate-800/80 flex items-center ${
                    isCollapsed ? 'justify-center px-2' : 'justify-between px-3.5 gap-2'
                }`}>
                    <Link
                        href="/inicio"
                        onClick={() => setIsCollapsed(true)}
                        title={t('items.home_hub')}
                        className={`flex items-center gap-2.5 group min-w-0 rounded-lg py-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30 ${
                            isCollapsed ? 'justify-center' : 'flex-1'
                        }`}
                    >
                        <div className="flex-shrink-0 w-9 h-9 relative">
                            <img
                                src="/logo.png"
                                alt="TEG Logo"
                                className="w-full h-full object-contain drop-shadow-md transition-transform group-hover:scale-110"
                            />
                        </div>
                        {!isCollapsed && (
                            <div className="flex flex-col leading-tight min-w-0">
                                <span className="text-base font-black tracking-tight text-slate-900 dark:text-white group-hover:text-red-600 dark:group-hover:text-red-400 transition-colors truncate">
                                    SM<span className="text-red-600 font-semibold ml-0.5">TEG</span>
                                </span>
                                <span className="text-[10px] font-medium text-red-500 dark:text-red-400 tracking-wide truncate">
                                    {t('nav.title')}
                                </span>
                            </div>
                        )}
                    </Link>

                    {!isCollapsed && (
                        <button
                            type="button"
                            onClick={() => setIsCollapsed(true)}
                            title={t('sidebar_nav.collapse_sidebar')}
                            aria-label={t('sidebar_nav.collapse_sidebar')}
                            className="flex-shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30"
                        >
                            <PanelLeftClose size={16} />
                        </button>
                    )}
                </div>

                {/* Collapsed quick controls (Expand + Search shortcut) */}
                {isCollapsed && (
                    <div className="flex-shrink-0 border-b border-slate-100 dark:border-slate-800/80 py-2 px-1.5 flex flex-col items-center gap-1">
                        <button
                            type="button"
                            onClick={() => setIsCollapsed(false)}
                            title={t('sidebar_nav.expand_sidebar')}
                            aria-label={t('sidebar_nav.expand_sidebar')}
                            className="w-10 h-9 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30"
                        >
                            <PanelLeft size={17} />
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setIsCollapsed(false)
                                setTimeout(() => searchInputRef.current?.focus(), 180)
                            }}
                            title={t('sidebar_nav.search_placeholder')}
                            aria-label={t('sidebar_nav.search_placeholder')}
                            className="w-10 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30"
                        >
                            <Search size={15} />
                        </button>
                    </div>
                )}

                {/* Navigation */}
                {renderNavContent(false)}

                {/* Desktop Footer: Compact System Version & Changelog */}
                <div className="flex-shrink-0 border-t border-slate-100 dark:border-slate-800/80 p-2">
                    <button
                        type="button"
                        onClick={() => setChangelogOpen(true)}
                        title={t('sidebar_nav.version_history')}
                        className={`w-full flex items-center rounded-xl border border-slate-200/70 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700 transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30 ${
                            isCollapsed ? 'justify-center p-2' : 'justify-between px-2.5 py-2'
                        }`}
                    >
                        <div className="flex items-center gap-2 min-w-0">
                            <span className="relative flex h-2 w-2 shrink-0">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                            </span>
                            {!isCollapsed && (
                                <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200 truncate">
                                    {SYSTEM_VERSION.brand}
                                </span>
                            )}
                        </div>
                        {!isCollapsed && (
                            <div className="flex items-center gap-1.5 shrink-0">
                                <span className="px-1.5 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/70 text-[10px] font-mono font-bold">
                                    {SYSTEM_VERSION.version}
                                </span>
                                <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                                    {SYSTEM_VERSION.year}
                                </span>
                            </div>
                        )}
                    </button>
                </div>

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
            <header className="lg:hidden fixed top-0 left-0 right-0 z-50 h-14 bg-white/85 dark:bg-slate-900/85 backdrop-blur-xl border-b border-slate-200/70 dark:border-slate-800/70 flex items-center justify-between px-2.5">
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setMobileDrawerOpen(true)}
                        aria-label={t('bottom_nav.open_menu')}
                        className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-100/90 dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700/80 text-slate-700 dark:text-slate-200 active:scale-95 transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30"
                    >
                        <Menu size={22} strokeWidth={2.3} />
                    </button>
                    <Link href="/inicio" onClick={() => setMobileDrawerOpen(false)} className="flex items-center gap-2 group">
                        <img src="/logo.png" alt="TEG" className="w-8 h-8 object-contain transition-transform group-hover:scale-110" />
                        <span className="text-[15px] font-black text-slate-900 dark:text-white">
                            SM<span className="text-red-600 font-semibold ml-0.5">TEG</span>
                        </span>
                    </Link>
                </div>

                <div className="flex items-center gap-1.5">
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
                        type="button"
                        onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                        className="ml-0.5 flex-shrink-0 w-9 h-9 rounded-full bg-gradient-to-tr from-red-500 to-orange-500 flex items-center justify-center text-white text-xs font-bold ring-2 ring-white dark:ring-slate-900 shadow-sm active:scale-95 transition-transform cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30"
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
                                <Link href="/inicio" onClick={() => setUserDropdownOpen(false)} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors">
                                    <Layers size={15} className="text-red-500" />
                                    {t('items.home_hub')}
                                </Link>
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

                            {/* ── App Info & Version Counter (Click to open Changelog Modal) ── */}
                            <button
                                type="button"
                                onClick={() => {
                                    setChangelogOpen(true)
                                    setUserDropdownOpen(false)
                                }}
                                className="w-full text-left px-3 py-2 my-1 mx-1 rounded-xl bg-gradient-to-r from-emerald-50 via-teal-50/70 to-emerald-50 dark:from-emerald-950/50 dark:via-teal-950/30 dark:to-emerald-950/50 border border-emerald-300/80 dark:border-emerald-700/70 flex items-center justify-between shadow-xs hover:border-emerald-400 dark:hover:border-emerald-500 hover:shadow-sm transition-all cursor-pointer group"
                                title={t('changelog.view_history')}
                            >
                                <div className="flex items-center gap-2">
                                    <span className="relative flex h-2 w-2">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                    </span>
                                    <div className="flex flex-col">
                                        <span className="text-[11px] font-black text-emerald-900 dark:text-emerald-200 tracking-tight flex items-center gap-1.5">
                                            {SYSTEM_VERSION.brand}
                                            <span className="px-1.5 py-0.2 bg-emerald-600 text-white dark:bg-emerald-500 dark:text-slate-950 rounded-md text-[9px] font-mono font-black shadow-xs group-hover:scale-105 transition-transform">
                                                {SYSTEM_VERSION.version}
                                            </span>
                                        </span>
                                        <span className="text-[9px] font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                                            {language === 'es' ? SYSTEM_VERSION.labelEs : SYSTEM_VERSION.labelEn}
                                            <Sparkles className="w-2.5 h-2.5 opacity-60 group-hover:opacity-100 transition-opacity" />
                                        </span>
                                    </div>
                                </div>
                                <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-md bg-white/90 dark:bg-slate-900/90 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 shadow-2xs group-hover:bg-emerald-100 dark:group-hover:bg-emerald-900/50 transition-colors">
                                    {SYSTEM_VERSION.year}
                                </span>
                            </button>

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
                            className="lg:hidden fixed inset-y-0 left-0 z-[80] w-[300px] max-w-[86vw] bg-white dark:bg-slate-950 shadow-2xl flex flex-col"
                        >
                            {/* Drawer Header */}
                            <div className="flex-shrink-0 h-14 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between px-4">
                                <Link
                                    href="/inicio"
                                    onClick={() => setMobileDrawerOpen(false)}
                                    className="flex items-center gap-2.5 group"
                                >
                                    <img src="/logo.png" alt="TEG" className="w-8 h-8 object-contain transition-transform group-hover:scale-110" />
                                    <span className="text-base font-black text-slate-900 dark:text-white group-hover:text-red-600 transition-colors">
                                        SM<span className="text-red-600 font-semibold ml-0.5">TEG</span>
                                    </span>
                                </Link>
                                <button
                                    type="button"
                                    onClick={() => setMobileDrawerOpen(false)}
                                    className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-300 flex items-center justify-center transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30"
                                >
                                    <X size={20} strokeWidth={2.3} />
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

            {/* ── Modal de Historial de Versiones y Changelog ── */}
            <ChangelogModal
                isOpen={changelogOpen}
                onClose={() => setChangelogOpen(false)}
            />
        </>
    )
}
