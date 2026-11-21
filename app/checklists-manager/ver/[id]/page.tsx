'use client'

/**
 * @module app/checklists-manager/ver/[id]/page
 * @description Vista individual de detalle de Manager Checklist con autenticación RLS (`fetchWithAuth`).
 * @businessRules
 * - Consulta `manager_checklists` y el nombre de sucursal (`stores(name)`) adjuntando `teg_token` vía `fetchWithAuth`.
 * @dataFlow
 * - `params.id` -> `fetchWithAuth('/rest/v1/manager_checklists')` -> `DetailsModal`.
 * @notes
 * - Hardened 2026-11-21: Migrado de cabeceras `anon` crudas a `fetchWithAuth`.
 */

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import DetailsModal from '@/components/DetailsModal'
import LoadingSkeleton from '@/components/LoadingSkeleton'
import { fetchWithAuth } from '@/lib/supabase'

export default function VerManagerChecklistPage() {
  const params = useParams()
  const router = useRouter()
  const [checklist, setChecklist] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadChecklist()
  }, [params.id])

  const loadChecklist = async () => {
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL

      const res = await fetchWithAuth(
        `${url}/rest/v1/manager_checklists?id=eq.${encodeURIComponent(String(params.id || ''))}&select=*,stores(name)`
      )

      if (res.ok) {
        const data = await res.json()
        if (data && data.length > 0) {
          const item = data[0]
          // Agregar nombre de tienda
          item.store_name = item.stores?.name || 'N/A'
          setChecklist(item)
        } else {
          alert('Checklist no encontrado')
          router.push('/checklists-manager')
        }
      } else {
        alert('Error loading checklist')
        router.push('/checklists-manager')
      }
    } catch (error) {
      console.error('Error:', error)
      alert('Error loading checklist')
      router.push('/checklists-manager')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    router.push('/checklists-manager')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-8">
        <LoadingSkeleton />
      </div>
    )
  }

  if (!checklist) {
    return null
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <DetailsModal
        isOpen={true}
        onClose={handleClose}
        checklist={checklist}
        type="manager"
      />
    </div>
  )
}
