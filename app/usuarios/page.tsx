'use client'

import { useEffect, useState } from 'react'
import Sidebar from '@/components/Sidebar'

export default function UsuariosPage() {
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [selectedUser, setSelectedUser] = useState<any>(null)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      
      // Query simple sin foreign keys problemáticas
      const usersRes = await fetch(
  `${url}/rest/v1/users?select=*&order=full_name.asc`,
        {
          headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` }
        }
      )
      const usersData = await usersRes.json()
      setUsers(Array.isArray(usersData) ? usersData : [])
      
      setLoading(false)
    } catch (err) {
      console.error('Error:', err)
      setLoading(false)
    }
  }

  const roleColors: any = {
    admin: 'bg-red-100 text-red-800',
    supervisor: 'bg-purple-100 text-purple-800',
    manager: 'bg-blue-100 text-blue-800',
    user: 'bg-green-100 text-green-800'
  }

  const roleIcons: any = {
    admin: '👑',
    supervisor: '👔',
    manager: '📊',
    user: '👤'
  }

  const roleLabels: any = {
    admin: 'Admin',
    supervisor: 'Supervisor',
    manager: 'Manager',
    user: 'Asistente'
  }

  const filteredUsers = users.filter(user => {
    const matchesSearch = 
      user.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email?.toLowerCase().includes(searchTerm.toLowerCase())
    
    const matchesRole = roleFilter === 'all' || user.role === roleFilter
    
    return matchesSearch && matchesRole
  })

  const roleStats = {
    admin: users.filter(u => u.role === 'admin').length,
    supervisor: users.filter(u => u.role === 'supervisor').length,
    manager: users.filter(u => u.role === 'manager').length,
    user: users.filter(u => u.role === 'user').length
  }

  if (loading) {
    return (
      <div className="flex">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-6xl mb-4">👥</div>
            <p className="text-gray-600">Cargando usuarios...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      
      <main className="flex-1 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Usuarios</h1>
            <p className="text-gray-600 mt-2">Gestión de cuentas del sistema</p>
          </div>

          {/* Stats Summary */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
            <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-gray-600">
              <p className="text-sm font-medium text-gray-600">Total Usuarios</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{users.length}</p>
            </div>
            <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-red-600">
              <p className="text-sm font-medium text-gray-600">👑 Admins</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{roleStats.admin}</p>
            </div>
            <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-purple-600">
              <p className="text-sm font-medium text-gray-600">👔 Supervisores</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{roleStats.supervisor}</p>
            </div>
            <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-blue-600">
              <p className="text-sm font-medium text-gray-600">📊 Managers</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{roleStats.manager}</p>
            </div>
            <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-green-600">
              <p className="text-sm font-medium text-gray-600">👤 Asistentes</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{roleStats.user}</p>
            </div>
          </div>

          {/* Filters */}
          <div className="bg-white rounded-xl shadow-md p-6 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Buscar usuario
                </label>
                <input
                  type="text"
                  placeholder="Nombre o email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Filtrar por rol
                </label>
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-red-500 focus:border-transparent"
                >
                  <option value="all">Todos los roles</option>
                  <option value="admin">👑 Admins</option>
                  <option value="supervisor">👔 Supervisores</option>
                  <option value="manager">📊 Managers</option>
                  <option value="user">👤 Asistentes</option>
                </select>
              </div>
            </div>
          </div>

          {/* Users Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredUsers.map((user) => (
              <div
                key={user.id}
                className="bg-white rounded-xl shadow-md hover:shadow-lg transition-shadow overflow-hidden"
              >
                <div className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <h3 className="text-lg font-bold text-gray-900 mb-2">
                        {user.full_name}
                      </h3>
                      <p className="text-sm text-gray-600 mb-3">{user.email}</p>
                    </div>
                  </div>

                  {/* Badges */}
                  <div className="flex flex-wrap gap-2 mb-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${roleColors[user.role]}`}>
                      {roleIcons[user.role]} {roleLabels[user.role]}
                    </span>
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      user.is_active 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {user.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>

                  {/* Info */}
                  <div className="space-y-2 text-sm mb-4">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Creado:</span>
                      <span className="font-medium text-gray-900">
                        {new Date(user.created_at).toLocaleDateString('es-MX')}
                      </span>
                    </div>
                    {user.phone && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Teléfono:</span>
                        <span className="font-medium text-gray-900">{user.phone}</span>
                      </div>
                    )}
                  </div>

                  {/* Details Button */}
                  <button
                    onClick={() => setSelectedUser(selectedUser?.id === user.id ? null : user)}
                    className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition-colors"
                  >
                    {selectedUser?.id === user.id ? 'Ocultar' : 'Ver ID'}
                  </button>

                  {/* Extended Details */}
                  {selectedUser?.id === user.id && (
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <p className="text-xs text-gray-500 mb-1">ID de Usuario</p>
                      <p className="font-mono text-xs text-gray-700 break-all">{user.id}</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {filteredUsers.length === 0 && (
            <div className="text-center py-12">
              <div className="text-6xl mb-4">🔍</div>
              <p className="text-gray-600">No se encontraron usuarios</p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}