/**
 * @module components/customer-app-v2/tabs/HomeShowcaseTab
 * @description Pestaña Inicio de Tacos Gavilan App V2: saludo dinámico en LA, póster Hero oficial,
 * acciones rápidas de Pickup/Delivery/Llamar/Mapa/GPS, carrusel de Especialidades Tradicionales,
 * Menú en Vivo conectado a `/api/mobile/menu` con personalizador de modificadores (y respaldo del
 * catálogo fotográfico oficial de 23 platillos) y sección Fiesta Platters.
 *
 * @businessRules
 * - Cuando `/api/mobile/menu` entrega ítems reales con precios Toast, habilita agregado directo
 *   o apertura de `ProductCustomizerModal` respetando modificadores requeridos.
 * - Muestra claramente cuando los precios son en vivo vs catálogo destacado de respaldo.
 * - Textos 100% bilingües vía `t('mobile_legal.*')`.
 *
 * @dataFlow
 * - Lee `liveCategories`, `liveCategoryOrder`, `catalogMetadata` de `CustomerAppV2Controller`.
 *
 * @notes
 * - Conecta finalmente `greetingText` (`getLaTimeGreeting`) en el encabezado del feed.
 * - Banner Fiesta Platters restaurado a `/tacosgavilan-web/img/party-tray-dark.webp?v=49` tras detectar 404 en `v2-slide3-feast.jpg`.
 */

'use client'

import React, { useMemo } from 'react'
import {
  Heart,
  LocateFixed,
  Navigation,
  Phone,
  Plus,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Truck,
} from 'lucide-react'
import {
  SIGNATURE_DISHES,
  TRADITIONAL_SPECIALTIES,
  WEBSITE_MENU_CATEGORIES,
  matchShowcaseDishForLiveItem,
} from '../data/catalog'
import { renderWebsiteLockup } from '../styles/V2BrandChrome'
import type { CustomerAppV2Controller } from '../hooks/useCustomerAppV2'
import type { LiveMenuItem, WebsiteMenuCategory } from '../types'

