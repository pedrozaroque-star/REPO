/**
 * @module inventory/orders/utils
 * @description Funciones utilitarias y tipos compartidos para el módulo de Pedidos a Bodega.
 *              Separadas de actions.ts porque las server actions requieren que TODAS
 *              las funciones exportadas sean async.
 * @businessRules El día comercial y el lunes semanal se calculan en America/Los_Angeles
 *                con corte 6:00 AM; el pedido oficial usa PAR menos conteo físico.
 * @dataFlow Fechas, catálogo y líneas calculadas de actions.ts -> tipos/funciones puros
 *           para pantalla y servidor.
 *
 * @notes
 * - [2026-06-24] Extraído de actions.ts para resolver error de Next.js 16:
 *   "Server Actions must be async functions."
 * - [2026-09-28] Las líneas incluyen estado de fuente teórica; nunca equivale
 *   por sí solo a un pedido oficial o a un conteo físico.
 * - [2026-11-09] Unificado `getBusinessDate` y `getBusinessMonday` en `America/Los_Angeles`
 *   con `hourCycle: 'h23'` y corte 6:00 AM para evitar desincronización entre navegador y servidor.
 * - [2026-11-10] Blindaje de insumos externos `TRACK_ONLY` (`Flan`, `Whole Flan`, `Cheesecake`):
 *   excluidos de `resolveEffectiveOrderLineQty`, `buildPersistableOrderLines` y `evaluateOrderAnomalies`
 *   para impedir líneas ficticias en `inventory_order_lines` y llegadas fantasma de Bodega.
 * - [2026-11-10] Soporte nativo de `'auto_order_visible'` en las 15 sucursales: `effective_leftover`
 *   permite que la orden a QuickBooks esté pre-calculada desde el inicio con el sobrante del sistema,
 *   dando prioridad inmediata y absoluta (`100%`) a `leftover_value` en cuanto el asistente o manager
 *   captura su conteo físico.
 */

export const EXTERNAL_TRACK_ONLY_ITEM_IDS = new Set<string>([
    'f8f776c5-3b8c-453e-8161-b49840823933', // Flan
    '8ba55664-5ca9-4886-8ac8-acf1fd070713', // Cheesecake
])

export function isTrackOnlyOrderItem(input: {
    inventory_item_id?: string | null
    id?: string | null
    item_name?: string | null
    name?: string | null
    qb_item_id?: string | null
}): boolean {
    if (input.qb_item_id === 'TRACK_ONLY') return true
    const itemId = String(input.inventory_item_id || input.id || '').trim()
    if (itemId && EXTERNAL_TRACK_ONLY_ITEM_IDS.has(itemId)) return true
    const rawName = String(input.item_name || input.name || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()
    return /^(flan|whole\s+flan|cheesecake)$/.test(rawName)
}

// ============================================================================
// HELPERS
// ============================================================================

/** Obtiene el lunes de la semana de una fecha dada (calendario puro en UTC/seguro de timezone) */
export function getMonday(d: Date | string): string {
    let date: Date
    if (typeof d === 'string') {
        date = new Date(d.includes('T') ? d : `${d}T12:00:00Z`)
    } else {
        date = new Date(d)
    }
    const utcYear = date.getUTCFullYear()
    const utcMonth = date.getUTCMonth()
    const utcDate = date.getUTCDate()
    const target = new Date(Date.UTC(utcYear, utcMonth, utcDate, 12, 0, 0))
    const day = target.getUTCDay()
    const diff = target.getUTCDate() - day + (day === 0 ? -6 : 1)
    target.setUTCDate(diff)
    return target.toISOString().split('T')[0]
}

/**
 * Obtiene la fecha del día de NEGOCIO actual (`YYYY-MM-DD`) en `America/Los_Angeles`.
 * El día laboral inicia a las 6:00 AM y termina a las 5:59 AM del siguiente día.
 */
export function getBusinessDate(d: Date = new Date()): string {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    })
    const parts = formatter.formatToParts(d)
    const partMap: Record<string, string> = {}
    parts.forEach(p => { partMap[p.type] = p.value })

    const year = parseInt(partMap.year, 10)
    const month = parseInt(partMap.month, 10) - 1
    const day = parseInt(partMap.day, 10)
    const hour = parseInt(partMap.hour, 10) % 24

    const dateInLA = new Date(Date.UTC(year, month, day, 12, 0, 0))
    if (hour < 6) {
        dateInLA.setUTCDate(dateInLA.getUTCDate() - 1)
    }

    return dateInLA.toISOString().split('T')[0]
}

/**
 * Obtiene el lunes de la semana de NEGOCIO actual en America/Los_Angeles.
 * El día laboral empieza a las 6:00 AM y termina a las 5:59 AM del siguiente día.
 * Entonces lunes 1:00 AM PT = todavía es "domingo" → retorna el lunes de la semana anterior.
 */
