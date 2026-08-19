'use client'

/**
 * @module ActividadesPage
 * @description Módulo unificado "Actividades" que fusiona ROLES + PROCEDIMIENTOS en 3 pestañas simples.
 * @businessRules
 * - Pestaña 1 (Catálogo): Librería maestra de actividades (operating_procedures)
 * - Pestaña 2 (Configurar Posiciones): Mapea actividades a puestos/estaciones (position_activities) — se hace UNA VEZ
 * - Pestaña 3 (Asignación Diaria): Asigna personas a posiciones cada día (station_assignments) — las actividades se heredan automáticamente
 * @dataFlow
 * - Catálogo → ProceduresTimeline (componente existente, reutilizado)
 * - Configurar → position_activities + operating_procedures
 * - Asignación → station_assignments + shifts + toast_employees + position_activities
 * @notes
 * - El manager Jesus de Slauson ya tiene datos en position_activities — se respetan 100%
 * - Este módulo NO modifica los módulos existentes (ROLES, PROCEDIMIENTOS) — coexisten
 */

import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ClipboardList, Settings, CalendarDays, BarChart3, Info, X } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import dynamic from 'next/dynamic'

// Lazy load tabs for performance
const CatalogoTab = dynamic(() => import('@/components/actividades/CatalogoTab'), {
  loading: () => <TabSkeleton />,
})
const ConfigurarPosicionesTab = dynamic(() => import('@/components/actividades/ConfigurarPosicionesTab'), {
  loading: () => <TabSkeleton />,
})
const AsignacionDiariaTab = dynamic(() => import('@/components/actividades/AsignacionDiariaTab'), {
  loading: () => <TabSkeleton />,
})
const ReportesChecklistTab = dynamic(() => import('@/components/actividades/ReportesChecklistTab'), {
  loading: () => <TabSkeleton />,
})

function TabSkeleton() {
  return (
    <div className="flex justify-center items-center h-64">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500" />
    </div>
  )
}

type TabKey = 'catalogo' | 'configurar' | 'asignacion' | 'reportes'

