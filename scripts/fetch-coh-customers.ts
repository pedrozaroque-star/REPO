import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function fetchCohCustomers() {
  const { supabaseAdmin } = await import('../lib/supabase')
  const { data: integ } = await supabaseAdmin
    .from('integrations')
    .select('*')
    .eq('service_name', 'quickbooks')
    .single()

  const realmId = integ.realm_id
  const token = integ.access_token
  const baseUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}`

  const sql = encodeURIComponent("SELECT Id, DisplayName, FullyQualifiedName FROM Customer WHERE Active = true MAXRESULTS 500")
  const res = await fetch(`${baseUrl}/query?query=${sql}&minorversion=75`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    }
  })

  if (!res.ok) {
    console.error('Error fetching customers:', res.status, await res.text())
    return
  }

  const data = await res.json()
  const customers = data.QueryResponse?.Customer || []
  console.log(`Total customers found in QB: ${customers.length}`)

  const cohCustomers = customers.filter((c: any) => c.DisplayName.includes('COH') || c.DisplayName.includes('CASH') || c.DisplayName.includes('DEP'))
  console.log('\nCOH Customers in QuickBooks:')
  for (const c of cohCustomers) {
    console.log(`  • ID #${c.Id} : "${c.DisplayName}"`)
  }

  // Also print all store names matching customers
  const storeNames = ['Azusa', 'Bell', 'Broadway', 'Central', 'Downey', 'Hollywood', 'Huntington', 'Puente', 'Lynwood', 'Norwalk', 'Rialto', 'Santa Ana', 'Slauson', 'South Gate', 'West Covina']
  console.log('\nStore matching Customers:')
  for (const s of storeNames) {
    const matches = customers.filter((c: any) => c.DisplayName.toLowerCase().includes(s.toLowerCase()))
    console.log(`  Store ${s}:`, matches.map((m: any) => `#${m.Id} "${m.DisplayName}"`))
  }
}

fetchCohCustomers().catch(console.error)
