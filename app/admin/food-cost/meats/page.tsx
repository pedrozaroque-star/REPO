/**
 * @module admin/food-cost/meats/page
 * @description Centro de Control de Porciones de Carnes (Carne Asada #1 prioridad + las 8 proteínas activas):
 *   desglosa el consumo real vs. teórico en bolsas y libras crudas, costo Store USD vs Bodega PurchaseCost,
 *   atribución por Turno AM (06:00–16:59) vs Turno PM (17:00–05:59) con Taqueros/Cooks y Encargados reales en turno,
 *   registro rápido de Conteo de Cambio de Turno 5:00 PM y envío directo de alertas a la Escalera de Mando.
 *
 * @businessRules
 * - Inicializa en Carne Asada (`fab9d589-8ae8-4381-87da-85f836068996`, `$60/bolsa 10 lb = $6.00/lb cruda, $9.76/lb cocida`),
 *   fecha laboral `America/Los_Angeles` (corte 06:00 AM) y ventana predeterminada de **7 días cerrados** (`1D / 7D / 14D / 30D`).
 * - Usa el peso real de bolsa (`bagWeightLbs`: `10 lb` Asada, `5 lb` Pastor/Pollo, `2.5 lb` Cabeza/Lengua, `0.5 lb` Chorizo, `0.375 lb` Carnitas/Buche)
 *   y el `yieldPercent` real del insumo, protegiendo todas las divisiones contra `0/0` (`NaN` / `Infinity`).
 *
 * @dataFlow
 * - `GET /api/stores` + `GET /api/inventory/items` + `GET /api/inventory/meat-analysis` + `GET/POST/PATCH /api/food-cost/portion-alerts`.
 *
 * @notes
 * - [2026-11-23] Reconstruido como Centro de Control AM/PM de Carne Asada y 8 Carnes con atribución de personal y Escalera de Mando.
 * - [2026-11-23] Soporta deep-links completos desde correo y campana (`?store_id` / `?storeId`, `startDate`, `endDate`, `meat` → `ACTIVE_PROTEIN_IDS[qMeat]`) resolviendo parámetros dentro de `fetchInitialData` sin condición de carrera, auto-ejecutando el análisis inicial e integrando `<PortionControlAlertsPanel />` para completar los 4 pasos de Escalera de Mando en la misma pantalla.
 */

'use client'

import React, { Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Scale,
  Loader2,
  AlertTriangle,
  Flame,
  Sun,
  Moon,
  Send,
  ClipboardCheck,
  Users,
  ShieldAlert,
  Clock,
} from 'lucide-react'
import DateRangeFilter from '@/components/sales/DateRangeFilter'
import { formatStoreDisplayName, sortStoresAlphabetically } from '@/lib/store-display'
import FoodCostNavigationTabs from '@/components/food-cost/FoodCostNavigationTabs'
import PortionControlAlertsPanel from '@/components/food-cost/PortionControlAlertsPanel'
import ToastVsFridgeMeterPanel, {
  type ClientFamilyEquivalence,
  type ClientFridgeLedgerEntry,
  type ClientStoreFridgeComparison,
} from '@/components/food-cost/ToastVsFridgeMeterPanel'
import { useLanguage } from '@/lib/i18n'
import { ACTIVE_PROTEIN_IDS, type ActiveProteinKey } from '@/lib/inventory/meat-allocation'
import {
  addDaysIso,
  FOOD_COST_MAX_RANGE_ALL_STORES_DAYS,
  FOOD_COST_MAX_RANGE_SINGLE_STORE_DAYS,
  formatSignedUSD,
  getBusinessDateLA,
  isValidIsoDate,
  validateDateRangeWithinMaxDays,
} from '@/lib/inventory/food-cost-sales-resolver'

function clampMeatDateRange(start: string, end: string, isAllStores: boolean): { start: string; end: string } {
  const maxDays = isAllStores ? FOOD_COST_MAX_RANGE_ALL_STORES_DAYS : FOOD_COST_MAX_RANGE_SINGLE_STORE_DAYS
  const check = validateDateRangeWithinMaxDays(start, end, maxDays)
  if (check.ok) return { start, end }
  if (!isValidIsoDate(end)) {
    const yesterday = addDaysIso(getBusinessDateLA(), -1)
    return { start: addDaysIso(yesterday, -6), end: yesterday }
  }
  return { start: addDaysIso(end, -(maxDays - 1)), end }
}

type SpanPreset = '1d' | '7d' | '14d' | '30d' | 'custom'

interface BreakdownItem {
  guid: string
  itemName: string
  soldQty: number
  portionQty: number
  unit: string
  cookedLbs?: number
  rawLbs: number
  yieldPct: number
  salesAmount?: number
  costAmount?: number
  bodegaCostAmount?: number
  utilityAmount?: number
}

interface StaffMember {
  name: string
  role: string
  hours?: number
  shiftsCount?: number
  station?: string | null
}

interface ShiftSide {
  label: string
  theoRawLbs: number
  theoBags: number
  sharePct: number
  actualBags: number | null
  actualRawLbs: number | null
  varianceBags: number | null
  attributedDollarLossStore: number
  leaders: StaffMember[]
  taqueros: StaffMember[]
}

interface MeatAnalysis {
  storeId: string
  storeNumericId: number | null
  storeName: string
  startDate: string
  endDate: string
  ingredientId: string
  ingredientName: string
  meatKey: string | null
  bagWeightLbs: number
  bagCostStore: number
  bagCostBodega: number
  costPerRawLbStore: number
  costPerRawLbBodega: number
  costPerCookedLbStore: number
  tacoPortionCostStore: number
  burritoPortionCostStore: number
  cookedLbsPerBag: number
  tacosPerBag: number
  burritosPerBag: number
  yieldPercent: number
  totalQuantityUsed: number
  totalCookedLbs: number
  totalRawLbs: number
  theoreticalBagsUsed: number
  theoreticalCostStore: number
  theoreticalCostBodega: number
  shiftBreakdown: {
    am: ShiftSide
    pm: ShiftSide
    dominantShift: 'AM' | 'PM' | 'BOTH'
    attributionMode: 'exact_5pm_handover' | 'volume_weighted_exposure'
    handover5Pm: {
      hasExact5PmHandover: boolean
      businessDate: string | null
      sealedBags5Pm: number
      openCookedLbs5Pm: number
      equivalentRawBags5Pm: number
      countedByName: string | null
      notes: string | null
    }
  }
  physicalReconciliation: {
    hasMeasuredSpan: boolean
    measuredStoresCount: number
    t0: string | null
    t1: string | null
    spanDays: number
    wipCoolerNote: boolean
    openingBags: number
    arrivedBags: number
    expectedEndingBags: number | null
    endingBags: number
    fridgeBalanceBags: number
    fridgeBalanceDollarStore: number
    latestCloseCut: {
      periodLabel: string
      availableInFridgeBags: number | null
      toastSoldBags: number
      expectedClosingBags: number | null
      closingBags: number | null
      closingCountedBy: string | null
      fridgeBalanceBags: number | null
      fridgeBalanceDollarStore: number | null
    } | null
    actualBags: number
    actualRawLbs: number
    spanTheoRawLbs: number
    spanTheoBags: number
    varianceRawLbs: number
    varianceBags: number
    variancePct: number
    dollarLossStore: number
    dollarLossBodega: number
    excessOzPerTaco: number
    excessOzPerBurrito: number
    actualAvgOzPerTaco: number
    actualAvgOzPerBurrito: number
    closingSobranteCookedLbs: number | null
    closingSobranteDate: string | null
    closingSobranteBy: string | null
  }
  escaleraDeMando: {
    storeNumericId: number
    storeName: string
    manager: { name: string; email: string } | null
    assistants: Array<{ name: string; email: string }>
    supervisor: { name: string; email: string } | null
  } | null
  dailyFridgeLedger?: ClientFridgeLedgerEntry[]
  storesComparison?: ClientStoreFridgeComparison[]
  familyEquivalence?: ClientFamilyEquivalence | null
  breakdown: BreakdownItem[]
}

