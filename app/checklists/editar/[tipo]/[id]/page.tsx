'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import { canEditChecklist } from '@/lib/checklistPermissions'
import { supabase } from '@/lib/supabase'
import ChecklistForm from '@/components/checklists/ChecklistForm' // ✅ Importamos el Universal

function EditChecklistContent() {
  const params = useParams()
  const router = useRouter()
  const { user } = useAuth()
  const [checklist, setChecklist] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const tipo = params?.tipo as string
  const id = params?.id as string

  useEffect(() => {
    if (user && id) fetchChecklist()
  }, [user, id])

  const fetchChecklist = async () => {
    try {
      // 1. Cargar datos
      const { data, error } = await supabase
        .from('assistant_checklists')
        .select('*')
        .eq('id', id)
        .single()
      
      if (error || !data) throw new Error('Checklist no encontrado')

      // 2. Permisos (Usando tu lógica blindada)
      const dateToCheck = data.checklist_date || data.created_at
      const perms = canEditChecklist(dateToCheck, user.role, data.user_id, user.id)
      
      if (!perms.canEdit) throw new Error(perms.reason)

      setChecklist(data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return (
    <div className="flex min-h-screen bg-gray-50"><Sidebar />
      <div className="flex-1 flex items-center justify-center"><p className="animate-pulse">Cargando...</p></div>
    </div>
  )

  if (error) return (
    <div className="flex min-h-screen bg-gray-50"><Sidebar />
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <h2 className="text-2xl font-bold text-red-600 mb-2">Acceso Denegado</h2>
        <p className="text-gray-600 mb-4">{error}</p>
        <button onClick={() => router.push('/checklists')} className="text-blue-600 hover:underline">Volver</button>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-screen bg-gray-50 font-sans text-gray-900">
      <Sidebar />
      <div className="flex-1 p-8 overflow-y-auto h-screen">
        <div className="max-w-4xl mx-auto">
          <button onClick={() => router.back()} className="mb-6 text-sm font-bold text-gray-500 hover:text-gray-900 flex items-center gap-2">
            ← Volver al listado
          </button>
          
          {/* ✅ AQUÍ ESTÁ LA MAGIA: El mismo formulario para todos */}
          <ChecklistForm 
            user={user} 
            initialData={checklist} 
            type={tipo} // Le pasamos el tipo ('temperaturas', 'daily', etc.)
          />
        </div>
      </div>
    </div>
  )
}

export default function EditChecklistPage() {
  return <ProtectedRoute><EditChecklistContent /></ProtectedRoute>
}