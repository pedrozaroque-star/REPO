'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft } from 'lucide-react'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import '@/app/checklists/checklists.css'
import { getSupabaseClient } from '@/lib/supabase'
import { useDynamicChecklist } from '@/hooks/useDynamicChecklist'
import DynamicQuestion from '@/components/checklists/DynamicQuestion'

interface Store {
  id: string
  name: string
  code?: string
}

function DailyChecklistContent() {
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
    shift: (new Date().getHours() >= 17 || new Date().getHours() < 7 ? 'PM' : 'AM') as 'AM' | 'PM',
    comments: ''
  })

  const [answers, setAnswers] = useState<{ [key: string]: any }>({})
  const [questionPhotos, setQuestionPhotos] = useState<{ [key: string]: string[] }>({})

  // Track start time for duration calculation
  const [startTime] = useState(() => new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }))

  const { data: template, loading: checklistLoading, error: checklistError, isCached } = useDynamicChecklist('daily_checklist_v1')
  const questions = template?.sections.flatMap((s: any) => s.questions) || []

  useEffect(() => {
    if (user) {
      fetchStores()
    }
  }, [user])

  const fetchStores = async () => {
    try {
      const supabase = await getSupabaseClient()
      const { data, error } = await supabase
        .from('stores')
        .select('id,name,code')
        .order('name', { ascending: true })

      if (error) throw error

      let loadedStores = (data as any[]) || []

      const userScope = (user as any)?.store_scope
      if (user?.role === 'asistente' && Array.isArray(userScope) && userScope.length > 0) {
        loadedStores = loadedStores.filter(s => userScope.includes(s.code) || userScope.includes(s.name))
      }

      setStores(loadedStores)

      if (user?.role === 'asistente' && Array.isArray(userScope) && userScope.length > 0 && loadedStores.length > 0) {
        const myStoreId = loadedStores[0].id.toString()
        setFormData(prev => ({ ...prev, store_id: myStoreId }))
      }

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

  const calculateScore = (): number => {
    const yesNoQuestions = questions.filter(q => q.type === 'yes_no')
    if (yesNoQuestions.length === 0) return 100

    const validAnswers = yesNoQuestions
      .map(q => answers[q.id])
      .filter(v => v !== undefined && v !== null && v !== 'NA')
    const siCount = validAnswers.filter(v => v === 'SI').length

    if (validAnswers.length > 0) return Math.round((siCount / validAnswers.length) * 100)
    return 100
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Validation
    const missingAnswers = questions.filter(q => {
      const val = answers[q.id]
      if (q.type === 'text') return !val || val.trim().length === 0
      if (q.type === 'photo') return !questionPhotos[q.id] || questionPhotos[q.id].length === 0
      return val === undefined || val === null
    })

    if (missingAnswers.length > 0) {
      alert(`⚠️ Faltan ${missingAnswers.length} preguntas por responder.`)
      return
    }

    const missingRequiredPhotos = questions.filter(q => q.required_photo && (!questionPhotos[q.id] || questionPhotos[q.id].length === 0))
    if (missingRequiredPhotos.length > 0) {
      alert(`📸 Hay ${missingRequiredPhotos.length} preguntas que requieren foto obligatoria.`)
      return
    }

    if (!user) {
      alert('Error: Sesión no válida')
      return
    }

    setLoading(true)
    try {
      const supabase = await getSupabaseClient()
      const score = calculateScore()

      // Flatten all photos for easy access
      const allPhotos = Object.values(questionPhotos).flat()

      // Format answers for legacy viewer
      const formattedAnswers: { [key: string]: any } = {}
      questions.forEach(q => {
        formattedAnswers[q.text] = answers[q.id]
      })

      // Add rich photo mapping
      formattedAnswers['__question_photos'] = questionPhotos

      // Get current local time for submit (end_time)
      const endTime = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })

      const { error } = await supabase.from('assistant_checklists').insert([{
        store_id: formData.store_id,
        user_id: user.id,
        user_name: user.name || user.email,
        checklist_type: 'daily',
        checklist_date: formData.checklist_date,
        shift: formData.shift,
        answers: formattedAnswers,
        score,
        comments: formData.comments,
        photos: allPhotos,
        start_time: startTime,
        end_time: endTime
      }])

      if (error) throw error
      setShowThanks(true)
    } catch (err: any) {
      console.error('Error:', err)
      alert('Error: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  if (!user) return null
  if (checklistLoading) return <div className="min-h-screen grid place-items-center bg-transparent"><div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
  if (checklistError) return <div className="min-h-screen grid place-items-center text-red-600">Error: {checklistError}</div>

  if (showThanks) {
    return (
      <div className="min-h-screen bg-transparent grid place-items-center animate-in zoom-in duration-500">
        <div className="text-center p-8 bg-white rounded-3xl shadow-2xl border border-gray-100 max-w-sm mx-auto">
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="text-8xl mb-6">✨</motion.div>
          <h1 className="text-4xl font-black text-gray-900 mb-2">¡Completado!</h1>
          <p className="text-gray-500 font-medium mb-8">El checklist ha sido registrado correctamente.</p>
          <button onClick={() => router.push('/dashboard')} className="w-full py-4 bg-blue-600 text-white font-bold rounded-2xl shadow-lg shadow-blue-100">
            Volver al Inicio
          </button>
        </div>
      </div>
    )
  }

  const score = calculateScore()
  const answeredCount = Object.keys(answers).length

  return (
    <div className="min-h-screen checklist-container pt-16 md:pt-0 flex flex-col">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm shrink-0">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <button onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center hover:bg-gray-100 rounded-xl transition-colors text-gray-600">
              <ChevronLeft size={24} />
            </button>
            <div>
              <h1 className="text-lg font-black text-gray-900 flex items-center gap-2">
                {template?.title || 'Daily Checklist'}
                {isCached && (
                  <span className="bg-yellow-500/10 text-yellow-600 text-[10px] px-2 py-0.5 rounded-full border border-yellow-400/20 font-bold uppercase tracking-widest">
                    Offline
                  </span>
                )}
              </h1>
              <div className="text-[10px] font-black text-blue-600 uppercase tracking-widest">{user?.name || user?.email}</div>
            </div>
          </div>
          <div className="bg-blue-600 text-white px-4 py-2 rounded-2xl shadow-lg shadow-blue-100 flex flex-col items-center min-w-[80px]">
            <div className="text-xl font-black leading-none">{score}%</div>
            <div className="text-[10px] font-bold uppercase opacity-80 mt-1">{answeredCount}/{questions.length}</div>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8 pb-32 w-full">
        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Metadata Card */}
          {/* Metadata Card */}
          <div className="bg-white rounded-3xl shadow-sm p-6 border border-gray-100 grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Sucursal *</label>
              <select required value={formData.store_id} onChange={(e) => setFormData({ ...formData, store_id: e.target.value })}
                className="w-full p-3 bg-gray-50 border-gray-100 rounded-xl font-bold text-gray-700 outline-none focus:ring-2 focus:ring-blue-100 transition-all">
                <option value="">Selecciona...</option>
                {stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Fecha *</label>
              <input type="date" required value={formData.checklist_date}
                onChange={(e) => setFormData({ ...formData, checklist_date: e.target.value })}
                className="w-full p-3 bg-gray-50 border-gray-100 rounded-xl font-bold text-gray-700 outline-none focus:ring-2 focus:ring-blue-100 transition-all" />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Turno *</label>
              <select value={formData.shift} onChange={(e) => setFormData({ ...formData, shift: e.target.value as 'AM' | 'PM' })}
                className="w-full p-3 bg-gray-50 border-gray-100 rounded-xl font-bold text-gray-700 outline-none focus:ring-2 focus:ring-blue-100 transition-all">
                <option value="AM">AM (Mañana)</option>
                <option value="PM">PM (Tarde/Noche)</option>
              </select>
            </div>
          </div>

          {/* Dynamic Questions Area */}
          <div className="space-y-12">
            {template?.sections.map((section: any) => (
              <div key={section.id} className="space-y-6">
                <div className="flex items-center gap-4 px-2">
                  <div className="h-[2px] flex-1 bg-gray-100" />
                  <h2 className="text-[10px] font-black text-blue-600 uppercase tracking-[0.3em]">{section.title}</h2>
                  <div className="h-[2px] flex-1 bg-gray-100" />
                </div>
                <div className="space-y-4">
                  {section.questions.map((question: any, idx: number) => (
                    <DynamicQuestion
                      key={question.id}
                      question={question}
                      index={idx}
                      value={answers[question.id]}
                      photos={questionPhotos[question.id] || []}
                      onChange={(val) => handleAnswer(question.id, val)}
                      onPhotosChange={(urls) => handlePhotosChange(question.id, urls)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Comments */}
          <div className="bg-white rounded-3xl shadow-sm p-6 border border-gray-100 space-y-3">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Observaciones Adicionales</label>
            <textarea value={formData.comments} onChange={(e) => setFormData({ ...formData, comments: e.target.value })} rows={3}
              className="w-full p-4 bg-gray-50 border-gray-100 rounded-2xl font-medium text-gray-700 outline-none focus:ring-2 focus:ring-blue-100 transition-all resize-none"
              placeholder="Escribe aquí cualquier detalle extra..." />
          </div>

          {/* Submit Footer */}
          <div className="pt-4">
            <button type="submit" disabled={loading}
              className="w-full bg-gradient-to-r from-blue-600 to-indigo-700 hover:from-blue-700 hover:to-indigo-800 text-white font-black text-lg py-5 rounded-3xl shadow-xl shadow-blue-100 transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-3">
              {loading ? <div className="w-6 h-6 border-4 border-white border-t-transparent rounded-full animate-spin" /> : 'Finalizar Checklist'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function DailyChecklistPage() {
  return (
    <ProtectedRoute>
      <DailyChecklistContent />
    </ProtectedRoute>
  )
}