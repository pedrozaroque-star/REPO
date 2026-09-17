-- Event Intelligence: AI-powered event discovery for sales projections
-- Populated by daily cron job using Gemini API + Google Search Grounding
-- Used by Intelligence v3.0 to adjust projections based on upcoming events

CREATE TABLE IF NOT EXISTS event_intelligence (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    event_date DATE NOT NULL,
    event_name TEXT NOT NULL,
    event_type TEXT NOT NULL DEFAULT 'other', -- sports, cultural, holiday, concert, festival, weather, school, community
    event_scope TEXT DEFAULT 'regional', -- national, regional, local
    impact_prediction TEXT NOT NULL DEFAULT 'neutral', -- very_high_boost, high_boost, moderate_boost, slight_boost, neutral, slight_drop, high_drop, severe_drop
    impact_multiplier NUMERIC(4,2) DEFAULT 1.00, -- 0.35 (Thanksgiving) to 1.40 (Cinco de Mayo). 1.00 = no impact
    confidence TEXT DEFAULT 'medium', -- high (known holiday), medium (local event), low (AI prediction)
    description TEXT, -- Why this event impacts sales (in Spanish)
    source TEXT DEFAULT 'gemini_search', -- gemini_search, holidays_ts, manual, ticketmaster
    affects_stores TEXT[] DEFAULT ARRAY[]::TEXT[], -- Store UUIDs affected, empty = all stores
    venue_name TEXT, -- Name of the venue (e.g. "SoFi Stadium")
    venue_latitude NUMERIC(10,6), -- For distance-adjusted impact per store
    venue_longitude NUMERIC(10,6),
    raw_search_data JSONB, -- Raw Gemini response for auditing
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(event_date, event_name)
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_event_intelligence_date ON event_intelligence(event_date);
CREATE INDEX IF NOT EXISTS idx_event_intelligence_type ON event_intelligence(event_type);
CREATE INDEX IF NOT EXISTS idx_event_intelligence_source ON event_intelligence(source);

-- Enable RLS
ALTER TABLE event_intelligence ENABLE ROW LEVEL SECURITY;

-- Allow public read (projections need to read from anon client)
CREATE POLICY "Allow public read on event_intelligence" ON event_intelligence
    FOR SELECT USING (true);

-- Allow service role full access for cron writes
CREATE POLICY "Allow service role write on event_intelligence" ON event_intelligence
    FOR ALL USING (auth.role() = 'service_role');

-- Comments for documentation
COMMENT ON TABLE event_intelligence IS 'AI-discovered events that impact restaurant sales projections. Populated by daily cron job using Gemini + Google Search Grounding.';
COMMENT ON COLUMN event_intelligence.impact_multiplier IS '0.35 (Thanksgiving) to 1.40 (Cinco de Mayo). 1.00 = no impact.';
COMMENT ON COLUMN event_intelligence.venue_latitude IS 'Used to calculate distance-adjusted impact per store. Closer stores get amplified effect.';
