/**
 * @module UsuariosPage
 * @description Administrative dashboard for managing system users, including roles, active credentials, and store scopes.
 * @businessRules
 * - Admins have global access.
 * - Supervisors are assigned multiple store scopes (retaining the "Tacos Gavilan " prefix in the database).
 * - Managers and Assistants require a single store assignment and a position type (kitchen/cashier).
 * @dataFlow
 * - Supabase ('users', 'stores') -> Component state -> Table/Grid Layout -> UserModal form interaction.
 * @notes Deletes redundant client-side password RPC calls to avoid permission warning popups, since database update is handled server-side.
 */

'use client'

import { useEffect, useState } from 'react'
import { Users, Search, Plus, Filter, User, MoreHorizontal, MapPin, LayoutGrid, List, Shield, Sparkles } from 'lucide-react'
import ProtectedRoute from '@/components/ProtectedRoute'
import SurpriseLoader from '@/components/SurpriseLoader'

import UserModal from '@/components/UserModal'
import ToastSyncModal from '@/components/ToastSyncModal'
import { getSupabaseClient, getSupabaseAdminClient, formatStoreName } from '@/lib/supabase'
import { useLanguage } from '@/lib/i18n'

function UsuariosPage() {
  const { t } = useLanguage()
  const [users, setUsers] = useState<any[]>([])
  const [stores, setStores] = useState<any[]>([])
  const [toastEmployees, setToastEmployees] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list')

  // Estado para el Modal
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isToastSyncOpen, setIsToastSyncOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<any>(null)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      const supabase = await getSupabaseClient()

      // Traemos usuarios ordenados por nombre
      const { data: usersData, error: userError } = await supabase
        .from('users')
        .select('*')
        .order('full_name')

      if (userError) throw userError

      // Traemos tiendas para mostrar nombres en la tabla
      const { data: storesData, error: storeError } = await supabase
        .from('stores')
        .select('id, name')
        .order('name')

      if (storeError) throw storeError

      // Traemos empleados de Toast formateados para autocompletado
      try {
        const syncRes = await fetch('/api/admin/users/sync-toast')
        const syncJson = await syncRes.json()
        if (syncJson.success) {
          setToastEmployees(syncJson.toastEmployees || [])
        }
      } catch (err) {
        console.error('Error fetching toast employees list:', err)
      }

      setUsers(usersData || [])
      setStores(storesData || [])
    } catch (err: any) {
      console.error('Error cargando datos:', err.message)
    } finally {
      setLoading(false)
    }
  }

  // --- LÓGICA MAESTRA DE GUARDADO ---
  const handleSaveUser = async (formData: any, isEdit: boolean) => {
    try {
      // ⚠️ USAR CLIENTE ADMIN para bypasear RLS en operaciones de gestión de usuarios
      const supabase = await getSupabaseAdminClient()

      // Si había un conflicto de sucursal y se solicitó desactivar al manager/asistente anterior
      if (formData.deactivateCurrentId) {
        console.log('🔄 Desactivando usuario conflictivo anterior:', formData.deactivateCurrentId)
        await supabase
          .from('users')
          .update({ is_active: false })
          .eq('id', formData.deactivateCurrentId)
      }

      // 1. Preparar datos limpios según el rol
      const role = formData.role

      // Reglas de negocio:
      // - Supervisores usan store_scope (array), NO store_id.
      // - Managers/Asistentes usan store_id, NO store_scope.
      const cleanData = {
        full_name: formData.full_name,
        role: role,
        phone: formData.phone, // Include phone in update payload
        email: formData.email, // Importante para updates visuales
        // Conversión explícita y robusta de is_active
        is_active: formData.is_active === true || formData.is_active === 'true' || formData.is_active === 1,
        // Lógica condicional de tiendas:
        store_id: ['manager', 'asistente'].includes(role) && formData.store_id
          ? parseInt(formData.store_id)
          : null,
        store_scope: role === 'supervisor'
          ? formData.store_scope // Array de nombres ['LYNWOOD', 'BELL']
          : null,
        position_type: ['manager', 'asistente'].includes(role)
          ? formData.position_type
          : null,
        // IMPORTANTE: Actualizar también password en public.users porque el Login custom lo usa
        ...(formData.password && formData.password.trim() !== '' ? { password: formData.password } : {})
      }



      if (isEdit) {
        // A. ACTUALIZAR USUARIO EXISTENTE



        // Usar API route del servidor (tiene acceso al service_role key)
        const response = await fetch('/api/admin/update-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: formData.id,
            userData: cleanData
          })
        })

        const result = await response.json()

        console.log('✅ Resultado del API:', result)

        if (!result.success) {
          console.error('❌ Error en actualización:', result.error)
          throw new Error(result.error || 'Error updating user')
        }

        if (!result.data || result.data.length === 0) {
          console.error('⚠️ El update no afectó ninguna fila.')
          // alert('⚠️ Advertencia: No se pudo actualizar el usuario.') // Using browser alert for now, but UI text should be cleaner
          return
        }

        console.log('✅ Usuario actualizado exitosamente')

        if (formData.password && formData.password.trim() !== '') {
          // Intentar sincronizar con Supabase Auth
          try {
            const response = await fetch('/api/admin/reset-password', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userId: formData.id,
                email: formData.email,
                password: formData.password
              })
            })

            if (!response.ok) {
              const resData = await response.json()
              console.warn('Sync Auth warning:', resData.error || 'Failed to sync auth password')
            }
          } catch (syncErr) {
            console.error('Failed to sync auth password:', syncErr)
          }
        }

        // alert('✅ Usuario actualizado correctamente')

      } else {
        // B. CREAR NUEVO USUARIO
        const response = await fetch('/api/admin/create-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: formData.email,
            password: formData.password,
            fullName: formData.full_name,
            role: formData.role,
            storeId: cleanData.store_id,
            otherData: {
              phone: formData.phone,
              is_active: true,
              store_scope: (formData.role === 'supervisor' && cleanData.store_scope) ? cleanData.store_scope : null,
              position_type: ['manager', 'asistente'].includes(formData.role) ? formData.position_type : null
            }
          })
        })

        const result = await response.json()

        if (!result.success) {
          console.error('❌ Error API crear usuario:', result.error)
          throw new Error(result.error || 'Error creating user')
        }

        console.log('✅ Usuario creado exitosamente:', result.data)
        // alert('✅ Usuario creado correctamente')
      }

      // Recargar tabla y cerrar modal
      fetchData()
      setIsModalOpen(false)
      setEditingUser(null)

    } catch (err: any) {
      console.error(err)
      alert('❌ Error: ' + err.message)
    }
  }

  // Filtrado inteligente
  const filteredUsers = users.filter(user => {
    const searchLower = searchTerm.toLowerCase()
    const matchesSearch =
      user.full_name?.toLowerCase().includes(searchLower) ||
      user.email?.toLowerCase().includes(searchLower)

    const matchesRole = roleFilter === 'all' || user.role === roleFilter

    // Filtro adicional: Mostrar solo activos o todos (opcional)
    // const matchesActive = user.is_active === true 

    return matchesSearch && matchesRole
  })

  // Helpers visuales para etiquetas
  const roleColors: any = {
    admin: 'bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-900 border-transparent',
    supervisor: 'bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-900/50',
    manager: 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-900/50',
    asistente: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50'
  }

  // Helper para mostrar ubicación (Tienda fija o Alcance múltiple)
  const getLocationLabel = (user: any) => {
    if (user.role === 'admin') return t('usuarios.modal.admin_access_title')

    if (user.role === 'supervisor') {
      if (!user.store_scope || user.store_scope.length === 0) return t('usuarios.table.location') + ': 0'
      if (user.store_scope.length === 1) return formatStoreName(user.store_scope[0])
      return `${user.store_scope.length} ${t('items.stores')}` // Ej: "3 Tiendas"
    }

    // Para managers y asistentes
    const store = stores.find(s => s.id === user.store_id)
    return store ? formatStoreName(store.name) : t('usuarios.table.location')
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
            <div className="flex items-center gap-3">
              {/* Desktop Search */}
              <div className="hidden md:flex relative group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500 group-focus-within:text-indigo-500 transition-colors" size={16} />
                <input
                  type="text"
                  placeholder={t('usuarios.search_placeholder')}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 pr-4 py-1.5 rounded-full bg-gray-100 dark:bg-slate-800 border border-transparent dark:border-slate-700 outline-none focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-900/50 text-sm font-bold text-gray-900 dark:text-white w-64 transition-all"
                />
              </div>

              {/* Desktop Filter */}
              <div className="hidden md:block">
                <select
                  value={roleFilter}
                  onChange={e => setRoleFilter(e.target.value)}
                  className="pl-3 pr-8 py-1.5 rounded-full bg-gray-100 dark:bg-slate-800 border-none outline-none focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-900/50 text-sm font-black text-gray-600 dark:text-slate-400 cursor-pointer"
                >
                  <option value="all" className="dark:bg-slate-900">{t('usuarios.roles.all')}</option>
                  <option value="admin" className="dark:bg-slate-900">{t('usuarios.roles.admin')}</option>
                  <option value="supervisor" className="dark:bg-slate-900">{t('usuarios.roles.supervisor')}</option>
                  <option value="manager" className="dark:bg-slate-900">{t('usuarios.roles.manager')}</option>
                  <option value="asistente" className="dark:bg-slate-900">{t('usuarios.roles.asistente')}</option>
                </select>
              </div>

              {/* View Toggle (Desktop) */}
              <div className="hidden md:flex bg-gray-100 dark:bg-slate-800 p-1 rounded-full mr-2">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-1.5 rounded-full transition-all ${viewMode === 'grid' ? 'bg-white dark:bg-slate-700 shadow-sm text-gray-900 dark:text-white ring-1 ring-black/5 dark:ring-white/10' : 'text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300'}`}
                  title="Grid View"
                >
                  <LayoutGrid size={16} />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-1.5 rounded-full transition-all ${viewMode === 'list' ? 'bg-white dark:bg-slate-700 shadow-sm text-gray-900 dark:text-white ring-1 ring-black/5 dark:ring-white/10' : 'text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300'}`}
                  title="List View"
                >
                  <List size={16} />
                </button>
              </div>

              <button
                onClick={() => setIsToastSyncOpen(true)}
                className="px-3 md:px-4 py-1.5 rounded-full bg-amber-400 dark:bg-amber-500 text-slate-900 font-black text-[10px] tracking-[0.05em] uppercase flex items-center justify-center gap-1.5 hover:bg-amber-300 transition-all active:scale-[0.98] shadow-md shadow-amber-500/20"
                title="Sincronizar Promociones desde Toast"
              >
                <Sparkles size={14} className="fill-slate-900" />
                <span className="hidden md:inline">Promociones Toast</span>
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
        <div className="p-4 md:p-8 max-w-7xl mx-auto pb-24 w-full">

          {/* Mobile Search & Filter */}
          <div className="md:hidden mb-6 space-y-3 w-full">
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
              {['all', 'admin', 'supervisor', 'manager', 'asistente'].map(role => (
                <button
                  key={role}
                  onClick={() => setRoleFilter(role)}
                  className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all border ${roleFilter === role
                    ? 'bg-gray-900 dark:bg-slate-100 text-white dark:text-slate-900 border-gray-900 dark:border-slate-100 shadow-md'
                    : 'bg-white dark:bg-slate-900 text-gray-500 dark:text-slate-500 border-gray-200 dark:border-slate-800'
                    }`}
                >
                  {role === 'all' ? t('usuarios.roles.all') : role}
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
                      {filteredUsers.map(user => (
                        <tr
                          key={user.id}
                          className="hover:bg-gray-50/50 dark:hover:bg-slate-800/50 transition-colors group cursor-pointer"
                          onClick={() => { setEditingUser(user); setIsModalOpen(true); }}
                        >
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-white font-black text-xs shadow-sm shrink-0 uppercase
                                ${user.role === 'admin' ? 'bg-slate-800 dark:bg-slate-200 dark:text-slate-900' :
                                  user.role === 'manager' ? 'bg-blue-600' :
                                    user.role === 'supervisor' ? 'bg-purple-600' :
                                      'bg-emerald-500'
                                }`}>
                                {user.full_name?.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <div className="font-bold text-gray-900 dark:text-white leading-tight">{user.full_name}</div>
                                <div className="text-[10px] text-gray-500 dark:text-slate-500 font-bold">{user.email}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-col gap-1 items-start">
                              <span className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wide border ${roleColors[user.role] || 'bg-gray-100 text-gray-500'}`}>
                                {user.role}
                              </span>
                              {user.position_type && (
                                <span className="text-[9px] font-bold text-gray-500 dark:text-slate-500 uppercase tracking-widest pl-1 mt-0.5">
                                  {t(`usuarios.modal.positions.${user.position_type}`)}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className="text-xs font-bold text-gray-600 dark:text-slate-400 flex items-center gap-1.5 whitespace-nowrap">
                              <MapPin size={12} className="text-gray-400 dark:text-slate-500" />
                              {getLocationLabel(user)}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-center">
                            {user.is_active ? (
                              <div className="w-2 h-2 rounded-full bg-green-500 mx-auto ring-4 ring-green-100" title={t('usuarios.table.active')} />
                            ) : (
                              <div className="w-2 h-2 rounded-full bg-gray-300 mx-auto" title={t('usuarios.table.inactive')} />
                            )}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingUser(user);
                                setIsModalOpen(true);
                              }}
                              className="text-gray-400 hover:text-blue-600 p-1.5 hover:bg-blue-50 rounded-lg transition-colors"
                            >
                              <MoreHorizontal size={18} />
                            </button>
                          </td>
                        </tr>
                      ))}
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
                  {filteredUsers.map(user => (
                    <div
                      key={user.id}
                      onClick={() => {
                        if (window.innerWidth < 768) {
                          setEditingUser(user);
                          setIsModalOpen(true);
                        }
                      }}
                      className={`bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm p-5 rounded-3xl shadow-sm border transition-all duration-200 hover:shadow-lg relative group active:scale-[0.98] cursor-pointer md:cursor-default
                        ${!user.is_active ? 'opacity-60 grayscale' : 'border-gray-100 dark:border-slate-800'}
                      `}
                    >
                      {/* Botón Editar Flotante (Visible siempre) */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingUser(user);
                          setIsModalOpen(true);
                        }}
                        className="absolute top-4 right-4 text-gray-400 hover:text-blue-600 p-2 hover:bg-blue-50 rounded-xl transition-colors md:opacity-0 md:group-hover:opacity-100"
                        title={t('usuarios.modal.edit_title')}
                      >
                        <MoreHorizontal size={20} />
                      </button>

                      {/* Info Principal */}
                      <div className="flex items-center gap-4 mb-5">
                        <div className={`w-12 h-12 md:w-14 md:h-14 rounded-2xl flex items-center justify-center text-white font-black text-xl md:text-2xl shadow-md shrink-0 uppercase
                          ${user.role === 'admin' ? 'bg-gradient-to-br from-slate-700 to-slate-900 dark:from-slate-100 dark:to-slate-300 dark:text-slate-900' :
                            user.role === 'manager' ? 'bg-gradient-to-br from-blue-500 to-blue-600' :
                              user.role === 'supervisor' ? 'bg-gradient-to-br from-purple-500 to-purple-600' :
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
                          {!user.is_active && (
                            <span className="inline-block mt-1 text-[9px] font-black text-red-500 bg-red-50 dark:bg-red-900/30 px-2 py-0.5 rounded-lg uppercase tracking-widest">
                              {t('usuarios.table.inactive').toUpperCase()}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Detalles Footer */}
                      <div className="space-y-3 pt-4 border-t border-dashed border-gray-100 dark:border-slate-800">
                        <div className="flex justify-between items-center">
                          <span className="text-[9px] font-black text-gray-400 dark:text-slate-600 uppercase tracking-[0.2em] flex items-center gap-1.5">
                            <User size={12} /> {t('usuarios.table.role').toUpperCase()}
                          </span>
                          <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border ${roleColors[user.role] || 'bg-gray-100'}`}>
                            {user.role}
                          </span>
                        </div>

                        {user.position_type && (
                          <div className="flex justify-between items-center">
                            <span className="text-[9px] font-black text-gray-400 dark:text-slate-600 uppercase tracking-[0.2em] flex items-center gap-1.5">
                              <Shield size={12} /> {t('usuarios.modal.fields.position_type').toUpperCase()}
                            </span>
                            <span className="text-xs font-bold text-gray-700 dark:text-slate-400 uppercase tracking-wider">
                              {t(`usuarios.modal.positions.${user.position_type}`)}
                            </span>
                          </div>
                        )}

                        <div className="flex justify-between items-center">
                          <span className="text-[9px] font-black text-gray-400 dark:text-slate-600 uppercase tracking-[0.2em] flex items-center gap-1.5">
                            <MapPin size={12} /> {t('usuarios.table.location').toUpperCase()}
                          </span>
                          <span className="text-[11px] font-bold text-gray-700 dark:text-slate-400 truncate max-w-[150px] text-right" title={getLocationLabel(user)}>
                            {getLocationLabel(user)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
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