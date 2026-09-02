/**
 * Diagnosticar la conexión y tokens de QuickBooks Online
 * Run via: npx tsx scripts/diagnose-qb.ts
 */

import dotenv from 'dotenv'
import path from 'path'
import { supabaseAdmin } from '../lib/supabase'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function diagnose() {
  console.log('=== DIAGNÓSTICO DE QUICKBOOKS ONLINE ===')
  console.log('QUICKBOOKS_ENVIRONMENT:', process.env.QUICKBOOKS_ENVIRONMENT)
  console.log('QUICKBOOKS_CLIENT_ID:', process.env.QUICKBOOKS_CLIENT_ID?.substring(0, 10) + '...')
  console.log('QUICKBOOKS_REDIRECT_URI:', process.env.QUICKBOOKS_REDIRECT_URI)

  const { data: integrations, error } = await supabaseAdmin
    .from('integrations')
    .select('*')
    .eq('service_name', 'quickbooks')

  if (error) {
    console.error('Error querying integrations table:', error.message)
    return
  }

  console.log(`\nEncontradas ${integrations?.length || 0} integraciones en la tabla 'integrations':`)
  for (const integ of integrations || []) {
    console.log({
      id: integ.id,
      realm_id: integ.realm_id,
      token_type: integ.token_type,
      expires_at: integ.expires_at,
      is_expired: new Date(integ.expires_at) <= new Date(),
      created_at: integ.created_at,
      updated_at: integ.updated_at
    })
  }
}

diagnose()
