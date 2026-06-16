'use client'

/**
 * @module LiveCamera
 * @status ✅ ACTIVO — Integrado en InspectionForm.tsx (selfie) y DynamicQuestion.tsx (evidencia).
 * 
 * @description Componente de cámara en vivo usando getUserMedia API.
 * Abre la cámara del dispositivo directamente en el navegador, sin pasar por el selector de archivos
 * del sistema operativo. Esto elimina completamente la opción de subir fotos de la galería.
 * 
 * ═══════════════════════════════════════════════════════════════════════
 *   📱 PARA CUANDO EVOLUCIONEMOS A APP PUBLICADA EN APP STORE / GOOGLE PLAY
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * Actualmente la app funciona como PWA standalone (instalada desde el navegador).
 * En modo PWA standalone en iOS, getUserMedia puede ser inestable (el stream de cámara
 * se congela o no inicia). Por eso, por ahora usamos <input type="file" capture="...">
 * que delega al OS la captura.
 * 
 * Cuando la app se publique como app nativa (React Native, Capacitor, etc.),
 * este componente debe integrarse para bloquear 100% el acceso a la galería:
 * 
 *   1. En InspectionForm.tsx (selfie):
 *      - Reemplazar <input type="file" capture="user"> por <LiveCamera facingMode="user" />
 * 
 *   2. En DynamicQuestion.tsx (fotos de evidencia):
 *      - Reemplazar <input type="file" capture="environment"> por <LiveCamera facingMode="environment" allowMultiple />
 * 
 *   3. Las claves i18n ya están creadas en lib/i18n.tsx bajo 'inspections.form.camera.*'
 * 
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * @businessRules
 * - Los supervisores DEBEN tomar fotos en tiempo real durante inspecciones
 * - NO se permite subir fotos de la galería (ni iPhone ni Android)
 * - Si getUserMedia falla (PWA standalone en iOS raro), se recurre a <input capture> como fallback
 * @dataFlow
 * - getUserMedia → video stream → canvas capture → blob → File → callback onCapture
 * @notes
 * - Safari iOS REQUIERE playsinline + muted en el <video> o el stream no se muestra
 * - Siempre llamar track.stop() al cerrar para liberar cámara y batería
 * - Usar toBlob() (async) en vez de toDataURL() (sync) por performance en móvil
 * - Probado y confirmado compatible con: Chrome Android, Safari iOS (browser), Firefox, Desktop
 */

import React, { useRef, useState, useEffect, useCallback } from 'react'
import { X, Camera, RotateCcw, Check, AlertTriangle, Loader2 } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'

interface LiveCameraProps {
    /** 'user' = cámara frontal (selfie), 'environment' = cámara trasera (evidencia) */
    facingMode: 'user' | 'environment'
    /** Callback cuando se captura una foto. Recibe el File listo para subir. */
    onCapture: (file: File) => void
    /** Callback para cerrar la cámara sin capturar */
    onClose: () => void
    /** Si true, permite tomar múltiples fotos antes de cerrar */
    allowMultiple?: boolean
}

