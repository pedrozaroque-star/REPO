'use client'
import '@/app/checklists/checklists.css'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'

interface Store {
  id: string
  name: string
}

const PROCEDURES = [
  'Desarmar alarma',
  'Encender vaporeras',
  'Encender refrigeradores',
  'Encender planchas',
  'Encender luces',
  'Revisar temperaturas',
  'Preparar estaciones',
  'Verificar inventario del día',
  'Limpiar áreas de servicio',
  'Preparar caja registradora',
  'Revisar pedidos pendientes',
  'Activar sistemas POS',
  'Verificar que todo esté listo'
]

function AperturaContent() {
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

  const [answers, setAnswers] = useState<{ [key: number]: 'SI' | 'NO' | 'NA' | null }>({})

  useEffect(() => {
    // Si el usuario ya cargó, lanzamos fetch
    if (user) {
      fetchStores()
    }
  }, [user])

  const fetchStores = async () => {
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      const res = await fetch(`${url}/rest/v1/stores?select=id,name,code&order=name.asc`, {
        headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` }
      })
      const data = await res.json()
      let loadedStores = Array.isArray(data) ? data : []

      // --- 🔒 FILTRAR TIENDAS SEGÚN ROL ---
      const userScope = (user as any)?.store_scope
      if (user?.role === 'asistente' && Array.isArray(userScope) && userScope.length > 0) {
        loadedStores = loadedStores.filter(s => userScope.includes(s.code) || userScope.includes(s.name))
      }

      setStores(loadedStores)

      // --- 🔒 AUTO-SELECCIÓN TIENDA ---
      if (user?.role === 'asistente' && Array.isArray(userScope) && userScope.length > 0 && loadedStores.length > 0) {
        const myStoreId = loadedStores[0].id.toString()
        setFormData(prev => ({ ...prev, store_id: myStoreId }))
      }

    } catch (err) {
      console.error('Error:', err)
    }
  }
} catch (err) {
  console.error('Error:', err)
}
  }

const handleAnswer = (index: number, value: 'SI' | 'NO' | 'NA') => {
  setAnswers(prev => ({ ...prev, [index]: value }))
}

const calculateScore = (): number => {
  const values = Object.values(answers).filter(v => v !== null)
  const siCount = values.filter(v => v === 'SI').length
  if (values.length === 0) return 0
  return Math.round((siCount / values.length) * 100)
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

  if (Object.keys(answers).length < PROCEDURES.length) {
    alert(`Por favor responde TODOS los procedimientos (${Object.keys(answers).length}/${PROCEDURES.length})`)
    return
  }

  setLoading(true)

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const endTime = new Date().toTimeString().slice(0, 5)

    const calculatedScore = calculateScore()

    const payload = {
      store_id: parseInt(formData.store_id),
      user_id: user.id,
      assistant_name: user.name || user.email || 'Asistente',
      created_by: user.name || user.email || 'Asistente',
      checklist_type: 'apertura',
      checklist_date: formData.checklist_date,
      start_time: formData.start_time,
      end_time: endTime,
      shift: formData.shift,
      answers: answers,
      score: calculatedScore,
      comments: formData.comments || null
    }

    // 1. Guardar Checklist
    const res = await fetch(`${url}/rest/v1/assistant_checklists`, {
      method: 'POST',
      headers: {
        'apikey': key || '',
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation' // Necesario para obtener el ID creado
      },
      body: JSON.stringify(payload)
    })

    if (res.ok) {
      // --- 🔔 LOGICA DE NOTIFICACIONES ---
      try {
        // Buscamos Managers que tengan asignada esta tienda
        // role='manager' AND store_scope contains {store_id}
        const notifQuery = `${url}/rest/v1/users?select=id&role=eq.manager&store_scope=cs.{${payload.store_id}}`
        const managerRes = await fetch(notifQuery, {
          headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` }
        })
        const managers = await managerRes.json()

        if (Array.isArray(managers) && managers.length > 0) {
          const storeName = stores.find(s => s.id == payload.store_id)?.name || 'Sucursal'
          const newNotifs = managers.map(m => ({
            user_id: m.id,
            title: `Nueva Apertura: ${storeName}`,
            message: `${payload.assistant_name} completó la apertura con ${calculatedScore}%`,
            type: calculatedScore < 80 ? 'alert' : 'info',
            link: '/checklists'
          }))

          // Insertar notificaciones
          await fetch(`${url}/rest/v1/notifications`, {
            method: 'POST',
            headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(newNotifs)
          })

        }
      } catch (notifErr) {
        console.error('Error enviando notificaciones:', notifErr)
      }
      // ------------------------------------

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

