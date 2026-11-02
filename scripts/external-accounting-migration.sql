-- =============================================================================
-- MIGRATION: CONTABILIDAD EXTERNA (Raquel Velazquez - 8 Mini Empresas Intuit QBO)
-- =============================================================================

-- 1. Empresas / Razones Sociales (Companies)
CREATE TABLE IF NOT EXISTS external_accounting_companies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  realm_id TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  company_name TEXT NOT NULL,
  legal_name TEXT,
  start_date DATE,
  email TEXT,
  phone TEXT,
  address JSONB DEFAULT '{}'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Catálogo de Cuentas (Chart of Accounts)
CREATE TABLE IF NOT EXISTS external_accounting_accounts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_realm_id TEXT NOT NULL REFERENCES external_accounting_companies(realm_id) ON DELETE CASCADE,
  qb_account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  fully_qualified_name TEXT,
  acct_num TEXT,
  classification TEXT,
  account_type TEXT NOT NULL,
  account_sub_type TEXT,
  current_balance NUMERIC(14,2) DEFAULT 0,
  initial_qbo_balance NUMERIC(14,2) DEFAULT 0,
  is_sub_account BOOLEAN DEFAULT false,
  parent_qb_id TEXT,
  is_active BOOLEAN DEFAULT true,
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_realm_id, qb_account_id)
);

-- 3. Proveedores y Clientes (Contacts: Vendors & Customers)
CREATE TABLE IF NOT EXISTS external_accounting_contacts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_realm_id TEXT NOT NULL REFERENCES external_accounting_companies(realm_id) ON DELETE CASCADE,
  contact_type TEXT NOT NULL CHECK (contact_type IN ('Vendor', 'Customer', 'Employee')),
  qb_contact_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  company_name TEXT,
  given_name TEXT,
  family_name TEXT,
  print_on_check_name TEXT,
  email TEXT,
  phone TEXT,
  address JSONB DEFAULT '{}'::jsonb,
  tax_identifier TEXT,
  vendor_1099 BOOLEAN DEFAULT false,
  acct_num TEXT,
  balance NUMERIC(14,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_realm_id, contact_type, qb_contact_id)
);

-- 4. Transacciones (Cheques, Depósitos, Gastos, Pólizas, Transferencias, Bills, Invoices, Pagos)
CREATE TABLE IF NOT EXISTS external_accounting_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_realm_id TEXT NOT NULL REFERENCES external_accounting_companies(realm_id) ON DELETE CASCADE,
  txn_type TEXT NOT NULL,
  qb_entity_type TEXT NOT NULL,
  qb_txn_id TEXT NOT NULL,
  txn_date DATE NOT NULL,
  due_date DATE,
  doc_number TEXT,
  payment_type TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('IN', 'OUT', 'TRANSFER', 'JOURNAL', 'ACCRUAL')),
  account_qb_id TEXT,
  account_name TEXT,
  to_account_qb_id TEXT,
  to_account_name TEXT,
  entity_qb_id TEXT,
  entity_name TEXT,
  entity_type TEXT,
  department_qb_id TEXT,
  department_name TEXT,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  open_balance NUMERIC(14,2) DEFAULT 0,
  memo TEXT,
  category_summary TEXT,
  print_status TEXT DEFAULT 'NotSet',
  cleared_status TEXT DEFAULT 'Cleared',
  is_voided BOOLEAN DEFAULT false,
  line_items JSONB DEFAULT '[]'::jsonb,
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_realm_id, qb_entity_type, qb_txn_id)
);

