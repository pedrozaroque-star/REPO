'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'

// 53 Preguntas (las mismas del formulario de creación)
const SECTIONS = [
  {
    title: 'Cookline and Kitchen',
    items: [
      'No trash or oil under all grills equipment',
      'All products are at proper temperature',
      'Sneeze Guards are cleaned (fingerprints etc)',
      'All stainless steel is clean and polished',
      'All hoods are clean and in working order',
      'Grills are clean (panels on side no buildup)',
      'All trash cans are clean (inside out)',
      'Walls and all doors are clean',
      'Nacho cheese machine is clean',
      'Food is fresh and looks appetizing to guest',
      'Buckets @200ppm, are being utilized; towels not sitting on line',
      'Walk-in walls, floors and baseboards are clean and swept',
      'All items are 6" above ground (boxes, mops, etc.)',
      'Prep Stations are cleaned and sanitized',
      'All equipment is in working order',
      'Delivery is put away and is organized',
      'All lighting and vents are working and clean',
      'Gaskets are clean and not ripped',
      'Soda nozzles are clean (no mildew)',
      'Ice machine is free of mildew and wiped down',
      'Scissors/Tomato/Lime clean and working',
      'All drains are clean',
      'Employee restroom is clean and stocked',
      'All open bags are stored properly'
    ]
  },
  {
    title: 'Dining Room & Guest Areas',
    items: [
      "Clean/dust furniture, TV's, etc.",
      'Windows and window seals are clean',
      'Restrooms are clean and in working order',
      '5 Second greeting and upsell (welcoming guests)',
      'Music and AC at appropriate level',
      'Dining room is clean / Parking Lot',
      'Walls, drink stations are clean',
      'Vents and ceiling tiles are clean and in working order',
      'Uniforms are clean and free of stains',
      'Menuboards are working',
      'Trash can area clean and wiped down',
      'Table touching guest in dining room',
      'Parking Lot and trash cans clean',
      'Entry doors clean (No smudges)'
    ]
  },
  {
    title: 'Checklist and Reports',
    items: [
      'Food handlers cards are on file',
      'Is store fully staffed',
      'What is labor % for week',
      'How many assistants? Shift leaders',
      'Are all checklists being utilized? Complete',
      'Schedule posted and clear to read',
      'Are managers aware of employees time clock errors? (Ronos/Toast)',
      'Action plans in place for any team members (WHO)',
      'Are sales up from prior weeks',
      'Does everyone have at least one day off',
      'Is everyone trained on new processes',
      'Has all repairs been reported on Basecamp',
      'Cash handling procedures are being followed'
    ]
  },
  {
    title: 'Additional',
    items: [
      'Temperature is taken of each employee on shift',
      'Any employee issues reported to DM',
      'Soda CO2 is 1/4 or less, let manager know'
    ]
  }
]