const CANONICAL_MEAT_UUIDS = new Set<string>(Object.values(ACTIVE_PROTEIN_IDS))

function getPresetRange(preset: Exclude<SpanPreset, 'custom'>): { start: string; end: string } {
  const todayLA = getBusinessDateLA()
  const yesterdayLA = addDaysIso(todayLA, -1)
  if (preset === '1d') return { start: yesterdayLA, end: yesterdayLA }
  if (preset === '14d') return { start: addDaysIso(yesterdayLA, -13), end: yesterdayLA }
  if (preset === '30d') return { start: addDaysIso(yesterdayLA, -29), end: yesterdayLA }
  return { start: addDaysIso(yesterdayLA, -6), end: yesterdayLA }
}

function buildAuthHeaders(jsonContent = false): HeadersInit {
  const headers: Record<string, string> = {}
  if (jsonContent) {
    headers['Content-Type'] = 'application/json'
  }
  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem('teg_token')
    if (token && token !== 'null' && token !== 'undefined') {
      headers.Authorization = `Bearer ${token}`
    }
  }
  return headers
}

function resolveMeatIngredientId(rawMeat: string | null | undefined): string | null {
  const trimmed = String(rawMeat || '').trim()
  if (!trimmed) return null
  const key = trimmed
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  if (Object.prototype.hasOwnProperty.call(ACTIVE_PROTEIN_IDS, key)) {
    return ACTIVE_PROTEIN_IDS[key as ActiveProteinKey]
  }
  if (key === 'chicken') return ACTIVE_PROTEIN_IDS.pollo
  if (CANONICAL_MEAT_UUIDS.has(trimmed)) return trimmed
  return null
}

function resolveStoreSelectValue(
  storesList: { id: string; name: string; external_id: string }[],
  qStoreRaw: string,
  fallbackStoreRaw?: string
): string {
  const qStore = qStoreRaw.trim()
  if (qStore.toLowerCase() === 'all') return 'all'
  if (qStore) {
    const matchedFromQuery = storesList.find(
      (s) => String(s.id) === qStore || String(s.external_id) === qStore || (s.external_id && String(s.external_id).toLowerCase() === qStore.toLowerCase())
    )
    if (matchedFromQuery) {
      return matchedFromQuery.external_id || String(matchedFromQuery.id)
    }
  }
  const fb = String(fallbackStoreRaw || '').trim()
  if (fb && fb.toLowerCase() !== 'all') {
    const matchedFb = storesList.find(
      (s) => String(s.id) === fb || String(s.external_id) === fb || (s.external_id && String(s.external_id).toLowerCase() === fb.toLowerCase())
    )
    if (matchedFb) {
      return matchedFb.external_id || String(matchedFb.id)
    }
  }
  const lynwood = storesList.find((s) => Number(s.id) === 14)
  return lynwood ? lynwood.external_id || String(lynwood.id) : storesList[0]?.external_id || 'all'
}

function getLoggedInSingleStoreDefault(): string {
  if (typeof window === 'undefined') return '14'
  try {
    const raw = window.localStorage.getItem('teg_user')
    if (!raw) return '14'
    const parsed = JSON.parse(raw)
    const role = String(parsed?.role || parsed?.user_role || '').trim().toLowerCase()
    const singleStoreRoles = new Set([
      'manager',
      'gerente',
      'general_manager',
      'asistente',
      'assistant',
      'shift_leader',
      'shift leader',
      'shiftleader',
    ])
    if (singleStoreRoles.has(role) && parsed?.store_id !== undefined && parsed?.store_id !== null && String(parsed.store_id).trim() !== '') {
      return String(parsed.store_id).trim()
    }
  } catch {
    // Default to #14 Lynwood
  }
  return '14'
}

