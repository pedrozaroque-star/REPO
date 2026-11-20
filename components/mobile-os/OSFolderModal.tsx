/**
 * @module components/mobile-os/OSFolderModal
 * @description Superposición expandida de carpeta estilo iOS SpringBoard (`z-[125]`) con vidrio
 *              esmerilado translúcido (`backdrop-blur-3xl`) y animación elástica (`framer-motion`)
 *              para los 6 grupos departamentales oficiales no editables de Tacos Gavilan.
 *
 * @businessRules
 * - Muestra todos los módulos autorizados dentro de un grupo oficial (`analisis`, `operaciones`,
 *   `inventario`, `equipo`, `finanzas`, `gestion`) en una cuadrícula táctil de squircles vivos.
 * - Respeta insignias (`new`, `beta`, `building` con `HazardTapeIcon`), apertura en nueva pestaña
 *   (`openInNewTab`), fijado de favoritos (`teg_favorite_modules_v1`) y selector especial de versión
 *   para `customer_app` (`/app?v=1`, `/app?v=2`, `/app?v=2&fullscreen=1`).
 * - Los grupos departamentales son estrictamente oficiales y no editables (`mobile_os.groups_non_editable_badge`).
 *
 * @dataFlow
 * - Recibe `group: OSModuleGroup | null` desde `MobileOSHome`, junto con `favoriteIds`,
 *   `onToggleFavorite`, `onClose`, `onOpenCustomerApp` y `onLaunchModule`.
 *
 * @notes
 * - Soporta cierre al tocar fuera de la tarjeta, botón explícito `✕` o tecla `Escape`.
 * - 100% bilingüe (`useLanguage()`), cero `any` y cero `setState` síncronos en efectos.
 */

'use client'

import React, { useEffect } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import { ExternalLink, Lock, Star, X } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import {
  HazardTapeIcon,
  OS_SECTION_THEMES,
  type OSModuleGroup,
  type OSModuleItem,
} from '@/lib/mobile-os-catalog'

export interface OSFolderModalProps {
  group: OSModuleGroup | null
  favoriteIds: readonly string[]
  onToggleFavorite: (e: React.MouseEvent, moduleId: string) => void
  onClose: () => void
  onOpenCustomerApp: () => void
  onLaunchModule: () => void
}

