
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
    console.error("❌ Missing Supabase keys")
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

// Coordenadas verificadas manualmente por el usuario
const VERIFIED_COORDS: Record<string, { lat: number, lon: number }> = {
    'Central': { lat: 34.024078, lon: -118.250493 }, // LA Central
    'Lynwood': { lat: 33.930022, lon: -118.212425 },
    'Broadway': { lat: 34.004015, lon: -118.277911 }, // LA Broadway
    'Slauson': { lat: 33.988899, lon: -118.278610 },
    'Norwalk': { lat: 33.901886, lon: -118.100366 },
    'Rialto': { lat: 34.121103, lon: -117.370289 },
    'West Covina': { lat: 34.071066, lon: -117.908171 },
    'South Gate': { lat: 33.948675, lon: -118.164704 },
    'Downey': { lat: 33.953998, lon: -118.130252 },
    'Hollywood': { lat: 34.097652, lon: -118.343770 },
    'Santa Ana': { lat: 33.759732, lon: -117.852561 },
    'Huntington Park': { lat: 33.974911, lon: -118.229275 },
    'La Puente': { lat: 34.053282, lon: -118.001698 },
    'Azusa': { lat: 34.107018, lon: -117.908084 },
    'Bell': { lat: 33.970138, lon: -118.189099 }
}

async function update() {
    console.log("📍 Applying USER VERIFIED coordinates...")

    const { data: stores, error } = await supabase.from('stores').select('*')
    if (error) return console.error(error)

    for (const store of stores) {
        // Encontrar la clave que coincida con el nombre de la tienda
        const key = Object.keys(VERIFIED_COORDS).find(k => store.name.includes(k))

        if (key) {
            const coords = VERIFIED_COORDS[key]
            console.log(`✅ Updating ${store.name} -> ${coords.lat}, ${coords.lon}`)

            const { error: upErr } = await supabase
                .from('stores')
                .update({ latitude: coords.lat, longitude: coords.lon })
                .eq('id', store.id)

            if (upErr) console.error(`   ❌ Update failed: ${upErr.message}`)
        } else {
            console.warn(`⚠️ No verified match found for: ${store.name}`)
        }
    }
    console.log("Done!")
}

update()
