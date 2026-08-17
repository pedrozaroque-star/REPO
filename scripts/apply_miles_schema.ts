import pg from 'pg'
import fs from 'fs'
import path from 'path'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const regions = [
  'us-west-1', 'us-west-2', 'us-east-1', 'us-east-2',
  'eu-central-1', 'eu-west-1', 'ap-southeast-1', 'sa-east-1'
]

const projectRef = 'ywwwdcvgfculqmcfkihq'
const dbPass = '100Prechivas.com'

async function connectToDb(): Promise<pg.Client> {
  // First try direct connection
  const directHosts = [
    `db.${projectRef}.supabase.co`,
    `aws-0-us-west-1.pooler.supabase.com`,
    `aws-0-us-west-2.pooler.supabase.com`,
    `aws-0-us-east-1.pooler.supabase.com`,
    `aws-0-us-east-2.pooler.supabase.com`
  ]

  for (const host of directHosts) {
    const isPooler = host.includes('pooler')
    const user = isPooler ? `postgres.${projectRef}` : 'postgres'
    const port = isPooler ? 6543 : 5432
    const connectionString = `postgresql://${user}:${encodeURIComponent(dbPass)}@${host}:${port}/postgres`
    
    console.log(`Connecting to ${host}:${port} as ${user}...`)
    const client = new pg.Client({
      connectionString,
      ssl: { rejectUnauthorized: false }
    })
    try {
      await client.connect()
      console.log(`✅ Conectado con éxito a PostgreSQL via ${host}!`)
      return client
    } catch (e: any) {
      console.log(`❌ ${host}: ${e.message}`)
      try { await client.end() } catch {}
    }
  }

  // Next try session pooler
  for (const region of regions) {
    const host = `aws-0-${region}.pooler.supabase.com`
    const connectionString = `postgresql://postgres.${projectRef}:${encodeURIComponent(dbPass)}@${host}:5432/postgres`
    const client = new pg.Client({
      connectionString,
      ssl: { rejectUnauthorized: false }
    })
    try {
      await client.connect()
      console.log(`✅ Conectado con éxito a PostgreSQL via ${host}:5432!`)
      return client
    } catch (e: any) {
      console.log(`❌ ${host}:5432: ${e.message}`)
      try { await client.end() } catch {}
    }
  }

  throw new Error('No se pudo conectar a PostgreSQL en Supabase.')
}

async function run() {
  console.log('🚀 Iniciando despliegue de esquema MilesIQ...')
  const client = await connectToDb()

  try {
    const sqlFilePath = path.join(process.cwd(), 'sql', 'miles_iq_schema.sql')
    const sql = fs.readFileSync(sqlFilePath, 'utf8')

    console.log('📜 Ejecutando script SQL de MilesIQ...')
    await client.query(sql)
    console.log('✅ Esquema MilesIQ desplegado con ÉXITO!')

    const res = await client.query('SELECT current_rate_per_mile FROM supervisor_mileage_settings LIMIT 1;')
    console.log('📊 Tarifa de millaje configurada:', res.rows[0]?.current_rate_per_mile)

    const resDistances = await client.query('SELECT count(*) FROM store_distances;')
    console.log('📊 Distancias estándar registradas:', resDistances.rows[0]?.count)
  } catch (err: any) {
    console.error('❌ Error ejecutando migración SQL:', err.message)
  } finally {
    await client.end()
  }
}

run()
