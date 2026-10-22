/**
 * @module app/app/v2/page
 * @description Vista Pública Directa para Teléfono — Versión 2 de la Aplicación Móvil de Tacos Gavilan.
 * Renderiza la Versión 2 (`CustomerAppV2Pro` con `fullscreenNative={true}`) al 100% de la pantalla del teléfono real (`100dvh`)
 * sin barras administrativas de TEG ni marcos simulados.
 *
 * @businessRules
 * - **Marca Oficial**: Tacos Gavilan.
 * - **Acceso Público**: Ruta pública (`/app/v2`) lista para abrirse directamente en dispositivos móviles (iOS / Android).
 * - **Cajón de Salto Rápido (12 Pantallas)**: Permite saltar con 1 toque a cualquiera de las 12 pantallas o esconder la barra flotante para disfrutar el test al 100% limpio.
 *
 * @dataFlow
 * - Renderiza `<CustomerAppV2Pro fullscreenNative={true} />` y expone controles de salto de etapa (`externalStage`, `externalStoryIndex`, `externalTab`, `externalAuthSheet`).
 *
 * @notes
 * - Cero barras del sistema TEG ni burbujas flotantes de soporte para una experiencia nativa real en iPhone / Android.
 */

'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { SlidersHorizontal, EyeOff, X, Smartphone } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useLanguage } from '@/lib/i18n'
import CustomerAppV2Pro, {
  type V2Stage,
  type MainTab,
  type V2AuthSheet,
} from '@/components/CustomerAppV2Pro'

