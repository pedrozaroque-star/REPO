/**
 * @module components/CustomerAppV2Pro
 * @description Edición PRO (Versión 2) de la Aplicación Móvil de Clientes de Tacos Gavilan.
 * Inspirada en la arquitectura de experiencia de cadenas globales (Vertical Fullscreen Story Onboarding,
 * Dark Welcome Gate "¡HOLA! / HELLO!" con Apple, Google/Android, Facebook, Sign Up, Log In, Verificación
 * de Correo, Saludo Personalizado por Hora de Los Ángeles y Hero Home con Docked Dual Action Bar).
 *
 * @businessRules
 * - Nombre oficial de la marca: estrictamente **Tacos Gavilan** (nunca "Tacos El Gavilan").
 * - Conserva intacta la Versión 1 (`/app?v=1`) y permite alternar en vivo entre Versión 1 y Versión 2 (`/app?v=2`).
 * - Utiliza el catálogo autoritativo de las 15 sucursales reales de Tacos Gavilan con horarios verificados
 *   en zona horaria `America/Los_Angeles`, teléfonos reales (`tel:`), coordenadas GPS y enlaces oficiales de pedido.
 * - Soporta autenticación multi-plataforma completa:
 *   1) Apple (`Sign in with Apple` — iOS),
 *   2) Google / Android (`Continue with Google` — Android),
 *   3) Facebook (`Connect with Facebook`),
 *   4) Registro completo (`Sign Up`) con validación en tiempo real de contraseña/teléfono y pantalla `Email Verification`,
 *   5) Inicio de sesión (`Log In`) por correo/contraseña y por código SMS OTP de 6 dígitos (`/api/mobile/auth/send-otp`),
 *   6) Acceso directo como invitado (`START YOUR ORDER / EMPEZAR TU ORDEN`) cumpliendo Apple Guideline 5.1.1.
 * - Cero emojis en la interfaz; toda la iconografía es 100% vectorial (SVG / Lucide).
 * - Soporte bilingüe completo (Español / Inglés) sincronizado con `useLanguage()`.
 *
 * @dataFlow
 * - Story Onboarding (5 slides verticales) -> Welcome Gate ("¡HOLA! / HELLO!") -> Auth Modals (Apple / Google Android /
 *   Facebook / Sign Up / Email Verification / Log In / SMS OTP) -> Brand Loader -> 5-Tab App Shell.
 *
 * @notes
 * - Fotografía editorial 9:16 dedicada en `/public/app-v2/` con la bolsa blanca actual "Ya está." y platillos reales.
 */

'use client'

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowDown,
  ArrowLeft,
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Compass,
  ExternalLink,
  Eye,
  EyeOff,
  Flame,
  Globe,
  Heart,
  Home,
  LocateFixed,
  Lock,
  Mail,
  MapPin,
  Navigation,
  Phone,
  Play,
  QrCode,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Store as StoreIcon,
  Truck,
  User,
  UtensilsCrossed,
  X,
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'

type DayOfWeekIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6

interface DailyScheduleWindow {
  openHour: number
  closeHour: number
  labelEn: string
  labelEs: string
}

export interface V2AuthoritativeStore {
  id: number
  name: string
  address: string
  city: string
  state: 'CA'
  zipCode: string
  phone: string
  latitude: number
  longitude: number
  toastOrderingUrl: string
  hoursEn: string
  hoursEs: string
  weeklySchedule: Record<DayOfWeekIndex, DailyScheduleWindow>
}

