// components/checklists/DailyForm.tsx
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function DailyForm({ user, initialData }: { user: any, initialData?: any }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  // Estado del Formulario (Si es editar, carga los datos. Si es nuevo, pone defaults)
  const [formData, setFormData] = useState({
    checklist_date: initialData?.checklist_date || new Date().toISOString().split('T')[0],
    shift: initialData?.shift || 'matutino',
    start_time: initialData?.start_time || '09:00',
    end_time: initialData?.end_time || '17:00',
    comments: initialData?.comments || '',
    // Las respuestas (JSON)
    answers: initialData?.answers || {
      uniforme_completo: false,
      area_limpia: false,
      equipos_encendidos: false,
      caja_lista: false,
      inventario_rapido: false
    }
  })

  // Manejo de Inputs Normales
  const handleChange = (e: any) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  // Manejo de Checkboxes (Respuestas)
  const handleCheck = (key: string) => {
    setFormData(prev => ({
      ...prev,
      answers: {
        ...prev.answers,
        [key]: !prev.answers[key]
      }
    }))
  }

  const handleSubmit = async (e: any) => {
    e.preventDefault()
    setLoading(true)

    try {
      // 1. Calcular Score (Ejemplo simple: % de checks marcados)
      const totalChecks = Object.keys(formData.answers).length
      const trueChecks = Object.values(formData.answers).filter(Boolean).length
      const score = Math.round((trueChecks / totalChecks) * 100)

      const payload = {
        checklist_type: 'daily',
        user_id: user.id,
        store_id: user.store_id || null, // Asume tienda del usuario
        checklist_date: formData.checklist_date,
        shift: formData.shift,
        start_time: formData.start_time,
        end_time: formData.end_time,
        comments: formData.comments,
        answers: formData.answers,
        score: score,
        status: 'pendiente' // Siempre nace pendiente
      }

      if (initialData) {
        // --- MODO EDICIÓN (UPDATE) ---
        const { error } = await supabase
          .from('assistant_checklists')
          .update(payload)
          .eq('id', initialData.id)

        if (error) throw error
        alert('✅ Checklist actualizado correctamente')
      } else {
        // --- MODO CREACIÓN (INSERT) ---
        const { error } = await supabase
          .from('assistant_checklists')
          .insert([payload])

        if (error) throw error
        alert('✅ Checklist creado correctamente')
      }

      router.push('/checklists')
      router.refresh()

    } catch (err: any) {
      console.error(err)
      alert('❌ Error al guardar: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      
      {/* 1. Datos Generales */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-1">Fecha</label>
          <input
            type="date"
            name="checklist_date"
            value={formData.checklist_date}
            onChange={handleChange}
            className="w-full border p-2 rounded-lg"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-1">Turno</label>
          <select
            name="shift"
            value={formData.shift}
            onChange={handleChange}
            className="w-full border p-2 rounded-lg"
          >
            <option value="matutino">☀️ Matutino</option>
            <option value="vespertino">🌙 Vespertino</option>
            <option value="mixto">🌗 Mixto</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-1">Hora Inicio</label>
          <input
            type="time"
            name="start_time"
            value={formData.start_time}
            onChange={handleChange}
            className="w-full border p-2 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-1">Hora Fin</label>
          <input
            type="time"
            name="end_time"
            value={formData.end_time}
            onChange={handleChange}
            className="w-full border p-2 rounded-lg"
          />
        </div>
      </div>

      {/* 2. Preguntas del Checklist (Aquí pones tus preguntas reales) */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
        <h3 className="font-bold text-lg mb-4 text-gray-800">📋 Puntos a Revisar</h3>
        <div className="space-y-3">
          {[
            { key: 'uniforme_completo', label: '1. Porto mi uniforme completo y limpio' },
            { key: 'area_limpia', label: '2. Mi área de trabajo está limpia y ordenada' },
            { key: 'equipos_encendidos', label: '3. Equipos encendidos y funcionando' },
            { key: 'caja_lista', label: '4. Caja con cambio suficiente (si aplica)' },
            { key: 'inventario_rapido', label: '5. Inventario rápido realizado' }
          ].map((item) => (
            <label key={item.key} className="flex items-center gap-3 p-3 hover:bg-gray-50 rounded-lg cursor-pointer border border-transparent hover:border-gray-100 transition-all">
              <input
                type="checkbox"
                checked={formData.answers[item.key as keyof typeof formData.answers]}
                onChange={() => handleCheck(item.key)}
                className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
              />
              <span className="text-gray-700 font-medium">{item.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* 3. Comentarios y Botón */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
        <label className="block text-sm font-bold text-gray-700 mb-2">Comentarios / Incidencias</label>
        <textarea
          name="comments"
          value={formData.comments}
          onChange={handleChange}
          rows={3}
          className="w-full border p-3 rounded-lg"
          placeholder="Escribe aquí cualquier observación..."
        />
        
        <div className="mt-6 flex justify-end">
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-xl shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
          >
            {loading ? 'Guardando...' : initialData ? '💾 Guardar Cambios' : '🚀 Enviar Checklist'}
          </button>
        </div>
      </div>
    </form>
  )
}