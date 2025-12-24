'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

      // Buscar usuario por email primero
      const response = await fetch(
        `${url}/rest/v1/users?email=eq.${encodeURIComponent(formData.email)}&select=*`,
        {
          headers: {
            'apikey': key || '',
            'Authorization': `Bearer ${key}`
          }
        }
      )

      const users = await response.json()

      if (users && users.length > 0) {
        const user = users[0]
        
        // Verificar contraseña
        if (user.password !== formData.password) {
          setError('Email o contraseña incorrectos')
          setLoading(false)
          return
        }

        // Verificar usuario activo
        if (!user.is_active) {
          setError('Usuario inactivo. Contacta al administrador.')
          setLoading(false)
          return
        }

        localStorage.setItem('teg_user', JSON.stringify(user))
        router.push('/dashboard')
      } else {
        setError('Email o contraseña incorrectos')
      }
    } catch (err) {
      setError('Error al conectar con el servidor')
      console.error(err)
    }

    setLoading(false)
  }

  return (
    <div className="min-h-screen flex">
      {/* Left Side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-red-600 via-red-700 to-red-900 p-12 flex-col justify-between relative overflow-hidden">
        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-0 left-0 w-96 h-96 bg-white rounded-full -translate-x-1/2 -translate-y-1/2"></div>
          <div className="absolute bottom-0 right-0 w-96 h-96 bg-white rounded-full translate-x-1/2 translate-y-1/2"></div>
        </div>

        <div className="relative z-10">
          <div className="flex items-center space-x-4 mb-8">
            <div className="text-6xl">🌮</div>
            <div>
              <h1 className="text-4xl font-bold text-white">Sistema TEG</h1>
              <p className="text-red-100">Tacos Gavilan</p>
            </div>
          </div>
          
          <div className="space-y-6 text-white">
            <div className="flex items-start space-x-4">
              <div className="text-3xl">📊</div>
              <div>
                <h3 className="font-bold text-xl mb-2">Gestión Completa</h3>
                <p className="text-red-100">15 tiendas, 54 usuarios y más de 600 registros históricos</p>
              </div>
            </div>
            
            <div className="flex items-start space-x-4">
              <div className="text-3xl">📈</div>
              <div>
                <h3 className="font-bold text-xl mb-2">Reportes Avanzados</h3>
                <p className="text-red-100">Estadísticas en tiempo real con exportación a Excel</p>
              </div>
            </div>
            
            <div className="flex items-start space-x-4">
              <div className="text-3xl">💬</div>
              <div>
                <h3 className="font-bold text-xl mb-2">Feedback de Clientes</h3>
                <p className="text-red-100">Sistema NPS con análisis por área</p>
              </div>
            </div>
          </div>
        </div>

        <div className="relative z-10 text-red-100 text-sm">
          <p>© 2024 Tacos Gavilan. Sistema v1.0.0</p>
          <p className="mt-1">Desarrollado con ❤️ para ofrecer el mejor servicio</p>
        </div>
      </div>

      {/* Right Side - Login Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-gray-50">
        <div className="w-full max-w-md">
          <div className="text-center mb-8 lg:hidden">
            <div className="text-6xl mb-4">🌮</div>
            <h1 className="text-3xl font-bold text-gray-900">Sistema TEG</h1>
            <p className="text-gray-600">Tacos Gavilan</p>
          </div>

          <div className="bg-white rounded-2xl shadow-xl p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Iniciar Sesión</h2>
            <p className="text-gray-600 mb-6">Ingresa tus credenciales para acceder</p>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({...formData, email: e.target.value})}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent text-gray-900"
                  placeholder="usuario@tacosgavilan.com"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                  Contraseña
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  value={formData.password}
                  onChange={(e) => setFormData({...formData, password: e.target.value})}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent text-gray-900"
                  placeholder="••••••••"
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors disabled:bg-gray-400"
              >
                {loading ? 'Ingresando...' : 'Ingresar'}
              </button>
            </form>

            <div className="mt-6 pt-6 border-t border-gray-200">
              <p className="text-sm text-gray-600 mb-3">Usuarios de prueba:</p>
              <div className="space-y-2 text-xs text-gray-500">
                <div className="flex justify-between">
                  <span>Admin:</span>
                  <span className="font-mono">roque@tacosgavilan.com / admin123</span>
                </div>
                <div className="flex justify-between">
                  <span>Supervisor:</span>
                  <span className="font-mono">carlos@tacosgavilan.com / super123</span>
                </div>
              </div>
            </div>
          </div>

          <p className="text-center text-sm text-gray-600 mt-6">
            ¿Problemas para acceder? Contacta al administrador
          </p>
        </div>
      </div>
    </div>
  )
}