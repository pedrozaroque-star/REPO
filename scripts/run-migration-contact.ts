
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const envPath = path.resolve(__dirname, '../.env.local')
dotenv.config({ path: envPath })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Missing Supabase keys in .env.local")
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function runMigration() {
    console.log("🚀 Running Migration: Add Email/Phone to Employees...")

    // We can't run RAW SQL via client mostly, so we use RPC if available or just basic JS calls if possible?
    // Actually, Postgres 'alter table' is not exposed via JS client directly unless RPC.
    // BUT we can use the trick: IF columns don't exist, we might fail unless we use a query tool.

    // WAIT! We can't run DDL (ALTER TABLE) easily from JS client standard.
    // BUT we can try to use the 'postgres' npm lib or similar if installed.
    // OR... we can assume the user has Supabase SQL Editor.

    // HOWEVER, I can try to use a little trick: Check if column exists, if not, warn user.
    // But user asked to run it via Script.

    // Let's try to just use a 'rpc' call if there is a generic exec_sql function (unlikely).
    // Actually, I can use the 'postgres' library if I had the connection string. I don't.

    // Alternative: We can try a "PostgREST" call? No.

    // BETTER IDEA: The 'toast_labor.ts' uses 'upsert'. If the column doesn't exist in DB,
    // the upsert might FAIL or IGNORE the extra fields depending on strictness.
    // Supabase usually ignores extra fields in JSON but returns error if column missing in typed mode.

    // Let's create a script that instructs the user to copy/paste SQL because running DDL from client is blocked by RLS usually.
    // UNLESS we have a 'exec_sql' RPC function already.

    console.log("\n⚠️  IMPORTANTE: No puedo ejecutar 'ALTER TABLE' directamente desde el cliente de JS por seguridad.")
    console.log("👉 Por favor, ve al SQL Editor de Supabase y corre esto:")
    console.log("\n---------------------------------------------------")
    console.log("ALTER TABLE employees ADD COLUMN IF NOT EXISTS email TEXT;")
    console.log("ALTER TABLE employees ADD COLUMN IF NOT EXISTS phone TEXT;")
    console.log("---------------------------------------------------\n")

    // Check if we can proceed without it (maybe columns exist?)
    const { data, error } = await supabase.from('employees').select('email').limit(1)

    if (error && error.message.includes('column "email" does not exist')) {
        console.error("❌ Confirmado: La columna 'email' NO EXISTE todavía.")
    } else if (!error) {
        console.log("✅ ¡Espera! Parece que la columna 'email' YA EXISTE. Ignora el mensaje anterior.")
    } else {
        console.log("⚠️ Status desconocido de columnas:", error?.message)
    }
}

runMigration()
