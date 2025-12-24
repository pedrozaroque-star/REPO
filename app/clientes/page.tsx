'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'

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
    q5_nps: 0,
    comentarios: '',
    clienteNick: '',
    photos: [] as File[]
  })

  const [photoPreviews, setPhotoPreviews] = useState<string[]>([])

  // Cargar tiendas inmediatamente
  useEffect(() => {
    fetchStores()
  }, [])

  // Cerrar splash después de 3.5 segundos
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSplash(false)
    }, 3500)
    return () => clearTimeout(timer)
  }, [])

  // GPS automático DESPUÉS del splash
  // GPS automático DESPUÉS del splash
  useEffect(() => {
    console.log('🔍 GPS useEffect:', { 
      showSplash, 
      storesLength: stores.length, 
      gpsExecuted, 
      storeParam,
      shouldRun: !showSplash && stores.length > 0 && !gpsExecuted && !storeParam
    })
    
    if (!showSplash && stores.length > 0 && !gpsExecuted && !storeParam) {
      console.log('🚀 Ejecutando GPS automático...')
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
      
      // Convertir latitude/longitude a números
      const storesWithNumbers = (Array.isArray(data) ? data : []).map(store => ({
        ...store,
        latitude: store.latitude ? parseFloat(store.latitude) : null,
        longitude: store.longitude ? parseFloat(store.longitude) : null
      }))
      
      console.log('✅ Tiendas cargadas:', storesWithNumbers.length)
      console.log('📍 Primera tienda:', storesWithNumbers[0])
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
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
    return R * c
  }

  const detectLocation = () => {
    console.log('📍 detectLocation() llamada')
    console.log('📍 Stores disponibles:', stores.length)
    
    if (!navigator.geolocation) {
      console.log('⚠️ Geolocalización no disponible')
      alert('Tu navegador no soporta geolocalización')
      return
    }

    console.log('📍 Solicitando permisos GPS...')
    setDetectingLocation(true)

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const userLat = position.coords.latitude
        const userLon = position.coords.longitude
        console.log('📍 Tu ubicación:', userLat, userLon)
        console.log('📍 Precisión:', position.coords.accuracy, 'metros')

        let closestStore: Store | null = null
        let minDistance = Infinity

        stores.forEach(store => {
          if (store.latitude && store.longitude) {
            const distance = calculateDistance(userLat, userLon, store.latitude, store.longitude)
            const miles = distance * 0.621371
            console.log(`  📍 ${store.name}: ${distance.toFixed(2)} km (${miles.toFixed(2)} mi)`)
            if (distance < minDistance) {
              minDistance = distance
              closestStore = store
            }
          } else {
            console.log(`  ⚠️ ${store.name}: Sin coordenadas GPS`)
          }
        })

        const MAX_DISTANCE_KM = 4.02 // 2.5 millas
        const minMiles = minDistance * 0.621371
        
        if (closestStore && minDistance <= MAX_DISTANCE_KM) {
          console.log(`✅ SELECCIONANDO: ${closestStore.name} (${minDistance.toFixed(2)} km / ${minMiles.toFixed(2)} mi)`)
          setSelectedStore(closestStore.id)
          console.log('✅ selectedStore actualizado a:', closestStore.id)
        } else if (closestStore) {
          console.log(`❌ Tienda más cercana ${closestStore.name} está FUERA DE RANGO: ${minDistance.toFixed(2)} km (${minMiles.toFixed(2)} mi) > 2.5 mi`)
          console.log('💡 El combo quedará vacío para selección manual')
        } else {
          console.log('❌ No se encontraron tiendas con coordenadas GPS')
        }

        setDetectingLocation(false)
      },
      (error) => {
        console.error('❌ Error GPS:', error)
        console.log('Código de error:', error.code)
        console.log('Mensaje:', error.message)
        
        let errorMsg = ''
        switch(error.code) {
          case 1: // PERMISSION_DENIED
            errorMsg = 'Permiso denegado. Por favor activa la ubicación en tu navegador.'
            break
          case 2: // POSITION_UNAVAILABLE
            errorMsg = 'Ubicación no disponible.'
            break
          case 3: // TIMEOUT
            errorMsg = 'Tiempo agotado esperando ubicación.'
            break
        }
        
        alert(errorMsg)
        setDetectingLocation(false)
      },
      { 
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
      }
    )
  }

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return
    const files = Array.from(e.target.files).slice(0, 10)
    setFormData({...formData, photos: files})  // ← AGREGAR ESTO
    
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
    if (formData.q5_nps === 0) {
      alert(texts[lang].errNPS)
      return
    }

    setLoading(true)

    try {
      // 1. Subir fotos primero
      let photoUrls: string[] = []
      if (formData.photos.length > 0) {
        console.log('📸 Subiendo', formData.photos.length, 'fotos...')
        const { uploadPhotos } = await import('@/lib/uploadPhotos')
        photoUrls = await uploadPhotos(formData.photos, 'feedback-photos', selectedStore)
        console.log('✅ Fotos subidas:', photoUrls)
      }

      // 2. Guardar feedback con URLs de fotos
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
        console.log('✅ Feedback guardado')
        setShowThanks(true)
      } else {
        const errorText = await res.text()
        console.error('❌ Error:', errorText)
        alert(texts[lang].submitError)
      }
    } catch (err) {
      console.error('❌ Error de red:', err)
      alert(texts[lang].submitError)
    }

    setLoading(false)
  }

  const texts = {
    es: {
      title: 'Tu voz mejora nuestra atención',
      subtitle: 'Gracias por visitarnos. Tu experiencia es lo más importante: con esta encuesta breve (menos de 1 minuto) nos ayudas a mejorar rapidez, amabilidad y precisión en el servicio. Tus comentarios se leen y generan acciones. ¡Gracias por tu tiempo!',
      store: 'Sucursal',
      storePlaceholder: '(Selecciona)',
      detectBtn: 'Detectar mi ubicación',
      detecting: 'Detectando...',
      name: 'Tu nombre (opcional)',
      namePlaceholder: 'Ej. Juan / Ana',
      survey: 'Cuéntanos tu experiencia',
      q1: 'Amabilidad y servicio en caja.',
      q2: 'Amabilidad y servicio cuando recibiste tu orden.',
      q3: 'Alimentos de calidad y frescos.',
      q4: 'Limpieza e higiene del lugar.',
      q5: '¿Qué tan probable es que nos recomiendes a familiares o amigos?',
      hint1: '1 = Muy mala · 5 = Excelente',
      hint5: 'Escala NPS 0–10 (0 = nada probable, 10 = muy probable)',
      comments: 'Comentarios u observaciones (opcional)',
      commentsPlaceholder: '¿Algo que debamos mejorar o facilitar?',
      photos: 'Puedes agregar fotos (opcional)',
      send: 'Enviar',
      sending: 'Enviando...',
      thanks: '¡GRACIAS!',
      thanksMsg: 'Tu opinión nos ayuda a mejorar cada día',
      errSucursal: 'Por favor selecciona una sucursal',
      errPreguntas: 'Por favor responde todas las preguntas (estrellas)',
      errNPS: 'Por favor califica del 0 al 10',
      submitError: 'Error al enviar. Intenta de nuevo.'
    },
    en: {
      title: 'Your voice improves our service',
      subtitle: 'Thank you for visiting us. Your experience is the most important: with this brief survey (less than 1 minute) you help us improve speed, friendliness and service accuracy. Your comments are read and generate actions. Thank you for your time!',
      store: 'Location',
      storePlaceholder: '(Select)',
      detectBtn: 'Detect my location',
      detecting: 'Detecting...',
      name: 'Your name (optional)',
      namePlaceholder: 'E.g. John / Jane',
      survey: 'Tell us about your experience',
      q1: 'Friendliness and service at the register.',
      q2: 'Friendliness and service when you received your order.',
      q3: 'Quality and freshness of food.',
      q4: 'Cleanliness and hygiene of the place.',
      q5: 'How likely are you to recommend us to family or friends?',
      hint1: '1 = Very bad · 5 = Excellent',
      hint5: 'NPS Scale 0–10 (0 = not likely, 10 = very likely)',
      comments: 'Comments or observations (optional)',
      commentsPlaceholder: 'Anything we should improve?',
      photos: 'You can add photos (optional)',
      send: 'Submit',
      sending: 'Sending...',
      thanks: 'THANK YOU!',
      thanksMsg: 'Your feedback helps us improve every day',
      errSucursal: 'Please select a location',
      errPreguntas: 'Please answer all questions (stars)',
      errNPS: 'Please rate from 0 to 10',
      submitError: 'Error submitting. Please try again.'
    }
  }

  const t = texts[lang]

  const StarIcon = ({ filled }: { filled: boolean }) => (
    <svg viewBox="0 0 24 24" className={`w-10 h-10 transition-all cursor-pointer ${filled ? 'fill-yellow-400 scale-110' : 'fill-gray-300 hover:fill-yellow-200'}`}>
      <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
    </svg>
  )

  // Splash inicial con LOGO
  if (showSplash) {
    return (
      <div 
        className="fixed inset-0 z-50 grid place-items-center"
        style={{
          background: 'linear-gradient(180deg, #ffffff, #f7f7fb)'
        }}
      >
        <style dangerouslySetInnerHTML={{__html: `
          @keyframes fall {
            from { top: -360px; }
            to { top: 40px; }
          }
          @keyframes spin {
            from { transform: translateX(-50%) rotateY(0deg); }
            to { transform: translateX(-50%) rotateY(1440deg); }
          }
          @keyframes shadowIn {
            to { opacity: 1; }
          }
        `}} />
        
        <div className="relative w-[300px] h-[360px]">
          <div 
            className="absolute left-1/2 w-[240px] h-[240px] rounded-full bg-white grid place-items-center overflow-hidden"
            style={{
              transform: 'translateX(-50%)',
              boxShadow: '0 20px 46px rgba(0,0,0,0.20), inset 0 0 0 8px #f2f2f2',
              animation: 'fall 3s cubic-bezier(0.2,0.8,0.2,1) forwards, spin 2.5s ease-in-out forwards',
              top: '-360px'
            }}
          >
            <img 
              src="/logo.png"
              alt="Tacos Gavilan"
              className="w-[86%] h-[86%] object-contain rounded-full"
              style={{
                background: 'radial-gradient(closest-side, #ffffff 0%, #fbeab9 65%, #f3d26a 100%)'
              }}
              onError={(e) => {
                const target = e.currentTarget
                target.style.display = 'none'
                const parent = target.parentElement
                if (parent) {
                  const div = document.createElement('div')
                  div.className = 'text-9xl'
                  div.textContent = '🌮'
                  parent.appendChild(div)
                }
              }}
            />
          </div>
          
          <div 
            className="absolute bottom-[10px] left-1/2 w-[240px] h-[38px] rounded-full opacity-0"
            style={{
              transform: 'translateX(-50%)',
              background: 'radial-gradient(closest-side, rgba(0,0,0,0.22), rgba(0,0,0,0))',
              filter: 'blur(10px)',
              animation: 'shadowIn 0.9s 0.4s forwards'
            }}
          />
        </div>
      </div>
    )
  }

  // Splash final con LOGO
  if (showThanks) {
    return (
      <div 
        className="fixed inset-0 z-50 grid place-items-center"
        style={{
          background: 'linear-gradient(180deg, #ffffff, #f7f7fb)'
        }}
      >
        <style dangerouslySetInnerHTML={{__html: `
          @keyframes fallThanks {
            from { top: -360px; }
            to { top: 40px; }
          }
          @keyframes spinThanks {
            from { transform: translateX(-50%) rotateY(0deg); }
            to { transform: translateX(-50%) rotateY(360deg); }
          }
          @keyframes shadowInThanks {
            to { opacity: 1; }
          }
        `}} />
        
        <div className="relative w-[300px] h-[420px]">
          <div 
            className="absolute left-1/2 w-[240px] h-[240px] rounded-full bg-white grid place-items-center overflow-hidden"
            style={{
              transform: 'translateX(-50%)',
              boxShadow: '0 20px 46px rgba(0,0,0,0.20), inset 0 0 0 8px #f2f2f2',
              animation: 'fallThanks 1.2s cubic-bezier(0.2,0.8,0.2,1) forwards, spinThanks 1.2s ease-in-out forwards',
              top: '-360px'
            }}
          >
            <img 
              src="/logo.png"
              alt="Tacos Gavilan"
              className="w-[86%] h-[86%] object-contain rounded-full"
              style={{
                background: 'radial-gradient(closest-side, #ffffff 0%, #fbeab9 65%, #f3d26a 100%)'
              }}
              onError={(e) => {
                const target = e.currentTarget
                target.style.display = 'none'
                const parent = target.parentElement
                if (parent) {
                  const div = document.createElement('div')
                  div.className = 'text-9xl'
                  div.textContent = '🌮'
                  parent.appendChild(div)
                }
              }}
            />
          </div>
          
          <div 
            className="absolute bottom-[130px] left-1/2 w-[240px] h-[38px] rounded-full opacity-0"
            style={{
              transform: 'translateX(-50%)',
              background: 'radial-gradient(closest-side, rgba(0,0,0,0.22), rgba(0,0,0,0))',
              filter: 'blur(10px)',
              animation: 'shadowInThanks 0.9s 0.4s forwards'
            }}
          />
          
          <div className="absolute bottom-0 left-0 right-0 text-center px-4">
            <h1 className="text-5xl font-bold text-red-600 mb-3">{t.thanks}</h1>
            <p className="text-xl text-gray-700">{t.thanksMsg}</p>
          </div>
        </div>
      </div>
    )
  }

  // Formulario
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm sticky top-0 z-40 border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <img 
              src="/logo.png" 
              alt="Tacos Gavilan" 
              className="w-10 h-10 object-contain rounded-full"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
                const parent = e.currentTarget.parentElement
                if (parent) {
                  const div = document.createElement('div')
                  div.className = 'text-4xl'
                  div.textContent = '🌮'
                  parent.appendChild(div)
                }
              }}
            />
            <strong className="text-xl text-gray-900">Tacos Gavilan</strong>
            <span className={`px-2 py-1 rounded-full text-xs font-bold ${lang === 'es' ? 'bg-red-600 text-white' : 'bg-gray-300 text-gray-700'}`}>
              {lang.toUpperCase()}
            </span>
          </div>
          <button
            onClick={() => setLang(lang === 'es' ? 'en' : 'es')}
            className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-900 text-sm font-semibold rounded-lg transition-colors"
          >
            {lang === 'es' ? 'EN' : 'ES'}
          </button>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6 border border-gray-200">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">{t.title}</h2>
          <p className="text-gray-600">{t.subtitle}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label htmlFor="sucursal" className="block text-sm font-bold text-gray-900 mb-2">
                  📍 {t.store}
                </label>
                <select
                  id="sucursal"
                  required
                  value={selectedStore}
                  onChange={(e) => setSelectedStore(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-red-500 focus:border-red-500"
                >
                  <option value="">{t.storePlaceholder}</option>
                  {stores.map(store => (
                    <option key={store.id} value={store.id}>{store.name}</option>
                  ))}
                </select>
                
                <button
                  type="button"
                  onClick={detectLocation}
                  disabled={detectingLocation}
                  className="w-full mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
                >
                  {detectingLocation ? (
                    <>
                      <span className="animate-spin">🔄</span>
                      <span>{t.detecting}</span>
                    </>
                  ) : (
                    <>
                      <span>📍</span>
                      <span>{t.detectBtn}</span>
                    </>
                  )}
                </button>
                
                {selectedStore && stores.find(s => s.id === selectedStore) && (
                  <p className="text-xs text-green-600 mt-2 font-semibold">
                    ✓ {stores.find(s => s.id === selectedStore)?.name}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="clienteNick" className="block text-sm font-bold text-gray-900 mb-2">
                  😊 {t.name}
                </label>
                <input
                  id="clienteNick"
                  type="text"
                  value={formData.clienteNick}
                  onChange={(e) => setFormData({...formData, clienteNick: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  placeholder={t.namePlaceholder}
                />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
            <h3 className="text-xl font-bold text-gray-900 mb-5">{t.survey}</h3>

            <div className="space-y-6">
              {[
                { key: 'q1_caja', label: t.q1 },
                { key: 'q2_entrega', label: t.q2 },
                { key: 'q3_calidad', label: t.q3 },
                { key: 'q4_limpieza', label: t.q4 }
              ].map(({ key, label }) => (
                <div key={key}>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">{label}</label>
                  <div className="flex justify-center space-x-1">
                    {[1, 2, 3, 4, 5].map(val => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setFormData({...formData, [key]: val})}
                        className="transition-transform hover:scale-110"
                      >
                        <StarIcon filled={formData[key as keyof typeof formData] >= val} />
                      </button>
                    ))}
                  </div>
                  <p className="text-center text-xs text-gray-500 mt-1">{t.hint1}</p>
                </div>
              ))}

              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">{t.q5}</label>
                <div className="flex flex-wrap justify-center gap-2">
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(val => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setFormData({...formData, q5_nps: val})}
                      className={`w-10 h-10 rounded-lg font-bold text-sm transition-all ${
                        formData.q5_nps === val
                          ? 'bg-red-600 text-white scale-110 shadow-md'
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                    >
                      {val}
                    </button>
                  ))}
                </div>
                <p className="text-center text-xs text-gray-500 mt-1">{t.hint5}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200 space-y-4">
            <div>
              <label htmlFor="comentarios" className="block text-sm font-bold text-gray-900 mb-2">
                {t.comments}
              </label>
              <textarea
                id="comentarios"
                value={formData.comentarios}
                onChange={(e) => setFormData({...formData, comentarios: e.target.value})}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-red-500 focus:border-red-500 resize-none"
                placeholder={t.commentsPlaceholder}
              />
            </div>

            <div>
              <label htmlFor="fotos" className="block text-sm font-bold text-gray-900 mb-2">
                {t.photos}
              </label>
              <input
                id="fotos"
                type="file"
                accept="image/*"
                multiple
                onChange={handlePhotoChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500"
              />
              {photoPreviews.length > 0 && (
                <div className="grid grid-cols-5 gap-2 mt-3">
                  {photoPreviews.map((preview, i) => (
                    <img
                      key={i}
                      src={preview}
                      alt={`Preview ${i + 1}`}
                      className="w-full h-16 object-cover rounded-lg"
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-red-600 hover:bg-red-700 text-white font-bold text-lg py-4 rounded-xl shadow-lg transition-all disabled:opacity-50"
          >
            {loading ? `⏳ ${t.sending}` : t.send}
          </button>
        </form>
      </div>
    </div>
  )
}