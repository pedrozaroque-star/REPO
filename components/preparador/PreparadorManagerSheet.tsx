/**
 * @module components/preparador/PreparadorManagerSheet
 * @description Panel deslizable de Gerente (`348px`, `Manager Control Sheet`) que agrupa de manera limpia
 *   todos los controles administrativos, modos de tarjeta, divisiones horarias, selector de sucursal con
 *   candado RBAC estricto (`disabled={!isSuper}`), fecha laboral, reportes, cambio Día/Noche, idioma ES/EN
 *   y botón Despertar Tableta — tanto en desktop/tableta como en móvil (`< lg`).
 *
 * @businessRules
 * - Regla RBAC: Los usuarios que no son `admin` ni `supervisor` jamás pueden cambiar de sucursal (corrigiendo
 *   el hueco histórico del drawer móvil).
 * - Nunca aparece cuando la tableta está en Modo Kiosco (`isFullscreen === true`, regla U54).
 * - Conserva el 100% de acciones gerenciales: `Manual/Básica/Avanzada`, `30 Min/Tramos`, `Fecha + Hoy`,
 *   `Ver Guía`, `Ver Día`, `Reporte Mermas`, `Cocina Trasera ↗`, `Info`, `Día/Noche`, `ES/EN`, `Despertar Tableta`.
 */

'use client'

import React from 'react'
import {
  BarChart3,
  BookOpen,
  Calendar,
  Clock,
  ExternalLink,
  HelpCircle,
  Lock,
  Moon,
  Sun,
  X,
} from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useLanguage } from '@/lib/i18n'
import { formatStoreDisplayName } from '@/lib/store-display'

export interface PreparadorManagerSheetProps {
  open: boolean
  isDark: boolean
  isSuper: boolean
  stores: any[]
  storeId: string
  selectedDate: string
  currentBusinessDate: string
  isToday: boolean
  cardDisplayMode: 'manual' | 'basic' | 'advanced'
  viewMode: '30min' | 'tramos'
  wakingUpTablet: boolean
  isSmartAutoVoiceStore: boolean
  onClose: () => void
  onChangeStore: (nextStoreId: string) => void
  onChangeDate: (nextDate: string) => void
  onSelectToday: () => void
  onChangeCardMode: (mode: 'manual' | 'basic' | 'advanced') => void
  onChangeViewMode: (mode: '30min' | 'tramos') => void
  onToggleTheme: (nextDark: boolean) => void
  onOpenGuide: () => void
  onOpenDay: () => void
  onOpenWaste: () => void
  onOpenInfo: () => void
  onOpenBackKitchen: () => void
  onWakeUpTablet: () => void
}

