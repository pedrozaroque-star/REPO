/**
 * @module app/app/support/page
 * @description Centro de Soporte al Cliente y Directorio Oficial Verificado de las 15 Sucursales
 * de Tacos Gavilan (`/app/support`).
 *
 * @businessRules
 * - Muestra las 15 sucursales oficiales con dirección, teléfono directo verificado contra
 *   https://tacosgavilan.com/locations/, horarios reales por día de la semana (America/Los_Angeles)
 *   y enlace seguro a Toast Online Ordering (`https://order.online/store/...`).
 * - Explica honestamente cómo consultar recibos, confirmaciones y estado de órdenes procesadas por Toast.
 *
 * @dataFlow
 * - Enlazado desde `app/(tabs)/account.tsx`, `app/(tabs)/tracker.tsx` y App Store Connect Support URL.
 *
 * @notes
 * - Ruta pública accesible con `HTTP 200` sin requerir autenticación.
 */

'use client'

import React from 'react'
import { PhoneCall, MapPin, Clock, ExternalLink, HelpCircle } from 'lucide-react'
import MobileLegalShell from '@/components/mobile-legal/MobileLegalShell'
import { useLanguage } from '@/lib/i18n'

interface VerifiedBranchRow {
  id: string
  name: string
  address: string
  phone: string
  hoursEn: string
  hoursEs: string
  toastOnlineUrl: string
}

