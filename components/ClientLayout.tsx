'use client'

import { usePathname } from 'next/navigation'
import AppSidebar from './AppSidebar'
import BottomTabBar from './BottomTabBar'
import SupportChatWidget from './SupportChatWidget'
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
    const publicRoutes = ['/login', '/', '/auth/login', '/clientes', '/evaluacion', '/feedback-publico', '/planificador/imprimir', '/tv', '/procedimientos/imprimir']
    const isPublicPage = publicRoutes.includes(pathname)

    // Full-width routes (large tables, schedules, etc.)
    const fullWidthRoutes = ['/horarios', '/admin/plantillas']
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
                </div>
            )}
        </LanguageProvider>
    )
}
