const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = 'https://ywwwdcvgfculqmcfkihq.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function run() {
    console.log('--- ESTRUCTURA DE LA TABLA shifts ---')
    const { data: sample } = await supabase.from('shifts').select('*').limit(1)
    if (sample && sample.length > 0) {
        console.log('Columnas encontradas:', Object.keys(sample[0]))
    }

    console.log('\n--- REVISANDO TURNOS DE SLAUSON HOY ---')
    const { data: shifts } = await supabase.from('shifts')
        .select('id, employee_id, breaks_schedule')
        .eq('store_id', '9625621e-1b5e-48d7-87ae-7094fab5a4fd')
        .eq('shift_date', '2026-04-13')
    
    console.log(shifts)
}

run()
