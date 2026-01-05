'use client'
import '@/app/checklists/checklists.css'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'

interface Store {
  id: string
  name: string
}

const SECTIONS = [
  {
    title: 'Cocina y Línea de Preparación',
    items: [
      'Todo el equipo alcanza la temperatura adecuada (frío) 34°F (caliente) 160°F',
      'Todas las luces funcionan y están en buenas condiciones',
      'Todo el acero inoxidable está limpio y pulido',
      'Cubeta roja de sanitizante bajo línea @ 200ppm',
      'Todas las rebanadoras limpias, tijeras limpias y funcionando',
      'Máquina de hielo limpia (sin moho)',
      'Todos los drenajes limpios y funcionando',
      'Pisos y zócalos están limpios',
      'Área del trapeador limpia y organizada',
      'Microondas está limpio',
      'Lavado de manos y cambio de guantes frecuente',
      'Área de escoba limpia y organizada (todo 6" del piso)',
      'Estaciones de champurrado limpias y organizadas',
      'Baño de empleados limpio y abastecido',
      'Se utiliza FIFO',
      'Los trapos están en cubetas de sanitizante',
      'Expedidor anuncia órdenes claramente',
      'Tanque de gas de refrescos al menos medio lleno (avisar a SM si no)',
      'Todos los alimentos perecederos se verifican antes de su uso',
      'Temperatura del agua caliente del lavamanos a 100°F mínimo',
      'Campana de extracción limpia y funcionando',
      'Termómetros calibrados y funcionando correctamente',
      'Productos químicos etiquetados y almacenados correctamente',
      'Recipientes de alimentos cubiertos y etiquetados con fechas'
    ]
  },
  {
    title: 'Comedor y Áreas de Clientes',
    items: [
      'Se saluda a clientes dentro de 5 segundos',
      'Hacemos contacto visual, interactuamos con el cliente',
      'Ventanas limpias (sin manchas), marcos limpios',
      'Baños abastecidos, limpios, sin grafiti y funcionando',
      'Estacionamiento limpio y mantenido',
      'TVs funcionando, ventilaciones de AC limpias',
      'Toda la iluminación funciona (sin bombillas fundidas)',
      'Mesas, sillas, paredes y pisos mantenidos limpios',
      'Dispensadores de servilletas y condimentos llenos',
      'Menú visible y actualizado',
      'Salsa bar limpio y abastecido',
      'Botes de basura vacíos y limpios',
      'Señalización de seguridad visible',
      'Entrada libre de obstáculos'
    ]
  },
  {
    title: 'Checklists y Reportes',
    items: [
      'Checklists de apertura/cierre completos y firmados',
      'Registro de temperaturas actualizado',
      'Bitácora de limpieza al día',
      'Inventario de productos controlado',
      'Reporte de ventas del día anterior revisado',
      'Programación de empleados actualizada',
      'Libro de quejas y sugerencias disponible',
      'Reportes de incidentes documentados si aplica',
      'Lista de reparaciones pendientes actualizada',
      'Control de mermas registrado',
      'Verificación de efectivo en caja',
      'Documentación de capacitaciones al día',
      'Control de asistencias completo'
    ]
  },
  {
    title: 'Temperatura y Asuntos de Empleados',
    items: [
      'Temperaturas registradas cada 4 horas',
      'Empleados con uniforme completo y limpio',
      'Personal con certificado de manejo de alimentos vigente',
      'Empleados conocen procedimientos de emergencia'
    ]
  }
]