export function getBusinessMonday(d: Date = new Date()): string {
    return getMonday(getBusinessDate(d))
}

/** Suma días a una fecha string YYYY-MM-DD */
export function addDays(dateStr: string, days: number): string {
    const d = new Date(dateStr + 'T12:00:00Z')
    d.setUTCDate(d.getUTCDate() + days)
    return d.toISOString().split('T')[0]
}

// ============================================================================
// TIPOS
// ============================================================================

export type OrderableItem = {
    id: string
    name: string
    unit_type: string
    excel_reference?: string
    order_unit_description?: string
    order_rounding_rule: string
    order_sort_position: number
    qb_item_id?: string
    purchase_unit_cost?: number
    unit_measure?: string
}

export type WeeklyBaseRecord = {
    inventory_item_id: string
    mon_par: number
    tue_par: number
    wed_par: number
    thu_par: number
    fri_par: number
    sat_par: number
    sun_par: number
}

export type ParIdealRecord = WeeklyBaseRecord

export type CalculatedOrderLine = {
    inventory_item_id: string
    item_name: string
    unit_description: string
    par_value: number
    par_ideal_value?: number
    par_ideal?: number | null
    leftover_value: number | null
    calculated_qty: number
    rounding_rule: string
    qb_item_id?: string
    is_extraordinary?: boolean
    suggested_leftover?: number | null
    raw_suggested_leftover?: number | null
    effective_leftover?: number | null
    effective_source?: 'manual' | 'auto_cycle_v2' | 'system_auto' | null
    is_burn_rate?: boolean
    variance?: number | null
    tolerance_value?: number | null
    within_tolerance?: boolean | null
    purchase_unit_cost?: number
    unit_measure?: string
    adjusted_qty?: number
    theoretical_consumption?: number | null
    theoretical_source_status?: 'not_certified' | 'verified_source_partial_recipe' | 'legacy_pmix_unverified' | 'verified_dual_engine_v2'
    theoretical_source_reason?: string
    yesterday_order_qty?: number | null
    adaptive_buffer?: number
    is_tight?: boolean
    buffer_reason?: string
    suggested_order_qty?: number
    sku_tier?: 'critical_daily' | 'cycle_stable'
    count_source?: 'manual' | 'auto_cycle_v2' | null
}

export type OrderRecord = {
    id: string
    store_id: number
    order_date: string
    week_start_date: string
    status: string
    created_by?: string
    notes?: string
    qb_estimate_id?: string
    qb_estimate_number?: string
    qb_invoice_id?: string
    qb_invoice_number?: string
    qb_invoiced_at?: string
    sent_at?: string
    created_at: string
    lines?: OrderLineRecord[]
}

export type OrderLineRecord = {
    id: string
    order_id: string
    inventory_item_id: string
    calculated_qty: number
    adjusted_qty?: number
    final_qty: number
    par_value: number
    leftover_value: number
}

export interface OrderAnomaly {
    itemId: string
    itemName: string
    parValue: number
    leftoverValue: number | null
    calculatedQty: number
    adjustedQty?: number
    finalQty: number
    type: 'high_leftover' | 'high_adjust' | 'high_final' | 'zero_critical' | 'negative_final'
    message: string
}

export type PersistableOrderLineInput = {
    inventory_item_id: string
    calculated_qty: number
    adjusted_qty?: number
    par_value: number
    leftover_value: number
    is_auto_leftover?: boolean
}

/**
 * Resuelve la cantidad final efectiva de una línea considerando ajustes manuales (`Adjust`)
 * y el tipo de orden (`daily` vs `liquids` / `uniforms`).
 * En `'auto_order_visible'`, `effective_leftover` respalda la línea cuando el asistente aún no
 * captura un conteo físico manual; si captura `leftover_value`, este último manda al 100%.
 * En órdenes no diarias (`liquids` / `uniforms`), un ajuste manual explícito SIEMPRE es válido
 * incluso si `leftover_value` es `null`/`undefined`.
 * Los artículos externos `TRACK_ONLY` (`Flan`, `Whole Flan`, `Cheesecake`) nunca generan cantidad a pedir a Bodega.
 */