export default function ActividadesPage() {
  const { t } = useLanguage()
  const [activeTab, setActiveTab] = useState<TabKey>('asignacion')
  const [showHelpModal, setShowHelpModal] = useState(false)

  const tabs: { key: TabKey; label: string; icon: React.ReactNode; description: string }[] = [
    {
      key: 'catalogo',
      label: t('actividades.tabs.catalog'),
      icon: <ClipboardList size={18} />,
      description: t('actividades.tabs.catalog_desc'),
    },
    {
      key: 'configurar',
      label: t('actividades.tabs.configure_positions'),
      icon: <Settings size={18} />,
      description: t('actividades.tabs.configure_positions_desc'),
    },
    {
      key: 'asignacion',
      label: t('actividades.tabs.daily_assignment'),
      icon: <CalendarDays size={18} />,
      description: t('actividades.tabs.daily_assignment_desc'),
    },
    {
      key: 'reportes',
      label: t('actividades.tabs.reports'),
      icon: <BarChart3 size={18} />,
      description: t('actividades.tabs.reports_desc'),
    },
  ]

  return (
    <div className="min-h-screen bg-slate-50/50 dark:bg-[#0B1120] relative">
      {/* ═══ HEADER ═══ */}
      <div className="sticky top-0 z-30 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-slate-200/60 dark:border-slate-800/60">
        <div className="max-w-[1600px] mx-auto px-3 sm:px-6">
          {/* Title Row */}
          <div className="flex items-center justify-between py-3 sm:py-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-black bg-gradient-to-r from-orange-600 to-red-600 dark:from-orange-400 dark:to-red-400 bg-clip-text text-transparent flex items-center gap-2">
                <span>{t('actividades.title')}</span>
                <button
                  onClick={() => setShowHelpModal(true)}
                  className="p-1 rounded-full text-slate-400 hover:text-orange-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  title="Guía de uso"
                >
                  <Info size={20} />
                </button>
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                {t('actividades.subtitle')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-gradient-to-r from-orange-100 to-red-100 dark:from-orange-900/30 dark:to-red-900/30 text-orange-700 dark:text-orange-300 border border-orange-200/50 dark:border-orange-800/30">
                {t('actividades.badge_operations')}
              </span>
            </div>
          </div>

          {/* Tab Bar */}
          <div className="flex items-center gap-1 pb-0 overflow-x-auto scrollbar-hide -mb-px">
            {tabs.map((tab, idx) => {
              const isActive = activeTab === tab.key
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`group relative flex items-center gap-2 px-4 py-2.5 text-sm font-semibold whitespace-nowrap transition-all duration-200 border-b-2 rounded-t-lg ${
                    isActive
                      ? 'border-orange-500 text-orange-600 dark:text-orange-400 bg-orange-50/50 dark:bg-orange-950/20'
                      : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/30'
                  }`}
                  title={tab.description}
                >
                  <span className={`transition-transform duration-200 ${isActive ? 'scale-110' : 'group-hover:scale-105'}`}>
                    {tab.icon}
                  </span>
                  <span>{idx + 1}. {tab.label}</span>
                  {isActive && (
                    <motion.div
                      layoutId="activeTabIndicator"
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-red-500"
                      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* ═══ TAB CONTENT ═══ */}
      <div className="max-w-[1600px] mx-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === 'catalogo' && <CatalogoTab />}
            {activeTab === 'configurar' && <ConfigurarPosicionesTab />}
            {activeTab === 'asignacion' && <AsignacionDiariaTab />}
            {activeTab === 'reportes' && <ReportesChecklistTab />}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ═══ HELP MODAL ═══ */}
      <AnimatePresence>
        {showHelpModal && (
          <div className="fixed inset-0 z-[20000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white dark:bg-slate-900 rounded-[2rem] w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden border border-slate-200/80 dark:border-slate-800 shadow-2xl relative"
            >
              {/* Header */}
              <div className="bg-gradient-to-r from-orange-600 to-red-600 p-6 text-white relative flex-shrink-0 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white/10 rounded-xl">
                    <Info size={24} />
                  </div>
                  <h3 className="text-xl sm:text-2xl font-black uppercase tracking-tight">
                    {t('actividades.help.title')}
                  </h3>
                </div>
                <button
                  onClick={() => setShowHelpModal(false)}
                  className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-all"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 text-slate-800 dark:text-slate-200">
                <p className="text-sm sm:text-base font-medium text-slate-600 dark:text-slate-400">
                  {t('actividades.help.intro')}
                </p>

                {/* Steps Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Step 1 */}
                  <div className="bg-slate-50 dark:bg-slate-800/40 p-5 rounded-2xl border border-slate-100/80 dark:border-slate-800">
                    <h4 className="font-bold text-orange-600 dark:text-orange-400 text-sm mb-2 flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 flex items-center justify-center font-bold text-xs">1</span>
                      {t('actividades.tabs.catalog')}
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      {t('actividades.help.step1_desc')}
                    </p>
                  </div>

                  {/* Step 2 */}
                  <div className="bg-slate-50 dark:bg-slate-800/40 p-5 rounded-2xl border border-slate-100/80 dark:border-slate-800">
                    <h4 className="font-bold text-orange-600 dark:text-orange-400 text-sm mb-2 flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 flex items-center justify-center font-bold text-xs">2</span>
                      {t('actividades.tabs.configure_positions')}
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      {t('actividades.help.step2_desc')}
                    </p>
                  </div>

                  {/* Step 3 */}
                  <div className="bg-slate-50 dark:bg-slate-800/40 p-5 rounded-2xl border border-slate-100/80 dark:border-slate-800">
                    <h4 className="font-bold text-orange-600 dark:text-orange-400 text-sm mb-2 flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 flex items-center justify-center font-bold text-xs">3</span>
                      {t('actividades.tabs.daily_assignment')}
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      {t('actividades.help.step3_desc')}
                    </p>
                  </div>
                </div>

                {/* Practical Examples */}
                <div className="border-t border-slate-200 dark:border-slate-800 pt-6">
                  <h4 className="text-base font-black text-slate-900 dark:text-white mb-4 uppercase tracking-wider">
                    {t('actividades.help.examples_title')}
                  </h4>
                  <div className="space-y-4">
                    {/* Ex A */}
                    <div className="bg-indigo-50/30 dark:bg-indigo-950/10 p-4 rounded-xl border border-indigo-100/30 dark:border-indigo-900/20">
                      <h5 className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase mb-1">
                        {t('actividades.help.example1_title')}
                      </h5>
                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                        {t('actividades.help.example1_desc')}
                      </p>
                    </div>

                    {/* Ex B */}
                    <div className="bg-indigo-50/30 dark:bg-indigo-950/10 p-4 rounded-xl border border-indigo-100/30 dark:border-indigo-900/20">
                      <h5 className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase mb-1">
                        {t('actividades.help.example2_title')}
                      </h5>
                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                        {t('actividades.help.example2_desc')}
                      </p>
                    </div>

                    {/* Ex C */}
                    <div className="bg-indigo-50/30 dark:bg-indigo-950/10 p-4 rounded-xl border border-indigo-100/30 dark:border-indigo-900/20">
                      <h5 className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase mb-1">
                        {t('actividades.help.example3_title')}
                      </h5>
                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                        {t('actividades.help.example3_desc')}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="p-4 sm:p-6 border-t border-slate-200 dark:border-slate-800 flex justify-end bg-slate-50 dark:bg-slate-900/50 flex-shrink-0">
                <button
                  onClick={() => setShowHelpModal(false)}
                  className="px-6 py-2.5 bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-700 hover:to-red-700 text-white rounded-xl text-sm font-bold shadow-md hover:shadow-lg transition-all active:scale-95"
                >
                  {t('actividades.help.close')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
