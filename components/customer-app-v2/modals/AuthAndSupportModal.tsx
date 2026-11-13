/**
 * @module components/customer-app-v2/modals/AuthAndSupportModal
 * @description Modales de autenticación por código OTP de 6 dígitos (Correo Electrónico y
 * Teléfono SMS con selector bilingüe) y hoja de Soporte Directo Tacos Gavilan (`contact-support`)
 * que antes no estaba implementada para la variante `V2AuthSheet = 'contact-support'`.
 *
 * @businessRules
 * - Conecta con `/api/mobile/auth/send-otp` y `/api/mobile/auth/verify-otp` enviando `Accept-Language`.
 * - Implementa ambas ramas de `V2AuthSheet` (`'sms-otp'` y `'contact-support'`).
 * - Textos 100% bilingües vía `t('mobile_legal.*')`.
 *
 * @dataFlow
 * - Consume `authSheet`, `authMethod`, `otpStep`, `handleSendOtp`, `handleVerifyOtp`, `currentStore`.
 *
 * @notes
 * - Elimina los strings duros de placeholders `tu@correo.com` y `you@email.com` sustituyéndolos por i18n.
 */

'use client'

import React from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import { ExternalLink, HelpCircle, Mail, Phone, X } from 'lucide-react'
import type { CustomerAppV2Controller } from '../hooks/useCustomerAppV2'

