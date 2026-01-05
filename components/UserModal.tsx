'use client'

import { useState, useEffect } from 'react'
import { X } from 'lucide-react'

interface UserModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (data: any, isEdit: boolean) => void
  stores: any[]
  initialData?: any
}

export default function UserModal({ isOpen, onClose, onSave, stores, initialData }: UserModalProps) {
  // Estado del formulario
  const [formData, setFormData] = useState({
    full_name: '',
    email: '',
    password: '',
    phone: '',
    role: 'asistente', // Rol por defecto
    store_id: '',      // Para Manager/Asistente
    store_scope: [] as string[],   // Para Supervisor (Array de Nombres)
    is_active: true
  })

  // Cargar datos al abrir (Editar) o limpiar (Nuevo)
  useEffect(() => {
    if (initialData) {
      setFormData({
        full_name: initialData.full_name || '',
        email: initialData.email || '',
        password: '', // Siempre limpia por seguridad
        phone: initialData.phone || '',
        role: initialData.role || 'asistente',
        store_id: initialData.store_id || '',
        store_scope: initialData.store_scope || [],
        is_active: initialData.is_active ?? true
      })
    } else {
      // Reset para nuevo usuario
      setFormData({
        full_name: '',
        email: '',
        password: '',
        phone: '',
        role: 'asistente',
        store_id: '',
        store_scope: [],
        is_active: true
      })
    }
  }, [initialData, isOpen])

  if (!isOpen) return null

  // Manejadores de cambios
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleToggleActive = () => {
    setFormData(prev => ({ ...prev, is_active: !prev.is_active }))
  }

  // Manejador especial para Checkboxes de Supervisor
  const handleScopeChange = (storeName: string) => {
    setFormData(prev => {
      const currentScope = prev.store_scope || []
      if (currentScope.includes(storeName)) {
        return { ...prev, store_scope: currentScope.filter(s => s !== storeName) }
      } else {
        return { ...prev, store_scope: [...currentScope, storeName] }
      }
    })
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Validaciones básicas
    if (!formData.email || !formData.full_name) {
      alert('Nombre y Email son obligatorios')
      return
    }
    // Si es nuevo, password es obligatorio
    if (!initialData && !formData.password) {
      alert('La contraseña es obligatoria para nuevos usuarios')
      return
    }

    // Enviamos al padre (page.tsx)
    // Adjuntamos el ID original si es edición
    onSave({ ...formData, id: initialData?.id }, !!initialData)
  }

  // Helpers de UI
  const isSupervisor = formData.role === 'supervisor'
  const isAdmin = formData.role === 'admin'
  const isStaff = ['manager', 'asistente'].includes(formData.role)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden transform transition-all scale-100">

        {/* Cabecera */}
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-100 flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-900">
            {initialData ? '✏️ Editar Usuario' : '👤 Nuevo Usuario'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors p-1 hover:bg-gray-100 rounded-full">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* COLUMNA 1: Datos Personales */}
          <div className="space-y-4">
            <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest border-b pb-2">Información Personal</h3>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Nombre Completo</label>
              <input
                name="full_name"
                type="text"
                required
                value={formData.full_name}
                onChange={handleChange}
                // CORRECCIÓN: Agregado text-gray-900 bg-white placeholder-gray-400
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-gray-900 bg-white placeholder-gray-400"
                placeholder="Ej: Juan Pérez"
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Correo Electrónico</label>
              <input
                name="email"
                type="email"
                required
                disabled={!!initialData} // Email no editable usualmente por seguridad Auth
                value={formData.email}
                onChange={handleChange}
                // CORRECCIÓN: Agregado text-gray-900 bg-white (o bg-gray-100 si disabled)
                className={`w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-gray-900 placeholder-gray-400 ${initialData ? 'bg-gray-100 cursor-not-allowed text-gray-500' : 'bg-white'}`}
                placeholder="juan@tacosgavilan.com"
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Contraseña</label>
              <input
                name="password"
                type="password"
                value={formData.password}
                onChange={handleChange}
                // CORRECCIÓN: Agregado text-gray-900 bg-white placeholder-gray-400
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-gray-900 bg-white placeholder-gray-400"
                placeholder={initialData ? "Dejar vacío para no cambiar" : "Mínimo 6 caracteres"}
              />
              {initialData && <p className="text-[10px] text-gray-400 mt-1">Solo escribe si deseas cambiarla.</p>}
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Teléfono (Opcional)</label>
              <input
                name="phone"
                type="tel"
                value={formData.phone}
                onChange={handleChange}
                // CORRECCIÓN: Agregado text-gray-900 bg-white placeholder-gray-400
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-gray-900 bg-white placeholder-gray-400"
                placeholder="(555) 123-4567"
              />
            </div>
          </div>

          {/* COLUMNA 2: Permisos y Tienda */}
          <div className="space-y-4">
            <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest border-b pb-2">Accesos y Rol</h3>

            <div className="flex items-center justify-between bg-gray-50 p-3 rounded-lg border border-gray-200">
              <span className="text-sm font-medium text-gray-700">Estado del Usuario</span>
              <button
                type="button"
                onClick={handleToggleActive}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${formData.is_active ? 'bg-green-500' : 'bg-gray-300'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Rol en el Sistema</label>
              <select
                name="role"
                value={formData.role}
                onChange={handleChange}
                // CORRECCIÓN: Agregado text-gray-900 bg-white
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-900"
              >
                <option value="asistente">👷 Asistente (Operativo)</option>
                <option value="manager">👔 Manager (Encargado)</option>
                <option value="supervisor">👀 Supervisor (Auditor)</option>
                <option value="admin">👮‍♂️ Admin (Total)</option>
              </select>
            </div>

            {/* ZONA DINÁMICA DE TIENDAS */}
            <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">

              {/* CASO A: ADMIN */}
              {isAdmin && (
                <div className="text-center py-2">
                  <span className="text-2xl">🌍</span>
                  <p className="text-sm font-bold text-blue-800 mt-1">Acceso Global</p>
                  <p className="text-xs text-blue-600">Puede ver todas las tiendas.</p>
                </div>
              )}

              {/* CASO B: MANAGER / ASISTENTE (1 Tienda) */}
              {isStaff && (
                <div>
                  <label className="block text-xs font-bold text-blue-800 uppercase mb-2">Tienda Asignada</label>
                  <select
                    name="store_id"
                    value={formData.store_id}
                    onChange={handleChange}
                    // CORRECCIÓN: Agregado text-gray-900 bg-white
                    className="w-full px-3 py-2 border border-blue-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-900"
                  >
                    <option value="">-- Seleccionar Tienda --</option>
                    {stores.map(store => (
                      <option key={store.id} value={store.id}>{store.name}</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-blue-600 mt-1">Lugar físico de trabajo.</p>
                </div>
              )}

              {/* CASO C: SUPERVISOR (Múltiples Tiendas) */}
              {isSupervisor && (
                <div>
                  <label className="block text-xs font-bold text-purple-800 uppercase mb-2">Tiendas a Supervisar</label>
                  <div className="max-h-40 overflow-y-auto space-y-1 bg-white p-2 rounded border border-purple-200">
                    {stores.map(store => (
                      <label key={store.id} className="flex items-center space-x-2 p-1 hover:bg-purple-50 rounded cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.store_scope.includes(store.name)} // Comparamos por Nombre
                          onChange={() => handleScopeChange(store.name)}
                          className="rounded text-purple-600 focus:ring-purple-500"
                        />
                        <span className="text-sm text-gray-900">{store.name}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-[10px] text-purple-600 mt-1">Selecciona todas las que apliquen.</p>
                </div>
              )}
            </div>

          </div>

          {/* Botones Footer */}
          <div className="md:col-span-2 flex justify-end gap-3 pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-8 py-2.5 text-sm font-bold text-white bg-gray-900 hover:bg-black rounded-xl shadow-lg hover:-translate-y-0.5 transition-all"
            >
              {initialData ? 'Guardar Cambios' : 'Crear Usuario'}
            </button>
          </div>

        </form>
      </div>
    </div>
  )
}