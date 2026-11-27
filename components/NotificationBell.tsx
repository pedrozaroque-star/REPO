/**
 * @module components/NotificationBell
 * @description Campana de notificaciones in-app con menú desplegable, contador de no leídas y alerta sonora
 *   para usuarios autenticados del panel administrativo de Tacos Gavilan.
 *
 * @businessRules
 * - Muestra únicamente notificaciones del usuario autenticado posteriores al último lunes a las 6:00 AM
 *   (inicio de semana operativa) empujando `.gte('created_at', monday6AM.toISOString())` directo a PostgreSQL.
 * - Desactiva por completo el polling en rutas kiosko/cocina (`/order-ready-board`, `/inventory/preparador`,
 *   `/inventory/preparador/*`) para evitar tráfico innecesario desde tabletas 24/7.
 * - Deduplicación por pestaña (*singleton store*): aunque `AppSidebar` monte instancias separadas para
 *   escritorio (`hidden lg:flex`) y móvil (`lg:hidden`), existe exactamente UN solo poller (180 s),
 *   UN listener de `visibilitychange` y una única reproducción de sonido/animación de entrada por pestaña.
 *
 * @dataFlow
 * - `localStorage.teg_user` -> `supabase.from('notifications').select('id, title, message, link, created_at, is_read, type, reference_id')`
 *   -> singleton store (`useSyncExternalStore`) -> instancias desktop/mobile de `NotificationBell`.
 *
 * @notes
 * - Optimización 2026-11-19 (Paquete 1B): se corrigió el bug de doble montaje en `AppSidebar` consolidando el polling
 *   en un store singleton por pestaña, se elevó el intervalo de 30s a 180s (3 min) con guardia `visibilityState === 'visible'`
 *   y refresco inmediato al volver a la pestaña, se acotó `.select(...)` a las 8 columnas usadas (eliminando `select('*')`),
 *   se empujó el filtro de lunes 6:00 AM a la consulta SQL y se deshabilitó en rutas kiosko/cocina.
 * - Fix 2026-11-20: corregida columna inexistente `resource_id` -> `reference_id` (esquema real de `public.notifications`,
 *   que provocaba error PostgreSQL `42703` serializado como `{}`), corregido borde de lunes 00:00–05:59 AM en `getMonday6AM`
 *   para respetar el inicio del día laboral a las 6:00 AM, y mejorado el formato de errores PostgREST en el bloque `catch`.
 */
'use client'

import { useState, useEffect, useRef, useSyncExternalStore } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { getSupabaseClient, getValidBrowserTegToken } from '@/lib/supabase'

interface Notification {
  id: number
  title: string
  message: string
  link: string
  created_at: string
  is_read: boolean
  type: 'alert' | 'info' | 'success' | 'warning'
  reference_id?: string | null // Para reconstruir links rotos
}

interface NotificationBellProps {
  isCollapsed?: boolean
  disabled?: boolean
  enableEntranceEffects?: boolean
}

interface NotificationStoreSnapshot {
  notifications: Notification[]
  unreadCount: number
  showAnimation: boolean
}

const POLL_INTERVAL_MS = 180_000
const DEAD_HOURS_MIN_GAP_MS = 360_000 // 6 min en madrugada 04:15–06:59 AM PT
const AUTH_BACKOFF_MS = 600_000       // 10 min backoff tras 401 / JWT expirado
const MIN_DEDUP_GAP_MS = 3_000

const EMPTY_SNAPSHOT: NotificationStoreSnapshot = {
  notifications: [],
  unreadCount: 0,
  showAnimation: false,
}

let storeSnapshot: NotificationStoreSnapshot = EMPTY_SNAPSHOT
const storeListeners = new Set<() => void>()
let activePollerSubscribers = 0
let pollIntervalId: ReturnType<typeof setInterval> | null = null
let animationTimeoutId: ReturnType<typeof setTimeout> | null = null
let hasShownEntranceAnimation = false
let inFlightFetch: Promise<void> | null = null
let lastFetchCompletedAt = 0
let visibilityListenerAttached = false
let authBlockedUntil = 0
let blockedTokenSnapshot: string | null = null

function isDeadHoursLA(): boolean {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date())
    const hh = parseInt(parts.find((p) => p.type === 'hour')?.value || '12', 10)
    const mm = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10)
    const mins = (hh === 24 ? 0 : hh) * 60 + mm
    return mins >= 255 && mins < 420
  } catch {
    return false
  }
}

function isAuth401Error(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const obj = err as { status?: unknown; code?: unknown; message?: unknown }
  const status = Number(obj.status)
  const code = typeof obj.code === 'string' ? obj.code : ''
  const msg = typeof obj.message === 'string' ? obj.message : ''
  return (
    status === 401 ||
    status === 403 ||
    code === 'PGRST301' ||
    code === 'PGRST302' ||
    /jwt|expired|unauthorized|invalid claim/i.test(msg)
  )
}

