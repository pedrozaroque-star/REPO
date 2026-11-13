/**
 * @module components/customer-app-v2/tabs/AccountTab
 * @description Pestaña Cuenta de Tacos Gavilan App V2: perfil personal (edición/guardado real contra
 * `/api/mobile/user/profile` con manejo de errores visible), preferencias de idioma y modalidad,
 * administración de sesión y sucursal, soporte en app y enlace al flujo permanente de eliminación
 * (`/api/mobile/user/delete` y `/app/delete-account`). Aísla estrictamente la vista previa Demo #12.
 *
 * @businessRules
 * - Nunca muestra éxito ficticio: errores de red o HTTP 4xx/5xx activan `profileError`.
 * - En Demo #12 (`isDemoPreview`) bloquea escrituras reales en servidor y advierte limpiamente.
 * - Textos 100% bilingües usando claves `mobile_legal.*` de `lib/i18n.tsx`.
 *
 * @dataFlow
 * - Consume `CustomerAppV2Controller` (`loggedUser`, `isDemoPreview`, `handleSaveV2Profile`, etc.).
 *
 * @notes
 * - Conecta también el botón de soporte directo en app (`setAuthSheet('contact-support')`).
 */

'use client'

import React from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  Check,
  Edit3,
  ExternalLink,
  HelpCircle,
  LogOut,
  Mail,
  MapPin,
  RotateCcw,
  Shield,
  Trash2,
} from 'lucide-react'
import type { CustomerAppV2Controller } from '../hooks/useCustomerAppV2'

