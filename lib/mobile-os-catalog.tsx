/**
 * @module lib/mobile-os-catalog
 * @description Catálogo oficial de módulos, grupos departamentales no editables, temas visuales OS,
 *              utilidades de permisos por rol y hook reactivo `useMobileDockPreferences` para la
 *              experiencia Mobile & Tablet OS (`< lg`, `< 1024px`) de Tacos Gavilan.
 *
 * @businessRules
 * - Conserva paridad 1:1 con los 6 grupos oficiales no editables (`analisis`, `operaciones`,
 *   `inventario`, `equipo`, `finanzas`, `gestion`) y los 49 módulos de `app/inicio/page.tsx`.
 * - Normaliza alias de rol (`gerente` -> `manager`, `regional_manager` -> `supervisor`,
 *   `assistant` -> `asistente`, `administrador` -> `admin`) y reglas especiales de acceso:
 *   * `vikesh@tacosgavilan.com`: sin acceso a `inventario`, `/ventas`, `/ventas/reportes` ni `financialPulse`.
 *   * `stephany@cingularhr.com` / `planificador`: acceso exclusivo a `/planificador` (`canCustomizeDock: false`).
 *   * `basecamp`: acceso exclusivo a `/basecamp` (`canCustomizeDock: false`).
 *   * `employee`: acceso exclusivo a `/mis-horarios` (`canCustomizeDock: false`).
 *   * `/admin/contabilidad-externa`: restringido exclusivamente a Raquel, Roberto y Roque (`id` 45, 46, 47).
 * - La barra inferior editable (`BottomTabBar` OS Dock) mantiene `Inicio` (`/inicio`) fijo a la izquierda
 *   y `Más` (`__drawer__`) fijo a la derecha, permitiendo entre `1` y `4` accesos directos editables en medio.
 * - Soporta alternancia instantánea y persistente entre `homeViewMode: 'os'` (Pantalla tipo Sistema Operativo)
 *   y `homeViewMode: 'web'` (Vista Web clásica de tarjetas) por usuario.
 * - Regla laboral `America/Los_Angeles`: día operativo de `06:00 AM` a `05:59 AM` del día siguiente;
 *   turno `AM` de `06:00` a `16:59`, turno `PM` de `17:00` a `05:59`.
 *
 * @dataFlow
 * - Lectura instantánea libre de efectos (`useSyncExternalStore`) sobre `localStorage` por usuario
 *   (`teg_mobile_dock_v1:<userKey>` y `teg_mobile_home_mode_v1:<userKey>`) sincronizada en vivo entre
 *   componentes mediante `CustomEvent(DOCK_UPDATED_EVENT)`.
 * - Hidratación asíncrona y persistencia remota mediante `GET` / `PUT /api/mobile-os/preferences`
 *   contra `public.user_ui_preferences` en Supabase (`teg-tacos-gavilan`).
 *
 * @notes
 * - Diseñado con cero `@typescript-eslint/no-explicit-any` y cero `react-hooks/set-state-in-effect`.
 * - `sanitizeDockModuleIds` resuelve de forma bidireccional alias en español/inglés (`inspecciones` <-> `supervisor`,
 *   `ventas` <-> `sales`, `planificador` <-> `planner`, `checklists_manager` <-> `manager`,
 *   `checklists_asistentes` <-> `assistants`, `mis_horarios` <-> `my_schedule`) manteniendo IDs canónicos 1:1 con Desktop.
 */

'use client'

import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  BarChart3,
  Bell,
  Briefcase,
  Calculator,
  Calendar,
  CalendarCheck,
  Car,
  ChefHat,
  CheckSquare,
  ClipboardList,
  Clock,
  DollarSign,
  FileEdit,
  Globe,
  LayoutDashboard,
  MessageSquare,
  Monitor,
  Package,
  PhoneCall,
  QrCode,
  Receipt,
  Shield,
  ShieldCheck,
  Shirt,
  Smartphone,
  Sparkles,
  Store,
  Timer,
  TrendingUp,
  Truck,
  UserCheck,
  UserCog,
  Users,
  Wrench,
  Zap,
} from 'lucide-react'

export type OSGroupId =
  | 'analisis'
  | 'operaciones'
  | 'inventario'
  | 'equipo'
  | 'finanzas'
  | 'gestion'

export type MobileHomeViewMode = 'os' | 'web'

export interface OSUserLike {
  id?: number | string | null
  email?: string | null
  name?: string | null
  role?: string | null
  user_role?: string | null
  user_type?: string | null
  store_id?: string | number | null
  store_ids?: string[] | null
  store_scope?: string[] | string | null
}

export interface NormalizedOSUserRole {
  userRole: string
  userEmailNorm: string
  isPlanificadorOnly: boolean
  isBasecampOnly: boolean
  isEmployeeOnly: boolean
  isVikesh: boolean
  canCustomizeDock: boolean
  canViewFinancialPulse: boolean
  canAccessExternalAccounting: boolean
}

export interface OSModuleItem {
  id: string
  title: string
  shortTitle: string
  description: string
  path: string
  groupId: OSGroupId
  appTileBg: string
  iconColorClass: string
  renderIcon: (size?: number) => React.ReactNode
  roles: string[]
  openInNewTab?: boolean
  badgeType?: 'new' | 'building' | 'beta'
  badgeLabel?: string
  isPrimaryDashboard?: boolean
}

export interface OSModuleGroup {
  id: OSGroupId
  title: string
  subtitle: string
  renderGroupIcon: (size?: number) => React.ReactNode
  items: OSModuleItem[]
}

export interface OSSectionTheme {
  headerIconBg: string
  headerIconColor: string
  borderHover: string
  badgeBg: string
  pillActive: string
  sectionBorder: string
  activeIcon: string
  activeBg: string
  activeText: string
  indicatorColor: string
  folderSurface: string
  folderBorder: string
  squircleGradient: string
  accentGlow: string
}

export interface MobileOSFinancialPulse {
  netSales: number
  orderCount: number
  avgTicket: number
  laborPct: number
  foodCostPct: number
  reportingStores: number
  isLiveToday: boolean
  effectiveDate: string
}

export interface MobileOSNextShift {
  date: string
  startTime: string
  endTime: string
  storeName: string | null
  shiftLabel: string | null
  formattedRange: string
}

export interface MobileOSOperationsPulse {
  inspectionsToday: number
  managerChecklistsToday: number
  staffChecklistsToday: number
  shiftsToday: number
  storeScopeLabel: string
  myNextShift: MobileOSNextShift | null
  primaryActionPath: string
  secondaryActionPath: string
}

export interface MobileOSSummaryResponse {
  businessDate: string
  shiftPeriod: 'AM' | 'PM'
  laTimeLabel: string
  role: string
  storeScopeLabel: string
  financialPulse: MobileOSFinancialPulse | null
  operationsPulse: MobileOSOperationsPulse
}

export const DOCK_MIN_EDITABLE_SLOTS = 1
export const DOCK_MAX_EDITABLE_SLOTS = 4
export const DOCK_UPDATED_EVENT = 'teg:dock-updated'
export const DOCK_OPEN_EDITOR_EVENT = 'teg:open-dock-editor'
export const STANDALONE_SIBLING_PATHS: readonly string[] = ['/ventas/reportes']
export const FAVORITES_STORAGE_KEY = 'teg_favorite_modules_v1'

const DOCK_STORAGE_PREFIX = 'teg_mobile_dock_v1:'
const HOME_MODE_STORAGE_PREFIX = 'teg_mobile_home_mode_v1:'

const MODULE_ID_ALIASES: Readonly<Record<string, string>> = {
  inspecciones: 'supervisor',
  supervisor: 'inspecciones',
  ventas: 'sales',
  sales: 'ventas',
  planificador: 'planner',
  planner: 'planificador',
  checklists_manager: 'manager',
  manager: 'checklists_manager',
  checklists_asistentes: 'assistants',
  assistants: 'checklists_asistentes',
  mis_horarios: 'my_schedule',
  my_schedule: 'mis_horarios',
}

