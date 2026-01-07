'use client'

import React, { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { ChevronLeft } from 'lucide-react'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import { canEditChecklist } from '@/lib/checklistPermissions'
import { getSupabaseClient, formatStoreName } from '@/lib/supabase'
import { useDynamicChecklist } from '@/hooks/useDynamicChecklist'
import DynamicQuestion from '@/components/checklists/DynamicQuestion'
import '@/app/checklists/checklists.css'

function EditManagerChecklistContent() {
  const router = useRouter()
  const params = useParams()
  const { user } = useAuth()
  const checklistId = params?.id as string

  const [checklist, setChecklist] = useState<any>(null)
  const [answers, setAnswers] = useState<{ [key: string]: any }>({})
  const [questionPhotos, setQuestionPhotos] = useState<{ [key: string]: string[] }>({})
  const [comments, setComments] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [canEdit, setCanEdit] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  // Dynamic Hooks
  const { data: template, loading: checklistLoading, error: checklistError, isCached } = useDynamicChecklist('manager_checklist_v1')
  const sections = template?.sections || []
  const questions = sections.flatMap((s: any) => s.questions)

  useEffect(() => {
    if (user && checklistId && template) {
      loadChecklist()
    }
  }, [user, checklistId, template])

  const loadChecklist = async () => {
    try {
      const supabase = await getSupabaseClient()
      const { data, error } = await supabase
        .from('manager_checklists')
        .select('*')
        .eq('id', checklistId)
        .single()

      if (error || !data) {
        setErrorMessage('Checklist no encontrado')
        setLoading(false)
        return
      }

      setChecklist(data)

      const validation = canEditChecklist(
        data.created_at,
        user?.role || '',
        data.user_id,
        user?.id || '',
        data.estatus_supervisor
      )

      setCanEdit(validation.canEdit)
      setErrorMessage(validation.reason || '')

      if (validation.canEdit) {
        const initialAnswers: { [key: string]: any } = {}
        const initialPhotos: { [key: string]: string[] } = {}

        if (data.answers) {
          questions.forEach((q: any, idx: number) => {
            // Try matching by text (new format) or legacy key (s0_0)
            const val = data.answers[q.text] || data.answers[`s${q.section_idx || 0}_${q.order_index || idx}`]
            if (val !== undefined) {
              initialAnswers[q.id] = typeof val === 'object' ? val.value : val
            }
          })
        }

        // Photos are currently stored as a single array in manager_checklists.photo_urls
        // We might not be able to easily map them back to specific questions if they weren't stored that way.
        // For now, if we have photo_urls, we just keep them but it might be hard to edit them per-question.
        // However, we want to allow ADDING photos to questions that require them.

        setAnswers(initialAnswers)
        setComments(data.comments || '')
      }

      setLoading(false)
    } catch (err) {
      console.error('Error loading checklist:', err)
      setErrorMessage('Error al cargar el checklist')
      setLoading(false)
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

    if (!user || !canEdit) {
      alert('Error: No tienes permisos o sesión expirada')
      return
    }

    // Validation
    const missingAnswers = questions.filter(q => {
      const val = answers[q.id]
      if (q.type === 'text') return !val || val.trim().length === 0
      if (q.type === 'photo') return !questionPhotos[q.id] || (questionPhotos[q.id].length === 0 && (!checklist.photo_urls || checklist.photo_urls.length === 0))
      return val === undefined || val === null
    })

    if (missingAnswers.length > 0) {
      alert(`⚠️ Faltan ${missingAnswers.length} tareas por responder.`)
      return
    }

    setSaving(true)

    try {
      const supabase = await getSupabaseClient()
      const newPhotos = Object.values(questionPhotos).flat()
      // Merge with existing photo_urls if we want to keep them, or replace them.
      // Usually, editing might involve adding new photos.
      const allPhotos = [...(checklist.photo_urls || []), ...newPhotos]

      const formattedAnswers: { [key: string]: any } = {}
      questions.forEach(q => {
        formattedAnswers[q.text] = answers[q.id]
      })

      // Add rich photo mapping
      formattedAnswers['__question_photos'] = questionPhotos

      const payload: any = {
        answers: formattedAnswers,
        score: calculateScore(),
        comments: comments || null,
        photo_urls: allPhotos.length > 0 ? allPhotos : null
      }

      if (checklist.estatus_supervisor === 'rechazado') {
        payload.estatus_supervisor = 'corregido'
        if (checklist.supervisor_id) {
          await supabase.from('notifications').insert([{
            user_id: checklist.supervisor_id,
            title: '✅ Checklist Corregido',
            message: `El Manager ${user?.name || 'Gerente'} ha corregido su checklist de ${checklist.store_name || 'Tienda'}.`,
            type: 'info',
            link: `/checklists-manager?id=${checklistId}`,
            is_read: false,
            reference_id: checklistId,
            reference_type: 'manager_checklist'
          }])
        }
      }

      const { error } = await supabase.from('manager_checklists').update(payload).eq('id', checklistId)

      if (!error) {
        alert(`✅ Checklist actualizado!\n\nNuevo Score: ${calculateScore()}%`)
        router.push('/checklists-manager')
      } else {
        alert('Error: ' + error.message)
      }
    } catch (err: any) {
      alert('Error inesperado: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading || checklistLoading) return <div className="min-h-screen grid place-items-center bg-gray-50"><div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" /></div>

  if (checklistError || errorMessage) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
        <div className="bg-white rounded-3xl shadow-xl p-8 max-w-md text-center border border-gray-100">
          <div className="text-6xl mb-6">🔒</div>
          <h2 className="text-2xl font-black text-gray-900 mb-2">No se puede editar</h2>
          <p className="text-gray-500 font-medium mb-8">{errorMessage || checklistError}</p>
          <button onClick={() => router.push('/checklists-manager')} className="w-full py-4 bg-indigo-600 text-white font-bold rounded-2xl shadow-lg transition-transform active:scale-95">
            Volver a la lista
          </button>
        </div>
      </div>
    )
  }

  const score = calculateScore()
  const answeredCount = Object.keys(answers).length

  return (
    <div className="min-h-screen bg-gray-50 pb-32">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <button onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center hover:bg-gray-100 rounded-xl transition-colors text-gray-600">
              <ChevronLeft size={24} />
            </button>
            <div>
              <h1 className="text-lg font-black text-gray-900 flex items-center gap-2">
                Editar Manager Checklist
                {isCached && (
                  <span className="bg-yellow-500/10 text-yellow-600 text-[10px] px-2 py-0.5 rounded-full border border-yellow-400/20 font-bold uppercase tracking-widest">
                    Offline
                  </span>
                )}
              </h1>
              <div className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">{formatStoreName(checklist?.store_name)} • {checklist?.checklist_date}</div>
            </div>
          </div>
          <div className="bg-indigo-600 text-white px-4 py-2 rounded-2xl shadow-lg shadow-indigo-100 flex flex-col items-center min-w-[80px]">
            <div className="text-xl font-black leading-none">{score}%</div>
            <div className="text-[10px] font-bold uppercase opacity-80 mt-1">{answeredCount}/{questions.length}</div>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8">
        <form onSubmit={handleSubmit} className="space-y-8">
          <div className="space-y-12">
            {sections.map((section: any) => (
              <div key={section.id} className="space-y-6">
                <div className="flex items-center gap-4 px-2">
                  <div className="h-[2px] flex-1 bg-gray-100" />
                  <h2 className="text-[10px] font-black text-indigo-600 uppercase tracking-[0.3em]">{section.title}</h2>
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

          <div className="bg-white rounded-3xl shadow-sm p-6 border border-gray-100 space-y-3">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Observaciones del Manager</label>
            <textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={4}
              className="w-full p-4 bg-gray-50 border-gray-100 rounded-2xl font-medium text-gray-700 outline-none focus:ring-2 focus:ring-indigo-100 transition-all resize-none"
              placeholder="Agrega cualquier observación adicional..." />
          </div>

          <div className="pt-4">
            <button type="submit" disabled={saving}
              className="w-full bg-gradient-to-r from-indigo-600 to-violet-700 hover:from-indigo-700 hover:to-violet-800 text-white font-black text-lg py-5 rounded-3xl shadow-xl shadow-indigo-100 transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-3">
              {saving ? <div className="w-6 h-6 border-4 border-white border-t-transparent rounded-full animate-spin" /> : '✅ Guardar Cambios'}
            </button>
          </div>
        </form>
      </div>
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
