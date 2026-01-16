'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { ShieldCheck, Camera, Send, Calendar, Clock, MapPin, Sun, Moon, CheckCircle2, AlertCircle, ChevronRight, Store, User, Hash, FileText, ArrowLeft, MoreHorizontal } from 'lucide-react'
import { getSupabaseClient, formatStoreName } from '@/lib/supabase'
import { useDynamicChecklist } from '@/hooks/useDynamicChecklist'
import DynamicQuestion from '@/components/checklists/DynamicQuestion'
import { getSafeLADateISO } from '@/lib/checklistPermissions'
import { getNumericValue } from '@/lib/scoreCalculator'

interface Store {
  id: string
  name: string
  code?: string
}

export default function InspectionForm({ user, initialData, stores }: { user: any, initialData?: any, stores: Store[] }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  // Dynamic Hooks
  const { data: template, loading: checklistLoading, error: checklistError, isCached } = useDynamicChecklist('supervisor_inspection_v1')

  const sections = useMemo(() => template?.sections || [], [template])
  const allQuestions = useMemo(() => sections.flatMap((s: any) => s.questions), [sections])

  const [formData, setFormData] = useState({
    store_id: initialData?.store_id?.toString() || '',
    inspection_date: initialData?.inspection_date ? initialData.inspection_date.substring(0, 10) : getSafeLADateISO(null),
    inspection_time: initialData?.inspection_time || new Date().toTimeString().slice(0, 5),
    shift: initialData?.shift || (new Date().getHours() >= 17 || new Date().getHours() < 7 ? 'PM' : 'AM'),
    observaciones: initialData?.observaciones || ''
  })

  const [answers, setAnswers] = useState<{ [key: string]: any }>({})
  const [questionComments, setQuestionComments] = useState<{ [key: string]: string }>({})
  const [questionPhotos, setQuestionPhotos] = useState<{ [key: string]: string[] }>({})
  const [startTime, setStartTime] = useState<string>('')

  useEffect(() => {
    // Set start time on mount if not already set
    if (!initialData?.start_time) {
      const now = new Date()
      setStartTime(now.toTimeString().slice(0, 5))
    } else {
      setStartTime(initialData.start_time)
    }
  }, [initialData])

  useEffect(() => {
    if (initialData?.answers) {
      const initialAnswers: { [key: string]: any } = {}
      const initialComments: { [key: string]: string } = {}

      // [FIX] Iterate by sections to match saving structure (Local Index)
      sections.forEach((section: any) => {
        const sectionTitle = section.title
        if (initialData.answers[sectionTitle]) {
          section.questions.forEach((q: any, idx: number) => {
            const itm = initialData.answers[sectionTitle].items?.[`i${idx}`] || initialData.answers[sectionTitle].items?.[idx]
            if (itm !== undefined) {
              initialAnswers[q.id] = itm.score !== undefined ? itm.score : itm
              if (itm.comment) initialComments[q.id] = itm.comment
            }
          })
        }
      })

      setAnswers(initialAnswers)
      setQuestionComments(initialComments)

      // Load photos from __question_photos if available
      if (initialData.answers['__question_photos']) {
        setQuestionPhotos(initialData.answers['__question_photos'])
      }
    }
  }, [initialData, sections])

  const handleAnswer = (questionId: string, val: any) => {
    setAnswers(prev => ({ ...prev, [questionId]: val }))
  }

  const handleCommentChange = (questionId: string, val: string) => {
    setQuestionComments(prev => ({ ...prev, [questionId]: val }))
  }

  const handlePhotosChange = (questionId: string, urls: string[]) => {
    setQuestionPhotos(prev => ({ ...prev, [questionId]: urls }))
  }

  const calculateScores = () => {
    const sectionScores: { [key: string]: number } = {}
    let totalScore = 0
    let scorableSections = 0

    sections.forEach((section: any) => {
      const questionsInSection = section.questions
      const sectionAnswers = questionsInSection
        .map((q: any) => getNumericValue(answers[q.id]))
        .filter((v: number | null) => v !== null)

      if (sectionAnswers.length > 0) {
        const sum = sectionAnswers.reduce((a: number, b: number) => a + b, 0)
        const score = Math.round(sum / sectionAnswers.length)
        sectionScores[section.title] = score
        totalScore += score
        scorableSections++
      } else {
        sectionScores[section.title] = 0
      }
    })

    const overall = scorableSections > 0 ? Math.round(totalScore / scorableSections) : 0
    return { sectionScores, overall }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!user) return alert('Sesión expirada')
    if (!formData.store_id) return alert('Selecciona una sucursal')

    // Validation
    const missingAnswers = allQuestions.filter(q => {
      const val = answers[q.id]
      if (q.type === 'text') return !val || val.trim().length === 0
      // Enforce strict photo requirement from template
      if (q.required_photo || q.type === 'photo') {
        return !questionPhotos[q.id] || questionPhotos[q.id].length === 0
      }
      return val === undefined || val === null
    })

    if (missingAnswers.length > 0) {
      alert(`❌ Faltan ${missingAnswers.length} puntos por evaluar.`)
      return
    }

    setLoading(true)

    try {
      const supabase = await getSupabaseClient()
      const { sectionScores, overall } = calculateScores()

      // FIX: Use Set to prevent duplicate photos
      const allPhotosSet = new Set([
        ...(initialData?.photos || []),
        ...Object.values(questionPhotos).flat()
      ])
      const allPhotos = Array.from(allPhotosSet).filter(url => url && typeof url === 'string')

      // Map answers back to rich structure for compatibility
      const richAnswers: any = {}
      sections.forEach((section: any) => {
        const itemsObj: any = {}
        section.questions.forEach((q: any, idx: number) => {
          itemsObj[`i${idx}`] = {
            label: q.text,
            score: answers[q.id],
            comment: questionComments[q.id] || ''
          }
        })
        richAnswers[section.title] = { score: sectionScores[section.title] || 0, items: itemsObj }
      })

      // Add rich photo mapping
      richAnswers['__question_photos'] = questionPhotos

      // ALSO: Add text-based photo mapping as a permanent anchor (immune to ID changes)
      const textPhotos: any = {}
      allQuestions.forEach((q: any) => {
        if (questionPhotos[q.id] && questionPhotos[q.id].length > 0) {
          textPhotos[q.text.toLowerCase().trim()] = questionPhotos[q.id]
        }
      })
      richAnswers['__text_photos'] = textPhotos

      // Calculate duration
      const now = new Date()
      const endTime = now.toTimeString().slice(0, 5)

      let duration = '0 min'
      if (startTime) {
        const [startH, startM] = startTime.split(':').map(Number)
        const [endH, endM] = endTime.split(':').map(Number)
        const startMinutes = startH * 60 + startM
        const endMinutes = endH * 60 + endM
        let diff = endMinutes - startMinutes
        if (diff < 0) diff += 24 * 60 // Handle midnight crossing

        const hours = Math.floor(diff / 60)
        const minutes = diff % 60
        duration = hours > 0 ? `${hours}h ${minutes}m` : `${minutes} min`
      }

      const payload = {
        store_id: parseInt(formData.store_id),
        inspector_id: user.id,
        supervisor_name: user.name || user.email,
        inspection_date: formData.inspection_date,
        inspection_time: formData.inspection_time, // Kept for legacy compatibility if needed
        start_time: startTime, // New Field
        end_time: endTime, // New Field
        duration: duration, // New Field
        shift: formData.shift,
        overall_score: overall,
        answers: richAnswers,
        observaciones: formData.observaciones,
        photos: allPhotos
      }

      // Map section titles to database columns
      const sectionMapping: { [key: string]: string } = {
        'Servicio al Cliente': 'service_score',
        'Procedimiento de Carnes': 'meat_score',
        'Preparación de Alimentos': 'food_score',
        'Seguimiento a Tortillas': 'tortilla_score',
        'Limpieza General y Baños': 'cleaning_score',
        'Checklists y Bitácoras': 'log_score',
        'Aseo Personal': 'grooming_score'
      }

      // Add dynamic scores
      Object.entries(sectionScores).forEach(([title, score]) => {
        const colName = sectionMapping[title]
        if (colName) {
          (payload as any)[colName] = score
        }
      })

      const { data: savedData, error } = initialData?.id
        ? await supabase.from('supervisor_inspections').update(payload).eq('id', initialData.id).select()
        : await supabase.from('supervisor_inspections').insert([payload]).select()

      if (error) throw error

      // Notifications
      try {
        const { data: admins } = await supabase.from('users').select('id').eq('role', 'admin')
        let recipients = admins ? admins.map(a => a.id) : []

        if (overall < 87) {
          const { data: managers } = await supabase.from('users').select('id').eq('store_id', payload.store_id).in('role', ['manager', 'gerente'])
          if (managers) recipients = [...new Set([...recipients, ...managers.map(m => m.id)])]
        }

        if (recipients.length > 0) {
          const storeName = stores.find(s => s.id.toString() === formData.store_id)?.name || 'Tienda'
          const notifs = recipients.map(uid => ({
            user_id: uid,
            title: overall < 87 ? `⚠️ Alerta: ${storeName}` : `Nueva Inspección: ${storeName}`,
            message: `El supervisor ${payload.supervisor_name} completó una auditoría con ${overall}%`,
            type: overall < 87 ? 'alert' : 'info',
            link: '/inspecciones',
            reference_id: savedData?.[0]?.id,
            reference_type: 'supervisor_inspection'
          }))
          await supabase.from('notifications').insert(notifs)
        }
      } catch (e) {
        console.error('Notification error:', e)
      }

      alert('✅ Inspección Guardada')
      router.push('/inspecciones')
    } catch (err: any) {
      alert('Error: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  if (checklistLoading && !initialData) return <div className="min-h-screen grid place-items-center bg-transparent"><div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>

  const { overall } = calculateScores()
  const scoreColor = overall >= 87 ? 'text-green-600' : overall >= 70 ? 'text-orange-600' : 'text-red-600'
  const scoreBg = overall >= 87 ? 'bg-green-50 border-green-200' : overall >= 70 ? 'bg-orange-50 border-orange-200' : 'bg-red-50 border-red-200'

  return (
    <div className="min-h-screen bg-transparent pb-32 font-sans selection:bg-blue-200 selection:text-blue-900">

      {/* 
        FLOATING HEADER PILL
        Detached, floating, clean. Transparent-safe.
      */}
      <div className="fixed top-[76px] left-0 right-0 z-50 flex justify-center px-4 pointer-events-none">
        <div className="pointer-events-auto bg-white/95 backdrop-blur-xl shadow-[0_4px_20px_rgb(0,0,0,0.12)] rounded-full px-3 py-2 flex items-center gap-4 border border-gray-200/50 max-w-2xl w-full justify-between ring-1 ring-black/5">

          <div className="flex items-center gap-3 pl-1">
            <button onClick={() => router.back()} className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center text-gray-700 hover:bg-gray-100 hover:text-black transition-colors border border-gray-200">
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-sm font-black text-gray-900 tracking-tight leading-none">Supervisión</h1>
              <div className="text-[11px] items-center gap-1 font-bold text-gray-500 uppercase hidden sm:flex">
                <Store size={12} /> {formatStoreName(stores.find(s => s.id.toString() === formData.store_id)?.name) || 'Selecciona...'}
              </div>
            </div>
          </div>

          {/* Progress Pill */}
          <div className="flex items-center gap-3 pr-1">
            <div className="text-right hidden sm:block">
              <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest">PUNTAJE</div>
            </div>
            <div className={`px-4 py-1.5 rounded-full font-black text-lg shadow-sm border ${scoreBg} ${scoreColor}`}>
              {overall}%
            </div>
            <button className="w-10 h-10 rounded-full bg-gray-900 text-white flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-transform">
              <MoreHorizontal size={20} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Areas - Cards */}
      <div className="max-w-3xl mx-auto px-4 pt-36 space-y-8">

        {/* Metadata Bubble */}
        <div className="bg-white/95 backdrop-blur-sm rounded-[2.5rem] p-8 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.05)] text-center relative overflow-hidden group border border-gray-100 ring-1 ring-black/5">
          <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600" />

          <h2 className="text-2xl font-black text-gray-900 mb-6 tracking-tight">Configuración de Visita</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-gray-50 rounded-2xl p-4 transition-colors hover:bg-blue-50 group/field text-left border border-gray-200 hover:border-blue-200">
              <label className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 block group-hover/field:text-blue-700">Sucursal</label>
              <select
                value={formData.store_id} onChange={e => setFormData({ ...formData, store_id: e.target.value })}
                className="w-full bg-transparent font-bold text-gray-900 outline-none text-lg cursor-pointer"
              >
                <option value="">Seleccionar...</option>
                {stores.map(s => <option key={s.id} value={s.id}>{formatStoreName(s.name)}</option>)}
              </select>
            </div>

            <div className="bg-gray-50 rounded-2xl p-4 transition-colors hover:bg-purple-50 group/field text-left border border-gray-200 hover:border-purple-200">
              <label className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 block group-hover/field:text-purple-700">Turno</label>
              <select
                value={formData.shift} onChange={e => setFormData({ ...formData, shift: e.target.value })}
                className="w-full bg-transparent font-bold text-gray-900 outline-none text-lg cursor-pointer"
              >
                <option value="AM">Mañana (AM)</option>
                <option value="PM">Tarde (PM)</option>
              </select>
            </div>

            <div className="bg-gray-50 rounded-2xl p-4 transition-colors hover:bg-pink-50 group/field text-left border border-gray-200 hover:border-pink-200">
              <label className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 block group-hover/field:text-pink-700">Fecha</label>
              <input type="date" value={formData.inspection_date} onChange={e => setFormData({ ...formData, inspection_date: e.target.value })}
                className="w-full bg-transparent font-bold text-gray-900 outline-none text-lg" />
            </div>

            <div className="bg-gray-50 rounded-2xl p-4 transition-colors hover:bg-orange-50 group/field text-left border border-gray-200 hover:border-orange-200">
              <label className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 block group-hover/field:text-orange-700">Hora</label>
              <input type="time" value={formData.inspection_time} onChange={e => setFormData({ ...formData, inspection_time: e.target.value })}
                className="w-full bg-transparent font-bold text-gray-900 outline-none text-lg" />
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-12">
          {sections.map((section: any, idx: number) => {
            const sectionAnswers = section.questions.map((q: any) => getNumericValue(answers[q.id])).filter((v: any) => v !== null)
            const sum = sectionAnswers.reduce((a: number, b: number) => a + b, 0)
            const sectionScore = sectionAnswers.length > 0 ? Math.round(sum / sectionAnswers.length) : 0

            return (
              <div key={section.id} className="relative bg-white/40 backdrop-blur-sm rounded-[2rem] p-3 md:p-6 border border-white/60 shadow-sm mb-12 ring-1 ring-black/5">
                {/* Section Header - STICKY for mobile context ONLY (High Contrast) */}
                <div className="sticky md:static top-0 z-40 -mx-3 md:-mx-6 px-3 md:px-6 py-4 bg-slate-900 md:bg-white/40 backdrop-blur-xl md:backdrop-blur-sm shadow-lg md:shadow-none mb-6 flex items-center gap-4 rounded-t-[2rem] transition-all border-b border-white/10 md:border-transparent">
                  <span className="shrink-0 bg-white md:bg-gray-900 text-slate-900 md:text-white w-8 h-8 md:w-10 md:h-10 rounded-xl flex items-center justify-center font-black text-sm md:text-base shadow-lg shadow-black/20 md:shadow-purple-900/20">
                    {idx + 1}
                  </span>
                  <h3 className="text-sm md:text-lg font-black text-white md:text-gray-900 uppercase tracking-tight leading-snug">{section.title}</h3>
                </div>

                <div className="space-y-4 md:space-y-6">
                  {section.questions.map((question: any, qIdx: number) => (
                    <DynamicQuestion
                      key={question.id}
                      question={question}
                      index={qIdx}
                      value={answers[question.id]}
                      photos={questionPhotos[question.id] || []}
                      onChange={(val) => handleAnswer(question.id, val)}
                      onPhotosChange={(urls) => handlePhotosChange(question.id, urls)}
                      comment={questionComments[question.id] || ''}
                      onCommentChange={(val) => handleCommentChange(question.id, val)}
                    />
                  ))}
                </div>
              </div>
            )
          })}

          {/* Final Observations */}
          <div className="bg-white/95 backdrop-blur-sm rounded-[2.5rem] p-8 border-2 border-dashed border-yellow-400 text-center shadow-sm">
            <h3 className="font-bold text-yellow-700 uppercase tracking-widest text-sm mb-4">Notas Finales</h3>
            <textarea
              value={formData.observaciones}
              onChange={e => setFormData({ ...formData, observaciones: e.target.value })}
              rows={4}
              className="w-full bg-gray-50 rounded-2xl p-4 border border-yellow-200 shadow-inner outline-none focus:ring-4 focus:ring-yellow-100 focus:border-yellow-400 transition-all font-medium text-gray-900 resize-none placeholder:text-gray-400"
              placeholder="Escribe comentarios adicionales..."
            />
          </div>
        </form>
      </div>

      {/* Floating Action Button */}
      <div className="fixed bottom-8 left-0 right-0 z-50 flex justify-center pointer-events-none">
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleSubmit}
          disabled={loading}
          className="pointer-events-auto bg-gray-900 text-white px-8 py-4 rounded-full shadow-[0_20px_40px_-10px_rgba(0,0,0,0.4)] font-black text-lg flex items-center gap-3 hover:bg-black transition-colors disabled:opacity-50 disabled:scale-100 border-2 border-white/20"
        >
          {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> :
            <>
              <span>FINALIZAR INSPECCIÓN</span>
              <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                <Send size={14} />
              </div>
            </>}
        </motion.button>
      </div>

    </div>
  )
}
