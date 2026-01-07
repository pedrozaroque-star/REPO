'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'

import { formatStoreName } from '@/lib/supabase'
type Language = 'es' | 'en'

interface Store {
  id: string
  name: string
  latitude: number | null
  longitude: number | null
}

export default function ClientesFeedbackPage() {
  const searchParams = useSearchParams()
  const storeParam = searchParams.get('store')

  const [showSplash, setShowSplash] = useState(true)
  const [showThanks, setShowThanks] = useState(false)
  const [lang, setLang] = useState<Language>('es')
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedStore, setSelectedStore] = useState(storeParam || '')
  const [detectingLocation, setDetectingLocation] = useState(false)
  const [gpsExecuted, setGpsExecuted] = useState(false)

  const [formData, setFormData] = useState({
    q1_caja: 0,
    q2_entrega: 0,
    q3_calidad: 0,
    q4_limpieza: 0,
    q5_nps: -1,
    comentarios: '',
    clienteNick: '',
    photos: [] as File[]
  })

  const [photoPreviews, setPhotoPreviews] = useState<string[]>([])

  useEffect(() => {
    fetchStores()
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSplash(false)
    }, 3500)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!showSplash && stores.length > 0 && !gpsExecuted && !storeParam) {
      setGpsExecuted(true)
      setTimeout(() => {
        detectLocation()
      }, 500)
    }
  }, [showSplash, stores.length, gpsExecuted, storeParam])

  const fetchStores = async () => {
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

      const res = await fetch(`${url}/rest/v1/stores?select=id,name,latitude,longitude&order=name.asc`, {
        headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` }
      })
      const data = await res.json()

      const storesWithNumbers = (Array.isArray(data) ? data : []).map(store => ({
        ...store,
        latitude: store.latitude ? parseFloat(store.latitude) : null,
        longitude: store.longitude ? parseFloat(store.longitude) : null
      }))

      setStores(storesWithNumbers)
    } catch (err) {
      console.error('❌ Error cargando tiendas:', err)
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
      (position) => {
        const userLat = position.coords.latitude
        const userLon = position.coords.longitude

        let closestStore: Store | null = null
        let minDistance = Infinity

        stores.forEach(store => {
          if (store.latitude && store.longitude) {
            const distance = calculateDistance(userLat, userLon, store.latitude, store.longitude)
            if (distance < minDistance) {
              minDistance = distance
              closestStore = store
            }
          }
        })

        const MAX_DISTANCE_KM = 4.02 // 2.5 miles

        if (closestStore && minDistance <= MAX_DISTANCE_KM) {
          setSelectedStore((closestStore as Store).id)
        }

        setDetectingLocation(false)
      },
      (error) => {
        let errorMsg = ''
        switch (error.code) {
          case 1: errorMsg = 'Permiso denegado.'; break
          case 2: errorMsg = 'Ubicación no disponible.'; break
          case 3: errorMsg = 'Tiempo agotado.'; break
        }
        if (errorMsg) alert(errorMsg)
        setDetectingLocation(false)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  }

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return
    const files = Array.from(e.target.files).slice(0, 10)
    setFormData({ ...formData, photos: files })

    const previews: string[] = []
    let loaded = 0

    files.forEach(file => {
      const reader = new FileReader()
      reader.onload = (e) => {
        if (e.target?.result) {
          previews.push(e.target.result as string)
          loaded++
          if (loaded === files.length) {
            setPhotoPreviews([...previews])
          }
        }
      }
      reader.readAsDataURL(file)
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!selectedStore) {
      alert(texts[lang].errSucursal)
      return
    }
    if (formData.q1_caja === 0 || formData.q2_entrega === 0 || formData.q3_calidad === 0 || formData.q4_limpieza === 0) {
      alert(texts[lang].errPreguntas)
      return
    }
    if (formData.q5_nps === -1) {
      alert(texts[lang].errNPS)
      return
    }

    setLoading(true)

    try {
      let photoUrls: string[] = []
      if (formData.photos.length > 0) {
        const { uploadPhotos } = await import('@/lib/uploadPhotos')
        photoUrls = await uploadPhotos(formData.photos, 'feedback-photos', selectedStore)
      }

      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

      let nps_category = 'passive'
      if (formData.q5_nps >= 9) nps_category = 'promoter'
      else if (formData.q5_nps <= 6) nps_category = 'detractor'

      const payload = {
        store_id: selectedStore,
        submission_date: new Date().toISOString(),
        customer_name: formData.clienteNick || null,
        service_rating: formData.q1_caja,
        speed_rating: formData.q2_entrega,
        food_quality_rating: formData.q3_calidad,
        cleanliness_rating: formData.q4_limpieza,
        nps_score: formData.q5_nps,
        nps_category,
        comments: formData.comentarios || null,
        photo_urls: photoUrls.length > 0 ? photoUrls : null
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
        alert(texts[lang].submitError)
      }
    } catch (err) {
      alert(texts[lang].submitError)
    }

    setLoading(false)
  }

  const texts = {
    es: {
      title: 'Tu experiencia nos importa',
      subtitle: 'Ayúdanos a mejorar con esta breve encuesta.',
      store: 'Sucursal',
      storePlaceholder: 'Selecciona tu ubicación...',
      detectBtn: 'Detectar GPS',
      detecting: 'Detectando...',
      name: 'Tu nombre (Opcional)',
      namePlaceholder: 'Ej. Alex',
      sectionExp: 'Califica tu visita',
      q1: 'Servicio en Caja',
      q2: 'Entrega de Orden',
      q3: 'Calidad de Alimentos',
      q4: 'Limpieza del Lugar',
      q5: '¿Nos recomendarías?',
      hint5: '0 = Jamás · 10 = Definitivamente',
      comments: 'Comentarios Adicionales',
      commentsPlaceholder: '¿Cómo podemos mejorar?',
      photos: 'Agregar Fotos',
      send: 'Enviar Opinión',
      sending: 'Enviando...',
      thanks: '¡GRACIAS!',
      thanksMsg: '¡Tu opinión vale oro!',
      errSucursal: 'Selecciona una sucursal',
      errPreguntas: 'Por favor califica todos los aspectos.',
      errNPS: 'Por favor selecciona una calificación del 0 al 10.',
      submitError: 'Error al enviar chavo.'
    },
    en: {
      title: 'Your Experience Matters',
      subtitle: 'Help us improve with this short survey.',
      store: 'Location',
      storePlaceholder: 'Select location...',
      detectBtn: 'Detect GPS',
      detecting: 'Detecting...',
      name: 'Your Name (Optional)',
      namePlaceholder: 'E.g. Alex',
      sectionExp: 'Rate your visit',
      q1: 'Service at Register',
      q2: 'Order Delivery',
      q3: 'Food Quality',
      q4: 'Cleanliness',
      q5: 'Would you recommend us?',
      hint5: '0 = Never · 10 = Definitely',
      comments: 'Additional Comments',
      commentsPlaceholder: 'How can we improve?',
      photos: 'Add Photos',
      send: 'Submit Feedback',
      sending: 'Sending...',
      thanks: 'THANK YOU!',
      thanksMsg: 'Your feedback is golden!',
      errSucursal: 'Select a location',
      errPreguntas: 'Please rate all aspects.',
      errNPS: 'Please recommend from 0 to 10.',
      submitError: 'Error submitting.'
    }
  }

  const t = texts[lang]

  const StarIcon = ({ filled, onClick }: { filled: boolean, onClick: () => void }) => (
    <button
      type="button"
      onClick={onClick}
      className={`transition-all duration-300 transform hover:scale-125 focus:outline-none ${filled ? 'text-[#fdc82f] drop-shadow-[0_0_8px_rgba(253,200,47,0.5)]' : 'text-white/20 hover:text-white/40'}`}
    >
      <svg viewBox="0 0 24 24" className="w-9 h-9 md:w-10 md:h-10 fill-current">
        <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
      </svg>
    </button>
  )

  if (showSplash) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#50050a] overflow-hidden">
        <div className="absolute inset-0 opacity-10 bg-[url('https://grainy-gradients.vercel.app/noise.svg')]"></div>
        <style dangerouslySetInnerHTML={{
          __html: `
          @keyframes dropIn {
            0% { transform: translateY(-800px) rotateY(0deg); opacity: 0; }
            60% { transform: translateY(20px) rotateY(1440deg); opacity: 1; }
            80% { transform: translateY(-10px) rotateY(1440deg); }
            100% { transform: translateY(0) rotateY(1440deg); }
          }
          @keyframes ripple {
            0% { transform: scale(0); opacity: 0.8; }
            100% { transform: scale(4); opacity: 0; }
          }
        `}} />
        <div className="relative z-10 flex flex-col items-center">
          <div
            className="w-48 h-48 rounded-full bg-gradient-to-br from-[#fdc82f] to-[#e69b00] p-1.5 shadow-[0_0_60px_rgba(253,200,47,0.4)]"
            style={{ animation: 'dropIn 1.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards' }}
          >
            <div className="w-full h-full rounded-full bg-white flex items-center justify-center overflow-hidden border-4 border-[#fffbeb]">
              <img src="/logo.png" alt="TAG" className="w-[85%] h-[85%] object-contain" />
            </div>
          </div>
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 rounded-full border border-white/50"
            style={{ animation: 'ripple 2s infinite linear', animationDelay: '1.2s' }}
          ></div>
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
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#50050a] via-[#3a0305] to-[#1a0103] text-white font-sans selection:bg-[#fdc82f] selection:text-[#50050a]">
      <nav className="sticky top-0 z-40 backdrop-blur-md bg-[#50050a]/80 border-b border-white/5">
        <div className="max-w-md mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-white p-1 shadow-lg">
              <img src="/logo.png" alt="Logo" className="w-full h-full object-contain" />
            </div>
            <span className="font-bold tracking-wide text-sm">TACOS GAVILAN</span>
          </div>
          <button
            onClick={() => setLang(lang === 'es' ? 'en' : 'es')}
            className="px-3 py-1 rounded-full bg-white/10 border border-white/10 text-xs font-bold hover:bg-white/20 transition-all"
          >
            {lang === 'es' ? 'EN' : 'ES'}
          </button>
        </div>
      </nav>

      <main className="max-w-md mx-auto px-4 py-8 pb-24 space-y-8">
        <div className="text-center space-y-2 animate-in slide-in-from-bottom-4 duration-700">
          <h1 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white to-white/70">
            {t.title}
          </h1>
          <p className="text-white/60 text-sm font-light">
            {t.subtitle}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8 animate-in slide-in-from-bottom-8 duration-1000 delay-150">

          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-6  shadow-2xl">
            <label className="block text-xs font-bold uppercase tracking-widest text-[#fdc82f] mb-4">
              {t.store}
            </label>
            <div className="space-y-4">
              <div className="relative">
                <select
                  value={selectedStore}
                  onChange={(e) => setSelectedStore(e.target.value)}
                  className="w-full appearance-none bg-black/20 border border-white/10 rounded-xl px-4 py-4 text-white placeholder-white/30 focus:outline-none focus:border-[#fdc82f] focus:ring-1 focus:ring-[#fdc82f] transition-all"
                  required
                >
                  <option value="" className="bg-[#3a0305] text-white/50">{t.storePlaceholder}</option>
                  {stores.map(s => (
                    <option key={s.id} value={s.id} className="bg-[#3a0305] text-white">{formatStoreName(s.name)}</option>
                  ))}
                </select>
                <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-white/50">▼</div>
              </div>
              <button
                type="button"
                onClick={detectLocation}
                disabled={detectingLocation}
                className="w-full py-3 rounded-xl border border-[#fdc82f]/30 bg-[#fdc82f]/10 text-[#fdc82f] font-bold text-sm hover:bg-[#fdc82f]/20 active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                {detectingLocation ? <span className="animate-spin">◌</span> : <span>📍</span>}
                {detectingLocation ? t.detecting : t.detectBtn}
              </button>
            </div>
          </div>

          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-xl">
            <label className="block text-xs font-bold uppercase tracking-widest text-[#fdc82f] mb-4">
              {t.name}
            </label>
            <input
              type="text"
              value={formData.clienteNick}
              onChange={(e) => setFormData({ ...formData, clienteNick: e.target.value })}
              placeholder={t.namePlaceholder}
              className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-4 text-white placeholder-white/30 focus:outline-none focus:border-[#fdc82f] focus:ring-1 focus:ring-[#fdc82f] transition-all"
            />
          </div>

          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-xl space-y-8">
            <div className="flex items-center gap-3 border-b border-white/10 pb-4">
              <span className="text-2xl">⭐</span>
              <span className="font-bold text-lg">{t.sectionExp}</span>
            </div>
            {[
              { key: 'q1_caja', label: t.q1 },
              { key: 'q2_entrega', label: t.q2 },
              { key: 'q3_calidad', label: t.q3 },
              { key: 'q4_limpieza', label: t.q4 }
            ].map((item) => (
              <div key={item.key} className="space-y-3">
                <p className="text-sm font-medium text-white/90">{item.label}</p>
                <div className="flex justify-between px-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <StarIcon
                      key={star}
                      filled={formData[item.key as keyof typeof formData] as number >= star}
                      onClick={() => setFormData({ ...formData, [item.key]: star })}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="bg-gradient-to-br from-[#fdc82f]/10 to-transparent backdrop-blur-xl border border-[#fdc82f]/20 rounded-2xl p-6 shadow-xl">
            <label className="block text-center text-sm font-bold text-[#fdc82f] mb-6 uppercase tracking-wider">
              {t.q5}
            </label>
            <div className="grid grid-cols-6 gap-2">
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => setFormData({ ...formData, q5_nps: num })}
                  className={`
                     aspect-square rounded-lg font-bold text-sm transition-all duration-200
                     ${formData.q5_nps === num
                      ? 'bg-[#fdc82f] text-black scale-110 shadow-[0_0_15px_rgba(253,200,47,0.5)] z-10'
                      : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                    }
                     ${num === 10 ? 'col-span-2 aspect-auto' : ''}
                   `}
                >
                  {num}
                </button>
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-white/40 mt-3 font-medium uppercase tracking-widest">
              <span>0 = {t.hint5.split('·')[0]}</span>
              <span>10 = {t.hint5.split('·')[1]}</span>
            </div>
          </div>

          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-xl space-y-6">
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-[#fdc82f] mb-4">
                {t.comments}
              </label>
              <textarea
                rows={3}
                value={formData.comentarios}
                onChange={(e) => setFormData({ ...formData, comentarios: e.target.value })}
                placeholder={t.commentsPlaceholder}
                className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-4 text-white placeholder-white/30 focus:outline-none focus:border-[#fdc82f] focus:ring-1 focus:ring-[#fdc82f] transition-all resize-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-[#fdc82f] mb-4 flex justify-between">
                <span>{t.photos}</span>
                <span className="text-white/40 text-[10px]">Max 10</span>
              </label>
              <div className="grid grid-cols-4 gap-2 mb-3">
                {photoPreviews.map((src, i) => (
                  <div key={i} className="aspect-square rounded-lg overflow-hidden border border-white/10">
                    <img src={src} className="w-full h-full object-cover" />
                  </div>
                ))}
                <label className="aspect-square rounded-lg border-2 border-dashed border-white/20 flex flex-col items-center justify-center cursor-pointer hover:bg-white/5 hover:border-[#fdc82f]/50 transition-all group">
                  <span className="text-2xl mb-1 group-hover:scale-110 transition-transform">📷</span>
                  <span className="text-[9px] text-white/40">Agregar</span>
                  <input type="file" multiple accept="image/*" className="hidden" onChange={handlePhotoChange} />
                </label>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-5 rounded-2xl bg-gradient-to-r from-[#e31837] to-[#b91c1c] text-white font-black text-lg tracking-widest uppercase shadow-[0_10px_30px_rgba(227,24,55,0.3)] hover:shadow-[0_10px_40px_rgba(227,24,55,0.5)] active:scale-95 transition-all disabled:opacity-50 disabled:grayscale"
          >
            {loading ? t.sending : t.send}
          </button>

          <div className="pt-8 text-center opacity-30">
            <img src="/logo.png" className="h-8 mx-auto grayscale mb-4" />
            <p className="text-[10px] font-mono">ID: {selectedStore || '---'}</p>
          </div>
        </form>
      </main>
    </div>
  )
}