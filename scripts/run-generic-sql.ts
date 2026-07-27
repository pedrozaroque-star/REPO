import { Client } from 'pg'
import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

async function run() {
    const file = process.argv[2]
    if (!file) {
        console.error("❌ Please provide a SQL file path relative to workspace root")
        process.exit(1)
    }

    const sqlPath = path.resolve(process.cwd(), file)
    if (!fs.existsSync(sqlPath)) {
        console.error(`❌ File not found: ${sqlPath}`)
        process.exit(1)
    }

    console.log(`🚀 Executing: ${sqlPath}`)
    const sql = fs.readFileSync(sqlPath, 'utf-8')

    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    })

    try {
        await client.connect()
        await client.query(sql)
        console.log("✅ SQL Executed successfully!")
    } catch (e: any) {
        console.error("❌ Error:", e.message)
        process.exit(1)
    } finally {
        await client.end()
    }
}

run()
