'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { ChevronLeft, Thermometer, Snowflake, Flame } from 'lucide-react'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import '@/app/checklists/checklists.css'
import { getSupabaseClient } from '@/lib/supabase'
import { useDynamicChecklist } from '@/hooks/useDynamicChecklist'

interface Store {
  id: string
  name: string
  code?: string
}

function TemperaturasContent() {
  const router = useRouter()
  const { user } = useAuth()
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(false)
  const [showThanks, setShowThanks] = useState(false)

  const [formData, setFormData] = useState({
    store_id: '',
    checklist_date: (() => {
      const d = new Date()
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    })(),
    shift: (new Date().getHours() >= 17 || new Date().getHours() < 7 ? 'PM' : 'AM') as 'AM' | 'PM',
    comments: ''
  })

  // Track start time for duration calculation
  const [startTime] = useState(() => new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }))

  // Dynamic Hooks
  const { data: template, loading: checklistLoading, error: checklistError, isCached } = useDynamicChecklist('temperaturas_v1')

  // Flatten and Derive Logic
  const temperatureItems = template?.sections.flatMap((s: any) =>
    s.questions.map((q: any) => {
      const textToCheck = `${q.text} ${s.title}`.toLowerCase()
      const isRefrig = textToCheck.includes('refrig') || textToCheck.includes('frio') || textToCheck.includes('walking') || textToCheck.includes('hiel')
      return {
        ...q,
        type: isRefrig ? 'cold' : 'hot' as 'cold' | 'hot'
      }
    })
  ) || []

  const [temperatures, setTemperatures] = useState<{ [key: string]: number }>({})

  useEffect(() => {
    if (user) {
      fetchStores()
    }
  }, [user])

  const fetchStores = async () => {
    try {
      const supabase = await getSupabaseClient()
      const { data, error } = await supabase
        .from('stores')
        .select('id,name,code')
        .order('name', { ascending: true })

      if (error) throw error
      const loadedStores = (data as any[]) || []

      const userScope = (user as any)?.store_scope
      if (user?.role === 'asistente' && Array.isArray(userScope) && userScope.length > 0) {
        const filtered = loadedStores.filter(s => userScope.includes(s.code) || userScope.includes(s.name))
        setStores(filtered)
        if (filtered.length > 0) {
          setFormData(prev => ({ ...prev, store_id: filtered[0].id.toString() }))
        }
      } else {
        setStores(loadedStores)
      }
    } catch (err) {
      console.error('Error:', err)
    }
  }

  const adjustTemp = (id: string, delta: number) => {
    setTemperatures(prev => {
      const current = prev[id] || 0
      const newValue = current + delta
      return { ...prev, [id]: Math.max(0, newValue) }
    })
  }

  const setQuickTemp = (id: string, value: number) => {
    setTemperatures(prev => ({ ...prev, [id]: value }))
  }

  const handleManualInput = (id: string, value: string) => {
    const num = parseFloat(value)
    if (!isNaN(num)) {
      setTemperatures(prev => ({ ...prev, [id]: num }))
    } else if (value === '') {
      const newTemps = { ...temperatures }
      delete newTemps[id]
      setTemperatures(newTemps)
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

    const item = temperatureItems.find((i: any) => i.id === id)
    if (!item) return 'none'

    return isValidTemp(value, item.type) ? 'good' : 'bad'
  }

  const calculateScore = (): number => {
    let validCount = 0
    let totalCount = 0

    temperatureItems.forEach((item: any) => {
      const value = temperatures[item.id]
      if (value === undefined || value === 0) return
      totalCount++
      if (isValidTemp(value, item.type)) {
        validCount++
      }
    })

    if (totalCount === 0) return 100
    return Math.round((validCount / totalCount) * 100)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!user) return alert('Sesión expirada')

    if (!formData.store_id) return alert('Selecciona una sucursal')

    if (Object.keys(temperatures).length < temperatureItems.length) {
      alert(`⚠️ Falta capturar ${temperatureItems.length - Object.keys(temperatures).length} temperaturas.`)
      return
    }

    setLoading(true)

    try {
      const supabase = await getSupabaseClient()
      const formattedAnswers: { [key: string]: any } = {}
      temperatureItems.forEach(item => {
        formattedAnswers[item.text] = temperatures[item.id]
      })

      // Get current local time for submit (end_time)
      const endTime = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })

      const payload = {
        store_id: parseInt(formData.store_id),
        user_id: user.id,
        user_name: user.name || user.email,
        checklist_type: 'temperaturas',
        checklist_date: formData.checklist_date,
        shift: formData.shift,
        answers: formattedAnswers,
        score: calculateScore(),
        comments: formData.comments || null,
        start_time: startTime,
        end_time: endTime
      }

      const { error } = await supabase.from('assistant_checklists').insert([payload])

      if (!error) {
        setShowThanks(true)
      } else {
        alert('Error: ' + error.message)
      }
    } catch (err: any) {
      alert('Error inesperado: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  if (!user) return null
  if (checklistLoading) return <div className="min-h-screen grid place-items-center bg-transparent"><div className="w-12 h-12 border-4 border-red-600 border-t-transparent rounded-full animate-spin" /></div>
  if (checklistError) return <div className="min-h-screen grid place-items-center text-red-600 font-bold">Error: {checklistError}</div>

  if (showThanks) {
    return (
      <div className="min-h-screen bg-transparent grid place-items-center animate-in zoom-in duration-500">
        <div className="text-center p-8 bg-white rounded-3xl shadow-2xl border border-gray-100 max-w-sm mx-auto">
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="text-8xl mb-6">🌡️</motion.div>
          <h1 className="text-4xl font-black text-gray-900 mb-2">¡Completado!</h1>
          <p className="text-gray-500 font-medium mb-8">El registro de temperaturas ha sido guardado exitosamente.</p>
          <button onClick={() => router.push('/dashboard')} className="w-full py-4 bg-red-600 text-white font-bold rounded-2xl shadow-lg shadow-red-100 transition-transform active:scale-95">
            Volver al Inicio
          </button>
        </div>
      </div>
    )
  }

  const score = calculateScore()
  const capturedCount = Object.keys(temperatures).length

  return (
    <div className="min-h-screen checklist-container flex flex-col animate-in fade-in duration-500">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm shrink-0">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <button onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center hover:bg-gray-100 rounded-xl transition-colors text-gray-600">
              <ChevronLeft size={24} />
            </button>
            <div>
              <h1 className="text-lg font-black text-gray-900 flex items-center gap-2">
                {template?.title || 'Control de Temperaturas'}
                {isCached && (
                  <span className="bg-yellow-500/10 text-yellow-600 text-[10px] px-2 py-0.5 rounded-full border border-yellow-400/20 font-bold uppercase tracking-widest">
                    Offline
                  </span>
                )}
              </h1>
              <div className="text-[10px] font-black text-red-600 uppercase tracking-widest">{user.name || user.email}</div>
            </div>
          </div>
          <div className="bg-red-600 text-white px-4 py-2 rounded-2xl shadow-lg shadow-red-100 flex flex-col items-center min-w-[80px]">
            <div className="text-xl font-black leading-none">{capturedCount}/{temperatureItems.length}</div>
            <div className="text-[10px] font-bold uppercase opacity-80 mt-1">CAPTURADOS</div>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8 pb-32 w-full">
        <form onSubmit={handleSubmit} className="space-y-8">
          <div className="bg-white rounded-3xl shadow-sm p-6 border border-gray-100 grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Sucursal *</label>
              <select required value={formData.store_id} onChange={(e) => setFormData({ ...formData, store_id: e.target.value })}
                className="w-full p-3 bg-gray-50 border-gray-100 rounded-xl font-bold text-gray-700 outline-none focus:ring-2 focus:ring-red-100 transition-all">
                <option value="">Selecciona...</option>
                {stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Fecha *</label>
              <input type="date" required value={formData.checklist_date}
                onChange={(e) => setFormData({ ...formData, checklist_date: e.target.value })}
                className="w-full p-3 bg-gray-50 border-gray-100 rounded-xl font-bold text-gray-700 outline-none focus:ring-2 focus:ring-red-100 transition-all" />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Turno *</label>
              <select value={formData.shift} onChange={(e) => setFormData({ ...formData, shift: e.target.value as 'AM' | 'PM' })}
                className="w-full p-3 bg-gray-50 border-gray-100 rounded-xl font-bold text-gray-700 outline-none focus:ring-2 focus:ring-red-100 transition-all">
                <option value="AM">AM (Mañana)</option>
                <option value="PM">PM (Tarde)</option>
              </select>
            </div>
          </div>

          <div className="space-y-12">
            {template?.sections.map((section: any) => (
              <div key={section.id} className="space-y-6">
                <div className="flex items-center gap-4 px-2">
                  <div className="h-[2px] flex-1 bg-gray-100" />
                  <h3 className="text-[10px] font-black text-red-600 uppercase tracking-[0.3em]">{section.title}</h3>
                  <div className="h-[2px] flex-1 bg-gray-100" />
                </div>

                <div className="grid grid-cols-1 gap-4">
                  {section.questions.map((item: any) => {
                    const status = getTempStatus(item.id)
                    const currentTemp = temperatures[item.id] || 0
                    const textToCheck = (item.text + ' ' + section.title).toLowerCase()
                    const itemType = (textToCheck.includes('refrig') || textToCheck.includes('frio') || textToCheck.includes('walking') || textToCheck.includes('hiel')) ? 'cold' : 'hot'

                    return (
                      <motion.div
                        layout
                        key={item.id}
                        className={`bg-white rounded-3xl shadow-sm p-6 border transition-all ${status === 'good' ? 'border-green-200 bg-green-50/30' :
                          status === 'bad' ? 'border-red-200 bg-red-50/30' :
                            'border-gray-100'
                          }`}
                      >
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${itemType === 'cold' ? 'bg-blue-100 text-blue-600' : 'bg-orange-100 text-orange-600'
                              }`}>
                              {itemType === 'cold' ? <Snowflake size={20} /> : <Flame size={20} />}
                            </div>
                            <div>
                              <h4 className="font-bold text-gray-900">{item.text}</h4>
                              <span className="text-[10px] font-black uppercase tracking-widest opacity-40">
                                {itemType === 'cold' ? 'Rango: 34-41°F' : 'Rango: ≥165°F'}
                              </span>
                            </div>
                          </div>
                          {status !== 'none' && (
                            <div className={`text-xs font-black uppercase px-3 py-1 rounded-full ${status === 'good' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                              }`}>
                              {status === 'good' ? 'Correcto' : 'Alerta'}
                            </div>
                          )}
                        </div>

                        <div className="flex flex-col md:flex-row gap-4 items-center">
                          <div className="flex gap-2 w-full md:w-auto">
                            {itemType === 'cold' ? (
                              [35, 38, 40].map(v => (
                                <button key={v} type="button" onClick={() => setQuickTemp(item.id, v)}
                                  className="flex-1 md:w-16 h-10 bg-gray-100 hover:bg-blue-600 hover:text-white rounded-xl font-bold text-xs transition-colors">
                                  {v}°F
                                </button>
                              ))
                            ) : (
                              [165, 175, 185].map(v => (
                                <button key={v} type="button" onClick={() => setQuickTemp(item.id, v)}
                                  className="flex-1 md:w-16 h-10 bg-gray-100 hover:bg-orange-600 hover:text-white rounded-xl font-bold text-xs transition-colors">
                                  {v}°F
                                </button>
                              ))
                            )}
                          </div>

                          <div className="flex-1 flex items-center gap-2 w-full">
                            <button type="button" onClick={() => adjustTemp(item.id, -1)}
                              className="w-12 h-12 bg-gray-100 hover:bg-gray-200 rounded-xl font-black text-xl flex items-center justify-center transition-colors">
                              -
                            </button>
                            <div className="flex-1 relative">
                              <input type="number" step="0.1"
                                value={currentTemp || ''}
                                onChange={(e) => handleManualInput(item.id, e.target.value)}
                                placeholder="--"
                                className="w-full h-12 bg-gray-50 border-none rounded-xl text-center font-black text-2xl text-gray-900 focus:ring-2 focus:ring-red-100" />
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black text-gray-400">°F</span>
                            </div>
                            <button type="button" onClick={() => adjustTemp(item.id, 1)}
                              className="w-12 h-12 bg-gray-100 hover:bg-gray-200 rounded-xl font-black text-xl flex items-center justify-center transition-colors">
                              +
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-3xl shadow-sm p-6 border border-gray-100 space-y-3">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Observaciones Adicionales</label>
            <textarea value={formData.comments} onChange={(e) => setFormData({ ...formData, comments: e.target.value })} rows={3}
              className="w-full p-4 bg-gray-50 border-gray-100 rounded-2xl font-medium text-gray-700 outline-none focus:ring-2 focus:ring-red-100 transition-all resize-none"
              placeholder="Escribe aquí si hubo algún equipo fuera de rango..." />
          </div>

          <div className="pt-4">
            <button type="submit" disabled={loading}
              className="w-full bg-gradient-to-r from-red-600 to-red-800 hover:from-red-700 hover:to-red-900 text-white font-black text-lg py-5 rounded-3xl shadow-xl shadow-red-100 transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-3">
              {loading ? <div className="w-6 h-6 border-4 border-white border-t-transparent rounded-full animate-spin" /> : 'Finalizar Registro'}
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