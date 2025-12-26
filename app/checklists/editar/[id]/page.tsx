'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'

// Preguntas según tipo de checklist
const CHECKLIST_QUESTIONS: { [key: string]: any } = {
  daily: [
    'Todo el equipo alcanza la temperatura adecuada',
    'Cubeta roja de sanitizante bajo línea @ 200ppm',
    'Máquina de hielo limpia',
    'Área del trapeador limpia',
    'Microondas está limpio',
    'Estaciones de champurrado limpias',
    'Baño de empleados limpio',
    'Tanque de gas de refrescos lleno',
    'Checklists siendo usados',
    'Food Handler visible',
    'Se saluda a clientes dentro de 5 segundos',
    'Hacemos contacto visual con el cliente',
    'Ventanas limpias',
    'Baños limpios',
    'Estacionamiento limpio',
    'TVs funcionando',
    'Toda la iluminación funciona',
    'Mesas y sillas limpias',
    'Todas las luces funcionan',
    'Acero inoxidable limpio',
    'Rebanadoras y tijeras limpias',
    'Drenajes limpios',
    'Pisos y zócalos limpios',
    'Lavado de manos frecuente',
    'Área de escoba organizada',
    'Se utiliza FIFO',
    'Trapos en sanitizante',
    'Expedidor anuncia órdenes',
    'Cámaras funcionando',
    'SOS/DT Time visible',
    'Management consciente',
    'Manejo de efectivo correcto',
    'Reparaciones reportadas',
    'AC limpio'
  ],
  recorrido: [
    'Quitar publicidad y promociones vencidas',
    'Barrer todas las áreas',
    'Barrer y trapear cocinas',
    'Cambiar bolsas de basura',
    'Limpieza de baños',
    'Limpiar ventanas y puertas',
    'Limpiar mesas y sillas',
    'Organizar área de basura',
    'Limpiar refrigeradores',
    'Limpiar estufas y planchas',
    'Limpiar campanas',
    'Revisar inventario de limpieza',
    'Reportar reparaciones necesarias'
  ],
  apertura: [
    'Desarmar alarma y validar que estaba activada',
    'Encendido de vaporeras',
    'Encendido de refrigeradores',
    'Encendido de planchas',
    'Encendido de luces en linea y salon',
    'Encendido de pantallas y TVs',
    'Revision de baños, salon y parking',
    'Recepcion de mercancias adecuado',
    'Ordenar todas las mercancias en su lugar correspondiente',
    'Limpieza de Walking',
    'Apertura de Restaurante en tiempo',
    'Linea de produccion abastecida',
    'Apertura correcta de las cajas'
  ]
}

const CHECKLIST_TITLES: { [key: string]: string } = {
  daily: 'Daily Checklist',
  temperaturas: 'Control de Temperaturas',
  sobrante: 'Producto Sobrante',
  recorrido: 'Recorrido de Limpieza',
  cierre: 'Inspección de Cierre',
  apertura: 'Inspección de Apertura'
}