-- 5. Transacciones Recurrentes (Recurring Transactions)
CREATE TABLE IF NOT EXISTS external_accounting_recurring (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_realm_id TEXT NOT NULL REFERENCES external_accounting_companies(realm_id) ON DELETE CASCADE,
  qb_recurring_id TEXT NOT NULL,
  template_name TEXT NOT NULL,
  recur_type TEXT NOT NULL DEFAULT 'Automated',
  txn_type TEXT NOT NULL,
  interval_type TEXT,
  num_interval INTEGER DEFAULT 1,
  day_of_week TEXT,
  day_of_month INTEGER,
  previous_date DATE,
  next_date DATE,
  start_date DATE,
  account_qb_id TEXT,
  account_name TEXT,
  entity_qb_id TEXT,
  entity_name TEXT,
  department_name TEXT,
  amount NUMERIC(14,2) DEFAULT 0,
  memo TEXT,
  line_items JSONB DEFAULT '[]'::jsonb,
  raw_data JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_realm_id, qb_recurring_id)
);

-- 6. Archivo de Reportes Oficiales QBO (Reports Archive)
CREATE TABLE IF NOT EXISTS external_accounting_reports_archive (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_realm_id TEXT NOT NULL REFERENCES external_accounting_companies(realm_id) ON DELETE CASCADE,
  report_key TEXT NOT NULL,
  report_title TEXT,
  accounting_method TEXT,
  start_date TEXT,
  end_date TEXT,
  report_data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_realm_id, report_key)
);

-- Indexes for fast filtering & reporting
CREATE INDEX IF NOT EXISTS idx_ext_acct_accounts_comp ON external_accounting_accounts(company_realm_id, account_type);
CREATE INDEX IF NOT EXISTS idx_ext_acct_contacts_comp ON external_accounting_contacts(company_realm_id, contact_type);
CREATE INDEX IF NOT EXISTS idx_ext_acct_txns_comp_date ON external_accounting_transactions(company_realm_id, txn_date DESC);
CREATE INDEX IF NOT EXISTS idx_ext_acct_txns_comp_type ON external_accounting_transactions(company_realm_id, txn_type);
CREATE INDEX IF NOT EXISTS idx_ext_acct_txns_comp_acct ON external_accounting_transactions(company_realm_id, account_qb_id);
CREATE INDEX IF NOT EXISTS idx_ext_acct_txns_comp_dir ON external_accounting_transactions(company_realm_id, direction);
CREATE INDEX IF NOT EXISTS idx_ext_acct_recurring_comp ON external_accounting_recurring(company_realm_id);
CREATE INDEX IF NOT EXISTS idx_ext_acct_reports_comp ON external_accounting_reports_archive(company_realm_id, report_key);

-- Row Level Security (RLS)
ALTER TABLE external_accounting_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_accounting_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_accounting_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_accounting_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_accounting_recurring ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_accounting_reports_archive ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "external_accounting_companies_all" ON external_accounting_companies;
CREATE POLICY "external_accounting_companies_all" ON external_accounting_companies FOR ALL USING (true);

DROP POLICY IF EXISTS "external_accounting_accounts_all" ON external_accounting_accounts;
CREATE POLICY "external_accounting_accounts_all" ON external_accounting_accounts FOR ALL USING (true);

DROP POLICY IF EXISTS "external_accounting_contacts_all" ON external_accounting_contacts;
CREATE POLICY "external_accounting_contacts_all" ON external_accounting_contacts FOR ALL USING (true);

DROP POLICY IF EXISTS "external_accounting_transactions_all" ON external_accounting_transactions;
CREATE POLICY "external_accounting_transactions_all" ON external_accounting_transactions FOR ALL USING (true);

DROP POLICY IF EXISTS "external_accounting_recurring_all" ON external_accounting_recurring;
CREATE POLICY "external_accounting_recurring_all" ON external_accounting_recurring FOR ALL USING (true);

DROP POLICY IF EXISTS "external_accounting_reports_archive_all" ON external_accounting_reports_archive;
CREATE POLICY "external_accounting_reports_archive_all" ON external_accounting_reports_archive FOR ALL USING (true);