export function isNotificationKioskRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  return (
    pathname === '/order-ready-board' ||
    pathname.startsWith('/order-ready-board/') ||
    pathname === '/inventory/preparador' ||
    pathname.startsWith('/inventory/preparador/')
  )
}

function getMonday6AM(now: Date = new Date()): Date {
  const day = now.getDay()
  const diffSinceMonday = day === 0 ? 6 : day - 1
  const monday6AM = new Date(now)
  monday6AM.setDate(now.getDate() - diffSinceMonday)
  monday6AM.setHours(6, 0, 0, 0)
  // Día laboral Tacos Gavilan inicia a las 6:00 AM: lunes entre 00:00 y 05:59 aún pertenece a la semana anterior
  if (monday6AM > now) {
    monday6AM.setDate(monday6AM.getDate() - 7)
  }
  return monday6AM
}

function emitStoreUpdate(next: NotificationStoreSnapshot) {
  storeSnapshot = next
  for (const listener of storeListeners) {
    listener()
  }
}

function subscribeStore(listener: () => void): () => void {
  storeListeners.add(listener)
  return () => {
    storeListeners.delete(listener)
  }
}

function getStoreSnapshot(): NotificationStoreSnapshot {
  return storeSnapshot
}

function getServerSnapshot(): NotificationStoreSnapshot {
  return EMPTY_SNAPSHOT
}

// 🔊 Función para reproducir sonido de campana
function playBellSound() {
  try {
    if (typeof window === 'undefined') return
    const AudioCtx =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return
    const audioContext = new AudioCtx()

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

async function fetchNotificationsShared(force = false): Promise<void> {
  if (typeof window === 'undefined') return
  if (!force && typeof document !== 'undefined' && document.visibilityState !== 'visible') {
    return
  }
  if (inFlightFetch) {
    return inFlightFetch
  }
  const nowMs = Date.now()
  if (!force && lastFetchCompletedAt > 0) {
    const minGap = isDeadHoursLA() ? DEAD_HOURS_MIN_GAP_MS : MIN_DEDUP_GAP_MS
    if (nowMs - lastFetchCompletedAt < minGap) {
      return
    }
  }

  // Cortacircuito anti-401: si el JWT expiró o falta, no bombardear Supabase hasta que se renueve la sesión
  const rawToken = (() => {
    try {
      return localStorage.getItem('teg_token')
    } catch {
      return null
    }
  })()
  if (rawToken !== blockedTokenSnapshot) {
    authBlockedUntil = 0
    blockedTokenSnapshot = null
  }
  if (authBlockedUntil > nowMs) {
    return
  }
  if (!getValidBrowserTegToken()) {
    return
  }

  const run = async () => {
    try {
      const userStr = localStorage.getItem('teg_user')
      if (!userStr) return
      const user = JSON.parse(userStr) as { id?: string | number }
      if (!user?.id) return

      const supabase = await getSupabaseClient()

      // 🏁 FILTRO DE LUNES 6:00 AM (empujado directo a PostgreSQL)
      const monday6AM = getMonday6AM()

      const { data, error } = await supabase
        .from('notifications')
        .select('id, title, message, link, created_at, is_read, type, reference_id')
        .eq('user_id', String(user.id))
        .gte('created_at', monday6AM.toISOString())
        .order('created_at', { ascending: false })
        .limit(20)

      if (error) throw error

      authBlockedUntil = 0
      blockedTokenSnapshot = null

      if (data) {
        const rawNotifs = data as unknown as Notification[]
        const notifs = rawNotifs.filter((n) => new Date(n.created_at) >= monday6AM)
        const unread = notifs.filter((n) => !n.is_read).length

        let triggerAnimation = false
        if (unread > 0 && !hasShownEntranceAnimation) {
          hasShownEntranceAnimation = true
          triggerAnimation = true
          playBellSound()
          if (animationTimeoutId) clearTimeout(animationTimeoutId)
          animationTimeoutId = setTimeout(() => {
            animationTimeoutId = null
            emitStoreUpdate({
              ...storeSnapshot,
              showAnimation: false,
            })
          }, 3000)
        }

        emitStoreUpdate({
          notifications: notifs,
          unreadCount: unread,
          showAnimation: triggerAnimation ? true : storeSnapshot.showAnimation,
        })
      }
      lastFetchCompletedAt = Date.now()
    } catch (error: unknown) {
      if (isAuth401Error(error)) {
        authBlockedUntil = Date.now() + AUTH_BACKOFF_MS
        try {
          blockedTokenSnapshot = localStorage.getItem('teg_token')
        } catch {
          blockedTokenSnapshot = null
        }
        return
      }
      // 🛡️ Manejo de errores de red y PostgREST (incluye objetos planos sin prototype Error)
      const errObj =
        error && typeof error === 'object'
          ? (error as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown })
          : null
      const msg =
        error instanceof Error
          ? error.message
          : typeof errObj?.message === 'string'
            ? errObj.message
            : typeof error === 'string'
              ? error
              : String(error ?? '')
      if (
        msg.includes('Failed to fetch') ||
        msg.includes('Network request failed') ||
        msg.includes('Load failed') ||
        msg.includes('AbortError')
      ) {
        console.warn('⚠️ (Silenciado) No se pudieron cargar las notificaciones por problema de red o bloqueo.')
        return
      }
      const code = typeof errObj?.code === 'string' ? errObj.code : ''
      const details = typeof errObj?.details === 'string' ? errObj.details : ''
      const summary = [code && `code=${code}`, msg && `message=${msg}`, details && `details=${details}`]
        .filter(Boolean)
        .join(' | ')
      console.error('Error al cargar notificaciones (catch):', summary || error)
    } finally {
      inFlightFetch = null
    }
  }

  inFlightFetch = run()
  return inFlightFetch
}

function handleVisibilityChange() {
  if (
    activePollerSubscribers > 0 &&
    typeof document !== 'undefined' &&
    document.visibilityState === 'visible'
  ) {
    void fetchNotificationsShared(true)
  }
}

function acquireNotificationPoller() {
  activePollerSubscribers += 1
  if (activePollerSubscribers === 1 && typeof window !== 'undefined') {
    if (typeof document === 'undefined' || document.visibilityState === 'visible') {
      void fetchNotificationsShared(false)
    }
    pollIntervalId = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void fetchNotificationsShared(false)
      }
    }, POLL_INTERVAL_MS)
    if (typeof document !== 'undefined' && !visibilityListenerAttached) {
      document.addEventListener('visibilitychange', handleVisibilityChange)
      visibilityListenerAttached = true
    }
  }
}

