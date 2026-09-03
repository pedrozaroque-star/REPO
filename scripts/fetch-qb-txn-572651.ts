import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function fetchTxn() {
  const { supabaseAdmin } = await import('../lib/supabase')
  const { data: integ } = await supabaseAdmin
    .from('integrations')
    .select('*')
    .eq('service_name', 'quickbooks')
    .single()

  const realmId = integ.realm_id
  const token = integ.access_token
  const baseUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}`

  const res = await fetch(`${baseUrl}/journalentry/572651?minorversion=75`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    }
  })

  if (!res.ok) {
    console.error('Error fetching txn:', res.status, await res.text())
    return
  }

  const data = await res.json()
  console.log('QB Txn 572651 Data:\n', JSON.stringify(data, null, 2))
}

fetchTxn().catch(console.error)