export function AccountTab({ ctrl }: { ctrl: CustomerAppV2Controller }) {
  const {
    lang,
    t,
    toggleLang,
    isDemoPreview,
    loggedUser,
    profileNotice,
    profileError,
    isEditingProfile,
    setIsEditingProfile,
    editFirstName,
    setEditFirstName,
    editLastName,
    setEditLastName,
    editEmail,
    setEditEmail,
    editPhone,
    setEditPhone,
    savingProfile,
    handleOpenEditProfile,
    handleSaveV2Profile,
    handleSignOutV2,
    setOtpStep,
    setAuthError,
    setAuthSheet,
    fulfillmentMode,
    handleSelectOrderMode,
    currentStore,
    setStoreModalOpen,
    setWrapperResetModalOpen,
    handleClearRecentOrderSessions,
    setDeleteAccountError,
    setV2DeleteModalOpen,
  } = ctrl

  return (
    <div className="p-5 space-y-4 pb-24">
      {isDemoPreview && (
        <div className="p-3 rounded-2xl bg-[#FFC72C]/12 border border-[#FFC72C]/45 space-y-1">
          <p className="text-[10px] font-black uppercase tracking-wider text-[#FFC72C]">
            {t('mobile_legal.v2_demo_preview_badge')}
          </p>
          <p className="text-[11px] text-white/80 leading-relaxed">
            {t('mobile_legal.v2_demo_preview_desc')}
          </p>
        </div>
      )}

      {profileNotice && (
        <div className="px-3.5 py-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs font-bold flex items-center gap-2">
          <Check size={14} className="shrink-0" />
          <span>{profileNotice}</span>
        </div>
      )}

      {profileError && (
        <div className="px-3.5 py-2.5 rounded-xl bg-red-500/15 border border-red-500/40 text-red-300 text-xs font-bold flex items-center gap-2">
          <AlertTriangle size={14} className="shrink-0" />
          <span>{profileError}</span>
        </div>
      )}

      {/* Card 1: Profile */}
      <div className="p-4 rounded-2xl bg-[#1c1c1e] border border-white/10 space-y-3.5">
        {!loggedUser ? (
          <>
            <div className="flex items-center gap-3.5">
              <img
                src="/logo.png?v=75"
                alt="Tacos Gavilan"
                className="w-14 h-14 object-contain shrink-0"
              />
              <div className="min-w-0 flex-1">
                <span className="text-[10px] font-black uppercase tracking-widest text-[#FDC82F]">
                  {t('mobile_legal.v2_welcome_tagline')}
                </span>
                <h3 className="text-base font-black text-white truncate">
                  {t('mobile_legal.v2_account_sign_in_cta')}
                </h3>
                <p className="text-xs text-white/70 leading-relaxed mt-0.5">
                  {t('mobile_legal.v2_auth_modal_sub')}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setOtpStep(1)
                setAuthError(null)
                setAuthSheet('sms-otp')
              }}
              className="w-full py-3 rounded-xl bg-[#DA291C] hover:bg-[#b81d13] text-white text-xs font-black uppercase tracking-wider border border-[#FDC82F]/50 flex items-center justify-center gap-2 cursor-pointer"
            >
              <Mail size={14} className="text-[#FDC82F]" />
              <span>{t('mobile_legal.v2_welcome_sms_cta')}</span>
            </button>
          </>
        ) : isEditingProfile ? (
          <form onSubmit={handleSaveV2Profile} className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-bold uppercase text-white/60 mb-1">
                  {t('mobile_legal.v2_first_name_label')}
                </label>
                <input
                  type="text"
                  value={editFirstName}
                  onChange={(e) => setEditFirstName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-[#FFC72C]"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-white/60 mb-1">
                  {t('mobile_legal.v2_last_name_label')}
                </label>
                <input
                  type="text"
                  value={editLastName}
                  onChange={(e) => setEditLastName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-[#FFC72C]"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase text-white/60 mb-1">
                {t('mobile_legal.v2_email_label')}
              </label>
              <input
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                placeholder={t('mobile_legal.v2_profile_email_placeholder')}
                className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-[#FFC72C]"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase text-white/60 mb-1">
                {t('mobile_legal.v2_phone_label')}
              </label>
              <input
                type="tel"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                placeholder={t('mobile_legal.v2_auth_phone_placeholder')}
                className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-[#FFC72C]"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsEditingProfile(false)}
                className="flex-1 py-2.5 rounded-xl bg-white/10 text-white text-xs font-bold cursor-pointer"
              >
                {t('mobile_legal.v2_cancel_edit_btn')}
              </button>
              <button
                type="submit"
                disabled={savingProfile}
                className="flex-1 py-2.5 rounded-xl bg-[#DA291C] text-white text-xs font-black uppercase cursor-pointer disabled:opacity-60"
              >
                {savingProfile
                  ? t('mobile_legal.v2_saving_profile_btn')
                  : t('mobile_legal.v2_save_profile_btn')}
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-base font-black text-white truncate">
                  {loggedUser.firstName} {loggedUser.lastName}
                </h3>
                {loggedUser.email && (
                  <p className="text-xs text-white/70 truncate">{loggedUser.email}</p>
                )}
                {loggedUser.phone && (
                  <p className="text-xs text-[#FFC72C] font-bold truncate">{loggedUser.phone}</p>
                )}
              </div>
              <button
                type="button"
                onClick={handleOpenEditProfile}
                className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-bold cursor-pointer"
              >
                <Edit3 size={12} />
                <span>{t('mobile_legal.v2_edit_profile_btn')}</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleSignOutV2}
              className="w-full py-2 rounded-xl bg-white/8 hover:bg-white/12 border border-white/10 text-white/80 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <LogOut size={13} />
              <span>{t('mobile_legal.v2_account_sign_out_btn')}</span>
            </button>
          </div>
        )}
      </div>

      {/* Card 2: App Preferences */}
      <div className="p-4 rounded-2xl bg-[#1c1c1e] border border-white/10 space-y-3">
        <h4 className="text-xs font-black uppercase tracking-wider text-white">
          {t('mobile_legal.v2_prefs_title')}
        </h4>

        <div className="flex items-center justify-between">
          <span className="text-xs text-white/75">{t('mobile_legal.v2_pref_lang_label')}</span>
          <button
            type="button"
            onClick={toggleLang}
            className="px-3 py-1.5 rounded-xl bg-black/50 border border-white/15 text-xs font-black text-[#FFC72C] cursor-pointer"
          >
            {lang === 'en' ? 'English -> Español' : 'Español -> English'}
          </button>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-white/75">{t('mobile_legal.v2_pref_mode_label')}</span>
          <div className="inline-flex rounded-xl bg-black/50 p-1 border border-white/10">
            <button
              type="button"
              onClick={() => handleSelectOrderMode('pickup')}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase cursor-pointer ${
                fulfillmentMode === 'pickup' ? 'bg-[#DA291C] text-white' : 'text-white/60'
              }`}
            >
              {t('mobile_legal.v2_pickup_short')}
            </button>
            <button
              type="button"
              onClick={() => handleSelectOrderMode('delivery')}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase cursor-pointer ${
                fulfillmentMode === 'delivery' ? 'bg-[#DA291C] text-white' : 'text-white/60'
              }`}
            >
              {t('mobile_legal.v2_delivery_short')}
            </button>
          </div>
        </div>
      </div>

      {/* Card 3: Active Location & Session */}
      <div className="p-4 rounded-2xl bg-[#1c1c1e] border border-white/10 space-y-3">
        <h4 className="text-xs font-black uppercase tracking-wider text-white">
          {t('mobile_legal.v2_session_card_title')}
        </h4>

        <div className="p-3 rounded-xl bg-black/45 border border-white/10 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-white/55 font-bold">
              {t('mobile_legal.v2_primary_branch_label')}
            </p>
            <p className="text-xs font-black text-white truncate flex items-center gap-1">
              <MapPin size={12} className="text-[#FFC72C] shrink-0" />
              <span>
                {currentStore.cityTitle} · {currentStore.crossStreets}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => setStoreModalOpen(true)}
            className="shrink-0 px-2.5 py-1 rounded-lg bg-white/10 text-xs font-bold text-[#FFC72C] cursor-pointer"
          >
            {t('mobile_legal.v2_change_branch_btn')}
          </button>
        </div>

        <button
          type="button"
          onClick={() => setWrapperResetModalOpen(true)}
          className="w-full py-2.5 rounded-xl bg-white/8 hover:bg-white/12 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <RotateCcw size={13} className="text-[#FFC72C]" />
          <span>{t('mobile_legal.v2_reset_session_btn')}</span>
        </button>

        <button
          type="button"
          onClick={handleClearRecentOrderSessions}
          className="w-full py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/75 text-xs font-bold cursor-pointer"
        >
          {t('mobile_legal.v2_clear_recent_locations_btn')}
        </button>
      </div>

      {/* Card 4: Support, Legal & Account Deletion */}
      <div className="p-4 rounded-2xl bg-[#1c1c1e] border border-white/10 space-y-2.5">
        <h4 className="text-xs font-black uppercase tracking-wider text-white">
          {t('mobile_legal.v2_support_legal_title')}
        </h4>

        <button
          type="button"
          onClick={() => setAuthSheet('contact-support')}
          className="w-full py-2.5 px-3 rounded-xl bg-white/8 hover:bg-white/15 text-white text-xs font-bold flex items-center justify-between cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <HelpCircle size={14} className="text-[#FFC72C]" />
            <span>{t('mobile_legal.v2_support_modal_title')}</span>
          </span>
          <ExternalLink size={12} className="text-white/50" />
        </button>

        <Link
          href="/app/support"
          className="w-full py-2.5 px-3 rounded-xl bg-white/8 hover:bg-white/15 text-white text-xs font-bold flex items-center justify-between"
        >
          <span>{t('mobile_legal.v2_support_link')}</span>
          <ExternalLink size={12} className="text-white/50" />
        </Link>

        <div className="grid grid-cols-2 gap-2">
          <Link
            href="/app/privacy"
            className="py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 text-white/80 text-[11px] font-bold flex items-center justify-center gap-1"
          >
            <Shield size={12} className="text-[#FFC72C]" />
            <span>{t('mobile_legal.nav_privacy')}</span>
          </Link>
          <Link
            href="/app/terms"
            className="py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 text-white/80 text-[11px] font-bold flex items-center justify-center gap-1"
          >
            <span>{t('mobile_legal.nav_terms')}</span>
          </Link>
        </div>

        <Link
          href="/app/delete-account"
          className="w-full py-2.5 px-3 rounded-xl bg-white/5 hover:bg-white/10 text-white/75 text-xs font-bold flex items-center justify-between"
        >
          <span>{t('mobile_legal.v2_delete_web_link')}</span>
          <ExternalLink size={12} className="text-white/50" />
        </Link>

        {loggedUser && (
          <button
            type="button"
            onClick={() => {
              setDeleteAccountError(null)
              setV2DeleteModalOpen(true)
            }}
            className="w-full py-2.5 rounded-xl bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 text-red-300 text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Trash2 size={13} />
            <span>{t('mobile_legal.v2_delete_in_app_btn')}</span>
          </button>
        )}
      </div>
    </div>
  )
}