function ManagerChecklistContent() {
  const router = useRouter()
  const { user } = useAuth()
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(false)
  const [showThanks, setShowThanks] = useState(false)
  
  const [formData, setFormData] = useState({
    store_id: '',
    checklist_date: new Date().toISOString().split('T')[0],
    checklist_time: new Date().toTimeString().slice(0, 5),
    shift: 'AM' as 'AM' | 'PM',
    comments: '',
    photos: [] as File[]
  })
  
  const [answers, setAnswers] = useState<{[key: string]: 'SI' | 'NO' | 'NA' | null}>({})
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([])
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set([0, 1, 2, 3]))

  useEffect(() => {
    fetchStores()
  }, [])

  const fetchStores = async () => {
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      const res = await fetch(`${url}/rest/v1/stores?select=id,name,code&order=name.asc`, {
        headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` }
      })
      const data = await res.json()
      let loadedStores = Array.isArray(data) ? data : []

      // --- 🔒 FILTRAR TIENDAS SEGÚN ROL ---
      const userScope = (user as any)?.store_scope
      if (user?.role === 'asistente' && Array.isArray(userScope) && userScope.length > 0) {
        loadedStores = loadedStores.filter(s => userScope.includes(s.code) || userScope.includes(s.name))
      }
      
      setStores(loadedStores)

      // --- 🔒 AUTO-SELECCIÓN TIENDA ---
      if (user?.role === 'asistente' && Array.isArray(userScope) && userScope.length > 0 && loadedStores.length > 0) {
        const myStoreId = loadedStores[0].id.toString()
        setFormData(prev => ({ ...prev, store_id: myStoreId }))
      }

    } catch (err) {
      console.error('Error:', err)
    }
  }
  }

  const handleAnswer = (sectionIdx: number, itemIdx: number, value: 'SI' | 'NO' | 'NA') => {
    const key = `s${sectionIdx}_${itemIdx}`
    setAnswers(prev => ({...prev, [key]: value}))
  }

  const calculateScore = (): number => {
    const values = Object.values(answers).filter(v => v !== null)
    const siCount = values.filter(v => v === 'SI').length
    if (values.length === 0) return 0
    return Math.round((siCount / values.length) * 100)
  }

  const toggleSection = (idx: number) => {
    setExpandedSections(prev => {
      const newSet = new Set(prev)
      if (newSet.has(idx)) newSet.delete(idx)
      else newSet.add(idx)
      return newSet
    })
  }

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return
    const files = Array.from(e.target.files).slice(0, 10)
    setFormData({...formData, photos: files})
    
    const previews: string[] = []
    let loaded = 0
    
    files.forEach(file => {
      const reader = new FileReader()
      reader.onload = (e) => {
        if (e.target?.result) {
          previews.push(e.target.result as string)
          loaded++
          if (loaded === files.length) setPhotoPreviews([...previews])
        }
      }
      reader.readAsDataURL(file)
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!user) {
      alert('No se pudo obtener información del usuario')
      return
    }
    
    if (!formData.store_id) {
      alert('Por favor selecciona una sucursal')
      return
    }
    
    const totalQuestions = SECTIONS.reduce((sum, sec) => sum + sec.items.length, 0)
    const answered = Object.keys(answers).length
    
    if (answered < totalQuestions) {
      alert(`Por favor responde TODAS las preguntas (${answered}/${totalQuestions})`)
      return
    }

    setLoading(true)

    try {
      let photoUrls: string[] = []
      if (formData.photos.length > 0) {
        const { uploadPhotos } = await import('@/lib/uploadPhotos')
        const prefix = `${formData.store_id}_manager_${formData.checklist_date}`
        photoUrls = await uploadPhotos(formData.photos, 'staff-photos', prefix)
      }

      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

      const payload = {
        store_id: parseInt(formData.store_id),
        user_id: user.id,
        manager_name: user.name,
        created_by: user.name,
        checklist_date: formData.checklist_date,
        checklist_time: formData.checklist_time,
        shift: formData.shift,
        answers: answers,
        score: calculateScore(),
        comments: formData.comments || null,
        photo_urls: photoUrls.length > 0 ? photoUrls : null
      }

      const res = await fetch(`${url}/rest/v1/manager_checklists`, {
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
        setTimeout(() => {
          router.push('/checklists')
        }, 2000)
      } else {
        const error = await res.text()
        console.error('Error:', error)
        alert('Error al enviar. Intenta de nuevo.')
      }
    } catch (err) {
      console.error('Error:', err)
      alert('Error al enviar. Intenta de nuevo.')
    }

    setLoading(false)
  }

  if (!user) return null

  if (showThanks) {
    return (
      <div className="min-h-screen bg-gray-50 grid place-items-center">
        <div className="text-center">
          <div className="text-9xl mb-4">✅</div>
          <h1 className="text-5xl font-bold text-green-600 mb-3">¡Gracias!</h1>
          <p className="text-xl text-gray-700">Checklist enviado exitosamente</p>
          <p className="text-sm text-gray-500 mt-2">Redirigiendo...</p>
        </div>
      </div>
    )
  }

  const score = calculateScore()
  const totalQuestions = SECTIONS.reduce((sum, sec) => sum + sec.items.length, 0)
  const answered = Object.keys(answers).length
  
  // 🔒 Bloquear selector si es asistente
  const userScope = (user as any)?.store_scope
  const isStoreFixed = user.role === 'asistente' && Array.isArray(userScope) && userScope.length > 0

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-lg sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <button onClick={() => router.back()} className="text-2xl hover:bg-indigo-500 rounded-lg p-2">
              ←
            </button>
            <div className="text-4xl">👔</div>
            <div>
              <strong className="text-xl">Manager Checklist</strong>
              <div className="text-xs text-indigo-100">{user.name}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">{score}%</div>
            <div className="text-xs">{answered}/{totalQuestions}</div>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-900 mb-2">Sucursal *</label>
                <select required value={formData.store_id} onChange={(e) => setFormData({...formData, store_id: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500">
                  <option value="">Selecciona...</option>
                  {stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-900 mb-2">Fecha *</label>
                <input type="date" required value={formData.checklist_date}
                  onChange={(e) => setFormData({...formData, checklist_date: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-900 mb-2">Turno *</label>
                <select value={formData.shift} onChange={(e) => setFormData({...formData, shift: e.target.value as 'AM' | 'PM'})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500">
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                </select>
              </div>
            </div>
          </div>

          {SECTIONS.map((section, sIdx) => {
            const isExpanded = expandedSections.has(sIdx)
            const sectionAnswered = section.items.filter((_, iIdx) => answers[`s${sIdx}_${iIdx}`]).length
            const sectionPercent = Math.round((sectionAnswered / section.items.length) * 100)
            
            return (
              <div key={sIdx} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="flex items-center justify-between p-5 bg-gray-50 border-b border-gray-200 cursor-pointer hover:bg-gray-100"
                  onClick={() => toggleSection(sIdx)}>
                  <div>
                    <h3 className="text-lg font-bold text-indigo-600">{section.title}</h3>
                    <p className="text-sm text-gray-600">{sectionAnswered}/{section.items.length} respondidas</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="px-3 py-1 bg-indigo-100 text-indigo-800 rounded-full font-bold text-sm">{sectionPercent}%</span>
                    <span className="text-2xl">{isExpanded ? '▾' : '▸'}</span>
                  </div>
                </div>
                
                {isExpanded && (
                  <div className="p-5 space-y-3">
                    {section.items.map((item, iIdx) => {
                      const key = `s${sIdx}_${iIdx}`
                      const currentValue = answers[key]
                      
                      return (
                        <div key={iIdx} className="flex items-center justify-between gap-4 border border-gray-200 rounded-lg p-3">
                          <div className="flex-1 font-semibold text-sm">{item}</div>
                          <div className="flex gap-2">
                            {['SI', 'NO', 'NA'].map(val => (
                              <button key={val} type="button"
                                onClick={() => handleAnswer(sIdx, iIdx, val as any)}
                                className={`px-3 py-1.5 rounded-lg font-semibold text-sm transition-all ${
                                  currentValue === val
                                    ? val === 'SI' ? 'bg-green-600 text-white' : val === 'NO' ? 'bg-red-600 text-white' : 'bg-gray-600 text-white'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }`}>
                                {val === 'SI' ? 'Sí' : val}
                              </button>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}

          <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
            <label className="block text-sm font-bold text-gray-900 mb-2">Comentarios</label>
            <textarea value={formData.comments}
              onChange={(e) => setFormData({...formData, comments: e.target.value})} rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 resize-none"
              placeholder="Observaciones adicionales..." />
          </div>

          <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
            <label className="block text-sm font-bold text-gray-900 mb-2">Fotos (opcional)</label>
            <input type="file" accept="image/*" multiple onChange={handlePhotoChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            <p className="text-xs text-gray-600 mt-1">Máximo 10 fotos</p>
            {photoPreviews.length > 0 && (
              <div className="grid grid-cols-5 gap-2 mt-3">
                {photoPreviews.map((preview, i) => (
                  <img key={i} src={preview} alt={`Preview ${i + 1}`} className="w-full h-24 object-cover rounded-lg" />
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
            <div className="h-4 bg-gray-200 rounded-full overflow-hidden mb-3">
              <div className="h-full bg-gradient-to-r from-indigo-400 to-indigo-500 transition-all duration-500"
                style={{ width: `${score}%` }} />
            </div>
            <p className="text-center mb-4">
              <span className="text-3xl font-bold">{score}%</span>
              <span className="text-gray-600 ml-2">Completado ({answered}/{totalQuestions})</span>
            </p>
            <button type="submit" disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-lg py-4 rounded-xl shadow-lg transition-all disabled:opacity-50">
              {loading ? '⏳ Enviando...' : 'Enviar Checklist de Manager'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function ManagerChecklistPage() {
  return (
    <ProtectedRoute allowedRoles={['manager', 'admin']}>
      <ManagerChecklistContent />
    </ProtectedRoute>
  )
}
