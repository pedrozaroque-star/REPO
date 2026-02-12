import React from 'react'
import Link from 'next/link'

export default function InventoryLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <div className="flex h-screen bg-slate-50 dark:bg-slate-900">
            {/* Sidebar */}
            <aside className="w-64 bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 hidden md:flex flex-col">
                <div className="p-4 border-b border-slate-200 dark:border-slate-700">
                    <h1 className="text-xl font-bold text-slate-800 dark:text-white">Inventario (BETA)</h1>
                    <p className="text-xs text-slate-500">Restaurant365-lite</p>
                </div>

                <nav className="flex-1 p-4 space-y-1">
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

            {/* Main Content */}
            <main className="flex-1 overflow-auto">
                {children}
            </main>
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
