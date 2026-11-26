/**
 * @module lib/inventory/food-cost-sales-resolver
 * @description Utilidades deterministas compartidas para el ecosistema Ventas & Food Cost de Tacos Gavilan:
 *   - Calendario y hora laboral oficial en `America/Los_Angeles` (regla 06:00 AM – 05:59 AM, turno PM 05:00 PM) con soporte PST/PDT.
 *   - Resolución de `net_sales` para Food Cost (paridad intradía PMIX vs paridad histórica `sales_daily_cache`).
 *   - Guardias matemáticas, aislamiento de filas corruptas en caché, protección anti-cero en `sales_daily_cache`, formato monetario con signo (`-$`) y sanitización CSV anti-inyección.
 *
 * @businessRules
 * - **Regla de las 6:00 AM (`America/Los_Angeles`)**: El día laboral inicia a las 06:00 AM y cierra a las 05:59 AM del día siguiente.
 * - **Paridad Intraday (Hoy en vivo)**: Cuando el rango incluye el día laboral en curso (`endDate >= todayBusinessDateLA`), `food-cost` usa las ventas netas del mismo snapshot vivo de Toast PMIX (`pmixNetSales`) para mantener numerador (`total_cost`) y denominador (`net_sales`) bloqueados al mismo segundo.
 * - **Paridad Histórica (Días cerrados)**: Para días ya cerrados (`endDate < todayBusinessDateLA`), se prioriza `sales_daily_cache` ÚNICAMENTE cuando `cachedDailySales > 0`; si falta o está en `<= 0`, se recurre a `pmixNetSales`.
 * - **Protección Anti-Cero en `sales_daily_cache`**: Nunca sobrescribir una venta positiva ya cacheada con `$0 / 0 órdenes` ni persistir filas marcadas con `hasError: true`.
 * - **Semáforo unificado de Food Cost**: Saludable `<= 32%`, Alerta `> 32%` y `<= 35%`, Crítico `> 35%`.
 *
 * @dataFlow
 * - Consumido por `/api/inventory/food-cost`, `/api/inventory/food-cost-cache`, `/api/dashboard/kpis`, `/api/ventas/*`, `/api/integrity/verify-day`, `/api/reports/weekly-ops`, `/api/sync/sales-live`, `/api/cron/sync-sales*`, `app/ventas/*` y `components/sales/*`.
 *
 * @notes
 * - [2026-11-23] Creado tras auditoría forense de `LA Central = 0.0%` y picos artificiales (`Downey = 41.8%`), y expandido tras auditoría integral de 5 subagentes sobre el módulo Ventas y sus subpáginas.
 * - [2026-11-23] Estandarizados los umbrales canónicos únicos de Food Cost (`FOOD_COST_TARGET_PCT = 30`, `FOOD_COST_HEALTHY_MAX_PCT = 32`, `FOOD_COST_WARNING_MAX_PCT = 35`), `getFoodCostStatus()` (`> 35%` crítico rojo en todo el sistema) y `calculateSafePackagingCostPct()` para separar empaque de materia prima.
 * - [2026-11-25] Exportado `resolveCanonicalTelescopingAnchor()` para unificar la selección determinista del ancla `t0` (incluyendo lookback `-3d` en lunes cuando se omitió el domingo, dado que sábado no tiene cierre independiente) en todos los motores de conciliación física vs. teórica.
 */

export const FOOD_COST_TARGET_PCT = 30
export const FOOD_COST_HEALTHY_MAX_PCT = 32
export const FOOD_COST_WARNING_MAX_PCT = 35

/** Alias de compatibilidad hacia atrás para módulos de Ventas ya integrados. */
export const FOOD_COST_HEALTHY_MAX = FOOD_COST_HEALTHY_MAX_PCT
export const FOOD_COST_WARNING_MAX = FOOD_COST_WARNING_MAX_PCT

export type FoodCostStatus = 'healthy' | 'warning' | 'critical'

/**
 * Evalúa el estado canónico del porcentaje de Food Cost según la regla corporativa única:
 * - `<= 32%` -> `'healthy'` (verde)
 * - `> 32%` y `<= 35%` -> `'warning'` (ámbar)
 * - `> 35%` -> `'critical'` (rojo)
 */
