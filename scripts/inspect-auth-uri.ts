/**
 * Inspect OAuth authorizeUri parameters
 * Run via: npx tsx scripts/inspect-auth-uri.ts
 */

import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function inspectAuth() {
  const { getAuthClient } = await import('../lib/quickbooks')
  const OAuthClient = (await import('intuit-oauth')).default

  const client = getAuthClient()
  const authUri = client.authorizeUri({
    scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
    state: 'init',
  })

  console.log('Generated Auth URI:\n', authUri)

  const url = new URL(authUri)
  console.log('\nParsed Auth URL Parameters:')
  console.log('Host:', url.host)
  console.log('Pathname:', url.pathname)
  for (const [k, v] of url.searchParams.entries()) {
    console.log(`  • ${k}: ${v}`)
  }
}

inspectAuth().catch(console.error)
