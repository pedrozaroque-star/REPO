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

  const fetchActiveMenu = useCallback(async () => {
    try {
      setLoading(true)

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

      // 2. Regla 1: Hay una imagen de "Variación" asignada específicamente a ESTA tienda (Array JSONB)
      const variationImages = imgs.filter(img =>
        img.is_universal === false &&
        Array.isArray(img.store_assignments) &&
        img.store_assignments.includes(storeParam)
      )

      // 3. Regla 2: Si no hay variación, toma la imagen Universal
      const universalImages = imgs.filter(img => img.is_universal === true)

      if (variationImages.length > 0) {
        setImages(variationImages) // Tienda tiene versión especial, se respeta.
      } else if (universalImages.length > 0) {
        setImages(universalImages) // Tienda toma menú default.
      } else {
        setImages([])
        setErrorStatus('Menú no asignado para esta tienda.')
      }

      setCurrentIndex(0)

    } catch (err) {
      console.error('Error fetching TV menu:', err)
      setErrorStatus('Error de conexión')
    } finally {
      setLoading(false)
    }
  }, [storeParam, screenParam])

  // Fetch initial
  useEffect(() => {
    fetchActiveMenu()
  }, [fetchActiveMenu])

  // Lógica de Supabase Realtime para actualización instantánea (Cambios en Panel = Cambios en TV Inmediatos)
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

  // Lógica de Rotación (Slideshow) en caso de que quieran subir 2 imágenes a la misma pantalla y rotarlas
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
      <div className="min-h-screen bg-black flex flex-col items-center justify-center text-white p-8 text-center">
        <h1 className="text-4xl font-black mb-4">TV Menús (Pantalla {screenParam} / {storeParam})</h1>
        <p className="text-xl text-gray-400 max-w-2xl">{errorStatus || 'Esperando imágenes desde el servidor...'}</p>
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
