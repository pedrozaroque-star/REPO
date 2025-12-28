'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'

// Definir tipo para la notificación
interface Notification {
  id: number
  title: string
  message: string
  created_at: string
  is_read: boolean
  type: 'alert' | 'info' | 'success' | 'warning'
}

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  
  // Ref para detectar clics fuera
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Cargar notificaciones al montar
  useEffect(() => {
    fetchNotifications()

    // Suscribirse a nuevas notificaciones en tiempo real
    const channel = supabase
      .channel('notifications_realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        (payload) => {
          // Si llega una nueva, la agregamos al inicio y subimos el contador
          const newNotif = payload.new as Notification
          setNotifications(prev => [newNotif, ...prev])
          setUnreadCount(prev => prev + 1)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  const fetchNotifications = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id) // Asegurarse de que el usuario tiene ID numérico o UUID según tu DB
        .order('created_at', { ascending: false })
        .limit(20)

      if (error) throw error

      if (data) {
        setNotifications(data)
        setUnreadCount(data.filter(n => !n.is_read).length)
      }
    } catch (error) {
      console.error('Error al cargar notificaciones:', error)
    }
  }

  const markAsRead = async () => {
    if (unreadCount === 0) return

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const unreadIds = notifications.filter(n => !n.is_read).map(n => n.id)
      
      if (unreadIds.length > 0) {
        await supabase
          .from('notifications')
          .update({ is_read: true })
          .in('id', unreadIds)

        setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
        setUnreadCount(0)
      }
    } catch (error) {
      console.error('Error al marcar como leídas:', error)
    }
  }

  const toggleDropdown = () => {
    if (!isOpen) {
      setIsOpen(true)
      markAsRead()
    } else {
      setIsOpen(false)
    }
  }

  // Iconos según el tipo de alerta
  const getIcon = (type: string) => {
    switch (type) {
      case 'alert': return '🚨';
      case 'success': return '✅';
      case 'warning': return '⚠️';
      default: return 'ℹ️';
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Botón de la Campana */}
      <button
        onClick={toggleDropdown}
        className="relative p-2 text-gray-400 hover:text-white transition-colors rounded-full hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-red-500"
      >
        <span className="text-2xl">🔔</span>
        
        {/* Badge de contador */}
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-red-100 transform translate-x-1/4 -translate-y-1/4 bg-red-600 rounded-full border-2 border-gray-900">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* VENTANA FLOTANTE MEJORADA 
         Usa 'fixed' para escapar del Sidebar y z-50 para estar encima de todo
      */}
      {isOpen && (
        <>
          {/* Fondo invisible para cerrar al hacer clic fuera */}
          <div 
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm md:bg-transparent md:backdrop-blur-none" 
            onClick={() => setIsOpen(false)}
          />

          <div className="fixed z-50 
                          /* MÓVIL: Centrado abajo o completo */
                          bottom-0 left-0 right-0 mx-4 mb-4 
                          max-h-[70vh] flex flex-col
                          
                          /* TABLET/PC: Pegado al sidebar */
                          md:left-64 md:bottom-20 md:w-96 md:mx-0
                          
                          bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden ring-1 ring-black ring-opacity-5 animate-in slide-in-from-bottom-2 fade-in duration-200">
            
            {/* Cabecera */}
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex justify-between items-center">
              <h3 className="text-sm font-semibold text-gray-700">Notificaciones</h3>
              <button 
                onClick={() => setIsOpen(false)}
                className="text-gray-400 hover:text-gray-600 md:hidden"
              >
                ✕
              </button>
            </div>

            {/* Lista Scrollable */}
            <div className="overflow-y-auto overscroll-contain max-h-[60vh] md:max-h-96">
              {notifications.length === 0 ? (
                <div className="px-4 py-8 text-center text-gray-500">
                  <p className="text-3xl mb-2">🔕</p>
                  <p className="text-sm">No tienes notificaciones nuevas</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {notifications.map((notification) => (
                    <div 
                      key={notification.id} 
                      className={`px-4 py-3 hover:bg-gray-50 transition-colors ${!notification.is_read ? 'bg-blue-50/50' : ''}`}
                    >
                      <div className="flex items-start gap-3">
                        <span className="text-xl mt-1 select-none">
                          {getIcon(notification.type)}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {notification.title}
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                            {notification.message}
                          </p>
                          <p className="text-[10px] text-gray-400 mt-1">
                            {new Date(notification.created_at).toLocaleString('es-MX', {
                              day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
                            })}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            {/* Pie de ventana */}
            <div className="bg-gray-50 px-4 py-2 border-t border-gray-100 text-center">
              <button 
                onClick={() => setIsOpen(false)}
                className="text-xs text-blue-600 font-medium hover:text-blue-800"
              >
                Cerrar
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}