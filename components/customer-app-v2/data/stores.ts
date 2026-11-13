/**
 * @module components/customer-app-v2/data/stores
 * @description Catálogo autoritativo de las 15 sucursales de Tacos Gavilan en el Sur de California,
 * funciones de horario en vivo en zona horaria America/Los_Angeles (con soporte post-medianoche),
 * saludos dinámicos por hora, distancia Haversine y validador estricto de URLs externas de pedido.
 *
 * @businessRules
 * - Día operativo real en America/Los_Angeles: horas menores a 5:00 AM pertenecen a la ventana del día anterior
 *   y cuando `isOpen` es verdadero bajo esa ventana se muestra el horario de la jornada en curso (`prevWindow`).
 * - Normaliza `hour === 24 -> 0` para relojes Intl en medianoche.
 * - Lista blanca HTTPS estricta (`order.online`, `tacosgavilan.com`, `checkout.stripe.com`, Google/Apple Maps).
 *
 * @dataFlow
 * - Importado por `useCustomerAppV2`, `StoresTab`, `OrderHubTab` y `StoreAndMapModals`.
 *
 * @notes
 * - Corrige el bug histórico donde entre medianoche y las 4:59 AM se devolvía `todayWindow` en vez de `prevWindow`.
 */

import type {
  DailyScheduleWindow,
  DayOfWeekIndex,
  V2AuthoritativeStore,
} from '../types'

export function buildSchedule(
  days: Record<DayOfWeekIndex, [number, number, string, string]>
): Record<DayOfWeekIndex, DailyScheduleWindow> {
  const result = {} as Record<DayOfWeekIndex, DailyScheduleWindow>
  for (const key of [0, 1, 2, 3, 4, 5, 6] as DayOfWeekIndex[]) {
    const [openHour, closeHour, labelEn, labelEs] = days[key]
    result[key] = { openHour, closeHour, labelEn, labelEs }
  }
  return result
}

const W_10AM_12AM: [number, number, string, string] = [10, 24, '10:00 AM – 12:00 AM', '10:00 AM – 12:00 AM']
const W_10AM_1AM: [number, number, string, string] = [10, 25, '10:00 AM – 1:00 AM', '10:00 AM – 1:00 AM']
const W_10AM_2AM: [number, number, string, string] = [10, 26, '10:00 AM – 2:00 AM', '10:00 AM – 2:00 AM']
const W_10AM_3AM: [number, number, string, string] = [10, 27, '10:00 AM – 3:00 AM', '10:00 AM – 3:00 AM']
const W_10AM_11PM: [number, number, string, string] = [10, 23, '10:00 AM – 11:00 PM', '10:00 AM – 11:00 PM']
const W_9AM_12AM: [number, number, string, string] = [9, 24, '9:00 AM – 12:00 AM', '9:00 AM – 12:00 AM']
const W_9AM_3AM: [number, number, string, string] = [9, 27, '9:00 AM – 3:00 AM', '9:00 AM – 3:00 AM']
const W_8AM_1AM: [number, number, string, string] = [8, 25, '8:00 AM – 1:00 AM', '8:00 AM – 1:00 AM']
const W_8AM_2AM: [number, number, string, string] = [8, 26, '8:00 AM – 2:00 AM', '8:00 AM – 2:00 AM']
const W_8AM_3AM: [number, number, string, string] = [8, 27, '8:00 AM – 3:00 AM', '8:00 AM – 3:00 AM']
const W_8AM_4AM: [number, number, string, string] = [8, 28, '8:00 AM – 4:00 AM', '8:00 AM – 4:00 AM']