-- 7. Conciliaciones Bancarias Oficiales (Bank Reconciliations - Gear Menu -> Reconcile)
CREATE TABLE IF NOT EXISTS external_accounting_reconciliations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_realm_id TEXT NOT NULL REFERENCES external_accounting_companies(realm_id) ON DELETE CASCADE,
  account_qb_id TEXT NOT NULL,
  account_name TEXT NOT NULL,
  statement_ending_date DATE NOT NULL,
  beginning_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  ending_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  cleared_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  difference NUMERIC(14,2) NOT NULL DEFAULT 0,
  payments_count INTEGER NOT NULL DEFAULT 0,
  payments_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  deposits_count INTEGER NOT NULL DEFAULT 0,
  deposits_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  service_charge NUMERIC(14,2) DEFAULT 0,
  interest_earned NUMERIC(14,2) DEFAULT 0,
  reconciled_txn_ids JSONB DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Completed', 'Undone')),
  notes TEXT,
  reconciled_by TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Bitácora de Auditoría Contable (Audit Log - Gear Menu -> Audit Log)
CREATE TABLE IF NOT EXISTS external_accounting_audit_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_realm_id TEXT NOT NULL REFERENCES external_accounting_companies(realm_id) ON DELETE CASCADE,
  user_id TEXT,
  user_name TEXT NOT NULL,
  user_email TEXT,
  action_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  doc_number TEXT,
  amount NUMERIC(14,2),
  summary TEXT NOT NULL,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Reglas Bancarias y Categorización Automática (Bank Rules - Gear Menu -> Rules)
CREATE TABLE IF NOT EXISTS external_accounting_bank_rules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_realm_id TEXT NOT NULL REFERENCES external_accounting_companies(realm_id) ON DELETE CASCADE,
  rule_name TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'OUT' CHECK (direction IN ('IN', 'OUT', 'ALL')),
  match_field TEXT NOT NULL DEFAULT 'ANY' CHECK (match_field IN ('ANY', 'ENTITY', 'MEMO', 'DOC_NUMBER')),
  match_text TEXT NOT NULL,
  target_account_qb_id TEXT NOT NULL,
  target_account_name TEXT NOT NULL,
  target_entity_name TEXT,
  target_txn_type TEXT DEFAULT 'Expense',
  auto_apply BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 100,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. Presupuestos Anuales y Mensuales (Budgets - Gear Menu -> Budgeting)
CREATE TABLE IF NOT EXISTS external_accounting_budgets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_realm_id TEXT NOT NULL REFERENCES external_accounting_companies(realm_id) ON DELETE CASCADE,
  fiscal_year INTEGER NOT NULL DEFAULT 2026,
  account_qb_id TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_type TEXT NOT NULL,
  monthly_amounts JSONB DEFAULT '{}'::jsonb,
  annual_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_realm_id, fiscal_year, account_qb_id)
);

CREATE INDEX IF NOT EXISTS idx_ext_acct_reconcile_comp ON external_accounting_reconciliations(company_realm_id, account_qb_id, statement_ending_date DESC);
CREATE INDEX IF NOT EXISTS idx_ext_acct_audit_comp ON external_accounting_audit_log(company_realm_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ext_acct_rules_comp ON external_accounting_bank_rules(company_realm_id, priority ASC);
CREATE INDEX IF NOT EXISTS idx_ext_acct_budgets_comp ON external_accounting_budgets(company_realm_id, fiscal_year);

ALTER TABLE external_accounting_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_accounting_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_accounting_bank_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_accounting_budgets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "external_accounting_reconciliations_all" ON external_accounting_reconciliations;
CREATE POLICY "external_accounting_reconciliations_all" ON external_accounting_reconciliations FOR ALL USING (true);

DROP POLICY IF EXISTS "external_accounting_audit_log_all" ON external_accounting_audit_log;
CREATE POLICY "external_accounting_audit_log_all" ON external_accounting_audit_log FOR ALL USING (true);

DROP POLICY IF EXISTS "external_accounting_bank_rules_all" ON external_accounting_bank_rules;
CREATE POLICY "external_accounting_bank_rules_all" ON external_accounting_bank_rules FOR ALL USING (true);

DROP POLICY IF EXISTS "external_accounting_budgets_all" ON external_accounting_budgets;
CREATE POLICY "external_accounting_budgets_all" ON external_accounting_budgets FOR ALL USING (true);

-- =============================================================================
-- 11. HUB COMPLETO DE LISTS DE QUICKBOOKS ONLINE (/app/lists — 9 Tablas Maestras Adicionales)
-- =============================================================================

-- 11a. Categorías de Productos y Servicios (Product Categories - Item Type = 'Category')
CREATE TABLE IF NOT EXISTS external_accounting_categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_realm_id TEXT NOT NULL REFERENCES external_accounting_companies(realm_id) ON DELETE CASCADE,
  qb_category_id TEXT NOT NULL,
  name TEXT NOT NULL,
  fully_qualified_name TEXT,
  parent_qb_id TEXT,
  parent_name TEXT,
  is_sub_category BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_realm_id, qb_category_id)
);

