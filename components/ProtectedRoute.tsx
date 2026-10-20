/**
 * @module components/ProtectedRoute
 * @description Guardián de autenticación y autorización por roles en el cliente para rutas protegidas de Tacos Gavilan.
 *
 * @businessRules
 * - Verifica existencia y vigencia de `teg_token` y `teg_user` en `localStorage`.
 * - Sincroniza cookie `teg_token` para soporte SSR/API.
 * - Si un usuario autenticado intenta acceder a una ruta fuera de `allowedRoles`, redirige a `/inicio`.
 *
 * @dataFlow
 * - `localStorage` (`teg_token`, `teg_user`) -> validación JWT -> render de `children` o redirección.
 */

'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import SurpriseLoader from '@/components/SurpriseLoader'
import { ensureFreshTabletAuth } from '@/lib/tablet-cache-cleaner'

interface AuthUser {
  id: number | string
  email: string
  name: string
  role: string
  user_type?: 'admin' | 'employee'
  store_scope?: string[] | null
  store_id?: string | null
  store_ids?: string[]
}

interface ProtectedRouteProps {
  children: React.ReactNode
  allowedRoles?: string[]
  allowEmployee?: boolean  // New: explicitly allow employees
}

// Helper to check if JWT is expired
function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    const exp = payload.exp * 1000 // Convert to milliseconds
    return Date.now() >= exp
  } catch {
    return true // If we can't parse, assume expired
  }
}

export default function ProtectedRoute({ children, allowedRoles, allowEmployee = false }: ProtectedRouteProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<AuthUser | null>(null)

  useEffect(() => {
    checkAuth()
  }, [])

  const checkAuth = () => {
    try {
      const token = localStorage.getItem('teg_token')
      const userStr = localStorage.getItem('teg_user')

      if (!token || !userStr) {
        router.push('/login')
        return
      }

      const userData = JSON.parse(userStr) as AuthUser

      if (!userData.id || !userData.email || !userData.role) {
        localStorage.removeItem('teg_token')
        localStorage.removeItem('teg_user')
        router.push('/login')
        return
      }

      // Check token expiration
      if (isTokenExpired(token)) {
        if (userData.user_type === 'employee') {
          console.log('Employee token expired, redirecting to login')
          localStorage.removeItem('teg_token')
          localStorage.removeItem('teg_user')
          router.push('/login')
          return
        }
        // Para managers/admins/tabletas 24/7: renovar silenciosamente vía /api/auth/refresh
        ensureFreshTabletAuth(true).then((ok) => {
          if (!ok) {
            console.log('Token expired and renewal rejected, redirecting to login')
            localStorage.removeItem('teg_token')
            localStorage.removeItem('teg_user')
            router.push('/login')
          }
        })
      } else if (userData.user_type !== 'employee') {
        ensureFreshTabletAuth(false).catch(() => {})
      }

      // Sincronizar la cookie 'teg_token' desde localStorage si no existe
      const hasCookie = document.cookie.split('; ').some(row => row.trim().startsWith('teg_token='))
      if (!hasCookie) {
        const maxAge = userData.user_type === 'employee' ? 15 * 60 : 30 * 24 * 60 * 60
        document.cookie = `teg_token=${token}; path=/; max-age=${maxAge}; SameSite=Lax${window.location.protocol === 'https:' ? '; Secure' : ''}`
        console.log('✅ [ProtectedRoute] Cookie teg_token sincronizada desde localStorage')
      }

      // Handle EMPLOYEE user type - can only access /mis-horarios
      if (userData.user_type === 'employee') {
        // If this route allows employees, proceed
        if (allowEmployee || pathname === '/mis-horarios') {
          setUser(userData)
          setLoading(false)
          return
        }
        // Otherwise redirect employee to their only allowed page
        router.push('/mis-horarios')
        return
      }

      // Handle PLANIFICADOR / external user restriction - can only access /planificador
      const userEmailNorm = (userData.email || '').trim().toLowerCase()
      const isPlanificadorOnly = userEmailNorm === 'stephany@cingularhr.com' || userData.role?.toLowerCase() === 'planificador'

      if (isPlanificadorOnly) {
        if (pathname.startsWith('/planificador')) {
          setUser(userData)
          setLoading(false)
          return
        }
        router.push('/planificador')
        return
      }

      // Handle ADMIN/MANAGER users with role-based access
      if (allowedRoles && allowedRoles.length > 0) {
        const userRole = userData.role.toLowerCase()
        const allowed = allowedRoles.map(r => r.toLowerCase())

        if (!allowed.includes(userRole)) {
          router.push('/inicio')
          return
        }
      }

      setUser(userData)
      setLoading(false)
    } catch (err) {
      console.error('Error verificando autenticación:', err)
      localStorage.removeItem('teg_token')
      localStorage.removeItem('teg_user')
      router.push('/login')
    }
  }

  if (loading) {
    return <SurpriseLoader />
  }

  return <>{children}</>
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadUser()
  }, [])

  const loadUser = () => {
    try {
      const token = localStorage.getItem('teg_token')
      const userStr = localStorage.getItem('teg_user')

      if (userStr) {
        const userData = JSON.parse(userStr)

        // Check token expiration
        if (token && isTokenExpired(token)) {
          if (userData.user_type === 'employee') {
            console.log('Employee token expired in useAuth')
            localStorage.removeItem('teg_token')
            localStorage.removeItem('teg_user')
            setLoading(false)
            return
          }
          // Para tabletas de cocina (/inventory/preparador) y usuarios 24/7:
          // NO borrar teg_user ni teg_token; mantener sesión y renovar silenciosamente
          setUser(userData)
          ensureFreshTabletAuth(true).catch(() => {})
          setLoading(false)
          return
        }

        setUser(userData)

        if (token && userData.user_type !== 'employee') {
          ensureFreshTabletAuth(false).catch(() => {})
        }

        // Sincronizar la cookie 'teg_token' desde localStorage si no existe
        if (token) {
          const hasCookie = document.cookie.split('; ').some(row => row.trim().startsWith('teg_token='))
          if (!hasCookie) {
            const maxAge = userData.user_type === 'employee' ? 15 * 60 : 30 * 24 * 60 * 60
            document.cookie = `teg_token=${token}; path=/; max-age=${maxAge}; SameSite=Lax${window.location.protocol === 'https:' ? '; Secure' : ''}`
            console.log('✅ [useAuth] Cookie ' + 'teg_token' + ' sincronizada desde localStorage')
          }
        }
      }
      setLoading(false)
    } catch (err) {
      console.error('Error obteniendo usuario:', err)
      setLoading(false)
    }
  }

  const logout = () => {
    localStorage.removeItem('teg_token')
    localStorage.removeItem('teg_user')
    window.location.href = '/login'
  }

  return { user, logout, loading }
}