export const V2_STORES: V2AuthoritativeStore[] = [
  {
    id: 6,
    cityTitle: 'Los Angeles',
    crossStreets: 'Central & Washington',
    name: 'Los Angeles Central & Washington',
    streetAddress: '1900 S. Central Ave',
    address: '1900 S. Central Ave, Los Angeles, CA 90011',
    city: 'Los Angeles',
    state: 'CA',
    zipCode: '90011',
    phone: '(213) 742-6677',
    latitude: 34.023884,
    longitude: -118.250561,
    toastOrderingUrl: 'https://order.online/store/tacos-gavilan-los-angeles-260847',
    hoursEn: 'Sun–Wed: 8:00 AM – 2:00 AM | Thu: 8:00 AM – 3:00 AM | Fri–Sat: 8:00 AM – 4:00 AM',
    hoursEs: 'Dom–Mié: 8:00 AM – 2:00 AM | Jue: 8:00 AM – 3:00 AM | Vie–Sáb: 8:00 AM – 4:00 AM',
    weeklySchedule: buildSchedule({
      0: W_8AM_2AM, 1: W_8AM_2AM, 2: W_8AM_2AM, 3: W_8AM_2AM, 4: W_8AM_3AM, 5: W_8AM_4AM, 6: W_8AM_4AM,
    }),
  },
  {
    id: 14,
    cityTitle: 'Lynwood',
    crossStreets: 'Imperial & Long Beach',
    name: 'Lynwood Imperial & Long Beach',
    streetAddress: '3220 E. Imperial Hwy',
    address: '3220 E. Imperial Hwy, Lynwood, CA 90262',
    city: 'Lynwood',
    state: 'CA',
    zipCode: '90262',
    phone: '(424) 785-5535',
    latitude: 33.930001,
    longitude: -118.21232,
    toastOrderingUrl: 'https://order.online/store/tacos-gavilan-lynwood-727877',
    hoursEn: 'Sun–Wed: 10:00 AM – 1:00 AM | Thu: 10:00 AM – 2:00 AM | Fri–Sat: 10:00 AM – 3:00 AM',
    hoursEs: 'Dom–Mié: 10:00 AM – 1:00 AM | Jue: 10:00 AM – 2:00 AM | Vie–Sáb: 10:00 AM – 3:00 AM',
    weeklySchedule: buildSchedule({
      0: W_10AM_1AM, 1: W_10AM_1AM, 2: W_10AM_1AM, 3: W_10AM_1AM, 4: W_10AM_2AM, 5: W_10AM_3AM, 6: W_10AM_3AM,
    }),
  },
  {
    id: 5,
    cityTitle: 'Los Angeles',
    crossStreets: 'Vernon & Broadway',
    name: 'Los Angeles Vernon & Broadway',
    streetAddress: '4380 S. Broadway',
    address: '4380 S. Broadway, Los Angeles, CA 90037',
    city: 'Los Angeles',
    state: 'CA',
    zipCode: '90037',
    phone: '(323) 233-2302',
    latitude: 34.004005,
    longitude: -118.278106,
    toastOrderingUrl: 'https://order.online/store/tacos-gavilan-los-angeles-260769',
    hoursEn: 'Mon–Wed: 8:00 AM – 1:00 AM | Thu & Sun: 8:00 AM – 2:00 AM | Fri–Sat: 8:00 AM – 4:00 AM',
    hoursEs: 'Lun–Mié: 8:00 AM – 1:00 AM | Jue y Dom: 8:00 AM – 2:00 AM | Vie–Sáb: 8:00 AM – 4:00 AM',
    weeklySchedule: buildSchedule({
      0: W_8AM_2AM, 1: W_8AM_1AM, 2: W_8AM_1AM, 3: W_8AM_1AM, 4: W_8AM_2AM, 5: W_8AM_4AM, 6: W_8AM_4AM,
    }),
  },
  {
    id: 12,
    cityTitle: 'Norwalk',
    crossStreets: 'Rosecrans & Studebaker',
    name: 'Norwalk Rosecrans & Studebaker',
    streetAddress: '10968 Rosecrans Ave',
    address: '10968 Rosecrans Ave, Norwalk, CA 90650',
    city: 'Norwalk',
    state: 'CA',
    zipCode: '90650',
    phone: '(562) 651-0045',
    latitude: 33.90181,
    longitude: -118.100403,
    toastOrderingUrl: 'https://order.online/store/tacos-gavilan-norwalk-1327857',
    hoursEn: 'Sun–Thu: 10:00 AM – 1:00 AM | Fri–Sat: 10:00 AM – 3:00 AM',
    hoursEs: 'Dom–Jue: 10:00 AM – 1:00 AM | Vie–Sáb: 10:00 AM – 3:00 AM',
    weeklySchedule: buildSchedule({
      0: W_10AM_1AM, 1: W_10AM_1AM, 2: W_10AM_1AM, 3: W_10AM_1AM, 4: W_10AM_1AM, 5: W_10AM_3AM, 6: W_10AM_3AM,
    }),
  },
  {
    id: 7,
    cityTitle: 'Los Angeles',
    crossStreets: 'Slauson & Broadway',
    name: 'Los Angeles Slauson & Broadway',
    streetAddress: '5833 S. Broadway',
    address: '5833 S. Broadway, Los Angeles, CA 90003',
    city: 'Los Angeles',
    state: 'CA',
    zipCode: '90003',
    phone: '(323) 615-0084',
    latitude: 33.98894,
    longitude: -118.278609,
    toastOrderingUrl: 'https://order.online/store/tacos-gavilan-slauson-broadway-23989119',
    hoursEn: 'Sun–Thu: 10:00 AM – 1:00 AM | Fri–Sat: 10:00 AM – 3:00 AM',
    hoursEs: 'Dom–Jue: 10:00 AM – 1:00 AM | Vie–Sáb: 10:00 AM – 3:00 AM',
    weeklySchedule: buildSchedule({
      0: W_10AM_1AM, 1: W_10AM_1AM, 2: W_10AM_1AM, 3: W_10AM_1AM, 4: W_10AM_1AM, 5: W_10AM_3AM, 6: W_10AM_3AM,
    }),
  },
  {
    id: 1,
    cityTitle: 'Rialto',
    crossStreets: 'Baseline & Riverside',
    name: 'Rialto Baseline & Riverside',
    streetAddress: '115 E. Baseline Rd',
    address: '115 E. Baseline Rd, Rialto, CA 92376',
    city: 'Rialto',
    state: 'CA',
    zipCode: '92376',
    phone: '(909) 562-0430',
    latitude: 34.1211,
    longitude: -117.370048,
    toastOrderingUrl: 'https://order.online/store/tacos-gavilan-rialto-841931',
    hoursEn: 'Sun–Thu: 10:00 AM – 12:00 AM | Fri–Sat: 10:00 AM – 2:00 AM',
    hoursEs: 'Dom–Jue: 10:00 AM – 12:00 AM | Vie–Sáb: 10:00 AM – 2:00 AM',
    weeklySchedule: buildSchedule({
      0: W_10AM_12AM, 1: W_10AM_12AM, 2: W_10AM_12AM, 3: W_10AM_12AM, 4: W_10AM_12AM, 5: W_10AM_2AM, 6: W_10AM_2AM,
    }),
  },
  {
    id: 3,
    cityTitle: 'West Covina',
    crossStreets: '10 FWY & Azusa',
    name: 'West Covina 10 FWY & Azusa',
    streetAddress: '101 S. Azusa Ave',
    address: '101 S. Azusa Ave, West Covina, CA 91791',
    city: 'West Covina',
    state: 'CA',
    zipCode: '91791',
    phone: '(626) 917-2662',
    latitude: 34.070966,
    longitude: -117.90815,
    toastOrderingUrl: 'https://order.online/store/tacos-gavilan-west-covina-725035',
    hoursEn: 'Sun–Thu: 10:00 AM – 1:00 AM | Fri–Sat: 10:00 AM – 3:00 AM',
    hoursEs: 'Dom–Jue: 10:00 AM – 1:00 AM | Vie–Sáb: 10:00 AM – 3:00 AM',
    weeklySchedule: buildSchedule({
      0: W_10AM_1AM, 1: W_10AM_1AM, 2: W_10AM_1AM, 3: W_10AM_1AM, 4: W_10AM_1AM, 5: W_10AM_3AM, 6: W_10AM_3AM,
    }),
  },
  {
    id: 15,
    cityTitle: 'South Gate',
    crossStreets: 'Firestone & Garfield',
    name: 'South Gate Firestone & Garfield',
    streetAddress: '5800 Firestone Blvd',
    address: '5800 Firestone Blvd, South Gate, CA 90280',
    city: 'South Gate',
    state: 'CA',
    zipCode: '90280',
    phone: '(562) 806-1200',
    latitude: 33.948795,
    longitude: -118.164767,
    toastOrderingUrl: 'https://order.online/store/tacos-gavilan-south-gate-846517',
    hoursEn: 'Sun–Thu: 10:00 AM – 12:00 AM | Fri–Sat: 10:00 AM – 3:00 AM',
    hoursEs: 'Dom–Jue: 10:00 AM – 12:00 AM | Vie–Sáb: 10:00 AM – 3:00 AM',
    weeklySchedule: buildSchedule({
      0: W_10AM_12AM, 1: W_10AM_12AM, 2: W_10AM_12AM, 3: W_10AM_12AM, 4: W_10AM_12AM, 5: W_10AM_3AM, 6: W_10AM_3AM,
    }),
  },
  {
    id: 16,
    cityTitle: 'Downey',
    crossStreets: 'Florence & Paramount',
    name: 'Downey Florence & Paramount',
    streetAddress: '7947 E. Florence Ave',
    address: '7947 E. Florence Ave, Downey, CA 90240',
    city: 'Downey',
    state: 'CA',
    zipCode: '90240',
    phone: '(562) 927-7486',
    latitude: 33.953703,
    longitude: -118.130299,
    toastOrderingUrl: 'https://order.online/store/tacos-gavilan-downey-302620',
    hoursEn: 'Sun–Thu: 10:00 AM – 12:00 AM | Fri–Sat: 10:00 AM – 3:00 AM',
    hoursEs: 'Dom–Jue: 10:00 AM – 12:00 AM | Vie–Sáb: 10:00 AM – 3:00 AM',
    weeklySchedule: buildSchedule({
      0: W_10AM_12AM, 1: W_10AM_12AM, 2: W_10AM_12AM, 3: W_10AM_12AM, 4: W_10AM_12AM, 5: W_10AM_3AM, 6: W_10AM_3AM,
    }),
  },
  {
    id: 8,
    cityTitle: 'Hollywood',
    crossStreets: 'Sunset & La Brea',
    name: 'Hollywood Sunset & La Brea',
    streetAddress: '7070 Sunset Blvd',
    address: '7070 Sunset Blvd, Los Angeles, CA 90028',
    city: 'Los Angeles',
    state: 'CA',
    zipCode: '90028',
    phone: '(323) 963-7993',
    latitude: 34.097757,
    longitude: -118.34389,
    toastOrderingUrl: 'https://order.online/store/tacos-gavilan-los-angeles-551916',
    hoursEn: 'Sun–Thu: 9:00 AM – 12:00 AM | Fri–Sat: 9:00 AM – 3:00 AM',
    hoursEs: 'Dom–Jue: 9:00 AM – 12:00 AM | Vie–Sáb: 9:00 AM – 3:00 AM',
    weeklySchedule: buildSchedule({
      0: W_9AM_12AM, 1: W_9AM_12AM, 2: W_9AM_12AM, 3: W_9AM_12AM, 4: W_9AM_12AM, 5: W_9AM_3AM, 6: W_9AM_3AM,
    }),
  },
  {
    id: 9,
    cityTitle: 'Santa Ana',
    crossStreets: '17th & Grand',
    name: 'Santa Ana 17th & Grand',
    streetAddress: '1258 E. 17th St',
    address: '1258 E. 17th St, Santa Ana, CA 92701',
    city: 'Santa Ana',
    state: 'CA',
    zipCode: '92701',
    phone: '(714) 480-0713',
    latitude: 33.759621,
    longitude: -117.852252,
    toastOrderingUrl: 'https://order.online/store/tacos-gavilan-santa-ana-724574',
    hoursEn: 'Sun–Thu: 10:00 AM – 12:00 AM | Fri–Sat: 10:00 AM – 2:00 AM',
    hoursEs: 'Dom–Jue: 10:00 AM – 12:00 AM | Vie–Sáb: 10:00 AM – 2:00 AM',
    weeklySchedule: buildSchedule({
      0: W_10AM_12AM, 1: W_10AM_12AM, 2: W_10AM_12AM, 3: W_10AM_12AM, 4: W_10AM_12AM, 5: W_10AM_2AM, 6: W_10AM_2AM,
    }),
  },
  {
    id: 11,
    cityTitle: 'Huntington Park',
    crossStreets: 'Florence & Santa Fe',
    name: 'Huntington Park Florence & Santa Fe',
    streetAddress: '2425 E. Florence Ave',
    address: '2425 E. Florence Ave, Huntington Park, CA 90255',
    city: 'Huntington Park',
    state: 'CA',
    zipCode: '90255',
    phone: '(323) 581-7309',
    latitude: 33.975055,
    longitude: -118.229235,
    toastOrderingUrl: 'https://order.online/store/tacos-gavilan-huntington-park-260849',
    hoursEn: 'Sun–Wed: 10:00 AM – 12:00 AM | Thu: 10:00 AM – 2:00 AM | Fri–Sat: 10:00 AM – 3:00 AM',
    hoursEs: 'Dom–Mié: 10:00 AM – 12:00 AM | Jue: 10:00 AM – 2:00 AM | Vie–Sáb: 10:00 AM – 3:00 AM',
    weeklySchedule: buildSchedule({
      0: W_10AM_12AM, 1: W_10AM_12AM, 2: W_10AM_12AM, 3: W_10AM_12AM, 4: W_10AM_2AM, 5: W_10AM_3AM, 6: W_10AM_3AM,
    }),
  },
  {
    id: 10,
    cityTitle: 'La Puente',
    crossStreets: '605 FWY & Valley',
    name: 'La Puente 605 FWY & Valley',
    streetAddress: '13009 Valley Blvd',
    address: '13009 Valley Blvd, La Puente, CA 91746',
    city: 'La Puente',
    state: 'CA',
    zipCode: '91746',
    phone: '(626) 336-3000',
    latitude: 34.053251,
    longitude: -118.001777,
    toastOrderingUrl: 'https://order.online/store/tacos-gavilan-la-puente-963464',
    hoursEn: 'Sun–Thu: 10:00 AM – 12:00 AM | Fri–Sat: 10:00 AM – 2:00 AM',
    hoursEs: 'Dom–Jue: 10:00 AM – 12:00 AM | Vie–Sáb: 10:00 AM – 2:00 AM',
    weeklySchedule: buildSchedule({
      0: W_10AM_12AM, 1: W_10AM_12AM, 2: W_10AM_12AM, 3: W_10AM_12AM, 4: W_10AM_12AM, 5: W_10AM_2AM, 6: W_10AM_2AM,
    }),
  },
  {
    id: 4,
    cityTitle: 'Azusa',
    crossStreets: 'Azusa & Arrow',
    name: 'Azusa Azusa & Arrow',
    streetAddress: '887 S. Azusa Ave',
    address: '887 S. Azusa Ave, Azusa, CA 91702',
    city: 'Azusa',
    state: 'CA',
    zipCode: '91702',
    phone: '(626) 969-1011',
    latitude: 34.107074,
    longitude: -117.908194,
    toastOrderingUrl: 'https://order.online/store/tacos-gavilan-azusa-718169',
    hoursEn: 'Sun–Thu: 10:00 AM – 11:00 PM | Fri–Sat: 10:00 AM – 12:00 AM',
    hoursEs: 'Dom–Jue: 10:00 AM – 11:00 PM | Vie–Sáb: 10:00 AM – 12:00 AM',
    weeklySchedule: buildSchedule({
      0: W_10AM_11PM, 1: W_10AM_11PM, 2: W_10AM_11PM, 3: W_10AM_11PM, 4: W_10AM_11PM, 5: W_10AM_12AM, 6: W_10AM_12AM,
    }),
  },
  {
    id: 13,
    cityTitle: 'Bell',
    crossStreets: 'Florence & Atlantic',
    name: 'Bell Florence & Atlantic',
    streetAddress: '4406 E Florence Ave',
    address: '4406 E Florence Ave, Bell, CA 90201',
    city: 'Bell',
    state: 'CA',
    zipCode: '90201',
    phone: '(323) 771-1722',
    latitude: 33.970395,
    longitude: -118.188871,
    toastOrderingUrl: 'https://order.online/store/tacos-gavilan-bell-260912',
    hoursEn: 'Sun–Thu: 10:00 AM – 12:00 AM | Fri–Sat: 10:00 AM – 2:00 AM',
    hoursEs: 'Dom–Jue: 10:00 AM – 12:00 AM | Vie–Sáb: 10:00 AM – 2:00 AM',
    weeklySchedule: buildSchedule({
      0: W_10AM_12AM, 1: W_10AM_12AM, 2: W_10AM_12AM, 3: W_10AM_12AM, 4: W_10AM_12AM, 5: W_10AM_2AM, 6: W_10AM_2AM,
    }),
  },
]