function releaseNotificationPoller() {
  activePollerSubscribers = Math.max(0, activePollerSubscribers - 1)
  if (activePollerSubscribers === 0) {
    if (pollIntervalId) {
      clearInterval(pollIntervalId)
      pollIntervalId = null
    }
    if (typeof document !== 'undefined' && visibilityListenerAttached) {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      visibilityListenerAttached = false
    }
  }
}

async function markAllAsReadShared() {
  if (storeSnapshot.unreadCount === 0) return

  try {
    const unreadIds = storeSnapshot.notifications
      .filter((n) => !n.is_read)
      .map((n) => n.id)

    if (unreadIds.length > 0) {
      const supabase = await getSupabaseClient()

      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true, read: true })
        .in('id', unreadIds)

      if (error) throw error

      emitStoreUpdate({
        ...storeSnapshot,
        notifications: storeSnapshot.notifications.map((n) => ({ ...n, is_read: true })),
        unreadCount: 0,
      })
    }
  } catch (error) {
    console.error('Error:', error)
  }
}

export default function NotificationBell({
  disabled = false,
  enableEntranceEffects = true,
}: NotificationBellProps) {
  const router = useRouter()
  const pathname = usePathname()
  const isKioskRoute = isNotificationKioskRoute(pathname)
  const pollingEnabled = !disabled && !isKioskRoute

  const { notifications, unreadCount, showAnimation } = useSyncExternalStore(
    subscribeStore,
    getStoreSnapshot,
    getServerSnapshot
  )
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!pollingEnabled) return
    acquireNotificationPoller()
    return () => {
      releaseNotificationPoller()
    }
  }, [pollingEnabled])

  if (!pollingEnabled) {
    return null
  }

  const toggleDropdown = () => {
    if (!isOpen) {
      setIsOpen(true)
      void markAllAsReadShared()
    } else {
      setIsOpen(false)
    }
  }

  const handleNotificationClick = (notification: Notification) => {
    let finalLink = notification.link

    // 🛠️ PARCHE: Si el link viene sin ID (ej. "/checklists") pero hay reference_id, lo reconstruimos
    if ((finalLink === '/checklists' || finalLink === '/checklists/') && notification.reference_id) {
      finalLink = `${finalLink}?id=${notification.reference_id}`
    } else if (finalLink === '/checklists' || finalLink === '/checklists/') {
      finalLink = `${finalLink}?auto_open=latest`
    } else if ((finalLink === '/checklists-manager' || finalLink === '/checklists-manager/') && notification.reference_id) {
      finalLink = `${finalLink}?id=${notification.reference_id}`
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
      {enableEntranceEffects && showAnimation && typeof document !== 'undefined' && createPortal(
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

            <div className={`fixed z-50 top-16 left-2 right-2 w-auto md:w-96 md:left-auto md:right-4 bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-gray-200 dark:border-slate-700 overflow-hidden ring-1 ring-black/5 dark:ring-white/5 animate-in slide-in-from-top-2 fade-in duration-200 transition-all max-h-[80vh] flex flex-col max-w-[calc(100vw-16px)]`}>

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
                  Close
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
