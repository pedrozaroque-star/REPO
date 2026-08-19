'use client'

/**
 * @module app/admin/precios-proveedores/page
 * @description Tablero de Control del Radar de Precios de Proveedores y Auditoría de COGS.
 *   Permite ingesta instantánea de tablas de proveedores por portapapeles (Ctrl+V) o archivos CSV,
 *   detecta aumentos de costos en tiempo real, calcula el impacto financiero anual en dólares ($ USD)
 *   para la cadena de 15 sucursales, y aplica actualizaciones en cascada a las recetas con 1 clic.
 *
 * @businessRules
 *   - Compatible con tablas web sin precios en CSV (e.g. Viele & Sons Order Entry).
 *   - Desacoplado: Los SKUs de proveedores se traducen a Insumos Maestros sin romper recetas.
 *   - El impacto financiero anual se calcula multiplicando el incremento por el consumo anual proyectado.
 *   - La aprobación de precios invalida automáticamente el caché de Food Cost para recálculo inmediato.
 *
 * @dataFlow
 *   Usuario pega tabla o sube CSV -> POST /api/inventory/supplier-prices -> Radar de Comparación
 *   -> Usuario aprueba -> POST /api/inventory/supplier-prices/approve -> Actualización en Cascada.
 *
 * @notes
 *   - Protocolo bilingüe 100% (useLanguage) y reglas estrictas de marca (Tacos Gavilan).
 */

