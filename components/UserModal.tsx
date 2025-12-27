'use client'

import { useState, useEffect } from 'react'

interface UserModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (userData: any, isEdit: boolean) => Promise<void>
  stores: any[]
  initialData?: any
}

export default function UserModal({ isOpen, onClose, onSave, stores, initialData }: UserModalProps) {
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    id: '',
    full_name: '',
    email: '',
    password: '',
    role: 'asistente',
    store_id: ''
  })

  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        // MODO EDICIÓN
        setFormData({
          id: initialData.id,
          full_name: initialData.full_name || '',
          email: initialData.email || '',
          password: '', // Vacío por defecto
          role: initialData.role || 'asistente',
          store_id: initialData.store_id || ''
        })
      } else {
        // MODO CREACIÓN
        setFormData({
          id: '',
          full_name: '',
          email: '',
          password: '',
          role: 'asistente',
          store_id: stores.length > 0 ? stores[0].id : ''
        })
      }
    }
  }, [initialData, isOpen, stores])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      // Validar contraseña solo si es nuevo
      if (!initialData && !formData.password) {
        alert('La contraseña es obligatoria para nuevos usuarios')
        setLoading(false)
        return
      }
      await onSave(formData, !!initialData)
      onClose()
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform scale-100">
        
        {/* Header */}
        <div className="bg-gray-50 px-6 py-4 border-b border-gray-100 flex justify-between items-center">
          <h3 className="text-xl font-black text-gray-900">
            {initialData ? '✏️ Editar Usuario' : '👤 Nuevo Usuario'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-red-500 font-bold text-2xl transition-colors">&times;</button>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          
          {/* Nombre */}
          <div>
            <label className="block text-xs font-black text-gray-500 uppercase tracking-wide mb-1">Nombre Completo</label>
            <input 
              required
              type="text" 
              value={formData.full_name}
              onChange={e => setFormData({...formData, full_name: e.target.value})}
              className="w-full p-3 bg-white border border-gray-300 text-gray-900 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none font-bold placeholder-gray-300"
              placeholder="Ej. Juan Pérez"
            />
          </div>

          {/* Email (Solo lectura si se edita para evitar conflictos de ID) */}
          <div>
            <label className="block text-xs font-black text-gray-500 uppercase tracking-wide mb-1">Correo Electrónico</label>
            <input 
              required
              disabled={!!initialData} // No permitir cambiar email al editar (es su ID único)
              type="email" 
              value={formData.email}
              onChange={e => setFormData({...formData, email: e.target.value})}
              className={`w-full p-3 border border-gray-300 rounded-xl outline-none font-medium ${initialData ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : 'bg-white text-gray-900 focus:ring-2 focus:ring-blue-500'}`}
              placeholder="juan@tacosgavilan.com"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-black text-gray-500 uppercase tracking-wide mb-1">
              {initialData ? 'Nueva Contraseña (Opcional)' : 'Contraseña'}
            </label>
            <input 
              type="text" 
              value={formData.password}
              onChange={e => setFormData({...formData, password: e.target.value})}
              className="w-full p-3 bg-white border border-gray-300 text-gray-900 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-mono text-sm placeholder-gray-300"
              placeholder={initialData ? "Dejar vacío para mantener actual" : "Mínimo 6 caracteres"}
            />
            {initialData && <p className="text-[10px] text-gray-400 mt-1">Escribe aquí solo si quieres cambiarla.</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Rol */}
            <div>
              <label className="block text-xs font-black text-gray-500 uppercase tracking-wide mb-1">Rol</label>
              <select 
                value={formData.role}
                onChange={e => setFormData({...formData, role: e.target.value})}
                className="w-full p-3 bg-white border border-gray-300 text-gray-900 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-medium appearance-none"
              >
                <option value="user">👤 Asistente</option>
                <option value="manager">📊 Manager</option>
                <option value="supervisor">👔 Supervisor</option>
                <option value="admin">👑 Admin</option>
              </select>
            </div>

            {/* Tienda */}
            <div>
              <label className="block text-xs font-black text-gray-500 uppercase tracking-wide mb-1">Tienda Base</label>
              <select 
                value={formData.store_id}
                onChange={e => setFormData({...formData, store_id: e.target.value})}
                className="w-full p-3 bg-white border border-gray-300 text-gray-900 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-medium appearance-none"
              >
                <option value="">-- Seleccionar --</option>
                {stores.map(store => (
                  <option key={store.id} value={store.id}>{store.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Botones */}
          <div className="pt-4 flex gap-3 border-t border-gray-100 mt-2">
            <button 
              type="button" 
              onClick={onClose}
              className="flex-1 py-3 font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
            >
              Cancelar
            </button>
            <button 
              type="submit" 
              disabled={loading}
              className="flex-1 py-3 font-bold text-white bg-gray-900 hover:bg-black rounded-xl shadow-lg hover:shadow-xl transition-all disabled:opacity-70 flex justify-center items-center"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              ) : (
                initialData ? 'Guardar Cambios' : 'Crear Usuario'
              )}
            </button>
          </div>

        </form>
      </div>
    </div>
  )
}