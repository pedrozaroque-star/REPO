/**
 * @module components/customer-app-v2/tabs/FavoritesTab
 * @description Pestaña Favoritos y Antojos de Tacos Gavilan App V2: combina favoritos
 * sincronizados en el servidor (`/api/mobile/favorites` GET/POST/DELETE para cuentas firmadas)
 * con el catálogo visual oficial de 23 platillos de tacosgavilan.com y acceso al menú vivo.
 *
 * @businessRules
 * - Modo invitado muestra aviso claro (`v2_fav_guest_hint`) manteniendo favoritos locales en dispositivo.
 * - Errores del servidor en `/api/mobile/favorites` se muestran explícitamente (`favoritesError`).
 * - Textos 100% bilingües vía `t('mobile_legal.*')`.
 *
 * @dataFlow
 * - Consume `favoriteDishIds`, `serverFavorites`, `deleteServerFavorite`, `addLineToBag` y `handleSelectShowcaseDish`.
 *
 * @notes
 * - Soporta filtro entre "Mis Favoritos" y "Todas las Especialidades (23)".
 */

'use client'

import React from 'react'
import { AlertTriangle, Heart, Plus, ShoppingBag, Trash2 } from 'lucide-react'
import { SIGNATURE_DISHES } from '../data/catalog'
import { renderWebsiteLockup } from '../styles/V2BrandChrome'
import type { CustomerAppV2Controller } from '../hooks/useCustomerAppV2'

