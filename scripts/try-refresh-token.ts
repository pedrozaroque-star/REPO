import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function tryRefresh() {
  const { getAuthClient } = await import('../lib/quickbooks')
  const { supabaseAdmin } = await import('../lib/supabase')

  const { data: integ } = await supabaseAdmin.from('integrations').select('*').eq('service_name', 'quickbooks').single()

  if (!integ) {
    console.error('No integration found')
    return
  }

  console.log('Integration ID:', integ.id)
  console.log('Realm ID:', integ.realm_id)
  console.log('Refresh Token length:', integ.refresh_token?.length)

  const authClient = getAuthClient()

  try {
    console.log('Attempting refreshUsingToken...')
    const res = await authClient.refreshUsingToken(integ.refresh_token)
    const json = res.getJson()
    console.log('✅ REFRESH SUCCESSFUL!')
    console.log('New Access Token length:', json.access_token?.length)
    console.log('New Refresh Token length:', json.refresh_token?.length)

    // Save to DB
    await supabaseAdmin.from('integrations').update({
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expires_at: new Date(Date.now() + json.expires_in * 1000),
      updated_at: new Date()
    }).eq('id', integ.id)

    console.log('✅ Updated in Supabase!')
  } catch (err: any) {
    console.error('❌ Refresh failed:', err.originalMessage || err.message)
    if (err.authResponse) {
      console.error('Auth Response Body:', err.authResponse.text())
    }
  }
}

tryRefresh()
