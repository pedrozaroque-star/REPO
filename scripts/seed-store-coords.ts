
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

// Load environment variables manually since we are in a script context
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const envPath = path.resolve(__dirname, '../.env.local')
dotenv.config({ path: envPath })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY // Use Service Role for Updates

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Missing Supabase keys in .env.local")
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

// Coordenadas aproximadas para los 15 Stores (Fuente: Google Maps rápida)
const STORE_COORDS: Record<string, { lat: number, lon: number }> = {
    // Si tienes los GUIDs exactos mapeados en `lib/toast-api.ts`, usaré los nombres para buscar
    'Rialto': { lat: 34.1064, lon: -117.3703 },
    'Azusa': { lat: 34.1336, lon: -117.9076 },
    'Norwalk': { lat: 33.9022, lon: -118.0817 },
    'Downey': { lat: 33.9401, lon: -118.1332 },
    'LA Broadway': { lat: 34.0205, lon: -118.2787 }, // Tacos Gavilan Broadway
    'Bell': { lat: 33.9775, lon: -118.1870 },
    'Hollywood': { lat: 34.0900, lon: -118.3100 }, // Aprox central
    'Huntington Park': { lat: 33.9817, lon: -118.2251 },
    'LA Central': { lat: 34.0093, lon: -118.2564 }, // Central & 21st (aprox)
    'La Puente': { lat: 34.0200, lon: -117.9495 },
    'Lynwood': { lat: 33.9303, lon: -118.2115 },
    'Santa Ana': { lat: 33.7455, lon: -117.8677 },
    'Slauson': { lat: 33.9892, lon: -118.3000 },
    'South Gate': { lat: 33.9547, lon: -118.2120 },
    'West Covina': { lat: 34.0686, lon: -117.9390 }
}

async function updateStoreCoordinates() {
    console.log("🌦️ Updating Store Coordinates for Weather...")

    // 1. Get all stores
    const { data: stores, error } = await supabase.from('stores').select('*')
    if (error) {
        console.error("Error fetching stores:", error)
        return
    }

    console.log(`Found ${stores.length} stores in DB.`)

    for (const store of stores) {
        const name = store.name
        // Try to fuzzy match keys in STORE_COORDS
        const matchedKey = Object.keys(STORE_COORDS).find(k => name.includes(k))

        if (matchedKey) {
            const coords = STORE_COORDS[matchedKey]
            console.log(`✅ Updating ${name} -> Lat: ${coords.lat}, Lon: ${coords.lon}`)

            const { error: updateErr } = await supabase
                .from('stores')
                .update({ latitude: coords.lat, longitude: coords.lon })
                .eq('id', store.id)

            if (updateErr) console.error(`   ❌ Failed to update ${name}:`, updateErr.message)
        } else {
            console.warn(`⚠️ No coordinates found for: ${name}`)
        }
    }

    console.log("\n⚠️ NOTE: This script updates 'stores' table columns 'latitude' and 'longitude'.")
    console.log("If those columns do not exist, this script will fail. Make sure to run migration first if needed.")
}

updateStoreCoordinates()