function EditAssistantChecklistContent() {
  const router = useRouter()
  const params = useParams()
  const { user } = useAuth()
  const checklistId = params?.id
  
  const [checklist, setChecklist] = useState<any>(null)
  const [answers, setAnswers] = useState<{[key: string]: any}>({})
  const [comments, setComments] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [canEdit, setCanEdit] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (user && checklistId) {
      loadChecklist()
    }
  }, [user, checklistId])

  const loadChecklist = async () => {
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

      const res = await fetch(
        `${url}/rest/v1/assistant_checklists?id=eq.${checklistId}&select=*`,
        {
          headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` }
        }
      )
      const data = await res.json()

      if (!Array.isArray(data) || data.length === 0) {
        setErrorMessage('Checklist no encontrado')
        setLoading(false)
        return
      }

      const checklistData = data[0]
      setChecklist(checklistData)

      // Validar permisos
      const validation = validateEditPermissions(checklistData)
      setCanEdit(validation.canEdit)
      setErrorMessage(validation.message)

      if (validation.canEdit) {
        setAnswers(checklistData.answers || {})
        setComments(checklistData.comments || '')
      }

      setLoading(false)
    } catch (err) {
      console.error('Error loading checklist:', err)
      setErrorMessage('Error al cargar el checklist')
      setLoading(false)
    }
  }

  const validateEditPermissions = (checklistData: any) => {
    // 1. Solo el creador
    if (checklistData.user_id !== user?.id) {
      return {
        canEdit: false,
        message: '❌ Solo el creador puede editar este checklist'
      }
    }

    // 2. Solo si está pendiente
    const managerStatus = checklistData.estatus_manager || 'pendiente'
    if (managerStatus !== 'pendiente') {
      return {
        canEdit: false,
        message: '❌ No se puede editar un checklist que ya ha sido revisado'
      }
    }

    // 3. Solo del día actual
    const checklistDateStr = checklistData.checklist_date
    
    const today = new Date()
    const year = today.getFullYear()
    const month = String(today.getMonth() + 1).padStart(2, '0')
    const day = String(today.getDate()).padStart(2, '0')
    const todayStr = `${year}-${month}-${day}`
    
    if (checklistDateStr !== todayStr) {
      return {
        canEdit: false,
        message: '❌ Solo se pueden editar checklists del día actual'
      }
    }

    return { canEdit: true, message: '' }
  }

  const handleAnswerChange = (key: string, value: any) => {
    setAnswers(prev => ({ ...prev, [key]: value }))
  }

  const calculateScore = () => {
    const type = checklist?.checklist_type
    
    // Sobrante y temperaturas siempre 100%
    if (type === 'sobrante' || type === 'temperaturas') {
      return 100
    }
    
    // Daily, recorrido, apertura, cierre: calcular SI/NO/NA
    const values = Object.values(answers).filter(v => v !== null)
    const siCount = values.filter(v => v === 'SI').length
    return values.length > 0 ? Math.round((siCount / values.length) * 100) : 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!canEdit) {
      alert('No tienes permisos para editar este checklist')
      return
    }

    setSaving(true)

    try {
      const score = calculateScore()

      const payload = {
        answers: answers,
        score: score,
        comments: comments || null
      }

      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

      const res = await fetch(`${url}/rest/v1/assistant_checklists?id=eq.${checklistId}`, {
        method: 'PATCH',
        headers: {
          'apikey': key || '',
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(payload)
      })

      if (res.ok) {
        alert(`✅ Checklist actualizado exitosamente!\n\nNuevo Score: ${score}%`)
        router.push('/checklists')
      } else {
        const error = await res.text()
        console.error('Error response:', error)
        alert('Error al actualizar el checklist')
      }
    } catch (err) {
      console.error('Error:', err)
      alert('Error al actualizar el checklist')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen bg-gray-50">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center md:ml-64">
          <div className="text-center">
            <div className="text-6xl mb-4">⏳</div>
            <p className="text-gray-600">Cargando checklist...</p>
          </div>
        </div>
      </div>
    )
  }

  if (!canEdit || errorMessage) {
    return (
      <div className="flex min-h-screen bg-gray-50">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center md:ml-64 p-4">
          <div className="bg-white rounded-xl shadow-lg p-8 max-w-md text-center">
            <div className="text-6xl mb-4">🔒</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">No se puede editar</h2>
            <p className="text-gray-700 mb-6">{errorMessage}</p>
            <button
              onClick={() => router.push('/checklists')}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-lg font-semibold transition-all">
              ← Volver a la lista
            </button>
          </div>
        </div>
      </div>
    )
  }

  const checklistType = checklist?.checklist_type
  const questions = CHECKLIST_QUESTIONS[checklistType] || []
  const title = CHECKLIST_TITLES[checklistType] || 'Checklist'
  const currentScore = calculateScore()
  const answered = Object.keys(answers).length

  // Renderizar según tipo
  const renderQuestions = () => {
    // Tipos con SI/NO/NA
    if (['daily', 'recorrido', 'apertura', 'cierre'].includes(checklistType)) {
      return (
        <div className="bg-white rounded-xl shadow-md p-6">
          <h3 className="text-lg font-bold text-indigo-600 mb-4">
            Preguntas ({questions.length})
          </h3>
          <div className="space-y-3">
            {questions.map((question: string, idx: number) => {
              const key = String(idx)
              const value = answers[key]
              
              return (
                <div key={idx} className="flex items-center justify-between gap-4 border border-gray-200 rounded-lg p-3">
                  <div className="flex-1 font-semibold text-sm">{idx + 1}. {question}</div>
                  <div className="flex gap-2">
                    {['SI', 'NO', 'NA'].map(val => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => handleAnswerChange(key, val)}
                        className={`px-3 py-1.5 rounded-lg font-semibold text-sm transition-all ${
                          value === val
                            ? val === 'SI' ? 'bg-green-600 text-white' : val === 'NO' ? 'bg-red-600 text-white' : 'bg-gray-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}>
                        {val === 'SI' ? 'Sí' : val}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )
    }

    // Temperaturas o Sobrante - mostrar inputs
    return (
      <div className="bg-white rounded-xl shadow-md p-6">
        <h3 className="text-lg font-bold text-indigo-600 mb-4">
          {checklistType === 'temperaturas' ? 'Temperaturas' : 'Productos'} ({Object.keys(answers).length})
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Object.entries(answers).map(([key, value]) => (
            <div key={key} className="border border-gray-200 rounded-lg p-3">
              <label className="block text-sm font-semibold text-gray-900 mb-2">
                {key.replace(/_/g, ' ')}
              </label>
              <input
                type="text"
                value={String(value)}
                onChange={(e) => handleAnswerChange(key, e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                placeholder="Valor"
              />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      
      <main className="flex-1 p-4 md:p-8 md:ml-64 mt-16 md:mt-0">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="mb-6">
            <button
              onClick={() => router.push('/checklists')}
              className="text-blue-600 hover:text-blue-800 mb-4 font-semibold">
              ← Volver
            </button>
            <h1 className="text-3xl font-bold text-gray-900">Editar {title}</h1>
            <p className="text-gray-600 mt-2">
              {checklist?.store_name} • {checklist?.checklist_date}
            </p>
          </div>

          {/* Progress */}
          {['daily', 'recorrido', 'apertura', 'cierre'].includes(checklistType) && (
            <div className="bg-white rounded-xl shadow-md p-6 mb-6">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-gray-700">
                  Progreso: {answered}/{questions.length}
                </span>
                <span className={`text-lg font-bold ${
                  currentScore >= 80 ? 'text-green-600' : 
                  currentScore >= 60 ? 'text-orange-600' : 'text-red-600'
                }`}>
                  Score: {currentScore}%
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div 
                  className="bg-indigo-600 h-3 rounded-full transition-all duration-300"
                  style={{ width: `${(answered / questions.length) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* Formulario */}
          <form onSubmit={handleSubmit} className="space-y-6">
            {renderQuestions()}

            {/* Comentarios */}
            <div className="bg-white rounded-xl shadow-md p-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Comentarios (Opcional)
              </label>
              <textarea
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                rows={4}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                placeholder="Agrega cualquier observación adicional..."
              />
            </div>

            {/* Botones */}
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => router.push('/checklists')}
                className="flex-1 bg-gray-600 hover:bg-gray-700 text-white py-3 rounded-lg font-semibold transition-all">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-lg font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                {saving ? 'Guardando...' : '✅ Guardar Cambios'}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  )
}

export default function EditAssistantChecklistPage() {
  return (
    <ProtectedRoute>
      <EditAssistantChecklistContent />
    </ProtectedRoute>
  )
}