-- =============================================================================
-- MIGRATION: EXACT QBO RELATIONAL SCHEMA, FOREIGN KEYS, NORMALIZED LINE ITEMS,
-- LINKED TRANSACTIONS GRAPH (`LinkedTxn`), NOTES/TASKS, EMAIL LOG & TRIGGERS
-- =============================================================================

-- 1. Self-Referencing & Cross-Entity UUID Foreign Keys on Master Tables
ALTER TABLE external_accounting_accounts
  ADD COLUMN IF NOT EXISTS parent_account_id UUID REFERENCES external_accounting_accounts(id) ON DELETE SET NULL;

ALTER TABLE external_accounting_contacts
  ADD COLUMN IF NOT EXISTS default_term_id UUID REFERENCES external_accounting_terms(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS default_payment_method_id UUID REFERENCES external_accounting_payment_methods(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS default_expense_account_id UUID REFERENCES external_accounting_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS late_fee_policy JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE external_accounting_items
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES external_accounting_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS income_account_id UUID REFERENCES external_accounting_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS expense_account_id UUID REFERENCES external_accounting_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS asset_account_id UUID REFERENCES external_accounting_accounts(id) ON DELETE SET NULL;

ALTER TABLE external_accounting_transactions
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES external_accounting_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS to_account_id UUID REFERENCES external_accounting_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES external_accounting_contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES external_accounting_locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS class_id UUID REFERENCES external_accounting_classes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS term_id UUID REFERENCES external_accounting_terms(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_method_id UUID REFERENCES external_accounting_payment_methods(id) ON DELETE SET NULL;

ALTER TABLE external_accounting_attachments
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES external_accounting_contacts(id) ON DELETE SET NULL;

ALTER TABLE external_accounting_recurring
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES external_accounting_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES external_accounting_contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES external_accounting_locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS class_id UUID REFERENCES external_accounting_classes(id) ON DELETE SET NULL;

ALTER TABLE external_accounting_reconciliations
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES external_accounting_accounts(id) ON DELETE CASCADE;

ALTER TABLE external_accounting_bank_rules
  ADD COLUMN IF NOT EXISTS target_account_id UUID REFERENCES external_accounting_accounts(id) ON DELETE CASCADE;

ALTER TABLE external_accounting_budgets
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES external_accounting_accounts(id) ON DELETE CASCADE;

-- 2. Normalized Transaction Line Items Table (`external_accounting_transaction_lines`)
CREATE TABLE IF NOT EXISTS external_accounting_transaction_lines (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  transaction_id UUID NOT NULL REFERENCES external_accounting_transactions(id) ON DELETE CASCADE,
  company_realm_id TEXT NOT NULL REFERENCES external_accounting_companies(realm_id) ON DELETE CASCADE,
  qb_txn_id TEXT NOT NULL,
  txn_type TEXT NOT NULL,
  txn_date DATE NOT NULL,
  line_num INTEGER NOT NULL DEFAULT 1,
  qb_line_id TEXT,
  detail_type TEXT,
  account_id UUID REFERENCES external_accounting_accounts(id) ON DELETE SET NULL,
  account_qb_id TEXT,
  account_name TEXT,
  item_id UUID REFERENCES external_accounting_items(id) ON DELETE SET NULL,
  item_qb_id TEXT,
  item_name TEXT,
  contact_id UUID REFERENCES external_accounting_contacts(id) ON DELETE SET NULL,
  entity_qb_id TEXT,
  entity_name TEXT,
  class_id UUID REFERENCES external_accounting_classes(id) ON DELETE SET NULL,
  class_qb_id TEXT,
  class_name TEXT,
  location_id UUID REFERENCES external_accounting_locations(id) ON DELETE SET NULL,
  department_qb_id TEXT,
  department_name TEXT,
  description TEXT,
  qty NUMERIC(14,4) DEFAULT 1,
  unit_price NUMERIC(14,4) DEFAULT 0,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  posting_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(transaction_id, line_num)
);

-- 3. Normalized Linked Transactions Junction Table (`external_accounting_linked_transactions`)
CREATE TABLE IF NOT EXISTS external_accounting_linked_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_realm_id TEXT NOT NULL REFERENCES external_accounting_companies(realm_id) ON DELETE CASCADE,
  source_transaction_id UUID NOT NULL REFERENCES external_accounting_transactions(id) ON DELETE CASCADE,
  source_qb_txn_id TEXT NOT NULL,
  source_txn_type TEXT NOT NULL,
  target_transaction_id UUID REFERENCES external_accounting_transactions(id) ON DELETE CASCADE,
  target_qb_txn_id TEXT NOT NULL,
  target_txn_type TEXT NOT NULL,
  link_scope TEXT NOT NULL DEFAULT 'line',
  applied_amount NUMERIC(14,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_realm_id, source_transaction_id, target_qb_txn_id, target_txn_type, link_scope)
);

-- 4. Customer / Tenant / Vendor Notes & Tasks Table (`external_accounting_notes_tasks`)
CREATE TABLE IF NOT EXISTS external_accounting_notes_tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_realm_id TEXT NOT NULL REFERENCES external_accounting_companies(realm_id) ON DELETE CASCADE,
  contact_id UUID REFERENCES external_accounting_contacts(id) ON DELETE CASCADE,
  qb_contact_id TEXT,
  contact_name TEXT,
  record_type TEXT NOT NULL DEFAULT 'Note' CHECK (record_type IN ('Note', 'Task', 'Activity')),
  title TEXT NOT NULL,
  content TEXT,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Completed', 'Pinned')),
  is_pinned BOOLEAN DEFAULT false,
  created_by TEXT DEFAULT 'Raquel Accounting',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Official Document & Statement Email Delivery Log (`external_accounting_email_log`)
CREATE TABLE IF NOT EXISTS external_accounting_email_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_realm_id TEXT NOT NULL REFERENCES external_accounting_companies(realm_id) ON DELETE CASCADE,
  contact_id UUID REFERENCES external_accounting_contacts(id) ON DELETE SET NULL,
  transaction_id UUID REFERENCES external_accounting_transactions(id) ON DELETE SET NULL,
  doc_type TEXT NOT NULL,
  doc_number TEXT,
  to_email TEXT NOT NULL,
  cc_email TEXT,
  subject TEXT NOT NULL,
  amount NUMERIC(14,2) DEFAULT 0,
  pdf_file_name TEXT,
  message_id TEXT,
  status TEXT NOT NULL DEFAULT 'Sent',
  sent_by TEXT DEFAULT 'Raquel Accounting',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Relational Performance Indexes
CREATE INDEX IF NOT EXISTS idx_ext_acct_tx_account_id ON external_accounting_transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_ext_acct_tx_to_account_id ON external_accounting_transactions(to_account_id);
CREATE INDEX IF NOT EXISTS idx_ext_acct_tx_contact_id ON external_accounting_transactions(contact_id);
CREATE INDEX IF NOT EXISTS idx_ext_acct_tx_location_id ON external_accounting_transactions(location_id);
CREATE INDEX IF NOT EXISTS idx_ext_acct_tx_class_id ON external_accounting_transactions(class_id);
CREATE INDEX IF NOT EXISTS idx_ext_acct_tx_term_id ON external_accounting_transactions(term_id);
CREATE INDEX IF NOT EXISTS idx_ext_acct_tx_pm_id ON external_accounting_transactions(payment_method_id);
CREATE INDEX IF NOT EXISTS idx_ext_acct_tx_lines_txn ON external_accounting_transaction_lines(transaction_id);
CREATE INDEX IF NOT EXISTS idx_ext_acct_tx_lines_comp_acct ON external_accounting_transaction_lines(company_realm_id, account_id);
CREATE INDEX IF NOT EXISTS idx_ext_acct_tx_lines_comp_item ON external_accounting_transaction_lines(company_realm_id, item_id);
CREATE INDEX IF NOT EXISTS idx_ext_acct_linked_src ON external_accounting_linked_transactions(source_transaction_id);
CREATE INDEX IF NOT EXISTS idx_ext_acct_linked_tgt ON external_accounting_linked_transactions(target_transaction_id);
CREATE INDEX IF NOT EXISTS idx_ext_acct_linked_comp_tgt_qb ON external_accounting_linked_transactions(company_realm_id, target_qb_txn_id);
CREATE INDEX IF NOT EXISTS idx_ext_acct_notes_tasks_contact ON external_accounting_notes_tasks(company_realm_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_ext_acct_email_log_comp ON external_accounting_email_log(company_realm_id, created_at DESC);

-- 7. Row Level Security Policies
ALTER TABLE external_accounting_transaction_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_accounting_linked_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_accounting_notes_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_accounting_email_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "external_accounting_transaction_lines_all" ON external_accounting_transaction_lines;
CREATE POLICY "external_accounting_transaction_lines_all" ON external_accounting_transaction_lines FOR ALL USING (true);

DROP POLICY IF EXISTS "external_accounting_linked_transactions_all" ON external_accounting_linked_transactions;
CREATE POLICY "external_accounting_linked_transactions_all" ON external_accounting_linked_transactions FOR ALL USING (true);

DROP POLICY IF EXISTS "external_accounting_notes_tasks_all" ON external_accounting_notes_tasks;
CREATE POLICY "external_accounting_notes_tasks_all" ON external_accounting_notes_tasks FOR ALL USING (true);

DROP POLICY IF EXISTS "external_accounting_email_log_all" ON external_accounting_email_log;
CREATE POLICY "external_accounting_email_log_all" ON external_accounting_email_log FOR ALL USING (true);