export function getFoodCostStatus(pct: number): FoodCostStatus {
    if (!Number.isFinite(pct)) {
        return pct === Infinity ? 'critical' : 'healthy'
    }
    if (pct <= FOOD_COST_HEALTHY_MAX_PCT) return 'healthy'
    if (pct <= FOOD_COST_WARNING_MAX_PCT) return 'warning'
    return 'critical'
}

export type FoodCostSalesSource =
    | 'pmix_intraday'
    | 'sales_daily_cache'
    | 'pmix_fallback'
    | 'cache_fallback'

export interface ResolveFoodCostNetSalesParams {
    startDate: string
    endDate: string
    pmixNetSales: number
    cachedDailySales?: number | null
    todayBusinessDateLA?: string
}

export interface ResolveFoodCostNetSalesResult {
    netSales: number
    source: FoodCostSalesSource
}

export interface LANowParts {
    year: number
    month: number
    day: number
    hour: number
    minute: number
    second: number
    /** Fecha calendario actual en `America/Los_Angeles` (`YYYY-MM-DD`). */
    calendarDate: string
    /** Fecha laboral actual aplicando la regla de las 06:00 AM (`YYYY-MM-DD`). */
    businessDate: string
    /** Clave de hora actual `"YYYY-MM-DD HH:00"` en `America/Los_Angeles` (para línea `"● AHORA"` y buckets horarios). */
    hourKey: string
    /** Ratio de minutos transcurridos en la hora actual (`0..1`). */
    minuteRatio: number
}

const LA_PARTS_FORMATTER = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
})

/**
 * Extrae todas las componentes de fecha/hora en `America/Los_Angeles` de forma inmune
 * a la zona horaria del navegador o del servidor (UTC en Vercel) y al bug ICU `hour === 24`.
 */
export function getLANowParts(now: Date = new Date()): LANowParts {
    const parts = LA_PARTS_FORMATTER.formatToParts(now)

    const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '0'
    const year = parseInt(getPart('year'), 10)
    const month = parseInt(getPart('month'), 10)
    const day = parseInt(getPart('day'), 10)
    const rawHour = parseInt(getPart('hour'), 10)
    const hour = rawHour === 24 ? 0 : rawHour
    const minute = parseInt(getPart('minute'), 10)
    const second = parseInt(getPart('second'), 10)

    const calendarDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const bizUtc = new Date(Date.UTC(year, month - 1, day))
    if (hour < 6) {
        bizUtc.setUTCDate(bizUtc.getUTCDate() - 1)
    }
    const businessDate = `${bizUtc.getUTCFullYear()}-${String(bizUtc.getUTCMonth() + 1).padStart(2, '0')}-${String(bizUtc.getUTCDate()).padStart(2, '0')}`
    const hourKey = `${calendarDate} ${String(hour).padStart(2, '0')}:00`

    return {
        year,
        month,
        day,
        hour,
        minute,
        second,
        calendarDate,
        businessDate,
        hourKey,
        minuteRatio: minute / 60,
    }
}

/**
 * Devuelve la fecha laboral vigente (`YYYY-MM-DD`) en zona horaria `America/Los_Angeles`
 * respetando la regla corporativa de rollover a las 06:00 AM.
 */
export function getBusinessDateLA(now: Date = new Date()): string {
    return getLANowParts(now).businessDate
}

/**
 * Valida estrictamente formato `YYYY-MM-DD` y existencia real en el calendario gregoriano
 * (rechaza fechas inexistentes como `2027-02-29` o `2026-02-30`).
 */
