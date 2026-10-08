/**
 * @module app/mantenimiento/registro/page
 * @description Portal público móvil y responsivo para el registro de actividades, reparaciones y visitas
 * de técnicos, lavadores y proveedores de servicio en las sucursales de Tacos Gavilan.
 * @businessRules
 * - Acceso abierto sin inicio de sesión (ruta pública en middleware.ts).
 * - Si se ingresa mediante código QR con parámetro ?store={id}, la sucursal se pre-selecciona automáticamente.
 * - Evidencias fotográficas obligatorias o recomendadas (Antes, Después y Nota/Factura física).
 * - Firma digital táctil del encargado en turno requerida para validar la entrega del servicio.
 * - Soporta idioma dual (Español / Inglés) con selector instantáneo.
 * @dataFlow
 * - Selección de tienda y captura de datos -> Subida de imágenes a /api/mantenimiento/upload ->
 *   POST a /api/mantenimiento -> Notificación interna a supervisores y almacenamiento en maintenance_service_logs.
 * @notes
 * - Diseñado 'mobile-first' con soporte de cámara directa (capture="environment") para celulares de técnicos.
 */

'use client'

import React, { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Wrench, Camera, CheckCircle2, AlertTriangle, ShieldCheck,
  Building2, User, Phone, FileText, DollarSign, UploadCloud,
  X, Sparkles, RefreshCw, Flame, Snowflake, Bug, Droplets,
  Zap, Lock, Cpu, ArrowRight, ChevronRight, Globe
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { getSupabaseClient, formatStoreName } from '@/lib/supabase'
import SignaturePad from '@/components/maintenance/SignaturePad'

interface Store {
  id: string
  name: string
  code?: string
  city?: string
}

const COMMON_VENDORS = [
  'Air Quality Hoods',
  'Ecolab Pest Control',
  'ThermoKing Refrigeration',
  'Tri-County Grease Trap',
  'Hobart Cooking Equipment',
  'Toast POS / Tech Services'
]

function MaintenanceFormContent() {
  const { t, language, setLanguage } = useLanguage()
  const isEs = language === 'es'
  const searchParams = useSearchParams()
  const storeParam = searchParams.get('store') || searchParams.get('store_id') || ''

  const [stores, setStores] = useState<Store[]>([])
  const [loadingStores, setLoadingStores] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [successData, setSuccessData] = useState<any | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

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

  // Cargar lista de tiendas
  useEffect(() => {
    async function loadStores() {
      try {
        const supabase = await getSupabaseClient()
        const { data, error } = await supabase
          .from('stores')
          .select('id, name, code, city, is_active')
          .order('name')

        if (!error && data) {
          const activeStores = data.filter((s: any) => s.is_active !== false)
          setStores(activeStores)

          // Si vino un código en vez de UUID, emparejarlo
          if (storeParam) {
            const matched = activeStores.find((s: any) =>
              s.id === storeParam ||
              s.code === storeParam ||
              s.code === String(storeParam).padStart(2, '0')
            )
            if (matched) setSelectedStoreId(matched.id)
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

  // Subida de foto vía API endpoint
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>, section: 'before' | 'after' | 'invoice') => {
    const files = e.target.files
    if (!files || files.length === 0) return

    setUploadingSection(section)
    setErrorMessage(null)

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
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
          throw new Error(result.error || 'Fallo al subir foto')
        }
      }
    } catch (err: any) {
      console.error('Error al subir imagen:', err)
      setErrorMessage(isEs ? 'Error al subir la imagen. Intenta de nuevo.' : 'Failed to upload photo. Please try again.')
    } finally {
      setUploadingSection(null)
      // Reset input
      e.target.value = ''
    }
  }

  const removePhoto = (urlToRemove: string, section: 'before' | 'after' | 'invoice') => {
    if (section === 'before') setPhotosBefore(prev => prev.filter(u => u !== urlToRemove))
    if (section === 'after') setPhotosAfter(prev => prev.filter(u => u !== urlToRemove))
    if (section === 'invoice') setPhotosInvoice(prev => prev.filter(u => u !== urlToRemove))
  }

  // Envío del Formulario
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)

    if (!selectedStoreId) {
      setErrorMessage(isEs ? 'Por favor selecciona la sucursal donde realizaste el servicio.' : 'Please select the store where service was performed.')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    if (!companyName.trim()) {
      setErrorMessage(isEs ? 'Ingresa el nombre de la empresa proveedora.' : 'Please enter the vendor company name.')
      return
    }

    if (!technicianName.trim()) {
      setErrorMessage(isEs ? 'Ingresa tu nombre de técnico.' : 'Please enter the technician full name.')
      return
    }

    if (!areaEquipment.trim()) {
      setErrorMessage(isEs ? 'Especifica qué equipo o área atendiste (ej. Campana 1, Walk-in Cooler, Parrilla).' : 'Please specify the equipment or area serviced.')
      return
    }

    if (!workDescription.trim()) {
      setErrorMessage(isEs ? 'Describe brevemente el trabajo realizado.' : 'Please describe the work performed.')
      return
    }

    if (!managerName.trim()) {
      setErrorMessage(isEs ? 'Ingresa el nombre del encargado de tienda que te recibió.' : 'Please enter the name of the store manager who received you.')
      return
    }

    setSubmitting(true)

    try {
      // 1. Si hay firma digital en base64, subirla primero
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
          }
        } catch (sigErr) {
          console.warn('Error guardando firma táctil:', sigErr)
        }
      }

      // 2. Guardar registro en /api/mantenimiento
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
        cost_estimate: costEstimate ? parseFloat(costEstimate) : null,
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
        throw new Error(result.error || 'Error al guardar registro')
      }

      setSuccessData(result.data)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err: any) {
      console.error('Error al enviar formulario:', err)
      setErrorMessage(err.message || (isEs ? 'Error al enviar el registro. Revisa tu conexión.' : 'Error submitting record. Please check your connection.'))
    } finally {
      setSubmitting(false)
    }
  }

  const resetForm = () => {
    setSuccessData(null)
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

  // Lista de categorías con iconos
  const categoriesList = [
    { id: 'hood_cleaning', label: t('maintenance.category_hood'), icon: Flame, color: 'text-amber-600 bg-amber-50 dark:bg-amber-950/40 border-amber-200' },
    { id: 'refrigeration', label: t('maintenance.category_refrigeration'), icon: Snowflake, color: 'text-blue-600 bg-blue-50 dark:bg-blue-950/40 border-blue-200' },
    { id: 'grease_trap', label: t('maintenance.category_grease_trap'), icon: Droplets, color: 'text-teal-600 bg-teal-50 dark:bg-teal-950/40 border-teal-200' },
    { id: 'pest_control', label: t('maintenance.category_pest_control'), icon: Bug, color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200' },
    { id: 'cooking_equipment', label: t('maintenance.category_cooking'), icon: Wrench, color: 'text-red-600 bg-red-50 dark:bg-red-950/40 border-red-200' },
    { id: 'electrical', label: t('maintenance.category_electrical'), icon: Zap, color: 'text-yellow-600 bg-yellow-50 dark:bg-yellow-950/40 border-yellow-200' },
    { id: 'power_washing', label: t('maintenance.category_power_washing'), icon: Sparkles, color: 'text-cyan-600 bg-cyan-50 dark:bg-cyan-950/40 border-cyan-200' },
    { id: 'security_locks', label: t('maintenance.category_security'), icon: Lock, color: 'text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200' },
    { id: 'it_pos', label: t('maintenance.category_it'), icon: Cpu, color: 'text-purple-600 bg-purple-50 dark:bg-purple-950/40 border-purple-200' },
    { id: 'general', label: t('maintenance.category_general'), icon: RefreshCw, color: 'text-slate-600 bg-slate-50 dark:bg-slate-950/40 border-slate-200' }
  ]

  // Pantalla de Éxito
  if (successData) {
    const storeObj = stores.find(s => s.id === successData.store_id)
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 py-10 px-4 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="max-w-lg w-full bg-white dark:bg-slate-900 rounded-3xl shadow-xl border border-slate-200 dark:border-slate-800 p-8 text-center"
        >
          <div className="w-20 h-20 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-6 shadow-inner">
            <CheckCircle2 size={46} />
          </div>

          <h2 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight mb-2">
            {t('maintenance.success_title')}
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
            {t('maintenance.success_message')}
          </p>

          <div className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl p-4 text-left space-y-2 mb-6 border border-slate-200 dark:border-slate-700 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">{t('maintenance.store')}:</span>
              <span className="font-bold text-slate-900 dark:text-white">
                {storeObj ? formatStoreName(storeObj.name) : 'Tacos Gavilan'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">{t('maintenance.vendor')}:</span>
              <span className="font-bold text-slate-900 dark:text-white">{successData.company_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">{t('maintenance.technician')}:</span>
              <span className="font-bold text-slate-900 dark:text-white">{successData.technician_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">{t('maintenance.equipment')}:</span>
              <span className="font-bold text-slate-900 dark:text-white">{successData.area_equipment}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">{t('maintenance.manager_name')}:</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">{successData.manager_name}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={resetForm}
            className="w-full py-3.5 px-6 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm shadow-lg shadow-red-600/30 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            {t('maintenance.another_service')}
          </button>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 py-6 px-3 sm:px-6">
      <div className="max-w-2xl mx-auto">
        {/* Top Header */}
        <header className="flex items-center justify-between pb-6 mb-6 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-red-600 text-white flex items-center justify-center font-black text-xl shadow-md shadow-red-600/30">
              TG
            </div>
            <div>
              <span className="text-xs font-black tracking-widest text-red-600 dark:text-red-400 uppercase">
                Tacos Gavilan
              </span>
              <h1 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white leading-tight">
                {t('maintenance.public_kiosk_title')}
              </h1>
            </div>
          </div>

          {/* Selector de idioma */}
          <button
            type="button"
            onClick={() => setLanguage(language === 'es' ? 'en' : 'es')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 shadow-sm hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            <Globe size={14} className="text-red-600" />
            <span>{language.toUpperCase()}</span>
          </button>
        </header>

        {/* Error Alert */}
        {errorMessage && (
          <div className="mb-6 p-4 rounded-2xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs font-semibold flex items-center gap-2">
            <AlertTriangle size={18} className="shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* SECCIÓN 1: SUCURSAL */}
          <section className="bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-6 shadow-sm border border-slate-200/80 dark:border-slate-800">
            <div className="flex items-center gap-2 mb-3">
              <Building2 className="text-red-600" size={18} />
              <label className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                1. {t('maintenance.select_store')} *
              </label>
            </div>

            <select
              value={selectedStoreId}
              onChange={(e) => setSelectedStoreId(e.target.value)}
              disabled={loadingStores}
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-medium text-sm focus:ring-2 focus:ring-red-500 focus:outline-none"
            >
              <option value="">-- {t('maintenance.store_placeholder')} --</option>
              {stores.map(s => (
                <option key={s.id} value={s.id}>
                  {formatStoreName(s.name)} {s.code ? `(#${s.code})` : ''} {s.city ? `— ${s.city}` : ''}
                </option>
              ))}
            </select>
          </section>

          {/* SECCIÓN 2: DATOS DEL PROVEEDOR */}
          <section className="bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-6 shadow-sm border border-slate-200/80 dark:border-slate-800 space-y-4">
            <div className="flex items-center gap-2">
              <User className="text-red-600" size={18} />
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                2. {t('maintenance.vendor_info')} *
              </h3>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                {t('maintenance.company_name')} *
              </label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder={t('maintenance.company_placeholder')}
                className="w-full px-4 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-medium text-sm focus:ring-2 focus:ring-red-500 focus:outline-none"
              />

              {/* Quick suggestions chips */}
              <div className="flex flex-wrap gap-1.5 mt-2">
                {COMMON_VENDORS.map(v => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setCompanyName(v)}
                    className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-slate-100 dark:bg-slate-800 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/60 dark:hover:text-red-300 transition-colors"
                  >
                    + {v}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                  {t('maintenance.technician_name')} *
                </label>
                <input
                  type="text"
                  value={technicianName}
                  onChange={(e) => setTechnicianName(e.target.value)}
                  placeholder={t('maintenance.technician_placeholder')}
                  className="w-full px-4 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-medium text-sm focus:ring-2 focus:ring-red-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                  {t('maintenance.technician_phone')}
                </label>
                <input
                  type="tel"
                  value={technicianPhone}
                  onChange={(e) => setTechnicianPhone(e.target.value)}
                  placeholder={t('maintenance.technician_phone_placeholder')}
                  className="w-full px-4 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-medium text-sm focus:ring-2 focus:ring-red-500 focus:outline-none"
                />
              </div>
            </div>
          </section>

          {/* SECCIÓN 3: CATEGORÍA Y TIPO DE SERVICIO */}
          <section className="bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-6 shadow-sm border border-slate-200/80 dark:border-slate-800 space-y-4">
            <div className="flex items-center gap-2">
              <Wrench className="text-red-600" size={18} />
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                3. {t('maintenance.category_title')} *
              </h3>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {categoriesList.map(cat => {
                const Icon = cat.icon
                const isSelected = category === cat.id
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategory(cat.id)}
                    className={`p-3 rounded-2xl text-left border text-xs font-bold transition-all flex flex-col items-start gap-2 ${
                      isSelected
                        ? 'border-red-600 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 shadow-sm scale-[1.02]'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300 hover:border-slate-300'
                    }`}
                  >
                    <div className={`p-1.5 rounded-xl ${cat.color}`}>
                      <Icon size={18} />
                    </div>
                    <span className="line-clamp-2">{cat.label}</span>
                  </button>
                )
              })}
            </div>

            <div className="pt-2">
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">
                {t('maintenance.service_type_title')}
              </label>
              <div className="flex flex-wrap gap-2">
                {[
                  { id: 'corrective', label: t('maintenance.type_corrective') },
                  { id: 'preventive', label: t('maintenance.type_preventive') },
                  { id: 'emergency', label: t('maintenance.type_emergency') },
                  { id: 'inspection', label: t('maintenance.type_inspection') },
                  { id: 'new_installation', label: t('maintenance.type_installation') }
                ].map(type => (
                  <button
                    key={type.id}
                    type="button"
                    onClick={() => setServiceType(type.id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
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
          </section>

          {/* SECCIÓN 4: DETALLE DEL TRABAJO */}
          <section className="bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-6 shadow-sm border border-slate-200/80 dark:border-slate-800 space-y-4">
            <div className="flex items-center gap-2">
              <FileText className="text-red-600" size={18} />
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                4. {t('maintenance.details_title')} *
              </h3>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                {t('maintenance.area_equipment')} *
              </label>
              <input
                type="text"
                value={areaEquipment}
                onChange={(e) => setAreaEquipment(e.target.value)}
                placeholder={t('maintenance.area_placeholder')}
                className="w-full px-4 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-medium text-sm focus:ring-2 focus:ring-red-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                {t('maintenance.work_description')} *
              </label>
              <textarea
                rows={3}
                value={workDescription}
                onChange={(e) => setWorkDescription(e.target.value)}
                placeholder={t('maintenance.work_placeholder')}
                className="w-full px-4 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-medium text-sm focus:ring-2 focus:ring-red-500 focus:outline-none resize-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                {t('maintenance.parts_replaced')}
              </label>
              <input
                type="text"
                value={partsReplaced}
                onChange={(e) => setPartsReplaced(e.target.value)}
                placeholder={t('maintenance.parts_placeholder')}
                className="w-full px-4 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-medium text-sm focus:ring-2 focus:ring-red-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">
                {t('maintenance.status_title')}
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {[
                  { id: 'completed', label: t('maintenance.status_completed'), color: 'text-emerald-700 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40' },
                  { id: 'pending_parts', label: t('maintenance.status_pending_parts'), color: 'text-amber-700 border-amber-300 bg-amber-50 dark:bg-amber-950/40' },
                  { id: 'follow_up_needed', label: t('maintenance.status_follow_up'), color: 'text-blue-700 border-blue-300 bg-blue-50 dark:bg-blue-950/40' }
                ].map(st => (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => setStatus(st.id)}
                    className={`px-3 py-2 rounded-2xl text-xs font-bold border transition-all text-center ${
                      status === st.id
                        ? `${st.color} shadow-sm ring-2 ring-slate-900 dark:ring-white`
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* SECCIÓN 5: EVIDENCIAS FOTOGRÁFICAS */}
          <section className="bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-6 shadow-sm border border-slate-200/80 dark:border-slate-800 space-y-5">
            <div className="flex items-center gap-2">
              <Camera className="text-red-600" size={18} />
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                5. {t('maintenance.evidence_title')}
              </h3>
            </div>

            {/* FOTOS ANTES */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {t('maintenance.evidence_before')}
                </span>
                <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 text-xs font-bold hover:bg-red-100 transition-colors">
                  <Camera size={14} />
                  <span>{uploadingSection === 'before' ? t('maintenance.uploading_photo') : t('maintenance.add_photo')}</span>
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
              </div>

              {photosBefore.length > 0 && (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-2">
                  {photosBefore.map((url, idx) => (
                    <div key={idx} className="relative group aspect-square rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100">
                      <img src={url} alt="Antes" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removePhoto(url, 'before')}
                        className="absolute top-1 right-1 p-1 rounded-full bg-black/70 text-white hover:bg-red-600 transition-colors"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* FOTOS DESPUÉS */}
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {t('maintenance.evidence_after')}
                </span>
                <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-xs font-bold hover:bg-emerald-100 transition-colors">
                  <Camera size={14} />
                  <span>{uploadingSection === 'after' ? t('maintenance.uploading_photo') : t('maintenance.add_photo')}</span>
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
              </div>

              {photosAfter.length > 0 && (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-2">
                  {photosAfter.map((url, idx) => (
                    <div key={idx} className="relative group aspect-square rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100">
                      <img src={url} alt="Después" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removePhoto(url, 'after')}
                        className="absolute top-1 right-1 p-1 rounded-full bg-black/70 text-white hover:bg-red-600 transition-colors"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* FOTO FACTURA / TICKET */}
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {t('maintenance.evidence_invoice')}
                </span>
                <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 text-xs font-bold hover:bg-blue-100 transition-colors">
                  <Camera size={14} />
                  <span>{uploadingSection === 'invoice' ? t('maintenance.uploading_photo') : t('maintenance.add_photo')}</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    disabled={uploadingSection !== null}
                    onChange={(e) => handlePhotoUpload(e, 'invoice')}
                    className="hidden"
                  />
                </label>
              </div>

              {photosInvoice.length > 0 && (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-2">
                  {photosInvoice.map((url, idx) => (
                    <div key={idx} className="relative group aspect-square rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100">
                      <img src={url} alt="Factura" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removePhoto(url, 'invoice')}
                        className="absolute top-1 right-1 p-1 rounded-full bg-black/70 text-white hover:bg-red-600 transition-colors"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* SECCIÓN 6: CONTABILIDAD (OPCIONAL) */}
          <section className="bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-6 shadow-sm border border-slate-200/80 dark:border-slate-800 space-y-4">
            <div className="flex items-center gap-2">
              <DollarSign className="text-red-600" size={18} />
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                6. {t('maintenance.accounting_title')}
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                  {t('maintenance.invoice_number')}
                </label>
                <input
                  type="text"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder={t('maintenance.invoice_placeholder')}
                  className="w-full px-4 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-medium text-sm focus:ring-2 focus:ring-red-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                  {t('maintenance.cost_estimate')}
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={costEstimate}
                  onChange={(e) => setCostEstimate(e.target.value)}
                  placeholder={t('maintenance.cost_placeholder')}
                  className="w-full px-4 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-medium text-sm focus:ring-2 focus:ring-red-500 focus:outline-none"
                />
              </div>
            </div>
          </section>

          {/* SECCIÓN 7: VALIDACIÓN Y FIRMA DEL ENCARGADO */}
          <section className="bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-6 shadow-sm border border-slate-200/80 dark:border-slate-800 space-y-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="text-emerald-600" size={18} />
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                7. {t('maintenance.manager_title')} *
              </h3>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                {t('maintenance.manager_name')} *
              </label>
              <input
                type="text"
                value={managerName}
                onChange={(e) => setManagerName(e.target.value)}
                placeholder={t('maintenance.manager_placeholder')}
                className="w-full px-4 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-medium text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                {t('maintenance.manager_signature')}
              </label>
              <SignaturePad onSignatureChange={setSignatureDataUrl} disabled={submitting} />
            </div>
          </section>

          {/* BOTÓN ENVIAR */}
          <div className="pt-4 pb-12">
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-4 px-6 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-extrabold text-base shadow-xl shadow-red-600/30 transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
            >
              {submitting ? (
                <>
                  <RefreshCw className="animate-spin" size={18} />
                  <span>{t('maintenance.submitting')}</span>
                </>
              ) : (
                <>
                  <span>{t('maintenance.submit_button')}</span>
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function MaintenancePublicRegistrationPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-red-600"></div>
      </div>
    }>
      <MaintenanceFormContent />
    </Suspense>
  )
}
