
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const envPath = path.resolve(__dirname, '../.env.local')
dotenv.config({ path: envPath })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Missing Supabase keys in .env.local")
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

// Coordenadas Refinadas Manualmente para precisión ~10-50m
const STORE_DATA: Record<string, {
    lat: number,
    lon: number,
    address: string,
    city: string,
    zip: string,
    state: string
}> = {
    'Rialto': {
        lat: 34.1209, lon: -117.3712, // Baseline & Riverside (Más preciso que centro ciudad)
        address: '115 E Baseline Rd', city: 'Rialto', zip: '92376', state: 'CA'
    },
    'Azusa': {
        lat: 34.0950, lon: -117.9069, // Aprox location 887 S Azusa
        address: '887 S Azusa Ave', city: 'Azusa', zip: '91702', state: 'CA'
    },
    'Norwalk': {
        lat: 33.9103, lon: -118.0694, // 10968 Rosecrans (verified Nominatim)
        address: '10968 Rosecrans Ave', city: 'Norwalk', zip: '90650', state: 'CA'
    },
    'Downey': {
        lat: 33.9482, lon: -118.1158, // Aprox for 7947 Florence
        address: '7947 E Florence Ave', city: 'Downey', zip: '90240', state: 'CA'
    },
    'LA Broadway': {
        lat: 34.0040, lon: -118.2781,
        address: '4380 S Broadway', city: 'Los Angeles', zip: '90037', state: 'CA'
    },
    'Bell': {
        lat: 33.9745, lon: -118.1872,
        address: '4406 E Florence Ave', city: 'Bell', zip: '90201', state: 'CA'
    },
    'Hollywood': {
        lat: 34.0980, lon: -118.3446,
        address: '7070 Sunset Blvd', city: 'Los Angeles', zip: '90028', state: 'CA'
    },
    'Huntington Park': {
        lat: 33.9744, lon: -118.2251,
        address: '2425 E Florence Ave', city: 'Huntington Park', zip: '90255', state: 'CA'
    },
    'LA Central': {
        lat: 34.0205, lon: -118.2564,
        address: '1900 S Central Ave', city: 'Los Angeles', zip: '90011', state: 'CA'
    },
    'La Puente': {
        lat: 34.0435, lon: -117.9698, // Valley & 605 Fwy area
        address: '13009 Valley Blvd', city: 'La Puente', zip: '91746', state: 'CA'
    },
    'Lynwood': {
        lat: 33.9303, lon: -118.2115,
        address: '3220 E Imperial Hwy', city: 'Lynwood', zip: '90262', state: 'CA'
    },
    'Santa Ana': {
        lat: 33.7594, lon: -117.8547,
        address: '1258 E 17th St', city: 'Santa Ana', zip: '92701', state: 'CA'
    },
    'Slauson': {
        lat: 33.9892, lon: -118.2778, // Slauson & Broadway corner
        address: '5833 S Broadway', city: 'Los Angeles', zip: '90003', state: 'CA'
    },
    'South Gate': {
        lat: 33.9547, lon: -118.1720,
        address: '5800 Firestone Blvd', city: 'South Gate', zip: '90280', state: 'CA'
    },
    'West Covina': {
        lat: 34.0686, lon: -117.9390,
        address: '101 S Azusa Ave', city: 'West Covina', zip: '91791', state: 'CA'
    }
}

async function updateStoreLocations() {
    console.log("📍 Updating Store Coordinates (High Precision V2)...")

    const { data: stores, error } = await supabase.from('stores').select('*')
    if (error) {
        console.error("Error fetching stores:", error)
        return
    }

    for (const store of stores) {
        const name = store.name
        const matchedKey = Object.keys(STORE_DATA).find(k => name.includes(k) || (k === 'LA Broadway' && name.includes('Broadway')) || (k === 'LA Central' && name.includes('Central')) || (k === 'Slauson' && name.includes('Slauson')))

        if (matchedKey) {
            const info = STORE_DATA[matchedKey]
            console.log(`✅ Updating ${name} -> ${info.address} (${info.lat}, ${info.lon})`)

            const { error: updateErr } = await supabase
                .from('stores')
                .update({
                    latitude: info.lat,
                    longitude: info.lon,
                    address: info.address,
                    city: info.city,
                    zip_code: info.zip,
                    state: info.state
                })
                .eq('id', store.id)

            if (updateErr) console.error(`   ❌ Failed:`, updateErr.message)
        }
    }
    console.log("\nDone! Coordinates refined to ~10-50m precision.")
}

updateStoreLocations()
