'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

// --- TUS DATOS REALES (Copiados de tus archivos) ---

const DAILY_QUESTIONS = [
  'Todo el equipo alcanza la temperatura adecuada',
  'Cubeta roja de sanitizante bajo línea @ 200ppm',
  'Máquina de hielo limpia',
  'Área del trapeador limpia',
  'Microondas está limpio',
  'Estaciones de champurrado limpias',
  'Baño de empleados limpio',
  'Tanque de gas de refrescos lleno',
  'Checklists siendo usados',
  'Food Handler visible',
  'Se saluda a clientes dentro de 5 segundos',
  'Hacemos contacto visual con el cliente',
  'Ventanas limpias',
  'Baños limpios',
  'Estacionamiento limpio',
  'TVs funcionando',
  'Toda la iluminación funciona',
  'Mesas y sillas limpias',
  'Todas las luces funcionan',
  'Acero inoxidable limpio',
  'Rebanadoras y tijeras limpias',
  'Drenajes limpios',
  'Pisos y zócalos limpios',
  'Lavado de manos frecuente',
  'Área de escoba organizada',
  'Se utiliza FIFO',
  'Trapos en sanitizante',
  'Expedidor anuncia órdenes',
  'Cámaras funcionando',
  'SOS/DT Time visible',
  'Management consciente',
  'Manejo de efectivo correcto',
  'Reparaciones reportadas',
  'AC limpio'
]

const APERTURA_PROCEDURES = [
  'Desarmar alarma',
  'Encender vaporeras',
  'Encender refrigeradores',
  'Encender planchas',
  'Encender luces',
  'Revisar temperaturas',
  'Preparar estaciones',
  'Verificar inventario del día',
  'Limpiar áreas de servicio',
  'Preparar caja registradora',
  'Revisar pedidos pendientes',
  'Activar sistemas POS',
  'Verificar que todo esté listo'
]

const RECORRIDO_TASKS = [
  'Quitar publicidad y promociones vencidas',
  'Barrer todas las áreas',
  'Barrer y trapear cocinas',
  'Cambiar bolsas de basura',
  'Limpieza de baños',
  'Limpiar ventanas y puertas',
  'Limpiar mesas y sillas',
  'Organizar área de basura',
  'Limpiar refrigeradores',
  'Limpiar estufas y planchas',
  'Limpiar campanas',
  'Revisar inventario de limpieza',
  'Reportar reparaciones necesarias'
]

const TEMPERATURE_ITEMS = [
  { id: 'refrig1_papelitos_mayo', label: 'Refrig 1 - Papelitos con mayo', type: 'cold' },
  { id: 'refrig1_papelitos_no_mayo', label: 'Refrig 1 - Papelitos sin mayo', type: 'cold' },
  { id: 'refrig1_quesadillas', label: 'Refrig 1 - Quesadillas', type: 'cold' },
  { id: 'refrig2_carnes_cocinar', label: 'Refrig 2 - Carnes para cocinar', type: 'cold' },
  { id: 'refrig2_asada_pollo', label: 'Refrig 2 - Asada y pollo', type: 'cold' },
  { id: 'refrig3_queso_monterrey', label: 'Refrig 3 - Queso monterrey', type: 'cold' },
  { id: 'refrig3_queso_cotija', label: 'Refrig 3 - Queso cotija', type: 'cold' },
  { id: 'refrig4_salsas', label: 'Refrig 4 - Salsas', type: 'cold' },
  { id: 'refrig4_lechuga', label: 'Refrig 4 - Lechuga', type: 'cold' },
  { id: 'vapor1_cabeza', label: 'Vapor 1 - Cabeza', type: 'hot' },
  { id: 'vapor1_lengua', label: 'Vapor 1 - Lengua', type: 'hot' },
  { id: 'vapor2_asada', label: 'Vapor 2 - Asada', type: 'hot' },
  { id: 'vapor2_pastor', label: 'Vapor 2 - Pastor', type: 'hot' },
  { id: 'vapor3_chorizo', label: 'Vapor 3 - Chorizo', type: 'hot' },
  { id: 'vapor3_salsa_huevo', label: 'Vapor 3 - Salsa de huevo', type: 'hot' },
  { id: 'vapor4_pollo', label: 'Vapor 4 - Pollo', type: 'hot' },
  { id: 'vapor4_buche', label: 'Vapor 4 - Buche', type: 'hot' },
  { id: 'vapor5_arroz', label: 'Vapor 5 - Arroz', type: 'hot' },
  { id: 'vapor5_frijol', label: 'Vapor 5 - Frijol', type: 'hot' },
  { id: 'vapor7_chile_asado', label: 'Vapor 7 - Chile asado', type: 'hot' },
  { id: 'vapor7_frijol_entero', label: 'Vapor 7 - Frijol entero', type: 'hot' }
]