export default function PreparadorManagerSheet({
  open,
  isDark,
  isSuper,
  stores,
  storeId,
  selectedDate,
  currentBusinessDate,
  isToday,
  cardDisplayMode,
  viewMode,
  wakingUpTablet,
  isSmartAutoVoiceStore,
  onClose,
  onChangeStore,
  onChangeDate,
  onSelectToday,
  onChangeCardMode,
  onChangeViewMode,
  onToggleTheme,
  onOpenGuide,
  onOpenDay,
  onOpenWaste,
  onOpenInfo,
  onOpenBackKitchen,
  onWakeUpTablet,
}: PreparadorManagerSheetProps) {
  const { t, language, setLanguage } = useLanguage()

  const panelBg = isDark
    ? 'bg-[#181A1F] border-l border-[#2C3038] text-[#F5F2EB]'
    : 'bg-[#F8F5EF] border-l border-[#D8D0C2] text-[#171614]'

  const cardBg = isDark
    ? 'bg-[#111214] border border-[#2C3038]'
    : 'bg-white border border-[#D8D0C2]'

  const labelMuted = isDark ? 'text-[#9CA3AF]' : 'text-[#5C574F]'

  const segActive = isDark
    ? 'bg-[#F5F2EB] text-[#111214]'
    : 'bg-[#171614] text-white'

  const segIdle = isDark
    ? 'bg-[#1B1D21] text-[#9CA3AF] hover:text-[#F5F2EB] border border-[#2C3038]'
    : 'bg-[#F3EFE7] text-[#5C574F] hover:text-[#171614] border border-[#D8D0C2]'

  const actionBtn = isDark
    ? 'bg-[#1B1D21] hover:bg-[#252932] border border-[#2C3038] text-[#F5F2EB]'
    : 'bg-white hover:bg-[#F3EFE7] border border-[#D8D0C2] text-[#171614]'

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          data-no-proximity="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[99990] bg-black/55 backdrop-blur-[2px] flex justify-end"
          onClick={onClose}
        >
          <motion.aside
            initial={{ x: 360 }}
            animate={{ x: 0 }}
            exit={{ x: 360 }}
            transition={{ type: 'tween', duration: 0.18 }}
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-[356px] h-full flex flex-col shadow-2xl ${panelBg}`}
          >
            {/* Cabecera */}
            <div
              className={`px-4 py-3.5 border-b flex items-center justify-between shrink-0 ${
                isDark ? 'border-[#2C3038]' : 'border-[#D8D0C2]'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="w-1 h-5 rounded-full bg-[#C8371A]" />
                <h2 className="text-sm font-black uppercase tracking-wide">
                  {t('prep.managerSheetTitle')}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t('prep.cerrar')}
                className={`w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer active:scale-95 ${actionBtn}`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Cuerpo scrollable */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* 1. Sucursal y Fecha Laboral */}
              <section className={`rounded-xl p-3 space-y-3 ${cardBg}`}>
                <div className={`text-[11px] font-black uppercase tracking-wider ${labelMuted}`}>
                  {t('prep.storeSectionTitle')}
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label htmlFor="prep-manager-store" className={`text-xs font-bold ${labelMuted}`}>
                      Tacos Gavilan
                    </label>
                    {!isSuper && (
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold ${labelMuted}`}>
                        <Lock className="w-3 h-3" />
                        {t('prep.storeLockedRole')}
                      </span>
                    )}
                  </div>
                  <select
                    id="prep-manager-store"
                    value={storeId}
                    disabled={!isSuper}
                    onChange={(e) => onChangeStore(e.target.value)}
                    className={`w-full h-10 px-3 rounded-lg text-sm font-extrabold outline-none border ${
                      isDark
                        ? 'bg-[#1B1D21] border-[#343944] text-[#F5F2EB] disabled:opacity-60'
                        : 'bg-[#F8F5EF] border-[#D8D0C2] text-[#171614] disabled:opacity-65'
                    }`}
                  >
                    {stores.map((s) => (
                      <option key={s.id} value={String(s.id)}>
                        {formatStoreDisplayName(s.name)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      type="date"
                      value={selectedDate}
                      max={currentBusinessDate}
                      onChange={(e) => {
                        if (e.target.value) onChangeDate(e.target.value)
                      }}
                      className={`w-full h-10 px-3 rounded-lg text-xs font-extrabold tabular-nums outline-none border ${
                        isDark
                          ? 'bg-[#1B1D21] border-[#343944] text-[#F5F2EB]'
                          : 'bg-[#F8F5EF] border-[#D8D0C2] text-[#171614]'
                      }`}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={onSelectToday}
                    className={`h-10 px-3 rounded-lg text-xs font-black uppercase cursor-pointer transition-colors ${
                      isToday
                        ? 'bg-[#15803D] text-white'
                        : 'bg-[#C8371A] hover:bg-[#A82D15] text-white'
                    }`}
                  >
                    {t('prep.today')}
                  </button>
                </div>
              </section>

              {/* 2. Modo de Tarjetas + División de Horario */}
              <section className={`rounded-xl p-3 space-y-3 ${cardBg}`}>
                <div>
                  <div className={`text-[11px] font-black uppercase tracking-wider mb-2 ${labelMuted}`}>
                    {t('prep.modoTarjeta')}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['manual', 'basic', 'advanced'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => onChangeCardMode(m)}
                        className={`h-10 rounded-lg text-xs font-black cursor-pointer transition-colors ${
                          cardDisplayMode === m ? segActive : segIdle
                        }`}
                      >
                        {m === 'manual'
                          ? t('prep.manualMode')
                          : m === 'basic'
                            ? t('prep.basicMode')
                            : t('prep.advancedMode')}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className={`text-[11px] font-black uppercase tracking-wider mb-2 ${labelMuted}`}>
                    {t('prep.modoIntervalo')}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => onChangeViewMode('30min')}
                      className={`h-10 rounded-lg text-xs font-black cursor-pointer transition-colors ${
                        viewMode === '30min' ? segActive : segIdle
                      }`}
                    >
                      {t('prep.view30Min')} (48)
                    </button>
                    <button
                      type="button"
                      onClick={() => onChangeViewMode('tramos')}
                      className={`h-10 rounded-lg text-xs font-black cursor-pointer transition-colors ${
                        viewMode === 'tramos' ? segActive : segIdle
                      }`}
                    >
                      {t('prep.viewTramos')} (6)
                    </button>
                  </div>
                </div>
              </section>

              {/* 3. Reportes y Estaciones */}
              <section className={`rounded-xl p-3 space-y-2 ${cardBg}`}>
                <div className={`text-[11px] font-black uppercase tracking-wider mb-1 ${labelMuted}`}>
                  {t('prep.reportsSectionTitle')}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onClose()
                      onOpenGuide()
                    }}
                    className={`h-11 px-3 rounded-lg text-xs font-black flex items-center gap-2 cursor-pointer active:scale-[0.98] ${actionBtn}`}
                  >
                    <BookOpen className="w-4 h-4 text-[#C8371A] shrink-0" />
                    <span className="truncate">{t('prep.viewGuide')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onClose()
                      onOpenDay()
                    }}
                    className={`h-11 px-3 rounded-lg text-xs font-black flex items-center gap-2 cursor-pointer active:scale-[0.98] ${actionBtn}`}
                  >
                    <Calendar className="w-4 h-4 text-[#1D4ED8] shrink-0" />
                    <span className="truncate">{t('prep.viewDay')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onClose()
                      onOpenWaste()
                    }}
                    className={`h-11 px-3 rounded-lg text-xs font-black flex items-center gap-2 cursor-pointer active:scale-[0.98] ${actionBtn}`}
                  >
                    <BarChart3 className="w-4 h-4 text-[#B45309] shrink-0" />
                    <span className="truncate">{t('prep.wasteReportBtn')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onClose()
                      onOpenInfo()
                    }}
                    className={`h-11 px-3 rounded-lg text-xs font-black flex items-center gap-2 cursor-pointer active:scale-[0.98] ${actionBtn}`}
                  >
                    <HelpCircle className="w-4 h-4 text-[#15803D] shrink-0" />
                    <span className="truncate">{t('prep.calcInfo')}</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    onOpenBackKitchen()
                  }}
                  className={`w-full h-11 px-3 rounded-lg text-xs font-black uppercase tracking-wide flex items-center justify-between cursor-pointer active:scale-[0.99] ${
                    isDark
                      ? 'bg-[#23272F] hover:bg-[#2C313B] text-[#F5F2EB] border border-[#343944]'
                      : 'bg-[#171614] hover:bg-[#2A2825] text-white'
                  }`}
                >
                  <span>{t('prep.openWarehouse')}</span>
                  <ExternalLink className="w-4 h-4" />
                </button>
              </section>

              {/* 4. Acabado Día / Noche e Idioma ES / EN */}
              <section className={`rounded-xl p-3 space-y-3 ${cardBg}`}>
                <div>
                  <div className={`text-[11px] font-black uppercase tracking-wider mb-2 ${labelMuted}`}>
                    {t('prep.themeSectionTitle')}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => onToggleTheme(false)}
                      className={`h-10 rounded-lg text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer ${
                        !isDark ? segActive : segIdle
                      }`}
                    >
                      <Sun className="w-3.5 h-3.5" />
                      <span>{t('prep.themeDay')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleTheme(true)}
                      className={`h-10 rounded-lg text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer ${
                        isDark ? segActive : segIdle
                      }`}
                    >
                      <Moon className="w-3.5 h-3.5" />
                      <span>{t('prep.themeNight')}</span>
                    </button>
                  </div>
                </div>

                <div>
                  <div className={`text-[11px] font-black uppercase tracking-wider mb-2 ${labelMuted}`}>
                    {t('prep.languageLabel')}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setLanguage('es')}
                      className={`h-9 rounded-lg text-xs font-black cursor-pointer ${
                        language === 'es' ? segActive : segIdle
                      }`}
                    >
                      Español (ES)
                    </button>
                    <button
                      type="button"
                      onClick={() => setLanguage('en')}
                      className={`h-9 rounded-lg text-xs font-black cursor-pointer ${
                        language === 'en' ? segActive : segIdle
                      }`}
                    >
                      English (EN)
                    </button>
                  </div>
                </div>

                {isSmartAutoVoiceStore && (
                  <div
                    className={`rounded-lg px-3 py-2 text-[11px] font-bold flex items-center gap-2 ${
                      isDark
                        ? 'bg-[#142442] text-[#93C5FD] border border-[#1E3A8A]'
                        : 'bg-[#E8F0FE] text-[#1E3A8A] border border-[#BFDBFE]'
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5 shrink-0" />
                    <span>{t('prep.smartAutoVoiceActiveBadge')}</span>
                  </div>
                )}
              </section>
            </div>

            {/* Footer: Despertar / Recalibrar Tableta */}
            <div
              className={`p-4 border-t shrink-0 ${
                isDark ? 'border-[#2C3038] bg-[#141619]' : 'border-[#D8D0C2] bg-[#EFEAE0]'
              }`}
            >
              <button
                type="button"
                disabled={wakingUpTablet}
                onClick={() => {
                  onClose()
                  onWakeUpTablet()
                }}
                className={`w-full h-12 rounded-xl text-xs font-black uppercase tracking-wide flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99] disabled:opacity-50 border-b-[3px] ${
                  isDark
                    ? 'bg-[#B45309] hover:bg-[#92400E] text-white border-[#78350F]'
                    : 'bg-[#F59E0B] hover:bg-[#D97706] text-[#171614] border-[#B45309]'
                }`}
              >
                <Sun className={`w-4 h-4 ${wakingUpTablet ? 'animate-spin' : ''}`} />
                <span>{wakingUpTablet ? t('prep.wakingUpTablet') : t('prep.wakeUpTabletShort')}</span>
              </button>
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
