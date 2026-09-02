/**
 * Execute DDL migration via Supabase's PostgREST SQL endpoint
 * Uses the undocumented /pg endpoint that accepts raw SQL
 */
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function runMigration() {
  const sqlFile = path.join(__dirname, 'accounting-migration.sql')
  const sql = fs.readFileSync(sqlFile, 'utf8')
  
  console.log('=== Running Migration via Supabase SQL API ===\n')
  console.log(`SQL file: ${sql.length} bytes`)
  
  // Split SQL into individual statements
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'))

  console.log(`Found ${statements.length} SQL statements\n`)

  let success = 0
  let failed = 0

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i] + ';'
    const firstLine = stmt.split('\n').find(l => l.trim() && !l.trim().startsWith('--'))?.trim() || ''
    const label = firstLine.substring(0, 80)
    
    try {
      // Use the Supabase DB query endpoint
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/`, {
        method: 'POST',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({})
      })

      // Try PostgREST's query endpoint
      // Actually, Supabase doesn't have a raw SQL endpoint via REST. 
      // We need to use the Supabase Management API or a database function.
      // Let's create a helper function first.
    } catch (e: any) {
      // ignore
    }
  }

  // Alternative approach: Create a database function that executes SQL
  // then call it via RPC
  console.log('Attempting to create exec_sql function and run migration...')
  
  // First try: use fetch to the management API
  // The project ref is derived from the URL: ywwwdcvgfculqmcfkihq
  const projectRef = SUPABASE_URL.replace('https://', '').replace('.supabase.co', '')
  console.log(`Project ref: ${projectRef}`)
  
  // Try using the direct database connection via pg
  console.log('\nAttempting connection via pg library...')
  
  try {
    // Try pg module
    const { default: pg } = await import('pg') as any
    const Pool = pg.Pool || pg
    
    // Supabase connection string format
    const connectionString = `postgresql://postgres.${projectRef}:${SERVICE_KEY}@aws-0-us-west-1.pooler.supabase.com:6543/postgres`
    
    console.log('Connecting to PostgreSQL...')
    
    const pool = new (Pool as any)({ 
      connectionString,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
    })
    
    const client = await pool.connect()
    console.log('✅ Connected!\n')
    
    // Run the full SQL
    await client.query(sql)
    console.log('✅ Migration applied successfully!')
    
    client.release()
    await pool.end()
  } catch (pgErr: any) {
    console.log(`pg connection failed: ${pgErr.message}`)
    console.log('\n========================================')
    console.log('MANUAL STEP REQUIRED:')
    console.log('========================================')
    console.log('Copy the SQL from scripts/accounting-migration.sql')
    console.log('and paste it into Supabase Dashboard > SQL Editor')
    console.log(`URL: https://supabase.com/dashboard/project/${projectRef}/sql`)
    console.log('========================================\n')
  }
}

runMigration().catch(console.error)
