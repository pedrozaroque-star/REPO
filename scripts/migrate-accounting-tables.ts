/**
 * Migration script: Create accounting tables for Cohesion replacement module
 * Run via: npx tsx scripts/migrate-accounting-tables.ts
 */
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function migrate() {
  console.log('=== Creating Accounting Tables (Cohesion Replacement) ===\n')

  // 1. accounting_gl_accounts
  console.log('1/4 Creating accounting_gl_accounts...')
  const { error: e1 } = await supabase.rpc('exec_sql', { query: '' }).maybeSingle()
  // Use raw SQL via supabase rest - we need to use the SQL editor approach
  // Actually, let's create tables one by one using Supabase's approach

  // Since we can't run raw DDL via supabase-js, we'll use fetch to the SQL endpoint
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  const runSQL = async (sql: string, label: string) => {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    })

    if (!res.ok) {
      // Try the pg_net approach or direct SQL
      console.log(`  ⚠️ RPC not available, trying direct approach for: ${label}`)
      return false
    }
    console.log(`  ✅ ${label}`)
    return true
  }

  // Try using the Supabase Management API / SQL endpoint
  const sqlEndpoint = `${supabaseUrl}/rest/v1/`

  // Let's test if tables already exist first
  const { data: existingTest, error: testErr } = await supabase
    .from('accounting_gl_accounts')
    .select('id')
    .limit(1)

  if (!testErr) {
    console.log('⚠️ Tables already exist! Skipping creation.')
    console.log('  If you need to recreate, drop them manually first.')

    // Let's check all tables
    const tables = ['accounting_gl_accounts', 'accounting_site_mappings', 'accounting_sales_packets', 'accounting_sync_logs']
    for (const t of tables) {
      const { error } = await supabase.from(t).select('id').limit(1)
      console.log(`  ${error ? '❌' : '✅'} ${t}`)
    }
    return
  }

  console.log('Tables do not exist yet. Need to create them via Supabase Dashboard SQL Editor.')
  console.log('\nPlease run the following SQL in Supabase Dashboard > SQL Editor:\n')
  console.log(MIGRATION_SQL)
}

