'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import NotificationBell from './NotificationBell'
import { useState } from 'react'
import { useAuth } from './ProtectedRoute'

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { user } = useAuth()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const handleLogout = () => {
  localStorage.removeItem('teg_token')    // ← AGREGA ESTA LÍNEA
  localStorage.removeItem('teg_user')
  router.push('/login')                   // ← CAMBIA '/' por '/login'
}

  const menuItems = [
    { name: 'Dashboard', path: '/dashboard', icon: '📊', roles: ['manager', 'supervisor', 'admin'] },
    { name: 'Tiendas', path: '/tiendas', icon: '🏪', roles: ['admin'] },
    { name: 'Horarios', path: '/horarios', icon: '📅', roles: ['manager', 'supervisor', 'admin'] },
    { name: 'Usuarios', path: '/usuarios', icon: '👥', roles: ['admin'] },
    { name: 'Inspecciones', path: '/inspecciones', icon: '📋', roles: ['supervisor', 'admin'] },
    { name: 'Checklists Manager', path: '/checklists-manager', icon: '👔', roles: ['manager', 'supervisor', 'admin'] },
    { name: 'Checklists', path: '/checklists', icon: '✅', roles: ['asistente', 'manager', 'supervisor', 'admin'] },
    { name: 'Feedback Clientes', path: '/feedback', icon: '💬', roles: ['asistente', 'manager', 'supervisor', 'admin'] },
    { name: 'Reportes', path: '/reportes', icon: '📈', roles: ['manager', 'supervisor', 'admin'] },
    { name: 'Estadísticas', path: '/estadisticas', icon: '📉', roles: ['manager', 'supervisor', 'admin'] }
  ]

  const filteredMenuItems = menuItems.filter((item) => {
    if (!item.roles || item.roles.length === 0) return true
    if (!user?.role) return false
    return item.roles.includes(user.role.toLowerCase())
  })

  return (
    <>
      {/* Sidebar para Desktop */}
      <div className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0">
        <div className="flex flex-col flex-grow bg-gradient-to-b from-indigo-700 to-indigo-900 overflow-hidden">
          {/* Logo */}
          <div className="flex items-center flex-shrink-0 px-4 py-5">
            <h1 className="text-2xl font-bold text-white">🌮 Tacos Gavilan</h1>
          </div>

          {/* Navigation - Con scroll */}
          <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
            {filteredMenuItems.map((item) => {
              const isActive = pathname === item.path
              return (
                <Link
                  key={item.name}
                  href={item.path}
                  className={`
                    group flex items-center px-4 py-3 text-sm font-medium rounded-lg transition-all
                    ${isActive 
                      ? 'bg-indigo-800 text-white shadow-lg' 
                      : 'text-indigo-100 hover:bg-indigo-600 hover:text-white'
                    }
                  `}
                >
                  <span className="mr-3 text-xl">{item.icon}</span>
                  {item.name}
                </Link>
              )
            })}
          </nav>

          {/* User Info - Fixed en la parte inferior */}
          <div className="flex-shrink-0 border-t border-indigo-800">
            {/* Fila de usuario y notificaciones */}
            <div className="px-4 py-3 flex items-center gap-3">
              <div className="flex-shrink-0">
                <div className="h-10 w-10 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold border-2 border-indigo-400">
                  {user?.name?.[0] || user?.email?.[0] || '?'}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">
                  {user?.name || user?.email}
                </p>
                <p className="text-xs text-indigo-300">
                  {user?.role || 'Usuario'}
                </p>
              </div>
              <NotificationBell />
            </div>
            
            {/* Botón de logout */}
            <div className="px-4 pb-4">
              <button
                onClick={handleLogout}
                className="w-full flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-500 transition-all"
              >
                🚪 Cerrar Sesión
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Menu Button */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-indigo-700 px-4 py-3 flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">🌮 Tacos Gavilan</h1>
        <div className="flex items-center gap-2">
          <NotificationBell />
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="text-white p-2"
          >
            {mobileMenuOpen ? '✕' : '☰'}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-30 bg-black bg-opacity-50" onClick={() => setMobileMenuOpen(false)}>
          <div className="fixed inset-y-0 left-0 w-64 bg-gradient-to-b from-indigo-700 to-indigo-900 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="pt-16 pb-4 flex flex-col h-full">
              {/* Navigation */}
              <nav className="flex-1 px-2 space-y-1 overflow-y-auto">
                {filteredMenuItems.map((item) => {
                  const isActive = pathname === item.path
                  return (
                    <Link
                      key={item.name}
                      href={item.path}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`
                        group flex items-center px-4 py-3 text-sm font-medium rounded-lg transition-all
                        ${isActive 
                          ? 'bg-indigo-800 text-white shadow-lg' 
                          : 'text-indigo-100 hover:bg-indigo-600 hover:text-white'
                        }
                      `}
                    >
                      <span className="mr-3 text-xl">{item.icon}</span>
                      {item.name}
                    </Link>
                  )
                })}
              </nav>

              {/* User Info */}
              <div className="flex-shrink-0 border-t border-indigo-800 mt-4">
                <div className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-shrink-0">
                    <div className="h-10 w-10 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold border-2 border-indigo-400">
                      {user?.name?.[0] || user?.email?.[0] || '?'}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">
                      {user?.name || user?.email}
                    </p>
                    <p className="text-xs text-indigo-300">
                      {user?.role || 'Usuario'}
                    </p>
                  </div>
                </div>
                
                <div className="px-4 pb-4">
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-500 transition-all"
                  >
                    🚪 Cerrar Sesión
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}