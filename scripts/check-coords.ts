
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
    console.error("❌ Missing keys")
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function check() {
    const { data: stores, error } = await supabase.from('stores').select('id, name, latitude, longitude, address, city, state, zip_code')
    if (error) {
        console.error("Error:", error)
        return
    }

    console.log("Store Data in Supabase:")
    stores.forEach(s => {
        console.log(`- ${s.name}: Lat=${s.latitude}, Lon=${s.longitude} | Addr: ${s.address}, ${s.city}`)
    })
}

check()
