'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

// --- CONFIGURACIÓN REAL EXTRAÍDA DE TUS ARCHIVOS ---

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

const QUESTIONS_CONFIG: any = {
  // 1. DAILY (Claves numéricas "0", "1"...)
  daily: {
    title: '📋 Daily Checklist',
    color: 'blue',
    items: DAILY_QUESTIONS.map((label, i) => ({ 
      key: i.toString(), 
      label, 
      type: 'options' // Usa SI/NO/NA
    }))
  },
  
  // 2. CIERRE (Claves numéricas, mismas preguntas que Daily según tu código actual)
  cierre: {
    title: '🌙 Checklist de Cierre',
    color: 'purple',
    items: DAILY_QUESTIONS.map((label, i) => ({ 
      key: i.toString(), 
      label, 
      type: 'options'
    }))
  },

  // 3. APERTURA (Claves numéricas)
  apertura: {
    title: '🌅 Inspección de Apertura',
    color: 'orange',
    items: APERTURA_PROCEDURES.map((label, i) => ({ 
      key: i.toString(), 
      label, 
      type: 'options'
    }))
  },

  // 4. RECORRIDO (Claves numéricas)
  recorrido: {
    title: '🚶 Recorrido de Limpieza',
    color: 'green',
    items: RECORRIDO_TASKS.map((label, i) => ({ 
      key: i.toString(), 
      label, 
      type: 'options'
    }))
  },

  // 5. TEMPERATURAS (Claves de texto específicas)
  temperaturas: {
    title: '🌡️ Control de Temperaturas',
    color: 'red',
    items: [
      { key: 'refrig1_papelitos_mayo', label: 'Refrig 1 - Papelitos con mayo', type: 'number_temp', subtype: 'cold' },
      { key: 'refrig1_papelitos_no_mayo', label: 'Refrig 1 - Papelitos sin mayo', type: 'number_temp', subtype: 'cold' },
      { key: 'refrig1_quesadillas', label: 'Refrig 1 - Quesadillas', type: 'number_temp', subtype: 'cold' },
      { key: 'refrig2_carnes_cocinar', label: 'Refrig 2 - Carnes para cocinar', type: 'number_temp', subtype: 'cold' },
      { key: 'refrig2_asada_pollo', label: 'Refrig 2 - Asada y pollo', type: 'number_temp', subtype: 'cold' },
      { key: 'refrig3_queso_monterrey', label: 'Refrig 3 - Queso monterrey', type: 'number_temp', subtype: 'cold' },
      { key: 'refrig3_queso_cotija', label: 'Refrig 3 - Queso cotija', type: 'number_temp', subtype: 'cold' },
      { key: 'refrig4_salsas', label: 'Refrig 4 - Salsas', type: 'number_temp', subtype: 'cold' },
      { key: 'refrig4_lechuga', label: 'Refrig 4 - Lechuga', type: 'number_temp', subtype: 'cold' },
      { key: 'vapor1_cabeza', label: 'Vapor 1 - Cabeza', type: 'number_temp', subtype: 'hot' },
      { key: 'vapor1_lengua', label: 'Vapor 1 - Lengua', type: 'number_temp', subtype: 'hot' },
      { key: 'vapor2_asada', label: 'Vapor 2 - Asada', type: 'number_temp', subtype: 'hot' },
      { key: 'vapor2_pastor', label: 'Vapor 2 - Pastor', type: 'number_temp', subtype: 'hot' },
      { key: 'vapor3_chorizo', label: 'Vapor 3 - Chorizo', type: 'number_temp', subtype: 'hot' },
      { key: 'vapor3_salsa_huevo', label: 'Vapor 3 - Salsa de huevo', type: 'number_temp', subtype: 'hot' },
      { key: 'vapor4_pollo', label: 'Vapor 4 - Pollo', type: 'number_temp', subtype: 'hot' },
      { key: 'vapor4_buche', label: 'Vapor 4 - Buche', type: 'number_temp', subtype: 'hot' },
      { key: 'vapor5_arroz', label: 'Vapor 5 - Arroz', type: 'number_temp', subtype: 'hot' },
      { key: 'vapor5_frijol', label: 'Vapor 5 - Frijol', type: 'number_temp', subtype: 'hot' },
      { key: 'vapor7_chile_asado', label: 'Vapor 7 - Chile asado', type: 'number_temp', subtype: 'hot' },
      { key: 'vapor7_frijol_entero', label: 'Vapor 7 - Frijol entero', type: 'number_temp', subtype: 'hot' }
    ]
  },

  // 6. SOBRANTE (Claves de texto específicas)
  sobrante: {
    title: '📦 Producto Sobrante',
    color: 'yellow',
    items: [
      { key: 'arroz', label: 'Arroz', type: 'number_weight' },
      { key: 'frijol', label: 'Frijol', type: 'number_weight' },
      { key: 'asada', label: 'Asada', type: 'number_weight' },
      { key: 'pastor', label: 'Pastor', type: 'number_weight' },
      { key: 'pollo', label: 'Pollo', type: 'number_weight' },
      { key: 'carnitas', label: 'Carnitas', type: 'number_weight' },
      { key: 'buche', label: 'Buche', type: 'number_weight' },
      { key: 'chorizo', label: 'Chorizo', type: 'number_weight' },
      { key: 'cabeza', label: 'Cabeza', type: 'number_weight' },
      { key: 'lengua', label: 'Lengua', type: 'number_weight' },
      { key: 'frijoles_olla', label: 'Frijoles de olla', type: 'number_weight' }
    ]
  }
}

