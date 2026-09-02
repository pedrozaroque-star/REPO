/**
 * Run DDL migration via Supabase's direct PostgreSQL connection
 * Uses the pg library to execute CREATE TABLE statements
 */
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
)

async function main() {
  console.log('=== Checking if accounting tables exist... ===\n')

  // Test each table
  const tables = ['accounting_gl_accounts', 'accounting_site_mappings', 'accounting_sales_packets', 'accounting_sync_logs']
  const results: Record<string, boolean> = {}

  for (const t of tables) {
    const { error } = await supabase.from(t).select('*').limit(1)
    results[t] = !error
    console.log(`${!error ? '✅' : '❌'} ${t}: ${error ? error.message : 'exists'}`)
  }

  const allExist = Object.values(results).every(v => v)
  
  if (!allExist) {
    console.log('\n⚠️ Some tables are missing.')
    console.log('The migration SQL has been written to: scripts/accounting-migration.sql')
    console.log('Please run it in Supabase Dashboard > SQL Editor.\n')
    
    // Write the SQL file
    const fs = await import('fs')
    const sql = getMigrationSQL()
    fs.writeFileSync(path.join(__dirname, 'accounting-migration.sql'), sql, 'utf8')
    console.log(`Written ${sql.length} bytes to accounting-migration.sql`)
    return
  }

  console.log('\n✅ All tables exist! Proceeding to seed...\n')

  // Check GL accounts
  const { data: glAccounts } = await supabase.from('accounting_gl_accounts').select('*')
  console.log(`GL Accounts: ${glAccounts?.length || 0} rows`)

  if (!glAccounts || glAccounts.length === 0) {
    console.log('Seeding GL accounts...')
    await seedGLAccounts()
  }

  // Check site mappings
  const { data: mappings } = await supabase.from('accounting_site_mappings').select('*')
  console.log(`Site Mappings: ${mappings?.length || 0} rows`)

  if (!mappings || mappings.length === 0) {
    console.log('Seeding site mappings...')
    await seedSiteMappings()
  }

  // Final check
  const { data: finalGL } = await supabase.from('accounting_gl_accounts').select('account_number, account_name, account_type').order('account_number')
  const { data: finalMap } = await supabase.from('accounting_site_mappings').select('store_id, qb_location, bank_account_number')
  
  console.log(`\n=== Final State ===`)
  console.log(`GL Accounts: ${finalGL?.length || 0}`)
  finalGL?.forEach(a => console.log(`  ${a.account_number} - ${a.account_name} (${a.account_type})`))
  console.log(`Site Mappings: ${finalMap?.length || 0}`)
  finalMap?.forEach(m => console.log(`  Store ${m.store_id}: ${m.qb_location} → Bank ${m.bank_account_number}`))
}

async function seedGLAccounts() {
  const accounts = [
    { account_number: '40050', account_name: 'Sales', account_type: 'revenue', qb_account_id: '140985' },
    { account_number: '40060', account_name: 'Sales - Uber Eats', account_type: 'revenue', qb_account_id: null },
    { account_number: '40062', account_name: 'Sales - DoorDash', account_type: 'revenue', qb_account_id: null },
    { account_number: '40063', account_name: 'Sales - GrubHub', account_type: 'revenue', qb_account_id: null },
    { account_number: '24001', account_name: 'Sales Tax Payable', account_type: 'liability', qb_account_id: null },
    { account_number: '12050', account_name: 'Receivables Due from Uber Eats', account_type: 'asset', qb_account_id: '140973' },
    { account_number: '12053', account_name: 'Receivables Due from DoorDash', account_type: 'asset', qb_account_id: '140970' },
    { account_number: '12054', account_name: 'Receivables Due from GrubHub', account_type: 'asset', qb_account_id: '140971' },
    { account_number: '12051', account_name: 'Receivables Due from Postmates', account_type: 'asset', qb_account_id: '140972' },
    { account_number: '12049', account_name: 'Open Orders Receivables', account_type: 'asset', qb_account_id: '141862' },
    { account_number: '12100', account_name: 'Cash on Hand', account_type: 'asset', qb_account_id: '140800' },
    { account_number: '10000', account_name: 'Azusa', account_type: 'asset', qb_account_id: '140790' },
    { account_number: '10001', account_name: 'Bell', account_type: 'asset', qb_account_id: null },
    { account_number: '10002', account_name: 'Broadway LA', account_type: 'asset', qb_account_id: null },
    { account_number: '10003', account_name: 'Hollywood', account_type: 'asset', qb_account_id: null },
    { account_number: '10004', account_name: 'Lynwood', account_type: 'asset', qb_account_id: null },
    { account_number: '10005', account_name: 'Downey', account_type: 'asset', qb_account_id: null },
    { account_number: '10006', account_name: 'Huntington Park', account_type: 'asset', qb_account_id: null },
    { account_number: '10007', account_name: 'Santa Ana', account_type: 'asset', qb_account_id: null },
    { account_number: '10009', account_name: 'South Gate', account_type: 'asset', qb_account_id: null },
    { account_number: '10012', account_name: 'West Covina', account_type: 'asset', qb_account_id: null },
    { account_number: '10013', account_name: 'La Puente', account_type: 'asset', qb_account_id: null },
    { account_number: '10014', account_name: 'Norwalk', account_type: 'asset', qb_account_id: null },
    { account_number: '10015', account_name: 'Slauson', account_type: 'asset', qb_account_id: null },
    { account_number: '10017', account_name: 'Rialto', account_type: 'asset', qb_account_id: null },
    { account_number: '51030', account_name: 'Bank Merchant Fees', account_type: 'expense', qb_account_id: '140792' },
    { account_number: '51050', account_name: 'Cash Over/(Short)', account_type: 'expense', qb_account_id: '140801' },
    { account_number: '50006', account_name: 'Materials and Supplies', account_type: 'cogs', qb_account_id: '140812' },
    { account_number: '20500', account_name: 'Gift Cards Payable', account_type: 'liability', qb_account_id: '140861' },
    { account_number: '13200', account_name: 'Undeposited Funds', account_type: 'asset', qb_account_id: '141023' },
  ]

  const { data, error } = await supabase.from('accounting_gl_accounts').insert(accounts).select()
  if (error) {
    console.error('  Error seeding GL accounts:', error.message)
  } else {
    console.log(`  ✅ Seeded ${data?.length} GL accounts`)
  }
}