export function isValidIsoDate(dateStr: unknown): dateStr is string {
    if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false
    const [y, m, d] = dateStr.split('-').map(Number)
    if (m < 1 || m > 12 || d < 1 || d > 31) return false
    const dt = new Date(Date.UTC(y, m - 1, d))
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/**
 * Suma o resta días calendario sobre `YYYY-MM-DD` usando aritmética UTC pura (sin desfase local ni DST).
 */
export function addDaysIso(dateStr: string, deltaDays: number): string {
    const [y, m, d] = dateStr.split('-').map(Number)
    const dt = new Date(Date.UTC(y, m - 1, d + deltaDays))
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

/**
 * Diferencia exacta en días calendario (`endDate - startDate`) usando aritmética UTC pura
 * (inmune a días de 23h/25h en cambios de horario DST).
 */
export function diffCalendarDays(startDate: string, endDate: string): number {
    const [sy, sm, sd] = startDate.split('-').map(Number)
    const [ey, em, ed] = endDate.split('-').map(Number)
    return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86_400_000)
}

/**
 * Ajusta cualquier fecha `YYYY-MM-DD` al Lunes de su semana ISO (`Mon–Sun`) en aritmética UTC pura.
 */
export function getMondayIso(dateStr: string): string {
    const [y, m, d] = dateStr.split('-').map(Number)
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0=Sun, 1=Mon..6=Sat
    const diffToMonday = dow === 0 ? -6 : 1 - dow
    return addDaysIso(dateStr, diffToMonday)
}

/**
 * Construye un `Date` exacto (instante UTC) correspondiente a una fecha y hora de reloj pared
 * en `America/Los_Angeles`, resolviendo automáticamente PST (`UTC-8`) y PDT (`UTC-7`).
 */
export function buildLAInstant(dateStr: string, hour: number, minute: number = 0): Date {
    const [y, m, d] = dateStr.split('-').map(Number)
    // Primera aproximación asumiendo PST (UTC-8), luego ajustamos con el offset real en LA
    const guessUtcMs = Date.UTC(y, m - 1, d, hour + 8, minute, 0, 0)
    const guess = new Date(guessUtcMs)
    const actualParts = getLANowParts(guess)
    const desiredWallMs = Date.UTC(y, m - 1, d, hour, minute, 0, 0)
    const actualWallMs = Date.UTC(
        actualParts.year,
        actualParts.month - 1,
        actualParts.day,
        actualParts.hour,
        actualParts.minute,
        0,
        0
    )
    const correctionMs = desiredWallMs - actualWallMs
    return new Date(guessUtcMs + correctionMs)
}

/**
 * Formatea un monto en USD con el signo SIEMPRE antes de `$` (`-$150.50`, nunca `$-150.50`),
 * previniendo `-$0.00` y `$NaN`.
 */
export function formatSignedUSD(
    value: number,
    options?: { decimals?: number; showPlus?: boolean }
): string {
    const decimals = options?.decimals ?? 2
    const showPlus = options?.showPlus ?? false
    const safe = Number.isFinite(value) ? value : 0
    const factor = Math.pow(10, decimals)
    const roundedUnits = Math.round(safe * factor)
    const absVal = Math.abs(roundedUnits) / factor
    const formatted = absVal.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    })
    if (roundedUnits < 0) return `-$${formatted}`
    if (roundedUnits > 0 && showPlus) return `+$${formatted}`
    return `$${formatted}`
}

/**
 * Escapa una celda de texto para CSV: duplica comillas internas y neutraliza inyección de fórmulas
 * en Excel/Google Sheets (`=`, `+`, `-`, `@`, tab, CR), preservando montos/números/porcentajes
 * legítimos firmados (`-$1,500.50`, `+$250.00`, `-500`, `+2.10%`).
 */
export function escapeCsvCell(raw: unknown): string {
    let str = raw === null || raw === undefined ? '' : String(raw)
    const isSafeSignedNumberOrCurrency = /^[+-]\$?\d[\d,]*(?:\.\d+)?%?$/.test(str)
    if (!isSafeSignedNumberOrCurrency && /^[=+\-@\t\r]/.test(str)) {
        str = `'${str}`
    }
    return `"${str.replace(/"/g, '""')}"`
}

/**
 * Resuelve el denominador `net_sales` para el cálculo de Food Cost evitando:
 * 1) Sobrescribir ventas reales con `$0` provenientes de `sales_daily_cache`.
 * 2) Dividir el costo vivo de PMIX de hoy entre un snapshot rezagado de `sales_daily_cache`.
 */
