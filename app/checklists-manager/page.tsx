'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { FileCheck, Plus, Filter, MessageCircleMore } from 'lucide-react'

import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import ChecklistReviewModal from '@/components/ChecklistReviewModal'
import { canEditChecklist, getStatusColor, getStatusLabel, formatDateLA, isOverdue } from '@/lib/checklistPermissions'
import { getSupabaseClient, formatStoreName } from '@/lib/supabase'

function ManagerChecklistsContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { user } = useAuth()
  const [checklists, setChecklists] = useState<any[]>([])
  const [stats, setStats] = useState({
    total: 0,
    pendientes: 0,
    aprobados: 0,
    rechazados: 0,
    cerrados: 0
  })
  const [loading, setLoading] = useState(true)
  const [storeFilter, setStoreFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [stores, setStores] = useState<any[]>([])
  const [showReviewModal, setShowReviewModal] = useState(false)
  const [selectedItem, setSelectedItem] = useState<any>(null)
  // ... (existing state) ...

  // EFECTO: Deep Linking para abrir modal desde notificación
  useEffect(() => {
    const checkUrlForModal = async () => {
      const id = searchParams.get('id')
      if (id && checklists.length > 0 && !showReviewModal) {
        // 1. Buscar en lista actual
        const found = checklists.find(c => c.id.toString() === id)
        if (found) {
          setSelectedItem(found)
          setShowReviewModal(true)
        } else {
          // Si no está, buscar individualmente
          try {
            const supabase = await getSupabaseClient()
            const { data, error } = await supabase
              .from('manager_checklists')
              .select('*, stores(name, code), users(full_name)')
              .eq('id', id)
              .single()

            if (data) {
              const formatted = {
                ...data,
                store_name: formatStoreName(data.stores?.name) || 'N/A',
                manager_real_name: data.users?.full_name || data.manager_name
              }
              setSelectedItem(formatted)
              setShowReviewModal(true)
            }
          } catch (e) {
            console.error('Error deep link:', e)
          }
        }
      }
    }

    if (!loading) {
      checkUrlForModal()
    }
  }, [searchParams, checklists, loading])

  useEffect(() => {
    if (user) fetchData()
  }, [storeFilter, statusFilter, user])

  const fetchData = async () => {
    try {
      setLoading(true)

      const supabaseClient = await getSupabaseClient()
      const { data: storesList } = await supabaseClient.from('stores').select('*')
      setStores(Array.isArray(storesList) ? storesList : [])

      // Aseguramos sesión síncrona
      const token = localStorage.getItem('teg_token')
      if (token) await supabaseClient.auth.setSession({ access_token: token, refresh_token: '' })

      let query = supabaseClient.from('manager_checklists').select(`
          *,
          stores (name, code),
          users (full_name)
        `)
        .order('checklist_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(100)

      // Filtros seguros
      if (storeFilter !== 'all') {
        query = query.eq('store_id', storeFilter)
      }

      const { data: checkData, error } = await query
      if (error) throw error

      // Fetch Comments Count
      const checkIds = (checkData || []).map(c => c.id)
      let commentCounts: Record<string, number> = {}

      if (checkIds.length > 0) {
        const { data: commentsData } = await supabaseClient
          .from('inspection_comments')
          .select('inspection_id')
          .in('inspection_id', checkIds)

        if (commentsData) {
          commentsData.forEach((c: any) => {
            commentCounts[c.inspection_id] = (commentCounts[c.inspection_id] || 0) + 1
          })
        }
      }

      let formattedData = Array.isArray(checkData) ? checkData.map(item => ({
        ...item,
        store_name: formatStoreName(item.stores?.name) || 'N/A',
        manager_real_name: item.users?.full_name || item.manager_name || item.created_by,
        checklist_type: 'manager',
        has_comments: commentCounts[item.id] > 0
      })) : []

      if (statusFilter !== 'all') {
        const role = user?.role?.toLowerCase()
        const reviewLevel = role === 'admin' ? 'admin' : role === 'supervisor' ? 'supervisor' : null

        if (reviewLevel) {
          formattedData = formattedData.filter(item => {
            const status = item[`estatus_${reviewLevel}`] || 'pendiente'
            return status === statusFilter
          })
        }
      }

      setChecklists(formattedData)

      // Stats
      const { data: allChecks } = await supabaseClient.from('manager_checklists').select('estatus_supervisor,estatus_admin')
      const allChecksArray = Array.isArray(allChecks) ? allChecks : []

      const role = user?.role?.toLowerCase()
      const statusField = role === 'admin' ? 'estatus_admin' : role === 'supervisor' ? 'estatus_supervisor' : 'estatus_supervisor'

      setStats({
        total: allChecksArray.length,
        pendientes: allChecksArray.filter(c => (c[statusField] || 'pendiente') === 'pendiente').length,
        aprobados: allChecksArray.filter(c => (c[statusField] || 'pendiente') === 'aprobado').length,
        rechazados: allChecksArray.filter(c => (c[statusField] || 'pendiente') === 'rechazado').length,
        cerrados: allChecksArray.filter(c => (c[statusField] || 'pendiente') === 'cerrado').length
      })

      setLoading(false)
    } catch (err) {
      console.error('Error:', err)
      setLoading(false)
    }
  }

  const getStatusBadge = (item: any) => {
    const role = user?.role?.toLowerCase()
    let status = 'pendiente'

    if (role === 'admin') {
      status = item.estatus_admin || 'pendiente'
    } else if (role === 'supervisor') {
      status = item.estatus_supervisor || 'pendiente'
    } else {
      status = item.estatus_supervisor || 'pendiente'
    }

    const colorClass = getStatusColor(status)
    const label = getStatusLabel(status)

    return (
      <span className={`px-2 py-1 rounded text-xs font-semibold border ${colorClass}`}>
        {label}
      </span>
    )
  }

  const canReview = () => {
    const role = user?.role?.toLowerCase()
    return role === 'supervisor' || role === 'admin'
  }

  const canCreate = () => {
    const role = user?.role?.toLowerCase()
    return role === 'manager' || role === 'admin'
  }

  const handleEdit = (item: any) => {
    if (!user) return
    const editCheck = canEditChecklist(item.created_at, user.role, item.user_id, user.id, item.estatus_supervisor)
    if (!editCheck.canEdit) {
      alert(editCheck.reason)
      return
    }
    router.push(`/checklists-manager/editar/${item.id}`)
  }

  const canUserEdit = (item: any) => {
    if (!user) return false
    const editCheck = canEditChecklist(item.created_at, user.role, item.user_id, user.id, item.estatus_supervisor)
    return editCheck.canEdit
  }

  if (loading) {
    return (
      <div className="flex min-h-screen">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-6xl mb-4">👔</div>
            <p className="text-gray-600">Cargando checklists de manager...</p>
          </div>
        </div>
      </div>
    )
  }

  if (!user) return null

  // --- DISEÑO ACTUALIZADO MOBILE-FIRST ---
  return (
    <div className="flex bg-transparent font-sans w-full animate-in fade-in duration-500">
      <main className="flex-1 flex flex-col h-full w-full relative">

        {/* STICKY HEADER - Mobile & Desktop */}
        <div className="bg-white border-b border-gray-200 shadow-sm sticky top-14 lg:top-0 z-30 shrink-0">
          <div className="max-w-7xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between gap-4">
            {/* Title Area */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600">
                <FileCheck size={18} />
              </div>
              <div>
                <h1 className="text-lg md:text-xl font-black text-gray-900 tracking-tight leading-none">Checklists</h1>
                <p className="hidden md:block text-xs text-gray-400 font-medium">Gestión de supervisión (53 pts)</p>
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
                  <option value="all">Todas las sucursales</option>
                  {stores.map(store => (
                    <option key={store.id} value={store.id}>{formatStoreName(store.name)}</option>
                  ))}
                </select>
              </div>

              {canCreate() && (
                <button
                  onClick={() => router.push('/checklists/crear/manager')}
                  className="w-8 h-8 md:w-auto md:h-auto md:px-4 md:py-1.5 rounded-full bg-blue-600 text-white flex items-center justify-center gap-2 hover:bg-blue-700 transition-transform active:scale-95 shadow-lg shadow-blue-200"
                >
                  <Plus size={16} strokeWidth={3} />
                  <span className="hidden md:inline font-bold text-xs tracking-wide">NUEVO CHECKLIST</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* SCROLLABLE CONTENT */}
        <div className="flex-1 overflow-y-auto w-full max-w-7xl mx-auto p-4 md:p-8 pb-24">

          {/* Mobile Filters */}
          <div className="md:hidden sticky top-0 z-10 -mt-2 mb-6 space-y-3">
            <div className="relative group shadow-lg shadow-gray-200/50 rounded-full">
              <select
                value={storeFilter}
                onChange={(e) => setStoreFilter(e.target.value)}
                className="w-full pl-4 pr-10 py-3 rounded-full bg-white border border-gray-100 outline-none focus:border-indigo-300 text-sm font-bold text-gray-900 appearance-none"
              >
                <option value="all">Todas las sucursales</option>
                {stores.map(store => (
                  <option key={store.id} value={store.id}>{formatStoreName(store.name)}</option>
                ))}
              </select>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
                <Filter size={16} />
              </div>
            </div>

            {canReview() && (
              <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                {['all', 'pendiente', 'aprobado', 'rechazado'].map(status => (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(status)}
                    className={`px-4 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-colors border ${statusFilter === status
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white text-gray-500 border-gray-200'
                      }`}
                  >
                    {status === 'all' ? 'Todos' : getStatusLabel(status)}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Stats Cards - Adaptive Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 lg:gap-4 mb-6 lg:mb-8">
            <div className="bg-white rounded-2xl shadow-sm p-3 md:p-4 border-l-4 border-indigo-500 border-y border-r border-gray-100">
              <p className="text-[10px] md:text-xs font-bold text-gray-400 uppercase">Total</p>
              <p className="text-xl md:text-2xl font-black text-gray-900 md:mt-1">{stats.total}</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm p-3 md:p-4 border-l-4 border-yellow-500 border-y border-r border-gray-100">
              <p className="text-[10px] md:text-xs font-bold text-gray-400 uppercase">Pendientes</p>
              <p className="text-xl md:text-2xl font-black text-gray-900 md:mt-1">{stats.pendientes}</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm p-3 md:p-4 border-l-4 border-green-500 border-y border-r border-gray-100">
              <p className="text-[10px] md:text-xs font-bold text-gray-400 uppercase">Aprobados</p>
              <p className="text-xl md:text-2xl font-black text-gray-900 md:mt-1">{stats.aprobados}</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm p-3 md:p-4 border-l-4 border-red-500 border-y border-r border-gray-100">
              <p className="text-[10px] md:text-xs font-bold text-gray-400 uppercase">Rechazados</p>
              <p className="text-xl md:text-2xl font-black text-gray-900 md:mt-1">{stats.rechazados}</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm p-3 md:p-4 border-l-4 border-blue-500 border-y border-r border-gray-100 col-span-2 md:col-span-1">
              <p className="text-[10px] md:text-xs font-bold text-gray-400 uppercase">Cerrados</p>
              <p className="text-xl md:text-2xl font-black text-gray-900 md:mt-1">{stats.cerrados}</p>
            </div>
          </div>

          {/* CHECKLISTS LIST - Mobile Cards & Desktop Table */}
          {checklists.length === 0 ? (
            <div className="text-center py-20 opacity-50">
              <FileCheck size={64} className="mx-auto text-gray-300 mb-4" />
              <p className="text-gray-900 font-bold">No hay checklists registrados</p>
            </div>
          ) : (
            <>
              {/* MOBILE CARDS (Hidden on Desktop) */}
              <div className="lg:hidden space-y-4">
                {checklists.map((item) => {
                  const scoreColor = item.score >= 87 ? 'text-green-600' : item.score >= 70 ? 'text-orange-600' : 'text-red-600'
                  const canEdit = canUserEdit(item)
                  const isItemOverdue = isOverdue(item.created_at, item.estatus_admin || item.estatus_supervisor)

                  return (
                    <div
                      key={item.id}
                      onClick={() => {
                        if (canReview()) {
                          setSelectedItem(item)
                          setShowReviewModal(true)
                        }
                      }}
                      className={`bg-white rounded-3xl p-5 shadow-[0_2px_15px_-5px_rgba(0,0,0,0.05)] border transition-all active:scale-[0.98] ${isItemOverdue ? 'border-red-200 bg-red-50/30' : 'border-gray-100'}`}
                    >
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-black text-lg text-gray-900">{item.store_name}</h3>
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase ${item.shift === 'AM' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-800'}`}>
                              {item.shift}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 font-medium">{formatDateLA(item.checklist_date || item.created_at)}</p>
                        </div>
                        <div className="text-right">
                          <span className={`text-2xl font-black ${scoreColor}`}>{item.score}%</span>
                          <div className="mt-1 flex items-center justify-end gap-1">
                            {getStatusBadge(item)}
                            {(item as any).has_comments && (
                              <div className="p-0.5 text-blue-600 bg-blue-50 rounded-full border border-blue-100" title="Hay mensajes en el chat">
                                <MessageCircleMore size={14} strokeWidth={2.5} />
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-3 border-t border-dashed border-gray-100">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-xs">👤</div>
                          <span className="text-xs font-bold text-gray-600 truncate max-w-[120px]">{item.manager_real_name}</span>
                        </div>
                        {canEdit && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleEdit(item)
                            }}
                            className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-bold"
                          >
                            ✏️ EDITAR
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* DESKTOP TABLE (Hidden on Mobile) */}
              <div className="hidden lg:block bg-white rounded-xl shadow-md overflow-hidden border border-gray-100">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-6 py-4 text-left text-xs font-bold text-gray-400 uppercase tracking-wider">Fecha</th>
                        <th className="px-6 py-4 text-left text-xs font-bold text-gray-400 uppercase tracking-wider">Sucursal</th>
                        <th className="px-6 py-4 text-left text-xs font-bold text-gray-400 uppercase tracking-wider">Turno</th>
                        <th className="px-6 py-4 text-left text-xs font-bold text-gray-400 uppercase tracking-wider">Manager</th>
                        <th className="px-6 py-4 text-center text-xs font-bold text-gray-400 uppercase tracking-wider">Duración</th>
                        <th className="px-6 py-4 text-center text-xs font-bold text-gray-400 uppercase tracking-wider">Score</th>
                        <th className="px-6 py-4 text-left text-xs font-bold text-gray-400 uppercase tracking-wider">Estado</th>
                        <th className="px-6 py-4 text-center text-xs font-bold text-gray-400 uppercase tracking-wider">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {checklists.map((item) => {
                        const scoreColor = item.score >= 87 ? 'text-green-600' : item.score >= 70 ? 'text-orange-600' : 'text-red-600'
                        const canEdit = canUserEdit(item)
                        const isItemOverdue = isOverdue(item.created_at, item.estatus_admin || item.estatus_supervisor)

                        // Calculate Duration
                        let duration = 'N/A'
                        if (item.start_time && item.end_time) {
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

                        return (
                          <tr
                            key={item.id}
                            className={`hover:bg-gray-50/80 transition-colors cursor-pointer ${isItemOverdue ? 'bg-red-50/50' : ''}`}
                            onClick={() => {
                              // Allow opening modal for everyone (read-only for non-reviewers)
                              setSelectedItem(item)
                              setShowReviewModal(true)
                            }}
                          >
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm font-bold text-gray-900">{formatDateLA(item.checklist_date || item.created_at)}</div>
                              <div className="text-xs text-gray-400">{item.start_time} - {item.end_time}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-700">{item.store_name}</td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`px-2 py-1 rounded text-xs font-bold ${item.shift === 'AM' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'}`}>
                                {item.shift}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{item.manager_real_name}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-center">
                              <span className="text-xs font-bold text-gray-500 bg-gray-100 px-2 py-1 rounded-full">{duration}</span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-center">
                              <span className={`text-lg font-black ${scoreColor}`}>{item.score}%</span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-left">
                              <div className="flex items-center justify-start gap-2">
                                {getStatusBadge(item)}
                                {(item as any).has_comments && (
                                  <div className="p-1 text-blue-600 bg-blue-50 rounded-full border border-blue-100" title="Hay mensajes en el chat">
                                    <MessageCircleMore size={16} strokeWidth={2.5} />
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-center">
                              {canEdit && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleEdit(item)
                                  }}
                                  className="text-blue-600 hover:text-blue-800 font-bold text-xs bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-colors"
                                >
                                  EDITAR
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

        </div>
      </main>

      {/* Modal de Revisiones */}
      {showReviewModal && user && selectedItem && (
        <ChecklistReviewModal
          isOpen={showReviewModal}
          onClose={() => {
            setShowReviewModal(false)
            setSelectedItem(null)
          }}
          checklist={selectedItem}
          currentUser={{
            id: user.id,
            name: user.name || user.email,
            email: user.email,
            role: user.role
          }}
          onUpdate={() => {
            setShowReviewModal(false)
            setSelectedItem(null)
            fetchData()
          }}
        />
      )}
    </div>
  )
}

export default function ManagerChecklistsPage() {
  return (
    <ProtectedRoute>
      <ManagerChecklistsContent />
    </ProtectedRoute>
  )
}