'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import ReviewModal from '@/components/ReviewModal'
import { canEditChecklist, getStatusColor, getStatusLabel, formatDateLA } from '@/lib/checklistPermissions'
import { supabase } from '@/lib/supabase' // <--- ÚNICO CAMBIO

function ManagerChecklistsContent() {
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

  useEffect(() => {
    if (user) fetchData()
  }, [storeFilter, statusFilter, user])

  const fetchData = async () => {
    try {
      setLoading(true)
      
      const { data: storesData } = await supabase.from('stores').select('*')
      setStores(Array.isArray(storesData) ? storesData : [])
      
      let query = supabase
        .from('manager_checklists')
        .select(`
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
      
      let formattedData = Array.isArray(checkData) ? checkData.map(item => ({
        ...item,
        store_name: item.stores?.name || 'N/A',
        manager_real_name: item.users?.full_name || item.manager_name || item.created_by
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
      const { data: allChecks } = await supabase.from('manager_checklists').select('estatus_supervisor,estatus_admin')
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
    const editCheck = canEditChecklist(item.created_at, user.role, item.user_id, user.id)
    if (!editCheck.canEdit) {
      alert(editCheck.reason)
      return
    }
    router.push(`/checklists-manager/editar/${item.id}`)
  }

  const canUserEdit = (item: any) => {
    if (!user) return false
    const editCheck = canEditChecklist(item.created_at, user.role, item.user_id, user.id)
    return editCheck.canEdit
  }

  if (loading) {
    return (
      <div className="flex min-h-screen bg-gray-50">
        <Sidebar />
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

  // --- DISEÑO ORIGINAL INTACTO ---
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      
      <main className="flex-1 p-8">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Checklists de Manager</h1>
            <p className="text-gray-600 mt-2">Gestión de checklists de supervisión (53 preguntas)</p>
          </div>

          {/* Estadísticas */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
            <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-indigo-600">
              <p className="text-sm font-medium text-gray-600">Total</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{stats.total}</p>
            </div>
            <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-yellow-600">
              <p className="text-sm font-medium text-gray-600">⏳ Pendientes</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{stats.pendientes}</p>
            </div>
            <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-green-600">
              <p className="text-sm font-medium text-gray-600">✅ Aprobados</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{stats.aprobados}</p>
            </div>
            <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-red-600">
              <p className="text-sm font-medium text-gray-600">❌ Rechazados</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{stats.rechazados}</p>
            </div>
            <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-blue-600">
              <p className="text-sm font-medium text-gray-600">🔒 Cerrados</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{stats.cerrados}</p>
            </div>
          </div>

          {/* Filtros y Acciones */}
          <div className="bg-white rounded-xl shadow-md p-6 mb-6">
            <div className="flex flex-wrap gap-4 items-center justify-between">
              <div className="flex flex-wrap gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Sucursal</label>
                  <select 
                    value={storeFilter} 
                    onChange={(e) => setStoreFilter(e.target.value)}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-transparent">
                    <option value="all">Todas las sucursales</option>
                    {stores.map(store => (
                      <option key={store.id} value={store.id}>{store.name}</option>
                    ))}
                  </select>
                </div>

                {canReview() && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Estado</label>
                    <select 
                      value={statusFilter} 
                      onChange={(e) => setStatusFilter(e.target.value)}
                      className="px-4 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-transparent">
                      <option value="all">Todos los estados</option>
                      <option value="pendiente">Pendientes</option>
                      <option value="aprobado">Aprobados</option>
                      <option value="rechazado">Rechazados</option>
                      <option value="cerrado">Cerrados</option>
                    </select>
                  </div>
                )}
              </div>

              <div className="flex gap-3">
                {canReview() && checklists.length > 0 && (
                  <button
                    onClick={() => setShowReviewModal(true)}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg font-semibold transition-all shadow-md">
                    ✓ Revisar Checklists
                  </button>
                )}
                {canCreate() && (
                  <button
                    onClick={() => router.push('/checklists-manager/crear')}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-semibold transition-all shadow-md">
                    + Crear Nuevo
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Lista de Checklists */}
          <div className="bg-white rounded-xl shadow-md overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Fecha</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Sucursal</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Turno</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Manager</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Score</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Estado</th>
                    {canReview() && (
                      <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Revisado por</th>
                    )}
                    <th className="px-6 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Acciones</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {checklists.length === 0 ? (
                    <tr>
                      <td colSpan={canReview() ? 8 : 7} className="px-6 py-8 text-center text-gray-500">
                        No hay checklists registrados
                      </td>
                    </tr>
                  ) : (
                    checklists.map((item) => {
                      const scoreColor = item.score >= 80 ? 'text-green-600' : item.score >= 60 ? 'text-orange-600' : 'text-red-600'
                      const canEdit = canUserEdit(item)
                      const role = user?.role?.toLowerCase()
                      const reviewLevel = role === 'admin' ? 'admin' : role === 'supervisor' ? 'supervisor' : null
                      
                      return (
                        <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">{formatDateLA(item.checklist_date || item.created_at)}</div>
                            <div className="text-xs text-gray-500">{item.start_time} - {item.end_time}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {item.store_name}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {item.shift}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {item.manager_real_name}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`text-lg font-bold ${scoreColor}`}>{item.score}%</span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {getStatusBadge(item)}
                          </td>
                          {canReview() && reviewLevel && (
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                              {item[`reviso_${reviewLevel}`] || '-'}
                            </td>
                          )}
                          <td className="px-6 py-4 whitespace-nowrap text-center">
                            {canEdit && (
                              <button
                                onClick={() => handleEdit(item)}
                                className="text-blue-600 hover:text-blue-800 font-semibold text-sm">
                                ✏️ Editar
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>

      {/* Modal de Revisiones */}
      {showReviewModal && user && (
        <ReviewModal
          isOpen={showReviewModal}
          onClose={() => setShowReviewModal(false)}
          checklists={checklists}
          checklistType="manager"
          currentUser={{
            id: user.id,
            name: user.name || user.email,
            email: user.email,
            role: user.role
          }}
          onSave={() => {
            setShowReviewModal(false)
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