const WEEKDAY_SHORT_MAP: Record<string, DayOfWeekIndex> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}


/**
 * Normaliza un número de teléfono estadounidense a 10 dígitos limpios.
 */
export function normalizeUsPhone10(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.slice(1)
  }
  return digits.slice(0, 10)
}

/**
 * Formatea un teléfono de EE. UU. mientras el usuario escribe.
 */
export function formatUsPhoneInput(raw: string): string {
  const d = normalizeUsPhone10(raw)
  if (d.length === 0) return ''
  if (d.length <= 3) return `(${d}`
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 10)}`
}

/**
 * Formatea el teléfono de visualización estándar `(xxx) xxx-xxxx` cuando tiene 10 dígitos.
 */
export function formatUsPhoneDisplay(raw: string): string {
  const d = normalizeUsPhone10(raw)
  if (d.length !== 10) return raw.trim()
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 10)}`
}

/**
 * Calcula si una sucursal se encuentra abierta en tiempo real en America/Los_Angeles.
 * Si la hora decimal está entre 00:00 y 04:59 y el turno nocturno previo sigue abierto,
 * reporta correctamente la etiqueta de horario de `prevWindow` (la jornada aún activa).
 */
export function getStoreStatusInLA(
  store: V2AuthoritativeStore,
  lang: 'es' | 'en',
  now: Date = new Date()
): {
  isOpen: boolean
  badgeText: string
  todayHours: string
} {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  })
  const parts = formatter.formatToParts(now)
  const weekdayStr = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun'
  const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '12'
  const minuteStr = parts.find((p) => p.type === 'minute')?.value ?? '0'
  const dayIndex: DayOfWeekIndex = WEEKDAY_SHORT_MAP[weekdayStr] ?? 0
  let hour = parseInt(hourStr, 10)
  if (Number.isNaN(hour) || hour === 24) hour = 0
  const decimalHour = hour + (parseInt(minuteStr, 10) || 0) / 60
  const todayWindow = store.weeklySchedule[dayIndex]

  let isOpen = false
  let displayWindow: DailyScheduleWindow = todayWindow

  if (decimalHour < 5) {
    const prevDayIndex = ((dayIndex + 6) % 7) as DayOfWeekIndex
    const prevWindow = store.weeklySchedule[prevDayIndex]
    isOpen = decimalHour + 24 < prevWindow.closeHour
    if (isOpen) {
      displayWindow = prevWindow
    }
  } else {
    isOpen = decimalHour >= todayWindow.openHour && decimalHour < todayWindow.closeHour
  }

  return {
    isOpen,
    badgeText: isOpen
      ? lang === 'en'
        ? 'Open Now'
        : 'Abierto Ahora'
      : lang === 'en'
      ? 'Closed'
      : 'Cerrado',
    todayHours: lang === 'en' ? displayWindow.labelEn : displayWindow.labelEs,
  }
}

