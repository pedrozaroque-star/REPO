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
 *
 * @notes
 * - En `/inicio` cuando `homeViewMode === 'os'` (`< lg`), elimina los márgenes web móviles (`pt-0 lg:pt-14`, `px-0 lg:px-8`)
 *   mediante `ProtectedMainContent` para que `MobileOSHome` ocupe el viewport de borde a borde, preservando Desktop (`lg:`)
 *   y `homeViewMode === 'web'` (`pt-14 px-4`) intactos.
 */

'use client'

import { usePathname } from 'next/navigation'
import AppSidebar from './AppSidebar'
import BottomTabBar from './BottomTabBar'
import SupportChatWidget from './SupportChatWidget'
import SupervisorAutoTracker from './miles/SupervisorAutoTracker'
import RemoteDeviceBridge from './RemoteDeviceBridge'
import SurpriseLoader from './SurpriseLoader'
import ProtectedRoute, { useAuth } from './ProtectedRoute'
import { useState, useEffect, useRef } from 'react'
import { LanguageProvider, useLanguage } from '@/lib/i18n'
import { useMobileDockPreferences } from '@/lib/mobile-os-catalog'

function ProtectedMainContent({
    pathname,
    isCollapsed,
    isFullWidth,
    children,
}: {
    pathname: string | null
    isCollapsed: boolean
    isFullWidth: boolean
    children: React.ReactNode
}) {
    const { user } = useAuth()
    const { t } = useLanguage()
    const { homeViewMode } = useMobileDockPreferences(user, t)
    const isMobileOSHome = pathname === '/inicio' && homeViewMode === 'os'
    const isKitchenFullBleed = Boolean(
        pathname && (pathname === '/inventory/preparador' || pathname === '/inventory/preparador/bodega')
    )

    return (
        <>
            {/* Background pattern (hidden on mobile OS Home wallpaper, intact on web & desktop) */}
            <div
                className={`${isMobileOSHome ? 'hidden lg:block ' : ''}fixed inset-0 z-0 opacity-[0.2] dark:opacity-[0.4] invert dark:invert-0 pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] print:hidden`}
                aria-hidden="true"
            />

            {/* Main Content Area */}
            <div
                className={`relative min-h-screen overflow-x-clip transition-all duration-300 ease-in-out print:ml-0! print:pt-0! print:pb-0! ${
                    /* Desktop: offset by sidebar width */
                    isCollapsed ? 'lg:ml-[64px]' : 'lg:ml-[276px]'
                } ${
                    /* Mobile: full-bleed on OS Home, offset by top bar + bottom dock otherwise */
                    isMobileOSHome
                        ? 'pt-0 pb-0 lg:pt-14 lg:pb-0'
                        : 'pt-14 pb-[calc(102px+env(safe-area-inset-bottom))] lg:pt-14 lg:pb-0'
                }`}
            >
                <main
                    className={`w-full mx-auto animate-in fade-in duration-500 print:max-w-none! print:p-0! ${
                        pathname === '/inicio'
                            ? isMobileOSHome
                                ? 'max-w-[1720px] px-0 lg:px-8 pt-0 pb-0 lg:pt-2 lg:pb-6'
                                : 'max-w-[1720px] px-4 sm:px-6 lg:px-8 pt-2 pb-6'
                            : isKitchenFullBleed
                                ? 'max-w-full p-0'
                                : isFullWidth
                                    ? 'max-w-full px-2 sm:px-4 lg:px-5 py-3 lg:py-4'
                                    : 'max-w-[1600px] p-4 sm:p-6 lg:p-8'
                    }`}
                >
                    {children}
                </main>
            </div>
        </>
    )
}

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
        '/ordenar',
        '/app/privacy',
        '/app/terms',
        '/app/support',
        '/app/delete-account',
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

    // Dedicated kiosk / TV mode ONLY for order-ready-board (public without login)
    const checkDedicatedKioskSync = (currentPath: string | null) => {
        if (typeof window !== 'undefined' && currentPath === '/order-ready-board') {
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

    // Protected fullscreen app preview routes (REQUIRE TEG login via ProtectedRoute, render without sidebar/chrome)
    const checkProtectedAppFullscreenSync = (currentPath: string | null) => {
        if (!currentPath) return false
        if (
            currentPath === '/app/v1' ||
            currentPath.startsWith('/app/v1/') ||
            currentPath === '/app/v2' ||
            currentPath.startsWith('/app/v2/')
        ) {
            return true
        }
        if (typeof window !== 'undefined' && currentPath === '/app') {
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

    const isPathProtectedAppFullscreen = Boolean(
        pathname && (
            pathname === '/app/v1' ||
            pathname.startsWith('/app/v1/') ||
            pathname === '/app/v2' ||
            pathname.startsWith('/app/v2/')
        )
    )

    const [clientReady, setClientReady] = useState(false)
    const [isDedicatedKiosk, setIsDedicatedKiosk] = useState(false)
    const [isProtectedAppFullscreen, setIsProtectedAppFullscreen] = useState(false)
    useEffect(() => {
        const evaluateFullscreen = () => {
            setClientReady(true)
            setIsDedicatedKiosk(checkDedicatedKioskSync(pathname))
            setIsProtectedAppFullscreen(checkProtectedAppFullscreenSync(pathname))
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
        (clientReady && checkDedicatedKioskSync(pathname))

    const isPrintSheetPage = printSheetRoutes.some(r => pathname === r || pathname.startsWith(r + '/'))
    const isChromelessProtectedPage =
        isPrintSheetPage ||
        isPathProtectedAppFullscreen ||
        isProtectedAppFullscreen ||
        (clientReady && checkProtectedAppFullscreenSync(pathname))

    // Store 24/7 kitchen/breakroom tablets, kiosk boards, customer order previews & hourly employee routes where SupportChatWidget must stay hidden
    const hideSupportChatRoutes = [
        '/inventory/preparador',
        '/descansos',
        '/actividades',
        '/mis-horarios',
        '/order-ready-board',
        '/ordenar',
        '/app',
    ]
    const shouldHideSupportChat = hideSupportChatRoutes.some(
        r => pathname === r || Boolean(pathname?.startsWith(r + '/'))
    )

    // Dedicated full-viewport workspace routes (REQUIRE login via ProtectedRoute, render their own 1:1 left rail & top bar)
    const dedicatedWorkspaceRoutes = [
        '/admin/contabilidad-externa',
    ]
    const isDedicatedWorkspace = dedicatedWorkspaceRoutes.some(r => pathname === r || pathname.startsWith(r + '/'))

    // Full-width routes (large tables, schedules, etc.)
    const fullWidthRoutes = ['/horarios', '/admin/plantillas', '/order-ready-board', '/admin/blindaje-delivery/empaque', '/app', '/training', '/admin/contabilidad-externa', '/admin/conciliar-delivery', '/admin/control-remoto']

    const isFullWidth = fullWidthRoutes.some(route => pathname.startsWith(route))

    return (
        <LanguageProvider>
            <RemoteDeviceBridge />
            {pathname === '/order-ready-board' && !clientReady ? (
                <SurpriseLoader />
            ) : isPublicPage ? (
                children
            ) : isChromelessProtectedPage ? (
                <ProtectedRoute>
                    {children}
                </ProtectedRoute>
            ) : isDedicatedWorkspace ? (
                <ProtectedRoute>
                    <div className="min-h-screen bg-[#f4f5f8] dark:bg-slate-950 relative">
                        {children}
                        <div className="print:hidden">
                            {!shouldHideSupportChat && <SupportChatWidget />}
                            <SupervisorAutoTracker />
                        </div>
                    </div>
                </ProtectedRoute>
            ) : (
                <ProtectedRoute>
                    <div className="min-h-screen bg-transparent relative transition-colors duration-300">
                        {/* Sidebar (desktop) + Mobile top bar + Mobile drawer (oculto al imprimir) */}
                        <div className="print:hidden">
                            <AppSidebar
                                isCollapsed={isCollapsed}
                                setIsCollapsed={setIsCollapsed}
                                mobileDrawerOpen={mobileDrawerOpen}
                                setMobileDrawerOpen={setMobileDrawerOpen}
                            />
                        </div>

                        <ProtectedMainContent
                            pathname={pathname}
                            isCollapsed={isCollapsed}
                            isFullWidth={isFullWidth}
                        >
                            {children}
                        </ProtectedMainContent>

                        {/* Bottom Tab Bar (mobile only) & floating widgets (ocultos al imprimir) */}
                        <div className="print:hidden">
                            <BottomTabBar
                                onOpenDrawer={() => setMobileDrawerOpen(prev => !prev)}
                                isDrawerOpen={mobileDrawerOpen}
                            />

                            {/* TEG Assistant Chat Widget */}
                            {!shouldHideSupportChat && <SupportChatWidget />}

                            {/* Supervisor Smart Mileage Auto-Tracker */}
                            <SupervisorAutoTracker />
                        </div>
                    </div>
                </ProtectedRoute>
            )}
        </LanguageProvider>
    )
}
