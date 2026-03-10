ALTER TABLE tv_images ADD COLUMN IF NOT EXISTS store_assignments JSONB DEFAULT '[]'::jsonb;
ALTER TABLE tv_images ADD COLUMN IF NOT EXISTS is_universal BOOLEAN DEFAULT true;
