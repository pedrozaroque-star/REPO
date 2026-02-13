-- Add quantity_per_unit and unit_measure columns to inventory_items
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS quantity_per_unit NUMERIC DEFAULT 1;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS unit_measure TEXT DEFAULT 'pza';

-- Optional: Populate existing data
-- This is tricky without knowing exact structure, but defaulting to 1 and 'pza' is safe for now.
-- Ideally, we'd parse unit_type, but that's complex logic for SQL.

-- Update recipes calculation view/function if necessary (schema dependent)