export const BasecampIcon = ({ size = 20 }: { size?: number }) => (
  <svg
    viewBox="0 0 512 512"
    width={size}
    height={size}
    fill="currentColor"
    style={{ flexShrink: 0 }}
    aria-hidden="true"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M111.962 57.729C155.189 19.34 206.449 0 265.307 0c77.361 0 133.713 49.448 171.582 113.692 37.866 64.24 57.6 143.773 61.686 205.326a26.662 26.662 0 01-3.283 14.894l-.012.028-.016.025c-36.169 62.105-118.272 96.008-229.939 96.011-80.188 1.053-156.884-32.74-210.199-92.613a25.471 25.471 0 01-4.943-25.924c7.15-19.237 20.547-51.324 38.335-78.688 8.892-13.679 18.959-26.299 29.988-35.543 11.026-9.24 23.224-15.276 36.306-15.348h.016c13.181 0 24.573 5.25 34.449 12.345 9.657 6.937 18.057 15.784 25.377 23.491l.444.471.025.024a169.12 169.12 0 0013.322 13.212 392.206 392.206 0 0049.68-83.351l.039-.092.05-.091c6.327-12.016 20.971-16.961 33.293-11.242 12.324 5.718 17.991 20.089 12.892 32.673l-.026.07-.032.066c-26.677 57.123-47.287 86.004-62.615 100.621-7.688 7.334-14.109 11.141-19.363 13.083-5.294 1.959-9.228 1.959-11.664 1.959-11.174 0-20.703-4.308-29.181-10.435-8.312-6.007-15.793-13.897-22.916-21.409l-.301-.317c-3.271-3.468-8.227-8.715-12.998-13.091-2.39-2.194-4.666-4.105-6.614-5.45-.973-.673-1.807-1.166-2.486-1.478a5.54 5.54 0 00-.806-.31c-.048-.013-.091-.022-.128-.03-.8.211-1.931.762-3.402 1.858-1.635 1.218-3.501 2.964-5.563 5.229-4.12 4.526-8.817 10.903-13.77 18.655-9.628 15.064-20.054 35.063-28.896 56.107a223.491 223.491 0 00161.61 64.325h.059c88.439 0 153.567-23.975 181.811-64.431-5.026-55.783-22.994-121.651-53.471-173.599-30.694-52.325-73.656-89.898-128.34-89.898-93.402 0-164.264 65.12-210.272 194.986l-.029.08-.034.079c-5.254 12.403-19.257 18.576-31.962 14.093-12.706-4.487-19.726-18.08-16.023-31.026l.024-.086.029-.084c26.723-75.584 61.75-132.8 104.922-171.138z"
    />
  </svg>
)

export const HazardTapeIcon = ({ size = 14 }: { size?: number }) => (
  <svg
    width={size}
    height={Math.round(size * 0.65)}
    viewBox="0 0 20 13"
    fill="none"
    className="shrink-0 rounded-[1.5px] overflow-hidden"
    aria-hidden="true"
  >
    <rect width="20" height="13" fill="#facc15" />
    <path
      d="M-2 4 L2 0 H6 L2 4 H-2 Z M6 4 L10 0 H14 L10 4 H6 Z M14 4 L18 0 H22 L18 4 H14 Z"
      fill="#000000"
    />
    <path
      d="M-2 13 L2 9 H6 L2 13 H-2 Z M6 13 L10 9 H14 L10 13 H6 Z M14 13 L18 9 H22 L18 13 H14 Z"
      fill="#000000"
    />
    <rect width="20" height="13" fill="none" stroke="#000000" strokeWidth="1" />
  </svg>
)

export const OS_SECTION_THEMES: Record<OSGroupId, OSSectionTheme> = {
  analisis: {
    headerIconBg: 'bg-rose-500/10 dark:bg-rose-500/20 border-rose-500/20',
    headerIconColor: 'text-rose-600 dark:text-rose-400',
    borderHover: 'hover:border-rose-400/80 dark:hover:border-rose-500/70 hover:shadow-rose-500/5',
    badgeBg: 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200/80 dark:border-rose-800/70',
    pillActive: 'bg-rose-600 text-white border-rose-600 shadow-xs',
    sectionBorder: 'border-t-2 border-t-rose-500/80',
    activeIcon: 'text-rose-600 dark:text-rose-400',
    activeBg: 'bg-rose-500/12 dark:bg-rose-500/25 ring-1 ring-rose-500/25',
    activeText: 'text-rose-600 dark:text-rose-400',
    indicatorColor: 'bg-rose-600',
    folderSurface: 'bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl',
    folderBorder: 'border-rose-200/70 dark:border-rose-900/50',
    squircleGradient: 'bg-gradient-to-br from-rose-500 to-red-600 text-white shadow-rose-500/25',
    accentGlow: 'from-rose-500/15 via-red-500/5 to-transparent',
  },
  operaciones: {
    headerIconBg: 'bg-blue-500/10 dark:bg-blue-500/20 border-blue-500/20',
    headerIconColor: 'text-blue-600 dark:text-blue-400',
    borderHover: 'hover:border-blue-400/80 dark:hover:border-blue-500/70 hover:shadow-blue-500/5',
    badgeBg: 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200/80 dark:border-blue-800/70',
    pillActive: 'bg-blue-600 text-white border-blue-600 shadow-xs',
    sectionBorder: 'border-t-2 border-t-blue-500/80',
    activeIcon: 'text-blue-600 dark:text-blue-400',
    activeBg: 'bg-blue-500/12 dark:bg-blue-500/25 ring-1 ring-blue-500/25',
    activeText: 'text-blue-600 dark:text-blue-400',
    indicatorColor: 'bg-blue-600',
    folderSurface: 'bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl',
    folderBorder: 'border-blue-200/70 dark:border-blue-900/50',
    squircleGradient: 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-blue-500/25',
    accentGlow: 'from-blue-500/15 via-indigo-500/5 to-transparent',
  },
  inventario: {
    headerIconBg: 'bg-purple-500/10 dark:bg-purple-500/20 border-purple-500/20',
    headerIconColor: 'text-purple-600 dark:text-purple-400',
    borderHover: 'hover:border-purple-400/80 dark:hover:border-purple-500/70 hover:shadow-purple-500/5',
    badgeBg: 'bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border-purple-200/80 dark:border-purple-800/70',
    pillActive: 'bg-purple-600 text-white border-purple-600 shadow-xs',
    sectionBorder: 'border-t-2 border-t-purple-500/80',
    activeIcon: 'text-purple-600 dark:text-purple-400',
    activeBg: 'bg-purple-500/12 dark:bg-purple-500/25 ring-1 ring-purple-500/25',
    activeText: 'text-purple-600 dark:text-purple-400',
    indicatorColor: 'bg-purple-600',
    folderSurface: 'bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl',
    folderBorder: 'border-purple-200/70 dark:border-purple-900/50',
    squircleGradient: 'bg-gradient-to-br from-purple-500 to-violet-600 text-white shadow-purple-500/25',
    accentGlow: 'from-purple-500/15 via-violet-500/5 to-transparent',
  },
  equipo: {
    headerIconBg: 'bg-cyan-500/10 dark:bg-cyan-500/20 border-cyan-500/20',
    headerIconColor: 'text-cyan-600 dark:text-cyan-400',
    borderHover: 'hover:border-cyan-400/80 dark:hover:border-cyan-500/70 hover:shadow-cyan-500/5',
    badgeBg: 'bg-cyan-50 dark:bg-cyan-950/60 text-cyan-700 dark:text-cyan-300 border-cyan-200/80 dark:border-cyan-800/70',
    pillActive: 'bg-cyan-600 text-white border-cyan-600 shadow-xs',
    sectionBorder: 'border-t-2 border-t-cyan-500/80',
    activeIcon: 'text-cyan-600 dark:text-cyan-400',
    activeBg: 'bg-cyan-500/12 dark:bg-cyan-500/25 ring-1 ring-cyan-500/25',
    activeText: 'text-cyan-600 dark:text-cyan-400',
    indicatorColor: 'bg-cyan-600',
    folderSurface: 'bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl',
    folderBorder: 'border-cyan-200/70 dark:border-cyan-900/50',
    squircleGradient: 'bg-gradient-to-br from-cyan-500 to-teal-600 text-white shadow-cyan-500/25',
    accentGlow: 'from-cyan-500/15 via-teal-500/5 to-transparent',
  },
  finanzas: {
    headerIconBg: 'bg-emerald-500/10 dark:bg-emerald-500/20 border-emerald-500/20',
    headerIconColor: 'text-emerald-600 dark:text-emerald-400',
    borderHover: 'hover:border-emerald-400/80 dark:hover:border-emerald-500/70 hover:shadow-emerald-500/5',
    badgeBg: 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-800/70',
    pillActive: 'bg-emerald-600 text-white border-emerald-600 shadow-xs',
    sectionBorder: 'border-t-2 border-t-emerald-500/80',
    activeIcon: 'text-emerald-600 dark:text-emerald-400',
    activeBg: 'bg-emerald-500/12 dark:bg-emerald-500/25 ring-1 ring-emerald-500/25',
    activeText: 'text-emerald-600 dark:text-emerald-400',
    indicatorColor: 'bg-emerald-600',
    folderSurface: 'bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl',
    folderBorder: 'border-emerald-200/70 dark:border-emerald-900/50',
    squircleGradient: 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-emerald-500/25',
    accentGlow: 'from-emerald-500/15 via-teal-500/5 to-transparent',
  },
  gestion: {
    headerIconBg: 'bg-amber-500/10 dark:bg-amber-500/20 border-amber-500/20',
    headerIconColor: 'text-amber-600 dark:text-amber-400',
    borderHover: 'hover:border-amber-400/80 dark:hover:border-amber-500/70 hover:shadow-amber-500/5',
    badgeBg: 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200/80 dark:border-amber-800/70',
    pillActive: 'bg-amber-600 text-white border-amber-600 shadow-xs',
    sectionBorder: 'border-t-2 border-t-amber-500/80',
    activeIcon: 'text-amber-600 dark:text-amber-400',
    activeBg: 'bg-amber-500/12 dark:bg-amber-500/25 ring-1 ring-amber-500/25',
    activeText: 'text-amber-600 dark:text-amber-400',
    indicatorColor: 'bg-amber-600',
    folderSurface: 'bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl',
    folderBorder: 'border-amber-200/70 dark:border-amber-900/50',
    squircleGradient: 'bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-amber-500/25',
    accentGlow: 'from-amber-500/15 via-orange-500/5 to-transparent',
  },
}

