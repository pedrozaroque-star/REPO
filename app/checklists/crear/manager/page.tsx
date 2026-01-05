'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import { MANAGER_QUESTIONS } from '@/lib/managerQuestions'
import '@/app/checklists/checklists.css'
import { getSupabaseClient } from '@/lib/supabase'

interface Store {
  id: string
  name: string
}

function ManagerChecklistContent() {
  const router = useRouter()
  const { user } = useAuth()
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(false)
  const [showThanks, setShowThanks] = useState(false)

  const [formData, setFormData] = useState({
    store_id: '',
    checklist_date: (() => {
      const d = new Date()
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    })(),
    checklist_time: new Date().toTimeString().slice(0, 5),
    shift: 'AM' as 'AM' | 'PM',
    comments: '',
    photos: [] as File[]
  })

  const [answers, setAnswers] = useState<{ [key: string]: 'SI' | 'NO' | 'NA' | null }>({})
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([])
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set([0, 1, 2, 3]))

  useEffect(() => {
    fetchStores()
  }, [])

  const fetchStores = async () => {
    try {
      const supabase = await getSupabaseClient()
      const { data, error } = await supabase
        .from('stores')
        .select('id,name,code')
        .order('name', { ascending: true })

      if (error) throw error
      const loadedStores = (data as any[]) || []

      const userScope = (user as any)?.store_scope
      if (user?.role === 'asistente' && Array.isArray(userScope) && userScope.length > 0) {
        const filtered = loadedStores.filter(s => userScope.includes(s.code) || userScope.includes(s.name))
        setStores(filtered)

        if (filtered.length > 0) {
          setFormData(prev => ({ ...prev, store_id: filtered[0].id.toString() }))
        }
      } else {
        setStores(loadedStores)
      }

    } catch (err) {
      console.error('Error fetching stores:', err)
    }
  }

  const handleAnswer = (sectionIdx: number, itemIdx: number, value: 'SI' | 'NO' | 'NA') => {
    // Generate key matching legacy: s0_0, s0_1, etc.
    const key = `s${sectionIdx}_${itemIdx}`
    setAnswers(prev => ({ ...prev, [key]: value }))
  }

  const calculateScore = (): number => {
    const values = Object.values(answers).filter(v => v !== null)
    const validValues = values.filter(v => v !== 'NA')
    const siCount = validValues.filter(v => v === 'SI').length

    if (validValues.length > 0) return Math.round((siCount / validValues.length) * 100)
    if (values.length > 0) return 100 // All NA = 100%
    return 0
  }

  const toggleSection = (idx: number) => {
    setExpandedSections(prev => {
      const newSet = new Set(prev)
      if (newSet.has(idx)) newSet.delete(idx)
      else newSet.add(idx)
      return newSet
    })
  }

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return
    const files = Array.from(e.target.files).slice(0, 10)
    setFormData({ ...formData, photos: files })

    const previews: string[] = []
    let loaded = 0

    files.forEach(file => {
      const reader = new FileReader()
      reader.onload = (e) => {
        if (e.target?.result) {
          previews.push(e.target.result as string)
          loaded++
          if (loaded === files.length) setPhotoPreviews([...previews])
        }
      }
      reader.readAsDataURL(file)
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!user) {
      alert('No se pudo obtener información del usuario')
      return
    }

    if (!formData.store_id) {
      alert('Por favor selecciona una sucursal')
      return
    }

    // Calculate total questions from imported configuration
    const totalQuestions = MANAGER_QUESTIONS.sections.reduce((sum, sec) => sum + sec.questions.length, 0)
    const answered = Object.keys(answers).length

    if (answered < totalQuestions) {
      alert(`Por favor responde TODAS las preguntas (${answered}/${totalQuestions})`)
      return
    }

    setLoading(true)

    try {
      let photoUrls: string[] = []
      if (formData.photos.length > 0) {
        const { uploadPhotos } = await import('@/lib/uploadPhotos')
        const prefix = `${formData.store_id}_manager_${formData.checklist_date}`
        photoUrls = await uploadPhotos(formData.photos, 'staff-photos', prefix)
      }

      const supabase = await getSupabaseClient()

      const payload = {
        store_id: parseInt(formData.store_id),
        user_id: user.id,
        manager_name: user.name || user.email, // Fallback if name is missing
        created_by: user.name || user.email,
        checklist_date: formData.checklist_date,
        checklist_time: formData.checklist_time,
        shift: formData.shift,
        answers: answers,
        score: calculateScore(),
        comments: formData.comments || null,
        photo_urls: photoUrls.length > 0 ? photoUrls : null
      }

      const { error } = await supabase
        .from('manager_checklists')
        .insert(payload)

      if (!error) {
        setShowThanks(true)
        setTimeout(() => {
          router.push('/checklists')
        }, 2000)
      } else {
        console.error('Error submitting checklist:', error)
        alert('Error al enviar. Intenta de nuevo: ' + error.message)
      }
    } catch (err: any) {
      console.error('Error:', err)
      alert('Error inesperado: ' + err.message)
    }

    setLoading(false)
  }

  if (!user) return null

  if (showThanks) {
    return (
      <div className="min-h-screen bg-transparent grid place-items-center">
        <div className="text-center">
          <div className="text-9xl mb-4">✅</div>
          <h1 className="text-5xl font-bold text-green-600 mb-3">¡Gracias!</h1>
          <p className="text-xl text-gray-700">Checklist enviado exitosamente</p>
          <p className="text-sm text-gray-500 mt-2">Redirigiendo...</p>
        </div>
      </div>
    )
  }

  const score = calculateScore()
  const totalQuestions = MANAGER_QUESTIONS.sections.reduce((sum, sec) => sum + sec.questions.length, 0)
  const answered = Object.keys(answers).length

  return (
    <div className="h-screen overflow-hidden checklist-container pt-16 md:pt-0 flex flex-col">
      <header className="bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-lg sticky top-0 z-40 shrink-0">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <button onClick={() => router.back()} className="text-2xl hover:bg-indigo-500 rounded-lg p-2">
              ←
            </button>
            <div className="text-4xl">👔</div>
            <div>
              <strong className="text-xl">Manager Checklist</strong>
              <div className="text-xs text-indigo-100">{user.name || user.email}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">{score}%</div>
            <div className="text-xs">{answered}/{totalQuestions}</div>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto max-w-6xl mx-auto px-4 py-6 w-full">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-900 mb-2">Sucursal *</label>
                <select required value={formData.store_id} onChange={(e) => setFormData({ ...formData, store_id: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500">
                  <option value="">Selecciona...</option>
                  {stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-900 mb-2">Fecha *</label>
                <input type="date" required value={formData.checklist_date}
                  onChange={(e) => setFormData({ ...formData, checklist_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-900 mb-2">Turno *</label>
                <select value={formData.shift} onChange={(e) => setFormData({ ...formData, shift: e.target.value as 'AM' | 'PM' })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500">
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                </select>
              </div>
            </div>
          </div>

          {MANAGER_QUESTIONS.sections.map((section, sIdx) => {
            const isExpanded = expandedSections.has(sIdx)
            const sectionAnswered = section.questions.filter((_, iIdx) => answers[`s${sIdx}_${iIdx}`]).length
            const sectionPercent = Math.round((sectionAnswered / section.questions.length) * 100)

            return (
              <div key={sIdx} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="flex items-center justify-between p-5 bg-gray-50 border-b border-gray-200 cursor-pointer hover:bg-gray-100"
                  onClick={() => toggleSection(sIdx)}>
                  <div>
                    <h3 className="text-lg font-bold text-indigo-600">{section.title}</h3>
                    <p className="text-sm text-gray-600">{sectionAnswered}/{section.questions.length} respondidas</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="px-3 py-1 bg-indigo-100 text-indigo-800 rounded-full font-bold text-sm">{sectionPercent}%</span>
                    <span className="text-2xl">{isExpanded ? '▾' : '▸'}</span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="p-5 space-y-3">
                    {section.questions.map((item, iIdx) => {
                      const key = `s${sIdx}_${iIdx}`
                      const currentValue = answers[key]

                      return (
                        <div key={iIdx} className="flex items-center justify-between gap-4 border border-gray-200 rounded-lg p-3">
                          <div className="flex-1 font-semibold text-sm">{item}</div>
                          <div className="flex gap-2">
                            {['SI', 'NO', 'NA'].map(val => (
                              <button key={val} type="button"
                                onClick={() => handleAnswer(sIdx, iIdx, val as any)}
                                className={`px-3 py-1.5 rounded-lg font-semibold text-sm transition-all ${currentValue === val
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
                )}
              </div>
            )
          })}

          <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
            <label className="block text-sm font-bold text-gray-900 mb-2">Comentarios</label>
            <textarea value={formData.comments}
              onChange={(e) => setFormData({ ...formData, comments: e.target.value })} rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 resize-none"
              placeholder="Observaciones adicionales..." />
          </div>

          <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
            <label className="block text-sm font-bold text-gray-900 mb-2">Fotos (opcional)</label>
            <input type="file" accept="image/*" multiple onChange={handlePhotoChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            <p className="text-xs text-gray-600 mt-1">Máximo 10 fotos</p>
            {photoPreviews.length > 0 && (
              <div className="grid grid-cols-5 gap-2 mt-3">
                {photoPreviews.map((preview, i) => (
                  <img key={i} src={preview} alt={`Preview ${i + 1}`} className="w-full h-24 object-cover rounded-lg" />
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
            <div className="h-4 bg-gray-200 rounded-full overflow-hidden mb-3">
              <div className="h-full bg-gradient-to-r from-indigo-400 to-indigo-500 transition-all duration-500"
                style={{ width: `${score}%` }} />
            </div>
            <p className="text-center mb-4">
              <span className="text-3xl font-bold">{score}%</span>
              <span className="text-gray-600 ml-2">Completado ({answered}/{totalQuestions})</span>
            </p>
            <button type="submit" disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-lg py-4 rounded-xl shadow-lg transition-all disabled:opacity-50">
              {loading ? '⏳ Enviando...' : 'Enviar Checklist de Manager'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function ManagerChecklistPage() {
  return (
    <ProtectedRoute allowedRoles={['manager', 'admin']}>
      <ManagerChecklistContent />
    </ProtectedRoute>
  )
}