import React, { useState, useEffect } from 'react'
import {
  TrendingUp, AlertTriangle, CheckCircle2, ArrowUpRight, ArrowDownRight,
  ClipboardPaste, UploadCloud, RefreshCw, Layers,
  Search, Calculator, Sparkles, Building2,
  FileSpreadsheet, Check, X, AlertCircle, Plus
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { motion, AnimatePresence } from 'framer-motion'

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

  // Estados principales
  const [activeTab, setActiveTab] = useState<'clipboard' | 'upload' | 'radar' | 'history' | 'mappings'>('clipboard')
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('')
  const [rawText, setRawText] = useState<string>('')
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false)
  const [isSyncingLive, setIsSyncingLive] = useState<boolean>(false)
  const [isApproving, setIsApproving] = useState<boolean>(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Resultados del Radar
  const [radarItems, setRadarItems] = useState<ItemComparison[]>([])
  const [radarSummary, setRadarSummary] = useState<{
    totalItems: number
    totalIncreases: number
    totalDecreases: number
    totalUnchanged: number
    totalNew: number
    netAnnualImpactUsd: number
  } | null>(null)

  // Filtros de tabla
  const [filterStatus, setFilterStatus] = useState<'all' | 'increased' | 'new'>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')

  // Modal Nuevo Proveedor
  const [showNewSupplierModal, setShowNewSupplierModal] = useState<boolean>(false)
  const [newSupplierName, setNewSupplierName] = useState<string>('')
  const [newSupplierCode, setNewSupplierCode] = useState<string>('')
  const [newSupplierCategory, setNewSupplierCategory] = useState<string>('general')
  const [newSupplierUrl, setNewSupplierUrl] = useState<string>('')
  const [isSavingSupplier, setIsSavingSupplier] = useState<boolean>(false)

  // Historial y Mappings
  const [historyList, setHistoryList] = useState<PriceHistoryRecord[]>([])
  const [mappingsList, setMappingsList] = useState<MappingRecord[]>([])
  const [isLoadingInitial, setIsLoadingInitial] = useState<boolean>(true)
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [showApproveConfirm, setShowApproveConfirm] = useState(false)

  // Cargar datos iniciales
  const loadInitialData = async () => {
    try {
      setIsLoadingInitial(true)
      const res = await fetch('/api/inventory/supplier-prices')
      const json = await res.json()
      if (json.success) {
        setSuppliers(json.suppliers || [])
        setHistoryList(json.history || [])
        setMappingsList(json.mappings || [])

        // Seleccionar Viele & Sons por defecto si existe
        if (!selectedSupplierId && json.suppliers?.length > 0) {
          const viele = json.suppliers.find((s: Supplier) => s.supplier_code === 'VIELE')
          setSelectedSupplierId(viele ? viele.id : json.suppliers[0].id)
        }
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

  // Sincronización Automática en Vivo (API Directa)
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
      setSuccessMessage(
        language === 'en'
          ? `Live sync successful! ${json.items?.length || 0} items extracted directly from Viele & Sons API in ${durationSec}s.`
          : `¡Sincronización en vivo exitosa! Se extrajeron ${json.items?.length || 0} artículos directamente de la API de Viele & Sons en ${durationSec}s.`
      )
      setActiveTab('radar')
    } catch (err: any) {
      setErrorMessage(err.message)
    } finally {
      setIsSyncingLive(false)
    }
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

  // Analizar texto (Pegado o Subido)
  const handleAnalyze = async (textToAnalyze?: string) => {
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
    } catch (err: any) {
      setErrorMessage(err.message)
    } finally {
      setIsAnalyzing(false)
    }
  }

  // Cargar muestra de catálogo completa de Viele & Sons (86 Artículos)
  const handleLoadVieleSample = () => {
    const sampleText = `Item Code\tDescription\tQty\tUnit\tPrice\tExt Amt\tComment
1\tBCLCO\tCoca-Cola (Coke) Classic, 5 gal Bag in a Box\t0\tEACH\t118.32\t0.00\t
2\tBDICO\tDiet Coke, 5 gal Bag in a Box\t0\tEACH\t118.32\t0.00\t
3\tBMMLE\tMinute Maid Lemonade, 5 gal Bag in a Box\t0\tEACH\t118.32\t0.00\t
4\tBMMOR\tFanta Orange, 5 gal Bag in a Box\t0\tEACH\t118.32\t0.00\t
5\tBSPRI\tSprite, 5 gal Bag in a Box\t0\tEACH\t118.32\t0.00\t
6\tBRATE\tFuze Raspberry Iced Tea, 5 gal Bag in a Box\t0\tEACH\t118.32\t0.00\t
7\tBSTRA\tFanta Strawberry, 5 gal Bag in a Box\t0\tEACH\t118.32\t0.00\t
8\tBZECO\tCoca-Cola - Coke Zero Sugar, 5 gal Bag in a Box\t0\tEACH\t118.32\t0.00\t
9\t10WRTO\tKingSeal - Birch Wood Toothpicks, Plain Cello Wrapped, 12/1000 count\t0\t12CS\t20.24\t0.00\t
10\t412W\tSolo - Cup, 12 oz White Single Sided Poly Paper Hot Cup, 1000 count\t0\tCS\t47.69\t0.00\t
11\t12PR\tPrimo - Water Cup, 12 oz Clear PP, 1000 count\t0\tCS\t33.80\t0.00\t
12\t2BT1000\tToilet Tissue Rolls, 2-Ply Jumbo Super Soft 9"\t0\tCS\t20.60\t0.00\t
13\tGR800\tAllied West - Optima Hardwound Roll Towels, 7.9"x800' White\t0\tCS\t34.79\t0.00\t
14\t2HOHA\tCup Carrier with Handle, 2 Hole\t0\tCS\t60.50\t0.00\t
15\t4HOHADO\tCup Carry Out Tray with Handle, Holds 4 Drinks\t0\tCS\t73.19\t0.00\t
16\t501GE\tDispenser Napkins, 1-Ply White, Tall-Fold 7x13.5"\t0\tCS\t35.08\t0.00\t
17\tDX900GE\tDispenser Napkin, 2-Ply White Interfold 24/250\t0\tCS\t25.13\t0.00\t
18\tMUFO\tPlatinum II Multifold Towels, 2-Ply White\t0\tCS\t22.12\t0.00\t
19\tEL1025RED\tEl Gavilan - Straw, 10.25" Wrapped, 24/300 count\t0\t24CS\t50.40\t0.00\t
20\t1175YLPR\tPrimo - Wrapped Straw, 11.75" Yellow, 6/300 count\t0\tCS\t19.25\t0.00\t
21\t6STIR\tUnwrapped Stirrer, Sip & Stir Cocktail, 6.75" Red/White Striped\t0\t10CS\t21.25\t0.00\t
22\t721PR\tPrimo - Foil Sheets, 12x10.75, 6/500 count\t0\t6CS\t86.25\t0.00\t
23\t78\tChix Pro-Quat Fresh Guy Towels, Heavy Duty Red 12.5x17\t0\tCS\t94.37\t0.00\t
24\t8R\tSolo - Cup, 8 oz White Paper Cone/Water Refill\t0\tCS\t112.49\t0.00\t
25\tCPLUG-OR\tStixToGo - Hot Beverage Plug, Orange Plastic Circle\t0\tCS\t53.85\t0.00\t
26\tCRCOMA\tNestle - Coffee-Mate Original Creamer\t0\tCS\t43.93\t0.00\t
27\tEL1254\tEl Gavilan - Wax Paper, 14x14, 4/1000 count\t0\tCS\t85.77\t0.00\t
28\tEL4OZ\tEl Gavilan - Cup, 4 oz Paper, 1000 count\t0\tCS\t28.91\t0.00\t
29\tEL8LID\tEl Gavilan - Flat Lid for 8 oz PP Container, 1000 count\t0\tCS\t30.09\t0.00\t
30\tEL8OZ\tEl Gavilan - Cup, 8 oz Paper, 1000 count\t0\tCS\t46.20\t0.00\t
31\tELDP22\tEl Gavilan - Cup, 22 oz Paper, 1000 count\t0\tCS\t55.00\t0.00\t
32\tELDP32\tEl Gavilan - Cup, 32 oz Paper, 500 count\t0\tCS\t48.00\t0.00\t
33\tELSDR16\tEl Gavilan - Cup, 16 oz Hot, 600 count\t0\tCS\t58.00\t0.00\t
34\tL16KRT\tPrimo - Cold Cup Slot Flat Lid, Fits 12-24 oz, 1000 count\t0\tCS\t23.01\t0.00\t
35\tL32KRT\tCold Cup Slot Flat Lid, Fits 32 oz, 600 count\t0\tCS\t20.13\t0.00\t
36\tHL1020PR\tPrimo - Sipper Dome Lid, Fits 10-20 oz Paper Hot Cup, White Plastic, 1000 count\t0\tCS\t29.00\t0.00\t
37\tELGBEVTO\tEl Gavilan - Beverage Tote, 96 oz, 25 count\t0\tCS\t98.75\t0.00\t
38\tELLAS2G\tEl Gavilan - Bag, 21x19+10 Seal2Go, 250 count\t0\tCS\t54.56\t0.00\t
39\tELMES2G\tEl Gavilan - Bag, 15x16+7 Seal2Go, 500 count\t0\tCS\t58.00\t0.00\t
40\tEL1CS2G\tEl Gavilan - Bag, 7x15+2.5 Seal2Go, 500 count\t0\tCS\t27.68\t0.00\t
41\tEL2CS2G\tEl Gavilan - Bag, 14x15+2.5 Seal2Go, 250 count\t0\tCS\t25.99\t0.00\t
42\tELTSBALA\tEl Gavilan - Bag, 12x6x19 Plastic, 2000 count\t0\tCS\t43.85\t0.00\t
43\tEP9PR\tPrimo - MFPP Plate, 9" 3/COMP Ivory, 500 count\t0\tCS\t29.98\t0.00\t
44\tBG6IN\tPrimo Earth - Plate, 6" Round Bagasse, 1000 count\t0\tCS\t30.74\t0.00\t
45\tHEFO\tFork, Heavy White PP Plastic\t0\tCS\t11.99\t0.00\t
46\tHEKN\tKnife, Heavy White PP Plastic\t0\tCS\t11.99\t0.00\t
47\tHESP\tSpoon, Heavy White PP Plastic\t0\tCS\t11.99\t0.00\t
48\tWRHEFOBL\tFork, Wrapped Black Plastic, Extra Heavy\t0\tCS\t16.68\t0.00\t
49\tWRHESPBL\tSpoon, Wrapped Black Plastic, Extra Heavy\t0\tCS\t16.68\t0.00\t
50\tUP918PR\tPrimo - Food Container, 16 oz Round Black Base with Clear Lid, 150 count\t0\tCS\t17.80\t0.00\t
51\t981BLKB\tContainer, 9x8 Black Base with 1 Compartment, 300 count\t0\tCS\t42.55\t0.00\t
52\t983BLKB\tContainer, 9x8 Black Base with 3 Compartments, 300 count\t0\tCS\t42.55\t0.00\t
53\t981LID\tLid for 9x8 Black Base 1 Compartment, 300 count\t0\tCS\t31.80\t0.00\t
54\t983LID\tLid for 9x8 Black Base 3 Compartment, 300 count\t0\tCS\t31.20\t0.00\t
55\t77PB\tPoly Bag, Low Density Flip Top 7x7\t0\tCS\t8.77\t0.00\t
56\tPCNDLI\tLiquid Creamer\t0\tCS\t13.81\t0.00\t
57\tPCSALT\tDiamond Crystal - Salt Packets, 3000 count\t0\tCS\t11.58\t0.00\t
58\tPCSPDA\tSplenda Packets, 2000 count\t0\tCS\t37.89\t0.00\t
59\tPCSUIN500\tSugar in the Raw Packets\t0\tCS\t12.87\t0.00\t
60\tPFLAVI\tVinyl Gloves, Powder Free, Large Clear, 10/100\t0\t10CS\t19.50\t0.00\t
61\tPFMEVI\tVinyl Gloves, Powder Free, Medium Clear, 10/100\t0\t10CS\t19.50\t0.00\t
62\tPFXLVI\tVinyl Gloves, Powder Free, XL Clear, 10/100\t0\t10CS\t19.50\t0.00\t
63\tPFLAVIBLK\tVinyl Gloves, Powder Free, Large Black, 10/100\t0\t10CS\t26.25\t0.00\t
64\tLDGLGE\tPoly Gloves, Medium/Large Clear, 10/500\t0\t10CS\t22.80\t0.00\t
65\tRC1124\tPrimo - Steam Table Pan, 1/3 Size Deep, 12.53x6.5 Aluminum, 200 count\t0\tCS\t66.70\t0.00\t
66\tRC1150\tPrimo - Steam Table Pan, Half Size Deep, 12.75x10.375 x 2.5 Aluminum, 100 count\t0\tCS\t40.50\t0.00\t
67\tRC1174\tPrimo - Steam Table Pan, Full Size Deep, 20.75x 12.8 x 3 Aluminum, 50 count\t0\tCS\t57.80\t0.00\t
68\t709DO\tPrimo - Aluminum Container Dome Lid, 9" Round Clear Plastic, 500 count\t0\tCS\t26.45\t0.00\t
69\tRC478\tPrimo - Aluminum Container, 9" Round, 500 count\t0\tCS\t73.60\t0.00\t
70\tRL940\tPrimo - Steam Table Pan Lid, 1/3 Size Aluminum, 200 count\t0\tCS\t33.00\t0.00\t
71\tRL970\tPrimo - Steam Table Pan Lid, Half Size Aluminum, 100 count\t0\tCS\t24.68\t0.00\t
72\tRL990\tPrimo - Steam Table Pan Lid, Full Size Aluminum, 50 count\t0\tCS\t31.07\t0.00\t
73\t10SPOON\tServing Spoon, 10" Black Plastic, 144 count\t0\tCS\t24.08\t0.00\t
74\tTSCO\tToilet Seat Covers, 20/250\t0\t20CS\t37.80\t0.00\t
75\tIC5GLIDI\tInfinite Chemical - Super Green Pot n Pan Warewash Hand Detergent, 5 gal\t0\tPAIL\t75.58\t0.00\t
76\tIC5SANI\tInfinite Chemical - Sani-10% Quat Ammonium Disinfectant and Sanitizer, 5 gal\t0\tPAIL\t93.10\t0.00\t
77\t3BLEA\tRestaurants Pride - Bleach\t0\t3CS\t12.01\t0.00\t
78\tIC4FLCL\tInfinite Chemical - Enzyme Floor Cleaner, 4/1 gal\t0\t4CS\t78.55\t0.00\t
79\tIC4DEGR\tInfinite Chemical - Degreaser, 4/1 gal\t0\t4CS\t43.20\t0.00\t
80\tIC4DESC\tInfinite Chemical - Lime Scale Cleaner, 4/1 gal\t0\t4CS\t62.30\t0.00\t
81\tIC4DICL\tInfinite Chemical - Sani-Clean Disinfectant, Lemon Scent, Red, 4/1 gal\t0\t4CS\t86.40\t0.00\t
82\tIC4OVGR\tInfinite Chemical - Oven and Grill Cleaner, 4/1 gal\t0\t4CS\t60.00\t0.00\t
83\tQT10\tHydrion Sanitizer (Quat) Test Paper Roll\t0\tPKG\t13.50\t0.00\t
84\tPOURSC\tUrinal Deodorizer Screen, Red, Spiced Apple Scent\t0\tBOX\t29.56\t0.00\t
85\tAEASFR\tAerosol Fruit Scents, 7 oz Assorted\t0\tCS\t58.14\t0.00\t
86\tAEDISP\tMisty Aerosol Dispenser\t0\tEA\t27.19\t0.00\t`
    setRawText(sampleText)
    handleAnalyze(sampleText)
  }

  // Pegar directamente del portapapeles del sistema
  const handlePasteFromClipboard = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const clipText = await navigator.clipboard.readText()
        if (clipText && clipText.trim()) {
          setRawText(clipText)
          handleAnalyze(clipText)
        }
      }
    } catch (e) {
      console.log('Clipboard auto-read failed, fallback to manual paste:', e)
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
        handleAnalyze(content)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  // Aprobar precios y actualizar en cascada
  const handleApproveAll = async () => {
    const itemsToApprove = selectedItems.size > 0
      ? radarItems.filter(i => selectedItems.has(i.supplierSku) && i.masterItemId)
      : radarItems.filter(i => i.masterItemId)
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
          sourceType: activeTab === 'upload' ? 'csv' : 'clipboard'
        })
      })

      const json = await res.json()
      if (!json.success) {
        throw new Error(json.error || 'Error al aprobar precios')
      }

      setSuccessMessage(
        language === 'en'
          ? `Successfully updated ${json.updatedInventoryItems} inventory items and logged ${json.historyRecordsCreated} price records!`
          : `¡Se actualizaron exitosamente ${json.updatedInventoryItems} insumos en inventario y se registraron ${json.historyRecordsCreated} cambios en el historial!`
      )

      // Recargar datos actualizados y limpiar radar
      await loadInitialData()
      setRadarItems([])
      setRadarSummary(null)
      setActiveTab('history')
    } catch (err: any) {
      setErrorMessage(err.message)
    } finally {
      setIsApproving(false)
      setSelectedItems(new Set())
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
    if (filterStatus === 'new') return item.status === 'new_sku' || item.status === 'unmapped'
    return true
  })

  // Selección individual y masiva para aprobación
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
    if (allVisibleSelected) {
      setSelectedItems(new Set())
    } else {
      setSelectedItems(new Set(selectableVisible.map(i => i.supplierSku)))
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 sm:p-6 lg:p-8">
      {/* HEADER PRINCIPAL */}
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800/80 rounded-xl text-red-600 dark:text-red-400">
                <Calculator size={26} className="stroke-[2.2]" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                  {t('supplier_prices.title') || 'Radar de Precios de Proveedores & Auditoría COGS'}
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  {t('supplier_prices.subtitle') || 'Ingesta inteligente de portapapeles y detección de aumentos de costos para las 15 sucursales'}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Botón Sincronizar en Vivo vía API */}
            <button
              onClick={handleSyncLive}
              disabled={isSyncingLive || isAnalyzing}
              className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-60 text-white rounded-xl text-xs sm:text-sm font-bold shadow-sm shadow-emerald-600/20 transition-all cursor-pointer"
            >
              <RefreshCw size={17} className={isSyncingLive ? 'animate-spin' : ''} />
              <span>{isSyncingLive ? (t('supplier_prices.syncing_portal') || 'Sincronizando...') : (t('supplier_prices.btn_sync_now') || 'Sincronizar Ahora (API)')}</span>
            </button>

            {/* Selector de Proveedor Activo */}
            <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 px-3 py-1.5 rounded-xl">
              <Building2 size={18} className="text-slate-400 shrink-0" />
              <div className="flex flex-col">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {t('supplier_prices.select_supplier') || 'Proveedor Activo'}
                </span>
                <select
                  value={selectedSupplierId}
                  onChange={(e) => {
                  setSelectedSupplierId(e.target.value)
                  setSelectedItems(new Set())
                  setRadarItems([])
                  setRadarSummary(null)
                }}
                  className="bg-transparent text-xs sm:text-sm font-semibold text-slate-900 dark:text-white focus:outline-none cursor-pointer pr-1"
                >
                  {suppliers.map(s => (
                    <option key={s.id} value={s.id} className="dark:bg-slate-900">
                      {s.name} ({s.supplier_code})
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => setShowNewSupplierModal(true)}
                title={t('supplier_prices.btn_add_supplier') || 'Agregar Nuevo Proveedor'}
                className="ml-1 p-1.5 bg-white dark:bg-slate-700 hover:bg-red-50 hover:text-red-600 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-200 border border-slate-200 dark:border-slate-600 rounded-lg transition-all shadow-xs cursor-pointer"
              >
                <Plus size={14} className="stroke-[2.5]" />
              </button>
            </div>
          </div>
        </div>

        {/* MENSAJES DE ALERTA O ÉXITO */}
        {errorMessage && (
          <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl text-sm">
            <AlertCircle size={20} className="shrink-0" />
            <span>{errorMessage}</span>
            <button onClick={() => setErrorMessage(null)} className="ml-auto text-xs hover:underline">
              {language === 'en' ? 'Dismiss' : 'Cerrar'}
            </button>
          </div>
        )}

        {successMessage && (
          <div className="flex items-center gap-3 p-4 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 rounded-xl text-sm">
            <CheckCircle2 size={20} className="shrink-0" />
            <span>{successMessage}</span>
            <button onClick={() => setSuccessMessage(null)} className="ml-auto text-xs hover:underline">
              {language === 'en' ? 'Dismiss' : 'Cerrar'}
            </button>
          </div>
        )}

        {/* PESTAÑAS PRINCIPALES */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
          <button
            onClick={() => setActiveTab('clipboard')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all ${
              activeTab === 'clipboard'
                ? 'bg-red-600 text-white shadow-sm shadow-red-500/20'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <ClipboardPaste size={17} />
            <span>{t('supplier_prices.tab_clipboard') || 'Pegar Tabla Web (Portapapeles)'}</span>
          </button>

          <button
            onClick={() => setActiveTab('upload')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all ${
              activeTab === 'upload'
                ? 'bg-red-600 text-white shadow-sm shadow-red-500/20'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <UploadCloud size={17} />
            <span>{t('supplier_prices.tab_upload') || 'Subir Archivo (CSV / Excel)'}</span>
          </button>

          <button
            onClick={() => setActiveTab('radar')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all ${
              activeTab === 'radar'
                ? 'bg-red-600 text-white shadow-sm shadow-red-500/20'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Calculator size={17} />
            <span>{t('supplier_prices.tab_radar') || 'Tablero de Variaciones (Radar)'}</span>
            {radarItems.length > 0 && (
              <span className="ml-1.5 px-2 py-0.5 text-xs bg-white/20 dark:bg-white/20 rounded-full font-bold">
                {radarItems.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all ${
              activeTab === 'history'
                ? 'bg-red-600 text-white shadow-sm shadow-red-500/20'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <TrendingUp size={17} />
            <span>{t('supplier_prices.tab_history') || 'Historial de Precios'}</span>
            <span className="ml-1.5 px-2 py-0.5 text-xs bg-slate-100 dark:bg-slate-800 rounded-full font-bold text-slate-600 dark:text-slate-400">
              {historyList.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('mappings')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all ${
              activeTab === 'mappings'
                ? 'bg-red-600 text-white shadow-sm shadow-red-500/20'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Layers size={17} />
            <span>{t('supplier_prices.tab_mappings') || 'Catálogo & Mapeo'}</span>
            <span className="ml-1.5 px-2 py-0.5 text-xs bg-slate-100 dark:bg-slate-800 rounded-full font-bold text-slate-600 dark:text-slate-400">
              {mappingsList.length}
            </span>
          </button>
        </div>

        {/* CONTENIDO SEGÚN LA PESTAÑA SELECCIONADA */}
        <AnimatePresence mode="wait">
          {/* 1. PESTAÑA: PEGAR TABLA (SMART CLIPBOARD) */}
          {activeTab === 'clipboard' && (
            <motion.div
              key="clipboard"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm space-y-5"
            >
              {/* BANNER RECOMENDADO: SINCRONIZACIÓN AUTOMÁTICA EN 1 CLIC */}
              <div className="bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-transparent border border-emerald-300 dark:border-emerald-800/80 p-4 sm:p-5 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3.5">
                  <div className="p-2.5 bg-emerald-500 text-white rounded-xl shadow-sm shadow-emerald-500/30 shrink-0 mt-0.5">
                    <Sparkles size={20} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                        {language === 'en' ? 'Direct Automatic Live Sync (Recommended)' : 'Sincronización Automática en Vivo (Recomendado)'}
                      </h3>
                      <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 rounded-full border border-emerald-200 dark:border-emerald-800">
                        {language === 'en' ? 'Automated' : 'Automático'}
                      </span>
                    </div>
                    <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1 max-w-2xl">
                      {language === 'en'
                        ? 'Connect directly to Viele & Sons API and fetch all 86 live prices in 1.3 seconds without copying, pasting or downloading any files.'
                        : 'Conecta directamente a la API de Viele & Sons y extrae los 86 precios vigentes en 1.3 segundos sin copiar, pegar ni descargar ningún archivo.'}
                    </p>
                  </div>
                </div>

                <button
                  onClick={handleSyncLive}
                  disabled={isSyncingLive || isAnalyzing}
                  className="flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-60 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-emerald-600/20 transition-all shrink-0 cursor-pointer"
                >
                  <RefreshCw size={17} className={isSyncingLive ? 'animate-spin' : ''} />
                  <span>{isSyncingLive ? (t('supplier_prices.syncing_portal') || 'Sincronizando...') : (t('supplier_prices.btn_sync_now') || 'Sincronizar Ahora (API)')}</span>
                </button>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <ClipboardPaste className="text-red-500" size={20} />
                    {t('supplier_prices.paste_title') || 'Pegado Inteligente de Portapapeles'}
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
                    {t('supplier_prices.paste_instruction') || 'O si prefieres el método manual, entra a la página de tu proveedor (ej. shop.vieleandsons.com/orderentry/), presiona Ctrl+A luego Ctrl+C, y pégala aquí directamente:'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    onClick={handleLoadVieleSample}
                    className="flex items-center gap-2 px-3.5 py-2 bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 rounded-xl text-xs font-bold transition-all shadow-sm"
                  >
                    <Layers size={16} />
                    <span>{language === 'en' ? 'Load Viele & Sons Catalog (86 Items)' : 'Cargar Catálogo Viele & Sons (86 Artículos)'}</span>
                  </button>

                  <button
                    onClick={handlePasteFromClipboard}
                    className="flex items-center gap-2 px-3.5 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-all"
                  >
                    <ClipboardPaste size={16} />
                    <span>{language === 'en' ? 'Paste from Clipboard' : 'Pegar del Portapapeles'}</span>
                  </button>
                </div>
              </div>

              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder={t('supplier_prices.paste_placeholder') || 'Pega aquí la tabla copiada del portal de Viele & Sons o de cualquier proveedor...'}
                rows={10}
                className="w-full p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-mono text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all resize-y"
              />

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setRawText('')}
                    disabled={!rawText}
                    className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 disabled:opacity-40"
                  >
                    {t('supplier_prices.btn_clear') || 'Limpiar'}
                  </button>

                  {radarItems.length > 0 && (
                    <button
                      onClick={() => setActiveTab('radar')}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs font-bold hover:bg-emerald-100 transition-all"
                    >
                      <CheckCircle2 size={15} />
                      <span>{language === 'en' ? `View ${radarItems.length} Items in Radar` : `Ver ${radarItems.length} Artículos en Radar`}</span>
                    </button>
                  )}
                </div>

                <button
                  onClick={() => handleAnalyze()}
                  disabled={isAnalyzing || isSyncingLive || !rawText.trim()}
                  className="flex items-center gap-2 px-6 py-3 bg-red-600 hover:bg-red-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 text-white rounded-xl text-sm font-bold shadow-lg shadow-red-600/20 transition-all"
                >
                  {isAnalyzing ? (
                    <>
                      <RefreshCw size={18} className="animate-spin" />
                      <span>{t('supplier_prices.analyzing') || 'Analizando tabla...'}</span>
                    </>
                  ) : (
                    <>
                      <Calculator size={18} />
                      <span>{t('supplier_prices.btn_analyze') || 'Analizar y Detectar Variaciones'}</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          )}

          {/* 2. PESTAÑA: SUBIR ARCHIVO */}
          {activeTab === 'upload' && (
            <motion.div
              key="upload"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 rounded-2xl shadow-sm text-center space-y-4"
            >
              <div className="max-w-md mx-auto p-8 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl bg-slate-50/50 dark:bg-slate-950/50 hover:bg-slate-100/50 dark:hover:bg-slate-900 transition-all">
                <UploadCloud size={48} className="mx-auto text-red-500 mb-3" />
                <h3 className="font-bold text-slate-900 dark:text-white text-base">
                  {language === 'en' ? 'Upload Price List File' : 'Subir Archivo de Lista de Precios'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-4">
                  {language === 'en' ? 'Supports CSV, TSV, and Text export files from any supplier' : 'Compatible con archivos CSV, TSV y exportaciones de texto de cualquier proveedor'}
                </p>
                <label className="inline-flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold cursor-pointer shadow-md transition-all">
                  <FileSpreadsheet size={16} />
                  <span>{language === 'en' ? 'Select File' : 'Seleccionar Archivo'}</span>
                  <input
                    type="file"
                    accept=".csv,.tsv,.txt"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>
            </motion.div>
          )}

          {/* 3. PESTAÑA: TABLERO DE VARIACIONES (RADAR DE INFLACIÓN) */}
          {activeTab === 'radar' && (
            <motion.div
              key="radar"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="space-y-6"
            >
              {radarSummary ? (
                <>
                  {/* TARJETAS KPI RESUMEN */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* Card 1: Total Artículos */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl shadow-sm">
                      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                        {t('supplier_prices.total_items') || 'Total Artículos'}
                      </span>
                      <div className="text-3xl font-extrabold text-slate-900 dark:text-white mt-1">
                        {radarSummary.totalItems}
                      </div>
                      <span className="text-xs text-slate-500 mt-1 block">
                        {radarSummary.totalUnchanged} {language === 'en' ? 'without change' : 'sin variación'}
                      </span>
                    </div>

                    {/* Card 2: Aumentos Detectados */}
                    <div className="bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900/60 p-5 rounded-2xl shadow-sm bg-red-50/20 dark:bg-red-950/20">
                      <span className="text-xs font-semibold text-red-500 uppercase tracking-wider flex items-center gap-1.5">
                        <AlertTriangle size={14} />
                        {t('supplier_prices.price_increases') || 'Aumentos Detectados'}
                      </span>
                      <div className="text-3xl font-extrabold text-red-600 dark:text-red-400 mt-1">
                        {radarSummary.totalIncreases}
                      </div>
                      <span className="text-xs text-red-500/80 mt-1 block">
                        {language === 'en' ? 'Require approval' : 'Requieren aprobación'}
                      </span>
                    </div>

                    {/* Card 3: Reducciones */}
                    <div className="bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-900/60 p-5 rounded-2xl shadow-sm bg-emerald-50/20 dark:bg-emerald-950/20">
                      <span className="text-xs font-semibold text-emerald-500 uppercase tracking-wider flex items-center gap-1.5">
                        <ArrowDownRight size={14} />
                        {t('supplier_prices.price_decreases') || 'Reducciones'}
                      </span>
                      <div className="text-3xl font-extrabold text-emerald-600 dark:text-emerald-400 mt-1">
                        {radarSummary.totalDecreases}
                      </div>
                      <span className="text-xs text-emerald-600/80 mt-1 block">
                        {language === 'en' ? 'Cost savings' : 'Ahorro en compras'}
                      </span>
                    </div>

                    {/* Card 4: Impacto Financiero Anual ($ USD) */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl shadow-sm">
                      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                        {language === 'en' ? 'Annual Impact (15 Stores)' : 'Impacto Anual (15 Tiendas)'}
                      </span>
                      <div className={`text-3xl font-extrabold mt-1 ${
                        radarSummary.netAnnualImpactUsd > 0
                          ? 'text-red-600 dark:text-red-400'
                          : radarSummary.netAnnualImpactUsd < 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-slate-900 dark:text-white'
                      }`}>
                        {radarSummary.netAnnualImpactUsd > 0 ? '+' : ''}${radarSummary.netAnnualImpactUsd.toLocaleString()}
                      </div>
                      <span className="text-xs text-slate-500 mt-1 block">
                        {language === 'en' ? 'Projected chain budget shift' : 'Proyección anual cadena'}
                      </span>
                    </div>
                  </div>

                  {/* BARRA DE ACCIÓN Y BOTÓN DE APROBACIÓN */}
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-2xl shadow-sm">
                    {/* Filtros de Tabla */}
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <button
                        onClick={() => setFilterStatus('all')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          filterStatus === 'all'
                            ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {t('supplier_prices.filter_all') || 'Todos'} ({radarItems.length})
                      </button>

                      <button
                        onClick={() => setFilterStatus('increased')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          filterStatus === 'increased'
                            ? 'bg-red-600 text-white'
                            : 'bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/60'
                        }`}
                      >
                        🔴 {t('supplier_prices.filter_increases_only') || 'Solo Aumentos'} ({radarSummary.totalIncreases})
                      </button>

                      <button
                        onClick={() => setFilterStatus('new')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          filterStatus === 'new'
                            ? 'bg-amber-600 text-white'
                            : 'bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-900/60'
                        }`}
                      >
                        🟡 {t('supplier_prices.filter_new_only') || 'Nuevos'} ({radarSummary.totalNew})
                      </button>
                    </div>

                    {/* Buscador & Botón Aprobar */}
                    <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                      <div className="relative w-full sm:w-64">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder={language === 'en' ? 'Filter by SKU or name...' : 'Buscar SKU o nombre...'}
                          className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:border-red-500"
                        />
                      </div>

                      <button
                        onClick={() => setShowApproveConfirm(true)}
                        disabled={isApproving || radarItems.filter(i => i.masterItemId).length === 0}
                        className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 transition-all shrink-0"
                      >
                        {isApproving ? (
                          <>
                            <RefreshCw size={15} className="animate-spin" />
                            <span>{t('supplier_prices.approving') || 'Actualizando...'}</span>
                          </>
                        ) : (
                          <>
                            <Check size={16} className="stroke-[2.5]" />
                            <span>{t('supplier_prices.btn_approve_all') || 'Aprobar Precios'}</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* TABLA DE RESULTADOS COMPARATIVOS */}
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 dark:text-slate-400 uppercase tracking-wider font-bold border-b border-slate-200 dark:border-slate-800">
                          <tr>
                            <th className="py-3 px-2 w-8">
                              <input
                                type="checkbox"
                                checked={filteredRadarItems.filter(i => i.masterItemId).length > 0 && filteredRadarItems.filter(i => i.masterItemId).every(i => selectedItems.has(i.supplierSku))}
                                onChange={toggleSelectAll}
                                className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-emerald-600 focus:ring-emerald-500"
                              />
                            </th>
                            <th className="py-3 px-4">{t('supplier_prices.col_sku') || 'SKU'}</th>
                            <th className="py-3 px-4">{t('supplier_prices.col_description') || 'Descripción'}</th>
                            <th className="py-3 px-4 text-center">{t('supplier_prices.col_pack') || 'Empaque'}</th>
                            <th className="py-3 px-4 text-right">{t('supplier_prices.col_prev_price') || 'Precio Anterior'}</th>
                            <th className="py-3 px-4 text-right">{t('supplier_prices.col_new_price') || 'Precio Nuevo'}</th>
                            <th className="py-3 px-4 text-right">{t('supplier_prices.col_diff') || 'Variación'}</th>
                            <th className="py-3 px-4 text-right">{t('supplier_prices.col_unit_cost') || 'Costo Unit.'}</th>
                            <th className="py-3 px-4 text-right">{t('supplier_prices.col_annual_impact') || 'Impacto Anual'}</th>
                            <th className="py-3 px-4 text-center">{t('supplier_prices.col_status') || 'Estado'}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                          {filteredRadarItems.map((item) => (
                            <tr
                              key={item.supplierSku}
                              className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors ${
                                item.status === 'increased'
                                  ? 'bg-red-50/10 dark:bg-red-950/10'
                                  : item.status === 'decreased'
                                  ? 'bg-emerald-50/10 dark:bg-emerald-950/10'
                                  : ''
                              }`}
                            >
                              <td className="py-3 px-2 w-8">
                                <input
                                  type="checkbox"
                                  checked={selectedItems.has(item.supplierSku)}
                                  onChange={() => toggleItemSelection(item.supplierSku)}
                                  disabled={!item.masterItemId}
                                  className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-emerald-600 focus:ring-emerald-500 disabled:opacity-30"
                                />
                              </td>
                              {/* SKU */}
                              <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-white">
                                {item.supplierSku}
                              </td>

                              {/* Descripción */}
                              <td className="py-3 px-4">
                                <div className="font-semibold text-slate-900 dark:text-slate-200">
                                  {item.description}
                                </div>
                                {item.masterItemName && (
                                  <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1">
                                    <span className="text-slate-500 font-medium">Insumo Maestro:</span>
                                    <span>{item.masterItemName}</span>
                                  </div>
                                )}
                              </td>

                              {/* Empaque */}
                              <td className="py-3 px-4 text-center text-slate-600 dark:text-slate-400">
                                <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded font-mono text-[11px]">
                                  {item.packQuantity} / {item.packUnit}
                                </span>
                              </td>

                              {/* Precio Anterior */}
                              <td className="py-3 px-4 text-right font-mono text-slate-500">
                                {item.currentCasePrice > 0 ? `$${item.currentCasePrice.toFixed(2)}` : '—'}
                              </td>

                              {/* Precio Nuevo */}
                              <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 dark:text-white">
                                ${item.newCasePrice.toFixed(2)}
                              </td>

                              {/* Variación */}
                              <td className="py-3 px-4 text-right font-mono font-bold">
                                {item.status === 'increased' && (
                                  <span className="text-red-600 dark:text-red-400 flex items-center justify-end gap-0.5">
                                    <ArrowUpRight size={14} />
                                    +${item.diffAmount.toFixed(2)} (+{item.changePercent}%)
                                  </span>
                                )}
                                {item.status === 'decreased' && (
                                  <span className="text-emerald-600 dark:text-emerald-400 flex items-center justify-end gap-0.5">
                                    <ArrowDownRight size={14} />
                                    -${Math.abs(item.diffAmount).toFixed(2)} ({item.changePercent}%)
                                  </span>
                                )}
                                {item.status === 'unchanged' && (
                                  <span className="text-slate-400">$0.00 (0.0%)</span>
                                )}
                                {(item.status === 'new_sku' || item.status === 'unmapped') && (
                                  <span className="text-amber-500 font-semibold">NUEVO</span>
                                )}
                              </td>

                              {/* Costo Unitario */}
                              <td className="py-3 px-4 text-right font-mono text-slate-600 dark:text-slate-300">
                                ${item.newUnitCost.toFixed(4)}
                              </td>

                              {/* Impacto Anual */}
                              <td className="py-3 px-4 text-right font-mono font-bold">
                                {item.annualImpactUsd > 0 && (
                                  <span className="text-red-600 dark:text-red-400">
                                    +${item.annualImpactUsd.toLocaleString()}
                                  </span>
                                )}
                                {item.annualImpactUsd < 0 && (
                                  <span className="text-emerald-600 dark:text-emerald-400">
                                    -${Math.abs(item.annualImpactUsd).toLocaleString()}
                                  </span>
                                )}
                                {item.annualImpactUsd === 0 && (
                                  <span className="text-slate-400">$0</span>
                                )}
                              </td>

                              {/* Badge Estado */}
                              <td className="py-3 px-4 text-center">
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
                                  <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 rounded-md font-medium text-[10px]">
                                    SIN CAMBIO
                                  </span>
                                )}
                                {(item.status === 'new_sku' || item.status === 'unmapped') && (
                                  <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-400 rounded-md font-bold text-[10px]">
                                    NUEVO SKU
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              ) : (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-12 rounded-2xl text-center space-y-3">
                  <Calculator size={40} className="mx-auto text-slate-400" />
                  <h3 className="font-bold text-slate-700 dark:text-slate-300 text-base">
                    {t('supplier_prices.empty_table') || 'Pega una tabla de precios arriba para comenzar el análisis comparativo.'}
                  </h3>
                  <button
                    onClick={() => setActiveTab('clipboard')}
                    className="px-4 py-2 bg-red-600 text-white rounded-xl text-xs font-bold shadow transition-all hover:bg-red-700"
                  >
                    {language === 'en' ? 'Go to Clipboard Ingestion' : 'Ir a Ingesta de Portapapeles'}
                  </button>
                </div>
              )}
            </motion.div>
          )}

          {/* 4. PESTAÑA: HISTORIAL DE MODIFICACIONES */}
          {activeTab === 'history' && (
            <motion.div
              key="history"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden"
            >
              <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                  {t('supplier_prices.history_title') || 'Historial de Modificaciones de Precios'}
                </h3>
                <button
                  onClick={loadInitialData}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-semibold"
                >
                  <RefreshCw size={13} />
                  <span>{language === 'en' ? 'Refresh' : 'Actualizar'}</span>
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 uppercase tracking-wider font-bold border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-3 px-4">Fecha</th>
                      <th className="py-3 px-4">Proveedor</th>
                      <th className="py-3 px-4">SKU / Insumo</th>
                      <th className="py-3 px-4 text-right">Precio Caja</th>
                      <th className="py-3 px-4 text-right">Costo Unit.</th>
                      <th className="py-3 px-4 text-right">Variación</th>
                      <th className="py-3 px-4">Origen / Notas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {historyList.map((h) => (
                      <tr key={h.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                        <td className="py-3 px-4 font-mono text-slate-500">
                          {h.effective_date}
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-900 dark:text-white">
                          {h.suppliers?.name || 'Viele & Sons'}
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                            {h.supplier_sku}
                          </span>
                          {h.inventory_items?.name && (
                            <span className="text-slate-400 ml-2">({h.inventory_items.name})</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold">
                          ${Number(h.case_price).toFixed(2)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-slate-600 dark:text-slate-400">
                          ${Number(h.unit_cost).toFixed(4)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono">
                          {h.change_percent > 0 ? (
                            <span className="text-red-600 font-bold">+{h.change_percent}%</span>
                          ) : h.change_percent < 0 ? (
                            <span className="text-emerald-600 font-bold">{h.change_percent}%</span>
                          ) : (
                            <span className="text-slate-400">0%</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-500 text-[11px]">
                          {h.notes || h.source_type}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {/* 5. PESTAÑA: CATÁLOGO Y MAPEOS */}
          {activeTab === 'mappings' && (
            <motion.div
              key="mappings"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden"
            >
              <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                    {t('supplier_prices.mappings_title') || 'Mapeo Desacoplado: Códigos de Proveedor vs. Insumos Maestros'}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {language === 'en' ? '87 Items configured from Viele & Sons catalog' : '87 Artículos configurados del catálogo de Viele & Sons'}
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 uppercase tracking-wider font-bold border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-3 px-4">SKU Viele</th>
                      <th className="py-3 px-4">Descripción de Fábrica</th>
                      <th className="py-3 px-4 text-center">Empaque / Pack</th>
                      <th className="py-3 px-4">Insumo Maestro (Sistema)</th>
                      <th className="py-3 px-4 text-right">Precio Actual</th>
                      <th className="py-3 px-4 text-right">Costo Unit. Base</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {mappingsList.map((m) => {
                      const cost = m.inventory_items?.purchase_unit_cost || 0
                      const pack = m.pack_quantity || 1
                      const unitCost = Number((cost / pack).toFixed(4))

                      return (
                        <tr key={m.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                          <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-white">
                            {m.supplier_sku}
                          </td>
                          <td className="py-3 px-4 text-slate-700 dark:text-slate-300">
                            {m.supplier_description}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded font-mono text-[11px]">
                              {m.pack_quantity} {m.pack_unit}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-semibold text-slate-900 dark:text-white">
                              {m.inventory_items?.name || '—'}
                            </span>
                            <span className="text-slate-400 ml-1.5 font-mono text-[11px]">
                              ({m.inventory_items?.unit_measure || 'pza'})
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 dark:text-white">
                            ${Number(cost).toFixed(2)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-slate-600 dark:text-slate-400">
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

      {/* Modal de Confirmación de Aprobación */}
      {showApproveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-amber-100 dark:bg-amber-900/50 rounded-xl">
                <AlertTriangle size={24} className="text-amber-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                {language === 'en' ? 'Confirm Price Approval' : 'Confirmar Aprobación de Precios'}
              </h3>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
              {language === 'en'
                ? `You are about to update ${selectedItems.size > 0 ? selectedItems.size : radarItems.filter(i => i.masterItemId).length} inventory items. This will update purchase costs, recalculate Food Cost, and create audit records.`
                : `Estás a punto de actualizar ${selectedItems.size > 0 ? selectedItems.size : radarItems.filter(i => i.masterItemId).length} insumos de inventario. Esto actualizará costos de compra, recalculará Food Cost y creará registros de auditoría.`}
            </p>
            {radarSummary && radarSummary.netAnnualImpactUsd !== 0 && (
              <div className={`p-3 rounded-xl mb-4 ${radarSummary.netAnnualImpactUsd > 0 ? 'bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50' : 'bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50'}`}>
                <p className={`text-xs font-bold ${radarSummary.netAnnualImpactUsd > 0 ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                  {language === 'en' ? 'Estimated Annual Impact:' : 'Impacto Anual Estimado:'} ${radarSummary.netAnnualImpactUsd > 0 ? '+' : ''}${radarSummary.netAnnualImpactUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                </p>
              </div>
            )}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowApproveConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              >
                {language === 'en' ? 'Cancel' : 'Cancelar'}
              </button>
              <button
                onClick={handleApproveAll}
                disabled={isApproving}
                className="px-4 py-2 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 rounded-xl shadow-md transition-colors"
              >
                {isApproving ? (language === 'en' ? 'Processing...' : 'Procesando...') : (language === 'en' ? 'Yes, Apply Prices' : 'Sí, Aplicar Precios')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: REGISTRAR NUEVO PROVEEDOR */}
      {showNewSupplierModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl max-w-md w-full p-6 space-y-5"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400 rounded-xl">
                  <Building2 size={20} />
                </div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {t('supplier_prices.new_supplier_modal_title') || 'Registrar Nuevo Proveedor'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowNewSupplierModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateSupplier} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                  {t('supplier_prices.supplier_name_label') || 'Nombre Comercial del Proveedor'} *
                </label>
                <input
                  type="text"
                  required
                  value={newSupplierName}
                  onChange={(e) => {
                    setNewSupplierName(e.target.value)
                    if (!newSupplierCode) {
                      setNewSupplierCode(e.target.value.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase().substring(0, 20))
                    }
                  }}
                  placeholder="ej. Sysco, US Foods, Shamrock, Carnes El Rey..."
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                  {t('supplier_prices.supplier_code_label') || 'Código / Identificador Único'} *
                </label>
                <input
                  type="text"
                  required
                  value={newSupplierCode}
                  onChange={(e) => setNewSupplierCode(e.target.value.toUpperCase())}
                  placeholder="ej. SYSCO, US_FOODS, SHAMROCK..."
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                  {t('supplier_prices.supplier_category_label') || 'Categoría Principal'}
                </label>
                <select
                  value={newSupplierCategory}
                  onChange={(e) => setNewSupplierCategory(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
                >
                  <option value="general">General / Varios</option>
                  <option value="packaging_janitorial_beverages">Desechables, Bebidas y Limpieza</option>
                  <option value="broadline">Distribuidor Broadline (Abarrotes y Alimentos)</option>
                  <option value="meats">Carnes y Proteínas</option>
                  <option value="produce">Frutas, Verduras y Perecederos</option>
                  <option value="chemicals">Químicos y Sanitización</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                  {t('supplier_prices.supplier_portal_url_label') || 'URL del Portal Web / Tienda (Opcional)'}
                </label>
                <input
                  type="url"
                  value={newSupplierUrl}
                  onChange={(e) => setNewSupplierUrl(e.target.value)}
                  placeholder="https://shop.sysco.com..."
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowNewSupplierModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-xl"
                >
                  {language === 'en' ? 'Cancel' : 'Cancelar'}
                </button>
                <button
                  type="submit"
                  disabled={isSavingSupplier || !newSupplierName.trim()}
                  className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 active:bg-red-800 disabled:opacity-60 text-white rounded-xl text-xs font-bold shadow-sm shadow-red-600/20 transition-all cursor-pointer"
                >
                  <Check size={16} />
                  <span>{isSavingSupplier ? (language === 'en' ? 'Saving...' : 'Guardando...') : (language === 'en' ? 'Register Supplier' : 'Registrar Proveedor')}</span>
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  )
}