/**
 * Normaliza texto en minúsculas eliminando marcas diacríticas (tildes/acentos) para búsqueda instantánea.
 */
export function normalizeOSSearch(text: string): string {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Acorta títulos extensos derivados de `t('items.*')` sin hardcodear cadenas de idioma,
 * removiendo sufijos entre paréntesis o subtítulos secundarios cuando superan el ancho de un icono.
 */
function compactShortTitle(rawTitle: string): string {
  const clean = String(rawTitle || '').trim()
  if (clean.length <= 15) return clean
  const withoutParens = clean.replace(/\s*\([^)]*\)\s*/g, '').trim()
  if (withoutParens.length > 0 && withoutParens.length <= 16) return withoutParens
  if (withoutParens.includes(' & ')) {
    const firstPart = withoutParens.split(' & ')[0]?.trim()
    if (firstPart) return firstPart
  }
  return withoutParens || clean
}

/**
 * Normaliza el rol, correo y permisos especiales del usuario autenticado en Tacos Gavilan.
 */
export function normalizeOSUserRole(user: OSUserLike | null | undefined): NormalizedOSUserRole {
  const userEmailNorm = String(user?.email || '')
    .trim()
    .toLowerCase()
  const isVikesh = userEmailNorm === 'vikesh@tacosgavilan.com'
  const rawRole = String(user?.role || user?.user_role || user?.user_type || '')
    .trim()
    .toLowerCase()
  const userRole =
    rawRole === 'gerente'
      ? 'manager'
      : rawRole === 'regional_manager'
        ? 'supervisor'
        : rawRole === 'assistant'
          ? 'asistente'
          : rawRole === 'administrador'
            ? 'admin'
            : rawRole

  const isPlanificadorOnly =
    userEmailNorm === 'stephany@cingularhr.com' || userRole === 'planificador'
  const isBasecampOnly = userRole === 'basecamp'
  const isEmployeeOnly =
    String(user?.user_type || '').toLowerCase() === 'employee' || rawRole === 'employee'

  const canCustomizeDock = !isPlanificadorOnly && !isBasecampOnly && !isEmployeeOnly
  const canViewFinancialPulse =
    !isVikesh &&
    !isPlanificadorOnly &&
    !isBasecampOnly &&
    !isEmployeeOnly &&
    ['admin', 'supervisor', 'manager', 'auditor'].includes(userRole)

  const canAccessExternalAccounting =
    ['raquel@tacosgavilan.com', 'roberto@tacosgavilan.com', 'roque@tacosgavilan.com'].includes(
      userEmailNorm
    ) && [45, 46, 47].includes(Number(user?.id))

  return {
    userRole,
    userEmailNorm,
    isPlanificadorOnly,
    isBasecampOnly,
    isEmployeeOnly,
    isVikesh,
    canCustomizeDock,
    canViewFinancialPulse,
    canAccessExternalAccounting,
  }
}

/**
 * Deriva la llave única de almacenamiento local por usuario autenticado.
 */
export function getOSUserStorageKey(user: OSUserLike | null | undefined): string {
  const emailNorm = String(user?.email || '')
    .trim()
    .toLowerCase()
  if (emailNorm) return emailNorm
  if (user?.id !== null && user?.id !== undefined && String(user.id).trim() !== '') {
    return `id:${String(user.id).trim()}`
  }
  return 'guest'
}

/**
 * Construye los 6 grupos oficiales no editables y los 49 módulos del sistema usando 100% `t(...)`.
 */
