/**
 * @module Cron/SyncEvents
 * @description Cron job diario que usa Gemini API con Google Search Grounding para
 * descubrir eventos próximos en el área de Los Angeles que puedan impactar las
 * ventas de Tacos Gavilan. Los eventos se guardan en la tabla `event_intelligence`.
 * @businessRules
 * - Se ejecuta diariamente a las 6:00 AM Pacific (13:00 UTC)
 * - Busca eventos en un radio de 14 días hacia adelante
 * - Los multiplicadores de impacto se calibran con datos históricos reales:
 *   Cinco de Mayo (1.25-1.40), Halloween (1.20), Super Bowl (0.88),
 *   Thanksgiving (0.35), 4th of July (0.78), etc.
 * - Incluye coordenadas de venues para cálculo de distancia a cada tienda
 * @dataFlow
 * Vercel Cron → GET /api/cron/sync-events → Gemini API (Google Search) → parse JSON → upsert event_intelligence
 * @notes
 * - Usa la REST API de Gemini directamente (no SDK) para evitar dependencias extras
 * - El proyecto ya usa este patrón en support-chat/route.ts
 * - Google Search Grounding permite buscar eventos en tiempo real
 */

import { NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

export async function GET(request: Request) {
    // Verify cron secret
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const apiKey = process.env.GEMINI_API_KEY
        if (!apiKey) {
            return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 })
        }

        // Build today's date in PST for the prompt
        const now = new Date()
        const todayPST = now.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })

        const PROMPT_TEXT = `Hoy es ${todayPST}. Busca en internet eventos importantes programados para los próximos 14 días en el Condado de Los Angeles y ciudades cercanas (Azusa, Bell, Downey, Hollywood, Huntington Park, Los Angeles, La Puente, Lynwood, Norwalk, Rialto, Santa Ana, South Gate, West Covina, Inglewood).

Busca específicamente:
- Deportes: Lakers, Dodgers, Rams, Chargers, LAFC, Galaxy, Kings, Angels, UFC, boxing en SoFi Stadium (33.9534,-118.3390), Crypto.com Arena (34.0430,-118.2673), Dodger Stadium (34.0739,-118.2400), BMO Stadium (34.0126,-118.2845), Angel Stadium (33.8003,-117.8827)
- Conciertos grandes (>5000 personas): The Forum (33.9583,-118.3416), Hollywood Bowl (34.1122,-118.3390), Rose Bowl (34.1613,-118.1676), SoFi Stadium, Crypto.com Arena
- Eventos culturales hispanos/latinos: Fiestas Patrias, ferias, festivales, procesiones religiosas, celebraciones comunitarias
- Días festivos: federales, estatales, escolares
- Alertas meteorológicas severas: olas de calor, tormentas, Santa Ana winds

INCLUYE la latitud y longitud del venue para CADA evento que tenga lugar físico.

Multiplicadores históricos de calibración para ventas de restaurantes:
- Cinco de Mayo: 1.25-1.40 (boost fuerte)
- Halloween: 1.20 (boost)
- Labor Day: 1.15 (boost)
- Super Bowl Sunday: 0.88 (baja, gente en casa)
- Father's Day: 0.85 (baja, familias en casa)
- 4th of July: 0.78 (baja fuerte, parrilladas en casa)
- Thanksgiving: 0.35 (caída severa)
- Christmas Eve: 0.40 (caída severa)
- Evento deportivo grande cercano: 1.02-1.06 (boost leve)
- Concierto masivo cercano: 1.02-1.05 (boost leve)
- Lluvia fuerte: 0.85-0.95 (baja)

Responde ÚNICAMENTE con un array JSON válido. Cada objeto debe tener:
{
  "event_date": "YYYY-MM-DD",
  "event_name": "nombre del evento",
  "event_type": "sports|cultural|holiday|concert|festival|weather|school|community",
  "event_scope": "national|regional|local",
  "impact_prediction": "very_high_boost|high_boost|moderate_boost|slight_boost|neutral|slight_drop|high_drop|severe_drop",
  "impact_multiplier": 1.00,
  "confidence": "high|medium|low",
  "description": "descripción en español del impacto esperado en ventas de restaurantes",
  "venue_name": "nombre o null",
  "venue_latitude": 34.0000,
  "venue_longitude": -118.0000
}

Si no encuentras eventos, devuelve un array vacío [].`

        // Call Gemini API with Google Search Grounding (REST, same pattern as support-chat)
        const response = await fetch(
            `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: PROMPT_TEXT }] }],
                    tools: [{ googleSearch: {} }],
                    generationConfig: {
                        temperature: 0.2,
                    }
                })
            }
        )

        if (!response.ok) {
            const errText = await response.text()
            console.error('[sync-events] Gemini API error:', response.status, errText.substring(0, 300))
            return NextResponse.json({ error: 'Gemini API error', status: response.status }, { status: 500 })
        }

        const geminiResult = await response.json()
        const rawText = geminiResult?.candidates?.[0]?.content?.parts?.[0]?.text || '[]'
        
        let events: any[] = []
        try {
            let cleanJsonStr = rawText.trim()
            if (cleanJsonStr.startsWith('```json')) {
                cleanJsonStr = cleanJsonStr.replace(/^```json\s*/, '').replace(/\s*```$/, '')
            } else if (cleanJsonStr.startsWith('```')) {
                cleanJsonStr = cleanJsonStr.replace(/^```\s*/, '').replace(/\s*```$/, '')
            }
            events = JSON.parse(cleanJsonStr)
            if (!Array.isArray(events)) events = [events]
        } catch (parseErr) {
            console.error('[sync-events] JSON parse error:', parseErr, 'Raw:', rawText.substring(0, 200))
            return NextResponse.json({ error: 'Failed to parse Gemini response', raw: rawText.substring(0, 200) }, { status: 500 })
        }

        // Upsert into Supabase
        const supabase = await getSupabaseAdminClient()
        let insertedCount = 0
        const errors: string[] = []

        for (const event of events) {
            if (!event.event_date || !event.event_name) continue

            const { error } = await supabase.from('event_intelligence').upsert({
                event_date: event.event_date,
                event_name: event.event_name,
                event_type: event.event_type || 'other',
                event_scope: event.event_scope || 'regional',
                impact_prediction: event.impact_prediction || 'neutral',
                impact_multiplier: event.impact_multiplier || 1.0,
                confidence: event.confidence || 'medium',
                description: event.description || null,
                source: 'gemini_search',
                venue_name: event.venue_name || null,
                venue_latitude: event.venue_latitude || null,
                venue_longitude: event.venue_longitude || null,
                raw_search_data: { raw: rawText.substring(0, 1000), fetched_at: todayPST },
            }, { onConflict: 'event_date,event_name' })

            if (error) {
                errors.push(`${event.event_name}: ${error.message}`)
            } else {
                insertedCount++
            }
        }

        console.log(`[sync-events] ✅ Synced ${insertedCount}/${events.length} events for next 14 days`)

        return NextResponse.json({
            success: true,
            message: `Event sync completed. ${insertedCount}/${events.length} events upserted.`,
            eventsProcessed: insertedCount,
            errors: errors.length > 0 ? errors : undefined,
            eventNames: events.map((e: any) => `${e.event_date}: ${e.event_name}`).slice(0, 10),
        })

    } catch (error) {
        console.error('[sync-events] Error:', error)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