export function resolveFoodCostNetSales(
    params: ResolveFoodCostNetSalesParams
): ResolveFoodCostNetSalesResult {
    const todayLA = params.todayBusinessDateLA || getBusinessDateLA()
    const pmix =
        typeof params.pmixNetSales === 'number' && Number.isFinite(params.pmixNetSales) && params.pmixNetSales > 0
            ? params.pmixNetSales
            : 0
    const cached =
        typeof params.cachedDailySales === 'number' && Number.isFinite(params.cachedDailySales) && params.cachedDailySales > 0
            ? params.cachedDailySales
            : 0

    const isLiveIntraday = params.endDate >= todayLA

    if (isLiveIntraday) {
        if (pmix > 0) {
            return { netSales: Number(pmix.toFixed(2)), source: 'pmix_intraday' }
        }
        if (cached > 0) {
            return { netSales: Number(cached.toFixed(2)), source: 'cache_fallback' }
        }
        return { netSales: 0, source: 'pmix_fallback' }
    }

    // Días históricos cerrados: paridad al centavo con sales_daily_cache solo si es positivo
    if (cached > 0) {
        return { netSales: Number(cached.toFixed(2)), source: 'sales_daily_cache' }
    }
    if (pmix > 0) {
        return { netSales: Number(pmix.toFixed(2)), source: 'pmix_fallback' }
    }
    return { netSales: 0, source: 'pmix_fallback' }
}

/**
 * Calcula el porcentaje de Food Cost protegido contra divisiones por cero, NaN e Infinity.
 */
export function calculateSafeFoodCostPct(totalCost: number, netSales: number): number {
    if (
        !Number.isFinite(totalCost) ||
        !Number.isFinite(netSales) ||
        totalCost <= 0 ||
        netSales <= 0
    ) {
        return 0
    }
    return Number(((totalCost / netSales) * 100).toFixed(2))
}

/**
 * Calcula el porcentaje de Packaging / COGS de empaque sobre ventas netas,
 * protegido contra divisiones por cero, valores negativos, NaN e Infinity.
 */
export function calculateSafePackagingCostPct(packagingCost: number, netSales: number): number {
    if (
        !Number.isFinite(packagingCost) ||
        !Number.isFinite(netSales) ||
        packagingCost <= 0 ||
        netSales <= 0
    ) {
        return 0
    }
    return Number(((packagingCost / netSales) * 100).toFixed(2))
}

/**
 * Resuelve el monto en dólares de Food Cost puro desde una fila de `food_cost_daily_cache`,
 * protegiendo contra desincronización si un escritor previo actualizó `total_cost` sin tocar `food_cost`
 * o si `food_cost` quedó en `0` / `NULL` cuando `total_cost > 0`.
 */
export function resolveCachedFoodCostDollars(row: {
    food_cost?: unknown
    total_cost?: unknown
    packaging_cost?: unknown
}): number {
    const total = Number(row.total_cost)
    const safeTotal = Number.isFinite(total) && total > 0 ? total : 0
    const food = row.food_cost === null || row.food_cost === undefined ? NaN : Number(row.food_cost)
    const pkg = Number(row.packaging_cost)
    const safePkg = Number.isFinite(pkg) && pkg > 0 ? pkg : 0

    if (!Number.isFinite(food) || (food <= 0 && safeTotal > 0)) {
        return safeTotal
    }
    // En el esquema actual `total_cost === food_cost` (y en legado `total_cost = food_cost + packaging_cost`).
    // Si `total_cost` difiere de `food_cost` por más que `packaging_cost + $1`, `food_cost` quedó congelado.
    if (safeTotal > 0 && Math.abs(safeTotal - food) > safePkg + 1) {
        return safeTotal
    }
    return food
}

/**
 * Detecta filas corruptas/incompletas en caché donde hubo consumo/costo teórico real
 * pero las ventas netas quedaron en cero o negativas (evitando badges verdes falsos `0.0%`).
 */
export function isInvalidFoodCostCacheRow(totalCost: number, netSales: number): boolean {
    return Number(totalCost) > 0 && Number(netSales) <= 0
}

/**
 * Guardia para escrituras en `sales_daily_cache`:
 * - Bloquea filas con `hasError === true` (fallo de Toast API / 429 / timeout).
 * - Bloquea sobrescribir ventas positivas ya guardadas con `$0` y `0` órdenes.
 */
