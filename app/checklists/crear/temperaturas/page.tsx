'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import '@/app/checklists/checklists.css'
interface Store {
  id: string
  name: string
}

const TEMPERATURE_ITEMS = [
  { id: 'refrig1_papelitos_mayo', label: 'Refrig 1 - Papelitos con mayo', type: 'cold' },
  { id: 'refrig1_papelitos_no_mayo', label: 'Refrig 1 - Papelitos sin mayo', type: 'cold' },
  { id: 'refrig1_quesadillas', label: 'Refrig 1 - Quesadillas', type: 'cold' },
  { id: 'refrig2_carnes_cocinar', label: 'Refrig 2 - Carnes para cocinar', type: 'cold' },
  { id: 'refrig2_asada_pollo', label: 'Refrig 2 - Asada y pollo', type: 'cold' },
  { id: 'refrig3_queso_monterrey', label: 'Refrig 3 - Queso monterrey', type: 'cold' },
  { id: 'refrig3_queso_cotija', label: 'Refrig 3 - Queso cotija', type: 'cold' },
  { id: 'refrig4_salsas', label: 'Refrig 4 - Salsas', type: 'cold' },
  { id: 'refrig4_lechuga', label: 'Refrig 4 - Lechuga', type: 'cold' },
  { id: 'vapor1_cabeza', label: 'Vapor 1 - Cabeza', type: 'hot' },
  { id: 'vapor1_lengua', label: 'Vapor 1 - Lengua', type: 'hot' },
  { id: 'vapor2_asada', label: 'Vapor 2 - Asada', type: 'hot' },
  { id: 'vapor2_pastor', label: 'Vapor 2 - Pastor', type: 'hot' },
  { id: 'vapor3_chorizo', label: 'Vapor 3 - Chorizo', type: 'hot' },
  { id: 'vapor3_salsa_huevo', label: 'Vapor 3 - Salsa de huevo', type: 'hot' },
  { id: 'vapor4_pollo', label: 'Vapor 4 - Pollo', type: 'hot' },
  { id: 'vapor4_buche', label: 'Vapor 4 - Buche', type: 'hot' },
  { id: 'vapor5_arroz', label: 'Vapor 5 - Arroz', type: 'hot' },
  { id: 'vapor5_frijol', label: 'Vapor 5 - Frijol', type: 'hot' },
  { id: 'vapor7_chile_asado', label: 'Vapor 7 - Chile asado', type: 'hot' },
  { id: 'vapor7_frijol_entero', label: 'Vapor 7 - Frijol entero', type: 'hot' }
]

