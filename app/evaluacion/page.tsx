'use client'

import React, { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Star, MapPin, Send, CheckCircle2, User, UserCheck, Briefcase } from 'lucide-react'
import { useDynamicChecklist } from '@/hooks/useDynamicChecklist'
import { getSupabaseClient, formatStoreName } from '@/lib/supabase'
import DynamicQuestion from '@/components/checklists/DynamicQuestion'

const ROLES = ['Cajero(a)', 'Cocinero', 'Shift Leader', 'Asistente', 'Manager', 'Supervisor']
const LEAD_ROLES = new Set(['shift leader', 'asistente', 'manager', 'supervisor'])

const isLeadRole = (role: string): boolean => {
  return LEAD_ROLES.has(role.toLowerCase().trim())
}

export default function StaffEvaluationPage() {
  const searchParams = useSearchParams()
  const storeParam = searchParams.get('store')

  const [showSplash, setShowSplash] = useState(true)
  const [showThanks, setShowThanks] = useState(false)
  const [lang, setLang] = useState<'es' | 'en'>('es')
  const [stores, setStores] = useState<any[]>([])
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
    const timer = setTimeout(() => setShowSplash(false), 2000)
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
      const { data } = await supabase.from('stores').select('id, name, latitude, longitude').order('name')
      setStores(data || [])
    } catch (err) {
      console.error('Error fetching stores:', err)
    }
  }

  const detectLocation = () => {
    if (!navigator.geolocation) return
    setDetectingLocation(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords
        let closest: any = null
        let minDistance = Infinity

        stores.forEach(s => {
          if (s.latitude && s.longitude) {
            const d = Math.sqrt(Math.pow(s.latitude - latitude, 2) + Math.pow(s.longitude - longitude, 2))
            if (d < minDistance) {
              minDistance = d
              closest = s
            }
          }
        })

        if (closest && minDistance < 0.05) { // Roughly 5km
          setSelectedStore(closest.id)
        }
        setDetectingLocation(false)
      },
      () => setDetectingLocation(false),
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

      // We still need to map to q1_1 etc. for legacy tables if needed
      // But for now let's focus on the submission success
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
      storePlaceholder: 'Selecciona sucursal...',
      detectBtn: 'Detectar Ubicación',
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
      detectBtn: 'Detect Location',
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

  if (showSplash) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#50050a]">
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-center">
          <div className="w-32 h-32 bg-white rounded-full p-4 mx-auto mb-6 shadow-2xl">
            <img src="/logo.png" alt="TAG" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-2xl font-black text-white tracking-widest uppercase">Staff Eval</h1>
        </motion.div>
      </div>
    )
  }

  if (showThanks) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-6 text-center">
        <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="max-w-md">
          <CheckCircle2 size={80} className="text-green-500 mx-auto mb-6" />
          <h1 className="text-4xl font-black text-gray-900 mb-4">{t.thanks}</h1>
          <p className="text-gray-500 text-lg mb-8">{t.thanksMsg}</p>
          <button onClick={() => window.location.reload()} className="w-full py-4 bg-gray-900 text-white font-bold rounded-2xl shadow-xl">Realizar otra evaluación</button>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="flex bg-transparent font-sans w-full flex-col animate-in fade-in duration-500">
      <nav className="bg-white border-b border-gray-200 shadow-sm sticky top-14 lg:top-0 z-20 shrink-0">
        <div className="max-w-2xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Logo" className="h-8" />
            <span className="font-black text-xs tracking-widest uppercase text-gray-400">Staff Evaluation</span>
          </div>
          <button onClick={() => setLang(lang === 'es' ? 'en' : 'es')} className="text-xs font-black uppercase text-gray-900 bg-gray-100 px-3 py-1 rounded-full">{lang === 'es' ? 'EN' : 'ES'}</button>
        </div>
      </nav>

      <main className="flex-1 overflow-y-auto max-w-2xl mx-auto px-4 py-8 space-y-8 pb-24 w-full">
        <header className="text-center space-y-2">
          <h1 className="text-3xl font-black text-gray-900 italic uppercase italic">{t.title}</h1>
          <p className="text-gray-400 font-medium">{t.subtitle}</p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-8">
          <section className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 space-y-6">
            <div className="space-y-4">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                <MapPin size={12} /> {t.store}
              </label>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <select value={selectedStore} onChange={e => setSelectedStore(e.target.value)}
                  className="w-full p-4 bg-gray-50 border-gray-100 rounded-2xl font-bold text-gray-700 outline-none focus:ring-2 focus:ring-red-100 transition-all appearance-none">
                  <option value="">{t.storePlaceholder}</option>
                  {stores.map(s => <option key={s.id} value={s.id}>{formatStoreName(s.name)}</option>)}
                </select>
                <button type="button" onClick={detectLocation} disabled={detectingLocation}
                  className="p-4 bg-red-50 text-red-600 font-black text-xs uppercase tracking-widest rounded-2xl border border-red-100 hover:bg-red-100 transition-all disabled:opacity-50">
                  {detectingLocation ? t.detecting : t.detectBtn}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 pt-4 border-t border-gray-50">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2"><User size={12} /> {t.evaluator}</label>
                <input type="text" value={formData.evaluator_name} onChange={e => setFormData({ ...formData, evaluator_name: e.target.value })}
                  className="w-full p-4 bg-gray-50 border-gray-100 rounded-2xl font-bold text-gray-700 outline-none focus:ring-2 focus:ring-red-100 transition-all" />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2"><UserCheck size={12} /> {t.evaluatedName}</label>
                <input type="text" value={formData.evaluated_name} onChange={e => setFormData({ ...formData, evaluated_name: e.target.value })}
                  className="w-full p-4 bg-gray-50 border-gray-100 rounded-2xl font-bold text-gray-700 outline-none focus:ring-2 focus:ring-red-100 transition-all" />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2"><Briefcase size={12} /> {t.evaluatedRole}</label>
                <select value={formData.evaluated_role} onChange={e => setFormData({ ...formData, evaluated_role: e.target.value })}
                  className="w-full p-4 bg-gray-50 border-gray-100 rounded-2xl font-bold text-gray-700 outline-none focus:ring-2 focus:ring-red-100 transition-all appearance-none">
                  <option value="">{t.rolePlaceholder}</option>
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
          </section>

          {checklistLoading ? (
            <div className="p-12 text-center animate-pulse text-gray-400 font-black uppercase tracking-widest">Cargando Preguntas...</div>
          ) : (
            <div className="space-y-12">
              {template?.sections.map((section: any) => {
                const isLeadSection = section.title.toLowerCase().includes('liderazgo') || section.title.toLowerCase().includes('leadership')
                if (isLeadSection && !isLead) return null

                return (
                  <div key={section.id} className="space-y-6">
                    <div className="flex items-center gap-4 px-2">
                      <div className="h-[2px] flex-1 bg-gray-100" />
                      <h2 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em]">{section.title}</h2>
                      <div className="h-[2px] flex-1 bg-gray-100" />
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

          <section className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest italic">{t.fortalezas}</label>
                <textarea value={formData.fortalezas} onChange={e => setFormData({ ...formData, fortalezas: e.target.value })} rows={3}
                  className="w-full p-4 bg-gray-50 border-gray-100 rounded-2xl font-medium text-gray-700 outline-none focus:ring-2 focus:ring-red-100 transition-all resize-none" />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest italic">{t.areasMejora}</label>
                <textarea value={formData.areas_mejora} onChange={e => setFormData({ ...formData, areas_mejora: e.target.value })} rows={3}
                  className="w-full p-4 bg-gray-50 border-gray-100 rounded-2xl font-medium text-gray-700 outline-none focus:ring-2 focus:ring-red-100 transition-all resize-none" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6 pt-4 border-t border-gray-50">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{t.recomendaria}</label>
                <select value={formData.recomendaria} onChange={e => setFormData({ ...formData, recomendaria: e.target.value })}
                  className="w-full p-4 bg-gray-50 border-gray-100 rounded-2xl font-bold text-gray-700 outline-none focus:ring-2 focus:ring-red-100 transition-all">
                  <option value="si">{t.yes}</option>
                  <option value="no">{t.no}</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{t.general}</label>
                <input type="number" min="1" max="10" value={formData.desempeno_general || ''} onChange={e => setFormData({ ...formData, desempeno_general: parseInt(e.target.value) })}
                  className="w-full p-4 bg-gray-50 border-gray-100 rounded-2xl font-bold text-gray-700 outline-none focus:ring-2 focus:ring-red-100 transition-all" />
              </div>
            </div>

            <div className="space-y-2 pt-4">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest italic">{t.comentarios}</label>
              <textarea value={formData.comentarios} onChange={e => setFormData({ ...formData, comentarios: e.target.value })} rows={4}
                className="w-full p-4 bg-gray-50 border-gray-100 rounded-2xl font-medium text-gray-700 outline-none focus:ring-2 focus:ring-red-100 transition-all resize-none" />
            </div>

            <button type="submit" disabled={loading}
              className="w-full py-5 bg-gradient-to-r from-red-600 to-red-800 text-white font-black uppercase tracking-widest rounded-2xl shadow-xl shadow-red-100 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-3 disabled:opacity-50">
              {loading ? <div className="w-6 h-6 border-4 border-white border-t-transparent rounded-full animate-spin" /> : <><Send size={20} /><span>{t.send}</span></>}
            </button>
          </section>
        </form>
      </main>
    </div >
  )
}
