'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { getSupabaseClient } from '@/lib/supabase'

interface Notification {
  id: number
  title: string
  message: string
  link: string
  created_at: string
  is_read: boolean
  type: 'alert' | 'info' | 'success' | 'warning'
  resource_id?: any // Para reconstruir links rotos
}

export default function NotificationBell({ isCollapsed = false }: { isCollapsed?: boolean }) {
  const router = useRouter()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const [showAnimation, setShowAnimation] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const hasShownAnimation = useRef(false)

  // 🔊 Función para reproducir sonido de campana
  const playBellSound = () => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()

      // Crear tres tonos para simular una campana real
      const frequencies = [800, 1000, 1200]
      const duration = 0.5

      frequencies.forEach((freq, index) => {
        const oscillator = audioContext.createOscillator()
        const gainNode = audioContext.createGain()

        oscillator.connect(gainNode)
        gainNode.connect(audioContext.destination)

        oscillator.frequency.value = freq
        oscillator.type = 'sine'

        // Envolvente ADSR para sonido más natural
        const now = audioContext.currentTime
        gainNode.gain.setValueAtTime(0, now)
        gainNode.gain.linearRampToValueAtTime(0.3 / (index + 1), now + 0.01)
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + duration)

        oscillator.start(now)
        oscillator.stop(now + duration)
      })

      // Segundo "ding" más suave
      setTimeout(() => {
        const oscillator2 = audioContext.createOscillator()
        const gainNode2 = audioContext.createGain()

        oscillator2.connect(gainNode2)
        gainNode2.connect(audioContext.destination)

        oscillator2.frequency.value = 1000
        oscillator2.type = 'sine'

        const now = audioContext.currentTime
        gainNode2.gain.setValueAtTime(0, now)
        gainNode2.gain.linearRampToValueAtTime(0.2, now + 0.01)
        gainNode2.gain.exponentialRampToValueAtTime(0.01, now + 0.3)

        oscillator2.start(now)
        oscillator2.stop(now + 0.3)
      }, 200)

    } catch (error) {
      console.error('Error al reproducir sonido:', error)
    }
  }

  useEffect(() => {
    fetchNotifications()
    const interval = setInterval(fetchNotifications, 30000)
    return () => clearInterval(interval)
  }, [])

  const fetchNotifications = async () => {
    try {
      const userStr = localStorage.getItem('teg_user')
      if (!userStr) return
      const user = JSON.parse(userStr)

      const supabase = await getSupabaseClient()

      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20)

      if (error) throw error

      if (data) {
        let notifs = data as unknown as Notification[]

        // 🏁 FILTRO DE LUNES 6:00 AM
        // No mostrar nada anterior al último lunes a las 6am
        const now = new Date()
        const day = now.getDay()
        const diffSinceMonday = (day === 0 ? 6 : day - 1)
        const monday6AM = new Date(now)
        monday6AM.setDate(now.getDate() - diffSinceMonday)
        monday6AM.setHours(6, 0, 0, 0)

        notifs = notifs.filter(n => new Date(n.created_at) >= monday6AM)
        const unread = notifs.filter(n => !n.is_read).length

        setNotifications(notifs)
        setUnreadCount(unread)

        if (unread > 0 && !hasShownAnimation.current) {
          hasShownAnimation.current = true
          setShowAnimation(true)
          playBellSound()
          setTimeout(() => setShowAnimation(false), 3000)
        }
      }
    } catch (error: any) {
      // 🛡️ Manejo de errores de red (común con AdBlockers o pérdida de conexión)
      const msg = error?.message || error?.toString() || '';
      if (msg.includes('Failed to fetch') || msg.includes('Network request failed')) {
        console.warn('⚠️ (Silenciado) No se pudieron cargar las notificaciones por problema de red o bloqueo.');
        return
      }
      console.error('Error al cargar notificaciones (catch):', error)
    }
  }

  const markAsRead = async () => {
    if (unreadCount === 0) return

    try {
      const unreadIds = notifications.filter(n => !n.is_read).map(n => n.id)

      if (unreadIds.length > 0) {
        const supabase = await getSupabaseClient()

        const { error } = await supabase
          .from('notifications')
          .update({ is_read: true })
          .in('id', unreadIds)

        if (error) throw error

        setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
        setUnreadCount(0)
      }
    } catch (error) {
      console.error('Error:', error)
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

  const handleNotificationClick = (notification: Notification) => {
    let finalLink = notification.link

    // 🛠️ PARCHE: Si el link viene sin ID (ej. "/checklists") pero hay resource_id, lo reconstruimos
    if ((finalLink === '/checklists' || finalLink === '/checklists/') && notification.resource_id) {
      finalLink = `${finalLink}?id=${notification.resource_id}`
    } else if (finalLink === '/checklists' || finalLink === '/checklists/') {
      finalLink = `${finalLink}?auto_open=latest`
    } else if ((finalLink === '/checklists-manager' || finalLink === '/checklists-manager/') && notification.resource_id) {
      finalLink = `${finalLink}?id=${notification.resource_id}`
    }

    if (finalLink) {
      router.push(finalLink)
      setIsOpen(false)
    }
  }

  const getIcon = (type: string) => {
    switch (type) {
      case 'alert': return '🚨';
      case 'success': return '✅';
      case 'warning': return '⚠️';
      default: return 'ℹ️';
    }
  }

  return (
    <>
      {/* 🎬 ANIMACIÓN ESPECTACULAR DE ENTRADA (USANDO PORTAL PARA SALIR DEL SIDEBAR) */}
      {showAnimation && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[9999] pointer-events-none flex items-center justify-center">
          <div className="bell-entrance-animation">
            <div className="text-[20rem] animate-shake drop-shadow-2xl">
              🔔
            </div>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
              <div className="bg-red-600 text-white rounded-full w-32 h-32 flex items-center justify-center text-6xl font-bold animate-pulse border-8 border-white shadow-2xl">
                {unreadCount}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* CAMPANA NORMAL EN SIDEBAR */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={toggleDropdown}
          className="relative p-2 text-gray-400 hover:text-white transition-colors rounded-full hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-red-500"
        >
          <span className="text-2xl">🔔</span>

          {unreadCount > 0 && (
            <span className="absolute top-0 right-0 inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-red-100 transform translate-x-1/4 -translate-y-1/4 bg-red-600 rounded-full border-2 border-gray-900 animate-pulse">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {isOpen && typeof document !== 'undefined' && createPortal(
          <>
            <div
              className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm md:bg-transparent md:backdrop-blur-none"
              onClick={() => setIsOpen(false)}
            />

            <div className={`fixed z-50 top-16 ${isCollapsed ? 'left-20' : 'left-64'} w-96 bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-gray-200 dark:border-slate-700 overflow-hidden ring-1 ring-black/5 dark:ring-white/5 animate-in slide-in-from-top-2 fade-in duration-200 transition-all max-h-[80vh] flex flex-col md:top-16 md:left-auto md:right-4`}>

              <div className="px-4 py-3 bg-gray-50 dark:bg-slate-800 border-b border-gray-100 dark:border-slate-700 flex justify-between items-center">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-200">Notificaciones</h3>
                <button
                  onClick={() => setIsOpen(false)}
                  className="text-gray-400 hover:text-gray-600 dark:text-slate-400 dark:hover:text-slate-200 md:hidden"
                >
                  ✕
                </button>
              </div>

              <div className="overflow-y-auto overscroll-contain max-h-[60vh] md:max-h-96">
                {notifications.length === 0 ? (
                  <div className="px-4 py-8 text-center text-gray-500 dark:text-slate-400">
                    <p className="text-3xl mb-2">🔕</p>
                    <p className="text-sm">No tienes notificaciones nuevas</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100 dark:divide-slate-800">
                    {notifications.map((notification) => (
                      <div
                        key={notification.id}
                        onClick={() => handleNotificationClick(notification)}
                        className={`flex flex-col gap-1 p-3 rounded-lg transition-all cursor-pointer ${!notification.is_read ? 'bg-indigo-50 dark:bg-indigo-900/20 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 border-l-4 border-indigo-500' : 'hover:bg-gray-50 dark:hover:bg-slate-800'}`}
                      >
                        <div className="flex items-start gap-3">
                          <span className="text-xl mt-1 select-none">
                            {getIcon(notification.type)}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                              {notification.title}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5 line-clamp-2">
                              {notification.message}
                            </p>
                            <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">
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

              <div className="bg-gray-50 dark:bg-slate-800 px-4 py-2 border-t border-gray-100 dark:border-slate-700 text-center">
                <button
                  onClick={() => setIsOpen(false)}
                  className="text-xs text-blue-600 font-medium hover:text-blue-800"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </>,
          document.body
        )}
      </div>

      <style jsx>{`
        .bell-entrance-animation {
          animation: bellEntrance 3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
          position: relative;
        }

        @keyframes bellEntrance {
          0% {
            transform: scale(0) rotate(-180deg);
            opacity: 0;
          }
          40% {
            transform: scale(1.2) rotate(10deg);
            opacity: 1;
          }
          60% {
            transform: scale(1) rotate(-5deg);
          }
          80% {
            transform: scale(1) rotate(0deg);
          }
          100% {
            transform: scale(0.1) translateX(-45vw) translateY(40vh); /* Moves towards bottom-left sidebar */
            opacity: 0;
          }
        }

        @keyframes shake {
          0%, 100% { transform: rotate(0deg); }
          10%, 30%, 50%, 70%, 90% { transform: rotate(-10deg); }
          20%, 40%, 60%, 80% { transform: rotate(10deg); }
        }

        .animate-shake {
          animation: shake 0.5s infinite;
        }

        @media (max-width: 768px) {
          @keyframes bellEntrance {
            0% {
              transform: scale(0) rotate(-180deg);
              opacity: 0;
            }
            40% {
              transform: scale(1.2) rotate(10deg);
              opacity: 1;
            }
            60% {
              transform: scale(1) rotate(-5deg);
            }
            80% {
              transform: scale(1) rotate(0deg);
            }
            100% {
              transform: scale(0.1) translateX(-150px) translateY(300px);
              opacity: 0;
            }
          }
        }
      `}</style>
    </>
  )
}