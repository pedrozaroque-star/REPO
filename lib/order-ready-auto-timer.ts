/**
 * @module lib/order-ready-auto-timer
 * @description Motor isomórfico (cliente y servidor) de Timer Inteligente Manos Libres (Smart Adaptive Auto-Call Timer)
 * para el llamado automático por voz de órdenes en preparación sin que los cocineros toquen ni ensucien la tableta.
 *
 * @businessRules
 * - **Dos Modos Operativos por Sucursal (`AutoCallMode`)**:
 *   1. `'manual'` (Modo Manual — Por defecto en las 14 sucursales restantes): El llamado de voz ocurre únicamente cuando el
 *      preparador toca la tarjeta en `/inventory/preparador` o el manager pulsa "Llamar" en `/order-ready-board`.
 *   2. `'smart'` (Timer Inteligente Adaptativo — Activo actualmente en piloto exclusivo para **`SLAUSON`**): El sistema calcula
 *      automáticamente la cuenta regresiva óptima según la complejidad real de los platillos en cocina y la fila activa delante
 *      en el Toast KDS, disparando el anuncio de voz bilingüe al llegar a `0:00` sin tocar la pantalla.
 * - **Calibración Basada en Datos Reales de Cocina (7,462 órdenes auditadas en Slauson)**:
 *   - **Nivel 1 (`fast` = 165 s / 2m 45s)**: 1 a 4 tacos de parrilla rápida (Asada, Pollo, Pastor, Cabeza, Lengua) o complementos rápidos
 *     (arroz, frijol, guacamole, chips, tortillas) sin platillos medianos ni complejos.
 *   - **Nivel 2 (`medium` = 255 s / 4m 15s)**: Burritos, Quesadillas, Mulitas, Sopes, Vampiros, Carnitas, órdenes de 5 a 9 tacos,
 *     o respaldo seguro cuando `items_summary` aún no ha llegado desde Toast.
 *   - **Nivel 3 (`complex` = 330 s / 5m 30s)**: Platos / Combos, Tortas (incluyendo Cubana y Milanesa), Nachos / Super Nachos / Fries,
 *     proteínas cocinadas al momento bajo demanda (`Buche`, `Chorizo`, `Milanesa`), Desayunos / Huevos / Chilaquiles / Menudo,
 *     Party Trays / Charolas, o cualquier comanda grande de **10 o más platillos de cocina**.
 * - **Ajuste Dinámico por Carga de Fila en KDS (`perOrderAheadSec` = +20 s por orden delante, tope `maxCapSec` = 540 s / 9m 00s)**:
 *   - Usa el índice FIFO `0`-based (`queueIndexAhead`) de comandas activas delante en `compareOrdersKdsFifo`.
 *   - Las órdenes nuevas que entran *detrás* nunca retrasan a las órdenes anteriores; además, escalona naturalmente los llamados
 *     por altavoz cuando entran varias órdenes seguidas en hora pico.
 * - **Blindajes Operativos**:
 *   - Las bebidas y postres (`isDrinkOrDessertItem`) y marcadores POS/Gift Cards (`isNonFoodMarkerItem`) se excluyen del conteo de cocina.
 *   - Si la orden ya fue entregada/cerrada en el KDS (`status !== 'IN_PROGRESS'`) o ya fue llamada manualmente (`announced_at !== null`),
 *     el timer automático se cancela de inmediato para jamás anunciar una orden ya entregada ni duplicar llamados.
 *
 * @dataFlow
 * - Configuración persistida en `order_ready_settings` (`id = 'auto_call_timer_config'`) -> `/api/order-ready/settings` + Supabase Realtime
 *   -> `/order-ready-board` (ejecutor primario + panel Admin) y `/inventory/preparador` (indicador visual + respaldo atómico)
 *   -> `POST /api/order-ready/call` (`autoTimerOnlyIfUnannounced: true`).
 *
 * @notes
 * - Cero dependencias de Node.js (`fs`, `path`, etc.): 100% compatible con Client Components (`'use client'`) y Route Handlers.
 * - Piloto inicial (2026-11-10): Exclusivamente `SLAUSON` inicia en modo `'smart'`; las otras 14 tiendas permanecen en `'manual'`.
 */

import { isDrinkOrDessertItem, isNonFoodMarkerItem, normalizeItemText } from '@/lib/order-ready-filter'

export type AutoCallMode = 'manual' | 'smart'
export type SmartDishTier = 'fast' | 'medium' | 'complex'

