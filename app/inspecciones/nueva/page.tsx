'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'

function NuevaInspeccionContent() {
  const router = useRouter()
  const { user } = useAuth()
  const [stores, setStores] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  
  const [formData, setFormData] = useState({
    store_id: '',
    inspection_date: new Date().toISOString().split('T')[0],
    shift: 'AM',
    servicio_score: 100,
    carnes_score: 100,
    alimentos_score: 100,
    tortillas_score: 100,
    limpieza_score: 100,
    bitacoras_score: 100,
    aseo_score: 100,
    observaciones: ''
  })

  useEffect(() => {
    fetchStores()
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
    
    if (!user) {
      alert('Error: Usuario no identificado')
      return
    }

    setLoading(true)

    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

      const overall_score = Math.round((
        formData.servicio_score +
        formData.carnes_score +
        formData.alimentos_score +
        formData.tortillas_score +
        formData.limpieza_score +
        formData.bitacoras_score +
        formData.aseo_score
      ) / 7)

      const payload = {
  store_id: parseInt(formData.store_id),
  inspector_id: user.id,  // ← CORREGIDO (era user_id)
  supervisor_name: user.name || user.email,
  inspection_date: formData.inspection_date,
  shift: formData.shift,
  overall_score: overall_score,
  servicio_score: formData.servicio_score,
  carnes_score: formData.carnes_score,
  alimentos_score: formData.alimentos_score,
  tortillas_score: formData.tortillas_score,
  limpieza_score: formData.limpieza_score,
  bitacoras_score: formData.bitacoras_score,
  aseo_score: formData.aseo_score,
  observaciones: formData.observaciones || null
}

      console.log('Payload:', payload)

      const res = await fetch(`${url}/rest/v1/supervisor_inspections`, {
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
        alert('✅ Inspección creada exitosamente')
        router.push('/inspecciones')
      } else {
        const error = await res.text()
        console.error('Error response:', error)
        alert('❌ Error al crear inspección')
      }
    } catch (err) {
      console.error('Error:', err)
      alert('❌ Error al crear inspección')
    }

    setLoading(false)
  }

  if (!user) return null

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      
      <main className="flex-1 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <button
              onClick={() => router.push('/inspecciones')}
              className="text-blue-600 hover:text-blue-800 mb-4 font-semibold">
              ← Volver a Inspecciones
            </button>
            <h1 className="text-3xl font-bold text-gray-900">Nueva Inspección</h1>
            <p className="text-gray-600 mt-2">Registrar inspección de supervisor</p>
          </div>

          <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-md p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Tienda *
                </label>
                <select
                  required
                  value={formData.store_id}
                  onChange={(e) => setFormData({...formData, store_id: e.target.value})}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                >
                  <option value="">Seleccionar tienda</option>
                  {stores.map(store => (
                    <option key={store.id} value={store.id}>{store.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Supervisor
                </label>
                <input
                  type="text"
                  value={user.name || user.email}
                  disabled
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900 bg-gray-100"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Fecha *
                </label>
                <input
                  type="date"
                  required
                  value={formData.inspection_date}
                  onChange={(e) => setFormData({...formData, inspection_date: e.target.value})}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Turno *
                </label>
                <select
                  value={formData.shift}
                  onChange={(e) => setFormData({...formData, shift: e.target.value})}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                >
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                </select>
              </div>
            </div>

            <div className="border-t pt-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Evaluación por Áreas (0-100)</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    🤝 Servicio
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={formData.servicio_score}
                    onChange={(e) => setFormData({...formData, servicio_score: parseInt(e.target.value) || 0})}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    🥩 Carnes
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={formData.carnes_score}
                    onChange={(e) => setFormData({...formData, carnes_score: parseInt(e.target.value) || 0})}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    🌮 Alimentos
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={formData.alimentos_score}
                    onChange={(e) => setFormData({...formData, alimentos_score: parseInt(e.target.value) || 0})}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    🫓 Tortillas
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={formData.tortillas_score}
                    onChange={(e) => setFormData({...formData, tortillas_score: parseInt(e.target.value) || 0})}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    ✨ Limpieza
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={formData.limpieza_score}
                    onChange={(e) => setFormData({...formData, limpieza_score: parseInt(e.target.value) || 0})}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    📝 Bitácoras
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={formData.bitacoras_score}
                    onChange={(e) => setFormData({...formData, bitacoras_score: parseInt(e.target.value) || 0})}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    🧼 Aseo
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={formData.aseo_score}
                    onChange={(e) => setFormData({...formData, aseo_score: parseInt(e.target.value) || 0})}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Observaciones
              </label>
              <textarea
                value={formData.observaciones}
                onChange={(e) => setFormData({...formData, observaciones: e.target.value})}
                rows={4}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                placeholder="Comentarios adicionales..."
              />
            </div>

            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => router.push('/inspecciones')}
                className="flex-1 bg-gray-600 hover:bg-gray-700 text-white py-3 rounded-lg font-semibold transition-all">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-lg font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                {loading ? 'Guardando...' : '✅ Crear Inspección'}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  )
}

export default function NuevaInspeccionPage() {
  return (
    <ProtectedRoute>
      <NuevaInspeccionContent />
    </ProtectedRoute>
  )
}