'use client'

import { useEffect, useState } from 'react'
import { Store, MapPin, Search, Plus, X, Save, Trash2, Edit } from 'lucide-react'
import { getSupabaseClient, formatStoreName } from '@/lib/supabase'
import SurpriseLoader from '@/components/SurpriseLoader'
import { motion, AnimatePresence } from 'framer-motion'

export default function TiendasPage() {
  const [stores, setStores] = useState<any[]>([])
  const [storesWithStats, setStoresWithStats] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedStore, setSelectedStore] = useState<any>(null)

  // Edit/Create State
  const [isEditing, setIsEditing] = useState(false)
  const [editingStore, setEditingStore] = useState<any>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      const supabase = await getSupabaseClient()

      // Obtener tiendas
      const { data: storesData, error } = await supabase
        .from('stores')
        .select('*')
        .order('name')

      if (error) throw error

      setStores(storesData || [])

      // Obtener estadísticas básicas (simuladas para carga rápida)
      const storesWithStatsData = (storesData || []).map((store) => ({
        ...store,
        stats: {
          feedbackCount: 0,
          avgNPS: 0,
          avgInspection: 0
        }
      }))

      setStoresWithStats(storesWithStatsData)
      setLoading(false)
    } catch (err) {
      console.error('Error:', err)
      setLoading(false)
    }
  }

  const handleCreate = () => {
    setEditingStore({
      name: '',
      code: '',
      city: '',
      state: '',
      address: '',
      phone: '',
      hours: '',
      supervisor_name: '',
      is_active: true
    })
    setIsEditing(true)
  }

  const handleEdit = (store: any) => {
    setEditingStore({
      ...store,
      name: store.name || '',
      code: store.code || '',
      city: store.city || '',
      state: store.state || '',
      address: store.address || '',
      phone: store.phone || '',
      hours: store.hours || '',
      supervisor_name: store.supervisor_name || '',
      is_active: store.is_active ?? true
    })
    setIsEditing(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    try {
      const supabase = await getSupabaseClient()

      if (editingStore.id) {
        // Update
        const { error } = await supabase
          .from('stores')
          .update({
            name: editingStore.name,
            code: editingStore.code,
            city: editingStore.city,
            state: editingStore.state,
            address: editingStore.address,
            phone: editingStore.phone,
            hours: editingStore.hours,
            supervisor_name: editingStore.supervisor_name,
            is_active: editingStore.is_active
          })
          .eq('id', editingStore.id)

        if (error) throw error
      } else {
        // Create
        const { error } = await supabase
          .from('stores')
          .insert([editingStore])

        if (error) throw error
      }

      setIsEditing(false)
      fetchData()
    } catch (err) {
      console.error('Error al guardar:', err)
      alert('Error al guardar la sucursal')
    } finally {
      setSaving(false)
    }
  }

  const filteredStores = storesWithStats.filter(store =>
    store.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    store.code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    store.city?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  if (loading) {
    return <SurpriseLoader />
  }

  return (
    <div className="flex bg-transparent dark:bg-neutral-900 pb-20 font-sans relative overflow-hidden w-full min-h-screen">
      <div className="absolute inset-0 opacity-10 dark:opacity-40 pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
      <main className="flex-1 flex flex-col h-full w-full relative">

        {/* STICKY HEADER */}
        <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-gray-200 dark:border-slate-800 shadow-sm sticky top-14 lg:top-0 z-20 shrink-0 transition-all">
          <div className="max-w-7xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center text-orange-600 dark:text-orange-400">
                <Store size={18} />
              </div>
              <h1 className="text-lg md:text-xl font-black text-gray-900 dark:text-white tracking-tight leading-none">Sucursales</h1>
            </div>

            <button
              onClick={handleCreate}
              className="px-4 py-1.5 rounded-full bg-gray-900 dark:bg-slate-100 text-white dark:text-slate-900 flex items-center justify-center gap-2 hover:bg-black dark:hover:bg-white transition-transform active:scale-95 shadow-lg shadow-gray-200 dark:shadow-none font-bold text-xs uppercase tracking-wide"
            >
              <Plus size={16} strokeWidth={3} />
              <span className="hidden md:inline">NUEVA TIENDA</span>
            </button>
          </div>
        </div>

        {/* MAIN CONTENT AREA */}
        <div className="flex-1 w-full max-w-7xl mx-auto px-4 md:px-8 py-8 animate-in fade-in slide-in-from-bottom-4 duration-500">

          {/* Search Bar */}
          <div className="relative group mb-8">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-orange-500 transition-colors" size={18} />
            <input
              type="text"
              placeholder="Buscar por nombre, código, ciudad..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-3 rounded-2xl bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm border border-gray-100 dark:border-slate-800 outline-none focus:ring-4 focus:ring-orange-500/10 focus:border-orange-500/50 text-base font-bold text-gray-900 dark:text-white transition-all shadow-sm"
            />
          </div>

          {/* Stats Summary */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-2xl shadow-sm p-4 border border-gray-100 dark:border-slate-800">
              <p className="text-[10px] md:text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest mb-1">Total</p>
              <p className="text-2xl md:text-3xl font-black text-gray-900 dark:text-white">{stores.length}</p>
            </div>
            <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-2xl shadow-sm p-4 border border-gray-100 dark:border-slate-800">
              <p className="text-[10px] md:text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest mb-1">Activas</p>
              <p className="text-2xl md:text-3xl font-black text-green-600 dark:text-green-500">{stores.filter(s => s.is_active).length}</p>
            </div>
          </div>

          {/* Stores Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredStores.map((store) => (
              <div
                key={store.id}
                className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-[2rem] shadow-sm hover:shadow-xl transition-all duration-300 border border-gray-100 dark:border-slate-800 overflow-hidden group flex flex-col"
              >
                <div className="p-6 flex-1 flex flex-col">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1 min-w-0 pr-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider">
                          {store.code || 'S/C'}
                        </span>
                        <div className={`w-2 h-2 rounded-full ${store.is_active ? 'bg-green-500 animate-pulse' : 'bg-red-400'}`} />
                      </div>
                      <h3 className="text-xl font-black text-gray-900 dark:text-white leading-tight truncate tracking-tight">
                        {formatStoreName(store.name)}
                      </h3>
                      <div className="flex items-center gap-1.5 text-gray-500 dark:text-slate-400 mt-1">
                        <MapPin size={12} className="shrink-0" />
                        <p className="text-xs font-bold truncate">
                          {store.city}, {store.state}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleEdit(store)}
                      className="p-2.5 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-2xl text-gray-400 hover:text-gray-900 dark:hover:text-white transition-all active:scale-90"
                    >
                      <Edit size={20} />
                    </button>
                  </div>

                  {store.supervisor_name && (
                    <div className="mb-6 bg-gray-50/50 dark:bg-slate-800/50 rounded-2xl p-4 flex items-center gap-3 border border-gray-100/50 dark:border-slate-800/50">
                      <div className="w-10 h-10 rounded-xl bg-white dark:bg-slate-800 flex items-center justify-center text-lg shadow-sm border border-gray-100 dark:border-slate-700">👮‍♂️</div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest">Supervisor</p>
                        <p className="text-sm font-black text-gray-800 dark:text-slate-200 truncate">{store.supervisor_name}</p>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2 mt-auto">
                    <button
                      onClick={() => setSelectedStore(selectedStore?.id === store.id ? null : store)}
                      className={`flex-1 py-3.5 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all ${selectedStore?.id === store.id
                        ? 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400'
                        : 'bg-gray-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:shadow-lg active:scale-95'}`}
                    >
                      {selectedStore?.id === store.id ? 'OCULTAR DETALLES' : 'VER DETALLES'}
                    </button>
                  </div>

                  {selectedStore?.id === store.id && (
                    <div className="mt-4 pt-4 border-t border-dashed border-gray-200 dark:border-slate-800 space-y-3">
                      <div className="flex justify-between items-start">
                        <span className="text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-wider mt-0.5">Dirección</span>
                        <span className="text-xs font-bold text-gray-800 dark:text-slate-200 text-right max-w-[70%]">{store.address}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-wider">Teléfono</span>
                        <span className="text-xs font-bold text-gray-800 dark:text-slate-200">{store.phone || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-wider">Horario</span>
                        <span className="text-xs font-bold text-gray-800 dark:text-slate-200">{store.hours || 'N/A'}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {filteredStores.length === 0 && (
            <div className="text-center py-20 opacity-50">
              <Store size={64} className="mx-auto text-gray-300 dark:text-slate-700 mb-4" />
              <p className="text-gray-900 dark:text-white font-black uppercase tracking-widest leading-none">No se encontraron tiendas</p>
              <p className="text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest mt-2 font-mono">Prueba con otro término</p>
            </div>
          )}
        </div>
      </main>

      {/* MODAL EDITAR/CREAR */}
      <AnimatePresence>
        {isEditing && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-gray-900/60 dark:bg-black/80 backdrop-blur-sm"
              onClick={() => setIsEditing(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl overflow-hidden border border-gray-100 dark:border-slate-800 flex flex-col max-h-[90vh]"
            >
              <div className="p-8 overflow-y-auto no-scrollbar">
                <div className="flex justify-between items-center mb-8">
                  <h2 className="text-2xl font-black text-gray-900 dark:text-white tracking-tighter uppercase">
                    {editingStore?.id ? 'Editar Sucursal' : 'Nueva Sucursal'}
                  </h2>
                  <button onClick={() => setIsEditing(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full transition-colors">
                    <X size={24} className="text-gray-400" />
                  </button>
                </div>

                <form onSubmit={handleSave} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest ml-1">Nombre</label>
                      <input
                        className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-800 border-none rounded-2xl font-bold text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-orange-500/20"
                        value={editingStore.name}
                        onChange={e => setEditingStore({ ...editingStore, name: e.target.value })}
                        required
                        placeholder="Ej: Reforma"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest ml-1">Código</label>
                      <input
                        className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-800 border-none rounded-2xl font-bold text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-orange-500/20"
                        value={editingStore.code}
                        onChange={e => setEditingStore({ ...editingStore, code: e.target.value })}
                        required
                        placeholder="Ej: S001"
                      />
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <label className="text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest ml-1">Dirección</label>
                      <textarea
                        className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-800 border-none rounded-2xl font-bold text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-orange-500/20 resize-none"
                        value={editingStore.address}
                        onChange={e => setEditingStore({ ...editingStore, address: e.target.value })}
                        rows={2}
                        placeholder="Calle, Número, Colonia..."
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest ml-1">Ciudad</label>
                      <input
                        className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-800 border-none rounded-2xl font-bold text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-orange-500/20"
                        value={editingStore.city}
                        onChange={e => setEditingStore({ ...editingStore, city: e.target.value })}
                        placeholder="Ej: CDMX"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest ml-1">Estado</label>
                      <input
                        className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-800 border-none rounded-2xl font-bold text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-orange-500/20"
                        value={editingStore.state}
                        onChange={e => setEditingStore({ ...editingStore, state: e.target.value })}
                        placeholder="Ej: CDMX"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest ml-1">Teléfono</label>
                      <input
                        className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-800 border-none rounded-2xl font-bold text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-orange-500/20"
                        value={editingStore.phone}
                        onChange={e => setEditingStore({ ...editingStore, phone: e.target.value })}
                        placeholder="Ej: 5512345678"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest ml-1">Supervisor</label>
                      <input
                        className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-800 border-none rounded-2xl font-bold text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-orange-500/20"
                        value={editingStore.supervisor_name}
                        onChange={e => setEditingStore({ ...editingStore, supervisor_name: e.target.value })}
                        placeholder="Nombre del supervisor"
                      />
                    </div>
                  </div>

                  <div className="flex gap-4 mt-8 pt-4 border-t border-gray-100 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => setIsEditing(false)}
                      className="flex-1 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-700 transition-all font-mono"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className="flex-1 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest bg-orange-600 text-white hover:bg-orange-700 shadow-lg shadow-orange-200/50 dark:shadow-none transition-all active:scale-95 disabled:opacity-50"
                    >
                      {saving ? 'GUARDANDO...' : 'GUARDAR CAMBIOS'}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}