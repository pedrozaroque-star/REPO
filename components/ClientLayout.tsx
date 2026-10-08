/**
 * @module components/ClientLayout
 * @description Layout principal del lado del cliente para TEG System.
 * Gestiona la barra lateral (AppSidebar), barra inferior móvil (BottomTabBar),
 * rastreador de millas de supervisores y rutas públicas sin navegación administrativa.
 * 
 * @businessRules
 * - Las rutas públicas (login, kioscos, tableros de clientes y aplicación de pedidos /app)
 *   se renderizan a pantalla completa sin elementos de administración (sidebar ni tab bar).
 * - En rutas administrativas, el estado colapsado del sidebar se persiste en localStorage.
 * 
 * @dataFlow
 * - Utiliza usePathname() para determinar si la ruta activa es pública o administrativa.
 */

'use client'

import { usePathname } from 'next/navigation'
import AppSidebar from './AppSidebar'
import BottomTabBar from './BottomTabBar'
import SupportChatWidget from './SupportChatWidget'
import SupervisorAutoTracker from './miles/SupervisorAutoTracker'
import { useState, useEffect } from 'react'
import { LanguageProvider } from '@/lib/i18n'

export default function ClientLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const pathname = usePathname()

    // Sidebar collapsed state (persisted in localStorage)
    const [isCollapsed, setIsCollapsed] = useState(false)
    const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)

    // Load collapsed state from localStorage
    useEffect(() => {
        const saved = localStorage.getItem('teg_sidebar_collapsed')
        if (saved === 'true') setIsCollapsed(true)
    }, [])

    // Save collapsed state
    useEffect(() => {
        localStorage.setItem('teg_sidebar_collapsed', String(isCollapsed))
    }, [isCollapsed])

    // Close mobile drawer on route change
    useEffect(() => {
        setMobileDrawerOpen(false)
    }, [pathname])

    // Public routes - no navigation chrome
    const publicRoutes = [
        '/login', 
        '/', 
        '/auth/login', 
        '/app',
        '/ordenar',
        '/clientes', 
        '/evaluacion/kiosk', 
        '/feedback-publico', 
        '/mantenimiento/registro',
        '/planificador/imprimir', 
        '/tv', 
        '/procedimientos/imprimir',
        '/inventory/orders/print-sheet',
        '/admin/compras/viele/print-sheet'
    ]

    // Dedicated kiosk / TV mode for order-ready-board via query param (?tv=1 or ?kiosk=1)
    const [isDedicatedKiosk, setIsDedicatedKiosk] = useState(false)
    useEffect(() => {
        if (typeof window !== 'undefined' && pathname === '/order-ready-board') {
            const params = new URLSearchParams(window.location.search)
            setIsDedicatedKiosk(params.get('tv') === '1' || params.get('kiosk') === '1')
        } else {
            setIsDedicatedKiosk(false)
        }
    }, [pathname])

    const isPublicPage = publicRoutes.some(r => pathname === r || pathname.startsWith(r + '/')) || pathname.startsWith('/mantenimiento/registro') || isDedicatedKiosk

    // Full-width routes (large tables, schedules, etc.)
    const fullWidthRoutes = ['/horarios', '/admin/plantillas', '/order-ready-board']
    const isFullWidth = fullWidthRoutes.some(route => pathname.startsWith(route))

    return (
        <LanguageProvider>
            {isPublicPage ? (
                children
            ) : (
                <div className="min-h-screen bg-transparent relative transition-colors duration-300">
                    {/* Background pattern */}
                    <div
                        className="fixed inset-0 z-0 opacity-[0.2] dark:opacity-[0.4] invert dark:invert-0 pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"
                        aria-hidden="true"
                    />

                    {/* Sidebar (desktop) + Mobile top bar + Mobile drawer */}
                    <AppSidebar
                        isCollapsed={isCollapsed}
                        setIsCollapsed={setIsCollapsed}
                        mobileDrawerOpen={mobileDrawerOpen}
                        setMobileDrawerOpen={setMobileDrawerOpen}
                    />

                    {/* Main Content Area */}
                    <div
                        className={`relative z-10 min-h-screen transition-all duration-300 ease-in-out ${
                            /* Desktop: offset by sidebar width */
                            isCollapsed ? 'lg:ml-[64px]' : 'lg:ml-[260px]'
                        } ${
                            /* Mobile: offset by top bar height + floating bottom tab bar */
                            'pt-14 pb-[90px] lg:pt-14 lg:pb-0'
                        }`}
                    >
                        <main
                            className={`w-full mx-auto animate-in fade-in duration-500 ${
                                isFullWidth
                                    ? 'max-w-full px-4 md:px-8 py-4 lg:py-6'
                                    : 'max-w-[1600px] p-4 sm:p-6 lg:p-8'
                            }`}
                        >
                            {children}
                        </main>
                    </div>

                    {/* Bottom Tab Bar (mobile only) */}
                    <BottomTabBar onOpenDrawer={() => setMobileDrawerOpen(true)} />
                    
                    {/* TEG Assistant Chat Widget */}
                    <SupportChatWidget />

                    {/* Supervisor Smart Mileage Auto-Tracker */}
                    <SupervisorAutoTracker />
                </div>
            )}
        </LanguageProvider>
    )
}
