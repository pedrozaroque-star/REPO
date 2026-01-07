'use client'

import { useEffect, useState } from 'react'
import { Store, MapPin, Search, Plus, X, Save, Trash2, Edit } from 'lucide-react'
import { getSupabaseClient, formatStoreName } from '@/lib/supabase'

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

      // Obtener tiendas con supervisor
      const { data: storesData, error } = await supabase
        .from('stores')
        .select('*')
        .order('name')

      if (error) throw error

      setStores(storesData || [])

      // Obtener estadísticas basicas
      const storesWithStatsPromises = (storesData || []).map(async (store) => {
        // En un escenario real, esto debería ser una vista SQL o una RPC para performance
        // Por ahora lo simplificamos para no bloquear el renderizado
        // Simulamos stats vacíos o básicos para carga rápida
        return {
          ...store,
          stats: {
            feedbackCount: 0,
            avgNPS: 0,
            avgInspection: 0
          }
        }
      })

      const storesWithStatsData = await Promise.all(storesWithStatsPromises)
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
      supervisor_name: '', // Opción simple por ahora
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

      // Sanitizar datos
      const payload = {
        name: editingStore.name,
        code: editingStore.code,
        city: editingStore.city,
        state: editingStore.state,
        address: editingStore.address,
        phone: editingStore.phone,
        hours: editingStore.hours,
        supervisor_name: editingStore.supervisor_name,
        is_active: editingStore.is_active
      }

      let error

      if (editingStore.id) {
        // Update
        const { error: updateError } = await supabase
          .from('stores')
          .update(payload)
          .eq('id', editingStore.id)
        error = updateError
      } else {
        // Create
        const { error: insertError } = await supabase
          .from('stores')
          .insert([payload])
        error = insertError
      }

      if (error) throw error

      await fetchData() // Recargar datos
      setIsEditing(false)
      setEditingStore(null)

    } catch (err: any) {
      alert('Error al guardar: ' + err.message)
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
    return (
      <div className="flex h-screen items-center justify-center bg-transparent">
        <div className="text-center animate-pulse">
          <Store size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-400 font-medium">Cargando sucursales...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex bg-transparent font-sans w-full animate-in fade-in duration-500">
      <main className="flex-1 flex flex-col h-full w-full relative">

        {/* STICKY HEADER - Mobile & Desktop */}
        <div className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-20 shrink-0 transition-all top-[63px]">
          <div className="max-w-7xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between gap-4">

            {/* Title Area */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-orange-100 flex items-center justify-center text-orange-600">
                <Store size={18} />
              </div>
              <h1 className="text-lg md:text-xl font-black text-gray-900 tracking-tight">Tiendas</h1>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              <div className="hidden md:flex relative group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-orange-500 transition-colors" size={16} />
                <input
                  type="text"
                  placeholder="Buscar sucursal..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 pr-4 py-1.5 rounded-full bg-gray-100 border-none outline-none focus:ring-2 focus:ring-orange-200 text-sm font-medium w-64 transition-all"
                />
              </div>

              <button
                onClick={handleCreate}
                className="bg-gray-900 text-white px-3 py-1.5 md:px-4 md:py-2 rounded-xl font-bold text-xs md:text-sm flex items-center gap-2 hover:bg-black transition-transform active:scale-95 shadow-lg shadow-gray-200"
              >
                <Plus size={16} strokeWidth={3} />
                <span className="hidden md:inline">NUEVA TIENDA</span>
              </button>
            </div>
          </div>
        </div>

        {/* MAIN CONTENT AREA - Scrollable */}
        <div className="flex-1 w-full max-w-7xl mx-auto px-4 md:px-8 py-8 animate-in fade-in slide-in-from-bottom-4 duration-500">

          {/* Mobile Search - Visible only on small screens */}
          <div className="md:hidden sticky top-0 z-10 -mt-2 mb-6">
            <div className="relative group shadow-lg shadow-gray-200/50 rounded-full">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="Buscar por nombre, código..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-11 pr-4 py-3 rounded-full bg-white border border-gray-100 outline-none focus:border-orange-300 text-sm font-bold text-gray-900 placeholder:text-gray-400"
              />
            </div>
          </div>

          {/* Stats Summary - Now Scrollable */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <div className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100">
              <p className="text-[10px] md:text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Total</p>
              <p className="text-2xl md:text-3xl font-black text-gray-900">{stores.length}</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100">
              <p className="text-[10px] md:text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Activas</p>
              <p className="text-2xl md:text-3xl font-black text-green-600">{stores.filter(s => s.is_active).length}</p>
            </div>
          </div>

          {/* Stores Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {filteredStores.map((store) => (
              <div
                key={store.id}
                className="bg-white rounded-3xl shadow-[0_2px_15px_-5px_rgba(0,0,0,0.05)] hover:shadow-lg transition-all border border-gray-100 overflow-hidden group"
              >
                <div className="p-5">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1 min-w-0 pr-4">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="bg-orange-100 text-orange-700 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider">
                          {store.code || 'S/C'}
                        </span>
                        {store.is_active ? (
                          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" title="Activa" />
                        ) : (
                          <div className="w-2 h-2 rounded-full bg-red-400" title="Inactiva" />
                        )}
                      </div>
                      <h3 className="text-lg font-black text-gray-900 leading-tight truncate">
                        {formatStoreName(store.name)}
                      </h3>
                      <div className="flex items-center gap-1.5 text-gray-500 mt-1">
                        <MapPin size={12} className="shrink-0" />
                        <p className="text-xs font-medium truncate">
                          {store.city}, {store.state}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleEdit(store)}
                      className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-900 transition-colors"
                    >
                      <Edit size={18} />
                    </button>
                  </div>

                  {store.supervisor_name && (
                    <div className="mb-4 bg-gray-50 rounded-xl p-3 flex items-center gap-3 border border-gray-100">
                      <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-xs shadow-sm border border-gray-100">👮‍♂️</div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Supervisor</p>
                        <p className="text-xs font-bold text-gray-900 truncate">{store.supervisor_name}</p>
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-2 border-t border-gray-50">
                    <button
                      onClick={() => setSelectedStore(selectedStore?.id === store.id ? null : store)}
                      className={`flex-1 py-2.5 rounded-xl font-black text-xs transition-colors ${selectedStore?.id === store.id ? 'bg-gray-100 text-gray-600' : 'bg-gray-900 text-white hover:bg-black'}`}
                    >
                      {selectedStore?.id === store.id ? 'OCULTAR DETALLES' : 'VER DETALLES'}
                    </button>
                  </div>

                  {/* Expanded Details */}
                  {selectedStore?.id === store.id && (
                    <div className="mt-4 pt-4 border-t border-dashed border-gray-200">
                      <div className="space-y-3 text-xs">
                        <div className="flex justify-between items-center">
                          <span className="text-gray-500 font-medium">Dirección</span>
                          <span className="font-bold text-gray-800 text-right max-w-[60%]">{store.address}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-gray-500 font-medium">Teléfono</span>
                          <span className="font-bold text-gray-800">{store.phone || 'N/A'}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-gray-500 font-medium">Horario</span>
                          <span className="font-bold text-gray-800">{store.hours || 'N/A'}</span>
                        </div>
                      </div>
                    </div>
                  )}

                </div>
              </div>
            ))}
          </div>

          {filteredStores.length === 0 && (
            <div className="text-center py-20 opacity-50">
              <Store size={64} className="mx-auto text-gray-300 mb-4" />
              <p className="text-gray-900 font-bold">No se encontraron tiendas</p>
              <p className="text-sm text-gray-500">Intenta con otra búsqueda</p>
            </div>
          )}
        </div>

        {/* EDIT/CREATE MODAL */}
        {isEditing && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden transform transition-all scale-100 max-h-[90vh] flex flex-col">
              <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center text-orange-600">
                    {editingStore.id ? <Edit size={20} /> : <Plus size={20} />}
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-gray-900">{editingStore.id ? 'Editar Tienda' : 'Nueva Tienda'}</h3>
                    <p className="text-xs text-gray-500 font-medium">{editingStore.id ? 'Modificar datos de la sucursal' : 'Registrar nueva sucursal'}</p>
                  </div>
                </div>
                <button onClick={() => setIsEditing(false)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors">
                  <X size={20} />
                </button>
              </div>

              <div className="p-6 md:p-8 overflow-y-auto custom-scrollbar">
                <form id="storeForm" onSubmit={handleSave} className="space-y-6">

                  {/* Basic Info */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Nombre de la Sucursal *</label>
                      <input
                        required
                        type="text"
                        value={editingStore.name}
                        onChange={e => setEditingStore({ ...editingStore, name: e.target.value })}
                        className="w-full p-3 bg-gray-50 border-gray-100 rounded-xl font-bold text-gray-900 outline-none focus:ring-2 focus:ring-orange-100 transition-all"
                        placeholder="Ej: Reforma"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Código Único *</label>
                      <input
                        required
                        type="text"
                        value={editingStore.code}
                        onChange={e => setEditingStore({ ...editingStore, code: e.target.value })}
                        className="w-full p-3 bg-gray-50 border-gray-100 rounded-xl font-bold text-gray-900 outline-none focus:ring-2 focus:ring-orange-100 transition-all"
                        placeholder="Ej: S001"
                      />
                    </div>
                  </div>

                  {/* Location Info */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Dirección Completa</label>
                    <textarea
                      value={editingStore.address}
                      onChange={e => setEditingStore({ ...editingStore, address: e.target.value })}
                      className="w-full p-3 bg-gray-50 border-gray-100 rounded-xl font-medium text-gray-700 outline-none focus:ring-2 focus:ring-orange-100 transition-all resize-none"
                      rows={2}
                      placeholder="Calle, Número, Colonia..."
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Ciudad *</label>
                      <input
                        required
                        type="text"
                        value={editingStore.city}
                        onChange={e => setEditingStore({ ...editingStore, city: e.target.value })}
                        className="w-full p-3 bg-gray-50 border-gray-100 rounded-xl font-bold text-gray-700 outline-none focus:ring-2 focus:ring-orange-100 transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Estado</label>
                      <input
                        type="text"
                        value={editingStore.state}
                        onChange={e => setEditingStore({ ...editingStore, state: e.target.value })}
                        className="w-full p-3 bg-gray-50 border-gray-100 rounded-xl font-bold text-gray-700 outline-none focus:ring-2 focus:ring-orange-100 transition-all"
                      />
                    </div>
                  </div>

                  {/* Operational Info */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Teléfono</label>
                      <input
                        type="tel"
                        value={editingStore.phone}
                        onChange={e => setEditingStore({ ...editingStore, phone: e.target.value })}
                        className="w-full p-3 bg-gray-50 border-gray-100 rounded-xl font-medium text-gray-700 outline-none focus:ring-2 focus:ring-orange-100 transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Horario</label>
                      <input
                        type="text"
                        value={editingStore.hours}
                        onChange={e => setEditingStore({ ...editingStore, hours: e.target.value })}
                        className="w-full p-3 bg-gray-50 border-gray-100 rounded-xl font-medium text-gray-700 outline-none focus:ring-2 focus:ring-orange-100 transition-all"
                        placeholder="Lun-Dom 8am - 10pm"
                      />
                    </div>
                  </div>

                  {/* Management */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Supervisor (Nombre)</label>
                      <input
                        type="text"
                        value={editingStore.supervisor_name}
                        onChange={e => setEditingStore({ ...editingStore, supervisor_name: e.target.value })}
                        className="w-full p-3 bg-gray-50 border-gray-100 rounded-xl font-medium text-gray-700 outline-none focus:ring-2 focus:ring-orange-100 transition-all"
                        placeholder="Nombre del Supervisor asignado"
                      />
                    </div>
                    <div className="space-y-2 flex items-center gap-4 pt-6">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Estatus</label>
                      <button
                        type="button"
                        onClick={() => setEditingStore({ ...editingStore, is_active: !editingStore.is_active })}
                        className={`relative inline-flex h-8 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-orange-600 focus:ring-offset-2 ${editingStore.is_active ? 'bg-green-500' : 'bg-gray-200'}`}
                      >
                        <span className="sr-only">Use setting</span>
                        <span
                          aria-hidden="true"
                          className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${editingStore.is_active ? 'translate-x-6' : 'translate-x-0'}`}
                        />
                      </button>
                      <span className={`text-sm font-bold ${editingStore.is_active ? 'text-green-600' : 'text-gray-400'}`}>
                        {editingStore.is_active ? 'Activa' : 'Inactiva'}
                      </span>
                    </div>
                  </div>

                </form>
              </div>

              <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3 sticky bottom-0">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="px-6 py-3 rounded-xl font-bold text-gray-500 hover:bg-gray-200 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  form="storeForm"
                  disabled={saving}
                  className="px-8 py-3 rounded-xl font-bold text-white bg-orange-600 hover:bg-orange-700 shadow-lg shadow-orange-200 transition-transform active:scale-95 disabled:opacity-50 flex items-center gap-2"
                >
                  {saving ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save size={18} />}
                  {editingStore.id ? 'Guardar Cambios' : 'Crear Tienda'}
                </button>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  )
}