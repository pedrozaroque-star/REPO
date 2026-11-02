/**
 * @module scripts/apply-external-accounting-relational-upgrade
 * @description Aplica el esquema relacional exacto de QuickBooks Online (QBO) en Supabase:
 *              Foreign Keys UUID reales, líneas normalizadas (`external_accounting_transaction_lines`),
 *              grafo relacional de transacciones vinculadas (`external_accounting_linked_transactions`),
 *              notas/tareas (`external_accounting_notes_tasks`), historial de correos (`external_accounting_email_log`)
 *              y triggers automáticos de sincronización en PostgreSQL.
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
    .join(' ')
  const payload = `SELECT 1 ) t; SET statement_timeout = '120s'; ${cleanSql} SELECT * FROM (SELECT 1`
  const start = Date.now()
  const { error } = await supabase.rpc('execute_sql', { query_text: payload })
  if (error) {
    console.error(`❌ [${label}] Error:`, error)
    throw error
  }
  console.log(`✅ [${label}] completed in ${Date.now() - start}ms`)
}

async function execQuery(sql: string) {
  const { data, error } = await supabase.rpc('execute_sql', { query_text: sql })
  if (error) {
    console.error('❌ Query error:', error, '\nSQL:', sql)
    throw error
  }
  return data
}

async function main() {
  console.log('🚀 1. Applying Relational Schema DDL...')
  const sqlPath = path.resolve(process.cwd(), 'scripts/external-accounting-relational-upgrade.sql')
  const ddlSql = fs.readFileSync(sqlPath, 'utf8')
  await execDdl('DDL Schema & Indexes', ddlSql)

  console.log('🚀 2. Backfilling Master Table Foreign Keys...')
  await execDdl(
    'Accounts Parent FK',
    `
    UPDATE external_accounting_accounts child
    SET parent_account_id = parent.id
    FROM external_accounting_accounts parent
    WHERE child.company_realm_id = parent.company_realm_id
      AND child.parent_qb_id IS NOT NULL
      AND child.parent_qb_id <> ''
      AND child.parent_qb_id = parent.qb_account_id
      AND child.parent_account_id IS DISTINCT FROM parent.id;
    `
  )

  await execDdl(
    'Contacts Default Term & Payment Method FKs',
    `
    UPDATE external_accounting_contacts c
    SET default_term_id = tm.id
    FROM external_accounting_terms tm
    WHERE c.company_realm_id = tm.company_realm_id
      AND COALESCE(c.raw_data->'SalesTermRef'->>'value', c.raw_data->'TermRef'->>'value') = tm.qb_term_id
      AND c.default_term_id IS DISTINCT FROM tm.id;

    UPDATE external_accounting_contacts c
    SET default_payment_method_id = pm.id
    FROM external_accounting_payment_methods pm
    WHERE c.company_realm_id = pm.company_realm_id
      AND (c.raw_data->'PaymentMethodRef'->>'value') = pm.qb_payment_method_id
      AND c.default_payment_method_id IS DISTINCT FROM pm.id;

    UPDATE external_accounting_contacts c
    SET default_expense_account_id = a.id
    FROM external_accounting_accounts a
    WHERE c.company_realm_id = a.company_realm_id
      AND (c.raw_data->'APAccountRef'->>'value') = a.qb_account_id
      AND c.default_expense_account_id IS DISTINCT FROM a.id;
    `
  )

  await execDdl(
    'Items Account & Category FKs',
    `
    UPDATE external_accounting_items i
    SET income_account_id = a.id
    FROM external_accounting_accounts a
    WHERE i.company_realm_id = a.company_realm_id
      AND i.income_account_qb_id = a.qb_account_id
      AND i.income_account_id IS DISTINCT FROM a.id;

    UPDATE external_accounting_items i
    SET expense_account_id = a.id
    FROM external_accounting_accounts a
    WHERE i.company_realm_id = a.company_realm_id
      AND i.expense_account_qb_id = a.qb_account_id
      AND i.expense_account_id IS DISTINCT FROM a.id;

    UPDATE external_accounting_items i
    SET asset_account_id = a.id
    FROM external_accounting_accounts a
    WHERE i.company_realm_id = a.company_realm_id
      AND i.asset_account_qb_id = a.qb_account_id
      AND i.asset_account_id IS DISTINCT FROM a.id;

    UPDATE external_accounting_items i
    SET category_id = cat.id
    FROM external_accounting_categories cat
    WHERE i.company_realm_id = cat.company_realm_id
      AND (i.raw_data->'ParentRef'->>'value') = cat.qb_category_id
      AND i.category_id IS DISTINCT FROM cat.id;
    `
  )

  console.log('🚀 3. Backfilling Transaction Header Foreign Keys (18,850 rows)...')
  // Important: drop trigger during bulk backfill so it doesn't fire per-row during UPDATE
  await execDdl(
    'Drop Triggers Before Bulk Backfill',
    `
    DROP TRIGGER IF EXISTS trg_resolve_ext_acct_tx_fks ON external_accounting_transactions;
    DROP TRIGGER IF EXISTS trg_sync_ext_acct_tx_children ON external_accounting_transactions;
    `
  )

  await execDdl(
    'Transactions account_id & to_account_id FKs',
    `
    UPDATE external_accounting_transactions t
    SET account_id = a.id
    FROM external_accounting_accounts a
    WHERE t.company_realm_id = a.company_realm_id
      AND t.account_qb_id = a.qb_account_id
      AND t.account_id IS DISTINCT FROM a.id;

    UPDATE external_accounting_transactions t
    SET to_account_id = a.id
    FROM external_accounting_accounts a
    WHERE t.company_realm_id = a.company_realm_id
      AND t.to_account_qb_id = a.qb_account_id
      AND t.to_account_id IS DISTINCT FROM a.id;
    `
  )

  await execDdl(
    'Transactions contact_id FK',
    `
    UPDATE external_accounting_transactions t
    SET contact_id = c.id
    FROM external_accounting_contacts c
    WHERE t.company_realm_id = c.company_realm_id
      AND t.entity_qb_id = c.qb_contact_id
      AND (
        t.entity_type = c.contact_type
        OR (t.entity_type IN ('Customer', 'Tenant') AND c.contact_type IN ('Customer', 'Tenant'))
      )
      AND t.contact_id IS DISTINCT FROM c.id;

    UPDATE external_accounting_transactions t
    SET contact_id = c.id
    FROM external_accounting_contacts c
    WHERE t.contact_id IS NULL
      AND t.company_realm_id = c.company_realm_id
      AND t.entity_qb_id = c.qb_contact_id;
    `
  )

  await execDdl(
    'Transactions location_id, class_id, term_id, payment_method_id FKs',
    `
    UPDATE external_accounting_transactions t
    SET location_id = l.id
    FROM external_accounting_locations l
    WHERE t.company_realm_id = l.company_realm_id
      AND t.department_qb_id = l.qb_location_id
      AND t.location_id IS DISTINCT FROM l.id;

    UPDATE external_accounting_transactions t
    SET class_id = cl.id
    FROM external_accounting_classes cl
    WHERE t.company_realm_id = cl.company_realm_id
      AND t.class_qb_id = cl.qb_class_id
      AND t.class_id IS DISTINCT FROM cl.id;

    UPDATE external_accounting_transactions t
    SET term_id = tm.id
    FROM external_accounting_terms tm
    WHERE t.company_realm_id = tm.company_realm_id
      AND (
        (t.raw_data->'SalesTermRef'->>'value') = tm.qb_term_id
        OR (t.term_name IS NOT NULL AND t.term_name <> '' AND LOWER(t.term_name) = LOWER(tm.name))
      )
      AND t.term_id IS DISTINCT FROM tm.id;

    UPDATE external_accounting_transactions t
    SET payment_method_id = pm.id
    FROM external_accounting_payment_methods pm
    WHERE t.company_realm_id = pm.company_realm_id
      AND (
        (t.raw_data->'PaymentMethodRef'->>'value') = pm.qb_payment_method_id
        OR (t.payment_method IS NOT NULL AND t.payment_method <> '' AND LOWER(t.payment_method) = LOWER(pm.name))
      )
      AND t.payment_method_id IS DISTINCT FROM pm.id;
    `
  )

  await execDdl(
    'Recurring, Reconciliations, Bank Rules & Budgets FKs',
    `
    UPDATE external_accounting_recurring r
    SET account_id = a.id
    FROM external_accounting_accounts a
    WHERE r.company_realm_id = a.company_realm_id
      AND r.account_qb_id = a.qb_account_id
      AND r.account_id IS DISTINCT FROM a.id;

    UPDATE external_accounting_recurring r
    SET contact_id = c.id
    FROM external_accounting_contacts c
    WHERE r.company_realm_id = c.company_realm_id
      AND r.entity_qb_id = c.qb_contact_id
      AND r.contact_id IS DISTINCT FROM c.id;

    UPDATE external_accounting_recurring r
    SET location_id = l.id
    FROM external_accounting_locations l
    WHERE r.company_realm_id = l.company_realm_id
      AND r.department_qb_id = l.qb_location_id
      AND r.location_id IS DISTINCT FROM l.id;

    UPDATE external_accounting_recurring r
    SET class_id = cl.id
    FROM external_accounting_classes cl
    WHERE r.company_realm_id = cl.company_realm_id
      AND r.class_qb_id = cl.qb_class_id
      AND r.class_id IS DISTINCT FROM cl.id;

    UPDATE external_accounting_reconciliations rec
    SET account_id = a.id
    FROM external_accounting_accounts a
    WHERE rec.company_realm_id = a.company_realm_id
      AND rec.account_qb_id = a.qb_account_id
      AND rec.account_id IS DISTINCT FROM a.id;

    UPDATE external_accounting_bank_rules br
    SET target_account_id = a.id
    FROM external_accounting_accounts a
    WHERE br.company_realm_id = a.company_realm_id
      AND br.target_account_qb_id = a.qb_account_id
      AND br.target_account_id IS DISTINCT FROM a.id;

    UPDATE external_accounting_budgets b
    SET account_id = a.id
    FROM external_accounting_accounts a
    WHERE b.company_realm_id = a.company_realm_id
      AND b.account_qb_id = a.qb_account_id
      AND b.account_id IS DISTINCT FROM a.id;
    `
  )

  console.log('🚀 4. Backfilling Normalized Transaction Lines (35,309+ rows)...')
  await execDdl(
    'Populate external_accounting_transaction_lines',
    `
    TRUNCATE TABLE external_accounting_transaction_lines;

    INSERT INTO external_accounting_transaction_lines (
      transaction_id,
      company_realm_id,
      qb_txn_id,
      txn_type,
      txn_date,
      line_num,
      qb_line_id,
      detail_type,
      account_qb_id,
      account_name,
      item_qb_id,
      item_name,
      entity_qb_id,
      entity_name,
      class_qb_id,
      class_name,
      department_qb_id,
      department_name,
      description,
      qty,
      unit_price,
      amount,
      posting_type
    )
    SELECT
      t.id AS transaction_id,
      t.company_realm_id,
      t.qb_txn_id,
      t.txn_type,
      t.txn_date,
      elem.ord::integer AS line_num,
      COALESCE(NULLIF(elem.item->>'id', ''), elem.ord::text) AS qb_line_id,
      NULLIF(elem.item->>'detail_type', '') AS detail_type,
      NULLIF(elem.item->>'account_qb_id', '') AS account_qb_id,
      NULLIF(elem.item->>'account_name', '') AS account_name,
      NULLIF(elem.item->>'item_qb_id', '') AS item_qb_id,
      NULLIF(elem.item->>'item_name', '') AS item_name,
      NULLIF(elem.item->>'entity_qb_id', '') AS entity_qb_id,
      NULLIF(elem.item->>'entity_name', '') AS entity_name,
      NULLIF(elem.item->>'class_qb_id', '') AS class_qb_id,
      NULLIF(elem.item->>'class_name', '') AS class_name,
      NULLIF(elem.item->>'department_qb_id', '') AS department_qb_id,
      NULLIF(elem.item->>'department_name', '') AS department_name,
      NULLIF(elem.item->>'description', '') AS description,
      CASE WHEN (elem.item->>'qty') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (elem.item->>'qty')::numeric(14,4) ELSE 1 END AS qty,
      CASE WHEN (elem.item->>'unit_price') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (elem.item->>'unit_price')::numeric(14,4) ELSE 0 END AS unit_price,
      CASE WHEN (elem.item->>'amount') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (elem.item->>'amount')::numeric(14,2) ELSE 0 END AS amount,
      NULLIF(elem.item->>'posting_type', '') AS posting_type
    FROM external_accounting_transactions t
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(t.line_items) = 'array' THEN t.line_items ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS elem(item, ord);
    `
  )

  await execDdl(
    'Resolve Foreign Keys on external_accounting_transaction_lines',
    `
    UPDATE external_accounting_transaction_lines tl
    SET account_id = a.id
    FROM external_accounting_accounts a
    WHERE tl.company_realm_id = a.company_realm_id
      AND tl.account_qb_id IS NOT NULL
      AND tl.account_qb_id = a.qb_account_id;

    UPDATE external_accounting_transaction_lines tl
    SET item_id = i.id
    FROM external_accounting_items i
    WHERE tl.company_realm_id = i.company_realm_id
      AND tl.item_qb_id IS NOT NULL
      AND tl.item_qb_id = i.qb_item_id;

    UPDATE external_accounting_transaction_lines tl
    SET contact_id = c.id
    FROM external_accounting_contacts c
    WHERE tl.company_realm_id = c.company_realm_id
      AND tl.entity_qb_id IS NOT NULL
      AND tl.entity_qb_id = c.qb_contact_id;

    UPDATE external_accounting_transaction_lines tl
    SET class_id = cl.id
    FROM external_accounting_classes cl
    WHERE tl.company_realm_id = cl.company_realm_id
      AND tl.class_qb_id IS NOT NULL
      AND tl.class_qb_id = cl.qb_class_id;

    UPDATE external_accounting_transaction_lines tl
    SET location_id = l.id
    FROM external_accounting_locations l
    WHERE tl.company_realm_id = l.company_realm_id
      AND tl.department_qb_id IS NOT NULL
      AND tl.department_qb_id = l.qb_location_id;
    `
  )

  console.log('🚀 5. Backfilling Linked Transactions Graph (`LinkedTxn` - 20,509 edges)...')
  await execDdl(
    'Populate external_accounting_linked_transactions',
    `
    TRUNCATE TABLE external_accounting_linked_transactions;

    INSERT INTO external_accounting_linked_transactions (
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
      SELECT
        t.company_realm_id,
        t.id AS source_transaction_id,
        t.qb_txn_id AS source_qb_txn_id,
        t.txn_type AS source_txn_type,
        lt->>'TxnId' AS target_qb_txn_id,
        COALESCE(NULLIF(lt->>'TxnType', ''), 'Unknown') AS target_txn_type,
        'header'::text AS link_scope,
        COALESCE(t.total_amount, 0)::numeric(14,2) AS applied_amount
      FROM external_accounting_transactions t
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(t.raw_data->'LinkedTxn') = 'array' THEN t.raw_data->'LinkedTxn' ELSE '[]'::jsonb END
      ) AS lt
      WHERE NULLIF(lt->>'TxnId', '') IS NOT NULL

      UNION ALL

      SELECT
        t.company_realm_id,
        t.id AS source_transaction_id,
        t.qb_txn_id AS source_qb_txn_id,
        t.txn_type AS source_txn_type,
        lt->>'TxnId' AS target_qb_txn_id,
        COALESCE(NULLIF(lt->>'TxnType', ''), 'Unknown') AS target_txn_type,
        'line'::text AS link_scope,
        CASE WHEN (ln->>'Amount') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (ln->>'Amount')::numeric(14,2) ELSE 0 END AS applied_amount
      FROM external_accounting_transactions t
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(t.raw_data->'Line') = 'array' THEN t.raw_data->'Line' ELSE '[]'::jsonb END
      ) AS ln
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(ln->'LinkedTxn') = 'array' THEN ln->'LinkedTxn' ELSE '[]'::jsonb END
      ) AS lt
      WHERE NULLIF(lt->>'TxnId', '') IS NOT NULL
    ) raw_edges
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
    `
  )

  await execDdl(
    'Resolve Target Transaction UUIDs in external_accounting_linked_transactions',
    `
    UPDATE external_accounting_linked_transactions lt
    SET target_transaction_id = tgt.id
    FROM external_accounting_transactions tgt
    WHERE lt.company_realm_id = tgt.company_realm_id
      AND lt.target_qb_txn_id = tgt.qb_txn_id
      AND (
        lt.target_txn_type = tgt.txn_type
        OR (lt.target_txn_type IN ('BillPaymentCheck', 'BillPaymentCreditCard', 'BillPayment') AND tgt.txn_type = 'BillPayment')
        OR (lt.target_txn_type IN ('ReceivePayment', 'Payment') AND tgt.txn_type = 'Payment')
        OR (lt.target_txn_type IN ('Check', 'Expense', 'CashPurchase', 'CreditCardCredit') AND tgt.txn_type IN ('Check', 'Expense', 'CreditCardCredit'))
      );

    UPDATE external_accounting_linked_transactions lt
    SET target_transaction_id = tgt.id
    FROM external_accounting_transactions tgt
    WHERE lt.target_transaction_id IS NULL
      AND lt.company_realm_id = tgt.company_realm_id
      AND lt.target_qb_txn_id = tgt.qb_txn_id;
    `
  )

  console.log('🚀 6. Installing Automatic PostgreSQL Relational Sync Triggers...')
  await execDdl(
    'Trigger fn_resolve_ext_acct_tx_fks',
    `
    CREATE OR REPLACE FUNCTION fn_resolve_ext_acct_tx_fks()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.account_qb_id IS NOT NULL AND NEW.account_qb_id <> '' THEN
        SELECT id INTO NEW.account_id
        FROM external_accounting_accounts
        WHERE company_realm_id = NEW.company_realm_id AND qb_account_id = NEW.account_qb_id
        LIMIT 1;
      ELSE
        NEW.account_id := NULL;
      END IF;

      IF NEW.to_account_qb_id IS NOT NULL AND NEW.to_account_qb_id <> '' THEN
        SELECT id INTO NEW.to_account_id
        FROM external_accounting_accounts
        WHERE company_realm_id = NEW.company_realm_id AND qb_account_id = NEW.to_account_qb_id
        LIMIT 1;
      ELSE
        NEW.to_account_id := NULL;
      END IF;

      IF NEW.entity_qb_id IS NOT NULL AND NEW.entity_qb_id <> '' THEN
        SELECT id INTO NEW.contact_id
        FROM external_accounting_contacts
        WHERE company_realm_id = NEW.company_realm_id AND qb_contact_id = NEW.entity_qb_id
        ORDER BY CASE WHEN contact_type = NEW.entity_type THEN 0 ELSE 1 END
        LIMIT 1;
      ELSE
        NEW.contact_id := NULL;
      END IF;

      IF NEW.department_qb_id IS NOT NULL AND NEW.department_qb_id <> '' THEN
        SELECT id INTO NEW.location_id
        FROM external_accounting_locations
        WHERE company_realm_id = NEW.company_realm_id AND qb_location_id = NEW.department_qb_id
        LIMIT 1;
      ELSE
        NEW.location_id := NULL;
      END IF;

      IF NEW.class_qb_id IS NOT NULL AND NEW.class_qb_id <> '' THEN
        SELECT id INTO NEW.class_id
        FROM external_accounting_classes
        WHERE company_realm_id = NEW.company_realm_id AND qb_class_id = NEW.class_qb_id
        LIMIT 1;
      ELSE
        NEW.class_id := NULL;
      END IF;

      IF NEW.term_qb_id IS NOT NULL AND NEW.term_qb_id <> '' THEN
        SELECT id INTO NEW.term_id
        FROM external_accounting_terms
        WHERE company_realm_id = NEW.company_realm_id AND qb_term_id = NEW.term_qb_id
        LIMIT 1;
      ELSIF NEW.term_name IS NOT NULL AND NEW.term_name <> '' THEN
        SELECT id INTO NEW.term_id
        FROM external_accounting_terms
        WHERE company_realm_id = NEW.company_realm_id AND LOWER(name) = LOWER(NEW.term_name)
        LIMIT 1;
      END IF;

      IF NEW.payment_method_qb_id IS NOT NULL AND NEW.payment_method_qb_id <> '' THEN
        SELECT id INTO NEW.payment_method_id
        FROM external_accounting_payment_methods
        WHERE company_realm_id = NEW.company_realm_id AND qb_payment_method_id = NEW.payment_method_qb_id
        LIMIT 1;
      ELSIF COALESCE(NEW.payment_method, NEW.payment_type) IS NOT NULL AND COALESCE(NEW.payment_method, NEW.payment_type) <> '' THEN
        SELECT id INTO NEW.payment_method_id
        FROM external_accounting_payment_methods
        WHERE company_realm_id = NEW.company_realm_id AND LOWER(name) = LOWER(COALESCE(NEW.payment_method, NEW.payment_type))
        LIMIT 1;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_resolve_ext_acct_tx_fks ON external_accounting_transactions;
    CREATE TRIGGER trg_resolve_ext_acct_tx_fks
      BEFORE INSERT OR UPDATE ON external_accounting_transactions
      FOR EACH ROW
      EXECUTE FUNCTION fn_resolve_ext_acct_tx_fks();
    `
  )

  await execDdl(
    'Trigger fn_sync_ext_acct_tx_children',
    `
    CREATE OR REPLACE FUNCTION fn_sync_ext_acct_tx_children()
    RETURNS TRIGGER AS $$
    BEGIN
      DELETE FROM external_accounting_transaction_lines WHERE transaction_id = NEW.id;

      IF jsonb_typeof(NEW.line_items) = 'array' THEN
        INSERT INTO external_accounting_transaction_lines (
          transaction_id,
          company_realm_id,
          qb_txn_id,
          txn_type,
          txn_date,
          line_num,
          qb_line_id,
          detail_type,
          account_id,
          account_qb_id,
          account_name,
          item_id,
          item_qb_id,
          item_name,
          contact_id,
          entity_qb_id,
          entity_name,
          class_id,
          class_qb_id,
          class_name,
          location_id,
          department_qb_id,
          department_name,
          description,
          qty,
          unit_price,
          amount,
          posting_type
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
          (SELECT a.id FROM external_accounting_accounts a WHERE a.company_realm_id = NEW.company_realm_id AND a.qb_account_id = NULLIF(elem.item->>'account_qb_id', '') LIMIT 1),
          NULLIF(elem.item->>'account_qb_id', ''),
          NULLIF(elem.item->>'account_name', ''),
          (SELECT i.id FROM external_accounting_items i WHERE i.company_realm_id = NEW.company_realm_id AND i.qb_item_id = NULLIF(elem.item->>'item_qb_id', '') LIMIT 1),
          NULLIF(elem.item->>'item_qb_id', ''),
          NULLIF(elem.item->>'item_name', ''),
          (SELECT c.id FROM external_accounting_contacts c WHERE c.company_realm_id = NEW.company_realm_id AND c.qb_contact_id = NULLIF(elem.item->>'entity_qb_id', '') LIMIT 1),
          NULLIF(elem.item->>'entity_qb_id', ''),
          NULLIF(elem.item->>'entity_name', ''),
          (SELECT cl.id FROM external_accounting_classes cl WHERE cl.company_realm_id = NEW.company_realm_id AND cl.qb_class_id = NULLIF(elem.item->>'class_qb_id', '') LIMIT 1),
          NULLIF(elem.item->>'class_qb_id', ''),
          NULLIF(elem.item->>'class_name', ''),
          (SELECT l.id FROM external_accounting_locations l WHERE l.company_realm_id = NEW.company_realm_id AND l.qb_location_id = NULLIF(elem.item->>'department_qb_id', '') LIMIT 1),
          NULLIF(elem.item->>'department_qb_id', ''),
          NULLIF(elem.item->>'department_name', ''),
          NULLIF(elem.item->>'description', ''),
          CASE WHEN (elem.item->>'qty') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (elem.item->>'qty')::numeric(14,4) ELSE 1 END,
          CASE WHEN (elem.item->>'unit_price') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (elem.item->>'unit_price')::numeric(14,4) ELSE 0 END,
          CASE WHEN (elem.item->>'amount') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (elem.item->>'amount')::numeric(14,2) ELSE 0 END,
          NULLIF(elem.item->>'posting_type', '')
        FROM jsonb_array_elements(NEW.line_items) WITH ORDINALITY AS elem(item, ord);
      END IF;

      DELETE FROM external_accounting_linked_transactions WHERE source_transaction_id = NEW.id;

      INSERT INTO external_accounting_linked_transactions (
        company_realm_id,
        source_transaction_id,
        source_qb_txn_id,
        source_txn_type,
        target_transaction_id,
        target_qb_txn_id,
        target_txn_type,
        link_scope,
        applied_amount
      )
      SELECT
        NEW.company_realm_id,
        NEW.id,
        NEW.qb_txn_id,
        NEW.txn_type,
        (
          SELECT tgt.id
          FROM external_accounting_transactions tgt
          WHERE tgt.company_realm_id = NEW.company_realm_id
            AND tgt.qb_txn_id = edges.target_qb_txn_id
          ORDER BY CASE WHEN tgt.txn_type = edges.target_txn_type THEN 0 ELSE 1 END
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
          lt->>'TxnId' AS target_qb_txn_id,
          COALESCE(NULLIF(lt->>'TxnType', ''), 'Unknown') AS target_txn_type,
          'line'::text AS link_scope,
          CASE WHEN (ln->>'Amount') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (ln->>'Amount')::numeric(14,2) ELSE 0 END AS applied_amount
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(NEW.raw_data->'Line') = 'array' THEN NEW.raw_data->'Line' ELSE '[]'::jsonb END
        ) AS ln
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(ln->'LinkedTxn') = 'array' THEN ln->'LinkedTxn' ELSE '[]'::jsonb END
        ) AS lt
        WHERE NULLIF(lt->>'TxnId', '') IS NOT NULL

        UNION ALL

        SELECT
          li->>'linked_txn_id' AS target_qb_txn_id,
          COALESCE(NULLIF(li->>'linked_txn_type', ''), 'Unknown') AS target_txn_type,
          'line'::text AS link_scope,
          CASE WHEN (li->>'amount') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (li->>'amount')::numeric(14,2) ELSE 0 END AS applied_amount
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(NEW.line_items) = 'array' THEN NEW.line_items ELSE '[]'::jsonb END
        ) AS li
        WHERE NULLIF(li->>'linked_txn_id', '') IS NOT NULL
      ) edges
      GROUP BY edges.target_qb_txn_id, edges.target_txn_type, edges.link_scope
      ON CONFLICT (company_realm_id, source_transaction_id, target_qb_txn_id, target_txn_type, link_scope)
      DO UPDATE SET
        applied_amount = EXCLUDED.applied_amount,
        target_transaction_id = COALESCE(EXCLUDED.target_transaction_id, external_accounting_linked_transactions.target_transaction_id);

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_sync_ext_acct_tx_children ON external_accounting_transactions;
    CREATE TRIGGER trg_sync_ext_acct_tx_children
      AFTER INSERT OR UPDATE ON external_accounting_transactions
      FOR EACH ROW
      EXECUTE FUNCTION fn_sync_ext_acct_tx_children();
    `
  )

  await execDdl('Reload PostgREST Schema Cache', "NOTIFY pgrst, 'reload schema';")

  console.log('📊 7. Verifying Relational Counts & Foreign Key Integrity...')
  const stats = await execQuery(`
    SELECT
      (SELECT COUNT(*) FROM external_accounting_transactions) AS total_transactions,
      (SELECT COUNT(*) FROM external_accounting_transactions WHERE account_id IS NOT NULL) AS tx_with_account_fk,
      (SELECT COUNT(*) FROM external_accounting_transactions WHERE contact_id IS NOT NULL) AS tx_with_contact_fk,
      (SELECT COUNT(*) FROM external_accounting_transaction_lines) AS total_normalized_lines,
      (SELECT COUNT(*) FROM external_accounting_transaction_lines WHERE account_id IS NOT NULL) AS lines_with_account_fk,
      (SELECT COUNT(*) FROM external_accounting_transaction_lines WHERE item_id IS NOT NULL) AS lines_with_item_fk,
      (SELECT COUNT(*) FROM external_accounting_linked_transactions) AS total_linked_edges,
      (SELECT COUNT(*) FROM external_accounting_linked_transactions WHERE target_transaction_id IS NOT NULL) AS linked_edges_with_target_uuid
  `)
  console.log('✅ Relational Verification Summary:', JSON.stringify(stats, null, 2))

  const edgeBreakdown = await execQuery(`
    SELECT source_txn_type, target_txn_type, link_scope, COUNT(*) AS edge_count, SUM(applied_amount) AS total_applied
    FROM external_accounting_linked_transactions
    GROUP BY source_txn_type, target_txn_type, link_scope
    ORDER BY edge_count DESC
  `)
  console.log('🔗 LinkedTxn Edge Breakdown:', JSON.stringify(edgeBreakdown, null, 2))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
