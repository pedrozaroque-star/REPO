'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Star, MessageSquare, MessageCircleMore, ThumbsUp, ThumbsDown, Filter, Calendar, Search, MapPin, TrendingUp, TrendingDown, Minus, Plus } from 'lucide-react'
import { getSupabaseClient, formatStoreName } from '@/lib/supabase'
import { formatDateLA, formatTimeLA, getStatusColor, getStatusLabel } from '@/lib/checklistPermissions'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'

import FeedbackReviewModal from '@/components/FeedbackReviewModal'
import FeedbackLeaderboardModal from '@/components/FeedbackLeaderboardModal'
import SurpriseLoader from '@/components/SurpriseLoader'

function FeedbackContent() {
  const router = useRouter()
  const { user } = useAuth()

  // -- STATE DEFINITIONS --
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
  const [feedbacks, setFeedbacks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [storeFilter, setStoreFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all') // New Status Filter
  const [stores, setStores] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])

  // Modal State
  const [selectedFeedback, setSelectedFeedback] = useState<any>(null)

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false)
  const hasAutoOpened = useRef(false)

  // 🚨 DETECTOR DE CONFLICTO DE IDENTIDAD (Moved up to avoid Hook Error)
  const [tokenIdentity, setTokenIdentity] = useState<any>(null)

  // -- EFFECTS --

  useEffect(() => {
    if (user) fetchData()
  }, [storeFilter, statusFilter, user])

  // Identity Check Effect
  useEffect(() => {
    const fetchIdentity = async () => {
      const token = localStorage.getItem('teg_token')
      if (!token) return

      // 🔍 Decodificar el JWT para saber QUÉ usuario representa
      try {
        const payload = JSON.parse(atob(token.split('.')[1]))
        const jwtEmail = payload.email



        const supabase = await getSupabaseClient()

        // ✅ CONSULTA CORREGIDA: Buscar el usuario ESPECÍFICO del JWT
        const { data } = await supabase
          .from('users')
          .select('email, role')
          .eq('email', jwtEmail)  // 🎯 CRUCIAL: Filtrar por el email del JWT
          .single()

        if (data) {

          setTokenIdentity(data)
        }
      } catch (err) {
        console.error('❌ Error decodificando JWT:', err)
      }
    }
    fetchIdentity()
  }, []) // Empty dependency array = run once on mount

  // Log Conflict Effect
  useEffect(() => {
    if (user && tokenIdentity && tokenIdentity.email !== user.email) {
      console.error('🚨 CONFLICTO CRÍTICO DE IDENTIDAD DETECTADO')
    }
  }, [user, tokenIdentity])

  // -- HELPER FUNCTIONS --

  const fetchData = async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('teg_token')

      if (!token) {
        console.warn('⚠️ No se encontró token para RLS')
        setLoading(false)
        return
      }

      const supabase = await getSupabaseClient()


      const { data: claimsData, error: claimsError } = await supabase.rpc('get_my_claims')



      // Obtener tiendas
      const { data: storesData } = await supabase.from('stores').select('*')
      setStores(storesData || [])

      // Obtener usuarios para mapeo de nombres
      const { data: usersData } = await supabase.from('users').select('id, full_name')
      setUsers(usersData || [])

      // Obtener feedbacks
      let query = supabase
        .from('customer_feedback')
        .select('*, stores(name,code,city,state)')
        .order('submission_date', { ascending: false })

      if (storeFilter !== 'all') {
        query = query.eq('store_id', storeFilter)
      }

      const { data: rawFeedback, error } = await query

      if (error) throw error

      const feedbacksList = rawFeedback || []
      const feedbackIds = feedbacksList.map((f: any) => f.id)

      // Fetch Comment Counts
      let commentCounts: Record<string, number> = {}
      if (feedbackIds.length > 0) {
        const { data: commentsData } = await supabase
          .from('feedback_comments')
          .select('feedback_id')
          .in('feedback_id', feedbackIds)

        if (commentsData) {
          commentsData.forEach((c: any) => {
            commentCounts[c.feedback_id] = (commentCounts[c.feedback_id] || 0) + 1
          })
        }
      }

      // Merge Data
      const feedbackData = feedbacksList.map((f: any) => ({
        ...f,
        has_chat: (commentCounts[f.id] || 0) > 0
      }))

      // Filter by Status
      const finalData = statusFilter !== 'all'
        ? (feedbackData || []).filter((item: any) => {
          const s = (item.admin_review_status || 'pendiente').toLowerCase().trim()
          if (statusFilter === 'cerrado') {
            return s === 'aprobado' || s === 'cerrado' || s === 'closed'
          }
          return s === statusFilter
        })
        : (feedbackData || [])

      setFeedbacks(finalData)

      // Auto-open Leaderboard on first load if logic dictates
      // (User request: "al abrir la pagina FEEDBACK abrir un modal LEaderBoard")
      if (!isLeaderboardOpen && finalData.length > 0) {
        // Logic to open only once per session or navigation could be added here
        // For now, just opening it when data is ready effectively.
        // But careful about re-renders.
      }

      // Calcular estadísticas
      if (feedbackData && feedbackData.length > 0) {
        const promoters = feedbackData.filter((f: any) => f.nps_category === 'promoter').length
        const passives = feedbackData.filter((f: any) => f.nps_category === 'passive').length
        const detractors = feedbackData.filter((f: any) => f.nps_category === 'detractor').length
        const nps = Math.round(((promoters - detractors) / feedbackData.length) * 100)

        const avgService = feedbackData.reduce((sum: number, f: any) => sum + (f.service_rating || 0), 0) / feedbackData.length
        const avgQuality = feedbackData.reduce((sum: number, f: any) => sum + (f.food_quality_rating || 0), 0) / feedbackData.length
        const avgCleanliness = feedbackData.reduce((sum: number, f: any) => sum + (f.cleanliness_rating || 0), 0) / feedbackData.length
        const avgSpeed = feedbackData.reduce((sum: number, f: any) => sum + (f.speed_rating || 0), 0) / feedbackData.length

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

      // Open Leaderboard once data is loaded (Only for the first time)
      if (!isLeaderboardOpen && !hasAutoOpened.current) {
        setIsLeaderboardOpen(true)
        hasAutoOpened.current = true
      }

    } catch (err) {
      console.error('Error fetching data:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleRowClick = (feedback: any) => {
    setSelectedFeedback(feedback)
    setIsModalOpen(true)
  }

  const getNPSColor = (nps: number) => {
    if (nps >= 50) return 'text-green-600'
    if (nps >= 0) return 'text-yellow-600'
    return 'text-red-600'
  }

  const getCategoryBadge = (category: string) => {
    const colors: any = {
      promoter: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-800',
      passive: 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/40 dark:text-yellow-300 dark:border-yellow-800',
      detractor: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/40 dark:text-red-300 dark:border-red-800'
    }
    return colors[category] || 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
  }

  // Permission Logic: Only Admin can review/edit
  const isAdmin = user?.role === 'admin'

  const handleForceLogout = () => {
    localStorage.clear()
    window.location.href = '/login'
  }

  // -- RENDER --
  if (loading) return <SurpriseLoader />

  // --- DISEÑO ACTUALIZADO MOBILE-FIRST ---
  return (
    <div className="flex bg-transparent dark:bg-neutral-900 pb-20 font-sans relative overflow-hidden w-full">
      <div className="absolute inset-0 opacity-10 dark:opacity-40 pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
      <main className="flex-1 flex flex-col h-full w-full relative">

        {/* 🚨 BANNER DE DEBUG DE EMERGENCIA */}
        {tokenIdentity && user && tokenIdentity.email !== user.email && (
          <div className="absolute inset-x-0 top-16 z-50 px-4">
            <div className="bg-red-600 text-white p-4 rounded-xl shadow-2xl border-4 border-yellow-400 animate-pulse">
              <div className="flex flex-col items-center text-center gap-2">
                <h2 className="text-xl font-black uppercase">CONFLICTO DE IDENTIDAD</h2>
                <p className="text-sm">Tu navegador dice <b>{user.role}</b> pero la BD ve <b>{tokenIdentity.role}</b>.</p>
                <button onClick={handleForceLogout} className="mt-2 bg-white text-red-700 font-bold px-4 py-2 rounded-lg text-sm uppercase">Reparar Sesión</button>
              </div>
            </div>
          </div>
        )}

        {/* STICKY HEADER - Mobile & Desktop */}
        {/* HEADER - Gradient Design matching Leaderboard */}
        <div className="bg-gradient-to-r from-slate-900 to-slate-800 dark:from-slate-950 dark:to-slate-900 shadow-xl sticky top-14 lg:top-0 z-20 shrink-0 transition-all border-b border-white/10">
          <div className="w-full mx-auto px-4 md:px-8 h-20 flex items-center justify-between gap-4">

            {/* Title Area */}
            <div className="flex items-center gap-4">
              <div className="p-3 bg-white/10 rounded-2xl backdrop-blur-md shadow-inner ring-1 ring-white/20">
                <MessageSquare className="text-white w-6 h-6" />
              </div>
              <div>
                <h1 className="text-xl md:text-2xl font-black text-white tracking-tight leading-none bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
                  Feedback
                </h1>
                <p className="hidden md:block text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">
                  Satisfacción del Cliente & NPS
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              {/* Status Filters (Web) */}
              <div className="hidden md:flex items-center bg-black/20 p-1 rounded-xl backdrop-blur-sm border border-white/5">
                <button
                  onClick={() => setStatusFilter('all')}
                  className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all uppercase tracking-wide ${statusFilter === 'all' ? 'bg-white text-slate-900 shadow-lg scale-105' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
                >
                  Todos
                </button>
                <button
                  onClick={() => setStatusFilter('pendiente')}
                  className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all uppercase tracking-wide ${statusFilter === 'pendiente' ? 'bg-yellow-400 text-yellow-900 shadow-lg scale-105' : 'text-gray-400 hover:text-yellow-400 hover:bg-white/10'}`}
                >
                  Pendientes
                </button>
                <button
                  onClick={() => setStatusFilter('cerrado')}
                  className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all uppercase tracking-wide ${statusFilter === 'cerrado' ? 'bg-green-500 text-white shadow-lg scale-105' : 'text-gray-400 hover:text-green-400 hover:bg-white/10'}`}
                >
                  Cerrados
                </button>
              </div>

              {/* Leaderboard Toggle Button */}
              <button
                onClick={() => setIsLeaderboardOpen(true)}
                className="w-10 h-10 md:w-auto md:h-auto md:px-4 md:py-2 rounded-xl bg-gradient-to-r from-yellow-400 to-orange-500 text-white flex items-center justify-center gap-2 hover:brightness-110 transition-transform active:scale-95 shadow-lg shadow-orange-500/20"
                title="Ver Ranking"
              >
                <TrendingUp size={18} strokeWidth={2.5} />
                <span className="hidden md:inline font-bold text-xs tracking-wide uppercase">Ranking</span>
              </button>

              {/* Desktop Filter */}
              <div className="hidden md:block">
                <select
                  value={storeFilter}
                  onChange={(e) => setStoreFilter(e.target.value)}
                  className="px-4 py-2 rounded-xl bg-white/10 border border-white/10 text-white outline-none focus:ring-2 focus:ring-white/20 text-sm font-bold cursor-pointer hover:bg-white/20 transition-colors"
                >
                  <option value="all" className="bg-slate-900 text-gray-300">Todas las tiendas</option>
                  {stores.map(s => (
                    <option key={s.id} value={s.id} className="bg-slate-900 text-white">{formatStoreName(s.name)}</option>
                  ))}
                </select>
              </div>


            </div>
          </div>
        </div>

        {/* SCROLLABLE CONTENT */}
        <div className="flex-1 overflow-y-auto w-full mx-auto p-4 md:p-8 pb-24">

          {/* Mobile Filters */}
          <div className="md:hidden sticky top-0 z-10 -mt-2 mb-6">
            <div className="relative group shadow-lg shadow-gray-200/50 dark:shadow-none rounded-full">
              <select
                value={storeFilter}
                onChange={(e) => setStoreFilter(e.target.value)}
                className="w-full pl-4 pr-10 py-3 rounded-full bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 outline-none focus:border-indigo-300 text-sm font-bold text-gray-900 dark:text-white appearance-none"
              >
                <option value="all">Todas las tiendas</option>
                {stores.map(s => (
                  <option key={s.id} value={s.id}>{formatStoreName(s.name)}</option>
                ))}
              </select>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
                <Filter size={16} />
              </div>
            </div>
          </div>

          {/* Stats Cards - Adaptive Grid */}
          {/* Stats Cards - Modern Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-4 mb-8">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm p-4 border border-gray-100 dark:border-slate-800 flex flex-col justify-between hover:shadow-md transition-shadow">
              <div className="p-2 bg-gray-100 dark:bg-slate-800 w-fit rounded-lg mb-2">
                <MessageSquare className="text-gray-500 w-5 h-5" />
              </div>
              <div>
                <p className="text-3xl font-black text-gray-900 dark:text-white">{stats.total}</p>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Total Feedbacks</p>
              </div>
            </div>

            <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl shadow-lg shadow-indigo-500/20 p-4 text-white flex flex-col justify-between transform hover:-translate-y-1 transition-transform">
              <div className="flex justify-between items-start">
                <div className="p-2 bg-white/20 rounded-lg backdrop-blur-sm">
                  <TrendingUp className="text-white w-5 h-5" />
                </div>
                <span className={`text-xs font-black px-2 py-0.5 rounded bg-white/20`}>{stats.nps}</span>
              </div>
              <div>
                <p className="text-3xl font-black">{stats.nps}</p>
                <p className="text-[10px] font-bold text-white/70 uppercase tracking-widest">NPS Score</p>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm p-4 border border-gray-100 dark:border-slate-800 flex flex-col justify-between hover:shadow-md transition-shadow group">
              <div className="flex justify-between items-start">
                <div className="p-2 bg-green-50 dark:bg-green-900/20 rounded-lg group-hover:bg-green-100 transition-colors">
                  <ThumbsUp className="text-green-500 w-5 h-5" />
                </div>
                <div className="flex text-yellow-500 text-[10px]">⭐⭐⭐⭐⭐</div>
              </div>
              <div>
                <p className="text-2xl font-black text-gray-900 dark:text-white">{stats.avgService}</p>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Servicio</p>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm p-4 border border-gray-100 dark:border-slate-800 flex flex-col justify-between hover:shadow-md transition-shadow group">
              <div className="flex justify-between items-start">
                <div className="p-2 bg-orange-50 dark:bg-orange-900/20 rounded-lg group-hover:bg-orange-100 transition-colors">
                  <Star className="text-orange-500 w-5 h-5" />
                </div>
                <div className="flex text-yellow-500 text-[10px]">⭐⭐⭐⭐⭐</div>
              </div>
              <div>
                <p className="text-2xl font-black text-gray-900 dark:text-white">{stats.avgQuality}</p>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Calidad</p>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm p-4 border border-gray-100 dark:border-slate-800 flex flex-col justify-between hover:shadow-md transition-shadow group">
              <div className="flex justify-between items-start">
                <div className="p-2 bg-sky-50 dark:bg-sky-900/20 rounded-lg group-hover:bg-sky-100 transition-colors">
                  <Star className="text-sky-500 w-5 h-5" />
                </div>
                <div className="flex text-yellow-500 text-[10px]">⭐⭐⭐⭐⭐</div>
              </div>
              <div>
                <p className="text-2xl font-black text-gray-900 dark:text-white">{stats.avgCleanliness}</p>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Limpieza</p>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm p-4 border border-gray-100 dark:border-slate-800 flex flex-col justify-between hover:shadow-md transition-shadow group">
              <div className="flex justify-between items-start">
                <div className="p-2 bg-rose-50 dark:bg-rose-900/20 rounded-lg group-hover:bg-rose-100 transition-colors">
                  <TrendingUp className="text-rose-500 w-5 h-5" />
                </div>
                <div className="flex text-yellow-500 text-[10px]">⭐⭐⭐⭐⭐</div>
              </div>
              <div>
                <p className="text-2xl font-black text-gray-900 dark:text-white">{stats.avgSpeed}</p>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Rapidez</p>
              </div>
            </div>
          </div>

          {/* FEEDBACK LIST - Mobile Cards & Desktop Table */}
          {feedbacks.length === 0 ? (
            <div className="text-center py-20 opacity-50">
              <MessageSquare size={64} className="mx-auto text-gray-300 dark:text-slate-700 mb-4" />
              <p className="text-gray-900 dark:text-slate-400 font-bold">No hay feedbacks registrados</p>
            </div>
          ) : (
            <>
              {/* MOBILE CARDS (Hidden on Desktop) */}
              <div className="md:hidden space-y-4">
                {feedbacks.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => handleRowClick(item)}
                    className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-3xl p-5 shadow-[0_2px_15px_-5px_rgba(0,0,0,0.05)] border border-gray-100 dark:border-slate-800 transition-all active:scale-[0.98]"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="font-black text-lg text-gray-900 dark:text-white">{formatStoreName(item.stores?.name)}</h3>
                        <p className="text-xs text-gray-500 dark:text-slate-400 font-medium">
                          {formatDateLA(item.submission_date)} • {formatTimeLA(item.submission_date)}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className={`px-2 py-1 rounded-lg text-xs font-black uppercase border ${getCategoryBadge(item.nps_category)}`}>
                          NPS {item.nps_score}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 mb-4">
                      <div className={`flex items-center gap-2 text-sm font-bold ${(!item.customer_name || item.customer_name === 'Anónimo' || item.customer_name === 'Anonimo') ? 'text-gray-400 dark:text-slate-600 italic' : 'text-gray-800 dark:text-slate-200'}`}>
                        {item.customer_name || 'Anónimo'}
                      </div>
                      {item.comments && (
                        <div className="bg-gray-50 dark:bg-slate-800/50 p-3 rounded-xl">
                          <p className="text-xs text-gray-600 dark:text-slate-400 italic">"{item.comments}"</p>
                        </div>
                      )}

                      {/* Rating Summary */}
                      <div className="flex items-center gap-3 mt-1">
                        <div className="flex text-yellow-500 text-xs">
                          {'⭐'.repeat(Math.round((item.service_rating + item.food_quality_rating + item.cleanliness_rating + item.speed_rating) / 4))}
                        </div>
                        <span className="text-[10px] uppercase font-bold text-gray-400">Promedio General</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-end pt-3 border-t border-dashed border-gray-100 dark:border-slate-800 gap-3">
                      {(item.photo_urls && item.photo_urls.length > 0) && (
                        <span className="flex items-center gap-1 text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2 py-1 rounded-lg">
                          📷 Con Fotos
                        </span>
                      )}
                      <button className="text-indigo-600 dark:text-indigo-400 font-bold text-xs bg-indigo-50 dark:bg-indigo-900/30 px-3 py-1.5 rounded-lg active:scale-95 transition-transform">
                        VER DETALLE
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* DESKTOP TABLE - Modern Floating Rows */}
              <div className="hidden md:block">
                <table className="w-full text-left border-separate border-spacing-y-2">
                  <thead>
                    <tr className="text-xs font-black text-black dark:text-white uppercase tracking-wider">
                      <th className="px-4 py-3 whitespace-nowrap">Fecha</th>
                      <th className="px-4 py-3 whitespace-nowrap">Sucursal</th>
                      <th className="px-4 py-3 whitespace-nowrap">Cliente</th>
                      <th className="px-4 py-3 text-center whitespace-nowrap">NPS</th>
                      <th className="px-4 py-3 text-left whitespace-nowrap">CALIFICACIÓN</th>
                      <th className="px-4 py-3 text-center whitespace-nowrap">Evidencia</th>
                      <th className="px-4 py-3 text-center whitespace-nowrap">Comentario</th>
                      <th className="px-4 py-3 text-left whitespace-nowrap">ESTATUS</th>
                      <th className="px-4 py-3 text-left whitespace-nowrap">REVISÓ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {feedbacks.map((item) => (
                      <tr
                        key={item.id}
                        onClick={() => handleRowClick(item)}
                        className="bg-white dark:bg-slate-900 hover:shadow-lg hover:scale-[1.005] hover:bg-white dark:hover:bg-slate-800 cursor-pointer transition-all duration-200 group rounded-2xl"
                      >
                        <td className="px-4 py-3 rounded-l-2xl border-y border-l border-gray-100 dark:border-slate-800 group-hover:border-indigo-100 dark:group-hover:border-slate-700 whitespace-nowrap">
                          <div className="font-bold text-gray-900 dark:text-white">{formatDateLA(item.submission_date)}</div>
                          <div className="text-[10px] text-gray-400 dark:text-slate-500 font-medium">{formatTimeLA(item.submission_date)}</div>
                        </td>
                        <td className="px-4 py-3 border-y border-gray-100 dark:border-slate-800 group-hover:border-indigo-100 dark:group-hover:border-slate-700 font-bold text-gray-700 dark:text-slate-300 whitespace-nowrap">
                          {formatStoreName(item.stores?.name)}
                        </td>
                        <td className="px-4 py-3 border-y border-gray-100 dark:border-slate-800 group-hover:border-indigo-100 dark:group-hover:border-slate-700 max-w-[200px] truncate">
                          <div className={`text-sm font-bold ${(!item.customer_name || item.customer_name === 'Anónimo' || item.customer_name === 'Anonimo') ? 'text-gray-400 dark:text-slate-600 italic' : 'text-gray-900 dark:text-slate-200'} truncate`}>{item.customer_name || 'Anónimo'}</div>
                          {item.customer_email && <div className="text-xs text-gray-400 dark:text-slate-500 truncate">{item.customer_email}</div>}
                        </td>
                        <td className="px-4 py-3 text-center border-y border-gray-100 dark:border-slate-800 group-hover:border-indigo-100 dark:group-hover:border-slate-700 whitespace-nowrap">
                          <span className={`px-2 py-1 rounded-lg text-xs font-black border ${getCategoryBadge(item.nps_category)} shadow-sm`}>
                            {item.nps_score}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-left border-y border-gray-100 dark:border-slate-800 group-hover:border-indigo-100 dark:group-hover:border-slate-700 whitespace-nowrap">
                          <div className="flex justify-start text-yellow-400 text-sm drop-shadow-sm">
                            {'⭐'.repeat(Math.round((item.service_rating + item.food_quality_rating + item.cleanliness_rating + item.speed_rating) / 4))}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center border-y border-gray-100 dark:border-slate-800 group-hover:border-indigo-100 dark:group-hover:border-slate-700 whitespace-nowrap">
                          {(item.photo_urls && item.photo_urls.length > 0) ? (
                            <span className="inline-flex items-center justify-center w-7 h-7 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-full">
                              📷
                            </span>
                          ) : (
                            <span className="text-gray-200 dark:text-slate-700">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center border-y border-gray-100 dark:border-slate-800 group-hover:border-indigo-100 dark:group-hover:border-slate-700 max-w-[150px]">
                          {item.comments ? (
                            <div className="relative group/comment flex justify-center">
                              {/* Truncated Text */}
                              <div className="text-xs text-gray-500 dark:text-slate-400 italic truncate max-w-[140px] bg-gray-50 dark:bg-slate-800 px-2 py-1 rounded-lg cursor-help">
                                "{item.comments}"
                              </div>

                              {/* FUN TOOLTIP */}
                              <div className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 hidden group-hover/comment:block w-64 z-[100] pointer-events-none">
                                <div className="bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 p-4 rounded-2xl shadow-xl text-left relative animate-in zoom-in-50 duration-200 border-2 border-white/20">
                                  {/* Arrow */}
                                  <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-purple-600 rotate-45 border-b-2 border-r-2 border-indigo-900/10"></div>

                                  <div className="flex items-center gap-2 mb-2 border-b border-white/20 pb-2">
                                    <span className="text-xl animate-bounce">💬</span>
                                    <span className="font-black text-white text-xs uppercase tracking-wider">El cliente dice:</span>
                                  </div>
                                  <p className="text-white font-bold text-sm leading-snug drop-shadow-md">
                                    "{item.comments}"
                                  </p>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <span className="text-gray-200 dark:text-slate-700 text-xs">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-left border-y border-gray-100 dark:border-slate-800 group-hover:border-indigo-100 dark:group-hover:border-slate-700 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            {/* STATUS BADGE - Compact */}
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase border tracking-wide shadow-sm ${getStatusColor(item.admin_review_status || 'pendiente')}`}>
                              {['aprobado', 'closed', 'cerrado'].includes((item.admin_review_status || '').toLowerCase())
                                ? 'CERRADO'
                                : getStatusLabel(item.admin_review_status || 'pendiente')}
                            </span>
                            {(item.has_chat || item.admin_review_comments || item.follow_up_notes) && (
                              <div className="p-1 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-full border border-blue-100 dark:border-blue-900/30 shadow-sm" title="Hay notas de revisión o chat">
                                <MessageCircleMore size={12} strokeWidth={2.5} />
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-left border-y border-r rounded-r-2xl border-gray-100 dark:border-slate-800 group-hover:border-indigo-100 dark:group-hover:border-slate-700 text-xs font-bold text-gray-500 dark:text-slate-400 whitespace-nowrap">
                          {users.find(u => u.id === item.reviewed_by)?.full_name?.split(' ')[0] || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

        </div>
      </main>
      {/* Detail Modal */}
      {
        selectedFeedback && user && (
          <FeedbackReviewModal
            isOpen={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            feedback={selectedFeedback}
            currentUser={user}
            onUpdate={fetchData}
          />
        )
      }


      {/* Leaderboard Modal */}
      <FeedbackLeaderboardModal
        isOpen={isLeaderboardOpen}
        onClose={() => setIsLeaderboardOpen(false)}
        data={feedbacks}
      />

    </div >
  )
}

export default function FeedbackPage() {
  return (
    <ProtectedRoute>
      <FeedbackContent />
    </ProtectedRoute>
  )
}