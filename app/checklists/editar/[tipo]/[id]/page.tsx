'use client'

/**
 * @module app/checklists/editar/[tipo]/[id]/page
 * @description Pantalla universal para editar checklists operativos existentes de asistentes y gerentes.
 * @businessRules
 * - Valida permisos de edición estrictos según rol y ventana de tiempo mediante canEditChecklist.
 * - Respeta la regla de jornada laboral (6:00 AM a 5:59 AM) para edición en el mismo turno o corrección de rechazo.
 * @dataFlow
 * - Supabase ('assistant_checklists' o 'manager_checklists') -> ChecklistForm (Modo Edición).
 * @notes Corrige el envío de la fecha de negocio dateToCheck a canEditChecklist para evitar bloqueos nocturnos.
 */

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import { canEditChecklist } from '@/lib/checklistPermissions'
import { getSupabaseClient } from '@/lib/supabase'
import ChecklistForm from '@/components/checklists/ChecklistForm'
import SurpriseLoader from '@/components/SurpriseLoader'
import '@/app/checklists/checklists.css'

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
      if (!user) return
      const supabase = await getSupabaseClient()

      // 1. Cargar datos según tipo (asistente vs manager)
      const tableName = tipo === 'manager' ? 'manager_checklists' : 'assistant_checklists'
      const { data, error } = await supabase
        .from(tableName)
        .select('*')
        .eq('id', id)
        .single()

      if (error || !data) throw new Error('Checklist no encontrado')

      // 2. Permisos (Usando fecha de negocio o created_at)
      const dateToCheck = data.checklist_date || data.created_at

      // Determinar qué estatus revisar según el tipo
      const statusToCheck = tipo === 'manager' ? data.estatus_supervisor : data.estatus_manager

      const perms = canEditChecklist(dateToCheck, user.role, data.user_id, user.id, statusToCheck)

      if (!perms.canEdit) throw new Error(perms.reason)

      setChecklist(data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <SurpriseLoader />

  if (error) return (
    <div className="flex min-h-screen">
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <h2 className="text-2xl font-bold text-red-600 mb-2">Acceso Denegado</h2>
        <p className="text-gray-600 mb-4">{error}</p>
        <button onClick={() => router.push('/checklists')} className="text-blue-600 hover:underline">Volver</button>
      </div>
    </div>
  )

  return (

    <div className="flex min-h-screen font-sans text-gray-900 checklist-container">
      <div className="flex-1 p-8">
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