export interface AutoCallTimerConfig {
  /** Mapa por código de sucursal en mayúsculas (ej. { SLAUSON: 'smart' }). Las no listadas operan en 'manual'. */
  storeModes: Record<string, AutoCallMode>
  /** Segundos base Nivel 1: 1–4 tacos de parrilla / complementos rápidos (default: 165s = 2m 45s). */
  fastSec: number
  /** Segundos base Nivel 2: Burrito, Quesadilla, Mulita, Sope, Carnitas o 5–9 tacos (default: 255s = 4m 15s). */
  mediumSec: number
  /** Segundos base Nivel 3: Plato, Torta, Nachos, Buche/Chorizo/Milanesa al momento o 10+ unidades (default: 330s = 5m 30s). */
  complexSec: number
  /** Segundos extra por cada comanda activa delante en la fila FIFO del KDS (default: 20s). */
  perOrderAheadSec: number
  /** Tope máximo total en segundos (default: 540s = 9m 00s). */
  maxCapSec: number
}

export interface SmartOrderClassification {
  tier: SmartDishTier
  foodUnits: number
}

export interface SmartOrderAutoCallPlan {
  tier: SmartDishTier
  foodUnits: number
  baseSec: number
  queueIndexAhead: number
  queueBonusSec: number
  totalSec: number
  createdAtMs: number
  targetCallAtMs: number
  remainingMs: number
  remainingSec: number
}

/**
 * Configuración canónica por defecto:
 * ÚNICAMENTE la sucursal piloto `SLAUSON` tiene `'smart'` activo; las otras 14 sucursales operan en `'manual'`.
 */
export const DEFAULT_AUTO_CALL_TIMER_CONFIG: AutoCallTimerConfig = {
  storeModes: {
    SLAUSON: 'smart'
  },
  fastSec: 165,
  mediumSec: 255,
  complexSec: 330,
  perOrderAheadSec: 20,
  maxCapSec: 540
}

/**
 * Ventana máxima de gracia tras llegar a 0:00 (45 segundos) para órdenes no observadas previamente en cuenta regresiva.
 * Evita avalanchas de voz sobre órdenes antiguas si se abre el navegador o se activa el modo a mitad del turno.
 */
export const AUTO_CALL_MAX_UNOBSERVED_OVERDUE_MS = 45_000

const COMPLEX_DISH_PATTERNS: RegExp[] = [
  /\bplatos?\b/i,
  /\bplates?\b/i,
  /\bcombos?\b/i,
  /\btortas?\b/i,
  /\bcubanas?\b/i,
  /\bmilanesas?\b/i,
  /\bmilanezas?\b/i,
  /\bnachos?\b/i,
  /\bfries\b/i,
  /\bpapas\b/i,
  /\balambres?\b/i,
  /\bfajitas?\b/i,
  /\bhuevos?\b/i,
  /\beggs?\b/i,
  /\bdesayunos?\b/i,
  /\bbreakfast\b/i,
  /\bchilaquiles\b/i,
  /\bmenudo\b/i,
  /\bpozole\b/i,
  /\bparty\s*trays?\b/i,
  /\bcharolas?\b/i,
  /\b\d+\s*-\s*\d+\s*(people|personas)\b/i,
  // Proteínas cocinadas al momento bajo demanda en Tacos Gavilan (no están pre-cocidas en charola de parrilla)
  /\bchorizo\b/i,
  /\bbuche\b/i
]

const MEDIUM_DISH_PATTERNS: RegExp[] = [
  /\bburritos?\b/i,
  /\bquesadillas?\b/i,
  /\bmulitas?\b/i,
  /\bsopes?\b/i,
  /\bvampiros?\b/i,
  /\bgorditas?\b/i,
  /\bhuaraches?\b/i,
  /\bflautas?\b/i,
  /\btaquitos?\b/i,
  /\bcarnitas\b/i
]

const FAST_DISH_PATTERNS: RegExp[] = [
  /\btacos?\b/i,
  /\brice\b/i,
  /\barroz\b/i,
  /\bbeans?\b/i,
  /\bfrijol(es)?\b/i,
  /\bguacamole\b/i,
  /\bchips?\b/i,
  /\btortillas?\b/i
]

function clampInt(val: unknown, fallback: number, min: number, max: number): number {
  const num = typeof val === 'number' ? val : Number(val)
  if (!Number.isFinite(num)) return fallback
  return Math.max(min, Math.min(max, Math.round(num)))
}

