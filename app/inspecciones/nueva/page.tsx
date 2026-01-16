'use client'

import { useEffect, useState } from 'react'

import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import InspectionForm from '@/components/inspections/InspectionForm'
import { supabase } from '@/lib/supabase'
import SurpriseLoader from '@/components/SurpriseLoader'

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

  if (loading) return <SurpriseLoader />

  return (
    <div className="flex min-h-screen">
      <div className="flex-1 overflow-auto">
        <InspectionForm user={user} stores={stores} />
      </div>
    </div>
  )
}

export default function NuevaInspeccionPage() {
  return <ProtectedRoute><NuevaInspeccionContent /></ProtectedRoute>
}