const VERIFIED_15_BRANCHES: VerifiedBranchRow[] = [
  {
    id: '4',
    name: 'Azusa',
    address: '887 S. Azusa Ave., Azusa, CA 91702',
    phone: '(626) 969-1011',
    hoursEn: 'Sun–Thu: 10:00 AM – 11:00 PM | Fri–Sat: 10:00 AM – 12:00 AM',
    hoursEs: 'Dom–Jue: 10:00 AM – 11:00 PM | Vie–Sáb: 10:00 AM – 12:00 AM',
    toastOnlineUrl: 'https://order.online/store/tacos-gavilan-azusa-718169',
  },
  {
    id: '13',
    name: 'Bell',
    address: '4406 E. Florence Ave., Bell, CA 90201',
    phone: '(323) 771-1722',
    hoursEn: 'Sun–Thu: 10:00 AM – 12:00 AM | Fri–Sat: 10:00 AM – 2:00 AM',
    hoursEs: 'Dom–Jue: 10:00 AM – 12:00 AM | Vie–Sáb: 10:00 AM – 2:00 AM',
    toastOnlineUrl: 'https://order.online/store/tacos-gavilan-bell-260912',
  },
  {
    id: '16',
    name: 'Downey',
    address: '7947 E. Florence Ave., Downey, CA 90240',
    phone: '(562) 927-7486',
    hoursEn: 'Sun–Thu: 10:00 AM – 12:00 AM | Fri–Sat: 10:00 AM – 3:00 AM',
    hoursEs: 'Dom–Jue: 10:00 AM – 12:00 AM | Vie–Sáb: 10:00 AM – 3:00 AM',
    toastOnlineUrl: 'https://order.online/store/tacos-gavilan-downey-302620',
  },
  {
    id: '8',
    name: 'Hollywood',
    address: '7070 Sunset Blvd., Los Angeles, CA 90028',
    phone: '(323) 963-7993',
    hoursEn: 'Sun–Thu: 9:00 AM – 12:00 AM | Fri–Sat: 9:00 AM – 3:00 AM',
    hoursEs: 'Dom–Jue: 9:00 AM – 12:00 AM | Vie–Sáb: 9:00 AM – 3:00 AM',
    toastOnlineUrl: 'https://order.online/store/tacos-gavilan-los-angeles-551916',
  },
  {
    id: '11',
    name: 'Huntington Park',
    address: '2425 E. Florence Ave., Huntington Park, CA 90255',
    phone: '(323) 581-7309',
    hoursEn: 'Sun–Wed: 10:00 AM – 12:00 AM | Thu: 10:00 AM – 2:00 AM | Fri–Sat: 10:00 AM – 3:00 AM',
    hoursEs: 'Dom–Mié: 10:00 AM – 12:00 AM | Jue: 10:00 AM – 2:00 AM | Vie–Sáb: 10:00 AM – 3:00 AM',
    toastOnlineUrl: 'https://order.online/store/tacos-gavilan-huntington-park-260849',
  },
  {
    id: '5',
    name: 'LA Broadway',
    address: '4380 S. Broadway, Los Angeles, CA 90037',
    phone: '(323) 233-2302',
    hoursEn: 'Mon–Wed: 8:00 AM – 1:00 AM | Thu & Sun: 8:00 AM – 2:00 AM | Fri–Sat: 8:00 AM – 4:00 AM',
    hoursEs: 'Lun–Mié: 8:00 AM – 1:00 AM | Jue y Dom: 8:00 AM – 2:00 AM | Vie–Sáb: 8:00 AM – 4:00 AM',
    toastOnlineUrl: 'https://order.online/store/tacos-gavilan-los-angeles-260769',
  },
  {
    id: '6',
    name: 'LA Central',
    address: '1900 S. Central Ave., Los Angeles, CA 90011',
    phone: '(213) 742-6677',
    hoursEn: 'Sun–Wed: 8:00 AM – 2:00 AM | Thu: 8:00 AM – 3:00 AM | Fri–Sat: 8:00 AM – 4:00 AM',
    hoursEs: 'Dom–Mié: 8:00 AM – 2:00 AM | Jue: 8:00 AM – 3:00 AM | Vie–Sáb: 8:00 AM – 4:00 AM',
    toastOnlineUrl: 'https://order.online/store/tacos-gavilan-los-angeles-260847',
  },
  {
    id: '10',
    name: 'La Puente',
    address: '13009 Valley Blvd., La Puente, CA 91746',
    phone: '(626) 336-3000',
    hoursEn: 'Sun–Thu: 10:00 AM – 12:00 AM | Fri–Sat: 10:00 AM – 2:00 AM',
    hoursEs: 'Dom–Jue: 10:00 AM – 12:00 AM | Vie–Sáb: 10:00 AM – 2:00 AM',
    toastOnlineUrl: 'https://order.online/store/tacos-gavilan-la-puente-963464',
  },
  {
    id: '14',
    name: 'Lynwood',
    address: '3220 E. Imperial Hwy., Lynwood, CA 90262',
    phone: '(424) 785-5535',
    hoursEn: 'Sun–Wed: 10:00 AM – 1:00 AM | Thu: 10:00 AM – 2:00 AM | Fri–Sat: 10:00 AM – 3:00 AM',
    hoursEs: 'Dom–Mié: 10:00 AM – 1:00 AM | Jue: 10:00 AM – 2:00 AM | Vie–Sáb: 10:00 AM – 3:00 AM',
    toastOnlineUrl: 'https://order.online/store/tacos-gavilan-lynwood-727877',
  },
  {
    id: '12',
    name: 'Norwalk',
    address: '10968 Rosecrans Ave., Norwalk, CA 90650',
    phone: '(562) 651-0045',
    hoursEn: 'Sun–Thu: 10:00 AM – 1:00 AM | Fri–Sat: 10:00 AM – 3:00 AM',
    hoursEs: 'Dom–Jue: 10:00 AM – 1:00 AM | Vie–Sáb: 10:00 AM – 3:00 AM',
    toastOnlineUrl: 'https://order.online/store/tacos-gavilan-norwalk-1327857',
  },
  {
    id: '1',
    name: 'Rialto',
    address: '115 E. Baseline Rd., Rialto, CA 92376',
    phone: '(909) 562-0430',
    hoursEn: 'Sun–Thu: 10:00 AM – 12:00 AM | Fri–Sat: 10:00 AM – 2:00 AM',
    hoursEs: 'Dom–Jue: 10:00 AM – 12:00 AM | Vie–Sáb: 10:00 AM – 2:00 AM',
    toastOnlineUrl: 'https://order.online/store/tacos-gavilan-rialto-841931',
  },
  {
    id: '9',
    name: 'Santa Ana',
    address: '1258 E. 17th St., Santa Ana, CA 92701',
    phone: '(714) 480-0713',
    hoursEn: 'Sun–Thu: 10:00 AM – 12:00 AM | Fri–Sat: 10:00 AM – 2:00 AM',
    hoursEs: 'Dom–Jue: 10:00 AM – 12:00 AM | Vie–Sáb: 10:00 AM – 2:00 AM',
    toastOnlineUrl: 'https://order.online/store/tacos-gavilan-santa-ana-724574',
  },
  {
    id: '7',
    name: 'Slauson',
    address: '5833 S. Broadway, Los Angeles, CA 90003',
    phone: '(323) 615-0084',
    hoursEn: 'Sun–Thu: 10:00 AM – 1:00 AM | Fri–Sat: 10:00 AM – 3:00 AM',
    hoursEs: 'Dom–Jue: 10:00 AM – 1:00 AM | Vie–Sáb: 10:00 AM – 3:00 AM',
    toastOnlineUrl: 'https://order.online/store/tacos-gavilan-slauson-broadway-23989119',
  },
  {
    id: '15',
    name: 'South Gate',
    address: '5800 Firestone Blvd., South Gate, CA 90280',
    phone: '(562) 806-1200',
    hoursEn: 'Sun–Thu: 10:00 AM – 12:00 AM | Fri–Sat: 10:00 AM – 3:00 AM',
    hoursEs: 'Dom–Jue: 10:00 AM – 12:00 AM | Vie–Sáb: 10:00 AM – 3:00 AM',
    toastOnlineUrl: 'https://order.online/store/tacos-gavilan-south-gate-846517',
  },
  {
    id: '3',
    name: 'West Covina',
    address: '101 S. Azusa Ave., West Covina, CA 91791',
    phone: '(626) 917-2662',
    hoursEn: 'Sun–Thu: 10:00 AM – 1:00 AM | Fri–Sat: 10:00 AM – 3:00 AM',
    hoursEs: 'Dom–Jue: 10:00 AM – 1:00 AM | Vie–Sáb: 10:00 AM – 3:00 AM',
    toastOnlineUrl: 'https://order.online/store/tacos-gavilan-west-covina-725035',
  },
]

