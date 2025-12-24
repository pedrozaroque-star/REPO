'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'

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

    // Simulación de login (luego conectaremos con Supabase Auth)
    setTimeout(() => {
      if (email && password) {
        router.push('/')
      } else {
        setError('Por favor ingresa email y contraseña')
        setLoading(false)
      }
    }, 1000)
  }

  return (
    <div className="min-h-screen bg-neutral-900 flex flex-col items-center justify-center p-4 relative overflow-hidden">
      
      {/* Fondo decorativo sutil (opcional) */}
      <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>

      <div className="w-full max-w-md z-10">
        
        {/* LOGO Y ESLOGAN */}
        <div className="text-center mb-8 flex flex-col items-center">
          {/* Círculo blanco para resaltar el logo si es transparente */}
          <div className="w-32 h-32 bg-white rounded-full flex items-center justify-center shadow-lg mb-4 p-2">
            <div className="relative w-28 h-28">
              <Image 
                src="/logo.png" 
                alt="Logo Tacos Gavilan" 
                fill
                className="object-contain"
                priority
              />
            </div>
          </div>
          
          {/* Imagen del Eslogan "Ya está" */}
          <div className="relative w-48 h-16 mb-2">
            <Image 
              src="/ya esta.png" 
              alt="Ya está" 
              fill
              className="object-contain"
            />
          </div>
          
          <h1 className="text-2xl font-bold text-white tracking-wider">
            SISTEMA DE GESTIÓN
          </h1>
        </div>

        {/* Tarjeta de Login */}
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
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
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1 ml-1">
                  Contraseña
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition text-gray-900 placeholder-gray-400"
                  placeholder="••••••••"
                  required
                />
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
    </div>
  )
}