/**
 * Sanitiza cualquier objeto JSON proveniente de BD, API o cliente garantizando tipos seguros,
 * límites numéricos válidos y códigos de tienda normalizados en mayúsculas.
 */
export function sanitizeAutoCallTimerConfig(raw: unknown): AutoCallTimerConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ...DEFAULT_AUTO_CALL_TIMER_CONFIG,
      storeModes: { ...DEFAULT_AUTO_CALL_TIMER_CONFIG.storeModes }
    }
  }

  const obj = raw as Record<string, unknown>
  const fastSec = clampInt(obj.fastSec, DEFAULT_AUTO_CALL_TIMER_CONFIG.fastSec, 45, 600)
  const mediumSec = clampInt(obj.mediumSec, DEFAULT_AUTO_CALL_TIMER_CONFIG.mediumSec, Math.max(60, fastSec), 720)
  const complexSec = clampInt(obj.complexSec, DEFAULT_AUTO_CALL_TIMER_CONFIG.complexSec, Math.max(90, mediumSec), 900)
  const perOrderAheadSec = clampInt(obj.perOrderAheadSec, DEFAULT_AUTO_CALL_TIMER_CONFIG.perOrderAheadSec, 0, 120)
  const maxCapSec = clampInt(
    obj.maxCapSec,
    DEFAULT_AUTO_CALL_TIMER_CONFIG.maxCapSec,
    Math.max(120, complexSec),
    1200
  )

  let storeModes: Record<string, AutoCallMode>
  if (obj.storeModes && typeof obj.storeModes === 'object' && !Array.isArray(obj.storeModes)) {
    storeModes = {}
    for (const [k, v] of Object.entries(obj.storeModes as Record<string, unknown>)) {
      const code = String(k || '').trim().toUpperCase()
      if (!code || !/^[A-Z0-9_]{2,24}$/.test(code)) continue
      if (v === 'smart' || v === 'manual') {
        storeModes[code] = v
      }
    }
  } else {
    storeModes = { ...DEFAULT_AUTO_CALL_TIMER_CONFIG.storeModes }
  }

  return {
    storeModes,
    fastSec,
    mediumSec,
    complexSec,
    perOrderAheadSec,
    maxCapSec
  }
}

/**
 * Obtiene el modo operativo ('manual' | 'smart') de una tienda específica.
 * Cualquier tienda no configurada explícitamente como 'smart' opera estrictamente en 'manual'.
 */
export function getStoreAutoCallMode(
  config: AutoCallTimerConfig | null | undefined,
  storeCode: string | null | undefined
): AutoCallMode {
  const code = String(storeCode || '').trim().toUpperCase()
  if (!code) return 'manual'
  const effective = config || DEFAULT_AUTO_CALL_TIMER_CONFIG
  return effective.storeModes?.[code] === 'smart' ? 'smart' : 'manual'
}

/**
 * Indica si el Timer Inteligente Manos Libres está habilitado para la sucursal dada.
 */
export function isStoreSmartAutoCallEnabled(
  config: AutoCallTimerConfig | null | undefined,
  storeCode: string | null | undefined
): boolean {
  return getStoreAutoCallMode(config, storeCode) === 'smart'
}

/**
 * Devuelve la lista ordenada de códigos de tienda que tienen `'smart'` habilitado.
 */
export function getSmartEnabledStoreCodes(config: AutoCallTimerConfig | null | undefined): string[] {
  const effective = config || DEFAULT_AUTO_CALL_TIMER_CONFIG
  return Object.entries(effective.storeModes || {})
    .filter(([, mode]) => mode === 'smart')
    .map(([code]) => code)
    .sort()
}

/**
 * Clasifica una comanda en Nivel 1 (`fast`), Nivel 2 (`medium`) o Nivel 3 (`complex`)
 * analizando platillos y modificadores reales de cocina e ignorando bebidas/postres/marcadores POS.
 */
