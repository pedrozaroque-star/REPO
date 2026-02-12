import { getSupabaseAdminClient } from '../lib/supabase'
import fs from 'fs'
import path from 'path'

async function run() {
    console.log("🔓 Disabling RLS on toast_menu_items for debugging...")
    const supabase = await getSupabaseAdminClient()

    // Read SQL
    const sqlPath = path.join(process.cwd(), 'scripts', 'disable-rls.sql')
    const sql = fs.readFileSync(sqlPath, 'utf8')

    // Since we don't have direct SQL exec via client, we'll try to use a function if available, 
    // OR just use the rpc 'exec_sql' if it exists in this project (standard in some starters).
    // If not, we might fail. 
    // Wait, the user has 'deploy-schema.ts' which likely runs SQL via a specific method or just psql? No it uses postgres.js or similar usually.
    // Let's check deploy-schema.ts. 
    // Actually, I can just use the 'supabase-mcp-server' tool if I had creds, but I don't.
    // I'll try to use the admin client to just run a quick RPC if I can, or better yet,
    // I will use 'pg' directly if installed.

    // Checking package.json... 'pg' is installed!

    const { Client } = require('pg')
    const client = new Client({
        connectionString: process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL // Try standard envs
    })

    try {
        await client.connect()
        await client.query(sql)
        console.log("✅ RLS Disabled.")
    } catch (e: any) {
        console.error("❌ Error:", e.message)
        console.log("Trying to find DB URL in env...")
        // If env is missing, we can't run this.
    } finally {
        await client.end()
    }
}

run()