-- 11b. Productos y Servicios (Products and Services - Item: Service, NonInventory, Inventory, Bundle)
-- Conectado directamente a Chart of Accounts (income_account_qb_id, expense_account_qb_id, asset_account_qb_id) y Product Categories
CREATE TABLE IF NOT EXISTS external_accounting_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_realm_id TEXT NOT NULL REFERENCES external_accounting_companies(realm_id) ON DELETE CASCADE,
  qb_item_id TEXT NOT NULL,
  name TEXT NOT NULL,
  fully_qualified_name TEXT,
  sku TEXT,
  item_type TEXT NOT NULL DEFAULT 'Service',
  category_qb_id TEXT,
  category_name TEXT,
  is_sub_item BOOLEAN DEFAULT false,
  description TEXT,
  unit_price NUMERIC(14,2) DEFAULT 0,
  purchase_desc TEXT,
  purchase_cost NUMERIC(14,2) DEFAULT 0,
  income_account_qb_id TEXT,
  income_account_name TEXT,
  expense_account_qb_id TEXT,
  expense_account_name TEXT,
  asset_account_qb_id TEXT,
  asset_account_name TEXT,
  taxable BOOLEAN DEFAULT false,
  track_qty_on_hand BOOLEAN DEFAULT false,
  qty_on_hand NUMERIC(14,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_realm_id, qb_item_id)
);

-- 11c. Ubicaciones / Propiedades / Departamentos (Locations / Properties - QBO Department)
CREATE TABLE IF NOT EXISTS external_accounting_locations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_realm_id TEXT NOT NULL REFERENCES external_accounting_companies(realm_id) ON DELETE CASCADE,
  qb_location_id TEXT NOT NULL,
  name TEXT NOT NULL,
  fully_qualified_name TEXT,
  parent_qb_id TEXT,
  parent_name TEXT,
  is_sub_location BOOLEAN DEFAULT false,
  address TEXT,
  manager_name TEXT,
  is_active BOOLEAN DEFAULT true,
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_realm_id, qb_location_id)
);

-- 11d. Clases Contables / Class Codes (Classes - QBO Class)
CREATE TABLE IF NOT EXISTS external_accounting_classes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_realm_id TEXT NOT NULL REFERENCES external_accounting_companies(realm_id) ON DELETE CASCADE,
  qb_class_id TEXT NOT NULL,
  name TEXT NOT NULL,
  fully_qualified_name TEXT,
  class_code TEXT,
  parent_qb_id TEXT,
  parent_name TEXT,
  is_sub_class BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_realm_id, qb_class_id)
);

