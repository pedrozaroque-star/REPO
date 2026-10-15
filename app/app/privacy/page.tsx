/**
 * @module app/app/privacy/page
 * @description Política de Privacidad pública oficial de Tacos Gavilan App (`/app/privacy`).
 *
 * @businessRules
 * - Describe con exactitud qué datos guarda Tacos Gavilan App:
 *   1) Preferencias locales en el dispositivo (`gavilan_selected_store_id`, modalidad Pickup/Delivery, idioma e historial de últimas tiendas abiertas).
 *   2) Cuenta opcional de teléfono verificada por SMS OTP (`app_users`, `app_sessions`) cuando el usuario inicia sesión.
 *   3) Cero permisos de ubicación GPS, cámara o micrófono.
 *   4) El flujo de pedido en línea es provisto por Toast Online Ordering (`https://order.online`) dentro de un WebView nativo en iOS/Android o pestaña externa segura en Web.
 *   5) Los pagos y datos de tarjeta son procesados por Toast y sus proveedores de pago certificados PCI-DSS, nunca almacenados por Tacos Gavilan App.
 *   6) Instrucciones y enlaces directos para eliminación de cuenta dentro de la app y vía web (`/app/delete-account`).
 *
 * @dataFlow
 * - Enlazada desde `app/(tabs)/account.tsx` en `gavilan-app`, App Store Connect y Google Play Console Data Safety.
 *
 * @notes
 * - Ruta pública accesible con `HTTP 200` sin requerir inicio de sesión.
 */

'use client'

import React from 'react'
import Link from 'next/link'
import { ShieldCheck, Lock, Smartphone, CreditCard, Trash2 } from 'lucide-react'
import MobileLegalShell from '@/components/mobile-legal/MobileLegalShell'
import { useLanguage } from '@/lib/i18n'

export default function MobilePrivacyPolicyPage(): React.JSX.Element {
  const { t } = useLanguage()

  return (
    <MobileLegalShell
      title={t('mobile_legal.privacy_title')}
      subtitle={t('mobile_legal.privacy_subtitle')}
    >
      <div className="space-y-6">
        {/* Section 1 */}
        <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center gap-2.5 text-[#DA291C] font-black text-lg mb-3">
            <Smartphone size={20} />
            <h2>{t('mobile_legal.privacy_s1_title')}</h2>
          </div>
          <p className="text-sm text-slate-700 leading-relaxed">
            {t('mobile_legal.privacy_s1_body')}
          </p>
        </section>

        {/* Section 2 */}
        <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center gap-2.5 text-[#DA291C] font-black text-lg mb-4">
            <ShieldCheck size={20} />
            <h2>{t('mobile_legal.privacy_s2_title')}</h2>
          </div>
          <div className="space-y-4 text-sm text-slate-700">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
              <div className="font-bold text-slate-900 mb-1">
                {t('mobile_legal.privacy_s2_item1_title')}
              </div>
              <p className="leading-relaxed">{t('mobile_legal.privacy_s2_item1_desc')}</p>
            </div>
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
              <div className="font-bold text-slate-900 mb-1">
                {t('mobile_legal.privacy_s2_item2_title')}
              </div>
              <p className="leading-relaxed">{t('mobile_legal.privacy_s2_item2_desc')}</p>
            </div>
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200">
              <div className="font-bold text-emerald-950 mb-1">
                {t('mobile_legal.privacy_s2_item3_title')}
              </div>
              <p className="text-emerald-900 leading-relaxed">
                {t('mobile_legal.privacy_s2_item3_desc')}
              </p>
            </div>
          </div>
        </section>

        {/* Section 3 */}
        <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center gap-2.5 text-[#DA291C] font-black text-lg mb-3">
            <CreditCard size={20} />
            <h2>{t('mobile_legal.privacy_s3_title')}</h2>
          </div>
          <p className="text-sm text-slate-700 leading-relaxed mb-3">
            {t('mobile_legal.privacy_s3_body1')}
          </p>
          <p className="text-sm text-slate-800 font-semibold leading-relaxed bg-amber-50 border border-amber-200 p-4 rounded-xl">
            {t('mobile_legal.privacy_s3_body2')}
          </p>
        </section>

        {/* Section 4 */}
        <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center gap-2.5 text-[#DA291C] font-black text-lg mb-3">
            <Lock size={20} />
            <h2>{t('mobile_legal.privacy_s4_title')}</h2>
          </div>
          <p className="text-sm text-slate-700 leading-relaxed">
            {t('mobile_legal.privacy_s4_body')}
          </p>
        </section>

        {/* Section 5 */}
        <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center gap-2.5 text-[#DA291C] font-black text-lg mb-3">
            <Trash2 size={20} />
            <h2>{t('mobile_legal.privacy_s5_title')}</h2>
          </div>
          <p className="text-sm text-slate-700 leading-relaxed mb-4">
            {t('mobile_legal.privacy_s5_body')}
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/app/delete-account"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#DA291C] text-white text-xs font-extrabold hover:bg-red-700 transition-colors"
            >
              <Trash2 size={15} />
              <span>{t('mobile_legal.nav_delete')}</span>
            </Link>
            <Link
              href="/app/support"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-extrabold hover:bg-slate-800 transition-colors"
            >
              <span>{t('mobile_legal.nav_support')}</span>
            </Link>
          </div>
        </section>
      </div>
    </MobileLegalShell>
  )
}
