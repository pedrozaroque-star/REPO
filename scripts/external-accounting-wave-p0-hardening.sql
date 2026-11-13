-- ============================================================================
-- WAVE P0 SECURITY, RLS, RPC, OAUTH LOCK, OUTBOX & SCHEMA ALIGNMENT MIGRATION
-- ============================================================================

-- 1. Fix `is_authorized_external_accounting_user()` (eliminates SECURITY DEFINER current_user='postgres' bypass)
CREATE OR REPLACE FUNCTION public.is_authorized_external_accounting_user()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_jwt_raw TEXT;
  v_role TEXT;
  v_email TEXT;
BEGIN
  v_jwt_raw := NULLIF(current_setting('request.jwt.claims', true), '');
  v_role := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    CASE WHEN v_jwt_raw IS NOT NULL THEN (v_jwt_raw::jsonb ->> 'role') ELSE NULL END,
    ''
  );

  -- Allow backend service_role
  IF v_role = 'service_role' THEN
    RETURN TRUE;
  END IF;

  -- Allow direct SQL Editor / migrations where no PostgREST JWT context exists
  IF v_jwt_raw IS NULL AND v_role = '' AND session_user IN ('postgres', 'supabase_admin') THEN
    RETURN TRUE;
  END IF;

  -- Strict check for authenticated JWTs: must match active whitelisted user in public.users (45, 46, 47)
  IF v_role = 'authenticated' THEN
    v_email := lower(btrim(COALESCE(
      NULLIF(current_setting('request.jwt.claim.email', true), ''),
      CASE WHEN v_jwt_raw IS NOT NULL THEN (v_jwt_raw::jsonb ->> 'email') ELSE NULL END,
      ''
    )));

    IF v_email IN ('raquel@tacosgavilan.com', 'roberto@tacosgavilan.com', 'roque@tacosgavilan.com') THEN
      IF EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.id IN (45, 46, 47)
          AND lower(btrim(u.email)) = v_email
          AND COALESCE(u.is_active, true) = true
      ) THEN
        RETURN TRUE;
      END IF;
    END IF;
  END IF;

  RETURN FALSE;
END;
$fn$;

REVOKE ALL ON FUNCTION public.is_authorized_external_accounting_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_authorized_external_accounting_user() TO authenticated, service_role, postgres, supabase_admin;

-- 2. Harden table grants across all 24 external_accounting_* tables
DO $$
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
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
  END LOOP;
END;
$$;

-- 3. Scope public Storage upload policy so anonymous users cannot upload to external-accounting-attachments
ALTER POLICY "Allow public upload 1bkkjy_0"
  ON storage.objects
  WITH CHECK (bucket_id <> 'external-accounting-attachments'::text);

-- 4. Fix schema constraints & columns for NON_POSTING (Estimate/PO), customFields, and costGroups
ALTER TABLE public.external_accounting_transactions
  DROP CONSTRAINT IF EXISTS external_accounting_transactions_direction_check;

ALTER TABLE public.external_accounting_transactions
  ADD CONSTRAINT external_accounting_transactions_direction_check
  CHECK (direction = ANY (ARRAY['IN'::text, 'OUT'::text, 'TRANSFER'::text, 'JOURNAL'::text, 'ACCRUAL'::text, 'NON_POSTING'::text]));

ALTER TABLE public.external_accounting_custom_fields
  ADD COLUMN IF NOT EXISTS applies_to JSONB DEFAULT '["Invoice","SalesReceipt","Bill","PurchaseOrder","Check","Expense"]'::jsonb,
  ADD COLUMN IF NOT EXISTS is_required BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS show_on_print BOOLEAN DEFAULT true;

ALTER TABLE public.external_accounting_cost_groups
  ADD COLUMN IF NOT EXISTS cost_type TEXT DEFAULT 'Direct Cost';