function MeatAnalysisPageContent() {
  const { t, language } = useLanguage()
  const isEn = language === 'en'
  const searchParams = useSearchParams()
  const searchParamsKey = searchParams.toString()

  const [initialReady, setInitialReady] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [data, setData] = useState<MeatAnalysis | null>(null)
  const [stores, setStores] = useState<{ id: string; name: string; external_id: string }[]>([])
  const [alertsPanelKey, setAlertsPanelKey] = useState<number>(0)
  const lastAppliedSearchRef = useRef<string | null>(null)

  // Default: Lynwood #14 or first active store when loaded, or URL query param
  const [storeId, setStoreId] = useState<string>('14')
  const [spanPreset, setSpanPreset] = useState<SpanPreset>('7d')
  const [period, setPeriod] = useState<string>('last_7')
  const [startDate, setStartDate] = useState<string>(() => getPresetRange('7d').start)
  const [endDate, setEndDate] = useState<string>(() => getPresetRange('7d').end)

  // Default #1 Priority: Carne Asada
  const [ingredients, setIngredients] = useState<any[]>([])
  const [selectedIngredient, setSelectedIngredient] = useState<string>(ACTIVE_PROTEIN_IDS.asada)

  // Manual quick freezer-bag check
  const [actualBagsInput, setActualBagsInput] = useState<string>('')

  // 5:00 PM Shift Handover form state
  const [handoverDate, setHandoverDate] = useState<string>(() => getBusinessDateLA())
  const [sealedBagsInput, setSealedBagsInput] = useState<string>('')
  const [openCookedLbsInput, setOpenCookedLbsInput] = useState<string>('0')
  const [handoverNotes, setHandoverNotes] = useState<string>('')
  const [savingHandover, setSavingHandover] = useState<boolean>(false)
  const [handoverFeedback, setHandoverFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  // Escalera de Mando alert dispatch state
  const [sendingAlert, setSendingAlert] = useState<boolean>(false)
  const [alertFeedback, setAlertFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [showTechnicalDetail, setShowTechnicalDetail] = useState<boolean>(false)

  // Unified initial load: reads URLSearchParams(window.location.search) directly inside fetchInitialData
  // to eliminate any race between ?store_id / ?storeId / ?meat / dates and /api/stores + /api/inventory/items.
  useEffect(() => {
    let cancelled = false

    const fetchInitialData = async () => {
      const sp = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams()
      const qStore = (sp.get('storeId') || sp.get('store_id') || '').trim()
      const qStart = (sp.get('startDate') || sp.get('start_date') || '').trim()
      const qEnd = (sp.get('endDate') || sp.get('end_date') || '').trim()
      const qMeatUuid = resolveMeatIngredientId(sp.get('meat') || sp.get('meat_key') || sp.get('ingredientId'))

      if (qStart && isValidIsoDate(qStart) && qEnd && isValidIsoDate(qEnd) && qStart <= qEnd) {
        const clamped = clampMeatDateRange(qStart, qEnd, !qStore || qStore === 'all')
        setStartDate(clamped.start)
        setEndDate(clamped.end)
        setSpanPreset('custom')
        setPeriod('custom')
      }
      if (qStore) {
        setStoreId(qStore)
      }
      if (qMeatUuid) {
        setSelectedIngredient(qMeatUuid)
      }

      const [storesSettled, itemsSettled] = await Promise.allSettled([
        fetch('/api/stores', { credentials: 'include', headers: buildAuthHeaders() }),
        fetch('/api/inventory/items', { credentials: 'include', headers: buildAuthHeaders() }),
      ])

      if (cancelled) return

      if (storesSettled.status === 'fulfilled') {
        try {
          const sJson = await storesSettled.value.json()
          if (!cancelled && Array.isArray(sJson)) {
            setStores(
              sortStoresAlphabetically(
                sJson.map((s: any) => ({ ...s, name: formatStoreDisplayName({ id: s.id, name: s.name }) || s.name })),
                (s) => s.name
              )
            )
            const liveSp = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : sp
            const liveQStore = (liveSp.get('storeId') || liveSp.get('store_id') || qStore).trim()
            const defaultFallback = getLoggedInSingleStoreDefault()
            setStoreId(resolveStoreSelectValue(sJson, liveQStore, defaultFallback))
          }
        } catch (e) {
          console.error('Failed to parse stores', e)
        }
      } else {
        console.error('Failed to fetch stores', storesSettled.reason)
      }

      if (itemsSettled.status === 'fulfilled') {
        try {
          const json = await itemsSettled.value.json()
          const allItems = Array.isArray(json?.items) ? json.items : []

          let meats = allItems.filter((i: any) => CANONICAL_MEAT_UUIDS.has(String(i.id)))
          if (meats.length === 0) {
            const targetProteins = ['ASADA', 'PASTOR', 'POLLO', 'CARNITAS', 'CHORIZO', 'CABEZA', 'LENGUA', 'BUCHE']
            meats = allItems.filter((i: any) => {
              const name = String(i.name || '').toUpperCase()
              return targetProteins.some((p) => name.includes(p)) && !name.includes('SALSA')
            })
          }

          // Ordenar poniendo Carne Asada siempre en posición #1
          meats.sort((a: any, b: any) => {
            if (a.id === ACTIVE_PROTEIN_IDS.asada) return -1
            if (b.id === ACTIVE_PROTEIN_IDS.asada) return 1
            return String(a.name || '').localeCompare(String(b.name || ''))
          })

          if (!cancelled) {
            setIngredients(meats)
            const liveSp = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : sp
            const liveMeatUuid =
              resolveMeatIngredientId(liveSp.get('meat') || liveSp.get('meat_key') || liveSp.get('ingredientId')) ||
              qMeatUuid

            if (liveMeatUuid && (meats.length === 0 || meats.some((m: any) => String(m.id) === liveMeatUuid))) {
              setSelectedIngredient(liveMeatUuid)
            } else {
              const asada = meats.find((m: any) => m.id === ACTIVE_PROTEIN_IDS.asada)
              if (asada) {
                setSelectedIngredient(asada.id)
              } else if (meats.length > 0) {
                setSelectedIngredient(meats[0].id)
              }
            }
          }
        } catch (e) {
          console.error('Failed to parse ingredients', e)
        }
      } else {
        console.error('Failed to fetch ingredients', itemsSettled.reason)
      }

      if (!cancelled) {
        lastAppliedSearchRef.current = searchParamsKey
        setInitialReady(true)
      }
    }

    fetchInitialData()
    return () => {
      cancelled = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync subsequent in-app bell notification navigations when already mounted on /admin/food-cost/meats
  useEffect(() => {
    if (!initialReady) return
    if (lastAppliedSearchRef.current === searchParamsKey) return
    lastAppliedSearchRef.current = searchParamsKey
    if (!searchParamsKey) return

    const qStore = (searchParams.get('storeId') || searchParams.get('store_id') || '').trim()
    const qStart = (searchParams.get('startDate') || searchParams.get('start_date') || '').trim()
    const qEnd = (searchParams.get('endDate') || searchParams.get('end_date') || '').trim()
    const qMeatUuid = resolveMeatIngredientId(
      searchParams.get('meat') || searchParams.get('meat_key') || searchParams.get('ingredientId')
    )

    if (qStore && stores.length > 0) {
      setStoreId((prev) => resolveStoreSelectValue(stores, qStore, prev))
    } else if (qStore) {
      setStoreId(qStore)
    }

    if (qStart && isValidIsoDate(qStart) && qEnd && isValidIsoDate(qEnd) && qStart <= qEnd) {
      const clamped = clampMeatDateRange(qStart, qEnd, !qStore || qStore === 'all')
      setStartDate(clamped.start)
      setEndDate(clamped.end)
      setSpanPreset('custom')
      setPeriod('custom')
    }

    if (qMeatUuid) {
      setSelectedIngredient(qMeatUuid)
    }
  }, [initialReady, searchParamsKey, searchParams, stores])

  const resolvedAlertsStoreId = useMemo(() => {
    if (!storeId || storeId === 'all') return 'all'
    const matched = stores.find(
      (s) => String(s.id) === String(storeId) || String(s.external_id) === String(storeId)
    )
    if (matched) return String(matched.id)
    if (data?.storeNumericId) return String(data.storeNumericId)
    return storeId
  }, [storeId, stores, data?.storeNumericId])

  const analysisAbortRef = useRef<AbortController | null>(null)
  const maxAllowedDays = storeId === 'all' ? FOOD_COST_MAX_RANGE_ALL_STORES_DAYS : FOOD_COST_MAX_RANGE_SINGLE_STORE_DAYS

  const runAnalysis = useCallback(async () => {
    if (!selectedIngredient || !startDate || !endDate) return
    const check = validateDateRangeWithinMaxDays(startDate, endDate, maxAllowedDays)
    if (!check.ok) {
      setErrorMsg(t('food_cost.max_range_exceeded', { max: maxAllowedDays }))
      return
    }

    if (analysisAbortRef.current) analysisAbortRef.current.abort()
    const controller = new AbortController()
    analysisAbortRef.current = controller

    setLoading(true)
    setErrorMsg(null)
    try {
      const qs = new URLSearchParams({
        storeId,
        startDate,
        endDate,
        ingredientId: selectedIngredient,
      })
      const res = await fetch(`/api/inventory/meat-analysis?${qs.toString()}`, {
        credentials: 'include',
        headers: buildAuthHeaders(),
        signal: controller.signal,
      })
      const rawText = await res.text()
      let json: any = null
      try {
        json = rawText ? JSON.parse(rawText) : null
      } catch {
        json = null
      }
      if (!res.ok || json?.error) {
        setErrorMsg(json?.error || `Error ${res.status}`)
      } else if (json) {
        const cleanedJson = {
          ...json,
          storeName: json.storeNumericId
            ? formatStoreDisplayName({ id: json.storeNumericId, name: json.storeName }) || json.storeName
            : json.storeName,
          storesComparison: Array.isArray(json.storesComparison)
            ? json.storesComparison.map((sc: any) => ({
                ...sc,
                storeName: formatStoreDisplayName({ id: sc.storeNumericId, name: sc.storeName }) || sc.storeName,
              }))
            : json.storesComparison,
        }
        setData(cleanedJson)
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      setErrorMsg(e?.message || t('food_cost.load_error'))
    } finally {
      if (analysisAbortRef.current === controller) {
        setLoading(false)
      }
    }
  }, [storeId, startDate, endDate, selectedIngredient, maxAllowedDays, t])

  // Auto-run analysis as soon as stores + ingredients + URL params finish resolving
  useEffect(() => {
    if (!initialReady) return
    runAnalysis()
    return () => {
      if (analysisAbortRef.current) analysisAbortRef.current.abort()
    }
  }, [initialReady, runAnalysis])

  const applyPreset = (preset: Exclude<SpanPreset, 'custom'>) => {
    const r = getPresetRange(preset)
    setSpanPreset(preset)
    setPeriod('custom')
    setStartDate(r.start)
    setEndDate(r.end)
  }

  const handleSave5PmHandover = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!data || storeId === 'all') return
    const sealed = parseFloat(sealedBagsInput)
    const openCooked = parseFloat(openCookedLbsInput || '0')
    if (!Number.isFinite(sealed) || sealed < 0) {
      setHandoverFeedback({
        ok: false,
        text: isEn ? 'Enter valid sealed bags (>= 0).' : 'Ingresa bolsas selladas válidas (>= 0).',
      })
      return
    }

    setSavingHandover(true)
    setHandoverFeedback(null)
    try {
      const res = await fetch('/api/food-cost/portion-alerts', {
        method: 'POST',
        credentials: 'include',
        headers: buildAuthHeaders(true),
        body: JSON.stringify({
          action: 'save_handover',
          storeId: data.storeNumericId || storeId,
          businessDate: handoverDate,
          meatKey: data.meatKey || 'asada',
          sealedBags: sealed,
          openCookedLbs: Number.isFinite(openCooked) && openCooked >= 0 ? openCooked : 0,
          notes: handoverNotes.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok || json.error) {
        setHandoverFeedback({ ok: false, text: json.error || 'Error guardando corte 5:00 PM' })
      } else {
        setHandoverFeedback({
          ok: true,
          text: isEn
            ? '5:00 PM shift handover saved! Recalculating AM vs PM bags...'
            : '¡Corte 5:00 PM guardado! Recalculando bolsas reales AM vs PM...',
        })
        setSealedBagsInput('')
        setHandoverNotes('')
        setAlertsPanelKey((k) => k + 1)
        runAnalysis()
      }
    } catch (err: any) {
      setHandoverFeedback({ ok: false, text: err?.message || 'Network error' })
    } finally {
      setSavingHandover(false)
    }
  }

  const handleSendEscaleraAlert = async () => {
    if (!data || storeId === 'all') return
    const confirmText = isEn
      ? `Send official Portion Control Alert for ${data.ingredientName} at ${data.storeName} (${startDate} to ${endDate}) to Manager, Assistants, and Regional Supervisor?`
      : `¿Enviar Alerta Oficial de Control de Porciones de ${data.ingredientName} en ${data.storeName} (${startDate} al ${endDate}) al Gerente, Asistentes y Supervisor Regional?`
    if (!window.confirm(confirmText)) return

    setSendingAlert(true)
    setAlertFeedback(null)
    try {
      const res = await fetch('/api/food-cost/portion-alerts', {
        method: 'POST',
        credentials: 'include',
        headers: buildAuthHeaders(true),
        body: JSON.stringify({
          action: 'send_alert',
          storeId: data.storeNumericId || storeId,
          startDate,
          endDate,
          meatKey: data.meatKey || 'asada',
        }),
      })
      const json = await res.json()
      if (!res.ok || json.error) {
        setAlertFeedback({ ok: false, text: json.error || 'Error al despachar alerta' })
      } else {
        const sentCount = json.emailsSent ?? (json.dispatched?.emailSent ? 1 : 0)
        setAlertFeedback({
          ok: true,
          text:
            sentCount > 0
              ? isEn
                ? `Escalation sent to Chain of Command (${sentCount} email + in-app bell alerts).`
                : `Alerta enviada a la Escalera de Mando (${sentCount} correo + campana de notificaciones).`
              : isEn
                ? 'Scan completed: store is currently within portion tolerance.'
                : 'Escaneo completado: la sucursal está dentro de tolerancia o la alerta ya fue notificada.',
        })
        setAlertsPanelKey((k) => k + 1)
      }
    } catch (err: any) {
      setAlertFeedback({ ok: false, text: err?.message || 'Network error' })
    } finally {
      setSendingAlert(false)
    }
  }

  const bagWeight = data?.bagWeightLbs || 10
  const bagsUsed = data ? data.theoreticalBagsUsed : 0
  const tacosEquivalent = data && data.yieldPercent > 0 ? ((data.totalRawLbs * (data.yieldPercent / 100) * 16) / 1.5) : 0
  const phys = data?.physicalReconciliation

  const parsedActualInput = actualBagsInput !== '' ? Number(actualBagsInput) : null
  const manualBagDiff =
    parsedActualInput !== null && Number.isFinite(parsedActualInput) ? parsedActualInput - bagsUsed : null
  const manualDiffPct =
    manualBagDiff !== null && bagsUsed > 0 ? (manualBagDiff / bagsUsed) * 100 : 0
  const manualDollarDiff =
    manualBagDiff !== null && data ? manualBagDiff * data.bagCostStore : 0

  return (
    <div className="p-4 md:p-6 max-w-[1650px] mx-auto space-y-6">
      <FoodCostNavigationTabs />

      {/* Header & Controls */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-black text-slate-900 dark:text-white flex flex-wrap items-center gap-2.5">
            <Scale className="w-8 h-8 text-red-600" />
            <span>{t('food_cost.meat_analysis') || (isEn ? 'Meat Portion Control Center' : 'Control de Porciones de Carnes')}</span>
            <span className="text-xs font-black px-2.5 py-0.5 rounded-full bg-red-600 text-white uppercase tracking-wider">
              AM / PM Attribution
            </span>
          </h1>
          <p className="text-xs md:text-sm text-slate-500 mt-1">
            {isEn
              ? 'Carne Asada ($60 / 10 lb bag) & 8-Meat Mass-Balance, Shift Attribution, and Chain-of-Command Escalation'
              : 'Balance físico vs. tickets Toast POS para Carne Asada ($60 / bolsa 10 lb) y las 8 proteínas con atribución AM/PM'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 bg-white dark:bg-slate-900 p-2.5 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800">
          <select
            value={storeId}
            onChange={(e) => {
              const nextStore = e.target.value
              setStoreId(nextStore)
              if (nextStore === 'all') {
                const clamped = clampMeatDateRange(startDate, endDate, true)
                if (clamped.start !== startDate || clamped.end !== endDate) {
                  setStartDate(clamped.start)
                  setEndDate(clamped.end)
                  setSpanPreset('custom')
                  setPeriod('custom')
                }
              }
            }}
            className="px-3 py-2 text-xs font-bold border rounded-lg bg-slate-50 dark:bg-slate-800 dark:text-white border-slate-300 dark:border-slate-700 outline-none"
          >
            <option value="all">{t('sales.all_stores') || (isEn ? 'All 15 Stores' : '15 Sucursales (Consolidado)')}</option>
            {stores.map((s) => (
              <option key={s.id} value={s.external_id || s.id}>
                {formatStoreDisplayName({ id: s.id, name: s.name })}
              </option>
            ))}
          </select>

          <select
            value={selectedIngredient}
            onChange={(e) => setSelectedIngredient(e.target.value)}
            className="px-3 py-2 text-xs font-bold border rounded-lg bg-red-50/70 dark:bg-slate-800 text-red-950 dark:text-white border-red-300 dark:border-slate-700 outline-none"
          >
            {ingredients.map((i) => (
              <option key={i.id} value={i.id}>
                {i.id === ACTIVE_PROTEIN_IDS.asada ? `🔥 ${i.name} (#1)` : i.name}
              </option>
            ))}
          </select>

          {/* 1D / 7D / 14D / 30D Rolling Window Pills */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700">
            {(['1d', '7d', '14d', '30d'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => applyPreset(p)}
                className={`px-2.5 py-1 text-xs font-black uppercase rounded-md transition-all cursor-pointer ${
                  spanPreset === p
                    ? 'bg-red-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          <DateRangeFilter
            period={period}
            startDate={startDate}
            endDate={endDate}
            maxDays={maxAllowedDays}
            hiddenPresets={storeId === 'all' ? ['quarter'] : []}
            onChange={(p, start, end) => {
              setSpanPreset('custom')
              setPeriod(p as string)
              setStartDate(start)
              setEndDate(end)
            }}
          />

          <button
            type="button"
            onClick={runAnalysis}
            disabled={loading || !selectedIngredient}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-black rounded-lg flex items-center gap-1.5 disabled:opacity-50 transition-colors cursor-pointer"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : t('food_cost.analyze') || (isEn ? 'Analyze' : 'Analizar')}
          </button>
        </div>
      </div>

      {/* Quick 8-Meat Selector Strip */}
      {ingredients.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {ingredients.map((m) => {
            const active = m.id === selectedIngredient
            const isAsada = m.id === ACTIVE_PROTEIN_IDS.asada
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setSelectedIngredient(m.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                  active
                    ? 'bg-red-600 text-white border-red-600 shadow-sm'
                    : isAsada
                      ? 'bg-red-50 text-red-900 border-red-200 hover:bg-red-100'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-100'
                }`}
              >
                {isAsada ? `🥩 ${m.name} ($60/10lb)` : m.name}
              </button>
            )
          })}
        </div>
      )}

      {errorMsg && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs font-bold flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          <span>{errorMsg}</span>
        </div>
      )}

      {(loading || !initialReady) && !data && !errorMsg && (
        <div className="p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col items-center justify-center gap-3 text-center">
          <Loader2 className="w-7 h-7 text-red-600 animate-spin" />
          <div className="text-sm font-extrabold text-slate-800 dark:text-slate-100">
            {t('food_cost.loading') || (isEn ? 'Loading data...' : 'Cargando datos...')}
          </div>
          <p className="text-xs text-slate-500">
            {isEn
              ? 'Calculating physical bag mass-balance vs. Toast POS recipes and AM/PM shift attribution...'
              : 'Calculando balance físico de bolsas vs. recetas Toast POS y atribución AM/PM...'}
          </p>
        </div>
      )}

      {data && (
        <>
          {/* VISTA PRINCIPAL SIMPLE: CONTROL DE SOBRANTES VS. VENTAS TOAST */}
          <ToastVsFridgeMeterPanel
            ingredientName={data.ingredientName}
            storeName={data.storeName}
            bagWeightLbs={bagWeight}
            bagCostStore={data.bagCostStore}
            expectedEndingBags={phys?.hasMeasuredSpan ? phys.expectedEndingBags : null}
            endingBags={phys?.hasMeasuredSpan ? phys.endingBags : null}
            dailyFridgeLedger={data.dailyFridgeLedger || []}
            storesComparison={data.storesComparison || []}
            familyEquivalence={data.familyEquivalence || null}
            selectedStoreNumericId={data.storeNumericId}
            defaultIngredientId={selectedIngredient}
            onTransfersUpdated={runAnalysis}
            onBackToAllStores={() => setStoreId('all')}
            onSelectStoreNumericId={(targetNumericId) => {
              const found = stores.find((s) => Number(s.id) === Number(targetNumericId))
              if (found) {
                setStoreId(found.external_id || String(found.id))
              } else {
                setStoreId(String(targetNumericId))
              }
            }}
          />

          <div className="flex justify-center pt-2">
            <button
              type="button"
              onClick={() => setShowTechnicalDetail((prev) => !prev)}
              className="px-4 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 shadow-sm cursor-pointer"
            >
              {showTechnicalDetail
                ? t('food_cost.fridge_meter.hide_advanced_btn')
                : t('food_cost.fridge_meter.show_advanced_btn')}
            </button>
          </div>

          {showTechnicalDetail && (
            <>
              {/* SPOTLIGHT BANNER: Selected Meat Cost & Physical vs POS Mass-Balance */}
              <div className="rounded-2xl border-2 border-red-500/40 bg-gradient-to-r from-slate-950 via-red-950 to-slate-900 text-white p-5 shadow-lg space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase bg-red-600 text-white">
                    <Flame className="w-3.5 h-3.5" />
                    {data.ingredientName} · {data.storeName}
                  </span>
                  <span className="text-xs text-red-200 font-mono">
                    {formatSignedUSD(data.bagCostStore)} / {isEn ? `bag (${bagWeight} lb)` : `bolsa (${bagWeight} lb)`} ·{' '}
                    {formatSignedUSD(data.costPerRawLbStore)}/lb {isEn ? 'raw' : 'cruda'} ·{' '}
                    {formatSignedUSD(data.costPerCookedLbStore)}/lb {isEn ? 'cooked' : 'cocida'} ({data.yieldPercent}% Yield)
                  </span>
                </div>
                <p className="text-xs text-slate-300 font-mono">
                  1 Taco (1.5 oz) = <strong>{formatSignedUSD(data.tacoPortionCostStore)}</strong> · 1 Burrito (6.0 oz) ={' '}
                  <strong>{formatSignedUSD(data.burritoPortionCostStore)}</strong> · 1 {isEn ? 'Bag yields' : 'Bolsa rinde'}{' '}
                  <strong>{data.tacosPerBag}</strong> tacos / <strong>{data.burritosPerBag}</strong> burritos (Bodega:{' '}
                  {formatSignedUSD(data.costPerRawLbBodega)}/lb)
                </p>
              </div>

              {storeId !== 'all' && data.escaleraDeMando && (
                <button
                  type="button"
                  onClick={handleSendEscaleraAlert}
                  disabled={sendingAlert}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black shadow-md disabled:opacity-50 transition-all cursor-pointer"
                >
                  {sendingAlert ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  <span>{t('food_cost.fridge_meter.send_test_alert_btn')}</span>
                </button>
              )}
            </div>

            {alertFeedback && (
              <div
                className={`p-3 rounded-xl text-xs font-bold ${
                  alertFeedback.ok
                    ? 'bg-emerald-500/20 border border-emerald-400/40 text-emerald-200'
                    : 'bg-rose-500/20 border border-rose-400/40 text-rose-200'
                }`}
              >
                {alertFeedback.text}
              </div>
            )}

            {/* 4 Spotlight KPI Tiles (Centrados en Cierre del Refrigerador vs. Toast POS) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="bg-white/10 border border-white/15 rounded-xl p-3.5">
                <span className="text-[10px] uppercase tracking-wider text-slate-300 font-bold block">
                  {t('food_cost.fridge_meter.col_toast_sold')}
                </span>
                <span className="text-2xl font-black font-mono text-cyan-300">
                  −{bagsUsed.toLocaleString()} {isEn ? 'bags' : 'bolsas'}
                </span>
                <span className="text-xs text-slate-300 block font-mono mt-0.5">
                  {data.totalRawLbs.toLocaleString()} lb {isEn ? 'raw' : 'crudas'} ·{' '}
                  {formatSignedUSD(data.theoreticalCostStore)}
                </span>
              </div>

              <div className="bg-white/10 border border-white/15 rounded-xl p-3.5">
                <span className="text-[10px] uppercase tracking-wider text-slate-300 font-bold block">
                  {t('food_cost.fridge_meter.col_expected_close')}
                </span>
                <span className="text-2xl font-black font-mono text-indigo-300">
                  {phys?.hasMeasuredSpan && phys.expectedEndingBags !== null
                    ? `${phys.expectedEndingBags.toFixed(2)} ${isEn ? 'bags' : 'bolsas'}`
                    : isEn
                      ? 'Unmeasured'
                      : 'Sin tramo físico'}
                </span>
                <span className="text-xs text-slate-300 block font-mono mt-0.5">
                  {phys?.hasMeasuredSpan
                    ? `${isEn ? 'Open' : 'Ini'} ${phys.openingBags} + ${isEn ? 'Bodega' : 'Bodega'} ${phys.arrivedBags} − Toast ${phys.spanTheoBags}`
                    : isEn
                      ? 'Requires ≥2 physical counts'
                      : 'Requiere ≥2 conteos físicos'}
                </span>
              </div>

              <div className="bg-white/10 border border-white/15 rounded-xl p-3.5">
                <span className="text-[10px] uppercase tracking-wider text-slate-300 font-bold block">
                  {t('food_cost.fridge_meter.col_close')}
                </span>
                <span className="text-2xl font-black font-mono text-amber-300">
                  {phys?.hasMeasuredSpan
                    ? `${phys.endingBags.toLocaleString()} ${isEn ? 'bags' : 'bolsas'}`
                    : '—'}
                </span>
                <span
                  className={`text-xs block font-mono font-bold mt-0.5 ${
                    !phys?.hasMeasuredSpan
                      ? 'text-slate-300'
                      : phys.fridgeBalanceBags < -0.5
                        ? 'text-rose-300'
                        : phys.fridgeBalanceBags > 0.5
                          ? 'text-sky-300'
                          : 'text-emerald-300'
                  }`}
                >
                  {phys?.hasMeasuredSpan
                    ? `${phys.fridgeBalanceBags > 0 ? `+${phys.fridgeBalanceBags}` : phys.fridgeBalanceBags}b (${formatSignedUSD(phys.fridgeBalanceDollarStore, { showPlus: phys.fridgeBalanceDollarStore > 0 })})`
                    : '—'}
                </span>
              </div>

              <div className="bg-white/10 border border-white/15 rounded-xl p-3.5">
                <span className="text-[10px] uppercase tracking-wider text-slate-300 font-bold block">
                  {isEn ? 'Real Scoop Calibration' : 'Calibración Real de Cuchara'}
                </span>
                <span
                  className={`text-2xl font-black font-mono ${
                    !phys?.hasMeasuredSpan
                      ? 'text-slate-400'
                      : phys.excessOzPerTaco > 0.1
                        ? 'text-rose-300'
                        : 'text-emerald-300'
                  }`}
                >
                  {phys?.hasMeasuredSpan ? `${phys.actualAvgOzPerTaco.toFixed(2)} oz / taco` : '1.50 oz meta'}
                </span>
                <span className="text-xs text-slate-300 block font-mono mt-0.5">
                  {phys?.hasMeasuredSpan
                    ? `${phys.excessOzPerTaco > 0 ? `+${phys.excessOzPerTaco}` : phys.excessOzPerTaco} oz/taco · ${phys.actualAvgOzPerBurrito.toFixed(2)} oz/burrito`
                    : isEn
                      ? 'Target: 1.50 oz taco / 6.00 oz burrito'
                      : 'Meta: 1.50 oz taco / 6.00 oz burrito'}
                </span>
              </div>
            </div>

            {phys?.wipCoolerNote && (
              <div className="text-[11px] text-amber-200 bg-amber-500/15 border border-amber-400/30 rounded-lg px-3 py-2 flex items-center gap-2">
                <Clock className="w-4 h-4 flex-shrink-0" />
                <span>
                  {isEn
                    ? `Short span (${phys.spanDays}d): Daily Order captures sealed-bag leftovers only (open bags in use are not counted). Use 7D/14D/30D to dilute single-bag boundary effects.`
                    : `Ventana corta (${phys.spanDays}d): Orden Diaria captura únicamente sobrantes de bolsas cerradas (las bolsas abiertas no se cuentan). Usa 7D/14D/30D para diluir el efecto de la bolsa abierta.`}
                </span>
              </div>
            )}
          </div>

          {/* AM vs PM SHIFT ATTRIBUTION CARDS + ESCALERA DE MANDO & 5:00 PM HANDOVER */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* TURNO AM CARD */}
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-amber-200 dark:border-amber-800/60 p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <span className="p-2 rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                    <Sun className="w-5 h-5" />
                  </span>
                  <div>
                    <h3 className="text-sm font-black text-slate-900 dark:text-white">
                      {isEn ? 'AM Shift (06:00 AM – 04:59 PM)' : 'Turno AM (06:00 AM – 04:59 PM)'}
                    </h3>
                    <span className="text-[11px] text-slate-500 font-mono">
                      {data.shiftBreakdown.am.sharePct}% {isEn ? 'of daily volume' : 'del volumen POS'}
                    </span>
                  </div>
                </div>
                {data.shiftBreakdown.dominantShift === 'AM' && (phys?.dollarLossStore || 0) > 0 && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-black bg-rose-100 text-rose-800 border border-rose-300">
                    {isEn ? 'Primary Exposure' : 'Mayor Exposición'}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2.5 text-xs font-mono bg-slate-50 dark:bg-slate-800/60 p-3 rounded-lg">
                <div>
                  <span className="text-[10px] uppercase text-slate-400 block font-sans font-bold">
                    {isEn ? 'POS Theoretical' : 'Teórico POS AM'}
                  </span>
                  <strong className="text-base text-slate-900 dark:text-white">
                    {data.shiftBreakdown.am.theoBags} {isEn ? 'bags' : 'bolsas'}
                  </strong>
                  <span className="block text-[11px] text-slate-500">{data.shiftBreakdown.am.theoRawLbs} lb</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase text-slate-400 block font-sans font-bold">
                    {data.shiftBreakdown.attributionMode === 'exact_5pm_handover'
                      ? isEn
                        ? 'Exact 5PM Physical'
                        : 'Real Físico (Corte 5PM)'
                      : isEn
                        ? 'Weighted Variance $'
                        : 'Exposición Ponderada $'}
                  </span>
                  <strong
                    className={`text-base ${
                      data.shiftBreakdown.am.attributedDollarLossStore > 0 ? 'text-rose-600' : 'text-emerald-600'
                    }`}
                  >
                    {phys?.hasMeasuredSpan || data.shiftBreakdown.am.actualBags !== null
                      ? formatSignedUSD(data.shiftBreakdown.am.attributedDollarLossStore, {
                          showPlus: data.shiftBreakdown.am.attributedDollarLossStore > 0,
                        })
                      : '—'}
                  </strong>
                  {data.shiftBreakdown.am.actualBags !== null && (
                    <span className="block text-[11px] text-slate-500">
                      {isEn ? 'Used:' : 'Usado:'} {data.shiftBreakdown.am.actualBags}b
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-2 text-xs">
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-400 block mb-1">
                    {isEn ? 'On-Duty AM Leaders' : 'Encargados Turno AM (Gerente / Asistente)'}
                  </span>
                  {data.shiftBreakdown.am.leaders.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {data.shiftBreakdown.am.leaders.map((l, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/50 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-800 font-semibold text-[11px]"
                        >
                          {l.name} ({l.shiftsCount}d)
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[11px] text-slate-400 italic">
                      {storeId === 'all'
                        ? isEn
                          ? 'Select a store to view staff'
                          : 'Selecciona una sucursal para ver responsables'
                        : isEn
                          ? 'No AM schedule registered'
                          : 'Sin horario AM registrado'}
                    </span>
                  )}
                </div>

                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-400 block mb-1">
                    {isEn ? 'On-Duty AM Taqueros / Grill Cooks' : 'Taqueros / Parrilleros Turno AM (Toast Punches)'}
                  </span>
                  {data.shiftBreakdown.am.taqueros.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {data.shiftBreakdown.am.taqueros.map((tq, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200 border border-amber-200 dark:border-amber-800 font-semibold text-[11px]"
                        >
                          🔪 {tq.name} · {tq.role} ({tq.hours}h)
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[11px] text-slate-400 italic">
                      {storeId === 'all' ? '—' : isEn ? 'No AM grill punches found' : 'Sin ponches de parrilla AM'}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* TURNO PM CARD */}
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-indigo-200 dark:border-indigo-800/60 p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <span className="p-2 rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                    <Moon className="w-5 h-5" />
                  </span>
                  <div>
                    <h3 className="text-sm font-black text-slate-900 dark:text-white">
                      {isEn ? 'PM Shift (05:00 PM – 05:59 AM)' : 'Turno PM (05:00 PM – 05:59 AM)'}
                    </h3>
                    <span className="text-[11px] text-slate-500 font-mono">
                      {data.shiftBreakdown.pm.sharePct}% {isEn ? 'of daily volume' : 'del volumen POS'}
                    </span>
                  </div>
                </div>
                {data.shiftBreakdown.dominantShift === 'PM' && (phys?.dollarLossStore || 0) > 0 && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-black bg-rose-100 text-rose-800 border border-rose-300">
                    {isEn ? 'Primary Exposure' : 'Mayor Exposición'}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2.5 text-xs font-mono bg-slate-50 dark:bg-slate-800/60 p-3 rounded-lg">
                <div>
                  <span className="text-[10px] uppercase text-slate-400 block font-sans font-bold">
                    {isEn ? 'POS Theoretical' : 'Teórico POS PM'}
                  </span>
                  <strong className="text-base text-slate-900 dark:text-white">
                    {data.shiftBreakdown.pm.theoBags} {isEn ? 'bags' : 'bolsas'}
                  </strong>
                  <span className="block text-[11px] text-slate-500">{data.shiftBreakdown.pm.theoRawLbs} lb</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase text-slate-400 block font-sans font-bold">
                    {data.shiftBreakdown.attributionMode === 'exact_5pm_handover'
                      ? isEn
                        ? 'Exact 5PM Physical'
                        : 'Real Físico (Corte 5PM)'
                      : isEn
                        ? 'Weighted Variance $'
                        : 'Exposición Ponderada $'}
                  </span>
                  <strong
                    className={`text-base ${
                      data.shiftBreakdown.pm.attributedDollarLossStore > 0 ? 'text-rose-600' : 'text-emerald-600'
                    }`}
                  >
                    {phys?.hasMeasuredSpan || data.shiftBreakdown.pm.actualBags !== null
                      ? formatSignedUSD(data.shiftBreakdown.pm.attributedDollarLossStore, {
                          showPlus: data.shiftBreakdown.pm.attributedDollarLossStore > 0,
                        })
                      : '—'}
                  </strong>
                  {data.shiftBreakdown.pm.actualBags !== null && (
                    <span className="block text-[11px] text-slate-500">
                      {isEn ? 'Used:' : 'Usado:'} {data.shiftBreakdown.pm.actualBags}b
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-2 text-xs">
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-400 block mb-1">
                    {isEn ? 'On-Duty PM Leaders' : 'Encargados Turno PM / Cierre'}
                  </span>
                  {data.shiftBreakdown.pm.leaders.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {data.shiftBreakdown.pm.leaders.map((l, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/50 text-indigo-800 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-800 font-semibold text-[11px]"
                        >
                          {l.name} ({l.shiftsCount}d)
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[11px] text-slate-400 italic">
                      {storeId === 'all'
                        ? isEn
                          ? 'Select a store to view staff'
                          : 'Selecciona una sucursal para ver responsables'
                        : isEn
                          ? 'No PM schedule registered'
                          : 'Sin horario PM registrado'}
                    </span>
                  )}
                </div>

                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-400 block mb-1">
                    {isEn ? 'On-Duty PM Taqueros / Grill Cooks' : 'Taqueros / Parrilleros Turno PM (Toast Punches)'}
                  </span>
                  {data.shiftBreakdown.pm.taqueros.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {data.shiftBreakdown.pm.taqueros.map((tq, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-0.5 rounded-md bg-purple-50 dark:bg-purple-950/50 text-purple-900 dark:text-purple-200 border border-purple-200 dark:border-purple-800 font-semibold text-[11px]"
                        >
                          🔪 {tq.name} · {tq.role} ({tq.hours}h)
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[11px] text-slate-400 italic">
                      {storeId === 'all' ? '—' : isEn ? 'No PM grill punches found' : 'Sin ponches de parrilla PM'}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* 5:00 PM SHIFT HANDOVER FORM + ESCALERA DE MANDO */}
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <ClipboardCheck className="w-5 h-5 text-emerald-600" />
                  <div>
                    <h3 className="text-sm font-black text-slate-900 dark:text-white">
                      {isEn ? '5:00 PM Shift Handover Check' : 'Corte de Bolsas 5:00 PM (AM → PM)'}
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      {isEn
                        ? 'Isolates exact AM vs PM physical meat bags'
                        : 'Separa con exactitud las bolsas gastadas en AM vs PM'}
                    </p>
                  </div>
                </div>
              </div>

              {storeId === 'all' ? (
                <p className="text-xs text-slate-500 bg-slate-50 dark:bg-slate-800 p-3 rounded-lg">
                  {isEn
                    ? 'Select a specific store above to log the 5:00 PM cooler bag handover or view its Chain of Command.'
                    : 'Selecciona una sucursal específica arriba para capturar el corte de las 5:00 PM y ver su Escalera de Mando.'}
                </p>
              ) : (
                <>
                  <form onSubmit={handleSave5PmHandover} className="space-y-2.5 text-xs">
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                          {isEn ? 'Date' : 'Fecha'}
                        </label>
                        <input
                          type="date"
                          value={handoverDate}
                          onChange={(e) => setHandoverDate(e.target.value)}
                          className="w-full px-2 py-1.5 border rounded-lg bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 font-mono text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                          {isEn ? 'Sealed Bags' : 'Bolsas Selladas'}
                        </label>
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          placeholder="0"
                          value={sealedBagsInput}
                          onChange={(e) => setSealedBagsInput(e.target.value)}
                          className="w-full px-2 py-1.5 border rounded-lg bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 font-mono font-bold text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                          {isEn ? 'Open Lbs' : 'Lbs Abiertas'}
                        </label>
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          placeholder="0"
                          value={openCookedLbsInput}
                          onChange={(e) => setOpenCookedLbsInput(e.target.value)}
                          className="w-full px-2 py-1.5 border rounded-lg bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 font-mono text-xs"
                        />
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder={isEn ? 'Optional note (e.g. 2 pans marinating)' : 'Nota opcional (ej. 2 charolas marinadas)'}
                        value={handoverNotes}
                        onChange={(e) => setHandoverNotes(e.target.value)}
                        className="flex-1 px-2.5 py-1.5 border rounded-lg bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-xs"
                      />
                      <button
                        type="submit"
                        disabled={savingHandover}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs disabled:opacity-50 cursor-pointer"
                      >
                        {savingHandover ? '...' : isEn ? 'Save 5PM' : 'Guardar 5PM'}
                      </button>
                    </div>
                  </form>

                  {handoverFeedback && (
                    <div
                      className={`p-2 rounded-lg text-[11px] font-semibold ${
                        handoverFeedback.ok
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : 'bg-red-50 text-red-800 border border-red-200'
                      }`}
                    >
                      {handoverFeedback.text}
                    </div>
                  )}

                  {data.escaleraDeMando && (
                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1 text-[11px]">
                      <span className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-1">
                        <Users className="w-3.5 h-3.5" />
                        {isEn ? 'Store Chain of Command' : 'Escalera de Mando de la Sucursal'}
                      </span>
                      <p className="text-slate-700 dark:text-slate-300">
                        <strong>{isEn ? 'Manager:' : 'Gerente:'}</strong>{' '}
                        {data.escaleraDeMando.manager
                          ? `${data.escaleraDeMando.manager.name} (${data.escaleraDeMando.manager.email})`
                          : '—'}
                      </p>
                      <p className="text-slate-700 dark:text-slate-300">
                        <strong>{isEn ? 'Assistants:' : 'Asistentes:'}</strong>{' '}
                        {data.escaleraDeMando.assistants.length > 0
                          ? data.escaleraDeMando.assistants.map((a) => a.name).join(', ')
                          : '—'}
                      </p>
                      <p className="text-slate-700 dark:text-slate-300">
                        <strong>{isEn ? 'Supervisor:' : 'Supervisor:'}</strong>{' '}
                        {data.escaleraDeMando.supervisor
                          ? `${data.escaleraDeMando.supervisor.name} (${data.escaleraDeMando.supervisor.email})`
                          : '—'}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
            </>
          )}
        </>
      )}

      {/* 4-Step Chain of Command (Escalera de Mando) Action Panel: Acknowledge / Coaching / Supervisor Verify */}
      {showTechnicalDetail && initialReady && (
        <PortionControlAlertsPanel
          key={alertsPanelKey}
          storeId={resolvedAlertsStoreId}
          startDate={startDate}
          endDate={endDate}
        />
      )}

      {showTechnicalDetail && data && (
        <>
          {/* BOTTOM SECTION: Quick Manual Bag Comparator + Product Breakdown Table */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1 space-y-4">
              {/* Auditoría Rápida Manual */}
              <div className="bg-white dark:bg-slate-900 p-5 rounded-xl shadow-sm border-l-4 border-l-blue-500 border-y border-r border-slate-200 dark:border-slate-800 space-y-3">
                <h3 className="text-sm font-black text-slate-800 dark:text-white uppercase flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-blue-500" />
                  {isEn ? 'Quick Freezer-Bag Simulator' : 'Simulador Rápido de Bolsas'}
                </h3>
                <p className="text-xs text-slate-500">
                  {isEn
                    ? `Compare physical ${bagWeight} lb bags pulled vs ${bagsUsed.toFixed(1)} POS bags:`
                    : `Compara bolsas reales de ${bagWeight} lb sacadas vs ${bagsUsed.toFixed(1)} bolsas teóricas POS:`}
                </p>
                <div className="flex gap-2 items-center">
                  <input
                    type="number"
                    step="0.5"
                    placeholder="0.0"
                    className="w-28 p-2 text-right text-base font-bold border rounded-lg bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 outline-none dark:text-white font-mono"
                    value={actualBagsInput}
                    onChange={(e) => setActualBagsInput(e.target.value)}
                  />
                  <span className="text-xs font-bold text-slate-600 dark:text-slate-400">
                    {isEn ? `Real Bags (${bagWeight} lb)` : `Bolsas Reales (${bagWeight} lb)`}
                  </span>
                </div>

                {manualBagDiff !== null && (
                  <div
                    className={`p-3.5 rounded-lg border text-xs space-y-1.5 ${
                      manualBagDiff > 0
                        ? 'bg-rose-50 border-rose-200 text-rose-900 dark:bg-rose-950/30 dark:border-rose-800 dark:text-rose-200'
                        : 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-200'
                    }`}
                  >
                    <div className="flex justify-between items-center font-mono font-black text-sm">
                      <span>{manualBagDiff > 0 ? (isEn ? 'Excess' : 'Sobre-Consumo') : isEn ? 'On Target' : 'Eficiencia'}</span>
                      <span>
                        {manualBagDiff > 0 ? '+' : ''}
                        {manualBagDiff.toFixed(1)} {isEn ? 'bags' : 'bolsas'} ({formatSignedUSD(manualDollarDiff, { showPlus: manualDollarDiff > 0 })})
                      </span>
                    </div>
                    <p>
                      {manualBagDiff > 0
                        ? bagsUsed > 0
                          ? isEn
                            ? `Used +${manualDiffPct.toFixed(1)}% above POS recipes.`
                            : `Se consumió +${manualDiffPct.toFixed(1)}% por encima de las recetas vendidas en Toast.`
                          : isEn
                            ? 'Bags consumed with 0 POS sales recorded.'
                            : 'Bolsas consumidas sin ventas registradas en POS.'
                        : isEn
                          ? 'Portioning is within ideal recipe weight.'
                          : 'El equipo está dentro del gramaje oficial de receta.'}
                    </p>
                  </div>
                )}
              </div>

              {/* Taco Equivalence & Closing Sobrante */}
              <div className="bg-slate-50 dark:bg-slate-900/60 p-5 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 space-y-2">
                <h3 className="text-xs font-black text-slate-500 uppercase">
                  {isEn ? 'Taco Portion Equivalence' : 'Equivalencia en Tacos (1.5 oz)'}
                </h3>
                <p className="text-2xl font-black text-slate-800 dark:text-slate-100 font-mono">
                  ~ {Math.round(tacosEquivalent).toLocaleString()}{' '}
                  <span className="text-xs font-sans font-normal text-slate-500">tacos</span>
                </p>
                <div className="text-[11px] text-slate-500 border-t border-slate-200 dark:border-slate-800 pt-2 space-y-1">
                  <p>
                    • 1 {isEn ? 'Bag' : 'Bolsa'} = {bagWeight} lb {isEn ? 'raw' : 'crudo'} → {data.cookedLbsPerBag} lb{' '}
                    {isEn ? 'cooked' : 'cocido'} ({data.yieldPercent}%)
                  </p>
                  <p>
                    • <strong>{data.tacosPerBag} tacos</strong> (1.5 oz) / <strong>{data.burritosPerBag} burritos</strong>{' '}
                    (6.0 oz) {isEn ? 'per bag' : 'por bolsa'}
                  </p>
                  {phys?.closingSobranteCookedLbs !== null && phys?.closingSobranteCookedLbs !== undefined && (
                    <p className="text-amber-700 dark:text-amber-400 font-semibold">
                      • {isEn ? 'Closing Cooked Sobrante:' : 'Sobrante Cocido al Cierre:'} {phys.closingSobranteCookedLbs} lb (
                      {phys.closingSobranteDate})
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Product Breakdown Table */}
            <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col">
              <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex justify-between items-center">
                <h3 className="font-bold text-sm text-slate-800 dark:text-slate-200">
                  {isEn
                    ? 'POS Dish & Modifier Breakdown (incl. Party Trays, Half & Extra Meat)'
                    : 'Desglose por Platillo y Modificador en Toast POS (incl. Party Trays, Mitad y Extra Carne)'}
                </h3>
                <span className="text-xs text-slate-400 font-mono">{data.breakdown.length} items</span>
              </div>
              <div className="overflow-x-auto max-h-[540px] overflow-y-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 uppercase font-black border-b dark:border-slate-700 sticky top-0">
                    <tr>
                      <th className="px-4 py-3">{t('food_cost.table.product') || (isEn ? 'Menu Item' : 'Platillo')}</th>
                      <th className="px-3 py-3 text-right">{t('food_cost.table.quantity') || (isEn ? 'Sold' : 'Vendidos')}</th>
                      <th className="px-3 py-3 text-right">{isEn ? 'Portion' : 'Porción'}</th>
                      <th className="px-3 py-3 text-right">{isEn ? 'Raw Lbs' : 'Lbs Crudas'}</th>
                      <th className="px-3 py-3 text-right">{isEn ? 'Meat Cost' : 'Costo Carne'}</th>
                      <th className="px-3 py-3 text-right">{isEn ? 'Net Sales' : 'Venta Neta'}</th>
                      <th className="px-3 py-3 text-right">{t('food_cost.table.profit') || (isEn ? 'Gross Margin' : 'Utilidad')}</th>
                      <th className="px-3 py-3 text-right">% Uso</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {data.breakdown.map((item, idx) => {
                      const sharePct = data.totalRawLbs > 0 ? (item.rawLbs / data.totalRawLbs) * 100 : 0
                      return (
                        <tr key={`${item.guid}-${idx}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="px-4 py-2.5 font-semibold text-slate-900 dark:text-slate-100">{item.itemName}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-slate-600 dark:text-slate-400">
                            {item.soldQty.toLocaleString()}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-slate-500">
                            {item.portionQty} {item.unit}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono font-bold text-slate-900 dark:text-white">
                            {item.rawLbs.toFixed(2)}
                          </td>
                          <td className="px-3 py-2.5 text-right text-rose-600 font-mono">
                            {formatSignedUSD(item.costAmount || 0)}
                          </td>
                          <td className="px-3 py-2.5 text-right text-blue-600 font-mono">
                            {formatSignedUSD(item.salesAmount || 0)}
                          </td>
                          <td className="px-3 py-2.5 text-right text-emerald-600 font-bold font-mono">
                            {formatSignedUSD(item.utilityAmount || 0)}
                          </td>
                          <td className="px-3 py-2.5 text-right text-slate-400 font-mono">{sharePct.toFixed(1)}%</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot className="bg-slate-50 dark:bg-slate-900 border-t-2 border-slate-200 dark:border-slate-700 font-black text-xs sticky bottom-0">
                    <tr>
                      <td className="px-4 py-3 text-slate-900 dark:text-white">
                        {t('food_cost.table.total') || 'TOTAL'}
                      </td>
                      <td className="px-3 py-3 text-right font-mono">
                        {data.breakdown.reduce((sum, i) => sum + i.soldQty, 0).toLocaleString()}
                      </td>
                      <td className="px-3 py-3"></td>
                      <td className="px-3 py-3 text-right font-mono text-slate-900 dark:text-white">
                        {data.totalRawLbs.toLocaleString('en-US', { maximumFractionDigits: 2 })} lb
                      </td>
                      <td className="px-3 py-3 text-right text-rose-600 font-mono">
                        {formatSignedUSD(data.breakdown.reduce((sum, i) => sum + (i.costAmount || 0), 0))}
                      </td>
                      <td className="px-3 py-3 text-right text-blue-600 font-mono">
                        {formatSignedUSD(data.breakdown.reduce((sum, i) => sum + (i.salesAmount || 0), 0))}
                      </td>
                      <td className="px-3 py-3 text-right text-emerald-600 font-mono">
                        {formatSignedUSD(data.breakdown.reduce((sum, i) => sum + (i.utilityAmount || 0), 0))}
                      </td>
                      <td className="px-3 py-3 text-right font-mono">{data.totalRawLbs > 0 ? '100.0%' : '0.0%'}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function MeatPageSuspenseFallback() {
  const { t } = useLanguage()
  return (
    <div className="p-8 max-w-[1650px] mx-auto flex items-center justify-center gap-2 text-slate-500 text-sm font-bold">
      <Loader2 className="w-5 h-5 text-red-600 animate-spin" />
      <span>{t('food_cost.loading')}</span>
    </div>
  )
}

export default function MeatAnalysisPage() {
  return (
    <Suspense fallback={<MeatPageSuspenseFallback />}>
      <MeatAnalysisPageContent />
    </Suspense>
  )
}