const SOBRANTE_PRODUCTS = [
  { id: 'arroz', label: 'Arroz' },
  { id: 'frijol', label: 'Frijol' },
  { id: 'asada', label: 'Asada' },
  { id: 'pastor', label: 'Pastor' },
  { id: 'pollo', label: 'Pollo' },
  { id: 'carnitas', label: 'Carnitas' },
  { id: 'buche', label: 'Buche' },
  { id: 'chorizo', label: 'Chorizo' },
  { id: 'cabeza', label: 'Cabeza' },
  { id: 'lengua', label: 'Lengua' },
  { id: 'frijoles_olla', label: 'Frijoles de olla' }
]

// --- CONFIGURACIÓN MAESTRA ---
const CHECKLIST_CONFIG: any = {
  daily: { title: '📋 Daily Checklist', color: 'blue', items: DAILY_QUESTIONS, mode: 'simple' },
  cierre: { title: '🌙 Checklist de Cierre', color: 'purple', items: DAILY_QUESTIONS, mode: 'simple' }, // Cierre usa las mismas que Daily en tu código
  apertura: { title: '🌅 Inspección de Apertura', color: 'orange', items: APERTURA_PROCEDURES, mode: 'simple' },
  recorrido: { title: '🚶 Recorrido de Limpieza', color: 'green', items: RECORRIDO_TASKS, mode: 'simple' },
  temperaturas: { title: '🌡️ Control de Temperaturas', color: 'red', items: TEMPERATURE_ITEMS, mode: 'complex_temp' },
  sobrante: { title: '📦 Producto Sobrante', color: 'yellow', items: SOBRANTE_PRODUCTS, mode: 'complex_weight' }
}

