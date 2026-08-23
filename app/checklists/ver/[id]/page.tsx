'use client'

/**
 * @module app/checklists/ver/[id]/page
 * @description Pantalla directa para visualizar o auditar un checklist específico mediante su ID.
 * @businessRules
 * - Requiere autenticación activa del usuario.
 * - Renderiza el visor moderno ChecklistReviewModal con soporte completo para fotos, chat y plantillas dinámicas.
 * @dataFlow
 * - Supabase ('assistant_checklists' + 'stores' + 'users') -> ChecklistReviewModal.
 * @notes Reemplaza el modal legacy DetailsModal por ChecklistReviewModal estándar.
 */

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import ChecklistReviewModal from '@/components/ChecklistReviewModal'
import SurpriseLoader from '@/components/SurpriseLoader'
import { getSupabaseClient, formatStoreName } from '@/lib/supabase'

function VerChecklistContent() {
  const params = useParams()
  const router = useRouter()
  const { user } = useAuth()
  const [checklist, setChecklist] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (params.id) {
      loadChecklist()
    }
  }, [params.id])

  const loadChecklist = async () => {
    try {
      const supabase = await getSupabaseClient()
      const { data, error } = await supabase
        .from('assistant_checklists')
        .select('*, stores(name, code), users!user_id(full_name)')
        .eq('id', params.id)
        .single()

      if (data && !error) {
        const formatted = {
          ...data,
          store_name: formatStoreName((data as any).stores?.name) || 'N/A'
        }
        setChecklist(formatted)
      } else {
        router.push('/checklists')
      }
    } catch (error) {
      console.error('Error loading checklist:', error)
      router.push('/checklists')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    router.push('/checklists')
  }

  if (loading) {
    return <SurpriseLoader />
  }

  if (!checklist || !user) {
    return null
  }

  return (
    <div className="min-h-screen bg-transparent dark:bg-neutral-900">
      <ChecklistReviewModal
        isOpen={true}
        onClose={handleClose}
        checklist={checklist}
        currentUser={{
          id: user.id,
          name: user.name || user.email,
          email: user.email,
          role: user.role
        }}
        onUpdate={() => {
          loadChecklist()
        }}
      />
    </div>
  )
}

export default function VerAssistantChecklistPage() {
  return (
    <ProtectedRoute>
      <VerChecklistContent />
    </ProtectedRoute>
  )
}