export default function OSFolderModal({
  group,
  favoriteIds,
  onToggleFavorite,
  onClose,
  onOpenCustomerApp,
  onLaunchModule,
}: OSFolderModalProps) {
  const { t } = useLanguage()

  useEffect(() => {
    if (!group) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [group, onClose])

  const renderAppTile = (item: OSModuleItem) => {
    const isFav = favoriteIds.includes(item.id)

    const squircleVisual = (
      <div className="relative flex items-center justify-center">
        <div
          className={`w-[58px] h-[58px] sm:w-16 sm:h-16 rounded-[15px] ${item.appTileBg} text-white flex items-center justify-center shadow-[0_8px_20px_rgba(0,0,0,0.28)] ring-1 ring-inset ring-white/25 group-active/tile:scale-92 transition-transform`}
        >
          {item.renderIcon(26)}
        </div>

        {/* Botón Estrella (Fijar / Quitar de Accesos Rápidos) */}
        <button
          type="button"
          onClick={(e) => onToggleFavorite(e, item.id)}
          title={isFav ? t('home_hub.unpin_favorite') : t('home_hub.pin_favorite')}
          aria-label={isFav ? t('home_hub.unpin_favorite') : t('home_hub.pin_favorite')}
          className={`absolute -top-1.5 -left-1.5 z-10 w-6 h-6 rounded-full flex items-center justify-center border shadow-xs transition-all cursor-pointer outline-none ${
            isFav
              ? 'bg-amber-400 text-slate-950 border-amber-300'
              : 'bg-black/45 text-white/75 border-white/25 hover:text-amber-300'
          }`}
        >
          <Star size={11} fill={isFav ? 'currentColor' : 'none'} />
        </button>

        {item.badgeType === 'new' && (
          <span className="new-badge-animated absolute -top-1.5 -right-2 z-10 bg-[#ff3b30] text-white text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full shadow-xs leading-none">
            {item.badgeLabel || 'NEW'}
          </span>
        )}
        {item.badgeType === 'beta' && (
          <span className="absolute -top-1.5 -right-2 z-10 bg-purple-600 text-white text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full shadow-xs border border-white/35 leading-none">
            {item.badgeLabel || 'BETA'}
          </span>
        )}
        {item.badgeType === 'building' && (
          <span className="absolute -top-1.5 -right-2 z-10 bg-amber-400/95 p-0.5 rounded shadow-xs border border-slate-900/30 leading-none">
            <HazardTapeIcon size={13} />
          </span>
        )}

        {item.openInNewTab && (
          <span className="absolute -bottom-1 -right-1 z-10 w-5 h-5 rounded-full bg-slate-900/90 text-white border border-white/25 flex items-center justify-center shadow-xs">
            <ExternalLink size={10} />
          </span>
        )}
      </div>
    )

    if (item.id === 'customer_app') {
      return (
        <div
          key={item.id}
          role="button"
          tabIndex={0}
          onClick={() => {
            onClose()
            onOpenCustomerApp()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onClose()
              onOpenCustomerApp()
            }
          }}
          className="group/tile flex flex-col items-center gap-1.5 cursor-pointer outline-none select-none"
        >
          {squircleVisual}
          <span className="text-[11px] sm:text-xs font-medium text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)] text-center leading-tight line-clamp-2 max-w-[88px]">
            {item.title}
          </span>
        </div>
      )
    }

    return (
      <Link
        key={item.id}
        href={item.path}
        prefetch={false}
        target={item.openInNewTab ? '_blank' : undefined}
        rel={item.openInNewTab ? 'noopener noreferrer' : undefined}
        onClick={() => {
          onLaunchModule()
          onClose()
        }}
        className="group/tile flex flex-col items-center gap-1.5 outline-none select-none"
      >
        {squircleVisual}
        <span className="text-[11px] sm:text-xs font-medium text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)] text-center leading-tight line-clamp-2 max-w-[88px]">
          {item.title}
        </span>
      </Link>
    )
  }

  return (
    <AnimatePresence>
      {group && (
        <motion.div
          key={group.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
          className="fixed inset-0 z-[125] bg-black/50 backdrop-blur-2xl flex flex-col items-center justify-center p-5 sm:p-6"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.86, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.88, y: 10 }}
            transition={{ type: 'spring', stiffness: 390, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[380px] sm:max-w-md max-h-[82dvh] flex flex-col items-center"
          >
            {/* Título Centrado estilo Carpeta Abierta de iOS */}
            <div className="w-full flex items-center justify-between gap-3 px-2 mb-4 text-white">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-md ${
                    OS_SECTION_THEMES[group.id]?.squircleGradient ||
                    OS_SECTION_THEMES.operaciones.squircleGradient
                  }`}
                >
                  {group.renderGroupIcon(18)}
                </div>
                <div className="min-w-0">
                  <h3 className="text-xl sm:text-2xl font-bold tracking-tight text-white drop-shadow truncate">
                    {group.title}
                  </h3>
                  <div className="flex items-center gap-1.5 text-[11px] text-white/75">
                    <Lock size={10} />
                    <span>{t('mobile_os.groups_non_editable_badge')}</span>
                    <span>• {group.items.length} {t('mobile_os.folder_apps_count')}</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                title={t('mobile_os.folder_close')}
                aria-label={t('mobile_os.folder_close')}
                className="w-9 h-9 rounded-full bg-white/18 hover:bg-white/28 active:scale-95 border border-white/25 flex items-center justify-center text-white shrink-0 transition-all cursor-pointer outline-none"
              >
                <X size={18} />
              </button>
            </div>

            {/* Tarjeta Esmerilada Translúcida estilo Carpeta iOS */}
            <div className="w-full rounded-[36px] bg-white/22 backdrop-blur-3xl border border-white/28 shadow-[0_24px_56px_rgba(0,0,0,0.45)] p-5 sm:p-6 overflow-y-auto">
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-x-3 gap-y-5 place-items-center">
                {group.items.map((item) => renderAppTile(item))}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
