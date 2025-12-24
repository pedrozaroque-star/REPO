'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from './ProtectedRoute'

export default function NotificationBell() {
  const router = useRouter()
  const { user } = useAuth()
  const [unreadCount, setUnreadCount] = useState(0)
  const [showDropdown, setShowDropdown] = useState(false)
  const [notifications, setNotifications] = useState<any[]>([])

  useEffect(() => {
    if (user) {
      fetchNotifications()
      const interval = setInterval(fetchNotifications, 30000)
      return () => clearInterval(interval)
    }
  }, [user])

  const fetchNotifications = async () => {
    if (!user) return

    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

      const res = await fetch(
        `${url}/rest/v1/notifications?user_id=eq.${user.id}&order=created_at.desc&limit=10`,
        {
          headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` }
        }
      )
      const data = await res.json()
      
      if (Array.isArray(data)) {
        setNotifications(data)
        setUnreadCount(data.filter(n => !n.is_read).length)
      }
    } catch (err) {
      console.error('Error fetching notifications:', err)
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
      console.error('Error marking as read:', err)
    }
  }

  const handleNotificationClick = (notification: any) => {
    markAsRead(notification.id)
    setShowDropdown(false)
    
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
    
    if (diffMins < 1) return 'Ahora'
    if (diffMins < 60) return `${diffMins}m`
    
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h`
    
    const diffDays = Math.floor(diffHours / 24)
    return `${diffDays}d`
  }

  if (!user) return null

  return (
    <div className="relative">
      {/* Botón de campana */}
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="relative p-2 text-white hover:bg-indigo-500 rounded-lg transition-colors"
        aria-label="Notificaciones">
        <span className="text-xl">🔔</span>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full min-w-[18px] h-[18px] flex items-center justify-center font-bold px-1">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {showDropdown && (
        <>
          {/* Overlay invisible para cerrar */}
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setShowDropdown(false)}
          />
          
          {/* Panel de notificaciones - Aparece ARRIBA del botón */}
          <div className="absolute bottom-full right-0 mb-2 w-80 bg-white rounded-lg shadow-2xl border border-gray-200 z-50 max-h-[400px] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="bg-indigo-600 text-white px-4 py-3 rounded-t-lg flex-shrink-0">
              <div className="flex justify-between items-center">
                <h3 className="font-bold text-sm">Notificaciones</h3>
                {unreadCount > 0 && (
                  <span className="text-xs bg-indigo-700 px-2 py-1 rounded">
                    {unreadCount} nueva{unreadCount !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>

            {/* Lista de notificaciones con scroll */}
            <div className="flex-1 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <div className="text-4xl mb-2">📭</div>
                  <p className="text-sm">No hay notificaciones</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {notifications.map((notif) => (
                    <div
                      key={notif.id}
                      onClick={() => handleNotificationClick(notif)}
                      className={`p-3 hover:bg-gray-50 cursor-pointer transition-colors ${
                        !notif.is_read ? 'bg-blue-50' : ''
                      }`}>
                      <div className="flex gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-semibold text-gray-900 text-xs leading-tight">
                              {notif.title}
                            </p>
                            {!notif.is_read && (
                              <div className="w-2 h-2 bg-blue-600 rounded-full flex-shrink-0 mt-1" />
                            )}
                          </div>
                          <p className="text-xs text-gray-600 mt-1 line-clamp-2">
                            {notif.message}
                          </p>
                          <p className="text-xs text-gray-400 mt-1">
                            {formatTimeAgo(notif.created_at)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            {notifications.length > 0 && (
              <div className="border-t border-gray-200 p-2 bg-gray-50 rounded-b-lg flex-shrink-0">
                <button
                  onClick={() => {
                    setShowDropdown(false)
                    router.push('/notificaciones')
                  }}
                  className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold w-full text-center py-1">
                  Ver todas →
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}