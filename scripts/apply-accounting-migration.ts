/**
 * Script para aplicar la migración de tablas de contabilidad directamente a PostgreSQL en Supabase.
 * Run via: npx tsx scripts/apply-accounting-migration.ts
 */

import pg from 'pg'
import * as dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'

dotenv.config({ path: '.env.local' })

const regions = [
  'us-west-1', 'us-west-2', 'us-east-1', 'us-east-2',
  'eu-central-1', 'eu-west-1', 'ap-southeast-1'
]

async function connectToDb(): Promise<pg.Client> {
  for (const region of regions) {
    const host = `aws-0-${region}.pooler.supabase.com`
    const client = new pg.Client({
      connectionString: `postgresql://postgres.ywwwdcvgfculqmcfkihq:100Prechivas.com@${host}:6543/postgres`,
      ssl: { rejectUnauthorized: false }
    })
    try {
      await client.connect()
      console.log(`✅ Conectado a PostgreSQL via ${region}`)
      return client
    } catch (e: any) {
      console.log(`❌ Falló conexión via ${region}: ${e.message}`)
      try { await client.end() } catch {}
    }
  }
  throw new Error('No se pudo conectar a ninguna región de Supabase')
}

async function runMigration() {
  console.log('🚀 Iniciando aplicación de migración de contabilidad a Supabase...')
  const client = await connectToDb()

  try {
    const sqlPath = path.resolve(process.cwd(), 'scripts/accounting-migration.sql')
    const sqlContent = fs.readFileSync(sqlPath, 'utf8')

    console.log('📄 Ejecutando DDL y creación de tablas...')
    await client.query(sqlContent)
    console.log('✅ Migración ejecutada con éxito.')

    // Verificar tablas creadas
    const res = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('accounting_gl_accounts', 'accounting_site_mappings', 'accounting_sales_packets', 'accounting_sync_logs')
      ORDER BY table_name;
    `)

    console.log('\n📊 Tablas encontradas en la base de datos:')
    for (const row of res.rows) {
      console.log(`  ✓ ${row.table_name}`)
    }

  } catch (err: any) {
    console.error('❌ Error aplicando migración:', err.message)
  } finally {
    await client.end()
    console.log('🔌 Conexión cerrada.')
  }
}

runMigration()
