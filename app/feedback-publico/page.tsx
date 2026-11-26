/**
 * @module app/feedback-publico/page
 * @description Formulario público bilingüe de retroalimentación de comensales (`/feedback-publico`).
 *
 * @businessRules
 * - Muestra todas las sucursales activas usando la nomenclatura oficial de cara al cliente (`formatCustomerStoreName`),
 *   identificando las tres tiendas de Los Ángeles (#5, #6 y #7) como `Los Ángeles` con sus entrecalles oficiales.
 * - Inserta únicamente columnas reales de `public.customer_feedback` (`comments`, `service_rating`, `speed_rating`,
 *   `food_quality_rating`, `cleanliness_rating`, `nps_score`, `nps_category`, `photo_urls`, `language`, `source`).
 * - Si la pregunta NPS queda sin responder, guarda `nps_score: null` y `nps_category: null` (nunca `0` / `'detractor'`).
 *
 * @dataFlow
 * - GET `stores` + `useDynamicChecklist('public_feedback_v1')` -> `INSERT public.customer_feedback`.
 *
 * @notes
 * - Corregido 2026-11-20: mapeadas columnas reales de `customer_feedback` (cero `PGRST204`), preservado `null` en NPS vacío y retirado cupón expirado.
 */

'use client'

import React, { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { Heart, Send, CheckCircle2, MapPin, Globe } from 'lucide-react'
import SurpriseLoader from '@/components/SurpriseLoader'
import { useDynamicChecklist } from '@/hooks/useDynamicChecklist'
import { getSupabaseClient, formatStoreName } from '@/lib/supabase'
import { sortStoresAlphabetically } from '@/lib/store-display'
import { formatCustomerStoreName } from '@/lib/customer-store-names'
import DynamicQuestion from '@/components/checklists/DynamicQuestion'

export default function FeedbackPublicoPage() {
  const searchParams = useSearchParams()
  const storeParam = searchParams.get('store')

  const [showSplash, setShowSplash] = useState(true)
  const [showThanks, setShowThanks] = useState(false)
  const [lang, setLang] = useState<'es' | 'en'>('es')
  const [stores, setStores] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedStore, setSelectedStore] = useState(storeParam || '')

  const [customerInfo, setCustomerInfo] = useState({
    customer_name: '',
    comments: ''
  })

  const [answers, setAnswers] = useState<{ [key: string]: any }>({})
  const [questionPhotos, setQuestionPhotos] = useState<{ [key: string]: string[] }>({})

  const { data: template, loading: checklistLoading } = useDynamicChecklist('public_feedback_v1')

  useEffect(() => {
    fetchStores()
    const timer = setTimeout(() => setShowSplash(false), 2000)
    return () => clearTimeout(timer)
  }, [])

  const fetchStores = async () => {
    try {
      const supabase = await getSupabaseClient()
      const { data } = await supabase.from('stores').select('*').order('name')
      setStores(data || [])
    } catch (err) {
      console.error('Error:', err)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedStore) return alert(t.errStore)

    setLoading(true)
    try {
      const supabase = await getSupabaseClient()
      const questions = template?.sections?.[0]?.questions || []

      // Preserve null when NPS is unanswered (never coerce blank to 0 detractor)
      const npsQ = questions.find((q: any) => q.type === 'nps_10' || q.type === 'nps')
      const rawNps = npsQ ? answers[npsQ.id] : undefined
      const parsedNps =
        rawNps !== undefined && rawNps !== null && String(rawNps).trim() !== ''
          ? Number(rawNps)
          : NaN
      const nps_score: number | null =
        Number.isFinite(parsedNps) && parsedNps >= 0 && parsedNps <= 10
          ? Math.round(parsedNps)
          : null

      let nps_category: string | null = null
      if (nps_score !== null) {
        if (nps_score >= 9) nps_category = 'promoter'
        else if (nps_score <= 6) nps_category = 'detractor'
        else nps_category = 'passive'
      }

      const resolveRating = (keywords: string[], fallbackOrderIndex: number): number | null => {
        const matched =
          questions.find((q: any) => {
            if (q.type !== 'rating_5') return false
            const hay = `${q.original_text || ''} ${q.text || ''}`.toLowerCase()
            return keywords.some(kw => hay.includes(kw))
          }) || questions.find((q: any) => q.type === 'rating_5' && q.order_index === fallbackOrderIndex)
        if (!matched) return null
        const val = Number(answers[matched.id])
        return Number.isFinite(val) && val >= 1 && val <= 5 ? Math.round(val) : null
      }

      const allPhotos = Object.values(questionPhotos).flat().filter(Boolean)
      const numericStoreId = Number(selectedStore)

      const payload = {
        store_id: Number.isFinite(numericStoreId) && numericStoreId > 0 ? numericStoreId : selectedStore,
        submission_date: new Date().toISOString(),
        service_rating: resolveRating(['caja', 'servicio', 'register', 'service'], 0),
        speed_rating: resolveRating(['entrega', 'tiempo', 'rapidez', 'speed', 'delivery'], 1),
        food_quality_rating: resolveRating(['calidad', 'alimentos', 'food', 'quality'], 2),
        cleanliness_rating: resolveRating(['limpieza', 'clean'], 3),
        nps_score,
        nps_category,
        comments: customerInfo.comments.trim() || null,
        customer_name: customerInfo.customer_name.trim() || null,
        language: lang,
        source: 'qr_public_feedback',
        photo_urls: allPhotos.length > 0 ? allPhotos : null
      }

      const { error } = await supabase.from('customer_feedback').insert([payload])
      if (error) throw error
      setShowThanks(true)
    } catch (err: any) {
      alert('Error: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const texts = {
    es: {
      title: '¡Tu opinión importa!',
      subtitle: 'Ayúdanos a mejorar tu experiencia.',
      store: '¿En qué sucursal nos visitas?',
      storePlaceholder: 'Selecciona una sucursal...',
      comments: 'Comentarios Adicionales',
      name: 'Tu Nombre (Opcional)',
      submit: 'Enviar Feedback',
      sending: 'Enviando...',
      thanks: '¡Gracias!',
      thanksMsg: 'Tu opinión ha sido recibida por el equipo de Tacos Gavilan y nos ayuda a mejorar cada día.',
      appreciationBadge: 'FAMILIA TACOS GAVILAN',
      appreciationText: '¡Esperamos verte muy pronto en cualquiera de nuestras sucursales!',
      backStart: 'Volver al inicio',
      errStore: 'Por favor selecciona una sucursal'
    },
    en: {
      title: 'Your opinion matters!',
      subtitle: 'Help us improve your experience.',
      store: 'Which location are you visiting?',
      storePlaceholder: 'Select a location...',
      comments: 'Additional Comments',
      name: 'Your Name (Optional)',
      submit: 'Submit Feedback',
      sending: 'Sending...',
      thanks: 'Thank You!',
      thanksMsg: 'Your feedback has been received by the Tacos Gavilan team and helps us improve every day.',
      appreciationBadge: 'TACOS GAVILAN FAMILY',
      appreciationText: 'We look forward to serving you again soon at any of our locations!',
      backStart: 'Back to start',
      errStore: 'Please select a location'
    }
  }

  const t = texts[lang]

  if (showSplash) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-red-600 dark:bg-neutral-900 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 dark:opacity-40 pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-center">
          <div className="w-32 h-32 bg-white dark:bg-slate-900 rounded-full p-4 mx-auto mb-6 shadow-2xl flex items-center justify-center">
            <span className="text-6xl">🌮</span>
          </div>
          <h1 className="text-2xl font-black text-white tracking-widest uppercase italic">Tacos Gavilan</h1>
          <p className="text-red-100 dark:text-slate-400 font-bold mt-2">Feedback System</p>
        </motion.div>
      </div>
    )
  }

  if (showThanks) {
    return (
      <div className="min-h-screen bg-green-50 dark:bg-neutral-900 flex items-center justify-center p-6 text-center overflow-hidden relative">
        <div className="absolute inset-0 opacity-10 dark:opacity-40 pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>

        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="max-w-md w-full bg-white dark:bg-slate-900 rounded-[3rem] p-10 shadow-2xl border-4 border-white dark:border-slate-800">
          <div className="w-20 h-20 bg-green-100 dark:bg-green-900/20 text-green-600 dark:text-green-500 rounded-full flex items-center justify-center mx-auto mb-8 shadow-inner shadow-green-200/50">
            <CheckCircle2 size={40} />
          </div>
          <h1 className="text-4xl font-black text-gray-900 dark:text-white mb-4">{t.thanks}</h1>
          <p className="text-gray-500 dark:text-slate-400 text-lg mb-8 leading-relaxed font-medium">{t.thanksMsg}</p>

          <div className="bg-gradient-to-br from-red-600 to-red-800 rounded-[2rem] p-6 text-white shadow-xl shadow-red-200/50 dark:shadow-none">
            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-yellow-300 mb-2">{t.appreciationBadge}</div>
            <p className="text-sm font-bold leading-relaxed">{t.appreciationText}</p>
          </div>

          <button onClick={() => window.location.reload()} className="mt-10 text-gray-400 dark:text-slate-500 font-black text-xs uppercase tracking-widest hover:text-gray-900 dark:hover:text-white transition-colors">{t.backStart}</button>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-transparent dark:bg-neutral-900 pb-20 font-sans relative overflow-hidden">
      <div className="absolute inset-0 opacity-10 dark:opacity-40 pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
      <nav className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md sticky top-0 z-40 border-b border-gray-100 dark:border-slate-800 transition-all">
        <div className="max-w-2xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-red-600 rounded-2xl p-2 shadow-lg shadow-red-100 dark:shadow-none flex items-center justify-center">
              <span className="text-2xl">🌮</span>
            </div>
            <div>
              <h1 className="font-black text-gray-900 dark:text-white tracking-tighter text-xl">TACOS GAVILAN</h1>
              <p className="text-[10px] font-black uppercase text-red-600 dark:text-red-400 tracking-widest -mt-1">{t.title}</p>
            </div>
          </div>
          <button onClick={() => setLang(lang === 'es' ? 'en' : 'es')}
            className="w-12 h-12 rounded-2xl bg-gray-50 dark:bg-slate-800 border border-gray-100 dark:border-slate-700 flex items-center justify-center text-gray-400 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors">
            <Globe size={20} />
          </button>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 py-10 space-y-12">
        <header className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-full text-[10px] font-black uppercase tracking-widest">
            <Heart size={12} fill="currentColor" /> Feedback Public
          </div>
          <h1 className="text-5xl font-black text-gray-900 dark:text-white tracking-tighter leading-none italic">{t.title}</h1>
          <p className="text-gray-400 dark:text-slate-500 text-lg font-medium">{t.subtitle}</p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-12">
          <section className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-[3rem] p-8 shadow-xl shadow-red-50/50 dark:shadow-none border border-gray-100 dark:border-slate-800/50 space-y-8 transition-all">
            <div className="space-y-4">
              <label className="text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2 ml-2">
                <MapPin size={12} className="text-red-500" /> {t.store}
              </label>
              <div className="relative">
                <select required value={selectedStore} onChange={e => setSelectedStore(e.target.value)}
                  className="w-full p-6 bg-gray-50 dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-[2rem] font-black text-xl text-gray-700 dark:text-white outline-none focus:ring-4 focus:ring-red-50 dark:focus:ring-red-900/20 transition-all appearance-none">
                  <option value="" className="dark:bg-slate-900">{t.storePlaceholder}</option>
                  {sortStoresAlphabetically(stores, (s) => formatCustomerStoreName(s, lang) || formatStoreName(s.name)).map(s => <option key={s.id} value={s.id} className="dark:bg-slate-900">{formatCustomerStoreName(s, lang) || formatStoreName(s.name)}</option>)}
                </select>
                <div className="absolute right-8 top-1/2 -translate-y-1/2 pointer-events-none text-gray-300 dark:text-slate-600">▼</div>
              </div>
            </div>
          </section>

          {checklistLoading ? (
            <div className="py-20 flex flex-col items-center justify-center">
              <SurpriseLoader />
              <div className="text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-[0.3em] -mt-10">Preparando tu encuesta...</div>
            </div>
          ) : (
            <div className="space-y-8">
              {template?.sections[0]?.questions.map((q: any, idx: number) => (
                <DynamicQuestion
                  key={q.id}
                  question={q}
                  index={idx}
                  value={answers[q.id]}
                  photos={questionPhotos[q.id] || []}
                  onChange={(val) => setAnswers(prev => ({ ...prev, [q.id]: val }))}
                  onPhotosChange={(urls) => setQuestionPhotos(prev => ({ ...prev, [q.id]: urls }))}
                />
              ))}
            </div>
          )}

          <section className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-[3rem] p-8 shadow-xl shadow-red-50/50 dark:shadow-none border border-gray-100 dark:border-slate-800 space-y-8 transition-colors">
            <div className="space-y-4">
              <label className="text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2 ml-2 italic">{t.comments}</label>
              <textarea value={customerInfo.comments} onChange={e => setCustomerInfo({ ...customerInfo, comments: e.target.value })} rows={4}
                className="w-full p-6 bg-gray-50 dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-[2rem] font-medium text-gray-700 dark:text-white outline-none focus:ring-4 focus:ring-red-50 dark:focus:ring-red-900/20 transition-all resize-none placeholder:text-gray-300 dark:placeholder:text-slate-600"
                placeholder="..." />
            </div>

            <div className="space-y-4">
              <label className="text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2 ml-2 italic">{t.name}</label>
              <input type="text" value={customerInfo.customer_name} onChange={e => setCustomerInfo({ ...customerInfo, customer_name: e.target.value })}
                className="w-full p-6 bg-gray-50 dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-[2rem] font-black text-xl text-gray-700 dark:text-white outline-none focus:ring-4 focus:ring-red-50 dark:focus:ring-red-900/20 transition-all placeholder:text-gray-300 dark:placeholder:text-slate-600"
                placeholder="Ex. Juan P." />
            </div>

            <button type="submit" disabled={loading}
              className="w-full py-8 bg-gradient-to-br from-red-600 to-red-800 text-white font-black text-2xl uppercase tracking-widest rounded-[2rem] shadow-2xl shadow-red-200/50 dark:shadow-none hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-4 disabled:opacity-50">
              {loading ? <div className="w-8 h-8 border-4 border-white border-t-transparent rounded-full animate-spin" /> : <><Send size={24} /><span>{t.submit}</span></>}
            </button>
          </section>
        </form>
      </main>
    </div>
  )
}
