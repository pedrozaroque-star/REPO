'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'

export default function DashboardPage() {
  const router = useRouter()
  const [stats, setStats] = useState({
    totalStores: 0,
    totalUsers: 0,
    totalFeedbacks: 0,
    totalInspections: 0,
    totalChecklists: 0,
    avgNPS: 0,
    avgInspectionScore: 0,
    recentActivity: [] as any[]
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const user = localStorage.getItem('teg_user')
    if (!user) {
      router.push('/')
      return
    }
    fetchStats()
  }, [router])

  const fetchStats = async () => {
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

      // Tiendas
      const storesRes = await fetch(`${url}/rest/v1/stores?select=id`, {
        headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` }
      })
      const stores = await storesRes.json()

      // Usuarios
      const usersRes = await fetch(`${url}/rest/v1/users?select=id`, {
        headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` }
      })
      const users = await usersRes.json()

      // Feedbacks
      const feedbacksRes = await fetch(`${url}/rest/v1/customer_feedback?select=nps_score`, {
        headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` }
      })
      const feedbacks = await feedbacksRes.json()

      // Inspecciones
      const inspectionsRes = await fetch(`${url}/rest/v1/supervisor_inspections?select=overall_score`, {
        headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` }
      })
      const inspections = await inspectionsRes.json()

      // Checklists
      const checklistsRes = await fetch(`${url}/rest/v1/assistant_checklists?select=id`, {
        headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` }
      })
      const checklists = await checklistsRes.json()

      // Actividad reciente - últimas inspecciones
      const recentRes = await fetch(
        `${url}/rest/v1/supervisor_inspections?select=*,stores(name),users(full_name)&order=inspection_date.desc&limit=5`,
        {
          headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` }
        }
      )
      const recent = await recentRes.json()

      // Calcular promedios
      const avgNPS = Array.isArray(feedbacks) && feedbacks.length > 0
        ? Math.round(feedbacks.reduce((sum, f) => sum + (f.nps_score || 0), 0) / feedbacks.length)
        : 0

      const avgInspectionScore = Array.isArray(inspections) && inspections.length > 0
        ? Math.round(inspections.reduce((sum, i) => sum + (i.overall_score || 0), 0) / inspections.length)
        : 0

      setStats({
        totalStores: Array.isArray(stores) ? stores.length : 0,
        totalUsers: Array.isArray(users) ? users.length : 0,
        totalFeedbacks: Array.isArray(feedbacks) ? feedbacks.length : 0,
        totalInspections: Array.isArray(inspections) ? inspections.length : 0,
        totalChecklists: Array.isArray(checklists) ? checklists.length : 0,
        avgNPS,
        avgInspectionScore,
        recentActivity: Array.isArray(recent) ? recent : []
      })

      setLoading(false)
    } catch (err) {
      console.error('Error:', err)
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-6xl mb-4">📊</div>
            <p className="text-gray-600">Cargando dashboard...</p>
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
          {/* Header */}
          <div className="mb-8 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
              <p className="text-gray-600 mt-2">Vista general del sistema TEG</p>
            </div>
            <div className="flex space-x-3">
              <button
                onClick={() => window.location.href = '/inspecciones/nueva'}
                className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg shadow-lg transition-colors"
              >
                ➕ Nueva Inspección
              </button>
              <button
                onClick={() => window.location.href = '/reportes'}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-lg transition-colors"
              >
                📊 Ver Reportes
              </button>
            </div>
          </div>
            {/* Quick Search */}
          <div className="bg-white rounded-xl shadow-md p-6 mb-8">
            <div className="flex items-center space-x-4">
              <div className="flex-1">
                <input
                  type="text"
                  placeholder="Búsqueda rápida: tiendas, usuarios, inspecciones..."
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-red-500"
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      const query = (e.target as HTMLInputElement).value
                      window.location.href = `/buscar?q=${encodeURIComponent(query)}`
                    }
                  }}
                />
              </div>
              <button 
                onClick={(e) => {
                  const input = (e.currentTarget.previousElementSibling?.querySelector('input') as HTMLInputElement)
                  if (input?.value) {
                    window.location.href = `/buscar?q=${encodeURIComponent(input.value)}`
                  }
                }}
                className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg"
              >
                🔍 Buscar
              </button>
            </div>
            <div className="flex flex-wrap gap-2 mt-4">
              <button 
                onClick={() => window.location.href = '/tiendas'}
                className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm rounded-full transition-colors"
              >
                🏪 Tiendas
              </button>
              <button 
                onClick={() => window.location.href = '/usuarios'}
                className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm rounded-full transition-colors"
              >
                👥 Usuarios
              </button>
              <button 
                onClick={() => window.location.href = '/inspecciones'}
                className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm rounded-full transition-colors"
              >
                📋 Inspecciones
              </button>
              <button 
                onClick={() => window.location.href = '/checklists'}
                className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm rounded-full transition-colors"
              >
                ✅ Checklists
              </button>
              <button 
                onClick={() => window.location.href = '/feedback'}
                className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm rounded-full transition-colors"
              >
                💬 Feedback
              </button>
              <button 
                onClick={() => window.location.href = '/reportes'}
                className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm rounded-full transition-colors"
              >
                📊 Reportes
              </button>
            </div>
          </div>
          

          {/* Main Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <div className="bg-gradient-to-br from-red-500 to-red-600 rounded-xl shadow-lg p-6 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-red-100 text-sm font-medium">Tiendas</p>
                  <p className="text-4xl font-bold mt-2">{stats.totalStores}</p>
                </div>
                <div className="text-5xl opacity-20">🏪</div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg p-6 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-blue-100 text-sm font-medium">Usuarios</p>
                  <p className="text-4xl font-bold mt-2">{stats.totalUsers}</p>
                </div>
                <div className="text-5xl opacity-20">👥</div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl shadow-lg p-6 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-green-100 text-sm font-medium">Feedbacks</p>
                  <p className="text-4xl font-bold mt-2">{stats.totalFeedbacks}</p>
                </div>
                <div className="text-5xl opacity-20">💬</div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl shadow-lg p-6 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-purple-100 text-sm font-medium">Checklists</p>
                  <p className="text-4xl font-bold mt-2">{stats.totalChecklists}</p>
                </div>
                <div className="text-5xl opacity-20">✅</div>
              </div>
            </div>
          </div>

          {/* Progress Overview */}
          <div className="bg-white rounded-xl shadow-md p-6 mb-8">
            <h3 className="text-lg font-bold text-gray-900 mb-6">📈 Progreso del Mes</h3>
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Meta de Feedbacks</span>
                  <span className="text-sm font-bold text-gray-900">{stats.totalFeedbacks}/200</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div 
                    className="bg-green-600 h-3 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min((stats.totalFeedbacks / 200) * 100, 100)}%` }}
                  ></div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Meta de Inspecciones</span>
                  <span className="text-sm font-bold text-gray-900">{stats.totalInspections}/150</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div 
                    className="bg-purple-600 h-3 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min((stats.totalInspections / 150) * 100, 100)}%` }}
                  ></div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Meta de Checklists</span>
                  <span className="text-sm font-bold text-gray-900">{stats.totalChecklists}/300</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div 
                    className="bg-blue-600 h-3 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min((stats.totalChecklists / 300) * 100, 100)}%` }}
                  ></div>
                </div>
              </div>
            </div>
          </div>

          {/* Performance Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div className="bg-white rounded-xl shadow-md p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">NPS Promedio</h3>
              <div className="flex items-center justify-center">
                <div className="relative w-48 h-48">
                  <svg className="transform -rotate-90 w-48 h-48">
                    <circle
                      cx="96"
                      cy="96"
                      r="80"
                      stroke="#e5e7eb"
                      strokeWidth="16"
                      fill="none"
                    />
                    <circle
                      cx="96"
                      cy="96"
                      r="80"
                      stroke={stats.avgNPS >= 50 ? '#10b981' : stats.avgNPS >= 0 ? '#f59e0b' : '#ef4444'}
                      strokeWidth="16"
                      fill="none"
                      strokeDasharray={`${(stats.avgNPS + 100) * 2.51} 502.4`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-4xl font-bold text-gray-900">{stats.avgNPS}</span>
                    <span className="text-sm text-gray-600">de 100</span>
                  </div>
                </div>
              </div>
              <p className="text-center text-sm text-gray-600 mt-4">
                Basado en {stats.totalFeedbacks} feedbacks de clientes
              </p>
            </div>

            <div className="bg-white rounded-xl shadow-md p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Score de Inspecciones</h3>
              <div className="flex items-center justify-center">
                <div className="relative w-48 h-48">
                  <svg className="transform -rotate-90 w-48 h-48">
                    <circle
                      cx="96"
                      cy="96"
                      r="80"
                      stroke="#e5e7eb"
                      strokeWidth="16"
                      fill="none"
                    />
                    <circle
                      cx="96"
                      cy="96"
                      r="80"
                      stroke="#10b981"
                      strokeWidth="16"
                      fill="none"
                      strokeDasharray={`${stats.avgInspectionScore * 5.024} 502.4`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-4xl font-bold text-gray-900">{stats.avgInspectionScore}%</span>
                    <span className="text-sm text-gray-600">promedio</span>
                  </div>
                </div>
              </div>
              <p className="text-center text-sm text-gray-600 mt-4">
                Basado en {stats.totalInspections} inspecciones
              </p>
            </div>
          </div>

          {/* Alertas */}
          <div className="bg-white rounded-xl shadow-md p-6 mb-8">
            <h3 className="text-lg font-bold text-gray-900 mb-4">⚠️ Alertas del Sistema</h3>
            <div className="space-y-3">
              {stats.avgNPS < 50 && (
                <div className="flex items-start space-x-3 p-4 bg-red-50 border-l-4 border-red-500 rounded">
                  <span className="text-2xl">🚨</span>
                  <div className="flex-1">
                    <p className="font-semibold text-red-900">NPS Bajo Detectado</p>
                    <p className="text-sm text-red-700">El NPS promedio ({stats.avgNPS}) está por debajo del objetivo de 50</p>
                  </div>
                </div>
              )}
              
              {stats.avgInspectionScore < 85 && (
                <div className="flex items-start space-x-3 p-4 bg-yellow-50 border-l-4 border-yellow-500 rounded">
                  <span className="text-2xl">⚠️</span>
                  <div className="flex-1">
                    <p className="font-semibold text-yellow-900">Score de Inspección Bajo</p>
                    <p className="text-sm text-yellow-700">El promedio de inspecciones ({stats.avgInspectionScore}%) está por debajo de 85%</p>
                  </div>
                </div>
              )}
              
              {stats.avgNPS >= 50 && stats.avgInspectionScore >= 85 && (
                <div className="flex items-start space-x-3 p-4 bg-green-50 border-l-4 border-green-500 rounded">
                  <span className="text-2xl">✅</span>
                  <div className="flex-1">
                    <p className="font-semibold text-green-900">Todo en Orden</p>
                    <p className="text-sm text-green-700">Todas las métricas están dentro de los objetivos</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Recent Activity */}
          <div className="bg-white rounded-xl shadow-md">
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-lg font-bold text-gray-900">Actividad Reciente</h3>
            </div>
            <div className="divide-y divide-gray-200">
              {stats.recentActivity.map((activity) => (
                <div key={activity.id} className="p-6 hover:bg-gray-50">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-3 mb-2">
                        <span className="px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-xs font-semibold">
                          📋 Inspección
                        </span>
                        <h4 className="font-bold text-gray-900">
                          {activity.stores?.name || 'Tienda'}
                        </h4>
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                          activity.overall_score >= 90 
                            ? 'bg-green-100 text-green-800' 
                            : activity.overall_score >= 80 
                            ? 'bg-yellow-100 text-yellow-800' 
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {activity.overall_score}%
                        </span>
                      </div>
                      <div className="flex items-center space-x-4 text-sm text-gray-600">
                        <span>👤 {activity.users?.full_name || 'Supervisor'}</span>
                        <span>📅 {new Date(activity.inspection_date).toLocaleDateString('es-MX')}</span>
                        <span>🕐 {activity.shift}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}