export function resolveEffectiveOrderLineQty(
    line: Pick<CalculatedOrderLine, 'inventory_item_id' | 'calculated_qty' | 'leftover_value' | 'is_extraordinary'> & {
        effective_leftover?: number | null
        item_name?: string
        qb_item_id?: string
    },
    adjustmentsMap: Record<string, number | string>,
    orderType: 'daily' | 'liquids' | 'uniforms'
): { isReady: boolean; adjNum: number | undefined; finalQty: number } {
    if (!line.is_extraordinary && orderType === 'daily' && isTrackOnlyOrderItem(line)) {
        return { isReady: false, adjNum: undefined, finalQty: 0 }
    }

    const rawAdj = adjustmentsMap[line.inventory_item_id]
    const parsedAdj = rawAdj !== undefined && rawAdj !== '' ? Number(rawAdj) : undefined
    const adjNum = parsedAdj !== undefined && Number.isFinite(parsedAdj) ? parsedAdj : undefined
    const resolvedLeftover = line.leftover_value !== null && line.leftover_value !== undefined
        ? line.leftover_value
        : (line.effective_leftover ?? null)
    const hasLeftover = resolvedLeftover !== null && resolvedLeftover !== undefined

    if (line.is_extraordinary) {
        return {
            isReady: true,
            adjNum,
            finalQty: adjNum !== undefined ? adjNum : line.calculated_qty
        }
    }

    if (orderType === 'daily') {
        if (!hasLeftover && adjNum === undefined) {
            return { isReady: false, adjNum, finalQty: 0 }
        }
        return {
            isReady: true,
            adjNum,
            finalQty: adjNum !== undefined ? adjNum : line.calculated_qty
        }
    }

    // Para uniformes y líquidos: si hay ajuste manual explícito, nunca descartar por leftover_value nulo
    if (adjNum !== undefined) {
        return {
            isReady: true,
            adjNum,
            finalQty: adjNum
        }
    }

    if (!hasLeftover) {
        return { isReady: false, adjNum: undefined, finalQty: 0 }
    }

    return {
        isReady: true,
        adjNum: undefined,
        finalQty: line.calculated_qty
    }
}

/**
 * Construye las líneas a guardar en `inventory_order_lines`.
 * - Incluye todas las líneas con `finalQty > 0` (incluyendo ajustes manuales y extraordinarios).
 * - También persiste las líneas donde el usuario puso explícitamente `Adjust = 0` sobre un ítem con `calculated_qty > 0`,
 *   para que al guardar (`Generar Orden`) y recargar (`loadData`) NUNCA se pierdan las cancelaciones manuales en `0`.
 * - Excluye estrictamente artículos `TRACK_ONLY` (`Flan`, `Whole Flan`, `Cheesecake`) que provienen de proveedor externo.
 */
export function buildPersistableOrderLines(
    lines: CalculatedOrderLine[],
    adjustmentsMap: Record<string, number | string>,
    orderType: 'daily' | 'liquids' | 'uniforms'
): { persistableLines: PersistableOrderLineInput[]; positiveCount: number } {
    const persistableLines: PersistableOrderLineInput[] = []
    let positiveCount = 0

    for (const l of lines) {
        if (!l.is_extraordinary && orderType === 'daily' && isTrackOnlyOrderItem(l)) continue

        const { isReady, adjNum, finalQty } = resolveEffectiveOrderLineQty(l, adjustmentsMap, orderType)
        if (!isReady) continue

        const isPositive = finalQty > 0
        const isExplicitZeroSuppression = adjNum === 0 && l.calculated_qty > 0

        if (!isPositive && !isExplicitZeroSuppression) continue
        if (isPositive) positiveCount++

        const hasManualLeftover = l.leftover_value !== null && l.leftover_value !== undefined
        persistableLines.push({
            inventory_item_id: l.inventory_item_id,
            calculated_qty: l.calculated_qty,
            adjusted_qty: adjNum,
            par_value: l.par_value,
            leftover_value: hasManualLeftover ? l.leftover_value! : (l.effective_leftover ?? 0),
            is_auto_leftover: !hasManualLeftover && l.effective_leftover !== null && l.effective_leftover !== undefined,
        })
    }

    return { persistableLines, positiveCount }
}

/**
 * Escaneo inteligente de anomalías y errores de dedo (Capa 2 Pre-Flight).
 * En `orderType === 'uniforms'`, omite falsos positivos de `high_leftover` y `zero_critical`
 * ya que `En Existencia` se sincroniza automáticamente en solo-lectura desde `uniforms_inventory_stock`
 * y los pedidos de uniformes son esporádicos por talla requerida.
 */
