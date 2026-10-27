/**
 * @module app/app/page
 * @description Módulo "App Clientes" — Centro de Pruebas y Versiones de la Aplicación Móvil de Tacos Gavilan.
 * Al hacer clic en "App Clientes" en la barra lateral izquierda (`AppSidebar`), se abre en el panel derecho
 * principal el laboratorio interactivo con pestañas para probar cada versión:
 *   1. Versión 1
 *   2. Versión 2
 *   3. Comparar Lado a Lado (Versión 1 vs Versión 2)
 *   4. TEST FULLSCREEN (Vista Teléfono Real 100% al ras sin barras del sistema TEG)
 *
 * @businessRules
 * - **Marca Oficial**: Tacos Gavilan (presentación 1:1 de marca y colores corporativos #50050a y #FDC82F).
 * - **Integración en Panel Derecho**: Se renderiza dentro del área de trabajo principal a la derecha de `AppSidebar`
 *   (igual que Centro de Actividades y Sitio Web), y ofrece además el modo **TEST FULLSCREEN** (`?fullscreen=1` o `?test=1`)
 *   diseñado para verse al 100% de la pantalla en el teléfono real de Carlos sin marcos simulados ni barras de TEG.
 * - **Preservación Total de Versión 1**: La Versión 1 carga intacto `/app/index.html?nosplash=1`.
 *
 * @dataFlow
 * - Lee `?v=1|2|compare` y `?fullscreen=1|test=1` desde `useSearchParams()` -> Renderiza el panel derecho con pestañas o vista TEST FULLSCREEN.
 *
 * @notes
 * - Incluye controles rápidos en la columna izquierda del área de trabajo y un cajón móvil flotante dentro de TEST FULLSCREEN
 *   para saltar a cualquiera de las 12 pantallas de la Versión 2 directamente desde el teléfono.
 */

'use client'

import React, { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Smartphone,
  Sparkles,
  Columns,
  Play,
  Maximize2,
  RotateCcw,
  CheckCircle2,
  MapPin,
  Heart,
  ShoppingBag,
  User,
  Flame,
  Home,
  Hand,
  Info,
  ArrowLeft,
  SlidersHorizontal,
  EyeOff,
  X,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useLanguage } from '@/lib/i18n'
import CustomerAppV2Pro, {
  type V2Stage,
  type MainTab,
  type V2AuthSheet,
} from '@/components/CustomerAppV2Pro'

type ActiveVersionTab = 'v1' | 'v2' | 'compare'

function getLaStatusClock(): string {
  try {
    const formatted = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date())
    return formatted.replace(/\s?(AM|PM)$/i, '')
  } catch {
    return '5:28'
  }
}

function IPhoneStatusBarWithIsland({
  overlay = false,
  darkIcons = true,
}: {
  overlay?: boolean
  darkIcons?: boolean
}) {
  return (
    <div
      className={`${
        overlay
          ? 'absolute top-0 inset-x-0 z-30 bg-transparent'
          : 'relative z-30 bg-white border-b border-slate-100/80 shrink-0'
      } h-[46px] pointer-events-none flex items-center justify-between px-6 pt-1.5 ${
        darkIcons ? 'text-slate-900' : 'text-white'
      }`}
    >
      {/* Left: Live Los Angeles Time */}
      <div className="w-[74px] flex items-center pl-1">
        <span className="text-[13px] font-black tracking-tight leading-none">
          {getLaStatusClock()}
        </span>
      </div>

      {/* Center: Authentic iPhone Dynamic Island (Isla Dinámica) */}
      <div className="w-[118px] h-[31px] rounded-full bg-black border border-white/15 shadow-[0_3px_12px_rgba(0,0,0,0.65)] flex items-center justify-between px-3">
        <div className="w-2.5 h-2.5 rounded-full bg-[#101016] ring-1 ring-white/5" />
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
        <div className="w-3 h-3 rounded-full bg-[#0d1528] ring-1 ring-indigo-400/35 flex items-center justify-center">
          <div className="w-1 h-1 rounded-full bg-sky-400/70" />
        </div>
      </div>

      {/* Right: iOS Cellular Signal Bars + Wi-Fi + Battery */}
      <div className="w-[74px] flex items-center justify-end gap-1.5 pr-0.5">
        <svg className="w-[15px] h-[11px] fill-current" viewBox="0 0 18 12" aria-hidden="true">
          <rect x="0.5" y="8" width="2.8" height="3.5" rx="0.8" />
          <rect x="4.8" y="5.8" width="2.8" height="5.7" rx="0.8" />
          <rect x="9.1" y="3.3" width="2.8" height="8.2" rx="0.8" />
          <rect x="13.4" y="0.8" width="2.8" height="10.7" rx="0.8" />
        </svg>
        <svg className="w-[14px] h-[11px] fill-current" viewBox="0 0 16 12" aria-hidden="true">
          <path d="M8 9.4a1.4 1.4 0 100 2.8 1.4 1.4 0 000-2.8zm-3.2-1.8a5.1 5.1 0 016.4 0l1.2-1.3a6.9 6.9 0 00-8.8 0l1.2 1.3zm-2.6-2.7a8.8 8.8 0 0111.6 0L15 3.6a10.6 10.6 0 00-14 0l1.2 1.3z" />
        </svg>
        <svg className="w-[23px] h-[11px]" viewBox="0 0 25 12" aria-hidden="true">
          <rect
            x="0.75"
            y="1"
            width="20.5"
            height="10"
            rx="3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeOpacity="0.6"
          />
          <rect x="2.5" y="2.6" width="17" height="6.8" rx="1.6" fill="currentColor" />
          <path d="M22.5 4.2v3.6a1.6 1.6 0 000-3.6z" fill="currentColor" fillOpacity="0.6" />
        </svg>
      </div>
    </div>
  )
}

function AppClientesWorkspaceContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { language } = useLanguage()
  const isEn = language === 'en'

  const vParam = searchParams.get('v')
  const fullscreenParam =
    searchParams.get('fullscreen') === '1' || searchParams.get('test') === '1'

  const [activeTab, setActiveTab] = useState<ActiveVersionTab>(() => {
    if (vParam === '1') return 'v1'
    if (vParam === 'compare') return 'compare'
    return 'v2'
  })

  const [isFullscreenMode, setIsFullscreenMode] = useState<boolean>(fullscreenParam)
  // In fullscreen mode: true = 100% edge-to-edge native mobile view (default on phones); false = centered phone frame on desktop
  const [fullscreenEdgeToEdge, setFullscreenEdgeToEdge] = useState<boolean>(true)
  // Floating TEST drawer & pill visibility in Fullscreen mode
  const [showTestDrawer, setShowTestDrawer] = useState<boolean>(false)
  const [hideFloatingPill, setHideFloatingPill] = useState<boolean>(false)
  // Dynamic Island coupling mode: false = iOS Safe Area coupled below island; true = overlaid directly over top edge
  const [islandOverlayMode, setIslandOverlayMode] = useState<boolean>(false)

  // Controls to jump to any stage/slide/auth sheet of Version 2
  const [v2Stage, setV2Stage] = useState<V2Stage | null>(null)
  const [v2StoryIdx, setV2StoryIdx] = useState<number | null>(null)
  const [v2MainTab, setV2MainTab] = useState<MainTab | null>(null)
  const [v2AuthSheet, setV2AuthSheet] = useState<V2AuthSheet>(null)
  const [v2LoggedInDemo, setV2LoggedInDemo] = useState(false)
  const [controlTick, setControlTick] = useState(0)
  const [v1ReloadKey, setV1ReloadKey] = useState(0)
  const [showSplashModal, setShowSplashModal] = useState(false)

  useEffect(() => {
    try {
      // Ensure Version 1 (/app/index.html) also boots in English ('en') by default
      localStorage.setItem('gavilan_app_lang', 'en')
    } catch {
      // Ignore storage errors
    }
  }, [])

  useEffect(() => {
    if (vParam === '1') setActiveTab('v1')
    else if (vParam === '2') setActiveTab('v2')
    else if (vParam === 'compare') setActiveTab('compare')
  }, [vParam])

  useEffect(() => {
    setIsFullscreenMode(fullscreenParam)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('teg-fullscreen-change'))
    }
  }, [fullscreenParam])

  const enterTestFullscreen = (targetVersion?: 'v1' | 'v2') => {
    const ver = targetVersion || (activeTab === 'v1' ? 'v1' : 'v2')
    setActiveTab(ver)
    setIsFullscreenMode(true)
    const vQuery = ver === 'v1' ? '1' : '2'
    router.replace(`/app?v=${vQuery}&fullscreen=1`, { scroll: false })
    if (typeof window !== 'undefined') {
      setTimeout(() => {
        window.dispatchEvent(new Event('teg-fullscreen-change'))
      }, 20)
    }
  }

  const exitTestFullscreen = () => {
    setIsFullscreenMode(false)
    setShowTestDrawer(false)
    const vQuery = activeTab === 'v1' ? '1' : '2'
    router.replace(`/app?v=${vQuery}`, { scroll: false })
    if (typeof window !== 'undefined') {
      setTimeout(() => {
        window.dispatchEvent(new Event('teg-fullscreen-change'))
      }, 20)
    }
  }

  const handleSelectTab = (tab: ActiveVersionTab) => {
    setActiveTab(tab)
    const vQuery = tab === 'v1' ? '1' : tab === 'v2' ? '2' : 'compare'
    router.replace(`/app?v=${vQuery}`, { scroll: false })
  }

  const jumpToV2State = (
    stage: V2Stage,
    storyIndex: number = 0,
    mainTab: MainTab = 'home',
    authSheet: V2AuthSheet = null,
    loggedInDemo: boolean = false
  ) => {
    setActiveTab('v2')
    setV2Stage(stage)
    setV2StoryIdx(storyIndex)
    setV2MainTab(mainTab)
    setV2AuthSheet(authSheet)
    setV2LoggedInDemo(loggedInDemo)
    setControlTick((t) => t + 1)
    setShowTestDrawer(false)
  }

  // =========================================================================
  // MODO TEST FULLSCREEN DEDICADO (?fullscreen=1 o ?test=1)
  // Optimizado para que en el teléfono real se vea 100% pantalla completa nativa
  // =========================================================================
  if (isFullscreenMode) {
    const fullscreenVersion = activeTab === 'v1' ? 'v1' : 'v2'
    return (
      <div className="fixed inset-0 z-[9999] w-screen h-[100dvh] bg-[#09090b] overflow-hidden flex items-center justify-center select-none">
        {/* Botón Flotante Compacto TEST (o punto discreto si se oculta) */}
        {hideFloatingPill ? (
          <button
            type="button"
            onClick={() => setHideFloatingPill(false)}
            title={isEn ? 'Show Test Controls' : 'Mostrar controles TEST'}
            className="fixed top-2 left-2 z-[10020] w-7 h-7 rounded-full bg-black/45 hover:bg-black/80 border border-white/25 text-[#FDC82F] flex items-center justify-center text-[10px] font-black backdrop-blur-md shadow-lg cursor-pointer"
          >
            T
          </button>
        ) : (
          <div className="fixed top-2.5 left-1/2 -translate-x-1/2 z-[10020] flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/80 border border-[#FDC82F]/50 shadow-[0_8px_30px_rgba(0,0,0,0.65)] backdrop-blur-md">
            <button
              type="button"
              onClick={exitTestFullscreen}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#50050a] hover:bg-red-800 text-white text-[11px] font-black transition-all cursor-pointer"
            >
              <ArrowLeft size={12} className="text-[#FDC82F]" />
              <span>{isEn ? 'Exit' : 'Salir'}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowTestDrawer((prev) => !prev)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#FDC82F] hover:bg-amber-400 text-[#121212] text-[11px] font-black transition-all cursor-pointer"
            >
              <SlidersHorizontal size={12} />
              <span>{isEn ? 'TEST Screens (1-12)' : 'Pantallas TEST (1-12)'}</span>
            </button>

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

        {/* Cajón Inferior de Salto Rápido entre Pantallas #1-#10 en Modo Fullscreen */}
        <AnimatePresence>
          {showTestDrawer && (
            <motion.div
              key="fullscreen-test-drawer"
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
                      {isEn ? 'MOBILE FULLSCREEN TESTER' : 'PROBADOR FULLSCREEN EN TELÉFONO'}
                    </p>
                    <h3 className="text-sm font-black text-white">
                      {isEn ? 'Jump to Any Screen or Version' : 'Saltar a Cualquier Pantalla o Versión'}
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

                {/* Conmutador Versión 2 / Versión 1 + Modo Borde */}
                <div className="grid grid-cols-2 gap-2 my-3">
                  <button
                    type="button"
                    onClick={() => enterTestFullscreen('v2')}
                    className={`py-2 px-3 rounded-xl text-xs font-black border transition-all cursor-pointer ${
                      fullscreenVersion === 'v2'
                        ? 'bg-gradient-to-r from-[#50050a] to-red-700 text-[#FDC82F] border-[#FDC82F]'
                        : 'bg-white/5 text-white/70 border-white/10'
                    }`}
                  >
                    {isEn ? 'Version 2 (Active)' : 'Versión 2'}
                  </button>
                  <button
                    type="button"
                    onClick={() => enterTestFullscreen('v1')}
                    className={`py-2 px-3 rounded-xl text-xs font-black border transition-all cursor-pointer ${
                      fullscreenVersion === 'v1'
                        ? 'bg-white text-black border-white'
                        : 'bg-white/5 text-white/70 border-white/10'
                    }`}
                  >
                    {isEn ? 'Version 1' : 'Versión 1'}
                  </button>
                </div>

                {/* Lista de las 10 Pantallas Reales de Versión 2 (Modo 100% Directo sin Login) */}
                <div className="overflow-y-auto space-y-1.5 pr-1 pb-2">
                  <button
                    type="button"
                    onClick={() => jumpToV2State('stories', 0)}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left text-xs font-bold"
                  >
                    <span>{isEn ? '1. Slide 1: White Bag "Ya está."' : '1. Lámina 1: Bolsa Blanca "Ya está."'}</span>
                    <span className="text-[10px] text-[#FDC82F] font-mono">00:03</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => jumpToV2State('stories', 1)}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left text-xs font-bold"
                  >
                    <span>{isEn ? '2. Slide 2: Authentic Mexican Food' : '2. Lámina 2: Auténtica Comida Mexicana'}</span>
                    <span className="text-[10px] text-[#FDC82F] font-mono">00:08</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => jumpToV2State('stories', 2)}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left text-xs font-bold"
                  >
                    <span>{isEn ? '3. Slide 3: "MUST. FIND. TACOS. FAST." (GPS)' : '3. Lámina 3: "URGENTE. TACOS. YA." (GPS)'}</span>
                    <span className="text-[10px] text-[#FDC82F] font-mono">00:13</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => jumpToV2State('stories', 3)}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left text-xs font-bold"
                  >
                    <span>{isEn ? '4. Slide 4: Traditional Specialties' : '4. Lámina 4: Especialidades Tradicionales'}</span>
                    <span className="text-[10px] text-[#FDC82F] font-mono">00:16</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => jumpToV2State('stories', 4)}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left text-xs font-bold"
                  >
                    <span>{isEn ? '5. Slide 5: Order Ahead + "GET STARTED!"' : '5. Lámina 5: Pide sin Fila + "¡EMPEZAR!"'}</span>
                    <span className="text-[10px] text-[#FDC82F] font-mono">00:24</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => jumpToV2State('hello', 4, 'home', null, false)}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left text-xs font-bold"
                  >
                    <span>{isEn ? '6. Welcome Gate: "HELLO! / ¡HOLA!"' : '6. Puerta de Bienvenida: "¡HOLA! / HELLO!"'}</span>
                    <span className="text-[10px] text-[#FDC82F] font-mono">00:26</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => jumpToV2State('hello', 4, 'home', 'sms-otp', false)}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left text-xs font-bold"
                  >
                    <span>{isEn ? '7. Real 6-Digit Email Code Sign-In' : '7. Login Real con Código de 6 Dígitos al Correo'}</span>
                    <span className="text-[10px] text-emerald-400 font-mono">Email OTP</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => jumpToV2State('main', 0, 'home', null, false)}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-[#FDC82F]/15 hover:bg-[#FDC82F]/25 border border-[#FDC82F]/50 text-left text-xs font-black text-[#FDC82F]"
                  >
                    <span>{isEn ? '8. Home Tab (Specialties + Official Menu)' : '8. Pestaña Inicio (Especialidades + Nuestro Menú)'}</span>
                    <span className="text-[10px] font-mono">Home</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => jumpToV2State('main', 0, 'order', null, false)}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left text-xs font-bold"
                  >
                    <span>{isEn ? '9. Order Tab (Official Toast Checkout)' : '9. Pestaña Ordenar (Checkout Oficial Toast)'}</span>
                    <span className="text-[10px] text-white/60 font-mono">Order</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => jumpToV2State('main', 0, 'stores', null, false)}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left text-xs font-bold"
                  >
                    <span>{isEn ? '10. Stores Tab (15 Locations + Live Hours)' : '10. Pestaña Sucursales (15 Tiendas + Horarios)'}</span>
                    <span className="text-[10px] text-white/60 font-mono">Stores</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => jumpToV2State('main', 0, 'account', null, false)}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left text-xs font-bold"
                  >
                    <span>{isEn ? '11. Account Tab (Profile, Email OTP & Support)' : '11. Pestaña Cuenta (Perfil, Código al Correo y Soporte)'}</span>
                    <span className="text-[10px] text-white/60 font-mono">Account</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => jumpToV2State('main', 0, 'home', null, true)}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-left text-xs font-black text-emerald-300"
                  >
                    <span>{isEn ? '12. Logged-In Home (Personalized Greeting)' : '12. Inicio con Sesión Activa (Saludo Personalizado)'}</span>
                    <span className="text-[10px] font-mono">Active</span>
                  </button>
                </div>

                {/* Opción Solo Desktop: Alternar 100% Al Ras vs Marco 430px */}
                <div className="hidden md:flex items-center justify-between pt-3 mt-2 border-t border-white/10 text-xs">
                  <span className="text-white/60">
                    {isEn ? 'Desktop Container Width:' : 'Ancho en Computadora:'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setFullscreenEdgeToEdge((v) => !v)}
                    className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold cursor-pointer"
                  >
                    {fullscreenEdgeToEdge
                      ? isEn
                        ? 'Switch to 430px Phone Frame'
                        : 'Ver en Marco de 430px'
                      : isEn
                      ? 'Switch to 100% Full Width'
                      : 'Ver 100% Ancho Completo'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Contenido Principal Fullscreen (100% Al Ras en Teléfono) */}
        {fullscreenVersion === 'v1' ? (
          <div
            className={
              fullscreenEdgeToEdge
                ? 'w-full h-full bg-white overflow-hidden'
                : 'w-full h-full md:max-w-[430px] md:h-[94dvh] md:rounded-[40px] bg-white overflow-hidden shadow-2xl'
            }
          >
            <iframe
              key={`fs-v1-${v1ReloadKey}`}
              src="/app/index.html?nosplash=1"
              className="w-full h-full border-0"
              title="Tacos Gavilan App V1 Fullscreen"
            />
          </div>
        ) : (
          <div
            className={
              fullscreenEdgeToEdge
                ? 'w-full h-full md:max-w-[430px] md:h-full overflow-hidden'
                : 'w-full h-full overflow-hidden'
            }
          >
            <CustomerAppV2Pro
              fullscreenNative={fullscreenEdgeToEdge}
              externalStage={v2Stage}
              externalStoryIndex={v2StoryIdx}
              externalTab={v2MainTab}
              externalAuthSheet={v2AuthSheet}
              externalLoggedInDemo={v2LoggedInDemo}
              controlTick={controlTick}
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5 pb-10">
      {/* =====================================================================
          BANNER SUPERIOR MÓVIL: ACCESO DE 1 TOQUE A TEST FULLSCREEN EN TELÉFONO
         ===================================================================== */}
      <div className="bg-gradient-to-r from-[#50050a] via-[#6b0910] to-[#3d0307] rounded-2xl border-2 border-[#FDC82F] p-4 shadow-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-[#FDC82F] text-[#121212] flex items-center justify-center shrink-0 shadow-md">
            <Maximize2 size={22} strokeWidth={2.5} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-md bg-[#FDC82F] text-[#121212] text-[10px] font-black uppercase tracking-wider">
                {isEn ? 'PHONE NATIVE VIEW' : 'VISTA TELÉFONO REAL'}
              </span>
              <h2 className="text-sm sm:text-base font-black text-white">
                {isEn
                  ? 'TEST FULLSCREEN (100% Phone Screen)'
                  : 'TEST FULLSCREEN (Pantalla Completa en tu Teléfono)'}
              </h2>
            </div>
            <p className="text-xs text-white/85 mt-0.5">
              {isEn
                ? 'Hides the TEG sidebar and phone bezels so the app fills 100% of your smartphone screen.'
                : 'Oculta el menú lateral de TEG y los bordes simulados para que la app ocupe el 100% de la pantalla de tu teléfono.'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => enterTestFullscreen('v2')}
            className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#FDC82F] hover:bg-amber-400 text-[#121212] text-xs sm:text-sm font-black shadow-md transition-all cursor-pointer"
          >
            <Maximize2 size={15} strokeWidth={2.5} />
            <span>{isEn ? 'TEST FULLSCREEN (V2)' : 'ABRIR TEST FULLSCREEN (V2)'}</span>
          </button>

          <button
            type="button"
            onClick={() => enterTestFullscreen('v1')}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-white/15 hover:bg-white/25 text-white border border-white/30 text-xs font-bold transition-all cursor-pointer"
          >
            <Smartphone size={14} />
            <span>{isEn ? 'Fullscreen V1' : 'Fullscreen V1'}</span>
          </button>
        </div>
      </div>

      {/* =====================================================================
          ENCABEZADO Y PESTAÑAS DE MÓDULO (Estilo idéntico a Centro de Actividades)
         ===================================================================== */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="px-6 pt-5 pb-3 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-black text-orange-600 dark:text-orange-400 tracking-tight">
                {isEn ? 'Customer App — Versions Lab' : 'App Clientes — Versiones'}
              </h1>
              <span
                title={
                  isEn
                    ? 'Interactive testing hub for Tacos Gavilan mobile app versions'
                    : 'Laboratorio interactivo para probar las versiones de la app de Tacos Gavilan'
                }
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-help"
              >
                <Info size={18} />
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {isEn
                ? 'Select and test each version of the Tacos Gavilan mobile app (Version 1, Version 2)'
                : 'Selecciona y prueba cada versión de la aplicación móvil de Tacos Gavilan (Versión 1, Versión 2)'}
            </p>
          </div>

          {/* Botones de Acción Rápida a la Derecha */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSplashModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#50050a] hover:bg-[#3d0307] text-[#FDC82F] border border-[#FDC82F]/50 text-xs font-black shadow-xs transition-all cursor-pointer"
            >
              <Play size={13} fill="currentColor" />
              <span>{isEn ? 'Test Official Splash' : 'Probar Splash Oficial'}</span>
            </button>

            <button
              type="button"
              onClick={() => enterTestFullscreen(activeTab === 'v1' ? 'v1' : 'v2')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#FDC82F] hover:bg-amber-400 text-[#121212] border border-amber-500 text-xs font-black shadow-sm transition-all cursor-pointer"
            >
              <Maximize2 size={14} strokeWidth={2.5} />
              <span>{isEn ? 'TEST FULLSCREEN' : 'TEST FULLSCREEN'}</span>
            </button>
          </div>
        </div>

        {/* Barra de Pestañas (Versión 1 | Versión 2 | Comparar | TEST FULLSCREEN) */}
        <div className="px-6 border-t border-slate-100 dark:border-slate-800/80 flex items-center gap-6 overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => handleSelectTab('v1')}
            className={`flex items-center gap-2 py-3.5 text-xs sm:text-sm font-bold border-b-2 transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'v1'
                ? 'border-orange-500 text-orange-600 dark:text-orange-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Smartphone size={16} />
            <span>{isEn ? 'Version 1' : 'Versión 1'}</span>
          </button>

          <button
            type="button"
            onClick={() => handleSelectTab('v2')}
            className={`flex items-center gap-2 py-3.5 text-xs sm:text-sm font-black border-b-2 transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'v2'
                ? 'border-orange-500 text-orange-600 dark:text-orange-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Sparkles size={16} className="text-amber-500" />
            <span>{isEn ? 'Version 2' : 'Versión 2'}</span>
          </button>

          <button
            type="button"
            onClick={() => handleSelectTab('compare')}
            className={`flex items-center gap-2 py-3.5 text-xs sm:text-sm font-bold border-b-2 transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'compare'
                ? 'border-orange-500 text-orange-600 dark:text-orange-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Columns size={16} />
            <span>
              {isEn ? 'Compare (Version 1 vs Version 2)' : 'Comparar (Versión 1 vs Versión 2)'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => enterTestFullscreen(activeTab === 'v1' ? 'v1' : 'v2')}
            className="flex items-center gap-2 py-3.5 text-xs sm:text-sm font-black border-b-2 border-transparent text-[#50050a] dark:text-[#FDC82F] hover:text-orange-600 transition-all whitespace-nowrap cursor-pointer"
          >
            <Maximize2 size={15} />
            <span>{isEn ? 'TEST FULLSCREEN (Phone)' : 'TEST FULLSCREEN (Teléfono)'}</span>
          </button>
        </div>
      </div>

      {/* =====================================================================
          CUERPO PRINCIPAL DEL PANEL DERECHO: COLUMNA DE OPCIONES + SIMULADOR EN VIVO
         ===================================================================== */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* COLUMNA IZQUIERDA (Opciones para calar cada versión y sus pantallas) */}
        <div className="xl:col-span-4 space-y-4">
          {/* Tarjeta Selectora de Versiones */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-4 shadow-xs space-y-3">
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
              {isEn ? 'SELECT VERSION TO TEST' : 'ELEGIR VERSIÓN PARA CALAR'}
            </h2>

            {/* Opción: Versión 1 */}
            <div
              onClick={() => handleSelectTab('v1')}
              className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                activeTab === 'v1'
                  ? 'bg-orange-50/70 dark:bg-orange-950/30 border-orange-500 shadow-xs'
                  : 'bg-slate-50/70 dark:bg-slate-950/50 border-slate-200 dark:border-slate-800 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-200 font-black text-xs">
                    V1
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-900 dark:text-white">
                      {isEn ? 'Version 1' : 'Versión 1'}
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {isEn
                        ? 'Original app preserved 100% intact'
                        : 'Versión actual conservada al 100%'}
                    </p>
                  </div>
                </div>
                {activeTab === 'v1' && (
                  <CheckCircle2 size={18} className="text-orange-500 shrink-0" />
                )}
              </div>
            </div>

            {/* Opción: Versión 2 */}
            <div
              onClick={() => handleSelectTab('v2')}
              className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                activeTab === 'v2'
                  ? 'bg-gradient-to-r from-[#50050a]/10 to-amber-500/10 dark:from-[#50050a]/40 dark:to-amber-500/15 border-orange-500 shadow-xs'
                  : 'bg-slate-50/70 dark:bg-slate-950/50 border-slate-200 dark:border-slate-800 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#50050a] to-red-700 flex items-center justify-center text-[#FDC82F] font-black text-xs shadow-sm">
                    V2
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-900 dark:text-white">
                      {isEn ? 'Version 2' : 'Versión 2'}
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {isEn
                        ? 'Vertical Stories + "¡HOLA!" Gate + Dual Action Bar'
                        : 'Historias verticales + Pantalla "¡HOLA!" + Barra Doble'}
                    </p>
                  </div>
                </div>
                {activeTab === 'v2' && (
                  <CheckCircle2 size={18} className="text-orange-500 shrink-0" />
                )}
              </div>
            </div>

            {/* Opción: Comparar Lado a Lado */}
            <div
              onClick={() => handleSelectTab('compare')}
              className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                activeTab === 'compare'
                  ? 'bg-orange-50/70 dark:bg-orange-950/30 border-orange-500 shadow-xs'
                  : 'bg-slate-50/70 dark:bg-slate-950/50 border-slate-200 dark:border-slate-800 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center font-black text-xs">
                    <Columns size={16} />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-900 dark:text-white">
                      {isEn ? 'Compare (Version 1 vs Version 2)' : 'Comparar (Versión 1 vs Versión 2)'}
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {isEn
                        ? 'Test both versions simultaneously on screen'
                        : 'Cala ambas versiones al mismo tiempo en pantalla'}
                    </p>
                  </div>
                </div>
                {activeTab === 'compare' && (
                  <CheckCircle2 size={18} className="text-orange-500 shrink-0" />
                )}
              </div>
            </div>

            {/* Opción 4: TEST FULLSCREEN (Vista Teléfono Real 100%) */}
            <button
              type="button"
              onClick={() => enterTestFullscreen(activeTab === 'v1' ? 'v1' : 'v2')}
              className="w-full p-3.5 rounded-xl border-2 border-[#FDC82F] bg-gradient-to-r from-[#50050a] to-red-800 hover:from-[#3d0307] hover:to-red-900 text-left shadow-md transition-all cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-[#FDC82F] text-[#121212] flex items-center justify-center font-black text-xs shadow-xs shrink-0">
                    <Maximize2 size={17} strokeWidth={2.5} />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-[#FDC82F]">
                      {isEn
                        ? 'TEST FULLSCREEN (Phone View)'
                        : 'TEST FULLSCREEN (Vista Teléfono)'}
                    </h3>
                    <p className="text-[11px] text-white/90">
                      {isEn
                        ? 'Open 100% fullscreen without bezels for mobile testing'
                        : 'Abrir al 100% sin bordes para probar directo en tu celular'}
                    </p>
                  </div>
                </div>
              </div>
            </button>
          </div>

          {/* Controles Rápidos para Saltar a Cualquier Pantalla de la Versión 2 */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-4 shadow-xs space-y-2.5">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {isEn
                  ? 'VERSION 2 — DIRECT SCREEN JUMP'
                  : 'PANTALLAS — VERSIÓN 2'}
              </h2>
            </div>

            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => jumpToV2State('stories', 0)}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 hover:bg-orange-50 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800 text-left text-xs font-bold text-slate-700 dark:text-slate-200 transition-all cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Play size={13} className="text-red-600" />
                  <span>
                    {isEn
                      ? '1. Slide 1: New White Bag "Ya está." Lifestyle'
                      : '1. Lámina 1: Bolsa Blanca "Ya está."'}
                  </span>
                </span>
                <span className="text-[10px] font-mono text-slate-400">00:03</span>
              </button>

              <button
                type="button"
                onClick={() => jumpToV2State('stories', 1)}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 hover:bg-orange-50 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800 text-left text-xs font-bold text-slate-700 dark:text-slate-200 transition-all cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <ShoppingBag size={13} className="text-amber-500" />
                  <span>
                    {isEn
                      ? '2. Slide 2: Express Pickup & Direct Delivery'
                      : '2. Lámina 2: Pickup Express y Delivery'}
                  </span>
                </span>
                <span className="text-[10px] font-mono text-slate-400">00:08</span>
              </button>

              <button
                type="button"
                onClick={() => jumpToV2State('stories', 2)}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 hover:bg-orange-50 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800 text-left text-xs font-bold text-slate-700 dark:text-slate-200 transition-all cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <MapPin size={13} className="text-emerald-500" />
                  <span>
                    {isEn
                      ? '3. Slide 3: "MUST. FIND. TACOS. FAST." (GPS)'
                      : '3. Lámina 3: "URGENTE. TACOS. YA." (GPS)'}
                  </span>
                </span>
                <span className="text-[10px] font-mono text-slate-400">00:13</span>
              </button>

              <button
                type="button"
                onClick={() => jumpToV2State('stories', 3)}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 hover:bg-orange-50 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800 text-left text-xs font-bold text-slate-700 dark:text-slate-200 transition-all cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Heart size={13} className="text-red-500" />
                  <span>
                    {isEn
                      ? '4. Slide 4: Saved Favorites & 1-Tap Reorder'
                      : '4. Lámina 4: Tus Favoritos Guardados'}
                  </span>
                </span>
                <span className="text-[10px] font-mono text-slate-400">00:16</span>
              </button>

              <button
                type="button"
                onClick={() => jumpToV2State('stories', 4)}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 hover:bg-orange-50 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800 text-left text-xs font-bold text-slate-700 dark:text-slate-200 transition-all cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Flame size={13} className="text-orange-500" />
                  <span>
                    {isEn
                      ? '5. Slide 5: Order Ahead + "GET STARTED!"'
                      : '5. Lámina 5: Pide sin Fila + "¡EMPEZAR!"'}
                  </span>
                </span>
                <span className="text-[10px] font-mono text-slate-400">00:24</span>
              </button>

              <button
                type="button"
                onClick={() => jumpToV2State('hello', 4, 'home', null, false)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 hover:bg-orange-50 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800 text-left text-xs font-bold text-slate-700 dark:text-slate-200 transition-all cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Hand size={13} className="text-amber-500" />
                  <span>
                    {isEn
                      ? '6. Welcome Gate: "HELLO! / ¡HOLA!"'
                      : '6. Puerta de Bienvenida: "¡HOLA! / HELLO!"'}
                  </span>
                </span>
                <span className="text-[10px] font-mono text-slate-400">00:26</span>
              </button>

              <button
                type="button"
                onClick={() => jumpToV2State('hello', 4, 'home', 'sms-otp', false)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 hover:bg-orange-50 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800 text-left text-xs font-bold text-slate-700 dark:text-slate-200 transition-all cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <User size={13} className="text-emerald-600" />
                  <span>
                    {isEn
                      ? '7. Real 6-Digit Email Code Sign-In'
                      : '7. Login Real con Código de 6 Dígitos al Correo'}
                  </span>
                </span>
                <span className="text-[10px] font-mono text-emerald-600">Email OTP</span>
              </button>

              <button
                type="button"
                onClick={() => jumpToV2State('main', 0, 'home', null, false)}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-gradient-to-r from-[#50050a] to-red-700 hover:from-[#3d0307] hover:to-red-800 text-[#FDC82F] border border-[#FDC82F]/50 text-left text-xs font-black shadow-xs transition-all cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Home size={13} />
                  <span>
                    {isEn
                      ? '8. Home Tab (Specialties + Official Menu)'
                      : '8. Pestaña Inicio (Especialidades + Nuestro Menú)'}
                  </span>
                </span>
                <span className="text-[10px] font-mono text-white/90">Home</span>
              </button>

              <button
                type="button"
                onClick={() => jumpToV2State('main', 0, 'order', null, false)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 hover:bg-orange-50 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800 text-left text-xs font-bold text-slate-700 dark:text-slate-200 transition-all cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <ShoppingBag size={13} className="text-emerald-600" />
                  <span>
                    {isEn
                      ? '9. Order Tab (Official Toast Checkout)'
                      : '9. Pestaña Ordenar (Checkout Oficial Toast)'}
                  </span>
                </span>
                <span className="text-[10px] font-mono text-slate-400">Order</span>
              </button>

              <button
                type="button"
                onClick={() => jumpToV2State('main', 0, 'stores', null, false)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 hover:bg-orange-50 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800 text-left text-xs font-bold text-slate-700 dark:text-slate-200 transition-all cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <MapPin size={13} className="text-amber-500" />
                  <span>
                    {isEn
                      ? '10. Stores Tab (15 Locations + Live Hours)'
                      : '10. Pestaña Sucursales (15 Tiendas + Horarios)'}
                  </span>
                </span>
                <span className="text-[10px] font-mono text-slate-400">Stores</span>
              </button>

              <button
                type="button"
                onClick={() => jumpToV2State('main', 0, 'account', null, false)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 hover:bg-orange-50 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800 text-left text-xs font-bold text-slate-700 dark:text-slate-200 transition-all cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <User size={13} className="text-slate-500" />
                  <span>
                    {isEn
                      ? '11. Account Tab (Profile, Email OTP & Support)'
                      : '11. Pestaña Cuenta (Perfil, Código al Correo y Soporte)'}
                  </span>
                </span>
                <span className="text-[10px] font-mono text-slate-400">Account</span>
              </button>

              <button
                type="button"
                onClick={() => jumpToV2State('main', 0, 'home', null, true)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 border border-emerald-300 dark:border-emerald-800 text-left text-xs font-black text-emerald-700 dark:text-emerald-300 transition-all cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <CheckCircle2 size={13} className="text-emerald-600" />
                  <span>
                    {isEn
                      ? '12. Logged-In Home (Personalized Greeting)'
                      : '12. Inicio con Sesión Activa (Saludo Personalizado)'}
                  </span>
                </span>
                <span className="text-[10px] font-mono text-emerald-600">Active</span>
              </button>
            </div>
          </div>
        </div>

        {/* COLUMNA DERECHA: ESCENARIO INTERACTIVO DE SIMULACIÓN MÓVIL CON ISLA DINÁMICA */}
        <div className="xl:col-span-8 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-4 sm:p-6 shadow-xs flex flex-col items-center justify-center min-h-[840px]">
          {/* Barra Superior del Simulador: Control de Isla Dinámica y Safe Area iPhone */}
          <div className="w-full mb-5 px-4 py-2.5 rounded-xl bg-slate-100/90 dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-6 h-3 rounded-full bg-black border border-slate-700 flex items-center justify-end pr-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              </div>
              <span className="text-xs font-black text-slate-800 dark:text-slate-200">
                {isEn
                  ? 'iPhone 16 Pro • Dynamic Island + Top iOS Status Bar'
                  : 'iPhone 16 Pro • Isla Dinámica + Barra Superior iOS'}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setIslandOverlayMode(false)}
                className={`px-3 py-1 rounded-lg text-[11px] font-black transition-all cursor-pointer ${
                  !islandOverlayMode
                    ? 'bg-[#50050a] text-[#FDC82F] shadow-xs'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                }`}
              >
                {isEn ? 'iOS Safe Area (Coupled)' : 'Safe Area iOS (Acoplado)'}
              </button>
              <button
                type="button"
                onClick={() => setIslandOverlayMode(true)}
                className={`px-3 py-1 rounded-lg text-[11px] font-black transition-all cursor-pointer ${
                  islandOverlayMode
                    ? 'bg-[#50050a] text-[#FDC82F] shadow-xs'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                }`}
              >
                {isEn ? 'Overlaid (No Offset)' : 'Superpuesto (Sin Offset)'}
              </button>
            </div>
          </div>

          {activeTab === 'v1' && (
            <div className="flex flex-col items-center w-full">
              <div className="mb-4 flex items-center justify-between w-full max-w-[420px]">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-black">
                    {isEn ? 'Version 1' : 'Versión 1'}
                  </span>
                  <button
                    type="button"
                    onClick={() => enterTestFullscreen('v1')}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#FDC82F] hover:bg-amber-400 text-[#121212] text-[11px] font-black cursor-pointer"
                  >
                    <Maximize2 size={11} />
                    <span>TEST FULLSCREEN</span>
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setV1ReloadKey((k) => k + 1)}
                  className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer"
                >
                  <RotateCcw size={13} />
                  <span>{isEn ? 'Reload' : 'Reiniciar'}</span>
                </button>
              </div>

              {/* Chasis iPhone 16 Pro con Botones Laterales + Isla Dinámica */}
              <div className="relative w-full max-w-[420px] h-[826px] rounded-[50px] bg-[#18181c] p-[11px] shadow-[0_28px_75px_rgba(0,0,0,0.4)] ring-2 ring-[#3f3f46]">
                {/* Botones físicos laterales iPhone */}
                <div className="absolute top-24 -left-[4px] w-[3px] h-7 rounded-l bg-[#3f3f46]" />
                <div className="absolute top-36 -left-[4px] w-[3px] h-12 rounded-l bg-[#3f3f46]" />
                <div className="absolute top-52 -left-[4px] w-[3px] h-12 rounded-l bg-[#3f3f46]" />
                <div className="absolute top-40 -right-[4px] w-[3px] h-16 rounded-r bg-[#3f3f46]" />
                {/* Ranura superior de bocina */}
                <div className="absolute top-[5px] left-1/2 -translate-x-1/2 w-14 h-[3px] rounded-full bg-black/80 border border-white/10" />

                <div className="relative w-full h-full rounded-[39px] bg-white overflow-hidden flex flex-col">
                  <IPhoneStatusBarWithIsland overlay={islandOverlayMode} darkIcons />
                  <iframe
                    key={v1ReloadKey}
                    src="/app/index.html?nosplash=1"
                    className="w-full flex-1 border-0 bg-white"
                    title="Tacos Gavilan App Versión 1"
                  />
                  <div className="absolute bottom-1.5 inset-x-0 z-30 pointer-events-none flex justify-center">
                    <div className="w-[126px] h-[4.5px] rounded-full bg-slate-900/35" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'v2' && (
            <div className="flex flex-col items-center w-full">
              <div className="mb-4 flex items-center justify-between w-full max-w-[420px]">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 rounded-full bg-gradient-to-r from-[#50050a] to-red-700 text-[#FDC82F] text-xs font-black">
                    {isEn ? 'Version 2' : 'Versión 2'}
                  </span>
                  <button
                    type="button"
                    onClick={() => enterTestFullscreen('v2')}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#FDC82F] hover:bg-amber-400 text-[#121212] text-[11px] font-black cursor-pointer"
                  >
                    <Maximize2 size={11} />
                    <span>TEST FULLSCREEN</span>
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => jumpToV2State('stories', 0)}
                  className="inline-flex items-center gap-1 text-xs font-bold text-orange-600 hover:underline cursor-pointer"
                >
                  <RotateCcw size={13} />
                  <span>{isEn ? 'Restart Intro' : 'Reiniciar Intro'}</span>
                </button>
              </div>

              {/* Chasis iPhone 16 Pro con Botones Laterales + Isla Dinámica */}
              <div className="relative w-full max-w-[420px] h-[826px] rounded-[50px] bg-[#18181c] p-[11px] shadow-[0_28px_75px_rgba(0,0,0,0.48)] ring-2 ring-amber-500/50">
                <div className="absolute top-24 -left-[4px] w-[3px] h-7 rounded-l bg-[#3f3f46]" />
                <div className="absolute top-36 -left-[4px] w-[3px] h-12 rounded-l bg-[#3f3f46]" />
                <div className="absolute top-52 -left-[4px] w-[3px] h-12 rounded-l bg-[#3f3f46]" />
                <div className="absolute top-40 -right-[4px] w-[3px] h-16 rounded-r bg-[#3f3f46]" />
                <div className="absolute top-[5px] left-1/2 -translate-x-1/2 w-14 h-[3px] rounded-full bg-black/80 border border-white/10" />

                <div className="relative w-full h-full rounded-[39px] bg-[#121212] overflow-hidden">
                  <CustomerAppV2Pro
                    embedded
                    islandOverlayMode={islandOverlayMode}
                    externalStage={v2Stage}
                    externalStoryIndex={v2StoryIdx}
                    externalTab={v2MainTab}
                    externalAuthSheet={v2AuthSheet}
                    externalLoggedInDemo={v2LoggedInDemo}
                    controlTick={controlTick}
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'compare' && (
            <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-6 items-start justify-items-center">
              {/* Lado Izquierdo: Versión 1 con Isla Dinámica + Barra Superior iPhone */}
              <div className="flex flex-col items-center w-full max-w-[395px]">
                <div className="mb-3 flex items-center justify-between w-full">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-black">
                      {isEn ? 'Version 1' : 'Versión 1'}
                    </span>
                    <button
                      type="button"
                      onClick={() => enterTestFullscreen('v1')}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-900 dark:bg-slate-700 text-white text-[10px] font-bold cursor-pointer"
                    >
                      <Maximize2 size={10} />
                      <span>Fullscreen</span>
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setV1ReloadKey((k) => k + 1)}
                    className="text-xs font-bold text-slate-500 hover:text-slate-900 cursor-pointer"
                  >
                    <RotateCcw size={13} />
                  </button>
                </div>

                <div className="relative w-full h-[786px] rounded-[46px] bg-[#18181c] p-[10px] shadow-2xl ring-2 ring-[#3f3f46]">
                  <div className="absolute top-24 -left-[3px] w-[3px] h-6 rounded-l bg-[#3f3f46]" />
                  <div className="absolute top-34 -left-[3px] w-[3px] h-11 rounded-l bg-[#3f3f46]" />
                  <div className="absolute top-48 -left-[3px] w-[3px] h-11 rounded-l bg-[#3f3f46]" />
                  <div className="absolute top-36 -right-[3px] w-[3px] h-14 rounded-r bg-[#3f3f46]" />
                  <div className="absolute top-[4px] left-1/2 -translate-x-1/2 w-12 h-[3px] rounded-full bg-black/80 border border-white/10" />

                  <div className="relative w-full h-full rounded-[36px] bg-white overflow-hidden flex flex-col">
                    <IPhoneStatusBarWithIsland overlay={islandOverlayMode} darkIcons />
                    <iframe
                      key={`cmp-${v1ReloadKey}`}
                      src="/app/index.html?nosplash=1"
                      className="w-full flex-1 border-0 bg-white"
                      title="Tacos Gavilan V1 Compare"
                    />
                    <div className="absolute bottom-1.5 inset-x-0 z-30 pointer-events-none flex justify-center">
                      <div className="w-[120px] h-[4px] rounded-full bg-slate-900/35" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Lado Derecho: Versión 2 con Isla Dinámica + Barra Superior iPhone */}
              <div className="flex flex-col items-center w-full max-w-[395px]">
                <div className="mb-3 flex items-center justify-between w-full">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded-full bg-gradient-to-r from-[#50050a] to-red-700 text-[#FDC82F] text-xs font-black">
                      {isEn ? 'Version 2' : 'Versión 2'}
                    </span>
                    <button
                      type="button"
                      onClick={() => enterTestFullscreen('v2')}
                      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#FDC82F] hover:bg-amber-400 text-[#121212] text-[10px] font-black cursor-pointer"
                    >
                      <Maximize2 size={10} />
                      <span>TEST FULLSCREEN</span>
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => jumpToV2State('stories', 0)}
                    className="text-xs font-bold text-orange-600 hover:underline cursor-pointer"
                  >
                    <RotateCcw size={13} />
                  </button>
                </div>

                <div className="relative w-full h-[786px] rounded-[46px] bg-[#18181c] p-[10px] shadow-2xl ring-2 ring-amber-500/50">
                  <div className="absolute top-24 -left-[3px] w-[3px] h-6 rounded-l bg-[#3f3f46]" />
                  <div className="absolute top-34 -left-[3px] w-[3px] h-11 rounded-l bg-[#3f3f46]" />
                  <div className="absolute top-48 -left-[3px] w-[3px] h-11 rounded-l bg-[#3f3f46]" />
                  <div className="absolute top-36 -right-[3px] w-[3px] h-14 rounded-r bg-[#3f3f46]" />
                  <div className="absolute top-[4px] left-1/2 -translate-x-1/2 w-12 h-[3px] rounded-full bg-black/80 border border-white/10" />

                  <div className="relative w-full h-full rounded-[36px] bg-[#121212] overflow-hidden">
                    <CustomerAppV2Pro
                      embedded
                      islandOverlayMode={islandOverlayMode}
                      externalStage={v2Stage}
                      externalStoryIndex={v2StoryIdx}
                      externalTab={v2MainTab}
                      externalAuthSheet={v2AuthSheet}
                      externalLoggedInDemo={v2LoggedInDemo}
                      controlTick={controlTick}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal para Probar el Splash Oficial de Tacos Gavilan (Logo Circular con Anillo Blanco al Ras) */}
      <AnimatePresence>
        {showSplashModal && (
          <motion.div
            key="splash-preview-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowSplashModal(false)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#50050a] overflow-hidden cursor-pointer"
          >
            <div className="absolute top-5 right-5 z-20 px-4 py-2 rounded-full bg-black/40 text-white text-xs font-bold border border-white/20">
              {isEn ? 'Click anywhere to close' : 'Haz clic en cualquier lugar para cerrar'}
            </div>

            <div className="relative z-10 flex flex-col items-center">
              <motion.div
                initial={{ y: -800, opacity: 0, rotateY: 0 }}
                animate={{
                  y: 0,
                  opacity: 1,
                  rotateY: 2520,
                  transition: {
                    type: 'spring',
                    damping: 10,
                    stiffness: 20,
                    duration: 4.5,
                  },
                }}
                className="w-48 h-48 rounded-full shadow-[0_16px_45px_rgba(0,0,0,0.45)] relative flex items-center justify-center"
              >
                <img
                  src="/logo.png?v=75"
                  alt="Tacos Gavilan"
                  className="w-full h-full object-contain"
                />
                <motion.div
                  className="absolute inset-0 rounded-full border border-white/50 pointer-events-none"
                  initial={{ scale: 0, opacity: 0.8 }}
                  animate={{
                    scale: 3,
                    opacity: 0,
                    transition: {
                      duration: 2,
                      repeat: Infinity,
                      delay: 1.2,
                      ease: 'easeOut',
                    },
                  }}
                />
              </motion.div>

              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{
                  opacity: 1,
                  scale: 1,
                  transition: { delay: 1, duration: 0.5 },
                }}
                className="mt-8 w-64 h-24 flex items-center justify-center"
              >
                <img
                  src="/ya esta.png"
                  alt="¡Ya está!"
                  className="w-full h-full object-contain drop-shadow-[0_0_15px_rgba(253,200,47,0.5)]"
                />
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function MobileAppPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 flex items-center justify-center">
          <img
            src="/logo.png?v=75"
            alt="Tacos Gavilan"
            className="w-16 h-16 object-contain animate-pulse"
          />
        </div>
      }
    >
      <AppClientesWorkspaceContent />
    </Suspense>
  )
}
