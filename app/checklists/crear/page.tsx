'use client'

/**
 * @module app/checklists/crear/page
 * @description Pantalla de selección para crear un nuevo checklist (Asistente o Manager).
 * @businessRules
 * - Asistentes solo ven los checklists operativos (Daily, Temperaturas, Sobrante, Recorrido, Cierre, Apertura).
 * - Managers y Administradores pueden acceder a todos los checklists operativos más el checklist de Manager.
 * @dataFlow
 * - Redirige a /checklists/crear/[tipo] al seleccionar una opción.
 * @notes
 * - Actualizado a diseño moderno glassmorphism con soporte completo para temas claro/oscuro.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ArrowRight, ClipboardCheck, Thermometer, Package, MapPin, Moon, Sun, Briefcase, Lock } from 'lucide-react'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import { useLanguage } from '@/lib/i18n'

type ChecklistType = 'daily' | 'temperaturas' | 'sobrante' | 'recorrido' | 'cierre' | 'apertura'

function CreateChecklistContent() {
  const router = useRouter()
  const { user } = useAuth()
  const { t } = useLanguage()
  const [selectedType, setSelectedType] = useState<string | null>(null)

  if (!user) return null

  const userRole = (user.role || '').toLowerCase()

  const ASSISTANT_CHECKLISTS = [
    {
      key: 'daily' as ChecklistType,
      title: t('checklists.descriptions.daily_title') || 'Daily Checklist',
      icon: '📋',
      description: t('checklists.descriptions.daily') || '34 verificaciones diarias',
      badgeColor: 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border-blue-100 dark:border-blue-800/40',
      accentColor: 'text-blue-600 dark:text-blue-400',
      hoverBorder: 'hover:border-blue-200 dark:hover:border-blue-800/50',
      roles: ['asistente', 'manager', 'admin', 'supervisor']
    },
    {
      key: 'temperaturas' as ChecklistType,
      title: t('checklists.descriptions.temperaturas_title') || 'Control de Temperaturas',
      icon: '🌡️',
      description: t('checklists.descriptions.temperaturas') || '21 lecturas de temperatura',
      badgeColor: 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border-red-100 dark:border-red-800/40',
      accentColor: 'text-red-600 dark:text-red-400',
      hoverBorder: 'hover:border-red-200 dark:hover:border-red-800/50',
      roles: ['asistente', 'manager', 'admin', 'supervisor']
    },
    {
      key: 'sobrante' as ChecklistType,
      title: t('checklists.descriptions.sobrante_title') || 'Producto Sobrante',
      icon: '📦',
      description: t('checklists.descriptions.sobrante') || '11 productos en libras',
      badgeColor: 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 border-amber-100 dark:border-amber-800/40',
      accentColor: 'text-amber-600 dark:text-amber-400',
      hoverBorder: 'hover:border-amber-200 dark:hover:border-amber-800/50',
      roles: ['asistente', 'manager', 'admin', 'supervisor']
    },
    {
      key: 'recorrido' as ChecklistType,
      title: t('checklists.descriptions.recorrido_title') || 'Recorrido de Limpieza',
      icon: '🚶',
      description: t('checklists.descriptions.recorrido') || 'Salón, cocina y parking',
      badgeColor: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 border-emerald-100 dark:border-emerald-800/40',
      accentColor: 'text-emerald-600 dark:text-emerald-400',
      hoverBorder: 'hover:border-emerald-200 dark:hover:border-emerald-800/50',
      roles: ['asistente', 'manager', 'admin', 'supervisor']
    },
    {
      key: 'cierre' as ChecklistType,
      title: t('checklists.descriptions.cierre_title') || 'Inspección de Cierre',
      icon: '🌙',
      description: t('checklists.descriptions.cierre') || '51 verificaciones de cierre',
      badgeColor: 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 border-purple-100 dark:border-purple-800/40',
      accentColor: 'text-purple-600 dark:text-purple-400',
      hoverBorder: 'hover:border-purple-200 dark:hover:border-purple-800/50',
      roles: ['asistente', 'manager', 'admin', 'supervisor']
    },
    {
      key: 'apertura' as ChecklistType,
      title: t('checklists.descriptions.apertura_title') || 'Inspección de Apertura',
      icon: '🌅',
      description: t('checklists.descriptions.apertura') || '13 procedimientos de apertura',
      badgeColor: 'bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 border-orange-100 dark:border-orange-800/40',
      accentColor: 'text-orange-600 dark:text-orange-400',
      hoverBorder: 'hover:border-orange-200 dark:hover:border-orange-800/50',
      roles: ['asistente', 'manager', 'admin', 'supervisor']
    }
  ]

  const MANAGER_CHECKLIST = {
    key: 'manager',
    title: t('checklists.descriptions.manager_title') || 'Manager Checklist',
    icon: '👔',
    description: t('checklists.descriptions.manager') || '53 preguntas de gestión y supervisión',
    badgeColor: 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border-indigo-100 dark:border-indigo-800/40',
    accentColor: 'text-indigo-600 dark:text-indigo-400',
    roles: ['manager', 'admin', 'supervisor']
  }

  const availableChecklists = ASSISTANT_CHECKLISTS.filter(checklist =>
    checklist.roles.includes(userRole)
  )

  const canCreateManager = MANAGER_CHECKLIST.roles.includes(userRole)

  const handleSelectType = (type: string) => {
    setSelectedType(type)
    router.push(`/checklists/crear/${type}`)
  }

  return (
    <div className="flex bg-transparent dark:bg-neutral-900 pb-20 font-sans relative overflow-hidden w-full min-h-screen">
      <div className="absolute inset-0 opacity-10 dark:opacity-40 pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
      
      <main className="flex-1 flex flex-col h-full w-full relative">
        {/* STICKY HEADER */}
        <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-gray-200 dark:border-slate-800 shadow-sm sticky top-14 lg:top-0 z-30 shrink-0 transition-all">
          <div className="max-w-6xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push('/checklists')}
                className="w-9 h-9 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-gray-600 dark:text-slate-300 transition-colors shadow-sm cursor-pointer"
                title={t('checklists.creation.back')}
              >
                <ChevronLeft size={20} />
              </button>
              <div>
                <h1 className="text-lg md:text-xl font-black text-gray-900 dark:text-white tracking-tight leading-none">
                  {t('checklists.creation.title')}
                </h1>
                <p className="hidden md:block text-[10px] text-gray-400 dark:text-slate-500 font-bold uppercase tracking-widest mt-1">
                  {t('checklists.creation.subtitle')}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="hidden sm:inline-block text-xs font-bold px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-100 dark:border-blue-800/40">
                {user.name || user.email}
              </span>
            </div>
          </div>
        </div>

        {/* CONTENT CONTAINER */}
        <div className="w-full max-w-6xl mx-auto p-4 md:p-8 space-y-8">
          
          {/* MANAGER CHECKLIST CARD (IF AUTHORIZED) */}
          {canCreateManager && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-black uppercase tracking-wider text-gray-400 dark:text-slate-500 px-1">
                  👔 {t('checklists.creation.manager_section')}
                </h2>
              </div>

              <button
                onClick={() => handleSelectType('manager')}
                className="group w-full bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-3xl p-6 shadow-sm hover:shadow-xl dark:shadow-none border border-gray-100 dark:border-slate-800 hover:border-indigo-200 dark:hover:border-indigo-800/60 transition-all duration-300 transform hover:-translate-y-0.5 text-left cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-3xl shadow-sm group-hover:scale-110 transition-transform">
                    {MANAGER_CHECKLIST.icon}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg md:text-xl font-black text-gray-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                        {MANAGER_CHECKLIST.title}
                      </h3>
                      <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-md bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300">
                        Manager
                      </span>
                    </div>
                    <p className="text-xs md:text-sm text-gray-500 dark:text-slate-400 font-medium mt-1">
                      {MANAGER_CHECKLIST.description}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 font-bold text-xs self-end md:self-center bg-indigo-50 dark:bg-indigo-900/30 px-4 py-2 rounded-xl group-hover:bg-indigo-600 group-hover:text-white transition-all">
                  <span>{t('checklists.creation.start')}</span>
                  <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                </div>
              </button>
            </div>
          )}

          {/* ASSISTANT CHECKLISTS GRID */}
          {availableChecklists.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-black uppercase tracking-wider text-gray-400 dark:text-slate-500 px-1">
                  📋 {t('checklists.creation.assistant_section')}
                </h2>
                <span className="text-[11px] font-bold text-gray-400 dark:text-slate-500">
                  {availableChecklists.length} disponibles
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
                {availableChecklists.map((checklist) => (
                  <button
                    key={checklist.key}
                    onClick={() => handleSelectType(checklist.key)}
                    className={`group relative bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-3xl p-5 md:p-6 shadow-sm hover:shadow-xl dark:shadow-none border border-gray-100 dark:border-slate-800 ${checklist.hoverBorder} transition-all duration-300 transform hover:-translate-y-1 text-left flex flex-col justify-between cursor-pointer`}
                  >
                    <div>
                      {/* Icon & Badge Header */}
                      <div className="flex items-center justify-between mb-4">
                        <div className="w-12 h-12 rounded-2xl bg-gray-50 dark:bg-slate-800/80 flex items-center justify-center text-2xl shadow-inner group-hover:scale-110 transition-transform">
                          {checklist.icon}
                        </div>
                        <span className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-full border ${checklist.badgeColor}`}>
                          {checklist.key}
                        </span>
                      </div>

                      {/* Title & Description */}
                      <h3 className="text-base md:text-lg font-black text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors mb-1.5">
                        {checklist.title}
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-slate-400 font-medium leading-relaxed mb-4">
                        {checklist.description}
                      </p>
                    </div>

                    {/* Footer Action */}
                    <div className="pt-3 border-t border-dashed border-gray-100 dark:border-slate-800 flex items-center justify-between">
                      <span className={`text-xs font-bold ${checklist.accentColor} flex items-center gap-1.5`}>
                        {t('checklists.creation.start')}
                        <ArrowRight size={13} className="group-hover:translate-x-1 transition-transform" />
                      </span>
                      <span className="text-[10px] text-gray-400 dark:text-slate-500 font-semibold">
                        Tacos Gavilan
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* EMPTY PERMISSIONS STATE */}
          {availableChecklists.length === 0 && !canCreateManager && (
            <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-3xl p-12 text-center border border-gray-100 dark:border-slate-800 shadow-sm max-w-md mx-auto">
              <div className="w-16 h-16 rounded-2xl bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 flex items-center justify-center mx-auto mb-4">
                <Lock size={32} />
              </div>
              <h3 className="text-lg font-black text-gray-900 dark:text-white mb-2">
                {t('checklists.creation.locked_title')}
              </h3>
              <p className="text-xs text-gray-500 dark:text-slate-400 font-medium">
                {t('checklists.creation.no_permission')}
              </p>
            </div>
          )}

        </div>
      </main>
    </div>
  )
}

export default function CreateChecklistPage() {
  return (
    <ProtectedRoute>
      <CreateChecklistContent />
    </ProtectedRoute>
  )
}
