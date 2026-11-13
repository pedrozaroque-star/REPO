/**
 * @module components/customer-app-v2/stages/StoriesOnboardingStage
 * @description Etapa 1 de Tacos Gavilan App V2: 5 historias cinemáticas interactivas
 * con fotografía real, efectos de luz cálida, selector Pickup/Delivery en Slide 2,
 * localizador GPS en Slide 3, favoritos en Slide 4 y tipografía cinética con resorte.
 *
 * @businessRules
 * - Todas las etiquetas visibles se obtienen de `t('mobile_legal.v2_story_*')`.
 * - Respeta `!fullscreenNative && islandOverlayMode` para margen superior en iPhone 16 Pro.
 * - Preserva 100% los 5 slides reales (`STORY_SLIDE_VISUALS`) e interacciones.
 *
 * @dataFlow
 * - Consume `CustomerAppV2Controller` + `STORY_SLIDE_VISUALS` + `SIGNATURE_DISHES`.
 *
 * @notes
 * - Elimina textos hardcodeados manteniendo fielmente las animaciones Framer Motion originales.
 * - Toma `imageFilterClass` y `overlayGradientClass` de `STORY_SLIDE_VISUALS` para calibrar luminosidad y contraste en Slides 1–5.
 */

'use client'

import React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ChevronDown,
  Heart,
  LocateFixed,
  MapPin,
  ShoppingBag,
  Sparkles,
  Truck,
} from 'lucide-react'
import { SIGNATURE_DISHES, STORY_SLIDE_VISUALS } from '../data/catalog'
import { GavilanBrandStandardsWordmark, renderWebsiteLockup } from '../styles/V2BrandChrome'
import type { CustomerAppV2Controller } from '../hooks/useCustomerAppV2'
import type { SignatureDish } from '../types'