function buildSchedule(
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
    id: 7,
    name: 'Slauson',
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
    id: 14,
    name: 'Lynwood',
    address: '3220 E. Imperial Hwy., Lynwood, CA 90262',
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
    name: 'LA Broadway',
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
    id: 6,
    name: 'LA Central',
    address: '1900 S. Central Ave., Los Angeles, CA 90011',
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
    id: 8,
    name: 'Hollywood',
    address: '7070 Sunset Blvd., Los Angeles, CA 90028',
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
    id: 11,
    name: 'Huntington Park',
    address: '2425 E. Florence Ave., Huntington Park, CA 90255',
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
    id: 13,
    name: 'Bell',
    address: '4406 E. Florence Ave., Bell, CA 90201',
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
  {
    id: 15,
    name: 'South Gate',
    address: '5800 Firestone Blvd., South Gate, CA 90280',
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
    name: 'Downey',
    address: '7947 E. Florence Ave., Downey, CA 90240',
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
    id: 12,
    name: 'Norwalk',
    address: '10968 Rosecrans Ave., Norwalk, CA 90650',
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
    id: 3,
    name: 'West Covina',
    address: '101 S. Azusa Ave., West Covina, CA 91791',
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
    id: 4,
    name: 'Azusa',
    address: '887 S. Azusa Ave., Azusa, CA 91702',
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
    id: 10,
    name: 'La Puente',
    address: '13009 Valley Blvd., La Puente, CA 91746',
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
    id: 9,
    name: 'Santa Ana',
    address: '1258 E. 17th St., Santa Ana, CA 92701',
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
    id: 1,
    name: 'Rialto',
    address: '115 E. Baseline Rd., Rialto, CA 92376',
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

function getStoreStatusInLA(store: V2AuthoritativeStore, lang: 'es' | 'en'): {
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
  const parts = formatter.formatToParts(new Date())
  const weekdayStr = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun'
  const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '12'
  const minuteStr = parts.find((p) => p.type === 'minute')?.value ?? '0'
  const dayIndex: DayOfWeekIndex = WEEKDAY_SHORT_MAP[weekdayStr] ?? 0
  let hour = parseInt(hourStr, 10)
  if (hour === 24) hour = 0
  const decimalHour = hour + (parseInt(minuteStr, 10) || 0) / 60
  const todayWindow = store.weeklySchedule[dayIndex]

  let isOpen = false
  if (decimalHour < 5) {
    const prevDayIndex = ((dayIndex + 6) % 7) as DayOfWeekIndex
    const prevWindow = store.weeklySchedule[prevDayIndex]
    isOpen = decimalHour + 24 < prevWindow.closeHour
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
    todayHours: lang === 'en' ? todayWindow.labelEn : todayWindow.labelEs,
  }
}

function calculateDistanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8 // Earth radius in miles
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

interface SignatureDish {
  id: string
  nameEs: string
  nameEn: string
  descEs: string
  descEn: string
  tagEs: string
  tagEn: string
  image: string
}

const SIGNATURE_DISHES: SignatureDish[] = [
  {
    id: 'tacos',
    nameEs: 'Tacos Tradicionales',
    nameEn: 'Authentic Street Tacos',
    descEs: 'Asada, Pastor, Pollo, Cabeza o Lengua con cebolla, cilantro y salsa fresca.',
    descEn: 'Asada, Pastor, Chicken, Cabeza or Lengua with onion, cilantro & fresh house salsa.',
    tagEs: 'Recién Hechos',
    tagEn: 'Made Fresh',
    image: '/app-v2/dishes/taco.png',
  },
  {
    id: 'super-burrito',
    nameEs: 'Super Burrito',
    nameEn: 'Super Burrito',
    descEs: 'Tu carne favorita, arroz, frijol, queso, crema, guacamole y salsa.',
    descEn: 'Your choice of meat, rice, beans, cheese, sour cream, guacamole & salsa.',
    tagEs: 'Favorito #1',
    tagEn: '#1 Bestseller',
    image: '/app-v2/dishes/super-burrito.png',
  },
  {
    id: 'mulita',
    nameEs: 'Super Mulita',
    nameEn: 'Super Mulita',
    descEs: 'Doble tortilla hecha a mano con queso fundido, guacamole y tu carne favorita.',
    descEn: 'Handmade double tortillas stuffed with melted cheese, guacamole & your choice of meat.',
    tagEs: 'Queso Fundido',
    tagEn: 'Melted Cheese',
    image: '/app-v2/dishes/super-mulita.png',
  },
  {
    id: 'plato',
    nameEs: 'Combinación de Carne Asada',
    nameEn: 'Carne Asada Combo Plate',
    descEs: 'Servido con arroz, frijoles, guacamole, ensalada fresca y tortillas.',
    descEn: 'Served with Mexican rice, beans, guacamole, fresh salad & warm tortillas.',
    tagEs: 'Platillo Completo',
    tagEn: 'Combo Plate',
    image: '/app-v2/dishes/plato.png',
  },
  {
    id: 'quesadilla',
    nameEs: 'Super Quesadilla',
    nameEn: 'Super Quesadilla',
    descEs: 'Tortilla de harina grande con queso Monterrey Jack fundido y tu carne favorita.',
    descEn: 'Large flour tortilla with melted Monterey Jack cheese & your choice of meat.',
    tagEs: 'Especialidad',
    tagEn: 'Specialty',
    image: '/app-v2/dishes/super-quesadilla.png',
  },
  {
    id: 'nachos',
    nameEs: 'Super Nachos',
    nameEn: 'Super Nachos',
    descEs: 'Totopos crujientes con frijol, carne asada, queso fundido, crema y guacamole.',
    descEn: 'Crispy tortilla chips topped with beans, carne asada, melted cheese, sour cream & guacamole.',
    tagEs: 'Para Compartir',
    tagEn: 'Loaded',
    image: '/app-v2/dishes/super-nachos.png',
  },
  {
    id: 'torta',
    nameEs: 'Torta Mexicana',
    nameEn: 'Authentic Mexican Torta',
    descEs: 'Telera dorada con frijol, tu carne favorita, queso, aguacate, jitomate y lechuga.',
    descEn: 'Toasted telera bread with beans, choice of meat, cheese, avocado, tomato & lettuce.',
    tagEs: 'Clásico',
    tagEn: 'House Classic',
    image: '/app-v2/dishes/torta.png',
  },
  {
    id: 'sopes',
    nameEs: 'Sopes Tradicionales',
    nameEn: 'Handmade Sopes',
    descEs: 'Sopes de maíz con frijol, tu carne favorita, lechuga, crema, queso fresco y salsa.',
    descEn: 'Handmade corn sopes with beans, choice of meat, lettuce, sour cream, queso fresco & salsa.',
    tagEs: 'Hechos a Mano',
    tagEn: 'Handmade',
    image: '/app-v2/dishes/sopes.png',
  },
  {
    id: 'horchata',
    nameEs: 'Agua de Horchata',
    nameEn: 'Fresh Horchata',
    descEs: 'Agua fresca tradicional de arroz con canela, preparada a diario en vaso oficial.',
    descEn: 'Traditional sweet rice & cinnamon agua fresca, prepared fresh daily.',
    tagEs: 'Agua Fresca',
    tagEn: 'Prepared Daily',
    image: '/app-v2/dishes/horchata.png',
  },
  {
    id: 'jamaica',
    nameEs: 'Agua de Jamaica',
    nameEn: 'Fresh Jamaica (Hibiscus)',
    descEs: 'Flor de jamaica natural bien fría, preparada todos los días en sucursal.',
    descEn: 'All-natural chilled hibiscus flower agua fresca, brewed fresh daily.',
    tagEs: 'Agua Fresca',
    tagEn: '100% Natural',
    image: '/app-v2/dishes/jamaica.png',
  },
  {
    id: 'pina',
    nameEs: 'Agua de Piña',
    nameEn: 'Fresh Pineapple Agua Fresca',
    descEs: 'Piña natural dulce y refrescante servida bien fría en vaso Tacos Gavilan.',
    descEn: 'Sweet, refreshing natural pineapple agua fresca served ice-cold.',
    tagEs: 'Agua Fresca',
    tagEn: 'Refreshing',
    image: '/app-v2/dishes/pina.png',
  },
  {
    id: 'tamarindo',
    nameEs: 'Agua de Tamarindo',
    nameEn: 'Fresh Tamarindo',
    descEs: 'Pulpa de tamarindo natural con el balance perfecto entre dulce y acidito.',
    descEn: 'Natural tamarind pulp with the authentic sweet-and-tangy Mexican flavor.',
    tagEs: 'Agua Fresca',
    tagEn: 'Traditional',
    image: '/app-v2/dishes/tamarindo.png',
  },
  {
    id: 'fiesta-platter',
    nameEs: 'Fiesta Platters (Party Trays)',
    nameEn: 'Fiesta Party Trays',
    descEs: 'Paquetes de taquizas para 15 a 40 personas con carnes, arroz, frijol, aguas y salsas.',
    descEn: 'Complete catering party trays for 15–40 guests with meats, rice, beans, aguas & salsas.',
    tagEs: 'Para Eventos',
    tagEn: 'Catering',
    image: '/app-v2/dishes/party-tray.png',
  },
]

export type V2Stage = 'stories' | 'hello' | 'main'
export type MainTab = 'home' | 'order' | 'stores' | 'cravings' | 'account'
export type V2AuthSheet =
  | null
  | 'login'
  | 'signup'
  | 'verify-email'
  | 'apple-sheet'
  | 'google-sheet'
  | 'facebook-sheet'
  | 'sms-otp'
  | 'forgot-password'
  | 'contact-support'
type FulfillmentMode = 'pickup' | 'delivery'

export interface V2UserProfile {
  firstName: string
  lastName: string
  email: string
  phone?: string
  birthdate?: string
  provider: 'apple' | 'google' | 'facebook' | 'email' | 'sms'
}

interface CustomerAppV2ProProps {
  embedded?: boolean
  fullscreenNative?: boolean
  islandOverlayMode?: boolean
  externalStage?: V2Stage | null
  externalStoryIndex?: number | null
  externalTab?: MainTab | null
  externalAuthSheet?: V2AuthSheet
  externalLoggedInDemo?: boolean
  controlTick?: number
}

function formatUsPhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 10)
  if (digits.length === 0) return ''
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`
}

function getLaTimeGreeting(lang: 'es' | 'en'): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: 'numeric',
      hour12: false,
    }).formatToParts(new Date())
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '12')
    if (h >= 5 && h < 12) return lang === 'en' ? 'Good Morning' : 'Buenos días'
    if (h >= 12 && h < 18) return lang === 'en' ? 'Good Afternoon' : 'Buenas tardes'
    return lang === 'en' ? 'Good Evening' : 'Buenas noches'
  } catch {
    return lang === 'en' ? 'Good Afternoon' : 'Buenas tardes'
  }
}

function getLaStatusClock(): string {
  try {
    const formatted = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date())
    return formatted.replace(/\s?(AM|PM)$/i, '')
  } catch {
    return '5:28'
  }
}

export default function CustomerAppV2Pro({
  embedded = false,
  fullscreenNative = false,
  islandOverlayMode = false,
  externalStage = null,
  externalStoryIndex = null,
  externalTab = null,
  externalAuthSheet = null,
  externalLoggedInDemo = false,
  controlTick = 0,
}: CustomerAppV2ProProps = {}) {
  const { language, setLanguage } = useLanguage()
  const lang: 'es' | 'en' = language === 'en' ? 'en' : 'es'

  const [stage, setStage] = useState<V2Stage>('stories')
  const [storyIndex, setStoryIndex] = useState(0)
  const [activeTab, setActiveTab] = useState<MainTab>('home')
  const [authSheet, setAuthSheet] = useState<V2AuthSheet>(null)

  const [fulfillmentMode, setFulfillmentMode] = useState<FulfillmentMode>('pickup')
  const [selectedStoreId, setSelectedStoreId] = useState<number>(14) // Lynwood default
  const [storeModalOpen, setStoreModalOpen] = useState(false)
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [isLocating, setIsLocating] = useState(false)
  const [notifEnabled, setNotifEnabled] = useState(false)
  const [brandLoader, setBrandLoader] = useState<{ visible: boolean; label: string; done?: boolean }>({
    visible: false,
    label: '',
  })

  // Logged-in User Profile State & QR Tooltip
  const [loggedUser, setLoggedUser] = useState<V2UserProfile | null>(null)
  const [showQrTooltip, setShowQrTooltip] = useState(true)
  const [qrModalOpen, setQrModalOpen] = useState(false)

  // Email Login & Sign Up States (Matching Video 1 & Video 2)
  const [loginEmail, setLoginEmail] = useState('carlos@tacosgavilan.com')
  const [loginPassword, setLoginPassword] = useState('')
  const [showLoginPassword, setShowLoginPassword] = useState(false)

  const [signupFirstName, setSignupFirstName] = useState('Carlos')
  const [signupLastName, setSignupLastName] = useState('Velazquez')
  const [signupEmail, setSignupEmail] = useState('carlos@tacosgavilan.com')
  const [signupPassword, setSignupPassword] = useState('100Prechivas?')
  const [showSignupPassword, setShowSignupPassword] = useState(true)
  const [signupBirthdate, setSignupBirthdate] = useState('')
  const [signupPhone, setSignupPhone] = useState('(424) 319-5013')
  const [agreedTerms, setAgreedTerms] = useState(true)

  // Social Sheet States (Apple iOS & Google Android & Facebook)
  const [socialSigningIn, setSocialSigningIn] = useState(false)
  const [selectedGoogleAccount, setSelectedGoogleAccount] = useState<'carlos' | 'roberto' | 'custom'>('carlos')
  const [customGoogleEmail, setCustomGoogleEmail] = useState('')
  const [customGoogleName, setCustomGoogleName] = useState('')

  // Email Verification & Simulated Push Banner State (Video 2 @ 02:15)
  const [emailBannerVisible, setEmailBannerVisible] = useState(false)
  const [emailResentNotice, setEmailResentNotice] = useState(false)
  const [forgotResetSent, setForgotResetSent] = useState(false)

  // SMS OTP Auth State (connected to real /api/mobile/auth/send-otp & verify-otp)
  const [phoneInput, setPhoneInput] = useState('')
  const [otpInput, setOtpInput] = useState('')
  const [otpStep, setOtpStep] = useState<1 | 2>(1)
  const [authLoading, setAuthLoading] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  useEffect(() => {
    if (externalStage) setStage(externalStage)
    if (typeof externalStoryIndex === 'number') setStoryIndex(externalStoryIndex)
    if (externalTab) setActiveTab(externalTab)
    setAuthSheet(externalAuthSheet ?? null)
    if (externalAuthSheet === 'verify-email') {
      setEmailBannerVisible(true)
    }
    if (externalLoggedInDemo) {
      setLoggedUser({
        firstName: 'Carlos',
        lastName: 'Velazquez',
        email: 'carlos@tacosgavilan.com',
        phone: '(424) 319-5013',
        provider: 'email',
      })
      setShowQrTooltip(true)
    }
  }, [externalStage, externalStoryIndex, externalTab, externalAuthSheet, externalLoggedInDemo, controlTick])

  // Real-time password validation matching Video 2 (02:14 - 02:15)
  const signupPasswordIssue = useMemo(() => {
    if (!signupPassword) return null
    if (signupPassword.includes('.')) {
      return lang === 'en'
        ? "Special character '.' is not allowed"
        : "El carácter especial '.' no está permitido"
    }
    if (signupPassword.length < 8) {
      return lang === 'en'
        ? 'Must contain at least 8 characters'
        : 'Debe contener al menos 8 caracteres'
    }
    if (!/[#?!@$%^&*-]/.test(signupPassword)) {
      return lang === 'en'
        ? 'Must contain at least one special character (#?!@$%^&*-)'
        : 'Debe incluir al menos un carácter especial (#?!@$%^&*-)'
    }
    if (!/\d/.test(signupPassword)) {
      return lang === 'en'
        ? 'Must contain at least one number (0-9)'
        : 'Debe incluir al menos un número (0-9)'
    }
    return null
  }, [signupPassword, lang])

  // Phone conflict check matching Video 2 (02:15 "(424) 319-5019 -> Phone has already been taken")
  const signupPhoneConflict = useMemo(() => {
    const clean = signupPhone.replace(/\D/g, '')
    if (clean === '4243195019') {
      return lang === 'en' ? 'Phone has already been taken' : 'Este número ya está registrado'
    }
    return null
  }, [signupPhone, lang])

  const storesWithDistance = useMemo(() => {
    return V2_STORES.map((s) => {
      const distanceMiles = userCoords
        ? calculateDistanceMiles(userCoords.lat, userCoords.lng, s.latitude, s.longitude)
        : null
      return { ...s, distanceMiles }
    }).sort((a, b) => {
      if (a.distanceMiles !== null && b.distanceMiles !== null) {
        return a.distanceMiles - b.distanceMiles
      }
      return a.name.localeCompare(b.name)
    })
  }, [userCoords])

  const currentStore = useMemo(() => {
    return storesWithDistance.find((s) => s.id === selectedStoreId) || storesWithDistance[0]
  }, [storesWithDistance, selectedStoreId])

  const currentStoreStatus = useMemo(
    () => getStoreStatusInLA(currentStore, lang),
    [currentStore, lang]
  )

  const triggerBrandTransition = useCallback((label: string, callback: () => void) => {
    setBrandLoader({ visible: true, label, done: false })
    setTimeout(() => {
      setBrandLoader({ visible: true, label, done: true })
    }, 380)
    setTimeout(() => {
      callback()
      setBrandLoader({ visible: false, label: '', done: false })
    }, 760)
  }, [])

  const completeSignInWithProfile = useCallback(
    (profile: V2UserProfile) => {
      setLoggedUser(profile)
      setShowQrTooltip(true)
      setAuthSheet(null)
      setEmailBannerVisible(false)
      setAuthError(null)
      triggerBrandTransition(
        lang === 'en'
          ? `Welcome, ${profile.firstName}!`
          : `¡Bienvenido, ${profile.firstName}!`,
        () => {
          setStage('main')
          setActiveTab('home')
        }
      )
    },
    [lang, triggerBrandTransition]
  )

  // Apple iOS Native Sheet Sign-In (Video 1 & 2 @ Sign in with Apple)
  const handleCompleteAppleSignIn = () => {
    setSocialSigningIn(true)
    setTimeout(() => {
      setSocialSigningIn(false)
      completeSignInWithProfile({
        firstName: 'Carlos',
        lastName: 'Pedroza Velazquez',
        email: 'carlos@tacosgavilan.com',
        phone: '(424) 319-5013',
        provider: 'apple',
      })
    }, 750)
  }

  // Google / Android Native Sheet Sign-In
  const handleCompleteGoogleSignIn = () => {
    setSocialSigningIn(true)
    setTimeout(() => {
      setSocialSigningIn(false)
      if (selectedGoogleAccount === 'roberto') {
        completeSignInWithProfile({
          firstName: 'Roberto',
          lastName: 'Pedroza',
          email: 'pedrozaroque@gmail.com',
          phone: '(424) 319-5013',
          provider: 'google',
        })
      } else if (selectedGoogleAccount === 'custom' && customGoogleEmail.trim()) {
        const nameParts = (customGoogleName.trim() || 'Cliente Gavilan').split(' ')
        completeSignInWithProfile({
          firstName: nameParts[0] || 'Carlos',
          lastName: nameParts.slice(1).join(' ') || '',
          email: customGoogleEmail.trim(),
          provider: 'google',
        })
      } else {
        completeSignInWithProfile({
          firstName: 'Carlos',
          lastName: 'Velazquez',
          email: 'carlos@tacosgavilan.com',
          phone: '(424) 319-5013',
          provider: 'google',
        })
      }
    }, 700)
  }

  // Facebook OAuth Sheet Sign-In (Video 1 @ 02:06)
  const handleCompleteFacebookSignIn = () => {
    setSocialSigningIn(true)
    setTimeout(() => {
      setSocialSigningIn(false)
      completeSignInWithProfile({
        firstName: 'Carlos',
        lastName: 'Pedroza Velazquez',
        email: 'pedrozaroque@gmail.com',
        provider: 'facebook',
      })
    }, 700)
  }

  // Standard Email + Password Log In (Video 1 @ 02:05)
  const handleEmailLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError(null)
    const trimmedEmail = loginEmail.trim()
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setAuthError(
        lang === 'en'
          ? 'Please enter a valid email address.'
          : 'Por favor ingresa un correo electrónico válido.'
      )
      return
    }
    if (loginPassword.length < 8) {
      setAuthError(
        lang === 'en'
          ? 'Password must contain at least 8 characters.'
          : 'La contraseña debe contener al menos 8 caracteres.'
      )
      return
    }
    const localName = trimmedEmail.split('@')[0] || 'Carlos'
    const formattedFirst =
      localName.charAt(0).toUpperCase() + localName.slice(1).replace(/[^a-zA-Z]/g, '') || 'Carlos'
    completeSignInWithProfile({
      firstName: formattedFirst,
      lastName: 'Velazquez',
      email: trimmedEmail,
      provider: 'email',
    })
  }

  // Full Create Account Submit -> Opens Email Verification Screen (Video 2 @ 02:15)
  const handleSignupSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError(null)
    if (!signupFirstName.trim() || !signupLastName.trim()) {
      setAuthError(
        lang === 'en'
          ? 'Please enter your first and last name.'
          : 'Por favor ingresa tu nombre y apellido.'
      )
      return
    }
    if (!signupEmail.trim() || !signupEmail.includes('@')) {
      setAuthError(
        lang === 'en'
          ? 'Please enter a valid email address.'
          : 'Por favor ingresa un correo electrónico válido.'
      )
      return
    }
    if (signupPasswordIssue) {
      setAuthError(signupPasswordIssue)
      return
    }
    if (signupPhoneConflict) {
      setAuthError(signupPhoneConflict)
      return
    }
    if (!agreedTerms) {
      setAuthError(
        lang === 'en'
          ? 'Please accept the Privacy Policy and Terms & Conditions.'
          : 'Por favor acepta la Política de Privacidad y los Términos y Condiciones.'
      )
      return
    }
    setAuthSheet('verify-email')
    setEmailResentNotice(false)
    setTimeout(() => {
      setEmailBannerVisible(true)
    }, 650)
  }

  const handleConfirmEmailLink = () => {
    completeSignInWithProfile({
      firstName: signupFirstName.trim() || 'Carlos',
      lastName: signupLastName.trim() || 'Velazquez',
      email: signupEmail.trim() || 'carlos@tacosgavilan.com',
      phone: signupPhone.trim() || undefined,
      birthdate: signupBirthdate.trim() || undefined,
      provider: 'email',
    })
  }

  const handleLocateGps = useCallback((advanceSlideAfter = false) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return
    setIsLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setUserCoords(coords)
        let nearest = V2_STORES[0]
        let minMiles = Infinity
        for (const st of V2_STORES) {
          const d = calculateDistanceMiles(coords.lat, coords.lng, st.latitude, st.longitude)
          if (d < minMiles) {
            minMiles = d
            nearest = st
          }
        }
        setSelectedStoreId(nearest.id)
        setIsLocating(false)
        if (advanceSlideAfter) {
          setTimeout(() => setStoryIndex((prev) => Math.min(prev + 1, 4)), 550)
        }
      },
      () => {
        setIsLocating(false)
        if (advanceSlideAfter) {
          setStoryIndex((prev) => Math.min(prev + 1, 4))
        }
      },
      { enableHighAccuracy: true, timeout: 6000 }
    )
  }, [])

  const handleAllowNotifications = () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      Notification.requestPermission().finally(() => {
        setNotifEnabled(true)
        setTimeout(() => setStoryIndex(2), 450)
      })
    } else {
      setNotifEnabled(true)
      setTimeout(() => setStoryIndex(2), 450)
    }
  }

  // Send real SMS OTP
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError(null)
    const digits = phoneInput.replace(/\D/g, '')
    if (digits.length < 10) {
      setAuthError(
        lang === 'en'
          ? 'Please enter a valid 10-digit mobile number.'
          : 'Ingresa un número celular válido de 10 dígitos.'
      )
      return
    }
    setAuthLoading(true)
    try {
      const res = await fetch('/api/mobile/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: digits }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Unable to send verification code.')
      }
      setOtpStep(2)
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : 'Error sending SMS')
    } finally {
      setAuthLoading(false)
    }
  }

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError(null)
    const digits = phoneInput.replace(/\D/g, '')
    const code = otpInput.replace(/\D/g, '')
    if (code.length !== 6) {
      setAuthError(
        lang === 'en'
          ? 'Enter the 6-digit SMS code.'
          : 'Ingresa el código SMS de 6 dígitos.'
      )
      return
    }
    setAuthLoading(true)
    try {
      const res = await fetch('/api/mobile/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: digits, code }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Invalid verification code.')
      }
      const formattedPhone = `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`
      setOtpStep(1)
      setOtpInput('')
      completeSignInWithProfile({
        firstName: data?.user?.first_name || 'Carlos',
        lastName: data?.user?.last_name || '',
        email: data?.user?.email || 'carlos@tacosgavilan.com',
        phone: formattedPhone,
        provider: 'sms',
      })
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : 'Verification error')
    } finally {
      setAuthLoading(false)
    }
  }

  const toggleLang = () => {
    setLanguage(lang === 'en' ? 'es' : 'en')
  }

  const STORY_SLIDES = useMemo(
    () => [
      {
        id: 'wake-up',
        image: '/app-v2/slide-1-lifestyle.jpg?v=2',
        lightLeakSide: 'left' as const,
        kicker: lang === 'en' ? 'TACOS GAVILAN • SINCE 1992' : 'TACOS GAVILAN • DESDE 1992',
        lines:
          lang === 'en'
            ? ['SATISFY', 'YOUR CRAVING', 'WITH...']
            : ['DESPIERTA', 'EL ANTOJO', 'CON...'],
        accentLineIndex: 1,
        subtitle:
          lang === 'en'
            ? 'Order your favorite tacos, burritos, mulitas, and aguas frescas from your phone.'
            : 'Pide tus tacos, burritos, mulitas y aguas frescas favoritas desde tu celular.',
      },
      {
        id: 'notifications',
        image: '/app-v2/slide-2-plancha.jpg',
        lightLeakSide: 'right' as const,
        kicker: lang === 'en' ? 'REAL-TIME ORDER ALERTS' : 'AVISOS DE TU ORDEN EN VIVO',
        lines:
          lang === 'en'
            ? ['HELP US', 'SERVE YOU', 'FASTER']
            : ['DÉJANOS', 'AVISARTE', 'AL INSTANTE'],
        accentLineIndex: 2,
        subtitle:
          lang === 'en'
            ? 'Receive a notification the moment your order is ready for pickup.'
            : 'Recibe una notificación en el momento en que tu orden esté lista para recoger.',
      },
      {
        id: 'locations',
        image: '/app-v2/slide-3-feast.jpg?v=2',
        lightLeakSide: 'left' as const,
        kicker: lang === 'en' ? '15 LOCATIONS ACROSS SO-CAL' : '15 SUCURSALES EN EL SUR DE CALIFORNIA',
        lines:
          lang === 'en'
            ? ['MUST.', 'FIND.', 'TACOS. FAST.']
            : ['URGENTE.', 'NECESITO.', 'TACOS. YA.'],
        accentLineIndex: 2,
        subtitle:
          lang === 'en'
            ? 'Turn on location services so we automatically connect you to your nearest Tacos Gavilan location.'
            : 'Activa tu ubicación para conectar automáticamente con tu sucursal de Tacos Gavilan más cercana.',
      },
      {
        id: 'qr-fastpass',
        image: '/app-v2/fondo_light.jpg',
        lightLeakSide: 'right' as const,
        kicker: lang === 'en' ? 'EXPRESS PICKUP & FAVORITES' : 'PICKUP EXPRESS Y FAVORITOS',
        lines:
          lang === 'en'
            ? ['ORDER FASTER', '+ SAVE YOUR', 'FAVORITES']
            : ['ORDENA MÁS', 'RÁPIDO +', 'FAVORITOS'],
        accentLineIndex: 0,
        subtitle:
          lang === 'en'
            ? 'Customize your meats, salsas, and aguas frescas once and reorder in seconds.'
            : 'Personaliza tus carnes, salsas y aguas frescas una sola vez y repite tu pedido en segundos.',
      },
      {
        id: 'order-ahead',
        image: '/app-v2/slide-4-hero.jpg?v=4',
        lightLeakSide: 'left' as const,
        kicker: lang === 'en' ? 'YA ESTÁ. READY WHEN YOU ARE' : 'YA ESTÁ. LISTO CUANDO LLEGUES',
        lines:
          lang === 'en'
            ? ['ORDER AHEAD', 'FROM', 'ANYWHERE']
            : ['PIDE DESDE', 'CUALQUIER', 'LUGAR'],
        accentLineIndex: 0,
        subtitle:
          lang === 'en'
            ? 'Skip the line with Express Pickup or get your order delivered hot and fresh straight to your door.'
            : 'Salta la fila con Pickup Express o recibe tu pedido recién hecho directo en tu puerta.',
      },
    ],
    [lang]
  )

  const activeSlide = STORY_SLIDES[storyIndex]

  return (
    <div
      className={
        fullscreenNative
          ? 'relative w-full h-full bg-[#121212] flex items-center justify-center overflow-hidden font-sans select-none'
          : embedded
          ? 'relative w-full h-full bg-[#121212] flex items-center justify-center overflow-hidden font-sans select-none rounded-[38px]'
          : 'relative w-full h-full bg-[#09090b] flex items-center justify-center overflow-hidden font-sans select-none'
      }
    >
      {/* Ambient Desktop Studio Backdrop */}
      {!embedded && !fullscreenNative && (
        <>
          <div
            className="hidden md:block absolute inset-0 bg-cover bg-center opacity-25 blur-3xl scale-110 pointer-events-none"
            style={{ backgroundImage: `url('/app-v2/slide-4-hero.jpg')` }}
          />
          <div className="hidden md:block absolute inset-0 bg-gradient-to-b from-black/80 via-[#2a0306]/70 to-black/90 pointer-events-none" />
        </>
      )}

      {/* Mobile Phone Shell Container */}
      <div
        className={
          embedded || fullscreenNative
            ? 'relative w-full h-full bg-[#121212] overflow-hidden flex flex-col'
            : 'relative w-full h-full md:max-w-[430px] md:h-[92vh] md:max-h-[900px] md:rounded-[44px] bg-[#121212] md:shadow-[0_30px_100px_rgba(0,0,0,0.85)] md:ring-1 md:ring-white/15 overflow-hidden flex flex-col'
        }
      >
        {/* =====================================================================
            iPHONE 16 PRO TOP STATUS BAR + DYNAMIC ISLAND (ISLA DINÁMICA)
            Rendered inside the phone frame so Version 2 couples cleanly below it
           ===================================================================== */}
        {!fullscreenNative && (
          <div
            className={`absolute top-0 inset-x-0 h-[46px] z-[75] pointer-events-none flex items-center justify-between px-6 pt-1.5 transition-colors ${
              authSheet === 'facebook-sheet' ? 'text-slate-900' : 'text-white'
            }`}
          >
            {/* Left: Live Los Angeles Time */}
            <div className="w-[74px] flex items-center pl-1">
              <span className="text-[13px] font-black tracking-tight leading-none drop-shadow-xs">
                {getLaStatusClock()}
              </span>
            </div>

            {/* Center: Authentic iPhone Dynamic Island (Isla Dinámica) */}
            <div className="w-[118px] h-[31px] rounded-full bg-black border border-white/15 shadow-[0_3px_12px_rgba(0,0,0,0.7)] flex items-center justify-between px-3">
              {/* Left Face ID Infrared Sensor */}
              <div className="w-2.5 h-2.5 rounded-full bg-[#101016] ring-1 ring-white/5" />
              {/* Center subtle privacy indicator dot */}
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
              {/* Right TrueDepth Front Camera Lens */}
              <div className="w-3 h-3 rounded-full bg-[#0d1528] ring-1 ring-indigo-400/35 flex items-center justify-center">
                <div className="w-1 h-1 rounded-full bg-sky-400/70" />
              </div>
            </div>

            {/* Right: iOS Cellular Signal Bars + Wi-Fi + Battery */}
            <div className="w-[74px] flex items-center justify-end gap-1.5 pr-0.5">
              {/* Cellular 4 Bars */}
              <svg className="w-[15px] h-[11px] fill-current" viewBox="0 0 18 12" aria-hidden="true">
                <rect x="0.5" y="8" width="2.8" height="3.5" rx="0.8" />
                <rect x="4.8" y="5.8" width="2.8" height="5.7" rx="0.8" />
                <rect x="9.1" y="3.3" width="2.8" height="8.2" rx="0.8" />
                <rect x="13.4" y="0.8" width="2.8" height="10.7" rx="0.8" />
              </svg>
              {/* Wi-Fi */}
              <svg className="w-[14px] h-[11px] fill-current" viewBox="0 0 16 12" aria-hidden="true">
                <path d="M8 9.4a1.4 1.4 0 100 2.8 1.4 1.4 0 000-2.8zm-3.2-1.8a5.1 5.1 0 016.4 0l1.2-1.3a6.9 6.9 0 00-8.8 0l1.2 1.3zm-2.6-2.7a8.8 8.8 0 0111.6 0L15 3.6a10.6 10.6 0 00-14 0l1.2 1.3z" />
              </svg>
              {/* Battery */}
              <svg className="w-[23px] h-[11px]" viewBox="0 0 25 12" aria-hidden="true">
                <rect
                  x="0.75"
                  y="1"
                  width="20.5"
                  height="10"
                  rx="3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeOpacity="0.6"
                />
                <rect x="2.5" y="2.6" width="17" height="6.8" rx="1.6" fill="currentColor" />
                <path d="M22.5 4.2v3.6a1.6 1.6 0 000-3.6z" fill="currentColor" fillOpacity="0.6" />
              </svg>
            </div>
          </div>
        )}

        {/* =====================================================================
            STAGE 1: COFFEE BEAN STYLE VERTICAL STORY ONBOARDING (00:03 - 00:28)
           ===================================================================== */}
        <AnimatePresence mode="wait">
          {stage === 'stories' && (
            <motion.div
              key="v2-stories-stage"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, y: -40 }}
              transition={{ duration: 0.35 }}
              className="relative w-full h-full flex flex-col justify-between overflow-hidden"
            >
              {/* Full-bleed Vertical Slide Image with vertical spring transition */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeSlide.id}
                  initial={{ y: 80, opacity: 0, scale: 1.04 }}
                  animate={{ y: 0, opacity: 1, scale: 1 }}
                  exit={{ y: -80, opacity: 0, scale: 0.98 }}
                  transition={{ type: 'spring', damping: 24, stiffness: 180 }}
                  className="absolute inset-0"
                >
                  <img
                    src={activeSlide.image}
                    alt={activeSlide.kicker}
                    className="w-full h-full object-cover object-center"
                  />
                  {/* Moody Top & Bottom Vignette for 100% Text Legibility (lighter bottom on Slide 5 so food shines unobstructed) */}
                  <div
                    className={`absolute inset-0 ${
                      storyIndex === 4
                        ? 'bg-gradient-to-b from-black/80 via-black/10 to-black/40'
                        : 'bg-gradient-to-b from-black/85 via-black/35 to-black/90'
                    }`}
                  />

                  {/* Signature Coffee Bean Warm Neon Light-Leak Edge Glow */}
                  <div
                    className={`absolute inset-y-0 w-16 pointer-events-none ${
                      activeSlide.lightLeakSide === 'left'
                        ? 'left-0 bg-gradient-to-r from-[#ff2a1f]/55 via-[#fdc82f]/20 to-transparent'
                        : 'right-0 bg-gradient-to-l from-[#ff2a1f]/55 via-[#fdc82f]/20 to-transparent'
                    }`}
                  />
                </motion.div>
              </AnimatePresence>

              {/* Top Bar: Mini Circular Logo + Language Toggle + Slide Counter */}
              <div
                className={`relative z-20 flex items-center justify-between px-5 pb-2 ${
                  !fullscreenNative && !islandOverlayMode ? 'pt-[50px]' : 'pt-5'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <img
                    src="/logo.png"
                    alt="Tacos Gavilan"
                    className="w-10 h-10 rounded-full object-contain shadow-lg"
                  />
                  <div>
                    <span className="block text-[10px] font-black tracking-[0.2em] text-[#FDC82F] uppercase">
                      TACOS GAVILAN
                    </span>
                    <span className="block text-[11px] font-bold text-white/80">
                      {lang === 'en' ? 'Version 2' : 'Versión 2'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleLang}
                    className="px-3 py-1 rounded-full bg-black/55 hover:bg-black/80 text-white border border-white/25 text-[11px] font-black tracking-wider backdrop-blur-md transition-all cursor-pointer"
                  >
                    {lang === 'en' ? 'ES' : 'EN'}
                  </button>
                </div>
              </div>

              {/* Right-Side Vertical Progress Dots (Story Pager Indicator) */}
              <div className="absolute right-4 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-2">
                {STORY_SLIDES.map((s, idx) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setStoryIndex(idx)}
                    aria-label={`Slide ${idx + 1}`}
                    className={`w-2 rounded-full transition-all duration-300 cursor-pointer ${
                      idx === storyIndex
                        ? 'h-7 bg-[#FDC82F] shadow-[0_0_10px_rgba(253,200,47,0.8)]'
                        : 'h-2 bg-white/40 hover:bg-white/75'
                    }`}
                  />
                ))}
              </div>

              {/* Middle Content Area: Interactive Cards + Staggered Kinetic Typography */}
              <div
                className={`relative z-20 flex-1 flex flex-col px-6 py-4 ${
                  storyIndex === 4 ? 'justify-start pt-2' : 'justify-between'
                }`}
              >
                {/* Interactive Overlay Cards per Slide (Matching Coffee Bean Video 00:08 - 00:19) */}
                <div className={storyIndex === 4 ? 'mb-3' : 'mt-2'}>
                  <AnimatePresence mode="wait">
                    {(storyIndex === 0 || storyIndex === 4) && (
                      <motion.div
                        key={`slide-${storyIndex}-badge`}
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-black/60 border border-[#FDC82F]/50 backdrop-blur-md shadow-xl"
                      >
                        <Flame size={14} className="text-[#FDC82F]" />
                        <span className="text-[11px] font-black tracking-widest text-white uppercase">
                          {activeSlide.kicker}
                        </span>
                      </motion.div>
                    )}

                    {/* SLIDE 2: Animated iOS Notification Toast Bubbles (00:08 - 00:12 of Coffee Bean) */}
                    {storyIndex === 1 && (
                      <motion.div
                        key="slide1-notifs"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="space-y-2.5 max-w-[340px]"
                      >
                        <motion.div
                          initial={{ y: -25, opacity: 0, scale: 0.92 }}
                          animate={{ y: 0, opacity: 1, scale: 1 }}
                          transition={{ type: 'spring', damping: 16, stiffness: 220, delay: 0.1 }}
                          className="flex items-center gap-3 p-3 rounded-2xl bg-white/95 text-slate-900 shadow-[0_14px_35px_rgba(0,0,0,0.45)] border border-white"
                        >
                          <img src="/logo.png" alt="Logo" className="w-10 h-10 rounded-full shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-black uppercase tracking-wider text-[#9E1B12]">
                                TACOS GAVILAN
                              </span>
                              <span className="text-[10px] font-semibold text-slate-400">
                                {lang === 'en' ? 'now' : 'ahora'}
                              </span>
                            </div>
                            <p className="text-xs font-extrabold text-slate-900 mt-0.5">
                              {lang === 'en'
                                ? 'Your order #408 is ready for pickup.'
                                : 'Tu orden #408 está lista para recoger.'}
                            </p>
                          </div>
                        </motion.div>

                        <motion.div
                          initial={{ y: -25, opacity: 0, scale: 0.92 }}
                          animate={{ y: 0, opacity: 1, scale: 1 }}
                          transition={{ type: 'spring', damping: 16, stiffness: 220, delay: 0.28 }}
                          className="flex items-center gap-3 p-3 rounded-2xl bg-white/90 text-slate-900 shadow-[0_14px_35px_rgba(0,0,0,0.4)] border border-white/80 ml-3"
                        >
                          <img src="/logo.png" alt="Logo" className="w-9 h-9 rounded-full shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-black uppercase tracking-wider text-[#9E1B12]">
                                TACOS GAVILAN
                              </span>
                              <span className="text-[10px] font-semibold text-slate-400">2m</span>
                            </div>
                            <p className="text-xs font-bold text-slate-800 mt-0.5">
                              {lang === 'en'
                                ? 'Order #408 confirmed at Tacos Gavilan.'
                                : 'Orden #408 confirmada en Tacos Gavilan.'}
                            </p>
                          </div>
                        </motion.div>
                      </motion.div>
                    )}

                    {/* SLIDE 3: Live Nearest Store Radar Card (00:13 - 00:15 of Coffee Bean) */}
                    {storyIndex === 2 && (
                      <motion.div
                        key="slide2-gps-card"
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="p-3.5 rounded-2xl bg-black/75 border border-white/20 backdrop-blur-xl shadow-2xl max-w-[330px]"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-[#DA291C] flex items-center justify-center text-white shrink-0 shadow-md">
                            <MapPin size={20} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="text-[10px] font-black uppercase tracking-widest text-[#FDC82F]">
                              {userCoords
                                ? lang === 'en'
                                  ? 'NEAREST LOCATION DETECTED'
                                  : 'SUCURSAL MÁS CERCANA'
                                : lang === 'en'
                                ? '15 STORES READY NOW'
                                : '15 SUCURSALES ACTIVAS'}
                            </span>
                            <p className="text-sm font-black text-white truncate">
                              Tacos Gavilan — {currentStore.name}
                            </p>
                            <p className="text-[11px] text-white/75 truncate">{currentStore.address}</p>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {/* SLIDE 4: Interactive QR Card + Hand-Drawn Arrow (00:16 - 00:19 of Coffee Bean) */}
                    {storyIndex === 3 && (
                      <motion.div
                        key="slide3-qr"
                        initial={{ y: 20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="relative flex flex-col items-center pt-2"
                      >
                        <div className="relative bg-white p-4 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.65)] border-2 border-[#FDC82F] flex flex-col items-center w-48">
                          <div className="w-full flex items-center justify-between mb-2">
                            <span className="text-[9px] font-black uppercase tracking-widest text-[#50050a]">
                              FAST PASS
                            </span>
                            <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-[#FDC82F] text-[#50050a]">
                              VIP
                            </span>
                          </div>
                          <div className="relative w-32 h-32 rounded-xl bg-slate-950 p-2.5 flex items-center justify-center">
                            <QrCode size={104} className="text-white" strokeWidth={1.5} />
                            <img
                              src="/logo.png"
                              alt="Tacos Gavilan"
                              className="absolute w-11 h-11 rounded-full shadow-md"
                            />
                          </div>
                          <span className="mt-2 text-[10px] font-extrabold text-slate-700 tracking-wide">
                            {lang === 'en' ? 'Scan or Order Ahead' : 'Pide y recoge sin fila'}
                          </span>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Staggered Kinetic Typography Block (Bottom-Left of Story Slide) */}
                <div className="mb-2">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={`text-${activeSlide.id}`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="space-y-1"
                    >
                      {activeSlide.lines.map((line, i) => (
                        <motion.div
                          key={line + i}
                          initial={{ y: 28, opacity: 0 }}
                          animate={{ y: 0, opacity: 1 }}
                          transition={{
                            type: 'spring',
                            damping: 20,
                            stiffness: 200,
                            delay: 0.08 * i,
                          }}
                        >
                          <span
                            className={`block text-[34px] sm:text-[38px] font-black uppercase leading-[0.96] tracking-tight drop-shadow-[0_4px_18px_rgba(0,0,0,0.85)] ${
                              i === activeSlide.accentLineIndex ? 'text-[#FDC82F]' : 'text-white'
                            }`}
                          >
                            {line}
                          </span>
                        </motion.div>
                      ))}

                      <motion.p
                        initial={{ y: 16, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.28 }}
                        className="pt-2 text-xs sm:text-sm font-semibold text-white/90 max-w-[330px] leading-relaxed drop-shadow"
                      >
                        {activeSlide.subtitle}
                      </motion.p>

                      {/* Slide-Specific Interactive CTA Buttons (Matching Coffee Bean Slide 2 & Slide 3) */}
                      {storyIndex === 1 && (
                        <motion.div
                          initial={{ y: 12, opacity: 0 }}
                          animate={{ y: 0, opacity: 1 }}
                          transition={{ delay: 0.35 }}
                          className="pt-3"
                        >
                          <button
                            type="button"
                            onClick={handleAllowNotifications}
                            className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-white hover:bg-[#FDC82F] text-[#121212] font-black text-xs uppercase tracking-wider shadow-xl transition-all active:scale-95 cursor-pointer"
                          >
                            <Bell size={15} className="text-[#DA291C]" />
                            <span>
                              {notifEnabled
                                ? lang === 'en'
                                  ? 'NOTIFICATIONS ACTIVE'
                                  : 'NOTIFICACIONES ACTIVAS'
                                : lang === 'en'
                                ? 'ALLOW NOTIFICATIONS'
                                : 'PERMITIR NOTIFICACIONES'}
                            </span>
                          </button>
                        </motion.div>
                      )}

                      {storyIndex === 2 && (
                        <motion.div
                          initial={{ y: 12, opacity: 0 }}
                          animate={{ y: 0, opacity: 1 }}
                          transition={{ delay: 0.35 }}
                          className="pt-3"
                        >
                          <button
                            type="button"
                            onClick={() => handleLocateGps(true)}
                            disabled={isLocating}
                            className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-[#FDC82F] hover:bg-amber-400 text-[#121212] font-black text-xs uppercase tracking-wider shadow-xl transition-all active:scale-95 cursor-pointer"
                          >
                            <LocateFixed size={15} className={isLocating ? 'animate-spin' : ''} />
                            <span>
                              {isLocating
                                ? lang === 'en'
                                  ? 'LOCATING NEAREST STORE...'
                                  : 'BUSCANDO SUCURSAL...'
                                : lang === 'en'
                                ? 'FIND LOCATIONS FASTER'
                                : 'ENCONTRAR SUCURSALES MÁS RÁPIDO'}
                            </span>
                          </button>
                        </motion.div>
                      )}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>

              {/* Bottom Navigation Footer of Story Slides (Down Arrow Button + Skip > OR Full-Width GET STARTED!) */}
              <div className="relative z-20 px-6 pb-6 pt-2">
                {storyIndex < STORY_SLIDES.length - 1 ? (
                  <div className="flex items-center justify-between">
                    <div className="w-16 text-[11px] font-bold text-white/60">
                      0{storyIndex + 1} / 0{STORY_SLIDES.length}
                    </div>

                    {/* Coffee Bean Signature Bouncing Circular Down-Arrow Button */}
                    <motion.button
                      type="button"
                      onClick={() => setStoryIndex((prev) => Math.min(prev + 1, STORY_SLIDES.length - 1))}
                      animate={{ y: [0, -6, 0] }}
                      transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                      className="w-13 h-13 rounded-full bg-white/15 hover:bg-white/30 border-2 border-white text-white flex items-center justify-center backdrop-blur-md shadow-[0_0_25px_rgba(255,255,255,0.25)] transition-colors cursor-pointer"
                      aria-label="Next slide"
                    >
                      <ArrowDown size={22} strokeWidth={2.5} />
                    </motion.button>

                    {/* Skip > Button */}
                    <button
                      type="button"
                      onClick={() => setStage('hello')}
                      className="w-16 flex items-center justify-end gap-0.5 text-xs font-black uppercase tracking-wider text-white/90 hover:text-[#FDC82F] transition-colors cursor-pointer"
                    >
                      <span>{lang === 'en' ? 'Skip' : 'Saltar'}</span>
                      <ChevronRight size={15} />
                    </button>
                  </div>
                ) : (
                  /* Slide 5 Final Full-Width CTA Bar ("GET STARTED!" at 00:24 of Coffee Bean) */
                  <motion.button
                    type="button"
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    onClick={() => setStage('hello')}
                    className="w-full py-4 rounded-2xl bg-gradient-to-r from-[#DA291C] via-[#b81d13] to-[#DA291C] hover:from-[#e63225] hover:to-[#c92015] text-white font-black text-sm uppercase tracking-[0.15em] shadow-[0_12px_35px_rgba(218,41,28,0.55)] border border-[#FDC82F]/60 flex items-center justify-center gap-2 transition-all active:scale-98 cursor-pointer"
                  >
                    <span>{lang === 'en' ? 'GET STARTED!' : '¡EMPEZAR AHORA!'}</span>
                    <ChevronRight size={18} />
                  </motion.button>
                )}
              </div>
            </motion.div>
          )}

          {/* =====================================================================
              STAGE 2: COFFEE BEAN DARK "HELLO! / ¡HOLA!" WELCOME GATE (Video 1 @ 02:05)
              Includes Apple (iOS), Google (Android), Facebook, Sign Up, Log In & Guest Order
             ===================================================================== */}
          {stage === 'hello' && (
            <motion.div
              key="v2-hello-stage"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className={`relative w-full h-full bg-[#121212] flex flex-col justify-between px-6 pb-5 overflow-y-auto no-scrollbar ${
                !fullscreenNative && !islandOverlayMode ? 'pt-[50px]' : 'pt-5'
              }`}
            >
              {/* Subtle Official Brand Line-Art Pattern Overlay */}
              <div
                className="absolute inset-0 bg-repeat bg-center opacity-[0.07] pointer-events-none"
                style={{ backgroundImage: `url('/app-v2/dark-pattern.png')`, backgroundSize: '340px' }}
              />
              {/* Warm Ambient Glow Behind Circular Logo */}
              <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-80 h-80 rounded-full bg-[#DA291C]/20 blur-3xl pointer-events-none" />

              {/* Top Controls: Replay Stories + Language Switch */}
              <div className="relative z-10 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    setStoryIndex(0)
                    setStage('stories')
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/15 text-white/85 text-[11px] font-bold border border-white/15 transition-all cursor-pointer"
                >
                  <Play size={11} className="text-[#FDC82F]" fill="currentColor" />
                  <span>{lang === 'en' ? 'Replay Intro' : 'Ver Intro'}</span>
                </button>

                <button
                  type="button"
                  onClick={toggleLang}
                  className="px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/15 text-white text-[11px] font-black tracking-wider border border-white/15 transition-all cursor-pointer"
                >
                  {lang === 'en' ? 'ES' : 'EN'}
                </button>
              </div>

              {/* Centerpiece: Circular White-Ring Logo + Monumental "HELLO! / ¡HOLA!" */}
              <div className="relative z-10 flex flex-col items-center text-center my-auto py-2">
                <motion.div
                  initial={{ scale: 0.7, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', damping: 14, stiffness: 160 }}
                  className="w-24 h-24 rounded-full shadow-[0_18px_45px_rgba(0,0,0,0.65)] mb-4 flex items-center justify-center"
                >
                  <img
                    src="/logo.png"
                    alt="Tacos Gavilan"
                    className="w-full h-full rounded-full object-contain"
                  />
                </motion.div>

                <motion.h1
                  initial={{ y: 16, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.08 }}
                  className="text-4xl sm:text-5xl font-black uppercase tracking-tight text-white"
                >
                  {lang === 'en' ? 'HELLO!' : '¡HOLA!'}
                </motion.h1>

                <motion.p
                  initial={{ y: 16, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.14 }}
                  className="mt-2 text-xs font-medium text-white/80 max-w-[295px] leading-relaxed"
                >
                  {lang === 'en'
                    ? 'Create an account or log in to save your favorite locations, repeat orders, and check out faster!'
                    : '¡Crea una cuenta o inicia sesión para guardar tus sucursales favoritas, repetir pedidos y ordenar más rápido!'}
                </motion.p>
              </div>

              {/* Complete Multi-Platform Action Stack (Apple iOS + Google Android + Facebook + Sign Up | Log In + Start Order) */}
              <div className="relative z-10 space-y-2.5 pb-1">
                {/* 1. Sign in with Apple (White Solid Button — iOS) */}
                <button
                  type="button"
                  onClick={() => {
                    setAuthError(null)
                    setAuthSheet('apple-sheet')
                  }}
                  className="w-full py-3 rounded-xl bg-white hover:bg-slate-100 text-black font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md transition-all active:scale-98 cursor-pointer"
                >
                  <svg className="w-4 h-4 fill-current shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                  </svg>
                  <span>{lang === 'en' ? 'Sign in with Apple' : 'Iniciar sesión con Apple'}</span>
                </button>

                {/* 2. Continue with Google (Android & Google Account Official Button) */}
                <button
                  type="button"
                  onClick={() => {
                    setAuthError(null)
                    setAuthSheet('google-sheet')
                  }}
                  className="w-full py-3 rounded-xl bg-[#1c1c1e] hover:bg-white/15 text-white font-extrabold text-xs uppercase tracking-wider border-[1.5px] border-white/85 flex items-center justify-center gap-2.5 transition-all active:scale-98 cursor-pointer"
                >
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="#EA4335"
                      d="M12 10.2v3.9h5.5c-.24 1.26-.96 2.33-2.04 3.05l3.3 2.56c1.92-1.77 3.04-4.38 3.04-7.51 0-.72-.06-1.42-.19-2.09H12z"
                    />
                    <path
                      fill="#4285F4"
                      d="M12 22c2.7 0 4.96-.89 6.62-2.42l-3.3-2.56c-.91.61-2.08.98-3.32.98-2.55 0-4.71-1.72-5.48-4.04H3.11v2.64C4.76 19.87 8.11 22 12 22z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M6.52 13.96A5.98 5.98 0 016.2 12c0-.68.12-1.34.32-1.96V7.4H3.11A9.98 9.98 0 002 12c0 1.61.39 3.14 1.11 4.6l3.41-2.64z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 5.98c1.47 0 2.78.51 3.82 1.5l2.86-2.86C16.95 2.99 14.7 2 12 2 8.11 2 4.76 4.13 3.11 7.4l3.41 2.64C7.29 7.7 9.45 5.98 12 5.98z"
                    />
                  </svg>
                  <span>
                    {lang === 'en'
                      ? 'CONTINUE WITH GOOGLE (ANDROID)'
                      : 'CONTINUAR CON GOOGLE (ANDROID)'}
                  </span>
                </button>

                {/* 3. Connect with Facebook (Matching Video 1 @ 02:05) */}
                <button
                  type="button"
                  onClick={() => {
                    setAuthError(null)
                    setAuthSheet('facebook-sheet')
                  }}
                  className="w-full py-2.5 rounded-xl bg-transparent hover:bg-white/10 text-white font-extrabold text-xs uppercase tracking-wider border-[1.5px] border-white/80 flex items-center justify-center gap-2 transition-all active:scale-98 cursor-pointer"
                >
                  <span className="w-4 h-4 rounded-xs bg-[#1877F2] text-white inline-flex items-center justify-center font-black text-[11px] leading-none">
                    f
                  </span>
                  <span>
                    {lang === 'en' ? 'CONNECT WITH FACEBOOK' : 'CONECTAR CON FACEBOOK'}
                  </span>
                </button>

                {/* 4. Side-by-Side SIGN UP | LOG IN Outlined Buttons */}
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthError(null)
                      setAuthSheet('signup')
                    }}
                    className="py-3 rounded-xl bg-transparent hover:bg-white/10 text-white font-black text-xs uppercase tracking-widest border-[1.5px] border-white/85 transition-all active:scale-95 cursor-pointer"
                  >
                    {lang === 'en' ? 'SIGN UP' : 'REGISTRARSE'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthError(null)
                      setAuthSheet('login')
                    }}
                    className="py-3 rounded-xl bg-transparent hover:bg-white/10 text-white font-black text-xs uppercase tracking-widest border-[1.5px] border-white/85 transition-all active:scale-95 cursor-pointer"
                  >
                    {lang === 'en' ? 'LOG IN' : 'INICIAR SESIÓN'}
                  </button>
                </div>

                {/* 5. Full-Width Brand Primary CTA: START YOUR ORDER */}
                <button
                  type="button"
                  onClick={() =>
                    triggerBrandTransition(
                      lang === 'en' ? 'Preparing Menu...' : 'Preparando Menú...',
                      () => {
                        setStage('main')
                        setActiveTab('home')
                      }
                    )
                  }
                  className="w-full py-3.5 rounded-xl bg-[#DA291C] hover:bg-[#b81d13] text-white font-black text-xs sm:text-sm uppercase tracking-[0.14em] shadow-[0_12px_30px_rgba(218,41,28,0.45)] border border-[#FDC82F]/50 transition-all active:scale-98 cursor-pointer"
                >
                  {lang === 'en' ? 'START YOUR ORDER' : 'EMPEZAR TU ORDEN'}
                </button>

                {/* 6. Footer Help Link (Matching Video 1 @ 02:05 bottom) */}
                <div className="pt-1 text-center text-[11px] text-white/75 leading-snug">
                  <p>{lang === 'en' ? 'Forgot how you registered?' : '¿Olvidaste cómo te registraste?'}</p>
                  <p>
                    {lang === 'en' ? 'Reach out to our team here: ' : 'Escríbenos aquí: '}
                    <button
                      type="button"
                      onClick={() => setAuthSheet('contact-support')}
                      className="underline font-bold text-white hover:text-[#FDC82F] cursor-pointer"
                    >
                      {lang === 'en' ? 'Contact Us' : 'Contáctanos'}
                    </button>
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {/* =====================================================================
              STAGE 4: COFFEE BEAN PRO 5-TAB APP SHELL + FULL-BLEED HERO HOME
             ===================================================================== */}
          {stage === 'main' && (
            <motion.div
              key="v2-main-stage"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="relative w-full h-full bg-[#121212] flex flex-col overflow-hidden"
            >
              {/* Top Store Selector & Quick Controls Bar */}
              <div
                className={`relative z-30 flex items-center justify-between px-4 pb-3 bg-[#141414]/95 border-b border-white/10 backdrop-blur-md ${
                  !fullscreenNative && !islandOverlayMode ? 'pt-[50px]' : 'pt-3'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setStoreModalOpen(true)}
                  className="flex items-center gap-2.5 min-w-0 text-left group cursor-pointer"
                >
                  <img src="/logo.png" alt="Tacos Gavilan" className="w-9 h-9 rounded-full shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-black uppercase tracking-widest text-[#FDC82F]">
                        {fulfillmentMode === 'pickup' ? 'PICKUP' : 'DELIVERY'}
                      </span>
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          currentStoreStatus.isOpen ? 'bg-emerald-400' : 'bg-amber-400'
                        }`}
                      />
                      <span className="text-[10px] font-bold text-white/70">
                        {currentStoreStatus.badgeText}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-xs sm:text-sm font-black text-white truncate group-hover:text-[#FDC82F] transition-colors">
                        {currentStore.name}
                      </span>
                      {currentStore.distanceMiles !== null && (
                        <span className="text-[10px] font-bold text-white/60">
                          ({currentStore.distanceMiles.toFixed(1)} mi)
                        </span>
                      )}
                      <ChevronDown size={14} className="text-[#FDC82F] shrink-0" />
                    </div>
                  </div>
                </button>

                <div className="flex items-center gap-1.5 shrink-0">
                  {!loggedUser && (
                    <button
                      type="button"
                      onClick={() => setStage('hello')}
                      className="px-2.5 py-1 rounded-full bg-[#DA291C] hover:bg-[#b81d13] text-white text-[10px] font-black uppercase tracking-wider cursor-pointer"
                    >
                      {lang === 'en' ? 'Sign In' : 'Entrar'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setStoryIndex(0)
                      setStage('stories')
                    }}
                    title={lang === 'en' ? 'Replay Story Intro' : 'Repetir Historia Inicial'}
                    className="px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 text-white/90 text-[10px] font-extrabold border border-white/15 flex items-center gap-1 cursor-pointer"
                  >
                    <Play size={10} className="text-[#FDC82F]" fill="currentColor" />
                    <span>Intro</span>
                  </button>
                  <button
                    type="button"
                    onClick={toggleLang}
                    className="px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 text-white text-[10px] font-black border border-white/15 cursor-pointer"
                  >
                    {lang === 'en' ? 'ES' : 'EN'}
                  </button>
                </div>
              </div>

              {/* Main Tab Viewport */}
              <div className="relative flex-1 overflow-y-auto overflow-x-hidden no-scrollbar">
                {/* TAB 1: HOME (Personalized Member Header when Logged In + Full-bleed Hero + Specialties) */}
                {activeTab === 'home' && (
                  <div className="pb-24">
                    {/* PERSONALIZED LOGGED-IN MEMBER HEADER (Matching Video 2 @ 02:16 "Good Afternoon CARLOS" + QR Button) */}
                    {loggedUser && (
                      <div className="relative bg-[#141414] px-5 pt-4 pb-5 border-b border-white/10 overflow-visible">
                        <div
                          className="absolute inset-0 bg-repeat bg-center opacity-[0.06] pointer-events-none"
                          style={{ backgroundImage: `url('/app-v2/dark-pattern.png')`, backgroundSize: '280px' }}
                        />
                        <div className="relative z-10 flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-bold text-white/80">
                              {getLaTimeGreeting(lang)}
                            </p>
                            <h2 className="text-3xl font-black uppercase tracking-tight text-white leading-none mt-0.5">
                              {loggedUser.firstName}
                            </h2>
                            <div className="mt-2.5 flex items-center gap-2">
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gradient-to-r from-[#DA291C] to-[#9E1B12] text-white text-[10px] font-black uppercase tracking-wider shadow-sm">
                                <Flame size={11} className="text-[#FDC82F]" />
                                <span>
                                  {lang === 'en' ? 'Gavilan VIP Member' : 'Miembro VIP Gavilan'}
                                </span>
                              </span>
                              <button
                                type="button"
                                onClick={() => setActiveTab('account')}
                                className="text-[11px] font-bold text-white/75 underline hover:text-[#FDC82F] cursor-pointer"
                              >
                                {lang === 'en' ? 'My Account' : 'Mi Cuenta'}
                              </button>
                            </div>
                          </div>

                          {/* Top-Right Circular QR Code Button + Tooltip Callout (Video 2 @ 02:16) */}
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() => {
                                setShowQrTooltip(false)
                                setQrModalOpen(true)
                              }}
                              className="w-14 h-14 rounded-full bg-white p-2 ring-3 ring-[#DA291C] shadow-[0_0_25px_rgba(218,41,28,0.55)] flex items-center justify-center hover:scale-105 transition-transform cursor-pointer"
                              title={lang === 'en' ? 'Open Member QR Code' : 'Abrir Código QR'}
                            >
                              <QrCode size={34} className="text-slate-900" strokeWidth={2} />
                            </button>

                            {showQrTooltip && (
                              <motion.div
                                initial={{ opacity: 0, y: 6, scale: 0.95 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                className="absolute right-0 top-16 z-30 w-56 p-3 rounded-xl bg-white text-slate-900 shadow-2xl border border-slate-200"
                              >
                                <div className="absolute -top-1.5 right-5 w-3 h-3 bg-white rotate-45 border-l border-t border-slate-200" />
                                <div className="flex items-start justify-between gap-2">
                                  <p className="text-xs font-black text-slate-900">
                                    {lang === 'en' ? 'Scan from here' : 'Escanea desde aquí'}
                                  </p>
                                  <button
                                    type="button"
                                    onClick={() => setShowQrTooltip(false)}
                                    className="text-slate-400 hover:text-slate-700 cursor-pointer"
                                  >
                                    <X size={12} />
                                  </button>
                                </div>
                                <p className="text-[11px] text-slate-600 mt-1 leading-snug">
                                  {lang === 'en'
                                    ? 'Check in at the counter or pick up faster by scanning your personal QR code!'
                                    : '¡Identifícate en mostrador o recoge tu pedido más rápido con tu código QR!'}
                                </p>
                              </motion.div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Full-bleed Hero Poster (00:45 - 00:55 of Coffee Bean) */}
                    <div className="relative w-full h-[400px] overflow-hidden">
                      <img
                        src="/app-v2/slide-4-hero.jpg?v=4"
                        alt="Tacos Gavilan Hero"
                        className="w-full h-full object-cover object-bottom"
                      />
                      <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/25 to-[#121212]" />

                      {/* Kinetic Headline Overlay Top-Left */}
                      <div className="absolute top-5 left-5 right-5">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#DA291C] text-white text-[10px] font-black uppercase tracking-widest shadow-lg">
                          {lang === 'en' ? 'TACOS GAVILAN • SINCE 1992' : 'TACOS GAVILAN • DESDE 1992'}
                        </span>

                        <h2 className="mt-3 text-3xl sm:text-[34px] font-black uppercase leading-[0.98] tracking-tight text-white drop-shadow-[0_4px_16px_rgba(0,0,0,0.9)]">
                          {lang === 'en' ? (
                            <>
                              SKIP THE LINE WITH
                              <span className="block text-[#FDC82F]">ORDER AHEAD</span>
                              OR DELIVERY
                            </>
                          ) : (
                            <>
                              SALTA LA FILA CON
                              <span className="block text-[#FDC82F]">PICKUP RÁPIDO</span>
                              O DELIVERY
                            </>
                          )}
                        </h2>

                        <p className="mt-2 text-xs font-semibold text-white/85 max-w-[290px] drop-shadow">
                          {lang === 'en'
                            ? `Ordering from Tacos Gavilan ${currentStore.name} (${currentStoreStatus.todayHours})`
                            : `Ordenando en Tacos Gavilan ${currentStore.name} (${currentStoreStatus.todayHours})`}
                        </p>
                      </div>
                    </div>

                    {/* Active Store Quick Action Strip */}
                    <div className="px-4 -mt-6 relative z-10">
                      <div className="p-3.5 rounded-2xl bg-[#1c1c1e] border border-white/10 shadow-xl flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <MapPin size={13} className="text-[#FDC82F] shrink-0" />
                            <span className="text-xs font-black text-white truncate">
                              Tacos Gavilan — {currentStore.name}
                            </span>
                          </div>
                          <p className="text-[11px] text-white/65 truncate mt-0.5">
                            {currentStore.address}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <a
                            href={`tel:${currentStore.phone.replace(/[^\d+]/g, '')}`}
                            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
                            title={currentStore.phone}
                          >
                            <Phone size={14} />
                          </a>
                          <a
                            href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
                              `${currentStore.address}`
                            )}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-[#FDC82F] transition-colors"
                            title="Maps"
                          >
                            <Navigation size={14} />
                          </a>
                          <button
                            type="button"
                            onClick={() => handleLocateGps(false)}
                            className="p-2 rounded-xl bg-[#DA291C]/25 hover:bg-[#DA291C]/40 text-[#FDC82F] border border-[#DA291C]/40 transition-colors cursor-pointer"
                            title="GPS"
                          >
                            <LocateFixed size={14} className={isLocating ? 'animate-spin' : ''} />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Signature Cravings Grid */}
                    <div className="px-4 mt-5">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-xs font-black uppercase tracking-wider text-white/90">
                          {lang === 'en' ? 'TACOS GAVILAN FAVORITES' : 'ESPECIALIDADES TACOS GAVILAN'}
                        </h3>
                        <button
                          type="button"
                          onClick={() =>
                            triggerBrandTransition(
                              lang === 'en' ? 'Opening Menu...' : 'Abriendo Menú...',
                              () => setActiveTab('order')
                            )
                          }
                          className="text-[11px] font-extrabold text-[#FDC82F] hover:underline flex items-center gap-0.5 cursor-pointer"
                        >
                          <span>{lang === 'en' ? 'Full Menu' : 'Ver Menú'}</span>
                          <ChevronRight size={13} />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        {SIGNATURE_DISHES.map((dish) => (
                          <button
                            key={dish.id}
                            type="button"
                            onClick={() =>
                              triggerBrandTransition(
                                lang === 'en' ? dish.nameEn : dish.nameEs,
                                () => setActiveTab('order')
                              )
                            }
                            className="group text-left p-3 rounded-2xl bg-[#1c1c1e] hover:bg-[#242428] border border-white/10 hover:border-[#FDC82F]/50 transition-all flex flex-col justify-between cursor-pointer"
                          >
                            <div>
                              <div className="flex items-center justify-between">
                                <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#DA291C]/25 text-[#FDC82F] border border-[#DA291C]/40">
                                  {lang === 'en' ? dish.tagEn : dish.tagEs}
                                </span>
                              </div>
                              <div className="h-24 flex items-center justify-center my-2">
                                <img
                                  src={dish.image}
                                  alt={dish.nameEs}
                                  className="max-h-22 w-auto object-contain group-hover:scale-108 transition-transform duration-300 drop-shadow-[0_8px_16px_rgba(0,0,0,0.6)]"
                                />
                              </div>
                              <h4 className="text-xs font-black text-white leading-tight">
                                {lang === 'en' ? dish.nameEn : dish.nameEs}
                              </h4>
                              <p className="text-[10px] text-white/60 line-clamp-2 mt-1 leading-snug">
                                {lang === 'en' ? dish.descEn : dish.descEs}
                              </p>
                            </div>
                            <div className="mt-2.5 pt-2 border-t border-white/10 flex items-center justify-between text-[10px] font-black text-[#FDC82F]">
                              <span>{lang === 'en' ? 'ORDER NOW' : 'ORDENAR'}</span>
                              <ChevronRight size={12} />
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* TAB 2: ORDER (Embedded Interactive Menu + Direct Toast Online Handoff) */}
                {activeTab === 'order' && (
                  <div className="w-full h-full flex flex-col bg-[#121212]">
                    <div className="px-4 py-2.5 bg-[#1c1c1e] border-b border-white/10 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setFulfillmentMode('pickup')}
                          className={`px-3 py-1 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                            fulfillmentMode === 'pickup'
                              ? 'bg-[#DA291C] text-white shadow'
                              : 'bg-white/10 text-white/70'
                          }`}
                        >
                          Pickup
                        </button>
                        <button
                          type="button"
                          onClick={() => setFulfillmentMode('delivery')}
                          className={`px-3 py-1 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                            fulfillmentMode === 'delivery'
                              ? 'bg-[#DA291C] text-white shadow'
                              : 'bg-white/10 text-white/70'
                          }`}
                        >
                          Delivery
                        </button>
                      </div>

                      <a
                        href={currentStore.toastOrderingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-[#FDC82F] text-[#50050a] text-[10px] font-black uppercase tracking-wider shadow cursor-pointer"
                      >
                        <span>{lang === 'en' ? 'Direct Store Checkout' : 'Checkout Directo'}</span>
                        <ExternalLink size={11} />
                      </a>
                    </div>
                    <div className="flex-1 w-full bg-white">
                      <iframe
                        src="/app/index.html?nosplash=1"
                        className="w-full h-full border-0"
                        title="Tacos Gavilan Interactive Menu"
                      />
                    </div>
                  </div>
                )}

                {/* TAB 3: STORES (All 15 Real Locations with GPS, Live Hours, Call & Maps) */}
                {activeTab === 'stores' && (
                  <div className="p-4 space-y-3 pb-24">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-base font-black text-white uppercase tracking-tight">
                          {lang === 'en' ? '15 Official Locations' : '15 Sucursales Oficiales'}
                        </h3>
                        <p className="text-xs text-white/65">
                          {lang === 'en'
                            ? 'Live schedules in Los Angeles time (PT)'
                            : 'Horarios en tiempo real (Hora de Los Ángeles)'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleLocateGps(false)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#FDC82F] text-[#121212] text-xs font-black cursor-pointer"
                      >
                        <LocateFixed size={13} className={isLocating ? 'animate-spin' : ''} />
                        <span>{lang === 'en' ? 'Near Me' : 'Cerca de mí'}</span>
                      </button>
                    </div>

                    {storesWithDistance.map((st) => {
                      const status = getStoreStatusInLA(st, lang)
                      const isSelected = st.id === currentStore.id
                      return (
                        <div
                          key={st.id}
                          className={`p-3.5 rounded-2xl border transition-all ${
                            isSelected
                              ? 'bg-[#261212] border-[#FDC82F]'
                              : 'bg-[#1c1c1e] border-white/10'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-black text-white">
                                  Tacos Gavilan — {st.name}
                                </span>
                                {st.distanceMiles !== null && (
                                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-white/10 text-[#FDC82F]">
                                    {st.distanceMiles.toFixed(1)} mi
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-white/70 mt-0.5">{st.address}</p>
                              <div className="flex items-center gap-2 mt-1.5 text-[11px]">
                                <span
                                  className={`font-black ${
                                    status.isOpen ? 'text-emerald-400' : 'text-amber-400'
                                  }`}
                                >
                                  ● {status.badgeText}
                                </span>
                                <span className="text-white/55">• {status.todayHours}</span>
                              </div>
                            </div>
                          </div>

                          <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5">
                              <a
                                href={`tel:${st.phone.replace(/[^\d+]/g, '')}`}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[11px] font-bold"
                              >
                                <Phone size={12} />
                                <span>{st.phone}</span>
                              </a>
                              <a
                                href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
                                  st.address
                                )}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-[#FDC82F] text-[11px] font-bold"
                              >
                                <Navigation size={12} />
                                <span>Maps</span>
                              </a>
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                setSelectedStoreId(st.id)
                                triggerBrandTransition(
                                  `${st.name}`,
                                  () => setActiveTab('order')
                                )
                              }}
                              className="px-3.5 py-1.5 rounded-lg bg-[#DA291C] hover:bg-[#b81d13] text-white text-[11px] font-black uppercase tracking-wider cursor-pointer"
                            >
                              {isSelected
                                ? lang === 'en'
                                  ? 'Order Here'
                                  : 'Ordenar Aquí'
                                : lang === 'en'
                                ? 'Select'
                                : 'Elegir'}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* TAB 4: CRAVINGS / FAVORITES */}
                {activeTab === 'cravings' && (
                  <div className="p-4 space-y-3 pb-24">
                    <h3 className="text-base font-black text-white uppercase tracking-tight">
                      {lang === 'en' ? 'Tacos Gavilan Specialties' : 'Especialidades Tacos Gavilan'}
                    </h3>
                    <p className="text-xs text-white/70">
                      {lang === 'en'
                        ? 'Select any item to order from your nearest Tacos Gavilan location.'
                        : 'Selecciona cualquier platillo para ordenar en tu sucursal de Tacos Gavilan más cercana.'}
                    </p>
                    <div className="space-y-2.5">
                      {SIGNATURE_DISHES.map((dish) => (
                        <div
                          key={dish.id}
                          className="p-3.5 rounded-2xl bg-[#1c1c1e] border border-white/10 flex items-center gap-3.5"
                        >
                          <img
                            src={dish.image}
                            alt={dish.nameEs}
                            className="w-20 h-20 object-contain shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <span className="text-[9px] font-black uppercase tracking-widest text-[#FDC82F]">
                              {lang === 'en' ? dish.tagEn : dish.tagEs}
                            </span>
                            <h4 className="text-sm font-black text-white">
                              {lang === 'en' ? dish.nameEn : dish.nameEs}
                            </h4>
                            <p className="text-xs text-white/65 mt-0.5">
                              {lang === 'en' ? dish.descEn : dish.descEs}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              triggerBrandTransition(
                                lang === 'en' ? dish.nameEn : dish.nameEs,
                                () => setActiveTab('order')
                              )
                            }
                            className="px-3 py-2 rounded-xl bg-[#DA291C] text-white text-[11px] font-black uppercase cursor-pointer shrink-0"
                          >
                            {lang === 'en' ? 'Order' : 'Pedir'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* TAB 5: ACCOUNT & SETTINGS */}
                {activeTab === 'account' && (
                  <div className="p-5 space-y-4 pb-24">
                    <div className="p-4 rounded-2xl bg-[#1c1c1e] border border-white/10 flex items-center gap-3.5">
                      <img src="/logo.png" alt="Tacos Gavilan" className="w-14 h-14 rounded-full" />
                      <div className="min-w-0 flex-1">
                        <span className="text-[10px] font-black uppercase tracking-widest text-[#FDC82F]">
                          TACOS GAVILAN
                        </span>
                        <h3 className="text-base font-black text-white truncate">
                          {loggedUser
                            ? `${loggedUser.firstName} ${loggedUser.lastName}`.trim()
                            : lang === 'en'
                            ? 'Guest Customer'
                            : 'Cliente Invitado'}
                        </h3>
                        <p className="text-xs text-white/70 truncate">
                          {loggedUser
                            ? `${loggedUser.email}${loggedUser.phone ? ` • ${loggedUser.phone}` : ''}`
                            : lang === 'en'
                            ? 'Sign in with Apple, Google (Android), Email, or SMS.'
                            : 'Inicia sesión con Apple, Google (Android), Correo o SMS.'}
                        </p>
                        {loggedUser && (
                          <span className="mt-1.5 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-[10px] font-extrabold text-emerald-300 uppercase">
                            <ShieldCheck size={11} />
                            <span>
                              {loggedUser.provider === 'apple'
                                ? 'Apple ID (iOS)'
                                : loggedUser.provider === 'google'
                                ? 'Google (Android)'
                                : loggedUser.provider === 'facebook'
                                ? 'Facebook'
                                : loggedUser.provider === 'sms'
                                ? 'SMS OTP'
                                : lang === 'en'
                                ? 'Verified Email'
                                : 'Correo Verificado'}
                            </span>
                          </span>
                        )}
                      </div>
                    </div>

                    {!loggedUser ? (
                      <div className="space-y-2.5">
                        <button
                          type="button"
                          onClick={() => setAuthSheet('apple-sheet')}
                          className="w-full py-3 rounded-xl bg-white hover:bg-slate-100 text-black font-bold text-xs flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                          </svg>
                          <span>{lang === 'en' ? 'Sign in with Apple (iOS)' : 'Iniciar sesión con Apple (iOS)'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setAuthSheet('google-sheet')}
                          className="w-full py-3 rounded-xl bg-[#1c1c1e] hover:bg-white/15 text-white font-bold text-xs border border-white/40 flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                            <path
                              fill="#EA4335"
                              d="M12 10.2v3.9h5.5c-.24 1.26-.96 2.33-2.04 3.05l3.3 2.56c1.92-1.77 3.04-4.38 3.04-7.51 0-.72-.06-1.42-.19-2.09H12z"
                            />
                            <path
                              fill="#4285F4"
                              d="M12 22c2.7 0 4.96-.89 6.62-2.42l-3.3-2.56c-.91.61-2.08.98-3.32.98-2.55 0-4.71-1.72-5.48-4.04H3.11v2.64C4.76 19.87 8.11 22 12 22z"
                            />
                            <path
                              fill="#FBBC05"
                              d="M6.52 13.96A5.98 5.98 0 016.2 12c0-.68.12-1.34.32-1.96V7.4H3.11A9.98 9.98 0 002 12c0 1.61.39 3.14 1.11 4.6l3.41-2.64z"
                            />
                            <path
                              fill="#34A853"
                              d="M12 5.98c1.47 0 2.78.51 3.82 1.5l2.86-2.86C16.95 2.99 14.7 2 12 2 8.11 2 4.76 4.13 3.11 7.4l3.41 2.64C7.29 7.7 9.45 5.98 12 5.98z"
                            />
                          </svg>
                          <span>
                            {lang === 'en'
                              ? 'Continue with Google (Android)'
                              : 'Continuar con Google (Android)'}
                          </span>
                        </button>

                        <div className="grid grid-cols-2 gap-2.5">
                          <button
                            type="button"
                            onClick={() => setAuthSheet('signup')}
                            className="py-3 rounded-xl bg-[#DA291C] hover:bg-[#b81d13] text-white font-black text-xs uppercase tracking-wider cursor-pointer"
                          >
                            {lang === 'en' ? 'CREATE ACCOUNT' : 'CREAR CUENTA'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setAuthSheet('login')}
                            className="py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-black text-xs uppercase tracking-wider border border-white/20 cursor-pointer"
                          >
                            {lang === 'en' ? 'LOG IN' : 'INICIAR SESIÓN'}
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setOtpStep(1)
                            setAuthError(null)
                            setAuthSheet('sms-otp')
                          }}
                          className="w-full py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-[#FDC82F] font-bold text-xs border border-[#FDC82F]/30 cursor-pointer"
                        >
                          {lang === 'en' ? 'Sign In with SMS Code (OTP)' : 'Entrar con Código SMS (OTP)'}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        <button
                          type="button"
                          onClick={() => setQrModalOpen(true)}
                          className="w-full py-3 rounded-xl bg-[#FDC82F] hover:bg-amber-400 text-[#50050a] font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <QrCode size={15} />
                          <span>
                            {lang === 'en' ? 'View Member QR Code' : 'Ver Mi Código QR'}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setLoggedUser(null)}
                          className="w-full py-3 rounded-xl bg-white/10 hover:bg-white/15 text-white font-bold text-xs uppercase tracking-wider cursor-pointer"
                        >
                          {lang === 'en' ? 'Sign Out' : 'Cerrar Sesión'}
                        </button>
                      </div>
                    )}

                    <div className="p-4 rounded-2xl bg-[#1c1c1e] border border-white/10 space-y-2.5">
                      <h4 className="text-xs font-black uppercase tracking-wider text-white/60">
                        {lang === 'en' ? 'Experience & Legal' : 'Experiencia y Legal'}
                      </h4>

                      <button
                        type="button"
                        onClick={() => {
                          setStoryIndex(0)
                          setStage('stories')
                        }}
                        className="w-full flex items-center justify-between py-2 text-xs font-bold text-white hover:text-[#FDC82F] cursor-pointer"
                      >
                        <span>
                          {lang === 'en'
                            ? 'Replay Story Onboarding'
                            : 'Repetir Historias de Inicio'}
                        </span>
                        <ChevronRight size={14} />
                      </button>

                      <button
                        type="button"
                        onClick={() => setStage('hello')}
                        className="w-full flex items-center justify-between py-2 text-xs font-bold text-white hover:text-[#FDC82F] cursor-pointer"
                      >
                        <span>
                          {lang === 'en'
                            ? 'View Welcome Screen ("HELLO!")'
                            : 'Ver Pantalla de Bienvenida ("¡HOLA!")'}
                        </span>
                        <ChevronRight size={14} />
                      </button>

                      <a
                        href="/app/privacy"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full flex items-center justify-between py-2 text-xs font-bold text-white/80 hover:text-white"
                      >
                        <span>{lang === 'en' ? 'Privacy Policy' : 'Política de Privacidad'}</span>
                        <ExternalLink size={13} />
                      </a>
                      <a
                        href="/app/terms"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full flex items-center justify-between py-2 text-xs font-bold text-white/80 hover:text-white"
                      >
                        <span>{lang === 'en' ? 'Terms of Use' : 'Términos de Uso'}</span>
                        <ExternalLink size={13} />
                      </a>
                    </div>
                  </div>
                )}
              </div>

              {/* =====================================================================
                  COFFEE BEAN DOCKED WHITE DUAL ACTION BAR (00:45 - 00:55 OF VIDEO)
                 ===================================================================== */}
              {activeTab === 'home' && (
                <div className="relative z-30 bg-white px-4 py-3 border-t border-slate-200 shadow-[0_-10px_30px_rgba(0,0,0,0.35)]">
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setFulfillmentMode('delivery')
                        triggerBrandTransition(
                          lang === 'en' ? 'Setting up Delivery...' : 'Configurando Delivery...',
                          () => setActiveTab('order')
                        )
                      }}
                      className="py-3 rounded-xl bg-white hover:bg-slate-50 text-[#9E1B12] font-black text-xs uppercase tracking-wider border-2 border-[#9E1B12] flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer"
                    >
                      <Truck size={15} />
                      <span>{lang === 'en' ? 'ORDER DELIVERY' : 'PEDIR DELIVERY'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setFulfillmentMode('pickup')
                        triggerBrandTransition(
                          lang === 'en' ? 'Setting up Pickup...' : 'Configurando Pickup...',
                          () => setActiveTab('order')
                        )
                      }}
                      className="py-3 rounded-xl bg-[#DA291C] hover:bg-[#b81d13] text-white font-black text-xs uppercase tracking-wider shadow-md flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer"
                    >
                      <ShoppingBag size={15} />
                      <span>{lang === 'en' ? 'ORDER PICKUP' : 'PEDIR PICKUP'}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* 5-Tab Bottom Navigation Bar (Coffee Bean Layout) */}
              <div className="relative z-30 bg-[#141414] border-t border-white/10 px-2 py-2 grid grid-cols-5">
                {[
                  { id: 'home' as MainTab, labelEn: 'Home', labelEs: 'Inicio', icon: Home },
                  { id: 'order' as MainTab, labelEn: 'Order', labelEs: 'Ordenar', icon: UtensilsCrossed },
                  { id: 'stores' as MainTab, labelEn: 'Stores', labelEs: 'Sucursales', icon: StoreIcon },
                  { id: 'cravings' as MainTab, labelEn: 'Favorites', labelEs: 'Favoritos', icon: Flame },
                  { id: 'account' as MainTab, labelEn: 'Account', labelEs: 'Cuenta', icon: User },
                ].map((tab) => {
                  const Icon = tab.icon
                  const isActive = activeTab === tab.id
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex flex-col items-center justify-center py-1 rounded-xl transition-colors cursor-pointer ${
                        isActive ? 'text-[#FDC82F]' : 'text-white/55 hover:text-white/85'
                      }`}
                    >
                      <Icon size={19} strokeWidth={isActive ? 2.5 : 2} />
                      <span className="text-[10px] font-extrabold mt-0.5">
                        {lang === 'en' ? tab.labelEn : tab.labelEs}
                      </span>
                    </button>
                  )
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* =====================================================================
            COFFEE BEAN BRAND TRANSITION LOADER (01:11 & 04:16 OF VIDEO)
            Centered White Square Card with Circular Logo + Checkmark
           ===================================================================== */}
        <AnimatePresence>
          {brandLoader.visible && (
            <motion.div
              key="v2-brand-loader"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-black/65 backdrop-blur-sm flex flex-col items-center justify-center"
            >
              <motion.div
                initial={{ scale: 0.75, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.85, opacity: 0 }}
                transition={{ type: 'spring', damping: 16, stiffness: 240 }}
                className="w-28 h-28 rounded-3xl bg-white shadow-[0_25px_60px_rgba(0,0,0,0.65)] flex flex-col items-center justify-center p-3 relative"
              >
                <motion.img
                  src="/logo.png"
                  alt="Tacos Gavilan"
                  animate={{ rotate: brandLoader.done ? 0 : [0, -8, 8, 0] }}
                  transition={{ duration: 0.45 }}
                  className="w-18 h-18 rounded-full object-contain"
                />
                {brandLoader.done && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-lg border-2 border-white"
                  >
                    <Check size={16} strokeWidth={3} />
                  </motion.div>
                )}
              </motion.div>
              {brandLoader.label && (
                <p className="mt-3 text-xs font-black uppercase tracking-widest text-white drop-shadow">
                  {brandLoader.label}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* =====================================================================
            STORE SELECTOR MODAL (15 Real Stores)
           ===================================================================== */}
        <AnimatePresence>
          {storeModalOpen && (
            <motion.div
              key="v2-store-modal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-black/80 backdrop-blur-md flex flex-col justify-end"
            >
              <motion.div
                initial={{ y: 200 }}
                animate={{ y: 0 }}
                exit={{ y: 200 }}
                className="bg-[#18181b] rounded-t-3xl border-t border-white/15 max-h-[82%] flex flex-col"
              >
                <div className="p-4 border-b border-white/10 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-wider text-white">
                      {lang === 'en' ? 'Select Tacos Gavilan Store' : 'Elige tu Sucursal Tacos Gavilan'}
                    </h3>
                    <p className="text-[11px] text-white/60">
                      {lang === 'en' ? '15 locations in Southern California' : '15 sucursales en el Sur de California'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStoreModalOpen(false)}
                    className="p-1.5 rounded-full bg-white/10 text-white cursor-pointer"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="p-3 overflow-y-auto space-y-2">
                  {storesWithDistance.map((st) => {
                    const status = getStoreStatusInLA(st, lang)
                    const active = st.id === currentStore.id
                    return (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => {
                          setSelectedStoreId(st.id)
                          setStoreModalOpen(false)
                        }}
                        className={`w-full text-left p-3 rounded-xl border transition-all flex items-center justify-between cursor-pointer ${
                          active
                            ? 'bg-[#DA291C]/20 border-[#FDC82F] text-white'
                            : 'bg-white/5 border-white/10 text-white/85 hover:bg-white/10'
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-black">{st.name}</span>
                            <span
                              className={`text-[10px] font-bold ${
                                status.isOpen ? 'text-emerald-400' : 'text-amber-400'
                              }`}
                            >
                              ● {status.badgeText}
                            </span>
                          </div>
                          <p className="text-[11px] text-white/60 truncate">{st.address}</p>
                        </div>
                        {active && <Check size={16} className="text-[#FDC82F] shrink-0" />}
                      </button>
                    )
                  })}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* =====================================================================
            MODAL 1: SIGN IN WITH APPLE — iOS NATIVE BOTTOM SHEET (Video 1 @ 02:05)
           ===================================================================== */}
        <AnimatePresence>
          {authSheet === 'apple-sheet' && (
            <motion.div
              key="v2-apple-sheet"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-black/70 backdrop-blur-xs flex flex-col justify-between"
            >
              {/* Top Face ID Dynamic Island Indicator (Matching Video 1 @ 02:05) */}
              <div className={`${!fullscreenNative ? 'pt-14' : 'pt-4'} flex justify-center`}>
                <motion.div
                  initial={{ scale: 0.7, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="w-24 h-24 rounded-3xl bg-black/95 border border-white/15 shadow-2xl flex items-center justify-center"
                >
                  <svg className="w-12 h-12 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M9 10v2M15 10v2M12 10v3.5h-1" strokeLinecap="round" />
                    <path d="M9.5 15.5c1.5 1.3 3.5 1.3 5 0" strokeLinecap="round" />
                  </svg>
                </motion.div>
              </div>

              {/* Bottom iOS Sheet */}
              <motion.div
                initial={{ y: 260 }}
                animate={{ y: 0 }}
                exit={{ y: 260 }}
                transition={{ type: 'spring', damping: 24, stiffness: 220 }}
                className="mx-2 mb-2 rounded-[32px] bg-[#2c2c2e]/95 backdrop-blur-xl border border-white/15 p-5 text-white shadow-2xl"
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-bold tracking-tight">
                    {lang === 'en' ? 'Sign in with Apple' : 'Iniciar sesión con Apple'}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setAuthSheet(null)}
                    className="w-7 h-7 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-white/80 cursor-pointer"
                  >
                    <X size={15} />
                  </button>
                </div>

                <div className="flex items-center gap-3.5 mb-4">
                  <img
                    src="/logo.png"
                    alt="Tacos Gavilan"
                    className="w-12 h-12 rounded-2xl bg-[#50050a] p-1 shrink-0 shadow-md"
                  />
                  <p className="text-xs font-medium text-white/90 leading-snug">
                    {lang === 'en'
                      ? 'Sign in to Tacos Gavilan using your Apple Account.'
                      : 'Inicia sesión en Tacos Gavilan usando tu cuenta de Apple.'}
                  </p>
                </div>

                <div className="p-3.5 rounded-2xl bg-[#1c1c1e] border border-white/10 flex items-center gap-3 mb-5">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#DA291C] to-[#50050a] flex items-center justify-center text-xs font-black text-[#FDC82F] shrink-0">
                    CP
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-white truncate">
                      Roberto Carlos Pedroza Velazquez
                    </p>
                    <p className="text-[11px] text-white/60 truncate">
                      carlos@tacosgavilan.com • Apple ID
                    </p>
                  </div>
                  <Check size={16} className="text-blue-400 shrink-0" />
                </div>

                <div className="flex flex-col items-center">
                  {socialSigningIn ? (
                    <div className="py-2 flex flex-col items-center gap-2">
                      <div className="w-7 h-7 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
                      <span className="text-xs font-medium text-white/80">
                        {lang === 'en' ? 'Signing in...' : 'Iniciando sesión...'}
                      </span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={handleCompleteAppleSignIn}
                      className="px-8 py-2.5 rounded-full bg-[#007AFF] hover:bg-[#0066d6] text-white text-xs font-bold shadow-lg transition-all active:scale-95 cursor-pointer"
                    >
                      {lang === 'en' ? 'Sign In' : 'Iniciar sesión'}
                    </button>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* =====================================================================
            MODAL 2: CONTINUE WITH GOOGLE — ANDROID / GOOGLE ONE-TAP SHEET
           ===================================================================== */}
        <AnimatePresence>
          {authSheet === 'google-sheet' && (
            <motion.div
              key="v2-google-sheet"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-black/75 backdrop-blur-xs flex flex-col justify-end"
            >
              <motion.div
                initial={{ y: 280 }}
                animate={{ y: 0 }}
                exit={{ y: 280 }}
                transition={{ type: 'spring', damping: 24, stiffness: 220 }}
                className="mx-2 mb-2 rounded-[28px] bg-white text-slate-900 p-5 shadow-2xl border border-slate-200"
              >
                <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        fill="#EA4335"
                        d="M12 10.2v3.9h5.5c-.24 1.26-.96 2.33-2.04 3.05l3.3 2.56c1.92-1.77 3.04-4.38 3.04-7.51 0-.72-.06-1.42-.19-2.09H12z"
                      />
                      <path
                        fill="#4285F4"
                        d="M12 22c2.7 0 4.96-.89 6.62-2.42l-3.3-2.56c-.91.61-2.08.98-3.32.98-2.55 0-4.71-1.72-5.48-4.04H3.11v2.64C4.76 19.87 8.11 22 12 22z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M6.52 13.96A5.98 5.98 0 016.2 12c0-.68.12-1.34.32-1.96V7.4H3.11A9.98 9.98 0 002 12c0 1.61.39 3.14 1.11 4.6l3.41-2.64z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 5.98c1.47 0 2.78.51 3.82 1.5l2.86-2.86C16.95 2.99 14.7 2 12 2 8.11 2 4.76 4.13 3.11 7.4l3.41 2.64C7.29 7.7 9.45 5.98 12 5.98z"
                      />
                    </svg>
                    <span className="text-xs font-extrabold text-slate-700">
                      {lang === 'en'
                        ? 'Sign in with Google • Android'
                        : 'Iniciar sesión con Google • Android'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAuthSheet(null)}
                    className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 cursor-pointer"
                  >
                    <X size={15} />
                  </button>
                </div>

                <div className="py-3 flex items-center gap-3">
                  <img src="/logo.png" alt="Tacos Gavilan" className="w-10 h-10 rounded-full shrink-0" />
                  <div>
                    <h4 className="text-sm font-black text-slate-900">
                      {lang === 'en'
                        ? 'Choose an account to continue to Tacos Gavilan'
                        : 'Elige una cuenta para continuar en Tacos Gavilan'}
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      {lang === 'en'
                        ? 'Fast 1-tap login for Android & Google users'
                        : 'Acceso rápido de 1 toque para usuarios Android y Google'}
                    </p>
                  </div>
                </div>

                <div className="space-y-2 my-2">
                  <button
                    type="button"
                    onClick={() => setSelectedGoogleAccount('carlos')}
                    className={`w-full p-3 rounded-xl border text-left flex items-center gap-3 transition-all cursor-pointer ${
                      selectedGoogleAccount === 'carlos'
                        ? 'border-blue-600 bg-blue-50/70'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="w-9 h-9 rounded-full bg-[#50050a] text-[#FDC82F] font-black text-xs flex items-center justify-center shrink-0">
                      CV
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-extrabold text-slate-900 truncate">
                        Carlos Velazquez
                      </p>
                      <p className="text-[11px] text-slate-500 truncate">
                        carlos@tacosgavilan.com
                      </p>
                    </div>
                    {selectedGoogleAccount === 'carlos' && (
                      <Check size={16} className="text-blue-600 shrink-0" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedGoogleAccount('roberto')}
                    className={`w-full p-3 rounded-xl border text-left flex items-center gap-3 transition-all cursor-pointer ${
                      selectedGoogleAccount === 'roberto'
                        ? 'border-blue-600 bg-blue-50/70'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="w-9 h-9 rounded-full bg-blue-600 text-white font-black text-xs flex items-center justify-center shrink-0">
                      RP
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-extrabold text-slate-900 truncate">
                        Roberto Pedroza
                      </p>
                      <p className="text-[11px] text-slate-500 truncate">
                        pedrozaroque@gmail.com
                      </p>
                    </div>
                    {selectedGoogleAccount === 'roberto' && (
                      <Check size={16} className="text-blue-600 shrink-0" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedGoogleAccount('custom')}
                    className={`w-full p-2.5 rounded-xl border text-left flex items-center gap-3 transition-all cursor-pointer ${
                      selectedGoogleAccount === 'custom'
                        ? 'border-blue-600 bg-blue-50/70'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-full bg-slate-200 text-slate-700 font-black text-xs flex items-center justify-center shrink-0">
                      <User size={15} />
                    </div>
                    <span className="text-xs font-bold text-slate-700">
                      {lang === 'en' ? 'Use another Google account' : 'Usar otra cuenta de Google'}
                    </span>
                  </button>

                  {selectedGoogleAccount === 'custom' && (
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                      <input
                        type="text"
                        value={customGoogleName}
                        onChange={(e) => setCustomGoogleName(e.target.value)}
                        placeholder={lang === 'en' ? 'Your Name' : 'Tu Nombre'}
                        className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs font-semibold text-slate-900"
                      />
                      <input
                        type="email"
                        value={customGoogleEmail}
                        onChange={(e) => setCustomGoogleEmail(e.target.value)}
                        placeholder="tu-correo@gmail.com"
                        className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs font-semibold text-slate-900"
                      />
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  disabled={socialSigningIn}
                  onClick={handleCompleteGoogleSignIn}
                  className="mt-2 w-full py-3 rounded-full bg-[#1a73e8] hover:bg-[#1557b0] text-white text-xs font-extrabold shadow-md transition-all active:scale-98 cursor-pointer"
                >
                  {socialSigningIn
                    ? lang === 'en'
                      ? 'Signing in with Google...'
                      : 'Iniciando sesión con Google...'
                    : selectedGoogleAccount === 'roberto'
                    ? lang === 'en'
                      ? 'Continue as Roberto'
                      : 'Continuar como Roberto'
                    : lang === 'en'
                    ? 'Continue as Carlos'
                    : 'Continuar como Carlos'}
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* =====================================================================
            MODAL 3: CONNECT WITH FACEBOOK — OAUTH CONFIRMATION (Video 1 @ 02:06)
           ===================================================================== */}
        <AnimatePresence>
          {authSheet === 'facebook-sheet' && (
            <motion.div
              key="v2-facebook-sheet"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={`absolute inset-0 z-50 bg-white text-slate-900 flex flex-col justify-between px-5 pb-5 ${
                !fullscreenNative ? 'pt-13' : 'pt-5'
              }`}
            >
              <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                <button
                  type="button"
                  onClick={() => setAuthSheet(null)}
                  className="p-1.5 rounded-full hover:bg-slate-100 text-slate-700 cursor-pointer"
                >
                  <X size={18} />
                </button>
                <span className="text-xs font-extrabold text-slate-700">facebook.com</span>
                <div className="w-6" />
              </div>

              <div className="my-auto py-4 space-y-4">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded-full bg-[#1877F2] text-white font-black text-xl flex items-center justify-center">
                    f
                  </div>
                  <img src="/logo.png" alt="Tacos Gavilan" className="w-10 h-10 rounded-full" />
                </div>

                <h3 className="text-base font-black text-slate-900 leading-snug">
                  {lang === 'en'
                    ? 'Tacos Gavilan is requesting access to:'
                    : 'Tacos Gavilan solicita acceso a:'}
                </h3>

                <ul className="space-y-2 text-xs text-slate-700 font-medium pl-2">
                  <li>
                    • {lang === 'en' ? 'Name and profile picture' : 'Nombre y foto del perfil'}
                  </li>
                  <li>
                    • {lang === 'en' ? 'Email address' : 'Dirección de correo electrónico'}
                  </li>
                </ul>

                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#50050a] text-[#FDC82F] font-black text-xs flex items-center justify-center">
                    CP
                  </div>
                  <div>
                    <p className="text-xs font-black text-slate-900">
                      Roque Pedroza Velázquez
                    </p>
                    <p className="text-[11px] text-slate-500">pedrozaroque@gmail.com</p>
                  </div>
                </div>
              </div>

              <div className="space-y-2.5 pb-2">
                <button
                  type="button"
                  onClick={handleCompleteFacebookSignIn}
                  className="w-full py-3 rounded-xl bg-[#1877F2] hover:bg-[#166fe5] text-white font-bold text-xs cursor-pointer"
                >
                  {lang === 'en' ? 'Continue as Carlos' : 'Continuar como Carlos'}
                </button>
                <button
                  type="button"
                  onClick={() => setAuthSheet(null)}
                  className="w-full py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs cursor-pointer"
                >
                  {lang === 'en' ? 'Cancel' : 'Cancelar'}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* =====================================================================
            MODAL 4: "LOG IN" CARD MODAL (Matching Video 1 @ 02:05 Frame v1_80.jpg)
           ===================================================================== */}
        <AnimatePresence>
          {authSheet === 'login' && (
            <motion.div
              key="v2-login-card-modal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={`absolute inset-0 z-50 bg-black/75 backdrop-blur-xs flex flex-col justify-between px-3 pb-5 overflow-y-auto ${
                !fullscreenNative ? 'pt-12' : 'pt-3'
              }`}
            >
              <motion.div
                initial={{ y: 24, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 24, opacity: 0 }}
                className="w-full bg-white text-slate-900 rounded-2xl p-5 shadow-2xl mt-2"
              >
                {/* Header: Back Arrow + Centered "Log In" */}
                <div className="relative flex items-center justify-center mb-5">
                  <button
                    type="button"
                    onClick={() => setAuthSheet(null)}
                    className="absolute left-0 p-1 text-slate-800 hover:text-black cursor-pointer"
                  >
                    <ArrowLeft size={20} />
                  </button>
                  <h3 className="text-sm font-bold text-slate-900">
                    {lang === 'en' ? 'Log In' : 'Iniciar Sesión'}
                  </h3>
                </div>

                {/* Top Social Buttons inside Log In Card */}
                <div className="space-y-2.5">
                  <button
                    type="button"
                    onClick={() => setAuthSheet('apple-sheet')}
                    className="w-full py-2.5 rounded-lg bg-black hover:bg-slate-900 text-white font-semibold text-xs flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                    </svg>
                    <span>{lang === 'en' ? 'Sign in with Apple' : 'Iniciar sesión con Apple'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAuthSheet('google-sheet')}
                    className="w-full py-2.5 rounded-lg bg-white hover:bg-slate-50 text-slate-800 font-semibold text-xs border border-slate-300 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        fill="#EA4335"
                        d="M12 10.2v3.9h5.5c-.24 1.26-.96 2.33-2.04 3.05l3.3 2.56c1.92-1.77 3.04-4.38 3.04-7.51 0-.72-.06-1.42-.19-2.09H12z"
                      />
                      <path
                        fill="#4285F4"
                        d="M12 22c2.7 0 4.96-.89 6.62-2.42l-3.3-2.56c-.91.61-2.08.98-3.32.98-2.55 0-4.71-1.72-5.48-4.04H3.11v2.64C4.76 19.87 8.11 22 12 22z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M6.52 13.96A5.98 5.98 0 016.2 12c0-.68.12-1.34.32-1.96V7.4H3.11A9.98 9.98 0 002 12c0 1.61.39 3.14 1.11 4.6l3.41-2.64z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 5.98c1.47 0 2.78.51 3.82 1.5l2.86-2.86C16.95 2.99 14.7 2 12 2 8.11 2 4.76 4.13 3.11 7.4l3.41 2.64C7.29 7.7 9.45 5.98 12 5.98z"
                      />
                    </svg>
                    <span>
                      {lang === 'en'
                        ? 'Continue with Google (Android)'
                        : 'Continuar con Google (Android)'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAuthSheet('facebook-sheet')}
                    className="w-full py-2.5 rounded-lg bg-white hover:bg-slate-50 text-slate-800 font-semibold text-xs border border-slate-300 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span className="w-3.5 h-3.5 rounded-xs bg-[#1877F2] text-white inline-flex items-center justify-center font-black text-[10px] leading-none">
                      f
                    </span>
                    <span>
                      {lang === 'en' ? 'Connect with Facebook' : 'Conectar con Facebook'}
                    </span>
                  </button>
                </div>

                <div className="my-4 text-center text-xs font-semibold text-slate-500">
                  {lang === 'en' ? 'Or' : 'O'}
                </div>

                {authError && (
                  <div className="mb-3 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs font-semibold text-red-700">
                    {authError}
                  </div>
                )}

                <form id="v2-login-form" onSubmit={handleEmailLoginSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {lang === 'en' ? 'Email' : 'Correo electrónico'}
                    </label>
                    <input
                      type="email"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      placeholder="carlos@tacosgavilan.com"
                      className="w-full pb-1.5 border-b-2 border-slate-300 focus:border-[#DA291C] text-xs font-semibold text-slate-900 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {lang === 'en' ? 'Password' : 'Contraseña'}
                    </label>
                    <div className="relative">
                      <input
                        type={showLoginPassword ? 'text' : 'password'}
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        placeholder="••••••••••••"
                        className="w-full pb-1.5 pr-8 border-b-2 border-slate-300 focus:border-[#DA291C] text-xs font-semibold text-slate-900 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowLoginPassword((v) => !v)}
                        className="absolute right-0 bottom-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
                      >
                        {showLoginPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                    <p className="mt-1 text-[10px] italic text-slate-500">
                      {lang === 'en'
                        ? 'Must contain at least 8 characters'
                        : 'Debe contener al menos 8 caracteres'}
                    </p>
                  </div>

                  <div className="pt-2 space-y-2">
                    <button
                      type="button"
                      onClick={() => {
                        setForgotResetSent(false)
                        setAuthSheet('forgot-password')
                      }}
                      className="w-full py-2.5 rounded-lg border border-slate-300 hover:bg-slate-50 text-xs font-bold text-slate-800 cursor-pointer"
                    >
                      {lang === 'en' ? 'Forgot Password' : '¿Olvidaste tu contraseña?'}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setOtpStep(1)
                        setAuthError(null)
                        setAuthSheet('sms-otp')
                      }}
                      className="w-full py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] font-bold text-[#9E1B12] flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Smartphone size={13} />
                      <span>
                        {lang === 'en'
                          ? 'Prefer SMS Code? Sign in with phone'
                          : '¿Prefieres código SMS? Entra con tu celular'}
                      </span>
                    </button>
                  </div>
                </form>
              </motion.div>

              {/* Bottom Full-Width LOG IN Action Button */}
              <button
                type="submit"
                form="v2-login-form"
                className="w-full py-3.5 rounded-xl bg-[#DA291C] hover:bg-[#b81d13] text-white font-black text-xs uppercase tracking-widest shadow-xl cursor-pointer"
              >
                {lang === 'en' ? 'Log In' : 'Iniciar Sesión'}
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* =====================================================================
            MODAL 5: "SIGN UP" WARM CREAM CARD MODAL (Video 1 & 2 @ Sign Up)
            Includes Real-Time Password/Phone Validation + Privacy/Terms Switch
           ===================================================================== */}
        <AnimatePresence>
          {authSheet === 'signup' && (
            <motion.div
              key="v2-signup-card-modal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={`absolute inset-0 z-50 bg-black/80 backdrop-blur-xs flex flex-col justify-between px-3 pb-5 overflow-y-auto no-scrollbar ${
                !fullscreenNative ? 'pt-12' : 'pt-3'
              }`}
            >
              <motion.div
                initial={{ y: 24, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 24, opacity: 0 }}
                className="w-full bg-[#F7EFEA] text-slate-900 rounded-2xl p-4 shadow-2xl max-h-[85%] overflow-y-auto"
              >
                {/* Header: Back Arrow + Centered "Sign Up" */}
                <div className="relative flex items-center justify-center mb-3">
                  <button
                    type="button"
                    onClick={() => setAuthSheet(null)}
                    className="absolute left-0 p-1 text-slate-800 hover:text-black cursor-pointer"
                  >
                    <ArrowLeft size={19} />
                  </button>
                  <h3 className="text-xs font-bold text-slate-900">
                    {lang === 'en' ? 'Sign Up' : 'Crear Cuenta'}
                  </h3>
                </div>

                {/* Top Social Sign-Up Buttons (Apple iOS + Google Android + Facebook) */}
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setAuthSheet('apple-sheet')}
                    className="w-full py-2.5 rounded-lg bg-black hover:bg-slate-900 text-white font-semibold text-xs flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                    </svg>
                    <span>{lang === 'en' ? 'Sign up with Apple' : 'Registrarse con Apple'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAuthSheet('google-sheet')}
                    className="w-full py-2 rounded-lg bg-white hover:bg-slate-50 text-slate-900 font-bold text-[11px] uppercase tracking-wider border border-slate-800 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        fill="#EA4335"
                        d="M12 10.2v3.9h5.5c-.24 1.26-.96 2.33-2.04 3.05l3.3 2.56c1.92-1.77 3.04-4.38 3.04-7.51 0-.72-.06-1.42-.19-2.09H12z"
                      />
                      <path
                        fill="#4285F4"
                        d="M12 22c2.7 0 4.96-.89 6.62-2.42l-3.3-2.56c-.91.61-2.08.98-3.32.98-2.55 0-4.71-1.72-5.48-4.04H3.11v2.64C4.76 19.87 8.11 22 12 22z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M6.52 13.96A5.98 5.98 0 016.2 12c0-.68.12-1.34.32-1.96V7.4H3.11A9.98 9.98 0 002 12c0 1.61.39 3.14 1.11 4.6l3.41-2.64z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 5.98c1.47 0 2.78.51 3.82 1.5l2.86-2.86C16.95 2.99 14.7 2 12 2 8.11 2 4.76 4.13 3.11 7.4l3.41 2.64C7.29 7.7 9.45 5.98 12 5.98z"
                      />
                    </svg>
                    <span>
                      {lang === 'en'
                        ? 'SIGN UP WITH GOOGLE (ANDROID)'
                        : 'REGISTRARSE CON GOOGLE (ANDROID)'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAuthSheet('facebook-sheet')}
                    className="w-full py-2 rounded-lg bg-transparent hover:bg-black/5 text-slate-900 font-bold text-[11px] uppercase tracking-wider border border-slate-800 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span className="w-3.5 h-3.5 rounded-xs bg-[#1877F2] text-white inline-flex items-center justify-center font-black text-[10px] leading-none">
                      f
                    </span>
                    <span>
                      {lang === 'en' ? 'CONNECT WITH FACEBOOK' : 'CONECTAR CON FACEBOOK'}
                    </span>
                  </button>
                </div>

                <div className="my-2.5 text-center text-xs font-semibold text-slate-600">
                  {lang === 'en' ? 'Or' : 'O'}
                </div>

                {authError && (
                  <div className="mb-2.5 p-2 rounded-lg bg-red-100 border border-red-300 text-[11px] font-bold text-red-800">
                    {authError}
                  </div>
                )}

                {/* Complete Registration Form Matching Video 2 (02:14 - 02:15) */}
                <form id="v2-signup-form" onSubmit={handleSignupSubmit} className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700">
                      {lang === 'en' ? 'First Name' : 'Nombre'}
                    </label>
                    <input
                      type="text"
                      value={signupFirstName}
                      onChange={(e) => setSignupFirstName(e.target.value)}
                      className="w-full py-1 bg-transparent border-b border-slate-300 focus:border-[#DA291C] text-xs font-semibold text-slate-900 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700">
                      {lang === 'en' ? 'Last Name' : 'Apellido'}
                    </label>
                    <input
                      type="text"
                      value={signupLastName}
                      onChange={(e) => setSignupLastName(e.target.value)}
                      className="w-full py-1 bg-transparent border-b border-slate-300 focus:border-[#DA291C] text-xs font-semibold text-slate-900 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700">
                      {lang === 'en' ? 'Email' : 'Correo electrónico'}
                    </label>
                    <input
                      type="email"
                      value={signupEmail}
                      onChange={(e) => setSignupEmail(e.target.value)}
                      className="w-full py-1 bg-transparent border-b border-slate-300 focus:border-[#DA291C] text-xs font-semibold text-slate-900 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700">
                      {lang === 'en' ? 'Password' : 'Contraseña'}
                    </label>
                    <div className="relative">
                      <input
                        type={showSignupPassword ? 'text' : 'password'}
                        value={signupPassword}
                        onChange={(e) => setSignupPassword(e.target.value)}
                        className={`w-full py-1 pr-7 bg-transparent border-b text-xs font-semibold text-slate-900 focus:outline-none ${
                          signupPasswordIssue
                            ? 'border-red-600'
                            : 'border-slate-300 focus:border-[#DA291C]'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowSignupPassword((v) => !v)}
                        className="absolute right-0 bottom-1 text-[#DA291C] cursor-pointer"
                      >
                        {showSignupPassword ? <Eye size={15} /> : <EyeOff size={15} />}
                      </button>
                    </div>
                    {signupPasswordIssue ? (
                      <p className="mt-0.5 text-[10px] italic font-semibold text-red-600">
                        {signupPasswordIssue}
                      </p>
                    ) : (
                      <p className="mt-0.5 text-[10px] italic text-slate-600 leading-tight">
                        {lang === 'en'
                          ? 'Must contain at least 8 characters, and should contain numbers and special characters'
                          : 'Debe contener al menos 8 caracteres, e incluir números y caracteres especiales'}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700">
                      {lang === 'en'
                        ? 'Birthdate (birthday surprise)'
                        : 'Fecha de nacimiento (sorpresa de cumpleaños)'}
                    </label>
                    <input
                      type="text"
                      value={signupBirthdate}
                      onChange={(e) => setSignupBirthdate(e.target.value)}
                      placeholder="MM/DD/YYYY"
                      className="w-full py-1 bg-transparent border-b border-slate-300 focus:border-[#DA291C] text-xs font-semibold text-slate-900 focus:outline-none"
                    />
                    <span className="text-[10px] italic text-slate-500">
                      {lang === 'en' ? 'Optional' : 'Opcional'}
                    </span>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700">
                      {lang === 'en' ? 'Phone Number' : 'Número de teléfono'}
                    </label>
                    <input
                      type="tel"
                      value={signupPhone}
                      onChange={(e) => setSignupPhone(formatUsPhoneInput(e.target.value))}
                      placeholder="(424) 319-5013"
                      className={`w-full py-1 bg-transparent border-b text-xs font-semibold text-slate-900 focus:outline-none ${
                        signupPhoneConflict
                          ? 'border-red-600'
                          : 'border-slate-300 focus:border-[#DA291C]'
                      }`}
                    />
                    {signupPhoneConflict ? (
                      <p className="mt-0.5 text-[10px] italic font-semibold text-red-600">
                        {signupPhoneConflict}
                      </p>
                    ) : (
                      <span className="text-[10px] italic text-slate-500">
                        {lang === 'en' ? 'Optional' : 'Opcional'}
                      </span>
                    )}
                  </div>

                  {/* Privacy Policy & Terms Toggle Switch (Video 2 @ 02:15) */}
                  <div className="pt-1 flex items-center justify-between gap-3">
                    <p className="text-[10px] text-slate-700 leading-snug">
                      {lang === 'en' ? (
                        <>
                          By using the Tacos Gavilan app you agree to the{' '}
                          <a href="/app/privacy" target="_blank" rel="noreferrer" className="underline font-bold">
                            Privacy Policy
                          </a>{' '}
                          and the{' '}
                          <a href="/app/terms" target="_blank" rel="noreferrer" className="underline font-bold">
                            Terms & Conditions
                          </a>
                          .
                        </>
                      ) : (
                        <>
                          Al usar la app de Tacos Gavilan aceptas la{' '}
                          <a href="/app/privacy" target="_blank" rel="noreferrer" className="underline font-bold">
                            Política de Privacidad
                          </a>{' '}
                          y los{' '}
                          <a href="/app/terms" target="_blank" rel="noreferrer" className="underline font-bold">
                            Términos y Condiciones
                          </a>
                          .
                        </>
                      )}
                    </p>
                    <button
                      type="button"
                      onClick={() => setAgreedTerms((v) => !v)}
                      aria-label="Agree to terms"
                      className={`w-11 h-6 rounded-full p-0.5 transition-colors shrink-0 cursor-pointer ${
                        agreedTerms ? 'bg-[#DA291C]' : 'bg-slate-300'
                      }`}
                    >
                      <div
                        className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${
                          agreedTerms ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </form>
              </motion.div>

              {/* Bottom Full-Width CREATE ACCOUNT Button */}
              <button
                type="submit"
                form="v2-signup-form"
                className="w-full py-3.5 rounded-xl bg-[#DA291C] hover:bg-[#b81d13] text-white font-black text-xs uppercase tracking-widest shadow-xl cursor-pointer mt-2"
              >
                {lang === 'en' ? 'CREATE ACCOUNT' : 'CREAR CUENTA'}
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* =====================================================================
            MODAL 6: "EMAIL VERIFICATION" SCREEN + PUSH NOTIFICATION BANNER
            (Matching Video 2 @ 02:15 Frame v2_175.jpg & v2_sheet_03.jpg)
           ===================================================================== */}
        <AnimatePresence>
          {authSheet === 'verify-email' && (
            <motion.div
              key="v2-verify-email-modal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={`absolute inset-0 z-50 bg-black/80 backdrop-blur-xs flex flex-col justify-start px-3 pb-3 ${
                !fullscreenNative ? 'pt-12' : 'pt-3'
              }`}
            >
              {/* Simulated Incoming Email Push Notification Banner (Video 2 @ 02:15) */}
              <AnimatePresence>
                {emailBannerVisible && (
                  <motion.button
                    type="button"
                    initial={{ y: -80, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -80, opacity: 0 }}
                    onClick={handleConfirmEmailLink}
                    className="w-full mb-2.5 p-3 rounded-2xl bg-[#2c2c2e]/95 border border-white/20 text-left text-white shadow-2xl flex items-center gap-3 cursor-pointer hover:bg-[#3a3a3c]"
                  >
                    <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shrink-0 shadow">
                      <Mail size={20} className="text-[#DA291C]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-black text-white">
                          Tacos Gavilan Account
                        </span>
                        <span className="text-[10px] text-white/60">
                          {lang === 'en' ? 'now' : 'ahora'}
                        </span>
                      </div>
                      <p className="text-[11px] font-bold text-[#FDC82F] truncate">
                        {lang === 'en'
                          ? 'Account Confirmation — Tap here to verify!'
                          : 'Confirmación de Cuenta — ¡Toca aquí para verificar!'}
                      </p>
                      <p className="text-[10px] text-white/80 truncate">
                        {lang === 'en'
                          ? `Hi ${signupFirstName || 'Carlos'}, welcome to Tacos Gavilan!`
                          : `¡Hola ${signupFirstName || 'Carlos'}, bienvenido a Tacos Gavilan!`}
                      </p>
                    </div>
                  </motion.button>
                )}
              </AnimatePresence>

              {/* Email Verification White Card (Frame v2_175.jpg) */}
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="w-full bg-white text-slate-900 rounded-2xl p-5 shadow-2xl"
              >
                <div className="relative flex items-center justify-center mb-6">
                  <button
                    type="button"
                    onClick={() => setAuthSheet('signup')}
                    className="absolute left-0 p-1 text-slate-800 hover:text-black cursor-pointer"
                  >
                    <ArrowLeft size={20} />
                  </button>
                  <h3 className="text-xs font-bold text-slate-900">
                    {lang === 'en' ? 'Email Verification' : 'Verificación de Correo'}
                  </h3>
                </div>

                {/* Envelope with "HEY!" Flap Illustration (Matching Frame v2_175.jpg) */}
                <div className="my-5 flex flex-col items-center">
                  <div className="relative w-20 h-20 rounded-2xl bg-red-50 border-2 border-[#DA291C]/30 flex flex-col items-center justify-center shadow-md">
                    <span className="px-2 py-0.5 rounded bg-[#50050a] text-[#FDC82F] text-[10px] font-black uppercase tracking-wider -rotate-6 shadow">
                      {lang === 'en' ? 'HEY!' : '¡HOLA!'}
                    </span>
                    <Mail size={28} className="text-[#DA291C] mt-1" />
                  </div>
                </div>

                <div className="text-center space-y-3 px-2">
                  <p className="text-xs text-slate-700 leading-relaxed">
                    {lang === 'en' ? (
                      <>
                        We sent an email to{' '}
                        <span className="font-bold text-slate-900">
                          {signupEmail || 'carlos@tacosgavilan.com'}
                        </span>{' '}
                        to make sure it is you.
                      </>
                    ) : (
                      <>
                        Enviamos un correo a{' '}
                        <span className="font-bold text-slate-900">
                          {signupEmail || 'carlos@tacosgavilan.com'}
                        </span>{' '}
                        para confirmar tu identidad.
                      </>
                    )}
                  </p>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {lang === 'en'
                      ? 'Click the link in your email to start using the app!'
                      : '¡Toca el enlace de confirmación para empezar a usar la app!'}
                  </p>
                </div>

                {emailResentNotice && (
                  <p className="mt-3 text-center text-[11px] font-bold text-emerald-600">
                    {lang === 'en'
                      ? 'Verification email resent!'
                      : '¡Correo de verificación reenviado!'}
                  </p>
                )}

                <div className="mt-6 space-y-2.5">
                  <button
                    type="button"
                    onClick={handleConfirmEmailLink}
                    className="w-full py-3 rounded-lg bg-[#DA291C] hover:bg-[#b81d13] text-white text-xs font-black uppercase tracking-wider shadow cursor-pointer"
                  >
                    {lang === 'en'
                      ? 'Confirm Email & Enter App Now'
                      : 'Confirmar Correo y Entrar Ahora'}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setEmailResentNotice(true)
                      setEmailBannerVisible(true)
                    }}
                    className="w-full py-2.5 rounded-lg border border-slate-300 hover:bg-slate-50 text-xs font-bold text-slate-800 cursor-pointer"
                  >
                    {lang === 'en' ? 'Resend Email' : 'Reenviar Correo'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* =====================================================================
            MODAL 7: FORGOT PASSWORD & CONTACT SUPPORT MODALS
           ===================================================================== */}
        <AnimatePresence>
          {(authSheet === 'forgot-password' || authSheet === 'contact-support') && (
            <motion.div
              key="v2-help-modal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4"
            >
              <div className="w-full bg-white text-slate-900 rounded-2xl p-5 shadow-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-black uppercase text-slate-900">
                    {authSheet === 'forgot-password'
                      ? lang === 'en'
                        ? 'Reset Password'
                        : 'Recuperar Contraseña'
                      : lang === 'en'
                      ? 'Tacos Gavilan Support'
                      : 'Soporte Tacos Gavilan'}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setAuthSheet(null)}
                    className="p-1 rounded-full bg-slate-100 text-slate-700 cursor-pointer"
                  >
                    <X size={15} />
                  </button>
                </div>

                {authSheet === 'forgot-password' ? (
                  <>
                    <p className="text-xs text-slate-600">
                      {lang === 'en'
                        ? 'Enter your email and we will send you a password reset link.'
                        : 'Ingresa tu correo y te enviaremos un enlace para restablecer tu contraseña.'}
                    </p>
                    <input
                      type="email"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-xs font-semibold"
                    />
                    {forgotResetSent && (
                      <p className="text-xs font-bold text-emerald-600">
                        {lang === 'en'
                          ? 'Reset instructions sent to your email!'
                          : '¡Instrucciones enviadas a tu correo!'}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => setForgotResetSent(true)}
                      className="w-full py-3 rounded-xl bg-[#DA291C] text-white text-xs font-black uppercase cursor-pointer"
                    >
                      {lang === 'en' ? 'Send Reset Link' : 'Enviar Enlace'}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      {lang === 'en'
                        ? 'Need help recovering your account or checking how you registered? Call your nearest Tacos Gavilan store or sign in with SMS.'
                        : '¿Necesitas ayuda para recuperar tu cuenta o recordar cómo te registraste? Inicia sesión con código SMS o contáctanos.'}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setOtpStep(1)
                        setAuthSheet('sms-otp')
                      }}
                      className="w-full py-3 rounded-xl bg-[#DA291C] text-white text-xs font-black uppercase cursor-pointer"
                    >
                      {lang === 'en' ? 'Sign In via SMS Code' : 'Entrar con Código SMS'}
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* =====================================================================
            MODAL 8: SMS OTP AUTH MODAL (Connected to /api/mobile/auth/send-otp & verify-otp)
           ===================================================================== */}
        <AnimatePresence>
          {authSheet === 'sms-otp' && (
            <motion.div
              key="v2-auth-modal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-5"
            >
              <motion.div
                initial={{ scale: 0.92, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.92, opacity: 0 }}
                className="w-full bg-[#1c1c1e] rounded-3xl border border-white/15 p-5 shadow-2xl"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <img src="/logo.png" alt="Logo" className="w-9 h-9 rounded-full" />
                    <div>
                      <h3 className="text-sm font-black uppercase text-white">
                        {lang === 'en' ? 'Sign In with SMS' : 'Entrar con Código SMS'}
                      </h3>
                      <p className="text-[11px] text-white/60">Tacos Gavilan SMS Pass</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAuthSheet(null)}
                    className="p-1.5 rounded-full bg-white/10 text-white cursor-pointer"
                  >
                    <X size={15} />
                  </button>
                </div>

                {authError && (
                  <div className="mb-3 p-2.5 rounded-xl bg-red-500/20 border border-red-500/40 text-xs font-bold text-red-200">
                    {authError}
                  </div>
                )}

                {otpStep === 1 ? (
                  <form onSubmit={handleSendOtp} className="space-y-3">
                    <div>
                      <label className="block text-[11px] font-bold text-white/75 mb-1">
                        {lang === 'en' ? 'Mobile Phone (10 digits)' : 'Teléfono Celular (10 dígitos)'}
                      </label>
                      <input
                        type="tel"
                        value={phoneInput}
                        onChange={(e) => setPhoneInput(e.target.value)}
                        placeholder="(323) 555-0199"
                        className="w-full px-3.5 py-3 rounded-xl bg-black/60 border border-white/20 text-white text-sm font-bold focus:outline-none focus:border-[#FDC82F]"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={authLoading}
                      className="w-full py-3.5 rounded-xl bg-[#DA291C] hover:bg-[#b81d13] text-white font-black text-xs uppercase tracking-widest cursor-pointer"
                    >
                      {authLoading
                        ? lang === 'en'
                          ? 'Sending SMS...'
                          : 'Enviando SMS...'
                        : lang === 'en'
                        ? 'Send 6-Digit SMS Code'
                        : 'Enviar Código SMS de 6 Dígitos'}
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleVerifyOtp} className="space-y-3">
                    <div>
                      <label className="block text-[11px] font-bold text-white/75 mb-1">
                        {lang === 'en' ? '6-Digit Verification Code' : 'Código de Verificación (6 dígitos)'}
                      </label>
                      <input
                        type="text"
                        maxLength={6}
                        value={otpInput}
                        onChange={(e) => setOtpInput(e.target.value)}
                        placeholder="123456"
                        className="w-full px-3.5 py-3 rounded-xl bg-black/60 border border-white/20 text-white text-center tracking-[0.4em] text-base font-black focus:outline-none focus:border-[#FDC82F]"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={authLoading}
                      className="w-full py-3.5 rounded-xl bg-[#FDC82F] text-[#121212] font-black text-xs uppercase tracking-widest cursor-pointer"
                    >
                      {authLoading
                        ? lang === 'en'
                          ? 'Verifying...'
                          : 'Verificando...'
                        : lang === 'en'
                        ? 'Verify & Enter'
                        : 'Verificar y Entrar'}
                    </button>
                  </form>
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* =====================================================================
            MODAL 9: MEMBER QR FAST-PASS MODAL (When tapping top-right QR on Home)
           ===================================================================== */}
        <AnimatePresence>
          {qrModalOpen && (
            <motion.div
              key="v2-member-qr-modal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-5"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="w-full bg-white text-slate-900 rounded-3xl p-6 shadow-2xl flex flex-col items-center text-center relative"
              >
                <button
                  type="button"
                  onClick={() => setQrModalOpen(false)}
                  className="absolute right-4 top-4 p-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer"
                >
                  <X size={16} />
                </button>
                <img src="/logo.png" alt="Tacos Gavilan" className="w-14 h-14 rounded-full mb-2 shadow" />
                <span className="text-[10px] font-black uppercase tracking-widest text-[#DA291C]">
                  TACOS GAVILAN FAST PASS
                </span>
                <h3 className="text-lg font-black uppercase text-slate-900 mt-0.5">
                  {loggedUser ? `${loggedUser.firstName} ${loggedUser.lastName}` : 'Carlos Velazquez'}
                </h3>
                <div className="my-4 p-4 rounded-2xl bg-slate-950 border-2 border-[#FDC82F] shadow-xl">
                  <QrCode size={148} className="text-white" strokeWidth={1.5} />
                </div>
                <p className="text-xs font-semibold text-slate-600 max-w-[240px]">
                  {lang === 'en'
                    ? 'Scan this code at the counter to identify your account and pick up your order faster.'
                    : 'Escanea este código en mostrador para identificar tu cuenta y recoger tu pedido más rápido.'}
                </p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bottom iOS Home Indicator Bar */}
        {!fullscreenNative && (
          <div className="absolute bottom-1.5 inset-x-0 z-[75] pointer-events-none flex justify-center">
            <div className="w-[126px] h-[4.5px] rounded-full bg-white/40 shadow-xs" />
          </div>
        )}
      </div>
    </div>
  )
}