export function getOSModuleGroups(t: (key: string) => string): OSModuleGroup[] {
  const groupTitle = (groupKey: OSGroupId, fallbackSectionKey: string): string => {
    const sidebarKey = `sidebar_nav.groups.${groupKey}`
    const val = t(sidebarKey)
    if (val && val !== sidebarKey) return val
    return t(fallbackSectionKey)
  }

  return [
    {
      id: 'analisis',
      title: groupTitle('analisis', 'sections.analysis'),
      subtitle: t('home_hub.section_sub.analisis'),
      renderGroupIcon: (size = 18) => <TrendingUp size={size} />,
      items: [
        {
          id: 'dashboard',
          title: t('items.dashboard'),
          shortTitle: compactShortTitle(t('items.dashboard')),
          description: t('home_hub.desc.dashboard'),
          path: '/dashboard',
          groupId: 'analisis',
          appTileBg: 'bg-gradient-to-br from-[#7a0912] via-[#b91c1c] to-[#45050a]',
          iconColorClass: 'bg-red-600 text-[#fdc82f] border-red-500',
          renderIcon: (size = 20) => <LayoutDashboard size={size} />,
          roles: ['manager', 'supervisor', 'admin', 'auditor'],
          isPrimaryDashboard: true,
        },
        {
          id: 'sales',
          title: t('items.sales'),
          shortTitle: compactShortTitle(t('bottom_nav.sales')),
          description: t('home_hub.desc.sales'),
          path: '/ventas',
          groupId: 'analisis',
          appTileBg: 'bg-gradient-to-br from-emerald-500 to-teal-600',
          iconColorClass:
            'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 border-emerald-500/20',
          renderIcon: (size = 20) => <DollarSign size={size} />,
          roles: ['admin', 'manager', 'supervisor'],
        },
        {
          id: 'reports',
          title: t('items.reports'),
          shortTitle: compactShortTitle(t('items.reports')),
          description: t('home_hub.desc.reports'),
          path: '/ventas/reportes',
          groupId: 'analisis',
          appTileBg: 'bg-gradient-to-br from-orange-500 to-red-600',
          iconColorClass:
            'bg-orange-500/10 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400 border-orange-500/20',
          renderIcon: (size = 20) => (
            <span className="relative inline-flex items-center justify-center">
              <TrendingUp size={size} />
              <span className="absolute -top-1 -right-1.5 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
              </span>
            </span>
          ),
          roles: ['manager', 'supervisor', 'admin'],
        },
        {
          id: 'discounts',
          title: t('items.discounts'),
          shortTitle: compactShortTitle(t('items.discounts')),
          description: t('home_hub.desc.discounts'),
          path: '/admin/auditoria-descuentos',
          groupId: 'analisis',
          appTileBg: 'bg-gradient-to-br from-rose-500 to-pink-600',
          iconColorClass:
            'bg-rose-500/10 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400 border-rose-500/20',
          renderIcon: (size = 20) => <ClipboardList size={size} />,
          roles: ['admin', 'supervisor', 'manager'],
        },
        {
          id: 'drive_thru_leaderboard',
          title: t('items.drive_thru_leaderboard'),
          shortTitle: compactShortTitle(t('items.drive_thru_leaderboard')),
          description: t('home_hub.desc.drive_thru'),
          path: '/drive-thru',
          groupId: 'analisis',
          appTileBg: 'bg-gradient-to-br from-violet-500 to-purple-600',
          iconColorClass:
            'bg-violet-500/10 text-violet-600 dark:bg-violet-500/20 dark:text-violet-400 border-violet-500/20',
          renderIcon: (size = 20) => <Timer size={size} />,
          roles: ['manager', 'supervisor', 'admin'],
        },
        {
          id: 'feedback',
          title: t('items.feedback'),
          shortTitle: compactShortTitle(t('items.feedback')),
          description: t('home_hub.desc.feedback'),
          path: '/feedback',
          groupId: 'analisis',
          appTileBg: 'bg-gradient-to-br from-sky-500 to-blue-600',
          iconColorClass:
            'bg-sky-500/10 text-sky-600 dark:bg-sky-500/20 dark:text-sky-400 border-sky-500/20',
          renderIcon: (size = 20) => <MessageSquare size={size} />,
          roles: ['asistente', 'manager', 'supervisor', 'admin'],
        },
        {
          id: 'eval_staff',
          title: t('items.eval_staff'),
          shortTitle: compactShortTitle(t('items.eval_staff')),
          description: t('home_hub.desc.eval_staff'),
          path: '/evaluacion',
          groupId: 'analisis',
          appTileBg: 'bg-gradient-to-br from-teal-500 to-emerald-600',
          iconColorClass:
            'bg-teal-500/10 text-teal-600 dark:bg-teal-500/20 dark:text-teal-400 border-teal-500/20',
          renderIcon: (size = 20) => <UserCheck size={size} />,
          roles: ['admin', 'manager', 'supervisor'],
        },
      ],
    },
    {
      id: 'operaciones',
      title: groupTitle('operaciones', 'sections.operations'),
      subtitle: t('home_hub.section_sub.operaciones'),
      renderGroupIcon: (size = 18) => <Briefcase size={size} />,
      items: [
        {
          id: 'basecamp',
          title: t('items.basecamp'),
          shortTitle: compactShortTitle(t('items.basecamp')),
          description: t('home_hub.desc.basecamp'),
          path: '/basecamp',
          groupId: 'operaciones',
          appTileBg: 'bg-gradient-to-br from-[#1d7db5] to-sky-600',
          iconColorClass:
            'bg-sky-500/15 text-[#1d7db5] dark:bg-sky-500/20 dark:text-sky-400 border-sky-500/30',
          renderIcon: (size = 20) => <BasecampIcon size={size} />,
          roles: ['manager', 'supervisor', 'admin', 'asistente', 'basecamp'],
          badgeType: 'new',
          badgeLabel: 'new',
        },
        {
          id: 'manager',
          title: t('items.manager'),
          shortTitle: compactShortTitle(t('bottom_nav.tasks')),
          description: t('home_hub.desc.manager'),
          path: '/checklists-manager',
          groupId: 'operaciones',
          appTileBg: 'bg-gradient-to-br from-blue-500 to-indigo-600',
          iconColorClass:
            'bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 border-blue-500/20',
          renderIcon: (size = 20) => <Briefcase size={size} />,
          roles: ['manager', 'supervisor', 'admin'],
        },
        {
          id: 'assistants',
          title: t('items.assistants'),
          shortTitle: compactShortTitle(t('bottom_nav.tasks')),
          description: t('home_hub.desc.assistants'),
          path: '/checklists',
          groupId: 'operaciones',
          appTileBg: 'bg-gradient-to-br from-cyan-500 to-blue-600',
          iconColorClass:
            'bg-cyan-500/10 text-cyan-600 dark:bg-cyan-500/20 dark:text-cyan-400 border-cyan-500/20',
          renderIcon: (size = 20) => <CheckSquare size={size} />,
          roles: ['asistente', 'manager', 'supervisor', 'admin'],
        },
        {
          id: 'supervisor',
          title: t('items.supervisor'),
          shortTitle: compactShortTitle(t('bottom_nav.inspect')),
          description: t('home_hub.desc.supervisor'),
          path: '/inspecciones',
          groupId: 'operaciones',
          appTileBg: 'bg-gradient-to-br from-violet-500 to-indigo-600',
          iconColorClass:
            'bg-violet-500/10 text-violet-600 dark:bg-violet-500/20 dark:text-violet-400 border-violet-500/20',
          renderIcon: (size = 20) => <ClipboardList size={size} />,
          roles: ['supervisor', 'admin', 'auditor'],
        },
        {
          id: 'prep',
          title: t('items.prep'),
          shortTitle: compactShortTitle(t('items.prep')),
          description: t('home_hub.desc.prep'),
          path: '/inventory/preparador',
          groupId: 'operaciones',
          appTileBg: 'bg-gradient-to-br from-orange-500 to-amber-600',
          iconColorClass:
            'bg-orange-500/10 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400 border-orange-500/20',
          renderIcon: (size = 20) => <ChefHat size={size} />,
          roles: ['admin', 'manager', 'supervisor', 'asistente'],
        },
        {
          id: 'blindaje_delivery',
          title: t('items.blindaje_delivery'),
          shortTitle: compactShortTitle(t('items.blindaje_delivery')),
          description: t('home_hub.desc.blindaje_delivery'),
          path: '/admin/blindaje-delivery',
          groupId: 'operaciones',
          appTileBg: 'bg-gradient-to-br from-emerald-500 to-green-600',
          iconColorClass:
            'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 border-emerald-500/20',
          renderIcon: (size = 20) => <ShieldCheck size={size} />,
          roles: ['admin', 'manager', 'supervisor', 'asistente'],
          badgeType: 'new',
          badgeLabel: 'new',
        },
        {
          id: 'order_ready_board',
          title: t('items.order_ready_board'),
          shortTitle: compactShortTitle(t('items.order_ready_board')),
          description: t('home_hub.desc.order_ready_board'),
          path: '/order-ready-board',
          groupId: 'operaciones',
          appTileBg: 'bg-gradient-to-br from-red-500 to-rose-600',
          iconColorClass:
            'bg-red-500/10 text-red-600 dark:bg-red-500/20 dark:text-red-400 border-red-500/20',
          renderIcon: (size = 20) => <Bell size={size} />,
          roles: ['asistente', 'manager', 'supervisor', 'admin'],
          badgeType: 'new',
          badgeLabel: 'new',
        },
        {
          id: 'phone_agent',
          title: t('items.phone_agent'),
          shortTitle: compactShortTitle(t('items.phone_agent')),
          description: t('home_hub.desc.phone_agent'),
          path: '/admin/llamadas',
          groupId: 'operaciones',
          appTileBg: 'bg-gradient-to-br from-indigo-500 to-violet-600',
          iconColorClass:
            'bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400 border-indigo-500/20',
          renderIcon: (size = 20) => <PhoneCall size={size} />,
          roles: [
            'admin',
            'supervisor',
            'regional_manager',
            'manager',
            'gerente',
            'asistente',
            'assistant',
          ],
          badgeType: 'new',
          badgeLabel: 'new',
        },
        {
          id: 'safe',
          title: t('items.safe'),
          shortTitle: compactShortTitle(t('items.safe')),
          description: t('home_hub.desc.safe'),
          path: '/caja-fuerte',
          groupId: 'operaciones',
          appTileBg: 'bg-gradient-to-br from-slate-600 to-slate-800',
          iconColorClass:
            'bg-slate-600/10 text-slate-700 dark:bg-slate-400/15 dark:text-slate-300 border-slate-500/20',
          renderIcon: (size = 20) => <Shield size={size} />,
          roles: ['admin', 'supervisor', 'manager', 'asistente'],
        },
        {
          id: 'actividades',
          title: t('items.actividades'),
          shortTitle: compactShortTitle(t('bottom_nav.activities')),
          description: t('home_hub.desc.actividades'),
          path: '/actividades',
          groupId: 'operaciones',
          appTileBg: 'bg-gradient-to-br from-teal-500 to-cyan-600',
          iconColorClass:
            'bg-teal-500/10 text-teal-600 dark:bg-teal-500/20 dark:text-teal-400 border-teal-500/20',
          renderIcon: (size = 20) => <ClipboardList size={size} />,
          roles: ['manager', 'supervisor', 'admin', 'asistente'],
        },
        {
          id: 'training',
          title: t('items.training'),
          shortTitle: compactShortTitle(t('items.training')),
          description: t('home_hub.desc.training'),
          path: '/training',
          groupId: 'operaciones',
          appTileBg: 'bg-gradient-to-br from-[#DA291C] to-red-700',
          iconColorClass:
            'bg-red-600/15 text-[#DA291C] dark:bg-red-500/20 dark:text-red-400 border-red-500/30',
          renderIcon: (size = 20) => <Sparkles size={size} />,
          roles: ['manager', 'supervisor', 'admin', 'asistente'],
          badgeType: 'new',
          badgeLabel: 'new',
        },
        {
          id: 'maintenance',
          title: t('items.maintenance'),
          shortTitle: compactShortTitle(t('items.maintenance')),
          description: t('home_hub.desc.maintenance'),
          path: '/admin/mantenimiento',
          groupId: 'operaciones',
          appTileBg: 'bg-gradient-to-br from-amber-500 to-yellow-600',
          iconColorClass:
            'bg-yellow-500/15 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400 border-yellow-500/30',
          renderIcon: (size = 20) => <Wrench size={size} />,
          roles: ['asistente', 'manager', 'supervisor', 'admin'],
          badgeType: 'building',
        },
      ],
    },
    {
      id: 'inventario',
      title: groupTitle('inventario', 'sections.inventory'),
      subtitle: t('home_hub.section_sub.inventario'),
      renderGroupIcon: (size = 18) => <Package size={size} />,
      items: [
        {
          id: 'bodega_orders',
          title: t('items.bodega_orders'),
          shortTitle: compactShortTitle(t('items.bodega_orders')),
          description: t('home_hub.desc.bodega_orders'),
          path: '/inventory/orders',
          groupId: 'inventario',
          appTileBg: 'bg-gradient-to-br from-blue-500 to-sky-600',
          iconColorClass:
            'bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 border-blue-500/20',
          renderIcon: (size = 20) => <Truck size={size} />,
          roles: ['admin', 'manager', 'supervisor'],
        },
        {
          id: 'viele_sons',
          title: t('items.viele_sons'),
          shortTitle: compactShortTitle(t('items.viele_sons')),
          description: t('home_hub.desc.viele_sons'),
          path: '/admin/compras/viele',
          groupId: 'inventario',
          appTileBg: 'bg-gradient-to-br from-amber-500 to-orange-600',
          iconColorClass:
            'bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 border-amber-500/20',
          renderIcon: (size = 20) => <Package size={size} />,
          roles: ['admin', 'manager', 'supervisor'],
          badgeType: 'new',
          badgeLabel: 'new',
        },
        {
          id: 'uniforms_control',
          title: t('items.uniforms_control'),
          shortTitle: compactShortTitle(t('items.uniforms_control')),
          description: t('home_hub.desc.uniforms_control'),
          path: '/inventory/uniforms',
          groupId: 'inventario',
          appTileBg: 'bg-gradient-to-br from-indigo-500 to-blue-600',
          iconColorClass:
            'bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400 border-indigo-500/20',
          renderIcon: (size = 20) => <Shirt size={size} />,
          roles: ['admin', 'manager', 'supervisor', 'asistente'],
        },
        {
          id: 'food_cost_margins',
          title: t('items.food_cost_margins'),
          shortTitle: compactShortTitle(t('items.food_cost_margins')),
          description: t('home_hub.desc.food_cost_margins'),
          path: '/admin/food-cost',
          groupId: 'inventario',
          appTileBg: 'bg-gradient-to-br from-emerald-500 to-teal-600',
          iconColorClass:
            'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 border-emerald-500/20',
          renderIcon: (size = 20) => <TrendingUp size={size} />,
          roles: ['admin', 'manager', 'supervisor'],
        },
        {
          id: 'supplier_prices',
          title: t('items.supplier_prices'),
          shortTitle: compactShortTitle(t('items.supplier_prices')),
          description: t('home_hub.desc.supplier_prices'),
          path: '/admin/precios-proveedores',
          groupId: 'inventario',
          appTileBg: 'bg-gradient-to-br from-rose-500 to-red-600',
          iconColorClass:
            'bg-rose-500/10 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400 border-rose-500/20',
          renderIcon: (size = 20) => <Calculator size={size} />,
          roles: ['admin'],
        },
        {
          id: 'ingredients',
          title: t('items.ingredients'),
          shortTitle: compactShortTitle(t('items.ingredients')),
          description: t('home_hub.desc.ingredients'),
          path: '/inventory/items',
          groupId: 'inventario',
          appTileBg: 'bg-gradient-to-br from-purple-500 to-fuchsia-600',
          iconColorClass:
            'bg-purple-500/10 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400 border-purple-500/20',
          renderIcon: (size = 20) => <Store size={size} />,
          roles: ['admin', 'manager', 'supervisor'],
        },
        {
          id: 'menu_catalog',
          title: t('items.menu_catalog'),
          shortTitle: compactShortTitle(t('items.menu_catalog')),
          description: t('home_hub.desc.menu_catalog'),
          path: '/inventory/menu',
          groupId: 'inventario',
          appTileBg: 'bg-gradient-to-br from-orange-500 to-amber-600',
          iconColorClass:
            'bg-orange-500/10 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400 border-orange-500/20',
          renderIcon: (size = 20) => <ClipboardList size={size} />,
          roles: ['admin', 'manager', 'supervisor'],
        },
        {
          id: 'food_costs',
          title: t('items.food_costs'),
          shortTitle: compactShortTitle(t('items.food_costs')),
          description: t('home_hub.desc.food_costs'),
          path: '/inventory/costs',
          groupId: 'inventario',
          appTileBg: 'bg-gradient-to-br from-teal-500 to-emerald-600',
          iconColorClass:
            'bg-teal-500/10 text-teal-600 dark:bg-teal-500/20 dark:text-teal-400 border-teal-500/20',
          renderIcon: (size = 20) => <TrendingUp size={size} />,
          roles: ['admin', 'manager'],
        },
      ],
    },
    {
      id: 'equipo',
      title: groupTitle('equipo', 'sections.team'),
      subtitle: t('home_hub.section_sub.equipo'),
      renderGroupIcon: (size = 18) => <Clock size={size} />,
      items: [
        {
          id: 'schedules',
          title: t('items.schedules'),
          shortTitle: compactShortTitle(t('items.schedules')),
          description: t('home_hub.desc.schedules'),
          path: '/horarios',
          groupId: 'equipo',
          appTileBg: 'bg-gradient-to-br from-cyan-500 to-sky-600',
          iconColorClass:
            'bg-cyan-500/10 text-cyan-600 dark:bg-cyan-500/20 dark:text-cyan-400 border-cyan-500/20',
          renderIcon: (size = 20) => <Clock size={size} />,
          roles: ['manager', 'supervisor', 'admin'],
        },
        {
          id: 'planner',
          title: t('items.planner'),
          shortTitle: compactShortTitle(t('bottom_nav.planner')),
          description: t('home_hub.desc.planner'),
          path: '/planificador',
          groupId: 'equipo',
          appTileBg: 'bg-gradient-to-br from-indigo-500 to-blue-600',
          iconColorClass:
            'bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400 border-indigo-500/20',
          renderIcon: (size = 20) => <Calendar size={size} />,
          roles: ['manager', 'supervisor', 'admin', 'planificador'],
        },
        {
          id: 'breaks_ai',
          title: t('items.breaks_ai'),
          shortTitle: compactShortTitle(t('items.breaks_ai')),
          description: t('home_hub.desc.breaks_ai'),
          path: '/descansos',
          groupId: 'equipo',
          appTileBg: 'bg-gradient-to-br from-amber-500 to-orange-500',
          iconColorClass:
            'bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 border-amber-500/20',
          renderIcon: (size = 20) => <Zap size={size} />,
          roles: ['manager', 'supervisor', 'admin'],
        },
        {
          id: 'my_schedule',
          title: t('items.my_schedule'),
          shortTitle: compactShortTitle(t('bottom_nav.schedule')),
          description: t('home_hub.desc.my_schedule'),
          path: '/mis-horarios',
          groupId: 'equipo',
          appTileBg: 'bg-gradient-to-br from-purple-500 to-indigo-600',
          iconColorClass:
            'bg-purple-500/10 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400 border-purple-500/20',
          renderIcon: (size = 20) => <CalendarCheck size={size} />,
          roles: ['asistente', 'manager', 'supervisor', 'admin'],
          badgeType: 'beta',
          badgeLabel: 'BETA',
        },
        {
          id: 'self_scheduling',
          title: t('items.self_scheduling'),
          shortTitle: compactShortTitle(t('items.self_scheduling')),
          description: t('home_hub.desc.self_scheduling'),
          path: '/gestion/auto-schedule',
          groupId: 'equipo',
          appTileBg: 'bg-gradient-to-br from-violet-500 to-purple-600',
          iconColorClass:
            'bg-violet-500/10 text-violet-600 dark:bg-violet-500/20 dark:text-violet-400 border-violet-500/20',
          renderIcon: (size = 20) => <UserCog size={size} />,
          roles: ['supervisor', 'admin'],
          badgeType: 'beta',
          badgeLabel: 'BETA',
        },
      ],
    },
    {
      id: 'finanzas',
      title: groupTitle('finanzas', 'sections.finance_accounting'),
      subtitle: t('home_hub.section_sub.finanzas'),
      renderGroupIcon: (size = 18) => <BarChart3 size={size} />,
      items: [
        {
          id: 'pnl',
          title: t('items.pnl'),
          shortTitle: compactShortTitle(t('items.pnl')),
          description: t('home_hub.desc.pnl'),
          path: '/admin/pnl',
          groupId: 'finanzas',
          appTileBg: 'bg-gradient-to-br from-emerald-600 to-green-700',
          iconColorClass:
            'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 border-emerald-500/20',
          renderIcon: (size = 20) => <BarChart3 size={size} />,
          roles: ['admin'],
        },
        {
          id: 'cohesion',
          title: t('items.cohesion'),
          shortTitle: compactShortTitle(t('items.cohesion')),
          description: t('home_hub.desc.cohesion'),
          path: '/contabilidad',
          groupId: 'finanzas',
          appTileBg: 'bg-gradient-to-br from-amber-500 to-yellow-600',
          iconColorClass:
            'bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 border-amber-500/20',
          renderIcon: (size = 20) => <Calculator size={size} />,
          roles: ['admin'],
          badgeType: 'new',
          badgeLabel: 'NEW',
        },
        {
          id: 'create_bills',
          title: t('items.create_bills'),
          shortTitle: compactShortTitle(t('items.create_bills')),
          description: t('home_hub.desc.create_bills'),
          path: '/admin/crear-bills',
          groupId: 'finanzas',
          appTileBg: 'bg-gradient-to-br from-blue-500 to-indigo-600',
          iconColorClass:
            'bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 border-blue-500/20',
          renderIcon: (size = 20) => <Receipt size={size} />,
          roles: ['admin'],
          badgeType: 'new',
          badgeLabel: 'NEW',
        },
        {
          id: 'conciliar_delivery',
          title: t('items.conciliar_delivery'),
          shortTitle: compactShortTitle(t('items.conciliar_delivery')),
          description: t('home_hub.desc.conciliar_delivery'),
          path: '/admin/conciliar-delivery',
          groupId: 'finanzas',
          appTileBg: 'bg-gradient-to-br from-indigo-500 to-violet-600',
          iconColorClass:
            'bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400 border-indigo-500/20',
          renderIcon: (size = 20) => <ShieldCheck size={size} />,
          roles: ['admin', 'supervisor'],
          badgeType: 'new',
          badgeLabel: 'NEW',
        },
        {
          id: 'external_accounting',
          title: t('items.external_accounting'),
          shortTitle: compactShortTitle(t('items.external_accounting')),
          description: t('home_hub.desc.external_accounting'),
          path: '/admin/contabilidad-externa',
          groupId: 'finanzas',
          appTileBg: 'bg-gradient-to-br from-emerald-500 to-teal-700',
          iconColorClass:
            'bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300 border-emerald-500/30',
          renderIcon: (size = 20) => <DollarSign size={size} />,
          roles: ['admin'],
          badgeType: 'new',
          badgeLabel: 'NEW',
        },
        {
          id: 'ronos',
          title: t('items.ronos'),
          shortTitle: compactShortTitle(t('items.ronos')),
          description: t('home_hub.desc.ronos'),
          path: '/admin/ronos',
          groupId: 'finanzas',
          appTileBg: 'bg-gradient-to-br from-indigo-600 to-slate-800',
          iconColorClass:
            'bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400 border-indigo-500/20',
          renderIcon: (size = 20) => <Clock size={size} />,
          roles: ['admin'],
          badgeType: 'building',
        },
        {
          id: 'miles_finance',
          title: t('items.miles'),
          shortTitle: compactShortTitle(t('items.miles')),
          description: t('home_hub.desc.miles'),
          path: '/miles',
          groupId: 'finanzas',
          appTileBg: 'bg-gradient-to-br from-teal-500 to-cyan-600',
          iconColorClass:
            'bg-teal-500/10 text-teal-600 dark:bg-teal-500/20 dark:text-teal-400 border-teal-500/20',
          renderIcon: (size = 20) => <Car size={size} />,
          roles: ['admin', 'supervisor'],
        },
      ],
    },
    {
      id: 'gestion',
      title: groupTitle('gestion', 'sections.management'),
      subtitle: t('home_hub.section_sub.gestion'),
      renderGroupIcon: (size = 18) => <Shield size={size} />,
      items: [
        {
          id: 'stores',
          title: t('items.stores'),
          shortTitle: compactShortTitle(t('items.stores')),
          description: t('home_hub.desc.stores'),
          path: '/tiendas',
          groupId: 'gestion',
          appTileBg: 'bg-gradient-to-br from-emerald-500 to-green-600',
          iconColorClass:
            'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 border-emerald-500/20',
          renderIcon: (size = 20) => <Store size={size} />,
          roles: ['admin'],
        },
        {
          id: 'users',
          title: t('items.users'),
          shortTitle: compactShortTitle(t('items.users')),
          description: t('home_hub.desc.users'),
          path: '/usuarios',
          groupId: 'gestion',
          appTileBg: 'bg-gradient-to-br from-blue-500 to-cyan-600',
          iconColorClass:
            'bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 border-blue-500/20',
          renderIcon: (size = 20) => <Users size={size} />,
          roles: ['admin', 'supervisor'],
        },
        {
          id: 'templates',
          title: t('items.templates'),
          shortTitle: compactShortTitle(t('items.templates')),
          description: t('home_hub.desc.templates'),
          path: '/admin/plantillas',
          groupId: 'gestion',
          appTileBg: 'bg-gradient-to-br from-amber-500 to-orange-600',
          iconColorClass:
            'bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 border-amber-500/20',
          renderIcon: (size = 20) => <FileEdit size={size} />,
          roles: ['admin'],
        },
        {
          id: 'tv_menus',
          title: t('items.tv_menus'),
          shortTitle: compactShortTitle(t('items.tv_menus')),
          description: t('home_hub.desc.tv_menus'),
          path: '/admin/tv-menus',
          groupId: 'gestion',
          appTileBg: 'bg-gradient-to-br from-purple-500 to-violet-600',
          iconColorClass:
            'bg-purple-500/10 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400 border-purple-500/20',
          renderIcon: (size = 20) => <Monitor size={size} />,
          roles: ['admin', 'supervisor'],
        },
        {
          id: 'kiosk_feedback',
          title: t('items.kiosk_feedback'),
          shortTitle: compactShortTitle(t('items.kiosk_feedback')),
          description: t('home_hub.desc.kiosk_feedback'),
          path: '/clientes',
          groupId: 'gestion',
          appTileBg: 'bg-gradient-to-br from-sky-500 to-cyan-600',
          iconColorClass:
            'bg-sky-500/10 text-sky-600 dark:bg-sky-500/20 dark:text-sky-400 border-sky-500/20',
          renderIcon: (size = 20) => <QrCode size={size} />,
          roles: ['admin', 'manager', 'supervisor'],
        },
        {
          id: 'new_website',
          title: t('items.new_website'),
          shortTitle: compactShortTitle(t('items.new_website')),
          description: t('home_hub.desc.new_website'),
          path: '/nueva-web',
          groupId: 'gestion',
          appTileBg: 'bg-gradient-to-br from-indigo-500 to-blue-600',
          iconColorClass:
            'bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400 border-indigo-500/20',
          renderIcon: (size = 20) => <Globe size={size} />,
          roles: ['asistente', 'manager', 'supervisor', 'admin'],
          badgeType: 'new',
          badgeLabel: 'new',
        },
        {
          id: 'customer_app',
          title: t('items.customer_app'),
          shortTitle: compactShortTitle(t('items.customer_app')),
          description: t('home_hub.desc.customer_app'),
          path: '/app',
          groupId: 'gestion',
          appTileBg: 'bg-gradient-to-br from-rose-500 to-red-600',
          iconColorClass:
            'bg-rose-500/10 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400 border-rose-500/20',
          renderIcon: (size = 20) => <Smartphone size={size} />,
          roles: ['asistente', 'manager', 'supervisor', 'admin'],
          badgeType: 'building',
        },
        {
          id: 'gavilan_pos',
          title: t('items.gavilan_pos'),
          shortTitle: compactShortTitle(t('items.gavilan_pos')),
          description: t('home_hub.desc.gavilan_pos'),
          path: '/gavilan-pos',
          groupId: 'gestion',
          appTileBg: 'bg-gradient-to-br from-orange-500 to-red-600',
          iconColorClass:
            'bg-orange-500/15 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400 border-orange-500/30',
          renderIcon: (size = 20) => <Monitor size={size} />,
          roles: ['admin', 'supervisor', 'manager'],
          openInNewTab: true,
          badgeType: 'building',
        },
        {
          id: 'activity_reports',
          title: t('items.activity_reports'),
          shortTitle: compactShortTitle(t('items.activity_reports')),
          description: t('home_hub.desc.activity_reports'),
          path: '/admin/reporte-actividades',
          groupId: 'gestion',
          appTileBg: 'bg-gradient-to-br from-cyan-500 to-blue-600',
          iconColorClass:
            'bg-cyan-500/10 text-cyan-600 dark:bg-cyan-500/20 dark:text-cyan-400 border-cyan-500/20',
          renderIcon: (size = 20) => <TrendingUp size={size} />,
          roles: ['admin'],
        },
        {
          id: 'system_health',
          title: t('items.system_health'),
          shortTitle: compactShortTitle(t('items.system_health')),
          description: t('home_hub.desc.system_health'),
          path: '/admin/salud-sistema',
          groupId: 'gestion',
          appTileBg: 'bg-gradient-to-br from-rose-600 to-pink-700',
          iconColorClass:
            'bg-rose-500/10 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400 border-rose-500/20',
          renderIcon: (size = 20) => <Shield size={size} />,
          roles: ['admin'],
        },
        {
          id: 'remote_control',
          title: t('items.remote_control'),
          shortTitle: compactShortTitle(t('items.remote_control')),
          description: t('home_hub.desc.remote_control'),
          path: '/admin/control-remoto',
          groupId: 'gestion',
          appTileBg: 'bg-gradient-to-br from-indigo-600 to-violet-700',
          iconColorClass:
            'bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400 border-indigo-500/20',
          renderIcon: (size = 20) => <Monitor size={size} />,
          roles: ['admin'],
        },
      ],
    },
  ]
}

