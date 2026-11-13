/**
 * @module components/CustomerAppV2Pro
 * @description Orquestador delgado para **Tacos Gavilan App** (Versión 2), conectando el controlador
 * modular en vivo (`components/customer-app-v2/hooks/useCustomerAppV2.ts`), la línea de marca Gotham Ultra,
 * las 5 historias reales con onboarding, la pantalla de bienvenida opcional y las 5 pestañas operativas
 * (Inicio con menú en vivo Toast POS y personalizador, Ordenar con bolsa/autocompletado Delivery/Storefront,
 * Tiendas con 15 sucursales y Google Maps interactivo, Favoritos sincronizados y Cuenta).
 *
 * @businessRules
 * - Preserva intacta toda la interfaz pública (`CustomerAppV2ProProps`, `V2_STORES`, `V2AuthoritativeStore`,
 *   `V2Stage`, `MainTab`, `V2AuthSheet`, `V2UserProfile`, default export) para `/app` y `/app/v2`.
 * - Cero llamadas silenciosas de perfil/eliminación; soporte completo bilingüe EN/ES vía `lib/i18n.tsx`.
 * - Aislamiento total de vista previa Screen #12 (`externalLoggedInDemo`) sin contaminar sesiones reales.
 *
 * @dataFlow
 * - `CustomerAppV2Pro` -> `useCustomerAppV2` -> `StoriesOnboardingStage` / `WelcomeGateStage` /
 *   `HomeShowcaseTab` / `OrderHubTab` / `StoresTab` / `FavoritesTab` / `AccountTab` + modales dedicados.
 *
 * @notes
 * - Modularizado y elevado a paridad real con Versión 1 y el contrato `/api/mobile/*` en Fase 3.
 * - Copy alineado a la marca oficial **Tacos Gavilan** y catálogo actualizado a 23 platillos oficiales.
 */

'use client'

import React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type {
  CustomerAppV2ProProps,
  MainTab,
  V2AuthSheet,
  V2AuthoritativeStore,
  V2Stage,
  V2UserProfile,
} from './customer-app-v2/types'
import { V2_STORES } from './customer-app-v2/data/stores'
import { useCustomerAppV2 } from './customer-app-v2/hooks/useCustomerAppV2'
import {
  BottomTabBar,
  BrandTransitionLoader,
  IosHomeIndicator,
  IosStatusBar,
  TopStoreBar,
  V2BrandStyles,
} from './customer-app-v2/styles/V2BrandChrome'
import { StoriesOnboardingStage } from './customer-app-v2/stages/StoriesOnboardingStage'
import { WelcomeGateStage } from './customer-app-v2/stages/WelcomeGateStage'
import { HomeShowcaseTab } from './customer-app-v2/tabs/HomeShowcaseTab'
import { OrderHubTab } from './customer-app-v2/tabs/OrderHubTab'
import { StoresTab } from './customer-app-v2/tabs/StoresTab'
import { FavoritesTab } from './customer-app-v2/tabs/FavoritesTab'
import { AccountTab } from './customer-app-v2/tabs/AccountTab'
import { ProductCustomizerModal } from './customer-app-v2/modals/ProductCustomizerModal'
import { AuthAndSupportModal } from './customer-app-v2/modals/AuthAndSupportModal'
import { StoreAndMapModals } from './customer-app-v2/modals/StoreAndMapModals'
import { ConfirmationModals } from './customer-app-v2/modals/ConfirmationModals'

export { V2_STORES }
export type {
  CustomerAppV2ProProps,
  V2AuthoritativeStore,
  V2Stage,
  MainTab,
  V2AuthSheet,
  V2UserProfile,
}

