
import { getSupabaseClient } from '../lib/supabase'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

async function testSetup() {
    console.log('🔍 Iniciando verificación de sistema...')

    // 1. Check API Key
    const key = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY
    if (!key) {
        console.error('❌ ERROR: No se encontró GOOGLE_MAPS_API_KEY en .env.local')
    } else {
        console.log('✅ API Key encontrada (termina en ' + key.slice(-4) + ')')
    }

    // 2. Test Weather API (using a fixed location - Los Angeles)
    console.log('\n🌦️ Probando conexión a Google Weather API...')
    try {
        const testUrl = `https://weather.googleapis.com/v1/forecast/days:lookup?location.latitude=34.05&location.longitude=-118.24&days=1&unitsSystem=IMPERIAL&key=${key}`
        const res = await fetch(testUrl)
        if (res.ok) {
            const json = await res.json()
            console.log('✅ Conexión Exitosa. Clima en LA:', json.dailyForecasts?.[0]?.condition?.description || 'OK')
        } else {
            console.error('❌ Error API Clima:', await res.text())
        }
    } catch (e: any) {
        console.error('❌ Excepción probando API:', e.message)
    }

    // 3. Test Database Schema
    console.log('\n💾 Verificando Base de Datos...')
    const supabase = await getSupabaseClient()

    // Check 'calendar_events'
    const { error: eventError } = await supabase.from('calendar_events').select('count').limit(1)
    if (eventError) {
        if (eventError.code === '42P01') {
            console.error('❌ Falta la tabla "calendar_events". Ejecuta el script de migración.')
        } else {
            console.error('⚠️ Error accediendo a calendar_events:', eventError.message)
        }
    } else {
        console.log('✅ Tabla "calendar_events" existe.')
    }

    // Check 'stores' coordinates
    const { data: stores, error: storeError } = await supabase.from('stores').select('id, name, latitude, longitude').limit(1)
    if (!storeError && stores && stores.length > 0) {
        const s = stores[0]
        console.log(`ℹ️ Revisando tienda: ${s.name}`)
        if (s.latitude !== undefined) {
            console.log('✅ Columnas de coordenadas detectadas.')
            if (s.latitude === null) console.warn('⚠️ La columna existe pero la latitud es NULL. Recuerda actualizar las coordenadas.')
            else console.log(`✅ Coordenadas OK: ${s.latitude}, ${s.longitude}`)
        } else {
            console.error('❌ Faltan columnas latitude/longitude en tabla stores.')
        }
    } else {
        console.error('❌ Error accediendo a stores:', storeError?.message)
    }
}

testSetup()
