'use client'

import { useEffect, useState } from 'react'
import Sidebar from '@/components/Sidebar'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import InspectionForm from '@/components/inspections/InspectionForm'
import { supabase } from '@/lib/supabase'

function NuevaInspeccionContent() {
  const { user } = useAuth()
  const [stores, setStores] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchStores = async () => {
      const { data } = await supabase.from('stores').select('*').order('name')
      setStores(data || [])
      setLoading(false)
    }
    fetchStores()
  }, [])

  if (loading) return <div className="flex h-screen items-center justify-center">Cargando...</div>

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 p-8 overflow-auto">
        <InspectionForm user={user} stores={stores} />
      </div>
    </div>
  )
}

export default function NuevaInspeccionPage() {
  return <ProtectedRoute><NuevaInspeccionContent /></ProtectedRoute>
}