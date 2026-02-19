ALTER TABLE toast_menu_items ADD COLUMN IF NOT EXISTS recipe_na BOOLEAN DEFAULT false;

-- Force PostgREST schema cache reload (helps if column exists but isn't seen)
NOTIFY pgrst, 'reload config';
