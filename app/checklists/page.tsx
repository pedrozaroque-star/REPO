'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import { formatDateLA, getStatusColor, getStatusLabel } from '@/lib/checklistPermissions'
import { supabase } from '@/lib/supabase'

function ChecklistsContent() {
  const router = useRouter()
  const { user } = useAuth()
  const [checklists, setChecklists] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [stores, setStores] = useState<any[]>([])
  
  // Filtros
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedStore, setSelectedStore] = useState('')

  useEffect(() => {
    if (user) {
      fetchStores()
      fetchChecklists()
    }
  }, [user, selectedDate, selectedStore])

  const fetchStores = async () => {
    try {
      const { data } = await supabase.from('stores').select('*').order('name')
      setStores(data || [])
    } catch (err) {
      console.error('Error cargando tiendas:', err)
    }
  }

  const fetchChecklists = async () => {
    try {
      setLoading(true)
      
      let query = supabase
        .from('assistant_checklists')
        .select(`
          *,
          stores (name),
          users (full_name)
        `)
        .order('created_at', { ascending: false })

      // --- 🔒 FILTRO DE SEGURIDAD PARA ASISTENTES ---
      // Si es asistente, SOLO ve sus propios registros
      const role = (user?.role || '').toLowerCase()
      if (role === 'assistant' || role === 'asistente') {
        query = query.eq('user_id', user.id)
      } else {
        // Si no es asistente (Admin/Manager), respetamos el filtro de tienda seleccionado
        if (selectedStore) {
          query = query.eq('store_id', selectedStore)
        }
      }

      // Filtro de fecha (aplica para todos)
      if (selectedDate) {
        query = query.eq('checklist_date', selectedDate)
      }

      const { data, error } = await query

      if (error) throw error
      setChecklists(data || [])
    } catch (err) {
      console.error('Error cargando checklists:', err)
    } finally {
      setLoading(false)
    }
  }

  // Verificar si puede ver el filtro de tiendas
  const canFilterStores = user && !['assistant', 'asistente'].includes((user.role || '').toLowerCase())

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Checklists de Asistentes</h1>
              <p className="text-gray-600 mt-1">Historial de aperturas, cierres y rutinas</p>
            </div>
            
            <button
              onClick={() => router.push('/checklists/crear')}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-lg font-bold shadow-sm transition-all flex items-center gap-2"
            >
              <span>+</span> Nuevo Checklist
            </button>
          </div>

          {/* Filtros */}
          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 mb-6 flex flex-wrap gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Fecha</label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>
            
            {/* Solo mostramos el filtro de tiendas si NO es asistente */}
            {canFilterStores && (
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Sucursal</label>
                <select
                  value={selectedStore}
                  onChange={(e) => setSelectedStore(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none min-w-[200px]"
                >
                  <option value="">Todas las sucursales</option>
                  {stores.map(store => (
                    <option key={store.id} value={store.id}>{store.name}</option>
                  ))}
                </select>
              </div>
            )}
            
            {(selectedDate || selectedStore) && (
              <div className="flex items-end">
                <button 
                  onClick={() => { setSelectedDate(''); setSelectedStore('') }}
                  className="px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors font-medium"
                >
                  Limpiar filtros
                </button>
              </div>
            )}
          </div>

          {/* Tabla */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Fecha / Hora</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Sucursal</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Tipo</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Asistente</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Calificación</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Estado</th>
                    <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {loading ? (
                    <tr><td colSpan={7} className="p-8 text-center text-gray-500">Cargando datos...</td></tr>
                  ) : checklists.length === 0 ? (
                    <tr><td colSpan={7} className="p-8 text-center text-gray-500">No se encontraron registros.</td></tr>
                  ) : (
                    checklists.map((item) => (
                      <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-bold text-gray-900">{formatDateLA(item.checklist_date)}</div>
                          <div className="text-xs text-gray-500">{item.start_time?.substring(0, 5)} {item.end_time ? `- ${item.end_time.substring(0, 5)}` : ''}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {item.stores?.name || 'N/A'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="px-2 py-1 text-xs font-bold rounded-full bg-indigo-50 text-indigo-700 capitalize">
                            {item.checklist_type}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {item.users?.full_name || item.assistant_name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`text-sm font-black ${item.score >= 90 ? 'text-green-600' : item.score >= 70 ? 'text-yellow-600' : 'text-red-600'}`}>
                            {item.score}%
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs font-bold rounded-full border ${getStatusColor(item.estatus_manager)}`}>
                            {getStatusLabel(item.estatus_manager)}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <button
                            onClick={() => router.push(`/checklists/editar/${item.checklist_type}/${item.id}`)}
                            className="text-indigo-600 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100 px-3 py-1 rounded-lg transition-colors"
                          >
                            Ver / Editar
                          </button>
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
    </div>
  )
}

export default function ChecklistsPage() {
  return (
    <ProtectedRoute>
      <ChecklistsContent />
    </ProtectedRoute>
  )
}