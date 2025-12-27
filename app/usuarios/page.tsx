'use client'

import { useEffect, useState } from 'react'
import Sidebar from '@/components/Sidebar'
import UserModal from '@/components/UserModal' // Asegúrate de tener este componente creado
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
      const { data: usersData } = await supabase.from('users').select('*').order('full_name')
      const { data: storesData } = await supabase.from('stores').select('id, name').order('name')
      
      setUsers(usersData || [])
      setStores(storesData || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  // Guardar Usuario (Crear o Editar)
  const handleSaveUser = async (formData: any, isEdit: boolean) => {
    try {
      if (isEdit) {
        // 1. Editar Datos Visuales
        const { error } = await supabase.from('users').update({
          full_name: formData.full_name,
          role: formData.role,
          store_id: formData.store_id ? parseInt(formData.store_id) : null
        }).eq('id', formData.id)

        if (error) throw error

        // 2. Cambiar Contraseña (si se escribió) - Usando la función RPC por Email
        if (formData.password) {
          const { error: rpcError } = await supabase.rpc('admin_reset_password_by_email', {
            target_email: formData.email,
            new_password: formData.password
          })
          if (rpcError) throw rpcError
        }
        alert('✅ Usuario actualizado correctamente')
      } else {
        // 3. Crear Nuevo (Usando la función RPC Maestra)
        const { error } = await supabase.rpc('create_new_user', {
          email: formData.email,
          password: formData.password,
          full_name: formData.full_name,
          role: formData.role,
          store_id: formData.store_id ? parseInt(formData.store_id) : null
        })
        if (error) throw error
        alert('✅ Usuario creado correctamente')
      }
      
      fetchData()
      setIsModalOpen(false)
      setEditingUser(null)
    } catch (err: any) {
      console.error(err)
      alert('❌ Error: ' + err.message)
    }
  }

  // Filtrado
  const filteredUsers = users.filter(user => {
    const matchesSearch = user.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          user.email?.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesRole = roleFilter === 'all' || user.role === roleFilter
    return matchesSearch && matchesRole
  })

  // Helpers visuales
  const roleColors: any = {
    admin: 'bg-red-100 text-red-800',
    manager: 'bg-blue-100 text-blue-800',
    supervisor: 'bg-purple-100 text-purple-800',
    user: 'bg-green-100 text-green-800'
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 p-8 md:ml-64">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Usuarios</h1>
            <p className="text-gray-600">Gestión de accesos y personal</p>
          </div>
          <button 
            onClick={() => { setEditingUser(null); setIsModalOpen(true); }}
            className="bg-gray-900 text-white px-6 py-3 rounded-xl font-bold hover:bg-black shadow-lg hover:-translate-y-1 transition-all"
          >
            + Nuevo Usuario
          </button>
        </div>

        {/* Filtros */}
        <div className="bg-white p-4 rounded-xl shadow-sm mb-6 flex flex-col md:flex-row gap-4 border border-gray-100">
          <div className="flex-1">
            <input 
              type="text" placeholder="🔍 Buscar por nombre o email..." 
              value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
              className="w-full border border-gray-300 p-2 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <div>
            <select 
              value={roleFilter} onChange={e => setRoleFilter(e.target.value)}
              className="w-full border border-gray-300 p-2 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
            >
              <option value="all">Todos los Roles</option>
              <option value="admin">Admin</option>
              <option value="supervisor">Supervisor</option>
              <option value="manager">Manager</option>
              <option value="user">Asistente</option>
            </select>
          </div>
        </div>

        {/* Grid de Usuarios */}
        {loading ? (
          <div className="text-center py-10 text-gray-500">Cargando...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredUsers.map(user => (
              <div key={user.id} className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 relative group hover:shadow-md transition-shadow">
                <button 
                  onClick={() => { setEditingUser(user); setIsModalOpen(true); }}
                  className="absolute top-4 right-4 text-gray-400 hover:text-blue-600 p-2 hover:bg-blue-50 rounded-lg transition-colors"
                  title="Editar"
                >
                  ✏️
                </button>
                
                <div className="flex items-center gap-4 mb-4">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-xl shadow-sm ${
                    user.role === 'admin' ? 'bg-red-500' : 
                    user.role === 'manager' ? 'bg-blue-500' : 'bg-green-500'
                  }`}>
                    {user.full_name?.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900 leading-tight">{user.full_name}</h3>
                    <p className="text-xs text-gray-500">{user.email}</p>
                  </div>
                </div>

                <div className="flex justify-between items-center mt-4 pt-4 border-t border-gray-50">
                  <span className={`px-2 py-1 rounded text-[10px] font-black uppercase tracking-wide ${roleColors[user.role] || 'bg-gray-100'}`}>
                    {user.role}
                  </span>
                  <span className="text-xs text-gray-500 font-medium">
                    {stores.find(s => s.id === user.store_id)?.name || 'Sin Tienda'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Modal de Creación/Edición */}
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