/**
 * Filtra los 6 grupos oficiales conservando únicamente los módulos autorizados para el usuario.
 */
export function getPermittedOSGroups(
  groups: readonly OSModuleGroup[],
  user: OSUserLike | null | undefined
): OSModuleGroup[] {
  const {
    userRole,
    isVikesh,
    isPlanificadorOnly,
    isBasecampOnly,
    isEmployeeOnly,
    canAccessExternalAccounting,
  } = normalizeOSUserRole(user)

  return groups
    .map((group) => {
      if (isVikesh && group.id === 'inventario') {
        return { ...group, items: [] }
      }
      const validItems = group.items.filter((item) => {
        if (item.path === '/admin/contabilidad-externa') return canAccessExternalAccounting
        if (isPlanificadorOnly) return item.path === '/planificador'
        if (isBasecampOnly) return item.path === '/basecamp'
        if (isEmployeeOnly) return item.path === '/mis-horarios'
        if (isVikesh && (item.path === '/ventas' || item.path === '/ventas/reportes')) return false
        if (!item.roles || item.roles.length === 0) return true
        if (!userRole) return false
        return item.roles.includes(userRole)
      })
      return { ...group, items: validItems }
    })
    .filter((group) => group.items.length > 0)
}

/**
 * Retorna los accesos directos predeterminados de la barra inferior según el rol del usuario.
 */