export function AuthAndSupportModal({ ctrl }: { ctrl: CustomerAppV2Controller }) {
  const {
    t,
    authSheet,
    setAuthSheet,
    authMethod,
    setAuthMethod,
    phoneInput,
    setPhoneInput,
    otpInput,
    setOtpInput,
    otpStep,
    setOtpStep,
    authLoading,
    authError,
    setAuthError,
    handleSendOtp,
    handleVerifyOtp,
    currentStore,
  } = ctrl

  return (
    <AnimatePresence>
      {authSheet === 'sms-otp' && (
        <motion.div
          key="v2-auth-otp-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-50 bg-black/80 backdrop-blur-md flex flex-col justify-end"
        >
          <motion.div
            initial={{ y: 220 }}
            animate={{ y: 0 }}
            exit={{ y: 220 }}
            className="bg-[#18181b] rounded-t-3xl border-t border-[#FDC82F]/40 p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-[#FDC82F]">
                  <Mail size={12} />
                  <span>{t('mobile_legal.v2_auth_modal_title')}</span>
                </span>
                <h3 className="text-base font-black text-white mt-0.5">
                  {otpStep === 1
                    ? t('mobile_legal.v2_auth_modal_title')
                    : t('mobile_legal.v2_auth_verify_title')}
                </h3>
                <p className="text-xs text-white/70 mt-0.5 leading-relaxed">
                  {otpStep === 1
                    ? t('mobile_legal.v2_auth_modal_sub')
                    : `${t('mobile_legal.v2_auth_verify_sent_to')} ${phoneInput.trim()}`}
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setAuthSheet(null)
                  setAuthError(null)
                }}
                className="p-2 rounded-full bg-white/10 text-white hover:bg-white/20 cursor-pointer shrink-0"
              >
                <X size={15} />
              </button>
            </div>

            {otpStep === 1 && (
              <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-black/50 border border-white/10">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMethod('email')
                    setAuthError(null)
                  }}
                  className={`py-2 rounded-lg text-xs font-black uppercase cursor-pointer ${
                    authMethod === 'email'
                      ? 'bg-[#DA291C] text-white'
                      : 'text-white/65 hover:text-white'
                  }`}
                >
                  {t('mobile_legal.v2_auth_email_tab')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMethod('sms')
                    setAuthError(null)
                  }}
                  className={`py-2 rounded-lg text-xs font-black uppercase cursor-pointer ${
                    authMethod === 'sms'
                      ? 'bg-[#DA291C] text-white'
                      : 'text-white/65 hover:text-white'
                  }`}
                >
                  {t('mobile_legal.v2_auth_sms_tab')}
                </button>
              </div>
            )}

            {otpStep === 1 ? (
              <form onSubmit={handleSendOtp} className="space-y-3">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-white/70 mb-1">
                    {authMethod === 'email'
                      ? t('mobile_legal.v2_auth_email_label')
                      : t('mobile_legal.v2_auth_phone_label')}
                  </label>
                  <input
                    type={authMethod === 'email' ? 'email' : 'tel'}
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(e.target.value)}
                    placeholder={
                      authMethod === 'email'
                        ? t('mobile_legal.v2_auth_email_placeholder')
                        : t('mobile_legal.v2_auth_phone_placeholder')
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl bg-black/60 border border-white/15 text-sm text-white placeholder-white/40 focus:outline-none focus:border-[#FFC72C]"
                  />
                </div>

                {authError && (
                  <p className="text-xs font-bold text-red-400">{authError}</p>
                )}

                <button
                  type="submit"
                  disabled={authLoading}
                  className="w-full py-3 rounded-xl bg-[#DA291C] hover:bg-[#b81d13] text-white text-xs font-black uppercase tracking-wider border border-[#FDC82F]/50 cursor-pointer disabled:opacity-60"
                >
                  {authLoading
                    ? t('mobile_legal.v2_auth_sending_code')
                    : t('mobile_legal.v2_auth_send_code')}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifyOtp} className="space-y-3">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-white/70 mb-1">
                    {t('mobile_legal.v2_auth_code_label')}
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={otpInput}
                    onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, ''))}
                    placeholder={t('mobile_legal.delete_otp_placeholder')}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-black/60 border border-white/15 text-center tracking-[0.4em] text-lg font-black text-white placeholder-white/30 focus:outline-none focus:border-[#FFC72C]"
                  />
                </div>

                {authError && (
                  <p className="text-xs font-bold text-red-400">{authError}</p>
                )}

                <button
                  type="submit"
                  disabled={authLoading}
                  className="w-full py-3 rounded-xl bg-[#DA291C] hover:bg-[#b81d13] text-white text-xs font-black uppercase tracking-wider border border-[#FDC82F]/50 cursor-pointer disabled:opacity-60"
                >
                  {authLoading
                    ? t('mobile_legal.v2_auth_verifying')
                    : t('mobile_legal.v2_auth_verify_confirm')}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setOtpStep(1)
                    setOtpInput('')
                    setAuthError(null)
                  }}
                  className="w-full py-2 text-xs font-bold text-[#FFC72C] hover:underline cursor-pointer"
                >
                  {t('mobile_legal.v2_auth_change_contact')}
                </button>
              </form>
            )}
          </motion.div>
        </motion.div>
      )}

      {authSheet === 'contact-support' && (
        <motion.div
          key="v2-contact-support-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-50 bg-black/80 backdrop-blur-md flex flex-col justify-end"
        >
          <motion.div
            initial={{ y: 200 }}
            animate={{ y: 0 }}
            exit={{ y: 200 }}
            className="bg-[#18181b] rounded-t-3xl border-t border-[#FDC82F]/40 p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-[#FDC82F]">
                  <HelpCircle size={12} />
                  <span>Tacos Gavilan</span>
                </span>
                <h3 className="text-base font-black text-white mt-0.5">
                  {t('mobile_legal.v2_support_modal_title')}
                </h3>
                <p className="text-xs text-white/70 mt-0.5 leading-relaxed">
                  {t('mobile_legal.v2_support_modal_desc')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAuthSheet(null)}
                className="p-2 rounded-full bg-white/10 text-white hover:bg-white/20 cursor-pointer shrink-0"
              >
                <X size={15} />
              </button>
            </div>

            <div className="space-y-2.5">
              <a
                href={`tel:${currentStore.phone.replace(/[^\d+]/g, '')}`}
                className="w-full py-3 px-4 rounded-xl bg-[#DA291C] text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2"
              >
                <Phone size={14} className="text-[#FDC82F]" />
                <span>
                  {t('mobile_legal.v2_support_call_active_store')} · {currentStore.phone}
                </span>
              </a>

              <a
                href="mailto:support@tacosgavilan.com"
                className="w-full py-3 px-4 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-bold flex items-center justify-center gap-2"
              >
                <Mail size={14} className="text-[#FFC72C]" />
                <span>{t('mobile_legal.v2_support_email_btn')}</span>
              </a>

              <Link
                href="/app/support"
                className="w-full py-3 px-4 rounded-xl bg-black/50 border border-white/15 text-[#FFC72C] text-xs font-bold flex items-center justify-center gap-2"
              >
                <span>{t('mobile_legal.v2_support_open_directory')}</span>
                <ExternalLink size={13} />
              </Link>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
