-- =============================================================================
-- @module scripts/external-accounting-phase6-hardening.sql
-- @description Fase 6 de Hardening para el ERP Contable Externo (/admin/contabilidad-externa):
--   1. Unificación del contrato de `external_accounting_sync_outbox` (`attempts`, `max_attempts`,
--      `next_retry_at`, `status`, `last_error`, `synced_at`), eliminando `attempt_count` y
--      ampliando `entity_kind` a ('TRANSACTION','ACCOUNT','CONTACT','LIST_ITEM','RECURRING','ATTACHMENT').
--   2. Prohibición estricta de guardar binarios (`data_url` / `file_base64`) dentro de JSONB en
--      `external_accounting_attachments` y adición de columnas de Supabase Storage (`storage_bucket`,
--      `storage_path`, `sha256_hash`, `file_size`, `size_bytes`, `content_type`, `file_url`).
--   3. Extensión de cobertura ACID transaccional a TODAS las rutas contables mediante RPCs en PostgreSQL:
--      - `fn_ext_acct_save_reconciliation_atomic`
--      - `fn_ext_acct_reopen_or_delete_reconciliation_atomic`
--      - `fn_ext_acct_batch_mutate_transactions_atomic` (batch_save, reclassify, bank_rules, write_off)
--      - `fn_ext_acct_mutate_entity_atomic` (account, contact, list_item, recurring, attachment)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. REPAIR & UNIFY QBO OUTBOX CONTRACT
-- -----------------------------------------------------------------------------
ALTER TABLE public.external_accounting_sync_outbox
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'external_accounting_sync_outbox'
      AND column_name = 'attempt_count'
  ) THEN
    EXECUTE 'UPDATE public.external_accounting_sync_outbox SET attempts = GREATEST(attempts, COALESCE(attempt_count, 0))';
    EXECUTE 'ALTER TABLE public.external_accounting_sync_outbox DROP COLUMN attempt_count';
  END IF;
END $$;

ALTER TABLE public.external_accounting_sync_outbox
  DROP CONSTRAINT IF EXISTS external_accounting_sync_outbox_entity_kind_check;

ALTER TABLE public.external_accounting_sync_outbox
  ADD CONSTRAINT external_accounting_sync_outbox_entity_kind_check
  CHECK (entity_kind IN ('TRANSACTION', 'ACCOUNT', 'CONTACT', 'LIST_ITEM', 'RECURRING', 'ATTACHMENT', 'BANK_RULE', 'BUDGET', 'COMPANY_SETTINGS', 'NOTE_TASK'));

ALTER TABLE public.external_accounting_sync_outbox
  DROP CONSTRAINT IF EXISTS external_accounting_sync_outbox_operation_check;

ALTER TABLE public.external_accounting_sync_outbox
  ADD CONSTRAINT external_accounting_sync_outbox_operation_check
  CHECK (operation IN ('CREATE', 'UPDATE', 'UPSERT', 'VOID', 'DELETE', 'DEACTIVATE', 'TOGGLE', 'STORAGE_CLEANUP'));

ALTER TABLE public.external_accounting_sync_outbox
  DROP CONSTRAINT IF EXISTS external_accounting_sync_outbox_status_check;

ALTER TABLE public.external_accounting_sync_outbox
  ADD CONSTRAINT external_accounting_sync_outbox_status_check
  CHECK (status IN ('PENDING', 'PROCESSING', 'SYNCED', 'FAILED', 'SKIPPED_LOCAL_ONLY'));

CREATE INDEX IF NOT EXISTS idx_ext_acct_outbox_worker
  ON public.external_accounting_sync_outbox(company_realm_id, status, next_retry_at)
  WHERE status IN ('PENDING', 'FAILED');

-- -----------------------------------------------------------------------------
-- 2. HARDEN ATTACHMENTS TABLE FOR SUPABASE STORAGE (NO BINARY DATA_URL IN JSONB)
-- -----------------------------------------------------------------------------
ALTER TABLE public.external_accounting_attachments
  ADD COLUMN IF NOT EXISTS storage_bucket TEXT DEFAULT 'external-accounting-attachments',
  ADD COLUMN IF NOT EXISTS storage_path TEXT,
  ADD COLUMN IF NOT EXISTS sha256_hash TEXT,
  ADD COLUMN IF NOT EXISTS file_size BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS size_bytes BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS content_type TEXT DEFAULT 'application/octet-stream',
  ADD COLUMN IF NOT EXISTS file_url TEXT,
  ADD COLUMN IF NOT EXISTS transaction_id UUID REFERENCES public.external_accounting_transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES public.external_accounting_contacts(id) ON DELETE SET NULL;

UPDATE public.external_accounting_attachments
SET raw_data = COALESCE(raw_data, '{}'::jsonb) - 'data_url' - 'file_base64'
WHERE raw_data ? 'data_url' OR raw_data ? 'file_base64';

ALTER TABLE public.external_accounting_attachments
  DROP CONSTRAINT IF EXISTS chk_ext_acct_attachments_no_binary_jsonb;

ALTER TABLE public.external_accounting_attachments
  ADD CONSTRAINT chk_ext_acct_attachments_no_binary_jsonb
  CHECK (
    raw_data IS NULL
    OR (
      (NOT (raw_data ? 'data_url') OR raw_data->>'data_url' IS NULL)
      AND (NOT (raw_data ? 'file_base64') OR raw_data->>'file_base64' IS NULL)
    )
  );

