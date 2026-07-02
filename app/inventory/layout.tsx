/**
 * @module inventory/layout
 * @description Layout para el módulo de inventario.
 *              Se eliminó la barra lateral interna redundante, ya que todos los accesos
 *              directos a Insumos, Recetas, Costos y Pedidos están integrados en la
 *              barra lateral principal de la aplicación.
 */

'use client'

import React from 'react'

export default function InventoryLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <div className="w-full bg-transparent min-h-[calc(100vh-4rem)]">
            <main className="w-full">
                {children}
            </main>
        </div>
    )
}
