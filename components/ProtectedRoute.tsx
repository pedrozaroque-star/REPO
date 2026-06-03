'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import SurpriseLoader from '@/components/SurpriseLoader'

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

      // Check token expiration
      if (isTokenExpired(token)) {
        console.log('Token expired, redirecting to login')
        localStorage.removeItem('teg_token')
        localStorage.removeItem('teg_user')
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

      // Sincronizar la cookie 'teg_token' desde localStorage si no existe
      const hasCookie = document.cookie.split('; ').some(row => row.trim().startsWith('teg_token='))
      if (!hasCookie) {
        const maxAge = userData.user_type === 'employee' ? 15 * 60 : 7 * 24 * 60 * 60
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

      // Handle ADMIN/MANAGER users with role-based access
      if (allowedRoles && allowedRoles.length > 0) {
        const userRole = userData.role.toLowerCase()
        const allowed = allowedRoles.map(r => r.toLowerCase())

        if (!allowed.includes(userRole)) {
          router.push('/dashboard')
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

      // Check token expiration
      if (token && isTokenExpired(token)) {
        console.log('Token expired in useAuth')
        localStorage.removeItem('teg_token')
        localStorage.removeItem('teg_user')
        setLoading(false)
        return
      }

      if (userStr) {
        const userData = JSON.parse(userStr)
        setUser(userData)

        // Sincronizar la cookie 'teg_token' desde localStorage si no existe
        if (token) {
          const hasCookie = document.cookie.split('; ').some(row => row.trim().startsWith('teg_token='))
          if (!hasCookie) {
            const maxAge = userData.user_type === 'employee' ? 15 * 60 : 7 * 24 * 60 * 60
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