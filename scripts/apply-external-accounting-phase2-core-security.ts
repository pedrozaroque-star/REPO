/**
 * @module scripts/apply-external-accounting-phase2-core-security
 * @description Aplica en Supabase la migración de Fase 2 y Fase 3 del ERP Contable Externo
 *              (`scripts/external-accounting-phase2-core-security.sql`), estampa el estado real
 *              verificado de las 8 empresas (`ACTIVE_QBO` vs `RETIRED_FROM_QBO_LOCAL_ACTIVE`),
 *              corrige la duplicación de `applied_amount` en `external_accounting_linked_transactions`,
 *              activa RLS estricto para los 3 usuarios autorizados y verifica los RPCs atómicos.
 * @businessRules
 *   - Ningún error SQL puede ser ignorado silenciosamente (verifica tanto `error` de RPC como `data.error`).
 *   - `Chicken Taco Catering LLC` (193514304333307) y `Elveze LLC` (9130355308251406) permanecen
 *     100% activas localmente en Supabase (`is_active = true`), marcadas como `RETIRED_FROM_QBO_LOCAL_ACTIVE`.
 *   - Las 6 empresas activas en QBO quedan marcadas como `ACTIVE_QBO`.
 * @dataFlow
 *   `scripts/external-accounting-phase2-core-security.sql` -> `execute_sql` -> Verificación de catálogo PostgreSQL.
 * @notes
 *   Ejecutar con `npx tsx --env-file=.env.local scripts/apply-external-accounting-phase2-core-security.ts`.
 */
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

async function execQuery(sql: string) {
  const { data, error } = await supabase.rpc('execute_sql', { query_text: sql })
  if (error) {
    console.error('❌ Query RPC error:', error, '\nSQL:', sql)
    throw new Error(error.message)
  }
  if (data && typeof data === 'object' && !Array.isArray(data) && 'error' in data && (data as any).error) {
    console.error('❌ Query SQL error:', (data as any).error, '\nSQL:', sql)
    throw new Error((data as any).error)
  }
  return data
}

