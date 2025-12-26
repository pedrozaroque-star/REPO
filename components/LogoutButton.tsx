'use client'

import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'

export default function LogoutButton() {
  const router = useRouter()

  const handleLogout = () => {
    // Limpiar localStorage
    localStorage.removeItem('teg_token')
    localStorage.removeItem('teg_user')
    
    // Redirigir a login
    router.push('/login')
  }

  return (
    <button
      onClick={handleLogout}
      className="flex items-center gap-2 px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
      title="Cerrar sesión"
    >
      <LogOut className="w-5 h-5" />
      <span className="font-medium">Salir</span>
    </button>
  )
}