/**
 * @module app/app/page
 * @description Visor Web de la Aplicación Móvil de Pedidos de Tacos Gavilan.
 * Permite a comensales y directivos acceder y probar la experiencia de pedidos
 * en línea desde cualquier dispositivo móvil o de escritorio.
 * 
 * @businessRules
 * - **Marca Oficial**: Tacos Gavilan (presentación 1:1 de marca).
 * - **Acceso Público**: Ruta sin autenticación para clientes, accesible desde teléfonos y quioscos.
 * - **Pantalla Completa**: Interfaz inmersiva adaptada a dispositivos móviles con soporte para geolocalización.
 * - **Soporte de Flujos**: Incluye animación oficial de inicio de sesión/splash, selección de sucursal, menú con personalizador, bolsa y rastreo GPS.
 * 
 * @dataFlow
 * - Carga el bundle web compilado de la app móvil desde /app.html manteniendo aislamiento de estilos y dependencias.
 * 
 * @notes
 * - La integración vía iframe aislado garantiza que los estilos de Tailwind v4 de TEG System no colisionen con el runtime de React Native Web.
 */

'use client'

import React from 'react'

export default function MobileAppPage() {
  return (
    <div className="fixed inset-0 w-full h-full bg-[#0F172A] overflow-hidden flex items-center justify-center">
      <iframe
        src="/app/index.html"
        className="w-full h-full border-0"
        title="Tacos Gavilan App"
        allow="geolocation; camera; microphone"
      />
    </div>
  )
}
