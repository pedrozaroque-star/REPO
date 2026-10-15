/**
 * @module components/mobile-legal/MobileLegalShell
 * @description Contenedor compartido para las páginas públicas legales, de soporte y de eliminación
 * de cuenta de Tacos Gavilan App (`/app/privacy`, `/app/terms`, `/app/support`, `/app/delete-account`).
 *
 * @businessRules
 * - Accesible públicamente con `HTTP 200` sin requerir autenticación administrativa de TEG System,
 *   cumpliendo con los requisitos de Apple App Review y Google Play Console.
 * - Soporta conmutación bilingüe instantánea Inglés / Español mediante `useLanguage()` de `@/lib/i18n`.
 * - Marca oficial: **Tacos Gavilan**.
 *
 * @dataFlow
 * - Consumido por `/app/privacy`, `/app/terms`, `/app/support` y `/app/delete-account`.
 *
 * @notes
 * - Incluye navegación cruzada entre las 4 páginas obligatorias y botón de retorno a `/app`.
 */

'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Shield, FileText, PhoneCall, Trash2, ArrowLeft, Globe } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'

interface MobileLegalShellProps {
  title: string
  subtitle: string
  children: React.ReactNode
}

export default function MobileLegalShell({
  title,
  subtitle,
  children,
}: MobileLegalShellProps): React.JSX.Element {
  const pathname = usePathname()
  const { language, setLanguage, t } = useLanguage()

  const navItems = [
    { href: '/app/privacy', label: t('mobile_legal.nav_privacy'), icon: Shield },
    { href: '/app/terms', label: t('mobile_legal.nav_terms'), icon: FileText },
    { href: '/app/support', label: t('mobile_legal.nav_support'), icon: PhoneCall },
    { href: '/app/delete-account', label: t('mobile_legal.nav_delete'), icon: Trash2 },
  ]

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-slate-900 flex flex-col">
      {/* Top Corporate Bar */}
      <header className="bg-[#50050a] text-white border-b-4 border-[#FDC82F] sticky top-0 z-30 shadow-md">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/app"
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-xs font-bold text-[#FDC82F] border border-[#FDC82F]/40 transition-colors"
            >
              <ArrowLeft size={14} />
              <span>{t('mobile_legal.back_to_app')}</span>
            </Link>
            <div>
              <div className="text-base sm:text-lg font-black tracking-wide text-white">
                {t('mobile_legal.brand_name')}
              </div>
              <div className="text-[10px] font-extrabold tracking-widest text-[#FDC82F]">
                {t('mobile_legal.app_badge')}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLanguage(language === 'en' ? 'es' : 'en')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#FDC82F] text-[#50050a] font-black text-xs shadow-sm hover:bg-[#eab308] transition-colors"
            >
              <Globe size={14} />
              <span>{language === 'en' ? 'ESPAÑOL' : 'ENGLISH'}</span>
            </button>
          </div>
        </div>

        {/* Sub-navigation */}
        <nav className="bg-[#3d0307] border-t border-white/10">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-2 flex items-center gap-2 overflow-x-auto">
            {navItems.map((item) => {
              const Icon = item.icon
              const active = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors ${
                    active
                      ? 'bg-[#DA291C] text-white shadow-sm'
                      : 'text-white/80 hover:text-white hover:bg-white/10'
                  }`}
                >
                  <Icon size={13} />
                  <span>{item.label}</span>
                </Link>
              )
            })}
          </div>
        </nav>
      </header>

      {/* Hero Banner */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            {title}
          </h1>
          <p className="mt-2 text-sm sm:text-base text-slate-600 max-w-3xl leading-relaxed">
            {subtitle}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-slate-500 font-semibold">
            <span>
              {t('mobile_legal.effective_date_label')}{' '}
              <strong className="text-slate-800">{t('mobile_legal.effective_date_value')}</strong>
            </span>
            <span>•</span>
            <span>
              {t('mobile_legal.contact_email_label')}{' '}
              <a
                href="mailto:support@tacosgavilan.com"
                className="text-[#DA291C] underline font-bold"
              >
                {t('mobile_legal.contact_email_value')}
              </a>
            </span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8">
        {children}
      </main>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 text-xs py-6 border-t border-slate-800">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="font-bold text-slate-300">{t('mobile_legal.footer_copyright')}</div>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/app/privacy" className="hover:text-white transition-colors">
              {t('mobile_legal.nav_privacy')}
            </Link>
            <Link href="/app/terms" className="hover:text-white transition-colors">
              {t('mobile_legal.nav_terms')}
            </Link>
            <Link href="/app/support" className="hover:text-white transition-colors">
              {t('mobile_legal.nav_support')}
            </Link>
            <Link href="/app/delete-account" className="hover:text-white transition-colors">
              {t('mobile_legal.nav_delete')}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
