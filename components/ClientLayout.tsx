'use client'

import { usePathname } from 'next/navigation'
import TopNav from './TopNav'
import { useState } from 'react'

import { LanguageProvider } from '@/lib/i18n'

export default function ClientLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const pathname = usePathname()
    // Ya no necesitamos state de collapsed porque TopNav es horizontal


    // Lista de rutas donde NO queremos mostrar el sidebar (paginas publicas / login)
    const publicRoutes = ['/login', '/', '/auth/login', '/clientes', '/evaluacion', '/feedback-publico', '/planificador/imprimir', '/tv']
    const isPublicPage = publicRoutes.includes(pathname)

    // Lista de rutas que requieren ancho completo (Tablas grandes, Horarios, etc.)
    const fullWidthRoutes = ['/horarios', '/admin/plantillas']
    const isFullWidth = fullWidthRoutes.some(route => pathname.startsWith(route))

    return (
        <LanguageProvider>
            {isPublicPage ? (
                children
            ) : (
                <div className="min-h-screen bg-transparent relative transition-colors duration-300">
                    {/* Fondo decorativo global: Cubos (Invertido: Oscuros sobre Claro en light, y Viceversa en dark) */}
                    <div
                        className="fixed inset-0 z-0 opacity-[0.2] dark:opacity-[0.4] invert dark:invert-0 pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"
                        aria-hidden="true"
                    />

                    <div className="relative z-10 flex flex-col min-h-screen">
                        <TopNav />

                        <main className={`flex-1 w-full mx-auto animate-in fade-in duration-500 ${isFullWidth ? 'max-w-full px-4 md:px-8' : 'max-w-[1600px] p-4 sm:p-6 lg:p-8'
                            }`}>
                            {children}
                        </main>
                    </div>
                </div>
            )}
        </LanguageProvider>
    )
}