function EditManagerChecklistContent() {
  const router = useRouter()
  const params = useParams()
  const { user } = useAuth()
  const checklistId = params?.id
  
  const [checklist, setChecklist] = useState<any>(null)
  const [answers, setAnswers] = useState<{[key: string]: string}>({})
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
        `${url}/rest/v1/manager_checklists?id=eq.${checklistId}&select=*`,
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

      // Validar permisos de edición
      const validation = validateEditPermissions(checklistData)
      setCanEdit(validation.canEdit)
      setErrorMessage(validation.message)

      if (validation.canEdit) {
        // Cargar respuestas existentes
        if (checklistData.answers) {
          const loadedAnswers: {[key: string]: string} = {}
          Object.entries(checklistData.answers).forEach(([key, answer]: [string, any]) => {
            loadedAnswers[key] = answer.value || answer
          })
          setAnswers(loadedAnswers)
        }
        
        // Cargar comentarios
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
  // 1. Validar que sea el creador
  if (checklistData.user_id !== user?.id) {
    return {
      canEdit: false,
      message: '❌ Solo el creador puede editar este checklist'
    }
  }

  // 2. Validar que NO esté revisado
  const supervisorStatus = checklistData.estatus_supervisor || 'pendiente'
  const adminStatus = checklistData.estatus_admin || 'pendiente'
  
  if (supervisorStatus !== 'pendiente' || adminStatus !== 'pendiente') {
    return {
      canEdit: false,
      message: '❌ No se puede editar un checklist que ya ha sido revisado'
    }
  }

  // 3. Validar que sea del día actual - CORRECCIÓN
  const checklistDateStr = checklistData.checklist_date
  
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  const todayStr = `${year}-${month}-${day}`
  
  console.log('🔍 DEBUG - Validación de fechas:')
  console.log('  Checklist date:', checklistDateStr)
  console.log('  Today:', todayStr)
  console.log('  Match:', checklistDateStr === todayStr)
  
  if (checklistDateStr !== todayStr) {
    return {
      canEdit: false,
      message: `❌ Solo se pueden editar checklists del día actual`
    }
  }

  console.log('✅ Todas las validaciones pasaron')
  return { canEdit: true, message: '' }
}

  const handleAnswerChange = (sectionIdx: number, itemIdx: number, value: string) => {
    const key = `s${sectionIdx}_${itemIdx}`
    setAnswers(prev => ({ ...prev, [key]: value }))
  }

  const calculateScore = () => {
    const totalQuestions = SECTIONS.reduce((sum, section) => sum + section.items.length, 0)
    const answeredYes = Object.values(answers).filter(v => v === 'SI').length
    return totalQuestions > 0 ? Math.round((answeredYes / totalQuestions) * 100) : 0
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

      // Convertir answers a formato JSONB con {value: 'SI'}
      const formattedAnswers: {[key: string]: {value: string}} = {}
      Object.entries(answers).forEach(([key, value]) => {
        formattedAnswers[key] = { value }
      })

      const payload = {
        answers: formattedAnswers,
        score: score,
        comments: comments || null
      }

      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

      const res = await fetch(`${url}/rest/v1/manager_checklists?id=eq.${checklistId}`, {
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
        router.push('/checklists-manager')
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
            <div className="space-y-3">
              <button
                onClick={() => router.push('/checklists-manager')}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-lg font-semibold transition-all">
                ← Volver a la lista
              </button>
              {checklist && (
                <button
                  onClick={() => router.push(`/checklists-manager/ver/${checklistId}`)}
                  className="w-full bg-gray-600 hover:bg-gray-700 text-white px-6 py-3 rounded-lg font-semibold transition-all">
                  👁️ Ver detalles
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  const answeredCount = Object.keys(answers).length
  const totalQuestions = SECTIONS.reduce((sum, section) => sum + section.items.length, 0)
  const currentScore = calculateScore()

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      
      <main className="flex-1 p-4 md:p-8 md:ml-64 mt-16 md:mt-0">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="mb-6">
            <button
              onClick={() => router.push('/checklists-manager')}
              className="text-blue-600 hover:text-blue-800 mb-4 font-semibold">
              ← Volver
            </button>
            <h1 className="text-3xl font-bold text-gray-900">Editar Checklist Manager</h1>
            <p className="text-gray-600 mt-2">
              {checklist?.store_name} • {checklist?.checklist_date}
            </p>
          </div>

          {/* Progress Bar */}
          <div className="bg-white rounded-xl shadow-md p-6 mb-6">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-gray-700">
                Progreso: {answeredCount}/{totalQuestions} preguntas
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
                style={{ width: `${(answeredCount / totalQuestions) * 100}%` }}
              />
            </div>
          </div>

          {/* Formulario */}
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Secciones de preguntas */}
            {SECTIONS.map((section, sIdx) => (
              <div key={sIdx} className="bg-white rounded-xl shadow-md overflow-hidden">
                <div className="bg-gradient-to-r from-indigo-600 to-indigo-700 px-6 py-4">
                  <h2 className="text-xl font-bold text-white">{section.title}</h2>
                </div>
                <div className="p-6 space-y-4">
                  {section.items.map((item, iIdx) => {
                    const key = `s${sIdx}_${iIdx}`
                    const value = answers[key] || ''
                    
                    return (
                      <div key={iIdx} className="border-b border-gray-200 pb-4 last:border-0">
                        <p className="text-sm text-gray-700 mb-3 font-medium">{item}</p>
                        <div className="flex gap-3">
                          {['SI', 'NO', 'N/A'].map(option => (
                            <button
                              key={option}
                              type="button"
                              onClick={() => handleAnswerChange(sIdx, iIdx, option)}
                              className={`flex-1 px-4 py-2 rounded-lg font-semibold transition-all ${
                                value === option
                                  ? option === 'SI' 
                                    ? 'bg-green-600 text-white' 
                                    : option === 'NO'
                                    ? 'bg-red-600 text-white'
                                    : 'bg-gray-600 text-white'
                                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                              }`}>
                              {option}
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}

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
                onClick={() => router.push('/checklists-manager')}
                className="flex-1 bg-gray-600 hover:bg-gray-700 text-white py-3 rounded-lg font-semibold transition-all">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving || answeredCount < totalQuestions}
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

export default function EditManagerChecklistPage() {
  return (
    <ProtectedRoute>
      <EditManagerChecklistContent />
    </ProtectedRoute>
  )
}