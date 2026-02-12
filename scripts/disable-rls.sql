-- Disable RLS temporarily to debug frontend visibility
alter table toast_menu_items disable row level security;
alter table inventory_items disable row level security;
alter table inventory_categories disable row level security;
alter table recipes disable row level security;
