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
    <div className="flex min-h-screen">

      <div className="flex-1">
        <div className="p-8">
          {/* Header */}
          <div className="mb-8">
            <button
              onClick={() => router.push('/checklists')}
              className="flex items-center text-gray-600 hover:text-gray-900 mb-4"
            >
              <span className="mr-2">←</span>
              Volver a Checklists
            </button>
            <h1 className="text-3xl font-bold text-gray-900">Crear Nuevo Checklist</h1>
            <p className="text-gray-600 mt-2">Selecciona el tipo de checklist que deseas crear</p>
          </div>

          {/* Manager Checklist (si aplica) */}
          {canCreateManager && (
            <div className="mb-8">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Manager</h2>
              <button
                onClick={() => handleSelectType('manager')}
                className="group w-full bg-white rounded-xl shadow-lg hover:shadow-2xl transition-all duration-300 overflow-hidden transform hover:-translate-y-1"
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${MANAGER_CHECKLIST.color} opacity-0 group-hover:opacity-10 transition-opacity`} />
                <div className="p-6 flex items-center">
                  <div className="text-5xl mr-6">{MANAGER_CHECKLIST.icon}</div>
                  <div className="flex-1 text-left">
                    <h3 className="text-xl font-bold text-gray-900 mb-1">{MANAGER_CHECKLIST.title}</h3>
                    <p className="text-gray-600 text-sm">{MANAGER_CHECKLIST.description}</p>
                  </div>
                  <div className="text-gray-400">→</div>
                </div>
              </button>
            </div>
          )}

          {/* Assistant Checklists */}
          {availableChecklists.length > 0 && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-4">Asistente</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {availableChecklists.map(checklist => (
                  <button
                    key={checklist.key}
                    onClick={() => handleSelectType(checklist.key)}
                    className="group relative bg-white rounded-xl shadow-lg hover:shadow-2xl transition-all duration-300 overflow-hidden transform hover:-translate-y-1"
                  >
                    <div className={`absolute inset-0 bg-gradient-to-br ${checklist.color} opacity-0 group-hover:opacity-10 transition-opacity`} />
                    <div className="p-6">
                      <div className="text-5xl mb-4">{checklist.icon}</div>
                      <h3 className="text-lg font-bold text-gray-900 mb-2">{checklist.title}</h3>
                      <p className="text-gray-600 text-sm">{checklist.description}</p>
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
              <h3 className="text-xl font-bold text-gray-900 mb-2">Sin permisos</h3>
              <p className="text-gray-600">No tienes permisos para crear checklists</p>
            </div>
          )}
        </div>
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
