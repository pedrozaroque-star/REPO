'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import '@/app/checklists/checklists.css'
interface Store {
  id: string
  name: string
}

const PRODUCTS = [
  { id: 'arroz', label: 'Arroz' },
  { id: 'frijol', label: 'Frijol' },
  { id: 'asada', label: 'Asada' },
  { id: 'pastor', label: 'Pastor' },
  { id: 'pollo', label: 'Pollo' },
  { id: 'carnitas', label: 'Carnitas' },
  { id: 'buche', label: 'Buche' },
  { id: 'chorizo', label: 'Chorizo' },
  { id: 'cabeza', label: 'Cabeza' },
  { id: 'lengua', label: 'Lengua' },
  { id: 'frijoles_olla', label: 'Frijoles de olla' }
]

function SobranteContent() {
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
  
  const [weights, setWeights] = useState<{[key: string]: string}>({})

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

  const handleWeightChange = (id: string, value: string) => {
    setWeights(prev => ({...prev, [id]: value}))
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
    
    if (Object.keys(weights).length < PRODUCTS.length) {
      alert(`Por favor captura TODOS los productos (${Object.keys(weights).length}/${PRODUCTS.length})`)
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
        checklist_type: 'sobrante',
        checklist_date: formData.checklist_date,
        start_time: formData.start_time,
        end_time: endTime,
        shift: formData.shift,
        answers: weights,
        score: 100,
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
          <p className="text-xl text-gray-700">Producto Sobrante enviado</p>
        </div>
      </div>
    )
  }

  const captured = Object.keys(weights).length

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-gradient-to-r from-yellow-600 to-yellow-700 text-white shadow-lg sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <button onClick={() => router.back()} className="text-2xl hover:bg-yellow-500 rounded-lg p-2">←</button>
            <div className="text-4xl">📦</div>
            <div>
              <strong className="text-xl">Producto Sobrante</strong>
              <div className="text-xs text-yellow-100">{user.name || user.email}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs">{captured}/{PRODUCTS.length}</div>
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
            <h3 className="text-lg font-bold text-yellow-600 mb-4">Productos ({PRODUCTS.length})</h3>
            <p className="text-sm text-gray-600 mb-4">Ingresa el peso en libras de cada producto sobrante</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {PRODUCTS.map((product) => (
                <div key={product.id} className="border border-gray-200 rounded-lg p-3">
                  <label className="block text-sm font-semibold text-gray-900 mb-2">{product.label}</label>
                  <div className="flex items-center gap-2">
                    <input type="number" step="0.1" placeholder="0"
                      value={weights[product.id] || ''}
                      onChange={(e) => handleWeightChange(product.id, e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-center font-bold text-lg" />
                    <span className="text-gray-600 font-semibold">lb</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
            <label className="block text-sm font-bold text-gray-900 mb-2">Comentarios</label>
            <textarea value={formData.comments} onChange={(e) => setFormData({...formData, comments: e.target.value})} rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg resize-none"
              placeholder="Observaciones adicionales..." />
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
            <p className="text-center mb-4">
              <span className="text-gray-600">Capturados: {captured}/{PRODUCTS.length}</span>
            </p>
            <button type="submit" disabled={loading}
              className="w-full bg-yellow-600 hover:bg-yellow-700 text-white font-bold text-lg py-4 rounded-xl shadow-lg transition-all disabled:opacity-50">
              {loading ? '⏳ Enviando...' : 'Enviar Producto Sobrante'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function SobrantePage() {
  return (
    <ProtectedRoute>
      <SobranteContent />
    </ProtectedRoute>
  )
}