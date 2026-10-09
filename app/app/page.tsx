/**
 * @module app/app/page
 * @description Visor Web Fullscreen de la Aplicación Móvil de Pedidos de Tacos Gavilan.
 * Permite a comensales, gerentes y supervisores acceder, consultar y probar la experiencia
 * de pedidos en línea desde cualquier dispositivo móvil o de escritorio como si estuviera
 * instalada nativamente en el teléfono.
 * 
 * @businessRules
 * - **Marca Oficial**: Tacos Gavilan (presentación 1:1 de marca y colores corporativos #50050a y #FDC82F).
 * - **Consulta y Pedidos**: Accesible desde la barra lateral de TEG System para consulta de menú y pruebas.
 * - **Pantalla Completa Nativa**: Sin barras de navegación externas de TEG System, simulando una app descargada.
 * - **Botón de Salida Temporal**: Botón flotante estilizado para regresar al panel administrativo cuando se ejecuta
 *   en entornos locales (localhost:3000) o en producción Vercel (*.vercel.app).
 * - **Soporte de Teclado**: La tecla [Escape] permite salir rápidamente hacia el Dashboard.
 * 
 * @dataFlow
 * - Carga el bundle web optimizado de la app móvil desde /app/index.html dentro de un iframe aislado.
 * - Conecta con useRouter para retornar al dashboard de TEG System al presionar el botón de salida.
 * 
 * @notes
 * - La integración vía iframe aislado garantiza que los estilos de Tailwind v4 de TEG System no colisionen
 *   con el runtime ni fuentes de React Native Web.
 * - Se detectan áreas seguras móviles (safe-area-inset-top) para evitar superposición con el notch de iPhone.
 */

'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Maximize2, Minimize2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useLanguage } from '@/lib/i18n'

export default function MobileAppPage() {
  const router = useRouter()
  const { t, language } = useLanguage()
  const [isTegHost, setIsTegHost] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showSplash, setShowSplash] = useState(true)

  // Detectar si se está ejecutando desde localhost, IP local o Vercel
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const host = window.location.hostname
      const port = window.location.port
      const isDevOrVercel =
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host.startsWith('192.168.') ||
        host.includes('vercel.app') ||
        port === '3000' ||
        port === '3001'
      setIsTegHost(isDevOrVercel)
    }
  }, [])

  // Temporizador idéntico a TEG System login (4.5s) con soporte de tap instantáneo
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSplash(false)
    }, 4500)
    return () => clearTimeout(timer)
  }, [])

  // Salir hacia el panel administrativo
  const handleExit = () => {
    if (typeof window !== 'undefined' && window.history.length > 2) {
      router.back()
    } else {
      router.push('/dashboard')
    }
  }

  // Soporte de tecla Escape para salir rápidamente
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleExit()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Alternar pantalla completa nativa del navegador en desktop
  const toggleFullscreen = () => {
    if (typeof document === 'undefined') return
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {})
      setIsFullscreen(true)
    } else {
      document.exitFullscreen().catch(() => {})
      setIsFullscreen(false)
    }
  }

  return (
    <div className="fixed inset-0 w-full h-full bg-[#50050a] overflow-hidden flex items-center justify-center select-none">
      {/* 🚀 SPLASH OFICIAL 1:1 EXACTAMENTE IDÉNTICO AL INICIO DE SESIÓN DE TEG SYSTEM */}
      <AnimatePresence>
        {showSplash && (
          <motion.div
            key="teg-official-splash"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45 }}
            onClick={() => setShowSplash(false)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#50050a] overflow-hidden cursor-pointer"
          >
            {/* Textura sutil idéntica a TEG System */}
            <div className="absolute inset-0 opacity-10 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] pointer-events-none" />

            <div className="relative z-10 flex flex-col items-center">
              {/* Main Logo Container - Drop In Animation (1:1 login) */}
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
                className="w-48 h-48 rounded-full bg-gradient-to-br from-[#fdc82f] to-[#e69b00] p-1.5 shadow-[0_0_60px_rgba(253,200,47,0.4)] relative"
              >
                <div className="w-full h-full rounded-full bg-white flex items-center justify-center overflow-hidden border-4 border-[#fffbeb]">
                  <img src="/logo.png" alt="Tacos Gavilan" className="w-[85%] h-[85%] object-contain" />
                </div>

                {/* Ripple Effect (Child of the logo to follow position if needed) */}
                <motion.div
                  className="absolute inset-0 rounded-full border border-white/50"
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

              {/* Slogan Container con eslogan oficial ¡Ya está! */}
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

      {/* Opción flotante para salir al Sistema TEG (temporal para localhost y Vercel) */}
      {isTegHost && (
        <div className="fixed bottom-20 right-3 sm:bottom-auto sm:top-3 sm:right-3 z-40 flex items-center gap-2 select-none">
          {/* Botón opcional de pantalla completa en escritorio */}
          <button
            onClick={toggleFullscreen}
            className="hidden md:flex items-center justify-center w-8 h-8 rounded-full bg-black/60 hover:bg-black/85 text-white/80 hover:text-white border border-white/20 backdrop-blur-md shadow-xl transition-all"
            title={isFullscreen ? (language === 'en' ? 'Exit fullscreen' : 'Salir de pantalla completa') : (language === 'en' ? 'Fullscreen' : 'Pantalla completa')}
          >
            {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>

          {/* Botón principal de salida hacia TEG System */}
          <button
            onClick={handleExit}
            className="group flex items-center gap-2 px-3.5 py-2 sm:py-1.5 rounded-full bg-[#50050a]/95 hover:bg-[#3d0307] text-white border border-[#FDC82F]/70 shadow-2xl backdrop-blur-md text-xs font-bold transition-all hover:scale-105 active:scale-95"
            title={language === 'en' ? 'Back to TEG System dashboard' : 'Regresar al panel principal de TEG System'}
          >
            <ArrowLeft size={14} className="text-[#FDC82F] group-hover:-translate-x-0.5 transition-transform" />
            <span className="tracking-wide">
              {t('items.exit_to_teg') || (language === 'en' ? 'Exit to TEG' : 'Salir al Sistema TEG')}
            </span>
            <span className="text-[9px] bg-[#FDC82F] text-[#50050a] px-1.5 py-0.5 rounded font-black tracking-wider shadow-sm">
              TEG
            </span>
          </button>
        </div>
      )}

      {/* Visor de la App Móvil 1:1 precargado en segundo plano sin doble splash */}
      <iframe
        src="/app/index.html?nosplash=1"
        className="w-full h-full border-0 select-none"
        title="Tacos Gavilan App"
        allow="geolocation; camera; microphone"
      />
    </div>
  )
}

