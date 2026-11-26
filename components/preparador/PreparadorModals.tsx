/**
 * @module components/preparador/PreparadorModals
 * @description Todos los modales operativos de la Tableta Preparador en acabado industrial
 *   "Warm Ceramic & Comal Graphite":
 *   1. `WakeUpModal` (3h de inactividad)
 *   2. `CookAlertModal` (solo Modo Avanzada, apaga `cookAlarmRef`)
 *   3. `EditMeatModal` (estrictamente por bloque, sin "Aplicar a todo el día", permite `0`, presets `1..15`)
 *   4. `GuideModal` (48 franjas 24h completas con filtro `Turno Principal 8a–1:30a` / `24h Completo (48)`)
 *   5. `DayModal` (`VER DÍA` 6 AM → 5 AM + totales)
 *   6. `WasteModal` (`REPORTE MERMAS` con `max={currentBusinessDate}`, colores semánticos corregidos, `z-[99995]`)
 *   7. `InfoModal` (solo Modo Avanzada / Gerente)
 */

'use client'

import React, { useState } from 'react'
import {
  AlertTriangle,
  BarChart3,
  BellRing,
  BookOpen,
  Calendar,
  CheckCircle2,
  Clock,
  HelpCircle,
  Loader2,
  RefreshCw,
  RotateCcw,
  Sun,
  X,
} from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useLanguage } from '@/lib/i18n'
import type { GrillMeatEditRequest } from './PreparadorGrillPanel'

export interface PreparadorModalsProps {
  isDark: boolean
  isFullscreen: boolean
  viewMode: '30min' | 'tramos'
  currentBusinessDate: string
  // Wake Toast & 3h Wake Modal
  wakeToast: boolean
  showWakeUpModal: boolean
  wakingUpTablet: boolean
  onWakeUpTablet: () => void
  // Cook Alert Modal (Avanzada only)
  showCookAlert: boolean
  nextBlockLabel: string
  onDismissCookAlert: () => void
  // Edit Meat Modal
  editingMeatItem: GrillMeatEditRequest | null
  tempEditValue: number
  hasDailyOverrideForEditing: boolean
  onChangeTempEditValue: (val: number) => void
  onRestoreAutoOverride: () => void
  onSaveEditMeat: () => void
  onCloseEditMeat: () => void
  // Guide Modal (48 blocks 6am-5:30am with Main Shift / 24h filter)
  showGuideModal: boolean
  guideModalDow: number
  guideModalData: any[]
  guideModalLoading: boolean
  onChangeGuideDow: (dow: number) => void
  onCloseGuideModal: () => void
  // View Day Modal
  showDayModal: boolean
  hourlyData: any[]
  onCloseDayModal: () => void
  // Waste Report Modal
  showWasteModal: boolean
  selectedWasteDate: string
  wasteData: any[]
  loadingWasteData: boolean
  showWasteInfo: boolean
  onChangeWasteDate: (date: string) => void
  onToggleWasteInfo: () => void
  onCloseWasteModal: () => void
  // Info Modal
  showInfoModal: boolean
  onCloseInfoModal: () => void
}

const PROTEINS = ['ASADA', 'PASTOR', 'POLLO', 'CABEZA', 'LENGUA'] as const
const MAIN_SHIFT_SET = new Set<string>([
  ...Array.from({ length: 16 }, (_, idx) => {
    const h = (8 + idx).toString().padStart(2, '0')
    return [`${h}:00`, `${h}:30`]
  }).flat(),
  '00:00',
  '00:30',
  '01:00',
  '01:30',
])

