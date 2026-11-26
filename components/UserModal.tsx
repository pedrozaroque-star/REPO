/**
 * @module UserModal
 * @description Modal administrativo para crear, editar, transferir de sucursal y activar/desactivar usuarios del sistema Tacos Gavilan.
 * @businessRules
 * - Roles operativos de sucursal única (`manager`, `asistente`, `general_manager`, `gerente`, `assistant`, `shift_leader`) requieren una `store_id` asignada y un `position_type` (con default automático `'kitchen'` cuando viene vacío en registros heredados o de Toast).
 * - Supervisores requieren al menos una tienda en `store_scope` (conservando el prefijo `"Tacos Gavilan "` para compatibilidad en DB).
 * - Roles globales o de módulo único (`admin`, `planificador`, `basecamp`, `accounting`, `contador`, `auditor`) operan sin `store_id` fijo.
 * - El teléfono (`phone`) es opcional para no bloquear transferencias de sucursal ni bajas de usuarios heredados sin teléfono registrado.
 * - En modo edición (`initialData`), la edición de contraseña permanece colapsada tras un botón explícito (`isEditingPassword = false`) con `autoComplete="new-password"` para impedir que el gestor de contraseñas de Chrome/Edge en PC de escritorio inyecte credenciales guardadas y bloquee el guardado.
 * - Al seleccionar una sucursal para un rol operativo, muestra en vivo el padrón activo de esa tienda (Manager actual y Asistentes AM/PM actuales) permitiendo reemplazo selectivo opcional (`deactivateUserIds`).
 * @dataFlow
 * - Props (`initialData`, `stores`, `toastEmployees`, `existingUsers`, `isSaving`) -> Estado validado con `noValidate` y banner visible -> `onSave(payload, isEdit)`.
 * @notes
 * - Fixed 2026-11-23: Eliminado bloqueo silencioso de validación HTML5 en contenedores con `overflow-y-auto`, bloqueado autofill de contraseña en Desktop PC, habilitada edición de email y vinculación `toast_guid` en alta/edición, y añadido soporte multi-asistente AM/PM sin desactivación forzada.
 */

'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  User,
  Mail,
  Lock,
  Phone,
  Shield,
  Store,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  KeyRound,
  RefreshCw,
  Users,
  Link2
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { formatStoreName } from '@/lib/supabase'
import { sortStoresAlphabetically } from '@/lib/store-display'

interface UserModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (data: any, isEdit: boolean) => Promise<void> | void
  stores: any[]
  initialData?: any
  toastEmployees?: any[]
  existingUsers?: any[]
  isSaving?: boolean
}

const SINGLE_STORE_STAFF_ROLES = new Set([
  'manager',
  'asistente',
  'general_manager',
  'gerente',
  'assistant',
  'shift_leader'
])

const MANAGER_ROLES = new Set(['manager', 'general_manager', 'gerente'])
const ASSISTANT_ROLES = new Set(['asistente', 'assistant', 'shift_leader'])

const CORE_ROLE_OPTIONS = ['asistente', 'manager', 'supervisor', 'admin', 'planificador', 'basecamp']

function normalizePositionType(raw?: string | null): string {
  const norm = String(raw || '').trim().toLowerCase()
  if (!norm) return 'kitchen'
  if (norm === 'kitchen' || norm === 'cocina') return 'kitchen'
  if (norm === 'cashier' || norm === 'cajero') return 'cashier'
  if (norm === 'both' || norm === 'ambos') return 'both'
  if (norm === 'general') return 'general'
  return 'kitchen'
}

