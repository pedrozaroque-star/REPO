/**
 * @module UsuariosPage
 * @description Panel administrativo para gestionar usuarios del sistema Tacos Gavilan (altas, bajas, cambios de rol y transferencias de sucursal).
 * @businessRules
 * - Admins tienen acceso global a todas las tiendas.
 * - Supervisores tienen múltiples tiendas asignadas en `store_scope`.
 * - Roles operativos de sucursal única (`manager`, `asistente`, `general_manager`, `gerente`, `assistant`, `shift_leader`) operan con una tienda asignada (`store_id`) y tipo de puesto (`position_type`).
 * - Roles restringidos de módulo único (`planificador`, `basecamp`) operan sin tienda asignada (`store_id = null`).
 * - Permite transferencia rápida de sucursal en 1 clic (`handleQuickStoreTransfer`) y activación/desactivación rápida en 1 clic (`handleQuickToggleActive`) tanto en vista de lista como en cuadrícula (Desktop y Móvil).
 * @dataFlow
 * - Supabase (`users`, `stores`) + `/api/admin/users/sync-toast` -> Filtros por búsqueda/rol/tienda/estado -> Tabla o Grid interactivo + `UserModal` -> `/api/admin/update-user` y `/api/admin/create-user`.
 * @notes
 * - Fixed 2026-11-23: Usa `getValidBrowserTegToken()` para evitar fallos 401 con tokens estancados en Desktop PC, conserva `toast_guid` e `is_active` en altas/ediciones, delega desactivación de reemplazos tras el guardado exitoso, habilita clic en tarjetas de Grid en Desktop y añade transferencia rápida de sucursal + toggle de estado activo en 1 clic.
 */

'use client'

import { useEffect, useState } from 'react'
import {
  Users,
  Search,
  Plus,
  User,
  MoreHorizontal,
  MapPin,
  LayoutGrid,
  List,
  Shield,
  Sparkles,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Link2,
  Power
} from 'lucide-react'
import ProtectedRoute from '@/components/ProtectedRoute'
import SurpriseLoader from '@/components/SurpriseLoader'
import UserModal from '@/components/UserModal'
import ToastSyncModal from '@/components/ToastSyncModal'
import { getSupabaseClient, formatStoreName, getValidBrowserTegToken } from '@/lib/supabase'
import { sortStoresAlphabetically } from '@/lib/store-display'
import { useLanguage } from '@/lib/i18n'

const SINGLE_STORE_STAFF_ROLES = new Set([
  'manager',
  'asistente',
  'general_manager',
  'gerente',
  'assistant',
  'shift_leader'
])

function isSingleStoreStaffRole(role?: string | null): boolean {
  return SINGLE_STORE_STAFF_ROLES.has(String(role || '').trim().toLowerCase())
}

function normalizePositionKey(raw?: string | null): string {
  const norm = String(raw || '').trim().toLowerCase()
  if (norm === 'cashier' || norm === 'cajero') return 'cashier'
  if (norm === 'both' || norm === 'ambos') return 'both'
  if (norm === 'general') return 'general'
  return 'kitchen'
}