export default function PreparadorModals({
  isDark,
  isFullscreen,
  viewMode,
  currentBusinessDate,
  wakeToast,
  showWakeUpModal,
  wakingUpTablet,
  onWakeUpTablet,
  showCookAlert,
  nextBlockLabel,
  onDismissCookAlert,
  editingMeatItem,
  tempEditValue,
  hasDailyOverrideForEditing,
  onChangeTempEditValue,
  onRestoreAutoOverride,
  onSaveEditMeat,
  onCloseEditMeat,
  showGuideModal,
  guideModalDow,
  guideModalData,
  guideModalLoading,
  onChangeGuideDow,
  onCloseGuideModal,
  showDayModal,
  hourlyData,
  onCloseDayModal,
  showWasteModal,
  selectedWasteDate,
  wasteData,
  loadingWasteData,
  showWasteInfo,
  onChangeWasteDate,
  onToggleWasteInfo,
  onCloseWasteModal,
  showInfoModal,
  onCloseInfoModal,
}: PreparadorModalsProps) {
  const { t } = useLanguage()
  const [guideFilter, setGuideFilter] = useState<'main' | 'full'>('main')

  const modalCard = isDark
    ? 'bg-[#181A1F] border border-[#2C3038] text-[#F5F2EB]'
    : 'bg-[#FAF8F4] border border-[#D8D0C2] text-[#171614]'
  const modalHeader = isDark
    ? 'bg-[#141619] border-b border-[#2C3038]'
    : 'bg-[#F3EFE7] border-b border-[#D8D0C2]'
  const subtleSurface = isDark
    ? 'bg-[#111214] border border-[#2C3038]'
    : 'bg-white border border-[#D8D0C2]'
  const mutedText = isDark ? 'text-[#9CA3AF]' : 'text-[#5C574F]'

  const dowItems = [
    { dow: 1, label: t('prep.dowSun') },
    { dow: 2, label: t('prep.dowMon') },
    { dow: 3, label: t('prep.dowTue') },
    { dow: 4, label: t('prep.dowWed') },
    { dow: 5, label: t('prep.dowThu') },
    { dow: 6, label: t('prep.dowFri') },
    { dow: 7, label: t('prep.dowSat') },
  ]

  const visibleGuideRows =
    guideFilter === 'full'
      ? guideModalData
      : guideModalData.filter((row) => MAIN_SHIFT_SET.has(row.time))

  const dayTotals = PROTEINS.reduce<Record<string, number>>((acc, p) => {
    acc[p] = hourlyData.reduce((s, row) => s + Number(row[p] || 0), 0)
    return acc
  }, {})
  const grandDayTotal = Object.values(dayTotals).reduce((a, b) => a + b, 0)

  return (
    <>
      {/* 1. Toast Confirmación Despertar Tableta */}
      <AnimatePresence>
        {wakeToast && (
          <motion.div
            initial={{ opacity: 0, y: -32 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -32 }}
            className="fixed top-3 left-1/2 -translate-x-1/2 z-[999999] bg-[#15803D] text-white px-5 py-3 rounded-xl font-black text-xs sm:text-sm shadow-xl flex items-center gap-2.5 border border-[#86EFAC]/40 max-w-[92vw]"
          >
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <span>{t('prep.tabletAwakeSuccess')}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 2. Modal Despertar Tableta tras 3h de Inactividad */}
      <AnimatePresence>
        {showWakeUpModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onWakeUpTablet}
            className="fixed inset-0 z-[999998] bg-black/85 backdrop-blur-xs flex items-center justify-center p-4 sm:p-8 cursor-pointer select-none"
          >
            <motion.div
              initial={{ scale: 0.95, y: 16 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 16 }}
              onClick={(e) => {
                e.stopPropagation()
                onWakeUpTablet()
              }}
              className="bg-[#181A1F] border-2 border-[#F59E0B] max-w-xl w-full rounded-2xl p-6 sm:p-8 flex flex-col items-center text-center text-[#F5F2EB] shadow-2xl"
            >
              <div className="w-16 h-16 rounded-2xl bg-[#33230B] border border-[#6E4912] flex items-center justify-center mb-4">
                <Sun className="w-9 h-9 text-[#F59E0B]" />
              </div>

              <h2 className="text-xl sm:text-2xl font-black uppercase tracking-tight mb-2">
                {t('prep.wakeModalTitle')}
              </h2>
              <p className="text-[#9CA3AF] text-xs sm:text-sm font-semibold mb-5 max-w-md">
                {t('prep.wakeModalSubtitle')}
              </p>

              <div className="w-full bg-[#111214] border border-[#2C3038] rounded-xl p-4 mb-6 text-left space-y-2">
                <div className="flex items-center gap-2.5 text-xs font-bold text-[#86EFAC]">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{t('prep.wakeModalCheck1')}</span>
                </div>
                <div className="flex items-center gap-2.5 text-xs font-bold text-[#FCD34D]">
                  <Clock className="w-4 h-4 shrink-0" />
                  <span>{t('prep.wakeModalCheck2')}</span>
                </div>
                <div className="flex items-center gap-2.5 text-xs font-bold text-[#93C5FD]">
                  <RefreshCw className="w-4 h-4 shrink-0" />
                  <span>{t('prep.wakeModalCheck3')}</span>
                </div>
              </div>

              <button
                type="button"
                disabled={wakingUpTablet}
                onClick={(e) => {
                  e.stopPropagation()
                  onWakeUpTablet()
                }}
                className="w-full h-14 rounded-xl bg-[#F59E0B] hover:bg-[#D97706] border-b-[4px] border-[#B45309] active:translate-y-[1px] text-[#171614] font-black text-base sm:text-lg uppercase tracking-wide flex items-center justify-center gap-2.5 cursor-pointer"
              >
                {wakingUpTablet ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>{t('prep.wakingUpTablet')}</span>
                  </>
                ) : (
                  <>
                    <Sun className="w-5 h-5" />
                    <span>{t('prep.wakeUpTablet')}</span>
                  </>
                )}
              </button>

              <p className="text-[11px] font-bold text-[#9CA3AF] uppercase tracking-wider mt-3">
                {t('prep.wakeModalTapHint')}
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 3. Modal Alerta de Cocción (EXCLUSIVO Modo Avanzada, regla U50) */}
      <AnimatePresence>
        {showCookAlert && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[99999] bg-black/85 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.94, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.94, y: 20 }}
              className="bg-[#181A1F] border-2 border-[#EF4444] max-w-2xl w-full rounded-2xl p-6 sm:p-10 flex flex-col items-center text-center text-[#F5F2EB] shadow-2xl"
            >
              <div className="w-16 h-16 rounded-2xl bg-[#3A1614] border border-[#7F1D1D] flex items-center justify-center mb-4">
                <BellRing className="w-9 h-9 text-[#EF4444]" />
              </div>
              <h2 className="text-2xl sm:text-4xl font-black uppercase tracking-tight mb-3">
                {t('prep.prepareNextBlock')}
              </h2>
              <div className="bg-[#111214] border border-[#7F1D1D] rounded-xl px-6 py-3 mb-7">
                <div className="text-xs font-bold uppercase tracking-wider text-[#FCA5A5]">
                  {t('prep.nextSchedule')}
                </div>
                <div className="text-xl sm:text-3xl font-black tabular-nums text-white mt-0.5">
                  {nextBlockLabel}
                </div>
              </div>
              <button
                type="button"
                onClick={onDismissCookAlert}
                className="w-full h-14 rounded-xl bg-[#C8371A] hover:bg-[#A82D15] border-b-[4px] border-[#7F1D1D] active:translate-y-[1px] text-white font-black text-lg uppercase tracking-wider cursor-pointer"
              >
                {t('prep.understood')}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 4. Modal Editar Libras por Bloque (SIN "Aplicar a todo el día", permite 0, bloqueado en Kiosco) */}
      <AnimatePresence>
        {!isFullscreen && editingMeatItem && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-[2px] z-[99995] flex items-center justify-center p-4"
            onClick={onCloseEditMeat}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className={`rounded-2xl p-5 sm:p-6 max-w-md w-full shadow-2xl space-y-5 ${modalCard}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[11px] font-black uppercase tracking-wider text-[#C8371A] dark:text-[#F87171]">
                    {t('prep.block')}: {editingMeatItem.bucketLabel}
                  </div>
                  <h3 className="text-xl sm:text-2xl font-black uppercase mt-0.5">
                    {editingMeatItem.isManualMode ? t('prep.editModalTitle') : t('prep.meatProjection')} ·{' '}
                    {editingMeatItem.meatType}
                  </h3>
                  <p className={`text-xs font-semibold mt-1 ${mutedText}`}>
                    {viewMode === 'tramos' ? t('prep.editHintTramos') : t('prep.editHint30Min')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onCloseEditMeat}
                  className={`w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer ${subtleSurface}`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Stepper grande (permite bajar hasta 0) */}
              <div className={`p-4 rounded-xl flex items-center justify-center gap-4 ${subtleSurface}`}>
                <button
                  type="button"
                  onClick={() => onChangeTempEditValue(Math.max(0, tempEditValue - 1))}
                  className="w-14 h-14 rounded-xl bg-[#C8371A] hover:bg-[#A82D15] border-b-[3px] border-[#7F1D1D] text-white font-black text-3xl flex items-center justify-center cursor-pointer active:translate-y-[1px]"
                >
                  −
                </button>
                <div className="flex items-baseline gap-1.5 px-2">
                  <input
                    type="number"
                    min={0}
                    max={200}
                    value={tempEditValue}
                    onChange={(e) => {
                      const raw = e.target.value
                      if (raw === '') {
                        onChangeTempEditValue(0)
                        return
                      }
                      const parsed = parseInt(raw, 10)
                      if (Number.isFinite(parsed)) {
                        onChangeTempEditValue(Math.max(0, Math.min(200, parsed)))
                      }
                    }}
                    className="text-5xl font-black tabular-nums text-center w-24 bg-transparent outline-none border-b-2 border-[#C8371A]"
                  />
                  <span className={`text-base font-black uppercase ${mutedText}`}>{t('prep.lbs')}</span>
                </div>
                <button
                  type="button"
                  onClick={() => onChangeTempEditValue(Math.min(200, tempEditValue + 1))}
                  className="w-14 h-14 rounded-xl bg-[#15803D] hover:bg-[#166534] border-b-[3px] border-[#0E4F26] text-white font-black text-3xl flex items-center justify-center cursor-pointer active:translate-y-[1px]"
                >
                  +
                </button>
              </div>

              {/* Presets rápidos 1..15 */}
              <div>
                <div className={`text-[11px] font-black uppercase tracking-wider mb-2 ${mutedText}`}>
                  {t('prep.quickSelect')}
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {[1, 2, 3, 4, 5, 6, 8, 10, 12, 15].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => onChangeTempEditValue(val)}
                      className={`h-10 rounded-lg font-black text-xs tabular-nums cursor-pointer transition-colors ${
                        tempEditValue === val
                          ? 'bg-[#C8371A] text-white'
                          : isDark
                            ? 'bg-[#111214] text-[#D1D5DB] border border-[#2C3038] hover:bg-[#23272F]'
                            : 'bg-white text-[#171614] border border-[#D8D0C2] hover:bg-[#F3EFE7]'
                      }`}
                    >
                      {val} {t('prep.lbs')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Acciones */}
              <div className="flex flex-wrap gap-2 pt-1">
                {!editingMeatItem.isManualMode && hasDailyOverrideForEditing && (
                  <button
                    type="button"
                    onClick={onRestoreAutoOverride}
                    className={`flex-1 h-12 px-3 rounded-xl text-xs font-black uppercase inline-flex items-center justify-center gap-1.5 cursor-pointer ${subtleSurface}`}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>{t('prep.restoreAuto')}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={onCloseEditMeat}
                  className={`flex-1 h-12 px-3 rounded-xl text-xs font-black uppercase cursor-pointer ${subtleSurface}`}
                >
                  {t('prep.cancel')}
                </button>
                <button
                  type="button"
                  onClick={onSaveEditMeat}
                  className="flex-1 h-12 px-4 rounded-xl bg-[#15803D] hover:bg-[#166534] border-b-[3px] border-[#0E4F26] text-white text-xs font-black uppercase tracking-wide cursor-pointer"
                >
                  {t('prep.save')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 5. Modal VER GUÍA (48 franjas 6:00 AM – 5:30 AM con filtro Turno Principal / 24h) */}
      <AnimatePresence>
        {showGuideModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/75 z-[99995] flex items-center justify-center p-3 sm:p-5"
            onClick={onCloseGuideModal}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className={`rounded-2xl w-full max-w-5xl max-h-[92vh] h-[90vh] flex flex-col shadow-2xl overflow-hidden ${modalCard}`}
            >
              <div className={`px-4 py-3 flex items-center justify-between gap-2 shrink-0 ${modalHeader}`}>
                <div className="flex items-center gap-2.5 min-w-0">
                  <BookOpen className="w-5 h-5 text-[#C8371A] shrink-0" />
                  <div className="min-w-0">
                    <h3 className="font-black text-base sm:text-lg truncate">
                      {t('prep.guideModalTitle').replace(/^📖\s*/, '')}
                    </h3>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onCloseGuideModal}
                  className={`w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer ${subtleSurface}`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4 flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
                {/* Resumen operativo compacto en 3 columnas monocromo */}
                <div className="hidden sm:grid grid-cols-3 gap-2 shrink-0">
                  <div className={`p-2.5 rounded-xl ${subtleSurface}`}>
                    <div className="text-[11px] font-black uppercase">{t('prep.step1Proj')}</div>
                    <p className={`text-[11px] mt-0.5 ${mutedText}`}>{t('prep.guideStep1Body')}</p>
                  </div>
                  <div className={`p-2.5 rounded-xl ${subtleSurface}`}>
                    <div className="text-[11px] font-black uppercase">{t('prep.step2Max')}</div>
                    <p className={`text-[11px] mt-0.5 ${mutedText}`}>{t('prep.guideStep2Body')}</p>
                  </div>
                  <div className={`p-2.5 rounded-xl ${subtleSurface}`}>
                    <div className="text-[11px] font-black uppercase">{t('prep.step3Quality')}</div>
                    <p className={`text-[11px] mt-0.5 ${mutedText}`}>{t('prep.guideStep3Body')}</p>
                  </div>
                </div>

                {/* Selector DOW + Filtro Turno Principal / 24h Completo (48) */}
                <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
                  <div className="flex items-center gap-1 flex-wrap">
                    {dowItems.map((d) => (
                      <button
                        key={d.dow}
                        type="button"
                        onClick={() => onChangeGuideDow(d.dow)}
                        className={`h-9 px-3 rounded-lg text-xs font-black cursor-pointer ${
                          guideModalDow === d.dow
                            ? isDark
                              ? 'bg-[#F5F2EB] text-[#111214]'
                              : 'bg-[#171614] text-white'
                            : subtleSurface
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setGuideFilter('main')}
                      className={`h-9 px-2.5 rounded-lg text-xs font-black cursor-pointer ${
                        guideFilter === 'main' ? 'bg-[#C8371A] text-white' : subtleSurface
                      }`}
                    >
                      {t('prep.guideFilterMain')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setGuideFilter('full')}
                      className={`h-9 px-2.5 rounded-lg text-xs font-black cursor-pointer ${
                        guideFilter === 'full' ? 'bg-[#C8371A] text-white' : subtleSurface
                      }`}
                    >
                      {t('prep.guideFilterFull')}
                    </button>
                  </div>
                </div>

                {/* Tabla de máximos */}
                <div className={`flex-1 min-h-0 overflow-auto rounded-xl ${subtleSurface}`}>
                  {guideModalLoading ? (
                    <div className="h-48 flex items-center justify-center gap-2">
                      <Loader2 className="w-5 h-5 animate-spin text-[#C8371A]" />
                      <span className="text-xs font-bold">{t('prep.loadingTable')}</span>
                    </div>
                  ) : (
                    <table className="w-full text-left border-collapse text-xs sm:text-sm">
                      <thead className={`sticky top-0 z-10 ${modalHeader}`}>
                        <tr>
                          <th className="py-2.5 px-3 font-black uppercase text-[11px]">{t('prep.hour')}</th>
                          {PROTEINS.map((p) => (
                            <th key={p} className="py-2.5 px-3 font-black uppercase text-[11px] text-center">
                              {p}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#D8D0C2]/60 dark:divide-[#2C3038]">
                        {visibleGuideRows.map((row) => (
                          <tr key={row.time} className="hover:bg-black/[0.03] dark:hover:bg-white/[0.03]">
                            <td className="py-2 px-3 font-black tabular-nums whitespace-nowrap">{row.time}</td>
                            {PROTEINS.map((p) => (
                              <td key={p} className="py-2 px-3 text-center tabular-nums">
                                <span className="font-black text-sm">{row[p]?.maxTray ?? 1}</span>
                                <span className={`ml-1 text-[10px] font-bold ${mutedText}`}>
                                  ({row[p]?.avg ?? 0})
                                </span>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 6. Modal VER DÍA (Desglose por hora 6 AM → 5 AM) */}
      <AnimatePresence>
        {showDayModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/75 z-[99995] flex items-center justify-center p-3 sm:p-5"
            onClick={onCloseDayModal}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className={`rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden ${modalCard}`}
            >
              <div className={`px-4 py-3 flex items-center justify-between gap-2 shrink-0 ${modalHeader}`}>
                <div className="flex items-center gap-2.5">
                  <Calendar className="w-5 h-5 text-[#1D4ED8]" />
                  <div>
                    <h3 className="font-black text-base sm:text-lg">{t('prep.dayProjection')}</h3>
                    <p className={`text-xs font-semibold ${mutedText}`}>{t('prep.dayProjectionDesc')}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onCloseDayModal}
                  className={`w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer ${subtleSurface}`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4 flex-1 min-h-0 overflow-auto">
                <div className={`rounded-xl overflow-hidden ${subtleSurface}`}>
                  <table className="w-full text-left border-collapse text-xs sm:text-sm">
                    <thead className={modalHeader}>
                      <tr>
                        <th className="py-2.5 px-3 font-black uppercase text-[11px]">{t('prep.hour')}</th>
                        {PROTEINS.map((p) => (
                          <th key={p} className="py-2.5 px-3 font-black uppercase text-[11px] text-right">
                            {p}
                          </th>
                        ))}
                        <th className="py-2.5 px-3 font-black uppercase text-[11px] text-right">
                          {t('prep.hourTotal')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#D8D0C2]/60 dark:divide-[#2C3038]">
                      {hourlyData.map((row) => (
                        <tr key={row.hour} className="hover:bg-black/[0.03] dark:hover:bg-white/[0.03]">
                          <td className="py-2 px-3 font-black tabular-nums">{row.label}</td>
                          {PROTEINS.map((p) => (
                            <td key={p} className="py-2 px-3 text-right font-bold tabular-nums">
                              {Number(row[p] || 0).toFixed(1)}
                            </td>
                          ))}
                          <td className="py-2 px-3 text-right font-black tabular-nums">
                            {Number(row.total || 0).toFixed(1)} {t('prep.lbs')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className={modalHeader}>
                      <tr>
                        <td className="py-2.5 px-3 font-black uppercase text-xs">{t('prep.dailyPaceTotal')}</td>
                        {PROTEINS.map((p) => (
                          <td key={p} className="py-2.5 px-3 text-right font-black tabular-nums">
                            {dayTotals[p].toFixed(1)}
                          </td>
                        ))}
                        <td className="py-2.5 px-3 text-right font-black tabular-nums text-[#C8371A] dark:text-[#F87171]">
                          {grandDayTotal.toFixed(1)} {t('prep.lbs')}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 7. Modal REPORTE MERMAS (`z-[99995]`, `max={currentBusinessDate}`, colores semánticos corregidos) */}
      <AnimatePresence>
        {showWasteModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/75 z-[99995] flex items-center justify-center p-3 sm:p-5"
            onClick={onCloseWasteModal}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className={`rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden ${modalCard}`}
            >
              <div className={`px-4 py-3 flex flex-wrap items-center justify-between gap-2 shrink-0 ${modalHeader}`}>
                <div className="flex items-center gap-2.5">
                  <BarChart3 className="w-5 h-5 text-[#B45309]" />
                  <div>
                    <h3 className="font-black text-base sm:text-lg">{t('prep.wasteReport')}</h3>
                    <p className={`text-xs font-semibold ${mutedText}`}>{t('prep.wasteReportDesc')}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={selectedWasteDate}
                    max={currentBusinessDate}
                    onChange={(e) => {
                      if (e.target.value) onChangeWasteDate(e.target.value)
                    }}
                    className={`h-9 px-2.5 rounded-lg text-xs font-black tabular-nums border outline-none ${subtleSurface}`}
                  />
                  <button
                    type="button"
                    onClick={onToggleWasteInfo}
                    title={t('prep.calcInfo')}
                    className={`w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer ${subtleSurface}`}
                  >
                    <HelpCircle className="w-4 h-4 text-[#1D4ED8]" />
                  </button>
                  <button
                    type="button"
                    onClick={onCloseWasteModal}
                    className={`w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer ${subtleSurface}`}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="p-4 flex-1 min-h-0 overflow-y-auto space-y-3">
                {showWasteInfo && (
                  <div className={`p-3.5 rounded-xl text-xs space-y-1.5 ${subtleSurface}`}>
                    <p>{t('prep.wasteInfoProj')}</p>
                    <p>{t('prep.wasteInfoReal')}</p>
                    <p>{t('prep.wasteInfoVar')}</p>
                    <p>{t('prep.wasteInfoStatus')}</p>
                  </div>
                )}

                {loadingWasteData ? (
                  <div className="h-44 flex items-center justify-center gap-2">
                    <Loader2 className="w-5 h-5 animate-spin text-[#C8371A]" />
                    <span className="text-xs font-bold">{t('prep.calculatingHistory')}</span>
                  </div>
                ) : (
                  <div className={`rounded-xl overflow-x-auto ${subtleSurface}`}>
                    <table className="w-full text-left border-collapse text-xs sm:text-sm">
                      <thead className={modalHeader}>
                        <tr>
                          <th className="py-2.5 px-3 font-black uppercase text-[11px]">{t('prep.protein')}</th>
                          <th className="py-2.5 px-3 font-black uppercase text-[11px] text-right">
                            {t('prep.projLbs')}
                          </th>
                          <th className="py-2.5 px-3 font-black uppercase text-[11px] text-right">
                            {t('prep.realLbs')}
                          </th>
                          <th className="py-2.5 px-3 font-black uppercase text-[11px] text-right">
                            {t('prep.variance')}
                          </th>
                          <th className="py-2.5 px-3 font-black uppercase text-[11px] text-center">
                            {t('prep.status')}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#D8D0C2]/60 dark:divide-[#2C3038]">
                        {wasteData.map((row) => {
                          const proj = Number(row.totalProj || 0)
                          const real = Number(row.totalReal || 0)
                          const hasReal = Boolean(row.hasRealData)
                          const diff = real - proj
                          const pct = proj > 0 ? (diff / proj) * 100 : 0
                          const isOutOfRange = hasReal && Math.abs(pct) > 10
                          const isOverProjected = isOutOfRange && diff < 0 // Se proyectó de más (riesgo merma)
                          const isUnderProjected = isOutOfRange && diff > 0 // Se vendió de más

                          const statusBadge = !hasReal
                            ? isDark
                              ? 'bg-[#23272F] text-[#9CA3AF]'
                              : 'bg-[#E8E2D6] text-[#5C574F]'
                            : isOverProjected
                              ? 'bg-[#C8371A] text-white'
                              : isUnderProjected
                                ? 'bg-[#B45309] text-white'
                                : 'bg-[#15803D] text-white'

                          const diffColor = !hasReal
                            ? mutedText
                            : isOverProjected
                              ? 'text-[#C8371A] dark:text-[#F87171]'
                              : isUnderProjected
                                ? 'text-[#B45309] dark:text-[#FCD34D]'
                                : 'text-[#15803D] dark:text-[#4ADE80]'

                          return (
                            <tr key={row.proto} className="hover:bg-black/[0.03] dark:hover:bg-white/[0.03]">
                              <td className="py-3 px-3 font-black uppercase">{row.proto}</td>
                              <td className="py-3 px-3 text-right font-bold tabular-nums">{proj.toFixed(1)}</td>
                              <td className="py-3 px-3 text-right font-black tabular-nums">
                                {hasReal ? real.toFixed(1) : '—'}
                              </td>
                              <td className={`py-3 px-3 text-right font-black tabular-nums ${diffColor}`}>
                                {hasReal
                                  ? `${diff >= 0 ? '+' : ''}${diff.toFixed(1)} (${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%)`
                                  : '—'}
                              </td>
                              <td className="py-3 px-3 text-center">
                                <span
                                  className={`inline-block px-2.5 py-1 rounded-md text-[11px] font-black uppercase ${statusBadge}`}
                                >
                                  {!hasReal
                                    ? t('prep.pendingSync')
                                    : isOverProjected
                                      ? t('prep.overPrep')
                                      : isUnderProjected
                                        ? t('prep.underPrep')
                                        : t('prep.onTrack')}
                                </span>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 8. Modal INFO (Cómo funciona el cálculo) */}
      <AnimatePresence>
        {showInfoModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/75 z-[99995] flex items-center justify-center p-4"
            onClick={onCloseInfoModal}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className={`rounded-2xl max-w-2xl w-full max-h-[88vh] flex flex-col shadow-2xl overflow-hidden ${modalCard}`}
            >
              <div className={`px-4 py-3 flex items-center justify-between shrink-0 ${modalHeader}`}>
                <div className="flex items-center gap-2">
                  <HelpCircle className="w-5 h-5 text-[#1D4ED8]" />
                  <h3 className="font-black text-base sm:text-lg">{t('prep.meatProjection')}</h3>
                </div>
                <button
                  type="button"
                  onClick={onCloseInfoModal}
                  className={`w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer ${subtleSurface}`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-4 sm:p-5 overflow-y-auto space-y-3 text-xs sm:text-sm">
                <p className={`font-semibold ${mutedText}`}>{t('prep.meatProjectionDesc')}</p>
                <div className={`p-3.5 rounded-xl space-y-1.5 ${subtleSurface}`}>
                  <div className="font-black text-xs uppercase">{t('prep.rawPoundsTitle')}</div>
                  <p dangerouslySetInnerHTML={{ __html: t('prep.rawPoundsDesc') }} />
                  <p>{t('prep.rawPoundsStep1')}</p>
                  <p dangerouslySetInnerHTML={{ __html: t('prep.rawPoundsStep2') }} />
                  <p dangerouslySetInnerHTML={{ __html: t('prep.rawPoundsStep3') }} />
                </div>
                <div className={`p-3.5 rounded-xl space-y-1.5 ${subtleSurface}`}>
                  <div className="font-black text-xs uppercase">{t('prep.histAvgTitle')}</div>
                  <p>{t('prep.histAvgDesc')}</p>
                  <p dangerouslySetInnerHTML={{ __html: t('prep.histAvgPoint1') }} />
                  <p dangerouslySetInnerHTML={{ __html: t('prep.histAvgPoint2') }} />
                  <p dangerouslySetInnerHTML={{ __html: t('prep.histAvgPoint3') }} />
                </div>
                <div className={`p-3.5 rounded-xl space-y-1.5 ${subtleSurface}`}>
                  <div className="font-black text-xs uppercase">{t('prep.livePaceTitle')}</div>
                  <p>{t('prep.livePaceDesc')}</p>
                  <p dangerouslySetInnerHTML={{ __html: t('prep.livePacePoint1') }} />
                  <p dangerouslySetInnerHTML={{ __html: t('prep.livePacePoint2') }} />
                  <p dangerouslySetInnerHTML={{ __html: t('prep.livePacePoint3') }} />
                </div>
              </div>
              <div className={`px-4 py-3 border-t flex justify-end shrink-0 ${modalHeader}`}>
                <button
                  type="button"
                  onClick={onCloseInfoModal}
                  className="h-10 px-5 rounded-xl bg-[#171614] dark:bg-[#F5F2EB] text-white dark:text-[#111214] text-xs font-black uppercase cursor-pointer"
                >
                  {t('prep.understoodBtn')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
