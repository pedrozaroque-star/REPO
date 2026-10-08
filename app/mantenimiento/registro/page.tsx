/**
 * @module app/mantenimiento/registro/page
 * @description Portal público móvil interactivo para el registro de actividades, reparaciones y visitas
 * de técnicos y proveedores de servicio en Tacos Gavilan.
 * @businessRules
 * - Acceso abierto sin inicio de sesión (ruta pública en middleware.ts y ClientLayout.tsx).
 * - Splash interactivo institucional con la animación oficial del logo cayendo ("¡Ya está!").
 * - Flujo por diapositivas (Step-by-Step Slide Wizard) optimizado para pantallas táctiles de celulares.
 * - Si se ingresa mediante código QR con parámetro ?store={id}, la sucursal se pre-selecciona automáticamente.
 * - Evidencias fotográficas obligatorias (Antes, Después o Nota/Factura física).
 * - Firma digital táctil del encargado en turno requerida para validar la entrega del servicio.
 * - Soporta idioma dual (Español / Inglés) con selector instantáneo.
 * @dataFlow
 * - Selección de tienda y captura por pasos -> Subida de imágenes a /api/mantenimiento/upload ->
 *   POST a /api/mantenimiento -> Notificación interna a supervisores y almacenamiento en maintenance_service_logs.
 * @notes
 * - Diseñado 'mobile-first' con compresión automática en cliente (browser-image-compression), botones táctiles de 56px y soporte de cámara directa.
 */

'use client'

import React, { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Wrench, Camera, CheckCircle2, AlertTriangle, ShieldCheck,
  Building2, User, Phone, FileText, DollarSign, UploadCloud,
  X, Sparkles, RefreshCw, Flame, Snowflake, Bug, Droplets,
  Zap, Lock, Cpu, ArrowRight, ArrowLeft, ChevronRight, ChevronLeft,
  Globe, MapPin, Check, SkipForward, ExternalLink,
  Clock, LogOut, Plus
} from 'lucide-react'
import imageCompression from 'browser-image-compression'
import { useLanguage } from '@/lib/i18n'
import { getSupabaseClient, formatStoreName } from '@/lib/supabase'
import SignaturePad from '@/components/maintenance/SignaturePad'

interface Store {
  id: string
  name: string
  code?: string
  city?: string
  address?: string
}

const COMMON_VENDORS = [
  'Air Quality Hoods',
  'Ecolab Pest Control',
  'ThermoKing Refrigeration',
  'Tri-County Grease Trap',
  'Hobart Cooking Equipment',
  'Toast POS / Tech Services'
]

const TOTAL_SLIDES = 7

