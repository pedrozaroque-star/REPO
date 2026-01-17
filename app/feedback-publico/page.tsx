'use client'

import React, { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Heart, Send, CheckCircle2, Gift, MapPin, Globe } from 'lucide-react'
import SurpriseLoader from '@/components/SurpriseLoader'
import { useDynamicChecklist } from '@/hooks/useDynamicChecklist'
import { getSupabaseClient, formatStoreName } from '@/lib/supabase'
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
    customer_comments: ''
  })

  const [answers, setAnswers] = useState<{ [key: string]: any }>({})
  const [questionPhotos, setQuestionPhotos] = useState<{ [key: string]: string[] }>({})

  const { data: template, loading: checklistLoading, isCached } = useDynamicChecklist('public_feedback_v1')

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

      // Calculate NPS category if NPS question exists
      const npsQ = template?.sections[0]?.questions.find((q: any) => q.type === 'nps_10')
      let nps_score = npsQ ? (answers[npsQ.id] || 0) : null
      let nps_category = 'passive'
      if (nps_score !== null) {
        if (nps_score >= 9) nps_category = 'promoter'
        else if (nps_score <= 6) nps_category = 'detractor'
      }

      const formattedAnswers: { [key: string]: any } = {}
      template?.sections[0]?.questions.forEach((q: any) => {
        formattedAnswers[q.text] = answers[q.id]
      })

      // Add rich photo mapping
      formattedAnswers['__question_photos'] = questionPhotos

      const payload = {
        store_id: selectedStore,
        submission_date: new Date().toISOString(),
        nps_score,
        nps_category,
        customer_comments: customerInfo.customer_comments,
        customer_name: customerInfo.customer_name,
        language: lang,
        answers: formattedAnswers,
        photo_urls: Object.values(questionPhotos).flat()
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
      thanksMsg: 'Tu opinión nos ayuda a mejorar cada día.',
      couponTitle: '¡TENEMOS UN REGALO!',
      couponCode: 'TG2024',
      couponDesc: 'Muestra este código en tu próxima visita para un 10% de descuento.',
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
      thanksMsg: 'Your feedback helps us improve every day.',
      couponTitle: 'WE HAVE A GIFT!',
      couponCode: 'TG2024',
      couponDesc: 'Show this code on your next visit for a 10% discount.',
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
        <div className="absolute inset-0 pointer-events-none opacity-20">
          {[...Array(12)].map((_, i) => (
            <motion.div key={i} animate={{ y: [0, 1000] }} transition={{ duration: 5 + Math.random() * 5, repeat: Infinity, ease: 'linear', delay: Math.random() * 5 }}
              className="absolute text-4xl" style={{ left: `${Math.random() * 100}%`, top: '-50px' }}>
              🪙
            </motion.div>
          ))}
        </div>

        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="max-w-md w-full bg-white dark:bg-slate-900 rounded-[3rem] p-10 shadow-2xl border-4 border-white dark:border-slate-800">
          <div className="w-20 h-20 bg-green-100 dark:bg-green-900/20 text-green-600 dark:text-green-500 rounded-full flex items-center justify-center mx-auto mb-8 shadow-inner shadow-green-200/50">
            <CheckCircle2 size={40} />
          </div>
          <h1 className="text-4xl font-black text-gray-900 dark:text-white mb-4">{t.thanks}</h1>
          <p className="text-gray-500 dark:text-slate-400 text-lg mb-10 leading-relaxed font-medium">{t.thanksMsg}</p>

          <div className="bg-gradient-to-br from-yellow-400 to-orange-500 rounded-[2.5rem] p-8 text-white shadow-xl shadow-orange-200/50 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 rotate-12 group-hover:rotate-45 transition-transform duration-700">
              <Gift size={100} />
            </div>
            <h2 className="text-xs font-black uppercase tracking-[0.2em] mb-2">{t.couponTitle}</h2>
            <div className="text-4xl font-black mb-4 tracking-tighter">10% OFF</div>
            <div className="bg-white/20 backdrop-blur-md rounded-2xl py-3 px-6 font-black text-2xl tracking-widest inline-block border border-white/30 uppercase">{t.couponCode}</div>
            <p className="text-[10px] font-bold mt-6 opacity-90 leading-relaxed">{t.couponDesc}</p>
          </div>

          <button onClick={() => window.location.reload()} className="mt-10 text-gray-400 dark:text-slate-500 font-black text-xs uppercase tracking-widest hover:text-gray-900 dark:hover:text-white transition-colors">Volver al inicio</button>
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
                  {stores.map(s => <option key={s.id} value={s.id} className="dark:bg-slate-900">{formatStoreName(s.name)}</option>)}
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
              <textarea value={customerInfo.customer_comments} onChange={e => setCustomerInfo({ ...customerInfo, customer_comments: e.target.value })} rows={4}
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