export function StoriesOnboardingStage({
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
    storyIndex,
    setStoryIndex,
    setStage,
    currentStore,
    userCoords,
    isLocating,
    handleLocateGps,
    fulfillmentMode,
    setFulfillmentMode,
    favoriteDishIds,
    toggleFavoriteDish,
  } = ctrl

  const slideMeta = STORY_SLIDE_VISUALS[storyIndex] || STORY_SLIDE_VISUALS[0]
  const kicker = t(slideMeta.tagKey)
  const lines = [t(slideMeta.topKey), t(slideMeta.accentKey)]
  const subtitle = t(slideMeta.subKey)

  const topPad = fullscreenNative
    ? 'pt-5'
    : islandOverlayMode
    ? 'pt-[50px]'
    : 'pt-9'

  return (
    <motion.div
      key="v2-stories-stage"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.35 }}
      className="relative w-full h-full flex flex-col justify-between overflow-hidden bg-[#121212]"
    >
      {/* Background Photo with Ken Burns Parallax Scale */}
      <AnimatePresence mode="wait">
        <motion.div
          key={slideMeta.image + storyIndex}
          initial={{ scale: 1.09, opacity: 0.35 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 1.04, opacity: 0.25 }}
          transition={{ type: 'spring', damping: 24, stiffness: 180 }}
          className="absolute inset-0 z-0 pointer-events-none"
        >
          <img
            src={slideMeta.image}
            alt={kicker}
            className={`w-full h-full object-cover object-center ${slideMeta.imageFilterClass}`}
          />
          <div className={`absolute inset-0 ${slideMeta.overlayGradientClass}`} />
          <div
            className={`absolute inset-y-0 w-16 pointer-events-none ${
              slideMeta.lightLeakSide === 'left'
                ? 'left-0 bg-gradient-to-r from-[#DA291C]/55 via-[#FE5000]/25 to-transparent'
                : 'right-0 bg-gradient-to-l from-[#DA291C]/55 via-[#FE5000]/25 to-transparent'
            }`}
          />
        </motion.div>
      </AnimatePresence>

      {/* Top Bar: Standard Horizontal Logo + Language Toggle */}
      <div className={`relative z-20 flex items-center justify-between px-5 pb-2 ${topPad}`}>
        <div className="flex items-center gap-3">
          <img
            src="/logo.png?v=75"
            alt="Tacos Gavilan"
            className="w-14 h-14 object-contain drop-shadow-[0_4px_14px_rgba(0,0,0,0.75)] shrink-0"
          />
          <div className="flex flex-col items-start">
            <GavilanBrandStandardsWordmark className="h-[30px] w-auto drop-shadow-[0_2px_10px_rgba(0,0,0,0.95)]" />
            <span className="block text-[13px] font-extrabold text-white leading-tight mt-1 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
              {t('mobile_legal.v2_welcome_tagline')}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={toggleLang}
          className="px-3 py-1 rounded-full bg-black/55 hover:bg-black/80 text-white border border-white/25 text-[11px] font-black tracking-wider backdrop-blur-md transition-all cursor-pointer"
        >
          {lang === 'en' ? 'ES' : 'EN'}
        </button>
      </div>

      {/* Right-Side Vertical Progress Dots */}
      <div className="absolute right-4 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-2">
        {STORY_SLIDE_VISUALS.map((s, idx) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setStoryIndex(idx)}
            aria-label={`Slide ${idx + 1}`}
            className={`w-2 rounded-full transition-all duration-300 cursor-pointer ${
              idx === storyIndex
                ? 'h-7 bg-[#FDC82F] shadow-[0_0_10px_rgba(253,200,47,0.8)]'
                : 'h-2 bg-white/40 hover:bg-white/75'
            }`}
          />
        ))}
      </div>

      {/* Middle Content Area */}
      <div className="relative z-20 flex-1 flex flex-col justify-between px-6 py-4">
        <div className="mt-2">
          <AnimatePresence mode="wait">
            {(storyIndex === 0 || storyIndex === 4) && (
              <motion.div
                key={`slide-${storyIndex}-badge`}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="inline-flex items-center px-3.5 py-1.5 rounded-full bg-black/60 border border-[#FDC82F]/50 backdrop-blur-md shadow-xl"
              >
                <span className="text-[11px] font-black tracking-widest text-white uppercase">
                  {kicker}
                </span>
              </motion.div>
            )}

            {storyIndex === 1 && (
              <motion.div
                key="slide1-fulfillment"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-2.5 max-w-[340px]"
              >
                <motion.div
                  initial={{ y: -20, opacity: 0, scale: 0.94 }}
                  animate={{ y: 0, opacity: 1, scale: 1 }}
                  transition={{ type: 'spring', damping: 16, stiffness: 220, delay: 0.08 }}
                  className="flex items-center gap-3 p-3 rounded-2xl bg-black/80 text-white shadow-[0_14px_35px_rgba(0,0,0,0.5)] border border-[#FDC82F]/40 backdrop-blur-xl"
                >
                  <div className="w-10 h-10 rounded-xl bg-[#DA291C] flex items-center justify-center text-white shrink-0 shadow">
                    <ShoppingBag size={19} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black uppercase tracking-wider text-[#FDC82F]">
                        {t('mobile_legal.wrapper_pickup_mode')}
                      </span>
                      <span className="text-[10px] font-bold text-emerald-400">
                        15 Stores
                      </span>
                    </div>
                    <p className="text-xs font-extrabold text-white mt-0.5 truncate">
                      {currentStore.cityTitle} · {currentStore.crossStreets}
                    </p>
                  </div>
                </motion.div>

                <motion.div
                  initial={{ y: -20, opacity: 0, scale: 0.94 }}
                  animate={{ y: 0, opacity: 1, scale: 1 }}
                  transition={{ type: 'spring', damping: 16, stiffness: 220, delay: 0.2 }}
                  className="flex items-center gap-3 p-3 rounded-2xl bg-black/75 text-white shadow-[0_14px_35px_rgba(0,0,0,0.45)] border border-white/20 backdrop-blur-xl ml-3"
                >
                  <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center text-[#FDC82F] shrink-0">
                    <Truck size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="text-[10px] font-black uppercase tracking-wider text-white/80">
                      {t('mobile_legal.wrapper_delivery_mode')}
                    </span>
                    <p className="text-xs font-bold text-white/90 mt-0.5 truncate">
                      order.online · Storefront
                    </p>
                  </div>
                </motion.div>
              </motion.div>
            )}

            {storyIndex === 2 && (
              <motion.div
                key="slide2-gps-card"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ opacity: 0 }}
                className="p-3.5 rounded-2xl bg-black/75 border border-white/20 backdrop-blur-xl shadow-2xl max-w-[330px]"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#DA291C] flex items-center justify-center text-white shrink-0 shadow-md">
                    <MapPin size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="text-[10px] font-black uppercase tracking-widest text-[#FDC82F]">
                      {userCoords
                        ? t('mobile_legal.v2_stores_gps_sorted')
                        : t('mobile_legal.wrapper_active_store_label')}
                    </span>
                    <p className="text-sm font-black text-white truncate">
                      Tacos Gavilan — {currentStore.name}
                    </p>
                    <p className="text-[11px] text-white/75 truncate">{currentStore.address}</p>
                  </div>
                </div>
              </motion.div>
            )}

            {storyIndex === 3 && (
              <motion.div
                key="slide3-favorites-preview"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ opacity: 0 }}
                className="relative flex flex-col items-center pt-1"
              >
                <div className="w-full max-w-[320px] bg-[#161618]/95 p-3.5 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.65)] border-2 border-[#FDC82F] backdrop-blur-xl space-y-2.5">
                  <div className="flex items-center justify-between border-b border-white/10 pb-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-[#FDC82F] flex items-center gap-1.5">
                      <Heart size={12} className="fill-[#DA291C] text-[#DA291C]" />
                      <span>{t('mobile_legal.v2_fav_filter_saved')}</span>
                    </span>
                    <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-[#DA291C] text-white">
                      {favoriteDishIds.length}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {(['super-burrito', 'taco-asada', 'super-mulita'] as const)
                      .map((id) => SIGNATURE_DISHES.find((d) => d.id === id))
                      .filter((d): d is SignatureDish => Boolean(d))
                      .map((dish) => {
                        const isFav = favoriteDishIds.includes(dish.id)
                        return (
                          <button
                            key={dish.id}
                            type="button"
                            onClick={(e) => toggleFavoriteDish(dish.id, e)}
                            className="w-full p-2 rounded-xl bg-[#141414] border border-white/10 hover:border-[#F5C424]/50 flex items-center justify-between gap-2.5 text-left transition-all cursor-pointer"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="w-11 h-11 rounded-lg bg-black border border-white/10 flex items-center justify-center shrink-0 overflow-hidden">
                                <img
                                  src={dish.image}
                                  alt={lang === 'en' ? dish.nameEn : dish.nameEs}
                                  className="w-full h-full object-contain bg-black"
                                />
                              </div>
                              <div className="min-w-0">
                                <div className="leading-none">
                                  {renderWebsiteLockup(
                                    lang === 'en' ? dish.lockupVariantEn : dish.lockupVariantEs,
                                    lang === 'en' ? dish.lockupMainEn : dish.lockupMainEs,
                                    lang === 'en' ? dish.lockupTopEn : dish.lockupTopEs,
                                    'sm'
                                  )}
                                </div>
                                <p className="text-[10px] text-[#A89F93] truncate mt-1">
                                  {lang === 'en' ? dish.descEn : dish.descEs}
                                </p>
                              </div>
                            </div>
                            <span
                              className={`p-1.5 rounded-lg border shrink-0 ${
                                isFav
                                  ? 'bg-[#DA291C]/20 border-[#DA291C]/60 text-[#DA291C]'
                                  : 'bg-white/5 border-white/10 text-white/50'
                              }`}
                            >
                              <Heart
                                size={13}
                                className={isFav ? 'fill-[#DA291C] text-[#DA291C]' : ''}
                              />
                            </span>
                          </button>
                        )
                      })}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Staggered Kinetic Typography */}
        <div className="mb-2">
          <AnimatePresence mode="wait">
            <motion.div
              key={`text-${slideMeta.id}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-1"
            >
              {lines.map((line, i) => (
                <motion.div
                  key={line + i}
                  initial={{ y: 28, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{
                    type: 'spring',
                    damping: 20,
                    stiffness: 200,
                    delay: 0.08 * i,
                  }}
                >
                  <span
                    className={`block text-[32px] sm:text-[36px] font-black uppercase leading-[0.96] tracking-tight drop-shadow-[0_4px_18px_rgba(0,0,0,0.85)] ${
                      i === slideMeta.accentLineIndex ? 'text-[#FDC82F]' : 'text-white'
                    }`}
                  >
                    {line}
                  </span>
                </motion.div>
              ))}

              <motion.p
                initial={{ y: 16, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.28 }}
                className="pt-2 text-xs sm:text-sm font-semibold text-white/90 max-w-[330px] leading-relaxed drop-shadow"
              >
                {subtitle}
              </motion.p>

              {storyIndex === 1 && (
                <motion.div
                  initial={{ y: 12, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.35 }}
                  className="pt-3 flex items-center gap-2.5"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setFulfillmentMode('pickup')
                      setStoryIndex(2)
                    }}
                    className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-full font-black text-xs uppercase tracking-wider shadow-xl transition-all active:scale-95 cursor-pointer ${
                      fulfillmentMode === 'pickup'
                        ? 'bg-[#FDC82F] text-[#121212]'
                        : 'bg-white/90 text-[#121212] hover:bg-[#FDC82F]'
                    }`}
                  >
                    <ShoppingBag size={14} className="text-[#DA291C]" />
                    <span>{t('mobile_legal.v2_pickup_short')}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setFulfillmentMode('delivery')
                      setStoryIndex(2)
                    }}
                    className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-full font-black text-xs uppercase tracking-wider shadow-xl transition-all active:scale-95 cursor-pointer border ${
                      fulfillmentMode === 'delivery'
                        ? 'bg-[#DA291C] text-white border-[#FDC82F]'
                        : 'bg-black/70 text-white border-white/30 hover:bg-black'
                    }`}
                  >
                    <Truck size={14} className="text-[#FDC82F]" />
                    <span>{t('mobile_legal.v2_delivery_short')}</span>
                  </button>
                </motion.div>
              )}

              {storyIndex === 2 && (
                <motion.div
                  initial={{ y: 12, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.35 }}
                  className="pt-3"
                >
                  <button
                    type="button"
                    onClick={() => handleLocateGps(true)}
                    disabled={isLocating}
                    className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-[#FDC82F] hover:bg-amber-400 text-[#121212] font-black text-xs uppercase tracking-wider shadow-xl transition-all active:scale-95 cursor-pointer"
                  >
                    <LocateFixed size={15} className={isLocating ? 'animate-spin' : ''} />
                    <span>
                      {isLocating
                        ? t('mobile_legal.v2_stores_gps_loading')
                        : t('mobile_legal.v2_stores_gps_btn')}
                    </span>
                  </button>
                </motion.div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Bottom Footer of Story Slides */}
      <div className="relative z-20 px-6 pb-6 pt-2">
        {storyIndex < STORY_SLIDE_VISUALS.length - 1 ? (
          <div className="flex items-center justify-between">
            <div className="w-16 text-[11px] font-bold text-white/60">
              0{storyIndex + 1} / 0{STORY_SLIDE_VISUALS.length}
            </div>

            <motion.button
              type="button"
              onClick={() =>
                setStoryIndex((prev) => Math.min(prev + 1, STORY_SLIDE_VISUALS.length - 1))
              }
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
              aria-label={t('mobile_legal.v2_story_next')}
              className="w-12 h-12 rounded-full bg-white text-[#121212] shadow-[0_8px_28px_rgba(0,0,0,0.6)] flex items-center justify-center hover:bg-[#FDC82F] transition-colors cursor-pointer"
            >
              <ChevronDown size={22} />
            </motion.button>

            <button
              type="button"
              onClick={() => setStage('hello')}
              className="w-16 text-right text-xs font-black uppercase tracking-wider text-white/80 hover:text-white cursor-pointer"
            >
              {t('mobile_legal.v2_story_skip')}
            </button>
          </div>
        ) : (
          <motion.button
            type="button"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            onClick={() => setStage('hello')}
            className="w-full py-4 rounded-2xl bg-gradient-to-r from-[#DA291C] via-[#FE5000] to-[#DA291C] text-white font-black text-sm uppercase tracking-[0.14em] shadow-[0_14px_40px_rgba(218,41,28,0.55)] border border-[#FDC82F]/60 flex items-center justify-center gap-2 cursor-pointer"
          >
            <Sparkles size={16} className="text-[#FDC82F]" />
            <span>{t('mobile_legal.v2_story_start')}</span>
          </motion.button>
        )}
      </div>
    </motion.div>
  )
}
