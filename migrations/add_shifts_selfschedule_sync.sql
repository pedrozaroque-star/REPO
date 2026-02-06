-- Migration: Add source and claim_id columns to shifts table for self-scheduling sync
-- Run this in Supabase SQL Editor

-- Add source column to track where the shift came from
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';

-- Add claim_id to link back to shift_claims for cleanup when dropping
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS claim_id UUID REFERENCES shift_claims(id) ON DELETE SET NULL;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_shifts_claim_id ON shifts(claim_id) WHERE claim_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shifts_source ON shifts(source);

-- Comment for documentation
COMMENT ON COLUMN shifts.source IS 'Origin of the shift: manual (planificador), self-schedule (employee claimed)';
COMMENT ON COLUMN shifts.claim_id IS 'Reference to shift_claims.id for self-scheduled shifts';