export function evaluateOrderAnomalies(
    lines: CalculatedOrderLine[],
    adjustmentsMap: Record<string, number | string>,
    countsMap: Record<string, Record<string, number>>,
    orderDate: string,
    lang: string,
    orderType: 'daily' | 'liquids' | 'uniforms' = 'daily'
): OrderAnomaly[] {
    const anomalies: OrderAnomaly[] = []

    for (const l of lines) {
        if (!l.is_extraordinary && orderType === 'daily' && isTrackOnlyOrderItem(l)) continue
        const rawAdj = adjustmentsMap[l.inventory_item_id]
        const adjNum = rawAdj !== undefined && rawAdj !== '' ? Number(rawAdj) : undefined
        const finalQty = adjNum !== undefined && !isNaN(adjNum) ? adjNum : l.calculated_qty
        const currentLeftover = countsMap[l.inventory_item_id]?.[orderDate]
        const par = l.par_value || 0

        // 1. Sobrante anormalmente alto vs PAR (solo cuando el sobrante se captura manualmente: daily / liquids)
        if (
            orderType !== 'uniforms' &&
            !l.is_extraordinary &&
            currentLeftover !== undefined &&
            currentLeftover !== null &&
            par > 0
        ) {
            const isHighLeftover = (par >= 3 && currentLeftover >= par * 1.5 && (currentLeftover - par >= 4)) ||
                (par < 3 && currentLeftover >= 8)

            if (isHighLeftover) {
                const percent = Math.round(((currentLeftover - par) / par) * 100)
                anomalies.push({
                    itemId: l.inventory_item_id,
                    itemName: l.item_name,
                    parValue: par,
                    leftoverValue: currentLeftover,
                    calculatedQty: l.calculated_qty,
                    adjustedQty: adjNum,
                    finalQty,
                    type: 'high_leftover',
                    message: lang === 'es'
                        ? `Sobrante capturado (${currentLeftover}) es ${percent}% mayor al PAR (${par}). Provocará pedir 0 unidades.`
                        : `Captured leftover (${currentLeftover}) is ${percent}% higher than PAR (${par}). Will result in ordering 0 units.`
                })
                continue
            }
        }

        // 2. Ajuste manual inusualmente alto o negativo
        if (adjNum !== undefined && !isNaN(adjNum)) {
            if (adjNum < 0) {
                anomalies.push({
                    itemId: l.inventory_item_id,
                    itemName: l.item_name,
                    parValue: par,
                    leftoverValue: currentLeftover ?? null,
                    calculatedQty: l.calculated_qty,
                    adjustedQty: adjNum,
                    finalQty,
                    type: 'negative_final',
                    message: lang === 'es'
                        ? `El ajuste ingresado (${adjNum}) es negativo.`
                        : `Entered adjustment (${adjNum}) is negative.`
                })
                continue
            }

            const isHighAdjust = (par >= 4 && adjNum >= par * 2.5 && (adjNum - par >= 8)) ||
                (par < 4 && par > 0 && adjNum >= 25) ||
                (par === 0 && adjNum >= 50)

            if (isHighAdjust) {
                anomalies.push({
                    itemId: l.inventory_item_id,
                    itemName: l.item_name,
                    parValue: par,
                    leftoverValue: currentLeftover ?? null,
                    calculatedQty: l.calculated_qty,
                    adjustedQty: adjNum,
                    finalQty,
                    type: 'high_adjust',
                    message: lang === 'es'
                        ? `Ajuste manual (${adjNum}) excede ampliamente el PAR habitual (${par}). Pedido final: ${finalQty}.`
                        : `Manual adjustment (${adjNum}) substantially exceeds PAR (${par}). Final order: ${finalQty}.`
                })
                continue
            }
        }

        // 3. Cantidad final elevada no justificada
        if (par > 0 && finalQty > Math.max(par * 2.5, 30)) {
            anomalies.push({
                itemId: l.inventory_item_id,
                itemName: l.item_name,
                parValue: par,
                leftoverValue: currentLeftover ?? null,
                calculatedQty: l.calculated_qty,
                adjustedQty: adjNum,
                finalQty,
                type: 'high_final',
                message: lang === 'es'
                    ? `Cantidad final (${finalQty}) es más de 2.5x el consumo diario normal (PAR ${par}).`
                    : `Final quantity (${finalQty}) is over 2.5x normal daily consumption (PAR ${par}).`
            })
            continue
        }

        // 4. Insumo de alto volumen que queda en 0 (no aplica en uniformes, donde pedir solo ciertas tallas es normal)
        if (orderType !== 'uniforms' && !l.is_extraordinary && par >= 15 && finalQty === 0 && currentLeftover !== undefined) {
            anomalies.push({
                itemId: l.inventory_item_id,
                itemName: l.item_name,
                parValue: par,
                leftoverValue: currentLeftover,
                calculatedQty: l.calculated_qty,
                adjustedQty: adjNum,
                finalQty,
                type: 'zero_critical',
                message: lang === 'es'
                    ? `Insumo de alto volumen (PAR ${par}) quedará en 0 a pedir por el sobrante reportado (${currentLeftover}).`
                    : `High-volume item (PAR ${par}) will have 0 ordered due to reported leftover (${currentLeftover}).`
            })
        }
    }

    return anomalies
}
