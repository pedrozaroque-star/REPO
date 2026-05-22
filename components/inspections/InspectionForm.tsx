'use client'

import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { ShieldCheck, Camera, Send, Calendar, Clock, MapPin, Sun, Moon, CheckCircle2, AlertCircle, ChevronRight, Store, User, Hash, FileText, ArrowLeft, MoreHorizontal, Trash2, CameraOff } from 'lucide-react'
import { getSupabaseClient, formatStoreName } from '@/lib/supabase'
import { useDynamicChecklist } from '@/hooks/useDynamicChecklist'
import DynamicQuestion from '@/components/checklists/DynamicQuestion'
import { getSafeLADateISO } from '@/lib/checklistPermissions'
import { getNumericValue } from '@/lib/scoreCalculator'
import { useLanguage } from '@/lib/i18n'

interface Store {
  id: string
  name: string
  code?: string
  latitude?: number
  longitude?: number
}

export default function InspectionForm({ user, initialData, stores }: { user: any, initialData?: any, stores: Store[] }) {
  const router = useRouter()
  const { t, language } = useLanguage()
  const [loading, setLoading] = useState(false)
  const isSubmittingRef = useRef(false)

  const [googleConnected, setGoogleConnected] = useState(true)
  const [isGmailModalOpen, setIsGmailModalOpen] = useState(false)

  const LOCALSTORAGE_KEY = 'teg_inspection_draft'
  const allowNavigation = useRef(false)
  const draftRestoredRef = useRef(false)

  const checkGoogleAuth = async () => {
    if (!user?.id) return
    const supabase = await getSupabaseClient()
    const { data } = await supabase.from('users').select('google_refresh_token').eq('id', user.id).single()
    setGoogleConnected(!!data?.google_refresh_token)
  }

  useEffect(() => {
    checkGoogleAuth()

    // Limpiar parámetros OAuth de la URL si venimos de vuelta del callback
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      if (url.searchParams.has('success') || url.searchParams.has('rt')) {
        url.searchParams.delete('rt')
        url.searchParams.delete('ge')
        url.searchParams.delete('success')
        window.history.replaceState({}, '', url.pathname)
      }
    }
  }, [user?.id])

  // Restaurar borrador de localStorage si venimos de vuelta del OAuth
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LOCALSTORAGE_KEY)
      if (saved && !initialData) {
        const draft = JSON.parse(saved)
        // Solo restaurar si fue guardado hace menos de 2 horas
        if (draft._savedAt && (Date.now() - draft._savedAt) < 2 * 60 * 60 * 1000) {
          if (draft.formData) setFormData(draft.formData)
          if (draft.answers) setAnswers(draft.answers)
          if (draft.questionComments) setQuestionComments(draft.questionComments)
          if (draft.questionPhotos) setQuestionPhotos(draft.questionPhotos)
          if (draft.startTime) setStartTime(draft.startTime)
          if (draft.inspectorPhoto) setInspectorPhoto(draft.inspectorPhoto)
          if (draft.locationValidated) setLocationValidated(draft.locationValidated)
          draftRestoredRef.current = true
          console.log('✅ Borrador de inspección restaurado desde localStorage')
        }
        localStorage.removeItem(LOCALSTORAGE_KEY)
      }
    } catch (e) {
      console.warn('No se pudo restaurar borrador:', e)
    }
  }, [])


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

  /* GEO-FENCING LOGIC */
  const [locationValidated, setLocationValidated] = useState(false)
  const [validatingLocation, setValidatingLocation] = useState(false)

  // Reset validation when store changes
  useEffect(() => {
    setLocationValidated(false)
  }, [formData.store_id])


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

      // Fallback: If no answers found via section mapping, try flat mapping (Rescue Mode)
      if (Object.keys(initialAnswers).length === 0 && initialData.answers) {
        const rescueAnswers: { [key: string]: any } = {}
        const rescueComments: { [key: string]: string } = {}

        allQuestions.forEach((q: any) => {
          let foundVal = undefined
          let foundComment = ''

          // Search in all sections of initialData.answers
          Object.values(initialData.answers).forEach((section: any) => {
            if (section?.items) {
              Object.values(section.items).forEach((item: any) => {
                // Match by Label roughly
                if (item.label && item.label.includes(q.text.substring(0, 10))) {
                  foundVal = item.score !== undefined ? item.score : item
                  if (item.comment) foundComment = item.comment
                }
              })
            }
          })

          if (foundVal !== undefined) {
            console.log(`Rescue matched: ${q.text} -> ${foundVal}`)
            rescueAnswers[q.id] = foundVal
            if (foundComment) rescueComments[q.id] = foundComment
          }
        })

        if (Object.keys(rescueAnswers).length > 0) {
          setAnswers(rescueAnswers)
          setQuestionComments(rescueComments)
        }
      }

      // Load photos from __question_photos if available
      if (initialData.answers['__question_photos']) {
        setQuestionPhotos(initialData.answers['__question_photos'])
      }
    }
  }, [initialData, sections, allQuestions])

  /* INSPECTOR SELFIE LOGIC */
  const [inspectorPhoto, setInspectorPhoto] = useState<string | null>(initialData?.inspector_photo_url || null)
  const [uploadingSelfie, setUploadingSelfie] = useState(false)

  const handleInspectorPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return

    setUploadingSelfie(true)
    const file = e.target.files[0]

    try {
      // Compress
      const options = {
        maxSizeMB: 0.3,
        maxWidthOrHeight: 720,
        useWebWorker: true,
        fileType: 'image/webp'
      }

      let fileToUpload = file
      try {
        const imageCompression = (await import('browser-image-compression')).default
        fileToUpload = await imageCompression(file, options)
      } catch (err) {
        console.warn('Compression failed, using original', err)
      }

      const fileExt = 'webp'
      const fileName = `inspector-evidence/${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`

      const supabase = await getSupabaseClient()
      const { error: uploadError } = await supabase.storage
        .from('checklist-photos')
        .upload(fileName, fileToUpload)

      if (uploadError) throw uploadError

      const { data } = supabase.storage.from('checklist-photos').getPublicUrl(fileName)

      if (data?.publicUrl) {
        setInspectorPhoto(data.publicUrl)
      }
    } catch (error: any) {
      alert(t('inspections.form.evidence.missing'))
    } finally {
      setUploadingSelfie(false)
    }
  }

  const handleAnswer = (questionId: string, val: any) => {
    setAnswers(prev => ({ ...prev, [questionId]: val }))
  }

  const handleCommentChange = (questionId: string, val: string) => {
    setQuestionComments(prev => ({ ...prev, [questionId]: val }))
  }

  const handlePhotosChange = (questionId: string, urls: string[]) => {
    setQuestionPhotos(prev => ({ ...prev, [questionId]: urls }))
  }

  /* PROGRESS & NAVIGATION GUARD LOGIC */

  // Calculate completion percentage
  const completionStatus = useMemo(() => {
    if (allQuestions.length === 0) return { answered: 0, total: 0, percent: 0 }

    let answeredCount = 0
    allQuestions.forEach(q => {
      const val = answers[q.id]
      // Check if answered (non-null/undefined for scores, non-empty for text)
      const hasValue = val !== undefined && val !== null && (typeof val !== 'string' || val.trim().length > 0)
      // Check photo requirement if applicable
      const photoRequired = q.required_photo || q.type === 'photo'
      const hasPhoto = !photoRequired || (questionPhotos[q.id] && questionPhotos[q.id].length > 0)

      if (hasValue && hasPhoto) answeredCount++
    })

    return {
      answered: answeredCount,
      total: allQuestions.length,
      percent: Math.round((answeredCount / allQuestions.length) * 100)
    }
  }, [answers, questionPhotos, allQuestions])

  // Protect against accidental exit — SIEMPRE guarda un borrador de emergencia
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // SIEMPRE guardar un respaldo antes de cualquier salida
      saveDraftToStorage.current()

      if (completionStatus.answered > 0 && !isSubmittingRef.current && !allowNavigation.current) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [completionStatus.answered])

  // ===== AUTO-GUARDADO CONTINUO =====
  // Cada vez que cambian respuestas/comentarios/fotos/formData, se guarda automáticamente
  // Así NUNCA se pierde la captura sin importar cómo salga el supervisor
  const saveDraftToStorage = useRef(() => {})
  saveDraftToStorage.current = () => {
    try {
      // No guardar si no hay datos significativos
      const hasData = Object.keys(answers).length > 0 || formData.store_id
      if (!hasData) return

      const draft = {
        formData,
        answers,
        questionComments,
        questionPhotos,
        startTime,
        inspectorPhoto,
        locationValidated,
        _savedAt: Date.now()
      }
      localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(draft))
    } catch (e) { /* silent */ }
  }

  // Auto-guardar cuando cambian los datos importantes (debounced 2s)
  useEffect(() => {
    // No auto-guardar en el primer render ni durante la restauración
    if (draftRestoredRef.current) {
      draftRestoredRef.current = false
      return
    }
    const timer = setTimeout(() => {
      saveDraftToStorage.current()
    }, 2000)
    return () => clearTimeout(timer)
  }, [answers, questionComments, questionPhotos, formData, inspectorPhoto, locationValidated])

  const saveDraftAndRedirect = () => {
    // Guardar inmediatamente (sin debounce)
    saveDraftToStorage.current()
    console.log('💾 Borrador guardado en localStorage antes de OAuth')
    // Desactivar la alerta "¿Deseas abandonar?" antes de redirigir
    allowNavigation.current = true
    // Pasar userId para que el callback guarde el token al usuario correcto
    window.location.href = `/api/auth/google/start?returnUrl=${encodeURIComponent('/inspecciones/nueva')}&userId=${user?.id || ''}`
  }

  const handleBack = () => {
    if (completionStatus.answered > 0) {
      if (confirm(t('inspections.form.actions.back_confirm'))) {
        router.back()
      }
    } else {
      router.back()
    }
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

  /* UPLOAD PROGRESS STATE */
  const [uploadProgress, setUploadProgress] = useState(0)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!googleConnected) {
      setIsGmailModalOpen(true)
      return
    }

    if (loading) return // BLOCK DOUBLE SUBMISSIONS

    if (!user) return alert(t('inspections.form.alerts.session_expired'))
    if (!formData.store_id) return alert(t('inspections.form.alerts.select_store'))

    if (!inspectorPhoto) return alert(t('inspections.form.evidence.missing'))

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
      alert(t('inspections.form.alerts.missing_items').replace('{n}', missingAnswers.length.toString()))
      return
    }

    setLoading(true)
    setUploadProgress(10) // Start Progress

    // Simulate progress while payload builds
    const progressInterval = setInterval(() => {
      setUploadProgress(prev => {
        if (prev >= 90) return prev
        // Fast at first, then slow
        const increment = prev < 50 ? 10 : 2
        return prev + increment
      })
    }, 500)

    // WRAPPER: Add Race Condition Timeout
    const submitWithTimeout = async () => {
      return Promise.race([
        (async () => {
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

          richAnswers['__question_photos'] = questionPhotos

          // Anchor text photos
          const textPhotos: any = {}
          allQuestions.forEach((q: any) => {
            if (questionPhotos[q.id] && questionPhotos[q.id].length > 0) {
              textPhotos[q.text.toLowerCase().trim()] = questionPhotos[q.id]
            }
          })
          richAnswers['__text_photos'] = textPhotos

          const now = new Date()
          const endTime = now.toTimeString().slice(0, 5)

          let duration = '0 min'
          if (startTime) {
            const [startH, startM] = startTime.split(':').map(Number)
            const [endH, endM] = endTime.split(':').map(Number)
            const startMinutes = startH * 60 + startM
            const endMinutes = endH * 60 + endM
            let diff = endMinutes - startMinutes
            if (diff < 0) diff += 24 * 60
            const hours = Math.floor(diff / 60)
            const minutes = diff % 60
            duration = hours > 0 ? `${hours}h ${minutes}m` : `${minutes} min`
          }

          const payload = {
            store_id: parseInt(formData.store_id) || 0, // Safety fallback
            inspector_id: user.id,
            supervisor_name: user.name || user.email,
            inspector_photo_url: inspectorPhoto,
            inspection_date: formData.inspection_date,
            inspection_time: formData.inspection_time,
            start_time: startTime,
            end_time: endTime,
            duration: duration,
            shift: formData.shift,
            overall_score: isNaN(overall) ? 0 : overall, // Safety check
            answers: richAnswers,
            observaciones: formData.observaciones || '',
            photos: allPhotos
          }

          // Map section titles (Support both ES and EN for bilingual supervisors)
          const sectionMapping: { [key: string]: string } = {
            'Servicio al Cliente': 'service_score',
            'Customer Service': 'service_score',
            'Procedimiento de Carnes': 'meat_score',
            'Meat Procedures': 'meat_score',
            'Preparación de Alimentos': 'food_score',
            'Food Preparation': 'food_score',
            'Seguimiento a Tortillas': 'tortilla_score',
            'Tortilla Monitoring': 'tortilla_score',
            'Limpieza General y Baños': 'cleaning_score',
            'General Cleaning & Bathrooms': 'cleaning_score',
            'Checklists y Bitácoras': 'log_score',
            'Checklists & Logs': 'log_score',
            'Aseo Personal': 'grooming_score',
            'Personal Grooming': 'grooming_score'
          }

          Object.entries(sectionScores).forEach(([title, score]) => {
            const colName = sectionMapping[title]
            if (colName) (payload as any)[colName] = score
          })

          console.log("🚀 [INSPECTION] Submitting payload...", payload)

          const { data: savedData, error } = initialData?.id
            ? await supabase.from('supervisor_inspections').update(payload).eq('id', initialData.id).select()
            : await supabase.from('supervisor_inspections').insert([payload]).select()

          if (error) throw error

          // Notifications (Fire & Forget, handled outside critical path logic usually, but kept here for logical grouping)
          // We wrap in non-awaiting try/catch so it doesn't block success
          try {
            const { data: admins } = await supabase.from('users').select('id').eq('role', 'admin')
            let recipients = admins ? admins.map(a => a.id) : []
            
            // Obtener managers de la tienda siempre para poder enviarles las notificaciones de comentarios
            // Usamos una consulta que cubra store_id directo o store_scope (si es manager de varias)
            const { data: allManagers } = await supabase.from('users').select('id, store_id, store_scope').in('role', ['manager', 'gerente', 'admin'])
            const managerIds = (allManagers || [])
              .filter(m => 
                m.store_id === payload.store_id || 
                (Array.isArray(m.store_scope) && m.store_scope.includes(payload.store_id)) ||
                (typeof m.store_scope === 'string' && m.store_scope.includes(String(payload.store_id)))
              )
              .map(m => m.id)

            if (overall < 87) {
              recipients = [...new Set([...recipients, ...managerIds])]
            }

            const storeName = stores.find(s => s.id.toString() === formData.store_id)?.name || 'Tienda'
            const notifs: any[] = []

            if (recipients.length > 0) {
              recipients.forEach(uid => {
                notifs.push({
                  user_id: uid,
                  title: overall < 87 ? `⚠️ Alerta: ${storeName}` : `Nueva Inspección: ${storeName}`,
                  message: `El supervisor ${payload.supervisor_name} completó una auditoría con ${overall}%`,
                  type: overall < 87 ? 'alert' : 'info',
                  link: '/inspecciones',
                  reference_id: savedData?.[0]?.id,
                  reference_type: 'supervisor_inspection'
                })
              })
            }

            // Notificaciones de comentarios: Se delegan a la API para evitar problemas de RLS en el frontend
            const questionsWithComments = allQuestions.filter(q => questionComments[q.id] && questionComments[q.id].trim() !== '')

            // --- NUEVO: DISPARAR NOTIFICACION POR CORREO ---
            if (questionsWithComments.length > 0 && savedData?.[0]?.id) {
              fetch('/api/notifications/inspection-comments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ inspection_id: savedData[0].id })
              }).then(res => res.json())
                .then(data => console.log('📧 Email notification response:', data))
                .catch(err => console.error('❌ Email notification failed:', err))
            }

            if (notifs.length > 0) {
              supabase.from('notifications').insert(notifs).then(() => console.log('Notifs sent including comments'))
            }
          } catch (notifErr) { console.warn("Notif error ignored", notifErr) }

          return savedData
        })(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Tiempo de espera agotado (30s). Verifica tu conexión.')), 30000))
      ])
    }

    try {
      setUploadProgress(50) // Force bump before request
      await submitWithTimeout()

      clearInterval(progressInterval)
      setUploadProgress(100)

      console.log('✅ Inspección Guardada. Redirigiendo...')
      // Limpiar borrador y permitir navegación limpia
      localStorage.removeItem(LOCALSTORAGE_KEY)
      allowNavigation.current = true
      setTimeout(() => {
        window.location.href = '/inspecciones'
      }, 1000)

    } catch (err: any) {
      clearInterval(progressInterval)
      console.error(err)
      alert(t('inspections.form.alerts.error_saving') + ': ' + err.message)
      setLoading(false)
      setUploadProgress(0)
    }
  }


  // RENDER UPLOAD OVERLAY (Blocking)
  if (loading) {
    return (
      <div className="fixed inset-0 z-[100] bg-white/90 backdrop-blur-md flex flex-col items-center justify-center p-8 animate-in fade-in duration-300">
        <div className="w-full max-w-sm space-y-8 text-center">

          {/* Icon Animation */}
          <div className="relative w-24 h-24 mx-auto">
            <div className="absolute inset-0 border-4 border-indigo-100 rounded-full"></div>
            <div className="absolute inset-0 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin"></div>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xl font-black text-indigo-600">{Math.round(uploadProgress)}%</span>
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-black text-gray-900 tracking-tight">{t('inspections.form.alerts.saving')}</h2>
            <p className="text-gray-500 font-medium">{t('inspections.form.alerts.syncing')}</p>
          </div>

          {/* Progress Bar Container */}
          <div className="h-4 bg-gray-100 rounded-full overflow-hidden border border-gray-200 w-full relative">
            <motion.div
              className="absolute top-0 left-0 h-full bg-gradient-to-r from-indigo-500 to-purple-600"
              initial={{ width: 0 }}
              animate={{ width: `${uploadProgress}%` }}
              transition={{ type: "spring", stiffness: 50 }}
            />
          </div>

          <p className="text-xs text-gray-400 font-mono">ID Transacción: {user?.id?.slice(0, 8) || '...'}</p>
        </div>
      </div>
    )
  }

  if (checklistLoading && !initialData) return <div className="min-h-screen grid place-items-center bg-transparent"><div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
  const { overall } = calculateScores()
  const scoreColor = overall >= 87 ? 'text-green-600' : overall >= 70 ? 'text-orange-600' : 'text-red-600'
  const scoreBg = overall >= 87 ? 'bg-green-50 border-green-200' : overall >= 70 ? 'bg-orange-50 border-orange-200' : 'bg-red-50 border-red-200'

  const validateLocation = () => {
    if (!formData.store_id) return alert(t('inspections.form.alerts.select_store'))

    // Find selected store coordinates
    const selectedStore = stores.find(s => s.id.toString() === formData.store_id)
    if (!selectedStore || !selectedStore.latitude || !selectedStore.longitude) {
      alert('Error: Esta sucursal no tiene coordenadas configuradas. Contacta a soporte.')
      return
    }

    // Safely capture coordinates for closure
    const storeLat = selectedStore.latitude
    const storeLon = selectedStore.longitude

    setValidatingLocation(true)

    if (!navigator.geolocation) {
      setValidatingLocation(false)
      return alert(t('inspections.form.alerts.location_error'))
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const userLat = position.coords.latitude
        const userLon = position.coords.longitude

        // Haversine Formula
        const R = 6371e3 // Earth radius in meters
        const dLat = (storeLat - userLat) * (Math.PI / 180)
        const dLon = (storeLon - userLon) * (Math.PI / 180)
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(userLat * (Math.PI / 180)) * Math.cos(storeLat * (Math.PI / 180)) *
          Math.sin(dLon / 2) * Math.sin(dLon / 2)
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
        const distance = R * c // Distance in meters

        setValidatingLocation(false)

        if (distance <= 100) {
          setLocationValidated(true)
          // alert(`✅ Ubicación validada! Estás a ${Math.round(distance)}m de la tienda.`)
        } else {
          alert(`${t('inspections.form.alerts.location_far')}\n\nDistancia detectada: ${Math.round(distance)} metros.\nLímite permitido: 100 metros.\n\n⚠️ REGLA ESTRICTA: Debes estar físicamente en la sucursal para poder enviar la inspección.`)
        }
      },
      (error) => {
        setValidatingLocation(false)
        console.error(error)
        let msg = t('inspections.form.alerts.location_error')
        
        if (error.code === 1) {
          msg = '🛑 PERMISO DE GPS DENEGADO 🛑\n\nPor políticas de la empresa, la ubicación es OBLIGATORIA.\n\n¿Cómo arreglarlo en tu celular?\n1. Toca el ícono de "Candado" o "Configuración" a la izquierda de la dirección de esta página (arriba).\n2. Ve a "Permisos" o "Configuración de sitios".\n3. En "Ubicación", selecciona "Permitir".\n4. Refresca la página.\n\n✅ Tu captura se guarda automáticamente, no perderás nada al refrescar.'
        } else if (error.code === 2) {
          msg = '🛑 UBICACIÓN NO DISPONIBLE 🛑\n\nTu celular no pudo encontrar tu ubicación GPS. Asegúrate de tener la "Ubicación" encendida en los ajustes principales de tu teléfono y sal a un área despejada.'
        } else if (error.code === 3) {
          msg = t('inspections.form.alerts.gps_timeout')
        }
        
        alert(msg)
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    )
  }

  return (
    <div className="min-h-screen bg-transparent pb-32 font-sans selection:bg-blue-200 selection:text-blue-900">

      {/* 
        FLOATING HEADER PILL
        Detached, floating, clean. Transparent-safe.
      */}
      <div className="fixed top-[76px] left-0 right-0 z-50 flex justify-center px-4 pointer-events-none">
        <div className="pointer-events-auto bg-white/95 backdrop-blur-xl shadow-[0_4px_20px_rgb(0,0,0,0.12)] rounded-full px-3 py-2 flex items-center gap-4 border border-gray-200/50 max-w-2xl w-full justify-between ring-1 ring-black/5">

          <div className="flex items-center gap-3 pl-1">
            <button onClick={handleBack} className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center text-gray-700 hover:bg-gray-100 hover:text-black transition-colors border border-gray-200">
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-sm font-black text-gray-900 tracking-tight leading-none">{t('inspections.form.supervision_header')}</h1>
              <div className="text-[11px] items-center gap-1 font-bold text-gray-500 uppercase hidden sm:flex">
                <Store size={12} /> {formatStoreName(stores.find(s => s.id.toString() === formData.store_id)?.name) || 'Select...'}
              </div>
            </div>
          </div>

          {/* Progress Pill */}
          <div className="flex items-center gap-3 pr-1">
            <div className="text-right hidden sm:block">
              <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{t('inspections.review.score').toUpperCase()}</div>
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

          <h2 className="text-2xl font-black text-gray-900 mb-6 tracking-tight">{t('inspections.form.title')}</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-gray-50 rounded-2xl p-4 transition-colors hover:bg-blue-50 group/field text-left border border-gray-200 hover:border-blue-200">
              <label className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 block group-hover/field:text-blue-700">{t('inspections.form.fields.store')}</label>
              <select
                value={formData.store_id} onChange={e => setFormData({ ...formData, store_id: e.target.value })}
                className="w-full bg-transparent font-bold text-gray-900 outline-none text-lg cursor-pointer"
              >
                <option value="">{t('inspections.form.fields.select_placeholder')}</option>
                {stores.map(s => <option key={s.id} value={s.id}>{formatStoreName(s.name)}</option>)}
              </select>
            </div>

            <div className="bg-gray-50 rounded-2xl p-4 transition-colors hover:bg-purple-50 group/field text-left border border-gray-200 hover:border-purple-200">
              <label className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 block group-hover/field:text-purple-700">{t('inspections.form.fields.shift')}</label>
              <select
                value={formData.shift} onChange={e => setFormData({ ...formData, shift: e.target.value })}
                className="w-full bg-transparent font-bold text-gray-900 outline-none text-lg cursor-pointer"
              >
                <option value="AM">{t('inspections.form.fields.morning')}</option>
                <option value="PM">{t('inspections.form.fields.afternoon')}</option>
              </select>
            </div>

            <div className="bg-gray-50 rounded-2xl p-4 transition-colors hover:bg-pink-50 group/field text-left border border-gray-200 hover:border-pink-200">
              <label className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 block group-hover/field:text-pink-700">{t('inspections.form.fields.date')}</label>
              <input type="date" value={formData.inspection_date} onChange={e => setFormData({ ...formData, inspection_date: e.target.value })}
                className="w-full bg-transparent font-bold text-gray-900 outline-none text-lg" />
            </div>

            <div className="bg-gray-50 rounded-2xl p-4 transition-colors hover:bg-orange-50 group/field text-left border border-gray-200 hover:border-orange-200">
              <label className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 block group-hover/field:text-orange-700">{t('inspections.form.fields.time')}</label>
              <input type="time" value={formData.inspection_time} onChange={e => setFormData({ ...formData, inspection_time: e.target.value })}
                className="w-full bg-transparent font-bold text-gray-900 outline-none text-lg" />
            </div>
          </div>
        </div>

        {/* SELFIE EVIDENCE CARD */}
        <div className="bg-gradient-to-br from-indigo-50 to-blue-50/50 backdrop-blur-sm rounded-[2.5rem] p-8 shadow-sm border border-indigo-100 ring-1 ring-black/5 text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-400 to-blue-500 opacity-50" />

          <h3 className="text-indigo-900 font-black text-lg mb-2 flex items-center justify-center gap-2 tracking-tight">
            <Camera className="w-5 h-5 text-indigo-500" />
            {t('inspections.form.evidence.title')}
          </h3>
          <p className="text-xs font-medium text-indigo-400 uppercase tracking-wider mb-6">{t('inspections.form.evidence.subtitle')}</p>

          <div className="flex justify-center">
            {inspectorPhoto ? (
              <div className="relative group animate-in fade-in zoom-in duration-300">
                <img src={inspectorPhoto} className="w-48 h-48 object-cover rounded-full border-4 border-white shadow-xl ring-4 ring-indigo-100" alt="Evidencia" />
                <button
                  type="button"
                  onClick={() => setInspectorPhoto(null)}
                  className="absolute bottom-2 right-2 bg-red-500 text-white p-2.5 rounded-full shadow-lg hover:bg-red-600 hover:scale-110 active:scale-90 transition-all z-10"
                >
                  <Trash2 size={18} />
                </button>
                <div className="absolute inset-0 rounded-full ring-inset ring-2 ring-black/5 pointer-events-none" />
              </div>
            ) : (
              <label className={`cursor-pointer group relative overflow-hidden w-48 h-48 rounded-full bg-white border-4 border-dashed border-indigo-200 flex flex-col items-center justify-center hover:bg-indigo-50 hover:border-indigo-300 transition-all ${uploadingSelfie ? 'opacity-50 pointer-events-none' : ''}`}>

                {uploadingSelfie ? (
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs font-bold text-indigo-400">{t('inspections.form.evidence.uploading')}</span>
                  </div>
                ) : (
                  <>
                    <div className="w-12 h-12 bg-indigo-50 rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                      <CameraOff size={24} className="text-indigo-400 group-hover:text-indigo-600" />
                    </div>
                    <span className="text-xs font-black text-indigo-900 group-hover:text-indigo-700 uppercase tracking-wide">{t('inspections.form.evidence.take_selfie')}</span>
                    <span className="text-[10px] text-indigo-400 mt-1 px-4 text-center leading-tight">{t('inspections.form.evidence.mandatory')}</span>
                  </>
                )}

                <input
                  type="file"
                  accept="image/*"
                  capture="user"
                  className="hidden"
                  onChange={handleInspectorPhotoUpload}
                  disabled={uploadingSelfie}
                />
              </label>
            )}
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
            <h3 className="font-bold text-yellow-700 uppercase tracking-widest text-sm mb-4">{t('inspections.form.final_notes.title')}</h3>
            <textarea
              value={formData.observaciones}
              onChange={e => setFormData({ ...formData, observaciones: e.target.value })}
              rows={4}
              className="w-full bg-gray-50 rounded-2xl p-4 border border-yellow-200 shadow-inner outline-none focus:ring-4 focus:ring-yellow-100 focus:border-yellow-400 transition-all font-medium text-gray-900 resize-none placeholder:text-gray-400"
              placeholder={t('inspections.form.final_notes.placeholder')}
            />
          </div>
        </form>
      </div>

      {/* Floating Action Button */}
      <div className="fixed bottom-8 left-0 right-0 z-50 flex justify-center pointer-events-none">
        {locationValidated ? (
          /* SUBMIT BUTTON (Enabled only after GPS validation) */
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleSubmit}
            disabled={loading}
            className="pointer-events-auto bg-gray-900 text-white px-8 py-4 rounded-full shadow-[0_20px_40px_-10px_rgba(0,0,0,0.4)] font-black text-lg flex items-center gap-3 hover:bg-black transition-colors disabled:opacity-50 disabled:scale-100 border-2 border-white/20"
          >
            {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> :
              <>
                <span>{t('inspections.form.actions.finish')}</span>
                <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                  <Send size={14} />
                </div>
              </>}
          </motion.button>
        ) : (
          /* VALIDATE LOCATION BUTTON */
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={validateLocation}
            disabled={validatingLocation || loading || completionStatus.percent < 95}
            className={`pointer-events-auto px-8 py-4 rounded-full shadow-[0_20px_40px_-10px_rgba(37,99,235,0.4)] font-black text-lg flex items-center gap-3 border-2 border-white/20 transition-all ${completionStatus.percent >= 95
              ? 'bg-blue-600 text-white hover:bg-blue-700 animate-pulse'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed border-gray-200 shadow-none grayscale'
              }`}
          >
            {validatingLocation ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : completionStatus.percent < 95 ? (
              <>
                <div className="flex flex-col items-start leading-tight">
                  <span className="text-xs font-bold uppercase tracking-wider opacity-70">{t('inspections.form.actions.complete_requirement')}</span>
                  <span className="text-sm font-black text-gray-600">{t('inspections.form.actions.progress')}: {completionStatus.percent}%</span>
                </div>
                <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center text-gray-400">
                  <span className="text-[10px] font-bold">{completionStatus.answered}/{completionStatus.total}</span>
                </div>
              </>
            ) : (
              <>
                <span>{t('inspections.form.actions.validate_location')}</span>
                <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                  <MapPin size={16} />
                </div>
              </>
            )}
          </motion.button>
        )}
      </div>

      {/* Modal de Conexión de Gmail para Inspecciones */}
      <AnimatePresence>
        {isGmailModalOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsGmailModalOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[150] flex items-center justify-center p-3"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white rounded-2xl shadow-2xl max-w-md w-full border border-gray-100 max-h-[92vh] overflow-y-auto overscroll-contain"
              >
                <div className="bg-gradient-to-r from-blue-600 to-red-500 h-2 w-full sticky top-0" />
                <div className="p-6 text-center relative">
                  <button
                    onClick={() => setIsGmailModalOpen(false)}
                    className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 transition-colors text-xl"
                  >
                    ✕
                  </button>

                  <div className="w-16 h-16 bg-white rounded-full shadow-lg mx-auto flex items-center justify-center mb-4 border-2 border-gray-100">
                    <svg viewBox="0 0 24 24" className="w-8 h-8"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.84z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg>
                  </div>

                  <h2 className="text-xl font-black text-gray-900 mb-2">
                    {language === 'en' ? '📝 Gmail Connection Required' : '📝 Conexión de Gmail Requerida'}
                  </h2>

                  <p className="text-gray-600 mb-3 text-sm leading-relaxed">
                    {language === 'en'
                      ? <span>To send <strong>inspection comments</strong> to the Manager, sign in with your <strong>Tacos Gavilán</strong> corporate email.</span>
                      : <span>Para enviar los <strong>comentarios de inspección</strong> al Manager, inicia sesión con tu correo corporativo de <strong>Tacos Gavilán</strong>.</span>
                    }
                  </p>

                  <div className="bg-gray-50 rounded-xl p-3 mb-3 text-left border border-gray-200">
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                      {language === 'en' ? 'Your corporate account is:' : 'Tu cuenta corporativa es:'}
                    </p>
                    <div className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-gray-100 shadow-sm">
                      <span className="text-base">📧</span>
                      <span className="text-sm font-black text-gray-800">{language === 'en' ? 'yourname' : 'tunombre'}<span className="text-blue-600">@tacosgavilan.com</span></span>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1.5 italic">
                      {language === 'en' ? 'Ex: carlos@tacosgavilan.com, maria@tacosgavilan.com' : 'Ej: carlos@tacosgavilan.com, maria@tacosgavilan.com'}
                    </p>
                  </div>

                  <div className="bg-green-50 rounded-xl p-3 mb-3 text-left flex gap-2 border border-green-200">
                    <span className="text-green-600 shrink-0 mt-0.5 text-base">✅</span>
                    <div className="text-xs text-green-800">
                      {language === 'en'
                        ? <span><span className="font-bold">Your inspection is safe.</span> It will be saved automatically and restored exactly as you left it when you return.</span>
                        : <span><span className="font-bold">Tu inspección está segura.</span> Se guardará automáticamente y al volver se restaurará exactamente como la dejaste.</span>
                      }
                    </div>
                  </div>

                  <div className="bg-blue-50 rounded-xl p-3 mb-4 text-left flex gap-2 border border-blue-200">
                    <ShieldCheck className="text-blue-600 shrink-0 mt-0.5" size={16} />
                    <div className="text-xs text-blue-800">
                      {language === 'en'
                        ? <span>The Manager will receive your observations from <b>YOUR</b> email. Use your <b>@tacosgavilan.com</b> account, NOT your personal Gmail.</span>
                        : <span>El Manager recibirá tus observaciones desde <b>TU</b> correo. Usa tu cuenta <b>@tacosgavilan.com</b>, NO tu Gmail personal.</span>
                      }
                    </div>
                  </div>

                  <button
                    onClick={saveDraftAndRedirect}
                    className="w-full bg-white border-2 border-gray-200 text-gray-700 py-3 px-4 rounded-xl font-bold hover:bg-gray-50 hover:shadow-lg hover:border-blue-300 transition-all flex items-center justify-center gap-3 group"
                  >
                    <svg viewBox="0 0 24 24" className="w-5 h-5 group-hover:scale-110 transition-transform"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.84z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg>
                    {language === 'en' ? 'Connect my Gmail Now' : 'Conectar mi Gmail Ahora'}
                  </button>

                  <button
                    onClick={() => setIsGmailModalOpen(false)}
                    className="mt-3 text-xs font-bold text-gray-400 hover:text-gray-600"
                  >
                    {language === 'en' ? 'Cancel and keep capturing' : 'Cancelar y seguir capturando'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
