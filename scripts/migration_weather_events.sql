-- 1. Create Calendar Events Table for Holidays and Local Events
CREATE TABLE IF NOT EXISTS public.calendar_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id TEXT, -- Optional: If NULL, applies to ALL stores (Global Holiday)
    date DATE NOT NULL,
    name TEXT NOT NULL,
    impact_multiplier NUMERIC DEFAULT 1.0, -- e.g. 1.10 for +10% sales, 0.90 for -10%
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 2. Add Coordinates to Stores Table (for Weather API)
ALTER TABLE stores ADD COLUMN IF NOT EXISTS latitude NUMERIC;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS longitude NUMERIC;

-- 3. (Optional) Seed some example coordinates for Tacos Gavilan stores (Approximate)
-- You should update these with real values
UPDATE stores SET latitude = 34.0522, longitude = -118.2437 WHERE name ILIKE '%Los Angeles%';
UPDATE stores SET latitude = 33.9425, longitude = -118.4081 WHERE name ILIKE '%LAX%';
