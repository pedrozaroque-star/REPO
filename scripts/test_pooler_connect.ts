import { Client } from 'pg'
import fs from 'fs'
import path from 'path'

async function testAllRegions() {
  const projectRef = 'ywwwdcvgfculqmcfkihq'
  const password = '100Prechivas.com'

  const regions = [
    'us-west-1', 'us-west-2', 'us-east-1', 'us-east-2',
    'ca-central-1', 'eu-west-1', 'eu-central-1', 'ap-southeast-1', 'sa-east-1'
  ]

  for (const region of regions) {
    const host = `aws-0-${region}.pooler.supabase.com`
    const connectionString = `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}@${host}:6543/postgres`
    const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } })
    try {
      await client.connect()
      console.log(`🎉 SUCCESS! Connected to Supabase in region: ${region}`)
      
      const sqlFilePath = path.join(process.cwd(), 'sql', 'miles_iq_schema.sql')
      const sql = fs.readFileSync(sqlFilePath, 'utf8')
      console.log('Running MilesIQ migration...')
      await client.query(sql)
      console.log('✅ MILESIQ MIGRATION EXECUTED SUCCESSFULLY!')

      await client.end()
      return true
    } catch (e: any) {
      if (!e.message.includes('ENOTFOUND')) {
        console.log(`Region ${region} output:`, e.message)
      }
      try { await client.end() } catch {}
    }
  }

  // Try direct db connection on port 5432 with host db.ywwwdcvgfculqmcfkihq.supabase.co
  // Let's resolve IP for ywwwdcvgfculqmcfkihq.supabase.co
  const dns = require('dns')
  dns.lookup('ywwwdcvgfculqmcfkihq.supabase.co', async (err: any, address: string) => {
    console.log('Lookup ywwwdcvgfculqmcfkihq.supabase.co ->', address)
  })
}

testAllRegions()