-- -----------------------------------------------------------------------------
-- 3. ATOMIC BANK RECONCILIATION RPC (SAVE + SERVICE CHARGE + INTEREST + ADJUSTMENT)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ext_acct_save_reconciliation_atomic(
  p_realm_id TEXT,
  p_reconciliation JSONB,
  p_extra_transactions JSONB DEFAULT '[]'::jsonb,
  p_deltas JSONB DEFAULT '[]'::jsonb,
  p_audit JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comp_meta JSONB;
  v_qbo_sync_enabled BOOLEAN := true;
  v_bank_qb_id TEXT;
  v_bank_name TEXT;
  v_status TEXT;
  v_diff NUMERIC(18,2);
  v_rec_id UUID;
  v_rec_row public.external_accounting_reconciliations%ROWTYPE;
  v_txn_ids TEXT[] := ARRAY[]::TEXT[];
  v_req_id TEXT;
  v_found_txn_id UUID;
  v_extra JSONB;
  v_extra_txn JSONB;
  v_extra_outbox JSONB;
  v_extra_audit JSONB;
  v_saved_extra public.external_accounting_transactions%ROWTYPE;
  v_extra_saved_list JSONB := '[]'::jsonb;
  v_outbox_ids JSONB := '[]'::jsonb;
  v_outbox_id UUID;
  v_outbox_status TEXT;
  v_balance_res JSONB;
  v_audit_id UUID;
BEGIN
  IF p_realm_id IS NULL OR btrim(p_realm_id) = '' THEN
    RAISE EXCEPTION 'p_realm_id is required for atomic reconciliation';
  END IF;

  SELECT metadata INTO v_comp_meta
  FROM public.external_accounting_companies
  WHERE realm_id = p_realm_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company % does not exist', p_realm_id;
  END IF;

  IF v_comp_meta IS NOT NULL AND (v_comp_meta->>'qbo_sync_enabled') IS NOT NULL THEN
    v_qbo_sync_enabled := (v_comp_meta->>'qbo_sync_enabled')::boolean;
  END IF;

  IF p_audit IS NULL OR COALESCE(btrim(p_audit->>'action_type'), '') = '' OR COALESCE(btrim(p_audit->>'summary'), '') = '' THEN
    RAISE EXCEPTION 'Mandatory audit payload (action_type, summary) is required for reconciliation';
  END IF;

  v_bank_qb_id := btrim(COALESCE(p_reconciliation->>'account_qb_id', ''));
  IF v_bank_qb_id = '' THEN
    RAISE EXCEPTION 'account_qb_id is required for reconciliation';
  END IF;

  SELECT name INTO v_bank_name
  FROM public.external_accounting_accounts
  WHERE company_realm_id = p_realm_id
    AND qb_account_id = v_bank_qb_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bank account % does not belong to company %', v_bank_qb_id, p_realm_id;
  END IF;

  v_status := COALESCE(NULLIF(btrim(p_reconciliation->>'status'), ''), 'Draft');
  v_diff := ROUND(COALESCE((p_reconciliation->>'difference')::numeric, 0), 2);

  IF v_status = 'Completed' AND ABS(v_diff) >= 0.01 THEN
    RAISE EXCEPTION 'Cannot complete reconciliation with non-zero difference (%)', v_diff;
  END IF;

  -- Validate all pre-existing reconciled_txn_ids belong to p_realm_id and are not voided
  IF p_reconciliation->'reconciled_txn_ids' IS NOT NULL AND jsonb_typeof(p_reconciliation->'reconciled_txn_ids') = 'array' THEN
    FOR v_req_id IN SELECT jsonb_array_elements_text(p_reconciliation->'reconciled_txn_ids')
    LOOP
      IF btrim(v_req_id) <> '' THEN
        BEGIN
          v_found_txn_id := v_req_id::uuid;
        EXCEPTION WHEN OTHERS THEN
          RAISE EXCEPTION 'Invalid transaction UUID (%) in reconciled_txn_ids', v_req_id;
        END;

        PERFORM 1
        FROM public.external_accounting_transactions
        WHERE id = v_found_txn_id
          AND company_realm_id = p_realm_id
          AND COALESCE(is_voided, false) = false;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Reconciled transaction % does not exist in company % or is voided', v_req_id, p_realm_id;
        END IF;

        v_txn_ids := array_append(v_txn_ids, v_found_txn_id::text);
      END IF;
    END LOOP;
  END IF;

  -- Insert optional extra transactions (service_charge, interest_earned, adjustment)
  IF p_extra_transactions IS NOT NULL AND jsonb_typeof(p_extra_transactions) = 'array' THEN
    FOR v_extra IN SELECT * FROM jsonb_array_elements(p_extra_transactions)
    LOOP
      v_extra_txn := v_extra->'txn';
      v_extra_outbox := v_extra->'outbox';
      v_extra_audit := v_extra->'audit';

      IF v_extra_txn IS NULL THEN
        RAISE EXCEPTION 'Extra reconciliation transaction entry is missing txn object';
      END IF;

      -- Validate target account of extra transaction belongs to p_realm_id
      IF COALESCE(btrim(v_extra_txn->>'to_account_qb_id'), '') = '' OR NOT EXISTS (
        SELECT 1 FROM public.external_accounting_accounts
        WHERE company_realm_id = p_realm_id
          AND qb_account_id = btrim(v_extra_txn->>'to_account_qb_id')
      ) THEN
        RAISE EXCEPTION 'Counter-account (%) for reconciliation extra entry does not belong to company %',
          COALESCE(v_extra_txn->>'to_account_qb_id', 'NULL'), p_realm_id;
      END IF;

      INSERT INTO public.external_accounting_transactions (
        company_realm_id, txn_type, qb_entity_type, qb_txn_id, txn_date,
        doc_number, payment_type, direction, account_qb_id, account_name,
        to_account_qb_id, to_account_name, entity_qb_id, entity_name, entity_type,
        total_amount, open_balance, memo, category_summary, print_status,
        cleared_status, is_voided, line_items, raw_data, created_by, updated_at
      ) VALUES (
        p_realm_id,
        v_extra_txn->>'txn_type',
        COALESCE(v_extra_txn->>'qb_entity_type', v_extra_txn->>'txn_type'),
        v_extra_txn->>'qb_txn_id',
        (v_extra_txn->>'txn_date')::date,
        v_extra_txn->>'doc_number',
        COALESCE(v_extra_txn->>'payment_type', v_extra_txn->>'txn_type'),
        COALESCE(v_extra_txn->>'direction', 'OUT'),
        v_bank_qb_id,
        v_bank_name,
        v_extra_txn->>'to_account_qb_id',
        v_extra_txn->>'to_account_name',
        v_extra_txn->>'entity_qb_id',
        v_extra_txn->>'entity_name',
        v_extra_txn->>'entity_type',
        ROUND(COALESCE((v_extra_txn->>'total_amount')::numeric, 0), 2),
        0,
        v_extra_txn->>'memo',
        v_extra_txn->>'category_summary',
        'NotSet',
        CASE WHEN v_status = 'Completed' THEN 'Reconciled' ELSE 'Cleared' END,
        false,
        COALESCE(v_extra_txn->'line_items', '[]'::jsonb),
        COALESCE(v_extra_txn->'raw_data', '{}'::jsonb),
        v_extra_txn->>'created_by',
        NOW()
      )
      RETURNING * INTO v_saved_extra;

      v_txn_ids := array_append(v_txn_ids, v_saved_extra.id::text);
      v_extra_saved_list := v_extra_saved_list || jsonb_build_array(to_jsonb(v_saved_extra));

      v_outbox_status := CASE
        WHEN NOT v_qbo_sync_enabled THEN 'SKIPPED_LOCAL_ONLY'
        ELSE 'PENDING'
      END;

      INSERT INTO public.external_accounting_sync_outbox (
        company_realm_id, entity_kind, entity_type, local_entity_id, qb_entity_id,
        operation, idempotency_key, payload, status, attempts, max_attempts, next_retry_at, created_by
      ) VALUES (
        p_realm_id,
        'TRANSACTION',
        v_saved_extra.qb_entity_type,
        v_saved_extra.id,
        v_saved_extra.qb_txn_id,
        'UPSERT',
        COALESCE(v_extra_outbox->>'idempotency_key', 'REC-EXTRA-' || v_saved_extra.id::text),
        to_jsonb(v_saved_extra),
        v_outbox_status,
        0,
        5,
        NOW(),
        p_audit->>'user_name'
      )
      RETURNING id INTO v_outbox_id;

      v_outbox_ids := v_outbox_ids || jsonb_build_array(v_outbox_id);

      IF v_extra_audit IS NOT NULL AND jsonb_typeof(v_extra_audit) = 'object' AND COALESCE(v_extra_audit->>'action_type', '') <> '' THEN
        INSERT INTO public.external_accounting_audit_log (
          company_realm_id, user_id, user_name, user_email, action_type,
          entity_type, entity_id, doc_number, amount, summary, details
        ) VALUES (
          p_realm_id,
          COALESCE(v_extra_audit->>'user_id', p_audit->>'user_id', ''),
          COALESCE(v_extra_audit->>'user_name', p_audit->>'user_name', 'Authorized User'),
          COALESCE(v_extra_audit->>'user_email', p_audit->>'user_email'),
          v_extra_audit->>'action_type',
          'Transaction',
          v_saved_extra.id::text,
          v_saved_extra.txn_date::text,
          v_saved_extra.total_amount,
          v_extra_audit->>'summary',
          COALESCE(v_extra_audit->'details', '{}'::jsonb) || jsonb_build_object('adj_txn_id', v_saved_extra.id)
        );
      END IF;
    END LOOP;
  END IF;

  -- Apply atomic account deltas for generated transactions
  IF p_deltas IS NOT NULL AND jsonb_typeof(p_deltas) = 'array' AND jsonb_array_length(p_deltas) > 0 THEN
    v_balance_res := public.fn_ext_acct_apply_account_deltas(p_realm_id, p_deltas);
  ELSE
    v_balance_res := jsonb_build_object('ok', true, 'updated_count', 0);
  END IF;

  -- Mark all reconciled transactions as Reconciled when Completed
  IF v_status = 'Completed' AND array_length(v_txn_ids, 1) > 0 THEN
    UPDATE public.external_accounting_transactions
    SET cleared_status = 'Reconciled',
        updated_at = NOW()
    WHERE company_realm_id = p_realm_id
      AND id::text = ANY(v_txn_ids);
  END IF;

  v_rec_id := NULLIF(btrim(COALESCE(p_reconciliation->>'id', '')), '')::uuid;

  IF v_rec_id IS NOT NULL THEN
    UPDATE public.external_accounting_reconciliations
    SET
      account_qb_id = v_bank_qb_id,
      account_name = v_bank_name,
      statement_ending_date = (p_reconciliation->>'statement_ending_date')::date,
      beginning_balance = ROUND(COALESCE((p_reconciliation->>'beginning_balance')::numeric, 0), 2),
      ending_balance = ROUND(COALESCE((p_reconciliation->>'ending_balance')::numeric, 0), 2),
      cleared_balance = ROUND(COALESCE((p_reconciliation->>'cleared_balance')::numeric, 0), 2),
      difference = v_diff,
      payments_count = COALESCE((p_reconciliation->>'payments_count')::int, 0),
      payments_total = ROUND(COALESCE((p_reconciliation->>'payments_total')::numeric, 0), 2),
      deposits_count = COALESCE((p_reconciliation->>'deposits_count')::int, 0),
      deposits_total = ROUND(COALESCE((p_reconciliation->>'deposits_total')::numeric, 0), 2),
      service_charge = ROUND(COALESCE((p_reconciliation->>'service_charge')::numeric, 0), 2),
      interest_earned = ROUND(COALESCE((p_reconciliation->>'interest_earned')::numeric, 0), 2),
      reconciled_txn_ids = to_jsonb(v_txn_ids),
      status = v_status,
      notes = p_reconciliation->>'notes',
      reconciled_by = p_reconciliation->>'reconciled_by',
      completed_at = CASE WHEN v_status = 'Completed' THEN NOW() ELSE NULL END,
      updated_at = NOW()
    WHERE id = v_rec_id
      AND company_realm_id = p_realm_id
    RETURNING * INTO v_rec_row;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Reconciliation % not found in company %', v_rec_id, p_realm_id;
    END IF;
  ELSE
    INSERT INTO public.external_accounting_reconciliations (
      company_realm_id, account_qb_id, account_name, statement_ending_date,
      beginning_balance, ending_balance, cleared_balance, difference,
      payments_count, payments_total, deposits_count, deposits_total,
      service_charge, interest_earned, reconciled_txn_ids, status,
      notes, reconciled_by, completed_at, updated_at
    ) VALUES (
      p_realm_id,
      v_bank_qb_id,
      v_bank_name,
      (p_reconciliation->>'statement_ending_date')::date,
      ROUND(COALESCE((p_reconciliation->>'beginning_balance')::numeric, 0), 2),
      ROUND(COALESCE((p_reconciliation->>'ending_balance')::numeric, 0), 2),
      ROUND(COALESCE((p_reconciliation->>'cleared_balance')::numeric, 0), 2),
      v_diff,
      COALESCE((p_reconciliation->>'payments_count')::int, 0),
      ROUND(COALESCE((p_reconciliation->>'payments_total')::numeric, 0), 2),
      COALESCE((p_reconciliation->>'deposits_count')::int, 0),
      ROUND(COALESCE((p_reconciliation->>'deposits_total')::numeric, 0), 2),
      ROUND(COALESCE((p_reconciliation->>'service_charge')::numeric, 0), 2),
      ROUND(COALESCE((p_reconciliation->>'interest_earned')::numeric, 0), 2),
      to_jsonb(v_txn_ids),
      v_status,
      p_reconciliation->>'notes',
      p_reconciliation->>'reconciled_by',
      CASE WHEN v_status = 'Completed' THEN NOW() ELSE NULL END,
      NOW()
    )
    RETURNING * INTO v_rec_row;
  END IF;

  INSERT INTO public.external_accounting_audit_log (
    company_realm_id, user_id, user_name, user_email, action_type,
    entity_type, entity_id, doc_number, amount, summary, details
  ) VALUES (
    p_realm_id,
    COALESCE(p_audit->>'user_id', ''),
    COALESCE(p_audit->>'user_name', 'Authorized User'),
    p_audit->>'user_email',
    p_audit->>'action_type',
    'Reconciliation',
    v_rec_row.id::text,
    v_rec_row.statement_ending_date::text,
    v_rec_row.ending_balance,
    p_audit->>'summary',
    COALESCE(p_audit->'details', '{}'::jsonb)
  )
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'ok', true,
    'reconciliation', to_jsonb(v_rec_row),
    'extra_transactions', v_extra_saved_list,
    'outbox_ids', v_outbox_ids,
    'balance_updates', v_balance_res,
    'audit_id', v_audit_id
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. ATOMIC REOPEN OR DELETE RECONCILIATION RPC
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ext_acct_reopen_or_delete_reconciliation_atomic(
  p_operation TEXT,
  p_realm_id TEXT,
  p_reconciliation_id UUID,
  p_audit JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec public.external_accounting_reconciliations%ROWTYPE;
  v_txn_ids TEXT[] := ARRAY[]::TEXT[];
  v_tid TEXT;
  v_audit_id UUID;
BEGIN
  IF p_operation NOT IN ('REOPEN', 'DELETE') THEN
    RAISE EXCEPTION 'Invalid reconciliation operation: %', p_operation;
  END IF;

  SELECT * INTO v_rec
  FROM public.external_accounting_reconciliations
  WHERE id = p_reconciliation_id
    AND company_realm_id = p_realm_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reconciliation % not found in company %', p_reconciliation_id, p_realm_id;
  END IF;

  IF v_rec.reconciled_txn_ids IS NOT NULL AND jsonb_typeof(v_rec.reconciled_txn_ids) = 'array' THEN
    FOR v_tid IN SELECT jsonb_array_elements_text(v_rec.reconciled_txn_ids)
    LOOP
      IF btrim(v_tid) <> '' THEN
        v_txn_ids := array_append(v_txn_ids, v_tid);
      END IF;
    END LOOP;
  END IF;

  IF array_length(v_txn_ids, 1) > 0 THEN
    UPDATE public.external_accounting_transactions
    SET cleared_status = 'Cleared',
        updated_at = NOW()
    WHERE company_realm_id = p_realm_id
      AND id::text = ANY(v_txn_ids);
  END IF;

  IF p_operation = 'REOPEN' THEN
    UPDATE public.external_accounting_reconciliations
    SET status = 'Draft',
        completed_at = NULL,
        updated_at = NOW()
    WHERE id = p_reconciliation_id
      AND company_realm_id = p_realm_id
    RETURNING * INTO v_rec;
  ELSE
    DELETE FROM public.external_accounting_reconciliations
    WHERE id = p_reconciliation_id
      AND company_realm_id = p_realm_id;
  END IF;

  INSERT INTO public.external_accounting_audit_log (
    company_realm_id, user_id, user_name, user_email, action_type,
    entity_type, entity_id, doc_number, amount, summary, details
  ) VALUES (
    p_realm_id,
    COALESCE(p_audit->>'user_id', ''),
    COALESCE(p_audit->>'user_name', 'Authorized User'),
    p_audit->>'user_email',
    COALESCE(p_audit->>'action_type', p_operation || '_RECONCILIATION'),
    'Reconciliation',
    p_reconciliation_id::text,
    v_rec.statement_ending_date::text,
    v_rec.ending_balance,
    COALESCE(p_audit->>'summary', p_operation || ' reconciliation'),
    COALESCE(p_audit->'details', '{}'::jsonb)
  )
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'ok', true,
    'operation', p_operation,
    'reconciliation', to_jsonb(v_rec),
    'audit_id', v_audit_id
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. ATOMIC BATCH TRANSACTION MUTATION RPC
--    Used by: batch_save_transactions, reclassify_transactions, apply_bank_rules, write_off_invoices
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ext_acct_batch_mutate_transactions_atomic(
  p_mode TEXT,
  p_realm_id TEXT,
  p_items JSONB,
  p_deltas JSONB DEFAULT '[]'::jsonb,
  p_invoice_updates JSONB DEFAULT '[]'::jsonb,
  p_contact_updates JSONB DEFAULT '[]'::jsonb,
  p_audit JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comp_meta JSONB;
  v_qbo_sync_enabled BOOLEAN := true;
  v_item JSONB;
  v_txn JSONB;
  v_outbox JSONB;
  v_line JSONB;
  v_saved public.external_accounting_transactions%ROWTYPE;
  v_saved_list JSONB := '[]'::jsonb;
  v_outbox_ids JSONB := '[]'::jsonb;
  v_outbox_id UUID;
  v_outbox_status TEXT;
  v_inv JSONB;
  v_con JSONB;
  v_balance_res JSONB;
  v_audit_id UUID;
  v_idx INTEGER := 0;
BEGIN
  IF p_realm_id IS NULL OR btrim(p_realm_id) = '' THEN
    RAISE EXCEPTION 'p_realm_id is required for atomic batch transaction mutation';
  END IF;

  IF p_mode NOT IN ('BATCH_INSERT', 'BATCH_UPDATE', 'WRITE_OFF') THEN
    RAISE EXCEPTION 'Unsupported batch mode: %', p_mode;
  END IF;

  SELECT metadata INTO v_comp_meta
  FROM public.external_accounting_companies
  WHERE realm_id = p_realm_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company % does not exist', p_realm_id;
  END IF;

  IF v_comp_meta IS NOT NULL AND (v_comp_meta->>'qbo_sync_enabled') IS NOT NULL THEN
    v_qbo_sync_enabled := (v_comp_meta->>'qbo_sync_enabled')::boolean;
  END IF;

  IF p_audit IS NULL OR COALESCE(btrim(p_audit->>'action_type'), '') = '' OR COALESCE(btrim(p_audit->>'summary'), '') = '' THEN
    RAISE EXCEPTION 'Mandatory audit payload (action_type, summary) is required for batch mutation';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'p_items must be a non-empty JSON array';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_idx := v_idx + 1;
    v_txn := COALESCE(v_item->'txn', v_item);
    v_outbox := v_item->'outbox';

    IF COALESCE(btrim(v_txn->>'txn_type'), '') = '' OR COALESCE(btrim(v_txn->>'txn_date'), '') = '' THEN
      RAISE EXCEPTION 'Batch row #% is missing required txn_type or txn_date', v_idx;
    END IF;

    IF COALESCE((v_txn->>'total_amount')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'Batch row #% has invalid total_amount (%)', v_idx, COALESCE(v_txn->>'total_amount', '0');
    END IF;

    IF COALESCE(btrim(v_txn->>'account_qb_id'), '') <> '' THEN
      PERFORM 1
      FROM public.external_accounting_accounts
      WHERE company_realm_id = p_realm_id
        AND qb_account_id = btrim(v_txn->>'account_qb_id');
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Batch row #% references account_qb_id (%) that does not exist in company %',
          v_idx, v_txn->>'account_qb_id', p_realm_id;
      END IF;
    ELSIF p_mode = 'BATCH_INSERT' THEN
      RAISE EXCEPTION 'Batch row #% is missing account_qb_id', v_idx;
    END IF;

    IF COALESCE(btrim(v_txn->>'to_account_qb_id'), '') <> '' THEN
      PERFORM 1
      FROM public.external_accounting_accounts
      WHERE company_realm_id = p_realm_id
        AND qb_account_id = btrim(v_txn->>'to_account_qb_id');
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Batch row #% references to_account_qb_id (%) that does not exist in company %',
          v_idx, v_txn->>'to_account_qb_id', p_realm_id;
      END IF;
    END IF;

    IF v_txn->'line_items' IS NOT NULL AND jsonb_typeof(v_txn->'line_items') = 'array' THEN
      FOR v_line IN SELECT * FROM jsonb_array_elements(v_txn->'line_items')
      LOOP
        IF COALESCE(btrim(v_line->>'account_qb_id'), '') <> '' THEN
          PERFORM 1
          FROM public.external_accounting_accounts
          WHERE company_realm_id = p_realm_id
            AND qb_account_id = btrim(v_line->>'account_qb_id');
          IF NOT FOUND THEN
            RAISE EXCEPTION 'Batch row #% line references account_qb_id (%) that does not exist in company %',
              v_idx, v_line->>'account_qb_id', p_realm_id;
          END IF;
        END IF;
      END LOOP;
    END IF;

    IF p_mode IN ('BATCH_INSERT', 'WRITE_OFF') THEN
      INSERT INTO public.external_accounting_transactions (
        company_realm_id, txn_type, qb_entity_type, qb_txn_id, txn_date, due_date,
        doc_number, payment_type, direction, account_qb_id, account_name,
        to_account_qb_id, to_account_name, entity_qb_id, entity_name, entity_type,
        department_qb_id, department_name, class_qb_id, class_name,
        custom_fields, total_amount, open_balance, memo, category_summary,
        print_status, cleared_status, is_voided, line_items, raw_data, created_by, updated_at
      ) VALUES (
        p_realm_id,
        v_txn->>'txn_type',
        COALESCE(v_txn->>'qb_entity_type', v_txn->>'txn_type'),
        v_txn->>'qb_txn_id',
        (v_txn->>'txn_date')::date,
        NULLIF(v_txn->>'due_date', '')::date,
        v_txn->>'doc_number',
        COALESCE(v_txn->>'payment_type', v_txn->>'txn_type'),
        COALESCE(v_txn->>'direction', 'OUT'),
        v_txn->>'account_qb_id',
        v_txn->>'account_name',
        v_txn->>'to_account_qb_id',
        v_txn->>'to_account_name',
        v_txn->>'entity_qb_id',
        v_txn->>'entity_name',
        v_txn->>'entity_type',
        v_txn->>'department_qb_id',
        v_txn->>'department_name',
        v_txn->>'class_qb_id',
        v_txn->>'class_name',
        COALESCE(v_txn->'custom_fields', '{}'::jsonb),
        ROUND(COALESCE((v_txn->>'total_amount')::numeric, 0), 2),
        ROUND(COALESCE((v_txn->>'open_balance')::numeric, 0), 2),
        v_txn->>'memo',
        v_txn->>'category_summary',
        COALESCE(v_txn->>'print_status', 'NotSet'),
        COALESCE(v_txn->>'cleared_status', 'Cleared'),
        false,
        COALESCE(v_txn->'line_items', '[]'::jsonb),
        COALESCE(v_txn->'raw_data', '{}'::jsonb),
        v_txn->>'created_by',
        NOW()
      )
      RETURNING * INTO v_saved;
    ELSE
      -- BATCH_UPDATE (reclassify_transactions, apply_bank_rules, batch_mark_checks_printed)
      IF v_txn ? 'cleared_status' AND NULLIF(btrim(v_txn->>'cleared_status'), '') IS NOT NULL THEN
        IF btrim(v_txn->>'cleared_status') NOT IN ('Uncleared', 'Cleared', 'Reconciled', 'Voided') THEN
          RAISE EXCEPTION 'Batch row #% has invalid cleared_status (%)', v_idx, v_txn->>'cleared_status';
        END IF;
      END IF;

      UPDATE public.external_accounting_transactions
      SET
        doc_number = COALESCE(NULLIF(v_txn->>'doc_number', ''), doc_number),
        print_status = COALESCE(NULLIF(v_txn->>'print_status', ''), print_status),
        cleared_status = COALESCE(NULLIF(v_txn->>'cleared_status', ''), cleared_status),
        to_account_qb_id = COALESCE(v_txn->>'to_account_qb_id', to_account_qb_id),
        to_account_name = COALESCE(v_txn->>'to_account_name', to_account_name),
        category_summary = COALESCE(v_txn->>'category_summary', category_summary),
        entity_qb_id = COALESCE(v_txn->>'entity_qb_id', entity_qb_id),
        entity_name = COALESCE(v_txn->>'entity_name', entity_name),
        department_qb_id = COALESCE(v_txn->>'department_qb_id', department_qb_id),
        department_name = COALESCE(v_txn->>'department_name', department_name),
        class_qb_id = COALESCE(v_txn->>'class_qb_id', class_qb_id),
        class_name = COALESCE(v_txn->>'class_name', class_name),
        line_items = COALESCE(v_txn->'line_items', line_items),
        raw_data = COALESCE(v_txn->'raw_data', raw_data),
        updated_at = NOW()
      WHERE id = (v_txn->>'id')::uuid
        AND company_realm_id = p_realm_id
        AND COALESCE(is_voided, false) = false
      RETURNING * INTO v_saved;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Batch update row #% transaction (%) not found in company % or is voided',
          v_idx, COALESCE(v_txn->>'id', 'NULL'), p_realm_id;
      END IF;
    END IF;

    v_saved_list := v_saved_list || jsonb_build_array(to_jsonb(v_saved));

    v_outbox_status := CASE
      WHEN NOT v_qbo_sync_enabled THEN 'SKIPPED_LOCAL_ONLY'
      ELSE 'PENDING'
    END;

    INSERT INTO public.external_accounting_sync_outbox (
      company_realm_id, entity_kind, entity_type, local_entity_id, qb_entity_id,
      operation, idempotency_key, payload, status, attempts, max_attempts, next_retry_at, created_by
    ) VALUES (
      p_realm_id,
      'TRANSACTION',
      v_saved.qb_entity_type,
      v_saved.id,
      v_saved.qb_txn_id,
      'UPSERT',
      COALESCE(v_outbox->>'idempotency_key', 'BATCH-' || p_mode || '-' || v_saved.id::text || '-' || extract(epoch from clock_timestamp())::text),
      to_jsonb(v_saved),
      v_outbox_status,
      0,
      5,
      NOW(),
      p_audit->>'user_name'
    )
    RETURNING id INTO v_outbox_id;

    v_outbox_ids := v_outbox_ids || jsonb_build_array(v_outbox_id);
  END LOOP;

  -- Apply atomic account balance deltas
  IF p_deltas IS NOT NULL AND jsonb_typeof(p_deltas) = 'array' AND jsonb_array_length(p_deltas) > 0 THEN
    v_balance_res := public.fn_ext_acct_apply_account_deltas(p_realm_id, p_deltas);
  ELSE
    v_balance_res := jsonb_build_object('ok', true, 'updated_count', 0);
  END IF;

  -- Apply open_balance updates to linked Invoices/Bills
  IF p_invoice_updates IS NOT NULL AND jsonb_typeof(p_invoice_updates) = 'array' THEN
    FOR v_inv IN SELECT * FROM jsonb_array_elements(p_invoice_updates)
    LOOP
      UPDATE public.external_accounting_transactions
      SET
        open_balance = ROUND(COALESCE((v_inv->>'open_balance')::numeric, open_balance), 2),
        raw_data = COALESCE(v_inv->'raw_data', raw_data),
        updated_at = NOW()
      WHERE id = (v_inv->>'id')::uuid
        AND company_realm_id = p_realm_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Linked invoice % does not exist in company %', v_inv->>'id', p_realm_id;
      END IF;
    END LOOP;
  END IF;

  -- Apply contact balance updates
  IF p_contact_updates IS NOT NULL AND jsonb_typeof(p_contact_updates) = 'array' THEN
    FOR v_con IN SELECT * FROM jsonb_array_elements(p_contact_updates)
    LOOP
      IF v_con->>'id' IS NOT NULL THEN
        UPDATE public.external_accounting_contacts
        SET
          balance = ROUND(COALESCE((v_con->>'balance')::numeric, balance), 2),
          updated_at = NOW()
        WHERE id = (v_con->>'id')::uuid
          AND company_realm_id = p_realm_id;
      ELSE
        UPDATE public.external_accounting_contacts
        SET
          balance = ROUND(COALESCE(balance, 0) + COALESCE((v_con->>'delta')::numeric, 0), 2),
          updated_at = NOW()
        WHERE company_realm_id = p_realm_id
          AND qb_contact_id = (v_con->>'qb_contact_id');
      END IF;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Contact update target (%) not found in company %', v_con::text, p_realm_id;
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.external_accounting_audit_log (
    company_realm_id, user_id, user_name, user_email, action_type,
    entity_type, entity_id, doc_number, amount, summary, details
  ) VALUES (
    p_realm_id,
    COALESCE(p_audit->>'user_id', ''),
    COALESCE(p_audit->>'user_name', 'Authorized User'),
    p_audit->>'user_email',
    p_audit->>'action_type',
    COALESCE(p_audit->>'entity_type', p_mode),
    p_audit->>'entity_id',
    p_audit->>'doc_number',
    CASE WHEN p_audit->>'amount' IS NOT NULL THEN ROUND((p_audit->>'amount')::numeric, 2) ELSE NULL END,
    p_audit->>'summary',
    COALESCE(p_audit->'details', '{}'::jsonb)
  )
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'ok', true,
    'mode', p_mode,
    'count', jsonb_array_length(v_saved_list),
    'transactions', v_saved_list,
    'outbox_ids', v_outbox_ids,
    'balance_updates', v_balance_res,
    'audit_id', v_audit_id
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. ATOMIC ENTITY MUTATION + OUTBOX + AUDIT RPC
--    Covers: ACCOUNT, CONTACT, LIST_ITEM, RECURRING, ATTACHMENT
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ext_acct_mutate_entity_atomic(
  p_entity_kind TEXT,
  p_operation TEXT,
  p_realm_id TEXT,
  p_list_key TEXT,
  p_entity JSONB,
  p_audit JSONB,
  p_outbox JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comp_meta JSONB;
  v_qbo_sync_enabled BOOLEAN := true;
  v_entity_json JSONB;
  v_local_uuid UUID;
  v_qb_id TEXT;
  v_entity_type TEXT;
  v_outbox_id UUID := NULL;
  v_outbox_status TEXT;
  v_audit_id UUID;
BEGIN
  IF p_realm_id IS NULL OR btrim(p_realm_id) = '' THEN
    RAISE EXCEPTION 'p_realm_id is required for atomic entity mutation';
  END IF;

  SELECT metadata INTO v_comp_meta
  FROM public.external_accounting_companies
  WHERE realm_id = p_realm_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company % does not exist', p_realm_id;
  END IF;

  IF v_comp_meta IS NOT NULL AND (v_comp_meta->>'qbo_sync_enabled') IS NOT NULL THEN
    v_qbo_sync_enabled := (v_comp_meta->>'qbo_sync_enabled')::boolean;
  END IF;

  IF p_audit IS NULL OR COALESCE(btrim(p_audit->>'action_type'), '') = '' OR COALESCE(btrim(p_audit->>'summary'), '') = '' THEN
    RAISE EXCEPTION 'Mandatory audit payload (action_type, summary) is required for entity mutation';
  END IF;

  -- 1. ACCOUNT
  IF p_entity_kind = 'ACCOUNT' THEN
    v_entity_type := 'Account';
    IF p_operation IN ('DELETE', 'DEACTIVATE') THEN
      SELECT to_jsonb(a), a.id, a.qb_account_id
      INTO v_entity_json, v_local_uuid, v_qb_id
      FROM public.external_accounting_accounts a
      WHERE a.company_realm_id = p_realm_id
        AND (
          (p_entity->>'id' IS NOT NULL AND a.id = (p_entity->>'id')::uuid)
          OR (p_entity->>'qb_account_id' IS NOT NULL AND a.qb_account_id = p_entity->>'qb_account_id')
        )
      LIMIT 1;

      IF v_local_uuid IS NULL THEN
        RAISE EXCEPTION 'Account not found in company %', p_realm_id;
      END IF;

      DELETE FROM public.external_accounting_accounts
      WHERE id = v_local_uuid AND company_realm_id = p_realm_id;
    ELSE
      IF p_entity->>'id' IS NOT NULL AND btrim(p_entity->>'id') <> '' THEN
        UPDATE public.external_accounting_accounts
        SET
          name = p_entity->>'name',
          fully_qualified_name = COALESCE(p_entity->>'fully_qualified_name', p_entity->>'name'),
          acct_num = p_entity->>'acct_num',
          classification = p_entity->>'classification',
          account_type = p_entity->>'account_type',
          account_sub_type = COALESCE(p_entity->>'account_sub_type', p_entity->>'account_type'),
          current_balance = ROUND(COALESCE((p_entity->>'current_balance')::numeric, current_balance), 2),
          is_sub_account = COALESCE((p_entity->>'is_sub_account')::boolean, false),
          parent_qb_id = p_entity->>'parent_qb_id',
          is_active = COALESCE((p_entity->>'is_active')::boolean, true),
          raw_data = COALESCE(p_entity->'raw_data', raw_data),
          updated_at = NOW()
        WHERE id = (p_entity->>'id')::uuid
          AND company_realm_id = p_realm_id
        RETURNING to_jsonb(external_accounting_accounts.*), id, qb_account_id
        INTO v_entity_json, v_local_uuid, v_qb_id;

        IF v_local_uuid IS NULL THEN
          RAISE EXCEPTION 'Account % not found in company %', p_entity->>'id', p_realm_id;
        END IF;
      ELSE
        INSERT INTO public.external_accounting_accounts (
          company_realm_id, qb_account_id, name, fully_qualified_name, acct_num,
          classification, account_type, account_sub_type, current_balance, initial_qbo_balance,
          is_sub_account, parent_qb_id, is_active, raw_data, updated_at
        ) VALUES (
          p_realm_id,
          COALESCE(p_entity->>'qb_account_id', 'LOCAL-ACC-' || (extract(epoch from clock_timestamp()) * 1000)::bigint::text),
          p_entity->>'name',
          COALESCE(p_entity->>'fully_qualified_name', p_entity->>'name'),
          p_entity->>'acct_num',
          p_entity->>'classification',
          p_entity->>'account_type',
          COALESCE(p_entity->>'account_sub_type', p_entity->>'account_type'),
          ROUND(COALESCE((p_entity->>'current_balance')::numeric, 0), 2),
          ROUND(COALESCE((p_entity->>'initial_qbo_balance')::numeric, COALESCE((p_entity->>'current_balance')::numeric, 0)), 2),
          COALESCE((p_entity->>'is_sub_account')::boolean, false),
          p_entity->>'parent_qb_id',
          COALESCE((p_entity->>'is_active')::boolean, true),
          COALESCE(p_entity->'raw_data', '{}'::jsonb),
          NOW()
        )
        RETURNING to_jsonb(external_accounting_accounts.*), id, qb_account_id
        INTO v_entity_json, v_local_uuid, v_qb_id;
      END IF;
    END IF;

  -- 2. CONTACT
  ELSIF p_entity_kind = 'CONTACT' THEN
    v_entity_type := COALESCE(p_entity->>'contact_type', 'Vendor');
    IF p_operation IN ('DELETE', 'DEACTIVATE') THEN
      SELECT to_jsonb(c), c.id, c.qb_contact_id, c.contact_type
      INTO v_entity_json, v_local_uuid, v_qb_id, v_entity_type
      FROM public.external_accounting_contacts c
      WHERE c.company_realm_id = p_realm_id
        AND (
          (p_entity->>'id' IS NOT NULL AND c.id = (p_entity->>'id')::uuid)
          OR (p_entity->>'qb_contact_id' IS NOT NULL AND c.qb_contact_id = p_entity->>'qb_contact_id')
        )
      LIMIT 1;

      IF v_local_uuid IS NULL THEN
        RAISE EXCEPTION 'Contact not found in company %', p_realm_id;
      END IF;

      DELETE FROM public.external_accounting_contacts
      WHERE id = v_local_uuid AND company_realm_id = p_realm_id;
    ELSE
      IF p_entity->>'id' IS NOT NULL AND btrim(p_entity->>'id') <> '' THEN
        UPDATE public.external_accounting_contacts
        SET
          contact_type = COALESCE(p_entity->>'contact_type', contact_type),
          display_name = COALESCE(p_entity->>'display_name', display_name),
          company_name = COALESCE(p_entity->>'company_name', p_entity->>'display_name', company_name),
          print_on_check_name = COALESCE(p_entity->>'print_on_check_name', print_on_check_name, p_entity->>'display_name', display_name),
          email = CASE WHEN p_entity ? 'email' THEN p_entity->>'email' ELSE email END,
          phone = CASE WHEN p_entity ? 'phone' THEN p_entity->>'phone' ELSE phone END,
          tax_identifier = CASE WHEN p_entity ? 'tax_identifier' THEN p_entity->>'tax_identifier' ELSE tax_identifier END,
          vendor_1099 = COALESCE((p_entity->>'vendor_1099')::boolean, vendor_1099, false),
          acct_num = COALESCE(p_entity->>'acct_num', acct_num),
          address = COALESCE(p_entity->'address', address),
          notes = CASE WHEN p_entity ? 'notes' THEN p_entity->>'notes' ELSE notes END,
          late_fee_policy = COALESCE(p_entity->'late_fee_policy', late_fee_policy),
          raw_data = COALESCE(p_entity->'raw_data', raw_data),
          balance = ROUND(COALESCE((p_entity->>'balance')::numeric, balance), 2),
          is_active = COALESCE((p_entity->>'is_active')::boolean, is_active),
          updated_at = NOW()
        WHERE id = (p_entity->>'id')::uuid
          AND company_realm_id = p_realm_id
        RETURNING to_jsonb(external_accounting_contacts.*), id, qb_contact_id, contact_type
        INTO v_entity_json, v_local_uuid, v_qb_id, v_entity_type;

        IF v_local_uuid IS NULL THEN
          RAISE EXCEPTION 'Contact % not found in company %', p_entity->>'id', p_realm_id;
        END IF;
      ELSE
        INSERT INTO public.external_accounting_contacts (
          company_realm_id, contact_type, qb_contact_id, display_name,
          company_name, print_on_check_name, email, phone, tax_identifier,
          vendor_1099, acct_num, address, balance, is_active, updated_at
        ) VALUES (
          p_realm_id,
          COALESCE(p_entity->>'contact_type', 'Vendor'),
          COALESCE(p_entity->>'qb_contact_id', 'LOCAL-CON-' || (extract(epoch from clock_timestamp()) * 1000)::bigint::text),
          p_entity->>'display_name',
          COALESCE(p_entity->>'company_name', p_entity->>'display_name'),
          COALESCE(p_entity->>'print_on_check_name', p_entity->>'display_name'),
          p_entity->>'email',
          p_entity->>'phone',
          p_entity->>'tax_identifier',
          COALESCE((p_entity->>'vendor_1099')::boolean, false),
          p_entity->>'acct_num',
          COALESCE(p_entity->'address', '{}'::jsonb),
          ROUND(COALESCE((p_entity->>'balance')::numeric, 0), 2),
          COALESCE((p_entity->>'is_active')::boolean, true),
          NOW()
        )
        RETURNING to_jsonb(external_accounting_contacts.*), id, qb_contact_id, contact_type
        INTO v_entity_json, v_local_uuid, v_qb_id, v_entity_type;
      END IF;
    END IF;

  -- 3. RECURRING TEMPLATE
  ELSIF p_entity_kind = 'RECURRING' THEN
    v_entity_type := 'RecurringTransaction';
    IF p_operation IN ('DELETE', 'DEACTIVATE') THEN
      SELECT to_jsonb(r), r.id, r.qb_recurring_id
      INTO v_entity_json, v_local_uuid, v_qb_id
      FROM public.external_accounting_recurring r
      WHERE r.company_realm_id = p_realm_id
        AND r.id = (p_entity->>'id')::uuid;

      IF v_local_uuid IS NULL THEN
        RAISE EXCEPTION 'Recurring template % not found in company %', p_entity->>'id', p_realm_id;
      END IF;

      DELETE FROM public.external_accounting_recurring
      WHERE id = v_local_uuid AND company_realm_id = p_realm_id;
    ELSE
      IF p_entity->>'id' IS NOT NULL AND btrim(p_entity->>'id') <> '' THEN
        UPDATE public.external_accounting_recurring
        SET
          template_name = p_entity->>'template_name',
          recur_type = COALESCE(p_entity->>'recur_type', 'Automated'),
          txn_type = COALESCE(p_entity->>'txn_type', 'Deposit'),
          interval_type = COALESCE(p_entity->>'interval_type', 'Monthly'),
          num_interval = COALESCE((p_entity->>'num_interval')::int, 1),
          next_date = NULLIF(p_entity->>'next_date', '')::date,
          account_qb_id = p_entity->>'account_qb_id',
          account_name = p_entity->>'account_name',
          entity_qb_id = p_entity->>'entity_qb_id',
          entity_name = p_entity->>'entity_name',
          department_name = p_entity->>'department_name',
          amount = ROUND(COALESCE((p_entity->>'amount')::numeric, 0), 2),
          memo = p_entity->>'memo',
          line_items = COALESCE(p_entity->'line_items', '[]'::jsonb),
          is_active = COALESCE((p_entity->>'is_active')::boolean, true),
          updated_at = NOW()
        WHERE id = (p_entity->>'id')::uuid
          AND company_realm_id = p_realm_id
        RETURNING to_jsonb(external_accounting_recurring.*), id, qb_recurring_id
        INTO v_entity_json, v_local_uuid, v_qb_id;

        IF v_local_uuid IS NULL THEN
          RAISE EXCEPTION 'Recurring template % not found in company %', p_entity->>'id', p_realm_id;
        END IF;
      ELSE
        INSERT INTO public.external_accounting_recurring (
          company_realm_id, qb_recurring_id, template_name, recur_type, txn_type,
          interval_type, num_interval, next_date, account_qb_id, account_name,
          entity_qb_id, entity_name, department_name, amount, memo, line_items, is_active, updated_at
        ) VALUES (
          p_realm_id,
          COALESCE(p_entity->>'qb_recurring_id', 'LOCAL-REC-' || (extract(epoch from clock_timestamp()) * 1000)::bigint::text),
          p_entity->>'template_name',
          COALESCE(p_entity->>'recur_type', 'Automated'),
          COALESCE(p_entity->>'txn_type', 'Deposit'),
          COALESCE(p_entity->>'interval_type', 'Monthly'),
          COALESCE((p_entity->>'num_interval')::int, 1),
          NULLIF(p_entity->>'next_date', '')::date,
          p_entity->>'account_qb_id',
          p_entity->>'account_name',
          p_entity->>'entity_qb_id',
          p_entity->>'entity_name',
          p_entity->>'department_name',
          ROUND(COALESCE((p_entity->>'amount')::numeric, 0), 2),
          p_entity->>'memo',
          COALESCE(p_entity->'line_items', '[]'::jsonb),
          true,
          NOW()
        )
        RETURNING to_jsonb(external_accounting_recurring.*), id, qb_recurring_id
        INTO v_entity_json, v_local_uuid, v_qb_id;
      END IF;
    END IF;

  -- 4. ATTACHMENT (Supabase Storage backed)
  ELSIF p_entity_kind = 'ATTACHMENT' THEN
    v_entity_type := 'Attachable';
    IF COALESCE((p_entity->>'force_db_failure')::boolean, false) THEN
      RAISE EXCEPTION 'FORCED_ATTACHMENT_DB_FAILURE: Simulated database failure inside fn_ext_acct_mutate_entity_atomic';
    END IF;

    IF p_operation IN ('DELETE', 'DEACTIVATE') THEN
      SELECT to_jsonb(att), att.id, att.qb_attachable_id
      INTO v_entity_json, v_local_uuid, v_qb_id
      FROM public.external_accounting_attachments att
      WHERE att.company_realm_id = p_realm_id
        AND (
          (p_entity->>'id' IS NOT NULL AND att.id = (p_entity->>'id')::uuid)
          OR (p_entity->>'qb_attachable_id' IS NOT NULL AND att.qb_attachable_id = p_entity->>'qb_attachable_id')
        )
      LIMIT 1;

      IF v_local_uuid IS NULL THEN
        RAISE EXCEPTION 'Attachment not found in company %', p_realm_id;
      END IF;

      DELETE FROM public.external_accounting_attachments
      WHERE id = v_local_uuid AND company_realm_id = p_realm_id;
    ELSE
      IF (p_entity->'raw_data') ? 'data_url' AND (p_entity->'raw_data'->>'data_url') IS NOT NULL THEN
        RAISE EXCEPTION 'Binary data_url is strictly forbidden inside attachment JSONB';
      END IF;

      IF NULLIF(btrim(COALESCE(p_entity->>'transaction_id', '')), '') IS NOT NULL THEN
        PERFORM 1
        FROM public.external_accounting_transactions
        WHERE id = NULLIF(btrim(p_entity->>'transaction_id'), '')::uuid
          AND company_realm_id = p_realm_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'ATTACHMENT_TRANSACTION_NOT_FOUND_IN_REALM: transaction_id % not found in company %',
            p_entity->>'transaction_id', p_realm_id;
        END IF;
      END IF;

      IF NULLIF(btrim(COALESCE(p_entity->>'contact_id', '')), '') IS NOT NULL THEN
        PERFORM 1
        FROM public.external_accounting_contacts
        WHERE id = NULLIF(btrim(p_entity->>'contact_id'), '')::uuid
          AND company_realm_id = p_realm_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'ATTACHMENT_CONTACT_NOT_FOUND_IN_REALM: contact_id % not found in company %',
            p_entity->>'contact_id', p_realm_id;
        END IF;
      END IF;

      INSERT INTO public.external_accounting_attachments (
        company_realm_id, qb_attachable_id, transaction_id, qb_txn_id,
        contact_id, qb_contact_id, linked_entity_type, linked_entity_id,
        file_name, content_type, file_size, size_bytes, file_url,
        storage_bucket, storage_path, sha256_hash, note, raw_data, updated_at
      ) VALUES (
        p_realm_id,
        COALESCE(p_entity->>'qb_attachable_id', 'LOCAL-ATT-' || (extract(epoch from clock_timestamp()) * 1000)::bigint::text),
        NULLIF(p_entity->>'transaction_id', '')::uuid,
        p_entity->>'qb_txn_id',
        NULLIF(p_entity->>'contact_id', '')::uuid,
        p_entity->>'qb_contact_id',
        p_entity->>'linked_entity_type',
        p_entity->>'linked_entity_id',
        p_entity->>'file_name',
        COALESCE(p_entity->>'content_type', 'application/octet-stream'),
        COALESCE((p_entity->>'file_size')::bigint, COALESCE((p_entity->>'size_bytes')::bigint, 0)),
        COALESCE((p_entity->>'size_bytes')::bigint, COALESCE((p_entity->>'file_size')::bigint, 0)),
        p_entity->>'file_url',
        COALESCE(p_entity->>'storage_bucket', 'external-accounting-attachments'),
        p_entity->>'storage_path',
        p_entity->>'sha256_hash',
        p_entity->>'note',
        COALESCE(p_entity->'raw_data', '{}'::jsonb) - 'data_url' - 'file_base64',
        NOW()
      )
      ON CONFLICT (company_realm_id, qb_attachable_id) DO UPDATE SET
        transaction_id = COALESCE(EXCLUDED.transaction_id, public.external_accounting_attachments.transaction_id),
        qb_txn_id = COALESCE(EXCLUDED.qb_txn_id, public.external_accounting_attachments.qb_txn_id),
        contact_id = COALESCE(EXCLUDED.contact_id, public.external_accounting_attachments.contact_id),
        qb_contact_id = COALESCE(EXCLUDED.qb_contact_id, public.external_accounting_attachments.qb_contact_id),
        file_name = EXCLUDED.file_name,
        content_type = EXCLUDED.content_type,
        file_size = EXCLUDED.file_size,
        size_bytes = EXCLUDED.size_bytes,
        file_url = COALESCE(EXCLUDED.file_url, public.external_accounting_attachments.file_url),
        storage_bucket = EXCLUDED.storage_bucket,
        storage_path = COALESCE(EXCLUDED.storage_path, public.external_accounting_attachments.storage_path),
        sha256_hash = COALESCE(EXCLUDED.sha256_hash, public.external_accounting_attachments.sha256_hash),
        note = COALESCE(EXCLUDED.note, public.external_accounting_attachments.note),
        raw_data = EXCLUDED.raw_data,
        updated_at = NOW()
      RETURNING to_jsonb(external_accounting_attachments.*), id, qb_attachable_id
      INTO v_entity_json, v_local_uuid, v_qb_id;
    END IF;

  -- 5. LIST_ITEM (items, categories, departments, classes, paymentMethods, terms, customFields, costGroups)
  ELSIF p_entity_kind = 'LIST_ITEM' THEN
    v_entity_type := COALESCE(p_list_key, 'Item');
    v_qb_id := COALESCE(p_entity->>'item_id', p_entity->>'Id', p_entity->>'qb_id');

    IF v_qb_id IS NULL OR btrim(v_qb_id) = '' THEN
      RAISE EXCEPTION 'item_id / Id is required for LIST_ITEM mutation';
    END IF;

    IF p_operation IN ('DELETE', 'DEACTIVATE') THEN
      IF p_list_key = 'items' THEN
        DELETE FROM public.external_accounting_items WHERE company_realm_id = p_realm_id AND qb_item_id = v_qb_id;
      ELSIF p_list_key = 'categories' THEN
        DELETE FROM public.external_accounting_categories WHERE company_realm_id = p_realm_id AND qb_category_id = v_qb_id;
      ELSIF p_list_key = 'departments' THEN
        DELETE FROM public.external_accounting_locations WHERE company_realm_id = p_realm_id AND qb_location_id = v_qb_id;
      ELSIF p_list_key = 'classes' THEN
        DELETE FROM public.external_accounting_classes WHERE company_realm_id = p_realm_id AND qb_class_id = v_qb_id;
      ELSIF p_list_key = 'paymentMethods' THEN
        DELETE FROM public.external_accounting_payment_methods WHERE company_realm_id = p_realm_id AND qb_payment_method_id = v_qb_id;
      ELSIF p_list_key = 'terms' THEN
        DELETE FROM public.external_accounting_terms WHERE company_realm_id = p_realm_id AND qb_term_id = v_qb_id;
      ELSIF p_list_key = 'customFields' THEN
        DELETE FROM public.external_accounting_custom_fields WHERE company_realm_id = p_realm_id AND field_key = v_qb_id;
      ELSIF p_list_key = 'costGroups' THEN
        DELETE FROM public.external_accounting_cost_groups WHERE company_realm_id = p_realm_id AND qb_cost_group_id = v_qb_id;
      ELSIF p_list_key = 'attachments' THEN
        DELETE FROM public.external_accounting_attachments WHERE company_realm_id = p_realm_id AND qb_attachable_id = v_qb_id;
      ELSE
        RAISE EXCEPTION 'Unsupported listKey for DELETE: %', p_list_key;
      END IF;
      v_entity_json := p_entity;
    ELSE
      IF p_list_key = 'items' THEN
        INSERT INTO public.external_accounting_items (
          company_realm_id, qb_item_id, name, fully_qualified_name, sku, item_type,
          category_qb_id, category_name, is_sub_item, description, unit_price,
          purchase_desc, purchase_cost, income_account_qb_id, income_account_name,
          expense_account_qb_id, expense_account_name, asset_account_qb_id, asset_account_name,
          track_qty_on_hand, qty_on_hand, taxable, is_active, raw_data, updated_at
        ) VALUES (
          p_realm_id, v_qb_id, p_entity->>'name',
          COALESCE(p_entity->>'fully_qualified_name', p_entity->>'name'),
          p_entity->>'sku', COALESCE(p_entity->>'item_type', 'Service'),
          p_entity->>'category_qb_id', p_entity->>'category_name',
          COALESCE((p_entity->>'is_sub_item')::boolean, false),
          p_entity->>'description', ROUND(COALESCE((p_entity->>'unit_price')::numeric, 0), 2),
          p_entity->>'purchase_desc', ROUND(COALESCE((p_entity->>'purchase_cost')::numeric, 0), 2),
          p_entity->>'income_account_qb_id', p_entity->>'income_account_name',
          p_entity->>'expense_account_qb_id', p_entity->>'expense_account_name',
          p_entity->>'asset_account_qb_id', p_entity->>'asset_account_name',
          COALESCE((p_entity->>'track_qty_on_hand')::boolean, false),
          COALESCE((p_entity->>'qty_on_hand')::numeric, 0),
          COALESCE((p_entity->>'taxable')::boolean, false),
          COALESCE((p_entity->>'is_active')::boolean, true),
          COALESCE(p_entity->'raw_data', '{}'::jsonb), NOW()
        )
        ON CONFLICT (company_realm_id, qb_item_id) DO UPDATE SET
          name = EXCLUDED.name,
          fully_qualified_name = EXCLUDED.fully_qualified_name,
          sku = EXCLUDED.sku,
          item_type = EXCLUDED.item_type,
          category_qb_id = EXCLUDED.category_qb_id,
          category_name = EXCLUDED.category_name,
          is_sub_item = EXCLUDED.is_sub_item,
          description = EXCLUDED.description,
          unit_price = EXCLUDED.unit_price,
          purchase_desc = EXCLUDED.purchase_desc,
          purchase_cost = EXCLUDED.purchase_cost,
          income_account_qb_id = EXCLUDED.income_account_qb_id,
          income_account_name = EXCLUDED.income_account_name,
          expense_account_qb_id = EXCLUDED.expense_account_qb_id,
          expense_account_name = EXCLUDED.expense_account_name,
          asset_account_qb_id = EXCLUDED.asset_account_qb_id,
          asset_account_name = EXCLUDED.asset_account_name,
          track_qty_on_hand = EXCLUDED.track_qty_on_hand,
          qty_on_hand = EXCLUDED.qty_on_hand,
          taxable = EXCLUDED.taxable,
          is_active = EXCLUDED.is_active,
          raw_data = EXCLUDED.raw_data,
          updated_at = NOW()
        RETURNING to_jsonb(external_accounting_items.*), id INTO v_entity_json, v_local_uuid;

      ELSIF p_list_key = 'categories' THEN
        INSERT INTO public.external_accounting_categories (
          company_realm_id, qb_category_id, name, fully_qualified_name,
          parent_qb_id, parent_name, is_sub_category, is_active, raw_data, updated_at
        ) VALUES (
          p_realm_id, v_qb_id, p_entity->>'name',
          COALESCE(p_entity->>'fully_qualified_name', p_entity->>'name'),
          p_entity->>'parent_qb_id', p_entity->>'parent_name',
          COALESCE((p_entity->>'is_sub_category')::boolean, false),
          COALESCE((p_entity->>'is_active')::boolean, true),
          COALESCE(p_entity->'raw_data', '{}'::jsonb), NOW()
        )
        ON CONFLICT (company_realm_id, qb_category_id) DO UPDATE SET
          name = EXCLUDED.name,
          fully_qualified_name = EXCLUDED.fully_qualified_name,
          parent_qb_id = EXCLUDED.parent_qb_id,
          parent_name = EXCLUDED.parent_name,
          is_sub_category = EXCLUDED.is_sub_category,
          is_active = EXCLUDED.is_active,
          raw_data = EXCLUDED.raw_data,
          updated_at = NOW()
        RETURNING to_jsonb(external_accounting_categories.*), id INTO v_entity_json, v_local_uuid;

      ELSIF p_list_key = 'departments' THEN
        INSERT INTO public.external_accounting_locations (
          company_realm_id, qb_location_id, name, fully_qualified_name,
          parent_qb_id, parent_name, is_sub_location, address, is_active, raw_data, updated_at
        ) VALUES (
          p_realm_id, v_qb_id, p_entity->>'name',
          COALESCE(p_entity->>'fully_qualified_name', p_entity->>'name'),
          p_entity->>'parent_qb_id', p_entity->>'parent_name',
          COALESCE((p_entity->>'is_sub_location')::boolean, false),
          p_entity->'address',
          COALESCE((p_entity->>'is_active')::boolean, true),
          COALESCE(p_entity->'raw_data', '{}'::jsonb), NOW()
        )
        ON CONFLICT (company_realm_id, qb_location_id) DO UPDATE SET
          name = EXCLUDED.name,
          fully_qualified_name = EXCLUDED.fully_qualified_name,
          parent_qb_id = EXCLUDED.parent_qb_id,
          parent_name = EXCLUDED.parent_name,
          is_sub_location = EXCLUDED.is_sub_location,
          address = EXCLUDED.address,
          is_active = EXCLUDED.is_active,
          raw_data = EXCLUDED.raw_data,
          updated_at = NOW()
        RETURNING to_jsonb(external_accounting_locations.*), id INTO v_entity_json, v_local_uuid;

      ELSIF p_list_key = 'classes' THEN
        INSERT INTO public.external_accounting_classes (
          company_realm_id, qb_class_id, name, fully_qualified_name, class_code,
          parent_qb_id, parent_name, is_sub_class, is_active, raw_data, updated_at
        ) VALUES (
          p_realm_id, v_qb_id, p_entity->>'name',
          COALESCE(p_entity->>'fully_qualified_name', p_entity->>'name'),
          p_entity->>'class_code',
          p_entity->>'parent_qb_id', p_entity->>'parent_name',
          COALESCE((p_entity->>'is_sub_class')::boolean, false),
          COALESCE((p_entity->>'is_active')::boolean, true),
          COALESCE(p_entity->'raw_data', '{}'::jsonb), NOW()
        )
        ON CONFLICT (company_realm_id, qb_class_id) DO UPDATE SET
          name = EXCLUDED.name,
          fully_qualified_name = EXCLUDED.fully_qualified_name,
          class_code = EXCLUDED.class_code,
          parent_qb_id = EXCLUDED.parent_qb_id,
          parent_name = EXCLUDED.parent_name,
          is_sub_class = EXCLUDED.is_sub_class,
          is_active = EXCLUDED.is_active,
          raw_data = EXCLUDED.raw_data,
          updated_at = NOW()
        RETURNING to_jsonb(external_accounting_classes.*), id INTO v_entity_json, v_local_uuid;

      ELSIF p_list_key = 'paymentMethods' THEN
        INSERT INTO public.external_accounting_payment_methods (
          company_realm_id, qb_payment_method_id, name, method_type, is_active, raw_data, updated_at
        ) VALUES (
          p_realm_id, v_qb_id, p_entity->>'name',
          COALESCE(p_entity->>'method_type', 'NON_CREDIT_CARD'),
          COALESCE((p_entity->>'is_active')::boolean, true),
          COALESCE(p_entity->'raw_data', '{}'::jsonb), NOW()
        )
        ON CONFLICT (company_realm_id, qb_payment_method_id) DO UPDATE SET
          name = EXCLUDED.name,
          method_type = EXCLUDED.method_type,
          is_active = EXCLUDED.is_active,
          raw_data = EXCLUDED.raw_data,
          updated_at = NOW()
        RETURNING to_jsonb(external_accounting_payment_methods.*), id INTO v_entity_json, v_local_uuid;

      ELSIF p_list_key = 'terms' THEN
        INSERT INTO public.external_accounting_terms (
          company_realm_id, qb_term_id, name, term_type, due_days,
          discount_percent, discount_days, is_active, raw_data, updated_at
        ) VALUES (
          p_realm_id, v_qb_id, p_entity->>'name',
          COALESCE(p_entity->>'term_type', 'STANDARD'),
          COALESCE((p_entity->>'due_days')::int, 30),
          COALESCE((p_entity->>'discount_percent')::numeric, 0),
          COALESCE((p_entity->>'discount_days')::int, 0),
          COALESCE((p_entity->>'is_active')::boolean, true),
          COALESCE(p_entity->'raw_data', '{}'::jsonb), NOW()
        )
        ON CONFLICT (company_realm_id, qb_term_id) DO UPDATE SET
          name = EXCLUDED.name,
          term_type = EXCLUDED.term_type,
          due_days = EXCLUDED.due_days,
          discount_percent = EXCLUDED.discount_percent,
          discount_days = EXCLUDED.discount_days,
          is_active = EXCLUDED.is_active,
          raw_data = EXCLUDED.raw_data,
          updated_at = NOW()
        RETURNING to_jsonb(external_accounting_terms.*), id INTO v_entity_json, v_local_uuid;

      ELSIF p_list_key = 'customFields' THEN
        INSERT INTO public.external_accounting_custom_fields (
          company_realm_id, field_key, name, data_type, applies_to,
          is_required, show_on_print, is_active, raw_data, updated_at
        ) VALUES (
          p_realm_id, v_qb_id, p_entity->>'name',
          COALESCE(p_entity->>'data_type', 'StringType'),
          COALESCE(p_entity->'applies_to', '["Invoice","SalesReceipt","Bill","PurchaseOrder","Check","Expense"]'::jsonb),
          COALESCE((p_entity->>'is_required')::boolean, false),
          COALESCE((p_entity->>'show_on_print')::boolean, true),
          COALESCE((p_entity->>'is_active')::boolean, true),
          COALESCE(p_entity->'raw_data', '{}'::jsonb), NOW()
        )
        ON CONFLICT (company_realm_id, field_key) DO UPDATE SET
          name = EXCLUDED.name,
          data_type = EXCLUDED.data_type,
          applies_to = EXCLUDED.applies_to,
          is_required = EXCLUDED.is_required,
          show_on_print = EXCLUDED.show_on_print,
          is_active = EXCLUDED.is_active,
          raw_data = EXCLUDED.raw_data,
          updated_at = NOW()
        RETURNING to_jsonb(external_accounting_custom_fields.*), id INTO v_entity_json, v_local_uuid;

      ELSIF p_list_key = 'costGroups' THEN
        INSERT INTO public.external_accounting_cost_groups (
          company_realm_id, qb_cost_group_id, name, description, cost_type,
          default_account_qb_id, default_account_name, is_active, raw_data, updated_at
        ) VALUES (
          p_realm_id, v_qb_id, p_entity->>'name',
          p_entity->>'description',
          COALESCE(p_entity->>'cost_type', 'Direct Cost'),
          p_entity->>'default_account_qb_id',
          p_entity->>'default_account_name',
          COALESCE((p_entity->>'is_active')::boolean, true),
          COALESCE(p_entity->'raw_data', '{}'::jsonb), NOW()
        )
        ON CONFLICT (company_realm_id, qb_cost_group_id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          cost_type = EXCLUDED.cost_type,
          default_account_qb_id = EXCLUDED.default_account_qb_id,
          default_account_name = EXCLUDED.default_account_name,
          is_active = EXCLUDED.is_active,
          raw_data = EXCLUDED.raw_data,
          updated_at = NOW()
        RETURNING to_jsonb(external_accounting_cost_groups.*), id INTO v_entity_json, v_local_uuid;

      ELSE
        RAISE EXCEPTION 'Unsupported listKey for UPSERT: %', p_list_key;
      END IF;
    END IF;

    -- If next_company_metadata is provided in p_entity, update external_accounting_companies.metadata atomically
    IF p_entity->'next_company_metadata' IS NOT NULL THEN
      UPDATE public.external_accounting_companies
      SET metadata = p_entity->'next_company_metadata',
          updated_at = NOW()
      WHERE realm_id = p_realm_id;
    END IF;

  -- 6. BANK RULE
  ELSIF p_entity_kind = 'BANK_RULE' THEN
    v_entity_type := 'BankRule';
    IF p_operation IN ('DELETE', 'DEACTIVATE') THEN
      SELECT to_jsonb(r), r.id, r.id::text
      INTO v_entity_json, v_local_uuid, v_qb_id
      FROM public.external_accounting_bank_rules r
      WHERE r.company_realm_id = p_realm_id
        AND r.id = (p_entity->>'id')::uuid;

      IF v_local_uuid IS NULL THEN
        RAISE EXCEPTION 'Bank rule % not found in company %', p_entity->>'id', p_realm_id;
      END IF;

      DELETE FROM public.external_accounting_bank_rules
      WHERE id = v_local_uuid AND company_realm_id = p_realm_id;
    ELSE
      IF p_entity->>'id' IS NOT NULL AND btrim(p_entity->>'id') <> '' THEN
        UPDATE public.external_accounting_bank_rules
        SET
          rule_name = p_entity->>'rule_name',
          direction = COALESCE(p_entity->>'direction', 'OUT'),
          match_field = COALESCE(p_entity->>'match_field', 'ANY'),
          match_text = p_entity->>'match_text',
          target_account_id = NULLIF(p_entity->>'target_account_id', '')::uuid,
          target_account_qb_id = p_entity->>'target_account_qb_id',
          target_account_name = p_entity->>'target_account_name',
          target_entity_name = p_entity->>'target_entity_name',
          target_txn_type = COALESCE(p_entity->>'target_txn_type', 'Expense'),
          auto_apply = COALESCE((p_entity->>'auto_apply')::boolean, true),
          priority = COALESCE((p_entity->>'priority')::int, 100),
          is_active = COALESCE((p_entity->>'is_active')::boolean, true),
          updated_at = NOW()
        WHERE id = (p_entity->>'id')::uuid
          AND company_realm_id = p_realm_id
        RETURNING to_jsonb(external_accounting_bank_rules.*), id, id::text
        INTO v_entity_json, v_local_uuid, v_qb_id;

        IF v_local_uuid IS NULL THEN
          RAISE EXCEPTION 'Bank rule % not found in company %', p_entity->>'id', p_realm_id;
        END IF;
      ELSE
        INSERT INTO public.external_accounting_bank_rules (
          company_realm_id, rule_name, direction, match_field, match_text,
          target_account_id, target_account_qb_id, target_account_name,
          target_entity_name, target_txn_type, auto_apply, priority, is_active, updated_at
        ) VALUES (
          p_realm_id,
          p_entity->>'rule_name',
          COALESCE(p_entity->>'direction', 'OUT'),
          COALESCE(p_entity->>'match_field', 'ANY'),
          p_entity->>'match_text',
          NULLIF(p_entity->>'target_account_id', '')::uuid,
          p_entity->>'target_account_qb_id',
          p_entity->>'target_account_name',
          p_entity->>'target_entity_name',
          COALESCE(p_entity->>'target_txn_type', 'Expense'),
          COALESCE((p_entity->>'auto_apply')::boolean, true),
          COALESCE((p_entity->>'priority')::int, 100),
          COALESCE((p_entity->>'is_active')::boolean, true),
          NOW()
        )
        RETURNING to_jsonb(external_accounting_bank_rules.*), id, id::text
        INTO v_entity_json, v_local_uuid, v_qb_id;
      END IF;
    END IF;

  -- 7. BUDGET
  ELSIF p_entity_kind = 'BUDGET' THEN
    v_entity_type := 'Budget';
    IF p_operation IN ('DELETE', 'DEACTIVATE') THEN
      SELECT to_jsonb(b), b.id, b.account_qb_id
      INTO v_entity_json, v_local_uuid, v_qb_id
      FROM public.external_accounting_budgets b
      WHERE b.company_realm_id = p_realm_id
        AND b.id = (p_entity->>'id')::uuid;

      IF v_local_uuid IS NULL THEN
        RAISE EXCEPTION 'Budget % not found in company %', p_entity->>'id', p_realm_id;
      END IF;

      DELETE FROM public.external_accounting_budgets
      WHERE id = v_local_uuid AND company_realm_id = p_realm_id;
    ELSE
      INSERT INTO public.external_accounting_budgets (
        company_realm_id, fiscal_year, account_id, account_qb_id, account_name,
        account_type, monthly_amounts, annual_total, notes, updated_by, updated_at
      ) VALUES (
        p_realm_id,
        COALESCE((p_entity->>'fiscal_year')::int, 2026),
        NULLIF(p_entity->>'account_id', '')::uuid,
        p_entity->>'account_qb_id',
        p_entity->>'account_name',
        p_entity->>'account_type',
        COALESCE(p_entity->'monthly_amounts', '{}'::jsonb),
        ROUND(COALESCE((p_entity->>'annual_total')::numeric, 0), 2),
        p_entity->>'notes',
        p_entity->>'updated_by',
        NOW()
      )
      ON CONFLICT (company_realm_id, fiscal_year, account_qb_id) DO UPDATE SET
        account_id = EXCLUDED.account_id,
        account_name = EXCLUDED.account_name,
        account_type = EXCLUDED.account_type,
        monthly_amounts = EXCLUDED.monthly_amounts,
        annual_total = EXCLUDED.annual_total,
        notes = EXCLUDED.notes,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
      RETURNING to_jsonb(external_accounting_budgets.*), id, account_qb_id
      INTO v_entity_json, v_local_uuid, v_qb_id;
    END IF;

  -- 8. COMPANY SETTINGS
  ELSIF p_entity_kind = 'COMPANY_SETTINGS' THEN
    v_entity_type := 'CompanySettings';
    UPDATE public.external_accounting_companies
    SET
      company_name = COALESCE(NULLIF(btrim(p_entity->>'company_name'), ''), company_name),
      legal_name = COALESCE(NULLIF(btrim(p_entity->>'legal_name'), ''), NULLIF(btrim(p_entity->>'company_name'), ''), legal_name),
      email = CASE WHEN p_entity ? 'email' THEN p_entity->>'email' ELSE email END,
      phone = CASE WHEN p_entity ? 'phone' THEN p_entity->>'phone' ELSE phone END,
      address = COALESCE(p_entity->'address', address),
      metadata = COALESCE(p_entity->'metadata', metadata),
      updated_at = NOW()
    WHERE realm_id = p_realm_id
    RETURNING to_jsonb(external_accounting_companies.*), id, realm_id
    INTO v_entity_json, v_local_uuid, v_qb_id;

    IF v_local_uuid IS NULL THEN
      RAISE EXCEPTION 'Company % not found for settings update', p_realm_id;
    END IF;

  -- 9. NOTE OR TASK
  ELSIF p_entity_kind = 'NOTE_TASK' THEN
    v_entity_type := COALESCE(p_entity->>'record_type', 'Task');
    IF p_operation IN ('DELETE', 'DEACTIVATE') THEN
      SELECT to_jsonb(nt), nt.id, COALESCE(nt.qb_contact_id, nt.id::text)
      INTO v_entity_json, v_local_uuid, v_qb_id
      FROM public.external_accounting_notes_tasks nt
      WHERE nt.company_realm_id = p_realm_id
        AND nt.id = (p_entity->>'id')::uuid;

      IF v_local_uuid IS NULL THEN
        RAISE EXCEPTION 'Note/Task % not found in company %', p_entity->>'id', p_realm_id;
      END IF;

      DELETE FROM public.external_accounting_notes_tasks
      WHERE id = v_local_uuid AND company_realm_id = p_realm_id;
    ELSIF p_operation = 'TOGGLE' THEN
      UPDATE public.external_accounting_notes_tasks
      SET
        status = CASE WHEN status = 'Completed' THEN 'Open' ELSE 'Completed' END,
        updated_at = NOW()
      WHERE id = (p_entity->>'id')::uuid
        AND company_realm_id = p_realm_id
      RETURNING to_jsonb(external_accounting_notes_tasks.*), id, COALESCE(qb_contact_id, id::text), record_type
      INTO v_entity_json, v_local_uuid, v_qb_id, v_entity_type;

      IF v_local_uuid IS NULL THEN
        RAISE EXCEPTION 'Task % not found in company %', p_entity->>'id', p_realm_id;
      END IF;
    ELSE
      -- Optional atomic update of external_accounting_contacts.notes + raw_data when saving a contact note
      IF p_entity ? 'sync_contact_id' AND NULLIF(btrim(p_entity->>'sync_contact_id'), '') IS NOT NULL THEN
        UPDATE public.external_accounting_contacts
        SET
          notes = p_entity->>'contact_notes_value',
          raw_data = COALESCE(p_entity->'contact_raw_data', raw_data),
          updated_at = NOW()
        WHERE id = (p_entity->>'sync_contact_id')::uuid
          AND company_realm_id = p_realm_id
        RETURNING to_jsonb(external_accounting_contacts.*), id, qb_contact_id
        INTO v_entity_json, v_local_uuid, v_qb_id;

        IF v_local_uuid IS NULL THEN
          RAISE EXCEPTION 'Contact % not found in company % for note update', p_entity->>'sync_contact_id', p_realm_id;
        END IF;
      END IF;

      IF COALESCE((p_entity->>'skip_note_task_row')::boolean, false) = false THEN
        INSERT INTO public.external_accounting_notes_tasks (
          company_realm_id, contact_id, qb_contact_id, contact_name,
          record_type, title, content, due_date, status, is_pinned, created_by, updated_at
        ) VALUES (
          p_realm_id,
          NULLIF(p_entity->>'contact_id', '')::uuid,
          p_entity->>'qb_contact_id',
          p_entity->>'contact_name',
          COALESCE(p_entity->>'record_type', 'Task'),
          COALESCE(NULLIF(btrim(p_entity->>'title'), ''), 'Note'),
          p_entity->>'content',
          NULLIF(p_entity->>'due_date', '')::date,
          COALESCE(p_entity->>'status', 'Open'),
          COALESCE((p_entity->>'is_pinned')::boolean, false),
          p_entity->>'created_by',
          NOW()
        )
        RETURNING to_jsonb(external_accounting_notes_tasks.*), id, COALESCE(qb_contact_id, id::text)
        INTO v_entity_json, v_local_uuid, v_qb_id;
      END IF;
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported entity_kind: %', p_entity_kind;
  END IF;

  -- Enqueue durable Outbox record inside the SAME PostgreSQL transaction
  IF p_outbox IS NOT NULL THEN
    v_outbox_status := CASE
      WHEN NOT v_qbo_sync_enabled THEN 'SKIPPED_LOCAL_ONLY'
      ELSE 'PENDING'
    END;

    INSERT INTO public.external_accounting_sync_outbox (
      company_realm_id, entity_kind, entity_type, local_entity_id, qb_entity_id,
      operation, idempotency_key, payload, status, attempts, max_attempts, next_retry_at, created_by
    ) VALUES (
      p_realm_id,
      p_entity_kind,
      COALESCE(p_outbox->>'entity_type', v_entity_type),
      v_local_uuid,
      COALESCE(p_outbox->>'qb_entity_id', v_qb_id),
      COALESCE(p_outbox->>'operation', p_operation),
      COALESCE(p_outbox->>'idempotency_key', p_entity_kind || '-' || p_operation || '-' || COALESCE(v_qb_id, v_local_uuid::text, '') || '-' || extract(epoch from clock_timestamp())::text),
      COALESCE(p_outbox->'payload', v_entity_json, p_entity),
      v_outbox_status,
      0,
      COALESCE((p_outbox->>'max_attempts')::int, 5),
      NOW(),
      p_audit->>'user_name'
    )
    RETURNING id INTO v_outbox_id;
  END IF;

  -- Mandatory Audit Log inside the SAME PostgreSQL transaction
  INSERT INTO public.external_accounting_audit_log (
    company_realm_id, user_id, user_name, user_email, action_type,
    entity_type, entity_id, doc_number, amount, summary, details
  ) VALUES (
    p_realm_id,
    COALESCE(p_audit->>'user_id', ''),
    COALESCE(p_audit->>'user_name', 'Authorized User'),
    p_audit->>'user_email',
    p_audit->>'action_type',
    COALESCE(p_audit->>'entity_type', v_entity_type),
    COALESCE(p_audit->>'entity_id', v_local_uuid::text, v_qb_id),
    p_audit->>'doc_number',
    CASE WHEN p_audit->>'amount' IS NOT NULL THEN ROUND((p_audit->>'amount')::numeric, 2) ELSE NULL END,
    p_audit->>'summary',
    COALESCE(p_audit->'details', '{}'::jsonb)
  )
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'ok', true,
    'entity_kind', p_entity_kind,
    'operation', p_operation,
    'entity', v_entity_json,
    'local_id', v_local_uuid,
    'qb_id', v_qb_id,
    'outbox_id', v_outbox_id,
    'outbox_status', v_outbox_status,
    'qbo_sync_enabled', v_qbo_sync_enabled,
    'audit_id', v_audit_id
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. HARDENED ATOMIC TRANSACTION MUTATION RPC (Fixes P1 Orphan Contact & Cleared Status Validation)
-- -----------------------------------------------------------------------------
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
SET search_path = public
AS $fn$
DECLARE
  v_comp_meta JSONB;
  v_qbo_sync_enabled BOOLEAN := true;
  v_tx_id UUID;
  v_saved_row public.external_accounting_transactions%ROWTYPE;
  v_delta_res JSONB;
  v_inv_item JSONB;
  v_con_item JSONB;
  v_audit_id UUID;
  v_outbox_id UUID;
  v_auto_con JSONB;
  v_auto_con_row public.external_accounting_contacts%ROWTYPE;
  v_auto_con_id UUID := NULL;
  v_auto_con_qb_id TEXT := NULL;
  v_auto_con_outbox_id UUID := NULL;
  v_effective_entity_qb_id TEXT;
  v_outbox_status TEXT;
BEGIN
  IF p_realm_id IS NULL OR TRIM(p_realm_id) = '' THEN
    RAISE EXCEPTION 'INVALID_REALM_ID: company_realm_id is required';
  END IF;

  SELECT metadata INTO v_comp_meta
  FROM public.external_accounting_companies
  WHERE realm_id = p_realm_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPANY_NOT_FOUND: Company % does not exist', p_realm_id;
  END IF;

  IF v_comp_meta IS NOT NULL AND (v_comp_meta->>'qbo_sync_enabled') IS NOT NULL THEN
    v_qbo_sync_enabled := (v_comp_meta->>'qbo_sync_enabled')::boolean;
  END IF;

  IF p_audit IS NULL OR COALESCE(TRIM(p_audit->>'action_type'), '') = '' OR COALESCE(TRIM(p_audit->>'summary'), '') = '' THEN
    RAISE EXCEPTION 'AUDIT_REQUIRED: Every accounting mutation requires a valid non-empty p_audit payload';
  END IF;

  IF p_operation = 'UPSERT' THEN
    IF p_txn ? 'cleared_status' AND NULLIF(btrim(p_txn->>'cleared_status'), '') IS NOT NULL THEN
      IF btrim(p_txn->>'cleared_status') NOT IN ('Uncleared', 'Cleared', 'Reconciled', 'Voided') THEN
        RAISE EXCEPTION 'INVALID_CLEARED_STATUS: % is not a valid cleared_status', p_txn->>'cleared_status';
      END IF;
    END IF;

    -- Atomic auto-creation of new contact inside the SAME PostgreSQL transaction (prevents orphan contacts)
    IF p_txn ? 'auto_create_contact'
       AND p_txn->'auto_create_contact' IS NOT NULL
       AND jsonb_typeof(p_txn->'auto_create_contact') = 'object'
       AND COALESCE(btrim(p_txn->'auto_create_contact'->>'display_name'), '') <> '' THEN
      v_auto_con := p_txn->'auto_create_contact';

      SELECT id, qb_contact_id
      INTO v_auto_con_id, v_auto_con_qb_id
      FROM public.external_accounting_contacts
      WHERE company_realm_id = p_realm_id
        AND LOWER(btrim(display_name)) = LOWER(btrim(v_auto_con->>'display_name'))
      LIMIT 1;

      IF v_auto_con_id IS NULL THEN
        v_auto_con_qb_id := COALESCE(
          NULLIF(btrim(v_auto_con->>'qb_contact_id'), ''),
          'LOCAL-C-' || (extract(epoch from clock_timestamp()) * 1000)::bigint::text
        );

        INSERT INTO public.external_accounting_contacts (
          company_realm_id, contact_type, qb_contact_id, display_name,
          company_name, print_on_check_name, is_active, updated_at
        ) VALUES (
          p_realm_id,
          COALESCE(NULLIF(btrim(v_auto_con->>'contact_type'), ''), 'Vendor'),
          v_auto_con_qb_id,
          btrim(v_auto_con->>'display_name'),
          COALESCE(NULLIF(btrim(v_auto_con->>'company_name'), ''), btrim(v_auto_con->>'display_name')),
          COALESCE(NULLIF(btrim(v_auto_con->>'print_on_check_name'), ''), btrim(v_auto_con->>'display_name')),
          true,
          NOW()
        )
        RETURNING * INTO v_auto_con_row;

        v_auto_con_id := v_auto_con_row.id;

        INSERT INTO public.external_accounting_sync_outbox (
          company_realm_id, entity_kind, entity_type, local_entity_id, qb_entity_id,
          operation, idempotency_key, payload, status, attempts, max_attempts, next_retry_at, created_by, updated_at
        ) VALUES (
          p_realm_id,
          'CONTACT',
          v_auto_con_row.contact_type,
          v_auto_con_row.id,
          v_auto_con_row.qb_contact_id,
          'UPSERT',
          'AUTO-CON-UPSERT-' || p_realm_id || '-' || v_auto_con_row.qb_contact_id || '-' || (extract(epoch from clock_timestamp()) * 1000)::bigint::text,
          to_jsonb(v_auto_con_row),
          CASE
            WHEN NOT v_qbo_sync_enabled THEN 'SKIPPED_LOCAL_ONLY'
            ELSE 'PENDING'
          END,
          0,
          5,
          NOW(),
          COALESCE(p_audit->>'user_name', 'Authorized User'),
          NOW()
        )
        RETURNING id INTO v_auto_con_outbox_id;

        INSERT INTO public.external_accounting_audit_log (
          company_realm_id, user_id, user_name, user_email,
          action_type, entity_type, entity_id, summary, details
        ) VALUES (
          p_realm_id,
          COALESCE(p_audit->>'user_id', ''),
          COALESCE(p_audit->>'user_name', 'Authorized User'),
          NULLIF(p_audit->>'user_email', ''),
          'AUTO_CREATE_CONTACT',
          v_auto_con_row.contact_type,
          v_auto_con_row.id::text,
          'Creó automáticamente contacto "' || v_auto_con_row.display_name || '" dentro de transacción atómica',
          jsonb_build_object('qb_contact_id', v_auto_con_row.qb_contact_id, 'display_name', v_auto_con_row.display_name)
        );
      END IF;
    END IF;

    v_effective_entity_qb_id := COALESCE(v_auto_con_qb_id, NULLIF(p_txn->>'entity_qb_id', ''));

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
        entity_qb_id = CASE WHEN v_effective_entity_qb_id IS NOT NULL OR (p_txn ? 'entity_qb_id') THEN v_effective_entity_qb_id ELSE entity_qb_id END,
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
        v_effective_entity_qb_id,
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

  IF COALESCE((p_txn->>'force_db_failure')::boolean, false) THEN
    RAISE EXCEPTION 'FORCED_TXN_DB_FAILURE: Simulated failure inside fn_ext_acct_mutate_transaction_atomic after contact creation';
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

      IF NOT FOUND THEN
        RAISE EXCEPTION 'INVOICE_UPDATE_NOT_FOUND_IN_REALM: Linked invoice/bill % not found in company %',
          v_inv_item->>'id', p_realm_id;
      END IF;
    END LOOP;
  END IF;

  IF p_contact_deltas IS NOT NULL AND jsonb_typeof(p_contact_deltas) = 'array' THEN
    FOR v_con_item IN SELECT * FROM jsonb_array_elements(p_contact_deltas)
    LOOP
      IF v_con_item ? 'balance' AND v_con_item->>'balance' IS NOT NULL THEN
        UPDATE public.external_accounting_contacts
        SET
          balance = GREATEST(0, ROUND((v_con_item->>'balance')::numeric, 2)),
          updated_at = NOW()
        WHERE company_realm_id = p_realm_id
          AND (
            (NULLIF(btrim(COALESCE(v_con_item->>'id', '')), '') IS NOT NULL AND id = (v_con_item->>'id')::uuid)
            OR (NULLIF(btrim(COALESCE(v_con_item->>'qb_contact_id', '')), '') IS NOT NULL AND qb_contact_id = btrim(v_con_item->>'qb_contact_id'))
            OR (v_auto_con_id IS NOT NULL AND id = v_auto_con_id)
            OR (NULLIF(btrim(COALESCE(v_con_item->>'display_name', '')), '') IS NOT NULL AND LOWER(btrim(display_name)) = LOWER(btrim(v_con_item->>'display_name')))
          );
      ELSE
        UPDATE public.external_accounting_contacts
        SET
          balance = GREATEST(0, ROUND(COALESCE(balance, 0) + COALESCE((v_con_item->>'delta')::numeric, 0), 2)),
          updated_at = NOW()
        WHERE company_realm_id = p_realm_id
          AND (
            (NULLIF(btrim(COALESCE(v_con_item->>'id', '')), '') IS NOT NULL AND id = (v_con_item->>'id')::uuid)
            OR (NULLIF(btrim(COALESCE(v_con_item->>'qb_contact_id', '')), '') IS NOT NULL AND qb_contact_id = btrim(v_con_item->>'qb_contact_id'))
            OR (v_auto_con_id IS NOT NULL AND id = v_auto_con_id)
          );
      END IF;

      IF NOT FOUND AND COALESCE((v_con_item->>'require_found')::boolean, false) THEN
        RAISE EXCEPTION 'CONTACT_BALANCE_UPDATE_NOT_FOUND_IN_REALM: Contact target (%) not found in company %',
          v_con_item::text, p_realm_id;
      END IF;
    END LOOP;
  END IF;

  IF p_txn ? 'advance_recurring_template'
     AND p_txn->'advance_recurring_template' IS NOT NULL
     AND jsonb_typeof(p_txn->'advance_recurring_template') = 'object'
     AND NULLIF(btrim(COALESCE(p_txn->'advance_recurring_template'->>'id', '')), '') IS NOT NULL THEN
    UPDATE public.external_accounting_recurring
    SET
      previous_date = NULLIF(btrim(p_txn->'advance_recurring_template'->>'previous_date'), '')::date,
      next_date = NULLIF(btrim(p_txn->'advance_recurring_template'->>'next_date'), '')::date,
      updated_at = NOW()
    WHERE id = (p_txn->'advance_recurring_template'->>'id')::uuid
      AND company_realm_id = p_realm_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'RECURRING_TEMPLATE_NOT_FOUND_IN_REALM: Recurring template % not found in company %',
        p_txn->'advance_recurring_template'->>'id', p_realm_id;
    END IF;
  END IF;

  IF p_outbox IS NOT NULL AND jsonb_typeof(p_outbox) = 'object' AND COALESCE(p_outbox->>'idempotency_key', '') <> '' THEN
    v_outbox_status := CASE
      WHEN NOT v_qbo_sync_enabled THEN 'SKIPPED_LOCAL_ONLY'
      ELSE 'PENDING'
    END;

    INSERT INTO public.external_accounting_sync_outbox (
      company_realm_id, entity_kind, entity_type, local_entity_id, qb_entity_id,
      operation, idempotency_key, payload, status, attempts, max_attempts, next_retry_at, created_by, updated_at
    ) VALUES (
      p_realm_id,
      COALESCE(p_outbox->>'entity_kind', 'TRANSACTION'),
      COALESCE(p_outbox->>'entity_type', v_saved_row.qb_entity_type, v_saved_row.txn_type),
      v_saved_row.id,
      COALESCE(p_outbox->>'qb_entity_id', v_saved_row.qb_txn_id),
      COALESCE(p_outbox->>'operation', p_operation),
      p_outbox->>'idempotency_key',
      COALESCE(p_outbox->'payload', to_jsonb(v_saved_row)),
      v_outbox_status,
      0,
      COALESCE((p_outbox->>'max_attempts')::int, 5),
      NOW(),
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
    'outbox_id', v_outbox_id,
    'auto_created_contact_id', v_auto_con_id,
    'auto_created_contact_qb_id', v_auto_con_qb_id,
    'auto_created_contact_outbox_id', v_auto_con_outbox_id
  );
END;
$fn$;

NOTIFY pgrst, 'reload schema';