export default function ChecklistForm({ user, initialData, type = 'daily' }: { user: any, initialData?: any, type: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const config = CHECKLIST_CONFIG[type] || CHECKLIST_CONFIG['daily']

  const [formData, setFormData] = useState({
    checklist_date: initialData?.checklist_date || new Date().toISOString().split('T')[0],
    shift: initialData?.shift || 'AM',
    start_time: initialData?.start_time || new Date().toTimeString().slice(0, 5),
    end_time: initialData?.end_time || new Date().toTimeString().slice(0, 5),
    comments: initialData?.comments || '',
    answers: initialData?.answers || {} 
  })

  // Colores dinámicos
  const getColorClass = (shade: number) => {
    const colors: any = {
      blue: [`bg-blue-${shade}`, `text-blue-${shade}`, `border-blue-${shade}`],
      red: [`bg-red-${shade}`, `text-red-${shade}`, `border-red-${shade}`],
      green: [`bg-green-${shade}`, `text-green-${shade}`, `border-green-${shade}`],
      yellow: [`bg-yellow-${shade}`, `text-yellow-${shade}`, `border-yellow-${shade}`],
      purple: [`bg-purple-${shade}`, `text-purple-${shade}`, `border-purple-${shade}`],
      orange: [`bg-orange-${shade}`, `text-orange-${shade}`, `border-orange-${shade}`],
    }
    return colors[config.color] ? colors[config.color][0].replace(`-${shade}`, `-${shade}`) : `bg-gray-${shade}`
  }

  const handleAnswerChange = (key: string | number, value: any) => {
    setFormData(prev => ({
      ...prev,
      answers: { ...prev.answers, [key]: value }
    }))
  }

  const handleSubmit = async (e: any) => {
    e.preventDefault()
    setLoading(true)

    try {
      // Cálculo de Score idéntico a tus archivos originales
      const values = Object.values(formData.answers)
      let score = 0
      
      if (config.mode === 'simple') {
        const validValues = values.filter(v => v !== null)
        const siCount = validValues.filter(v => v === 'SI').length
        score = validValues.length > 0 ? Math.round((siCount / validValues.length) * 100) : 0
      } else {
        // Temperaturas y Sobrantes se basan en items capturados vs total
        const captured = values.filter(v => v !== null && v !== '' && Number(v) > 0).length
        const total = config.items.length
        score = total > 0 ? Math.round((captured / total) * 100) : 0
      }

      const payload = {
        checklist_type: type,
        user_id: user.id,
        store_id: user.store_id || null, 
        checklist_date: formData.checklist_date,
        shift: formData.shift,
        start_time: formData.start_time,
        end_time: formData.end_time,
        comments: formData.comments,
        answers: formData.answers,
        score: score,
        status: initialData ? initialData.status : 'pendiente'
      }

      if (initialData && initialData.id) {
        const { error } = await supabase
          .from('assistant_checklists')
          .update(payload)
          .eq('id', initialData.id)
        if (error) throw error
        alert('✅ Checklist actualizado')
      } else {
        const { error } = await supabase.from('assistant_checklists').insert([payload])
        if (error) throw error
        alert('✅ Checklist creado')
      }
      router.push('/checklists')
      router.refresh()
    } catch (err: any) {
      console.error(err)
      alert('❌ Error: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto animate-in fade-in duration-300">
      
      {/* HEADER */}
      <div className={`p-6 rounded-t-2xl text-white shadow-lg flex justify-between items-center ${config.color === 'yellow' ? 'bg-yellow-600' : config.color === 'orange' ? 'bg-orange-600' : config.color === 'purple' ? 'bg-purple-600' : config.color === 'green' ? 'bg-green-600' : config.color === 'red' ? 'bg-red-600' : 'bg-blue-600'}`}>
        <div>
          <h1 className="text-2xl font-bold">{config.title}</h1>
          <p className="text-sm opacity-90">{user.email}</p>
        </div>
        <div className="text-right">
          <span className="text-3xl font-bold">{Object.keys(formData.answers).length}</span>
          <span className="text-sm opacity-75">/{config.items.length}</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="bg-white p-6 rounded-b-2xl shadow-sm border-x border-b border-gray-200 space-y-6">
        
        {/* DATOS GENERALES */}
        <div className="grid grid-cols-3 gap-4 bg-gray-50 p-4 rounded-xl border border-gray-100">
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase block mb-1">Fecha</label>
            <input type="date" value={formData.checklist_date} onChange={e => setFormData({...formData, checklist_date: e.target.value})} className="w-full bg-transparent font-bold text-gray-800 outline-none" />
          </div>
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase block mb-1">Turno</label>
            <select value={formData.shift} onChange={e => setFormData({...formData, shift: e.target.value})} className="w-full bg-transparent font-bold text-gray-800 outline-none">
              <option value="AM">☀️ Mañana (AM)</option>
              <option value="PM">🌙 Tarde (PM)</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase block mb-1">Hora</label>
            <input type="time" value={formData.start_time} onChange={e => setFormData({...formData, start_time: e.target.value})} className="w-full bg-transparent font-bold text-gray-800 outline-none" />
          </div>
        </div>

        {/* LISTA DE PREGUNTAS (LÓGICA ADAPTATIVA) */}
        <div className="space-y-2">
          {config.items.map((item: any, idx: number) => {
            // Clave: índice numérico para 'simple', ID de texto para 'complex'
            const key = config.mode === 'simple' ? idx : item.id
            const val = formData.answers[key]

            return (
              <div key={key} className="flex flex-col md:flex-row md:items-center justify-between p-3 border-b border-gray-100 hover:bg-gray-50 transition-colors gap-3">
                <div className="flex-1">
                  <span className="text-xs font-bold text-gray-400 mr-2">#{idx + 1}</span>
                  <span className="text-sm font-medium text-gray-800">
                    {typeof item === 'string' ? item : item.label}
                  </span>
                </div>

                {/* MODALIDAD SIMPLE (SI/NO/NA) */}
                {config.mode === 'simple' && (
                  <div className="flex gap-1">
                    {['SI', 'NO', 'NA'].map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => handleAnswerChange(key, opt)}
                        className={`px-3 py-1.5 text-xs font-bold rounded transition-all ${
                          val === opt 
                            ? opt === 'SI' ? 'bg-green-600 text-white' : opt === 'NO' ? 'bg-red-600 text-white' : 'bg-gray-600 text-white'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                )}

                {/* MODALIDAD COMPLEJA (INPUTS NUMÉRICOS) */}
                {config.mode.includes('complex') && (
                  <div className="flex items-center gap-2">
                    <input 
                      type="number" 
                      step="0.1" 
                      placeholder="0"
                      value={val || ''}
                      onChange={(e) => handleAnswerChange(key, e.target.value)}
                      className={`w-20 text-center font-bold text-lg border rounded px-2 py-1 outline-none focus:ring-2 ${
                        config.mode === 'complex_temp' && val && (
                          (item.type === 'cold' && (val < 34 || val > 41)) || 
                          (item.type === 'hot' && val < 165)
                        ) ? 'border-red-500 text-red-600 focus:ring-red-200' : 'border-gray-300 focus:ring-blue-200'
                      }`}
                    />
                    <span className="text-xs font-bold text-gray-400 w-6">
                      {config.mode === 'complex_temp' ? '°F' : 'Lb'}
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* FOOTER */}
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-2">Comentarios</label>
          <textarea 
            value={formData.comments} 
            onChange={e => setFormData({...formData, comments: e.target.value})} 
            rows={3} 
            className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-gray-400 outline-none resize-none bg-gray-50" 
            placeholder="..." 
          />
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
          <button type="button" onClick={() => router.back()} className="px-6 py-2.5 font-bold text-gray-500 hover:bg-gray-100 rounded-lg">Cancelar</button>
          <button 
            type="submit" 
            disabled={loading} 
            className={`px-8 py-2.5 font-bold text-white rounded-lg shadow-md transition-all ${config.color === 'yellow' ? 'bg-yellow-600 hover:bg-yellow-700' : config.color === 'orange' ? 'bg-orange-600 hover:bg-orange-700' : config.color === 'purple' ? 'bg-purple-600 hover:bg-purple-700' : config.color === 'green' ? 'bg-green-600 hover:bg-green-700' : config.color === 'red' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {loading ? 'Guardando...' : 'Guardar'}
          </button>
        </div>

      </form>
    </div>
  )
}