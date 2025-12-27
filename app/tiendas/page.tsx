'use client'

import { useEffect, useState } from 'react'
import Sidebar from '@/components/Sidebar'

export default function TiendasPage() {
  const [stores, setStores] = useState<any[]>([])
  const [storesWithStats, setStoresWithStats] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedStore, setSelectedStore] = useState<any>(null)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      
      // Obtener tiendas con supervisor
      const storesRes = await fetch(
  `${url}/rest/v1/stores?select=*`,
        {
          headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` }
        }
      )
      const storesData = await storesRes.json()
      setStores(Array.isArray(storesData) ? storesData : [])
      
      // Obtener estadísticas para cada tienda
      const storesWithStatsPromises = (Array.isArray(storesData) ? storesData : []).map(async (store) => {
        // Feedbacks
        const feedbackRes = await fetch(
          `${url}/rest/v1/customer_feedback?store_id=eq.${store.id}&select=nps_score`,
          {
            headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` }
          }
        )
        const feedbacks = await feedbackRes.json()
        
        // Inspecciones
        const inspRes = await fetch(
          `${url}/rest/v1/supervisor_inspections?store_id=eq.${store.id}&select=overall_score`,
          {
            headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` }
          }
        )
        const inspections = await inspRes.json()
        
        // Checklists
        const checkRes = await fetch(
          `${url}/rest/v1/assistant_checklists?store_id=eq.${store.id}&select=id`,
          {
            headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` }
          }
        )
        const checklists = await checkRes.json()
        
        // Calcular promedios
        const avgNPS = Array.isArray(feedbacks) && feedbacks.length > 0
          ? Math.round(feedbacks.reduce((sum, f) => sum + (f.nps_score || 0), 0) / feedbacks.length)
          : 0
        
        const avgInspection = Array.isArray(inspections) && inspections.length > 0
          ? Math.round(inspections.reduce((sum, i) => sum + (i.overall_score || 0), 0) / inspections.length)
          : 0
        
        return {
          ...store,
          stats: {
            feedbackCount: Array.isArray(feedbacks) ? feedbacks.length : 0,
            inspectionCount: Array.isArray(inspections) ? inspections.length : 0,
            checklistCount: Array.isArray(checklists) ? checklists.length : 0,
            avgNPS,
            avgInspection
          }
        }
      })
      
      const storesWithStatsData = await Promise.all(storesWithStatsPromises)
      setStoresWithStats(storesWithStatsData)
      
      setLoading(false)
    } catch (err) {
      console.error('Error:', err)
      setLoading(false)
    }
  }

  const filteredStores = storesWithStats.filter(store => 
    store.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    store.code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    store.city?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  if (loading) {
    return (
      <div className="flex">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-6xl mb-4">🏪</div>
            <p className="text-gray-600">Cargando tiendas...</p>
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
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Tiendas</h1>
            <p className="text-gray-600 mt-2">Gestión de ubicaciones de Tacos Gavilan</p>
          </div>

          {/* Stats Summary */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-red-600">
              <p className="text-sm font-medium text-gray-600">Total Tiendas</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{stores.length}</p>
            </div>
            <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-green-600">
              <p className="text-sm font-medium text-gray-600">Activas</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">
                {stores.filter(s => s.is_active).length}
              </p>
            </div>
            <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-blue-600">
              <p className="text-sm font-medium text-gray-600">Total Feedbacks</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">
                {storesWithStats.reduce((sum, s) => sum + (s.stats?.feedbackCount || 0), 0)}
              </p>
            </div>
            <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-purple-600">
              <p className="text-sm font-medium text-gray-600">Total Checklists</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">
                {storesWithStats.reduce((sum, s) => sum + (s.stats?.checklistCount || 0), 0)}
              </p>
            </div>
          </div>

          {/* Search */}
          <div className="mb-6">
            <input
              type="text"
              placeholder="Buscar por nombre, código o ciudad..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-red-500 focus:border-transparent"
            />
          </div>

          {/* Stores Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredStores.map((store) => (
              <div
                key={store.id}
                className="bg-white rounded-xl shadow-md hover:shadow-lg transition-shadow overflow-hidden"
              >
                <div className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <h3 className="text-xl font-bold text-gray-900 mb-1">
                        {store.name}
                      </h3>
                      <p className="text-sm text-gray-600">
                        {store.city}, {store.state}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        Código: {store.code}
                      </p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      store.is_active 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {store.is_active ? 'Activa' : 'Inactiva'}
                    </span>
                  </div>

                  {/* Address */}
                  <div className="mb-4 text-sm text-gray-600">
                    <p>{store.address}</p>
                    {store.phone && (
                      <p className="mt-1">📞 {store.phone}</p>
                    )}
                  </div>

                  {/* Supervisor */}
{/* Supervisor */}
                  {store.supervisor_name && (
                    <div className="mb-4 bg-blue-50 rounded-lg p-3 border border-blue-100">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">👮‍♂️</span>
                        <div>
                          <p className="text-xs text-blue-600 font-bold uppercase tracking-wider">Supervisor</p>
                          <p className="text-sm font-bold text-gray-900">
                            {store.supervisor_name}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Stats */}
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-xs text-gray-600 mb-1">NPS Promedio</p>
                      <p className="text-lg font-bold text-blue-600">
                        {store.stats?.avgNPS || 0}
                      </p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-xs text-gray-600 mb-1">Inspección</p>
                      <p className="text-lg font-bold text-green-600">
                        {store.stats?.avgInspection || 0}%
                      </p>
                    </div>
                  </div>

                  {/* Activity counts */}
                  <div className="flex items-center justify-between text-xs text-gray-600 pt-3 border-t border-gray-200">
                    <span>💬 {store.stats?.feedbackCount || 0} feedbacks</span>
                    <span>📋 {store.stats?.inspectionCount || 0} inspecciones</span>
                    <span>✅ {store.stats?.checklistCount || 0} checks</span>
                  </div>

                  {/* View Details Button */}
                  <button
                    onClick={() => setSelectedStore(selectedStore?.id === store.id ? null : store)}
                    className="w-full mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition-colors"
                  >
                    {selectedStore?.id === store.id ? 'Ocultar Detalles' : 'Ver Detalles'}
                  </button>
                </div>

                {/* Extended Details */}
                {selectedStore?.id === store.id && (
                  <div className="bg-gray-50 p-6 border-t border-gray-200">
                    <h4 className="font-bold text-gray-900 mb-3">Información Adicional</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Capacidad:</span>
                        <span className="font-semibold">{store.capacity || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Horario:</span>
                        <span className="font-semibold">{store.hours || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Creada:</span>
                        <span className="font-semibold">
                          {new Date(store.created_at).toLocaleDateString('es-MX')}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {filteredStores.length === 0 && (
            <div className="text-center py-12">
              <div className="text-6xl mb-4">🔍</div>
              <p className="text-gray-600">No se encontraron tiendas</p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}