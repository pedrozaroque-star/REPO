'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { uploadPhotos } from '@/lib/uploadPhotos'

// --- 🎨 COLORES ---
const COLOR_STYLES: any = {
  blue:   { bg: 'bg-blue-50',   border: 'border-blue-200', text: 'text-blue-900', badge: 'text-blue-700' },
  red:    { bg: 'bg-red-50',    border: 'border-red-200',  text: 'text-red-900',  badge: 'text-red-700' },
  orange: { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-900', badge: 'text-orange-700' },
  yellow: { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-900', badge: 'text-yellow-700' },
  green:  { bg: 'bg-green-50',  border: 'border-green-200',  text: 'text-green-900',  badge: 'text-green-700' },
  purple: { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-900', badge: 'text-purple-700' },
  cyan:   { bg: 'bg-cyan-50',   border: 'border-cyan-200',   text: 'text-cyan-900',   badge: 'text-cyan-700' },
}

// --- 🕵️‍♂️ PREGUNTAS ---
const INSPECTION_AREAS = {
  servicio: {
    label: '🤝 Servicio al Cliente', color: 'blue', hint: 'Amabilidad, cortesía, rapidez',
    items: ['Saluda y despide cordialmente', 'Atiende con paciencia y respeto', 'Entrega órdenes con frase de cierre', 'Evita charlas personales en línea']
  },
  carnes: {
    label: '🥩 Procedimiento de Carnes', color: 'red', hint: 'Tiempos/temperaturas, limpieza',
    items: ['Controla temperatura (450°/300°) y tiempos', 'Utensilios limpios, no golpear espátulas', 'Escurre carnes y rota producto (FIFO)', 'Vigila cebolla asada y porciones']
  },
  alimentos: {
    label: '🌮 Preparación de Alimentos', color: 'orange', hint: 'Recetas, porciones, presentación',
    items: ['Respeta porciones estándar (cucharas)', 'Quesadillas bien calientes, sin quemar', 'Burritos bien enrollados, sin dorar de más', 'Stickers correctos donde aplica']
  },
  tortillas: {
    label: '🫓 Seguimiento a Tortillas', color: 'yellow', hint: 'Temperatura, textura y reposición',
    items: ['Tortillas bien calientes (aceite solo en orillas)', 'Máx 5 tacos por plato (presentación)', 'Reponer a tiempo y mantener frescura']
  },
  limpieza: {
    label: '✨ Limpieza General y Baños', color: 'green', hint: 'Estaciones, comedor, baños',
    items: ['Cubetas rojas con sanitizer tibio', 'Plancha limpia y sin residuos', 'Baños con insumos completos y sin olores', 'Exterior y basureros limpios']
  },
  bitacoras: {
    label: '📝 Checklists y Bitácoras', color: 'purple', hint: 'Registros al día y firmados',
    items: ['Checklist apertura/cierre completo', 'Bitácora de temperaturas al día', 'Registros de limpieza firmados']
  },
  aseo: {
    label: '🧼 Aseo Personal', color: 'cyan', hint: 'Uniforme, higiene y presentación',
    items: ['Uniforme limpio y completo', 'Uñas cortas, sin joyas/auriculares', 'Uso correcto de gorra y guantes']
  }
}

// --- FECHA LOCAL ---
const getLocalDate = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
const getLocalTime = () => {
  const d = new Date()
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

export default function InspectionForm({ user, initialData, stores }: { user: any, initialData?: any, stores: any[] }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  // Estado simple para la UI: { servicio: { 0: 100, 1: 60 } }
  const [answers, setAnswers] = useState<any>({})
  
  const [formData, setFormData] = useState({
    store_id: initialData?.store_id || '',
    inspection_date: initialData?.inspection_date ? initialData.inspection_date.substring(0, 10) : getLocalDate(),
    inspection_time: initialData?.inspection_time || getLocalTime(),
    shift: initialData?.shift || (new Date().getHours() >= 16 ? 'PM' : 'AM'),
    observaciones: initialData?.observaciones || '',
    photos: initialData?.photos || [] 
  })

  // --- CARGA DE DATOS (COMPATIBLE CON TODO) ---
  useEffect(() => {
    if (initialData?.answers) {
      const loaded: any = {}
      Object.keys(initialData.answers).forEach(areaKey => {
        loaded[areaKey] = {}
        const areaData = initialData.answers[areaKey]
        
        // Si tiene "items", es estructura NUEVA
        if (areaData.items) {
          Object.keys(areaData.items).forEach(k => {
            const idx = parseInt(k.replace('i', '')) // "i0" -> 0
            if (!isNaN(idx)) loaded[areaKey][idx] = areaData.items[k].score
          })
        } 
        // Si no, es estructura VIEJA (legacy)
        else {
          Object.keys(areaData).forEach(k => {
            const idx = parseInt(k)
            if (!isNaN(idx) && typeof areaData[k] === 'number') loaded[areaKey][idx] = areaData[k]
          })
        }
      })
      setAnswers(loaded)
    } else if (!initialData) {
      // Inicializar vacío si es nuevo
      const init: any = {}
      Object.keys(INSPECTION_AREAS).forEach(k => init[k] = {})
      setAnswers(init)
    }
  }, [initialData])

  // --- CÁLCULO ---
  const calculateScores = () => {
    const scores: any = {}
    let totalScore = 0
    let totalAreas = 0

    Object.entries(INSPECTION_AREAS).forEach(([key, area]) => {
      const areaAnswers = answers[key] || {}
      let sum = 0, count = 0
      Object.values(areaAnswers).forEach((v: any) => { if(v!==null && v!==undefined){ sum+=parseInt(v); count++ } })
      
      const score = count > 0 ? Math.round(sum/count) : 0
      scores[`${key}_score`] = score
      totalScore += score
      totalAreas++
    })
    return { scores, overall: totalAreas>0 ? Math.round(totalScore/totalAreas) : 0 }
  }

  const handleAnswer = (area: string, idx: number, val: number) => {
    setAnswers((prev: any) => ({ ...prev, [area]: { ...prev[area], [idx]: val } }))
  }

  // --- SUBIDA FOTOS ---
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return
    if (formData.photos.length + e.target.files.length > 10) return alert('⚠️ Máximo 10 fotos.')
    setLoading(true)
    try {
      const urls = await uploadPhotos(Array.from(e.target.files), 'checklist-photos', 'inspection')
      setFormData(prev => ({ ...prev, photos: [...prev.photos, ...urls] }))
    } catch (e) { alert('Error subiendo fotos') }
    finally { setLoading(false); if(fileInputRef.current) fileInputRef.current.value='' }
  }

  // --- GUARDAR ---
  const handleSubmit = async (e: any) => {
    e.preventDefault()
    setLoading(true)
    try {
      const { scores, overall } = calculateScores()

      // GENERAR ESTRUCTURA "LEGACY COMPATIBLE" (RICA)
      const richAnswers: any = {}
      Object.entries(INSPECTION_AREAS).forEach(([key, area]: [string, any]) => {
        const itemsObj: any = {}
        area.items.forEach((label: string, idx: number) => {
          const val = answers[key]?.[idx]
          itemsObj[`i${idx}`] = { label, score: val !== undefined ? val : 0 }
        })
        richAnswers[key] = { score: scores[`${key}_score`], items: itemsObj }
      })

      const payload = {
        store_id: parseInt(formData.store_id),
        inspector_id: user.id,
        supervisor_name: user.name || user.email,
        inspection_date: formData.inspection_date, // Texto YYYY-MM-DD
        inspection_time: formData.inspection_time, // Texto HH:MM
        shift: formData.shift,
        overall_score: overall,
        ...scores,
        answers: richAnswers,
        observaciones: formData.observaciones,
        photos: formData.photos
      }

      const { error } = initialData?.id 
        ? await supabase.from('supervisor_inspections').update(payload).eq('id', initialData.id)
        : await supabase.from('supervisor_inspections').insert([payload])

      if (error) throw error
      alert('✅ Guardado Exitosamente')
      router.push('/inspecciones')
      router.refresh()
    } catch (err: any) {
      alert('Error: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const { overall } = calculateScores()
  const scoreColor = overall >= 90 ? 'text-green-600' : overall >= 75 ? 'text-yellow-600' : 'text-red-600'

  return (
    <form onSubmit={handleSubmit} className="max-w-5xl mx-auto space-y-8 pb-24 animate-in fade-in">
      {/* HEADER */}
      <div className="bg-white p-4 rounded-2xl shadow-lg border border-gray-200 sticky top-4 z-30 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-black text-gray-900">🕵️ Inspección de Supervisor</h1>
          <p className="text-gray-500 text-xs">Auditoría completa de 7 puntos.</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-center">
            <p className="text-[10px] uppercase font-bold text-gray-400">Global</p>
            <p className={`text-3xl font-black ${scoreColor}`}>{overall}%</p>
          </div>
          <button type="submit" disabled={loading} className="bg-gray-900 hover:bg-black text-white px-6 py-3 rounded-xl font-bold shadow-lg transition-all text-sm">
            {loading ? '...' : '💾 Guardar'}
          </button>
        </div>
      </div>

      {/* DATOS GENERALES */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="col-span-2 md:col-span-1">
          <label className="text-xs font-bold text-gray-900 uppercase block mb-1">Tienda</label>
          <select required value={formData.store_id} onChange={e => setFormData({...formData, store_id: e.target.value})} className="w-full p-2 border border-gray-300 rounded-lg font-bold text-gray-900 bg-white">
            <option value="">Seleccionar...</option>
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-bold text-gray-900 uppercase block mb-1">Fecha</label>
          <input type="date" required value={formData.inspection_date} onChange={e => setFormData({...formData, inspection_date: e.target.value})} className="w-full p-2 border border-gray-300 rounded-lg font-bold text-gray-900 bg-white" />
        </div>
        <div>
          <label className="text-xs font-bold text-gray-900 uppercase block mb-1">Hora</label>
          <input type="time" required value={formData.inspection_time} onChange={e => setFormData({...formData, inspection_time: e.target.value})} className="w-full p-2 border border-gray-300 rounded-lg font-bold text-gray-900 bg-white" />
        </div>
        <div>
          <label className="text-xs font-bold text-gray-900 uppercase block mb-1">Turno</label>
          <select value={formData.shift} onChange={e => setFormData({...formData, shift: e.target.value})} className="w-full p-2 border border-gray-300 rounded-lg font-bold text-gray-900 bg-white">
            <option value="AM">☀️ AM</option>
            <option value="PM">🌙 PM</option>
          </select>
        </div>
      </div>

      {/* ÁREAS */}
      <div className="space-y-6">
        {Object.entries(INSPECTION_AREAS).map(([key, area]: [string, any]) => {
          const areaAnswers = answers[key] || {}
          let sum=0, count=0
          Object.values(areaAnswers).forEach((v:any)=>{ if(v!==null && v!==undefined){sum+=parseInt(v); count++} })
          const localScore = count>0 ? Math.round(sum/count) : 0
          const style = COLOR_STYLES[area.color]

          return (
            <div key={key} className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
              <div className={`px-6 py-3 ${style.bg} border-b ${style.border} flex justify-between items-center`}>
                <h3 className={`font-black ${style.text} text-lg`}>{area.label}</h3>
                <span className={`text-sm font-black px-3 py-1 rounded-full bg-white shadow-sm ${style.badge}`}>{localScore}%</span>
              </div>
              <div className="divide-y divide-gray-100">
                {area.items.map((item: string, idx: number) => {
                  const val = areaAnswers[idx]
                  return (
                    <div key={idx} className="p-3 md:px-6 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-gray-50">
                      <p className="text-gray-900 font-medium text-sm flex-1">{idx+1}. {item}</p>
                      <div className="flex bg-gray-100 rounded-lg p-1 shrink-0 gap-1">
                        {[100, 60, 0].map(score => (
                          <button key={score} type="button" onClick={() => handleAnswer(key, idx, score)}
                            className={`px-3 py-1 rounded text-[10px] font-bold transition-all ${val === score 
                              ? (score===100?'bg-green-600 text-white':score===60?'bg-yellow-500 text-black':'bg-red-600 text-white') + ' shadow' 
                              : 'text-gray-500 hover:bg-white'}`}>
                            {score===100?'✅ CUMPLE':score===60?'🟡 PARCIAL':'❌ FALLA'}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* FOTOS Y COMENTARIOS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
          <div className="flex justify-between mb-4"><h3 className="font-bold text-gray-900">📸 Evidencias</h3><span className="text-xs bg-gray-100 px-2 py-1 rounded font-bold text-gray-700">{formData.photos.length}/10</span></div>
          <div className="grid grid-cols-4 gap-2 mb-4">
            {formData.photos.map((url, i) => (
              <div key={i} className="relative aspect-square rounded-lg overflow-hidden group border border-gray-200">
                <img src={url} className="w-full h-full object-cover" />
                <button type="button" onClick={() => setFormData(p => ({...p, photos: p.photos.filter((_,x)=>x!==i)}))} className="absolute top-1 right-1 bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">×</button>
              </div>
            ))}
            {formData.photos.length < 10 && <button type="button" onClick={() => fileInputRef.current?.click()} className="aspect-square rounded-lg border-2 border-dashed border-gray-300 text-gray-400 hover:border-blue-500 hover:text-blue-500 text-2xl">+</button>}
          </div>
          <input type="file" ref={fileInputRef} className="hidden" accept="image/*" multiple onChange={handlePhotoUpload} />
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
          <label className="block text-sm font-bold text-gray-900 mb-2">📝 Comentarios Finales</label>
          <textarea value={formData.observaciones} onChange={e => setFormData({...formData, observaciones: e.target.value})} rows={5} className="w-full p-4 border border-gray-300 rounded-xl text-gray-900 bg-white text-sm" placeholder="Observaciones..." />
        </div>
      </div>
    </form>
  )
}