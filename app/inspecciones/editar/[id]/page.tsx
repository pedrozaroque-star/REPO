'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import InspectionForm from '@/components/inspections/InspectionForm'
import { supabase } from '@/lib/supabase'
import { canEditChecklist } from '@/lib/checklistPermissions'

function EditarInspeccionContent() {
  const { id } = useParams()
  const router = useRouter()
  const { user } = useAuth()
  const [inspection, setInspection] = useState<any>(null)
  const [stores, setStores] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (user && id) fetchData()
  }, [user, id])

  const fetchData = async () => {
    try {
      // 1. Cargar Tiendas
      const { data: storesData } = await supabase.from('stores').select('*').order('name')
      setStores(storesData || [])

      // 2. Cargar Inspección
      const { data: item, error: dbError } = await supabase
        .from('supervisor_inspections')
        .select('*')
        .eq('id', id)
        .single()

      if (dbError || !item) throw new Error('Inspección no encontrada')

      // 3. Validar Permiso "Mismo Día"
      // Usamos la fecha de creación (created_at) o la fecha de inspección para validar
      const dateToCheck = item.created_at || item.inspection_date
      
      const permissions = canEditChecklist(
        dateToCheck, 
        user.role, 
        item.inspector_id, 
        user.id
      )

      if (!permissions.canEdit) {
        throw new Error(permissions.reason)
      }

      setInspection(item)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <div className="flex h-screen items-center justify-center">Cargando...</div>

  if (error) return (
    <div className="flex h-screen items-center justify-center flex-col bg-gray-50">
      <div className="bg-white p-8 rounded-xl shadow-lg text-center max-w-md">
        <div className="text-5xl mb-4">⛔</div>
        <h2 className="text-2xl font-bold text-red-600 mb-2">No puedes editar esto</h2>
        <p className="text-gray-600 mb-6">{error}</p>
        <button 
          onClick={() => router.push('/inspecciones')}
          className="bg-gray-900 text-white px-6 py-2 rounded-lg hover:bg-black transition-colors"
        >
          Volver a Inspecciones
        </button>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 p-8 overflow-auto">
        <InspectionForm user={user} initialData={inspection} stores={stores} />
      </div>
    </div>
  )
}

export default function EditarInspeccionPage() {
  return <ProtectedRoute><EditarInspeccionContent /></ProtectedRoute>
}