-- =============================================================================
-- MIGRATION: Cohesion Replacement - Accounting Tables & Seed Data
-- Run in Supabase Dashboard > SQL Editor
-- URL: https://supabase.com/dashboard/project/ywwwdcvgfculqmcfkihq/sql
-- =============================================================================

-- 1. GL Accounts Catalog
CREATE TABLE IF NOT EXISTS accounting_gl_accounts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  account_number TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('revenue', 'asset', 'liability', 'expense', 'equity', 'cogs')),
  qb_account_id TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(account_number)
);

-- 2. Site Mappings (Store GL Configuration)
CREATE TABLE IF NOT EXISTS accounting_site_mappings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id BIGINT NOT NULL REFERENCES stores(id),
  qb_location TEXT NOT NULL,
  qb_class TEXT NOT NULL,
  bank_account_number TEXT NOT NULL,
  bank_account_qb_id TEXT,
  sales_dine_in_account TEXT DEFAULT '40050',
  sales_uber_account TEXT DEFAULT '40060',
  sales_doordash_account TEXT DEFAULT '40062',
  sales_grubhub_account TEXT DEFAULT '40063',
  sales_tax_account TEXT DEFAULT '24001',
  ar_uber_account TEXT DEFAULT '12050',
  ar_doordash_account TEXT DEFAULT '12053',
  ar_grubhub_account TEXT DEFAULT '12054',
  ar_postmates_account TEXT DEFAULT '12051',
  cc_fees_account TEXT DEFAULT '51030',
  undeposited_funds_account TEXT DEFAULT '13200',
  cash_over_short_account TEXT DEFAULT '51050',
  gift_card_account TEXT DEFAULT '20500',
  open_orders_account TEXT DEFAULT '12049',
  cash_on_hand_account TEXT DEFAULT '12100',
  tips_account TEXT DEFAULT '12100',
  cogs_account TEXT DEFAULT '50006',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id)
);

-- 3. Sales Packets (Daily Journal Entry Per Store)
CREATE TABLE IF NOT EXISTS accounting_sales_packets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id BIGINT NOT NULL REFERENCES stores(id),
  business_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'reviewed', 'published', 'rejected')),
  dine_in_sales NUMERIC(12,2) DEFAULT 0,
  togo_sales NUMERIC(12,2) DEFAULT 0,
  uber_delivery_sales NUMERIC(12,2) DEFAULT 0,
  uber_takeout_sales NUMERIC(12,2) DEFAULT 0,
  doordash_delivery_sales NUMERIC(12,2) DEFAULT 0,
  doordash_takeout_sales NUMERIC(12,2) DEFAULT 0,
  grubhub_sales NUMERIC(12,2) DEFAULT 0,
  gross_sales NUMERIC(12,2) DEFAULT 0,
  net_sales NUMERIC(12,2) DEFAULT 0,
  total_discounts NUMERIC(12,2) DEFAULT 0,
  sales_tax NUMERIC(12,2) DEFAULT 0,
  marketplace_facilitator_tax NUMERIC(12,2) DEFAULT 0,
  facilitator_tax_paid NUMERIC(12,2) DEFAULT 0,
  total_taxes NUMERIC(12,2) DEFAULT 0,
  total_credit_cards_gross NUMERIC(12,2) DEFAULT 0,
  credit_card_deposit NUMERIC(12,2) DEFAULT 0,
  credit_card_fees NUMERIC(12,2) DEFAULT 0,
  uber_payment NUMERIC(12,2) DEFAULT 0,
  doordash_payment NUMERIC(12,2) DEFAULT 0,
  grubhub_payment NUMERIC(12,2) DEFAULT 0,
  ebt_amount NUMERIC(12,2) DEFAULT 0,
  expected_cash NUMERIC(12,2) DEFAULT 0,
  cash_deposit NUMERIC(12,2) DEFAULT 0,
  cash_over_short NUMERIC(12,2) DEFAULT 0,
  journal_total_debits NUMERIC(12,2) DEFAULT 0,
  journal_total_credits NUMERIC(12,2) DEFAULT 0,
  journal_lines JSONB DEFAULT '[]'::jsonb,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  published_by UUID,
  published_at TIMESTAMPTZ,
  qb_journal_entry_id TEXT,
  qb_doc_number TEXT,
  qb_sync_response JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, business_date)
);

-- 4. Sync Logs
CREATE TABLE IF NOT EXISTS accounting_sync_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  packet_id UUID REFERENCES accounting_sales_packets(id),
  store_id BIGINT REFERENCES stores(id),
  business_date DATE,
  action TEXT NOT NULL CHECK (action IN ('generate', 'recalculate', 'review', 'publish', 'reject', 'reopen')),
  performed_by UUID,
  details JSONB,
  qb_response JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Indexes
CREATE INDEX IF NOT EXISTS idx_acct_packets_store_date ON accounting_sales_packets(store_id, business_date);
CREATE INDEX IF NOT EXISTS idx_acct_packets_status ON accounting_sales_packets(status);
CREATE INDEX IF NOT EXISTS idx_acct_packets_bdate ON accounting_sales_packets(business_date);
CREATE INDEX IF NOT EXISTS idx_acct_sync_logs_packet ON accounting_sync_logs(packet_id);
CREATE INDEX IF NOT EXISTS idx_acct_sync_logs_date ON accounting_sync_logs(business_date);

