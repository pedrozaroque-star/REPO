'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import ReviewModal from '@/components/ReviewModal'
import { canEditChecklist, getStatusColor, getStatusLabel, formatDateLA } from '@/lib/checklistPermissions'
import DetailsModal from '@/components/DetailsModal'

function ChecklistsContent() {
  const router = useRouter()
  const { user } = useAuth()
  const [checklists, setChecklists] = useState<any[]>([])
  const [stats, setStats] = useState({
    total: 0,
    daily: 0,
    temperaturas: 0,
    sobrante: 0,
    recorrido: 0,
    cierre: 0,
    apertura: 0
  })
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState('all')
  const [storeFilter, setStoreFilter] = useState('all')
  const [stores, setStores] = useState<any[]>([])
  const [showReviewModal, setShowReviewModal] = useState(false)
  const [detailsModal, setDetailsModal] = useState(false)
  const [selectedChecklist, setSelectedChecklist] = useState<any>(null)

  useEffect(() => {
    fetchData()
  }, [typeFilter, storeFilter])

  const fetchData = async () => {
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      
      const storesRes = await fetch(`${url}/rest/v1/stores?select=*`, {
        headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` }
      })
      const storesData = await storesRes.json()
      setStores(Array.isArray(storesData) ? storesData : [])
      
      let checkUrl = `${url}/rest/v1/assistant_checklists?select=*,stores(name,code),users!user_id(full_name)&order=checklist_date.desc,created_at.desc&limit=100`
      
      if (typeFilter !== 'all') {
        checkUrl += `&checklist_type=eq.${typeFilter}`
      }
      if (storeFilter !== 'all') {
        checkUrl += `&store_id=eq.${storeFilter}`
      }
      
      const checkRes = await fetch(checkUrl, {
        headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` }
      })
      const checkData = await checkRes.json()
      
      const formattedData = Array.isArray(checkData) ? checkData.map(item => ({
        ...item,
        store_name: item.stores?.name || 'N/A'
      })) : []
      
      setChecklists(formattedData)
      
      const allCheckUrl = `${url}/rest/v1/assistant_checklists?select=checklist_type`
      const allCheckRes = await fetch(allCheckUrl, {
        headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` }
      })
      const allChecks = await allCheckRes.json()
      const allChecksArray = Array.isArray(allChecks) ? allChecks : []
      
      setStats({
        total: allChecksArray.length,
        daily: allChecksArray.filter(c => c.checklist_type === 'daily').length,
        temperaturas: allChecksArray.filter(c => c.checklist_type === 'temperaturas').length,
        sobrante: allChecksArray.filter(c => c.checklist_type === 'sobrante').length,
        recorrido: allChecksArray.filter(c => c.checklist_type === 'recorrido').length,
        cierre: allChecksArray.filter(c => c.checklist_type === 'cierre').length,
        apertura: allChecksArray.filter(c => c.checklist_type === 'apertura').length
      })
      
      setLoading(false)
    } catch (err) {
      console.error('Error:', err)
      setLoading(false)
    }
  }

  const checklistTypes = [
    { value: 'daily', label: 'Daily Checklist', icon: '📝', color: 'border-blue-600' },
    { value: 'temperaturas', label: 'Temperaturas', icon: '🌡️', color: 'border-red-600' },
    { value: 'sobrante', label: 'Producto Sobrante', icon: '📦', color: 'border-yellow-600' },
    { value: 'recorrido', label: 'Recorrido', icon: '🚶', color: 'border-green-600' },
    { value: 'cierre', label: 'Cierre', icon: '🌙', color: 'border-purple-600' },
    { value: 'apertura', label: 'Apertura', icon: '🌅', color: 'border-orange-600' }
  ]

  const getTypeInfo = (type: string) => {
    return checklistTypes.find(t => t.value === type) || checklistTypes[0]
  }

  const getStatusBadge = (item: any) => {
    const status = item.estatus_manager || 'pendiente'
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
    return role === 'manager' || role === 'admin'
  }

  const handleEdit = (item: any) => {
    if (!user) return
    
    const editCheck = canEditChecklist(
      item.created_at,
      user.role,
      item.user_id,
      user.id,
      item.checklist_date,
      item.estatus_manager,
      item.estatus_manager
    )
    
    if (!editCheck.canEdit) {
      alert(editCheck.reason)
      return
    }
    
    router.push(`/checklists/editar/${item.id}`)
  }

  const canUserEdit = (item: any) => {
    if (!user) return false
    
    if (item.user_id !== user.id) return false
    
    const managerStatus = item.estatus_manager || 'pendiente'
    if (managerStatus !== 'pendiente') return false
    
    const checklistDateStr = item.checklist_date
    
    const today = new Date()
    const year = today.getFullYear()
    const month = String(today.getMonth() + 1).padStart(2, '0')
    const day = String(today.getDate()).padStart(2, '0')
    const todayStr = `${year}-${month}-${day}`
    
    return checklistDateStr === todayStr
  }

  if (loading) {
    return (
      <div className="flex min-h-screen bg-gray-50">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-6xl mb-4">📋</div>
            <p className="text-gray-600">Cargando checklists...</p>
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
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Checklists de Asistente</h1>
            <p className="text-gray-600 mt-2">Gestión de checklists diarios y controles</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-8">
            <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-indigo-600">
              <p className="text-sm font-medium text-gray-600">Total</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{stats.total}</p>
            </div>
            <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-blue-600">
              <p className="text-sm font-medium text-gray-600">📝 Daily</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{stats.daily}</p>
            </div>
            <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-red-600">
              <p className="text-sm font-medium text-gray-600">🌡️ Temps</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{stats.temperaturas}</p>
            </div>
            <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-yellow-600">
              <p className="text-sm font-medium text-gray-600">📦 Sobr</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{stats.sobrante}</p>
            </div>
            <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-green-600">
              <p className="text-sm font-medium text-gray-600">🚶 Recorr</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{stats.recorrido}</p>
            </div>
            <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-purple-600">
              <p className="text-sm font-medium text-gray-600">🌙 Cierre</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{stats.cierre}</p>
            </div>
            <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-orange-600">
              <p className="text-sm font-medium text-gray-600">🌅 Apert</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{stats.apertura}</p>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-md p-6 mb-6">
            <div className="flex flex-wrap gap-4 items-center justify-between">
              <div className="flex flex-wrap gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Tipo de checklist</label>
                  <select 
                    value={typeFilter} 
                    onChange={(e) => setTypeFilter(e.target.value)}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-transparent">
                    <option value="all">Todos los tipos</option>
                    {checklistTypes.map(type => (
                      <option key={type.value} value={type.value}>{type.icon} {type.label}</option>
                    ))}
                  </select>
                </div>

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
              </div>

              <div className="flex gap-3">
                {canReview() && checklists.length > 0 && (
                  <button
                    onClick={() => setShowReviewModal(true)}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg font-semibold transition-all shadow-md">
                    ✓ Revisar Checklists
                  </button>
                )}
                <button
                  onClick={() => router.push('/checklists/crear')}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-semibold transition-all shadow-md">
                  + Crear Nuevo
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-md overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Fecha</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Tipo</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Sucursal</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Turno</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Usuario</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Score</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Estado</th>
                    <th className="px-6 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Acciones</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {checklists.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-8 text-center text-gray-500">
                        No hay checklists registrados
                      </td>
                    </tr>
                  ) : (
                    checklists.map((item) => {
                      const typeInfo = getTypeInfo(item.checklist_type)
                      const scoreColor = item.score >= 80 ? 'text-green-600' : item.score >= 60 ? 'text-orange-600' : 'text-red-600'
                      const canEdit = canUserEdit(item)
                      
                      return (
                        <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">{formatDateLA(item.checklist_date || item.created_at)}</div>
                            <div className="text-xs text-gray-500">{item.start_time} - {item.end_time}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm font-medium text-gray-900">
                              {typeInfo.icon} {typeInfo.label}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {item.store_name}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {item.shift}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {item.assistant_name || item.created_by || 'N/A'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`text-lg font-bold ${scoreColor}`}>{item.score}%</span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {getStatusBadge(item)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-center">
                            <div className="flex gap-2 justify-center">
                              <button
                                onClick={() => {
                                  setSelectedChecklist(item)
                                  setDetailsModal(true)
                                }}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-sm font-semibold transition-all">
                                👁️ Ver
                              </button>
                              
                              {canEdit && (
                                <button
                                  onClick={() => handleEdit(item)}
                                  className="bg-yellow-600 hover:bg-yellow-700 text-white px-3 py-1 rounded text-sm font-semibold transition-all">
                                  ✏️ Editar
                                </button>
                              )}
                            </div>
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

      {showReviewModal && user && (
        <ReviewModal
          isOpen={showReviewModal}
          onClose={() => setShowReviewModal(false)}
          checklists={checklists}
          checklistType="assistant"
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

      <DetailsModal
        isOpen={detailsModal}
        onClose={() => {
          setDetailsModal(false)
          setSelectedChecklist(null)
        }}
        checklist={selectedChecklist}
        type="assistant"
      />
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