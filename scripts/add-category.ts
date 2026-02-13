import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials in .env.local')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function addCategory() {
    const categoryName = 'VIELE AND SONS'

    console.log(`Adding category "${categoryName}"...`)

    // Check if it already exists
    const { data: existing } = await supabase
        .from('inventory_categories')
        .select('*')
        .ilike('name', categoryName)
        .maybeSingle()

    if (existing) {
        console.log(`Category "${existing.name}" already exists with ID: ${existing.id}`)
        return
    }

    const { data, error } = await supabase
        .from('inventory_categories')
        .insert({ name: categoryName })
        .select()
        .single()

    if (error) {
        console.error('Error adding category:', error)
    } else {
        console.log(`Successfully added category "${data.name}" with ID: ${data.id}`)
    }
}

addCategory()
