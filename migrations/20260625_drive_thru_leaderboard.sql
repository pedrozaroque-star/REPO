-- ============================================================================
-- MIGRATION: Drive-Thru Leaderboard Module
-- Date: 2026-06-25
-- Description: Creates tables for granular Drive-Thru order tracking and
--              half-hour statistics aggregation. Also adds has_drive_thru 
--              column to stores table.
-- NOTE: The has_drive_thru column defaults to false. The autoDetectDTStores()
--       function (called daily at 7 AM by the cron) will automatically
--       detect and activate stores with Drive-Thru based on actual order data.
--       For immediate activation, we also set known DT stores to true.
-- ============================================================================

-- 1. Add has_drive_thru column to stores table (default false = safe)
ALTER TABLE stores ADD COLUMN IF NOT EXISTS has_drive_thru BOOLEAN DEFAULT false;

-- Set known DT stores to true (based on analysis of sales_daily_cache.guest_count > 0)
-- These 6 stores have confirmed Drive-Thru activity in the data.
-- The autoDetectDTStores() function will auto-maintain this going forward.
UPDATE stores SET has_drive_thru = true WHERE external_id IN (
    '8685e942-3f07-403a-afb6-faec697cd2cb',  -- LA Central
    '80a1ec95-bc73-402e-8884-e5abbe9343e6',  -- Lynwood
    '5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02',  -- West Covina
    '42ed15a6-106b-466a-9076-1e8f72451f6b',  -- Norwalk
    '3a803939-eb13-4def-a1a4-462df8e90623',  -- La Puente
    '95866cfc-eeb8-4af9-9586-f78931e1ea04'   -- South Gate
);

-- 2. Table: dt_orders — Individual Drive-Thru orders
CREATE TABLE IF NOT EXISTS dt_orders (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    store_id TEXT NOT NULL,              -- Toast GUID
    store_name TEXT NOT NULL,
    business_date DATE NOT NULL,
    order_guid TEXT NOT NULL,            -- Toast Order GUID (unique per store)
    order_number TEXT,                   -- Display number on receipt
    opened_at TIMESTAMPTZ NOT NULL,
    closed_at TIMESTAMPTZ,
    duration_seconds INTEGER,            -- SOS in seconds
    half_hour_slot TEXT NOT NULL,         -- "06:00", "06:30", "07:00", etc.
    hour INTEGER NOT NULL,               -- 6, 7, 8... for quick filtering
    net_sales NUMERIC(10,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(store_id, order_guid)
);

-- Indexes for frequent queries
CREATE INDEX IF NOT EXISTS idx_dt_orders_date ON dt_orders(business_date);
CREATE INDEX IF NOT EXISTS idx_dt_orders_store_date ON dt_orders(store_id, business_date);
CREATE INDEX IF NOT EXISTS idx_dt_orders_slot ON dt_orders(business_date, half_hour_slot);
CREATE INDEX IF NOT EXISTS idx_dt_orders_number ON dt_orders(order_number);

-- 3. Table: dt_halfhour_stats — Pre-aggregated stats per 30-min window
CREATE TABLE IF NOT EXISTS dt_halfhour_stats (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    store_id TEXT NOT NULL,
    store_name TEXT NOT NULL,
    business_date DATE NOT NULL,
    slot TEXT NOT NULL,                   -- "06:00", "06:30", etc.
    slot_index INTEGER NOT NULL,          -- 0-47 (each half hour of the day)
    order_count INTEGER DEFAULT 0,
    avg_duration_sec INTEGER DEFAULT 0,
    min_duration_sec INTEGER,             -- Fastest order
    max_duration_sec INTEGER,             -- Slowest order
    min_order_number TEXT,                -- # of fastest order
    max_order_number TEXT,                -- # of slowest order
    cars_per_hour_rate NUMERIC(5,1),      -- Projected to 1 hour
    total_sales NUMERIC(10,2) DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(store_id, business_date, slot)
);

-- Indexes for frequent queries
CREATE INDEX IF NOT EXISTS idx_dt_stats_date ON dt_halfhour_stats(business_date);
CREATE INDEX IF NOT EXISTS idx_dt_stats_store ON dt_halfhour_stats(store_id, business_date);
CREATE INDEX IF NOT EXISTS idx_dt_stats_slot_index ON dt_halfhour_stats(business_date, slot_index);

-- 4. Enable Row Level Security (RLS) - but allow service role full access
ALTER TABLE dt_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE dt_halfhour_stats ENABLE ROW LEVEL SECURITY;

-- Policy: Allow service role full access
CREATE POLICY "Service role full access dt_orders" ON dt_orders
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access dt_halfhour_stats" ON dt_halfhour_stats
    FOR ALL USING (true) WITH CHECK (true);

-- Policy: Allow authenticated users to read
CREATE POLICY "Authenticated read dt_orders" ON dt_orders
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated read dt_halfhour_stats" ON dt_halfhour_stats
    FOR SELECT TO authenticated USING (true);