export function shouldAllowSalesCacheUpsert(
    row: { hasError?: boolean; netSales?: number; orderCount?: number },
    existingNetSales?: number | null
): boolean {
    if (row.hasError) return false
    const incomingSales = Number(row.netSales) || 0
    const incomingOrders = Number(row.orderCount) || 0
    const existingSales = Number(existingNetSales) || 0
    if (incomingSales <= 0 && incomingOrders <= 0 && existingSales > 0) {
        return false
    }
    return true
}

export const FOOD_COST_MAX_RANGE_ALL_STORES_DAYS = 35
export const FOOD_COST_MAX_RANGE_SINGLE_STORE_DAYS = 65
export const FOOD_COST_MAX_RANGE_FOOD_COST_SINGLE_DAYS = 93

const STRICT_ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export interface DateRangeValidationResult {
    ok: boolean
    days: number
    error?: string
}

/**
 * Valida formato `YYYY-MM-DD`, orden `startDate <= endDate` y tope máximo inclusivo de días
 * para impedir que consultas abiertas de 60–365 días × 15 tiendas saturen la RAM de Supabase.
 */
export function validateDateRangeWithinMaxDays(
    startDate: string,
    endDate: string,
    maxDays: number
): DateRangeValidationResult {
    if (!STRICT_ISO_DATE_RE.test(startDate) || !STRICT_ISO_DATE_RE.test(endDate)) {
        return { ok: false, days: 0, error: 'Formato de fecha inválido (use YYYY-MM-DD).' }
    }
    const startUtc = new Date(`${startDate}T12:00:00Z`)
    const endUtc = new Date(`${endDate}T12:00:00Z`)
    if (
        Number.isNaN(startUtc.getTime()) ||
        Number.isNaN(endUtc.getTime()) ||
        startUtc.toISOString().slice(0, 10) !== startDate ||
        endUtc.toISOString().slice(0, 10) !== endDate
    ) {
        return { ok: false, days: 0, error: 'Fecha de calendario inexistente.' }
    }
    if (startDate > endDate) {
        return { ok: false, days: 0, error: 'startDate debe ser menor o igual a endDate.' }
    }
    const inclusiveDays = diffCalendarDays(startDate, endDate) + 1
    if (inclusiveDays > maxDays) {
        return {
            ok: false,
            days: inclusiveDays,
            error: `El rango solicitado (${inclusiveDays} días) supera el máximo permitido (${maxDays} días) para proteger la estabilidad de la base de datos. Selecciona una ventana más corta o una sola sucursal.`,
        }
    }
    return { ok: true, days: inclusiveDays }
}

/**
 * Resuelve de manera canónica y determinista el par telescópico `[t0, t1]` entre fechas ordenadas
 * de conteos físicos humanos (`YYYY-MM-DD`, excluyendo capturas aisladas de sábado y `AUTO_CYCLE_V2`)
 * para cualquier ventana `[startDate, endDate]`:
 * - `t1`: último conteo dentro de `[startDate, endDate]`.
 * - `idealMinPre`: `startDate - 3` cuando es consulta de 1 solo día (`startDate === endDate`) o cuando
 *   `startDate` es lunes (`startDow === 1`, permitiendo anclar al viernes si faltó el domingo);
 *   `startDate - 2` para el resto de los días.
 * - `t0`: último conteo en `[idealMinPre, startDate)`, o `inWin[0]` si `inWin.length >= 2`.
 */
export function resolveCanonicalTelescopingAnchor(
    sortedDates: string[],
    startDate: string,
    endDate: string
): { t0: string; t1: string; spanDays: number } | null {
    const inWin = sortedDates.filter((d) => d >= startDate && d <= endDate)
    if (inWin.length === 0) return null
    const t1 = inWin[inWin.length - 1]
    const isSingle = startDate === endDate
    const startDow = new Date(`${startDate}T12:00:00Z`).getUTCDay()
    const idealMinPre = isSingle
        ? addDaysIso(startDate, -3)
        : startDow === 1
            ? addDaysIso(startDate, -3)
            : addDaysIso(startDate, -2)
    const pre = sortedDates.filter((d) => d >= idealMinPre && d < startDate)
    const t0 = pre.length > 0 ? pre[pre.length - 1] : inWin.length >= 2 ? inWin[0] : null
    if (!t0 || t0 >= t1) return null
    const spanDays = diffCalendarDays(t0, t1)
    return spanDays >= 1 ? { t0, t1, spanDays } : null
}