export function HomeShowcaseTab({ ctrl }: { ctrl: CustomerAppV2Controller }) {
  const {
    lang,
    t,
    greetingText,
    loggedUser,
    isDemoPreview,
    currentStore,
    fulfillmentMode,
    setFulfillmentMode,
    openInAppMap,
    handleLocateGps,
    isLocating,
    selectedMenuCategory,
    setSelectedMenuCategory,
    menuLoading,
    menuError,
    liveCategories,
    liveCategoryOrder,
    catalogMetadata,
    setCustomizingItem,
    addLineToBag,
    favoriteDishIds,
    toggleFavoriteDish,
    saveLiveItemToServerFavorites,
    v2AccessToken,
    handleSelectShowcaseDish,
    launchWrappedOrderOnline,
    setActiveTab,
  } = ctrl

  const allLiveItems = useMemo(() => {
    const orderedKeys =
      liveCategoryOrder.length > 0 ? liveCategoryOrder : Object.keys(liveCategories)
    const seen = new Set<string>()
    const flat: Array<{ category: string; item: LiveMenuItem }> = []
    for (const cat of orderedKeys) {
      for (const item of liveCategories[cat] || []) {
        if (!seen.has(item.guid)) {
          seen.add(item.guid)
          flat.push({ category: cat, item })
        }
      }
    }
    return flat
  }, [liveCategories, liveCategoryOrder])

  const hasLiveMenu = allLiveItems.length > 0

  const filteredLiveItems = useMemo(() => {
    if (!hasLiveMenu) return []
    if (selectedMenuCategory === 'ALL') return allLiveItems.map((x) => x.item)
    return (liveCategories[selectedMenuCategory] || []).length > 0
      ? liveCategories[selectedMenuCategory]
      : allLiveItems.map((x) => x.item)
  }, [allLiveItems, hasLiveMenu, liveCategories, selectedMenuCategory])

  const showcaseCategoryFilter: WebsiteMenuCategory = useMemo(() => {
    const valid: WebsiteMenuCategory[] = [
      'tacos',
      'burritos',
      'quesadillas',
      'mulitas',
      'sopes',
      'tortas',
      'platos',
      'nachos',
      'drinks',
    ]
    return valid.includes(selectedMenuCategory as WebsiteMenuCategory)
      ? (selectedMenuCategory as WebsiteMenuCategory)
      : 'tacos'
  }, [selectedMenuCategory])

  const handleTapLiveItem = (item: LiveMenuItem) => {
    const hasRequiredMods = (item.modifierGroups || []).some((g) => g.minSelections > 0)
    if (hasRequiredMods || (item.modifierGroups && item.modifierGroups.length > 0)) {
      setCustomizingItem(item)
      return
    }
    addLineToBag({
      itemGuid: item.guid,
      name: item.name,
      unitPrice: Number(item.price || 0),
      quantity: 1,
      modifiers: [],
      imageUrl: item.imageUrl || matchShowcaseDishForLiveItem(item.name)?.image || null,
    })
  }

  return (
    <div className="pb-12">
      {/* Greeting Strip (wires getLaTimeGreeting + Screen #12 preview badge) */}
      <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-2 bg-[#121212]">
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-[#FFC72C] uppercase tracking-wider truncate">
            {greetingText}, {loggedUser ? loggedUser.firstName : t('mobile_legal.v2_guest_label')}
          </p>
          <p className="text-xs font-extrabold text-white/80 truncate">
            {currentStore.cityTitle} · {currentStore.crossStreets}
          </p>
        </div>
        {isDemoPreview && (
          <span className="shrink-0 px-2.5 py-1 rounded-full bg-[#FFC72C]/15 border border-[#FFC72C]/40 text-[#FFC72C] text-[9px] font-black uppercase tracking-wider">
            {t('mobile_legal.v2_demo_preview_badge')}
          </span>
        )}
      </div>

      {/* Hero Poster */}
      <div className="relative w-full h-[205px] overflow-hidden border-y border-white/10">
        <img
          src="/tacosgavilan-web/img/hero-bg-mobile.webp?v=114"
          alt="Tacos Gavilan"
          className="absolute inset-0 w-full h-full object-cover object-center scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/88 via-black/60 to-black/25" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#121212] via-black/15 to-black/55" />

        <div className="relative z-10 h-full px-5 py-4 flex flex-col justify-between items-start">
          <span className="inline-flex items-center px-3 py-1 rounded-full bg-black/65 border border-[#FDC82F]/45 text-[#FDC82F] text-[10px] font-extrabold uppercase tracking-wider shadow-lg backdrop-blur-md">
            {t('mobile_legal.v2_home_hero_kicker')}
          </span>

          <div className="my-auto pt-1 space-y-2">
            <h2 className="v2-outfit text-[28px] sm:text-[31px] font-black uppercase leading-[0.95] tracking-tight text-white drop-shadow-[0_4px_16px_rgba(0,0,0,0.95)]">
              {t('mobile_legal.v2_home_hero_title')}
            </h2>
            <img
              src="/tacosgavilan-web/img/tagline.webp?v=47"
              alt="Ya está"
              className="h-9 sm:h-10 w-auto object-contain drop-shadow-[0_4px_12px_rgba(0,0,0,0.9)]"
            />
          </div>
        </div>
      </div>

      {/* Mode Switcher + Store Quick Actions */}
      <div className="px-4 mt-3">
        <div className="p-2 rounded-2xl bg-[#18181b] border border-white/10 shadow-lg flex items-center justify-between gap-2">
          <div className="inline-flex rounded-xl bg-black/60 p-1 border border-white/10 shrink-0">
            <button
              type="button"
              onClick={() => setFulfillmentMode('pickup')}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 ${
                fulfillmentMode === 'pickup'
                  ? 'bg-[#DA291C] text-white shadow'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              <ShoppingBag size={11} />
              <span>{t('mobile_legal.v2_pickup_short')}</span>
            </button>
            <button
              type="button"
              onClick={() => setFulfillmentMode('delivery')}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 ${
                fulfillmentMode === 'delivery'
                  ? 'bg-[#DA291C] text-white shadow'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              <Truck size={11} />
              <span>{t('mobile_legal.v2_delivery_short')}</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <a
              href={`tel:${currentStore.phone.replace(/[^\d+]/g, '')}`}
              className="px-2.5 py-1.5 rounded-xl bg-white/8 hover:bg-white/15 text-white text-[10px] font-bold flex items-center gap-1 transition-colors"
              title={currentStore.phone}
            >
              <Phone size={12} />
              <span>{t('mobile_legal.support_call_btn')}</span>
            </a>
            <button
              type="button"
              onClick={() => openInAppMap(currentStore.id, false)}
              className="px-2.5 py-1.5 rounded-xl bg-white/8 hover:bg-white/15 text-[#FDC82F] text-[10px] font-bold flex items-center gap-1 transition-colors cursor-pointer"
            >
              <Navigation size={12} />
              <span>{t('mobile_legal.v2_stores_map_btn')}</span>
            </button>
            <button
              type="button"
              onClick={() => handleLocateGps(false)}
              className="p-1.5 rounded-xl bg-[#DA291C]/20 hover:bg-[#DA291C]/35 text-[#FDC82F] border border-[#DA291C]/40 transition-colors cursor-pointer"
              title={t('mobile_legal.v2_stores_gps_btn')}
            >
              <LocateFixed size={13} className={isLocating ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      </div>

      {/* Section A: Traditional Specialties Carousel */}
      <div className="mt-5 px-4">
        <div className="flex items-end justify-between mb-2.5">
          <div>
            <h3 className="v2-gotham text-lg text-white tracking-tight">
              {t('mobile_legal.v2_home_specialties_title')}
            </h3>
            <p className="text-[11px] text-[#A89F93]">
              {t('mobile_legal.v2_home_specialties_sub')}
            </p>
          </div>
        </div>

        <div className="flex items-stretch gap-3 overflow-x-auto no-scrollbar pb-2">
          {TRADITIONAL_SPECIALTIES.map((spec) => (
            <button
              key={spec.id}
              type="button"
              onClick={() => {
                if (!hasLiveMenu) {
                  setSelectedMenuCategory(spec.targetCategory)
                } else {
                  const catMatch = liveCategoryOrder.find((c) =>
                    c.toLowerCase().includes(spec.targetCategory.slice(0, 4))
                  )
                  setSelectedMenuCategory(catMatch || 'ALL')
                }
              }}
              className="shrink-0 w-[165px] rounded-2xl bg-[#161618] border border-white/10 hover:border-[#FFC72C]/50 overflow-hidden text-left flex flex-col transition-all cursor-pointer group"
            >
              <div className="w-full h-[108px] bg-black flex items-center justify-center overflow-hidden border-b border-white/5">
                <img
                  src={spec.image}
                  alt={lang === 'en' ? spec.altEn : spec.altEs}
                  className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                />
              </div>
              <div className="p-2.5 flex-1 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  {renderWebsiteLockup(spec.lockupVariant, spec.main, spec.top, 'sm')}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Section B: Full Live Store Menu (or Showcase Catalog Fallback) */}
      <div className="mt-6 px-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div>
            <h3 className="v2-gotham text-xl text-white tracking-tight">
              {t('mobile_legal.v2_home_menu_title')}
            </h3>
            <span
              className={`inline-flex items-center gap-1 mt-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${
                hasLiveMenu && catalogMetadata?.purchasable
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                  : 'bg-[#FFC72C]/15 border-[#FFC72C]/40 text-[#FFC72C]'
              }`}
            >
              <Sparkles size={10} />
              <span>
                {hasLiveMenu && catalogMetadata?.purchasable
                  ? t('mobile_legal.v2_home_menu_live_badge')
                  : t('mobile_legal.v2_home_menu_showcase_badge')}
              </span>
            </span>
          </div>
        </div>

        {menuLoading && (
          <div className="p-4 rounded-2xl bg-[#18181b] border border-white/10 text-xs text-white/75 font-bold mb-3">
            {t('mobile_legal.v2_home_menu_loading')}
          </div>
        )}

        {!menuLoading && (menuError || !hasLiveMenu) && (
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/35 text-[11px] text-amber-200 mb-3">
            {t('mobile_legal.v2_home_menu_unavailable')}
          </div>
        )}

        {hasLiveMenu ? (
          <>
            {/* Live Category Filter Strip */}
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-3 mb-2">
              <button
                type="button"
                onClick={() => setSelectedMenuCategory('ALL')}
                className={`v2-gotham shrink-0 px-3.5 py-2 rounded-full text-[11px] uppercase tracking-[0.03em] transition-all cursor-pointer border ${
                  selectedMenuCategory === 'ALL'
                    ? 'text-[#FFC72C] bg-[#FFC72C]/18 border-[#FFC72C]'
                    : 'text-[#F5C424] bg-[#141414] border-[#F5C424]/28 hover:border-[#FFC72C]/55'
                }`}
              >
                {t('mobile_legal.v2_home_menu_all_cat')} ({allLiveItems.length})
              </button>
              {liveCategoryOrder.map((cat) => {
                const isSelected = selectedMenuCategory === cat
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedMenuCategory(cat)}
                    className={`v2-gotham shrink-0 px-3.5 py-2 rounded-full text-[11px] uppercase tracking-[0.03em] transition-all cursor-pointer border ${
                      isSelected
                        ? 'text-[#FFC72C] bg-[#FFC72C]/18 border-[#FFC72C]'
                        : 'text-[#F5C424] bg-[#141414] border-[#F5C424]/28 hover:border-[#FFC72C]/55'
                    }`}
                  >
                    {cat}
                  </button>
                )
              })}
            </div>

            {/* Live Priced Toast Menu Cards */}
            <div className="grid grid-cols-2 gap-3">
              {filteredLiveItems.map((item) => {
                const matchedDish = matchShowcaseDishForLiveItem(item.name)
                const photo = item.imageUrl || matchedDish?.image || '/logo.png?v=75'
                const hasMods = (item.modifierGroups?.length ?? 0) > 0
                return (
                  <div
                    key={item.guid}
                    className="rounded-[16px] bg-[#141414] border border-white/10 hover:border-[#F5C424]/55 overflow-hidden flex flex-col transition-all"
                  >
                    <div
                      onClick={() => setCustomizingItem(item)}
                      className="relative w-full h-[138px] bg-black border-b border-white/6 flex items-center justify-center overflow-hidden cursor-pointer group"
                    >
                      <img
                        src={photo}
                        alt={item.name}
                        className="w-full h-full object-contain bg-black group-hover:scale-105 transition-transform duration-300"
                      />
                      <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded-full bg-black/85 border border-[#FFC72C]/50 text-[#FFC72C] text-[11px] font-black">
                        ${Number(item.price || 0).toFixed(2)}
                      </span>
                      {v2AccessToken && !isDemoPreview && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            saveLiveItemToServerFavorites(item)
                          }}
                          aria-label={t('mobile_legal.v2_fav_filter_saved')}
                          className="absolute top-2 right-2 p-1.5 rounded-full bg-black/70 border border-white/15 text-white/65 hover:text-[#DA291C] cursor-pointer"
                        >
                          <Heart size={13} />
                        </button>
                      )}
                    </div>

                    <div className="p-2.5 flex-1 flex flex-col justify-between gap-2">
                      <div>
                        <h4 className="v2-outfit text-xs font-black text-white leading-tight line-clamp-2">
                          {item.name}
                        </h4>
                        {item.description && (
                          <p className="text-[10.5px] text-[#A89F93] line-clamp-2 mt-1">
                            {item.description}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-1.5 pt-1">
                        {hasMods && (
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold text-[#FFC72C]">
                            <SlidersHorizontal size={10} />
                            <span>{t('mobile_legal.v2_home_menu_customizable')}</span>
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => handleTapLiveItem(item)}
                          className="ml-auto inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#DA291C] hover:bg-[#b81d13] text-white text-[10px] font-black uppercase tracking-wider cursor-pointer"
                        >
                          <Plus size={11} />
                          <span>{t('mobile_legal.v2_home_menu_add')}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        ) : (
          <>
            {/* Showcase Categories Strip */}
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-3 mb-2">
              {WEBSITE_MENU_CATEGORIES.map((cat) => {
                const isSelected = showcaseCategoryFilter === cat.id
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedMenuCategory(cat.id)}
                    className={`v2-gotham shrink-0 px-4 py-2 rounded-full text-xs uppercase tracking-[0.03em] transition-all cursor-pointer border ${
                      isSelected
                        ? 'text-[#FFC72C] bg-[#FFC72C]/18 border-[#FFC72C]'
                        : 'text-[#F5C424] bg-[#141414] border-[#F5C424]/28 hover:border-[#FFC72C]/55'
                    }`}
                  >
                    {lang === 'en' ? cat.labelEn : cat.labelEs}
                  </button>
                )
              })}
            </div>

            {/* 23 Showcase Cards Grid (with taco-buche) */}
            <div className="grid grid-cols-2 gap-3">
              {SIGNATURE_DISHES.filter((d) => d.category === showcaseCategoryFilter).map(
                (dish) => {
                  const isFav = favoriteDishIds.includes(dish.id)
                  return (
                    <div
                      key={dish.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSelectShowcaseDish(dish)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          handleSelectShowcaseDish(dish)
                        }
                      }}
                      className="group rounded-[16px] bg-[#141414] border border-white/8 hover:border-[#F5C424]/55 overflow-hidden flex flex-col transition-all cursor-pointer"
                    >
                      <div className="relative w-full h-[150px] bg-black border-b border-white/6 flex items-center justify-center overflow-hidden">
                        <img
                          src={dish.image}
                          alt={lang === 'en' ? dish.nameEn : dish.nameEs}
                          className="w-full h-full object-contain bg-black group-hover:scale-105 transition-transform duration-300"
                        />
                        <button
                          type="button"
                          onClick={(e) => toggleFavoriteDish(dish.id, e)}
                          aria-label={t('mobile_legal.v2_fav_filter_saved')}
                          className={`absolute top-2 right-2 p-1.5 rounded-full border transition-colors cursor-pointer z-10 ${
                            isFav
                              ? 'bg-[#DA291C]/25 border-[#DA291C]/70 text-[#DA291C]'
                              : 'bg-black/65 border-white/15 text-white/55 hover:text-white'
                          }`}
                        >
                          <Heart
                            size={13}
                            className={isFav ? 'fill-[#DA291C] text-[#DA291C]' : ''}
                          />
                        </button>
                      </div>

                      <div className="bg-[#141414] flex-1 flex flex-col items-center text-center px-2.5 pt-2.5 pb-3.5">
                        <div className="min-h-[58px] flex items-center justify-center">
                          {renderWebsiteLockup(
                            lang === 'en' ? dish.lockupVariantEn : dish.lockupVariantEs,
                            lang === 'en' ? dish.lockupMainEn : dish.lockupMainEs,
                            lang === 'en' ? dish.lockupTopEn : dish.lockupTopEs,
                            'md'
                          )}
                        </div>
                        <p className="text-[11px] text-[#A89F93] leading-[1.4] mt-1">
                          {lang === 'en' ? dish.descEn : dish.descEs}
                        </p>
                      </div>
                    </div>
                  )
                }
              )}
            </div>
          </>
        )}
      </div>

      {/* Section C: Fiesta Platters Banner */}
      <div className="mt-6 px-4">
        <div className="relative rounded-2xl overflow-hidden border border-[#F5C424]/45 bg-[#161618] shadow-xl">
          <div className="relative h-32">
            <img
              src="/tacosgavilan-web/img/party-tray-dark.webp?v=49"
              alt={t('mobile_legal.v2_home_catering_title')}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#161618] via-black/45 to-black/30" />
            <span className="absolute top-3 left-3 px-2.5 py-0.5 rounded-full bg-[#DA291C] text-white text-[9px] font-black uppercase tracking-widest">
              {t('mobile_legal.wrapper_cat_catering')}
            </span>
          </div>
          <div className="p-4 -mt-4 relative z-10 space-y-2.5">
            <h4 className="v2-gotham text-lg text-[#F5C424] uppercase">
              {t('mobile_legal.v2_home_catering_title')}
            </h4>
            <p className="text-xs text-white/75 leading-relaxed">
              {t('mobile_legal.v2_home_catering_sub')}
            </p>
            <button
              type="button"
              onClick={() => {
                launchWrappedOrderOnline(currentStore, fulfillmentMode)
                setActiveTab('order')
              }}
              className="w-full py-2.5 rounded-xl bg-[#DA291C] hover:bg-[#b81d13] text-white text-xs font-black uppercase tracking-wider border border-[#FDC82F]/50 cursor-pointer transition-colors"
            >
              {t('mobile_legal.v2_home_catering_cta')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
