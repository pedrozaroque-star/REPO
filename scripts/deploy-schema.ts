import { Client } from 'pg'
import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config({ path: '.env.local' })

async function deploySchema() {
    console.log("🚀 Deploying Inventory Schema...")

    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
        console.error("❌ DATABASE_URL is missing in .env.local")
        process.exit(1)
    }

    // Create a new client
    const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false } // Supabase requires SSL but self-signed certs might need tolerance
    })

    try {
        await client.connect()
        console.log("✅ Connected to Database")

        // Read the SQL file
        const sqlPath = path.join(process.cwd(), 'supabase', 'migrations', '20260212_inventory_schema.sql')
        const sql = fs.readFileSync(sqlPath, 'utf-8')

        console.log(`📜 Executing SQL from ${sqlPath}...`)

        // Execute the SQL
        await client.query(sql)

        console.log("✅ Schema Deployed Successfully!")

    } catch (err: any) {
        console.error("❌ Error deploying schema:", err.message)
        console.error(err)
        process.exit(1)
    } finally {
        await client.end()
    }
}

deploySchema()
