/**
 * @module ForecastStatistics
 * @description Funciones puras para estabilizar las proyecciones de ventas, tráfico y ticket promedio.
 * @businessRules
 * - Ignora valores negativos, no finitos y denominadores en cero.
 * - Limita valores atípicos con percentiles antes de aplicar pesos de recencia.
 * - Los factores operativos siempre deben permanecer dentro de límites explícitos.
 * @dataFlow Datos históricos normalizados -> estadísticas robustas -> motor de `lib/intelligence.ts`.
 * @notes Se mantiene sin dependencias de Supabase para permitir simulaciones deterministas con `tsx`.
 */

export interface WeightedObservation {
    value: number
    weight: number
}

export function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min
    return Math.min(Math.max(value, min), max)
}

export function median(values: number[]): number {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
    if (sorted.length === 0) return 0
    const middle = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle]
}

function percentile(sorted: number[], ratio: number): number {
    if (sorted.length === 0) return 0
    const position = (sorted.length - 1) * clamp(ratio, 0, 1)
    const lower = Math.floor(position)
    const upper = Math.ceil(position)
    if (lower === upper) return sorted[lower]
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

export function winsorize(values: number[], lowerRatio = 0.10, upperRatio = 0.90): number[] {
    const finite = values.filter(value => Number.isFinite(value) && value >= 0)
    if (finite.length < 4) return finite
    const sorted = [...finite].sort((a, b) => a - b)
    const lower = percentile(sorted, lowerRatio)
    const upper = percentile(sorted, upperRatio)
    return finite.map(value => clamp(value, lower, upper))
}

export function robustWeightedMean(observations: WeightedObservation[]): number {
    const valid = observations.filter(item => Number.isFinite(item.value) && item.value >= 0 && Number.isFinite(item.weight) && item.weight > 0)
    if (valid.length === 0) return 0
    const bounded = winsorize(valid.map(item => item.value))
    const totalWeight = valid.reduce((sum, item) => sum + item.weight, 0)
    if (totalWeight <= 0) return 0
    return valid.reduce((sum, item, index) => sum + bounded[index] * item.weight, 0) / totalWeight
}

export function safeRatio(numerator: number, denominator: number, fallback = 1): number {
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return fallback
    const ratio = numerator / denominator
    return Number.isFinite(ratio) ? ratio : fallback
}

export function robustAverageCheck(rows: Array<{ sales: number; tickets: number }>, fallback: number): number {
    const checks = rows
        .filter(row => Number.isFinite(row.sales) && row.sales > 0 && Number.isFinite(row.tickets) && row.tickets > 0)
        .map(row => row.sales / row.tickets)
        .filter(value => value >= 5 && value <= 100)
    const result = median(checks)
    return result > 0 ? result : fallback
}

export function empiricalConfidenceBand(values: number[], center: number): { low: number; high: number; sampleSize: number } {
    const finite = values.filter(value => Number.isFinite(value) && value >= 0).sort((a, b) => a - b)
    if (finite.length < 3 || center <= 0) {
        return { low: center * 0.90, high: center * 1.10, sampleSize: finite.length }
    }
    return {
        low: Math.max(0, percentile(finite, 0.20)),
        high: percentile(finite, 0.80),
        sampleSize: finite.length
    }
}