async function seedSiteMappings() {
  // Get stores from DB
  const { data: stores, error: storeErr } = await supabase
    .from('stores')
    .select('id, name')
    .eq('is_active', true)
    .order('name')

  if (storeErr || !stores) {
    console.error('  Error fetching stores:', storeErr?.message)
    return
  }

  const storeConfig: Record<string, { bank: string; location: string }> = {
    'azusa': { bank: '10000', location: 'Azusa' },
    'bell': { bank: '10001', location: 'Bell' },
    'broadway': { bank: '10002', location: 'Broadway LA' },
    'central': { bank: '10002', location: 'Central LA' },
    'downey': { bank: '10005', location: 'Downey' },
    'hollywood': { bank: '10003', location: 'Hollywood' },
    'huntington': { bank: '10006', location: 'Huntington Park' },
    'la puente': { bank: '10013', location: 'La Puente' },
    'lynwood': { bank: '10004', location: 'Lynwood' },
    'norwalk': { bank: '10014', location: 'Norwalk' },
    'rialto': { bank: '10017', location: 'Rialto' },
    'santa ana': { bank: '10007', location: 'Santa Ana' },
    'slauson': { bank: '10015', location: 'Slauson' },
    'south gate': { bank: '10009', location: 'South Gate' },
    'west covina': { bank: '10012', location: 'West Covina' },
  }

  for (const store of stores) {
    const nameKey = Object.keys(storeConfig).find(k => store.name.toLowerCase().includes(k))
    if (!nameKey) {
      console.log(`  ⚠️ No config for: ${store.name} (id: ${store.id})`)
      continue
    }

    const config = storeConfig[nameKey]
    const { error } = await supabase
      .from('accounting_site_mappings')
      .insert({
        store_id: store.id,
        qb_location: config.location,
        qb_class: config.location,
        bank_account_number: config.bank,
      })

    if (error) {
      console.log(`  ❌ ${store.name}: ${error.message}`)
    } else {
      console.log(`  ✅ ${store.name} → Bank ${config.bank}, Location: ${config.location}`)
    }
  }
}

function getMigrationSQL(): string {
  return `-- =============================================================================
-- MIGRATION: Cohesion Replacement - Accounting Tables
-- Run in Supabase Dashboard > SQL Editor
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

-- 2. Site Mappings
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

-- 3. Sales Packets
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_acct_packets_store_date ON accounting_sales_packets(store_id, business_date);
CREATE INDEX IF NOT EXISTS idx_acct_packets_status ON accounting_sales_packets(status);
CREATE INDEX IF NOT EXISTS idx_acct_packets_bdate ON accounting_sales_packets(business_date);
CREATE INDEX IF NOT EXISTS idx_acct_sync_logs_packet ON accounting_sync_logs(packet_id);
CREATE INDEX IF NOT EXISTS idx_acct_sync_logs_date ON accounting_sync_logs(business_date);

-- RLS
ALTER TABLE accounting_gl_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_site_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_sales_packets ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "accounting_gl_accounts_all" ON accounting_gl_accounts FOR ALL USING (true);
CREATE POLICY "accounting_site_mappings_all" ON accounting_site_mappings FOR ALL USING (true);
CREATE POLICY "accounting_sales_packets_all" ON accounting_sales_packets FOR ALL USING (true);
CREATE POLICY "accounting_sync_logs_all" ON accounting_sync_logs FOR ALL USING (true);
`
}

main().catch(console.error)
