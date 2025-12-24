'use client'

import { useState, useEffect } from 'react'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import { useSearchParams } from 'next/navigation'

interface Store {
  id: string
  name: string
}

const ITEMS = [
  'Desarmar alarma y validar que estaba activada',
  'Encendido de vaporeras',
  'Encendido de refrigeradores',
  'Encendido de planchas',
  'Encendido de luces en linea y salon',
  'Encendido de pantallas y TVs',
  'Revision de baños, salon y parking',
  'Recepcion de mercancias adecuado',
  'Ordenar todas las mercancias en su lugar correspondiente',
  'Limpieza de Walking',
  'Apertura de Restaurante en tiempo',
  'Linea de produccion abastecida',
  'Apertura correcta de las cajas'
]

function AperturaPageContent() {
  const searchParams = useSearchParams()
  const storeParam = searchParams.get('store')
  
  const [showThanks, setShowThanks] = useState(false)
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(false)
  
  const [formData, setFormData] = useState({
    store_id: storeParam || '',
    checklist_date: new Date().toISOString().split('T')[0],
    start_time: new Date().toTimeString().slice(0, 5),
    shift: 'AM' as 'AM' | 'PM',
    comments: '',
    photos: [] as File[]
  })
  
  const [answers, setAnswers] = useState<{[key: string]: 'SI' | 'NO' | 'NA' | null}>({})
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([])

  useEffect(() => {
  fetchStores()
}, [])

  const fetchStores = async () => {
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

      const res = await fetch(`${url}/rest/v1/stores?select=id,name&order=name.asc`, {
        headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` }
      })
      const data = await res.json()
      setStores(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Error:', err)
    }
  }

  const handleAnswer = (idx: number, value: 'SI' | 'NO' | 'NA') => {
    setAnswers(prev => ({...prev, [`item_${idx}`]: value}))
  }

  const calculateScore = (): number => {
    const values = Object.values(answers).filter(v => v !== null)
    const siCount = values.filter(v => v === 'SI').length
    if (values.length === 0) return 0
    return Math.round((siCount / values.length) * 100)
  }

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return
    const files = Array.from(e.target.files).slice(0, 10)
    setFormData({...formData, photos: files})
    
    const previews: string[] = []
    let loaded = 0
    
    files.forEach(file => {
      const reader = new FileReader()
      reader.onload = (e) => {
        if (e.target?.result) {
          previews.push(e.target.result as string)
          loaded++
          if (loaded === files.length) setPhotoPreviews([...previews])
        }
      }
      reader.readAsDataURL(file)
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.store_id) {
      alert('Por favor selecciona una sucursal')
      return
    }
    if (!formData.assistant_name.trim()) {
      alert('No se pudo obtener información del usuario')
      return
    }
    
    const answered = Object.keys(answers).length
    
    if (answered < ITEMS.length) {
      alert(`Por favor responde TODAS las preguntas (${answered}/${ITEMS.length})`)
      return
    }

    setLoading(true)

    try {
      let photoUrls: string[] = []
      if (formData.photos.length > 0) {
        const { uploadPhotos } = await import('@/lib/uploadPhotos')
        const prefix = `${formData.store_id}_apertura_${formData.checklist_date}`
        photoUrls = await uploadPhotos(formData.photos, 'staff-photos', prefix)
      }

      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

      const endTime = new Date().toTimeString().slice(0, 5)

      const payload = {
        store_id: formData.store_id,
        user_id: user.id,
        assistant_name: user.name,
        created_by: user.name,
        checklist_type: 'apertura',
        checklist_date: formData.checklist_date,
        start_time: formData.start_time,
        end_time: endTime,
        shift: formData.shift,
        answers: answers,
        score: calculateScore(),
        comments: formData.comments || null,
        photo_urls: photoUrls.length > 0 ? photoUrls : null
      }

      const res = await fetch(`${url}/rest/v1/assistant_checklists`, {
        method: 'POST',
        headers: {
          'apikey': key || '',
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(payload)
      })

      if (res.ok) {
        setShowThanks(true)
      } else {
        alert('Error al enviar. Intenta de nuevo.')
      }
    } catch (err) {
      alert('Error al enviar. Intenta de nuevo.')
    }

    setLoading(false)
  }

export default function AperturaPage() {
  return (
    <ProtectedRoute>
      <AperturaPageContent />
    </ProtectedRoute>
  )
}
