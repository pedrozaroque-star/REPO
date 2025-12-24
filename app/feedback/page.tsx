'use client'

import { useEffect, useState } from 'react'
import Sidebar from '@/components/Sidebar'

export default function FeedbackPage() {
  const [stats, setStats] = useState({
    total: 0,
    promoters: 0,
    passives: 0,
    detractors: 0,
    nps: 0,
    avgService: 0,
    avgQuality: 0,
    avgCleanliness: 0,
    avgSpeed: 0
  })
  const [feedbacks, setFeedbacks] = useState([])
  const [loading, setLoading] = useState(true)
  const [storeFilter, setStoreFilter] = useState('all')
  const [stores, setStores] = useState([])

  useEffect(() => {
    fetchData()
  }, [storeFilter])

  const fetchData = async () => {
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      
      // Obtener tiendas
      const storesRes = await fetch(`${url}/rest/v1/stores?select=*`, {
        headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
      })
      const storesData = await storesRes.json()
      setStores(storesData)
      
      // Obtener feedbacks con filtro de tienda
      let feedbackUrl = `${url}/rest/v1/customer_feedback?select=*,stores(name,code)&order=submission_date.desc&limit=50`
      if (storeFilter !== 'all') {
        feedbackUrl += `&store_id=eq.${storeFilter}`
      }
      
      const feedbackRes = await fetch(feedbackUrl, {
        headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
      })
      const feedbackData = await feedbackRes.json()
      setFeedbacks(feedbackData)
      
      // Calcular estadísticas
      if (feedbackData.length > 0) {
        const promoters = feedbackData.filter(f => f.nps_category === 'promoter').length
        const passives = feedbackData.filter(f => f.nps_category === 'passive').length
        const detractors = feedbackData.filter(f => f.nps_category === 'detractor').length
        const nps = Math.round(((promoters - detractors) / feedbackData.length) * 100)
        
        const avgService = feedbackData.reduce((sum, f) => sum + (f.service_rating || 0), 0) / feedbackData.length
        const avgQuality = feedbackData.reduce((sum, f) => sum + (f.food_quality_rating || 0), 0) / feedbackData.length
        const avgCleanliness = feedbackData.reduce((sum, f) => sum + (f.cleanliness_rating || 0), 0) / feedbackData.length
        const avgSpeed = feedbackData.reduce((sum, f) => sum + (f.speed_rating || 0), 0) / feedbackData.length
        
        setStats({
          total: feedbackData.length,
          promoters,
          passives,
          detractors,
          nps,
          avgService: Math.round(avgService * 10) / 10,
          avgQuality: Math.round(avgQuality * 10) / 10,
          avgCleanliness: Math.round(avgCleanliness * 10) / 10,
          avgSpeed: Math.round(avgSpeed * 10) / 10
        })
      }
      
      setLoading(false)
    } catch (err) {
      console.error('Error:', err)
      setLoading(false)
    }
  }

  const getNPSColor = (nps: number) => {
    if (nps >= 50) return 'text-green-600'
    if (nps >= 0) return 'text-yellow-600'
    return 'text-red-600'
  }

  const getCategoryBadge = (category: string) => {
    const colors = {
      promoter: 'bg-green-100 text-green-800',
      passive: 'bg-yellow-100 text-yellow-800',
      detractor: 'bg-red-100 text-red-800'
    }
    return colors[category] || 'bg-gray-100 text-gray-800'
  }

  if (loading) {
    return (
      <div className="flex">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-6xl mb-4">💬</div>
            <p className="text-gray-600">Cargando feedback...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      
      <main className="flex-1 p-8">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-8 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Feedback de Clientes</h1>
              <p className="text-gray-600 mt-2">Encuestas de satisfacción del cliente</p>
            </div>
            <button
              onClick={() => window.location.href = '/feedback/nuevo'}
              className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg shadow-lg transition-colors"
            >
              ➕ Nuevo Feedback
            </button>
          </div>

          {/* Filter */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Filtrar por tienda
            </label>
            <select
              value={storeFilter}
              onChange={(e) => setStoreFilter(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-red-500 focus:border-transparent"
            >
              <option value="all">Todas las tiendas</option>
              {stores.map(store => (
                <option key={store.id} value={store.id}>{store.name}</option>
              ))}
            </select>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {/* NPS Score */}
            <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-blue-600">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm font-medium text-gray-600">Net Promoter Score</p>
                  <p className={`text-4xl font-bold ${getNPSColor(stats.nps)} mt-2`}>
                    {stats.nps}
                  </p>
                </div>
                <div className="text-4xl">📊</div>
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-green-600">Promoters:</span>
                  <span className="font-semibold">{stats.promoters}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-yellow-600">Passives:</span>
                  <span className="font-semibold">{stats.passives}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-red-600">Detractors:</span>
                  <span className="font-semibold">{stats.detractors}</span>
                </div>
              </div>
            </div>

            {/* Service Rating */}
            <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-green-600">
              <p className="text-sm font-medium text-gray-600 mb-2">Servicio</p>
              <div className="flex items-center space-x-2">
                <p className="text-4xl font-bold text-gray-900">{stats.avgService}</p>
                <span className="text-yellow-500 text-2xl">⭐</span>
              </div>
              <p className="text-sm text-gray-500 mt-2">de 5.0</p>
            </div>

            {/* Food Quality */}
            <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-red-600">
              <p className="text-sm font-medium text-gray-600 mb-2">Calidad de Comida</p>
              <div className="flex items-center space-x-2">
                <p className="text-4xl font-bold text-gray-900">{stats.avgQuality}</p>
                <span className="text-yellow-500 text-2xl">⭐</span>
              </div>
              <p className="text-sm text-gray-500 mt-2">de 5.0</p>
            </div>

            {/* Cleanliness */}
            <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-purple-600">
              <p className="text-sm font-medium text-gray-600 mb-2">Limpieza</p>
              <div className="flex items-center space-x-2">
                <p className="text-4xl font-bold text-gray-900">{stats.avgCleanliness}</p>
                <span className="text-yellow-500 text-2xl">⭐</span>
              </div>
              <p className="text-sm text-gray-500 mt-2">de 5.0</p>
            </div>
          </div>

          {/* Feedback List */}
          <div className="bg-white rounded-xl shadow-md">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-xl font-bold text-gray-900">
                Últimos Feedbacks ({stats.total})
              </h2>
            </div>
            <div className="divide-y divide-gray-200">
              {feedbacks.map((feedback: any) => (
                <div key={feedback.id} className="p-6 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center space-x-3 mb-2">
                        <h3 className="font-semibold text-gray-900">
                          {feedback.stores?.name || 'Sin tienda'}
                        </h3>
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getCategoryBadge(feedback.nps_category)}`}>
                          {feedback.nps_category}
                        </span>
                        {feedback.nps_score && (
                          <span className="text-sm text-gray-600">
                            NPS: {feedback.nps_score}/10
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500">
                        {new Date(feedback.submission_date).toLocaleDateString('es-MX', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </p>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-4 gap-4 mt-4">
                    <div className="text-center">
                      <p className="text-xs text-gray-500 mb-1">Servicio</p>
                      <p className="text-lg font-bold text-gray-900">{feedback.service_rating || '-'}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-gray-500 mb-1">Calidad</p>
                      <p className="text-lg font-bold text-gray-900">{feedback.food_quality_rating || '-'}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-gray-500 mb-1">Limpieza</p>
                      <p className="text-lg font-bold text-gray-900">{feedback.cleanliness_rating || '-'}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-gray-500 mb-1">Rapidez</p>
                      <p className="text-lg font-bold text-gray-900">{feedback.speed_rating || '-'}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}