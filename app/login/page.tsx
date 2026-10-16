/**
 * @module app/login/page
 * @description Página de inicio de sesión, Splash Screen oficial y selector corporativo post-login para Tacos Gavilan.
 *
 * @businessRules
 * - Al iniciar sesión se reproduce primero el Splash Screen oficial completo de Tacos Gavilan (logo giratorio + "¡Ya está!").
 * - Al terminar el Splash, a los usuarios administrativos, supervisores, gerentes y asistentes se les presenta
 *   la tarjeta corporativa para elegir entre:
 *   1) Menú de Inicio (`/inicio`) con barra lateral colapsada por defecto, o
 *   2) Dashboard (`/dashboard`) con métricas en tiempo real y barra lateral desplegada.
 * - Empleados (`user_type === 'employee'`) van directamente a `/mis-horarios`.
 * - Usuarios con rol exclusivo `planificador` van directamente a `/planificador`.
 *
 * @dataFlow
 * - POST `/api/login` -> almacena `teg_token` y `teg_user` en `localStorage` y cookie -> Splash Screen -> selección de destino (`/inicio` vs `/dashboard`).
 * - Soporta `?welcome=1` proveniente del callback `/auth/sso` para ofrecer la misma experiencia tras iniciar sesión con Google.
 */

'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Eye,
  EyeOff,
  LayoutGrid,
  LayoutDashboard,
  ArrowRight,
  Loader2,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { useLanguage } from '@/lib/i18n'

interface LoggedUserInfo {
  id?: number | string
  name?: string
  email?: string
  role?: string
  user_type?: string
  store_name?: string
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [postLoginStep, setPostLoginStep] = useState<'none' | 'splash' | 'choice'>('none')
  const [selectedDest, setSelectedDest] = useState<'/inicio' | '/dashboard' | null>(null)
  const [loggedUser, setLoggedUser] = useState<LoggedUserInfo | null>(null)
  const [error, setError] = useState('')
  const router = useRouter()
  const { t, language, setLanguage } = useLanguage()

  const handleSelectDestination = useCallback((destination: '/inicio' | '/dashboard') => {
    if (selectedDest) return
    setSelectedDest(destination)
    try {
      if (destination === '/inicio') {
        localStorage.setItem('teg_sidebar_collapsed', 'true')
      } else {
        localStorage.setItem('teg_sidebar_collapsed', 'false')
      }
    } catch {
      // ignore storage errors
    }
    router.push(destination)
  }, [router, selectedDest])

