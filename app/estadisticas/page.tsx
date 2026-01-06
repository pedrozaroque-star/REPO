'use client'

import { useEffect, useState } from 'react'

import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

export default function EstadisticasPage() {
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchStats()
  }, [])

  const fetchStats = async () => {
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

      // Feedbacks por tienda
      const feedbacksRes = await fetch(
        `${url}/rest/v1/customer_feedback?select=*,stores(name)`,
        { headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` } }
      )
      const feedbacks = await feedbacksRes.json()

      // Inspecciones por tienda
      const inspRes = await fetch(
        `${url}/rest/v1/supervisor_inspections?select=*,stores(name)`,
        { headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` } }
      )
      const inspections = await inspRes.json()

      // Checklists por tipo
      const checkRes = await fetch(
        `${url}/rest/v1/assistant_checklists?select=checklist_type`,
        { headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` } }
      )
      const checklists = await checkRes.json()

      // Procesar datos
      const feedbacksByStore = processFeedbacksByStore(Array.isArray(feedbacks) ? feedbacks : [])
      const inspectionsByStore = processInspectionsByStore(Array.isArray(inspections) ? inspections : [])
      const checklistsByType = processChecklistsByType(Array.isArray(checklists) ? checklists : [])
      const npsDistribution = processNPSDistribution(Array.isArray(feedbacks) ? feedbacks : [])

      setStats({
        feedbacksByStore,
        inspectionsByStore,
        checklistsByType,
        npsDistribution
      })

      setLoading(false)
    } catch (err) {
      console.error('Error:', err)
      setLoading(false)
    }
  }

  const processFeedbacksByStore = (feedbacks: any[]) => {
    const grouped = feedbacks.reduce((acc, f) => {
      const store = f.stores?.name || 'Sin tienda'
      if (!acc[store]) acc[store] = { count: 0, totalNPS: 0 }
      acc[store].count++
      acc[store].totalNPS += f.nps_score || 0
      return acc
    }, {})

    return Object.entries(grouped)
      .map(([name, data]: [string, any]) => ({
        name: name.length > 15 ? name.substring(0, 15) + '...' : name,
        feedbacks: data.count,
        avgNPS: Math.round(data.totalNPS / data.count)
      }))
      .sort((a, b) => b.feedbacks - a.feedbacks)
      .slice(0, 10)
  }

  const processInspectionsByStore = (inspections: any[]) => {
    const grouped = inspections.reduce((acc, i) => {
      const store = i.stores?.name || 'Sin tienda'
      if (!acc[store]) acc[store] = { count: 0, totalScore: 0 }
      acc[store].count++
      acc[store].totalScore += i.overall_score || 0
      return acc
    }, {})

    return Object.entries(grouped)
      .map(([name, data]: [string, any]) => ({
        name: name.length > 15 ? name.substring(0, 15) + '...' : name,
        inspecciones: data.count,
        avgScore: Math.round(data.totalScore / data.count)
      }))
      .sort((a, b) => b.inspecciones - a.inspecciones)
      .slice(0, 10)
  }

  const processChecklistsByType = (checklists: any[]) => {
    const types = ['daily', 'temperaturas', 'producto_sobrante', 'recorrido', 'cierre', 'apertura']
    return types.map(type => ({
      name: type.charAt(0).toUpperCase() + type.slice(1),
      value: checklists.filter(c => c.checklist_type === type).length
    }))
  }

  const processNPSDistribution = (feedbacks: any[]) => {
    return [
      { category: 'Promotores (9-10)', value: feedbacks.filter(f => f.nps_score >= 9).length, color: '#10b981' },
      { category: 'Pasivos (7-8)', value: feedbacks.filter(f => f.nps_score >= 7 && f.nps_score <= 8).length, color: '#f59e0b' },
      { category: 'Detractores (0-6)', value: feedbacks.filter(f => f.nps_score <= 6).length, color: '#ef4444' }
    ]
  }

  if (loading) {
    return (
      <div className="flex">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-6xl mb-4">📊</div>
            <p className="text-gray-600">Cargando estadísticas...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex bg-transparent w-full animate-in fade-in duration-500">

      <main className="flex-1 overflow-y-auto p-8 w-full">
        <div className="max-w-7xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Estadísticas Avanzadas</h1>
            <p className="text-gray-600 mt-2">Análisis visual de datos del sistema</p>
          </div>

          <div className="space-y-8">
            {/* Feedbacks por Tienda */}
            <div className="bg-white rounded-xl shadow-md p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-6">Feedbacks por Tienda (Top 10)</h2>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={stats.feedbacksByStore}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="feedbacks" fill="#ef4444" name="Cantidad" />
                  <Bar dataKey="avgNPS" fill="#3b82f6" name="NPS Promedio" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Inspecciones por Tienda */}
            <div className="bg-white rounded-xl shadow-md p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-6">Inspecciones por Tienda (Top 10)</h2>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={stats.inspectionsByStore}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="inspecciones" stroke="#8b5cf6" strokeWidth={2} name="Cantidad" />
                  <Line type="monotone" dataKey="avgScore" stroke="#10b981" strokeWidth={2} name="Score Promedio" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Checklists por Tipo */}
              <div className="bg-white rounded-xl shadow-md p-6">
                <h2 className="text-xl font-bold text-gray-900 mb-6">Checklists por Tipo</h2>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={stats.checklistsByType}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }: any) => `${name}: ${(percent * 100).toFixed(0)}%`}
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {stats.checklistsByType.map((entry: any, index: number) => (
                        <Cell key={`cell-${index}`} fill={['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'][index % 6]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Distribución NPS */}
              <div className="bg-white rounded-xl shadow-md p-6">
                <h2 className="text-xl font-bold text-gray-900 mb-6">Distribución NPS</h2>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={stats.npsDistribution}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ category, percent }: any) => `${category?.split(' ')[0]}: ${(percent * 100).toFixed(0)}%`}
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {stats.npsDistribution.map((entry: any, index: number) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}