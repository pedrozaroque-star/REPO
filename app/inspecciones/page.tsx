'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import ChecklistReviewModal from '@/components/ChecklistReviewModal'
import { getSupabaseClient, formatStoreName } from '@/lib/supabase'
import { getEmbeddableImageUrl } from '@/lib/imageUtils'
import SurpriseLoader from '@/components/SurpriseLoader'
import { getStatusColor, getStatusLabel, formatDateLA, canEditChecklist } from '@/lib/checklistPermissions'
import { MessageCircleMore, Edit } from 'lucide-react'


function InspeccionesContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const openId = searchParams.get('openId') || searchParams.get('id')
  const storeParam = searchParams.get('store') // New: URL param for store filter
  const { user } = useAuth()
  const [inspections, setInspections] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [storeFilter, setStoreFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [supervisorFilter, setSupervisorFilter] = useState('all') // New State
  const [stores, setStores] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([]) // key for dropdown

  // Modal State
  const [selectedInspection, setSelectedInspection] = useState<any>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Auto-set store filter from URL param
  useEffect(() => {
    if (storeParam && storeParam !== 'all') {
      setStoreFilter(storeParam)
      // Clean URL after setting filter
      window.history.replaceState(null, '', '/inspecciones')
    }
  }, [storeParam])

  // Auto-open modal if query param exists
  useEffect(() => {
    if (openId && inspections.length > 0 && !isModalOpen) {
      const target = inspections.find(i => i.id.toString() === openId)
      if (target) {
        handleRowClick(target)
        // Clean URL smoothly
        window.history.replaceState(null, '', '/inspecciones')
      }
    }
  }, [openId, inspections])

  useEffect(() => {
    if (user) fetchData()
  }, [storeFilter, statusFilter, supervisorFilter, user])

  const fetchData = async () => {
    try {
      setLoading(true)
      setErrorMsg(null)

      const supabase = await getSupabaseClient()

      // Asegurar que el cliente reconozca el token antes de la primera petición RLS
      const token = localStorage.getItem('teg_token')
      if (token) {
        await supabase.auth.setSession({ access_token: token, refresh_token: '' })
      }

      // 1. Obtener tiendas y usuarios para mapeo manual
      const { data: storesList, error: storesListError } = await supabase.from('stores').select('*').order('name', { ascending: true })
      if (storesListError) console.error('❌ Error fetching stores list:', storesListError);

      const { data: usersList, error: usersListError } = await supabase.from('users').select('id, full_name, role')
      if (usersListError) console.error('❌ Error fetching users list:', usersListError);

      setStores(storesList || [])
      setUsers(usersList || [])


      // 2. Obtener inspecciones básicas (Sin Joins complejos que puedan fallar por RLS o FKs)

      let query = supabase
        .from('supervisor_inspections')
        .select('*')
        .order('inspection_date', { ascending: false })
        .order('created_at', { ascending: false })

      if (storeFilter !== 'all') {
        query = query.eq('store_id', storeFilter)
      } else if (user?.role === 'manager' || user?.role === 'gerente') {
        // [FIX] Managers solo ven SU tienda
        if (user.store_id) query = query.eq('store_id', user.store_id)
      } else {
        // Is Admin/Auditor
        if (supervisorFilter !== 'all') {
          query = query.eq('inspector_id', supervisorFilter)
        }
      }

      const { data: rawData, error: rawError } = await query

      if (rawError) {
        console.error('❌ Error de consulta de inspecciones:', rawError)
        throw rawError
      }

      // 2.5 Verificar comentarios (Chat)
      const inspectionIds = (rawData || []).map(i => i.id)
      let commentCounts: Record<string, number> = {}

      if (inspectionIds.length > 0) {
        const { data: commentsData } = await supabase
          .from('inspection_comments')
          .select('inspection_id')
          .in('inspection_id', inspectionIds)

        if (commentsData) {
          commentsData.forEach((c: any) => {
            commentCounts[c.inspection_id] = (commentCounts[c.inspection_id] || 0) + 1
          })
        }
      }


      // 3. Mapeo manual de datos
      const mappedData = (rawData || []).map(item => {
        const store = (storesList || []).find(s => s.id === item.store_id)
        const user = (usersList || []).find(u => u.id === item.inspector_id)

        return {
          ...item,
          store_name: formatStoreName(store?.name) || 'N/A',
          supervisor_name: user?.full_name || item.supervisor_name || 'Desconocido',
          checklist_type: 'supervisor',
          checklist_date: item.inspection_date || item.created_at,
          score: item.overall_score,
          photo_urls: item.photos || [],
          has_comments: commentCounts[item.id] > 0
        }
      })

      // 4. Filtrar por estado si aplica
      const finalData = statusFilter !== 'all'
        ? mappedData.filter(item => {
          const s = (item.estatus_admin || 'pendiente').toLowerCase().trim()
          if (statusFilter === 'aprobado') {
            return s === 'aprobado' || s === 'cerrado'
          }
          return s === statusFilter
        })
        : mappedData

      setInspections(finalData)
    } catch (error: any) {
      console.error('Error fetching data:', error)

      // Manejo específico de error de sesión (JWT Inválido)
      if (error?.code === 'PGRST301' || error?.message?.includes('JWT')) {
        setErrorMsg('Tu sesión ha expirado. Redirigiendo al login...')
        setTimeout(() => {
          localStorage.removeItem('teg_token')
          localStorage.removeItem('teg_user')
          window.location.href = '/login'
        }, 2000)
        return
      }

      setErrorMsg(error.message || 'Error al cargar inspecciones')
    } finally {
      setLoading(false)
    }
  }

  const handleRowClick = (inspection: any) => {
    setSelectedInspection(inspection)
    setIsModalOpen(true)
  }

  const handleEdit = (item: any, e: any) => {
    e.stopPropagation()
    // Validar permiso usando la helper centralizada
    // Nota: item.inspector_id es el creador de la inspección
    const permission = canEditChecklist(
      item.checklist_date || item.created_at,
      user?.role || '',
      item.inspector_id,
      user?.id || '',
      item.estatus_admin
    )

    if (!permission.canEdit) {
      alert(permission.reason || 'No tienes permiso para editar esta inspección.')
      return
    }

    router.push(`/inspecciones/editar/${item.id}`)
  }

  // --- RENDER ---
  if (loading) return <SurpriseLoader />

  return (
    <div className="flex bg-transparent dark:bg-neutral-900 font-sans w-full animate-in fade-in duration-500 relative overflow-hidden min-h-screen">
      <div className="absolute inset-0 opacity-10 dark:opacity-40 pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
      <div className="flex-1 flex flex-col h-full w-full relative">

        {/* 1. STICKY HEADER (Matches Reportes Design) */}
        <div className="bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800 px-4 md:px-8 py-4 flex flex-col md:flex-row justify-between items-center gap-4 shadow-sm shrink-0">
          <div className="w-full md:w-auto">
            <h1 className="text-xl md:text-2xl font-black text-gray-900 dark:text-white leading-none">Inspecciones de Supervisor</h1>
            <p className="text-xs font-bold text-gray-400 dark:text-gray-500 mt-1 uppercase tracking-wide">Auditoría y control de calidad</p>
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto">
            {/* Maintenance Button - Hidden unless needed */}


            <button
              onClick={() => router.push('/inspecciones/nueva')}
              className="bg-gray-900 dark:bg-red-600 hover:bg-black dark:hover:bg-red-700 text-white px-5 py-2.5 rounded-lg font-bold shadow-lg transition-all flex items-center justify-center gap-2 w-full md:w-auto text-sm"
            >
              <span>+</span> Nueva Inspección
            </button>
          </div>
        </div>

        {/* 2. SCROLLABLE CONTENT (Stats + Filters + List) */}
        <div className="flex-1 overflow-y-auto p-2 md:p-4 space-y-6">

          {/* STATS CARDS */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-xl shadow-sm p-4 border border-indigo-100 dark:border-slate-800 border-l-4 border-l-indigo-500 transition-all">
              <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider">Total</p>
              <p className="text-2xl font-black text-gray-900 dark:text-white mt-0.5">{inspections.length}</p>
            </div>
            <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-xl shadow-sm p-4 border border-green-100 dark:border-slate-800 border-l-4 border-l-green-500 transition-all">
              <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider">Promedio</p>
              <p className="text-2xl font-black text-gray-900 dark:text-white mt-0.5">
                {inspections.length > 0
                  ? Math.round(inspections.reduce((acc, curr) => acc + (curr.overall_score || 0), 0) / inspections.length) + '%'
                  : 'N/A'}
              </p>
            </div>
            <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-xl shadow-sm p-4 border border-yellow-100 dark:border-slate-800 border-l-4 border-l-yellow-500 transition-all">
              <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider">Pendientes</p>
              <p className="text-2xl font-black text-gray-900 dark:text-white mt-0.5">
                {inspections.filter(i => (i.estatus_admin || 'pendiente').toLowerCase().trim() === 'pendiente').length}
              </p>
            </div>
            <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-xl shadow-sm p-4 border border-blue-100 dark:border-slate-800 border-l-4 border-l-blue-500 transition-all">
              <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider">Aprobados</p>
              <p className="text-2xl font-black text-gray-900 dark:text-white mt-0.5">
                {inspections.filter(i => {
                  const s = (i.estatus_admin || '').toLowerCase().trim()
                  return s === 'aprobado' || s === 'cerrado'
                }).length}
              </p>
            </div>
          </div>

          {/* FILTERS */}
          <div className="flex flex-col md:flex-row gap-4 justify-between">
            {/* Supervisor & Store Filters (Admin/Auditor only) */}
            {(user?.role === 'admin' || user?.role === 'auditor') && (
              <div className="flex flex-col md:flex-row gap-4">
                <div className="relative group">
                  <select
                    value={storeFilter}
                    onChange={(e) => setStoreFilter(e.target.value)}
                    className="appearance-none bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-gray-700 dark:text-slate-300 py-2 pl-4 pr-10 rounded-lg font-bold text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm transition-all w-full md:w-56 cursor-pointer"
                  >
                    <option value="all">🏪 Todas las Tiendas</option>
                    {stores.map(s => (
                      <option key={s.id} value={s.id}>{formatStoreName(s.name)}</option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-500">
                    <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
                  </div>
                </div>

                <div className="relative group">
                  <select
                    value={supervisorFilter}
                    onChange={(e) => setSupervisorFilter(e.target.value)}
                    className="appearance-none bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-gray-700 dark:text-slate-300 py-2 pl-4 pr-10 rounded-lg font-bold text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm transition-all w-full md:w-56 cursor-pointer"
                  >
                    <option value="all">🧑‍🏫 Todos los Supervisores</option>
                    {users
                      .filter(u => ['supervisor', 'admin', 'auditor'].includes(u.role))
                      .map(u => (
                        <option key={u.id} value={u.id}>{u.full_name}</option>
                      ))
                    }
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-500">
                    <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setStatusFilter('all')}
                className={`px-4 py-2 text-xs font-bold rounded-lg transition-all uppercase tracking-wide ${statusFilter === 'all' ? 'bg-gray-800 dark:bg-slate-100 text-white dark:text-slate-900 shadow-md transform scale-105' : 'bg-white dark:bg-slate-800 text-gray-500 dark:text-slate-400 border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700'}`}
              >
                Todos
              </button>
              <button
                onClick={() => setStatusFilter('pendiente')}
                className={`px-4 py-2 text-xs font-bold rounded-lg transition-all uppercase tracking-wide ${statusFilter === 'pendiente' ? 'bg-yellow-400 text-yellow-900 shadow-md transform scale-105' : 'bg-white dark:bg-slate-800 text-gray-500 dark:text-slate-400 border border-gray-200 dark:border-slate-700 hover:bg-yellow-50 dark:hover:bg-yellow-900/30 hover:text-yellow-600 dark:hover:text-yellow-400'}`}
              >
                Pendientes
              </button>
              <button
                onClick={() => setStatusFilter('aprobado')}
                className={`px-4 py-2 text-xs font-bold rounded-lg transition-all uppercase tracking-wide ${statusFilter === 'aprobado' ? 'bg-green-500 text-white shadow-md transform scale-105' : 'bg-white dark:bg-slate-800 text-gray-500 dark:text-slate-400 border border-gray-200 dark:border-slate-700 hover:bg-green-50 dark:hover:bg-green-900/30 hover:text-green-600 dark:hover:text-green-400'}`}
              >
                Aprobados
              </button>
              <button
                onClick={() => setStatusFilter('rechazado')}
                className={`px-4 py-2 text-xs font-bold rounded-lg transition-all uppercase tracking-wide ${statusFilter === 'rechazado' ? 'bg-red-500 text-white shadow-md transform scale-105' : 'bg-white dark:bg-slate-800 text-gray-500 dark:text-slate-400 border border-gray-200 dark:border-slate-700 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400'}`}
              >
                Rechazados
              </button>
            </div>
          </div>


          {/* DESKTOP TABLE VIEW (HIDDEN ON MOBILE) */}
          <div className="hidden lg:flex bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 flex-col overflow-hidden transition-all">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse relative">
                <thead className="bg-gray-50 dark:bg-slate-800/50 border-b border-gray-200 dark:border-slate-800 text-base uppercase text-gray-500 dark:text-slate-300 font-bold tracking-wide">
                  <tr>
                    <th className="p-4 pl-6">Tienda</th>
                    <th className="p-4">Supervisor</th>
                    <th className="p-4 text-center">Fecha</th>
                    <th className="p-4 text-center">Turno</th>
                    <th className="p-4 text-center">Duración</th>
                    <th className="p-4 text-center">Score</th>
                    <th className="p-4 text-left">Estado</th>
                    <th className="p-4 text-left">Revisó</th>
                    <th className="p-4 text-center">Evidencia</th>
                    <th className="p-4 text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody className="text-base divide-y divide-gray-100 dark:divide-slate-800">
                  {errorMsg ? (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-red-500 font-bold">
                        {errorMsg}
                      </td>
                    </tr>
                  ) : inspections.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-gray-400 italic">No se encontraron inspecciones.</td>
                    </tr>
                  ) : (
                    inspections.map((item) => {
                      // Calculate Duration
                      let duration = item.duration || 'N/A'

                      // Si no viene la duración explícita pero hay tiempos, calcularla
                      if (duration === 'N/A' && item.start_time && item.end_time) {
                        try {
                          const startParts = item.start_time.split(':').map(Number)
                          const endParts = item.end_time.split(':').map(Number)
                          if (startParts.length >= 2 && endParts.length >= 2) {
                            const startMinutes = startParts[0] * 60 + startParts[1]
                            const endMinutes = endParts[0] * 60 + endParts[1]
                            let diff = endMinutes - startMinutes
                            if (diff < 0) diff += 24 * 60
                            const hours = Math.floor(diff / 60)
                            const mins = diff % 60
                            duration = hours > 0 ? `${hours}h ${mins}m` : `${mins} min`
                          }
                        } catch (e) { }
                      }

                      // [FIX] Infer shift if missing
                      let displayShift = item.shift
                      if (!displayShift && (item.start_time || item.inspection_time)) {
                        try {
                          const timeStr = item.start_time || item.inspection_time
                          const hour = parseInt(timeStr.split(':')[0], 10)
                          // Logic: Custom Business Hours
                          // AM = 6:00 to 16:59 (5 PM starts PM)
                          displayShift = (hour >= 6 && hour < 17) ? 'AM' : 'PM'
                        } catch (e) { }
                      }

                      return (
                        <tr
                          key={item.id}
                          onClick={() => handleRowClick(item)}
                          className="hover:bg-blue-50/50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors group border-b border-gray-50/50 dark:border-slate-800/50"
                        >
                          <td className="p-4 pl-6 font-black text-gray-900 dark:text-white text-lg">{item.store_name}</td>
                          <td className="p-4 text-gray-600 dark:text-slate-200 text-base font-semibold">{item.supervisor_name}</td>
                          <td className="p-4 text-center text-gray-500 dark:text-slate-400 text-base font-semibold">{formatDateLA(item.checklist_date)}</td>
                          <td className="p-4 text-center">
                            {displayShift ? (
                              <span className={`px-2.5 py-1 rounded text-base font-black uppercase ${displayShift === 'AM' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'}`}>
                                {displayShift}
                              </span>
                            ) : (
                              <span className="text-gray-300 dark:text-slate-600 font-bold text-base">-</span>
                            )}
                          </td>
                          <td className="p-4 text-center">
                            <span className="text-sm font-bold text-gray-500 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 px-2 py-1 rounded-full">{duration}</span>
                          </td>
                          <td className="p-4 text-center">
                            <span className={`text-xl font-black ${item.overall_score >= 87 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                              {item.overall_score}%
                            </span>
                          </td>
                          <td className="p-4 text-left">
                            <div className="flex items-center justify-start gap-2">
                              <span className={`px-3 py-1 rounded-full text-xs font-black uppercase border tracking-wide ${getStatusColor(item.estatus_admin || 'pendiente')}`}>
                                {getStatusLabel(item.estatus_admin || 'pendiente')}
                              </span>
                              {item.has_comments && (
                                <div className="p-1 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-full border border-blue-100 dark:border-blue-900/30" title="Hay comentarios">
                                  <MessageCircleMore size={16} strokeWidth={2.5} />
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="p-4 text-left text-sm text-gray-600 dark:text-slate-400">
                            {item.reviso_admin || '-'}
                          </td>
                          <td className="p-4 text-center">
                            {(item.photos && item.photos.length > 0) ? (
                              <div className="flex items-center justify-center">
                                <span className="text-sm font-bold text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-slate-800 px-3 py-1 rounded-full border border-gray-200 dark:border-slate-700">
                                  {item.photos.length} Fotos
                                </span>
                              </div>
                            ) : (
                              <span className="text-gray-300 text-xs font-medium">-</span>
                            )}
                          </td>

                          <td className="p-4 text-center">
                            <button
                              onClick={(e) => handleEdit(item, e)}
                              className="p-2 text-gray-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors"
                              title="Editar Inspección"
                            >
                              <Edit size={18} />
                            </button>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* MOBILE CARDS VIEW (VISIBLE ONLY ON MOBILE) */}
          <div className="lg:hidden space-y-4">
            {inspections.map((item) => (
              <div
                key={item.id}
                onClick={() => handleRowClick(item)}
                className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-2xl p-5 shadow-sm border border-gray-200 dark:border-slate-800 active:scale-[0.98] transition-transform"
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="flex flex-col">
                    <h3 className="text-lg font-black text-gray-900 dark:text-white leading-tight">{item.store_name}</h3>
                    <span className="text-sm font-bold text-gray-500 dark:text-slate-400 mt-1">{formatDateLA(item.checklist_date)}</span>
                  </div>
                  <span className={`text-2xl font-black ${item.overall_score >= 87 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                    {item.overall_score}%
                  </span>
                </div>

                <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-50 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className={`px-3 py-1 rounded-md text-xs font-black uppercase tracking-wide border ${getStatusColor(item.estatus_admin || 'pendiente')}`}>
                      {getStatusLabel(item.estatus_admin || 'pendiente')}
                    </span>
                    {item.has_comments && (
                      <div className="p-1 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-full border border-blue-100 dark:border-blue-900/30">
                        <MessageCircleMore size={18} strokeWidth={3} />
                      </div>
                    )}
                    <span className={`px-2.5 py-0.5 rounded text-xs font-bold ${item.shift === 'AM' ? 'bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' : 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'}`}>
                      {item.shift}
                    </span>
                  </div>

                  {item.photos && item.photos.length > 0 && (
                    <div className="flex items-center gap-1">
                      {item.photos.slice(0, 2).map((url: string, idx: number) => (
                        <img
                          key={idx}
                          src={getEmbeddableImageUrl(url)}
                          alt={`Evidence ${idx + 1}`}
                          className="w-8 h-8 object-cover rounded-md border border-gray-200 shadow-sm"
                          referrerPolicy="no-referrer"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                        />
                      ))}
                      {item.photos.length > 2 && (
                        <span className="w-8 h-8 rounded-md bg-blue-50 text-blue-600 text-[10px] font-bold flex items-center justify-center border border-blue-100">
                          +{item.photos.length - 2}
                        </span>
                      )}
                    </div>
                  )}

                  <button
                    onClick={(e) => handleEdit(item, e)}
                    className="p-2 -mr-2 text-gray-400 hover:text-indigo-600 active:bg-indigo-50 rounded-full"
                  >
                    <Edit size={20} />
                  </button>
                </div>
              </div>
            ))}
            {inspections.length === 0 && !loading && (
              <div className="text-center text-gray-400 py-10 font-bold">No hay inspecciones.</div>
            )}
          </div>

          <div className="h-16"></div> {/* Bottom Spacer */}
        </div>

      </div>

      {/* Review Modal */}
      {
        selectedInspection && user && (
          <ChecklistReviewModal
            isOpen={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            checklist={selectedInspection}
            currentUser={{
              id: user.id || 0,
              name: user.name || user.email || 'Usuario',
              email: user.email || '',
              role: user.role || 'viewer'
            }}
            onUpdate={fetchData}
          />
        )
      }
    </div >
  )
}

export default function InspeccionesPage() {
  return (
    <ProtectedRoute allowedRoles={['supervisor', 'admin', 'manager', 'auditor']}>
      <InspeccionesContent />
    </ProtectedRoute>
  )
}