export default function LiveCamera({ facingMode, onCapture, onClose, allowMultiple = false }: LiveCameraProps) {
    const { t } = useLanguage()
    const videoRef = useRef<HTMLVideoElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const streamRef = useRef<MediaStream | null>(null)

    const [status, setStatus] = useState<'loading' | 'streaming' | 'preview' | 'error' | 'fallback'>('loading')
    const [error, setError] = useState<string>('')
    const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null)
    const [capturedUrl, setCapturedUrl] = useState<string>('')
    const [photoCount, setPhotoCount] = useState(0)

    // Fallback input ref
    const fallbackInputRef = useRef<HTMLInputElement>(null)

    // Start camera stream
    const startCamera = useCallback(async () => {
        setStatus('loading')
        setError('')

        // Check if getUserMedia is supported
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setStatus('fallback')
            return
        }

        try {
            const constraints: MediaStreamConstraints = {
                video: {
                    facingMode: facingMode,
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                },
                audio: false
            }

            const stream = await navigator.mediaDevices.getUserMedia(constraints)
            streamRef.current = stream

            if (videoRef.current) {
                videoRef.current.srcObject = stream
                // Wait for video to be ready
                videoRef.current.onloadedmetadata = () => {
                    videoRef.current?.play().then(() => {
                        setStatus('streaming')
                    }).catch(() => {
                        // If autoplay fails, try with user interaction
                        setStatus('streaming')
                    })
                }
            }
        } catch (err: any) {
            console.error('Camera error:', err)

            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                setError(t('inspections.form.camera.permission_denied'))
                setStatus('error')
            } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
                // No camera found, fall back
                setStatus('fallback')
            } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
                // Camera in use or hardware error — try fallback
                setStatus('fallback')
            } else {
                // Any other error — try fallback
                setStatus('fallback')
            }
        }
    }, [facingMode, t])

    // Stop camera stream
    const stopCamera = useCallback(() => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop())
            streamRef.current = null
        }
        if (videoRef.current) {
            videoRef.current.srcObject = null
        }
    }, [])

    // Capture photo from video stream
    const capturePhoto = useCallback(() => {
        if (!videoRef.current || !canvasRef.current) return

        const video = videoRef.current
        const canvas = canvasRef.current
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        // Set canvas to video dimensions for full resolution
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight

        // If front camera, mirror the image
        if (facingMode === 'user') {
            ctx.translate(canvas.width, 0)
            ctx.scale(-1, 1)
        }

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

        // Reset transform
        ctx.setTransform(1, 0, 0, 1, 0, 0)

        // Convert to blob (async, memory efficient)
        canvas.toBlob((blob) => {
            if (blob) {
                setCapturedBlob(blob)
                const url = URL.createObjectURL(blob)
                setCapturedUrl(url)
                setStatus('preview')
            }
        }, 'image/webp', 0.85)

        // Clean up canvas memory
        canvas.width = 0
        canvas.height = 0
    }, [facingMode])

    // Confirm captured photo
    const confirmPhoto = useCallback(() => {
        if (!capturedBlob) return

        const file = new File([capturedBlob], `capture-${Date.now()}.webp`, { type: 'image/webp' })
        onCapture(file)
        setPhotoCount(prev => prev + 1)

        // Clean up
        if (capturedUrl) URL.revokeObjectURL(capturedUrl)
        setCapturedBlob(null)
        setCapturedUrl('')

        if (allowMultiple) {
            // Go back to streaming for another photo
            setStatus('streaming')
        } else {
            // Single photo mode — close after capture
            stopCamera()
            onClose()
        }
    }, [capturedBlob, capturedUrl, onCapture, allowMultiple, stopCamera, onClose])

    // Retake photo
    const retakePhoto = useCallback(() => {
        if (capturedUrl) URL.revokeObjectURL(capturedUrl)
        setCapturedBlob(null)
        setCapturedUrl('')
        setStatus('streaming')
    }, [capturedUrl])

    // Handle fallback file input
    const handleFallbackCapture = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.length) return
        const file = e.target.files[0]
        onCapture(file)
        setPhotoCount(prev => prev + 1)

        if (!allowMultiple) {
            onClose()
        }
        // Reset input
        if (fallbackInputRef.current) fallbackInputRef.current.value = ''
    }, [onCapture, allowMultiple, onClose])

    // Start camera on mount
    useEffect(() => {
        startCamera()
        return () => {
            stopCamera()
            if (capturedUrl) URL.revokeObjectURL(capturedUrl)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Handle body scroll lock
    useEffect(() => {
        document.body.style.overflow = 'hidden'
        return () => {
            document.body.style.overflow = ''
        }
    }, [])

    const handleClose = () => {
        stopCamera()
        if (capturedUrl) URL.revokeObjectURL(capturedUrl)
        onClose()
    }

    // ─── FALLBACK MODE ───
    if (status === 'fallback') {
        return (
            <div className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center p-6">
                <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 max-w-sm w-full text-center space-y-5">
                    <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto">
                        <AlertTriangle className="w-8 h-8 text-amber-600" />
                    </div>
                    <p className="text-sm text-gray-600 dark:text-slate-300">
                        {t('inspections.form.camera.not_supported')}
                    </p>

                    <label className="block cursor-pointer bg-blue-600 text-white font-bold py-3 px-6 rounded-xl hover:bg-blue-700 active:scale-95 transition-all">
                        <Camera className="inline w-5 h-5 mr-2" />
                        {t('inspections.form.camera.take_photo')}
                        <input
                            ref={fallbackInputRef}
                            type="file"
                            accept="image/*"
                            capture={facingMode === 'user' ? 'user' : 'environment'}
                            className="hidden"
                            onChange={handleFallbackCapture}
                        />
                    </label>

                    {allowMultiple && photoCount > 0 && (
                        <button onClick={handleClose} className="block w-full bg-green-600 text-white font-bold py-3 px-6 rounded-xl hover:bg-green-700 active:scale-95 transition-all">
                            <Check className="inline w-5 h-5 mr-2" />
                            {t('inspections.form.camera.done')} ({photoCount})
                        </button>
                    )}

                    <button onClick={handleClose} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
                        {t('inspections.form.camera.close')}
                    </button>
                </div>
            </div>
        )
    }

    // ─── ERROR MODE ───
    if (status === 'error') {
        return (
            <div className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center p-6">
                <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 max-w-sm w-full text-center space-y-5">
                    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                        <AlertTriangle className="w-8 h-8 text-red-600" />
                    </div>
                    <p className="text-sm text-gray-600 dark:text-slate-300">{error}</p>
                    <button onClick={handleClose} className="bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-slate-200 font-bold py-3 px-6 rounded-xl hover:bg-gray-300 active:scale-95 transition-all">
                        {t('inspections.form.camera.close')}
                    </button>
                </div>
            </div>
        )
    }

    // ─── MAIN CAMERA UI ───
    return (
        <div className="fixed inset-0 z-[9999] bg-black flex flex-col">
            {/* Hidden canvas for photo capture */}
            <canvas ref={canvasRef} className="hidden" />

            {/* Top bar */}
            <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between p-4 bg-gradient-to-b from-black/60 to-transparent">
                <button onClick={handleClose} className="w-10 h-10 bg-black/40 backdrop-blur-sm rounded-full flex items-center justify-center text-white active:scale-90 transition-transform">
                    <X size={22} />
                </button>
                {allowMultiple && photoCount > 0 && (
                    <div className="bg-green-500 text-white text-xs font-black px-3 py-1.5 rounded-full">
                        {photoCount} foto{photoCount > 1 ? 's' : ''}
                    </div>
                )}
            </div>

            {/* Video stream / Preview */}
            <div className="flex-1 flex items-center justify-center overflow-hidden relative">
                {status === 'loading' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
                        <Loader2 className="w-10 h-10 text-white animate-spin" />
                        <span className="text-white/80 text-sm font-medium">{t('inspections.form.camera.loading')}</span>
                    </div>
                )}

                <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className={`w-full h-full object-cover ${facingMode === 'user' ? 'scale-x-[-1]' : ''} ${status === 'preview' ? 'hidden' : ''}`}
                />

                {status === 'preview' && capturedUrl && (
                    <img
                        src={capturedUrl}
                        alt="Captured"
                        className="w-full h-full object-cover"
                    />
                )}
            </div>

            {/* Bottom controls */}
            <div className="absolute bottom-0 left-0 right-0 z-10 bg-gradient-to-t from-black/80 to-transparent pb-safe">
                {status === 'streaming' && (
                    <div className="flex items-center justify-center gap-6 py-6 pb-8">
                        {allowMultiple && photoCount > 0 && (
                            <button onClick={handleClose} className="w-14 h-14 bg-green-500 rounded-full flex items-center justify-center text-white shadow-lg active:scale-90 transition-transform">
                                <Check size={24} />
                            </button>
                        )}
                        {/* Shutter button */}
                        <button
                            onClick={capturePhoto}
                            className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center active:scale-90 transition-transform"
                        >
                            <div className="w-16 h-16 bg-white rounded-full active:bg-gray-200 transition-colors" />
                        </button>
                        {/* Spacer for centering */}
                        {allowMultiple && photoCount > 0 && <div className="w-14" />}
                    </div>
                )}

                {status === 'preview' && (
                    <div className="flex items-center justify-center gap-8 py-6 pb-8">
                        {/* Retake */}
                        <button onClick={retakePhoto} className="flex flex-col items-center gap-1.5 active:scale-90 transition-transform">
                            <div className="w-14 h-14 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center">
                                <RotateCcw size={22} className="text-white" />
                            </div>
                            <span className="text-white text-[10px] font-bold uppercase">{t('inspections.form.camera.retake')}</span>
                        </button>

                        {/* Confirm */}
                        <button onClick={confirmPhoto} className="flex flex-col items-center gap-1.5 active:scale-90 transition-transform">
                            <div className="w-14 h-14 bg-green-500 rounded-full flex items-center justify-center shadow-lg shadow-green-500/30">
                                <Check size={24} className="text-white" />
                            </div>
                            <span className="text-white text-[10px] font-bold uppercase">
                                {allowMultiple ? t('inspections.form.camera.take_another') : t('inspections.form.camera.use_photo')}
                            </span>
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}
