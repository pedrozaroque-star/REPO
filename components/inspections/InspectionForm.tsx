'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { ShieldCheck, Camera, Send, Calendar, Clock, MapPin, Sun, Moon, CheckCircle2, AlertCircle, ChevronRight, Store, User, Hash, FileText, ArrowLeft, MoreHorizontal, Trash2, CameraOff } from 'lucide-react'
import { getSupabaseClient, formatStoreName } from '@/lib/supabase'
import { useDynamicChecklist } from '@/hooks/useDynamicChecklist'
import DynamicQuestion from '@/components/checklists/DynamicQuestion'
import { getSafeLADateISO } from '@/lib/checklistPermissions'
import { getNumericValue } from '@/lib/scoreCalculator'

interface Store {
  id: string
  name: string
  code?: string
  latitude?: number
  longitude?: number
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

      // Load photos from __question_photos if available
      if (initialData.answers['__question_photos']) {
        setQuestionPhotos(initialData.answers['__question_photos'])
      }
    }
  }, [initialData, sections])

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
      alert('Error subiendo selfie: ' + error.message)
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

  // Protect against accidental exit
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (completionStatus.answered > 0) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [completionStatus.answered])

  const handleBack = () => {
    if (completionStatus.answered > 0) {
      if (confirm('⚠️ ¿Estás seguro de salir?\n\nPerderás todo el progreso de esta inspección no guardada.')) {
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return // BLOCK DOUBLE SUBMISSIONS

    if (!user) return alert('Sesión expirada')
    if (!formData.store_id) return alert('Selecciona una sucursal')

    if (!inspectorPhoto) return alert('📸 Falta evidencia: Debes tomarte una selfie dentro de la tienda.')

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
        inspector_photo_url: inspectorPhoto, // New Evidence Field
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
      console.error(err)
      alert('Error: ' + err.message)
      setLoading(false)
    }
  }

  if (checklistLoading && !initialData) return <div className="min-h-screen grid place-items-center bg-transparent"><div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
  const { overall } = calculateScores()
  const scoreColor = overall >= 87 ? 'text-green-600' : overall >= 70 ? 'text-orange-600' : 'text-red-600'
  const scoreBg = overall >= 87 ? 'bg-green-50 border-green-200' : overall >= 70 ? 'bg-orange-50 border-orange-200' : 'bg-red-50 border-red-200'

  const validateLocation = () => {
    if (!formData.store_id) return alert('Primero selecciona una sucursal.')

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
      return alert('Tu dispositivo no soporta geolocalización o está desactivada.')
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
          alert(`🚫 ESTÁS LEJOS DE LA TIENDA\n\nDistancia detectada: ${Math.round(distance)} metros.\nLímite permitido: 100 metros.\n\nAsegúrate de estar en el restaurante.`)
        }
      },
      (error) => {
        setValidatingLocation(false)
        console.error(error)
        let msg = 'Error obteniendo ubicación.'
        if (error.code === 1) msg = 'Permiso de ubicación denegado. Actívalo en tu navegador.'
        else if (error.code === 2) msg = 'Ubicación no disponible (GPS débil).'
        else if (error.code === 3) msg = 'Tiempo de espera agotado obteniendo GPS.'
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

        {/* SELFIE EVIDENCE CARD */}
        <div className="bg-gradient-to-br from-indigo-50 to-blue-50/50 backdrop-blur-sm rounded-[2.5rem] p-8 shadow-sm border border-indigo-100 ring-1 ring-black/5 text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-400 to-blue-500 opacity-50" />

          <h3 className="text-indigo-900 font-black text-lg mb-2 flex items-center justify-center gap-2 tracking-tight">
            <Camera className="w-5 h-5 text-indigo-500" />
            EVIDENCIA DE VISITA
          </h3>
          <p className="text-xs font-medium text-indigo-400 uppercase tracking-wider mb-6">Firma Digital Visual</p>

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
                    <span className="text-xs font-bold text-indigo-400">Subiendo...</span>
                  </div>
                ) : (
                  <>
                    <div className="w-12 h-12 bg-indigo-50 rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                      <CameraOff size={24} className="text-indigo-400 group-hover:text-indigo-600" />
                    </div>
                    <span className="text-xs font-black text-indigo-900 group-hover:text-indigo-700 uppercase tracking-wide">Tomar Selfie</span>
                    <span className="text-[10px] text-indigo-400 mt-1 px-4 text-center leading-tight">Obligatorio dentro de tienda</span>
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
                <span>FINALIZAR INSPECCIÓN</span>
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
                  <span className="text-xs font-bold uppercase tracking-wider opacity-70">Completa el 95%</span>
                  <span className="text-sm font-black text-gray-600">Avance: {completionStatus.percent}%</span>
                </div>
                <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center text-gray-400">
                  <span className="text-[10px] font-bold">{completionStatus.answered}/{completionStatus.total}</span>
                </div>
              </>
            ) : (
              <>
                <span>VALIDAR UBICACIÓN</span>
                <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                  <MapPin size={16} />
                </div>
              </>
            )}
          </motion.button>
        )}
      </div>

    </div>
  )
}
