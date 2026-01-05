'use client'

import { usePathname } from 'next/navigation'
import Sidebar from './Sidebar'
import { useState } from 'react'

export default function ClientLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const pathname = usePathname()
    const [isCollapsed, setIsCollapsed] = useState(false)

    // Lista de rutas donde NO queremos mostrar el sidebar (paginas publicas / login)
    const publicRoutes = ['/login', '/', '/auth/login']
    const isPublicPage = publicRoutes.includes(pathname)

    // Si es página pública, renderizar solo el contenido
    if (isPublicPage) {
        return <>{children}</>
    }

    // Si es página privada, renderizar con Sidebar persistente
    return (
        <div className="flex min-h-screen bg-transparent relative isolate">
            {/* Fondo decorativo global: Cubos (Invertido: Oscuros sobre Claro) */}
            <div
                className="fixed inset-0 z-0 opacity-[0.3] invert pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"
                aria-hidden="true"
            />

            <Sidebar isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} />

            <main className={`flex-1 ${isCollapsed ? 'md:ml-20' : 'md:ml-64'} min-h-screen p-8 transition-all duration-300 relative z-10`}>
                {children}
            </main>
        </div>
    )
}
