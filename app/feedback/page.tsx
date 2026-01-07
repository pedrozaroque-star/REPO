'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MessageSquare, Plus, Filter } from 'lucide-react'
import { getSupabaseClient, formatStoreName } from '@/lib/supabase' // ✅ Importación necesaria
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'

import FeedbackReviewModal from '@/components/FeedbackReviewModal'

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
  const [stores, setStores] = useState<any[]>([])

  // Modal State
  const [selectedFeedback, setSelectedFeedback] = useState<any>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  // 🚨 DETECTOR DE CONFLICTO DE IDENTIDAD (Moved up to avoid Hook Error)
  const [tokenIdentity, setTokenIdentity] = useState<any>(null)

  // -- EFFECTS --

  useEffect(() => {
    if (user) fetchData()
  }, [storeFilter, user])

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

      // Obtener feedbacks
      let query = supabase
        .from('customer_feedback')
        .select('*, stores(name,code,city,state)')
        .order('submission_date', { ascending: false })

      if (storeFilter !== 'all') {
        query = query.eq('store_id', storeFilter)
      }

      const { data: feedbackData, error } = await query



      if (error) throw error

      setFeedbacks(feedbackData || [])

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
      promoter: 'bg-green-100 text-green-800 border-green-200',
      passive: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      detractor: 'bg-red-100 text-red-800 border-red-200'
    }
    return colors[category] || 'bg-gray-100 text-gray-800 border-gray-200'
  }

  // Permission Logic: Only Admin can review/edit
  const isAdmin = user?.role === 'admin'

  const handleForceLogout = () => {
    localStorage.clear()
    window.location.href = '/login'
  }

  // -- RENDER --
  if (loading) return <div className="flex h-screen items-center justify-center">Cargando feedback...</div>

  // --- DISEÑO ACTUALIZADO MOBILE-FIRST ---
  return (
    <div className="flex bg-transparent font-sans w-full animate-in fade-in duration-500">
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
        <div className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-20 shrink-0">
          <div className="max-w-7xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between gap-4">
            {/* Title Area */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600">
                <MessageSquare size={18} />
              </div>
              <div>
                <h1 className="text-lg md:text-xl font-black text-gray-900 tracking-tight leading-none">Feedback</h1>
                <p className="hidden md:block text-xs text-gray-400 font-medium">Encuestas de satisfacción y NPS</p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              {/* Desktop Filter */}
              <div className="hidden md:block">
                <select
                  value={storeFilter}
                  onChange={(e) => setStoreFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-full bg-gray-100 border-none outline-none focus:ring-2 focus:ring-indigo-200 text-sm font-bold text-gray-600 cursor-pointer"
                >
                  <option value="all">Todas las tiendas</option>
                  {stores.map(s => (
                    <option key={s.id} value={s.id}>{formatStoreName(s.name)}</option>
                  ))}
                </select>
              </div>

              <button
                onClick={() => router.push('/feedback/nuevo')}
                className="w-8 h-8 md:w-auto md:h-auto md:px-4 md:py-1.5 rounded-full bg-gray-900 text-white flex items-center justify-center gap-2 hover:bg-black transition-transform active:scale-95 shadow-lg shadow-gray-200"
              >
                <Plus size={16} strokeWidth={3} />
                <span className="hidden md:inline font-bold text-xs tracking-wide">NUEVO FEEDBACK</span>
              </button>
            </div>
          </div>
        </div>

        {/* SCROLLABLE CONTENT */}
        <div className="flex-1 overflow-y-auto w-full max-w-7xl mx-auto p-4 md:p-8 pb-24">

          {/* Mobile Filters */}
          <div className="md:hidden sticky top-0 z-10 -mt-2 mb-6">
            <div className="relative group shadow-lg shadow-gray-200/50 rounded-full">
              <select
                value={storeFilter}
                onChange={(e) => setStoreFilter(e.target.value)}
                className="w-full pl-4 pr-10 py-3 rounded-full bg-white border border-gray-100 outline-none focus:border-indigo-300 text-sm font-bold text-gray-900 appearance-none"
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
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 lg:gap-4 mb-6 lg:mb-8">
            <div className="bg-white rounded-2xl shadow-sm p-3 md:p-4 border-l-4 border-gray-800 border-y border-r border-gray-100">
              <p className="text-[10px] md:text-xs font-bold text-gray-400 uppercase">Total</p>
              <p className="text-xl md:text-2xl font-black text-gray-900 md:mt-1">{stats.total}</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm p-3 md:p-4 border-l-4 border-indigo-500 border-y border-r border-gray-100">
              <p className="text-[10px] md:text-xs font-bold text-gray-400 uppercase">NPS Score</p>
              <p className={`text-xl md:text-2xl font-black md:mt-1 ${getNPSColor(stats.nps)}`}>{stats.nps}</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm p-3 md:p-4 border-l-4 border-green-500 border-y border-r border-gray-100">
              <p className="text-[10px] md:text-xs font-bold text-gray-400 uppercase">Servicio</p>
              <div className="flex items-center gap-1 mt-1">
                <span className="text-xl md:text-2xl font-black text-gray-900">{stats.avgService}</span>
                <span className="text-yellow-500 text-xs">⭐</span>
              </div>
            </div>
            <div className="bg-white rounded-2xl shadow-sm p-3 md:p-4 border-l-4 border-red-500 border-y border-r border-gray-100">
              <p className="text-[10px] md:text-xs font-bold text-gray-400 uppercase">Calidad</p>
              <div className="flex items-center gap-1 mt-1">
                <span className="text-xl md:text-2xl font-black text-gray-900">{stats.avgQuality}</span>
                <span className="text-yellow-500 text-xs">⭐</span>
              </div>
            </div>
            <div className="bg-white rounded-2xl shadow-sm p-3 md:p-4 border-l-4 border-purple-500 border-y border-r border-gray-100">
              <p className="text-[10px] md:text-xs font-bold text-gray-400 uppercase">Limpieza</p>
              <div className="flex items-center gap-1 mt-1">
                <span className="text-xl md:text-2xl font-black text-gray-900">{stats.avgCleanliness}</span>
                <span className="text-yellow-500 text-xs">⭐</span>
              </div>
            </div>
            <div className="bg-white rounded-2xl shadow-sm p-3 md:p-4 border-l-4 border-yellow-500 border-y border-r border-gray-100">
              <p className="text-[10px] md:text-xs font-bold text-gray-400 uppercase">Rapidez</p>
              <div className="flex items-center gap-1 mt-1">
                <span className="text-xl md:text-2xl font-black text-gray-900">{stats.avgSpeed}</span>
                <span className="text-yellow-500 text-xs">⭐</span>
              </div>
            </div>
          </div>

          {/* FEEDBACK LIST - Mobile Cards & Desktop Table */}
          {feedbacks.length === 0 ? (
            <div className="text-center py-20 opacity-50">
              <MessageSquare size={64} className="mx-auto text-gray-300 mb-4" />
              <p className="text-gray-900 font-bold">No hay feedbacks registrados</p>
            </div>
          ) : (
            <>
              {/* MOBILE CARDS (Hidden on Desktop) */}
              <div className="md:hidden space-y-4">
                {feedbacks.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => handleRowClick(item)}
                    className="bg-white rounded-3xl p-5 shadow-[0_2px_15px_-5px_rgba(0,0,0,0.05)] border border-gray-100 transition-all active:scale-[0.98]"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="font-black text-lg text-gray-900">{formatStoreName(item.stores?.name)}</h3>
                        <p className="text-xs text-gray-500 font-medium">
                          {new Date(item.submission_date).toLocaleDateString('es-MX')} • {new Date(item.submission_date).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className={`px-2 py-1 rounded-lg text-xs font-black uppercase border ${getCategoryBadge(item.nps_category)}`}>
                          NPS {item.nps_score}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 mb-4">
                      <div className="flex items-center gap-2 text-sm font-bold text-gray-800">
                        {item.customer_name || 'Anónimo'}
                      </div>
                      {item.comments && (
                        <div className="bg-gray-50 p-3 rounded-xl">
                          <p className="text-xs text-gray-600 italic">"{item.comments}"</p>
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

                    <div className="flex items-center justify-end pt-3 border-t border-dashed border-gray-100 gap-3">
                      {(item.photo_urls && item.photo_urls.length > 0) && (
                        <span className="flex items-center gap-1 text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-lg">
                          📷 Con Fotos
                        </span>
                      )}
                      <button className="text-indigo-600 font-bold text-xs bg-indigo-50 px-3 py-1.5 rounded-lg">
                        VER DETALLE
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* DESKTOP TABLE (Hidden on Mobile) */}
              <div className="hidden md:block bg-white rounded-xl shadow-md overflow-hidden border border-gray-100">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse relative">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                        <th className="px-6 py-4">Fecha</th>
                        <th className="px-6 py-4">Sucursal</th>
                        <th className="px-6 py-4">Cliente</th>
                        <th className="px-6 py-4 text-center">NPS</th>
                        <th className="px-6 py-4 text-center">Calif. Gral</th>
                        <th className="px-6 py-4 text-center">Evidencia</th>
                        <th className="px-6 py-4 text-center">Comentario</th>
                        <th className="px-6 py-4 text-center">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {feedbacks.map((item) => (
                        <tr
                          key={item.id}
                          onClick={() => handleRowClick(item)}
                          className="hover:bg-gray-50/80 cursor-pointer transition-colors group"
                        >
                          <td className="px-6 py-4 text-sm text-gray-500 whitespace-nowrap">
                            <div className="font-bold text-gray-900">{new Date(item.submission_date).toLocaleDateString('es-MX')}</div>
                            <div className="text-xs text-gray-400">{new Date(item.submission_date).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</div>
                          </td>
                          <td className="px-6 py-4 font-medium text-gray-700">{formatStoreName(item.stores?.name)}</td>
                          <td className="px-6 py-4">
                            <div className="text-sm font-bold text-gray-900">{item.customer_name || 'Anónimo'}</div>
                            {item.customer_email && <div className="text-xs text-gray-400 truncate max-w-[150px]">{item.customer_email}</div>}
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className={`px-2 py-1 rounded-lg text-xs font-black border ${getCategoryBadge(item.nps_category)}`}>
                              {item.nps_score}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <div className="flex justify-center text-yellow-400 text-xs">
                              {'⭐'.repeat(Math.round((item.service_rating + item.food_quality_rating + item.cleanliness_rating + item.speed_rating) / 4))}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-center">
                            {(item.photo_urls && item.photo_urls.length > 0) ? (
                              <span className="inline-flex items-center justify-center p-2 bg-blue-50 text-blue-600 rounded-lg">
                                📷
                              </span>
                            ) : (
                              <span className="text-gray-300">-</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-center">
                            {item.comments ? (
                              <div className="text-xs text-gray-500 italic truncate max-w-[200px]" title={item.comments}>
                                "{item.comments}"
                              </div>
                            ) : (
                              <span className="text-gray-200 text-xs">-</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-center">
                            <button className="text-indigo-600 hover:text-indigo-800 font-bold text-xs bg-indigo-50 px-3 py-1.5 rounded-lg hover:bg-indigo-100 transition-colors">
                              REVISAR
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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