const MIGRATION_SQL = `
-- =============================================================================
-- MIGRATION: Cohesion Replacement - Accounting Tables
-- Description: Tables for daily sales journal entries to QuickBooks Online
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

-- 2. Site Mappings (per-store GL configuration)
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

-- 3. Sales Packets (daily journal entry per store)
CREATE TABLE IF NOT EXISTS accounting_sales_packets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id BIGINT NOT NULL REFERENCES stores(id),
  business_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'reviewed', 'published', 'rejected')),
  
  -- Sales breakdown by dining option
  dine_in_sales NUMERIC(12,2) DEFAULT 0,
  togo_sales NUMERIC(12,2) DEFAULT 0,
  uber_delivery_sales NUMERIC(12,2) DEFAULT 0,
  uber_takeout_sales NUMERIC(12,2) DEFAULT 0,
  doordash_delivery_sales NUMERIC(12,2) DEFAULT 0,
  doordash_takeout_sales NUMERIC(12,2) DEFAULT 0,
  grubhub_sales NUMERIC(12,2) DEFAULT 0,
  
  -- Aggregated totals
  gross_sales NUMERIC(12,2) DEFAULT 0,
  net_sales NUMERIC(12,2) DEFAULT 0,
  total_discounts NUMERIC(12,2) DEFAULT 0,
  
  -- Tax breakdown
  sales_tax NUMERIC(12,2) DEFAULT 0,
  marketplace_facilitator_tax NUMERIC(12,2) DEFAULT 0,
  facilitator_tax_paid NUMERIC(12,2) DEFAULT 0,
  total_taxes NUMERIC(12,2) DEFAULT 0,
  
  -- Credit card payments
  total_credit_cards_gross NUMERIC(12,2) DEFAULT 0,
  credit_card_deposit NUMERIC(12,2) DEFAULT 0,
  credit_card_fees NUMERIC(12,2) DEFAULT 0,
  
  -- Third-party payments (gross amounts)
  uber_payment NUMERIC(12,2) DEFAULT 0,
  doordash_payment NUMERIC(12,2) DEFAULT 0,
  grubhub_payment NUMERIC(12,2) DEFAULT 0,
  ebt_amount NUMERIC(12,2) DEFAULT 0,
  
  -- Cash reconciliation
  expected_cash NUMERIC(12,2) DEFAULT 0,
  cash_deposit NUMERIC(12,2) DEFAULT 0,
  cash_over_short NUMERIC(12,2) DEFAULT 0,
  
  -- Journal entry totals
  journal_total_debits NUMERIC(12,2) DEFAULT 0,
  journal_total_credits NUMERIC(12,2) DEFAULT 0,
  journal_lines JSONB DEFAULT '[]'::jsonb,
  
  -- Audit trail
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

-- 4. Sync Logs (audit trail)
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

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_acct_packets_store_date ON accounting_sales_packets(store_id, business_date);
CREATE INDEX IF NOT EXISTS idx_acct_packets_status ON accounting_sales_packets(status);
CREATE INDEX IF NOT EXISTS idx_acct_packets_bdate ON accounting_sales_packets(business_date);
CREATE INDEX IF NOT EXISTS idx_acct_sync_logs_packet ON accounting_sync_logs(packet_id);
CREATE INDEX IF NOT EXISTS idx_acct_sync_logs_date ON accounting_sync_logs(business_date);

-- Enable RLS (with permissive policy for service_role)
ALTER TABLE accounting_gl_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_site_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_sales_packets ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_sync_logs ENABLE ROW LEVEL SECURITY;

-- Policies: allow all for service_role and authenticated
CREATE POLICY "accounting_gl_accounts_all" ON accounting_gl_accounts FOR ALL USING (true);
CREATE POLICY "accounting_site_mappings_all" ON accounting_site_mappings FOR ALL USING (true);
CREATE POLICY "accounting_sales_packets_all" ON accounting_sales_packets FOR ALL USING (true);
CREATE POLICY "accounting_sync_logs_all" ON accounting_sync_logs FOR ALL USING (true);

-- =============================================================================
-- SEED DATA: GL Accounts (from Cohesion extraction)
-- =============================================================================
INSERT INTO accounting_gl_accounts (account_number, account_name, account_type, qb_account_id) VALUES
  -- Revenue accounts
  ('40050', 'Sales', 'revenue', '140985'),
  ('40060', 'Sales - Uber Eats', 'revenue', NULL),
  ('40062', 'Sales - DoorDash', 'revenue', NULL),
  ('40063', 'Sales - GrubHub', 'revenue', NULL),
  -- Tax accounts
  ('24001', 'Sales Tax Payable', 'liability', NULL),
  -- Receivables
  ('12050', 'Receivables Due from Uber Eats', 'asset', '140973'),
  ('12053', 'Receivables Due from DoorDash', 'asset', '140970'),
  ('12054', 'Receivables Due from GrubHub', 'asset', '140971'),
  ('12051', 'Receivables Due from Postmates', 'asset', '140972'),
  ('12049', 'Open Orders Receivables', 'asset', '141862'),
  ('12100', 'Cash on Hand', 'asset', '140800'),
  -- Bank accounts (store-specific ones will be added per store)
  ('10000', 'Azusa', 'asset', '140790'),
  ('10001', 'Bell', 'asset', NULL),
  ('10002', 'Broadway LA', 'asset', NULL),
  ('10003', 'Hollywood', 'asset', NULL),
  ('10004', 'Lynwood', 'asset', NULL),
  ('10007', 'Santa Ana', 'asset', NULL),
  ('10009', 'South Gate', 'asset', NULL),
  ('10012', 'West Covina', 'asset', NULL),
  ('10013', 'La Puente', 'asset', NULL),
  ('10014', 'Norwalk', 'asset', NULL),
  ('10015', 'Slauson', 'asset', NULL),
  ('10017', 'Rialto', 'asset', NULL),
  -- Expense accounts
  ('51030', 'Bank Merchant Fees', 'expense', '140792'),
  ('51050', 'Cash Over/(Short)', 'expense', '140801'),
  ('50006', 'Materials and Supplies', 'cogs', '140812'),
  -- Liability
  ('20500', 'Gift Cards Payable', 'liability', '140861'),
  ('13200', 'Undeposited Funds', 'asset', '141023')
ON CONFLICT (account_number) DO NOTHING;

-- =============================================================================
-- SEED DATA: Site Mappings (15 stores)
-- Bank account assignments based on Cohesion extraction
-- =============================================================================
-- Note: store IDs need to be matched from the stores table
-- This will be done by the seed script after migration
`;

migrate().catch(console.error)
