'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, AlertTriangle, Inbox, CheckCheck, Trash2, Eye, Check, BellOff } from 'lucide-react'

import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import { formatDateLA } from '@/lib/checklistPermissions'

function NotificacionesContent() {
  const router = useRouter()
  const { user } = useAuth()
  const [notifications, setNotifications] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'unread' | 'read'>('all')

  // Detectar cuando el componente monta
  useEffect(() => {
    if (!user) {
      setTimeout(() => setLoading(false), 1000)
    }
  }, [])

  // Cargar notificaciones cuando cambia el filtro
  useEffect(() => {
    if (user) {
      fetchNotifications()
    }
  }, [filter])

  const fetchNotifications = async () => {
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

      if (!url || !key) {
        console.error('❌ Error: Falta configuración de Supabase (URL o Key)')
        setLoading(false)
        return
      }

      const res = await fetch(
        `${url}/rest/v1/notifications?user_id=eq.${user?.id}&order=created_at.desc`,
        {
          headers: {
            'apikey': key,
            'Authorization': `Bearer ${key}`
          }
        }
      )

      const data = await res.json()
      setNotifications(Array.isArray(data) ? data : [])
      setLoading(false)
    } catch (err) {
      console.error('❌ Error:', err)
      setLoading(false)
    }
  }

  // Agregar esta validación ANTES del loading
  if (!user && !loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-400">
            <AlertTriangle size={40} />
          </div>
          <p className="text-gray-900 font-bold mb-4">No hay sesión de usuario</p>
          <button
            onClick={() => router.push('/')}
            className="bg-indigo-600 text-white px-6 py-2 rounded-xl font-bold hover:bg-indigo-700 transition"
          >
            Ir a login
          </button>
        </div>
      </div>
    )
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
      <div className="flex bg-transparent h-screen items-center justify-center">
        <div className="text-center animate-pulse">
          <Bell size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-900 font-bold">Cargando notificaciones...</p>
        </div>
      </div>
    )
  }

  if (!user) return null

  const unreadCount = notifications.filter(n => !n.is_read).length
  const filteredNotifications = notifications.filter(n => {
    if (filter === 'unread') return !n.is_read
    if (filter === 'read') return n.is_read
    return true
  })

  return (
    <div className="bg-transparent h-screen overflow-hidden font-sans pt-16 md:pt-0 flex flex-col">
      {/* STICKY HEADER - Mobile & Desktop */}
      <div className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-20 shrink-0">
        <div className="max-w-4xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between gap-4">
          {/* Title Area */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600">
              <Bell size={18} />
            </div>
            <div>
              <h1 className="text-lg md:text-xl font-black text-gray-900 tracking-tight leading-none">Notificaciones</h1>
              <p className="hidden md:block text-xs text-gray-400 font-medium">Alertas y avisos</p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="bg-green-100 text-green-700 hover:bg-green-200 px-3 py-1.5 rounded-full text-xs font-bold transition-colors flex items-center gap-1.5"
              >
                <CheckCheck size={14} />
                <span className="hidden sm:inline">Marcar todo leído</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <main className="flex-1 overflow-y-auto max-w-4xl mx-auto px-4 md:px-8 py-8 pb-24 w-full">

        {/* Filtros Mobile-First */}
        <div className="bg-white rounded-2xl shadow-sm p-2 mb-6 border border-gray-100 flex gap-1 sticky top-0 z-10 w-fit mx-auto md:w-full md:mx-0 justify-center md:justify-start">
          <button
            onClick={() => setFilter('all')}
            className={`flex-1 md:flex-none px-4 py-2 rounded-xl text-xs font-bold transition-all ${filter === 'all'
              ? 'bg-gray-900 text-white shadow-md'
              : 'bg-transparent text-gray-500 hover:bg-gray-50'
              }`}>
            Todas
          </button>
          <button
            onClick={() => setFilter('unread')}
            className={`flex-1 md:flex-none px-4 py-2 rounded-xl text-xs font-bold transition-all ${filter === 'unread'
              ? 'bg-gray-900 text-white shadow-md'
              : 'bg-transparent text-gray-500 hover:bg-gray-50'
              }`}>
            No leídas ({unreadCount})
          </button>
          <button
            onClick={() => setFilter('read')}
            className={`flex-1 md:flex-none px-4 py-2 rounded-xl text-xs font-bold transition-all ${filter === 'read'
              ? 'bg-gray-900 text-white shadow-md'
              : 'bg-transparent text-gray-500 hover:bg-gray-50'
              }`}>
            Leídas
          </button>
        </div>

        {/* Lista de Notificaciones */}
        <div className="space-y-4">
          {filteredNotifications.length === 0 ? (
            <div className="text-center py-20 opacity-50">
              <BellOff size={48} className="mx-auto text-gray-300 mb-4" />
              <p className="text-gray-900 font-bold">
                {filter === 'all' ? 'No tienes notificaciones' :
                  filter === 'unread' ? 'No tienes notificaciones sin leer' :
                    'No tienes notificaciones leídas'}
              </p>
            </div>
          ) : (
            filteredNotifications.map((notif) => (
              <div
                key={notif.id}
                className={`bg-white rounded-3xl shadow-[0_2px_15px_-5px_rgba(0,0,0,0.05)] hover:shadow-lg transition-transform hover:-translate-y-0.5 border border-gray-100 p-5 ${!notif.is_read ? 'bg-gradient-to-r from-blue-50/50 to-white' : ''}`}
              >
                <div className="flex gap-4">
                  {/* Icono */}
                  <div className={`flex-shrink-0 w-10 h-10 rounded-2xl flex items-center justify-center ${notif.type === 'observacion_supervisor' ? 'bg-orange-100 text-orange-600' :
                    !notif.is_read ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'
                    }`}>
                    {notif.type === 'observacion_supervisor' ? <AlertTriangle size={20} /> : <Bell size={20} />}
                  </div>

                  {/* Contenido */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-4 mb-1">
                      <h3 className={`font-black text-sm md:text-base leading-tight ${!notif.is_read ? 'text-gray-900' : 'text-gray-600'}`}>
                        {notif.title}
                      </h3>
                      <span className="text-[10px] font-bold text-gray-400 whitespace-nowrap bg-gray-50 px-2 py-0.5 rounded-full border border-gray-100">
                        {formatTimeAgo(notif.created_at)}
                      </span>
                    </div>

                    <p className="text-sm text-gray-500 mb-3 leading-relaxed">{notif.message}</p>

                    {/* Acciones */}
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => handleNotificationClick(notif)}
                        className="bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1.5 transition-colors"
                      >
                        <Eye size={12} /> VER DETALLES
                      </button>
                      {!notif.is_read && (
                        <button
                          onClick={() => markAsRead(notif.id)}
                          className="bg-green-50 text-green-700 hover:bg-green-100 px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1.5 transition-colors"
                        >
                          <Check size={12} /> MARCAR LEÍDA
                        </button>
                      )}
                      <button
                        onClick={() => deleteNotification(notif.id)}
                        className="bg-red-50 text-red-700 hover:bg-red-100 px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1.5 transition-colors ml-auto"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
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