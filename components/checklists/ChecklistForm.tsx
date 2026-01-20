'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { ChevronLeft, Save } from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase'
import { useDynamicChecklist } from '@/hooks/useDynamicChecklist'
import DynamicQuestion from '@/components/checklists/DynamicQuestion'
import SurpriseLoader from '@/components/SurpriseLoader'

const TEMPLATE_MAP: { [key: string]: string } = {
  daily: 'daily_checklist_v1',
  cierre: 'cierre_v1',
  apertura: 'apertura_v1',
  recorrido: 'recorrido_v1',
  temperaturas: 'temperaturas_v1',
  sobrante: 'sobrante_v1'
}

const THEME_STYLES: { [key: string]: { text: string, bg: string, shadow: string, border: string, ring: string, iconBg: string } } = {
  daily: {
    text: 'text-blue-600',
    bg: 'bg-blue-600',
    shadow: 'shadow-blue-100',
    border: 'border-blue-100',
    ring: 'focus:ring-blue-100',
    iconBg: 'bg-blue-600'
  },
  cierre: {
    text: 'text-purple-600',
    bg: 'bg-purple-600',
    shadow: 'shadow-purple-100',
    border: 'border-purple-100',
    ring: 'focus:ring-purple-100',
    iconBg: 'bg-purple-600'
  },
  apertura: {
    text: 'text-orange-600',
    bg: 'bg-orange-600',
    shadow: 'shadow-orange-100',
    border: 'border-orange-100',
    ring: 'focus:ring-orange-100',
    iconBg: 'bg-orange-600'
  },
  recorrido: {
    text: 'text-green-600',
    bg: 'bg-green-600',
    shadow: 'shadow-green-100',
    border: 'border-green-100',
    ring: 'focus:ring-green-100',
    iconBg: 'bg-green-600'
  },
  temperaturas: {
    text: 'text-red-600',
    bg: 'bg-red-600',
    shadow: 'shadow-red-100',
    border: 'border-red-100',
    ring: 'focus:ring-red-100',
    iconBg: 'bg-red-600'
  },
  sobrante: {
    text: 'text-amber-600',
    bg: 'bg-amber-600',
    shadow: 'shadow-amber-100',
    border: 'border-amber-100',
    ring: 'focus:ring-amber-100',
    iconBg: 'bg-amber-600'
  }
}

