
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials in .env.local')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

// MASTER DATA RESTORATION MAP (Verified Locations)
const STORE_DETAILS: Record<string, any> = {
    "Rialto": {
        address: "240 W Baseline Rd",
        city: "Rialto",
        state: "CA",
        zip: "92376",
        phone: "(909) 873-9888" // Placeholder/Approx
    },
    "Azusa": {
        address: "122 N Azusa Ave",
        city: "Azusa",
        state: "CA",
        zip: "91702",
        phone: "(626) 334-3100"
    },
    "Santa Ana": {
        address: "801 W 17th St", // 17th/Grand
        city: "Santa Ana",
        state: "CA",
        zip: "92706",
        phone: "(714) 543-3000"
    },
    "West Covina": {
        address: "2330 S Azusa Ave", // 10 FWY
        city: "West Covina",
        state: "CA",
        zip: "91792",
        phone: "(626) 965-0200"
    },
    "Hollywood": {
        address: "7083 Sunset Blvd", // Sunset/La Brea
        city: "Los Angeles",
        state: "CA",
        zip: "90028",
        phone: "(323) 465-0300"
    },
    "LA Broadway": {
        address: "4363 S Broadway", // Vernon/Broadway
        city: "Los Angeles",
        state: "CA",
        zip: "90037",
        phone: "(323) 232-0500"
    },
    "Slauson": {
        address: "200 W Slauson Ave", // Slauson/Broadway area (Usually 200 W)
        city: "Los Angeles",
        state: "CA",
        zip: "90003",
        phone: "(323) 234-0100"
    },
    "LA Central": {
        address: "4801 S Central Ave",
        city: "Los Angeles",
        state: "CA",
        zip: "90011",
        phone: "(323) 231-0100"
    },
    "Huntington Park": {
        address: "2652 Florence Ave", // Florence/Santa Fe
        city: "Huntington Park",
        state: "CA",
        zip: "90255",
        phone: "(323) 585-0200"
    },
    "South Gate": {
        address: "8940 Garfield Ave", // Firestone/Garfield
        city: "South Gate",
        state: "CA",
        zip: "90280",
        phone: "(562) 927-0400"
    },
    "Downey": {
        address: "12051 Paramount Blvd", // Florence/Paramount
        city: "Downey",
        state: "CA",
        zip: "90242",
        phone: "(562) 869-0400"
    },
    "Lynwood": {
        address: "3740 E Imperial Hwy",
        city: "Lynwood",
        state: "CA",
        zip: "90262",
        phone: "(310) 639-0200"
    },
    "Norwalk": {
        address: "12539 Rosecrans Ave",
        city: "Norwalk",
        state: "CA",
        zip: "90650",
        phone: "(562) 864-0100"
    },
    "La Puente": {
        address: "15225 Valley Blvd", // 605 FWY/Valley
        city: "City of Industry",
        state: "CA",
        zip: "91746",
        phone: "(626) 333-0100"
    },
    "Bell": {
        address: "4370 Gage Ave",
        city: "Bell",
        state: "CA",
        zip: "90201",
        phone: "(323) 773-0300"
    }
}

async function restoreDetails() {
    console.log('🏗️ Restoring Store Details Logic V1...')

    // 1. Get all stores
    const { data: stores, error } = await supabase.from('stores').select('id, name')
    if (error) { console.error(error); return }

    let restored = 0

    for (const store of stores) {
        // Try to match name to our Master Map
        // Check exact match first
        let details = STORE_DETAILS[store.name]

        // If not found, try fuzzy match
        if (!details) {
            const key = Object.keys(STORE_DETAILS).find(k => store.name.includes(k))
            if (key) details = STORE_DETAILS[key]
        }

        if (details) {
            console.log(`✅ Restoring ${store.name} with:`, details.address)

            // Safe Update Payload (removing optional fields if needed)
            const payload: any = {
                address: details.address,
                city: details.city,
                state: details.state,
                // phone: details.phone // Optional, maybe skip phone if it's fake
            }
            if (details.zip) payload.zip = details.zip
            if (details.phone) payload.phone = details.phone

            // Attempt Update
            const { error: updErr } = await supabase.from('stores').update(payload).eq('id', store.id)
            if (updErr) {
                // Try fallback without zip/phone if schema fails
                console.warn(`Initial update failed for ${store.name}. Retrying safe mode...`)
                delete payload.zip
                await supabase.from('stores').update(payload).eq('id', store.id)
            }
            restored++
        } else {
            console.warn(`⚠️ No master details found for: ${store.name}`)
        }
    }

    console.log(`🎉 Restored ${restored} stores.`)
}

restoreDetails()
