-- Migration: Automated Vendor Portal Scraping & Sync Architecture
-- Target: Tacos Gavilan (TEG Modernizado)
-- Date: 2026-08-19

-- 1. Create vendor_portal_configs table
CREATE TABLE IF NOT EXISTS vendor_portal_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    login_url TEXT NOT NULL DEFAULT 'https://shop.vieleandsons.com/login/',
    data_url TEXT NOT NULL DEFAULT 'https://shop.vieleandsons.com/api/v3/order_entry',
    credential_key TEXT NOT NULL DEFAULT 'VIELE',
    scrape_method TEXT DEFAULT 'api_json',
    is_active BOOLEAN DEFAULT true,
    last_synced_at TIMESTAMPTZ,
    last_sync_status TEXT,
    last_sync_items_count INTEGER DEFAULT 0,
    last_sync_error TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(supplier_id)
);

-- 2. Create supplier_sync_log table
CREATE TABLE IF NOT EXISTS supplier_sync_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    sync_type TEXT NOT NULL DEFAULT 'cron',
    status TEXT NOT NULL,
    items_found INTEGER DEFAULT 0,
    items_changed INTEGER DEFAULT 0,
    items_increased INTEGER DEFAULT 0,
    items_decreased INTEGER DEFAULT 0,
    net_annual_impact NUMERIC(14,2) DEFAULT 0,
    error_message TEXT,
    duration_ms INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Create Indexes for High Performance
CREATE INDEX IF NOT EXISTS idx_vendor_portal_supplier ON vendor_portal_configs(supplier_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_supplier_date ON supplier_sync_log(supplier_id, created_at DESC);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE vendor_portal_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_sync_log ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'vendor_portal_configs' AND policyname = 'vendor_portal_configs_all'
  ) THEN
    CREATE POLICY "vendor_portal_configs_all" ON vendor_portal_configs FOR ALL USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'supplier_sync_log' AND policyname = 'supplier_sync_log_all'
  ) THEN
    CREATE POLICY "supplier_sync_log_all" ON supplier_sync_log FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
