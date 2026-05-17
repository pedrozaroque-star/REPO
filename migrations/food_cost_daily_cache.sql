-- ═══════════════════════════════════════════════════════════
-- FOOD COST DAILY CACHE
-- Stores pre-calculated food cost aggregates per store per day
-- Used by the Sales module for instant KPI reads
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS food_cost_daily_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_date DATE NOT NULL,
  store_id TEXT NOT NULL,          -- Toast external store GUID
  store_name TEXT,
  total_cost NUMERIC(12,2) DEFAULT 0,        -- Theoretical food cost ($)
  net_sales NUMERIC(12,2) DEFAULT 0,         -- Net sales for cost % calculation
  cost_percentage NUMERIC(6,2) DEFAULT 0,    -- Pre-calculated: (total_cost / net_sales) * 100
  total_items INTEGER DEFAULT 0,             -- Total menu items processed
  items_with_recipe INTEGER DEFAULT 0,       -- Items that had recipe matches
  total_meat_lbs NUMERIC(10,2) DEFAULT 0,    -- Total meat consumption (lbs)
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(business_date, store_id)
);

-- Performance indexes
CREATE INDEX idx_fc_cache_date ON food_cost_daily_cache(business_date);
CREATE INDEX idx_fc_cache_store ON food_cost_daily_cache(store_id);
CREATE INDEX idx_fc_cache_date_range ON food_cost_daily_cache(business_date, store_id);

-- Comment
COMMENT ON TABLE food_cost_daily_cache IS 'Pre-calculated food cost aggregates per store per business day. Populated via write-through from /api/inventory/food-cost. Read by /api/inventory/food-cost-cache for instant Sales dashboard KPIs.';
