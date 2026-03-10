'use client'

import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

function TvViewerContent() {
  const searchParams = useSearchParams()
  const storeParam = searchParams.get('store')?.toUpperCase() || 'ALL'
  const screenParam = parseInt(searchParams.get('screen') || '1')

  const [images, setImages] = useState<any[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [errorStatus, setErrorStatus] = useState<string | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  // Función para obtener la hora actual en la zona de Los Angeles en formato HH:MM
  const getCurrentLATime = () => {
    const now = new Date()
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23' // Use 00-23 format reliably
    })
    const parts = formatter.formatToParts(now)
    const hour = parts.find(p => p.type === 'hour')?.value || '00'
    const minute = parts.find(p => p.type === 'minute')?.value || '00'

    return `${hour}:${minute}`
  }

  const fetchActiveMenu = useCallback(async () => {
    try {
      setLoading(true)
      const currentTime = getCurrentLATime()

      // 1. Obtener todas las imágenes de ESTA PANTALLA
      const { data: imgs, error: imgsError } = await supabase
        .from('tv_images')
        .select('*')
        .eq('screen_number', screenParam)
        .order('sort_order', { ascending: true })

      if (imgsError) throw imgsError

      if (!imgs || imgs.length === 0) {
        setImages([])
        setErrorStatus('No hay imágenes configuradas para esta pantalla')
        setLoading(false)
        return
      }

      setErrorStatus(null)

      // 2. Procesar imágenes localmente: Priorizar Horarios Programados vs Fijos
      const activeScheduledImages: any[] = []
      const alwaysOnImages: any[] = []

      for (const img of imgs) {
        if (img.is_always) {
          alwaysOnImages.push(img)
          continue
        }

        // Evaluar si la imagen programada está dentro de su horario
        let start = (img.start_time || '00:00').substring(0, 5)
        let end = (img.end_time || '23:59').substring(0, 5)

        // Excepciones por tienda
        const schedules = img.custom_schedules || []
        const storeException = schedules.find((s: any) => s.store_id === storeParam)
        if (storeException) {
          start = storeException.start_time.substring(0, 5)
          end = storeException.end_time.substring(0, 5)
        }

        let isActive = false
        if (start > end) {
          isActive = currentTime >= start || currentTime < end
        } else {
          isActive = currentTime >= start && currentTime < end
        }

        if (isActive) {
          activeScheduledImages.push(img)
        }
      }

      // REGLAS: Si hay un horario activo (ej. Desayuno), toma control TOTAL de la pantalla.
      // Si no, caemos en las imágenes Siempre Visibles (Fijas/Almuerzo/Cena).
      if (activeScheduledImages.length > 0) {
        setImages(activeScheduledImages)
      } else if (alwaysOnImages.length > 0) {
        setImages(alwaysOnImages)
      } else {
        setImages([])
        setErrorStatus('Menú en pausa temporal - Fuera de horario')
      }

      setCurrentIndex(0)

    } catch (err) {
      console.error('Error fetching TV menu:', err)
      setErrorStatus('Error de conexión')
    } finally {
      setLoading(false)
    }
  }, [storeParam, screenParam])

  // Verificar el horario activo y obtener datos iniciales periodicamente (cada 1 minutos) por si cambia el bloque solos
  useEffect(() => {
    fetchActiveMenu()
    const pollInterval = setInterval(fetchActiveMenu, 60 * 1000)
    return () => clearInterval(pollInterval)
  }, [fetchActiveMenu])

  // Lógica de Supabase Realtime para actualización instantánea
  useEffect(() => {
    const channelImages = supabase.channel('schema-db-changes-images')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tv_images' }, () => {
        fetchActiveMenu()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channelImages)
    }
  }, [fetchActiveMenu])

  // Lógica de Rotación (Slideshow)
  useEffect(() => {
    if (images.length <= 1) return

    const currentImage = images[currentIndex]
    const durationMs = (currentImage?.duration_seconds || 15) * 1000

    timerRef.current = setTimeout(() => {
      setCurrentIndex((prevIndex) => (prevIndex + 1) % images.length)
    }, durationMs)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [currentIndex, images])

  if (loading && images.length === 0) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-16 h-16 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    )
  }

  if (images.length === 0) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center text-white">
        <h1 className="text-4xl font-black mb-4">TV Menús (Pantalla {screenParam})</h1>
        <p className="text-xl text-gray-400">{errorStatus || 'Esperando imágenes...'}</p>
      </div>
    )
  }

  const activeImage = images[currentIndex]

  if (!activeImage) return null

  return (
    <div className="min-h-screen w-full h-screen bg-black overflow-hidden m-0 p-0 fixed inset-0">
      <img
        key={activeImage.id}
        src={activeImage.storage_path}
        alt="Menu TV"
        className="w-full h-full object-contain animate-in fade-in duration-1000"
      />
    </div>
  )
}

export default function TvViewerPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center text-white">
        <p>Cargando parámetros de pantalla...</p>
      </div>
    }>
      <TvViewerContent />
    </Suspense>
  )
}