/**
 * Saludo localizado basado en la hora real de America/Los_Angeles (normalizando medianoche 24 -> 0).
 */
export function getLaTimeGreeting(lang: 'es' | 'en', now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(now)
  let hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '12', 10)
  if (Number.isNaN(hour) || hour === 24) hour = 0
  if (hour >= 5 && hour < 12) return lang === 'en' ? 'Good morning' : 'Buenos días'
  if (hour >= 12 && hour < 18) return lang === 'en' ? 'Good afternoon' : 'Buenas tardes'
  return lang === 'en' ? 'Good evening' : 'Buenas noches'
}

/**
 * Reloj compacto de barra de estado en America/Los_Angeles (actualizado por intervalo de 60s).
 */
export function getLaStatusClock(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(now)
    .replace(/\s?(AM|PM)$/i, '')
}

/**
 * Distancia geodésica en millas entre dos coordenadas.
 */
export function calculateDistanceMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 3958.8
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

const ALLOWED_ORDER_HOSTS = [
  'order.online',
  'www.order.online',
  'tacosgavilan.com',
  'www.tacosgavilan.com',
  'checkout.stripe.com',
  'doordash.com',
  'www.doordash.com',
  'maps.google.com',
  'www.google.com',
  'maps.apple.com',
]

/**
 * Política deny-by-default para abrir enlaces externos únicamente en dominios HTTPS verificados.
 */
export function isAllowedExternalOrderUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'https:') return false
    const host = parsed.hostname.toLowerCase()
    return ALLOWED_ORDER_HOSTS.some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`)
    )
  } catch {
    return false
  }
}
