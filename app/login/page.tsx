'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Eye, EyeOff } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showSplash, setShowSplash] = useState(false)
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
      // Redirigir según el rol
      const userRole = data.user.role?.toLowerCase()
      setShowSplash(true)

      setTimeout(() => {
        if (userRole === 'asistente') {
          router.push('/checklists')
        } else {
          router.push('/dashboard')
        }
      }, 3500)

    } catch (err) {
      console.error('Error inesperado:', err)
      setError('Error inesperado. Por favor intenta de nuevo.')
      setLoading(false)
    }
  }

  if (showSplash) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#50050a] overflow-hidden">
        <div className="absolute inset-0 opacity-10 bg-[url('https://grainy-gradients.vercel.app/noise.svg')]"></div>

        <div className="relative z-10 flex flex-col items-center">
          {/* Main Logo Container - Drop In Animation */}
          <motion.div
            initial={{ y: -800, opacity: 0, rotateY: 0 }}
            animate={{
              y: 0,
              opacity: 1,
              rotateY: 1080, // Reduced rotation for better performance
              transition: {
                type: "spring",
                damping: 20,
                stiffness: 60,
                duration: 2.5
              }
            }}
            className="w-48 h-48 rounded-full bg-gradient-to-br from-[#fdc82f] to-[#e69b00] p-1.5 shadow-[0_0_60px_rgba(253,200,47,0.4)] relative"
          >
            <div className="w-full h-full rounded-full bg-white flex items-center justify-center overflow-hidden border-4 border-[#fffbeb]">
              <img src="/logo.png" alt="TAG" className="w-[85%] h-[85%] object-contain" />
            </div>

            {/* Ripple Effect (Child of the logo to follow position if needed, or absolute centered) */}
            <motion.div
              className="absolute inset-0 rounded-full border border-white/50"
              initial={{ scale: 0, opacity: 0.8 }}
              animate={{
                scale: 3,
                opacity: 0,
                transition: {
                  duration: 2,
                  repeat: Infinity,
                  delay: 1.2,
                  ease: "easeOut"
                }
              }}
            />
          </motion.div>

          <motion.h2
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{
              opacity: 1,
              scale: 1,
              transition: { delay: 1, duration: 0.5 }
            }}
            className="mt-8 text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-[#fdc82f] to-[#fffbeb] animate-pulse tracking-widest uppercase"
          >
            BIENVENIDO
          </motion.h2>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-900 flex flex-col items-center justify-center p-4 relative overflow-hidden">

      {/* Fondo decorativo sutil */}
      <div className="absolute inset-0 opacity-60 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>

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