-- 11e. Métodos de Pago (Payment Methods - QBO PaymentMethod)
CREATE TABLE IF NOT EXISTS external_accounting_payment_methods (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_realm_id TEXT NOT NULL REFERENCES external_accounting_companies(realm_id) ON DELETE CASCADE,
  qb_payment_method_id TEXT NOT NULL,
  name TEXT NOT NULL,
  method_type TEXT NOT NULL DEFAULT 'NON_CREDIT_CARD',
  is_active BOOLEAN DEFAULT true,
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_realm_id, qb_payment_method_id)
);

-- 11f. Condiciones y Plazos de Pago (Terms - QBO Term)
CREATE TABLE IF NOT EXISTS external_accounting_terms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_realm_id TEXT NOT NULL REFERENCES external_accounting_companies(realm_id) ON DELETE CASCADE,
  qb_term_id TEXT NOT NULL,
  name TEXT NOT NULL,
  term_type TEXT NOT NULL DEFAULT 'STANDARD',
  due_days INTEGER DEFAULT 0,
  discount_percent NUMERIC(6,2) DEFAULT 0,
  discount_days INTEGER DEFAULT 0,
  day_of_month_due INTEGER,
  is_active BOOLEAN DEFAULT true,
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_realm_id, qb_term_id)
);

-- 11g. Campos Personalizados (Custom Fields - QBO Preferences CustomField)
CREATE TABLE IF NOT EXISTS external_accounting_custom_fields (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_realm_id TEXT NOT NULL REFERENCES external_accounting_companies(realm_id) ON DELETE CASCADE,
  qb_field_id TEXT NOT NULL,
  name TEXT NOT NULL,
  data_type TEXT NOT NULL DEFAULT 'StringType',
  applies_to_sales BOOLEAN DEFAULT true,
  applies_to_purchase BOOLEAN DEFAULT false,
  print_on_page BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_realm_id, qb_field_id)
);

-- 11h. Archivos Adjuntos (Attachments - QBO Attachable)
CREATE TABLE IF NOT EXISTS external_accounting_attachments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_realm_id TEXT NOT NULL REFERENCES external_accounting_companies(realm_id) ON DELETE CASCADE,
  qb_attachable_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT DEFAULT 'application/pdf',
  size_bytes BIGINT DEFAULT 0,
  file_url TEXT,
  linked_entity_type TEXT DEFAULT 'General',
  linked_entity_id TEXT,
  linked_doc_number TEXT,
  note TEXT,
  uploaded_by TEXT,
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_realm_id, qb_attachable_id)
);

-- 11i. Grupos de Costos (Cost Groups - QBO Cost Groups)
CREATE TABLE IF NOT EXISTS external_accounting_cost_groups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_realm_id TEXT NOT NULL REFERENCES external_accounting_companies(realm_id) ON DELETE CASCADE,
  qb_cost_group_id TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT,
  description TEXT,
  default_account_qb_id TEXT,
  default_account_name TEXT,
  is_active BOOLEAN DEFAULT true,
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_realm_id, qb_cost_group_id)
);

-- Enriquecimiento de columnas relacionales en tablas existentes
ALTER TABLE external_accounting_accounts ADD COLUMN IF NOT EXISTS bank_balance NUMERIC(14,2);
ALTER TABLE external_accounting_accounts ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE external_accounting_transactions ADD COLUMN IF NOT EXISTS class_qb_id TEXT;
ALTER TABLE external_accounting_transactions ADD COLUMN IF NOT EXISTS class_name TEXT;
ALTER TABLE external_accounting_transactions ADD COLUMN IF NOT EXISTS term_qb_id TEXT;
ALTER TABLE external_accounting_transactions ADD COLUMN IF NOT EXISTS term_name TEXT;
ALTER TABLE external_accounting_transactions ADD COLUMN IF NOT EXISTS payment_method_qb_id TEXT;
ALTER TABLE external_accounting_transactions ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}'::jsonb;