export default function CustomerAppV2Pro(props: CustomerAppV2ProProps) {
  const { embedded, fullscreenNative, islandOverlayMode = true } = props
  const ctrl = useCustomerAppV2(props)

  const tabLabels: Record<MainTab, string> = {
    home: ctrl.t('mobile_legal.v2_tab_home'),
    order: ctrl.t('mobile_legal.v2_tab_order'),
    stores: ctrl.t('mobile_legal.v2_tab_stores'),
    cravings: ctrl.t('mobile_legal.v2_tab_favorites'),
    account: ctrl.t('mobile_legal.v2_tab_account'),
  }

  return (
    <div
      className={
        fullscreenNative
          ? 'w-full h-full flex items-center justify-center bg-black'
          : embedded
          ? 'w-full flex flex-col items-center justify-center py-2'
          : 'min-h-screen w-full flex flex-col items-center justify-center bg-[#09090b] p-4 sm:p-6'
      }
    >
      <V2BrandStyles />

      <div
        className={`relative bg-[#121212] text-white overflow-hidden select-none flex flex-col ${
          fullscreenNative
            ? 'w-full h-full'
            : 'w-[412px] max-w-full h-[848px] max-h-[88vh] rounded-[46px] shadow-[0_35px_90px_-15px_rgba(0,0,0,0.85),0_0_0_11px_#1c1c1e,0_0_0_13px_#3f3f46]'
        }`}
      >
        <IosStatusBar
          fullscreenNative={fullscreenNative}
          islandOverlayMode={islandOverlayMode}
          clockText={ctrl.statusClock}
        />

        <AnimatePresence mode="wait">
          {ctrl.stage === 'stories' && (
            <StoriesOnboardingStage
              key="stories-stage"
              ctrl={ctrl}
              fullscreenNative={fullscreenNative}
              islandOverlayMode={islandOverlayMode}
            />
          )}

          {ctrl.stage === 'hello' && (
            <WelcomeGateStage
              key="hello-stage"
              ctrl={ctrl}
              fullscreenNative={fullscreenNative}
              islandOverlayMode={islandOverlayMode}
            />
          )}

          {ctrl.stage === 'main' && (
            <motion.div
              key="v2-main-stage"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="relative w-full h-full flex flex-col bg-[#121212] overflow-hidden"
            >
              <TopStoreBar
                currentStore={ctrl.currentStore}
                isOpen={ctrl.currentStoreStatus.isOpen}
                badgeText={ctrl.currentStoreStatus.badgeText}
                lang={ctrl.lang}
                islandOverlayMode={islandOverlayMode}
                fullscreenNative={fullscreenNative}
                isDemoPreview={ctrl.isDemoPreview}
                demoBadgeLabel={ctrl.t('mobile_legal.v2_demo_preview_badge')}
                onOpenStoreModal={() => ctrl.setStoreModalOpen(true)}
                onToggleLang={ctrl.toggleLang}
              />

              <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
                {ctrl.activeTab === 'home' && <HomeShowcaseTab ctrl={ctrl} />}
                {ctrl.activeTab === 'order' && <OrderHubTab ctrl={ctrl} />}
                {ctrl.activeTab === 'stores' && <StoresTab ctrl={ctrl} />}
                {ctrl.activeTab === 'cravings' && <FavoritesTab ctrl={ctrl} />}
                {ctrl.activeTab === 'account' && <AccountTab ctrl={ctrl} />}
              </div>

              <BottomTabBar
                activeTab={ctrl.activeTab}
                bagCount={ctrl.bagItemCount}
                favoritesCount={ctrl.favoriteDishIds.length + ctrl.serverFavorites.length}
                fullscreenNative={fullscreenNative}
                labels={tabLabels}
                onSelectTab={ctrl.setActiveTab}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <BrandTransitionLoader
          visible={ctrl.brandLoader.visible}
          label={ctrl.brandLoader.label}
          done={ctrl.brandLoader.done}
        />

        <ProductCustomizerModal ctrl={ctrl} />
        <AuthAndSupportModal ctrl={ctrl} />
        <StoreAndMapModals
          ctrl={ctrl}
          fullscreenNative={fullscreenNative}
          islandOverlayMode={islandOverlayMode}
        />
        <ConfirmationModals ctrl={ctrl} />
        <IosHomeIndicator fullscreenNative={fullscreenNative} />
      </div>
    </div>
  )
}
