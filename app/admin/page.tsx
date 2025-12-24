'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface Feedback {
  id: number
  store_id: string
  store_name?: string
  submission_date: string
  customer_name: string | null
  service_rating: number
  speed_rating: number
  food_quality_rating: number
  cleanliness_rating: number
  nps_score: number
  nps_category: string
  comments: string | null
}

interface StoreStats {
  store_id: string
  store_name: string
  avg_rating: number
  avg_nps: number
  count: number
  rank: number
  previous_rank?: number
}

export default function AdminPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [password, setPassword] = useState('')
  const [view, setView] = useState<'leaderboard' | 'historial'>('leaderboard')
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([])
  const [leaderboard, setLeaderboard] = useState<StoreStats[]>([])
  const [selectedStore, setSelectedStore] = useState<string>('all')
  const [stores, setStores] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const previousRanks = useRef<Map<string, number>>(new Map())

  // Admin password
  const ADMIN_PASSWORD = 'admin123'

  useEffect(() => {
    if (isAuthenticated) {
      fetchStores()
      fetchData()
      
      if (autoRefresh) {
        const interval = setInterval(() => {
          fetchData()
        }, 60000) // Refresh cada 60 segundos
        return () => clearInterval(interval)
      }
    }
  }, [isAuthenticated, autoRefresh])

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault()
    if (password === ADMIN_PASSWORD) {
      setIsAuthenticated(true)
    } else {
      alert('Contraseña incorrecta')
    }
  }

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

  const fetchData = async () => {
    setLoading(true)
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

      // Fetch feedbacks
      const res = await fetch(`${url}/rest/v1/customer_feedback?select=*&order=submission_date.desc`, {
        headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` }
      })
      const data = await res.json()
      
      // Fetch store names
      const storesRes = await fetch(`${url}/rest/v1/stores?select=id,name`, {
        headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` }
      })
      const storesData = await storesRes.json()
      const storeMap = new Map(storesData.map((s: any) => [s.id, s.name]))
      
      // Merge store names
      const feedbacksWithNames = data.map((f: any) => ({
        ...f,
        store_name: storeMap.get(f.store_id) || 'Unknown'
      }))
      
      setFeedbacks(feedbacksWithNames)
      
      // Calculate leaderboard
      calculateLeaderboard(feedbacksWithNames, storeMap)
      
    } catch (err) {
      console.error('Error:', err)
    }
    setLoading(false)
  }

  const calculateLeaderboard = (data: Feedback[], storeMap: Map<string, string>) => {
    const statsMap = new Map<string, { sum: number; npsSum: number; count: number }>()
    
    data.forEach(f => {
      if (!statsMap.has(f.store_id)) {
        statsMap.set(f.store_id, { sum: 0, npsSum: 0, count: 0 })
      }
      const stats = statsMap.get(f.store_id)!
      const avg = (f.service_rating + f.speed_rating + f.food_quality_rating + f.cleanliness_rating) / 4
      stats.sum += avg
      stats.npsSum += f.nps_score
      stats.count += 1
    })
    
    const leaderboardData: StoreStats[] = Array.from(statsMap.entries()).map(([store_id, stats]) => ({
      store_id,
      store_name: storeMap.get(store_id) || 'Unknown',
      avg_rating: stats.sum / stats.count,
      avg_nps: stats.npsSum / stats.count,
      count: stats.count,
      rank: 0,
      previous_rank: previousRanks.current.get(store_id)
    }))
    
    // Sort and assign ranks
    leaderboardData.sort((a, b) => {
      if (b.avg_rating !== a.avg_rating) return b.avg_rating - a.avg_rating
      return b.count - a.count
    })
    
    leaderboardData.forEach((item, index) => {
      item.rank = index + 1
      previousRanks.current.set(item.store_id, item.rank)
    })
    
    setLeaderboard(leaderboardData)
  }

  const StarDisplay = ({ rating }: { rating: number }) => (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <svg key={i} viewBox="0 0 24 24" className={`w-5 h-5 ${i <= Math.round(rating) ? 'fill-yellow-400' : 'fill-gray-300'}`}>
          <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
        </svg>
      ))}
    </div>
  )

  const getNPSColor = (category: string) => {
    switch (category) {
      case 'promoter': return 'bg-green-100 text-green-800'
      case 'passive': return 'bg-yellow-100 text-yellow-800'
      case 'detractor': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getRankChange = (item: StoreStats) => {
    if (!item.previous_rank) return null
    const change = item.previous_rank - item.rank
    if (change === 0) return null
    return change
  }

  // Login screen
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-4">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md"
        >
          <div className="text-center mb-8">
            <div className="text-6xl mb-4">🔐</div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Admin Panel</h1>
            <p className="text-gray-600">Tacos Gavilan</p>
          </div>
          
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-sm font-bold text-gray-900 mb-2">
                Contraseña
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl text-gray-900 focus:ring-2 focus:ring-red-500 focus:border-red-500"
                placeholder="Ingresa la contraseña"
                required
              />
            </div>
            
            <button
              type="submit"
              className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-xl transition-colors"
            >
              Ingresar
            </button>
          </form>
        </motion.div>
      </div>
    )
  }

  // Admin dashboard
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-gradient-to-r from-red-600 to-red-700 text-white shadow-lg sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img 
                src="/logo.png" 
                alt="Tacos Gavilan" 
                className="w-10 h-10 object-contain rounded-full bg-white p-1"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
              <div>
                <h1 className="text-2xl font-bold">Admin Panel</h1>
                <p className="text-sm text-red-100">Tacos Gavilan</p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="w-4 h-4"
                />
                Auto-refresh (60s)
              </label>
              <button
                onClick={() => setIsAuthenticated(false)}
                className="px-4 py-2 bg-red-800 hover:bg-red-900 rounded-lg text-sm font-semibold transition-colors"
              >
                Salir
              </button>
            </div>
          </div>
          
          {/* Tabs */}
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => setView('leaderboard')}
              className={`px-6 py-2 rounded-lg font-semibold transition-colors ${
                view === 'leaderboard'
                  ? 'bg-white text-red-600'
                  : 'bg-red-700 text-white hover:bg-red-800'
              }`}
            >
              🏆 Leaderboard
            </button>
            <button
              onClick={() => setView('historial')}
              className={`px-6 py-2 rounded-lg font-semibold transition-colors ${
                view === 'historial'
                  ? 'bg-white text-red-600'
                  : 'bg-red-700 text-white hover:bg-red-800'
              }`}
            >
              📋 Historial
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {loading && (
          <div className="text-center py-12">
            <div className="animate-spin text-6xl mb-4">⏳</div>
            <p className="text-gray-600">Cargando datos...</p>
          </div>
        )}

        {!loading && view === 'leaderboard' && (
          <div>
            {/* Stats overview */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
              <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
                <div className="text-3xl mb-2">📊</div>
                <div className="text-3xl font-bold text-gray-900">{feedbacks.length}</div>
                <div className="text-sm text-gray-600">Total Feedbacks</div>
              </div>
              
              <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
                <div className="text-3xl mb-2">🏪</div>
                <div className="text-3xl font-bold text-gray-900">{leaderboard.length}</div>
                <div className="text-sm text-gray-600">Tiendas Activas</div>
              </div>
              
              <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
                <div className="text-3xl mb-2">⭐</div>
                <div className="text-3xl font-bold text-gray-900">
                  {leaderboard.length > 0 ? (leaderboard.reduce((sum, s) => sum + s.avg_rating, 0) / leaderboard.length).toFixed(2) : '0'}
                </div>
                <div className="text-sm text-gray-600">Promedio General</div>
              </div>
              
              <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
                <div className="text-3xl mb-2">📈</div>
                <div className="text-3xl font-bold text-gray-900">
                  {leaderboard.length > 0 ? (leaderboard.reduce((sum, s) => sum + s.avg_nps, 0) / leaderboard.length).toFixed(1) : '0'}
                </div>
                <div className="text-sm text-gray-600">NPS Promedio</div>
              </div>
            </div>

            {/* Leaderboard */}
            <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
              <div className="bg-gradient-to-r from-yellow-400 to-yellow-500 p-6 text-center">
                <h2 className="text-3xl font-bold text-gray-900 mb-2">🏆 RANKING DE TIENDAS 🏆</h2>
                <p className="text-gray-800">Actualizado en tiempo real</p>
              </div>
              
              <div className="p-6">
                <AnimatePresence mode="popLayout">
                  {leaderboard.map((item, index) => {
                    const rankChange = getRankChange(item)
                    const isTop3 = index < 3
                    
                    return (
                      <motion.div
                        key={item.store_id}
                        layout
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        transition={{ duration: 0.3 }}
                        className={`flex items-center gap-4 p-4 rounded-xl mb-3 ${
                          isTop3 ? 'bg-gradient-to-r from-yellow-50 to-yellow-100 border-2 border-yellow-400' : 'bg-gray-50 border border-gray-200'
                        }`}
                      >
                        {/* Rank */}
                        <div className={`w-16 h-16 rounded-full flex items-center justify-center font-bold text-2xl ${
                          index === 0 ? 'bg-yellow-400 text-gray-900' :
                          index === 1 ? 'bg-gray-300 text-gray-900' :
                          index === 2 ? 'bg-orange-400 text-white' :
                          'bg-gray-200 text-gray-700'
                        }`}>
                          {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : item.rank}
                        </div>

                        {/* Store info */}
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="text-xl font-bold text-gray-900">{item.store_name}</h3>
                            {rankChange && (
                              <span className={`text-sm font-bold ${rankChange > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {rankChange > 0 ? `↑${rankChange}` : `↓${Math.abs(rankChange)}`}
                              </span>
                            )}
                          </div>
                          
                          <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2">
                              <StarDisplay rating={item.avg_rating} />
                              <span className="font-bold text-lg text-gray-900">{item.avg_rating.toFixed(2)}</span>
                            </div>
                            
                            <div className="text-sm text-gray-600">
                              NPS: <span className="font-bold text-gray-900">{item.avg_nps.toFixed(1)}</span>
                            </div>
                            
                            <div className="text-sm text-gray-600">
                              {item.count} {item.count === 1 ? 'review' : 'reviews'}
                            </div>
                          </div>
                        </div>

                        {/* Trophy for winner */}
                        {index === 0 && (
                          <div className="text-6xl animate-bounce">
                            🏆
                          </div>
                        )}
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
              </div>
            </div>
          </div>
        )}

        {!loading && view === 'historial' && (
          <div>
            {/* Filters */}
            <div className="bg-white rounded-xl shadow-sm p-6 mb-6 border border-gray-200">
              <div className="flex items-center gap-4">
                <label htmlFor="storeFilter" className="font-bold text-gray-900">
                  Filtrar por tienda:
                </label>
                <select
                  id="storeFilter"
                  value={selectedStore}
                  onChange={(e) => setSelectedStore(e.target.value)}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500"
                >
                  <option value="all">Todas las tiendas</option>
                  {stores.map(store => (
                    <option key={store.id} value={store.id}>{store.name}</option>
                  ))}
                </select>
                
                {selectedStore !== 'all' && (
                  <button
                    onClick={() => setSelectedStore('all')}
                    className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg text-sm font-semibold"
                  >
                    Limpiar filtro
                  </button>
                )}
              </div>
            </div>

            {/* Feedbacks list */}
            <div className="space-y-4">
              {feedbacks
                .filter(f => selectedStore === 'all' || f.store_id === selectedStore)
                .map(feedback => (
                  <div key={feedback.id} className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3 className="text-xl font-bold text-gray-900">{feedback.store_name}</h3>
                        {feedback.customer_name && (
                          <p className="text-gray-600">Por: {feedback.customer_name}</p>
                        )}
                      </div>
                      
                      <div className="text-right">
                        <p className="text-sm text-gray-600">
                          {new Date(feedback.submission_date).toLocaleDateString('es-MX', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </p>
                        <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold mt-2 ${getNPSColor(feedback.nps_category)}`}>
                          NPS: {feedback.nps_score} ({feedback.nps_category})
                        </span>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                      <div>
                        <p className="text-xs text-gray-600 mb-1">Servicio</p>
                        <StarDisplay rating={feedback.service_rating} />
                      </div>
                      <div>
                        <p className="text-xs text-gray-600 mb-1">Rapidez</p>
                        <StarDisplay rating={feedback.speed_rating} />
                      </div>
                      <div>
                        <p className="text-xs text-gray-600 mb-1">Calidad</p>
                        <StarDisplay rating={feedback.food_quality_rating} />
                      </div>
                      <div>
                        <p className="text-xs text-gray-600 mb-1">Limpieza</p>
                        <StarDisplay rating={feedback.cleanliness_rating} />
                      </div>
                    </div>
                    
                    {feedback.comments && (
                      <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                        <p className="text-sm font-semibold text-gray-900 mb-1">Comentarios:</p>
                        <p className="text-gray-700">{feedback.comments}</p>
                      </div>
                    )}
                  </div>
                ))}
              
              {feedbacks.filter(f => selectedStore === 'all' || f.store_id === selectedStore).length === 0 && (
                <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
                  <div className="text-6xl mb-4">📭</div>
                  <p className="text-gray-600">No hay feedbacks para mostrar</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}