-- 6. Row Level Security (RLS)
ALTER TABLE accounting_gl_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_site_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_sales_packets ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_sync_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "accounting_gl_accounts_all" ON accounting_gl_accounts;
CREATE POLICY "accounting_gl_accounts_all" ON accounting_gl_accounts FOR ALL USING (true);

DROP POLICY IF EXISTS "accounting_site_mappings_all" ON accounting_site_mappings;
CREATE POLICY "accounting_site_mappings_all" ON accounting_site_mappings FOR ALL USING (true);

DROP POLICY IF EXISTS "accounting_sales_packets_all" ON accounting_sales_packets;
CREATE POLICY "accounting_sales_packets_all" ON accounting_sales_packets FOR ALL USING (true);

DROP POLICY IF EXISTS "accounting_sync_logs_all" ON accounting_sync_logs;
CREATE POLICY "accounting_sync_logs_all" ON accounting_sync_logs FOR ALL USING (true);

-- 7. Seed GL Accounts
INSERT INTO accounting_gl_accounts (account_number, account_name, account_type, qb_account_id) VALUES
  ('40050', 'Sales', 'revenue', '140985'),
  ('40060', 'Sales - Uber Eats', 'revenue', NULL),
  ('40062', 'Sales - DoorDash', 'revenue', NULL),
  ('40063', 'Sales - GrubHub', 'revenue', NULL),
  ('24001', 'Sales Tax Payable', 'liability', NULL),
  ('12050', 'Receivables Due from Uber Eats', 'asset', '140973'),
  ('12053', 'Receivables Due from DoorDash', 'asset', '140970'),
  ('12054', 'Receivables Due from GrubHub', 'asset', '140971'),
  ('12051', 'Receivables Due from Postmates', 'asset', '140972'),
  ('12049', 'Open Orders Receivables', 'asset', '141862'),
  ('12100', 'Cash on Hand', 'asset', '140800'),
  ('10000', 'Azusa', 'asset', '140790'),
  ('10001', 'Bell', 'asset', NULL),
  ('10002', 'Broadway LA', 'asset', NULL),
  ('10003', 'Hollywood', 'asset', NULL),
  ('10004', 'Lynwood', 'asset', NULL),
  ('10005', 'Downey', 'asset', NULL),
  ('10006', 'Huntington Park', 'asset', NULL),
  ('10007', 'Santa Ana', 'asset', NULL),
  ('10009', 'South Gate', 'asset', NULL),
  ('10012', 'West Covina', 'asset', NULL),
  ('10013', 'La Puente', 'asset', NULL),
  ('10014', 'Norwalk', 'asset', NULL),
  ('10015', 'Slauson', 'asset', NULL),
  ('10017', 'Rialto', 'asset', NULL),
  ('51030', 'Bank Merchant Fees', 'expense', '140792'),
  ('51050', 'Cash Over/(Short)', 'expense', '140801'),
  ('50006', 'Materials and Supplies', 'cogs', '140812'),
  ('20500', 'Gift Cards Payable', 'liability', '140861'),
  ('13200', 'Undeposited Funds', 'asset', '141023')
ON CONFLICT (account_number) DO UPDATE SET
  account_name = EXCLUDED.account_name,
  account_type = EXCLUDED.account_type;

-- 8. Seed Site Mappings from existing stores
INSERT INTO accounting_site_mappings (store_id, qb_location, qb_class, bank_account_number)
SELECT 
  s.id,
  TRIM(REPLACE(REPLACE(s.name, 'Tacos Gavilan - ', ''), 'Tacos Gavilan ', '')),
  TRIM(REPLACE(REPLACE(s.name, 'Tacos Gavilan - ', ''), 'Tacos Gavilan ', '')),
  CASE 
    WHEN LOWER(s.name) LIKE '%azusa%' THEN '10000'
    WHEN LOWER(s.name) LIKE '%bell%' THEN '10001'
    WHEN LOWER(s.name) LIKE '%broadway%' THEN '10002'
    WHEN LOWER(s.name) LIKE '%central%' THEN '10002'
    WHEN LOWER(s.name) LIKE '%hollywood%' THEN '10003'
    WHEN LOWER(s.name) LIKE '%lynwood%' THEN '10004'
    WHEN LOWER(s.name) LIKE '%downey%' THEN '10005'
    WHEN LOWER(s.name) LIKE '%huntington%' THEN '10006'
    WHEN LOWER(s.name) LIKE '%santa ana%' THEN '10007'
    WHEN LOWER(s.name) LIKE '%south gate%' THEN '10009'
    WHEN LOWER(s.name) LIKE '%west covina%' THEN '10012'
    WHEN LOWER(s.name) LIKE '%la puente%' THEN '10013'
    WHEN LOWER(s.name) LIKE '%norwalk%' THEN '10014'
    WHEN LOWER(s.name) LIKE '%slauson%' THEN '10015'
    WHEN LOWER(s.name) LIKE '%rialto%' THEN '10017'
    ELSE '10000'
  END
FROM stores s
WHERE s.is_active = true
ON CONFLICT (store_id) DO UPDATE SET
  qb_location = EXCLUDED.qb_location,
  qb_class = EXCLUDED.qb_class,
  bank_account_number = EXCLUDED.bank_account_number;
