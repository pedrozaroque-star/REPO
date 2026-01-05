'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Eye, EyeOff } from 'lucide-react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: email.trim(),
          password: password
        })
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Error al iniciar sesión')
        setLoading(false)
        return
      }

      // Guardar token y usuario en localStorage
      localStorage.setItem('teg_token', data.token)
      localStorage.setItem('teg_user', JSON.stringify(data.user))

      // Redirigir según el rol
      const userRole = data.user.role?.toLowerCase()
      if (userRole === 'asistente') {
        router.push('/checklists')
      } else {
        router.push('/dashboard')
      }

    } catch (err) {
      console.error('Error inesperado:', err)
      setError('Error inesperado. Por favor intenta de nuevo.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-neutral-900 flex flex-col items-center justify-center p-4 relative overflow-hidden">

      {/* Fondo decorativo sutil */}
      <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>

      <div className="w-full max-w-md z-10">

        {/* LOGO Y ESLOGAN */}
        <div className="text-center mb-8 flex flex-col items-center">
          {/* Círculo blanco para resaltar el logo */}
          <div className="w-32 h-32 bg-white rounded-full flex items-center justify-center shadow-lg mb-4 p-2">
            <div className="relative w-28 h-28">
              <Image
                src="/logo.png"
                alt="Logo Tacos Gavilan"
                fill
                sizes="112px"
                className="object-contain"
                priority
              />
            </div>
          </div>

          {/* Imagen del Eslogan */}
          <div className="relative w-48 h-16 mb-2">
            <Image
              src="/ya esta.png"
              alt="Ya está"
              fill
              sizes="192px"
              className="object-contain"
            />
          </div>
        </div>

        <h1 className="text-2xl font-bold text-white tracking-wider text-center mb-8">
          Sistema de Monitoreo y Seguimiento
        </h1>
      </div>

      {/* Tarjeta de Login */}
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden relative z-20">
        {/* Barra superior roja corporativa */}
        <div className="h-2 bg-red-600 w-full"></div>

        <div className="p-8">
          <h2 className="text-xl font-bold text-gray-800 mb-6 text-center">
            Ingreso al Sistema
          </h2>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1 ml-1">
                Usuario / Correo
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition text-gray-900 placeholder-gray-400"
                placeholder="ejemplo@tacosgavilan.com"
                required
                disabled={loading}
                autoComplete="email"
              />
            </div>

            <div className="relative">
              <label className="block text-sm font-bold text-gray-700 mb-1 ml-1">
                Contraseña
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition text-gray-900 placeholder-gray-400 pr-12"
                  placeholder="••••••••"
                  required
                  disabled={loading}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none p-1"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border-l-4 border-red-600 text-red-700 p-3 rounded text-sm font-medium">
                ⚠️ {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-red-700 hover:bg-red-800 text-white font-bold py-3.5 px-4 rounded-lg shadow-md hover:shadow-lg transition-all transform active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed uppercase tracking-wide"
            >
              {loading ? 'Validando...' : 'Entrar'}
            </button>
          </form>
        </div>

        {/* Footer de la tarjeta */}
        <div className="bg-gray-100 p-4 text-center border-t border-gray-200">
          <p className="text-xs text-gray-500">
            © 2025 Tacos Gavilan. Uso exclusivo autorizado.
          </p>
        </div>
      </div>
    </div>
  )
}