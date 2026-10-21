/**
 * @module app/app/page
 * @description Módulo "App Clientes" — Centro de Pruebas y Versiones de la Aplicación Móvil de Tacos Gavilan.
 * Al hacer clic en "App Clientes" en la barra lateral izquierda (`AppSidebar`), se abre en el panel derecho
 * principal el laboratorio interactivo con pestañas para probar cada versión:
 *   1. Versión 1
 *   2. Versión 2
 *   3. Comparar Lado a Lado (Versión 1 vs Versión 2)
 *
 * @businessRules
 * - **Marca Oficial**: Tacos Gavilan (presentación 1:1 de marca y colores corporativos #50050a y #FDC82F).
 * - **Integración en Panel Derecho**: Se renderiza dentro del área de trabajo principal a la derecha de `AppSidebar`
 *   (igual que Centro de Actividades y Sitio Web), y ofrece además un modo opcional de Pantalla Completa (`?fullscreen=1`).
 * - **Preservación Total de Versión 1**: La Versión 1 carga intacto `/app/index.html?nosplash=1`.
 *
 * @dataFlow
 * - Lee `?v=1|2|compare` y `?fullscreen=1` desde `useSearchParams()` -> Renderiza el panel derecho con pestañas o vista fullscreen.
 *
 * @notes
 * - Incluye controles rápidos en la columna izquierda del área de trabajo para saltar a cualquier lámina o etapa de la Versión 2.
 */

'use client'

import React, { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Smartphone,
  Sparkles,
  Columns,
  Play,
  ExternalLink,
  Maximize2,
  RotateCcw,
  CheckCircle2,
  Bell,
  MapPin,
  QrCode,
  Flame,
  Home,
  Hand,
  Info,
  ArrowLeft,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useLanguage } from '@/lib/i18n'
import CustomerAppV2Pro, {
  type V2Stage,
  type MainTab,
  type V2AuthSheet,
} from '@/components/CustomerAppV2Pro'

type ActiveVersionTab = 'v1' | 'v2' | 'compare'

function AppClientesWorkspaceContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { language } = useLanguage()
  const isEn = language === 'en'

  const vParam = searchParams.get('v')
  const isFullscreenMode = searchParams.get('fullscreen') === '1'

  const [activeTab, setActiveTab] = useState<ActiveVersionTab>(() => {
    if (vParam === '1') return 'v1'
    if (vParam === 'compare') return 'compare'
    return 'v2'
  })

  // Controls to jump to any stage/slide/auth sheet of Version 2 from the left control column
  const [v2Stage, setV2Stage] = useState<V2Stage | null>('stories')
  const [v2StoryIdx, setV2StoryIdx] = useState<number | null>(0)
  const [v2MainTab, setV2MainTab] = useState<MainTab | null>('home')
  const [v2AuthSheet, setV2AuthSheet] = useState<V2AuthSheet>(null)
  const [v2LoggedInDemo, setV2LoggedInDemo] = useState(false)
  const [controlTick, setControlTick] = useState(0)
  const [v1ReloadKey, setV1ReloadKey] = useState(0)
  const [showSplashModal, setShowSplashModal] = useState(false)

  useEffect(() => {
    if (vParam === '1') setActiveTab('v1')
    else if (vParam === '2') setActiveTab('v2')
    else if (vParam === 'compare') setActiveTab('compare')
  }, [vParam])

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
  }

  // Modo Pantalla Completa Dedicado (?fullscreen=1)
  if (isFullscreenMode) {
    return (
      <div className="fixed inset-0 w-full h-full bg-[#50050a] overflow-hidden flex items-center justify-center select-none">
        <div className="fixed top-3 right-3 z-50 flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.push(`/app?v=${activeTab === 'v1' ? '1' : '2'}`)}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#50050a]/95 hover:bg-[#3d0307] text-white border border-[#FDC82F]/70 shadow-2xl text-xs font-bold cursor-pointer"
          >
            <ArrowLeft size={14} className="text-[#FDC82F]" />
            <span>{isEn ? 'Back to App Lab' : 'Volver al Panel de Versiones'}</span>
          </button>
        </div>

        {activeTab === 'v1' ? (
          <iframe
            src="/app/index.html?nosplash=1"
            className="w-full h-full border-0"
            title="Tacos Gavilan App V1"
          />
        ) : (
          <CustomerAppV2Pro />
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5 pb-10">
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
              onClick={() =>
                router.push(`/app?v=${activeTab === 'v1' ? '1' : '2'}&fullscreen=1`)
              }
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-bold transition-all cursor-pointer"
            >
              <Maximize2 size={13} />
              <span>{isEn ? 'Fullscreen Mode' : 'Pantalla Completa'}</span>
            </button>
          </div>
        </div>

        {/* Barra de Pestañas (Versión 1 | Versión 2 | Comparar) */}
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
                      ? 'Slide 1: New White Bag "Ya está." Lifestyle'
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
                  <Bell size={13} className="text-amber-500" />
                  <span>
                    {isEn
                      ? 'Slide 2: Order Notification Alerts'
                      : '2. Lámina 2: Notificaciones de Orden'}
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
                      ? 'Slide 3: "MUST. FIND. TACOS. FAST." (GPS)'
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
                  <QrCode size={13} className="text-purple-500" />
                  <span>
                    {isEn
                      ? 'Slide 4: Fast-Pass QR Card'
                      : '4. Lámina 4: Tarjeta QR Fast-Pass'}
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
                      ? 'Slide 5: Order Ahead + "GET STARTED!"'
                      : '5. Lámina 5: Pide sin Fila + "¡EMPEZAR!"'}
                  </span>
                </span>
                <span className="text-[10px] font-mono text-slate-400">00:24</span>
              </button>

              <button
                type="button"
                onClick={() => jumpToV2State('hello', 0, 'home', null, false)}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-[#18181b] hover:bg-black text-white border border-slate-700 text-left text-xs font-black transition-all cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Hand size={13} className="text-[#FDC82F]" />
                  <span>
                    {isEn
                      ? '6. Welcome Gate: "HELLO!" (Apple + Android)'
                      : '6. Portada "¡HOLA!" (Apple + Google Android)'}
                  </span>
                </span>
                <span className="text-[10px] font-mono text-[#FDC82F]">02:05</span>
              </button>

              <button
                type="button"
                onClick={() => jumpToV2State('hello', 0, 'home', 'apple-sheet', false)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 hover:bg-orange-50 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800 text-left text-xs font-bold text-slate-700 dark:text-slate-200 transition-all cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Smartphone size={13} className="text-slate-900 dark:text-white" />
                  <span>
                    {isEn
                      ? '7. Apple Sign-In (iOS Face ID Sheet)'
                      : '7. Acceso con Apple (iOS Face ID)'}
                  </span>
                </span>
                <span className="text-[10px] font-mono text-slate-400">iOS</span>
              </button>

              <button
                type="button"
                onClick={() => jumpToV2State('hello', 0, 'home', 'google-sheet', false)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 hover:bg-orange-50 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800 text-left text-xs font-bold text-slate-700 dark:text-slate-200 transition-all cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Smartphone size={13} className="text-blue-600" />
                  <span>
                    {isEn
                      ? '8. Google Sign-In (Android Account Sheet)'
                      : '8. Acceso con Google (Android)'}
                  </span>
                </span>
                <span className="text-[10px] font-mono text-blue-500">Android</span>
              </button>

              <button
                type="button"
                onClick={() => jumpToV2State('hello', 0, 'home', 'login', false)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 hover:bg-orange-50 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800 text-left text-xs font-bold text-slate-700 dark:text-slate-200 transition-all cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <CheckCircle2 size={13} className="text-emerald-600" />
                  <span>
                    {isEn
                      ? '9. "Log In" Card Modal (Email + Password)'
                      : '9. Modal "Iniciar Sesión" (Correo + Clave)'}
                  </span>
                </span>
                <span className="text-[10px] font-mono text-slate-400">02:05</span>
              </button>

              <button
                type="button"
                onClick={() => jumpToV2State('hello', 0, 'home', 'signup', false)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 hover:bg-orange-50 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800 text-left text-xs font-bold text-slate-700 dark:text-slate-200 transition-all cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Sparkles size={13} className="text-amber-500" />
                  <span>
                    {isEn
                      ? '10. "Sign Up" Form (Full Registration)'
                      : '10. Formulario "Crear Cuenta" (Registro)'}
                  </span>
                </span>
                <span className="text-[10px] font-mono text-slate-400">02:14</span>
              </button>

              <button
                type="button"
                onClick={() => jumpToV2State('hello', 0, 'home', 'verify-email', false)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 hover:bg-orange-50 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800 text-left text-xs font-bold text-slate-700 dark:text-slate-200 transition-all cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Bell size={13} className="text-red-500" />
                  <span>
                    {isEn
                      ? '11. Email Verification + Push Banner'
                      : '11. Verificación de Correo + Notificación'}
                  </span>
                </span>
                <span className="text-[10px] font-mono text-slate-400">02:15</span>
              </button>

              <button
                type="button"
                onClick={() => jumpToV2State('main', 0, 'home', null, true)}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-gradient-to-r from-[#50050a] to-red-700 hover:from-[#3d0307] hover:to-red-800 text-[#FDC82F] border border-[#FDC82F]/50 text-left text-xs font-black shadow-xs transition-all cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Home size={13} />
                  <span>
                    {isEn
                      ? '12. Logged-In Home ("Good Afternoon, CARLOS")'
                      : '12. Home Logueado ("Buenas tardes, CARLOS")'}
                  </span>
                </span>
                <span className="text-[10px] font-mono text-white/90">02:16</span>
              </button>
            </div>
          </div>
        </div>

        {/* COLUMNA DERECHA: ESCENARIO INTERACTIVO DE SIMULACIÓN MÓVIL */}
        <div className="xl:col-span-8 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-4 sm:p-6 shadow-xs flex flex-col items-center justify-center min-h-[840px]">
          {activeTab === 'v1' && (
            <div className="flex flex-col items-center w-full">
              <div className="mb-4 flex items-center justify-between w-full max-w-[420px]">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-black">
                    {isEn ? 'Version 1' : 'Versión 1'}
                  </span>
                  <span className="text-xs text-slate-500">
                    {isEn ? 'Interactive live preview' : 'Vista interactiva en vivo'}
                  </span>
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

              <div className="w-full max-w-[420px] h-[810px] rounded-[42px] bg-[#121212] p-2.5 shadow-[0_25px_70px_rgba(0,0,0,0.35)] ring-1 ring-slate-300 dark:ring-slate-700 overflow-hidden">
                <iframe
                  key={v1ReloadKey}
                  src="/app/index.html?nosplash=1"
                  className="w-full h-full rounded-[34px] border-0 bg-white"
                  title="Tacos Gavilan App Versión 1"
                />
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

              <div className="w-full max-w-[420px] h-[810px] rounded-[42px] bg-[#121212] p-2.5 shadow-[0_25px_70px_rgba(0,0,0,0.45)] ring-1 ring-amber-500/40 overflow-hidden">
                <CustomerAppV2Pro
                  embedded
                  externalStage={v2Stage}
                  externalStoryIndex={v2StoryIdx}
                  externalTab={v2MainTab}
                  externalAuthSheet={v2AuthSheet}
                  externalLoggedInDemo={v2LoggedInDemo}
                  controlTick={controlTick}
                />
              </div>
            </div>
          )}

          {activeTab === 'compare' && (
            <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-6 items-start justify-items-center">
              {/* Lado Izquierdo: Versión 1 */}
              <div className="flex flex-col items-center w-full max-w-[390px]">
                <div className="mb-3 flex items-center justify-between w-full">
                  <span className="px-2.5 py-1 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-black">
                    {isEn ? 'Version 1' : 'Versión 1'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setV1ReloadKey((k) => k + 1)}
                    className="text-xs font-bold text-slate-500 hover:text-slate-900 cursor-pointer"
                  >
                    <RotateCcw size={13} />
                  </button>
                </div>
                <div className="w-full h-[760px] rounded-[38px] bg-[#121212] p-2 shadow-xl ring-1 ring-slate-300 dark:ring-slate-700 overflow-hidden">
                  <iframe
                    key={`cmp-${v1ReloadKey}`}
                    src="/app/index.html?nosplash=1"
                    className="w-full h-full rounded-[30px] border-0 bg-white"
                    title="Tacos Gavilan V1 Compare"
                  />
                </div>
              </div>

              {/* Lado Derecho: Versión 2 PRO */}
              <div className="flex flex-col items-center w-full max-w-[390px]">
                <div className="mb-3 flex items-center justify-between w-full">
                  <span className="px-2.5 py-1 rounded-full bg-gradient-to-r from-[#50050a] to-red-700 text-[#FDC82F] text-xs font-black">
                    {isEn ? 'Version 2' : 'Versión 2'}
                  </span>
                  <button
                    type="button"
                    onClick={() => jumpToV2State('stories', 0)}
                    className="text-xs font-bold text-orange-600 hover:underline cursor-pointer"
                  >
                    <RotateCcw size={13} />
                  </button>
                </div>
                <div className="w-full h-[760px] rounded-[38px] bg-[#121212] p-2 shadow-xl ring-1 ring-amber-500/40 overflow-hidden">
                  <CustomerAppV2Pro
                    embedded
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
                  src="/logo.png"
                  alt="Tacos Gavilan"
                  className="w-full h-full rounded-full object-contain"
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
            src="/logo.png"
            alt="Tacos Gavilan"
            className="w-16 h-16 rounded-full object-contain animate-pulse"
          />
        </div>
      }
    >
      <AppClientesWorkspaceContent />
    </Suspense>
  )
}
