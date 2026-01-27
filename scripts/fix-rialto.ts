
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

if (!supabaseUrl || !supabaseKey) { process.exit(1) }
const supabase = createClient(supabaseUrl, supabaseKey)

async function fix() {
    // Ajuste visual basado en feedback usuario (Esquina NE de Riverside & Baseline)
    const lat = 34.121330
    const lon = -117.369950
    console.log(`Fixing Rialto to ${lat}, ${lon}`)
    await supabase.from('stores').update({ latitude: lat, longitude: lon }).ilike('name', '%Rialto%')
}
fix()
