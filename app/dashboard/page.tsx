'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseClient } from '@/lib/supabase'
import {
  LayoutDashboard,
  Plus,
  BarChart3,
  Search,
  Store,
  Users,
  ClipboardList,
  FileText,
  MessageSquare,
  AlertTriangle,
  CheckCircle,
  Calendar,
  Clock,
  TrendingUp,
  Activity
} from 'lucide-react'

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
    criticalAlerts: [] as any[],
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
      const token = localStorage.getItem('teg_token')
      const supabase = await getSupabaseClient()

      if (token) {
        await supabase.auth.setSession({ access_token: token, refresh_token: '' })
      }

      // 1. Tiendas
      const { count: storesCount } = await supabase
        .from('stores')
        .select('*', { count: 'exact', head: true })

      // 2. Usuarios
      const { count: usersCount } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })

      // 3. Feedback: Obtener conteo y datos
      const { data: feedbacks } = await supabase
        .from('customer_feedback')
        .select('nps_score, submission_date')
        .order('submission_date', { ascending: false })

      // 4. Inspecciones
      const { data: inspections } = await supabase
        .from('supervisor_inspections')
        .select('overall_score, estatus_admin')
        .limit(100)

      // 5. Checklists (Assistant)
      const { data: assistantChecklists } = await supabase
        .from('assistant_checklists')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100)

      // 6. Manager Checklists
      const { count: managerCheckCount } = await supabase.from('manager_checklists').select('*', { count: 'exact', head: true })

      // 7. Recent Activity (Unified)
      const { data: recentSups } = await supabase
        .from('supervisor_inspections')
        .select('*, stores(name, code), users!inspector_id(full_name)')
        .order('created_at', { ascending: false })
        .limit(10)

      const { data: recentAssist } = await supabase
        .from('assistant_checklists')
        .select('*, stores(name, code)')
        .order('created_at', { ascending: false })
        .limit(10)

      // Merge and Sort
      const combinedActivity = [
        ...(recentSups || []).map(s => ({
          ...s,
          activityType: 'Inspección',
          userLabel: (s as any).users?.full_name || 'Supervisor',
          storeLabel: (s as any).stores?.name || 'Tienda',
          date: s.inspection_date || s.created_at,
          scoreLabel: s.overall_score
        })),
        ...(recentAssist || []).map(a => ({
          ...a,
          activityType: `Checklist: ${a.checklist_type?.toUpperCase()}`,
          userLabel: a.user_name || 'Asistente',
          storeLabel: (a as any).stores?.name || a.store_name || 'Tienda',
          date: a.checklist_date || a.created_at,
          scoreLabel: a.score
        }))
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 10)

      const validFeedbacks = feedbacks || []
      const validInspections = inspections || []
      const validAssistant = assistantChecklists || []

      const now = new Date()
      const day = now.getDay() // 0 Sun, 1 Mon
      const diffSinceMonday = (day === 0 ? 6 : day - 1)
      const monday6AM = new Date(now)
      monday6AM.setDate(now.getDate() - diffSinceMonday)
      monday6AM.setHours(6, 0, 0, 0)

      const alerts: any[] = []
      validAssistant
        .filter(check => new Date(check.created_at) >= monday6AM)
        .forEach(check => {
          const type = check.checklist_type?.toLowerCase()
          const answers = check.answers || {}

          if (type === 'sobrante') {
            Object.entries(answers).forEach(([key, val]: [string, any]) => {
              if (key === '__question_photos') return
              const num = Number(typeof val === 'object' ? val.value : val)
              if (!isNaN(num) && num > 2) {
                alerts.push({
                  id: `waste-${check.id}-${key}`,
                  type: 'waste',
                  store: check.store_name,
                  msg: `Exceso de sobrante: ${key} (${num} Lbs)`,
                  date: check.created_at
                })
              }
            })
          }

          if (type === 'temperaturas') {
            Object.entries(answers).forEach(([key, val]: [string, any]) => {
              if (key === '__question_photos') return
              const num = Number(typeof val === 'object' ? val.value : val)
              if (isNaN(num)) return

              const isRefrig = key.toLowerCase().includes('refrig') || key.toLowerCase().includes('frio')
              const isFail = isRefrig ? (num < 34 || num > 41) : (num < 165)

              if (isFail) {
                alerts.push({
                  id: `temp-${check.id}-${key}`,
                  type: 'temp',
                  store: check.store_name,
                  msg: `Temp Fuera de Rango: ${key} (${num}°F)`,
                  date: check.created_at
                })
              }
            })
          }
        })

      // Calculations
      let promoters = 0
      let detractors = 0

      validFeedbacks.forEach((f: any) => {
        const score = f.nps_score || 0
        if (score >= 9) promoters++
        else if (score <= 6) detractors++
      })

      const totalFeedbacks = validFeedbacks.length
      const avgNPS = totalFeedbacks > 0
        ? Math.round(((promoters - detractors) / totalFeedbacks) * 100)
        : 0

      const inspSum = validInspections.reduce((sum: number, i: any) => sum + (i.overall_score || 0), 0)
      const assistSum = validAssistant.reduce((sum: number, i: any) => sum + (i.score || 0), 0)
      const totalScoreCount = validInspections.length + validAssistant.length

      const avgInspectionScore = totalScoreCount > 0
        ? Math.round((inspSum + assistSum) / totalScoreCount)
        : 0

      setStats({
        totalStores: storesCount || 0,
        totalUsers: usersCount || 0,
        totalFeedbacks: validFeedbacks.length,
        totalInspections: validInspections.length,
        totalChecklists: validAssistant.length + (managerCheckCount || 0),
        avgNPS,
        avgInspectionScore,
        criticalAlerts: alerts.slice(0, 5),
        recentActivity: combinedActivity
      })

      setLoading(false)
    } catch (err) {
      console.error('Error general en Dashboard:', err)
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex bg-gray-50 h-screen items-center justify-center">
        <div className="text-center animate-pulse">
          <LayoutDashboard size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-900 font-bold">Cargando dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-transparent font-sans w-full">
      {/* STICKY HEADER - Mobile & Desktop */}
      <div className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-20 shrink-0 transition-all top-[63px]">
        <div className="max-w-7xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between gap-4">
          {/* Title Area */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600">
              <TrendingUp size={18} />
            </div>
            <div>
              <h1 className="text-lg md:text-xl font-black text-gray-900 tracking-tight leading-none">Dashboard</h1>
              <p className="hidden md:block text-xs text-gray-400 font-medium">Vista general</p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.location.href = '/inspecciones/nueva'}
              className="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 md:px-4 md:py-2 rounded-xl font-bold text-xs md:text-sm flex items-center gap-2 shadow-lg shadow-red-200 transition-all active:scale-95"
            >
              <Plus size={16} strokeWidth={3} />
              <span className="hidden sm:inline">NUEVA INSPECCIÓN</span>
              <span className="sm:hidden">INSP.</span>
            </button>
            <button
              onClick={() => window.location.href = '/reportes'}
              className="bg-gray-100 text-gray-600 hover:bg-gray-200 p-2 md:px-4 md:py-2 rounded-xl font-bold text-xs md:text-sm flex items-center gap-2 transition-all"
            >
              <BarChart3 size={18} />
              <span className="hidden sm:inline">Reportes</span>
            </button>
          </div>
        </div>
      </div>

      <main className="w-full max-w-7xl mx-auto px-4 md:px-8 py-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* Quick Search */}
        <div className="bg-white rounded-2xl shadow-sm p-4 md:p-6 mb-8 border border-gray-100">
          <div className="flex items-center gap-2 mb-4">
            <div className="relative group flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-red-500 transition-colors" size={20} />
              <input
                type="text"
                placeholder="Búsqueda rápida..."
                className="w-full pl-11 pr-4 py-3 rounded-xl bg-gray-50 border-none outline-none focus:ring-2 focus:ring-red-100 text-sm font-bold text-gray-900 placeholder:text-gray-400 transition-all"
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
              className="bg-gray-900 text-white p-3 rounded-xl hover:bg-black transition-colors"
            >
              <Search size={20} />
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {[
              { label: 'Tiendas', href: '/tiendas', icon: Store },
              { label: 'Usuarios', href: '/usuarios', icon: Users },
              { label: 'Inspecciones', href: '/inspecciones', icon: ClipboardList },
              { label: 'Checklists', href: '/checklists', icon: FileText },
              { label: 'Feedback', href: '/feedback', icon: MessageSquare },
              { label: 'Reportes', href: '/reportes', icon: BarChart3 },
            ].map((item) => (
              <button
                key={item.label}
                onClick={() => window.location.href = item.href}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 hover:bg-gray-100 text-gray-600 text-xs font-bold rounded-lg border border-gray-100 transition-colors"
              >
                <item.icon size={14} />
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Main Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Tiendas', value: stats.totalStores, icon: Store, color: 'text-red-600', bg: 'bg-red-50' },
            { label: 'Usuarios', value: stats.totalUsers, icon: Users, color: 'text-blue-600', bg: 'bg-blue-50' },
            { label: 'Feedbacks', value: stats.totalFeedbacks, icon: MessageSquare, color: 'text-green-600', bg: 'bg-green-50' },
            { label: 'Checklists', value: stats.totalChecklists, icon: FileText, color: 'text-purple-600', bg: 'bg-purple-50' },
          ].map((stat) => (
            <div key={stat.label} className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100 flex flex-col items-center text-center hover:shadow-md transition-shadow">
              <div className={`w-10 h-10 ${stat.bg} ${stat.color} rounded-full flex items-center justify-center mb-2`}>
                <stat.icon size={20} />
              </div>
              <div className="text-2xl font-black text-gray-900">{stat.value}</div>
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wide">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Performance Metrics */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="bg-white rounded-3xl shadow-sm p-6 border border-gray-100">
            <h3 className="text-lg font-black text-gray-900 mb-6 flex items-center gap-2">
              <TrendingUp size={20} className="text-indigo-500" />
              NPS Promedio
            </h3>
            <div className="flex items-center justify-center py-4">
              <div className="relative w-48 h-48">
                <svg className="transform -rotate-90 w-48 h-48">
                  <circle
                    cx="96"
                    cy="96"
                    r="80"
                    stroke="#e5e7eb"
                    strokeWidth="12"
                    fill="none"
                    className="bg-gray-100"
                  />
                  <circle
                    cx="96"
                    cy="96"
                    r="80"
                    stroke={stats.avgNPS >= 50 ? '#10b981' : stats.avgNPS >= 0 ? '#fbbf24' : '#ef4444'}
                    strokeWidth="12"
                    fill="none"
                    strokeDasharray={`${(stats.avgNPS + 100) * 2.51} 502.4`}
                    strokeLinecap="round"
                    className="transition-all duration-1000 ease-out"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-5xl font-black text-gray-900">{stats.avgNPS}</span>
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">SCORE</span>
                </div>
              </div>
            </div>
            <p className="text-center text-xs font-medium text-gray-400 mt-2 bg-gray-50 py-2 rounded-lg">
              Basado en {stats.totalFeedbacks} feedbacks
            </p>
          </div>

          <div className="bg-white rounded-3xl shadow-sm p-6 border border-gray-100">
            <h3 className="text-lg font-black text-gray-900 mb-6 flex items-center gap-2">
              <ClipboardList size={20} className="text-indigo-500" />
              Score Inspecciones
            </h3>
            <div className="flex items-center justify-center py-4">
              <div className="relative w-48 h-48">
                <svg className="transform -rotate-90 w-48 h-48">
                  <circle
                    cx="96"
                    cy="96"
                    r="80"
                    stroke="#e5e7eb"
                    strokeWidth="12"
                    fill="none"
                  />
                  <circle
                    cx="96"
                    cy="96"
                    r="80"
                    stroke="#8b5cf6"
                    strokeWidth="12"
                    fill="none"
                    strokeDasharray={`${stats.avgInspectionScore * 5.024} 502.4`}
                    strokeLinecap="round"
                    className="transition-all duration-1000 ease-out"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-5xl font-black text-gray-900">{stats.avgInspectionScore}<span className="text-2xl text-gray-400">%</span></span>
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">PROMEDIO</span>
                </div>
              </div>
            </div>
            <p className="text-center text-xs font-medium text-gray-400 mt-2 bg-gray-50 py-2 rounded-lg">
              Basado en {stats.totalInspections} inspecciones
            </p>
          </div>
        </div>

        {/* Critical Alerts */}
        <div className="space-y-4 mb-8">
          {stats.criticalAlerts.map((alert) => (
            <div key={alert.id} className={`rounded-2xl p-4 flex items-start gap-4 border shadow-sm ${alert.type === 'waste' ? 'bg-orange-50 border-orange-200' : 'bg-red-50 border-red-200'} animate-in fade-in slide-in-from-top-4 duration-500`}>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${alert.type === 'waste' ? 'bg-orange-100 text-orange-600' : 'bg-red-100 text-red-600'}`}>
                <AlertTriangle size={20} />
              </div>
              <div className="flex-1">
                <div className="flex justify-between items-start">
                  <h4 className={`font-black text-sm uppercase tracking-tight ${alert.type === 'waste' ? 'text-orange-900' : 'text-red-900'}`}>
                    {alert.type === 'waste' ? 'Alerta de Desperdicio' : 'Alerta de Inocuidad'}
                  </h4>
                  <span className="text-[10px] font-bold text-gray-400">
                    {new Date(alert.date).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className={`text-sm font-bold mt-0.5 ${alert.type === 'waste' ? 'text-orange-800' : 'text-red-800'}`}>
                  {alert.store}: <span className="font-medium">{alert.msg}</span>
                </p>
              </div>
            </div>
          ))}

          {stats.avgNPS < 50 && stats.criticalAlerts.length === 0 && (
            <div className="bg-red-50 rounded-2xl p-4 flex items-start gap-4 border border-red-100">
              <div className="w-10 h-10 bg-red-100 text-red-600 rounded-full flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={20} />
              </div>
              <div>
                <h4 className="font-bold text-red-900">NPS Bajo Detectado</h4>
                <p className="text-sm text-red-700 mt-1">El NPS promedio ({stats.avgNPS}) está por debajo del objetivo de 50. Se requiere atención inmediata.</p>
              </div>
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-6 border-b border-gray-100 flex items-center gap-2">
            <Activity size={20} className="text-gray-400" />
            <h3 className="font-black text-gray-900">Actividad Reciente</h3>
          </div>
          <div className="divide-y divide-gray-100">
            {stats.recentActivity.map((activity, idx) => (
              <div key={idx} className="p-4 hover:bg-gray-50 flex flex-col md:flex-row gap-4 items-start md:items-center">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`px-2 py-0.5 rounded-md text-[10px] uppercase font-black tracking-wide border ${activity.activityType?.includes('Inspección')
                      ? 'bg-indigo-50 text-indigo-700 border-indigo-100'
                      : 'bg-emerald-50 text-emerald-700 border-emerald-100'
                      }`}>
                      {activity.activityType}
                    </span>
                    <h4 className="font-bold text-gray-900 text-sm">
                      {activity.storeLabel}
                    </h4>
                  </div>
                  <div className="flex items-center gap-4 text-xs font-medium text-gray-500">
                    <div className="flex items-center gap-1">
                      <Users size={12} />
                      {activity.userLabel}
                    </div>
                    <div className="flex items-center gap-1">
                      <Calendar size={12} />
                      {new Date(activity.date).toLocaleDateString('es-MX')}
                    </div>
                    {activity.shift && (
                      <div className="flex items-center gap-1">
                        <Clock size={12} />
                        {activity.shift}
                      </div>
                    )}
                  </div>
                </div>

                <div className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-black border ${activity.scoreLabel >= 90
                  ? 'bg-green-50 text-green-700 border-green-100'
                  : activity.scoreLabel >= 80
                    ? 'bg-yellow-50 text-yellow-700 border-yellow-100'
                    : 'bg-red-50 text-red-700 border-red-100'
                  }`}>
                  {activity.scoreLabel}% SCORE
                </div>
              </div>
            ))}

            {stats.recentActivity.length === 0 && (
              <div className="p-8 text-center text-gray-400 text-sm font-medium">No hay actividad reciente</div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}