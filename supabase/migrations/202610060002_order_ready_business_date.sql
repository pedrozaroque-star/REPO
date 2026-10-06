-- ==============================================================================
-- Migration: Add business_date and 6 AM workday rule to order_ready_announcements
-- Author: Carlos / Antigravity
-- Date: 2026-10-06
-- Business Rules:
-- 1. Tacos Gavilan workday starts at 6:00 AM and ends at 5:59:59 AM next day.
-- 2. Any order created between 12:00 AM and 5:59:59 AM belongs to previous business_date.
-- 3. PM shift starts at 5:00 PM (17:00).
-- ==============================================================================

ALTER TABLE public.order_ready_announcements
  ADD COLUMN IF NOT EXISTS business_date DATE;

-- Backfill existing rows using the official 6 AM rule in America/Los_Angeles
UPDATE public.order_ready_announcements
SET business_date = (created_at AT TIME ZONE 'America/Los_Angeles' - INTERVAL '6 hours')::DATE
WHERE business_date IS NULL;

-- Default for future inserts
ALTER TABLE public.order_ready_announcements
  ALTER COLUMN business_date SET DEFAULT (now() AT TIME ZONE 'America/Los_Angeles' - INTERVAL '6 hours')::DATE;

-- Compound index for fast store + business_date queries and real-time order displays
CREATE INDEX IF NOT EXISTS idx_order_ready_store_bdate_status
  ON public.order_ready_announcements(store_code, business_date, status, created_at DESC);
