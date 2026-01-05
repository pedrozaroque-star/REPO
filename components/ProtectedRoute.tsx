'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import SurpriseLoader from '@/components/SurpriseLoader'

interface AuthUser {
  id: number
  email: string
  name: string
  role: string
  store_scope?: string[] | null
  store_id?: string | null
}

interface ProtectedRouteProps {
  children: React.ReactNode
  allowedRoles?: string[]
}

export default function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const router = useRouter()
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

      const userData = JSON.parse(userStr)

      if (!userData.id || !userData.email || !userData.role) {
        localStorage.removeItem('teg_token')
        localStorage.removeItem('teg_user')
        router.push('/login')
        return
      }

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
      const userStr = localStorage.getItem('teg_user')
      if (userStr) {
        setUser(JSON.parse(userStr))
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