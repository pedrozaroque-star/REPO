/**
 * @module EventIntelligence
 * @description Librería de inteligencia de eventos para mejorar las proyecciones de ventas.
 * Consulta la tabla `event_intelligence` en Supabase para obtener eventos próximos
 * y calcular multiplicadores de impacto ajustados por distancia a cada tienda.
 * @businessRules
 * - Los eventos nacionales (holidays) afectan a TODAS las tiendas por igual
 * - Los eventos locales (conciertos, deportes) se ajustan por DISTANCIA al venue
 * - Multiplicadores: 0.35 (Thanksgiving) a 1.40 (Cinco de Mayo). 1.00 = sin efecto
 * - Cuando hay múltiples eventos el mismo día, el más impactante domina y los secundarios se aplican al 30%
 * - El día laboral va de 6:00 AM a 5:59 AM del siguiente día
 * @dataFlow
 * Gemini Cron → event_intelligence table → getEventMultiplier() → intelligence.ts
 * @notes
 * - Las coordenadas de tiendas están en la tabla `stores` (latitude, longitude)
 * - Venues conocidos: SoFi Stadium, Crypto.com Arena, Dodger Stadium, Hollywood Bowl, BMO Stadium, The Forum, Rose Bowl
 */

import { supabase } from '@/lib/supabase'
import { clampEventMultiplier, combineEventMultipliers, distanceMiles, getDistanceAdjustedMultiplier } from '@/lib/event-statistics'
export { combineEventMultipliers, distanceMiles, getDistanceAdjustedMultiplier } from '@/lib/event-statistics'

export async function getEventMultiplier(
    storeId: string, 
    targetDate: string,
    isHolidayComp: boolean = false
): Promise<{ multiplier: number; events: any[]; methodology: string }> {
    // 1. Query events for the target date
    const { data: events, error: eventsError } = await supabase
        .from('event_intelligence')
        .select('*')
        .eq('event_date', targetDate)
    if (eventsError) throw new Error(`Event intelligence query failed: ${eventsError.message}`)
    if (!events || events.length === 0) {
        return { multiplier: 1.0, events: [], methodology: 'no-events' }
    }
    
    // 2. Get store coordinates
    const { data: storeData, error: storeError } = await supabase
        .from('stores')
        .select('latitude, longitude')
        .eq('external_id', storeId)
        .single()
    
    const storeLat = Number(storeData?.latitude || 0)
    const storeLng = Number(storeData?.longitude || 0)
    
    // 3. Calculate distance-adjusted multiplier for each event
    const adjustedEvents = events.map((event: any) => {
        // If this forecast is already using an apples-to-apples holiday comp (e.g. Grito vs Grito),
        // the holiday impact is ALREADY in the historical base tickets.
        // Neutralize event_type === 'holiday' or duplicate holiday celebrations to 1.0 to prevent double-counting.
        const isHolidayDuplicate = isHolidayComp && (
            event.event_type === 'holiday' ||
            /grito|independencia|independence|cinco de mayo|halloween|thanksgiving|navidad|christmas|año nuevo|new year/i.test(event.event_name)
        )
        if (isHolidayDuplicate) {
            return { ...event, adjusted_multiplier: 1.0, is_baked_in: true }
        }

        let adjusted = clampEventMultiplier(Number(event.impact_multiplier))
        
        const hasVenue = Number.isFinite(Number(event.venue_latitude)) && Number.isFinite(Number(event.venue_longitude))
        if (hasVenue && storeLat !== 0 && storeLng !== 0 && !storeError) {
            const dist = distanceMiles(storeLat, storeLng, 
                Number(event.venue_latitude), Number(event.venue_longitude))
            adjusted = getDistanceAdjustedMultiplier(adjusted, dist, event.event_scope || 'regional', true)
        } else if (event.event_scope !== 'national') {
            // Never apply a local/regional event globally when its location cannot be verified.
            adjusted = 1
        }
        
        return { ...event, adjusted_multiplier: adjusted, is_baked_in: false }
    })
    
    // 4. Combine: Most impactful event dominates, secondary effects at 30%
    const sorted = adjustedEvents.sort((a: any, b: any) =>
        String(a.event_name).localeCompare(String(b.event_name))
    )
    // Symmetric composition: opposing events cancel regardless of database row order.
    const finalMultiplier = combineEventMultipliers(sorted.map((event: any) => event.adjusted_multiplier))
    
    return { 
        multiplier: finalMultiplier, 
        events: sorted.map((e: any) => ({ name: e.event_name, type: e.event_type, adjusted: e.adjusted_multiplier })),
        methodology: `${sorted.length} event(s): ${sorted.map((e: any) => e.event_name).join(', ')}`
    }
}

export async function seedHolidayEvents(year: number): Promise<number> {
    // Import holidays dynamically
    const { HOLIDAY_CALENDAR, getHolidayImpact, getHolidayMultiplier } = await import('@/lib/holidays')
    const { getSupabaseAdminClient } = await import('@/lib/supabase')
    const admin = await getSupabaseAdminClient()
    
    let inserted = 0
    const dateKey = `date${year}` as keyof typeof HOLIDAY_CALENDAR[0]

    for (const h of HOLIDAY_CALENDAR) {
        const dateStr = h[dateKey] as string | undefined
        if (!dateStr) continue

        const name = h.name
        const impact = getHolidayImpact(dateStr)
        const multiplier = getHolidayMultiplier(dateStr)

        const { error } = await admin.from('event_intelligence').upsert({
            event_date: dateStr,
            event_name: name,
            event_type: 'holiday',
            event_scope: 'national',
            impact_prediction: impact === 'HIGH' ? 'high_boost' : impact === 'LOW' ? 'high_drop' : impact === 'CLOSED' ? 'severe_drop' : 'neutral',
            impact_multiplier: multiplier,
            confidence: 'high',
            description: `Holiday estático de holidays.ts: ${name} (${impact})`,
            source: 'holidays_ts'
        }, { onConflict: 'event_date,event_name' })

        if (!error) {
            inserted++
        } else {
            console.error(`Error al sembrar ${name}:`, error.message)
        }
    }
    
    return inserted
}
