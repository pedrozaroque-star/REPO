'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { ChevronLeft } from 'lucide-react'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import '@/app/checklists/checklists.css'
import { getSupabaseClient, formatStoreName } from '@/lib/supabase'
import { useDynamicChecklist } from '@/hooks/useDynamicChecklist'
import DynamicQuestion from '@/components/checklists/DynamicQuestion'
import SurpriseLoader from '@/components/SurpriseLoader'

interface Store {
  id: string
  name: string
  code?: string
}

function ManagerChecklistContent() {
  const router = useRouter()
  const { user } = useAuth()
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(false)
  const [showThanks, setShowThanks] = useState(false)
  const startTimeRef = React.useRef<Date>(new Date())

  const [formData, setFormData] = useState({
    store_id: '',
    checklist_date: (() => {
      const d = new Date()
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    })(),
    checklist_time: new Date().toTimeString().slice(0, 5),
    shift: (() => {
      const h = new Date().getHours()
      return (h >= 7 && h < 17) ? 'AM' : 'PM'
    })(),
    comments: ''
  })

  // Dynamic Hooks
  const { data: template, loading: checklistLoading, error: checklistError, isCached } = useDynamicChecklist('manager_checklist_v1')
  const sections = template?.sections || []
  const questions = sections.flatMap((s: any) => s.questions)

  const [answers, setAnswers] = useState<{ [key: string]: any }>({})
  const [questionPhotos, setQuestionPhotos] = useState<{ [key: string]: string[] }>({})

  useEffect(() => {
    if (user) fetchStores()
  }, [user])

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
        if ((user as any)?.store_id) {
          setFormData(prev => ({ ...prev, store_id: (user as any).store_id.toString() }))
        } else if (Array.isArray(userScope) && userScope.length > 0) {
          const match = loadedStores.find(s => userScope.includes(s.code) || userScope.includes(s.name))
          if (match) {
            setFormData(prev => ({ ...prev, store_id: match.id.toString() }))
          }
        }
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
    const validAnswers = yesNoQuestions.map(q => answers[q.id]).filter(v => v !== undefined && v !== null && v !== 'NA')
    const siCount = validAnswers.filter(v => v === 'SI').length

    if (validAnswers.length > 0) return Math.round((siCount / validAnswers.length) * 100)
    return 100
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!user) return alert('Sesión expirada')
    if (!formData.store_id) return alert('Selecciona una sucursal')

    // Validation
    const missingAnswers = questions.filter(q => {
      const val = answers[q.id]
      if (q.type === 'text') return !val || val.trim().length === 0
      if (q.type === 'photo') return !questionPhotos[q.id] || questionPhotos[q.id].length === 0
      return val === undefined || val === null
    })

    if (missingAnswers.length > 0) {
      alert(`⚠️ Faltan ${missingAnswers.length} tareas por reportar.`)
      return
    }

    const missingRequiredPhotos = questions.filter(q => q.required_photo && (!questionPhotos[q.id] || questionPhotos[q.id].length === 0))
    if (missingRequiredPhotos.length > 0) {
      alert(`📸 Hay ${missingRequiredPhotos.length} preguntas que requieren foto obligatoria.`)
      return
    }

    setLoading(true)

    try {
      const supabase = await getSupabaseClient()
      const allPhotos = Object.values(questionPhotos).flat()

      const formattedAnswers: { [key: string]: any } = {}
      questions.forEach(q => {
        formattedAnswers[q.text] = answers[q.id]
      })

      // Add rich photo mapping
      formattedAnswers['__question_photos'] = questionPhotos

      const endTime = new Date()
      const startTime = startTimeRef.current
      const durationMs = endTime.getTime() - startTime.getTime()
      const minutes = Math.floor(durationMs / 60000)
      const durationStr = `${minutes} min`

      // Format as HH:mm:ss
      const fmtTime = (d: Date) => d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })

      const payload = {
        store_id: parseInt(formData.store_id),
        user_id: user.id,
        manager_name: user.name || user.email,
        created_by: user.name || user.email,
        checklist_date: formData.checklist_date,
        checklist_time: formData.checklist_time,
        start_time: fmtTime(startTime),
        end_time: fmtTime(endTime),
        duration: durationStr,
        shift: formData.shift,
        answers: formattedAnswers,
        score: calculateScore(),
        comments: formData.comments || null,
        photo_urls: allPhotos.length > 0 ? allPhotos : null
      }

      const { error } = await supabase.from('manager_checklists').insert([payload])

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

  if (!user) return null
  if (checklistLoading) return <SurpriseLoader />
  if (checklistError) return <div className="min-h-screen grid place-items-center text-red-600 font-bold">Error: {checklistError}</div>

  if (showThanks) {
    return (
      <div className="min-h-screen bg-transparent grid place-items-center animate-in zoom-in duration-500">
        <div className="text-center p-8 bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-gray-100 dark:border-slate-800 max-w-sm mx-auto">
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="text-8xl mb-6">👔</motion.div>
          <h1 className="text-4xl font-black text-gray-900 dark:text-white mb-2">¡Todo Listo!</h1>
          <p className="text-gray-500 dark:text-slate-400 font-medium mb-8">El checklist de manager ha sido registrado correctamente.</p>
          <button onClick={() => router.push('/dashboard')} className="w-full py-4 bg-indigo-600 text-white font-bold rounded-2xl shadow-lg shadow-indigo-100 dark:shadow-none transition-transform active:scale-95">
            Volver al Inicio
          </button>
        </div>
      </div>
    )
  }

  const score = calculateScore()
  const answeredCount = Object.keys(answers).length

  return (
    <div className="min-h-screen bg-transparent dark:bg-neutral-900 pb-20 font-sans relative overflow-hidden">
      <div className="absolute inset-0 opacity-10 dark:opacity-40 pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>

      <header className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-gray-200 dark:border-slate-800 sticky top-0 z-40 shadow-sm shrink-0 transition-all">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <button onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors text-gray-600 dark:text-slate-400">
              <ChevronLeft size={24} />
            </button>
            <div>
              <h1 className="text-lg font-black text-gray-900 dark:text-white flex items-center gap-2">
                {template?.title || 'Manager Checklist'}
                {isCached && (
                  <span className="bg-yellow-500/10 text-yellow-600 text-[10px] px-2 py-0.5 rounded-full border border-yellow-400/20 font-bold uppercase tracking-widest">
                    Offline
                  </span>
                )}
              </h1>
              <div className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest">{user.name || user.email}</div>
            </div>
          </div>
          <div className="bg-indigo-600 text-white px-4 py-2 rounded-2xl shadow-lg shadow-indigo-100 dark:shadow-none flex flex-col items-center min-w-[80px]">
            <div className="text-xl font-black leading-none">{score}%</div>
            <div className="text-[10px] font-bold uppercase opacity-80 mt-1">{answeredCount}/{questions.length}</div>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8 pb-32 w-full">
        <form onSubmit={handleSubmit} className="space-y-8">
          <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-3xl shadow-sm p-6 border border-gray-100 dark:border-slate-800 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest">Sucursal *</label>
              <select required value={formData.store_id} onChange={(e) => setFormData({ ...formData, store_id: e.target.value })}
                className="w-full p-3 bg-gray-50 dark:bg-slate-800 border-gray-100 dark:border-slate-700 rounded-xl font-bold text-gray-700 dark:text-white outline-none focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-900/20 transition-all">
                <option value="">Selecciona...</option>
                {stores.map(store => <option key={store.id} value={store.id}>{formatStoreName(store.name)}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest">Fecha y Turno *</label>
              <div className="grid grid-cols-2 gap-3">
                <input type="date" required value={formData.checklist_date}
                  onChange={(e) => setFormData({ ...formData, checklist_date: e.target.value })}
                  className="w-full p-3 bg-gray-50 dark:bg-slate-800 border-gray-100 dark:border-slate-700 rounded-xl font-bold text-gray-700 dark:text-white outline-none focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-900/20 transition-all" />
                <select value={formData.shift} onChange={(e) => setFormData({ ...formData, shift: e.target.value as 'AM' | 'PM' })}
                  className="w-full p-3 bg-gray-50 dark:bg-slate-800 border-gray-100 dark:border-slate-700 rounded-xl font-bold text-gray-700 dark:text-white outline-none focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-900/20 transition-all">
                  <option value="AM">AM (Mañana)</option>
                  <option value="PM">PM (Tarde)</option>
                </select>
              </div>
            </div>

          </div>

          <div className="space-y-12">
            {sections.map((section: any) => (
              <div key={section.id} className="space-y-6">
                <div className="flex items-center gap-4 px-2">
                  <div className="h-[2px] flex-1 bg-gray-100 dark:bg-slate-800" />
                  <h2 className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-[0.3em]">{section.title}</h2>
                  <div className="h-[2px] flex-1 bg-gray-100 dark:bg-slate-800" />
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

          <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-3xl shadow-sm p-6 border border-gray-100 dark:border-slate-800 space-y-3">
            <label className="text-[10px] font-black text-gray-400 dark:text-slate-400 uppercase tracking-widest">Feedback General del Checklist</label>
            <textarea value={formData.comments} onChange={(e) => setFormData({ ...formData, comments: e.target.value })} rows={3}
              className="w-full p-4 bg-gray-50 dark:bg-slate-800 border-gray-100 dark:border-slate-800 rounded-2xl font-medium text-gray-700 dark:text-white outline-none focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-900/20 transition-all resize-none shadow-sm"
              placeholder="Notas generales sobre la operación de hoy..." />
          </div>

          <div className="pt-4">
            <button type="submit" disabled={loading}
              className="w-full bg-gradient-to-r from-indigo-600 to-violet-700 hover:from-indigo-700 hover:to-violet-800 text-white font-black text-lg py-5 rounded-3xl shadow-xl shadow-indigo-100 dark:shadow-none transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-3">
              {loading ? <div className="w-6 h-6 border-4 border-white border-t-transparent rounded-full animate-spin" /> : 'Finalizar Checklist'}
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