export default function MobileCustomerAppV2Page() {
  const { language } = useLanguage()
  const isEn = language === 'en'

  const [showTestDrawer, setShowTestDrawer] = useState(false)
  const [hideFloatingPill, setHideFloatingPill] = useState(false)

  const [v2Stage, setV2Stage] = useState<V2Stage | null>('stories')
  const [v2StoryIdx, setV2StoryIdx] = useState<number | null>(0)
  const [v2MainTab, setV2MainTab] = useState<MainTab | null>('home')
  const [v2AuthSheet, setV2AuthSheet] = useState<V2AuthSheet>(null)
  const [v2LoggedInDemo, setV2LoggedInDemo] = useState(false)
  const [controlTick, setControlTick] = useState(0)

  const jumpToV2State = (
    stage: V2Stage,
    storyIndex: number = 0,
    mainTab: MainTab = 'home',
    authSheet: V2AuthSheet = null,
    loggedInDemo: boolean = false
  ) => {
    setV2Stage(stage)
    setV2StoryIdx(storyIndex)
    setV2MainTab(mainTab)
    setV2AuthSheet(authSheet)
    setV2LoggedInDemo(loggedInDemo)
    setControlTick((t) => t + 1)
    setShowTestDrawer(false)
  }

  return (
    <div className="fixed inset-0 z-[9999] w-screen h-[100dvh] bg-[#121212] overflow-hidden select-none">
      {/* Píldora Flotante Discreta (Ocultable con 1 toque) */}
      {hideFloatingPill ? (
        <button
          type="button"
          onClick={() => setHideFloatingPill(false)}
          title={isEn ? 'Show Test Controls' : 'Mostrar controles TEST'}
          className="fixed top-2 left-2 z-[10020] w-7 h-7 rounded-full bg-black/45 hover:bg-black/80 border border-white/25 text-[#FDC82F] flex items-center justify-center text-[10px] font-black backdrop-blur-md shadow-lg cursor-pointer"
        >
          V2
        </button>
      ) : (
        <div className="fixed top-2.5 left-1/2 -translate-x-1/2 z-[10020] flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/80 border border-[#FDC82F]/50 shadow-[0_8px_30px_rgba(0,0,0,0.65)] backdrop-blur-md">
          <button
            type="button"
            onClick={() => setShowTestDrawer((prev) => !prev)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#FDC82F] hover:bg-amber-400 text-[#121212] text-[10px] font-black transition-all cursor-pointer"
          >
            <SlidersHorizontal size={11} />
            <span>{isEn ? 'Screens (1-12)' : 'Pantallas (1-12)'}</span>
          </button>

          <Link
            href="/app/v1"
            className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/15 hover:bg-white/25 text-white text-[10px] font-black transition-all"
          >
            <Smartphone size={11} />
            <span>Ir a V1</span>
          </Link>

          <button
            type="button"
            onClick={() => setHideFloatingPill(true)}
            title={isEn ? 'Hide bar for clean screen' : 'Ocultar barra para vista limpia'}
            className="w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 text-white/80 flex items-center justify-center cursor-pointer"
          >
            <EyeOff size={12} />
          </button>
        </div>
      )}

      {/* Cajón Inferior para Saltar entre las 12 Pantallas de Versión 2 */}
      <AnimatePresence>
        {showTestDrawer && (
          <motion.div
            key="v2-mobile-test-drawer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowTestDrawer(false)}
            className="fixed inset-0 z-[10030] bg-black/70 backdrop-blur-xs flex items-end justify-center"
          >
            <motion.div
              initial={{ y: 320 }}
              animate={{ y: 0 }}
              exit={{ y: 320 }}
              transition={{ type: 'spring', damping: 26, stiffness: 260 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[460px] max-h-[82dvh] bg-[#161618] border-t border-white/15 rounded-t-3xl p-4 text-white flex flex-col shadow-2xl"
            >
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-[#FDC82F]">
                    TACOS GAVILAN • VERSIÓN 2
                  </p>
                  <h3 className="text-sm font-black text-white">
                    {isEn ? 'Jump to Any Screen (1–12)' : 'Saltar a Cualquier Pantalla (1–12)'}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowTestDrawer(false)}
                  className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="overflow-y-auto space-y-1.5 pr-1 py-3">
                <button
                  type="button"
                  onClick={() => jumpToV2State('stories', 0)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left text-xs font-bold"
                >
                  <span>1. Lámina 1: Bolsa Blanca &quot;Ya está.&quot; + Vaso Oficial</span>
                  <span className="text-[10px] text-[#FDC82F] font-mono">00:03</span>
                </button>
                <button
                  type="button"
                  onClick={() => jumpToV2State('stories', 1)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left text-xs font-bold"
                >
                  <span>2. Lámina 2: Plancha Taquera + Alertas en Vivo</span>
                  <span className="text-[10px] text-[#FDC82F] font-mono">00:08</span>
                </button>
                <button
                  type="button"
                  onClick={() => jumpToV2State('stories', 2)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left text-xs font-bold"
                >
                  <span>3. Lámina 3: &quot;URGENTE. TACOS. YA.&quot; (GPS + Vasos Reales)</span>
                  <span className="text-[10px] text-[#FDC82F] font-mono">00:13</span>
                </button>
                <button
                  type="button"
                  onClick={() => jumpToV2State('stories', 3)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left text-xs font-bold"
                >
                  <span>4. Lámina 4: Tarjeta QR Fast-Pass</span>
                  <span className="text-[10px] text-[#FDC82F] font-mono">00:16</span>
                </button>
                <button
                  type="button"
                  onClick={() => jumpToV2State('stories', 4)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left text-xs font-bold"
                >
                  <span>5. Lámina 5: Pide sin Fila + &quot;¡EMPEZAR AHORA!&quot;</span>
                  <span className="text-[10px] text-[#FDC82F] font-mono">00:24</span>
                </button>
                <button
                  type="button"
                  onClick={() => jumpToV2State('hello', 0, 'home', null, false)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-[#FDC82F]/15 hover:bg-[#FDC82F]/25 border border-[#FDC82F]/50 text-left text-xs font-black text-[#FDC82F]"
                >
                  <span>6. Portada &quot;¡HOLA!&quot; (Apple + Google Android)</span>
                  <span className="text-[10px] font-mono">02:05</span>
                </button>
                <button
                  type="button"
                  onClick={() => jumpToV2State('hello', 0, 'home', 'apple-sheet', false)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left text-xs font-bold"
                >
                  <span>7. Acceso con Apple (iOS Face ID)</span>
                  <span className="text-[10px] text-white/60 font-mono">iOS</span>
                </button>
                <button
                  type="button"
                  onClick={() => jumpToV2State('hello', 0, 'home', 'google-sheet', false)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left text-xs font-bold"
                >
                  <span>8. Acceso con Google (Android)</span>
                  <span className="text-[10px] text-blue-400 font-mono">Android</span>
                </button>
                <button
                  type="button"
                  onClick={() => jumpToV2State('hello', 0, 'home', 'login', false)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left text-xs font-bold"
                >
                  <span>9. Modal &quot;Iniciar Sesión&quot; (Correo + Clave)</span>
                  <span className="text-[10px] text-white/60 font-mono">02:05</span>
                </button>
                <button
                  type="button"
                  onClick={() => jumpToV2State('hello', 0, 'home', 'signup', false)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left text-xs font-bold"
                >
                  <span>10. Formulario &quot;Crear Cuenta&quot; (Registro)</span>
                  <span className="text-[10px] text-white/60 font-mono">02:14</span>
                </button>
                <button
                  type="button"
                  onClick={() => jumpToV2State('hello', 0, 'home', 'verify-email', false)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left text-xs font-bold"
                >
                  <span>11. Verificación de Correo + Notificación</span>
                  <span className="text-[10px] text-white/60 font-mono">02:15</span>
                </button>
                <button
                  type="button"
                  onClick={() => jumpToV2State('main', 0, 'home', null, true)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-gradient-to-r from-[#50050a] to-red-700 text-[#FDC82F] border border-[#FDC82F]/50 text-left text-xs font-black"
                >
                  <span>12. Home Logueado (&quot;Buenas tardes, CARLOS&quot; + Menú Real)</span>
                  <span className="text-[10px] font-mono">02:16</span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <CustomerAppV2Pro
        fullscreenNative={true}
        externalStage={v2Stage}
        externalStoryIndex={v2StoryIdx}
        externalTab={v2MainTab}
        externalAuthSheet={v2AuthSheet}
        externalLoggedInDemo={v2LoggedInDemo}
        controlTick={controlTick}
      />
    </div>
  )
}
