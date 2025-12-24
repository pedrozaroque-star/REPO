'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import { formatDateLA } from '@/lib/checklistPermissions'

function NotificacionesContent() {
  const router = useRouter()
  const { user } = useAuth()
  const [notifications, setNotifications] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'unread' | 'read'>('all')

  useEffect(() => {
    fetchNotifications()
  }, [filter])

  const fetchNotifications = async () => {
  if (!user) {
    console.log('❌ No hay usuario')
    return
  }

  console.log('🔍 Fetching notifications para user:', user.id)

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    console.log('🔍 URL:', `${url}/rest/v1/notifications?user_id=eq.${user.id}`)

    const res = await fetch(
      `${url}/rest/v1/notifications?user_id=eq.${user.id}&order=created_at.desc`,
      {
        headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` }
      }
    )
    
    console.log('🔍 Response status:', res.status)
    
    const data = await res.json()
    console.log('🔍 Data recibida:', data)
    
    setNotifications(Array.isArray(data) ? data : [])
    setLoading(false)
  } catch (err) {
    console.error('❌ Error completo:', err)
    setLoading(false)
  }
}

  const markAsRead = async (id: number) => {
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

      await fetch(`${url}/rest/v1/notifications?id=eq.${id}`, {
        method: 'PATCH',
        headers: {
          'apikey': key || '',
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ is_read: true, read_at: new Date().toISOString() })
      })

      fetchNotifications()
    } catch (err) {
      console.error('Error:', err)
    }
  }

  const markAllAsRead = async () => {
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

      const unreadIds = notifications.filter(n => !n.is_read).map(n => n.id)

      for (const id of unreadIds) {
        await fetch(`${url}/rest/v1/notifications?id=eq.${id}`, {
          method: 'PATCH',
          headers: {
            'apikey': key || '',
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ is_read: true, read_at: new Date().toISOString() })
        })
      }

      fetchNotifications()
    } catch (err) {
      console.error('Error:', err)
    }
  }

  const deleteNotification = async (id: number) => {
    if (!confirm('¿Eliminar esta notificación?')) return

    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

      await fetch(`${url}/rest/v1/notifications?id=eq.${id}`, {
        method: 'DELETE',
        headers: {
          'apikey': key || '',
          'Authorization': `Bearer ${key}`
        }
      })

      fetchNotifications()
    } catch (err) {
      console.error('Error:', err)
    }
  }

  const handleNotificationClick = (notification: any) => {
    if (!notification.is_read) {
      markAsRead(notification.id)
    }
    
    if (notification.reference_type === 'supervisor_inspection') {
      router.push('/inspecciones')
    } else if (notification.reference_type === 'manager') {
      router.push('/checklists-manager')
    } else {
      router.push('/checklists')
    }
  }

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    
    if (diffMins < 1) return 'Justo ahora'
    if (diffMins < 60) return `Hace ${diffMins} min`
    
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `Hace ${diffHours}h`
    
    const diffDays = Math.floor(diffHours / 24)
    return `Hace ${diffDays}d`
  }

  if (loading) {
    return (
      <div className="flex min-h-screen bg-gray-50">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center md:ml-64">
          <div className="text-center">
            <div className="text-6xl mb-4">🔔</div>
            <p className="text-gray-600">Cargando notificaciones...</p>
          </div>
        </div>
      </div>
    )
  }

  if (!user) return null

  const unreadCount = notifications.filter(n => !n.is_read).length

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      
      <main className="flex-1 p-4 md:p-8 md:ml-64 mt-16 md:mt-0">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Notificaciones</h1>
            <p className="text-gray-600 mt-2 text-sm md:text-base">
              {unreadCount > 0 
                ? `Tienes ${unreadCount} notificación${unreadCount > 1 ? 'es' : ''} sin leer`
                : 'No tienes notificaciones sin leer'
              }
            </p>
          </div>

          {/* Filtros y Acciones */}
          <div className="bg-white rounded-xl shadow-md p-4 md:p-6 mb-4 md:mb-6">
            <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center justify-between">
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setFilter('all')}
                  className={`px-4 py-2 rounded-lg font-semibold transition-all text-sm ${
                    filter === 'all'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}>
                  Todas
                </button>
                <button
                  onClick={() => setFilter('unread')}
                  className={`px-4 py-2 rounded-lg font-semibold transition-all text-sm ${
                    filter === 'unread'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}>
                  No leídas ({unreadCount})
                </button>
                <button
                  onClick={() => setFilter('read')}
                  className={`px-4 py-2 rounded-lg font-semibold transition-all text-sm ${
                    filter === 'read'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}>
                  Leídas
                </button>
              </div>

              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-semibold transition-all text-sm whitespace-nowrap">
                  ✓ Marcar todas como leídas
                </button>
              )}
            </div>
          </div>

          {/* Lista de Notificaciones */}
          <div className="space-y-3">
            {notifications.length === 0 ? (
              <div className="bg-white rounded-xl shadow-md p-8 md:p-12 text-center">
                <div className="text-5xl md:text-6xl mb-4">📭</div>
                <p className="text-gray-600 text-base md:text-lg">
                  {filter === 'all' ? 'No tienes notificaciones' :
                   filter === 'unread' ? 'No tienes notificaciones sin leer' :
                   'No tienes notificaciones leídas'}
                </p>
              </div>
            ) : (
              notifications.map((notif) => (
                <div
                  key={notif.id}
                  className={`bg-white rounded-xl shadow-md p-4 md:p-6 transition-all hover:shadow-lg ${
                    !notif.is_read ? 'border-l-4 border-blue-600' : ''
                  }`}>
                  <div className="flex items-start gap-3 md:gap-4">
                    {/* Icono */}
                    <div className={`flex-shrink-0 w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center ${
                      !notif.is_read ? 'bg-blue-100' : 'bg-gray-100'
                    }`}>
                      <span className="text-xl md:text-2xl">
                        {notif.type === 'observacion_supervisor' ? '⚠️' : '🔔'}
                      </span>
                    </div>

                    {/* Contenido */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <h3 className={`font-bold text-base md:text-lg ${
                          !notif.is_read ? 'text-gray-900' : 'text-gray-600'
                        }`}>
                          {notif.title}
                        </h3>
                        {!notif.is_read && (
                          <div className="w-2 h-2 md:w-3 md:h-3 bg-blue-600 rounded-full flex-shrink-0 mt-1" />
                        )}
                      </div>

                      <p className="text-gray-700 mb-3 text-sm md:text-base">{notif.message}</p>

                      <div className="flex items-center gap-2 md:gap-4 text-xs md:text-sm text-gray-500">
                        <span>{formatTimeAgo(notif.created_at)}</span>
                        <span>•</span>
                        <span>{formatDateLA(notif.created_at)}</span>
                      </div>

                      {/* Acciones */}
                      <div className="flex flex-wrap gap-2 mt-4">
                        <button
                          onClick={() => handleNotificationClick(notif)}
                          className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 md:px-4 py-2 rounded-lg font-semibold text-xs md:text-sm transition-all">
                          Ver detalles
                        </button>
                        {!notif.is_read && (
                          <button
                            onClick={() => markAsRead(notif.id)}
                            className="bg-green-600 hover:bg-green-700 text-white px-3 md:px-4 py-2 rounded-lg font-semibold text-xs md:text-sm transition-all">
                            Marcar como leída
                          </button>
                        )}
                        <button
                          onClick={() => deleteNotification(notif.id)}
                          className="bg-red-600 hover:bg-red-700 text-white px-3 md:px-4 py-2 rounded-lg font-semibold text-xs md:text-sm transition-all">
                          Eliminar
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

export default function NotificacionesPage() {
  return (
    <ProtectedRoute>
      <NotificacionesContent />
    </ProtectedRoute>
  )
}