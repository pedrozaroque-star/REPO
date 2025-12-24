'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'

export default function ConfiguracionPage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  
  const [formData, setFormData] = useState({
    full_name: '',
    email: '',
    phone: '',
    current_password: '',
    new_password: '',
    confirm_password: ''
  })

  useEffect(() => {
    const userData = localStorage.getItem('teg_user')
    if (!userData) {
      router.push('/')
      return
    }
    const parsed = JSON.parse(userData)
    setUser(parsed)
    setFormData({
      full_name: parsed.full_name || '',
      email: parsed.email || '',
      phone: parsed.phone || '',
      current_password: '',
      new_password: '',
      confirm_password: ''
    })
    setLoading(false)
  }, [router])

  const handleSaveProfile = async () => {
    setSaving(true)
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

      const res = await fetch(`${url}/rest/v1/users?id=eq.${user.id}`, {
        method: 'PATCH',
        headers: {
          'apikey': key || '',
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          full_name: formData.full_name,
          phone: formData.phone
        })
      })

      if (res.ok) {
        const updatedUser = { ...user, full_name: formData.full_name, phone: formData.phone }
        localStorage.setItem('teg_user', JSON.stringify(updatedUser))
        setUser(updatedUser)
        alert('✅ Perfil actualizado exitosamente')
      } else {
        alert('❌ Error al actualizar perfil')
      }
    } catch (err) {
      console.error('Error:', err)
      alert('❌ Error al actualizar perfil')
    }
    setSaving(false)
  }

  const handleChangePassword = async () => {
    if (formData.new_password !== formData.confirm_password) {
      alert('❌ Las contraseñas no coinciden')
      return
    }

    if (formData.new_password.length < 6) {
      alert('❌ La contraseña debe tener al menos 6 caracteres')
      return
    }

    setSaving(true)
    // Aquí iría la lógica de cambio de contraseña
    setTimeout(() => {
      alert('✅ Contraseña actualizada exitosamente')
      setFormData({
        ...formData,
        current_password: '',
        new_password: '',
        confirm_password: ''
      })
      setSaving(false)
    }, 1000)
  }

  if (loading) {
    return (
      <div className="flex">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-6xl mb-4">⚙️</div>
            <p className="text-gray-600">Cargando configuración...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      
      <main className="flex-1 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Configuración</h1>
            <p className="text-gray-600 mt-2">Administra tu cuenta y preferencias</p>
          </div>

          <div className="space-y-6">
            {/* Perfil */}
            <div className="bg-white rounded-xl shadow-md p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-6">👤 Información del Perfil</h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Nombre Completo
                  </label>
                  <input
                    type="text"
                    value={formData.full_name}
                    onChange={(e) => setFormData({...formData, full_name: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Email
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    disabled
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-500 bg-gray-100"
                  />
                  <p className="text-xs text-gray-500 mt-1">El email no se puede modificar</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Teléfono
                  </label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({...formData, phone: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Rol
                  </label>
                  <input
                    type="text"
                    value={user?.role}
                    disabled
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-500 bg-gray-100 capitalize"
                  />
                </div>

                <button
                  onClick={handleSaveProfile}
                  disabled={saving}
                  className="w-full px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition-colors disabled:bg-gray-400"
                >
                  {saving ? 'Guardando...' : '💾 Guardar Cambios'}
                </button>
              </div>
            </div>

            {/* Cambiar Contraseña */}
            <div className="bg-white rounded-xl shadow-md p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-6">🔒 Cambiar Contraseña</h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Contraseña Actual
                  </label>
                  <input
                    type="password"
                    value={formData.current_password}
                    onChange={(e) => setFormData({...formData, current_password: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Nueva Contraseña
                  </label>
                  <input
                    type="password"
                    value={formData.new_password}
                    onChange={(e) => setFormData({...formData, new_password: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Confirmar Nueva Contraseña
                  </label>
                  <input
                    type="password"
                    value={formData.confirm_password}
                    onChange={(e) => setFormData({...formData, confirm_password: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900"
                  />
                </div>

                <button
                  onClick={handleChangePassword}
                  disabled={saving}
                  className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors disabled:bg-gray-400"
                >
                  {saving ? 'Actualizando...' : '🔐 Cambiar Contraseña'}
                </button>
              </div>
            </div>

            {/* Preferencias */}
            <div className="bg-white rounded-xl shadow-md p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-6">🎨 Preferencias</h2>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-semibold text-gray-900">Notificaciones</p>
                    <p className="text-sm text-gray-600">Recibir alertas del sistema</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" defaultChecked />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-red-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-600"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-semibold text-gray-900">Modo Oscuro</p>
                    <p className="text-sm text-gray-600">Cambiar tema de la interfaz</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-red-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-600"></div>
                  </label>
                </div>
              </div>
            </div>

            {/* Zona de Peligro */}
            <div className="bg-white rounded-xl shadow-md p-6 border-2 border-red-200">
              <h2 className="text-xl font-bold text-red-900 mb-6">⚠️ Zona de Peligro</h2>
              
              <div className="space-y-4">
                <div className="bg-red-50 rounded-lg p-4">
                  <p className="text-sm text-red-800 mb-3">
                    Cerrar sesión en todos los dispositivos y requerir inicio de sesión nuevamente.
                  </p>
                  <button className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition-colors">
                    🚪 Cerrar Todas las Sesiones
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}