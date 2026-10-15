/**
 * @module app/app/delete-account/page
 * @description Página web pública e interactiva de Eliminación de Cuenta y Datos para
 * Tacos Gavilan App (`/app/delete-account`).
 *
 * @businessRules
 * - Cumple con Apple App Store Review Guideline 5.1.1(v) y Google Play Account Deletion Policy:
 *   1) Documenta los pasos para iniciar y completar la eliminación inmediata dentro de la aplicación (`Account` -> `Delete My Account Permanently`).
 *   2) Permite a cualquier usuario (incluso si ya desinstaló la app) verificar su teléfono vía SMS OTP (`/api/mobile/auth/send-otp` + `/api/mobile/auth/verify-otp`) y ejecutar la eliminación real en base de datos (`DELETE /api/mobile/user/delete`).
 *   3) Distingue con transparencia qué registros se eliminan en Tacos Gavilan App (`app_users`, `app_sessions`, favoritos y órdenes locales vinculadas) y qué datos son gestionados independientemente por Toast Online Ordering (`order.online`).
 *
 * @dataFlow
 * - Formulario Web -> `POST /api/mobile/auth/send-otp` -> `POST /api/mobile/auth/verify-otp` -> `DELETE /api/mobile/user/delete`.
 *
 * @notes
 * - Ruta pública accesible con `HTTP 200` sin requerir sesión previa.
 */

'use client'

import React, { useState } from 'react'
import { Trash2, Smartphone, ShieldAlert, CheckCircle2, Phone } from 'lucide-react'
import MobileLegalShell from '@/components/mobile-legal/MobileLegalShell'
import { useLanguage } from '@/lib/i18n'

export default function MobileDeleteAccountPage(): React.JSX.Element {
  const { t } = useLanguage()

  const [phone, setPhone] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [deletedSuccess, setDeletedSuccess] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)
    if (!phone.trim()) return

    setLoading(true)
    try {
      const res = await fetch('/api/mobile/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Could not send verification code')
      }
      setOtpSent(true)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Error sending SMS code')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyAndDelete = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)
    if (!phone.trim() || !otpCode.trim()) return

    setLoading(true)
    try {
      const verifyRes = await fetch('/api/mobile/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim(), code: otpCode.trim() }),
      })
      const verifyData = await verifyRes.json()
      if (!verifyRes.ok || !verifyData.sessionToken) {
        throw new Error(verifyData.error || 'Invalid verification code')
      }

      const deleteRes = await fetch('/api/mobile/user/delete', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${verifyData.sessionToken}`,
        },
      })
      const deleteData = await deleteRes.json()
      if (!deleteRes.ok || !deleteData.deleted) {
        throw new Error(deleteData.error || 'Could not complete account deletion')
      }

      setDeletedSuccess(true)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Error deleting account')
    } finally {
      setLoading(false)
    }
  }

  return (
    <MobileLegalShell
      title={t('mobile_legal.delete_title')}
      subtitle={t('mobile_legal.delete_subtitle')}
    >
      <div className="space-y-6">
        {/* Option 1: In-App Deletion */}
        <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center gap-2.5 text-[#DA291C] font-black text-lg mb-3">
            <Smartphone size={20} />
            <h2>{t('mobile_legal.delete_in_app_title')}</h2>
          </div>
          <ul className="space-y-2 text-sm text-slate-700 font-medium">
            <li>{t('mobile_legal.delete_in_app_step1')}</li>
            <li>{t('mobile_legal.delete_in_app_step2')}</li>
            <li>{t('mobile_legal.delete_in_app_step3')}</li>
          </ul>
        </section>

        {/* Option 2: Direct Web Deletion */}
        <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center gap-2.5 text-[#DA291C] font-black text-lg mb-3">
            <Trash2 size={20} />
            <h2>{t('mobile_legal.delete_web_title')}</h2>
          </div>
          <p className="text-sm text-slate-700 leading-relaxed mb-5">
            {t('mobile_legal.delete_web_desc')}
          </p>

          {deletedSuccess ? (
            <div className="p-5 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-start gap-3">
              <CheckCircle2 size={22} className="text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-black text-emerald-950 text-base">
                  {t('mobile_legal.delete_success_title')}
                </h3>
                <p className="text-sm text-emerald-900 mt-1">
                  {t('mobile_legal.delete_success_body')}
                </p>
              </div>
            </div>
          ) : (
            <form
              onSubmit={otpSent ? handleVerifyAndDelete : handleSendOtp}
              className="max-w-md space-y-4 bg-slate-50 border border-slate-200 rounded-2xl p-5"
            >
              <div>
                <label className="block text-xs font-extrabold text-slate-700 uppercase tracking-wider mb-1.5">
                  {t('mobile_legal.delete_phone_label')}
                </label>
                <div className="relative">
                  <Phone
                    size={15}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    disabled={otpSent || loading}
                    placeholder={t('mobile_legal.delete_phone_placeholder')}
                    className="w-full pl-9 pr-3.5 py-2.5 rounded-xl bg-white border border-slate-300 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#DA291C]"
                    required
                  />
                </div>
              </div>

              {otpSent && (
                <div>
                  <label className="block text-xs font-extrabold text-slate-700 uppercase tracking-wider mb-1.5">
                    {t('mobile_legal.delete_otp_label')}
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    disabled={loading}
                    placeholder={t('mobile_legal.delete_otp_placeholder')}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-300 text-sm font-bold tracking-widest text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#DA291C]"
                    required
                  />
                </div>
              )}

              {errorMessage && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-bold text-red-700">
                  {errorMessage}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#DA291C] hover:bg-red-700 disabled:opacity-60 text-white text-xs font-black tracking-wide transition-colors"
              >
                <Trash2 size={15} />
                <span>
                  {loading
                    ? otpSent
                      ? t('mobile_legal.delete_deleting')
                      : t('mobile_legal.delete_sending_otp')
                    : otpSent
                      ? t('mobile_legal.delete_confirm_btn')
                      : t('mobile_legal.delete_send_otp_btn')}
                </span>
              </button>
            </form>
          )}
        </section>

        {/* Data retention & scope disclosure */}
        <section className="bg-amber-50 border border-amber-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-2.5 text-amber-900 font-black text-lg mb-3">
            <ShieldAlert size={20} />
            <h2>{t('mobile_legal.delete_what_deleted_title')}</h2>
          </div>
          <ul className="space-y-2.5 text-sm text-amber-950 leading-relaxed list-disc pl-5">
            <li>{t('mobile_legal.delete_what_deleted_item1')}</li>
            <li>{t('mobile_legal.delete_what_deleted_item2')}</li>
          </ul>
        </section>
      </div>
    </MobileLegalShell>
  )
}