export default function UserModal({
  isOpen,
  onClose,
  onSave,
  stores,
  initialData,
  toastEmployees = [],
  existingUsers = [],
  isSaving = false
}: UserModalProps) {
  const { t, language } = useLanguage()
  const [mounted, setMounted] = useState(false)
  const [selectedToastGuid, setSelectedToastGuid] = useState('')
  const [deactivateUserIds, setDeactivateUserIds] = useState<number[]>([])
  const [isEditingPassword, setIsEditingPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const tr = (key: string, esFallback: string, enFallback: string) => {
    const val = t(key)
    if (!val || val === key) {
      return language === 'en' ? enFallback : esFallback
    }
    return val
  }

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

  // Cargar y limpiar estado cada vez que cambia initialData o isOpen
  useEffect(() => {
    if (!isOpen) return

    setPassError('')
    setFormError('')
    setShowPassword(false)
    setSubmitting(false)
    setDeactivateUserIds([])

    if (initialData) {
      const initRole = String(initialData.role || 'asistente').trim().toLowerCase()
      const linkedGuid = initialData.toast_guid ? String(initialData.toast_guid) : ''
      const matchedToastEmp = linkedGuid
        ? toastEmployees.find((e) => e.toast_guid === linkedGuid)
        : null
      const resolvedPhone = initialData.phone || matchedToastEmp?.phone || ''

      setSelectedToastGuid(linkedGuid)
      setIsEditingPassword(false)
      setFormData({
        full_name: initialData.full_name || '',
        email: initialData.email || '',
        password: '',
        confirmPassword: '',
        phone: resolvedPhone,
        role: initRole,
        store_id: initialData.store_id !== null && initialData.store_id !== undefined ? String(initialData.store_id) : '',
        store_scope: Array.isArray(initialData.store_scope) ? initialData.store_scope : [],
        position_type: normalizePositionType(initialData.position_type),
        is_active: initialData.is_active ?? true
      })
    } else {
      setSelectedToastGuid('')
      setIsEditingPassword(true)
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
  }, [initialData, isOpen])

  const roleNorm = String(formData.role || '').trim().toLowerCase()
  const isSupervisor = roleNorm === 'supervisor'
  const isAdmin = roleNorm === 'admin' || roleNorm === 'administrador'
  const isPlanificador = roleNorm === 'planificador'
  const isBasecamp = roleNorm === 'basecamp'
  const isStaff = SINGLE_STORE_STAFF_ROLES.has(roleNorm)
  const isManagerRole = MANAGER_ROLES.has(roleNorm)
  const isAssistantRole = ASSISTANT_ROLES.has(roleNorm)

  // Personal activo actualmente asignado a la tienda seleccionada (excluyendo al propio usuario editado)
  const activeStoreStaff = (isStaff && formData.store_id)
    ? existingUsers.filter(
        (u) =>
          u.is_active &&
          String(u.store_id) === String(formData.store_id) &&
          Number(u.id) !== Number(initialData?.id) &&
          String(u.email || '').trim().toLowerCase() !== String(formData.email || '').trim().toLowerCase()
      )
    : []

  const activeStoreManagers = activeStoreStaff.filter((u) =>
    MANAGER_ROLES.has(String(u.role || '').trim().toLowerCase())
  )
  const activeStoreAssistants = activeStoreStaff.filter((u) =>
    ASSISTANT_ROLES.has(String(u.role || '').trim().toLowerCase())
  )

  // Al cambiar de tienda o de rol:
  // - En modo Creación de un Manager nuevo, pre-seleccionar al manager saliente por comodidad.
  // - En modo Edición (o cuando es Asistente AM/PM), dejar desmarcado por defecto para nunca desactivar por accidente a otro compañero de turno.
  useEffect(() => {
    if (!isOpen) return
    if (!isStaff || !formData.store_id) {
      setDeactivateUserIds([])
      return
    }
    if (!initialData && isManagerRole && activeStoreManagers.length > 0) {
      setDeactivateUserIds(activeStoreManagers.map((m) => Number(m.id)).filter(Number.isFinite))
    } else {
      setDeactivateUserIds([])
    }
  }, [formData.store_id, formData.role, isOpen, initialData])

  if (!isOpen || !mounted) return null

  const scrollToTopError = (msg: string) => {
    setFormError(msg)
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormError('')

    setFormData((prev) => {
      const next = { ...prev, [name]: value }
      if (name === 'role' && SINGLE_STORE_STAFF_ROLES.has(value.trim().toLowerCase()) && !next.position_type) {
        next.position_type = 'kitchen'
      }
      return next
    })

    // Validación en tiempo real de contraseña solo cuando la sección de password está activa
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
    setFormError('')
    setFormData((prev) => ({ ...prev, is_active: !prev.is_active }))
  }

  const handleToggleEditPassword = () => {
    setFormError('')
    setPassError('')
    setShowPassword(false)
    setIsEditingPassword((prev) => {
      const next = !prev
      if (!next) {
        setFormData((f) => ({ ...f, password: '', confirmPassword: '' }))
      }
      return next
    })
  }

  const toggleDeactivateCandidate = (candidateId: number) => {
    const numId = Number(candidateId)
    if (!Number.isFinite(numId)) return
    setDeactivateUserIds((prev) =>
      prev.includes(numId) ? prev.filter((id) => id !== numId) : [...prev, numId]
    )
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
    setFormError('')
    setFormData((prev) => {
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
        const fullName = storeName.toLowerCase().startsWith('tacos gavilan')
          ? storeName
          : `Tacos Gavilan ${storeName}`
        return { ...prev, store_scope: [...currentScope, fullName] }
      }
    })
  }

  const handleSelectToastEmployee = (guid: string) => {
    setFormError('')
    setSelectedToastGuid(guid)
    if (!guid) return

    const emp = toastEmployees.find((e) => e.toast_guid === guid)
    if (!emp) return

    setFormData((prev) => {
      if (!initialData) {
        return {
          ...prev,
          full_name: emp.full_name || prev.full_name,
          email: emp.email || prev.email,
          phone: emp.phone || prev.phone,
          role: emp.suggested_role || prev.role,
          store_id: emp.store_id ? String(emp.store_id) : prev.store_id,
          position_type: prev.position_type || 'kitchen'
        }
      }
      // En modo edición: vincular GUID y rellenar campos vacíos sin sobrescribir cambios manuales del admin
      return {
        ...prev,
        full_name: prev.full_name || emp.full_name || '',
        email: prev.email || emp.email || '',
        phone: prev.phone || emp.phone || '',
        store_id: prev.store_id || (emp.store_id ? String(emp.store_id) : '')
      }
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')

    const cleanName = String(formData.full_name || '').trim()
    const cleanEmail = String(formData.email || '').trim().toLowerCase()

    if (!cleanName || !cleanEmail) {
      scrollToTopError(t('usuarios.modal.errors.name_email_required'))
      return
    }

    // Validaciones de tienda solo cuando el usuario está activo (permitir dar de baja perfiles incompletos)
    if (formData.is_active) {
      if (isStaff) {
        if (!formData.store_id) {
          scrollToTopError(
            tr(
              'usuarios.modal.errors.store_required',
              'La tienda asignada es obligatoria para gerentes y asistentes',
              'Assigned store is required for managers and assistants'
            )
          )
          return
        }
      }

      if (isSupervisor) {
        if (!formData.store_scope || formData.store_scope.length === 0) {
          scrollToTopError(t('usuarios.modal.errors.store_scope_required'))
          return
        }
      }
    }

    // Validación de Contraseña (solo en Creación o cuando el admin activó "Cambiar contraseña")
    const shouldValidatePassword = !initialData || isEditingPassword
    if (!initialData && !formData.password) {
      setPassError(t('usuarios.modal.errors.password_required'))
      scrollToTopError(t('usuarios.modal.errors.password_required'))
      return
    }

    if (shouldValidatePassword && (formData.password || formData.confirmPassword)) {
      if (formData.password !== formData.confirmPassword) {
        const msg = t('usuarios.modal.errors.pass_mismatch')
        setPassError(msg)
        scrollToTopError(msg)
        return
      }
      if (formData.password.trim().length < 6) {
        const msg = t('usuarios.modal.errors.pass_length')
        setPassError(msg)
        scrollToTopError(msg)
        return
      }
    }

    const { confirmPassword, ...dataToSend } = formData
    const clearsStoreAssignment = !isStaff
    const finalPassword = shouldValidatePassword ? dataToSend.password : ''

    try {
      setSubmitting(true)
      await Promise.resolve(
        onSave(
          {
            ...dataToSend,
            full_name: cleanName,
            email: cleanEmail,
            password: finalPassword,
            store_id: clearsStoreAssignment ? '' : dataToSend.store_id,
            store_scope: isSupervisor ? dataToSend.store_scope : [],
            position_type: isStaff ? normalizePositionType(dataToSend.position_type) : null,
            id: initialData?.id,
            toast_guid: selectedToastGuid || null,
            deactivateUserIds,
            deactivateCurrentId: deactivateUserIds.length > 0 ? deactivateUserIds[0] : null
          },
          !!initialData
        )
      )
    } finally {
      setSubmitting(false)
    }
  }

  // Opciones de rol: incluir rol actual si es un rol extendido de DB (ej. general_manager, shift_leader, accounting)
  const roleOptions = CORE_ROLE_OPTIONS.includes(roleNorm)
    ? CORE_ROLE_OPTIONS
    : [...CORE_ROLE_OPTIONS, roleNorm]

  const getRoleOptionLabel = (r: string) => {
    const key = `usuarios.modal.roles.${r}`
    const translated = t(key)
    if (translated && translated !== key) return translated
    const fallbackKey = `usuarios.roles.${r}`
    const fallbackTranslated = t(fallbackKey)
    if (fallbackTranslated && fallbackTranslated !== fallbackKey) return fallbackTranslated
    return r.replace(/_/g, ' ')
  }

  const getPositionLabel = (pos?: string | null) => {
    const norm = normalizePositionType(pos)
    return tr(
      `usuarios.modal.positions.${norm}`,
      norm === 'cashier' ? 'Cajero' : norm === 'both' ? 'Ambos (Cocina y Caja)' : norm === 'general' ? 'General' : 'Cocina',
      norm === 'cashier' ? 'Cashier' : norm === 'both' ? 'Both (Kitchen & Cashier)' : norm === 'general' ? 'General' : 'Kitchen'
    )
  }

  const busy = isSaving || submitting
  const passStrength =
    formData.password.length === 0 ? 0 : formData.password.length < 6 ? 1 : formData.password.length < 10 ? 2 : 3
  const strengthColors = ['bg-gray-200', 'bg-red-400', 'bg-yellow-400', 'bg-green-500']

  return createPortal(
    <div className="fixed top-0 bottom-[calc(60px+env(safe-area-inset-bottom))] md:bottom-0 md:inset-0 left-0 right-0 z-40 flex items-center justify-center p-0 md:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white dark:bg-slate-900 w-full h-full md:h-auto md:max-h-[92vh] md:max-w-4xl rounded-none md:rounded-3xl shadow-2xl overflow-hidden transform transition-all scale-100 flex flex-col md:flex-row border-none md:border md:border-gray-100 dark:md:border-slate-800">

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
            {initialData && (
              <div className="mt-4 p-3 rounded-2xl bg-slate-800/80 border border-slate-700/70 space-y-1">
                <p className="text-xs font-black text-white truncate">{initialData.full_name}</p>
                <p className="text-[11px] text-slate-400 truncate">{initialData.email}</p>
              </div>
            )}
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
            Tacos Gavilan
          </div>
        </div>

        {/* FORMULARIO PRINCIPAL */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Mobile & Desktop Close Header */}
          <div className="md:hidden p-4 bg-slate-900 dark:bg-black text-white flex justify-between items-center transition-colors shrink-0">
            <h2 className="font-bold text-base">{initialData ? t('usuarios.modal.edit_title') : t('usuarios.modal.create_title')}</h2>
            <button type="button" onClick={onClose} className="p-1 hover:bg-slate-800 rounded-lg"><X size={20} /></button>
          </div>

          {/* Scrollable Content */}
          <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-5 md:p-8 space-y-6 md:space-y-8">

            {formError && (
              <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs font-bold flex items-center justify-between gap-3 animate-in fade-in duration-200">
                <div className="flex items-center gap-2.5">
                  <AlertCircle size={18} className="text-red-500 shrink-0" />
                  <span>{formError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setFormError('')}
                  className="p-1 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 text-red-500"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            <form id="userForm" noValidate autoComplete="off" onSubmit={handleSubmit} className="space-y-6 md:space-y-8">

              {/* SECCIÓN 1: DATOS PERSONALES */}
              <section className="space-y-3 md:space-y-4">
                <div className="flex items-center justify-between gap-2 mb-3 md:mb-4">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 md:w-8 md:h-8 rounded-full bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-black text-xs">1</span>
                    <h3 className="font-black text-gray-900 dark:text-white text-base md:text-lg tracking-tight">{t('usuarios.modal.sections.personal')}</h3>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="hidden md:flex p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
                    title={t('usuarios.modal.buttons.cancel')}
                  >
                    <X size={18} />
                  </button>
                </div>

                {toastEmployees && toastEmployees.length > 0 && (
                  <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 space-y-1.5 mb-2">
                    <label className="flex items-center gap-1.5 text-[10px] font-black text-amber-800 dark:text-amber-300 uppercase tracking-widest">
                      <Link2 size={13} />
                      {tr(
                        'usuarios.modal.toast_link_label',
                        '⚡ Vincular con Empleado de Toast (Planificador / Autocompletar)',
                        '⚡ Link with Toast Employee (Scheduler / Autocomplete)'
                      )}
                    </label>
                    <select
                      value={selectedToastGuid}
                      onChange={(e) => handleSelectToastEmployee(e.target.value)}
                      className="w-full py-2 px-3 bg-white dark:bg-slate-800 border border-amber-500/30 rounded-xl text-xs font-bold text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-500/20"
                    >
                      <option value="">
                        {tr(
                          'usuarios.modal.toast_link_placeholder',
                          '-- Sin vincular / Seleccionar Empleado de Toast --',
                          '-- Unlinked / Select Toast Employee --'
                        )}
                      </option>
                      {toastEmployees.map((emp) => (
                        <option key={emp.toast_guid} value={emp.toast_guid}>
                          {emp.full_name} {emp.email ? `(${emp.email})` : ''} {emp.suggested_role ? `• ${emp.suggested_role}` : ''} {emp.store_name ? `• ${formatStoreName(emp.store_name)}` : ''}
                        </option>
                      ))}
                    </select>
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
                        autoComplete="off"
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
                        autoComplete="off"
                        className="w-full pl-10 pr-4 py-3.5 bg-gray-50 dark:bg-slate-800/50 border border-gray-100 dark:border-slate-800 focus:bg-white dark:focus:bg-slate-800 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-2xl outline-none transition-all font-bold text-gray-900 dark:text-white"
                        placeholder={t('usuarios.modal.placeholders.email')}
                      />
                    </div>
                  </div>

                  <div className="group">
                    <label className="block text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest mb-2 ml-1 group-focus-within:text-indigo-600 transition-colors">
                      {t('usuarios.modal.fields.phone')}{' '}
                      <span className="text-[9px] font-bold text-gray-400 dark:text-slate-600 lowercase">
                        ({tr('usuarios.modal.fields.optional', 'opcional', 'optional')})
                      </span>
                    </label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500 group-focus-within:text-indigo-500 transition-colors" size={18} />
                      <input
                        name="phone"
                        type="tel"
                        value={formData.phone}
                        onChange={handleChange}
                        autoComplete="off"
                        className="w-full pl-10 pr-4 py-3.5 bg-gray-50 dark:bg-slate-800/50 border border-gray-100 dark:border-slate-800 focus:bg-white dark:focus:bg-slate-800 focus:border-indigo-500 rounded-2xl outline-none transition-all font-bold text-gray-900 dark:text-white"
                        placeholder={t('usuarios.modal.placeholders.phone')}
                      />
                    </div>
                  </div>

                  {/* Estado Activo Toggle */}
                  <div className="flex items-center justify-between bg-gray-50/50 dark:bg-slate-800/50 border border-gray-100 dark:border-slate-800 p-3 px-4 rounded-2xl transition-colors">
                    <div>
                      <span className="block text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest">{t('usuarios.modal.fields.is_active')}</span>
                      <span className={`text-xs font-black ${formData.is_active ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}`}>
                        {formData.is_active ? t('usuarios.table.active') : t('usuarios.table.inactive')}
                      </span>
                    </div>
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
                <div className="flex items-center justify-between gap-2 mb-4">
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-8 rounded-full bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-black text-xs">2</span>
                    <h3 className="font-black text-gray-900 dark:text-white text-lg tracking-tight">{t('usuarios.modal.sections.security')}</h3>
                  </div>

                  {initialData && (
                    <button
                      type="button"
                      onClick={handleToggleEditPassword}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 border transition-all ${
                        isEditingPassword
                          ? 'bg-slate-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 border-gray-200 dark:border-slate-700'
                          : 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800/60 hover:bg-indigo-100'
                      }`}
                    >
                      <KeyRound size={14} />
                      {isEditingPassword
                        ? tr('usuarios.modal.keep_current_password_btn', 'Mantener contraseña actual', 'Keep current password')
                        : tr('usuarios.modal.change_password_btn', 'Cambiar contraseña', 'Change password')}
                    </button>
                  )}
                </div>

                {initialData && !isEditingPassword ? (
                  <div className="p-4 bg-gray-50/70 dark:bg-slate-800/30 rounded-2xl border border-gray-100 dark:border-slate-800 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                        <Lock size={16} />
                      </div>
                      <div>
                        <p className="text-xs font-black text-gray-800 dark:text-slate-200">
                          {tr('usuarios.modal.password_protected_title', 'Contraseña actual protegida', 'Current password protected')}
                        </p>
                        <p className="text-[11px] text-gray-500 dark:text-slate-400">
                          {tr(
                            'usuarios.modal.password_protected_desc',
                            'Puedes transferir de sucursal o cambiar el rol sin tocar la contraseña.',
                            'You can transfer stores or update roles without touching the password.'
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-5 bg-gray-50/50 dark:bg-slate-800/30 rounded-2xl border border-gray-100 dark:border-slate-800 space-y-5 transition-colors">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <div className="group relative">
                        <label className="block text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest mb-2 ml-1">
                          {t('usuarios.modal.fields.password')}
                        </label>
                        <div className="relative">
                          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500" size={18} />
                          <input
                            name="password"
                            type={showPassword ? 'text' : 'password'}
                            value={formData.password}
                            onChange={handleChange}
                            autoComplete="new-password"
                            className="w-full pl-10 pr-10 py-3.5 bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 focus:border-indigo-500 rounded-2xl outline-none transition-all font-bold text-gray-900 dark:text-white"
                            placeholder={initialData ? t('usuarios.modal.placeholders.keep_password') : t('usuarios.modal.placeholders.password')}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-indigo-500 transition-colors"
                          >
                            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                          </button>
                        </div>
                        {formData.password && (
                          <div className="flex gap-1 mt-1.5 px-1">
                            {[1, 2, 3].map((level) => (
                              <div
                                key={level}
                                className={`h-1.5 rounded-full flex-1 transition-all duration-300 ${
                                  passStrength >= level ? strengthColors[passStrength] : 'bg-gray-100'
                                }`}
                              />
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="group">
                        <label className="block text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest mb-2 ml-1">
                          {t('usuarios.modal.fields.confirm_password')}
                        </label>
                        <div className="relative">
                          <CheckCircle2
                            className={`absolute left-3 top-1/2 -translate-y-1/2 transition-colors ${
                              formData.confirmPassword && !passError ? 'text-emerald-500' : 'text-gray-400 dark:text-slate-500'
                            }`}
                            size={18}
                          />
                          <input
                            name="confirmPassword"
                            type={showPassword ? 'text' : 'password'}
                            value={formData.confirmPassword}
                            onChange={handleChange}
                            autoComplete="new-password"
                            className={`w-full pl-10 pr-4 py-3.5 bg-white dark:bg-slate-800 border focus:ring-4 focus:ring-indigo-500/10 rounded-2xl outline-none transition-all font-bold text-gray-900 dark:text-white ${
                              passError
                                ? 'border-red-300 dark:border-red-900/50 focus:border-red-500 dark:bg-red-900/10'
                                : 'border-gray-100 dark:border-slate-700 focus:border-indigo-500'
                            }`}
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
                )}
              </section>

              {/* SECCIÓN 3: ROLES Y SUCURSAL */}
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
                      {roleOptions.map((roleOp) => (
                        <label
                          key={roleOp}
                          className={`flex items-center gap-3 p-3.5 rounded-2xl border cursor-pointer transition-all ${
                            roleNorm === roleOp
                              ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-500 ring-1 ring-indigo-500'
                              : 'bg-white dark:bg-slate-800/50 border-gray-100 dark:border-slate-800 hover:border-gray-200 dark:hover:border-slate-700'
                          }`}
                        >
                          <input
                            type="radio"
                            name="role"
                            value={roleOp}
                            checked={roleNorm === roleOp}
                            onChange={handleChange}
                            className="w-4 h-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 dark:border-slate-600 dark:bg-slate-900"
                          />
                          <div>
                            <span className="block text-sm font-black text-gray-900 dark:text-white capitalize tracking-tight">
                              {getRoleOptionLabel(roleOp)}
                            </span>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Selector de Tiendas Dinámico */}
                  <div className="bg-gray-50/50 dark:bg-slate-800/30 p-5 rounded-2xl border border-gray-100 dark:border-slate-800/50 h-fit transition-colors space-y-4">

                    {isAdmin && (
                      <div className="text-center py-10">
                        <div className="w-16 h-16 bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 flex items-center justify-center mx-auto mb-4">
                          <span className="text-3xl">🌍</span>
                        </div>
                        <h4 className="font-black text-slate-800 dark:text-white uppercase tracking-tight">{t('usuarios.modal.admin_scope.title')}</h4>
                        <p className="text-[11px] text-slate-500 dark:text-slate-500 px-4 mt-2 font-bold leading-relaxed">{t('usuarios.modal.admin_scope.description')}</p>
                      </div>
                    )}

                    {isPlanificador && (
                      <div className="text-center py-10">
                        <div className="w-16 h-16 bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 flex items-center justify-center mx-auto mb-4">
                          <span className="text-3xl">📅</span>
                        </div>
                        <h4 className="font-black text-slate-800 dark:text-white uppercase tracking-tight">{t('usuarios.modal.planificador_scope.title')}</h4>
                        <p className="text-[11px] text-slate-500 dark:text-slate-500 px-4 mt-2 font-bold leading-relaxed">
                          {t('usuarios.modal.planificador_scope.description')}
                        </p>
                      </div>
                    )}

                    {isBasecamp && (
                      <div className="text-center py-10">
                        <div className="w-16 h-16 bg-sky-50 dark:bg-sky-900/30 rounded-2xl shadow-sm border border-sky-100 dark:border-sky-800/60 flex items-center justify-center mx-auto mb-4">
                          <span className="text-3xl">🏕️</span>
                        </div>
                        <h4 className="font-black text-slate-800 dark:text-white uppercase tracking-tight">{t('usuarios.modal.basecamp_scope.title')}</h4>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 px-4 mt-2 font-bold leading-relaxed">
                          {t('usuarios.modal.basecamp_scope.description')}
                        </p>
                      </div>
                    )}

                    {isStaff && (
                      <div className="space-y-4">
                        <div className="space-y-2.5">
                          <label className="block text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest ml-1">
                            {t('usuarios.modal.fields.assigned_store')}
                          </label>
                          <select
                            name="store_id"
                            value={formData.store_id}
                            onChange={handleChange}
                            className="w-full px-4 py-3.5 rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-black text-gray-900 dark:text-white focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all"
                          >
                            <option value="" className="dark:bg-slate-900">-- {t('usuarios.modal.placeholders.select_store')} --</option>
                            {sortStoresAlphabetically(stores, (s) => s.name).map((s) => (
                              <option key={s.id} value={String(s.id)} className="dark:bg-slate-900">
                                {formatStoreName(s.name)}
                              </option>
                            ))}
                          </select>
                          <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-tight font-bold italic">
                            {t('usuarios.modal.staff_scope.description')}
                          </p>
                        </div>

                        <div className="space-y-2.5">
                          <label className="block text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest ml-1">
                            {t('usuarios.modal.fields.position_type')}
                          </label>
                          <select
                            name="position_type"
                            value={formData.position_type || 'kitchen'}
                            onChange={handleChange}
                            className="w-full px-4 py-3.5 rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-black text-gray-900 dark:text-white focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all"
                          >
                            <option value="kitchen" className="dark:bg-slate-900">{getPositionLabel('kitchen')}</option>
                            <option value="cashier" className="dark:bg-slate-900">{getPositionLabel('cashier')}</option>
                            <option value="both" className="dark:bg-slate-900">{getPositionLabel('both')}</option>
                            <option value="general" className="dark:bg-slate-900">{getPositionLabel('general')}</option>
                          </select>
                        </div>

                        {/* PADRÓN ACTIVO EN LA SUCURSAL SELECCIONADA Y REEMPLAZO SELECTIVO */}
                        {formData.store_id && (
                          <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-900/90 border border-gray-200/80 dark:border-slate-700/80 space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-black uppercase tracking-widest text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
                                <Users size={13} />
                                {tr(
                                  'usuarios.modal.store_roster_title',
                                  'Personal Activo en esta Sucursal',
                                  'Active Staff at this Store'
                                )}
                              </span>
                              <span className="text-[10px] font-black text-gray-400 dark:text-slate-500">
                                {activeStoreStaff.length}
                              </span>
                            </div>

                            {activeStoreStaff.length === 0 ? (
                              <p className="text-[11px] text-gray-400 dark:text-slate-500 font-bold">
                                {tr(
                                  'usuarios.modal.store_roster_empty',
                                  'No hay otros gerentes o asistentes activos en esta sucursal.',
                                  'No other active managers or assistants at this store.'
                                )}
                              </p>
                            ) : (
                              <div className="space-y-2.5">
                                {/* Manager(s) en la sucursal */}
                                {activeStoreManagers.length > 0 && (
                                  <div className="space-y-1.5">
                                    <p className="text-[10px] font-black uppercase tracking-wider text-blue-600 dark:text-blue-400">
                                      {tr('usuarios.modal.current_manager', 'Manager Actual', 'Current Manager')}
                                    </p>
                                    {activeStoreManagers.map((mgr) => {
                                      const mgrId = Number(mgr.id)
                                      const checked = deactivateUserIds.includes(mgrId)
                                      return (
                                        <div
                                          key={mgr.id}
                                          className={`p-2.5 rounded-xl border text-xs transition-colors ${
                                            isManagerRole
                                              ? 'bg-amber-500/10 border-amber-500/30 text-amber-900 dark:text-amber-200'
                                              : 'bg-gray-50 dark:bg-slate-800/70 border-gray-100 dark:border-slate-700/70 text-gray-700 dark:text-slate-300'
                                          }`}
                                        >
                                          <div className="flex items-center justify-between gap-2">
                                            <div className="min-w-0">
                                              <p className="font-black truncate">{mgr.full_name}</p>
                                              <p className="text-[10px] opacity-75 truncate">{mgr.email}</p>
                                            </div>
                                            <span className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase bg-blue-500/10 text-blue-600 dark:text-blue-300 shrink-0">
                                              Manager
                                            </span>
                                          </div>
                                          {isManagerRole && (
                                            <label className="flex items-center gap-2 mt-2 pt-2 border-t border-amber-500/20 font-bold text-[11px] cursor-pointer">
                                              <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() => toggleDeactivateCandidate(mgrId)}
                                                className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500 accent-amber-600"
                                              />
                                              <span>
                                                {tr(
                                                  'usuarios.modal.replace_conflict_manager',
                                                  `Desactivar al manager saliente (${mgr.full_name}) al guardar`,
                                                  `Deactivate outgoing manager (${mgr.full_name}) on save`
                                                )}
                                              </span>
                                            </label>
                                          )}
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}

                                {/* Asistentes (AM/PM) en la sucursal */}
                                {activeStoreAssistants.length > 0 && (
                                  <div className="space-y-1.5">
                                    <p className="text-[10px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                                      {tr(
                                        'usuarios.modal.current_assistants',
                                        `Asistentes Activos (${activeStoreAssistants.length} — Turnos AM/PM)`,
                                        `Active Assistants (${activeStoreAssistants.length} — AM/PM Shifts)`
                                      )}
                                    </p>
                                    {isAssistantRole && (
                                      <p className="text-[10px] text-gray-500 dark:text-slate-400 font-bold leading-snug">
                                        {tr(
                                          'usuarios.modal.replace_assistant_prompt',
                                          '¿Reemplaza a algún asistente saliente? Márcalo solo si deseas desactivarlo al guardar (déjalo sin marcar para mantener ambos turnos AM/PM activos).',
                                          'Replacing an outgoing assistant? Check only if you want to deactivate them on save (leave unchecked to keep both AM/PM shifts active).'
                                        )}
                                      </p>
                                    )}
                                    {activeStoreAssistants.map((asst) => {
                                      const asstId = Number(asst.id)
                                      const checked = deactivateUserIds.includes(asstId)
                                      return (
                                        <div
                                          key={asst.id}
                                          className={`p-2.5 rounded-xl border text-xs transition-colors ${
                                            checked
                                              ? 'bg-rose-500/10 border-rose-500/30 text-rose-900 dark:text-rose-200'
                                              : 'bg-gray-50 dark:bg-slate-800/70 border-gray-100 dark:border-slate-700/70 text-gray-700 dark:text-slate-300'
                                          }`}
                                        >
                                          <div className="flex items-center justify-between gap-2">
                                            <div className="min-w-0">
                                              <p className="font-black truncate">{asst.full_name}</p>
                                              <p className="text-[10px] opacity-75 truncate">{asst.email}</p>
                                            </div>
                                            <span className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 shrink-0">
                                              {getPositionLabel(asst.position_type)}
                                            </span>
                                          </div>
                                          {isAssistantRole && (
                                            <label className="flex items-center gap-2 mt-2 pt-1.5 border-t border-gray-200/60 dark:border-slate-700/60 font-bold text-[11px] cursor-pointer">
                                              <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() => toggleDeactivateCandidate(asstId)}
                                                className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500 accent-rose-600"
                                              />
                                              <span>
                                                {tr(
                                                  'usuarios.modal.deactivate_assistant_option',
                                                  `Dar de baja a ${asst.full_name} al guardar`,
                                                  `Deactivate ${asst.full_name} on save`
                                                )}
                                              </span>
                                            </label>
                                          )}
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {isSupervisor && (
                      <div className="space-y-3 h-full flex flex-col">
                        <label className="block text-[10px] font-black text-purple-600/70 dark:text-purple-400/70 uppercase tracking-widest ml-1">
                          {t('usuarios.modal.fields.supervision_scope')} ({formData.store_scope?.length || 0})
                        </label>
                        <div className="flex-1 bg-white dark:bg-slate-800/50 border border-gray-100 dark:border-slate-700 rounded-2xl p-2 max-h-[240px] overflow-y-auto space-y-1 transition-colors">
                          {sortStoresAlphabetically(stores, (s) => s.name).map((store) => (
                            <label key={store.id} className="flex items-center gap-3 p-2.5 hover:bg-purple-50 dark:hover:bg-purple-900/30 rounded-xl cursor-pointer transition-colors group">
                              <input
                                type="checkbox"
                                checked={isStoreInScope(store.name)}
                                onChange={() => handleScopeChange(store.name)}
                                className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500 dark:bg-slate-900 dark:border-slate-700"
                              />
                              <span className="text-xs font-black text-gray-700 dark:text-slate-300 group-hover:text-purple-700 dark:group-hover:text-purple-400 uppercase tracking-tight truncate">
                                {formatStoreName(store.name)}
                              </span>
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
              disabled={busy}
              className="px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-slate-500 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              {t('usuarios.modal.buttons.cancel')}
            </button>
            <button
              type="submit"
              form="userForm"
              className="px-8 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest text-white dark:text-slate-900 bg-slate-900 dark:bg-white hover:bg-black dark:hover:bg-slate-100 shadow-xl shadow-gray-200 dark:shadow-none hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              disabled={!!passError || busy}
            >
              {busy && <RefreshCw size={14} className="animate-spin" />}
              {busy
                ? tr('usuarios.modal.buttons.saving', 'Guardando...', 'Saving...')
                : initialData
                  ? t('usuarios.modal.buttons.save')
                  : t('usuarios.modal.buttons.create')}
            </button>
          </div>

        </div>
      </div>
    </div>,
    document.body
  )
}