function UsuariosPage() {
  const { t, language } = useLanguage()
  const [users, setUsers] = useState<any[]>([])
  const [stores, setStores] = useState<any[]>([])
  const [toastEmployees, setToastEmployees] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [quickActionUserId, setQuickActionUserId] = useState<number | null>(null)
  const [feedbackBanner, setFeedbackBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Filtros
  const [searchTerm, setSearchTerm] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [storeFilter, setStoreFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list')

  // Estado para Modales
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isToastSyncOpen, setIsToastSyncOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<any>(null)

  const tr = (key: string, esFallback: string, enFallback: string) => {
    const val = t(key)
    if (!val || val === key) {
      return language === 'en' ? enFallback : esFallback
    }
    return val
  }

  const getAuthHeaders = (): Record<string, string> => {
    const validToken = getValidBrowserTegToken()
    const rawToken = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null
    const token = validToken || rawToken
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  }

  const showFeedback = (type: 'success' | 'error', message: string) => {
    setFeedbackBanner({ type, message })
    setTimeout(() => {
      setFeedbackBanner((prev) => (prev?.message === message ? null : prev))
    }, 5000)
  }

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      const supabase = await getSupabaseClient()

      const { data: usersData, error: userError } = await supabase
        .from('users')
        .select('id, full_name, email, phone, role, store_id, store_scope, position_type, is_active, toast_guid, avatar_url, last_login, created_at')
        .order('full_name')

      if (userError) throw userError

      const { data: storesData, error: storeError } = await supabase
        .from('stores')
        .select('id, name, code')
        .order('name')

      if (storeError) throw storeError

      try {
        const syncRes = await fetch('/api/admin/users/sync-toast', {
          headers: getAuthHeaders()
        })
        const syncJson = await syncRes.json()
        if (syncJson.success) {
          setToastEmployees(syncJson.toastEmployees || [])
        }
      } catch (err) {
        console.error('Error fetching toast employees list:', err)
      }

      setUsers(usersData || [])
      setStores(sortStoresAlphabetically(storesData || [], (s) => s.name))
    } catch (err: any) {
      console.error('Error cargando datos:', err.message)
      showFeedback('error', err.message || 'Error loading users')
    } finally {
      setLoading(false)
    }
  }

  // --- LÓGICA MAESTRA DE GUARDADO (ALTAS Y CAMBIOS) ---
  const handleSaveUser = async (formData: any, isEdit: boolean) => {
    try {
      setIsSaving(true)
      const authHeaders = getAuthHeaders()
      const role = String(formData.role || 'asistente').trim().toLowerCase()
      const isStaff = isSingleStoreStaffRole(role)

      const parsedStoreId =
        isStaff && formData.store_id !== null && formData.store_id !== undefined && String(formData.store_id).trim() !== ''
          ? parseInt(String(formData.store_id), 10)
          : null

      const cleanData: Record<string, any> = {
        full_name: String(formData.full_name || '').trim(),
        role,
        phone: formData.phone ? String(formData.phone).trim() : null,
        email: String(formData.email || '').trim().toLowerCase(),
        is_active: formData.is_active === true || formData.is_active === 'true' || formData.is_active === 1,
        store_id: Number.isFinite(parsedStoreId) ? parsedStoreId : null,
        store_scope: role === 'supervisor' && Array.isArray(formData.store_scope) ? formData.store_scope : null,
        position_type: isStaff ? normalizePositionKey(formData.position_type) : null,
        toast_guid: formData.toast_guid ? String(formData.toast_guid).trim() : null,
        ...(formData.password && String(formData.password).trim() !== '' ? { password: formData.password } : {})
      }

      const deactivateUserIds: number[] = Array.isArray(formData.deactivateUserIds)
        ? formData.deactivateUserIds.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id) && id > 0)
        : formData.deactivateCurrentId
          ? [Number(formData.deactivateCurrentId)].filter((id: number) => Number.isFinite(id) && id > 0)
          : []

      if (isEdit) {
        const response = await fetch('/api/admin/update-user', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            userId: formData.id,
            userData: cleanData,
            deactivateUserIds,
            deactivateCurrentId: deactivateUserIds[0] || null
          })
        })

        const result = await response.json()
        if (!response.ok || !result.success) {
          throw new Error(result.error || 'Error updating user')
        }
      } else {
        const response = await fetch('/api/admin/create-user', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            email: cleanData.email,
            password: formData.password,
            fullName: cleanData.full_name,
            role: cleanData.role,
            storeId: cleanData.store_id,
            deactivateUserIds,
            deactivateCurrentId: deactivateUserIds[0] || null,
            otherData: {
              phone: cleanData.phone,
              is_active: cleanData.is_active,
              store_scope: cleanData.store_scope,
              position_type: cleanData.position_type,
              toast_guid: cleanData.toast_guid
            }
          })
        })

        const result = await response.json()
        if (!response.ok || !result.success) {
          throw new Error(result.error || 'Error creating user')
        }
      }

      await fetchData()
      setIsModalOpen(false)
      setEditingUser(null)
      showFeedback(
        'success',
        isEdit
          ? tr('usuarios.actions.user_updated_ok', '✅ Usuario actualizado correctamente', '✅ User updated successfully')
          : tr('usuarios.actions.user_created_ok', '✅ Usuario creado correctamente', '✅ User created successfully')
      )
    } catch (err: any) {
      console.error(err)
      showFeedback('error', err.message || 'Error saving user')
      alert('❌ Error: ' + err.message)
    } finally {
      setIsSaving(false)
    }
  }

  // --- TRANSFERENCIA RÁPIDA DE SUCURSAL EN 1 CLIC (DESKTOP & MOBILE) ---
  const handleQuickStoreTransfer = async (user: any, newStoreIdRaw: string) => {
    const newStoreId = newStoreIdRaw ? parseInt(newStoreIdRaw, 10) : null
    if (Number(user.store_id) === Number(newStoreId)) return

    try {
      setQuickActionUserId(Number(user.id))
      const response = await fetch('/api/admin/update-user', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          userId: user.id,
          userData: {
            store_id: newStoreId,
            position_type: normalizePositionKey(user.position_type)
          }
        })
      })

      const result = await response.json()
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'No se pudo transferir de sucursal')
      }

      const targetStore = stores.find((s) => Number(s.id) === Number(newStoreId))
      setUsers((prev) =>
        prev.map((u) =>
          u.id === user.id
            ? {
                ...u,
                store_id: newStoreId,
                position_type: normalizePositionKey(u.position_type),
                ...(result.data?.[0] || {})
              }
            : u
        )
      )
      showFeedback(
        'success',
        `${user.full_name} → ${targetStore ? formatStoreName(targetStore.name) : tr('usuarios.table.location', 'Sin tienda', 'Unassigned')}`
      )
    } catch (err: any) {
      console.error('Error en transferencia rápida:', err)
      showFeedback('error', err.message || 'Error transferring user')
      alert('❌ Error: ' + err.message)
    } finally {
      setQuickActionUserId(null)
    }
  }

  // --- ACTIVACIÓN / BAJA RÁPIDA EN 1 CLIC ---
  const handleQuickToggleActive = async (user: any) => {
    const nextActive = !user.is_active
    try {
      setQuickActionUserId(Number(user.id))
      const response = await fetch('/api/admin/update-user', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          userId: user.id,
          userData: {
            is_active: nextActive
          }
        })
      })

      const result = await response.json()
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'No se pudo actualizar el estado del usuario')
      }

      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, is_active: nextActive } : u))
      )
      showFeedback(
        'success',
        `${user.full_name}: ${nextActive ? t('usuarios.table.active') : t('usuarios.table.inactive')}`
      )
    } catch (err: any) {
      console.error('Error al cambiar estado activo:', err)
      showFeedback('error', err.message || 'Error toggling active status')
      alert('❌ Error: ' + err.message)
    } finally {
      setQuickActionUserId(null)
    }
  }

  // Usuarios visibles base (excluyendo cuentas ocultas de sistema)
  const baseVisibleUsers = users.filter((user) => {
    if (user.email?.toLowerCase() === 'carlos@tacosgavilan.com' && !user.is_active) {
      return false
    }
    return true
  })

  // Contadores en vivo por estado
  const activeCount = baseVisibleUsers.filter((u) => u.is_active).length
  const inactiveCount = baseVisibleUsers.filter((u) => !u.is_active).length

  // Filtrado inteligente por búsqueda (nombre, email, teléfono, tienda), rol, sucursal y estado
  const filteredUsers = baseVisibleUsers.filter((user) => {
    const searchLower = searchTerm.trim().toLowerCase()
    const userStore = stores.find((s) => Number(s.id) === Number(user.store_id))
    const storeNameLower = userStore ? formatStoreName(userStore.name).toLowerCase() : ''
    const scopeLower = Array.isArray(user.store_scope) ? user.store_scope.join(' ').toLowerCase() : ''

    const matchesSearch =
      !searchLower ||
      user.full_name?.toLowerCase().includes(searchLower) ||
      user.email?.toLowerCase().includes(searchLower) ||
      user.phone?.toLowerCase().includes(searchLower) ||
      storeNameLower.includes(searchLower) ||
      scopeLower.includes(searchLower)

    const userRoleNorm = String(user.role || '').trim().toLowerCase()
    const matchesRole =
      roleFilter === 'all' ||
      userRoleNorm === roleFilter ||
      (roleFilter === 'manager' && ['manager', 'general_manager', 'gerente'].includes(userRoleNorm)) ||
      (roleFilter === 'asistente' && ['asistente', 'assistant', 'shift_leader'].includes(userRoleNorm))

    const matchesStore = (() => {
      if (storeFilter === 'all') return true
      if (String(user.store_id) === String(storeFilter)) return true
      if (userRoleNorm === 'supervisor' && Array.isArray(user.store_scope)) {
        const selectedStoreObj = stores.find((s) => String(s.id) === String(storeFilter))
        if (!selectedStoreObj) return false
        const targetNorm = selectedStoreObj.name.replace(/^Tacos Gavilan\s+/i, '').toLowerCase().trim()
        return user.store_scope.some(
          (sc: string) => sc.replace(/^Tacos Gavilan\s+/i, '').toLowerCase().trim() === targetNorm
        )
      }
      return false
    })()

    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && Boolean(user.is_active)) ||
      (statusFilter === 'inactive' && !user.is_active)

    return matchesSearch && matchesRole && matchesStore && matchesStatus
  })

  // Helpers visuales para etiquetas
  const roleColors: Record<string, string> = {
    admin: 'bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-900 border-transparent',
    supervisor: 'bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-900/50',
    manager: 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-900/50',
    general_manager: 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-900/50',
    gerente: 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-900/50',
    asistente: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50',
    assistant: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50',
    shift_leader: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50',
    planificador: 'bg-cyan-50 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400 border-cyan-200 dark:border-cyan-900/50',
    basecamp: 'bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-900/50'
  }

  const getRoleDisplayLabel = (role?: string) => {
    const norm = String(role || '').trim().toLowerCase()
    if (!norm) return ''
    const key = `usuarios.roles.${norm}`
    const translated = t(key)
    if (translated && translated !== key) return translated
    if (norm === 'general_manager' || norm === 'gerente') return t('usuarios.roles.manager')
    if (norm === 'assistant') return t('usuarios.roles.asistente')
    if (norm === 'shift_leader') return tr('usuarios.roles.shift_leader', 'Líder de Turno', 'Shift Leader')
    return role || ''
  }

  const getPositionDisplayLabel = (positionType?: string | null) => {
    if (!positionType) return ''
    const norm = normalizePositionKey(positionType)
    return tr(
      `usuarios.modal.positions.${norm}`,
      norm === 'cashier' ? 'Cajero' : norm === 'both' ? 'Ambos' : norm === 'general' ? 'General' : 'Cocina',
      norm === 'cashier' ? 'Cashier' : norm === 'both' ? 'Both' : norm === 'general' ? 'General' : 'Kitchen'
    )
  }

  // Helper para mostrar ubicación (Tienda fija o Alcance múltiple)
  const getLocationLabel = (user: any) => {
    const norm = String(user.role || '').trim().toLowerCase()
    if (norm === 'admin') return t('usuarios.modal.admin_access_title')
    if (norm === 'basecamp') return t('usuarios.roles.basecamp')
    if (norm === 'planificador') return t('usuarios.roles.planificador')

    if (norm === 'supervisor') {
      if (!user.store_scope || user.store_scope.length === 0) return t('usuarios.table.location') + ': 0'
      if (user.store_scope.length === 1) return formatStoreName(user.store_scope[0])
      return `${user.store_scope.length} ${t('items.stores')}`
    }

    const store = stores.find((s) => Number(s.id) === Number(user.store_id))
    return store ? formatStoreName(store.name) : tr('usuarios.actions.unassigned_store', 'Sin tienda asignada', 'Unassigned store')
  }

  return (
    <div className="flex bg-transparent dark:bg-neutral-900 font-sans w-full animate-in fade-in duration-500 relative overflow-hidden min-h-screen">
      <div className="absolute inset-0 opacity-10 dark:opacity-40 pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
      <main className="flex-1 flex flex-col h-full w-full relative">

        {/* STICKY HEADER - Mobile & Desktop */}
        <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-gray-200 dark:border-slate-800 shadow-sm sticky top-14 lg:top-0 z-20 shrink-0 transition-all">
          <div className="max-w-7xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between gap-4">

            {/* Title Area */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                <Users size={18} />
              </div>
              <div>
                <h1 className="text-lg md:text-xl font-black text-gray-900 dark:text-white tracking-tight leading-none">{t('usuarios.title')}</h1>
                <p className="hidden md:block text-[10px] text-gray-400 dark:text-slate-500 font-black uppercase tracking-widest">{t('usuarios.subtitle')}</p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2.5">
              {/* Desktop Search */}
              <div className="hidden md:flex relative group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500 group-focus-within:text-indigo-500 transition-colors" size={16} />
                <input
                  type="text"
                  placeholder={t('usuarios.search_placeholder')}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 pr-4 py-1.5 rounded-full bg-gray-100 dark:bg-slate-800 border border-transparent dark:border-slate-700 outline-none focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-900/50 text-sm font-bold text-gray-900 dark:text-white w-56 lg:w-64 transition-all"
                />
              </div>

              {/* Desktop Role Filter */}
              <div className="hidden md:block">
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  className="pl-3 pr-7 py-1.5 rounded-full bg-gray-100 dark:bg-slate-800 border-none outline-none focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-900/50 text-xs font-black text-gray-600 dark:text-slate-300 cursor-pointer"
                >
                  <option value="all" className="dark:bg-slate-900">{t('usuarios.roles.all')}</option>
                  <option value="admin" className="dark:bg-slate-900">{t('usuarios.roles.admin')}</option>
                  <option value="supervisor" className="dark:bg-slate-900">{t('usuarios.roles.supervisor')}</option>
                  <option value="manager" className="dark:bg-slate-900">{t('usuarios.roles.manager')}</option>
                  <option value="asistente" className="dark:bg-slate-900">{t('usuarios.roles.asistente')}</option>
                  <option value="planificador" className="dark:bg-slate-900">{t('usuarios.roles.planificador')}</option>
                  <option value="basecamp" className="dark:bg-slate-900">{t('usuarios.roles.basecamp')}</option>
                </select>
              </div>

              {/* Desktop Store Filter */}
              <div className="hidden lg:block">
                <select
                  value={storeFilter}
                  onChange={(e) => setStoreFilter(e.target.value)}
                  className="pl-3 pr-7 py-1.5 rounded-full bg-gray-100 dark:bg-slate-800 border-none outline-none focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-900/50 text-xs font-black text-gray-600 dark:text-slate-300 cursor-pointer"
                >
                  <option value="all" className="dark:bg-slate-900">
                    {tr('usuarios.filters.all_stores', 'Todas las Sucursales', 'All Stores')}
                  </option>
                  {stores.map((s) => (
                    <option key={s.id} value={String(s.id)} className="dark:bg-slate-900">
                      {formatStoreName(s.name)}
                    </option>
                  ))}
                </select>
              </div>

              {/* View Toggle (Desktop) */}
              <div className="hidden md:flex bg-gray-100 dark:bg-slate-800 p-1 rounded-full">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-1.5 rounded-full transition-all ${viewMode === 'grid' ? 'bg-white dark:bg-slate-700 shadow-sm text-gray-900 dark:text-white ring-1 ring-black/5 dark:ring-white/10' : 'text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300'}`}
                  title={tr('usuarios.actions.view_grid', 'Vista Cuadrícula', 'Grid View')}
                >
                  <LayoutGrid size={16} />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-1.5 rounded-full transition-all ${viewMode === 'list' ? 'bg-white dark:bg-slate-700 shadow-sm text-gray-900 dark:text-white ring-1 ring-black/5 dark:ring-white/10' : 'text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300'}`}
                  title={tr('usuarios.actions.view_list', 'Vista Lista', 'List View')}
                >
                  <List size={16} />
                </button>
              </div>

              <button
                onClick={() => setIsToastSyncOpen(true)}
                className="px-3 md:px-4 py-1.5 rounded-full bg-amber-400 dark:bg-amber-500 text-slate-900 font-black text-[10px] tracking-[0.05em] uppercase flex items-center justify-center gap-1.5 hover:bg-amber-300 transition-all active:scale-[0.98] shadow-md shadow-amber-500/20"
                title={tr('usuarios.actions.sync_toast_title', 'Sincronizar Promociones desde Toast', 'Sync Promotions from Toast')}
              >
                <Sparkles size={14} className="fill-slate-900" />
                <span className="hidden md:inline">
                  {tr('usuarios.actions.sync_toast_btn', 'Promociones Toast', 'Toast Promotions')}
                </span>
              </button>

              <button
                onClick={() => { setEditingUser(null); setIsModalOpen(true); }}
                className="w-8 h-8 md:w-auto md:h-auto md:px-4 md:py-1.5 rounded-full bg-gray-900 dark:bg-slate-100 text-white dark:text-slate-900 flex items-center justify-center gap-2 hover:bg-black dark:hover:bg-white transition-all active:scale-[0.98] shadow-lg shadow-gray-200 dark:shadow-none"
              >
                <Plus size={16} strokeWidth={3} />
                <span className="hidden md:inline font-black text-[10px] tracking-[0.1em]">{t('usuarios.new_user')}</span>
              </button>
            </div>
          </div>
        </div>

        {/* MAIN CONTENT */}
        <div className="p-4 md:p-8 max-w-7xl mx-auto pb-24 w-full space-y-5">

          {/* Feedback Banner */}
          {feedbackBanner && (
            <div
              className={`p-3.5 px-4 rounded-2xl border text-xs font-black flex items-center justify-between gap-3 animate-in fade-in duration-200 ${
                feedbackBanner.type === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                  : 'bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
              }`}
            >
              <div className="flex items-center gap-2">
                {feedbackBanner.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                <span>{feedbackBanner.message}</span>
              </div>
              <button
                type="button"
                onClick={() => setFeedbackBanner(null)}
                className="text-[10px] uppercase tracking-wider opacity-75 hover:opacity-100"
              >
                OK
              </button>
            </div>
          )}

          {/* Status Filter Pills + Store Filter Bar (Desktop & Mobile) */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`px-3.5 py-1.5 rounded-full text-[11px] font-black uppercase tracking-wider transition-all border ${
                  statusFilter === 'all'
                    ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-slate-900 dark:border-white shadow-sm'
                    : 'bg-white dark:bg-slate-900 text-gray-500 dark:text-slate-400 border-gray-200 dark:border-slate-800 hover:border-gray-300'
                }`}
              >
                {tr('usuarios.filters.status_all', 'Todos', 'All')} ({baseVisibleUsers.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('active')}
                className={`px-3.5 py-1.5 rounded-full text-[11px] font-black uppercase tracking-wider transition-all border flex items-center gap-1.5 ${
                  statusFilter === 'active'
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                    : 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50 hover:bg-emerald-50/50'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-current" />
                {tr('usuarios.filters.status_active', 'Activos', 'Active')} ({activeCount})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('inactive')}
                className={`px-3.5 py-1.5 rounded-full text-[11px] font-black uppercase tracking-wider transition-all border flex items-center gap-1.5 ${
                  statusFilter === 'inactive'
                    ? 'bg-rose-600 text-white border-rose-600 shadow-sm'
                    : 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-900/50 hover:bg-rose-50/50'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-current" />
                {tr('usuarios.filters.status_inactive', 'Inactivos / Bajas', 'Inactive')} ({inactiveCount})
              </button>
            </div>

            {/* Store Filter for Mobile & Tablet (< lg) */}
            <div className="lg:hidden w-full sm:w-auto">
              <select
                value={storeFilter}
                onChange={(e) => setStoreFilter(e.target.value)}
                className="w-full sm:w-auto px-3.5 py-2 rounded-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-xs font-black text-gray-700 dark:text-slate-300 outline-none"
              >
                <option value="all">
                  {tr('usuarios.filters.all_stores', 'Todas las Sucursales', 'All Stores')}
                </option>
                {stores.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    {formatStoreName(s.name)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Mobile Search & Role Filter */}
          <div className="md:hidden space-y-3 w-full">
            <div className="relative group shadow-lg shadow-gray-200/50 dark:shadow-none rounded-full">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500" size={18} />
              <input
                type="text"
                placeholder={t('usuarios.search_placeholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-11 pr-4 py-3 rounded-full bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 outline-none focus:border-indigo-300 dark:focus:border-indigo-900 text-sm font-bold text-gray-900 dark:text-white placeholder:text-gray-400"
              />
            </div>

            <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar w-full">
              {['all', 'admin', 'supervisor', 'manager', 'asistente', 'planificador', 'basecamp'].map((role) => (
                <button
                  key={role}
                  onClick={() => setRoleFilter(role)}
                  className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all border ${roleFilter === role
                    ? 'bg-gray-900 dark:bg-slate-100 text-white dark:text-slate-900 border-gray-900 dark:border-slate-100 shadow-md'
                    : 'bg-white dark:bg-slate-900 text-gray-500 dark:text-slate-500 border-gray-200 dark:border-slate-800'
                    }`}
                >
                  {role === 'all' ? t('usuarios.roles.all') : getRoleDisplayLabel(role)}
                </button>
              ))}
            </div>
          </div>

          {/* Grid de Tarjetas o Tabla Lista */}
          {loading ? (
            <div className="py-20 flex justify-center scale-75">
              <SurpriseLoader />
            </div>
          ) : (
            <>
              {viewMode === 'list' ? (
                <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-3xl shadow-sm border border-gray-100 dark:border-slate-800 overflow-x-auto animate-in fade-in slide-in-from-bottom-4 duration-500 transition-all">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50/50 dark:bg-slate-800/50 border-b border-gray-100 dark:border-slate-800">
                      <tr>
                        <th className="px-6 py-4 font-black text-[10px] text-gray-400 dark:text-slate-500 uppercase tracking-widest">{t('usuarios.table.user')}</th>
                        <th className="px-6 py-4 font-black text-[10px] text-gray-400 dark:text-slate-500 uppercase tracking-widest">{t('usuarios.table.role')}</th>
                        <th className="px-6 py-4 font-black text-[10px] text-gray-400 dark:text-slate-500 uppercase tracking-widest">{t('usuarios.table.location')}</th>
                        <th className="px-6 py-4 font-black text-[10px] text-gray-400 dark:text-slate-500 uppercase tracking-widest text-center">{t('usuarios.table.status')}</th>
                        <th className="px-6 py-4 text-right"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                      {filteredUsers.map((user) => {
                        const isStaff = isSingleStoreStaffRole(user.role)
                        const isRowBusy = quickActionUserId === Number(user.id)
                        return (
                          <tr
                            key={user.id}
                            className={`hover:bg-gray-50/70 dark:hover:bg-slate-800/60 transition-colors group cursor-pointer ${
                              !user.is_active ? 'opacity-60 bg-gray-50/40 dark:bg-slate-900/40' : ''
                            }`}
                            onClick={() => { setEditingUser(user); setIsModalOpen(true); }}
                          >
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-white font-black text-xs shadow-sm shrink-0 uppercase
                                  ${user.role === 'admin' ? 'bg-slate-800 dark:bg-slate-200 dark:text-slate-900' :
                                    ['manager', 'general_manager', 'gerente'].includes(user.role) ? 'bg-blue-600' :
                                      user.role === 'supervisor' ? 'bg-purple-600' :
                                        user.role === 'basecamp' ? 'bg-sky-600' :
                                          user.role === 'planificador' ? 'bg-cyan-600' :
                                            'bg-emerald-500'
                                  }`}>
                                  {user.full_name?.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                  <div className="font-bold text-gray-900 dark:text-white leading-tight flex items-center gap-2 flex-wrap">
                                    <span>{user.full_name}</span>
                                    {!user.is_active && (
                                      <span className="text-[9px] font-black text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800/60 px-2 py-0.5 rounded-md uppercase tracking-widest">
                                        {t('usuarios.table.inactive')}
                                      </span>
                                    )}
                                    {user.toast_guid && (
                                      <span
                                        className="text-[9px] font-black text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-md flex items-center gap-1"
                                        title={tr('usuarios.actions.toast_linked', 'Vinculado con Toast POS', 'Linked to Toast POS')}
                                      >
                                        <Link2 size={10} /> Toast
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-gray-500 dark:text-slate-500 font-bold">
                                    {user.email}
                                    {user.phone ? ` • ${user.phone}` : ''}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex flex-col gap-1 items-start">
                                <span className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wide border ${roleColors[user.role] || 'bg-gray-100 text-gray-500'}`}>
                                  {getRoleDisplayLabel(user.role)}
                                </span>
                                {user.position_type && (
                                  <span className="text-[9px] font-bold text-gray-500 dark:text-slate-500 uppercase tracking-widest pl-1 mt-0.5">
                                    {getPositionDisplayLabel(user.position_type)}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-4" onClick={(e) => isStaff && e.stopPropagation()}>
                              {isStaff ? (
                                <div className="flex items-center gap-1.5">
                                  <MapPin size={13} className="text-indigo-500 shrink-0" />
                                  <select
                                    value={user.store_id !== null && user.store_id !== undefined ? String(user.store_id) : ''}
                                    disabled={isRowBusy}
                                    onChange={(e) => handleQuickStoreTransfer(user, e.target.value)}
                                    title={tr('usuarios.actions.quick_transfer', 'Transferir de sucursal en 1 clic', '1-click store transfer')}
                                    className="px-2.5 py-1.5 rounded-xl bg-gray-100/90 hover:bg-indigo-50 dark:bg-slate-800 dark:hover:bg-slate-700/80 border border-gray-200/80 dark:border-slate-700 text-xs font-black text-gray-800 dark:text-slate-200 cursor-pointer outline-none focus:ring-2 focus:ring-indigo-500/30 transition-colors"
                                  >
                                    <option value="">
                                      -- {tr('usuarios.actions.unassigned_store', 'Sin tienda', 'Unassigned')} --
                                    </option>
                                    {stores.map((s) => (
                                      <option key={s.id} value={String(s.id)} className="dark:bg-slate-900">
                                        {formatStoreName(s.name)}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              ) : (
                                <span className="text-xs font-bold text-gray-600 dark:text-slate-400 flex items-center gap-1.5 whitespace-nowrap">
                                  <MapPin size={12} className="text-gray-400 dark:text-slate-500" />
                                  {getLocationLabel(user)}
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-center" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                disabled={isRowBusy}
                                onClick={() => handleQuickToggleActive(user)}
                                title={tr('usuarios.actions.toggle_active', 'Clic para activar / desactivar usuario', 'Click to activate / deactivate user')}
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border transition-all cursor-pointer ${
                                  user.is_active
                                    ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60 hover:bg-emerald-100'
                                    : 'bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 border-gray-200 dark:border-slate-700 hover:bg-rose-50 hover:text-rose-600'
                                }`}
                              >
                                {isRowBusy ? (
                                  <RefreshCw size={11} className="animate-spin" />
                                ) : (
                                  <span className={`w-2 h-2 rounded-full ${user.is_active ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                                )}
                                <span>{user.is_active ? t('usuarios.table.active') : t('usuarios.table.inactive')}</span>
                              </button>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setEditingUser(user)
                                  setIsModalOpen(true)
                                }}
                                className="text-gray-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 p-2 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 rounded-xl transition-colors"
                                title={t('usuarios.modal.edit_title')}
                              >
                                <MoreHorizontal size={18} />
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>

                  {filteredUsers.length === 0 && (
                    <div className="p-12 text-center text-gray-400 dark:text-slate-600">
                      <p className="font-bold uppercase tracking-widest text-xs">{t('inspections.list.empty_search')}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  {filteredUsers.map((user) => {
                    const isStaff = isSingleStoreStaffRole(user.role)
                    const isCardBusy = quickActionUserId === Number(user.id)
                    return (
                      <div
                        key={user.id}
                        onClick={() => {
                          setEditingUser(user)
                          setIsModalOpen(true)
                        }}
                        className={`bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm p-5 rounded-3xl shadow-sm border transition-all duration-200 hover:shadow-lg relative group active:scale-[0.98] cursor-pointer
                          ${!user.is_active ? 'opacity-65 border-rose-200/60 dark:border-rose-900/40' : 'border-gray-100 dark:border-slate-800'}
                        `}
                      >
                        {/* Botones de Acción Rápida (Visibles siempre en Desktop y Móvil) */}
                        <div className="absolute top-4 right-4 flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={isCardBusy}
                            onClick={(e) => {
                              e.stopPropagation()
                              handleQuickToggleActive(user)
                            }}
                            className={`p-2 rounded-xl border text-xs transition-colors ${
                              user.is_active
                                ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-200/70 dark:border-emerald-800/50 hover:bg-emerald-100'
                                : 'text-gray-400 dark:text-slate-500 bg-gray-100 dark:bg-slate-800 border-gray-200 dark:border-slate-700 hover:text-emerald-600'
                            }`}
                            title={tr('usuarios.actions.toggle_active', 'Clic para activar / desactivar usuario', 'Click to activate / deactivate user')}
                          >
                            {isCardBusy ? <RefreshCw size={15} className="animate-spin" /> : <Power size={15} />}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setEditingUser(user)
                              setIsModalOpen(true)
                            }}
                            className="text-gray-500 dark:text-slate-400 hover:text-indigo-600 p-2 bg-gray-50 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 rounded-xl transition-colors opacity-100"
                            title={t('usuarios.modal.edit_title')}
                          >
                            <MoreHorizontal size={18} />
                          </button>
                        </div>

                        {/* Info Principal */}
                        <div className="flex items-center gap-4 mb-5 pr-20">
                          <div className={`w-12 h-12 md:w-14 md:h-14 rounded-2xl flex items-center justify-center text-white font-black text-xl md:text-2xl shadow-md shrink-0 uppercase
                            ${user.role === 'admin' ? 'bg-gradient-to-br from-slate-700 to-slate-900 dark:from-slate-100 dark:to-slate-300 dark:text-slate-900' :
                              ['manager', 'general_manager', 'gerente'].includes(user.role) ? 'bg-gradient-to-br from-blue-500 to-blue-600' :
                                user.role === 'supervisor' ? 'bg-gradient-to-br from-purple-500 to-purple-600' :
                                  user.role === 'basecamp' ? 'bg-gradient-to-br from-sky-500 to-blue-600' :
                                    user.role === 'planificador' ? 'bg-gradient-to-br from-cyan-500 to-teal-600' :
                                      'bg-gradient-to-br from-emerald-400 to-emerald-600'
                            }`}>
                            {user.full_name?.charAt(0).toUpperCase()}
                          </div>
                          <div className="overflow-hidden min-w-0">
                            <h3 className="font-black text-gray-900 dark:text-white text-base md:text-lg truncate leading-tight tracking-tight" title={user.full_name}>
                              {user.full_name}
                            </h3>
                            <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 truncate" title={user.email}>
                              {user.email}
                            </p>
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              {!user.is_active && (
                                <span className="inline-block text-[9px] font-black text-rose-600 bg-rose-50 dark:bg-rose-900/30 px-2 py-0.5 rounded-lg uppercase tracking-widest">
                                  {t('usuarios.table.inactive').toUpperCase()}
                                </span>
                              )}
                              {user.toast_guid && (
                                <span className="inline-flex items-center gap-1 text-[9px] font-black text-amber-700 dark:text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded-lg">
                                  <Link2 size={10} /> Toast
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Detalles Footer */}
                        <div className="space-y-3 pt-4 border-t border-dashed border-gray-100 dark:border-slate-800">
                          <div className="flex justify-between items-center">
                            <span className="text-[9px] font-black text-gray-400 dark:text-slate-600 uppercase tracking-[0.2em] flex items-center gap-1.5">
                              <User size={12} /> {t('usuarios.table.role').toUpperCase()}
                            </span>
                            <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border ${roleColors[user.role] || 'bg-gray-100'}`}>
                              {getRoleDisplayLabel(user.role)}
                            </span>
                          </div>

                          {user.position_type && (
                            <div className="flex justify-between items-center">
                              <span className="text-[9px] font-black text-gray-400 dark:text-slate-600 uppercase tracking-[0.2em] flex items-center gap-1.5">
                                <Shield size={12} /> {t('usuarios.modal.fields.position_type').toUpperCase()}
                              </span>
                              <span className="text-xs font-bold text-gray-700 dark:text-slate-400 uppercase tracking-wider">
                                {getPositionDisplayLabel(user.position_type)}
                              </span>
                            </div>
                          )}

                          <div className="flex justify-between items-center gap-2" onClick={(e) => isStaff && e.stopPropagation()}>
                            <span className="text-[9px] font-black text-gray-400 dark:text-slate-600 uppercase tracking-[0.2em] flex items-center gap-1.5 shrink-0">
                              <MapPin size={12} /> {t('usuarios.table.location').toUpperCase()}
                            </span>
                            {isStaff ? (
                              <select
                                value={user.store_id !== null && user.store_id !== undefined ? String(user.store_id) : ''}
                                disabled={isCardBusy}
                                onChange={(e) => handleQuickStoreTransfer(user, e.target.value)}
                                className="px-2.5 py-1 rounded-xl bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-[11px] font-black text-gray-800 dark:text-slate-200 max-w-[175px] truncate cursor-pointer outline-none focus:ring-2 focus:ring-indigo-500/30"
                              >
                                <option value="">
                                  -- {tr('usuarios.actions.unassigned_store', 'Sin tienda', 'Unassigned')} --
                                </option>
                                {stores.map((s) => (
                                  <option key={s.id} value={String(s.id)} className="dark:bg-slate-900">
                                    {formatStoreName(s.name)}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-[11px] font-bold text-gray-700 dark:text-slate-400 truncate max-w-[160px] text-right" title={getLocationLabel(user)}>
                                {getLocationLabel(user)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Inteligente */}
        <UserModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSave={handleSaveUser}
          stores={stores}
          initialData={editingUser}
          toastEmployees={toastEmployees}
          existingUsers={users}
          isSaving={isSaving}
        />

        {/* Modal Sincronización y Promociones Toast */}
        <ToastSyncModal
          isOpen={isToastSyncOpen}
          onClose={() => setIsToastSyncOpen(false)}
          onSuccess={() => fetchData()}
        />
      </main>
    </div>
  )
}

export default function ProtectedUsuariosPage() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'supervisor']}>
      <UsuariosPage />
    </ProtectedRoute>
  )
}
