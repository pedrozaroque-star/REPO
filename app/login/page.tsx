'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (!email || !password) {
        setError('Por favor ingresa email y contraseña')
        setLoading(false)
        return
      }

      if (!email.endsWith('@tacosgavilan.com')) {
        setError('Solo se permiten correos @tacosgavilan.com')
        setLoading(false)
        return
      }

      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      
      const response = await fetch(`${url}/rest/v1/users?email=eq.${email}&select=*`, {
        headers: {
          'apikey': key,
          'Authorization': `Bearer ${key}`
        }
      })

      if (!response.ok) {
        throw new Error('Error al verificar usuario')
      }

      const users = await response.json()

      if (users.length === 0) {
        setError('Usuario no encontrado')
        setLoading(false)
        return
      }

      const user = users[0]

      if (!user.is_active) {
        setError('Usuario inactivo. Contacta al administrador')
        setLoading(false)
        return
      }

      localStorage.setItem('teg_user', JSON.stringify({
        id: user.id,
        email: user.email,
        name: user.full_name,
        role: user.role
      }))

      router.push('/dashboard')

    } catch (err: any) {
      setError(err.message || 'Error al iniciar sesión')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-yellow-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img 
            src="/logo.png" 
            alt="Tacos Gavilan" 
            className="h-24 mx-auto mb-4"
          />
          <img 
            src="/ya esta.png" 
            alt="Ya está" 
            className="h-12 mx-auto mb-4"
          />
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Sistema TEG
          </h1>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">
            Iniciar Sesión
          </h2>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                Correo Electrónico
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none transition text-gray-900"
                placeholder="tu@email.com"
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                Contraseña
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none transition text-gray-900"
                placeholder="••••••••"
                required
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Iniciando sesión...' : 'Iniciar Sesión'}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-gray-500">
            <p>¿Olvidaste tu contraseña?</p>
            <a href="#" className="text-red-600 hover:text-red-700 font-medium">
              Recuperar acceso
            </a>
          </div>
        </div>

        <div className="text-center mt-8 text-sm text-gray-500">
          Sistema TEG v2.0 - 2025
        </div>
      </div>
    </div>
  )
}