// Verificar si hay que bloquear el selector de tienda
const userScope = (user as any).store_scope
const isStoreFixed = user.role === 'asistente' && Array.isArray(userScope) && userScope.length > 0

if (showThanks) {
  return (
    <div className="min-h-screen bg-gray-50 grid place-items-center">
      <div className="text-center">
        <div className="text-9xl mb-4">✅</div>
        <h1 className="text-5xl font-bold text-green-600 mb-3">¡Gracias!</h1>
        <p className="text-xl text-gray-700">Inspección de Apertura enviada</p>
      </div>
    </div>
  )
}

const score = calculateScore()
const answered = Object.keys(answers).length

return (
  <div className="min-h-screen bg-gray-50">
    <header className="bg-gradient-to-r from-orange-600 to-orange-700 text-white shadow-lg sticky top-0 z-40">
      <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <button onClick={() => router.back()} className="text-2xl hover:bg-orange-500 rounded-lg p-2">←</button>
          <div className="text-4xl">🌅</div>
          <div>
            <strong className="text-xl">Inspección de Apertura</strong>
            <div className="text-xs text-orange-100">{user.name || user.email}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold">{score}%</div>
          <div className="text-xs">{answered}/{PROCEDURES.length}</div>
        </div>
      </div>
    </header>

    <div className="max-w-4xl mx-auto px-4 py-6">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-bold text-gray-900 mb-2">Sucursal *</label>
              <select
                required
                value={formData.store_id}
                onChange={(e) => setFormData({ ...formData, store_id: e.target.value })}
                disabled={isStoreFixed} // 🔒 Se bloquea si el usuario tiene tienda asignada
                className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${isStoreFixed ? 'bg-gray-100 cursor-not-allowed' : ''}`}>
                <option value="">Selecciona...</option>
                {stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-900 mb-2">Fecha *</label>
              <input type="date" required value={formData.checklist_date}
                onChange={(e) => setFormData({ ...formData, checklist_date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-900 mb-2">Turno *</label>
              <select value={formData.shift} onChange={(e) => setFormData({ ...formData, shift: e.target.value as 'AM' | 'PM' })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                <option value="AM">AM</option>
                <option value="PM">PM</option>
              </select>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
          <h3 className="text-lg font-bold text-orange-600 mb-4">Procedimientos ({PROCEDURES.length})</h3>
          <div className="space-y-3">
            {PROCEDURES.map((procedure, idx) => (
              <div key={idx} className="flex items-center justify-between gap-4 border border-gray-200 rounded-lg p-3">
                <div className="flex-1 font-semibold text-sm">{idx + 1}. {procedure}</div>
                <div className="flex gap-2">
                  {['SI', 'NO', 'NA'].map(val => (
                    <button key={val} type="button"
                      onClick={() => handleAnswer(idx, val as any)}
                      className={`px-3 py-1.5 rounded-lg font-semibold text-sm transition-all ${answers[idx] === val
                          ? val === 'SI' ? 'bg-green-600 text-white' : val === 'NO' ? 'bg-red-600 text-white' : 'bg-gray-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}>
                      {val === 'SI' ? 'Sí' : val}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
          <label className="block text-sm font-bold text-gray-900 mb-2">Comentarios</label>
          <textarea value={formData.comments} onChange={(e) => setFormData({ ...formData, comments: e.target.value })} rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg resize-none"
            placeholder="Observaciones adicionales..." />
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
          <div className="h-4 bg-gray-200 rounded-full overflow-hidden mb-3">
            <div className="h-full bg-gradient-to-r from-orange-400 to-orange-500 transition-all duration-500"
              style={{ width: `${score}%` }} />
          </div>
          <p className="text-center mb-4">
            <span className="text-3xl font-bold">{score}%</span>
            <span className="text-gray-600 ml-2">Completado ({answered}/{PROCEDURES.length})</span>
          </p>
          <button type="submit" disabled={loading}
            className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold text-lg py-4 rounded-xl shadow-lg transition-all disabled:opacity-50">
            {loading ? '⏳ Enviando...' : 'Enviar Inspección de Apertura'}
          </button>
        </div>
      </form>
    </div>
  </div>
)
}

export default function AperturaPage() {
  return (
    <ProtectedRoute>
      <AperturaContent />
    </ProtectedRoute>
  )
}