-- 5. Update `fn_ext_acct_mutate_entity_atomic` (aligned with live columns, case-insensitive list keys & local-only outbox)
CREATE OR REPLACE FUNCTION public.fn_ext_acct_mutate_entity_atomic(
  p_entity_kind text,
  p_operation text,
  p_realm_id text,
  p_list_key text,
  p_entity jsonb,
  p_audit jsonb,
  p_outbox jsonb DEFAULT NULL::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_comp_meta JSONB;
  v_qbo_sync_enabled BOOLEAN := true;
  v_entity_json JSONB;
  v_local_uuid UUID;
  v_qb_id TEXT;
  v_entity_type TEXT;
  v_norm_list_key TEXT;
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

  v_norm_list_key := lower(regexp_replace(COALESCE(p_list_key, ''), '[[:space:]_-]+', '', 'g'));

  IF p_entity_kind = 'ACCOUNT' THEN
    v_entity_type := 'Account';
    IF p_operation IN ('DELETE', 'DEACTIVATE') THEN
      SELECT to_jsonb(a), a.id, a.qb_account_id
      INTO v_entity_json, v_local_uuid, v_qb_id
      FROM public.external_accounting_accounts a
      WHERE a.company_realm_id = p_realm_id
        AND (
          (p_entity->>'id' IS NOT NULL AND NULLIF(btrim(p_entity->>'id'), '') IS NOT NULL AND a.id = (p_entity->>'id')::uuid)
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
          current_balance = CASE
            WHEN p_entity ? 'current_balance' AND p_entity->>'current_balance' IS NOT NULL
              THEN ROUND((p_entity->>'current_balance')::numeric, 2)
            ELSE current_balance
          END,
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
          COALESCE(NULLIF(btrim(p_entity->>'qb_account_id'), ''), 'LOCAL-ACC-' || (extract(epoch from clock_timestamp()) * 1000)::bigint::text),
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

  ELSIF p_entity_kind = 'CONTACT' THEN
    v_entity_type := COALESCE(p_entity->>'contact_type', 'Vendor');
    IF p_operation IN ('DELETE', 'DEACTIVATE') THEN
      SELECT to_jsonb(c), c.id, c.qb_contact_id, c.contact_type
      INTO v_entity_json, v_local_uuid, v_qb_id, v_entity_type
      FROM public.external_accounting_contacts c
      WHERE c.company_realm_id = p_realm_id
        AND (
          (p_entity->>'id' IS NOT NULL AND NULLIF(btrim(p_entity->>'id'), '') IS NOT NULL AND c.id = (p_entity->>'id')::uuid)
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
          COALESCE(NULLIF(btrim(p_entity->>'qb_contact_id'), ''), 'LOCAL-CON-' || (extract(epoch from clock_timestamp()) * 1000)::bigint::text),
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
          COALESCE(NULLIF(btrim(p_entity->>'qb_recurring_id'), ''), 'LOCAL-REC-' || (extract(epoch from clock_timestamp()) * 1000)::bigint::text),
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
          (p_entity->>'id' IS NOT NULL AND NULLIF(btrim(p_entity->>'id'), '') IS NOT NULL AND att.id = (p_entity->>'id')::uuid)
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
        COALESCE(NULLIF(btrim(p_entity->>'qb_attachable_id'), ''), 'LOCAL-ATT-' || (extract(epoch from clock_timestamp()) * 1000)::bigint::text),
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

  ELSIF p_entity_kind = 'LIST_ITEM' THEN
    v_entity_type := COALESCE(p_list_key, 'Item');
    v_qb_id := COALESCE(
      NULLIF(btrim(p_entity->>'item_id'), ''),
      NULLIF(btrim(p_entity->>'qb_field_id'), ''),
      NULLIF(btrim(p_entity->>'field_key'), ''),
      NULLIF(btrim(p_entity->>'qb_cost_group_id'), ''),
      NULLIF(btrim(p_entity->>'qb_item_id'), ''),
      NULLIF(btrim(p_entity->>'qb_category_id'), ''),
      NULLIF(btrim(p_entity->>'qb_location_id'), ''),
      NULLIF(btrim(p_entity->>'qb_class_id'), ''),
      NULLIF(btrim(p_entity->>'qb_payment_method_id'), ''),
      NULLIF(btrim(p_entity->>'qb_term_id'), ''),
      NULLIF(btrim(p_entity->>'Id'), ''),
      NULLIF(btrim(p_entity->>'qb_id'), '')
    );
    IF v_qb_id IS NULL OR btrim(v_qb_id) = '' THEN
      RAISE EXCEPTION 'item_id / Id is required for LIST_ITEM mutation';
    END IF;

    IF p_operation IN ('DELETE', 'DEACTIVATE') THEN
      IF v_norm_list_key IN ('items', 'item') THEN
        DELETE FROM public.external_accounting_items WHERE company_realm_id = p_realm_id AND qb_item_id = v_qb_id;
      ELSIF v_norm_list_key IN ('categories', 'category') THEN
        DELETE FROM public.external_accounting_categories WHERE company_realm_id = p_realm_id AND qb_category_id = v_qb_id;
      ELSIF v_norm_list_key IN ('departments', 'department', 'locations', 'location') THEN
        DELETE FROM public.external_accounting_locations WHERE company_realm_id = p_realm_id AND qb_location_id = v_qb_id;
      ELSIF v_norm_list_key IN ('classes', 'class') THEN
        DELETE FROM public.external_accounting_classes WHERE company_realm_id = p_realm_id AND qb_class_id = v_qb_id;
      ELSIF v_norm_list_key IN ('paymentmethods', 'paymentmethod') THEN
        DELETE FROM public.external_accounting_payment_methods WHERE company_realm_id = p_realm_id AND qb_payment_method_id = v_qb_id;
      ELSIF v_norm_list_key IN ('terms', 'term') THEN
        DELETE FROM public.external_accounting_terms WHERE company_realm_id = p_realm_id AND qb_term_id = v_qb_id;
      ELSIF v_norm_list_key IN ('customfields', 'customfield') THEN
        DELETE FROM public.external_accounting_custom_fields WHERE company_realm_id = p_realm_id AND qb_field_id = v_qb_id;
      ELSIF v_norm_list_key IN ('costgroups', 'costgroup') THEN
        DELETE FROM public.external_accounting_cost_groups WHERE company_realm_id = p_realm_id AND qb_cost_group_id = v_qb_id;
      ELSIF v_norm_list_key IN ('attachments', 'attachable') THEN
        DELETE FROM public.external_accounting_attachments WHERE company_realm_id = p_realm_id AND qb_attachable_id = v_qb_id;
      ELSE
        RAISE EXCEPTION 'Unsupported listKey for DELETE: %', p_list_key;
      END IF;
      v_entity_json := p_entity;
    ELSE
      IF v_norm_list_key IN ('items', 'item') THEN
        INSERT INTO public.external_accounting_items (
          company_realm_id, qb_item_id, name, fully_qualified_name, sku, item_type,
          category_qb_id, category_name, is_sub_item, description, unit_price,
          purchase_desc, purchase_cost, income_account_qb_id, income_account_name,
          expense_account_qb_id, expense_account_name, asset_account_qb_id, asset_account_name,
          track_qty_on_hand, qty_on_hand, taxable, is_active, raw_data, updated_at
        ) VALUES (
          p_realm_id, v_qb_id, COALESCE(NULLIF(btrim(p_entity->>'name'), ''), NULLIF(btrim(p_entity->>'Name'), ''), v_qb_id),
          COALESCE(p_entity->>'fully_qualified_name', p_entity->>'FullyQualifiedName', p_entity->>'name', p_entity->>'Name', v_qb_id),
          COALESCE(p_entity->>'sku', p_entity->>'Sku'), COALESCE(p_entity->>'item_type', p_entity->>'Type', 'Service'),
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

      ELSIF v_norm_list_key IN ('categories', 'category') THEN
        INSERT INTO public.external_accounting_categories (
          company_realm_id, qb_category_id, name, fully_qualified_name,
          parent_qb_id, parent_name, is_sub_category, is_active, raw_data, updated_at
        ) VALUES (
          p_realm_id, v_qb_id, COALESCE(NULLIF(btrim(p_entity->>'name'), ''), NULLIF(btrim(p_entity->>'Name'), ''), v_qb_id),
          COALESCE(p_entity->>'fully_qualified_name', p_entity->>'FullyQualifiedName', p_entity->>'name', p_entity->>'Name', v_qb_id),
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

      ELSIF v_norm_list_key IN ('departments', 'department', 'locations', 'location') THEN
        INSERT INTO public.external_accounting_locations (
          company_realm_id, qb_location_id, name, fully_qualified_name,
          parent_qb_id, parent_name, is_sub_location, address, is_active, raw_data, updated_at
        ) VALUES (
          p_realm_id, v_qb_id, COALESCE(NULLIF(btrim(p_entity->>'name'), ''), NULLIF(btrim(p_entity->>'Name'), ''), v_qb_id),
          COALESCE(p_entity->>'fully_qualified_name', p_entity->>'FullyQualifiedName', p_entity->>'name', p_entity->>'Name', v_qb_id),
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

      ELSIF v_norm_list_key IN ('classes', 'class') THEN
        INSERT INTO public.external_accounting_classes (
          company_realm_id, qb_class_id, name, fully_qualified_name, class_code,
          parent_qb_id, parent_name, is_sub_class, is_active, raw_data, updated_at
        ) VALUES (
          p_realm_id, v_qb_id, COALESCE(NULLIF(btrim(p_entity->>'name'), ''), NULLIF(btrim(p_entity->>'Name'), ''), v_qb_id),
          COALESCE(p_entity->>'fully_qualified_name', p_entity->>'FullyQualifiedName', p_entity->>'name', p_entity->>'Name', v_qb_id),
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

      ELSIF v_norm_list_key IN ('paymentmethods', 'paymentmethod') THEN
        INSERT INTO public.external_accounting_payment_methods (
          company_realm_id, qb_payment_method_id, name, method_type, is_active, raw_data, updated_at
        ) VALUES (
          p_realm_id, v_qb_id, COALESCE(NULLIF(btrim(p_entity->>'name'), ''), NULLIF(btrim(p_entity->>'Name'), ''), v_qb_id),
          COALESCE(p_entity->>'method_type', p_entity->>'Type', 'NON_CREDIT_CARD'),
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

      ELSIF v_norm_list_key IN ('terms', 'term') THEN
        INSERT INTO public.external_accounting_terms (
          company_realm_id, qb_term_id, name, term_type, due_days,
          discount_percent, discount_days, is_active, raw_data, updated_at
        ) VALUES (
          p_realm_id, v_qb_id, COALESCE(NULLIF(btrim(p_entity->>'name'), ''), NULLIF(btrim(p_entity->>'Name'), ''), v_qb_id),
          COALESCE(p_entity->>'term_type', p_entity->>'Type', 'STANDARD'),
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

      ELSIF v_norm_list_key IN ('customfields', 'customfield') THEN
        INSERT INTO public.external_accounting_custom_fields (
          company_realm_id, qb_field_id, name, data_type,
          applies_to_sales, applies_to_purchase, print_on_page,
          applies_to, is_required, show_on_print, is_active, raw_data, updated_at
        ) VALUES (
          p_realm_id,
          v_qb_id,
          COALESCE(NULLIF(btrim(p_entity->>'name'), ''), NULLIF(btrim(p_entity->>'Name'), ''), v_qb_id),
          COALESCE(p_entity->>'data_type', p_entity->>'Type', 'StringType'),
          COALESCE((p_entity->>'applies_to_sales')::boolean, true),
          COALESCE((p_entity->>'applies_to_purchase')::boolean, true),
          COALESCE((p_entity->>'print_on_page')::boolean, COALESCE((p_entity->>'show_on_print')::boolean, true)),
          COALESCE(p_entity->'applies_to', '["Invoice","SalesReceipt","Bill","PurchaseOrder","Check","Expense"]'::jsonb),
          COALESCE((p_entity->>'is_required')::boolean, false),
          COALESCE((p_entity->>'show_on_print')::boolean, COALESCE((p_entity->>'print_on_page')::boolean, true)),
          COALESCE((p_entity->>'is_active')::boolean, true),
          COALESCE(p_entity->'raw_data', '{}'::jsonb),
          NOW()
        )
        ON CONFLICT (company_realm_id, qb_field_id) DO UPDATE SET
          name = EXCLUDED.name,
          data_type = EXCLUDED.data_type,
          applies_to_sales = EXCLUDED.applies_to_sales,
          applies_to_purchase = EXCLUDED.applies_to_purchase,
          print_on_page = EXCLUDED.print_on_page,
          applies_to = EXCLUDED.applies_to,
          is_required = EXCLUDED.is_required,
          show_on_print = EXCLUDED.show_on_print,
          is_active = EXCLUDED.is_active,
          raw_data = EXCLUDED.raw_data,
          updated_at = NOW()
        RETURNING to_jsonb(external_accounting_custom_fields.*), id INTO v_entity_json, v_local_uuid;

      ELSIF v_norm_list_key IN ('costgroups', 'costgroup') THEN
        INSERT INTO public.external_accounting_cost_groups (
          company_realm_id, qb_cost_group_id, name, code, description, cost_type,
          default_account_qb_id, default_account_name, is_active, raw_data, updated_at
        ) VALUES (
          p_realm_id,
          v_qb_id,
          COALESCE(NULLIF(btrim(p_entity->>'name'), ''), NULLIF(btrim(p_entity->>'Name'), ''), v_qb_id),
          p_entity->>'code',
          p_entity->>'description',
          COALESCE(p_entity->>'cost_type', 'Direct Cost'),
          p_entity->>'default_account_qb_id',
          p_entity->>'default_account_name',
          COALESCE((p_entity->>'is_active')::boolean, true),
          COALESCE(p_entity->'raw_data', '{}'::jsonb),
          NOW()
        )
        ON CONFLICT (company_realm_id, qb_cost_group_id) DO UPDATE SET
          name = EXCLUDED.name,
          code = COALESCE(EXCLUDED.code, public.external_accounting_cost_groups.code),
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

    IF p_entity->'next_company_metadata' IS NOT NULL THEN
      UPDATE public.external_accounting_companies
      SET metadata = p_entity->'next_company_metadata',
          updated_at = NOW()
      WHERE realm_id = p_realm_id;
    END IF;

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

  IF p_outbox IS NOT NULL THEN
    IF NOT v_qbo_sync_enabled
       OR p_entity_kind IN ('BANK_RULE', 'BUDGET', 'COMPANY_SETTINGS', 'NOTE_TASK', 'RECURRING')
       OR (p_entity_kind = 'LIST_ITEM' AND v_norm_list_key IN ('customfields', 'customfield', 'costgroups', 'costgroup'))
    THEN
      v_outbox_status := 'SKIPPED_LOCAL_ONLY';
    ELSE
      v_outbox_status := 'PENDING';
    END IF;

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
$function$;

-- 6. Harden `fn_ext_acct_save_reconciliation_atomic` (un-reconcile unchecked txns, verify account membership, set reconciled_by, stamp reconciliation_id on auto entries)
CREATE OR REPLACE FUNCTION public.fn_ext_acct_save_reconciliation_atomic(
  p_realm_id text,
  p_reconciliation jsonb,
  p_extra_transactions jsonb DEFAULT '[]'::jsonb,
  p_deltas jsonb DEFAULT '[]'::jsonb,
  p_audit jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_comp_meta JSONB;
  v_qbo_sync_enabled BOOLEAN := true;
  v_bank_qb_id TEXT;
  v_bank_name TEXT;
  v_status TEXT;
  v_diff NUMERIC(18,2);
  v_rec_id UUID;
  v_is_existing_rec BOOLEAN := false;
  v_prev_rec public.external_accounting_reconciliations%ROWTYPE;
  v_prev_txn_ids TEXT[] := ARRAY[]::TEXT[];
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
  v_reconciled_by TEXT;
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

  v_reconciled_by := COALESCE(
    NULLIF(btrim(p_reconciliation->>'reconciled_by'), ''),
    NULLIF(btrim(p_audit->>'user_name'), ''),
    'Authorized User'
  );

  v_rec_id := NULLIF(btrim(COALESCE(p_reconciliation->>'id', '')), '')::uuid;
  IF v_rec_id IS NOT NULL THEN
    v_is_existing_rec := true;
    SELECT * INTO v_prev_rec
    FROM public.external_accounting_reconciliations
    WHERE id = v_rec_id
      AND company_realm_id = p_realm_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Reconciliation % not found in company %', v_rec_id, p_realm_id;
    END IF;

    IF v_prev_rec.reconciled_txn_ids IS NOT NULL AND jsonb_typeof(v_prev_rec.reconciled_txn_ids) = 'array' THEN
      SELECT COALESCE(array_agg(elem), ARRAY[]::TEXT[])
      INTO v_prev_txn_ids
      FROM jsonb_array_elements_text(v_prev_rec.reconciled_txn_ids) AS elem
      WHERE btrim(elem) <> '';
    END IF;
  ELSE
    v_rec_id := gen_random_uuid();
  END IF;

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
        FROM public.external_accounting_transactions t
        WHERE t.id = v_found_txn_id
          AND t.company_realm_id = p_realm_id
          AND COALESCE(t.is_voided, false) = false
          AND (
            t.account_qb_id = v_bank_qb_id
            OR t.to_account_qb_id = v_bank_qb_id
            OR EXISTS (
              SELECT 1
              FROM public.external_accounting_transaction_lines tl
              WHERE tl.transaction_id = t.id
                AND tl.account_qb_id = v_bank_qb_id
            )
          );

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Reconciled transaction % does not exist, is voided, or does not affect account % in company %', v_req_id, v_bank_qb_id, p_realm_id;
        END IF;

        v_txn_ids := array_append(v_txn_ids, v_found_txn_id::text);
      END IF;
    END LOOP;
  END IF;

  IF p_extra_transactions IS NOT NULL AND jsonb_typeof(p_extra_transactions) = 'array' THEN
    FOR v_extra IN SELECT * FROM jsonb_array_elements(p_extra_transactions)
    LOOP
      v_extra_txn := v_extra->'txn';
      v_extra_outbox := v_extra->'outbox';
      v_extra_audit := v_extra->'audit';
      IF v_extra_txn IS NULL THEN
        RAISE EXCEPTION 'Extra reconciliation transaction entry is missing txn object';
      END IF;
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
        COALESCE(v_extra_txn->'raw_data', '{}'::jsonb) || jsonb_build_object(
          'reconciliation_auto_entry', true,
          'reconciliation_id', v_rec_id::text
        ),
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

  IF p_deltas IS NOT NULL AND jsonb_typeof(p_deltas) = 'array' AND jsonb_array_length(p_deltas) > 0 THEN
    v_balance_res := public.fn_ext_acct_apply_account_deltas(p_realm_id, p_deltas);
  ELSE
    v_balance_res := jsonb_build_object('ok', true, 'updated_count', 0);
  END IF;

  IF array_length(v_prev_txn_ids, 1) > 0 THEN
    UPDATE public.external_accounting_transactions
    SET cleared_status = 'Cleared',
        updated_at = NOW()
    WHERE company_realm_id = p_realm_id
      AND id::text = ANY(v_prev_txn_ids)
      AND cleared_status = 'Reconciled'
      AND (v_status <> 'Completed' OR NOT (id::text = ANY(v_txn_ids)));
  END IF;

  IF v_status = 'Completed' AND array_length(v_txn_ids, 1) > 0 THEN
    UPDATE public.external_accounting_transactions
    SET cleared_status = 'Reconciled',
        updated_at = NOW()
    WHERE company_realm_id = p_realm_id
      AND id::text = ANY(v_txn_ids);
  END IF;

  IF v_is_existing_rec THEN
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
      reconciled_by = v_reconciled_by,
      completed_at = CASE WHEN v_status = 'Completed' THEN NOW() ELSE NULL END,
      updated_at = NOW()
    WHERE id = v_rec_id
      AND company_realm_id = p_realm_id
    RETURNING * INTO v_rec_row;
  ELSE
    INSERT INTO public.external_accounting_reconciliations (
      id, company_realm_id, account_qb_id, account_name, statement_ending_date,
      beginning_balance, ending_balance, cleared_balance, difference,
      payments_count, payments_total, deposits_count, deposits_total,
      service_charge, interest_earned, reconciled_txn_ids, status,
      notes, reconciled_by, completed_at, updated_at
    ) VALUES (
      v_rec_id,
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
      v_reconciled_by,
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
$function$;

-- Backfill Raquel's reconciled_by on her Nov 11/12 completed reconciliation
UPDATE public.external_accounting_reconciliations
SET reconciled_by = 'Raquel Velazquez'
WHERE id = '6843a37a-db4c-45f0-946e-24725398439f'
  AND reconciled_by IS NULL;

-- 7. Distributed Postgres Mutex for QBO OAuth Token Refresh & Outbox Atomic Claiming (`FOR UPDATE SKIP LOCKED`)
CREATE OR REPLACE FUNCTION public.fn_ext_acct_acquire_qbo_refresh_lock(
  p_realm_id text,
  p_lock_seconds integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_meta JSONB;
  v_oauth JSONB;
  v_expires_at TIMESTAMPTZ;
  v_lock_until TIMESTAMPTZ;
BEGIN
  SELECT metadata INTO v_meta
  FROM public.external_accounting_companies
  WHERE realm_id = p_realm_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('acquired', false, 'reason', 'COMPANY_NOT_FOUND');
  END IF;

  v_meta := COALESCE(v_meta, '{}'::jsonb);
  v_oauth := COALESCE(v_meta->'qbo_oauth', '{}'::jsonb);

  IF NULLIF(btrim(v_oauth->>'expires_at'), '') IS NOT NULL THEN
    BEGIN
      v_expires_at := (v_oauth->>'expires_at')::timestamptz;
      IF v_expires_at > NOW() + interval '90 seconds' THEN
        RETURN jsonb_build_object('acquired', false, 'already_fresh', true, 'metadata', v_meta);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  IF NULLIF(btrim(v_meta->>'qbo_refresh_lock_until'), '') IS NOT NULL THEN
    BEGIN
      v_lock_until := (v_meta->>'qbo_refresh_lock_until')::timestamptz;
      IF v_lock_until > NOW() THEN
        RETURN jsonb_build_object('acquired', false, 'locked', true, 'metadata', v_meta);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  v_meta := jsonb_set(v_meta, '{qbo_refresh_lock_until}', to_jsonb((NOW() + make_interval(secs => GREATEST(p_lock_seconds, 5)))::text), true);

  UPDATE public.external_accounting_companies
  SET metadata = v_meta
  WHERE realm_id = p_realm_id;

  RETURN jsonb_build_object('acquired', true, 'metadata', v_meta);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_ext_acct_claim_pending_qbo_outbox(
  p_realm_id text DEFAULT NULL,
  p_limit integer DEFAULT 25,
  p_force_now boolean DEFAULT false
)
RETURNS SETOF public.external_accounting_sync_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_eff_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
BEGIN
  -- Recover stale PROCESSING entries older than 5 minutes
  UPDATE public.external_accounting_sync_outbox
  SET status = 'FAILED',
      last_error = COALESCE(last_error, 'Recovered stale PROCESSING lock after 5m timeout'),
      next_retry_at = NOW(),
      updated_at = NOW()
  WHERE status = 'PROCESSING'
    AND updated_at < NOW() - interval '5 minutes'
    AND (p_realm_id IS NULL OR company_realm_id = p_realm_id);

  RETURN QUERY
  WITH claimed AS (
    SELECT o.id
    FROM public.external_accounting_sync_outbox o
    WHERE (p_realm_id IS NULL OR o.company_realm_id = p_realm_id)
      AND o.status IN ('PENDING', 'FAILED')
      AND COALESCE(o.attempts, 0) < COALESCE(o.max_attempts, 5)
      AND (p_force_now OR o.next_retry_at IS NULL OR o.next_retry_at <= NOW())
    ORDER BY o.created_at ASC
    LIMIT v_eff_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.external_accounting_sync_outbox target
  SET status = 'PROCESSING',
      updated_at = NOW()
  FROM claimed
  WHERE target.id = claimed.id
  RETURNING target.*;
END;
$fn$;

-- 8. Set search_path and REVOKE public/anon/authenticated EXECUTE on ALL mutating SECURITY DEFINER RPCs
ALTER FUNCTION public.fn_ext_acct_apply_account_deltas(text, jsonb) SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_ext_acct_batch_mutate_transactions_atomic(text, text, jsonb, jsonb, jsonb, jsonb, jsonb) SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_ext_acct_mutate_transaction_atomic(text, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_ext_acct_reopen_or_delete_reconciliation_atomic(text, text, uuid, jsonb) SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.fn_ext_acct_apply_account_deltas(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ext_acct_batch_mutate_transactions_atomic(text, text, jsonb, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ext_acct_mutate_entity_atomic(text, text, text, text, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ext_acct_mutate_transaction_atomic(text, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ext_acct_reopen_or_delete_reconciliation_atomic(text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ext_acct_save_reconciliation_atomic(text, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ext_acct_acquire_qbo_refresh_lock(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ext_acct_claim_pending_qbo_outbox(text, integer, boolean) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.fn_ext_acct_apply_account_deltas(text, jsonb) TO service_role, postgres, supabase_admin;
GRANT EXECUTE ON FUNCTION public.fn_ext_acct_batch_mutate_transactions_atomic(text, text, jsonb, jsonb, jsonb, jsonb, jsonb) TO service_role, postgres, supabase_admin;
GRANT EXECUTE ON FUNCTION public.fn_ext_acct_mutate_entity_atomic(text, text, text, text, jsonb, jsonb, jsonb) TO service_role, postgres, supabase_admin;
GRANT EXECUTE ON FUNCTION public.fn_ext_acct_mutate_transaction_atomic(text, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) TO service_role, postgres, supabase_admin;
GRANT EXECUTE ON FUNCTION public.fn_ext_acct_reopen_or_delete_reconciliation_atomic(text, text, uuid, jsonb) TO service_role, postgres, supabase_admin;
GRANT EXECUTE ON FUNCTION public.fn_ext_acct_save_reconciliation_atomic(text, jsonb, jsonb, jsonb, jsonb) TO service_role, postgres, supabase_admin;
GRANT EXECUTE ON FUNCTION public.fn_ext_acct_acquire_qbo_refresh_lock(text, integer) TO service_role, postgres, supabase_admin;
GRANT EXECUTE ON FUNCTION public.fn_ext_acct_claim_pending_qbo_outbox(text, integer, boolean) TO service_role, postgres, supabase_admin;

ALTER FUNCTION public.fn_enforce_ext_acct_same_company() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_resolve_ext_acct_tx_fks() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_sync_ext_acct_tx_children() SET search_path = public, pg_temp;
