'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'

export default function NuevoFeedbackPage() {
  const router = useRouter()
  const [stores, setStores] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  
  const [formData, setFormData] = useState({
    store_id: '',
    submission_date: new Date().toISOString().split('T')[0],
    nps_score: 8,
    service_rating: 5,
    food_quality_rating: 5,
    cleanliness_rating: 5,
    speed_rating: 5,
    wait_time_minutes: 10,
    customer_comments: ''
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
    setLoading(true)

    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

      // Calcular NPS category
      let nps_category = 'passive'
      if (formData.nps_score >= 9) nps_category = 'promoter'
      else if (formData.nps_score <= 6) nps_category = 'detractor'

      const payload = {
        ...formData,
        nps_category
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
        alert('✅ Feedback registrado exitosamente')
        router.push('/feedback')
      } else {
        alert('❌ Error al registrar feedback')
      }
    } catch (err) {
      console.error('Error:', err)
      alert('❌ Error al registrar feedback')
    }

    setLoading(false)
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      
      <main className="flex-1 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Nuevo Feedback de Cliente</h1>
            <p className="text-gray-600 mt-2">Registrar experiencia del cliente</p>
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
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900"
                >
                  <option value="">Seleccionar tienda</option>
                  {stores.map(store => (
                    <option key={store.id} value={store.id}>{store.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Fecha *
                </label>
                <input
                  type="date"
                  required
                  value={formData.submission_date}
                  onChange={(e) => setFormData({...formData, submission_date: e.target.value})}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900"
                />
              </div>
            </div>

            <div className="border-t pt-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Calificación NPS (0-10)</h3>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  ¿Qué tan probable es que recomiendes Tacos Gavilan?
                </label>
                <input
                  type="range"
                  min="0"
                  max="10"
                  value={formData.nps_score}
                  onChange={(e) => setFormData({...formData, nps_score: parseInt(e.target.value)})}
                  className="w-full"
                />
                <div className="flex justify-between text-sm text-gray-600 mt-2">
                  <span>0 - Nada probable</span>
                  <span className="text-2xl font-bold text-red-600">{formData.nps_score}</span>
                  <span>10 - Muy probable</span>
                </div>
              </div>
            </div>

            <div className="border-t pt-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Calificaciones por Área (1-5 estrellas)</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    ⭐ Servicio
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="5"
                    value={formData.service_rating}
                    onChange={(e) => setFormData({...formData, service_rating: parseInt(e.target.value)})}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    🌮 Calidad de Comida
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="5"
                    value={formData.food_quality_rating}
                    onChange={(e) => setFormData({...formData, food_quality_rating: parseInt(e.target.value)})}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    ✨ Limpieza
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="5"
                    value={formData.cleanliness_rating}
                    onChange={(e) => setFormData({...formData, cleanliness_rating: parseInt(e.target.value)})}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    ⚡ Velocidad
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="5"
                    value={formData.speed_rating}
                    onChange={(e) => setFormData({...formData, speed_rating: parseInt(e.target.value)})}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                ⏱️ Tiempo de Espera (minutos)
              </label>
              <input
                type="number"
                min="0"
                value={formData.wait_time_minutes}
                onChange={(e) => setFormData({...formData, wait_time_minutes: parseInt(e.target.value)})}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Comentarios del Cliente
              </label>
              <textarea
                value={formData.customer_comments}
                onChange={(e) => setFormData({...formData, customer_comments: e.target.value})}
                rows={4}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900"
                placeholder="Comentarios adicionales..."
              />
            </div>

            <div className="flex space-x-4">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition-colors disabled:bg-gray-400"
              >
                {loading ? 'Guardando...' : '✅ Registrar Feedback'}
              </button>
              <button
                type="button"
                onClick={() => router.push('/feedback')}
                className="px-6 py-3 bg-gray-300 hover:bg-gray-400 text-gray-900 font-semibold rounded-lg transition-colors"
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  )
}