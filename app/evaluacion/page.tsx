'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'

type Language = 'es' | 'en'

interface Store {
  id: string
  name: string
}

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
  const [lang, setLang] = useState<Language>('es')
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedStore, setSelectedStore] = useState(storeParam || '')
  const [evaluatedRole, setEvaluatedRole] = useState('')
  
  const [formData, setFormData] = useState({
    evaluator_name: '',
    evaluated_name: '',
    evaluated_role: '',
    
    // Q1: Trabajo en equipo (5)
    q1_1: 0, q1_2: 0, q1_3: 0, q1_4: 0, q1_5: 0,
    // Q2: Liderazgo (5) - solo LEAD
    q2_1: 0, q2_2: 0, q2_3: 0, q2_4: 0, q2_5: 0,
    // Q3: Desempeño (5)
    q3_1: 0, q3_2: 0, q3_3: 0, q3_4: 0, q3_5: 0,
    // Q4: Actitud (5)
    q4_1: 0, q4_2: 0, q4_3: 0, q4_4: 0, q4_5: 0,
    // Q5: Desarrollo (5)
    q5_1: 0, q5_2: 0, q5_3: 0, q5_4: 0, q5_5: 0,
    
    fortalezas: '',
    areas_mejora: '',
    recomendaria: 'si',
    desempeno_general: 0,
    comentarios: '',
    photos: [] as File[]
  })

  const [photoPreviews, setPhotoPreviews] = useState<string[]>([])

  useEffect(() => {
    fetchStores()
    const timer = setTimeout(() => setShowSplash(false), 3000)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    setEvaluatedRole(formData.evaluated_role)
  }, [formData.evaluated_role])

  const fetchStores = async () => {
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

      const res = await fetch(`${url}/rest/v1/stores?select=id,name&order=name.asc`, {
        headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` }
      })
      const data = await res.json()
      setStores(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Error:', err)
    }
  }

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return
    const files = Array.from(e.target.files).slice(0, 10)
    
    // Guardar archivos en el state
    setFormData({...formData, photos: files})
    
    // Crear previews
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
      alert(texts[lang].errStore)
      return
    }
    if (!formData.evaluated_name.trim()) {
      alert(texts[lang].errName)
      return
    }
    if (!formData.evaluated_role) {
      alert(texts[lang].errRole)
      return
    }
    if (!formData.desempeno_general || formData.desempeno_general < 1) {
      alert(texts[lang].errGeneral)
      return
    }

    // Contar preguntas respondidas (solo las aplicables al rol)
    const isLead = isLeadRole(formData.evaluated_role)
    let answered = 0
    let required = 0

    // Q1: 4 para todos + 1 LEAD
    ;[formData.q1_1, formData.q1_2, formData.q1_3, formData.q1_4].forEach(v => { required++; if (v > 0) answered++ })
    if (isLead) { required++; if (formData.q1_5 > 0) answered++ }

    // Q2: 5 solo LEAD
    if (isLead) {
      ;[formData.q2_1, formData.q2_2, formData.q2_3, formData.q2_4, formData.q2_5].forEach(v => { required++; if (v > 0) answered++ })
    }

    // Q3: 4 para todos + 1 LEAD
    ;[formData.q3_1, formData.q3_2, formData.q3_3, formData.q3_4].forEach(v => { required++; if (v > 0) answered++ })
    if (isLead) { required++; if (formData.q3_5 > 0) answered++ }

    // Q4: 1 y 4 para todos, 2,3,5 LEAD
    if (formData.q4_1 > 0) answered++; required++
    if (isLead) { required++; if (formData.q4_2 > 0) answered++ }
    if (isLead) { required++; if (formData.q4_3 > 0) answered++ }
    if (formData.q4_4 > 0) answered++; required++
    if (isLead) { required++; if (formData.q4_5 > 0) answered++ }

    // Q5: 5 para todos
    ;[formData.q5_1, formData.q5_2, formData.q5_3, formData.q5_4, formData.q5_5].forEach(v => { required++; if (v > 0) answered++ })

    if (answered < required * 0.8) { // Al menos 80% respondido
      alert(texts[lang].errMinQuestions)
      return
    }

    setLoading(true)

    try {
      // 1. Subir fotos primero si las hay
      let photoUrls: string[] = []
      if (formData.photos && formData.photos.length > 0) {
        console.log('📸 Subiendo', formData.photos.length, 'fotos...')
        const { uploadPhotos } = await import('@/lib/uploadPhotos')
        const prefix = `${selectedStore}_${formData.evaluated_name.replace(/\s+/g, '_')}`
        photoUrls = await uploadPhotos(formData.photos, 'staff-photos', prefix)
        console.log('✅ Fotos subidas:', photoUrls)
      }

      // 2. Guardar evaluación con URLs de fotos
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

      const payload = {
        store_id: selectedStore,
        evaluation_date: new Date().toISOString(),
        evaluator_name: formData.evaluator_name || null,
        evaluated_name: formData.evaluated_name,
        evaluated_role: formData.evaluated_role,
        
        q1_1: formData.q1_1 || null, q1_2: formData.q1_2 || null, q1_3: formData.q1_3 || null,
        q1_4: formData.q1_4 || null, q1_5: formData.q1_5 || null,
        q2_1: formData.q2_1 || null, q2_2: formData.q2_2 || null, q2_3: formData.q2_3 || null,
        q2_4: formData.q2_4 || null, q2_5: formData.q2_5 || null,
        q3_1: formData.q3_1 || null, q3_2: formData.q3_2 || null, q3_3: formData.q3_3 || null,
        q3_4: formData.q3_4 || null, q3_5: formData.q3_5 || null,
        q4_1: formData.q4_1 || null, q4_2: formData.q4_2 || null, q4_3: formData.q4_3 || null,
        q4_4: formData.q4_4 || null, q4_5: formData.q4_5 || null,
        q5_1: formData.q5_1 || null, q5_2: formData.q5_2 || null, q5_3: formData.q5_3 || null,
        q5_4: formData.q5_4 || null, q5_5: formData.q5_5 || null,
        
        fortalezas: formData.fortalezas || null,
        areas_mejora: formData.areas_mejora || null,
        recomendaria: formData.recomendaria,
        desempeno_general: formData.desempeno_general,
        comentarios: formData.comentarios || null,
        language: lang,
        photo_urls: photoUrls.length > 0 ? photoUrls : null  // ← AGREGAR ESTA LÍNEA
      }

      const res = await fetch(`${url}/rest/v1/staff_evaluations`, {
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
        console.log('✅ Evaluación guardada')
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
      title: 'Te escuchamos',
      subtitle: 'En Tacos Gavilan nos preocupamos por el bienestar y desarrollo de nuestro equipo. Esta evaluación nos ayuda a reconocer el buen trabajo y a mejorar juntos con respeto. Tu nombre es opcional. Por favor indica el nombre y el rol de la persona evaluada. Comparte comentarios claros y, cuando sea posible, ejemplos; tu retroalimentación se usa con fines de mejora y capacitación.',
      store: 'Sucursal',
      storePlaceholder: 'Selecciona…',
      evaluator: 'Tu nombre (opcional)',
      evaluatorPlaceholder: 'Ej. Juan P.',
      evaluatedName: 'Nombre de la persona evaluada',
      evaluatedNamePlaceholder: 'Ej. María L.',
      evaluatedRole: 'Rol de la persona evaluada',
      evaluatedRolePlaceholder: 'Selecciona…',
      
      cat1: '🧩 1. Trabajo en equipo y comunicación',
      q1_1: '¿Se comunica de manera clara y respetuosa con todos los miembros del equipo?',
      q1_2: '¿Escucha y considera las opiniones de los demás antes de tomar decisiones?',
      q1_3: '¿Apoya a sus compañeros cuando el restaurante está ocupado?',
      q1_4: '¿Fomenta un ambiente positivo y de colaboración durante el turno?',
      q1_5: '¿Resuelve los conflictos de manera profesional y sin crear tensión?',
      
      cat2: '⚙️ 2. Liderazgo y manejo de personal',
      q2_1: '¿Motiva al equipo para alcanzar los objetivos del turno?',
      q2_2: '¿Da retroalimentación constructiva en lugar de solo señalar errores?',
      q2_3: '¿Es justo al asignar tareas y responsabilidades?',
      q2_4: '¿Interviene y apoya cuando un empleado tiene dificultades con un cliente o tarea?',
      q2_5: '¿Predica con el ejemplo en puntualidad, actitud y desempeño?',
      
      cat3: '🍽️ 3. Desempeño laboral y eficiencia',
      q3_1: '¿Cumple sus responsabilidades sin necesidad de supervisión constante?',
      q3_2: '¿Mantiene limpieza y organización en su área de trabajo?',
      q3_3: '¿Sigue correctamente los procedimientos (recetas, seguridad, higiene, etc.)?',
      q3_4: '¿Actúa con rapidez y precisión en alto volumen?',
      q3_5: '¿Demuestra iniciativa para resolver problemas o mejorar procesos?',
      
      cat4: '💬 4. Actitud y profesionalismo',
      q4_1: '¿Mantiene una actitud positiva incluso bajo presión?',
      q4_2: '¿Trata con respeto a todos los miembros del equipo, sin favoritismos?',
      q4_3: '¿Representa adecuadamente la imagen y valores de la compañía?',
      q4_4: '¿Recibe bien las críticas y se esfuerza por mejorar?',
      q4_5: '¿Contribuye a un ambiente laboral agradable y motivador?',
      
      cat5: '💡 5. Desarrollo y aprendizaje',
      q5_1: '¿Se interesa en aprender nuevas tareas o posiciones?',
      q5_2: '¿Busca oportunidades para crecer dentro de la empresa?',
      q5_3: '¿Ayuda a entrenar o guiar a nuevos empleados cuando es necesario?',
      q5_4: '¿Aplica lo aprendido en entrenamientos o retroalimentaciones previas?',
      q5_5: '¿Está abierto a cambios en procedimientos o políticas?',
      
      fortalezas: 'Fortalezas',
      fortalezasPlaceholder: '¿Qué hace muy bien?',
      areasMejora: 'Áreas de mejora',
      areasMejoraPlaceholder: '¿Qué podría mejorar?',
      recomendaria: '¿Recomendarías trabajar con esta persona de nuevo en el mismo equipo?',
      yes: 'Sí',
      no: 'No',
      general: 'Desempeño general (1–10)',
      generalPlaceholder: '1–10',
      comentarios: 'Comentarios adicionales',
      comentariosPlaceholder: 'Opcional',
      photos: 'Evidencias (fotos, opcional)',
      photosHint: 'Máximo 10 fotos',
      
      hint: '1 = Deficiente · 5 = Excelente',
      send: 'Enviar Evaluación',
      sending: 'Enviando...',
      thanks: '¡GRACIAS!',
      thanksMsg: 'Tu evaluación ha sido registrada',
      errStore: 'Por favor selecciona una sucursal',
      errName: 'Por favor ingresa el nombre de la persona evaluada',
      errRole: 'Por favor selecciona el rol de la persona evaluada',
      errGeneral: 'Por favor califica el desempeño general (1-10)',
      errMinQuestions: 'Por favor responde al menos el 80% de las preguntas aplicables',
      submitError: 'Error al enviar. Intenta de nuevo.',
      leadOnly: '(Solo para líderes)'
    },
    en: {
      title: 'We Listen',
      subtitle: 'At Tacos Gavilan we care about the well-being and development of our team. This evaluation helps us recognize good work and improve together with respect. Your name is optional. Please indicate the name and role of the person being evaluated. Share clear comments and, when possible, examples; your feedback is used for improvement and training purposes.',
      store: 'Location',
      storePlaceholder: 'Select…',
      evaluator: 'Your name (optional)',
      evaluatorPlaceholder: 'E.g. John P.',
      evaluatedName: 'Name of person being evaluated',
      evaluatedNamePlaceholder: 'E.g. Mary L.',
      evaluatedRole: 'Role of person being evaluated',
      evaluatedRolePlaceholder: 'Select…',
      
      cat1: '🧩 1. Teamwork and communication',
      q1_1: 'Communicates clearly and respectfully with all team members?',
      q1_2: 'Listens and considers others\' opinions before making decisions?',
      q1_3: 'Supports colleagues when the restaurant is busy?',
      q1_4: 'Promotes a positive and collaborative environment during the shift?',
      q1_5: 'Resolves conflicts professionally without creating tension?',
      
      cat2: '⚙️ 2. Leadership and personnel management',
      q2_1: 'Motivates the team to achieve shift objectives?',
      q2_2: 'Gives constructive feedback instead of just pointing out mistakes?',
      q2_3: 'Is fair when assigning tasks and responsibilities?',
      q2_4: 'Intervenes and supports when an employee has difficulties with a customer or task?',
      q2_5: 'Leads by example in punctuality, attitude, and performance?',
      
      cat3: '🍽️ 3. Work performance and efficiency',
      q3_1: 'Fulfills responsibilities without constant supervision?',
      q3_2: 'Maintains cleanliness and organization in their work area?',
      q3_3: 'Correctly follows procedures (recipes, safety, hygiene, etc.)?',
      q3_4: 'Acts with speed and precision during high volume?',
      q3_5: 'Shows initiative to solve problems or improve processes?',
      
      cat4: '💬 4. Attitude and professionalism',
      q4_1: 'Maintains a positive attitude even under pressure?',
      q4_2: 'Treats all team members with respect, without favoritism?',
      q4_3: 'Adequately represents the company\'s image and values?',
      q4_4: 'Receives criticism well and strives to improve?',
      q4_5: 'Contributes to a pleasant and motivating work environment?',
      
      cat5: '💡 5. Development and learning',
      q5_1: 'Is interested in learning new tasks or positions?',
      q5_2: 'Seeks opportunities to grow within the company?',
      q5_3: 'Helps train or guide new employees when necessary?',
      q5_4: 'Applies what was learned in training or previous feedback?',
      q5_5: 'Is open to changes in procedures or policies?',
      
      fortalezas: 'Strengths',
      fortalezasPlaceholder: 'What do they do very well?',
      areasMejora: 'Areas for improvement',
      areasMejoraPlaceholder: 'What could they improve?',
      recomendaria: 'Would you recommend working with this person again on the same team?',
      yes: 'Yes',
      no: 'No',
      general: 'Overall performance (1–10)',
      generalPlaceholder: '1–10',
      comentarios: 'Additional comments',
      comentariosPlaceholder: 'Optional',
      photos: 'Evidence (photos, optional)',
      photosHint: 'Maximum 10 photos',
      
      hint: '1 = Poor · 5 = Excellent',
      send: 'Submit Evaluation',
      sending: 'Sending...',
      thanks: 'THANK YOU!',
      thanksMsg: 'Your evaluation has been recorded',
      errStore: 'Please select a location',
      errName: 'Please enter the name of the person being evaluated',
      errRole: 'Please select the role of the person being evaluated',
      errGeneral: 'Please rate the overall performance (1-10)',
      errMinQuestions: 'Please answer at least 80% of the applicable questions',
      submitError: 'Error submitting. Please try again.',
      leadOnly: '(Leadership roles only)'
    }
  }

  const t = texts[lang]
  const isLead = isLeadRole(evaluatedRole)

  const StarIcon = ({ filled }: { filled: boolean }) => (
    <svg viewBox="0 0 24 24" className={`w-8 h-8 transition-all cursor-pointer ${filled ? 'fill-yellow-400 scale-110' : 'fill-gray-300 hover:fill-yellow-200'}`}>
      <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
    </svg>
  )

  const QuestionRow = ({ code, label, value, onChange, showForLead = false }: any) => {
    if (showForLead && !isLead) return null
    
    return (
      <div className={showForLead && !isLead ? 'hidden' : ''}>
        <label className="block text-sm font-semibold text-gray-900 mb-2">
          {label} {showForLead && <span className="text-blue-600 text-xs">({t.leadOnly})</span>}
        </label>
        <div className="flex justify-center space-x-1">
          {[1, 2, 3, 4, 5].map(val => (
            <button key={val} type="button" onClick={() => onChange(val)}
              className="transition-transform hover:scale-110">
              <StarIcon filled={value >= val} />
            </button>
          ))}
        </div>
        <p className="text-center text-xs text-gray-500 mt-1">{t.hint}</p>
      </div>
    )
  }

  // Splash
  if (showSplash) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center" style={{ background: 'linear-gradient(180deg, #ffffff, #f7f7fb)' }}>
        <style dangerouslySetInnerHTML={{__html: `
          @keyframes fall { from { top: -360px; } to { top: 40px; } }
          @keyframes spin { from { transform: translateX(-50%) rotateY(0deg); } to { transform: translateX(-50%) rotateY(1440deg); } }
          @keyframes shadowIn { to { opacity: 1; } }
        `}} />
        <div className="relative w-[300px] h-[360px]">
          <div className="absolute left-1/2 w-[240px] h-[240px] rounded-full bg-white grid place-items-center overflow-hidden"
            style={{ transform: 'translateX(-50%)', boxShadow: '0 20px 46px rgba(0,0,0,0.20), inset 0 0 0 8px #f2f2f2',
              animation: 'fall 3s cubic-bezier(0.2,0.8,0.2,1) forwards, spin 2.5s ease-in-out forwards', top: '-360px' }}>
            <img src="/logo.png" alt="Tacos Gavilan" className="w-[86%] h-[86%] object-contain rounded-full"
              style={{ background: 'radial-gradient(closest-side, #ffffff 0%, #fbeab9 65%, #f3d26a 100%)' }}
              onError={(e) => { e.currentTarget.style.display = 'none'; const parent = e.currentTarget.parentElement;
                if (parent) { const div = document.createElement('div'); div.className = 'text-9xl'; div.textContent = '👔'; parent.appendChild(div); }}} />
          </div>
          <div className="absolute bottom-[10px] left-1/2 w-[240px] h-[38px] rounded-full opacity-0"
            style={{ transform: 'translateX(-50%)', background: 'radial-gradient(closest-side, rgba(0,0,0,0.22), rgba(0,0,0,0))',
              filter: 'blur(10px)', animation: 'shadowIn 0.9s 0.4s forwards' }} />
        </div>
      </div>
    )
  }

  // Thanks
  if (showThanks) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center" style={{ background: 'linear-gradient(180deg, #ffffff, #f7f7fb)' }}>
        <style dangerouslySetInnerHTML={{__html: `
          @keyframes fallThanks { from { top: -360px; } to { top: 40px; } }
          @keyframes spinThanks { from { transform: translateX(-50%) rotateY(0deg); } to { transform: translateX(-50%) rotateY(360deg); } }
          @keyframes shadowInThanks { to { opacity: 1; } }
        `}} />
        <div className="relative w-[300px] h-[420px]">
          <div className="absolute left-1/2 w-[240px] h-[240px] rounded-full bg-white grid place-items-center overflow-hidden"
            style={{ transform: 'translateX(-50%)', boxShadow: '0 20px 46px rgba(0,0,0,0.20), inset 0 0 0 8px #f2f2f2',
              animation: 'fallThanks 1.2s cubic-bezier(0.2,0.8,0.2,1) forwards, spinThanks 1.2s ease-in-out forwards', top: '-360px' }}>
            <div className="text-9xl">✅</div>
          </div>
          <div className="absolute bottom-[130px] left-1/2 w-[240px] h-[38px] rounded-full opacity-0"
            style={{ transform: 'translateX(-50%)', background: 'radial-gradient(closest-side, rgba(0,0,0,0.22), rgba(0,0,0,0))',
              filter: 'blur(10px)', animation: 'shadowInThanks 0.9s 0.4s forwards' }} />
          <div className="absolute bottom-0 left-0 right-0 text-center px-4">
            <h1 className="text-5xl font-bold text-green-600 mb-3">{t.thanks}</h1>
            <p className="text-xl text-gray-700">{t.thanksMsg}</p>
          </div>
        </div>
      </div>
    )
  }

  // Form
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm sticky top-0 z-40 border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <img src="/logo.png" alt="Tacos Gavilan" className="w-10 h-10 object-contain rounded-full"
              onError={(e) => { e.currentTarget.style.display = 'none'; const parent = e.currentTarget.parentElement;
                if (parent) { const div = document.createElement('div'); div.className = 'text-4xl'; div.textContent = '👔'; parent.appendChild(div); }}} />
            <strong className="text-xl text-gray-900">Tacos Gavilan</strong>
            <span className="px-2 py-1 rounded-full text-xs bg-gray-200 text-gray-700">Staff Evaluation</span>
          </div>
          <button onClick={() => setLang(lang === 'es' ? 'en' : 'es')}
            className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-900 text-sm font-semibold rounded-lg">
            {lang === 'es' ? 'EN' : 'ES'}
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6 border border-gray-200">
          <h2 className="text-2xl font-bold text-red-600 mb-2">{t.title}</h2>
          <p className="text-gray-600 text-sm">{t.subtitle}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Datos básicos */}
          <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="store" className="block text-sm font-bold text-gray-900 mb-2">{t.store}</label>
                <select id="store" required value={selectedStore} onChange={(e) => setSelectedStore(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-red-500">
                  <option value="">{t.storePlaceholder}</option>
                  {stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}
                </select>
              </div>

              <div>
                <label htmlFor="idioma" className="block text-sm font-bold text-gray-900 mb-2">Idioma / Language</label>
                <select id="idioma" value={lang} onChange={(e) => setLang(e.target.value as Language)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-red-500">
                  <option value="es">Español</option>
                  <option value="en">English</option>
                </select>
              </div>

              <div>
                <label htmlFor="evaluator" className="block text-sm font-bold text-gray-900 mb-2">{t.evaluator}</label>
                <input id="evaluator" type="text" value={formData.evaluator_name}
                  onChange={(e) => setFormData({...formData, evaluator_name: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-red-500"
                  placeholder={t.evaluatorPlaceholder} />
              </div>

              <div>
                <label htmlFor="evaluatedName" className="block text-sm font-bold text-gray-900 mb-2">{t.evaluatedName} *</label>
                <input id="evaluatedName" type="text" required value={formData.evaluated_name}
                  onChange={(e) => setFormData({...formData, evaluated_name: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-red-500"
                  placeholder={t.evaluatedNamePlaceholder} />
              </div>

              <div className="md:col-span-2">
                <label htmlFor="evaluatedRole" className="block text-sm font-bold text-gray-900 mb-2">{t.evaluatedRole} *</label>
                <select id="evaluatedRole" required value={formData.evaluated_role}
                  onChange={(e) => setFormData({...formData, evaluated_role: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-red-500">
                  <option value="">{t.evaluatedRolePlaceholder}</option>
                  {ROLES.map(role => <option key={role} value={role}>{role}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Q1: Trabajo en equipo */}
          <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
            <h3 className="text-xl font-bold text-gray-900 mb-5">{t.cat1}</h3>
            <div className="space-y-5">
              <QuestionRow code="q1_1" label={t.q1_1} value={formData.q1_1} onChange={(v: number) => setFormData({...formData, q1_1: v})} />
              <QuestionRow code="q1_2" label={t.q1_2} value={formData.q1_2} onChange={(v: number) => setFormData({...formData, q1_2: v})} />
              <QuestionRow code="q1_3" label={t.q1_3} value={formData.q1_3} onChange={(v: number) => setFormData({...formData, q1_3: v})} />
              <QuestionRow code="q1_4" label={t.q1_4} value={formData.q1_4} onChange={(v: number) => setFormData({...formData, q1_4: v})} />
              <QuestionRow code="q1_5" label={t.q1_5} value={formData.q1_5} onChange={(v: number) => setFormData({...formData, q1_5: v})} showForLead={true} />
            </div>
          </div>

          {/* Q2: Liderazgo (solo LEAD) */}
          {isLead && (
            <div className="bg-white rounded-xl shadow-sm p-6 border border-blue-200 border-2">
              <h3 className="text-xl font-bold text-blue-900 mb-5">{t.cat2} <span className="text-sm text-blue-600">({t.leadOnly})</span></h3>
              <div className="space-y-5">
                <QuestionRow code="q2_1" label={t.q2_1} value={formData.q2_1} onChange={(v: number) => setFormData({...formData, q2_1: v})} showForLead={true} />
                <QuestionRow code="q2_2" label={t.q2_2} value={formData.q2_2} onChange={(v: number) => setFormData({...formData, q2_2: v})} showForLead={true} />
                <QuestionRow code="q2_3" label={t.q2_3} value={formData.q2_3} onChange={(v: number) => setFormData({...formData, q2_3: v})} showForLead={true} />
                <QuestionRow code="q2_4" label={t.q2_4} value={formData.q2_4} onChange={(v: number) => setFormData({...formData, q2_4: v})} showForLead={true} />
                <QuestionRow code="q2_5" label={t.q2_5} value={formData.q2_5} onChange={(v: number) => setFormData({...formData, q2_5: v})} showForLead={true} />
              </div>
            </div>
          )}

          {/* Q3: Desempeño */}
          <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
            <h3 className="text-xl font-bold text-gray-900 mb-5">{t.cat3}</h3>
            <div className="space-y-5">
              <QuestionRow code="q3_1" label={t.q3_1} value={formData.q3_1} onChange={(v: number) => setFormData({...formData, q3_1: v})} />
              <QuestionRow code="q3_2" label={t.q3_2} value={formData.q3_2} onChange={(v: number) => setFormData({...formData, q3_2: v})} />
              <QuestionRow code="q3_3" label={t.q3_3} value={formData.q3_3} onChange={(v: number) => setFormData({...formData, q3_3: v})} />
              <QuestionRow code="q3_4" label={t.q3_4} value={formData.q3_4} onChange={(v: number) => setFormData({...formData, q3_4: v})} />
              <QuestionRow code="q3_5" label={t.q3_5} value={formData.q3_5} onChange={(v: number) => setFormData({...formData, q3_5: v})} showForLead={true} />
            </div>
          </div>

          {/* Q4: Actitud */}
          <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
            <h3 className="text-xl font-bold text-gray-900 mb-5">{t.cat4}</h3>
            <div className="space-y-5">
              <QuestionRow code="q4_1" label={t.q4_1} value={formData.q4_1} onChange={(v: number) => setFormData({...formData, q4_1: v})} />
              <QuestionRow code="q4_2" label={t.q4_2} value={formData.q4_2} onChange={(v: number) => setFormData({...formData, q4_2: v})} showForLead={true} />
              <QuestionRow code="q4_3" label={t.q4_3} value={formData.q4_3} onChange={(v: number) => setFormData({...formData, q4_3: v})} showForLead={true} />
              <QuestionRow code="q4_4" label={t.q4_4} value={formData.q4_4} onChange={(v: number) => setFormData({...formData, q4_4: v})} />
              <QuestionRow code="q4_5" label={t.q4_5} value={formData.q4_5} onChange={(v: number) => setFormData({...formData, q4_5: v})} showForLead={true} />
            </div>
          </div>

          {/* Q5: Desarrollo */}
          <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
            <h3 className="text-xl font-bold text-gray-900 mb-5">{t.cat5}</h3>
            <div className="space-y-5">
              <QuestionRow code="q5_1" label={t.q5_1} value={formData.q5_1} onChange={(v: number) => setFormData({...formData, q5_1: v})} />
              <QuestionRow code="q5_2" label={t.q5_2} value={formData.q5_2} onChange={(v: number) => setFormData({...formData, q5_2: v})} />
              <QuestionRow code="q5_3" label={t.q5_3} value={formData.q5_3} onChange={(v: number) => setFormData({...formData, q5_3: v})} />
              <QuestionRow code="q5_4" label={t.q5_4} value={formData.q5_4} onChange={(v: number) => setFormData({...formData, q5_4: v})} />
              <QuestionRow code="q5_5" label={t.q5_5} value={formData.q5_5} onChange={(v: number) => setFormData({...formData, q5_5: v})} />
            </div>
          </div>

          {/* Fortalezas y áreas */}
          <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200 space-y-4">
            <div>
              <label htmlFor="fortalezas" className="block text-sm font-bold text-gray-900 mb-2">{t.fortalezas}</label>
              <textarea id="fortalezas" value={formData.fortalezas}
                onChange={(e) => setFormData({...formData, fortalezas: e.target.value})} rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-red-500 resize-none"
                placeholder={t.fortalezasPlaceholder} />
            </div>

            <div>
              <label htmlFor="areasMejora" className="block text-sm font-bold text-gray-900 mb-2">{t.areasMejora}</label>
              <textarea id="areasMejora" value={formData.areas_mejora}
                onChange={(e) => setFormData({...formData, areas_mejora: e.target.value})} rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-red-500 resize-none"
                placeholder={t.areasMejoraPlaceholder} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="recomendaria" className="block text-sm font-bold text-gray-900 mb-2">{t.recomendaria}</label>
                <select id="recomendaria" value={formData.recomendaria}
                  onChange={(e) => setFormData({...formData, recomendaria: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-red-500">
                  <option value="si">{t.yes}</option>
                  <option value="no">{t.no}</option>
                </select>
              </div>

              <div>
                <label htmlFor="general" className="block text-sm font-bold text-gray-900 mb-2">{t.general}</label>
                <input id="general" type="number" min="1" max="10" required value={formData.desempeno_general || ''}
                  onChange={(e) => setFormData({...formData, desempeno_general: parseInt(e.target.value) || 0})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-red-500"
                  placeholder={t.generalPlaceholder} />
              </div>
            </div>

            <div>
              <label htmlFor="comentarios" className="block text-sm font-bold text-gray-900 mb-2">{t.comentarios}</label>
              <textarea id="comentarios" value={formData.comentarios}
                onChange={(e) => setFormData({...formData, comentarios: e.target.value})} rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-red-500 resize-none"
                placeholder={t.comentariosPlaceholder} />
            </div>

            <div>
              <label htmlFor="fotos" className="block text-sm font-bold text-gray-900 mb-2">{t.photos}</label>
              <input id="fotos" type="file" accept="image/*" multiple onChange={handlePhotoChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500" />
              <p className="text-xs text-gray-600 mt-1">{t.photosHint}</p>
              {photoPreviews.length > 0 && (
                <div className="grid grid-cols-5 gap-2 mt-3">
                  {photoPreviews.map((preview, i) => (
                    <img key={i} src={preview} alt={`Preview ${i + 1}`} className="w-full h-20 object-cover rounded-lg" />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Submit */}
          <button type="submit" disabled={loading}
            className="w-full bg-red-600 hover:bg-red-700 text-white font-bold text-lg py-4 rounded-xl shadow-lg transition-all disabled:opacity-50">
            {loading ? `⏳ ${t.sending}` : t.send}
          </button>
        </form>
      </div>
    </div>
  )
}