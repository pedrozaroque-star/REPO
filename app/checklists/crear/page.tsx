'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'

type ChecklistType = 'daily' | 'temperaturas' | 'sobrante' | 'recorrido' | 'cierre' | 'apertura'

const ASSISTANT_CHECKLISTS = [
  {
    key: 'daily' as ChecklistType,
    title: 'Daily Checklist',
    icon: '📋',
    description: '34 verificaciones diarias',
    color: 'from-blue-500 to-blue-600',
    roles: ['asistente', 'manager', 'admin']
  },
  {
    key: 'temperaturas' as ChecklistType,
    title: 'Control de Temperaturas',
    icon: '🌡️',
    description: '21 lecturas de temperatura',
    color: 'from-red-500 to-red-600',
    roles: ['asistente', 'manager', 'admin']
  },
  {
    key: 'sobrante' as ChecklistType,
    title: 'Producto Sobrante',
    icon: '📦',
    description: '11 productos en libras',
    color: 'from-yellow-500 to-yellow-600',
    roles: ['asistente', 'manager', 'admin']
  },
  {
    key: 'recorrido' as ChecklistType,
    title: 'Recorrido de Limpieza',
    icon: '🚶',
    description: 'Salón, cocina y parking',
    color: 'from-green-500 to-green-600',
    roles: ['asistente', 'manager', 'admin']
  },
  {
    key: 'cierre' as ChecklistType,
    title: 'Inspección de Cierre',
    icon: '🌙',
    description: '51 verificaciones de cierre',
    color: 'from-purple-500 to-purple-600',
    roles: ['asistente', 'manager', 'admin']
  },
  {
    key: 'apertura' as ChecklistType,
    title: 'Inspección de Apertura',
    icon: '🌅',
    description: '13 procedimientos de apertura',
    color: 'from-orange-500 to-orange-600',
    roles: ['asistente', 'manager', 'admin']
  }
]

const MANAGER_CHECKLIST = {
  key: 'manager',
  title: 'Manager Checklist',
  icon: '👔',
  description: '53 preguntas de gestión',
  color: 'from-indigo-500 to-indigo-600',
  roles: ['manager', 'admin']
}

function CreateChecklistContent() {
  const router = useRouter()
  const { user } = useAuth()
  const [selectedType, setSelectedType] = useState<string | null>(null)

  if (!user) return null

  const userRole = user.role.toLowerCase()

  // Filtrar checklists según rol
  const availableChecklists = ASSISTANT_CHECKLISTS.filter(checklist =>
    checklist.roles.includes(userRole)
  )

  const canCreateManager = MANAGER_CHECKLIST.roles.includes(userRole)

  const handleSelectType = (type: string) => {
    setSelectedType(type)
    // Redirigir a la página del checklist
    router.push(`/checklists/crear/${type}`)
  }

  return (
    <div className="min-h-screen bg-neutral-900 flex flex-col items-center justify-start p-4 md:p-8 relative overflow-hidden">
      <div className="absolute inset-0 opacity-60 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] pointer-events-none"></div>

      <div className="w-full max-w-6xl z-10">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => router.push('/checklists')}
            className="flex items-center text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-white mb-6 transition-colors font-bold text-sm bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm px-4 py-2 rounded-full w-fit"
          >
            <span className="mr-2">←</span>
            Volver a Checklists
          </button>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Crear Nuevo Checklist</h1>
          <p className="text-gray-600 dark:text-slate-400 mt-2">Selecciona el tipo de checklist que deseas crear</p>
        </div>

        {/* Manager Checklist (si aplica) */}
        {canCreateManager && (
          <div className="mb-8">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Manager</h2>
            <button
              onClick={() => handleSelectType('manager')}
              className="group w-full bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-[2rem] shadow-sm dark:shadow-none hover:shadow-xl transition-all duration-300 overflow-hidden transform hover:-translate-y-1 border border-gray-100 dark:border-slate-800"
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${MANAGER_CHECKLIST.color} opacity-0 group-hover:opacity-10 transition-opacity`} />
              <div className="p-6 flex items-center">
                <div className="text-5xl mr-6">{MANAGER_CHECKLIST.icon}</div>
                <div className="flex-1 text-left">
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-1">{MANAGER_CHECKLIST.title}</h3>
                  <p className="text-gray-600 dark:text-slate-400 text-sm">{MANAGER_CHECKLIST.description}</p>
                </div>
                <div className="text-gray-400">→</div>
              </div>
            </button>
          </div>
        )}

        {/* Assistant Checklists */}
        {availableChecklists.length > 0 && (
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Asistente</h2>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {availableChecklists.map(checklist => (
                <button
                  key={checklist.key}
                  onClick={() => handleSelectType(checklist.key)}
                  className="group relative bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-[2rem] shadow-sm dark:shadow-none hover:shadow-xl transition-all duration-300 overflow-hidden transform hover:-translate-y-1 border border-gray-100 dark:border-slate-800"
                >
                  <div className={`absolute inset-0 bg-gradient-to-br ${checklist.color} opacity-0 group-hover:opacity-10 transition-opacity`} />
                  <div className="p-6 text-left">
                    <div className="text-5xl mb-4">{checklist.icon}</div>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">{checklist.title}</h3>
                    <p className="text-gray-600 dark:text-slate-400 text-sm">{checklist.description}</p>
                    <div className="mt-4 flex items-center justify-between">
                      <span className={`text-sm font-semibold bg-gradient-to-r ${checklist.color} bg-clip-text text-transparent`}>
                        Comenzar →
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Si no hay checklists disponibles */}
        {availableChecklists.length === 0 && !canCreateManager && (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">🔒</div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Sin permisos</h3>
            <p className="text-gray-600 dark:text-slate-400">No tienes permisos para crear checklists</p>
          </div>
        )}
      </div>
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
