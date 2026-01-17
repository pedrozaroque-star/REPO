'use client'

import React, { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { MapPin, Send, CheckCircle2, User, UserCheck, Briefcase } from 'lucide-react'
import { useDynamicChecklist } from '@/hooks/useDynamicChecklist'
import { getSupabaseClient, formatStoreName } from '@/lib/supabase'
import DynamicQuestion from '@/components/checklists/DynamicQuestion'
import SurpriseLoader from '@/components/SurpriseLoader'

const ROLES = ['Cajero(a)', 'Cocinero', 'Shift Leader', 'Asistente', 'Manager', 'Supervisor']
const LEAD_ROLES = new Set(['shift leader', 'asistente', 'manager', 'supervisor'])

const isLeadRole = (role: string): boolean => {
  return LEAD_ROLES.has(role.toLowerCase().trim())
}

interface Store {
  id: string
  name: string
  latitude: number | null
  longitude: number | null
  address?: string
  city?: string
}

export default function StaffEvaluationPage() {
  const searchParams = useSearchParams()
  const storeParam = searchParams.get('store')

  const [showSplash, setShowSplash] = useState(true)
  const [showThanks, setShowThanks] = useState(false)
  const [lang, setLang] = useState<'es' | 'en'>('es')
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedStore, setSelectedStore] = useState(storeParam || '')
  const [detectingLocation, setDetectingLocation] = useState(false)
  const [gpsExecuted, setGpsExecuted] = useState(false)

  const [formData, setFormData] = useState({
    evaluator_name: '',
    evaluated_name: '',
    evaluated_role: '',
    fortalezas: '',
    areas_mejora: '',
    recomendaria: 'si',
    desempeno_general: 0,
    comentarios: ''
  })

  const [answers, setAnswers] = useState<{ [key: string]: any }>({})
  const [questionPhotos, setQuestionPhotos] = useState<{ [key: string]: string[] }>({})

  const { data: template, loading: checklistLoading, isCached } = useDynamicChecklist('staff_evaluation_v1')

  useEffect(() => {
    fetchStores()
    const timer = setTimeout(() => setShowSplash(false), 7500)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!showSplash && stores.length > 0 && !gpsExecuted && !storeParam) {
      setGpsExecuted(true)
      setTimeout(detectLocation, 500)
    }
  }, [showSplash, stores, gpsExecuted, storeParam])

  const fetchStores = async () => {
    try {
      const supabase = await getSupabaseClient()
      const { data } = await supabase.from('stores').select('id, name, latitude, longitude, address, city').order('name')

      const storesWithNumbers = (Array.isArray(data) ? data : []).map(store => ({
        ...store,
        id: String(store.id),
        latitude: store.latitude ? parseFloat(store.latitude) : null,
        longitude: store.longitude ? parseFloat(store.longitude) : null
      }))
      setStores(storesWithNumbers)
    } catch (err) {
      console.error('Error fetching stores:', err)
    }
  }

  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLon = (lon2 - lon1) * Math.PI / 180
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  }

  const detectLocation = () => {
    if (!navigator.geolocation) {
      alert('Tu navegador no soporta geolocalización')
      return
    }
    setDetectingLocation(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords
        let closest: Store | null = null
        let minDistance = Infinity

        stores.forEach(s => {
          if (s.latitude && s.longitude) {
            const d = calculateDistance(latitude, longitude, s.latitude, s.longitude)
            if (d < minDistance) {
              minDistance = d
              closest = s
            }
          }
        })

        const MAX_DISTANCE_KM = 4.02 // 2.5 miles
        if (closest && minDistance <= MAX_DISTANCE_KM) {
          setSelectedStore((closest as Store).id)
        }
        setDetectingLocation(false)
      },
      () => {
        alert('No se pudo obtener la ubicación.')
        setDetectingLocation(false)
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedStore) return alert(t.errStore)
    if (!formData.evaluated_name) return alert(t.errName)
    if (!formData.evaluated_role) return alert(t.errRole)

    setLoading(true)
    try {
      const supabase = await getSupabaseClient()
      const allPhotos = Object.values(questionPhotos).flat()

      const payload = {
        store_id: selectedStore,
        evaluation_date: new Date().toISOString(),
        evaluator_name: formData.evaluator_name || null,
        evaluated_name: formData.evaluated_name,
        evaluated_role: formData.evaluated_role,
        fortalezas: formData.fortalezas,
        areas_mejora: formData.areas_mejora,
        recomendaria: formData.recomendaria,
        desempeno_general: formData.desempeno_general,
        comentarios: formData.comentarios,
        language: lang,
        photo_urls: allPhotos.length > 0 ? allPhotos : null,
        answers: {
          ...answers,
          '__question_photos': questionPhotos
        }
      }

      const { error } = await supabase.from('staff_evaluations').insert([payload])
      if (error) throw error
      setShowThanks(true)
    } catch (err: any) {
      alert(t.submitError + ': ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const texts = {
    es: {
      title: 'Evaluación de Staff',
      subtitle: 'Crecer juntos es nuestra meta.',
      store: 'Sucursal',
      storePlaceholder: 'Selecciona la Sucursal',
      detectBtn: 'Detectar GPS',
      detecting: 'Detectando...',
      evaluator: 'Tu Nombre (Opcional)',
      evaluatedName: 'Nombre del Staff a evaluar',
      evaluatedRole: 'Puesto del Staff',
      rolePlaceholder: 'Selecciona puesto...',
      catLead: 'Liderazgo (Solo para Mandos)',
      fortalezas: 'Fortalezas',
      areasMejora: 'Áreas de Mejora',
      recomendaria: '¿Lo recomiendas?',
      yes: 'Sí',
      no: 'No',
      general: 'Desempeño General (1-10)',
      comentarios: 'Comentarios Adicionales',
      send: 'Enviar Evaluación',
      sending: 'Enviando...',
      thanks: '¡Gracias!',
      thanksMsg: 'Tu evaluación ha sido recibida con éxito.',
      errStore: 'Por favor selecciona una sucursal',
      errName: 'Ingresa el nombre del evaluado',
      errRole: 'Selecciona el puesto',
      submitError: 'Error al enviar'
    },
    en: {
      title: 'Staff Evaluation',
      subtitle: 'Growing together is our goal.',
      store: 'Location',
      storePlaceholder: 'Select location...',
      detectBtn: 'Detect GPS',
      detecting: 'Detecting...',
      evaluator: 'Your Name (Optional)',
      evaluatedName: 'Staff Member Name',
      evaluatedRole: 'Staff Member Role',
      rolePlaceholder: 'Select role...',
      catLead: 'Leadership (Leads Only)',
      fortalezas: 'Strengths',
      areasMejora: 'Areas for Improvement',
      recomendaria: 'Do you recommend them?',
      yes: 'Yes',
      no: 'No',
      general: 'Overall Performance (1-10)',
      comentarios: 'Additional Comments',
      send: 'Submit Evaluation',
      sending: 'Submitting...',
      thanks: 'Thank You!',
      thanksMsg: 'Your evaluation has been successfully submitted.',
      errStore: 'Please select a location',
      errName: 'Enter staff member name',
      errRole: 'Select staff member role',
      submitError: 'Submission error'
    }
  }

  const t = texts[lang]
  const isLead = isLeadRole(formData.evaluated_role)
  const currentStoreInfo = stores.find(s => s.id === selectedStore)

  if (showSplash) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#50050a] overflow-hidden">
        <div className="absolute inset-0 opacity-10 bg-[url('https://grainy-gradients.vercel.app/noise.svg')]"></div>

        <div className="relative z-10 flex flex-col items-center">
          <motion.div
            initial={{ y: -800, opacity: 0, rotateY: 0 }}
            animate={{
              y: 0,
              opacity: 1,
              rotateY: 2520,
              transition: {
                type: "spring",
                damping: 10,
                stiffness: 20,
                duration: 4.5
              }
            }}
            className="w-48 h-48 rounded-full bg-gradient-to-br from-[#fdc82f] to-[#e69b00] p-1.5 shadow-[0_0_60px_rgba(253,200,47,0.4)] relative"
          >
            <div className="w-full h-full rounded-full bg-white flex items-center justify-center overflow-hidden border-4 border-[#fffbeb]">
              <img src="/logo.png" alt="TAG" className="w-[85%] h-[85%] object-contain" />
            </div>

            <motion.div
              className="absolute inset-0 rounded-full border border-white/50"
              initial={{ scale: 0, opacity: 0.8 }}
              animate={{
                scale: 3,
                opacity: 0,
                transition: {
                  duration: 2,
                  repeat: Infinity,
                  delay: 1.2,
                  ease: "easeOut"
                }
              }}
            />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{
              opacity: 1,
              scale: 1,
              transition: { delay: 1, duration: 0.5 }
            }}
            className="mt-8 w-64 h-24 flex items-center justify-center"
          >
            <img
              src="/ya_esta.png"
              alt="¡Ya está!"
              className="w-full h-full object-contain drop-shadow-[0_0_15px_rgba(253,200,47,0.5)]"
            />
          </motion.div>
        </div>
      </div>
    )
  }

  if (showThanks) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-br from-[#50050a] to-[#1a0103] text-white p-6">
        <div className="absolute inset-0 opacity-10 bg-[url('https://grainy-gradients.vercel.app/noise.svg')]"></div>
        <div className="relative z-10 flex flex-col items-center text-center animate-in fade-in zoom-in duration-700">
          <div className="w-32 h-32 rounded-full bg-[#fdc82f] flex items-center justify-center shadow-[0_0_50px_rgba(253,200,47,0.5)] mb-8">
            <span className="text-6xl text-[#50050a]">✓</span>
          </div>
          <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-[#fdc82f] to-[#fffbeb] mb-4 tracking-tight">
            {t.thanks}
          </h1>
          <p className="text-xl text-white/80 font-light max-w-md leading-relaxed">
            {t.thanksMsg}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-8 px-8 py-3 bg-white/10 border border-white/20 hover:bg-white/20 text-white rounded-lg font-bold transition-all"
          >
            Realizar otra evaluación
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-900 flex flex-col items-center justify-start p-4 relative overflow-hidden">
      {/* Fondo decorativo sutil */}
      <div className="absolute inset-0 opacity-60 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>

      {/* Logo y título superior */}
      <div className="w-full max-w-md z-10 mt-8 mb-6">
        <div className="text-center flex flex-col items-center mb-6">
          <div className="w-32 h-32 bg-white rounded-full flex items-center justify-center shadow-lg mb-4 p-2">
            <div className="w-28 h-28 flex items-center justify-center">
              <img
                src="/logo.png"
                alt="Logo Tacos Gavilan"
                className="w-full h-full object-contain"
              />
            </div>
          </div>

          <div className="w-48 h-16 mb-2 flex items-center justify-center">
            <img
              src="/ya_esta.png"
              alt="Ya está"
              className="w-full h-full object-contain"
            />
          </div>
        </div>

        <h1 className="text-2xl font-bold text-white tracking-wider text-center">
          {t.title}
        </h1>
        <p className="text-sm text-gray-400 text-center mt-2">{t.subtitle}</p>

        <div className="flex justify-center mt-4">
          <button
            onClick={() => setLang(lang === 'es' ? 'en' : 'es')}
            className="px-4 py-1.5 rounded-full bg-white/10 dark:bg-slate-800 border border-white/20 dark:border-slate-700 text-xs font-bold text-white hover:bg-white/20 dark:hover:bg-slate-700 transition-all"
          >
            {lang === 'es' ? '🇬🇧 EN' : '🇪🇸 ES'}
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="w-full max-w-md z-20 space-y-4 pb-8">

        {/* TARJETA 1: Selección de Tienda */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden border border-gray-100 dark:border-slate-800">
          <div className="h-2 bg-red-600 w-full"></div>
          <div className="p-6">
            <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-3 flex items-center gap-2">
              <MapPin size={16} className="text-red-600" /> {t.store}
            </label>
            <select
              value={selectedStore}
              onChange={(e) => setSelectedStore(e.target.value)}
              className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition text-gray-900 dark:text-white"
              required
            >
              <option value="" className="dark:bg-slate-900">{t.storePlaceholder}</option>
              {stores.map(s => (
                <option key={s.id} value={s.id} className="dark:bg-slate-900">{formatStoreName(s.name)}</option>
              ))}
            </select>

            {currentStoreInfo && (
              <div className="mt-3 flex items-start gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-900/30">
                <span className="text-base">📍</span>
                <div className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
                  <span className="block font-bold text-blue-800 dark:text-blue-200">¿Estás aquí?</span>
                  {currentStoreInfo.address}<br />
                  {currentStoreInfo.city}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={detectLocation}
              disabled={detectingLocation}
              className="w-full mt-3 py-2.5 rounded-lg bg-gray-100 dark:bg-slate-800 border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-300 font-bold text-sm hover:bg-gray-200 dark:hover:bg-slate-700 active:scale-95 transition-all disabled:opacity-50"
            >
              {detectingLocation ? '📍 Detectando...' : `📍 ${t.detectBtn}`}
            </button>
          </div>
        </div>

        {/* TARJETA 2: Información Personal */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden border border-gray-100 dark:border-slate-800">
          <div className="h-2 bg-red-600 w-full"></div>
          <div className="p-6 space-y-5">
            <div>
              <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-2 flex items-center gap-2">
                <User size={16} className="text-gray-400" /> {t.evaluator}
              </label>
              <input
                type="text"
                value={formData.evaluator_name}
                onChange={e => setFormData({ ...formData, evaluator_name: e.target.value })}
                className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition text-gray-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-2 flex items-center gap-2">
                <UserCheck size={16} className="text-red-600" /> {t.evaluatedName}
              </label>
              <input
                type="text"
                value={formData.evaluated_name}
                onChange={e => setFormData({ ...formData, evaluated_name: e.target.value })}
                className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition text-gray-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-2 flex items-center gap-2">
                <Briefcase size={16} className="text-red-600" /> {t.evaluatedRole}
              </label>
              <select
                value={formData.evaluated_role}
                onChange={e => setFormData({ ...formData, evaluated_role: e.target.value })}
                className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition text-gray-900 dark:text-white"
              >
                <option value="" className="dark:bg-slate-900">{t.rolePlaceholder}</option>
                {ROLES.map(r => <option key={r} value={r} className="dark:bg-slate-900">{r}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* TARJETA 3: Checklist Dinámico */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden border border-gray-100 dark:border-slate-800">
          <div className="h-2 bg-red-600 w-full"></div>
          <div className="p-6">
            {checklistLoading ? (
              <div className="p-8 flex justify-center scale-75">
                <SurpriseLoader />
              </div>
            ) : (
              <div className="space-y-8">
                {template?.sections.map((section: any) => {
                  const isLeadSection = section.title.toLowerCase().includes('liderazgo') || section.title.toLowerCase().includes('leadership')
                  if (isLeadSection && !isLead) return null

                  return (
                    <div key={section.id} className="space-y-4">
                      <div className="flex items-center gap-4">
                        <div className="h-[1px] flex-1 bg-gray-200 dark:bg-slate-800" />
                        <h2 className="text-xs font-black text-gray-400 dark:text-slate-500 uppercase tracking-[0.2em]">{section.title}</h2>
                        <div className="h-[1px] flex-1 bg-gray-200 dark:bg-slate-800" />
                      </div>
                      <div className="space-y-4">
                        {section.questions.map((q: any, idx: number) => {
                          const isLeadQ = q.text.toLowerCase().includes('(líder)') || q.text.toLowerCase().includes('(lider)') || q.text.toLowerCase().includes('(lead)')
                          if (isLeadQ && !isLead) return null

                          return (
                            <DynamicQuestion
                              key={q.id}
                              question={q}
                              index={idx}
                              value={answers[q.id]}
                              photos={questionPhotos[q.id] || []}
                              onChange={(val) => setAnswers(prev => ({ ...prev, [q.id]: val }))}
                              onPhotosChange={(urls) => setQuestionPhotos(prev => ({ ...prev, [q.id]: urls }))}
                            />
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* TARJETA 4: Evaluación Cualitativa */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden border border-gray-100 dark:border-slate-800">
          <div className="h-2 bg-red-600 w-full"></div>
          <div className="p-6 space-y-5">
            <div>
              <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-2">{t.fortalezas}</label>
              <textarea
                value={formData.fortalezas}
                onChange={e => setFormData({ ...formData, fortalezas: e.target.value })}
                rows={3}
                className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition text-gray-900 dark:text-white resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-2">{t.areasMejora}</label>
              <textarea
                value={formData.areas_mejora}
                onChange={e => setFormData({ ...formData, areas_mejora: e.target.value })}
                rows={3}
                className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition text-gray-900 dark:text-white resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2">
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-2">{t.recomendaria}</label>
                <select
                  value={formData.recomendaria}
                  onChange={e => setFormData({ ...formData, recomendaria: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition text-gray-900 dark:text-white"
                >
                  <option value="si" className="dark:bg-slate-900">{t.yes}</option>
                  <option value="no" className="dark:bg-slate-900">{t.no}</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-2">{t.general}</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={formData.desempeno_general || ''}
                  onChange={e => setFormData({ ...formData, desempeno_general: parseInt(e.target.value) })}
                  className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition text-gray-900 dark:text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-2">{t.comentarios}</label>
              <textarea
                value={formData.comentarios}
                onChange={e => setFormData({ ...formData, comentarios: e.target.value })}
                rows={3}
                className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition text-gray-900 dark:text-white resize-none"
              />
            </div>
          </div>
        </div>

        {/* TARJETA 5: Botón Enviar */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden border border-gray-100 dark:border-slate-800">
          <div className="h-2 bg-red-600 w-full"></div>
          <div className="p-6">
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-red-700 hover:bg-red-800 text-white font-bold py-4 px-4 rounded-lg shadow-md hover:shadow-lg transition-all transform active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed uppercase tracking-wide flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>{t.sending}</span>
                </>
              ) : (
                <>
                  <span>{t.send}</span>
                  <Send size={18} />
                </>
              )}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center py-4">
          <div className="flex items-center justify-center gap-2 mb-2">
            <img src="/logo.png" className="h-6 opacity-30" alt="Logo" />
          </div>
          <p className="text-xs text-gray-400">
            © 2026 Tacos Gavilan. {selectedStore && `ID: ${selectedStore}`}
          </p>
        </div>
      </form>
    </div>
  )
}