ALTER TABLE external_accounting_contacts ADD COLUMN IF NOT EXISTS default_term_qb_id TEXT;
ALTER TABLE external_accounting_contacts ADD COLUMN IF NOT EXISTS default_term_name TEXT;
ALTER TABLE external_accounting_contacts ADD COLUMN IF NOT EXISTS default_payment_method_qb_id TEXT;
ALTER TABLE external_accounting_contacts ADD COLUMN IF NOT EXISTS default_expense_account_qb_id TEXT;

ALTER TABLE external_accounting_recurring ADD COLUMN IF NOT EXISTS class_qb_id TEXT;
ALTER TABLE external_accounting_recurring ADD COLUMN IF NOT EXISTS class_name TEXT;
ALTER TABLE external_accounting_recurring ADD COLUMN IF NOT EXISTS department_qb_id TEXT;

CREATE INDEX IF NOT EXISTS idx_ext_acct_items_comp ON external_accounting_items(company_realm_id, item_type);
CREATE INDEX IF NOT EXISTS idx_ext_acct_categories_comp ON external_accounting_categories(company_realm_id);
CREATE INDEX IF NOT EXISTS idx_ext_acct_locations_comp ON external_accounting_locations(company_realm_id);
CREATE INDEX IF NOT EXISTS idx_ext_acct_classes_comp ON external_accounting_classes(company_realm_id);
CREATE INDEX IF NOT EXISTS idx_ext_acct_paymethods_comp ON external_accounting_payment_methods(company_realm_id);
CREATE INDEX IF NOT EXISTS idx_ext_acct_terms_comp ON external_accounting_terms(company_realm_id);
CREATE INDEX IF NOT EXISTS idx_ext_acct_customfields_comp ON external_accounting_custom_fields(company_realm_id);
CREATE INDEX IF NOT EXISTS idx_ext_acct_attachments_comp ON external_accounting_attachments(company_realm_id);
CREATE INDEX IF NOT EXISTS idx_ext_acct_costgroups_comp ON external_accounting_cost_groups(company_realm_id);

ALTER TABLE external_accounting_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_accounting_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_accounting_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_accounting_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_accounting_payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_accounting_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_accounting_custom_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_accounting_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_accounting_cost_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "external_accounting_categories_all" ON external_accounting_categories;
CREATE POLICY "external_accounting_categories_all" ON external_accounting_categories FOR ALL USING (true);

DROP POLICY IF EXISTS "external_accounting_items_all" ON external_accounting_items;
CREATE POLICY "external_accounting_items_all" ON external_accounting_items FOR ALL USING (true);

DROP POLICY IF EXISTS "external_accounting_locations_all" ON external_accounting_locations;
CREATE POLICY "external_accounting_locations_all" ON external_accounting_locations FOR ALL USING (true);

DROP POLICY IF EXISTS "external_accounting_classes_all" ON external_accounting_classes;
CREATE POLICY "external_accounting_classes_all" ON external_accounting_classes FOR ALL USING (true);

DROP POLICY IF EXISTS "external_accounting_payment_methods_all" ON external_accounting_payment_methods;
CREATE POLICY "external_accounting_payment_methods_all" ON external_accounting_payment_methods FOR ALL USING (true);

DROP POLICY IF EXISTS "external_accounting_terms_all" ON external_accounting_terms;
CREATE POLICY "external_accounting_terms_all" ON external_accounting_terms FOR ALL USING (true);

DROP POLICY IF EXISTS "external_accounting_custom_fields_all" ON external_accounting_custom_fields;
CREATE POLICY "external_accounting_custom_fields_all" ON external_accounting_custom_fields FOR ALL USING (true);

DROP POLICY IF EXISTS "external_accounting_attachments_all" ON external_accounting_attachments;
CREATE POLICY "external_accounting_attachments_all" ON external_accounting_attachments FOR ALL USING (true);

DROP POLICY IF EXISTS "external_accounting_cost_groups_all" ON external_accounting_cost_groups;
CREATE POLICY "external_accounting_cost_groups_all" ON external_accounting_cost_groups FOR ALL USING (true);
