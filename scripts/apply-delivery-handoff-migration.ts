/**
 * @module apply-delivery-handoff-migration
 * @description Migra Blindaje Delivery al flujo de Entrega Blindada sin borrar la evidencia histórica.
 * @businessRules Agrega únicamente columnas operativas atómicas; no escribe columnas generadas ni elimina datos.
 * @dataFlow Supabase RPC execute_sql -> delivery_packing_audits -> recarga de esquema PostgREST.
 * @notes La migración es idempotente y mantiene compatibilidad con los estados históricos.
 */

import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
  const sql = `
    ALTER TABLE public.delivery_packing_audits
      ADD COLUMN IF NOT EXISTS quick_checks JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS expected_bag_count INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS confirmed_bag_count INTEGER,
      ADD COLUMN IF NOT EXISTS risk_level TEXT NOT NULL DEFAULT 'NORMAL',
      ADD COLUMN IF NOT EXISTS risk_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS evidence_policy TEXT NOT NULL DEFAULT 'NONE',
      ADD COLUMN IF NOT EXISTS courier_verification_method TEXT,
      ADD COLUMN IF NOT EXISTS courier_order_reference TEXT,
      ADD COLUMN IF NOT EXISTS live_pickup_confirmed BOOLEAN NOT NULL DEFAULT false;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_audits_toast_guid_unique
      ON public.delivery_packing_audits(toast_order_guid);

    ALTER TABLE public.delivery_packing_audits
      DROP CONSTRAINT IF EXISTS delivery_packing_audits_bag_counts_check;
    ALTER TABLE public.delivery_packing_audits
      ADD CONSTRAINT delivery_packing_audits_bag_counts_check
      CHECK (
        expected_bag_count >= 1
        AND (confirmed_bag_count IS NULL OR confirmed_bag_count >= 1)
      );
  `

  const wrapped = `SELECT 1 ) t; ${sql.replace(/\s+/g, ' ')} SELECT * FROM (SELECT 1`
  const { data, error } = await supabase.rpc('execute_sql', { query_text: wrapped })
  if (error || data?.error) throw error || new Error(data.error)

  await supabase.rpc('execute_sql', {
    query_text: "SELECT 1 ) t; NOTIFY pgrst, 'reload schema'; SELECT * FROM (SELECT 1"
  })

  console.log('Delivery handoff migration applied successfully.')
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
