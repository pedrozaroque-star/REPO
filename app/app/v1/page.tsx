/**
 * @module app/app/v1/page
 * @description Vista Pública Directa para Teléfono — Versión 1 de la Aplicación Móvil de Tacos Gavilan.
 * Renderiza la Versión 1 al 100% de la pantalla del teléfono real (100dvh) sin barras administrativas de TEG
 * ni marcos simulados de teléfono.
 *
 * @businessRules
 * - **Marca Oficial**: Tacos Gavilan.
 * - **Acceso Público**: Ruta pública (`/app/v1`) lista para abrirse directamente en dispositivos móviles (iOS / Android).
 * - **Conmutación Rápida**: Incluye una píldora flotante discreta (ocultable con 1 toque) para reiniciar el splash o saltar a la Versión 2 (`/app/v2`).
 *
 * @dataFlow
 * - Carga `/app/index.html` dentro de un contenedor de pantalla completa (`100dvh`).
 *
 * @notes
 * - Cero barras del sistema TEG ni burbujas flotantes de soporte para no estorbar la experiencia móvil real.
 */

'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { RotateCcw, EyeOff, Sparkles } from 'lucide-react'

export default function MobileCustomerAppV1Page() {
  const [reloadKey, setReloadKey] = useState(0)
  const [withSplash, setWithSplash] = useState(false)
  const [hideControls, setHideControls] = useState(false)

  return (
    <div className="fixed inset-0 z-[9999] w-screen h-[100dvh] bg-white overflow-hidden select-none">
      {hideControls ? (
        <button
          type="button"
          onClick={() => setHideControls(false)}
          title="Mostrar controles"
          className="fixed top-2 left-2 z-[10020] w-7 h-7 rounded-full bg-black/45 hover:bg-black/80 border border-white/25 text-[#FDC82F] flex items-center justify-center text-[10px] font-black backdrop-blur-md shadow-lg cursor-pointer"
        >
          V1
        </button>
      ) : (
        <div className="fixed top-2.5 left-1/2 -translate-x-1/2 z-[10020] flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/80 border border-[#FDC82F]/50 shadow-[0_8px_25px_rgba(0,0,0,0.5)] backdrop-blur-md">
          <span className="px-2 py-0.5 rounded-full bg-white/15 text-white text-[10px] font-black uppercase tracking-wider">
            Versión 1
          </span>

          <button
            type="button"
            onClick={() => {
              setWithSplash(true)
              setReloadKey((k) => k + 1)
            }}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#50050a] hover:bg-red-800 text-[#FDC82F] text-[10px] font-black transition-all cursor-pointer"
          >
            <RotateCcw size={11} />
            <span>Splash</span>
          </button>

          <Link
            href="/app/v2"
            className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#FDC82F] hover:bg-amber-400 text-[#121212] text-[10px] font-black transition-all"
          >
            <Sparkles size={11} />
            <span>Ir a V2</span>
          </Link>

          <button
            type="button"
            onClick={() => setHideControls(true)}
            title="Ocultar barra"
            className="w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 text-white/80 flex items-center justify-center cursor-pointer"
          >
            <EyeOff size={12} />
          </button>
        </div>
      )}

      <iframe
        key={`v1-mobile-${reloadKey}-${withSplash ? 'splash' : 'nosplash'}`}
        src={withSplash ? '/app/index.html' : '/app/index.html?nosplash=1'}
        className="w-full h-full border-0"
        title="Tacos Gavilan App — Versión 1"
      />
    </div>
  )
}
