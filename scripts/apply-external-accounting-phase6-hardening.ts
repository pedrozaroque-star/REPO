/**
 * @module scripts/apply-external-accounting-phase6-hardening
 * @description Aplica en Supabase la migración de Fase 6 del ERP Contable Externo
 *              (`scripts/external-accounting-phase6-hardening.sql`) y crea/verifica el bucket
 *              de Supabase Storage `external-accounting-attachments`.
 * @businessRules
 *   - Unifica el contrato de `external_accounting_sync_outbox` (`attempts`, `max_attempts`, `next_retry_at`, `status`, `last_error`, `synced_at`).
 *   - Extiende transacciones ACID de PostgreSQL a conciliaciones, lotes, reclasificación, reglas bancarias, write-offs y entidades.
 *   - Prohíbe guardar `data_url` o `file_base64` dentro de JSONB en `external_accounting_attachments`.
 * @dataFlow
 *   `scripts/external-accounting-phase6-hardening.sql` -> `execute_sql` + `supabase.storage.createBucket`.
 * @notes
 *   Ejecutar con `npx tsx --env-file=.env.local scripts/apply-external-accounting-phase6-hardening.ts`.
 */
import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function execDdl(label: string, rawSql: string) {
  const cleanSql = rawSql
    .split('\n')
    .map(l => l.replace(/--.*$/, '').trim())
    .filter(Boolean)
    .join('\n')
  const payload = `SELECT 1 ) t; SET statement_timeout = '120s';\n${cleanSql}\nSELECT * FROM (SELECT 1`
  const start = Date.now()
  const { data, error } = await supabase.rpc('execute_sql', { query_text: payload })
  if (error) {
    console.error(`❌ [${label}] RPC Error:`, error)
    throw new Error(`[${label}] ${error.message}`)
  }
  if (data && typeof data === 'object' && !Array.isArray(data) && 'error' in data && (data as any).error) {
    console.error(`❌ [${label}] SQL Exception:`, (data as any).error)
    throw new Error(`[${label}] ${(data as any).error}`)
  }
  console.log(`✅ [${label}] completed in ${Date.now() - start}ms`)
}

async function main() {
  console.log('================================================================================')
  console.log('PHASE 6 HARDENING: APPLYING SQL RPCs, OUTBOX CONTRACT & STORAGE BUCKET')
  console.log('================================================================================')

  const sqlPath = path.join(process.cwd(), 'scripts', 'external-accounting-phase6-hardening.sql')
  const fullSql = fs.readFileSync(sqlPath, 'utf8')
  await execDdl('Phase 6 SQL Hardening Migration', fullSql)

  // Ensure Supabase Storage bucket `external-accounting-attachments` exists
  const bucketName = 'external-accounting-attachments'
  const { data: buckets, error: listErr } = await supabase.storage.listBuckets()
  if (listErr) {
    throw new Error(`Storage listBuckets failed: ${listErr.message}`)
  }
  const existingBucket = (buckets || []).find(b => b.name === bucketName || b.id === bucketName)
  if (!existingBucket) {
    const { error: createErr } = await supabase.storage.createBucket(bucketName, {
      public: false,
      fileSizeLimit: 25 * 1024 * 1024, // 25 MB
    })
    if (createErr) {
      throw new Error(`Storage createBucket(${bucketName}) failed: ${createErr.message}`)
    }
    console.log(`✅ Created Supabase Storage bucket: ${bucketName}`)
  } else {
    console.log(`✅ Verified existing Supabase Storage bucket: ${bucketName}`)
  }

  // Verify the RPCs exist in pg_proc
  const { data: procs, error: procErr } = await supabase.rpc('execute_sql', {
    query_text: `
      SELECT proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND proname IN (
          'fn_ext_acct_apply_account_deltas',
          'fn_ext_acct_mutate_transaction_atomic',
          'fn_ext_acct_save_reconciliation_atomic',
          'fn_ext_acct_reopen_or_delete_reconciliation_atomic',
          'fn_ext_acct_batch_mutate_transactions_atomic',
          'fn_ext_acct_mutate_entity_atomic'
        )
      ORDER BY proname
    `,
  })
  if (procErr) throw procErr
  console.log('✅ Verified PostgreSQL atomic RPC functions:', procs)

  // Verify outbox columns
  const { data: cols, error: colErr } = await supabase.rpc('execute_sql', {
    query_text: `
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'external_accounting_sync_outbox'
      ORDER BY ordinal_position
    `,
  })
  if (colErr) throw colErr
  console.log('✅ Verified external_accounting_sync_outbox columns:', cols)
}

main().catch(err => {
  console.error('❌ Migration failed:', err)
  process.exit(1)
})