export function getDefaultDockModuleIds(user: OSUserLike | null | undefined): string[] {
  const { userRole, isVikesh, isPlanificadorOnly, isBasecampOnly, isEmployeeOnly } = normalizeOSUserRole(user)

  if (isPlanificadorOnly) return ['planner']
  if (isBasecampOnly) return ['basecamp']
  if (isEmployeeOnly) return ['my_schedule']

  if (userRole === 'admin' || userRole === 'supervisor') {
    return isVikesh ? ['supervisor', 'planner'] : ['supervisor', 'sales', 'planner']
  }
  if (userRole === 'auditor') {
    return ['supervisor']
  }
  if (userRole === 'manager') {
    return isVikesh ? ['manager', 'planner'] : ['manager', 'sales', 'planner']
  }
  return ['assistants', 'actividades', 'my_schedule']
}

/**
 * Sanitiza y valida una lista candidata de IDs del dock contra los IDs permitidos del usuario:
 * - Resuelve alias español/inglés (`inspecciones` <-> `supervisor`, `ventas` <-> `sales`, etc.)
 * - Elimina duplicados e IDs no autorizados
 * - Aplica límites estrictos `1..4` (`DOCK_MIN_EDITABLE_SLOTS..DOCK_MAX_EDITABLE_SLOTS`)
 * - Recurre a `fallbackIds` filtrados por `permittedIds` si la lista candidata queda vacía.
 */
