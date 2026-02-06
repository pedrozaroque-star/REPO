/**
 * 📊 DEMAND VS SHIFTS - Simple Analysis
 * Consulta directa a Supabase para comparar demanda vs turnos
 * 
 * Usage: npx ts-node scripts/analyze-demand-simple.ts
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ywwwdcvgfculqmcfkihq.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(supabaseUrl, supabaseKey)

const WEEK_START = '2026-02-09'
const STORE_NAME = 'Lynwood'

async function main() {
    console.log('═══════════════════════════════════════════════════════════════')
    console.log('📊 ANÁLISIS: DEMANDA vs TURNOS PUBLICADOS')
    console.log('═══════════════════════════════════════════════════════════════')
    console.log(`🏪 Tienda: ${STORE_NAME}`)
    console.log(`📅 Semana: ${WEEK_START}`)
    console.log('')

    // 1. Get store
    const { data: store } = await supabase
        .from('stores')
        .select('external_id, name')
        .ilike('name', `%${STORE_NAME}%`)
        .single()

    if (!store) {
        console.error('❌ Store not found')
        return
    }
    console.log(`✅ Store ID: ${store.external_id}`)

    // 2. Get published shifts
    const { data: shifts } = await supabase
        .from('open_shifts')
        .select('*')
        .eq('store_id', store.external_id)
        .eq('week_start', WEEK_START)
        .order('shift_date')
        .order('start_hour')

    console.log(`📋 Turnos encontrados: ${shifts?.length || 0}`)
    console.log('')

    // 3. Get demand forecast
    const { data: forecast } = await supabase
        .from('sales_daily_cache')
        .select('*')
        .eq('store_id', store.external_id)
        .gte('business_date', WEEK_START)
        .lt('business_date', '2026-02-16')
        .order('business_date')

    console.log(`📈 Días de forecast: ${forecast?.length || 0}`)
    console.log('')

    // 4. Analyze each day
    const days = ['2026-02-09', '2026-02-10', '2026-02-11', '2026-02-12', '2026-02-13', '2026-02-14', '2026-02-15']
    const dayNames = ['Lunes 9', 'Martes 10', 'Miércoles 11', 'Jueves 12', 'Viernes 13', 'Sábado 14', 'Domingo 15']

    for (let i = 0; i < days.length; i++) {
        const date = days[i]
        const dayName = dayNames[i]

        console.log('───────────────────────────────────────────────────────────────')
        console.log(`📅 ${dayName} (${date})`)
        console.log('───────────────────────────────────────────────────────────────')

        // Get shifts for this day
        const dayShifts = shifts?.filter(s => s.shift_date === date) || []
        const kitchenShifts = dayShifts.filter(s => s.position_type === 'kitchen')
        const cashierShifts = dayShifts.filter(s => s.position_type === 'cashier')

        console.log(`   🍳 Cocina: ${kitchenShifts.length} turnos`)
        kitchenShifts.forEach(s => {
            console.log(`      - ${formatTime(s.start_hour)} - ${formatTime(s.end_hour)} (${s.required_count} spots)`)
        })

        console.log(`   💵 Cajeros: ${cashierShifts.length} turnos`)
        cashierShifts.forEach(s => {
            console.log(`      - ${formatTime(s.start_hour)} - ${formatTime(s.end_hour)} (${s.required_count} spots)`)
        })

        // Calculate hourly coverage
        console.log('')
        console.log('   📊 Cobertura por hora:')

        const hours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3]
        const hourLabels = ['8a', '9a', '10a', '11a', '12p', '1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p', '10p', '11p', '12a', '1a', '2a', '3a']

        let kitchenLine = '      Cocina: '
        let cashierLine = '      Cajero: '

        for (let j = 0; j < hours.length; j++) {
            const h = hours[j]
            const hNorm = h < 6 ? h + 24 : h

            // Count kitchen coverage
            let kitchenCov = 0
            for (const s of kitchenShifts) {
                let endH = s.end_hour
                if (endH <= s.start_hour) endH += 24
                if (hNorm >= s.start_hour && hNorm < endH) {
                    kitchenCov += s.required_count
                }
            }

            // Count cashier coverage
            let cashierCov = 0
            for (const s of cashierShifts) {
                let endH = s.end_hour
                if (endH <= s.start_hour) endH += 24
                if (hNorm >= s.start_hour && hNorm < endH) {
                    cashierCov += s.required_count
                }
            }

            kitchenLine += kitchenCov.toString().padStart(3)
            cashierLine += cashierCov.toString().padStart(3)
        }

        console.log('      Hora:   ' + hourLabels.map(h => h.padStart(3)).join(''))
        console.log(kitchenLine)
        console.log(cashierLine)
        console.log('')
    }

    console.log('═══════════════════════════════════════════════════════════════')
    console.log('✅ Análisis completo')
}

function formatTime(hour: number): string {
    if (hour === 0) return '12:00 AM'
    if (hour === 12) return '12:00 PM'
    if (hour < 12) return `${hour}:00 AM`
    return `${hour - 12}:00 PM`
}

main().catch(console.error)
