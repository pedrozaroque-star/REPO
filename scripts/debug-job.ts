
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function checkJobExistence() {
    const jobGuid = '90bdf5aa-9c50-440d-a8cb-3c77f4816a0f'
    console.log(`🔍 Buscando Job GUID: ${jobGuid}`)

    const { data: job, error } = await supabase
        .from('toast_jobs')
        .select('*')
        .eq('guid', jobGuid)
        .single()

    if (error) {
        console.error('Job NOT found error:', error.message)
    } else if (job) {
        console.log('✅ Job encontrado:', job)
    } else {
        console.log('❌ Job NO encontrado en la tabla toast_jobs.')
    }
}

checkJobExistence()
