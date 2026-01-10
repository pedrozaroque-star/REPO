'use client'

import { useState, useEffect } from 'react'
import { X, User, Mail, Lock, Phone, Shield, Store, CheckCircle2, AlertCircle, Eye, EyeOff } from 'lucide-react'

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
    confirmPassword: '',
    phone: '',
    role: 'asistente',
    store_id: '',
    store_scope: [] as string[],
    is_active: true
  })

  // UI State
  const [showPassword, setShowPassword] = useState(false)
  const [passError, setPassError] = useState('')

  // Cargar datos
  useEffect(() => {
    if (initialData) {
      setFormData({
        full_name: initialData.full_name || '',
        email: initialData.email || '',
        password: '',
        confirmPassword: '', // Reset en edición
        phone: initialData.phone || '',
        role: initialData.role || 'asistente',
        store_id: initialData.store_id || '',
        store_scope: initialData.store_scope || [],
        is_active: initialData.is_active ?? true
      })
    } else {
      // Reset completo
      setFormData({
        full_name: '',
        email: '',
        password: '',
        confirmPassword: '',
        phone: '',
        role: 'asistente',
        store_id: '',
        store_scope: [],
        is_active: true
      })
    }
    setPassError('')
  }, [initialData, isOpen])

  if (!isOpen) return null

  // Helpers
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))

    // Validación realtime de password
    if (name === 'password' || name === 'confirmPassword') {
      const p = name === 'password' ? value : formData.password
      const cp = name === 'confirmPassword' ? value : formData.confirmPassword

      if (p !== cp && cp !== '') {
        setPassError('Las contraseñas no coinciden')
      } else {
        setPassError('')
      }
    }
  }

  const handleToggleActive = () => {
    setFormData(prev => ({ ...prev, is_active: !prev.is_active }))
  }

  const handleScopeChange = (storeName: string) => {
    setFormData(prev => {
      const currentScope = prev.store_scope || []
      return currentScope.includes(storeName)
        ? { ...prev, store_scope: currentScope.filter(s => s !== storeName) }
        : { ...prev, store_scope: [...currentScope, storeName] }
    })
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    // Validaciones
    if (!formData.email || !formData.full_name) {
      alert('Nombre y Email son obligatorios')
      return
    }

    // Validación Password
    if (!initialData) {
      // Nuevo usuario: Password obligatorio
      if (!formData.password) {
        setPassError('La contraseña es obligatoria')
        return
      }
    }

    if (formData.password || formData.confirmPassword) {
      if (formData.password !== formData.confirmPassword) {
        setPassError('Las contraseñas no coinciden')
        return
      }
      if (formData.password.length < 6) {
        setPassError('La contraseña debe tener al menos 6 caracteres')
        return
      }
    }

    // Limpiar campos auxiliares antes de enviar
    const { confirmPassword, ...dataToSend } = formData
    onSave({ ...dataToSend, id: initialData?.id }, !!initialData)
  }

  // UI Helpers
  const isSupervisor = formData.role === 'supervisor'
  const isAdmin = formData.role === 'admin'
  const isStaff = ['manager', 'asistente'].includes(formData.role)

  // Calcular fuerza password visualmente
  const passStrength = formData.password.length === 0 ? 0 : formData.password.length < 6 ? 1 : formData.password.length < 10 ? 2 : 3
  const strengthColors = ['bg-gray-200', 'bg-red-400', 'bg-yellow-400', 'bg-green-500']

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl overflow-hidden transform transition-all scale-100 flex flex-col md:flex-row h-[90vh] md:h-auto max-h-[800px]">

        {/* SIDEBAR VISUAL (Desktop only) */}
        <div className="hidden md:flex w-1/3 bg-slate-900 p-8 flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-slate-800 rounded-full blur-3xl -mr-32 -mt-32 opacity-50"></div>
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-indigo-900 rounded-full blur-3xl -ml-32 -mb-32 opacity-50"></div>

          <div className="relative z-10">
            <h2 className="text-3xl font-black text-white tracking-tight leading-none mb-2">
              {initialData ? 'Editar' : 'Nuevo'} <br />
              <span className="text-indigo-400">Usuario</span>
            </h2>
            <p className="text-slate-400 text-sm">
              Gestione los accesos y roles del personal de manera segura.
            </p>
          </div>

          <div className="relative z-10 space-y-6">
            <div className="flex items-start gap-4 text-slate-300">
              <div className="p-2 bg-slate-800 rounded-lg shrink-0"><Shield size={20} className="text-indigo-400" /></div>
              <div>
                <h4 className="font-bold text-white text-sm">Seguridad Primero</h4>
                <p className="text-xs text-slate-400 mt-1">Configura roles específicos para limitar el acceso a datos sensibles.</p>
              </div>
            </div>

            <div className="flex items-start gap-4 text-slate-300">
              <div className="p-2 bg-slate-800 rounded-lg shrink-0"><Store size={20} className="text-emerald-400" /></div>
              <div>
                <h4 className="font-bold text-white text-sm">Asignación Inteligente</h4>
                <p className="text-xs text-slate-400 mt-1">Vincula usuarios a una o múltiples tiendas según su función.</p>
              </div>
            </div>
          </div>

          <div className="relative z-10 text-xs text-slate-500 font-mono">
            Tacos Gavilán System v2.0
          </div>
        </div>

        {/* FORMULARIO PRINCIPAL */}
        <div className="flex-1 flex flex-col md:h-auto overflow-hidden">

          {/* Mobile Header */}
          <div className="md:hidden p-4 bg-slate-900 text-white flex justify-between items-center">
            <h2 className="font-bold text-lg">{initialData ? 'Editar Usuario' : 'Nuevo Usuario'}</h2>
            <button onClick={onClose}><X size={24} /></button>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-8">

            <form id="userForm" onSubmit={handleSubmit} className="space-y-8">

              {/* SECCIÓN 1: DATOS PERSONALES */}
              <section className="space-y-4">
                <div className="flex items-center gap-2 mb-4">
                  <span className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-sm">1</span>
                  <h3 className="font-bold text-gray-900 text-lg">Información Personal</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="group">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1 group-focus-within:text-indigo-600 transition-colors">Nombre Completo</label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-indigo-500 transition-colors" size={18} />
                      <input
                        name="full_name"
                        value={formData.full_name}
                        onChange={handleChange}
                        required
                        className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-transparent focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-xl outline-none transition-all font-medium text-gray-900 placeholder:text-gray-400"
                        placeholder="Ej. Juan Pérez"
                      />
                    </div>
                  </div>

                  <div className="group">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1 group-focus-within:text-indigo-600 transition-colors">Email Corporativo</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-indigo-500 transition-colors" size={18} />
                      <input
                        name="email"
                        type="email"
                        value={formData.email}
                        onChange={handleChange}
                        required
                        disabled={!!initialData}
                        className={`w-full pl-10 pr-4 py-3 bg-gray-50 border border-transparent focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-xl outline-none transition-all font-medium text-gray-900 ${initialData ? 'opacity-60 cursor-not-allowed' : ''}`}
                        placeholder="juan@tacosgavilan.com"
                      />
                    </div>
                  </div>

                  <div className="group">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1 group-focus-within:text-indigo-600 transition-colors">Teléfono</label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-indigo-500 transition-colors" size={18} />
                      <input
                        name="phone"
                        type="tel"
                        value={formData.phone}
                        onChange={handleChange}
                        className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-transparent focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-xl outline-none transition-all font-medium text-gray-900"
                        placeholder="(555) 000-0000"
                      />
                    </div>
                  </div>

                  {/* Estado Activo Toggle */}
                  <div className="flex items-center justify-between bg-white border border-gray-200 p-3 rounded-xl shadow-sm">
                    <span className="text-sm font-bold text-gray-700 ml-1">Cuenta Activa</span>
                    <button
                      type="button"
                      onClick={handleToggleActive}
                      className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${formData.is_active ? 'bg-green-500' : 'bg-gray-200'}`}
                    >
                      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${formData.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>
                </div>
              </section>

              {/* SECCIÓN 2: SEGURIDAD */}
              <section className="space-y-4 pt-4 border-t border-gray-100">
                <div className="flex items-center gap-2 mb-4">
                  <span className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-sm">2</span>
                  <h3 className="font-bold text-gray-900 text-lg">Seguridad</h3>
                </div>

                <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100 space-y-5">
                  {/* Password Row */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="group relative">
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Nueva Contraseña</label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                        <input
                          name="password"
                          type={showPassword ? "text" : "password"}
                          value={formData.password}
                          onChange={handleChange}
                          className="w-full pl-10 pr-10 py-3 bg-white border border-gray-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-xl outline-none transition-all font-medium text-gray-900"
                          placeholder={initialData ? "Dejar vacío para no cambiar" : "••••••••"}
                        />
                        <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                          {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                      {/* Strength Bar */}
                      {formData.password && (
                        <div className="flex gap-1 mt-1.5 px-1">
                          {[1, 2, 3].map(level => (
                            <div key={level} className={`h-1.5 rounded-full flex-1 transition-all duration-300 ${passStrength >= level ? strengthColors[passStrength] : 'bg-gray-100'}`} />
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="group">
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Confirmar Contraseña</label>
                      <div className="relative">
                        <CheckCircle2 className={`absolute left-3 top-1/2 -translate-y-1/2 transition-colors ${formData.confirmPassword && !passError ? 'text-green-500' : 'text-gray-400'}`} size={18} />
                        <input
                          name="confirmPassword"
                          type="password"
                          value={formData.confirmPassword}
                          onChange={handleChange}
                          disabled={!formData.password}
                          className={`w-full pl-10 pr-4 py-3 bg-white border focus:ring-4 focus:ring-indigo-500/10 rounded-xl outline-none transition-all font-medium text-gray-900 
                              ${passError ? 'border-red-300 focus:border-red-500 bg-red-50' : 'border-gray-200 focus:border-indigo-500'}`}
                          placeholder="Repetir contraseña"
                        />
                      </div>
                      {passError && (
                        <div className="flex items-center gap-1 mt-1.5 ml-1 text-red-500 text-xs font-bold animate-pulse">
                          <AlertCircle size={12} /> {passError}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </section>

              {/* SECCIÓN 3: ROLES */}
              <section className="space-y-4 pt-4 border-t border-gray-100">
                <div className="flex items-center gap-2 mb-4">
                  <span className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-sm">3</span>
                  <h3 className="font-bold text-gray-900 text-lg">Roles y Permisos</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Selector de Rol */}
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-2 ml-1">Rol del Usuario</label>
                    <div className="grid grid-cols-1 gap-2">
                      {['asistente', 'manager', 'supervisor', 'admin'].map((roleOp) => (
                        <label key={roleOp} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${formData.role === roleOp ? 'bg-indigo-50 border-indigo-500 ring-1 ring-indigo-500' : 'bg-white border-gray-200 hover:border-gray-300'}`}>
                          <input
                            type="radio"
                            name="role"
                            value={roleOp}
                            checked={formData.role === roleOp}
                            onChange={handleChange}
                            className="w-4 h-4 text-indigo-600 focus:ring-indigo-500 border-gray-300"
                          />
                          <div>
                            <span className="block text-sm font-bold text-gray-900 capitalize">{roleOp}</span>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Selector de Tiendas Dinámico */}
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 h-fit">

                    {isAdmin && (
                      <div className="text-center py-8">
                        <div className="w-16 h-16 bg-slate-200 rounded-full flex items-center justify-center mx-auto mb-3">
                          <span className="text-3xl">🌍</span>
                        </div>
                        <h4 className="font-bold text-slate-700">Acceso Global</h4>
                        <p className="text-xs text-slate-500 px-4 mt-2">Los administradores tienen acceso irrestricto a todas las tiendas.</p>
                      </div>
                    )}

                    {isStaff && (
                      <div className="space-y-2">
                        <label className="block text-xs font-bold text-slate-500 uppercase">Tienda Asignada</label>
                        <select
                          name="store_id"
                          value={formData.store_id}
                          onChange={handleChange}
                          className="w-full p-3 rounded-lg border border-slate-300 bg-white text-sm font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                          <option value="">-- Seleccionar --</option>
                          {stores.map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                        <p className="text-[10px] text-slate-500 leading-tight">La tienda principal donde este usuario registra su actividad.</p>
                      </div>
                    )}

                    {isSupervisor && (
                      <div className="space-y-2 h-full flex flex-col">
                        <label className="block text-xs font-bold text-purple-600 uppercase">Supervisión (Múltiple)</label>
                        <div className="flex-1 bg-white border border-slate-200 rounded-lg p-2 max-h-[200px] overflow-y-auto space-y-1">
                          {stores.map(store => (
                            <label key={store.id} className="flex items-center gap-2 p-2 hover:bg-purple-50 rounded-lg cursor-pointer transition-colors">
                              <input
                                type="checkbox"
                                checked={formData.store_scope.includes(store.name)}
                                onChange={() => handleScopeChange(store.name)}
                                className="rounded text-purple-600 focus:ring-purple-500"
                              />
                              <span className="text-xs font-bold text-gray-700">{store.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </section>

            </form>
          </div>

          {/* Footer Actions */}
          <div className="p-4 md:p-6 border-t border-gray-100 bg-white/80 backdrop-blur flex justify-end gap-3 z-10 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 rounded-xl text-sm font-bold text-gray-500 hover:bg-gray-100 transition-colors"
              disabled={false}
            >
              Cancelar
            </button>
            <button
              type="submit"
              form="userForm"
              className="px-8 py-2.5 rounded-xl text-sm font-bold text-white bg-slate-900 hover:bg-black shadow-lg shadow-gray-200 hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={!!passError}
            >
              {initialData ? 'Guardar Cambios' : 'Crear Usuario'}
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}