export function FavoritesTab({ ctrl }: { ctrl: CustomerAppV2Controller }) {
  const {
    lang,
    t,
    favFilter,
    setFavFilter,
    favoriteDishIds,
    toggleFavoriteDish,
    serverFavorites,
    favoritesSyncing,
    favoritesError,
    deleteServerFavorite,
    addLineToBag,
    v2AccessToken,
    isDemoPreview,
    handleSelectShowcaseDish,
    setActiveTab,
    setAuthSheet,
    setOtpStep,
  } = ctrl

  const filteredDishes =
    favFilter === 'saved'
      ? SIGNATURE_DISHES.filter((d) => favoriteDishIds.includes(d.id))
      : SIGNATURE_DISHES

  return (
    <div className="p-4 space-y-4 pb-24">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="v2-gotham text-lg text-white tracking-tight">
            {t('mobile_legal.v2_fav_title')}
          </h3>
          <p className="text-[11px] text-white/65">
            {favoriteDishIds.length + serverFavorites.length} {t('mobile_legal.v2_fav_count_saved')}
          </p>
        </div>

        <div className="inline-flex p-1 rounded-xl bg-[#18181b] border border-white/10">
          <button
            type="button"
            onClick={() => setFavFilter('saved')}
            className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase cursor-pointer ${
              favFilter === 'saved'
                ? 'bg-[#DA291C] text-white'
                : 'text-white/65 hover:text-white'
            }`}
          >
            {t('mobile_legal.v2_fav_filter_saved')}
          </button>
          <button
            type="button"
            onClick={() => setFavFilter('all')}
            className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase cursor-pointer ${
              favFilter === 'all'
                ? 'bg-[#DA291C] text-white'
                : 'text-white/65 hover:text-white'
            }`}
          >
            {t('mobile_legal.v2_fav_filter_all')} ({SIGNATURE_DISHES.length})
          </button>
        </div>
      </div>

      {/* Guest or Server Sync Banner */}
      {(!v2AccessToken || isDemoPreview) && (
        <div className="p-3 rounded-xl bg-[#18181b] border border-white/10 flex items-center justify-between gap-2">
          <p className="text-[11px] text-white/75 leading-relaxed">
            {t('mobile_legal.v2_fav_guest_hint')}
          </p>
          {!isDemoPreview && (
            <button
              type="button"
              onClick={() => {
                setOtpStep(1)
                setAuthSheet('sms-otp')
              }}
              className="shrink-0 px-2.5 py-1.5 rounded-lg bg-[#FDC82F] text-[#121212] text-[10px] font-black uppercase cursor-pointer"
            >
              {t('mobile_legal.v2_account_sign_in_cta')}
            </button>
          )}
        </div>
      )}

      {favoritesSyncing && (
        <p className="text-[11px] font-bold text-[#FFC72C]">
          {t('mobile_legal.v2_fav_syncing')}
        </p>
      )}

      {favoritesError && (
        <div className="p-2.5 rounded-xl bg-red-500/15 border border-red-500/40 text-red-300 text-xs font-bold flex items-center gap-2">
          <AlertTriangle size={14} className="shrink-0" />
          <span>{favoritesError}</span>
        </div>
      )}

      {/* Server-Synced Cloud Favorites from /api/mobile/favorites */}
      {serverFavorites.length > 0 && (
        <div className="space-y-2">
          {serverFavorites.map((fav) => (
            <div
              key={fav.id}
              className="p-3 rounded-xl bg-[#18181b] border border-[#FDC82F]/35 flex items-center justify-between gap-2"
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-black text-white truncate">{fav.name}</p>
                <p className="text-[10px] text-white/60 truncate">
                  {fav.items
                    .map((i) => `${i.quantity}x ${i.name}`)
                    .join(', ')}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    for (const item of fav.items) {
                      addLineToBag({
                        itemGuid: item.itemGuid,
                        name: item.name,
                        unitPrice: Number(item.price || 0),
                        quantity: item.quantity,
                        modifiers: (item.modifiers || []).map((m) => ({
                          optionGroupGuid: '',
                          guid: m.guid,
                          name: m.name,
                          price: Number(m.price || 0),
                        })),
                      })
                    }
                    setActiveTab('order')
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-[#DA291C] text-white text-[10px] font-black uppercase flex items-center gap-1 cursor-pointer"
                >
                  <Plus size={11} />
                  <span>{t('mobile_legal.v2_home_menu_add')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => deleteServerFavorite(fav.id)}
                  aria-label={t('mobile_legal.v2_bag_remove')}
                  className="p-1.5 rounded-lg bg-white/8 hover:bg-red-500/20 text-white/70 hover:text-red-300 cursor-pointer"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Showcase Favorites / All Specialties */}
      {filteredDishes.length === 0 && serverFavorites.length === 0 ? (
        <div className="p-6 rounded-2xl bg-[#18181b] border border-white/10 text-center space-y-2">
          <Heart size={28} className="mx-auto text-[#DA291C]/80" />
          <h4 className="text-sm font-black text-white">
            {t('mobile_legal.v2_fav_empty_title')}
          </h4>
          <p className="text-xs text-white/65 leading-relaxed">
            {t('mobile_legal.v2_fav_empty_desc')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {filteredDishes.map((dish) => {
            const isFav = favoriteDishIds.includes(dish.id)
            return (
              <div
                key={dish.id}
                className="rounded-xl bg-[#141414] border border-white/10 overflow-hidden flex flex-col relative shadow-[0_8px_30px_rgba(0,0,0,0.4)]"
              >
                <div className="w-full h-[180px] bg-black flex items-center justify-center p-2 border-b border-white/[0.04] relative">
                  <button
                    type="button"
                    onClick={(e) => toggleFavoriteDish(dish.id, e)}
                    aria-label={t('mobile_legal.v2_fav_filter_saved')}
                    className="absolute top-2.5 right-2.5 z-10 w-8 h-8 rounded-full bg-black/75 border border-white/15 flex items-center justify-center text-white/75 hover:text-white cursor-pointer"
                  >
                    <Heart
                      size={14}
                      className={isFav ? 'fill-[#DA291C] text-[#DA291C]' : ''}
                    />
                  </button>
                  <img
                    src={dish.image}
                    alt={lang === 'en' ? dish.nameEn : dish.nameEs}
                    className="max-w-full max-h-full object-contain"
                  />
                </div>

                <div className="p-4 flex flex-col flex-1 justify-between gap-2.5">
                  <div>
                    <div className="mb-2 flex items-center justify-start">
                      {renderWebsiteLockup(
                        lang === 'en' ? dish.lockupVariantEn : dish.lockupVariantEs,
                        lang === 'en' ? dish.lockupMainEn : dish.lockupMainEs,
                        lang === 'en' ? dish.lockupTopEn : dish.lockupTopEs,
                        'md'
                      )}
                    </div>
                    <p className="text-[12.5px] text-white/70 leading-relaxed">
                      {lang === 'en' ? dish.descEn : dish.descEs}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSelectShowcaseDish(dish)}
                    className="mt-1 w-full py-2.5 rounded-lg bg-[#DA291C] hover:bg-[#b81d13] text-white text-xs font-black uppercase tracking-wider cursor-pointer transition-colors flex items-center justify-center gap-1.5"
                  >
                    <ShoppingBag size={13} />
                    <span>{t('mobile_legal.support_order_btn')}</span>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