  // Check if arriving from Google SSO callback (?welcome=1)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('welcome') === '1') {
      const savedUserStr = localStorage.getItem('teg_user')
      const savedToken = localStorage.getItem('teg_token')
      if (savedUserStr && savedToken) {
        try {
          const parsedUser = JSON.parse(savedUserStr) as LoggedUserInfo
          setLoggedUser(parsedUser)
          setPostLoginStep('splash')
          const timer = setTimeout(() => {
            setPostLoginStep('choice')
          }, 4200)
          return () => clearTimeout(timer)
        } catch {
          // ignore
        }
      }
    }
  }, [])

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
        setError(data.error || t('login.error_generic'))
        setLoading(false)
        return
      }

      // Guardar token y usuario en localStorage
      localStorage.setItem('teg_token', data.token)
      localStorage.setItem('teg_user', JSON.stringify(data.user))

      // Guardar token en cookie para soporte de autenticación en SSR/Callbacks (e.g., Basecamp)
      const maxAge = data.user.user_type === 'employee' ? 15 * 60 : 7 * 24 * 60 * 60
      document.cookie = `teg_token=${data.token}; path=/; max-age=${maxAge}; SameSite=Lax${window.location.protocol === 'https:' ? '; Secure' : ''}`

      const userRole = data.user.role?.toLowerCase()
      const userType = data.user.user_type
      const userEmailNorm = (data.user.email || '').trim().toLowerCase()
      const isDirectRedirect = userType === 'employee' || Boolean(data.redirect) || userEmailNorm === 'stephany@cingularhr.com' || userRole === 'planificador'

      setLoggedUser(data.user)
      setPostLoginStep('splash')

      if (isDirectRedirect) {
        setTimeout(() => {
          if (userType === 'employee' || data.redirect) {
            router.push(data.redirect || '/mis-horarios')
            return
          }
          router.push('/planificador')
        }, 1500)
      } else {
        // Play the full classic Splash animation first, then transition to the Choice card
        setTimeout(() => {
          setPostLoginStep('choice')
        }, 4200)
      }
    } catch (err) {
      console.error('Error inesperado:', err)
      setError(t('login.error_unexpected'))
      setLoading(false)
    }
  }

  // STEP 1: Classic Full-Screen Splash Animation (100% original)
  if (postLoginStep === 'splash') {
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
              rotateY: 2520,
              transition: {
                type: 'spring',
                damping: 10,
                stiffness: 20,
                duration: 4.5
              }
            }}
            className="w-48 h-48 rounded-full bg-gradient-to-br from-[#fdc82f] to-[#e69b00] p-1.5 shadow-[0_0_60px_rgba(253,200,47,0.4)] relative"
          >
            <div className="w-full h-full rounded-full bg-white flex items-center justify-center overflow-hidden border-4 border-[#fffbeb]">
              <img src="/logo.png" alt="TAG" className="w-[85%] h-[85%] object-contain" />
            </div>

            {/* Ripple Effect */}
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
                  ease: 'easeOut'
                }
              }}
            />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{
              opacity: 1,
              scale: 1,
              transition: { delay: 1, duration: 0.5 }
            }}
            className="mt-8 w-64 h-24 flex items-center justify-center"
          >
            <img
              src="/ya esta.png"
              alt="¡Ya está!"
              className="w-full h-full object-contain drop-shadow-[0_0_15px_rgba(253,200,47,0.5)]"
            />
          </motion.div>
        </div>
      </div>
    )
  }

  // STEP 2: Full-Screen Corporate Destination Selector (after Splash completes)
  if (postLoginStep === 'choice') {
    const firstName = loggedUser?.name?.split(' ')[0] || 'Usuario'

    return (
      <div className="fixed inset-0 z-50 min-h-screen w-screen overflow-y-auto bg-[#50050a] flex flex-col items-center justify-center p-4">
        <div className="absolute inset-0 opacity-10 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] pointer-events-none"></div>

        {/* Language Toggle */}
        <button
          onClick={() => setLanguage(language === 'es' ? 'en' : 'es')}
          className="absolute top-4 right-4 z-50 px-3 py-1 bg-white/10 hover:bg-white/20 text-white rounded-full text-xs font-bold uppercase tracking-widest backdrop-blur-sm border border-white/10 transition-colors"
        >
          {language === 'es' ? 'EN' : 'ES'}
        </button>

        {/* Logo + ¡Ya está! at top */}
        <div className="relative z-10 flex flex-col items-center mb-6">
          <div className="w-28 h-28 sm:w-32 sm:h-32 rounded-full bg-gradient-to-br from-[#fdc82f] to-[#e69b00] p-1.5 shadow-[0_0_50px_rgba(253,200,47,0.35)] relative">
            <div className="w-full h-full rounded-full bg-white flex items-center justify-center overflow-hidden border-4 border-[#fffbeb]">
              <img src="/logo.png" alt="Tacos Gavilan" className="w-[85%] h-[85%] object-contain" />
            </div>
          </div>

          <div className="mt-3 w-44 h-14 flex items-center justify-center">
            <img
              src="/ya esta.png"
              alt="¡Ya está!"
              className="w-full h-full object-contain drop-shadow-[0_0_15px_rgba(253,200,47,0.45)]"
            />
          </div>
        </div>

        {/* Clean Corporate White Card */}
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="w-full max-w-xl bg-white rounded-2xl shadow-2xl overflow-hidden relative z-20"
        >
          {/* Corporate Red Top Bar */}
          <div className="h-2 bg-red-600 w-full" />

          <div className="p-6 sm:p-8">
            <div className="text-center mb-6">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                {t('login.welcome_back')}, {firstName}
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                {t('login.choose_title')}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Opción 1: Menú de Inicio */}
              <button
                type="button"
                onClick={() => handleSelectDestination('/inicio')}
                disabled={selectedDest !== null}
                className="group text-left p-5 rounded-xl border-2 border-gray-200 hover:border-red-600 bg-gray-50/60 hover:bg-red-50/40 transition-all flex flex-col justify-between cursor-pointer disabled:opacity-60"
              >
                <div>
                  <div className="w-12 h-12 rounded-xl bg-red-100 text-red-700 group-hover:bg-red-600 group-hover:text-white flex items-center justify-center transition-colors mb-4">
                    <LayoutGrid size={24} />
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 group-hover:text-red-700 transition-colors">
                    {t('login.choice_inicio_title')}
                  </h3>
                  <p className="text-xs text-gray-600 mt-1.5 leading-relaxed">
                    {t('login.choice_inicio_desc')}
                  </p>
                </div>

                <div className="mt-5 pt-3 border-t border-gray-200/80 flex items-center justify-between text-xs font-bold text-red-700">
                  <span>
                    {selectedDest === '/inicio' ? t('login.choice_entering') : t('login.choice_inicio_cta')}
                  </span>
                  {selectedDest === '/inicio' ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                  )}
                </div>
              </button>

              {/* Opción 2: Dashboard */}
              <button
                type="button"
                onClick={() => handleSelectDestination('/dashboard')}
                disabled={selectedDest !== null}
                className="group text-left p-5 rounded-xl border-2 border-gray-200 hover:border-red-600 bg-gray-50/60 hover:bg-red-50/40 transition-all flex flex-col justify-between cursor-pointer disabled:opacity-60"
              >
                <div>
                  <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-700 group-hover:bg-red-600 group-hover:text-white flex items-center justify-center transition-colors mb-4">
                    <LayoutDashboard size={24} />
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 group-hover:text-red-700 transition-colors">
                    {t('login.choice_dashboard_title')}
                  </h3>
                  <p className="text-xs text-gray-600 mt-1.5 leading-relaxed">
                    {t('login.choice_dashboard_desc')}
                  </p>
                </div>

                <div className="mt-5 pt-3 border-t border-gray-200/80 flex items-center justify-between text-xs font-bold text-red-700">
                  <span>
                    {selectedDest === '/dashboard' ? t('login.choice_entering') : t('login.choice_dashboard_cta')}
                  </span>
                  {selectedDest === '/dashboard' ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                  )}
                </div>
              </button>
            </div>
          </div>

          <div className="bg-gray-100 p-3.5 text-center border-t border-gray-200">
            <p className="text-xs text-gray-500">
              © {new Date().getFullYear()} Tacos Gavilan. {t('login.footer_text')}
            </p>
          </div>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-900 flex flex-col items-center justify-center p-4 relative overflow-hidden">

      {/* Fondo decorativo sutil */}
      <div className="absolute inset-0 opacity-60 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>

      {/* Language Toggle */}
      <button
        onClick={() => setLanguage(language === 'es' ? 'en' : 'es')}
        className="absolute top-4 right-4 z-50 px-3 py-1 bg-white/10 hover:bg-white/20 text-white rounded-full text-xs font-bold uppercase tracking-widest backdrop-blur-sm border border-white/10 transition-colors"
      >
        {language === 'es' ? 'EN' : 'ES'}
      </button>

      <div className="w-full max-w-md z-10">

        {/* LOGO Y ESLOGAN */}
        <div className="text-center mb-8 flex flex-col items-center">
          {/* Círculo blanco para resaltar el logo */}
          <div className="w-32 h-32 bg-white rounded-full flex items-center justify-center shadow-lg mb-4 p-2">
            <div className="w-28 h-28 flex items-center justify-center">
              <img
                src="/logo.png"
                alt="Logo Tacos Gavilan"
                className="w-full h-full object-contain"
              />
            </div>
          </div>

          {/* Imagen del Eslogan */}
          <div className="w-48 h-16 mb-2 flex items-center justify-center">
            <img
              src="/ya esta.png"
              alt="Ya está"
              className="w-full h-full object-contain"
            />
          </div>
        </div>

        <h1 className="text-2xl font-bold text-white tracking-wider text-center mb-8">
          {t('login.system_title')}
        </h1>
      </div>

      {/* Tarjeta de Login */}
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden relative z-20">
        {/* Barra superior roja corporativa */}
        <div className="h-2 bg-red-600 w-full"></div>

        <div className="p-8">
          <h2 className="text-xl font-bold text-gray-800 mb-6 text-center">
            {t('login.card_title')}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1 ml-1">
                {t('login.user_label')}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition text-gray-900 placeholder-gray-400"
                placeholder={t('login.user_placeholder')}
                required
                disabled={loading}
                autoComplete="email"
              />
            </div>

            <div className="relative">
              <label className="block text-sm font-bold text-gray-700 mb-1 ml-1">
                {t('login.pass_label')}
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
              {loading ? t('login.validating') : t('login.enter_button')}
            </button>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">{t('login.or_login_with')}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => window.location.href = '/api/auth/google/start?returnUrl=/auth/sso'}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-bold py-3 px-4 rounded-lg shadow-sm transition-all transform active:scale-95"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              <span>{t('login.google_button')}</span>
            </button>
          </form>
        </div>

        {/* Footer de la tarjeta */}
        <div className="bg-gray-100 p-4 text-center border-t border-gray-200">
          <p className="text-xs text-gray-500">
            © {new Date().getFullYear()} Tacos Gavilan. {t('login.footer_text')}
          </p>
        </div>
      </div>
    </div>
  )
}