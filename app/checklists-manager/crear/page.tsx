'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import { uploadPhotos } from '@/lib/uploadPhotos'

// 53 Preguntas organizadas por sección
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
    title: 'Temperature is taken of each employee on shift',
    items: [
      'Any employee issues reported to DM',
      'Soda CO2 is 1/4 or less, let manager know'
    ]
  }
]

function CreateManagerChecklistContent() {
  const router = useRouter()
  const { user } = useAuth()
  
  const [formData, setFormData] = useState({
    checklist_date: new Date().toISOString().split('T')[0],
    start_time: '',
    end_time: '',
    shift: 'AM',
    store_id: '',
    comments: ''
  })
  
  const [answers, setAnswers] = useState<{[key: string]: string}>({})
  const [stores, setStores] = useState<any[]>([])
  const [photos, setPhotos] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchStores()
    
    // Set start time to now
    const now = new Date()
    const hours = String(now.getHours()).padStart(2, '0')
    const minutes = String(now.getMinutes()).padStart(2, '0')
    setFormData(prev => ({ ...prev, start_time: `${hours}:${minutes}` }))
  }, [])

  const fetchStores = async () => {
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      
      const res = await fetch(`${url}/rest/v1/stores?select=*&order=name.asc`, {
        headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` }
      })
      const data = await res.json()
      setStores(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Error loading stores:', err)
    }
  }

  const handleAnswerChange = (sectionIdx: number, itemIdx: number, value: string) => {
    const key = `s${sectionIdx}_${itemIdx}`
    setAnswers(prev => ({ ...prev, [key]: value }))
  }

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files)
      setPhotos(prev => [...prev, ...newFiles].slice(0, 5)) // Max 5 photos
    }
  }

  const removePhoto = (index: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== index))
  }

  const calculateScore = () => {
    const totalQuestions = SECTIONS.reduce((sum, section) => sum + section.items.length, 0)
    const answeredYes = Object.values(answers).filter(v => v === 'SI').length
    return totalQuestions > 0 ? Math.round((answeredYes / totalQuestions) * 100) : 0
  }

  const validateForm = () => {
    if (!formData.store_id) {
      alert('Por favor selecciona una sucursal')
      return false
    }
    if (!formData.start_time) {
      alert('Por favor ingresa la hora de inicio')
      return false
    }
    
    const totalQuestions = SECTIONS.reduce((sum, section) => sum + section.items.length, 0)
    const answeredQuestions = Object.keys(answers).length
    
    if (answeredQuestions < totalQuestions) {
      alert(`Por favor responde todas las preguntas. Respondidas: ${answeredQuestions}/${totalQuestions}`)
      return false
    }
    
    return true
  }

  const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault()
  
  if (!validateForm()) return
  if (!user) return

  setLoading(true)

  try {
    // Calcular end_time
    const now = new Date()
    const endTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    
    // Upload photos
    let photoUrls: string[] = []
    if (photos.length > 0) {
      setUploading(true)
      photoUrls = await uploadPhotos(photos, 'staff-photos', `manager_${user.id}`)
      setUploading(false)
    }

    const score = calculateScore()

    const payload = {
  store_id: parseInt(formData.store_id),
  user_id: user.id,
  manager_name: user.name || user.email,
  checklist_date: formData.checklist_date,
  checklist_time: formData.start_time, // ← CAMBIAR A endTime (formato HH:MM)
  start_time: formData.start_time,
  end_time: endTime,
  shift: formData.shift,
  answers: answers,
  score: score,
  comments: formData.comments || null,
  photo_urls: photoUrls.length > 0 ? photoUrls : null,
  created_by: user.email
}

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    const res = await fetch(`${url}/rest/v1/manager_checklists`, {
      method: 'POST',
      headers: {
        'apikey': key || '',
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(payload)
    })

    if (res.ok) {
      alert(`✅ Checklist guardado exitosamente!\n\nScore: ${score}%`)
      router.push('/checklists-manager')
    } else {
      const error = await res.text()
      console.error('Error response:', error)
      alert('Error al guardar el checklist')
    }
  } catch (err) {
    console.error('Error:', err)
    alert('Error al guardar el checklist')
  } finally {
    setLoading(false)
  }
}

  if (!user) return null

  const answeredCount = Object.keys(answers).length
  const totalQuestions = SECTIONS.reduce((sum, section) => sum + section.items.length, 0)
  const currentScore = calculateScore()

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      
      <main className="flex-1 p-8">
        <div className="max-w-5xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <button
              onClick={() => router.push('/checklists-manager')}
              className="text-blue-600 hover:text-blue-800 mb-4 font-semibold">
              ← Volver a Manager Checklists
            </button>
            <h1 className="text-3xl font-bold text-gray-900">Crear Manager Checklist</h1>
            <p className="text-gray-600 mt-2">Checklist de supervisión (53 preguntas)</p>
          </div>

          {/* Progress Bar */}
          <div className="bg-white rounded-xl shadow-md p-6 mb-6">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-gray-700">
                Progreso: {answeredCount} / {totalQuestions} preguntas
              </span>
              <span className="text-sm font-bold text-indigo-600">Score actual: {currentScore}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div
                className="bg-indigo-600 h-3 rounded-full transition-all duration-300"
                style={{ width: `${(answeredCount / totalQuestions) * 100}%` }}
              />
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            {/* Basic Info */}
            <div className="bg-white rounded-xl shadow-md p-6 mb-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Información General</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Sucursal *
                  </label>
                  <select
                    value={formData.store_id}
                    onChange={(e) => setFormData({ ...formData, store_id: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    required>
                    <option value="">Selecciona una sucursal</option>
                    {stores.map(store => (
                      <option key={store.id} value={store.id}>{store.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Turno
                  </label>
                  <select
                    value={formData.shift}
                    onChange={(e) => setFormData({ ...formData, shift: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-transparent">
                    <option value="AM">AM</option>
                    <option value="PM">PM</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Fecha
                  </label>
                  <input
                    type="date"
                    value={formData.checklist_date}
                    onChange={(e) => setFormData({ ...formData, checklist_date: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Hora de Inicio *
                  </label>
                  <input
                    type="time"
                    value={formData.start_time}
                    onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    required
                  />
                </div>
              </div>
            </div>

            {/* Questions by Section */}
            {SECTIONS.map((section, sIdx) => (
              <div key={sIdx} className="bg-white rounded-xl shadow-md p-6 mb-6">
                <h2 className="text-xl font-bold text-gray-900 mb-4">{section.title}</h2>
                
                <div className="space-y-3">
                  {section.items.map((question, qIdx) => {
                    const key = `s${sIdx}_${qIdx}`
                    const value = answers[key]
                    
                    return (
                      <div key={qIdx} className="border border-gray-200 rounded-lg p-4 hover:border-indigo-300 transition-colors">
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                          <div className="flex-1">
                            <span className="font-medium text-gray-900">{question}</span>
                          </div>
                          
                          <div className="flex gap-4">
                            <label className="flex items-center cursor-pointer">
                              <input
                                type="radio"
                                name={`q_${key}`}
                                value="SI"
                                checked={value === 'SI'}
                                onChange={(e) => handleAnswerChange(sIdx, qIdx, e.target.value)}
                                className="mr-2 w-4 h-4 text-green-600 focus:ring-2 focus:ring-green-500"
                              />
                              <span className="text-green-700 font-semibold">Sí</span>
                            </label>
                            
                            <label className="flex items-center cursor-pointer">
                              <input
                                type="radio"
                                name={`q_${key}`}
                                value="NO"
                                checked={value === 'NO'}
                                onChange={(e) => handleAnswerChange(sIdx, qIdx, e.target.value)}
                                className="mr-2 w-4 h-4 text-red-600 focus:ring-2 focus:ring-red-500"
                              />
                              <span className="text-red-700 font-semibold">No</span>
                            </label>
                            
                            <label className="flex items-center cursor-pointer">
                              <input
                                type="radio"
                                name={`q_${key}`}
                                value="NA"
                                checked={value === 'NA'}
                                onChange={(e) => handleAnswerChange(sIdx, qIdx, e.target.value)}
                                className="mr-2 w-4 h-4 text-gray-600 focus:ring-2 focus:ring-gray-500"
                              />
                              <span className="text-gray-700 font-semibold">N/A</span>
                            </label>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}

            {/* Photos */}
            <div className="bg-white rounded-xl shadow-md p-6 mb-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Fotos (Opcional)</h2>
              
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={handlePhotoChange}
                className="hidden"
                id="photo-upload"
              />
              
              <label
                htmlFor="photo-upload"
                className="inline-block bg-gray-600 hover:bg-gray-700 text-white px-6 py-3 rounded-lg font-semibold cursor-pointer transition-all">
                📷 Seleccionar Fotos (máx. 5)
              </label>

              {photos.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-4">
                  {photos.map((photo, idx) => (
                    <div key={idx} className="relative">
                      <img
                        src={URL.createObjectURL(photo)}
                        alt={`Photo ${idx + 1}`}
                        className="w-full h-32 object-cover rounded-lg border-2 border-gray-300"
                      />
                      <button
                        type="button"
                        onClick={() => removePhoto(idx)}
                        className="absolute top-1 right-1 bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-700">
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Comments */}
            <div className="bg-white rounded-xl shadow-md p-6 mb-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Comentarios (Opcional)</h2>
              <textarea
                value={formData.comments}
                onChange={(e) => setFormData({ ...formData, comments: e.target.value })}
                rows={4}
                placeholder="Observaciones generales..."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
              />
            </div>

            {/* Submit */}
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => router.push('/checklists-manager')}
                className="flex-1 bg-gray-600 hover:bg-gray-700 text-white py-4 rounded-lg font-semibold text-lg transition-all shadow-md">
                Cancelar
              </button>
              
              <button
                type="submit"
                disabled={loading || uploading}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-4 rounded-lg font-semibold text-lg transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed">
                {uploading ? 'Subiendo fotos...' : loading ? 'Guardando...' : `Guardar Checklist (${currentScore}%)`}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  )
}

export default function CreateManagerChecklistPage() {
  return (
    <ProtectedRoute>
      <CreateManagerChecklistContent />
    </ProtectedRoute>
  )
}