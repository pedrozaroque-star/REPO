import { Client } from 'pg'
import dns from 'dns/promises'
import fs from 'fs'
import path from 'path'

async function connectIp() {
  const projectRef = 'ywwwdcvgfculqmcfkihq'
  const password = '100Prechivas.com'
  
  const lookup = await dns.lookup(`${projectRef}.supabase.co`)
  console.log(`IP resolved for ${projectRef}.supabase.co: ${lookup.address}`)

  const users = [`postgres.${projectRef}`, 'postgres']
  const ports = [5432, 6543]

  for (const user of users) {
    for (const port of ports) {
      console.log(`Trying IP ${lookup.address}:${port} as ${user}...`)
      const client = new Client({
        host: lookup.address,
        port,
        user,
        password,
        database: 'postgres',
        ssl: { rejectUnauthorized: false }
      })
      try {
        await client.connect()
        console.log(`🎉 SUCCESS! Connected via IP ${lookup.address}:${port}!`)
        const sqlFilePath = path.join(process.cwd(), 'sql', 'miles_iq_schema.sql')
        const sql = fs.readFileSync(sqlFilePath, 'utf8')
        console.log('Running MilesIQ migration...')
        await client.query(sql)
        console.log('✅ MILESIQ MIGRATION EXECUTED SUCCESSFULLY!')
        await client.end()
        return
      } catch (e: any) {
        console.log(`❌ Failed:`, e.message)
        try { await client.end() } catch {}
      }
    }
  }
}

connectIp()