export function sanitizeDockModuleIds(
  candidateIds: readonly unknown[] | null | undefined,
  permittedIds: Iterable<string> | ReadonlySet<string>,
  fallbackIds: readonly string[]
): string[] {
  const permittedSet: ReadonlySet<string> =
    permittedIds instanceof Set ? permittedIds : new Set(permittedIds)

  const resolvePermittedId = (raw: unknown): string | null => {
    if (typeof raw !== 'string') return null
    const clean = raw.trim()
    if (!clean) return null
    if (permittedSet.has(clean)) return clean
    const alias = MODULE_ID_ALIASES[clean]
    if (alias && permittedSet.has(alias)) return alias
    return null
  }

  const collectValid = (source: readonly unknown[] | null | undefined): string[] => {
    if (!Array.isArray(source)) return []
    const out: string[] = []
    const seen = new Set<string>()
    for (const raw of source) {
      const resolved = resolvePermittedId(raw)
      if (resolved && !seen.has(resolved)) {
        seen.add(resolved)
        out.push(resolved)
        if (out.length >= DOCK_MAX_EDITABLE_SLOTS) break
      }
    }
    return out
  }

  const primary = collectValid(candidateIds)
  if (primary.length >= DOCK_MIN_EDITABLE_SLOTS) {
    return primary
  }

  const fallback = collectValid(fallbackIds)
  if (fallback.length >= DOCK_MIN_EDITABLE_SLOTS) {
    return fallback
  }

  const firstPermitted = permittedSet.values().next()
  return !firstPermitted.done && firstPermitted.value ? [firstPermitted.value] : []
}

/**
 * Determina si una ruta del dock está activa respetando rutas hermanas independientes (`/ventas/reportes`).
 */
export function isDockPathActive(
  itemPath: string,
  currentPathname: string | null | undefined,
  allDockPaths: readonly string[] = []
): boolean {
  if (!currentPathname || !itemPath || itemPath === '__drawer__') return false
  if (currentPathname === itemPath) return true
  if (!currentPathname.startsWith(itemPath + '/')) return false

  const matchesStandaloneSibling = STANDALONE_SIBLING_PATHS.some(
    (sib) =>
      sib !== itemPath &&
      sib.startsWith(itemPath + '/') &&
      (currentPathname === sib || currentPathname.startsWith(sib + '/'))
  )
  if (matchesStandaloneSibling) return false

  const hasLongerDockMatch = allDockPaths.some(
    (other) =>
      other !== '__drawer__' &&
      other !== itemPath &&
      other.length > itemPath.length &&
      (currentPathname === other || currentPathname.startsWith(other + '/'))
  )
  return !hasLongerDockMatch
}

/**
 * Calcula la ventana laboral exacta (`06:00 AM` a `05:59:59.999 AM`) y turno (`AM` / `PM`)
 * en `America/Los_Angeles` (seguro frente a transiciones PST/PDT y saltos de año/mes).
 */
export function computeLosAngelesBusinessWindow(now: Date = new Date()): {
  businessDate: string
  shiftPeriod: 'AM' | 'PM'
  laHour: number
  laTimeLabel: string
  startIso: string
  endIso: string
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)

  const getNum = (type: Intl.DateTimeFormatPartTypes): number => {
    const val = parts.find((p) => p.type === type)?.value
    return val ? parseInt(val, 10) : 0
  }

  const laYear = getNum('year')
  const laMonth = getNum('month')
  const laDay = getNum('day')
  const laHour = getNum('hour') % 24

  const anchorUtc = new Date(Date.UTC(laYear, laMonth - 1, laDay, 12, 0, 0, 0))
  if (laHour < 6) {
    anchorUtc.setUTCDate(anchorUtc.getUTCDate() - 1)
  }
  const businessDate = anchorUtc.toISOString().slice(0, 10)
  const shiftPeriod: 'AM' | 'PM' = laHour >= 6 && laHour < 17 ? 'AM' : 'PM'

  const laTimeLabel = now.toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })

  const sixAmEpochForDate = (ymd: string): number => {
    const [y, m, d] = ymd.split('-').map(Number)
    const approx = Date.UTC(y, m - 1, d, 14, 0, 0, 0)
    const checkParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(approx))
    const checkHour =
      parseInt(checkParts.find((p) => p.type === 'hour')?.value || '6', 10) % 24
    return approx - (checkHour - 6) * 3_600_000
  }

  const nextAnchor = new Date(anchorUtc.getTime())
  nextAnchor.setUTCDate(nextAnchor.getUTCDate() + 1)
  const nextBusinessDate = nextAnchor.toISOString().slice(0, 10)

  const startMs = sixAmEpochForDate(businessDate)
  const endMs = sixAmEpochForDate(nextBusinessDate) - 1

  return {
    businessDate,
    shiftPeriod,
    laHour,
    laTimeLabel,
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
  }
}

/**
 * Calcula ticket promedio seguro en USD evitando divisiones por cero (`NaN` / `Infinity`).
 */
export function computeSafeAvgTicket(netSales: number, orderCount: number): number {
  if (!Number.isFinite(netSales) || !Number.isFinite(orderCount) || orderCount <= 0) {
    return 0
  }
  const avg = netSales / orderCount
  return Number.isFinite(avg) ? Math.round(avg * 100) / 100 : 0
}

/**
 * Dispara el evento global para abrir el editor de la barra inferior (`DockEditorSheet`).
 */
export function openDockEditor(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(DOCK_OPEN_EDITOR_EVENT))
  }
}

function subscribeToDockStore(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {}
  }
  window.addEventListener(DOCK_UPDATED_EVENT, onStoreChange)
  window.addEventListener('storage', onStoreChange)
  return () => {
    window.removeEventListener(DOCK_UPDATED_EVENT, onStoreChange)
    window.removeEventListener('storage', onStoreChange)
  }
}

function notifyDockStoreUpdated(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(DOCK_UPDATED_EVENT))
  }
}

const fetchedServerPrefsKeys = new Set<string>()

/**
 * Hook reactivo para gestionar preferencias del Dock móvil/tablet y modo de inicio (`os` | `web`)
 * sin llamadas `setState` síncronas dentro de efectos (`useSyncExternalStore`).
 */
