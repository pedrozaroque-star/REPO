'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import { canEditChecklist } from '@/lib/checklistPermissions'

// Importar formularios (tendremos que crearlos después)
// import DailyForm from '@/components/checklists/DailyForm'
// import TemperaturasForm from '@/components/checklists/TemperaturasForm'
// etc...

function EditChecklistContent() {
  const params = useParams()
  const router = useRouter()
  const { user } = useAuth()
  const [checklist, setChecklist] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const tipo = params.tipo as string
  const id = params.id as string

  useEffect(() => {
    if (user) {
      fetchChecklist()
    }
  }, [user, id])

  const fetchChecklist = async () => {
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

      const res = await fetch(
        `${url}/rest/v1/assistant_checklists?id=eq.${id}&select=*`,
        {
          headers: {
            'apikey': key || '',
            'Authorization': `Bearer ${key}`
          }
        }
      )

      const data = await res.json()
      
      if (!Array.isArray(data) || data.length === 0) {
        setError('Checklist no encontrado')
        setLoading(false)
        return
      }

      const item = data[0]

      // Verificar permisos
      if (!user) {
        setError('Usuario no autenticado')
        setLoading(false)
        return
      }

      const editCheck = canEditChecklist(item.created_at, user.role, item.user_id, user.id)

      if (!editCheck.canEdit) {
        setError(editCheck.reason || 'No tienes permiso para editar este checklist')
        setLoading(false)
        return
      }

      setChecklist(item)
      setLoading(false)
    } catch (err) {
      console.error('Error:', err)
      setError('Error al cargar el checklist')
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-6xl mb-4">⏳</div>
            <p className="text-gray-600">Cargando checklist...</p>
          </div>
        </div>
      </div>
    )
  }

  if (error || !checklist) {
    return (
      <div className="flex">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md">
            <div className="text-6xl mb-4">⚠️</div>
            <h2 className="text-2xl font-bold text-red-600 mb-4">Error</h2>
            <p className="text-gray-700 mb-6">{error}</p>
            <button
              onClick={() => router.push('/checklists')}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-semibold">
              Volver a Checklists
            </button>
          </div>
        </div>
      </div>
    )
  }

  const typeLabels: any = {
    daily: 'Daily Checklist',
    temperaturas: 'Control de Temperaturas',
    sobrante: 'Producto Sobrante',
    recorrido: 'Recorrido de Turno',
    cierre: 'Checklist de Cierre',
    apertura: 'Checklist de Apertura'
  }

  return (
    <div className="flex">
      <Sidebar />
      <div className="flex-1 p-8 overflow-auto">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => router.push('/checklists')}
            className="text-blue-600 hover:text-blue-800 mb-4 flex items-center gap-2">
            ← Volver a Checklists
          </button>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Editar {typeLabels[tipo] || tipo}
          </h1>
          <p className="text-gray-600">
            Checklist ID: {id} | Fecha: {checklist.checklist_date}
          </p>
        </div>

        {/* Formulario */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
          <div className="bg-yellow-50 border-2 border-yellow-400 rounded-lg p-4 mb-6">
            <p className="font-bold text-yellow-800">⚠️ Modo Edición</p>
            <p className="text-sm text-yellow-700 mt-1">
              Estás editando un checklist existente. Los cambios se guardarán sobre el registro actual.
            </p>
          </div>

          {/* Aquí irá el formulario correspondiente */}
          <div className="text-center py-12">
            <div className="text-6xl mb-4">🚧</div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Formulario en Construcción</h3>
            <p className="text-gray-600 mb-6">
              Los formularios de edición están siendo creados.
            </p>
            
            {/* Datos del checklist actual */}
            <div className="bg-gray-50 rounded-lg p-6 max-w-2xl mx-auto text-left">
              <h4 className="font-bold mb-4">Datos actuales:</h4>
              <div className="space-y-2 text-sm">
                <p><span className="font-semibold">Tipo:</span> {checklist.checklist_type}</p>
                <p><span className="font-semibold">Fecha:</span> {checklist.checklist_date}</p>
                <p><span className="font-semibold">Turno:</span> {checklist.shift}</p>
                <p><span className="font-semibold">Score:</span> {checklist.score}%</p>
                <p><span className="font-semibold">Hora inicio:</span> {checklist.start_time}</p>
                <p><span className="font-semibold">Hora fin:</span> {checklist.end_time}</p>
                {checklist.comments && (
                  <p><span className="font-semibold">Comentarios:</span> {checklist.comments}</p>
                )}
              </div>
              
              {checklist.answers && (
                <div className="mt-4">
                  <h5 className="font-semibold mb-2">Respuestas:</h5>
                  <pre className="bg-white p-3 rounded text-xs overflow-auto max-h-48">
                    {JSON.stringify(checklist.answers, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            <button
              onClick={() => router.push('/checklists')}
              className="mt-6 bg-gray-600 hover:bg-gray-700 text-white px-6 py-3 rounded-lg font-semibold">
              Volver a Checklists
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function EditChecklistPage() {
  return (
    <ProtectedRoute>
      <EditChecklistContent />
    </ProtectedRoute>
  )
}