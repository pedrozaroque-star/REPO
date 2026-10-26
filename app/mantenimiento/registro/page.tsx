/**
 * @module app/mantenimiento/registro/page
 * @description Portal público móvil interactivo para el registro de actividades, reparaciones y visitas
 * de técnicos y proveedores de servicio en Tacos Gavilan.
 * @businessRules
 * - Acceso abierto sin inicio de sesión (ruta pública en middleware.ts y ClientLayout.tsx).
 * - Splash interactivo institucional con la animación oficial del logo cayendo ("¡Ya está!").
 * - Flujo por diapositivas (Step-by-Step Slide Wizard) optimizado para pantallas táctiles de celulares.
 * - Selección híbrida de sucursal con fallback mutuo en Paso 1:
 *   1) Si se ingresa mediante código QR con parámetro ?store={id}, selecciona esa tienda de inmediato.
 *   2) Si no viene ?store= (o si el usuario pulsa "Detectar Sucursal por GPS"), geolocaliza por GPS (fórmula Haversine contra las coordenadas reales de las 15 sucursales + La Bodega) y selecciona automáticamente la tienda más cercana, ordenando el selector por proximidad en millas.
 *   3) Si el GPS es denegado, falla o el técnico desea cambiarla, el selector desplegable manual permite elegir cualquier sucursal al instante.
 * - En Paso 2, las sugerencias rápidas provienen del directorio histórico real de empresas y técnicos (`GET /api/mantenimiento?directory=1`) combinado con la memoria local del dispositivo (`localStorage`).
 * - Evidencias fotográficas obligatorias (Antes, Después o Nota/Factura física).
 * - En Paso 7, permite elegir con 1 toque a cualquiera de los encargados del turno del día en curso (`GET /api/mantenimiento?shift_leaders=1&store_id=...`), cruzando el Módulo PLANIFICADOR (`shifts` + `toast_employees` + `toast_jobs`) y el Módulo HORARIOS (`schedules` + `users`) para mostrar a los Supervisores, Managers, Asistentes Manager y Shift Leaders con su horario del día y estado "En Turno Ahora", además de requerir su firma digital táctil (o activar el Protocolo de Verificación por Cámaras de Seguridad CCTV si es servicio nocturno sin firma).
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
  Building2, User, FileText, DollarSign, UploadCloud,
  X, Sparkles, RefreshCw, Flame, Snowflake, Bug, Droplets,
  Zap, Lock, Cpu, ArrowRight, ArrowLeft,
  Globe, MapPin, Check, SkipForward, ExternalLink,
  Clock, LogOut, Plus, Loader2
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
  latitude?: number | null
  longitude?: number | null
  distanceMiles?: number | null
}

function calculateDistanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const R = 3958.8 // Radio de la Tierra en millas
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

interface DirectoryCompany {
  company_name: string
  last_technician_name: string
  last_technician_phone: string
  last_category: string
  visit_count: number
  store_ids?: string[]
}

interface DirectoryTechnician {
  technician_name: string
  company_name: string
  technician_phone: string
  category: string
  visit_count: number
  store_ids?: string[]
}

interface ShiftLeaderOption {
  id: string
  name: string
  role: 'supervisor' | 'manager' | 'assistant_manager' | 'shift_leader'
  start_time: string
  end_time: string
  shift_block: 'AM' | 'PM' | 'FULL' | null
  shift_label: string
  source: 'horarios' | 'planificador' | 'horarios+planificador' | 'supervisor' | 'store_roster'
  scheduled_today: boolean
  is_on_shift_now: boolean
}

const TOTAL_SLIDES = 7
const DRAFT_STORAGE_KEY = 'teg_maintenance_draft_v1'
const TECH_MEMORY_KEY = 'teg_maintenance_tech_v1'

const LEGACY_GENERIC_TRADES = new Set([
  'servicio de campanas y ductos',
  'hood & exhaust cleaning service',
  'técnico de refrigeración y hielo',
  'refrigeration & ice machine service',
  'control de plagas y fumigación',
  'pest control & extermination',
  'plomería y trampa de grasa',
  'plumbing & grease trap service',
  'técnico de equipos de cocina',
  'cooking equipment technician',
  'servicio eléctrico e iluminación',
  'electrical & lighting service',
  'servicio de plomería y drenajes'
])

function getCurrentTimeHHMM(): string {
  const laDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
  const hh = String(laDate.getHours()).padStart(2, '0')
  const mi = String(laDate.getMinutes()).padStart(2, '0')
  return `${hh}:${mi}`
}

function MaintenanceFormContent() {
  const { t, language, setLanguage } = useLanguage()
  const searchParams = useSearchParams()
  const storeParam = searchParams.get('store') || searchParams.get('store_id') || ''

  // Splash Animation State (Identical to Login)
  const [showSplash, setShowSplash] = useState(true)
  const [draftHydrated, setDraftHydrated] = useState(false)

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
  const [startTime, setStartTime] = useState<string>(() => getCurrentTimeHHMM())
  const [endTime, setEndTime] = useState<string>('')
  const [warrantyDays, setWarrantyDays] = useState<number>(0)
  const [isAfterHours, setIsAfterHours] = useState<boolean>(false)
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [costEstimate, setCostEstimate] = useState('')
  const [managerName, setManagerName] = useState('')
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null)

  // Photos State
  const [photosBefore, setPhotosBefore] = useState<string[]>([])
  const [photosAfter, setPhotosAfter] = useState<string[]>([])
  const [photosInvoice, setPhotosInvoice] = useState<string[]>([])
  const [uploadingSection, setUploadingSection] = useState<'before' | 'after' | 'invoice' | null>(null)

  // Directorio dinámico de proveedores y técnicos que ya han realizado trabajos en las tiendas
  const [directoryCompanies, setDirectoryCompanies] = useState<DirectoryCompany[]>([])
  const [directoryTechnicians, setDirectoryTechnicians] = useState<DirectoryTechnician[]>([])

  // Encargados del turno del día en curso (Módulo PLANIFICADOR + Módulo HORARIOS: Supervisor, Manager, Asistente Manager, Shift Leader)
  const [shiftLeaders, setShiftLeaders] = useState<ShiftLeaderOption[]>([])
  const [loadingShiftLeaders, setLoadingShiftLeaders] = useState(false)

  // Estado de Geolocalización GPS + Respaldo Manual
  const [locatingGps, setLocatingGps] = useState(false)
  const [gpsDetectedDistance, setGpsDetectedDistance] = useState<number | null>(null)
  const [gpsFallbackNotice, setGpsFallbackNotice] = useState(false)

  // Restaurar borrador de sessionStorage (protección contra recarga de cámara en móviles) y memoria del técnico
  useEffect(() => {
    try {
      const savedTech = localStorage.getItem(TECH_MEMORY_KEY)
      if (savedTech) {
        const parsedTech = JSON.parse(savedTech)
        const savedComp = String(parsedTech.companyName || '').trim()
        if (savedComp && !LEGACY_GENERIC_TRADES.has(savedComp.toLowerCase())) {
          setCompanyName(savedComp)
        }
        if (parsedTech.technicianName) setTechnicianName(parsedTech.technicianName)
        if (parsedTech.technicianPhone) setTechnicianPhone(parsedTech.technicianPhone)
      }

      const savedDraft = sessionStorage.getItem(DRAFT_STORAGE_KEY)
      if (savedDraft) {
        const d = JSON.parse(savedDraft)
        if (typeof d.currentStep === 'number' && d.currentStep >= 1 && d.currentStep <= TOTAL_SLIDES) {
          setCurrentStep(d.currentStep)
          if (d.currentStep > 1) setShowSplash(false)
        }
        if (!storeParam && d.selectedStoreId) setSelectedStoreId(d.selectedStoreId)
        if (d.companyName && !LEGACY_GENERIC_TRADES.has(String(d.companyName).trim().toLowerCase())) {
          setCompanyName(d.companyName)
        }
        if (d.technicianName) setTechnicianName(d.technicianName)
        if (d.technicianPhone) setTechnicianPhone(d.technicianPhone)
        if (d.category) setCategory(d.category)
        if (d.serviceType) setServiceType(d.serviceType)
        if (d.areaEquipment) setAreaEquipment(d.areaEquipment)
        if (d.workDescription) setWorkDescription(d.workDescription)
        if (d.partsReplaced) setPartsReplaced(d.partsReplaced)
        if (d.status) setStatus(d.status)
        if (d.startTime) setStartTime(d.startTime)
        if (d.endTime) setEndTime(d.endTime)
        if (typeof d.warrantyDays === 'number') setWarrantyDays(d.warrantyDays)
        if (typeof d.isAfterHours === 'boolean') setIsAfterHours(d.isAfterHours)
        if (d.invoiceNumber) setInvoiceNumber(d.invoiceNumber)
        if (d.costEstimate) setCostEstimate(d.costEstimate)
        if (d.managerName) setManagerName(d.managerName)
        if (Array.isArray(d.photosBefore)) setPhotosBefore(d.photosBefore)
        if (Array.isArray(d.photosAfter)) setPhotosAfter(d.photosAfter)
        if (Array.isArray(d.photosInvoice)) setPhotosInvoice(d.photosInvoice)
      }
    } catch {
      // Ignore storage access errors in private browsing
    } finally {
      setDraftHydrated(true)
    }
  }, [storeParam])

  // Cargar directorio real de proveedores y técnicos que ya han realizado trabajos en las tiendas
  useEffect(() => {
    let active = true
    async function loadProviderDirectory() {
      try {
        const qs = selectedStoreId ? `&store_id=${encodeURIComponent(selectedStoreId)}` : ''
        const res = await fetch(`/api/mantenimiento?directory=1${qs}`)
        const json = await res.json()
        if (!active) return

        const apiCompanies: DirectoryCompany[] = Array.isArray(json?.companies) ? json.companies : []
        const apiTechs: DirectoryTechnician[] = Array.isArray(json?.technicians) ? json.technicians : []

        // Combinar también con el último registro guardado en este dispositivo (si existe y no es genérico)
        try {
          const savedTechRaw = localStorage.getItem(TECH_MEMORY_KEY)
          if (savedTechRaw) {
            const parsed = JSON.parse(savedTechRaw)
            const localComp = String(parsed.companyName || '').trim()
            const localTech = String(parsed.technicianName || '').trim()
            const localPhone = String(parsed.technicianPhone || '').trim()

            if (
              localComp &&
              !LEGACY_GENERIC_TRADES.has(localComp.toLowerCase()) &&
              !apiCompanies.some(c => c.company_name.toLowerCase() === localComp.toLowerCase())
            ) {
              apiCompanies.unshift({
                company_name: localComp,
                last_technician_name: localTech,
                last_technician_phone: localPhone,
                last_category: category || 'general',
                visit_count: 1
              })
            }

            if (
              localTech &&
              !apiTechs.some(
                t =>
                  t.technician_name.toLowerCase() === localTech.toLowerCase() &&
                  t.company_name.toLowerCase() === localComp.toLowerCase()
              )
            ) {
              apiTechs.unshift({
                technician_name: localTech,
                company_name: !LEGACY_GENERIC_TRADES.has(localComp.toLowerCase()) ? localComp : '',
                technician_phone: localPhone,
                category: category || 'general',
                visit_count: 1
              })
            }
          }
        } catch {
          // Ignore localStorage error
        }

        setDirectoryCompanies(apiCompanies)
        setDirectoryTechnicians(apiTechs)
      } catch (err) {
        console.warn('No se pudo cargar el directorio de proveedores previos:', err)
      }
    }
    loadProviderDirectory()
    return () => {
      active = false
    }
  }, [selectedStoreId, successData])

  // Cargar encargados del turno del día en curso (Planificador + Horarios) cuando cambia la tienda o la hora
  useEffect(() => {
    let active = true
    async function loadStoreShiftLeaders() {
      if (!selectedStoreId) {
        setShiftLeaders([])
        return
      }
      setLoadingShiftLeaders(true)
      try {
        const refTime = endTime || startTime || getCurrentTimeHHMM()
        const res = await fetch(
          `/api/mantenimiento?shift_leaders=1&store_id=${encodeURIComponent(selectedStoreId)}&time=${encodeURIComponent(refTime)}`
        )
        const json = await res.json()
        if (!active) return
        if (json?.success && Array.isArray(json.leaders)) {
          setShiftLeaders(json.leaders)
        } else {
          setShiftLeaders([])
        }
      } catch (err) {
        console.warn('No se pudieron cargar los encargados del turno:', err)
        if (active) setShiftLeaders([])
      } finally {
        if (active) setLoadingShiftLeaders(false)
      }
    }
    loadStoreShiftLeaders()
    return () => {
      active = false
    }
  }, [selectedStoreId, endTime, startTime])

  // Guardar borrador automáticamente en sessionStorage y recordar datos del técnico
  useEffect(() => {
    if (!draftHydrated || successData) return
    try {
      const draft = {
        currentStep,
        selectedStoreId,
        companyName,
        technicianName,
        technicianPhone,
        category,
        serviceType,
        areaEquipment,
        workDescription,
        partsReplaced,
        status,
        startTime,
        endTime,
        warrantyDays,
        isAfterHours,
        invoiceNumber,
        costEstimate,
        managerName,
        photosBefore,
        photosAfter,
        photosInvoice
      }
      sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft))

      if (companyName.trim() || technicianName.trim()) {
        localStorage.setItem(
          TECH_MEMORY_KEY,
          JSON.stringify({
            companyName: companyName.trim(),
            technicianName: technicianName.trim(),
            technicianPhone: technicianPhone.trim()
          })
        )
      }
    } catch {
      // Ignore quota errors
    }
  }, [
    draftHydrated,
    successData,
    currentStep,
    selectedStoreId,
    companyName,
    technicianName,
    technicianPhone,
    category,
    serviceType,
    areaEquipment,
    workDescription,
    partsReplaced,
    status,
    startTime,
    endTime,
    warrantyDays,
    isAfterHours,
    invoiceNumber,
    costEstimate,
    managerName,
    photosBefore,
    photosAfter,
    photosInvoice
  ])

  // Handler para cerrar ventana o redirigir a tacosgavilan.com
  const handleFinishAndExit = () => {
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

  // Detectar sucursal más cercana mediante GPS (Fórmula Haversine) con respaldo manual automático
  const detectNearestStoreByGPS = (catalogToUse?: Store[], forceSelect = false) => {
    const list = catalogToUse || stores
    if (!list || list.length === 0) return

    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      if (forceSelect) setGpsFallbackNotice(true)
      return
    }

    setLocatingGps(true)
    setGpsFallbackNotice(false)

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const userLat = pos.coords.latitude
        const userLng = pos.coords.longitude

        let nearest: Store | null = null
        let minDist = Infinity

        const updatedStores = list.map((s) => {
          const lat = Number(s.latitude)
          const lng = Number(s.longitude)
          if (!Number.isNaN(lat) && !Number.isNaN(lng) && lat !== 0 && lng !== 0) {
            const dist = calculateDistanceMiles(userLat, userLng, lat, lng)
            if (dist < minDist) {
              minDist = dist
              nearest = { ...s, distanceMiles: dist }
            }
            return { ...s, distanceMiles: dist }
          }
          return s
        })

        // Ordenar por cercanía cuando hay GPS activo
        updatedStores.sort((a, b) => {
          const da = typeof a.distanceMiles === 'number' ? a.distanceMiles : 99999
          const db = typeof b.distanceMiles === 'number' ? b.distanceMiles : 99999
          return da - db
        })

        setStores(updatedStores)
        setLocatingGps(false)

        if (nearest && (forceSelect || !selectedStoreId)) {
          const foundNearest = nearest as Store
          setSelectedStoreId(String(foundNearest.id))
          setGpsDetectedDistance(
            typeof foundNearest.distanceMiles === 'number'
              ? Number(foundNearest.distanceMiles.toFixed(1))
              : null
          )
          setErrorMessage(null)
        }
      },
      () => {
        // Si falla el GPS (permiso denegado o sin señal), activar aviso suave y dejar selector manual listo
        setLocatingGps(false)
        setGpsFallbackNotice(true)
      },
      {
        enableHighAccuracy: true,
        timeout: 7000,
        maximumAge: 60000
      }
    )
  }

  // Cargar lista de tiendas ordenadas numéricamente + La Bodega (Almacén Central) + Coordenadas GPS
  useEffect(() => {
    async function loadStores() {
      const bodegaEntry: Store = {
        id: 'BODEGA',
        name: 'La Bodega (Almacén Central)',
        code: 'BODEGA',
        city: 'Vernon / Los Angeles',
        address: 'Almacén Central Tacos Gavilan',
        latitude: 34.0039,
        longitude: -118.2301
      }

      try {
        const supabase = await getSupabaseClient()
        const { data, error } = await supabase
          .from('stores')
          .select('id, name, code, city, address, latitude, longitude, is_active')
          .order('id')

        if (!error && data) {
          const activeStores: Store[] = [
            ...data.filter((s: any) => s.is_active !== false),
            ...(data.some((s: any) => String(s.id).toUpperCase() === 'BODEGA') ? [] : [bodegaEntry])
          ]
          setStores(activeStores)

          // 1. Preselección si viene ?store= en el código QR
          let matchedFromUrl = false
          if (storeParam) {
            const p = String(storeParam).trim().toLowerCase()
            const pNoZeros = p.replace(/^0+/, '') || '0'
            const matched = activeStores.find((s: any) =>
              String(s.id).toLowerCase() === p ||
              String(s.id).toLowerCase() === pNoZeros ||
              s.code?.toLowerCase() === p ||
              s.code?.toLowerCase() === p.padStart(2, '0') ||
              s.name?.toLowerCase() === p ||
              formatStoreName(s.name).toLowerCase() === p
            )
            if (matched) {
              setSelectedStoreId(String(matched.id))
              matchedFromUrl = true
            }
          }

          // 2. Si no viene tienda en el QR (o falló el parámetro), intentar detectar automáticamente por GPS
          if (!matchedFromUrl) {
            detectNearestStoreByGPS(activeStores, false)
          }
        } else {
          setStores([bodegaEntry])
        }
      } catch (err) {
        console.error('Error cargando tiendas:', err)
        setStores([bodegaEntry])
      } finally {
        setLoadingStores(false)
      }
    }
    loadStores()
  }, [storeParam])

  // Subida de foto con compresión previa en el navegador y límite máximo de 5 archivos por sección
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>, section: 'before' | 'after' | 'invoice') => {
    const files = e.target.files
    if (!files || files.length === 0) return

    const currentPhotos =
      section === 'before' ? photosBefore : section === 'after' ? photosAfter : photosInvoice
    const remainingSlots = 5 - currentPhotos.length

    if (remainingSlots <= 0) {
      setErrorMessage(t('maintenance.error_max_photos'))
      e.target.value = ''
      return
    }

    setUploadingSection(section)
    setErrorMessage(null)

    const filesToUpload = Array.from(files).slice(0, remainingSlots)
    const exceededLimit = files.length > remainingSlots

    try {
      for (let i = 0; i < filesToUpload.length; i++) {
        let file = filesToUpload[i]

        // Compresión automática de imágenes antes de enviar a Vercel (no comprimir PDFs)
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
          if (section === 'before') setPhotosBefore(prev => [...prev, result.url].slice(0, 5))
          if (section === 'after') setPhotosAfter(prev => [...prev, result.url].slice(0, 5))
          if (section === 'invoice') setPhotosInvoice(prev => [...prev, result.url].slice(0, 5))
        } else {
          throw new Error(result.error || t('maintenance.error_upload_photo'))
        }
      }

      if (exceededLimit) {
        setErrorMessage(t('maintenance.error_max_photos'))
      }
    } catch (err: any) {
      console.error('Error al subir imagen:', err)
      setErrorMessage(err.message || t('maintenance.error_upload_photo'))
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

  // Toggle multi-selección de chips de equipo en Paso 4
  const toggleEquipmentChip = (chipLabel: string) => {
    const currentParts = areaEquipment
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)

    const exists = currentParts.some(p => p.toLowerCase() === chipLabel.toLowerCase())
    if (exists) {
      const nextParts = currentParts.filter(p => p.toLowerCase() !== chipLabel.toLowerCase())
      setAreaEquipment(nextParts.join(', '))
    } else {
      const nextParts = [...currentParts, chipLabel]
      setAreaEquipment(nextParts.join(', '))
    }
  }

  // Validaciones por diapositiva
  const validateStep = (step: number): boolean => {
    setErrorMessage(null)

    if (step === 1) {
      if (!selectedStoreId) {
        setErrorMessage(t('maintenance.error_select_store'))
        return false
      }
      return true
    }

    if (step === 2) {
      if (!companyName.trim()) {
        setErrorMessage(t('maintenance.error_vendor_company'))
        return false
      }
      if (!technicianName.trim()) {
        setErrorMessage(t('maintenance.error_tech_name'))
        return false
      }
      return true
    }

    if (step === 3) {
      if (!category) {
        setErrorMessage(t('maintenance.error_category'))
        return false
      }
      return true
    }

    if (step === 4) {
      if (!areaEquipment.trim()) {
        setErrorMessage(t('maintenance.error_area'))
        return false
      }
      if (!workDescription.trim()) {
        setErrorMessage(t('maintenance.error_description'))
        return false
      }
      return true
    }

    if (step === 5) {
      const totalPhotosCount = photosBefore.length + photosAfter.length + photosInvoice.length
      if (totalPhotosCount === 0) {
        setErrorMessage(t('maintenance.error_evidence_required'))
        return false
      }
      return true
    }

    if (step === 6) {
      return true
    }

    if (step === 7) {
      const totalPhotosCount = photosBefore.length + photosAfter.length + photosInvoice.length
      if (isAfterHours) {
        if (totalPhotosCount < 2) {
          setErrorMessage(t('maintenance.error_after_hours_photos'))
          return false
        }
        return true
      }
      if (!managerName.trim()) {
        setErrorMessage(t('maintenance.error_manager_name'))
        return false
      }
      if (!signatureDataUrl) {
        setErrorMessage(t('maintenance.error_signature_required'))
        return false
      }
      return true
    }

    return true
  }

  const handleNext = () => {
    if (!validateStep(currentStep)) return
    if (currentStep < TOTAL_SLIDES) {
      const nextStep = currentStep + 1
      if ((nextStep === 6 || nextStep === 7) && !endTime) {
        setEndTime(getCurrentTimeHHMM())
      }
      setSlideDirection(1)
      setCurrentStep(nextStep)
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
      // 1. Subir firma digital en base64 si existe (y no es servicio nocturno sin firma)
      let signatureUrl: string | null = null
      if (signatureDataUrl && !isAfterHours) {
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
            throw new Error(sigJson.error || t('maintenance.error_save_signature'))
          }
        } catch (sigErr) {
          console.warn('Error guardando firma táctil:', sigErr)
          throw new Error(t('maintenance.error_save_signature'))
        }
      }

      // 2. Guardar registro en /api/mantenimiento
      const parsedCost = costEstimate.trim() ? parseFloat(costEstimate.replace(/[^0-9.]/g, '')) : null
      const validCost = parsedCost !== null && !isNaN(parsedCost) && isFinite(parsedCost) ? parsedCost : null

      const resolvedManager = isAfterHours
        ? managerName.trim()
          ? `${managerName.trim()} (${t('maintenance.after_hours_manager_default')})`
          : t('maintenance.after_hours_manager_default')
        : managerName.trim()

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
        start_time: startTime || getCurrentTimeHHMM(),
        end_time: endTime || getCurrentTimeHHMM(),
        photos_before: photosBefore,
        photos_after: photosAfter,
        photos_invoice: photosInvoice,
        invoice_number: invoiceNumber || null,
        cost_estimate: validCost,
        manager_name: resolvedManager,
        manager_signature_url: signatureUrl,
        is_after_hours: isAfterHours,
        warranty_days: warrantyDays
      }

      const res = await fetch('/api/mantenimiento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const result = await res.json()

      if (!res.ok || !result.success) {
        throw new Error(result.error || t('maintenance.error_save_record'))
      }

      try {
        sessionStorage.removeItem(DRAFT_STORAGE_KEY)
      } catch {
        // Ignore storage error
      }

      setSuccessData(result.data)
      setRedirectCancelled(false)
      setRedirectCountdown(6)
      mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err: any) {
      console.error('Error al enviar formulario:', err)
      setErrorMessage(err.message || t('maintenance.error_save_record'))
    } finally {
      setSubmitting(false)
    }
  }

  const resetForm = () => {
    try {
      sessionStorage.removeItem(DRAFT_STORAGE_KEY)
    } catch {
      // Ignore
    }
    setSuccessData(null)
    setRedirectCancelled(true)
    setRedirectCountdown(null)
    setCurrentStep(1)
    setSlideDirection(1)
    setCategory('hood_cleaning')
    setServiceType('corrective')
    setAreaEquipment('')
    setWorkDescription('')
    setPartsReplaced('')
    setStatus('completed')
    setStartTime(getCurrentTimeHHMM())
    setEndTime('')
    setWarrantyDays(0)
    setIsAfterHours(false)
    setPhotosBefore([])
    setPhotosAfter([])
    setPhotosInvoice([])
    setInvoiceNumber('')
    setCostEstimate('')
    setManagerName('')
    setSignatureDataUrl(null)
    setErrorMessage(null)
  }

  // Sugerencias dinámicas en Paso 2 basadas en los proveedores y técnicos reales que ya han trabajado en las tiendas
  const internalCompanyLabel = t('maintenance.vendor_chip_internal')
  const companySuggestions: DirectoryCompany[] = [
    ...directoryCompanies,
    ...(directoryCompanies.some(
      c => c.company_name.toLowerCase() === internalCompanyLabel.toLowerCase()
    )
      ? []
      : [
          {
            company_name: internalCompanyLabel,
            last_technician_name: '',
            last_technician_phone: '',
            last_category: 'general',
            visit_count: 0
          }
        ])
  ]

  // Filtrar técnicos: si ya hay una empresa seleccionada que tiene técnicos registrados, priorizarlos primero
  const normalizedSelectedComp = companyName.trim().toLowerCase()
  const technicianSuggestions: DirectoryTechnician[] = normalizedSelectedComp
    ? [
        ...directoryTechnicians.filter(
          tech => tech.company_name.toLowerCase() === normalizedSelectedComp
        ),
        ...directoryTechnicians.filter(
          tech => tech.company_name.toLowerCase() !== normalizedSelectedComp
        )
      ].slice(0, 12)
    : directoryTechnicians.slice(0, 12)

  // Sugerencias rápidas 100% libres de marcas comerciales para Paso 4 (Equipo o Área Atendida — Multi-Select)
  const equipmentSuggestions = [
    t('maintenance.equip_chip_hood'),
    t('maintenance.equip_chip_walkin'),
    t('maintenance.equip_chip_freezer'),
    t('maintenance.equip_chip_grill'),
    t('maintenance.equip_chip_fryer'),
    t('maintenance.equip_chip_ice'),
    t('maintenance.equip_chip_grease'),
    t('maintenance.equip_chip_drains'),
    t('maintenance.equip_chip_boiler'),
    t('maintenance.equip_chip_steam'),
    t('maintenance.equip_chip_ac'),
    t('maintenance.equip_chip_pos')
  ]

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
          {/* Emblema Oficial Tacos Gavilan + Sello "¡Ya está!" */}
          <div className="flex flex-col items-center justify-center mb-4">
            <div className="relative">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#fdc82f] to-[#e69b00] p-1 shadow-[0_0_30px_rgba(253,200,47,0.35)]">
                <div className="w-full h-full rounded-full bg-white flex items-center justify-center overflow-hidden border-2 border-[#fffbeb]">
                  <img src="/logo.png" alt="Tacos Gavilan" className="w-[86%] h-[86%] object-contain" />
                </div>
              </div>
              <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-emerald-500 text-white flex items-center justify-center ring-2 ring-slate-900 shadow-md">
                <CheckCircle2 size={16} />
              </div>
            </div>
            <img
              src="/ya esta.png"
              alt="¡Ya está!"
              className="h-9 w-auto object-contain mt-2 drop-shadow-[0_0_10px_rgba(253,200,47,0.45)]"
            />
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
            {!successData.manager_signature_url && (
              <div className="mt-2 pt-2 border-t border-amber-500/30 text-[11px] text-amber-300 font-semibold leading-relaxed">
                {t('maintenance.after_hours_success_cctv_notice')}
              </div>
            )}
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
                {t('maintenance.splash_tagline')}
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
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#fdc82f] to-[#e69b00] p-0.5 shadow-md shadow-amber-500/20 shrink-0">
                <div className="w-full h-full rounded-full bg-white flex items-center justify-center overflow-hidden border border-[#fffbeb]">
                  <img src="/logo.png" alt="Tacos Gavilan" className="w-[88%] h-[88%] object-contain" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div>
                  <h1 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight leading-tight">
                    Tacos Gavilan
                  </h1>
                  <p className="text-[10px] text-slate-500 font-semibold leading-tight">
                    {t('maintenance.slide_step_of')?.replace('{current}', String(currentStep)).replace('{total}', String(TOTAL_SLIDES))}
                  </p>
                </div>
                <img
                  src="/ya esta.png"
                  alt="¡Ya está!"
                  className="h-7 w-auto object-contain shrink-0 drop-shadow-xs"
                />
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
              {/* DIAPOSITIVA 1: SUCURSAL + BIENVENIDA Y PROPÓSITO DEL REGISTRO */}
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
                  {/* Tarjeta de Bienvenida y Explicación del Porqué del Registro en Cada Visita */}
                  <div className="p-4 rounded-2xl bg-gradient-to-br from-amber-50/90 via-orange-50/50 to-red-50/60 dark:from-amber-950/30 dark:via-slate-900 dark:to-red-950/20 border border-amber-200/80 dark:border-amber-800/50 space-y-3">
                    <div>
                      <h3 className="text-xs sm:text-sm font-black text-slate-900 dark:text-white tracking-tight">
                        {technicianName.trim()
                          ? t('maintenance.welcome_title_named').replace('{name}', technicianName.trim())
                          : t('maintenance.welcome_title')}
                      </h3>
                      <p className="text-[11px] text-slate-600 dark:text-slate-300 font-medium leading-snug mt-0.5">
                        {t('maintenance.welcome_subtitle')}
                      </p>
                    </div>

                    <div className="space-y-2 pt-1 border-t border-amber-200/60 dark:border-amber-800/40 text-[11px] leading-snug">
                      <div className="flex items-start gap-2">
                        <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                        <p className="text-slate-700 dark:text-slate-300">
                          <span className="font-bold text-slate-900 dark:text-white">
                            {t('maintenance.welcome_reason_1_title')}{' '}
                          </span>
                          {t('maintenance.welcome_reason_1_desc')}
                        </p>
                      </div>
                      <div className="flex items-start gap-2">
                        <Wrench size={14} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                        <p className="text-slate-700 dark:text-slate-300">
                          <span className="font-bold text-slate-900 dark:text-white">
                            {t('maintenance.welcome_reason_2_title')}{' '}
                          </span>
                          {t('maintenance.welcome_reason_2_desc')}
                        </p>
                      </div>
                      <div className="flex items-start gap-2">
                        <Sparkles size={14} className="text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                        <p className="text-slate-700 dark:text-slate-300">
                          <span className="font-bold text-slate-900 dark:text-white">
                            {t('maintenance.welcome_reason_3_title')}{' '}
                          </span>
                          {t('maintenance.welcome_reason_3_desc')}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-red-100 dark:bg-red-950/60 text-red-600 flex items-center justify-center shrink-0">
                        <Building2 size={20} />
                      </div>
                      <div>
                        <h2 className="text-base sm:text-lg font-black uppercase tracking-tight text-slate-900 dark:text-white">
                          1. {t('maintenance.select_store')}
                        </h2>
                        <p className="text-xs text-slate-500 font-medium">
                          {t('maintenance.store_question')}
                        </p>
                      </div>
                    </div>

                    {/* Botón de detección por GPS en tiempo real */}
                    <button
                      type="button"
                      onClick={() => detectNearestStoreByGPS(stores, true)}
                      disabled={locatingGps || loadingStores}
                      className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-red-50 hover:bg-red-100 dark:bg-red-950/50 dark:hover:bg-red-900/50 border border-red-200 dark:border-red-800/70 text-red-700 dark:text-red-300 text-xs font-extrabold transition-all active:scale-95 disabled:opacity-60"
                    >
                      {locatingGps ? (
                        <>
                          <Loader2 size={14} className="animate-spin text-red-600" />
                          <span>{t('maintenance.gps_detecting')}</span>
                        </>
                      ) : (
                        <>
                          <MapPin size={14} className="text-red-600 dark:text-red-400" />
                          <span>{t('maintenance.gps_detect_btn')}</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Tarjeta de Confirmación de Tienda */}
                  {selectedStore && (
                    <div className="p-4 rounded-2xl bg-red-50/80 dark:bg-red-950/40 border-2 border-red-500/40 space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                          <span className="text-xs sm:text-sm font-black uppercase tracking-wide text-red-700 dark:text-red-300">
                            Tacos Gavilan • {formatStoreName(selectedStore.name)}
                          </span>
                        </div>
                        {gpsDetectedDistance !== null && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/80 border border-emerald-300 dark:border-emerald-700 text-[10px] font-black text-emerald-800 dark:text-emerald-300">
                            <MapPin size={10} />
                            {t('maintenance.gps_detected_badge', { distance: gpsDetectedDistance })}
                          </span>
                        )}
                      </div>
                      {selectedStore.address && (
                        <p className="text-xs text-slate-600 dark:text-slate-300 font-semibold pl-4.5 flex items-center gap-1.5">
                          <MapPin size={13} className="text-red-500 shrink-0" />
                          <span>{selectedStore.address}{selectedStore.city ? `, ${selectedStore.city}` : ''}</span>
                        </p>
                      )}
                    </div>
                  )}

                  {/* Aviso amigable si el GPS no estuvo disponible -> Fallback manual */}
                  {gpsFallbackNotice && !selectedStore && (
                    <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 flex items-center gap-2 text-xs font-semibold text-amber-800 dark:text-amber-200">
                      <AlertTriangle size={15} className="text-amber-600 shrink-0" />
                      <span>{t('maintenance.gps_fallback_notice')}</span>
                    </div>
                  )}

                  {/* Selector Manual Dropdown con Nombres Limpios y Distancia GPS */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
                      {t('maintenance.change_store')}
                    </label>
                    <select
                      value={selectedStoreId}
                      onChange={(e) => {
                        setSelectedStoreId(e.target.value);
                        setGpsFallbackNotice(false);
                        const found = stores.find(s => String(s.id) === e.target.value);
                        if (found && typeof found.distanceMiles === 'number') {
                          setGpsDetectedDistance(Number(found.distanceMiles.toFixed(1)));
                        } else {
                          setGpsDetectedDistance(null);
                        }
                      }}
                      disabled={loadingStores}
                      className="w-full px-4 py-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-medium text-base sm:text-sm focus:ring-2 focus:ring-red-500 focus:outline-none transition-shadow"
                    >
                      <option value="">{t('maintenance.select_store_placeholder')}</option>
                      {stores.map(s => (
                        <option key={s.id} value={s.id}>
                          {formatStoreName(s.name)}
                          {typeof s.distanceMiles === 'number' ? ` (${s.distanceMiles.toFixed(1)} mi)` : ''}
                          {s.address ? ` — ${s.address}` : ''}
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

                  {/* Saludo personalizado de bienvenida al técnico en Paso 2 */}
                  {technicianName.trim() && (
                    <div className="p-3 rounded-2xl bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-800/50 flex items-center gap-2.5 text-xs text-emerald-800 dark:text-emerald-200 font-medium">
                      <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <span>
                        {t('maintenance.step2_welcome_banner').replace('{name}', technicianName.trim())}
                      </span>
                    </div>
                  )}

                  {/* Nombre de la Empresa + Sugerencias Dinámicas de Proveedores Reales */}
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
                    <div className="mt-2.5">
                      <span className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1.5">
                        {t('maintenance.quick_vendors')}
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {companySuggestions.map((chip) => {
                          const isSelected =
                            companyName.trim().toLowerCase() === chip.company_name.toLowerCase()
                          return (
                            <button
                              key={chip.company_name}
                              type="button"
                              onClick={() => {
                                setCompanyName(chip.company_name)
                                if (chip.last_category) setCategory(chip.last_category)
                                if (chip.last_technician_name) {
                                  setTechnicianName(chip.last_technician_name)
                                }
                                if (chip.last_technician_phone) {
                                  setTechnicianPhone(chip.last_technician_phone)
                                }
                              }}
                              className={`px-2.5 py-1.5 rounded-xl text-[11px] font-semibold border transition-all active:scale-95 flex items-center gap-1.5 ${
                                isSelected
                                  ? 'bg-red-600 text-white border-red-600 shadow-xs'
                                  : 'bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-red-400'
                              }`}
                            >
                              <span>{chip.company_name}</span>
                              {chip.last_technician_name && (
                                <span
                                  className={`text-[10px] font-normal ${
                                    isSelected ? 'text-red-100' : 'text-slate-400 dark:text-slate-500'
                                  }`}
                                >
                                  • {chip.last_technician_name}
                                </span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                      {directoryCompanies.length === 0 && (
                        <p className="mt-1.5 text-[10px] text-slate-400 dark:text-slate-500 font-medium">
                          {t('maintenance.quick_vendors_hint')}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Nombre del Técnico + Sugerencias Dinámicas de Técnicos Registrados */}
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
                    {technicianSuggestions.length > 0 && (
                      <div className="mt-2.5">
                        <span className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1.5">
                          {t('maintenance.quick_technicians')}
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {technicianSuggestions.map((tech) => {
                            const isTechSelected =
                              technicianName.trim().toLowerCase() === tech.technician_name.toLowerCase() &&
                              (!tech.company_name ||
                                companyName.trim().toLowerCase() === tech.company_name.toLowerCase())
                            return (
                              <button
                                key={`${tech.technician_name}_${tech.company_name}`}
                                type="button"
                                onClick={() => {
                                  setTechnicianName(tech.technician_name)
                                  if (tech.company_name) setCompanyName(tech.company_name)
                                  if (tech.technician_phone) setTechnicianPhone(tech.technician_phone)
                                  if (tech.category) setCategory(tech.category)
                                }}
                                className={`px-2.5 py-1.5 rounded-xl text-[11px] font-semibold border transition-all active:scale-95 flex items-center gap-1.5 ${
                                  isTechSelected
                                    ? 'bg-red-600 text-white border-red-600 shadow-xs'
                                    : 'bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-red-400'
                                }`}
                              >
                                <User size={11} className="shrink-0" />
                                <span>{tech.technician_name}</span>
                                {tech.company_name &&
                                  tech.company_name.toLowerCase() !== companyName.trim().toLowerCase() && (
                                    <span
                                      className={`text-[10px] font-normal ${
                                        isTechSelected ? 'text-red-100' : 'text-slate-400 dark:text-slate-500'
                                      }`}
                                    >
                                      ({tech.company_name})
                                    </span>
                                  )}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}
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
                      placeholder={t('maintenance.technician_phone_placeholder')}
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
                        { id: 'warranty', label: t('maintenance.type_warranty') },
                        { id: 'installation', label: t('maintenance.type_installation') },
                        { id: 'inspection', label: t('maintenance.type_inspection') }
                      ].map((type) => (
                        <button
                          key={type.id}
                          type="button"
                          onClick={() => {
                            setServiceType(type.id)
                            if (type.id === 'warranty') {
                              setCostEstimate('0')
                            }
                          }}
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

                  {/* Equipo o Área + Sugerencias Rápidas Multi-Selección Libres de Marcas */}
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
                    <div className="mt-2.5">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                          {t('maintenance.quick_equipment')}
                        </span>
                        <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500">
                          {t('maintenance.multi_equip_hint')}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {equipmentSuggestions.map((equipLabel) => {
                          const currentParts = areaEquipment
                            .split(',')
                            .map(s => s.trim().toLowerCase())
                            .filter(Boolean)
                          const isSelected = currentParts.includes(equipLabel.toLowerCase())
                          return (
                            <button
                              key={equipLabel}
                              type="button"
                              onClick={() => toggleEquipmentChip(equipLabel)}
                              className={`px-2.5 py-1.5 rounded-xl text-[11px] font-semibold border transition-all active:scale-95 ${
                                isSelected
                                  ? 'bg-red-600 text-white border-red-600 shadow-xs'
                                  : 'bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-red-400'
                              }`}
                            >
                              {isSelected ? `✓ ${equipLabel}` : equipLabel}
                            </button>
                          )
                        })}
                      </div>
                    </div>
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
                              <img src={url} alt={t('maintenance.evidence_before')} className="w-full h-full object-cover" />
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
                              <span className="text-[10px] font-bold uppercase">{uploadingSection === 'before' ? '...' : t('maintenance.add_another_photo')}</span>
                              <input
                                type="file"
                                accept="image/*"
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
                              <img src={url} alt={t('maintenance.evidence_after')} className="w-full h-full object-cover" />
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
                              <span className="text-[10px] font-bold uppercase">{uploadingSection === 'after' ? '...' : t('maintenance.add_another_photo')}</span>
                              <input
                                type="file"
                                accept="image/*"
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
                          {photosInvoice.map((url, idx) => {
                            const isPdf = url.toLowerCase().endsWith('.pdf') || url.toLowerCase().includes('.pdf?')
                            return (
                              <div key={idx} className="relative group aspect-square rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 shadow-xs">
                                {isPdf ? (
                                  <div className="w-full h-full flex flex-col items-center justify-center p-2 text-center bg-red-50/60 dark:bg-red-950/30">
                                    <FileText size={26} className="text-red-600 mb-1" />
                                    <span className="text-[10px] font-bold text-slate-700 dark:text-slate-200 leading-tight">
                                      {t('maintenance.pdf_document')}
                                    </span>
                                  </div>
                                ) : (
                                  <img src={url} alt={t('maintenance.evidence_invoice')} className="w-full h-full object-cover" />
                                )}
                                <button
                                  type="button"
                                  onClick={() => removePhoto(url, 'invoice')}
                                  className="absolute top-1 right-1 p-1 rounded-full bg-black/70 text-white hover:bg-red-600 transition-colors shadow-sm"
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            )
                          })}
                          {photosInvoice.length < 5 && (
                            <label className="cursor-pointer aspect-square rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 bg-slate-50/60 dark:bg-slate-800/40 flex flex-col items-center justify-center gap-1 text-slate-500 hover:text-blue-600 transition-colors group">
                              <Plus size={20} className="group-hover:scale-110 transition-transform" />
                              <span className="text-[10px] font-bold uppercase">{uploadingSection === 'invoice' ? '...' : t('maintenance.add_another_photo')}</span>
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
              {/* DIAPOSITIVA 6: FACTURACIÓN, HORARIO Y GARANTÍA (OPCIONAL) */}
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

                  {/* Hora de Llegada y Salida (Check-In / Check-Out) */}
                  <div className="grid grid-cols-2 gap-3 p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/70">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1 flex items-center gap-1">
                        <Clock size={12} className="text-red-500" />
                        <span>{t('maintenance.start_time_label')}</span>
                      </label>
                      <input
                        type="time"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-bold text-sm focus:ring-2 focus:ring-red-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1 flex items-center gap-1">
                        <Clock size={12} className="text-emerald-500" />
                        <span>{t('maintenance.end_time_label')}</span>
                      </label>
                      <input
                        type="time"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-bold text-sm focus:ring-2 focus:ring-red-500 focus:outline-none"
                      />
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

                  {/* Garantía Otorgada */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      {t('maintenance.warranty_period_label')}
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        { days: 0, label: t('maintenance.warranty_none') },
                        { days: 30, label: t('maintenance.warranty_30') },
                        { days: 60, label: t('maintenance.warranty_60') },
                        { days: 90, label: t('maintenance.warranty_90') }
                      ].map(opt => (
                        <button
                          key={opt.days}
                          type="button"
                          onClick={() => setWarrantyDays(opt.days)}
                          className={`px-2.5 py-2 rounded-xl text-[11px] font-bold border transition-all ${
                            warrantyDays === opt.days
                              ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                              : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-emerald-400'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-2xl text-xs text-slate-500 text-center font-medium">
                    {t('maintenance.skip_step_notice')}
                  </div>
                </motion.div>
              )}

              {/* ========================================================================= */}
              {/* DIAPOSITIVA 7: VALIDACIÓN Y FIRMA DEL ENCARGADO (O SERVICIO NOCTURNO) */}
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

                  {/* Opción de Servicio Nocturno / Madrugada (Sin Encargado en Tienda) */}
                  <div className={`p-3.5 rounded-2xl border transition-all ${
                    isAfterHours
                      ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-400 dark:border-amber-700'
                      : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700/70'
                  }`}>
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isAfterHours}
                        onChange={(e) => setIsAfterHours(e.target.checked)}
                        className="mt-0.5 w-4 h-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                      />
                      <div className="flex-1">
                        <span className="block text-xs font-bold text-slate-800 dark:text-slate-100">
                          🌙 {t('maintenance.after_hours_toggle')}
                        </span>
                        {isAfterHours && (
                          <div className="mt-2.5 space-y-2.5">
                            <p className="text-[11px] text-amber-900 dark:text-amber-200 leading-relaxed font-medium">
                              {t('maintenance.after_hours_desc')}
                            </p>

                            {/* Tarjeta de Protocolo de Verificación por Cámaras de Seguridad (CCTV) */}
                            <div className="p-3 rounded-xl bg-white/90 dark:bg-slate-900/80 border border-amber-300 dark:border-amber-700/80 space-y-1.5 shadow-2xs">
                              <div className="flex items-center gap-1.5 text-amber-900 dark:text-amber-200 font-black text-[11px] uppercase tracking-wide">
                                <Camera size={13} className="text-red-600 dark:text-red-400 shrink-0" />
                                <span>{t('maintenance.after_hours_cctv_title')}</span>
                              </div>
                              <p className="text-[11px] text-slate-700 dark:text-slate-300 font-medium leading-snug">
                                {t('maintenance.after_hours_cctv_desc')}
                              </p>
                              <ul className="space-y-1 pt-0.5 text-[11px] text-slate-800 dark:text-slate-200 font-semibold">
                                <li className="flex items-start gap-1.5">
                                  <CheckCircle2 size={12} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                                  <span>{t('maintenance.after_hours_cctv_point_1')}</span>
                                </li>
                                <li className="flex items-start gap-1.5">
                                  <CheckCircle2 size={12} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                                  <span>{t('maintenance.after_hours_cctv_point_2')}</span>
                                </li>
                                <li className="flex items-start gap-1.5">
                                  <CheckCircle2 size={12} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                                  <span>{t('maintenance.after_hours_cctv_point_3')}</span>
                                </li>
                              </ul>
                            </div>
                          </div>
                        )}
                      </div>
                    </label>
                  </div>

                  {/* Selector de Encargados del Turno (Módulo PLANIFICADOR + Módulo HORARIOS del día en curso) */}
                  {!isAfterHours && (
                    <div className="p-3.5 rounded-2xl bg-slate-50/90 dark:bg-slate-800/50 border border-slate-200/90 dark:border-slate-700/80 space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="block text-xs font-black text-slate-800 dark:text-slate-100 uppercase tracking-wide">
                            👥 {t('maintenance.select_shift_leader_title')}
                          </span>
                          <p className="text-[11px] text-slate-600 dark:text-slate-400 font-medium mt-0.5 leading-snug">
                            {t('maintenance.select_shift_leader_desc')}
                          </p>
                        </div>
                      </div>

                      {loadingShiftLeaders ? (
                        <div className="flex items-center gap-2 py-3 px-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400 font-semibold">
                          <Loader2 size={15} className="animate-spin text-red-600 shrink-0" />
                          <span>{t('maintenance.loading_shift_leaders')}</span>
                        </div>
                      ) : shiftLeaders.length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-0.5">
                          {shiftLeaders.map((leader) => {
                            const roleLabel =
                              leader.role === 'supervisor'
                                ? t('maintenance.role_supervisor')
                                : leader.role === 'manager'
                                  ? t('maintenance.role_manager')
                                  : leader.role === 'assistant_manager'
                                    ? t('maintenance.role_assistant_manager')
                                    : t('maintenance.role_shift_leader')

                            const formattedOptionValue = `${leader.name} (${roleLabel})`
                            const isSelected =
                              managerName.trim().toLowerCase() === formattedOptionValue.toLowerCase() ||
                              managerName.trim().toLowerCase() === leader.name.trim().toLowerCase()

                            const roleBadgeClass =
                              leader.role === 'supervisor'
                                ? 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-950/70 dark:text-purple-200 dark:border-purple-800/70'
                                : leader.role === 'manager'
                                  ? 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/70 dark:text-blue-200 dark:border-blue-800/70'
                                  : leader.role === 'assistant_manager'
                                    ? 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/70 dark:text-emerald-200 dark:border-emerald-800/70'
                                    : 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/70 dark:text-amber-200 dark:border-amber-800/70'

                            const shiftBlockLabel =
                              leader.shift_block === 'AM'
                                ? t('maintenance.shift_am_badge')
                                : leader.shift_block === 'PM'
                                  ? t('maintenance.shift_pm_badge')
                                  : leader.shift_block === 'FULL'
                                    ? t('maintenance.shift_full_badge')
                                    : null

                            return (
                              <button
                                key={leader.id}
                                type="button"
                                onClick={() => {
                                  setManagerName(formattedOptionValue)
                                  setErrorMessage(null)
                                }}
                                className={`text-left p-2.5 rounded-xl border transition-all flex items-start justify-between gap-2 ${
                                  isSelected
                                    ? 'bg-emerald-50/90 dark:bg-emerald-950/50 border-emerald-500 dark:border-emerald-500 ring-2 ring-emerald-500/20 shadow-xs'
                                    : 'bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-700/80 hover:border-red-300 dark:hover:border-red-700'
                                }`}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-xs font-black text-slate-900 dark:text-white truncate">
                                      {leader.name}
                                    </span>
                                    <span className={`px-1.5 py-0.5 rounded-md text-[9.5px] font-extrabold border ${roleBadgeClass}`}>
                                      {roleLabel}
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-1.5 flex-wrap mt-1">
                                    {leader.start_time && leader.end_time ? (
                                      <span className="text-[10.5px] font-semibold text-slate-600 dark:text-slate-300 font-mono">
                                        🕒 {leader.start_time} – {leader.end_time}
                                      </span>
                                    ) : null}
                                    {shiftBlockLabel && (
                                      <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                                        • {shiftBlockLabel}
                                      </span>
                                    )}
                                    {leader.is_on_shift_now ? (
                                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 text-[9.5px] font-extrabold">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                        {t('maintenance.on_shift_now_badge')}
                                      </span>
                                    ) : leader.scheduled_today ? (
                                      <span className="px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[9.5px] font-bold">
                                        📅 {t('maintenance.scheduled_today_badge')}
                                      </span>
                                    ) : (
                                      <span className="px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[9.5px] font-semibold">
                                        {t('maintenance.store_roster_badge')}
                                      </span>
                                    )}
                                  </div>
                                </div>

                                <div className="shrink-0 mt-0.5">
                                  {isSelected ? (
                                    <CheckCircle2 size={17} className="text-emerald-600 dark:text-emerald-400" />
                                  ) : (
                                    <div className="w-4 h-4 rounded-full border-2 border-slate-300 dark:border-slate-600" />
                                  )}
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      ) : null}
                    </div>
                  )}

                  {/* Nombre del Encargado o Testigo Nocturno */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      {isAfterHours
                        ? t('maintenance.after_hours_witness_label')
                        : shiftLeaders.length > 0
                          ? `${t('maintenance.manual_manager_hint')} *`
                          : `${t('maintenance.manager_name')} *`}
                    </label>
                    <input
                      type="text"
                      value={managerName}
                      onChange={(e) => setManagerName(e.target.value)}
                      placeholder={
                        isAfterHours
                          ? t('maintenance.after_hours_witness_placeholder')
                          : t('maintenance.manager_placeholder')
                      }
                      className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-medium text-base sm:text-sm focus:ring-2 focus:ring-red-500 focus:outline-none"
                    />
                  </div>

                  {/* Pad de Firma Digital Táctil con Rehidratación (Solo obligatorio si hay encargado presente) */}
                  {!isAfterHours && (
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
                  )}
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
              <span>{t('maintenance.btn_start')}</span>
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
