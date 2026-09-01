'use client'

/**
 * @module app/admin/precios-proveedores/page
 * @description Tablero Ejecutivo del Radar de Precios de Proveedores y Auditoría de COGS.
 *   Diseñado para directivos y gerentes de Tacos Gavilan: carga directamente los 87 insumos
 *   con sus precios actuales, detecta aumentos inflacionarios en 1 clic mediante la API en vivo
 *   de Viele & Sons (1.3s), proyecta el impacto financiero anual en dólares ($ USD) para las 15 sucursales,
 *   y actualiza costos unitarios en cascada a las recetas sin fricción visual.
 *
 * @businessRules
 *   - Acceso exclusivo para usuarios con rol 'admin' (Dirección General y Auditoría Ejecutiva).
 *   - Vista principal ejecutiva directa: Sin estados vacíos ni formularios confusos de entrada.
 *   - Sincronización en 1 Clic: Consulta en tiempo real el catálogo de Viele & Sons v3.
 *   - Desacoplado: Los SKUs de proveedores se traducen a Insumos Maestros sin romper recetas.
 *   - El impacto financiero anual se calcula multiplicando el incremento por el consumo anual proyectado.
 *   - La aprobación de precios invalida automáticamente el caché de Food Cost e inserta en inventory_price_history.
 *   - Ingesta manual (portapapeles y CSV) disponible en cajón colapsable secundario sin estorbar la vista principal.
 *
 * @dataFlow
 *   Carga inicial -> Muestra 87 insumos con precios actuales
 *   -> Clic en 'Sincronizar Precios' -> POST /api/inventory/supplier-prices/sync -> Radar en Vivo
 *   -> Clic en 'Aprobar Precios' -> POST /api/inventory/supplier-prices/approve -> Cascada a Recetas y Food Cost.
 *
 * @notes
 *   - Protocolo bilingüe 100% (useLanguage) y reglas estrictas de marca (Tacos Gavilan).
 */

