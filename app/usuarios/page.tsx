'use client'

import { useEffect, useState } from 'react'
import Sidebar from '@/components/Sidebar'
import UserModal from '@/components/UserModal'
import { supabase } from '@/lib/supabase'

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
      if (user.store_scope.length === 1) return user.store_scope[0]
      return `${user.store_scope.length} Tiendas` // Ej: "3 Tiendas"
    }

    // Para managers y asistentes
    const store = stores.find(s => s.id === user.store_id)
    return store ? store.name : 'Sin Tienda'
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 p-8 md:ml-64">
        
        {/* Header con gradiente sutil */}
        <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-black text-gray-900 tracking-tight">Usuarios</h1>
            <p className="text-gray-500 mt-1">Administración de personal y permisos</p>
          </div>
          <button 
            onClick={() => { setEditingUser(null); setIsModalOpen(true); }}
            className="bg-gray-900 text-white px-6 py-3 rounded-xl font-bold hover:bg-black shadow-lg hover:-translate-y-1 transition-all flex items-center gap-2"
          >
            <span>+</span> Nuevo Usuario
          </button>
        </div>

        {/* Barra de Herramientas */}
        <div className="bg-white p-4 rounded-2xl shadow-sm mb-8 flex flex-col md:flex-row gap-4 border border-gray-100">
          <div className="flex-1 relative">
            <span className="absolute left-3 top-3 text-gray-400">🔍</span>
            <input 
              type="text" 
              placeholder="Buscar por nombre, email..." 
              value={searchTerm} 
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border text-gray-900  bg-white border-gray-200 rounded-xl focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all"
            />
          </div>
          <div className="md:w-64">
            <select 
              value={roleFilter} 
              onChange={e => setRoleFilter(e.target.value)}
              className="w-full border  text-gray-900  bg-white border-gray-200 p-2.5 rounded-xl focus:ring-2 focus:ring-gray-900 outline-none bg-white cursor-pointer"
            >
              <option value="all">Todos los Roles</option>
              <option value="admin">👮‍♂️ Admin</option>
              <option value="supervisor">👀 Supervisor</option>
              <option value="manager">👔 Manager</option>
              <option value="asistente">👷 Asistente</option>
            </select>
          </div>
        </div>

        {/* Grid de Tarjetas */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
            {[1,2,3,4,5,6].map(i => (
              <div key={i} className="h-48 bg-gray-200 rounded-2xl"></div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredUsers.map(user => (
              <div 
                key={user.id} 
                className={`bg-white p-6 rounded-2xl shadow-sm border transition-all duration-200 hover:shadow-md relative group
                  ${!user.is_active ? 'opacity-60 border-gray-100 grayscale' : 'border-gray-200'}
                `}
              >
                {/* Botón Editar Flotante */}
                <button 
                  onClick={() => { setEditingUser(user); setIsModalOpen(true); }}
                  className="absolute top-4 right-4 text-gray-400 hover:text-blue-600 p-2 hover:bg-blue-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                  title="Editar Usuario"
                >
                  ✏️
                </button>
                
                {/* Info Principal */}
                <div className="flex items-center gap-4 mb-5">
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-white font-bold text-2xl shadow-md
                    ${user.role === 'admin' ? 'bg-gradient-to-br from-slate-700 to-slate-900' : 
                      user.role === 'manager' ? 'bg-gradient-to-br from-blue-500 to-blue-600' : 
                      user.role === 'supervisor' ? 'bg-gradient-to-br from-purple-500 to-purple-600' :
                      'bg-gradient-to-br from-emerald-400 to-emerald-600'
                    }`}>
                    {user.full_name?.charAt(0).toUpperCase()}
                  </div>
                  <div className="overflow-hidden">
                    <h3 className="font-bold text-gray-900 text-lg truncate" title={user.full_name}>
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
                <div className="space-y-3 pt-4 border-t border-gray-50">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Rol</span>
                    <span className={`px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wide ${roleColors[user.role] || 'bg-gray-100'}`}>
                      {user.role}
                    </span>
                  </div>
                  
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Ubicación</span>
                    <span className="text-xs font-medium text-gray-700 truncate max-w-[150px] text-right" title={getLocationLabel(user)}>
                      {getLocationLabel(user)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

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