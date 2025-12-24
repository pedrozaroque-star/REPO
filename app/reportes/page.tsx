'use client'

import * as XLSX from 'xlsx'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from 'recharts'
import { useEffect, useState } from 'react'
import Sidebar from '@/components/Sidebar'

export default function ReportesPage() {
  const [stores, setStores] = useState<any[]>([])
  const [selectedStore, setSelectedStore] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [report, setReport] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchStores()
    
    const today = new Date()
    const monthAgo = new Date()
    monthAgo.setDate(today.getDate() - 30)
    
    setDateTo(today.toISOString().split('T')[0])
    setDateFrom(monthAgo.toISOString().split('T')[0])
  }, [])

  const fetchStores = async () => {
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      
      const res = await fetch(`${url}/rest/v1/stores?select=*&order=name.asc`, {
        headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` }
      })
      const data = await res.json()
      setStores(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Error:', err)
    }
  }

  const generateReport = async () => {
    setLoading(true)
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

      let storeFilter = selectedStore !== 'all' ? `&store_id=eq.${selectedStore}` : ''
      let dateFilter = `&submission_date=gte.${dateFrom}&submission_date=lte.${dateTo}T23:59:59`

      const feedbackRes = await fetch(
        `${url}/rest/v1/customer_feedback?select=*${storeFilter}${dateFilter}`,
        { headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` } }
      )
      const feedbacks = await feedbackRes.json()

      const inspRes = await fetch(
        `${url}/rest/v1/supervisor_inspections?select=*${storeFilter}&inspection_date=gte.${dateFrom}&inspection_date=lte.${dateTo}`,
        { headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` } }
      )
      const inspections = await inspRes.json()

      const checkRes = await fetch(
        `${url}/rest/v1/assistant_checklists?select=*${storeFilter}${dateFilter}`,
        { headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` } }
      )
      const checklists = await checkRes.json()

      const feedbacksArray = Array.isArray(feedbacks) ? feedbacks : []
      const inspectionsArray = Array.isArray(inspections) ? inspections : []
      const checklistsArray = Array.isArray(checklists) ? checklists : []

      const npsScores = feedbacksArray.filter(f => f.nps_score != null).map(f => f.nps_score)
      const avgNPS = npsScores.length > 0 
        ? Math.round(npsScores.reduce((a, b) => a + b, 0) / npsScores.length)
        : 0

      const promoters = feedbacksArray.filter(f => f.nps_category === 'promoter').length
      const passives = feedbacksArray.filter(f => f.nps_category === 'passive').length
      const detractors = feedbacksArray.filter(f => f.nps_category === 'detractor').length
      const npsScore = feedbacksArray.length > 0
        ? Math.round(((promoters - detractors) / feedbacksArray.length) * 100)
        : 0

      const avgInspection = inspectionsArray.length > 0
        ? Math.round(inspectionsArray.reduce((sum, i) => sum + (i.overall_score || 0), 0) / inspectionsArray.length)
        : 0

      const avgService = feedbacksArray.length > 0
        ? (feedbacksArray.reduce((sum, f) => sum + (f.service_rating || 0), 0) / feedbacksArray.length).toFixed(1)
        : 0

      const avgQuality = feedbacksArray.length > 0
        ? (feedbacksArray.reduce((sum, f) => sum + (f.food_quality_rating || 0), 0) / feedbacksArray.length).toFixed(1)
        : 0

      const avgCleanliness = feedbacksArray.length > 0
        ? (feedbacksArray.reduce((sum, f) => sum + (f.cleanliness_rating || 0), 0) / feedbacksArray.length).toFixed(1)
        : 0

      const avgSpeed = feedbacksArray.length > 0
        ? (feedbacksArray.reduce((sum, f) => sum + (f.speed_rating || 0), 0) / feedbacksArray.length).toFixed(1)
        : 0

      const checklistsByType = {
        daily: checklistsArray.filter(c => c.checklist_type === 'daily').length,
        temperaturas: checklistsArray.filter(c => c.checklist_type === 'temperaturas').length,
        producto_sobrante: checklistsArray.filter(c => c.checklist_type === 'producto_sobrante').length,
        recorrido: checklistsArray.filter(c => c.checklist_type === 'recorrido').length,
        cierre: checklistsArray.filter(c => c.checklist_type === 'cierre').length,
        apertura: checklistsArray.filter(c => c.checklist_type === 'apertura').length
      }

      setReport({
        feedbacks: {
          total: feedbacksArray.length,
          avgNPS,
          npsScore,
          promoters,
          passives,
          detractors,
          avgService,
          avgQuality,
          avgCleanliness,
          avgSpeed
        },
        inspections: {
          total: inspectionsArray.length,
          avgScore: avgInspection
        },
        checklists: {
          total: checklistsArray.length,
          byType: checklistsByType
        }
      })

      setLoading(false)
    } catch (err) {
      console.error('Error:', err)
      setLoading(false)
    }
  }

  const exportToExcel = () => {
    if (!report) return

    const wb = XLSX.utils.book_new()

    const summaryData = [
      ['REPORTE TACOS GAVILAN'],
      [''],
      ['Período:', `${dateFrom} a ${dateTo}`],
      ['Tienda:', selectedStore === 'all' ? 'Todas' : stores.find(s => s.id === selectedStore)?.name],
      [''],
      ['FEEDBACKS'],
      ['Total Feedbacks', report.feedbacks.total],
      ['NPS Score', report.feedbacks.npsScore],
      ['Promotores', report.feedbacks.promoters],
      ['Pasivos', report.feedbacks.passives],
      ['Detractores', report.feedbacks.detractors],
      ['Promedio Servicio', report.feedbacks.avgService],
      ['Promedio Calidad', report.feedbacks.avgQuality],
      ['Promedio Limpieza', report.feedbacks.avgCleanliness],
      ['Promedio Velocidad', report.feedbacks.avgSpeed],
      [''],
      ['INSPECCIONES'],
      ['Total Inspecciones', report.inspections.total],
      ['Score Promedio', report.inspections.avgScore + '%'],
      [''],
      ['CHECKLISTS'],
      ['Total Checklists', report.checklists.total],
      ['Daily', report.checklists.byType.daily],
      ['Temperaturas', report.checklists.byType.temperaturas],
      ['Producto Sobrante', report.checklists.byType.producto_sobrante],
      ['Recorrido', report.checklists.byType.recorrido],
      ['Cierre', report.checklists.byType.cierre],
      ['Apertura', report.checklists.byType.apertura]
    ]

    const ws = XLSX.utils.aoa_to_sheet(summaryData)
    XLSX.utils.book_append_sheet(wb, ws, 'Resumen')

    const fileName = `Reporte_TEG_${dateFrom}_${dateTo}.xlsx`
    XLSX.writeFile(wb, fileName)
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      
      <main className="flex-1 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Reportes</h1>
            <p className="text-gray-600 mt-2">Análisis y estadísticas por período</p>
          </div>

          <div className="bg-white rounded-xl shadow-md p-6 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Tienda</label>
                <select
                  value={selectedStore}
                  onChange={(e) => setSelectedStore(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900"
                >
                  <option value="all">Todas las tiendas</option>
                  {stores.map(store => (
                    <option key={store.id} value={store.id}>{store.name}</option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Fecha Desde</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Fecha Hasta</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900"
                />
              </div>

              <div className="flex items-end">
                <button
                  onClick={generateReport}
                  disabled={loading}
                  className="w-full px-6 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition-colors disabled:bg-gray-400"
                >
                  {loading ? 'Generando...' : 'Generar Reporte'}
                </button>
              </div>
            </div>
          </div>

          {report && (
            <div className="space-y-6">
              <div className="mb-6">
                <button
                  onClick={exportToExcel}
                  className="w-full px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-colors"
                >
                  📥 Exportar a Excel
                </button>
              </div>

              {/* Gráficas */}
              <div className="bg-white rounded-xl shadow-md p-6">
                <h2 className="text-xl font-bold text-gray-900 mb-6">Comparativa por Áreas</h2>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={[
                    { area: 'Servicio', puntos: parseFloat(report.feedbacks.avgService) },
                    { area: 'Calidad', puntos: parseFloat(report.feedbacks.avgQuality) },
                    { area: 'Limpieza', puntos: parseFloat(report.feedbacks.avgCleanliness) },
                    { area: 'Velocidad', puntos: parseFloat(report.feedbacks.avgSpeed) }
                  ]}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="area" />
                    <YAxis domain={[0, 5]} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="puntos" fill="#ef4444" name="Calificación (0-5)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-white rounded-xl shadow-md p-6">
                <h2 className="text-xl font-bold text-gray-900 mb-6">Feedback de Clientes</h2>
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <div className="text-center p-4 bg-blue-50 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">Total Feedbacks</p>
                    <p className="text-3xl font-bold text-blue-600">{report.feedbacks.total}</p>
                  </div>
                  <div className="text-center p-4 bg-green-50 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">NPS Score</p>
                    <p className="text-3xl font-bold text-green-600">{report.feedbacks.npsScore}</p>
                  </div>
                  <div className="text-center p-4 bg-purple-50 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">NPS Promedio</p>
                    <p className="text-3xl font-bold text-purple-600">{report.feedbacks.avgNPS}</p>
                  </div>
                  <div className="text-center p-4 bg-orange-50 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">Promotores</p>
                    <p className="text-3xl font-bold text-orange-600">{report.feedbacks.promoters}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">⭐ Servicio</p>
                    <p className="text-2xl font-bold text-gray-900">{report.feedbacks.avgService}/5</p>
                  </div>
                  <div className="text-center p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">🌮 Calidad</p>
                    <p className="text-2xl font-bold text-gray-900">{report.feedbacks.avgQuality}/5</p>
                  </div>
                  <div className="text-center p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">✨ Limpieza</p>
                    <p className="text-2xl font-bold text-gray-900">{report.feedbacks.avgCleanliness}/5</p>
                  </div>
                  <div className="text-center p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">⚡ Velocidad</p>
                    <p className="text-2xl font-bold text-gray-900">{report.feedbacks.avgSpeed}/5</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-md p-6">
                <h2 className="text-xl font-bold text-gray-900 mb-6">Inspecciones</h2>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center p-6 bg-purple-50 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">Total Inspecciones</p>
                    <p className="text-4xl font-bold text-purple-600">{report.inspections.total}</p>
                  </div>
                  <div className="text-center p-6 bg-green-50 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">Score Promedio</p>
                    <p className="text-4xl font-bold text-green-600">{report.inspections.avgScore}%</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-md p-6">
                <h2 className="text-xl font-bold text-gray-900 mb-6">Checklists</h2>
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <div className="text-center p-4 bg-blue-50 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">Total Checklists</p>
                    <p className="text-3xl font-bold text-blue-600">{report.checklists.total}</p>
                  </div>
                  <div className="text-center p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">📝 Daily</p>
                    <p className="text-2xl font-bold text-gray-900">{report.checklists.byType.daily}</p>
                  </div>
                  <div className="text-center p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">🌡️ Temperaturas</p>
                    <p className="text-2xl font-bold text-gray-900">{report.checklists.byType.temperaturas}</p>
                  </div>
                  <div className="text-center p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">🍖 Prod. Sobrante</p>
                    <p className="text-2xl font-bold text-gray-900">{report.checklists.byType.producto_sobrante}</p>
                  </div>
                </div>
                
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">🚶 Recorrido</p>
                    <p className="text-2xl font-bold text-gray-900">{report.checklists.byType.recorrido}</p>
                  </div>
                  <div className="text-center p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">🌙 Cierre</p>
                    <p className="text-2xl font-bold text-gray-900">{report.checklists.byType.cierre}</p>
                  </div>
                  <div className="text-center p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">☀️ Apertura</p>
                    <p className="text-2xl font-bold text-gray-900">{report.checklists.byType.apertura}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {!report && !loading && (
            <div className="text-center py-12 bg-white rounded-xl shadow-md">
              <div className="text-6xl mb-4">📊</div>
              <p className="text-gray-600">Selecciona filtros y haz clic en "Generar Reporte"</p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}