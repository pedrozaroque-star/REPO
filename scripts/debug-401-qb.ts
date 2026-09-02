import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function debug401() {
  const { supabaseAdmin } = await import('../lib/supabase')
  const { data: integ } = await supabaseAdmin
    .from('integrations')
    .select('*')
    .eq('service_name', 'quickbooks')
    .single()

  console.log('Realm ID:', integ.realm_id)
  console.log('Access Token:', integ.access_token?.substring(0, 25) + '...')
  console.log('Refresh Token:', integ.refresh_token?.substring(0, 15) + '...')

  // Try direct fetch to QuickBooks API
  const url = `https://quickbooks.api.intuit.com/v3/company/${integ.realm_id}/companyinfo/${integ.realm_id}?minorversion=75`
  console.log('\nFetching:', url)

  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${integ.access_token}`,
      'Accept': 'application/json'
    }
  })

  console.log('HTTP Status:', res.status, res.statusText)
  const text = await res.text()
  console.log('Response Body:', text)
}

debug401().catch(console.error)
