import pg from 'pg'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const projectRef = 'ywwwdcvgfculqmcfkihq'
const dbPass = '100Prechivas.com'

async function connectToDb(): Promise<pg.Client> {
  const directHosts = [
    `aws-0-us-west-1.pooler.supabase.com`,
    `aws-0-us-east-1.pooler.supabase.com`,
    `aws-0-us-east-2.pooler.supabase.com`,
    `aws-0-us-west-2.pooler.supabase.com`
  ]

  for (const host of directHosts) {
    const user = `postgres.${projectRef}`
    const port = 6543
    const connectionString = `postgresql://${user}:${encodeURIComponent(dbPass)}@${host}:${port}/postgres`
    
    console.log(`Connecting to ${host}:${port}...`)
    const client = new pg.Client({
      connectionString,
      ssl: { rejectUnauthorized: false }
    })
    try {
      await client.connect()
      console.log(`✅ Conectado a PostgreSQL via ${host}!`)
      return client
    } catch (e: any) {
      console.log(`❌ ${host}: ${e.message}`)
      try { await client.end() } catch {}
    }
  }

  throw new Error('No se pudo conectar a PostgreSQL en Supabase.')
}

async function run() {
  const client = await connectToDb()
  try {
    const createSql = `
      CREATE TABLE IF NOT EXISTS supervisor_store_visits (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        supervisor_id TEXT NOT NULL,
        supervisor_name TEXT NOT NULL,
        supervisor_email TEXT,
        store_id BIGINT,
        store_name TEXT NOT NULL,
        visited_at TIMESTAMPTZ DEFAULT NOW(),
        business_date DATE NOT NULL,
        source TEXT NOT NULL DEFAULT 'gps_auto', -- 'gps_auto', 'inspection', 'manual_checkin', 'navigation_start'
        latitude NUMERIC,
        longitude NUMERIC,
        trip_logged BOOLEAN DEFAULT FALSE,
        trip_id UUID REFERENCES supervisor_mileage_trips(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_store_visits_sup_date ON supervisor_store_visits(supervisor_id, business_date);
      CREATE INDEX IF NOT EXISTS idx_store_visits_visited_at ON supervisor_store_visits(visited_at DESC);
    `
    console.log('Creating supervisor_store_visits table...')
    await client.query(createSql)
    console.log('✅ supervisor_store_visits table created successfully!')
  } catch (err: any) {
    console.error('Error:', err.message)
  } finally {
    await client.end()
  }
}

run()
