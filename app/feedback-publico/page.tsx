'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'

export default function FeedbackPublicoPage() {
  const searchParams = useSearchParams()
  const storeParam = searchParams.get('store')
  
  const [showSplash, setShowSplash] = useState(true)
  const [showThanks, setShowThanks] = useState(false)
  const [lang, setLang] = useState<'es' | 'en'>('es')
  const [stores, setStores] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  
  const [formData, setFormData] = useState({
    store_id: storeParam || '',
    service_rating: 5,
    speed_rating: 5,
    food_quality_rating: 5,
    cleanliness_rating: 5,
    nps_score: 8,
    customer_comments: '',
    customer_name: ''
  })

  useEffect(() => {
    fetchStores()
    // Splash desaparece después de 3 segundos
    setTimeout(() => setShowSplash(false), 3000)
  }, [])

  const fetchStores = async () => {
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

      const res = await fetch(`${url}/rest/v1/stores?select=*&order=name.asc`, {
        headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` }
      })
      const data = await res.json()
      setStores(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Error:', err)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

      // Calcular categoría NPS
      let nps_category = 'passive'
      if (formData.nps_score >= 9) nps_category = 'promoter'
      else if (formData.nps_score <= 6) nps_category = 'detractor'

      // Calcular wait_time (simulado)
      const wait_time_minutes = Math.floor(Math.random() * 15) + 5

      const payload = {
        store_id: formData.store_id,
        submission_date: new Date().toISOString(),
        service_rating: formData.service_rating,
        speed_rating: formData.speed_rating,
        food_quality_rating: formData.food_quality_rating,
        cleanliness_rating: formData.cleanliness_rating,
        nps_score: formData.nps_score,
        nps_category,
        customer_comments: formData.customer_comments,
        customer_name: formData.customer_name,
        wait_time_minutes,
        language: lang
      }

      const res = await fetch(`${url}/rest/v1/customer_feedback`, {
        method: 'POST',
        headers: {
          'apikey': key || '',
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(payload)
      })

      if (res.ok) {
        setShowThanks(true)
      } else {
        alert('Error al enviar feedback')
      }
    } catch (err) {
      console.error('Error:', err)
      alert('Error al enviar feedback')
    }

    setLoading(false)
  }

  const texts = {
    es: {
      title: '¡Tu opinión importa!',
      store: '¿En qué sucursal estás?',
      service: 'Atención en caja',
      speed: 'Tiempo de entrega',
      quality: 'Calidad de alimentos',
      cleanliness: 'Limpieza del local',
      nps: '¿Nos recomendarías?',
      nps_desc: 'Del 0 al 10, ¿qué tan probable es que nos recomiendes?',
      comments: 'Comentarios (opcional)',
      name: 'Tu nombre (opcional)',
      submit: 'Enviar respuestas',
      thanks: '¡GRACIAS!',
      thanks_msg: 'Tu opinión nos ayuda a mejorar cada día',
      another: 'Dar más feedback',
      close: 'Cerrar'
    },
    en: {
      title: 'Your opinion matters!',
      store: 'Which location are you at?',
      service: 'Cashier service',
      speed: 'Delivery time',
      quality: 'Food quality',
      cleanliness: 'Restaurant cleanliness',
      nps: 'Would you recommend us?',
      nps_desc: 'From 0 to 10, how likely are you to recommend us?',
      comments: 'Comments (optional)',
      name: 'Your name (optional)',
      submit: 'Submit feedback',
      thanks: 'THANK YOU!',
      thanks_msg: 'Your feedback helps us improve every day',
      another: 'Give more feedback',
      close: 'Close'
    }
  }

  const t = texts[lang]

  // Splash Screen
  if (showSplash) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-600 to-red-800 flex items-center justify-center">
        <div className="text-center animate-pulse">
          <div className="text-9xl mb-6">🌮</div>
          <h1 className="text-6xl font-bold text-white mb-4">TACOS GAVILAN</h1>
          <p className="text-2xl text-red-100">Sistema de Feedback</p>
        </div>
      </div>
    )
  }

  // Thank You Screen con moneda cayendo
  if (showThanks) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-500 to-green-700 flex items-center justify-center relative overflow-hidden">
        {/* Monedas cayendo animadas */}
        <div className="absolute inset-0 pointer-events-none">
          {[...Array(20)].map((_, i) => (
            <div
              key={i}
              className="absolute text-6xl animate-bounce"
              style={{
                left: `${Math.random() * 100}%`,
                top: `${-20 - Math.random() * 20}%`,
                animationDelay: `${Math.random() * 2}s`,
                animationDuration: `${2 + Math.random() * 2}s`
              }}
            >
              🪙
            </div>
          ))}
        </div>

        <div className="text-center z-10 bg-white rounded-3xl p-12 shadow-2xl max-w-2xl mx-4">
          <div className="text-8xl mb-6">✅</div>
          <h1 className="text-5xl font-bold text-green-600 mb-4">{t.thanks}</h1>
          <p className="text-2xl text-gray-700 mb-8">{t.thanks_msg}</p>
          
          <div className="bg-gradient-to-r from-yellow-400 to-yellow-600 rounded-2xl p-8 mb-8 text-white">
            <div className="text-6xl mb-4">🎁</div>
            <h2 className="text-3xl font-bold mb-2">CUPÓN 10% OFF</h2>
            <p className="text-xl mb-2">Próxima visita</p>
            <p className="text-2xl font-mono font-bold">TG2024</p>
          </div>

          <div className="flex gap-4 justify-center">
            <button
              onClick={() => {
                setShowThanks(false)
                setFormData({
                  store_id: storeParam || '',
                  service_rating: 5,
                  speed_rating: 5,
                  food_quality_rating: 5,
                  cleanliness_rating: 5,
                  nps_score: 8,
                  customer_comments: '',
                  customer_name: ''
                })
              }}
              className="px-8 py-4 bg-green-600 hover:bg-green-700 text-white font-bold text-xl rounded-xl transition-colors"
            >
              {t.another}
            </button>
            <button
              onClick={() => window.close()}
              className="px-8 py-4 bg-gray-600 hover:bg-gray-700 text-white font-bold text-xl rounded-xl transition-colors"
            >
              {t.close}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Formulario Principal
  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-red-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header con logo y selector de idioma */}
        <div className="bg-white rounded-3xl shadow-2xl p-8 mb-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-4">
              <div className="text-6xl">🌮</div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">TACOS GAVILAN</h1>
                <p className="text-red-600 font-semibold">{t.title}</p>
              </div>
            </div>
            
            <div className="flex space-x-2">
              <button
                onClick={() => setLang('es')}
                className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
                  lang === 'es' ? 'bg-red-600 text-white' : 'bg-gray-200 text-gray-700'
                }`}
              >
                🇲🇽 ES
              </button>
              <button
                onClick={() => setLang('en')}
                className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
                  lang === 'en' ? 'bg-red-600 text-white' : 'bg-gray-200 text-gray-700'
                }`}
              >
                🇺🇸 EN
              </button>
            </div>
          </div>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Selector de tienda */}
          <div className="bg-white rounded-2xl shadow-lg p-6">
            <label className="block text-lg font-bold text-gray-900 mb-3">
              📍 {t.store}
            </label>
            <select
              required
              value={formData.store_id}
              onChange={(e) => setFormData({...formData, store_id: e.target.value})}
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl text-gray-900 text-lg focus:ring-2 focus:ring-red-500"
            >
              <option value="">Seleccionar...</option>
              {stores.map(store => (
                <option key={store.id} value={store.id}>{store.name}</option>
              ))}
            </select>
          </div>

          {/* Preguntas con emojis */}
          {[
            { key: 'service_rating', label: t.service, emoji: '😊' },
            { key: 'speed_rating', label: t.speed, emoji: '⚡' },
            { key: 'food_quality_rating', label: t.quality, emoji: '🌮' },
            { key: 'cleanliness_rating', label: t.cleanliness, emoji: '✨' }
          ].map(({ key, label, emoji }) => (
            <div key={key} className="bg-white rounded-2xl shadow-lg p-6">
              <label className="block text-lg font-bold text-gray-900 mb-4">
                {emoji} {label}
              </label>
              <div className="flex justify-between items-center">
                {[1, 2, 3, 4, 5].map(val => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setFormData({...formData, [key]: val})}
                    className={`text-5xl transition-transform hover:scale-125 ${
                      formData[key as keyof typeof formData] >= val ? 'opacity-100' : 'opacity-30'
                    }`}
                  >
                    {val === 1 ? '😢' : val === 2 ? '😐' : val === 3 ? '🙂' : val === 4 ? '😃' : '🤩'}
                  </button>
                ))}
              </div>
              <p className="text-center text-2xl font-bold text-red-600 mt-4">
                {formData[key as keyof typeof formData]}/5
              </p>
            </div>
          ))}

          {/* NPS */}
          <div className="bg-white rounded-2xl shadow-lg p-6">
            <label className="block text-lg font-bold text-gray-900 mb-2">
              ⭐ {t.nps}
            </label>
            <p className="text-gray-600 mb-4">{t.nps_desc}</p>
            <input
              type="range"
              min="0"
              max="10"
              value={formData.nps_score}
              onChange={(e) => setFormData({...formData, nps_score: parseInt(e.target.value)})}
              className="w-full h-3 bg-gradient-to-r from-red-500 via-yellow-500 to-green-500 rounded-lg appearance-none cursor-pointer"
            />
            <div className="flex justify-between text-sm text-gray-600 mt-2">
              <span>0</span>
              <span className="text-4xl font-bold text-red-600">{formData.nps_score}</span>
              <span>10</span>
            </div>
          </div>

          {/* Comentarios */}
          <div className="bg-white rounded-2xl shadow-lg p-6">
            <label className="block text-lg font-bold text-gray-900 mb-3">
              💬 {t.comments}
            </label>
            <textarea
              value={formData.customer_comments}
              onChange={(e) => setFormData({...formData, customer_comments: e.target.value})}
              rows={4}
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl text-gray-900 focus:ring-2 focus:ring-red-500"
              placeholder={lang === 'es' ? 'Cuéntanos más...' : 'Tell us more...'}
            />
          </div>

          {/* Nombre */}
          <div className="bg-white rounded-2xl shadow-lg p-6">
            <label className="block text-lg font-bold text-gray-900 mb-3">
              🎁 {t.name}
            </label>
            <input
              type="text"
              value={formData.customer_name}
              onChange={(e) => setFormData({...formData, customer_name: e.target.value})}
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl text-gray-900 focus:ring-2 focus:ring-red-500"
              placeholder={lang === 'es' ? 'Tu nombre' : 'Your name'}
            />
          </div>

          {/* Botón enviar */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white font-bold text-2xl py-6 rounded-2xl shadow-2xl transition-all transform hover:scale-105 disabled:opacity-50"
          >
            {loading ? '⏳ Enviando...' : `🚀 ${t.submit}`}
          </button>
        </form>
      </div>
    </div>
  )
}
