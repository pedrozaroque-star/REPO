/**
 * @module components/maintenance/SignaturePad
 * @description Componente interactivo de firma digital táctil sobre HTML5 Canvas para el registro
 * y validación de visitas de técnicos y proveedores de servicio en Tacos Gavilan.
 * @businessRules
 * - Permite al encargado en turno firmar con el dedo en pantallas táctiles de celulares o con el mouse.
 * - Genera trazos fluidos con punta redondeada y color oscuro contrastante (#0f172a).
 * - Canvas con fondo blanco estilo papel de recibo fijo para máxima visibilidad en modo claro y oscuro.
 * - Rehidrata automáticamente firmas previas mediante initialSignatureUrl para no perder trazos al navegar entre pasos.
 * - Optimizado a 60fps reiniciando sub-paths para evitar acumulación de lag en pantallas móviles táctiles.
 * - Proporciona botón de limpieza rápida para reiniciar la firma si hay error.
 * - Notifica al formulario padre mediante callback onSignatureChange(base64DataUrl | null).
 * @dataFlow
 * - Eventos táctiles/ratón -> Dibujado en Canvas -> toDataURL('image/png') -> Callback hacia formulario padre.
 * @notes
 * - Totalmente responsive con escalado según pixel ratio del dispositivo para evitar distorsión o desenfoque.
 */

'use client'

import React, { useRef, useState, useEffect, useCallback } from 'react'
import { Eraser, CheckCircle2 } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'

interface SignaturePadProps {
  onSignatureChange: (dataUrl: string | null) => void
  initialSignatureUrl?: string | null
  disabled?: boolean
}

export default function SignaturePad({
  onSignatureChange,
  initialSignatureUrl = null,
  disabled = false
}: SignaturePadProps) {
  const { t } = useLanguage()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const isDrawing = useRef(false)
  const hasDrawnRef = useRef(false)
  const [hasSignature, setHasSignature] = useState(false)

  // Configurar resolución nativa de pantalla (Retina / High DPI)
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let prevDataUrl: string | null = null
    if (hasDrawnRef.current) {
      prevDataUrl = canvas.toDataURL('image/png')
    } else if (initialSignatureUrl) {
      prevDataUrl = initialSignatureUrl
    }

    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1

    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr

    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.scale(dpr, dpr)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = '#0f172a' // Slate 900 de alto contraste
      ctx.lineWidth = 2.5

      if (prevDataUrl) {
        const img = new Image()
        img.onload = () => {
          ctx.drawImage(img, 0, 0, rect.width, rect.height)
          hasDrawnRef.current = true
          setHasSignature(true)
        }
        img.src = prevDataUrl
      }
    }
  }, [initialSignatureUrl])

  useEffect(() => {
    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)
    return () => window.removeEventListener('resize', resizeCanvas)
  }, [resizeCanvas])

  // Rehidratar firma inicial si se provee después del montaje
  useEffect(() => {
    if (initialSignatureUrl && !hasDrawnRef.current) {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const rect = canvas.getBoundingClientRect()
      const img = new Image()
      img.onload = () => {
        ctx.drawImage(img, 0, 0, rect.width, rect.height)
        hasDrawnRef.current = true
        setHasSignature(true)
      }
      img.src = initialSignatureUrl
    }
  }, [initialSignatureUrl])

  const getCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }

    const rect = canvas.getBoundingClientRect()
    if ('touches' in e && e.touches.length > 0) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top
      }
    } else if ('clientX' in e) {
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      }
    }
    return { x: 0, y: 0 }
  }

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    if (disabled) return
    e.preventDefault()
    isDrawing.current = true
    hasDrawnRef.current = true
    setHasSignature(true)
    const { x, y } = getCoordinates(e)
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) {
      ctx.beginPath()
      ctx.moveTo(x, y)
    }
  }

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing.current || disabled) return
    e.preventDefault()
    const { x, y } = getCoordinates(e)
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) {
      ctx.lineTo(x, y)
      ctx.stroke()
      // Reiniciar subpath en cada coordenada para eliminar acumulación de lag táctil en móviles
      ctx.beginPath()
      ctx.moveTo(x, y)
    }
  }

  const stopDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing.current) return
    e.preventDefault()
    isDrawing.current = false
    const canvas = canvasRef.current
    if (canvas && hasDrawnRef.current) {
      const dataUrl = canvas.toDataURL('image/png')
      onSignatureChange(dataUrl)
    }
  }

  const clearCanvas = (e?: React.MouseEvent) => {
    if (e) e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
    hasDrawnRef.current = false
    setHasSignature(false)
    onSignatureChange(null)
  }

  return (
    <div className="w-full">
      {/* Fondo blanco estilo papel siempre para contraste perfecto en modo claro y oscuro */}
      <div className="relative border-2 border-dashed border-slate-300 dark:border-slate-500 rounded-2xl bg-white p-2 overflow-hidden shadow-inner">
        <canvas
          ref={canvasRef}
          className="w-full h-36 touch-none cursor-crosshair block rounded-xl bg-white"
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />

        {!hasSignature && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-xs sm:text-sm font-medium text-slate-400 italic select-none">
              {t('maintenance.signature_hint')}
            </span>
          </div>
        )}

        {hasSignature && (
          <div className="absolute top-2 right-2 flex items-center gap-1.5 bg-emerald-50 border border-emerald-300 text-emerald-700 px-2 py-0.5 rounded-full text-xs font-semibold shadow-sm animate-in fade-in">
            <CheckCircle2 size={12} />
            <span>{t('maintenance.signed')}</span>
          </div>
        )}
      </div>

      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={clearCanvas}
          disabled={!hasSignature || disabled}
          className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors disabled:opacity-30 disabled:pointer-events-none"
        >
          <Eraser size={14} />
          {t('maintenance.signature_clear')}
        </button>
      </div>
    </div>
  )
}
