/**
 * @module app/app/terms/page
 * @description Términos del Servicio públicos oficiales de Tacos Gavilan App (`/app/terms`).
 *
 * @businessRules
 * - Regula el uso de Tacos Gavilan App y del servicio de pedidos de alimentos y bebidas físicos
 *   (Pickup y Delivery) operado mediante Toast Online Ordering (`order.online`).
 * - Cumple con Apple App Store Review Guideline 3.1.3(e) y Google Play Payments Policy para bienes físicos.
 * - Soporta Inglés y Español mediante `useLanguage()`.
 *
 * @dataFlow
 * - Enlazado desde `app/(tabs)/account.tsx` en `gavilan-app`.
 *
 * @notes
 * - Responde `HTTP 200` públicamente sin requerir sesión administrativa.
 */

'use client'

import React from 'react'
import Link from 'next/link'
import { FileText, ShoppingBag, DollarSign, Clock, Shield } from 'lucide-react'
import MobileLegalShell from '@/components/mobile-legal/MobileLegalShell'
import { useLanguage } from '@/lib/i18n'

export default function MobileTermsOfServicePage(): React.JSX.Element {
  const { t } = useLanguage()

  return (
    <MobileLegalShell
      title={t('mobile_legal.terms_title')}
      subtitle={t('mobile_legal.terms_subtitle')}
    >
      <div className="space-y-6">
        <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center gap-2.5 text-[#DA291C] font-black text-lg mb-3">
            <FileText size={20} />
            <h2>{t('mobile_legal.terms_s1_title')}</h2>
          </div>
          <p className="text-sm text-slate-700 leading-relaxed">
            {t('mobile_legal.terms_s1_body')}
          </p>
        </section>

        <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center gap-2.5 text-[#DA291C] font-black text-lg mb-3">
            <ShoppingBag size={20} />
            <h2>{t('mobile_legal.terms_s2_title')}</h2>
          </div>
          <p className="text-sm text-slate-700 leading-relaxed">
            {t('mobile_legal.terms_s2_body')}
          </p>
        </section>

        <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center gap-2.5 text-[#DA291C] font-black text-lg mb-3">
            <DollarSign size={20} />
            <h2>{t('mobile_legal.terms_s3_title')}</h2>
          </div>
          <p className="text-sm text-slate-700 leading-relaxed">
            {t('mobile_legal.terms_s3_body')}
          </p>
        </section>

        <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center gap-2.5 text-[#DA291C] font-black text-lg mb-3">
            <Clock size={20} />
            <h2>{t('mobile_legal.terms_s4_title')}</h2>
          </div>
          <p className="text-sm text-slate-700 leading-relaxed">
            {t('mobile_legal.terms_s4_body')}
          </p>
        </section>

        <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center gap-2.5 text-[#DA291C] font-black text-lg mb-3">
            <Shield size={20} />
            <h2>{t('mobile_legal.terms_s5_title')}</h2>
          </div>
          <p className="text-sm text-slate-700 leading-relaxed mb-4">
            {t('mobile_legal.terms_s5_body')}
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/app/support"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#DA291C] text-white text-xs font-extrabold hover:bg-red-700 transition-colors"
            >
              <span>{t('mobile_legal.nav_support')}</span>
            </Link>
            <Link
              href="/app/privacy"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-extrabold hover:bg-slate-800 transition-colors"
            >
              <span>{t('mobile_legal.nav_privacy')}</span>
            </Link>
          </div>
        </section>
      </div>
    </MobileLegalShell>
  )
}
