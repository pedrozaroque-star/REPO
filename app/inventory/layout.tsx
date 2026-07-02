'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { ChevronLeft, Menu } from 'lucide-react'

export default function InventoryLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const [isSidebarOpen, setIsSidebarOpen] = useState(true)

    // Load preference from localStorage on mount
    useEffect(() => {
        const saved = localStorage.getItem('inventorySidebarOpen')
        if (saved !== null) {
            setIsSidebarOpen(saved === 'true')
        }
    }, [])

    const toggleSidebar = () => {
        const newState = !isSidebarOpen
        setIsSidebarOpen(newState)
        localStorage.setItem('inventorySidebarOpen', String(newState))
    }

    return (
        <div className="flex min-h-[calc(100vh-4rem)] bg-slate-50 dark:bg-slate-900">
            {/* Sidebar */}
            <aside
                className={`
                    ${isSidebarOpen ? 'w-64' : 'w-0'} 
                    bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 
                    hidden md:flex flex-col transition-all duration-300 ease-in-out relative
                `}
            >
                <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center whitespace-nowrap">
                    <div>
                        <h1 className="text-xl font-bold text-slate-800 dark:text-white">Inventario (BETA)</h1>
                        <p className="text-xs text-slate-500">Restaurant365-lite</p>
                    </div>
                    <button
                        onClick={toggleSidebar}
                        className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-400"
                    >
                        <ChevronLeft size={20} />
                    </button>
                </div>

                <nav className="flex-1 p-4 space-y-1 whitespace-nowrap overflow-hidden">
                    <NavLink href="/inventory">Dashboard</NavLink>
                    <div className="pt-4 pb-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                        Catálogos
                    </div>
                    <NavLink href="/inventory/menu">Menú Toast (Recetas)</NavLink>
                    <NavLink href="/inventory/items">Insumos (Compras)</NavLink>

                    <div className="pt-4 pb-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                        Operación
                    </div>
                    <NavLink href="/inventory/counts">Conteos Físicos</NavLink>
                    <NavLink href="/inventory/orders">Pedidos Sugeridos</NavLink>
                </nav>
            </aside>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col min-w-0 relative">
                {/* Floating Opener Button when closed */}
                {!isSidebarOpen && (
                    <button
                        onClick={toggleSidebar}
                        className="fixed top-20 left-4 z-[100] p-2 bg-indigo-600 text-white rounded-lg shadow-xl hover:bg-indigo-700 transition-all hover:scale-110 active:scale-95 animate-in slide-in-from-left duration-300"
                        title="Abrir Menú"
                    >
                        <Menu size={20} />
                    </button>
                )}

                <main className="flex-1 overflow-visible">
                    {children}
                </main>
            </div>
        </div>
    )
}

function NavLink({ href, children }: { href: string, children: React.ReactNode }) {
    return (
        <Link
            href={href}
            className="block px-3 py-2 rounded-md text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
        >
            {children}
        </Link>
    )
}
