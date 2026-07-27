/**
 * @module UserModal
 * @description Admin modal component for creating and editing user records.
 * Supports conditional inputs based on user roles and manages assignments.
 * @businessRules
 * - Managers and Assistants require a single store_id and a valid position_type (kitchen/cashier).
 * - Supervisors require a store_scope array (containing full store names with "Tacos Gavilan " prefix).
 * @dataFlow
 * - Props (initialData, stores) -> Modal state -> Form validation -> Save event (onSave).
 * @notes Implements case-insensitive and prefix-insensitive matching for supervisor checkboxes to prevent data loss.
 */

'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, User, Mail, Lock, Phone, Shield, Store, CheckCircle2, AlertCircle, Eye, EyeOff } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'

interface UserModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (data: any, isEdit: boolean) => void
  stores: any[]
  initialData?: any
  toastEmployees?: any[]
  existingUsers?: any[]
}

export default function UserModal({ isOpen, onClose, onSave, stores, initialData, toastEmployees = [], existingUsers = [] }: UserModalProps) {
  const { t } = useLanguage()
  const [mounted, setMounted] = useState(false)
  const [selectedToastGuid, setSelectedToastGuid] = useState('')
  const [deactivateConflict, setDeactivateConflict] = useState(true)

  useEffect(() => {
    setMounted(true)
    return () => setMounted(false)
  }, [])

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
    position_type: 'kitchen',
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
        position_type: initialData.position_type || '',
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
        position_type: 'kitchen',
        is_active: true
      })
    }
    setPassError('')
  }, [initialData, isOpen])

  if (!isOpen || !mounted) return null

  // Helpers
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))

    // Validación realtime de password
    if (name === 'password' || name === 'confirmPassword') {
      const p = name === 'password' ? value : formData.password
      const cp = name === 'confirmPassword' ? value : formData.confirmPassword

      if (p !== cp && cp !== '') {
        setPassError(t('usuarios.modal.errors.pass_mismatch'))
      } else {
        setPassError('')
      }
    }
  }

  const handleToggleActive = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }
    // console.log('🔄 Toggling active state. New state:', !formData.is_active)
    setFormData(prev => ({ ...prev, is_active: !prev.is_active }))
  }

  const isStoreInScope = (storeName: string) => {
    if (!formData.store_scope) return false
    return formData.store_scope.some((s: string) => {
      const normS = s.replace(/^Tacos Gavilan\s+/i, '').toLowerCase().trim()
      const normStore = storeName.replace(/^Tacos Gavilan\s+/i, '').toLowerCase().trim()
      return normS === normStore
    })
  }

  const handleScopeChange = (storeName: string) => {
    setFormData(prev => {
      const currentScope = prev.store_scope || []
      const exists = currentScope.some((s: string) => {
        const normS = s.replace(/^Tacos Gavilan\s+/i, '').toLowerCase().trim()
        const normStore = storeName.replace(/^Tacos Gavilan\s+/i, '').toLowerCase().trim()
        return normS === normStore
      })

      if (exists) {
        const newScope = currentScope.filter((s: string) => {
          const normS = s.replace(/^Tacos Gavilan\s+/i, '').toLowerCase().trim()
          const normStore = storeName.replace(/^Tacos Gavilan\s+/i, '').toLowerCase().trim()
          return normS !== normStore
        })
        return { ...prev, store_scope: newScope }
      } else {
        // Prepend "Tacos Gavilan " to match existing supervisor DB records format
        const fullName = storeName.toLowerCase().startsWith('tacos gavilan')
          ? storeName
          : `Tacos Gavilan ${storeName}`
        return { ...prev, store_scope: [...currentScope, fullName] }
      }
    })
  }

  const handleSelectToastEmployee = (guid: string) => {
    setSelectedToastGuid(guid)
    const emp = toastEmployees.find(e => e.toast_guid === guid)
    if (emp) {
      setFormData(prev => ({
        ...prev,
        full_name: emp.full_name || prev.full_name,
        email: emp.email || prev.email,
        phone: emp.phone || prev.phone,
        role: emp.suggested_role || prev.role,
        store_id: emp.store_id ? String(emp.store_id) : prev.store_id
      }))
    }
  }

  // Detect active store manager conflict (Only managers are 1-per-store; stores can have multiple assistants like AM/PM)
  const conflictingUser = (formData.role === 'manager' && formData.store_id)
    ? existingUsers.find(u =>
      u.is_active &&
      u.role === 'manager' &&
      String(u.store_id) === String(formData.store_id) &&
      u.id !== initialData?.id &&
      u.email?.trim().toLowerCase() !== formData.email.trim().toLowerCase()
    )
    : null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    // Validaciones básicas
    if (!formData.email || !formData.full_name) {
      alert(t('usuarios.modal.errors.name_email_required'))
      return
    }

    if (!formData.phone) {
      alert(t('usuarios.modal.errors.phone_required'))
      return
    }

    // Role-specific validation
    if (['manager', 'asistente'].includes(formData.role)) {
      if (!formData.store_id) {
        alert(t('usuarios.modal.errors.store_required') || 'Assigned store is required')
        return
      }
      if (!formData.position_type) {
        alert(t('usuarios.modal.errors.position_required'))
        return
      }
    }

    if (formData.role === 'supervisor') {
      if (!formData.store_scope || formData.store_scope.length === 0) {
        alert(t('usuarios.modal.errors.store_scope_required'))
        return
      }
    }

    // Validación Password
    if (!initialData) {
      // Nuevo usuario: Password obligatorio
      if (!formData.password) {
        setPassError(t('usuarios.modal.errors.password_required'))
        return
      }
    }

    if (formData.password || formData.confirmPassword) {
      if (formData.password !== formData.confirmPassword) {
        setPassError(t('usuarios.modal.errors.pass_mismatch'))
        return
      }
      if (formData.password.length < 6) {
        setPassError(t('usuarios.modal.errors.pass_length'))
        return
      }
    }

    // Limpiar campos auxiliares antes de enviar
    const { confirmPassword, ...dataToSend } = formData
    onSave({
      ...dataToSend,
      id: initialData?.id,
      toast_guid: selectedToastGuid || undefined,
      deactivateCurrentId: (deactivateConflict && conflictingUser) ? conflictingUser.id : null
    }, !!initialData)
  }

  // UI Helpers
  const isSupervisor = formData.role === 'supervisor'
  const isAdmin = formData.role === 'admin'
  const isStaff = ['manager', 'asistente'].includes(formData.role)

  // Calcular fuerza password visualmente
  const passStrength = formData.password.length === 0 ? 0 : formData.password.length < 6 ? 1 : formData.password.length < 10 ? 2 : 3
  const strengthColors = ['bg-gray-200', 'bg-red-400', 'bg-yellow-400', 'bg-green-500']

  return createPortal(
    <div className="fixed top-0 bottom-[calc(60px+env(safe-area-inset-bottom))] md:bottom-0 md:inset-0 left-0 right-0 z-40 flex items-center justify-center p-0 md:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white dark:bg-slate-900 w-full h-full md:h-auto md:max-h-[90vh] md:max-w-4xl rounded-none md:rounded-3xl shadow-2xl overflow-hidden transform transition-all scale-100 flex flex-col md:flex-row border-none md:border md:border-gray-100 dark:md:border-slate-800">

        {/* SIDEBAR VISUAL (Desktop only) */}
        <div className="hidden md:flex w-1/3 bg-slate-900 dark:bg-black p-8 flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-slate-800 dark:bg-slate-900 rounded-full blur-3xl -mr-32 -mt-32 opacity-50"></div>
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-indigo-900 dark:bg-indigo-950 rounded-full blur-3xl -ml-32 -mb-32 opacity-50"></div>

          <div className="relative z-10">
            <h2 className="text-3xl font-black text-white tracking-tight leading-none mb-2">
              {initialData ? t('usuarios.modal.edit_title').split(' ')[0] : t('usuarios.modal.create_title').split(' ')[0]} <br />
              <span className="text-indigo-400">{t('usuarios.table.user') || 'Usuario'}</span>
            </h2>
            <p className="text-slate-400 text-sm">
              {t('usuarios.modal.subtitle')}
            </p>
          </div>

          <div className="relative z-10 space-y-6">
            <div className="flex items-start gap-4 text-slate-300">
              <div className="p-2 bg-slate-800 rounded-lg shrink-0"><Shield size={20} className="text-indigo-400" /></div>
              <div>
                <h4 className="font-bold text-white text-sm">{t('usuarios.modal.sidebar.security_title')}</h4>
                <p className="text-xs text-slate-400 mt-1">{t('usuarios.modal.sidebar.security_description')}</p>
              </div>
            </div>

            <div className="flex items-start gap-4 text-slate-300">
              <div className="p-2 bg-slate-800 rounded-lg shrink-0"><Store size={20} className="text-emerald-400" /></div>
              <div>
                <h4 className="font-bold text-white text-sm">{t('usuarios.modal.sidebar.assignment_title')}</h4>
                <p className="text-xs text-slate-400 mt-1">{t('usuarios.modal.sidebar.assignment_description')}</p>
              </div>
            </div>
          </div>

          <div className="relative z-10 text-xs text-slate-500 font-mono">
            Tacos Gavilán System v2.0
          </div>
        </div>

        {/* FORMULARIO PRINCIPAL */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Mobile Header */}
          <div className="md:hidden p-4 bg-slate-900 dark:bg-black text-white flex justify-between items-center transition-colors shrink-0">
            <h2 className="font-bold text-base">{initialData ? t('usuarios.modal.edit_title') : t('usuarios.modal.create_title')}</h2>
            <button onClick={onClose} className="p-1 hover:bg-slate-800 rounded-lg"><X size={20} /></button>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto p-5 md:p-8 space-y-6 md:space-y-8">

            <form id="userForm" onSubmit={handleSubmit} className="space-y-6 md:space-y-8">

              {/* SECCIÓN 1: DATOS PERSONALES */}
              <section className="space-y-3 md:space-y-4">
                <div className="flex items-center gap-2 mb-3 md:mb-4">
                  <span className="w-6 h-6 md:w-8 md:h-8 rounded-full bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-black text-xs">1</span>
                  <h3 className="font-black text-gray-900 dark:text-white text-base md:text-lg tracking-tight">{t('usuarios.modal.sections.personal')}</h3>
                </div>

                {!initialData && toastEmployees && toastEmployees.length > 0 && (
                  <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 space-y-1.5 mb-2">
                    <label className="block text-[10px] font-black text-amber-800 dark:text-amber-300 uppercase tracking-widest">
                      ⚡ ¿El usuario ya existe en Toast (Planificador)?
                    </label>
                    <select
                      value={selectedToastGuid}
                      onChange={(e) => handleSelectToastEmployee(e.target.value)}
                      className="w-full py-2 px-3 bg-white dark:bg-slate-800 border border-amber-500/30 rounded-xl text-xs font-bold text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-500/20"
                    >
                      <option value="">-- Seleccionar Empleado de Toast (Autocompletar) --</option>
                      {toastEmployees.map((emp) => (
                        <option key={emp.toast_guid} value={emp.toast_guid}>
                          {emp.full_name} {emp.email ? `(${emp.email})` : ''} {emp.suggested_role ? `• ${emp.suggested_role}` : ''} {emp.store_name ? `• ${emp.store_name}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {conflictingUser && (
                  <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs space-y-2 mb-2">
                    <div className="flex items-center gap-2 font-bold">
                      <AlertCircle size={16} className="text-amber-500 shrink-0" />
                      <span>⚠️ Conflicto: Esta sucursal ya tiene un {formData.role === 'manager' ? 'Manager' : 'Asistente'} activo</span>
                    </div>
                    <p className="text-[11px] text-amber-700 dark:text-amber-400 pl-6">
                      Usuario actual: <strong>{conflictingUser.full_name}</strong> ({conflictingUser.email})
                    </p>
                    <label className="flex items-center gap-2 pl-6 pt-1 font-bold text-amber-900 dark:text-amber-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={deactivateConflict}
                        onChange={(e) => setDeactivateConflict(e.target.checked)}
                        className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500 accent-amber-600"
                      />
                      Desactivar a {conflictingUser.full_name} automáticamente al guardar
                    </label>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-5">
                  <div className="group">
                    <label className="block text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest mb-1.5 md:mb-2 ml-1 group-focus-within:text-indigo-600 transition-colors">{t('usuarios.modal.fields.full_name')}</label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500 group-focus-within:text-indigo-500 transition-colors" size={16} />
                      <input
                        name="full_name"
                        value={formData.full_name}
                        onChange={handleChange}
                        required
                        className="w-full pl-9 md:pl-10 pr-3 md:pr-4 py-2.5 md:py-3.5 text-sm md:text-base bg-gray-50 dark:bg-slate-800/50 border border-gray-100 dark:border-slate-800 focus:bg-white dark:focus:bg-slate-800 focus:border-indigo-500 dark:focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 dark:focus:ring-indigo-950/40 rounded-xl md:rounded-2xl outline-none transition-all font-bold text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-600"
                        placeholder={t('usuarios.modal.placeholders.name')}
                      />
                    </div>
                  </div>

                  <div className="group">
                    <label className="block text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest mb-2 ml-1 group-focus-within:text-indigo-600 transition-colors">{t('usuarios.modal.fields.email')}</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500 group-focus-within:text-indigo-500 transition-colors" size={18} />
                      <input
                        name="email"
                        type="email"
                        value={formData.email}
                        onChange={handleChange}
                        required
                        disabled={!!initialData}
                        className={`w-full pl-10 pr-4 py-3.5 bg-gray-50 dark:bg-slate-800/50 border border-gray-100 dark:border-slate-800 focus:bg-white dark:focus:bg-slate-800 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-2xl outline-none transition-all font-bold text-gray-900 dark:text-white ${initialData ? 'opacity-50 cursor-not-allowed dark:bg-slate-900/50' : ''}`}
                        placeholder={t('usuarios.modal.placeholders.email')}
                      />
                    </div>
                  </div>

                  <div className="group">
                    <label className="block text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest mb-2 ml-1 group-focus-within:text-indigo-600 transition-colors">{t('usuarios.modal.fields.phone')}</label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500 group-focus-within:text-indigo-500 transition-colors" size={18} />
                      <input
                        name="phone"
                        type="tel"
                        value={formData.phone}
                        onChange={handleChange}
                        required
                        className="w-full pl-10 pr-4 py-3.5 bg-gray-50 dark:bg-slate-800/50 border border-gray-100 dark:border-slate-800 focus:bg-white dark:focus:bg-slate-800 focus:border-indigo-500 rounded-2xl outline-none transition-all font-bold text-gray-900 dark:text-white"
                        placeholder={t('usuarios.modal.placeholders.phone')}
                      />
                    </div>
                  </div>

                  {/* Estado Activo Toggle */}
                  <div className="flex items-center justify-between bg-gray-50/50 dark:bg-slate-800/50 border border-gray-100 dark:border-slate-800 p-3 px-4 rounded-2xl transition-colors">
                    <span className="text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest">{t('usuarios.modal.fields.is_active')}</span>
                    <button
                      type="button"
                      onClick={handleToggleActive}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-all focus:outline-none cursor-pointer hover:scale-105 active:scale-95 ${formData.is_active ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-slate-700'}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform ${formData.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>
                </div>
              </section>

              {/* SECCIÓN 2: SEGURIDAD */}
              <section className="space-y-4 pt-4 border-t border-gray-100 dark:border-slate-800">
                <div className="flex items-center gap-2 mb-4">
                  <span className="w-8 h-8 rounded-full bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-black text-xs">2</span>
                  <h3 className="font-black text-gray-900 dark:text-white text-lg tracking-tight">{t('usuarios.modal.sections.security')}</h3>
                </div>

                <div className="p-5 bg-gray-50/50 dark:bg-slate-800/30 rounded-2xl border border-gray-100 dark:border-slate-800 space-y-5 transition-colors">
                  {/* Password Row */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="group relative">
                      <label className="block text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest mb-2 ml-1">
                        {t('usuarios.modal.fields.password')}
                      </label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500" size={18} />
                        <input
                          name="password"
                          type={showPassword ? "text" : "password"}
                          value={formData.password}
                          onChange={handleChange}
                          required={!initialData}
                          className="w-full pl-10 pr-10 py-3.5 bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 focus:border-indigo-500 rounded-2xl outline-none transition-all font-bold text-gray-900 dark:text-white"
                          placeholder={initialData ? t('usuarios.modal.placeholders.keep_password') : t('usuarios.modal.placeholders.password')}
                        />
                        <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-indigo-500 transition-colors">
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
                      <label className="block text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest mb-2 ml-1">{t('usuarios.modal.fields.confirm_password')}</label>
                      <div className="relative">
                        <CheckCircle2 className={`absolute left-3 top-1/2 -translate-y-1/2 transition-colors ${formData.confirmPassword && !passError ? 'text-emerald-500' : 'text-gray-400 dark:text-slate-500'}`} size={18} />
                        <input
                          name="confirmPassword"
                          type="password"
                          value={formData.confirmPassword}
                          onChange={handleChange}
                          disabled={!formData.password}
                          className={`w-full pl-10 pr-4 py-3.5 bg-white dark:bg-slate-800 border focus:ring-4 focus:ring-indigo-500/10 rounded-2xl outline-none transition-all font-bold text-gray-900 dark:text-white 
                              ${passError ? 'border-red-300 dark:border-red-900/50 focus:border-red-500 dark:bg-red-900/10' : 'border-gray-100 dark:border-slate-700 focus:border-indigo-500'}`}
                          placeholder={t('usuarios.modal.placeholders.confirm_password')}
                        />
                      </div>
                      {passError && (
                        <div className="flex items-center gap-1 mt-1.5 ml-1 text-red-500 text-[10px] font-black uppercase tracking-widest animate-pulse">
                          <AlertCircle size={12} /> {passError}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </section>

              {/* SECCIÓN 3: ROLES */}
              <section className="space-y-4 pt-4 border-t border-gray-100 dark:border-slate-800">
                <div className="flex items-center gap-2 mb-4">
                  <span className="w-8 h-8 rounded-full bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-black text-xs">3</span>
                  <h3 className="font-black text-gray-900 dark:text-white text-lg tracking-tight">{t('usuarios.modal.sections.roles_permissions')}</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Selector de Rol */}
                  <div>
                    <label className="block text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest mb-3 ml-1">{t('usuarios.modal.fields.user_role')}</label>
                    <div className="grid grid-cols-1 gap-2">
                      {['asistente', 'manager', 'supervisor', 'admin'].map((roleOp) => (
                        <label key={roleOp} className={`flex items-center gap-3 p-3.5 rounded-2xl border cursor-pointer transition-all ${formData.role === roleOp ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-500 ring-1 ring-indigo-500' : 'bg-white dark:bg-slate-800/50 border-gray-100 dark:border-slate-800 hover:border-gray-200 dark:hover:border-slate-700'}`}>
                          <input
                            type="radio"
                            name="role"
                            value={roleOp}
                            checked={formData.role === roleOp}
                            onChange={handleChange}
                            className="w-4 h-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 dark:border-slate-600 dark:bg-slate-900"
                          />
                          <div>
                            <span className="block text-sm font-black text-gray-900 dark:text-white capitalize tracking-tight">{t(`usuarios.modal.roles.${roleOp}`)}</span>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Selector de Tiendas Dinámico */}
                  <div className="bg-gray-50/50 dark:bg-slate-800/30 p-5 rounded-2xl border border-gray-100 dark:border-slate-800/50 h-fit transition-colors">

                    {isAdmin && (
                      <div className="text-center py-10">
                        <div className="w-16 h-16 bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 flex items-center justify-center mx-auto mb-4">
                          <span className="text-3xl">🌍</span>
                        </div>
                        <h4 className="font-black text-slate-800 dark:text-white uppercase tracking-tight">{t('usuarios.modal.admin_scope.title')}</h4>
                        <p className="text-[11px] text-slate-500 dark:text-slate-500 px-4 mt-2 font-bold leading-relaxed">{t('usuarios.modal.admin_scope.description')}</p>
                      </div>
                    )}

                    {isStaff && (
                      <div className="space-y-4">
                        <div className="space-y-3">
                          <label className="block text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest ml-1">{t('usuarios.modal.fields.assigned_store')}</label>
                          <select
                            name="store_id"
                            value={formData.store_id}
                            onChange={handleChange}
                            required={isStaff}
                            className="w-full px-4 py-3.5 rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-black text-gray-900 dark:text-white focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all"
                          >
                            <option value="" className="dark:bg-slate-900">-- {t('usuarios.modal.placeholders.select_store')} --</option>
                            {stores.map(s => (
                              <option key={s.id} value={s.id} className="dark:bg-slate-900">{s.name}</option>
                            ))}
                          </select>
                          <p className="text-[10px] text-slate-400 dark:text-slate-600 leading-tight font-bold italic">{t('usuarios.modal.staff_scope.description')}</p>
                        </div>

                        <div className="space-y-3">
                          <label className="block text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest ml-1">{t('usuarios.modal.fields.position_type')}</label>
                          <select
                            name="position_type"
                            value={formData.position_type}
                            onChange={handleChange}
                            required={isStaff}
                            className="w-full px-4 py-3.5 rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-black text-gray-900 dark:text-white focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all"
                          >
                            <option value="" className="dark:bg-slate-900">-- {t('usuarios.modal.placeholders.select_position')} --</option>
                            <option value="kitchen" className="dark:bg-slate-900">{t('usuarios.modal.positions.kitchen')}</option>
                            <option value="cashier" className="dark:bg-slate-900">{t('usuarios.modal.positions.cashier')}</option>
                          </select>
                        </div>
                      </div>
                    )}

                    {isSupervisor && (
                      <div className="space-y-3 h-full flex flex-col">
                        <label className="block text-[10px] font-black text-purple-600/70 dark:text-purple-400/70 uppercase tracking-widest ml-1">{t('usuarios.modal.fields.supervision_scope')}</label>
                        <div className="flex-1 bg-white dark:bg-slate-800/50 border border-gray-100 dark:border-slate-700 rounded-2xl p-2 max-h-[200px] overflow-y-auto space-y-1 transition-colors">
                          {stores.map(store => (
                            <label key={store.id} className="flex items-center gap-3 p-2.5 hover:bg-purple-50 dark:hover:bg-purple-900/30 rounded-xl cursor-pointer transition-colors group">
                              <input
                                type="checkbox"
                                checked={isStoreInScope(store.name)}
                                onChange={() => handleScopeChange(store.name)}
                                className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500 dark:bg-slate-900 dark:border-slate-700"
                              />
                              <span className="text-xs font-black text-gray-700 dark:text-slate-300 group-hover:text-purple-700 dark:group-hover:text-purple-400 uppercase tracking-tight truncate">{store.name}</span>
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
          <div className="p-4 md:p-6 border-t border-gray-100 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md flex justify-end gap-3 z-10 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-slate-500 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
            >
              {t('usuarios.modal.buttons.cancel')}
            </button>
            <button
              type="submit"
              form="userForm"
              className="px-8 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest text-white dark:text-slate-900 bg-slate-900 dark:bg-white hover:bg-black dark:hover:bg-slate-100 shadow-xl shadow-gray-200 dark:shadow-none hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={!!passError}
            >
              {initialData ? t('usuarios.modal.buttons.save') : t('usuarios.modal.buttons.create')}
            </button>
          </div>

        </div>
      </div>
    </div>,
    document.body
  )
}