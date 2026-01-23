'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import NotificationBell from './NotificationBell'
import { useState, useMemo, useEffect } from 'react'
import { useAuth } from './ProtectedRoute'
import { getSupabaseClient } from '@/lib/supabase'
import { ChevronDown, ChevronRight, ChevronsUpDown, ChevronLeft, PanelLeftClose, PanelLeft, QrCode } from 'lucide-react'

interface SidebarProps {
  isCollapsed: boolean
  setIsCollapsed: (value: boolean) => void
}

// Definición de tipos para los ítems y grupos
type MenuItem = {
  name: string
  path: string
  icon: React.ReactNode
  roles: string[]
}

type MenuGroup = {
  title: string
  id: string
  items: MenuItem[]
}

export default function Sidebar({ isCollapsed, setIsCollapsed }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { user } = useAuth()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // Estado para manejar qué grupos están expandidos
  // Inicialmente todos abiertos o cerrados según preferencia. Aquí los dejo abiertos por default.
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    'operaciones': true,
    'gestion': true,
    'analisis': true,
    'kioskos': true
  })

  // Estructura de grupos
  const menuGroups: MenuGroup[] = [
    {
      title: 'OPERACIONES',
      id: 'operaciones',
      items: [
        { name: 'Supervisor', path: '/inspecciones', icon: '📋', roles: ['supervisor', 'admin'] },
        { name: 'Manager', path: '/checklists-manager', icon: '👔', roles: ['manager', 'supervisor', 'admin'] },
        { name: 'Asistentes', path: '/checklists', icon: '✅', roles: ['asistente', 'manager', 'supervisor', 'admin'] },
        { name: 'Horarios', path: '/horarios', icon: '📅', roles: ['manager', 'supervisor', 'admin'] },
        { name: 'Dashboard', path: '/dashboard', icon: '📊', roles: ['manager', 'supervisor', 'admin'] },
      ]
    },
    {
      title: 'GESTIÓN',
      id: 'gestion',
      items: [
        { name: 'Tiendas', path: '/tiendas', icon: '🏪', roles: ['admin'] },
        { name: 'Usuarios', path: '/usuarios', icon: '👥', roles: ['admin', 'supervisor'] },
        { name: 'Plantillas', path: '/admin/plantillas', icon: '📝', roles: ['admin'] },
      ]
    },
    {
      title: 'ANÁLISIS',
      id: 'analisis',
      items: [
        { name: 'Ventas', path: '/ventas', icon: '💰', roles: ['admin', 'manager', 'supervisor'] },
        { name: 'Reportes Ops', path: '/ventas/reportes', icon: '📈', roles: ['manager', 'supervisor', 'admin'] },
        { name: 'Planificador', path: '/planificador', icon: '📅', roles: ['manager', 'supervisor', 'admin'] },
        { name: 'Feedback Clientes', path: '/feedback', icon: '💬', roles: ['asistente', 'manager', 'supervisor', 'admin'] },
      ]
    },
    {
      title: 'KIOSKS QR',
      id: 'kioskos',
      items: [
        { name: 'Feedback Clientes', path: '/clientes', icon: <QrCode size={18} />, roles: ['admin', 'manager'] },
        { name: 'Eval. Staff', path: '/evaluacion', icon: <QrCode size={18} />, roles: ['admin', 'manager'] },
      ]
    }
  ]

  const handleLogout = () => {
    localStorage.removeItem('teg_token')
    localStorage.removeItem('teg_user')
    router.push('/login')
  }

  // Filtrar grupos y sus items según el rol del usuario
  const filteredGroups = useMemo(() => {
    return menuGroups.map(group => {
      const validItems = group.items.filter(item => {
        if (!item.roles || item.roles.length === 0) return true
        if (!user?.role) return false
        return item.roles.includes(user.role.toLowerCase())
      })
      return { ...group, items: validItems }
    }).filter(group => group.items.length > 0)
  }, [user])

  // 🧹 LIMPIEZA SEMANAL DE NOTIFICACIONES (Lunes)
  useEffect(() => {
    const runWeeklyCleanup = async () => {
      if (!user) return

      const now = new Date()
      const isMonday = now.getDay() === 1
      const isAfter6AM = now.getHours() >= 6
      const todayStr = now.toISOString().split('T')[0]
      const lastCleanup = localStorage.getItem('last_week_cleanup')

      if (isMonday && isAfter6AM && lastCleanup !== todayStr) {
        try {
          // 🧹 LIMPIEZA TOTAL DE LUNES (PRE-6AM)
          // El usuario quiere empezar los lunes de cero, borrando todo lo anterior a las 6am
          const monday6AM = new Date(now)
          monday6AM.setHours(6, 0, 0, 0)

          const supabase = await getSupabaseClient()
          await supabase
            .from('notifications')
            .delete()
            .eq('user_id', user.id)
            .lt('created_at', monday6AM.toISOString())

          localStorage.setItem('last_week_cleanup', todayStr)
          // console.log('🧹 Limpieza semanal de notificaciones ejecutada.')
        } catch (e) {
          // console.error('Error en limpieza de notificaciones:', e)
        }
      }
    }
    runWeeklyCleanup()
  }, [user])

  // Toggle de un grupo individual
  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [groupId]: !prev[groupId]
    }))
  }

  // Toggle de todos los grupos
  const toggleAll = () => {
    const allOpen = Object.values(expandedGroups).every(v => v)
    const newState = filteredGroups.reduce((acc, group) => {
      acc[group.id] = !allOpen
      return acc
    }, {} as Record<string, boolean>)
    setExpandedGroups(newState)
  }

  return (
    <>
      {/* Sidebar para Desktop */}
      {/* Sidebar para Desktop */}
      <div className={`hidden lg:flex ${isCollapsed ? 'lg:w-20' : 'lg:w-64'} lg:flex-col lg:fixed lg:inset-y-0 transition-all duration-300 z-50`}>
        {/* Disparador Circular Minimalista - FUERA del overflow-hidden */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={`
            absolute -right-5 top-12 
            w-10 h-10 flex items-center justify-center
            bg-white text-red-900 rounded-full shadow-[0_4px_20px_rgba(0,0,0,0.15)] border border-gray-200
            hover:scale-110 hover:shadow-[0_8px_30px_rgba(0,0,0,0.2)] transition-all duration-300 z-[70]
          `}
          title={isCollapsed ? "Expandir" : "Contraer"}
        >
          <div className="bg-red-50 w-full h-full rounded-full flex items-center justify-center border border-red-100">
            {isCollapsed ? <ChevronRight size={20} strokeWidth={2.5} /> : <ChevronLeft size={20} strokeWidth={2.5} />}
          </div>
        </button>

        {/* Degradado rojo vibrante a rojo oscuro - SIN NEGRO PURO */}
        <div className="flex flex-col flex-grow bg-gradient-to-b from-red-600 via-red-800 to-red-950 overflow-hidden shadow-2xl border-r border-red-900/30 relative">

          {/* Header con Logo y Link al Dashboard */}
          <Link
            href="/dashboard"
            className="group flex flex-col items-center flex-shrink-0 px-2 pt-8 pb-4 relative cursor-pointer"
          >
            <div className={`relative ${isCollapsed ? 'w-14 h-14' : 'w-42 h-42'} mb-6 bg-white rounded-full shadow-[0_0_25px_rgba(255,255,255,0.3)] border-2 border-yellow-400 transition-all duration-500 group-hover:rotate-6 overflow-hidden`}>
              <div className="w-full h-full flex items-center justify-center p-2">
                <img
                  src="/logo.png"
                  alt="Tacos Gavilan Logo"
                  className="w-full h-full object-contain"
                />
              </div>
            </div>

            {!isCollapsed && (
              <div className="text-center">
                <div className="transition-all duration-500 group-hover:rotate-6">
                  <h2 className="text-white font-black tracking-tighter text-2xl drop-shadow-lg">Tacos Gavilan</h2>
                </div>
                {/* Botón de colapsar grupos (mantenemos fuera de la animación de rotación pero dentro del área táctil si se prefiere, aunque mejor separar la acción) */}
              </div>
            )}
          </Link>

          {!isCollapsed && (
            <div className="px-2 pb-4 flex justify-center">
              <button
                onClick={toggleAll}
                className="text-[10px] uppercase font-bold tracking-[0.2em] text-yellow-400/80 hover:text-white flex items-center justify-center gap-1 transition-colors mx-auto relative z-10"
              >
                <ChevronsUpDown size={12} />
                {Object.values(expandedGroups).every(v => v) ? 'Colapsar Grupos' : 'Abrir Grupos'}
              </button>
            </div>
          )}

          {/* Navigation - Con scroll oculto visualmente pero funcional */}
          <nav className="flex-1 px-3 py-2 space-y-4 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
            {filteredGroups.map((group) => {
              const isOpen = expandedGroups[group.id]

              return (
                <div key={group.id} className="space-y-1">
                  {/* Título del Grupo (Clickable) */}
                  {!isCollapsed ? (
                    <button
                      onClick={() => toggleGroup(group.id)}
                      className="w-full flex items-center justify-between px-3 py-2 text-xs font-bold text-yellow-400 uppercase tracking-widest hover:text-white transition-colors drop-shadow-md"
                    >
                      {group.title}
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                  ) : (
                    <div className="h-0 border-t-2 border-yellow-400/60 my-4 mx-3 shadow-sm" />
                  )}

                  {/* Items del Grupo */}
                  {(isOpen || isCollapsed) && (
                    <div className="space-y-1">
                      {group.items.map((item) => {
                        const isActive = pathname === item.path
                        return (
                          <Link
                            key={item.name}
                            href={item.path}
                            className={`
                              group flex items-center ${isCollapsed ? 'justify-center' : 'px-3'} py-2.5 text-sm font-medium rounded-xl transition-all duration-200 relative
                              ${isActive
                                ? 'bg-gradient-to-r from-red-700 to-red-900 text-white shadow-lg border border-red-600/30' + (!isCollapsed ? ' translate-x-1' : '')
                                : 'text-gray-300 hover:bg-white/10 hover:text-white' + (!isCollapsed ? ' hover:translate-x-1' : '')
                              }
                            `}
                          >
                            <span className={`${isCollapsed ? 'mr-0' : 'mr-3'} text-base ${isActive ? 'scale-110' : 'group-hover:scale-110'} transition-transform`}>
                              {item.icon}
                            </span>
                            {!isCollapsed && item.name}

                            {/* Custom Tooltip for Collapsed Mode */}
                            {isCollapsed && (
                              <div className="fixed left-20 ml-2 px-4 py-2 bg-gradient-to-r from-red-800 to-red-950 text-yellow-400 text-sm font-bold rounded-lg shadow-2xl border border-yellow-400/20 opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-200 translate-x-2 group-hover:translate-x-0 whitespace-nowrap z-[100]">
                                {item.name}
                                {/* Tooltip Arrow */}
                                <div className="absolute left-[-6px] top-1/2 -translate-y-1/2 w-3 h-3 bg-red-800 rotate-45 border-l border-b border-yellow-400/20" />
                              </div>
                            )}
                          </Link>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </nav>

          {/* User Info - Fixed en la parte inferior */}
          <div className="flex-shrink-0 bg-black/40 backdrop-blur-md border-t border-red-900/30">
            {/* Fila de usuario y notificaciones */}
            <div className={`px-4 py-4 flex items-center ${isCollapsed ? 'flex-col gap-6' : 'gap-3'}`}>
              <div className="flex-shrink-0">
                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-red-600 to-red-800 flex items-center justify-center text-white font-bold border-2 border-red-400 shadow-lg">
                  {user?.name?.[0] || user?.email?.[0] || '?'}
                </div>
              </div>
              {!isCollapsed && (
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white truncate">
                    {user?.name || user?.email}
                  </p>
                  <p className="text-xs text-red-300 font-medium">
                    {user?.role || 'Usuario'}
                  </p>
                </div>
              )}
              <div className={`${isCollapsed ? 'mb-2' : ''}`}>
                <NotificationBell isCollapsed={isCollapsed} />
              </div>
            </div>

            {/* Botón de logout */}
            <div className="px-4 pb-4">
              <button
                onClick={handleLogout}
                className={`group w-full flex items-center justify-center gap-2 ${isCollapsed ? 'px-2' : 'px-4'} py-2.5 text-sm font-bold text-white bg-gradient-to-r from-red-700 to-red-600 rounded-xl hover:from-red-600 hover:to-red-500 shadow-lg transition-all active:scale-95 relative`}
              >
                <span>🚪</span> {!isCollapsed && 'Cerrar Sesión'}

                {isCollapsed && (
                  <div className="fixed left-20 ml-2 px-4 py-2 bg-gradient-to-r from-red-800 to-red-950 text-yellow-400 text-sm font-bold rounded-lg shadow-2xl border border-yellow-400/20 opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-200 translate-x-2 group-hover:translate-x-0 whitespace-nowrap z-[100]">
                    Cerrar Sesión
                    <div className="absolute left-[-6px] top-1/2 -translate-y-1/2 w-3 h-3 bg-red-800 rotate-45 border-l border-b border-yellow-400/20" />
                  </div>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Menu Button - Ajustado al nuevo tema */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-gradient-to-r from-red-600 to-red-900 px-4 py-3 flex items-center justify-between shadow-lg">
        <div className="h-8 w-8 relative">
          <img src="/logo.png" alt="Logo" className="w-full h-full object-contain" />
        </div>
        <div className="flex items-center gap-2">
          <NotificationBell />
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="text-white p-2 hover:bg-white/10 rounded-lg"
          >
            {mobileMenuOpen ? '✕' : '☰'}
          </button>
        </div>
      </div>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-30 bg-black/80 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)}>
          <div className="fixed inset-y-0 left-0 w-72 bg-gradient-to-b from-red-600 via-red-800 to-red-950 overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="pt-20 pb-4 flex flex-col h-full">

              {/* Mobile Navigation */}
              <nav className="flex-1 px-3 space-y-4">
                {filteredGroups.map((group) => {
                  const isOpen = expandedGroups[group.id] ?? true // En mobile por default abierto si no está definido
                  return (
                    <div key={group.id} className="space-y-1">
                      <div className="px-3 py-2 text-xs font-bold text-yellow-400 uppercase tracking-widest border-b border-red-800/30 mb-2 drop-shadow-md">
                        {group.title}
                      </div>

                      {group.items.map((item) => {
                        const isActive = pathname === item.path
                        return (
                          <Link
                            key={item.name}
                            href={item.path}
                            onClick={() => setMobileMenuOpen(false)}
                            className={`
                              group flex items-center px-3 py-3 text-sm font-medium rounded-xl transition-all
                              ${isActive
                                ? 'bg-red-800/50 text-white border border-red-500/30'
                                : 'text-red-100 hover:bg-white/10 hover:text-white'
                              }
                            `}
                          >
                            <span className="mr-3 text-xl">{item.icon}</span>
                            {item.name}
                          </Link>
                        )
                      })}
                    </div>
                  )
                })}
              </nav>

              {/* Mobile User Info */}
              <div className="flex-shrink-0 border-t border-red-900/50 mt-4 bg-black/20 p-4">
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-10 w-10 rounded-full bg-red-600 flex items-center justify-center text-white font-bold">
                    {user?.name?.[0] || '?'}
                  </div>
                  <div>
                    <p className="text-white font-bold">{user?.name}</p>
                    <p className="text-xs text-red-300">{user?.role}</p>
                  </div>
                </div>
                <button
                  onClick={handleLogout}
                  className="w-full py-3 bg-red-700 text-white rounded-xl font-bold active:scale-95 transition-transform"
                >
                  Cerrar Sesión
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