export default function MobileSupportPage(): React.JSX.Element {
  const { language, t } = useLanguage()

  return (
    <MobileLegalShell
      title={t('mobile_legal.support_title')}
      subtitle={t('mobile_legal.support_subtitle')}
    >
      <div className="space-y-6">
        {/* Help Banner */}
        <section className="bg-amber-50 border border-amber-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-2.5 text-amber-900 font-black text-lg mb-2">
            <HelpCircle size={20} />
            <h2>{t('mobile_legal.support_help_card_title')}</h2>
          </div>
          <p className="text-sm text-amber-950 leading-relaxed">
            {t('mobile_legal.support_help_card_body')}
          </p>
        </section>

        {/* 15 Verified Branches Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {VERIFIED_15_BRANCHES.map((branch) => {
            const digits = branch.phone.replace(/[^\d+]/g, '')
            return (
              <div
                key={branch.id}
                className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm flex flex-col justify-between gap-4"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <h3 className="text-base font-black text-slate-900">
                      Tacos Gavilan — {branch.name}
                    </h3>
                    <span className="text-[11px] font-extrabold px-2.5 py-0.5 rounded-full bg-red-50 text-[#DA291C] border border-red-200">
                      #{branch.id}
                    </span>
                  </div>

                  <div className="space-y-1.5 text-xs text-slate-600">
                    <div className="flex items-start gap-2">
                      <MapPin size={14} className="text-[#DA291C] shrink-0 mt-0.5" />
                      <span>{branch.address}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <Clock size={14} className="text-amber-600 shrink-0 mt-0.5" />
                      <span className="font-semibold text-slate-700">
                        {language === 'en' ? branch.hoursEn : branch.hoursEs}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100">
                  <a
                    href={`tel:${digits}`}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold transition-colors"
                  >
                    <PhoneCall size={13} />
                    <span>
                      {t('mobile_legal.support_call_btn')} {branch.phone}
                    </span>
                  </a>

                  <a
                    href={branch.toastOnlineUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#DA291C] hover:bg-red-700 text-white text-xs font-extrabold transition-colors"
                  >
                    <span>{t('mobile_legal.support_order_btn')}</span>
                    <ExternalLink size={13} />
                  </a>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </MobileLegalShell>
  )
}