export function useMobileDockPreferences(
  user: OSUserLike | null | undefined,
  t: (key: string) => string
) {
  const [isSavingSync, setIsSavingSync] = useState(false)

  const roleMeta = useMemo(() => normalizeOSUserRole(user), [user])
  const userKey = useMemo(() => getOSUserStorageKey(user), [user])
  const dockStorageKey = `${DOCK_STORAGE_PREFIX}${userKey}`
  const modeStorageKey = `${HOME_MODE_STORAGE_PREFIX}${userKey}`

  const allGroups = useMemo(() => getOSModuleGroups(t), [t])
  const permittedGroups = useMemo(
    () => getPermittedOSGroups(allGroups, user),
    [allGroups, user]
  )

  const permittedModulesMap = useMemo(() => {
    const map = new Map<string, OSModuleItem>()
    for (const group of permittedGroups) {
      for (const item of group.items) {
        map.set(item.id, item)
      }
    }
    return map
  }, [permittedGroups])

  const defaultDockIds = useMemo(() => getDefaultDockModuleIds(user), [user])

  const getDockRawSnapshot = useCallback((): string | null => {
    if (typeof window === 'undefined') return null
    try {
      return window.localStorage.getItem(dockStorageKey)
    } catch {
      return null
    }
  }, [dockStorageKey])

  const getModeRawSnapshot = useCallback((): MobileHomeViewMode => {
    if (typeof window === 'undefined') return 'os'
    try {
      const val = window.localStorage.getItem(modeStorageKey)
      return val === 'web' ? 'web' : 'os'
    } catch {
      return 'os'
    }
  }, [modeStorageKey])

  const rawDockJson = useSyncExternalStore(
    subscribeToDockStore,
    getDockRawSnapshot,
    () => null
  )

  const homeViewMode = useSyncExternalStore<MobileHomeViewMode>(
    subscribeToDockStore,
    getModeRawSnapshot,
    () => 'os'
  )

  const dockModuleIds = useMemo(() => {
    const permittedIds = new Set<string>(permittedModulesMap.keys())
    if (!roleMeta.canCustomizeDock) {
      return sanitizeDockModuleIds(defaultDockIds, permittedIds, defaultDockIds)
    }
    let parsedCandidate: unknown[] | null = null
    if (rawDockJson) {
      try {
        const parsed: unknown = JSON.parse(rawDockJson)
        if (Array.isArray(parsed)) {
          parsedCandidate = parsed
        }
      } catch {
        parsedCandidate = null
      }
    }
    return sanitizeDockModuleIds(parsedCandidate, permittedIds, defaultDockIds)
  }, [rawDockJson, permittedModulesMap, defaultDockIds, roleMeta.canCustomizeDock])

  const dockItems = useMemo(() => {
    return dockModuleIds
      .map((id) => permittedModulesMap.get(id))
      .filter((item): item is OSModuleItem => Boolean(item))
  }, [dockModuleIds, permittedModulesMap])

  const persistRemotePreferences = useCallback(
    async (payload: { dockModuleIds?: string[]; homeViewMode?: MobileHomeViewMode }) => {
      if (typeof window === 'undefined' || userKey === 'guest' || !roleMeta.canCustomizeDock) {
        return
      }
      const token = window.localStorage.getItem('teg_token')
      if (!token) return

      setIsSavingSync(true)
      try {
        await fetch('/api/mobile-os/preferences', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        })
      } catch {
        // localStorage permanece como respaldo inmediato offline
      } finally {
        setIsSavingSync(false)
      }
    },
    [userKey, roleMeta.canCustomizeDock]
  )

  // Hidratar preferencias remotas desde Supabase 1 vez por usuario en segundo plano
  useEffect(() => {
    if (typeof window === 'undefined' || userKey === 'guest' || !roleMeta.canCustomizeDock) {
      return
    }
    if (fetchedServerPrefsKeys.has(userKey)) {
      return
    }
    const token = window.localStorage.getItem('teg_token')
    if (!token) return

    fetchedServerPrefsKeys.add(userKey)
    let cancelled = false

    fetch('/api/mobile-os/preferences', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
      .then(async (res) => {
        if (!res.ok) return null
        const data = (await res.json()) as {
          dockModuleIds?: string[] | null
          homeViewMode?: MobileHomeViewMode
        }
        return data
      })
      .then((data) => {
        if (cancelled || !data) return
        let changed = false
        try {
          if (Array.isArray(data.dockModuleIds) && data.dockModuleIds.length > 0) {
            const nextJson = JSON.stringify(data.dockModuleIds)
            if (window.localStorage.getItem(dockStorageKey) !== nextJson) {
              window.localStorage.setItem(dockStorageKey, nextJson)
              changed = true
            }
          }
          if (data.homeViewMode === 'os' || data.homeViewMode === 'web') {
            if (window.localStorage.getItem(modeStorageKey) !== data.homeViewMode) {
              window.localStorage.setItem(modeStorageKey, data.homeViewMode)
              changed = true
            }
          }
        } catch {
          // ignore storage quota errors
        }
        if (changed) {
          notifyDockStoreUpdated()
        }
      })
      .catch(() => {
        fetchedServerPrefsKeys.delete(userKey)
      })

    return () => {
      cancelled = true
    }
  }, [userKey, roleMeta.canCustomizeDock, dockStorageKey, modeStorageKey])

  const setDockModuleIds = useCallback(
    (nextCandidateIds: string[]) => {
      if (!roleMeta.canCustomizeDock) return
      const permittedIds = new Set<string>(permittedModulesMap.keys())
      const sanitized = sanitizeDockModuleIds(nextCandidateIds, permittedIds, defaultDockIds)
      if (sanitized.length < DOCK_MIN_EDITABLE_SLOTS) return

      try {
        window.localStorage.setItem(dockStorageKey, JSON.stringify(sanitized))
      } catch {
        // ignore storage errors
      }
      notifyDockStoreUpdated()
      void persistRemotePreferences({ dockModuleIds: sanitized })
    },
    [
      roleMeta.canCustomizeDock,
      permittedModulesMap,
      defaultDockIds,
      dockStorageKey,
      persistRemotePreferences,
    ]
  )

  const replaceDockSlot = useCallback(
    (slotIndex: number, newModuleId: string) => {
      if (slotIndex < 0 || slotIndex >= dockModuleIds.length) return
      if (!permittedModulesMap.has(newModuleId)) return
      const existingIdx = dockModuleIds.indexOf(newModuleId)
      const next = [...dockModuleIds]
      if (existingIdx >= 0 && existingIdx !== slotIndex) {
        // Intercambiar posiciones si el icono ya estaba en otra ranura de la barra
        next[existingIdx] = next[slotIndex]
      }
      next[slotIndex] = newModuleId
      setDockModuleIds(next)
    },
    [dockModuleIds, permittedModulesMap, setDockModuleIds]
  )

  const moveDockSlot = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (
        fromIndex < 0 ||
        fromIndex >= dockModuleIds.length ||
        toIndex < 0 ||
        toIndex >= dockModuleIds.length ||
        fromIndex === toIndex
      ) {
        return
      }
      const next = [...dockModuleIds]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      setDockModuleIds(next)
    },
    [dockModuleIds, setDockModuleIds]
  )

  const addDockSlot = useCallback(
    (moduleId: string) => {
      if (dockModuleIds.length >= DOCK_MAX_EDITABLE_SLOTS) return
      if (dockModuleIds.includes(moduleId) || !permittedModulesMap.has(moduleId)) return
      setDockModuleIds([...dockModuleIds, moduleId])
    },
    [dockModuleIds, permittedModulesMap, setDockModuleIds]
  )

  const removeDockSlot = useCallback(
    (slotIndexOrId: number | string) => {
      if (dockModuleIds.length <= DOCK_MIN_EDITABLE_SLOTS) return
      const next =
        typeof slotIndexOrId === 'number'
          ? dockModuleIds.filter((_, idx) => idx !== slotIndexOrId)
          : dockModuleIds.filter((id) => id !== slotIndexOrId)
      if (next.length >= DOCK_MIN_EDITABLE_SLOTS && next.length !== dockModuleIds.length) {
        setDockModuleIds(next)
      }
    },
    [dockModuleIds, setDockModuleIds]
  )

  const resetDockToDefaults = useCallback(() => {
    const permittedIds = new Set<string>(permittedModulesMap.keys())
    const defaults = sanitizeDockModuleIds(defaultDockIds, permittedIds, defaultDockIds)
    try {
      window.localStorage.setItem(dockStorageKey, JSON.stringify(defaults))
    } catch {
      // ignore
    }
    notifyDockStoreUpdated()
    void persistRemotePreferences({ dockModuleIds: defaults })
  }, [permittedModulesMap, defaultDockIds, dockStorageKey, persistRemotePreferences])

  const setHomeViewMode = useCallback(
    (mode: MobileHomeViewMode) => {
      const normalizedMode: MobileHomeViewMode = mode === 'web' ? 'web' : 'os'
      try {
        window.localStorage.setItem(modeStorageKey, normalizedMode)
      } catch {
        // ignore
      }
      notifyDockStoreUpdated()
      void persistRemotePreferences({ homeViewMode: normalizedMode })
    },
    [modeStorageKey, persistRemotePreferences]
  )

  const toggleHomeViewMode = useCallback(() => {
    setHomeViewMode(homeViewMode === 'os' ? 'web' : 'os')
  }, [homeViewMode, setHomeViewMode])

  return {
    dockModuleIds,
    dockItems,
    permittedGroups,
    permittedModulesMap,
    canCustomizeDock: roleMeta.canCustomizeDock,
    isPlanificadorOnly: roleMeta.isPlanificadorOnly,
    isBasecampOnly: roleMeta.isBasecampOnly,
    isEmployeeOnly: roleMeta.isEmployeeOnly,
    isSavingSync,
    homeViewMode,
    setHomeViewMode,
    toggleHomeViewMode,
    setDockModuleIds,
    replaceDockSlot,
    moveDockSlot,
    addDockSlot,
    removeDockSlot,
    resetDockToDefaults,
  }
}