function MaintenanceFormContent() {
  const { t, language, setLanguage } = useLanguage()
  const isEs = language === 'es'
  const searchParams = useSearchParams()
  const storeParam = searchParams.get('store') || searchParams.get('store_id') || ''

  // Splash Animation State (Identical to Login)
  const [showSplash, setShowSplash] = useState(true)

  // Wizard Step State (1 to 7)
  const [currentStep, setCurrentStep] = useState(1)
  const [slideDirection, setSlideDirection] = useState<1 | -1>(1)

  const [stores, setStores] = useState<Store[]>([])
  const [loadingStores, setLoadingStores] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [successData, setSuccessData] = useState<any | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Scroll Container Ref
  const mainRef = useRef<HTMLElement | null>(null)

  // Auto-Redirect State
  const [redirectCountdown, setRedirectCountdown] = useState<number | null>(6)
  const [redirectCancelled, setRedirectCancelled] = useState(false)

  // Form State
  const [selectedStoreId, setSelectedStoreId] = useState<string>(storeParam)
  const [companyName, setCompanyName] = useState('')
  const [technicianName, setTechnicianName] = useState('')
  const [technicianPhone, setTechnicianPhone] = useState('')
  const [category, setCategory] = useState('hood_cleaning')
  const [serviceType, setServiceType] = useState('corrective')
  const [areaEquipment, setAreaEquipment] = useState('')
  const [workDescription, setWorkDescription] = useState('')
  const [partsReplaced, setPartsReplaced] = useState('')
  const [status, setStatus] = useState('completed')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [costEstimate, setCostEstimate] = useState('')
  const [managerName, setManagerName] = useState('')
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null)

  // Photos State
  const [photosBefore, setPhotosBefore] = useState<string[]>([])
  const [photosAfter, setPhotosAfter] = useState<string[]>([])
  const [photosInvoice, setPhotosInvoice] = useState<string[]>([])
  const [uploadingSection, setUploadingSection] = useState<'before' | 'after' | 'invoice' | null>(null)

  // Activación automática y silenciosa de Pantalla Completa nativa en móviles
  useEffect(() => {
    const handleAutoFullscreen = () => {
      try {
        if (typeof document !== 'undefined' && !document.fullscreenElement) {
          if (typeof document.documentElement.requestFullscreen === 'function') {
            document.documentElement.requestFullscreen().catch(() => {})
          } else if (typeof (document.documentElement as any).webkitRequestFullscreen === 'function') {
            (document.documentElement as any).webkitRequestFullscreen()
          }
        }
      } catch {
        // Fallback silencioso en navegadores móviles con restricciones
      }
    }

    // Intento inmediato al montar y al primer gesto táctil del técnico al interactuar
    handleAutoFullscreen()
    window.addEventListener('touchstart', handleAutoFullscreen, { passive: true })
    window.addEventListener('click', handleAutoFullscreen, { passive: true })

    return () => {
      window.removeEventListener('touchstart', handleAutoFullscreen)
      window.removeEventListener('click', handleAutoFullscreen)
    }
  }, [])

  // Handler para cerrar ventana o redirigir a tacosgavilan.com
  const handleFinishAndExit = () => {
    if (typeof document !== 'undefined' && document.fullscreenElement) {
      if (typeof document.exitFullscreen === 'function') {
        document.exitFullscreen().catch(() => {})
      }
    }
    try {
      window.close()
    } catch {
      // Browser might block window.close
    }
    setTimeout(() => {
      window.location.href = 'https://tacosgavilan.com'
    }, 200)
  }

  // Cuenta regresiva para redirección automática al terminar con éxito
  useEffect(() => {
    if (!successData || redirectCancelled || redirectCountdown === null) return
    if (redirectCountdown <= 0) {
      handleFinishAndExit()
      return
    }
    const timer = setTimeout(() => {
      setRedirectCountdown(prev => (prev !== null ? prev - 1 : null))
    }, 1000)
    return () => clearTimeout(timer)
  }, [successData, redirectCountdown, redirectCancelled])

  // Auto-dismiss splash animation after 4.8 seconds (Synchronized with spring bounce)
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSplash(false)
    }, 4800)
    return () => clearTimeout(timer)
  }, [])

  // Cargar lista de tiendas ordenadas numéricamente
  useEffect(() => {
    async function loadStores() {
      try {
        const supabase = await getSupabaseClient()
        const { data, error } = await supabase
          .from('stores')
          .select('id, name, code, city, address, is_active')
          .order('id')

        if (!error && data) {
          const activeStores = data.filter((s: any) => s.is_active !== false)
          setStores(activeStores)

          // Preselección robusta si viene ?store= en URL (ID numérico, código, o nombre)
          if (storeParam) {
            const p = String(storeParam).trim().toLowerCase()
            const matched = activeStores.find((s: any) =>
              String(s.id).toLowerCase() === p ||
              s.code?.toLowerCase() === p ||
              s.name?.toLowerCase() === p ||
              formatStoreName(s.name).toLowerCase() === p ||
              s.code?.toLowerCase() === p.padStart(2, '0')
            )
            if (matched) setSelectedStoreId(String(matched.id))
          }
        }
      } catch (err) {
        console.error('Error cargando tiendas:', err)
      } finally {
        setLoadingStores(false)
      }
    }
    loadStores()
  }, [storeParam])

  // Subida de foto con compresión previa en el navegador
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>, section: 'before' | 'after' | 'invoice') => {
    const files = e.target.files
    if (!files || files.length === 0) return

    setUploadingSection(section)
    setErrorMessage(null)

    try {
      for (let i = 0; i < files.length; i++) {
        let file = files[i]

        // Compresión automática de imágenes antes de enviar a Vercel
        if (file.type.startsWith('image/')) {
          try {
            file = await imageCompression(file, {
              maxSizeMB: 0.4,
              maxWidthOrHeight: 1400,
              useWebWorker: true,
              fileType: 'image/webp',
              initialQuality: 0.8
            })
          } catch (compErr) {
            console.warn('Compresión en cliente no disponible, usando original:', compErr)
          }
        }

        const formData = new FormData()
        formData.append('file', file)
        formData.append('folder', section)

        const res = await fetch('/api/mantenimiento/upload', {
          method: 'POST',
          body: formData
        })

        const result = await res.json()
        if (result.success && result.url) {
          if (section === 'before') setPhotosBefore(prev => [...prev, result.url])
          if (section === 'after') setPhotosAfter(prev => [...prev, result.url])
          if (section === 'invoice') setPhotosInvoice(prev => [...prev, result.url])
        } else {
          throw new Error(result.error || (isEs ? 'Fallo al subir foto' : 'Failed to upload photo'))
        }
      }
    } catch (err: any) {
      console.error('Error al subir imagen:', err)
      setErrorMessage(isEs ? 'Error al subir la imagen. Intenta de nuevo.' : 'Failed to upload photo. Please try again.')
    } finally {
      setUploadingSection(null)
      e.target.value = ''
    }
  }

  const removePhoto = (urlToRemove: string, section: 'before' | 'after' | 'invoice') => {
    if (section === 'before') setPhotosBefore(prev => prev.filter(u => u !== urlToRemove))
    if (section === 'after') setPhotosAfter(prev => prev.filter(u => u !== urlToRemove))
    if (section === 'invoice') setPhotosInvoice(prev => prev.filter(u => u !== urlToRemove))
  }

  // Validaciones por diapositiva
  const validateStep = (step: number): boolean => {
    setErrorMessage(null)

    if (step === 1) {
      if (!selectedStoreId) {
        setErrorMessage(isEs ? 'Por favor selecciona la sucursal atendida para continuar.' : 'Please select the serviced store to continue.')
        return false
      }
      return true
    }

    if (step === 2) {
      if (!companyName.trim()) {
        setErrorMessage(isEs ? 'Ingresa el nombre de la empresa proveedora.' : 'Please enter the vendor company name.')
        return false
      }
      if (!technicianName.trim()) {
        setErrorMessage(isEs ? 'Ingresa tu nombre de técnico.' : 'Please enter your technician full name.')
        return false
      }
      return true
    }

    if (step === 3) {
      if (!category) {
        setErrorMessage(isEs ? 'Selecciona una categoría de servicio.' : 'Please select a service category.')
        return false
      }
      return true
    }

    if (step === 4) {
      if (!areaEquipment.trim()) {
        setErrorMessage(isEs ? 'Especifica qué equipo o área atendiste (ej. Campana 1, Walk-in Cooler).' : 'Please specify the equipment or area serviced.')
        return false
      }
      if (!workDescription.trim()) {
        setErrorMessage(isEs ? 'Describe brevemente el trabajo realizado.' : 'Please describe the work performed.')
        return false
      }
      return true
    }

    if (step === 5) {
      const totalPhotos = photosBefore.length + photosAfter.length + photosInvoice.length
      if (totalPhotos === 0) {
        setErrorMessage(isEs ? 'Es obligatorio subir al menos una foto de evidencia (Antes, Después o Factura).' : 'At least one photo evidence (Before, After, or Invoice) is required.')
        return false
      }
      return true
    }

    if (step === 6) {
      // Paso 6 es datos contables (opcional)
      return true
    }

    if (step === 7) {
      if (!managerName.trim()) {
        setErrorMessage(isEs ? 'Ingresa el nombre del encargado de tienda que valida el servicio.' : 'Please enter the store manager name who certifies the visit.')
        return false
      }
      if (!signatureDataUrl) {
        setErrorMessage(isEs ? 'La firma táctil del encargado es obligatoria para certificar el servicio.' : 'The store manager signature is required to certify the service.')
        return false
      }
      return true
    }

    return true
  }

  const handleNext = () => {
    if (!validateStep(currentStep)) return
    if (currentStep < TOTAL_SLIDES) {
      setSlideDirection(1)
      setCurrentStep(prev => prev + 1)
      mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const handleBack = () => {
    setErrorMessage(null)
    if (currentStep > 1) {
      setSlideDirection(-1)
      setCurrentStep(prev => prev - 1)
      mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  // Envío Final del Formulario
  const handleSubmit = async () => {
    if (!validateStep(7)) return
    setErrorMessage(null)
    setSubmitting(true)

    try {
      // 1. Subir firma digital en base64 si existe
      let signatureUrl: string | null = null
      if (signatureDataUrl) {
        try {
          const sigRes = await fetch('/api/mantenimiento/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base64: signatureDataUrl, folder: 'signatures' })
          })
          const sigJson = await sigRes.json()
          if (sigJson.success && sigJson.url) {
            signatureUrl = sigJson.url
          } else {
            throw new Error(sigJson.error || 'Error subiendo firma')
          }
        } catch (sigErr) {
          console.warn('Error guardando firma táctil:', sigErr)
          throw new Error(isEs ? 'No se pudo guardar la firma del encargado. Intenta firmar de nuevo.' : 'Failed to save store manager signature. Please sign again.')
        }
      }

      // 2. Guardar registro en /api/mantenimiento
      const parsedCost = costEstimate.trim() ? parseFloat(costEstimate.replace(/[^0-9.]/g, '')) : null
      const validCost = parsedCost !== null && !isNaN(parsedCost) && isFinite(parsedCost) ? parsedCost : null

      const payload = {
        store_id: selectedStoreId,
        company_name: companyName,
        technician_name: technicianName,
        technician_phone: technicianPhone || null,
        category,
        service_type: serviceType,
        area_equipment: areaEquipment,
        work_description: workDescription,
        parts_replaced: partsReplaced || null,
        status,
        photos_before: photosBefore,
        photos_after: photosAfter,
        photos_invoice: photosInvoice,
        invoice_number: invoiceNumber || null,
        cost_estimate: validCost,
        manager_name: managerName,
        manager_signature_url: signatureUrl
      }

      const res = await fetch('/api/mantenimiento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const result = await res.json()

      if (!res.ok || !result.success) {
        throw new Error(result.error || (isEs ? 'Error al guardar registro' : 'Failed to save service record'))
      }

      setSuccessData(result.data)
      setRedirectCancelled(false)
      setRedirectCountdown(6)
      mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err: any) {
      console.error('Error al enviar formulario:', err)
      setErrorMessage(err.message || (isEs ? 'Error al enviar el registro. Revisa tu conexión.' : 'Error submitting record. Please check your connection.'))
    } finally {
      setSubmitting(false)
    }
  }

  const resetForm = () => {
    setSuccessData(null)
    setRedirectCancelled(true)
    setRedirectCountdown(null)
    setCurrentStep(1)
    setSlideDirection(1)
    setCompanyName('')
    setTechnicianName('')
    setTechnicianPhone('')
    setCategory('hood_cleaning')
    setServiceType('corrective')
    setAreaEquipment('')
    setWorkDescription('')
    setPartsReplaced('')
    setStatus('completed')
    setPhotosBefore([])
    setPhotosAfter([])
    setPhotosInvoice([])
    setInvoiceNumber('')
    setCostEstimate('')
    setManagerName('')
    setSignatureDataUrl(null)
    setErrorMessage(null)
  }

  // Lista de categorías con iconos y colores
  const categoriesList = [
    { id: 'hood_cleaning', label: t('maintenance.category_hood'), icon: Flame, color: 'text-amber-600 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800' },
    { id: 'refrigeration', label: t('maintenance.category_refrigeration'), icon: Snowflake, color: 'text-blue-600 bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800' },
    { id: 'grease_trap', label: t('maintenance.category_grease_trap'), icon: Droplets, color: 'text-teal-600 bg-teal-50 dark:bg-teal-950/40 border-teal-200 dark:border-teal-800' },
    { id: 'pest_control', label: t('maintenance.category_pest_control'), icon: Bug, color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800' },
    { id: 'cooking_equipment', label: t('maintenance.category_cooking'), icon: Wrench, color: 'text-red-600 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800' },
    { id: 'electrical', label: t('maintenance.category_electrical'), icon: Zap, color: 'text-yellow-600 bg-yellow-50 dark:bg-yellow-950/40 border-yellow-200 dark:border-yellow-800' },
    { id: 'power_washing', label: t('maintenance.category_power_washing'), icon: Sparkles, color: 'text-cyan-600 bg-cyan-50 dark:bg-cyan-950/40 border-cyan-200 dark:border-cyan-800' },
    { id: 'security_locks', label: t('maintenance.category_security'), icon: Lock, color: 'text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800' },
    { id: 'it_pos', label: t('maintenance.category_it'), icon: Cpu, color: 'text-purple-600 bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-800' },
    { id: 'general', label: t('maintenance.category_general'), icon: RefreshCw, color: 'text-slate-600 bg-slate-50 dark:bg-slate-950/40 border-slate-200 dark:border-slate-800' }
  ]

  const selectedStore = stores.find(s => String(s.id) === String(selectedStoreId))
  const totalPhotos = photosBefore.length + photosAfter.length + photosInvoice.length

  // Variantes de animación horizontal tipo diapositivas
  const slideVariants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 260 : -260,
      opacity: 0
    }),
    center: {
      x: 0,
      opacity: 1,
      transition: { duration: 0.35, ease: 'easeOut' as const }
    },
    exit: (direction: number) => ({
      x: direction > 0 ? -260 : 260,
      opacity: 0,
      transition: { duration: 0.25, ease: 'easeIn' as const }
    })
  }

  // ============================================================================
  // 1. PANTALLA DE ÉXITO (TICKET DIGITAL DE CONFIRMACIÓN & REDIRECCIÓN)
  // ============================================================================
  if (successData) {
    const storeObj = stores.find(s => String(s.id) === String(successData.store_id))
    return (
      <div className="fixed inset-0 z-50 bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4 overflow-y-auto">
        <div className="absolute inset-0 opacity-15 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] pointer-events-none"></div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="max-w-md w-full bg-slate-900/90 backdrop-blur-xl border border-slate-800 rounded-3xl shadow-2xl p-6 sm:p-8 text-center relative z-10 my-auto"
        >
          {/* Icono de Verificación Verde Animado */}
          <div className="w-20 h-20 mx-auto rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center mb-5 ring-8 ring-emerald-500/5 shadow-inner">
            <CheckCircle2 size={44} className="animate-pulse" />
          </div>

          <h2 className="text-2xl font-black text-white uppercase tracking-tight mb-1.5">
            {t('maintenance.success_title')}
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 mb-5">
            {t('maintenance.success_message')}
          </p>

          {/* Ticket Digital de Resumen */}
          <div className="bg-slate-800/60 rounded-2xl p-4 text-left space-y-2 mb-5 border border-slate-700/60 text-xs sm:text-sm">
            <div className="flex justify-between items-center pb-1.5 border-b border-slate-700/40">
              <span className="text-slate-400">{t('maintenance.store')}:</span>
              <span className="font-bold text-white text-right">
                {storeObj ? formatStoreName(storeObj.name) : 'Tacos Gavilan'}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">{t('maintenance.vendor')}:</span>
              <span className="font-bold text-white">{successData.company_name}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">{t('maintenance.technician')}:</span>
              <span className="font-bold text-white">{successData.technician_name}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">{t('maintenance.equipment')}:</span>
              <span className="font-bold text-white">{successData.area_equipment}</span>
            </div>
            <div className="flex justify-between items-center pt-1.5 border-t border-slate-700/40">
              <span className="text-slate-400">{t('maintenance.manager_name')}:</span>
              <span className="font-bold text-emerald-400">{successData.manager_name}</span>
            </div>
          </div>

          {/* Cuenta Regresiva de Redirección Automática */}
          {!redirectCancelled && redirectCountdown !== null && (
            <div className="mb-5 p-3 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-amber-300 text-xs flex items-center justify-between">
              <div className="flex items-center gap-2 text-left">
                <Clock size={16} className="animate-spin text-amber-400 flex-shrink-0" />
                <span className="font-medium">
                  {t('maintenance.redirecting_notice')?.replace('{seconds}', String(redirectCountdown))}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setRedirectCancelled(true)}
                className="text-[11px] underline text-amber-400 hover:text-amber-200 ml-2 font-bold whitespace-nowrap"
              >
                {t('maintenance.cancel_redirect')}
              </button>
            </div>
          )}

          {/* Botones de Acción */}
          <div className="space-y-2.5">
            {/* Botón Principal: Finalizar y Salir / Redirigir a tacosgavilan.com */}
            <button
              type="button"
              onClick={handleFinishAndExit}
              className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-black text-sm shadow-xl shadow-red-600/30 flex items-center justify-center gap-2 transition-all hover:scale-[1.01] active:scale-[0.98]"
            >
              <LogOut size={16} />
              <span>{t('maintenance.finish_and_close')}</span>
              <ExternalLink size={14} className="opacity-70" />
            </button>

            {/* Botón Secundario: Registrar Otro Servicio */}
            <button
              type="button"
              onClick={() => {
                setRedirectCancelled(true)
                resetForm()
              }}
              className="w-full py-3.5 px-6 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-bold text-xs transition-all border border-slate-700 active:scale-[0.98]"
            >
              {t('maintenance.another_service')}
            </button>
          </div>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 w-full h-[100dvh] min-h-[100dvh] bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col overflow-hidden z-50">
      {/* ========================================================================= */}
      {/* 2. ANIMACIÓN DE ENTRADA IDÉNTICA AL LOGIN (Drop-in Logo + "¡Ya está!") */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {showSplash && (
          <motion.div
            key="splash-screen"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.5, ease: 'easeInOut' } }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#50050a] overflow-hidden"
          >
            <div className="absolute inset-0 opacity-10 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] pointer-events-none" />

            {/* Botón para saltar intro */}
            <button
              type="button"
              onClick={() => setShowSplash(false)}
              className="absolute top-6 right-6 z-20 flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white text-xs font-semibold backdrop-blur-md transition-all active:scale-95"
            >
              <span>{t('maintenance.splash_skip') || 'Saltar intro'}</span>
              <SkipForward size={14} />
            </button>

            <div className="relative z-10 flex flex-col items-center">
              {/* Main Logo Container - Exact Drop In Animation */}
              <motion.div
                initial={{ y: -800, opacity: 0, rotateY: 0 }}
                animate={{
                  y: 0,
                  opacity: 1,
                  rotateY: 2520,
                  transition: {
                    type: 'spring',
                    damping: 10,
                    stiffness: 20,
                    duration: 4.5
                  }
                }}
                className="w-48 h-48 rounded-full bg-gradient-to-br from-[#fdc82f] to-[#e69b00] p-1.5 shadow-[0_0_60px_rgba(253,200,47,0.4)] relative"
              >
                <div className="w-full h-full rounded-full bg-white flex items-center justify-center overflow-hidden border-4 border-[#fffbeb]">
                  <img src="/logo.png" alt="Tacos Gavilan" className="w-[85%] h-[85%] object-contain" />
                </div>

                {/* Ripple Effect */}
                <motion.div
                  className="absolute inset-0 rounded-full border border-white/50"
                  initial={{ scale: 0, opacity: 0.8 }}
                  animate={{
                    scale: 3,
                    opacity: 0,
                    transition: {
                      duration: 2,
                      repeat: Infinity,
                      delay: 1.2,
                      ease: 'easeOut'
                    }
                  }}
                />
              </motion.div>

              {/* Sello "¡Ya está!" */}
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{
                  opacity: 1,
                  scale: 1,
                  transition: { delay: 1, duration: 0.5 }
                }}
                className="mt-8 w-64 h-24 flex items-center justify-center"
              >
                <img
                  src="/ya esta.png"
                  alt="¡Ya está!"
                  className="w-full h-full object-contain drop-shadow-[0_0_15px_rgba(253,200,47,0.5)]"
                />
              </motion.div>

              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0, transition: { delay: 1.5, duration: 0.4 } }}
                className="text-xs uppercase tracking-widest font-extrabold text-[#fdc82f]/90 mt-2"
              >
                {t('maintenance.splash_tagline') || (isEs ? 'Registro de Proveedores & Servicios' : 'Vendor & Maintenance Portal')}
              </motion.p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cabecera Móvil y Barra de Progreso Fija Superior */}
      <header className="flex-shrink-0 pt-[max(0.75rem,env(safe-area-inset-top))] px-4 pb-2.5 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800/80 z-20 shadow-xs">
        <div className="max-w-xl w-full mx-auto">
          <div className="flex items-center justify-between pb-2">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-2xl bg-red-600 text-white flex items-center justify-center font-black text-xs shadow-md shadow-red-600/20">
                TG
              </div>
              <div>
                <h1 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">
                  Tacos Gavilan
                </h1>
                <p className="text-[10px] text-slate-500 font-semibold">
                  {t('maintenance.slide_step_of')?.replace('{current}', String(currentStep)).replace('{total}', String(TOTAL_SLIDES))}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              {/* Selector de Idioma Flotante */}
              <button
                type="button"
                onClick={() => setLanguage(language === 'es' ? 'en' : 'es')}
                className="px-2.5 py-1 rounded-full bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors"
              >
                <Globe size={13} />
                <span>{language === 'es' ? 'EN' : 'ES'}</span>
              </button>
            </div>
          </div>

          {/* Segmented Progress Bar (Estilo Stories) */}
          <div className="grid grid-cols-7 gap-1.5 pt-0.5">
            {Array.from({ length: TOTAL_SLIDES }).map((_, idx) => {
              const stepNum = idx + 1
              const isPast = stepNum < currentStep
              const isCurrent = stepNum === currentStep
              return (
                <div
                  key={idx}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    isPast
                      ? 'bg-red-600'
                      : isCurrent
                      ? 'bg-red-600 ring-2 ring-red-400/40'
                      : 'bg-slate-200 dark:bg-slate-800'
                  }`}
                />
              )
            })}
          </div>
        </div>
      </header>

      {/* Contenido Central Desplazable de Diapositiva */}
      <main ref={mainRef} className="flex-1 overflow-y-auto px-3 sm:px-6 py-3.5 overscroll-contain">
        <div className="max-w-xl w-full mx-auto pb-10 min-h-full flex flex-col justify-start">

          {/* Mensaje de Error Flotante */}
          <AnimatePresence mode="wait">
            {errorMessage && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="mb-4 p-3.5 rounded-2xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-xs font-semibold flex items-center gap-2 shadow-sm"
              >
                <AlertTriangle size={16} className="shrink-0 text-red-600" />
                <span className="flex-1">{errorMessage}</span>
                <button type="button" onClick={() => setErrorMessage(null)} className="p-1 hover:bg-red-100 dark:hover:bg-red-900 rounded-lg">
                  <X size={14} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* CONTENEDOR DE DIAPOSITIVAS INTERACTIVAS */}
          <div className="flex-1 relative overflow-hidden flex flex-col justify-start py-1">
            <AnimatePresence custom={slideDirection} mode="wait">
              {/* ========================================================================= */}
              {/* DIAPOSITIVA 1: SUCURSAL */}
              {/* ========================================================================= */}
              {currentStep === 1 && (
                <motion.div
                  key="step-1"
                  custom={slideDirection}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  className="w-full bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-6 shadow-sm border border-slate-200/80 dark:border-slate-800 space-y-5"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-red-100 dark:bg-red-950/60 text-red-600 flex items-center justify-center shrink-0">
                      <Building2 size={20} />
                    </div>
                    <div>
                      <h2 className="text-base sm:text-lg font-black uppercase tracking-tight text-slate-900 dark:text-white">
                        1. {t('maintenance.select_store')}
                      </h2>
                      <p className="text-xs text-slate-500 font-medium">
                        {t('maintenance.store_question') || (isEs ? '¿En qué sucursal de Tacos Gavilan te encuentras?' : 'Which Tacos Gavilan store are you visiting?')}
                      </p>
                    </div>
                  </div>

                  {/* Tarjeta de Confirmación de Tienda */}
                  {selectedStore && (
                    <div className="p-4 rounded-2xl bg-red-50/80 dark:bg-red-950/40 border-2 border-red-500/40 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-xs sm:text-sm font-black uppercase tracking-wide text-red-700 dark:text-red-300">
                          Tacos Gavilan • {formatStoreName(selectedStore.name)}
                        </span>
                      </div>
                      {selectedStore.address && (
                        <p className="text-xs text-slate-600 dark:text-slate-300 font-semibold pl-4.5 flex items-center gap-1.5">
                          <MapPin size={13} className="text-red-500 shrink-0" />
                          <span>{selectedStore.address}{selectedStore.city ? `, ${selectedStore.city}` : ''}</span>
                        </p>
                      )}
                    </div>
                  )}

                  {/* Selector Dropdown con Nombres Limpios */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
                      {t('maintenance.change_store') || (isEs ? 'Cambiar o Seleccionar Sucursal:' : 'Change or Select Store:')}
                    </label>
                    <select
                      value={selectedStoreId}
                      onChange={(e) => setSelectedStoreId(e.target.value)}
                      disabled={loadingStores}
                      className="w-full px-4 py-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-medium text-base sm:text-sm focus:ring-2 focus:ring-red-500 focus:outline-none transition-shadow"
                    >
                      <option value="">{t('maintenance.select_store_placeholder')}</option>
                      {stores.map(s => (
                        <option key={s.id} value={s.id}>
                          {formatStoreName(s.name)}{s.address ? ` — ${s.address}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </motion.div>
              )}

              {/* ========================================================================= */}
              {/* DIAPOSITIVA 2: PROVEEDOR Y TÉCNICO */}
              {/* ========================================================================= */}
              {currentStep === 2 && (
                <motion.div
                  key="step-2"
                  custom={slideDirection}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  className="w-full bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-6 shadow-sm border border-slate-200/80 dark:border-slate-800 space-y-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 flex items-center justify-center shrink-0">
                      <User size={20} />
                    </div>
                    <div>
                      <h2 className="text-base sm:text-lg font-black uppercase tracking-tight text-slate-900 dark:text-white">
                        2. {t('maintenance.vendor_tech_title')}
                      </h2>
                      <p className="text-xs text-slate-500 font-medium">
                        {t('maintenance.vendor_tech_desc')}
                      </p>
                    </div>
                  </div>

                  {/* Botones de Proveedores Frecuentes */}
                  <div>
                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-2">
                      {t('maintenance.quick_vendors')}
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {COMMON_VENDORS.map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setCompanyName(v)}
                          className={`text-xs px-3 py-1.5 rounded-full font-semibold transition-all ${
                            companyName === v
                              ? 'bg-red-600 text-white shadow-sm'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
                          }`}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Nombre de la Empresa */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      {t('maintenance.company_name')} *
                    </label>
                    <input
                      type="text"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder={t('maintenance.company_placeholder')}
                      className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-medium text-base sm:text-sm focus:ring-2 focus:ring-red-500 focus:outline-none"
                    />
                  </div>

                  {/* Nombre del Técnico */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      {t('maintenance.technician_name')} *
                    </label>
                    <input
                      type="text"
                      value={technicianName}
                      onChange={(e) => setTechnicianName(e.target.value)}
                      placeholder={t('maintenance.technician_placeholder')}
                      className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-medium text-base sm:text-sm focus:ring-2 focus:ring-red-500 focus:outline-none"
                    />
                  </div>

                  {/* Teléfono */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      {t('maintenance.technician_phone')}
                    </label>
                    <input
                      type="tel"
                      value={technicianPhone}
                      onChange={(e) => setTechnicianPhone(e.target.value)}
                      placeholder="Ej. (555) 123-4567"
                      className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-medium text-base sm:text-sm focus:ring-2 focus:ring-red-500 focus:outline-none"
                    />
                  </div>
                </motion.div>
              )}

              {/* ========================================================================= */}
              {/* DIAPOSITIVA 3: CATEGORÍA Y TIPO DE SERVICIO */}
              {/* ========================================================================= */}
              {currentStep === 3 && (
                <motion.div
                  key="step-3"
                  custom={slideDirection}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  className="w-full bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-6 shadow-sm border border-slate-200/80 dark:border-slate-800 space-y-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-blue-100 dark:bg-blue-950/60 text-blue-600 flex items-center justify-center shrink-0">
                      <Wrench size={20} />
                    </div>
                    <div>
                      <h2 className="text-base sm:text-lg font-black uppercase tracking-tight text-slate-900 dark:text-white">
                        3. {t('maintenance.category_service_title')}
                      </h2>
                      <p className="text-xs text-slate-500 font-medium">
                        {t('maintenance.category_service_desc')}
                      </p>
                    </div>
                  </div>

                  {/* Grid de Especialidades */}
                  <div className="grid grid-cols-2 gap-2.5 max-h-[46vh] overflow-y-auto pr-1">
                    {categoriesList.map((cat) => {
                      const IconComp = cat.icon
                      const isSelected = category === cat.id
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => setCategory(cat.id)}
                          className={`p-3 rounded-2xl border text-left flex items-center gap-2.5 transition-all ${
                            isSelected
                              ? `${cat.color} ring-2 ring-red-500 font-bold shadow-sm scale-[1.02]`
                              : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300 hover:bg-slate-100'
                          }`}
                        >
                          <div className="w-8 h-8 rounded-xl bg-white dark:bg-slate-900 flex items-center justify-center shrink-0 shadow-xs">
                            <IconComp size={16} />
                          </div>
                          <span className="text-xs font-semibold leading-tight">{cat.label}</span>
                        </button>
                      )
                    })}
                  </div>

                  {/* Tipo de Trabajo */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
                      {t('maintenance.service_type')}
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { id: 'corrective', label: t('maintenance.type_corrective') },
                        { id: 'preventive', label: t('maintenance.type_preventive') },
                        { id: 'emergency', label: t('maintenance.type_emergency') },
                        { id: 'inspection', label: t('maintenance.type_inspection') }
                      ].map((type) => (
                        <button
                          key={type.id}
                          type="button"
                          onClick={() => setServiceType(type.id)}
                          className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                            serviceType === type.id
                              ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-sm'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                          }`}
                        >
                          {type.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}

              {/* ========================================================================= */}
              {/* DIAPOSITIVA 4: EQUIPO Y DESCRIPCIÓN DEL TRABAJO */}
              {/* ========================================================================= */}
              {currentStep === 4 && (
                <motion.div
                  key="step-4"
                  custom={slideDirection}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  className="w-full bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-6 shadow-sm border border-slate-200/80 dark:border-slate-800 space-y-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-red-100 dark:bg-red-950/60 text-red-600 flex items-center justify-center shrink-0">
                      <FileText size={20} />
                    </div>
                    <div>
                      <h2 className="text-base sm:text-lg font-black uppercase tracking-tight text-slate-900 dark:text-white">
                        4. {t('maintenance.work_details_title')}
                      </h2>
                      <p className="text-xs text-slate-500 font-medium">
                        {t('maintenance.work_details_desc')}
                      </p>
                    </div>
                  </div>

                  {/* Equipo o Área */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      {t('maintenance.area_equipment')} *
                    </label>
                    <input
                      type="text"
                      value={areaEquipment}
                      onChange={(e) => setAreaEquipment(e.target.value)}
                      placeholder={t('maintenance.area_placeholder')}
                      className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-medium text-base sm:text-sm focus:ring-2 focus:ring-red-500 focus:outline-none"
                    />
                  </div>

                  {/* Descripción */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      {t('maintenance.work_description')} *
                    </label>
                    <textarea
                      rows={3}
                      value={workDescription}
                      onChange={(e) => setWorkDescription(e.target.value)}
                      placeholder={t('maintenance.work_placeholder')}
                      className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-medium text-base sm:text-sm focus:ring-2 focus:ring-red-500 focus:outline-none resize-none"
                    />
                  </div>

                  {/* Piezas Reemplazadas */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      {t('maintenance.parts_replaced')}
                    </label>
                    <input
                      type="text"
                      value={partsReplaced}
                      onChange={(e) => setPartsReplaced(e.target.value)}
                      placeholder={t('maintenance.parts_placeholder')}
                      className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-medium text-base sm:text-sm focus:ring-2 focus:ring-red-500 focus:outline-none"
                    />
                  </div>

                  {/* Estado del Servicio */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                      {t('maintenance.status_title')}
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {[
                        { id: 'completed', label: t('maintenance.status_completed'), color: 'text-emerald-700 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40' },
                        { id: 'pending_parts', label: t('maintenance.status_pending_parts'), color: 'text-amber-700 border-amber-300 bg-amber-50 dark:bg-amber-950/40' },
                        { id: 'follow_up_needed', label: t('maintenance.status_follow_up'), color: 'text-blue-700 border-blue-300 bg-blue-50 dark:bg-blue-950/40' }
                      ].map((st) => (
                        <button
                          key={st.id}
                          type="button"
                          onClick={() => setStatus(st.id)}
                          className={`px-3 py-2.5 rounded-2xl text-xs font-bold border transition-all text-center ${
                            status === st.id
                              ? `${st.color} ring-2 ring-slate-900 dark:ring-white shadow-sm`
                              : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          {st.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}

              {/* ========================================================================= */}
              {/* DIAPOSITIVA 5: EVIDENCIAS FOTOGRÁFICAS (OBLIGATORIO) */}
              {/* ========================================================================= */}
              {currentStep === 5 && (
                <motion.div
                  key="step-5"
                  custom={slideDirection}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  className={`w-full bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-6 shadow-sm border transition-all ${
                    totalPhotos === 0
                      ? 'border-amber-400 dark:border-amber-700/80 ring-2 ring-amber-500/20'
                      : 'border-emerald-300 dark:border-emerald-700/60'
                  } space-y-4`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-red-100 dark:bg-red-950/60 text-red-600 flex items-center justify-center shrink-0">
                        <Camera size={20} />
                      </div>
                      <div>
                        <h2 className="text-base sm:text-lg font-black uppercase tracking-tight text-slate-900 dark:text-white">
                          5. {t('maintenance.photos_slide_title')} *
                        </h2>
                        <p className="text-xs text-slate-500 font-medium">
                          {t('maintenance.photos_slide_desc')}
                        </p>
                      </div>
                    </div>
                    <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${
                      totalPhotos === 0
                        ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800'
                        : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
                    }`}>
                      {totalPhotos === 0
                        ? `⚠️ ${t('maintenance.evidence_required_badge')}`
                        : `✓ ${totalPhotos} ${t('maintenance.evidence_count_total')}`}
                    </span>
                  </div>

                  {totalPhotos === 0 && (
                    <div className="p-3 bg-amber-50/80 dark:bg-amber-950/40 rounded-2xl border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
                      <Camera size={16} className="shrink-0 mt-0.5 text-amber-600" />
                      <span>{t('maintenance.evidence_required_notice')}</span>
                    </div>
                  )}

                  <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1">
                    {/* FOTOS ANTES */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                          {t('maintenance.evidence_before')}
                        </span>
                        {photosBefore.length > 0 && (
                          <span className="text-[10px] text-slate-500 font-semibold">
                            {photosBefore.length}/5
                          </span>
                        )}
                      </div>

                      {photosBefore.length === 0 ? (
                        <label className="cursor-pointer flex flex-col items-center justify-center p-4 border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-red-400 rounded-2xl bg-slate-50/60 dark:bg-slate-800/30 transition-all text-center group">
                          <Camera size={24} className="text-slate-400 group-hover:text-red-600 mb-1 transition-colors" />
                          <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                            {uploadingSection === 'before' ? t('maintenance.uploading_photo') : t('maintenance.evidence_tap_to_capture')}
                          </span>
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            multiple
                            disabled={uploadingSection !== null}
                            onChange={(e) => handlePhotoUpload(e, 'before')}
                            className="hidden"
                          />
                        </label>
                      ) : (
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                          {photosBefore.map((url, idx) => (
                            <div key={idx} className="relative group aspect-square rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 shadow-xs">
                              <img src={url} alt="Antes" className="w-full h-full object-cover" />
                              <button
                                type="button"
                                onClick={() => removePhoto(url, 'before')}
                                className="absolute top-1 right-1 p-1 rounded-full bg-black/70 text-white hover:bg-red-600 transition-colors shadow-sm"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          ))}
                          {photosBefore.length < 5 && (
                            <label className="cursor-pointer aspect-square rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-red-500 bg-slate-50/60 dark:bg-slate-800/40 flex flex-col items-center justify-center gap-1 text-slate-500 hover:text-red-600 transition-colors group">
                              <Plus size={20} className="group-hover:scale-110 transition-transform" />
                              <span className="text-[10px] font-bold uppercase">{uploadingSection === 'before' ? '...' : (t('maintenance.add_another_photo') || '+ Foto')}</span>
                              <input
                                type="file"
                                accept="image/*"
                                capture="environment"
                                multiple
                                disabled={uploadingSection !== null}
                                onChange={(e) => handlePhotoUpload(e, 'before')}
                                className="hidden"
                              />
                            </label>
                          )}
                        </div>
                      )}
                    </div>

                    {/* FOTOS DESPUÉS */}
                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                          {t('maintenance.evidence_after')}
                        </span>
                        {photosAfter.length > 0 && (
                          <span className="text-[10px] text-slate-500 font-semibold">
                            {photosAfter.length}/5
                          </span>
                        )}
                      </div>

                      {photosAfter.length === 0 ? (
                        <label className="cursor-pointer flex flex-col items-center justify-center p-4 border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-emerald-400 rounded-2xl bg-slate-50/60 dark:bg-slate-800/30 transition-all text-center group">
                          <Camera size={24} className="text-slate-400 group-hover:text-emerald-600 mb-1 transition-colors" />
                          <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                            {uploadingSection === 'after' ? t('maintenance.uploading_photo') : t('maintenance.evidence_tap_to_capture')}
                          </span>
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            multiple
                            disabled={uploadingSection !== null}
                            onChange={(e) => handlePhotoUpload(e, 'after')}
                            className="hidden"
                          />
                        </label>
                      ) : (
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                          {photosAfter.map((url, idx) => (
                            <div key={idx} className="relative group aspect-square rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 shadow-xs">
                              <img src={url} alt="Después" className="w-full h-full object-cover" />
                              <button
                                type="button"
                                onClick={() => removePhoto(url, 'after')}
                                className="absolute top-1 right-1 p-1 rounded-full bg-black/70 text-white hover:bg-red-600 transition-colors shadow-sm"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          ))}
                          {photosAfter.length < 5 && (
                            <label className="cursor-pointer aspect-square rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-emerald-500 bg-slate-50/60 dark:bg-slate-800/40 flex flex-col items-center justify-center gap-1 text-slate-500 hover:text-emerald-600 transition-colors group">
                              <Plus size={20} className="group-hover:scale-110 transition-transform" />
                              <span className="text-[10px] font-bold uppercase">{uploadingSection === 'after' ? '...' : (t('maintenance.add_another_photo') || '+ Foto')}</span>
                              <input
                                type="file"
                                accept="image/*"
                                capture="environment"
                                multiple
                                disabled={uploadingSection !== null}
                                onChange={(e) => handlePhotoUpload(e, 'after')}
                                className="hidden"
                              />
                            </label>
                          )}
                        </div>
                      )}
                    </div>

                    {/* FOTO FACTURA / TICKET (Galería o PDF permitido) */}
                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                          {t('maintenance.evidence_invoice')}
                        </span>
                        {photosInvoice.length > 0 && (
                          <span className="text-[10px] text-slate-500 font-semibold">
                            {photosInvoice.length}/5
                          </span>
                        )}
                      </div>

                      {photosInvoice.length === 0 ? (
                        <label className="cursor-pointer flex flex-col items-center justify-center p-3.5 border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-blue-400 rounded-2xl bg-slate-50/60 dark:bg-slate-800/30 transition-all text-center group">
                          <UploadCloud size={22} className="text-slate-400 group-hover:text-blue-600 mb-1 transition-colors" />
                          <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                            {uploadingSection === 'invoice' ? t('maintenance.uploading_photo') : t('maintenance.evidence_tap_to_capture')}
                          </span>
                          <input
                            type="file"
                            accept="image/*,application/pdf"
                            multiple
                            disabled={uploadingSection !== null}
                            onChange={(e) => handlePhotoUpload(e, 'invoice')}
                            className="hidden"
                          />
                        </label>
                      ) : (
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                          {photosInvoice.map((url, idx) => (
                            <div key={idx} className="relative group aspect-square rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 shadow-xs">
                              <img src={url} alt="Factura" className="w-full h-full object-cover" />
                              <button
                                type="button"
                                onClick={() => removePhoto(url, 'invoice')}
                                className="absolute top-1 right-1 p-1 rounded-full bg-black/70 text-white hover:bg-red-600 transition-colors shadow-sm"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          ))}
                          {photosInvoice.length < 5 && (
                            <label className="cursor-pointer aspect-square rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 bg-slate-50/60 dark:bg-slate-800/40 flex flex-col items-center justify-center gap-1 text-slate-500 hover:text-blue-600 transition-colors group">
                              <Plus size={20} className="group-hover:scale-110 transition-transform" />
                              <span className="text-[10px] font-bold uppercase">{uploadingSection === 'invoice' ? '...' : (t('maintenance.add_another_photo') || '+ Doc')}</span>
                              <input
                                type="file"
                                accept="image/*,application/pdf"
                                multiple
                                disabled={uploadingSection !== null}
                                onChange={(e) => handlePhotoUpload(e, 'invoice')}
                                className="hidden"
                              />
                            </label>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}

              {/* ========================================================================= */}
              {/* DIAPOSITIVA 6: FACTURACIÓN Y COSTO (OPCIONAL) */}
              {/* ========================================================================= */}
              {currentStep === 6 && (
                <motion.div
                  key="step-6"
                  custom={slideDirection}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  className="w-full bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-6 shadow-sm border border-slate-200/80 dark:border-slate-800 space-y-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center shrink-0">
                      <DollarSign size={20} />
                    </div>
                    <div>
                      <h2 className="text-base sm:text-lg font-black uppercase tracking-tight text-slate-900 dark:text-white">
                        6. {t('maintenance.accounting_slide_title')}
                      </h2>
                      <p className="text-xs text-slate-500 font-medium">
                        {t('maintenance.accounting_slide_desc')}
                      </p>
                    </div>
                  </div>

                  {/* Número de Factura */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      {t('maintenance.invoice_number')}
                    </label>
                    <input
                      type="text"
                      value={invoiceNumber}
                      onChange={(e) => setInvoiceNumber(e.target.value)}
                      placeholder={t('maintenance.invoice_placeholder')}
                      className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-medium text-base sm:text-sm focus:ring-2 focus:ring-red-500 focus:outline-none"
                    />
                  </div>

                  {/* Monto Estimado */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      {t('maintenance.cost_estimate')}
                    </label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={costEstimate}
                        onChange={(e) => setCostEstimate(e.target.value)}
                        placeholder={t('maintenance.cost_placeholder')}
                        className="w-full pl-8 pr-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-medium text-base sm:text-sm focus:ring-2 focus:ring-red-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-2xl text-xs text-slate-500 text-center font-medium">
                    {t('maintenance.skip_step_notice') || (isEs ? 'Si aún no tienes la factura lista, puedes omitir este paso.' : 'If invoice is not ready yet, you can skip this step.')}
                  </div>
                </motion.div>
              )}

              {/* ========================================================================= */}
              {/* DIAPOSITIVA 7: VALIDACIÓN Y FIRMA DEL ENCARGADO */}
              {/* ========================================================================= */}
              {currentStep === 7 && (
                <motion.div
                  key="step-7"
                  custom={slideDirection}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  className="w-full bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-6 shadow-sm border border-slate-200/80 dark:border-slate-800 space-y-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-purple-100 dark:bg-purple-950/60 text-purple-600 flex items-center justify-center shrink-0">
                      <ShieldCheck size={20} />
                    </div>
                    <div>
                      <h2 className="text-base sm:text-lg font-black uppercase tracking-tight text-slate-900 dark:text-white">
                        7. {t('maintenance.signature_slide_title')}
                      </h2>
                      <p className="text-xs text-slate-500 font-medium">
                        {t('maintenance.signature_slide_desc')}
                      </p>
                    </div>
                  </div>

                  {/* Nombre del Encargado */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      {t('maintenance.manager_name')} *
                    </label>
                    <input
                      type="text"
                      value={managerName}
                      onChange={(e) => setManagerName(e.target.value)}
                      placeholder={t('maintenance.manager_placeholder')}
                      className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-medium text-base sm:text-sm focus:ring-2 focus:ring-red-500 focus:outline-none"
                    />
                  </div>

                  {/* Pad de Firma Digital Táctil con Rehidratación */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      {t('maintenance.manager_signature')} *
                    </label>
                    <SignaturePad
                      initialSignatureUrl={signatureDataUrl}
                      onSignatureChange={(dataUrl) => setSignatureDataUrl(dataUrl)}
                      disabled={submitting}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      {/* ========================================================================= */}
      {/* BARRA DE NAVEGACIÓN INFERIOR (Atrás / Continuar / Iniciar / Finalizar) */}
      {/* ========================================================================= */}
      <footer className="flex-shrink-0 px-4 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200/80 dark:border-slate-800/80 z-20 shadow-lg">
        <div className="max-w-xl w-full mx-auto">
          {/* PASO 1: Botón gigante de ancho completo para Iniciar Registro */}
          {currentStep === 1 ? (
            <button
              type="button"
              onClick={handleNext}
              className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 active:from-red-700 active:to-red-800 text-white font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2.5 shadow-xl shadow-red-600/30 transition-all hover:scale-[1.01] active:scale-[0.98]"
            >
              <span>{t('maintenance.btn_start') || (isEs ? 'Comenzar Registro' : 'Start Registration')}</span>
              <ArrowRight size={18} />
            </button>
          ) : currentStep < TOTAL_SLIDES ? (
            /* PASOS 2 A 6: Botón Atrás + Botón Continuar expandido */
            <div className="flex items-center gap-2.5 w-full">
              <button
                type="button"
                onClick={handleBack}
                disabled={submitting}
                className="py-3.5 px-4 sm:px-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs sm:text-sm flex items-center gap-1.5 transition-all shadow-xs active:scale-[0.97]"
              >
                <ArrowLeft size={16} />
                <span>{t('maintenance.btn_back')}</span>
              </button>

              {currentStep === 6 && (
                <button
                  type="button"
                  onClick={handleNext}
                  className="py-3.5 px-3 rounded-2xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold transition-colors whitespace-nowrap"
                >
                  {t('maintenance.btn_skip')}
                </button>
              )}

              <button
                type="button"
                onClick={handleNext}
                className="flex-1 py-3.5 px-6 rounded-2xl bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 active:from-red-700 active:to-red-800 text-white font-black text-xs sm:text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-red-600/30 transition-all hover:scale-[1.01] active:scale-[0.98]"
              >
                <span>{t('maintenance.btn_next')}</span>
                <ArrowRight size={16} />
              </button>
            </div>
          ) : (
            /* PASO 7: Botón Atrás + Botón Finalizar y Registrar */
            <div className="flex items-center gap-2.5 w-full">
              <button
                type="button"
                onClick={handleBack}
                disabled={submitting}
                className="py-3.5 px-4 sm:px-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs sm:text-sm flex items-center gap-1.5 transition-all shadow-xs active:scale-[0.97]"
              >
                <ArrowLeft size={16} />
                <span>{t('maintenance.btn_back')}</span>
              </button>

              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="flex-1 py-3.5 px-6 rounded-2xl bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 active:from-emerald-700 active:to-emerald-800 disabled:bg-slate-400 text-white font-black text-xs sm:text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/30 transition-all hover:scale-[1.01] active:scale-[0.98]"
              >
                {submitting ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    <span>{t('maintenance.submitting')}</span>
                  </>
                ) : (
                  <>
                    <Check size={18} />
                    <span>{t('maintenance.btn_finish')}</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </footer>
    </div>
  )
}

export default function MaintenanceRegistrationPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
          <div className="w-10 h-10 border-4 border-red-600 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <MaintenanceFormContent />
    </Suspense>
  )
}
