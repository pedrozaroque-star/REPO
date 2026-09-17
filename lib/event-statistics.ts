/**
 * @module EventStatistics
 * @description Funciones puras para atenuar y combinar el impacto de eventos sobre ventas.
 * @businessRules Eventos nacionales sin venue conservan su factor; eventos geográficos decaen continuamente con distancia; el resultado queda entre 0.70 y 1.30.
 * @dataFlow Multiplicadores y distancias validadas -> factor estable -> Event Intelligence.
 * @notes La combinación es conmutativa para que el orden de filas de la base de datos no altere el pronóstico.
 */

export function clampEventMultiplier(value: number): number {
    return Number.isFinite(value) ? Math.min(Math.max(value, 0.70), 1.30) : 1
}

export function distanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 3958.8
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLng = (lng2 - lng1) * Math.PI / 180
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function getDistanceAdjustedMultiplier(baseMultiplier: number, distance: number, eventScope: string, hasVenue = false): number {
    if (eventScope === 'national' && !hasVenue) return clampEventMultiplier(baseMultiplier)
    if (!Number.isFinite(distance) || distance < 0) return 1
    const deviation = clampEventMultiplier(baseMultiplier) - 1
    // Radio de decaimiento por distancia (en millas):
    // Para recintos físicos en Los Ángeles, el radio de influencia para comida rápida / tacos es hiperlocal:
    // - scope 'local': 2.5 millas (teatros, clubes, foros pequeños)
    // - scope 'regional' / 'national' con venue: 3.5 millas (estadios como Dodger Stadium, SoFi, BMO, Hollywood Bowl)
    const decayRadius = eventScope === 'local' ? 2.5 : 3.5
    return 1 + deviation * Math.exp(-distance / decayRadius)
}

export function combineEventMultipliers(multipliers: number[]): number {
    const valid = multipliers.map(clampEventMultiplier)
    if (valid.length === 0) return 1
    const totalDeviation = valid.reduce((sum, multiplier) => sum + (multiplier - 1), 0)
    return clampEventMultiplier(1 + totalDeviation / Math.sqrt(valid.length))
}