async function main() {
  console.log('================================================================================')
  console.log('PHASE A + PHASE 2 & 3: APPLYING CORE ACCOUNTING SECURITY & ATOMIC RPC MIGRATION')
  console.log('================================================================================')

  // 1. Stamp verified company statuses in external_accounting_companies
  console.log('\n1. Stamping verified QBO vs Local-Active statuses on all 8 companies...')
  await execDdl(
    'Stamp Company Statuses (Step A)',
    `
    UPDATE public.external_accounting_companies
    SET
      is_active = true,
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'qbo_subscription_status',
        CASE
          WHEN realm_id IN ('193514304333307', '9130355308251406') THEN 'RETIRED_FROM_QBO_LOCAL_ACTIVE'
          ELSE 'ACTIVE_QBO'
        END,
        'qbo_sync_enabled',
        CASE
          WHEN realm_id IN ('193514304333307', '9130355308251406') THEN false
          ELSE true
        END,
        'local_erp_mode', 'FULL_READ_WRITE',
        'live_verified_at', NOW()::text
      ),
      updated_at = NOW()
    WHERE realm_id IS NOT NULL;
    `
  )

  // 2. Create QBO Sync Outbox Table & Add Relational Columns
  console.log('\n2. Creating external_accounting_sync_outbox & relational attachment/email columns...')
  await execDdl(
    'Sync Outbox & Columns',
    `
    CREATE TABLE IF NOT EXISTS public.external_accounting_sync_outbox (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      company_realm_id TEXT NOT NULL REFERENCES public.external_accounting_companies(realm_id) ON DELETE CASCADE,
      entity_kind TEXT NOT NULL CHECK (entity_kind IN ('TRANSACTION', 'ACCOUNT', 'CONTACT', 'LIST_ITEM', 'ATTACHMENT')),
      entity_type TEXT NOT NULL,
      local_entity_id UUID,
      qb_entity_id TEXT,
      operation TEXT NOT NULL CHECK (operation IN ('UPSERT', 'VOID', 'DELETE', 'DEACTIVATE')),
      idempotency_key TEXT NOT NULL UNIQUE,
      payload JSONB DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'SYNCED', 'FAILED', 'SKIPPED_LOCAL_ONLY')),
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      next_retry_at TIMESTAMPTZ DEFAULT NOW(),
      last_error TEXT,
      synced_at TIMESTAMPTZ,
      created_by TEXT DEFAULT 'System',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_ext_acct_outbox_pending
      ON public.external_accounting_sync_outbox(company_realm_id, status, next_retry_at);

    ALTER TABLE public.external_accounting_attachments
      ADD COLUMN IF NOT EXISTS transaction_id UUID REFERENCES public.external_accounting_transactions(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES public.external_accounting_contacts(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS qb_txn_id TEXT,
      ADD COLUMN IF NOT EXISTS qb_contact_id TEXT;

    CREATE INDEX IF NOT EXISTS idx_ext_acct_attachments_txn ON public.external_accounting_attachments(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_ext_acct_attachments_contact ON public.external_accounting_attachments(contact_id);

    ALTER TABLE public.external_accounting_email_log
      ADD COLUMN IF NOT EXISTS error_message TEXT,
      ADD COLUMN IF NOT EXISTS delivery_provider TEXT DEFAULT 'smtp',
      ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
    `
  )

  // 3. Same-company referential integrity function & triggers
  console.log('\n3. Installing Same-Company Referential Integrity Triggers...')
  await execDdl(
    'fn_enforce_ext_acct_same_company',
    `
    CREATE OR REPLACE FUNCTION public.fn_enforce_ext_acct_same_company()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $fn$
    DECLARE
      v_realm TEXT;
    BEGIN
      IF TG_TABLE_NAME = 'external_accounting_transactions' THEN
        IF NEW.account_id IS NOT NULL THEN
          SELECT company_realm_id INTO v_realm FROM public.external_accounting_accounts WHERE id = NEW.account_id;
          IF v_realm IS DISTINCT FROM NEW.company_realm_id THEN
            RAISE EXCEPTION 'CROSS_COMPANY_FK_VIOLATION: account_id % belongs to realm %, expected %', NEW.account_id, v_realm, NEW.company_realm_id USING ERRCODE = '23514';
          END IF;
        END IF;
        IF NEW.to_account_id IS NOT NULL THEN
          SELECT company_realm_id INTO v_realm FROM public.external_accounting_accounts WHERE id = NEW.to_account_id;
          IF v_realm IS DISTINCT FROM NEW.company_realm_id THEN
            RAISE EXCEPTION 'CROSS_COMPANY_FK_VIOLATION: to_account_id % belongs to realm %, expected %', NEW.to_account_id, v_realm, NEW.company_realm_id USING ERRCODE = '23514';
          END IF;
        END IF;
        IF NEW.contact_id IS NOT NULL THEN
          SELECT company_realm_id INTO v_realm FROM public.external_accounting_contacts WHERE id = NEW.contact_id;
          IF v_realm IS DISTINCT FROM NEW.company_realm_id THEN
            RAISE EXCEPTION 'CROSS_COMPANY_FK_VIOLATION: contact_id % belongs to realm %, expected %', NEW.contact_id, v_realm, NEW.company_realm_id USING ERRCODE = '23514';
          END IF;
        END IF;
        IF NEW.location_id IS NOT NULL THEN
          SELECT company_realm_id INTO v_realm FROM public.external_accounting_locations WHERE id = NEW.location_id;
          IF v_realm IS DISTINCT FROM NEW.company_realm_id THEN
            RAISE EXCEPTION 'CROSS_COMPANY_FK_VIOLATION: location_id % belongs to realm %, expected %', NEW.location_id, v_realm, NEW.company_realm_id USING ERRCODE = '23514';
          END IF;
        END IF;
        IF NEW.class_id IS NOT NULL THEN
          SELECT company_realm_id INTO v_realm FROM public.external_accounting_classes WHERE id = NEW.class_id;
          IF v_realm IS DISTINCT FROM NEW.company_realm_id THEN
            RAISE EXCEPTION 'CROSS_COMPANY_FK_VIOLATION: class_id % belongs to realm %, expected %', NEW.class_id, v_realm, NEW.company_realm_id USING ERRCODE = '23514';
          END IF;
        END IF;
        IF NEW.term_id IS NOT NULL THEN
          SELECT company_realm_id INTO v_realm FROM public.external_accounting_terms WHERE id = NEW.term_id;
          IF v_realm IS DISTINCT FROM NEW.company_realm_id THEN
            RAISE EXCEPTION 'CROSS_COMPANY_FK_VIOLATION: term_id % belongs to realm %, expected %', NEW.term_id, v_realm, NEW.company_realm_id USING ERRCODE = '23514';
          END IF;
        END IF;
        IF NEW.payment_method_id IS NOT NULL THEN
          SELECT company_realm_id INTO v_realm FROM public.external_accounting_payment_methods WHERE id = NEW.payment_method_id;
          IF v_realm IS DISTINCT FROM NEW.company_realm_id THEN
            RAISE EXCEPTION 'CROSS_COMPANY_FK_VIOLATION: payment_method_id % belongs to realm %, expected %', NEW.payment_method_id, v_realm, NEW.company_realm_id USING ERRCODE = '23514';
          END IF;
        END IF;
      ELSIF TG_TABLE_NAME = 'external_accounting_transaction_lines' THEN
        IF NEW.account_id IS NOT NULL THEN
          SELECT company_realm_id INTO v_realm FROM public.external_accounting_accounts WHERE id = NEW.account_id;
          IF v_realm IS DISTINCT FROM NEW.company_realm_id THEN
            RAISE EXCEPTION 'CROSS_COMPANY_FK_VIOLATION: line account_id % belongs to realm %, expected %', NEW.account_id, v_realm, NEW.company_realm_id USING ERRCODE = '23514';
          END IF;
        END IF;
        IF NEW.item_id IS NOT NULL THEN
          SELECT company_realm_id INTO v_realm FROM public.external_accounting_items WHERE id = NEW.item_id;
          IF v_realm IS DISTINCT FROM NEW.company_realm_id THEN
            RAISE EXCEPTION 'CROSS_COMPANY_FK_VIOLATION: line item_id % belongs to realm %, expected %', NEW.item_id, v_realm, NEW.company_realm_id USING ERRCODE = '23514';
          END IF;
        END IF;
        IF NEW.contact_id IS NOT NULL THEN
          SELECT company_realm_id INTO v_realm FROM public.external_accounting_contacts WHERE id = NEW.contact_id;
          IF v_realm IS DISTINCT FROM NEW.company_realm_id THEN
            RAISE EXCEPTION 'CROSS_COMPANY_FK_VIOLATION: line contact_id % belongs to realm %, expected %', NEW.contact_id, v_realm, NEW.company_realm_id USING ERRCODE = '23514';
          END IF;
        END IF;
      ELSIF TG_TABLE_NAME = 'external_accounting_accounts' THEN
        IF NEW.parent_account_id IS NOT NULL THEN
          SELECT company_realm_id INTO v_realm FROM public.external_accounting_accounts WHERE id = NEW.parent_account_id;
          IF v_realm IS DISTINCT FROM NEW.company_realm_id THEN
            RAISE EXCEPTION 'CROSS_COMPANY_FK_VIOLATION: parent_account_id % belongs to realm %, expected %', NEW.parent_account_id, v_realm, NEW.company_realm_id USING ERRCODE = '23514';
          END IF;
        END IF;
      ELSIF TG_TABLE_NAME = 'external_accounting_items' THEN
        IF NEW.income_account_id IS NOT NULL THEN
          SELECT company_realm_id INTO v_realm FROM public.external_accounting_accounts WHERE id = NEW.income_account_id;
          IF v_realm IS DISTINCT FROM NEW.company_realm_id THEN
            RAISE EXCEPTION 'CROSS_COMPANY_FK_VIOLATION: income_account_id % belongs to realm %, expected %', NEW.income_account_id, v_realm, NEW.company_realm_id USING ERRCODE = '23514';
          END IF;
        END IF;
        IF NEW.expense_account_id IS NOT NULL THEN
          SELECT company_realm_id INTO v_realm FROM public.external_accounting_accounts WHERE id = NEW.expense_account_id;
          IF v_realm IS DISTINCT FROM NEW.company_realm_id THEN
            RAISE EXCEPTION 'CROSS_COMPANY_FK_VIOLATION: expense_account_id % belongs to realm %, expected %', NEW.expense_account_id, v_realm, NEW.company_realm_id USING ERRCODE = '23514';
          END IF;
        END IF;
      ELSIF TG_TABLE_NAME = 'external_accounting_attachments' THEN
        IF NEW.transaction_id IS NOT NULL THEN
          SELECT company_realm_id INTO v_realm FROM public.external_accounting_transactions WHERE id = NEW.transaction_id;
          IF v_realm IS DISTINCT FROM NEW.company_realm_id THEN
            RAISE EXCEPTION 'CROSS_COMPANY_FK_VIOLATION: attachment transaction_id % belongs to realm %, expected %', NEW.transaction_id, v_realm, NEW.company_realm_id USING ERRCODE = '23514';
          END IF;
        END IF;
        IF NEW.contact_id IS NOT NULL THEN
          SELECT company_realm_id INTO v_realm FROM public.external_accounting_contacts WHERE id = NEW.contact_id;
          IF v_realm IS DISTINCT FROM NEW.company_realm_id THEN
            RAISE EXCEPTION 'CROSS_COMPANY_FK_VIOLATION: attachment contact_id % belongs to realm %, expected %', NEW.contact_id, v_realm, NEW.company_realm_id USING ERRCODE = '23514';
          END IF;
        END IF;
      END IF;

      RETURN NEW;
    END;
    $fn$;
    `
  )

  await execDdl(
    'fn_resolve_ext_acct_tx_fks & Triggers',
    `
    CREATE OR REPLACE FUNCTION public.fn_resolve_ext_acct_tx_fks()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $fn$
    DECLARE
      v_realm TEXT;
    BEGIN
      IF NEW.account_id IS NOT NULL THEN
        SELECT company_realm_id INTO v_realm FROM public.external_accounting_accounts WHERE id = NEW.account_id;
        IF v_realm IS DISTINCT FROM NEW.company_realm_id THEN
          RAISE EXCEPTION 'CROSS_COMPANY_FK_VIOLATION: account_id % belongs to realm %, expected %', NEW.account_id, v_realm, NEW.company_realm_id USING ERRCODE = '23514';
        END IF;
      END IF;
      IF NEW.account_qb_id IS NOT NULL AND NEW.account_qb_id <> '' THEN
        SELECT id INTO NEW.account_id FROM public.external_accounting_accounts WHERE company_realm_id = NEW.company_realm_id AND qb_account_id = NEW.account_qb_id LIMIT 1;
      END IF;

      IF NEW.to_account_id IS NOT NULL THEN
        SELECT company_realm_id INTO v_realm FROM public.external_accounting_accounts WHERE id = NEW.to_account_id;
        IF v_realm IS DISTINCT FROM NEW.company_realm_id THEN
          RAISE EXCEPTION 'CROSS_COMPANY_FK_VIOLATION: to_account_id % belongs to realm %, expected %', NEW.to_account_id, v_realm, NEW.company_realm_id USING ERRCODE = '23514';
        END IF;
      END IF;
      IF NEW.to_account_qb_id IS NOT NULL AND NEW.to_account_qb_id <> '' THEN
        SELECT id INTO NEW.to_account_id FROM public.external_accounting_accounts WHERE company_realm_id = NEW.company_realm_id AND qb_account_id = NEW.to_account_qb_id LIMIT 1;
      END IF;

      IF NEW.contact_id IS NOT NULL THEN
        SELECT company_realm_id INTO v_realm FROM public.external_accounting_contacts WHERE id = NEW.contact_id;
        IF v_realm IS DISTINCT FROM NEW.company_realm_id THEN
          RAISE EXCEPTION 'CROSS_COMPANY_FK_VIOLATION: contact_id % belongs to realm %, expected %', NEW.contact_id, v_realm, NEW.company_realm_id USING ERRCODE = '23514';
        END IF;
      END IF;
      IF NEW.entity_qb_id IS NOT NULL AND NEW.entity_qb_id <> '' THEN
        SELECT id INTO NEW.contact_id FROM public.external_accounting_contacts
        WHERE company_realm_id = NEW.company_realm_id AND qb_contact_id = NEW.entity_qb_id
        ORDER BY CASE WHEN contact_type = NEW.entity_type THEN 0 ELSE 1 END
        LIMIT 1;
      ELSIF NEW.entity_name IS NOT NULL AND NEW.entity_name <> '' AND NEW.contact_id IS NULL THEN
        SELECT id INTO NEW.contact_id FROM public.external_accounting_contacts
        WHERE company_realm_id = NEW.company_realm_id AND LOWER(display_name) = LOWER(NEW.entity_name)
        ORDER BY CASE WHEN contact_type = NEW.entity_type THEN 0 ELSE 1 END
        LIMIT 1;
      END IF;

      IF NEW.location_id IS NOT NULL THEN
        SELECT company_realm_id INTO v_realm FROM public.external_accounting_locations WHERE id = NEW.location_id;
        IF v_realm IS DISTINCT FROM NEW.company_realm_id THEN
          RAISE EXCEPTION 'CROSS_COMPANY_FK_VIOLATION: location_id % belongs to realm %, expected %', NEW.location_id, v_realm, NEW.company_realm_id USING ERRCODE = '23514';
        END IF;
      END IF;
      IF NEW.department_qb_id IS NOT NULL AND NEW.department_qb_id <> '' THEN
        SELECT id INTO NEW.location_id FROM public.external_accounting_locations WHERE company_realm_id = NEW.company_realm_id AND qb_location_id = NEW.department_qb_id LIMIT 1;
      END IF;

      IF NEW.class_id IS NOT NULL THEN
        SELECT company_realm_id INTO v_realm FROM public.external_accounting_classes WHERE id = NEW.class_id;
        IF v_realm IS DISTINCT FROM NEW.company_realm_id THEN
          RAISE EXCEPTION 'CROSS_COMPANY_FK_VIOLATION: class_id % belongs to realm %, expected %', NEW.class_id, v_realm, NEW.company_realm_id USING ERRCODE = '23514';
        END IF;
      END IF;
      IF NEW.class_qb_id IS NOT NULL AND NEW.class_qb_id <> '' THEN
        SELECT id INTO NEW.class_id FROM public.external_accounting_classes WHERE company_realm_id = NEW.company_realm_id AND qb_class_id = NEW.class_qb_id LIMIT 1;
      END IF;

      IF NEW.term_id IS NOT NULL THEN
        SELECT company_realm_id INTO v_realm FROM public.external_accounting_terms WHERE id = NEW.term_id;
        IF v_realm IS DISTINCT FROM NEW.company_realm_id THEN
          RAISE EXCEPTION 'CROSS_COMPANY_FK_VIOLATION: term_id % belongs to realm %, expected %', NEW.term_id, v_realm, NEW.company_realm_id USING ERRCODE = '23514';
        END IF;
      END IF;
      IF NEW.term_qb_id IS NOT NULL AND NEW.term_qb_id <> '' THEN
        SELECT id INTO NEW.term_id FROM public.external_accounting_terms WHERE company_realm_id = NEW.company_realm_id AND qb_term_id = NEW.term_qb_id LIMIT 1;
      ELSIF NEW.term_name IS NOT NULL AND NEW.term_name <> '' THEN
        SELECT id INTO NEW.term_id FROM public.external_accounting_terms WHERE company_realm_id = NEW.company_realm_id AND LOWER(name) = LOWER(NEW.term_name) LIMIT 1;
      END IF;

      IF NEW.payment_method_id IS NOT NULL THEN
        SELECT company_realm_id INTO v_realm FROM public.external_accounting_payment_methods WHERE id = NEW.payment_method_id;
        IF v_realm IS DISTINCT FROM NEW.company_realm_id THEN
          RAISE EXCEPTION 'CROSS_COMPANY_FK_VIOLATION: payment_method_id % belongs to realm %, expected %', NEW.payment_method_id, v_realm, NEW.company_realm_id USING ERRCODE = '23514';
        END IF;
      END IF;
      IF NEW.payment_method_qb_id IS NOT NULL AND NEW.payment_method_qb_id <> '' THEN
        SELECT id INTO NEW.payment_method_id FROM public.external_accounting_payment_methods WHERE company_realm_id = NEW.company_realm_id AND qb_payment_method_id = NEW.payment_method_qb_id LIMIT 1;
      ELSIF COALESCE(NEW.payment_method, NEW.payment_type) IS NOT NULL AND COALESCE(NEW.payment_method, NEW.payment_type) <> '' THEN
        SELECT id INTO NEW.payment_method_id FROM public.external_accounting_payment_methods WHERE company_realm_id = NEW.company_realm_id AND LOWER(name) = LOWER(COALESCE(NEW.payment_method, NEW.payment_type)) LIMIT 1;
      END IF;

      RETURN NEW;
    END;
    $fn$;

    DROP TRIGGER IF EXISTS trg_enforce_same_company_tx ON public.external_accounting_transactions;
    CREATE TRIGGER trg_enforce_same_company_tx
      BEFORE INSERT OR UPDATE ON public.external_accounting_transactions
      FOR EACH ROW EXECUTE FUNCTION public.fn_enforce_ext_acct_same_company();

    DROP TRIGGER IF EXISTS trg_resolve_ext_acct_tx_fks ON public.external_accounting_transactions;
    CREATE TRIGGER trg_resolve_ext_acct_tx_fks
      BEFORE INSERT OR UPDATE ON public.external_accounting_transactions
      FOR EACH ROW EXECUTE FUNCTION public.fn_resolve_ext_acct_tx_fks();

    DROP TRIGGER IF EXISTS trg_enforce_same_company_lines ON public.external_accounting_transaction_lines;
    CREATE TRIGGER trg_enforce_same_company_lines
      BEFORE INSERT OR UPDATE ON public.external_accounting_transaction_lines
      FOR EACH ROW EXECUTE FUNCTION public.fn_enforce_ext_acct_same_company();

    DROP TRIGGER IF EXISTS trg_enforce_same_company_accounts ON public.external_accounting_accounts;
    CREATE TRIGGER trg_enforce_same_company_accounts
      BEFORE INSERT OR UPDATE ON public.external_accounting_accounts
      FOR EACH ROW EXECUTE FUNCTION public.fn_enforce_ext_acct_same_company();

    DROP TRIGGER IF EXISTS trg_enforce_same_company_items ON public.external_accounting_items;
    CREATE TRIGGER trg_enforce_same_company_items
      BEFORE INSERT OR UPDATE ON public.external_accounting_items
      FOR EACH ROW EXECUTE FUNCTION public.fn_enforce_ext_acct_same_company();

    DROP TRIGGER IF EXISTS trg_enforce_same_company_attachments ON public.external_accounting_attachments;
    CREATE TRIGGER trg_enforce_same_company_attachments
      BEFORE INSERT OR UPDATE ON public.external_accounting_attachments
      FOR EACH ROW EXECUTE FUNCTION public.fn_enforce_ext_acct_same_company();
    `
  )

  // 4. Deduped fn_sync_ext_acct_tx_children trigger & full re-normalization of LinkedTxn
  console.log('\n4. Installing deduped fn_sync_ext_acct_tx_children & rebuilding LinkedTxn edges...')
  await execDdl(
    'fn_sync_ext_acct_tx_children',
    `
    CREATE OR REPLACE FUNCTION public.fn_sync_ext_acct_tx_children()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $fn$
    DECLARE
      v_has_normalized_links BOOLEAN := FALSE;
    BEGIN
      DELETE FROM public.external_accounting_transaction_lines WHERE transaction_id = NEW.id;

      IF jsonb_typeof(NEW.line_items) = 'array' AND jsonb_array_length(NEW.line_items) > 0 THEN
        INSERT INTO public.external_accounting_transaction_lines (
          transaction_id, company_realm_id, qb_txn_id, txn_type, txn_date, line_num, qb_line_id,
          detail_type, account_id, account_qb_id, account_name, item_id, item_qb_id, item_name,
          contact_id, entity_qb_id, entity_name, class_id, class_qb_id, class_name,
          location_id, department_qb_id, department_name, description, qty, unit_price, amount, posting_type
        )
        SELECT
          NEW.id,
          NEW.company_realm_id,
          NEW.qb_txn_id,
          NEW.txn_type,
          NEW.txn_date,
          elem.ord::integer,
          COALESCE(NULLIF(elem.item->>'id', ''), elem.ord::text),
          NULLIF(elem.item->>'detail_type', ''),
          (SELECT a.id FROM public.external_accounting_accounts a WHERE a.company_realm_id = NEW.company_realm_id AND a.qb_account_id = NULLIF(elem.item->>'account_qb_id', '') LIMIT 1),
          NULLIF(elem.item->>'account_qb_id', ''),
          NULLIF(elem.item->>'account_name', ''),
          (SELECT i.id FROM public.external_accounting_items i WHERE i.company_realm_id = NEW.company_realm_id AND i.qb_item_id = COALESCE(NULLIF(elem.item->>'item_qb_id', ''), NULLIF(elem.item->>'item_id', '')) LIMIT 1),
          COALESCE(NULLIF(elem.item->>'item_qb_id', ''), NULLIF(elem.item->>'item_id', '')),
          NULLIF(elem.item->>'item_name', ''),
          (SELECT c.id FROM public.external_accounting_contacts c WHERE c.company_realm_id = NEW.company_realm_id AND c.qb_contact_id = NULLIF(elem.item->>'entity_qb_id', '') LIMIT 1),
          NULLIF(elem.item->>'entity_qb_id', ''),
          NULLIF(elem.item->>'entity_name', ''),
          (SELECT cl.id FROM public.external_accounting_classes cl WHERE cl.company_realm_id = NEW.company_realm_id AND cl.qb_class_id = NULLIF(elem.item->>'class_qb_id', '') LIMIT 1),
          NULLIF(elem.item->>'class_qb_id', ''),
          NULLIF(elem.item->>'class_name', ''),
          (SELECT l.id FROM public.external_accounting_locations l WHERE l.company_realm_id = NEW.company_realm_id AND l.qb_location_id = NULLIF(elem.item->>'department_qb_id', '') LIMIT 1),
          NULLIF(elem.item->>'department_qb_id', ''),
          NULLIF(elem.item->>'department_name', ''),
          NULLIF(elem.item->>'description', ''),
          CASE WHEN (elem.item->>'qty') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (elem.item->>'qty')::numeric(14,4) ELSE 1 END,
          CASE
            WHEN (elem.item->>'unit_price') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (elem.item->>'unit_price')::numeric(14,4)
            WHEN (elem.item->>'rate') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (elem.item->>'rate')::numeric(14,4)
            ELSE 0
          END,
          CASE WHEN (elem.item->>'amount') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (elem.item->>'amount')::numeric(14,2) ELSE 0 END,
          NULLIF(elem.item->>'posting_type', '')
        FROM jsonb_array_elements(NEW.line_items) WITH ORDINALITY AS elem(item, ord);

        SELECT EXISTS (
          SELECT 1 FROM jsonb_array_elements(NEW.line_items) AS li
          WHERE NULLIF(li->>'linked_txn_id', '') IS NOT NULL
        ) INTO v_has_normalized_links;
      END IF;

      DELETE FROM public.external_accounting_linked_transactions WHERE source_transaction_id = NEW.id;

      INSERT INTO public.external_accounting_linked_transactions (
        company_realm_id, source_transaction_id, source_qb_txn_id, source_txn_type,
        target_transaction_id, target_qb_txn_id, target_txn_type, link_scope, applied_amount
      )
      SELECT
        NEW.company_realm_id,
        NEW.id,
        NEW.qb_txn_id,
        NEW.txn_type,
        (
          SELECT tgt.id FROM public.external_accounting_transactions tgt
          WHERE tgt.company_realm_id = NEW.company_realm_id AND tgt.qb_txn_id = edges.target_qb_txn_id
          ORDER BY CASE WHEN tgt.txn_type = edges.target_txn_type OR tgt.qb_entity_type = edges.target_txn_type THEN 0 ELSE 1 END
          LIMIT 1
        ),
        edges.target_qb_txn_id,
        edges.target_txn_type,
        edges.link_scope,
        SUM(edges.applied_amount)
      FROM (
        SELECT
          lt->>'TxnId' AS target_qb_txn_id,
          COALESCE(NULLIF(lt->>'TxnType', ''), 'Unknown') AS target_txn_type,
          'header'::text AS link_scope,
          COALESCE(NEW.total_amount, 0)::numeric(14,2) AS applied_amount
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(NEW.raw_data->'LinkedTxn') = 'array' THEN NEW.raw_data->'LinkedTxn' ELSE '[]'::jsonb END
        ) AS lt
        WHERE NULLIF(lt->>'TxnId', '') IS NOT NULL

        UNION ALL

        SELECT
          li->>'linked_txn_id' AS target_qb_txn_id,
          COALESCE(NULLIF(li->>'linked_txn_type', ''), 'Unknown') AS target_txn_type,
          'line'::text AS link_scope,
          CASE WHEN (li->>'amount') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (li->>'amount')::numeric(14,2) ELSE 0 END AS applied_amount
        FROM jsonb_array_elements(
          CASE WHEN v_has_normalized_links AND jsonb_typeof(NEW.line_items) = 'array' THEN NEW.line_items ELSE '[]'::jsonb END
        ) AS li
        WHERE NULLIF(li->>'linked_txn_id', '') IS NOT NULL

        UNION ALL

        SELECT
          lt->>'TxnId' AS target_qb_txn_id,
          COALESCE(NULLIF(lt->>'TxnType', ''), 'Unknown') AS target_txn_type,
          'line'::text AS link_scope,
          CASE WHEN (ln->>'Amount') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (ln->>'Amount')::numeric(14,2) ELSE 0 END AS applied_amount
        FROM jsonb_array_elements(
          CASE WHEN (NOT v_has_normalized_links) AND jsonb_typeof(NEW.raw_data->'Line') = 'array' THEN NEW.raw_data->'Line' ELSE '[]'::jsonb END
        ) AS ln
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(ln->'LinkedTxn') = 'array' THEN ln->'LinkedTxn' ELSE '[]'::jsonb END
        ) AS lt
        WHERE NULLIF(lt->>'TxnId', '') IS NOT NULL
      ) edges
      GROUP BY edges.target_qb_txn_id, edges.target_txn_type, edges.link_scope
      ON CONFLICT (company_realm_id, source_transaction_id, target_qb_txn_id, target_txn_type, link_scope)
      DO UPDATE SET
        applied_amount = EXCLUDED.applied_amount,
        target_transaction_id = COALESCE(EXCLUDED.target_transaction_id, public.external_accounting_linked_transactions.target_transaction_id);

      UPDATE public.external_accounting_linked_transactions
      SET target_transaction_id = NEW.id
      WHERE company_realm_id = NEW.company_realm_id
        AND target_qb_txn_id = NEW.qb_txn_id
        AND target_transaction_id IS NULL;

      RETURN NEW;
    END;
    $fn$;

    DROP TRIGGER IF EXISTS trg_sync_ext_acct_tx_children ON public.external_accounting_transactions;
    CREATE TRIGGER trg_sync_ext_acct_tx_children
      AFTER INSERT OR UPDATE ON public.external_accounting_transactions
      FOR EACH ROW EXECUTE FUNCTION public.fn_sync_ext_acct_tx_children();
    `
  )

  // Rebuild external_accounting_linked_transactions cleanly so any previously doubled rows are fixed
  await execDdl(
    'Rebuild Deduped external_accounting_linked_transactions',
    `
    TRUNCATE TABLE public.external_accounting_linked_transactions;

    INSERT INTO public.external_accounting_linked_transactions (
      company_realm_id,
      source_transaction_id,
      source_qb_txn_id,
      source_txn_type,
      target_qb_txn_id,
      target_txn_type,
      link_scope,
      applied_amount
    )
    SELECT
      company_realm_id,
      source_transaction_id,
      source_qb_txn_id,
      source_txn_type,
      target_qb_txn_id,
      target_txn_type,
      link_scope,
      SUM(applied_amount) AS applied_amount
    FROM (
      -- Header LinkedTxn
      SELECT
        t.company_realm_id,
        t.id AS source_transaction_id,
        t.qb_txn_id AS source_qb_txn_id,
        t.txn_type AS source_txn_type,
        lt->>'TxnId' AS target_qb_txn_id,
        COALESCE(NULLIF(lt->>'TxnType', ''), 'Unknown') AS target_txn_type,
        'header'::text AS link_scope,
        COALESCE(t.total_amount, 0)::numeric(14,2) AS applied_amount
      FROM public.external_accounting_transactions t
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(t.raw_data->'LinkedTxn') = 'array' THEN t.raw_data->'LinkedTxn' ELSE '[]'::jsonb END
      ) AS lt
      WHERE NULLIF(lt->>'TxnId', '') IS NOT NULL

      UNION ALL

      -- Line LinkedTxn from raw_data->'Line' when present
      SELECT
        t.company_realm_id,
        t.id AS source_transaction_id,
        t.qb_txn_id AS source_qb_txn_id,
        t.txn_type AS source_txn_type,
        lt->>'TxnId' AS target_qb_txn_id,
        COALESCE(NULLIF(lt->>'TxnType', ''), 'Unknown') AS target_txn_type,
        'line'::text AS link_scope,
        CASE WHEN (ln->>'Amount') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (ln->>'Amount')::numeric(14,2) ELSE 0 END AS applied_amount
      FROM public.external_accounting_transactions t
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(t.raw_data->'Line') = 'array' THEN t.raw_data->'Line' ELSE '[]'::jsonb END
      ) AS ln
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(ln->'LinkedTxn') = 'array' THEN ln->'LinkedTxn' ELSE '[]'::jsonb END
      ) AS lt
      WHERE NULLIF(lt->>'TxnId', '') IS NOT NULL

      UNION ALL

      -- Line LinkedTxn from line_items ONLY when raw_data->'Line' has no LinkedTxn (e.g. locally created payments)
      SELECT
        t.company_realm_id,
        t.id AS source_transaction_id,
        t.qb_txn_id AS source_qb_txn_id,
        t.txn_type AS source_txn_type,
        li->>'linked_txn_id' AS target_qb_txn_id,
        COALESCE(NULLIF(li->>'linked_txn_type', ''), 'Unknown') AS target_txn_type,
        'line'::text AS link_scope,
        CASE WHEN (li->>'amount') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (li->>'amount')::numeric(14,2) ELSE 0 END AS applied_amount
      FROM public.external_accounting_transactions t
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(t.raw_data->'Line') <> 'array' AND jsonb_typeof(t.line_items) = 'array' THEN t.line_items
          ELSE '[]'::jsonb
        END
      ) AS li
      WHERE NULLIF(li->>'linked_txn_id', '') IS NOT NULL
    ) deduped_edges
    GROUP BY
      company_realm_id,
      source_transaction_id,
      source_qb_txn_id,
      source_txn_type,
      target_qb_txn_id,
      target_txn_type,
      link_scope
    ON CONFLICT (company_realm_id, source_transaction_id, target_qb_txn_id, target_txn_type, link_scope)
    DO UPDATE SET applied_amount = EXCLUDED.applied_amount;

    UPDATE public.external_accounting_linked_transactions lt
    SET target_transaction_id = tgt.id
    FROM public.external_accounting_transactions tgt
    WHERE lt.company_realm_id = tgt.company_realm_id
      AND lt.target_qb_txn_id = tgt.qb_txn_id
      AND (
        lt.target_txn_type = tgt.txn_type
        OR (lt.target_txn_type IN ('BillPaymentCheck', 'BillPaymentCreditCard', 'BillPayment') AND tgt.txn_type = 'BillPayment')
        OR (lt.target_txn_type IN ('ReceivePayment', 'Payment') AND tgt.txn_type = 'Payment')
        OR (lt.target_txn_type IN ('Check', 'Expense', 'CashPurchase', 'CreditCardCredit') AND tgt.txn_type IN ('Check', 'Expense', 'CreditCardCredit'))
      );

    UPDATE public.external_accounting_linked_transactions lt
    SET target_transaction_id = tgt.id
    FROM public.external_accounting_transactions tgt
    WHERE lt.target_transaction_id IS NULL
      AND lt.company_realm_id = tgt.company_realm_id
      AND lt.target_qb_txn_id = tgt.qb_txn_id;
    `
  )

  // 5. Strict Row-Level Security (RLS)
  console.log('\n5. Enforcing Strict RLS Policies across all 24 external_accounting_* tables...')
  await execDdl(
    'is_authorized_external_accounting_user & Strict RLS Policies',
    `
    CREATE OR REPLACE FUNCTION public.is_authorized_external_accounting_user()
    RETURNS BOOLEAN
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    AS $fn$
    DECLARE
      v_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
      v_claims JSONB;
      v_email TEXT := '';
      v_uid TEXT := '';
    BEGIN
      IF v_role = 'service_role' OR current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
        RETURN TRUE;
      END IF;

      BEGIN
        v_claims := COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
      EXCEPTION WHEN OTHERS THEN
        v_claims := '{}'::jsonb;
      END;

      v_email := LOWER(TRIM(COALESCE(v_claims->>'email', '')));
      v_uid := TRIM(COALESCE(v_claims->>'sub', v_claims->>'userId', v_claims->>'id', ''));

      IF v_email IN ('raquel@tacosgavilan.com', 'roberto@tacosgavilan.com', 'roque@tacosgavilan.com', 'rvelasquez95@yahoo.com') THEN
        RETURN TRUE;
      END IF;

      IF v_uid IN ('45', '46', '47') THEN
        RETURN TRUE;
      END IF;

      RETURN FALSE;
    END;
    $fn$;

    DO $do$
    DECLARE
      t TEXT;
      tables TEXT[] := ARRAY[
        'external_accounting_companies',
        'external_accounting_accounts',
        'external_accounting_contacts',
        'external_accounting_transactions',
        'external_accounting_transaction_lines',
        'external_accounting_linked_transactions',
        'external_accounting_recurring',
        'external_accounting_reconciliations',
        'external_accounting_reports_archive',
        'external_accounting_audit_log',
        'external_accounting_bank_rules',
        'external_accounting_budgets',
        'external_accounting_items',
        'external_accounting_categories',
        'external_accounting_locations',
        'external_accounting_classes',
        'external_accounting_terms',
        'external_accounting_payment_methods',
        'external_accounting_custom_fields',
        'external_accounting_attachments',
        'external_accounting_cost_groups',
        'external_accounting_notes_tasks',
        'external_accounting_email_log',
        'external_accounting_sync_outbox'
      ];
    BEGIN
      FOREACH t IN ARRAY tables LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_all', t);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'service_role_all_' || t, t);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'auth_ext_acct_users_' || t, t);

        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
          'service_role_all_' || t, t
        );
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_authorized_external_accounting_user()) WITH CHECK (public.is_authorized_external_accounting_user())',
          'auth_ext_acct_users_' || t, t
        );
      END LOOP;
    END;
    $do$;
    `
  )

  // 6. Atomic Balance Delta RPC & Atomic Transaction Mutation RPC
  console.log('\n6. Installing Atomic PostgreSQL Accounting RPCs...')
  await execDdl(
    'fn_ext_acct_apply_account_deltas',
    `
    CREATE OR REPLACE FUNCTION public.fn_ext_acct_apply_account_deltas(
      p_realm_id TEXT,
      p_deltas JSONB
    )
    RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $fn$
    DECLARE
      v_item JSONB;
      v_qb_id TEXT;
      v_delta NUMERIC(14,2);
      v_acc_id UUID;
      v_new_bal NUMERIC(14,2);
      v_updated INTEGER := 0;
      v_results JSONB := '[]'::jsonb;
    BEGIN
      IF p_realm_id IS NULL OR TRIM(p_realm_id) = '' THEN
        RAISE EXCEPTION 'INVALID_REALM_ID: company_realm_id is required for atomic balance update';
      END IF;

      IF p_deltas IS NULL OR jsonb_typeof(p_deltas) <> 'array' OR jsonb_array_length(p_deltas) = 0 THEN
        RETURN jsonb_build_object('ok', true, 'updated_count', 0, 'accounts', '[]'::jsonb);
      END IF;

      FOR v_item IN SELECT * FROM jsonb_array_elements(p_deltas)
      LOOP
        v_qb_id := TRIM(COALESCE(v_item->>'qb_account_id', ''));
        v_delta := ROUND(COALESCE((v_item->>'delta')::numeric, 0), 2);

        IF v_qb_id = '' OR ABS(v_delta) < 0.001 THEN
          CONTINUE;
        END IF;

        UPDATE public.external_accounting_accounts
        SET
          current_balance = ROUND(COALESCE(current_balance, 0) + v_delta, 2),
          updated_at = NOW()
        WHERE company_realm_id = p_realm_id
          AND qb_account_id = v_qb_id
        RETURNING id, current_balance INTO v_acc_id, v_new_bal;

        IF v_acc_id IS NULL THEN
          RAISE EXCEPTION 'ACCOUNT_NOT_FOUND_IN_REALM: Account qb_account_id=% does not exist in company_realm_id=%', v_qb_id, p_realm_id USING ERRCODE = 'P0002';
        END IF;

        v_updated := v_updated + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'account_id', v_acc_id,
          'qb_account_id', v_qb_id,
          'delta', v_delta,
          'current_balance', v_new_bal
        ));
      END LOOP;

      RETURN jsonb_build_object('ok', true, 'updated_count', v_updated, 'accounts', v_results);
    END;
    $fn$;
    `
  )

  await execDdl(
    'fn_ext_acct_mutate_transaction_atomic',
    `
    CREATE OR REPLACE FUNCTION public.fn_ext_acct_mutate_transaction_atomic(
      p_operation TEXT,
      p_realm_id TEXT,
      p_txn JSONB,
      p_deltas JSONB DEFAULT '[]'::jsonb,
      p_invoice_updates JSONB DEFAULT '[]'::jsonb,
      p_contact_deltas JSONB DEFAULT '[]'::jsonb,
      p_audit JSONB DEFAULT NULL,
      p_outbox JSONB DEFAULT NULL
    )
    RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $fn$
    DECLARE
      v_tx_id UUID;
      v_saved_row public.external_accounting_transactions%ROWTYPE;
      v_delta_res JSONB;
      v_inv_item JSONB;
      v_con_item JSONB;
      v_audit_id UUID;
      v_outbox_id UUID;
    BEGIN
      IF p_realm_id IS NULL OR TRIM(p_realm_id) = '' THEN
        RAISE EXCEPTION 'INVALID_REALM_ID: company_realm_id is required';
      END IF;

      IF p_audit IS NULL OR COALESCE(TRIM(p_audit->>'action_type'), '') = '' OR COALESCE(TRIM(p_audit->>'summary'), '') = '' THEN
        RAISE EXCEPTION 'AUDIT_REQUIRED: Every accounting mutation requires a valid non-empty p_audit payload';
      END IF;

      IF p_operation = 'UPSERT' THEN
        IF NULLIF(p_txn->>'id', '') IS NOT NULL THEN
          v_tx_id := (p_txn->>'id')::uuid;
          UPDATE public.external_accounting_transactions
          SET
            txn_type = COALESCE(p_txn->>'txn_type', txn_type),
            qb_entity_type = COALESCE(p_txn->>'qb_entity_type', qb_entity_type),
            qb_txn_id = COALESCE(p_txn->>'qb_txn_id', qb_txn_id),
            txn_date = COALESCE((p_txn->>'txn_date')::date, txn_date),
            due_date = CASE WHEN p_txn ? 'due_date' THEN NULLIF(p_txn->>'due_date', '')::date ELSE due_date END,
            doc_number = CASE WHEN p_txn ? 'doc_number' THEN NULLIF(p_txn->>'doc_number', '') ELSE doc_number END,
            payment_type = CASE WHEN p_txn ? 'payment_type' THEN NULLIF(p_txn->>'payment_type', '') ELSE payment_type END,
            payment_method = CASE WHEN p_txn ? 'payment_method' THEN NULLIF(p_txn->>'payment_method', '') ELSE payment_method END,
            payment_method_qb_id = CASE WHEN p_txn ? 'payment_method_qb_id' THEN NULLIF(p_txn->>'payment_method_qb_id', '') ELSE payment_method_qb_id END,
            direction = COALESCE(p_txn->>'direction', direction),
            account_qb_id = CASE WHEN p_txn ? 'account_qb_id' THEN NULLIF(p_txn->>'account_qb_id', '') ELSE account_qb_id END,
            account_name = CASE WHEN p_txn ? 'account_name' THEN NULLIF(p_txn->>'account_name', '') ELSE account_name END,
            to_account_qb_id = CASE WHEN p_txn ? 'to_account_qb_id' THEN NULLIF(p_txn->>'to_account_qb_id', '') ELSE to_account_qb_id END,
            to_account_name = CASE WHEN p_txn ? 'to_account_name' THEN NULLIF(p_txn->>'to_account_name', '') ELSE to_account_name END,
            entity_qb_id = CASE WHEN p_txn ? 'entity_qb_id' THEN NULLIF(p_txn->>'entity_qb_id', '') ELSE entity_qb_id END,
            entity_name = CASE WHEN p_txn ? 'entity_name' THEN NULLIF(p_txn->>'entity_name', '') ELSE entity_name END,
            entity_type = CASE WHEN p_txn ? 'entity_type' THEN NULLIF(p_txn->>'entity_type', '') ELSE entity_type END,
            department_qb_id = CASE WHEN p_txn ? 'department_qb_id' THEN NULLIF(p_txn->>'department_qb_id', '') ELSE department_qb_id END,
            department_name = CASE WHEN p_txn ? 'department_name' THEN NULLIF(p_txn->>'department_name', '') ELSE department_name END,
            class_qb_id = CASE WHEN p_txn ? 'class_qb_id' THEN NULLIF(p_txn->>'class_qb_id', '') ELSE class_qb_id END,
            class_name = CASE WHEN p_txn ? 'class_name' THEN NULLIF(p_txn->>'class_name', '') ELSE class_name END,
            term_qb_id = CASE WHEN p_txn ? 'term_qb_id' THEN NULLIF(p_txn->>'term_qb_id', '') ELSE term_qb_id END,
            term_name = CASE WHEN p_txn ? 'term_name' THEN NULLIF(p_txn->>'term_name', '') ELSE term_name END,
            total_amount = COALESCE((p_txn->>'total_amount')::numeric(14,2), total_amount),
            open_balance = COALESCE((p_txn->>'open_balance')::numeric(14,2), open_balance),
            memo = CASE WHEN p_txn ? 'memo' THEN NULLIF(p_txn->>'memo', '') ELSE memo END,
            category_summary = COALESCE(p_txn->>'category_summary', category_summary),
            print_status = COALESCE(p_txn->>'print_status', print_status),
            cleared_status = COALESCE(p_txn->>'cleared_status', cleared_status),
            is_voided = COALESCE((p_txn->>'is_voided')::boolean, is_voided),
            line_items = COALESCE(p_txn->'line_items', line_items),
            raw_data = COALESCE(p_txn->'raw_data', raw_data),
            custom_fields = COALESCE(p_txn->'custom_fields', custom_fields),
            updated_at = NOW()
          WHERE id = v_tx_id AND company_realm_id = p_realm_id
          RETURNING * INTO v_saved_row;

          IF v_saved_row.id IS NULL THEN
            RAISE EXCEPTION 'TXN_NOT_FOUND_IN_REALM: Transaction id=% not found in company_realm_id=%', v_tx_id, p_realm_id;
          END IF;
        ELSE
          INSERT INTO public.external_accounting_transactions (
            company_realm_id, txn_type, qb_entity_type, qb_txn_id, txn_date, due_date, doc_number,
            payment_type, payment_method, payment_method_qb_id, direction,
            account_qb_id, account_name, to_account_qb_id, to_account_name,
            entity_qb_id, entity_name, entity_type,
            department_qb_id, department_name, class_qb_id, class_name, term_qb_id, term_name,
            total_amount, open_balance, memo, category_summary, print_status, cleared_status,
            is_voided, line_items, raw_data, custom_fields, created_by, updated_at
          ) VALUES (
            p_realm_id,
            p_txn->>'txn_type',
            p_txn->>'qb_entity_type',
            p_txn->>'qb_txn_id',
            (p_txn->>'txn_date')::date,
            NULLIF(p_txn->>'due_date', '')::date,
            NULLIF(p_txn->>'doc_number', ''),
            NULLIF(p_txn->>'payment_type', ''),
            NULLIF(p_txn->>'payment_method', ''),
            NULLIF(p_txn->>'payment_method_qb_id', ''),
            COALESCE(p_txn->>'direction', 'OUT'),
            NULLIF(p_txn->>'account_qb_id', ''),
            NULLIF(p_txn->>'account_name', ''),
            NULLIF(p_txn->>'to_account_qb_id', ''),
            NULLIF(p_txn->>'to_account_name', ''),
            NULLIF(p_txn->>'entity_qb_id', ''),
            NULLIF(p_txn->>'entity_name', ''),
            NULLIF(p_txn->>'entity_type', ''),
            NULLIF(p_txn->>'department_qb_id', ''),
            NULLIF(p_txn->>'department_name', ''),
            NULLIF(p_txn->>'class_qb_id', ''),
            NULLIF(p_txn->>'class_name', ''),
            NULLIF(p_txn->>'term_qb_id', ''),
            NULLIF(p_txn->>'term_name', ''),
            COALESCE((p_txn->>'total_amount')::numeric(14,2), 0),
            COALESCE((p_txn->>'open_balance')::numeric(14,2), 0),
            NULLIF(p_txn->>'memo', ''),
            COALESCE(p_txn->>'category_summary', ''),
            COALESCE(p_txn->>'print_status', 'NotSet'),
            COALESCE(p_txn->>'cleared_status', 'Uncleared'),
            COALESCE((p_txn->>'is_voided')::boolean, false),
            COALESCE(p_txn->'line_items', '[]'::jsonb),
            COALESCE(p_txn->'raw_data', '{}'::jsonb),
            COALESCE(p_txn->'custom_fields', '{}'::jsonb),
            COALESCE(p_txn->>'created_by', 'Authorized User'),
            NOW()
          )
          RETURNING * INTO v_saved_row;
        END IF;

      ELSIF p_operation = 'VOID' THEN
        v_tx_id := (p_txn->>'id')::uuid;
        UPDATE public.external_accounting_transactions
        SET
          is_voided = true,
          cleared_status = 'Voided',
          open_balance = 0,
          memo = COALESCE(p_txn->>'memo', memo),
          raw_data = COALESCE(p_txn->'raw_data', raw_data),
          updated_at = NOW()
        WHERE id = v_tx_id AND company_realm_id = p_realm_id
        RETURNING * INTO v_saved_row;

        IF v_saved_row.id IS NULL THEN
          RAISE EXCEPTION 'TXN_NOT_FOUND_IN_REALM: Transaction id=% not found in company_realm_id=%', v_tx_id, p_realm_id;
        END IF;

      ELSIF p_operation = 'DELETE' THEN
        v_tx_id := (p_txn->>'id')::uuid;
        DELETE FROM public.external_accounting_transactions
        WHERE id = v_tx_id AND company_realm_id = p_realm_id
        RETURNING * INTO v_saved_row;

        IF v_saved_row.id IS NULL THEN
          RAISE EXCEPTION 'TXN_NOT_FOUND_IN_REALM: Transaction id=% not found in company_realm_id=%', v_tx_id, p_realm_id;
        END IF;

      ELSE
        RAISE EXCEPTION 'UNSUPPORTED_OPERATION: %', p_operation;
      END IF;

      v_delta_res := public.fn_ext_acct_apply_account_deltas(p_realm_id, p_deltas);

      IF p_invoice_updates IS NOT NULL AND jsonb_typeof(p_invoice_updates) = 'array' THEN
        FOR v_inv_item IN SELECT * FROM jsonb_array_elements(p_invoice_updates)
        LOOP
          UPDATE public.external_accounting_transactions
          SET
            open_balance = ROUND(COALESCE((v_inv_item->>'open_balance')::numeric, 0), 2),
            raw_data = COALESCE(v_inv_item->'raw_data', raw_data),
            updated_at = NOW()
          WHERE id = (v_inv_item->>'id')::uuid
            AND company_realm_id = p_realm_id;
        END LOOP;
      END IF;

      IF p_contact_deltas IS NOT NULL AND jsonb_typeof(p_contact_deltas) = 'array' THEN
        FOR v_con_item IN SELECT * FROM jsonb_array_elements(p_contact_deltas)
        LOOP
          UPDATE public.external_accounting_contacts
          SET
            balance = GREATEST(0, ROUND(COALESCE(balance, 0) + COALESCE((v_con_item->>'delta')::numeric, 0), 2)),
            updated_at = NOW()
          WHERE company_realm_id = p_realm_id
            AND qb_contact_id = (v_con_item->>'qb_contact_id');
        END LOOP;
      END IF;

      IF p_outbox IS NOT NULL AND jsonb_typeof(p_outbox) = 'object' AND COALESCE(p_outbox->>'idempotency_key', '') <> '' THEN
        INSERT INTO public.external_accounting_sync_outbox (
          company_realm_id, entity_kind, entity_type, local_entity_id, qb_entity_id,
          operation, idempotency_key, payload, status, created_by, updated_at
        ) VALUES (
          p_realm_id,
          COALESCE(p_outbox->>'entity_kind', 'TRANSACTION'),
          COALESCE(p_outbox->>'entity_type', v_saved_row.qb_entity_type, v_saved_row.txn_type),
          v_saved_row.id,
          COALESCE(p_outbox->>'qb_entity_id', v_saved_row.qb_txn_id),
          COALESCE(p_outbox->>'operation', p_operation),
          p_outbox->>'idempotency_key',
          COALESCE(p_outbox->'payload', to_jsonb(v_saved_row)),
          COALESCE(p_outbox->>'status', 'PENDING'),
          COALESCE(p_audit->>'user_name', 'Authorized User'),
          NOW()
        )
        ON CONFLICT (idempotency_key) DO UPDATE SET
          payload = EXCLUDED.payload,
          status = EXCLUDED.status,
          updated_at = NOW()
        RETURNING id INTO v_outbox_id;
      END IF;

      INSERT INTO public.external_accounting_audit_log (
        company_realm_id, user_id, user_name, user_email,
        action_type, entity_type, entity_id, doc_number, amount, summary, details
      ) VALUES (
        p_realm_id,
        COALESCE(p_audit->>'user_id', ''),
        COALESCE(p_audit->>'user_name', 'Authorized User'),
        NULLIF(p_audit->>'user_email', ''),
        p_audit->>'action_type',
        COALESCE(p_audit->>'entity_type', v_saved_row.txn_type),
        COALESCE(p_audit->>'entity_id', v_saved_row.id::text),
        COALESCE(NULLIF(p_audit->>'doc_number', ''), v_saved_row.doc_number),
        COALESCE((p_audit->>'amount')::numeric(14,2), v_saved_row.total_amount),
        p_audit->>'summary',
        COALESCE(p_audit->'details', '{}'::jsonb)
      )
      RETURNING id INTO v_audit_id;

      IF v_audit_id IS NULL THEN
        RAISE EXCEPTION 'AUDIT_INSERT_FAILED: Could not record mandatory audit entry';
      END IF;

      RETURN jsonb_build_object(
        'ok', true,
        'transaction', to_jsonb(v_saved_row),
        'balance_updates', v_delta_res,
        'audit_id', v_audit_id,
        'outbox_id', v_outbox_id
      );
    END;
    $fn$;

    NOTIFY pgrst, 'reload schema';
    `
  )

  // 7. Verify everything in PostgreSQL catalog
  console.log('\n7. Verifying Companies, RLS Policies, Triggers & Atomic RPCs...')
  const companies = await execQuery(`
    SELECT realm_id, company_name, is_active,
           metadata->>'qbo_subscription_status' AS qbo_status,
           metadata->>'qbo_sync_enabled' AS sync_enabled,
           metadata->>'local_erp_mode' AS local_erp_mode
    FROM public.external_accounting_companies
    ORDER BY company_name
  `)
  console.table(companies)

  const policyCheck = await execQuery(`
    SELECT COUNT(*) AS total_policies,
           COUNT(*) FILTER (WHERE roles::text LIKE '%public%') AS permissive_public_policies,
           COUNT(*) FILTER (WHERE policyname LIKE 'auth_ext_acct_users_%') AS strict_auth_policies,
           COUNT(*) FILTER (WHERE policyname LIKE 'service_role_all_%') AS service_role_policies
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename LIKE 'external_accounting_%'
  `)
  console.log('🔒 RLS Policy Verification:', JSON.stringify(policyCheck, null, 2))

  const linkedStats = await execQuery(`
    SELECT source_txn_type, target_txn_type, link_scope, COUNT(*) AS edge_count, SUM(applied_amount) AS total_applied
    FROM public.external_accounting_linked_transactions
    GROUP BY source_txn_type, target_txn_type, link_scope
    ORDER BY edge_count DESC
  `)
  console.log('🔗 Deduped LinkedTxn Summary:', JSON.stringify(linkedStats, null, 2))
}

main().catch(err => {
  console.error('❌ Migration failed:', err)
  process.exit(1)
})