export function classifyOrderSmartTier(itemsSummary: string | null | undefined | any[]): SmartOrderClassification {
  if (!itemsSummary) {
    return { tier: 'medium', foodUnits: 0 }
  }

  let parsed: any[] = []
  if (typeof itemsSummary === 'string') {
    const trimmed = itemsSummary.trim()
    if (!trimmed) return { tier: 'medium', foodUnits: 0 }
    try {
      const json = JSON.parse(trimmed)
      if (Array.isArray(json)) parsed = json
      else return { tier: 'medium', foodUnits: 0 }
    } catch {
      return { tier: 'medium', foodUnits: 0 }
    }
  } else if (Array.isArray(itemsSummary)) {
    parsed = itemsSummary
  }

  if (parsed.length === 0) {
    return { tier: 'medium', foodUnits: 0 }
  }

  let totalFoodUnits = 0
  let hasComplexItem = false
  let hasMediumItem = false
  let hasUnknownFoodItem = false

  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const rawName = String(item.name || item.displayName || '').trim()
    if (!rawName) continue
    if (isNonFoodMarkerItem(rawName) || isDrinkOrDessertItem(rawName)) continue

    const rawQty = item.quantity !== undefined && item.quantity !== null ? item.quantity : item.qty
    const parsedQty = rawQty === undefined || rawQty === null || rawQty === '' ? 1 : Number(rawQty)
    if (!Number.isFinite(parsedQty) || parsedQty <= 0) continue

    totalFoodUnits += parsedQty

    const modStr = Array.isArray(item.modifiers)
      ? item.modifiers.map((m: any) => (typeof m === 'object' ? m?.displayName || m?.name || '' : String(m || ''))).join(' ')
      : ''
    const combinedNorm = normalizeItemText(`${rawName} ${modStr}`)
    const nameNorm = normalizeItemText(rawName)

    if (COMPLEX_DISH_PATTERNS.some((p) => p.test(combinedNorm))) {
      hasComplexItem = true
    } else if (MEDIUM_DISH_PATTERNS.some((p) => p.test(combinedNorm))) {
      hasMediumItem = true
    } else if (!FAST_DISH_PATTERNS.some((p) => p.test(nameNorm))) {
      hasUnknownFoodItem = true
    }
  }

  if (totalFoodUnits <= 0) {
    return { tier: 'medium', foodUnits: 0 }
  }

  // 10 o más platillos de cocina o presencia de platillo complejo / proteína al momento -> Nivel 3 (Compleja)
  if (hasComplexItem || totalFoodUnits >= 10) {
    return { tier: 'complex', foodUnits: totalFoodUnits }
  }

  // Presencia de Burrito / Quesadilla / Mulita / Sope / Carnitas, ítem no catalogado o 5–9 tacos -> Nivel 2 (Media)
  if (hasMediumItem || hasUnknownFoodItem || totalFoodUnits >= 5) {
    return { tier: 'medium', foodUnits: totalFoodUnits }
  }

  // 1 a 4 tacos de parrilla o complementos rápidos -> Nivel 1 (Rápida)
  return { tier: 'fast', foodUnits: totalFoodUnits }
}

/**
 * Calcula el plan exacto de cuenta regresiva y timestamp meta de llamado automático para una orden en preparación.
 */
export function computeSmartOrderAutoCallPlan(
  order: { created_at?: string | null; items_summary?: string | null | any[] },
  queueIndexAhead: number,
  config?: AutoCallTimerConfig | null,
  nowMs: number = Date.now()
): SmartOrderAutoCallPlan {
  const effective = config || DEFAULT_AUTO_CALL_TIMER_CONFIG
  const { tier, foodUnits } = classifyOrderSmartTier(order?.items_summary)

  const baseSec =
    tier === 'fast'
      ? effective.fastSec
      : tier === 'complex'
      ? effective.complexSec
      : effective.mediumSec

  const safeQueueAhead = Number.isFinite(queueIndexAhead) ? Math.max(0, Math.floor(queueIndexAhead)) : 0
  const queueBonusSec = safeQueueAhead * effective.perOrderAheadSec
  const totalSec = Math.min(effective.maxCapSec, baseSec + queueBonusSec)

  const parsedCreatedMs = order?.created_at ? Date.parse(order.created_at) : NaN
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now()
  const createdAtMs = Number.isFinite(parsedCreatedMs) ? parsedCreatedMs : safeNowMs
  const targetCallAtMs = createdAtMs + totalSec * 1000
  const remainingMs = targetCallAtMs - safeNowMs
  const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000))

  return {
    tier,
    foodUnits,
    baseSec,
    queueIndexAhead: safeQueueAhead,
    queueBonusSec,
    totalSec,
    createdAtMs,
    targetCallAtMs,
    remainingMs,
    remainingSec
  }
}

/**
 * Formatea segundos restantes en formato legible `M:SS` (ej. `165` -> `"2:45"`, `9` -> `"0:09"`).
 */
export function formatCountdownMmSs(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  const mins = Math.floor(safe / 60)
  const secs = safe % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}
