'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { ChevronLeft, MessageSquare, Star, Info, AlertCircle } from 'lucide-react'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import { getSupabaseClient } from '@/lib/supabase'
import { useDynamicChecklist } from '@/hooks/useDynamicChecklist'
import DynamicQuestion from '@/components/checklists/DynamicQuestion'
import '@/app/checklists/checklists.css'

interface Store {
  id: string
  name: string
  code?: string
}

function NuevoFeedbackContent() {
  const router = useRouter()
  const { user } = useAuth()
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(false)
  const [showThanks, setShowThanks] = useState(false)

  // -- DYNAMIC TEMPLATE --
  const { data: template, loading: templateLoading, error: templateError } = useDynamicChecklist('public_feedback_v1')
  const questions = template?.sections?.flatMap(s => s.questions) || []

  // -- FORM STATE --
  const [formData, setFormData] = useState({
    store_id: '',
    submission_date: new Date().toISOString().split('T')[0],
    customer_name: '',
    customer_email: '',
    customer_phone: '',
    comments: ''
  })

  const [answers, setAnswers] = useState<{ [key: string]: any }>({})
  const [questionPhotos, setQuestionPhotos] = useState<{ [key: string]: string[] }>({})

  useEffect(() => {
    fetchStores()
  }, [])

  const fetchStores = async () => {
    try {
      const supabase = await getSupabaseClient()
      const { data } = await supabase.from('stores').select('id, name').order('name')
      setStores(data || [])
    } catch (err) {
      console.error('Error fetching stores:', err)
    }
  }

  const handleAnswer = (questionId: string, val: any) => {
    setAnswers(prev => ({ ...prev, [questionId]: val }))
  }

  const handlePhotosChange = (questionId: string, urls: string[]) => {
    setQuestionPhotos(prev => ({ ...prev, [questionId]: urls }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!user) return alert('Sesión expirada')
    if (!formData.store_id) return alert('Selecciona una sucursal')

    // Validation
    const missingAnswers = questions.filter(q => {
      const val = answers[q.id]
      if (q.type === 'photo') return false // Photo type usually handled separately or optional
      if (q.type === 'text') return !val || val.trim().length === 0
      return val === undefined || val === null
    })

    if (missingAnswers.length > 0) {
      alert(`⚠️ Faltan ${missingAnswers.length} campos por completar.`)
      return
    }

    const missingRequiredPhotos = questions.filter(q => q.required_photo && (!questionPhotos[q.id] || questionPhotos[q.id].length === 0))
    if (missingRequiredPhotos.length > 0) {
      alert(`📸 Faltan ${missingRequiredPhotos.length} fotos obligatorias.`)
      return
    }

    setLoading(true)

    try {
      const supabase = await getSupabaseClient()

      // Calculate NPS score and category if present in answers
      const npsQuestion = questions.find(q => q.type === 'nps_10')
      const nps_score = npsQuestion ? answers[npsQuestion.id] : 8
      let nps_category = 'passive'
      if (nps_score >= 9) nps_category = 'promoter'
      else if (nps_score <= 6) nps_category = 'detractor'

      // Flatten answers for legacy DB compatibility
      const formattedAnswers: { [key: string]: any } = {}
      questions.forEach(q => {
        formattedAnswers[q.text] = answers[q.id]
      })

      // Add rich photo mapping
      formattedAnswers['__question_photos'] = questionPhotos

      // New fields for reporting
      const findId = (text: string) => questions.find(q => q.text.toLowerCase().includes(text.toLowerCase()))?.id

      const payload = {
        store_id: parseInt(formData.store_id),
        submission_date: formData.submission_date,
        customer_name: formData.customer_name || 'Interno (Vía Admin)',
        customer_email: formData.customer_email || null,
        customer_phone: formData.customer_phone || null,
        comments: formData.comments || null,
        nps_score,
        nps_category,
        answers: formattedAnswers,
        photo_urls: Object.values(questionPhotos).flat(),
        // New fields for reporting
        service_rating: (findId('servicio') && answers[findId('servicio')!]) || 5,
        food_quality_rating: (findId('calidad') && answers[findId('calidad')!]) || 5,
        cleanliness_rating: (findId('limpieza') && answers[findId('limpieza')!]) || 5,
        speed_rating: (findId('rapidez') && answers[findId('rapidez')!]) || 5
      }

      const { error } = await supabase.from('customer_feedback').insert([payload])

      if (!error) {
        setShowThanks(true)
      } else {
        alert('Error: ' + error.message)
      }
    } catch (err: any) {
      alert('Error inesperado: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  if (showThanks) {
    return (
      <div className="min-h-screen bg-transparent p-4 flex items-center justify-center">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-3xl p-8 shadow-2xl max-w-md w-full text-center border border-gray-100">
          <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <Star size={40} fill="currentColor" />
          </div>
          <h2 className="text-3xl font-black text-gray-900 mb-4">¡Feedback Registrado!</h2>
          <p className="text-gray-600 mb-8 font-medium">La información ha sido guardada correctamente en el sistema de calidad.</p>
          <button onClick={() => router.push('/feedback')} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-2xl shadow-lg transition-all active:scale-95">
            Volver al Panel
          </button>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="checklist-container min-h-screen">
      <div className="checklist-header">
        <button onClick={() => router.push('/feedback')} className="back-button">
          <ChevronLeft size={24} />
        </button>
        <div className="header-content">
          <h1 className="header-title">Nuevo Feedback</h1>
          <p className="header-subtitle">Registro Manual de Satisfacción</p>
        </div>
      </div>

      <main className="main-content">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Metadata Section */}
          <section className="form-section">
            <h3 className="section-title">Información de la Visita</h3>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="input-group">
                <label className="input-label">Tienda *</label>
                <select
                  required
                  value={formData.store_id}
                  onChange={(e) => setFormData({ ...formData, store_id: e.target.value })}
                  className="modern-input"
                >
                  <option value="">Seleccionar Sucursal</option>
                  {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="input-group">
                <label className="input-label">Fecha *</label>
                <input
                  type="date"
                  required
                  value={formData.submission_date}
                  onChange={(e) => setFormData({ ...formData, submission_date: e.target.value })}
                  className="modern-input"
                />
              </div>
            </div>
          </section>

          {/* Customer Info */}
          <section className="form-section">
            <h3 className="section-title">Datos del Cliente (Opcional)</h3>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="input-group">
                <label className="input-label">Nombre</label>
                <input
                  type="text"
                  value={formData.customer_name}
                  onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
                  placeholder="Interno"
                  className="modern-input"
                />
              </div>
              <div className="input-group">
                <label className="input-label">Email</label>
                <input
                  type="email"
                  value={formData.customer_email}
                  onChange={(e) => setFormData({ ...formData, customer_email: e.target.value })}
                  className="modern-input"
                />
              </div>
            </div>
          </section>

          {/* Dynamic Questions */}
          {templateLoading ? (
            <div className="flex justify-center py-10">
              <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : templateError ? (
            <div className="bg-red-50 p-4 rounded-xl border border-red-200 text-red-700 flex items-center gap-3">
              <AlertCircle size={20} />
              <p>Error al cargar la plantilla: {templateError}</p>
            </div>
          ) : (
            template?.sections?.map((section) => (
              <section key={section.id} className="form-section">
                <h3 className="section-title">{section.title}</h3>
                <div className="space-y-4 divider-y">
                  {section.questions.map((q, qIdx) => (
                    <DynamicQuestion
                      key={q.id}
                      index={qIdx}
                      question={q}
                      value={answers[q.id]}
                      onChange={(val) => handleAnswer(q.id, val)}
                      photos={questionPhotos[q.id] || []}
                      onPhotosChange={(urls) => handlePhotosChange(q.id, urls)}
                    />
                  ))}
                </div>
              </section>
            ))
          )}

          <div className="pt-6">
            <button
              type="submit"
              disabled={loading || templateLoading}
              className={`submit-button ${loading ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  Guardando...
                </div>
              ) : '✅ Guardar Registro'}
            </button>
          </div>
        </form>
      </main>
    </div>
  )
}

export default function NuevoFeedbackPage() {
  return (
    <ProtectedRoute>
      <NuevoFeedbackContent />
    </ProtectedRoute>
  )
}
