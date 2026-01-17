'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Lock as LockIcon, ShieldCheck, Trophy, ClipboardList, LogOut, RefreshCw, Store as StoreIcon, Star, Heart, Filter, Search } from 'lucide-react'
import { formatDateLA } from '@/lib/checklistPermissions'
import SurpriseLoader from '@/components/SurpriseLoader'

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
      const storeMap = new Map<string, string>(
        storesData.map((s: any) => [String(s.id), String(s.name)])
      )

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
          <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
        </svg>
      ))}
    </div>
  )

  const getNPSColor = (category: string) => {
    switch (category) {
      case 'promoter': return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400 border-green-200 dark:border-green-900/50'
      case 'passive': return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400 border-yellow-200 dark:border-yellow-900/50'
      case 'detractor': return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400 border-red-200 dark:border-red-900/50'
      default: return 'bg-gray-100 dark:bg-slate-800 text-gray-800 dark:text-slate-400 border-gray-200 dark:border-slate-700'
    }
  }

  const getRankChange = (item: StoreStats) => {
    if (!item.previous_rank) return null
    const change = item.previous_rank - item.rank
    if (change === 0) return null
    return change
  }

  // --- DISEÑO ACTUALIZADO ADMIN DASHBOARD ---

  // Login screen
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-neutral-900 flex items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute inset-0 opacity-40 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>

        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl p-8 w-full max-w-md border border-gray-100 dark:border-slate-800 relative z-10"
        >
          <div className="text-center mb-8">
            <div className="w-20 h-20 bg-red-50 dark:bg-red-900/20 rounded-full flex items-center justify-center mx-auto mb-4 text-red-600 dark:text-red-400">
              <LockIcon size={40} />
            </div>
            <h1 className="text-2xl font-black text-gray-900 dark:text-white mb-1">Admin Panel</h1>
            <p className="text-gray-500 dark:text-slate-400 font-medium tracking-tight">Acceso Restringido</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label htmlFor="password" className="block text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-[0.2em] mb-3">
                Contraseña
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3.5 bg-gray-50 dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-2xl text-gray-900 dark:text-white font-bold focus:ring-4 focus:ring-red-500/10 focus:border-red-500 outline-none transition-all"
                placeholder="••••••••"
                required
              />
            </div>

            <button
              type="submit"
              className="w-full bg-gray-900 dark:bg-slate-100 dark:text-slate-900 text-white font-black py-4 rounded-2xl transition-all active:scale-[0.98] shadow-xl shadow-gray-200 dark:shadow-none uppercase tracking-widest"
            >
              INGRESAR
            </button>
          </form>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="bg-transparent dark:bg-neutral-900 h-screen overflow-hidden font-sans pt-20 lg:pt-0 relative">
      <div className="absolute inset-0 opacity-10 dark:opacity-40 pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>

      {/* STICKY HEADER - Mobile & Desktop */}
      <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-gray-200 dark:border-slate-800 shadow-sm sticky top-14 lg:top-0 z-20 shrink-0 transition-all">
        <div className="max-w-7xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between gap-4">
          {/* Title Area */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-600 dark:text-red-400">
              <ShieldCheck size={18} />
            </div>
            <div>
              <h1 className="text-lg md:text-xl font-black text-gray-900 dark:text-white tracking-tight leading-none">Admin Panel</h1>
              <p className="hidden md:block text-[10px] text-gray-400 dark:text-slate-500 font-bold uppercase tracking-wider">Tacos Gavilan</p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <div className="flex bg-gray-100 dark:bg-slate-800 rounded-full p-1">
              <button
                onClick={() => setView('leaderboard')}
                className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${view === 'leaderboard' ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:text-slate-500'
                  }`}
              >
                <Trophy size={14} className="inline mr-1 -mt-0.5" />
                RANKING
              </button>
              <button
                onClick={() => setView('historial')}
                className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${view === 'historial' ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:text-slate-500'
                  }`}
              >
                <ClipboardList size={14} className="inline mr-1 -mt-0.5" />
                HISTORIAL
              </button>
            </div>

            <div className="h-6 w-px bg-gray-200 dark:bg-slate-800 mx-1 hidden md:block"></div>

            <label className="hidden md:flex items-center gap-2 cursor-pointer bg-gray-50 dark:bg-slate-800/50 hover:bg-gray-100 dark:hover:bg-slate-800 px-3 py-1.5 rounded-full border border-gray-200 dark:border-slate-700 transition-colors">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="w-3 h-3 text-red-600 rounded focus:ring-red-500 border-gray-300 dark:border-slate-600"
              />
              <span className="text-[10px] font-black text-gray-600 dark:text-slate-400 uppercase tracking-widest">Auto (60s)</span>
            </label>

            <button
              onClick={() => setIsAuthenticated(false)}
              className="w-8 h-8 rounded-full bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400 hover:bg-red-50 dark:hover:bg-red-900/40 hover:text-red-600 dark:hover:text-red-400 flex items-center justify-center transition-colors border border-transparent dark:border-slate-700"
              title="Cerrar Sesión"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-8 py-8 pb-24">
        {loading && (
          <div className="py-20 flex justify-center scale-75">
            <SurpriseLoader />
          </div>
        )}

        {!loading && view === 'leaderboard' && (
          <div className="animate-in fade-in zoom-in duration-300">
            {/* Stats overview */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6 mb-8 text-center md:text-left">
              <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm p-4 border border-gray-100 dark:border-slate-800">
                <div className="flex items-center justify-center md:justify-start gap-2 mb-2 text-gray-400 dark:text-slate-500">
                  <ClipboardList size={16} />
                  <span className="text-[10px] uppercase font-black tracking-widest">Total Feedbacks</span>
                </div>
                <div className="text-2xl md:text-3xl font-black text-gray-900 dark:text-white">{feedbacks.length}</div>
              </div>

              <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm p-4 border border-gray-100 dark:border-slate-800">
                <div className="flex items-center justify-center md:justify-start gap-2 mb-2 text-gray-400 dark:text-slate-500">
                  <StoreIcon size={16} />
                  <span className="text-[10px] uppercase font-black tracking-widest">Tiendas Activas</span>
                </div>
                <div className="text-2xl md:text-3xl font-black text-gray-900 dark:text-white">{leaderboard.length}</div>
              </div>

              <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm p-4 border border-gray-100 dark:border-slate-800">
                <div className="flex items-center justify-center md:justify-start gap-2 mb-2 text-yellow-500 dark:text-yellow-400">
                  <Star size={16} fill="currentColor" />
                  <span className="text-[10px] uppercase font-black tracking-widest text-gray-400 dark:text-slate-500">Promedio Gral.</span>
                </div>
                <div className="text-2xl md:text-3xl font-black text-gray-900 dark:text-white">
                  {leaderboard.length > 0 ? (leaderboard.reduce((sum, s) => sum + s.avg_rating, 0) / leaderboard.length).toFixed(2) : '0'}
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm p-4 border border-gray-100 dark:border-slate-800">
                <div className="flex items-center justify-center md:justify-start gap-2 mb-2 text-indigo-500 dark:text-indigo-400">
                  <Heart size={16} fill="currentColor" />
                  <span className="text-[10px] uppercase font-black tracking-widest text-gray-400 dark:text-slate-500">NPS Promedio</span>
                </div>
                <div className="text-2xl md:text-3xl font-black text-gray-900 dark:text-white">
                  {leaderboard.length > 0 ? (leaderboard.reduce((sum, s) => sum + s.avg_nps, 0) / leaderboard.length).toFixed(1) : '0'}
                </div>
              </div>
            </div>

            {/* Leaderboard Heading */}
            <div className="text-center mb-8">
              <span className="inline-block px-4 py-1.5 rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400 text-[10px] font-black uppercase tracking-widest mb-3 border border-yellow-200 dark:border-yellow-900/50">
                En tiempo real
              </span>
              <h2 className="text-3xl md:text-4xl font-black text-gray-900 dark:text-white tracking-tighter">Ranking de Sucursales</h2>
            </div>

            <div className="max-w-4xl mx-auto space-y-4">
              <AnimatePresence mode="popLayout">
                {leaderboard.map((item, index) => {
                  const rankChange = getRankChange(item)
                  const isTop3 = index < 3

                  return (
                    <motion.div
                      key={item.store_id}
                      layout
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.4, type: "spring" }}
                      className={`relative flex items-center gap-4 p-5 rounded-3xl shadow-sm border transition-all group ${isTop3
                        ? `bg-gradient-to-br from-white/90 to-${index === 0 ? 'yellow' : index === 1 ? 'indigo' : 'orange'}-50/90 dark:from-slate-900/90 dark:to-${index === 0 ? 'yellow' : index === 1 ? 'indigo' : 'orange'}-900/40 backdrop-blur-sm border-${index === 0 ? 'yellow' : index === 1 ? 'indigo' : 'orange'}-200 dark:border-${index === 0 ? 'yellow' : index === 1 ? 'indigo' : 'orange'}-900/50 shadow-${index === 0 ? 'yellow' : index === 1 ? 'indigo' : 'orange'}-100 dark:shadow-none`
                        : 'bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm border-gray-100 dark:border-slate-800 hover:border-gray-200 dark:hover:border-slate-700'
                        }`}
                    >
                      {/* Rank Medal */}
                      <div className={`relative w-16 h-16 shrink-0 rounded-2xl flex items-center justify-center font-black text-2xl shadow-inner ${index === 0 ? 'bg-yellow-400 text-yellow-900' :
                        index === 1 ? 'bg-slate-300 dark:bg-slate-700 text-slate-800 dark:text-slate-200' :
                          index === 2 ? 'bg-orange-400 text-white' :
                            'bg-gray-100 dark:bg-slate-800 text-gray-400 dark:text-slate-600'
                        }`}>
                        {index === 0 ? '1' : index === 1 ? '2' : index === 2 ? '3' : item.rank}
                        {isTop3 && <Trophy size={16} className={`absolute -top-2 -right-2 drop-shadow-md ${index === 0 ? 'text-yellow-600' : index === 1 ? 'text-slate-500' : 'text-orange-600'}`} fill="currentColor" />}
                      </div>

                      {/* Store Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-lg font-black text-gray-900 dark:text-white truncate tracking-tight">{item.store_name}</h3>
                          {rankChange && (
                            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded uppercase tracking-widest ${rankChange > 0 ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'}`}>
                              {rankChange > 0 ? `▲ ${rankChange}` : `▼ ${Math.abs(rankChange)}`}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gray-500">
                          <div className="flex items-center gap-1.5">
                            <div className="flex text-yellow-500 dark:text-yellow-400">
                              <Star size={14} fill="currentColor" />
                            </div>
                            <span className="font-black text-gray-900 dark:text-white">{item.avg_rating.toFixed(2)}</span>
                            <span className="text-xs font-bold text-gray-400 dark:text-slate-500">RATING</span>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 dark:bg-indigo-400"></div>
                            <span className="font-black text-gray-900 dark:text-white">{item.avg_nps.toFixed(1)}</span>
                            <span className="text-xs font-bold text-gray-400 dark:text-slate-500">NPS</span>
                          </div>

                          <div className="text-[10px] font-black bg-gray-100 dark:bg-slate-800 px-2 py-0.5 rounded text-gray-500 dark:text-slate-400 uppercase tracking-widest">
                            {item.count} reseñas
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </div>
          </div>
        )}

        {!loading && view === 'historial' && (
          <div className="animate-in slide-in-from-bottom-4 duration-500 overflow-y-auto max-h-[calc(100vh-280px)] md:max-h-[calc(100vh-220px)] pb-32 no-scrollbar">
            <div className="max-w-4xl mx-auto px-4">
              {/* Filters */}
              <div className="sticky top-0 z-10 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md p-2 rounded-2xl shadow-lg shadow-gray-200/50 dark:shadow-none mb-6 border border-gray-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="bg-gray-100 dark:bg-slate-800 p-2 rounded-xl">
                    <Filter size={18} className="text-gray-500 dark:text-slate-400" />
                  </div>
                  <div className="flex-1">
                    <select
                      id="storeFilter"
                      value={selectedStore}
                      onChange={(e) => setSelectedStore(e.target.value)}
                      className="w-full bg-transparent font-black text-gray-900 dark:text-white text-sm outline-none px-2"
                    >
                      <option value="all" className="dark:bg-slate-900">Todas las tiendas</option>
                      {stores.map(store => (
                        <option key={store.id} value={store.id} className="dark:bg-slate-900">{store.name}</option>
                      ))}
                    </select>
                  </div>
                  {selectedStore !== 'all' && (
                    <button onClick={() => setSelectedStore('all')} className="text-[10px] font-black text-red-500 bg-red-50 dark:bg-red-900/20 px-3 py-1.5 rounded-lg uppercase tracking-widest transition-all hover:bg-red-100 dark:hover:bg-red-900/40">
                      Limpiar
                    </button>
                  )}
                </div>
              </div>

              {/* Historial list */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {feedbacks
                  .filter(f => selectedStore === 'all' || f.store_id === selectedStore)
                  .map(feedback => (
                    <div key={feedback.id} className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-3xl shadow-sm hover:shadow-md transition-all p-5 border border-gray-100 dark:border-slate-800 flex flex-col h-full group">
                      <div className="flex justify-between items-start mb-4">
                        <div className="min-w-0">
                          <h3 className="font-black text-lg text-gray-900 dark:text-white leading-tight mb-0.5 tracking-tight truncate">{feedback.store_name}</h3>
                          <p className="text-[10px] text-gray-500 dark:text-slate-500 font-bold uppercase tracking-wider">
                            {formatDateLA(feedback.submission_date)} • {feedback.customer_name || 'Anónimo'}
                          </p>
                        </div>
                        <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase border shrink-0 ${getNPSColor(feedback.nps_category)}`}>
                          NPS {feedback.nps_score}
                        </span>
                      </div>

                      <div className="grid grid-cols-4 gap-2 mb-4 bg-gray-50 dark:bg-slate-800/50 p-3 rounded-2xl border border-gray-100 dark:border-slate-800/50">
                        <div className="text-center">
                          <div className="text-[9px] text-gray-400 dark:text-slate-500 uppercase font-black mb-1">Serv</div>
                          <div className="font-black text-gray-800 dark:text-slate-200">{feedback.service_rating}</div>
                        </div>
                        <div className="text-center border-l border-gray-200 dark:border-slate-800">
                          <div className="text-[9px] text-gray-400 dark:text-slate-500 uppercase font-black mb-1">Rap</div>
                          <div className="font-black text-gray-800 dark:text-slate-200">{feedback.speed_rating}</div>
                        </div>
                        <div className="text-center border-l border-gray-200 dark:border-slate-800">
                          <div className="text-[9px] text-gray-400 dark:text-slate-500 uppercase font-black mb-1">Cal</div>
                          <div className="font-black text-gray-800 dark:text-slate-200">{feedback.food_quality_rating}</div>
                        </div>
                        <div className="text-center border-l border-gray-200 dark:border-slate-800">
                          <div className="text-[9px] text-gray-400 dark:text-slate-500 uppercase font-black mb-1">Lim</div>
                          <div className="font-black text-gray-800 dark:text-slate-200">{feedback.cleanliness_rating}</div>
                        </div>
                      </div>

                      {feedback.comments ? (
                        <div className="flex-1 bg-gray-50/50 dark:bg-slate-800/30 p-4 rounded-2xl border border-gray-100 dark:border-slate-800">
                          <p className="text-xs text-gray-600 dark:text-slate-400 font-medium italic leading-relaxed">"{feedback.comments}"</p>
                        </div>
                      ) : (
                        <div className="flex-1 flex items-center justify-center text-gray-300 dark:text-slate-700 text-[10px] font-bold uppercase tracking-widest italic">
                          Sin comentarios
                        </div>
                      )}
                    </div>
                  ))}
              </div>

              {feedbacks.filter(f => selectedStore === 'all' || f.store_id === selectedStore).length === 0 && (
                <div className="text-center py-20 opacity-50">
                  <div className="bg-gray-100 dark:bg-slate-800 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-400 dark:text-slate-600">
                    <Search size={24} />
                  </div>
                  <p className="text-gray-900 dark:text-white font-black uppercase tracking-widest">No se encontraron resultados</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div >
    </div >
  )
}