export default function ChecklistForm({ user, initialData, type = 'daily' }: { user: any, initialData?: any, type: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const config = QUESTIONS_CONFIG[type] || QUESTIONS_CONFIG['daily']

  const [formData, setFormData] = useState({
    checklist_date: initialData?.checklist_date || new Date().toISOString().split('T')[0],
    shift: initialData?.shift || 'AM',
    start_time: initialData?.start_time || new Date().toTimeString().slice(0, 5),
    comments: initialData?.comments || '',
    answers: initialData?.answers || {} 
  })

  // Theme Helpers
  const getColorClasses = (color: string) => {
    const map: any = {
      blue: 'bg-blue-600', red: 'bg-red-600', green: 'bg-green-600',
      yellow: 'bg-yellow-600', purple: 'bg-purple-600', orange: 'bg-orange-600',
    }
    return map[color] || 'bg-blue-600'
  }
  const headerColor = getColorClasses(config.color)

  const handleAnswerChange = (key: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      answers: { ...prev.answers, [key]: value }
    }))
  }

  const handleSubmit = async (e: any) => {
    e.preventDefault()
    setLoading(true)

    try {
      // Cálculo de Score (Simplificado para consistencia)
      const answers = Object.values(formData.answers)
      const total = config.items.length
      let valid = 0
      
      // Lógica de score según tipo
      if (type === 'temperaturas') {
         // Lógica compleja de temperaturas se puede refinar aquí si es necesario
         // Por ahora contamos campos llenos para edición simple
         valid = answers.filter(v => v !== null && v !== '').length
      } else if (type === 'sobrante') {
         valid = answers.filter(v => v !== null && v !== '').length
      } else {
         // Para SI/NO/NA
         valid = answers.filter(v => v === 'SI').length
      }
      
      const score = total > 0 ? Math.round((valid / total) * 100) : 0

      const payload = {
        checklist_type: type,
        user_id: user.id,
        store_id: user.store_id || null, // Asumiendo que el usuario tiene store_id
        checklist_date: formData.checklist_date,
        shift: formData.shift,
        start_time: formData.start_time,
        // end_time se calcula al guardar en backend o se mantiene el actual
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
        alert('✅ Actualizado correctamente')
      } else {
        const { error } = await supabase.from('assistant_checklists').insert([payload])
        if (error) throw error
        alert('✅ Creado correctamente')
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
    <div className="max-w-4xl mx-auto">
      {/* HEADER */}
      <div className={`${headerColor} text-white p-6 rounded-t-2xl shadow-lg sticky top-0 z-30 flex justify-between items-center`}>
        <div className="flex items-center gap-4">
          <div className="text-4xl bg-white/20 p-2 rounded-xl">📋</div>
          <div>
            <h1 className="text-2xl font-bold">{config.title}</h1>
            <p className="text-sm opacity-90">{user.email}</p>
          </div>
        </div>
        <div className="text-right hidden md:block">
           <p className="text-3xl font-bold">{Object.keys(formData.answers).length}/{config.items.length}</p>
           <p className="text-xs uppercase tracking-widest">Completado</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="bg-white p-6 rounded-b-2xl shadow-sm border-x border-b border-gray-200 space-y-8">
        
        {/* METADATA */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-6 bg-gray-50 rounded-xl border border-gray-100">
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Fecha</label>
            <input type="date" value={formData.checklist_date} onChange={e => setFormData({...formData, checklist_date: e.target.value})} className="w-full font-bold bg-transparent outline-none text-gray-900" />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Turno</label>
            <select value={formData.shift} onChange={e => setFormData({...formData, shift: e.target.value})} className="w-full font-bold bg-transparent outline-none text-gray-900 cursor-pointer">
              <option value="AM">☀️ Mañana (AM)</option>
              <option value="PM">🌙 Tarde (PM)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Hora Inicio</label>
            <input type="time" value={formData.start_time} onChange={e => setFormData({...formData, start_time: e.target.value})} className="w-full font-bold bg-transparent outline-none text-gray-900" />
          </div>
        </div>

        {/* ITEMS LIST */}
        <div className="space-y-4">
          {config.items.map((item: any, idx: number) => {
            const val = formData.answers[item.key]
            
            return (
              <div key={item.key} className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 border border-gray-100 rounded-xl hover:bg-gray-50 transition-colors">
                <div className="flex-1">
                  <span className="text-xs font-bold text-gray-400 mr-2">#{idx + 1}</span>
                  <span className="font-medium text-gray-800">{item.label}</span>
                </div>

                <div className="flex-shrink-0">
                  {/* TIPO: BOTONES SI / NO / NA */}
                  {item.type === 'options' && (
                    <div className="flex bg-gray-100 rounded-lg p-1">
                      {['SI', 'NO', 'NA'].map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => handleAnswerChange(item.key, opt)}
                          className={`px-4 py-2 text-xs font-bold rounded-md transition-all ${
                            val === opt 
                              ? opt === 'SI' ? 'bg-green-500 text-white shadow-md' 
                              : opt === 'NO' ? 'bg-red-500 text-white shadow-md'
                              : 'bg-gray-500 text-white shadow-md'
                              : 'text-gray-500 hover:bg-white'
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* TIPO: TEMPERATURA */}
                  {item.type === 'number_temp' && (
                    <div className="flex items-center gap-2">
                      <input 
                        type="number" 
                        step="0.1" 
                        placeholder="0"
                        value={val || ''}
                        onChange={(e) => handleAnswerChange(item.key, parseFloat(e.target.value))}
                        className={`w-24 text-center font-bold text-lg border-b-2 outline-none bg-transparent ${
                          // Validación visual simple
                          val && ((item.subtype === 'cold' && (val < 34 || val > 41)) || (item.subtype === 'hot' && val < 165))
                            ? 'border-red-500 text-red-600' 
                            : 'border-gray-300 text-gray-900'
                        }`}
                      />
                      <span className="text-xs font-bold text-gray-400">°F</span>
                    </div>
                  )}

                  {/* TIPO: PESO (Libras) */}
                  {item.type === 'number_weight' && (
                    <div className="flex items-center gap-2">
                      <input 
                        type="number" 
                        step="0.1" 
                        placeholder="0"
                        value={val || ''}
                        onChange={(e) => handleAnswerChange(item.key, parseFloat(e.target.value))}
                        className="w-24 text-center font-bold text-lg border-b-2 border-gray-300 outline-none bg-transparent focus:border-yellow-500"
                      />
                      <span className="text-xs font-bold text-gray-400">Lb</span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* COMENTARIOS */}
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-2">Comentarios Adicionales</label>
          <textarea
            value={formData.comments}
            onChange={e => setFormData({...formData, comments: e.target.value})}
            rows={4}
            className="w-full p-4 border border-gray-200 rounded-xl focus:ring-2 focus:ring-gray-900 outline-none resize-none bg-gray-50"
            placeholder="Escribe aquí cualquier observación..."
          />
        </div>

        {/* ACTIONS */}
        <div className="flex justify-end gap-4 pt-4 border-t border-gray-100">
          <button type="button" onClick={() => router.back()} className="px-6 py-3 font-bold text-gray-500 hover:bg-gray-100 rounded-xl transition-colors">
            Cancelar
          </button>
          <button 
            type="submit" 
            disabled={loading}
            className={`px-8 py-3 font-bold text-white rounded-xl shadow-lg hover:shadow-xl transition-all disabled:opacity-50 ${headerColor}`}
          >
            {loading ? 'Guardando...' : 'Guardar Cambios'}
          </button>
        </div>

      </form>
    </div>
  )
}