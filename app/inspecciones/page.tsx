'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import ReviewModal from '@/components/ReviewModal'
import { getStatusColor, getStatusLabel, formatDateLA } from '@/lib/checklistPermissions'

function InspeccionesContent() {
  const router = useRouter()
  const { user } = useAuth()
  const [inspections, setInspections] = useState<any[]>([])
  const [stats, setStats] = useState({
    total: 0,
    pendientes: 0,
    cerrados: 0,
    avgOverall: 0,
    avgServicio: 0,
    avgCarnes: 0,
    avgAlimentos: 0,
    avgTortillas: 0,
    avgLimpieza: 0,
    avgBitacoras: 0,
    avgAseo: 0
  })
  const [loading, setLoading] = useState(true)
  const [storeFilter, setStoreFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [stores, setStores] = useState<any[]>([])
  const [showReviewModal, setShowReviewModal] = useState(false)

  useEffect(() => {
    fetchData()
  }, [storeFilter, statusFilter])

  const fetchData = async () => {
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      
      // Obtener tiendas
      const storesRes = await fetch(`${url}/rest/v1/stores?select=*&order=name.asc`, {
        headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` }
      })
      const storesData = await storesRes.json()
      setStores(Array.isArray(storesData) ? storesData : [])
      
      // Obtener inspecciones
      let inspUrl = `${url}/rest/v1/supervisor_inspections?select=*,stores(name,code),users(full_name)&order=inspection_date.desc,created_at.desc&limit=100`
      
      if (storeFilter !== 'all') {
        inspUrl += `&store_id=eq.${storeFilter}`
      }
      
      const inspRes = await fetch(inspUrl, {
        headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` }
      })
      const inspData = await inspRes.json()
      
      let formattedData = Array.isArray(inspData) ? inspData.map(item => ({
        ...item,
        store_name: item.stores?.name || 'N/A',
        supervisor_name: item.users?.full_name || item.supervisor_name
      })) : []
      
      // Filtrar por estado si aplica
      if (statusFilter !== 'all') {
        formattedData = formattedData.filter(item => {
          const status = item.estatus_admin || 'pendiente'
          return status === statusFilter
        })
      }
      
      setInspections(formattedData)
      
      // Calcular estadísticas
      const allInspUrl = `${url}/rest/v1/supervisor_inspections?select=overall_score,servicio_score,carnes_score,alimentos_score,tortillas_score,limpieza_score,bitacoras_score,aseo_score,estatus_admin`
      const allInspRes = await fetch(allInspUrl, {
        headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` }
      })
      const allInsp = await allInspRes.json()
      const allInspArray = Array.isArray(allInsp) ? allInsp : []
      
      const calcAvg = (field: string) => 
        allInspArray.length > 0 
          ? Math.round((allInspArray.reduce((sum: number, i: any) => sum + (i[field] || 0), 0) / allInspArray.length) * 10) / 10
          : 0
      
      setStats({
        total: allInspArray.length,
        pendientes: allInspArray.filter(i => (i.estatus_admin || 'pendiente') === 'pendiente').length,
        cerrados: allInspArray.filter(i => (i.estatus_admin || 'pendiente') === 'cerrado').length,
        avgOverall: calcAvg('overall_score'),
        avgServicio: calcAvg('servicio_score'),
        avgCarnes: calcAvg('carnes_score'),
        avgAlimentos: calcAvg('alimentos_score'),
        avgTortillas: calcAvg('tortillas_score'),
        avgLimpieza: calcAvg('limpieza_score'),
        avgBitacoras: calcAvg('bitacoras_score'),
        avgAseo: calcAvg('aseo_score')
      })
      
      setLoading(false)
    } catch (err) {
      console.error('Error:', err)
      setLoading(false)
    }
  }

  const getScoreColor = (score: number) => {
    if (score >= 90) return 'text-green-600'
    if (score >= 80) return 'text-yellow-600'
    if (score >= 70) return 'text-orange-600'
    return 'text-red-600'
  }

  const getStatusBadge = (item: any) => {
    const status = item.estatus_admin || 'pendiente'
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
    return role === 'admin'
  }

  const canCreate = () => {
    const role = user?.role?.toLowerCase()
    return role === 'supervisor' || role === 'admin'
  }

  if (loading) {
    return (
      <div className="flex min-h-screen bg-gray-50">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-6xl mb-4">📋</div>
            <p className="text-gray-600">Cargando inspecciones...</p>
          </div>
        </div>
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      
      <main className="flex-1 p-8">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Inspecciones de Supervisor</h1>
            <p className="text-gray-600 mt-2">Inspecciones realizadas por supervisores en diferentes tiendas</p>
          </div>

          {/* Estadísticas */}
          <div className="grid grid-cols-2 md:grid-cols-5 lg:grid-cols-10 gap-4 mb-8">
            <div className="bg-white rounded-xl shadow-md p-4 border-l-4 border-indigo-600">
              <p className="text-xs font-medium text-gray-600">Total</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{stats.total}</p>
            </div>
            <div className="bg-white rounded-xl shadow-md p-4 border-l-4 border-yellow-600">
              <p className="text-xs font-medium text-gray-600">Pendientes</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{stats.pendientes}</p>
            </div>
            <div className="bg-white rounded-xl shadow-md p-4 border-l-4 border-blue-600">
              <p className="text-xs font-medium text-gray-600">Cerrados</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{stats.cerrados}</p>
            </div>
            <div className="bg-white rounded-xl shadow-md p-4 border-l-4 border-purple-600">
              <p className="text-xs font-medium text-gray-600">Promedio</p>
              <p className={`text-2xl font-bold mt-1 ${getScoreColor(stats.avgOverall)}`}>{stats.avgOverall}</p>
            </div>
            <div className="bg-white rounded-xl shadow-md p-4 border-l-4 border-green-600">
              <p className="text-xs font-medium text-gray-600">Servicio</p>
              <p className={`text-2xl font-bold mt-1 ${getScoreColor(stats.avgServicio)}`}>{stats.avgServicio}</p>
            </div>
            <div className="bg-white rounded-xl shadow-md p-4 border-l-4 border-red-600">
              <p className="text-xs font-medium text-gray-600">Carnes</p>
              <p className={`text-2xl font-bold mt-1 ${getScoreColor(stats.avgCarnes)}`}>{stats.avgCarnes}</p>
            </div>
            <div className="bg-white rounded-xl shadow-md p-4 border-l-4 border-orange-600">
              <p className="text-xs font-medium text-gray-600">Alimentos</p>
              <p className={`text-2xl font-bold mt-1 ${getScoreColor(stats.avgAlimentos)}`}>{stats.avgAlimentos}</p>
            </div>
            <div className="bg-white rounded-xl shadow-md p-4 border-l-4 border-pink-600">
              <p className="text-xs font-medium text-gray-600">Tortillas</p>
              <p className={`text-2xl font-bold mt-1 ${getScoreColor(stats.avgTortillas)}`}>{stats.avgTortillas}</p>
            </div>
            <div className="bg-white rounded-xl shadow-md p-4 border-l-4 border-teal-600">
              <p className="text-xs font-medium text-gray-600">Limpieza</p>
              <p className={`text-2xl font-bold mt-1 ${getScoreColor(stats.avgLimpieza)}`}>{stats.avgLimpieza}</p>
            </div>
            <div className="bg-white rounded-xl shadow-md p-4 border-l-4 border-cyan-600">
              <p className="text-xs font-medium text-gray-600">Aseo</p>
              <p className={`text-2xl font-bold mt-1 ${getScoreColor(stats.avgAseo)}`}>{stats.avgAseo}</p>
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
                      <option value="cerrado">Cerrados</option>
                    </select>
                  </div>
                )}
              </div>

              <div className="flex gap-3">
                {canReview() && inspections.length > 0 && (
                  <button
                    onClick={() => setShowReviewModal(true)}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg font-semibold transition-all shadow-md">
                    ✓ Revisar Inspecciones
                  </button>
                )}
                {canCreate() && (
                  <button
                    onClick={() => router.push('/inspecciones/nueva')}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-semibold transition-all shadow-md">
                    + Nueva Inspección
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Lista de Inspecciones */}
          <div className="bg-white rounded-xl shadow-md overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Fecha</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Sucursal</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Supervisor</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">General</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Servicio</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Carnes</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Limpieza</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Observaciones</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Estado</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {inspections.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-6 py-8 text-center text-gray-500">
                        No hay inspecciones registradas
                      </td>
                    </tr>
                  ) : (
                    inspections.map((item) => (
                      <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">
                            {formatDateLA(item.inspection_date || item.created_at)}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {item.store_name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {item.supervisor_name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`text-lg font-bold ${getScoreColor(item.overall_score)}`}>
                            {item.overall_score}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`text-sm font-semibold ${getScoreColor(item.servicio_score)}`}>
                            {item.servicio_score}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`text-sm font-semibold ${getScoreColor(item.carnes_score)}`}>
                            {item.carnes_score}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`text-sm font-semibold ${getScoreColor(item.limpieza_score)}`}>
                            {item.limpieza_score}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          {item.observaciones ? (
                            <span className="text-xs text-orange-600 font-semibold">⚠️ Sí</span>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {getStatusBadge(item)}
                        </td>
                      </tr>
                    ))
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
          checklists={inspections}
          checklistType="supervisor"
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

export default function InspeccionesPage() {
  return (
    <ProtectedRoute>
      <InspeccionesContent />
    </ProtectedRoute>
  )
}