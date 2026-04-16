const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = 'https://ywwwdcvgfculqmcfkihq.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function run() {
    console.log('--- LISTANDO TODAS LAS TABLAS ---')
    const { data: tables, error } = await supabase.rpc('get_tables') // Usually not a public RPC
    if (error) console.log('RPC Error (Expected):', error.message)

    // Alternative: Use informative query on toast_employees to see if we can at least count them
    const { count, error: countErr } = await supabase.from('toast_employees').select('*', { count: 'exact', head: true })
    console.log('Total Toast Employees in DB:', count)

    const { count: userCount, error: userErr } = await supabase.from('users').select('*', { count: 'exact', head: true })
    console.log('Total Users in DB:', userCount)
    if (userErr) console.log('User Table Error:', userErr.message) 
}

run()
