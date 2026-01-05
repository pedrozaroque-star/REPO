'use client'

import { useEffect, useState } from 'react'
import { Store, MapPin, Search, Plus } from 'lucide-react'

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
      <div className="flex h-screen items-center justify-center bg-transparent">
        <div className="text-center animate-pulse">
          <Store size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-400 font-medium">Cargando sucursales...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden bg-transparent font-sans pt-16 md:pt-0">
      <main className="flex-1 flex flex-col h-full w-full relative">

        {/* STICKY HEADER - Mobile & Desktop */}
        <div className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-20 shrink-0">
          <div className="max-w-7xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between gap-4">

            {/* Title Area */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-orange-100 flex items-center justify-center text-orange-600">
                <Store size={18} />
              </div>
              <h1 className="text-lg md:text-xl font-black text-gray-900 tracking-tight">Tiendas</h1>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              <div className="hidden md:flex relative group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-orange-500 transition-colors" size={16} />
                <input
                  type="text"
                  placeholder="Buscar sucursal..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 pr-4 py-1.5 rounded-full bg-gray-100 border-none outline-none focus:ring-2 focus:ring-orange-200 text-sm font-medium w-64 transition-all"
                />
              </div>

              <button
                onClick={() => alert('Función de agregar tienda pendiente de implementación')}
                className="w-8 h-8 md:w-auto md:h-auto md:px-4 md:py-1.5 rounded-full bg-gray-900 text-white flex items-center justify-center gap-2 hover:bg-black transition-transform active:scale-95 shadow-lg shadow-gray-200"
              >
                <Plus size={16} strokeWidth={3} />
                <span className="hidden md:inline font-bold text-xs tracking-wide">NUEVA TIENDA</span>
              </button>
            </div>
          </div>
        </div>

        {/* MAIN CONTENT AREA - Scrollable */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 max-w-7xl mx-auto w-full pb-24">

          {/* Mobile Search - Visible only on small screens */}
          <div className="md:hidden sticky top-0 z-10 -mt-2 mb-6">
            <div className="relative group shadow-lg shadow-gray-200/50 rounded-full">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="Buscar por nombre, código..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-11 pr-4 py-3 rounded-full bg-white border border-gray-100 outline-none focus:border-orange-300 text-sm font-bold text-gray-900 placeholder:text-gray-400"
              />
            </div>
          </div>

          {/* Stats Summary - Now Scrollable */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100">
              <p className="text-[10px] md:text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Total</p>
              <p className="text-2xl md:text-3xl font-black text-gray-900">{stores.length}</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100">
              <p className="text-[10px] md:text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Activas</p>
              <p className="text-2xl md:text-3xl font-black text-green-600">{stores.filter(s => s.is_active).length}</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100">
              <p className="text-[10px] md:text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Feedbacks</p>
              <p className="text-2xl md:text-3xl font-black text-blue-600">{storesWithStats.reduce((sum, s) => sum + (s.stats?.feedbackCount || 0), 0)}</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100">
              <p className="text-[10px] md:text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Checklists</p>
              <p className="text-2xl md:text-3xl font-black text-purple-600">{storesWithStats.reduce((sum, s) => sum + (s.stats?.checklistCount || 0), 0)}</p>
            </div>
          </div>

          {/* Stores Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {filteredStores.map((store) => (
              <div
                key={store.id}
                className="bg-white rounded-3xl shadow-[0_2px_15px_-5px_rgba(0,0,0,0.05)] hover:shadow-lg transition-transform hover:-translate-y-1 active:scale-[0.98] border border-gray-100 overflow-hidden group"
              >
                <div className="p-5">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1 min-w-0 pr-4">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="bg-orange-100 text-orange-700 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider">
                          {store.code || 'S/C'}
                        </span>
                        {store.is_active ? (
                          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        ) : (
                          <div className="w-2 h-2 rounded-full bg-red-400" />
                        )}
                      </div>
                      <h3 className="text-lg font-black text-gray-900 leading-tight truncate">
                        {store.name}
                      </h3>
                      <div className="flex items-center gap-1.5 text-gray-500 mt-1">
                        <MapPin size={12} className="shrink-0" />
                        <p className="text-xs font-medium truncate">
                          {store.city}, {store.state}
                        </p>
                      </div>
                    </div>
                  </div>

                  {store.supervisor_name && (
                    <div className="mb-4 bg-gray-50 rounded-xl p-3 flex items-center gap-3 border border-gray-100">
                      <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-xs shadow-sm border border-gray-100">👮‍♂️</div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Supervisor</p>
                        <p className="text-xs font-bold text-gray-900 truncate">{store.supervisor_name}</p>
                      </div>
                    </div>
                  )}

                  {/* Stats Grid inside card */}
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    <div className="bg-blue-50/50 rounded-xl p-3 text-center border border-blue-100">
                      <p className="text-[10px] font-bold text-blue-400 uppercase">NPS</p>
                      <p className="text-xl font-black text-blue-600">{store.stats?.avgNPS || 0}</p>
                    </div>
                    <div className="bg-green-50/50 rounded-xl p-3 text-center border border-green-100">
                      <p className="text-[10px] font-bold text-green-400 uppercase">Score</p>
                      <p className="text-xl font-black text-green-600">{store.stats?.avgInspection || 0}%</p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-2 border-t border-gray-50">
                    <button
                      onClick={() => setSelectedStore(selectedStore?.id === store.id ? null : store)}
                      className={`flex-1 py-2.5 rounded-xl font-black text-xs transition-colors ${selectedStore?.id === store.id ? 'bg-gray-100 text-gray-600' : 'bg-gray-900 text-white hover:bg-black'}`}
                    >
                      {selectedStore?.id === store.id ? 'OCULTAR' : 'DETALLES'}
                    </button>
                  </div>

                  {/* Expanded Details */}
                  {selectedStore?.id === store.id && (
                    <div className="mt-4 pt-4 border-t border-dashed border-gray-200">
                      <div className="space-y-3 text-xs">
                        <div className="flex justify-between items-center">
                          <span className="text-gray-500 font-medium">Dirección</span>
                          <span className="font-bold text-gray-800 text-right max-w-[60%]">{store.address}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-gray-500 font-medium">Teléfono</span>
                          <span className="font-bold text-gray-800">{store.phone || 'N/A'}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-gray-500 font-medium">Horario</span>
                          <span className="font-bold text-gray-800">{store.hours || 'N/A'}</span>
                        </div>
                      </div>
                    </div>
                  )}

                </div>
              </div>
            ))}
          </div>

          {filteredStores.length === 0 && (
            <div className="text-center py-20 opacity-50">
              <Store size={64} className="mx-auto text-gray-300 mb-4" />
              <p className="text-gray-900 font-bold">No se encontraron tiendas</p>
              <p className="text-sm text-gray-500">Intenta con otra búsqueda</p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}