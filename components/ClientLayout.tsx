/**
 * @module components/ClientLayout
 * @description Layout principal del lado del cliente para TEG System.
 * Gestiona la barra lateral (AppSidebar), barra inferior móvil (BottomTabBar),
 * rastreador de millas de supervisores y rutas públicas sin navegación administrativa.
 * 
 * @businessRules
 * - Las rutas públicas (login, kioscos, tableros de clientes y aplicación de pedidos /app)
 *   se renderizan a pantalla completa sin elementos de administración (sidebar ni tab bar).
 * - En rutas administrativas, el estado colapsado del sidebar se persiste en localStorage,
 *   excepto en `/inicio` donde inicia colapsado por defecto y se despliega al seleccionar un módulo.
 * 
 * @dataFlow
 * - Utiliza usePathname() para determinar si la ruta activa es pública, `/inicio` o administrativa.
 */

'use client'

import { usePathname } from 'next/navigation'
import AppSidebar from './AppSidebar'
import BottomTabBar from './BottomTabBar'
import SupportChatWidget from './SupportChatWidget'
import SupervisorAutoTracker from './miles/SupervisorAutoTracker'
import ProtectedRoute from './ProtectedRoute'
import { useState, useEffect, useRef } from 'react'
import { LanguageProvider } from '@/lib/i18n'

export default function ClientLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const pathname = usePathname()

    // Sidebar collapsed state (collapsed by default on /inicio, expanded when selecting a module)
    const [isCollapsed, setIsCollapsed] = useState(() => pathname === '/inicio')
    const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
    const prevPathnameRef = useRef(pathname)

    // Load collapsed state from localStorage on mount (except on /inicio which defaults to collapsed)
    useEffect(() => {
        if (pathname === '/inicio') {
            setIsCollapsed(true)
        } else {
            const saved = localStorage.getItem('teg_sidebar_collapsed')
            if (saved === 'true') setIsCollapsed(true)
        }
    }, [])

    // Listen for explicit expand event from /inicio module cards
    useEffect(() => {
        const handleExpandSidebar = () => {
            setIsCollapsed(false)
            localStorage.setItem('teg_sidebar_collapsed', 'false')
        }
        window.addEventListener('teg:expand-sidebar', handleExpandSidebar)
        return () => window.removeEventListener('teg:expand-sidebar', handleExpandSidebar)
    }, [])

    // Handle route transitions to/from /inicio and close mobile drawer
    useEffect(() => {
        setMobileDrawerOpen(false)
        if (pathname === '/inicio') {
            setIsCollapsed(true)
        } else if (prevPathnameRef.current === '/inicio') {
            setIsCollapsed(false)
            localStorage.setItem('teg_sidebar_collapsed', 'false')
        }
        prevPathnameRef.current = pathname
    }, [pathname])

    // Save collapsed state on regular module routes
    useEffect(() => {
        if (pathname !== '/inicio') {
            localStorage.setItem('teg_sidebar_collapsed', String(isCollapsed))
        }
    }, [isCollapsed, pathname])

    // Truly public routes (no login required, no navigation chrome)
    const publicRoutes = [
        '/login', 
        '/', 
        '/auth/login', 
        '/app/v1',
        '/app/v2',
        '/app/privacy',
        '/app/terms',
        '/app/support',
        '/app/delete-account',
        '/ordenar',
        '/clientes', 
        '/evaluacion/kiosk', 
        '/feedback-publico', 
        '/mantenimiento/registro',
        '/tv', 
        '/admin/blindaje-delivery/empaque',
        '/tablet',
        '/gavilan-pos',
        '/training/portal'
    ]

    // Internal print-sheet routes (REQUIRE login via ProtectedRoute, but render without sidebar/chrome for printing)
    const printSheetRoutes = [
        '/planificador/imprimir',
        '/procedimientos/imprimir',
        '/inventory/orders/print-sheet',
        '/admin/compras/viele/print-sheet',
    ]

    // Dedicated kiosk / TV mode for order-ready-board or fullscreen app preview via query param
    const checkDedicatedKioskSync = (currentPath: string | null) => {
        if (typeof window !== 'undefined' && (currentPath === '/order-ready-board' || currentPath === '/app')) {
            const params = new URLSearchParams(window.location.search)
            return (
                params.get('tv') === '1' ||
                params.get('kiosk') === '1' ||
                params.get('fullscreen') === '1' ||
                params.get('test') === '1'
            )
        }
        return false
    }

    const [isDedicatedKiosk, setIsDedicatedKiosk] = useState(() => checkDedicatedKioskSync(pathname))
    useEffect(() => {
        const evaluateFullscreen = () => {
            setIsDedicatedKiosk(checkDedicatedKioskSync(pathname))
        }
        evaluateFullscreen()
        window.addEventListener('popstate', evaluateFullscreen)
        window.addEventListener('teg-fullscreen-change', evaluateFullscreen)
        return () => {
            window.removeEventListener('popstate', evaluateFullscreen)
            window.removeEventListener('teg-fullscreen-change', evaluateFullscreen)
        }
    }, [pathname])

    const isPublicPage =
        publicRoutes.some(r => pathname === r || pathname.startsWith(r + '/')) ||
        pathname.startsWith('/mantenimiento/registro') ||
        pathname.startsWith('/tablet') ||
        pathname.startsWith('/t/') ||
        pathname.startsWith('/auth/') ||
        isDedicatedKiosk ||
        checkDedicatedKioskSync(pathname)

    const isPrintSheetPage = printSheetRoutes.some(r => pathname === r || pathname.startsWith(r + '/'))

    // Dedicated full-viewport workspace routes (REQUIRE login via ProtectedRoute, render their own 1:1 left rail & top bar)
    const dedicatedWorkspaceRoutes = [
        '/admin/contabilidad-externa',
    ]
    const isDedicatedWorkspace = dedicatedWorkspaceRoutes.some(r => pathname === r || pathname.startsWith(r + '/'))

    // Full-width routes (large tables, schedules, etc.)
    const fullWidthRoutes = ['/horarios', '/admin/plantillas', '/order-ready-board', '/admin/blindaje-delivery/empaque', '/app', '/training', '/admin/contabilidad-externa']

    const isFullWidth = fullWidthRoutes.some(route => pathname.startsWith(route))

    return (
        <LanguageProvider>
            {isPublicPage ? (
                children
            ) : isPrintSheetPage ? (
                <ProtectedRoute>
                    {children}
                </ProtectedRoute>
            ) : isDedicatedWorkspace ? (
                <ProtectedRoute>
                    <div className="min-h-screen bg-[#f4f5f8] dark:bg-slate-950 relative">
                        {children}
                        <SupportChatWidget />
                        <SupervisorAutoTracker />
                    </div>
                </ProtectedRoute>
            ) : (
                <ProtectedRoute>
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
                                    pathname === '/inicio'
                                        ? 'max-w-[1720px] px-4 sm:px-6 lg:px-8 pt-2 pb-6'
                                        : isFullWidth
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
                </ProtectedRoute>
            )}
        </LanguageProvider>
    )
}
