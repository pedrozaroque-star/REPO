/**
 * @module components/customer-app-v2/stages/WelcomeGateStage
 * @description Etapa 2 (Welcome Gate) de Tacos Gavilan App V2: acceso directo sin cuenta
 * ("Explore as Guest") o inicio de sesión opcional mediante OTP de 6 dígitos al correo o SMS,
 * con enlaces legales a Privacidad y Términos.
 *
 * @businessRules
 * - Cumple Apple App Store Guideline 5.1.1: todo usuario puede explorar y ordenar sin login.
 * - Textos 100% bilingües mediante `t('mobile_legal.v2_welcome_*')`.
 * - Respeta `!fullscreenNative && islandOverlayMode`.
 *
 * @dataFlow
 * - Transiciona hacia `stage = 'main'` o abre `authSheet = 'sms-otp'`.
 *
 * @notes
 * - Mantiene la identidad tipográfica Gotham Ultra e isotipo Gavilan Brand Standards.
 */

'use client'

import React from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { ArrowLeft, Mail, ShoppingBag } from 'lucide-react'
import { GavilanBrandStandardsWordmark } from '../styles/V2BrandChrome'
import type { CustomerAppV2Controller } from '../hooks/useCustomerAppV2'

export function WelcomeGateStage({
  ctrl,
  fullscreenNative,
  islandOverlayMode = true,
}: {
  ctrl: CustomerAppV2Controller
  fullscreenNative?: boolean
  islandOverlayMode?: boolean
}) {
  const {
    lang,
    t,
    toggleLang,
    setStoryIndex,
    setStage,
    setActiveTab,
    setOtpStep,
    setAuthError,
    setAuthSheet,
    triggerBrandTransition,
  } = ctrl

  const topPad = fullscreenNative
    ? 'pt-6'
    : islandOverlayMode
    ? 'pt-[52px]'
    : 'pt-9'

  return (
    <motion.div
      key="v2-hello-stage"
      initial={{ opacity: 0, y: 25 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -25 }}
      transition={{ duration: 0.3 }}
      className="relative w-full h-full bg-[#121212] flex flex-col justify-between px-6 pb-8 overflow-y-auto no-scrollbar"
    >
      {/* Top Bar */}
      <div className={`flex items-center justify-between ${topPad}`}>
        <button
          type="button"
          onClick={() => {
            setStoryIndex(0)
            setStage('stories')
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/85 text-[11px] font-black uppercase tracking-wider border border-white/15 cursor-pointer"
        >
          <ArrowLeft size={12} />
          <span>{t('mobile_legal.v2_welcome_replay_stories')}</span>
        </button>

        <button
          type="button"
          onClick={toggleLang}
          className="px-3 py-1 rounded-full bg-white/10 hover:bg-white/20 text-white border border-white/20 text-[11px] font-black tracking-wider cursor-pointer"
        >
          {lang === 'en' ? 'ES' : 'EN'}
        </button>
      </div>

      {/* Center Logo & Headline */}
      <div className="my-auto py-4 text-center space-y-4">
        <div className="flex flex-col items-center justify-center gap-2.5">
          <div className="w-24 h-24 mx-auto flex items-center justify-center">
            <img
              src="/logo.png?v=75"
              alt="Tacos Gavilan"
              className="w-full h-full object-contain drop-shadow-[0_8px_24px_rgba(0,0,0,0.75)]"
            />
          </div>
          <GavilanBrandStandardsWordmark className="h-[34px] w-auto mx-auto drop-shadow-[0_3px_12px_rgba(0,0,0,0.9)]" />
        </div>

        <div>
          <span className="inline-block text-[11px] font-black uppercase tracking-[0.2em] text-[#FFC72C]">
            {t('mobile_legal.v2_welcome_tagline')}
          </span>
          <h2 className="v2-gotham text-3xl text-white uppercase tracking-tight mt-1">
            {t('mobile_legal.v2_welcome_title')}
          </h2>
          <p className="text-xs text-white/75 max-w-[300px] mx-auto mt-2 leading-relaxed">
            {t('mobile_legal.v2_welcome_sub')}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3 pt-2">
          <button
            type="button"
            onClick={() =>
              triggerBrandTransition(t('mobile_legal.v2_home_menu_loading'), () => {
                setStage('main')
                setActiveTab('home')
              })
            }
            className="w-full py-4 px-4 rounded-2xl bg-gradient-to-r from-[#DA291C] via-[#b81d13] to-[#DA291C] hover:from-[#e63225] hover:to-[#c92015] text-white font-black text-xs uppercase tracking-[0.12em] shadow-[0_12px_35px_rgba(218,41,28,0.5)] border border-[#FDC82F]/60 flex items-center justify-center gap-2 transition-all active:scale-98 cursor-pointer"
          >
            <ShoppingBag size={16} className="text-[#FDC82F]" />
            <span>{t('mobile_legal.v2_welcome_guest_cta')}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setOtpStep(1)
              setAuthError(null)
              setAuthSheet('sms-otp')
            }}
            className="w-full py-3.5 px-4 rounded-2xl bg-[#1c1c1e] hover:bg-[#252529] text-white font-black text-xs uppercase tracking-wider border border-[#FDC82F]/45 flex items-center justify-center gap-2 transition-all active:scale-98 cursor-pointer"
          >
            <Mail size={15} className="text-[#FDC82F]" />
            <span>{t('mobile_legal.v2_welcome_sms_cta')}</span>
          </button>
        </div>
      </div>

      {/* Footer Legal Links */}
      <div className="text-center space-y-1.5 pt-2">
        <p className="text-[10px] text-white/55">{t('mobile_legal.v2_welcome_legal_prefix')}</p>
        <div className="flex items-center justify-center gap-3 text-[11px] font-bold">
          <Link href="/app/privacy" className="text-[#FFC72C] hover:underline">
            {t('mobile_legal.nav_privacy')}
          </Link>
          <span className="text-white/30">·</span>
          <Link href="/app/terms" className="text-[#FFC72C] hover:underline">
            {t('mobile_legal.nav_terms')}
          </Link>
          <span className="text-white/30">·</span>
          <Link href="/app/support" className="text-[#FFC72C] hover:underline">
            {t('mobile_legal.nav_support')}
          </Link>
        </div>
      </div>
    </motion.div>
  )
}
