'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'

export default function TvViewerPage() {
  // Estado de los parámetros de la URL
  const [storeParam, setStoreParam] = useState<string>('ALL')
  const [screenParam, setScreenParam] = useState<number>(1)
  const [paramsLoaded, setParamsLoaded] = useState(false)

  // Estado de imágenes
  const [images, setImages] = useState<any[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [errorStatus, setErrorStatus] = useState<string | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  // 1. Leer los parámetros directamente del navegador nativo 
  //    (Evita componentes atorados de Next.js en teles viejas)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const params = new URLSearchParams(window.location.search)
        const store = params.get('store')?.toUpperCase() || 'ALL'
        const screen = parseInt(params.get('screen') || '1', 10)

        setStoreParam(store)
        setScreenParam(isNaN(screen) ? 1 : screen)
        setParamsLoaded(true)
      } catch (e) {
        console.error("Error leyendo URL", e)
        setParamsLoaded(true)
      }
    }
  }, [])

  const fetchActiveMenu = useCallback(async () => {
    if (!paramsLoaded) return

    try {
      setLoading(true)

      // Obtener todas las imágenes de ESTA PANTALLA
      const { data: imgs, error: imgsError } = await supabase
        .from('tv_images')
        .select('*')
        .eq('screen_number', screenParam)
        .order('sort_order', { ascending: true })

      if (imgsError) throw imgsError

      if (!imgs || imgs.length === 0) {
        setImages([])
        setErrorStatus('No hay imágenes configuradas para esta pantalla (TV ' + screenParam + ')')
        setLoading(false)
        return
      }

      setErrorStatus(null)

      // Regla 1: Hay una imagen de "Variación" asignada a esta tienda
      const variationImages = imgs.filter(img =>
        img.is_universal === false &&
        Array.isArray(img.store_assignments) &&
        img.store_assignments.includes(storeParam)
      )

      // Regla 2: Variación default universal
      const universalImages = imgs.filter(img => img.is_universal === true)

      if (variationImages.length > 0) {
        setImages(variationImages)
      } else if (universalImages.length > 0) {
        setImages(universalImages)
      } else {
        setImages([])
        setErrorStatus('Menú Vacio - Sube un Menú a la TV ' + screenParam)
      }

      setCurrentIndex(0)

    } catch (err) {
      console.error('Error fetching TV menu:', err)
      setErrorStatus('Error de conexión a la base de datos')
    } finally {
      setLoading(false)
    }
  }, [storeParam, screenParam, paramsLoaded])

  // Fetch initial
  useEffect(() => {
    if (paramsLoaded) {
      fetchActiveMenu()
    }
  }, [fetchActiveMenu, paramsLoaded])

  // Lógica de Supabase Realtime para actualización instantánea
  useEffect(() => {
    if (!paramsLoaded) return

    const channelImages = supabase.channel('schema-db-changes-images')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tv_images' }, () => {
        fetchActiveMenu()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channelImages)
    }
  }, [fetchActiveMenu, paramsLoaded])

  // Lógica de Rotación
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


  // PANTALLAS DE CARGA Y ERRORES
  if (!paramsLoaded) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center text-white">
        <p>Leyendo dirección...</p>
      </div>
    )
  }

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
        <p className="text-xl text-gray-400 max-w-2xl">{errorStatus || 'Esperando imágenes...'}</p>
      </div>
    )
  }

  const activeImage = images[currentIndex]
  if (!activeImage) return null

  // RENDER FINAL DE IMAGEN
  return (
    <div className="min-h-screen w-full h-screen bg-black overflow-hidden m-0 p-0 fixed inset-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={activeImage.id}
        src={activeImage.storage_path}
        alt="Menu TV"
        className="w-full h-full object-contain animate-in fade-in duration-1000"
      />
    </div>
  )
}