import React, { useState, useEffect } from 'react'
import ProtectedRoute from '@/components/ProtectedRoute'
import {
  TrendingUp, AlertTriangle, CheckCircle2, ArrowUpRight, ArrowDownRight,
  ClipboardPaste, UploadCloud, RefreshCw, Layers,
  Search, Calculator, Sparkles, Building2,
  FileSpreadsheet, Check, AlertCircle, Plus, ChevronDown, ChevronUp, Mail
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { motion, AnimatePresence } from 'framer-motion'
import { ESTIMATED_ANNUAL_VOLUMES, DEFAULT_ANNUAL_VOLUME } from '@/lib/constants/supplier-volumes'

interface Supplier {
  id: string
  name: string
  supplier_code: string
  category: string
  portal_url?: string
}

interface ItemComparison {
  supplierSku: string
  description: string
  packUnit: string
  packQuantity: number
  newCasePrice: number
  newUnitCost: number
  currentCasePrice: number
  currentUnitCost: number
  diffAmount: number
  changePercent: number
  status: 'increased' | 'decreased' | 'unchanged' | 'new_sku' | 'unmapped'
  masterItemId: string | null
  masterItemName: string | null
  masterItemCategory: string | null
  annualEstimatedCases: number
  annualImpactUsd: number
}

interface PriceHistoryRecord {
  id: string
  supplier_sku: string
  case_price: number
  unit_cost: number
  previous_unit_cost: number
  change_percent: number
  effective_date: string
  source_type: string
  notes?: string
  created_at: string
  suppliers?: { name: string; supplier_code: string }
  inventory_items?: { name: string; sku: string; unit_measure: string }
}

interface MappingRecord {
  id: string
  supplier_sku: string
  supplier_description: string
  pack_quantity: number
  pack_unit: string
  base_unit: string
  inventory_items?: {
    id: string
    name: string
    sku: string
    purchase_unit_cost: number
    quantity_per_unit: number
    unit_measure: string
  }
}

export default function SupplierPricesPage() {
  const { t, language } = useLanguage()

  // Navegación principal (Solo 3 pestañas limpias)
  const [activeTab, setActiveTab] = useState<'radar' | 'history' | 'mappings'>('radar')

  // Datos principales
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('')
  const [historyList, setHistoryList] = useState<PriceHistoryRecord[]>([])
  const [mappingsList, setMappingsList] = useState<MappingRecord[]>([])
  const [isLoadingInitial, setIsLoadingInitial] = useState<boolean>(true)

  // Estados de operación
  const [isSyncingLive, setIsSyncingLive] = useState<boolean>(false)
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false)
  const [isApproving, setIsApproving] = useState<boolean>(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Radar y Comparación
  const [radarItems, setRadarItems] = useState<ItemComparison[]>([])
  const [radarSummary, setRadarSummary] = useState<{
    totalItems: number
    totalIncreases: number
    totalDecreases: number
    totalUnchanged: number
    totalNew: number
    netAnnualImpactUsd: number
  } | null>(null)

  // Filtros de visualización
  const [filterStatus, setFilterStatus] = useState<'all' | 'increased' | 'decreased' | 'unchanged'>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')

  // Selección para aprobación
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [showApproveConfirm, setShowApproveConfirm] = useState(false)
  const [isSendingEmail, setIsSendingEmail] = useState<boolean>(false)

  // Cajón colapsable para métodos manuales (Pegar / Subir archivo)
  const [showManualIngestion, setShowManualIngestion] = useState(false)
  const [manualTab, setManualTab] = useState<'clipboard' | 'upload'>('clipboard')
  const [rawText, setRawText] = useState<string>('')

  // Modal Nuevo Proveedor
  const [showNewSupplierModal, setShowNewSupplierModal] = useState<boolean>(false)
  const [newSupplierName, setNewSupplierName] = useState<string>('')
  const [newSupplierCode, setNewSupplierCode] = useState<string>('')
  const [newSupplierCategory, setNewSupplierCategory] = useState<string>('general')
  const [newSupplierUrl, setNewSupplierUrl] = useState<string>('')
  const [isSavingSupplier, setIsSavingSupplier] = useState<boolean>(false)

  // Construir comparativo base a partir de los mapeos cargados
  const buildInitialRadarFromMappings = (mappings: MappingRecord[]) => {
    if (!mappings || mappings.length === 0) return

    const items: ItemComparison[] = mappings.map(m => {
      const casePrice = m.inventory_items?.purchase_unit_cost || 0
      const packQty = m.pack_quantity || 1
      const unitCost = casePrice / packQty
      const annualCases = ESTIMATED_ANNUAL_VOLUMES[m.supplier_sku] || DEFAULT_ANNUAL_VOLUME

      return {
        supplierSku: m.supplier_sku,
        description: m.supplier_description,
        packUnit: m.pack_unit || 'CS',
        packQuantity: packQty,
        newCasePrice: casePrice,
        newUnitCost: unitCost,
        currentCasePrice: casePrice,
        currentUnitCost: unitCost,
        diffAmount: 0,
        changePercent: 0,
        status: 'unchanged',
        masterItemId: m.inventory_items?.id || null,
        masterItemName: m.inventory_items?.name || m.supplier_description,
        masterItemCategory: null,
        annualEstimatedCases: annualCases,
        annualImpactUsd: 0
      }
    })

    setRadarItems(items)
    setRadarSummary({
      totalItems: items.length,
      totalIncreases: 0,
      totalDecreases: 0,
      totalUnchanged: items.length,
      totalNew: 0,
      netAnnualImpactUsd: 0
    })
  }

  // Cargar datos iniciales desde el backend
  const loadInitialData = async () => {
    try {
      setIsLoadingInitial(true)
      const res = await fetch('/api/inventory/supplier-prices')
      const json = await res.json()
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Error al conectar con el servidor')
      }

      setSuppliers(json.suppliers || [])
      setHistoryList(json.history || [])
      setMappingsList(json.mappings || [])

      // Seleccionar Viele & Sons por defecto
      let targetId = selectedSupplierId
      if (!targetId && json.suppliers?.length > 0) {
        const viele = json.suppliers.find((s: Supplier) => s.supplier_code === 'VIELE')
        targetId = viele ? viele.id : json.suppliers[0].id
        setSelectedSupplierId(targetId)
      }

      // Llenar el radar de inmediato con el catálogo base
      if (json.mappings?.length > 0) {
        buildInitialRadarFromMappings(json.mappings)
      }
    } catch (err: any) {
      console.error('Error loading initial data:', err)
      setErrorMessage(language === 'en' ? 'Error loading initial data. Please refresh the page.' : 'Error al cargar datos iniciales. Por favor recarga la página.')
    } finally {
      setIsLoadingInitial(false)
    }
  }

  useEffect(() => {
    loadInitialData()
  }, [])

  // Sincronización Automática en Vivo (API Viele & Sons v3)
  const handleSyncLive = async () => {
    try {
      setIsSyncingLive(true)
      setErrorMessage(null)
      setSuccessMessage(null)

      const selectedSup = suppliers.find(s => s.id === selectedSupplierId)
      const supplierCode = selectedSup?.supplier_code || 'VIELE'

      const res = await fetch('/api/inventory/supplier-prices/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplierCode })
      })

      const json = await res.json()
      if (!json.success) {
        throw new Error(json.error || 'Error al sincronizar con el portal del proveedor')
      }

      setRadarItems(json.items || [])
      setSelectedItems(new Set())
      setRadarSummary(json.summary || null)
      setErrorMessage(null)
      const durationSec = json.durationMs ? (json.durationMs / 1000).toFixed(1) : '1.3'
      
      const countIncreases = json.summary?.totalIncreases || 0
      const countDecreases = json.summary?.totalDecreases || 0
      const impactFormatted = json.summary?.netAnnualImpactUsd !== undefined
        ? Math.abs(json.summary.netAnnualImpactUsd).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
        : '$0'

      if (countIncreases > 0) {
        setSuccessMessage(
          language === 'en'
            ? `⚡ Live sync complete in ${durationSec}s! Found ${countIncreases} price increases with a net annual impact of +${impactFormatted}.`
            : `⚡ ¡Sincronización en vivo completada en ${durationSec}s! Se detectaron ${countIncreases} aumentos con impacto anual de +${impactFormatted}.`
        )
      } else {
        setSuccessMessage(
          language === 'en'
            ? `⚡ Live sync complete in ${durationSec}s! All ${json.items?.length || 0} catalog prices are verified and up to date.`
            : `⚡ ¡Sincronización en vivo completada en ${durationSec}s! Los ${json.items?.length || 0} productos del catálogo están al día.`
        )
      }
      setActiveTab('radar')
    } catch (err: any) {
      setErrorMessage(err.message)
    } finally {
      setIsSyncingLive(false)
    }
  }

  // Analizar texto pegado o subido en el cajón manual
  const handleAnalyzeManual = async (textToAnalyze?: string) => {
    const text = textToAnalyze || rawText
    if (!text || !text.trim()) {
      setErrorMessage(language === 'en' ? 'Please paste or enter table text first' : 'Por favor pega o ingresa el texto de la tabla primero')
      return
    }

    if (!selectedSupplierId) {
      setErrorMessage(language === 'en' ? 'Please select a supplier first' : 'Por favor selecciona un proveedor primero')
      return
    }

    try {
      setIsAnalyzing(true)
      setErrorMessage(null)
      setSuccessMessage(null)

      const res = await fetch('/api/inventory/supplier-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText: text,
          supplierId: selectedSupplierId
        })
      })

      const json = await res.json()
      if (!json.success) {
        throw new Error(json.error || 'Error al analizar el contenido')
      }

      setRadarItems(json.items || [])
      setSelectedItems(new Set())
      setRadarSummary(json.summary || null)
      setErrorMessage(null)
      setSuccessMessage(
        language === 'en'
          ? `Analysis complete! ${json.items?.length || 0} items extracted successfully.`
          : `¡Análisis completado! Se extrajeron ${json.items?.length || 0} artículos con éxito.`
      )
      setActiveTab('radar')
      setShowManualIngestion(false)
    } catch (err: any) {
      setErrorMessage(err.message)
    } finally {
      setIsAnalyzing(false)
    }
  }

  // Subida de Archivo CSV/TSV
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target?.result as string
      if (content) {
        setRawText(content)
        handleAnalyzeManual(content)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  // Crear nuevo proveedor
  const handleCreateSupplier = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newSupplierName.trim()) return

    try {
      setIsSavingSupplier(true)
      const res = await fetch('/api/inventory/supplier-prices/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newSupplierName,
          supplier_code: newSupplierCode,
          category: newSupplierCategory,
          portal_url: newSupplierUrl
        })
      })

      const json = await res.json()
      if (!json.success) {
        throw new Error(json.error || 'Error al registrar el proveedor')
      }

      await loadInitialData()
      if (json.supplier?.id) {
        setSelectedSupplierId(json.supplier.id)
      }
      setShowNewSupplierModal(false)
      setNewSupplierName('')
      setNewSupplierCode('')
      setNewSupplierCategory('general')
      setNewSupplierUrl('')
      setSuccessMessage(
        language === 'en'
          ? `Supplier "${json.supplier.name}" registered successfully!`
          : `¡Proveedor "${json.supplier.name}" registrado exitosamente!`
      )
    } catch (err: any) {
      setErrorMessage(err.message)
    } finally {
      setIsSavingSupplier(false)
    }
  }

  // Aprobar precios y actualizar en cascada a recetas y Food Cost
  const handleApproveAll = async () => {
    const itemsToApprove = selectedItems.size > 0
      ? radarItems.filter(i => selectedItems.has(i.supplierSku) && i.masterItemId)
      : radarItems.filter(i => i.masterItemId && (i.status === 'increased' || i.status === 'decreased'))

    if (itemsToApprove.length === 0) return
    setShowApproveConfirm(false)

    try {
      setIsApproving(true)
      setErrorMessage(null)

      const res = await fetch('/api/inventory/supplier-prices/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approvedItems: itemsToApprove,
          supplierId: selectedSupplierId,
          sourceType: 'api_sync'
        })
      })

      const json = await res.json()
      if (!json.success) {
        throw new Error(json.error || 'Error al aprobar precios')
      }

      setSuccessMessage(
        language === 'en'
          ? `✅ Successfully updated ${json.updatedInventoryItems} inventory items and recalculated recipe food costs!`
          : `✅ ¡Se actualizaron exitosamente ${json.updatedInventoryItems} insumos en inventario y se recalcularon las recetas!`
      )

      await loadInitialData()
      setSelectedItems(new Set())
      setActiveTab('history')
    } catch (err: any) {
      setErrorMessage(err.message)
    } finally {
      setIsApproving(false)
    }
  }

  // Filtrado de items en tabla
  const filteredRadarItems = radarItems.filter(item => {
    const matchesSearch =
      item.supplierSku.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.masterItemName && item.masterItemName.toLowerCase().includes(searchQuery.toLowerCase()))

    if (!matchesSearch) return false

    if (filterStatus === 'increased') return item.status === 'increased'
    if (filterStatus === 'decreased') return item.status === 'decreased'
    if (filterStatus === 'unchanged') return item.status === 'unchanged'
    return true
  })

  // Selección individual y masiva
  const toggleItemSelection = (sku: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev)
      if (next.has(sku)) next.delete(sku)
      else next.add(sku)
      return next
    })
  }

  const toggleSelectAll = () => {
    const selectableVisible = filteredRadarItems.filter(i => i.masterItemId)
    const allVisibleSelected = selectableVisible.length > 0 && selectableVisible.every(i => selectedItems.has(i.supplierSku))
    setSelectedItems(prev => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        selectableVisible.forEach(i => next.delete(i.supplierSku))
      } else {
        selectableVisible.forEach(i => next.add(i.supplierSku))
      }
      return next
    })
  }

  // Cálculos dinámicos para el modal de confirmación de aprobación
  const itemsToApproveList = selectedItems.size > 0
    ? radarItems.filter(i => selectedItems.has(i.supplierSku) && i.masterItemId)
    : radarItems.filter(i => i.masterItemId && (i.status === 'increased' || i.status === 'decreased'))

  const itemsToApproveCount = itemsToApproveList.length
  const impactToApprove = itemsToApproveList.reduce((sum, i) => sum + (i.annualImpactUsd || 0), 0)

  const activeSupplier = suppliers.find(s => s.id === selectedSupplierId)

  // Disparo manual de alerta por correo a directivos (Aumentos y/o Rebajas de Precios)
  const handleSendEmailAlert = async () => {
    const increases = radarItems.filter(i => i.status === 'increased')
    const decreases = radarItems.filter(i => i.status === 'decreased')

    if (increases.length === 0 && decreases.length === 0) {
      setErrorMessage(language === 'en' ? 'No price changes (increases or drops) detected to notify.' : 'No se detectaron variaciones de precio (aumentos ni rebajas) para notificar.')
      return
    }

    try {
      setIsSendingEmail(true)
      setErrorMessage(null)

      const payloadIncreases = increases.map(i => ({
        supplierSku: i.supplierSku,
        description: i.masterItemName || i.description,
        packUnit: i.packUnit,
        packQuantity: i.packQuantity,
        previousCasePrice: i.currentCasePrice,
        newCasePrice: i.newCasePrice,
        diffAmount: i.diffAmount,
        changePercent: i.changePercent,
        annualVolume: i.annualEstimatedCases || ESTIMATED_ANNUAL_VOLUMES[i.supplierSku] || DEFAULT_ANNUAL_VOLUME,
        annualImpactUsd: i.annualImpactUsd
      }))

      const payloadDecreases = decreases.map(i => ({
        supplierSku: i.supplierSku,
        description: i.masterItemName || i.description,
        packUnit: i.packUnit,
        packQuantity: i.packQuantity,
        previousCasePrice: i.currentCasePrice,
        newCasePrice: i.newCasePrice,
        diffAmount: i.diffAmount,
        changePercent: i.changePercent,
        annualVolume: i.annualEstimatedCases || ESTIMATED_ANNUAL_VOLUMES[i.supplierSku] || DEFAULT_ANNUAL_VOLUME,
        annualImpactUsd: i.annualImpactUsd
      }))

      const netAnnual = [...payloadIncreases, ...payloadDecreases].reduce((sum, item) => sum + item.annualImpactUsd, 0)

      const res = await fetch('/api/inventory/supplier-prices/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierName: activeSupplier?.name || 'Viele & Sons',
          supplierCode: activeSupplier?.supplier_code || 'VIELE',
          increases: payloadIncreases,
          decreases: payloadDecreases,
          netAnnualImpactUsd: netAnnual
        })
      })

      const json = await res.json()
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Error al enviar correo de alerta')
      }

      setSuccessMessage(
        language === 'en'
          ? `Price alert email sent successfully to ${json.recipients?.join(', ')}`
          : `Alerta por correo enviada con éxito a Roberto, Raquel, Gonzalo y Carlos.`
      )
    } catch (err: any) {
      console.error('Error sending price alert email:', err)
      setErrorMessage(err?.message || (language === 'en' ? 'Failed to send alert email' : 'Error al enviar alerta por correo'))
    } finally {
      setIsSendingEmail(false)
    }
  }

  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 sm:p-6 lg:p-8">
        <div className="max-w-7xl mx-auto space-y-6">

        {/* ═══════════════════════════════════════════════════════════
            CABECERA EJECUTIVA LIMPIA (ONE-CLICK RADAR HEADER)
        ═══════════════════════════════════════════════════════════ */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6 rounded-2xl shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="p-3 bg-red-500 text-white rounded-xl shadow-md shadow-red-500/20">
              <Calculator size={26} className="stroke-[2.2]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight">
                  {t('supplier_prices.title') || 'Radar de Precios de Proveedores'}
                </h1>
                <span className="hidden sm:inline-block px-2.5 py-0.5 text-[10px] font-extrabold uppercase bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 rounded-full border border-red-200 dark:border-red-800">
                  {language === 'en' ? 'COGS Auditor' : 'Auditoría COGS'}
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                {t('supplier_prices.subtitle') || 'Detección automática de aumentos de costos y recálculo para las 15 sucursales'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Selector de Proveedor */}
            <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-xl">
              <Building2 size={18} className="text-slate-500 dark:text-slate-400 shrink-0" />
              <div className="flex flex-col">
                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                  {t('supplier_prices.select_supplier') || 'Proveedor'}
                </span>
                <select
                  value={selectedSupplierId}
                  onChange={(e) => {
                    setSelectedSupplierId(e.target.value)
                    setSelectedItems(new Set())
                    setRadarItems([])
                    setRadarSummary(null)
                  }}
                  className="bg-transparent text-xs sm:text-sm font-bold text-slate-900 dark:text-white focus:outline-none cursor-pointer pr-1"
                >
                  {suppliers.map(s => (
                    <option key={s.id} value={s.id} className="dark:bg-slate-900 font-medium">
                      {s.name} ({s.supplier_code})
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => setShowNewSupplierModal(true)}
                title={t('supplier_prices.btn_add_supplier') || 'Agregar Nuevo Proveedor'}
                className="ml-1 p-1.5 bg-white dark:bg-slate-700 hover:bg-red-50 hover:text-red-600 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-200 border border-slate-200 dark:border-slate-600 rounded-lg transition-all cursor-pointer"
              >
                <Plus size={14} className="stroke-[2.5]" />
              </button>
            </div>

            {/* BOTÓN PRINCIPAL ÚNICO: SINCRONIZAR PRECIOS EN VIVO */}
            <button
              onClick={handleSyncLive}
              disabled={isSyncingLive || isAnalyzing}
              className="flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-emerald-600/25 transition-all cursor-pointer"
            >
              <RefreshCw size={17} className={isSyncingLive ? 'animate-spin' : ''} />
              <span>
                {isSyncingLive
                  ? (language === 'en' ? 'Extracting Live Prices...' : 'Extrayendo Precios...')
                  : (language === 'en' ? 'Check Today\'s Prices (API)' : 'Revisar Precios de Hoy (1 Clic)')}
              </span>
            </button>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════
            NOTIFICACIONES DE ESTADO (ALERT & SUCCESS BANNERS)
        ═══════════════════════════════════════════════════════════ */}
        {errorMessage && (
          <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl text-sm shadow-xs">
            <AlertCircle size={20} className="shrink-0" />
            <span className="font-medium">{errorMessage}</span>
            <button onClick={() => setErrorMessage(null)} className="ml-auto text-xs font-bold hover:underline">
              {language === 'en' ? 'Dismiss' : 'Cerrar'}
            </button>
          </div>
        )}

        {successMessage && (
          <div className="flex items-center gap-3 p-4 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 rounded-xl text-sm shadow-xs">
            <CheckCircle2 size={20} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span className="font-medium">{successMessage}</span>
            <button onClick={() => setSuccessMessage(null)} className="ml-auto text-xs font-bold hover:underline">
              {language === 'en' ? 'Dismiss' : 'Cerrar'}
            </button>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            4 TARJETAS EJECUTIVAS RESUMEN (ALWAYS VISIBLE FINANCIAL METRICS)
        ═══════════════════════════════════════════════════════════ */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Total Artículos Monitoreados */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl shadow-xs">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              {t('supplier_prices.total_items') || 'Artículos Monitoreados'}
            </span>
            <div className="text-3xl font-black text-slate-900 dark:text-white mt-1">
              {radarSummary?.totalItems || radarItems.length || mappingsList.length}
            </div>
            <span className="text-xs text-slate-500 mt-1 block">
              {activeSupplier?.name || 'Viele & Sons'} (Activos)
            </span>
          </div>

          {/* Card 2: Aumentos Detectados */}
          <div className={`border p-5 rounded-2xl shadow-xs transition-all ${
            (radarSummary?.totalIncreases || 0) > 0
              ? 'bg-red-50/70 dark:bg-red-950/40 border-red-200 dark:border-red-800'
              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
          }`}>
            <span className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${
              (radarSummary?.totalIncreases || 0) > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-400'
            }`}>
              <AlertTriangle size={15} />
              {t('supplier_prices.price_increases') || 'Subieron de Precio'}
            </span>
            <div className={`text-3xl font-black mt-1 ${
              (radarSummary?.totalIncreases || 0) > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white'
            }`}>
              {radarSummary?.totalIncreases || 0}
            </div>
            <span className="text-xs text-slate-500 mt-1 block">
              {(radarSummary?.totalIncreases || 0) > 0
                ? (language === 'en' ? '⚠️ Require review & approval' : '⚠️ Requieren revisión')
                : (language === 'en' ? '✓ No increases detected' : '✓ Sin aumentos detectados')}
            </span>
          </div>

          {/* Card 3: Rebajas Detectadas */}
          <div className={`border p-5 rounded-2xl shadow-xs transition-all ${
            (radarSummary?.totalDecreases || 0) > 0
              ? 'bg-emerald-50/70 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800'
              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
          }`}>
            <span className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${
              (radarSummary?.totalDecreases || 0) > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'
            }`}>
              <ArrowDownRight size={16} />
              {t('supplier_prices.price_decreases') || 'Bajaron de Precio'}
            </span>
            <div className={`text-3xl font-black mt-1 ${
              (radarSummary?.totalDecreases || 0) > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-white'
            }`}>
              {radarSummary?.totalDecreases || 0}
            </div>
            <span className="text-xs text-slate-500 mt-1 block">
              {(radarSummary?.totalDecreases || 0) > 0
                ? (language === 'en' ? 'Ahorro directo en compras' : 'Ahorro directo en compras')
                : (language === 'en' ? 'Sin variaciones a la baja' : 'Sin variaciones a la baja')}
            </span>
          </div>

          {/* Card 4: Impacto Financiero Anual ($ USD) */}
          <div className={`border p-5 rounded-2xl shadow-xs transition-all ${
            (radarSummary?.netAnnualImpactUsd || 0) > 0
              ? 'bg-red-50/40 dark:bg-red-950/30 border-red-200 dark:border-red-900'
              : (radarSummary?.netAnnualImpactUsd || 0) < 0
              ? 'bg-emerald-50/40 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900'
              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
          }`}>
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              {language === 'en' ? 'Annual Impact (15 Stores)' : 'Impacto Anual (15 Tiendas)'}
            </span>
            <div className={`text-3xl font-black mt-1 ${
              (radarSummary?.netAnnualImpactUsd || 0) > 0
                ? 'text-red-600 dark:text-red-400'
                : (radarSummary?.netAnnualImpactUsd || 0) < 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-slate-900 dark:text-white'
            }`}>
              {(radarSummary?.netAnnualImpactUsd || 0) > 0 ? '+' : ''}${(radarSummary?.netAnnualImpactUsd || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </div>
            <span className="text-xs text-slate-500 mt-1 block">
              {language === 'en' ? 'Gasto proyectado cadena' : 'Gasto proyectado en insumos'}
            </span>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════
            3 PESTAÑAS PRINCIPALES ULTRA-LIMPIAS
        ═══════════════════════════════════════════════════════════ */}
        <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
          <button
            onClick={() => setActiveTab('radar')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer ${
              activeTab === 'radar'
                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-sm'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Calculator size={16} />
            <span>{language === 'en' ? 'Live Price Radar' : 'Precios en Vivo'}</span>
            {radarItems.length > 0 && (
              <span className="px-2 py-0.5 text-[10px] bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-full font-bold">
                {radarItems.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer ${
              activeTab === 'history'
                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-sm'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <TrendingUp size={16} />
            <span>{t('supplier_prices.tab_history') || 'Historial de Cambios'}</span>
            <span className="px-2 py-0.5 text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500 rounded-full font-bold">
              {historyList.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('mappings')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer ${
              activeTab === 'mappings'
                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-sm'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Layers size={16} />
            <span>{t('supplier_prices.tab_mappings') || 'Catálogo de Insumos'}</span>
            <span className="px-2 py-0.5 text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500 rounded-full font-bold">
              {mappingsList.length}
            </span>
          </button>
        </div>

        {/* ═══════════════════════════════════════════════════════════
            CONTENIDO DE PESTAÑAS
        ═══════════════════════════════════════════════════════════ */}
        <AnimatePresence mode="wait">

          {/* ─── PESTAÑA 1: RADAR DE PRECIOS EN VIVO ─── */}
          {activeTab === 'radar' && (
            <motion.div
              key="radar-tab"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="space-y-4"
            >
              {/* BARRA DE FILTROS RÁPIDOS Y ACCIÓN */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-2xl shadow-xs">
                {/* Filtros por Semáforo */}
                <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
                  <button
                    onClick={() => setFilterStatus('all')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      filterStatus === 'all'
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                    }`}
                  >
                    {language === 'en' ? 'All' : 'Todos'} ({radarItems.length})
                  </button>

                  <button
                    onClick={() => setFilterStatus('increased')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      filterStatus === 'increased'
                        ? 'bg-red-600 text-white shadow-sm'
                        : 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/80 hover:bg-red-100'
                    }`}
                  >
                    🔴 {language === 'en' ? 'Increases' : 'Solo Aumentos'} ({radarItems.filter(i => i.status === 'increased').length})
                  </button>

                  <button
                    onClick={() => setFilterStatus('decreased')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      filterStatus === 'decreased'
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/80 hover:bg-emerald-100'
                    }`}
                  >
                    🟢 {language === 'en' ? 'Savings' : 'Solo Rebajas'} ({radarItems.filter(i => i.status === 'decreased').length})
                  </button>

                  <button
                    onClick={() => setFilterStatus('unchanged')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      filterStatus === 'unchanged'
                        ? 'bg-slate-700 text-white'
                        : 'bg-slate-50 dark:bg-slate-800/60 text-slate-500 border border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    ⚪ {language === 'en' ? 'Unchanged' : 'Sin Cambios'} ({radarItems.filter(i => i.status === 'unchanged').length})
                  </button>
                </div>

                {/* Buscador y Botón de Aprobación */}
                <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                  <div className="relative w-full sm:w-64">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={language === 'en' ? 'Search by item or SKU...' : 'Buscar insumo o código...'}
                      className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:border-red-500 font-medium"
                    />
                  </div>

                  {/* Botón de Enviar Alerta por Correo a Directivos (Aumentos y/o Ahorros) */}
                  {radarItems.some(i => i.status === 'increased' || i.status === 'decreased') && (() => {
                    const hasInc = radarItems.some(i => i.status === 'increased')
                    const hasDec = radarItems.some(i => i.status === 'decreased')
                    const isOnlyDec = !hasInc && hasDec
                    const isOnlyInc = hasInc && !hasDec

                    const btnClass = isOnlyDec
                      ? "flex items-center gap-2 px-4 py-2 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/60 border border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300 rounded-xl text-xs font-bold shadow-xs transition-all shrink-0 cursor-pointer disabled:opacity-50"
                      : "flex items-center gap-2 px-4 py-2 bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/60 border border-red-200 dark:border-red-800/60 text-red-700 dark:text-red-300 rounded-xl text-xs font-bold shadow-xs transition-all shrink-0 cursor-pointer disabled:opacity-50"

                    const btnText = isOnlyDec
                      ? (language === 'en' ? '🎉 Email Savings (4)' : '🎉 Notificar Ahorros (4)')
                      : isOnlyInc
                      ? (language === 'en' ? '🚨 Email Increases (4)' : '🚨 Notificar Aumentos (4)')
                      : (language === 'en' ? '📧 Email Alerts & Savings (4)' : '📧 Notificar Alertas & Ahorros (4)')

                    return (
                      <button
                        onClick={handleSendEmailAlert}
                        disabled={isSendingEmail}
                        className={btnClass}
                        title={language === 'en' ? 'Send price variations email to Roberto, Raquel, Gonzalo & Carlos' : 'Enviar reporte de variaciones por correo a Roberto, Raquel, Gonzalo y Carlos'}
                      >
                        {isSendingEmail ? (
                          <>
                            <RefreshCw size={14} className="animate-spin" />
                            <span>{language === 'en' ? 'Sending...' : 'Enviando...'}</span>
                          </>
                        ) : (
                          <>
                            <Mail size={15} />
                            <span>{btnText}</span>
                          </>
                        )}
                      </button>
                    )
                  })()}

                  {/* Botón de Aprobar Precios */}
                  <button
                    onClick={() => setShowApproveConfirm(true)}
                    disabled={isApproving || (radarItems.filter(i => i.masterItemId && (i.status === 'increased' || i.status === 'decreased')).length === 0 && selectedItems.size === 0)}
                    className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 transition-all shrink-0 cursor-pointer"
                  >
                    {isApproving ? (
                      <>
                        <RefreshCw size={15} className="animate-spin" />
                        <span>{t('supplier_prices.approving') || 'Actualizando...'}</span>
                      </>
                    ) : (
                      <>
                        <Check size={16} className="stroke-[2.5]" />
                        <span>
                          {selectedItems.size > 0
                            ? (language === 'en' ? `Approve Selected (${selectedItems.size})` : `Aprobar Seleccionados (${selectedItems.size})`)
                            : (language === 'en' ? 'Approve Price Updates' : 'Aprobar Cambios de Precios')}
                        </span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* TABLA PRINCIPAL DE PRECIOS */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 dark:text-slate-400 uppercase tracking-wider font-bold border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        <th className="py-3.5 px-3 w-8">
                          <input
                            type="checkbox"
                            checked={filteredRadarItems.filter(i => i.masterItemId).length > 0 && filteredRadarItems.filter(i => i.masterItemId).every(i => selectedItems.has(i.supplierSku))}
                            onChange={toggleSelectAll}
                            className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                          />
                        </th>
                        <th className="py-3.5 px-4">{language === 'en' ? 'Item / Product' : 'Insumo / Producto'}</th>
                        <th className="py-3.5 px-4 text-center">{t('supplier_prices.col_pack') || 'Presentación'}</th>
                        <th className="py-3.5 px-4 text-right">{language === 'en' ? 'Previous Price' : 'Precio Anterior'}</th>
                        <th className="py-3.5 px-4 text-right">{language === 'en' ? 'Today\'s Price' : 'Precio de Hoy'}</th>
                        <th className="py-3.5 px-4 text-right">{t('supplier_prices.col_diff') || 'Variación'}</th>
                        <th className="py-3.5 px-4 text-right">{language === 'en' ? 'Annual Impact (15 Stores)' : 'Impacto Anual (15 Tiendas)'}</th>
                        <th className="py-3.5 px-4 text-center">{t('supplier_prices.col_status') || 'Estado'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                      {filteredRadarItems.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-10 text-center text-slate-400">
                            {language === 'en' ? 'No items match the current search or filter.' : 'No se encontraron artículos con el filtro seleccionado.'}
                          </td>
                        </tr>
                      ) : (
                        filteredRadarItems.map((item) => (
                          <tr
                            key={item.supplierSku}
                            className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors ${
                              item.status === 'increased'
                                ? 'bg-red-50/15 dark:bg-red-950/15'
                                : item.status === 'decreased'
                                ? 'bg-emerald-50/15 dark:bg-emerald-950/15'
                                : ''
                            }`}
                          >
                            {/* Checkbox */}
                            <td className="py-3.5 px-3">
                              <input
                                type="checkbox"
                                checked={selectedItems.has(item.supplierSku)}
                                onChange={() => toggleItemSelection(item.supplierSku)}
                                disabled={!item.masterItemId}
                                className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-emerald-600 focus:ring-emerald-500 cursor-pointer disabled:opacity-20"
                              />
                            </td>

                            {/* Insumo / Producto */}
                            <td className="py-3.5 px-4">
                              <div className="flex flex-col">
                                <span className="font-bold text-slate-900 dark:text-white text-xs sm:text-sm">
                                  {item.masterItemName || item.description}
                                </span>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="font-mono text-[11px] text-slate-500 font-bold bg-slate-100 dark:bg-slate-800 px-1.5 py-0.2 rounded">
                                    {item.supplierSku}
                                  </span>
                                  <span className="text-[11px] text-slate-400 line-clamp-1">
                                    {item.description}
                                  </span>
                                </div>
                              </div>
                            </td>

                            {/* Presentación */}
                            <td className="py-3.5 px-4 text-center">
                              <span className="px-2 py-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg text-[11px] font-semibold">
                                {item.packUnit} ({item.packQuantity} {item.packQuantity === 1 ? 'pza' : 'pzas'})
                              </span>
                            </td>

                            {/* Precio Anterior */}
                            <td className="py-3.5 px-4 text-right font-mono text-slate-500 text-xs sm:text-sm">
                              {item.currentCasePrice > 0 ? `$${item.currentCasePrice.toFixed(2)}` : '—'}
                            </td>

                            {/* Precio de Hoy */}
                            <td className="py-3.5 px-4 text-right font-mono font-extrabold text-slate-900 dark:text-white text-xs sm:text-sm">
                              ${item.newCasePrice.toFixed(2)}
                            </td>

                            {/* Variación */}
                            <td className="py-3.5 px-4 text-right font-mono font-bold">
                              {item.status === 'increased' && (
                                <span className="text-red-600 dark:text-red-400 flex items-center justify-end gap-0.5">
                                  <ArrowUpRight size={15} />
                                  +${item.diffAmount.toFixed(2)} (+{item.changePercent}%)
                                </span>
                              )}
                              {item.status === 'decreased' && (
                                <span className="text-emerald-600 dark:text-emerald-400 flex items-center justify-end gap-0.5">
                                  <ArrowDownRight size={15} />
                                  -${Math.abs(item.diffAmount).toFixed(2)} ({item.changePercent}%)
                                </span>
                              )}
                              {item.status === 'unchanged' && (
                                <span className="text-slate-400 font-medium">$0.00 (0.0%)</span>
                              )}
                              {(item.status === 'new_sku' || item.status === 'unmapped') && (
                                <span className="text-amber-500 font-bold">NUEVO</span>
                              )}
                            </td>

                            {/* Impacto Anual en Cadena */}
                            <td className="py-3.5 px-4 text-right font-mono font-bold">
                              {item.annualImpactUsd > 0 && (
                                <span className="text-red-600 dark:text-red-400">
                                  +${item.annualImpactUsd.toLocaleString()} / año
                                </span>
                              )}
                              {item.annualImpactUsd < 0 && (
                                <span className="text-emerald-600 dark:text-emerald-400">
                                  -${Math.abs(item.annualImpactUsd).toLocaleString()} / año
                                </span>
                              )}
                              {item.annualImpactUsd === 0 && (
                                <span className="text-slate-400 font-medium">$0</span>
                              )}
                            </td>

                            {/* Badge Estado */}
                            <td className="py-3.5 px-4 text-center">
                              {item.status === 'increased' && (
                                <span className="px-2 py-0.5 bg-red-100 dark:bg-red-950/60 border border-red-300 dark:border-red-800 text-red-700 dark:text-red-400 rounded-md font-bold text-[10px]">
                                  AUMENTO
                                </span>
                              )}
                              {item.status === 'decreased' && (
                                <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 rounded-md font-bold text-[10px]">
                                  REDUCCIÓN
                                </span>
                              )}
                              {item.status === 'unchanged' && (
                                <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded-md font-medium text-[10px]">
                                  VIGENTE
                                </span>
                              )}
                              {(item.status === 'new_sku' || item.status === 'unmapped') && (
                                <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-400 rounded-md font-bold text-[10px]">
                                  NUEVO SKU
                                </span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ═══════════════════════════════════════════════════════════
                  CAJÓN COLAPSABLE SECUNDARIO (OPCIONAL / CARGA MANUAL)
              ═══════════════════════════════════════════════════════════ */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
                <button
                  onClick={() => setShowManualIngestion(!showManualIngestion)}
                  className="w-full p-4 flex items-center justify-between text-left hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <ClipboardPaste size={18} className="text-slate-400" />
                    <div>
                      <span className="text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-300">
                        {language === 'en' ? 'Manual Ingestion Options (Paste Text / Upload CSV)' : 'Opciones Manuales de Ingesta (Pegar Portapapeles o Subir Archivo CSV)'}
                      </span>
                      <p className="text-[11px] text-slate-400">
                        {language === 'en' ? 'Use this fallback only if the automatic API is unavailable' : 'Úsalo solo si requieres importar una cotización externa o si la API no está disponible'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400">
                    <span>{showManualIngestion ? (language === 'en' ? 'Hide' : 'Ocultar') : (language === 'en' ? 'Expand' : 'Desplegar')}</span>
                    {showManualIngestion ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </button>

                {showManualIngestion && (
                  <div className="p-5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 space-y-4">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setManualTab('clipboard')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          manualTab === 'clipboard'
                            ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                            : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        <ClipboardPaste size={14} className="inline mr-1.5" />
                        {language === 'en' ? 'Paste from Clipboard' : 'Pegar del Portapapeles'}
                      </button>

                      <button
                        onClick={() => setManualTab('upload')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          manualTab === 'upload'
                            ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                            : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        <UploadCloud size={14} className="inline mr-1.5" />
                        {language === 'en' ? 'Upload CSV/Excel' : 'Subir Archivo CSV/Excel'}
                      </button>
                    </div>

                    {manualTab === 'clipboard' ? (
                      <div className="space-y-3">
                        <textarea
                          value={rawText}
                          onChange={(e) => setRawText(e.target.value)}
                          placeholder="Pega aquí la tabla de precios copiada de la web o cotización..."
                          rows={6}
                          className="w-full p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-mono text-slate-800 dark:text-slate-200 focus:outline-none focus:border-red-500 resize-y"
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => setRawText('')}
                            disabled={!rawText}
                            className="px-3 py-1.5 text-xs font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 disabled:opacity-40"
                          >
                            {language === 'en' ? 'Clear' : 'Limpiar'}
                          </button>
                          <button
                            onClick={() => handleAnalyzeManual()}
                            disabled={isAnalyzing || isSyncingLive || !rawText.trim()}
                            className="px-4 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl text-xs font-bold shadow transition-all hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                          >
                            {isAnalyzing ? (language === 'en' ? 'Analyzing...' : 'Analizando...') : (language === 'en' ? 'Analyze Text' : 'Analizar Texto')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="p-6 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 text-center">
                        <UploadCloud size={32} className="mx-auto text-slate-400 mb-2" />
                        <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">
                          {language === 'en' ? 'Select a CSV or TSV file to compare' : 'Selecciona un archivo CSV o TSV para comparar'}
                        </p>
                        <label className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl text-xs font-bold cursor-pointer shadow transition-all">
                          <FileSpreadsheet size={15} />
                          <span>{language === 'en' ? 'Browse File' : 'Buscar Archivo'}</span>
                          <input type="file" accept=".csv,.tsv,.txt" onChange={handleFileUpload} className="hidden" />
                        </label>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* ─── PESTAÑA 2: HISTORIAL DE CAMBIOS ─── */}
          {activeTab === 'history' && (
            <motion.div
              key="history-tab"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden"
            >
              <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-sm sm:text-base">
                    {t('supplier_prices.tab_history') || 'Historial de Auditoría de Precios'}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {language === 'en' ? 'Immutable log of approved price changes and historical baseline costs' : 'Registro inmutable de cambios de precio aprobados y costos base de referencia'}
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 dark:text-slate-400 uppercase tracking-wider font-bold border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-3 px-4">{language === 'en' ? 'Date' : 'Fecha'}</th>
                      <th className="py-3 px-4">{t('supplier_prices.col_sku') || 'SKU'}</th>
                      <th className="py-3 px-4">{language === 'en' ? 'Item' : 'Insumo Maestro'}</th>
                      <th className="py-3 px-4 text-right">{language === 'en' ? 'Prev Cost' : 'Costo Anterior'}</th>
                      <th className="py-3 px-4 text-right">{language === 'en' ? 'New Cost' : 'Nuevo Costo'}</th>
                      <th className="py-3 px-4 text-right">{language === 'en' ? 'Diff %' : 'Variación %'}</th>
                      <th className="py-3 px-4 text-center">{language === 'en' ? 'Source' : 'Origen'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                    {historyList.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-slate-400">
                          {language === 'en' ? 'No historical records found.' : 'No hay registros de historial de precios.'}
                        </td>
                      </tr>
                    ) : (
                      historyList.map((h) => (
                        <tr key={h.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="py-3 px-4 text-slate-500 font-mono">
                            {new Date(h.effective_date).toLocaleDateString()}
                          </td>
                          <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-white">
                            {h.supplier_sku}
                          </td>
                          <td className="py-3 px-4 text-slate-700 dark:text-slate-300">
                            {h.inventory_items?.name || '—'}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-slate-500">
                            ${h.previous_unit_cost.toFixed(2)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 dark:text-white">
                            ${h.case_price.toFixed(2)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold">
                            <span className={h.change_percent > 0 ? 'text-red-600' : h.change_percent < 0 ? 'text-emerald-600' : 'text-slate-400'}>
                              {h.change_percent > 0 ? `+${h.change_percent}%` : `${h.change_percent}%`}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-center">
                            <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-md text-[10px] font-bold uppercase">
                              {h.source_type || 'tech_pack'}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {/* ─── PESTAÑA 3: CATÁLOGO DE INSUMOS ─── */}
          {activeTab === 'mappings' && (
            <motion.div
              key="mappings-tab"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden"
            >
              <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-sm sm:text-base">
                    {t('supplier_prices.tab_mappings') || 'Catálogo de Insumos y Empaques'}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {language === 'en' ? 'Active mappings between supplier codes and master inventory recipes' : 'Mapeo de insumos vinculados a recetas y costos unitarios'}
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 dark:text-slate-400 uppercase tracking-wider font-bold border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-3 px-4">{t('supplier_prices.col_sku') || 'SKU'}</th>
                      <th className="py-3 px-4">{language === 'en' ? 'Supplier Description' : 'Descripción Proveedor'}</th>
                      <th className="py-3 px-4">{language === 'en' ? 'Master Recipe Item' : 'Insumo de Receta'}</th>
                      <th className="py-3 px-4 text-center">{language === 'en' ? 'Pack Size' : 'Empaque / Piezas'}</th>
                      <th className="py-3 px-4 text-right">{language === 'en' ? 'Case Cost' : 'Costo Caja'}</th>
                      <th className="py-3 px-4 text-right">{language === 'en' ? 'Unit Cost' : 'Costo Unitario'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                    {mappingsList.map((m) => {
                      const casePrice = m.inventory_items?.purchase_unit_cost || 0
                      const unitCost = casePrice / (m.pack_quantity || 1)
                      return (
                        <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-white">
                            {m.supplier_sku}
                          </td>
                          <td className="py-3 px-4 text-slate-700 dark:text-slate-300">
                            {m.supplier_description}
                          </td>
                          <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                            {m.inventory_items?.name || '—'}
                          </td>
                          <td className="py-3 px-4 text-center text-slate-600 dark:text-slate-400">
                            {m.pack_unit} ({m.pack_quantity} {m.base_unit})
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 dark:text-white">
                            ${casePrice.toFixed(2)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-slate-500">
                            ${unitCost.toFixed(4)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

        </AnimatePresence>

      </div>

      {/* ═══════════════════════════════════════════════════════════
          MODAL DE CONFIRMACIÓN DE APROBACIÓN
      ═══════════════════════════════════════════════════════════ */}
      {showApproveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6 max-w-md w-full">
            <div className="flex items-center gap-3.5 mb-4">
              <div className="p-3 bg-emerald-100 dark:bg-emerald-950/60 rounded-2xl text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 size={24} />
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white">
                  {language === 'en' ? 'Confirm Price Update' : 'Confirmar Actualización de Precios'}
                </h3>
                <p className="text-xs text-slate-500">
                  {language === 'en' ? 'Immediate cascade to recipes & food cost' : 'Actualización inmediata en recetas y costos'}
                </p>
              </div>
            </div>

            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mb-4 leading-relaxed">
              {language === 'en'
                ? `You are about to update purchase costs for ${itemsToApproveCount} items. This will update recipes across the 15 stores and record audit history.`
                : `Estás a punto de actualizar los costos de compra de ${itemsToApproveCount} insumos. Esto recalculará las recetas en las 15 tiendas y registrará la auditoría.`}
            </p>

            {impactToApprove !== 0 && (
              <div className={`p-4 rounded-2xl mb-5 border ${
                impactToApprove > 0
                  ? 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900'
                  : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900'
              }`}>
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block mb-0.5">
                  {language === 'en' ? 'Projected Annual Chain Impact:' : 'Impacto Anual en las 15 Sucursales:'}
                </span>
                <span className={`text-xl font-black ${
                  impactToApprove > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'
                }`}>
                  {impactToApprove > 0 ? '+' : ''}${Math.abs(impactToApprove).toLocaleString('en-US', { maximumFractionDigits: 0 })} / año
                </span>
              </div>
            )}

            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowApproveConfirm(false)}
                className="px-4 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-xl hover:bg-slate-200 cursor-pointer"
              >
                {language === 'en' ? 'Cancel' : 'Cancelar'}
              </button>
              <button
                onClick={handleApproveAll}
                disabled={isApproving}
                className="px-5 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 rounded-xl shadow-md shadow-emerald-600/30 transition-all cursor-pointer"
              >
                {isApproving
                  ? (language === 'en' ? 'Processing...' : 'Actualizando...')
                  : (language === 'en' ? 'Yes, Apply to Recipes' : 'Sí, Aplicar a las Recetas')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          MODAL AGREGAR NUEVO PROVEEDOR
      ═══════════════════════════════════════════════════════════ */}
      {showNewSupplierModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-red-100 dark:bg-red-950/60 rounded-xl text-red-600">
                  <Building2 size={22} />
                </div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white">
                  {language === 'en' ? 'Add New Supplier' : 'Agregar Nuevo Proveedor'}
                </h3>
              </div>
              <button
                onClick={() => setShowNewSupplierModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSupplier} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {language === 'en' ? 'Supplier Name *' : 'Nombre del Proveedor *'}
                </label>
                <input
                  type="text"
                  required
                  value={newSupplierName}
                  onChange={(e) => setNewSupplierName(e.target.value)}
                  placeholder="ej. Sysco, US Foods, Shamrock Foods..."
                  className="w-full p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:border-red-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {language === 'en' ? 'Code (Optional)' : 'Código (Opcional)'}
                  </label>
                  <input
                    type="text"
                    value={newSupplierCode}
                    onChange={(e) => setNewSupplierCode(e.target.value.toUpperCase())}
                    placeholder="ej. SYSCO"
                    className="w-full p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:border-red-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {language === 'en' ? 'Category' : 'Categoría'}
                  </label>
                  <select
                    value={newSupplierCategory}
                    onChange={(e) => setNewSupplierCategory(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:border-red-500"
                  >
                    <option value="broadline">Broadline (Abarrotes/Desechables)</option>
                    <option value="meat">Carnes / Proteínas</option>
                    <option value="produce">Frutas y Verduras</option>
                    <option value="dairy">Lácteos</option>
                    <option value="general">General</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {language === 'en' ? 'Portal URL (Optional)' : 'URL del Portal (Opcional)'}
                </label>
                <input
                  type="url"
                  value={newSupplierUrl}
                  onChange={(e) => setNewSupplierUrl(e.target.value)}
                  placeholder="https://order.sysco.com..."
                  className="w-full p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:border-red-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowNewSupplierModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
                >
                  {language === 'en' ? 'Cancel' : 'Cancelar'}
                </button>
                <button
                  type="submit"
                  disabled={isSavingSupplier || !newSupplierName.trim()}
                  className="px-5 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white rounded-xl text-xs font-bold shadow-md shadow-red-600/20"
                >
                  {isSavingSupplier ? (language === 'en' ? 'Saving...' : 'Guardando...') : (language === 'en' ? 'Register Supplier' : 'Registrar Proveedor')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      </div>
    </ProtectedRoute>
  )
}