export default function ChecklistForm({ user, initialData, type = 'daily' }: { user: any, initialData?: any, type: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const templateCode = TEMPLATE_MAP[type] || type
  const styles = THEME_STYLES[type] || THEME_STYLES.daily

  const { data: template, loading: checklistLoading, error: checklistError, isCached } = useDynamicChecklist(templateCode)

  useEffect(() => {
    // console.log(`[ChecklistForm] Type: ${type}, TemplateCode: ${templateCode}`)
    // if (template) console.log(`[ChecklistForm] Template loaded:`, template)
    if (checklistError) console.error(`[ChecklistForm] Error:`, checklistError)
  }, [type, templateCode, template, checklistError])

  const sections = useMemo(() => template?.sections || [], [template])
  const allQuestions = useMemo(() => sections.flatMap((s: any) => s.questions), [sections])

  const [formData, setFormData] = useState({
    checklist_date: initialData?.checklist_date || new Date().toISOString().split('T')[0],
    shift: initialData?.shift || (new Date().getHours() >= 17 || new Date().getHours() < 7 ? 'PM' : 'AM'),
    comments: initialData?.comments || ''
  })

  const [answers, setAnswers] = useState<{ [key: string]: any }>({})
  const [questionPhotos, setQuestionPhotos] = useState<{ [key: string]: string[] }>({})
  const [restoredMessage, setRestoredMessage] = useState<string | null>(null)

  useEffect(() => {
    if (initialData?.answers && allQuestions.length > 0) {
      const initialAnswers: { [key: string]: any } = {}

      allQuestions.forEach((q: any) => {
        // 1. Try match by ID (new format)
        if (initialData.answers[q.id] !== undefined) {
          initialAnswers[q.id] = initialData.answers[q.id]
          return
        }

        // 2. Try match by exact text (legacy format)
        if (initialData.answers[q.text] !== undefined) {
          initialAnswers[q.id] = initialData.answers[q.text]
          return
        }

        // 3. Fuzzy match for legacy data (robust)
        const questionWords = q.text.toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .split(/\s+/)
          .filter((w: string) => w.length > 2)

        if (questionWords.length > 0) {
          for (const [key, val] of Object.entries(initialData.answers)) {
            if (key === '__question_photos') continue
            const keyLower = key.toLowerCase()
            const matchCount = questionWords.filter((word: string) => keyLower.includes(word)).length

            // If at least 2 significant words match or 60% of small questions
            if (matchCount >= 2 || (questionWords.length === 1 && matchCount === 1)) {
              initialAnswers[q.id] = val
              break
            }
          }
        }
      })
      setAnswers(initialAnswers)

      // Restore Photos Mapping if available
      if (initialData.answers['__question_photos']) {
        setQuestionPhotos(initialData.answers['__question_photos'])
      }

      // [AUTO-SAVE EDIT Restoration]
      if (initialData.id) {
        const draftKey = `checklist_draft_edit_${initialData.id}`
        const savedDraft = localStorage.getItem(draftKey)
        if (savedDraft) {
          try {
            const parsed = JSON.parse(savedDraft)
            // Only restore if draft timestamp is newer (optional check, for now just restore)
            console.log('🔄 Restaurando edición...')
            if (parsed.answers) setAnswers(prev => ({ ...prev, ...parsed.answers }))
            if (parsed.questionPhotos) setQuestionPhotos(prev => ({ ...prev, ...parsed.questionPhotos }))
            if (parsed.formData) setFormData(prev => ({ ...prev, ...parsed.formData }))
            setRestoredMessage('Se han restaurado cambios no guardados en esta edición.')
          } catch (e) {
            console.error('Error restaurando edición', e)
          }
        }
      }

    } else if (!initialData?.id) {
      // [AUTO-SAVE] Only restore draft for NEW inspections (not edits)
      const draftKey = `checklist_draft_${templateCode}`
      const savedDraft = localStorage.getItem(draftKey)
      if (savedDraft) {
        try {
          const parsed = JSON.parse(savedDraft)
          // Ask user or auto-restore? Let's auto-restore with a toast/log
          console.log('🔄 Restaurando borrador...')
          if (parsed.answers) setAnswers(parsed.answers)
          if (parsed.questionPhotos) setQuestionPhotos(parsed.questionPhotos)
          if (parsed.formData) setFormData(prev => ({ ...prev, ...parsed.formData }))
          setRestoredMessage('Hemos recuperado tu trabajo pendiente.')
        } catch (e) {
          console.error('Error restaurando borrador', e)
        }
      }
    }
  }, [initialData, allQuestions, templateCode])

  // [AUTO-SAVE] Save Logic
  useEffect(() => {
    const draftKey = initialData?.id
      ? `checklist_draft_edit_${initialData.id}`
      : `checklist_draft_${templateCode}`

    const payload = {
      answers,
      questionPhotos,
      formData,
      timestamp: Date.now()
    }
    localStorage.setItem(draftKey, JSON.stringify(payload))
  }, [answers, questionPhotos, formData, templateCode, initialData?.id])

  const handleAnswer = (questionId: string, val: any) => {
    setAnswers(prev => ({ ...prev, [questionId]: val }))
  }

  const handlePhotosChange = (questionId: string, urls: string[]) => {
    setQuestionPhotos(prev => ({ ...prev, [questionId]: urls }))
  }

  const calculateScore = () => {
    if (type === 'temperaturas') {
      const scorable = allQuestions.filter((q: any) => q.type === 'yes_no')
      if (scorable.length === 0) {
        const answered = allQuestions.filter((q: any) => answers[q.id] !== undefined && answers[q.id] !== null).length
        return Math.round((answered / allQuestions.length) * 100) || 0
      }
    }

    if (type === 'sobrante') {
      if (allQuestions.length === 0) return 100

      const withinLimit = allQuestions.filter((q: any) => {
        const rawVal = answers[q.id]
        const val = Number(rawVal)
        // Only penalize if it's a valid number. 
        // If it's empty or non-numeric (legacy SI/NO), we don't penalize it as "excess waste".
        if (!isNaN(val) && rawVal !== null && rawVal !== '' && rawVal !== undefined) {
          return val <= 2
        }
        return true;
      }).length

      return Math.round((withinLimit / allQuestions.length) * 100)
    }

    const yesNo = allQuestions.filter((q: any) => q.type === 'yes_no')
    if (yesNo.length === 0) return 100

    const valid = yesNo.map((q: any) => answers[q.id]).filter((v: any) => v !== undefined && v !== null && v !== 'NA')
    const si = valid.filter((v: any) => v === 'SI').length

    return valid.length > 0 ? Math.round((si / valid.length) * 100) : 100
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return alert('No user')

    const missing = allQuestions.filter((q: any) => {
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
      allQuestions.forEach((q: any) => {
        formattedAnswers[q.text] = answers[q.id]
      })

      formattedAnswers['__question_photos'] = questionPhotos

      const payload = {
        checklist_type: type,
        user_id: user.id,
        user_name: user.name || user.email,
        store_id: user.store_id || initialData?.store_id || null,
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

      // [AUTO-SAVE] Clear draft on successful submit
      if (initialData?.id) {
        localStorage.removeItem(`checklist_draft_edit_${initialData.id}`)
      } else {
        localStorage.removeItem(`checklist_draft_${templateCode}`)
      }

      alert('✅ Guardado con éxito')
      router.push('/checklists')
    } catch (err: any) {
      alert('Error: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const score = calculateScore()

  return (
    <div className="max-w-4xl mx-auto pb-24">
      <header className="bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800 sticky top-0 z-40 shadow-sm rounded-t-3xl overflow-hidden transition-colors">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-lg ${styles.shadow} dark:shadow-none ${styles.bg}`}>
              <Save size={20} />
            </div>
            <div>
              <h1 className="text-lg font-black text-gray-900 dark:text-white flex items-center gap-2">
                {template?.title || 'Checklist'}
                {isCached && <span className="text-[9px] bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 px-2 py-0.5 rounded-full border border-yellow-200 dark:border-yellow-900/50">Offline</span>}
              </h1>
              <div className={`text-[10px] font-black uppercase tracking-widest ${styles.text}`}>{user?.name || user?.email}</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className={`px-4 py-2 rounded-2xl flex flex-col items-center min-w-[80px] text-white shadow-lg ${styles.bg} ${styles.shadow} dark:shadow-none`}>
              <div className="text-xl font-black leading-none">{score}%</div>
              <div className="text-[10px] font-bold uppercase opacity-80 mt-1">Score</div>
            </div>
          </div>
        </div>
        {/* RESTORED MESSAGE BANNER */}
        {restoredMessage && (
          <div className="bg-indigo-50 dark:bg-indigo-900/30 border-t border-indigo-100 dark:border-indigo-800 px-6 py-3 flex items-center justify-between animate-in slide-in-from-top-2 transition-all">
            <span className="text-xs font-black uppercase text-indigo-600 dark:text-indigo-300 flex items-center gap-2 tracking-wide">
              <Sparkles size={14} className="animate-pulse" />
              {restoredMessage}
            </span>
            <button onClick={() => setRestoredMessage(null)} className="text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-200 p-1 hover:bg-indigo-100 rounded-full transition-colors">
              <ChevronLeft size={16} className="rotate-270" />
            </button>
          </div>
        )}
      </header>

      <div className="bg-white dark:bg-slate-900 border-x border-b border-gray-200 dark:border-slate-800 rounded-b-3xl p-6 shadow-sm space-y-8 transition-colors">
        <div className="grid grid-cols-2 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest">Fecha</label>
            <input type="date" value={formData.checklist_date} onChange={e => setFormData({ ...formData, checklist_date: e.target.value })}
              className={`w-full p-3 bg-gray-50 dark:bg-slate-800/50 border border-gray-100 dark:border-slate-800 rounded-xl font-bold text-gray-700 dark:text-slate-200 outline-none focus:ring-2 ${styles.ring} dark:focus:ring-indigo-900/40 transition-all`} />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest">Turno</label>
            <select value={formData.shift} onChange={e => setFormData({ ...formData, shift: e.target.value })}
              className={`w-full p-3 bg-gray-50 dark:bg-slate-800/50 border border-gray-100 dark:border-slate-800 rounded-xl font-bold text-gray-700 dark:text-slate-200 outline-none focus:ring-2 ${styles.ring} dark:focus:ring-indigo-900/40 transition-all`}>
              <option value="AM" className="dark:bg-slate-900">☀️ AM (Mañana)</option>
              <option value="PM" className="dark:bg-slate-900">🌙 PM (Tarde)</option>
            </select>
          </div>
        </div>

        <div className="space-y-12">
          {checklistLoading && (
            <div className="py-20 flex justify-center scale-75">
              <SurpriseLoader />
            </div>
          )}

          {checklistError && (
            <div className="p-8 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-3xl text-center">
              <div className="text-red-500 dark:text-red-400 font-bold mb-2">⚠️ Error al cargar la plantilla</div>
              <p className="text-red-400 dark:text-red-500/70 text-xs font-medium">{checklistError}</p>
              <button type="button" onClick={() => window.location.reload()} className="mt-4 text-[10px] font-black uppercase text-red-600 dark:text-red-400 underline">Reintentar</button>
            </div>
          )}

          {!checklistLoading && !checklistError && sections.length === 0 && (
            <div className="py-12 text-center opacity-50">
              <div className="text-4xl mb-4">📭</div>
              <p className="font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest text-xs">No se encontraron preguntas para esta plantilla ({templateCode})</p>
            </div>
          )}

          {sections.map((section: any) => (
            <div key={section.id} className="space-y-6">
              <div className="flex items-center gap-4 px-2">
                <div className="h-[px] flex-1 bg-gray-100 dark:bg-slate-800" />
                <h2 className={`text-[10px] font-black uppercase tracking-[0.3em] ${styles.text}`}>{section.title}</h2>
                <div className="h-[px] flex-1 bg-gray-100 dark:bg-slate-800" />
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
                    checklistType={type}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-3">
          <label className="text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest">Comentarios</label>
          <textarea value={formData.comments} onChange={e => setFormData({ ...formData, comments: e.target.value })} rows={4}
            className={`w-full p-4 bg-gray-50 dark:bg-slate-800/50 border border-gray-100 dark:border-slate-800 rounded-2xl font-medium text-gray-700 dark:text-slate-200 outline-none focus:ring-2 ${styles.ring} dark:focus:ring-indigo-900/40 transition-all resize-none`}
            placeholder="Notas adicionales..." />
        </div>

        <div className="pt-4 flex gap-4">
          <button type="button" onClick={() => { if (confirm('¿Salir? Tu progreso se guardará como borrador y podrás continuarlo después.')) router.back() }} className="flex-1 py-4 bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 font-bold rounded-2xl hover:bg-gray-200 dark:hover:bg-slate-700 transition-all">Cancelar</button>
          <button onClick={handleSubmit} disabled={loading}
            className={`flex-[2] py-4 rounded-2xl font-black text-white shadow-xl transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2 ${styles.bg}`}>
            {loading ? <div className="w-6 h-6 border-4 border-white border-t-transparent rounded-full animate-spin" /> : <><Save size={20} /><span>{initialData?.id ? 'Guardar Cambios' : 'Finalizar'}</span></>}
          </button>
        </div>
      </div>
    </div>
  )
}