function TemperaturasContent() {
  const router = useRouter()
  const { user } = useAuth()
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(false)
  const [showThanks, setShowThanks] = useState(false)
  
  const [formData, setFormData] = useState({
    store_id: '',
    checklist_date: new Date().toISOString().split('T')[0],
    start_time: new Date().toTimeString().slice(0, 5),
    shift: 'AM' as 'AM' | 'PM',
    comments: ''
  })
  
  const [temperatures, setTemperatures] = useState<{[key: string]: number}>({})

  useEffect(() => {
    fetchStores()
  }, [])

  const fetchStores = async () => {
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      const res = await fetch(`${url}/rest/v1/stores?select=id,name&order=name.asc`, {
        headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` }
      })
      const data = await res.json()
      setStores(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Error:', err)
    }
  }

  const adjustTemp = (id: string, delta: number) => {
    setTemperatures(prev => {
      const current = prev[id] || 0
      const newValue = current + delta
      return {...prev, [id]: Math.max(0, newValue)}
    })
  }

  const setQuickTemp = (id: string, value: number) => {
    setTemperatures(prev => ({...prev, [id]: value}))
  }

  const handleManualInput = (id: string, value: string) => {
    const num = parseFloat(value)
    if (!isNaN(num)) {
      setTemperatures(prev => ({...prev, [id]: num}))
    }
  }

  const isValidTemp = (temp: number, type: 'cold' | 'hot'): boolean => {
    if (type === 'cold') {
      return temp >= 34 && temp <= 41
    } else {
      return temp >= 165
    }
  }

  const getTempStatus = (id: string): 'good' | 'bad' | 'none' => {
    const value = temperatures[id]
    if (value === undefined || value === 0) return 'none'
    
    const item = TEMPERATURE_ITEMS.find(i => i.id === id)
    if (!item) return 'none'
    
    return isValidTemp(value, item.type) ? 'good' : 'bad'
  }

  const calculateScore = (): number => {
    let validCount = 0
    let totalCount = 0
    
    TEMPERATURE_ITEMS.forEach(item => {
      const value = temperatures[item.id]
      if (value === undefined || value === 0) return
      
      totalCount++
      if (isValidTemp(value, item.type)) {
        validCount++
      }
    })
    
    if (totalCount === 0) return 0
    return Math.round((validCount / totalCount) * 100)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!user) {
      alert('No se pudo obtener información del usuario')
      return
    }
    
    if (!formData.store_id) {
      alert('Por favor selecciona una sucursal')
      return
    }
    
    if (Object.keys(temperatures).length < TEMPERATURE_ITEMS.length) {
      alert(`Por favor captura TODAS las temperaturas (${Object.keys(temperatures).length}/${TEMPERATURE_ITEMS.length})`)
      return
    }

    setLoading(true)

    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      const endTime = new Date().toTimeString().slice(0, 5)

      const payload = {
        store_id: parseInt(formData.store_id),
        user_id: user.id,
        assistant_name: user.name || user.email || 'Asistente',
        created_by: user.name || user.email || 'Asistente',
        checklist_type: 'temperaturas',
        checklist_date: formData.checklist_date,
        start_time: formData.start_time,
        end_time: endTime,
        shift: formData.shift,
        answers: temperatures,
        score: calculateScore(),
        comments: formData.comments || null
      }

      const res = await fetch(`${url}/rest/v1/assistant_checklists`, {
        method: 'POST',
        headers: {
          'apikey': key || '',
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(payload)
      })

      if (res.ok) {
        setShowThanks(true)
        setTimeout(() => router.push('/checklists'), 2000)
      } else {
        const error = await res.text()
        console.error('Error:', error)
        alert('Error al enviar. Intenta de nuevo.')
      }
    } catch (err) {
      console.error('Error:', err)
      alert('Error al enviar. Intenta de nuevo.')
    }

    setLoading(false)
  }

  if (!user) return null

  if (showThanks) {
    return (
      <div className="min-h-screen bg-gray-50 grid place-items-center">
        <div className="text-center">
          <div className="text-9xl mb-4">✅</div>
          <h1 className="text-5xl font-bold text-green-600 mb-3">¡Gracias!</h1>
          <p className="text-xl text-gray-700">Temperaturas enviadas</p>
        </div>
      </div>
    )
  }

  const score = calculateScore()
  const captured = Object.keys(temperatures).filter(k => temperatures[k] > 0).length

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-gradient-to-r from-red-600 to-red-700 text-white shadow-lg sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <button onClick={() => router.back()} className="text-2xl hover:bg-red-500 rounded-lg p-2">←</button>
            <div className="text-4xl">🌡️</div>
            <div>
              <strong className="text-xl">Control de Temperaturas</strong>
              <div className="text-xs text-red-100">{user.name || user.email}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">{score}%</div>
            <div className="text-xs">{captured}/{TEMPERATURE_ITEMS.length}</div>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-900 mb-2">Sucursal *</label>
                <select required value={formData.store_id} onChange={(e) => setFormData({...formData, store_id: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                  <option value="">Selecciona...</option>
                  {stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-900 mb-2">Fecha *</label>
                <input type="date" required value={formData.checklist_date}
                  onChange={(e) => setFormData({...formData, checklist_date: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-900 mb-2">Turno *</label>
                <select value={formData.shift} onChange={(e) => setFormData({...formData, shift: e.target.value as 'AM' | 'PM'})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                </select>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
            <div className="mb-4">
              <h3 className="text-lg font-bold text-red-600 mb-2">Control de Temperaturas ({TEMPERATURE_ITEMS.length})</h3>
              <div className="flex gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-blue-500 rounded"></div>
                  <span>Refrigeración: 34-41°F</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-orange-500 rounded"></div>
                  <span>Caliente: ≥165°F</span>
                </div>
              </div>
            </div>
            <div className="space-y-4">
              {TEMPERATURE_ITEMS.map((item) => {
                const status = getTempStatus(item.id)
                const currentTemp = temperatures[item.id] || 0
                return (
                  <div key={item.id} className={`border-2 rounded-xl p-4 transition-all ${
                    status === 'good' ? 'border-green-500 bg-green-50' : 
                    status === 'bad' ? 'border-red-500 bg-red-50' : 
                    'border-gray-200'
                  }`}>
                    <label className="block text-sm font-semibold text-gray-900 mb-3">
                      {item.label}
                      <span className={`ml-2 text-xs px-2 py-1 rounded ${
                        item.type === 'cold' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'
                      }`}>
                        {item.type === 'cold' ? '❄️ Frío' : '🔥 Caliente'}
                      </span>
                    </label>
                    
                    {/* Botones rápidos */}
                    <div className="flex gap-2 mb-3">
                      {item.type === 'cold' ? (
                        <>
                          <button type="button" onClick={() => setQuickTemp(item.id, 35)}
                            className="flex-1 py-2 px-3 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded-lg font-semibold text-sm">
                            35°F
                          </button>
                          <button type="button" onClick={() => setQuickTemp(item.id, 38)}
                            className="flex-1 py-2 px-3 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded-lg font-semibold text-sm">
                            38°F
                          </button>
                          <button type="button" onClick={() => setQuickTemp(item.id, 40)}
                            className="flex-1 py-2 px-3 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded-lg font-semibold text-sm">
                            40°F
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" onClick={() => setQuickTemp(item.id, 165)}
                            className="flex-1 py-2 px-3 bg-orange-100 hover:bg-orange-200 text-orange-800 rounded-lg font-semibold text-sm">
                            165°F
                          </button>
                          <button type="button" onClick={() => setQuickTemp(item.id, 175)}
                            className="flex-1 py-2 px-3 bg-orange-100 hover:bg-orange-200 text-orange-800 rounded-lg font-semibold text-sm">
                            175°F
                          </button>
                          <button type="button" onClick={() => setQuickTemp(item.id, 185)}
                            className="flex-1 py-2 px-3 bg-orange-100 hover:bg-orange-200 text-orange-800 rounded-lg font-semibold text-sm">
                            185°F
                          </button>
                        </>
                      )}
                    </div>

                    {/* Control principal */}
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => adjustTemp(item.id, -5)}
                        className="w-14 h-14 bg-gray-200 hover:bg-gray-300 rounded-lg font-bold text-2xl">
                        -5
                      </button>
                      <button type="button" onClick={() => adjustTemp(item.id, -1)}
                        className="w-14 h-14 bg-gray-200 hover:bg-gray-300 rounded-lg font-bold text-2xl">
                        -
                      </button>
                      
                      <div className="flex-1 relative">
                        <input type="number" step="0.1"
                          value={currentTemp || ''}
                          onChange={(e) => handleManualInput(item.id, e.target.value)}
                          className={`w-full px-4 py-3 border-2 rounded-lg text-center font-bold text-3xl ${
                            status === 'good' ? 'border-green-500 bg-white' : 
                            status === 'bad' ? 'border-red-500 bg-white' : 
                            'border-gray-300'
                          }`}
                          placeholder="0" />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 font-bold text-xl">°F</span>
                      </div>
                      
                      <button type="button" onClick={() => adjustTemp(item.id, 1)}
                        className="w-14 h-14 bg-gray-200 hover:bg-gray-300 rounded-lg font-bold text-2xl">
                        +
                      </button>
                      <button type="button" onClick={() => adjustTemp(item.id, 5)}
                        className="w-14 h-14 bg-gray-200 hover:bg-gray-300 rounded-lg font-bold text-2xl">
                        +5
                      </button>
                      
                      {status !== 'none' && (
                        <span className="text-3xl ml-2">
                          {status === 'good' ? '✅' : '❌'}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
            <label className="block text-sm font-bold text-gray-900 mb-2">Comentarios</label>
            <textarea value={formData.comments} onChange={(e) => setFormData({...formData, comments: e.target.value})} rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg resize-none"
              placeholder="Observaciones adicionales..." />
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
            <div className="h-4 bg-gray-200 rounded-full overflow-hidden mb-3">
              <div className="h-full bg-gradient-to-r from-red-400 to-red-500 transition-all duration-500"
                style={{ width: `${score}%` }} />
            </div>
            <p className="text-center mb-4">
              <span className="text-3xl font-bold">{score}%</span>
              <span className="text-gray-600 ml-2">Temperaturas correctas ({captured}/{TEMPERATURE_ITEMS.length})</span>
            </p>
            <button type="submit" disabled={loading}
              className="w-full bg-red-600 hover:bg-red-700 text-white font-bold text-lg py-4 rounded-xl shadow-lg transition-all disabled:opacity-50">
              {loading ? '⏳ Enviando...' : 'Enviar Temperaturas'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function TemperaturasPage() {
  return (
    <ProtectedRoute>
      <TemperaturasContent />
    </ProtectedRoute>
  )
}