
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing Supabase credentials')
    process.exit(1)
}

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
    console.log("Searching for 'Piña Concentrate'...")
    const { data, error } = await supabase
        .from('inventory_items')
        .select('*')
        .ilike('name', '%Piña Concentrate%') // Assuming precise name

    if (error) {
        console.error("Error:", error)
        return
    }

    if (!data || data.length === 0) {
        console.log("No item found.")
        return
    }

    data.forEach(item => {
        console.log("Item Found:")
        console.log(JSON.stringify(item, null, 2))
    })
}

main()
