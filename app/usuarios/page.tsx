'use client'

import { useEffect, useState } from 'react'
import { Users, Search, Plus, Filter, User, MoreHorizontal, MapPin } from 'lucide-react'

import UserModal from '@/components/UserModal'
import { getSupabaseClient, formatStoreName } from '@/lib/supabase'

export default function UsuariosPage() {
  const [users, setUsers] = useState<any[]>([])
  const [stores, setStores] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')

  // Estado para el Modal
  const [isModalOpen, setIsModalOpen] = useState(false)
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
      const supabase = await getSupabaseClient()

      // 1. Preparar datos limpios según el rol
      const role = formData.role

      // Reglas de negocio:
      // - Supervisores usan store_scope (array), NO store_id.
      // - Managers/Asistentes usan store_id, NO store_scope.
      const cleanData = {
        full_name: formData.full_name,
        role: role,
        email: formData.email, // Importante para updates visuales
        is_active: formData.is_active,
        // Lógica condicional de tiendas:
        store_id: ['manager', 'asistente'].includes(role) && formData.store_id
          ? parseInt(formData.store_id)
          : null,
        store_scope: role === 'supervisor'
          ? formData.store_scope // Array de nombres ['LYNWOOD', 'BELL']
          : null
      }

      if (isEdit) {
        // A. ACTUALIZAR USUARIO EXISTENTE

        // 1. Actualizar tabla visual (public.users)
        const { error } = await supabase
          .from('users')
          .update(cleanData)
          .eq('id', formData.id)

        if (error) throw error

        // 2. Cambiar contraseña (si se escribió algo en el campo)
        if (formData.password && formData.password.trim() !== '') {
          // Opción A: Usar la función RPC segura (Recomendada)
          const { error: rpcError } = await supabase.rpc('admin_reset_password_by_email', {
            target_email: formData.email,
            new_password: formData.password
          })

          // Opción B (Fallback): Si no tienes la RPC, podrías intentar update directo si auth lo permite
          // pero la RPC es lo ideal.
          if (rpcError) console.warn('No se pudo actualizar password via RPC:', rpcError.message)
        }

        alert('✅ Usuario actualizado correctamente')

      } else {
        // B. CREAR NUEVO USUARIO

        // Usamos la RPC maestra que crea en auth.users y public.users al mismo tiempo
        const { data, error } = await supabase.rpc('create_new_user', {
          email: formData.email,
          password: formData.password,
          full_name: formData.full_name,
          role: formData.role,
          store_id: cleanData.store_id
          // Nota: Si tu RPC 'create_new_user' no acepta store_scope, 
          // el update posterior se encargará de guardarlo.
        })

        if (error) throw error

        // Hack de Seguridad: Si la RPC no guardó el store_scope (porque es un campo nuevo),
        // hacemos un update inmediato para asegurarnos que el supervisor tenga sus tiendas.
        if (role === 'supervisor' && cleanData.store_scope) {
          const { error: scopeError } = await supabase
            .from('users')
            .update({ store_scope: cleanData.store_scope })
            .eq('email', formData.email)

          if (scopeError) console.error('Error guardando scope:', scopeError)
        }

        alert('✅ Usuario creado exitosamente')
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
    admin: 'bg-slate-800 text-white',
    supervisor: 'bg-purple-100 text-purple-700 border-purple-200 border',
    manager: 'bg-blue-100 text-blue-700 border-blue-200 border',
    asistente: 'bg-emerald-100 text-emerald-700 border-emerald-200 border'
  }

  // Helper para mostrar ubicación (Tienda fija o Alcance múltiple)
  const getLocationLabel = (user: any) => {
    if (user.role === 'admin') return 'Acceso Total'

    if (user.role === 'supervisor') {
      if (!user.store_scope || user.store_scope.length === 0) return 'Sin asignación'
      if (user.store_scope.length === 1) return formatStoreName(user.store_scope[0])
      return `${user.store_scope.length} Tiendas` // Ej: "3 Tiendas"
    }

    // Para managers y asistentes
    const store = stores.find(s => s.id === user.store_id)
    return store ? formatStoreName(store.name) : 'Sin Tienda'
  }

  return (
    <div className="flex bg-transparent font-sans w-full animate-in fade-in duration-500">
      <main className="flex-1 flex flex-col h-full w-full relative">

        {/* STICKY HEADER - Mobile & Desktop */}
        <div className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-20 shrink-0 transition-all top-[63px]">
          <div className="max-w-7xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between gap-4">

            {/* Title Area */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600">
                <Users size={18} />
              </div>
              <div>
                <h1 className="text-lg md:text-xl font-black text-gray-900 tracking-tight leading-none">Usuarios</h1>
                <p className="hidden md:block text-xs text-gray-400 font-medium">Gestión de personal</p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              {/* Desktop Search */}
              <div className="hidden md:flex relative group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-indigo-500 transition-colors" size={16} />
                <input
                  type="text"
                  placeholder="Buscar usuario..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 pr-4 py-1.5 rounded-full bg-gray-100 border-none outline-none focus:ring-2 focus:ring-indigo-200 text-sm font-medium w-64 transition-all"
                />
              </div>

              {/* Desktop Filter */}
              <div className="hidden md:block">
                <select
                  value={roleFilter}
                  onChange={e => setRoleFilter(e.target.value)}
                  className="pl-3 pr-8 py-1.5 rounded-full bg-gray-100 border-none outline-none focus:ring-2 focus:ring-indigo-200 text-sm font-bold text-gray-600 cursor-pointer"
                >
                  <option value="all">Todos</option>
                  <option value="admin">Admin</option>
                  <option value="supervisor">Supervisor</option>
                  <option value="manager">Manager</option>
                  <option value="asistente">Asistente</option>
                </select>
              </div>

              <button
                onClick={() => { setEditingUser(null); setIsModalOpen(true); }}
                className="w-8 h-8 md:w-auto md:h-auto md:px-4 md:py-1.5 rounded-full bg-gray-900 text-white flex items-center justify-center gap-2 hover:bg-black transition-transform active:scale-95 shadow-lg shadow-gray-200"
              >
                <Plus size={16} strokeWidth={3} />
                <span className="hidden md:inline font-bold text-xs tracking-wide">NUEVO USUARIO</span>
              </button>
            </div>
          </div>
        </div>

        {/* MAIN CONTENT */}
        <div className="p-4 md:p-8 max-w-7xl mx-auto pb-24 w-full">

          {/* Mobile Search & Filter */}
          <div className="md:hidden sticky top-0 z-10 -mt-2 mb-6 space-y-3 w-full max-w-[calc(100vw-2rem)] overflow-hidden">
            <div className="relative group shadow-lg shadow-gray-200/50 rounded-full">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="Buscar por nombre..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-11 pr-4 py-3 rounded-full bg-white border border-gray-100 outline-none focus:border-indigo-300 text-sm font-bold text-gray-900 placeholder:text-gray-400"
              />
            </div>

            <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar w-full">
              {['all', 'admin', 'supervisor', 'manager', 'asistente'].map(role => (
                <button
                  key={role}
                  onClick={() => setRoleFilter(role)}
                  className={`px-4 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-colors border ${roleFilter === role
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-500 border-gray-200'
                    }`}
                >
                  {role === 'all' ? 'Todos' : role.charAt(0).toUpperCase() + role.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Grid de Tarjetas */}
          {loading ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-pulse">
              {[1, 2, 3, 4, 5, 6].map(i => (
                <div key={i} className="h-40 bg-gray-200 rounded-3xl"></div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {filteredUsers.map(user => (
                <div
                  key={user.id}
                  onClick={() => {
                    // On mobile make the whole card clickable for edit
                    if (window.innerWidth < 768) {
                      setEditingUser(user);
                      setIsModalOpen(true);
                    }
                  }}
                  className={`bg-white p-5 rounded-3xl shadow-[0_2px_15px_-5px_rgba(0,0,0,0.05)] border transition-all duration-200 hover:shadow-lg relative group active:scale-[0.98] cursor-pointer md:cursor-default
                    ${!user.is_active ? 'opacity-60 border-gray-100 grayscale' : 'border-gray-100'}
                  `}
                >
                  {/* Botón Editar Flotante (Desktop only) */}
                  {/* Botón Editar Flotante (Visible siempre) */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingUser(user);
                      setIsModalOpen(true);
                    }}
                    className="absolute top-4 right-4 text-gray-400 hover:text-blue-600 p-2 hover:bg-blue-50 rounded-xl transition-colors md:opacity-0 md:group-hover:opacity-100"
                    title="Editar Usuario"
                  >
                    <MoreHorizontal size={20} />
                  </button>

                  {/* Info Principal */}
                  <div className="flex items-center gap-4 mb-5">
                    <div className={`w-12 h-12 md:w-14 md:h-14 rounded-2xl flex items-center justify-center text-white font-bold text-xl md:text-2xl shadow-md shrink-0
                      ${user.role === 'admin' ? 'bg-gradient-to-br from-slate-700 to-slate-900' :
                        user.role === 'manager' ? 'bg-gradient-to-br from-blue-500 to-blue-600' :
                          user.role === 'supervisor' ? 'bg-gradient-to-br from-purple-500 to-purple-600' :
                            'bg-gradient-to-br from-emerald-400 to-emerald-600'
                      }`}>
                      {user.full_name?.charAt(0).toUpperCase()}
                    </div>
                    <div className="overflow-hidden min-w-0">
                      <h3 className="font-bold text-gray-900 text-base md:text-lg truncate leading-tight" title={user.full_name}>
                        {user.full_name}
                      </h3>
                      <p className="text-xs text-gray-500 truncate" title={user.email}>
                        {user.email}
                      </p>
                      {!user.is_active && (
                        <span className="inline-block mt-1 text-[10px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">
                          INACTIVO
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Detalles Footer */}
                  <div className="space-y-3 pt-4 border-t border-dashed border-gray-100">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                        <User size={12} /> Rol
                      </span>
                      <span className={`px-2.5 py-1 rounded-lg text-[10px] md:text-xs font-black uppercase tracking-wide ${roleColors[user.role] || 'bg-gray-100'}`}>
                        {user.role}
                      </span>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                        <MapPin size={12} /> Ubicación
                      </span>
                      <span className="text-xs font-bold text-gray-700 truncate max-w-[150px] text-right" title={getLocationLabel(user)}>
                        {getLocationLabel(user)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Modal Inteligente */}
        <UserModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSave={handleSaveUser}
          stores={stores}
          initialData={editingUser}
        />
      </main>
    </div>
  )
}