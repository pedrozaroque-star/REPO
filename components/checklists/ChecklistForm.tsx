'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { ChevronLeft, Save } from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase'
import { useDynamicChecklist } from '@/hooks/useDynamicChecklist'
import DynamicQuestion from '@/components/checklists/DynamicQuestion'

const TEMPLATE_MAP: { [key: string]: string } = {
  daily: 'daily_checklist_v1',
  cierre: 'checklist_cierre',
  apertura: 'checklist_apertura',
  recorrido: 'recorrido_v1',
  temperaturas: 'temperaturas_v1',
  sobrante: 'sobrante_v1'
}

const COLOR_MAP: { [key: string]: string } = {
  daily: 'blue',
  cierre: 'purple',
  apertura: 'orange',
  recorrido: 'green',
  temperaturas: 'red',
  sobrante: 'yellow'
}

export default function ChecklistForm({ user, initialData, type = 'daily' }: { user: any, initialData?: any, type: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const templateCode = TEMPLATE_MAP[type] || 'daily_checklist_v1'
  const themeColor = COLOR_MAP[type] || 'blue'

  const { data: template, loading: checklistLoading, isCached } = useDynamicChecklist(templateCode)
  const sections = template?.sections || []
  const allQuestions = sections.flatMap((s: any) => s.questions)

  const [formData, setFormData] = useState({
    checklist_date: initialData?.checklist_date || new Date().toISOString().split('T')[0],
    shift: initialData?.shift || (new Date().getHours() >= 17 || new Date().getHours() < 7 ? 'PM' : 'AM'),
    comments: initialData?.comments || ''
  })

  const [answers, setAnswers] = useState<{ [key: string]: any }>({})
  const [questionPhotos, setQuestionPhotos] = useState<{ [key: string]: string[] }>({})

  useEffect(() => {
    if (initialData?.answers && allQuestions.length > 0) {
      const initialAnswers: { [key: string]: any } = {}
      allQuestions.forEach((q: any) => {
        // Attempt to find by text or legacy key
        const val = initialData.answers[q.text]
        if (val !== undefined) {
          initialAnswers[q.id] = val
        }
      })
      setAnswers(initialAnswers)
    }
  }, [initialData, allQuestions])

  const handleAnswer = (questionId: string, val: any) => {
    setAnswers(prev => ({ ...prev, [questionId]: val }))
  }

  const handlePhotosChange = (questionId: string, urls: string[]) => {
    setQuestionPhotos(prev => ({ ...prev, [questionId]: urls }))
  }

  const calculateScore = () => {
    if (type === 'temperaturas' || type === 'sobrante') {
      // For these, score is usually % of items captured if they are all weight/temp
      // But if they are yes_no, use normal logic.
      const scorable = allQuestions.filter(q => q.type === 'yes_no')
      if (scorable.length === 0) {
        // If all are numbers, maybe score is just 100 if all answered
        const answered = allQuestions.filter(q => answers[q.id] !== undefined && answers[q.id] !== null).length
        return Math.round((answered / allQuestions.length) * 100) || 0
      }
    }

    const yesNo = allQuestions.filter(q => q.type === 'yes_no')
    if (yesNo.length === 0) return 100

    const valid = yesNo.map(q => answers[q.id]).filter(v => v !== undefined && v !== null && v !== 'NA')
    const si = valid.filter(v => v === 'SI').length

    return valid.length > 0 ? Math.round((si / valid.length) * 100) : 100
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return alert('No user')

    // Validation
    const missing = allQuestions.filter(q => {
      const val = answers[q.id]
      if (q.type === 'text') return !val || val.trim().length === 0
      if (q.type === 'photo') return !questionPhotos[q.id] || questionPhotos[q.id].length === 0
      return val === undefined || val === null
    })

    if (missing.length > 0) {
      alert(`⚠️ Faltan ${missing.length} respuestas.`)
      return
    }

    setLoading(true)
    try {
      const supabase = await getSupabaseClient()
      const score = calculateScore()
      const newPhotos = Object.values(questionPhotos).flat()
      const allPhotos = [...(initialData?.photos || []), ...newPhotos]

      const formattedAnswers: { [key: string]: any } = {}
      allQuestions.forEach(q => {
        formattedAnswers[q.text] = answers[q.id]
      })

      // Add rich photo mapping
      formattedAnswers['__question_photos'] = questionPhotos

      const payload = {
        checklist_type: type,
        user_id: user.id,
        user_name: user.name || user.email,
        store_id: user.store_id || null,
        checklist_date: formData.checklist_date,
        shift: formData.shift,
        comments: formData.comments,
        answers: formattedAnswers,
        score: score,
        photos: allPhotos.length > 0 ? allPhotos : (initialData?.photos || null),
        status: initialData ? initialData.status : 'pendiente'
      }

      const { error } = initialData?.id
        ? await supabase.from('assistant_checklists').update(payload).eq('id', initialData.id)
        : await supabase.from('assistant_checklists').insert([payload])

      if (error) throw error

      alert('✅ Guardado con éxito')
      router.push('/checklists')
    } catch (err: any) {
      alert('Error: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  if (checklistLoading && !initialData) return <div className="p-12 text-center animate-pulse font-black text-gray-400 uppercase tracking-widest">Cargando Plantilla...</div>

  const score = calculateScore()
  const answeredCount = Object.keys(answers).length

  return (
    <div className="max-w-4xl mx-auto pb-24">
      <header className={`bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm rounded-t-3xl overflow-hidden`}>
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-lg shadow-${themeColor}-100 bg-${themeColor === 'yellow' ? 'yellow-500' : themeColor === 'orange' ? 'orange-500' : themeColor === 'purple' ? 'purple-600' : themeColor === 'green' ? 'green-500' : themeColor === 'red' ? 'red-600' : 'blue-600'}`}>
              <Save size={20} />
            </div>
            <div>
              <h1 className="text-lg font-black text-gray-900 flex items-center gap-2">
                {template?.title || 'Checklist'}
                {isCached && <span className="text-[9px] bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full border border-yellow-200">Offline</span>}
              </h1>
              <div className={`text-[10px] font-black uppercase tracking-widest text-${themeColor}-600`}>{user?.name || user?.email}</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="bg-gray-50 px-4 py-2 rounded-2xl border border-gray-100 flex flex-col items-center min-w-[70px]">
              <div className="text-xl font-black text-gray-900 leading-none">{score}%</div>
              <div className="text-[10px] font-bold text-gray-400 uppercase mt-1">Score</div>
            </div>
          </div>
        </div>
      </header>

      <div className="bg-white border-x border-b border-gray-200 rounded-b-3xl p-6 shadow-sm space-y-8">
        <div className="grid grid-cols-2 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Fecha</label>
            <input type="date" value={formData.checklist_date} onChange={e => setFormData({ ...formData, checklist_date: e.target.value })}
              className="w-full p-3 bg-gray-50 border-gray-100 rounded-xl font-bold text-gray-700 outline-none focus:ring-2 focus:ring-blue-100 transition-all" />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Turno</label>
            <select value={formData.shift} onChange={e => setFormData({ ...formData, shift: e.target.value })}
              className="w-full p-3 bg-gray-50 border-gray-100 rounded-xl font-bold text-gray-700 outline-none focus:ring-2 focus:ring-blue-100 transition-all">
              <option value="AM">☀️ AM (Mañana)</option>
              <option value="PM">🌙 PM (Tarde)</option>
            </select>
          </div>
        </div>

        <div className="space-y-12">
          {sections.map((section: any) => (
            <div key={section.id} className="space-y-6">
              <div className="flex items-center gap-4 px-2">
                <div className="h-[2px] flex-1 bg-gray-100" />
                <h2 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em]">{section.title}</h2>
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

        <div className="space-y-3">
          <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Comentarios</label>
          <textarea value={formData.comments} onChange={e => setFormData({ ...formData, comments: e.target.value })} rows={4}
            className="w-full p-4 bg-gray-50 border-gray-100 rounded-2xl font-medium text-gray-700 outline-none focus:ring-2 focus:ring-blue-100 transition-all resize-none"
            placeholder="Notas adicionales..." />
        </div>

        <div className="pt-4 flex gap-4">
          <button type="button" onClick={() => router.back()} className="flex-1 py-4 bg-gray-100 text-gray-500 font-bold rounded-2xl hover:bg-gray-200 transition-all">Cancelar</button>
          <button onClick={handleSubmit} disabled={loading}
            className={`flex-[2] py-4 rounded-2xl font-black text-white shadow-xl transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2 bg-${themeColor === 'yellow' ? 'yellow-600' : themeColor === 'orange' ? 'orange-600' : themeColor === 'purple' ? 'purple-600' : themeColor === 'green' ? 'green-600' : themeColor === 'red' ? 'red-600' : 'blue-600'}`}>
            {loading ? <div className="w-6 h-6 border-4 border-white border-t-transparent rounded-full animate-spin" /> : <><Save size={20} /><span>{initialData ? 'Guardar Cambios' : 'Finalizar'}</span></>}
          </button>
        </div>
      </div>
    </div>
  )
}
